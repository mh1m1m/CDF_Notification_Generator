// Every table in FE markup sits directly in a keyboard-focusable scroll region named by the table's own caption
// (WCAG 2.1.1, axe scrollable-region-focusable at narrow widths; QA review of #23). Returns the problems found.
export function scrollRegionProblems(html: string): string[] {
  const problems: string[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>\s*<caption\b([^>]*)>/g)];
  if (tables.length === 0) problems.push("no table with a caption in the markup");
  for (const m of tables) {
    const before = html.slice(0, m.index);
    const open = before.match(/<div\b([^>]*)>\s*$/);
    const captionId = m[1]?.match(/\sid="([^"]+)"/)?.[1];
    if (!open) {
      problems.push("table not directly inside a div");
      continue;
    }
    const attrs = open[1] ?? "";
    if (!/\btabindex="0"/.test(attrs)) problems.push("scroll region is not focusable (tabindex=0)");
    if (!/\brole="region"/.test(attrs)) problems.push("scroll region has no role=region");
    const labelledBy = attrs.match(/\baria-labelledby="([^"]+)"/)?.[1];
    if (!captionId) problems.push("caption has no id");
    else if (labelledBy !== captionId)
      problems.push(`region labelled by ${labelledBy}, caption id ${captionId}`);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  if (new Set(ids).size !== ids.length) problems.push("duplicate ids in the markup");
  return problems;
}
