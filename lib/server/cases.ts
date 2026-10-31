// BFF read services for cases (FE-001). Order of every call: request context → lib/authz pre-check → adapter inside
// the database security context. Unknown, malformed, unauthorised, other-workspace and restricted ids all end in the
// same AppError("NOT_FOUND"); pages turn it into notFound(), the same page as an unknown route.
import "server-only";
import {
  CaseListFilterSchema,
  type CaseListFilter,
  type CaseListPage,
  type CaseSourceAdapter,
  type CaseHeader,
  InvalidCursorError,
} from "@/lib/contracts";
import { parseCaseId, precheck } from "@/lib/authz";
import type { RequestContext } from "./context";
import { AppError } from "./errors";

export interface CaseServiceDeps {
  readonly ctx: RequestContext;
  readonly source: CaseSourceAdapter;
}

/** One case for a route segment. `rawCaseId` is the untrusted route parameter. */
export async function getCaseForRoute(
  { ctx, source }: CaseServiceDeps,
  rawCaseId: unknown,
): Promise<CaseHeader> {
  const caseId = parseCaseId(rawCaseId);
  if (!caseId || !precheck(ctx.identity, "case.read", { caseId }).allow) throw new AppError("NOT_FOUND");
  const found = await source.getCase(ctx.identity, caseId);
  // Defence in depth: the adapter must return the case asked for, or nothing.
  if (!found || found.case_id !== caseId) throw new AppError("NOT_FOUND");
  return found;
}

/** One authorised portfolio page. `rawFilter` is untrusted (query string); invalid input is VALIDATION. */
export async function listPortfolio(
  { ctx, source }: CaseServiceDeps,
  rawFilter: unknown,
): Promise<CaseListPage> {
  if (!precheck(ctx.identity, "portfolio.read").allow) throw new AppError("NOT_FOUND");
  const filter = CaseListFilterSchema.safeParse(rawFilter ?? {});
  if (!filter.success) throw new AppError("VALIDATION");
  try {
    return await source.listCases(ctx.identity, filter.data satisfies CaseListFilter);
  } catch (error) {
    if (error instanceof InvalidCursorError) throw new AppError("VALIDATION");
    throw error;
  }
}
