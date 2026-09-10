import test from 'node:test';
import assert from 'node:assert/strict';
import {bookPrefetchPolicy, shouldPrefetchBook, observeBookVisibility} from './book-prefetch.ts';

test('visible cards prefetch, offscreen cards wait, and background/offline tabs never prefetch',()=>{
  const active={hidden:false,online:true};
  for(const effectiveType of [undefined,'3g','4g']){
    const policy=bookPrefetchPolicy({...active,effectiveType});
    assert.equal(shouldPrefetchBook(policy,true,false),true);
    assert.equal(shouldPrefetchBook(policy,false,false),false);
  }
  for(const state of [{hidden:true,online:true},{hidden:false,online:false}]){
    for(const visible of [true,false])for(const intent of [true,false]){
      assert.equal(shouldPrefetchBook(bookPrefetchPolicy(state),visible,intent),false);
    }
  }
});

test('data-saving and very slow networks require deliberate interest instead of speculative downloads',()=>{
  for(const network of [{saveData:true},{effectiveType:'2g'},{effectiveType:'slow-2g'}]){
    const policy=bookPrefetchPolicy({hidden:false,online:true,...network});
    assert.equal(shouldPrefetchBook(policy,true,false),false);
    assert.equal(shouldPrefetchBook(policy,true,true),true);
  }
});

test('visibility uses one viewport observer, ignores zero-area intersections and releases unmounted cards',()=>{
  const original=globalThis.IntersectionObserver;
  const observers=[],unobserved=[];
  globalThis.IntersectionObserver=class {
    constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}
    observe(){}
    unobserve(target){unobserved.push(target);}
    disconnect(){this.disconnected=true;}
  };
  const first={},second={},states=[];
  try{
    const stopFirst=observeBookVisibility(first,visible=>states.push(['first',visible]));
    const stopSecond=observeBookVisibility(second,visible=>states.push(['second',visible]));
    assert.equal(observers.length,1);
    assert.equal(observers[0].options.rootMargin,'0px');
    const entry=(target,isIntersecting,width,height)=>({target,isIntersecting,intersectionRect:{width,height}});
    observers[0].callback([entry(first,true,100,50),entry(second,true,0,50),entry(first,false,0,0)]);
    assert.deepEqual(states,[['first',true],['second',false],['first',false]]);
    stopFirst();observers[0].callback([entry(first,true,100,50)]);
    assert.equal(states.length,3);assert.equal(observers[0].disconnected,undefined);
    stopSecond();assert.equal(observers[0].disconnected,true);
    assert.deepEqual(unobserved,[first,second]);
    const stopAgain=observeBookVisibility(first,()=>{});
    assert.equal(observers.length,2);stopAgain();
  }finally{globalThis.IntersectionObserver=original;}
});
