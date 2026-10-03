import {test,expect} from './fixtures/without-analytics';

const base=process.env.QA_TEST_BASE||'http://127.0.0.1:3000';
for(const width of [390,1440])test(`archived answer links load every visible answer at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const questionId='aaaaaaaaaaaaaaaaaaaaaaaa',archivedId='bbbbbbbbbbbbbbbbbbbbbbbb';
 const author={id:'cccccccccccccccccccccccc',name:'合成读者',avatar:'',bio:''};
 const reply=(id:string,archived=false)=>({id,archived,content:'<p>用于核验连续阅读的合成书评。</p>',votes:0,comments:0,time:'2026-10-03T00:00:00Z',author});
 const answers=Array.from({length:6},(_,i)=>reply(String(i+1).padStart(24,'0')));
 const post={id:questionId,type:'question',title:'合成分页问题',content:'',comments:6,votes:0,views:0,tags:[],author};
 await page.route('**/api/forum/posts/**',route=>{
  const url=new URL(route.request().url());
  if(route.request().method()!=='GET')return route.fulfill({status:204});
  if(url.pathname.endsWith('/reading'))return route.fulfill({json:{post,answer:reply(archivedId,true)}});
  if(url.pathname.endsWith('/replies')){
   const start=(Number(url.searchParams.get('page')||1)-1)*5;
   return route.fulfill({json:answers.slice(start,start+5)});
  }
  return route.continue();
 });
 await page.goto(`${base}/forum/${archivedId}?fromQuestion=${questionId}`);
 await expect(page.locator('.qa-answer')).toHaveCount(7,{timeout:25000});
 for(const answer of answers)await expect(page.locator(`[data-answer-id="${answer.id}"]`)).toBeAttached();
 await expect(page.getByText('已读完这个问题的全部回答',{exact:true})).toBeAttached();
});
