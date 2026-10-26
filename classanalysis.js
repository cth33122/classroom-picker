// 班级分析：把「本班」和「整个段」放在一起看
// 全部即时计算、不写库；只有两个参数（段前 X% / 段后 Y%）存在设置里，单位是百分数（15 = 15%）。
//
// 数据来源就是已有的 examResults：每条带 result.score / result.classRank / result.gradeRank / result.className，
// 段人数沿用 analysis.js 的 examSegSize（= 当场最大段排名，缺考的人不占名次）。
// 只要导入的是“全年段汇总表”（带班级列、含其它班），就能算出段均分和本班均分的班级排名；
// 只导入了本班数据时，这两项会显示“—”，但三段占比（前 X% / 中 / 后 Y%）照样能算。

const CLASS_ANALYSIS_DEFAULTS={topPct:15,bottomPct:20};

function classAnalysisConfig(saved){
  const s=saved||{};
  const clamp=(v,f,min,max)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;};
  const topPct=clamp(s.classTopPct,CLASS_ANALYSIS_DEFAULTS.topPct,2,50);
  const bottomPct=clamp(s.classBottomPct,CLASS_ANALYSIS_DEFAULTS.bottomPct,2,50);
  return {topPercent:topPct,bottomPercent:bottomPct,topPct:topPct/100,bottomPct:bottomPct/100};
}

// 一场考试里整个段的账：段人数、段均分、每个班的均分与名次（均分相同算并列）
function examGradeBoard(examId){
  const seg={count:0,sum:0,segSize:0,avg:null,classList:[],byClass:new Map()};
  const classes=new Map();
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const result=r.result||{};
    const rank=rankNumber(result.gradeRank);
    if(rank>seg.segSize)seg.segSize=rank;
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;
    const cls=normalizeClassName(result.className);
    seg.count++;seg.sum+=score;
    const box=classes.get(cls)||{className:cls,count:0,sum:0};
    box.count++;box.sum+=score;classes.set(cls,box);
  });
  seg.avg=seg.count?seg.sum/seg.count:null;
  const list=[...classes.values()].filter(c=>c.count).map(c=>({className:c.className,count:c.count,avg:c.sum/c.count}))
    .sort((a,b)=>b.avg-a.avg||String(a.className).localeCompare(String(b.className),'zh-CN'));
  let rank=0,prevAvg=null;
  list.forEach((c,index)=>{
    if(prevAvg===null||Math.abs(c.avg-prevAvg)>1e-9){rank=index+1;prevAvg=c.avg;}
    c.rank=rank;
  });
  seg.classList=list;
  list.forEach(c=>seg.byClass.set(c.className,c));
  return seg;
}

// 本班在这一场的账：均分、班级排名、三段（段前 X% / 中间 / 段后 Y%）的人数与名单
// 按“当场记录的班级”统计：换过班的学生会算进当时那个班，历次对比不会串班。
function classExamSlice(examId,className,config){
  const cfg=config||classAnalysisConfig(state.settings);
  const seg=examGradeBoard(examId);
  const cls=normalizeClassName(className);
  const slice={examId,className:cls,seg,count:0,sum:0,avg:null,rank:null,classCount:seg.classList.length,
    top:{count:0,students:[]},mid:{count:0,students:[]},bottom:{count:0,students:[]},noRank:0};
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const result=r.result||{};
    if(normalizeClassName(result.className)!==cls)return;
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;
    slice.count++;slice.sum+=score;
    const gradeRank=rankNumber(result.gradeRank);
    const pct=(gradeRank&&seg.segSize)?gradeRank/seg.segSize:null;
    const student={id:r.studentId,name:result.displayName||result.name||'',score,
      gradeRank,classRank:rankNumber(result.classRank),pct};
    if(pct===null){slice.noRank++;return;}
    if(pct<=cfg.topPct)slice.top.students.push(student);
    else if(pct>1-cfg.bottomPct)slice.bottom.students.push(student);
    else slice.mid.students.push(student);
  });
  slice.top.count=slice.top.students.length;
  slice.mid.count=slice.mid.students.length;
  slice.bottom.count=slice.bottom.students.length;
  slice.avg=slice.count?slice.sum/slice.count:null;
  slice.rank=seg.byClass.has(cls)?seg.byClass.get(cls).rank:null;
  // 三段占比（分母是“有段次的在班人数”，没段次的人单独计数）
  const ranked=slice.top.count+slice.mid.count+slice.bottom.count;
  slice.rankedCount=ranked;
  slice.top.share=ranked?slice.top.count/ranked:null;
  slice.mid.share=ranked?slice.mid.count/ranked:null;
  slice.bottom.share=ranked?slice.bottom.count/ranked:null;
  ['top','mid','bottom'].forEach(k=>slice[k].students.sort((a,b)=>a.pct-b.pct||a.name.localeCompare(b.name,'zh-CN')));
  return slice;
}

// 逐场（按日期正序）
function classAnalysisSeries(className,config){
  const cfg=config||classAnalysisConfig(state.settings);
  const cls=normalizeClassName(className||state.currentClass||'');
  if(!cls)return [];
  return chronologicalExams().map(exam=>({exam,slice:classExamSlice(exam.id,cls,cfg)}))
    .filter(x=>x.slice.count>0);
}

// ---------- 小工具 ----------
function classPctText(value,digits){
  if(value===null||value===undefined||!Number.isFinite(value))return '—';
  return (value*100).toFixed(digits===undefined?1:digits)+'%';
}
function classFix(value,digits){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
  const n=Number(value);
  return Number.isInteger(n)?String(n):n.toFixed(digits===undefined?1:digits);
}

// ---------- 渲染 ----------
function renderClassAnalysis(){
  const view=$('#view-students');
  if(!view)return;
  const cfg=classAnalysisConfig(state.settings);
  const cls=state.currentClass?normalizeClassName(state.currentClass):'';
  const all=classAnalysisSeries(cls,cfg);
  const withData=all.filter(x=>x.slice.count>0);
  if(!cls){
    view.innerHTML=`<div class="panel"><h2>班级分析</h2><p class="hint">请先在顶栏选择一个班级。</p></div>`;
    return;
  }
  const backBtn='<button type="button" class="secondary" id="classAnalysisBack">返回学生列表</button>';
  // 分段参数放在页面最下面（上面的东西都是“结果”，参数属设置类，放末尾更安静）
  const paramPanel=`<div class="panel" id="classParamPanel">\
<h3 class="with-help">分段参数 ${panelHelpBtn('class.params','分段参数的说明')}</h3>\
<div class="class-param-row">\
<div class="field"><label>段前</label><div class="class-param-input"><input id="classTopPct" type="number" min="2" max="50" step="1" value="${cfg.topPercent}"><span>%</span></div></div>\
<div class="field"><label>段后</label><div class="class-param-input"><input id="classBottomPct" type="number" min="2" max="50" step="1" value="${cfg.bottomPercent}"><span>%</span></div></div>\
<button type="button" class="primary" id="saveClassParams">保存</button>\
</div>\
</div>`;
  if(!withData.length){
    view.innerHTML=`<div class="panel grade-analysis-head-panel" id="classAnalysisHead">\
<div class="grade-analysis-head"><h2 class="with-help">班级分析 ${panelHelpBtn('class.analysis','班级分析的说明')}
<span class="hint grade-total">${esc(cls)}</span></h2>${backBtn}</div>\
</div>${paramPanel}<div class="panel"><div class="empty">${esc(cls)} 还没有可分析的考试成绩</div></div>`;
    bindClassAnalysisActions();
    return;
  }
  const latest=withData[withData.length-1];
  const focus=withData.find(x=>x.exam.id===state.classAnalysisExamId)||latest;
  const focusIndex=withData.indexOf(focus);
  const prev=focusIndex>0?withData[focusIndex-1]:null;
  const s=focus.slice;
  const seg=s.seg;
  const examLine=`${esc(focus.exam.name||'')}${focus.exam.date?`（${esc(focus.exam.date)}）`:''}`;
  const hasSegPeer=seg.classList.length>1;
  const kpis=[
    {label:'本班人数',value:`${s.count} 人`,hint:''},
    {label:'本班均分',value:classFix(s.avg),hint:`满分 ${classFix(focus.exam.totalScore)}`},
    {label:'段均分',value:seg.avg===null?'—':classFix(seg.avg),hint:hasSegPeer?`全段 ${seg.count} 人`:'只有本班数据'},
    {label:'班均分排名',value:(s.rank&&hasSegPeer)?`第 ${s.rank} / ${s.classCount}`:'—',hint:hasSegPeer?`共 ${s.classCount} 个班`:'缺全年段数据'},
    {label:`段前 ${cfg.topPercent}%`,value:`${s.top.count} 人 · ${classPctText(s.top.share)}`,hint:''},
    {label:`段后 ${cfg.bottomPercent}%`,value:`${s.bottom.count} 人 · ${classPctText(s.bottom.share)}`,hint:''},
  ];
  const kpiHtml=kpis.map(k=>`<div class="class-kpi"><span class="class-kpi-label">${esc(k.label)}</span>\
<strong class="class-kpi-value">${esc(k.value)}</strong>${k.hint?`<span class="hint">${esc(k.hint)}</span>`:''}</div>`).join('');
  const barRow=(title,count,share,baseline,tone)=>{
    const width=share===null?0:Math.max(0,Math.min(1,share));
    const baseWidth=Math.max(0,Math.min(1,baseline));
    return `<div class="class-bar-row">\
<span class="class-bar-name">${esc(title)}</span>\
<span class="class-bar-track"><span class="class-bar-fill ${tone}" style="width:${(width*100).toFixed(1)}%"></span>\
<span class="class-bar-base" style="left:${(baseWidth*100).toFixed(1)}%" title="段基线 ${(baseline*100).toFixed(0)}%"></span></span>\
<span class="class-bar-value">${count} 人 · ${classPctText(share)}<small class="hint">（段 ${(baseline*100).toFixed(0)}%）</small></span>\
</div>`;
  };
  const midBaseline=Math.max(0,1-cfg.topPct-cfg.bottomPct);
  const bars=`<div class="class-bars">\
${barRow(`段前 ${cfg.topPercent}%`,s.top.count,s.top.share,cfg.topPct,'is-top')}\
${barRow('中间段',s.mid.count,s.mid.share,midBaseline,'is-mid')}\
${barRow(`段后 ${cfg.bottomPercent}%`,s.bottom.count,s.bottom.share,cfg.bottomPct,'is-bottom')}\
</div>\
${s.noRank?`<p class="hint">另有 ${s.noRank} 人有成绩但没有段次，没算进三段占比。</p>`:''}`;
  // 年段班级排名：这场考试每个班的平均得分率，从高到低，本班高亮
  const totalScore=Number(focus.exam.totalScore)||0;
  const rateOf=avg=>(totalScore>0&&avg!==null&&avg!==undefined)?avg/totalScore:null;
  const segRate=rateOf(seg.avg);
  const rankRows=(seg.classList||[]).map(c=>{
    const rate=rateOf(c.avg);
    const isMe=c.className===cls;
    const width=rate===null?0:Math.max(0,Math.min(1,rate))*100;
    return `<tr class="${isMe?'is-current':''}">\
<td class="class-rank-no">${c.rank}</td>\
<td class="class-rank-name">${esc(c.className)}${isMe?'<span class="class-rank-me">本班</span>':''}</td>\
<td class="class-rank-rate"><span class="class-rank-bar"><i style="width:${width.toFixed(1)}%"></i></span><b>${classPctText(rate,1)}</b></td>\
<td class="class-rank-count">${c.count}</td>\
</tr>`;
  }).join('');
  const rankPanel=`<div class="panel" id="classRankPanel">\
<h3 class="with-help">年段班级排名 ${panelHelpBtn('class.ranks','年段班级排名的说明')}<span class="hint">${examLine}</span></h3>\
<div class="class-table-wrap"><table class="class-table class-rank-table">\
<thead><tr><th>名次</th><th>班级</th><th>平均得分率</th><th>人数</th></tr></thead>\
<tbody>${rankRows||'<tr><td colspan="4" class="hint">这场考试没有可比较的班级数据</td></tr>'}</tbody>\
<tfoot><tr><td>—</td><td>全段</td><td class="class-rank-rate"><b>${classPctText(segRate,1)}</b></td><td>${seg.count}</td></tr></tfoot>\
</table></div>\
${seg.classList.length<2?'<p class="hint">库里只有本班的数据，导入全年段汇总表才能和其它班比。</p>':''}\
</div>`;
  // 逐场对比表（新的在上面）
  const tableRows=[...withData].reverse().map(x=>{
    const sc=x.slice;
    return `<tr><td>${esc(x.exam.name||'')}<br><small class="hint">${esc(x.exam.date||'')}</small></td>\
<td>${classFix(sc.avg)}</td>\
<td>${x.slice.seg.avg===null?'—':classFix(x.slice.seg.avg)}</td>\
<td>${sc.rank&&x.slice.seg.classList.length>1?`${sc.rank}/${x.slice.classCount}`:'—'}</td>\
<td>${sc.top.count} <small class="hint">${classPctText(sc.top.share,0)}</small></td>\
<td>${sc.mid.count} <small class="hint">${classPctText(sc.mid.share,0)}</small></td>\
<td>${sc.bottom.count} <small class="hint">${classPctText(sc.bottom.share,0)}</small></td></tr>`;
  }).join('');
  const table=`<div class="class-table-wrap"><table class="class-table">\
<thead><tr><th>考试</th><th>本班均分</th><th>段均分</th><th>班排名</th><th>段前 ${cfg.topPercent}%</th><th>中间</th><th>段后 ${cfg.bottomPercent}%</th></tr></thead>\
<tbody>${tableRows}</tbody></table></div>`;
  // 名单流动（最近两场）
  const flow=prev?classFlowHtml(prev,focus,cfg):'';
  view.innerHTML=`<div class="panel grade-analysis-head-panel" id="classAnalysisHead">\
<div class="grade-analysis-head">\
<h2 class="with-help">班级分析 ${panelHelpBtn('class.analysis','班级分析的说明')}
<span class="hint grade-total">${esc(cls)} · 共 ${withData.length} 场</span></h2>\
${backBtn}\
</div>\
<div class="grade-chips" id="classExamChips">${[...withData].reverse().slice(0,12).map((x,i)=>`<button type="button" class="grade-jump${x===focus?' is-active':''}" data-class-exam="${esc(x.exam.id)}">${esc(x.exam.name||x.exam.date||'')}</button>`).join('')}</div>\
</div>\
<div class="panel" id="classLatestPanel">\
<h3 class="with-help">${focus===latest?'最近一场：':''}${examLine} ${panelHelpBtn('class.latest','本场概览的说明')}</h3>\
<div class="class-kpis">${kpiHtml}</div>\
${bars}\
</div>\
${rankPanel}\
${withData.some(x=>x.slice.rankedCount>0)?`<div class="panel"><h3 class="with-help">三段构成（最近 ${Math.min(CLASS_STACK_LIMIT,withData.length)} 场）${panelHelpBtn('class.stack','三段构成图的说明')}</h3>\
<div class="class-legend">\
<span class="class-legend-item"><i class="is-top"></i>段前 ${cfg.topPercent}%</span>\
<span class="class-legend-item"><i class="is-mid"></i>中间段</span>\
<span class="class-legend-item"><i class="is-bottom"></i>段后 ${cfg.bottomPercent}%</span>\
<span class="hint">从左到右＝由早到晚</span>\
</div>\
<div class="class-chart-scroll" id="classChartScroll"><canvas id="classTrend" class="class-chart-canvas" title="点一下看大图"></canvas></div>\
<p class="hint class-chart-swipe" id="classChartSwipeHint" style="display:none">← 左右滑动看图 →</p>\
<div class="class-chart-actions">\
<button type="button" class="secondary" id="viewClassChart">查看大图</button>\
<button type="button" class="secondary" id="downloadClassChart">下载图片</button>\
</div>\
${withData.length>CLASS_STACK_LIMIT?`<p class="hint">共 ${withData.length} 场，这里只画最近 ${CLASS_STACK_LIMIT} 场；更早的看下面的逐场对比表。</p>`:''}\
</div>`:`<div class="panel"><h3>三段构成</h3><div class="empty">这些考试都没有段次，分不出三段</div></div>`}\
${flow}\
<div class="panel"><h3 class="with-help">逐场对比 ${panelHelpBtn('class.table','逐场对比的说明')}</h3>${table}</div>\
${paramPanel}`;
  bindClassAnalysisActions();
  classChartSeries=withData;
  drawClassStack($('#classTrend'),withData,cfg);
}

// 名单流动：谁进了/出了段前 X%、段后 Y%
function classFlowHtml(prev,current,cfg){
  const byId=(slice)=>{const m=new Map();[].concat(slice.top.students,slice.mid.students,slice.bottom.students).forEach(x=>m.set(x.id,x));return m;};
  const prevTop=new Set(prev.slice.top.students.map(x=>x.id)),currentTop=new Set(current.slice.top.students.map(x=>x.id));
  const prevBottom=new Set(prev.slice.bottom.students.map(x=>x.id)),currentBottom=new Set(current.slice.bottom.students.map(x=>x.id));
  const namesIn=(slice,set)=>{
    const m=byId(slice);
    return [...set].map(id=>m.get(id)).filter(Boolean);
  };
  const enterTop=[...currentTop].filter(id=>!prevTop.has(id));
  const leaveTop=[...prevTop].filter(id=>!currentTop.has(id));
  const enterBottom=[...currentBottom].filter(id=>!prevBottom.has(id));
  const leaveBottom=[...prevBottom].filter(id=>!currentBottom.has(id));
  const group=(title,hint,list)=>{
    const chips=list.map(x=>`<button type="button" class="class-flow-name" data-class-student="${esc(x.id)}" title="段次 ${x.gradeRank??'—'}（${classPctText(x.pct)}）">${esc(x.name)}</button>`).join('');
    return `<div class="class-flow-group"><span class="class-flow-title">${esc(title)}<span class="hint">${esc(list.length)} 人</span></span>\
${list.length?`<span class="class-flow-chips">${chips}</span>`:`<span class="hint">${esc(hint)}</span>`}</div>`;
  };
  return `<div class="panel"><h3 class="with-help">名单流动：${esc(prev.exam.name||prev.exam.date||'')} → ${esc(current.exam.name||current.exam.date||'')} ${panelHelpBtn('class.flow','名单流动的说明')}</h3>\
${group(`新进段前 ${cfg.topPercent}%`,'',namesIn(current.slice,new Set(enterTop)))}\
${group(`掉出段前 ${cfg.topPercent}%`,'没有变化',namesIn(prev.slice,new Set(leaveTop)))}\
${group(`掉进段后 ${cfg.bottomPercent}%`,'',namesIn(current.slice,new Set(enterBottom)))}\
${group(`脱离段后 ${cfg.bottomPercent}%`,'没有变化',namesIn(prev.slice,new Set(leaveBottom)))}\
</div>`;
}

// 三段构成柱状图：每根柱子 = 一场考试（默认最近 6 场，从左到右按时间正序），
// 柱内自下而上叠 段前 / 中间 / 段后 三段占比，合起来 100%。
// 宽度按“每根柱子至少这么宽”算：容器放得下就铺满，放不下就让外层横向滑动（不再被右边裁掉）。
const CLASS_STACK_LIMIT=6;
const CLASS_BAR_MIN=46;          // 手机上每根柱子最小宽度（px）
const CLASS_BAR_MIN_LARGE=96;    // 大图里每根柱子最小宽度
function classStackEntries(series,limit){
  return (series||[]).filter(x=>x.slice&&x.slice.rankedCount>0).slice(-(limit||CLASS_STACK_LIMIT));
}
function classStackMetrics(canvas,entries,opts){
  const o=opts||{};
  const wrap=canvas.parentElement;
  const avail=Math.max(240,o.forceWidth||(wrap?wrap.clientWidth:0)||(window.innerWidth||360)-40);
  const pad={top:14,right:14,bottom:o.large?44:40,left:38};
  const need=pad.left+pad.right+entries.length*(o.large?CLASS_BAR_MIN_LARGE:CLASS_BAR_MIN);
  const cssW=Math.max(avail,need);
  const baseW=o.forceWidth?cssW:avail;
  const rawH=Math.round(Math.min(baseW,avail)*0.62);
  const cssH=o.large?Math.max(380,Math.round(baseW*0.52)):Math.max(240,Math.min(420,rawH));
  return {pad,cssW,cssH};
}
// 把图真正画到 canvas 上（内联与大图共用）
function paintClassStack(canvas,entries,cfg,opts){
  const o=opts||{};
  const {pad,cssW,cssH}=classStackMetrics(canvas,entries,o);
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.style.display='block';
  // 关键：CSS 宽高都写成具体像素，否则 .chart-wrap canvas{width:auto} 会按设备像素撑出右边界
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  const plotW=cssW-pad.left-pad.right,plotH=cssH-pad.top-pad.bottom;
  const slot=plotW/entries.length;
  const barW=Math.max(14,Math.min(o.large?86:56,slot*0.58));
  const y=v=>pad.top+plotH-Math.max(0,Math.min(1,v))*plotH;
  const small=o.large?'12px system-ui,sans-serif':'11px system-ui,sans-serif';
  // 网格与 y 轴（构成图固定 0–100%）
  ctx.font=small;ctx.textAlign='right';ctx.fillStyle=o.large?'#4b5f5b':'#6b7c78';
  [0,0.25,0.5,0.75,1].forEach(v=>{
    const yy=y(v);
    ctx.strokeStyle=v===0?'#cfdad7':'#eef2f1';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();
    ctx.fillText((v*100).toFixed(0)+'%',pad.left-6,yy+4);
  });
  // 段里的自然分界（虚线）
  const baseline=(value,color)=>{
    const yy=y(value);
    ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle=color;ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();ctx.restore();
  };
  baseline(cfg.topPct,'#0f9c8f');
  baseline(1-cfg.bottomPct,'#d97706');
  // 每根柱子：从下往上 段前 → 中间 → 段后
  const colors={top:'#0f9c8f',mid:'#c9d7d4',bottom:'#f0a02a'};
  entries.forEach((x,index)=>{
    const cx=pad.left+slot*(index+0.5),left=cx-barW/2;
    const parts=[
      {value:x.slice.top.share||0,color:colors.top,label:classPctText(x.slice.top.share,0),dark:false},
      {value:x.slice.mid.share||0,color:colors.mid,label:classPctText(x.slice.mid.share,0),dark:true},
      {value:x.slice.bottom.share||0,color:colors.bottom,label:classPctText(x.slice.bottom.share,0),dark:false},
    ];
    let acc=0;
    parts.forEach(part=>{
      if(part.value<=0)return;
      const yTop=y(acc+part.value),yBottom=y(acc);
      const h=Math.max(0,yBottom-yTop);
      ctx.fillStyle=part.color;
      ctx.fillRect(left,yTop,barW,h);
      if(h>=(o.large?18:15)){
        ctx.fillStyle=part.dark?'#33534d':'#fff';
        ctx.font=small;ctx.textAlign='center';
        ctx.fillText(part.label,cx,yTop+h/2+4);
      }
      acc+=part.value;
    });
    ctx.strokeStyle='#e2eae8';ctx.lineWidth=1;
    ctx.strokeRect(left,y(1),barW,Math.max(0,y(0)-y(1)));
    // x 轴：上面一行日期，下面一行考试名
    const raw=String(x.exam.date||x.exam.name||'');
    ctx.fillStyle='#6b7c78';ctx.font=small;ctx.textAlign='center';
    ctx.fillText(raw.length>=10?raw.slice(5):raw,cx,cssH-(o.large?24:20));
    ctx.fillStyle='#93a5a1';
    ctx.fillText(String(x.exam.name||'').replace(/[-—]?\d{4}[-—]?\d{2}[-—]?\d{2}$/,'').slice(0,o.large?12:7),cx,cssH-(o.large?8:7));
  });
  return {cssW,cssH};
}
function drawClassStack(canvas,series,cfg,opts){
  if(!canvas)return false;
  const entries=classStackEntries(series,(opts&&opts.limit)||CLASS_STACK_LIMIT);
  if(!entries.length){canvas.style.display='none';return false;}
  canvas.style.display='block';
  paintClassStack(canvas,entries,cfg,opts||{});
  syncClassChartHint();
  return true;
}
// 图比容器宽时，显示“左右滑动”的提示
function syncClassChartHint(){
  const wrap=$('#classChartScroll'),hint=$('#classChartSwipeHint');
  if(!wrap||!hint)return;
  const scrollable=wrap.scrollWidth>wrap.clientWidth+2;
  hint.style.display=scrollable?'':'none';
}
function downloadCanvasPng(canvas,filename){
  if(!canvas)return;
  try{
    const link=document.createElement('a');
    link.download=filename||'三段构成.png';
    link.href=canvas.toDataURL('image/png');
    link.click();
    toast('图片已下载');
  }catch(err){toast('下载失败：'+((err&&err.message)||'未知错误'));}
}
// 点图看大图（大图里可以下载）
function openClassChartLarge(){
  const cfg=classAnalysisConfig(state.settings);
  const cls=state.currentClass?normalizeClassName(state.currentClass):'';
  const entries=classStackEntries(classAnalysisSeries(cls,cfg),CLASS_STACK_LIMIT);
  if(!entries.length){toast('这些考试都没有段次，画不出三段构成');return;}
  document.getElementById('classChartModal')?.remove();
  const modal=document.createElement('div');
  modal.id='classChartModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card chart-modal-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>三段构成 ${esc(cls)}</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="chart-large-wrap"><canvas id="classChartLarge"></canvas></div>\
<div class="chart-actions">\
<button type="button" class="primary" id="downloadClassChartLarge">下载图片</button>\
<button type="button" class="secondary" id="closeClassChartLarge">关闭</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  const canvas=modal.querySelector('#classChartLarge');
  const width=Math.max(640,Math.min(1500,Math.max((window.innerWidth||0)-80,entries.length*CLASS_BAR_MIN_LARGE+80)));
  paintClassStack(canvas,entries,cfg,{large:true,forceWidth:width});
  modal.querySelector('#downloadClassChartLarge').onclick=()=>downloadCanvasPng(canvas,`三段构成-${cls||'班级'}-${localDate()}.png`);
  modal.querySelector('#closeClassChartLarge').onclick=close;
}

// 页内交互
function bindClassAnalysisActions(){
  const back=$('#classAnalysisBack');
  if(back)back.onclick=()=>closeClassAnalysis();
  $('#saveClassParams')?.addEventListener('click',async()=>{
    const top=Number($('#classTopPct')?.value);
    const bottom=Number($('#classBottomPct')?.value);
    if(!Number.isFinite(top)||top<2||top>50||!Number.isFinite(bottom)||bottom<2||bottom>50){toast('两个百分比都要填 2–50 之间的数');return;}
    if(top+bottom>90){toast('段前 + 段后 不能超过 90%（中间段要留一点）');return;}
    state.settings=mergeConfig({...state.settings,classTopPct:top,classBottomPct:bottom});
    try{ await DB.put({id:'main',...state.settings}); }
    catch(err){ toast('保存失败：'+((err&&err.message)||'未知错误')); return; }
    renderClassAnalysis();
    toast(`已改用 段前 ${top}% / 段后 ${bottom}%`);
  });
  $$('#view-students [data-class-student]').forEach(b=>b.onclick=()=>openStudentDetail(b.dataset.classStudent));
  $$('#view-students [data-class-exam]').forEach(b=>b.onclick=()=>{
    // 点某场：把“最近一场”那块换成这场（简单做法：临时把这一场的 id 记在 state 上）
    state.classAnalysisExamId=b.dataset.classExam;
    renderClassAnalysis();
  });
  // 图：点一下看大图；两个按钮分别是“看大图”和“直接下载”
  const chart=$('#classTrend');
  if(chart)chart.onclick=()=>openClassChartLarge();
  const viewChart=$('#viewClassChart');
  if(viewChart)viewChart.onclick=()=>openClassChartLarge();
  const downloadChart=$('#downloadClassChart');
  if(downloadChart)downloadChart.onclick=()=>downloadCanvasPng($('#classTrend'),`三段构成-${state.currentClass||'班级'}-${localDate()}.png`);
  bindPanelHelp();
}
// 屏幕上图要重画：转屏/改窗口大小时按新宽度重新排柱子（宽了就出现横向滑动）
let classChartSeries=[];
window.addEventListener('resize',()=>{
  if(!state.classAnalysisOpen||state.studentDetail||!classChartSeries.length)return;
  const canvas=$('#classTrend');
  if(canvas)drawClassStack(canvas,classChartSeries,classAnalysisConfig(state.settings));
});

function openClassAnalysis(fromStudentId){
  if(!(state.examResults||[]).length){toast('还没有成绩数据，先导入几场考试成绩');return;}
  if(!state.currentClass){toast('请先在顶栏选择班级');return;}
  state.classAnalysisOpen=true;
  state.classAnalysisFromDetail=fromStudentId||'';
  state.classAnalysisExamId='';          // 每次进来都先看最近一场
  state.gradeAnalysisOpen=false;
  state.studentDetail=null;
  state.studentExamExpand=false;
  renderStudents();
  scrollViewTop('students');
}
function closeClassAnalysis(){
  const from=state.classAnalysisFromDetail||'';
  state.classAnalysisOpen=false;
  state.classAnalysisFromDetail='';
  const view=$('#view-students');
  if(view)view.onscroll=null;
  if(from){state.studentDetail=from;state.studentDetailFrom='students';renderStudents();}
  else{renderStudents();scrollViewTop('students');}
}

registerPanelHelp('class.analysis','班级分析',
  () => {
    const c=classAnalysisConfig(state.settings);
    const mid=Math.max(0,100-c.topPercent-c.bottomPercent);
    return `<p><strong>这一页在看什么</strong>：把本班每一场考试和“整个段”摆在一起——均分、班均分在段里的排名、以及段前/中间/段后三段的学生比例。</p>\
<p><strong>怎么读</strong>：均分和排名看“整体抬没抬起来”；三段占比看“结构好不好”——本班前段占比高于 ${c.topPercent}% 说明尖子比全段平均多，后段占比高于 ${c.bottomPercent}% 说明尾巴比全段平均重。逐场往下比，就能分出是某一场的波动，还是结构在变。</p>\
<p><strong>为什么比“比例”</strong>：段前 ${c.topPercent}% 本身就是全段的 ${c.topPercent}% 学生，所以本班前段占比若是 ${(c.topPercent*2)}%，就等于尖子生比全段平均多一倍。这么比不受班级人数、满分多少的影响。</p>\
<p><strong>三段怎么分</strong>：段排位 = 段次 ÷ 当场段人数（段人数取当场最大段次，缺考的人不占名次）。段次落在前 ${c.topPercent}% 的算“段前”，落在后 ${c.bottomPercent}% 的算“段后”，中间是剩下 ${mid}%。百分比在页面最下面的“分段参数”里改。</p>\
<p><strong>数据要求</strong>：班均分排名和段均分需要导入“全年段汇总表”（带班级列、包含其它班）；只导入本班数据时这两项显示 —，三段占比照样能算。换过班的学生按“当场记录的班级”统计，历次对比不会把人算串。</p>`;
  });

registerPanelHelp('class.ranks','年段班级排名',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p>这张表只针对<strong>当前这场考试</strong>（标题右边写着是哪一场；点上方考试标签可以换场次）。</p>\
<p><strong>平均得分率</strong> = 该班这场考试的<strong>平均分 ÷ 这场满分</strong>。用得分率而不是原始分，是为了不同场次、不同满分之间也能比。</p>\
<p><strong>名次</strong>：按平均得分率从高到低排，<strong>数值相同算并列</strong>（名次会跳过，例如两个第 3 名之后是第 5 名）。<strong>人数</strong>是该班这场有成绩的人数。</p>\
<p><strong>高亮行</strong>就是当前班；最后一行「全段」是全体学生的平均得分率，用来一眼看出本班在段平均之上还是之下。表里的横条长度＝得分率大小，越长越好。</p>\
<p>只导入了本班数据时这里只会有一行（本班＝全段），要跟别的班比就导入全年段汇总表（带班级列、包含其它班）。三段占比用的是段次，和这张表的数据源不同，所以可能一张有数据、另一张显示 —。</p>`;
  });

registerPanelHelp('class.params','分段参数',
  () => {
    const c=classAnalysisConfig(state.settings);
    const mid=Math.max(0,100-c.topPercent-c.bottomPercent);
    return `<p><strong>段前 ${c.topPercent}%</strong>：段次 ≤ 段人数 × ${c.topPercent}% 的人（也就是段排位在前 ${c.topPercent}% 的那批）。</p>\
<p><strong>段后 ${c.bottomPercent}%</strong>：段次 &gt; 段人数 × ${(100-c.bottomPercent)}% 的人。</p>\
<p><strong>中间段</strong>：剩下的 ${mid}%，不用填，自动就是这么些。</p>\
<p>两个数都按百分数填（15 = 15%），范围 2–50，两者加起来不超过 90。改完点“保存”立即生效，也存在本机（重启/换页都还在）；设置页“班级分析”里有同一组参数，两边改哪个都一样。</p>`;
  });

registerPanelHelp('class.latest','本场概览',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p>这一块是“某一场考试”的本班与段对比，默认最近一场；点标题上方那排考试标签可以切到别的场次。</p>\
<p><strong>本班人数</strong>：这场考试有成绩的本班人数（缺考的不算）。<br>\
<strong>本班均分 / 段均分</strong>：全班、全段有效成绩的平均分（满分见卡片下方小字）。<br>\
<strong>班均分排名</strong>：把段里每个班的均分从高到低排，本班是第几名；均分相同的算并列，分母是“这场考试有成绩的班级数”。<br>\
<strong>段前 ${c.topPercent}% / 段后 ${c.bottomPercent}%</strong>：本班多少人在段前/段后区间，占本班有段次人数的百分比。</p>\
<p><strong>三条横条</strong>：实心条是本班实际占比，细竖线是“段里的自然比例”（段前 ${c.topPercent}% / 中间 ${Math.max(0,100-c.topPercent-c.bottomPercent)}% / 段后 ${c.bottomPercent}%）。条比竖线长，就说明本班这一类学生比全段平均多。</p>\
<p>有成绩但没有段次的学生（缺考或缺列）不计入三段占比，会在下方单独提示人数。</p>`;
  });

registerPanelHelp('class.table','逐场对比',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p>每行是一场考试，<strong>新的在上面</strong>（和下面的图表顺序相反：图是从早到晚）。</p>\
<p><strong>本班均分 / 段均分</strong>：这场考试本班与全段的平均分。<br>\
<strong>班排名</strong>：本班均分在段里的名次（M/N 个班）；只有一个班有数据时显示 —。<br>\
<strong>段前 ${c.topPercent}% / 中间 / 段后 ${c.bottomPercent}%</strong>：人数，后面小字是占本班有段次人数的百分比。</p>\
<p>“—”表示这场考试缺这类数据（例如没有段次列，或只导入了本班）。拿它和上面那张表对照，可以找出哪几场是结构变化、哪几场只是均分波动。</p>`;
  });

registerPanelHelp('class.stack','三段构成',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p><strong>每根柱子＝一场考试</strong>，从左到右按时间先后（最左边最早、最右边最近），默认只画最近 ${CLASS_STACK_LIMIT} 场。</p>\
<p><strong>柱子怎么叠</strong>：自下而上是 段前 ${c.topPercent}% → 中间段 → 段后 ${c.bottomPercent}%，三段加起来正好 100%，所以柱子高度都一样，比的是“内部的构成”。</p>\
<p><strong>两条虚线</strong>：段里的自然分界——下面那条在 ${c.topPercent}% 的高度、上面那条在 ${100-c.bottomPercent}% 的高度。如果每根柱子的分界线都贴着虚线，说明本班的构成和全段平均一样；青色块比虚线高＝尖子多，橙色块压过下面那条虚线越多＝尾巴越重。</p>\
<p><strong>看图操作</strong>：柱子比屏幕宽时可以直接左右滑动（会提示“左右滑动看图”）；<strong>点图</strong>或点“查看大图”可以放大看，大图里点“下载图片”存 PNG。柱子太密时用大图看更清楚。</p>`;
  });

registerPanelHelp('class.flow','名单流动',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p>比较“当前这一场”和它<strong>前一场</strong>，看谁进出两个临界区间：</p>\
<p>· <strong>新进段前 ${c.topPercent}%</strong>：这一场才进前段的人（前一场不在）<br>\
· <strong>掉出段前 ${c.topPercent}%</strong>：前一场在前段、这一场掉出来了<br>\
· <strong>掉进段后 ${c.bottomPercent}%</strong>：这一场落到后段的人<br>\
· <strong>脱离段后 ${c.bottomPercent}%</strong>：前一场在后段、这一场爬上来了</p>\
<p>点名字可以直接进这位学生的详情页；想换看别的场次，就点上方的考试标签，默认是最近一场与其前一场。</p>`;
  });
