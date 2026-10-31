#!/usr/bin/env python3
"""build_level2_table.py — renders the PROPOSED three-level journey catalogue as review tables.

Inputs  journeys/level2_journeys.json           (catalogue written by make_level2_catalogue.py)
        generator/source/tests/v9_data.json     (level-1 master stages + sub-states, generator titles/recipients/states)
        build_committee_register.py             (committee rows: code, area, recipient — definitions part only)
Outputs journeys/LEVEL2_JOURNEYS_PROPOSED.md    (review document)
        journeys/LEVEL2_JOURNEYS_PROPOSED.csv   (one row per notification, 112 rows)

Synthetic-data reference implementation. No real CDF data. Run with: python3 -I build_level2_table.py [repo_path]
Idempotent: outputs are rewritten from the inputs every run.
"""
import csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAT = os.path.join(HERE, "level2_journeys.json")
V9 = os.path.join(ROOT, "generator", "source", "tests", "v9_data.json")
CB = os.path.join(ROOT, "build_committee_register.py")
OUT_MD = os.path.join(HERE, "LEVEL2_JOURNEYS_PROPOSED.md")
OUT_CSV = os.path.join(HERE, "LEVEL2_JOURNEYS_PROPOSED.csv")
REPO = sys.argv[1] if len(sys.argv) > 1 else "/home/user/cdf_case_management"
MARKER = "# ---------------------------------------------------------------- build outputs"

cat = json.load(open(CAT, encoding="utf-8"))
v9 = json.load(open(V9, encoding="utf-8"))

# ---- level 1: master stages and sub-states (V8 workbook via v9_data)
MASTER = {s["code"]: s for s in v9["states"]}
SUB = {s["code"]: s for s in v9["substates"]}
MASTER_EN = {m["code"]: m["en"] for m in cat["master"]}
SUB_EN = cat["master_sub_en"]

# ---- generator notifications (69)
GEN = {n["id"]: n for n in v9["notifications"]}

# ---- committee rows (43) from the builder's definitions part
src = open(CB, encoding="utf-8").read()
head = src.split(MARKER)[0]
_argv = sys.argv
sys.argv = [CB, REPO, os.path.join(HERE, "_unused")]
g = {}
exec(compile(head, "build_committee_register.py#definitions", "exec"), g)
sys.argv = _argv
COM = {r["id"]: r for r in g["N"]}

JOUR = {j["id"]: j for j in cat["journeys"]}
ASSIGN = cat["assignments"]

# ---- integrity checks (fail loudly)
ids = [a["id"] for a in ASSIGN]
assert len(ids) == len(set(ids)), "duplicate assignment ids"
assert set(a["id"] for a in ASSIGN if a["source"] == "generator") == set(GEN), "generator coverage mismatch"
assert set(a["id"] for a in ASSIGN if a["source"] == "committee") == set(COM), "committee coverage mismatch"
for a in ASSIGN:
    assert a["journey"] in JOUR, a
    assert 1 <= a["stage"] <= 5, a
    assert a["master"] in (None, "CASE_UNCHANGED") or a["master"] in SUB, a
for j in cat["journeys"]:
    assert len(j["stages"]) == 5 and [s["n"] for s in j["stages"]] == [1, 2, 3, 4, 5], j["id"]
    assert all(s["sub"] for s in j["stages"]), j["id"]


def master_cell(code, lang):
    if code is None:
        return "— (not a case step; the card shows the case's own position)" if lang == "en" else "— (ليس خطوة في مسار الحالة؛ تُعرض حالة الحالة الراهنة)"
    if code == "CASE_UNCHANGED":
        return "unchanged — the case's position at send time" if lang == "en" else "دون تغيير — موقع الحالة وقت الإرسال"
    s = SUB[code]
    m = MASTER[s["main"]]
    if lang == "en":
        return f"{code} {SUB_EN.get(code, s['name'])} — {s['main']} {MASTER_EN[s['main']]}"
    return f"{code} {s['name']} — {s['main']} {m['name']}"


def title_of(a):
    if a["source"] == "generator":
        n = GEN[a["id"]]
        return n["title"], n["recipient"], n.get("state", ""), n.get("catName", "")
    r = COM[a["id"]]
    return r["code"], r["rcpt"], "", r["area"]


def esc(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


# ---- CSV
fields = ["id", "source", "area", "title", "recipient", "journey_id", "journey_object_ar", "journey_object_en",
          "journey_capacity_ar", "journey_capacity_en", "disclosure", "l2_stage_n", "l2_stage_ar", "l2_stage_en",
          "l2_substeps_ar", "l2_substeps_en", "l2_closure_ar", "l2_closure_en", "l1_code", "l1_substate_ar",
          "l1_substate_en", "l1_stage_code", "l1_stage_ar", "l1_stage_en", "v11_state", "note", "status"]
with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    for a in ASSIGN:
        j = JOUR[a["journey"]]
        st = j["stages"][a["stage"] - 1]
        title, rcpt, v11state, area = title_of(a)
        m = a["master"]
        sub = SUB.get(m) if m not in (None, "CASE_UNCHANGED") else None
        w.writerow(dict(
            id=a["id"], source=a["source"], area=area, title=title, recipient=rcpt, journey_id=j["id"],
            journey_object_ar=j["object_ar"], journey_object_en=j["object_en"],
            journey_capacity_ar=j["capacity_ar"], journey_capacity_en=j["capacity_en"], disclosure=j["disclosure"],
            l2_stage_n=st["n"], l2_stage_ar=st["ar"], l2_stage_en=st["en"],
            l2_substeps_ar=" / ".join(x["ar"] for x in st["sub"]), l2_substeps_en=" / ".join(x["en"] for x in st["sub"]),
            l2_closure_ar=j["closure_ar"], l2_closure_en=j["closure_en"],
            l1_code=m or "", l1_substate_ar=sub["name"] if sub else "", l1_substate_en=SUB_EN.get(m, "") if sub else "",
            l1_stage_code=sub["main"] if sub else "", l1_stage_ar=MASTER[sub["main"]]["name"] if sub else "",
            l1_stage_en=MASTER_EN[sub["main"]] if sub else "", v11_state=v11state, note=a["note"], status=cat["status"]))

# ---- Markdown
L = []
P = L.append
P("# Three-level journey catalogue — PROPOSED (review copy)")
P("")
P(f"Version `{cat['version']}` · status **{cat['status']}** · synthetic reference implementation, no real CDF data.")
P("")
P(f"Owner rule recorded: {cat['owner_rule']}.")
P("")
P("Every notification card (generator «مسار الحالة» and committee register cards) will show three nested levels:")
P("")
P("1. **Level 1 — the case's own journey** (master procedure: 5 stages S1–S5 and 28 sub-states, from the V8 workbook). Identical for every notification; the card marks where the case stands when the notice is sent.")
P("2. **Level 2 — the notification's purpose journey**: five stages worded for the notification's object and the recipient's capacity. Stage 5 names what closes for that recipient; it never says the case is closed.")
P("3. **Level 3 — the steps inside the current level-2 stage**, with the step this notice reports.")
P("")
P("## What needs your review")
P("")
P("1. The level-2 wording of the 22 journeys (section 2): object, capacity, the five stage names and the closure sentence. Everything is PROPOSED.")
P("2. The level-1 English names of the 28 sub-states (section 1) — the Arabic names are the workbook's; the English is proposed.")
P("3. The assignment of each of the 112 notifications to a journey, a level-2 stage and a level-1 position (section 3). Where the level-1 position differs from the generator's current V11 `state`, the row says so.")
P("")
P("Nothing is built on these tables yet: the committee register cards and the generator are rebuilt only after this review, or on the PROPOSED wording if no change is asked.")
P("")
# ---- section 1
P("## 1. Level 1 — the case journey (master procedure)")
P("")
P("| Stage | Arabic (workbook) | English (PROPOSED) | Sub-states |")
P("|---|---|---|---|")
for m in cat["master"]:
    subs = [s["code"] for s in v9["substates"] if s["main"] == m["code"]]
    P(f"| {m['code']} | {esc(m['ar'])} | {esc(m['en'])} | {len(subs)} ({subs[0]}–{subs[-1]}) |")
P("")
P("| Sub-state | Arabic (workbook) | English (PROPOSED) | Next |")
P("|---|---|---|---|")
for s in v9["substates"]:
    P(f"| {s['code']} | {esc(s['name'])} | {esc(SUB_EN.get(s['code'], ''))} | {esc(s.get('next', '') or '—')} |")
P("")
P("Level 1 is route-independent: a reporter's card, a committee member's card and an investigator's card all show the same five case stages, with the case's position at send time. Public and external recipients see the stage names only, never the internal sub-state captions.")
P("")
# ---- section 2
P("## 2. Level 2 — purpose journeys (22), with level-3 steps")
P("")
P("Each journey is worded for one object and one recipient capacity. Stage 5 says what closes; the case itself is never declared closed by a notification card.")
P("")
by_j = {}
for a in ASSIGN:
    by_j.setdefault(a["journey"], []).append(a)
for j in cat["journeys"]:
    P(f"### {j['id']} — {esc(j['object_ar'])} · {esc(j['capacity_ar'])}")
    P("")
    P(f"- **Object:** {esc(j['object_ar'])} / {esc(j['object_en'])}")
    P(f"- **Recipient capacity:** {esc(j['capacity_ar'])} / {esc(j['capacity_en'])}")
    P(f"- **Disclosure:** {j['disclosure']}")
    P(f"- **What closes at stage 5:** {esc(j['closure_ar'])} / {esc(j['closure_en'])}")
    if j.get("note_en"):
        P(f"- **Note:** {esc(j['note_en'])}")
    P("")
    P("| # | Stage (Arabic) | Stage (English) | Level-3 steps (Arabic) | Level-3 steps (English) |")
    P("|---|---|---|---|---|")
    for st in j["stages"]:
        P(f"| {st['n']} | {esc(st['ar'])} | {esc(st['en'])} | {esc(' / '.join(x['ar'] for x in st['sub']))} | {esc(' / '.join(x['en'] for x in st['sub']))} |")
    P("")
    used = by_j.get(j["id"], [])
    if used:
        parts = []
        for n in range(1, 6):
            ids_n = [a["id"] for a in used if a["stage"] == n]
            if ids_n:
                parts.append(f"stage {n}: {', '.join(ids_n)}")
        P(f"Notifications on this journey ({len(used)}): " + " · ".join(parts) + ".")
    else:
        P("Notifications on this journey: none yet.")
    P("")
# ---- section 3
P("## 3. Assignment of every notification (112)")
P("")
P("Level-1 position: the master sub-state the notice reports. «unchanged» means the notice does not move the case and the card shows the case's position at send time. «V11 state» is what the generator carries today; a ≠ marks a proposed change.")
P("")
P("| ID | Notification | Recipient | Journey | Level-2 stage | Level-1 position | V11 state | Note |")
P("|---|---|---|---|---|---|---|---|")
diff = 0
for a in ASSIGN:
    j = JOUR[a["journey"]]
    st = j["stages"][a["stage"] - 1]
    title, rcpt, v11state, area = title_of(a)
    m = a["master"]
    v11 = v11state or "—"
    if v11state and (m or "") != v11state:
        v11 = f"≠ {v11state}"
        diff += 1
    P(f"| {a['id']} | {esc(title)} | {esc(rcpt)} | {j['id']} ({esc(j['object_ar'])} · {esc(j['capacity_ar'])}) | {st['n']}. {esc(st['ar'])} | {esc(master_cell(m, 'ar'))} | {v11} | {esc(a['note'] or '')} |")
P("")
gen_n = sum(1 for a in ASSIGN if a["source"] == "generator")
com_n = len(ASSIGN) - gen_n
unch = sum(1 for a in ASSIGN if a["master"] == "CASE_UNCHANGED")
none = sum(1 for a in ASSIGN if a["master"] is None)
P(f"Counts: {gen_n} generator notifications + {com_n} committee register rows = {len(ASSIGN)}; {len(ASSIGN) - unch - none} report a master sub-state, {unch} are «unchanged», {none} are not case steps; {diff} level-1 positions differ from the generator's V11 state.")
P("")
P("## 4. How the three levels will appear on a card")
P("")
P("Level 1 (top): the five master stages with the case's position (✔ passed · ● current · ○ ahead) and the current sub-state caption for internal recipients. Level 2 (middle): the five stages of the recipient's purpose journey, with the stage this notice belongs to. Level 3 (bottom): the steps of that level-2 stage, with «this notice» on the step reported; alternative outcomes (returned, rejected, cancelled) appear only when they occur. Public and external recipients get the public labels only.")
P("")
P("## 5. Sources")
P("")
P("- Level 1: V8 workbook sheets «الحالات الرئيسية» and «الحالات الفرعية» (as carried in the generator's `v9_data.json`).")
P("- Level 2 and 3: `journeys/level2_journeys.json` (PROPOSED, written 26 Oct 2026 from the owner's 12:22 / 12:32 / 12:36 messages).")
P("- Generator titles, recipients and V11 states: `generator/source/tests/v9_data.json`.")
P("- Committee rows: `build_committee_register.py` (definitions part).")
P("")
open(OUT_MD, "w", encoding="utf-8").write("\n".join(L))
print(f"journeys {len(cat['journeys'])} assignments {len(ASSIGN)} generator {gen_n} committee {com_n} l1-diffs {diff}")
print(f"-> {OUT_MD} {os.path.getsize(OUT_MD)} bytes")
print(f"-> {OUT_CSV} {os.path.getsize(OUT_CSV)} bytes")
