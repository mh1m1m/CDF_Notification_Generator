// DataTable (DESIGN_SYSTEM.md §3.4; DG pp. 42–44): a native <table> with a caption, a Cinder header row, alternate
// row tint and square corners, inside a focusable, labelled scroll region (no page-level horizontal scroll). Sort
// headers are links with aria-sort. `scope: "case"` is required for any table of case-scoped rows: the type then
// demands both case accessors, and every <tr> carries data-case-id and data-case-ref (ADR-013), checked at render.
import type { ReactNode } from "react";
import { assertCaseIdentity } from "@/components/case-identity";
import type { Translator } from "@/lib/i18n";

export type SortDirection = "ascending" | "descending";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Renders this column's cells as <th scope="row"> (the row's name, e.g. the case number). */
  rowHeader?: boolean;
  /** Makes the header a sort link; `direction` is set on the column the table is sorted by. */
  sort?: { href: string; direction?: SortDirection };
}

interface DataTableBase<Row> {
  t: Translator;
  /** Becomes `data-testid`; rows get `<testId>-row-<rowKey>`. */
  testId: string;
  caption: ReactNode;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  /** Stable key of a row (a UUID or other key, never a display number alone). */
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows (an EmptyState). */
  empty: ReactNode;
  /** Pagination under the table. */
  pagination?: ReactNode;
}

export interface CaseScopedTable<Row> extends DataTableBase<Row> {
  scope: "case";
  rowCaseId: (row: Row) => string;
  rowCaseRef: (row: Row) => string;
}
export interface UnscopedTable<Row> extends DataTableBase<Row> {
  /** Only for tables with no case content. */
  scope: "none";
}
export type DataTableProps<Row> = CaseScopedTable<Row> | UnscopedTable<Row>;

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { t, testId, caption, columns, rows, rowKey, empty, pagination } = props;
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="v13-table-block">
      {/* A scrollable region must be reachable by keyboard (WCAG 2.1.1; axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="v13-scroll-region" role="region" aria-label={t("common.scrollRegion")} tabIndex={0}>
        <table className="v13-table" data-testid={testId}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sort ? (column.sort.direction ?? "none") : undefined}
                >
                  {column.sort ? (
                    <a href={column.sort.href} className="v13-sort-link">
                      {column.header}
                      {column.sort.direction ? (
                        <span aria-hidden="true" className="v13-sort-glyph">
                          {column.sort.direction === "ascending" ? "▲" : "▼"}
                        </span>
                      ) : null}
                      <span className="v13-sr-only">
                        {t(
                          column.sort.direction === "ascending"
                            ? "common.sortDescending"
                            : "common.sortAscending",
                        )}
                      </span>
                    </a>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              let caseAttrs: Record<string, string> = {};
              if (props.scope === "case") {
                const caseId = props.rowCaseId(row);
                const caseRef = props.rowCaseRef(row);
                assertCaseIdentity(caseId, caseRef);
                caseAttrs = { "data-case-id": caseId, "data-case-ref": caseRef };
              }
              return (
                <tr key={key} data-testid={`${testId}-row-${key}`} {...caseAttrs}>
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <th key={column.key} scope="row">
                        {column.cell(row)}
                      </th>
                    ) : (
                      <td key={column.key}>{column.cell(row)}</td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination}
    </div>
  );
}
