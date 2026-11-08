"""Windows notification history — read the system notification database.

Mark 58's notification_integration.py uses the WinRT UserNotificationListener
(which needs installed projection packages and a permission grant). This port
reads the same data from where Windows itself keeps it:
%LOCALAPPDATA%\\Microsoft\\Windows\\Notifications\\wpndatabase.db

The database is copied (with WAL sidecars) to a temp file before opening, so
the running notification service is never disturbed. Toast payloads are XML;
text nodes are extracted and app ids come from NotificationHandler.PrimaryId.

Output: one JSON object on stdout: {"notifications": [...]}, newest first.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")

DB = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db")
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 40

FILETIME_EPOCH_MS = 11644473600000  # 1601-01-01 → 1970-01-01


def filetime_to_iso(filetime):
    try:
        ms = int(filetime) // 10000 - FILETIME_EPOCH_MS
        import datetime
        return datetime.datetime.fromtimestamp(ms / 1000).isoformat(timespec="seconds")
    except Exception:
        return None


def toast_texts(xml):
    """The <text> nodes of a toast payload, in order."""
    return [t.strip() for t in re.findall(r"<text[^>]*>(.*?)</text>", xml, re.S) if t.strip()]


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def main():
    if not os.path.exists(DB):
        print(json.dumps({"notifications": [], "error": "no notification database on this machine"}))
        return

    tmp = os.path.join(tempfile.gettempdir(), "jarvis-wpn.db")
    for suffix in ("", "-wal", "-shm"):
        src = DB + suffix
        if os.path.exists(src):
            try:
                shutil.copy2(src, tmp + suffix)
            except OSError:
                pass  # WAL may be locked; the main copy usually suffices

    con = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
    cur = con.cursor()

    apps = {}
    try:
        for rid, primary in cur.execute("SELECT RecordId, PrimaryId FROM NotificationHandler"):
            # "Microsoft.OutlookForWindows_8wekyb3d8bbwe!App" → readable name
            name = primary.split("_")[0].replace("Microsoft.", "").replace("ToastHandler", "")
            name = re.sub(r"(?<!^)(?=[A-Z])", " ", name).strip() or primary
            apps[rid] = name
    except sqlite3.Error:
        pass

    out = []
    try:
        rows = cur.execute(
            "SELECT n.HandlerId, n.ArrivalTime, n.Payload FROM Notification n "
            "ORDER BY n.ArrivalTime DESC LIMIT 400"
        ).fetchall()
    except sqlite3.Error as e:
        print(json.dumps({"notifications": [], "error": str(e)}))
        return

    for handler_id, arrival, payload in rows:
        if payload is None:
            continue
        xml = payload if isinstance(payload, str) else bytes(payload).decode("utf-8", "ignore")
        if not xml.lstrip().startswith("<toast"):
            continue  # badges and raw tiles are not notifications worth reading
        texts = [clean(t) for t in toast_texts(xml)]
        if not texts:
            continue
        out.append({
            "app": clean(apps.get(handler_id, "Windows")),
            "time": filetime_to_iso(arrival),
            "title": texts[0],
            "body": " — ".join(texts[1:])[:300] if len(texts) > 1 else "",
        })
        if len(out) >= LIMIT:
            break

    con.close()
    try:
        os.remove(tmp)
    except OSError:
        pass
    print(json.dumps({"notifications": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()