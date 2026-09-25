// Exact segment/rectangle intersection, with clearance for strokes and point markers.
export function crossesBox(a,b,box,padding=6) {
  let enter=0,leave=1;
  for(const [axis,size] of [['x','width'],['y','height']]) {
    const low=box[axis]-padding,high=box[axis]+box[size]+padding,delta=b[axis]-a[axis];
    if(!delta){if(a[axis]<low||a[axis]>high)return false;continue;}
    const first=(low-a[axis])/delta,last=(high-a[axis])/delta;
    enter=Math.max(enter,Math.min(first,last));leave=Math.min(leave,Math.max(first,last));
    if(enter>leave)return false;
  }
  return true;
}

export function placeTooltip({anchor,plot,width,height,viewport,segments}) {
  const clampX=x=>Math.max(8,Math.min(viewport.width-width-8,x));
  const clampY=y=>Math.max(8,Math.min(viewport.height-height-8,y));
  const xs=[anchor.x+14,anchor.x-width-14,plot.x+2,plot.x+plot.width-width-2,8,viewport.width-width-8];
  const ys=[anchor.y-height-14,anchor.y+14,plot.y+2,plot.y+plot.height-height-2,plot.y-height-12,plot.y+plot.height+12,8,viewport.height-height-8];
  const candidates=xs.flatMap(x=>ys.map(y=>({x:clampX(x),y:clampY(y),width,height})));
  const clear=box=>!crossesBox(anchor,anchor,box,10)&&segments.every(([a,b])=>!crossesBox(a,b,box));
  const zone=box=>box.x>=plot.x&&box.x+width<=plot.x+plot.width&&box.y>=plot.y&&box.y+height<=plot.y+plot.height?0:box.y+height<=plot.y||box.y>=plot.y+plot.height?1:2;
  const score=box=>zone(box)*80+Math.hypot(box.x+width/2-anchor.x,box.y+height/2-anchor.y);
  candidates.sort((a,b)=>score(a)-score(b));
  for(const box of candidates)if(clear(box))return box;
  for(let y=8;y+height<=viewport.height-8;y+=16)for(let x=8;x+width<=viewport.width-8;x+=16){const box={x,y,width,height};if(clear(box))return box;}
  // Even in an exceptionally short viewport, never place the box over a curve.
  return {x:clampX(anchor.x-width/2),y:plot.y-height-12,width,height};
}
