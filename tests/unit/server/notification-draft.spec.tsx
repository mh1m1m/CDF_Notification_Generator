// FE-006 Scenario E: the draft form loader (offered only to roles that may draft, on ACTIVE cases), the draft command
// service (pre-check → Zod → port; outcomes carry ids only; logs carry codes only), the redirect and notice parsing,
// the Server Action (SEC-APP-18: no session, or a session whose role may not draft, changes nothing; every refusal
// is the same generic state; a created draft redirects to the case the database returned) and the Notifications tab
// markup (form keyed by the route case, notice, no template text, client component imports). Fake port; the SQL adapter is
// covered in v13-notification-drafts-adapter.spec.ts and, against the database, in tests/integration/fe.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(platform)/cases/[caseId]/notifications/actions";
import type { RequestIdentity } from "@/lib/contracts";
import { draftBindingKey } from "@/lib/auth/draft-binding-key";
import type { RequestContext } from "@/lib/server/context";
import { signDraftBinding } from "@/lib/server/draft-binding";
import type { NotificationDraftPort } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import { loadCaseWorkspace, type CaseWorkspaceView } from "@/lib/server/case-workspace";
import {
  createNotificationDraft,
  createdDraftTarget,
  loadDraftForm,
  newIdempotencyKey,
  parseDraftNotice,
} from "@/lib/server/notification-draft";
import { CaseWorkspace } from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import { readFileSync } from "node:fs";
import { caseIdOf, createFakeCaseSource, FAKE_CASES } from "./support/fake-case-source";
import {
  createFakeNotificationRecords,
  createFakeProceduralRecords,
  caseNotificationId,
} from "./support/fake-records";
import {
  createFakeNotificationDrafts,
  draftNotificationIdOf,
  FAKE_DRAFT_OPTIONS,
  templateVersionIdOf,
} from "./support/fake-notification-drafts";
import {
  CORRELATION,
  ctxFor,
  GOVERNANCE,
  GOVERNANCE_AT_SECRETARIAT,
  INVESTIGATOR_BETA,
  SECRETARY,
} from "./support/identities";
import { scrollRegionProblems } from "./support/scroll-regions";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));
const createDraft = vi.hoisted(() => vi.fn());
vi.mock("@/app/(platform)/cases/[caseId]/notifications/actions", () => ({ createDraft }));
const action = vi.hoisted(() => ({ session: null as unknown, port: null as unknown }));
// The form-binding key derives from V13_SESSION_SECRET (V13-FE-012); a synthetic test secret (32 bytes of 7).
vi.stubEnv("V13_SESSION_SECRET", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/auth/server-session", () => ({ getCurrentSession: async () => action.session }));
vi.mock("@/lib/server/records", () => ({ notificationDraftsFor: () => action.port }));

beforeEach(() => logServerError.mockClear());

const KEY = "0123456789abcdef".repeat(4);
const form = (extra: Record<string, unknown> = {}) => ({
  case_id: caseIdOf(1),
  template_version_id: templateVersionIdOf(1),
  recipient_class: "WITNESS",
  idempotency_key: KEY,
  ...extra,
});
const summary = (i: number) => FAKE_CASES[i - 1]!;
// The session every test persona holds: issued a minute ago, expiring in 8 hours (V13-FE-012 binds forms to it).
const IAT = Math.floor(Date.now() / 1000) - 60;
const EXP = IAT + 8 * 60 * 60;
const ctxOf = (identity: RequestIdentity, iat = IAT, exp = EXP): RequestContext => {
  const base = ctxFor(identity);
  const claims = { persona_id: identity.persona_id, active_workspace: identity.active_workspace, iat, exp };
  return { ...base, session: { ...base.session, claims } as RequestContext["session"] };
};
/** The binding the server would render for `identity` on case `to` with the form's key (V13-FE-012). */
const bindingFor = (identity: RequestIdentity, to: unknown, key: unknown, iat = IAT, exp = EXP) =>
  signDraftBinding(draftBindingKey(), { identity, iat, exp }, String(to), String(key));
/** The form as the server rendered it for `identity` on case `to` (default: the case the form names). */
const bound = <F extends Record<string, unknown>>(
  raw: F,
  identity = SECRETARY,
  to: unknown = raw.case_id,
) => ({
  ...raw,
  case_binding: "case_binding" in raw ? raw.case_binding : bindingFor(identity, to, raw.idempotency_key),
});
const UUID = /^[0-9a-f-]{36}$/;

describe("newIdempotencyKey", () => {
  it("is 64 lower-case hex characters and never repeats", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadDraftForm", () => {
  it("a secretary on an ACTIVE case gets the options, the route case and a fresh key", async () => {
    const drafts = createFakeNotificationDrafts();
    const view = await loadDraftForm({ ctx: ctxOf(SECRETARY), drafts }, summary(1), () => KEY);
    expect(view).toEqual({
      caseId: caseIdOf(1),
      idempotencyKey: KEY,
      binding: bindingFor(SECRETARY, caseIdOf(1), KEY),
      templates: (await drafts.options(SECRETARY)).templates,
      recipientClasses: (await drafts.options(SECRETARY)).recipientClasses,
    });
  });

  it("an investigator may draft too (role matrix, api_create_notification_draft)", async () => {
    const drafts = createFakeNotificationDrafts();
    expect(await loadDraftForm({ ctx: ctxOf(INVESTIGATOR_BETA), drafts }, summary(1))).not.toBeNull();
  });

  it.each([
    ["a governance officer", GOVERNANCE, 1],
    ["a governance officer in Secretariat", GOVERNANCE_AT_SECRETARIAT, 1],
    ["a secretary on the closed case 0010", SECRETARY, 10],
  ] as const)("%s gets no form and no options are read", async (_n, identity, i) => {
    const drafts = createFakeNotificationDrafts();
    expect(await loadDraftForm({ ctx: ctxOf(identity), drafts }, summary(i))).toBeNull();
    // Closed cases are decided before the options are read; a role refusal too.
    expect(drafts.calls).toEqual([]);
  });

  it("no template or no recipient class: no form", async () => {
    for (const options of [
      { templates: [], recipientClasses: [{ code: "WITNESS", name: { ar: "الشاهد", en: "Witness" } }] },
      {
        templates: (await createFakeNotificationDrafts().options(SECRETARY)).templates,
        recipientClasses: [],
      },
    ]) {
      const drafts = createFakeNotificationDrafts(options);
      expect(await loadDraftForm({ ctx: ctxOf(SECRETARY), drafts }, summary(1))).toBeNull();
    }
  });
});

describe("createNotificationDraft", () => {
  // By default the form is bound to the case it names, so these cases reach the pre-check and the command; the
  // binding cases below bind it to another case (the route's) or tamper with the binding itself.
  const run = (
    identity = SECRETARY,
    raw: Record<string, unknown> = form(),
    drafts = createFakeNotificationDrafts(),
    boundTo: unknown = raw.case_id,
  ) =>
    createNotificationDraft(
      { ctx: ctxOf(identity), drafts },
      bound(raw, identity, boundTo) as unknown as Parameters<typeof createNotificationDraft>[1],
    ).then((outcome) => ({ outcome, drafts }));
  const REFUSED = { kind: "refused", correlationId: CORRELATION };

  it("creates the draft and returns the case id and notification id the command returned", async () => {
    const { outcome, drafts } = await run();
    expect(outcome).toEqual({
      kind: "created",
      caseId: caseIdOf(1),
      notificationId: draftNotificationIdOf(1),
    });
    expect(drafts.created).toEqual([{ case_id: caseIdOf(1), author: SECRETARY.persona_id }]);
    expect(logServerError).not.toHaveBeenCalled();
  });

  it("uses the case id the command returned, never the form's (SEC condition 1)", async () => {
    const lying: NotificationDraftPort = {
      options: async () => ({ templates: [], recipientClasses: [] }),
      createDraft: async () => ({
        notification_id: draftNotificationIdOf(7),
        case_id: caseIdOf(3),
        lifecycle_status: "DRAFT",
        row_version: 1,
      }),
    };
    const outcome = await createNotificationDraft({ ctx: ctxOf(SECRETARY), drafts: lying }, bound(form()));
    expect(outcome).toEqual({
      kind: "created",
      caseId: caseIdOf(3),
      notificationId: draftNotificationIdOf(7),
    });
  });

  // V13-FE-012 (OI-049): the draft is bound to the route's case. Before, an id swapped to case 0003 (also draftable by
  // Alpha) created the draft on 0003. Now a posted id other than the one the form was bound to is refused before the
  // pre-check: the same generic outcome whether it names a case the persona may draft on, a hidden or unknown case, or
  // is malformed.
  it.each([
    ["a visible case the persona may draft on (0003)", caseIdOf(3), "BINDING"],
    ["the route's own other visible case (0004 → 0001)", caseIdOf(1), "BINDING"],
    ["another workspace's case (0002)", caseIdOf(2), "BINDING"],
    ["a restricted case (0009)", caseIdOf(9), "BINDING"],
    ["an unknown UUID", caseIdOf(11), "BINDING"],
    // Malformed values fail the schema, which runs first (ADR-020): the same generic refusal.
    ["a display number", "CDF-DEMO-2026-0001", "VALIDATION"],
    ["the route id in upper case", caseIdOf(4).toUpperCase(), "VALIDATION"],
    ["an empty value", "", "VALIDATION"],
    ["a missing value", null, "VALIDATION"],
  ] as const)(
    "form bound to 0004, posted id is %s: refused, no command call, no draft",
    async (_n, posted, code) => {
      const { outcome, drafts } = await run(SECRETARY, form({ case_id: posted }), undefined, caseIdOf(4));
      expect(outcome).toEqual(REFUSED);
      expect(drafts.calls).toEqual([]);
      expect(drafts.created).toEqual([]);
      expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, { code });
      // Only the code is logged, never the posted or the route id.
      expect(JSON.stringify(logServerError.mock.calls)).not.toMatch(/0c000000|CDF-DEMO/);
    },
  );

  it.each([
    ["no binding", { case_binding: null }],
    ["an empty binding", { case_binding: "" }],
    ["a forged binding", { case_binding: "A".repeat(43) }],
    ["the binding of another persona (Beta) for the same case and key", "BETA"],
    ["the binding of another persona in another workspace (Delta in Secretariat)", "OTHER_PERSONA_WORKSPACE"],
    ["the binding of the same persona in another workspace (Alpha in Governance)", "OTHER_WORKSPACE"],
    ["the binding for another key", "OTHER_KEY"],
  ] as const)("%s: refused before the pre-check, nothing written", async (_n, how) => {
    const raw =
      how === "BETA"
        ? { ...form(), case_binding: bindingFor(INVESTIGATOR_BETA, caseIdOf(1), KEY) }
        : how === "OTHER_PERSONA_WORKSPACE"
          ? { ...form(), case_binding: bindingFor(GOVERNANCE_AT_SECRETARIAT, caseIdOf(1), KEY) }
          : how === "OTHER_WORKSPACE"
            ? {
                ...form(),
                case_binding: bindingFor({ ...SECRETARY, active_workspace: "GOVERNANCE" }, caseIdOf(1), KEY),
              }
            : how === "OTHER_KEY"
              ? { ...form(), case_binding: bindingFor(SECRETARY, caseIdOf(1), "b".repeat(64)) }
              : { ...form(), ...how };
    const { outcome, drafts } = await run(SECRETARY, raw);
    expect(outcome).toEqual(REFUSED);
    expect(drafts.calls).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, {
      code: "BINDING",
    });
  });

  it("a form bound to 0004 posting 0004 creates the draft on 0004 (positive control)", async () => {
    const { outcome, drafts } = await run(SECRETARY, form({ case_id: caseIdOf(4) }), undefined, caseIdOf(4));
    expect(outcome).toEqual({
      kind: "created",
      caseId: caseIdOf(4),
      notificationId: draftNotificationIdOf(1),
    });
    expect(drafts.created).toEqual([{ case_id: caseIdOf(4), author: SECRETARY.persona_id }]);
  });

  it.each([
    [
      "a binding from an earlier session (another issued-at)",
      bindingFor(SECRETARY, caseIdOf(1), KEY, IAT - 3600),
      IAT + 60,
    ],
    ["a binding that outlives the session", bindingFor(SECRETARY, caseIdOf(1), KEY, IAT, EXP + 1), IAT + 60],
    ["a binding at its expiry", bindingFor(SECRETARY, caseIdOf(1), KEY), EXP],
    ["a binding after its expiry", bindingFor(SECRETARY, caseIdOf(1), KEY), EXP + 3600],
  ] as const)("%s: refused before the pre-check, nothing written", async (_n, case_binding, nowSeconds) => {
    const drafts = createFakeNotificationDrafts();
    const outcome = await createNotificationDraft(
      { ctx: ctxOf(SECRETARY), drafts, now: () => new Date(nowSeconds * 1000) },
      { ...form(), case_binding } as unknown as Parameters<typeof createNotificationDraft>[1],
    );
    expect(outcome).toEqual(REFUSED);
    expect(drafts.calls).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, {
      code: "BINDING",
    });
  });

  it("a valid binding one second before its expiry still creates (control for the clock)", async () => {
    const drafts = createFakeNotificationDrafts();
    const outcome = await createNotificationDraft(
      { ctx: ctxOf(SECRETARY), drafts, now: () => new Date((EXP - 1) * 1000) },
      bound(form()) as unknown as Parameters<typeof createNotificationDraft>[1],
    );
    expect(outcome).toMatchObject({ kind: "created", caseId: caseIdOf(1) });
  });

  // Replay (ADR-020): the same bound form posted twice verifies both times; the idempotency key it is bound to makes
  // the command refuse the second as DUPLICATE, so a replay never creates a second draft.
  it("replay: the same bound form twice gives one draft, the second is DUPLICATE (generic refusal)", async () => {
    const drafts = createFakeNotificationDrafts();
    await run(SECRETARY, form(), drafts);
    const { outcome } = await run(SECRETARY, form(), drafts);
    expect(outcome).toEqual(REFUSED);
    expect(drafts.created).toHaveLength(1);
    expect(logServerError).toHaveBeenLastCalledWith("notification_draft_refused", CORRELATION, {
      code: "DUPLICATE",
    });
  });

  it.each([
    ["a role that may not draft (Delta, Governance)", GOVERNANCE, form(), "PRECHECK"],
    ["a malformed case id", SECRETARY, form({ case_id: "CDF-DEMO-2026-0001" }), "VALIDATION"],
    ["an upper-case case id", SECRETARY, form({ case_id: caseIdOf(1).toUpperCase() }), "VALIDATION"],
    ["a short key", SECRETARY, form({ idempotency_key: "abc" }), "VALIDATION"],
    ["an upper-case key", SECRETARY, form({ idempotency_key: KEY.toUpperCase() }), "VALIDATION"],
    ["a missing template", SECRETARY, form({ template_version_id: null }), "VALIDATION"],
    ["a malformed template version id", SECRETARY, form({ template_version_id: "1" }), "VALIDATION"],
    ["a lower-case recipient class", SECRETARY, form({ recipient_class: "witness" }), "VALIDATION"],
    ["a recipient class with a quote", SECRETARY, form({ recipient_class: "WITNESS'" }), "VALIDATION"],
  ] as const)("%s is refused before the command, nothing written", async (_n, identity, raw, code) => {
    const { outcome, drafts } = await run(identity, raw);
    expect(outcome).toEqual(REFUSED);
    expect(drafts.calls).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, { code });
  });

  it.each([
    ["an unknown case id", SECRETARY, form({ case_id: caseIdOf(11) }), "NOT_FOUND"],
    [
      "another workspace's case (0002, Investigations only)",
      SECRETARY,
      form({ case_id: caseIdOf(2) }),
      "NOT_FOUND",
    ],
    [
      "a case the persona cannot access (restricted 0009)",
      SECRETARY,
      form({ case_id: caseIdOf(9) }),
      "NOT_FOUND",
    ],
    ["the closed case 0010", SECRETARY, form({ case_id: caseIdOf(10) }), "CASE_CLOSED"],
    [
      "an unknown template version",
      SECRETARY,
      form({ template_version_id: templateVersionIdOf(9) }),
      "INVALID_INPUT",
    ],
    ["an unknown recipient class", SECRETARY, form({ recipient_class: "REPORTER" }), "INVALID_INPUT"],
  ] as const)(
    "%s: the command refuses; same generic outcome, nothing written",
    async (_n, identity, raw, code) => {
      const { outcome, drafts } = await run(identity, raw);
      expect(outcome).toEqual(REFUSED);
      expect(drafts.created).toEqual([]);
      expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, { code });
    },
  );

  it("an unexpected failure is the same generic outcome; the log gets the error, never the form values", async () => {
    const boom: NotificationDraftPort = {
      options: async () => ({ templates: [], recipientClasses: [] }),
      createDraft: async () => {
        throw new Error("connection reset");
      },
    };
    const outcome = await createNotificationDraft({ ctx: ctxOf(SECRETARY), drafts: boom }, bound(form()));
    expect(outcome).toEqual(REFUSED);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_failed", CORRELATION, expect.any(Error));
    expect(JSON.stringify(logServerError.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(logServerError.mock.calls)).not.toContain(caseIdOf(1));
  });
});

describe("createdDraftTarget and parseDraftNotice", () => {
  it("redirects to the returned case's Notifications tab with the new id", () => {
    expect(
      createdDraftTarget({ kind: "created", caseId: caseIdOf(3), notificationId: draftNotificationIdOf(1) }),
    ).toBe(`/cases/${caseIdOf(3)}/notifications?created=${draftNotificationIdOf(1)}`);
  });

  it("keeps only a well-formed created id", () => {
    const n = draftNotificationIdOf(1);
    expect(parseDraftNotice({ created: n })).toEqual({ kind: "created", notificationId: n });
    expect(parseDraftNotice({ created: [n, "x"] })).toEqual({ kind: "created", notificationId: n });
    for (const bad of [
      undefined,
      {},
      { created: "<script>" },
      { created: n.toUpperCase() },
      { created: 42 },
      { ref: CORRELATION },
      { duplicate: CORRELATION },
    ]) {
      expect(parseDraftNotice(bad)).toBeNull();
    }
  });
});

describe("createDraft Server Action (SEC-APP-18, V13-FE-012)", () => {
  async function run(
    session: unknown,
    fields: Record<string, string>,
    port = createFakeNotificationDrafts(),
    boundTo: string = fields.case_id!,
  ) {
    action.session = session;
    action.port = port;
    const real = await vi.importActual<typeof ActionsModule>(
      "@/app/(platform)/cases/[caseId]/notifications/actions",
    );
    const fd = new FormData();
    // The form as the server rendered it for this session's persona and workspace, bound to `boundTo`.
    const identity = (session as { identity?: RequestIdentity } | null)?.identity ?? SECRETARY;
    for (const [k, v] of Object.entries(bound(fields, identity, boundTo))) fd.set(k, String(v));
    try {
      return { state: await real.createDraft(null, fd), to: null, port };
    } catch (e) {
      if (e instanceof Redirect) return { state: undefined, to: e.to, port };
      throw e;
    }
  }
  const fields = form() as Record<string, string>;
  const REFUSED_STATE = { reference: expect.stringMatching(UUID) };

  it("without a session: sign-in, and the port is never called", async () => {
    const { to, port } = await run(null, fields);
    expect(to).toBe("/sign-in");
    expect(port.calls).toEqual([]);
  });

  it("another persona's session whose role may not draft (Delta, Governance): generic state, nothing written", async () => {
    const { to, state, port } = await run(ctxOf(GOVERNANCE).session, fields);
    expect(to).toBeNull();
    expect(state).toEqual(REFUSED_STATE);
    expect(port.calls).toEqual([]);
  });

  it("created redirects to the case the command returned; every refusal stays put with the same state", async () => {
    const session = ctxOf(SECRETARY).session;
    const port = createFakeNotificationDrafts();
    expect((await run(session, fields, port)).to).toBe(
      `/cases/${caseIdOf(1)}/notifications?created=${draftNotificationIdOf(1)}`,
    );
    for (const f of [
      fields, // the same key again
      { ...fields, case_id: caseIdOf(10), idempotency_key: "b".repeat(64) },
      { ...fields, case_id: caseIdOf(9), idempotency_key: "c".repeat(64) },
      { ...fields, case_id: "../0002" },
    ]) {
      const r = await run(session, f, port);
      expect(r.to).toBeNull();
      expect(r.state).toEqual(REFUSED_STATE);
      expect(JSON.stringify(r.state)).not.toMatch(/0c000000|0002/);
    }
    expect(port.created).toEqual([{ case_id: caseIdOf(1), author: SECRETARY.persona_id }]);
  });

  it("V13-FE-012: a form from 0004's page edited to name 0001 creates nothing on either case", async () => {
    const port = createFakeNotificationDrafts();
    const session = ctxOf(SECRETARY).session;
    for (const posted of [caseIdOf(1), caseIdOf(2), caseIdOf(11), "CDF-DEMO-2026-0001"]) {
      const r = await run(session, { ...fields, case_id: posted }, port, caseIdOf(4));
      expect(r.to).toBeNull();
      expect(r.state).toEqual(REFUSED_STATE);
    }
    expect(port.calls).toEqual([]);
    expect(port.created).toEqual([]);
    // The untampered form on 0004 still works.
    expect((await run(session, { ...fields, case_id: caseIdOf(4) }, port, caseIdOf(4))).to).toBe(
      `/cases/${caseIdOf(4)}/notifications?created=${draftNotificationIdOf(1)}`,
    );
  });

  it("extra form fields are ignored by the action and never reach the command (strict schema)", async () => {
    const port = createFakeNotificationDrafts();
    const { to } = await run(
      ctxOf(SECRETARY).session,
      { ...fields, persona_id: "x", workspace: "GOVERNANCE" },
      port,
    );
    expect(to).toContain(`/cases/${caseIdOf(1)}/`);
    expect(port.created).toEqual([{ case_id: caseIdOf(1), author: SECRETARY.persona_id }]);
  });
});

describe("Notifications tab markup", () => {
  async function tab(
    identity = SECRETARY,
    i = 1,
    notice: Parameters<typeof parseDraftNotice>[0] = undefined,
  ) {
    return loadCaseWorkspace(
      {
        ctx: ctxOf(identity),
        source: createFakeCaseSource(),
        procedural: createFakeProceduralRecords(),
        notifications: createFakeNotificationRecords(),
        drafts: createFakeNotificationDrafts(),
        notice: parseDraftNotice(notice),
      },
      caseIdOf(i),
      "notifications",
    );
  }
  const html = (v: CaseWorkspaceView, locale: Locale = "ar") =>
    renderToStaticMarkup(<CaseWorkspace t={createTranslator(locale)} locale={locale} view={v} />);

  it("the form carries the route case and the key as hidden fields, options by name, no template text", async () => {
    for (const locale of ["ar", "en"] as const) {
      const markup = html(await tab(), locale);
      expect(markup).toContain('data-testid="draft-form"');
      expect(markup.match(/name="case_id"/g)).toHaveLength(1);
      expect(markup).toContain(`name="case_id" value="${caseIdOf(1)}"`);
      expect(markup).toMatch(/name="idempotency_key" value="[0-9a-f]{64}"/);
      // V13-FE-012: the server's binding of the route case and this form's key.
      const key = markup.match(/name="idempotency_key" value="([0-9a-f]{64})"/)![1];
      expect(markup).toContain(`name="case_binding" value="${bindingFor(SECRETARY, caseIdOf(1), key)}"`);
      expect(markup).toContain(`value="${templateVersionIdOf(1)}"`);
      expect(markup).toContain('value="WITNESS"');
      expect(markup).toContain(locale === "ar" ? "الشاهد" : "Witness");
      expect(markup).toContain("CF-20_INVESTIGATION_ASSIGNED");
      expect(markup).not.toMatch(/case_reference|\{\{/);
      expect(markup).not.toContain('data-testid="draft-error"');
      expect(scrollRegionProblems(markup)).toEqual([]);
    }
  });

  it("FE-016 (UXB-19): the selected template's code is text under the select, isolated LTR, and describes the select", async () => {
    const first = FAKE_DRAFT_OPTIONS.templates[0]!;
    for (const locale of ["ar", "en"] as const) {
      const markup = html(await tab(), locale);
      const label = locale === "ar" ? "رمز القالب:" : "Template code:";
      expect(markup).toMatch(
        new RegExp(
          `<p id="draft-template-code" class="[^"]*selectedCode[^"]*" data-testid="draft-template-code"><span>${label}</span> ` +
            `<bdi dir="ltr" data-testid="draft-template-code-value">${first.template_code}</bdi></p>`,
        ),
      );
      expect(markup).toMatch(
        /<select[^>]*aria-describedby="draft-template-code"[^>]*data-testid="draft-template"/,
      );
      // order: the template select, its code, then the recipient field
      const at = (needle: string) => markup.indexOf(needle);
      expect(at('data-testid="draft-template"')).toBeLessThan(at('data-testid="draft-template-code"'));
      expect(at('data-testid="draft-template-code"')).toBeLessThan(at('for="draft-recipient"'));
      // the code is the first option's, which is the select's default selection
      expect(markup).toMatch(
        new RegExp(
          `<select[^>]*data-testid="draft-template"><option value="[^"]+" data-template-code="${first.template_code}"`,
        ),
      );
      expect(markup.match(/data-testid="draft-template-code-value"/g)).toHaveLength(1);
    }
  });

  it("FE-016: the code line takes its own row and wraps anywhere (case.module.css)", () => {
    const css = readFileSync("app/(platform)/cases/[caseId]/_components/case.module.css", "utf8");
    expect(css).toMatch(/\.selectedCode \{[^}]*flex-basis: 100%;/);
    expect(css).toMatch(/\.selectedCode > bdi \{[^}]*overflow-wrap: anywhere;/);
  });

  it("FE-018: every select in the draft form clips its own content (WebKit reflow at 320 px, case.module.css)", () => {
    const css = readFileSync("app/(platform)/cases/[caseId]/_components/case.module.css", "utf8");
    expect(css).toMatch(/\.form > select \{[^}]*overflow: hidden;/);
    // never clip the form itself: that would cut the controls' focus rings
    expect(css).not.toMatch(/\.form \{[^}]*overflow/);
  });

  it("FE-010 (D10): a template option's version is Latin digits in both languages, never grouped", async () => {
    const [first] = FAKE_DRAFT_OPTIONS.templates;
    const drafts = createFakeNotificationDrafts({
      ...FAKE_DRAFT_OPTIONS,
      templates: [{ ...first!, version: 1234 }],
    });
    const v = await loadCaseWorkspace(
      {
        ctx: ctxFor(SECRETARY),
        source: createFakeCaseSource(),
        procedural: createFakeProceduralRecords(),
        notifications: createFakeNotificationRecords(),
        drafts,
        notice: parseDraftNotice(undefined),
      },
      caseIdOf(1),
      "notifications",
    );
    for (const locale of ["ar", "en"] as const) {
      const option = html(v, locale).match(
        new RegExp(`<option value="${templateVersionIdOf(1)}"[^>]*>([^<]+)</option>`),
      )?.[1];
      // "الإصدار 1234" / "version 1234": an identifier, so no Arabic-Indic digits and no group separator.
      expect(option).toContain(locale === "ar" ? "الإصدار 1234" : "version 1234");
      expect(option).not.toMatch(/[٠-٩]|1,234|1٬234/);
    }
  });

  it("no form for governance officers or on the closed case 0010", async () => {
    expect(html(await tab(GOVERNANCE))).not.toContain("draft-form");
    expect(html(await tab(SECRETARY, 10))).not.toContain("draft-form");
  });

  it("created: polite status and the row marked, only when the id is a notification of this case", async () => {
    const own = caseNotificationId(1, 1);
    const markup = html(await tab(SECRETARY, 1, { created: own }));
    expect(markup).toMatch(
      /role="status" aria-live="polite" data-testid="draft-live"><p[^>]*data-testid="draft-created"/,
    );
    expect(markup).toContain(
      `data-testid="case-notification-${own}" data-notification-id="${own}" data-created="true"`,
    );
    const other = html(await tab(SECRETARY, 1, { created: caseNotificationId(3, 1) }));
    expect(other).not.toContain("draft-created");
    expect(other).not.toContain(caseNotificationId(3, 1));
  });

  it("the key differs on every render (a resubmitted old form is refused, a new form is new)", async () => {
    const key = (m: string) => m.match(/name="idempotency_key" value="([0-9a-f]{64})"/)?.[1];
    expect(key(html(await tab()))).not.toBe(key(html(await tab())));
  });

  it("the client form imports nothing from lib/server, lib/disclosure or lib/authority (DESIGN §12)", () => {
    const src = readFileSync("app/(platform)/cases/[caseId]/notifications/_components/DraftForm.tsx", "utf8");
    expect(src.startsWith('"use client";')).toBe(true);
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["react", "../actions", "../../_components/case.module.css"]);
  });
});
