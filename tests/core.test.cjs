const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const C = require(path.join(root, 'core.js'));
const now = Date.now(), today = Math.floor(now / 1000), ID = '1234567890123456789';
test('large IDs preserve every digit', () => assert.equal(C.id(ID), ID));
test('unsafe numeric IDs are rejected, not silently rounded', () => assert.equal(C.id(Number(ID)), null));
test('malformed IDs and resource URLs are rejected', () => { for (const x of ['', 'BV1234', '../12345', {}, -5, '012345']) assert.equal(C.id(x), null); });
test('epoch seconds and milliseconds normalize identically', () => assert.equal(C.timestamp(today * 1000), today));
test('unknown/invalid times stay unknown', () => { for (const x of [undefined, null, '', 'bad', -1, Infinity, today + 172800]) assert.equal(C.timestamp(x), null); });
test('first-run settings are 30 days, show read posts', () => assert.deepEqual(C.settings(), { days: 30, hideRead: false }));
test('settings validate types and supported ranges', () => assert.deepEqual(C.settings({days:'7',hideRead:'yes'}), C.DEFAULTS));
test('corrupt or null stored settings restore safe defaults', () => {for(const x of [null,42,'bad'])assert.deepEqual(C.settings(x),C.DEFAULTS);});
test('old is a visibility reason, not a read state', () => assert.equal(C.reason({id:ID,publishedAt:today-31*86400}, C.settings(), false, false, now), 'old'));
test('exact 30-day boundary is included', () => assert.equal(C.reason({id:ID,publishedAt:today-30*86400}, C.settings(), false, false, today*1000), null));
test('one second past cutoff is hidden', () => assert.equal(C.reason({id:ID,publishedAt:today-30*86400-1}, C.settings(), false, false, today*1000), 'old'));
test('all-time range permits unknown times', () => assert.equal(C.reason({id:ID,publishedAt:null}, {days:0,hideRead:true}, true, false, now), 'read'));
test('unknown ID always remains visible', () => assert.equal(C.reason({id:null,publishedAt:today}, {days:30,hideRead:true}, true, false, now), null));
test('unknown publication time stays visible in a date-filtered feed', () => assert.equal(C.reason({id:ID,publishedAt:null}, {days:30,hideRead:true}, true, false, now), null));
test('session newly-read exemption prevents disappearing comments', () => assert.equal(C.reason({id:ID,publishedAt:today}, {days:30,hideRead:true}, true, true, now), null));
test('next session or explicit reapply hides read post', () => assert.equal(C.reason({id:ID,publishedAt:today}, {days:30,hideRead:true}, true, false, now), 'read'));
test('old pinned post alone does not end pagination', () => assert.equal(C.pastBoundary([{id:ID,publishedAt:today-40*86400,pinned:true}],30,now), false));
test('mixed recent and old batch does not end pagination', () => assert.equal(C.pastBoundary([{id:ID,publishedAt:today-40*86400},{id:'123456',publishedAt:today}],30,now), false));
test('unknown post in appended batch prevents claiming a time boundary', () => assert.equal(C.pastBoundary([{id:ID,publishedAt:today-40*86400},{id:null,publishedAt:null}],30,now), false));
test('fully dated ordinary old batch establishes boundary', () => assert.equal(C.pastBoundary([{id:ID,publishedAt:today-40*86400}],30,now), true));
test('all-time range has no date boundary', () => assert.equal(C.pastBoundary([{id:ID,publishedAt:today-40*86400}],0,now), false));
test('video URLs accept protocol-relative links and query parameters',()=>{
  for(const url of ['//www.bilibili.com/video/BV1xx411c7mD/','https://www.bilibili.com/video/av170001?p=2'])assert.equal(C.isContentUrl(url),true);
});
test('dynamic detail and opus URLs are eligible read actions',()=>{
  for(const url of ['https://t.bilibili.com/1260807973567987717?from=feed','https://www.bilibili.com/opus/1260807973567987717','https://www.bilibili.com/read/cv170001'])assert.equal(C.isContentUrl(url),true);
});
test('profile, topic, shop, and unrelated websites do not imply read',()=>{
  for(const url of ['https://space.bilibili.com/123456','https://search.bilibili.com/all?keyword=test','https://www.bilibili.com/h5/mall/digital-card/home','https://example.com/video/BV1xx411c7mD/'])assert.equal(C.isContentUrl(url),false);
});
test('malformed and lookalike content URLs are rejected',()=>{
  for(const url of ['#video','javascript:alert(1)','https://www.bilibili.com.evil.test/video/BV1xx411c7mD/','https://t.bilibili.com/','https://www.bilibili.com/video/'])assert.equal(C.isContentUrl(url),false);
});

function backend() {
  const data = {}, listeners = [];
  const delay = () => new Promise(r => setTimeout(r, 2));
  const context = vm.createContext({ BFRCore:C, importScripts:()=>{}, URL, Date, Promise, chrome:{
    storage:{local:{
      async get(key) { await delay(); if(key === null) return structuredClone(data); return {[key]:structuredClone(data[key])}; },
      async set(values) { await delay(); Object.assign(data,structuredClone(values)); },
      async remove(key) { await delay(); delete data[key]; }
    }}, runtime:{onMessage:{addListener(fn){listeners.push(fn);}}}
  }});
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  function send(message, url='https://t.bilibili.com/', tab={id:1}) {
    return new Promise(resolve => { if(!listeners[0](message,{url,tab},resolve)) resolve({rejected:true}); });
  }
  return {send,data};
}
test('concurrent writes from different tabs preserve distinct IDs', async () => {
  const b=backend();
  await Promise.all(Array.from({length:40},(_,i)=>b.send({type:'BFR_SET_READ',id:String(100000+i),read:true,publishedAt:today},'https://t.bilibili.com/',{id:i})));
  const state=await b.send({type:'BFR_GET_STATE'});
  assert.equal(Object.keys(state.records).length,40);
});
test('same-ID writes obey received order and unread removes persistent record',async()=>{
  const b=backend();
  await Promise.all([b.send({type:'BFR_SET_READ',id:ID,read:true}),b.send({type:'BFR_SET_READ',id:ID,read:false})]);
  assert.equal((await b.send({type:'BFR_GET_STATE'})).records[ID],undefined);
});
test('concurrent settings patches do not overwrite each other',async()=>{
  const b=backend();
  await Promise.all([b.send({type:'BFR_SET_SETTINGS',patch:{hideRead:true}}),b.send({type:'BFR_SET_SETTINGS',patch:{days:7}})]);
  const result=await b.send({type:'BFR_GET_STATE'});
  assert.equal(result.settings.hideRead,true); assert.equal(result.settings.days,7);
});
test('rejected message does not poison the worker queue',async()=>{
  const b=backend();
  assert.equal((await b.send({type:'BFR_SET_READ',id:'bad',read:true})).ok,false);
  assert.equal((await b.send({type:'BFR_SET_READ',id:ID,read:true})).ok,true);
});
test('worker refuses messages from other sites or non-tab senders',async()=>{
  const b=backend();
  assert.equal((await b.send({type:'BFR_GET_STATE'},'https://example.com/')).rejected,true);
  assert.equal((await b.send({type:'BFR_GET_STATE'},'https://t.bilibili.com/',null)).rejected,true);
});
test('state survives a new page context and discards corrupt records',async()=>{
  const b=backend();
  await b.send({type:'BFR_SET_READ',id:ID,read:true});
  b.data['bfr.read.123456']={readAt:'broken'};
  const state=await b.send({type:'BFR_GET_STATE'},'https://t.bilibili.com/',{id:2});
  assert.ok(state.records[ID]); assert.equal(Object.keys(state.records).length,1);
});
test('manifest restricts extension access to dynamic site and storage',()=>{
  const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  assert.equal(m.manifest_version,3); assert.deepEqual(m.permissions,['storage']); assert.equal(m.host_permissions,undefined);
  for (const s of m.content_scripts) assert.deepEqual(s.matches,['https://t.bilibili.com/*']);
  for (const f of [m.background.service_worker,...m.content_scripts.flatMap(x=>[...(x.js||[]),...(x.css||[])])]) assert.ok(fs.existsSync(path.join(root,f)));
});
