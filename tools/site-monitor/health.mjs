export const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
export const percentage=(used,total)=>isNumber(used)&&isNumber(total)&&total>0?used/total*100:null;
export const capacityTone=value=>!isNumber(value)?'unknown':value>=90?'danger':value>=80?'warning':'good';
export function growth(current,previous){if(!isNumber(current)||!isNumber(previous))return null;if(previous===0)return current===0?{text:'与上期持平',direction:'flat'}:{text:'上期为 0，本期开始有数据',direction:'new'};const value=(current-previous)/previous*100;return {text:value===0?'与上期持平':`${value>0?'↑':'↓'} ${Math.abs(value).toLocaleString('zh-CN',{maximumFractionDigits:1})}%`,direction:value>0?'up':value<0?'down':'flat'};}
export function sourceState(module){if(!module?.data)return 'unknown';if(module.status==='error'||module.stale)return 'unknown';return 'good';}
export const serviceNames={'test1-api.service':'业务服务','test1-web.service':'网页服务','nginx.service':'网站入口','test1-atlas-backup.timer':'自动备份','test1-cover-cleanup.timer':'封面维护','test1-release-prune.timer':'版本清理'};

export function assessHealth(snapshot) {
  const modules=snapshot.modules||{},server=modules.server?.data,atlas=modules.atlas?.data,issues=[],checks=[],resources=[];
  const add=(level,title,detail,target='overview')=>issues.push({level,title,detail,target});
  for(const [key,label] of [['site','网站访问'],['server','服务器'],['atlas','数据库'],['r2','正文与封面存储']]) {
    const m=modules[key];
    if(sourceState(m)==='unknown')add('unknown',`${label}状态尚未确认`,m?.status==='error'?`监控暂时无法完成检查${m.data?'，旧数据仅供参考':''}。先重试；仅凭连接失败不能判断网站已崩溃。`:m?.stale?'上次结果已经过期，请刷新后再判断。':'正在等待检测结果。',key==='site'?'overview':key==='server'?'resources':'storage');
  }
  const siteFresh=sourceState(modules.site)==='good';
  for(const check of modules.site?.data?.checks||[])checks.push({...check,level:!siteFresh?'unknown':check.status==='ok'?'good':check.status==='error'?'danger':'unknown'});
  if(siteFresh)for(const c of checks.filter(c=>c.level==='danger'))add('danger',`${c.label}检测未通过`,`${c.error||'请求失败'}。读者可能无法${c.id==='home'?'打开首页':c.id==='chapter'?'读取正文':c.id==='catalog'?'打开目录':'获取书籍'}；请重试并检查对应服务。`);
  if(siteFresh&&modules.site.data.latencyMs>3000)add('warning','首页响应偏慢','这次请求超过 3 秒，可能受本机网络或服务器繁忙影响。先观察连续几次检测。');
  function resource(id,label,used,total,explanation,key='server') {
    const ratio=percentage(used,total),fresh=sourceState(modules[key])==='good';
    const tone=fresh?capacityTone(ratio):'unknown';resources.push({id,label,used,total,ratio,tone,fresh,explanation});
    if(['warning','danger'].includes(tone))add(tone,`${label}${tone==='danger'?'余量紧张':'用量偏高'}`,explanation,key==='atlas'?'storage':'resources');
  }
  resource('memory','运行内存',server?server.memory.total-server.memory.available:null,server?.memory.total,'内存不足时，系统可能终止网站进程。接近满额时应检查占用并考虑扩容。');
  resource('disk','服务器磁盘',server?server.disk.total-server.disk.available:null,server?.disk.total,'磁盘写满会影响日志、部署和备份。优先通过既有清理工具回收可再生成的文件。');
  resource('atlas','数据库容量',atlas?.cluster?.logicalBytes,snapshot.config?.atlasLimitMiB?Number(snapshot.config.atlasLimitMiB)*1024**2:null,'达到套餐上限可能影响新增用户和数据写入。接近上限时应检查数据增长或升级套餐。','atlas');
  if(sourceState(modules.atlas)==='good'&&(!snapshot.config?.atlasLimitMiB||!isNumber(atlas?.cluster?.logicalBytes)))add('unknown','数据库容量余量尚不明确',!snapshot.config?.atlasLimitMiB?'尚未填写套餐容量上限。连接正常，但暂时无法判断离上限还有多远。':'无法取得整个集群用量，不能用单个业务库大小代替套餐用量。','settings');
  if(sourceState(modules.server)==='good') {
    for(const id of ['test1-web.service','test1-api.service','nginx.service']) {
      const service=server.services?.find(s=>s.Id===id);
      if(!service)add('unknown',`${serviceNames[id]}状态未取得`,'需要重新读取服务状态，不能据此判断服务停止。','resources');
      else {
        if(service.ActiveState!=='active')add('danger',`${serviceNames[id]}没有正常运行`,'读者访问可能受影响，请检查该服务的状态和日志。','resources');
        const max=Number(service.MemoryMax),used=Number(service.MemoryCurrent);
        if(max>0&&max<1e15&&used>=0&&used<1e15){const ratio=percentage(used,max);if(ratio>=80)add(capacityTone(ratio),`${serviceNames[id]}接近自身内存限制`,'即使服务器还有空闲内存，单个服务达到限制也可能被终止。需要检查该进程的内存占用。','resources');}
      }
    }
    if(server.api?.databaseReady===false)add('danger','业务服务未连上数据库','登录、书籍列表和数据保存可能失败。','resources');
    if(!server.api)add('unknown','业务服务内部状态未取得','公网访问检查仍有效；内部数据库连接状态需要重试确认。','resources');
    const points=(modules.server.history||[]).slice(-3);
    if(isNumber(server.cpuPercent)&&server.cpuPercent>=90)add('warning',points.length===3&&points.every(p=>!p.gap&&p.cpu>=90)?'处理器持续繁忙':'处理器暂时繁忙','繁忙可能拖慢网页。观察接下来几次采样，再判断是否需要检查任务或扩容。','resources');
    if(percentage(server.disk?.inodes-server.disk?.freeInodes,server.disk?.inodes)>=90)add('warning','可创建的文件数量接近上限','即使磁盘还有空间，文件数量达到上限也会影响写入。','resources');
    const backup=server.backup,at=Date.parse(backup?.finishedAt||backup?.createdAt),age=(snapshot.now??Date.now())-at;
    if(!backup||!Number.isFinite(at))add('unknown','最近备份尚未确认','不代表网站已故障，但发生问题后的恢复保障尚不明确。','resources');
    else if(!['success','ok','completed'].includes(backup.status)||age>36*3600000)add('warning','需要检查自动备份',age>36*3600000?'超过 36 小时没有新的成功备份记录。当前网站可用也需要处理恢复保障。':'最近一次备份未报告成功，请检查备份任务。','resources');
  }
  if(sourceState(modules.r2)==='good')for(const id of ['chapters','covers']) {
    const bucket=modules.r2.data.buckets?.find(b=>b.id===id);
    if(bucket?.status!=='ok')add(bucket?.status==='error'?'danger':'unknown',`${id==='chapters'?'正文':'封面'}存储访问尚未通过`,id==='chapters'?'可能影响读取小说；结合正文抽查结果定位。':'可能影响封面显示，正文是否正常请看阅读抽查。','storage');
  }
  const order={danger:0,warning:1,unknown:2};issues.sort((a,b)=>order[a.level]-order[b.level]);
  const level=issues[0]?.level||'good';
  const title=level==='danger'?'有异常需要处理':level==='warning'?'有风险需要留意':level==='unknown'?(checks.length===4&&checks.every(c=>c.level==='good')?'访问抽查正常，部分状态待确认':'部分状态尚未确认'):'已检查的关键项目正常';
  const description=level==='good'?'首页、阅读抽查和关键资源暂未发现异常。持续关注容量余量即可。':level==='unknown'?'已取得的结果在下方展示；缺少的检测结果不会当作正常。':'下方已按优先级列出原因和建议，先处理排在前面的事项。';
  return {level,title,description,issues,checks,resources};
}
