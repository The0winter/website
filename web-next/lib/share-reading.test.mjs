import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {trackShareReading,consumeShareReminder} from './share-reading.ts';
test('any reader visit prompts once per book per local calendar day',()=>{
  const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};};
  globalThis.sessionStorage=memory();globalThis.localStorage=memory();globalThis.document={visibilityState:'visible'};
  const originalNow=Date.now;let now=new Date(2026,8,28,23,59).getTime();Date.now=()=>now;
  const book='000000000000000000000101',other='000000000000000000000102',third='000000000000000000000103';
  try {
    localStorage.setItem('book-share-shown:v1',JSON.stringify({all:now,[third]:now}));
    assert.equal(consumeShareReminder(book),false);
    trackShareReading(book,true);assert.equal(consumeShareReminder(book),false);
    trackShareReading(book,false);assert.equal(consumeShareReminder(book),true);assert.equal(consumeShareReminder(book),false);
    trackShareReading(book,true);trackShareReading(book,false);assert.equal(consumeShareReminder(book),false);
    trackShareReading(other,true);trackShareReading(other,false);assert.equal(consumeShareReminder(other),true);
    trackShareReading(third,true);trackShareReading(third,false);assert.equal(consumeShareReminder(third),false);
    now=new Date(2026,8,29,0,1).getTime();
    assert.equal(consumeShareReminder(book),false,'A new day alone is not a reader visit');
    trackShareReading(book,true);trackShareReading(book,false);assert.equal(consumeShareReminder(book),true);
    trackShareReading(other,true);trackShareReading(other,false);document.visibilityState='hidden';
    assert.equal(consumeShareReminder(other),false);document.visibilityState='visible';assert.equal(consumeShareReminder(other),true);
    const stored=JSON.parse(localStorage.getItem('book-share-shown:v1'));assert(!('all' in stored));assert(!(third in stored));
  }finally{Date.now=originalNow;}
});
