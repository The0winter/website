import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';
import type {Chapter} from './api';
import type {ReadingAnchor,ReadingPosition} from './reading-progress';

export function utf16Offset(text:string,offset:number){const value=Math.max(0,Math.min(text.length,Math.floor(offset)));return value>0&&value<text.length&&/[\uDC00-\uDFFF]/.test(text[value])&&/[\uD800-\uDBFF]/.test(text[value-1])?value-1:value;}
export function resolveReadingAnchor(chapter:Chapter,anchor:ReadingAnchor|null):ReadingAnchor|null {
  const paragraphs=readerParagraphs(chapter.content,chapter.title,chapter.chapter_number);if(!paragraphs.length)return null;
  const found=paragraphs.findIndex(p=>p.key===anchor?.paragraphKey),index=found>=0?found:Math.max(0,Math.min(paragraphs.length-1,anchor?.paragraphIndex??0));
  return {paragraphKey:paragraphs[index].key,paragraphIndex:index,charOffset:found>=0?utf16Offset(paragraphs[index].text,anchor?.charOffset??0):0};
}
export function readingPosition(chapter:Chapter,anchor:ReadingAnchor):ReadingPosition{return {...anchor,chapterId:chapter.id,chapterNumber:chapter.chapter_number,contentVersion:chapter.contentVersion??null};}
const textRows=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph-key]'));
function glyph(node:Text,offset:number){
  const range=document.createRange(),start=utf16Offset(node.data,offset),end=Math.min(node.length,start+(node.data.codePointAt(start)!>0xffff?2:1));
  range.setStart(node,start);range.setEnd(node,end);return range.getClientRects()[0]??range.getBoundingClientRect();
}
export function anchorRectangle(root:HTMLElement,anchor:ReadingAnchor){
  const rows=textRows(root),row=rows.find(p=>p.dataset.paragraphKey===anchor.paragraphKey)??rows[anchor.paragraphIndex];
  const node=row?.querySelector('.reader-paragraph-text')?.firstChild;
  return node?.nodeType===Node.TEXT_NODE?glyph(node as Text,Math.min(anchor.charOffset,Math.max(0,(node.textContent?.length??1)-1))):null;
}
/** DOM Range glyph geometry yields UTF-16 offsets, including mid-paragraph column boundaries.
 * DOM order and monotone column/line coordinates allow logarithmic search in long paragraphs. */
export function firstVisibleAnchor(root:HTMLElement,viewport:HTMLElement):ReadingAnchor|null {
  const box=viewport.getBoundingClientRect(),rows=textRows(root);
  const scrolling=root.hasAttribute('data-scroll-chapter');
  const intersects=(r:DOMRect)=>r.right>box.left+.5&&r.left<box.right-.5&&r.bottom>box.top+.5&&r.top<box.bottom-.5;
  for(let index=0;index<rows.length;index++){
    const row=rows[index],span=row.querySelector('.reader-paragraph-text'),node=span?.firstChild;
    if(!span||node?.nodeType!==Node.TEXT_NODE||!Array.from(span.getClientRects()).some(intersects))continue;
    const text=node as Text;
    let low=0,high=text.length;
    while(low<high){const mid=Math.floor((low+high)/2),r=glyph(text,mid);
      // Collapsed line-ending spaces can sit exactly on the right edge. Their
      // vertical position still precedes the viewport; treating them as a later
      // column makes the binary search discard a perfectly visible paragraph.
      const before=scrolling?r.bottom<=box.top+.5:r.right<=box.left+.5||(r.left<=box.right+.5&&r.bottom<=box.top+.5);
      if(before)low=mid+1;else high=mid;
    }
    let offset=utf16Offset(text.data,low);
    while(offset<text.length){const rect=glyph(text,offset);if(rect.width>0&&intersects(rect))return {paragraphKey:row.dataset.paragraphKey!,paragraphIndex:index,charOffset:offset};
      if(rect.top>=box.bottom||rect.left>box.right+.5)break;
      offset+=text.data.codePointAt(offset)!>0xffff?2:1;
    }
  }
  return null;
}
