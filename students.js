// 学生页：列表渲染、三个表头排序、学生详情



function studentRows(rows){
  if(!rows.length)return '<div class="empty">暂无学生</div>';
  const exams=orderedExams(),currentExam=exams.find(e=>e.id===state.studentCurrentExamId)||exams[0],previousExam=state.studentPreviousExamId?exams.find(e=>e.id===state.studentPreviousExamId):null,hasComparison=Boolean(previousExam&&currentExam&&previousExam.id!==currentExam.id),classStudents=state.students.filter(s=>!state.currentClass||s.className===state.currentClass),rankMap=averageRankMap(classStudents);
  return sortedStudents(rows).map(s=>{const latest=examResult(currentExam,s),previous=examResult(previousExam,s),l=latest||{},display=l.displayName||s.displayName||s.name,avg=averageScoreRate(s),avgRank=rankMap.get(s.id);return `<div class="stat-row student-row">\
<span>\
<button class="student-link" data-student-detail="${esc(s.id)}">${esc(display)}</button>${s.focus?' <span class="badge">关注</span>':''}${s.noCall?' <span class="badge no-call-badge">不点名</span>':''}\
<br>\
<small class="hint">${latest?`${l.score}分`:'缺考'}</small>\
</span>\
<span class="rank-info">班次：${latest?(l.classRank??'—'):'—'} ${hasComparison&&latest?rankDelta(l.classRank,previous?.classRank):''}<br>段次：${latest?(l.gradeRank??'—'):'—'} ${hasComparison&&latest?rankDelta(l.gradeRank,previous?.gradeRank):''}</span>\
<span class="average-info">\
<strong>${avg===null?'—':`${(avg*100).toFixed(1)}%`}</strong>\
<small>班排名：${avgRank??'—'}</small>\
</span>\
</div>`;}).join('');
    
}

function renderStudentDetail(id){
  const s=state.students.find(x=>x.id===id);if(!s){state.studentDetail=null;renderStudents();return;}const records=chronologicalExams().map(e=>({exam:e,result:examResult(e,s)})).filter(x=>x.result),maxClass=Math.max(...state.examResults.map(x=>rankNumber(x.result?.classRank)||0),1),maxGrade=Math.max(...state.examResults.map(x=>rankNumber(x.result?.gradeRank)||0),1),current=records[records.length-1]?.result,display=current?.displayName||s.displayName||s.name;
  $('#view-students').innerHTML=`<div class="panel">\
<div class="detail-header">\
<button class="secondary" id="backStudents">返回学生列表</button>\
<h2>${esc(display)}</h2>\
<div class="detail-actions">\
<button class="secondary detail-focus${s.focus?' on':''}" id="detailFocusBtn">${s.focus?'已关注':'未关注'}</button>\
<button class="secondary detail-nocall${s.noCall?' on':''}" id="detailNoCallBtn">${s.noCall?'不点名':'点名'}</button>\
</div>\
</div>\
<p class="hint">${esc(s.className)} · ${current?.score??'—'}分</p>\
</div>\
<div class="panel">\
<h3>考试记录</h3>${records.length?records.map(x=>`<div class="stat-row exam-record-row">\
<span>\
<strong>${esc(x.exam.name)}</strong>\
<br>\
<small class="hint">考试时间：${esc(x.exam.date)}</small>\
</span>\
<span>\
<strong>${x.result.score}分</strong>\
</span>\
<span class="rank-cell">\
<span style="background:${rankColor(Number(x.result.classRank)||maxClass,maxClass)}" class="rank-chip">班 ${x.result.classRank??'—'}</span>\
<span style="background:${rankColor(Number(x.result.gradeRank)||maxGrade,maxGrade)}" class="rank-chip">段 ${x.result.gradeRank??'—'}</span>\
</span>\
</div>`).join(''):'<div class="empty">暂无考试记录</div>'}</div>\
<div class="panel">\
<h3>成绩趋势</h3>\
<div class="chart-wrap">\
<canvas id="scoreChart">\
</canvas>\
</div>\
<div class="chart-actions">\
<button class="secondary" id="viewScoreChart">查看整张图</button>\
<button class="secondary" id="downloadScoreChartInline">下载图片</button>\
</div>\
</div>`;
    
  $('#backStudents').onclick=()=>{state.studentDetail=null;renderStudents();};$('#detailFocusBtn').onclick=async()=>{s.focus=!s.focus;await DB.put(s);renderStudentDetail(id);toast(s.focus?`已把 ${s.name} 设为关注`:`已取消 ${s.name} 的关注`);};$('#detailNoCallBtn').onclick=async()=>{s.noCall=!s.noCall;await DB.put(s);refreshCandidatesAfterSettings();renderStudentDetail(id);toast(s.noCall?`已把 ${s.name} 标记为不点名`:`已恢复 ${s.name} 的候选资格`);};drawScoreChart(s,records);$('#viewScoreChart').onclick=()=>openScoreChart(records);$('#downloadScoreChartInline').onclick=()=>{const canvas=$('#scoreChart');const link=document.createElement('a');link.download='成绩趋势图.png';link.href=canvas.toDataURL('image/png');link.click();};
}

function bindStudentActions(){
  $$('[data-student-detail]').forEach(b=>b.onclick=()=>{state.studentDetail=b.dataset.studentDetail;renderStudents();});
}

function sortArrow(active, direction){const ascending=direction==='asc'||direction===true;return active ? `<span class="sort-arrow" aria-hidden="true">${ascending?'↑':'↓'}</span>` : '';}

function studentSortValue(student){
  const exams=orderedExams(), current=exams.find(e=>e.id===state.studentCurrentExamId)||exams[0], previous=exams.find(e=>e.id===state.studentPreviousExamId)||exams[1];
  if(state.studentSort.startsWith('score'))return Number(examResult(current,student)?.score??-1);
  if(state.studentSort.startsWith('average'))return Number(averageScoreRate(student)??-1);
  if(state.studentSort.startsWith('rank')){const now=rankNumber(examResult(current,student)?.gradeRank),old=rankNumber(examResult(previous,student)?.gradeRank);return now===null||old===null?null:old-now;}
  return String(student.name||'');
}

function sortedStudents(rows){
  const direction=state.studentSort.endsWith('asc')?1:-1;
  return [...rows].sort((a,b)=>{const av=studentSortValue(a),bv=studentSortValue(b);if(av===null&&bv!==null)return 1;if(av!==null&&bv===null)return -1;if(av===null&&bv===null)return String(a.name).localeCompare(String(b.name),'zh-CN');if(typeof av==='string')return av.localeCompare(bv,'zh-CN')*direction;return (av-bv)*direction||String(a.name).localeCompare(String(b.name),'zh-CN');});
}

function toggleStudentHeader(key){const prefix=key;state.studentSort=state.studentSort===`${prefix}-desc`?`${prefix}-asc`:`${prefix}-desc`;renderStudents();}

function renderStudents(){
  if(state.studentDetail){renderStudentDetail(state.studentDetail);return;}
  const filtered=state.students.filter(s=>!state.currentClass||s.className===state.currentClass),exams=orderedExams();
  if(!state.studentSelectionInitialized){state.studentCurrentExamId=exams.find(e=>e.id===state.studentCurrentExamId)?.id||exams[0]?.id||'';state.studentPreviousExamId=previousExamIdFor(state.studentCurrentExamId);state.studentSelectionInitialized=true;}
  const currentExam=exams.find(e=>e.id===state.studentCurrentExamId)||exams[0],previousExam=state.studentPreviousExamId?exams.find(e=>e.id===state.studentPreviousExamId):null,examDate=e=>e?.date?`<small class="hint exam-date">考试日期：${esc(e.date)}</small>`:'';
  $('#view-students').innerHTML=`<div class="panel">\
<div class="grid">\
<div class="field">\
<label>当前考试</label>\
<select id="studentCurrentExam">${examOptions(state.studentCurrentExamId)}</select>${examDate(currentExam)}</div>\
<div class="field">\
<label>上一次考试</label>\
<select id="studentPreviousExam">${examOptions(state.studentPreviousExamId,true)}</select>${examDate(previousExam)}</div>\
</div>\
<div class="field">\
<label>搜索姓名</label>\
<input id="studentSearch" placeholder="输入姓名">\
</div>\
</div>\
<div class="panel">\
<div class="student-section-title">学生资料 <span class="badge">${filtered.length}人</span>\
</div>\
<div class="table-header student-table-header">\
<button data-student-sort="score">当前成绩${sortArrow(state.studentSort.startsWith('score'),state.studentSort.endsWith('asc'))}</button>\
<button data-student-sort="rank">位次变化${sortArrow(state.studentSort.startsWith('rank'),state.studentSort.endsWith('asc'))}</button>\
<button data-student-sort="average">综合得分率${sortArrow(state.studentSort.startsWith('average'),state.studentSort.endsWith('asc'))}</button>\
</div>\
<div id="studentList">${studentRows(filtered)}</div>\
</div>`;
    
  $('#studentCurrentExam').onchange=e=>{state.studentCurrentExamId=e.target.value;state.studentPreviousExamId=previousExamIdFor(e.target.value);renderStudents();};
    $('#studentPreviousExam').onchange=e=>{state.studentPreviousExamId=e.target.value;renderStudents();};
    $('#studentSearch').oninput=e=>{$('#studentList').innerHTML=studentRows(filtered.filter(s=>String(s.name||'').includes(e.target.value.trim())));bindStudentActions();};
    $$('[data-student-sort]').forEach(b=>b.onclick=()=>toggleStudentHeader(b.dataset.studentSort));
    bindStudentActions();
    
}
