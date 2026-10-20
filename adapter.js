/* All Bilibili markup assumptions live in this adapter. */
(() => {
  "use strict";
  const C = BFRCore;
  const CARD = ".bili-dyn-item";
  const ORIG = ".bili-dyn-item__orig, .bili-dyn-content__orig, .bili-dyn-card__orig";
  function own(card, selector) {
    return [...card.querySelectorAll(selector)].filter(el => el.closest(CARD) === card && !el.closest(ORIG));
  }
  function parseDate(text, now = new Date()) {
    if (!text) return null;
    text = text.trim();
    if (/^\d{4}-\d\d-\d\dT/.test(text)) return C.timestamp(Date.parse(text) / 1000);
    let m = text.match(/^(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const date = new Date(+m[1], +m[2] - 1, +m[3], m[4] === undefined ? 23 : +m[4], m[5] === undefined ? 59 : +m[5], m[4] === undefined ? 59 : +(m[6] || 0));
      if (date.getFullYear() !== +m[1] || date.getMonth() !== +m[2] - 1 || date.getDate() !== +m[3]) return null;
      return C.timestamp(date.getTime() / 1000);
    }
    // Relative labels are rounded by the website. Keep the oldest possible time
    // ambiguous rather than accidentally hiding a post at the range boundary.
    if (/^(刚刚|\d+秒前|\d+分钟前|\d+小时前|今天)/.test(text)) return Math.floor(now.getTime() / 1000);
    m = text.match(/^昨天\s*(\d{1,2}):(\d{2})/);
    if (m) return C.timestamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, +m[1], +m[2]).getTime() / 1000);
    m = text.match(/^(\d{1,2})[月-](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const d = new Date(now.getFullYear(), +m[1] - 1, +m[2], m[3] === undefined ? 23 : +m[3], m[4] === undefined ? 59 : +m[4], m[3] === undefined ? 59 : 0);
      if (d.getMonth() !== +m[1] - 1 || d.getDate() !== +m[2]) return null;
      if (d.getTime() > now.getTime() + 86400000) d.setFullYear(d.getFullYear() - 1);
      return C.timestamp(d.getTime() / 1000);
    }
    return null;
  }
  function domMeta(card) {
    const time = own(card, ".bili-dyn-time, [data-module='time']")[0];
    const wrapper = card.parentElement?.matches(".bili-dyn-list__item") ? card.parentElement : null;
    let id = null, publishedAt = null;
    for (const node of [card, wrapper, time].filter(Boolean)) {
      for (const attr of ["dyn-id", "data-did", "data-dyn-id", "data-dynamic-id"]) id ||= C.id(node.getAttribute(attr));
      for (const attr of ["data-pub-ts", "data-timestamp"]) publishedAt ||= C.timestamp(node.getAttribute(attr));
    }
    if (time) {
      const link = time.matches("a[href]") ? time : time.querySelector("a[href]");
      if (link) {
        try {
          const url = new URL(link.getAttribute("href"), location.href);
          if (["t.bilibili.com", "www.bilibili.com"].includes(url.hostname)) {
            id ||= C.id(url.pathname.match(/^\/(?:opus\/)?(\d+)\/?$/)?.[1]);
          }
        } catch { /* Keep unknown posts visible. */ }
      }
      publishedAt ||= parseDate(time.getAttribute("datetime") || time.getAttribute("title") || "");
      publishedAt ||= parseDate(time.textContent);
    }
    const pinned = own(card, ".bili-dyn-tag__text").some(el => el.textContent.trim() === "置顶");
    return { id, publishedAt, pinned };
  }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  }
  function commentButton(card) { return own(card, ".bili-dyn-action.comment, [data-module='action'][data-type='comment']")[0] || null; }
  function opensContent(card, target, allowNonAnchor = true) {
    if (!(target instanceof Element) || !card.contains(target)) return false;
    if (target.closest(".bfr-card-tools, .bfr-marker, .bili-dyn-item__comment, .bili-dyn-item__comments, bili-comments, .bb-comment, .bili-dyn-action, .bili-dyn-item__more, .dyn-card-opus__summary__action")) return false;
    const link = target.closest("a[href]");
    if (link && card.contains(link)) return C.isContentUrl(link.getAttribute("href"), location.href);
    if (!allowNonAnchor) return false;
    const dataLink = target.closest("[data-url]");
    if (dataLink && card.contains(dataLink) && C.isContentUrl(dataLink.getAttribute("data-url"), location.href)) return true;
    // Bilibili's timestamp is a Vue-controlled detail link without an href.
    const time = target.closest(".bili-dyn-time, [data-module='time']");
    if (time && own(card, ".bili-dyn-time, [data-module='time']").includes(time)) return true;
    // Verified on the live site: clicking an opus summary opens its detail tab;
    // its separate expand-text control and image preview must remain excluded.
    const summary = target.closest(".dyn-card-opus__summary");
    return !!summary && card.contains(summary) && !window.getSelection()?.toString();
  }
  function expanded(card) {
    const button = commentButton(card);
    return !!button && (button.classList.contains("active") || button.getAttribute("aria-expanded") === "true");
  }
  function commentState(card) {
    if (!expanded(card)) return "closed";
    const containers = own(card, ".bili-dyn-item__comment, .bili-dyn-item__comments, bili-comments, .bb-comment").filter(visible);
    const roots = [];
    // New comments use nested, open shadow roots. Polling is limited to the
    // comment currently being opened; there is no perpetual shadow-DOM observer.
    function visit(root, depth = 0) {
      roots.push(root);
      if (depth >= 5) return;
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
    }
    containers.forEach(el => { visit(el); if (el.shadowRoot) visit(el.shadowRoot); });
    if (!roots.length) return "loading";
    const errorSelector = ".reply-error, .comment-error, .bili-comments-error, [data-state='error']";
    const readySelector = ".reply-item, .reply-none, .no-reply, .reply-box, .reply-header, .comment-header, bili-comment-thread-renderer, bili-comments-header-renderer, bili-comment-box, bili-comments-empty";
    for (const root of roots) if (root.querySelector(errorSelector)) return "error";
    const hasReadyUI = roots.some(root => [...root.querySelectorAll(readySelector)].some(visible));
    if (!hasReadyUI && roots.some(root => /(?:加载|请求|获取).{0,8}失败|网络异常|出错了|访问受限/.test(root.textContent))) return "error";
    for (const root of roots) {
      if ([...root.querySelectorAll(readySelector)].some(visible) || /暂无评论|还没有评论|还没有人评论|发一条评论/.test(root.textContent)) return "ready";
    }
    return "loading";
  }
  function feed() { return document.querySelector(".bili-dyn-list"); }
  function cards() {
    const list = feed();
    return list ? [...list.querySelectorAll(CARD)].filter(el => !el.parentElement?.closest(CARD)) : [];
  }
  function loader() {
    const list = feed();
    if (!list) return null;
    const candidates = [...list.querySelectorAll(".bili-dyn-list-loading, .bili-dyn-list__loading, .bili-dyn-list__load-more, .bili-dyn-list__loading-container, .bili-dyn-list__end, .bili-dyn-list__no-more, .bili-dyn-list__error")].filter(el => !el.closest(CARD));
    return candidates.find(visible) || candidates[0] || null;
  }
  function pageState() {
    const el = loader();
    const text = el?.textContent.trim() || "";
    if (/加载失败|请求失败|网络异常|出错了|点击重试/.test(text)) return "error";
    if (/没有更多|暂无更多|到达了世界的尽头|到底[了啦]|全部加载完/.test(text)) return "end";
    return "more";
  }
  function requestMore() {
    const el = loader(), list = feed();
    if (!list) throw new Error("未找到 B 站动态列表；请刷新页面后重试");
    const retry = el && [...el.querySelectorAll("button, a, [role='button'], .retry")].find(n => /重试|重新加载/.test(n.textContent));
    if (retry) retry.click();
    (el && visible(el) ? el : list).scrollIntoView({ block: "end", behavior: "instant" });
    // The current site hides .bili-dyn-list-loading while idle. Its scroll-based
    // loader must see the bottom of the document, not a display:none element.
    if (!el || !visible(el)) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
  }
  globalThis.BFRAdapter = { own, domMeta, parseDate, visible, commentButton, opensContent, expanded, commentState, feed, cards, loader, pageState, requestMore };
})();
