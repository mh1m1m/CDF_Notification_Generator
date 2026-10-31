import "server-only";
/**
 * Server binding of the W-D2 projection (OPEN_ISSUES OI-035, SEC's two LOWs on #40).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * `project()` accepts a context from its caller and, when none is given, falls back to `model.meta.context` and then to
 * `*`, the least restrictive context. A caller that passes `on_access_list: true` also drops CASE_RESTRICTED. That is
 * right for the reference fixtures, which describe the case and the recipient inline, but a server path must never let
 * the model or the request decide either value. This module is the one way server code projects a notification:
 *
 *   1. The projection context is built here, only from server records: the case row's `is_restricted` and the result of
 *      the server's access-list check for this recipient on this case. `model.meta.context` is never read, and an
 *      options object that carries a `context` is refused.
 *   2. The recipient class is the database recipient row's `recipient_class`. A model whose `meta.recipient_class`
 *      differs is refused (RECIPIENT_MISMATCH, from `project()`); a class the policy does not know is refused
 *      (UNKNOWN_RECIPIENT).
 *
 * 3. The disclosure policy is the server's committed policy (`loadPolicy()`); a caller-supplied `policy` option is
 *    refused (POLICY_NOT_ACCEPTED, SEC review of #45 at 59d420c).
 *
 * Fail closed: a missing or malformed record, a record of another case, or a restricted case without an access-list
 * result is refused (NotificationBindingError). Nothing falls back to `*`.
 *
 * CASE_PUBLIC is never derived: the policy has no row that relaxes a field for it (policy note `CASE_PUBLIC`), and the
 * case row carries no public flag. EXTERNAL is added for a referring body and for a recipient row whose delivery leaves
 * CDF; it only ever tightens.
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: the records come from the prototype's `cdf_notifications_v13` tables. In production
 * they come from the CDF case system of record through `CaseSourceAdapter` and the CDF access-list service.
 */
import { isNil } from "@/lib/domain/nil";
import {
  RECIPIENT_CLASSES,
  loadPolicy,
  project,
  type Projected,
  type ProjectedModel,
  type RecipientClass,
} from "@/lib/disclosure";

export type NotificationBindingErrorCode =
  | "NO_SERVER_CONTEXT"
  | "NO_RECIPIENT_ROW"
  | "NO_ACCESS_LIST_RESULT"
  | "CASE_MISMATCH"
  | "UNKNOWN_RECIPIENT"
  | "CONTEXT_NOT_ACCEPTED"
  | "POLICY_NOT_ACCEPTED";

export class NotificationBindingError extends Error {
  readonly code: NotificationBindingErrorCode;
  constructor(code: NotificationBindingErrorCode, message: string) {
    super(message);
    this.name = "NotificationBindingError";
    this.code = code;
  }
}

/** The case row as the server read it (`cdf_notifications_v13.case_record`). */
export interface ServerCaseRecord {
  readonly id: string;
  readonly is_restricted: boolean;
}

/** The notification's recipient row as the server read it (`notification.recipient_class`, keyed by case). */
export interface ServerRecipientRow {
  readonly case_id: string;
  readonly recipient_class: string;
  /** `EXTERNAL` when the delivery leaves CDF's boundary; anything else is internal. */
  readonly delivery_context?: string | null;
}

/** The result of the server's access-list check for this recipient on this case. */
export interface ServerAccessListResult {
  readonly case_id: string;
  readonly on_access_list: boolean;
}

export interface ServerProjectionRecords {
  readonly case_record: ServerCaseRecord;
  readonly recipient_row: ServerRecipientRow;
  /** Required when the case is restricted; ignored otherwise. */
  readonly access_list?: ServerAccessListResult | null;
}

export interface ServerProjectionOptions {
  readonly channel?: string;
}

export interface ServerProjectionContext {
  readonly recipient: RecipientClass;
  /** the `{tags, on_access_list}` form `project()` reads; tags as an array (a Set would be read as no tags) */
  readonly context: { readonly tags: readonly string[]; readonly on_access_list: boolean };
}

/** The server's policy: the committed `lib/disclosure/policy_v13.json`, loaded once. Never the caller's. */
let serverPolicy: ReturnType<typeof loadPolicy> | null = null;
const SERVER_POLICY = (): ReturnType<typeof loadPolicy> => (serverPolicy ??= loadPolicy());

const isObj = (v: unknown): v is Record<string, unknown> =>
  !isNil(v) && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isRecipientClass = (v: unknown): v is RecipientClass =>
  (RECIPIENT_CLASSES as readonly unknown[]).includes(v);

/**
 * serverProjectionContext(records) → {recipient, context}, built only from server records. Throws
 * NotificationBindingError on anything missing, malformed or of another case.
 */
export function serverProjectionContext(records: ServerProjectionRecords): ServerProjectionContext {
  if (!isObj(records)) throw new NotificationBindingError("NO_SERVER_CONTEXT", "no server records");
  const c: unknown = records.case_record;
  if (!isObj(c) || !isId(c.id) || typeof c.is_restricted !== "boolean")
    throw new NotificationBindingError("NO_SERVER_CONTEXT", "no valid case record");
  const r: unknown = records.recipient_row;
  if (!isObj(r) || !isId(r.case_id) || typeof r.recipient_class !== "string")
    throw new NotificationBindingError("NO_RECIPIENT_ROW", "no valid recipient row");
  if (r.case_id !== c.id)
    throw new NotificationBindingError("CASE_MISMATCH", "the recipient row belongs to another case");
  if (!isRecipientClass(r.recipient_class))
    throw new NotificationBindingError(
      "UNKNOWN_RECIPIENT",
      "the recipient row's class is not a policy class",
    );
  const recipient = r.recipient_class;

  const tags = new Set<string>();
  let onList = false;
  if (c.is_restricted) {
    const a: unknown = records.access_list;
    if (!isObj(a) || !isId(a.case_id) || typeof a.on_access_list !== "boolean")
      throw new NotificationBindingError(
        "NO_ACCESS_LIST_RESULT",
        "a restricted case needs the server's access-list result",
      );
    if (a.case_id !== c.id)
      throw new NotificationBindingError("CASE_MISMATCH", "the access-list result belongs to another case");
    tags.add("CASE_RESTRICTED");
    onList = a.on_access_list;
  }
  if (recipient === "REFERRING_BODY" || r.delivery_context === "EXTERNAL") tags.add("EXTERNAL");
  return Object.freeze({
    recipient,
    context: Object.freeze({ tags: Object.freeze([...tags]), on_access_list: onList }),
  });
}

/**
 * projectForRecipient(model, records, {channel}) → the projected model, with the context and the recipient
 * class taken only from the server records. `model.meta.context` is never read; a `context` or `recipient` option is
 * refused (CONTEXT_NOT_ACCEPTED), a `policy` option too (POLICY_NOT_ACCEPTED). A model that names another recipient class, or another case in `meta.case_id`, is
 * refused.
 */
export function projectForRecipient(
  model: unknown,
  records: ServerProjectionRecords,
  opts: ServerProjectionOptions = {},
): Projected<ProjectedModel> {
  if (isObj(opts) && (Object.hasOwn(opts, "context") || Object.hasOwn(opts, "recipient")))
    throw new NotificationBindingError(
      "CONTEXT_NOT_ACCEPTED",
      "the context and the recipient come from server records only",
    );
  if (isObj(opts) && Object.hasOwn(opts, "policy"))
    throw new NotificationBindingError(
      "POLICY_NOT_ACCEPTED",
      "the disclosure policy comes from the server's committed policy only",
    );
  const { recipient, context } = serverProjectionContext(records);
  const meta = isObj(model) && isObj(model.meta) ? model.meta : null;
  if (meta && !isNil(meta.case_id) && meta.case_id !== records.case_record.id)
    throw new NotificationBindingError("CASE_MISMATCH", "the model belongs to another case");
  return project(model, {
    recipient,
    context,
    channel: opts.channel ?? "EMAIL",
    policy: SERVER_POLICY(),
  });
}
