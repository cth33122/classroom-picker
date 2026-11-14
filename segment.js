// 段排名参照池（v256）
//
// 问题：有些重点班平时不参加考试，只在期中期末这类大考里加入排名。文件里的“校次”是按
// 混合池算的，于是同一份成绩的段排位会凭空涨几个百分点，段均分被抬高、班排名下滑、
// 三段占比里“段前”的人被挤走、班级分析差距图的 σ* 也被撑大——看着像退步，其实没变。
//
// 做法：把“段”定义为“参照池里出现的班”，每场都按分数重算段次。重算用竞争排名
// （名次 = 1 + 比我高的人数，并列同名次、后面跳号），与学校的校次口径一致（实测 778 人 0 处差异）。
// 这样不管这场是 16 个班还是 20 个班，段排位、段均分、班排名、三段占比、σ* 都可比。
// 原始文件的校次仍然保留，界面上做“全段 / 平行班”双口径显示。
//
// 附带收益：有些练习没有“校次”列，原来完全算不了段排位；现在用分数重算，段分析不再断档。
const SEGMENT_CACHE=new Map();

// 被排除的班（“不参与段排名”的班，一般是重点班）
function segmentExcluded(){
  const raw=(state.settings&&state.settings.poolExclude)||[];
  const set=new Set();
  (Array.isArray(raw)?raw:[]).forEach(c=>{
    const name=normalizeClassName(c);
    if(name)set.add(name);
  });
  return set;
}
function segmentIsExcluded(className){
  return segmentExcluded().has(normalizeClassName(className));
}

// 一场考试在参照池里的段：人数、均分、每个学生的段次、每个班的均分与名次
function segmentRanks(examId){
  const key=String(examId);
  const cached=SEGMENT_CACHE.get(key);
  if(cached)return cached;
  const excluded=segmentExcluded();
  const scored=[];
  let excludedCount=0;
  const excludedClasses=new Set();
  (state.examResults||[]).forEach(r=>{
    if(!r||String(r.examId)!==key)return;
    const result=r.result||{};
    const score=Number(result.score);
    if(!(Number.isFinite(score)&&score>0))return;   // 缺考/0 分不占名次（与原来的段人数口径一致）
    const cls=normalizeClassName(result.className);
    if(excluded.has(cls)){excludedCount++;excludedClasses.add(cls);return;}
    scored.push({studentId:r.studentId,cls,score});
  });
  // 竞争排名：同一分数并列，名次跳号（1、2、2、4）
  const counts=new Map();
  scored.forEach(x=>counts.set(x.score,(counts.get(x.score)||0)+1));
  const better=new Map();
  let acc=0;
  [...counts.keys()].sort((a,b)=>b-a).forEach(score=>{better.set(score,acc);acc+=counts.get(score);});
  const ranks=new Map();
  const byClass=new Map();
  let sum=0;
  scored.forEach(x=>{
    ranks.set(x.studentId,better.get(x.score)+1);
    sum+=x.score;
    const box=byClass.get(x.cls)||{className:x.cls,count:0,sum:0};
    box.count++;box.sum+=x.score;byClass.set(x.cls,box);
  });
  const classList=[...byClass.values()]
    .map(c=>({className:c.className,count:c.count,avg:c.sum/c.count}))
    .sort((a,b)=>b.avg-a.avg||String(a.className).localeCompare(String(b.className),'zh-CN'));
  let rank=0,prev=null;
  classList.forEach((c,index)=>{
    if(prev===null||Math.abs(c.avg-prev)>1e-9){rank=index+1;prev=c.avg;}
    c.rank=rank;
  });
  const info={
    size:acc,count:scored.length,sum,avg:scored.length?sum/scored.length:null,
    ranks,classList,byClass:new Map(classList.map(c=>[c.className,c])),
    excludedCount,excludedClasses:[...excludedClasses],
  };
  SEGMENT_CACHE.set(key,info);
  return info;
}
function segmentRankOf(examId,studentId){
  return segmentRanks(examId).ranks.get(studentId)||0;
}
// 界面上显示“段次”时用这个：池内用重算值，池外（本班被排除）退回文件校次
function segmentRankFor(examId,studentId,rawRank){
  const pool=segmentRankOf(examId,studentId);
  return pool||rankNumber(rawRank)||null;
}
function clearSegmentCache(){SEGMENT_CACHE.clear();}
