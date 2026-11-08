"""One action for the Screen Agent, executed with pyautogui.

Called by the app as:  python agent_action.py "<json>"
where the JSON is e.g. {"action":"click","x":500,"y":300} with coordinates
in a 0-1000 normalised space (the model answers in that space; the real
screen size is applied here, so a scaled screenshot never misplaces a
click).

Actions: click | double_click | right_click | type | key | hotkey |
         scroll | move | done (no-op, reports the screen size).
Prints one JSON object: {"ok":true,"screen":[w,h]}.
"""

import json
import sys

import pyautogui

pyautogui.FAILSAFE = True  # slam the mouse into a screen corner to abort

sw, sh = pyautogui.size()


def real(point):
    """0-1000 normalised → real pixels on the primary screen."""
    x = max(0, min(1000, float(point.get("x", 500)))) / 1000 * sw
    y = max(0, min(1000, float(point.get("y", 500)))) / 1000 * sh
    return round(x), round(y)


def main():
    spec = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    action = str(spec.get("action", "done")).lower()

    if action == "done":
        pass
    elif action == "click":
        x, y = real(spec)
        pyautogui.click(x, y)
    elif action == "double_click":
        x, y = real(spec)
        pyautogui.doubleClick(x, y)
    elif action == "right_click":
        x, y = real(spec)
        pyautogui.rightClick(x, y)
    elif action == "move":
        x, y = real(spec)
        pyautogui.moveTo(x, y, duration=0.2)
    elif action == "type":
        pyautogui.typewrite(str(spec.get("text", "")), interval=0.03)
    elif action == "key":
        keys = [k for k in str(spec.get("keys", "")).split("+") if k]
        if len(keys) == 1:
            pyautogui.press(keys[0])
        elif keys:
            pyautogui.hotkey(*keys)
    elif action == "scroll":
        amount = int(spec.get("amount", -3))
        pyautogui.scroll(amount)
    else:
        print(json.dumps({"ok": False, "error": f"unknown action {action}"}))
        return

    print(json.dumps({"ok": True, "screen": [sw, sh], "action": action}))


if __name__ == "__main__":
    main()