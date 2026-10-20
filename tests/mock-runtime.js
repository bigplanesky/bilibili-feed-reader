/* In-page extension host for deterministic tests, backed by the actual worker. */
(() => {
  const messageListeners=[], changeListeners=[];
  let stored={};
  try { stored=JSON.parse(sessionStorage.getItem('bfr-fixture-storage')||'{}'); } catch {}
  if(new URLSearchParams(location.search).get('mode')!=='reload')stored={};
  const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const changed=changes=>{
    sessionStorage.setItem('bfr-fixture-storage',JSON.stringify(stored));
    for(const fn of changeListeners) fn(copy(changes),'local');
  };
  window.importScripts=()=>{};
  window.chrome={runtime:{
    onMessage:{addListener(fn){messageListeners.push(fn);}},
    sendMessage(message){return new Promise((resolve,reject)=>{
      if(window.fixtureFailSave&&message.type==='BFR_SET_READ'){reject(new Error('模拟：存储写入失败'));return;}
      const accepted=messageListeners[0](message,{tab:{id:1},url:'https://t.bilibili.com/'},resolve);
      if(!accepted)reject(new Error('worker did not accept message'));
    })}
  },storage:{
    onChanged:{addListener(fn){changeListeners.push(fn);},removeListener(fn){const i=changeListeners.indexOf(fn);if(i>=0)changeListeners.splice(i,1);}},
    local:{
      async get(key){await Promise.resolve();return key===null?copy(stored):{[key]:copy(stored[key])};},
      async set(values){await Promise.resolve();const changes={};for(const [key,value]of Object.entries(values)){changes[key]={oldValue:copy(stored[key]),newValue:copy(value)};stored[key]=copy(value);}changed(changes);},
      async remove(key){await Promise.resolve();const oldValue=stored[key];delete stored[key];changed({[key]:{oldValue}});}
    }
  }};
})();
