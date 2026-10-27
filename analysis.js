// 学生成绩状态监测：主状态只有 下降 / 持续偏低 / 进步 / 平稳 / 数据不足，另外两个“本次考试”的附加标签 陡降 / 陡升。
// 判定基准统一用“段排位百分位” p = 段排名 / 当场段人数（0 最好、1 最差，越大越差），
// 这样跨考试（满分不同）、跨班（人数不同）都能比；得分率只用来展示。
// 口径：只看最近 3–5 场（默认 4 场），全程直接用每个点算——首末差、平均每场变化、最新一步、
// 相对趋势线的残差、相邻差分同向次数，不用中位数（中位数会扔掉一头一尾的信息）。
// 老师最关心的两件事排在最前：有下降趋势的、持续偏低的。
// 这里全是纯计算 + 一处渲染，不写入任何数据。

const GRADE_STATUS_DEFAULTS={lowPct:0.80,window:4,step:0.06,jump:0.15,stepMin:0.02};
const GRADE_STATUS_META={
  drop:{label:'下降',level:'关注',tone:'danger',hint:'最近几场整体在往下走（看每场变化和同向次数，允许中间有反弹）'},
  low:{label:'持续偏低',level:'关注',tone:'danger',hint:'最近三次里至少两次落在段排位后百分之二十'},
  improve:{label:'进步',level:'—',tone:'good',hint:'最近几场整体在往上走'},
  stable:{label:'平稳',level:'—',tone:'muted',hint:'最近几场没有明显趋势'},
  short:{label:'数据不足',level:'—',tone:'muted',hint:'有效成绩不足 2 场，判不出趋势'},
  steepFall:{label:'陡降',level:'观察',tone:'warn',hint:'最近这一次比上一次明显掉了（或明显低于趋势线），属于“本次考试”的信号'},
  steepRise:{label:'陡升',level:'—',tone:'good',hint:'最近这一次比上一次明显进步了，属于“本次考试”的信号'},
  high:{label:'持续高分',level:'—',tone:'good',hint:'最近三次里至少两次落在段排位前百分之二十（和持续偏低对称）'},
};
const GRADE_STATUS_ORDER=['low','drop','improve','stable','short'];

function gradeStatusConfig(saved){
  const s=saved||{};
  const num=(value,fallback,min,max)=>{
    const n=Number(value);
    if(!Number.isFinite(n))return fallback;
    return Math.max(min,Math.min(max,n));
  };
  return {
    lowPct:num(s.gradeLowPct,GRADE_STATUS_DEFAULTS.lowPct,0.5,0.95),
    window:Math.round(num(s.gradeWindow,GRADE_STATUS_DEFAULTS.window,3,5)),
    step:num(s.gradeStep,GRADE_STATUS_DEFAULTS.step,0.01,0.40),
    jump:num(s.gradeJump,GRADE_STATUS_DEFAULTS.jump,0.02,0.60),
    stepMin:GRADE_STATUS_DEFAULTS.stepMin,
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
// 最小二乘直线拟合（x = 0,1,2…）：返回斜率与截距，用来看“趋势线上本该在哪”
function gradeLineFit(list){
  const arr=(list||[]).filter(v=>Number.isFinite(v));
  if(arr.length<2)return {slope:null,intercept:null};
  const n=arr.length,mx=(n-1)/2,my=arr.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  arr.forEach((y,i)=>{num+=(i-mx)*(y-my);den+=(i-mx)*(i-mx);});
  const slope=den?num/den:0;
  return {slope,intercept:my-slope*mx};
}

// 判定一个学生的状态：返回 {primary, tags, series, evidence}
// v240 口径（不再用中位数，只看最近 window 场）：
//   Δ = 窗口首末差；每场 = Δ ÷ (场次−1)；最新步 = 最后一场 − 上一场；残差 = 最后一场 − 趋势线在该点的值
//   下降 = 每场 ≥ step 且相邻差分里至少 2 次在变差（允许中间反弹），或这次陡降
//   持续偏低 = 最近三次里至少 2 次落在后 lowPct（单独成首栏）；持续高分是对称的正面标签
//   进步 = 上面两条朝好方向的镜像
//   陡降/陡升 = 最新一步（或相对趋势线的残差）≥ jump —— 只标记“本次考试”的突变
function detectGradeStatus(student,cfg){
  const c=cfg||gradeStatusConfig(state.settings);
  const series=buildGradeSeries(student);
  const valid=series.filter(x=>!x.missing&&x.segPct!==null);
  const win=valid.slice(-c.window);
  const ps=win.map(x=>x.segPct);
  const current=valid[valid.length-1];
  const evidence={count:valid.length,window:c.window,ps,delta:null,perExam:null,lastStep:null,slope:null,resid:null,
    worse:0,better:0,longDiff:null,lowHits:0,highHits:0,score:0,examName:current?(current.name||''):'',examDate:current?(current.date||''):''};
  if(ps.length<2)return {primary:'short',tags:[],series,evidence};
  const n=ps.length;
  const fit=gradeLineFit(ps);
  evidence.slope=fit.slope;
  evidence.delta=ps[n-1]-ps[0];
  evidence.perExam=evidence.delta/(n-1);
  evidence.lastStep=ps[n-1]-ps[n-2];
  evidence.resid=fit.intercept===null?0:ps[n-1]-(fit.intercept+fit.slope*(n-1));
  const diffs=ps.slice(1).map((v,i)=>v-ps[i]);
  evidence.worse=diffs.filter(d=>d>=c.stepMin).length;
  evidence.better=diffs.filter(d=>-d>=c.stepMin).length;
  evidence.longDiff=ps[n-1]-valid[0].segPct;
  const last3=ps.slice(-3);
  evidence.lowHits=last3.filter(p=>p>=c.lowPct).length;
  evidence.highHits=last3.filter(p=>p<=1-c.lowPct).length;
  const falling=evidence.perExam>=c.step&&evidence.worse>=2;
  const rising=-evidence.perExam>=c.step&&evidence.better>=2;
  const plunge=evidence.lastStep>=c.jump||evidence.resid>=c.jump;
  const surge=-evidence.lastStep>=c.jump||-evidence.resid>=c.jump;
  const lowHits=evidence.lowHits>=2;
  // 主状态优先级：下降 > 持续偏低 > 进步 > 平稳（老师最关心的两件事排前面）
  let primary='stable';
  if(falling&&!rising)primary='drop';
  else if(rising&&!falling)primary='improve';
  else if(falling&&rising)primary=evidence.delta>0?'drop':'improve';
  else if(plunge)primary='drop';
  else if(surge)primary='improve';
  // 持续偏低统一进“首栏”：不管原来判定成什么方向，方向改成标签带着走
  const beforeLow=primary;
  if(lowHits)primary='low';
  // 附加标签：本次考试的突变 + 与偏低对称的持续高分
  const tags=[];
  if(plunge)tags.push('steepFall');
  if(surge)tags.push('steepRise');
  if(evidence.highHits>=2)tags.push('high');
  if(lowHits&&beforeLow==='drop')tags.push('drop');
  if(lowHits&&beforeLow==='improve')tags.push('improve');
  const dirWeight=primary==='drop'?evidence.worse:primary==='improve'?evidence.better:0;
  evidence.score=Math.round(Math.abs(evidence.delta)*100+Math.abs(evidence.resid)*60+dirWeight*3);
  evidence.currentPct=ps[n-1];        // 首栏（持续偏低）按“现在越靠后越前”排序用
  return {primary,tags:[...new Set(tags)],series,evidence};
}

// 本班全部学生的分析行：先按主状态（持续偏低→下降→进步→平稳→数据不足），组内按严重度从高到低
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
    // 首栏（持续偏低）：现在段排位越靠后越前，最该先看的排最上面
    if(a.primary==='low'&&b.primary==='low'){
      const ca=Number(a.evidence.currentPct),cb=Number(b.evidence.currentPct);
      if(Number.isFinite(ca)&&Number.isFinite(cb)&&ca!==cb)return cb-ca;
    }
    const sa=Number(a.evidence.score)||0,sb=Number(b.evidence.score)||0;
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
  const ps=e.ps||[];
  if(!ps.length)return row.primary==='short'?`有效成绩 ${e.count} 场（至少要 2 场）`:'';
  // 只显示近几场考试的段排位比例变化，别的说明都收进标题的“？”里
  return `最近 ${ps.length} 场段排位 ${ps.map(v=>gradePctText(v)).join(' → ')}`;
}
// 每行的小折线：把最近几场的段排位比例画成一条折线（值越小越好，所以小值在上）
// 纯 SVG，宽度固定 44、高 20；不足 2 个点返回空串。
function gradeSparkline(ps){
  const list=(ps||[]).filter(v=>Number.isFinite(v));
  if(list.length<2)return '';
  const W=44,H=20,pad=3;
  const min=Math.min(...list),max=Math.max(...list),span=(max-min)||1;
  const x=i=>pad+i*(W-2*pad)/(list.length-1);
  const y=v=>pad+((v-min)/span)*(H-2*pad);
  const pts=list.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last=list.length-1;
  return `<svg class="grade-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">\
<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></polyline>\
<circle cx="${x(last).toFixed(1)}" cy="${y(list[last]).toFixed(1)}" r="2.1" fill="currentColor"></circle>\
</svg>`;
}
function gradeRowHtml(row,config){
  const s=row.student;
  const name=esc(s.displayName||s.name||'');
  const tags=row.tags.map(k=>gradeChip(k)).join('');
  // 行右侧的迷你折线：近几场段排位走势（值越小越靠上＝名次在进步）。
  // 原来这里有一条红绿“颜色条”，已经去掉；现在只留这条折线，路径和方向都由它表达。
  const spark=gradeSparkline(row.evidence.ps);
  const sparkHtml=spark
    ?`<span class="grade-spark-wrap" title="最近几场段排位走势（越往上越好）：${(row.evidence.ps||[]).map(v=>gradePctText(v)).join(' → ')}">${spark}</span>`
    :'';
  return `<button type="button" class="grade-row" data-grade-student="${esc(s.id)}">\
<span class="grade-row-main">\
${avatarHtml(s,{size:34})}\
<span class="grade-row-who"><strong class="${focusNameClass(s)}">${name}</strong>${gradeChip(row.primary)}${tags}</span>\
${sparkHtml}\
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
<p><strong>只看最近 ${c.window} 场</strong>（设置里可调 3–5 场），而且<strong>不取中位数</strong>——每个点都参与计算，所以“中位数一样但过程更差”的情况不会被抹平。四个量：<br>\
· <strong>Δ</strong>＝窗口首末差<br>\
· <strong>每场</strong>＝Δ ÷（场次−1），均匀速度<br>\
· <strong>最新一步</strong>＝最后一场 − 上一场（这次考试有没有突然掉/突然冲）<br>\
· <strong>偏离趋势</strong>＝最后一场 − 趋势线在该点的值（残差，抓单次异常）</p>\
<p><strong>主状态</strong>（按老师关注度排序，就这五个；<strong>持续偏低单独成组放在最上面</strong>）：<br>\
· <strong>下降</strong>：每场 ≥ ${Math.round(c.step*100)} 个百分点，且相邻差分里至少 2 次在变差（中间反弹也算）；<strong>这次陡降</strong>也归到这里<br>\
· <strong>持续偏低（首栏）</strong>：最近 3 次里至少 2 次落在后 ${Math.round((1-c.lowPct)*100)}%（段排位 ≥ ${gradePctText(c.lowPct)}）。<strong>凡是满足这条的学生都归到首栏</strong>，原来判出的“下降/进步”会变成标签跟在后面；组内按“现在的段排位越靠后越前”排。<br>\
· <strong>进步</strong>：第一条朝好方向的镜像，或这次陡升<br>\
· <strong>平稳</strong>：以上都不成立<br>\
· <strong>数据不足</strong>：有效成绩不足 2 场</p>\
<p><strong>附加标签</strong>（只留三个）：<br>\
· <strong>陡降 / 陡升</strong>：<strong>本次考试</strong>比上一次变化 ≥ ${Math.round(c.jump*100)} 个百分点，或明显偏离趋势线——这就是“这次考得明显不对/明显好”<br>\
· <strong>持续高分</strong>：最近 3 次里至少 2 次落在前 ${Math.round((1-c.lowPct)*100)}%，和“持续偏低”正好对称（正面标签）</p>\
<p><strong>每行右上角那条迷你折线</strong>是最近几场的段排位走势：<strong>值越小越靠上</strong>，所以线往上走＝名次在进步、往下走＝在退步，最后一颗实心点表示最新一次。它和左边的状态标签是两件事：例如“持续偏低 + 折线往上”＝底子弱但正在往回爬。列表排序仍按变化幅度（|Δ|×100 + |偏离趋势|×60 + 同向次数×3），变化大的排前面。</p>\
<p>缺考不计入计算（但会标注）。<strong>每行下面只显示最近几场的段排位变化</strong>（例如 52% → 56% → 84% → 45%），其它判定细节都在这一页的标题说明里。上方状态标签横排一行，点一下跳到对应分组；点学生进详情页。</p>`;});