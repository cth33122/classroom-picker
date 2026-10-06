// 数据页：导入成绩、考试编辑、备份恢复、清除数据



// 读取/保存期间置位：手机端连点时会排队触发多次，必须自己挡住并发
let importBusy=false;

async function handleImport(e){const file=e.target.files[0],input=e.target;
  if(!file)return;
  const box=$('#importResult');
  if(importBusy){input.value='';toast('正在处理上一个文件，请稍候');return;}
  importBusy=true;
  box.textContent='正在读取…';
  try{const result=await importGradeBooks(file);if(!result.exams.length){box.innerHTML='<p class="danger-text">未识别到学生记录，请检查文件格式。</p>';return;}state.pendingImport={file,exams:result.exams};box.innerHTML=importPreviewHtml(result);$('#saveExamBtn').addEventListener('click',savePendingExams);}catch(err){box.innerHTML=`<p class="danger-text">读取失败：${esc(err.message)}</p>`;}finally{importBusy=false;input.value='';}}

// 导入确认面板：每场考试一张卡片。多场考试时可改名称/日期/总分，并取消勾选不需要的工作表。
function importPreviewHtml(result){
  const exams=result.exams,multi=exams.length>1,existing=new Set(state.exams.map(x=>String(x.date))),seen=new Set(),totalRecords=exams.reduce((n,x)=>n+x.students.length,0);
  const cards=exams.map((exam,index)=>{
    const date=String(exam.source.date),clash=existing.has(date)||seen.has(date);seen.add(date);
    const warn=exam.warnings.slice(0,3).map(esc).join('；');
    return `<div class="exam-import-card${clash?' exam-import-clash':''}" data-exam-index="${index}">\
<div class="exam-import-head">${multi?'<label class="exam-import-pick"><input type="checkbox" class="exam-include" checked> 导入</label>':''}<strong>${esc(exam.source.exercise)}</strong><span class="badge">${exam.students.length}条</span></div>\
<div class="grid">\
<div class="field">\
<label>考试名称</label>\
<input class="exam-name" value="${esc(exam.source.exercise)}">\
</div>\
<div class="field">\
<label>考试时间</label>\
<input class="exam-date" type="date" value="${esc(date)}">\
</div>\
<div class="field">\
<label>考试总分</label>\
<input class="exam-total" type="number" min="1" step="0.01" value="${Number(exam.totalScore)||100}">\
</div>\
</div>\
<p class="hint">${multi?`来源工作表：${esc(exam.sheetNames.join('、'))}<br>`:''}${warn?`<span class="danger-text">提示：${warn}</span>`:'成绩、班次、段次将一并保存。'}</p>\
${clash?'<p class="hint danger-text">该日期已存在考试记录，保存时将自动跳过。</p>':''}\
</div>`;
  }).join('');
  return `<div class="panel">\
<h3>请确认考试信息</h3>\
<p class="hint">共识别 ${exams.length} 场考试、${totalRecords} 条记录${multi?'。可修改名称、日期、总分，或取消勾选不需要的工作表。':'。'}</p>\
<div class="exam-import-list">${cards}</div>\
${result.warnings.length?`<p class="hint danger-text">提示：${result.warnings.slice(0,6).map(esc).join('；')}${result.warnings.length>6?'…':''}</p>`:''}\
<button class="primary" id="saveExamBtn">确认并保存${multi?` ${exams.length} 场考试`:'考试'}</button>\
</div>`;
}

async function handleRestore(e){const file=e.target.files[0],input=e.target;
  if(!file)return;
  if(importBusy){input.value='';toast('正在保存成绩，请稍候');return;}
  try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.students)||!Array.isArray(data.history))throw new Error('备份文件结构不完整');if(!confirm('恢复备份会覆盖当前本地数据，确定继续吗？'))return;importBusy=true;try{for(const key of ['students','history','settings','absences','meta','exams','examResults','seats'])await DB.replace(key,Array.isArray(data[key])?data[key]:[]);await refreshAfterDataImport();toast('备份已恢复');}finally{importBusy=false;}}catch(err){toast(`恢复失败：${err.message}`);}finally{input.value='';}}

async function clearAll(){if(importBusy){toast('正在保存，请稍候');return;}if(!confirm('确定清除全部学生、考试、历史和设置吗？此操作不可撤销。'))return;for(const key of ['students','history','settings','absences','meta','exams','examResults','seats'])await DB.clear(key);state.currentClass='';state.candidates=[];await refreshAfterDataImport();toast('本地数据已清除');}

async function savePendingExams(){
  const pending=state.pendingImport;
  if(!pending||importBusy)return;
  const btn=$('#saveExamBtn');
  const entries=$$('#importResult .exam-import-card').map(card=>{const exam=pending.exams[Number(card.dataset.examIndex)];return {exam,include:pending.exams.length<2?true:Boolean(card.querySelector('.exam-include')?.checked),name:(card.querySelector('.exam-name')?.value||'').trim()||exam.source.exercise,date:card.querySelector('.exam-date')?.value||exam.source.date,totalScore:Number(card.querySelector('.exam-total')?.value||exam.totalScore)};}).filter(x=>x.include);
  if(!entries.length){toast('请至少勾选一场考试');return;}
  const invalid=entries.find(x=>!Number.isFinite(x.totalScore)||x.totalScore<=0);if(invalid){toast(`“${invalid.name}”的考试总分必须大于0`);return;}
  importBusy=true;
  const label=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='正在保存…';}
  try{
    // 重复校验以数据库里的考试为准；日期在写库之前就登记，避免并发点击或失败重试时重复导入
    const savedDates=new Set((await DB.all('exams')).map(x=>String(x.date)));
    const studentIndex=new Map(state.students.map(s=>[s.id,s])),mergedStudents=new Map(),newResults=[],newExams=[],skipped=[];
    let saved=0,recordCount=0;
    for(const entry of entries){
      const date=String(entry.date);
      if(savedDates.has(date)){skipped.push(`${entry.name}（${entry.date}）`);continue;}
      savedDates.add(date);
      const examId=`exam-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      for(const incoming of entry.exam.students){
        const old=studentIndex.get(incoming.id),merged=old?{...old,...incoming,focus:old.focus===true}:incoming;
        studentIndex.set(incoming.id,merged);mergedStudents.set(incoming.id,merged);
        newResults.push({id:`${examId}:${incoming.id}`,examId,studentId:incoming.id,identityKey:incoming.identityKey||incoming.id,result:incoming});
      }
      newExams.push({id:examId,name:entry.name,date:entry.date,totalScore:entry.totalScore,weight:1,sourceFile:pending.file.name,importedAt:new Date().toISOString(),count:entry.exam.students.length});
      saved++;recordCount+=entry.exam.students.length;
    }
    // 成绩明细与学生先写、考试记录最后写：中途失败时不会留下“有考试却没有成绩”的记录
    await DB.putMany('examResults',newResults);
    await DB.putMany('students',[...mergedStudents.values()]);
    await DB.putMany('exams',newExams);
    await refreshAfterDataImport();
    toast(saved?`已保存 ${saved} 场考试、${recordCount} 条记录${skipped.length?`；跳过日期重复：${skipped.join('、')}`:''}`:`未保存新考试，日期重复：${skipped.join('、')}`);
  }catch(err){
    if(btn){btn.disabled=false;btn.textContent=label;}
    toast(`保存失败：${err.message}`);
  }finally{importBusy=false;}
  }

function openExamEditor(id){
  const e=state.exams.find(x=>x.id===id);if(!e)return;
  const old=$('#examModal');
    old?.remove();
    const modal=document.createElement('div');
    modal.id='examModal';
    modal.className='modal-backdrop';
    modal.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true">\
<div class="modal-header">\
<h2>编辑考试</h2>\
<button class="icon-button modal-close" aria-label="关闭">×</button>\
</div>\
<div class="field">\
<label>考试名称</label>\
<input id="editExamName" value="${esc(e.name||'')}">\
</div>\
<div class="field">\
<label>考试日期</label>\
<input id="editExamDate" type="date" value="${esc(e.date||'')}">\
</div>\
<div class="field">\
<label>总分</label>\
<input id="editExamTotal" type="number" min="1" step="0.01" value="${Number(e.totalScore)||100}">\
</div>\
<div class="field">\
<label>点名权重</label>\
<input id="editExamWeight" type="number" min="0" step="0.1" value="${Number(e.weight??1)}">\
</div>\
<div class="actions">\
<button class="primary" id="saveExamEdit">保存</button>\
<button class="danger" id="deleteExamEdit">删除考试</button>\
</div>\
</div>`;
    document.body.appendChild(modal);
    $('.modal-close').onclick=()=>modal.remove();
    modal.onclick=ev=>{if(ev.target===modal)modal.remove();};
    $('#saveExamEdit').onclick=async()=>{const date=$('#editExamDate').value;if(state.exams.some(x=>x.id!==id&&String(x.date)===String(date))){toast(`考试日期 ${date} 已存在`);return;}e.name=$('#editExamName').value.trim()||e.name;e.date=date;e.totalScore=Number($('#editExamTotal').value)||e.totalScore;e.weight=Math.max(0,Number($('#editExamWeight').value)||0);await DB.put('exams',e);modal.remove();await reload();toast('考试设置已保存');};
    $('#deleteExamEdit').onclick=async()=>{if(!confirm(`确定删除考试“${e.name}”及其成绩吗？`))return;await DB.remove('exams',id);for(const r of state.examResults.filter(x=>x.examId===id))await DB.remove('examResults',r.id);modal.remove();await reload();toast('考试已删除');};
    
}

function renderData(){
  const exams=orderedExams();
  $('#view-data').innerHTML=`<div class="panel">\
<h2>导入成绩文件</h2>\
<p class="hint">支持“数智作业”“学生小题得分明细”等 xlsx。若一个工作簿含多个以“考试名称-日期”（如 周测8-20270124）命名的工作表，会分别导入为多场考试；学生身份以“班级+姓名”为准，学号/考号可选。</p>\
<div class="data-import-actions">\
<input id="xlsxInput" class="file-input" type="file" accept=".xlsx">\
<button class="secondary" id="downloadTemplateBtn">下载成绩导入模板</button>\
</div>\
<div id="importResult">\
</div>\
</div>\
<div class="panel">\
<details class="exam-fold exam-fold-all">\
<summary>\
<strong>已导入考试</strong> <span class="badge">${exams.length}次</span>\
</summary>\
<div class="exam-fold-list">${exams.length?exams.map(e=>`<button class="exam-name-item" data-open-exam="${esc(e.id)}">\
<span>\
<strong>${esc(e.name||e.date||'未命名考试')}</strong>\
<br>\
<small class="hint">考试日期：${esc(e.date||'')} · ${e.count||0}条记录</small>\
</span>\
<span aria-hidden="true">›</span>\
</button>`).join(''):'<div class="empty">尚未导入考试</div>'}</div>\
</details>\
</div>\
<div class="panel">\
<h2>备份与恢复</h2>\
<div class="actions">\
<button class="secondary" id="historyExportBtn">导出点名历史</button>\
<button class="secondary" id="exportGradesBtn">导出成绩表格</button>\
</div>\
<p class="hint">“导出成绩表格”生成 xlsx，每场考试一个工作表（工作表名为“考试名称-日期”），内容为姓名、班级、成绩、班次、段次、考号，可直接再导入本程序。</p>\
<div class="backup-picker">\
<button class="secondary" id="backupBtn">导出完整备份</button>\
<label class="secondary">导入备份文件<input id="backupInput" type="file" accept=".json" hidden>\
</label>\
</div>\
</div>\
<div class="panel">\
<h2>清除数据</h2>\
<p class="hint danger-text">清除后无法从本机恢复，请先导出备份。</p>\
<button class="danger" id="clearBtn">清除全部本地数据</button>\
</div>`;
    
  $('#xlsxInput')?.addEventListener('change',handleImport);$('#downloadTemplateBtn')?.addEventListener('click',downloadGradeTemplate);$('#backupBtn')?.addEventListener('click',exportBackup);$('#historyExportBtn')?.addEventListener('click',exportHistory);$('#exportGradesBtn')?.addEventListener('click',exportGrades);$('#backupInput')?.addEventListener('change',handleRestore);$('#clearBtn')?.addEventListener('click',clearAll);$$('[data-open-exam]').forEach(b=>b.onclick=()=>openExamEditor(b.dataset.openExam));
}
