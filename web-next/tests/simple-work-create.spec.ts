import {test, expect, type Page} from '@playwright/test';

// May also run against production: all account data and mutations are synthetic.
const base=process.env.CREATION_BASE_URL || 'http://127.0.0.1:3107';
const account={id:'000000000000000000000099',username:'清风',role:'reader'};
const title='山海来信';
const cover='/simple-creation-cover.svg';
async function setup(page:Page) {
  const state={created:false,uploads:0,attempts:0,fail:false,keys:[] as string[],draft:{title,description:'风越过群山，将一封信送到海边。',cover_image:cover,category:'未分类',filename:'',chapters:[] as {title:string;content:string;sourceNumber:number;volumeTitle:string;volumeNumber:number}[],revision:1}};
  await page.route('**/simple-creation-cover.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#59766f"/><path d="M0 240L85 100L180 270L240 190V320H0" fill="#c8d2be"/><text x="120" y="65" fill="#fff6df" font-size="28" text-anchor="middle">山海来信</text></svg>'}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:account,profile:account}}));
  await page.route('**/api/auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-token'}}));
  await page.route('**/api/writer/works?**',route=>route.fulfill({json:state.created ? [{...state.draft,id:'private-work',manuscriptKey:state.keys.at(-1),visibility:'private'}] : []}));
  await page.route('**/api/manuscripts',route=>route.fulfill({json:{drafts:[],remainingCharacters:100000}}));
  await page.route('**/api/upload/cover?purpose=book',async route=>{state.uploads++; await route.fulfill({json:{url:cover}});});
  await page.route('**/api/manuscripts/*',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:state.draft});
    if(route.request().method()==='DELETE') {state.created=false; return route.fulfill({json:{success:true}});}
    state.attempts++; state.keys.push(new URL(route.request().url()).pathname.split('/').at(-1)!);
    const body=JSON.parse(route.request().postData()!.split('\r\n\r\n')[1].split('\r\n--')[0]);
    expect(body.action).toBe('draft'); expect(body.chapters).toEqual(state.created ? state.draft.chapters : []); expect(body.revision).toBe(state.created ? state.draft.revision : 0);
    state.draft={...state.draft,...body,revision:body.revision+1};
    if(state.fail) {state.fail=false; return route.fulfill({status:503,json:{error:'暂时未能创建，请重试'}});}
    state.created=true; await route.fulfill({json:{status:'draft',revision:1}});
  });
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.append(s);}));
  return state;
}

for(const width of [320,390,1440]) for(const theme of ['light','dark'] as const) test(`simple creation and cover card at ${width} in ${theme}`,async({page},info)=>{
  await setup(page);
  await page.setViewportSize({width,height:844});
  await page.emulateMedia({colorScheme:theme});
  if(width<768) {
    await page.goto(base);
    await page.getByRole('button',{name:'创作',exact:true}).click();
    await page.getByRole('link',{name:/新建作品/}).click();
    await expect(page.locator('.mw-view-panel')).toHaveAttribute('data-ready','true');
  } else await page.goto(base+'/writer?action=new');
  const form=page.locator('.work-create-form');
  await expect(form.locator('input:not([type=file]),textarea')).toHaveCount(2);
  const coverBox=await form.locator('.work-create-cover').boundingBox(), copyBox=await form.locator('.work-create-copy').boundingBox();
  expect(coverBox!.x+coverBox!.width).toBeLessThan(copyBox!.x);
  if(width<768)expect((await page.locator('.mw-view-panel').boundingBox())!.height).toBeLessThanOrEqual(430);
  await expect(page.locator('.manuscript-import,.manuscript-steps')).toHaveCount(0);
  await expect(form.getByRole('button',{name:'创建',exact:true})).toBeDisabled();
  await page.getByLabel('书名',{exact:true}).fill(title);
  await expect(form.getByRole('button',{name:'创建',exact:true})).toBeDisabled();
  await page.getByLabel('简介',{exact:true}).fill('风越过群山，将一封信送到海边。');
  await page.getByLabel('上传封面（非必要）').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB2kAAAAASUVORK5CYII=','base64')});
  await expect(page.getByAltText('作品封面预览')).toBeVisible();
  await page.getByRole('button',{name:'移除封面'}).click();
  await expect(page.getByAltText('作品封面预览')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('create.png'),fullPage:width>=768});
  await form.getByRole('button',{name:'创建',exact:true}).click();
  await expect(form).toHaveCount(0);
  const card=page.locator(width<768 ? '.mw-book' : '.writer-work').filter({hasText:title});
  await expect(card).toBeVisible();
  // Supply a representative existing cover for the visual check.
  await page.route('**/api/writer/works?**',route=>route.fulfill({json:[{id:'private-work',manuscriptKey:'representative-draft-key',title,description:'风越过群山，将一封信送到海边。',cover_image:cover,visibility:'private'}]}));
  if(width<768) {
    await page.getByRole('button',{name:'返回上一页'}).click();
    await expect(page.locator('.mw-dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'创作',exact:true}).click();
  } else {await expect(page).toHaveURL(base+'/writer'); await page.reload();}
  await expect(card.locator('img')).toBeVisible();
  await expect(card.locator('summary')).toHaveText('');
  if(width<768)expect((await card.boundingBox())!.height).toBeLessThan(170);
  await card.getByLabel(`管理《${title}》`).click();
  await expect(card.getByRole('button',{name:'已为私密'})).toBeDisabled();
  await expect(card.getByRole('button',{name:'编辑作品'})).toBeVisible();
  await expect(card.getByRole('button',{name:'删除作品'})).toBeVisible();
  const menu=await card.locator('.work-management-menu').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);expect(menu!.x+menu!.width).toBeLessThanOrEqual(width);
  await card.getByLabel(`管理《${title}》`).press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(theme==='dark') await expect(width<768 ? card : page.locator('.writer-works-shell')).toHaveCSS('background-color','rgb(36, 33, 30)');
  await page.screenshot({path:info.outputPath('works.png'),fullPage:width>=768});
});

test('failed creation keeps input and cover, prevents duplicate clicks and retries the same work',async({page})=>{
  const state=await setup(page);state.fail=true;
  await page.goto(base+'/writer?action=new');
  await page.getByLabel('书名',{exact:true}).fill('😀'.repeat(16));
  await page.getByLabel('简介',{exact:true}).fill('简介');
  await expect(page.getByRole('button',{name:'创建',exact:true})).toBeDisabled();
  await page.getByLabel('书名',{exact:true}).fill(title);
  await page.getByLabel('上传封面（非必要）').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB2kAAAAASUVORK5CYII=','base64')});
  await page.locator('.work-create-form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});
  await expect(page.locator('.work-create-form').getByRole('alert')).toContainText('暂时未能创建');
  expect(state.attempts).toBe(1);expect(state.uploads).toBe(1);
  await expect(page.getByLabel('书名',{exact:true})).toHaveValue(title);
  await expect(page.getByAltText('作品封面预览')).toBeVisible();
  await page.getByRole('button',{name:'创建',exact:true}).click();
  await expect(page.locator('.writer-work')).toHaveCount(1);
  expect(state.attempts).toBe(2);expect(state.uploads).toBe(1);expect(new Set(state.keys).size).toBe(1);
  await page.getByRole('button',{name:'创作',exact:true}).click();
  await expect(page.locator('.manuscript-work-title')).toHaveText(title);
  await expect(page.getByLabel('书名',{exact:true})).toHaveCount(0);
  await expect(page.locator('.manuscript-modes button')).toHaveCount(2);
});

test('creating from a later works page returns to the new card on a short screen',async({page})=>{
  const state=await setup(page);
  await page.setViewportSize({width:320,height:568});
  await page.route('**/api/writer/works?**',route=>{
    const number=new URL(route.request().url()).searchParams.get('page');
    const books=state.created ? [{id:'created',title,visibility:'private'}] : Array.from({length:number==='2'?1:20},(_,i)=>({id:String(i),title:number==='2'?'更早的故事':`旧故事${i}`}));
    return route.fulfill({json:books});
  });
  await page.goto(base);
  await page.getByRole('button',{name:'创作',exact:true}).click();
  await page.locator('.mw-pagination').getByRole('button',{name:'下一页'}).click();
  await expect(page.locator('.mw-book')).toContainText('更早的故事');
  await page.getByRole('link',{name:/新建作品/}).click();
  await page.getByLabel('书名',{exact:true}).fill(title);
  await page.getByLabel('简介',{exact:true}).fill('第一段故事简介。');
  await page.getByRole('button',{name:'创建',exact:true}).click();
  await expect(page.locator('.mw-view')).toHaveCount(0);
  await expect(page.locator('.mw-book')).toHaveCount(1);
  await expect(page.locator('.mw-book')).toContainText(title);
  expect(await page.locator('.mw-scroll').evaluate(el=>el.scrollTop)).toBe(0);
});

for(const width of [320,390,1440]) test(`settings edit metadata while creation only edits chapters at ${width}`,async({page},info)=>{
  const state=await setup(page);state.created=true;state.keys.push('existing-manuscript-key');
  const chapters=[{title:'第一章 来信',content:'应当完整保留的正文。',sourceNumber:1,volumeTitle:'第一卷 风起',volumeNumber:1}];
  state.draft.chapters=chapters;
  await page.setViewportSize({width,height:844});
  await page.emulateMedia({colorScheme:width===390?'dark':'light'});
  await page.goto(base+(width<768?'':'/writer'));
  if(width<768)await page.getByRole('button',{name:'创作',exact:true}).click();
  const card=page.locator(width<768?'.mw-book':'.writer-work');
  await card.getByLabel(`管理《${title}》`).click();
  await card.getByRole('button',{name:'编辑作品'}).click();
  const editor=page.getByRole('dialog',{name:'编辑作品',exact:true});
  await expect(editor.locator('form')).toHaveAttribute('data-busy','false');
  await expect(editor.getByLabel('书名',{exact:true})).toHaveValue(title);
  await editor.getByLabel('书名',{exact:true}).fill('山海来信续篇');
  await editor.getByLabel('简介',{exact:true}).fill('从设置中保存的新简介。');
  await page.screenshot({path:info.outputPath('edit.png')});
  await editor.getByRole('button',{name:'保存',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await expect(card).toContainText('山海来信续篇');
  expect(state.draft.chapters).toEqual(chapters);expect(state.draft.revision).toBe(2);
  if(width<768)await card.getByRole('link',{name:'创作',exact:true}).click();
  else await card.getByRole('button',{name:'创作',exact:true}).click();
  await expect(page.locator('.manuscript-book-summary')).toContainText('山海来信续篇');
  await expect(page.getByLabel('书名',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('简介',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('上传封面（非必要）')).toHaveCount(0);
  await page.getByRole('button',{name:'调整正文',exact:true}).click();
  await expect(page.locator('.manuscript-work-title')).toHaveText('山海来信续篇');
  await expect(page.getByLabel('书名',{exact:true})).toHaveCount(0);
});
