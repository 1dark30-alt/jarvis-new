#!/usr/bin/env python3
"""
Single-task computer use agent for Jarvis.
Usage: python3 computer_use.py <task> <api_key>
Outputs a JSON result line at the end.
"""

import base64
import io
import json
import sys
import time
import warnings

import mss
import pyautogui
from openai import OpenAI
from PIL import Image

warnings.filterwarnings("ignore", category=DeprecationWarning, module="mss")

IS_MACOS = sys.platform == 'darwin'

MODEL = "gpt-5.4"
MAX_TURNS = 30
TOOL_DEFS = [{"type": "computer"}]

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

SCREEN_W, SCREEN_H = pyautogui.size()

KEY_MAP = {
    "CTRL":       "ctrl",
    "ALT":        "alt",
    "META":       "command" if IS_MACOS else "win",
    "CMD":        "command",
    "COMMAND":    "command",
    "SUPER":      "command" if IS_MACOS else "win",
    "SHIFT":      "shift",
    "RETURN":     "enter",
    "ENTER":      "enter",
    "ESC":        "escape",
    "ESCAPE":     "escape",
    "TAB":        "tab",
    "SPACE":      "space",
    "BACKSPACE":  "backspace",
    "DELETE":     "delete",
    "ARROWLEFT":  "left",
    "ARROWRIGHT": "right",
    "ARROWUP":    "up",
    "ARROWDOWN":  "down",
    "LEFT":       "left",
    "RIGHT":      "right",
    "UP":         "up",
    "DOWN":       "down",
    "HOME":       "home",
    "END":        "end",
    "PAGEUP":     "pageup",
    "PAGEDOWN":   "pagedown",
    "WIN":        "win",
    "WINDOWS":    "win",
}


def normalize_key(key: str) -> str:
    return KEY_MAP.get(key.upper(), key.lower())


def take_screenshot() -> str:
    with mss.MSS() as sct:
        monitor = sct.monitors[1]
        raw = sct.grab(monitor)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        if img.width != SCREEN_W or img.height != SCREEN_H:
            img = img.resize((SCREEN_W, SCREEN_H), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode()


def execute_action(action) -> None:
    action_type = getattr(action, "type", None)

    if action_type == "screenshot":
        return

    elif action_type == "click":
        button = getattr(action, "button", "left")
        pyautogui.click(action.x, action.y, button=button)

    elif action_type == "double_click":
        button = getattr(action, "button", "left")
        pyautogui.doubleClick(action.x, action.y, button=button)

    elif action_type == "move":
        pyautogui.moveTo(action.x, action.y, duration=0.1)

    elif action_type == "type":
        pyautogui.typewrite(action.text, interval=0.04)

    elif action_type == "keypress":
        keys = [normalize_key(k) for k in action.keys]
        if len(keys) == 1:
            pyautogui.press(keys[0])
        else:
            pyautogui.hotkey(*keys)

    elif action_type == "scroll":
        scroll_x = getattr(action, "scrollX", 0)
        scroll_y = getattr(action, "scrollY", 0)
        pyautogui.moveTo(action.x, action.y)
        if scroll_y:
            pyautogui.scroll(int(-scroll_y / 100))
        if scroll_x:
            pyautogui.hscroll(int(-scroll_x / 100))

    elif action_type == "drag":
        path = action.path
        if len(path) < 2:
            return
        start = path[0]
        pyautogui.moveTo(start["x"], start["y"])
        pyautogui.mouseDown()
        for point in path[1:]:
            pyautogui.moveTo(point["x"], point["y"], duration=0.05)
        pyautogui.mouseUp()

    elif action_type == "wait":
        time.sleep(1)

    else:
        print(f"  [skip] unknown action: {action_type}", file=sys.stderr)


def run_task(task: str, api_key: str) -> dict:
    client = OpenAI(api_key=api_key)

    print(f"[computer-use] Task: \"{task}\" | Screen: {SCREEN_W}×{SCREEN_H}", file=sys.stderr)

    response = client.responses.create(
        model=MODEL,
        tools=TOOL_DEFS,
        input=task,
    )

    turn = 0
    result_text = ""

    while turn < MAX_TURNS:
        turn += 1

        computer_call = next(
            (item for item in response.output if item.type == "computer_call"),
            None,
        )

        if computer_call is None:
            for item in response.output:
                if item.type == "message":
                    content = item.content
                    if isinstance(content, list):
                        for block in content:
                            text = getattr(block, "text", None)
                            if text:
                                result_text += text
                    elif isinstance(content, str):
                        result_text += content
            break

        actions = getattr(computer_call, "actions", None) or [computer_call.action]
        action_names = [getattr(a, "type", "?") for a in actions]
        print(f"[computer-use] Turn {turn}: {', '.join(action_names)}", file=sys.stderr)

        for action in actions:
            execute_action(action)

        time.sleep(0.3)

        screenshot_b64 = take_screenshot()

        safety_checks = getattr(computer_call, "pending_safety_checks", []) or []
        acknowledged = [
            {"id": sc.id, "code": sc.code, "message": sc.message}
            for sc in safety_checks
        ]

        call_output = {
            "type": "computer_call_output",
            "call_id": computer_call.call_id,
            "output": {
                "type": "computer_screenshot",
                "image_url": f"data:image/png;base64,{screenshot_b64}",
                "detail": "original",
            },
        }
        if acknowledged:
            call_output["acknowledged_safety_checks"] = acknowledged

        response = client.responses.create(
            model=MODEL,
            tools=TOOL_DEFS,
            previous_response_id=response.id,
            input=[call_output],
        )

    if turn >= MAX_TURNS:
        result_text = f"Reached max turns ({MAX_TURNS}). Task may be incomplete."

    print(f"[computer-use] Done in {turn} turns.", file=sys.stderr)
    return {"result": result_text or "Task completed.", "turns": turn}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: computer_use.py <task> <api_key>"}))
        sys.exit(1)

    task = sys.argv[1]
    api_key = sys.argv[2]

    try:
        output = run_task(task, api_key)
    except Exception as e:
        output = {"error": str(e)}

    # Only JSON goes to stdout — logs go to stderr
    print(json.dumps(output))
