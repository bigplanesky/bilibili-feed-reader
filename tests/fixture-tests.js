(async()=>{
  const results=document.getElementById('results'),summary=document.getElementById('summary'),badge=document.getElementById('test-status');
  let pass=0,fail=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,ms=3500)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(40);}throw new Error('等待条件超时');};
  const assert=(x,msg)=>{if(!x)throw new Error(msg||'断言失败');};
  const record=async id=>(await chrome.runtime.sendMessage({type:'BFR_GET_STATE'})).records[id];
  const set=async patch=>{await chrome.runtime.sendMessage({type:'BFR_SET_SETTINGS',patch});await sleep(300);};
  const apply=()=>document.querySelector('.bfr-apply').click();
  const card=id=>[...document.querySelectorAll('.bili-dyn-item')].find(el=>el.getAttribute('dyn-id')===id||el.__vue__?.data?.id_str===id);
  const visible=el=>el&&!el.closest('.bfr-hidden');
  const test=async(name,fn)=>{try{await fn();pass++;const div=document.createElement('div');div.className='pass';div.textContent='PASS '+name;results.append(div);}catch(e){fail++;const div=document.createElement('div');div.className='fail';div.textContent='FAIL '+name+': '+e.message;results.append(div);}badge.textContent=`浏览器测试：${pass} 通过 / ${fail} 失败`;};
  await wait(()=>document.querySelector('.bfr-marker'));
  if(new URLSearchParams(location.search).get('mode')==='reload'){
    await test('刷新后已读记录和筛选设置仍保留',async()=>{
      assert(await record('1234567890123456789'));
      assert(document.querySelector('.bfr-hide').checked);
      assert(!visible(card('1234567890123456789')));
      assert(visible(card('1234567890123456790')));
    });
    summary.textContent=`刷新验收：${pass} 通过，${fail} 失败`;badge.textContent='刷新测试结束';document.body.dataset.testDone='true';return;
  }
  await test('初始六条动态只装饰一次，默认最近30天、不隐藏已读',()=>{
    assert(document.querySelectorAll('.bfr-marker').length===6);
    assert(document.querySelector('#bfr-days').value==='30');assert(!document.querySelector('.bfr-hide').checked);
  });
  await test('点赞、转发不标记已读',async()=>{
    const el=card('1234567890123456790');el.querySelector('.like').click();el.querySelector('.forward').click();await sleep(200);assert(!await record('1234567890123456790'));
  });
  await test('固定高度作者栏不插入按钮，独立状态行不与正文重叠',()=>{
    for(const el of document.querySelectorAll('.bili-dyn-item')){
      const header=el.querySelector('.bili-dyn-item__header'),tools=el.querySelector('.bfr-card-tools'),body=el.querySelector('.bili-dyn-item__body');
      assert(!header.querySelector('.bfr-marker'),'作者栏被插入按钮');
      assert(tools.parentElement===header.parentElement);
      assert(header.getBoundingClientRect().bottom<=tools.getBoundingClientRect().top+1);
      assert(tools.getBoundingClientRect().bottom<=body.getBoundingClientRect().top+1);
    }
  });
  const tempTest=async(id,fn,options={})=>{
    const el=F.card(id,options);await wait(()=>el.querySelector('.bfr-marker'));
    try{await fn(el);}finally{el.parentElement.remove();await sleep(180);}
  };
  await test('普通点击视频链接保存当前动态已读，保留原始跳转',()=>tempTest('180001',async el=>{
    let bubbled=false;el.querySelector('a').addEventListener('click',()=>bubbled=true);el.querySelector('a').click();
    await wait(()=>el.dataset.bfrStatus==='read');assert(await record('180001'));assert(bubbled);
  },{type:'video'}));
  await test('Ctrl点击和鼠标中键打开视频均标记已读',async()=>{
    await tempTest('180002',async el=>{el.querySelector('a').dispatchEvent(new MouseEvent('click',{button:0,ctrlKey:true,bubbles:true,cancelable:true}));await wait(()=>el.dataset.bfrStatus==='read');},{type:'video'});
    await tempTest('180003',async el=>{el.querySelector('a').dispatchEvent(new MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true}));await wait(()=>el.dataset.bfrStatus==='read');},{type:'video'});
  });
  await test('右键视频链接不提前标记已读',()=>tempTest('180004',async el=>{
    el.querySelector('a').dispatchEvent(new MouseEvent('auxclick',{button:2,bubbles:true,cancelable:true}));await sleep(200);assert(!await record('180004'));
  },{type:'video'}));
  await test('动态data-url标题和时间详情入口均可标记已读',async()=>{
    await tempTest('180005',async el=>{const title=document.createElement('div');title.dataset.url='//www.bilibili.com/opus/1260807973567987717';title.textContent='打开动态详情';el.querySelector('.bili-dyn-item__body').append(title);title.click();await wait(()=>el.dataset.bfrStatus==='read');});
    await tempTest('180006',async el=>{el.querySelector('.bili-dyn-time').click();await wait(()=>el.dataset.bfrStatus==='read');});
  });
  await test('无标题动态正文打开详情时标已读，展开正文不误标',()=>tempTest('180007',async el=>{
    const summary=document.createElement('div');summary.className='dyn-card-opus__summary';summary.innerHTML='<span class="text">动态正文</span><div class="dyn-card-opus__summary__action">展开</div>';el.querySelector('.bili-dyn-item__body').append(summary);
    summary.querySelector('.dyn-card-opus__summary__action').click();await sleep(150);assert(!await record('180007'));
    summary.querySelector('.text').click();await wait(()=>el.dataset.bfrStatus==='read');
  }));
  await test('作者主页、话题和图片预览不误标已读',()=>tempTest('180008',async el=>{
    for(const url of ['https://space.bilibili.com/123456','https://search.bilibili.com/all?keyword=test']){const a=document.createElement('a');a.href=url;a.onclick=e=>e.preventDefault();el.querySelector('.bili-dyn-item__body').append(a);a.click();}
    const image=document.createElement('div');image.className='bili-album__preview';el.querySelector('.bili-dyn-item__body').append(image);image.click();await sleep(200);assert(!await record('180008'));
  }));
  await test('转发中的视频打开后仅记录外层动态',()=>tempTest('180009',async el=>{
    const orig=document.createElement('div');orig.className='bili-dyn-content__orig';orig.innerHTML='<a href="//www.bilibili.com/video/BV1xx411c7mD/">转发的视频</a>';el.querySelector('.bili-dyn-item__body').append(orig);orig.querySelector('a').onclick=e=>e.preventDefault();orig.querySelector('a').click();await wait(()=>el.dataset.bfrStatus==='read');assert(await record('180009'));assert(!await record('999999999999999999'));
  },{bridgeOnly:true}));
  await test('文字动态展开评论即标记，长ID精度保持',async()=>{
    const el=card('1234567890123456789');el.querySelector('.comment').click();await wait(()=>el.dataset.bfrStatus==='read');assert(await record('1234567890123456789'));
  });
  await test('图片动态展开空评论区也记为已读',async()=>{
    const el=card('1234567890123456791');el.querySelector('.comment').click();await wait(()=>el.dataset.bfrStatus==='read');assert(await record('1234567890123456791'));
  });
  await test('Vue元数据与嵌套Shadow DOM评论可识别，转发只记录外层',async()=>{
    const el=card('1234567890123456792');el.querySelector('.comment').click();await wait(()=>el.dataset.bfrStatus==='read');assert(await record('1234567890123456792'));assert(!await record('999999999999999999'));
  });
  await test('评论展开失败或仍在加载均保持未读',async()=>{
    card('1234567890123456793').querySelector('.comment').click();card('1234567890123456794').querySelector('.comment').click();await sleep(600);
    assert(!await record('1234567890123456793'));assert(!await record('1234567890123456794'));
  });
  await test('异步完成评论加载后才记为已读',async()=>{
    const el=card('1234567890123456794');el.querySelector('.bili-dyn-item__comment').innerHTML='<div class="reply-none">暂无评论</div>';await wait(()=>el.dataset.bfrStatus==='read');
  });
  await test('开启隐藏已读后隐藏已有记录并保留原顺序',async()=>{
    await set({hideRead:true});assert(!visible(card('1234567890123456789')));assert(!visible(card('1234567890123456791')));assert(visible(card('1234567890123456790')));
    const ids=[...F.items.children].map(x=>x.querySelector('.bili-dyn-item')).filter(visible).map(x=>x.getAttribute('dyn-id'));assert(ids.join(',')==='1234567890123456790,1234567890123456793');
  });
  await test('隐藏模式中新展开的评论不会立即消失，收起后仍保留',async()=>{
    const el=card('1234567890123456790');el.querySelector('.comment').click();await wait(()=>el.dataset.bfrStatus==='read');assert(visible(el));el.querySelector('.comment').click();await sleep(200);assert(visible(el));
  });
  await test('显式重新应用筛选后隐藏本次新增已读',async()=>{apply();await sleep(300);assert(!visible(card('1234567890123456790')));});
  await test('恢复显示后可手动改回未读',async()=>{
    await set({hideRead:false});const el=card('1234567890123456789');el.querySelector('.bfr-marker').click();await wait(()=>el.dataset.bfrStatus==='unread');assert(!await record('1234567890123456789'));
  });
  await test('存储失败会撤销界面上的乐观已读状态并提示',async()=>{
    window.fixtureFailSave=true;const el=card('1234567890123456789');el.querySelector('.bfr-marker').click();await sleep(300);window.fixtureFailSave=false;assert(el.dataset.bfrStatus==='unread');assert(document.querySelector('.bfr-notice').textContent.includes('失败'));
  });
  await test('模拟其他标签页写入后状态同步',async()=>{
    await chrome.storage.local.set({'bfr.read.1234567890123456789':{readAt:Date.now(),publishedAt:F.now}});await wait(()=>card('1234567890123456789').dataset.bfrStatus==='read');
  });
  await test('重新渲染卡片不会重复添加按钮',async()=>{
    const el=card('1234567890123456789');el.querySelector('.bili-dyn-item__desc').textContent='重新渲染内容';await sleep(400);assert(el.querySelectorAll('.bfr-marker').length===1);
  });
  await test('未知ID和未知时间保持可见，旧动态隐藏不写已读',async()=>{
    F.card('1234567890123456800',{time:F.now-31*86400});const unknown=F.card('unknown',{unknown:true});const noTime=F.card('1234567890123456801',{unknown:true});noTime.setAttribute('dyn-id','1234567890123456801');
    await sleep(400);assert(!visible(card('1234567890123456800')));assert(!await record('1234567890123456800'));assert(visible(unknown));assert(visible(noTime));assert(unknown.querySelector('.bfr-marker').disabled);
  });
  await test('切换为全部可显示超期动态',async()=>{await set({days:0});assert(visible(card('1234567890123456800')));await set({days:30});});
  await test('节点复用到另一动态时不沿用已读状态',async()=>{
    const el=card('1234567890123456789');el.setAttribute('dyn-id','1234567890123456888');await wait(()=>el.dataset.bfrStatus==='unread');assert(el.querySelectorAll('.bfr-marker').length===1);
  });
  async function paginate(initial,queue,readIds=[]){
    await set({hideRead:false,days:30});
    for(const id of readIds)await chrome.runtime.sendMessage({type:'BFR_SET_READ',id,read:true,publishedAt:F.now});
    F.scene(initial);F.loadQueue=queue;F.auto=true;await sleep(300);await set({hideRead:true});
  }
  await test('连续隐藏的已读批次能继续加载直到找到未读',async()=>{
    await paginate([['200001',{}]],[[['200002',{}]],[['200003',{text:'找到未读动态'}]]],['200001','200002']);
    await wait(()=>card('200003'),6000);assert(visible(card('200003')));assert(F.loads===2);
  });
  await test('单条旧置顶不能阻止继续查找较新的未读',async()=>{
    await paginate([['210001',{}]],[[['210002',{pinned:true,time:F.now-60*86400}]],[['210003',{}]]],['210001']);
    await wait(()=>card('210003'),6000);assert(visible(card('210003')));assert(F.loads===2);
  });
  await test('整批普通动态超出时间范围时停止查找',async()=>{
    await paginate([['220001',{}]],[[['220002',{time:F.now-40*86400}]], [['220003',{}]]],['220001']);
    await wait(()=>document.querySelector('.bfr-status').textContent.includes('查找已停止'),6000);assert(F.loads===1);assert(!card('220003'));assert(!await record('220002'));
  });
  await test('分页失败提供重试，重试后可以找到未读',async()=>{
    await paginate([['230001',{}]],['error',[['230002',{}]]],['230001']);
    await wait(()=>document.querySelector('.bfr-more').textContent==='重试加载'&&!document.querySelector('.bfr-more').hidden,6000);
    document.querySelector('.bfr-more').click();await wait(()=>card('230002'),6000);assert(visible(card('230002')));
  });
  await test('最多自动补载10批，之后要求点击继续',async()=>{
    const ids=Array.from({length:12},(_,i)=>String(240001+i));
    await paginate([[ids[0],{}]],ids.slice(1).map(id=>[[id,{}]]),ids.slice(0,11));
    await wait(()=>document.querySelector('.bfr-status').textContent.includes('本轮已查找 10 批'),12000);assert(F.loads===10,`实际加载 ${F.loads} 批`);assert(!card(ids[11]),'继续按钮点击前已加载第11批');
    document.querySelector('.bfr-more').click();await wait(()=>card(ids[11]),6000);assert(visible(card(ids[11])));
  });
  await test('B站明确提示没有更多时正确停止，不宣称全站未读总量',async()=>{
    await paginate([['250001',{}]],['end'],['250001']);await wait(()=>document.querySelector('.bfr-status').textContent.includes('没有更多动态'),6000);
    assert(F.loads===1);assert(document.querySelector('.bfr-count').textContent.includes('已加载'));
  });
  // Leave a representative, reviewable UI and a persisted record for reload checks.
  F.auto=false;await set({hideRead:false,days:30});
  F.scene([
    ['1234567890123456789',{text:'这条动态已读。刷新后仍会记住，可一键隐藏。',author:'已读示例 UP'}],
    ['1234567890123456790',{text:'这条还没有看过。展开下方评论后会自动记为已读。',author:'未读示例 UP',type:'video'}],
    ['1234567890123456900',{text:'时间范围之外的动态默认隐藏，不会被标成已读。',time:F.now-40*86400}],
    ['1234567890123456901',{text:'刚展开评论的动态本次会保留，方便继续看。',author:'评论示例 UP'}]
  ]);
  await chrome.runtime.sendMessage({type:'BFR_SET_READ',id:'1234567890123456789',read:true,publishedAt:F.now});
  await chrome.runtime.sendMessage({type:'BFR_SET_READ',id:'1234567890123456790',read:false});
  await sleep(400);card('1234567890123456901').querySelector('.comment').click();await sleep(400);
  summary.textContent=`浏览器验收：${pass} 通过，${fail} 失败`;
  badge.textContent=`验收完成：${pass} 通过 / ${fail} 失败`;
  document.body.dataset.testDone='true';document.body.dataset.testFailures=String(fail);
  window.fixtureResults={pass,fail};
})();
