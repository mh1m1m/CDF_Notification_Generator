// V13-FE-017 (DB-023 D1/D2): a case tab's document title reads nothing. Next.js resolves metadata on a link prefetch and
// apart from the page on a document request, so a title that opened the case would write an access row for a prefetch
// and a second one per page (seen on a production build, see docs/teams/fe/STATUS.md). The title names the tab only:
// no request context, no case source, no records are touched, for every tab and both languages, whatever the id.
import { describe, expect, it, vi } from "vitest";
import { createTranslator, type Locale } from "@/lib/i18n";

let locale: Locale = "ar";
vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => ({ locale, t: createTranslator(locale) }),
  getLocale: async () => locale,
}));
const touched = vi.hoisted(() => [] as string[]);
const touch = (name: string) => () => {
  touched.push(name);
  throw new Error(`${name} must not be called for metadata`);
};
vi.mock("@/lib/server/context", () => ({ requireRequestContext: touch("requireRequestContext") }));
vi.mock("@/lib/server/case-source", () => ({ caseSourceFor: touch("caseSourceFor") }));
vi.mock("@/lib/server/records", () => ({
  proceduralRecordsFor: touch("proceduralRecordsFor"),
  notificationRecordsFor: touch("notificationRecordsFor"),
  notificationDraftsFor: touch("notificationDraftsFor"),
}));
vi.mock("@/lib/server/preview-records", () => ({ notificationPreviewFor: touch("notificationPreviewFor") }));

const { caseTabMetadata } = await import("@/app/(platform)/cases/[caseId]/_components/render");

const props = (caseId: string) => ({
  params: Promise.resolve({ caseId }),
  searchParams: Promise.resolve({ n: "2f000000-0000-4000-8000-000000000001", after: "x" }),
});

describe("case tab metadata reads no record (FE-017)", () => {
  for (const l of ["ar", "en"] as const)
    for (const tab of ["overview", "events", "tasks", "notifications"] as const)
      it(`${l} ${tab}: the tab's title, no case read`, async () => {
        locale = l;
        const t = createTranslator(l);
        const meta = await caseTabMetadata(props("0c000000-0000-4000-8000-000000000001"), tab);
        expect(meta).toEqual({
          title: t("case.documentTitle", { tab: t(`case.tab.${tab}`) }),
        });
        expect(String(meta.title)).not.toMatch(/CDF-DEMO|0c000000/);
        expect(touched).toEqual([]);
      });

  it("an unknown or hidden case id gives the same title (no existence leak)", async () => {
    locale = "en";
    const a = await caseTabMetadata(props("0c000000-0000-4000-8000-000000000001"), "tasks");
    const b = await caseTabMetadata(props("0c000000-0000-4000-8000-000000000099"), "tasks");
    expect(a).toEqual(b);
    expect(touched).toEqual([]);
  });
});
