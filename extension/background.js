"use strict";
(() => {
  // src/background/queue_tabs.ts
  var QUEUE_TABS_KEY = "lanovelQueueTabs";
  var OUTBOX_KEY = "lanovelQueueOutbox";
  var CONFIG_KEY = "lanovelRemoteConfig";
  var MAX_OUTBOX = 50;
  var memoryTabs = /* @__PURE__ */ new Map();
  var lockChain = Promise.resolve();
  function withLock(fn) {
    const run = lockChain.then(fn, fn);
    lockChain = run.catch(() => void 0);
    return run;
  }
  async function readTabs() {
    try {
      const r = await chrome.storage.session.get(QUEUE_TABS_KEY);
      return r[QUEUE_TABS_KEY] || {};
    } catch (e) {
      const out = {};
      memoryTabs.forEach((v, k) => {
        out[String(k)] = v;
      });
      return out;
    }
  }
  async function writeTabs(tabs) {
    memoryTabs.clear();
    Object.keys(tabs).forEach((k) => memoryTabs.set(Number(k), tabs[k]));
    try {
      await chrome.storage.session.set({ [QUEUE_TABS_KEY]: tabs });
    } catch (e) {
    }
  }
  async function getQueueSession(tabId) {
    if (tabId == null) return null;
    const tabs = await readTabs();
    return tabs[String(tabId)] || null;
  }
  function setQueueSession(tabId, session) {
    return withLock(async () => {
      const tabs = await readTabs();
      if (session) tabs[String(tabId)] = session;
      else delete tabs[String(tabId)];
      await writeTabs(tabs);
    });
  }
  async function remoteQueueGoto(cmd, tabId) {
    const params = cmd.params || {};
    const url = params.url;
    if (!url || !/^https?:\/\//.test(url)) return { ok: false, message: "\uC62C\uBC14\uB974\uC9C0 \uC54A\uC740 URL" };
    const session = {
      queue_item_id: typeof params.queue_item_id === "number" ? params.queue_item_id : null,
      skip_translated: !!params.skip_translated
    };
    if (tabId != null) {
      try {
        await setQueueSession(tabId, session);
        await chrome.tabs.update(tabId, { url });
        return { ok: true, message: `\uBAA9\uB85D: \uC774\uB3D9 ${url}` };
      } catch (e) {
        await setQueueSession(tabId, null);
      }
    }
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id != null) await setQueueSession(tab.id, session);
    return { ok: true, message: `\uBAA9\uB85D: \uC0C8 \uD0ED\uC5D0\uC11C \uC5F4\uAE30 ${url}` };
  }
  async function readOutbox() {
    try {
      const r = await chrome.storage.local.get(OUTBOX_KEY);
      return r[OUTBOX_KEY] || [];
    } catch (e) {
      return [];
    }
  }
  function enqueueQueueEvent(data) {
    return withLock(async () => {
      const items = await readOutbox();
      items.push(data);
      await chrome.storage.local.set({ [OUTBOX_KEY]: items.slice(-MAX_OUTBOX) });
    });
  }
  var flushing = false;
  async function flushQueueOutbox(send) {
    if (flushing) return;
    flushing = true;
    try {
      for (; ; ) {
        const items = await readOutbox();
        if (!items.length) break;
        const ok = await send(items[0]);
        if (!ok) break;
        await withLock(async () => {
          const latest = await readOutbox();
          latest.shift();
          await chrome.storage.local.set({ [OUTBOX_KEY]: latest });
        });
      }
    } finally {
      flushing = false;
    }
  }
  function saveRemoteConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    const clean = { running: !!cfg.running, cinderella: !!cfg.cinderella };
    chrome.storage.local.set({ [CONFIG_KEY]: clean }).catch(() => void 0);
  }

  // src/background/remote_ws.ts
  var REMOTE_BASE_HTTP = "http://127.0.0.1:8001";
  var REMOTE_BASE_WS = "ws://127.0.0.1:8001";
  var REMOTE_POLL_INTERVAL_MS = 5e3;
  var REMOTE_WS_RETRY_MS = 1e4;
  var REMOTE_PING_INTERVAL_MS = 2e4;
  var REMOTE_CONTENT_TIMEOUT_MS = 5e3;
  var remoteWs = null;
  var remotePollTimer = null;
  var remotePingTimer = null;
  var remoteRetryTimer = null;
  var remoteConnecting = false;
  var remoteReports = /* @__PURE__ */ new Map();
  var remoteTargetTabId = null;
  function remoteFetch(path, options = {}) {
    return fetch(`${REMOTE_BASE_HTTP}/api/remote${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers || {} }
    });
  }
  function remotePickTarget() {
    let best = null;
    for (const [tabId, r] of remoteReports) {
      if (!best || r.activeAt > best.r.activeAt || r.activeAt === best.r.activeAt && r.at > best.r.at) {
        best = { tabId, r };
      }
    }
    remoteTargetTabId = best ? best.tabId : null;
    return best;
  }
  function remoteCurrentStatusPayload() {
    const best = remotePickTarget();
    if (!best) return { phase: "idle", text: "\uBC88\uC5ED \uC911\uC778 \uD0ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", url: "", book_title: "", chapter_title: "", percentage: 0, delay_remaining_sec: 0, next_scheduled: false, turbo: false };
    return { ...best.r.data, tab_id: best.tabId };
  }
  function remoteSendStatus() {
    const payload = remoteCurrentStatusPayload();
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
      remoteWs.send(JSON.stringify({ type: "status", data: payload }));
    }
  }
  function remoteWithTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
    ]);
  }
  async function remoteSetAutoTranslateFlag(tabId) {
    try {
      await remoteWithTimeout(
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            try {
              sessionStorage.setItem("lanovel_auto_translate_next", "1");
            } catch (e) {
            }
          }
        }),
        3e3
      );
    } catch (e) {
      console.warn("[remote] \uC790\uB3D9 \uBC88\uC5ED \uD50C\uB798\uADF8 \uC124\uC815 \uC2E4\uD328(\uBB34\uC2DC):", e.message);
    }
  }
  async function remoteExecute(cmd) {
    const tabId = remoteTargetTabId ?? (remotePickTarget() || {}).tabId;
    if (cmd.type === "goto" && cmd.params && cmd.params.queue_session) {
      return remoteQueueGoto(cmd, tabId ?? null);
    }
    if (tabId == null) return { ok: false, message: "\uC870\uC885\uD560 \uBC88\uC5ED \uD0ED\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." };
    if (cmd.type === "reload") {
      await remoteSetAutoTranslateFlag(tabId);
      await chrome.tabs.reload(tabId);
      return { ok: true, message: "\uBC88\uC5ED \uD0ED\uC744 \uC0C8\uB85C\uACE0\uCE68\uD588\uC2B5\uB2C8\uB2E4." };
    }
    if (cmd.type === "goto") {
      const url = cmd.params && cmd.params.url;
      if (!url || !/^https?:\/\//.test(url)) return { ok: false, message: "\uC62C\uBC14\uB974\uC9C0 \uC54A\uC740 URL" };
      await remoteSetAutoTranslateFlag(tabId);
      await setQueueSession(tabId, null);
      await chrome.tabs.update(tabId, { url });
      return { ok: true, message: `\uC774\uB3D9: ${url}` };
    }
    try {
      const res = await remoteWithTimeout(
        chrome.tabs.sendMessage(tabId, { action: "remoteCommand", type: cmd.type, params: cmd.params || {} }),
        REMOTE_CONTENT_TIMEOUT_MS
      );
      return res || { ok: false, message: "\uD0ED\uC5D0\uC11C \uC751\uB2F5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." };
    } catch (e) {
      return { ok: false, message: `\uD0ED\uC774 \uC751\uB2F5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4 (${e.message}). \uC0C8\uB85C\uACE0\uCE68\uC744 \uC2DC\uB3C4\uD574 \uBCF4\uC138\uC694.` };
    }
  }
  async function sendQueueEvent(data) {
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
      remoteWs.send(JSON.stringify({ type: "queue_event", data }));
      return true;
    }
    try {
      const res = await remoteFetch("/queue/event", { method: "POST", body: JSON.stringify(data) });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
  function handleQueueEventFromTab(data, tabId) {
    if (tabId != null && (data.kind === "novel_finished" || data.kind === "page_problem")) {
      void setQueueSession(tabId, null);
    }
    void enqueueQueueEvent(data).then(() => flushQueueOutbox(sendQueueEvent));
  }
  async function remoteAck(id, result) {
    if (!id) return;
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
      remoteWs.send(JSON.stringify({ type: "ack", id, ok: !!result.ok, message: result.message || "" }));
      return;
    }
    try {
      await remoteFetch("/ack", { method: "POST", body: JSON.stringify({ id, ok: !!result.ok, message: result.message || "" }) });
    } catch (e) {
    }
  }
  async function remoteHandleCommands(commands) {
    for (const cmd of commands || []) {
      let result;
      try {
        result = await remoteExecute(cmd);
      } catch (e) {
        result = { ok: false, message: String(e && e.message || e) };
      }
      await remoteAck(cmd.id, result);
    }
  }
  function remoteStartPolling() {
    if (remotePollTimer) return;
    const tick = async () => {
      try {
        const payload = remoteCurrentStatusPayload();
        await remoteFetch("/report", { method: "POST", body: JSON.stringify(payload) });
        const res = await remoteFetch("/poll");
        if (res.ok) {
          const json = await res.json();
          saveRemoteConfig(json.config);
          void flushQueueOutbox(sendQueueEvent);
          await remoteHandleCommands(json.commands);
        }
      } catch (e) {
      }
    };
    tick();
    remotePollTimer = setInterval(tick, REMOTE_POLL_INTERVAL_MS);
  }
  function remoteStopPolling() {
    if (remotePollTimer) {
      clearInterval(remotePollTimer);
      remotePollTimer = null;
    }
  }
  function remoteScheduleReconnect() {
    if (remoteRetryTimer) return;
    remoteRetryTimer = setTimeout(() => {
      remoteRetryTimer = null;
      remoteConnect();
    }, REMOTE_WS_RETRY_MS);
  }
  async function remoteConnect() {
    if (remoteConnecting) return;
    if (remoteWs && (remoteWs.readyState === WebSocket.OPEN || remoteWs.readyState === WebSocket.CONNECTING)) return;
    remoteConnecting = true;
    try {
      const ws = new WebSocket(`${REMOTE_BASE_WS}/api/remote/ws`);
      remoteWs = ws;
      ws.onopen = () => {
        remoteStopPolling();
        remoteSendStatus();
        if (remotePingTimer) clearInterval(remotePingTimer);
        remotePingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
            remoteSendStatus();
          }
        }, REMOTE_PING_INTERVAL_MS);
        console.log("[LANOVEL Remote] WebSocket connected to server.");
        void flushQueueOutbox(sendQueueEvent);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "config") {
            saveRemoteConfig(msg.config);
          } else if (msg.type === "commands") {
            remoteHandleCommands(msg.commands);
          }
        } catch (e) {
          console.warn("[remote] \uC798\uBABB\uB41C WS \uBA54\uC2DC\uC9C0", e);
        }
      };
      ws.onclose = () => {
        if (remotePingTimer) {
          clearInterval(remotePingTimer);
          remotePingTimer = null;
        }
        if (remoteWs === ws) remoteWs = null;
        remoteStartPolling();
        remoteScheduleReconnect();
      };
      ws.onerror = () => {
      };
    } finally {
      remoteConnecting = false;
    }
  }
  function initRemoteControl() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === "remoteQueueSession") {
        const tid = sender.tab && sender.tab.id != null ? sender.tab.id : null;
        getQueueSession(tid).then((session) => sendResponse({ session }));
        return true;
      }
      if (request && request.action === "remoteQueueEvent" && request.data) {
        handleQueueEventFromTab(request.data, sender.tab && sender.tab.id != null ? sender.tab.id : null);
        return false;
      }
      if (request && request.action === "remoteStatus" && sender.tab && sender.tab.id != null) {
        const now = Date.now();
        const prev = remoteReports.get(sender.tab.id);
        const activePhases = ["translating", "censor_split", "delay_wait"];
        const isActive = activePhases.includes(request.data.phase);
        remoteReports.set(sender.tab.id, {
          data: request.data,
          at: now,
          activeAt: isActive ? now : prev ? prev.activeAt : 0
        });
        remoteSendStatus();
      }
      return false;
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      void setQueueSession(tabId, null);
      if (remoteReports.delete(tabId)) {
        remoteSendStatus();
      }
    });
    chrome.alarms.create("remote-keepalive", { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "remote-keepalive") {
        remoteConnect();
      }
    });
    remoteConnect();
  }

  // src/background/index.ts
  initRemoteControl();
  async function migrateQuotes() {
    const migrationStatus = await chrome.storage.local.get("quote_migration_v2");
    if (migrationStatus.quote_migration_v2) {
      return;
    }
    const allData = await chrome.storage.local.get(null);
    let updatedCount = 0;
    const urlsUpdated = /* @__PURE__ */ new Set();
    for (const key in allData) {
      if (key.startsWith("status-") || key === "apiKey" || key === "error_log" || key === "excluded_sentences" || key.startsWith("quote_migration_")) {
        continue;
      }
      const translations = allData[key];
      if (Array.isArray(translations)) {
        let wasUpdated = false;
        const updatedTranslations = translations.map((t) => {
          if (t.original && t.translated && t.translated.startsWith('"') && t.translated.endsWith('"')) {
            const innerText = t.translated.substring(1, t.translated.length - 1);
            if (t.original.includes("\u300C") && t.original.includes("\u300D")) {
              t.translated = `\u300C${innerText}\u300D`;
              updatedCount++;
              wasUpdated = true;
            } else if (t.original.includes("\u300E") && t.original.includes("\u300F")) {
              t.translated = `\u300E${innerText}\u300F`;
              updatedCount++;
              wasUpdated = true;
            }
          }
          return t;
        });
        if (wasUpdated) {
          await chrome.storage.local.set({ [key]: updatedTranslations });
          urlsUpdated.add(key);
        }
      }
    }
    if (updatedCount > 0) {
      console.log(`Quote migration v2 complete. Updated ${updatedCount} translations across ${urlsUpdated.size} URLs.`);
    } else {
      console.log("No translations found that required quote migration v2.");
    }
    await chrome.storage.local.set({ quote_migration_v2: true });
  }
  migrateQuotes();
  chrome.permissions.getAll((permissions) => {
    console.log("Permissions granted to the extension:", permissions);
  });
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.contextMenus) {
      chrome.contextMenus.create({
        id: "translateJapanese",
        title: "\uC77C\uBCF8\uC5B4 \uBC88\uC5ED\uD558\uAE30",
        contexts: ["selection"]
      });
    } else {
      console.warn("Context Menus API is not available.");
    }
  });
  if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info) => {
      switch (info.menuItemId) {
        case "translateJapanese":
          break;
      }
    });
  }
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const channelClosedMessage = "The message channel closed before a response was received.";
    if (request.action === "batchTranslate") {
      (async () => {
        try {
          const rawUrl = sender.tab?.url || "";
          const cleanTabUrl = rawUrl.split("#")[0].trim();
          const result = await handleBatchTranslate(
            request.items,
            cleanTabUrl,
            request.isRetranslation || false,
            request.model || null
          );
          try {
            sendResponse({
              translations: result.translations,
              recommended_turbo_delay_ms: result.recommended_turbo_delay_ms
            });
          } catch (e) {
            if (e.message && e.message.includes(channelClosedMessage)) {
              console.log("Failed to send translation success response: Channel was closed by the client.");
            } else {
              console.error("Error sending translation success response:", e);
            }
          }
        } catch (error) {
          console.error("Error in background script, sending error response:", error.message);
          try {
            if (error.status === 429) {
              sendResponse({
                notification: "API \uC694\uCCAD \uD55C\uB3C4\uB97C \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4. \uBC88\uC5ED\uC744 \uC911\uC9C0\uD569\uB2C8\uB2E4.",
                stop: true
              });
            } else if (error.status === 503 && (error.message.includes("\uCD08\uAE30\uD654 \uC2DC\uAC04") || error.message.includes("\uC790\uB3D9 \uBC88\uC5ED\uC744 \uC911\uC9C0"))) {
              sendResponse({
                notification: error.message,
                stop: true,
                isQuotaResetStop: true
              });
            } else if (error.message && (error.message.includes("Failed to fetch") || error.message.includes("NetworkError") || error.message.includes("network error"))) {
              sendResponse({
                notification: "\u274C PC \uBC88\uC5ED \uC11C\uBC84(http://127.0.0.1:8001)\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. main.py(\uC11C\uBC84)\uAC00 \uC2E4\uD589 \uC911\uC778\uC9C0 \uD655\uC778\uD574\uC8FC\uC138\uC694.",
                stop: true,
                isServerOffline: true
              });
            } else {
              sendResponse({ error: error.message, status: error.status });
            }
          } catch (e) {
            if (e.message && e.message.includes(channelClosedMessage)) {
              console.log("Failed to send error response: Channel was closed by the client.");
            } else {
              console.error("Error sending error response:", e);
            }
          }
        }
      })();
      return true;
    } else if (request.action === "fetchTitle") {
      (async () => {
        try {
          const title = await fetchPageTitle(request.url);
          try {
            sendResponse({ title });
          } catch (e) {
            if (e.message && e.message.includes(channelClosedMessage)) {
              console.log("Failed to send title success response: Channel was closed by the client.");
            } else {
              console.error("Error sending title success response:", e);
            }
          }
        } catch (error) {
          saveErrorLog([], error, request.url);
          try {
            sendResponse({ title: request.url, error: error.message });
          } catch (e) {
            if (e.message && e.message.includes(channelClosedMessage)) {
              console.log("Failed to send title error response: Channel was closed by the client.");
            } else {
              console.error("Error sending title error response:", e);
            }
          }
        }
      })();
      return true;
    } else if (request.action === "upsertTranslations") {
      (async () => {
        try {
          const response = await fetch("http://127.0.0.1:8001/translations/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.records)
          });
          if (!response.ok) {
            const errData = await response.json().catch(() => ({ detail: `Server error: ${response.status}` }));
            throw new Error(errData.detail || `Server returned status ${response.status}`);
          }
          const data = await response.json();
          sendResponse({ success: true, data });
        } catch (error) {
          console.error("Error in background upsertTranslations:", error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    } else if (request.action === "serverFetch") {
      (async () => {
        try {
          const rawUrl = request.url;
          const targetUrl = rawUrl.startsWith("http") ? rawUrl : `http://127.0.0.1:8001${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
          const fetchInit = {
            method: request.options && request.options.method || "GET"
          };
          const headers = Object.assign({}, request.options && request.options.headers || {});
          if (request.options && request.options.body !== void 0 && request.options.body !== null) {
            if (typeof request.options.body === "string") {
              fetchInit.body = request.options.body;
            } else {
              fetchInit.body = JSON.stringify(request.options.body);
              if (!headers["Content-Type"] && !headers["content-type"]) {
                headers["Content-Type"] = "application/json";
              }
            }
          }
          fetchInit.headers = headers;
          const response = await fetch(targetUrl, fetchInit);
          const text = await response.text();
          let data = null;
          try {
            data = JSON.parse(text);
          } catch (_) {
          }
          sendResponse({
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            data,
            text
          });
        } catch (error) {
          console.error("[serverFetch] Background fetch error:", error);
          sendResponse({
            ok: false,
            status: 0,
            statusText: error.message || "Network error",
            error: error.message || "Network error",
            data: null,
            text: ""
          });
        }
      })();
      return true;
    }
    return false;
  });
  async function fetchPageTitle(url) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
      }
      const text = await response.text();
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      return titleMatch ? titleMatch[1].trim() : url;
    } catch (e) {
      console.error(`Failed to fetch title for ${url}:`, e);
      throw new Error(`\uC81C\uBAA9 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328: ${e.message}`);
    }
  }
  async function handleBatchTranslate(items, sourceUrl, isRetranslation = false, model = null) {
    try {
      const cleanSourceUrl = (sourceUrl || "").split("#")[0].trim();
      const bodyPayload = { items, url: cleanSourceUrl };
      if (isRetranslation) {
        bodyPayload.is_retranslation = true;
      }
      if (model) {
        bodyPayload.model = model;
      }
      const response = await fetch("http://127.0.0.1:8001/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload)
      });
      if (!response.ok) {
        if (response.status === 429) {
          const apiLimitError = new Error("API rate limit exceeded.");
          apiLimitError.status = 429;
          throw apiLimitError;
        }
        const errorData = await response.json().catch(() => ({ detail: `Server error: ${response.status}` }));
        const customError = new Error(errorData.detail || `Server error: ${response.status}`);
        customError.status = response.status;
        throw customError;
      }
      const data = await response.json();
      if (!data.translations || data.translations.length !== items.length) {
        console.error("Mismatched response length from server", data);
        throw new Error("Received invalid translation data from server.");
      }
      return {
        translations: data.translations,
        recommended_turbo_delay_ms: data.recommended_turbo_delay_ms || 2e3
      };
    } catch (error) {
      console.error("Translation request to local server failed:", error);
      throw error;
    }
  }
  async function saveErrorLog(items, error, url) {
    const logEntry = {
      timestamp: Date.now(),
      reason: error.message || "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958",
      url: url || "\uC54C \uC218 \uC5C6\uB294 URL",
      texts: items.map((item) => item.text),
      stack: error.stack || null
    };
    try {
      const result = await chrome.storage.local.get("error_log");
      const existingLogs = result.error_log || [];
      existingLogs.unshift(logEntry);
      if (existingLogs.length > 20) {
        existingLogs.length = 20;
      }
      await chrome.storage.local.set({ error_log: existingLogs });
      console.log("\uC624\uB958 \uB85C\uADF8\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
    } catch (e) {
      console.error("\uC624\uB958 \uB85C\uADF8 \uC800\uC7A5 \uC2E4\uD328:", e);
    }
  }
})();
//# sourceMappingURL=background.js.map
