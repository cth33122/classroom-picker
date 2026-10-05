// 统计页：时间线/次数/难度统计与排序

// Replace legacy settings renderer so removed probability models cannot be edited.
// Updated compact roll-call view: show latest exam score, while the algorithm uses weighted recent averages.

function historyScope(){return state.students.filter(s=>s.className===state.currentClass);}

function renderHistory(){
  const classStudents=historyScope(),timeline=statsFilteredHistory(),mode=state.statsMode||'timeline',ids=new Set(classStudents.map(s=>s.id));
  if(state.historyStudentId){const s=classStudents.find(x=>x.id===state.historyStudentId),records=timeline.filter(x=>x.studentId===state.historyStudentId);$('#view-history').innerHTML=`<div class="panel">\
<button class="secondary" id="backHistory">返回统计</button>\
<h2>${esc(s?.displayName||s?.name||'学生')}</h2>\
</div>\
<div class="panel">\
<div class="table-header history-record-header">\
<span>时间戳</span>\
<span>难度</span>\
<span>班级</span>\
</div>${records.length?records.map(x=>`<div class="stat-row history-row">\
<span>${new Date(x.at).toLocaleString()}</span>\
<span>${['','简单','适中','困难'][x.difficulty]||'—'}</span>\
<span>${esc(x.className||'')}</span>\
</div>`).join(''):'<div class="empty">暂无点名记录</div>'}</div>`;$('#backHistory').onclick=()=>{state.historyStudentId='';renderHistory();};return;}
  const counts=new Map();timeline.forEach(x=>counts.set(x.studentId,(counts.get(x.studentId)||0)+1));const lastCall=new Map();timeline.forEach(x=>{if(!lastCall.has(x.studentId))lastCall.set(x.studentId,x.at);});const sort=state.historySort||{key:mode==='counts'?'count':'at',direction:'desc'},factor=sort.direction==='asc'?1:-1;
  const rows=[...classStudents].sort((a,b)=>{const va=sort.key==='count'?(counts.get(a.id)||0):sort.key==='date'?Date.parse(lastCall.get(a.id)||0):(a.name||''),vb=sort.key==='count'?(counts.get(b.id)||0):sort.key==='date'?Date.parse(lastCall.get(b.id)||0):(b.name||'');return(typeof va==='string'?va.localeCompare(vb,'zh-CN'):va-vb)*factor;});
  const ordered=[...timeline].sort((a,b)=>{const sa=classStudents.find(s=>s.id===a.studentId),sb=classStudents.find(s=>s.id===b.studentId),va=sort.key==='name'?(sa?.name||a.studentId):sort.key==='difficulty'?Number(a.difficulty):Date.parse(a.at),vb=sort.key==='name'?(sb?.name||b.studentId):sort.key==='difficulty'?Number(b.difficulty):Date.parse(b.at);return(typeof va==='string'?va.localeCompare(vb,'zh-CN'):va-vb)*factor;});
  const difficultyCounts=[1,2,3].map(level=>timeline.filter(x=>Number(x.difficulty)===level).length),f=state.historyFilter||'all',options=[['all','总计'],['calls20','近20次点名'],['calls30','近30次点名'],['calls50','近50次点名'],['week','近1周'],['twoWeeks','近2周'],['month','近1月'],['twoMonths','近2月'],['threeMonths','近3月']],arrow=k=>sortArrow(sort.key===k,sort.direction);
  const nav=`<div class="stats-switch"><button class="secondary ${mode==='timeline'?'active':''}" id="timelineBtn">点名时间</button><button class="secondary ${mode==='counts'?'active':''}" id="countsBtn">点名统计</button><button class="secondary ${mode==='difficulty'?'active':''}" id="difficultyBtn">题目难度统计</button></div><div class="field"><label>统计范围</label><select id="historyFilter">${options.map(([v,l])=>`<option value="${v}" ${v===f?'selected':''}>${l}</option>`).join('')}</select></div>`;
  let body='';
  if(mode==='difficulty') body=`<div class="panel difficulty-stats"><h2>题目难度统计</h2><div class="difficulty-chart"><canvas id="difficultyChart"></canvas><div class="difficulty-legend"><div><i class="legend-dot easy"></i>简单：${difficultyCounts[0]}次</div><div><i class="legend-dot medium"></i>适中：${difficultyCounts[1]}次</div><div><i class="legend-dot hard"></i>困难：${difficultyCounts[2]}次</div></div></div></div>`;
  else if(mode==='timeline') body=`<div class="panel">\
<h2 class="history-section-title">点名时间</h2>\
<div class="table-header history-table-header">\
<button data-history-sort="name">姓名${arrow('name')}</button>\
<button data-history-sort="at">时间戳${arrow('at')}</button>\
<button data-history-sort="difficulty">难度${arrow('difficulty')}</button>\
</div>${ordered.length?ordered.map(x=>{const s=classStudents.find(st=>st.id===x.studentId);return `<div class="stat-row history-row">\
<span>\
<button class="student-link" data-history-student="${esc(x.studentId)}">${esc(s?.displayName||s?.name||x.studentId)}</button>\
</span>\
<span>${new Date(x.at).toLocaleString()}</span>\
<span>${['','简单','适中','困难'][x.difficulty]||'—'}</span>\
</div>`}).join(''):'<div class="empty">暂无点名记录</div>'}</div>`;
    
  else body=`<div class="panel">\
<h2 class="history-section-title">点名统计</h2>\
<div class="table-header history-table-header">\
<button data-history-sort="name">学生${arrow('name')}</button>\
<button data-history-sort="count">点名次数${arrow('count')}</button>\
<button data-history-sort="date">日期${arrow('date')}</button>\
</div>${rows.length?rows.map(s=>`<div class="stat-row history-row">\
<span>\
<button class="student-link" data-history-student="${esc(s.id)}">${esc(s.displayName||s.name)}</button>\
</span>\
<span>${counts.get(s.id)||0}次</span>\
<span>${lastCall.has(s.id)?relativeCallTime(lastCall.get(s.id)):'未点名'}</span>\
</div>`).join(''):'<div class="empty">本班暂无学生</div>'}</div>`;
    
  $('#view-history').innerHTML=`<div class="panel">${nav}<div class="field"><label>本班总点名次数</label><input disabled value="${timeline.length}"></div></div>${body}`;
  if(mode==='difficulty')drawDifficultyPie(difficultyCounts);
    $('#historyFilter').onchange=e=>{state.historyFilter=e.target.value;renderHistory();};
    $('#timelineBtn').onclick=()=>{state.statsMode='timeline';state.historySort={key:'at',direction:'desc'};renderHistory();};
    $('#countsBtn').onclick=()=>{state.statsMode='counts';state.historySort={key:'count',direction:'desc'};renderHistory();};
    $('#difficultyBtn').onclick=()=>{state.statsMode='difficulty';renderHistory();};
    $$('[data-history-sort]').forEach(b=>b.onclick=()=>toggleHistorySort(b.dataset.historySort));
    $$('[data-history-student]').forEach(b=>b.onclick=()=>{state.historyStudentId=b.dataset.historyStudent;renderHistory();});
    
}

function statsFilteredHistory(){
  const all=[...state.history].filter(x=>state.students.some(s=>s.id===x.studentId&&(!state.currentClass||s.className===state.currentClass))).sort((a,b)=>String(b.at).localeCompare(String(a.at))),rule=state.historyFilter||'all';
  if(rule.startsWith('calls'))return all.slice(0,Number(rule.slice(5))||20);
  if(rule==='all')return all;
  const days={week:7,twoWeeks:14,month:30,twoMonths:60,threeMonths:90}[rule]||0,cutoff=Date.now()-days*86400000;return all.filter(x=>Date.parse(x.at)>=cutoff);
}

function toggleHistorySort(key){const current=state.historySort||{key:'at',direction:'desc'};state.historySort=current.key===key?{key,direction:current.direction==='desc'?'asc':'desc'}:{key,direction:'desc'};renderHistory();}
