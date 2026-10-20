/* Runs in the page's MAIN world. Exposes only an outer post's ID and timestamp.
 * No cookies, tokens, requests, storage, or extension APIs are used here. */
(() => {
  "use strict";
  function safeId(value) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) return null;
      value = String(value);
    }
    return typeof value === "string" && /^[1-9]\d{4,29}$/.test(value) ? value : null;
  }
  function extract(element) {
    const candidates = [];
    const vue2 = element.__vue__;
    for (let vm = vue2, depth = 0; vm && depth < 4; vm = vm.$parent, depth++) {
      candidates.push(vm.data, vm.$props?.data, vm.$props?.item, vm._props?.data);
      if (depth > 0 && vm.$el !== element) break;
    }
    const vue3 = element.__vueParentComponent;
    for (let vm = vue3, depth = 0; vm && depth < 4; vm = vm.parent, depth++) {
      candidates.push(vm.props?.data, vm.props?.item, vm.setupState?.data);
      if (depth > 0 && vm.vnode?.el !== element) break;
    }
    for (const data of candidates) {
      if (!data || typeof data !== "object") continue;
      const id = safeId(data.id_str ?? data.dynamic_id_str ?? data.dynamic_id);
      if (!id) continue;
      const ts = data.modules?.module_author?.pub_ts ?? data.pub_ts;
      const publishedAt = (typeof ts === "number" || typeof ts === "string") && Number.isFinite(Number(ts)) ? Number(ts) : null;
      return { id, publishedAt, pinned: data.modules?.module_tag?.text === "置顶" };
    }
    return null;
  }
  document.addEventListener("bfr:request-meta", event => {
    const el = event.target;
    if (!(el instanceof Element) || !el.matches(".bili-dyn-item")) return;
    try {
      const meta = extract(el);
      if (meta) el.dispatchEvent(new CustomEvent("bfr:meta", { bubbles: true, detail: JSON.stringify(meta) }));
    } catch { /* An unsupported component is kept visible by the content script. */ }
  });
})();
