"""dsh-client-ui-model-selection：模型与推理等级菜单，点「推理等级」不再把整个菜单关掉（幂等）。

菜单根上的 onBlur 只要焦点去了菜单以外就 close()。点「推理等级」那一行时，这一行马上被换成档位列表、从页面上
移除，浏览器报一次 relatedTarget 为空的失去焦点，菜单就关了，档位一个也点不上。新对话页面轻，档位列表常常
来得及先接住焦点；老对话重画慢，总是先关（2026-11-20：所有电脑「点了就变成 Default」，实测菜单在 90 毫秒内
关掉，挡住这次失焦后选 High 成功）。

现在 relatedTarget 为空时先不关，等这一轮渲染完再看：焦点已经在菜单里，不关；失焦的是被移除的那一行，
不关，把焦点交给菜单里的选中项（没有就第一项）；别的情况（切走窗口等）照常关。点到菜单外面由 mousedown
那条照常关，Tab 走开有 relatedTarget，照常关。"""
import sys
from pathlib import Path

MARK = "company-model-menu-blur-v1"
TARGET = "@deepseek-ai/dsh-client-ui-model-selection/lib/client.js"

OLD = """			const onBlur = (event) => {
				if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;
				close();
			};
"""

NEW = """			const onBlur = (event) => {
				if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;
				// company-model-menu-blur-v1: a pane switch removes the focused row (no relatedTarget); that is not leaving the menu.
				if (event.relatedTarget === null) {
					const left = event.target;
					setTimeout(() => {
						const now = document.activeElement;
						if (now instanceof Node && (rootRef.current?.contains(now) === true || menuRef.current?.contains(now) === true)) return;
						if (left instanceof Node && !left.isConnected && menuRef.current !== null) {
							(menuRef.current.querySelector("[role=\\"menuitemradio\\"][aria-checked=\\"true\\"]:not([disabled])") ?? menuRef.current.querySelector("button:not([disabled])"))?.focus();
							return;
						}
						close();
					}, 0);
					return;
				}
				close();
			};
"""


def patch(t):
    if MARK in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("anchor-model-menu-blur count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"


def main():
    p = Path(sys.argv[1])
    t, how = patch(p.read_text(encoding="utf-8"))
    if how == "patched":
        p.write_text(t, encoding="utf-8")
    print(how)


if __name__ == "__main__":
    main()
