# company-erp-sso-v1: ERPNext's side of TDH's login, run inside its backend container by install-erp-sso.py, which
# puts CFG = {...} above this text and sends it on stdin (no secret on a command line). Idempotent:
#   - the sync's own user (System Manager, outside the people's email domain, so the sync never disables it) with
#     its API key and secret;
#   - the social login key TDH (custom OAuth 2 provider at <base>/tdh-sso/: authorize, token, userinfo; no
#     sign-ups: only users the sync made can log in);
# then prints SETUP {json} with what Frappe builds from it (no secret).
import json
import os

import frappe
from frappe.utils.password import set_encrypted_password

os.chdir("/home/frappe/frappe-bench/sites")
frappe.init(site=CFG["site"], sites_path=".")
frappe.connect()
frappe.set_user("Administrator")
out = {}
email = CFG["sync_user"]
if not frappe.db.exists("User", email):
    frappe.get_doc({"doctype": "User", "email": email, "first_name": "TDH 同步", "enabled": 1, "user_type": "System User",
                    "send_welcome_email": 0, "roles": [{"role": "System Manager"}]}).insert(ignore_permissions=True)
u = frappe.get_doc("User", email)
u.enabled = 1
if not any(r.role == "System Manager" for r in u.roles):
    u.append("roles", {"role": "System Manager"})
u.api_key = CFG["api_key"]
u.save(ignore_permissions=True)
set_encrypted_password("User", email, CFG["api_secret"], fieldname="api_secret")
out["sync_user"] = True

base = CFG["base"]
found = frappe.get_all("Social Login Key", filters={"provider_name": "TDH"}, pluck="name")
doc = frappe.get_doc("Social Login Key", found[0]) if found else frappe.new_doc("Social Login Key")
doc.update({"provider_name": "TDH", "social_login_provider": "Custom", "enable_social_login": 1, "client_id": CFG["client_id"],
            "base_url": base, "custom_base_url": 0, "authorize_url": base + "/tdh-sso/authorize",
            "access_token_url": base + "/tdh-sso/token", "api_endpoint": base + "/tdh-sso/userinfo",
            "auth_url_data": json.dumps({"response_type": "code", "scope": "openid"}), "user_id_property": "sub",
            "sign_ups": "Deny"})
doc.client_secret = CFG["client_secret"]
if doc.is_new():
    doc.redirect_url = "/api/method/frappe.integrations.oauth2_logins.custom/tdh"
    doc.insert(ignore_permissions=True)
doc.redirect_url = "/api/method/frappe.integrations.oauth2_logins.custom/" + doc.name
doc.save(ignore_permissions=True)
frappe.db.commit()
out["provider"] = doc.name
from frappe.utils.oauth import get_oauth2_authorize_url  # noqa: E402

url = get_oauth2_authorize_url(doc.name, "/app")
out["authorize_ok"] = url.startswith(base + "/tdh-sso/authorize?")
out["redirect_uri"] = frappe.utils.get_url(doc.redirect_url)
want = ["System Manager", "Accounts Manager", "Sales Manager", "Purchase Manager", "Stock Manager", "Manufacturing Manager",
        "Accounts User", "Purchase User", "Sales User", "Manufacturing User", "Stock User", "Employee"]
out["roles_missing"] = [r for r in want if not frappe.db.exists("Role", r)]
print("SETUP " + json.dumps(out, ensure_ascii=False))
frappe.destroy()
