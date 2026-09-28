import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {trackShareReading,consumeShareReminder,installShareReading,shareReadingThreshold} from './share-reading.ts';
test('share reminder counts only visible reading, crosses chapters and respects daily/book cooldowns',()=>{
  const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};};
  globalThis.sessionStorage=memory();globalThis.localStorage=memory();
  globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});globalThis.window=new EventTarget();
  const originalNow=Date.now;let now=Date.parse('2026-09-28T12:00:00Z');Date.now=()=>now;
  const book='000000000000000000000101',other='000000000000000000000102';
  const stop=installShareReading();
  try {
    trackShareReading(book,true);now+=15*60000;trackShareReading(book,true);
    document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));now+=shareReadingThreshold;
    trackShareReading(book,false);document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(consumeShareReminder(book),false);
    trackShareReading(book,true);now+=15*60000;assert.equal(consumeShareReminder(book),false);
    trackShareReading(book,false);assert.equal(consumeShareReminder(other),false);assert.equal(consumeShareReminder(book),true);assert.equal(consumeShareReminder(book),false);
    trackShareReading(other,true);now+=shareReadingThreshold;trackShareReading(other,false);assert.equal(consumeShareReminder(other),false);
    now+=24*60*60*1000;assert.equal(consumeShareReminder(other),true);
    trackShareReading(book,true);now+=shareReadingThreshold;trackShareReading(book,false);assert.equal(consumeShareReminder(book),false);
    now+=7*24*60*60*1000;assert.equal(consumeShareReminder(book),true);
  }finally{stop();Date.now=originalNow;}
});
