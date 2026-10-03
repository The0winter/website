import {load} from 'cheerio';
import {safeHtml} from '../server/security.js';
import {decodeReviewEntities} from '../shared/review-quality.mjs';

export function htmlReviewText(html) {
  const $=load(html || '',{},false);
  $('script,style,noscript,iframe,form,button,input').remove();
  $('br').replaceWith('\n');
  $('p,div,h1,h2,h3,h4,li,blockquote,pre,figure').each((_,n)=>$(n).after('\n\n'));
  return $.text().replace(/\r/g,'').replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function cleanReviewText(input, url) {
  let text=String(input || '').replace(/\r/g,'');
  const removed=[];
  const replace=(pattern, replacement, rule)=>{text=text.replace(pattern, (...args)=>{removed.push({rule,text:args[0]});return typeof replacement==='function'?replacement(...args):replacement;});};
  const host=new URL(url).hostname;
  if (host==='book.douban.com') replace(/(?:^|\n)\s*<\/?(?:div|p|span)\s*$/g,'','douban-tag-fragment');
  if (host==='www.chinawriter.com.cn') {
    const start=text.indexOf('本网站有部分内容来自互联网');
    // Verified site footer: require its repeated script signature after it.
    if(start>=0&&/data\.(?:recommend|videolive|groupusers)/.test(text.slice(start))){removed.push({rule:'chinawriter-footer',text:text.slice(start)});text=text.slice(0,start);}
    replace(/^中国作家网(?:&gt;|>){2}[^\n]*正文\s*\n?/,'','chinawriter-breadcrumb');
  }
  if(host==='www.qidiantu.com'){
    replace(/❤️\s*\d+/g,'','qidiantu-votes');
    replace(/_?收录于:\d{4}-\d{2}-\d{2}(?:;更新于:\d{4}-\d{2}-\d{2})?_?/g,'','qidiantu-date');
    replace(/^(?:书籍|图书与文学)\s*\n/g,'','qidiantu-category');
  }
  if(host==='www.lkong.com')replace(/\s*[─—-]*\s*(?:来自|來自)(?:龙的天空|龍的天空)[^\n]{0,80}(?:客户端|客戶端)\s*$/,'','lkong-client-footer');
  if(host==='www.ptt.cc') {
    replace(/^作者[^\n]*\n+看板[^\n]*\n+標題[^\n]*\n+時間[^\n]*\n+/,'','ptt-header');
    const boundary=text.search(/(?:^|\n)(?:--\s*\n+)?(?:※ (?:發信站|文章網址)|◆ From:|(?:推|噓|→)\s*[A-Za-z0-9_]+\s*:)/m);
    if(boundary>=0){removed.push({rule:'ptt-footer-and-comments',text:text.slice(boundary)});text=text.slice(0,boundary).replace(/\n--\s*$/,'');}
  }
  if(host.endsWith('sohu.com')){
    replace(/返回搜狐[，,]?\s*查看更多\s*$/,'','sohu-footer');
    replace(/\s*喜欢的朋友可以关注、点赞、转发、收藏、支持[\s\S]*$/,'','sohu-promotion');
    replace(/\s*展开全文\s*/g,'\n\n','sohu-expand-button');
    replace(/\s*责任编辑[：:][^\n]*\s*$/,'','sohu-editor');
  }
  if(host==='www.aisixiang.com'){
    replace(/^进入专题：[\s\S]*?(?=读了阿城的小说)/,'','aisixiang-topic-navigation');
    const boundary=text.lastIndexOf('本文责编：');
    if(boundary>=0&&/发信站：爱思想/.test(text.slice(boundary))){removed.push({rule:'aisixiang-footer',text:text.slice(boundary)});text=text.slice(0,boundary).replace(/进入专题：[\s\S]*$/,'');}
  }
  if(host==='vocus.cc'){
    replace(/^[\s\S]*?(?=### 書名:)/,'','vocus-page-header');
    replace(/^\s*###\s?/gm,'','vocus-paragraph-markers');
    replace(/\*{4}/g,'**','vocus-bold-markers');
  }
  // Actual line-break tags were incorrectly stored as text by some imports.
  replace(/<br\s*\/?\s*>/gi,'\n','literal-line-break');
  const decoded=decodeReviewEntities(text).replace(/\u00a0/g,' ');
  if(decoded!==text)removed.push({rule:'decode-entities',text:'Decoded character entities; author text retained.'});
  text=decoded.replace(/[\t ]+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
  return {text,removed};
}

const escape = text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function inline(text){
  const links=[];
  text=text.replace(/(!?)\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g,(_,image,label,url)=>{
    const safe=new URL(url);if(!['https:','http:'].includes(safe.protocol))return label;
    const n=links.push(`<a href="${escape(safe.href)}">${escape(image?'原文配图'+(label?`：${label}`:''):label||'原文链接')}</a>`)-1;return `\uE000${n}\uE001`;
  });
  text=escape(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\uE000(\d+)\uE001/g,(_,n)=>links[Number(n)]);
  return text;
}

export function renderReviewText(text) {
  const blocks=[];let paragraph=[];
  const flush=()=>{if(paragraph.length){blocks.push('<p>'+paragraph.map(inline).join('<br />')+'</p>');paragraph=[];}};
  for(const line of String(text).split('\n')){
    if(!line.trim()){flush();continue;}
    if(/^\s*#{1,6}\s*$/.test(line)){flush();continue;}
    const heading=/^\s*#{1,6}\s+(.*)$/.exec(line),quote=/^\s*>\s?(.*)$/.exec(line);
    if(heading){flush();if(heading[1].trim())blocks.push('<h3>'+inline(heading[1])+'</h3>');}
    else if(quote){flush();blocks.push('<blockquote>'+inline(quote[1])+'</blockquote>');}
    else if(/^\s*(?:\*\s*){3,}$/.test(line)){flush();}
    else paragraph.push(line);
  }
  flush();return safeHtml(blocks.join(''));
}
