// V13-FE-006 part 3: the in-case preview. Loader order (URL value → keyed read under RLS → binding → projection →
// renderer), the ARCH rulings of 31 Oct (one case_record object to buildModelFromRecords and projectForRecipient, no
// access_list, only the projected result rendered, one generic state with the correlation id on any binding error),
// the OI-037 state for every database recipient class the policy does not know, and the markup (UX-006's sandboxed
// frame, no content in the other states). Fake readers; the SQL adapter is covered in
// v13-notification-preview-adapter.spec.ts and against the database in tests/integration/fe/notification-preview.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { recipientClassLabel } from "@/app/(platform)/cases/[caseId]/_components/labels";
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
  NotificationTable,
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
  unrecordedPreviewRead,
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
    // The renderer's own document title keeps PROC's marking inside the frame; the view carries the disclosed event
    // title only, for the UI's frame name (UX finding on #74).
    expect(v.html).toMatch(/<title>[^<]*— DESIGN_PREVIEW<\/title>/);
    expect(v.eventTitle).toBe(WITNESS_1.template_name.en);
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
      getForCase: unrecordedPreviewRead,
      getForCaseRecorded: async () => previewRecord(3, 1),
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
    expect((logServerError.mock.calls[0]?.[2] as { code?: string }).code).toBe(
      "UNSUPPORTED_LIFECYCLE_STATUS",
    );
  });

  it("negative: a read failure is generic and logged by code only; NOT_FOUND and UNAUTHENTICATED go to the page", async () => {
    const failing = (e: unknown): NotificationPreviewReader => ({
      getForCase: unrecordedPreviewRead,
      getForCaseRecorded: async () => {
        throw e;
      },
    });
    const raw = Object.assign(new Error("relation secret_table does not exist"), { code: "42P01" });
    expect(await load(WITNESS_1.notification_id, 1, SECRETARY, failing(raw))).toEqual({
      kind: "unavailable",
      correlationId: CORRELATION,
    });
    expect(logServerError).toHaveBeenCalledWith("notification_preview_error", CORRELATION, raw);
    await expect(
      load(WITNESS_1.notification_id, 1, SECRETARY, failing(new AppError("NOT_FOUND"))),
    ).rejects.toThrow("NOT_FOUND");
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
      const label = out.match(
        new RegExp(
          `aria-label="([^"]*)"[^>]*data-testid="case-notification-preview-link-${n.notification_id}"`,
        ),
      )?.[1];
      expect(label).toBe(
        `Preview ${n.template_name.en} for ${recipientClassLabel(createTranslator("en"), n.recipient_class)}`,
      );
      // QA CHANGES 982bd76: a screen reader never hears raw codes.
      expect(label).not.toContain(n.template_code);
      expect(label).not.toContain(n.recipient_class);
    }
  });

  it("the accessible name follows the locale (Arabic template name and class label)", async () => {
    const v = await tab(undefined, createFakeNotificationPreview(ROWS));
    if (v.tab !== "notifications") throw new Error("tab");
    const out = html(v, "ar");
    for (const n of v.notifications) {
      expect(out).toContain(`aria-label="معاينة ${n.template_name.ar} للفئة `);
      expect(out).not.toMatch(new RegExp(`aria-label="[^"]*${n.template_code}`));
    }
  });

  it('the preview renders inside UX-006\'s frame: sandbox="", srcdoc only, lang and dir in the document', async () => {
    const v = await tab(WITNESS_1.notification_id, createFakeNotificationPreview(ROWS));
    const out = html(v);
    expect(out).toContain('data-preview-state="preview"');
    expect(out).toMatch(/<iframe[^>]*sandbox=""/);
    expect(out).toMatch(/<iframe[^>]*srcDoc="&lt;!DOCTYPE html&gt;/i);
    expect(out).not.toMatch(/<iframe[^>]*\ssrc=/);
    // V13-UX-011 (UXB-13): the frame element carries no lang or dir, so its name takes the page language; the
    // notice's language and direction are declared by the document in srcdoc.
    const frame = (out.match(/<iframe[^>]*>/)?.[0] ?? "").replace(/ srcDoc="[^"]*"/i, "");
    expect(frame).not.toMatch(/ lang=| dir=/);
    expect(out).toMatch(
      /<iframe[^>]*srcDoc="&lt;!DOCTYPE html&gt;[^"]*&lt;html lang=&quot;en&quot; dir=&quot;ltr&quot;&gt;/i,
    );
    expect(out).toContain('data-testid="case-notification-preview-frame"');
    // the notice is never injected into the page outside the frame's attribute
    expect(out).not.toContain('<p class="marking" data-marking="DESIGN_PREVIEW">');
  });
});

// SEC CHANGES 61d2853: the frame's accessible name takes only what the projection discloses for event_title. The
// projector's outcomes (lib/disclosure/project.ts) are stubbed on the real projection of WITNESS_1, and the renderer is
// stubbed so that it does not judge the stub; the loader's eventTitle and the frame name built from it are checked.
describe("frame title from the projection's event_title (withheld, safe reference, generalized)", () => {
  const ORIGINAL = WITNESS_1.template_name.en;
  const TOKEN = "SR-7f3a9c";
  const RENDERED = {
    html: '<!DOCTYPE html><html><body><p class="marking" data-marking="DESIGN_PREVIEW">DESIGN_PREVIEW</p></body></html>',
    text: "",
    components: [],
    title: `${ORIGINAL} — DESIGN_PREVIEW`,
  };
  type Fields = Record<string, unknown>;
  function withEventTitle(edit: (fields: Fields) => void) {
    const actual = spies.project.getMockImplementation()!;
    spies.project.mockImplementationOnce((...args: Parameters<typeof actual>) => {
      const real = actual(...args) as unknown as { fields: Fields };
      const fields: Fields = { ...real.fields };
      edit(fields);
      return { ...real, fields } as unknown as ReturnType<typeof actual>;
    });
    spies.render.mockImplementationOnce(() => RENDERED as never);
  }
  const frameName = (eventTitle: string | null, locale: Locale) =>
    renderToStaticMarkup(
      <NotificationPreviewSection
        t={createTranslator(locale)}
        caseId={caseIdOf(1)}
        preview={{
          kind: "preview",
          notificationId: WITNESS_1.notification_id,
          html: RENDERED.html,
          text: RENDERED.text,
          eventTitle,
          lang: "en",
        }}
      />,
    ).match(/<iframe[^>]*\stitle="([^"]*)"/)?.[1];

  it("control: the real projection discloses the title (ALLOWED)", async () => {
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind === "preview" && v.eventTitle).toBe(ORIGINAL);
  });

  it("PROHIBITED / REDACTED (field absent): null, the frame says the generic word", async () => {
    withEventTitle((f) => {
      delete f.event_title;
    });
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind).toBe("preview");
    if (v.kind !== "preview") return;
    expect(v.eventTitle).toBeNull();
    expect(frameName(v.eventTitle, "en")).toBe("Notification — design preview");
    expect(frameName(v.eventTitle, "ar")).toBe("إشعار — عرض تجريبي");
    for (const locale of ["ar", "en"] as const)
      expect(frameName(v.eventTitle, locale)).not.toContain(ORIGINAL);
  });

  it("an explicit null is withheld too", async () => {
    withEventTitle((f) => {
      f.event_title = null;
    });
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind === "preview" && v.eventTitle).toBeNull();
  });

  it("SAFE_REFERENCE: null; neither the token nor its label reaches the frame name", async () => {
    withEventTitle((f) => {
      f.event_title = { safe_reference: true, token: TOKEN, label: "Reference" };
    });
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind).toBe("preview");
    if (v.kind !== "preview") return;
    expect(v.eventTitle).toBeNull();
    for (const locale of ["ar", "en"] as const) {
      const name = frameName(v.eventTitle, locale)!;
      expect(name).not.toContain(TOKEN);
      expect(name).not.toContain("Reference");
      expect(name).not.toContain(ORIGINAL);
    }
  });

  it("GENERALIZED: the class-safe generic text in the notice's language, never the original title", async () => {
    withEventTitle((f) => {
      f.event_title = { generalized: true, ar: "إشعار إجرائي", en: "Procedural notice" };
    });
    const v = await load(WITNESS_1.notification_id);
    expect(v.kind).toBe("preview");
    if (v.kind !== "preview") return;
    expect(v.eventTitle).toBe("Procedural notice");
    expect(frameName(v.eventTitle, "ar")).toBe("Procedural notice — عرض تجريبي");
    for (const locale of ["ar", "en"] as const)
      expect(frameName(v.eventTitle, locale)).not.toContain(ORIGINAL);
  });

  it("anything else (blank string, a pair without the notice's language, a number) is withheld", async () => {
    for (const value of ["   ", { ar: "عنوان" }, 42, { en: "" }]) {
      withEventTitle((f) => {
        f.event_title = value;
      });
      const v = await load(WITNESS_1.notification_id);
      expect(v.kind === "preview" && v.eventTitle, JSON.stringify(value)).toBeNull();
    }
  });
});

describe("NotificationPreviewSection states", () => {
  const section = (preview: NotificationPreviewView, locale: Locale = "en") =>
    renderToStaticMarkup(
      <NotificationPreviewSection t={createTranslator(locale)} caseId={caseIdOf(1)} preview={preview} />,
    );

  it("unmapped (OI-037) names only the recipient class and renders no frame", () => {
    const out = section({
      kind: "unmapped",
      notificationId: WITNESS_1.notification_id,
      recipientClass: "CASE_TEAM",
    });
    expect(out).toContain('data-testid="case-preview-unmapped"');
    // QA CHANGES 982bd76: the class label, with the code beside it in <bdi> (the CodeLabel pattern).
    expect(out).toContain(
      'Recipient class: Case team <bdi dir="ltr" data-testid="case-preview-unmapped-code">CASE_TEAM</bdi>',
    );
    expect(out).not.toMatch(/class [A-Z_]{4,} has/);
    expect(out).not.toContain("<iframe");
    expect(out).toContain(`href="/cases/${caseIdOf(1)}/notifications"`);
  });

  it("unmapped with a class outside the catalogue shows the code alone in <bdi>, never blank", () => {
    for (const locale of ["ar", "en"] as const) {
      const out = section(
        { kind: "unmapped", notificationId: WITNESS_1.notification_id, recipientClass: "NEW_CLASS" },
        locale,
      );
      expect(out).toContain('<bdi dir="ltr" data-testid="case-preview-unmapped-code">NEW_CLASS</bdi>');
    }
  });

  it("the frame's accessible name is a UI string: event title + the localised preview word, no raw marking", () => {
    const base = {
      kind: "preview" as const,
      notificationId: WITNESS_1.notification_id,
      html: '<!DOCTYPE html><html><body><p class="marking" data-marking="DESIGN_PREVIEW">DESIGN_PREVIEW</p></body></html>',
      text: "DESIGN_PREVIEW",
      lang: "en" as const,
    };
    const titleOf = (out: string) => out.match(/<iframe[^>]*\stitle="([^"]*)"/)?.[1];
    expect(titleOf(section({ ...base, eventTitle: "Investigation assigned" }, "en"))).toBe(
      "Investigation assigned — design preview",
    );
    expect(titleOf(section({ ...base, eventTitle: "إسناد التحقيق" }, "ar"))).toBe(
      "إسناد التحقيق — عرض تجريبي",
    );
    // withheld title: a generic word, never empty and never the raw code
    expect(titleOf(section({ ...base, eventTitle: null }, "ar"))).toBe("إشعار — عرض تجريبي");
    expect(titleOf(section({ ...base, eventTitle: null }, "en"))).toBe("Notification — design preview");
    for (const locale of ["ar", "en"] as const)
      expect(titleOf(section({ ...base, eventTitle: "x" }, locale))).not.toContain("DESIGN_PREVIEW");
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

// V13-FE-011 (REQ-NOTIF-011, PROC-021): the plain-text twin of the same rendering, shown under the frame as escaped
// text in the notice's language. It comes from the renderer's output for the projected model, never from the record.
describe("plain-text version of the preview (V13-FE-011)", () => {
  const section = (preview: NotificationPreviewView, locale: Locale = "en") =>
    renderToStaticMarkup(
      <NotificationPreviewSection t={createTranslator(locale)} caseId={caseIdOf(1)} preview={preview} />,
    );
  const base = {
    kind: "preview" as const,
    notificationId: WITNESS_1.notification_id,
    html: '<!DOCTYPE html><html><body><p class="marking" data-marking="DESIGN_PREVIEW">DESIGN_PREVIEW</p></body></html>',
    eventTitle: "Investigation assigned",
    lang: "en" as const,
  };

  it("the loader's text is the renderer's text twin for the projected model, in the notice's language", async () => {
    for (const row of [WITNESS_1, WITNESS_1_AR]) {
      spies.render.mockClear();
      const v = await load(row.notification_id);
      if (v.kind !== "preview") throw new Error(v.kind);
      const rendered = spies.render.mock.results[0]?.value as { text: string; html: string };
      expect(spies.render.mock.calls[0]?.[0]).toBe(spies.project.mock.results.at(-1)?.value);
      expect(v.text).toBe(rendered.text);
      expect(v.text).not.toBe("");
      expect(v.text.split("\n")[0]).toContain("DESIGN_PREVIEW");
      // plain text: none of the HTML document travels in it
      expect(v.text).not.toMatch(/<!DOCTYPE|<html|<style|<\/?[a-z][a-z0-9]*[\s>]/i);
      expect(v.text).toContain(row.template_name[v.lang]);
    }
  });

  it("is shown closed under the frame, in a native disclosure with a localised summary", () => {
    for (const [locale, summary] of [
      ["en", "Plain-text version"],
      ["ar", "النسخة النصية"],
    ] as const) {
      const out = section({ ...base, text: "DESIGN_PREVIEW\n\nBody" }, locale);
      const details = out.match(/<details[^>]*data-testid="case-preview-text"[^>]*>/)?.[0] ?? "";
      expect(details).not.toBe("");
      expect(details).not.toMatch(/\sopen/);
      expect(out).toContain(`<summary data-testid="case-preview-text-toggle">${summary}</summary>`);
      // UXB-13: no UI-language label on the element tagged with the notice's language; the summary is outside it
      const pre = out.match(/<pre[^>]*>/)?.[0] ?? "";
      expect(pre).not.toMatch(/aria-label|title=/);
      expect(out.indexOf("<summary")).toBeLessThan(out.indexOf("<pre"));
      // after the frame, inside the ready state
      expect(out.indexOf("<iframe")).toBeLessThan(out.indexOf('data-testid="case-preview-text"'));
    }
  });

  it("takes the notice's language and direction, not the page's", () => {
    const pre = (out: string) => out.match(/<pre[^>]*data-testid="case-preview-text-body"[^>]*>/)?.[0] ?? "";
    expect(pre(section({ ...base, text: "x" }, "ar"))).toMatch(/lang="en"[^>]*dir="ltr"/);
    expect(pre(section({ ...base, lang: "ar", text: "x" }, "en"))).toMatch(/lang="ar"[^>]*dir="rtl"/);
  });

  it("is escaped text: markup in it is never injected into the page", () => {
    const out = section({ ...base, text: '<script>alert(1)</script><img src=x onerror="y"> & </pre>' });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;y&quot;&gt; &amp; &lt;/pre&gt;",
    );
  });

  it("the unmapped and unavailable states have no text version", () => {
    for (const preview of [
      { kind: "unmapped", notificationId: WITNESS_1.notification_id, recipientClass: "CASE_TEAM" },
      { kind: "unavailable", correlationId: CORRELATION },
      { kind: "none" },
    ] as const) {
      expect(section(preview)).not.toContain("case-preview-text");
    }
  });
});

describe("M1-07: the Notifications tab shows labels and the template's name, not raw codes", () => {
  const table = (rows: Parameters<typeof NotificationTable>[0]["notifications"], locale: Locale) =>
    renderToStaticMarkup(
      <NotificationTable
        t={createTranslator(locale)}
        locale={locale}
        caseRef="CDF-DEMO-2026-0001"
        notifications={rows}
      />,
    );
  const row = (over: Partial<ReturnType<typeof previewRecord>> = {}) => previewRecord(1, 1, over);

  it("labels the status and the recipient class in both languages; DISPATCHED never reads delivered", () => {
    const rows = [
      row({ lifecycle_status: "DRAFT", recipient_class: "CASE_TEAM" }),
      row({
        notification_id: previewNotificationIdOf(1, 2),
        lifecycle_status: "DISPATCHED",
        recipient_class: "WITNESS",
      }),
    ];
    const en = table(rows, "en");
    expect(en).toContain(">Draft<");
    expect(en).toContain(">Case team<");
    expect(en).toContain(">Sent — delivery not confirmed<");
    expect(en).toContain(">Witness<");
    expect(en).not.toMatch(/>(DRAFT|CASE_TEAM|DISPATCHED|WITNESS)</);
    expect(en).not.toMatch(/delivered/i);
    // the codes stay on the cells as data for tests, never as visible text
    expect(en).toContain('data-lifecycle-status="DISPATCHED"');
    expect(en).toContain('data-recipient-class="CASE_TEAM"');
    const ar = table(rows, "ar");
    expect(ar).toContain(">مسودة<");
    expect(ar).toContain(">فريق القضية<");
    expect(ar).toContain(">أُرسل — لم يُؤكَّد التسليم<");
    expect(ar).toContain(">الشاهد<");
  });

  it("shows the template's catalogue name in the page language beside its code (Latin, isolated)", () => {
    const en = table([row()], "en");
    expect(en).toContain('data-testid="case-notification-template-name">Meeting invitation<');
    expect(en).toMatch(
      /<bdi dir="ltr"[^>]*data-testid="case-notification-template-code">CF-24_MEETING_INVITATION</,
    );
    expect(table([row()], "ar")).toContain('data-testid="case-notification-template-name">دعوة اجتماع<');
  });

  it("negative: a code without a label is shown as written, isolated, never blank", () => {
    const out = table([row({ lifecycle_status: "ON_HOLD", recipient_class: "AUDITOR" })], "en");
    expect(out).toMatch(/data-lifecycle-status="ON_HOLD"><bdi dir="ltr">ON_HOLD<\/bdi>/);
    expect(out).toMatch(/data-recipient-class="AUDITOR"><bdi dir="ltr">AUDITOR<\/bdi>/);
  });

  it("negative: a code that names an Object property is not a label (own keys only)", () => {
    const out = table([row({ lifecycle_status: "constructor", recipient_class: "toString" })], "en");
    expect(out).toContain('<bdi dir="ltr">constructor</bdi>');
    expect(out).toContain('<bdi dir="ltr">toString</bdi>');
  });
});
