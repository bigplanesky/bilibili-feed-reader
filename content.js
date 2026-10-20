(() => {
  "use strict";
  // Detail pages use different navigation and are intentionally not filtered.
  if (location.pathname !== "/" || document.getElementById("bfr-panel")) return;
  const C = BFRCore, A = BFRAdapter;
  const PREFIX = "bfr.read.", SETTINGS = "bfr.settings";
  const rows = new Map(), sessionRead = new Set(), pending = new Map();
  let records = {}, config = C.settings(), loaded = false, panel, ui;
  let scanTimer, commentTimer, lastRoute = location.href, epoch = 0;
  let filling = false, fillToken = 0, paused = false, stop = "", status = "只统计已加载内容，向下浏览会继续加载。";
  let pauseElement = null, pauseGuard = null, notice = "", destroyed = false;
  const initialChanges = [];
  const request = async message => {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "扩展连接中断，请刷新页面");
    return response;
  };
  function showError(error) { notice = error.message || String(error); renderPanel(); }
  function makePanel() {
    panel = document.createElement("aside"); panel.id = "bfr-panel"; panel.setAttribute("aria-label", "B站动态已读助手");
    // Static extension-owned markup only. Website text is never assigned to innerHTML.
    panel.dataset.version = "1.0.2";
    panel.innerHTML = `<div class="bfr-head"><strong>动态已读助手</strong><button class="bfr-fold" type="button" aria-label="收起工具栏" aria-expanded="true">−</button></div><div class="bfr-body"><div class="bfr-row"><label><input class="bfr-hide" type="checkbox"> 隐藏已读</label></div><div class="bfr-row"><label for="bfr-days">时间范围</label><select id="bfr-days"><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="0">全部</option></select></div><button class="bfr-apply" type="button">重新应用筛选</button><div class="bfr-count"></div><div class="bfr-status" role="status" aria-live="polite"></div><div class="bfr-notice" role="alert" hidden></div><button class="bfr-more" type="button" hidden>继续查找未读</button></div>`;
    document.body.append(panel);
    ui = {
      hide: panel.querySelector(".bfr-hide"), days: panel.querySelector("select"), apply: panel.querySelector(".bfr-apply"),
      count: panel.querySelector(".bfr-count"), status: panel.querySelector(".bfr-status"), notice: panel.querySelector(".bfr-notice"), more: panel.querySelector(".bfr-more")
    };
    const fold = panel.querySelector(".bfr-fold"), body = panel.querySelector(".bfr-body");
    fold.addEventListener("click", () => {
      body.hidden = !body.hidden; fold.textContent = body.hidden ? "+" : "−";
      fold.setAttribute("aria-expanded", String(!body.hidden)); fold.setAttribute("aria-label", body.hidden ? "展开工具栏" : "收起工具栏");
    });
    ui.hide.addEventListener("change", () => saveSettings({ hideRead: ui.hide.checked }));
    ui.days.addEventListener("change", () => saveSettings({ days: Number(ui.days.value) }));
    ui.apply.addEventListener("click", () => reapply());
    ui.more.addEventListener("click", () => { resetFill(); void fill(true); });
  }
  async function saveSettings(patch) {
    ui.hide.disabled = ui.days.disabled = true;
    try { const result = await request({ type: "BFR_SET_SETTINGS", patch }); config = result.settings; notice = ""; reapply(); }
    catch (error) { showError(error); }
    finally { ui.hide.disabled = ui.days.disabled = false; renderPanel(); }
  }
  function unpause() { pauseElement?.classList.remove("bfr-native-paused"); pauseElement = null; pauseGuard?.remove(); pauseGuard = null; }
  function holdNativeLoader() {
    pauseElement = A.loader(); pauseElement?.classList.add("bfr-native-paused");
    // Some Bilibili versions load on document scroll rather than a sentinel.
    // Give those versions a non-visible-content runway while catch-up is held.
    if (!pauseGuard?.isConnected && A.feed()) {
      pauseGuard = document.createElement("div"); pauseGuard.className = "bfr-paging-guard";
      pauseGuard.setAttribute("aria-hidden", "true"); pauseGuard.style.height = `${Math.max(1200, innerHeight + 800)}px`;
      A.feed().append(pauseGuard);
    }
  }
  function resetFill() {
    fillToken++; paused = false; stop = ""; unpause();
    status = "只统计已加载内容，向下浏览会继续加载。";
  }
  function reapply() {
    epoch++; sessionRead.clear(); pending.clear(); resetFill(); scan();
  }
  function renderPanel() {
    if (!ui) return;
    ui.hide.checked = config.hideRead; ui.days.value = String(config.days);
    let read = 0, unread = 0, unknown = 0, hiddenRead = 0, old = 0;
    for (const row of rows.values()) {
      if (!row.meta.id || (config.days && !row.meta.publishedAt)) unknown++;
      else if (records[row.meta.id]) read++; else unread++;
      if (row.reason === "read") hiddenRead++;
      if (row.reason === "old") old++;
    }
    ui.count.textContent = `已加载 ${rows.size} 条 · 已读 ${read} · 未读 ${unread}${unknown ? ` · 待识别 ${unknown}` : ""}；已隐藏 ${hiddenRead} 条已读、${old} 条超期动态`;
    ui.status.textContent = status;
    ui.notice.textContent = notice; ui.notice.hidden = !notice;
    ui.more.hidden = filling || !paused;
    ui.more.textContent = stop === "error" ? "重试加载" : "继续查找未读";
    ui.apply.disabled = !loaded;
  }
  function decorate(row) {
    const { card, meta, button } = row;
    const read = !!records[meta.id];
    button.dataset.read = String(read);
    button.disabled = !meta.id || !!row.saving;
    button.textContent = !meta.id ? "无法识别此动态" : `${read ? "✓ 已读" : "○ 未读"} · ${read ? "改为未读" : "标为已读"}`;
    button.title = !meta.id ? "未获得可靠动态 ID，保持可见。" : config.days && !meta.publishedAt ? "无法识别发布时间，保持可见。点击可切换已读状态。" : "展开评论或打开动态详情、视频后会标记为已读。";
    row.reason = C.reason(meta, config, read, sessionRead.has(meta.id));
    row.host.classList.toggle("bfr-hidden", !!row.reason);
    card.dataset.bfrStatus = !meta.id ? "unknown" : read ? "read" : "unread";
  }
  async function setRead(row, read) {
    if (!row.meta.id || row.saving) return;
    const id = row.meta.id, old = records[id], wasExempt = sessionRead.has(id);
    pending.delete(row.card); row.saving = true;
    if (read) { sessionRead.add(id); records[id] = { readAt: Date.now(), publishedAt: row.meta.publishedAt }; }
    else { sessionRead.delete(id); delete records[id]; }
    for (const other of rows.values()) if (other.meta.id === id) decorate(other);
    renderPanel();
    try { await request({ type: "BFR_SET_READ", id, read, publishedAt: row.meta.publishedAt }); notice = ""; }
    catch (error) {
      if (old) records[id] = old; else delete records[id];
      if (wasExempt) sessionRead.add(id); else sessionRead.delete(id);
      showError(error);
    } finally {
      row.saving = false;
      for (const other of rows.values()) if (other.meta.id === id) decorate(other);
      renderPanel();
    }
  }
  function mountTools(row) {
    const { card, tools, button } = row;
    if (button.parentElement !== tools) tools.append(button);
    if (tools.isConnected && card.contains(tools)) return;
    // The native author header has a fixed height. Never insert controls inside it.
    const main = A.own(card, ".bili-dyn-item__main")[0] || card;
    const header = A.own(card, ".bili-dyn-item__header")[0];
    if (header?.parentElement === main) header.after(tools);
    else {
      const body = A.own(card, ".bili-dyn-item__body")[0];
      if (body?.parentElement === main) body.before(tools); else main.append(tools);
    }
  }
  function addRow(card) {
    const button = document.createElement("button"); button.type = "button"; button.className = "bfr-marker";
    const tools = document.createElement("div"); tools.className = "bfr-card-tools";
    const row = { card, button, tools, host: card.parentElement?.matches(".bili-dyn-list__item") ? card.parentElement : card, meta: A.domMeta(card), reason: null, saving: false, bridgeMeta: null };
    mountTools(row);
    button.addEventListener("click", event => { event.stopPropagation(); void setRead(row, !records[row.meta.id]); });
    rows.set(card, row);
    return row;
  }
  function scan() {
    if (!loaded || destroyed) return;
    if (location.href !== lastRoute) {
      lastRoute = location.href; epoch++; pending.clear(); sessionRead.clear(); resetFill();
    }
    if (location.pathname !== "/") { destroy(); return; }
    const current = new Set(A.cards());
    for (const [card, row] of rows) if (!current.has(card)) {
      row.host.classList.remove("bfr-hidden"); row.tools.remove(); rows.delete(card); pending.delete(card);
    }
    for (const card of current) {
      const row = rows.get(card) || addRow(card);
      const dom = A.domMeta(card);
      // Refresh component identity before applying any previously obtained metadata.
      row.bridgeMeta = null;
      card.dispatchEvent(new CustomEvent("bfr:request-meta", { bubbles: true }));
      const bridge = row.bridgeMeta, id = dom.id || bridge?.id || null;
      const meta = { id, publishedAt: (bridge?.id === id && bridge?.publishedAt) || dom.publishedAt, pinned: !!(bridge?.pinned || dom.pinned) };
      if (row.meta.id && meta.id !== row.meta.id) pending.delete(card);
      row.meta = meta;
      mountTools(row);
      decorate(row);
    }
    panel.hidden = !A.feed();
    if (paused && A.loader() !== pauseElement) { unpause(); holdNativeLoader(); }
    checkComments(); renderPanel();
    if (!filling && !paused && !stop && needsFill()) void fill(false);
  }
  function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 120); }
  function needsFill() {
    if (!rows.size || document.hidden || !A.feed()) return false;
    const shown = [...rows.values()].filter(r => !r.reason);
    if (!shown.length) return true;
    const nearBottom = A.feed().getBoundingClientRect().bottom < innerHeight + 120;
    return nearBottom && !shown.some(r => { const rect = r.host.getBoundingClientRect(); return rect.bottom > 65 && rect.top < innerHeight; });
  }
  function pause(message, why) {
    paused = true; stop = why; status = message;
    holdNativeLoader();
  }
  function signature() { return [...rows.values()].map(r => r.meta.id || r.card).map(String).join("|"); }
  async function fill(force) {
    if (filling || destroyed || document.hidden || (!force && !needsFill())) return;
    const token = fillToken; filling = true; unpause(); renderPanel();
    try {
      for (let batch = 0; batch < 10; batch++) {
        if (destroyed || token !== fillToken || document.hidden) return;
        unpause();
        const state = A.pageState();
        if (state === "end") { stop = "end"; status = "B 站提示没有更多动态；统计范围为已加载内容。"; return; }
        if (state === "error" && !force) { pause("B 站加载失败；可重试，也可关闭筛选后手动浏览。", "error"); return; }
        force = false;
        const before = signature(), beforeRows = new Map([...rows.values()].map(r => [r.card, r.meta.id]));
        status = `正在继续查找未读…（本轮第 ${batch + 1}/10 批）`; renderPanel();
        A.requestMore();
        const deadline = Date.now() + 12000;
        let changed = false;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (destroyed || token !== fillToken || document.hidden) return;
          scan();
          if (signature() !== before) { changed = true; break; }
          if (A.pageState() !== "more") break;
        }
        if (A.pageState() === "error") { pause("加载失败，尚未确认更早动态是否有未读。", "error"); return; }
        if (A.pageState() === "end") { stop = "end"; status = "B 站提示没有更多动态；统计范围为已加载内容。"; return; }
        if (!changed) { pause("未收到更多动态，尚未确认是否看完。可重试或关闭筛选后向下滚动。", "error"); return; }
        const appended = [...rows.values()].filter(r => !beforeRows.has(r.card) || beforeRows.get(r.card) !== r.meta.id).map(r => r.meta);
        if (C.pastBoundary(appended, config.days)) {
          pause(`已加载到 ${config.days} 天之前；当前范围的查找已停止。`, "boundary");
          // The continuation action is useful even with unusual out-of-order feeds.
          return;
        }
        if (!needsFill()) { unpause(); status = "已找到可浏览的动态；向下浏览会继续加载。"; return; }
      }
      pause("本轮已查找 10 批，仍有更早动态待确认。", "limit");
    } catch (error) { if (token === fillToken) pause(error.message || "加载失败，请重试。", "error"); }
    finally {
      filling = false; renderPanel();
      if (!paused) unpause();
      if (token !== fillToken && !destroyed) scheduleScan();
    }
  }
  function checkComments() {
    clearTimeout(commentTimer); commentTimer = null;
    for (const [card, intent] of pending) {
      const row = rows.get(card);
      if (!row || row.meta.id !== intent.id || intent.epoch !== epoch || Date.now() - intent.at > 30000) { pending.delete(card); continue; }
      const state = A.commentState(card);
      if (state === "error") { pending.delete(card); notice = "评论加载失败，此动态未标为已读。"; continue; }
      if (state === "ready") { pending.delete(card); if (!records[row.meta.id]) void setRead(row, true); }
    }
    if (pending.size) commentTimer = setTimeout(() => { checkComments(); renderPanel(); }, 250);
  }
  function clickComment(event) {
    const button = event.target instanceof Element ? event.target.closest(".bili-dyn-action.comment, [data-module='action'][data-type='comment']") : null;
    const card = button?.closest(".bili-dyn-item"), row = rows.get(card);
    if (!row || button !== A.commentButton(card) || !row.meta.id) return;
    // Capture phase records the closed->open intent before Bilibili's handler runs.
    if (A.expanded(card)) pending.delete(card);
    else { pending.set(card, { id: row.meta.id, epoch, at: Date.now() }); setTimeout(() => { checkComments(); renderPanel(); }, 0); }
  }
  function openContent(event) {
    if (event.type === "click" ? event.button !== 0 : event.button !== 1) return;
    if (!(event.target instanceof Element)) return;
    let card = event.target.closest(".bili-dyn-item");
    while (card && !rows.has(card)) card = card.parentElement?.closest(".bili-dyn-item");
    const row = rows.get(card);
    if (row?.meta.id && !records[row.meta.id] && A.opensContent(card, event.target, event.type === "click")) void setRead(row, true);
    // Do not preventDefault/stopPropagation: preserve Bilibili's navigation,
    // Ctrl/Cmd-click, middle-click, and keyboard-generated link clicks.
  }
  function metadata(event) {
    const row = rows.get(event.target);
    if (!row || typeof event.detail !== "string" || event.detail.length > 512) return;
    try {
      const data = JSON.parse(event.detail), id = C.id(data.id);
      if (id) row.bridgeMeta = { id, publishedAt: C.timestamp(data.publishedAt), pinned: data.pinned === true };
    } catch { /* Ignore unrelated page events. */ }
  }
  function storageChanged(changes, area) {
    if (area !== "local") return;
    if (!loaded) { initialChanges.push(changes); return; }
    let settingsChanged = false;
    for (const [key, value] of Object.entries(changes)) {
      if (key === SETTINGS) { config = C.settings(value.newValue); settingsChanged = true; }
      if (key.startsWith(PREFIX)) {
        const id = C.id(key.slice(PREFIX.length)), record = C.record(value.newValue);
        if (!id) continue;
        if (record) records[id] = record; else { delete records[id]; sessionRead.delete(id); }
      }
    }
    if (settingsChanged) reapply(); else scheduleScan();
  }
  const observer = new MutationObserver(mutations => {
    // A newly appended batch can make the site's sentinel visible again before
    // our debounced scan runs. Hold it between batches to avoid runaway prefetch
    // when every fetched post is hidden. The next iteration explicitly releases it.
    if (filling && mutations.some(m => m.type === "childList" && [...m.addedNodes].some(n =>
      n instanceof Element && (n.matches(".bili-dyn-item") || n.querySelector(".bili-dyn-item"))))) {
      holdNativeLoader();
    }
    if (mutations.some(m => !panel?.contains(m.target) && !(m.target instanceof Element && m.target.closest(".bfr-marker")) &&
      (m.type !== "attributes" || m.attributeName !== "class" || m.target.matches(".bili-dyn-action.comment")))) scheduleScan();
  });
  function destroy() {
    destroyed = true; fillToken++; observer.disconnect(); clearTimeout(scanTimer); clearTimeout(commentTimer); unpause();
    document.removeEventListener("click", clickComment, true); document.removeEventListener("bfr:meta", metadata);
    document.removeEventListener("click", openContent, true); document.removeEventListener("auxclick", openContent, true);
    window.removeEventListener("scroll", scheduleScan); document.removeEventListener("visibilitychange", scheduleScan);
    chrome.storage.onChanged.removeListener(storageChanged);
    for (const row of rows.values()) { row.host.classList.remove("bfr-hidden"); row.tools.remove(); }
    rows.clear(); pending.clear(); panel?.remove();
  }
  async function init() {
    makePanel(); panel.hidden = true;
    try {
      // Register before reading initial state; get-state is serialized by the worker.
      chrome.storage.onChanged.addListener(storageChanged);
      const initial = await request({ type: "BFR_GET_STATE" });
      records = initial.records; config = initial.settings; loaded = true;
      for (const changes of initialChanges.splice(0)) storageChanged(changes, "local");
      document.addEventListener("bfr:meta", metadata);
      document.addEventListener("click", clickComment, true);
      document.addEventListener("click", openContent, true);
      document.addEventListener("auxclick", openContent, true);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-expanded", "hidden", "dyn-id", "data-did", "data-dyn-id"] });
      window.addEventListener("scroll", scheduleScan, { passive: true });
      document.addEventListener("visibilitychange", scheduleScan);
      scan();
    } catch (error) { panel.hidden = false; showError(error); status = "助手尚未启动，请刷新页面重试。"; renderPanel(); }
  }
  void init();
})();
