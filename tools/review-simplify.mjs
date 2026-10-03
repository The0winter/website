import OpenCC from './novel-crawler/node_modules/opencc-js/dist/esm/t2cn.js';
import {Parser} from 'htmlparser2';
import {safeHtml} from '../server/security.js';

// tw2s folds character variants without the regional vocabulary substitutions
// in tw2sp. Conversion runs locally, using the crawler's pinned dictionaries.
const convert = OpenCC.Converter({from:'tw',to:'cn'});
export function simplifyReviewText(text) {
  // Mixed-script reviews already use simplified 么. In traditional-only input
  // it can denote 幺; preserve existing 么 so repeated cleanup never changes
  // questions such as “用么？” into “用幺？”. 麼/麽 still convert normally.
  let marker='\uE000';while(text.includes(marker))marker+='\uE000';
  const protectedText=[];
  const protect=value=>{const token=marker+protectedText.length+marker;protectedText.push({token,value});return token;};
  const masked=text.replace(/https?:\/\/[^\s<>"'）)\]】》「」『』，。；！？]+/g,protect).replace(/么/g,()=>protect('么'));
  let result=convert(masked);
  for(const {token,value}of protectedText)result=result.replaceAll(token,value);
  return result;
}
const block = new Set(['p','div','h1','h2','h3','h4','h5','h6','li','blockquote','pre','ul','ol','table','tr','td','th','br','hr']);
const escape = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function simplifyReviewHtml(html) {
  if (safeHtml(html)!==html) throw Error('Convert only previously sanitized review HTML');
  const replacements=[]; let group=[];
  function flush() {
    if(!group.length)return;
    const before=group.map(row=>row.text).join(''), after=simplifyReviewText(before);
    if(after!==before){
      const chars=Array.from(after);
      if(chars.length!==Array.from(before).length)throw Error('Character conversion changed text length; review this paragraph before upload');
      let offset=0;
      for(const row of group){const count=Array.from(row.text).length,value=chars.slice(offset,offset+count).join('');offset+=count;if(value!==row.text)replacements.push({...row,value:escape(value)});}
    }
    group=[];
  }
  const parser=new Parser({
    onopentag(name){if(block.has(name))flush();},
    onclosetag(name){if(block.has(name))flush();},
    ontext(text){group.push({text,start:parser.startIndex,end:parser.endIndex+1});},
    onend:flush,
  },{decodeEntities:true});
  parser.end(html);
  let result=html;
  for(const row of replacements.reverse())result=result.slice(0,row.start)+row.value+result.slice(row.end);
  result=safeHtml(result);
  if(JSON.stringify(result.match(/<[^>]*>/g))!==JSON.stringify(html.match(/<[^>]*>/g)))throw Error('Character conversion must preserve all markup and link attributes');
  return result;
}
