// V13-FE-006 part 3: the in-case preview. Loader order (URL value → keyed read under RLS → binding → projection →
// renderer), the ARCH rulings of 31 Oct (one case_record object to buildModelFromRecords and projectForRecipient, no
// access_list, only the projected result rendered, one generic state with the correlation id on any binding error),
// the OI-037 state for every database recipient class the policy does not know, and the markup (UX-006's sandboxed
// frame, no content in the other states). Fake readers; the SQL adapter is covered in
// v13-notification-preview-adapter.spec.ts and against the database in tests/integration/fe/notification-preview.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreviewReader } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import { loadCaseWorkspace, type CaseWorkspaceView } from "@/lib/server/case-workspace";
import { AppError } from "@/lib/server/errors";
import {
  loadNotificationPreview,
  previewHref,
  previewParamOf,
  PREVIEW_PARAM,
  type NotificationPreviewView,
} from "@/lib/server/notification-preview";
import {
  CaseWorkspace,
  NotificationPreviewSection,
} from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import type * as ModelFromRecords from "@/lib/notifications/binding/model-from-records";
import type * as ServerProjection from "@/lib/notifications/binding/server-projection";
import type * as Platform from "@/lib/notifications/render/platform";
import { caseIdOf, createFakeCaseSource, FAKE_CASES } from "./support/fake-case-source";
import { createFakeNotificationRecords, createFakeProceduralRecords } from "./support/fake-records";
import {
  createFakeNotificationPreview,
  previewNotificationIdOf,
  previewRecord,
} from "./support/fake-notification-preview";
import { CORRELATION, ctxFor, INVESTIGATOR_BETA, SECRETARY } from "./support/identities";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));

const spies = vi.hoisted(() => ({
  build: vi.fn(),
  project: vi.fn(),
  render: vi.fn(),
}));
vi.mock("@/lib/notifications/binding/model-from-records", async (orig) => {
  const actual = await orig<typeof ModelFromRecords>();
  spies.build.mockImplementation(actual.buildModelFromRecords);
  return { ...actual, buildModelFromRecords: spies.build };
});
vi.mock("@/lib/notifications/binding/server-projection", async (orig) => {
  const actual = await orig<typeof ServerProjection>();
  spies.project.mockImplementation(actual.projectForRecipient);
  return { ...actual, projectForRecipient: spies.project };
});
vi.mock("@/lib/notifications/render/platform", async (orig) => {
  const actual = await orig<typeof Platform>();
  spies.render.mockImplementation(actual.renderPlatform);
  return { ...actual, renderPlatform: spies.render };
});

beforeEach(() => {
  logServerError.mockClear();
  spies.build.mockClear();
  spies.project.mockClear();
  spies.render.mockClear();
});

const summaryOf = (i: number) => FAKE_CASES[i - 1]!;
const WITNESS_1 = previewRecord(1, 1);
const WITNESS_1_AR = previewRecord(1, 2, { language: "ar" });
const WITNESS_9 = previewRecord(9, 1);
const UNMAPPED = ["CASE_TEAM", "COMMITTEE_MEMBERS", "SUBJECT_EMPLOYEE", "GOVERNANCE"] as const;
const unmappedRows = UNMAPPED.map((rc, k) => previewRecord(1, 10 + k, { recipient_class: rc }));
const ROWS = [WITNESS_1, WITNESS_1_AR, WITNESS_9, ...unmappedRows, previewRecord(3, 1)];

function deps(identity = SECRETARY, reader: NotificationPreviewReader = createFakeNotificationPreview(ROWS)) {
  return { ctx: ctxFor(identity), reader, procedural: createFakeProceduralRecords() };
}
const load = (raw: string | undefined, i = 1, identity = SECRETARY, reader?: NotificationPreviewReader) =>
  loadNotificationPreview(deps(identity, reader), summaryOf(i), raw);

describe("previewParamOf and previewHref", () => {
  it("reads one string value and marks anything else as malformed", () => {
    expect(PREVIEW_PARAM).toBe("n");
    expect(previewParamOf(undefined)).toBeUndefined();
    expect(previewParamOf({})).toBeUndefined();
    expect(previewParamOf({ n: "abc" })).toBe("abc");
    expect(previewParamOf({ n: ["abc"] })).toBe("abc");
    expect(previewParamOf({ n: ["a", "b"] })).toBe("");
    expect(previewParamOf({ n: 7 })).toBe("");
  });
  it("links by the case UUID and the notification UUID only", () => {
    expect(previewHref(caseIdOf(1), WITNESS_1.notification_id)).toBe(
      `/cases/${caseIdOf(1)}/notifications?n=${WITNESS_1.notification_id}`,
    );
  });
});

describe("loadNotificationPreview", () => {
  it("shows nothing without ?n= and reads nothing", async () => {
    const reader = createFakeNotificationPreview(ROWS);
    expect(await load(undefined, 1, SECRETARY, reader)).toEqual({ kind: "none" });
    expect(reader.calls).toEqual([]);
  });

  it("renders a WITNESS notification of this case in its template language, from the projected model only", async () => {
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind).toBe("preview");
    if (v.kind !== "preview") return;
    expect(v.notificationId).toBe(WITNESS_1.notification_id);
    expect(v.lang).toBe("en");
    expect(v.html).toMatch(/^<!DOCTYPE html>/);
    expect(v.html).toContain('data-marking="DESIGN_PREVIEW"');
    expect(v.html).toContain('<html lang="en" dir="ltr">');
    expect(v.html).not.toMatch(/<script|javascript:|\son[a-z]+=/i);
    expect(v.title).toContain("DESIGN_PREVIEW");
    // the renderer received exactly what projectForRecipient returned
    expect(spies.render).toHaveBeenCalledTimes(1);
    expect(spies.render.mock.calls[0]?.[0]).toBe(spies.project.mock.results[0]?.value);
    expect(spies.render.mock.calls[0]?.[1]).toEqual({ lang: "en" });
    const ar = await load(WITNESS_1_AR.notification_id);
    expect(ar.kind === "preview" && ar.lang).toBe("ar");
  });

  it("passes the same case_record object to buildModelFromRecords and projectForRecipient, never an access_list", async () => {
    await load(WITNESS_1.notification_id);
    const built = spies.build.mock.calls[0]?.[0];
    const projected = spies.project.mock.calls[0];
    expect(built.case_record).toBe(projected?.[1].case_record);
    expect(built.case_record).toEqual({
      id: caseIdOf(1),
      display_number: "CDF-DEMO-2026-0001",
      is_restricted: false,
      records_state: "ACTIVE",
    });
    expect(Object.isFrozen(built.case_record)).toBe(true);
    expect(projected?.[1]).not.toHaveProperty("access_list");
    expect(projected?.[1].recipient_row).toEqual({ case_id: caseIdOf(1), recipient_class: "WITNESS" });
    expect(projected?.[2]).toEqual({ channel: "PLATFORM" });
    // the model the projection got is the one the records built
    expect(projected?.[0]).toBe(spies.build.mock.results[0]?.value);
    expect(built.notification.case_id).toBe(caseIdOf(1));
    expect(built.events.every((e: { case_id: string }) => e.case_id === caseIdOf(1))).toBe(true);
  });

  it("negative: a restricted case (0009) fails closed with the generic state while no read returns the access-list result", async () => {
    const v = await load(WITNESS_9.notification_id, 9, INVESTIGATOR_BETA);
    expect(v).toEqual({ kind: "unavailable", correlationId: CORRELATION });
    expect(spies.render).not.toHaveBeenCalled();
    expect(logServerError).toHaveBeenCalledTimes(1);
    const [event, correlation, error] = logServerError.mock.calls[0]!;
    expect(event).toBe("notification_preview_error");
    expect(correlation).toBe(CORRELATION);
    expect((error as { code?: string }).code).toBe("NO_ACCESS_LIST_RESULT");
  });

  it.each(UNMAPPED.map((rc, k) => [rc, unmappedRows[k]!] as const))(
    "negative: %s (a database class the policy does not know, OI-037) shows the OI-037 state and renders nothing",
    async (rc, row) => {
      const v = await load(row.notification_id);
      expect(v).toEqual({ kind: "unmapped", notificationId: row.notification_id, recipientClass: rc });
      expect(spies.render).not.toHaveBeenCalled();
      expect(logServerError).not.toHaveBeenCalled();
    },
  );

  it("negative: unknown, malformed, other-case and hidden-case ids all give the same generic state", async () => {
    const reader = createFakeNotificationPreview(ROWS);
    const outcomes = [
      await load(previewNotificationIdOf(1, 99), 1, SECRETARY, reader), // unknown
      await load(previewRecord(3, 1).notification_id, 1, SECRETARY, reader), // case 0003's row under case 0001
      await load(WITNESS_9.notification_id, 9, SECRETARY, reader), // 0009 is hidden from Alpha
      await load("CDF-DEMO-2026-0001", 1, SECRETARY, reader), // display number
      await load("", 1, SECRETARY, reader),
      await load(WITNESS_1.notification_id.toUpperCase(), 1, SECRETARY, reader),
      await load(`${WITNESS_1.notification_id} `, 1, SECRETARY, reader),
    ];
    for (const v of outcomes) expect(v).toEqual({ kind: "unavailable", correlationId: CORRELATION });
    // malformed values never reach the reader
    expect(reader.calls.map((c) => c.notificationId)).toEqual([
      previewNotificationIdOf(1, 99),
      previewRecord(3, 1).notification_id,
      WITNESS_9.notification_id,
    ]);
    // every read is keyed by the authorised case
    expect(reader.calls.map((c) => c.caseId)).toEqual([caseIdOf(1), caseIdOf(1), caseIdOf(9)]);
    expect(spies.build).not.toHaveBeenCalled();
    expect(logServerError).not.toHaveBeenCalled();
  });

  it("negative: a reader row of another case is refused by the binding (CASE_MISMATCH), generic state", async () => {
    const rogue: NotificationPreviewReader = {
      getForCase: async () => previewRecord(3, 1),
    };
    expect(await load(WITNESS_1.notification_id, 1, SECRETARY, rogue)).toEqual({
      kind: "unavailable",
      correlationId: CORRELATION,
    });
    expect((logServerError.mock.calls[0]?.[2] as { code?: string }).code).toBe("CASE_MISMATCH");
    expect(spies.render).not.toHaveBeenCalled();
  });

  it("negative: a lifecycle status without delivery wording (SUPERSEDED) is refused, generic state", async () => {
    const row = previewRecord(1, 1, { lifecycle_status: "SUPERSEDED" });
    expect(await load(row.notification_id, 1, SECRETARY, createFakeNotificationPreview([row]))).toEqual({
      kind: "unavailable",
      correlationId: CORRELATION,
    });
    expect((logServerError.mock.calls[0]?.[2] as { code?: string }).code).toBe("UNSUPPORTED_LIFECYCLE_STATUS");
  });

  it("negative: a read failure is generic and logged by code only; NOT_FOUND and UNAUTHENTICATED go to the page", async () => {
    const failing = (e: unknown): NotificationPreviewReader => ({
      getForCase: async () => {
        throw e;
      },
    });
    const raw = Object.assign(new Error("relation secret_table does not exist"), { code: "42P01" });
    expect(await load(WITNESS_1.notification_id, 1, SECRETARY, failing(raw))).toEqual({
      kind: "unavailable",
      correlationId: CORRELATION,
    });
    expect(logServerError).toHaveBeenCalledWith("notification_preview_error", CORRELATION, raw);
    await expect(load(WITNESS_1.notification_id, 1, SECRETARY, failing(new AppError("NOT_FOUND")))).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      load(WITNESS_1.notification_id, 1, SECRETARY, failing(new AppError("UNAUTHENTICATED"))),
    ).rejects.toThrow("UNAUTHENTICATED");
  });

  it("the same records give the same preview", async () => {
    const a = await load(WITNESS_1.notification_id);
    const b = await load(WITNESS_1.notification_id);
    expect(a).toEqual(b);
  });
});

describe("Case Workspace notifications tab with the preview", () => {
  const tab = async (raw: string | undefined, preview?: NotificationPreviewReader) =>
    loadCaseWorkspace(
      {
        ctx: ctxFor(SECRETARY),
        source: createFakeCaseSource(),
        procedural: createFakeProceduralRecords(),
        notifications: createFakeNotificationRecords(),
        ...(preview ? { preview } : {}),
        ...(raw === undefined ? {} : { previewId: raw }),
      },
      caseIdOf(1),
      "notifications",
    );
  const html = (v: CaseWorkspaceView, locale: Locale = "ar") =>
    renderToStaticMarkup(<CaseWorkspace t={createTranslator(locale)} locale={locale} view={v} />);

  it("without a preview reader or ?n= the tab shows no preview section", async () => {
    const a = await tab(WITNESS_1.notification_id);
    const b = await tab(undefined, createFakeNotificationPreview(ROWS));
    for (const v of [a, b]) {
      expect(v.tab === "notifications" && v.preview).toEqual({ kind: "none" });
      expect(html(v)).not.toContain('data-testid="case-preview"');
    }
  });

  it("each row links to its preview by ids only, with a localised accessible name", async () => {
    const v = await tab(undefined, createFakeNotificationPreview(ROWS));
    if (v.tab !== "notifications") throw new Error("tab");
    const out = html(v, "en");
    for (const n of v.notifications) {
      expect(out).toContain(`data-testid="case-notification-preview-link-${n.notification_id}"`);
      expect(out).toContain(`href="/cases/${n.case_id}/notifications?n=${n.notification_id}"`);
      expect(out).toContain(`aria-label="Preview ${n.template_code} for ${n.recipient_class}"`);
    }
  });

  it("the preview renders inside UX-006's frame: sandbox=\"\", srcdoc only, lang and dir of the notice", async () => {
    const v = await tab(WITNESS_1.notification_id, createFakeNotificationPreview(ROWS));
    const out = html(v);
    expect(out).toContain('data-preview-state="preview"');
    expect(out).toMatch(/<iframe[^>]*sandbox=""/);
    expect(out).toMatch(/<iframe[^>]*srcDoc="&lt;!DOCTYPE html&gt;/i);
    expect(out).not.toMatch(/<iframe[^>]*\ssrc=/);
    expect(out).toMatch(/<iframe[^>]*lang="en"[^>]*dir="ltr"/);
    expect(out).toContain('data-testid="case-notification-preview-frame"');
    // the notice is never injected into the page outside the frame's attribute
    expect(out).not.toContain('<p class="marking" data-marking="DESIGN_PREVIEW">');
  });
});

describe("NotificationPreviewSection states", () => {
  const section = (preview: NotificationPreviewView, locale: Locale = "en") =>
    renderToStaticMarkup(
      <NotificationPreviewSection t={createTranslator(locale)} caseId={caseIdOf(1)} preview={preview} />,
    );

  it("unmapped (OI-037) names only the recipient class and renders no frame", () => {
    const out = section({ kind: "unmapped", notificationId: WITNESS_1.notification_id, recipientClass: "CASE_TEAM" });
    expect(out).toContain('data-testid="case-preview-unmapped"');
    expect(out).toContain("CASE_TEAM");
    expect(out).not.toContain("<iframe");
    expect(out).toContain(`href="/cases/${caseIdOf(1)}/notifications"`);
  });

  it("unavailable shows one generic alert with the correlation id and nothing about the notification", () => {
    for (const locale of ["ar", "en"] as const) {
      const out = section({ kind: "unavailable", correlationId: CORRELATION }, locale);
      expect(out).toContain('role="alert"');
      expect(out).toContain(`data-testid="case-preview-correlation-id">${CORRELATION}<`);
      expect(out).not.toContain("<iframe");
      expect(out).not.toMatch(/WITNESS|CASE_MISMATCH|NO_ACCESS_LIST|DESIGN_PREVIEW|0f000000/);
    }
  });

  it("none renders nothing", () => {
    expect(section({ kind: "none" })).toBe("");
  });
});
