// Inserts React nodes into a translated template ("عرض {from}–{to} من {total}"), so a number can carry its own
// element (e.g. Count with data-count) without string concatenation. Unknown placeholders stay visible.
import { Fragment, type ReactNode } from "react";

export function interpolateNodes(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  const parts = template.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/);
  return parts.map((part, i) => {
    const name = /^\{([a-zA-Z][a-zA-Z0-9]*)\}$/.exec(part)?.[1];
    const value =
      name !== undefined && Object.prototype.hasOwnProperty.call(values, name) ? values[name] : part;
    return <Fragment key={i}>{value}</Fragment>;
  });
}
