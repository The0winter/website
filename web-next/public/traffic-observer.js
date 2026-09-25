// First-party observation only. No input contents, full URLs, account IDs or IPs.
export function installTrafficObserver(win=window) {
  const doc=win.document;
  let current=null,csrf=null,closed=false,checking=false,lastPath='',paused=false,opening=Promise.resolve(),queued=0;
  const clock=()=>win.performance.now();
  const uuid=()=>win.crypto.randomUUID();
  async function send(data,keepalive=false,retry=true) {
    if(paused)return null;
    try {
      if(!csrf){const response=await win.fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store',signal:win.AbortSignal.timeout(5000)});if(!response.ok)return null;csrf=(await response.json()).csrfToken;}
      const response=await win.fetch('/api/traffic/observe',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify(data),keepalive,signal:win.AbortSignal.timeout(5000)});
      if(response.status===204){paused=true;return null;}
      if(response.status===403){csrf=null;if(retry&&!keepalive)return send(data,false,false);}
      if(response.status===409)return {expired:true};
      if(!response.ok)return null;
      return await response.json();
    }catch{return null;}
  }
  function accrue(page){const now=clock();if(page.visible)page.visibleMs+=Math.max(0,now-page.lastClock);page.lastClock=now;page.visible=doc.visibilityState==='visible';}
  function checkpoint(page,complete=false,keepalive=false) {
    if(!page)return;
    accrue(page);
    const data={kind:'update',id:page.id,visibleMs:Math.floor(page.visibleMs),interactions:page.interactions,interactionSpan:Math.floor(page.lastInteraction-page.firstInteraction),complete};
    if(page.token)void send({...data,token:page.token},keepalive).then(result=>{if(result?.expired&&current===page){current=null;lastPath='';navigate();}});
    else {page.finalUpdate=data;if(!page.openPending&&current===page&&doc.visibilityState==='visible'){current=null;lastPath='';navigate();}}
  }
  function navigate() {
    if(closed||paused||doc.visibilityState!=='visible')return;
    const pathname=win.location.pathname;
    if(pathname===lastPath&&current)return;
    if(queued>=64){paused=true;return;}
    checkpoint(current,true,true);lastPath=pathname;
    const chapter=/^\/book\/[a-f0-9]{24}\/([a-f0-9]{24})$/.exec(pathname);
    const page={id:uuid(),type:chapter?'chapter':'page',target:chapter?.[1],token:null,openPending:true,visibleMs:0,lastClock:clock(),visible:true,interactions:0,firstInteraction:0,lastInteraction:0,finalUpdate:null};
    current=page;
    queued++;
    opening=opening.then(()=>send({kind:'open',id:page.id,type:page.type,...(page.target?{target:page.target}:{})})).then(result=>{
      queued--;
      page.token=result?.token;
      page.openPending=false;
      if(page.token&&page.finalUpdate)void send({...page.finalUpdate,token:page.token},true);
    });
  }
  function schedule(){if(checking)return;checking=true;win.queueMicrotask(()=>{checking=false;navigate();});}
  function visibility(){checkpoint(current,doc.visibilityState!=='visible',true);if(doc.visibilityState==='visible')navigate();}
  function interaction(event) {
    if(!current||!event.isTrusted||doc.visibilityState!=='visible'||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(event.type==='keydown'&&!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp',' '].includes(event.key))return;
    // Only reading/navigation gestures, never arbitrary text or form input.
    if(event.type==='pointerup'&&!event.target?.closest?.('.reader-pages-root,.reader-scroll-root'))return;
    const now=clock();if(current.interactions&&now-current.lastInteraction<1000)return;
    if(!current.interactions)current.firstInteraction=now;
    current.lastInteraction=now;current.interactions++;
  }
  const onHide=()=>{checkpoint(current,true,true);if(current)current.visible=false;};
  const onShow=event=>{if(event.persisted){lastPath='';navigate();}};
  doc.addEventListener('visibilitychange',visibility);win.addEventListener('pagehide',onHide);win.addEventListener('pageshow',onShow);win.addEventListener('popstate',schedule);
  const gestureTypes=['wheel','touchmove','pointerup','keydown'];for(const type of gestureTypes)doc.addEventListener(type,interaction,{passive:true,capture:true});
  // Detect rendered SPA / reader chapter transitions, including replaceState; ignore query strings.
  const observer=new win.MutationObserver(schedule);observer.observe(doc.body,{childList:true,subtree:true});
  const timer=win.setInterval(()=>{navigate();if(doc.visibilityState==='visible')checkpoint(current);},10000);
  navigate();
  return ()=>{closed=true;checkpoint(current,true,true);observer.disconnect();win.clearInterval(timer);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',onHide);win.removeEventListener('pageshow',onShow);win.removeEventListener('popstate',schedule);for(const type of gestureTypes)doc.removeEventListener(type,interaction,true);};
}
if(typeof window!=='undefined'&&!window.__shiyeTrafficObserver)window.__shiyeTrafficObserver=installTrafficObserver();
