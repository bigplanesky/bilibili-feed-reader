"use strict";
importScripts("core.js");
const PREFIX = "bfr.read.";
const SETTINGS = "bfr.settings";
let writes = Promise.resolve();

async function handle(message) {
  if (message.type === "BFR_GET_STATE") {
    const all = await chrome.storage.local.get(null);
    const records = {};
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(PREFIX)) continue;
      const id = BFRCore.id(key.slice(PREFIX.length));
      const record = BFRCore.record(value);
      if (id && record) records[id] = record;
    }
    return { records, settings: BFRCore.settings(all[SETTINGS]) };
  }
  if (message.type === "BFR_SET_READ") {
    const id = BFRCore.id(message.id);
    if (!id || typeof message.read !== "boolean") throw new Error("动态标识无效");
    const key = PREFIX + id;
    if (message.read) {
      await chrome.storage.local.set({ [key]: { readAt: Date.now(), publishedAt: BFRCore.timestamp(message.publishedAt) } });
    } else await chrome.storage.local.remove(key);
    return {};
  }
  if (message.type === "BFR_SET_SETTINGS") {
    const old = await chrome.storage.local.get(SETTINGS);
    const settings = BFRCore.settings({ ...BFRCore.settings(old[SETTINGS]), ...message.patch });
    await chrome.storage.local.set({ [SETTINGS]: settings });
    return { settings };
  }
  throw new Error("未知请求");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || !sender.url || new URL(sender.url).origin !== "https://t.bilibili.com") return false;
  if (!message || !["BFR_GET_STATE", "BFR_SET_READ", "BFR_SET_SETTINGS"].includes(message.type)) return false;
  // Reads also queue behind writes, so a tab's initial snapshot includes all prior writes.
  const task = writes.then(() => handle(message));
  writes = task.catch(() => {});
  task.then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message || "保存失败" }));
  return true;
});
