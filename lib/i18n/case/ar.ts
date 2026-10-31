// Namespace "case" (FE) — Arabic, the primary language (RTL). Keys are addressed as "case.<key>".
// Stage names mirror migration 0002's stage codes until PROC's status catalogue provides them; records-state words
// are FE copies of UX's common.records.* until UX-002 lands them.
export const ar = {
  "stage.intake": "الاستلام",
  "stage.preliminaryReview": "المراجعة الأولية",
  "stage.investigation": "التحقيق",
  "stage.committeeDeliberation": "مداولة اللجنة",
  "stage.decision": "القرار",
  "stage.closure": "الإغلاق",
  "records.active": "نشطة",
  "records.closed": "مغلقة",
  restricted: "وصول مسمّى",
} as const;
