# company-erp-companies-v1: ERPNext's setup wizard and the companies, run inside the backend container (CFG = {...} is
# put above this text and sent on stdin by the caller). Idempotent:
#   - the wizard (language, country, time zone, currency, the first company, its chart of accounts, fiscal year), unless
#     it is complete already; account names come in the setup language;
#   - every further company of CFG["companies"], with the same currency and chart;
#   - "supplies": an internal customer in the supplier company that stands for the buyer company, and an internal
#     supplier in the buyer company that stands for the supplier company (ERPNext's inter-company documents).
# Prints COMPANIES {json} (names, warehouses, setup state; nothing secret).
import json
import os

import frappe

os.chdir("/home/frappe/frappe-bench/sites")
frappe.init(site=CFG["site"], sites_path=".")
frappe.connect()
frappe.set_user("Administrator")
frappe.local.lang = CFG["language"]
out = {}
first = CFG["companies"][0]
if not frappe.is_setup_complete():
    from frappe.desk.page.setup_wizard.setup_wizard import setup_complete
    res = setup_complete({"language": CFG["language"], "country": CFG["country"], "timezone": CFG["timezone"], "currency": CFG["currency"],
                          "company_name": first["name"], "company_abbr": first["abbr"], "chart_of_accounts": CFG["chart"],
                          "fy_start_date": CFG["fy_start"], "fy_end_date": CFG["fy_end"], "setup_demo": 0})
    out["wizard"] = (res or {}).get("status") if isinstance(res, dict) else str(res)[:80]
    frappe.db.commit()
out["setup_complete"] = bool(frappe.is_setup_complete())
for c in CFG["companies"][1:]:
    if not frappe.db.exists("Company", c["name"]):
        frappe.get_doc({"doctype": "Company", "company_name": c["name"], "abbr": c["abbr"], "default_currency": CFG["currency"],
                        "country": CFG["country"], "create_chart_of_accounts_based_on": "Standard Template",
                        "chart_of_accounts": CFG["chart"]}).insert(ignore_permissions=True)
        frappe.db.commit()
for s in CFG.get("supplies") or []:
    seller, buyer = s["from"], s["to"]
    if not frappe.db.exists("Customer", buyer):
        frappe.get_doc({"doctype": "Customer", "customer_name": buyer, "customer_type": "Company", "is_internal_customer": 1,
                        "represents_company": buyer, "companies": [{"company": seller}]}).insert(ignore_permissions=True)
    if not frappe.db.exists("Supplier", seller):
        frappe.get_doc({"doctype": "Supplier", "supplier_name": seller, "supplier_type": "Company", "is_internal_supplier": 1,
                        "represents_company": seller, "companies": [{"company": buyer}]}).insert(ignore_permissions=True)
    frappe.db.commit()
out["companies"] = frappe.get_all("Company", fields=["name", "abbr", "default_currency", "country"], order_by="creation asc")
out["warehouses"] = {c["name"]: frappe.db.count("Warehouse", {"company": c["name"]}) for c in out["companies"]}
out["accounts"] = {c["name"]: frappe.db.count("Account", {"company": c["name"]}) for c in out["companies"]}
out["internal_customers"] = frappe.get_all("Customer", filters={"is_internal_customer": 1}, pluck="name")
out["internal_suppliers"] = frappe.get_all("Supplier", filters={"is_internal_supplier": 1}, pluck="name")
out["language"] = frappe.db.get_single_value("System Settings", "language")
out["time_zone"] = frappe.db.get_single_value("System Settings", "time_zone")
out["default_company"] = frappe.db.get_default("company")
out["fiscal_years"] = frappe.get_all("Fiscal Year", fields=["name", "year_start_date", "year_end_date"])
out["sample_account"] = frappe.db.get_value("Account", {"company": first["name"], "is_group": 0}, "account_name")
print("COMPANIES " + json.dumps(out, ensure_ascii=False, default=str))
frappe.destroy()
