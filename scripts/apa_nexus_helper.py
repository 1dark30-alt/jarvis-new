"""Nexus typing helper — the F9 typer from the APA Scoresheet Toolkit,
running headless so the Jarvis web page can drive it.

Usage:
    python apa_nexus_helper.py <league folder> <week folder name> <team match index>

 behaviour (identical to the toolkit's own helper):
    F9        type the current row (Player #, IN, DS, Wins, tab on) and advance
    Ctrl+F9   skip a row without typing
    Ctrl+F12  quit

Progress is written to %JARVIS_DATA_DIR%\\apa-nexus-state.json after every
action so the Jarvis page can mirror it live.
"""

import json
import os
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

TOOLKIT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLKIT_DIR))

import apa_toolkit as tk  # noqa: E402

if sys.platform != "win32" or not tk.KEYS_AVAILABLE:
    print(json.dumps({"error": "Nexus typing is Windows-only (SendInput)."}))
    sys.exit(1)

# Same convention as the rest of Jarvis's stores: JARVIS_DATA_DIR, else the
# project root (where the API routes read it).
DATA_DIR = Path(
    os.environ.get("JARVIS_DATA_DIR")
    or os.getcwd()
)
STATE = DATA_DIR / "apa-nexus-state.json"


def write_state(state):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def list_matches(league: Path, week_name: str):
    """--list mode: red-line the week folder and print the team matches as JSON."""
    folder = league / week_name
    if not folder.is_dir():
        print(json.dumps({"error": f"no such week folder: {folder}"}))
        sys.exit(1)
    entries = tk.redline_folder(folder, tk.Rules())
    out = [
        {"index": i, "teams": " vs ".join(e["teams"]), "matchCount": len(e["matches"])}
        for i, e in enumerate(entries)
    ]
    print(json.dumps({"matches": out}, ensure_ascii=False))


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--list":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "usage: --list <league> <week folder>"}))
            sys.exit(1)
        list_matches(Path(sys.argv[2]).expanduser(), sys.argv[3])
        return

    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: apa_nexus_helper.py <league> <week folder> <match index>"}))
        sys.exit(1)

    league = Path(sys.argv[1]).expanduser()
    week_name = sys.argv[2]
    match_index = int(sys.argv[3])

    week_folder = league / week_name
    if not week_folder.is_dir():
        print(json.dumps({"error": f"no such week folder: {week_folder}"}), flush=True)
        sys.exit(1)

    rules = tk.Rules()
    entries = tk.redline_folder(week_folder, rules)
    if not entries:
        print(json.dumps({"error": "no matches found in that week folder"}))
        sys.exit(1)
    if match_index < 0 or match_index >= len(entries):
        print(json.dumps({"error": f"match index {match_index} out of range (0..{len(entries) - 1})"}))
        sys.exit(1)

    entry = entries[match_index]
    rows = tk.entry_rows(entry)
    teams = " vs ".join(entry["teams"])

    state = {
        "running": True,
        "teams": teams,
        "week": week_name,
        "rows": [
            {
                "match": r["match"], "seat": r["seat"], "member": r["member"],
                "name": r["name"], "SL": r["SL"], "IN": r["IN"], "DS": r["DS"],
                "Wins": r["Wins"], "PTS": r["PTS"],
                "reconciled": r["reconciled"], "exceptions": r["exceptions"],
            }
            for r in rows
        ],
        "idx": 0,
        "lastTyped": None,
        "message": "Click into the Player # box in Nexus, then press F9. Ctrl+F9 skips, Ctrl+F12 quits.",
    }
    write_state(state)

    import ctypes
    import ctypes.wintypes as wintypes

    _user32 = ctypes.windll.user32
    WM_HOTKEY = 0x0312

    chosen = None
    for i, (mods, vk, _label) in enumerate(tk.HOTKEY_CANDIDATES, start=1):
        if _user32.RegisterHotKey(None, i, mods, vk):
            chosen = (i, mods, vk)
            break
    if chosen is None:
        state["running"] = False
        state["message"] = "No hotkey was available on this PC."
        write_state(state)
        print(json.dumps({"error": "no hotkey available"}))
        sys.exit(1)

    # quit hotkey: Ctrl+F12
    quit_registered = _user32.RegisterHotKey(None, 98, 0x0002 | 0x0008, 0x7B)
    skip_registered = _user32.RegisterHotKey(None, 99, 0x0002 | 0x0001, 0x78)  # Ctrl+F9

    idx = 0
    msg = wintypes.MSG()
    while _user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message != WM_HOTKEY:
            continue
        if quit_registered and msg.wParam == 98:
            break
        if skip_registered and msg.wParam == 99:
            idx = min(idx + 1, len(rows))
        elif msg.wParam == chosen[0]:
            if idx >= len(rows):
                state["message"] = "All rows typed. Check the page, then submit in Nexus."
                write_state(state)
                continue
            row = rows[idx]
            try:
                tk.type_row(row["typed"])
            except Exception as exc:
                state["message"] = f"Could not type: {exc}"
                write_state(state)
                continue
            idx += 1
            note = ""
            if row["exceptions"]:
                note = " — now enter " + ", ".join(row["exceptions"]) + " by hand"
            state["idx"] = idx
            state["lastTyped"] = {
                "match": row["match"], "member": row["member"], "name": row["name"],
            }
            state["message"] = (
                f"Typed row {idx} of {len(rows)}{note}"
                if idx < len(rows)
                else f"All {len(rows)} rows typed. Check the page, then submit in Nexus."
            )
            write_state(state)

    state["running"] = False
    state["message"] = "Helper closed."
    write_state(state)
    if quit_registered:
        _user32.UnregisterHotKey(None, 98)
    if skip_registered:
        _user32.UnregisterHotKey(None, 99)
    _user32.UnregisterHotKey(None, chosen[0])


if __name__ == "__main__":
    main()