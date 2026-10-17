// 数据页：导入成绩、考试编辑、备份恢复、清除数据

// 这一页各面板的说明：不再是页面上的大段小字，改成标题右边的“？”弹窗
registerPanelHelp('data.import','导入成绩文件',
  `<p>支持“数智作业”“学生小题得分明细”等 xlsx。</p>\
<p>若一个工作簿含多个以<strong>“考试名称-日期”</strong>（如 周测8-20270124）命名的工作表，会分别导入为多场考试。</p>\
<p>学生身份以<strong>“班级+姓名”</strong>为准；学号/考号可选，但建议保留——<strong>同名同学要靠它来区分</strong>，导入时也会顺手记下来，以后同名时自动认人。</p>\
<p>导入后班级变动会立即生效，并在对应班级的学生页顶部提示核对（可在“班级变动记录”里整批核对或撤销）。</p>`);
registerPanelHelp('data.backup','备份与恢复',
  `<p>“立即备份”会立刻下载一个备份文件，包含学生、成绩、点名记录（含评价与问题）、座位表与设置。</p>\
<p>“导入备份文件”用备份文件<strong>覆盖本机数据</strong>，操作前会再确认一次。</p>\
<p>注意：<strong>学生头像不在备份文件里</strong>（头像体积大，存在本机），换设备时请另外导出头像包。</p>`);
registerPanelHelp('data.avatar','学生头像',
  () => `<p>头像包就是一个 zip：照片放进去，再放一份 <strong>manifest.csv</strong>（列：班级、学号、姓名、文件名）说明谁是谁。</p>\
<p>不想写清单也行——照片文件名里带学号或姓名（如 <code>20260101.jpg</code>、<code>张三.jpg</code>、<code>张三_头像.jpg</code>）会自动对上；<strong>同名同学请写学号，或写成“张三(2)”这种带序号的名字</strong>，否则系统不会猜。</p>\
<p>导入时统一压成 ${AVATAR_SIZE}×${AVATAR_SIZE} 的 JPEG，存本机。</p>\
<p>只给个别学生设置：到“学生”页点开他，点头像（或“设置头像”链接）即可拍照或选图，并能拖动、缩放裁剪。当前本机已存 <strong>${photoCount()}</strong> 张头像。</p>`);
registerPanelHelp('data.classAdjust','调整班级',
  `<p>分班 / 换班在这里做：选“从哪个班调整”，勾选学生，再选“调到哪个班”（也可以直接输入一个新班级名，等于整班改名）。</p>\
<p><strong>点名历史、评价、问题记录、头像都会跟着学生走</strong>——它们按身份关联，不随班级变化。</p>\
<p>调整后，这些人会从原班座位表里移除（座位属于班级），新班需要重新安排座位；以后导入新班的成绩时，会按学号/姓名认出他们，不会重复建人。</p>\
<p>如果是导入成绩时自动发生的分班，不用在这里做，见“班级变动记录”。</p>`);
registerPanelHelp('data.batches','班级变动记录',
  () => `<p>每次导入成绩后，学生的班级变化都会记成一批，最多保留最近 <strong>${CLASS_BATCH_KEEP}</strong> 批。</p>\
<p>核对是<strong>按班各算各的</strong>：在某个班点“本班核对无误”只结束那个班的提示，别的班照样还会提示；在这里可以“整批核对无误”。</p>\
<p>“撤销这批变动”随时可用（包括已核对的批次）：班级、班级变更历史、座位表一起还原；后来班级又变过的人会被跳过，不会盖掉之后的调整。</p>`);
registerPanelHelp('data.clear','清除数据',
  `<p>清除会删掉本机的<strong>全部数据</strong>：学生、成绩、点名记录与评价、问题记录、座位表、设置，以及学生头像。</p>\
<p><strong>清除后无法从本机恢复</strong>，请先在“备份与恢复”里导出备份。</p>`);



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

const BACKUP_KEYS=['students','history','settings','absences','meta','exams','examResults','seats'];
// 备份文件里可能带音频等未知字段；只挑本程序认得的表恢复，其余忽略
function pickBackup(data){const out={};BACKUP_KEYS.forEach(k=>{out[k]=Array.isArray(data[k])?data[k]:[];});return out;}
async function handleRestore(e){
  const file=e.target.files[0],input=e.target;
  if(!file)return;
  if(importBusy){input.value='';toast('正在保存成绩，请稍候');return;}
  try{
    const raw=await file.text();
    let data=null;
    try{data=JSON.parse(raw);}catch(err){throw new Error('不是有效的 JSON 文件，请确认选的是本程序导出的备份');}
    const looksLikeBackup=data&&typeof data==='object'&&BACKUP_KEYS.some(k=>Array.isArray(data[k]));
    if(!looksLikeBackup)throw new Error('备份文件结构不完整（缺少学生/点名记录等数据表）');
    const counts=BACKUP_KEYS.map(k=>({k,n:Array.isArray(data[k])?data[k].length:0}));
    const summary=counts.filter(x=>x.n).map(x=>`${x.k}=${x.n}`).join('、')||'全部为空';
    const ver=Number(data.version)||1;
    const verNote=ver>3?`\n\n注意：该备份版本较新（v${ver}），本程序可能不认识其中的新增字段。`:'';
    if(!confirm(`用备份文件覆盖本机数据？\n\n${new Date(file.lastModified||Date.now()).toLocaleString()} 的文件\n包含：${summary}\n\n当前数据会被替换，此操作不可撤销。${verNote}`))return;
    importBusy=true;
    const picked=pickBackup(data);
    for(const key of BACKUP_KEYS)await DB.replace(key,picked[key]);
    await refreshAfterDataImport();
    toast(`备份已恢复：${summary}`);
  }catch(err){
    toast(`恢复失败：${err.message}`);
  }finally{
    importBusy=false;
    input.value='';   // 允许再次选择同一个文件
  }
}

// 头像包（zip）：交给 photos.js 解析与写入；这里只管忙碌状态与报错
async function handleAvatarZipImport(e){
  const file=e.target.files[0],input=e.target;
  if(!file)return;
  if(importBusy){input.value='';toast('正在保存成绩，请稍候');return;}
  importBusy=true;
  try{await importAvatarPackage(file);}
  catch(err){toast('导入头像失败：'+(err.message||'未知错误'));}
  finally{importBusy=false;input.value='';}
}
// 分班确认弹窗：只在“大量学生的班级与库里不同”时出现；用户点确认才继续写库。
// 返回 {adoptType, assign, backup} 或 null（取消导入）：
//   adoptType 把某个编号列记下来当“同名时的备选判据”；assign 同名组的人工指认；backup 导入前是否自动备份。
function confirmClassShift(shift,idColumns,bestColumn,dupGroups,ambiguous){
  return new Promise(resolve=>{
    const ratioText=Math.round(shift.ratio*100);
    const pairs=Object.entries(shift.byClassChange).slice(0,8).map(([k,n])=>`<li class="seat-import-note info">${esc(k)}：${n} 人</li>`).join('');
    const unmatched=(ambiguous&&ambiguous.length)
      ?`<p class="hint"><strong>有 ${ambiguous.length} 个同名的人认不出该是哪一个</strong>（不指认就会作为新学生加入，成绩会挂到新身份上）：${esc(ambiguous.slice(0,6).map(a=>a.name+(a.className?('（'+a.className+'）'):'')).join('、'))}${ambiguous.length>6?' 等':''}</p>`
      :(shift.unmatchedSamples.length
        ?`<p class="hint"><strong>有 ${shift.unmatched} 人没对上</strong>（会作为新学生加入，请确认不是同一个人改了名字）：${esc(shift.unmatchedSamples.join('、'))}${shift.unmatched>shift.unmatchedSamples.length?' 等':''}</p>`
        :'');
    const colList=idColumns.filter(c=>c.comparable>0||c.dup).slice(0,4).map(c=>{
      const bits=[];
      const typeText=(c.types&&c.types.length>1)?(c.family+'（本表列名：'+c.types.join('、')+'）'):(c.types&&c.types[0])||c.family;
      if(c.comparable)bits.push(`可核对 ${c.comparable} 人，一致 ${c.agree} 人（${Math.round(c.ratio*100)}%）`);
      if(c.conflict)bits.push(`不一致 ${c.conflict} 人`);
      if(c.dup)bits.push(`同号重复 ${c.dup} 处`);
      if(c.fileLens&&c.fileLens.length)bits.push(`位数 ${c.fileLens.join('/')}`);
      if(c.overlap)bits.push(`与库里重合 ${Math.round(c.overlap*100)}%`);
      return `<li class="seat-import-note ${(c.ratio>=ID_COLUMN_RATIO&&!c.dup)?'empty':'sparse'}">${esc(typeText)}：${bits.join('，')}${c.verdict?('—— '+esc(c.verdict)):''}</li>`;
    }).join('');
    const groupBlocks=(dupGroups||[]).map(g=>{
      if(g.pairing){
        const pairsText=g.pairing.map(p=>`${esc(p.entry.row.name)}＝${esc(p.student.displayName||p.student.name)}（原${esc(p.student.className||'—')}）`).join('；');
        return `<li class="seat-import-note empty">同名组「${esc(g.name)}」×${g.entries.length}：编号能唯一对上 → ${pairsText}</li>`;
      }
      const rows=g.entries.map(e=>{
        const opts=[`<option value="">（按新学生加入）</option>`].concat(g.candidates.map(s=>
          `<option value="${esc(s.id)}">${esc(s.displayName||s.name)}（原${esc(s.className||'—')}${s.sourceExamId?(' · 编号 '+esc(String(s.sourceExamId))):''}）</option>`)).join('');
        return `<div class="shift-assign"><span>文件里这一行：${esc(e.row.name)}${e.values.length?('（编号 '+esc(e.values.join('/'))+'）'):'（没编号）'}</span><select data-shift-row="${e.rowIndex}">${opts}</select></div>`;
      }).join('');
      return `<li class="seat-import-note sparse">同名组「${esc(g.name)}」×${g.entries.length}：无法自动区分，请指认<div class="shift-assigns">${rows}</div></li>`;
    }).join('');
    const modal=document.createElement('div');
    modal.id='classShiftModal';modal.className='modal-backdrop';
    modal.innerHTML=`<div class="modal-card seat-import-card class-shift-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>这看起来是分班了</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="seat-import-stats">本次导入 ${shift.total} 名学生，其中 ${shift.classChanged} 人的班级与库里不同（占“能对上”学生的 ${ratioText}%）</p>\
${pairs?`<ul class="seat-import-notes">${pairs}</ul>`:''}\
<p class="hint">如果上面不是“整班对整班”地移动，而是乱七八糟的对应，多半是班级列认错了，请点“取消导入”。</p>\
${unmatched}\
<p class="hint">确认后：这些学生<b>按新班级更新</b>（身份编号不变），点名历史、评价、问题记录、头像都会跟着走。</p>\
${colList?`<p class="hint">文件里的编号列与库里的编号比对：</p><ul class="seat-import-notes">${colList}</ul>`:''}\
${bestColumn?`<label class="switch"><span>把「${esc(bestColumn.family)}（本表列名：${esc((bestColumn.types||[]).join("、")||bestColumn.family)}）」这类编号记下来，以后同名时用它辅助认人（一致率 ${Math.round(bestColumn.ratio*100)}%）</span><input type="checkbox" id="shiftAdoptCol" checked></label>`:''}\
${groupBlocks?`<p class="hint">同名学生的核对：</p><ul class="seat-import-notes">${groupBlocks}</ul>`:''}\
<label class="switch"><span>导入前自动下载一份备份（推荐；出问题可以用它恢复）</span><input type="checkbox" id="shiftBackup" checked></label>\
<div class="actions">\
<button class="secondary" id="shiftCancel">取消导入</button>\
<button class="primary" id="shiftOk">确认：按新班级导入</button>\
</div>\
</div>`;
    document.body.appendChild(modal);
    const finish=value=>{modal.remove();resolve(value);};
    modal.querySelector('.modal-close').onclick=()=>finish(null);
    modal.onclick=e=>{if(e.target===modal)finish(null);};
    $('#shiftCancel').onclick=()=>finish(null);
    $('#shiftOk').onclick=()=>{
      const col=$('#shiftAdoptCol'),backup=$('#shiftBackup');
      const assign={};
      $$('#classShiftModal [data-shift-row]').forEach(sel=>{if(sel.value)assign[sel.dataset.shiftRow]=sel.value;});
      finish({adoptType:bestColumn&&col&&col.checked?bestColumn.family:'',assign,backup:Boolean(backup&&backup.checked)});
    };
  });
}
async function clearAll(){if(importBusy){toast('正在保存，请稍候');return;}if(!confirm('确定清除全部学生、考试、历史和设置吗？此操作不可撤销。\n（学生头像也会一起清掉，需要的话请先导出头像包。）'))return;for(const key of ['students','history','settings','absences','meta','exams','examResults','seats','photos'])await DB.clear(key);state.currentClass='';state.candidates=[];await refreshAfterDataImport();toast('本地数据已清除');}

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
    // —— 先识别“这是不是分班” ——
    // 按“人”把本次导入跟库里对一遍（姓名唯一 / 同名时靠编号或班级区分）：
    // 默认**不打断**导入：班级变动立即生效，同时记成一批，之后在对应班级的学生页提示核对/撤销。
    // 只有两种情况才弹窗阻塞：① 有同名行认不出（否则会多出重复学生）② 变动比例 ≥80%（多半是班级列认错了）。
    const incomingRows=entries.flatMap(e=>e.exam.students||[]);
    const auditIndex=studentIdentityIndex(state.students);
    const shift=analyzeClassShift(incomingRows,auditIndex);
    const idColumns=analyzeIdColumns(incomingRows,auditIndex);
    // 建议采纳：整族的“值命中率”够高、无同号重复、且判定为“同一类编号”
    const bestColumn=idColumns.find(c=>c.family&&c.comparable>=ID_COLUMN_MIN_ROWS&&c.ratio>=ID_COLUMN_RATIO&&!c.dup
      &&/同一类编号/.test(c.verdict||''))||null;
    const ambiguous=analyzeAmbiguousRows(incomingRows,auditIndex);
    const groupsNeedingHelp=duplicateNameGroups(incomingRows,auditIndex).filter(g=>!g.pairing&&g.entries.some(e=>!resolveIncomingStudent(e.row,auditIndex)));
    const needDialog=ambiguous.length>0||shift.ratio>=CLASS_SHIFT_BLOCK_RATIO;
    if(needDialog){
      const choice=await confirmClassShift(shift,idColumns,bestColumn,groupsNeedingHelp,ambiguous);
      if(!choice){if(btn){btn.disabled=false;btn.textContent=label;}importBusy=false;toast('已取消导入，数据没有变化');return;}
      if(choice.backup){try{await exportBackup();}catch(err){console.warn('自动备份失败：',err);}}
      if(choice.assign&&Object.keys(choice.assign).length){
        const bound=applyIdentityAssignments(incomingRows,choice.assign,auditIndex,state.students);
        if(bound)toast(`已按你的指认绑定 ${bound} 个人`);
      }
      if(choice.adoptType){
        const touched=adoptIdentityColumn(incomingRows,studentIdentityIndex(state.students),choice.adoptType);
        if(touched.length)await DB.putMany('students',touched);
      }
    }else if(bestColumn){
      // 不打断的情况：编号列够稳就直接记下来（只增不改，可在“设置 → 数据身份”里查看/清除）
      const touched=adoptIdentityColumn(incomingRows,auditIndex,bestColumn.family);
      if(touched.length)await DB.putMany('students',touched);
    }
    // 重复校验以数据库里的考试为准；日期在写库之前就登记，避免并发点击或失败重试时重复导入
    const savedDates=new Set((await DB.all('exams')).map(x=>String(x.date)));
    const studentIndex=new Map(state.students.map(s=>[s.id,s])),mergedStudents=new Map(),newResults=[],newExams=[],skipped=[];
    // 本次导入之前库里就已存在的身份编号：没认出某一行时，绝不允许它撞用这些编号（会并错人、记出假变动）
    const existedIds=new Set(state.students.map(s=>s.id));
    const freshIdCache=new Map();    // 本次导入内，同一个“班级-姓名”的新学生复用同一个新编号
    // 身份索引：新导入的行按“姓名+班级 → 姓名唯一 → 同名时用编号列备选”认到已有的人。
    // 这样分班/改班之后再导入，分数会接到同一个人身上，而不是新建一个重复的学生。
    const identityIndex=studentIdentityIndex(state.students);
    let matchedIdentity=0;
    const classMoveLog=[];           // 本次班级变动明细（写进“班级变动批次”，供班级页核对/撤销）
    let saved=0,recordCount=0,sameNameNew=0;
    for(const entry of entries){
      const date=String(entry.date);
      if(savedDates.has(date)){skipped.push(`${entry.name}（${entry.date}）`);continue;}
      savedDates.add(date);
      const examId=`exam-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      const claimed=new Set();       // **单场考试内**一个学生只能被一行占用（跨考试不限制）
      // 这场考试里同名出现 ≥2 次的名字：此时“库里只有一个同名的人”不足以证明是同一人（见 resolveIncomingStudent）
      const fileDupNames=new Set(),nameSeen=new Set();
      for(const r of entry.exam.students){const k=norm(r.name);if(!k)continue;if(nameSeen.has(k))fileDupNames.add(k);else nameSeen.add(k);}
      for(const incoming of entry.exam.students){
        const known=resolveIncomingStudent(incoming,identityIndex,claimed,fileDupNames);
        if(known&&known.id&&known.id!==incoming.id){
          incoming.id=known.id;                       // 复用已有身份编号（班级以文件里的新班级为准）
          incoming.identityKey=known.id;
          matchedIdentity++;
        }
        if(known&&known.id)claimed.add(known.id);     // 标记为已认领，后面的行不会再抢到同一个人
        if(!known&&fileDupNames.has(norm(incoming.name)))sameNameNew++;   // 文件里同名、库里只有一个 → 按新学生处理，提示里说明
        // 没认出来 = 相对库里这是另一个人：若它的“班级-姓名”编号与库里已有学生重号，必须换号，
        // 否则会静默并进那个人（数据被覆盖）并记出 `7班→2班→7班` 这种来回变动
        if(!known&&existedIds.has(incoming.id)){
          incoming.id=unusedStudentId(incoming.id,id=>studentIndex.has(id),freshIdCache);
          incoming.identityKey=incoming.id;
        }
        const old=studentIndex.get(incoming.id);
        // 把本文件里的编号列并入已有别名（并集，不覆盖；已见过的值不重复登记）
        if(old&&Array.isArray(incoming.ids)&&incoming.ids.length){
          const have=new Set((old.ids||[]).map(x=>x&&String(x.value)));
          incoming.ids=[...(old.ids||[]),...incoming.ids.filter(x=>x&&x.value&&!have.has(String(x.value)))];
        }
        // 班级变了：记一笔班级变更历史（与“调整班级”保持一致，详情页能看到 14班 → 15班）
        if(old){
          const from=normalizeClassName(old.className),to=normalizeClassName(incoming.className);
          if(from&&to&&from!==to){
            incoming.classHistory=appendClassHistory(old,to,new Date().toISOString());
            classMoveLog.push({studentId:old.id,name:old.displayName||old.name,from,to,
              prevHistory:JSON.parse(JSON.stringify(old.classHistory||[]))});
          }
        }
        const merged=old?{...old,...incoming,focus:old.focus===true}:incoming;
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
    // 换过班的学生：从原班座位表里移除（座位属于班级），与“调整班级”行为一致
    let seatSnapshot=null;
    if(classMoveLog.length){
      const movedIds=new Set(classMoveLog.map(m=>m.studentId));
      const movedUids=new Set([...movedIds].map(id=>{const s=mergedStudents.get(id);return s&&s.uid;}).filter(Boolean));
      const layouts=await DB.all('seats');
      const cleared=[],before=[];
      layouts.forEach(layout=>{
        if(!layout||!Array.isArray(layout.seats))return;
        let changed=false;
        const seats=layout.seats.map(seat=>{
          if(!seat||!seat.studentId)return seat;
          if(!movedIds.has(seat.studentId)&&!(seat.studentUid&&movedUids.has(seat.studentUid)))return seat;
          changed=true;
          const next={...seat,studentId:null};
          delete next.studentUid;
          return next;
        });
        if(changed){before.push(layout);cleared.push({...layout,seats,updatedAt:new Date().toISOString()});}
      });
      if(cleared.length)await DB.putMany('seats',cleared);
      seatSnapshot=before.length?before:null;
    }
    // 记成一批“班级变动”：之后在对应班级的学生页可以核对或整批撤销
    if(classMoveLog.length){
      const examNames=[...new Set(entries.map(e=>e.name))].join('、');
      await recordClassChangeBatch({exam:examNames,moves:classMoveLog,layouts:seatSnapshot});
    }
    await refreshAfterDataImport();
    toast(saved?`已保存 ${saved} 场考试、${recordCount} 条记录${matchedIdentity?`（其中 ${matchedIdentity} 条按姓名/班级接到已有学生）`:''}${sameNameNew?`；${sameNameNew} 行与库里的同名但不是同一人（编号/班级对不上），已按新学生加入，请到学生页核对`:''}${classMoveLog.length?`；${classMoveLog.length} 人班级有变化（已记录，可在对应班级核对）`:''}${skipped.length?`；跳过日期重复：${skipped.join('、')}`:''}`:`未保存新考试，日期重复：${skipped.join('、')}`);
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
<h2 class="with-help">导入成绩文件 ${panelHelpBtn('data.import','导入成绩文件的说明')}</h2>\
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
<div class="panel" id="backupPanel">\
<h2 class="with-help">备份与恢复 ${panelHelpBtn('data.backup','备份与恢复的说明')}</h2>\
<div class="actions backup-actions">\
<button class="primary" id="backupNowBtn">立即备份</button>\
<label class="secondary restore-label">导入备份文件<input id="backupInput" type="file" accept=".json,application/json" hidden></label>\
</div>\
</div>\
<div class="panel" id="avatarPanel">\
<h2 class="with-help">学生头像 ${panelHelpBtn('data.avatar','学生头像的说明')}</h2>\
<div class="data-import-actions">\
<label class="secondary restore-label">导入头像包（zip）<input id="avatarZipInput" type="file" accept=".zip,application/zip" hidden></label>\
<button class="secondary" id="avatarManifestBtn">下载本班头像清单模板</button>\
</div>\
</div>\
<div class="panel" id="classPanel">\
<h2 class="with-help">调整班级 ${panelHelpBtn('data.classAdjust','调整班级的说明')}</h2>\
<div class="data-import-actions">\
<button class="primary" id="classAdjustBtn">调整班级…</button>\
</div>\
</div>\
<div class="panel" id="batchPanel">\
<h2 class="with-help">班级变动记录 ${panelHelpBtn('data.batches','班级变动记录的说明')}</h2>\
${classBatchListHtml()}\
</div>\
<div class="panel">\
<h2 class="with-help">清除数据 ${panelHelpBtn('data.clear','清除数据的说明')}</h2>\
<button class="danger" id="clearBtn">清除全部本地数据</button>\
</div>`;
    
  $('#xlsxInput')?.addEventListener('change',handleImport);$('#downloadTemplateBtn')?.addEventListener('click',downloadGradeTemplate);$('#backupNowBtn')?.addEventListener('click',exportBackup);$('#backupInput')?.addEventListener('change',handleRestore);$('#clearBtn')?.addEventListener('click',clearAll);$$('[data-open-exam]').forEach(b=>b.onclick=()=>openExamEditor(b.dataset.openExam));
  $('#avatarZipInput')?.addEventListener('change',handleAvatarZipImport);$('#avatarManifestBtn')?.addEventListener('click',downloadAvatarManifest);
  $('#classAdjustBtn')?.addEventListener('click',openClassAdjust);
  bindClassBatchList();
  bindPanelHelp();
}
