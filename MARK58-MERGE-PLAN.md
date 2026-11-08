# Mark 58 → Jarvis-new Merge Plan

**Goal:** bring Mark 58's capabilities into jarvis-new — the best of both — while keeping
the jarvis-new interface (Next.js + Electron HUD, radial nav, voice tools, MCP/skills).

**Approach:** never port PyQt GUI code. Port each capability as one of jarvis-new's
existing patterns:

| Mark 58 construct | jarvis-new equivalent |
|---|---|
| `actions/*.py` voice actions | `app/lib/functions.ts` FUNCTION_REGISTRY tools |
| Panels / live panels (PyQt) | Pages (`app/components/pages/`) + HUD widgets |
| Background daemons / routines | Next API routes + server-side schedulers (`app/api/...`) |
| Gemini ladder (`core/gemini.py`) | Existing model settings / providers in jarvis-new |
| Plugin cores (`plugins/_*.py`) | TypeScript ports or static apps in `public/apps/` |

---

## Capability map

### Already covered in jarvis-new (no work needed)
| Mark 58 | jarvis-new |
|---|---|
| Live voice engine, interruption | ElevenLabs `Conversation` real-time voice |
| Wake word ("Hey Jarvis", local) | Picovoice wake word (`dist-electron/wake-word.js`) |
| Computer control / open apps | `computer_use` tool + `run_shell_command` + `app/api/shell` |
| Web search (with grounding quota guard) | `web_search` tool |
| Weather, date/time, location, battery | Existing tools |
| Reminders & timers | `set_reminder`, `set_timer` |
| Calendar | `calendar_command` + Calendar page |
| Screen capture / analysis | `take_photo`, `xray`, screen APIs |
| Music control (system media session) | `control_music` / `get_now_playing` |
| Smart home (HA) | `home_assistant_command` + Home Assistant page |
| 3D printing | `printer_command` + Printers page |
| Image generation | `image_generation` tool |
| HUD widgets / control center | HUDLayer + widgets |
| Plugin/skill system | `jarvis-skills.config.json` + MCP manager |

### NEWLY PORTED (already done in this workspace)
| Mark 58 / Jarvis-system | Status |
|---|---|
| Bounty Hunter dashboard | ✅ App page (`bounty-hunter`) |
| Wildcard Draw | ✅ App page (`wildcard-draw`) |
| God's Eye View (Mark 57 plugin) | ✅ App page + on-demand Vite service |
| Disk Map (`_disk_map_core.py`) | ✅ Web port: `/api/disk-map` + DiskMapPage treemap |
| Build Guide diagram engine (`_build_diagram.py`) | ✅ TS port: `buildDiagram.ts` + `build_guide` tool + page |

### Gap analysis — Mark 58 capabilities NOT yet in jarvis-new

**Tier 1 — signature Mark 58 capabilities (high value, big effort)**
1. **Missions** — background agents that keep working while you talk ("research this for
   ten minutes"), with a plan-review approval gate (model proposes, never approves its own
   desktop plan). Core: `core/missions.py`, `actions/mission_control.py`, `actions/background_tasks.py`.
2. **Routine engine** — one voice-managed scheduler replacing hand-written schedules:
   briefing, news watch, check-ins, reminders, quiet hours ("don't talk to me between
   23:00 and 07:00"). Core: `actions/routines.py`, `actions/proactive.py`, `core/routines/`.
3. **Projects + long-term memory** — project workspaces with recallable memory (no size
   limit; overflow looked up from local search), memory panel with delete. Core:
   `actions/project_workspace.py`, `memory/`, `core/skill_store.py`.
4. **Undo** — take back what the assistant did (files moved/renamed/created/written,
   settings changed). Core: `core/undo.py` (121 lines — small, portable).

**Tier 2 — strong additions**
5. **Developer mode** — local analysis/tests/lint/profile/Git jobs with review + outputs
   (`core/developer.py`, docs phase 10).
6. **System monitor + health** — platform health panel, `actions/system_monitor.py`,
   `actions/platform_health.py` (jarvis-new has `system-diagnostics` API — extend it).
7. **Tuya / Smart Life LAN adapter** — direct-LAN device control, typed write allowlist,
   DPAPI-encrypted keys (`actions/tuya_home.py`, `core/tuya_home.py`).
8. **Screen eyes / screen agent** — continuous screen understanding loop
   (`plugins/_screen_eyes.py`, `_screen_loop.py`, `plugins/screen_agent.py`).

**Tier 3 — plugin ports (medium effort each)**
9. Market analyzer (`_market_engine.py` + `_market_ui.py`, ~1000+ lines)
10. Network radar (`_network_radar_core.py`)
11. Gmail control, Excel writer, document review
12. Quiz, pomodoro, spaced repetition, shopping list, water/calorie reminders
13. Telegram remote, WhatsApp call/guard, Discord hardened
14. Obsidian vault, game updater, chat takeover, cloud agent
15. Aircraft report, planet watch (partially superseded by God's Eye)

**Tier 4 — infrastructure (optional)**
16. Cloud server + dashboard clients (`core/cloud.py`, `dashboard/`)
17. Local skill store with version history/rollback (jarvis-new already has a skills
    config — decide whether to extend it instead)
18. Cinematic avatar (3D reactor, visemes, facial acting) — jarvis-new has its own HUD
    identity; porting Mark's avatar would clash visually. **Recommend: skip** unless wanted.

---

## Proposed phases

- **Phase 1 — Foundation: ✅ DONE** — Undo journal (disk-backed, trash-protected
  deletes, shell capture) + routine engine (server-side, poll protocol) +
  `routine_command` / `undo_command` voice tools + RoutineAgent client bridge
  delivering via `jarvis:announce` and HUD toasts. Also fixed a pre-existing
  shell-route bug: quoted paths were mangled by Node→cmd.exe escaping.
- **Phase 2 — Missions: ✅ DONE (research + general agents)** — server-side mission
  runner (`app/lib/server/missions.ts`) with the staged research pipeline
  (PLAN → INVESTIGATE → REVIEW → WRITE), code-verified quotes, runner-numbered
  citations, crash-resume per step, budget in minutes; general agent with
  search/fetch tool loop; completion notices announced via the routine
  heartbeat; Missions page; `background_tasks` voice tool. Verified live:
  research mission ran the full pipeline and the report refused to go beyond
  its verified findings.
- **Phase 3 — Memory & Projects: ✅ DONE** — `app/lib/server/memoryStore.ts` (port of
  memory_manager.py): six categories, two-budget design (200 KB runaway guard vs
  900-char prompt core), prompt block = identity in full + most recent facts +
  **key index of everything else** (so recall is a lookup, not a gamble),
  recency-ranked search; project workspaces with isolated facts and active
  project riding in context; `/api/memory`; injected into both OpenAI-realtime
  and ElevenLabs session instructions; `memory_command` + `project_workspace`
  voice tools; Memory panel page with one-click delete + project create/select/delete.
  Verified live incl. a found-and-fixed scope-isolation bug.
- **Gemini core (new, user-directed): ✅ DONE** — `app/lib/server/geminiLadder.ts`
  (port of core/gemini.py text core: FAST/SMART/SEARCH tiers, measured model
  order, quota cooldowns, "prov:" provider rungs, local-LLM fallback);
  wired as the preferred brain for missions/agents with the local model as
  fallback; Gemini Live voice engine (`app/lib/geminiLive.ts` + PCM worklet)
  as a 4th voice mode in Settings with the voice-model ladder (3.1-flash-live
  → native-audio → 2.0-flash-live), full tool calling, interruption handling;
  Settings gains a Gemini key field + provider override + provider-first toggle.
  All previous engines (OpenAI Realtime, ElevenLabs, local voice) remain selectable.
- **Phase 4 — Tier 2: ✅ MOSTLY DONE** — Developer Mode (`/api/dev-jobs` + page +
  `dev_command`: analyze/typecheck/build/deps/git jobs, allowlisted + bounded),
  Health (`/api/health` + live-gauge page + `health_command`: CPU/mem/disk,
  Gemini ladder armed, local model reachability, store integrity),
  Screen Eyes (`/api/screen-eyes` + `screen_eyes` tool: screenshot → Gemini
  vision on the ladder — verified live). Deferred: Tuya LAN (needs real devices
  + local keys — build when hardware is confirmed); numbered-box click geometry
  for screen eyes (computer_use covers acting today).
- **Phase 5 — Tier 3 plugins: Batch A ✅ DONE** — Excel Writer (`/api/excel` +
  `excel_writer`: spec → real .xlsx on Desktop, bold headers, typed cells,
  live SUM row — verified), Document Review (`/api/document-review` +
  `document_review`: pdf/docx/txt → ladder SMART review quoting the document
  — verified on a contract), Obsidian Vault (`/api/obsidian` +
  `obsidian_vault`: set_path/list/search/read/create/append with
  vault-escape protection — verified), Market Analyzer (`/api/market` +
  `market_analyzer` + Market page: Yahoo candles, SMA20/50, annualised vol,
  and the original's deterministic position() sizing — verified: 20 shares,
  3R, +$300/−$100). Batch B (bigger ports, next sessions): Screen Agent
  (numbered-box loop), Network Radar (2.9k-line core), Planet Watch
  (overlaps God's Eye), Notification Integration (Windows history).
- **Phase 5 — Batch B: ✅ DONE** — Screen Agent (`/api/screen-agent` +
  `screen_agent`: look→decide→act loop via vision ladder + pyautogui
  actuator in 0-1000 normalised space, step cap, no-passwords guard —
  verified: identified the focused app in 1 step, 12 s), Network Radar
  (`/api/network-radar` + `network_radar` + radar page: ARP + ping sweep,
  OUI vendors, known-device memory with NEW badges — verified 28 devices,
  one NEW — plus gateway/internet latency), Notification Integration
  (`/api/notifications` + `notifications_command`: reads the real
  wpndatabase via a sandboxed python reader — verified live Outlook/Phone
  Link toasts with timestamps; FILETIME conversion fixed). Deferred:
  numbered-box overlay for the agent (v2 upgrade), Planet Watch
  (superseded by God's Eye), Pomodoro (offered, awaiting user request).

## Already completed (Tier 0)
Bounty Hunter, Wildcard Draw, God's Eye, Disk Map, Build Guide — all live as apps.

## Decisions needed from you
1. Start order: recommend **Phase 1 → 2 → 3**, then plugins by your priority.
2. Avatar: port Mark's cinematic reactor face, or keep jarvis-new's own HUD identity?
3. Skill store: extend jarvis-new's existing `jarvis-skills.config.json` system rather
   than porting Mark's separate store? (Recommended: extend.)
