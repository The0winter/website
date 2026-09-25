import {test, expect} from './fixtures/without-analytics';

const base = process.env.DETAIL_BASE || 'http://127.0.0.1:3000';
const detail = `${base}/book/${process.env.DETAIL_BOOK || '000000000000000000000101'}`;
// These UAs select adapters, not real phone binaries. Every native OS call is
// instrumented below; book-share-real.spec.ts separately checks real engines.
const android = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const browsers = [
  {name:'Safari',ua:ios,hint:'Safari 工具栏或菜单'},
  {name:'小米',ua:`${android} XiaoMi/MiuiBrowser/20.0`,hint:'小米浏览器菜单'},
  {name:'UC',ua:`${android} UCBrowser/18.0`,hint:'UC 浏览器菜单'},
  {name:'夸克安卓',ua:`${android} Quark/8.0`,hint:'夸克浏览器菜单'},
  {name:'夸克苹果',ua:`${ios} Quark/8.0`,hint:'夸克浏览器菜单'},
  {name:'Chrome',ua:android,hint:'Chrome 菜单'},
  {name:'Edge',ua:`${android} EdgA/150.0`,hint:'Edge 菜单'},
];
type Calls = {shares:ShareData[]; active:boolean[]; copied:string[]; bridges:unknown[][]};
type TestWindow = typeof window & {browserCalls:Calls};
test.use({hasTouch:true});

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => {
    const calls:Calls = {shares:[],active:[],copied:[],bridges:[]};
    (window as TestWindow).browserCalls = calls;
    Object.defineProperty(navigator, 'share', {configurable:true,writable:true,value:(data:ShareData) => {
      calls.shares.push(data);calls.active.push(navigator.userActivation.isActive);return Promise.resolve();
    }});
    Object.defineProperty(navigator, 'canShare', {configurable:true,writable:true,value:() => true});
    Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async (text:string) => {calls.copied.push(text);}}});
  });
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/books/*/views', route => route.fulfill({json:{success:true,counted:false}}));
});

for (const browser of browsers) {
  test(`${browser.name}: native share uses the original touch gesture`, async ({page}) => {
    await page.addInitScript(ua => Object.defineProperty(navigator,'userAgent',{value:ua}),browser.ua);
    await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
    await page.getByRole('button',{name:'分享到其他应用'}).tap();
    const calls = await page.evaluate(() => (window as TestWindow).browserCalls);
    expect(calls.active).toEqual([true]);expect(calls.shares).toHaveLength(1);
    expect(calls.shares[0].url).toBe(detail);
    expect(calls.shares[0].title).toContain((await page.locator('.book-hero h1').innerText()).trim());
    expect(calls.copied).toEqual([]);
  });

  test(`${browser.name}: accepts URL-only sharing when the full payload is unsupported`, async ({page}) => {
    await page.addInitScript(ua => {
      Object.defineProperty(navigator,'userAgent',{value:ua});
      navigator.canShare=(data) => Boolean(data?.url) && !data?.title && !data?.text;
    },browser.ua);
    await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
    await page.getByRole('button',{name:'分享到其他应用'}).tap();
    expect(await page.evaluate(() => (window as TestWindow).browserCalls.shares)).toEqual([{url:detail}]);
  });

  test(`${browser.name}: absent native API keeps copy sharing and browser guidance available`, async ({page}) => {
    await page.addInitScript(ua => {
      Object.defineProperty(navigator,'userAgent',{value:ua});
      Object.defineProperty(navigator,'share',{value:undefined});
    },browser.ua);
    await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
    await expect(page.locator('.book-share-apps small')).toContainText(browser.hint);
    await page.getByRole('button',{name:'复制后分享'}).tap();
    await expect(page.locator('.book-share-message')).toContainText('书名和链接已复制');
    expect(await page.evaluate(() => (window as TestWindow).browserCalls.copied[0])).toContain(detail);
  });
}

test('Quark with UC tokens never assumes a UC bridge is supported',async({page})=>{
  await page.addInitScript(ua=>{
    Object.defineProperty(navigator,'userAgent',{value:ua});
    Object.defineProperty(navigator,'share',{value:undefined});
    Object.assign(window,{ucweb:{startRequest:(...args:unknown[])=>{(window as TestWindow).browserCalls.bridges.push(args);}}});
  },`${android} UCBrowser/18.0 Quark/8.0`);
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await expect(page.locator('.book-share-apps small')).toContainText('夸克浏览器菜单');
  await page.getByRole('button',{name:'复制后分享'}).tap();
  expect(await page.evaluate(()=>(window as TestWindow).browserCalls.bridges)).toEqual([]);
  expect(await page.evaluate(()=>(window as TestWindow).browserCalls.copied[0])).toContain(detail);
});

for (const method of ['android','ios-modern','ios-legacy']) test(`UC ${method}: browser bridge opens a chooser with this book`, async ({page}) => {
  await page.addInitScript(({ua,method}) => {
    Object.defineProperty(navigator,'userAgent',{value:ua});
    Object.defineProperty(navigator,'share',{value:undefined});
    const record = (...args:unknown[]) => {
      (window as TestWindow).browserCalls.bridges.push(args);
      (window as TestWindow).browserCalls.active.push(navigator.userActivation.isActive);
    };
    Object.assign(window,method==='android' ? {ucweb:{startRequest:record}} : {ucbrowser:method==='ios-modern' ? {web_shareEX:record} : {web_share:record}});
  },{ua:`${method==='android' ? android : ios} UCBrowser/18.0`,method});
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await expect(page.locator('.book-share-apps small')).toContainText('打开 UC 浏览器分享面板');
  await page.getByRole('button',{name:'分享到其他应用'}).tap();
  const calls = await page.evaluate(() => (window as TestWindow).browserCalls);
  expect(calls.active).toEqual([true]);expect(calls.bridges).toHaveLength(1);
  const title = `《${(await page.locator('.book-hero h1').innerText()).trim()}》 - 九天小说站`;
  if (method==='android') expect(calls.bridges[0]).toEqual(['shell.page_share',[title,title,detail,'','','九天小说站','']]);
  else if (method==='ios-modern') expect(JSON.parse(calls.bridges[0][0] as string)).toEqual({title,content:title,sourceUrl:detail,source:'九天小说站',imageUrl:''});
  else expect(calls.bridges[0]).toEqual([title,title,detail,undefined,'','九天小说站','']);
  await expect(page.locator('.book-share-message')).toContainText('若未弹出分享面板');
});

test('a native payload rejection waits for a second gesture before sharing only the link', async ({page}) => {
  await page.addInitScript(() => {
    navigator.share=data => {
      (window as TestWindow).browserCalls.shares.push(data || {});
      if (data?.text || data?.title) return Promise.reject(new TypeError('Unsupported payload'));
      (window as TestWindow).browserCalls.active.push(navigator.userActivation.isActive);
      return Promise.resolve();
    };
  });
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await page.getByRole('button',{name:'分享到其他应用'}).tap();
  await expect(page.locator('.book-share-message')).toContainText('已改用仅链接分享');
  expect(await page.evaluate(() => (window as TestWindow).browserCalls.shares.length)).toBe(1);
  await page.getByRole('button',{name:'分享到其他应用'}).tap();
  const calls=await page.evaluate(() => (window as TestWindow).browserCalls);
  expect(calls.shares[1]).toEqual({url:detail});expect(calls.active).toEqual([true]);
});

test('UC native failure switches to its bridge, and a rejected bridge retains copying', async ({page}) => {
  await page.addInitScript(ua => {
    Object.defineProperty(navigator,'userAgent',{value:ua});
    navigator.share=async () => {throw new DOMException('Denied','NotAllowedError');};
    Object.assign(window,{ucweb:{startRequest:() => false}});
  },`${android} UCBrowser/18.0`);
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await page.getByRole('button',{name:'分享到其他应用'}).tap();
  await expect(page.locator('.book-share-message')).toHaveText('已切换到 UC 浏览器分享，请再点一次');
  await page.getByRole('button',{name:'分享到其他应用'}).tap();
  await expect(page.locator('.book-share-message')).toContainText('请复制后分享');
  await page.getByRole('button',{name:'复制后分享'}).tap();
  await expect(page.locator('.book-share-message')).toContainText('书名和链接已复制');
});

test('UC-like embedded browsers do not call standalone UC bridges', async ({page}) => {
  await page.addInitScript(ua => {
    Object.defineProperty(navigator,'userAgent',{value:ua});
    Object.defineProperty(navigator,'share',{value:undefined});
    Object.assign(window,{ucweb:{startRequest:() => {throw new Error('Must not invoke UC');}}});
  },`${android} UCBrowser/18.0 MicroMessenger/8.0`);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(detail);await page.getByRole('button',{name:'分享书籍'}).tap();
  await page.getByRole('button',{name:'复制后分享'}).tap();
  await expect(page.locator('.book-share-message')).toContainText('书名和链接已复制');expect(errors).toEqual([]);
});
