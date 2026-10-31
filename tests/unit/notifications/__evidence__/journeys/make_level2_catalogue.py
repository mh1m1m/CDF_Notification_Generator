#!/usr/bin/env python3
"""Level-2 journey catalogue (PROPOSED, 26 Oct 2026) for the three-level ticket journey the owner defined on 26 Oct 2026
(12:32 and 12:36 UTC): level 1 = the overall case journey of the master procedure (V8 workbook: S1..S5, 28 sub-states);
level 2 = the five-stage journey of the OBJECT each notification is about, worded for the recipient's capacity, whose
"closure" closes that object and never the case; level 3 = the sub-progress inside each level-2 stage.
Writes level2_journeys.json next to this script. Synthetic reference only; every wording is PROPOSED for the owner."""
import json, pathlib

MASTER = [  # level 1 — from the V8 workbook sheet «الحالات الرئيسية» (AR verbatim) + PROPOSED EN
    ("S1", "INTAKE_REGISTER", "الاستقبال والتسجيل", "Receipt and registration"),
    ("S2", "SCREENING", "فحص الاكتمال والاختصاص والتقييم", "Completeness, jurisdiction and assessment"),
    ("S3", "PROCESS_INVESTIGATE", "المعالجة والتحقيق المختص", "Competent handling and investigation"),
    ("S4", "RECOMMEND_DECIDE", "التوصية والقرار المختص", "Recommendation and competent decision"),
    ("S5", "EXECUTE_CLOSE", "التبليغ والتنفيذ والإغلاق", "Notification, execution and closure"),
]
MASTER_SUB_EN = {  # PROPOSED EN for the 28 sub-states «الحالات الفرعية» (AR names come from v9_data.json)
    "S1.01": "Request received", "S1.02": "Registration requirements met", "S1.03": "Case registered", "S1.04": "Source and confidentiality set",
    "S2.01": "Completeness check", "S2.02": "Awaiting additional information", "S2.03": "Jurisdiction check", "S2.04": "Preliminary assessment", "S2.05": "Screening outcome approved",
    "S3.01": "Competent handling assigned", "S3.02": "Information and evidence gathering", "S3.03": "Preliminary investigation", "S3.04": "Approved escalation (where applicable)",
    "S3.05": "Extended investigation procedures", "S3.06": "Final handling report prepared", "S3.07": "Handling outputs approved",
    "S4.01": "Outputs and recommendations prepared", "S4.02": "Recommendations adopted by the competent body", "S4.03": "Recommendation raised to the authority",
    "S4.04": "Awaiting the authorised body's decision", "S4.05": "Competent decision issued",
    "S5.01": "Decision notified (where applicable)", "S5.02": "Decision execution followed up", "S5.03": "Conditional grievance handled",
    "S5.04": "Obligations verified complete", "S5.05": "Case path closed", "S5.06": "File archived", "S5.07": "Referral path closed after transfer",
}

def J(id, obj_ar, obj_en, cap_ar, cap_en, disclosure, stages, closure_ar, closure_en, note_en=""):
    st = []
    for i, (ar, en, sub_ar, sub_en) in enumerate(stages, 1):
        assert len(sub_ar) == len(sub_en), (id, i)
        st.append({"n": i, "ar": ar, "en": en, "sub": [{"ar": a, "en": b} for a, b in zip(sub_ar, sub_en)]})
    assert len(st) == 5, id
    return {"id": id, "object_ar": obj_ar, "object_en": obj_en, "capacity_ar": cap_ar, "capacity_en": cap_en, "disclosure": disclosure,
            "stages": st, "closure_ar": closure_ar, "closure_en": closure_en, "note_en": note_en, "status": "PROPOSED"}

JOURNEYS = [
 J("J-WB-REPORTER", "بلاغك", "Your report", "مقدم البلاغ", "Reporter", "public", [
   ("استلام بلاغك", "Your report received", ["وصول البلاغ عبر القناة المعتمدة", "إثبات الورود وإصدار إيصال الاستلام"], ["Report arrives through the approved channel", "Receipt recorded and acknowledged"]),
   ("تسجيل بلاغك وإصدار رقمه المرجعي", "Your report registered, reference issued", ["اكتمال متطلبات تسجيل بلاغك", "إصدار الرقم المرجعي", "تحديد مستوى السرية"], ["Registration requirements for your report completed", "Reference number issued", "Confidentiality level set"]),
   ("مراجعة بلاغك وتقييمه الأولي", "Review and preliminary assessment of your report", ["فحص اكتمال البيانات", "طلب استكمال عند الحاجة", "التأكد من أن بلاغك ضمن نطاق عمل الصندوق", "التقييم الأولي واعتماد نتيجته"], ["Completeness check", "Completion requested if needed", "Check that your report falls within the Fund's remit", "Preliminary assessment and its approval"]),
   ("معالجة بلاغك لدى الجهة المختصة", "Handling of your report by the competent body", ["إسناد المعالجة", "المعالجة أو التحقيق", "اعتماد المخرجات"], ["Handling assigned", "Handling or investigation", "Outputs approved"]),
   ("إبلاغك بمآل بلاغك وإغلاق متابعتك له", "Outcome of your report communicated, your follow-up closed", ["إبلاغك بالمآل المصرح به", "إغلاق البلاغ في القناة أو تحويله"], ["Authorised outcome communicated to you", "Report closed in the channel or transferred"]),
  ], "إغلاق متابعتك للبلاغ: إبلاغك بالمآل المصرح به، أو تحويل البلاغ، أو إقفاله لعدم الاستكمال. لا يعني إغلاق القضية الداخلية.",
     "Closure of your follow-up of the report: the authorised outcome communicated, the report transferred, or closed as incomplete. It does not mean the internal case is closed.",
     "Public level only: the reporter never sees internal statuses; stage names are the reporter's view of the V8 reporter journey."),
 J("J-IR-REFERRER", "إحالتكم المؤسسية", "Your institutional referral", "الجهة المُحيلة", "Referring body", "scope", [
   ("استلام إحالتكم", "Your referral received", ["ورود الإحالة", "التأكد من أن الإحالة واردة من جهة مخوّلة", "فحص المرفقات الأساسية"], ["Referral arrives", "Check that the referral comes from an authorised body", "Core attachments checked"]),
   ("قيد الإحالة وإصدار رقم الحالة", "Referral registered, case number issued", ["القيد وإصدار المرجع", "إشعاركم برقم الحالة"], ["Registration and reference", "You are told the case number"]),
   ("التحقق من الاكتمال والاختصاص وتحديد المسار", "Completeness, jurisdiction and handling path", ["مراجعة اكتمال المستندات", "طلب استكمال عند الحاجة", "التحقق من الاختصاص", "اعتماد مسار المعالجة"], ["Document completeness review", "Completion requested if needed", "Jurisdiction verified", "Handling path approved"]),
   ("المعالجة المؤسسية المختصة", "Competent institutional handling", ["إسناد المعالجة", "طلب الإيضاحات عند الحاجة", "استكمال المعالجة"], ["Handling assigned", "Clarifications requested if needed", "Handling completed"]),
   ("إفادتكم بالمآل المصرح به وإغلاق الإحالة", "Authorised outcome communicated to you, referral closed", ["إعداد الإفادة وتحديد ما يُصرَّح به لكم", "تبليغ المآل المصرح به", "إغلاق الإحالة"], ["Reply prepared; what may be disclosed to you determined", "Authorised outcome communicated", "Referral closed"]),
  ], "تُغلق الإحالة بإفادتكم بالمآل المصرح به؛ ما يلي ذلك من تنفيذ داخلي لا يُعرض عليكم، ولا يعني إغلاق القضية الداخلية.",
     "The referral closes when the authorised outcome is communicated to you; internal execution after that is not shown to you, and it is not the internal case closure."),
 J("J-INTAKE-SECRETARY", "الإحالة أو الحالة الواردة إلى الأمانة", "The referral or case arriving at the secretariat", "أمين اللجنة", "Committee secretary", "internal", [
   ("ورود الإحالة أو الحالة إلى الأمانة", "Arrival at the secretariat", ["ورود الإحالة أو الحالة", "إشعار الأمانة"], ["Referral or case arrives", "Secretariat notified"]),
   ("التحقق من السند والمرفقات والسرية", "Basis, attachments and confidentiality checked", ["التحقق من صفة الجهة أو سند الإحالة", "فحص المرفقات", "تحديد مستوى السرية"], ["Referring body's standing or referral basis verified", "Attachments checked", "Confidentiality level set"]),
   ("قيد الحالة وإصدار مرجعها", "Case registered, reference issued", ["القيد", "إصدار المرجع", "إشعار الاستلام للجهة المُحيلة"], ["Registration", "Reference issued", "Receipt notice to the referring body"]),
   ("عرض الموضوع على رئيس اللجنة", "Matter presented to the committee chair", ["إعداد ملخص العرض", "العرض على الرئيس"], ["Presentation summary prepared", "Presented to the chair"]),
   ("إقفال مهمة الاستلام بإحالة الموضوع إلى المسار المعتمد", "Intake task closed: matter handed to the approved path", ["تلقي توجيه الرئيس", "إحالة الموضوع إلى المسار المعتمد"], ["Chair's direction received", "Matter handed to the approved path"]),
  ], "إقفال مهمة الاستلام لدى الأمانة فقط؛ تستمر القضية في مسارها الرئيسي.", "Closure of the secretariat's intake task only; the case continues on its master journey."),
 J("J-DR-PREPARER", "الإحالة المباشرة التي أعددتموها", "The direct referral you prepared", "المُعِد ورئيس القطاع", "Preparer and sector head", "internal", [
   ("إعداد الإحالة وتقديمها", "Referral prepared and submitted", ["إعداد الإحالة", "التقديم إلى رئيس القطاع"], ["Referral prepared", "Submitted to the sector head"]),
   ("اعتماد رئيس القطاع", "Sector head approval", ["مراجعة رئيس القطاع", "الاعتماد أو الإعادة للاستكمال"], ["Sector head review", "Approved or returned for completion"]),
   ("استلام أمانة اللجنة وفحصها", "Receipt and check by the committee secretariat", ["إشعاركم بالاستلام", "فحص السند والمرفقات"], ["Receipt acknowledged to you", "Basis and attachments checked"]),
   ("القبول أو الإعادة أو الرفض أو التصعيد", "Accepted, returned, rejected or escalated", ["قرار الأمانة", "الاعتراض والتصعيد عند الرفض", "البت في التصعيد"], ["Secretariat decision", "Objection and escalation on rejection", "Escalation decided"]),
   ("إقفال إجراءات الإحالة لديكم بقيدها حالةً", "Your referral closed: registered as a case", ["قيد الحالة", "إشعاركم بالقبول"], ["Case registered", "Acceptance notified to you"]),
  ], "تنتهي إجراءات الإحالة لديكم عند قيدها حالةً (أو رفضها نهائياً)؛ لا تعني إغلاق القضية التي تنشأ عنها.",
     "Your referral procedure ends when it is registered as a case (or finally rejected); it does not mean the resulting case is closed."),
 J("J-DR-SECRETARY", "الإحالة المباشرة الواردة من القطاع", "The direct referral received from the sector", "أمين اللجنة ورئيسها", "Committee secretary and chair", "internal", [
   ("ورود الإحالة من القطاع", "Referral received from the sector", ["تقديم الإحالة", "اعتماد رئيس القطاع", "الورود إلى الأمانة"], ["Referral submitted", "Sector head approval", "Arrival at the secretariat"]),
   ("فحص السند والمرفقات", "Basis and attachments checked", ["فحص السند", "فحص المرفقات", "طلب الاستكمال عند الحاجة"], ["Basis checked", "Attachments checked", "Completion requested if needed"]),
   ("القبول أو الإعادة أو الرفض", "Accepted, returned or rejected", ["قرار الأمانة", "إشعار المُعِد والقطاع"], ["Secretariat decision", "Preparer and sector notified"]),
   ("التصعيد والبت عند الاعتراض", "Escalation and decision on objection", ["اعتراض القطاع", "التصعيد إلى مقعد البت", "قرار التصعيد"], ["Sector objection", "Escalated to the deciding seat", "Escalation decided"]),
   ("قيد الحالة وإقفال مهمة الاستلام", "Case registered, intake task closed", ["القيد وإصدار المرجع", "العرض على الرئيس"], ["Registration and reference", "Presented to the chair"]),
  ], "إقفال مهمة استلام الإحالة فقط؛ تبدأ القضية مسارها الرئيسي.", "Closure of the referral intake task only; the case starts its master journey."),
 J("J-DR-AUTHORITY", "تكليفكم المباشر", "Your direct mandate", "صاحب الصلاحية", "Mandating authority", "scope", [
   ("استلام تكليفكم", "Your mandate received", ["ورود التكليف", "التحقق من هوية مصدره وسنده"], ["Mandate arrives", "Source identity and basis verified"]),
   ("تسجيل التكليف وتحديد مرجعه", "Mandate registered, reference set", ["التسجيل والربط بالمرجع"], ["Registration and linking to its reference"]),
   ("تحديد نطاق التكليف واعتماد مساره", "Scope defined and handling path approved", ["مراجعة النطاق", "تحديد الجهة المنفذة", "طلب إيضاح النطاق عند الحاجة", "اعتماد خطة المعالجة"], ["Scope reviewed", "Executing body determined", "Scope clarification requested if needed", "Handling plan approved"]),
   ("تنفيذ التكليف ومتابعة تقدمه", "Mandate execution and progress", ["إسناد التنفيذ", "مباشرة الإجراءات", "طلب المعلومات", "تحديثات التقدم المعتمدة"], ["Execution assigned", "Procedures started", "Information requested", "Approved progress updates"]),
   ("رفع المخرجات إليكم وإقفال التكليف", "Outputs submitted to you, mandate closed", ["إعداد تقرير المخرجات ومراجعته", "رفع المخرجات", "اعتماد المآل", "إقفال التكليف"], ["Outputs report prepared and reviewed", "Outputs submitted", "Outcome approved", "Mandate closed"]),
  ], "يُقفل التكليف برفع مخرجاته واعتماد مآله؛ ولا يعني الاطلاع على مداولات اللجنة ولا إغلاق القضية الداخلية.",
     "The mandate closes with its outputs submitted and its outcome approved; it implies no access to committee deliberations and is not the internal case closure."),
 J("J-CHAIR-DIRECTION", "الموضوع المعروض على رئيس اللجنة للتوجيه", "The matter presented to the chair for direction", "رئيس اللجنة، والأمانة المنفذة", "Committee chair, and the executing secretariat", "internal", [
   ("عرض الموضوع على الرئيس", "Matter presented to the chair", ["إعداد ملخص العرض", "العرض"], ["Presentation summary prepared", "Presented"]),
   ("توجيه الرئيس بالإجراء التالي", "Chair's direction on the next step", ["اجتماع", "جلسة استماع", "طلب بيانات", "ترك الأمر لتصويت اللجنة"], ["Meeting", "Hearing", "Information request", "Left to the committee's vote"]),
   ("تنفيذ التوجيه", "Direction executed", ["جدولة الاجتماع أو الجلسة", "إرسال طلب البيانات", "فتح بند التصويت"], ["Meeting or hearing scheduled", "Information request sent", "Vote item opened"]),
   ("عرض النتيجة على الرئيس", "Result presented to the chair", ["استلام النتيجة", "العرض"], ["Result received", "Presented"]),
   ("إقفال طلب التوجيه", "Direction request closed", ["تسجيل التوجيه ونتيجته", "متابعة الموضوع في مساره"], ["Direction and result recorded", "Matter continues on its path"]),
  ], "يُقفل طلب التوجيه فقط؛ يستمر الموضوع في مساره الرئيسي.", "Only the direction request closes; the matter continues on its master journey."),
 J("J-MEETING", "اجتماع اللجنة", "The committee meeting", "رئيس اللجنة وأعضاؤها وأمينها", "Chair, members and secretary", "internal", [
   ("تحديد الموعد وتوجيه الدعوات", "Scheduling and invitations", ["اعتماد جدول الأعمال", "تحديد الموعد", "الدعوات والتذكير", "إعادة الجدولة أو الإلغاء عند الاقتضاء"], ["Agenda approved", "Date set", "Invitations and reminders", "Rescheduled or cancelled where required"]),
   ("إتاحة المواد والإفصاح عن التعارض", "Materials and conflict disclosures", ["إتاحة مواد الاجتماع", "طلب الإفصاح", "استلام الإفصاحات", "البت في التعارض"], ["Meeting materials released", "Disclosure requested", "Disclosures received", "Conflict decided"]),
   ("الانعقاد والمداولة والتصويت", "Session, deliberation and vote", ["إثبات الحضور", "المداولة", "فتح التصويت والتصويت", "احتساب الأصوات وإقفال البند"], ["Attendance recorded", "Deliberation", "Vote opened and cast", "Votes counted, item closed"]),
   ("المحضر: الإعداد والمراجعة والتوقيع", "Minutes: drafting, review and signature", ["رفع المسودة إلى الرئيس", "تعميم المسودة والمراجعة", "الاعتماد والتوقيع"], ["Draft raised to the chair", "Draft circulated and reviewed", "Approved and signed"]),
   ("إقفال الاجتماع ومتابعة تكليفاته", "Meeting closed, its assignments followed up", ["توثيق المحضر الموقّع", "إسناد التكليفات ومتابعتها"], ["Signed minutes filed", "Assignments issued and tracked"]),
  ], "إقفال سجل الاجتماع ومتابعة تكليفاته فقط؛ القضية تستمر في مسارها الرئيسي.", "Closure of the meeting record and its follow-ups only; the case continues on its master journey.",
     "A paper ballot confirmation (2120 F4) sits in stage 3: ballot bound, awaiting the member's confirmation, counted."),
 J("J-COMMITTEE-TASK", "التكليف الصادر عن اللجنة", "The assignment issued by the committee", "المكلَّف", "Assignee", "internal", [
   ("إسناد التكليف إليك", "Assignment issued to you", ["قرار اللجنة بالتكليف", "إشعار الإسناد"], ["Committee decides the assignment", "Assignment notified"]),
   ("استلام التكليف وتحديد نطاقه ومهلته", "Assignment received, scope and deadline set", ["تأكيد الاستلام", "فهم النطاق والمهلة"], ["Receipt confirmed", "Scope and deadline understood"]),
   ("التنفيذ والمتابعة", "Execution and follow-up", ["التنفيذ", "تذكيرات المتابعة"], ["Execution", "Follow-up reminders"]),
   ("تسليم مخرجات التكليف", "Deliverables submitted", ["تسليم المخرجات", "مراجعة الأمانة"], ["Deliverables submitted", "Secretariat review"]),
   ("توثيق استكمال التكليف وإقفاله", "Completion documented, assignment closed", ["توثيق الاستكمال", "الإقفال"], ["Completion documented", "Closed"]),
  ], "إقفال التكليف وحده.", "Closure of the assignment only."),
 J("J-INVESTIGATION", "مهمة التحقيق", "The investigation task", "المكلَّف بالتحقيق", "Assigned investigator", "restricted", [
   ("التكليف بالتحقيق وإقرار الاستقلالية", "Assignment and independence declaration", ["إشعار التكليف", "إقرار الاستقلالية وعدم التعارض", "تعديل النطاق أو المدة عند اعتماده"], ["Assignment notified", "Independence and no-conflict declaration", "Scope or duration amended when approved"]),
   ("جمع المستندات والأدلة", "Documents and evidence gathering", ["طلبات المستندات", "تأكيد الاستلام", "التوثيق"], ["Document requests", "Receipt confirmed", "Documented"]),
   ("الإفادات وجلسات الاستماع", "Statements and hearings", ["دعوات الإفادة", "إشعار الوقائع المنسوبة", "جلسات الاستماع والشهود", "استكمال الجلسات"], ["Statement invitations", "Notice of attributed facts", "Hearings and witnesses", "Hearings completed"]),
   ("تقرير التحقيق ورفعه", "Investigation report and submission", ["إعداد التقرير", "رفعه للمراجعة المختصة", "عرض النتائج على اللجنة"], ["Report prepared", "Raised for competent review", "Results presented to the committee"]),
   ("إقفال مهمة التحقيق", "Investigation task closed", ["اعتماد المخرجات", "إقفال المهمة"], ["Outputs approved", "Task closed"]),
  ], "إقفال مهمة التحقيق فقط؛ تنتقل القضية إلى التوصية والقرار.", "Closure of the investigation task only; the case moves on to recommendation and decision."),
 J("J-EVIDENCE-REQUEST", "طلب المستندات أو الأدلة الموجّه إليكم", "The document or evidence request addressed to you", "الجهة الحائزة للمستند", "Document holder", "scope", [
   ("صدور الطلب إليكم", "Request issued to you", ["تحديد المطلوب وسنده والمهلة"], ["What is required, its basis and deadline"]),
   ("تقديم المستندات", "Documents provided", ["التقديم عبر القناة المحددة"], ["Provided through the designated channel"]),
   ("تأكيد الاستلام والتحقق", "Receipt confirmed and verified", ["تأكيد الاستلام", "التحقق من الاكتمال"], ["Receipt confirmed", "Completeness verified"]),
   ("طلب الاستكمال عند الحاجة", "Completion requested if needed", ["طلب استكمال", "تقديم الاستكمال"], ["Completion requested", "Completion provided"]),
   ("إقفال الطلب", "Request closed", ["إقفال الطلب"], ["Request closed"]),
  ], "إقفال طلب المستندات فقط.", "Closure of the document request only."),
 J("J-STATEMENT-PARTY", "إفادتك بشأن وقائع محددة", "Your statement on specified facts", "الطرف المعني", "Party concerned", "restricted", [
   ("دعوتك لتقديم الإفادة", "Invitation to give your statement", ["الدعوة وموعدها", "سند الطلب"], ["Invitation and its date", "Basis of the request"]),
   ("إشعارك بالوقائع المنسوبة", "Notice of the attributed facts", ["إشعار الوقائع", "تمكينك من الرد"], ["Facts notified", "You are enabled to reply"]),
   ("تقديم الإفادة أو الرد", "Statement or reply given", ["جلسة الإفادة", "الرد الكتابي"], ["Statement session", "Written reply"]),
   ("تحرير المحضر وإتاحة التصحيح", "Record drafted, correction enabled", ["تحرير المحضر", "طلب التصحيح", "اعتماد المحضر"], ["Record drafted", "Correction requested", "Record approved"]),
   ("إقفال إجراء الإفادة", "Statement procedure closed", ["ضم الإفادة إلى ملف التحقيق"], ["Statement added to the investigation file"]),
  ], "إقفال إجراء الإفادة فقط؛ لا يعني انتهاء التحقيق أو القضية.", "Closure of the statement procedure only; neither the investigation nor the case ends."),
 J("J-WITNESS", "مشاركتك في جلسة الاستماع", "Your participation in the hearing", "الشاهد", "Witness", "restricted", [
   ("دعوتك لحضور الجلسة", "Summons to the hearing", ["الدعوة والموعد"], ["Summons and date"]),
   ("التذكير بواجب السرية", "Confidentiality reminder", ["التذكير"], ["Reminder"]),
   ("الإدلاء بالإفادة", "Testimony given", ["الجلسة"], ["Session"]),
   ("تحرير المحضر وإتاحة طلب التصحيح", "Record drafted, correction request enabled", ["تحرير المحضر", "طلب التصحيح"], ["Record drafted", "Correction requested"]),
   ("إقفال مشاركتك في الجلسة", "Your participation closed", ["اعتماد محضر الإفادة"], ["Statement record approved"]),
  ], "تنتهي مشاركتك عند اعتماد محضر إفادتك؛ لا يُعرض عليك شيء عن القضية.", "Your participation ends when your statement record is approved; nothing about the case is shown to you."),
 J("J-DEFENCE", "حقوقك ودفاعك", "Your rights and defence", "الموظف المعني", "Subject employee", "restricted", [
   ("إشعار الحقوق", "Rights notice", ["إصدار إشعار الحقوق", "الإقرار بالاطلاع"], ["Rights notice issued", "Acknowledged"]),
   ("إشعار الدفاع وبدء المهلة", "Defence notice, period starts", ["إصدار إشعار الدفاع", "بدء المهلة"], ["Defence notice issued", "Period starts"]),
   ("إتاحة حزمة الدفاع", "Defence packet released", ["إتاحة الحزمة", "الاطلاع"], ["Packet released", "Examined"]),
   ("تقديم الدفاع قبل انتهاء المهلة", "Defence submitted before the deadline", ["التذكير بالاستحقاق", "تقديم الدفاع"], ["Due reminder", "Defence submitted"]),
   ("إقفال مهلة الدفاع وإحالة الدفاع إلى اللجنة", "Defence period closed, defence passed to the committee", ["إقفال المهلة", "إحالة الدفاع"], ["Period closed", "Defence passed on"]),
  ], "إقفال مهلة الدفاع فقط؛ القضية مستمرة حتى القرار وتبليغه.", "Closure of the defence period only; the case continues to the decision and its notification."),
 J("J-RECOMMENDATION-COMMITTEE", "توصيات اللجنة", "The committee's recommendations", "أمين اللجنة ورئيسها وأعضاؤها", "Secretary, chair and members", "internal", [
   ("إعداد حزمة التوصيات وعرضها للمداولة", "Recommendation package prepared for deliberation", ["الإعداد", "العرض للمداولة"], ["Prepared", "Submitted for deliberation"]),
   ("المداولة والتصويت واعتماد التوصيات", "Deliberation, vote and adoption", ["المداولة", "التصويت", "الاعتماد والمحضر"], ["Deliberation", "Vote", "Adoption and minutes"]),
   ("المراجعة القانونية عند الاقتضاء", "Legal review where required", ["إسناد المراجعة", "الرأي القانوني", "الإعادة إلى اللجنة عند الاقتضاء"], ["Review assigned", "Legal opinion", "Returned to the committee where required"]),
   ("الرفع إلى صاحب الصلاحية وانتظار القرار", "Raised to the authority, awaiting the decision", ["الرفع", "النظر", "الإعادة عند الاقتضاء"], ["Raised", "Considered", "Returned where required"]),
   ("تسجيل القرار وإقفال مسار التوصية", "Decision recorded, recommendation path closed", ["تسجيل القرار", "الإقفال"], ["Decision recorded", "Closed"]),
  ], "يُقفل مسار التوصية عند تسجيل قرار صاحب الصلاحية؛ التبليغ والتنفيذ يتبعان في المسار الرئيسي.", "The recommendation path closes when the authority's decision is recorded; notification and execution follow on the master journey."),
 J("J-LEGAL-REVIEW", "طلب المراجعة القانونية المسند إليك", "The legal review request assigned to you", "المراجع القانوني", "Legal reviewer", "internal", [
   ("إسناد طلب المراجعة إليك", "Review request assigned to you", ["الإسناد والمهلة"], ["Assignment and deadline"]),
   ("الاطلاع على حزمة التوصيات", "Package examined", ["الاطلاع"], ["Examined"]),
   ("إعداد الرأي القانوني", "Legal opinion prepared", ["الإعداد"], ["Prepared"]),
   ("تسجيل الرأي وإعادة الحزمة إلى اللجنة", "Opinion recorded, package returned", ["التسجيل", "الإعادة"], ["Recorded", "Returned"]),
   ("إقفال طلب المراجعة", "Review request closed", ["الإقفال"], ["Closed"]),
  ], "إقفال طلب المراجعة فقط.", "Closure of the review request only."),
 J("J-DECISION-AUTHORITY", "التوصية المرفوعة إليكم وقراركم", "The recommendation raised to you and your decision", "صاحب الصلاحية", "Competent authority", "internal", [
   ("رفع التوصية إليكم", "Recommendation raised to you", ["الرفع", "تسلّم الحزمة"], ["Raised", "Package received"]),
   ("النظر في التوصية", "Consideration", ["النظر", "الاستيضاح أو الإعادة عند الاقتضاء"], ["Considered", "Clarified or returned where required"]),
   ("اعتماد القرار", "Decision approved", ["الاعتماد", "تسجيل القرار"], ["Approved", "Decision recorded"]),
   ("تبليغ القرار وتنفيذه", "Decision notified and executed", ["التبليغ", "التنفيذ", "التظلم عند تقديمه"], ["Notified", "Executed", "Grievance if filed"]),
   ("إقفال متابعة القرار", "Decision follow-up closed", ["التحقق من اكتمال التنفيذ", "الإقفال"], ["Execution verified complete", "Closed"]),
  ], "إقفال متابعة القرار بعد التحقق من تنفيذه؛ ويليه إغلاق المسار الرئيسي للقضية.", "Closure of the decision follow-up once execution is verified; the master case closure follows it."),
 J("J-DECISION-SUBJECT", "القرار الصادر في شأنك", "The decision issued concerning you", "الطرف المعني", "Party concerned", "restricted", [
   ("تبليغك بالقرار", "Decision notified to you", ["التبليغ الرسمي", "الإقرار بالاستلام"], ["Formal notification", "Receipt acknowledged"]),
   ("مهلة التظلم", "Grievance period", ["بدء المهلة", "انتهاؤها"], ["Period starts", "Period ends"]),
   ("قيد التظلم عند تقديمه", "Grievance registered if filed", ["تقديم التظلم", "تأكيد القيد"], ["Grievance filed", "Registration confirmed"]),
   ("النظر في التظلم والبت فيه", "Grievance considered and decided", ["النظر", "البت"], ["Considered", "Decided"]),
   ("إقفال إجراءات التبليغ والتظلم", "Notification and grievance procedure closed", ["الإقفال"], ["Closed"]),
  ], "إقفال إجراءات التبليغ والتظلم في شأنك فقط.", "Closure of the notification and grievance procedure concerning you only."),
 J("J-SANCTION-EXTRACT", "طلب اعتماد مستخرج العقوبة", "The sanction extract approval request", "صاحب صلاحية القضية المقيدة", "Restricted case authority", "restricted", [
   ("طلب الاعتماد", "Approval requested", ["إعداد المستخرج", "تقديم الطلب"], ["Extract prepared", "Request submitted"]),
   ("المراجعة", "Review", ["مراجعة المستخرج"], ["Extract reviewed"]),
   ("الاعتماد أو الإعادة", "Approved or returned", ["القرار"], ["Decision"]),
   ("إصدار المستخرج وتبليغه", "Extract issued and communicated", ["الإصدار", "التبليغ"], ["Issued", "Communicated"]),
   ("إقفال الطلب", "Request closed", ["الإقفال"], ["Closed"]),
  ], "إقفال طلب المستخرج فقط.", "Closure of the extract request only."),
 J("J-IMPLEMENTATION", "مهمة متابعة تنفيذ القرار", "The decision implementation follow-up task", "إدارة الحوكمة والامتثال", "Governance and compliance", "internal", [
   ("استلام مهمة المتابعة", "Follow-up task received", ["الإسناد"], ["Assigned"]),
   ("تنفيذ القرار", "Decision executed", ["الإجراءات التنفيذية"], ["Execution steps"]),
   ("التحقق من اكتمال الالتزامات", "Obligations verified complete", ["التحقق"], ["Verified"]),
   ("توثيق الإنجاز", "Completion documented", ["التوثيق"], ["Documented"]),
   ("إقفال متابعة التنفيذ", "Implementation follow-up closed", ["الإقفال"], ["Closed"]),
  ], "إقفال مهمة المتابعة؛ يليه إغلاق القضية وأرشفتها في المسار الرئيسي.", "Closure of the follow-up task; case closure and archiving follow on the master journey."),
 J("J-ALERT", "التنبيه", "The alert", "المسؤول الرقابي أو أمين اللجنة", "Control officer or committee secretary", "internal", [
   ("رصد الحدث", "Event detected", ["الرصد"], ["Detected"]),
   ("تحقق القاعدة", "Rule triggered", ["التحقق من القاعدة والموعد"], ["Rule and date verified"]),
   ("التنبيه الداخلي", "Internal alert", ["التنبيه", "التصعيد عند التجاوز"], ["Alert", "Escalation when overdue"]),
   ("المعالجة", "Handling", ["الإجراء التصحيحي"], ["Corrective action"]),
   ("إقفال التنبيه", "Alert closed", ["الإقفال"], ["Closed"]),
  ], "إقفال التنبيه فقط؛ لا يغيّر حالة القضية.", "Closure of the alert only; the case state is unchanged.", "V8 SYS journey kept as is."),
 J("J-RESTRICTION-LIFT", "طلب رفع التقييد عن القضية", "The restriction-lift request", "الموافق الثاني وصاحب صلاحية القضية المقيدة", "Second approver and restricted case authority", "restricted", [
   ("المعاينة وتقديم الطلب", "Preview and request", ["المعاينة", "تقديم الطلب"], ["Preview", "Request submitted"]),
   ("إشعار الموافق الثاني", "Second approver notified", ["الإشعار", "الاطلاع على الطلب"], ["Notified", "Request examined"]),
   ("القرار: موافقة أو رفض", "Decision: approve or reject", ["القرار", "الرفض عند تغيّر المعاينة"], ["Decision", "Refused when the preview changed"]),
   ("تنفيذ الرفع خلال النافذة", "Lift executed within the window", ["إعادة التحقق من شروط الموافق", "التنفيذ"], ["Approver conditions re-checked", "Executed"]),
   ("إقفال الطلب", "Request closed", ["الإقفال بالتنفيذ أو الانتهاء أو السحب"], ["Closed by execution, expiry or withdrawal"]),
  ], "إقفال طلب الرفع فقط؛ القضية تستمر، نشطة كانت أو مغلقة.", "Closure of the lift request only; the case continues, active or closed."),
]

# assignments: (notification id, source, journey, level-2 stage, master code or None, note)
CU = "CASE_UNCHANGED"
A = [
 ("WB-01","generator","J-WB-REPORTER",1,"S1.01",""), ("WB-02","generator","J-WB-REPORTER",2,"S1.03",""), ("WB-03","generator","J-WB-REPORTER",3,"S2.02","awaiting your completion"),
 ("WB-04","generator","J-WB-REPORTER",3,"S2.01",""), ("WB-05","generator","J-WB-REPORTER",3,"S2.04",""), ("WB-06","generator","J-WB-REPORTER",5,"S5.07","transferred: your follow-up in this channel closes"),
 ("WB-07","generator","J-WB-REPORTER",5,"S5.05","closed as incomplete"), ("WB-08","generator","J-WB-REPORTER",5,"S5.05","handling completed"),
 ("IR-01","generator","J-IR-REFERRER",1,"S1.01",""), ("IR-02","generator","J-IR-REFERRER",2,"S1.03",""), ("IR-03","generator","J-IR-REFERRER",3,"S2.03",""), ("IR-04","generator","J-IR-REFERRER",3,"S2.02",""),
 ("IR-05","generator","J-IR-REFERRER",3,"S2.01",""), ("IR-06","generator","J-IR-REFERRER",3,"S2.05","path approved: stage 3 completes"), ("IR-07","generator","J-IR-REFERRER",5,"S3.07","handling completed: reply being prepared"), ("IR-08","generator","J-IR-REFERRER",5,"S5.05",""),
 ("DR-01","generator","J-DR-AUTHORITY",1,"S1.01",""), ("DR-02","generator","J-DR-AUTHORITY",2,"S1.03",""), ("DR-03","generator","J-CHAIR-DIRECTION",1,CU,""), ("DR-04","generator","J-DR-AUTHORITY",3,CU,""),
 ("DR-05","generator","J-DR-AUTHORITY",4,CU,""), ("DR-06","generator","J-DR-AUTHORITY",5,"S4.03",""),
 ("COM-01","generator","J-CHAIR-DIRECTION",1,CU,""), ("COM-02","generator","J-CHAIR-DIRECTION",2,CU,""), ("COM-03","generator","J-MEETING",1,CU,"agenda approval"),
 ("COM-04","generator","J-MEETING",1,CU,""), ("COM-05","generator","J-MEETING",1,CU,""), ("COM-06","generator","J-MEETING",1,CU,""), ("COM-07","generator","J-MEETING",1,CU,"cancelled: the meeting record closes without stages 2–5"),
 ("COM-08","generator","J-MEETING",2,CU,""), ("COM-09","generator","J-MEETING",2,CU,""), ("COM-10","generator","J-MEETING",2,CU,""), ("COM-11","generator","J-MEETING",2,CU,""),
 ("COM-12","generator","J-MEETING",4,CU,""), ("COM-13","generator","J-MEETING",4,CU,""), ("COM-14","generator","J-MEETING",4,CU,""), ("COM-15","generator","J-MEETING",4,CU,""), ("COM-16","generator","J-MEETING",4,CU,""), ("COM-17","generator","J-MEETING",4,CU,""),
 ("COM-18","generator","J-COMMITTEE-TASK",1,CU,""), ("COM-19","generator","J-COMMITTEE-TASK",3,CU,""), ("COM-20","generator","J-COMMITTEE-TASK",5,CU,""),
 ("INV-01","generator","J-INVESTIGATION",1,"S3.01",""), ("INV-02","generator","J-INVESTIGATION",1,CU,""), ("INV-03","generator","J-EVIDENCE-REQUEST",1,"S3.02",""), ("INV-04","generator","J-EVIDENCE-REQUEST",3,CU,""),
 ("INV-05","generator","J-STATEMENT-PARTY",1,"S3.05",""), ("INV-06","generator","J-STATEMENT-PARTY",2,"S3.05",""), ("INV-07","generator","J-INVESTIGATION",1,CU,"scope or duration amended"),
 ("INV-08","generator","J-INVESTIGATION",4,"S3.07",""), ("INV-09","generator","J-INVESTIGATION",4,"S3.06","hearings completed: stage 3 done, report next"),
 ("INV-10","generator","J-WITNESS",1,CU,""), ("INV-11","generator","J-WITNESS",2,CU,""), ("INV-12","generator","J-WITNESS",4,CU,""),
 ("DEC-01","generator","J-DECISION-AUTHORITY",1,"S4.03",""), ("DEC-02","generator","J-DECISION-AUTHORITY",2,"S4.04",""), ("DEC-03","generator","J-RECOMMENDATION-COMMITTEE",5,"S4.05",""),
 ("DEC-04","generator","J-DECISION-SUBJECT",1,"S5.01",""), ("DEC-05","generator","J-DECISION-SUBJECT",3,"S5.03",""), ("DEC-06","generator","J-IMPLEMENTATION",1,"S5.02",""), ("DEC-07","generator","J-DECISION-AUTHORITY",5,"S5.05",""),
 ("SYS-01","generator","J-ALERT",3,CU,""), ("SYS-02","generator","J-ALERT",3,CU,""), ("SYS-03","generator","J-ALERT",3,CU,""), ("SYS-04","generator","J-ALERT",3,CU,""),
 ("SYS-05","generator","J-ALERT",3,CU,"escalation"), ("SYS-06","generator","J-ALERT",3,CU,""), ("SYS-07","generator","J-ALERT",3,CU,""), ("SYS-08","generator","J-ALERT",3,CU,""),
 ("CF-01","committee","J-DR-PREPARER",2,"S1.01",""), ("CF-02","committee","J-DR-PREPARER",1,"S1.01","returned for completion"), ("CF-03","committee","J-DR-SECRETARY",2,"S1.02",""),
 ("CF-04","committee","J-DR-PREPARER",3,"S1.02",""), ("CF-05","committee","J-DR-PREPARER",5,"S1.03",""), ("CF-06","committee","J-DR-PREPARER",4,"S1.02","rejected"),
 ("CF-07","committee","J-DR-SECRETARY",4,"S1.02",""), ("CF-08","committee","J-DR-PREPARER",4,"S1.03","decided; accepted referrals move to stage 5"),
 ("CF-09","committee","J-INTAKE-SECRETARY",1,"S3.01","Compliance refers the report; master S3.01 competent handling assigned"),
 ("CF-10","committee","J-INTAKE-SECRETARY",1,"S1.01",""), ("CF-11","committee","J-IR-REFERRER",2,"S1.03",""),
 ("CF-12","committee","J-WB-REPORTER",1,"S1.01",""), ("CF-13","committee","J-WB-REPORTER",3,"S2.02",""), ("CF-14","committee","J-WB-REPORTER",3,"S2.04","sample; the changed public status decides"),
 ("CF-15","committee","J-CHAIR-DIRECTION",2,"S3.01",""), ("CF-16","committee","J-CHAIR-DIRECTION",3,"S3.01","direction: meeting"), ("CF-17","committee","J-CHAIR-DIRECTION",3,"S3.05","direction: hearing"),
 ("CF-18","committee","J-CHAIR-DIRECTION",3,"S3.02","direction: information"), ("CF-19","committee","J-CHAIR-DIRECTION",3,"S3.01","direction: committee vote"),
 ("CF-20","committee","J-INVESTIGATION",1,"S3.01",""), ("CF-21","committee","J-STATEMENT-PARTY",1,"S3.05",""), ("CF-22","committee","J-DEFENCE",1,"S3.05",""),
 ("CF-23","committee","J-DEFENCE",2,"S3.05",""), ("CF-23b","committee","J-DEFENCE",4,"S3.05","due reminder"), ("CF-23c","committee","J-DEFENCE",3,"S3.05",""), ("CF-23d","committee","J-INVESTIGATION",4,"S3.06",""),
 ("CF-24","committee","J-MEETING",1,"S4.01","sample: deliberation meeting; a hearing meeting sits at master S3.05"), ("CF-25","committee","J-MEETING",1,"S4.01","cancelled"),
 ("CF-26","committee","J-MEETING",2,"S4.01",""), ("CF-27","committee","J-MEETING",4,"S4.02",""), ("CF-28","committee","J-MEETING",4,"S4.02",""), ("CF-29","committee","J-MEETING",1,"S4.01",""),
 ("CF-30","committee","J-MEETING",3,"S4.02",""), ("CF-31","committee","J-RECOMMENDATION-COMMITTEE",1,"S4.01",""), ("CF-32","committee","J-RECOMMENDATION-COMMITTEE",2,"S4.02",""),
 ("CF-33","committee","J-LEGAL-REVIEW",1,"S4.03",""), ("CF-34","committee","J-RECOMMENDATION-COMMITTEE",3,"S4.03","opinion recorded, returned to the committee"), ("CF-35","committee","J-RECOMMENDATION-COMMITTEE",5,"S4.05",""),
 ("CF-36","committee","J-SANCTION-EXTRACT",1,"S5.01",""), ("CF-37","committee","J-DECISION-SUBJECT",1,"S5.01",""),
 ("CF-38","committee","J-RESTRICTION-LIFT",2,None,"any master stage; case ACTIVE or CLOSED"), ("CF-39","committee","J-RESTRICTION-LIFT",3,None,"any master stage; fires on APPROVE and REJECT alike"),
 ("CF-40","committee","J-MEETING",3,"S4.02","paper ballot awaiting the member's confirmation"),
]
ids = {j["id"] for j in JOURNEYS}
for a in A: assert a[2] in ids, a
assert len({a[0] for a in A}) == len(A) == 112, len(A)
out = {"version": "L2-2026-10-26b", "status": "PROPOSED", "owner_rule": "26 Oct 2026 12:32 + 12:36 UTC: three levels; level-2 wording per notification's object and recipient capacity; closure names that object, never the case",
       "master": [{"code": c, "key": k, "ar": ar, "en": en} for c, k, ar, en in MASTER], "master_sub_en": MASTER_SUB_EN,
       "journeys": JOURNEYS, "assignments": [{"id": i, "source": s, "journey": j, "stage": st, "master": m, "note": n} for i, s, j, st, m, n in A]}
p = pathlib.Path(__file__).resolve().parent / "level2_journeys.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("journeys", len(JOURNEYS), "assignments", len(A), "->", p, p.stat().st_size, "bytes")
