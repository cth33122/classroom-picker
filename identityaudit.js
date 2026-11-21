// 重名与班级变动检查（数据身份 → 检查入口）
//
// 背景：导入成绩时如果同一场考试里有同名同学（如期中考 4 班、19 班各一个“林子航”），
// 旧版本会把新同学的考号写到已有同名学生身上，下一次认人时按这个号带错班级，
// 于是出现“19 班 林子航 → 4 班”这样的假变动，还会多出一个“林子航(2)”。
// 这个页面不自动改数据，只把“同班同名”和“有同名同学卷入班级变动”的组整理出来：
//   · 每条班级变动是哪一批、哪场考试、从哪个班到哪个班；
//   · 每个学生每场考试的“记录班级”（成绩表里那一行当时写的班）、分数、班次/段次；
//   · 头像和编号，方便老师判断谁是谁。
// 老师确认后再用页面里的“撤销这批变动 / 删除这位学生 / 打开详情”处理。

function auditNormName(s){return norm(s&&s.name||'');}
function auditMovesOf(studentId){
  const out=[];
  (state.classBatches||[]).forEach(b=>{
    (b&&b.moves||[]).forEach(m=>{
      if(m&&m.studentId===studentId)out.push({batch:b,move:m});
    });
  });
  return out;
}
function identityAuditModel(){
  const byName=new Map();
  (state.students||[]).forEach(s=>{
    const key=auditNormName(s);
    if(!key)return;
    const list=byName.get(key)||[];
    list.push(s);
    byName.set(key,list);
  });
  const groups=[];
  byName.forEach((list,name)=>{
    if(list.length<2)return;
    const classCounts=new Map();
    list.forEach(s=>{const cls=normalizeClassName(s.className);classCounts.set(cls,(classCounts.get(cls)||0)+1);});
    const sameClass=[...classCounts.entries()].filter(([,n])=>n>1).map(([cls])=>cls);
    const moved=list.filter(s=>auditMovesOf(s.id).length);
    groups.push({name,list,sameClass,moved,suspect:Boolean(sameClass.length||moved.length)});
  });
  groups.sort((a,b)=>
    (b.sameClass.length?1:0)-(a.sameClass.length?1:0)||
    b.moved.length-a.moved.length||
    a.name.localeCompare(b.name,'zh-CN'));
  return {groups,suspect:groups.filter(g=>g.suspect),other:groups.filter(g=>!g.suspect)};
}
function identityAuditSummary(){
  const model=identityAuditModel();
  return {suspect:model.suspect.length,other:model.other.length};
}

function auditExamRowsHtml(s){
  const currentClass=normalizeClassName(s.className);
  const records=chronologicalExams().map(e=>({exam:e,result:examResult(e,s)})).filter(x=>x.result).reverse();
  if(!records.length)return '<div class="hint">没有考试记录。</div>';
  return records.map(({exam,result})=>{
    const recorded=normalizeClassName(result.className);
    const odd=Boolean(recorded&&recorded!==currentClass);
    const total=Number(exam.totalScore)||100;
    const seg=typeof segmentRankFor==='function'?segmentRankFor(exam.id,s.id,result.gradeRank):null;
    return `<div class="audit-exam-row${odd?' is-odd':''}">\
<span class="audit-exam-name">${esc(exam.name||exam.date||'')}<small>${esc(exam.date||'')}</small></span>\
<span class="audit-exam-class">${esc(recorded||'—')}${odd?' ⚠':''}</span>\
<span class="audit-exam-score">${result.score??'—'}/${total}</span>\
<span class="audit-exam-rank">班 ${result.classRank??'—'} · 段 ${seg??'—'}</span>\
</div>`;
  }).join('');
}
function auditMovesHtml(s){
  const moves=auditMovesOf(s.id);
  if(!moves.length){
    const history=typeof classHistoryText==='function'?classHistoryText(s):'';
    return history?`<div class="hint">班级变更历史：${esc(history)}（没有对应的导入批次，可能是“调整班级”做的）。</div>`:'<div class="hint">没有班级变动记录。</div>';
  }
  return moves.map(({batch,move})=>`<div class="audit-move">\
<span class="audit-move-when">${esc(String(batch.at||'').slice(0,10))} · ${esc(batch.exam||'成绩导入')}</span>\
<span class="audit-move-path">${esc(move.from||'—')} → ${esc(move.to||'—')}</span>\
<button type="button" class="secondary row-btn" data-audit-undo="${esc(batch.id)}">撤销这批变动</button>\
</div>`).join('');
}
function auditStudentHtml(s){
  const aliases=identityValuesOf(s);
  const aliasText=aliases.length?aliases.slice(0,6).map(esc).join('、')+(aliases.length>6?' 等':''):'—';
  return `<div class="audit-student">\
<div class="audit-student-head">\
${avatarHtml(s,{size:38})}\
<span class="audit-student-who"><strong>${esc(s.displayName||s.name)}</strong><small>${esc(s.id)} · 现在 ${esc(s.className||'未分班')}</small></span>\
</div>\
<div class="audit-aliases">编号：${aliasText}</div>\
<div class="audit-moves-label">班级变动</div>\
${auditMovesHtml(s)}\
<div class="audit-exams-label">考试记录（从新到旧，⚠ 表示这一场记录里的班级和现在不同）</div>\
<div class="audit-exam-head"><span>考试</span><span>记录班级</span><span>分数</span><span>班 / 段</span></div>\
${auditExamRowsHtml(s)}\
<div class="audit-actions">\
<button type="button" class="secondary row-btn" data-audit-open="${esc(s.id)}">打开详情</button>\
<button type="button" class="secondary row-btn" data-audit-merge="${esc(s.id)}">合并到…</button>\
<button type="button" class="secondary row-btn" data-audit-delete="${esc(s.id)}">删除这位学生…</button>\
</div>\
</div>`;
}
function auditGroupHtml(group){
  return `<div class="audit-group">\
<div class="audit-group-head">\
<strong>${esc(group.name)}</strong>\
<span class="badge">同名 ${group.list.length} 人</span>\
${group.sameClass.length?`<span class="badge audit-badge-warn">同班：${group.sameClass.map(esc).join('、')}</span>`:''}\
${group.moved.length?`<span class="badge">${group.moved.length} 人有班级变动</span>`:''}\
</div>\
${group.sameClass.length?'<p class="hint">同班同名很可能是误建的重复记录：先看谁的成绩记录里“记录班级”对不上，再决定保留哪一条。</p>':''}\
${group.list.map(auditStudentHtml).join('')}\
</div>`;
}
function identityAuditHtml(){
  const model=identityAuditModel();
  const sameClass=model.suspect.filter(g=>g.sameClass.length);
  const moved=model.suspect.filter(g=>!g.sameClass.length&&g.moved.length);
  const otherNames=model.other.slice(0,120).map(g=>`${esc(g.name)}（${g.list.map(s=>esc(s.className||'未分班')).join('、')}）`).join('；');
  return `\
<p class="hint">这里只列“同班同名”或“有同名同学卷入班级变动”的组。判断方法：同名学生看每场考试的<b>记录班级</b>——同一场里各自在不同班，说明是两个人；某人的记录班级和现在班级对不上，说明这场成绩是按另一个班记的。</p>\
<p class="hint">确认是误认后，优先用每条记录旁的<b>「合并到…」</b>：先选保留哪一条，预览会逐场列出保留/删掉哪些成绩、编号怎么增删、头像/座位/点名怎么处理、假变动是否撤掉；确认后才改数据。如果预览提示“有成绩属于另一个班的同名同学”，再把那场考试删掉重导，才能把他建回来。</p>\
${model.suspect.length?`${sameClass.length?`<h3 class="audit-section-title">同班同名（${sameClass.length} 组）</h3>${sameClass.map(auditGroupHtml).join('')}`:''}${moved.length?`<h3 class="audit-section-title">有同名同学的班级变动（${moved.length} 组）</h3>${moved.map(auditGroupHtml).join('')}`:''}`:'<div class="empty">没有发现同班同名或卷入班级变动的同名学生。</div>'}\
${model.other.length?`<details class="audit-other"><summary>其他同名（不同班、没有班级变动）：${model.other.length} 组</summary><p class="hint">${otherNames}${model.other.length>120?' 等':''}</p></details>`:''}\
<details class="audit-other"><summary>修复步骤（确认是误认后再做）</summary>\
<ol class="audit-steps">\
<li>先到“文件 → 备份与恢复”导出完整备份。</li>\
<li>在本页对这组点“合并到…”，选保留正确的那一条；预览里确认成绩/编号/班级的处理，再点“确认合并”。</li>\
<li>如果预览提示某场成绩属于另一个班的同名同学：到“文件 → 已导入考试”删掉那场考试，再重新导入同一份成绩表。</li>\
<li>不想合并时也可以手动：撤销这批变动 → 删除多出来的那条学生 → 到“备选认人编号”清掉多出来的编号 → 删掉那场考试重导。</li>\
</ol>\
</details>`;
}

// ---------- 合并同名学生（保留一条，把另一条并进来） ----------
// 规则：保留者的身份编号/uid/头像不变；被合并者的成绩、点名、缺席、座位并过来；
// 两边同一场考试都有成绩时，保留“记录班级”等于合并后班级的那条，另一条删掉
// （它通常是另一个班的同名同学的）。被删掉那条带来的考号也会从保留者身上清掉。
function auditResultMatch(r,id,uid){return Boolean(r)&&(r.studentId===id||(uid&&r.studentUid===uid));}
function auditResultIds(r){return Array.isArray(r&&r.result&&r.result.ids)?r.result.ids.map(x=>x&&String(x.value)).filter(Boolean):[];}
function auditResultClass(r){return r&&r.result&&r.result.className?normalizeClassName(r.result.className):'';}
async function buildStudentMergePlan(keeperId,sourceId,mergedClass){
  const keeper=(state.students||[]).find(s=>s&&s.id===keeperId);
  const source=(state.students||[]).find(s=>s&&s.id===sourceId);
  if(!keeper||!source||keeper.id===source.id)return null;
  if(auditNormName(keeper)!==auditNormName(source))return {error:'只能合并同名的同学'};
  const classA=normalizeClassName(keeper.className)||'';
  const classB=normalizeClassName(source.className)||'';
  const keeperMove=auditMovesOf(keeper.id).find(x=>normalizeClassName(x.move.to)===classA&&normalizeClassName(x.move.from)===classB)||null;
  let chosen=(mergedClass?normalizeClassName(mergedClass):'')||'';
  if(!chosen)chosen=(keeperMove&&classB&&classB!==classA)?classB:(classA||classB);
  const revert=(keeperMove&&chosen===classB&&classB!==classA)?keeperMove:null;   // 合并后回到来源的班 = 撤回这条变动
  const resultA=(state.examResults||[]).filter(r=>auditResultMatch(r,keeper.id,keeper.uid));
  const resultB=(state.examResults||[]).filter(r=>auditResultMatch(r,source.id,source.uid));
  const examIds=[...new Set([...resultA,...resultB].map(r=>r.examId))];
  const exams=[],resultsMove=[],resultsDrop=[],warnings=[];
  let droppedOtherClass=0;
  examIds.forEach(examId=>{
    const as=resultA.filter(r=>r.examId===examId),bs=resultB.filter(r=>r.examId===examId);
    const a=as[0],b=bs[0];
    let keepSource=false;
    if(as.length&&bs.length){
      const aCls=auditResultClass(a),bCls=auditResultClass(b);
      keepSource=Boolean(chosen&&bCls===chosen&&aCls!==chosen);
    }else if(!as.length)keepSource=true;
    if(keepSource){
      bs.forEach(r=>{const moved={...r,studentId:keeper.id,identityKey:keeper.identityKey||keeper.id};if(keeper.uid)moved.studentUid=keeper.uid;else delete moved.studentUid;resultsMove.push(moved);});
      as.forEach(r=>{resultsDrop.push(r);if(auditResultClass(r)&&auditResultClass(r)!==chosen)droppedOtherClass++;});
    }else{
      bs.forEach(r=>{resultsDrop.push(r);if(auditResultClass(r)&&auditResultClass(r)!==chosen)droppedOtherClass++;});
    }
    exams.push({examId,exam:state.exams.find(e=>e.id===examId),keep:keepSource?b:a,keepSource,
      moved:keepSource?bs.length:0,dropped:keepSource?as.length:bs.length,droppedClass:auditResultClass(keepSource?a:b)});
  });
  // 保留的记录里出现过的编号（判断哪些编号来自被删掉的那一行）
  const keptValues=new Set();
  resultsMove.forEach(r=>auditResultIds(r).forEach(v=>keptValues.add(v)));
  resultA.forEach(r=>{if(!resultsDrop.includes(r))auditResultIds(r).forEach(v=>keptValues.add(v));});
  const sourceValues=identityValuesOf(source);
  const newIds=(Array.isArray(keeper.ids)?keeper.ids:[]).map(x=>({...x}));
  const have=new Set(newIds.map(x=>x&&String(x.value)));
  const aliasAdded=[];
  (source.ids||[]).forEach(x=>{
    const v=x&&String(x.value);
    if(!v||have.has(v))return;
    newIds.push({...x});have.add(v);aliasAdded.push(v);
  });
  const droppedValues=new Set();
  resultsDrop.forEach(r=>auditResultIds(r).forEach(v=>droppedValues.add(v)));
  const aliasRemoved=[];
  const finalIds=newIds.filter(x=>{
    const v=x&&String(x.value);
    if(v&&droppedValues.has(v)&&!keptValues.has(v)&&!sourceValues.includes(v)){aliasRemoved.push(v);return false;}
    return true;
  });
  // 座位：被合并者坐的位置改成保留者；保留者在这个班已有座位就空出来
  let layouts=[];try{layouts=await DB.all('seats');}catch(err){}
  const seatLayouts=[];let seatCount=0;
  (layouts||[]).forEach(l=>{
    if(!l||!Array.isArray(l.seats))return;
    const hasKeeper=l.seats.some(seat=>seat&&seat.studentId===keeper.id);
    let hit=false;
    const seats=l.seats.map(seat=>{
      if(!seat||!(seat.studentId===source.id||(source.uid&&seat.studentUid===source.uid)))return seat;
      hit=true;seatCount++;
      if(hasKeeper){const next={...seat,studentId:null};delete next.studentUid;return next;}
      const next={...seat,studentId:keeper.id};if(keeper.uid)next.studentUid=keeper.uid;else delete next.studentUid;return next;
    });
    if(hit)seatLayouts.push({...l,seats,updatedAt:new Date().toISOString()});
  });
  // 班级变动批次：删掉被合并者的变动；合并后回到来源的班时，把保留者那条假变动也撤掉
  const beforeBatches=state.classBatches||[];
  let batchesChanged=false;
  const nextBatches=beforeBatches.map(b=>{
    const moves=(b.moves||[]).filter(m=>{
      if(!m)return false;
      if(m.studentId===source.id){batchesChanged=true;return false;}
      if(revert&&m===revert.move){batchesChanged=true;return false;}
      return true;
    });
    return moves.length?{...b,moves}:null;
  }).filter(Boolean);
  // 班级变更历史：能从批次里拿到“变动前”的快照就还原，否则只改班级、给个提醒
  let classHistory=keeper.classHistory;
  if(chosen&&chosen!==classA){
    if(revert&&revert.move.prevHistory!==undefined)classHistory=JSON.parse(JSON.stringify(revert.move.prevHistory));
    else warnings.push('班级会改成来源的班，但没找到对应的导入批次，班级变更历史可能对不上。');
  }
  // 备注/头像/关注等
  const keeperNotes=String(keeper.notes||'').trim(),sourceNotes=String(source.notes||'').trim();
  const keeperImgs=typeof noteImages==='function'?noteImages(keeper):[];
  const sourceImgs=typeof noteImages==='function'?noteImages(source):[];
  const noteImagesNext=[...keeperImgs,...sourceImgs.filter(u=>!keeperImgs.includes(u))];
  let notes=keeper.notes;
  if(!keeperNotes&&sourceNotes)notes=source.notes;
  else if(keeperNotes&&sourceNotes)warnings.push('来源的备注文字没有合并（保留者的备注已有内容）。');
  if(source.focus&&!keeper.focus)warnings.push('来源标了“关注”，没有带过来。');
  if(source.noCall&&!keeper.noCall)warnings.push('来源标了“不参与点名”，没有带过来。');
  const keeperPhoto=state.photos&&state.photos[keeper.id];
  const sourcePhoto=state.photos&&state.photos[source.id];
  const photo=keeperPhoto?'keep':(sourcePhoto?'move':'none');
  if(keeperPhoto&&sourcePhoto)warnings.push('两边都有头像，合并后保留保留者的头像。');
  // 点名/缺席跟着人走
  const moveRecords=rows=>(rows||[]).filter(r=>auditResultMatch(r,source.id,source.uid)).map(r=>{
    const next={...r,studentId:keeper.id};if(keeper.uid)next.studentUid=keeper.uid;else delete next.studentUid;return next;
  });
  const historyMove=moveRecords(state.history),absencesMove=moveRecords(state.absences);
  if(droppedOtherClass)warnings.push(`有 ${droppedOtherClass} 条成绩是另一个班的同名同学的（会删掉）；合并后请把那场考试删掉重导，才能把他建回来。`);
  const keeperNext={...keeper,className:chosen||keeper.className,ids:finalIds,classHistory,notes,noteImages:noteImagesNext};
  if(!keeperNext.sourceExamId&&source.sourceExamId)keeperNext.sourceExamId=source.sourceExamId;
  return {keeper,source,classA,classB,mergedClass:chosen,revertMove:revert,exams,resultsMove,resultsDrop,
    historyMove,absencesMove,photo,sourcePhoto,keeperNext,seatLayouts,seatCount,nextBatches,batchesChanged,warnings,
    aliasAdded,aliasRemoved};
}
function mergePreviewHtml(plan){
  const keeper=plan.keeper,source=plan.source;
  const classOptions=[plan.classA,plan.classB].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const classField=classOptions.length>1?`<div class="field merge-class-field"><label>合并后这位同学的班级</label>\
<select id="mergeClassSelect">${classOptions.map(c=>`<option value="${esc(c)}" ${c===plan.mergedClass?'selected':''}>${esc(c)}${c===plan.classA?'（保留者现在）':''}${c===plan.classB?'（被合并者现在）':''}</option>`).join('')}</select></div>`:'';
  const examLines=plan.exams.map(x=>{
    const name=esc((x.exam&&(x.exam.name||x.exam.date))||'未命名考试');
    const keep=x.keep;
    const keepText=keep?`${esc(auditResultClass(keep)||'—')} ${(keep.result&&keep.result.score)??'—'} 分（${x.keepSource?'来自被合并的记录':'保留者原本的记录'}）`:'—';
    const drop=x.dropped?`；删掉 ${x.dropped} 条${x.droppedClass?`（${esc(x.droppedClass)}）`:''}`:'';
    return `<li class="seat-import-note info">${name}：保留 ${keepText}${drop}</li>`;
  }).join('');
  const photoText=plan.photo==='move'?'来源有头像 → 移到保留者':(plan.photo==='keep'?(plan.sourcePhoto?'保留者已有头像（来源的删掉）':'保留者已有头像'):'没有头像');
  const aliasText=[
    plan.aliasAdded.length?`并入编号 ${esc(plan.aliasAdded.join('、'))}`:'',
    plan.aliasRemoved.length?`清掉编号 ${esc(plan.aliasRemoved.join('、'))}`:'',
  ].filter(Boolean).join('；')||'编号无变化';
  const batchText=plan.revertMove
    ?`班级变动：会撤掉「${esc(plan.revertMove.move.from||'—')} → ${esc(plan.revertMove.move.to||'—')}」这条批次变动，班级历史还原到变动前`
    :(plan.batchesChanged?'班级变动：被合并者的变动记录会一起清掉':'');
  return `<div class="modal-card merge-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>合并同名学生</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="seat-import-stats">把「${esc(source.displayName||source.name)}（${esc(source.id)} · 现在 ${esc(source.className||'未分班')}）」合并到「${esc(keeper.displayName||keeper.name)}（${esc(keeper.id)} · 现在 ${esc(keeper.className||'未分班')}）」；合并后只保留后者。</p>\
${classField}\
<div class="audit-moves-label">考试记录</div>\
<ul class="seat-import-notes">${examLines||'<li class="seat-import-note empty">两边都没有考试记录</li>'}</ul>\
<div class="audit-moves-label">其它数据</div>\
<ul class="seat-import-notes">\
<li class="seat-import-note info">点名 / 评价 / 问题记录：并入 ${plan.historyMove.length} 条；缺席：并入 ${plan.absencesMove.length} 条；座位：处理 ${plan.seatCount} 个</li>\
<li class="seat-import-note info">头像：${esc(photoText)}；${esc(aliasText)}</li>\
${batchText?`<li class="seat-import-note info">${esc(batchText)}</li>`:''}\
</ul>\
${plan.warnings.length?`<ul class="seat-import-notes">${plan.warnings.map(w=>`<li class="seat-import-note warn">${esc(w)}</li>`).join('')}</ul>`:''}\
<p class="hint">合并会修改本机数据，且不可撤销；建议先到“文件 → 备份与恢复”导出完整备份。</p>\
<div class="actions"><button type="button" class="secondary" id="mergeCancel">取消</button><button type="button" class="primary" id="mergeOk">确认合并</button></div>\
</div>`;
}
function openMergePicker(sourceId){
  const source=(state.students||[]).find(s=>s&&s.id===sourceId);
  if(!source)return;
  const others=(state.students||[]).filter(s=>s&&s.id!==source.id&&auditNormName(s)===auditNormName(source));
  if(!others.length){toast('没有其他同名同学');return;}
  document.getElementById('mergeStudentModal')?.remove();
  const modal=document.createElement('div');
  modal.id='mergeStudentModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card merge-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>合并到谁？</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="hint">要把「${esc(source.displayName||source.name)}（${esc(source.id)}）」合并到哪一位同名同学？被合并的这条会删除，成绩/点名/头像会并到保留的那条。</p>\
<div class="merge-pick-list">${others.map(o=>{
    const count=(state.examResults||[]).filter(r=>auditResultMatch(r,o.id,o.uid)).length;
    const hasPhoto=Boolean(state.photos&&state.photos[o.id]);
    return `<button type="button" class="merge-pick" data-merge-keep="${esc(o.id)}">${avatarHtml(o,{size:36})}<span class="merge-pick-main"><strong>${esc(o.displayName||o.name)} · ${esc(o.className||'未分班')}</strong><small>${esc(o.id)} · ${count} 场成绩${hasPhoto?' · 有头像':''}</small></span></button>`;
  }).join('')}</div>\
<div class="actions"><button type="button" class="secondary" id="mergeCancel">取消</button></div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#mergeCancel').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  modal.querySelectorAll('[data-merge-keep]').forEach(b=>{b.onclick=()=>{close();openMergePreview(b.dataset.mergeKeep,sourceId);};});
}
async function openMergePreview(keeperId,sourceId,mergedClass){
  const plan=await buildStudentMergePlan(keeperId,sourceId,mergedClass);
  if(!plan){toast('这两位同学已经找不到了');return;}
  if(plan.error){toast(plan.error);return;}
  document.getElementById('mergeStudentModal')?.remove();
  const modal=document.createElement('div');
  modal.id='mergeStudentModal';modal.className='modal-backdrop';
  modal.innerHTML=mergePreviewHtml(plan);
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#mergeCancel').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  const classSelect=$('#mergeClassSelect');
  if(classSelect)classSelect.onchange=()=>{close();openMergePreview(keeperId,sourceId,classSelect.value);};
  $('#mergeOk').onclick=async()=>{
    const btn=$('#mergeOk');
    if(btn&&btn.disabled)return;
    if(!confirm(`确认把「${plan.source.displayName||plan.source.name}（${plan.source.id}）」合并到「${plan.keeper.displayName||plan.keeper.name}（${plan.keeper.id}）」？\n\n被合并的这条会被删除，此操作不可撤销。`))return;
    if(btn){btn.disabled=true;btn.textContent='正在合并…';}
    try{
      await executeStudentMerge(plan);
      close();
      const needReimport=plan.warnings.some(w=>w.includes('删掉重导'));
      toast(needReimport
        ?'已合并；那场考试里有另一位同名同学的成绩，请删掉该考试后重新导入'
        :`已合并：${plan.source.displayName||plan.source.name} → ${plan.keeper.displayName||plan.keeper.name}`);
      if(document.getElementById('identityAuditPage'))renderIdentityAuditBody();
    }catch(err){
      if(btn){btn.disabled=false;btn.textContent='确认合并';}
      toast('合并失败：'+((err&&err.message)||'未知错误'));
    }
  };
}
async function executeStudentMerge(plan){
  for(const r of plan.resultsDrop)await DB.remove('examResults',r.id);
  if(plan.resultsMove.length)await DB.putMany('examResults',plan.resultsMove);
  if(plan.historyMove.length)await DB.putMany('history',plan.historyMove);
  if(plan.absencesMove.length)await DB.putMany('absences',plan.absencesMove);
  if(plan.photo==='move'&&plan.sourcePhoto){
    const rec={...plan.sourcePhoto,id:plan.keeper.id};
    if(plan.keeper.uid)rec.studentUid=plan.keeper.uid;else delete rec.studentUid;
    await DB.put('photos',rec);
    await DB.remove('photos',plan.source.id);
  }else if(plan.sourcePhoto){
    await DB.remove('photos',plan.source.id);
  }
  if(plan.seatLayouts.length)await DB.putMany('seats',plan.seatLayouts);
  await DB.put('students',plan.keeperNext);
  if(plan.batchesChanged&&typeof saveClassBatches==='function')await saveClassBatches(plan.nextBatches);
  await DB.remove('students',plan.source.id);
  if(state.studentDetail===plan.source.id)state.studentDetail=null;
  await reload();
  return true;
}

// 从检查页点“打开详情”去学生详情时，先记下滚动位置并关掉检查页；
// 从详情返回（左上角返回 / 安卓返回键）时再恢复检查页和原来的滚动位置。
let auditReturnScroll=0;
let auditReturnPending=false;
function clearIdentityAuditReturn(){auditReturnPending=false;}
function resumeIdentityAuditAfterDetail(){
  if(!auditReturnPending)return false;
  auditReturnPending=false;
  openIdentityAudit();
  const body=document.getElementById('identityAuditBody');
  if(body)body.scrollTop=auditReturnScroll||0;
  return true;
}

function bindIdentityAudit(){
  const page=document.getElementById('identityAuditPage');
  if(!page)return;
  page.querySelectorAll('[data-audit-close]').forEach(b=>{b.onclick=closeIdentityAudit;});
  page.querySelectorAll('[data-audit-open]').forEach(b=>{b.onclick=()=>{
    const id=b.dataset.auditOpen;
    const body=document.getElementById('identityAuditBody');
    auditReturnScroll=body?body.scrollTop:0;
    auditReturnPending=true;
    closeIdentityAudit();
    openStudentDetail(id);
  };});
  page.querySelectorAll('[data-audit-undo]').forEach(b=>{b.onclick=async()=>{
    if(typeof undoClassChangeBatch!=='function')return;
    const ok=await undoClassChangeBatch(b.dataset.auditUndo);
    if(ok&&document.getElementById('identityAuditPage'))renderIdentityAuditBody();
  };});
  page.querySelectorAll('[data-audit-delete]').forEach(b=>{b.onclick=async()=>{
    if(typeof deleteStudentRecord!=='function')return;
    const ok=await deleteStudentRecord(b.dataset.auditDelete);
    if(ok&&document.getElementById('identityAuditPage'))renderIdentityAuditBody();
  };});
  page.querySelectorAll('[data-audit-merge]').forEach(b=>{b.onclick=()=>openMergePicker(b.dataset.auditMerge);});
}
function renderIdentityAuditBody(){
  const body=document.getElementById('identityAuditBody');
  if(!body)return;
  body.innerHTML=identityAuditHtml();
  const count=document.getElementById('identityAuditCount');
  if(count){const n=identityAuditSummary().suspect;count.textContent=n?`${n} 组可疑`:'没有可疑';}
  bindIdentityAudit();
}
function closeIdentityAudit(){
  document.getElementById('identityAuditPage')?.remove();
}
function openIdentityAudit(){
  auditReturnPending=false;   // 手动打开：不再挂起“从详情返回”的恢复
  document.getElementById('panelHelpModal')?.remove();
  let page=document.getElementById('identityAuditPage');
  if(page){page.remove();}
  page=document.createElement('div');
  page.id='identityAuditPage';
  page.className='audit-page';
  page.innerHTML=`<div class="audit-head">\
<button type="button" class="audit-back" data-audit-close aria-label="关闭">←</button>\
<h2>重名与班级变动检查</h2>\
<span class="badge" id="identityAuditCount"></span>\
</div>\
<div class="audit-body" id="identityAuditBody"></div>`;
  document.body.appendChild(page);
  renderIdentityAuditBody();
}
