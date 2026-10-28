# E07 (M1 part) — Multi-workspace UX · تجربة مساحات العمل المتعددة

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team UX, task V13-UX-004. Status: PROPOSED for QA
review. M2 adds workspace dashboards and role-specific home pages to this file.

## 1. The three M1 workspaces

FACT (PLAN §4, M1): three roles and three workspaces.

| Code | Arabic | English | Primary role | Purpose in M1 |
| ---- | ------ | ------- | ------------ | ------------- |
| `SECRETARIAT` | الأمانة | Secretariat | Committee Secretary · أمين اللجنة | prepares and sends case notifications, tracks committee tasks |
| `INVESTIGATIONS` | التحقيقات | Investigations | Investigator · محقق | works on assigned cases and their tasks |
| `GOVERNANCE` | الحوكمة | Governance | Governance Officer · مسؤول الحوكمة | oversight of cases and notification operations (read-mostly) |

A persona can belong to several workspaces (membership = persona × workspace × role, with an active window; V13-DB-001).
Synthetic example: _Governance Officer Delta_ in Governance only; _Secretary Alpha_ in Secretariat; _Investigator Beta_
and _Investigator Gamma_ in Investigations, each assigned to different cases.

## 2. What a workspace decides

| Changes with the workspace | Never changes with the workspace |
| -------------------------- | -------------------------------- |
| SideNav areas and their counts | The persona (identity) |
| Which cases appear in My Work and the Portfolio | The case a URL names (a case URL is re-authorised, not re-targeted) |
| Which actions a case page offers | The language, theme and other preferences |
| The workspace name in TopBar and document title | Audit identity: every action is recorded with persona **and** workspace |

Switching **never widens access** (board V13-FE-002): the database re-checks membership on the switch and on every
later request; the interface only displays the result.

## 3. Workspace Switcher interaction

- **Where.** A button in the TopBar labelled with the active workspace ("مساحة العمل: الأمانة"), opening a menu; and
  the page `/workspaces` with the same list (works without JavaScript; the button links there when scripts are off).
- **Evidence attributes.** The control carries `data-testid="workspace-switcher"` and `data-workspace-code` (ADR-013).
- **Content.** Only workspaces where the persona has an **active** membership, each with the role held there. The
  active one is marked with `aria-current="true"`, a check glyph and the word "الحالية" (not colour alone). No
  greyed-out workspaces the persona cannot enter (no existence hint).
- **One workspace.** The control shows the name as plain text (no menu) when the persona has one membership.
- **Keyboard.** Disclosure pattern: Enter/Space opens; Arrow keys move; Enter selects; Escape closes and returns focus
  to the button. Each option is a form submit (Server Action / POST), not a client-side state change.
- **Unsaved input.** If the current page has a dirty form, the switch asks to confirm ("لديك تغييرات غير محفوظة…").
- **After the switch.** Redirect to `/my-work`; a polite live region and the page heading announce the new workspace
  ("انتقلت إلى مساحة عمل التحقيقات"). Focus moves to the main heading.
- **Refused switch** (membership ended between render and submit): generic ErrorState with correlation id, the active
  workspace stays as it was.

## 4. Multiple tabs

The active workspace lives in the signed session (server), so it is shared by the persona's tabs. A tab still showing
a case from the previous workspace re-checks access on its next request; if the case is not visible in the new
workspace it shows the generic not-found state. This is deliberate (Scenario C: switching re-checks permissions) and
is stated in the switcher's confirmation text so it is not a surprise.

PROPOSAL (FE/ARCH): if per-tab workspaces become a requirement, the workspace would move into the URL
(`/w/[workspace]/…`); not needed for M1.

## 5. Acceptance (feeds QA Scenario C)

1. The switcher lists exactly the persona's active memberships (Delta: one item, plain text).
2. After switching Secretariat → Investigations, My Work and the Portfolio show only Investigations-visible cases.
3. A case URL from the old workspace that is not visible in the new one shows the same page as an unknown id.
4. The active workspace is identified by glyph + word + `aria-current`, verified in greyscale screenshots.
5. Keyboard-only and screen-reader paths complete the switch; axe reports 0 serious/critical on `/workspaces`.
