import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import crypto from 'node:crypto';
export const transferLimit=30*1024*1024;
export const transferStoredLimit=60*1024*1024;
const heading=/^(?:第[零〇一二三四五六七八九十百千万两\d]{1,12}[章回节卷部集]|chapter\s+\d{1,6}(?:\s|[：:、.．]|$))/i;
export function prepareTransfer(input, filename, normalized=false) {
  const bytes=Buffer.from(input);
  if(typeof filename!=='string'||!filename.toLowerCase().endsWith('.txt')||filename.length>200||/[\x00-\x1f\\/:]/.test(filename))throw Error('请选择 TXT 文件');
  if(!bytes.length||bytes.length>(normalized?transferStoredLimit:transferLimit))throw Error('文件须为 30 MB 以内的非空 TXT');
  let text;
  const encodings=bytes[0]===255&&bytes[1]===254?['utf-16le']:bytes[0]===254&&bytes[1]===255?['utf-16be']:['utf-8','gb18030'];
  for(const encoding of encodings){try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);break;}catch{}}
  if(!text||!text.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(text))throw Error('文件不是可读取的纯文本，请另存为 UTF-8 TXT 后上传');
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(Buffer.byteLength(text)>transferStoredLimit)throw Error('转换后的文本过大');
  const chapters=[];
  let title='正文', body=[];
  const flush=()=>{
    const content=body.join('\n');body=[];
    if(!content.trim())return;
    // Preserve every character; split very long sections without truncation.
    for(let start=0,part=1;start<content.length;part++){
      let end=Math.min(content.length,start+180000);
      if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]))end--;
      chapters.push({title:(part===1?title:`${title}（${part}）`).slice(0,100),content:content.slice(start,end),chapter_number:chapters.length+1});
      start=end;
      if(chapters.length>20000)throw Error('章节数量过多');
    }
  };
  for(const line of text.split('\n')){
    const label=line.trim();
    if(label.length<=100&&heading.test(label)){flush();title=label;}
    // Keep headings in the body too: ambiguous headings never discard text.
    body.push(line);
  }
  flush();
  return {text,chapters,characters:text.length,sha256:crypto.createHash('sha256').update(text).digest('hex')};
}
export function parseTransfer(bytes, filename, normalized=false, range=null) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{bytes,filename,normalized,range},resourceLimits:{maxOldGenerationSizeMb:384},execArgv:[]});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('文本处理超时，请拆分后提交'));},15000);
    worker.once('message',result=>{clearTimeout(timer);worker.terminate();result.error?reject(Object.assign(Error(result.error),{status:400})):resolve(result);});
    worker.once('error',()=>{clearTimeout(timer);reject(Object.assign(Error('文本处理失败'),{status:400}));});
    worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Object.assign(Error('文本处理失败'),{status:400}));});
  });
}
if(!isMainThread){try{
  const result=prepareTransfer(workerData.bytes,workerData.filename,workerData.normalized);
  result.chapterCount=result.chapters.length;
  if(workerData.range==='metadata')delete result.chapters;
  else if(Number.isSafeInteger(workerData.range)){result.chapters=result.chapters.slice(workerData.range,workerData.range+20);delete result.text;}
  parentPort.postMessage(result);
}catch(e){parentPort.postMessage({error:e.message});}}
