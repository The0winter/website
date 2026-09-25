const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>valid(value)?value.toLocaleString('zh-CN'):'未取得';
const views=new Map();

export function mountTrend(root,points,series,key) {
  if(!root)return ()=>{};
  if(!points.length){root.innerHTML='<div class="chart-empty">尚无可用趋势数据</div>';return ()=>{};}
  const identity=key+':'+points[0].date+':'+points.at(-1).date;
  const view=views.get(identity)||{start:0,count:points.length,index:null};
  views.set(identity,view);if(views.size>12)views.delete(views.keys().next().value);
  const min=Math.min(3,points.length),height=260,left=48,right=18,top=20,bottom=32;
  let width=600,svg,tooltip,activeLine,resize;
  const visible=()=>points.slice(view.start,view.start+view.count);
  const x=i=>left+i/Math.max(1,view.count-1)*(width-left-right);
  function show(index) {
    view.index=Math.max(0,Math.min(view.count-1,index));
    const point=visible()[view.index];
    tooltip.innerHTML=`<strong>${escape(point.label||point.date)}</strong>${series.map(s=>`<div><span><i style="background:${s.color}"></i>${escape(s.label)}</span><b>${number(point[s.key])}${valid(point[s.key])?' 人':''}</b></div>`).join('')}`;
    tooltip.hidden=false;
    const target=x(view.index)/width*svg.getBoundingClientRect().width;
    tooltip.style.left=Math.max(0,Math.min(root.clientWidth-tooltip.offsetWidth,target+12))+'px';
    activeLine.setAttribute('x1',x(view.index));activeLine.setAttribute('x2',x(view.index));activeLine.removeAttribute('hidden');
  }
  function zoom(factor,anchor=.5) {
    const count=Math.max(min,Math.min(points.length,Math.round(view.count*factor)));
    if(count===view.count)return false;
    view.start=Math.max(0,Math.min(points.length-count,Math.round(view.start+(view.count-count)*anchor)));
    view.count=count;view.index=null;draw();return true;
  }
  function draw() {
    const focused=root.contains(document.activeElement)?document.activeElement.dataset.control:null;
    const expanded=root.querySelector('details')?.open||false;
    width=Math.max(280,root.clientWidth);const data=visible();
    const max=Math.max(4,Math.ceil(Math.max(0,...data.flatMap(p=>series.map(s=>valid(p[s.key])?p[s.key]:0)))/4)*4);
    const y=v=>top+(1-v/max)*(height-top-bottom);
    let markup=`<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="用户变化趋势" tabindex="0" data-control="plot"><title>用户变化趋势。左右方向键查看读数，加减键缩放。</title>`;
    for(let i=0;i<=4;i++){const value=max*i/4;markup+=`<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#e3ebe7" stroke-dasharray="3 5"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${number(value)}</text>`;}
    for(const s of series){let gap=true,path='';for(const [i,p]of data.entries()){if(!valid(p[s.key])){gap=true;continue;}path+=`${gap?'M':'L'}${x(i)},${y(p[s.key])} `;gap=false;}
      markup+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
      for(const [i,p]of data.entries())if(valid(p[s.key]))markup+=`<circle cx="${x(i)}" cy="${y(p[s.key])}" r="${data.length>35?2:3}" fill="${s.color}"/>`;
    }
    for(const i of [...new Set([0,Math.floor((data.length-1)/2),data.length-1])])markup+=`<text x="${x(i)}" y="${height-6}" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}">${escape(key.includes('month')?data[i].date.slice(0,7):data[i].date.slice(5))}</text>`;
    markup+=`<line class="trend-cursor" hidden x1="0" x2="0" y1="${top}" y2="${height-bottom}" stroke="#6e897c" stroke-dasharray="4 3"/></svg>`;
    root.dataset.visiblePoints=String(view.count);root.dataset.totalPoints=String(points.length);
    root.innerHTML=`<div class="legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${escape(s.label)}</span>`).join('')}<span>单位：人</span></div><div class="trend-plot">${markup}<div class="trend-tooltip" role="status" hidden></div></div>
      <div class="trend-controls"><span class="trend-range">${escape(data[0].date)} — ${escape(data.at(-1).endDate||data.at(-1).date)}</span><div class="actions"><button class="btn small" data-control="out" aria-label="缩小趋势图" ${view.count===points.length?'disabled':''}>−</button><button class="btn small" data-control="in" aria-label="放大趋势图" ${view.count===min?'disabled':''}>＋</button><button class="btn small" data-control="reset" ${view.count===points.length?'disabled':''}>显示全部</button></div></div>
      ${view.count<points.length?`<label class="trend-pan">移动时间窗口<input type="range" data-control="pan" aria-label="移动时间窗口" min="0" max="${points.length-view.count}" value="${view.start}"></label>`:''}
      <details class="chart-data" data-detail="用户变化趋势数字" ${expanded?'open':''}><summary>查看趋势数字</summary><div class="table-wrap"><table><thead><tr><th>时间</th>${series.map(s=>`<th>${escape(s.label)}</th>`).join('')}</tr></thead><tbody>${data.map(p=>`<tr><td>${escape(p.label||p.date)}</td>${series.map(s=>`<td>${number(p[s.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    svg=root.querySelector('svg');tooltip=root.querySelector('.trend-tooltip');activeLine=root.querySelector('.trend-cursor');
    if(focused)root.querySelector(`[data-control="${focused}"]`)?.focus({preventScroll:true});
    if(view.index!==null)show(view.index);
  }
  const pointer=event=>{if(!event.target.closest('svg'))return;const box=svg.getBoundingClientRect();show(Math.round(((event.clientX-box.left)/box.width*width-left)/(width-left-right)*Math.max(1,view.count-1)));};
  const wheel=event=>{if(!event.target.closest('svg'))return;const box=svg.getBoundingClientRect();const anchor=Math.max(0,Math.min(1,((event.clientX-box.left)/box.width*width-left)/(width-left-right)));if(zoom(event.deltaY<0?.75:1.35,anchor))event.preventDefault();};
  const click=event=>{const action=event.target.closest('[data-control]')?.dataset.control;if(action==='in')zoom(.65);if(action==='out')zoom(1.6);if(action==='reset'){view.start=0;view.count=points.length;view.index=null;draw();}};
  const input=event=>{if(event.target.dataset.control==='pan'){view.start=Number(event.target.value);view.index=null;draw();}};
  const keydown=event=>{if(event.target!==svg)return;if(['ArrowLeft','ArrowRight','Home','End','+','=','-','Escape'].includes(event.key))event.preventDefault();if(event.key==='ArrowLeft')show((view.index??1)-1);if(event.key==='ArrowRight')show((view.index??-1)+1);if(event.key==='Home')show(0);if(event.key==='End')show(view.count-1);if(['+','='].includes(event.key))zoom(.65);if(event.key==='-')zoom(1.6);if(event.key==='Escape')hide();};
  function hide(){view.index=null;tooltip.hidden=true;activeLine.setAttribute('hidden','');}
  root.addEventListener('pointermove',pointer);root.addEventListener('pointerdown',pointer);root.addEventListener('pointerleave',hide);root.addEventListener('wheel',wheel,{passive:false});root.addEventListener('click',click);root.addEventListener('change',input);root.addEventListener('keydown',keydown);
  draw();resize=new ResizeObserver(()=>{if(Math.abs(width-Math.max(280,root.clientWidth))>1)draw();});resize.observe(root);
  return ()=>{resize.disconnect();root.removeEventListener('pointermove',pointer);root.removeEventListener('pointerdown',pointer);root.removeEventListener('pointerleave',hide);root.removeEventListener('wheel',wheel);root.removeEventListener('click',click);root.removeEventListener('change',input);root.removeEventListener('keydown',keydown);};
}
