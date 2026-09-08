import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';

const base='http://127.0.0.1:3000';
test('category and author pages reach works beyond the first database page',async({page})=>{
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  async function write(path:string,data:object,headers:Record<string,string>={}) {
    const csrf=await (await page.request.get(base+'/api/auth/csrf')).json();
    return page.request.post(base+path,{data,headers:{origin:base,'x-csrf-token':csrf.csrfToken,...headers}});
  }
  expect((await write('/api/auth/signin',{email:'reader@example.test',password:'Local-test-12345'})).status()).toBe(200);
  const prefix='分页验证'+crypto.randomUUID().slice(0,8);
  const ids:string[]=[];
  try {
    for(let i=0;i<25;i++) {
      const response=await write('/api/books',{title:`${prefix}-${i}`,category:'科幻',description:'受控分页测试'},{'Idempotency-Key':crypto.randomUUID()});
      expect(response.status()).toBe(201);ids.push((await response.json()).id);
    }
    await page.goto(base);
    const category=page.locator('.category-section');
    await category.getByRole('button',{name:'科幻',exact:true}).click();
    await expect(category.locator('h4')).toHaveCount(20);
    await category.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(category.locator('h4')).toHaveCount(5);
    await category.getByRole('button',{name:'上一页',exact:true}).click();
    await expect(category.locator('h4')).toHaveCount(20);
    await page.goto(base+'/author/000000000000000000000001');
    await expect(page.getByText('All Works (26)',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(page.getByText('第 2 页',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
    await expect(page.getByText('隔离测试：山海行记',{exact:true})).toBeVisible();
  } finally {
    for(const id of ids){const csrf=await (await page.request.get(base+'/api/auth/csrf')).json();expect((await page.request.delete(base+'/api/books/'+id,{headers:{origin:base,'x-csrf-token':csrf.csrfToken}})).status()).toBe(200);}
  }
});
