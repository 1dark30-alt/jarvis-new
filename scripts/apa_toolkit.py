#!/usr/bin/env python3
r"""
APA Scoresheet Toolkit
======================

For APA league operators. Takes the combined weekly "Digital Scoresheets" PDF
and does three jobs:

  1. FILE   - split it into one PDF per team, into <League folder>\<Division>\Week N\
  2. RED LINE - compare the two teams' copies of every match and work out the
                figures to keep
  3. ATTACH - add a red-line summary page to each team's sheet

Each match is filed twice, once per team, and the counting columns rarely agree.
The red line applies your league's rules (by default innings keep the LOWER of
the two figures and defensive shots the HIGHER) and prints anything it had to
reconcile in RED so it can be checked at a glance.

Nothing is ever overwritten: originals stay untouched and existing files are
skipped rather than replaced.

Requires: pdfplumber, pypdf, pymupdf   (bundled in the .exe build)
"""
from __future__ import annotations

import queue
import re
import sys
import threading
import traceback
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

APP_NAME = "APA Scoresheet Toolkit"
APP_VERSION = "1.5"


def _app_dir() -> Path:
    """Folder the app is running from (next to the .exe once frozen)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


# The Nexus typing helper is off unless a marker file sits beside the app.
# It automates the operator's own APA portal session, so it ships only in the
# personal copy - the version handed to other operators does not offer it.
NEXUS_ENTRY_ENABLED = (_app_dir() / "nexus-entry.enabled").exists()

# ── third-party -------------------------------------------------------------
MISSING: list[str] = []
try:
    import pdfplumber
except ImportError:
    MISSING.append("pdfplumber")
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    MISSING.append("pypdf")
try:
    import fitz  # PyMuPDF
except ImportError:
    MISSING.append("pymupdf")


# ═══════════════════════════════════════════════════════════════════════════
#  Reading a scoresheet
# ═══════════════════════════════════════════════════════════════════════════

# A player row: "01 Crystal Crawford 00184 2/2".  A long name runs straight into
# the member number with no space, an added player is prefixed "+", and a player
# with no established skill level shows a dash ("-/2") - all must still parse.
IDENT_RE = re.compile(
    r"^(?P<t>\d{2})\s+\+?\s*(?P<name>.*?)\s*(?P<mem>\d{5,6})\s+(?P<sl>[\d\-]+/\d+)(?:\s|$)")

SHEET_NAME_RE = re.compile(r"^\d{4,6} week \d+$", re.I)


@dataclass
class PlayerLine:
    slot: str
    name: str
    member: str
    sl_gmw: str
    DS: str = ""
    GW: str = ""
    MPE: str = ""
    OB: str = ""
    BR: str = ""
    S8: int = 0     # scratch on the 8
    E8: int = 0     # early 8

    @property
    def SL(self) -> str:
        return self.sl_gmw.split("/")[0] if "/" in self.sl_gmw else self.sl_gmw


@dataclass
class MatchLine:
    number: int
    INN: str = ""
    players: list[PlayerLine] = field(default_factory=list)


@dataclass
class Sheet:
    path: Path
    submitted_by: str = ""
    teams: list[str] = field(default_factory=list)
    division: str = ""
    week: str = ""
    home: str = ""
    away: str = ""
    # The rating this team gave its OPPONENT.
    sportsmanship_given: str = ""
    matches: list[MatchLine] = field(default_factory=list)
    error: str = ""


def _clean_name(name: str) -> str:
    for marker in ("ADDED ", "REMOVED ", "+ "):
        name = name.replace(marker, "")
    return name.strip()


def _rows(page, tol: float = 2.0):
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    rows: list[tuple[float, list]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for top, ws in rows:
            if abs(w["top"] - top) <= tol:
                ws.append(w)
                break
        else:
            rows.append((w["top"], [w]))
    return [(t, sorted(ws, key=lambda w: w["x0"])) for t, ws in rows]


def _identity_span(rows):
    """x-range of the "T# | Player Name | MEM# | SL/GMW" block.

    Read off the header row instead of hardcoded: the PLAYOFF scoresheet
    template is laid out about 35pt further left than the regular-season one
    (T# at x=34 rather than x=69).  Fixed bounds clipped the T# and the first
    name off every playoff row, so the sheet parsed as zero matches.
    """
    for top, ws in rows:
        sl = next((w for w in ws if w["text"].startswith("SL/GMW")), None)
        tn = next((w for w in ws if w["text"].startswith("T#")), None)
        if sl is None or tn is None:
            continue
        if not any(w["text"].startswith("MEM#") for w in ws):
            continue
        return tn["x0"] - 2.0, sl["x1"] + 10.0
    return 60.0, 208.0                      # regular-season layout


def _totals_columns(rows):
    """x positions of the totals grid, read from a header row containing 8BR."""
    for _, ws in rows:
        texts = [w["text"] for w in ws]
        if "8BR" not in texts or "GW" not in texts:
            continue
        gw_i = texts.index("GW")
        try:
            ds_i = max(i for i, t in enumerate(texts) if t == "DS" and i < gw_i)
            inn_i = max(i for i, t in enumerate(texts) if t == "INN" and i < ds_i)
        except ValueError:
            continue
        col = {"INN": ws[inn_i]["x0"], "DS": ws[ds_i]["x0"], "GW": ws[gw_i]["x0"]}
        for label in ("MPE", "8OB", "8BR"):
            if label in texts:
                col[label] = ws[texts.index(label)]["x0"]
        if len(col) == 6:
            return col
    return None


def _value_at(ws, x_centre: float, span: float = 11.0) -> str:
    hits = [w for w in ws if abs(w["x0"] - x_centre) <= span]
    if not hits:
        return ""
    return min(hits, key=lambda w: abs(w["x0"] - x_centre))["text"].strip()


def parse_sheet(path: Path, page_index: int = 0) -> Sheet:
    """
    Read one scoresheet page.

    The INN cell is MERGED across both players - innings are counted once per
    game - while DS, GW, MPE, 8OB and 8BR are per player. The totals grid is read
    by column position rather than by table cells, because a match running past
    three games wraps onto a second row of game grids.
    """
    sheet = Sheet(path=path)
    try:
        with pdfplumber.open(path) as pdf:
            page = pdf.pages[page_index]
            rows = _rows(page)
            text = page.extract_text() or ""
    except Exception as exc:
        sheet.error = f"could not open: {exc}"
        return sheet

    first = next((l.strip() for l in text.splitlines() if l.strip()), "")
    m = re.match(r"(.+?)\((\d+)\)", first)
    if m:
        sheet.submitted_by = f"{m.group(1).strip()} ({m.group(2)})"

    pair = re.search(r"^(.+?)\((\d+)\)\s+(.+?)\((\d+)\)$", text, re.M)
    if pair:
        sheet.teams = [f"{pair.group(1).strip()} ({pair.group(2)})",
                       f"{pair.group(3).strip()} ({pair.group(4)})"]

    for line in text.splitlines()[:6]:
        d = re.search(r"^(.*?)\s+Week (\d+) of (\d+)", line)
        if d:
            sheet.division = re.split(r"\s[^\w\s]\s", d.group(1).strip())[0].strip()
            sheet.week = d.group(2)
            break

    h = re.search(r"Home Team \((\d+)\)", text)
    a = re.search(r"Away Team \((\d+)\)", text)
    sheet.home = h.group(1) if h else ""
    sheet.away = a.group(1) if a else ""

    # Roster, used to repair names the match grid clips
    roster: dict[str, str] = {}
    for line in text.splitlines():
        for m3 in re.finditer(r"\b(\d{5,6})\s+([A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*)*)", line):
            roster.setdefault(m3.group(1), m3.group(2).strip())

    sp = re.search(r"Sportsmanship\s+Points:\s*(\d+)", text)
    sheet.sportsmanship_given = sp.group(1) if sp else ""

    cols = _totals_columns(rows)
    if not cols:
        sheet.error = "could not find the totals columns - is this a scoresheet?"
        return sheet

    id_left, id_right = _identity_span(rows)

    # S8 / E8 are drawn on their own little row about a point ABOVE the player
    # they belong to, in the game column where it happened.
    marks = [{"kind": w["text"], "top": top}
             for top, ws in rows for w in ws
             if w["text"] in ("S8", "E8") and w["x0"] > id_right]

    found = []
    for top, ws in rows:
        left = [w for w in ws if id_left <= w["x0"] < id_right]
        if not left:
            continue
        joined = " ".join(w["text"] for w in left).strip()
        mi = IDENT_RE.match(joined)
        if not mi:
            continue
        full = roster.get(mi.group("mem"), "")
        raw_name = mi.group("name").strip()
        found.append((top, ws, PlayerLine(
            slot=mi.group("t"),
            name=_clean_name(full if len(full) > len(raw_name) else raw_name),
            member=mi.group("mem"),
            sl_gmw=mi.group("sl"),
        )))

    found.sort(key=lambda t: t[0])
    for n, (pair_a, pair_b) in enumerate(zip(found[0::2], found[1::2]), start=1):
        match = MatchLine(number=n)
        inn_seen = []
        for top, ws, pl in (pair_a, pair_b):
            pl.DS = _value_at(ws, cols["DS"])
            pl.GW = _value_at(ws, cols["GW"])
            pl.MPE = _value_at(ws, cols["MPE"])
            pl.OB = _value_at(ws, cols["8OB"])
            pl.BR = _value_at(ws, cols["8BR"])
            own_inn = _value_at(ws, cols["INN"])
            if own_inn:
                inn_seen.append(own_inn)
            match.players.append(pl)
        if not inn_seen:                       # merged cell may land between rows
            for top, ws in rows:
                if pair_a[0] - 2 <= top <= pair_b[0] + 12:
                    v = _value_at(ws, cols["INN"])
                    if v.isdigit():
                        inn_seen.append(v)
                        break
        match.INN = inn_seen[0] if inn_seen else ""

        # Give each marker to whichever of the two players sits nearest below it
        lo, hi = pair_a[0] - 14, pair_b[0] + 14
        for mk in marks:
            if not (lo <= mk["top"] <= hi):
                continue
            idx = 0 if abs(pair_a[0] - mk["top"]) <= abs(pair_b[0] - mk["top"]) else 1
            setattr(match.players[idx], mk["kind"],
                    getattr(match.players[idx], mk["kind"]) + 1)

        sheet.matches.append(match)

    return sheet


# ═══════════════════════════════════════════════════════════════════════════
#  Red line
# ═══════════════════════════════════════════════════════════════════════════

def _num(v):
    try:
        return int(str(v).strip())
    except Exception:
        return None


@dataclass
class Rules:
    """
    Standard operating procedure for APA league operators: when the two teams'
    copies of a match disagree, innings take the LOWER figure and defensive
    shots the HIGHER. Fixed rather than configurable - it is the same for every
    league, and an operator quietly flipping it would corrupt their stats.
    """
    innings: str = "lower"
    defensive: str = "higher"

    def inn_pick(self, a, b):
        return min(a, b)

    def ds_pick(self, a, b):
        return max(a, b)


def source_sheets(folder: Path) -> list[Path]:
    """Only the filed per-team sheets - never this tool's own output."""
    return sorted(p for p in folder.glob("*.pdf") if SHEET_NAME_RE.match(p.stem))


def redline_folder(folder: Path, rules: Rules) -> list[dict]:
    """Pair up the two copies of every team match and reconcile them."""
    sheets = [parse_sheet(p) for p in source_sheets(folder)]
    sheets = [s for s in sheets if not s.error and s.matches]

    groups: dict[tuple, list[Sheet]] = {}
    for s in sheets:
        groups.setdefault(tuple(sorted(s.teams)), []).append(s)

    report = []
    for teams, copies in groups.items():
        entry = {"teams": list(teams), "copies": [c.path.name for c in copies],
                 "home": copies[0].home, "away": copies[0].away,
                 "division": copies[0].division, "week": copies[0].week,
                 "matches": [], "notes": [], "sportsmanship": {}}

        # A sheet's sportsmanship figure is the rating that team gave its
        # OPPONENT, so each team's score is read off the other team's copy.
        for sh in copies:
            m = re.match(r".+?\((\d+)\)", sh.submitted_by or "")
            rater = m.group(1) if m else ""
            nums = re.findall(r"\((\d+)\)", " ".join(sh.teams))
            rated = next((t for t in nums if t != rater), "")
            if rated and sh.sportsmanship_given:
                entry["sportsmanship"][rated] = sh.sportsmanship_given
        if len(copies) == 1:
            entry["notes"].append(
                f"only one copy on file ({copies[0].path.name}) - figures taken as-is")
        elif len(copies) > 2:
            entry["notes"].append(f"{len(copies)} copies found - using the first two")

        a = copies[0]
        b = copies[1] if len(copies) > 1 else None

        # The copies often number the matches differently, so pair by WHO PLAYED.
        b_by_players: dict[frozenset, MatchLine] = {}
        if b:
            for mtb in b.matches:
                b_by_players[frozenset(p.member for p in mtb.players)] = mtb

        for ma in a.matches:
            key = frozenset(p.member for p in ma.players)
            mb = b_by_players.get(key) if b else None
            if b and mb is None:
                entry["notes"].append(
                    f"match {ma.number} ({', '.join(p.name for p in ma.players)}) "
                    f"is not on {b.path.name} - not cross-checked")

            inn_a, inn_b = _num(ma.INN), _num(mb.INN) if mb else None
            if inn_a is not None and inn_b is not None:
                inn_final, inn_conf = rules.inn_pick(inn_a, inn_b), inn_a != inn_b
            else:
                inn_final = inn_a if inn_a is not None else inn_b
                inn_conf = False

            lag_conflict = bool(
                mb and len(ma.players) == len(mb.players) == 2
                and ma.players[0].member != mb.players[0].member)

            row = {"match": ma.number, "INN": inn_final if inn_final is not None else "",
                   "INN_copies": (inn_a, inn_b), "INN_conflict": inn_conf,
                   "lag_conflict": lag_conflict, "players": []}

            for pa in ma.players:
                pb = next((x for x in mb.players if x.member == pa.member), None) if mb else None

                def pick(attr, how):
                    va = _num(getattr(pa, attr))
                    vb = _num(getattr(pb, attr)) if pb else None
                    if va is None and vb is None:
                        return 0, False
                    if va is None:
                        return vb, False
                    if vb is None:
                        return va, False
                    return how(va, vb), va != vb

                ds, ds_conf = pick("DS", rules.ds_pick)
                gw, gw_conf = pick("GW", max)
                pts, pts_conf = pick("MPE", max)
                ob, ob_conf = pick("OB", max)
                br, br_conf = pick("BR", max)
                s8, s8_conf = pick("S8", max)
                e8, e8_conf = pick("E8", max)

                row["players"].append({
                    "slot": pa.slot, "name": pa.name, "member": pa.member,
                    "SL": pa.SL, "sl_gmw": pa.sl_gmw,
                    "DS": ds, "DS_copies": (_num(pa.DS), _num(pb.DS) if pb else None),
                    "DS_conflict": ds_conf,
                    "GW": gw, "GW_conflict": gw_conf,
                    "PTS": pts, "PTS_conflict": pts_conf,
                    "8OB": ob, "8OB_conflict": ob_conf,
                    "8BR": br, "8BR_conflict": br_conf,
                    "S8": s8, "S8_conflict": s8_conf,
                    "E8": e8, "E8_conflict": e8_conf,
                })
            # Rackless: the lag winner (listed first) took every game, so the
            # opponent never won one. Only the lag winner can do it - the lag
            # loser racks the opening game whatever happens after that.
            # The lag winner must also have WON the match: an unfinished match
            # (time limit, forfeit) can sit at 1-0 without being a sweep, which
            # shows up on playoff sheets. GMW is the games he needed.
            row["rackless"] = False
            if len(row["players"]) == 2:
                won = _num(row["players"][0]["GW"]) or 0
                lost = _num(row["players"][1]["GW"]) or 0
                try:
                    needed = int(row["players"][0]["sl_gmw"].split("/")[1])
                except (ValueError, IndexError, AttributeError):
                    needed = None
                row["rackless"] = (lost == 0 and needed is not None and won >= needed)

            entry["matches"].append(row)
        report.append(entry)
    return report


# ═══════════════════════════════════════════════════════════════════════════
#  Splitting the combined PDF
# ═══════════════════════════════════════════════════════════════════════════

def is_scoresheet_pdf(path: Path) -> bool:
    """Cheap first-page probe so unrelated PDFs are skipped quickly."""
    s = parse_sheet(path, 0)
    return bool(s.division and s.week and s.submitted_by)


def split_pdf(src: Path, league_root: Path, log) -> dict:
    """One single-page PDF per team, into <league>\\<Division>\\Week N\\."""
    reader = PdfReader(str(src))
    written = skipped = unreadable = 0
    weeks, divisions = set(), set()

    with pdfplumber.open(src) as pdf:
        pages = len(pdf.pages)

    for i in range(pages):
        s = parse_sheet(src, i)
        team = ""
        m = re.match(r".+?\((\d+)\)", s.submitted_by or "")
        if m:
            team = m.group(1)
        if not (team and s.division and s.week):
            unreadable += 1
            continue

        dest_dir = league_root / s.division / f"Week {s.week}"
        dest = dest_dir / f"{team} week {s.week}.pdf"
        weeks.add((s.division, s.week))
        divisions.add(s.division)

        if dest.exists():
            skipped += 1
            continue
        dest_dir.mkdir(parents=True, exist_ok=True)
        w = PdfWriter()
        w.add_page(reader.pages[i])
        with open(dest, "wb") as fh:
            w.write(fh)
        written += 1
        log(f"    filed  {s.division} / Week {s.week} / {dest.name}")

    return {"written": written, "skipped": skipped, "unreadable": unreadable,
            "weeks": sorted(weeks), "divisions": sorted(divisions), "pages": pages}


# ═══════════════════════════════════════════════════════════════════════════
#  The red-line page
# ═══════════════════════════════════════════════════════════════════════════

RED = (0.776, 0.157, 0.157)
INK = (0.10, 0.11, 0.10)
MUTED = (0.44, 0.47, 0.45)
HAIR = (0.85, 0.87, 0.85)
BAND = (0.945, 0.955, 0.945)

COLS = [("Match", 44, "l", 52), ("Player #", 100, "r", 46), ("S/L", 152, "r", 26),
        ("IN", 184, "r", 30), ("DS", 220, "r", 30), ("Wins", 256, "r", 34),
        ("PTS", 296, "r", 30), ("8OB", 332, "r", 32), ("B&R", 370, "r", 32),
        ("S8", 408, "r", 26), ("E8", 440, "r", 26), ("Player", 476, "l", 92)]


def _t(page, x, y, s, size=9, bold=False, color=INK, align="l", width=0):
    font = "hebo" if bold else "helv"
    s = str(s)
    if align == "r":
        x = x + width - fitz.get_text_length(s, fontname=font, fontsize=size)
    page.insert_text((x, y), s, fontname=font, fontsize=size, color=color)


def draw_redline_page(doc, entry: dict, rules: Rules) -> None:
    page = doc.new_page(width=612, height=792)
    y = 56
    _t(page, 44, y, "RED LINE", size=16, bold=True)
    _t(page, 122, y, f"{entry.get('division','')} · Week {entry.get('week','')}",
       size=11, color=MUTED)
    y += 18

    teams = list(entry["teams"])
    if entry.get("home") and len(teams) == 2 and entry["home"] in teams[1]:
        teams.reverse()
    _t(page, 44, y, " vs ".join(teams), size=11, bold=True)
    y += 14
    sp = entry.get("sportsmanship", {})
    sp_txt = ("   |   sportsmanship  " + "   ".join(
        f"{t} = {v}" for t, v in sorted(sp.items()))) if sp else ""
    _t(page, 44, y, f"home {entry.get('home','')} · visiting {entry.get('away','')}{sp_txt}",
       size=8.5, color=INK)
    y += 11
    _t(page, 44, y, f"copies: {', '.join(entry['copies'])}", size=8, color=MUTED)
    y += 18
    page.draw_line(fitz.Point(44, y), fitz.Point(568, y), color=HAIR, width=1)
    y += 14
    _t(page, 44, y, "Figures as entered in match input. Players are in scoresheet "
                    "order - the first player won the lag.", size=8.5, color=MUTED)
    y += 11
    _t(page, 44, y, f"RED = the two team copies disagreed - innings keep the "
                    f"{rules.innings} figure, defensive shots the {rules.defensive}.",
       size=8.5, color=RED)
    y += 18

    page.draw_rect(fitz.Rect(44, y - 9, 568, y + 5), color=None, fill=BAND)
    for label, x, align, w in COLS:
        _t(page, x, y, label.upper(), size=7.5, bold=True, color=MUTED, align=align, width=w)
    page.draw_line(fitz.Point(44, y + 5), fitz.Point(568, y + 5), color=HAIR, width=1)
    y += 20

    for mt in entry["matches"]:
        for j, p in enumerate(mt["players"]):
            if y > 736:
                page = doc.new_page(width=612, height=792)
                y = 56
            inn_red, ds_red = mt["INN_conflict"], p["DS_conflict"]
            sl = p["SL"] if p["SL"] not in ("-", "") else "-"
            lag = " !" if (mt.get("lag_conflict") and j == 0) else ""
            cells = [
                (f"Match {mt['match']}{lag}" if j == 0 else "", RED if lag else INK, j == 0),
                (p["member"], INK, False),
                (sl, RED if sl == "-" else INK, sl == "-"),
                (mt["INN"], RED if inn_red else INK, inn_red),
                (p["DS"], RED if ds_red else INK, ds_red),
                (p["GW"], INK, False), (p["PTS"], INK, False),
                (p["8OB"], INK, False), (p["8BR"], INK, False),
                (p.get("S8") or "·", RED if p.get("S8") else MUTED, bool(p.get("S8"))),
                (p.get("E8") or "·", RED if p.get("E8") else MUTED, bool(p.get("E8"))),
                (p["name"][:22], MUTED, False),
            ]
            for (label, x, align, w), (val, col, bold) in zip(COLS, cells):
                _t(page, x, y, val, size=9, bold=bold, color=col, align=align, width=w)
            y += 13
        if mt.get("rackless"):
            w = mt["players"][0]
            _t(page, 100, y - 3,
               f"RACKLESS — {_clean_name(w['name'])} won {w['GW']}-0 without ever racking",
               size=8, bold=True, color=RED)
            y += 11
        page.draw_line(fitz.Point(44, y - 8), fitz.Point(568, y - 8), color=HAIR, width=0.6)
        y += 4

    for note in entry["notes"][:2]:
        _t(page, 44, y + 6, "Note: " + note[:110], size=7.5, color=RED)
        y += 10

    y = max(y, 736)
    page.draw_line(fitz.Point(44, y), fitz.Point(568, y), color=HAIR, width=1)
    _t(page, 44, y + 12,
       f"Reconciled from both teams' filed sheets on {date.today():%d %b %Y}. "
       f"A red dash in S/L means no established skill level.", size=7.5, color=MUTED)


def attach_week(folder: Path, rules: Rules, log) -> int:
    report = redline_folder(folder, rules)
    made = 0
    for entry in report:
        for name in entry["copies"]:
            src = folder / name
            if not src.exists() or not SHEET_NAME_RE.match(src.stem):
                continue
            dest = src.with_name(f"{src.stem} redlined.pdf")
            doc = fitz.open(src)
            draw_redline_page(doc, entry, rules)
            doc.save(dest)
            doc.close()
            made += 1
            log(f"    attached  {dest.name}")
    return made


# ═══════════════════════════════════════════════════════════════════════════
#  Typing into Nexus match input
# ═══════════════════════════════════════════════════════════════════════════
#
#  The match input page assigns an explicit tab order that stops on exactly
#  four boxes per player:
#
#       Player #   ->   IN   ->   DS   ->   Wins   ->  (next player's row)
#
#  Skill level, PTS, 8OB and B&R are deliberately skipped (tabindex -1): Nexus
#  works PTS out itself, and the others are only touched as exceptions.
#
#  Every handler on those fields is plain client-side JavaScript - the team
#  roster is already in the page - so nothing has to be waited for between
#  keystrokes.

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004
    VK_TAB = 0x09

    ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

    class _KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                    ("dwExtraInfo", ULONG_PTR)]

    class _MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                    ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class _HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD),
                    ("wParamH", wintypes.WORD)]

    # MOUSEINPUT is the largest member; leaving it out makes the struct too
    # small and SendInput rejects every call on a size check.
    class _INPUTunion(ctypes.Union):
        _fields_ = [("mi", _MOUSEINPUT), ("ki", _KEYBDINPUT), ("hi", _HARDWAREINPUT)]

    class _INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("union", _INPUTunion)]

    _user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(_INPUT), ctypes.c_int)
    _user32.SendInput.restype = wintypes.UINT

    def _send(inputs: list) -> None:
        arr = (_INPUT * len(inputs))(*inputs)
        sent = _user32.SendInput(len(inputs), arr, ctypes.sizeof(_INPUT))
        if sent != len(inputs):
            raise OSError(f"SendInput sent {sent}/{len(inputs)} "
                          f"(error {ctypes.get_last_error()})")

    def _key_input(vk: int, scan: int, flags: int) -> _INPUT:
        inp = _INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki = _KEYBDINPUT(vk, scan, flags, 0, 0)
        return inp

    def _char_events(ch: str) -> list:
        return [_key_input(0, ord(ch), KEYEVENTF_UNICODE),
                _key_input(0, ord(ch), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)]

    def _vk_events(vk: int) -> list:
        return [_key_input(vk, 0, 0), _key_input(vk, 0, KEYEVENTF_KEYUP)]

    # Candidate hotkeys, tried in order. F9 alone is very often already taken
    # by something else on a busy machine (RegisterHotKey then fails with
    # ERROR_HOTKEY_ALREADY_REGISTERED, 1409), so there has to be a fallback.
    MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x0001, 0x0002, 0x0004, 0x4000
    HOTKEY_CANDIDATES = [
        (MOD_NOREPEAT, 0x78, "F9"),
        (MOD_NOREPEAT | MOD_CONTROL | MOD_SHIFT, 0x78, "Ctrl+Shift+F9"),
        (MOD_NOREPEAT, 0x77, "F8"),
        (MOD_NOREPEAT | MOD_CONTROL | MOD_SHIFT, 0x0D, "Ctrl+Shift+Enter"),
        (MOD_NOREPEAT | MOD_CONTROL | MOD_ALT, 0x20, "Ctrl+Alt+Space"),
        (MOD_NOREPEAT, 0x13, "Pause"),
    ]

    def foreground_window() -> int:
        return _user32.GetForegroundWindow()

    def focus_window(hwnd: int) -> bool:
        """Hand focus back to a window - allowed because we are foreground."""
        if not hwnd:
            return False
        try:
            _user32.ShowWindow(hwnd, 9)          # SW_RESTORE if minimised
            return bool(_user32.SetForegroundWindow(hwnd))
        except Exception:
            return False

    def type_row(values: list[str], delay: float = 0.012) -> None:
        """Type each value followed by Tab, into whatever has focus."""
        import time
        for val in values:
            for ch in str(val):
                _send(_char_events(ch))
                time.sleep(delay)
            _send(_vk_events(VK_TAB))
            time.sleep(delay * 3)   # let the field's onchange run

    KEYS_AVAILABLE = True
else:
    KEYS_AVAILABLE = False
    HOTKEY_CANDIDATES: list = []

    def foreground_window() -> int:
        return 0

    def focus_window(hwnd: int) -> bool:
        return False

    def type_row(values, delay=0.0):
        raise RuntimeError("Typing into Nexus is only supported on Windows.")


def entry_rows(entry: dict) -> list[dict]:
    """Flatten one team match into the rows Nexus asks for, in order."""
    rows = []
    for mt in entry["matches"]:
        for j, p in enumerate(mt["players"]):
            exceptions = []
            if str(p["8OB"]).isdigit() and int(p["8OB"]) > 0:
                exceptions.append(f"8OB={p['8OB']}")
            if str(p["8BR"]).isdigit() and int(p["8BR"]) > 0:
                exceptions.append(f"B&R={p['8BR']}")
            if p["SL"] in ("-", ""):
                exceptions.append("no S/L on sheet")
            rows.append({
                "match": mt["match"], "seat": j + 1,
                "member": p["member"], "name": p["name"], "SL": p["SL"],
                "IN": mt["INN"], "DS": p["DS"], "Wins": p["GW"],
                "PTS": p["PTS"], "8OB": p["8OB"], "8BR": p["8BR"],
                "reconciled": bool(mt["INN_conflict"] or p["DS_conflict"]),
                "exceptions": exceptions,
                "typed": [p["member"], mt["INN"], p["DS"], p["GW"]],
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
#  Patch list
# ═══════════════════════════════════════════════════════════════════════════

def _team_of(slot: str, teams: list[str]) -> tuple[str, str]:
    for t in teams:
        m = re.match(r"(.+?)\s*\((\d+)\)", t)
        if m and m.group(2).endswith(slot):
            return m.group(2), m.group(1).strip()
    return "", ""


def collect_patches(league_root: Path, rules: Rules):
    """
    Totals the three achievements worth a patch, by division -> team -> player:
        RACKLESS (lag winner swept), B&R (break and run), 8OB (eight on break)
    """
    from collections import defaultdict
    data: dict = defaultdict(lambda: defaultdict(dict))
    weeks: dict = defaultdict(set)

    divisions = [d for d in league_root.iterdir()
                 if d.is_dir() and not d.name.startswith(("_", "Weekly"))]
    for div in divisions:
        for wk_folder in sorted(div.glob("Week *")):
            if not wk_folder.is_dir() or not source_sheets(wk_folder):
                continue
            m = re.search(r"(\d+)", wk_folder.name)
            wk = int(m.group(1)) if m else 0
            weeks[div.name].add(wk)
            for entry in redline_folder(wk_folder, rules):
                for mt in entry["matches"]:
                    for i, p in enumerate(mt["players"]):
                        tno, tname = _team_of(p["slot"], entry["teams"])
                        if not tno:
                            continue
                        rec = data[div.name][(tno, tname)].setdefault(p["member"], {
                            "name": p["name"], "rackless": 0, "br": 0, "ob": 0,
                            "matches": 0, "weeks": []})
                        rec["matches"] += 1
                        br = _num(p["8BR"]) or 0
                        ob = _num(p["8OB"]) or 0
                        rl = 1 if (mt.get("rackless") and i == 0) else 0
                        rec["br"] += br
                        rec["ob"] += ob
                        rec["rackless"] += rl
                        if rl or br or ob:
                            bits = []
                            if rl:
                                bits.append("rackless")
                            if br:
                                bits.append(f"B&R x{br}" if br > 1 else "B&R")
                            if ob:
                                bits.append(f"8OB x{ob}" if ob > 1 else "8OB")
                            rec["weeks"].append(f"wk{wk} {'/'.join(bits)}")
    return data, weeks


def patch_lines(data, weeks) -> list[str]:
    out: list[str] = []
    g_rl = g_br = g_ob = 0
    for div in sorted(data):
        wks = sorted(weeks[div])
        span = f"weeks {wks[0]}-{wks[-1]}" if wks else ""
        out.append("=" * 70)
        out.append(f"{div.upper()}   ({span})")
        out.append("=" * 70)
        d_rl = d_br = d_ob = 0
        for (tno, tname) in sorted(data[div], key=lambda k: k[0]):
            players = data[div][(tno, tname)]
            earners = {m: r for m, r in players.items()
                       if r["rackless"] or r["br"] or r["ob"]}
            t_rl = sum(r["rackless"] for r in players.values())
            t_br = sum(r["br"] for r in players.values())
            t_ob = sum(r["ob"] for r in players.values())
            d_rl, d_br, d_ob = d_rl + t_rl, d_br + t_br, d_ob + t_ob
            if not earners:
                continue
            out.append("")
            out.append(f"  {tno}  {tname}")
            out.append(f"     {'Player #':<9} {'Player':<22} {'RACKLESS':>8} {'B&R':>5} {'8OB':>5}")
            out.append("     " + "-" * 53)
            for member, r in sorted(earners.items(), key=lambda kv: -(
                    kv[1]["rackless"] + kv[1]["br"] + kv[1]["ob"])):
                out.append(f"     {member:<9} {r['name'][:22]:<22} "
                           f"{r['rackless'] or '':>8} {r['br'] or '':>5} {r['ob'] or '':>5}")
                for w in r["weeks"]:
                    out.append(f"     {'':<9}   {w}")
            out.append(f"     {'':<9} {'TEAM TOTAL':<22} {t_rl:>8} {t_br:>5} {t_ob:>5}")
        out.append("")
        out.append(f"  {div} totals:  rackless {d_rl}   B&R {d_br}   8OB {d_ob}")
        out.append("")
        g_rl, g_br, g_ob = g_rl + d_rl, g_br + d_br, g_ob + d_ob
    out.append("=" * 70)
    out.append(f"SESSION TOTALS:  rackless {g_rl}   break and run {g_br}   "
               f"8 on the break {g_ob}")
    out.append(f"patches to order: {g_rl + g_br + g_ob}")
    return out


def _ascii(s: str) -> str:
    """Built-in PDF fonts have no curly quotes or long dashes."""
    for bad, good in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'),
                      ("—", "-"), ("–", "-"), ("·", "-")):
        s = s.replace(bad, good)
    return s


def write_patch_outputs(data, weeks, lines, league_root: Path) -> list[Path]:
    import csv
    made = []

    dest = league_root / "patch list.csv"
    with open(dest, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Division", "Team #", "Team", "Player #", "Player",
                    "Rackless", "B&R", "8 on Break", "Total patches",
                    "Matches played", "Detail"])
        for div in sorted(data):
            for (tno, tname) in sorted(data[div], key=lambda k: k[0]):
                for member, r in sorted(data[div][(tno, tname)].items()):
                    total = r["rackless"] + r["br"] + r["ob"]
                    if not total:
                        continue
                    w.writerow([div, tno, tname, member, r["name"],
                                r["rackless"] or "", r["br"] or "", r["ob"] or "",
                                total, r["matches"], "; ".join(r["weeks"])])
    made.append(dest)

    pdf = league_root / "patch list.pdf"
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    y = 56
    page.insert_text((44, y), "PATCH LIST", fontname="hebo", fontsize=16, color=INK)
    page.insert_text((146, y), f"{league_root.name} · {date.today():%d %b %Y}",
                     fontname="helv", fontsize=11, color=MUTED)
    y += 24
    for line in lines:
        if y > 752:
            page = doc.new_page(width=612, height=792)
            y = 56
        bold = line.isupper() or line.strip().startswith("SESSION")
        colour = RED if ("TOTAL" in line or "totals" in line) else INK
        page.insert_text((44, y), _ascii(line)[:104], fontsize=8,
                         fontname="hebo" if bold else "cour", color=colour)
        y += 10.5
    doc.save(pdf)
    doc.close()
    made.append(pdf)
    return made


def week_folders(root: Path) -> list[Path]:
    """Every 'Week N' folder under root that holds filed sheets."""
    out = []
    if not root.is_dir():
        return out
    if source_sheets(root):
        return [root]
    for sub in sorted(root.rglob("Week *")):
        if sub.is_dir() and source_sheets(sub):
            out.append(sub)
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  GUI
# ═══════════════════════════════════════════════════════════════════════════

def run_gui() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title(f"{APP_NAME} {APP_VERSION}")
    root.geometry("820x640")
    root.minsize(720, 560)

    msgs: "queue.Queue[tuple[str,str]]" = queue.Queue()
    busy = tk.BooleanVar(value=False)

    pdf_var = tk.StringVar()
    league_var = tk.StringVar()
    do_split = tk.BooleanVar(value=True)
    do_attach = tk.BooleanVar(value=True)
    do_patches = tk.BooleanVar(value=True)
    inn_rule = tk.StringVar(value="lower")
    ds_rule = tk.StringVar(value="higher")

    pad = {"padx": 12, "pady": 6}
    frm = ttk.Frame(root, padding=14)
    frm.pack(fill="both", expand=True)
    frm.columnconfigure(1, weight=1)

    ttk.Label(frm, text=APP_NAME, font=("Segoe UI", 15, "bold")).grid(
        row=0, column=0, columnspan=3, sticky="w")
    ttk.Label(frm, foreground="#555",
              text="File the weekly scoresheets by team, reconcile both copies, "
                   "and attach a red-line page.").grid(
        row=1, column=0, columnspan=3, sticky="w", pady=(0, 12))

    # Step 1
    ttk.Label(frm, text="1.  Combined scoresheet PDF").grid(row=2, column=0, sticky="w", **pad)
    ttk.Entry(frm, textvariable=pdf_var).grid(row=2, column=1, sticky="ew", **pad)

    def browse_pdf():
        p = filedialog.askopenfilename(title="Select the combined scoresheets PDF",
                                       filetypes=[("PDF files", "*.pdf")])
        if p:
            pdf_var.set(p)
            if not league_var.get():
                league_var.set(str(Path(p).parent))
    ttk.Button(frm, text="Browse…", command=browse_pdf).grid(row=2, column=2, **pad)

    # Step 2
    ttk.Label(frm, text="2.  League folder").grid(row=3, column=0, sticky="w", **pad)
    ttk.Entry(frm, textvariable=league_var).grid(row=3, column=1, sticky="ew", **pad)

    def browse_dir():
        p = filedialog.askdirectory(title="Where should the sheets be filed?")
        if p:
            league_var.set(p)
    ttk.Button(frm, text="Browse…", command=browse_dir).grid(row=3, column=2, **pad)

    ttk.Label(frm, foreground="#777", font=("Segoe UI", 8),
              text="Division and week folders are created here automatically. "
                   "Leave the PDF blank to just red-line sheets already filed.").grid(
        row=4, column=1, sticky="w", padx=12)

    # Options
    opts = ttk.LabelFrame(frm, text="Options", padding=10)
    opts.grid(row=5, column=0, columnspan=3, sticky="ew", padx=12, pady=(14, 6))
    ttk.Checkbutton(opts, text="Split the PDF into per-team sheets",
                    variable=do_split).grid(row=0, column=0, sticky="w", columnspan=4)
    ttk.Checkbutton(opts, text="Attach a red-line page to each sheet",
                    variable=do_attach).grid(row=1, column=0, sticky="w", columnspan=4)
    ttk.Checkbutton(opts, text="Build the patch list (rackless, B&R, 8 on the break)",
                    variable=do_patches).grid(row=2, column=0, sticky="w", columnspan=4)
    ttk.Label(opts, text="When the two copies disagree (standard APA practice):",
              foreground="#555").grid(row=3, column=0, sticky="w",
                                      columnspan=4, pady=(10, 2))
    ttk.Label(opts, text="innings keep the LOWER figure  ·  "
                         "defensive shots keep the HIGHER",
              font=("Segoe UI", 9, "bold")).grid(row=4, column=0, sticky="w",
                                                 columnspan=4)

    # Log
    log_frame = ttk.LabelFrame(frm, text="Progress", padding=6)
    log_frame.grid(row=6, column=0, columnspan=3, sticky="nsew", padx=12, pady=6)
    frm.rowconfigure(6, weight=1)
    log_frame.rowconfigure(0, weight=1)
    log_frame.columnconfigure(0, weight=1)
    txt = tk.Text(log_frame, height=14, wrap="word", font=("Consolas", 9),
                  background="#FBFBF9", relief="flat")
    txt.grid(row=0, column=0, sticky="nsew")
    sb = ttk.Scrollbar(log_frame, command=txt.yview)
    sb.grid(row=0, column=1, sticky="ns")
    txt.configure(yscrollcommand=sb.set, state="disabled")
    txt.tag_configure("err", foreground="#C62828")
    txt.tag_configure("ok", foreground="#1B6B47")
    txt.tag_configure("head", font=("Consolas", 9, "bold"))

    status = ttk.Label(frm, text="Ready", foreground="#555")
    status.grid(row=8, column=0, columnspan=2, sticky="w", padx=12, pady=(4, 0))

    def put(text: str, tag: str = "") -> None:
        msgs.put((text, tag))

    def drain() -> None:
        try:
            while True:
                text, tag = msgs.get_nowait()
                txt.configure(state="normal")
                txt.insert("end", text + "\n", tag or ())
                txt.see("end")
                txt.configure(state="disabled")
        except queue.Empty:
            pass
        root.after(120, drain)

    def work() -> None:
        try:
            rules = Rules(innings=inn_rule.get(), defensive=ds_rule.get())
            league = Path(league_var.get()).expanduser()
            pdf = Path(pdf_var.get()).expanduser() if pdf_var.get().strip() else None

            if not league_var.get().strip():
                put("Choose a league folder first.", "err")
                return
            league.mkdir(parents=True, exist_ok=True)

            touched: list[Path] = []

            if pdf and do_split.get():
                if not pdf.exists():
                    put(f"Not found: {pdf}", "err")
                    return
                put(f"Reading {pdf.name}…", "head")
                if not is_scoresheet_pdf(pdf):
                    put("That does not look like an APA scoresheet PDF.", "err")
                    return
                res = split_pdf(pdf, league, put)
                put(f"  {res['written']} sheet(s) filed, {res['skipped']} already "
                    f"present, {res['pages']} page(s) read.", "ok")
                if res["unreadable"]:
                    put(f"  {res['unreadable']} page(s) could not be read.", "err")
                for div, wk in res["weeks"]:
                    f = league / div / f"Week {wk}"
                    if f not in touched:
                        touched.append(f)

            if not touched:
                touched = week_folders(league)

            if not touched:
                put("No filed sheets found to red-line.", "err")
                return

            if do_attach.get():
                put("")
                put("Red-lining and attaching…", "head")
                total = 0
                for folder in touched:
                    report = redline_folder(folder, rules)
                    recon = sum(
                        (1 if mt["INN_conflict"] else 0)
                        + sum(1 for p in mt["players"] if p["DS_conflict"])
                        for e in report for mt in e["matches"])
                    made = attach_week(folder, rules, put)
                    total += made
                    put(f"  {folder.parent.name} / {folder.name}: {made} sheet(s), "
                        f"{recon} figure(s) reconciled.", "ok")
                    for e in report:
                        for note in e["notes"]:
                            put(f"    note: {note}", "err")
                put("")
                put(f"{total} sheet(s) now carry a red-line page.", "ok")

            if do_patches.get():
                put("")
                put("Building the patch list…", "head")
                data, wks = collect_patches(league, rules)
                lines = patch_lines(data, wks)
                made = write_patch_outputs(data, wks, lines, league)
                for line in lines[-3:]:
                    put("  " + line.strip(), "ok")
                for f in made:
                    put(f"  written: {f.name}", "ok")

            put("")
            put("Finished.", "ok")

        except Exception as exc:
            put("")
            put(f"Something went wrong: {exc}", "err")
            put(traceback.format_exc(), "err")
        finally:
            busy.set(False)
            root.after(0, lambda: (run_btn.configure(state="normal"),
                                   status.configure(text="Ready")))

    def start() -> None:
        if busy.get():
            return
        if MISSING:
            messagebox.showerror(APP_NAME, "Missing components: " + ", ".join(MISSING))
            return
        busy.set(True)
        run_btn.configure(state="disabled")
        status.configure(text="Working…")
        txt.configure(state="normal")
        txt.delete("1.0", "end")
        txt.configure(state="disabled")
        threading.Thread(target=work, daemon=True).start()

    def open_helper():
        if not league_var.get().strip():
            messagebox.showinfo(APP_NAME, "Choose your league folder first.")
            return
        open_nexus_helper(root, Path(league_var.get()).expanduser())

    btn_row = ttk.Frame(frm)
    btn_row.grid(row=8, column=2, sticky="e", padx=12, pady=(4, 0))
    if NEXUS_ENTRY_ENABLED:
        ttk.Button(btn_row, text="Type into Nexus…",
                   command=open_helper).pack(side="left", padx=(0, 6))
    run_btn = ttk.Button(btn_row, text="Run", command=start)
    run_btn.pack(side="left")

    ttk.Label(frm, foreground="#777", font=("Segoe UI", 8),
              text="Originals are never changed. Red-lined copies are saved "
                   "alongside them as “… redlined.pdf”.").grid(
        row=7, column=0, columnspan=3, sticky="w", padx=12)

    if MISSING:
        put("Missing components: " + ", ".join(MISSING), "err")
        put("Install with:  pip install " + " ".join(MISSING), "err")
    else:
        put(f"{APP_NAME} {APP_VERSION} ready.", "head")
        put("Choose the combined scoresheets PDF and a league folder, then press Run.")

    drain()
    root.mainloop()


def open_nexus_helper(parent, league_folder: Path) -> None:
    """
    A small always-on-top list of the rows to key into Nexus.

    Click into the Player # box on the Nexus page, then press F9. One row is
    typed and the list advances, so the whole match is F9 ten times. Focus
    never leaves the browser - that is why a global hotkey is used rather than
    a button.
    """
    import tkinter as tk
    from tkinter import ttk, messagebox

    folders = week_folders(league_folder)
    if not folders:
        messagebox.showwarning(APP_NAME, "No filed sheets found in that league folder.")
        return

    win = tk.Toplevel(parent)
    win.title("Type into Nexus")
    win.geometry("560x560")
    win.attributes("-topmost", True)

    rules = Rules()
    state = {"rows": [], "idx": 0}

    top = ttk.Frame(win, padding=10)
    top.pack(fill="x")
    ttk.Label(top, text="Week").grid(row=0, column=0, sticky="w")
    week_cb = ttk.Combobox(top, state="readonly", width=34,
                           values=[f"{f.parent.name} — {f.name}" for f in folders])
    week_cb.grid(row=0, column=1, sticky="ew", padx=6)
    ttk.Label(top, text="Team match").grid(row=1, column=0, sticky="w", pady=(6, 0))
    tm_cb = ttk.Combobox(top, state="readonly", width=34)
    tm_cb.grid(row=1, column=1, sticky="ew", padx=6, pady=(6, 0))
    top.columnconfigure(1, weight=1)

    lst = tk.Listbox(win, font=("Consolas", 10), activestyle="none")
    lst.pack(fill="both", expand=True, padx=10, pady=8)

    hint = ttk.Label(win, foreground="#555", wraplength=520, justify="left",
                     text="Click into the Player # box for the highlighted row in Nexus, "
                          "then press F9. Each press types Player #, IN, DS and Wins, "
                          "then tabs to the next row.")
    hint.pack(fill="x", padx=10)
    status = ttk.Label(win, text="", foreground="#1B6B47")
    status.pack(fill="x", padx=10, pady=(4, 10))

    reports: dict[str, list] = {}

    def load_week(*_):
        folder = folders[week_cb.current()]
        key = str(folder)
        if key not in reports:
            reports[key] = redline_folder(folder, rules)
        tm_cb["values"] = [" vs ".join(e["teams"]) for e in reports[key]]
        if tm_cb["values"]:
            tm_cb.current(0)
            load_match()

    def load_match(*_):
        folder = folders[week_cb.current()]
        entry = reports[str(folder)][tm_cb.current()]
        state["rows"] = entry_rows(entry)
        state["idx"] = 0
        refresh()

    def refresh():
        lst.delete(0, "end")
        for i, r in enumerate(state["rows"]):
            mark = "▶" if i == state["idx"] else " "
            flag = "  ⚠ " + ", ".join(r["exceptions"]) if r["exceptions"] else ""
            star = "*" if r["reconciled"] else " "
            lst.insert("end", f"{mark} M{r['match']}  {r['member']:>6}  IN {str(r['IN']):>3}  "
                              f"DS {str(r['DS']):>3}  W {str(r['Wins']):>2} {star}  "
                              f"{r['name'][:18]}{flag}")
            if r["exceptions"]:
                lst.itemconfig(i, foreground="#C62828")
            elif r["reconciled"]:
                lst.itemconfig(i, foreground="#0B6BCB")
        if state["idx"] < len(state["rows"]):
            lst.selection_clear(0, "end")
            lst.selection_set(state["idx"])
            lst.see(state["idx"])
            status.configure(text=f"Row {state['idx'] + 1} of {len(state['rows'])} — press F9 to type it")
        else:
            status.configure(text="All rows typed. Check the page, then submit in Nexus.")

    def type_current(from_button: bool = False):
        if state["idx"] >= len(state["rows"]):
            return
        row = state["rows"][state["idx"]]
        # Clicking the button puts focus on this window, so hand it back to
        # whatever was in front before typing - otherwise the keystrokes land
        # in the helper instead of the browser.
        if from_button:
            target = state.get("last_hwnd")
            if not target:
                status.configure(
                    text="Click the Nexus field once first, then press this button.",
                    foreground="#C62828")
                return
            focus_window(target)
            time.sleep(0.25)
        try:
            type_row(row["typed"])
        except Exception as exc:
            status.configure(text=f"Could not type: {exc}", foreground="#C62828")
            return
        if row["exceptions"]:
            status.configure(text="Typed — now enter " + ", ".join(row["exceptions"])
                                  + " by hand", foreground="#C62828")
        state["idx"] += 1
        refresh()

    def skip():
        state["idx"] = min(state["idx"] + 1, len(state["rows"]))
        refresh()

    def back():
        state["idx"] = max(state["idx"] - 1, 0)
        refresh()

    btns = ttk.Frame(win, padding=(10, 0, 10, 10))
    btns.pack(fill="x")
    ttk.Button(btns, text="◀ Back", command=back).pack(side="left")
    ttk.Button(btns, text="Skip ▶", command=skip).pack(side="left", padx=6)
    type_btn = ttk.Button(btns, text="Type this row",
                          command=lambda: type_current(from_button=True))
    type_btn.pack(side="right")

    week_cb.bind("<<ComboboxSelected>>", load_week)
    tm_cb.bind("<<ComboboxSelected>>", load_match)
    if folders:
        week_cb.current(len(folders) - 1)
        load_week()

    # Remember which window was in front before this helper took focus, so the
    # button can hand focus back to the browser before typing.
    def track_foreground():
        if not win.winfo_exists():
            return
        try:
            hwnd = foreground_window()
            mine = int(win.winfo_id())
            root_mine = int(parent.winfo_id())
            if hwnd and hwnd not in (mine, root_mine):
                # walk up: winfo_id is a child HWND, so compare owning windows
                state["last_hwnd"] = hwnd
        except Exception:
            pass
        win.after(400, track_foreground)

    stop = threading.Event()
    if sys.platform == "win32":
        def hotkey_loop():
            WM_HOTKEY = 0x0312
            chosen = None
            for i, (mods, vk, label) in enumerate(HOTKEY_CANDIDATES, start=1):
                if _user32.RegisterHotKey(None, i, mods, vk):
                    chosen = (i, label)
                    break
            if chosen is None:
                parent.after(0, lambda: hint.configure(
                    foreground="#C62828",
                    text="No hotkey was available on this PC. Click into the Nexus "
                         "Player # box, then press “Type this row” — focus is handed "
                         "back to the browser automatically."))
                return

            hk_id, label = chosen
            parent.after(0, lambda: hint.configure(
                foreground="#1B6B47",
                text=f"Click into the Player # box in Nexus, then press {label}. "
                     f"Each press types Player #, IN, DS and Wins and tabs on. "
                     f"(The “Type this row” button works too.)"))
            msg = wintypes.MSG()
            try:
                while not stop.is_set():
                    if _user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
                        if msg.message == WM_HOTKEY:
                            parent.after(0, lambda: type_current(False))
                    stop.wait(0.03)
            finally:
                _user32.UnregisterHotKey(None, hk_id)

        threading.Thread(target=hotkey_loop, daemon=True).start()
        track_foreground()

    def on_close():
        stop.set()
        win.destroy()
    win.protocol("WM_DELETE_WINDOW", on_close)


def run_cli(argv: list[str]) -> int:
    """Headless mode:  apa_toolkit.py --cli <combined.pdf> <league folder>"""
    args = [a for a in argv if not a.startswith("--")]
    if len(args) < 2:
        print("Usage: apa_toolkit.py --cli <combined.pdf> <league folder>")
        return 2
    pdf, league = Path(args[0]), Path(args[1])
    rules = Rules()
    league.mkdir(parents=True, exist_ok=True)
    res = split_pdf(pdf, league, lambda s: print(s))
    print(f"{res['written']} filed, {res['skipped']} already present")
    total = 0
    for div, wk in res["weeks"]:
        total += attach_week(league / div / f"Week {wk}", rules, lambda s: print(s))
    print(f"{total} sheet(s) red-lined")

    data, wks = collect_patches(league, rules)
    lines = patch_lines(data, wks)
    for f in write_patch_outputs(data, wks, lines, league):
        print(f"written: {f.name}")
    print("\n".join(lines[-2:]))
    return 0


if __name__ == "__main__":
    if "--cli" in sys.argv:
        raise SystemExit(run_cli(sys.argv[1:]))
    run_gui()
