import type {Chapter} from './api';
import {readerParagraphs} from '../../shared/reader-paragraphs.mjs';

export const readerColumnGap=40;
export const readerChapterTitle=(chapter:Chapter)=>chapter.title.startsWith('第')?chapter.title:`第${chapter.chapter_number}章 ${chapter.title}`;

export function fitReaderColumnHeight(body:HTMLElement,height:number){
  const glyph=body.querySelector('.reader-paragraph-text')?.getClientRects()[0];
  const lineHeight=Number.parseFloat(getComputedStyle(body).lineHeight);
  // A line box includes half-leading below its glyphs. Let that invisible
  // spacing extend beyond the text window instead of wasting a fitting line.
  const leading=glyph && Number.isFinite(lineHeight)?Math.max(0,(lineHeight-glyph.height)/2):0;
  body.style.height=`${height+leading}px`;
}

export function readerColumnLayout(body:HTMLElement){
  // clientWidth/scrollWidth round to integer CSS pixels. Reusing clientWidth
  // as the column stride accumulates a visible error on fractional viewports.
  // Animated translations introduce floating-point noise (e.g. 350 becomes
  // 349.999969). Keep layout's fractional precision without treating that as
  // a resize and cancelling a page turn during a fullscreen transition.
  const box=body.getBoundingClientRect();
  const width=Math.round(box.width*64)/64;
  // A clipped multicolumn scrollWidth can describe just the first sheet.
  // The final paragraph's fragments still locate the actual end of the text.
  // Subtract the translated body's origin so this also works after a turn.
  const fragments=body.lastElementChild?.getClientRects();
  let extent=body.scrollWidth;
  if(fragments)for(const rect of fragments)extent=Math.max(extent,rect.right-box.left);
  return {width,step:width+readerColumnGap,total:Math.max(1,Math.ceil((extent+readerColumnGap-1)/(width+readerColumnGap)))};
}

// Inert previews use the same markup/typography as the interactive chapter.
// Only textContent is used for novel text; no source HTML is interpreted.
export function fillReaderPreview(body:HTMLElement,chapter:Chapter,counts:Record<string,number>,marks:string[]){
  const fragment=document.createDocumentFragment(),title=document.createElement('h1');
  title.textContent=readerChapterTitle(chapter);fragment.append(title);
  for(const paragraph of readerParagraphs(chapter.content,chapter.title,chapter.chapter_number)){
    const row=document.createElement('p'),text=document.createElement('span');
    row.className='reader-paragraph';row.dataset.paragraphKey=paragraph.key;row.dataset.marked=String(marks.includes(paragraph.key));
    text.className='reader-paragraph-text';text.textContent=paragraph.text;row.append(text);
    if(counts[paragraph.key]){
      const bubble=document.createElement('button');bubble.className='paragraph-bubble';bubble.dataset.hot=String(counts[paragraph.key]>10);bubble.textContent=String(counts[paragraph.key]);row.append(bubble);
    }
    fragment.append(row);
  }
  body.replaceChildren(fragment);
}
