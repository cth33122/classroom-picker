// 调整班级：把学生调到别的班 / 整班改名（同一套操作：选人 + 选目标班级）。
//
// 为什么改班级不会丢数据：点名历史、评价、问题、头像、成绩都是按“身份”关联的，
// 班级只是身份上的一个属性；这里只改 className（和显示名、班级变更历史），
// 不动身份编号，所以这些数据会跟着学生走。
//
// 两处附带处理：
//   · 目标班里出现同名时，重新生成显示名（张三(1)/张三(2)…），避免列表里两个人名字一模一样；
//   · 把这些人从原班座位表里移除（座位属于班级，新班要重新排座位）。

let lastClassMove=null;   // 内存里留一份“本次调整前”的快照，支持一步撤销（刷新后失效）

// ========== 班级变动批次：导入成绩时记下来，之后在对应班级页提示核对/撤销 ==========
// 设计：导入**立即生效**（统计、候选、座位都是最新的），同时把“这次谁从哪到哪”记成一批，
// 在“学生页”按班显示提示条：核对无误 / 撤销这批变动（班级、变更历史、座位表一起还原）。
// **核对是按班各算各的**：一批变动会同时出现在它涉及的所有班（转入的班 + 转出的班），
// 一个班点“核对无误”只结束这个班的提示；所有涉及班级都核对完，这批才算完成。
// 撤销始终是整批一起撤（人数、变更历史、座位表一起还原）。
const CLASS_BATCH_KEEP=10;   // 最多保留最近 10 批，避免本地库无限增长
function studentNameOf(id){const s=(state.students||[]).find(x=>x&&x.id===id);return s?(s.displayName||s.name):id;}
// 这批变动涉及哪些班（转入的班 + 转出的班）
function batchClasses(batch){
  const out=new Set();
  ((batch&&batch.moves)||[]).forEach(m=>{
    const from=normalizeClassName(m&&m.from),to=normalizeClassName(m&&m.to);
    if(from)out.add(from);
    if(to)out.add(to);
  });
  return [...out];
}
// 这批变动里已经核对过的班（老数据没有 confirmedClasses：按整批 confirmed 折算）
function batchConfirmedClasses(batch){
  const all=batchClasses(batch);
  if(Array.isArray(batch&&batch.confirmedClasses))return batch.confirmedClasses.map(normalizeClassName).filter(c=>all.includes(c));
  return batch&&batch.confirmed?all:[];
}
function batchDone(batch){
  const all=batchClasses(batch);
  if(!all.length)return true;                                  // 没有涉及任何班 = 没什么要核对的
  const done=batchConfirmedClasses(batch);
  return all.every(c=>done.includes(c));
}
function batchStatusText(batch){
  const all=batchClasses(batch);
  const done=batchConfirmedClasses(batch);
  if(!all.length)return '没有班级变动';
  if(done.length>=all.length)return `已核对（${all.length} 个班）`;
  const left=all.filter(c=>!done.includes(c));
  return `待核对：${left.slice(0,5).join('、')}${left.length>5?' 等':''}（共 ${all.length} 个班）`;
}
async function loadClassBatches(){
  try{
    const rows=await DB.all('meta');
    const rec=rows.find(x=>x&&x.id==='classChanges');
    state.classBatches=Array.isArray(rec&&rec.batches)?rec.batches:[];
  }catch(err){state.classBatches=[];}
  return state.classBatches;
}
async function saveClassBatches(batches){
  const list=(batches||[]).slice(-CLASS_BATCH_KEEP);
  state.classBatches=list;
  try{await DB.put('meta',{id:'classChanges',batches:list});}catch(err){console.warn('班级变动记录保存失败：',err);}
  return list;
}
// moves: [{studentId,name,from,to,prevHistory}]；layouts: 被清过座位的座位表快照（撤销时还原）
async function recordClassChangeBatch({exam,moves,layouts}){
  if(!moves||!moves.length)return null;
  const batch={id:'batch-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),at:new Date().toISOString(),
    exam:exam||'',moves,layouts:(layouts&&layouts.length)?layouts:null,confirmed:false,confirmedClasses:[]};
  await saveClassBatches((state.classBatches||[]).concat([batch]));
  return batch;
}
// 某个班待核对的变动（转入 + 转出），按批返回。本班已核对过的批次不再返回，
// 但同一批里别的班没核对完时，别的班照样还会看到提示。
function classChangePending(cls){
  const target=normalizeClassName(cls);
  const out=[];
  (state.classBatches||[]).forEach(b=>{
    if(!b)return;
    if(batchConfirmedClasses(b).includes(target))return;      // 本班已经核对过
    const into=(b.moves||[]).filter(m=>normalizeClassName(m.to)===target);
    const outOf=(b.moves||[]).filter(m=>normalizeClassName(m.from)===target);
    if(into.length||outOf.length)out.push({batch:b,into,outOf});
  });
  return out;
}
// 学生页顶部的提示条（该班没有待核对变动时返回空串）
function classChangeBannerHtml(cls){
  const pend=classChangePending(cls);
  if(!pend.length)return '';
  const total=pend.reduce((n,p)=>n+p.into.length+p.outOf.length,0);
  const lines=pend.map(p=>{
    const at=String(p.batch.at||'').slice(0,10);
    // 每一批（=一次导入/一场考试）自成一个块：第一行只放“考试名 · 日期”，
    // 下面一行起罗列转入/转出；多次考试变动就按批依次往下排（各自带按钮）。
    // “转入 N 人 / 转出 N 人”用红色，名单照常普通颜色
    const nameList=(list)=>esc(list.slice(0,8).join('、'))+(list.length>8?' 等':'');
    const intoNames=p.into.map(m=>studentNameOf(m.studentId)+(m.from?`（原${m.from}）`:''));
    const outNames=p.outOf.map(m=>studentNameOf(m.studentId)+'→'+m.to);
    const intoBlock=p.into.length?`<span class="class-change-move"><b class="move-label">转入 ${p.into.length} 人</b>：${nameList(intoNames)}</span>`:'';
    const outBlock=p.outOf.length?`<span class="class-change-move"><b class="move-label">转出 ${p.outOf.length} 人</b>：${nameList(outNames)}</span>`:'';
    // 同一批里还没核对的其它班：让老师知道“核对无误”只结束本班，别以为整批都过了
    const here=normalizeClassName(cls);
    const others=batchClasses(p.batch).filter(c=>c!==here&&!batchConfirmedClasses(p.batch).includes(c));
    const othersHtml=others.length?`<p class="hint">这批变动还涉及 ${esc(others.slice(0,6).join('、'))}${others.length>6?' 等':''}（还有 ${others.length} 个班待核对，在“数据 → 班级变动记录”里可以整批核对）</p>`:'';
    return `<div class="class-change-line">\
<div class="class-change-exam">${esc(p.batch.exam||'成绩导入')} · ${esc(at)}</div>\
<div class="class-change-text">${intoBlock}${outBlock}</div>\
${othersHtml}\
<div class="class-change-actions">\
<button type="button" class="secondary class-change-btn" data-batch-confirm="${esc(p.batch.id)}" data-batch-class="${esc(here)}">本班核对无误</button>\
<button type="button" class="secondary class-change-btn" data-batch-undo="${esc(p.batch.id)}">撤销这批变动</button>\
</div>\
</div>`;
  }).join('');
  return `<div class="panel class-change-panel">\
<h3>本班班级变动 <span class="badge">${total}</span></h3>\
<p class="hint">最近导入成绩时，这些学生的班级发生了变化（已生效）。确认本班没问题就点“本班核对无误”（<strong>其它班的提示不会跟着消失</strong>，需要到那些班各自核对，或在“数据 → 班级变动记录”里整批核对）；如果这次变动不对，可以撤销——班级、班级变更历史、座位表会一起还原。</p>\
${lines}\
</div>`;
}
// 核对无误：cls 传了就是“只核对这个班”，不传就是“整批核对”
async function confirmClassChangeBatch(id,cls){
  const target=cls?normalizeClassName(cls):'';
  await saveClassBatches((state.classBatches||[]).map(b=>{
    if(!b||b.id!==id)return b;
    const all=batchClasses(b);
    const done=batchConfirmedClasses(b);
    const next=target?done.concat([target]).filter(c=>all.includes(c)):[...all];
    const uniq=[...new Set(next)];
    return {...b,confirmedClasses:uniq,confirmed:batchDone({...b,confirmedClasses:uniq}),confirmedAt:new Date().toISOString()};
  }));
  const after=(state.classBatches||[]).find(b=>b&&b.id===id);
  const left=after?batchClasses(after).filter(c=>!batchConfirmedClasses(after).includes(c)):[];
  render();
  if(!left.length)toast('这批班级变动已全部核对完');
  else if(target)toast(`已核对 ${target}；还有 ${left.length} 个班待核对（${left.slice(0,4).join('、')}${left.length>4?' 等':''}）`);
  else toast('已整批核对无误');
}
// 撤销一批变动：班级改回原样 + 变更历史还原 + 座位表还原。
// 这些人后来又变过班的（例如后面又导入了一次成绩、或手动调过班）会被跳过，避免把新数据改坏。
async function undoClassChangeBatch(id){
  const batch=(state.classBatches||[]).find(b=>b&&b.id===id);
  if(!batch){toast('这批变动已经不在了');return false;}
  const restore=[],stale=[];
  (batch.moves||[]).forEach(m=>{
    const s=(state.students||[]).find(x=>x&&x.id===m.studentId);
    if(!s)return;
    if(normalizeClassName(s.className)!==normalizeClassName(m.to)){stale.push(m);return;}
    restore.push({m,s});
  });
  if(!restore.length&&!stale.length){toast('这批变动里的人都找不到了');return false;}
  const msg=[`撤销这批班级变动？`,'',`${restore.length} 人会回到原来的班级。`];
  if(stale.length)msg.push(`另有 ${stale.length} 人后来班级又变过（${stale.slice(0,3).map(m=>studentNameOf(m.studentId)).join('、')}${stale.length>3?' 等':''}），这次跳过他们，座位表也不还原（免得盖掉后来的安排）。`);
  else if(batch.layouts&&batch.layouts.length)msg.push('座位表会一起还原。');
  if(!confirm(msg.join('\n')))return false;
  for(const {m,s} of restore){
    s.className=m.from||s.className;
    if(m.prevHistory!==undefined)s.classHistory=JSON.parse(JSON.stringify(m.prevHistory));
    await DB.put('students',s);
  }
  if(!stale.length&&batch.layouts&&batch.layouts.length)await DB.putMany('seats',batch.layouts);
  await saveClassBatches((state.classBatches||[]).filter(b=>!b||b.id!==id));
  render();
  toast(stale.length?`已撤销 ${restore.length} 人的班级变动（跳过 ${stale.length} 人）`:'已撤销这批班级变动');
  return true;
}
// 学生页接线：核对（只核对本班）/ 撤销（整批）
function bindClassChangeBanner(){
  $$('#view-students [data-batch-confirm]').forEach(b=>b.onclick=()=>confirmClassChangeBatch(b.dataset.batchConfirm,b.dataset.batchClass));
  $$('#view-students [data-batch-undo]').forEach(b=>b.onclick=()=>undoClassChangeBatch(b.dataset.batchUndo));
}
// ========== “数据 → 班级变动记录”：最近若干批的清单（含已核对），可整批核对 / 撤销 ==========
function classBatchListHtml(){
  const batches=(state.classBatches||[]).slice().reverse();   // 新的排前面
  if(!batches.length)return '<div class="empty">还没有班级变动记录</div>';
  return batches.map(b=>{
    const moves=(b&&b.moves)||[];
    const all=batchClasses(b);
    const done=batchConfirmedClasses(b);
    const isDone=batchDone(b);
    const at=String((b&&b.at)||'').slice(0,10);
    const clsLines=all.map(c=>{
      const intoCount=moves.filter(m=>normalizeClassName(m.to)===c).length;
      const outCount=moves.filter(m=>normalizeClassName(m.from)===c).length;
      const ok=done.includes(c);
      const bits=[intoCount?`转入 ${intoCount} 人`:'',outCount?`转出 ${outCount} 人`:''].filter(Boolean).join('、');
      return `<li class="batch-class-line${ok?' is-done':''}"><span class="batch-class-name">${esc(c)}</span><span class="hint">${bits}${ok?' · 已核对':''}</span></li>`;
    }).join('');
    return `<details class="batch-item">\
<summary>\
<span class="batch-main">\
<strong class="batch-title">${esc((b&&b.exam)||'成绩导入')} · ${esc(at)}</strong>\
<small class="hint">${moves.length} 人班级变化 · 涉及 ${all.length} 个班 · ${esc(batchStatusText(b))}</small>\
</span>\
<span class="badge${isDone?'':' batch-badge-pending'}">${isDone?'已核对':'待核对'}</span>\
</summary>\
<ul class="batch-class-list">${clsLines}</ul>\
<div class="class-change-actions">\
${isDone?'':`<button type="button" class="secondary class-change-btn" data-batch-confirm-all="${esc(b.id)}">整批核对无误</button>`}\
<button type="button" class="secondary class-change-btn" data-batch-undo="${esc(b.id)}">撤销这批变动</button>\
</div>\
</details>`;
  }).join('');
}
function bindClassBatchList(){
  $$('#view-data [data-batch-confirm-all]').forEach(b=>b.onclick=()=>confirmClassChangeBatch(b.dataset.batchConfirmAll));
  $$('#view-data [data-batch-undo]').forEach(b=>b.onclick=()=>undoClassChangeBatch(b.dataset.batchUndo));
}

function classList(){return classes();}

// 执行调整：ids 是学生 id 列表，targetClass 是目标班级名
async function applyClassMove(ids,targetClass,when){
  const target=normalizeClassName(targetClass)||String(targetClass||'').trim();
  if(!target){toast('请先填写目标班级');return null;}
  const chosen=[...new Set(ids||[])].map(id=>state.students.find(s=>s.id===id)).filter(Boolean);
  if(!chosen.length){toast('请先勾选要调整的学生');return null;}
  const moving=chosen.filter(s=>s.className!==target);
  if(!moving.length){toast(`选中的学生已经在 ${target} 了`);return null;}
  const fromClasses=[...new Set(moving.map(s=>s.className))];
  const before=moving.map(s=>({id:s.id,className:s.className,classHistory:JSON.parse(JSON.stringify(s.classHistory||[])),displayName:s.displayName}));
  const at=when||new Date().toISOString();

  // 1) 改班级 + 记班级变更历史（身份编号不动）
  for(const s of moving){
    const history=appendClassHistory(s,target,at);
    s.className=target;
    s.classHistory=history;
    await DB.put('students',s);
  }
  // 2) 目标班里同名的显示名重新编号（只影响显示文本）
  const inTarget=state.students.filter(s=>s.className===target);
  const groups=new Map();
  inTarget.forEach(s=>{const k=norm(s.name);const arr=groups.get(k)||[];arr.push(s);groups.set(k,arr);});
  const touched=[];
  for(const arr of groups.values()){
    arr.sort((a,b)=>String(a.uid||a.id).localeCompare(String(b.uid||b.id)));
    arr.forEach((s,i)=>{
      const want=arr.length>1?`${s.name}(${i+1})`:s.name;
      if(s.displayName!==want){s.displayName=want;touched.push(s);}
    });
  }
  if(touched.length)await DB.putMany('students',touched);

  // 3) 从所有座位表里移除这些人（他们已不在原班）
  const movingIds=new Set(moving.map(s=>s.id));
  const movedUids=new Set(moving.map(s=>s.uid).filter(Boolean));
  const layouts=await DB.all('seats');
  const clearedLayouts=[],layoutBefore=[];
  let clearedSeats=0;
  for(const layout of layouts){
    if(!layout||!Array.isArray(layout.seats))continue;
    let changed=false;
    const seats=layout.seats.map(seat=>{
      if(!seat||!seat.studentId)return seat;
      if(!movingIds.has(seat.studentId)&&!(seat.studentUid&&movedUids.has(seat.studentUid)))return seat;
      changed=true;clearedSeats++;
      const next={...seat,studentId:null};
      delete next.studentUid;
      return next;
    });
    if(changed){
      layoutBefore.push(layout);                                  // 撤销时整条还原
      clearedLayouts.push({...layout,seats,updatedAt:new Date().toISOString()});
    }
  }
  if(clearedLayouts.length)await DB.putMany('seats',clearedLayouts);

  lastClassMove={at,from:fromClasses,target,before,layoutBefore,clearedSeats};
  render();
  return {moved:moving,from:fromClasses,target,clearedSeats,lastClassMove};
}
// 一步撤销：把班级、班级变更历史、显示名还原回去，并还原被清空的座位
async function undoClassMove(){
  const snap=lastClassMove;
  if(!snap){toast('没有可撤销的调整');return false;}
  for(const b of snap.before){
    const s=state.students.find(x=>x.id===b.id);
    if(!s)continue;
    s.className=b.className;
    s.classHistory=b.classHistory;
    if(b.displayName!==undefined)s.displayName=b.displayName;
    await DB.put('students',s);
  }
  if(snap.layoutBefore&&snap.layoutBefore.length)await DB.putMany('seats',snap.layoutBefore);
  lastClassMove=null;
  render();
  toast('已撤销这次班级调整');
  return true;
}

// ---------- 向导界面 ----------
function closeClassAdjust(){document.getElementById('classAdjustModal')?.remove();}
function openClassAdjust(){
  closeClassAdjust();
  const all=classList();
  const source=all.includes(state.currentClass)?state.currentClass:(all[0]||'');
  if(!all.length){toast('还没有学生，先导入名册或成绩');return;}
  const modal=document.createElement('div');
  modal.id='classAdjustModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card class-adjust-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>调整班级</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="hint">勾选学生 → 选目标班级 → 确认。点名历史、评价、问题、头像都会跟着学生走；原班座位表里这些人会被移除。</p>\
<div class="field">\
<label>从哪个班调整</label>\
<select id="caSource">${all.map(c=>`<option value="${esc(c)}" ${c===source?'selected':''}>${esc(c)}</option>`).join('')}</select>\
</div>\
<div class="ca-toolbar">\
<button type="button" class="secondary" id="caAll">全选</button>\
<button type="button" class="secondary" id="caNone">清空</button>\
<span class="hint" id="caCount"></span>\
</div>\
<div class="ca-list" id="caList"></div>\
<div class="field">\
<label>调到哪个班</label>\
<select id="caTarget">${all.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="__new">＋ 新班级名…</option></select>\
</div>\
<div class="field" id="caNewWrap" style="display:none">\
<label>新班级名</label>\
<input id="caNewClass" placeholder="例如 15班">\
</div>\
<div class="actions">\
<button class="secondary" id="caCancel">取消</button>\
<button class="primary" id="caApply">确认调整</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#caCancel').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  const listBox=$('#caList');
  const renderList=()=>{
    const cls=$('#caSource').value;
    const rows=state.students.filter(s=>s.className===cls).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN'));
    const callCount=new Map();
    (state.history||[]).forEach(h=>callCount.set(h.studentId,(callCount.get(h.studentId)||0)+1));
    listBox.innerHTML=rows.length?rows.map(s=>`<label class="ca-row">\
<input type="checkbox" data-ca-id="${esc(s.id)}">\
<span class="ca-name">${esc(s.displayName||s.name)}</span>\
<span class="hint">点名 ${callCount.get(s.id)||0} 次</span>\
</label>`).join(''):'<div class="empty">这个班没有学生</div>';
    syncCount();
  };
  const syncCount=()=>{$('#caCount').textContent=`已选 ${$$('#caList input[type=checkbox]:checked').length} / ${$$('#caList input[type=checkbox]').length} 人`;};
  $('#caSource').onchange=renderList;
  $('#caTarget').onchange=()=>{
    const isNew=$('#caTarget').value==='__new';
    $('#caNewWrap').style.display=isNew?'':'none';
  };
  $('#caAll').onclick=()=>{$$('#caList input[type=checkbox]').forEach(i=>i.checked=true);syncCount();};
  $('#caNone').onclick=()=>{$$('#caList input[type=checkbox]').forEach(i=>i.checked=false);syncCount();};
  listBox.addEventListener('change',syncCount);
  $('#caApply').onclick=async()=>{
    const ids=$$('#caList input[type=checkbox]:checked').map(i=>i.dataset.caId);
    if(!ids.length){toast('请先勾选学生');return;}
    const sel=$('#caTarget').value;
    const target=sel==='__new'?$('#caNewClass').value.trim():sel;
    if(!target){toast('请填写新班级名');return;}
    const from=$('#caSource').value;
    if(normalizeClassName(target)===(from)){toast('目标班级和当前班级一样');return;}
    if(!confirm(`把 ${ids.length} 名学生从 ${from} 调整到 ${normalizeClassName(target)}？\n\n点名历史、评价、问题、头像会跟着学生走；他们从 ${from} 的座位表里移除。`))return;
    const btn=$('#caApply');btn.disabled=true;btn.textContent='正在调整…';
    try{
      const res=await applyClassMove(ids,target);
      close();
      if(res)showClassMoveResult(res);
    }catch(err){
      btn.disabled=false;btn.textContent='确认调整';
      toast('调整失败：'+err.message);
    }
  };
  $('#caTarget').onchange();
  renderList();
}
// 调整结果卡：说明数据去向 + 一步撤销
function showClassMoveResult(res){
  document.getElementById('classMoveResult')?.remove();
  const fromText=res.from.join('、');
  const modal=document.createElement('div');
  modal.id='classMoveResult';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card seat-import-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>班级调整完成</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="seat-import-stats">已把 ${res.moved.length} 人从 ${esc(fromText)} 调整到 ${esc(res.target)}</p>\
<ul class="seat-import-notes">\
<li class="seat-import-note info">点名历史、评价、问题记录、头像都跟着学生走了（数据按身份关联，不随班级变化）</li>\
${res.clearedSeats?`<li class="seat-import-note empty">已把他们从原班座位表移除（共 ${res.clearedSeats} 个座位），${esc(res.target)} 需要重新安排座位</li>`:''}\
<li class="seat-import-note info">以后导入 ${esc(res.target)} 的成绩时，会按学号/姓名认出这些人，不会再新建重复的学生</li>\
</ul>\
<div class="actions">\
<button class="secondary" id="classMoveUndo">撤销这次调整</button>\
<button class="primary" id="classMoveOk">知道了</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#classMoveOk').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  $('#classMoveUndo').onclick=async()=>{const ok=await undoClassMove();if(ok)close();};
}
