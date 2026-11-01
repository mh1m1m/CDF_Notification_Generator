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
  /** Evidence attributes on this column's cells (`data-*` only, e.g. a cell test id or data-count). */
  cellData?: (row: Row) => DataAttributes;
}

/** Only `data-*` attributes (test ids and ADR-013 evidence); never ARIA, events or styles. */
export type DataAttributes = Readonly<Record<`data-${string}`, string | number | undefined>>;

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
  /** Id for the caption; the scroll region is then labelled by it instead of the generic label. */
  captionId?: string;
  /** Row test id; defaults to `<testId>-row-<rowKey>`. */
  rowTestId?: (row: Row) => string;
  /** Extra evidence attributes on each row (`data-*` only). */
  rowData?: (row: Row) => DataAttributes;
  /** Extra evidence attributes on the <table> (`data-*` only), e.g. data-count. */
  tableData?: DataAttributes;
}

function dataOnly(attrs: DataAttributes | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!attrs) return out;
  for (const [name, value] of Object.entries(attrs)) {
    if (!/^data-[a-z0-9-]+$/.test(name)) throw new Error("DataTable: only data-* attributes");
    if (value !== undefined) out[name] = value;
  }
  return out;
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
  const { t, testId, caption, columns, rows, rowKey, empty, pagination, captionId } = props;
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="v13-table-block">
      {/* A scrollable region must be reachable by keyboard (WCAG 2.1.1; axe scrollable-region-focusable). */}
      <div
        className="v13-scroll-region"
        role="region"
        aria-label={captionId ? undefined : t("common.scrollRegion")}
        aria-labelledby={captionId}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <table className="v13-table" data-testid={testId} {...dataOnly(props.tableData)}>
          <caption id={captionId}>
            {/* Kept in view while the table scrolls sideways, and wrapped to the visible width (QA, M1-05). */}
            <span className="v13-table-caption-text">{caption}</span>
          </caption>
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
                <tr
                  key={key}
                  data-testid={props.rowTestId ? props.rowTestId(row) : `${testId}-row-${key}`}
                  {...dataOnly(props.rowData?.(row))}
                  {...caseAttrs}
                >
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <th key={column.key} scope="row" {...dataOnly(column.cellData?.(row))}>
                        {column.cell(row)}
                      </th>
                    ) : (
                      <td key={column.key} {...dataOnly(column.cellData?.(row))}>
                        {column.cell(row)}
                      </td>
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
