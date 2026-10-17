// 学生身份：不可变 uid（软件内置的唯一标识符）+ 身份别名（学号/考号…）+ 一次性补齐迁移。
//
// 为什么要有 uid：现在学生的身份是字符串 id（形如 `14班-张三(2)`），班级名嵌在身份里，
// 一旦分班/改班名，身份就变了，点名历史、评价、问题、头像、成绩会"接不上人"。
// uid 只生成一次、永不变；班级和姓名降级为可改的显示属性，所有关联数据都指向 uid。
//
// 第一步（本次）只做"补齐"：给已有数据加上 uid，并把关联记录的 uid 一并写好。
// **不改任何既有字段、不改界面、不改现有逻辑**——代码里仍然全部用旧 id 认人，
// 所以这一步的行为零变化、可以随时回滚（重新导入备份即可）。
//
// 迁移是幂等的、且 uid 由旧 id 确定性推导（同一份旧数据永远得到同一个 uid），
// 因此"恢复旧备份后再次迁移"不会导致 uid 变化，头像等本机数据仍能对上。

const IDENTITY_VERSION=1;
// 旧 id → uid：FNV-1a 32 位哈希 → base36。由旧 id 决定，保证可重跑、结果稳定。
function uidHash32(text){
  let h=0x811c9dc5;
  const s=String(text||'');
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=(h+(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))>>>0;   // h *= 16777619（用移位避免 32 位溢出）
  }
  return h>>>0;
}
function uidForLegacyId(legacyId){
  return 'u-'+uidHash32(legacyId).toString(36);
}
// 别名（学号/考号…）归一化：去掉空白，空值忽略
function aliasValue(v){return String(v==null?'':v).trim();}
// —— 编号“体系族”：同一类编号在学校不同表里列名可能不一样（考号 / 自定义考号 / 准考证号…），
//    但本质是同一种编号。这里把列名归到族上，统计、采纳、判定都按族来做（显示时仍保留原始列名）。
const ID_FIELD_TOKENS=['学号','学籍号','学生编号','校内学号','考号','自定义考号','考生号','准考证号','准考证','报名号','考籍号','编号'];
const ID_FAMILY_OF={'学号':'学号','学籍号':'学号','学生编号':'学号','校内学号':'学号',
  '考号':'考号','自定义考号':'考号','考生号':'考号','准考证号':'考号','准考证':'考号','报名号':'考号','考籍号':'考号',
  '编号':'其他编号'};
function idFamilyOf(type){
  const t=String(type||'').trim();
  if(!t)return '';
  if(ID_FAMILY_OF[t])return ID_FAMILY_OF[t];
  const hit=ID_FIELD_TOKENS.filter(k=>t.includes(k)).sort((a,b)=>b.length-a.length)[0];
  return hit?ID_FAMILY_OF[hit]:t;
}
function idFamilyOfAlias(x){return idFamilyOf((x&&(x.family||x.type))||'');}
// 结构指纹：位数分布 + 字符构成（用来判断“是不是同一类编号”）
function idFingerprint(values){
  const list=(values||[]).map(v=>aliasValue(v)).filter(Boolean);
  const lenCounts={};
  let digits=0,letters=0;
  list.forEach(v=>{
    lenCounts[v.length]=(lenCounts[v.length]||0)+1;
    if(/^\d+$/.test(v))digits++;else letters++;
  });
  const lens=Object.keys(lenCounts).map(Number).sort((a,b)=>a-b);
  return {count:list.length,lens,lenCounts,charset:letters?(digits?'混合':'含字母'):'纯数字',fixedLength:lens.length===1};
}
function identityAliasOf(student){
  const ids=Array.isArray(student&&student.ids)?student.ids:[];
  return ids.map(x=>x&&x.value).filter(Boolean);
}
// 记录从数据里发现的身份别名：老数据用 sourceExamId 补登记；新导入的行自带各编号列的值
function aliasesFromStudent(student,legacyId){
  const out=Array.isArray(student.ids)?student.ids.filter(x=>x&&x.value).map(x=>({...x})):[];
  const seen=new Set(out.map(x=>String(x.value)));
  const no=aliasValue(student.sourceExamId);
  if(no&&!seen.has(no)){
    out.push({type:'学号/考号',value:no,source:student.source||'',seenAt:student.sourceDate||'',origin:legacyId});
  }
  return out;
}
// 一个学生身上所有“可用于备选认人”的编号（含旧字段 sourceExamId）
function identityValuesOf(student){
  return [...new Set([aliasValue(student&&student.sourceExamId)].concat(identityAliasOf(student)).filter(Boolean))];
}
// 给一个学生补 uid（幂等：已有 uid 原样返回）
// 同时保留“学号/考号”别名：平时不参与认人，只在**同名需要区分**时作为备选判据，
// 也用于“识别分班”时校验文件里的编号列是否稳定。
function withUid(student,usedUids){
  const uid=student.uid||(()=>{
    const base=uidForLegacyId(student.id);
    if(!usedUids.has(base))return base;
    for(let i=2;i<1000;i++){const cand=base+'-'+i;if(!usedUids.has(cand))return cand;}
    return base+'-'+usedUids.size;
  })();
  usedUids.add(uid);
  return {...student,uid,legacyId:student.legacyId||student.id,ids:aliasesFromStudent(student,student.id)};
}
// 关联记录补 uid（找不到对应学生就留空，并计入孤儿数，不报错、不删数据）
function linkUid(record,uidOf){
  if(!record||record.studentUid)return record;
  const uid=uidOf.get(record.studentId);
  return uid?{...record,studentUid:uid}:record;
}
// 迁移主体：只补字段，绝不改/删既有字段
// loaded: {students,history,absences,examResults}（reload 已经读出来的数组）
async function ensureStudentUids(loaded){
  const data=loaded||{};
  const students=Array.isArray(data.students)?data.students:[];
  // 快速判断：学生和四张关联表都补齐了就直接返回（每次启动只做一次数组扫描，不额外读库）
  const knownIds=new Set(students.map(s=>s&&s.id).filter(Boolean));
  const needStudents=students.some(s=>s&&!s.uid);
  const related=['history','absences','examResults'].map(k=>Array.isArray(data[k])?data[k]:[]);
  // 只把“能对上学生的记录”算作待补；对不上的是孤儿记录（对应学生已不在），永远不会被补，
  // 不能拿它当“还需要迁移”的依据，否则每次启动都会白跑一遍。
  const needRelated=related.some(rows=>rows.some(r=>r&&r.studentId&&!r.studentUid&&knownIds.has(r.studentId)));
  if(!students.length)return {migrated:false,students:0,linked:0,orphans:0};
  if(!needStudents&&!needRelated)return {migrated:false,students:0,linked:0,orphans:0};

  const usedUids=new Set(students.filter(s=>s&&s.uid).map(s=>s.uid));
  const uidOf=new Map(),nextStudents=[];
  for(const s of students){
    if(!s)continue;
    const next=withUid(s,usedUids);
    uidOf.set(next.id,next.uid);          // 旧 id → uid（新数据一律指向 uid）
    uidOf.set(next.uid,next.uid);
    nextStudents.push(next);
  }
  let linked=0,orphans=0;
  const nextHistory=related[0].map(r=>{
    if(!r||r.studentUid)return r;
    const next=linkUid(r,uidOf);
    if(next.studentUid)linked++;else if(r.studentId)orphans++;
    return next;
  });
  const nextAbsences=related[1].map(r=>{
    if(!r||r.studentUid)return r;
    const next=linkUid(r,uidOf);
    if(next.studentUid)linked++;else if(r.studentId)orphans++;
    return next;
  });
  const nextResults=related[2].map(r=>{
    if(!r||r.studentUid)return r;
    const next=linkUid(r,uidOf);
    if(next.studentUid)linked++;else if(r.studentId)orphans++;
    return next;
  });
  // 头像（主键是旧 id，这里只加字段，不改键，保证现有读取方式不变）
  const photos=await DB.all('photos');
  const nextPhotos=photos.map(p=>{
    if(!p||p.studentUid)return p;
    const uid=uidOf.get(p.id)||uidOf.get(p.studentId);
    return uid?{...p,studentUid:uid}:p;
  });
  // 座位表（按班级存，座位里补 uid；旧字段保留，界面与逻辑不变）
  const layouts=await DB.all('seats');
  const nextLayouts=layouts.map(layout=>{
    if(!layout||!Array.isArray(layout.seats))return layout;
    let changed=false;
    const seats=layout.seats.map(seat=>{
      if(!seat||seat.studentUid||!seat.studentId)return seat;
      const uid=uidOf.get(seat.studentId);
      if(!uid)return seat;
      changed=true;
      return {...seat,studentUid:uid};
    });
    return changed?{...layout,seats}:layout;
  });

  if(needStudents)await DB.putMany('students',nextStudents);
  if(nextHistory.some((r,i)=>r!==related[0][i]))await DB.putMany('history',nextHistory);
  if(nextAbsences.some((r,i)=>r!==related[1][i]))await DB.putMany('absences',nextAbsences);
  if(nextResults.some((r,i)=>r!==related[2][i]))await DB.putMany('examResults',nextResults);
  if(nextPhotos.some((p,i)=>p!==photos[i]))await DB.putMany('photos',nextPhotos);
  if(nextLayouts.some((l,i)=>l!==layouts[i]))await DB.putMany('seats',nextLayouts);

  const stats={version:IDENTITY_VERSION,uidCount:nextStudents.length,linked,orphans,firstTime:needStudents,migratedAt:new Date().toISOString()};
  try{await DB.put('meta',{id:'identity',...stats});}catch(err){}
  const problems=checkIdentity(nextStudents,{history:nextHistory,absences:nextAbsences,examResults:nextResults});
  stats.problems=problems.length;
  return {migrated:true,firstTime:needStudents,students:nextStudents.length,linked,orphans,problems,stats,
    nextStudents,nextHistory,nextAbsences,nextResults,nextPhotos};
}
// ---------- 班级变更与导入认人 ----------
// 身份索引：uid / 别名（学号考号）/ 姓名，供导入时“认出同一个人”
function studentIdentityIndex(students){
  const byUid=new Map(),byAlias=new Map(),byName=new Map();
  (students||[]).forEach(s=>{
    if(!s)return;
    if(s.uid)byUid.set(s.uid,s);
    identityValuesOf(s).forEach(v=>{
      if(!byAlias.has(v))byAlias.set(v,s);      // 备选认人用（同名时才查它）
    });
    [norm(s.name),norm(s.displayName)].filter(Boolean).forEach(k=>{
      const arr=byName.get(k)||[];
      if(!arr.includes(s))arr.push(s);
      byName.set(k,arr);
    });
  });
  return {byUid,byAlias,byName,students:(students||[]).filter(Boolean)};
}
// 导入某次成绩时认出“这是已有的哪个人”。**只有证据充分才认，否则一律按新学生处理**：
//   ① 这个姓名在全库只对应一个人 → 认（分班后班级变了也能认出来）；
//   ② 同名多人 → 必须靠“编号唯一命中”或“班级唯一命中”来区分，两者都不成立就不认。
// exclude：**同一场考试内**已经被别的行占用的人（避免一场考试里两行抢同一个人；
//   注意不能跨考试——同一个人在多场考试里本来就会各出现一次）。
// fileDupNames：**这份文件（同一场考试）里同名出现 ≥2 次**的名字集合。这种情况下"库里只有一个同名的人"
//   不能当证据用：文件里本来就并存两个同名的人（例如新转来的学生和库里那位同名），
//   必须像同名多人一样靠编号/班级判定，否则会把"另一个人"认成库里那位并记出假的班级变动。
function resolveIncomingStudent(incoming,index,exclude,fileDupNames){
  if(!incoming||!index)return null;
  const nm=norm(incoming.name);
  if(!nm)return null;
  const all=(index.byName.get(nm)||[]).filter(Boolean);
  if(!all.length)return null;
  const skip=id=>Boolean(exclude&&typeof exclude.has==='function'&&exclude.has(id));
  const cands=all.filter(s=>!skip(s.id));
  if(!cands.length)return null;
  const dup=Boolean(fileDupNames&&typeof fileDupNames.has==='function'&&fileDupNames.has(nm));
  if(all.length===1&&!dup)return cands[0];           // ① 全库唯一、且文件里也只有这一行 → 直接认
  const values=identityValuesOf(incoming);           // ② 同名多人：先看编号
  if(values.length){
    const byValue=cands.filter(s=>identityValuesOf(s).some(v=>values.includes(v)));
    if(byValue.length===1)return byValue[0];
  }
  const cls=normalizeClassName(incoming.className);  // 再看班级
  if(cls){
    const same=cands.filter(s=>normalizeClassName(s.className)===cls);
    if(same.length===1)return same[0];
  }
  return null;
}
// 没认出这个人的行（=相对库里是另一个人）：给它换一个库里没被占用的身份编号，
// 让它老老实实成为新学生。旧 id 形如 `07班-张三`，导入文件里新行的 id 也是同一套格式，
// 一旦同名同班就会撞上库里已有学生的身份编号，于是"另一个人"被静默并进那个人，
// 还会记出 `7班→2班` + `2班→7班` 这种不可能的来回班级变动（班级页提示条会同时显示转入和转出同名）。
// taken：id => 是否已被占用；cache：本次导入内同一个基名复用同一个新编号（跨工作表不分裂成两个人）。
function unusedStudentId(base,taken,cache){
  const key=String(base||'');
  if(cache&&typeof cache.get==='function'&&cache.has(key))return cache.get(key);
  let n=2,id=`${key}(${n})`;
  while(taken(id))id=`${key}(${++n})`;
  if(cache&&typeof cache.set==='function')cache.set(key,id);
  return id;
}
// 同名但“证据不足、认不出”的行：这些会被当成新学生加入，必须让老师确认
function analyzeAmbiguousRows(rows,index){
  const seen=new Set(),out=[];
  (rows||[]).forEach(r=>{
    const nm=norm(r.name);
    if(!nm)return;
    const all=(index&&index.byName?index.byName.get(nm):null)||[];
    if(all.length<2)return;
    if(resolveIncomingStudent(r,index))return;
    const key=nm+'|'+normalizeClassName(r.className)+'|'+identityValuesOf(r).join(',');
    if(seen.has(key))return;
    seen.add(key);
    out.push({name:r.name,className:normalizeClassName(r.className),values:identityValuesOf(r),candidates:all});
  });
  return out;
}
// ---------- 识别“是否分班” + 编号列相关性分析 ----------
const CLASS_SHIFT_BLOCK_RATIO=0.8; // 变动比例 ≥80% 时**阻塞导入**（多半是班级列认错了）
const ID_COLUMN_MIN_ROWS=5;      // 编号列相关性至少要能核对这么多人
const ID_COLUMN_RATIO=0.8;       // 一致率 ≥80% 才建议采纳为备选认人依据
// 这批导入数据与库里现有学生的关系：**按人去重**统计（同一人在多场考试里出现只算一次）。
// ratio 的分母是“能认出来的学生数”（新生单独报），这样“只导入一个班”不会被稀释成低比例。
function analyzeClassShift(rows,index){
  const seen=new Set();
  const stat={total:0,matched:0,classChanged:0,unmatched:0,byClassChange:{},unmatchedSamples:[]};
  (rows||[]).forEach(r=>{
    const s=resolveIncomingStudent(r,index);
    const key=s?('id:'+s.id):('new:'+norm(r.name)+'|'+normalizeClassName(r.className));
    if(seen.has(key))return;
    seen.add(key);
    stat.total++;
    if(!s){
      stat.unmatched++;
      if(stat.unmatchedSamples.length<12)stat.unmatchedSamples.push(String(r.name||'')+(r.className?('（'+normalizeClassName(r.className)+'）'):''));
      return;
    }
    stat.matched++;
    const from=normalizeClassName(s.className),to=normalizeClassName(r.className);
    if(from&&to&&from!==to){
      stat.classChanged++;
      const k=from+' → '+to;
      stat.byClassChange[k]=(stat.byClassChange[k]||0)+1;
    }
  });
  stat.ratio=stat.matched?stat.classChanged/stat.matched:0;   // 分母＝认出来的人
  return stat;
}
// 文件里的编号列到底可不可信 —— **按“体系族”统计**（“考号”和“自定义考号”算同一族，不再被列名拆散）：
//   · present/comparable/agree/conflict：值命中率（只看“姓名能唯一对上库里某个人”的行）
//   · dup：同一个值出现在不同学生身上（这类列不能用来区分人）
//   · lenCounts/charset：本批值的结构指纹（位数分布、纯数字还是含字母）
//   · overlap/shapeSame/verdict：与库里该族编号的集合重合率与结构比较，给出“是不是同一类编号”的判断
function analyzeIdColumns(rows,index){
  const byFamily=new Map(),valueOwners=new Map();
  (rows||[]).forEach(r=>{
    const s=resolveIncomingStudent(r,index);
    (r.ids||[]).forEach(x=>{
      const family=idFamilyOfAlias(x),type=x.type||family||'编号',value=aliasValue(x.value);
      if(!value||!family)return;
      const cur=byFamily.get(family)||{family,types:[],present:0,comparable:0,agree:0,conflict:0,samples:[],dup:0,fileValues:new Set()};
      if(!cur.types.includes(type))cur.types.push(type);
      cur.present++;
      cur.fileValues.add(value);
      if(s){
        const known=identityValuesOf(s);
        if(known.length){
          cur.comparable++;
          if(known.includes(value))cur.agree++;
          else{cur.conflict++;if(cur.samples.length<3)cur.samples.push(`${s.name}：库里 ${known[0]} / 文件 ${value}`);}
        }
      }
      const mapKey=family+'\u0000'+value;
      const owners=valueOwners.get(mapKey)||new Set();
      owners.add(s?s.id:('new:'+norm(r.name)));
      valueOwners.set(mapKey,owners);
      byFamily.set(family,cur);
    });
  });
  valueOwners.forEach((owners,key)=>{
    const family=key.split('\u0000')[0],cur=byFamily.get(family);
    if(cur&&owners.size>1)cur.dup++;
  });
  // 库里该族已有的值（供集合重合与结构比较）
  const dbValues=new Map();
  (studentsOfIdentityIndex(index)||[]).forEach(s=>{
    (Array.isArray(s.ids)?s.ids:[]).forEach(x=>{
      const family=idFamilyOfAlias(x),value=aliasValue(x.value);
      if(!family||!value)return;
      const set=dbValues.get(family)||new Set();
      set.add(value);
      dbValues.set(family,set);
    });
  });
  return [...byFamily.values()].map(c=>{
    const db=dbValues.get(c.family)||new Set();
    let inter=0;
    c.fileValues.forEach(v=>{if(db.has(v))inter++;});
    const denom=Math.min(c.fileValues.size,db.size)||0;
    const overlap=denom?inter/denom:0;
    const fp=idFingerprint([...c.fileValues]);
    const dbFp=idFingerprint([...db]);
    const shapeSame=Boolean(fp.lens.length&&dbFp.lens.length&&fp.lens.join(',')===dbFp.lens.join(','));
    const ratio=c.comparable?c.agree/c.comparable:0;
    let verdict;
    if(!db.size)verdict='库里还没有这类编号（首次见到）';
    else if(ratio>=ID_COLUMN_RATIO)verdict='同一类编号，且能对上人';
    else if(overlap>=0.8)verdict='同一类编号，但本批有一些新值';
    else if(shapeSame)verdict='位数一致，但值几乎对不上（可能整批重排，仅供参考）';
    else verdict='位数与库里不一致，可能不是同一类编号';
    return {...c,dbCount:db.size,overlap,shapeSame,fileLens:fp.lens,dbLens:dbFp.lens,charset:fp.charset,ratio,verdict};
  }).sort((a,b)=>b.ratio-a.ratio||b.agree-a.agree);
}
// 从身份索引里取回学生列表
function studentsOfIdentityIndex(index){
  if(!index)return [];
  if(Array.isArray(index.students))return index.students;
  const seen=new Map();
  if(index.byName&&typeof index.byName.forEach==='function'){
    index.byName.forEach(arr=>(arr||[]).forEach(s=>{if(s&&s.id&&!seen.has(s.id))seen.set(s.id,s);}));
  }
  return [...seen.values()];
}
// 同名组校验：文件里同名 ≥2 人时，看这组的编号能不能和库里同名的人**一一对上（唯一双射）**。
// 能对上 ⇒ 可以自动区分；对不上（缺号/同号/多种配对都成立）⇒ 交给人工指认。
function duplicateNameGroups(rows,index){
  const groups=new Map();
  (rows||[]).forEach((r,i)=>{
    const nm=norm(r.name);
    if(!nm)return;
    const arr=groups.get(nm)||[];
    arr.push({rowIndex:i,row:r,className:normalizeClassName(r.className),values:identityValuesOf(r)});
    groups.set(nm,arr);
  });
  const out=[];
  groups.forEach((entries,name)=>{
    if(entries.length<2)return;
    const candidates=((index&&index.byName&&index.byName.get(name))||[]).slice();
    out.push({name,entries,candidates,pairing:bijectionPairing(entries,candidates)});
  });
  return out;
}
// 双射求解（组内一般 2~3 人，直接暴力；要求“恰好唯一一种配对”，否则返回 null 交人工）
function bijectionPairing(entries,candidates){
  if(!candidates.length)return null;
  const options=entries.map(e=>candidates.map((s,si)=>identityValuesOf(s).some(v=>e.values.includes(v))?si:-1).filter(i=>i>=0));
  if(options.some(o=>!o.length))return null;
  const used=new Set(),pick=[];
  const dfs=i=>{
    if(i===entries.length)return true;
    for(const c of options[i]){
      if(used.has(c))continue;
      used.add(c);pick.push(c);
      if(dfs(i+1))return true;
      pick.pop();used.delete(c);
    }
    return false;
  };
  if(!dfs(0))return null;
  let solutions=0;
  const used2=new Set();
  const count=i=>{
    if(solutions>1)return;
    if(i===entries.length){solutions++;return;}
    for(const c of options[i]){
      if(used2.has(c))continue;
      used2.add(c);count(i+1);used2.delete(c);
    }
  };
  count(0);
  if(solutions!==1)return null;
  return pick.map((ci,k)=>({entry:entries[k],student:candidates[ci]}));
}
// 人工指认的结果落地：把某一行绑到指定学生，并把该行的编号记成这个学生的别名（以后自动生效）
function applyIdentityAssignments(rows,assign,index,students){
  let bound=0;
  Object.keys(assign||{}).forEach(k=>{
    const i=Number(k),sid=String(assign[k]||'');
    const row=rows&&rows[i];
    if(!row||!sid)return;
    const pool=students||state.students||[];
    const fromIndex=((index&&index.byName&&index.byName.get(norm(row.name)))||[]).find(x=>x.id===sid);
    const s=fromIndex||pool.find(x=>x.id===sid);
    if(!s)return;
    row.id=s.id;row.identityKey=s.id;                 // 让随后的合并认到这个人
    const values=identityValuesOf(row);
    if(values.length){
      const list=Array.isArray(s.ids)?s.ids.map(x=>({...x})):[];
      values.forEach(v=>{
        if(list.some(x=>aliasValue(x.value)===v))return;
        const hit=(row.ids||[]).find(x=>aliasValue(x.value)===v);
        list.push({type:(hit&&hit.type)||'编号',value:v,source:row.source||'',seenAt:row.sourceDate||'',confirmed:true});
      });
      s.ids=list;
    }
    bound++;
  });
  return bound;
}
// 把某一“族”的编号采纳为别名（用户确认后调用）：只写进“能唯一对上”的那些学生。
// familyOrType 可以传体系族（'考号'）或具体列名（'自定义考号'），都能对上。
function adoptIdentityColumn(rows,index,familyOrType){
  const want=String(familyOrType||'');
  const wantFamily=idFamilyOf(want);
  const touched=[];
  (rows||[]).forEach(r=>{
    const s=resolveIncomingStudent(r,index);
    if(!s)return;
    const hit=(r.ids||[]).find(x=>{
      const f=idFamilyOfAlias(x);
      return f===wantFamily||String(x.type||'')===want;
    });
    const value=aliasValue(hit&&hit.value);
    if(!value)return;
    const list=Array.isArray(s.ids)?s.ids.map(x=>({...x})):[];
    if(list.some(x=>aliasValue(x.value)===value))return;
    list.push({type:(hit&&hit.type)||want,family:wantFamily||idFamilyOfAlias(hit),value,source:r.source||'',seenAt:r.sourceDate||'',confirmed:true});
    s.ids=list;
    touched.push(s);
  });
  return touched;
}
// 班级变更历史：{className,from,to}（日期 YYYY-MM-DD，to 为空表示“至今”），只用于详情页展示
function appendClassHistory(student,newClass,when){
  const at=String(when||new Date().toISOString()).slice(0,10);
  const cur=String(student&&student.className||'');
  const list=(Array.isArray(student&&student.classHistory)?student.classHistory:[]).map(x=>({...x}));
  if(cur===newClass)return list;
  if(list.length){const last=list[list.length-1];if(!last.to)last.to=at;}
  else if(cur)list.push({className:cur,from:'',to:at});
  list.push({className:newClass,from:at,to:''});
  return list;
}
// 供页面显示：班级变更一览、设置页的身份状态
function classHistoryText(student){
  const list=Array.isArray(student&&student.classHistory)?student.classHistory:[];
  if(list.length<2)return '';
  return list.map((x,i)=>(i?' → ':'')+String(x.className||'')+(x.from?('（'+x.from+'）'):'')).join('');
}
function identityStatusText(){
  const rows=Array.isArray(state.students)?state.students:[];
  const total=rows.length,built=rows.filter(s=>s&&s.uid).length;
  const meta=state.identity||null;
  const at=meta&&meta.migratedAt?new Date(meta.migratedAt).toLocaleString():'';
  const parts=[`已建立稳定身份 ${built} 人`+(total>built?`（还有 ${total-built} 人未建立）`:'')];
  parts.push('uid v'+(meta&&meta.version?meta.version:IDENTITY_VERSION));
  if(at)parts.push('最近补齐 '+at);
  if(meta&&meta.orphans)parts.push(`${meta.orphans} 条旧记录没对上学生（已保留）`);
  return parts.join(' · ');
}

// 学生已经不存在的旧记录（孤儿）不算问题——它们本来就接不上，只做保留、不删。
// 自检：迁移后 uids 必须唯一、每条“能对上学生”的关联记录都要接上 uid；返回问题清单（空＝正常）。
// 学生已经不存在的旧记录（孤儿）不算问题——它们本来就接不上，只做保留、不删。
function checkIdentity(students,records){
  const problems=[];
  const byUid=new Map(),byLegacyId=new Set(),seen=new Set();
  (students||[]).forEach(s=>{
    if(!s||!s.id)return;
    byLegacyId.add(s.id);
    if(!s.uid){problems.push('学生缺 uid：'+(s.id||'?'));return;}
    if(seen.has(s.uid))problems.push('uid 重复：'+s.uid+'（'+s.id+'）');
    seen.add(s.uid);
    byUid.set(s.uid,s);
    if(!s.legacyId)problems.push('学生缺 legacyId：'+(s.id||'?'));
  });
  Object.keys(records||{}).forEach(store=>{
    (records[store]||[]).forEach(r=>{
      if(!r||!r.studentId)return;
      const known=byLegacyId.has(r.studentId)||byUid.has(String(r.studentUid||''));
      if(!r.studentUid){if(known)problems.push(store+' 有记录没接上 uid：'+r.studentId);return;}
      if(!byUid.has(r.studentUid))problems.push(store+' 的 uid 在学生表里找不到：'+r.studentUid);
    });
  });
  return problems;
}
