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
  const inClass=state.students.filter(s=>s.className===state.currentClass),rankMap=averageRankMap(inClass);
  // 候选是生成时的快照，标签等实时状态一律回查当前学生数据；已标记“不点名”的从列表里去掉
  const liveOf=c=>state.students.find(x=>x.id===c.student.id)||c.student;
  const visible=state.candidates.filter(c=>c.student.id===state.selectedCandidate||!liveOf(c).noCall);
  const emptyText=state.candidates.length?(visible.length?'':'候选中的学生都已被标记为“不点名”。'):'选择难度后生成候选';
  $('#view-rollcall').innerHTML=`<div class="panel hero">\
<div class="class-name">${inClass.length?`本班 ${inClass.length} 人`:'还没有学生资料'}</div>\
<div class="difficulty-buttons">\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===1?'active':''}" data-difficulty="1">简单</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===2?'active':''}" data-difficulty="2">适中</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===3?'active':''}" data-difficulty="3">困难</button>\
</div>\
<div class="question">${state.selectedCandidate?'单击难度按钮继续点名':'选择难度后生成候选'}</div>\
</div>\
<div class="panel">\
<h2>本次候选</h2>\
<div class="candidate-list">${visible.length?visible.map(c=>{const live=liveOf(c),avg=averageScoreRate(live),rank=rankMap.get(live.id);return `<button class="candidate ${state.selectedCandidate===live.id?'selected-candidate':''}" data-student="${esc(live.id)}">\
<span>\
<strong>${esc(live.displayName||live.name)}${live.focus?' <span class="badge">关注</span>':''}</strong>\
<small>${avg===null?'—':`${(avg*100).toFixed(1)}%`} · 班次 ${rank??'—'}</small>\
</span>\
<span class="score">近期点名次数：${c.recentCount}</span>\
</button>`}).join(''):`<div class="empty">${emptyText}</div>`}</div>${visible.length===0&&state.currentClass?`<p class="hint">${String(state.settings.sameDayRepeat)==='allow'?'当天已点名的学生也可以再次进入候选。':'当天已点名的学生不会再次进入候选。'}标记为“不点名”的学生不参与抽选。</p>`:''}${state.selectedCandidate?'<button class="danger change-student" id="markSelectedAbsent">缺席</button>':''}</div>`;
    
  const hint=document.createElement('p');
  hint.className='hint rollcall-hint';
  const allowRepeat=String(state.settings.sameDayRepeat)==='allow';
  hint.textContent=`近期点名次数 = 该生${historyRuleWindow(state.settings.historyRule)}的条数，规则与设置页“近期点名次数统计规则”一致（当前：${historyRuleLabel(state.settings.historyRule)}）。近期被点得越多，抽中权重越低；特别关注的学生不受该衰减影响。当天允许重复点名：${allowRepeat?'是':'否'}（${allowRepeat?'已点名的学生当天仍可再次进入候选':'已点名的学生当天不再进入候选'}）；标记为“不点名”的学生不参与抽选。`;
  $('#view-rollcall').appendChild(hint);
  $$('[data-difficulty]').forEach(b=>b.onclick=()=>{state.difficulty=Number(b.dataset.difficulty);state.selectedCandidate=null;recommend();});$$('.candidate').forEach(b=>b.onclick=()=>selectStudent(b.dataset.student));$('#markSelectedAbsent')?.addEventListener('click',markSelectedAbsent);
}
