/* Shared, dependency-free policy. IDs must never pass through Number(). */
(function (root) {
  "use strict";
  const DEFAULTS = Object.freeze({ hideRead: false, days: 30 });
  function id(value) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value <= 0) return null;
      value = String(value);
    }
    return typeof value === "string" && /^[1-9]\d{4,29}$/.test(value) ? value : null;
  }
  function timestamp(value) {
    if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) return null;
    let n = Number(value);
    if (n > 1e12) n /= 1000;
    return Number.isFinite(n) && n >= 1262304000 && n <= Date.now() / 1000 + 86400 ? Math.floor(n) : null;
  }
  function settings(value = {}) {
    if (!value || typeof value !== "object") value = {};
    return {
      hideRead: typeof value.hideRead === "boolean" ? value.hideRead : DEFAULTS.hideRead,
      days: [0, 7, 30, 90].includes(value.days) ? value.days : DEFAULTS.days
    };
  }
  function reason(meta, config, read, exempt, now = Date.now()) {
    if (!id(meta.id) || (config.days !== 0 && !timestamp(meta.publishedAt))) return null;
    if (config.days && meta.publishedAt * 1000 < now - config.days * 86400000) return "old";
    if (config.hideRead && read && !exempt) return "read";
    return null;
  }
  function record(value) {
    return value && Number.isFinite(value.readAt) && value.readAt > 0
      ? { readAt: value.readAt, publishedAt: timestamp(value.publishedAt) } : null;
  }
  function isContentUrl(value, base = "https://t.bilibili.com/") {
    if (typeof value !== "string" || !value.trim() || value.startsWith("#")) return false;
    try {
      const url = new URL(value, base);
      if (!["https:", "http:"].includes(url.protocol)) return false;
      if (url.hostname === "t.bilibili.com") return /^\/[1-9]\d{4,29}\/?$/.test(url.pathname);
      if (url.hostname !== "www.bilibili.com") return false;
      return /^\/video\/(?:BV[0-9a-z]+|av[1-9]\d*)\/?$/i.test(url.pathname) ||
        /^\/opus\/[1-9]\d{4,29}\/?$/.test(url.pathname) || /^\/read\/cv[1-9]\d*\/?$/i.test(url.pathname);
    } catch { return false; }
  }
  // A single old/pinned card never establishes a boundary. Only a newly appended,
  // fully dated batch of ordinary posts wholly beyond the cutoff may stop catch-up.
  function pastBoundary(batch, days, now = Date.now()) {
    const ordinary = batch.filter(m => !m.pinned);
    return days > 0 && ordinary.length > 0 && ordinary.every(m =>
      id(m.id) && timestamp(m.publishedAt) && m.publishedAt * 1000 < now - days * 86400000);
  }
  const api = { DEFAULTS, id, timestamp, settings, reason, record, isContentUrl, pastBoundary };
  root.BFRCore = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
