// FE-006 Scenario E: the draft form loader (offered only to roles that may draft, on ACTIVE cases), the draft command
// service (pre-check → Zod → port; outcomes carry ids only; logs carry codes only), the redirect and notice parsing,
// the Server Action (SEC-APP-18: no session, or a session whose role may not draft, changes nothing) and the
// Notifications tab markup (form keyed by the route case, notices, no template text). Fake port; the SQL adapter is
// covered in v13-notification-drafts-adapter.spec.ts and, against the database, in tests/integration/fe.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(platform)/cases/[caseId]/notifications/actions";
import type { NotificationDraftPort } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import { loadCaseWorkspace, type CaseWorkspaceView } from "@/lib/server/case-workspace";
import {
  createNotificationDraft,
  draftRedirectTarget,
  loadDraftForm,
  newIdempotencyKey,
  parseDraftNotice,
} from "@/lib/server/notification-draft";
import { CaseWorkspace } from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import { caseIdOf, createFakeCaseSource, FAKE_CASES } from "./support/fake-case-source";
import {
  createFakeNotificationRecords,
  createFakeProceduralRecords,
  caseNotificationId,
} from "./support/fake-records";
import {
  createFakeNotificationDrafts,
  draftNotificationIdOf,
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
    const view = await loadDraftForm({ ctx: ctxFor(SECRETARY), drafts }, summary(1), () => KEY);
    expect(view).toEqual({
      caseId: caseIdOf(1),
      idempotencyKey: KEY,
      templates: (await drafts.options(SECRETARY)).templates,
      recipientClasses: (await drafts.options(SECRETARY)).recipientClasses,
    });
  });

  it("an investigator may draft too (role matrix, api_create_notification_draft)", async () => {
    const drafts = createFakeNotificationDrafts();
    expect(await loadDraftForm({ ctx: ctxFor(INVESTIGATOR_BETA), drafts }, summary(1))).not.toBeNull();
  });

  it.each([
    ["a governance officer", GOVERNANCE, 1],
    ["a governance officer in Secretariat", GOVERNANCE_AT_SECRETARIAT, 1],
    ["a secretary on the closed case 0010", SECRETARY, 10],
  ] as const)("%s gets no form and no options are read", async (_n, identity, i) => {
    const drafts = createFakeNotificationDrafts();
    expect(await loadDraftForm({ ctx: ctxFor(identity), drafts }, summary(i))).toBeNull();
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
      expect(await loadDraftForm({ ctx: ctxFor(SECRETARY), drafts }, summary(1))).toBeNull();
    }
  });
});

describe("createNotificationDraft", () => {
  const run = (identity = SECRETARY, raw = form(), drafts = createFakeNotificationDrafts()) =>
    createNotificationDraft({ ctx: ctxFor(identity), drafts }, raw).then((outcome) => ({ outcome, drafts }));

  it("creates the draft for the case in the form and returns its id only", async () => {
    const { outcome, drafts } = await run();
    expect(outcome).toEqual({
      kind: "created",
      caseId: caseIdOf(1),
      notificationId: draftNotificationIdOf(1),
    });
    expect(drafts.created).toEqual([{ case_id: caseIdOf(1), author: SECRETARY.persona_id }]);
    expect(logServerError).not.toHaveBeenCalled();
  });

  it("the same key twice: duplicate on the second, one draft only", async () => {
    const drafts = createFakeNotificationDrafts();
    await run(SECRETARY, form(), drafts);
    const { outcome } = await run(SECRETARY, form(), drafts);
    expect(outcome).toEqual({ kind: "duplicate", caseId: caseIdOf(1), correlationId: CORRELATION });
    expect(drafts.created).toHaveLength(1);
    expect(logServerError).toHaveBeenLastCalledWith("notification_draft_refused", CORRELATION, {
      code: "DUPLICATE",
    });
  });

  it.each([
    ["a governance officer (pre-check)", GOVERNANCE, form(), "PRECHECK"],
    ["a malformed case id (pre-check)", SECRETARY, form({ case_id: "CDF-DEMO-2026-0001" }), "PRECHECK"],
    [
      "an upper-case case id (pre-check)",
      SECRETARY,
      form({ case_id: caseIdOf(1).toUpperCase() }),
      "PRECHECK",
    ],
    ["a short key", SECRETARY, form({ idempotency_key: "abc" }), "VALIDATION"],
    ["an upper-case key", SECRETARY, form({ idempotency_key: KEY.toUpperCase() }), "VALIDATION"],
    ["a missing template", SECRETARY, form({ template_version_id: null }), "VALIDATION"],
    ["a lower-case recipient class", SECRETARY, form({ recipient_class: "witness" }), "VALIDATION"],
    ["a recipient class with a quote", SECRETARY, form({ recipient_class: "WITNESS'" }), "VALIDATION"],
  ] as const)("%s is refused before the command, nothing written", async (_n, identity, raw, code) => {
    const { outcome, drafts } = await run(identity, raw);
    expect(outcome.kind).toBe("error");
    expect(drafts.calls).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, { code });
  });

  it.each([
    ["a case not visible in the workspace (0002)", SECRETARY, form({ case_id: caseIdOf(2) }), "NOT_FOUND"],
    ["the restricted case 0009 for Alpha", SECRETARY, form({ case_id: caseIdOf(9) }), "NOT_FOUND"],
    ["the closed case 0010", SECRETARY, form({ case_id: caseIdOf(10) }), "CASE_CLOSED"],
    [
      "an unknown template version",
      SECRETARY,
      form({ template_version_id: templateVersionIdOf(9) }),
      "INVALID_INPUT",
    ],
  ] as const)("%s: the command refuses, the outcome is a generic error", async (_n, identity, raw, code) => {
    const { outcome, drafts } = await run(identity, raw);
    expect(outcome).toEqual({ kind: "error", caseId: raw.case_id, correlationId: CORRELATION });
    expect(drafts.created).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("notification_draft_refused", CORRELATION, { code });
  });

  it("an unexpected failure is a generic error; the log gets the error, never the form values", async () => {
    const boom: NotificationDraftPort = {
      options: async () => ({ templates: [], recipientClasses: [] }),
      createDraft: async () => {
        throw new Error("connection reset");
      },
    };
    const outcome = await createNotificationDraft({ ctx: ctxFor(SECRETARY), drafts: boom }, form());
    expect(outcome).toEqual({ kind: "error", caseId: caseIdOf(1), correlationId: CORRELATION });
    expect(logServerError).toHaveBeenCalledWith("notification_draft_failed", CORRELATION, expect.any(Error));
    expect(JSON.stringify(logServerError.mock.calls)).not.toContain(KEY);
  });
});

describe("draftRedirectTarget and parseDraftNotice", () => {
  it("redirects to the case's Notifications tab with one flag", () => {
    const c = caseIdOf(1);
    expect(
      draftRedirectTarget({ kind: "created", caseId: c, notificationId: draftNotificationIdOf(1) }),
    ).toBe(`/cases/${c}/notifications?created=${draftNotificationIdOf(1)}`);
    expect(draftRedirectTarget({ kind: "duplicate", caseId: c, correlationId: CORRELATION })).toBe(
      `/cases/${c}/notifications?duplicate=${CORRELATION}`,
    );
    expect(draftRedirectTarget({ kind: "error", caseId: c, correlationId: CORRELATION })).toBe(
      `/cases/${c}/notifications?ref=${CORRELATION}`,
    );
    expect(draftRedirectTarget({ kind: "error", caseId: null, correlationId: CORRELATION })).toBe(
      "/portfolio",
    );
  });

  it("keeps only well-formed ids, created first", () => {
    const n = draftNotificationIdOf(1);
    expect(parseDraftNotice({ created: n })).toEqual({ kind: "created", notificationId: n });
    expect(parseDraftNotice({ created: [n, "x"] })).toEqual({ kind: "created", notificationId: n });
    expect(parseDraftNotice({ duplicate: CORRELATION })).toEqual({
      kind: "duplicate",
      correlationId: CORRELATION,
    });
    expect(parseDraftNotice({ ref: CORRELATION })).toEqual({ kind: "error", correlationId: CORRELATION });
    for (const bad of [
      undefined,
      {},
      { created: "<script>" },
      { ref: "SELECT 1" },
      { duplicate: n.toUpperCase() },
      { created: 42 },
    ]) {
      expect(parseDraftNotice(bad)).toBeNull();
    }
  });
});

describe("createDraft Server Action (SEC-APP-18)", () => {
  async function run(
    session: unknown,
    fields: Record<string, string>,
    port = createFakeNotificationDrafts(),
  ) {
    action.session = session;
    action.port = port;
    const real = await vi.importActual<typeof ActionsModule>(
      "@/app/(platform)/cases/[caseId]/notifications/actions",
    );
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    try {
      await real.createDraft(fd);
    } catch (e) {
      if (e instanceof Redirect) return { to: e.to, port };
      throw e;
    }
    throw new Error("expected a redirect");
  }
  const fields = form() as Record<string, string>;

  it("without a session: sign-in, and the port is never called", async () => {
    const { to, port } = await run(null, fields);
    expect(to).toBe("/sign-in");
    expect(port.calls).toEqual([]);
  });

  it("another persona's session whose role may not draft (Delta, Governance): generic refusal, nothing written", async () => {
    const { to, port } = await run(ctxFor(GOVERNANCE).session, fields);
    expect(to).toMatch(new RegExp(`^/cases/${caseIdOf(1)}/notifications\\?ref=[0-9a-f-]{36}$`));
    expect(port.calls).toEqual([]);
  });

  it("created, duplicate and refused redirect with one flag each, back to the case in the form", async () => {
    const session = ctxFor(SECRETARY).session;
    const port = createFakeNotificationDrafts();
    expect((await run(session, fields, port)).to).toBe(
      `/cases/${caseIdOf(1)}/notifications?created=${draftNotificationIdOf(1)}`,
    );
    expect((await run(session, fields, port)).to).toMatch(/\/notifications\?duplicate=[0-9a-f-]{36}$/);
    const closed = await run(
      session,
      { ...fields, case_id: caseIdOf(10), idempotency_key: "b".repeat(64) },
      port,
    );
    expect(closed.to).toMatch(new RegExp(`^/cases/${caseIdOf(10)}/notifications\\?ref=[0-9a-f-]{36}$`));
    expect(port.created).toEqual([{ case_id: caseIdOf(1), author: SECRETARY.persona_id }]);
  });

  it("a tampered case id that is not a UUID goes to the portfolio with no detail", async () => {
    const { to, port } = await run(ctxFor(SECRETARY).session, { ...fields, case_id: "../0002" });
    expect(to).toBe("/portfolio");
    expect(port.calls).toEqual([]);
  });
});

describe("Notifications tab markup", () => {
  async function tab(
    identity = SECRETARY,
    i = 1,
    notice: Parameters<typeof parseDraftNotice>[0] = undefined,
  ) {
    const v = await loadCaseWorkspace(
      {
        ctx: ctxFor(identity),
        source: createFakeCaseSource(),
        procedural: createFakeProceduralRecords(),
        notifications: createFakeNotificationRecords(),
        drafts: createFakeNotificationDrafts(),
        notice: parseDraftNotice(notice),
      },
      caseIdOf(i),
      "notifications",
    );
    return v;
  }
  const html = (v: CaseWorkspaceView, locale: Locale = "ar") =>
    renderToStaticMarkup(<CaseWorkspace t={createTranslator(locale)} locale={locale} view={v} />);

  it("the form carries the route case and the key as hidden fields, options by name, no template text", async () => {
    for (const locale of ["ar", "en"] as const) {
      const markup = html(await tab(), locale);
      expect(markup).toContain('data-testid="draft-form"');
      expect(markup).toContain(`name="case_id" value="${caseIdOf(1)}"`);
      expect(markup).toMatch(/name="idempotency_key" value="[0-9a-f]{64}"/);
      expect(markup).toContain(`value="${templateVersionIdOf(1)}"`);
      expect(markup).toContain('value="WITNESS"');
      expect(markup).toContain(locale === "ar" ? "الشاهد" : "Witness");
      expect(markup).toContain("CF-20_INVESTIGATION_ASSIGNED");
      expect(markup).not.toMatch(/case_reference|\{\{/);
      expect(markup).not.toMatch(/case_id" value="0c[^"]*"[\s\S]*case_id" value=/); // one case id field only
      expect(scrollRegionProblems(markup)).toEqual([]);
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

  it("duplicate and error show the reference only, as alerts", async () => {
    const dup = html(await tab(SECRETARY, 1, { duplicate: CORRELATION }));
    expect(dup).toMatch(/role="alert" data-testid="draft-duplicate"/);
    expect(dup).toContain(CORRELATION);
    const err = html(await tab(SECRETARY, 1, { ref: CORRELATION }), "en");
    expect(err).toContain('data-testid="draft-error"');
    expect(err).toContain(`data-testid="correlation-id">${CORRELATION}`);
    expect(err).toContain("Nothing changed");
  });

  it("the key differs on every render (a resubmitted old form is the duplicate, a new form is new)", async () => {
    const key = (m: string) => m.match(/name="idempotency_key" value="([0-9a-f]{64})"/)?.[1];
    expect(key(html(await tab()))).not.toBe(key(html(await tab())));
    expect(UUID.test(caseIdOf(1))).toBe(true);
  });
});
