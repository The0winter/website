import {test,expect} from './fixtures/without-analytics';

const origin=process.env.SESSION_VERIFY_ORIGIN;
test.skip(!origin,'Set SESSION_VERIFY_ORIGIN to verify the deployed client without creating accounts.');
for(const width of [390,1440])test(`deployed activity reporter on ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:900});
  await context.route('**/api/traffic/observe',route=>route.abort());
  // Only the browser's auth responses are simulated; no production account or
  // database session is created. Backend session validity has separate tests.
  const user={id:'ffffffffffffffffffffffff',username:'会话验收',email:'session@example.test',role:'reader'};
  await context.route('**/api/auth/session',route=>route.fulfill({json:{user,profile:user}}));
  await context.route('**/api/auth/csrf',route=>route.fulfill({json:{csrfToken:'isolated-acceptance'}}));
  let activity=0;
  await context.route('**/api/auth/activity',route=>{
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('isolated-acceptance');
    activity++;return route.fulfill({json:{expiresAt:new Date(Date.now()+3*86400000).toISOString()}});
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin!,{waitUntil:'domcontentloaded'});
  await expect.poll(()=>activity).toBe(1);
  await page.evaluate(()=>{for(let i=0;i<1000;i++)window.dispatchEvent(new Event('scroll'));});
  expect(activity).toBe(1);
  expect(errors).toEqual([]);
});
test('deployed endpoint enforces CSRF and authentication',async({request})=>{
  const csrf=await request.get(origin+'/api/auth/csrf');expect(csrf.ok()).toBeTruthy();
  const {csrfToken}=await csrf.json();
  const denied=await request.post(origin+'/api/auth/activity',{headers:{origin:origin!,'x-csrf-token':csrfToken}});
  expect(denied.status()).toBe(401);
  const invalid=await request.post(origin+'/api/auth/activity',{headers:{origin:origin!}});
  expect(invalid.status()).toBe(403);
});
