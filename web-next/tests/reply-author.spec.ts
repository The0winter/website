import {test,expect} from './fixtures/without-analytics';
const base=process.env.REVIEW_BASE||'http://127.0.0.1:3157',book=process.env.REVIEW_BOOK||'000000000000000000000101';
const aron={_id:'000000000000000000000011',username:'Aron',avatar:'',avatarColor:'coral'};
const deleted={_id:'',username:'已注销用户',isDeleted:true,avatar:'/should-not-load-deleted-avatar.png',avatarColor:'violet'};
const date='2026-09-28T10:00:00Z';
const replies=[{_id:'reply-aron',user:aron,content:'这本书值得一读。',createdAt:date},{_id:'reply-deleted',user:deleted,content:'这条回复保留了下来。',createdAt:date}];
const rows=[
  {_id:'000000000000000000000301',rating:4,user:aron,content:'评论正文',createdAt:date,replyCount:2,replyPreview:replies[0]},
  {_id:'000000000000000000000302',rating:4,user:deleted,content:'已注销用户留下的评论',createdAt:date,replyCount:1,replyPreview:replies[1]},
  {_id:'000000000000000000000303',rating:4,user:{_id:'000000000000000000000012',username:'已注销用户',avatarColor:'teal'},content:'有效账户恰好使用这个名字',createdAt:date},
];
for(const width of [320,390,1440])test(`reply authors and neutral deleted avatars remain correct at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:null,profile:null}}));
  await page.route('**/api/books/*/reviews?*',r=>{
    const url=new URL(r.request().url()),offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('limit'));
    return r.fulfill({json:rows.slice(offset,offset+limit),headers:{'X-Total-Count':'3','X-Next-Cursor':offset+limit<3?String(offset+limit):'','X-Review-Distribution':'{"4":3}'}});
  });
  await page.route('**/api/books/*/review-reactions?*',r=>r.fulfill({json:rows.map(row=>({id:row._id,likes:0,dislikes:0,reaction:null}))}));
  await page.route('**/api/books/*/reviews/*/replies?*',r=>r.fulfill({json:{items:replies,total:2,cursor:null}}));
  await page.goto(`${base}/book/${book}`);
  await page.getByRole('button',{name:'查看全部评论',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'全部评论'});
  await expect(sheet.locator('.book-review')).toHaveCount(3);
  const author=sheet.locator('[data-reply-id="reply-aron"]');
  await expect(author.locator('.book-review-name')).toHaveText('Aron');
  await expect(author.locator('.user-avatar')).toHaveText('A');
  await expect(author.locator('.user-avatar')).toHaveAttribute('data-avatar-color','coral');
  const deletedAvatars=sheet.locator('.user-avatar[data-avatar-color="deleted"]');
  await expect(deletedAvatars).toHaveCount(2);
  for(const avatar of await deletedAvatars.all()){
    await expect(avatar).toHaveText('');await expect(avatar.locator('svg')).toHaveCount(1);await expect(avatar.locator('img')).toHaveCount(0);
    await expect(avatar).toHaveCSS('background-color','rgb(237, 237, 237)');await expect(avatar).toHaveCSS('color','rgb(146, 146, 146)');
  }
  await expect(sheet.locator('[data-review-id="000000000000000000000303"] .user-avatar')).toHaveAttribute('data-avatar-color','teal');
  await page.screenshot({path:info.outputPath(`verified-authors-${width}.png`)});
  await sheet.getByRole('button',{name:'查看 2 条回复'}).click();
  const thread=sheet.locator('.book-review-thread-list');
  await expect(thread.locator('[data-reply-id="reply-aron"] .book-review-name')).toHaveText('Aron');
  await expect(thread.locator('[data-reply-id="reply-deleted"] .user-avatar svg')).toHaveCount(1);
  await expect(thread.locator('[data-reply-id="reply-deleted"] .user-avatar')).toHaveText('');
});
