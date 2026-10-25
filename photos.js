// 学生头像：本机保存（IndexedDB 的 photos 表，id 就是学生 id）、单人设置（拍照 / 相册 + 裁剪）、整班头像包导入。
// 每个学生存两份：512×512 的方形头像（显示用）+ 长边 768 的“原图压缩版”（以后可以反复调整裁剪位置）。
// 都压成 JPEG：手机原图动辄 3~5MB，直接入库会把 IndexedDB 撑大。

const AVATAR_SIZE=512;          // 头像保存尺寸（正方形）
const AVATAR_SRC_SIZE=1024;     // “原图压缩版”的长边尺寸（批量放大取景时要留像素余量）
const AVATAR_QUALITY=0.86;
const AVATAR_SRC_QUALITY=0.82;
const AVATAR_ZOOM_MAX=4;        // 裁剪时最大放大倍数
const PHOTO_FILE_RE=/\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

// ---------- 读取与缓存 ----------
function photoRecord(studentId){return (state.photos&&state.photos[studentId])||null;}
function photoCount(){return Object.keys(state.photos||{}).length;}
const avatarUrlCache=new Map();   // 学生 id → {url, updatedAt}
function avatarUrl(studentId){
  const rec=photoRecord(studentId);
  if(!rec||!rec.blob)return '';
  const hit=avatarUrlCache.get(studentId);
  if(hit&&hit.updatedAt===rec.updatedAt)return hit.url;
  if(hit)URL.revokeObjectURL(hit.url);
  const url=URL.createObjectURL(rec.blob);
  avatarUrlCache.set(studentId,{url,updatedAt:rec.updatedAt});
  return url;
}
// 没有照片时用姓氏占位；色相只跟学生 id 有关，所以同一个人每次刷新颜色都一样
function avatarHue(text){let h=0;const s=String(text||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function avatarHtml(student,opts){
  const o=opts||{},id=String((student&&student.id)||''),name=String((student&&(student.displayName||student.name))||'').trim(),size=o.size||28;
  const url=avatarUrl(id);
  const initial=[...name].find(ch=>isHanChar(ch))||name.slice(0,1)||'?';
  // size 可以是数字（px），也可以直接给 CSS 长度（如 var(--cand-avatar,38px)），交给样式自己算
  const sizeCss=typeof size==='string'?size:size+'px';
  const style='--avatar-size:'+sizeCss+(url?'':';--avatar-hue:'+avatarHue(id));
  const inner=url?`<img class="avatar-img" src="${esc(url)}" alt="">`:`<span class="avatar-initial" aria-hidden="true">${esc(initial)}</span>`;
  const cls='avatar'+(o.cls?' '+o.cls:'');
  if(o.editable)return `<button type="button" class="${cls}" style="${style}" data-avatar-edit="${esc(id)}" title="点击设置或更换头像">${inner}</button>`;
  return `<span class="${cls}" style="${style}">${inner}</span>`;
}
async function loadPhotos(){
  const rows=await DB.all('photos');
  const map={};
  rows.forEach(r=>{if(r&&r.id&&r.blob)map[r.id]=r;});
  // 已被替换或删除的头像：把旧的 objectURL 释放掉，别在内存里留着没用的 blob
  avatarUrlCache.forEach((v,k)=>{const rec=map[k];if(!rec||rec.updatedAt!==v.updatedAt){URL.revokeObjectURL(v.url);avatarUrlCache.delete(k);}});
  return map;
}
async function saveAvatar(studentId,blob,srcBlob,crop){
  const rec={id:studentId,blob,type:blob.type||'image/jpeg',bytes:blob.size,updatedAt:Date.now()};
  if(srcBlob)rec.srcBlob=srcBlob;                 // 原图压缩版：用于以后反复调整裁剪位置
  // 记住上次取景（相对视窗的比例，窗口大小变了也能还原），下次打开“头像页”直接就是这张头像的样子
  if(crop&&Number.isFinite(Number(crop.zoom)))rec.crop=crop;
  await DB.put('photos',rec);
  state.photos=state.photos||{};
  state.photos[studentId]=rec;
  return rec;
}
// 取“可以重新裁剪”的源图：优先原图压缩版（老数据没有就退回方形头像本身）
function avatarSourceBlob(studentId){
  const rec=photoRecord(studentId);
  return rec?(rec.srcBlob||rec.blob||null):null;
}
async function deleteAvatar(studentId){
  await DB.remove('photos',studentId);
  if(state.photos)delete state.photos[studentId];
  const hit=avatarUrlCache.get(studentId);
  if(hit){URL.revokeObjectURL(hit.url);avatarUrlCache.delete(studentId);}
}

// ---------- 图片解码与画布工具 ----------
// 先用 <img> 解码：浏览器对 <img> 会按 EXIF 方向摆正，画到画布上和裁剪窗里看到的一致；
// <img> 不行（少见）再退回 createImageBitmap，两种都不行就把原始错误抛给调用方提示老师。
async function decodeImage(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.decoding='async';i.onload=()=>res(i);i.onerror=()=>rej(new Error('这张图片打不开（HEIC 等格式请先在相册里转成 JPEG）'));i.src=url;});
    return {src:img,w:img.naturalWidth||img.width,h:img.naturalHeight||img.height,release(){URL.revokeObjectURL(url);}};
  }catch(err){
    URL.revokeObjectURL(url);
    if(typeof createImageBitmap==='function'){
      try{
        const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
        return {src:bmp,w:bmp.width,h:bmp.height,release(){try{bmp.close&&bmp.close();}catch(e){}}};
      }catch(err2){/* 两种都读不了，抛出前面的提示 */}
    }
    throw err;
  }
}
function dataUrlToBlob(url){
  const parts=String(url).split(','),mime=(parts[0].match(/:(.*?);/)||[])[1]||'image/jpeg',bin=atob(parts[1]||'');
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function canvasToBlob(canvas,type,quality){
  return new Promise(resolve=>{
    if(canvas.toBlob)canvas.toBlob(b=>resolve(b||dataUrlToBlob(canvas.toDataURL(type,quality))),type,quality);
    else resolve(dataUrlToBlob(canvas.toDataURL(type,quality)));
  });
}
// 整图缩到长边 AVATAR_SRC_SIZE（保留原图内容，供以后重新裁剪）
async function sourceFrameBlob(src,w,h){
  const scale=Math.min(1,AVATAR_SRC_SIZE/Math.max(w,h));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(src,0,0,w,h,0,0,canvas.width,canvas.height);
  return canvasToBlob(canvas,'image/jpeg',AVATAR_SRC_QUALITY);
}
// 居中正方形裁剪 + 缩放（整班导入用）；单人头像走裁剪窗口，可以自己调位置和缩放
// 返回 {blob（512 方形）, srcBlob（原图压缩版）}
async function squareAvatarBlob(src,w,h){
  const side=Math.min(w,h),canvas=document.createElement('canvas');
  canvas.width=AVATAR_SIZE;canvas.height=AVATAR_SIZE;
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(src,(w-side)/2,(h-side)/2,side,side,0,0,AVATAR_SIZE,AVATAR_SIZE);
  const blob=await canvasToBlob(canvas,'image/jpeg',AVATAR_QUALITY);
  const srcBlob=await sourceFrameBlob(src,w,h);
  return {blob,srcBlob};
}

// ---------- 裁剪取景的共用数学 ----------
// params: {rot, zoom, dx, dy}；dx/dy 是相对“取景框宽/高”的偏移比例（0 = 居中），
// 与单人头像页存进 photo.crop 的那份完全一致，所以批量取景的结果可以直接写回 crop。
function avatarCropZoom(value){return Math.max(1,Math.min(AVATAR_ZOOM_MAX,Number(value)||1));}
// 算出“源图 → 输出正方形”的缩放，以及在这个缩放下横向/纵向还能平移多少（按输出框的比例）
function avatarCropLimits(w,h,params,out){
  const zoom=avatarCropZoom(params&&params.zoom);
  const base=Math.max(out/w,out/h)*zoom;            // 源图像素 → 输出像素
  const rot=(((Number(params&&params.rot)||0)%360)+360)%360;
  const swap=rot%180!==0;
  const boxW=(swap?h:w)*base,boxH=(swap?w:h)*base;  // 旋转 90°/270° 后宽高互换
  return {zoom,base,limX:Math.max(0,(boxW-out)/2/out),limY:Math.max(0,(boxH-out)/2/out)};
}
// 按取景参数把源图裁成 AVATAR_SIZE 的正方形 JPEG（单张保存与批量取景共用这一份）
function avatarCropBlob(img,w,h,params){
  const out=AVATAR_SIZE,p=params||{};
  const {base,limX,limY}=avatarCropLimits(w,h,p,out);
  const dx=Math.max(-limX,Math.min(limX,Number(p.dx)||0));
  const dy=Math.max(-limY,Math.min(limY,Number(p.dy)||0));
  const rot=(((Number(p.rot)||0)%360)+360)%360;
  const canvas=document.createElement('canvas');
  canvas.width=out;canvas.height=out;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,out,out);        // 万一露出边缘，填白而不是黑
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.translate(out/2,out/2);
  ctx.translate(dx*out,dy*out);
  ctx.rotate(rot*Math.PI/180);
  ctx.scale(base,base);
  ctx.drawImage(img,-w/2,-h/2,w,h);
  return canvasToBlob(canvas,'image/jpeg',AVATAR_QUALITY);
}

// ---------- 单个学生：点头像 = 直接打开“头像页”（大图 + 可调整裁剪） ----------
function closeAvatarMenu(){const el=document.getElementById('avatarMenu');if(el)el.remove();}
// 还没有头像时的小选择框：拍照 / 从相册选
function openAvatarPicker(student){
  closeAvatarMenu();
  if(!student)return;
  const modal=document.createElement('div');
  modal.id='avatarMenu';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card avatar-menu-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>${esc(student.displayName||student.name)} 的头像</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="actions avatar-menu-actions">\
<button class="primary" id="avatarCameraBtn">拍照</button>\
<button class="secondary" id="avatarAlbumBtn">从相册或文件选择</button>\
</div>\
<p class="hint">照片只保存在这台设备上，不会上传。选好后可以拖动、缩放、旋转，按正方形裁剪。</p>\
<input id="avatarCameraInput" type="file" accept="image/*" capture="environment" hidden>\
<input id="avatarAlbumInput" type="file" accept="image/*" hidden>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  const wire=(inputId,openId)=>{
    const input=$('#'+inputId);
    $('#'+openId).onclick=()=>{input.value='';input.click();};
    input.onchange=async()=>{
      const file=input.files&&input.files[0];
      input.value='';
      if(!file)return;
      if(!PHOTO_FILE_RE.test(file.name||'')&&!/^image\//i.test(file.type||'')){toast('请选择图片文件');return;}
      close();
      await openAvatarCrop(student,file);
    };
  };
  wire('avatarCameraInput','avatarCameraBtn');
  wire('avatarAlbumInput','avatarAlbumBtn');
}
// 点头像的入口：已有头像就直接进“头像页”，不再先弹一层菜单
async function openStudentAvatar(student){
  if(!student)return;
  const rec=photoRecord(student.id);
  if(!rec){openAvatarPicker(student);return;}
  const src=avatarSourceBlob(student.id)||rec.blob;
  await openAvatarCrop(student,src,{legacy:!rec.srcBlob,restore:rec.crop});
}
function closeAvatarCrop(){const el=document.getElementById('avatarCrop');if(el)el.remove();}
async function openAvatarCrop(student,file,options){
  closeAvatarCrop();
  const opts=options||{};
  let url='';
  try{url=URL.createObjectURL(file);}catch(err){toast('无法读取这张图片');return;}
  const S=Math.max(180,Math.min(340,Math.round(Math.min(window.innerWidth||360,window.innerHeight||640)*0.6)));
  const st={rot:0,zoom:1,x:0,y:0,w:0,h:0,cover:1,S};
  const who=esc(student.displayName||student.name);
  const hasPhoto=Boolean(photoRecord(student.id));
  const modal=document.createElement('div');
  modal.id='avatarCrop';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card avatar-crop-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>${who} 的头像</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="avatar-crop-view" id="avatarCropView" style="--crop-size:${S}px"><img id="avatarCropImg" alt="" src="${esc(url)}"></div>\
<div class="avatar-crop-tools">\
<button class="secondary" id="avatarRotateBtn">旋转 90°</button>\
<label class="avatar-zoom"><span>缩放</span><input type="range" id="avatarZoom" min="100" max="${Math.round(AVATAR_ZOOM_MAX*100)}" value="100"></label>\
<button class="secondary" id="avatarResetBtn">复位</button>\
</div>\
<p class="hint">${opts.legacy?'这张头像没有保留原图，只能在现有方图里重新取景；想用完整原图请点“换照片”。':'拖动图片调整位置，滑块或双指缩放；头像按正方形裁剪。'}</p>\
<div class="actions avatar-crop-actions">\
<button type="button" class="secondary" id="avatarSwapBtn">换照片</button>\
${hasPhoto?'<button type="button" class="danger" id="avatarRemoveBtn">删除头像</button>':''}\
<button class="secondary" id="avatarCancelBtn">取消</button>\
<button class="primary" id="avatarOkBtn">保存</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const view=$('#avatarCropView'),img=$('#avatarCropImg'),zoom=$('#avatarZoom');
  const done=()=>{img.removeAttribute('src');if(url)URL.revokeObjectURL(url);modal.remove();};
  modal.querySelector('.modal-close').onclick=done;
  $('#avatarCancelBtn').onclick=done;
  modal.onclick=e=>{if(e.target===modal)done();};
  // 换照片：再选一张（拍照或相册），选完用新图重新打开这个头像页
  $('#avatarSwapBtn').onclick=()=>openAvatarPicker(student);
  // 删除：当前学生已有头像时才有这个按钮
  const removeBtn=$('#avatarRemoveBtn');
  if(removeBtn)removeBtn.onclick=async()=>{
    if(!confirm(`删除 ${student.displayName||student.name} 的头像？`))return;
    done();
    await deleteAvatar(student.id);
    render();
    toast('已删除头像');
  };
  // 等图片加载完才知道真实尺寸：先算“铺满正方形”的基准比例，用户的缩放再乘上去
  await new Promise(resolve=>{
    if(img.complete&&img.naturalWidth){resolve();return;}
    img.onload=()=>resolve();
    img.onerror=()=>resolve();
  });
  if(!img.naturalWidth){toast('这张图片打不开，请换一张');done();return;}
  st.w=img.naturalWidth;st.h=img.naturalHeight;st.cover=Math.max(S/st.w,S/st.h);
  const syncZoom=()=>{zoom.value=String(Math.round(st.zoom*100));};
  const apply=()=>{
    const dispW=st.w*st.cover*st.zoom,dispH=st.h*st.cover*st.zoom;
    const swap=st.rot%180!==0;                 // 转 90°/270° 后宽高互换，边界要按外接矩形算
    const boxW=swap?dispH:dispW,boxH=swap?dispW:dispH;
    const limX=Math.max(0,(boxW-S)/2),limY=Math.max(0,(boxH-S)/2);
    st.x=Math.max(-limX,Math.min(limX,st.x));
    st.y=Math.max(-limY,Math.min(limY,st.y));
    img.style.width=dispW+'px';img.style.height=dispH+'px';
    img.style.transform=`translate(-50%,-50%) translate(${st.x}px,${st.y}px) rotate(${st.rot}deg)`;
  };
  // 打开已有头像时按上次保存的取景还原，看到的正是当前这张头像（而不是重置到居中）
  const restore=opts.restore;
  if(restore&&Number.isFinite(Number(restore.zoom))){
    st.rot=(Number(restore.rot)||0)%360;
    st.zoom=Math.max(1,Math.min(AVATAR_ZOOM_MAX,Number(restore.zoom)||1));
    st.x=(Number(restore.dx)||0)*S;
    st.y=(Number(restore.dy)||0)*S;
    syncZoom();
  }
  apply();
  zoom.oninput=()=>{st.zoom=Math.max(1,Math.min(AVATAR_ZOOM_MAX,Number(zoom.value)/100));apply();};
  $('#avatarRotateBtn').onclick=()=>{st.rot=(st.rot+90)%360;st.x=0;st.y=0;apply();};
  $('#avatarResetBtn').onclick=()=>{st.rot=0;st.zoom=1;st.x=0;st.y=0;syncZoom();apply();};
  // 拖动移动、双指缩放（单指 = 拖动，双指 = 缩放）
  const pointers=new Map();
  let pinch=0;
  const spread=()=>{const p=[...pointers.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);};
  view.addEventListener('pointerdown',e=>{try{view.setPointerCapture(e.pointerId);}catch(err){}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2)pinch=spread();});
  view.addEventListener('pointermove',e=>{
    const p=pointers.get(e.pointerId);
    if(!p)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    p.x=e.clientX;p.y=e.clientY;
    if(pointers.size===1){if(dx||dy){st.x+=dx;st.y+=dy;apply();}}
    else if(pointers.size===2){
      const d=spread();
      if(pinch>0&&d>0){st.zoom=Math.max(1,Math.min(AVATAR_ZOOM_MAX,st.zoom*d/pinch));syncZoom();apply();}
      pinch=d;
    }
  });
  const drop=e=>{pointers.delete(e.pointerId);if(pointers.size<2)pinch=0;};
  view.addEventListener('pointerup',drop);
  view.addEventListener('pointercancel',drop);
  view.addEventListener('wheel',e=>{e.preventDefault();st.zoom=Math.max(1,Math.min(AVATAR_ZOOM_MAX,st.zoom*(e.deltaY<0?1.1:0.9)));syncZoom();apply();},{passive:false});
  $('#avatarOkBtn').onclick=async()=>{
    const btn=$('#avatarOkBtn');
    btn.disabled=true;btn.textContent='保存中…';
    try{
      const crop={rot:st.rot,zoom:st.zoom,dx:S?st.x/S:0,dy:S?st.y/S:0};
      // 和批量取景用同一套数学，保证两条路裁出来的结果一致
      const blob=await avatarCropBlob(img,st.w,st.h,crop);
      // 顺带存一份“原图压缩版”，以后打开“头像页”可以从完整画面重新取景
      let srcBlob=null;
      try{srcBlob=await sourceFrameBlob(img,st.w,st.h);}catch(err){}
      // 记下这次取景（按取景框比例存），下次点开这个学生的头像时直接还原成这张头像的样子
      await saveAvatar(student.id,blob,srcBlob,crop);
      done();
      render();
      toast('头像已保存');
    }catch(err){
      btn.disabled=false;btn.textContent='保存';
      toast('保存头像失败：'+err.message);
    }
  };
}

// ---------- 整班头像包（zip）导入 ----------
// 包内两种写法都支持：
//   1) 根目录放 manifest.csv（班级,学号,姓名,文件名），照片放 photos/ 子目录 —— 最稳；
//   2) 不放清单，照片文件名里带学号或姓名（如 20260101.jpg、张三.jpg、张三_头像.jpg）—— 最省事。
function looseKey(text){return String(text||'').replace(/\s+/g,'').replace(/[()（）\[\]【】_\-.．·,，、]/g,'').toLowerCase();}
function parseDelimited(text){
  const t=String(text||'').replace(/^\uFEFF/,'');
  const firstLine=t.split(/\r?\n/)[0]||'';
  const sep=firstLine.includes('\t')&&!firstLine.includes(',')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(quoted){
      if(c==='"'){if(t[i+1]==='"'){cell+='"';i++;}else quoted=false;}
      else cell+=c;
      continue;
    }
    if(c==='"'){quoted=true;continue;}
    if(c===sep){row.push(cell);cell='';continue;}
    if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';continue;}
    if(c!=='\r')cell+=c;
  }
  row.push(cell);rows.push(row);
  return rows.map(r=>r.map(v=>String(v).trim())).filter(r=>r.some(v=>v!==''));
}
function parseAvatarManifest(text,byName){
  const rows=parseDelimited(text);
  if(!rows.length)return [];
  const head=rows[0].map(v=>norm(v));
  const idxOf=re=>head.findIndex(v=>v&&re.test(v));
  const idx={cls:idxOf(/班级|班别/),no:idxOf(/学号|考号|编号/),name:idxOf(/姓名|学生/),file:idxOf(/文件|照片|图片/)};
  const hasHeader=idx.name>=0||idx.file>=0;
  const body=hasHeader?rows.slice(1):rows;
  return body.map(r=>{
    if(hasHeader)return {className:idx.cls>=0?(r[idx.cls]||''):'',studentNo:idx.no>=0?(r[idx.no]||''):'',name:idx.name>=0?(r[idx.name]||''):'',file:idx.file>=0?(r[idx.file]||''):''};
    // 没写表头：按内容猜——像图片名的那列当文件名，4 位以上数字当学号，能对上班内名单的那列当姓名
    const file=r.find(v=>PHOTO_FILE_RE.test(v))||'';
    const studentNo=r.find(v=>/^\d{4,}$/.test(v))||'';
    const name=r.find(v=>v&&v!==file&&v!==studentNo&&byName.has(norm(v)))||'';
    const className=r.find(v=>/班/.test(v))||'';
    return {className,studentNo,name,file};
  });
}
function avatarStudentIndex(){
  const byName=new Map(),byNo=new Map();
  state.students.forEach(s=>{
    [norm(s.name),norm(s.displayName)].filter(Boolean).forEach(k=>{
      const arr=byName.get(k)||[];
      if(!arr.includes(s))arr.push(s);
      byName.set(k,arr);
    });
    if(s.sourceExamId)byNo.set(String(s.sourceExamId).trim(),s);
  });
  return {byName,byNo};
}
// 学号 → 姓名（+班级）→ 重名时用当前班优先；还是分不清就报“重名待确认”
function resolveAvatarStudent(row,index){
  const cls=row.className?normalizeClassName(row.className):'';
  const no=String(row.studentNo||'').trim();
  if(no&&index.byNo.has(no))return {student:index.byNo.get(no),how:'学号'};
  let cands=norm(row.name)?(index.byName.get(norm(row.name))||[]).slice():[];
  if(!cands.length)return {student:null,how:''};
  if(cls){
    const inCls=cands.filter(s=>normalizeClassName(s.className)===cls);
    if(inCls.length)cands=inCls;
  }
  if(cands.length>1&&state.currentClass){
    const cur=cands.filter(s=>s.className===state.currentClass);
    if(cur.length)cands=cur;
  }
  if(cands.length===1)return {student:cands[0],how:'姓名'};
  return {student:null,how:'',ambiguous:cands};
}
// 从照片文件名里认人：整名、学号、或“学号_姓名”“姓名(2)”这种带前后缀的写法
// 文件名里带班号（如“张三（01班）.jpg”“01班_张三.jpg”）时按班级筛候选，支持整校一起导入；
// 还是分不清就返回 {ambiguous}，由调用方提示老师改文件名或补学号，绝不猜
function classHintFromBasename(stem){
  const text=String(stem||'');
  const hit=text.match(/(\d{1,2})\s*班/);
  if(hit)return normalizeClassName(hit[0]);
  // “01-张三”“1_李四”这种把班号当纯数字前缀的写法
  const lead=text.match(/^(?:^|[\s_\-—.．·,，、()（）\[\]【】]+)(\d{1,2})(?:[\s_\-—.．·,，、()（）\[\]【】]|$)/);
  if(lead)return normalizeClassName(lead[1]);
  return '';
}
function studentFromBasename(base,index){
  const stem=String(base||'').replace(PHOTO_FILE_RE,'').trim();
  const compact=norm(stem);
  if(!compact)return null;
  if(index.byNo.has(compact))return {student:index.byNo.get(compact),how:'学号'};
  // “学号+姓名”直接连写（如 20260101张三）：取最长的学号前缀/后缀来认人，
  // 这样整校同名学生在只写“学号姓名”时也不会认错
  for(let len=Math.min(compact.length-2,12);len>=4;len--){
    if(index.byNo.has(compact.slice(0,len)))return {student:index.byNo.get(compact.slice(0,len)),how:'学号'};
  }
  for(let len=Math.min(compact.length-2,12);len>=4;len--){
    if(index.byNo.has(compact.slice(-len)))return {student:index.byNo.get(compact.slice(-len)),how:'学号'};
  }
  const classHint=classHintFromBasename(stem);
  const inClass=arr=>{
    const list=arr||[];
    if(!classHint)return list;
    const hit=list.filter(s=>normalizeClassName(s.className)===classHint);
    return hit.length?hit:list;          // 文件名里的班号对不上学生班级时退回全集，交给别处判断
  };
  const whole=inClass(index.byName.get(compact));
  if(whole.length===1)return {student:whole[0],how:'姓名'};
  if(whole.length>1)return {student:null,how:'',ambiguous:whole};
  const parts=stem.split(/[\s_\-—.．·,，、()（）\[\]【】]+/).filter(Boolean);
  for(const part of parts){const k=norm(part);if(index.byNo.has(k))return {student:index.byNo.get(k),how:'学号'};}
  for(const part of parts){const arr=inClass(index.byName.get(norm(part)));if(arr.length===1)return {student:arr[0],how:'姓名'};}
  let found=null,multi=null;
  index.byName.forEach((arr,k)=>{
    if(found||k.length<2||!compact.includes(k))return;
    const list=inClass(arr);
    if(list.length===1)found={student:list[0],how:'姓名'};
    else if(!multi)multi={student:null,how:'',ambiguous:list};
  });
  return found||multi;
}
function avatarProgressUi(total,title){
  const modal=document.createElement('div');
  modal.id='avatarProgress';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card avatar-progress-card" role="dialog" aria-modal="true">\
<h2>${esc(title||'正在导入头像')}</h2>\
<div class="avatar-progress"><span id="avatarProgressBar"></span></div>\
<p class="hint" id="avatarProgressText">0 / ${total}</p>\
<p class="hint">每张都会压成 ${AVATAR_SIZE}×${AVATAR_SIZE}，请先不要关闭页面。</p>\
</div>`;
  document.body.appendChild(modal);
  return {
    update(done,all,label){
      const bar=$('#avatarProgressBar'),txt=$('#avatarProgressText');
      if(bar)bar.style.width=Math.round(done/Math.max(1,all)*100)+'%';
      if(txt)txt.textContent=done+' / '+all+(label?'（'+label+'）':'');
    },
    close(){modal.remove();},
  };
}
async function importAvatarPackage(file){
  if(typeof JSZip==='undefined'){toast('压缩包组件还没加载好，请刷新页面重试');return;}
  let zip;
  try{zip=await JSZip.loadAsync(file);}catch(err){toast('这个文件不是有效的 zip 压缩包');return;}
  const images=[],csvs=[];
  zip.forEach((path,zipEntry)=>{
    if(zipEntry.dir)return;
    const base=(path.split('/').pop()||'').trim();
    if(!base||base.startsWith('.')||/^__MACOSX\//i.test(path))return;
    if(PHOTO_FILE_RE.test(base))images.push({path,base,zipEntry});
    else if(/\.(csv|txt)$/i.test(base))csvs.push({path,base,zipEntry});
  });
  if(!images.length){toast('压缩包里没找到图片（支持 jpg / png / webp / gif / bmp）');return;}
  const index=avatarStudentIndex();
  const manifestEntry=csvs.find(x=>/manifest|清单|头像|名单/i.test(x.base))||(csvs.length===1?csvs[0]:null);
  const manifest=manifestEntry?parseAvatarManifest(await manifestEntry.zipEntry.async('text'),index.byName):null;
  const byBase=new Map(),byLoose=new Map();
  images.forEach(e=>{byBase.set(e.base,e);byLoose.set(looseKey(e.base),e);});
  const takeEntry=name=>{
    const want=String(name||'').trim();
    if(!want)return null;
    const base=want.split(/[\\/]/).pop();
    const stem=base.replace(PHOTO_FILE_RE,'');
    return byBase.get(base)||byBase.get(want)||byLoose.get(looseKey(base))||images.find(e=>e.base.replace(PHOTO_FILE_RE,'')===stem)||null;
  };
  const report={fromManifest:0,fromFile:0,noFile:[],ambiguous:[],noStudent:[],dupRows:0};
  const assigned=new Map(),used=new Set();
  (manifest||[]).forEach(row=>{
    const found=resolveAvatarStudent(row,index);
    if(!found.student){
      if(found.ambiguous)report.ambiguous.push((row.name||row.file||'?')+'（'+found.ambiguous.map(s=>s.className).join('、')+'）');
      else report.noStudent.push(row.name||row.file||'?');
      return;
    }
    const entry=takeEntry(row.file)||images.find(e=>{const hit=studentFromBasename(e.base,index);return hit&&hit.student.id===found.student.id;});
    if(!entry||used.has(entry.path)){report.noFile.push((row.name||'')+(row.file?'（'+row.file+'）':''));return;}
    if(assigned.has(found.student.id)){report.dupRows++;return;}
    assigned.set(found.student.id,{student:found.student,entry,how:'清单'});
    used.add(entry.path);
    report.fromManifest++;
  });
  images.forEach(entry=>{
    if(used.has(entry.path))return;
    const hit=studentFromBasename(entry.base,index);
    if(!hit)return;
    if(!hit.student){
      if(hit.ambiguous&&hit.ambiguous.length>1)report.ambiguous.push(entry.base+'（'+hit.ambiguous.map(s=>s.displayName||s.name).join('、')+'）');
      return;
    }
    if(assigned.has(hit.student.id))return;
    assigned.set(hit.student.id,{student:hit.student,entry,how:'文件名'});
    used.add(entry.path);
    report.fromFile++;
  });
  const jobs=[...assigned.values()];
  const leftover=images.filter(e=>!used.has(e.path));
  if(!jobs.length){
    showAvatarImportResult({report,leftover,total:images.length,processed:0,replaced:0,failed:[]});
    return;
  }
  const ui=avatarProgressUi(jobs.length);
  let processed=0,replaced=0;
  const failed=[],processedIds=[];
  for(let i=0;i<jobs.length;i++){
    const job=jobs[i];
    ui.update(i,jobs.length,job.student.displayName||job.student.name);
    try{
      const dec=await decodeImage(await job.entry.zipEntry.async('blob'));
      try{
        const {blob,srcBlob}=await squareAvatarBlob(dec.src,dec.w,dec.h);
        if(photoRecord(job.student.id))replaced++;
        await saveAvatar(job.student.id,blob,srcBlob);
        processedIds.push(job.student.id);
        processed++;
      }finally{dec.release();}
    }catch(err){failed.push((job.student.displayName||job.student.name||'')+'：'+(err.message||'读取失败'));}
  }
  ui.update(jobs.length,jobs.length);
  ui.close();
  // 记住这批是谁：导入后可以直接“批量调整裁剪”，默认只动这批人
  lastAvatarImport={ids:processedIds.slice(),at:Date.now()};
  // 整校一起导时，把涉及的班级也说清楚
  const touched=[...new Set(processedIds.map(id=>{
    const s=state.students.find(x=>x.id===id);
    return s?normalizeClassName(s.className):'';
  }).filter(Boolean))].sort();
  render();
  showAvatarImportResult({report,leftover,total:images.length,processed,replaced,failed,classes:touched});
}
function showAvatarImportResult({report,leftover,total,processed,replaced,failed,classes}){
  document.getElementById('avatarImportResult')?.remove();
  const inClass=state.students.filter(s=>!state.currentClass||s.className===state.currentClass);
  const missing=inClass.filter(s=>!photoRecord(s.id));
  const classList=Array.isArray(classes)?classes:[];
  const scopeNote=classList.length>1?`，涉及 ${classList.length} 个班（${classList.slice(0,6).join('、')}${classList.length>6?' 等':''}）`:'';
  const stats=`压缩包内照片 ${total} 张，成功写入 ${processed} 人的头像${scopeNote}${replaced?`（覆盖了 ${replaced} 个已有头像）`:''}`;
  const notes=[];
  if(report.fromManifest||report.fromFile)notes.push(`按清单对上 ${report.fromManifest} 人，按文件名对上 ${report.fromFile} 人`);
  if(report.dupRows)notes.push(`清单里同一个人写了多行，只用了第一行（${report.dupRows} 行）`);
  if(report.ambiguous.length)notes.push(`重名待确认：${report.ambiguous.slice(0,8).join('、')}${report.ambiguous.length>8?' 等':''}——请在清单里补上学号，或写成“张三(2)”这种带序号的名字`);
  if(report.noStudent.length)notes.push(`清单里这些人在班内名单找不到：${report.noStudent.slice(0,8).join('、')}${report.noStudent.length>8?' 等':''}`);
  if(report.noFile.length)notes.push(`清单里这些行没找到对应照片：${report.noFile.slice(0,8).join('、')}${report.noFile.length>8?' 等':''}`);
  if(failed.length)notes.push(`这些照片读取失败：${failed.slice(0,6).join('；')}${failed.length>6?' 等':''}`);
  if(leftover.length)notes.push(`压缩包里还有 ${leftover.length} 张照片没能和学生对上（文件名里最好带学号或姓名，也可以写进清单的文件名列）`);
  if(missing.length)notes.push(`本班还有 ${missing.length} 人没有头像，可以在“学生”页点开某个人，点头像直接拍照或选图`);
  const modal=document.createElement('div');
  modal.id='avatarImportResult';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card seat-import-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>头像导入完成</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="seat-import-stats">${esc(stats)}</p>\
${notes.length?`<ul class="seat-import-notes">${notes.map(n=>`<li class="seat-import-note info">${esc(n)}</li>`).join('')}</ul>`:''}\
${processed?`<p class="hint">如果人像偏小（单寸照常见），点下面的“批量调整裁剪”，一次把这几张统一放大、上下对齐。</p>`:''}\
<div class="actions">\
${processed?`<button type="button" class="secondary" id="avatarBatchBtn">批量调整裁剪</button>`:''}\
<button class="primary" id="avatarImportOk">知道了</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#avatarImportOk').onclick=close;
  const batchBtn=$('#avatarBatchBtn');
  if(batchBtn)batchBtn.onclick=()=>{close();openAvatarBatchCrop({scope:'import'});};
  modal.onclick=e=>{if(e.target===modal)close();};
}
// ---------- 批量取景：一次把一批（或整班）头像的裁剪统一调好 ----------
// 单寸照的常见毛病是“人像偏小、脸偏下”。这里用一组全局参数重新裁剪，
// 每张都基于已存的“原图压缩版”srcBlob 重算，不需要重新上传压缩包。
let lastAvatarImport=null;        // 最近一次头像包导入涉及的学生（批量取景默认只动这批）
let avatarBatchRunning=false;
const AVATAR_BATCH_PRESETS=[
  {key:'id',label:'单寸照',zoom:1.6,dx:0,dy:0.12},
  {key:'close',label:'更近',zoom:2.2,dx:0,dy:0.16},
  {key:'center',label:'原样居中',zoom:1,dx:0,dy:0},
];
// 可选范围：本次导入的人 / 整个班（有头像的人）
function avatarBatchStudents(scope){
  const only=scope==='import'&&lastAvatarImport&&lastAvatarImport.ids.length?new Set(lastAvatarImport.ids):null;
  return state.students.filter(s=>{
    if(!s||!photoRecord(s.id))return false;
    if(only)return only.has(s.id);
    return !state.currentClass||s.className===state.currentClass;
  });
}
// 记住上次用的参数（同类照片第二次不用再手调）
async function avatarBatchPrefs(){
  try{
    const rows=await DB.all('meta');
    const hit=(rows||[]).find(x=>x&&x.id==='avatarBatchParams');
    const v=hit&&hit.value;
    if(v&&Number.isFinite(Number(v.zoom)))return {zoom:Number(v.zoom),dx:Number(v.dx)||0,dy:Number(v.dy)||0};
  }catch(err){}
  return {zoom:AVATAR_BATCH_PRESETS[0].zoom,dx:AVATAR_BATCH_PRESETS[0].dx,dy:AVATAR_BATCH_PRESETS[0].dy};
}
function avatarBatchSavePrefs(params){
  DB.put('meta',{id:'avatarBatchParams',value:{zoom:params.zoom,dx:params.dx,dy:params.dy}}).catch(()=>{});
}
async function openAvatarBatchCrop(options){
  const opts=options||{};
  const hasImport=avatarBatchStudents('import').length>0;
  let scope=(opts.scope==='import'&&hasImport)||(!hasImport&&opts.scope!=='class')?'import':'class';
  if(!hasImport)scope='class';
  const params=await avatarBatchPrefs();
  document.getElementById('avatarBatchCrop')?.remove();
  const modal=document.createElement('div');
  modal.id='avatarBatchCrop';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card seat-import-card batch-crop-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>批量调整裁剪</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="batch-scope" id="batchScope"></div>\
<p class="hint" id="batchCountHint"></p>\
<div class="batch-crop-grid" id="batchGrid"></div>\
<div class="batch-crop-presets" id="batchPresets"></div>\
<div class="batch-crop-controls">\
<label class="batch-slider"><span>缩放</span><input type="range" id="batchZoom" min="100" max="300" step="5"><b id="batchZoomText"></b></label>\
<label class="batch-slider"><span>上下</span><input type="range" id="batchDy" min="-35" max="35" step="1"><b id="batchDyText"></b></label>\
<label class="batch-slider"><span>左右</span><input type="range" id="batchDx" min="-35" max="35" step="1"><b id="batchDxText"></b></label>\
</div>\
<p class="hint">“上下”调大＝取景框往上（看到更靠上的部分，单寸照常用）；点缩略图可以单独调这一张（会先关掉这个窗口），调完再回来批量应用。</p>\
<div class="actions">\
<button type="button" class="secondary" id="batchCancel">取消</button>\
<button type="button" class="primary" id="batchApply">应用</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const grid=$('#batchGrid'),scopeBox=$('#batchScope'),hint=$('#batchCountHint'),applyBtn=$('#batchApply');
  const tiles=[];          // {el,img,w,h,studentId}
  const urls=[];
  const zoomInput=$('#batchZoom'),dyInput=$('#batchDy'),dxInput=$('#batchDx');
  const close=()=>{
    urls.forEach(u=>{try{URL.revokeObjectURL(u);}catch(err){}});
    modal.remove();
  };
  const applyTile=tile=>{
    const {img,w,h}=tile;
    if(!w||!h)return;
    const T=Math.max(40,tile.el.clientWidth||120);
    const base=Math.max(T/w,T/h)*params.zoom;
    const dispW=w*base,dispH=h*base;
    const limX=Math.max(0,(dispW-T)/2),limY=Math.max(0,(dispH-T)/2);
    const x=Math.max(-limX,Math.min(limX,params.dx*T));
    const y=Math.max(-limY,Math.min(limY,params.dy*T));
    img.style.width=dispW+'px';
    img.style.height=dispH+'px';
    img.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px)`;
  };
  const syncLabels=()=>{
    zoomInput.value=String(Math.round(params.zoom*100));
    dyInput.value=String(Math.round(params.dy*100));
    dxInput.value=String(Math.round(params.dx*100));
    $('#batchZoomText').textContent=params.zoom.toFixed(2)+'×';
    $('#batchDyText').textContent=(params.dy>=0?'+':'')+Math.round(params.dy*100)+'%';
    $('#batchDxText').textContent=(params.dx>=0?'+':'')+Math.round(params.dx*100)+'%';
  };
  const applyAll=()=>{tiles.forEach(applyTile);syncLabels();};
  const renderScopeButtons=()=>{
    const imported=avatarBatchStudents('import').length,whole=avatarBatchStudents('class').length;
    scopeBox.innerHTML=`<button type="button" class="batch-scope-btn${scope==='import'?' is-on':''}" data-batch-scope="import"${imported?'':' disabled'}>本次导入 ${imported} 人</button>\
<button type="button" class="batch-scope-btn${scope==='class'?' is-on':''}" data-batch-scope="class"${whole?'':' disabled'}>整个班 ${whole} 人</button>`;
    scopeBox.querySelectorAll('[data-batch-scope]').forEach(b=>{
      b.onclick=()=>{if(scope===b.dataset.batchScope)return;scope=b.dataset.batchScope;buildTiles();};
    });
  };
  const buildTiles=async()=>{
    renderScopeButtons();
    const list=avatarBatchStudents(scope);
    grid.innerHTML='';
    tiles.length=0;
    while(urls.length){try{URL.revokeObjectURL(urls.pop());}catch(err){}}
    hint.textContent=list.length?`下面 ${list.length} 张会一起按上面的参数裁剪；点任意一张可以单独调。`:'这个范围里还没有头像。';
    applyBtn.disabled=!list.length;
    applyBtn.textContent=`应用到 ${list.length} 人`;
    list.forEach(s=>{
      const rec=photoRecord(s.id);
      const blob=rec&&(rec.srcBlob||rec.blob);
      const el=document.createElement('button');
      el.type='button';el.className='batch-tile';el.dataset.batchId=s.id;
      el.title=(s.displayName||s.name)+'（点击单独调整）';
      const img=document.createElement('img');
      img.alt='';
      el.appendChild(img);
      grid.appendChild(el);
      const tile={el,img,w:0,h:0,studentId:s.id};
      tiles.push(tile);
      el.onclick=()=>{close();openStudentAvatar(state.students.find(x=>x.id===s.id)||s);};
      if(blob){
        const url=URL.createObjectURL(blob);
        urls.push(url);
        img.onload=()=>{tile.w=img.naturalWidth;tile.h=img.naturalHeight;applyTile(tile);};
        img.src=url;
      }
    });
    applyAll();
  };
  $('#batchPresets').innerHTML=AVATAR_BATCH_PRESETS.map(p=>`<button type="button" class="batch-preset${Math.abs(p.zoom-params.zoom)<0.001&&Math.abs(p.dy-params.dy)<0.001&&Math.abs(p.dx-params.dx)<0.001?' is-on':''}" data-preset="${p.key}">${p.label}</button>`).join('');
  $('#batchPresets').querySelectorAll('[data-preset]').forEach(b=>{
    b.onclick=()=>{
      const p=AVATAR_BATCH_PRESETS.find(x=>x.key===b.dataset.preset);
      if(!p)return;
      params.zoom=p.zoom;params.dx=p.dx;params.dy=p.dy;
      applyAll();
      $('#batchPresets').querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('is-on',x===b));
    };
  });
  zoomInput.oninput=()=>{params.zoom=Math.max(1,Math.min(3,Number(zoomInput.value)/100||1));applyAll();};
  dyInput.oninput=()=>{params.dy=Math.max(-0.35,Math.min(0.35,Number(dyInput.value)/100||0));applyAll();};
  dxInput.oninput=()=>{params.dx=Math.max(-0.35,Math.min(0.35,Number(dxInput.value)/100||0));applyAll();};
  modal.querySelector('.modal-close').onclick=close;
  $('#batchCancel').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  applyBtn.onclick=async()=>{
    const list=avatarBatchStudents(scope);
    if(!list.length){toast('这个范围里还没有头像');return;}
    if(avatarBatchRunning)return;
    avatarBatchRunning=true;
    applyBtn.disabled=true;
    applyBtn.textContent='正在裁剪…';
    const snapshot=await avatarBatchApply(list,params);
    avatarBatchRunning=false;
    avatarBatchSavePrefs(params);
    close();
    showAvatarBatchResult(list.length,snapshot);
  };
  await buildTiles();
  window.addEventListener('resize',()=>{tiles.forEach(applyTile);},{once:true});
}
// 逐张重算并保存；返回 {done, failed, undoItems}
async function avatarBatchApply(students,params){
  const crop={rot:0,zoom:params.zoom,dx:params.dx,dy:params.dy};
  const ui=avatarProgressUi(students.length,'正在重新裁剪头像');
  const failed=[],undoItems=[];
  let done=0;
  for(const s of students){
    ui.update(done,students.length,s.displayName||s.name);
    const rec=photoRecord(s.id);
    const src=rec&&(rec.srcBlob||rec.blob);
    if(!src){failed.push((s.displayName||s.name)+'：没有可重算的原图');continue;}
    try{
      const dec=await decodeImage(src);
      try{
        const blob=await avatarCropBlob(dec.src,dec.w,dec.h,crop);
        await saveAvatar(s.id,blob,rec.srcBlob||rec.blob,crop);
        // 记下“改之前”的取景参数，方便一键撤回（只存参数，不存图片）
        undoItems.push({id:s.id,crop:rec.crop||null});
        done++;
      }finally{dec.release();}
    }catch(err){failed.push((s.displayName||s.name)+'：'+(err.message||'读取失败'));}
  }
  ui.update(students.length,students.length);
  ui.close();
  try{await DB.put('meta',{id:'avatarCropUndo',at:Date.now(),items:undoItems});}catch(err){}
  render();
  return {done,failed,undoItems};
}
function showAvatarBatchResult(total,result){
  document.getElementById('avatarBatchResult')?.remove();
  const failed=(result&&result.failed)||[];
  const modal=document.createElement('div');
  modal.id='avatarBatchResult';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card seat-import-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>批量取景完成</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="seat-import-stats">已按新的取景重新裁剪 ${result.done} / ${total} 人</p>\
${failed.length?`<ul class="seat-import-notes"><li class="seat-import-note warn">${esc('这些没处理：'+failed.slice(0,8).join('；')+(failed.length>8?' 等':''))}</li></ul>`:''}\
<p class="hint">不满意可以点“撤回”，用改之前的取景重算一遍；也可以点开某个学生的头像单独微调。</p>\
<div class="actions">\
<button type="button" class="secondary" id="avatarBatchUndo">撤回这次批量取景</button>\
<button type="button" class="primary" id="avatarBatchOk">知道了</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#avatarBatchOk').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  $('#avatarBatchUndo').onclick=async()=>{close();await avatarBatchUndo();};
}
// 撤回上一次批量取景：按存下来的旧参数重算（学生档案与照片本身不删）
async function avatarBatchUndo(){
  let snap=null;
  try{
    const rows=await DB.all('meta');
    snap=(rows||[]).find(x=>x&&x.id==='avatarCropUndo')||null;
  }catch(err){}
  if(!snap||!Array.isArray(snap.items)||!snap.items.length){toast('没有可撤回的批量取景');return;}
  if(avatarBatchRunning){toast('正在处理，请稍候');return;}
  avatarBatchRunning=true;
  const students=snap.items.map(it=>({student:state.students.find(s=>s.id===it.id),crop:it.crop})).filter(x=>x.student);
  const ui=avatarProgressUi(students.length,'正在撤回批量取景');
  const failed=[];
  let done=0;
  for(const item of students){
    const s=item.student;
    ui.update(done,students.length,s.displayName||s.name);
    const rec=photoRecord(s.id);
    const src=rec&&(rec.srcBlob||rec.blob);
    if(!src){failed.push((s.displayName||s.name)+'：没有可重算的原图');continue;}
    const crop=item.crop||{rot:0,zoom:1,dx:0,dy:0};
    try{
      const dec=await decodeImage(src);
      try{
        const blob=await avatarCropBlob(dec.src,dec.w,dec.h,crop);
        await saveAvatar(s.id,blob,rec.srcBlob||rec.blob,item.crop||undefined);
        done++;
      }finally{dec.release();}
    }catch(err){failed.push((s.displayName||s.name)+'：'+(err.message||'读取失败'));}
  }
  ui.update(students.length,students.length);
  ui.close();
  avatarBatchRunning=false;
  try{await DB.remove('meta','avatarCropUndo');}catch(err){}
  render();
  toast(`已撤回批量取景：还原 ${done} 人${failed.length?`，${failed.length} 人失败`:''}`);
}

// 下载本班头像清单模板：老师只需把照片放进 photos/、改成清单里的文件名，再连清单一起压缩
function downloadAvatarManifest(){
  const list=state.students.filter(s=>!state.currentClass||s.className===state.currentClass).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id),'zh-CN'));
  if(!list.length){toast('这个班还没有学生');return;}
  const rows=[['班级','学号','姓名','文件名']].concat(list.map((s,i)=>[s.className||'',s.sourceExamId||'',s.displayName||s.name,`photos/${String(i+1).padStart(3,'0')}_${s.displayName||s.name}.jpg`]));
  const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  downloadText(`头像清单-${state.currentClass||'全部'}-${localDate()}.csv`,csv,'text/csv;charset=utf-8');
  toast('清单已下载：照片放进 photos/ 并按“文件名”列改名，和清单一起压缩成 zip 再导入');
}

// ---------- 导出头像包（zip） ----------
// 导出的就是本机存好的那一版：已经裁成方形、压成 JPEG，不需要再处理。
// 包内图片直接用学生姓名命名（同名的补上班号/序号），另附一份清单，导回去时还能按清单对上人。
function avatarExportExt(rec){
  const type=String((rec&&rec.type)||(rec&&rec.blob&&rec.blob.type)||'image/jpeg').toLowerCase();
  if(type.includes('png'))return 'png';
  if(type.includes('webp'))return 'webp';
  if(type.includes('gif'))return 'gif';
  if(type.includes('bmp'))return 'bmp';
  return 'jpg';
}
function avatarExportBaseName(student){
  const raw=String((student&&(student.displayName||student.name))||'').trim();
  // 文件名里不能出现的字符换成“_”，其余原样（中文姓名当然保留）
  return raw.replace(/[\\/:*?"<>|\r\n]+/g,'_').trim()||'学生';
}
// 导出范围：只有本班 / 全部班级（多个班有头像时才问一句）
function avatarExportScopeChoice(){
  const withPhoto=(state.students||[]).filter(s=>s&&photoRecord(s.id));
  const classesWithPhoto=[...new Set(withPhoto.map(s=>normalizeClassName(s.className)))];
  const cls=normalizeClassName(state.currentClass||'');
  if(classesWithPhoto.length<=1)return Promise.resolve(cls&&classesWithPhoto.includes(cls)?'class':'all');
  const clsCount=withPhoto.filter(s=>normalizeClassName(s.className)===cls).length;
  return new Promise(resolve=>{
    document.getElementById('avatarExportScope')?.remove();
    const modal=document.createElement('div');
    modal.id='avatarExportScope';modal.className='modal-backdrop';
    modal.innerHTML=`<div class="modal-card avatar-menu-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>导出哪些头像？</h2><button type="button" class="icon-button modal-close" aria-label="关闭">×</button></div>\
<p class="hint">本机有 ${classesWithPhoto.length} 个班共 ${withPhoto.length} 人设置了头像。换设备时如果不想一个班导一次，选“全部班级”。</p>\
<div class="actions avatar-menu-actions">\
<button type="button" class="secondary" id="avatarScopeClass"${clsCount?'':' disabled'}>本班 ${esc(cls||'—')}（${clsCount} 张）</button>\
<button type="button" class="primary" id="avatarScopeAll">全部班级（${withPhoto.length} 张）</button>\
</div>\
<div class="actions"><button type="button" class="secondary" id="avatarScopeCancel">取消</button></div>\
</div>`;
    document.body.appendChild(modal);
    const close=value=>{modal.remove();resolve(value);};
    modal.querySelector('.modal-close').onclick=()=>close(null);
    modal.onclick=e=>{if(e.target===modal)close(null);};
    $('#avatarScopeCancel').onclick=()=>close(null);
    $('#avatarScopeAll').onclick=()=>close('all');
    const clsBtn=$('#avatarScopeClass');
    if(clsBtn)clsBtn.onclick=()=>close('class');
  });
}
async function exportAvatarPackage(){
  if(typeof JSZip==='undefined'){toast('压缩包组件还没加载好，请刷新页面重试');return;}
  const btn=$('#avatarExportBtn');
  if(btn&&btn.disabled)return;
  const scope=await avatarExportScopeChoice();
  if(!scope)return;
  const rawCls=String(state.currentClass||'').trim();
  const cls=scope==='all'?'':(rawCls?normalizeClassName(rawCls):'');
  const pool=(state.students||[]).filter(s=>s&&(!cls||s.className===cls));
  const list=pool.filter(s=>photoRecord(s.id)).sort((a,b)=>
    String(a.className||'').localeCompare(String(b.className||''),'zh-CN')||
    String(a.displayName||a.name||'').localeCompare(String(b.displayName||b.name||''),'zh-CN')||
    String(a.id||'').localeCompare(String(b.id||''),'zh-CN'));
  if(!list.length){
    toast(cls?`${cls}还没有学生头像`:'还没有任何学生头像');
    return;
  }
  if(btn)btn.disabled=true;
  toast('正在打包头像…');
  try{
    const zip=new JSZip(),used=new Set(),rows=[['班级','学号','姓名','文件名']];
    list.forEach(s=>{
      const rec=photoRecord(s.id),ext=avatarExportExt(rec),base=avatarExportBaseName(s);
      let name=`${base}.${ext}`;
      if(used.has(name))name=`${base}（${s.className||'本班'}）.${ext}`;      // 跨班同名：补班号
      for(let n=2;used.has(name);n++)name=`${base}（${s.className||'本班'}${n}）.${ext}`;   // 同班同名：再补序号
      used.add(name);
      zip.file(name,rec.blob);
      rows.push([s.className||'',s.sourceExamId||'',s.displayName||s.name||'',name]);
    });
    zip.file('清单.csv','\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n'));
    const blob=await zip.generateAsync({type:'blob'});
    downloadBlob(`学生头像-${cls||'全部'}-${localDate()}.zip`,blob);
    const missing=pool.length-list.length;
    toast(`已导出 ${list.length} 张头像，文件名就是学生姓名${missing?`；另有 ${missing} 人还没有头像`:''}`);
  }catch(err){
    toast('导出头像包失败：'+((err&&err.message)||'未知错误'));
  }finally{
    if(btn)btn.disabled=false;
  }
}
