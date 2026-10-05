function colNumber(ref){let n=0;for(const c of ref.replace(/\d/g,''))n=n*26+c.charCodeAt(0)-64;return n-1;}
function xmlText(v){return v.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function parseSheetXml(xml,shared){const rows=[];for(const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){const cells=[];for(const cell of row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cell[1],body=cell[2],ref=(attrs.match(/r="([A-Z]+\d+)"/)||[])[1];if(!ref)continue;const type=(attrs.match(/t="([^"]+)"/)||[])[1],raw=(body.match(/<v>([\s\S]*?)<\/v>/)||[])[1]??(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)||[])[1]??'';cells[colNumber(ref)]=type==='s'?(shared[Number(raw)]||''):xmlText(raw);}rows.push(cells);}return rows;}
async function parseXlsx(file){const input=typeof file.arrayBuffer==='function'?await file.arrayBuffer():file,zip=await JSZip.loadAsync(input),shared=[],sf=zip.file('xl/sharedStrings.xml');if(sf){const x=await sf.async('text');for(const si of x.matchAll(/<si>([\s\S]*?)<\/si>/g))shared.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlText(m[1])).join(''));}const wb=await zip.file('xl/workbook.xml').async('text'),rels=await zip.file('xl/_rels/workbook.xml.rels').async('text'),map={};for(const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g))map[m[1]]=m[2].replace(/^\//,'');const sheets=[];for(const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)){const target=map[m[2]]||`xl/worksheets/sheet${sheets.length+1}.xml`,f=zip.file(target.startsWith('xl/')?target:`xl/${target}`);if(f)sheets.push({name:xmlText(m[1]),rows:parseSheetXml(await f.async('text'),shared)});}return sheets;}
function norm(v){return String(v??'').trim().replace(/\s+/g,'');}
function isMissingId(v){return !v||['-','—','－','无','暂无','null','undefined','/'].includes(String(v).trim().toLowerCase());}
function normalizeClassName(v){const t=norm(v),n=t.match(/\d+/g);return n?.length?`${String(Number(n[n.length-1])).padStart(2,'0')}班`:t||'未分班';}
function identityBase(r){return `${normalizeClassName(r.className)}-${r.name}`;}
function num(v){const n=Number(String(v??'').replace(/[% ,]/g,''));return Number.isFinite(n)?n:null;}
// 过滤表尾的“年级均分/-”“注：…”等汇总行与占位符，避免被当成学生
function isPlaceholderName(v){const t=norm(v);if(!t)return true;if(/^[-—－_~·.。、]+$/.test(t)||/^\d+(\.\d+)?$/.test(t))return true;return /年级|均分|得分率|合计|总计|小计|汇总|统计|全校|全体|说明|备注|^注[:：]/.test(t);}
// 表头识别：只要出现姓名（或学号/考号）列并搭配班级或成绩类字段即视为成绩表
function findHeader(rows){for(let i=0;i<Math.min(rows.length,12);i++){const values=rows[i].map(norm),line=values.join('|');if(values.some(v=>v&&/姓名|学号|考号/.test(v))&&/(班级|班别|成绩|分数|总分|得分)/.test(line))return {index:i,values:rows[i]};}return null;}
// 精确列名优先，其次按关键词包含匹配；exclude 用于排除“得分率(%)”这类干扰列
function fieldIndex(h,tokens,exclude=[]){const cells=h.map(norm);for(let i=0;i<cells.length;i++)if(tokens.includes(cells[i]))return i;for(let i=0;i<cells.length;i++){const t=cells[i];if(!t||exclude.some(x=>t.includes(x)))continue;if(tokens.some(x=>t.includes(x)))return i;}return -1;}
function cleanLabel(text){return String(text??'').replace(/[【】\[\]（）()《》]/g,' ').replace(/[-_—–·,，.。、/\\|:：]+/g,' ').replace(/\s+/g,' ').trim();}
// 从“周测8-20270124”“周测8 2027.01.24”等工作表名中拆出考试名称与日期；识别不到日期时只返回名称
function parseExamLabel(raw){const text=String(raw??'').trim();const m=text.match(/(20\d{2})\s*[.\-_/年]?\s*(\d{1,2})\s*[.\-_/月]?\s*(\d{1,2})\s*日?/);if(!m)return {exercise:cleanLabel(text),date:''};return {exercise:cleanLabel(`${text.slice(0,m.index)} ${text.slice(m.index+m[0].length)}`),date:`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`};}
function parseFilename(name){const clean=String(name||'').replace(/\.xlsx$/i,'').replace(/[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*$/i,'');const bracket=(clean.match(/【([^】]+)】/)||[])[1];const base=bracket||clean.replace(/^数智作业[-_]?/,'').replace(/[-_]\d{8}[-_].*$/,'');const label=parseExamLabel(base);const fallbackDate=parseExamLabel(clean).date;return {exercise:label.exercise||cleanLabel(base)||'未命名练习',date:label.date||fallbackDate||localDate()};}
function inferTotalScore(sheets,records){const text=sheets.flatMap(s=>s.rows.flat()).map(norm).join('|'),m=text.match(/(?:满分|试卷总分|总分)[^0-9]{0,20}(\d{2,3}(?:\.\d+)?)/);if(m)return Number(m[1]);const max=Math.max(...records.map(r=>r.rawScore||0),0);if(max>100){for(const n of [120,150,160,180,200])if(max<=n)return n;return Math.ceil(max/10)*10;}return 100;}
const GRADE_FIELDS={class:['班级','班别','所在班级'],id:['学号','考号','准考证号','自定义考号','编号','考籍号'],name:['姓名','学生姓名'],score:['最终总评成绩','总分','成绩','分数','得分'],classRank:['班级排名','班排名','班内排名','班次'],gradeRank:['段排名','年级排名','年级名次','校级排名','校次','段次']};
// 读取一个工作簿：带日期的工作表各自成为一场考试，其余工作表并入文件名对应的考试。
// 学号/考号仅作参考，学生身份统一以“班级+姓名”为准。
async function importGradeBooks(file){const sheets=await parseXlsx(file),fileSource=parseFilename(file.name),groups=new Map(),warnings=[];
  sheets.forEach(sheet=>{
    const head=findHeader(sheet.rows);if(!head)return;
    const h=head.values,idx={};
    for(const key of Object.keys(GRADE_FIELDS))idx[key]=fieldIndex(h,GRADE_FIELDS[key],key==='score'?['率','%','满分']:[]);
    if(idx.name<0){warnings.push(`工作表“${sheet.name}”未找到姓名列，已跳过`);return;}
    const label=parseExamLabel(sheet.name),fromSheet=Boolean(label.date),source=fromSheet?{exercise:label.exercise||fileSource.exercise,date:label.date}:fileSource,key=fromSheet?`sheet:${source.exercise}|${source.date}`:'file';
    const group=groups.get(key)||{key,source,sheets:[],students:[],warnings:[],merged:false};groups.set(key,group);group.sheets.push(sheet);if(!fromSheet)group.merged=true;
    if(idx.class<0)group.warnings.push(`工作表“${sheet.name}”未找到班级列，已按“未分班”处理`);
    let skippedName=0;
    for(const row of sheet.rows.slice(head.index+1)){
      const name=norm(row[idx.name]);if(isPlaceholderName(name)){skippedName++;continue;}
      const examId=idx.id>=0?norm(row[idx.id]):'',score=idx.score>=0?num(row[idx.score]):null;
      group.students.push({sourceExamId:isMissingId(examId)?'':examId,name,className:normalizeClassName(idx.class>=0?row[idx.class]:''),rawScore:score===null?0:Math.max(0,score),score:score===null?0:score,classRank:num(row[idx.classRank]),gradeRank:num(row[idx.gradeRank]),source:source.exercise,sourceDate:source.date,focus:false});
    }
    if(skippedName)group.warnings.push(`工作表“${sheet.name}”有 ${skippedName} 行未识别到姓名，已跳过`);
  });
  // 每场考试内部按“班级+姓名”定位学生：重名时加序号，序号在考试内保持稳定
  for(const g of groups.values()){
    if(g.merged){const seen=new Set();g.students=g.students.filter(r=>{const k=`${identityBase(r)}|${r.sourceExamId||''}`;if(seen.has(k))return false;seen.add(k);return true;});}
    const totals=new Map();g.students.forEach(r=>{const k=identityBase(r);totals.set(k,(totals.get(k)||0)+1);});
    const counts=new Map();
    g.students.sort((a,b)=>identityBase(a).localeCompare(identityBase(b),'zh-CN')||String(a.sourceExamId).localeCompare(String(b.sourceExamId)));
    g.students.forEach(r=>{const k=identityBase(r),n=(counts.get(k)||0)+1;counts.set(k,n);r.id=totals.get(k)>1?`${k}(${n})`:k;r.displayName=totals.get(k)>1?`${r.name}(${n})`:r.name;r.identityKey=r.id;});
  }
  const exams=[...groups.values()].filter(g=>g.students.length).map(g=>({key:g.key,merged:g.merged,sheetNames:g.sheets.map(s=>s.name),source:g.source,students:g.students,warnings:g.warnings,totalScore:inferTotalScore(g.sheets,g.students)}));
  return {exams,warnings,source:fileSource};
}
