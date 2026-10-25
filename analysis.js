// 学生成绩状态监测：把“单次异常 / 持续偏低 / 持续下降 / 正在改善”算出来并渲染成学生页里的分析页。
// 判定基准统一用“段排位百分位” p = 段排名 / 当场段人数（0 最好、1 最差，越大越差），
// 这样跨考试（满分不同）、跨班（人数不同）都能比；得分率只用来展示。
// 这里全是纯计算 + 一处渲染，不写入任何数据。

const GRADE_STATUS_DEFAULTS={lowPct:0.80,anomaly:0.25,dropWindow:0.15,improveWindow:0.10,minExams:3};
const GRADE_STATUS_META={
  drop:{label:'持续下降',level:'关注',tone:'danger',hint:'前后两个三次窗口的中位数明显变差，而且最近三次还在往下走'},
  low:{label:'持续偏低',level:'关注',tone:'danger',hint:'最近三次里至少两次落在段排位后 20%'},
  anomaly:{label:'单次异常',level:'观察',tone:'warn',hint:'本次明显低于个人常态，但没有持续下降的证据'},
  improve:{label:'正在改善',level:'继续观察',tone:'good',hint:'最近三次的中位数在回升，趋势转好'},
  stable:{label:'稳定',level:'—',tone:'muted',hint:'没有命中上面任何一条'},
  short:{label:'数据不足',level:'—',tone:'muted',hint:'有效成绩不足以判断'},
};
const GRADE_STATUS_ORDER=['drop','low','anomaly','improve','stable','short'];

function gradeStatusConfig(saved){
  const s=saved||{};
  const num=(value,fallback,min,max)=>{
    const n=Number(value);
    if(!Number.isFinite(n))return fallback;
    return Math.max(min,Math.min(max,n));
  };
  return {
    lowPct:num(s.gradeLowPct,GRADE_STATUS_DEFAULTS.lowPct,0.5,0.95),
    anomaly:num(s.gradeAnomaly,GRADE_STATUS_DEFAULTS.anomaly,0.05,0.60),
    dropWindow:num(s.gradeDropWindow,GRADE_STATUS_DEFAULTS.dropWindow,0.02,0.60),
    improveWindow:num(s.gradeImproveWindow,GRADE_STATUS_DEFAULTS.improveWindow,0.02,0.60),
    minExams:Math.round(num(s.gradeMinExams,GRADE_STATUS_DEFAULTS.minExams,2,10)),
  };
}

// 当场“段人数”：用该场最大的段排名（实测 772–788，比“记录条数”稳：缺考的人不占名次）
const examSegSizeCache=new Map();
function examSegSize(examId){
  if(examSegSizeCache.has(examId))return examSegSizeCache.get(examId);
  let max=0;
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const n=rankNumber(r.result&&r.result.gradeRank);
    if(n>max)max=n;
  });
  examSegSizeCache.set(examId,max);
  return max;
}
// 某场考试里每个班有成绩的人数（用于班内百分位）
const examClassSizeCache=new Map();
function examClassSize(examId,className){
  const key=examId+'|'+className;
  if(examClassSizeCache.has(key))return examClassSizeCache.get(key);
  const counts={};
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const result=r.result||{};
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;
    const cls=normalizeClassName(result.className);
    counts[cls]=(counts[cls]||0)+1;
  });
  examClassSizeCache.set(examId,counts);
  examClassSizeCache.set(key,counts[className]||0);
  return counts[className]||0;
}
function clearGradeAnalysisCache(){examSegSizeCache.clear();examClassSizeCache.clear();}

// 一个学生的成绩序列（按考试日期正序）：只保留他有成绩记录的场次，缺考标记出来但不参与计算
function buildGradeSeries(student){
  if(!student)return [];
  const out=[];
  chronologicalExams().forEach(exam=>{
    const result=examResult(exam,student);
    if(!result)return;
    const score=Number(result.score);
    const valid=Number.isFinite(score)&&score>0;
    const segSize=examSegSize(exam.id);
    const gradeRank=rankNumber(result.gradeRank);
    const classRank=rankNumber(result.classRank);
    const clsSize=valid?examClassSize(exam.id,student.className):0;
    out.push({
      examId:exam.id,date:exam.date||'',name:exam.name||exam.date||'',
      score:valid?score:null,rate:valid?examScoreRate(exam,result):null,missing:!valid,
      gradeRank,classRank,segSize,
      segPct:valid&&gradeRank&&segSize?gradeRank/segSize:null,
      classPct:valid&&classRank&&clsSize?classRank/clsSize:null,
    });
  });
  return out;
}
function gradeMedian(list){
  const arr=(list||[]).filter(v=>Number.isFinite(v)).slice().sort((a,b)=>a-b);
  if(!arr.length)return null;
  const mid=Math.floor(arr.length/2);
  return arr.length%2?arr[mid]:(arr[mid-1]+arr[mid])/2;
}
// 最小二乘斜率（x = 0,1,2…）
function gradeSlope(list){
  const arr=(list||[]).filter(v=>Number.isFinite(v));
  if(arr.length<2)return null;
  const n=arr.length,mx=(n-1)/2,my=arr.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  arr.forEach((y,i)=>{num+=(i-mx)*(y-my);den+=(i-mx)*(i-mx);});
  return den?num/den:null;
}

// 判定一个学生的状态：返回 {primary, tags, series, evidence}
// 优先级：持续下降 > 持续偏低 > 单次异常 > 正在改善 > 稳定
function detectGradeStatus(student,cfg){
  const c=cfg||gradeStatusConfig(state.settings);
  const series=buildGradeSeries(student);
  const valid=series.filter(x=>!x.missing&&x.segPct!==null);
  const evidence={count:valid.length,need:c.minExams,last3:[],prev:[],last3Median:null,prevMedian:null,slope:null,currentPct:null,historyMedian:null,lowHits:0,examName:'',examDate:''};
  if(valid.length<c.minExams)return {primary:'short',tags:[],series,evidence};
  const last3=valid.slice(-3),prev=valid.slice(-6,-3);
  const pLast3=last3.map(x=>x.segPct),pPrev=prev.map(x=>x.segPct);
  const current=valid[valid.length-1];
  evidence.last3=pLast3.slice();
  evidence.prev=pPrev.slice();
  evidence.last3Median=gradeMedian(pLast3);
  evidence.prevMedian=pPrev.length?gradeMedian(pPrev):null;
  evidence.slope=gradeSlope(pLast3);
  evidence.currentPct=pLast3.length?pLast3[pLast3.length-1]:null;
  evidence.examName=current?current.name:'';
  evidence.examDate=current?current.date:'';
  const history=valid.slice(0,-1);
  evidence.historyMedian=history.length?gradeMedian(history.map(x=>x.segPct)):null;
  const lowHits=pLast3.filter(p=>p>=c.lowPct).length;
  evidence.lowHits=lowHits;
  const hits=[];
  const hasWindows=evidence.prevMedian!==null&&evidence.last3Median!==null&&pPrev.length>=2&&pLast3.length>=2;
  const dropFits=hasWindows&&(evidence.last3Median-evidence.prevMedian)>=c.dropWindow&&evidence.slope!==null&&evidence.slope>0;
  if(dropFits)hits.push('drop');
  if(lowHits>=2)hits.push('low');
  const anomalyFits=!dropFits&&history.length>=3&&evidence.historyMedian!==null&&evidence.currentPct!==null
    &&(evidence.currentPct-evidence.historyMedian)>=c.anomaly;
  if(anomalyFits)hits.push('anomaly');
  const improveFits=!dropFits&&hasWindows&&(evidence.prevMedian-evidence.last3Median)>=c.improveWindow&&evidence.slope!==null&&evidence.slope<0;
  if(improveFits)hits.push('improve');
  const primary=hits.length?hits[0]:'stable';
  const tags=hits.filter(x=>x!==primary);
  return {primary,tags,series,evidence};
}

// 本班全部学生的分析行，按状态优先级 + 严重程度排序
function gradeAnalysisRows(cfg){
  const c=cfg||gradeStatusConfig(state.settings);
  clearGradeAnalysisCache();
  const students=(state.students||[]).filter(s=>s&&(!state.currentClass||s.className===state.currentClass));
  const rows=students.map(student=>{
    const detected=detectGradeStatus(student,c);
    return {student,primary:detected.primary,tags:detected.tags,evidence:detected.evidence,series:detected.series};
  });
  rows.sort((a,b)=>{
    const pa=GRADE_STATUS_ORDER.indexOf(a.primary),pb=GRADE_STATUS_ORDER.indexOf(b.primary);
    if(pa!==pb)return pa-pb;
    const sa=a.evidence.last3Median===null?-1:a.evidence.last3Median;
    const sb=b.evidence.last3Median===null?-1:b.evidence.last3Median;
    if(sa!==sb)return sb-sa;
    return String(a.student.name||'').localeCompare(String(b.student.name||''),'zh-CN');
  });
  return {rows,config:c,counts:gradeAnalysisCounts(rows)};
}
function gradeAnalysisCounts(rows){
  const counts={};
  GRADE_STATUS_ORDER.forEach(k=>{counts[k]=0;});
  (rows||[]).forEach(r=>{counts[r.primary]=(counts[r.primary]||0)+1;});
  return counts;
}
// 缺考场次（序列里有记录但没成绩）
function gradeMissingCount(series){
  return (series||[]).filter(x=>x.missing).length;
}

// ---------- 渲染：学生页里的“成绩分析”二级页面 ----------
function gradePctText(value,digits){
  if(value===null||value===undefined||!Number.isFinite(value))return '—';
  return (value*100).toFixed(digits===undefined?0:digits)+'%';
}
function gradeChip(key){
  const meta=GRADE_STATUS_META[key]||GRADE_STATUS_META.stable;
  return `<span class="grade-chip grade-chip-${meta.tone}">${esc(meta.label)}</span>`;
}
// 学生详情页里的状态标签：点一下跳到成绩分析，并滚到这位学生的条目
function gradeStatusChipsFor(student){
  if(!student)return '';
  const status=detectGradeStatus(student,gradeStatusConfig(state.settings));
  const keys=[status.primary].concat(status.tags||[]);
  return keys.map(key=>`<button type="button" class="detail-status-btn" data-grade-status-jump="${esc(student.id)}" title="到成绩分析里看这位学生（${esc((GRADE_STATUS_META[key]||GRADE_STATUS_META.stable).label)}）">${gradeChip(key)}</button>`).join('');
}
function openGradeAnalysisForStudent(id){
  if(!state.examResults||!state.examResults.length){toast('还没有成绩数据，先导入几场考试成绩');return;}
  if(!id)return;
  state.gradeAnalysisFromDetail=id;      // 从这个学生的详情页进来：返回时回到详情页
  state.gradeAnalysisOpen=true;
  state.studentDetail=null;
  state.studentExamExpand=false;
  renderStudents();
  const view=$('#view-students');
  const row=view?view.querySelector(`[data-grade-student="${id}"]`):null;
  if(!view||!row)return;
  const delta=row.getBoundingClientRect().top-view.getBoundingClientRect().top-gradeHeadOffset()-6;
  view.scrollTop=Math.max(0,view.scrollTop+delta);
  row.classList.add('is-focus');
  gradeActiveGroup='';
  gradeScrollSpy();
}
function gradeEvidenceText(row,config){
  const e=row.evidence;
  const bits=[];
  if(e.examName)bits.push(`${esc(e.examName)}${e.examDate?'（'+esc(e.examDate)+'）':''}`);
  if(e.last3.length)bits.push('最近三次段排位 '+e.last3.map(v=>gradePctText(v)).join(' · '));
  if(e.prevMedian!==null)bits.push(`前三次中位 ${gradePctText(e.prevMedian)} → 最近 ${gradePctText(e.last3Median)}`);
  else if(e.historyMedian!==null)bits.push(`历史中位 ${gradePctText(e.historyMedian)} → 本次 ${gradePctText(e.currentPct)}`);
  if(e.slope!==null)bits.push('趋势 '+(e.slope>0.004?'变差':e.slope<-0.004?'转好':'持平')+'（'+(e.slope>=0?'+':'')+e.slope.toFixed(3)+'）');
  if(e.lowHits)bits.push(`后 ${Math.round((1-config.lowPct)*100)}% 命中 ${e.lowHits}/3`);
  if(row.primary==='short')bits.push(`有效成绩 ${e.count} 场（判定需 ${e.need} 场）`);
  return bits.join(' ｜ ');
}
function gradeRowHtml(row,config){
  const s=row.student;
  const name=esc(s.displayName||s.name||'');
  const tags=row.tags.map(k=>gradeChip(k)).join('');
  return `<button type="button" class="grade-row" data-grade-student="${esc(s.id)}">\
<span class="grade-row-main">\
${avatarHtml(s,{size:34})}\
<span class="grade-row-who"><strong class="${focusNameClass(s)}">${name}</strong>${gradeChip(row.primary)}${tags}</span>\
</span>\
<span class="grade-row-evidence hint">${gradeEvidenceText(row,config)}</span>\
</button>`;
}
function renderGradeAnalysis(){
  const data=gradeAnalysisRows();
  const {rows,counts,config}=data;
  const total=rows.length;
  const groupKeys=GRADE_STATUS_ORDER.filter(k=>(counts[k]||0)>0);
  const groups=groupKeys.map(key=>{
    const list=rows.filter(r=>r.primary===key);
    const meta=GRADE_STATUS_META[key];
    return `<div class="grade-group" data-grade-group="${key}">\
<div class="grade-group-head" title="${esc(meta.hint)}"><strong>${esc(meta.label)}</strong><span class="hint">${esc(meta.level)} · ${list.length} 人</span></div>\
${list.map(r=>gradeRowHtml(r,config)).join('')}\
</div>`;
  }).join('');
  // 状态标签横排一行（放不下就左右滑），同时也是“跳到对应分组”的按钮
  const jumps=groupKeys.map(key=>`<button type="button" class="grade-jump" data-grade-jump="${key}" title="跳到「${esc(GRADE_STATUS_META[key].label)}」">${gradeChip(key)}<b>${counts[key]}</b></button>`).join('');
  const scope=state.currentClass?` · ${esc(state.currentClass)}`:'';
  $('#view-students').innerHTML=`<div class="panel grade-analysis-head-panel" id="gradeAnalysisHead">\
<div class="grade-analysis-head">\
<h2 class="with-help">成绩分析 ${panelHelpBtn('grade.analysis','成绩分析的说明')}<span class="hint grade-total">全班 ${total} 人${scope}</span></h2>\
<button type="button" class="secondary" id="gradeAnalysisBack">返回学生列表</button>\
</div>\
<div class="grade-chips" id="gradeChips">${jumps||'<span class="hint">还没有可分析的成绩</span>'}</div>\
</div>\
<div class="panel" id="gradeAnalysisList">${groups||'<div class="empty">这个范围里还没有可分析的学生</div>'}</div>`;
  $('#gradeAnalysisBack').onclick=()=>closeGradeAnalysis();
  $$('#view-students [data-grade-jump]').forEach(b=>b.onclick=()=>scrollToGradeGroup(b.dataset.gradeJump));
  $$('#view-students [data-grade-student]').forEach(b=>b.onclick=()=>openStudentDetail(b.dataset.gradeStudent));
  bindPanelHelp();
  // 跟着滚动高亮当前分组的标签（并把它滑进可视范围）
  const view=$('#view-students');
  if(view)view.onscroll=gradeScrollSpy;
  gradeActiveGroup='';
  gradeScrollSpy();
}
let gradeActiveGroup='';
// 顶部标签条的实际高度：分组标题不再吸顶，但点击跳转要避开这条
function gradeHeadOffset(){
  const bar=$('#gradeAnalysisHead');
  return bar?Math.max(0,bar.offsetHeight+6):0;
}
// 滚动到哪一段，就把对应标签加粗描边；标签在可视区外时自动滑过去
function gradeScrollSpy(){
  if(!state.gradeAnalysisOpen||state.studentDetail)return;
  const view=$('#view-students');
  if(!view)return;
  const groups=[...view.querySelectorAll('[data-grade-group]')];
  if(!groups.length)return;
  const viewTop=view.getBoundingClientRect().top;
  const threshold=gradeHeadOffset()+2;
  let current=groups[0].dataset.gradeGroup;
  for(const group of groups){
    if(group.getBoundingClientRect().top-viewTop<=threshold)current=group.dataset.gradeGroup;
    else break;
  }
  // 滚到底时最后一段可能永远到不了顶部，单独兜一下
  if(view.scrollTop+view.clientHeight>=view.scrollHeight-4)current=groups[groups.length-1].dataset.gradeGroup;
  if(current===gradeActiveGroup)return;
  gradeActiveGroup=current;
  const strip=$('#gradeChips');
  if(!strip)return;
  strip.querySelectorAll('[data-grade-jump]').forEach(b=>b.classList.toggle('is-active',b.dataset.gradeJump===current));
  const active=strip.querySelector(`[data-grade-jump="${current}"]`);
  if(!active)return;
  const rect=active.getBoundingClientRect(),stripRect=strip.getBoundingClientRect();
  if(rect.left<stripRect.left+6)strip.scrollLeft=Math.max(0,strip.scrollLeft-(stripRect.left-rect.left)-10);
  else if(rect.right>stripRect.right-6)strip.scrollLeft+=rect.right-stripRect.right+10;
}
// 点上方标签：滚到对应分组，并立刻高亮它
function scrollToGradeGroup(key){
  const view=$('#view-students');
  const target=view?view.querySelector(`[data-grade-group="${key}"]`):null;
  if(!view||!target)return;
  const delta=target.getBoundingClientRect().top-view.getBoundingClientRect().top-gradeHeadOffset();
  view.scrollTop=Math.max(0,view.scrollTop+delta);
  gradeActiveGroup='';
  gradeScrollSpy();
}
function openGradeAnalysis(){
  if(!state.examResults||!state.examResults.length){toast('还没有成绩数据，先导入几场考试成绩');return;}
  state.gradeAnalysisOpen=true;
  state.gradeAnalysisFromDetail='';
  state.studentDetail=null;
  renderStudents();
  scrollViewTop('students');
}
function closeGradeAnalysis(){
  state.gradeAnalysisOpen=false;
  state.gradeAnalysisFromDetail='';
  gradeActiveGroup='';
  const view=$('#view-students');
  if(view)view.onscroll=null;
  renderStudents();
  scrollViewTop('students');
}

// 成绩分析页的说明
registerPanelHelp('grade.analysis','成绩分析',
  () => {const c=gradeStatusConfig(state.settings);return `<p><strong>判定基准</strong>：段排位百分位 = 当场段排名 ÷ 当场段人数（0 最好、1 最差）。用它比是因为各场满分不同、各班人数也不同，原始分和名次都没法直接比。</p>\
<p><strong>三种判定</strong>（阈值可在设置页“成绩分析”里改）：</p>\
<p>· <strong>持续下降</strong>：最近 3 次段排位中位数比前 3 次差 ≥ ${Math.round(c.dropWindow*100)} 个百分点，且最近 3 次趋势在变差 → 关注。<br>\
· <strong>持续偏低</strong>：最近 3 次里至少 2 次落在后 ${Math.round((1-c.lowPct)*100)}%（段排位 ≥ ${gradePctText(c.lowPct)}）→ 关注。<br>\
· <strong>单次异常</strong>：本次比之前历史中位数差 ≥ ${Math.round(c.anomaly*100)} 个百分点，且不属于“持续下降” → 观察。<br>\
· <strong>正在改善</strong>：最近 3 次中位数比前 3 次好 ≥ ${Math.round(c.improveWindow*100)} 个百分点，且趋势在变好 → 继续观察。</p>\
<p>缺考不计入计算（但会标注）；有效成绩少于 ${c.minExams} 场的学生归到“数据不足”。一个学生可能同时命中多条，列表里会同时显示主状态与副标签。</p>\
<p><strong>怎么用这张表</strong>：默认按状态分组列出全班（持续下降在最前）；上方的状态标签横排一行，放不下可以左右滑，点一下直接跳到对应分组；往下翻的时候，当前所在分组的标签会自动加粗描边，标签若在可视区外也会自动滑进来。点某个学生可以进他的详情页。</p>`;});
