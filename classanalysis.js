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

// 原始文件口径（这场文件里出现的所有班，含被排除的重点班）：只用来做“全段”对照
function examGradeBoardRaw(examId){
  const rows=[];
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const result=r.result||{};
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;
    rows.push({cls:normalizeClassName(result.className),score});
  });
  const boxes=new Map();
  let sum=0;
  rows.forEach(x=>{
    sum+=x.score;
    const box=boxes.get(x.cls)||{className:x.cls,count:0,sum:0};
    box.count++;box.sum+=x.score;boxes.set(x.cls,box);
  });
  const classList=[...boxes.values()].map(c=>({className:c.className,count:c.count,avg:c.sum/c.count}))
    .sort((a,b)=>b.avg-a.avg||String(a.className).localeCompare(String(b.className),'zh-CN'));
  let rank=0,prev=null;
  classList.forEach((c,index)=>{
    if(prev===null||Math.abs(c.avg-prev)>1e-9){rank=index+1;prev=c.avg;}
    c.rank=rank;
  });
  return {count:rows.length,sum,avg:rows.length?sum/rows.length:null,
    classList,byClass:new Map(classList.map(c=>[c.className,c]))};
}

// 一场考试在“参照池”里的账：池内人数、段均分、每个班的均分与名次（均分相同算并列）
// 池 = 全部班 − 设置里排除的重点班（见 segment.js）。排除后，重点班临时加入的场次不会把
// 段均分抬高、把本班名次推后；原始文件口径另外存一份 raw，用于“全段 / 平行班”双口径显示。
function examGradeBoard(examId){
  const pool=segmentRanks(examId);
  return {
    count:pool.count,sum:pool.sum,segSize:pool.size,avg:pool.avg,
    classList:pool.classList,byClass:pool.byClass,ranks:pool.ranks,
    excludedCount:pool.excludedCount,excludedClasses:pool.excludedClasses,
    raw:pool.excludedCount>0?examGradeBoardRaw(examId):null,
  };
}

// 本班在这一场的账：均分、班级排名、三段（段前 X% / 中间 / 段后 Y%）的人数与名单
// 按“当场记录的班级”统计：换过班的学生会算进当时那个班，历次对比不会串班。
function classExamSlice(examId,className,config){
  const cfg=config||classAnalysisConfig(state.settings);
  const seg=examGradeBoard(examId);
  const cls=normalizeClassName(className);
  // 本班自己被排除在参照池外时（一般不会），这一段退回“文件校次 + 全段人数”，页面上另给提示
  const inPool=!segmentIsExcluded(cls);
  const segSize=inPool?seg.segSize:(seg.raw?seg.raw.count:0);
  const slice={examId,className:cls,seg,segSize,inPool,count:0,sum:0,avg:null,rank:null,classCount:seg.classList.length,
    top:{count:0,students:[]},mid:{count:0,students:[]},bottom:{count:0,students:[]},noRank:0};
  (state.examResults||[]).forEach(r=>{
    if(!r||r.examId!==examId)return;
    const result=r.result||{};
    if(normalizeClassName(result.className)!==cls)return;
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;
    slice.count++;slice.sum+=score;
    // 段次用参照池里的重算值（与学校校次口径一致），不再直接读文件里的校次
    const gradeRank=inPool?(seg.ranks.get(r.studentId)||0):rankNumber(result.gradeRank);
    const pct=(gradeRank&&segSize)?gradeRank/segSize:null;
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
  // 文件口径（全部班）的班排名，用于“全段 10/21”的对照；没有排除班时为 null
  slice.rawRank=seg.raw&&seg.raw.byClass.has(cls)?seg.raw.byClass.get(cls).rank:null;
  slice.rawClassCount=seg.raw?seg.raw.classList.length:null;
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
// 重画时保住两个滚动位置：整页纵向滚动、顶部考试标签条的横向位置。
// 否则点一下标签，innerHTML 一换，标签条就回到最左边，刚点的那个标签跑掉了。
let classViewScroll=0;
let classChipScroll=0;
function captureClassAnalysisScroll(){
  const view=$('#view-students');
  if(view)classViewScroll=view.scrollTop;
  const strip=$('#classExamChips');
  if(strip)classChipScroll=strip.scrollLeft;
}
function restoreClassAnalysisScroll(){
  const view=$('#view-students');
  if(view&&view.scrollTop!==classViewScroll)view.scrollTop=classViewScroll;
  const strip=$('#classExamChips');
  if(!strip)return;
  strip.scrollLeft=classChipScroll;
  // 当前选中的标签若在可视区外，再把它轻轻挪进来（只动标签条，不动整页）
  const active=strip.querySelector('.is-active');
  if(!active)return;
  const left=active.offsetLeft,right=left+active.offsetWidth;
  if(left<strip.scrollLeft+4)strip.scrollLeft=Math.max(0,left-10);
  else if(right>strip.scrollLeft+strip.clientWidth-4)strip.scrollLeft=right-strip.clientWidth+10;
  classChipScroll=strip.scrollLeft;
}
function renderClassAnalysis(){
  const view=$('#view-students');
  if(!view)return;
  captureClassAnalysisScroll();
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
  const totalScore=Number(focus.exam.totalScore)||0;
  // 差距图的场次与统一刻度（段均分当 0 线、班与班之间的标准差当尺子）
  const gapEntries=classGapEntries(withData,CLASS_GAP_LIMIT);
  const gapStats=gapEntries.length>=2?classGapStats(gapEntries):null;
  const focusGap=gapStats?(gapStats.rows.find(r=>r.exam.id===focus.exam.id)||null):null;
  // 参照池提示：排除重点班后，段均分/班排名/三段占比/差距图都只算池内的班（见 segment.js）
  const excludedList=(typeof segmentExcluded==='function')?[...segmentExcluded()]:[];
  const poolBadge=excludedList.length
    ?`<p class="hint pool-badge">段口径：平行班（已排除 ${excludedList.map(esc).join('、')}）——段均分、班排名、三段占比、差距图都只算池内的班</p>`
    :'';
  // 本班均分后面跟“和段均分的差”，正数绿色、负数红色
  const avgDiff=(s.avg!==null&&seg.avg!==null)?(s.avg-seg.avg):null;
  const avgDiffHtml=avgDiff===null?''
    :`<span class="class-kpi-diff ${avgDiff>=0?'is-up':'is-down'}">(${avgDiff>=0?'+':'-'}${Math.abs(avgDiff).toFixed(1)})</span>`;
  // 第三张卡：这场和段均分相差几个 σ*，档位用文字写（持平 / 略 / 明显 / 突出）
  // 班均分排名用参照池（平行班）口径；有排除班时把“全段”名次放在小字里对照
  const rankHint=hasSegPeer
    ?(s.rawRank?`全段 ${s.rawRank}/${s.rawClassCount}`:`共 ${s.classCount} 个班`)
    :'缺全年段数据';
  const kpis=[
    {label:'本班均分',value:classFix(s.avg),html:avgDiffHtml,hint:`满分 ${classFix(focus.exam.totalScore)}`},
    {label:'班均分排名',value:(s.rank&&hasSegPeer)?`第 ${s.rank} / ${s.classCount}`:'—',hint:rankHint},
    {label:'与段均分相差',
      value:(focusGap&&focusGap.z!==null)?`${focusGap.d>=0?'+':'-'}${Math.abs(focusGap.z).toFixed(1)}σ`:'—',
      hint:(focusGap&&focusGap.tier)?focusGap.tier.text:(hasSegPeer?'场次不足':'缺全年段数据')},
  ];
  const kpiHtml=kpis.map(k=>`<div class="class-kpi"><span class="class-kpi-label">${esc(k.label)}</span>\
<strong class="class-kpi-value">${esc(k.value)}${k.html||''}</strong>${k.hint?`<span class="hint">${esc(k.hint)}</span>`:''}</div>`).join('');
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
  const excludedHere=(seg.excludedClasses||[]);
  const rankPanel=`<div class="panel" id="classRankPanel">\
<h3 class="with-help">年段班级排名 ${panelHelpBtn('class.ranks','年段班级排名的说明')}<span class="hint">${examLine}</span></h3>\
<div class="class-table-wrap"><table class="class-table class-rank-table">\
<thead><tr><th>名次</th><th>班级</th><th>平均得分率</th><th>人数</th></tr></thead>\
<tbody>${rankRows||'<tr><td colspan="4" class="hint">这场考试没有可比较的班级数据</td></tr>'}</tbody>\
<tfoot><tr><td>—</td><td>段均分</td><td class="class-rank-rate"><b>${classPctText(segRate,1)}</b></td><td>${seg.count}</td></tr></tfoot>\
</table></div>\
${excludedHere.length?`<p class="hint">本场文件里还有 ${excludedHere.map(esc).join('、')}，已按「参照池」排除（不参与段均分与名次）。文件口径的全段名次见下面「逐场对比」里的小字。</p>`:''}\
${seg.classList.length<2?'<p class="hint">库里只有本班的数据，导入全年段汇总表才能和其它班比。</p>':''}\
</div>`;
  // 逐场对比表（新的在上面）
  const tableRows=[...withData].reverse().map(x=>{
    const sc=x.slice;
    return `<tr><td>${esc(x.exam.name||'')}<br><small class="hint">${esc(x.exam.date||'')}</small></td>\
<td>${classFix(sc.avg)}</td>\
<td>${x.slice.seg.avg===null?'—':classFix(x.slice.seg.avg)}</td>\
<td>${sc.rank&&x.slice.seg.classList.length>1?`${sc.rank}/${x.slice.classCount}${sc.rawRank?`<small class="hint"> 全段 ${sc.rawRank}/${sc.rawClassCount}</small>`:''}`:'—'}</td>\
<td>${sc.top.count} <small class="hint">${classPctText(sc.top.share,0)}</small></td>\
<td>${sc.mid.count} <small class="hint">${classPctText(sc.mid.share,0)}</small></td>\
<td>${sc.bottom.count} <small class="hint">${classPctText(sc.bottom.share,0)}</small></td></tr>`;
  }).join('');
  const table=`<div class="class-table-wrap"><table class="class-table">\
<thead><tr><th>考试</th><th>本班均分</th><th>段均分</th><th>班排名</th><th>段前 ${cfg.topPercent}%</th><th>中间</th><th>段后 ${cfg.bottomPercent}%</th></tr></thead>\
<tbody>${tableRows}</tbody></table></div>`;
  // 学生分布详情：本场段前 / 段后两份名单（连续两场用彩框、连续三场用反色）
  const prev2=focusIndex>1?withData[focusIndex-2]:null;
  const flow=prev?classFlowHtml(prev,focus,cfg,prev2):'';
  // 近 6 次考试的“本班段排名”折线（名次越小越好，所以纵轴 1 在最上面）
  const rankLineEntries=classRankEntries(withData,CLASS_RANK_LINE_LIMIT);
  const rankLinePanel=rankLineEntries.length>=2
    ?`<div class="panel" id="classRankLinePanel"><h3 class="with-help">近 ${rankLineEntries.length} 次考试的段排名变化 ${panelHelpBtn('class.rankline','段排名折线的说明')}<span class="hint">数字越小越好</span></h3>\
<div class="class-chart-scroll" id="classRankLineScroll"><canvas id="classRankLine" class="class-chart-canvas" title="点一下看大图"></canvas></div>\
<p class="hint class-chart-swipe" id="classRankLineSwipeHint" style="display:none">← 左右滑动看图 →</p>\
<div class="class-chart-actions">\
<button type="button" class="secondary" id="viewClassRankLine">查看大图</button>\
<button type="button" class="secondary" id="downloadClassRankLine">下载图片</button>\
</div>\
</div>`
    :`<div class="panel"><h3>段排名变化</h3><div class="empty">至少要有两次“多班对比”的考试，才能画出段排名的变化</div></div>`;
  // 近 6 次“本班与段均分的差距”：段均分当 0 线，±1σ* 是“班与班之间的正常差距”（σ* 由这几场合并）
  const gapNotes=[];
  if(!hasSegPeer)gapNotes.push('库里只有本班数据，段均分和班间刻度都算不出来；导入全年段汇总表就能看到。');
  const gapSkipped=withData.filter(x=>classRateOf(x.exam,x.slice.avg)===null).length;
  if(gapSkipped)gapNotes.push(`有 ${gapSkipped} 场考试没填满分，算不出得分率，没画进这张图（在设置页补上考试总分即可）。`);
  if(withData.length>CLASS_GAP_LIMIT)gapNotes.push(`共 ${withData.length} 场，这里只画最近 ${CLASS_GAP_LIMIT} 场；更早的看下面的逐场对比表。`);
  const gapNoteHtml=gapNotes.map(t=>`<p class="hint">${esc(t)}</p>`).join('');
  const gapPanel=(gapStats&&gapStats.rows.length>=2)
    ?`<div class="panel" id="classGapPanel"><h3 class="with-help">近 ${gapStats.rows.length} 场：本班与段均分的差距 ${panelHelpBtn('class.gap','差距图的说明')}<span class="hint" id="classGapSigma">统一刻度 …</span></h3>\
<div class="class-legend">\
<span class="class-legend-item"><i class="is-me"></i>本班</span>\
<span class="class-legend-item"><i class="is-zero"></i>段均分（0 线）</span>\
<span class="class-legend-item"><i class="is-own"></i>本班常态</span>\
<span class="class-legend-item"><i class="is-band2"></i>±1σ* 班间差距</span>\
<span class="hint">纵轴：本班 − 段（百分点）</span>\
</div>\
<div class="class-chart-scroll" id="classGapScroll"><canvas id="classGapChart" class="class-chart-canvas" title="点一下看大图"></canvas></div>\
<p class="hint" id="classGapSummary">${esc(classGapSummary(gapStats))}</p>\
<div class="class-chart-actions">\
<button type="button" class="secondary" id="viewClassGap">查看大图</button>\
<button type="button" class="secondary" id="downloadClassGap">下载图片</button>\
</div>\
${gapNoteHtml}\
</div>`
    :`<div class="panel"><h3>与段均分的差距</h3><div class="empty">至少要有两场“多班对比”的考试，才能画出和段平均的差距</div></div>`;
  const excludedBanner=s.inPool?'':`<p class="hint pool-badge">本班（${esc(cls)}）在参照池的排除名单里，下面的段统计退回“文件校次 + 全段人数”。要到“设置 → 段排名参照池”里把它去掉。</p>`;
  view.innerHTML=`<div class="panel grade-analysis-head-panel" id="classAnalysisHead">\
<div class="grade-analysis-head">\
<h2 class="with-help">班级分析 ${panelHelpBtn('class.analysis','班级分析的说明')}
<span class="hint grade-total">${esc(cls)} · 共 ${withData.length} 场</span></h2>\
${backBtn}\
</div>\
<div class="grade-chips" id="classExamChips">${[...withData].reverse().slice(0,12).map((x,i)=>`<button type="button" class="grade-jump${x===focus?' is-active':''}" data-class-exam="${esc(x.exam.id)}">${esc(x.exam.name||x.exam.date||'')}</button>`).join('')}</div>\
${poolBadge}\
${excludedBanner}\
</div>\
<div class="panel" id="classLatestPanel">\
<h3 class="with-help">${focus===latest?'最近一场：':''}${examLine} ${panelHelpBtn('class.latest','本场概览的说明')}</h3>\
<div class="class-kpis">${kpiHtml}</div>\
${bars}\
</div>\
${rankLinePanel}\
${gapPanel}\
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
${rankPanel}\
<div class="panel"><h3 class="with-help">逐场对比 ${panelHelpBtn('class.table','逐场对比的说明')}</h3>${table}</div>\
${paramPanel}`;
  bindClassAnalysisActions();
  classChartSeries=withData;
  drawClassStack($('#classTrend'),withData,cfg);
  drawClassRankLine($('#classRankLine'),withData);
  drawClassGap($('#classGapChart'),withData);
  restoreClassAnalysisScroll();
}

// 学生分布详情：本场段前 / 段后两份名单
// 标注分三档：白底＝这一场才进来；彩框＝上一场也在同一组；反色（深底浅字）＝连续三场都在同一组
function classFlowHtml(prev,current,cfg,prev2){
  // prev / current / prev2 都是“场次条目”{exam, slice}，学生名单在 entry.slice.top|bottom.students 里
  const idsOf=(entry,key)=>{
    const box=entry&&entry.slice?entry.slice[key]:null;
    return new Set(((box&&box.students)||[]).map(x=>x.id));
  };
  const prevTop=idsOf(prev,'top'),prevBottom=idsOf(prev,'bottom');
  const prev2Top=prev2?idsOf(prev2,'top'):new Set();
  const prev2Bottom=prev2?idsOf(prev2,'bottom'):new Set();
  const group=(label,list,prevSet,prev2Set,tone)=>{
    const chips=list.map(x=>{
      const kept=prevSet.has(x.id);
      const third=kept&&prev2Set.has(x.id);
      const cls=`class-flow-name ${tone}${third?' is-third':(kept?' is-again':'')}`;
      const notes=third?'连续三场都在这一组':(kept?'上一场也在这一组':'这一场才进来');
      return `<button type="button" class="${cls}" data-class-student="${esc(x.id)}" \
title="段次 ${x.gradeRank??'—'}（段排位 ${classPctText(x.pct)}）· ${notes}">${esc(x.name)}</button>`;
    }).join('');
    return `<div class="class-flow-group">\
<span class="class-flow-title">${esc(label)}<span class="hint">${list.length} 人</span></span>\
${list.length?`<span class="class-flow-chips">${chips}</span>`:'<span class="hint">这一场没有</span>'}</div>`;
  };
  return `<div class="panel"><h3 class="with-help">学生分布详情 ${panelHelpBtn('class.flow','学生分布详情的说明')}</h3>\
${group(`段前 ${cfg.topPercent}%`,current.slice.top.students,prevTop,prev2Top,'is-top')}\
${group(`段后 ${cfg.bottomPercent}%`,current.slice.bottom.students,prevBottom,prev2Bottom,'is-bottom')}\
</div>`;
}

// 三段构成柱状图：每根柱子 = 一场考试（默认最近 6 场，从左到右按时间正序），
// 柱内自下而是 段后 / 中间 / 段前（绿在上、黄在下），三段占比合起来 100%。
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
  // 段里的自然分界（虚线）：柱内自下而是 段后 / 中间 / 段前，
  // 所以下面那条在「段后占比」的高度、上面那条在「100%−段前占比」的高度
  const baseline=(value,color)=>{
    const yy=y(value);
    ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle=color;ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();ctx.restore();
  };
  baseline(cfg.bottomPct,'#d97706');        // 段后 与 中间 的分界
  baseline(1-cfg.topPct,'#0f9c8f');         // 中间 与 段前 的分界
  // 每根柱子：自下而上是 段后 → 中间 → 段前（绿在上、黄在下）
  const colors={top:'#0f9c8f',mid:'#c9d7d4',bottom:'#f0a02a'};
  entries.forEach((x,index)=>{
    const cx=pad.left+slot*(index+0.5),left=cx-barW/2;
    const parts=[
      {value:x.slice.bottom.share||0,color:colors.bottom,label:classPctText(x.slice.bottom.share,0),dark:false},
      {value:x.slice.mid.share||0,color:colors.mid,label:classPctText(x.slice.mid.share,0),dark:true},
      {value:x.slice.top.share||0,color:colors.top,label:classPctText(x.slice.top.share,0),dark:false},
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

// ---------- 段排名折线：本班近几次考试“班均分在段里的名次” ----------
// 名次越小越好，所以纵轴把第 1 名放在最上面；每个点旁边写“第M/N个班”。
const CLASS_RANK_LINE_LIMIT=6;
function classRankEntries(series,limit){
  return (series||[])
    .filter(x=>x.slice&&x.slice.rank&&x.slice.classCount>1)
    .slice(-(limit||CLASS_RANK_LINE_LIMIT));
}
function paintClassRankLine(canvas,entries,opts){
  const o=opts||{};
  const wrap=canvas.parentElement;
  const avail=Math.max(240,o.forceWidth||(wrap?wrap.clientWidth:0)||(window.innerWidth||360)-40);
  const cssW=avail;
  const cssH=o.large?Math.max(300,Math.round(cssW*0.5)):Math.max(200,Math.round(cssW*0.62));
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.style.display='block';
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  const pad={top:o.large?20:16,right:o.large?30:20,bottom:o.large?48:42,left:o.large?46:38};
  const plotW=Math.max(40,cssW-pad.left-pad.right),plotH=Math.max(60,cssH-pad.top-pad.bottom);
  const small=o.large?'12px system-ui,sans-serif':'11px system-ui,sans-serif';
  const maxRank=Math.max(1,...entries.map(x=>x.slice.classCount||1));
  const x=i=>pad.left+(entries.length===1?plotW/2:i*plotW/(entries.length-1));
  const y=rank=>pad.top+(Math.max(1,Math.min(maxRank,rank))-1)/Math.max(1,maxRank-1)*plotH;
  const teal='#0f766e';
  // 横向网格 + 名次刻度（1、中位、末尾）
  const ticks=[...new Set([1,Math.round((1+maxRank)/2),maxRank])].filter(v=>v>=1);
  ctx.font=small;ctx.textAlign='right';
  ticks.forEach(v=>{
    const yy=y(v);
    ctx.strokeStyle=v===1?'#dfe8e6':'#eef2f1';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();
    ctx.fillStyle='#6b7c78';
    ctx.fillText('第'+v,pad.left-6,yy+4);
  });
  // 折线
  ctx.strokeStyle=teal;ctx.lineWidth=2.4;
  ctx.beginPath();
  entries.forEach((x2,i)=>{
    const px=x(i),py=y(x2.slice.rank);
    if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  });
  ctx.stroke();
  // 点 + 名次标签
  entries.forEach((x2,i)=>{
    const px=x(i),py=y(x2.slice.rank);
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(px,py,3.8,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=teal;ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#33534d';ctx.font=small;ctx.textAlign='center';
    ctx.fillText(`${x2.slice.rank}/${x2.slice.classCount}`,px,py-9);
    // x 轴：上日期、下考试名
    const raw=String(x2.exam.date||'');
    ctx.fillStyle='#6b7c78';
    ctx.fillText(raw.length>=10?raw.slice(5):raw,px,cssH-(o.large?26:22));
    ctx.fillStyle='#93a5a1';
    ctx.fillText(String(x2.exam.name||'').replace(/[-—]?\d{4}[-—]?\d{2}[-—]?\d{2}$/,'').slice(0,o.large?12:6),px,cssH-(o.large?9:8));
  });
  return {cssW,cssH};
}
function drawClassRankLine(canvas,series,opts){
  if(!canvas)return false;
  const entries=classRankEntries(series,(opts&&opts.limit)||CLASS_RANK_LINE_LIMIT);
  if(!entries.length){canvas.style.display='none';return false;}
  paintClassRankLine(canvas,entries,opts||{});
  const wrap=canvas.parentElement,hint=wrap?wrap.parentElement.querySelector('.class-chart-swipe'):null;
  if(hint)hint.style.display=(wrap.scrollWidth>wrap.clientWidth+2)?'':'none';
  return true;
}
// ---------- 差距图：本班与段均分的差 + “班与班之间”的标准差（统一刻度） ----------
// 段均分画成 0 线，纵轴是「本班 − 段」（百分点，满分差异已经除掉）。
// 尺子不是学生之间的离散，而是**各个班均分之间**的离散：每场先算 k 个班均分的样本标准差 s，
// 再按自由度把几场合并成一把统一刻度 σ*，于是 z = 差距 / σ* 可以跨场比、也能说“差多少才算大”。
// 学生之间的 σ（十分上下）大约是班间 σ（四五分）的两倍半，拿它当尺子会把真实差距压掉六成。
const CLASS_GAP_LIMIT=6;
const CLASS_GAP_SIGMA_FLOOR=0.015;   // σ* 下限 1.5 个百分点：班间几乎没差别时防止 z 爆炸
const CLASS_GAP_MIN_SPAN=0.06;       // 纵轴最小跨度 6 个百分点，免得 1 分的波动画成断崖
const CLASS_GAP_TIERS=[0.5,1,1.5];   // 持平 / 略 / 明显 / 突出 的分界（|z|）
function classRateOf(exam,value){
  const total=Number(exam&&exam.totalScore)||0;
  return (total>0&&value!==null&&value!==undefined&&Number.isFinite(Number(value)))?Number(value)/total:null;
}
// 能画进差距图的场次：本班有均分、段里至少两个班、且这一场填了满分
function classGapEntries(series,limit){
  return (series||[]).filter(x=>{
    if(!x.slice||x.slice.avg===null)return false;
    if((x.slice.classCount||0)<2)return false;
    const seg=x.slice.seg||{};
    return classRateOf(x.exam,x.slice.avg)!==null&&classRateOf(x.exam,seg.avg)!==null;
  }).slice(-(limit||CLASS_GAP_LIMIT));
}
function classGapTier(z){
  if(z===null||z===undefined||!Number.isFinite(z))return null;
  const a=Math.abs(z),t=CLASS_GAP_TIERS;
  const idx=a<t[0]?0:a<t[1]?1:a<t[2]?2:3;
  const up=z>0;
  const words=up?['基本持平','略高于段平均','明显高于段平均','突出高于段平均']
    :['基本持平','略低于段平均','明显低于段平均','突出低于段平均'];
  return {idx,up,text:words[idx]};
}
// 每场的差距 d、场内班间标准差 s，以及合并出来的统一刻度 σ*
function classGapStats(entries){
  const rows=(entries||[]).map((x,i)=>{
    const seg=x.slice.seg||{};
    const me=classRateOf(x.exam,x.slice.avg);
    const segRate=classRateOf(x.exam,seg.avg);
    const rates=(seg.classList||[]).map(c=>classRateOf(x.exam,c.avg)).filter(v=>v!==null);
    const k=rates.length;
    const mean=k?rates.reduce((a,b)=>a+b,0)/k:null;
    const s=k>1?Math.sqrt(rates.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(k-1)):null;
    return {i,exam:x.exam,slice:x.slice,me,seg:segRate,d:(me===null||segRate===null)?null:me-segRate,k,s};
  });
  const usable=rows.filter(r=>r.s!==null&&r.k>1);
  const df=usable.reduce((a,r)=>a+(r.k-1),0);
  const pooled=df>0?Math.sqrt(usable.reduce((a,r)=>a+(r.k-1)*r.s*r.s,0)/df):null;
  const sigma=pooled===null?null:Math.max(CLASS_GAP_SIGMA_FLOOR,pooled);
  rows.forEach(r=>{
    r.z=(sigma&&r.d!==null)?r.d/sigma:null;
    r.tier=classGapTier(r.z);
  });
  const gaps=rows.map(r=>r.d).filter(v=>v!==null);
  const meanGap=gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:null;
  return {rows,sigma,pooled,df,meanGap};
}
// 纵轴：差距、±1σ* 带、本班常态都收进来；刻度取 1 / 2 / 5 个百分点一档
function classGapDomain(stats){
  const pts=[0];
  (stats.rows||[]).forEach(r=>{if(r.d!==null)pts.push(r.d);});
  if(stats.sigma){pts.push(stats.sigma,-stats.sigma);}
  if(stats.meanGap!==null)pts.push(stats.meanGap);
  let lo=Math.min(...pts),hi=Math.max(...pts);
  const pad=Math.max(0.01,(hi-lo)*0.14);
  lo-=pad;hi+=pad;
  if(hi-lo<CLASS_GAP_MIN_SPAN){const mid=(hi+lo)/2;lo=mid-CLASS_GAP_MIN_SPAN/2;hi=mid+CLASS_GAP_MIN_SPAN/2;}
  let step=0.05;
  for(const s of [0.01,0.02,0.05]){if((hi-lo)/s<=8){step=s;break;}}
  return {lo,hi,step};
}
// 一句话总结，写在图下面
function classGapSummary(stats){
  const rows=((stats&&stats.rows)||[]).filter(r=>r.z!==null&&r.d!==null);
  if(!rows.length)return '';
  const up=rows.filter(r=>r.d>0).length;
  const strong=rows.filter(r=>Math.abs(r.z)>=CLASS_GAP_TIERS[1]).length;
  const flat=rows.filter(r=>Math.abs(r.z)<CLASS_GAP_TIERS[0])
    .map(r=>String(r.exam.date||r.exam.name||'').slice(5)).filter(Boolean);
  let text=`${rows.length} 场里 ${up} 场高于段平均`;
  if(strong)text+=`，${strong} 场差距在 1σ* 以上`;
  if(flat.length)text+=`；${flat.join('、')} 基本持平`;
  return text+'。';
}
function paintClassGap(canvas,stats,opts){
  const o=opts||{};
  const entries=stats.rows||[];
  const wrap=canvas.parentElement;
  const avail=Math.max(240,o.forceWidth||(wrap?wrap.clientWidth:0)||(window.innerWidth||360)-40);
  const cssW=avail;
  const cssH=o.large?Math.max(300,Math.round(cssW*0.5)):Math.max(210,Math.round(cssW*0.66));
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.style.display='block';
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  const small=o.large?'12px system-ui,sans-serif':'11px system-ui,sans-serif';
  const tiny=o.large?'11px system-ui,sans-serif':'10px system-ui,sans-serif';
  const pad={top:o.large?46:40,right:o.large?40:26,bottom:o.large?46:40,left:o.large?54:44};
  const plotW=Math.max(40,cssW-pad.left-pad.right),plotH=Math.max(60,cssH-pad.top-pad.bottom);
  const domain=classGapDomain(stats);
  const n=entries.length;
  const x=i=>pad.left+(n===1?plotW/2:i*plotW/(n-1));
  const y=v=>pad.top+(domain.hi-Math.max(domain.lo,Math.min(domain.hi,v)))/((domain.hi-domain.lo)||1)*plotH;
  const blue='#1d4ed8',blueDark='#1e3a8a',muted='#6b7c78';
  const bandFill='rgba(29,78,216,0.07)',zeroLine='#33534d';
  const sigma=stats.sigma;
  const fmt=v=>`${v>=0?'+':'-'}${(Math.abs(v)*100).toFixed(1)}`;
  // 1) ±1σ* 浅带（段里的“正常差距”）+ 上下沿细线
  if(sigma){
    const top=y(sigma),bottom=y(-sigma);
    ctx.fillStyle=bandFill;
    ctx.fillRect(pad.left,top,plotW,bottom-top);
    ctx.strokeStyle='rgba(29,78,216,0.22)';ctx.lineWidth=1;
    [top,bottom].forEach(yy=>{ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();});
  }
  // 2) 横网格 + 百分点刻度（刻度落在 step 的整数倍上，但纵轴不必从整数倍开始）
  ctx.font=small;ctx.textAlign='right';
  const firstTick=Math.ceil(domain.lo/domain.step-1e-9)*domain.step;
  for(let v=firstTick;v<=domain.hi+1e-9;v+=domain.step){
    const yy=y(v);
    ctx.strokeStyle='#eef2f1';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();
    ctx.fillStyle=muted;
    ctx.fillText(`${v>1e-9?'+':''}${Math.round(v*100)}`,pad.left-6,yy+4);
  }
  // 3) 0 线＝段均分（标准线）
  const zero=y(0);
  ctx.strokeStyle=zeroLine;ctx.lineWidth=1.6;
  ctx.beginPath();ctx.moveTo(pad.left,zero);ctx.lineTo(pad.left+plotW,zero);ctx.stroke();
  // 4) 本班常态（这几场差距的平均）
  if(stats.meanGap!==null){
    const yy=y(stats.meanGap);
    ctx.save();ctx.strokeStyle=muted;ctx.lineWidth=1.4;ctx.setLineDash([6,4]);
    ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+plotW,yy);ctx.stroke();
    ctx.restore();
  }
  // 6) 本班折线 + 点 + 数值
  const run=entries.filter(r=>r.d!==null);
  if(run.length>1){
    ctx.save();ctx.strokeStyle=blue;ctx.lineWidth=2.6;
    ctx.beginPath();
    run.forEach((r,idx)=>{const px=x(r.i),py=y(r.d);idx?ctx.lineTo(px,py):ctx.moveTo(px,py);});
    ctx.stroke();ctx.restore();
  }
  ctx.font=small;
  run.forEach(r=>{
    const px=x(r.i),py=y(r.d);
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=blue;ctx.lineWidth=2.2;ctx.stroke();
    const text=o.large?`${fmt(r.d)}（${r.z===null?'—':(r.z>=0?'+':'')+r.z.toFixed(1)+'σ'}）`:fmt(r.d);
    const w=ctx.measureText(text).width;
    const tx=Math.min(pad.left+plotW-w/2-2,Math.max(pad.left+w/2+2,px));
    const above=py-pad.top>26;
    const ty=above?py-10:py+18;
    // 数值下面垫一块半透明白，免得和 0 线、带子边线、常态虚线糊在一起
    ctx.fillStyle='rgba(255,255,255,0.86)';
    ctx.fillRect(tx-w/2-2,ty-12,w+4,16);
    ctx.fillStyle=blueDark;ctx.textAlign='center';
    ctx.fillText(text,tx,ty);
  });
  // 7) x 轴：日期 + 考试名
  entries.forEach((r,i)=>{
    const px=x(i),raw=String(r.exam.date||'');
    ctx.font=small;ctx.textAlign='center';ctx.fillStyle=muted;
    ctx.fillText(raw.length>=10?raw.slice(5):raw,px,cssH-(o.large?26:22));
    ctx.font=tiny;ctx.fillStyle='#93a5a1';
    ctx.fillText(String(r.exam.name||'').replace(/[-—]?\d{4}[-—]?\d{2}[-—]?\d{2}$/,'').slice(0,o.large?12:6),px,cssH-(o.large?9:8));
  });
  // 8) 图内图例：单独下载的 PNG 也要能自解释
  let lx=pad.left;
  const ly=pad.top-16;
  ctx.font=tiny;ctx.textAlign='left';
  const legend=(paint,text)=>{
    paint(lx);
    ctx.fillStyle=muted;ctx.fillText(text,lx+20,ly+3);
    lx+=20+ctx.measureText(text).width+16;
  };
  legend(px=>{ctx.save();ctx.strokeStyle=blue;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(px,ly);ctx.lineTo(px+14,ly);ctx.stroke();ctx.restore();},'本班');
  legend(px=>{ctx.save();ctx.strokeStyle=zeroLine;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(px,ly);ctx.lineTo(px+14,ly);ctx.stroke();ctx.restore();},'段均分');
  legend(px=>{ctx.save();ctx.strokeStyle=muted;ctx.lineWidth=1.4;ctx.setLineDash([5,3]);ctx.beginPath();ctx.moveTo(px,ly);ctx.lineTo(px+14,ly);ctx.stroke();ctx.restore();},'常态');
  if(sigma)legend(px=>{ctx.fillStyle=bandFill;ctx.fillRect(px,ly-5,14,10);ctx.strokeStyle='rgba(29,78,216,0.35)';ctx.lineWidth=1;ctx.strokeRect(px,ly-5,14,10);},'±1σ*');
  return {cssW,cssH,domain,sigma};
}
function drawClassGap(canvas,series,opts){
  if(!canvas)return false;
  const entries=classGapEntries(series,(opts&&opts.limit)||CLASS_GAP_LIMIT);
  if(entries.length<2){canvas.style.display='none';return false;}
  const stats=classGapStats(entries);
  if(stats.sigma===null){canvas.style.display='none';return false;}
  const out=paintClassGap(canvas,stats,opts||{});
  const label=$('#classGapSigma');
  if(label)label.textContent=`统一刻度 σ* ${classFix(stats.sigma*100,1)} 分 · 由这 ${entries.length} 场算出`;
  const wrap=canvas.parentElement,hint=wrap?wrap.parentElement.querySelector('.class-chart-swipe'):null;
  if(hint)hint.style.display=(wrap.scrollWidth>wrap.clientWidth+2)?'':'none';
  return true;
}
function downloadCanvasPng(canvas,filename){
  if(!canvas)return;
  try{
    const link=document.createElement('a');
    link.download=filename||'班级分析.png';
    link.href=canvas.toDataURL('image/png');
    link.click();
    toast('图片已下载');
  }catch(err){toast('下载失败：'+((err&&err.message)||'未知错误'));}
}
// 点图看大图（大图里可以下载）；kind: 'stack' 三段构成 / 'rank' 段排名折线 / 'gap' 与段均分的差距
function openClassChartLarge(kind){
  const cfg=classAnalysisConfig(state.settings);
  const cls=state.currentClass?normalizeClassName(state.currentClass):'';
  const isRank=kind==='rank';
  const isGap=kind==='gap';
  const series=classAnalysisSeries(cls,cfg);
  const entries=isRank?classRankEntries(series,CLASS_RANK_LINE_LIMIT)
    :(isGap?classGapEntries(series,CLASS_GAP_LIMIT):classStackEntries(series,CLASS_STACK_LIMIT));
  if(!entries.length){
    toast(isRank?'至少要有两次多班对比的考试才能看段排名变化':(isGap?'至少要有两场“多班对比”的考试才能看差距':'这些考试都没有段次，画不出三段构成'));
    return;
  }
  if(isGap&&entries.length<2){toast('至少要有两场“多班对比”的考试才能看差距');return;}
  const title=isRank?`段排名变化 ${esc(cls)}`:(isGap?`与段均分的差距 ${esc(cls)}`:`三段构成 ${esc(cls)}`);
  document.getElementById('classChartModal')?.remove();
  const modal=document.createElement('div');
  modal.id='classChartModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card chart-modal-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>${title}</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
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
  const width=Math.max(640,Math.min(1500,Math.max((window.innerWidth||0)-80,(isRank||isGap)?640:entries.length*CLASS_BAR_MIN_LARGE+80)));
  if(isRank)paintClassRankLine(canvas,entries,{large:true,forceWidth:width});
  else if(isGap)paintClassGap(canvas,classGapStats(entries),{large:true,forceWidth:width});
  else paintClassStack(canvas,entries,cfg,{large:true,forceWidth:width});
  const name=isRank?'段排名变化':(isGap?'与段均分的差距':'三段构成');
  modal.querySelector('#downloadClassChartLarge').onclick=()=>downloadCanvasPng(canvas,`${name}-${cls||'班级'}-${localDate()}.png`);
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
  if(chart)chart.onclick=()=>openClassChartLarge('stack');
  const viewChart=$('#viewClassChart');
  if(viewChart)viewChart.onclick=()=>openClassChartLarge('stack');
  const downloadChart=$('#downloadClassChart');
  if(downloadChart)downloadChart.onclick=()=>downloadCanvasPng($('#classTrend'),`三段构成-${state.currentClass||'班级'}-${localDate()}.png`);
  // 段排名折线：同样的交互
  const rankChart=$('#classRankLine');
  if(rankChart)rankChart.onclick=()=>openClassChartLarge('rank');
  const viewRank=$('#viewClassRankLine');
  if(viewRank)viewRank.onclick=()=>openClassChartLarge('rank');
  const downloadRank=$('#downloadClassRankLine');
  if(downloadRank)downloadRank.onclick=()=>downloadCanvasPng($('#classRankLine'),`段排名变化-${state.currentClass||'班级'}-${localDate()}.png`);
  // 差距图：同样的交互
  const gapChart=$('#classGapChart');
  if(gapChart)gapChart.onclick=()=>openClassChartLarge('gap');
  const viewGap=$('#viewClassGap');
  if(viewGap)viewGap.onclick=()=>openClassChartLarge('gap');
  const downloadGap=$('#downloadClassGap');
  if(downloadGap)downloadGap.onclick=()=>downloadCanvasPng($('#classGapChart'),`与段均分的差距-${state.currentClass||'班级'}-${localDate()}.png`);
  bindPanelHelp();
}
// 屏幕上图要重画：转屏/改窗口大小时按新宽度重新排柱子（宽了就出现横向滑动）
let classChartSeries=[];
window.addEventListener('resize',()=>{
  if(!state.classAnalysisOpen||state.studentDetail||!classChartSeries.length)return;
  const canvas=$('#classTrend');
  if(canvas)drawClassStack(canvas,classChartSeries,classAnalysisConfig(state.settings));
  const rankCanvas=$('#classRankLine');
  if(rankCanvas)drawClassRankLine(rankCanvas,classChartSeries);
  const gapCanvas=$('#classGapChart');
  if(gapCanvas)drawClassGap(gapCanvas,classChartSeries);
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
  classViewScroll=0;classChipScroll=0;   // 打开这一页时从头开始，标签条也靠左
  renderStudents();
  scrollViewTop('students');
}
function closeClassAnalysis(){
  const from=state.classAnalysisFromDetail||'';
  state.classAnalysisOpen=false;
  state.classAnalysisFromDetail='';
  state.classAnalysisExamId='';
  classViewScroll=0;classChipScroll=0;
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
<p><strong>本班均分</strong>：全班有效成绩的平均分（满分见卡片下方小字）；括号里是<strong>和全段平均分的差</strong>——正数（绿）说明比段平均高，负数（红）说明比段平均低。<br>\
<strong>班均分排名</strong>：把段里每个班的均分从高到低排，本班是第几名；均分相同的算并列，分母是“这场考试有成绩的班级数”。</p>\
<p><strong>三条横条</strong>：实心条是本班实际占比，细竖线是“段里的自然比例”（段前 ${c.topPercent}% / 中间 ${Math.max(0,100-c.topPercent-c.bottomPercent)}% / 段后 ${c.bottomPercent}%）。条比竖线长，就说明本班这一类学生比全段平均多；具体人数与占比写在每条右边。</p>\
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
<p><strong>柱子怎么叠</strong>：<strong>绿色（段前 ${c.topPercent}%）在上、黄色（段后 ${c.bottomPercent}%）在下</strong>，中间是中间段；三段加起来正好 100%，所以柱子高度都一样，比的是“内部的构成”。</p>\
<p><strong>两条虚线</strong>：段里的自然分界——下面那条在段后 ${c.bottomPercent}% 的高度，上面那条在 ${100-c.topPercent}% 的高度。每根柱子的分界线都贴着虚线时，说明本班构成和全段平均一样；绿色块涨过上面那条虚线＝尖子多，黄色块压过下面那条虚线越多＝尾巴越重。</p>\
<p><strong>看图操作</strong>：柱子比屏幕宽时可以直接左右滑动（会提示“左右滑动看图”）；<strong>点图</strong>或点“查看大图”可以放大看，大图里点“下载图片”存 PNG。柱子太密时用大图看更清楚。</p>`;
  });

registerPanelHelp('class.rankline','段排名变化',
  () => `<p>这条线看的是<strong>本班整体的段内名次有没有往前走</strong>：每个点是一场考试，纵轴是“本班均分在所有班里排第几”，<strong>1 最好、数字越大越靠后</strong>，所以线往上走＝名次前进。</p>\
<p>点旁边写的是“第M / N个班”，N 是那场考试有成绩的班级数——N 变了（比如某场少了几个班）时，光看名次容易误判，可以对照点数一起看。</p>\
<p><strong>只画“多班对比”的场次</strong>：只导入了本班数据、或那一场库里只有一个班的，算不出段排名，不会出现在这条线上（所以点数可能少于 6 个）。点数是按时间从左到右排的，只取最近 ${CLASS_RANK_LINE_LIMIT} 个有排名的场次。</p>\
<p><strong>看图操作</strong>：点图或点“查看大图”放大看，大图里点“下载图片”存 PNG；图宽超出屏幕时可以直接左右滑动。</p>`);

registerPanelHelp('class.gap','与段均分的差距',
  () => `<p><strong>这条线回答的是“本班比段平均高多少、这个高算不算大”</strong>：纵轴是本班均分减去段均分（都换算成<strong>得分率</strong>，单位是百分点），所以<strong>中间那条深色横线（0 线）就是段均分</strong>；线在上面＝高于段平均，在下面＝低于。取最近 ${CLASS_GAP_LIMIT} 场，从左到右由早到晚。</p>\
<p><strong>为什么用得分率</strong>：不同场次满分可能不一样（这项数据里就有 100 分和 150 分的场次）。原始分直接减，会画出 96 分掉到 76 分、又蹦到 109 分这种“假暴跌假暴涨”，其实只是换了满分。</p>\
<p><strong>那条浅带是什么（关键）</strong>：尺子不是“学生之间差多少”，而是<strong>“班与班之间差多少”</strong>。做法是：每一场先算出全段各班均分的标准差 s（衡量这一场的班与班之间差多少），再把这几场按班数加权合并成一把统一刻度 σ*（标题右边写着具体数值）。浅带就是 <strong>±1σ*</strong>。为什么要统一：单算一场时只有十几个班，s 本身会有 ±18% 的抖动，每场换一把尺子，z 就跟着尺子乱跳；合并后抖动降到 ±7%，不同场次才能直接比。</p>\
<p>带子为什么不用“学生之间的标准差”：学生之间的 σ 大约是十分上下，班与班之间只有四五分，差两倍半。用学生 σ 当尺子，会把真实差距压掉六成（领先 6.6 分只画成 0.6σ），看不出“这个班是不是真的比段平均强”。</p>\
<p><strong>怎么读</strong>：线落在带子里＝差距还在“班与班的正常差距”之内；<strong>穿出带子的上沿/下沿</strong>＝明显高于/低于段平均。换算成 z（差距 ÷ σ*）后是这样分档的：<br>\
· |z| &lt; ${CLASS_GAP_TIERS[0]}：<strong>基本持平</strong>；<br>\
· ${CLASS_GAP_TIERS[0]}–${CLASS_GAP_TIERS[1]}：<strong>略高/略低</strong>；<br>\
· ${CLASS_GAP_TIERS[1]}–${CLASS_GAP_TIERS[2]}：<strong>明显</strong>；<br>\
· ≥ ${CLASS_GAP_TIERS[2]}：<strong>很突出</strong>（16 个班时大约是前 1–2 名 / 后 1–2 名）。</p>\
<p><strong>灰虚线“本班常态”</strong>是这几场差距的平均值。它回答另一个问题：<strong>这一场相对自己的平常水平是高是低</strong>——点在这条线上面，就是“这场比平时更靠前”，哪怕它还在 1σ* 带子里面。</p>\
<p><strong>两句提醒</strong>：① z 是“差距有多大”的描述，<strong>不是显著性检验</strong>，别写成“显著”；本班 50 人时几乎每一场都能通过 t 检验，那个结论对老师没用。② 在这些考试里，班与班之间的差距大约 <strong>84% 是稳定的</strong>（这个班一贯强/弱），只有 16% 是这场特有的起伏，所以这条线通常是“平的”，那是真实情况，不是图画错了。</p>\
<p><strong>纵轴</strong>只取数据所在的那一小段（不铺满 0–100%），跨度不足 6 个百分点时会强制撑到 6 个点，避免把 1 分的正常差画成断崖；先看左边刻度一格是几分。</p>\
<p><strong>缺数据</strong>：只导入了本班数据、或那一场只有一个班，画不出段均分和班间刻度，这场不会出现在图上；某场没填考试满分也算不出得分率，同样跳过（图下会提示）。</p>\
<p><strong>看图操作</strong>：点图或点“查看大图”放大看，大图里点“下载图片”存 PNG。</p>`);

registerPanelHelp('class.flow','学生分布详情',
  () => {
    const c=classAnalysisConfig(state.settings);
    return `<p>这一块只列<strong>当前这一场</strong>的两组人：段前 ${c.topPercent}% 和段后 ${c.bottomPercent}%（段排位＝段次 ÷ 当场段人数）。</p>\
<p><strong>三种标注</strong>：<br>\
· <strong>白底</strong>＝这一场才进这一组（新进段前 / 掉进段后）；<br>\
· <strong>彩框</strong>（段前青框、段后橙框）＝上一场也在同一组，稳定了两场；<br>\
· <strong>反色</strong>（深底浅字）＝<strong>连续三场都在同一组</strong>，是最稳定的那批。</p>\
<p>鼠标停在名字上／长按可以看到段次、段排位和属于哪一档；点名字可以直接进这位学生的详情页。</p>\
<p>想换看别的场次，就点上方的考试标签；比较对象始终是“这一场”“前一场”“再前一场”。场次不够三场时，就只有前两档标注。</p>`;
  });
