(() => {
  const items=document.querySelector('.bili-dyn-list__items'),loader=document.querySelector('.bili-dyn-list-loading');
  const now=Math.floor(Date.now()/1000);
  window.F={now,items,loader,loadQueue:[],loads:0,busy:false,auto:false};
  F.card=(id,options={})=>{
    const wrapper=document.createElement('div');wrapper.className='bili-dyn-list__item';
    const card=document.createElement('article');card.className='bili-dyn-item';
    const ts=options.time??now;
    if(!options.bridgeOnly&&!options.unknown){card.setAttribute('dyn-id',id);card.setAttribute('data-pub-ts',String(ts));}
    if(options.bridgeOnly){card.__vue__={data:{id_str:id,modules:{module_author:{pub_ts:ts}},orig:{id_str:'999999999999999999',modules:{module_author:{pub_ts:now-100*86400}}}}};}
    card.innerHTML=`<div class="bili-dyn-item__main"><div class="bili-dyn-item__header"><div class="author"></div><div class="bili-dyn-time"></div></div><div class="bili-dyn-item__body"><div class="bili-dyn-item__desc"></div></div><div class="bili-dyn-item__footer"><div class="bili-dyn-action forward" data-module="action" data-type="forward" role="button" tabindex="0">↗ 转发</div><div class="bili-dyn-action comment" data-module="action" data-type="comment" role="button" tabindex="0">☏ 评论 10</div><div class="bili-dyn-action like" data-module="action" data-type="like" role="button" tabindex="0">♡ 点赞</div></div></div>`;
    card.querySelector('.author').textContent=options.author||'示例 UP 主';
    card.querySelector('.bili-dyn-time').textContent=options.unknown?'时间待识别':new Date(ts*1000).toLocaleString('zh-CN');
    card.querySelector('.bili-dyn-item__desc').textContent=options.text||`测试动态 ${id} · ${options.type||'文字'}内容`;
    if(options.pinned){const tag=document.createElement('div');tag.className='bili-dyn-tag__text';tag.textContent='置顶';card.prepend(tag);}
    if(options.type==='video'){const a=document.createElement('a');a.className='bili-dyn-card-video';a.href='https://www.bilibili.com/video/BV1xx411c7mD/';a.target='_blank';a.textContent='▶ 打开视频也会标为已读';card.querySelector('.bili-dyn-item__desc').append(a);a.onclick=e=>e.preventDefault();a.onauxclick=e=>e.preventDefault();}
    const comment=card.querySelector('.comment');
    comment.onclick=()=>{
      const active=comment.classList.toggle('active');
      let section=card.querySelector('.bili-dyn-item__comment');
      if(!active){section?.remove();return;}
      section=document.createElement('div');section.className='bili-dyn-item__comment';
      if(options.comments==='error')section.innerHTML='<div class="reply-error">评论加载失败，点击重试</div>';
      else if(options.comments==='loading')section.innerHTML='<div class="reply-loading">正在加载评论…</div>';
      else if(options.comments==='empty')section.innerHTML='<div class="reply-none">暂无评论</div>';
      else if(options.comments==='shadow'){
        const host=document.createElement('bili-comments');const shadow=host.attachShadow({mode:'open'});
        shadow.innerHTML='<bili-comments-header-renderer style="display:block">评论 10</bili-comments-header-renderer><bili-comment-thread-renderer style="display:block">模拟 Shadow DOM 评论</bili-comment-thread-renderer>';section.append(host);
      }else section.innerHTML='<div class="reply-header">评论 10</div><div class="reply-item">示例评论：这条动态的评论已展开。</div>';
      card.append(section);
    };
    wrapper.append(card);items.append(wrapper);return card;
  };
  F.scene=options=>{
    F.auto=false;F.loadQueue=[];F.loads=0;F.busy=false;
    items.replaceChildren();loader.className='bili-dyn-list-loading';loader.style.display='none';loader.textContent='加载更多动态';
    options.forEach(([id,opt])=>F.card(id,opt));
  };
  window.addEventListener('scroll',()=>{
    if(!F.auto||F.busy||loader.classList.contains('bfr-native-paused')||!F.loadQueue.length)return;
    F.busy=true;const batch=F.loadQueue.shift();F.loads++;loader.style.display='block';loader.textContent='正在加载…';
    setTimeout(()=>{
      if(batch==='error'){loader.innerHTML='<button class="retry">加载失败，点击重试</button>';loader.querySelector('button').onclick=()=>{loader.textContent='加载更多动态';};}
      else if(batch==='end')loader.textContent='没有更多动态了';
      else {batch.forEach(([id,opts])=>F.card(id,opts));loader.textContent='加载更多动态';loader.style.display='none';}
      F.busy=false;
    },90);
  });
  if(new URLSearchParams(location.search).get('mode')==='reload'){
    F.scene([['1234567890123456789',{text:'刷新后持久化验证'}],['1234567890123456790',{text:'未读动态保留'}]]);
  }else F.scene([
    ['1234567890123456789',{text:'文字动态：展开评论后自动记为已读。'}],
    ['1234567890123456790',{type:'video',text:'视频动态：打开视频也会标为已读。'}],
    ['1234567890123456791',{type:'image',comments:'empty',text:'图片动态：空评论区也算看过。'}],
    ['1234567890123456792',{bridgeOnly:true,type:'forward',comments:'shadow',text:'转发动态：使用外层动态 ID 和发布时间。'}],
    ['1234567890123456793',{comments:'error',text:'评论加载失败时保持未读。'}],
    ['1234567890123456794',{comments:'loading',text:'评论仍在加载时保持未读。'}]
  ]);
})();
