/* ===== state ===== */
const KEY='cdf-notification-generator-v9', KEY_V8='cdf-notification-generator-v8';
const DEFAULT_CTX={ref:'',srcType:'',cls:'',status:'',subState:'',events:[],archived:[],recordMode:'design',procedureRef:'',receivedAt:'',registeredAt:'',stateAt:'',snapshotAt:'',link:'',
  referrerBody:'',referrerTitle:'الأستاذ/',referrerName:'',referrerEmail:'',authorityName:'',authorityEmail:'',chairName:'',chairEmail:'',secName:'',secEmail:'',compName:'',
  memberName:'',memberTitle:'',memberEmail:'',invName:'',invEmail:'',partyName:'',partyGender:'m',partyEmail:'',compEmail:'',evidenceName:'',evidenceEmail:'',reporterChannel:'القناة المعتمدة للإبلاغ',
  meetingRef:'',meetingAt:'',meetingPlace:'',meetingMode:'',taskRef:'',dueAt:'',dueVerified:false,mandateRef:'',decisionRef:'',decisionStage:'',controlRuleId:'',triggerEventId:'',responsibleRole:'',accessScope:'',hearingRef:'',hearingAt:'',hearingPlace:'',hearingMode:'',witnessRef:'',witnessGender:'m',witnessEmail:'',statementCorrectionDays:''};
let S={ctx:Object.assign({},DEFAULT_CTX), per:{}, sel:null, log:[], filters:{cat:'',sub:'',q:'',linked:false}, pane:'case', tl:{open:{},viewer:'all',recused:false,pick:'',explain:'',form:null,flag:''}, pendingSource:null, send:{originator:'',actionable:true,endpoint:'',feedbackTo:'feedback@example.test',portalFeedbackUrl:'https://portal.example.test/feedback'}};
function save(){ try{ localStorage.setItem(KEY, JSON.stringify({ctx:S.ctx,per:S.per,sel:S.sel,log:S.log,send:S.send,tl:{open:S.tl.open,viewer:S.tl.viewer}})); }catch(e){} }
function migrateV8(d){ // a stored V8 context: keep its source as stored, derive one initial status from the V8 sub-state via the crosswalk (design record)
  let ctx=Object.assign({},DEFAULT_CTX,d.ctx||{}); ctx.events=Array.isArray(ctx.events)?ctx.events:[]; ctx.archived=ctx.archived||[];
  if(ctx.srcType&&!ctx.events.length&&ctx.subState){ const st=statusForV8(ctx.srcType,ctx.subState); if(st){ const r=recordInitialStatus(ctx,st.id,{occurredAt:ctx.stateAt||'',recordedAt:ctx.stateAt||'',note:'مُرحَّل من إصدار V8 (الحالة الفرعية '+ctx.subState+')'}); if(r.ok) ctx=r.ctx; } }
  return ctx;
}
function load(){ try{ let d=JSON.parse(localStorage.getItem(KEY)||'null'); if(d){ S.ctx=Object.assign({},DEFAULT_CTX,d.ctx||{}); S.ctx.events=Array.isArray(S.ctx.events)?S.ctx.events:[]; S.ctx.archived=S.ctx.archived||[]; S.per=d.per||{}; S.sel=d.sel||null; S.log=d.log||[]; S.send=Object.assign({originator:'',actionable:true,endpoint:'',feedbackTo:'feedback@example.test',portalFeedbackUrl:'https://portal.example.test/feedback'},d.send||{}); if(d.tl){ S.tl.open=d.tl.open||{}; S.tl.viewer=d.tl.viewer||'all'; } return; }
  d=JSON.parse(localStorage.getItem(KEY_V8)||'null'); if(d){ S.ctx=migrateV8(d); S.per=d.per||{}; S.sel=d.sel||null; S.log=d.log||[]; save(); } }catch(e){} }
function per(id){ if(!S.per[id]) S.per[id]={showRef:(byId(id)||{}).role!=='witness',headerDark:true,hero:true,timeline:true,tree:true,caseTree:false,design:'v8',gate:{}}; return S.per[id]; }
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
function el(tag,attrs,html){ const e=document.createElement(tag); if(attrs) for(const k in attrs){ if(k==='class') e.className=attrs[k]; else if(k.startsWith('data-')||k.startsWith('aria-')||k==='role'||k==='tabindex') e.setAttribute(k,attrs[k]); else e[k]=attrs[k]; } if(html!==undefined) e.innerHTML=html; return e; }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2600); }
function explicitEvents(){ return (S.ctx.events||[]).filter(e=>!e.implicit); }
function snap(){ return buildCaseSnapshot(S.ctx); }

/* ===== demo (synthetic) — an IR case with an explicit event history recorded through the engine ===== */
function demo(){
  let c=Object.assign({},S.ctx,{ref:'CDF-DEMO-2026-0001',srcType:'IR',cls:'إحالة مؤسسية',status:'',subState:'',events:[],archived:[],recordMode:'design',procedureRef:'',receivedAt:'2026-10-18T09:05',registeredAt:'2026-10-18T09:30',stateAt:'2026-10-18T09:30',snapshotAt:'2026-10-18T09:35',
    link:'',referrerBody:'قطاع ألفا (جهة تجريبية)',referrerTitle:'الأستاذ/',referrerName:'المُحيل بيتا',referrerEmail:'referrer.beta@example.test',authorityName:'صاحب الصلاحية دلتا',authorityEmail:'authority.delta@example.test',
    chairName:'رئيس اللجنة غاما',chairEmail:'chair.gamma@example.test',secName:'أمين اللجنة (نموذج)',secEmail:'investigation-committee@example.test',memberName:'العضو إبسيلون',memberEmail:'member.epsilon@example.test',
    invName:'المحقق زيتا',invEmail:'investigator.zeta@example.test',partyName:'الموظف ألفا',partyGender:'m',partyEmail:'party.alpha@example.test',compName:'إدارة الحوكمة والامتثال المؤسسي (نموذج)',compEmail:'compliance@example.test',evidenceName:'إدارة تقنية المعلومات (نموذج)',evidenceEmail:'records.holder@example.test',
    meetingRef:'IC-MTG-2026-DEMO-07',meetingAt:'2026-10-22T10:00',meetingPlace:'قاعة الاجتماعات 2',meetingMode:'حضوري / عن بُعد',taskRef:'IC-TASK-2026-DEMO-11',dueAt:'2026-10-25T16:00',dueVerified:true,mandateRef:'IC-MND-2026-DEMO-03',decisionRef:'IC-REC-2026-DEMO-02',decisionStage:'بانتظار نظر صاحب الصلاحية',
    controlRuleId:'SLA-R-07 (نموذج)',triggerEventId:'EVT-2026-DEMO-0912',responsibleRole:'أمين اللجنة',accessScope:'البند 3 فقط — دون مرفقات التحقيق',hearingRef:'IC-HRG-2026-DEMO-02',hearingAt:'2026-10-27T10:00',hearingPlace:'قاعة الاجتماعات 2',hearingMode:'حضوري',witnessRef:'W-01 (نموذج)',witnessGender:'m',witnessEmail:'witness.one@example.test',statementCorrectionDays:'5'});
  c=recordInitialStatus(c,'IR-S1-01',{id:'DEMO-E0',occurredAt:'2026-10-18T09:05',recordedAt:'2026-10-18T09:06',note:'ورود الإحالة عبر المراسلات الرسمية (بيانات تجريبية)',actor:'أمانة اللجنة (نموذج)'}).ctx;
  [['IR-T01','DEMO-E1','2026-10-18T09:10','2026-10-18T09:11',{evidence:['سجل الإرسال الرسمي']}],['IR-T02','DEMO-E2','2026-10-18T09:20','2026-10-18T09:21',{evidence:['سند صفة الجهة المُحيلة']}],['IR-T03','DEMO-E3','2026-10-18T09:25','2026-10-18T09:26',{}],
   ['IR-T04','DEMO-E4','2026-10-18T09:30','2026-10-18T09:31',{approvedBy:'المسؤول المخول بالتسجيل (نموذج)',approvedAt:'2026-10-18T09:30',evidence:['قيد رسمي بوقته والمسؤول']}]].forEach(([t,id,at,rec,x])=>{ const r=applyApprovedTransition(c,t,Object.assign({id,occurredAt:at,recordedAt:rec,actor:'أمانة اللجنة (نموذج)'},x)); if(r.ok) c=r.ctx; });
  [['chair','CASE_PRESENTED','DEMO-T1','2026-10-18T10:00','2026-10-18T10:02',c.ref],['meeting','SCHEDULED','DEMO-T2','2026-10-18T11:00','2026-10-18T11:01',c.meetingRef],['meeting','INVITED','DEMO-T3','2026-10-18T11:30','2026-10-18T11:31',c.meetingRef]].forEach(([k,s,id,at,rec,ref])=>{ const r=recordTaskEvent(c,{id,taskKind:k,stepKey:s,occurredAt:at,recordedAt:rec,taskRef:ref,actor:'أمانة اللجنة (نموذج)',note:''}); if(r.ok) c=r.ctx; });
  S.ctx=c; if(!S.sel) S.sel='IR-02';
}

/* ===== case pane ===== */
const SRC_OPTIONS=[['','— غير محدد (لا يُفترض مسار) —'],['WB','بلاغ (قناة الإبلاغ) — المسار المعتمد'],['IR','إحالة مؤسسية — مسار مقترح'],['DR','إحالة مباشرة مخولة — مسار مقترح']];
const CASE_FIELDS=[
 {g:'بيانات الحالة',f:[['ref','الرقم المرجعي للحالة (من السجل)','text','CDF-IC-2026-…'],['srcType','مصدر الحالة (يحدد المسار الإجرائي)','source'],['cls','تصنيف الحالة','text','إحالة مؤسسية'],['status','الحالة الراهنة في المسار','status'],['recordMode','وضع السجل','select',[['design','تصميم (معاينة؛ التحذيرات لا توقف)'],['authoritative','رسمي (fail-closed: اعتماد وأدلة وسند)']]],['procedureRef','المرجعية الإجرائية للمسار (حقل إداري)','text','مثال: AAD.140 / ميثاق اللجنة'],['receivedAt','تاريخ الاستلام (received_at)','datetime-local'],['registeredAt','تاريخ القيد الرسمي (registered_at)','datetime-local'],['stateAt','دخول الحالة الراهنة (state_entered_at) — يُشتق من السجل','datetime-local'],['snapshotAt','وقت لقطة الإشعار الافتراضي (notification_event_at)','datetime-local'],['link','رابط الحالة في النظام (اختياري)','url','https://…']]},
 {g:'الجهة المُحيلة / صاحب الصلاحية',f:[['referrerBody','الجهة المُحيلة','text','قطاع ألفا'],['referrerTitle','لقب المُحيل','select',[['الأستاذ/','الأستاذ/'],['الأستاذة/','الأستاذة/'],['سعادة/','سعادة/'],['الدكتور/','الدكتور/'],['الدكتورة/','الدكتورة/'],['المهندس/','المهندس/'],['المهندسة/','المهندسة/'],['','بدون لقب']]],['referrerName','اسم المُحيل','text',''],['referrerEmail','بريد المُحيل','email',''],['authorityName','صاحب الصلاحية (للتكليف المباشر والقرارات)','text',''],['authorityEmail','بريد صاحب الصلاحية','email',''],['reporterChannel','قناة المبلغ (لا بريد ولا هوية)','text','القناة المعتمدة للإبلاغ']]},
 {g:'اللجنة وأمانتها',f:[['chairName','اسم رئيس اللجنة','text',''],['chairEmail','بريد رئيس اللجنة','email',''],['secName','اسم أمين اللجنة','text',''],['secEmail','بريد أمانة اللجنة (المرسل)','email',''],['memberName','اسم العضو المخاطب','text',''],['memberTitle','لقب العضو','select',[['','—'],['الأستاذ/','الأستاذ/'],['الأستاذة/','الأستاذة/'],['الدكتور/','الدكتور/'],['الدكتورة/','الدكتورة/']]],['memberEmail','بريد العضو','email',''],['accessScope','نطاق اطلاع العضو (committee_member_access_scope)','text','البند 3 فقط']]},
 {g:'التحقيق والأطراف',f:[['invName','المكلف بالتحقيق','text',''],['invEmail','بريد المكلف','email',''],['mandateRef','مرجع تكليف التحقيق (investigation_mandate_reference)','text',''],['partyName','الطرف المعني','text',''],['partyGender','صفة الطرف المعني','select',[['m','الأستاذ'],['f','الأستاذة']]],['partyEmail','بريد الطرف المعني','email',''],['evidenceName','الجهة الحائزة للمستند','text',''],['evidenceEmail','بريد الجهة الحائزة','email',''],['compName','اسم الجهة المختصة بالامتثال (الجهة المصدرة لإشعارات البلاغات — AAD.140)','text','إدارة الحوكمة والامتثال المؤسسي'],['compEmail','بريد الجهة المختصة بالامتثال (يظهر في تذييل إشعارات البلاغات)','email','']]},
 {g:'جلسات الاستماع والشهود (إجراءات داخل حالة التحقيق)',f:[['hearingRef','مرجع جلسة الاستماع (hearing_reference)','text','IC-HRG-2026-…'],['hearingAt','موعد الجلسة (hearing_at، الرياض)','datetime-local'],['hearingPlace','مكان الجلسة','text',''],['hearingMode','طريقة الانعقاد','text','حضوري / عن بُعد'],['witnessRef','رمز الشاهد المخاطب (لا اسم — QA-05)','text','W-01'],['witnessGender','صفة الشاهد','select',[['m','الأستاذ'],['f','الأستاذة']]],['witnessEmail','بريد الشاهد (للدعوة فقط)','email',''],['statementCorrectionDays','مدة طلب تصحيح الإفادة (أيام)','text','']]},
 {g:'الاجتماع / المهمة / المدد',f:[['meetingRef','مرجع الاجتماع','text',''],['meetingAt','موعد الاجتماع','datetime-local'],['meetingPlace','مكان الانعقاد','text',''],['meetingMode','طريقة الانعقاد','text','حضوري / عن بُعد'],['taskRef','مرجع التكليف / المهمة','text',''],['dueAt','موعد الاستحقاق المثبت (verified_due_at)','datetime-local'],['dueVerified','الموعد محسوب من قاعدة مدة معتمدة','check']]},
 {g:'القرار والضبط الرقابي',f:[['decisionRef','مرجع التوصية / القرار (دون مضمونه)','text',''],['decisionStage','مرحلة القرار (decision_stage)','text','بانتظار نظر صاحب الصلاحية'],['controlRuleId','قاعدة الضبط (control_rule_id)','text',''],['triggerEventId','الحدث المحفز (trigger_event_id)','text',''],['responsibleRole','المسؤول عن المعالجة (responsible_role)','text','']]},
];
function sourceSelect(id){ const s=el('select',{id}); SRC_OPTIONS.forEach(([v,t])=>s.appendChild(el('option',{value:v},t))); s.value=S.ctx.srcType||''; s.onchange=()=>requestSourceChange(s.value,s); return s; }
function requestSourceChange(v, sel){
  if(v===(S.ctx.srcType||'')) return;
  if(!explicitEvents().length){ S.ctx.srcType=v; S.ctx.status=''; S.ctx.subState=''; S.ctx.stateAt=''; S.pendingSource=null; onCtx(); toast(v?'تم تحديد المصدر: '+SOURCE_LABEL[v]+' — سجّل الحالة الابتدائية':'المصدر غير محدد: لا مسار افتراضي'); return; }
  S.pendingSource=v; if(sel) sel.value=S.ctx.srcType||''; renderCasePane(); renderTimeLens(); toast('تغيير المصدر يؤرشف سجل الأحداث الحالي — أكّد أو ألغِ');
}
function sourceWarnBar(){
  if(S.pendingSource===null) return '';
  const to=S.pendingSource; return `<div class="warnbar srcwarn" data-testid="source-change-warning"><b>تحذير:</b> تغيير مصدر الحالة من «${esc(SOURCE_LABEL[S.ctx.srcType]||'غير محدد')}» إلى «${esc(to?SOURCE_LABEL[to]:'غير محدد')}» يغيّر المسار والحالات والانتقالات والإشعارات المتاحة. لا يُعاد كتابة التاريخ: يُحفظ السجل الحالي (${explicitEvents().length} حدثاً) في الأرشيف ويبدأ سجل جديد بقيد «تصحيح مصدر الحالة».
  <div class="grid2" style="margin-top:8px"><label class="fld full"><span>سبب التصحيح (مطلوب)</span><input id="src-reason" placeholder="مثال: تبيّن أن المخاطبة إحالة مؤسسية لا بلاغاً"></label></div>
  <div class="actions" style="margin-top:8px"><button class="btn pri sm" id="src-confirm" data-testid="source-change-confirm">تأكيد التصحيح وأرشفة السجل</button><button class="btn sm" id="src-cancel">إلغاء</button></div></div>`;
}
function wireSourceWarn(host){
  const ok=host.querySelector('#src-confirm'), no=host.querySelector('#src-cancel'); if(!ok) return;
  ok.onclick=()=>{ const reason=(host.querySelector('#src-reason').value||'').trim(); const r=correctSource(S.ctx,S.pendingSource,{recordedAt:nowLocalISO(),note:reason}); if(!r.ok){ toast(r.errors.join(' · ')); return; } S.ctx=r.ctx; S.pendingSource=null; S.tl.open={}; onCtx(); toast('سُجل تصحيح المصدر وأُرشف السجل السابق'); };
  no.onclick=()=>{ S.pendingSource=null; renderCasePane(); renderTimeLens(); };
}
function statusSelect(id){
  const s=el('select',{id}); const src=S.ctx.srcType; const T=getWorkflowDefinition(src);
  if(!T){ s.appendChild(el('option',{value:''},'— حدد مصدر الحالة أولاً —')); s.disabled=true; return s; }
  s.appendChild(el('option',{value:''},'— لم تُسجَّل حالة —'));
  T.mainStages.forEach(M=>{ const og=el('optgroup',{label:`${M.sequence} · ${M.titleAr}`}); T.statuses.filter(x=>x.stageId===M.id).forEach(x=>og.appendChild(el('option',{value:x.id},`${x.id} · ${x.titleAr}`))); s.appendChild(og); });
  const sn=snap(); s.value=sn.currentStatusId||'';
  if(explicitEvents().some(e=>e.type==='INITIAL_STATUS_RECORDED'||e.type==='STATUS_TRANSITION')){ s.disabled=true; s.title='الحالة تُدار من سجل الأحداث في TimeLens (انتقال معتمد أو قيد معكوس)'; }
  s.onchange=()=>{ if(!s.value) return; const r=recordInitialStatus(S.ctx,s.value,{occurredAt:S.ctx.stateAt||'',recordedAt:nowLocalISO(),note:'تسجيل الحالة الابتدائية من سياق الحالة'}); if(!r.ok){ toast(r.errors.join(' · ')); s.value=''; return; } S.ctx=r.ctx; onCtx(); toast(r.warnings.length?r.warnings[0]:'سُجلت الحالة الابتدائية'); };
  return s;
}
function renderCasePane(){
  const host=$('#case-form'); host.innerHTML='';
  const warn=el('div',{class:'fs full-row'}); warn.innerHTML=sourceWarnBar(); if(S.pendingSource!==null){ host.appendChild(warn); wireSourceWarn(warn); }
  CASE_FIELDS.forEach((G,gi)=>{
    const sec=el('section',{class:'fs'}); sec.appendChild(el('h3',{},`<span class="num">${gi+1}</span>${G.g}`)); const grid=el('div',{class:'grid2'});
    G.f.forEach(([k,label,type,extra])=>{
      const w=el('label',{class:'fld'+(type==='check'?' chk':'')});
      if(type==='source'){ w.innerHTML=`<span>${label}</span>`; w.appendChild(sourceSelect('c_'+k)); const sn=snap(); w.appendChild(el('small',{class:'fhint'},sn.known?`${esc(sn.track.nameAr)} · ${esc(sn.track.version)} · ${esc(GOV_LABEL[sn.track.governanceStatus]||sn.track.governanceStatus)}`:'لا يُعامل المصدر غير المحدد كبلاغ؛ لا مسار ولا انتقالات قبل التحديد.')); }
      else if(type==='status'){ w.innerHTML=`<span>${label}</span>`; w.appendChild(statusSelect('c_'+k)); const sn=snap(); if(sn.currentStatus) w.appendChild(el('small',{class:'fhint'},`${esc(sn.currentStatus.statusTypeAr)} · ${esc(WF.levelLabels[sn.currentStatus.disclosure])} · ${esc(WF.basisLabels[sn.currentStatus.governanceBasis])}${sn.currentStatus.v8Code?' · V8 '+sn.currentStatus.v8Code:''}`)); }
      else if(type==='select'){ w.innerHTML=`<span>${label}</span>`; const s=el('select',{id:'c_'+k}); extra.forEach(([v,t])=>s.appendChild(el('option',{value:v},t))); s.value=S.ctx[k]??''; s.onchange=()=>{S.ctx[k]=s.value; onCtx();}; w.appendChild(s); }
      else if(type==='check'){ const c=el('input',{type:'checkbox',id:'c_'+k}); c.checked=!!S.ctx[k]; c.onchange=()=>{S.ctx[k]=c.checked; onCtx();}; w.appendChild(c); w.appendChild(el('span',{},label)); }
      else { w.innerHTML=`<span>${label}</span>`; const i=el('input',{type,id:'c_'+k,placeholder:extra||''}); i.value=S.ctx[k]||''; if(k==='stateAt'&&explicitEvents().length){ i.disabled=true; i.title='يُشتق من آخر حدث فعّال في السجل'; } i.oninput=()=>{S.ctx[k]=i.value; onCtx(true);}; i.onchange=()=>onCtx(); w.appendChild(i); }
      grid.appendChild(w);
    });
    sec.appendChild(grid); host.appendChild(sec);
  });
}
let ctxTimer=null;
function onCtx(soft){ save(); renderStrip(); if(soft){ clearTimeout(ctxTimer); ctxTimer=setTimeout(()=>{ renderNext(); renderCompose(); renderTimeLens(); },350); } else { renderCasePane(); renderNext(); renderFinder(); renderCompose(); renderTimeLens(); } }

/* ===== the artistic case strip (summary for navigation) ===== */
function renderStrip(){
  const c=S.ctx; const sn=snap(); const host=$('#strip');
  const cell=(l,v,cls)=>`<div class="sc ${cls||''}"><div class="l">${l}</div><div class="v">${v||'<span class="muted">لم يُحدد</span>'}</div></div>`;
  const stg=sn.currentStage; const st=sn.currentStatus;
  host.innerHTML=`<div class="sc ref"><div class="l">الرقم المرجعي</div><div class="v" dir="ltr">${esc(c.ref)||'<span class="muted">—</span>'}</div></div>
   ${cell('مصدر الحالة / المسار',sn.known?`${esc(sn.label)} <span class="tag">${esc(sn.track.version)}</span>`:'<span class="warn-t">غير محدد</span>')}
   <div class="sc"><div class="l">المرحلة الرئيسية</div><div class="v">${stg?`<span class="pill" style="background:${stg.color}">${stg.sequence} · ${esc(stg.shortAr)}</span>${sn.hold?' <span class="tag">معلّقة</span>':''}${sn.cancelled?' <span class="tag">ملغاة</span>':''}`:'<span class="muted">—</span>'}</div></div>
   ${cell('الحالة الراهنة',st?`${esc(st.titleAr)} <span class="muted" dir="ltr">${st.id}</span>`:'')}
   ${cell('دخول الحالة الراهنة',c.stateAt?esc(fmtDateTime(c.stateAt)):(st?esc(T_NO_DATE):''))}
   ${cell('الجهة المُحيلة / الصلاحية',esc(c.referrerBody||c.authorityName))}
   <div class="sc act"><button class="btn sm ghost" data-go="case">تعديل سياق الحالة</button><button class="btn sm ghost" data-go="timelens">TimeLens</button></div>`;
}

/* ===== finder ===== */
function nStatus(n){ const sn=snap(); return sn.known?statusLinkedTo(n,sn.source):null; }
function linkedToStatus(statusId){ const sn=snap(); return sn.known?notificationsForStatus(sn.source,statusId):[]; }
function linkedToState(sub){ return DATA.notifications.filter(n=>n.state===sub); }
function renderFinder(){
  const host=$('#finder'); const f=S.filters; const sn=snap(); const track=sn.known?sn.track:null;
  const rail=$('#rail'); rail.innerHTML='';
  const taskCount=DATA.notifications.filter(n=>n.state==='CASE_UNCHANGED').length;
  if(track){
    const stageOfN=n=>{ const st=nStatus(n); return st?st.stageId:''; };
    track.mainStages.forEach(M=>{ const cnt=DATA.notifications.filter(n=>stageOfN(n)===M.id).length; const b=el('button',{class:'stage'+(sn.currentStage&&sn.currentStage.id===M.id?' cur':'')+(f.sub===M.id||(f.sub&&f.sub.startsWith(M.id+'-'))?' on':'')}); b.style.setProperty('--c',M.color);
      b.innerHTML=`<span class="k">${M.sequence}</span><span class="t">${esc(M.shortAr)}</span><span class="n">${cnt} إشعاراً</span>`; b.onclick=()=>{ f.sub=f.sub===M.id?'':M.id; renderFinder(); }; rail.appendChild(b); });
  } else {
    DATA.states.forEach(M=>{ const b=el('button',{class:'stage'+(f.sub&&f.sub.startsWith(M.code)?' on':'')}); b.style.setProperty('--c',M.color); b.innerHTML=`<span class="k">${M.code}</span><span class="t">${esc(M.name)}</span><span class="n">${DATA.notifications.filter(n=>n.state.startsWith(M.code)).length}</span>`; b.onclick=()=>{ f.sub=f.sub.startsWith(M.code)&&f.sub.length===2?'':M.code; renderFinder(); }; rail.appendChild(b); });
  }
  const tb=el('button',{class:'stage task'+(f.sub==='CASE_UNCHANGED'?' on':'')}); tb.innerHTML=`<span class="k">مهام</span><span class="t">إشعارات لا تغيّر حالة القضية</span><span class="n">${taskCount}</span>`; tb.onclick=()=>{ f.sub=f.sub==='CASE_UNCHANGED'?'':'CASE_UNCHANGED'; renderFinder(); }; rail.appendChild(tb);
  const chips=$('#subchips'); chips.innerHTML='';
  if(track){
    const stage=track.mainStages.find(M=>M.id===f.sub); const status=track.statuses.find(x=>x.id===f.sub);
    if(stage){ track.statuses.filter(x=>x.stageId===stage.id).forEach(x=>{ const c=el('button',{class:'chip'+(sn.currentStatusId===x.id?' cur':'')},`<b>${esc(x.titleAr)}</b> <i>${linkedToStatus(x.id).length}</i>`); c.title=x.id; c.onclick=()=>{ f.sub=x.id; renderFinder(); }; chips.appendChild(c); }); if(!track.statuses.some(x=>x.stageId===stage.id&&linkedToStatus(x.id).length)) chips.appendChild(el('span',{class:'hint'},'لا إشعار من المصنف مرتبط بحالات هذه المرحلة؛ تُستخدم إشعارات المهام أو تُقترح إشعارات جديدة.')); }
    else if(status){ const back=el('button',{class:'chip on'},`<b>${esc(status.titleAr)}</b> ✕`); back.onclick=()=>{ f.sub=status.stageId; renderFinder(); }; chips.appendChild(back); chips.appendChild(el('span',{class:'hint'},esc(status.longAr))); }
  } else {
    if(f.sub&&f.sub.length===2){ DATA.substates.filter(x=>x.main===f.sub).forEach(x=>{ const c=el('button',{class:'chip'},`${x.code} <b>${esc(x.name)}</b> <i>${linkedToState(x.code).length}</i>`); c.onclick=()=>{ f.sub=x.code; renderFinder(); }; chips.appendChild(c); }); }
    else if(f.sub&&f.sub.length>2&&f.sub!=='CASE_UNCHANGED'){ const x=subOf(f.sub); if(x){ const back=el('button',{class:'chip on'},`${x.code} <b>${esc(x.name)}</b> ✕`); back.onclick=()=>{ f.sub=x.main; renderFinder(); }; chips.appendChild(back); chips.appendChild(el('span',{class:'hint'},esc(x.desc))); } }
    if(!f.sub) chips.appendChild(el('span',{class:'hint'},'مصدر الحالة غير محدد: تُعرض حالات المصنف V8 للمرجع فقط؛ حدد المصدر لعرض مسار الحالة الفعلي.'));
  }
  const cats=$('#catchips'); cats.innerHTML='';
  const all=el('button',{class:'chip'+(f.cat?'':' on')},`الكل <i>${DATA.notifications.length}</i>`); all.onclick=()=>{f.cat='';renderFinder();}; cats.appendChild(all);
  Object.keys(DATA.cats).forEach(k=>{ const other=track&&!WF.families[track.source].includes(k); const c=el('button',{class:'chip'+(f.cat===k?' on':'')+(other?' other':'')},`${k} <b>${esc(DATA.cats[k].name)}</b> <i>${DATA.notifications.filter(n=>n.cat===k).length}</i>${other?' <i>مسار آخر</i>':''}`); c.style.setProperty('--c',DATA.cats[k].color); c.onclick=()=>{f.cat=f.cat===k?'':k;renderFinder();}; cats.appendChild(c); });
  const lk=el('button',{class:'chip'+(f.linked?' on':'')},`المرتبطة بالحالة الراهنة فقط`); lk.onclick=()=>{f.linked=!f.linked;renderFinder();}; cats.appendChild(lk);
  const q=(f.q||'').trim().toLowerCase();
  const inSub=n=>{ if(!f.sub) return true; if(f.sub==='CASE_UNCHANGED') return n.state==='CASE_UNCHANGED'; if(track){ const st=nStatus(n); return !!st&&(st.id===f.sub||st.stageId===f.sub); } return n.state.startsWith(f.sub); };
  const isLinked=n=>{ if(n.state==='CASE_UNCHANGED') return !CASE_JOURNEYS[n.cat]; if(track){ const st=nStatus(n); return !!st&&st.id===sn.currentStatusId&&WF.families[track.source].includes(n.cat); } return n.state===S.ctx.subState; };
  let list=DATA.notifications.filter(n=>(!f.cat||n.cat===f.cat)&&inSub(n)&&(!f.linked||isLinked(n))&&(!q||[n.id,n.title,n.event,n.recipient,n.v5,n.card].join(' ').toLowerCase().includes(q)));
  host.innerHTML='';
  if(!list.length){ host.appendChild(el('div',{class:'empty'},'لا توجد إشعارات مطابقة.')); }
  let lastCat='';
  list.forEach(n=>{
    if(n.cat!==lastCat){ lastCat=n.cat; host.appendChild(el('div',{class:'grp'},`<b>${n.cat}</b> ${esc(DATA.cats[n.cat].name)}${track&&!WF.families[track.source].includes(n.cat)?' <span class="tag">عائلة مسار آخر — غير مؤهلة لهذا المصدر</span>':''}`)); }
    const st=track?nStatus(n):null; const stage=st?stageOf(track.source,st.stageId):null; const sub=n.state==='CASE_UNCHANGED'?null:subOf(n.state); const main=sub?mainOf(sub.main):null;
    const here=track?(!!st&&st.id===sn.currentStatusId):(n.state===S.ctx.subState&&!!S.ctx.subState);
    const other=track&&!WF.families[track.source].includes(n.cat);
    const card=el('button',{class:'ncard'+(S.sel===n.id?' sel':'')+(here?' here':'')+(other?' other':''),'data-testid':'ncard-'+n.id}); card.style.setProperty('--c',DATA.cats[n.cat].color);
    const stTag=track?(st?`<span class="st" style="--c:${stage.color}">${esc(st.shortAr)}</span>`:(n.state==='CASE_UNCHANGED'?'<span class="st">لا تغيّر الحالة</span>':`<span class="st">لا مقابل في مسار ${esc(track.source)}</span>`)):(sub?`<span class="st" style="--c:${main.color}">${sub.code} · ${esc(sub.name)}</span>`:'<span class="st">لا تغيّر الحالة</span>');
    card.innerHTML=`<div class="row1"><span class="id">${n.id}</span><span class="mat ${n.maturity}">${n.maturity}</span>${n.addedIn?`<span class="tag v9">إضافة ${esc(n.addedIn)} مقترحة</span>`:''}${here?'<span class="here">الحالة الراهنة</span>':''}</div><div class="ttl">${esc(n.title)}</div><div class="meta"><span>→ ${esc(n.recipient)}</span><span class="${n.actionClass==='للعلم'?'info':'act'}">${esc(n.actionClass)}</span>${stTag}</div>`;
    card.onclick=()=>{ select(n.id); };
    host.appendChild(card);
  });
  $('#count').textContent=`${list.length} / ${DATA.notifications.length}`;
}
function select(id, go){ S.sel=id; per(id); save(); renderFinder(); renderCompose(); renderTimeLens(); if(go!==false) showPane('compose'); }

/* ===== compact "what next" aside (finder) ===== */
function renderNext(){
  const host=$('#next'); const sn=snap();
  if(!sn.known){ host.innerHTML='<div class="empty">حدد <b>مصدر الحالة</b> في «سياق الحالة» لعرض مسارها وانتقالاتها والإشعارات المرتبطة. لا يُفترض مسار افتراضي.</div>'; return; }
  const st=sn.currentStatus;
  if(!st){ host.innerHTML=`<div class="empty">المسار: <b>${esc(sn.track.nameAr)}</b> (${esc(sn.track.version)}). لم تُسجَّل حالة بعد — سجّل الحالة الابتدائية في «سياق الحالة» أو في TimeLens.</div>`; return; }
  const stage=sn.currentStage; const here=linkedToStatus(st.id); const outs=getAllowedTransitions(sn.source,st.id);
  const nbtn=n=>`<button class="mini" data-sel="${n.id}" title="${esc(n.title)}"><b>${n.id}</b> ${esc(n.title)}</button>`;
  let h=`<div class="curcard" style="--c:${stage.color}"><div class="k">${stage.sequence} · ${esc(stage.titleAr)} <span class="muted" dir="ltr">${st.id}</span></div><div class="t">${esc(st.titleAr)}</div><div class="d">${esc(st.longAr)}</div><div class="d"><b>للمستلم الخارجي:</b> ${esc(st.recipientAr||'(محجوبة — تُعرض عبارة المرحلة)')}</div><div class="d"><span class="tag">${esc(st.statusTypeAr)}</span> <span class="tag">${esc(WF.levelLabels[st.disclosure])}</span> <span class="tag">${esc(WF.basisLabels[st.governanceBasis])}</span>${sn.hold?' <span class="tag warn-t">معلّقة</span>':''}${sn.cancelled?' <span class="tag warn-t">ملغاة</span>':''}</div></div>`;
  h+=`<h4>إشعارات هذه الحالة <i>${here.length}</i></h4><div class="minis">${here.map(nbtn).join('')||'<span class="muted">لا إشعار من المصنف مرتبط مباشرة بهذه الحالة.</span>'}</div>`;
  h+=`<h4>الانتقالات المتاحة <i>${outs.length}</i></h4>`;
  if(!outs.length) h+='<div class="muted">لا انتقالات معرّفة من هذه الحالة (نهاية مسار).</div>';
  outs.forEach(t=>{ const to=statusOf(sn.source,t.toStatusId); h+=`<div class="tcard"><div class="r1"><span class="tid">${t.id}</span><span class="arrow">← <b class="to" style="--c:${stageOf(sn.source,to.stageId).color}">${esc(to.titleAr)}</b></span></div><div class="r3"><code>${esc(t.triggerEvent)}</code> · ${esc(t.approver)}${t.requiredApproval?' · <b>اعتماد مطلوب</b>':''} · <span class="tag">${esc(WF.basisLabels[t.governanceBasis])}</span></div><button class="btn sm ghost" data-tl="${t.id}">تسجيل الانتقال في TimeLens</button></div>`; });
  const tasks=DATA.notifications.filter(n=>n.state==='CASE_UNCHANGED'); const byCat={}; tasks.forEach(n=>(byCat[n.cat]=byCat[n.cat]||[]).push(n));
  h+=`<h4>إشعارات المهام (لا تغيّر حالة القضية) <i>${tasks.length}</i></h4>`+Object.keys(byCat).map(k=>`<div class="grp">${k} · ${esc(DATA.cats[k].name)}</div><div class="minis">${byCat[k].map(nbtn).join('')}</div>`).join('');
  host.innerHTML=h;
  host.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>select(b.dataset.sel));
  host.querySelectorAll('[data-tl]').forEach(b=>b.onclick=()=>{ S.tl.pick=b.dataset.tl; S.tl.form=null; renderTimeLens(); showPane('timelens'); });
}

/* ===== TimeLens — the two-layer case timeline explorer ===== */
const VIEWERS=[['all','كل الأحداث (عرض داخلي كامل)'],['chair','رئيس اللجنة'],['secretary','أمين اللجنة'],['member','عضو اللجنة'],['investigator','المكلف بالتحقيق'],['compliance','إدارة الحوكمة والامتثال'],['authority','صاحب الصلاحية'],['referring','الجهة المُحيلة'],['reporter','مقدم البلاغ'],['caseparty','الطرف المعني'],['witness','الشاهد'],['evidence','الجهة الحائزة للمستند']];
function tlStateClass(s){ return 'st-'+s.toLowerCase().replace('_','-'); }
function renderTimeLens(){
  const host=$('#timelens'); if(!host) return; const sn=snap(); const T=sn.track; const tl=S.tl;
  const head=`<section class="fs tl-head"><div class="tl-row">
    <label class="fld"><span>مصدر الحالة</span><span id="tl-src-host"></span></label>
    <label class="fld"><span>وضع السجل</span><select id="tl-mode"><option value="design" ${S.ctx.recordMode!=='authoritative'?'selected':''}>تصميم (معاينة)</option><option value="authoritative" ${S.ctx.recordMode==='authoritative'?'selected':''}>رسمي (fail-closed)</option></select></label>
    <label class="fld grow"><span>المرجعية الإجرائية للمسار (حقل إداري)</span><input id="tl-proc" value="${esc(S.ctx.procedureRef||'')}" placeholder="${esc(T?T.authorityRef:'حدد المصدر أولاً')}"></label>
    <label class="fld"><span>عرض المسار كما يراه</span><select id="tl-viewer" data-testid="tl-viewer">${VIEWERS.filter(([k])=>k==='all'||!T||(T.recipientProfiles.some(p=>p.role===k)||ROLES[k])).map(([k,t])=>`<option value="${k}" ${tl.viewer===k?'selected':''}>${t}</option>`).join('')}</select></label>
    ${tl.viewer==='member'?`<label class="fld chk"><input type="checkbox" id="tl-recused" ${tl.recused?'checked':''}><span>العضو متنحٍ / تعارض مصالح</span></label>`:''}
   </div>${sourceWarnBar()}
   ${T?`<div class="tl-meta"><span class="pill" style="background:${sn.currentStage?sn.currentStage.color:'#D7D2CB'}">${esc(T.nameAr)} · ${esc(T.version)}</span> <span class="gov ${T.governanceStatus==='APPROVED_SOURCE_MAPPING'?'ok':'warn'}">${esc(GOV_LABEL[T.governanceStatus]||T.governanceStatus)}</span> <span class="tag">${esc(WF.basisLabels[T.authorityStatus])}</span> <span class="tag">المرجع: ${esc(T.authorityRef)}</span><div class="d">${esc(T.authorityNoteAr)}</div><div class="d muted">${esc(T.emphasisAr)}</div>${sn.warnings.length?`<div class="warnbar">${sn.warnings.map(esc).join('<br>')}</div>`:''}</div>`:''}
  </section>`;
  if(!T){ host.innerHTML=head+`<div class="empty big" data-testid="tl-empty">مصدر الحالة غير محدد.<br><small>لا يُفترض أي مسار (ولا مسار البلاغ) قبل تحديد المصدر؛ حدده من القائمة أعلاه أو من «سياق الحالة».</small></div>`; wireTlHead(host); return; }
  const P=tl.viewer==='all'?null:resolveRecipientTimeline(sn,tl.viewer,{recused:tl.recused,maxEvents:999});
  const viewerNote=P?`<div class="warnbar info" data-testid="tl-viewer-note"><b>${esc(P.roleLabel)}</b> — ${esc(P.profile)} · المستويات: ${P.levels.map(l=>esc(WF.levelLabels[l])).join('، ')} · ظاهر ${P.shownCount} / محجوب ${P.hiddenCount}. ${esc(P.profileNote||'')}${P.external?' <b>(عرض خارجي: تُحذف الحقول الداخلية قبل العرض)</b>':''}</div>`:'';
  /* V10 TimeLens: the case journey as the chosen viewer sees it — the SAME resolver and browser renderer the generator uses for every notification.
     Open state: the current stage is open by default; a stage the user toggled keeps its explicit state (tl.open[key] true/false). */
  const TLV=resolveCaseJourneyTL(sn,tl.viewer==='all'?'secretary':tl.viewer,{recused:tl.recused,maxEvents:999,fullPathUrl:S.ctx.link});
  if(tl.viewer==='all'){ TLV.roleLabel='عرض داخلي كامل'; TLV.caption='كل الأحداث والحالات المقيدة في سجل الحالة (عرض داخلي كامل دون تصفية إفصاح؛ ما يراه كل مستلم يُختار من «عرض المسار كما يراه»).'; }
  const isOpen=sg=>tl.open[sg.key]===undefined?!!sg.isCurrent:!!tl.open[sg.key];
  const cards=renderTimeLensBrowser(TLV,{prefix:'tl',isOpen,hooks:true});
  const panels='';
  // the selected notification's own TimeLens (exactly what the generator renders into its e-mail) + the task-event ledger form
  let tj='';
  const nSel=S.sel?byId(S.sel):null;
  if(nSel){ const oSel=per(nSel.id); const evAt=oSel.eventAt||S.ctx.snapshotAt||'';
    const TLN=resolveTimeline(nSel,S.ctx,nSel.role,{eventAt:evAt,asOf:evAt,recused:!!oSel.recused,maxEvents:999,fullPathUrl:oSel.ctaUrl||S.ctx.link});
    TLN.levels=resolveJourneyLevels(nSel,S.ctx,nSel.role,{});   // V12 three-level journey
    const RG=TLN.registry||{}; tl.openTj=tl.openTj||{}; const isOpenTj=sg=>tl.openTj[sg.key]===undefined?!!(sg.isCurrent||sg.isFocus):!!tl.openTj[sg.key];
    const REG=TL_REGISTRY[nSel.id]||{}; const kinds=Object.keys(TASK_JOURNEYS.kinds); const F=tl.taskForm||{}; const kind=TASK_JOURNEYS.kinds[F.taskKind]?F.taskKind:(TASK_JOURNEYS.kinds[REG.k||REG.pt]?(REG.k||REG.pt):kinds[0]); const K=TASK_JOURNEYS.kinds[kind];
    tj=`<section class="fs" data-testid="tj-section"><h3>مسار الإشعار المختار <i>${esc(nSel.id)} · ${esc(nSel.title)}</i> <span class="tag" data-testid="tj-profile">${esc(TLN.profileLabel)}</span> <span class="tag" dir="ltr">${esc(TLN.profile)}</span></h3>
      <div class="d muted" style="margin-bottom:8px">${esc(TLN.profileDesc||'')} · مستوى التفصيل: ${esc(TLN.detailLabel)} · سياسة الإفصاح: <span dir="ltr">${esc(TLN.disclosurePolicy)}</span> · تعريف المسار: ${esc(RG.Workflow_Definition_Version||'—')}</div>
      ${renderTimeLensBrowser(TLN,{prefix:'tj',isOpen:isOpenTj,hooks:true,head:false})}
      <div class="actions"><button class="btn sm" data-sel="${esc(nSel.id)}">فتح الإعداد والمعاينة</button></div>
      <h4 style="margin:14px 0 6px">سجل أحداث المهمة (TASK_EVENT) <i class="muted">تعريف ${esc(TASK_JOURNEYS.version)} مقترح تصميمياً — يلزم اعتماد الحوكمة</i></h4>
      <div class="grid2"><label class="fld"><span>المهمة *</span><select id="tj-kind" data-testid="tj-kind">${kinds.map(k=>`<option value="${k}" ${k===kind?'selected':''}>${esc(TASK_JOURNEYS.kinds[k].labelAr)}</option>`).join('')}</select></label>
        <label class="fld"><span>الخطوة *</span><select id="tj-step" data-testid="tj-step">${K.steps.map(s=>`<option value="${s.key}" ${F.stepKey===s.key?'selected':''}>${esc(s.titleAr)}</option>`).join('')}</select></label>
        <label class="fld"><span>مرجع المهمة</span><input id="tj-ref" value="${esc(F.taskRef!==undefined?F.taskRef:taskRefOf(S.ctx,kind))}" placeholder="${esc(TASK_JOURNEYS.refField[kind]||'')}"></label>
        <label class="fld"><span>وقت الوقوع (occurred_at) *</span><input type="datetime-local" id="tj-at" data-testid="tj-at" value="${esc(F.occurredAt||'')}"></label>
        <label class="fld"><span>وقت التسجيل (recorded_at)</span><input type="datetime-local" id="tj-rec" value="${esc(F.recordedAt||nowLocalISO())}"></label>
        <label class="fld"><span>المسجِّل</span><input id="tj-actor" value="${esc(F.actor||'')}" placeholder="أمانة اللجنة"></label>
        <label class="fld full"><span>ملاحظة (دون مضمون الحالة)</span><input id="tj-note" value="${esc(F.note||'')}"></label></div>
      <div id="tj-val" class="valbox"></div><div class="actions"><button class="btn pri" id="tj-go" data-testid="tj-go">تسجيل حدث المهمة</button><span class="muted">تُقيَّد أحداث المهام في سجل الأحداث ذاته (إضافة فقط؛ قيد معكوس عند الخطأ) ولا تغيّر حالة القضية؛ الخطوة غير المقيدة تُعرض «سابقة — دون قيد مؤرَّخ» لا مكتملة.</span></div></section>`;
  }
  // explanation panel
  let explain='';
  const exId=tl.explain||sn.currentStatusId; const ex=exId?statusOf(sn.source,exId):null;
  if(ex){ const linked=linkedToStatus(ex.id); const ins=T.transitions.filter(t=>t.toStatusId===ex.id), outs=T.transitions.filter(t=>t.fromStatusId===ex.id);
    explain=`<section class="fs tl-explain" data-testid="tl-explain"><h3>شرح الحالة <i dir="ltr">${ex.id}</i>${ex.id===sn.currentStatusId?' <span class="here">الحالة الراهنة</span>':''}</h3>
      <div class="xg"><div><span class="l">العنوان</span><div class="v">${esc(ex.titleAr)}</div></div><div><span class="l">النوع</span><div class="v">${esc(ex.statusTypeAr)}</div></div><div><span class="l">مستوى الإفصاح</span><div class="v">${esc(WF.levelLabels[ex.disclosure])}</div></div><div><span class="l">سند الحوكمة</span><div class="v">${esc(WF.basisLabels[ex.governanceBasis])}</div></div><div><span class="l">المرجع</span><div class="v">${esc(ex.sourceReference||'—')}</div></div><div><span class="l">مقابل V8</span><div class="v" dir="ltr">${esc(ex.v8Code||'—')}</div></div></div>
      <div class="d"><b>الوصف:</b> ${esc(ex.longAr)}</div><div class="d"><b>ما يراه المستلم الخارجي:</b> ${esc(ex.recipientAr||'(محجوبة — تُعرض عبارة المرحلة فقط)')}</div><div class="d"><b>الإجراء التالي:</b> ${esc(ex.nextAr)}</div><div class="d warn"><b>داخلي:</b> ${esc(ex.internalAr)}</div>
      <div class="d"><b>عبارة الدخول:</b> ${esc(ex.enteredAr)} · <b>عبارة الاكتمال:</b> ${esc(ex.completedAr)} · <b>عند غياب الحدث:</b> ${esc(ex.missingAr)}</div>
      <div class="d"><b>يدخلها:</b> ${ins.map(t=>`<code>${t.id}</code>`).join(' ')||'—'} · <b>يخرج منها:</b> ${outs.map(t=>`<code>${t.id}</code>`).join(' ')||'—'}</div>
      <div class="minis">${linked.map(n=>`<button class="mini" data-sel="${n.id}"><b>${n.id}</b> ${esc(n.title)}</button>`).join('')||'<span class="muted">لا إشعار من المصنف مرتبط مباشرة بهذه الحالة.</span>'}</div></section>`; }
  // transitions with inline event form
  let trans='';
  const outs=sn.currentStatusId?getAllowedTransitions(sn.source,sn.currentStatusId):[];
  if(!sn.currentStatusId){ trans=`<section class="fs"><h3>الحالة الابتدائية</h3><div class="grid2"><label class="fld"><span>الحالة</span><span id="tl-init-host"></span></label><label class="fld"><span>وقت الوقوع (occurred_at)</span><input type="datetime-local" id="tl-init-at" value="${esc(S.ctx.stateAt||'')}"></label><label class="fld full"><span>ملاحظة</span><input id="tl-init-note" placeholder="سند تسجيل الحالة الابتدائية"></label></div><div class="actions"><button class="btn pri" id="tl-init-go" data-testid="tl-init-go">تسجيل الحالة الابتدائية</button></div></section>`; }
  else {
    trans=`<section class="fs"><h3>الانتقالات المتاحة من الحالة الراهنة <i>${outs.length}</i></h3>`;
    if(!outs.length) trans+='<div class="muted">لا انتقالات معرّفة من هذه الحالة (نهاية مسار).</div>';
    outs.forEach(t=>{ const to=statusOf(sn.source,t.toStatusId); const picked=tl.pick===t.id; const F=picked?(tl.form||{}):null;
      trans+=`<div class="tcard${picked?' on':''}" data-testid="tl-tr-${t.id}"><div class="r1"><span class="tid">${t.id}</span><span class="arrow">${esc(sn.currentStatus.shortAr)} ← <b class="to" style="--c:${stageOf(sn.source,to.stageId).color}">${esc(to.titleAr)}</b></span><span class="tag">${esc(WF.basisLabels[t.governanceBasis])}</span></div>
        <div class="r2"><code>${esc(t.triggerEvent)}</code></div><div class="r3"><b>الشروط:</b> ${t.guardConditions.map(esc).join('؛ ')||'—'} · <b>المخول:</b> ${esc(t.approver)}${t.requiredApproval?` · <b>اعتماد مطلوب:</b> ${esc(t.requiredApproval)}`:''}${t.requiredEvidence.length?` · <b>أدلة:</b> ${t.requiredEvidence.map(esc).join('، ')}`:''} · <b>الأثر:</b> ${esc(t.effect||'—')}${t.notes?` · <i>${esc(t.notes)}</i>`:''}</div>
        ${picked?`<div class="evform" data-testid="tl-form"><div class="grid2">
          <label class="fld"><span>وقت الوقوع (occurred_at) *</span><input type="datetime-local" data-f="occurredAt" value="${esc(F.occurredAt||'')}"></label>
          <label class="fld"><span>وقت التسجيل (recorded_at)</span><input type="datetime-local" data-f="recordedAt" value="${esc(F.recordedAt||nowLocalISO())}"></label>
          ${t.requiredApproval?`<label class="fld"><span>المعتمد (approved_by) *</span><input data-f="approvedBy" value="${esc(F.approvedBy||'')}" placeholder="${esc(t.requiredApproval)}"></label><label class="fld"><span>وقت الاعتماد (approved_at) *</span><input type="datetime-local" data-f="approvedAt" value="${esc(F.approvedAt||'')}"></label>`:''}
          ${t.requiredEvidence.length?`<div class="fld full"><span>الأدلة المطلوبة *</span><div class="sws">${t.requiredEvidence.map((e,i)=>`<label class="sw"><input type="checkbox" data-ev="${esc(e)}" ${(F.evidence||[]).includes(e)?'checked':''}><span>${esc(e)}</span></label>`).join('')}</div></div>`:''}
          <label class="fld full"><span>ملاحظة / سند إضافي</span><input data-f="note" value="${esc(F.note||'')}"></label><label class="fld"><span>المسجِّل</span><input data-f="actor" value="${esc(F.actor||'')}" placeholder="أمانة اللجنة"></label></div>
          <div id="tl-val" class="valbox"></div>
          <div class="actions"><button class="btn" data-tlv="${t.id}" data-testid="tl-validate">تحقق</button><button class="btn pri" data-tla="${t.id}" data-testid="tl-apply">تسجيل الانتقال</button><button class="btn ghost" data-tlc="1">إلغاء</button></div></div>`
        :`<button class="btn sm ghost" data-tlp="${t.id}" data-testid="tl-pick-${t.id}">تسجيل هذا الانتقال…</button>`}</div>`; });
    trans+='</section>';
  }
  // procedural steps (hearings / statements / witnesses) — only inside an investigation or evidence status
  let steps='';
  if(sn.currentStatus){ const can=STEP_STATUS_TYPES.includes(sn.currentStatus.statusType); const F=tl.stepForm||{};
    steps=`<section class="fs" data-testid="tl-steps"><h3>جلسات الاستماع والإفادات وسماع الشهود <i>إجراءات داخل الحالة — مقيّدة الإفصاح</i></h3>
      ${can?`<div class="grid2"><label class="fld"><span>الإجراء *</span><select id="st-key">${Object.keys(STEP_LABEL).map(k=>`<option value="${k}" ${F.stepKey===k?'selected':''}>${esc(STEP_LABEL[k])}</option>`).join('')}</select></label>
        <label class="fld"><span>صفة المشارك</span><select id="st-part"><option value="">—</option>${Object.keys(PARTICIPANT_LABEL).map(k=>`<option value="${k}" ${F.participant===k?'selected':''}>${esc(PARTICIPANT_LABEL[k])}</option>`).join('')}</select></label>
        <label class="fld"><span>رمز المشارك (لا اسم ولا بريد)</span><input id="st-ref" value="${esc(F.participantRef||S.ctx.witnessRef||'')}" placeholder="W-01"></label>
        <label class="fld"><span>وقت الوقوع (occurred_at) *</span><input type="datetime-local" id="st-at" value="${esc(F.occurredAt||S.ctx.hearingAt||'')}"></label>
        ${sn.source==='DR'?`<label class="fld full"><span>سند التصريح بإجراءات التحقيق في التكليف (basisRef) ${S.ctx.recordMode==='authoritative'?'*':''}</span><input id="st-basis" value="${esc(F.basisRef||'')}" placeholder="بند التكليف الذي يصرّح بالتحقيق"></label>`:''}
        <label class="fld full"><span>ملاحظة (دون مضمون الإفادة)</span><input id="st-note" value="${esc(F.note||'')}"></label></div>
        <div id="st-val" class="valbox"></div><div class="actions"><button class="btn pri" id="st-go" data-testid="tl-step-go">تسجيل الإجراء</button><span class="muted">تظهر هذه الإجراءات لرئيس اللجنة وأمينها والمكلف بالتحقيق والأعضاء غير المتنحين فقط؛ لا تظهر لمقدم البلاغ أو الجهة المُحيلة أو صاحب الصلاحية أو الطرف المعني أو الشاهد.</span></div>
        <div class="minis" style="margin-top:8px">${stepNotifications(F.stepKey||'HEARING_SCHEDULED',F.participant||'witness').map(n=>`<button class="mini" data-sel="${n.id}"><b>${n.id}</b> ${esc(n.title)}</button>`).join('')}</div>`
      :`<div class="warnbar">لا تُسجَّل جلسات الاستماع والإفادات خارج حالة تحقيق أو جمع معلومات مصرح بها. الحالة الراهنة «${esc(sn.currentStatus.titleAr)}» من نوع ${esc(sn.currentStatus.statusTypeAr)}. ${sn.source==='WB'?'انتقل إلى «جمع المعلومات والأدلة» أو «إجراءات التحقيق الموسع».':sn.source==='IR'?'تُجرى الجلسات بعد «الإحالة للجنة عند اعتماد اختصاصها».':'تُجرى الجلسات ضمن «تنفيذ أعمال الفحص أو النظر المختص» وحيث يصرّح سند التكليف بالتحقيق.'}</div>`}</section>`; }
  // flags
  const flag=tl.flag; const flags=`<section class="fs"><h3>إجراءات على المسار (لا تحذف شيئاً)</h3><div class="actions">${['HOLD','RESUME','CANCEL','NOTE'].map(k=>`<button class="btn sm ${flag===k?'on':''}" data-flag="${k}" ${(k==='RESUME'&&!sn.hold)||((k==='HOLD'||k==='CANCEL')&&(sn.cancelled||(k==='HOLD'&&sn.hold)))||!sn.currentStatusId?'disabled':''}>${esc(EVENT_TYPE_LABEL[k])}</button>`).join('')}<button class="btn sm" id="tl-export" data-testid="tl-export">تصدير السجل JSON</button><button class="btn sm" id="tl-expand-all" data-testid="tl-expand-all">توسيع الكل</button><button class="btn sm" id="tl-collapse-all" data-testid="tl-collapse-all">طيّ الكل</button></div>
    ${flag?`<div class="evform"><div class="grid2">${flag!=='NOTE'?`<label class="fld"><span>وقت الوقوع *</span><input type="datetime-local" id="fl-at" value="${esc(nowLocalISO())}"></label>`:''}<label class="fld full"><span>${flag==='RESUME'?'ملاحظة':'السبب *'}</span><input id="fl-note"></label></div><div id="fl-val" class="valbox"></div><div class="actions"><button class="btn pri" id="fl-go">تسجيل ${esc(EVENT_TYPE_LABEL[flag])}</button><button class="btn ghost" id="fl-cancel">إلغاء</button></div></div>`:''}</section>`;
  // ledger
  const H=sn.history; const ledger=`<section class="fs"><h3>سجل الأحداث (إضافة فقط) <i>${H.length}</i></h3>${H.length?`<div class="tblwrap"><table class="tbl" data-testid="tl-ledger"><thead><tr><th>#</th><th>النوع</th><th>من ← إلى</th><th>وقع في</th><th>سُجل في</th><th>اعتُمد</th><th>السند</th><th>الوضع</th><th>ملاحظة</th><th></th></tr></thead><tbody>${H.map((e,i)=>{ const t=e.transitionId?transitionOf(sn.source,e.transitionId):null; const to=statusOf(sn.source,e.toStatusId), fr=statusOf(sn.source,e.fromStatusId);
      return `<tr class="${e.reversed?'rev':''}${e.effective?'':' noeff'}" data-ev-row="${esc(e.id)}"><td>${i+1}</td><td>${esc(e.typeLabel)}${e.implicit?' <span class="tag">ضمني</span>':''}</td><td>${e.type==='SOURCE_CORRECTION'?esc((SOURCE_LABEL[e.fromSource]||'غير محدد')+' ← '+(SOURCE_LABEL[e.toSource]||'غير محدد')):e.type==='REVERSAL'?'يعكس '+esc(e.reversesEventId):e.type==='TASK_EVENT'?esc(((TASK_JOURNEYS.kinds[e.taskKind]||{}).labelAr||e.taskKind)+' › '+((((TASK_JOURNEYS.kinds[e.taskKind]||{steps:[]}).steps.find(s=>s.key===e.stepKey))||{}).titleAr||e.stepKey))+(e.taskRef?' <span class="tag">'+esc(e.taskRef)+'</span>':''):e.type==='PROCEDURAL_STEP'?esc((STEP_LABEL[e.stepKey]||e.stepKey)+(e.participant?' — '+(PARTICIPANT_LABEL[e.participant]||'')+' '+(e.participantRef||''):''))+' <span class="tag">داخل '+esc((statusOf(sn.source,e.statusId)||{}).shortAr||'')+'</span>':(fr?esc(fr.shortAr)+' ← ':'')+(to?esc(to.shortAr):'')}</td><td>${e.occurredAt?esc(fmtDateTime(e.occurredAt)):esc(T_NO_DATE)}${e.outOfOrder?' <span class="tag warn-t">ترتيب</span>':''}</td><td>${e.recordedAt?esc(fmtDateTime(e.recordedAt)):'—'}</td><td>${e.approvedAt?esc(fmtDateTime(e.approvedAt))+(e.approvedBy?'<br>'+esc(e.approvedBy):''):'—'}</td><td>${t?esc(WF.basisLabels[t.governanceBasis]):to?esc(WF.basisLabels[to.governanceBasis]):'—'}${(e.evidence||[]).length?'<br><small>'+e.evidence.map(esc).join('، ')+'</small>':''}</td><td>${e.recordMode==='authoritative'?'رسمي':'تصميم'}</td><td>${esc(e.note||'')}${e.actor?'<br><small>'+esc(e.actor)+'</small>':''}</td><td>${(e.type==='STATUS_TRANSITION'||e.type==='INITIAL_STATUS_RECORDED'||e.type==='HOLD'||e.type==='RESUME'||e.type==='CANCEL'||e.type==='PROCEDURAL_STEP'||e.type==='TASK_EVENT')&&!e.reversed&&!e.implicit?`<button class="btn sm ghost" data-rev="${esc(e.id)}" data-testid="tl-rev-${esc(e.id)}">قيد معكوس</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`:'<div class="muted">لا أحداث مسجلة.</div>'}
    ${tl.revId?`<div class="evform"><div class="grid2"><label class="fld full"><span>سبب القيد المعكوس للحدث <code>${esc(tl.revId)}</code> *</span><input id="rv-note"></label><label class="fld"><span>وقت التسجيل</span><input type="datetime-local" id="rv-at" value="${esc(nowLocalISO())}"></label></div><div id="rv-val" class="valbox"></div><div class="actions"><button class="btn pri" id="rv-go" data-testid="tl-rev-go">تسجيل القيد المعكوس</button><button class="btn ghost" id="rv-cancel">إلغاء</button></div></div>`:''}
    ${(S.ctx.archived||[]).length?`<details class="src"><summary>سجلات مؤرشفة بعد تصحيح المصدر (${S.ctx.archived.length})</summary>${S.ctx.archived.map(a=>`<div class="d"><b>${esc(SOURCE_LABEL[a.source]||'غير محدد')}</b> · ${a.events.length} حدثاً · أُرشف ${esc(fmtDateTime(a.correctedAt))} · ${esc(a.reason)}</div>`).join('')}</details>`:''}</section>`;
  host.innerHTML=head+viewerNote+cards+panels+tj+explain+trans+steps+flags+ledger;
  wireTlHead(host);
  // stage toggles: click, Enter, Space; aria-expanded mirrors the state
  host.querySelectorAll('.tl10 .tl-stage').forEach(b=>{ const tid=b.dataset.testid||''; const map=tid.startsWith('tj-')?(tl.openTj=tl.openTj||{}):tl.open;
    const tog=()=>{ map[b.dataset.stage]=b.getAttribute('aria-expanded')!=='true'; save(); renderTimeLens(); const nb=host.querySelector(`.tl-stage[data-testid="${tid}"]`); if(nb) nb.focus(); };
    b.onclick=tog; b.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tog(); } else if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){ e.preventDefault(); const all=[...b.closest('.tl10').querySelectorAll('.tl-stage')]; const i=all.indexOf(b); const nx=e.key==='Home'?all[0]:e.key==='End'?all[all.length-1]:all[(i+((e.key==='ArrowDown'||e.key==='ArrowLeft')?1:-1)+all.length)%all.length]; if(nx) nx.focus(); } }; });
  // V11: a stepper node opens the matching stage of the detailed timeline and moves focus to it
  host.querySelectorAll('.tl10 .tl-js-node').forEach(b=>b.onclick=()=>{ const m=/^(\w+)-js-(\d+)$/.exec(b.dataset.testid||''); if(!m) return; const map=m[1]==='tj'?(tl.openTj=tl.openTj||{}):tl.open; map[b.dataset.stage]=true; save(); renderTimeLens(); const sb=host.querySelector(`.tl-stage[data-testid="${m[1]}-stage-${m[2]}"]`); if(sb){ sb.focus(); if(sb.scrollIntoView) sb.scrollIntoView({block:'nearest'}); } });
  host.querySelectorAll('[data-explain]').forEach(b=>b.onclick=()=>{ tl.explain=b.dataset.explain; renderTimeLens(); });
  host.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>select(b.dataset.sel));
  host.querySelectorAll('[data-tlp]').forEach(b=>b.onclick=()=>{ tl.pick=b.dataset.tlp; tl.form={}; renderTimeLens(); });
  host.querySelectorAll('[data-tlc]').forEach(b=>b.onclick=()=>{ tl.pick=''; tl.form=null; renderTimeLens(); });
  const readForm=()=>{ const f={}; host.querySelectorAll('.evform [data-f]').forEach(i=>f[i.dataset.f]=i.value); f.evidence=[...host.querySelectorAll('.evform [data-ev]:checked')].map(i=>i.dataset.ev); tl.form=f; return f; };
  host.querySelectorAll('.evform [data-f],.evform [data-ev]').forEach(i=>i.onchange=readForm);
  const showVal=(box,v)=>{ box.innerHTML=(v.errors||[]).map(m=>`<div class="verr">✕ ${esc(m)}</div>`).join('')+(v.warnings||[]).map(m=>`<div class="vwarn">! ${esc(m)}</div>`).join('')+((!v.errors||!v.errors.length)?`<div class="vok">✓ ${v.ok===false?'':'صالح للتسجيل في وضع '+(S.ctx.recordMode==='authoritative'?'الرسمي':'التصميم')}</div>`:''); };
  host.querySelectorAll('[data-tlv]').forEach(b=>b.onclick=()=>{ const f=readForm(); showVal(host.querySelector('#tl-val'),validateTransition(S.ctx,b.dataset.tlv,f)); });
  host.querySelectorAll('[data-tla]').forEach(b=>b.onclick=()=>{ const f=readForm(); const r=applyApprovedTransition(S.ctx,b.dataset.tla,f); if(!r.ok){ showVal(host.querySelector('#tl-val'),r); return; } S.ctx=r.ctx; tl.pick=''; tl.form=null; tl.explain=''; tl.open[statusOf(S.ctx.srcType,r.event.toStatusId).stageId]=true; onCtx(); toast('سُجل الانتقال '+r.event.transitionId+(r.warnings.length?' مع تحذيرات ('+r.warnings.length+')':'')); });
  const initHost=host.querySelector('#tl-init-host'); if(initHost){ initHost.appendChild(statusSelectPlain('tl-init-status')); host.querySelector('#tl-init-go').onclick=()=>{ const st=host.querySelector('#tl-init-status').value; const r=recordInitialStatus(S.ctx,st,{occurredAt:host.querySelector('#tl-init-at').value,recordedAt:nowLocalISO(),note:host.querySelector('#tl-init-note').value}); if(!r.ok){ toast(r.errors.join(' · ')); return; } S.ctx=r.ctx; onCtx(); toast(r.warnings[0]||'سُجلت الحالة الابتدائية'); }; }
  const stGo=host.querySelector('#st-go'); if(stGo){ const readStep=()=>{ const g=id=>{ const x=host.querySelector('#'+id); return x?x.value:''; }; tl.stepForm={stepKey:g('st-key'),participant:g('st-part'),participantRef:g('st-ref'),occurredAt:g('st-at'),basisRef:g('st-basis'),note:g('st-note')}; return tl.stepForm; };
    ['st-key','st-part'].forEach(id=>{ const x=host.querySelector('#'+id); if(x) x.onchange=()=>{ readStep(); renderTimeLens(); }; });
    stGo.onclick=()=>{ const f=readStep(); const r=recordProceduralStep(S.ctx,Object.assign({recordedAt:nowLocalISO()},f)); if(!r.ok){ showVal(host.querySelector('#st-val'),r); return; } S.ctx=r.ctx; tl.stepForm=null; tl.open[snap().currentStage.id]=true; onCtx(); toast('سُجل '+STEP_LABEL[r.event.stepKey]+(r.warnings.length?' مع تحذير':'')); }; }
  host.querySelectorAll('[data-flag]').forEach(b=>b.onclick=()=>{ tl.flag=tl.flag===b.dataset.flag?'':b.dataset.flag; renderTimeLens(); });
  const flGo=host.querySelector('#fl-go'); if(flGo){ flGo.onclick=()=>{ const at=host.querySelector('#fl-at'); const r=recordFlag(S.ctx,tl.flag,{occurredAt:at?at.value:nowLocalISO(),recordedAt:nowLocalISO(),note:host.querySelector('#fl-note').value}); if(!r.ok){ showVal(host.querySelector('#fl-val'),r); return; } S.ctx=r.ctx; tl.flag=''; onCtx(); toast('سُجل '+EVENT_TYPE_LABEL[r.event.type]); }; host.querySelector('#fl-cancel').onclick=()=>{ tl.flag=''; renderTimeLens(); }; }
  host.querySelectorAll('[data-rev]').forEach(b=>b.onclick=()=>{ tl.revId=b.dataset.rev; renderTimeLens(); });
  const rvGo=host.querySelector('#rv-go'); if(rvGo){ rvGo.onclick=()=>{ const r=reverseEvent(S.ctx,tl.revId,{note:host.querySelector('#rv-note').value,recordedAt:host.querySelector('#rv-at').value}); if(!r.ok){ showVal(host.querySelector('#rv-val'),r); return; } S.ctx=r.ctx; tl.revId=''; onCtx(); toast('سُجل قيد معكوس؛ الحالة الراهنة أُعيد اشتقاقها'+(r.warnings&&r.warnings.length?' (تحذير: '+r.warnings[0]+')':'')); }; host.querySelector('#rv-cancel').onclick=()=>{ tl.revId=''; renderTimeLens(); }; }
  const exb=host.querySelector('#tl-export'); if(exb) exb.onclick=()=>download(`case_events_${(S.ctx.ref||'draft').replace(/[^\w-]+/g,'_')}.json`,JSON.stringify({ref:S.ctx.ref,source:S.ctx.srcType,recordMode:S.ctx.recordMode,procedureRef:S.ctx.procedureRef,events:S.ctx.events,archived:S.ctx.archived},null,1),'application/json');
  const ea=host.querySelector('#tl-expand-all'); if(ea) ea.onclick=()=>{ sn.stages.forEach(s=>tl.open[s.id]=true); save(); renderTimeLens(); };
  const ca=host.querySelector('#tl-collapse-all'); if(ca) ca.onclick=()=>{ sn.stages.forEach(s=>tl.open[s.id]=false); save(); renderTimeLens(); };
  // V10 task-event form
  const tjKind=host.querySelector('#tj-kind'); if(tjKind){ const readTj=()=>{ const g=id=>{ const x=host.querySelector('#'+id); return x?x.value:''; }; tl.taskForm={taskKind:g('tj-kind'),stepKey:g('tj-step'),taskRef:g('tj-ref'),occurredAt:g('tj-at'),recordedAt:g('tj-rec'),actor:g('tj-actor'),note:g('tj-note')}; return tl.taskForm; };
    tjKind.onchange=()=>{ readTj(); tl.taskForm.stepKey=''; tl.taskForm.taskRef=undefined; renderTimeLens(); }; ['tj-step','tj-ref','tj-at','tj-rec','tj-actor','tj-note'].forEach(id=>{ const x=host.querySelector('#'+id); if(x) x.onchange=readTj; });
    host.querySelector('#tj-go').onclick=()=>{ const f=readTj(); const r=recordTaskEvent(S.ctx,Object.assign({},f,{recordedAt:f.recordedAt||nowLocalISO()})); if(!r.ok){ showVal(host.querySelector('#tj-val'),r); return; } S.ctx=r.ctx; tl.taskForm=null; onCtx(); toast('سُجل حدث المهمة: '+(((TASK_JOURNEYS.kinds[r.event.taskKind]||{steps:[]}).steps.find(s=>s.key===r.event.stepKey)||{}).titleAr||r.event.stepKey)+(r.warnings.length?' (تحذير: '+r.warnings[0]+')':'')); }; }
}
function statusSelectPlain(id){ const s=el('select',{id}); const T=getWorkflowDefinition(S.ctx.srcType); if(!T) return s; T.mainStages.forEach(M=>{ const og=el('optgroup',{label:`${M.sequence} · ${M.titleAr}`}); T.statuses.filter(x=>x.stageId===M.id).forEach(x=>og.appendChild(el('option',{value:x.id},`${x.id} · ${x.titleAr}`))); s.appendChild(og); }); return s; }
function wireTlHead(host){
  const sh=host.querySelector('#tl-src-host'); if(sh){ sh.innerHTML=''; sh.appendChild(sourceSelect('tl-src')); }
  wireSourceWarn(host);
  const m=host.querySelector('#tl-mode'); if(m) m.onchange=()=>{ S.ctx.recordMode=m.value; onCtx(); };
  const p=host.querySelector('#tl-proc'); if(p){ p.oninput=()=>{ S.ctx.procedureRef=p.value; save(); }; p.onchange=()=>onCtx(); }
  const v=host.querySelector('#tl-viewer'); if(v) v.onchange=()=>{ S.tl.viewer=v.value; save(); renderTimeLens(); };
  const r=host.querySelector('#tl-recused'); if(r) r.onchange=()=>{ S.tl.recused=r.checked; renderTimeLens(); };
}

/* ===== compose ===== */
let previewMode='desktop';
/* V9.1: sending settings merged into the per-notification options; the approximate in-tool renderer for the Adaptive Card subset we emit */
function sendOpts(o){ return Object.assign({},o,{originator:(S.send.originator||'').trim(),endpoint:(S.send.endpoint||'').trim(),feedbackTo:(S.send.feedbackTo||'').trim(),portalFeedbackUrl:(S.send.portalFeedbackUrl||'').trim(),actionable:S.send.actionable!==false&&o.actionable!==false}); }
function renderAmPreview(card){
  const un=t=>String(t==null?'':t).replace(/\\([\\*_#`\[\]~])/g,'$1');
  const tb=x=>`<div class="am-tb${x.size==='Small'?' sm':x.size==='Large'?' lg':x.size==='ExtraLarge'?' xl':x.size==='Medium'?' md':''}${x.weight==='Bolder'?' b':''}${x.isSubtle?' sub':''}${x.color==='Accent'?' acc':x.color==='Attention'?' att':x.color==='Warning'?' warn':''}${x.separator?' sep':''}">${esc(un(x.text))}</div>`;
  const acts=a=>`<div class="am-acts">${(a||[]).map(x=>x.type==='Action.OpenUrl'?`<a class="am-btn pri" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`:x.type==='Action.ToggleVisibility'?`<button type="button" class="am-btn" data-am-targets="${esc(JSON.stringify((x.targetElements||[]).map(t=>typeof t==='string'?{id:t,v:null}:{id:t.elementId,v:!!t.isVisible})))}">${esc(x.title)}</button>`:x.type==='Action.Http'?`<button type="button" class="am-btn http" data-am-http="${esc(x.url)}" title="يُرسل إلى نقطة الاستقبال بعد تحقق Microsoft من الهوية؛ لا يعمل في هذه المعاينة">${esc(x.title)} ⇡</button>`:'').join('')}</div>`;
  const el=x=>{ switch(x.type){
    case 'TextBlock': return tb(x);
    case 'FactSet': return `<div class="am-fs">${(x.facts||[]).map(f=>`<b>${esc(un(f.title))}</b><span>${esc(un(f.value))}</span>`).join('')}</div>`;
    case 'Container': return `<div class="am-ct${x.style==='emphasis'?' emph':''}${x.separator?' sep':''}"${x.id?` data-am-id="${esc(x.id)}"`:''}${x.isVisible===false?' hidden':''}>${(x.items||[]).map(el).join('')}</div>`;
    case 'ColumnSet': return `<div class="am-cs${x.separator?' sep':''}">${(x.columns||[]).map(c=>`<div class="am-col${c.width==='auto'?' auto':''}">${(c.items||[]).map(el).join('')}</div>`).join('')}</div>`;
    case 'ActionSet': return acts(x.actions);
    case 'Input.ChoiceSet': return x.style==='compact'?`<select class="am-in" data-am-input="${esc(x.id)}"><option value="">${esc(x.placeholder||'اختر')}</option>${(x.choices||[]).map(ch=>`<option value="${esc(ch.value)}">${esc(ch.title)}</option>`).join('')}</select>`:`<div class="am-radios" data-am-input="${esc(x.id)}">${(x.choices||[]).map(ch=>`<label><input type="radio" name="${esc(x.id)}" value="${esc(ch.value)}"> ${esc(ch.title)}</label>`).join('')}</div>`;
    case 'Input.Toggle': return `<label class="am-toggle"><input type="checkbox" data-am-input="${esc(x.id)}"> ${esc(x.title||'')}</label>`;
    case 'Input.Date': return `<input type="date" class="am-in" data-am-input="${esc(x.id)}">`;
    case 'Input.Text': return x.isMultiline?`<textarea class="am-in" rows="2" data-am-input="${esc(x.id)}" placeholder="${esc(x.placeholder||'')}" maxlength="${+x.maxLength||500}"></textarea>`:`<input class="am-in" data-am-input="${esc(x.id)}" placeholder="${esc(x.placeholder||'')}">`;
    case 'Image': return `<img class="am-img" src="${esc(x.url)}" alt="${esc(x.altText||'')}">`;
    default: return `<div class="am-tb sm sub">[${esc(x.type)}]</div>`; } };
  if(!card) return ''; return `${(card.body||[]).map(el).join('')}${card.actions?acts(card.actions):''}`;
}
function wireAmPreview(host){ host.querySelectorAll('.amcard [data-am-http]').forEach(b=>b.onclick=()=>toast('زر إرسال حقيقي: يعمل في Outlook فقط بعد تسجيل نقطة الاستقبال وتفعيلها (لا يعمل في المعاينة)')); host.querySelectorAll('.amcard [data-am-targets]').forEach(b=>b.onclick=()=>{ JSON.parse(b.dataset.amTargets).forEach(t=>{ const e=host.querySelector(`.amcard [data-am-id="${t.id.replace(/"/g,'')}"]`); if(!e) return; if(t.v===null) e.hidden=!e.hidden; else e.hidden=!t.v; }); }); }
function renderCompose(){
  const host=$('#compose'); const n=S.sel?byId(S.sel):null;
  if(!n){ host.innerHTML='<div class="empty big">اختر إشعاراً من «اختيار الإشعار» أو من TimeLens.</div>'; return; }
  const o=per(n.id); const R=ROLES[n.role]||ROLES.secretary;
  const toEmail=o.toEmail!==undefined?o.toEmail:(R.email(S.ctx)||''); const toName=o.toName!==undefined?o.toName:(R.name(S.ctx)||'');
  const out=compose(n,S.ctx,sendOpts(o)); const am=out.adaptiveCard; const gateAll=gateItems(n,S.ctx,o); const gateErr=gateAll.filter(g=>g.level==='error'), gate=gateAll.filter(g=>g.level!=='error'); const dup=S.log.find(l=>l.key===out.idem);
  const chk=(k,label,on)=>`<label class="sw"><input type="checkbox" data-opt="${k}" ${on?'checked':''}><span>${label}</span></label>`;
  const SI=out.stage; const P=out.projection; const rel=out.release; const useTrack=out.useTrack; const TLo=out.timeline; const RG=out.registryRow;
  host.innerHTML=`
  <div class="nhead" style="--c:${DATA.cats[n.cat].color}"><div><span class="id">${n.id}</span> <span class="mat ${n.maturity}">${n.maturity}</span> <span class="tag">${esc(n.disclosure)}</span> <span class="tag">${esc(n.journey)}</span> <span class="rel rel-${rel.status}" data-testid="release-status" title="${esc(rel.reasons.join(' · '))}">${esc(rel.label)} <small dir="ltr">${rel.status}</small></span></div><h2>${esc(n.title)}</h2><div class="sub">${esc(n.eventTitle)} · الحدث <code>${esc(n.event)}</code> · المستلم: <b>${esc(n.recipient)}</b> · ${esc(n.actionClass)} · <span title="سند المحتوى">${esc(n.contentBasis)}</span></div>
   ${gateErr.map(g=>`<div class="warnbar" data-testid="eligibility-error">${esc(g.t)}</div>`).join('')}
   ${n.addedIn?`<div class="warnbar" data-testid="v9-extension">إشعار مضاف في ${esc(n.addedIn)} خارج مصنف V8 (${esc(n.extensionNote||'')}) — لا يُرسل قبل اعتماد النص والدور. الرقم المرجعي للحالة محجوب افتراضياً عن هذا المستلم.</div>`:''}
   ${n.maturity==='PROPOSED'?'<div class="warnbar">صياغة مقترحة (PROPOSED): لا تُرسل قبل اعتماد النص وسياسة الإرسال (QA-24). يمكن إعداد المسودة ومعاينتها الآن.</div>':''}
   ${n.role==='reporter'?'<div class="warnbar info">إشعارات المبلغين تُسلَّم عبر القناة الآمنة للمنصة، لا بالبريد؛ المولّد لا يطلب بريد المبلغ ولا هويته. انسخ النص أو الـHTML لنشره في القناة.</div>':''}
   ${P?`<div class="warnbar info" data-testid="projection-summary"><b>إسقاط المسار على المستلم (${esc(P.roleLabel)}):</b> المستويات ${P.levels.map(l=>esc(WF.levelLabels[l])).join('، ')} · أحداث ظاهرة ${P.shownCount} · محجوبة ${P.hiddenCount}${P.truncatedCount?' · مختصرة '+P.truncatedCount:''} · الحالة المرئية: <b>${esc(P.visibleStatus||'—')}</b> · المسار ${esc(P.trackName)} ${esc(P.trackVersion)}${P.governanceStatus!=='APPROVED_SOURCE_MAPPING'?' (مقترح — يلزم اعتماد الحوكمة)':''}${useTrack?'':' — مسار هذا الإشعار من ملف «'+esc(TLo.profileLabel)+'»؛ فعّل «إلحاق مسار الحالة الداخلي» لإلحاق مسار الحالة.'}</div>`:''}
  </div>
  <div class="cgrid">
   <div class="cform">
    <section class="fs"><h3>المستلم والحدث</h3><div class="grid2">
      <label class="fld"><span>اسم المستلم</span><input data-o="toName" value="${esc(toName)}" ${n.role==='reporter'?'disabled placeholder="لا يُذكر اسم المبلغ"':''}></label>
      <label class="fld"><span>بريد المستلم</span><input data-o="toEmail" type="email" value="${esc(toEmail)}" ${n.role==='reporter'?'disabled placeholder="لا بريد للمبلغ"':''}></label>
      <label class="fld"><span>نسخة (اختياري)</span><input data-o="cc" type="text" value="${esc(o.cc||'')}" placeholder="بريد @…"></label>
      <label class="fld"><span>وقت الحدث المعروض (notification_event_at، الرياض)</span><input data-o="eventAt" type="datetime-local" value="${esc(o.eventAt||S.ctx.snapshotAt||'')}"></label>
      <label class="fld"><span>الحالة المرئية للمستلم (visible_status)</span><input data-o="visibleStatus" value="${esc(o.visibleStatus||'')}" placeholder="${esc(out.vstatus||'تُشتق من المسار')}"></label>
      <label class="fld"><span>التحية (اختياري)</span><input data-o="greeting" value="${esc(o.greeting||'')}" placeholder="${esc(R.greet(S.ctx))}"></label>
      <label class="fld full"><span>الإجراء المطلوب من المستلم (recipient_safe_next_action)</span><textarea data-o="nextAction" rows="2" placeholder="${esc(n.action)}">${esc(o.nextAction||'')}</textarea></label>
      <label class="fld full"><span>الإشعار — نص حر يظهر قبل مسار TimeLens (اختياري)</span><textarea data-o="freeText" rows="4" placeholder="اكتب هنا أي نص إضافي تريد إظهاره للمستلم قبل مسار TimeLens…">${esc(o.freeText||'')}</textarea></label>
      <label class="fld"><span>عنوان النص الحر</span><input data-o="freeTitle" value="${esc(o.freeTitle||'')}" placeholder="الإشعار"></label>
      <label class="fld full"><span>إفادة أمانة اللجنة (اختياري — لا تعدّل الحدث ولا تتضمن نتائج)</span><textarea data-o="secNote" rows="2">${esc(o.secNote||'')}</textarea></label>
      <label class="fld"><span>نص زر الإجراء (فقط مع رابط حقيقي)</span><input data-o="ctaLabel" value="${esc(o.ctaLabel||'')}" placeholder="فتح الحالة في النظام"></label>
      <label class="fld"><span>رابط الإجراء (اختياري)</span><input data-o="ctaUrl" type="url" value="${esc(o.ctaUrl||S.ctx.link||'')}" placeholder="https://…"></label>
    </div></section>
    ${(n.id==='COM-01'||n.id==='COM-02')?`<section class="fs"><h3>إضافات أمانة اللجنة (اختيارية)</h3><div class="sws">${chk('x.prior','يوجد إجراء سابق في سجل اللجنة — اقتراح استكمال الإجراء القائم',o.extras&&o.extras.prior)}${chk('x.sep','الفصل بين الطلب الوظيفي ومسار النظر لدى اللجنة',o.extras&&o.extras.sep)}${chk('x.coi','تنبيه تعارض المصالح في سلسلة الإحالة',o.extras&&o.extras.coi)}${chk('x.deadline','طلب تحديد التاريخ المعتمد للتكليف (المادة 10 البند 19)',o.extras&&o.extras.deadline)}</div></section>`:''}
    <section class="fs" data-testid="tl-settings"><h3>TimeLens V10 — مسار الإشعار في الرسالة <span class="tag" data-testid="tl-profile">${esc(TLo.profileLabel)}</span> <span class="tag" dir="ltr">${esc(TLo.profile)}</span></h3>
      <div class="d muted" style="margin-bottom:8px">${esc(TLo.profileDesc||'')}${RG?` · التفصيل: ${esc(RG.Timeline_Detail_Level)} · الإفصاح: <span dir="ltr">${esc(RG.Disclosure_Policy)}</span> · التعريف: ${esc(RG.Workflow_Definition_Version||'—')} · حالة أصل مطلوبة: ${esc(RG.Parent_Case_Required)} · مهمة أصل: ${esc(RG.Parent_Task_Required)}`:''}</div>
      ${TLo.ok?'':`<div class="warnbar" data-testid="tl-fail-closed">${esc(TLo.caption)}</div>`}
      ${TLo.ledgerGap?`<div class="warnbar" data-testid="tl-ledger-gap">${esc(TLo.warnings.join(' · '))}</div>`:''}
      <div class="sws">
      ${chk('timeline','تضمين مسار TimeLens في الرسالة (لقطة ثابتة مرساة يميناً؛ جداول آمنة لـ Outlook، بلا أزرار ولا سكربت)',o.timeline!==false)}
      ${chk('tree','الأحداث الثانوية المتداخلة تحت كل مرحلة (الحالات والإجراءات المقيدة وتواريخها)',o.tree!==false)}
      ${(!CASE_JOURNEYS[n.cat]&&P&&!P.external&&!TL_EXTERNAL_ROLES[n.role])?chk('caseTree','إلحاق مسار الحالة الداخلي (إسقاط على هذا المستلم) بعد مسار الإشعار',!!o.caseTree):''}
      ${n.role==='member'?chk('recused','العضو متنحٍ / تعارض مصالح: تقليص الإسقاط إلى المراحل العامة',!!o.recused):''}
      </div>
      <div class="actions" style="margin-top:8px"><button class="btn sm" data-go="timelens">المسار التفاعلي وتسجيل أحداث المهمة في TimeLens</button></div>
    </section>
    <section class="fs amset" data-testid="am-settings"><h3>بطاقة Outlook التفاعلية (Actionable Message — V9.1)</h3>
      <div class="sws">${am.applicable?chk('actionable','تضمين بطاقة Adaptive Card في هذا الإشعار (أزرار توسيع لكل مرحلة وروابط؛ النسخة الثابتة تبقى لبقية العملاء)',o.actionable!==false):`<div class="muted">${am.reason==='portal-only'?'إشعارات المبلغين تُنشر في القناة الآمنة للمنصة ولا تُرسل بالبريد؛ لا بطاقة Outlook لها.':'لا مستلم بريد لهذا الإشعار؛ لا بطاقة Outlook.'}</div>`}</div>
      <div class="grid2" style="margin-top:8px">
        <label class="fld full"><span>معرّف المزوّد (originator) من Actionable Email Developer Dashboard — إعداد عام لكل الإشعارات</span><input data-send="originator" data-testid="am-originator" dir="ltr" value="${esc(S.send.originator||'')}" placeholder="فارغ = اختبار ذاتي فقط (إرسال البطاقة لنفسك من Designer)"></label>
        <label class="fld full"><span>نقطة استقبال الردود (Target URL، https) — عند تعبئتها تتحول أزرار الرد إلى نماذج داخل البريد (حقول + Action.Http)</span><input data-send="endpoint" data-testid="am-endpoint" dir="ltr" value="${esc(S.send.endpoint||'')}" placeholder="فارغ = أزرار روابط تفتح صفحة تأكيد في النظام"></label>
        <label class="fld full"><span>عنوان استقبال التقييم والملاحظات (إعداد عام قابل للتهيئة؛ تصل إليه رسائل النجوم ومربع الملاحظات في ذيل البريد وفي البطاقة — عنوان تجريبي افتراضياً)</span><input data-send="feedbackTo" data-testid="am-feedback" dir="ltr" value="${esc(S.send.feedbackTo||'')}" placeholder="feedback@example.test"></label>
        <label class="fld full"><span>رابط صفحة التقييم في بوابة الإبلاغ الآمنة — لإشعارات المبلّغين فقط (بلا بريد ولا هوية؛ رابط تجريبي افتراضياً)</span><input data-send="portalFeedbackUrl" data-testid="am-portal-feedback" dir="ltr" type="url" value="${esc(S.send.portalFeedbackUrl||'')}" placeholder="https://…/feedback"></label>
        <label class="sw"><input type="checkbox" data-send="actionable" data-testid="am-enabled" ${S.send.actionable!==false?'checked':''}><span>تفعيل البطاقات في كل الإشعارات (إعداد عام)</span></label>
      </div>
      <div class="sws">${am.applicable?chk('responses','أزرار الاستجابة: في بطاقة Outlook، وفي متن الرسالة الثابتة كردود بريد معدَّة مسبقاً إلى الأمانة تعمل في كل العملاء دون تسجيل (تصميم مقترح PROPOSED؛ يحتاج اعتماد النص والعملية)',o.responses!==false):''}</div>
      <div class="fhint">بدون معرّف المزوّد تُعرض البطاقة لمرسلها فقط ويحذفها Outlook عند الإرسال لغيره؛ سجّل عنوان المرسِل بنطاق «Test Users» ثم ضع المعرّف هنا.</div>
    </section>
    <section class="fs"><h3>الشكل</h3><div class="sws">
      ${chk('showRef','إظهار الرقم المرجعي في العنوان والرأس وبطاقة الحالة',o.showRef!==false)}
      ${chk('headerDark','رأس داكن #161616 بشعار أبيض (الافتراضي في المرجع V8)',o.headerDark!==false)}
      ${chk('hero','صورة النخيل خلف عنوان الإشعار (عند إيقافها يبقى العنوان على خلفية داكنة)',o.hero!==false)}
      ${chk('rating','بطاقة التقييم (خمس نجوم + مربع ملاحظات) على لوحة الصور الثلاث (القراءة، النخيل، العمارة التراثية) في ذيل الرسالة — في كل الإشعارات والقوالب: بريد معدّ مسبقاً للموظفين والشهود، وصفحة البوابة الآمنة للمبلّغين — وفي بطاقة Outlook',o.rating!==false)}
      <label class="sw"><span>التصميم</span><select data-o="design"><option value="v8" ${o.design!=='letter'?'selected':''}>بطاقات (بريد النظام)</option><option value="letter" ${o.design==='letter'?'selected':''}>رسالة رسمية (نص على ترويسة)</option></select></label>
    </div></section>
    <section class="fs gate"><h3>التحقق قبل الإصدار <i>${gate.filter(g=>o.gate&&o.gate[g.k]).length}/${gate.length}</i> <span class="rel rel-${rel.status}">${esc(rel.label)}</span></h3>
      ${dup?`<div class="warnbar">صدر إشعار بنفس مفتاح منع التكرار في ${esc(fmtDateTime(dup.time))} (${esc(dup.status)}). راجع السجل قبل الإصدار مرة أخرى.</div>`:''}
      <div class="gates">${gate.map(g=>`<label class="g"><input type="checkbox" data-gate="${g.k}" ${o.gate&&o.gate[g.k]?'checked':''}><span>${esc(g.t)}</span></label>`).join('')}</div>
      <div class="idem">مفتاح منع التكرار: <code dir="ltr">${esc(out.idem)}</code> · حالة الإصدار: ${esc(rel.reasons.join(' · '))}</div>
    </section>
   </div>
   <div class="cprev">
    <div class="hdrs"><div><b>الموضوع:</b> ${esc(out.subject)}</div><div><b>من:</b> <span dir="ltr">${esc(decHeader(out.from)||'—')}</span> · <b>إلى:</b> <span dir="ltr">${esc(decHeader(out.to)||(n.role==='reporter'?'القناة الآمنة (لا بريد)':'—'))}</span>${out.cc?' · <b>نسخة:</b> <span dir="ltr">'+esc(decHeader(out.cc))+'</span>':''}</div></div>
    <div class="actions">
      <button class="btn pri" data-act="eml">تنزيل .eml (مسودة Outlook)</button>
      <button class="btn" data-act="mailto" ${n.role==='reporter'?'disabled':''}>فتح في برنامج البريد (نص)</button>
      <button class="btn" data-act="copyText">نسخ النص</button><button class="btn" data-act="copyHtml">نسخ HTML</button><button class="btn" data-act="copySubj">نسخ الموضوع</button><button class="btn" data-act="graph" data-testid="graph-copy" title="POST https://graph.microsoft.com/v1.0/me/sendMail — صلاحية Mail.Send المفوّضة من صندوق المرسِل">نسخ طلب Graph (sendMail)</button><button class="btn" data-act="graphDl" data-testid="graph-download">تنزيل طلب Graph</button>
      <button class="btn" data-act="copyCard">نسخ بطاقة CRM</button><button class="btn" data-act="log">تسجيل في سجل الإصدار</button>
      <span class="spacer"></span><button class="btn sm ${previewMode==='desktop'?'on':''}" data-pv="desktop">سطح المكتب</button><button class="btn sm ${previewMode==='mobile'?'on':''}" data-pv="mobile">جوال</button>
    </div>
    <div class="pvwrap ${previewMode==='mobile'?'m':''}"><iframe id="pv" title="معاينة"></iframe></div>
    <div class="inapp"><div class="cap">بطاقة CRM داخل النظام (معاينة)</div><div class="card sem-${out.sem}"><div class="ic">${out.sem==='success'?'✓':out.sem==='review'?'◷':out.sem==='alert'?'!':'→'}</div><div><div class="t">${esc(out.card.title)}</div><div class="b">${esc(out.card.body)}</div><div class="tm">${esc(out.eventAt?fmtRiyadh(out.eventAt):'—')}</div></div></div></div>
    <div class="amprev" data-testid="am-panel"><div class="cap">بطاقة Outlook التفاعلية (Adaptive Card) — معاينة تقريبية داخل الأداة؛ العرض الفعلي في Outlook</div>
     ${am.applicable?`<div class="amstats" data-testid="am-stats">${am.enabled?'مضمّنة في رأس HTML (.eml والمعاينة)':'غير مضمّنة — معطّلة'} · ${am.stats.bytes} بايت · ${am.stats.toggles} زر توسيع · ${am.stats.openUrls} رابط · ${am.stats.inputs} حقل إدخال · ${am.mode==='http'?'نمط النماذج (Action.Http إلى نقطة الاستقبال)':'نمط الروابط (صفحات تأكيد في النظام)'} · ${am.card.originator?'originator مضبوط':'بدون originator — صالحة للاختبار الذاتي فقط'} · ${am.validation.ok?'✓ البنية صالحة':'✗ '+esc(am.validation.errors.join('؛ '))}</div>
     <div class="amcard" dir="rtl" data-testid="am-card">${renderAmPreview(am.card)}</div>
     <div class="actions"><button class="btn sm" data-act="copyAm" data-testid="am-copy">نسخ JSON البطاقة</button><button class="btn sm" data-act="dlAm" data-testid="am-download">تنزيل JSON</button></div>
     <details class="src"><summary>كيف تُختبر البطاقة في Outlook (اختبار ذاتي ثم التسجيل)</summary><ol class="amsteps">
       <li>اختبار ذاتي بلا تسجيل: افتح <a href="https://amdesigner.azurewebsites.net/" target="_blank" rel="noopener">Actionable Message Designer</a> وسجّل الدخول بحساب الجهة، الصق JSON البطاقة في المحرر ثم «Send»؛ تصل إلى بريدك أنت فقط.</li>
       <li>الإرسال لزملاء بلا مدير نظام: في <a href="https://outlook.cloud.microsoft/actionablemessage/oam/" target="_blank" rel="noopener">Actionable Message Provider Portal</a> اختر «New Provider»، أجب «Yes» على «Is this a Power Automate Scenario?» (فلا يلزم تسجيل تطبيق Entra)، النطاق «Test Users» (يُعتمد فوراً وتلقائياً للمستلمين المدرجين)، ثم أدخل عنوان المرسِل، وعناوين المستلمين التجريبيين، ونطاق النظام (Target Domain)، وضع «Provider ID (Originator)» في الحقل أعلاه.</li>
       <li>الإرسال من صندوق المرسِل نفسه مع بقاء البطاقة: «نسخ طلب Graph (sendMail)» ثم لصقه في <a href="https://developer.microsoft.com/graph/graph-explorer" target="_blank" rel="noopener">Graph Explorer</a> (POST /me/sendMail بصلاحية Mail.Send المفوّضة) أو في تدفق Power Automate؛ أما فتح ملف .eml في Outlook الكلاسيكي ثم «إرسال» فقد يُسقط رأس البطاقة، فتبقى النسخة الثابتة وحدها.</li>
       <li>بلا أي تسجيل: ردود البريد المعدَّة مسبقاً (mailto) في متن الرسالة وفي بطاقة التقييم تعمل في كل العملاء.</li>
       <li>نطاق المؤسسة (كل الموظفين) يعتمده مدير Exchange أو المدير العام للمستأجر؛ نطاق Global تعتمده Microsoft.</li>
       <li>شروط Microsoft: المستلم فرد ظاهر في «إلى/نسخة» (لا مجموعات ولا نسخة مخفية)، SPF وDKIM للنطاق، Outlook لسطح المكتب بإعداد «Download full items»؛ تتوقف الأزرار بعد شهر من الرسالة بينما يبقى النص الثابت، وتُحذف البطاقة عند إعادة التوجيه.</li>
     </ol></details>`:`<div class="muted">${am.reason==='portal-only'?'لا بطاقة: إشعار يُنشر في القناة الآمنة للمنصة.':'لا بطاقة: لا مستلم بريد.'}</div>`}
    </div>
    <details class="src"><summary>مرجع هذا الإشعار من المصنف</summary><table class="kv">${[['العنوان القانوني',n.title],['الاسم في V5',n.v5],['الحدث المحفز',n.event],['حالة القضية/الكيان (V8)',n.state],['المستلم',n.recipient],['نضج السند',n.maturity+' — '+n.maturityDesc],['المستند/المادة',n.basis],['مستوى الإفصاح',n.disclosure],['رحلة المستلم',n.journey],['قيود خاصة',n.constraint],['Guard الإرسال',n.guard],['سياسة الإصدار',n.policy],['مفتاح منع التكرار',n.idem],['منع الالتباس',n.limit],['ضابط نص الأمانة',n.secRule],['حقول ديناميكية',n.dyn.join('، ')],['حالة اعتماد النص',n.approval]].map(r=>`<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}</table></details>
   </div>
  </div>`;
  $('#pv').srcdoc=out.html;
  host.querySelectorAll('[data-o]').forEach(i=>{ const h=()=>{ o[i.dataset.o]=i.value; save(); softCompose(); }; i.oninput=h; i.onchange=()=>{o[i.dataset.o]=i.value; save(); renderCompose();}; });
  host.querySelectorAll('[data-opt]').forEach(c=>c.onchange=()=>{ const k=c.dataset.opt; if(k.startsWith('x.')){ o.extras=o.extras||{}; o.extras[k.slice(2)]=c.checked; } else o[k]=c.checked; save(); renderCompose(); });
  host.querySelectorAll('[data-ms]').forEach(i=>i.onchange=()=>{ o.milestones=o.milestones||[]; o.milestones[+i.dataset.ms]=i.value; save(); renderCompose(); });
  host.querySelectorAll('[data-gate]').forEach(c=>c.onchange=()=>{ o.gate=o.gate||{}; o.gate[c.dataset.gate]=c.checked; save(); renderCompose(); });
  host.querySelectorAll('[data-pv]').forEach(b=>b.onclick=()=>{ previewMode=b.dataset.pv; renderCompose(); });
  host.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act,n,o));
  host.querySelectorAll('[data-send]').forEach(i=>{ const h=()=>{ S.send[i.dataset.send]=i.type==='checkbox'?i.checked:i.value; save(); renderCompose(); }; if(i.type==='checkbox') i.onchange=h; else i.onchange=h; });
  wireAmPreview(host);
}
let softTimer=null;
function softCompose(){ clearTimeout(softTimer); softTimer=setTimeout(()=>{ const n=byId(S.sel); if(!n) return; const out=compose(n,S.ctx,sendOpts(per(n.id))); const pv=$('#pv'); if(pv) pv.srcdoc=out.html; const h=$('.hdrs'); if(h) h.firstElementChild.innerHTML=`<b>الموضوع:</b> ${esc(out.subject)}`; },300); }
function download(name, content, mime){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500); }
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast('تم النسخ'); }catch(e){ toast('تعذر النسخ تلقائياً؛ انسخ من المعاينة'); } }
async function copyHtml(html,text){ try{ if(window.ClipboardItem){ await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]); } else await navigator.clipboard.writeText(html); toast('تم نسخ النسخة المنسقة'); }catch(e){ toast('تعذر النسخ؛ استخدم تنزيل .eml'); } }
function act(kind,n,o){
  const out=compose(n,S.ctx,sendOpts(o)); const fname=`${n.id}_${(S.ctx.ref||'case').replace(/[^\w-]+/g,'_')}`;
  if(kind==='eml'){ download(fname+'.eml', buildEml(out), 'message/rfc822'); addLog(n,out,'exported'); }
  else if(kind==='mailto'){ const body=out.text.length>1800?out.text.slice(0,1800)+'\n…':out.text; location.href=`mailto:${encodeURIComponent(out.to.replace(/^.*<|>$/g,''))}?subject=${encodeURIComponent(out.subject)}&body=${encodeURIComponent(body)}`; addLog(n,out,'mailto'); }
  else if(kind==='copyText') copyText(out.text);
  else if(kind==='copyHtml') copyHtml(out.html,out.text);
  else if(kind==='copySubj') copyText(out.subject);
  else if(kind==='copyCard') copyText(`${out.card.title}\n${out.card.body}\n${out.eventAt?fmtDateTime(out.eventAt):''}`);
  else if(kind==='copyAm') copyText(out.adaptiveCard&&out.adaptiveCard.json||'');
  else if(kind==='graph'){ copyText(JSON.stringify(graphSendMailPayload(out),null,2)); addLog(n,out,'exported'); }
  else if(kind==='graphDl'){ download(fname+'_graph_sendMail.json', JSON.stringify(graphSendMailPayload(out),null,2), 'application/json'); addLog(n,out,'exported'); }
  else if(kind==='dlAm'){ if(out.adaptiveCard&&out.adaptiveCard.card) download(`${n.id}_outlook_card.json`, out.adaptiveCard.json, 'application/json'); }
  else if(kind==='log'){ addLog(n,out,'rendered'); toast('سُجل في سجل الإصدار'); }
}
function addLog(n,out,status){ S.log.unshift({time:nowLocalISO(),id:n.id,event:n.event,recipient:out.to||ROLES[n.role].label,key:out.idem,status,subject:out.subject,release:out.release?out.release.status:'',source:S.ctx.srcType||'',statusId:out.snapshot?out.snapshot.currentStatusId:''}); S.log=S.log.slice(0,500); save(); renderLog(); }

/* ===== log pane ===== */
function renderLog(){
  const host=$('#logtable'); if(!S.log.length){ host.innerHTML='<div class="empty">لا توجد إصدارات مسجلة بعد. التسجيل محلي في هذا المتصفح فقط، و«مُصدَّر» لا يعني «أُرسل».</div>'; return; }
  host.innerHTML=`<table class="tbl"><thead><tr><th>الوقت</th><th>الإشعار</th><th>الحدث</th><th>المستلم</th><th>المصدر / الحالة</th><th>حالة الإصدار</th><th>الحالة</th><th>المفتاح</th><th></th></tr></thead><tbody>${S.log.map((l,i)=>`<tr><td>${esc(fmtDateTime(l.time))}</td><td><b>${l.id}</b></td><td><code>${esc(l.event)}</code></td><td>${esc(l.recipient)}</td><td>${esc(l.source||'—')} <span dir="ltr">${esc(l.statusId||'')}</span></td><td>${l.release?`<span class="rel rel-${l.release}">${esc(RELEASE_LABEL[l.release]||l.release)}</span>`:'—'}</td><td><span class="st-${l.status}">${{rendered:'مُعدّ',exported:'مُصدَّر (.eml)',mailto:'فُتح في البريد',sent:'أُرسل (تأكيد يدوي)'}[l.status]||l.status}</span></td><td><code dir="ltr">${esc(l.key)}</code></td><td>${l.status!=='sent'?`<button class="btn sm" data-sent="${i}">تأكيد الإرسال يدوياً</button>`:''}</td></tr>`).join('')}</tbody></table>`;
  host.querySelectorAll('[data-sent]').forEach(b=>b.onclick=()=>{ S.log[+b.dataset.sent].status='sent'; save(); renderLog(); });
}
function exportLog(){ const rows=[['time','notification','event','recipient','source','status_id','release_status','status','idempotency_key','subject'],...S.log.map(l=>[l.time,l.id,l.event,l.recipient,l.source||'',l.statusId||'',l.release||'',l.status,l.key,l.subject])]; download('issuance_log.csv','﻿'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n'),'text/csv'); }

/* ===== reference pane ===== */
function table(cols, rows){ return `<div class="tblwrap"><table class="tbl"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function renderRef(which){
  const host=$('#refbody'); const E=esc;
  const trackTable=src=>{ const T=WF.tracks[src]; return `<div class="nhead" style="--c:${DATA.cats[src].color}"><h2>${E(T.nameAr)} <span class="tag">${E(T.version)}</span> <span class="gov ${T.governanceStatus==='APPROVED_SOURCE_MAPPING'?'ok':'warn'}">${E(GOV_LABEL[T.governanceStatus]||T.governanceStatus)}</span></h2><div class="sub">${E(T.authorityRef)} · ${E(T.authorityNoteAr)}</div></div>
    <h4>المراحل الرئيسية الخمس</h4>`+table(['#','العنوان','المختصر','عبارة المستلم الخارجي','شرطية','الوصف'],T.mainStages.map(s=>[s.sequence,`<span class="pill" style="background:${s.color}">${E(s.titleAr)}</span>`,E(s.shortAr),E(s.externalAr),s.isConditional?'نعم':'لا',E(s.descriptionAr)]))
    +`<h4>الحالات الثانوية (${T.statuses.length})</h4>`+table(['ID','المرحلة','العنوان','النوع','الإفصاح','السند','المرجع','V8','ما يراه المستلم الخارجي','الإجراء التالي','داخلي'],T.statuses.map(s=>[`<code>${s.id}</code>`,s.stageId.split('-')[1],E(s.titleAr),E(s.statusTypeAr),E(WF.levelLabels[s.disclosure]),E(WF.basisLabels[s.governanceBasis]),E(s.sourceReference),E(s.v8Code||'—'),E(s.recipientAr||'(محجوبة)'),E(s.nextAr),E(s.internalAr)]))
    +`<h4>سجل الانتقالات (${T.transitions.length})</h4>`+table(['ID','من','إلى','الحدث','الشروط','المخول','اعتماد مطلوب','أدلة مطلوبة','السند','الأثر','ملاحظة'],T.transitions.map(t=>[`<code>${t.id}</code>`,E(t.fromStatusId),E(t.toStatusId),`<code>${E(t.triggerEvent)}</code>`,t.guardConditions.map(E).join('؛ '),E(t.approver),E(t.requiredApproval||'—'),t.requiredEvidence.map(E).join('، ')||'—',E(WF.basisLabels[t.governanceBasis]),E(t.effect),E(t.notes)]))
    +`<h4>ملفات الإفصاح للمستلمين</h4>`+table(['الدور','الملف','المستويات','ملاحظة'],T.recipientProfiles.map(p=>[E(p.labelAr),`<code>${E(p.timelineProfile)}</code>`,p.levels.map(l=>E(WF.levelLabels[l])).join('، '),E(p.noteAr)])); };
  const views={
    tracks:()=>`<div class="warnbar info">ثلاثة مسارات مستقلة بحسب مصدر الحالة. مسار البلاغ مشتق من المصنف V8 ويقع في نطاق إجراء AAD.140؛ مسارا الإحالة المؤسسية والإحالة المباشرة مقترحان تصميمياً (DESIGN_PROPOSAL_REQUIRES_GOVERNANCE_APPROVAL) ولا يُعتبران إجراءً معتمداً. المراحل الخمس توحيد مرئي فقط؛ الحالات والانتقالات والنصوص خاصة بكل مصدر.</div>`+['WB','IR','DR'].map(trackTable).join('<hr class="sep">')+`<h4>الجسر مع حالات V8 (crosswalk)</h4>`+table(['V8','الاسم','WB','IR','DR'],DATA.substates.map(s=>[s.code,E(s.name),E(WF.crosswalk[s.code].WB||'—'),E(WF.crosswalk[s.code].IR||'—'),E(WF.crosswalk[s.code].DR||'—')])),
    notifications:()=>table(['الرمز','الفئة','العنوان القانوني','الحدث','الحالة (V8)','المستلم','الفعل','النضج','المستند/المادة','الإفصاح'],DATA.notifications.map(n=>[`<button class="mini" data-sel="${n.id}"><b>${n.id}</b></button>`,E(n.cat),E(n.title),`<code>${E(n.event)}</code>`,E(n.state),E(n.recipient),E(n.actionClass),`<span class="mat ${n.maturity}">${n.maturity}</span>`,E(n.basis),E(n.disclosure)])),
    texts:()=>DATA.notifications.map(n=>`<div class="txt"><div class="r1"><b>${n.id}</b> ${E(n.eventTitle)} <span class="mat ${n.maturity}">${n.maturity}</span></div><div class="r2"><b>بطاقة CRM:</b> ${E(n.card)}</div><div class="r3">${E(n.long)}</div><div class="r2"><b>الإجراء المطلوب:</b> ${E(n.action)}</div><div class="r2 muted"><b>سند:</b> ${E(n.contentBasis)} · <b>اعتماد:</b> ${E(n.approval)}</div></div>`).join(''),
    states:()=>table(['المرحلة','الاسم','المعرف','التعريف','شرط الخروج','اللون','المرئي للمستلم'],DATA.states.map(s=>[s.code,E(s.name),`<code>${E(s.key)}</code>`,E(s.definition),E(s.exit),`<span class="pill" style="background:${s.color}">${s.color}</span>`,E(s.visible)]))+'<h4>الحالات الفرعية (V8)</h4>'+table(['الرمز','الرئيسية','الاسم','State Key','الوصف','التالي','أدلة التوثيق','احتياط'],DATA.substates.map(s=>[s.code,s.main,E(s.name),`<code>${E(s.key)}</code>`,E(s.desc),E(s.next),E(s.evidence),E(s.caution)])),
    transitions:()=>table(['ID','من','إلى','Event Key','Guard','المخول','الأثر'],DATA.transitions.map(t=>[t.id,t.frm,t.to,`<code>${E(t.event)}</code>`,E(t.guard),E(t.who),E(t.effect)])),
    journeys:()=>table(['الرمز','المستلم','Role','المراحل','قيود الإفصاح','الكثافة','المسموح في البطاقة','قيد'],Object.values(DATA.journeys).map(j=>[j.code,E(j.recipient),`<code>${E(j.role)}</code>`,j.stages.map(E).join(' ← '),E(j.limits),E(j.density),E(j.allowed),E(j.caution)])),
    fields:()=>table(['Field Key','الكيان','الاسم','المصدر','حدث الإنشاء','تحذير'],DATA.fields.map(f=>[`<code>${E(f.key)}</code>`,E(f.entity),E(f.name),E(f.source),E(f.created),E(f.warn)])),
    ux:()=>table(['#','العنصر','المكوّن','المواصفات','ضوابط'],DATA.ux.map(u=>[u.n,E(u.element),E(u.component),E(u.spec),E(u.rule)])),
    qa:()=>table(['QA','المجال','القاعدة','الخطورة'],DATA.qa.map(q=>[q.id,E(q.area),E(q.rule),`<span class="sev ${q.severity}">${E(q.severity)}</span>`])),
    contract:()=>table(['#','الخطوة','المطلوب','ممنوع'],DATA.contract.map(c=>[c.id,E(c.step),E(c.required),E(c.forbidden)])),
    scenarios:()=>table(['السيناريو','الحقل','القيمة/النمط','قاعدة التحقق'],DATA.scenarios.map(s=>[E(s.scenario),`<code>${E(s.field)}</code>`,E(s.value),E(s.rule)])),
    refs:()=>table(['مرجع','المصدر','الملف','الغرض','درجة الإثبات','ملاحظة'],DATA.refs.map(r=>[r.id,E(r.name),E(r.file),E(r.purpose),E(r.proof),E(r.note)])),
  };
  host.innerHTML=(views[which]||views.tracks)();
  host.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>select(b.dataset.sel));
  $$('#reftabs button').forEach(b=>b.classList.toggle('on',b.dataset.ref===which));
}

/* ===== panes & boot ===== */
function showPane(p){ if(p==='next') p='timelens'; S.pane=p; $$('.pane').forEach(x=>x.classList.toggle('on',x.id==='pane-'+p)); $$('.mtab').forEach(x=>x.classList.toggle('on',x.dataset.pane===p)); window.scrollTo({top:0}); }
function exportCase(){ download(`case_context_${(S.ctx.ref||'draft').replace(/[^\w-]+/g,'_')}.json`, JSON.stringify({version:'V12.0',ctx:S.ctx,per:S.per},null,1), 'application/json'); }
function importCase(file){ const r=new FileReader(); r.onload=()=>{ try{ const d=JSON.parse(r.result); if(d.ctx){ S.ctx=(d.version==='V9.0'||d.version==='V10.0'||d.version==='V10.1'||d.version==='V11.0'||d.version==='V12.0')?Object.assign({},DEFAULT_CTX,d.ctx):migrateV8(d); S.ctx.events=Array.isArray(S.ctx.events)?S.ctx.events:[]; S.ctx.archived=S.ctx.archived||[]; S.per=d.per||S.per; save(); boot(false); toast('تم استيراد سياق الحالة'); } }catch(e){ toast('ملف غير صالح'); } }; r.readAsText(file); }
function boot(first){
  renderCasePane(); renderStrip(); renderFinder(); renderNext(); renderCompose(); renderLog(); renderRef('tracks'); renderTimeLens();
  if(first){
    document.addEventListener('click',e=>{ const b=e.target.closest('[data-go]'); if(b){ showPane(b.dataset.go); } });
    $$('.mtab').forEach(b=>b.onclick=()=>showPane(b.dataset.pane));
    $('#q').oninput=()=>{ S.filters.q=$('#q').value; renderFinder(); };
    $$('#reftabs button').forEach(b=>b.onclick=()=>renderRef(b.dataset.ref));
    $('#btn-demo').onclick=()=>{ demo(); save(); boot(false); toast('تم تعبئة بيانات تجريبية (تركيبية) مع سجل أحداث لمسار الإحالة المؤسسية'); };
    $('#btn-clear').onclick=()=>{ if(confirm('مسح كل البيانات المحفوظة محلياً (سياق الحالة وسجل الأحداث والخيارات وسجل الإصدار)؟')){ localStorage.removeItem(KEY); localStorage.removeItem(KEY_V8); S={ctx:Object.assign({},DEFAULT_CTX),per:{},sel:null,log:[],filters:{cat:'',sub:'',q:'',linked:false},pane:'case',tl:{open:{},viewer:'all',recused:false,pick:'',explain:'',form:null,flag:''},pendingSource:null}; boot(false); showPane('case'); } };
    $('#btn-export').onclick=exportCase; $('#file-import').onchange=e=>{ if(e.target.files[0]) importCase(e.target.files[0]); e.target.value=''; };
    $('#btn-log-csv').onclick=exportLog;
    const q=new URLSearchParams(location.search);
    if(q.has('demo')){ demo(); save(); boot(false); }
    if(q.get('n')&&byId(q.get('n'))){ S.sel=q.get('n'); per(S.sel); save(); renderFinder(); renderCompose(); }
    showPane(q.get('tab')||(S.sel?'compose':'case'));
  }
}
load(); boot(true);
