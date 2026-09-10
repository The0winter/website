import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberChapter,lastReadChapter,serverLastReadChapter,subscribeReadingSession} from './reading-session.ts';

test('resume records only the visited book, updates readers and bounds session memory to twenty books',()=>{
  let updates=0;
  const stop=subscribeReadingSession(()=>updates++);
  assert.equal(serverLastReadChapter(),null);
  assert.equal(lastReadChapter('unread'),null);
  rememberChapter('one','chapter-1');
  rememberChapter('one','chapter-1');
  rememberChapter('two','chapter-9');
  assert.equal(updates,2);
  rememberChapter('one','chapter-2');
  assert.equal(lastReadChapter('one'),'chapter-2');
  assert.equal(lastReadChapter('two'),'chapter-9');
  assert.equal(lastReadChapter('unread'),null);
  for(let i=0;i<19;i++)rememberChapter(`extra-${i}`,`chapter-${i}`);
  assert.equal(lastReadChapter('two'),null);
  assert.equal(lastReadChapter('one'),'chapter-2');
  rememberChapter('last','chapter-last');
  assert.equal(lastReadChapter('one'),null);
  assert.equal(lastReadChapter('last'),'chapter-last');
  stop();
  const before=updates;
  rememberChapter('last','chapter-final');
  assert.equal(updates,before);
});
