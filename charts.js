// 图表：难度饼图与成绩趋势图



// Final statistics/data renderers: keep the difficulty chart in its own view
// and expose the template download from the data screen.

function drawDifficultyPie(counts){
  const canvas=$('#difficultyChart');
    if(!canvas)return;
    const cssSize=260,dpr=Math.max(1,window.devicePixelRatio||1);
    canvas.width=cssSize*dpr;
    canvas.height=cssSize*dpr;
    canvas.style.width=`${cssSize}px`;
    canvas.style.height=`${cssSize}px`;
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssSize,cssSize);
    const cx=cssSize/2,cy=cssSize/2,r=cssSize*.37,total=counts.reduce((sum,n)=>sum+n,0),colors=['#2f80ed','#f2c94c','#eb5757'];
    if(!total){ctx.fillStyle='#6b7c78';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('暂无点名数据',cx,cy);return;}let start=-Math.PI/2;
    counts.forEach((count,i)=>{const angle=count/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,start+angle);ctx.closePath();ctx.fillStyle=colors[i];ctx.fill();start+=angle;});
    ctx.fillStyle='#fff';
    ctx.beginPath();
    ctx.arc(cx,cy,r*.52,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='#16302b';
    ctx.font='bold 16px sans-serif';
    ctx.textAlign='center';
    ctx.fillText(`${total}次`,cx,cy+5);
    }

// fitWidth：把整张图缩放到指定宽度内（一屏看全，不横向滚动）
function renderScoreCanvas(canvas,records,large=false,name='',fitWidth=0){
  if(!canvas||!records.length)return;
  const dpr=Math.max(1,window.devicePixelRatio||1);
  let width,height;
  if(fitWidth){width=Math.max(240,Math.round(fitWidth));height=Math.round(width*.72);}
  else{height=large?420:300;const step=large?78:58;width=Math.max(large?560:430,records.length===1?430:64+(records.length-1)*step);}
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    const p={left:52,right:28,top:36,bottom:48},scores=records.map(x=>Number(x.result.score)||0),avgs=records.map(x=>{const vals=state.examResults.filter(r=>r.examId===x.exam.id).map(r=>Number(r.result?.score)).filter(Number.isFinite);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;}),max=Math.max(100,...scores,...avgs),plotW=width-p.left-p.right,plotH=height-p.top-p.bottom,x=i=>p.left+(records.length===1?plotW/2:i*plotW/(records.length-1)),y=v=>p.top+plotH-(v/max)*plotH,fmt=v=>Number.isInteger(v)?String(v):v.toFixed(1);
    
  ctx.font='12px sans-serif';ctx.textAlign='right';ctx.fillStyle='#6b7c78';ctx.strokeStyle='#dfe9e6';for(let i=0;i<=4;i++){const value=max*i/4,yy=y(value);ctx.beginPath();ctx.moveTo(p.left,yy);ctx.lineTo(width-p.right,yy);ctx.stroke();ctx.fillText(fmt(value),p.left-8,yy+4);}
  const label=(value,xx,ly,color)=>{ctx.font='12px sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(fmt(value),xx,Math.max(18,Math.min(height-28,ly)));};
  const line=(values,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();values.forEach((v,i)=>{i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v));});ctx.stroke();values.forEach((v,i)=>{const xx=x(i),yy=y(v);ctx.fillStyle=color;ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();});};
  line(avgs,'#16302b');line(scores,'#b42318');
  // Label order follows the actual values: the higher score is drawn above the lower score.
  records.forEach((_,i)=>{const xx=x(i),avgY=y(avgs[i]),scoreY=y(scores[i]),close=Math.abs(avgY-scoreY)<42;
    if(scores[i]>=avgs[i]){
      label(scores[i],xx,scoreY-(close?25:14),'#b42318');
      label(avgs[i],xx,avgY+(close?25:18),'#16302b');
    }else{
      label(avgs[i],xx,avgY-(close?25:14),'#16302b');
      label(scores[i],xx,scoreY+(close?25:18),'#b42318');
    }
  });
  ctx.font='bold 12px sans-serif';ctx.textAlign='left';ctx.fillStyle='#16302b';ctx.fillText('班级均分',p.left,18);ctx.fillStyle='#b42318';ctx.fillText('个人得分',p.left+78,18);
  if(name){ctx.textAlign='right';ctx.font='bold 13px sans-serif';ctx.fillStyle='#16302b';ctx.fillText(String(name),width-p.right,18);}
  ctx.font='11px sans-serif';ctx.fillStyle='#6b7c78';records.forEach((r,i)=>{ctx.textAlign='center';ctx.fillText(String(r.exam.date||''),x(i),height-17);});
}

// 记住当前详情页学生的名字，供“整图”与“预览”两处画进图里
let lastScoreChartName='';

function drawScoreChart(student,records){
  lastScoreChartName=student?String(student.displayName||student.name||''):'';
  const el=$('#scoreChart');
  renderScoreCanvas(el,records,false,lastScoreChartName);
  // 点图表 = 整图预览（一屏看全）；下方“查看高清图”仍是高清可横向滑动
  if(el)el.onclick=()=>openScorePreview(records,lastScoreChartName);
}

// 高清原图：宽度按数据点数量展开，可左右滑动
function openScoreChart(records,name){
  const old=$('#chartModal');
    old?.remove();
    const modal=document.createElement('div');
    modal.id='chartModal';
    modal.className='modal-backdrop';
    modal.innerHTML='<div class="modal-card chart-modal-card" role="dialog" aria-modal="true"><div class="modal-header"><h2>成绩趋势图</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div><div class="chart-large-wrap"><canvas id="scoreChartLarge"></canvas></div><div class="actions"><button class="primary" id="downloadScoreChart">下载图片</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick=()=>modal.remove();
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    renderScoreCanvas($('#scoreChartLarge'),records,true,name||lastScoreChartName);
    $('#downloadScoreChart').onclick=()=>{const link=document.createElement('a');link.download='成绩趋势图.png';link.href=$('#scoreChartLarge').toDataURL('image/png');link.click();};
    
}

// 整图预览：缩放到弹窗宽度内，一屏看完整张图，不横向滚动
function openScorePreview(records,name){
  if(!records||!records.length){toast('暂无成绩数据');return;}
  $('#chartPreviewModal')?.remove();
  const modal=document.createElement('div');
  modal.id='chartPreviewModal';
  modal.className='modal-backdrop';
  modal.innerHTML='<div class="modal-card chart-preview-card" role="dialog" aria-modal="true"><div class="modal-header"><h2>成绩趋势预览</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div><div class="chart-preview-wrap"><canvas id="scoreChartPreview"></canvas></div><div class="actions"><button class="primary" id="downloadScorePreview">下载图片</button><button class="secondary" id="openFullChartBtn">查看高清图</button></div></div>';
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  const wrap=modal.querySelector('.chart-preview-wrap');
  renderScoreCanvas($('#scoreChartPreview'),records,false,name||lastScoreChartName,wrap.clientWidth);
  $('#downloadScorePreview').onclick=()=>{const link=document.createElement('a');link.download='成绩趋势图-预览.png';link.href=$('#scoreChartPreview').toDataURL('image/png');link.click();};
  $('#openFullChartBtn').onclick=()=>{close();openScoreChart(records,name);};
}
