// Case summary: the list/detail header shape every case source returns. Synthetic data only.
import { z } from "zod";
import { CaseIdSchema, UuidSchema } from "./ids";

/** Display identifier of a synthetic case. Never a key: lookups always use case_id and are authorised. */
export const CASE_NUMBER_PATTERN = /^CDF-DEMO-2026-\d{4}$/;

/** Upper-snake code, e.g. a lifecycle stage or source system. The stage catalogue belongs to lib/domain (PROC). */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
/** i18n message key "<namespace>.<key>", dotted camelCase segments, e.g. "case.title.procurementReview" (lib/i18n). */
export const I18N_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
// Printable text without control characters (synthetic titles and source references).
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

export const RecordsStateSchema = z.enum(["ACTIVE", "CLOSED"]);
export type RecordsState = z.infer<typeof RecordsStateSchema>;

export const LifecycleStageSchema = z.string().regex(CODE, "must be an upper-snake stage code");
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;

export const SourceSystemSchema = z.string().regex(CODE, "must be an upper-snake source system code");

/** Reference of the case in its source system; the same pattern the database enforces (case_record.source_ref). */
export const SOURCE_REF_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

const TitleTextSchema = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);
/** A synthetic free-text title in both languages (case_record.title_ar / title_en); the page picks the language. */
export const SyntheticTitleSchema = z.strictObject({ ar: TitleTextSchema, en: TitleTextSchema });
export type SyntheticTitle = z.infer<typeof SyntheticTitleSchema>;

export const CaseSummarySchema = z
  .strictObject({
    case_id: CaseIdSchema,
    case_number: z.string().regex(CASE_NUMBER_PATTERN, "must look like CDF-DEMO-2026-0001"),
    /** Exactly one of title_key (dictionary key) or synthetic_title (synthetic free text, ar + en) is set. */
    title_key: z.string().regex(I18N_KEY_PATTERN, "must be an i18n key").nullable(),
    synthetic_title: SyntheticTitleSchema.nullable(),
    lifecycle_stage: LifecycleStageSchema,
    is_restricted: z.boolean(),
    records_state: RecordsStateSchema,
    source_system: SourceSystemSchema,
    source_ref: z.string().regex(SOURCE_REF_PATTERN, "must match the database's source_ref pattern"),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .refine((c) => (c.title_key === null) !== (c.synthetic_title === null), {
    message: "exactly one of title_key or synthetic_title must be set",
    path: ["title_key"],
  });
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

/** A persona's capacity on a case (case_assignment.capacity, case-registry data), in DB's precedence order. */
export const CASE_CAPACITIES = [
  "LEAD_INVESTIGATOR",
  "INVESTIGATOR",
  "SECRETARY",
  "GOVERNANCE_REVIEWER",
] as const;
export const CaseCapacitySchema = z.enum(CASE_CAPACITIES);
export type CaseCapacity = z.infer<typeof CaseCapacitySchema>;

/**
 * The case header view (SCREENS S3): the summary plus the requesting identity's own active capacity on the case
 * (null when it holds none). Returned by CaseSourceAdapter.getCase; never shown for another identity.
 */
export type CaseHeader = CaseSummary & { readonly my_capacity: CaseCapacity | null };

/** Rows the database returns per portfolio_page call at most (migration 0003, E02). */
export const PORTFOLIO_DB_ROW_BOUND = 100;
/** Largest page a caller may ask for: the adapter reads one look-ahead row to know whether a next page exists. */
export const PORTFOLIO_PAGE_MAX = PORTFOLIO_DB_ROW_BOUND - 1;

/** Filter for listing cases. Authorisation is applied by the adapter before filtering, counting or paging. */
export const CaseListFilterSchema = z.strictObject({
  records_state: RecordsStateSchema.optional(),
  lifecycle_stage: LifecycleStageSchema.optional(),
  /** Free-text match on case number or title; applied only to cases the identity may already see. */
  text: z.string().trim().min(1).max(100).regex(NO_CONTROL_CHARS).optional(),
  limit: z.number().int().min(1).max(PORTFOLIO_PAGE_MAX).default(25),
  /** Opaque cursor returned by the previous page. */
  cursor: z.string().min(1).max(512).optional(),
  /** Only cases where the identity holds an active case assignment (any capacity); task-only assignees do not count. */
  assigned_to_me: z.boolean().default(false),
});
export type CaseListFilter = z.input<typeof CaseListFilterSchema>;

/**
 * Per-row portfolio summaries, computed by the source after authorisation (SCREENS S2): the case's last recorded
 * procedural event (both null when it has none) and the identity's own open tasks in that case.
 */
export const CaseListExtrasSchema = z
  .strictObject({
    last_event_id: UuidSchema.nullable(),
    last_event_at: z.iso.datetime({ offset: true }).nullable(),
    my_open_task_count: z.number().int().min(0).max(10_000),
  })
  .refine((x) => (x.last_event_id === null) === (x.last_event_at === null), {
    message: "last_event_id and last_event_at are set together",
    path: ["last_event_id"],
  });
export type CaseListExtras = z.infer<typeof CaseListExtrasSchema>;

/** One portfolio row: the case summary plus its row summaries. */
export type CaseListItem = CaseSummary & CaseListExtras;

/**
 * One page of authorised cases. `total` counts only cases the identity may see that match the same filters (cursor
 * aside): it is computed after authorisation, in the same request transaction as the page, so it never reveals an
 * unauthorised case (§40; ARCH, 28 Oct 2026).
 */
export interface CaseListPage {
  readonly items: readonly CaseListItem[];
  readonly next_cursor: string | null;
  readonly total: number;
}
