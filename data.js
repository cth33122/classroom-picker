// 数据页：导入成绩、考试编辑、备份恢复、清除数据



async function handleImport(e){const file=e.target.files[0];
  if(!file)return;
  const box=$('#importResult');
  box.textContent='正在读取…';
  try{const result=await importGrades(file);if(!result.students.length){box.innerHTML='<p class="danger-text">未识别到学生记录，请检查文件格式。</p>';return;}state.pendingImport={file,result};box.innerHTML=`<div class="panel">\
<h3>请确认考试信息</h3>\
<div class="grid">\
<div class="field">\
<label>考试名称</label>\
<input id="examName" value="${esc(result.source.exercise)}">\
</div>\
<div class="field">\
<label>考试时间</label>\
<input id="examDate" type="date" value="${esc(result.source.date)}">\
</div>\
<div class="field">\
<label>考试总分</label>\
<input id="examTotalScore" type="number" min="1" step="0.01" value="${Number(result.totalScore)||100}">\
</div>\
</div>\
<p class="hint">识别到 ${result.students.length} 条记录。请确认考试名称、时间和总分后保存。</p>\
<button class="primary" id="saveExamBtn">确认并保存考试</button>${result.warnings.length?`<p class="hint danger-text">提示：${result.warnings.slice(0,8).map(esc).join('；')}${result.warnings.length>8?'…':''}</p>`:''}</div>`;$('#saveExamBtn').addEventListener('click',savePendingExam);}catch(err){box.innerHTML=`<p class="danger-text">读取失败：${esc(err.message)}</p>`;}}

async function handleRestore(e){const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.students)||!Array.isArray(data.history))throw new Error('备份文件结构不完整');if(!confirm('恢复备份会覆盖当前本地数据，确定继续吗？'))return;for(const key of ['students','history','settings','absences','meta','exams','examResults'])await DB.replace(key,Array.isArray(data[key])?data[key]:[]);await reload();toast('备份已恢复');}catch(err){toast(`恢复失败：${err.message}`);}}

async function clearAll(){if(!confirm('确定清除全部学生、考试、历史和设置吗？此操作不可撤销。'))return;for(const key of ['students','history','settings','absences','meta','exams','examResults'])await DB.clear(key);state.currentClass='';state.candidates=[];await reload();toast('本地数据已清除');}

async function savePendingExam(){const pending=state.pendingImport;
  if(!pending)return;
  const name=$('#examName').value.trim()||pending.result.source.exercise,date=$('#examDate').value||pending.result.source.date,totalScore=Number($('#examTotalScore')?.value||pending.result.totalScore);
  if(!Number.isFinite(totalScore)||totalScore<=0){toast('考试总分必须大于0');return;}if(state.exams.some(e=>String(e.date)===String(date))){toast(`考试日期 ${date} 已存在，拒绝重复导入`);return;}const examId=`exam-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,exam={id:examId,name,date,totalScore,weight:1,sourceFile:pending.file.name,importedAt:new Date().toISOString(),count:pending.result.students.length};
  await DB.put('exams',exam);
  for(const incoming of pending.result.students){const old=state.students.find(s=>s.id===incoming.id);await DB.put('examResults',{id:`${examId}:${incoming.id}`,examId,studentId:incoming.id,identityKey:incoming.identityKey||incoming.id,result:incoming});await DB.put('students',old?{...old,...incoming,focus:old.focus===true}:incoming);}state.pendingImport=null;
  await reload();
  toast(`已保存考试：${name}`);
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
<p class="hint">支持“数智作业”与“学生小题得分明细”两类 xlsx。每次导入都会新增一条考试记录。</p>\
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
<button class="secondary" id="backupBtn">导出完整备份</button>\
<button class="secondary" id="historyExportBtn">导出点名历史</button>\
</div>\
<div class="backup-picker">\
<label class="secondary">选择备份<input id="backupInput" type="file" accept=".json" hidden>\
</label>\
</div>\
</div>\
<div class="panel">\
<h2>清除数据</h2>\
<p class="hint danger-text">清除后无法从本机恢复，请先导出备份。</p>\
<button class="danger" id="clearBtn">清除全部本地数据</button>\
</div>`;
    
  $('#xlsxInput')?.addEventListener('change',handleImport);$('#downloadTemplateBtn')?.addEventListener('click',downloadGradeTemplate);$('#backupBtn')?.addEventListener('click',exportBackup);$('#historyExportBtn')?.addEventListener('click',exportHistory);$('#backupInput')?.addEventListener('change',handleRestore);$('#clearBtn')?.addEventListener('click',clearAll);$$('[data-open-exam]').forEach(b=>b.onclick=()=>openExamEditor(b.dataset.openExam));
}
