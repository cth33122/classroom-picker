// 点名页：候选取人、点名落库、缺席标记



function recommend(){state.settings.currentDifficulty=state.difficulty;const currentExam=orderedExams()[0];const pool=state.students.filter(s=>s.className===state.currentClass).map(s=>({...s,...(examResult(currentExam,s)||{}),scoreRate:averageScoreRate(s)}));state.candidates=chooseCandidates(pool,state.history,state.absences,{...state.settings,currentDifficulty:state.difficulty});renderRollcall();}

async function selectStudent(id){const s=state.students.find(x=>x.id===id);if(!s)return;await DB.put({studentId:id,at:new Date().toISOString(),difficulty:state.difficulty,className:state.currentClass});state.selectedCandidate=id;await reload();state.selectedCandidate=id;state.candidates=[{student:state.students.find(x=>x.id===id),recentCount:recentHistoryEntries(state.history,id,state.settings).length}];renderRollcall();toast(`已点名：${s.name}`);}

async function markSelectedAbsent(){
  const id=state.selectedCandidate;
  if(!id)return;
  const latest=[...state.history].filter(x=>x.studentId===id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  if(latest?.id!==undefined){await DB.remove('history',latest.id);state.history=state.history.filter(x=>x.id!==latest.id);}
  const absenceId=`${id}-${localDate()}`;
  await DB.put('absences',{id:absenceId,studentId:id,date:localDate()});
  state.absences=state.absences.filter(x=>!(x.studentId===id&&x.date===localDate()));
  state.absences.push({id:absenceId,studentId:id,date:localDate()});
  state.selectedCandidate=null;state.candidates=[];renderRollcall();toast('已撤销本次点名并标记今日缺席');
}

// 设置保存后：已经生成过候选、且尚未选中学生时，立即按新参数重抽一次
function refreshCandidatesAfterSettings(){
  if(state.selectedCandidate||!state.candidates.length)return;
  recommend();
}

function renderRollcall(){
  // 当前班级的座位表尚未加载时，先异步取一次再重绘
  if(state.currentClass&&state.seatClass!==state.currentClass&&!state.seatLoading){
    state.seatLoading=true;
    loadSeatLayout().then(()=>{state.seatLoading=false;renderRollcall();}).catch(()=>{state.seatLoading=false;});
  }
  const inClass=state.students.filter(s=>s.className===state.currentClass),rankMap=averageRankMap(inClass);
  // 候选是生成时的快照，标签等实时状态一律回查当前学生数据；已标记“不参与点名”的从列表里去掉
  const liveOf=c=>state.students.find(x=>x.id===c.student.id)||c.student;
  const visible=state.candidates.filter(c=>c.student.id===state.selectedCandidate||!liveOf(c).noCall);
  const emptyText=state.candidates.length?(visible.length?'':'候选中的学生都已被标记为“不参与点名”。'):'选择难度后生成候选';
  // 候选列数：偶数用 2 列、奇数用 3 列（窄屏会因最小卡片宽度自动降为更少列）
  const candCols=visible.length<=1?1:(visible.length%2===0?2:3);
  // 座位表：无人入座时折叠成一条提示，安排座位后自动展开启用
  const seatedCount=state.seatLayout?state.seatLayout.seats.filter(s=>s.studentId).length:0;
  const seatPanel=seatedCount>0?`<div class="panel seat-panel">\
<div class="seat-panel-head">\
<h3>座位表</h3>\
<div class="seat-panel-actions">\
<select id="seatColorMode" class="seat-color-select" title="座位着色" aria-label="座位着色模式">\
<option value="none">不上色</option>\
<option value="abs">得分率（绝对）</option>\
<option value="pct">得分率（百分位）</option>\
</select>\
<button class="secondary seat-edit-btn" id="editSeatBtn">编辑座位</button>\
</div>\
</div>\
${seatChartHtml()}\
</div>`:`<div class="panel seat-panel seat-panel-collapsed">\
<div class="seat-panel-head">\
<h3>座位表</h3>\
<div class="seat-panel-actions">\
<span class="hint">未安排座位，点“编辑座位”安排后自动启用</span>\
<button class="secondary seat-edit-btn" id="editSeatBtn">编辑座位</button>\
</div>\
</div>\
</div>`;
  $('#view-rollcall').innerHTML=`<div class="rollcall-body">\
${seatPanel}\
${seatedCount>0?'':'<div class="rollcall-gap"></div>'}\
<div class="panel">\
<div class="candidate-panel-head">\
<h3>本次候选</h3>\
<button class="note-link" id="rulesBtn">点名规则介绍</button>\
</div>\
<div class="candidate-list" style="--cand-cols:${candCols}">${visible.length?visible.map(c=>{const live=liveOf(c),avg=averageScoreRate(live),rank=rankMap.get(live.id);return `<button class="candidate ${state.selectedCandidate===live.id?'selected-candidate':''}" data-student="${esc(live.id)}">\
<span>\
<strong>${nameHtml(live,live.displayName||live.name)}${live.focus?' <span class="badge">关注</span>':''}</strong>\
<small>${avg===null?'—':`${(avg*100).toFixed(1)}%`} · 班次 ${rank??'—'}</small>\
<small class="candidate-meta">近期点名次数：${c.recentCount}</small>\
</span>\
</button>`}).join(''):`<div class="empty">${emptyText}</div>`}</div>${visible.length===0&&state.currentClass?`<p class="hint">${String(state.settings.sameDayRepeat)==='allow'?'当天已点名的学生也可以再次进入候选。':'当天已点名的学生不会再次进入候选。'}标记为“不参与点名”的学生不会进入候选。</p>`:''}${state.selectedCandidate?'<div class="selected-actions"><button class="danger change-student" id="markSelectedAbsent">缺席</button><button class="secondary change-student" id="undoCallBtn">撤销</button></div>':''}</div>\
</div>\
<div class="panel hero rollcall-actions">\
<div class="rollcall-actions-head">\
<div class="class-name">${inClass.length?`本班 ${inClass.length} 人`:'还没有学生资料'}</div>\
<div class="question">${state.selectedCandidate?'单击难度按钮继续点名':'选择难度后生成候选'}</div>\
</div>\
<div class="difficulty-buttons">\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===1?'active':''}" data-difficulty="1">简单</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===2?'active':''}" data-difficulty="2">适中</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===3?'active':''}" data-difficulty="3">困难</button>\
</div>\
</div>`;
  $('#rulesBtn').onclick=()=>openRollcallRules();
  $('#editSeatBtn').onclick=()=>openSeatEditor();
  $$('#view-rollcall [data-seat]').forEach(b=>b.onclick=()=>openStudentDetailFromSeat(b.dataset.seat));
  const seatColorSel=$('#seatColorMode');
  if(seatColorSel){seatColorSel.value=state.seatColorMode||'none';seatColorSel.onchange=e=>{state.seatColorMode=e.target.value;renderRollcall();};}
  fitSeatNames();
  requestAnimationFrame(fitSeatNames);
  $$('[data-difficulty]').forEach(b=>b.onclick=()=>{state.difficulty=Number(b.dataset.difficulty);state.selectedCandidate=null;recommend();});$$('.candidate').forEach(b=>b.onclick=()=>selectStudent(b.dataset.student));$('#markSelectedAbsent')?.addEventListener('click',markSelectedAbsent);$('#undoCallBtn')?.addEventListener('click',undoSelectedCall);
}

// 撤销本次点名：删除刚写入的点名记录，并重新生成候选
async function undoSelectedCall(){
  const id=state.selectedCandidate;
  if(!id)return;
  const latest=[...state.history].filter(x=>x.studentId===id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  if(latest?.id!==undefined){
    await DB.remove('history',latest.id);
    state.history=state.history.filter(x=>x.id!==latest.id);
  }
  state.selectedCandidate=null;
  state.candidates=[];
  recommend();
  toast('已撤销本次点名');
}

// 点名规则介绍弹窗
function openRollcallRules(){
  $('#rulesModal')?.remove();
  const allowRepeat=String(state.settings.sameDayRepeat)==='allow';
  const modal=document.createElement('div');
  modal.id='rulesModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card rules-card" role="dialog" aria-modal="true">\
<div class="modal-header">\
<h2>点名规则介绍</h2>\
<button class="icon-button modal-close" aria-label="关闭">×</button>\
</div>\
<div class="rules-body">\
<p><strong>近期点名次数</strong>：统计该生${historyRuleWindow(state.settings.historyRule)}的点名条数，与设置页“近期点名次数统计规则”一致（当前：${historyRuleLabel(state.settings.historyRule)}）。</p>\
<p><strong>抽中权重</strong>：近期被点得越多，抽中权重越低；<strong>近期没有被点到的学生抽中权重会升高</strong>，因此更容易被抽到。特别关注的学生不受“越点越低”的衰减影响，除非手动取消关注。</p>\
<p><strong>当天重复点名</strong>：${allowRepeat?'允许 —— 当天已点过的学生仍可再次进入候选。':'不允许 —— 当天已点过的学生不再进入候选。'}</p>\
<p><strong>其他</strong>：标记为“不参与点名”的学生不会进入候选；成绩靠后的学生（范围见设置页）在近期零次点名时还会获得额外加权。</p>\
</div>\
<div class="actions">\
<button class="primary" id="rulesClose">知道了</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#rulesClose').onclick=close;
  modal.onclick=ev=>{if(ev.target===modal)close();};
}
