// GA4 foreground engagement per session, not elapsed tab-open time or reading proof.
export function averageUsage(data) {
  const seconds=data?.userEngagementDuration,sessions=data?.sessions;
  return typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0&&typeof sessions==='number'&&Number.isFinite(sessions)&&sessions>0?seconds/sessions:null;
}
export function usageDuration(value) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return '—';
  if(value>0&&value<1)return '不足 1 秒';
  const seconds=Math.round(value),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return hours?`${hours} 小时 ${minutes} 分`:minutes?`${minutes} 分 ${rest} 秒`:`${rest} 秒`;
}
export const usageDefinition='每次访问的平均前台使用时长 = 谷歌记录的前台使用总时长 ÷ 会话数。切到后台的时间不计；不等于已确认的阅读时间，今日数据可能延迟。';
