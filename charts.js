// 图表：难度饼图与成绩趋势图



// Final statistics/data renderers: keep the difficulty chart in its own view
// and expose the template download from the data screen.

// 难度饼图：图注直接画在画布里，外部不再放文字。
// 排布尽量紧凑：宽屏图注在圆环右侧，窄屏排在圆环下方；画布尺寸随容器宽度自适应。
function drawDifficultyPie(counts){
  const canvas=$('#difficultyChart');
  if(!canvas)return;
  const host=canvas.parentElement;
  const hostW=host&&host.clientWidth?host.clientWidth:280;
  const cssW=Math.max(240,Math.min(520,Math.round(hostW)));
  const sideLegend=cssW>=340;                       // 有横向空间就把图注放右边
  const cssH=sideLegend?Math.max(150,Math.min(200,Math.round(cssW*0.42))):208;
  const dpr=Math.max(1,window.devicePixelRatio||1);
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  canvas.style.width=cssW+'px';
  canvas.style.height=cssH+'px';
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  const total=counts.reduce((sum,n)=>sum+n,0),colors=['#2f80ed','#f2c94c','#eb5757'],labels=['简单','适中','困难'];
  // 圆环尽量占满可用高度，四周只留很小余量
  const pad=8;
  const r=Math.max(30,Math.min(sideLegend?cssH/2-pad:cssH*0.36,cssW*(sideLegend?0.20:0.28)));
  const cx=sideLegend?Math.round(pad+r):Math.round(cssW/2);
  const cy=sideLegend?Math.round(cssH/2):Math.round(pad+r);
  if(!total){
    ctx.fillStyle='#6b7c78';ctx.font='14px sans-serif';ctx.textAlign='center';
    ctx.fillText('暂无点名数据',cssW/2,cssH/2);
    return;
  }
  let start=-Math.PI/2;
  counts.forEach((count,i)=>{
    const angle=count/total*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,start+angle);ctx.closePath();
    ctx.fillStyle=colors[i];ctx.fill();
    start+=angle;
  });
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.arc(cx,cy,r*.54,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#16302b';ctx.font='bold 15px sans-serif';ctx.textAlign='center';
  ctx.fillText(total+'次',cx,cy+5);
  // ---- 图注 ----
  const dot=8;
  ctx.textAlign='left';
  if(sideLegend){
    const gapY=20,lx=cx+r+14;
    let ly=Math.round(cy-((labels.length-1)*gapY)/2);
    labels.forEach((_,i)=>{
      ctx.fillStyle=colors[i];
      ctx.beginPath();ctx.arc(lx+dot/2,ly-4,dot/2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#16302b';ctx.font='13px sans-serif';
      ctx.fillText(labels[i]+'：'+counts[i]+'次',lx+dot+5,ly);
      ly+=gapY;
    });
  }else{
    // 手机：圆环下方一行图注，整体居中，尽量贴近圆环
    const pillH=24,gapX=6,padX=7,textW=44;
    const pillW=Math.min(Math.floor((cssW-16-gapX*2)/3),padX*2+dot+5+textW);
    const totalW=pillW*3+gapX*2;
    let x=Math.round((cssW-totalW)/2);
    const y=cssH-pillH/2-4;
    labels.forEach((_,i)=>{
      ctx.fillStyle='#f5f7f6';
      ctx.beginPath();
      if(ctx.roundRect)ctx.roundRect(x,y-pillH/2,pillW,pillH,pillH/2);else ctx.rect(x,y-pillH/2,pillW,pillH);
      ctx.fill();
      ctx.fillStyle=colors[i];
      ctx.beginPath();ctx.arc(x+padX+dot/2,y,dot/2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#16302b';ctx.font='12px sans-serif';
      ctx.fillText(labels[i]+'：'+counts[i]+'次',x+padX+dot+5,y+4);
      x+=pillW+gapX;
    });
  }
}

// fitWidth：把整张图缩放到指定宽度内（一屏看全，不横向滚动）
// mode='rate' 画得分率（0–100% 固定纵轴，跨满分可比）；mode='raw' 画绝对分（旧口径）
// 年段均分只统计"有成绩"的学生：导入时缺考/空成绩会存成 0，所以这里用 >0 排除缺考的人与其分数
function renderScoreCanvas(canvas,records,large=false,name='',fitWidth=0,mode='rate'){
  if(!canvas||!records.length)return;
  const asRate=String(mode)!=='raw';
  const dpr=Math.max(1,window.devicePixelRatio||1);
  let width,height;
  if(fitWidth){width=Math.max(240,Math.round(fitWidth));height=Math.round(width*.72);}
  else{height=large?420:300;const step=large?78:58;width=Math.max(large?560:430,records.length===1?430:64+(records.length-1)*step);}
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    const p={left:52,right:28,top:36,bottom:48},plotW=width-p.left-p.right,plotH=height-p.top-p.bottom;
    const rawScores=records.map(x=>Number(x.result&&x.result.score)||0);
    const scores=records.map((x,i)=>asRate?examScoreRate(x.exam,x.result)*100:rawScores[i]);
    const avgs=records.map(x=>{
      const rates=state.examResults.filter(r=>r.examId===x.exam.id)
        .map(r=>({score:Number(r.result&&r.result.score),examId:x.exam.id}))
        .filter(o=>Number.isFinite(o.score)&&o.score>0);            // >0 = 排除缺考
      if(!rates.length)return null;
      if(asRate){
        const found=state.exams.find(e=>e.id===x.exam.id)||x.exam;
        return rates.reduce((sum,o)=>sum+(examScoreRate(found,{score:o.score})||0),0)/rates.length*100;
      }
      return rates.reduce((sum,o)=>sum+o.score,0)/rates.length;
    });
    // 得分率：纵轴固定 0–100%；绝对分：0 到"最高分/均分"向上取整
    let top=100;
    if(!asRate){
      const peak=Math.max(100,...rawScores,...avgs.filter(v=>Number.isFinite(v)));
      top=Math.ceil(peak/10)*10;
    }
    const x=i=>p.left+(records.length===1?plotW/2:i*plotW/(records.length-1)),y=v=>p.top+plotH-(Math.max(0,Math.min(top,v))/top)*plotH,fmt=v=>asRate?`${Math.round(v)}%`:(Number.isInteger(v)?String(v):v.toFixed(1));
    const plotVal=asRate?v=>v===null?null:Math.round(v*10)/10:v=>v;
    
  ctx.font='12px sans-serif';ctx.textAlign='right';ctx.fillStyle='#6b7c78';ctx.strokeStyle='#dfe9e6';for(let i=0;i<=4;i++){const value=top*i/4,yy=y(value);ctx.beginPath();ctx.moveTo(p.left,yy);ctx.lineTo(width-p.right,yy);ctx.stroke();ctx.fillText(fmt(value),p.left-8,yy+4);}
  const label=(value,xx,ly,color)=>{ctx.font='12px sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(fmt(value),xx,Math.max(18,Math.min(height-28,ly)));};
  const line=(values,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();let started=false;values.forEach((v,i)=>{if(v===null||v===undefined){started=false;return;}const xx=x(i),yy=y(v);started?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);started=true;});ctx.stroke();values.forEach((v,i)=>{if(v===null||v===undefined)return;const xx=x(i),yy=y(v);ctx.fillStyle=color;ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();});};
  line(avgs.map(plotVal),'#16302b');line(scores,'#b42318');
  // Label order follows the actual values: the higher score is drawn above the lower score.
  records.forEach((_,i)=>{if(avgs[i]===null||!Number.isFinite(scores[i]))return;const xx=x(i),avgY=y(avgs[i]),scoreY=y(scores[i]),close=Math.abs(avgY-scoreY)<42;
    if(scores[i]>=avgs[i]){
      label(scores[i],xx,scoreY-(close?25:14),'#b42318');
      label(avgs[i],xx,avgY+(close?25:18),'#16302b');
    }else{
      label(avgs[i],xx,avgY-(close?25:14),'#16302b');
      label(scores[i],xx,scoreY+(close?25:18),'#b42318');
    }
  });
  const legendA=asRate?'年段得分率均分':'年段均分',legendB=asRate?'个人得分率':'个人得分';
  ctx.font='bold 12px sans-serif';ctx.textAlign='left';ctx.fillStyle='#16302b';ctx.fillText(legendA,p.left,18);ctx.fillStyle='#b42318';ctx.fillText(legendB,p.left+108,18);
  if(name){ctx.textAlign='right';ctx.font='bold 13px sans-serif';ctx.fillStyle='#16302b';ctx.fillText(String(name),width-p.right,18);}
  ctx.font='11px sans-serif';ctx.fillStyle='#6b7c78';records.forEach((r,i)=>{ctx.textAlign='center';ctx.fillText(String(r.exam.date||''),x(i),height-17);});
}

// 记住当前详情页学生的名字，供“整图”与“预览”两处画进图里
let lastScoreChartName='';
// 纵轴口径：'rate' 得分率（0–100%，跨满分可比）| 'raw' 绝对分
function scoreChartMode(){return String(state.scoreChartMode||'rate');}

function drawScoreChart(student,records){
  lastScoreChartName=student?String(student.displayName||student.name||''):'';
  const el=$('#scoreChart');
  renderScoreCanvas(el,records,false,lastScoreChartName,0,scoreChartMode());
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
    renderScoreCanvas($('#scoreChartLarge'),records,true,name||lastScoreChartName,0,scoreChartMode());
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
  renderScoreCanvas($('#scoreChartPreview'),records,false,name||lastScoreChartName,wrap.clientWidth,scoreChartMode());
  $('#downloadScorePreview').onclick=()=>{const link=document.createElement('a');link.download='成绩趋势图-预览.png';link.href=$('#scoreChartPreview').toDataURL('image/png');link.click();};
  $('#openFullChartBtn').onclick=()=>{close();openScoreChart(records,name);};
}
