// 统计页：时间线/次数/难度统计与排序

// Replace legacy settings renderer so removed probability models cannot be edited.
// Updated compact roll-call view: show latest exam score, while the algorithm uses weighted recent averages.

function historyScope(){return state.students.filter(s=>s.className===state.currentClass);}

// 学生姓名旁的标签（关注 / 不参与点名），与点名页、学生页保持一致
function studentTags(s){
  if(!s)return '';
  return `${s.focus?' <span class="badge">关注</span>':''}${s.noCall?' <span class="badge no-call-badge">不参与点名</span>':''}`;
}

function renderHistory(){
  const classStudents=historyScope(),timeline=statsFilteredHistory(),mode=state.statsMode==='counts'?'counts':'timeline',ids=new Set(classStudents.map(s=>s.id));
  const counts=new Map();timeline.forEach(x=>counts.set(x.studentId,(counts.get(x.studentId)||0)+1));const lastCall=new Map();timeline.forEach(x=>{if(!lastCall.has(x.studentId))lastCall.set(x.studentId,x.at);});const sort=state.historySort||{key:mode==='counts'?'count':'at',direction:'desc'},factor=sort.direction==='asc'?1:-1;
  // 日期列按真实时间戳排序（从未点名记为 0，排在最后），不再受显示文本影响
  const lastCallTime=id=>{const at=lastCall.get(id);const t=at?Date.parse(at):NaN;return Number.isFinite(t)?t:0;};
  const rows=[...classStudents].sort((a,b)=>{const va=sort.key==='count'?(counts.get(a.id)||0):sort.key==='date'?lastCallTime(a.id):(a.name||''),vb=sort.key==='count'?(counts.get(b.id)||0):sort.key==='date'?lastCallTime(b.id):(b.name||'');return(typeof va==='string'?va.localeCompare(vb,'zh-CN'):va-vb)*factor;});
  const ordered=[...timeline].sort((a,b)=>{const sa=classStudents.find(s=>s.id===a.studentId),sb=classStudents.find(s=>s.id===b.studentId),va=sort.key==='name'?(sa?.name||a.studentId):sort.key==='difficulty'?Number(a.difficulty):Date.parse(a.at),vb=sort.key==='name'?(sb?.name||b.studentId):sort.key==='difficulty'?Number(b.difficulty):Date.parse(b.at);return(typeof va==='string'?va.localeCompare(vb,'zh-CN'):va-vb)*factor;});
  const difficultyCounts=[1,2,3].map(level=>timeline.filter(x=>Number(x.difficulty)===level).length),f=state.historyFilter||'all',options=[['all','总计'],['calls20','近20次点名'],['calls30','近30次点名'],['calls50','近50次点名'],['week','近1周'],['twoWeeks','近2周'],['month','近1月'],['twoMonths','近2月'],['threeMonths','近3月']],arrow=k=>sortArrow(sort.key===k,sort.direction);
  const nav=`<div class="stats-switch"><button class="secondary ${mode==='counts'?'active':''}" id="countsBtn">点名统计</button><button class="secondary ${mode==='timeline'?'active':''}" id="timelineBtn">点名记录</button></div>`;
  // 题目难度统计已并入“点名记录”，固定显示在记录列表上方
  // 题目难度统计：图注已经画进画布里，外部不再放文字
  const difficultyPanel=`<div class="panel difficulty-stats"><h2 class="history-section-title">题目难度统计</h2><div class="difficulty-chart"><canvas id="difficultyChart"></canvas></div></div>`;
  // 统计范围与合计点名次数在同一行
  const statsRow=`<div class="grid">\
<div class="field">\
<label>统计范围</label>\
<select id="historyFilter">${options.map(([v,l])=>`<option value="${v}" ${v===f?'selected':''}>${l}</option>`).join('')}</select>\
</div>\
<div class="field">\
<label>合计点名次数</label>\
<input disabled value="${timeline.length}">\
</div>\
</div>`;
  let body='';
  if(mode==='timeline') body=`${difficultyPanel}<div class="panel">\
<h2 class="history-section-title">点名记录</h2>\
<div class="table-header history-timeline-header">\
<button data-history-sort="name">姓名${arrow('name')}</button>\
<button data-history-sort="at">时间戳${arrow('at')}</button>\
<button data-history-sort="difficulty">难度${arrow('difficulty')}</button>\
<span>评价</span>\
<span>删除</span>\
</div>${ordered.length?ordered.map(x=>{const s=classStudents.find(st=>st.id===x.studentId);const q=String(x.question||'').trim();const rowId='historyRow-'+String(x.id).replace(/[^\w-]/g,'');const qid=esc(String(x.id));return `<div class="stat-row history-timeline-row" id="${rowId}">\
<span>\
<button class="student-link" data-history-student="${esc(x.studentId)}">${esc(s?.displayName||s?.name||x.studentId)}</button>${studentTags(s)}\
</span>\
<span>${new Date(x.at).toLocaleString()}</span>\
<span>${['','简单','适中','困难'][x.difficulty]||'—'}</span>\
<span class="history-eval-cell"><button type="button" class="history-eval-btn${x.eval?' is-'+x.eval:''}" data-history-eval="${qid}" title="${x.eval?(x.eval==='good'?'😊 满意 · 点击改为 😢':'😢 不满意 · 点击取消评价'):'点击记为 😊 满意'}">${x.eval?evalLabel(x.eval):'—'}</button></span>\
<span><button type="button" class="history-del-btn" data-del-history="${qid}" title="删除这条点名记录">删除</button></span>\
</div>\
<div class="history-q-row${q?'':' is-empty'}" data-history-question="${qid}" title="${q?'点击编辑这次的问题记录':'点击记录这次的问题'}">${q?esc(questionSummary(q,60)):'＋ 记录本次问题'}</div>`}).join(''):'<div class="empty">暂无点名记录</div>'}</div>`;
    
  else body=`<div class="panel">\
<h2 class="history-section-title">点名统计</h2>\
<div class="table-header history-counts-header">\
<button data-history-sort="name">学生${arrow('name')}</button>\
<button data-history-sort="count">点名次数${arrow('count')}</button>\
<button data-history-sort="date">日期${arrow('date')}</button>\
<span>详情</span>\
</div>${rows.length?rows.map(s=>`<div class="stat-row history-counts-row">\
<span>\
<button class="student-link" data-history-student="${esc(s.id)}">${esc(s.displayName||s.name)}</button>${studentTags(s)}\
</span>\
<span>${counts.get(s.id)||0}次</span>\
<span>${lastCall.has(s.id)?relativeCallTime(lastCall.get(s.id)):'未点名'}</span>\
<span><button type="button" class="student-link question-detail-link" data-student-questions="${esc(s.id)}" title="查看该生的问题记录">详情</button></span>\
</div>`).join(''):'<div class="empty">本班暂无学生</div>'}</div>`;
    
  $('#view-history').innerHTML=`<div class="panel">${nav}${statsRow}</div>${body}`;
  if(mode==='timeline')drawDifficultyPie(difficultyCounts);
    $('#historyFilter').onchange=e=>{state.historyFilter=e.target.value;renderHistory();};
    $('#timelineBtn').onclick=()=>{state.statsMode='timeline';state.historySort={key:'at',direction:'desc'};renderHistory();};
    $('#countsBtn').onclick=()=>{state.statsMode='counts';state.historySort={key:'count',direction:'desc'};renderHistory();};
    $$('[data-history-sort]').forEach(b=>b.onclick=()=>toggleHistorySort(b.dataset.historySort));
    // 评价列：点“—”记为 😊 → 再点变 😢 → 再点取消（三态循环，写库后重绘）
    $$('[data-history-eval]').forEach(b=>b.onclick=async()=>{
      const rec=state.history.find(x=>String(x.id)===String(b.dataset.historyEval));
      if(!rec){toast('这条记录已不存在');renderHistory();return;}
      const next=!rec.eval?'good':(rec.eval==='good'?'bad':null);
      await saveHistoryReview(rec,{eval:next});
      toast(next?(next==='good'?'已记为 😊 满意':'已记为 😢 不满意'):'已取消这条的评价');
      renderHistory();
      refreshRollcallAfterReview();
    });
    // 每条记录下方的问题栏：打开全屏问题记录弹窗，并定位到这一条
    $$('[data-history-question]').forEach(el=>el.onclick=()=>{
      const rec=state.history.find(x=>String(x.id)===String(el.dataset.historyQuestion));
      if(!rec){toast('这条记录已不存在');renderHistory();return;}
      openStudentQuestions(rec.studentId,{focusId:rec.id,onClose:()=>renderHistory()});
    });
    // “详情”按钮：打开该生的问题记录弹窗（停在最新一条）
    $$('[data-student-questions]').forEach(b=>b.onclick=()=>openStudentQuestions(b.dataset.studentQuestions,{onClose:()=>renderHistory()}));
    // 删除单条点名记录
    $$('[data-del-history]').forEach(b=>b.onclick=async()=>{
      const raw=b.dataset.delHistory;
      const rec=state.history.find(x=>String(x.id)===raw);
      if(!rec){toast('这条记录已不存在');renderHistory();return;}
      const stu=state.students.find(s=>s.id===rec.studentId);
      if(!confirm(`确定删除这条点名记录吗？\n${stu?(stu.displayName||stu.name):rec.studentId} · ${new Date(rec.at).toLocaleString()}`))return;
      const hv=$('#view-history'),hs=hv?hv.scrollTop:0;
      await DB.remove('history',rec.id);
      state.history=state.history.filter(x=>String(x.id)!==raw);
      renderHistory();
      const rv=$('#view-rollcall'),rs=rv?rv.scrollTop:0;
      if(state.view==='rollcall')renderRollcall();
      if(rv)rv.scrollTop=rs;
      if(hv)hv.scrollTop=hs;
      if(state.studentDetail)renderStudentDetail(state.studentDetail);
      toast('已删除该条点名记录');
    });
    // 点学生姓名 → 直接进入该生的详情页（成绩记录 + 点名记录合并显示）
    $$('[data-history-student]').forEach(b=>b.onclick=()=>{state.historyStudentId='';state.studentDetailFrom=state.view||'history';state.studentDetail=b.dataset.historyStudent;state.studentExamExpand=false;renderStudents();goToView('students');scrollViewTop('students');});
    
}

function statsFilteredHistory(){
  const all=[...state.history].filter(x=>state.students.some(s=>s.id===x.studentId&&(!state.currentClass||s.className===state.currentClass))).sort((a,b)=>String(b.at).localeCompare(String(a.at))),rule=state.historyFilter||'all';
  if(rule.startsWith('calls'))return all.slice(0,Number(rule.slice(5))||20);
  if(rule==='all')return all;
  const days={week:7,twoWeeks:14,month:30,twoMonths:60,threeMonths:90}[rule]||0,cutoff=Date.now()-days*86400000;return all.filter(x=>Date.parse(x.at)>=cutoff);
}

function toggleHistorySort(key){const current=state.historySort||{key:'at',direction:'desc'};state.historySort=current.key===key?{key,direction:current.direction==='desc'?'asc':'desc'}:{key,direction:'desc'};renderHistory();}
