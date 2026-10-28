# Strings — `common` and `shell` namespaces · النصوص

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team UX, task V13-UX-004. This table is the source
for `lib/i18n/common` and `lib/i18n/shell` (files created when V13-ARCH-001 fixes the i18n format). Arabic is primary;
English is a faithful twin, not a separate text. `{x}` marks a variable, inserted by the formatter (never by string
concatenation). Keys are stable; text may be refined by review.

Text for the screen namespaces (`portfolio`, `case`, `myWork`, `notifications`, `workspaces`) is FE's; SCREENS.md gives
UX's proposed wording for them.

## `shell`

| Key | العربية | English |
| --- | ------- | ------- |
| `shell.productName` | منصة ذكاء القضايا والإشعارات | Case & Notification Intelligence Platform |
| `shell.orgName` | صندوق التنمية الثقافي | Cultural Development Fund |
| `shell.logoAlt` | شعار صندوق التنمية الثقافي | Cultural Development Fund logo |
| `shell.syntheticBanner` | بيئة تجريبية ببيانات اصطناعية فقط — ليست منصة الإنتاج ولا قناة إشعارات حقيقية | Demo environment with synthetic data only — not CDF production and not a channel for real notifications |
| `shell.skipToContent` | انتقل إلى المحتوى الرئيسي | Skip to main content |
| `shell.nav.label` | الأقسام الرئيسية | Main areas |
| `shell.nav.myWork` | أعمالي | My Work |
| `shell.nav.portfolio` | محفظة القضايا | Case Portfolio |
| `shell.nav.notifications` | مركز عمليات الإشعارات | Notification Operations Center |
| `shell.nav.countLabel` | {count} من البنود بانتظار إجرائك | {count} items need your action |
| `shell.breadcrumbs.label` | مسار التنقل | Breadcrumb |
| `shell.workspace.label` | مساحة العمل | Workspace |
| `shell.workspace.button` | مساحة العمل: {name} | Workspace: {name} |
| `shell.workspace.menuLabel` | تبديل مساحة العمل | Switch workspace |
| `shell.workspace.current` | الحالية | Current |
| `shell.workspace.roleHeld` | بصفة {role} | as {role} |
| `shell.workspace.switched` | انتقلت إلى مساحة عمل {name} | You are now in the {name} workspace |
| `shell.workspace.unsavedConfirm` | لديك تغييرات غير محفوظة في هذه الصفحة. هل تريد تبديل مساحة العمل وتجاهلها؟ | You have unsaved changes on this page. Switch workspace and discard them? |
| `shell.workspace.tabsNote` | الصفحات المفتوحة في علامات تبويب أخرى ستُعرض وفق صلاحيات مساحة العمل الجديدة. | Pages open in other tabs will follow the new workspace's permissions. |
| `shell.workspace.SECRETARIAT` | الأمانة | Secretariat |
| `shell.workspace.INVESTIGATIONS` | التحقيقات | Investigations |
| `shell.workspace.GOVERNANCE` | الحوكمة | Governance |
| `shell.role.COMMITTEE_SECRETARY` | أمين اللجنة | Committee Secretary |
| `shell.role.INVESTIGATOR` | محقق | Investigator |
| `shell.role.GOVERNANCE_OFFICER` | مسؤول الحوكمة | Governance Officer |
| `shell.language.label` | اللغة | Language |
| `shell.language.ar` | العربية | العربية |
| `shell.language.en` | English | English |
| `shell.persona.menuLabel` | حساب المستخدم | User account |
| `shell.persona.synthetic` | مستخدم اصطناعي | Synthetic user |
| `shell.persona.signOut` | تسجيل الخروج | Sign out |
| `shell.case.sectionsLabel` | أقسام القضية | Case sections |
| `shell.case.capacity` | صفتك: {capacity} | Your capacity: {capacity} |
| `shell.case.closedNotice` | هذه القضية مغلقة؛ العرض للاطلاع فقط. | This case is closed; it is shown for reference only. |
| `shell.case.restricted` | وصول مسمّى | Named access |

## `common`

| Key | العربية | English |
| --- | ------- | ------- |
| `common.loading` | جارٍ التحميل… | Loading… |
| `common.apply` | تطبيق | Apply |
| `common.clearFilters` | مسح عوامل التصفية | Clear filters |
| `common.search` | بحث | Search |
| `common.cancel` | إلغاء | Cancel |
| `common.confirm` | تأكيد | Confirm |
| `common.close` | إغلاق | Close |
| `common.save` | حفظ | Save |
| `common.back` | رجوع | Back |
| `common.next` | التالي | Next |
| `common.previous` | السابق | Previous |
| `common.pageSummary` | عرض {from}–{to} من {total} | Showing {from}–{to} of {total} |
| `common.sortAscending` | ترتيب تصاعدي | Sort ascending |
| `common.sortDescending` | ترتيب تنازلي | Sort descending |
| `common.scrollRegion` | جدول قابل للتمرير أفقياً | Horizontally scrollable table |
| `common.copy` | نسخ | Copy |
| `common.copied` | تم النسخ | Copied |
| `common.error.title` | تعذّر عرض هذه الصفحة الآن | This page cannot be shown right now |
| `common.error.body` | حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل، وإن تكرر الخطأ فأرسل رقم المتابعة إلى فريق الدعم. | Something went wrong. Try again shortly; if it happens again, send the reference number to the support team. |
| `common.error.correlation` | رقم المتابعة | Reference number |
| `common.error.retry` | إعادة المحاولة | Try again |
| `common.error.stale` | تغيّر هذا السجل منذ فتحه. حدّث الصفحة وحاول مرة أخرى. | This record changed after you opened it. Refresh the page and try again. |
| `common.notFound.title` | لم يُعثر على الصفحة المطلوبة | The page you asked for was not found |
| `common.notFound.body` | قد يكون الرابط غير صحيح، أو لا تتوفر لك صلاحية الاطلاع عليه في مساحة العمل الحالية. | The link may be wrong, or it is not available to you in the current workspace. |
| `common.notFound.back` | العودة إلى أعمالي | Back to My Work |
| `common.empty.generic` | لا توجد بيانات لعرضها | Nothing to show |
| `common.unsaved` | لديك تغييرات غير محفوظة | You have unsaved changes |
| `common.epistemic.recorded` | تم تسجيله في {time} | recorded at {time} |
| `common.epistemic.expectedSuffix` | (متوقع) | (expected) |
| `common.epistemic.expectedAria` | لم يحدث بعد | has not happened yet |
| `common.epistemic.conditionalPrefix` | مشروط: | Conditional: |
| `common.epistemic.conditionalJoin` | بحسب {condition} | depending on {condition} |
| `common.epistemic.conditionalAria` | خطوة محتملة، لم تحدث | possible step, has not happened |
| `common.epistemic.awaitingSuffix` | (رهن الاعتماد) | (subject to approval) |
| `common.epistemic.awaitingAria` | بانتظار الاعتماد، لم يُعتمد بعد | awaiting approval, not yet approved |
| `common.epistemic.expectedHeading` | الخطوات المتوقعة | Expected steps |
| `common.time.occurred` | وقع في {time} | Occurred {time} |
| `common.time.recorded` | سُجّل في {time} | Recorded {time} |
| `common.deadline.overdue` | متأخر {days} | Overdue by {days} |
| `common.deadline.today` | يستحق اليوم | Due today |
| `common.deadline.inDays` | خلال {days} | In {days} |
| `common.records.ACTIVE` | نشطة | Active |
| `common.records.CLOSED` | مغلقة | Closed |
| `common.layerA.COMPLETED` | اكتمل | Completed |
| `common.layerA.IN_PROGRESS` | جارٍ | In progress |
| `common.layerA.PENDING` | بانتظار إجراء | Awaiting action |
| `common.layerA.SUSPENDED` | موقوف مؤقتاً | Suspended |
| `common.layerA.RETURNED` | أُعيد | Returned |
| `common.layerA.CANCELLED` | أُلغي | Cancelled |
| `common.layerA.FAILED` | تعذّر إتمامه | Could not be completed |
| `common.layerA.NOT_APPLICABLE` | لا ينطبق | Not applicable |
| `common.sending.SENT_UNCONFIRMED` | أُرسل — لم يُؤكَّد التسليم | Sent — delivery not confirmed |
| `common.sending.DELIVERED_IN_APP` | سُلّم داخل المنصة | Delivered in the platform |
| `common.sending.DELIVERED_REPORT` | سُلّم — بتقرير تسليم من المزوّد | Delivered — provider delivery report |
| `common.sending.FAILED` | تعذّر التسليم | Delivery failed |
| `common.sending.CORRECTION_PENDING` | يُعدّ تصحيح — هذا الإصدار ما زال سارياً | Correction being prepared — this version is still current |
| `common.sending.SUPERSEDED` | استُبدل بالإصدار {version} — أُرسل التصحيح | Superseded by version {version} — the correction was sent |

Sources: Layer A labels and the sending family are copied from the V13 reference (`epistemic.js` `LAYER_A_STATES`
visible labels in `design/DESIGN_SYSTEM.md` §4.1, §4.4; lead rulings L-04, L-07). `common.layerA.*` and
`common.sending.*` may move to PROC's `status` namespace if ARCH prefers; the text stays the same.

Rules checked by a unit test when the files exist: same key set in ar and en; no Arabic string for an expected,
conditional or awaiting key contains سُجل / اكتُمل / تم; every `{var}` in ar exists in en and vice versa.
