import {test, expect} from './fixtures/without-analytics';

const base = process.env.AUTH_ENTRY_BASE || 'http://127.0.0.1:3000';
const book = process.env.AUTH_ENTRY_BOOK || '000000000000000000000101';
const agents = {
  QQ: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 MQQBrowser/14.9',
  Quark: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 Quark/7.0.0.0',
  Xiaomi: 'Mozilla/5.0 (Linux; Android 13; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 MiuiBrowser/17.0.0',
};

for (const [name, userAgent] of Object.entries(agents)) {
  test.describe(name, () => {
    test.use({viewport:{width:393,height:851},isMobile:true,hasTouch:true,userAgent});
    for (const entry of ['avatar', 'shelf', 'book']) {
      test(`${entry}: cold forms work with auth route downloads blocked and survive history`, async ({page}, info) => {
        const errors:string[]=[];
        page.on('pageerror', error=>errors.push(error.message));
        await page.addInitScript(() => {
          Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}});
          localStorage.setItem('has-seen-reading-hint','true');
        });
        // A cold first tap must not need RSC or a form-specific JS download.
        await page.route(/\/(login|register)\?/, route=>route.abort());
        await page.route('**/api/auth/session', route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));
        const source=entry==='book'?`/book/${book}`:'/';
        await page.goto(base+source);
        // Development-only badge overlaps the bottom shelf button.
        await page.addStyleTag({content:'nextjs-portal { display:none; }'});
        await expect(page.locator('html')).not.toHaveAttribute('data-book-transition', /.+/);
        const trigger=entry==='avatar'?page.locator('.mobile-account-link:visible'):entry==='shelf'?page.locator('.mh-bottom [data-section="library"]'):page.getByRole('button',{name:'加入书架',exact:true}).filter({visible:true});
        if(entry!=='book') await expect(trigger).toHaveAttribute('href','/login');
        const start=Date.now();
        await trigger.click();
        await expect(page.locator('.login-card')).toBeVisible({timeout:1500});
        const entryMs=Date.now()-start;
        await expect(page.locator('.login-page')).toHaveCSS('animation-name','auth-page-enter');
        await expect(page).toHaveURL(base+'/login');
        await page.getByPlaceholder('请输入用户名').fill('测试输入保留');
        await page.getByPlaceholder('请输入密码').fill('test-password');
        await page.getByRole('button',{name:'显示密码',exact:true}).click();
        await expect(page.getByPlaceholder('请输入密码')).toHaveAttribute('type','text');
        await page.locator('.login-register a').click();
        await expect(page.locator('.register-card')).toBeVisible({timeout:1500});
        await expect(page.locator('.register-page')).toHaveCSS('animation-name','auth-page-enter');
        await page.getByLabel('用户名',{exact:true}).fill('可输入的注册页');
        await expect(page.locator('.login-card')).toHaveCount(0);
        await page.getByRole('button',{name:'返回',exact:true}).click();
        await expect(page.locator('.login-card')).toBeVisible();
        await page.goBack(); await expect(page).toHaveURL(base+source);
        await page.goForward(); await expect(page.locator('.login-card')).toBeVisible();
        await page.reload(); await expect(page.locator('.login-card')).toBeVisible();
        await page.getByRole('button',{name:'返回',exact:true}).click();
        await expect(page).toHaveURL(base+source);
        await expect(page.locator(entry==='book'?'.book-detail:visible':'.mobile-home')).toBeVisible();
        await info.attach('entry-timing',{body:JSON.stringify({entryMs}),contentType:'application/json'});
        expect(errors).toEqual([]);
      });
    }
  });
}

test('reduced motion and desktop keep the forms stationary',async({page})=>{
  await page.setViewportSize({width:393,height:851});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base+'/login');
  await expect(page.locator('.login-page')).toHaveCSS('animation-name','none');
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(page.locator('.login-page')).toHaveCSS('animation-name','none');
  await page.locator('.login-register a').click();
  await expect(page.locator('.register-page')).toHaveCSS('animation-name','none');
});
