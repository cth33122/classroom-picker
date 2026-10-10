function downloadText(name, text, type='application/json') { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
// 备份里 history 行自带 eval/question/questionAt/updatedAt（点名复盘），无需额外表；version 3 起含复盘字段
async function exportBackup() { const data={version:3,exportedAt:new Date().toISOString(),students:await DB.all('students'),history:await DB.all('history'),settings:await DB.all('settings'),absences:await DB.all('absences'),meta:await DB.all('meta'),exams:await DB.all('exams'),examResults:await DB.all('examResults'),seats:await DB.all('seats')}; downloadText(`课堂点名备份-${localDate()}.json`,JSON.stringify(data,null,2)); }
async function exportHistory() { const [history,students]=await Promise.all([DB.all('history'),DB.all('students')]); const map=new Map(students.map(s=>[s.id,s])); const rows=[['时间','班级','学号','姓名','难度','评价','问题内容']]; history.forEach(x=>{const s=map.get(x.studentId)||{}; rows.push([new Date(x.at).toLocaleString(),s.className||'',s.id||x.studentId,s.name||'',x.difficulty||'',x.eval==='good'?'😊':x.eval==='bad'?'😢':'',String(x.question||'')]);}); downloadText(`点名历史-${localDate()}.csv`,rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),'text/csv;charset=utf-8'); }

// 导出成绩表格：每场考试一个工作表，工作表名沿用“考试名称-日期”，导出后可直接再导入
function excelSheetName(name,date,used){
  const base=String(name||'').replace(/[:\\/?*\[\]]/g,' ').replace(/\s+/g,' ').trim().replace(/^'+|'+$/g,'')||'成绩';
  const suffix=date?`-${date}`:'',raw=`${base}${suffix}`;
  let sheet=`${base.slice(0,Math.max(1,31-suffix.length)).trim()}${suffix}`,n=2;
  while(used.has(sheet)){const tag=`(${n++})`;sheet=`${raw.slice(0,31-tag.length).trim()}${tag}`;}
  used.add(sheet);return sheet||'成绩';
}
function excelColName(index){let s='';for(let i=index+1;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
function excelCell(ref,value){if(value===null||value===undefined||value==='')return '';if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}"><v>${value}</v></c>`;return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;}
function excelSheetXml(rows){const body=rows.map((row,ri)=>`<row r="${ri+1}">`+row.map((cell,ci)=>excelCell(`${excelColName(ci)}${ri+1}`,cell)).join('')+`</row>`).join('');return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;}
function excelNumber(value){if(value===null||value===undefined||value==='')return '';const n=Number(value);return Number.isFinite(n)?n:'';}

// 表头用“姓名/班级/成绩/班次/段次/考号”，与导入器的字段词典一致
async function buildGradesXlsx(){
  const exams=chronologicalExams();
  if(!exams.length)return null;
  const zip=new JSZip(),used=new Set();
  const sheets=exams.map(exam=>{
    const rows=[['序号','姓名','班级','成绩','班次','段次','考号']];
    state.examResults.filter(r=>r.examId===exam.id).map(r=>r.result||{})
      .sort((a,b)=>String(a.className||'').localeCompare(String(b.className||''),'zh-CN')||((Number(a.classRank)||1e9)-(Number(b.classRank)||1e9))||String(a.name||'').localeCompare(String(b.name||''),'zh-CN'))
      .forEach((r,i)=>rows.push([i+1,String(r.name??''),String(r.className??''),excelNumber(r.score),excelNumber(r.classRank),excelNumber(r.gradeRank),String(r.sourceExamId??'')]));
    return {name:excelSheetName(exam.name,exam.date,used),rows};
  });
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>');
  sheets.forEach((s,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,excelSheetXml(s.rows)));
  return zip;
}

async function exportGrades(){
  if(typeof JSZip==='undefined'){toast('导出组件尚未加载，请刷新页面重试');return;}
  const exams=chronologicalExams();
  if(!exams.length){toast('暂无可导出的考试成绩，请先导入成绩文件');return;}
  try{
    const zip=await buildGradesXlsx();
    const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`成绩导出-${localDate()}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast(`已导出 ${exams.length} 场考试的成绩表格`);
  }catch(err){toast(`导出失败：${err.message}`);}
}

function xmlEscape(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
async function downloadGradeTemplate(){
  if(typeof JSZip==='undefined'){toast('模板组件尚未加载，请刷新页面重试');return;}
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成绩数据" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  const headers=['班级','学号','姓名','最终总评成绩','班级排名','段排名'];
  const cells=headers.map((value,index)=>{const col=String.fromCharCode(65+index);return `<c r="${col}1" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;}).join('');
  zip.file('xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row><row r="2"></row></sheetData></worksheet>`);
  const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='成绩导入模板.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
