// Calendar-only arithmetic: inputs have already been converted to the source timezone.
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function calendarPeriods(today,unit,count) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!['day','week','month'].includes(unit)||!Number.isInteger(count)||count<1||count>400)throw Error('Invalid calendar range');
  let boundary=today;
  if(unit==='week')boundary=shift(today,-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7));
  if(unit==='month')boundary=today.slice(0,7)+'-01';
  const result=[];
  for(let i=0;i<count;i++) {
    const endDate=shift(boundary,-1);
    const startDate=unit==='day'?endDate:unit==='week'?shift(boundary,-7):endDate.slice(0,7)+'-01';
    let key=startDate.replaceAll('-','');
    if(unit==='month')key=key.slice(0,6);
    if(unit==='week') {
      const thursday=shift(startDate,3),year=thursday.slice(0,4);
      key=year+String(Math.ceil(((Date.parse(thursday+'T00:00:00Z')-Date.parse(year+'-01-01T00:00:00Z'))/86400000+1)/7)).padStart(2,'0');
    }
    result.unshift({key,date:startDate,endDate,label:unit==='month'?startDate.slice(0,7):unit==='week'?`${startDate} 至 ${endDate}`:startDate});
    boundary=startDate;
  }
  return result;
}
export const trendCounts={day:90,week:26,month:12};
