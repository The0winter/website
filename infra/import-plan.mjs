// Pure validation: no connection or credentials needed.
export function prepareImport(book) {
  if(!book||!Array.isArray(book.chapters)||!book.chapters.length)throw Error('书籍必须包含章节');
  const validUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&value.length<=2000;}catch{return false;}};
  if(!validUrl(book.sourceUrl)||typeof book.title!=='string'||!book.title.trim()||book.title.length>200)throw Error('书名或来源网址无效');
  if(book.author!==undefined&&(typeof book.author!=='string'||!book.author.trim()||book.author.length>200))throw Error('作者名无效');
  if(book.authorSourceUrl!==undefined&&!validUrl(book.authorSourceUrl))throw Error('作者来源网址无效');
  for(const [key,max] of [['description',5000],['category',80]])if(book[key]!==undefined&&(typeof book[key]!=='string'||book[key].length>max))throw Error(`${key} 无效`);
  if(book.status!==undefined&&!['连载','完结'].includes(book.status))throw Error('status 必须是连载或完结');
  if(book.cover_image!==undefined&&book.cover_image!==''&&!validUrl(book.cover_image))throw Error('封面必须是 HTTP(S) 网址');
  const seen=new Set();
  const chapters=book.chapters.map((c,i)=>{
    const n=c?.chapter_number??c?.chapterNumber;
    if(!Number.isSafeInteger(n)||n<1||seen.has(n))throw Error(`第 ${i+1} 项章号无效或重复`);
    seen.add(n);
    if(typeof c.title!=='string'||!c.title.trim()||c.title.length>100||typeof c.content!=='string'||!c.content.trim()||c.content.length>60000)throw Error(`第 ${n} 章标题或正文无效（正文最多60000字符）`);
    const link=c.link??c.sourceUrl;
    if(link!==undefined&&!validUrl(link))throw Error(`第 ${n} 章链接无效`);
    return {title:c.title.trim(),content:c.content,chapter_number:n,...(link===undefined?{}:{link})};
  }).sort((a,b)=>a.chapter_number-b.chapter_number);
  const metadata=Object.fromEntries(['sourceUrl','title','author','authorSourceUrl','category','description','cover_image','status'].filter(k=>book[k]!==undefined).map(k=>[k,book[k]]));
  const batches=[];
  for(let i=0;i<chapters.length;i+=20)batches.push({...metadata,chapters:chapters.slice(i,i+20)});
  return batches;
}
