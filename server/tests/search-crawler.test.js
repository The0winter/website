import '../../tools/test-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchCrawlerVerifier, searchCrawlerProvider, canonicalCrawlerIp} from '../services/search-crawler.js';

const ip = '192.0.2.10';
const agents = {google:'Mozilla/5.0 (compatible; Googlebot/2.1)', bing:'bingbot/2.0', baidu:'Baiduspider/2.0'};
const names = {google:'crawl-192-0-2-10.googlebot.com', bing:'msnbot-192-0-2-10.search.msn.com', baidu:'baiduspider-192-0-2-10.crawl.baidu.com'};
const dns = (name, addresses=[ip], extra={}) => ({reverse:async()=>[name],resolve4:async()=>addresses,resolve6:async()=>addresses,cancel(){},...extra});

test('Google, Bing and Baidu require matching official PTR and forward IP, with bounded cached proof', async () => {
  for (const provider of Object.keys(agents)) {
    let now=1000, reverse=0, forward=0;
    const verifier=createSearchCrawlerVerifier({clock:()=>now,positiveMs:100,staleMs:200,resolverFactory:()=>dns(names[provider],[ip],{
      reverse:async()=>{reverse++;return [names[provider].toUpperCase()+'.'];},resolve4:async()=>{forward++;return [ip];},
    })});
    assert.equal(await verifier.verify({ip,userAgent:agents[provider]}),provider);
    assert.equal(await verifier.verify({ip:'::ffff:192.0.2.10',userAgent:agents[provider]}),provider);
    assert.equal(reverse,1);assert.equal(forward,1);
    assert.equal(verifier.snapshot().verified[provider],1);
    now+=201;assert.equal(await verifier.verify({ip,userAgent:agents[provider]}),provider);assert.equal(reverse,2);
    assert.doesNotMatch(JSON.stringify(verifier.snapshot()),/192\.0|googlebot\.com|Mozilla/);
  }
});

test('normal browsers, ambiguous names and invalid addresses cannot initiate or claim verification', async () => {
  const verifier=createSearchCrawlerVerifier({resolverFactory:()=>{throw Error('Unexpected DNS');}});
  assert.equal(await verifier.verify({ip,userAgent:'Mozilla/5.0'}),null);
  assert.equal(await verifier.verify({ip,userAgent:'Googlebot Bingbot'}),null);
  assert.equal(await verifier.verify({ip:'not-an-address',userAgent:'Googlebot'}),null);
  assert.equal(verifier.snapshot().lookups,0);
  assert.equal(searchCrawlerProvider('Google-InspectionTool/1.0'),'google');
  assert.equal(searchCrawlerProvider('BingPreview/1.0'),'bing');
  assert.equal(searchCrawlerProvider('Baiduspider-render/2.0'),'baidu');
  assert.equal(canonicalCrawlerIp('2001:0DB8:0:0:0:0:0:1'),'2001:db8::1');
  assert.equal(canonicalCrawlerIp('::ffff:c000:20a'),ip);
  assert.equal(canonicalCrawlerIp('fe80::1%eth0'),null);
});

test('spoofed PTR suffixes, forward mismatches and cross-provider identity do not receive privileges', async () => {
  for (const provider of Object.keys(agents)) {
    for (const [host,addresses] of [[names[provider]+'.attacker.example',[ip]], ['fake'+names[provider].split('.').slice(-2).join('.'),[ip]], [names[provider],['192.0.2.11']]]) {
      const verifier=createSearchCrawlerVerifier({resolverFactory:()=>dns(host,addresses)});
      assert.equal(await verifier.verify({ip,userAgent:agents[provider]}),null);
      assert.equal(verifier.snapshot().rejected,1);
    }
  }
  const verifier=createSearchCrawlerVerifier({resolverFactory:()=>dns(names.google)});
  assert.equal(await verifier.verify({ip,userAgent:agents.baidu}),null);
});

test('official inspection proxy, Baidu Japan and IPv6 forward confirmation are supported', async () => {
  for (const [userAgent,host,source,answers,wanted] of [
    ['Google-InspectionTool','google-proxy-192-0-2-10.google.com',ip,[ip],'google'],
    ['Baiduspider','crawl-192-0-2-10.baidu.jp',ip,[ip],'baidu'],
    ['Googlebot','crawl-2001-db8-1.googlebot.com','2001:db8::1',['2001:0db8:0:0:0:0:0:1'],'google'],
  ]) {
    const verifier=createSearchCrawlerVerifier({resolverFactory:()=>dns(host,answers)});
    assert.equal(await verifier.verify({ip:source,userAgent}),wanted);
  }
  const untrusted=createSearchCrawlerVerifier({resolverFactory:()=>dns('customer.gae.googleusercontent.com')});
  assert.equal(await untrusted.verify({ip,userAgent:'Googlebot'}),null,'arbitrary cloud customers are not Google Search');
  const multiple=createSearchCrawlerVerifier({resolverFactory:()=>dns(names.google,[ip],{
    reverse:async()=>['old.googlebot.com',names.google],
    resolve4:async name=>{if(name==='old.googlebot.com')throw Object.assign(new Error('Gone'),{code:'ENODATA'});return [ip];},
  })});
  assert.equal(await multiple.verify({ip,userAgent:'Googlebot'}),'google','one stale PTR must not hide another valid forward-confirmed name');
});

test('negative caching, coalescing, DNS deadlines and concurrent limits keep forged requests bounded', async () => {
  let release, calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const verifier=createSearchCrawlerVerifier({maxPending:1,resolverFactory:()=>dns(names.google,[ip],{reverse:async()=>{calls++;await gate;return [names.google];}})});
  const first=verifier.verify({ip,userAgent:'Googlebot'}),second=verifier.verify({ip,userAgent:'Googlebot'});
  assert.equal(await verifier.verify({ip:'192.0.2.11',userAgent:'Googlebot'}),null);
  assert.equal(verifier.snapshot().pending,1);assert.equal(verifier.snapshot().busy,1);
  release();assert.deepEqual(await Promise.all([first,second]),['google','google']);assert.equal(calls,1);
  let canceled=0;
  const timeout=createSearchCrawlerVerifier({timeoutMs:10,resolverFactory:()=>dns(names.google,[ip],{reverse:()=>new Promise(()=>{}),cancel:()=>{canceled++;}})});
  assert.equal(await timeout.verify({ip,userAgent:'Googlebot'}),null);assert.ok(canceled>0);
  assert.equal(await timeout.verify({ip,userAgent:'Googlebot'}),null);assert.equal(timeout.snapshot().lookups,1);assert.equal(timeout.snapshot().pending,0);
});

test('transient outages preserve only previously verified identities, with a hard expiry and revocation', async () => {
  let now=1000, failure=null;
  const verifier=createSearchCrawlerVerifier({clock:()=>now,positiveMs:100,transientMs:10,staleMs:300,resolverFactory:()=>dns(names.google,[ip],{
    reverse:async()=>{if(failure)throw Object.assign(new Error('DNS failed'),{code:failure});return [names.google];},
  })});
  assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),'google');
  failure='ETIMEOUT';now+=101;
  assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),'google');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),'google');
  now+=201;assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),null,'proof cannot survive its hard expiry');
  failure=null;now+=11;assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),'google');
  failure='ENOTFOUND';now+=101;await verifier.verify({ip,userAgent:'Googlebot'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await verifier.verify({ip,userAgent:'Googlebot'}),null,'authoritative DNS removal revokes cached proof');
});

test('identity cache has a hard memory bound', async () => {
  const verifier=createSearchCrawlerVerifier({maxEntries:2,resolverFactory:()=>dns('attacker.example')});
  for(let n=1;n<=5;n++)await verifier.verify({ip:'192.0.2.'+n,userAgent:'Baiduspider'});
  assert.equal(verifier.snapshot().entries,2);assert.equal(verifier.snapshot().evictions,3);
});
