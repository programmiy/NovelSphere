"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/core/separators.ts
  var separators_exports = {};
  __export(separators_exports, {
    DEFAULT_GLOBAL_SEPARATORS: () => DEFAULT_GLOBAL_SEPARATORS,
    PRESET_SEPARATORS: () => PRESET_SEPARATORS,
    analyzeSeparatorSections: () => analyzeSeparatorSections,
    checkSeparatorMatch: () => checkSeparatorMatch,
    loadNovelSeparators: () => loadNovelSeparators,
    resetNovelSeparators: () => resetNovelSeparators,
    saveNovelSeparators: () => saveNovelSeparators
  });
  function checkSeparatorMatch(text, separators) {
    if (!text || !separators || separators.length === 0) return null;
    for (const sep of separators) {
      if (!sep) continue;
      if (sep === "\u2014 (em-dash)" || sep === "^[\\s\u2014]+$") {
        if (/^[\s—]+$/.test(text)) return sep;
      } else if (text.includes(sep)) {
        return sep;
      }
    }
    return null;
  }
  function analyzeSeparatorSections(validParagraphs, separators) {
    const result = {
      prefacePids: /* @__PURE__ */ new Set(),
      afterwordPids: /* @__PURE__ */ new Set(),
      separatorPids: /* @__PURE__ */ new Set(),
      excludedPidMap: /* @__PURE__ */ new Map(),
      topSeparator: null,
      bottomSeparator: null
    };
    if (!validParagraphs || validParagraphs.length === 0 || !separators || separators.length === 0) {
      return result;
    }
    const N = validParagraphs.length;
    const separatorHits = [];
    for (let i = 0; i < N; i++) {
      const item = validParagraphs[i];
      const matchedSep = checkSeparatorMatch(item.text, separators);
      if (matchedSep) {
        separatorHits.push({ index: i, item, sep: matchedSep });
      }
    }
    if (separatorHits.length === 0) {
      return result;
    }
    const firstHit = separatorHits[0];
    const firstIndex = firstHit.index;
    const maxPrefaceCount = Math.max(5, Math.min(15, Math.floor(N * 0.2)));
    const remainingAfterFirst = N - 1 - firstIndex;
    const isTopSeparator = firstIndex <= maxPrefaceCount && remainingAfterFirst >= 5 && remainingAfterFirst > firstIndex;
    if (isTopSeparator) {
      result.topSeparator = { index: firstIndex, sep: firstHit.sep, pid: firstHit.item.pid };
      result.separatorPids.add(firstHit.item.pid);
      for (let i = 0; i < firstIndex; i++) {
        const pItem = validParagraphs[i];
        result.prefacePids.add(pItem.pid);
        result.excludedPidMap.set(pItem.pid, {
          matchedSep: firstHit.sep,
          isSubsequent: false,
          isPreface: true
        });
      }
      result.excludedPidMap.set(firstHit.item.pid, {
        matchedSep: firstHit.sep,
        isSubsequent: false,
        isPreface: false
      });
      const remainingHits = separatorHits.slice(1);
      if (remainingHits.length > 0) {
        const lastHit = remainingHits[remainingHits.length - 1];
        const lastIndex = lastHit.index;
        if (lastIndex > firstIndex) {
          result.bottomSeparator = { index: lastIndex, sep: lastHit.sep, pid: lastHit.item.pid };
          result.separatorPids.add(lastHit.item.pid);
          result.excludedPidMap.set(lastHit.item.pid, {
            matchedSep: lastHit.sep,
            isSubsequent: false,
            isPreface: false
          });
          for (let j = lastIndex + 1; j < N; j++) {
            const nextItem = validParagraphs[j];
            result.afterwordPids.add(nextItem.pid);
            result.excludedPidMap.set(nextItem.pid, {
              matchedSep: lastHit.sep,
              isSubsequent: true,
              isPreface: false
            });
          }
        }
      }
    } else {
      const lastIndex = firstHit.index;
      result.bottomSeparator = { index: lastIndex, sep: firstHit.sep, pid: firstHit.item.pid };
      result.separatorPids.add(firstHit.item.pid);
      result.excludedPidMap.set(firstHit.item.pid, {
        matchedSep: firstHit.sep,
        isSubsequent: false,
        isPreface: false
      });
      if (lastIndex > 0) {
        for (let j = lastIndex + 1; j < N; j++) {
          const nextItem = validParagraphs[j];
          result.afterwordPids.add(nextItem.pid);
          result.excludedPidMap.set(nextItem.pid, {
            matchedSep: firstHit.sep,
            isSubsequent: true,
            isPreface: false
          });
        }
      }
    }
    return result;
  }
  async function loadNovelSeparators(novelTitle) {
    const title = novelTitle || "\uAE30\uBCF8 \uC18C\uC124";
    try {
      const resp = await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(title)}`);
      if (resp.ok) {
        const data = await resp.json();
        const config = {
          useDefaults: data.use_defaults,
          customSeparators: data.custom_separators || [],
          effectiveSeparators: data.effective_separators || []
        };
        const cacheKey = `separators_${title}`;
        chrome.storage.local.set({ [cacheKey]: config });
        return config;
      }
    } catch (e) {
      console.warn("[loadNovelSeparators] Server request failed, falling back to local storage:", e);
    }
    try {
      const cacheKey = `separators_${title}`;
      const stored = await chrome.storage.local.get(cacheKey);
      if (stored[cacheKey]) {
        return stored[cacheKey];
      }
    } catch (e) {
      console.error("[loadNovelSeparators] Local storage get failed:", e);
    }
    return {
      useDefaults: true,
      customSeparators: [],
      effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
    };
  }
  async function saveNovelSeparators(novelTitle, customSeparators, useDefaults) {
    const payload = {
      novel_title: novelTitle,
      separators: customSeparators,
      use_defaults: useDefaults
    };
    let effective = [];
    if (useDefaults) {
      effective.push(...DEFAULT_GLOBAL_SEPARATORS);
    }
    for (const s of customSeparators) {
      if (!effective.includes(s)) effective.push(s);
    }
    const config = {
      useDefaults,
      customSeparators,
      effectiveSeparators: effective
    };
    const cacheKey = `separators_${novelTitle}`;
    await chrome.storage.local.set({ [cacheKey]: config });
    try {
      const resp = await fetch("http://127.0.0.1:8001/api/separators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        console.warn("Failed to persist separators to server, stored locally:", resp.status);
      }
    } catch (e) {
      console.warn("[saveNovelSeparators] Server save failed:", e);
    }
    return config;
  }
  async function resetNovelSeparators(novelTitle) {
    try {
      await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(novelTitle)}`, {
        method: "DELETE"
      });
    } catch (e) {
      console.warn("Server delete request failed:", e);
    }
    const cacheKey = `separators_${novelTitle}`;
    try {
      await chrome.storage.local.remove(cacheKey);
    } catch (_) {
    }
    return {
      useDefaults: true,
      customSeparators: [],
      effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
    };
  }
  var DEFAULT_GLOBAL_SEPARATORS, PRESET_SEPARATORS;
  var init_separators = __esm({
    "src/core/separators.ts"() {
      "use strict";
      DEFAULT_GLOBAL_SEPARATORS = [
        "\uFF1C\u3042\u3068\u304C\u304D\uFF1E",
        "&lt;\u3042\u3068\u304C\u304D&gt;",
        "\u3010\u3042\u3068\u304C\u304D\u3011",
        "\uFF1C\u89E3\u8AAC\uFF1E",
        "\u3010\u5927\u4E8B\u306A\u304A\u77E5\u3089\u305B\u3011",
        "\u3010\u5BA3\u4F1D\u3011",
        "\u304A\u8AAD\u307F\u9802\u304D\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\uFF01"
      ];
      PRESET_SEPARATORS = [
        { name: "\u25CE\u25CE\u25CE", sep: "\u25CE\u25CE\u25CE" },
        { name: "----------", sep: "----------" },
        { name: "++", sep: "++" },
        { name: "\u3000\u2606\u2606\u2606\u2606\u2606", sep: "\u3000\u2606\u2606\u2606\u2606\u2606" },
        { name: "\u2015\u2015\u2015\u2015", sep: "\u2015\u2015\u2015\u2015" },
        { name: "***", sep: "***" },
        { name: "\u25C6\u25C7\u25C6\u25C7", sep: "\u25C6\u25C7\u25C6\u25C7" },
        { name: "\u25C7\u25C6\u25C7\u25C6", sep: "\u25C7\u25C6\u25C7\u25C6" },
        { name: "\uFF0A\uFF0A\uFF0A", sep: "\uFF0A\uFF0A\uFF0A" }
      ];
    }
  });

  // src/core/state.ts
  var ExtensionState, state;
  var init_state = __esm({
    "src/core/state.ts"() {
      "use strict";
      init_separators();
      ExtensionState = class {
        // 번역 수명주기 상태
        hasScannedForPTags = false;
        isTranslationCancelled = false;
        resolveResume = null;
        translationCache = /* @__PURE__ */ new Map();
        exclusionSet = /* @__PURE__ */ new Set();
        isPageApplied = false;
        translationsLoadedPromise = null;
        userDeletedTranslationPids = /* @__PURE__ */ new Set();
        // 소설 및 구분선 상태
        currentNovelTitle = "";
        activeSeparators = [...DEFAULT_GLOBAL_SEPARATORS];
        separatorConfig = {
          useDefaults: true,
          customSeparators: [],
          effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
        };
        separatorExcludedItems = [];
        // 알림 센터 검수 상태
        reviewTargetsData = null;
        reviewTargetPids = /* @__PURE__ */ new Set();
        isReviewSession = false;
        // ⚡ 쾌속모드 상태
        isTurboMode = false;
        turboCutoffHour = null;
        turboTargetTimestamp = 0;
        turboAbortedOnLoad = false;
        currentDelayResolver = null;
        currentDelayStart = 0;
        // 원격 제어 및 관찰 상태
        inflight = 0;
        remoteNextPending = false;
        nextDeadlineTimer = null;
        lastLogText = "";
        censorSplitUntil = 0;
        retryDelayUntil = 0;
        activeDelayFn = null;
        // 원격 제어 핸들러 주입
        onNextEpisode = null;
        onPrevEpisode = null;
        onRetranslate = null;
        onResumeTranslation = null;
        onStartTranslation = null;
        onToggleTurboMode = null;
        onExtractEpisodeTitle = null;
        reportIntervalTimer = null;
        constructor() {
          this.startStatusReporting();
        }
        isReviewMode() {
          const hasHash = typeof window !== "undefined" && window.location && window.location.hash.includes("lanovel_review");
          return this.isReviewSession || hasHash || Boolean(this.reviewTargetPids && this.reviewTargetPids.size > 0);
        }
        recordLog(message) {
          const text = String(message || "");
          this.lastLogText = text.slice(0, 120);
          if (text.includes("\uBB38\uC7A5 \uBD84\uD560 \uC7AC\uC2DC\uB3C4") || text.includes("\uAC80\uC5F4 \uAC10\uC9C0")) {
            this.censorSplitUntil = Date.now() + 2e4;
          }
          const m = text.match(/(\d+)초 후 재시도/);
          if (m) {
            this.retryDelayUntil = Date.now() + parseInt(m[1], 10) * 1e3;
          }
          this.broadcastStatus();
        }
        notifyInflightStart() {
          this.inflight++;
          this.broadcastStatus();
        }
        notifyInflightEnd() {
          this.inflight = Math.max(0, this.inflight - 1);
          this.broadcastStatus();
        }
        computeProgress() {
          const rows = document.querySelectorAll("#translation-table-body tr[data-pid]");
          if (!rows.length) return 0;
          let done = 0;
          rows.forEach((tr) => {
            const cell = tr.querySelector(".translated-text");
            const t = cell ? (cell.textContent || "").trim() : "";
            if (t && !t.includes("\uBC88\uC5ED \uC911") && !t.includes("\uC7AC\uBC88\uC5ED \uC911")) done++;
          });
          return Math.round(done / rows.length * 100);
        }
        delayRemainingSec() {
          let remaining = 0;
          try {
            if (this.currentDelayResolver && this.activeDelayFn) {
              const target = typeof this.activeDelayFn === "function" ? this.activeDelayFn() : this.activeDelayFn;
              remaining = Math.max(remaining, target - (Date.now() - this.currentDelayStart));
            }
          } catch (e) {
          }
          remaining = Math.max(remaining, this.retryDelayUntil - Date.now());
          return Math.max(0, Math.ceil(remaining / 1e3));
        }
        buildStatusPayload() {
          const cancelled = this.isTranslationCancelled;
          const turboAborted = this.turboAbortedOnLoad;
          const delaySec = this.delayRemainingSec();
          let phase = "idle";
          if (turboAborted) phase = "turbo_wait";
          else if (cancelled) phase = "paused";
          else if (Date.now() < this.censorSplitUntil && this.inflight > 0) phase = "censor_split";
          else if (delaySec > 0) phase = "delay_wait";
          else if (this.inflight > 0) phase = "translating";
          let chapterTitle = "";
          try {
            chapterTitle = this.onExtractEpisodeTitle && this.onExtractEpisodeTitle() || document.title || "";
          } catch (e) {
            chapterTitle = document.title || "";
          }
          return {
            phase,
            text: this.lastLogText,
            url: window.location.href.split("#")[0],
            book_title: this.currentNovelTitle || "",
            chapter_title: chapterTitle,
            percentage: this.computeProgress(),
            delay_remaining_sec: phase === "delay_wait" ? delaySec : 0,
            next_scheduled: this.remoteNextPending,
            turbo: this.isTurboMode
          };
        }
        broadcastStatus() {
          if (!document.getElementById("jp-translator-sidebar")) return;
          try {
            const payload = this.buildStatusPayload();
            chrome.runtime.sendMessage({ action: "remoteStatus", data: payload }, () => {
              void chrome.runtime.lastError;
            });
          } catch (e) {
          }
        }
        startStatusReporting() {
          if (typeof document === "undefined") return;
          if (this.reportIntervalTimer) clearInterval(this.reportIntervalTimer);
          this.reportIntervalTimer = setInterval(() => {
            this.broadcastStatus();
          }, 2e3);
          if (this.reportIntervalTimer && typeof this.reportIntervalTimer.unref === "function") {
            this.reportIntervalTimer.unref();
          }
        }
        handleRemoteCommand(type, _params = {}) {
          const sidebar = document.getElementById("jp-translator-sidebar");
          if (!sidebar) return { ok: false, message: "\uC774 \uD0ED\uC740 \uBC88\uC5ED \uD398\uC774\uC9C0\uAC00 \uC544\uB2D9\uB2C8\uB2E4." };
          switch (type) {
            case "next":
              if (this.inflight > 0) {
                this.remoteNextPending = true;
                return { ok: true, message: "\uD604\uC7AC \uD654 \uBC88\uC5ED\uC774 \uB05D\uB098\uBA74 \uB2E4\uC74C \uD654\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4." };
              }
              if (this.isTranslationCancelled) {
                this.remoteNextPending = true;
                return { ok: true, message: "\uC77C\uC2DC\uC815\uC9C0 \uC0C1\uD0DC\uC785\uB2C8\uB2E4. \uC7AC\uAC1C \uD6C4 \uBC88\uC5ED\uC774 \uB05D\uB098\uBA74 \uC774\uB3D9\uD569\uB2C8\uB2E4." };
              }
              if (this.onNextEpisode) return this.onNextEpisode();
              return { ok: false, message: "\uB2E4\uC74C \uD654 \uC774\uB3D9 \uD578\uB4E4\uB7EC\uAC00 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." };
            case "cancel_next":
              this.remoteNextPending = false;
              if (this.nextDeadlineTimer) {
                clearTimeout(this.nextDeadlineTimer);
                this.nextDeadlineTimer = null;
              }
              return { ok: true, message: "\uB2E4\uC74C\uD654 \uC608\uC57D\uC744 \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4." };
            case "prev":
              if (this.onPrevEpisode) return this.onPrevEpisode();
              return { ok: false, message: "\uC774\uC804 \uD654 \uC774\uB3D9 \uD578\uB4E4\uB7EC\uAC00 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." };
            case "pause":
              if (this.isTranslationCancelled) return { ok: true, message: "\uC774\uBBF8 \uC77C\uC2DC\uC815\uC9C0 \uC0C1\uD0DC\uC785\uB2C8\uB2E4." };
              this.isTranslationCancelled = true;
              const stopBtn = document.getElementById("stop-translation-btn");
              if (stopBtn) stopBtn.click();
              this.broadcastStatus();
              return { ok: true, message: "\uC77C\uC2DC\uC815\uC9C0\uD588\uC2B5\uB2C8\uB2E4." };
            case "resume":
              if (this.resolveResume) {
                const resumeBtn = document.getElementById("resume-translation-btn");
                if (resumeBtn) resumeBtn.click();
                this.broadcastStatus();
                return { ok: true, message: "\uBC88\uC5ED\uC744 \uC7AC\uAC1C\uD569\uB2C8\uB2E4." };
              }
              if (this.isTranslationCancelled) {
                this.isTranslationCancelled = false;
                const retryBtn = document.getElementById("retry-translation-btn");
                if (retryBtn) retryBtn.style.display = "none";
                if (this.onStartTranslation) {
                  this.onStartTranslation(false);
                  this.broadcastStatus();
                  return { ok: true, message: "\uB0A8\uC740 \uBB38\uC7A5\uBD80\uD130 \uBC88\uC5ED\uC744 \uB2E4\uC2DC \uC2DC\uC791\uD569\uB2C8\uB2E4." };
                }
              }
              return { ok: true, message: "\uC774\uBBF8 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4." };
            case "turbo_on":
              if (this.onToggleTurboMode) this.onToggleTurboMode(true, true);
              this.broadcastStatus();
              return { ok: true, message: "\uD130\uBCF4 \uBAA8\uB4DC\uB97C \uCF30\uC2B5\uB2C8\uB2E4." };
            case "turbo_off":
              if (this.onToggleTurboMode) this.onToggleTurboMode(false, true);
              this.broadcastStatus();
              return { ok: true, message: "\uD130\uBCF4 \uBAA8\uB4DC\uB97C \uAED0\uC2B5\uB2C8\uB2E4." };
            case "retranslate":
              if (this.onRetranslate) return this.onRetranslate();
              const retryEl = document.getElementById("retry-translation-btn");
              if (retryEl) {
                retryEl.click();
                return { ok: true, message: "\uD604\uC7AC \uD654 \uC804\uCCB4 \uC7AC\uBC88\uC5ED\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4." };
              }
              return { ok: false, message: "\uC7AC\uBC88\uC5ED \uBC84\uD2BC\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
            default:
              return { ok: false, message: `\uC774 \uD0ED\uC5D0\uC11C \uCC98\uB9AC\uD558\uC9C0 \uC54A\uB294 \uBA85\uB839: ${type}` };
          }
        }
      };
      state = new ExtensionState();
    }
  });

  // src/scrapers/kakuyomu.ts
  var KakuyomuScraper;
  var init_kakuyomu = __esm({
    "src/scrapers/kakuyomu.ts"() {
      "use strict";
      KakuyomuScraper = class {
        name = "kakuyomu";
        matches(_url, host) {
          return host.includes("kakuyomu.jp");
        }
        detectNovelTitle() {
          const heading = document.querySelector(
            'h1[class*="WorkHeader"], h1[class*="Title"], .widget-toc-main-title, header h1, h1'
          );
          if (heading && heading.textContent && heading.textContent.trim()) {
            return heading.textContent.trim();
          }
          const workLink = Array.from(document.querySelectorAll('header a[href*="/works/"]')).find((a) => {
            const txt = (a.textContent || "").trim();
            const aria = a.getAttribute("aria-label") || "";
            const href = a.getAttribute("href") || "";
            return txt && !txt.includes("\u9589\u3058\u308B") && !aria.includes("\u9589\u3058\u308B") && !txt.includes("\u76EE\u6B21") && !txt.includes("TOP") && /\/works\/\d+$/.test(href.split("?")[0]);
          }) || document.querySelector('a[href^="/works/"][class*="Title"]') || document.querySelector('header a[class*="workTitle"]');
          if (workLink && workLink.textContent && workLink.textContent.trim()) {
            const candidate = workLink.textContent.trim();
            if (candidate && !candidate.includes("\u9589\u3058\u308B")) {
              return candidate;
            }
          }
          const titleText = document.title.replace(/\s*-\s*カクヨム.*$/i, "").trim();
          const parts = titleText.split(/\s*-\s*/);
          if (parts.length > 1) {
            let novelPart = parts[parts.length - 1].trim();
            novelPart = novelPart.replace(/（[^）]+）$/, "").trim();
            novelPart = novelPart.replace(/\([^)]+\)$/, "").trim();
            if (novelPart && !novelPart.includes("\u9589\u3058\u308B")) return novelPart;
          } else if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
          }
          return null;
        }
        extractEpisodeTitle() {
          const candidates = Array.from(
            document.querySelectorAll(
              '#contentMain-header .widget-episodeTitle, #contentMain-header p, .widget-episodeTitle, [class*="widget-episodeTitle"], h2.widget-episodeTitle, h2[class*="episodeTitle"]'
            )
          );
          for (const el of candidates) {
            if (!el.closest("a") && !el.closest("#contentMain-readPreviousEpisode") && !el.closest("#contentMain-readNextEpisode") && !el.closest('[class*="pager"]') && !el.closest('[class*="episodeNavigation"]')) {
              const txt = (el.textContent || "").trim();
              if (txt) return txt;
            }
          }
          if (document.title) {
            const clean = document.title.replace(/\s*-\s*カクヨム.*$/i, "").trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[0].trim()) {
              return parts[0].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
          }
          return "";
        }
        getWorkKey(url) {
          const match = url.match(/\/works\/(\d+)/);
          return match ? `kakuyomu_${match[1]}` : null;
        }
        isTocPage(_url, path) {
          if (path.includes("/episodes/")) {
            return false;
          }
          if (typeof document !== "undefined") {
            if (document.querySelector('.widget-episodeBody, [class*="Episode_body"], [class*="episodeBody"]')) {
              return false;
            }
            if (document.querySelector(
              '.widget-toc-episode, [class*="WorkTocSection"], [class*="WorkToc"], a[href*="/works/"][href*="/episodes/"]'
            )) {
              return true;
            }
          }
          return /\/works\/\d+\/?$/.test(path);
        }
        findNextEpisodeLink() {
          if (typeof document === "undefined") return null;
          const direct = document.getElementById("contentMain-nextEpisode") || document.querySelector("a.widget-episodeNavigation-next") || document.querySelector("#contentMain-readNextEpisode") || document.querySelector("a.js-read-next-episode") || document.querySelector('a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"]') || document.querySelector('a[class*="nextEpisode"], a[class*="NextEpisode"]');
          if (direct && direct.href) return direct;
          const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
          const found = candidates.find((a) => (a.textContent || "").includes("\u6B21\u306E\u30A8\u30D4\u30BD\u30FC\u30C9") || (a.textContent || "").includes("\u6B21\u3078"));
          if (found && found.href) return found;
          const relNext = document.querySelector('a[rel="next"], link[rel="next"]');
          if (relNext && relNext.href) return relNext;
          return null;
        }
        findPrevEpisodeLink() {
          if (typeof document === "undefined") return null;
          const direct = document.getElementById("contentMain-previousEpisode") || document.querySelector("a.widget-episodeNavigation-previous") || document.querySelector('a[class*="previousEpisode"], a[class*="PreviousEpisode"]');
          if (direct && direct.href) return direct;
          const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
          const found = candidates.find((a) => (a.textContent || "").includes("\u524D\u306E\u30A8\u30D4\u30BD\u30FC\u30C9") || (a.textContent || "").includes("\u524D\u3078"));
          if (found && found.href) return found;
          return null;
        }
        findTocLink() {
          if (typeof document === "undefined") return null;
          const links = Array.from(
            document.querySelectorAll(
              'header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"], a[class*="WorkHeader"], a[href*="/works/"]'
            )
          );
          const found = links.find((a) => /\/works\/\d+\/?$/.test((a.getAttribute("href") || "").split("?")[0]));
          return found || null;
        }
        getTocEpisodes(rootDoc = document) {
          const nextDataScript = rootDoc.querySelector("#__NEXT_DATA__");
          if (nextDataScript && nextDataScript.textContent) {
            try {
              const nextData = JSON.parse(nextDataScript.textContent);
              const apollo = nextData?.props?.pageProps?.__APOLLO_STATE__ || nextData?.props?.apolloState || {};
              let workId = nextData?.query?.workId;
              let mainWork = workId ? apollo[`Work:${workId}`] : null;
              if (!mainWork || !mainWork.tableOfContentsV2) {
                for (const key of Object.keys(apollo)) {
                  if (key.startsWith("Work:") && apollo[key]?.tableOfContentsV2) {
                    mainWork = apollo[key];
                    workId = mainWork.id || key.replace("Work:", "");
                    break;
                  }
                }
              }
              if (mainWork && mainWork.tableOfContentsV2 && workId) {
                const episodes = [];
                const toc = mainWork.tableOfContentsV2;
                const domElements = Array.from(
                  rootDoc.querySelectorAll('a[href*="/works/"][href*="/episodes/"]')
                );
                const elementMap = /* @__PURE__ */ new Map();
                domElements.forEach((el) => {
                  const rawHref = el.getAttribute("href") || el.href || "";
                  const clean = rawHref.split("#")[0].split("?")[0];
                  const epMatch = clean.match(/\/episodes\/(\d+)/);
                  if (epMatch) {
                    elementMap.set(epMatch[1], el);
                  }
                });
                if (Array.isArray(toc)) {
                  for (const itemRef of toc) {
                    const refKey = itemRef?.__ref;
                    if (!refKey) continue;
                    const chapterOrEp = apollo[refKey];
                    if (!chapterOrEp) continue;
                    if (chapterOrEp.__typename === "TableOfContentsChapter") {
                      const epUnions = chapterOrEp.episodeUnions || [];
                      for (const epRef of epUnions) {
                        const epKey = epRef?.__ref;
                        if (!epKey) continue;
                        const ep = apollo[epKey];
                        if (ep && ep.id) {
                          const epId = String(ep.id);
                          episodes.push({
                            element: elementMap.get(epId),
                            url: `https://kakuyomu.jp/works/${workId}/episodes/${epId}`,
                            title: ep.title || "\uC81C\uBAA9 \uC5C6\uC74C"
                          });
                        }
                      }
                    } else if (chapterOrEp.__typename === "Episode" && chapterOrEp.id) {
                      const epId = String(chapterOrEp.id);
                      episodes.push({
                        element: elementMap.get(epId),
                        url: `https://kakuyomu.jp/works/${workId}/episodes/${epId}`,
                        title: chapterOrEp.title || "\uC81C\uBAA9 \uC5C6\uC74C"
                      });
                    }
                  }
                }
                if (episodes.length > 0) {
                  return episodes;
                }
              }
            } catch (e) {
              console.warn("[LANOVEL] \uCE74\uCFE0\uC694\uBB34 __NEXT_DATA__ \uD30C\uC2F1 \uC2E4\uD328, DOM \uD3F4\uBC31\uC744 \uC2DC\uB3C4\uD569\uB2C8\uB2E4:", e);
            }
          }
          let elements = Array.from(
            rootDoc.querySelectorAll(
              'a[class*="WorkTocSection_link"], [class*="WorkTocSection"] a, .widget-toc-episode a, a.widget-toc-episode-episodeTitle, [class*="widget-toc-episode"] a'
            )
          );
          if (!elements.length) {
            elements = Array.from(
              rootDoc.querySelectorAll('a[href*="/works/"][href*="/episodes/"]')
            ).filter((a) => {
              const isHeaderButton = a.closest("header") || a.closest(".widget-workCard-actions") || a.closest('[class*="ReadButton"]') || (a.textContent || "").includes("1\u8A71\u76EE\u304B\u3089\u8AAD\u3080");
              return !isHeaderButton && (a.getAttribute("href") || a.href);
            });
          }
          return elements.map((el) => {
            const titleEl = el.querySelector(
              '[class*="WorkTocSection_title"], .widget-toc-episode-episodeTitle, [class*="episodeTitle"]'
            );
            let title = titleEl && titleEl.textContent ? titleEl.textContent.trim() : (el.textContent || "").trim();
            title = title.replace(/\s*\d{4}年\d{1,2}月\d{1,2}日.*$/, "").trim();
            const rawHref = el.getAttribute("href") || el.href || "";
            const fullUrl = rawHref.startsWith("http") ? rawHref : `https://kakuyomu.jp${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;
            return {
              element: el,
              url: fullUrl.split("#")[0],
              title: title || "\uC81C\uBAA9 \uC5C6\uC74C"
            };
          });
        }
      };
    }
  });

  // src/scrapers/syosetu.ts
  var SyosetuScraper;
  var init_syosetu = __esm({
    "src/scrapers/syosetu.ts"() {
      "use strict";
      SyosetuScraper = class {
        name = "syosetu";
        matches(_url, host) {
          return host.includes("syosetu.com");
        }
        detectNovelTitle() {
          const novelLink = document.querySelector('.c-announce a[href*="/n"]') || document.querySelector(".p-novel__series-link") || document.querySelector(".novel_title") || document.querySelector("a.margin_r20");
          if (novelLink && novelLink.textContent && novelLink.textContent.trim()) {
            return novelLink.textContent.trim();
          }
          const parts = document.title.split(/\s*-\s*/);
          if (parts.length > 1) {
            return parts[parts.length - 1].trim();
          } else if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
          }
          return null;
        }
        extractEpisodeTitle() {
          const epEl = document.querySelector('.p-novel__title, .novel_subtitle, [class*="novel__title"]');
          if (epEl && !epEl.closest("a") && epEl.textContent && epEl.textContent.trim()) {
            return epEl.textContent.trim();
          }
          if (document.title) {
            const clean = document.title.replace(/\s*-\s*(小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ).*$/i, "").trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[parts.length - 1].trim()) {
              return parts[parts.length - 1].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
          }
          return "";
        }
        getWorkKey(url) {
          const match = url.match(/\/(n\d+[a-z]+)(\/|$)/i);
          return match ? `syosetu_${match[1].toLowerCase()}` : null;
        }
        isTocPage(_url, path) {
          if (document.querySelector(".p-novel__body, #novel_honbun, .p-novel__text")) {
            return false;
          }
          return /\/n[a-z0-9]+\/?$/i.test(path) && !/\/\d+\/?$/.test(path) || !!document.querySelector(".p-eplist, .index_box");
        }
        findNextEpisodeLink() {
          const direct = document.querySelector(".c-pager__item--next") || document.querySelector("a.novel_bn_next") || document.querySelector(".novel_bn a.c-pager__item--next") || document.querySelector("a.c-pager__item.c-pager__item--next") || document.querySelector("a.novelview_pager-next");
          if (direct && direct.href) return direct;
          const links = Array.from(document.querySelectorAll(".novel_bn a, .c-pager a, a.c-pager__item"));
          const found = links.find((a) => (a.textContent || "").includes("\u6B21\u3078"));
          return found || null;
        }
        findPrevEpisodeLink() {
          const direct = document.querySelector(".c-pager__item--before") || document.querySelector("a.novel_bn_prev");
          if (direct && direct.href) return direct;
          const links = Array.from(document.querySelectorAll(".novel_bn a, .c-pager a, a.c-pager__item"));
          const found = links.find((a) => (a.textContent || "").includes("\u524D\u3078"));
          return found || null;
        }
        findTocLink() {
          const direct = document.querySelector('.c-announce a[href*="/n"]') || document.querySelector(".p-novel__series-link a") || document.querySelector("a.p-novel__series-link") || document.querySelector(".novel_title a");
          return direct && direct.href ? direct : null;
        }
        getTocEpisodes(rootDoc = document) {
          const elements = Array.from(
            rootDoc.querySelectorAll(
              "a.p-eplist__subtitle, .p-eplist a.p-eplist__subtitle, .p-eplist__sublist a, .p-eplist a, .index_box .subtitle a, .subtitle a"
            )
          ).filter((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            const cleanHref = rawHref.split("#")[0].split("?")[0];
            return /\/\d+\/?$/.test(cleanHref);
          });
          return elements.map((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            return {
              element: el,
              url: rawHref.split("#")[0],
              title: (el.textContent || "").trim()
            };
          });
        }
      };
    }
  });

  // src/scrapers/novelup.ts
  var NovelUpScraper;
  var init_novelup = __esm({
    "src/scrapers/novelup.ts"() {
      "use strict";
      NovelUpScraper = class {
        name = "novelup";
        matches(_url, host) {
          return host.includes("novelup.plus");
        }
        detectNovelTitle() {
          const novelTitleEl = document.querySelector(".episodeHeader .storyTitle") || document.querySelector(".storyTitle") || document.querySelector(".story_title");
          if (novelTitleEl && novelTitleEl.textContent && novelTitleEl.textContent.trim()) {
            return novelTitleEl.textContent.trim();
          }
          const titleText = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, "").trim();
          const parts = titleText.split(/\s*-\s*/);
          if (parts.length > 0 && parts[0].trim()) {
            let novelPart = parts[0].trim();
            novelPart = novelPart.replace(/（[^）]+）$/, "").trim();
            novelPart = novelPart.replace(/\([^)]+\)$/, "").trim();
            if (novelPart) return novelPart;
          }
          return null;
        }
        extractEpisodeTitle() {
          const epEl = document.querySelector(".episode_title, #section_episode .episode_title, h1");
          if (epEl && !epEl.closest("a") && epEl.textContent && epEl.textContent.trim()) {
            return epEl.textContent.trim();
          }
          if (document.title) {
            const clean = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, "").trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[parts.length - 1].trim()) {
              return parts[parts.length - 1].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
          }
          return "";
        }
        getWorkKey(url) {
          const match = url.match(/\/story\/(\d+)/);
          return match ? `novelup_${match[1]}` : null;
        }
        isTocPage(_url, path) {
          if (document.getElementById("episode_content")) {
            return false;
          }
          return /\/story\/\d+\/?$/.test(path) && !/\/\d+\/\d+/.test(path) || !!document.querySelector("#section_episode, .episodeListItem, a.episodeTitle, .storyList");
        }
        findNextEpisodeLink() {
          const direct = document.querySelector(".episodeNavi .nextEpisode a") || document.querySelector(".btn_next") || document.querySelector(".episode_navigation .next a");
          if (direct && direct.href) return direct;
          const allLinks = Array.from(document.querySelectorAll("a"));
          const contextual = allLinks.find(
            (a) => (a.closest(".episodeHeaderPager") || a.closest("#section_episode") || a.closest(".storyIndexFooter")) && (a.textContent || "").includes("\u6B21\u3078") && a.href && !(a.textContent || "").includes("\u524D\u3078")
          );
          if (contextual) return contextual;
          const storyLink = allLinks.find(
            (a) => (a.textContent || "").includes("\u6B21\u3078") && a.href && a.href.includes("/story/") && !(a.textContent || "").includes("\u524D\u3078")
          );
          return storyLink || null;
        }
        findPrevEpisodeLink() {
          const direct = document.querySelector(".episodeNavi .prevEpisode a") || document.querySelector(".btn_prev") || document.querySelector(".episode_navigation .prev a");
          if (direct && direct.href) return direct;
          const allLinks = Array.from(document.querySelectorAll("a"));
          const contextual = allLinks.find(
            (a) => (a.closest(".episodeHeaderPager") || a.closest("#section_episode") || a.closest(".storyIndexFooter")) && (a.textContent || "").includes("\u524D\u3078") && a.href && !(a.textContent || "").includes("\u6B21\u3078")
          );
          return contextual || null;
        }
        findTocLink() {
          const direct = document.querySelector(".episodeHeader .storyTitle a") || document.querySelector(".storyTitle a") || document.querySelector(".story_title a") || document.querySelector("a.storyTitle");
          if (direct && direct.href) return direct;
          const candidates = Array.from(document.querySelectorAll('a[href*="/story/"]'));
          const found = candidates.find(
            (a) => /\/story\/\d+\/?$/.test((a.getAttribute("href") || "").split("?")[0].split("#")[0])
          );
          return found && found.href ? found : null;
        }
        prepareContent() {
          const epContent = document.getElementById("episode_content");
          if (!epContent || epContent.dataset.lanovelPreprocessed) return;
          if (epContent.tagName.toLowerCase() === "div" && epContent.querySelectorAll("p[id]").length > 0) {
            return;
          }
          const rawHtml = epContent.innerHTML;
          let lines = rawHtml.split(/\r?\n/);
          if (lines.length <= 1 && epContent.querySelectorAll("p").length > 1) {
            epContent.querySelectorAll("p").forEach((p, idx) => {
              if (!p.id) p.id = `L${idx + 1}`;
            });
            epContent.dataset.lanovelPreprocessed = "true";
            return;
          }
          if (lines.length <= 1 && /<br\s*\/?>/i.test(rawHtml)) {
            lines = rawHtml.split(/<br\s*\/?>/i);
          }
          const container = document.createElement("div");
          container.id = "episode_content";
          container.dataset.lanovelPreprocessed = "true";
          container.className = epContent.className;
          if (epContent.getAttribute("style")) {
            container.setAttribute("style", epContent.getAttribute("style") || "");
          }
          lines.forEach((line, index) => {
            const p = document.createElement("p");
            p.id = `L${index + 1}`;
            const trimmed = line.replace(/<[^>]*>/g, "").trim();
            if (!trimmed) {
              p.className = "blank";
              p.innerHTML = "<br>";
            } else {
              p.innerHTML = line;
            }
            container.appendChild(p);
          });
          epContent.replaceWith(container);
          console.log(`[LANOVEL] NovelUp content transformed into ${lines.length} paragraphs for translation.`);
        }
        getTocEpisodes(rootDoc = document) {
          let elements = Array.from(
            rootDoc.querySelectorAll(
              '.episodeListItem a.episodeTitle, #section_episode a.episodeTitle, .episodeListItem a, a.episodeTitle, .storyList .episode a, .episode_list a, .storyList a[href*="/story/"]'
            )
          ).filter((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            const cleanHref = rawHref.split("#")[0].split("?")[0];
            return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
          });
          if (!elements.length) {
            elements = Array.from(rootDoc.querySelectorAll('a[href*="/story/"]')).filter((el) => {
              const rawHref = el.getAttribute("href") || el.href || "";
              const cleanHref = rawHref.split("#")[0].split("?")[0];
              return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
            });
          }
          return elements.map((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            return {
              element: el,
              url: rawHref.split("#")[0],
              title: (el.textContent || "").trim()
            };
          });
        }
      };
    }
  });

  // src/scrapers/hameln.ts
  var HamelnScraper;
  var init_hameln = __esm({
    "src/scrapers/hameln.ts"() {
      "use strict";
      HamelnScraper = class {
        name = "hameln";
        matches(_url, host) {
          return host.includes("syosetu.org");
        }
        detectNovelTitle() {
          const titleLink = document.querySelector('a[href*="/novel/"][style*="font-weight:bold"], span.novel_title a');
          if (titleLink && titleLink.textContent && titleLink.textContent.trim()) {
            return titleLink.textContent.trim();
          }
          const parts = document.title.split(/\s*-\s*/);
          if (parts.length > 1) {
            return parts[parts.length - 1].trim();
          }
          return null;
        }
        extractEpisodeTitle() {
          const epEl = document.querySelector('span[style*="font-size:120%"], h2, .ss');
          if (epEl && !epEl.closest("a") && epEl.textContent && epEl.textContent.trim()) {
            return epEl.textContent.trim();
          }
          const parts = document.title.split(/\s*-\s*/);
          if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
          }
          return "";
        }
        getWorkKey(url) {
          const match = url.match(/\/novel\/(\d+)/);
          return match ? `hameln_${match[1]}` : null;
        }
        isTocPage(_url, path) {
          if (document.getElementById("honbun")) {
            return false;
          }
          return /\/novel\/\d+\/?$/.test(path) || !path.endsWith(".html") && document.querySelectorAll('table a[href*="/novel/"]').length > 3;
        }
        prepareContent() {
          const honbun = document.getElementById("honbun");
          if (!honbun || honbun.dataset.lanovelPreprocessed) return;
          const paragraphs = honbun.querySelectorAll("p");
          if (paragraphs.length > 0) {
            paragraphs.forEach((p, idx) => {
              if (!p.id) {
                p.id = `L${idx + 1}`;
              } else if (/^\d+$/.test(p.id)) {
                p.id = `L${p.id}`;
              }
            });
            honbun.dataset.lanovelPreprocessed = "true";
          }
        }
        findNextEpisodeLink() {
          const links = Array.from(document.querySelectorAll("a"));
          return links.find((a) => (a.textContent || "").trim() === "\u6B21\u3078" && a.href) || null;
        }
        findPrevEpisodeLink() {
          const links = Array.from(document.querySelectorAll("a"));
          return links.find((a) => (a.textContent || "").trim() === "\u524D\u3078" && a.href) || null;
        }
        findTocLink() {
          const links = Array.from(document.querySelectorAll("a"));
          return links.find((a) => {
            const txt = (a.textContent || "").trim();
            return (txt === "\u76EE\u6B21" || txt === "TOP") && a.href;
          }) || null;
        }
        getTocEpisodes(rootDoc = document) {
          const elements = Array.from(rootDoc.querySelectorAll('table a[href*="/novel/"]'));
          return elements.map((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            return {
              element: el,
              url: rawHref.split("#")[0],
              title: (el.textContent || "").trim()
            };
          });
        }
      };
    }
  });

  // src/scrapers/alphapolis.ts
  var AlphapolisScraper;
  var init_alphapolis = __esm({
    "src/scrapers/alphapolis.ts"() {
      "use strict";
      AlphapolisScraper = class {
        name = "alphapolis";
        matches(_url, host) {
          return host.includes("alphapolis.co.jp");
        }
        detectNovelTitle() {
          const titleEl = document.querySelector(".title a, .novel-title, h1.title, .title");
          if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
            return titleEl.textContent.trim();
          }
          const parts = document.title.split(/\s*[\/|-]\s*/);
          if (parts.length > 1) {
            return parts[parts.length - 1].trim();
          }
          return null;
        }
        extractEpisodeTitle() {
          const epEl = document.querySelector(".episode-title, h2.title, .novel-sub-title, .sub-title");
          if (epEl && !epEl.closest("a") && epEl.textContent && epEl.textContent.trim()) {
            return epEl.textContent.trim();
          }
          const parts = document.title.split(/\s*[\/|-]\s*/);
          if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
          }
          return "";
        }
        getWorkKey(url) {
          const match = url.match(/\/novel\/(\d+)/);
          return match ? `alphapolis_${match[1]}` : null;
        }
        isTocPage(_url, path) {
          if (path.includes("/episode/") || document.querySelector("#novelBoby, #novelBody, .novel-body")) {
            return false;
          }
          return /\/novel\/\d+\/\d+\/?$/.test(path) || !!document.querySelector(".content-statuses, .episode-list, .episodes");
        }
        prepareContent() {
          const bodyEl = document.querySelector("#novelBoby, #novelBody, .novel-body");
          if (!bodyEl || bodyEl.dataset.lanovelPreprocessed) return;
          if (bodyEl.querySelectorAll("p[id]").length > 0) return;
          const existingPs = bodyEl.querySelectorAll("p");
          if (existingPs.length > 1) {
            existingPs.forEach((p, idx) => {
              if (!p.id) p.id = `L${idx + 1}`;
            });
            bodyEl.dataset.lanovelPreprocessed = "true";
            return;
          }
          const rawHtml = bodyEl.innerHTML;
          const lines = /<br\s*\/?>/i.test(rawHtml) ? rawHtml.split(/<br\s*\/?>/i) : rawHtml.split(/\r?\n/);
          if (lines.length <= 1) return;
          bodyEl.innerHTML = "";
          lines.forEach((line, index) => {
            const p = document.createElement("p");
            p.id = `L${index + 1}`;
            const trimmed = line.replace(/<[^>]*>/g, "").trim();
            if (!trimmed) {
              p.className = "blank";
              p.innerHTML = "<br>";
            } else {
              p.innerHTML = line.trim();
            }
            bodyEl.appendChild(p);
          });
          bodyEl.dataset.lanovelPreprocessed = "true";
        }
        findNextEpisodeLink() {
          const direct = document.querySelector(".next a") || document.querySelector("a.btn-next") || document.querySelector(".navigation .next a") || document.querySelector('a[rel="next"]');
          return direct && direct.href ? direct : null;
        }
        findPrevEpisodeLink() {
          const direct = document.querySelector(".prev a") || document.querySelector("a.btn-prev") || document.querySelector(".navigation .prev a") || document.querySelector('a[rel="prev"]');
          return direct && direct.href ? direct : null;
        }
        findTocLink() {
          const direct = document.querySelector(".header-novel-title a") || document.querySelector('a[href*="/novel/"]');
          return direct && direct.href ? direct : null;
        }
        getTocEpisodes(rootDoc = document) {
          const elements = Array.from(
            rootDoc.querySelectorAll(".episode a, .episode-list a, .episodes a")
          );
          return elements.map((el) => {
            const rawHref = el.getAttribute("href") || el.href || "";
            return {
              element: el,
              url: rawHref.split("#")[0],
              title: (el.textContent || "").trim()
            };
          });
        }
      };
    }
  });

  // src/scrapers/generic.ts
  var GenericScraper;
  var init_generic = __esm({
    "src/scrapers/generic.ts"() {
      "use strict";
      GenericScraper = class {
        name = "generic";
        matches(_url, _host) {
          return true;
        }
        detectNovelTitle() {
          const cleanDocTitle = document.title.split(/[-|–—]/)[0].trim();
          if (cleanDocTitle && cleanDocTitle !== "\u9589\u3058\u308B") {
            return cleanDocTitle;
          }
          return "\uAE30\uBCF8 \uC18C\uC124";
        }
        extractEpisodeTitle() {
          if (document.title) {
            let clean = document.title.replace(/\s*-\s*(カクヨム|小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ|ノベルアップ).*$/i, "").trim();
            clean = clean.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, "").trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[0].trim()) {
              return parts[0].trim();
            }
            return clean;
          }
          return "";
        }
        getWorkKey(_url) {
          return null;
        }
        isTocPage(_url, _path) {
          return false;
        }
        findNextEpisodeLink() {
          const relNext = document.querySelector('a[rel="next"]');
          if (relNext && relNext.href) return relNext;
          const allLinks = Array.from(document.querySelectorAll("a"));
          return allLinks.find((a) => {
            const txt = (a.textContent || "").trim();
            return txt === "\u6B21\u3078" || txt === "\uB2E4\uC74C\uD654" || txt === "\uB2E4\uC74C \uD654" || txt === "\uB2E4\uC74C";
          }) || null;
        }
        findPrevEpisodeLink() {
          const relPrev = document.querySelector('a[rel="prev"]');
          if (relPrev && relPrev.href) return relPrev;
          const allLinks = Array.from(document.querySelectorAll("a"));
          return allLinks.find((a) => {
            const txt = (a.textContent || "").trim();
            return txt === "\u524D\u3078" || txt === "\uC774\uC804\uD654" || txt === "\uC774\uC804 \uD654" || txt === "\uC774\uC804";
          }) || null;
        }
        findTocLink() {
          const relIndex = document.querySelector('a[rel="index"]');
          if (relIndex && relIndex.href) return relIndex;
          const allLinks = Array.from(document.querySelectorAll("a"));
          return allLinks.find((a) => {
            const txt = (a.textContent || "").trim();
            return txt === "\u76EE\u6B21" || txt === "\uBAA9\uCC28" || txt === "TOC";
          }) || null;
        }
        getTocEpisodes() {
          return [];
        }
      };
    }
  });

  // src/scrapers/index.ts
  function getScraper(url = window.location.href) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      for (const scraper of scrapers) {
        if (scraper.matches(url, host)) {
          return scraper;
        }
      }
    } catch (e) {
    }
    return genericScraper;
  }
  var scrapers, genericScraper;
  var init_scrapers = __esm({
    "src/scrapers/index.ts"() {
      "use strict";
      init_kakuyomu();
      init_syosetu();
      init_novelup();
      init_hameln();
      init_alphapolis();
      init_generic();
      scrapers = [
        new KakuyomuScraper(),
        new SyosetuScraper(),
        new NovelUpScraper(),
        new HamelnScraper(),
        new AlphapolisScraper()
      ];
      genericScraper = new GenericScraper();
    }
  });

  // src/core/filters.ts
  function isTranslatableText(text) {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (JAPANESE_REGEX.test(trimmed)) {
      return true;
    }
    if (/[「」『』【】《》〈〉〔〕（）“”"']/.test(trimmed)) {
      return true;
    }
    if (/^[…‥・―—ー~～!?！？\s]+$/.test(trimmed)) {
      if (/[…‥―—]/.test(trimmed) || trimmed.length >= 2) {
        return true;
      }
    }
    return false;
  }
  function isPurePunctuationOnly(text) {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3a-zA-Z]/.test(trimmed)) {
      return false;
    }
    return true;
  }
  function hasJapaneseText(text) {
    if (!text) return false;
    if (/^[っッ\s]+$/.test(text)) return false;
    return JAPANESE_REGEX.test(text);
  }
  function isSymbolOrPunctOnly(text) {
    if (!text) return true;
    return isPurePunctuationOnly(text);
  }
  function containsChinese(text) {
    if (!text) return false;
    if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(text)) return false;
    for (const ch of text) {
      if (SIMPLIFIED_CHINESE_CHARS.has(ch)) return true;
    }
    const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
    const hasHanja = /[\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
    if (!hasHangul && hasHanja) {
      for (const ch of text) {
        if (CHINESE_INDICATOR_CHARS.has(ch)) return true;
      }
      if (/[，：“”]/.test(text)) return true;
    }
    return false;
  }
  function checkIsVerbatimOrParaphrased(original, translated) {
    if (!original || !translated) return false;
    const cleanOri = original.trim();
    const cleanTra = translated.trim();
    if (!cleanTra) return false;
    if (!hasJapaneseText(cleanOri) || isSymbolOrPunctOnly(cleanOri)) {
      return false;
    }
    const noSpaceOri = cleanOri.replace(/\s+/g, "");
    const noSpaceTra = cleanTra.replace(/\s+/g, "");
    if (noSpaceOri === noSpaceTra) return true;
    if (containsChinese(cleanTra)) return true;
    const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(cleanTra);
    const hasKana = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(cleanTra);
    if (!hasHangul && hasKana) {
      if (noSpaceOri.includes(noSpaceTra) || noSpaceTra.includes(noSpaceOri)) {
        return true;
      }
      return true;
    }
    return false;
  }
  function isItemEmptyTranslation(item, translationCache, userDeletedPids, exclusionSet, activeSeparators) {
    if (!item) return false;
    const pid = String(item.id || item.pid || "");
    if (pid && userDeletedPids && userDeletedPids.has(pid)) return false;
    if (pid && typeof document !== "undefined") {
      const row = document.querySelector(`tr[data-pid="${pid}"]`);
      if (row && (row.dataset.userDeleted === "true" || row.getAttribute("data-user-deleted") === "true")) {
        return false;
      }
    }
    const original = (item.original || item.text || "").trim();
    if (!original) return false;
    if (exclusionSet && exclusionSet.has(original)) return false;
    if (isPurePunctuationOnly(original)) return false;
    let hasValidCached = false;
    if (pid && translationCache) {
      const cached = translationCache.get(pid);
      const cachedText = cached && cached.translated ? String(cached.translated).trim() : "";
      if (cachedText.length > 0 && !cachedText.includes("\uBC88\uC5ED \uC2E4\uD328") && !cachedText.includes("API \uC624\uB958") && !cachedText.includes("[\uAC80\uC5F4\uB85C \uC778\uD574 \uBC88\uC5ED \uC0DD\uB7B5]")) {
        hasValidCached = true;
      }
    }
    let hasValidDOM = false;
    if (pid && typeof document !== "undefined") {
      const row = document.querySelector(`tr[data-pid="${pid}"]`);
      if (row) {
        const cell = row.querySelector(".translated-text");
        const domText = cell ? (cell.textContent || "").trim() : "";
        if (domText.length > 0 && !domText.includes("\u23F3 \uBC88\uC5ED \uC911") && !domText.includes("\u23F3 \uC7AC\uBC88\uC5ED \uC911") && !domText.includes("\uBC88\uC5ED \uC2E4\uD328") && !domText.includes("API \uC624\uB958") && !domText.includes("[\uAC80\uC5F4\uB85C \uC778\uD574 \uBC88\uC5ED \uC0DD\uB7B5]")) {
          hasValidDOM = true;
        }
      }
    }
    const itemTranslated = (item.translated || "").trim();
    const hasValidItem = itemTranslated.length > 0 && !itemTranslated.includes("\uBC88\uC5ED \uC2E4\uD328") && !itemTranslated.includes("API \uC624\uB958");
    if (hasValidCached || hasValidDOM || hasValidItem) {
      return false;
    }
    return true;
  }
  function getPendingEmptyItems(candidateItems, excludeItemIds = /* @__PURE__ */ new Set(), translationCache, userDeletedPids, exclusionSet, activeSeparators) {
    if (!Array.isArray(candidateItems) || candidateItems.length === 0) return [];
    const pending = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const item of candidateItems) {
      if (!item) continue;
      const pid = String(item.id || item.pid || "");
      if (!pid || excludeItemIds.has(pid) || seenIds.has(pid)) continue;
      if (isItemEmptyTranslation(item, translationCache, userDeletedPids, exclusionSet, activeSeparators)) {
        pending.push({
          id: pid,
          text: (item.original || item.text || "").trim()
        });
        seenIds.add(pid);
      }
    }
    return pending;
  }
  var JAPANESE_REGEX, PID_REGEX, SIMPLIFIED_CHINESE_CHARS, CHINESE_INDICATOR_CHARS;
  var init_filters = __esm({
    "src/core/filters.ts"() {
      "use strict";
      JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;
      PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
      SIMPLIFIED_CHINESE_CHARS = new Set(
        "\u4F24\u4F53\u56FD\u7231\u65F6\u95E8\u5B66\u4E66\u7535\u89C1\u540E\u53D1\u957F\u6C14\u8F66\u5F00\u4E3A\u8FC7\u4E48\u8FD9\u5934\u7ECF\u52A8\u95EE\u5E94\u73B0\u5B9E\u5173\u70B9\u8FDB\u4ECE\u603B\u5C06\u5185\u95F4\u6765\u8BF4\u8BDD\u5BF9\u7ED9\u4F1A\u628A\u6CA1\u8BA9\u6837\u600E\u4E48\u53BB\u91CC\u4E24\u8D77\u5E26\u542C\u8BF4\u53D8\u4EEC\u8FD9\u4E3A\u4E48\u7740\u8BF4\u5BF9\u8BA9\u7ED9\u6837\u600E\u4E24\u5E26\u542C\u53D8\u5934\u7ECF\u52A8\u95EE\u5E94\u5173\u8FDB\u4ECE\u95F4\u957F\u8F66\u95E8\u89C1\u4E66\u7535\u4F24\u53D1\u8FC7\u65F6\u8FD8\u5F00\u5199\u8BDD\u8FB9\u4E1C\u5904\u529E\u5E2E\u5B9D\u5907\u7B14\u4EA7\u573A\u89C6\u8BA4\u673A\u4E1A\u5F20\u8282\u8BED\u867D\u968F\u5C81\u5B59\u635F\u7F29\u9501\u6001\u644A\u8D2A\u6EE9\u575B\u53F9\u6C64\u70EB\u6D9B\u8BA8\u817E\u94C1\u5385\u94DC\u7EDF\u56FE\u6D82\u56E2\u9893\u817F\u6258\u8131\u6D3C\u889C\u7F51\u4F2A\u8FDD\u56F4\u7EAC\u4F1F\u536B\u6E29\u95FB\u7A33\u6DA1\u7A9D\u545C\u575E\u59A9\u96FE\u52A1\u8BEF\u9521\u727A\u88AD\u4E60\u620F\u7EC6\u867E\u5413\u663E\u9669\u7EBF\u5BAA\u53BF\u54CD\u9879\u9500\u6653\u4E9B\u6CC4\u8C22\u950C\u5174\u6C79\u7EE3\u9508\u987B\u865A\u5618\u8BB8\u53D9\u7EEA\u7EED\u8F69\u60AC\u9009\u8BE2\u5BFB\u8BAD\u8BAF\u900A\u538B\u9E26\u9E2D\u54D1\u4E9A\u8BB6\u4E25\u5CA9\u76D0\u538C\u626C\u9633\u517B\u7476\u6447\u5C27\u9065\u7A91\u836F\u7237\u9875\u53F6\u533B\u4EBF\u4E49\u827A\u8BAE\u8BD1\u5F02\u836B\u9634\u94F6\u996E\u9690\u9E70\u5A74\u83B9\u8425\u8367\u8747\u8D62\u9896\u54DF\u62E5\u4F63\u548F\u8E0A\u6D8C\u75C8\u4F18\u72B9\u6CB9\u90AE\u94C0\u6E38\u8BF1\u9C7C\u6E14\u5A31\u4E0E\u5C7F\u5401\u9A6D\u72F1\u8A89\u9884\u6E0A\u5458\u5706\u56ED\u8F95\u8FDC\u6028\u613F\u7EA6\u8DC3\u94A5\u5CB3\u7CA4\u60A6\u9605\u4E91\u5300\u9668\u8FD0\u8574\u915D\u6655\u97F5\u6742\u707E\u8F7D\u6512\u6682\u8D5E\u51FF\u7076\u5219\u62E9\u6CFD\u8D23\u8D3C\u95F8\u624E\u658B\u503A\u6BE1\u6218\u6808\u5360\u7C98\u6DA8\u5E10\u8D26\u80C0\u8D75\u7167\u6298\u54F2\u9488\u4FA6\u73CD\u771F\u8BCA\u9547\u9635\u4E89\u5F81\u6323\u7741\u72F0\u8BC1\u652F\u53EA\u7EC7\u804C\u6267\u7EB8\u6307\u63B7\u5E1C\u8D28\u949F\u7EC8\u79CD\u80BF\u91CD\u5468\u6D32\u663C\u6731\u732A\u8BF8\u8BDB\u70DB\u77A9\u5C5E\u8457\u52A9\u94F8\u7B51\u6293\u62FD\u4E13\u7816\u8F6C\u8D5A\u5E84\u6869\u88C5\u58EE\u72B6\u9525\u8FFD\u51C6\u6D4A\u7EB5\u90B9\u963B\u7EC4\u94BB\u522B\u6CA1\u4E48\u4E3A\u4EC0\u4E48\u600E\u4E48\u5982\u679C\u56E0\u4E3A\u6240\u4EE5\u4F46\u662F\u800C\u4E14\u7136\u540E\u77E5\u9053\u770B\u89C1\u89C9\u5F97"
      );
      CHINESE_INDICATOR_CHARS = new Set(
        "\u7684\u4E86\u662F\u5728\u6211\u6709\u4E2A\u4EBA\u8FD9\u4E3A\u8BF4\u548C\u65F6\u8981\u4F60\u3479\u540E\u5BF9\u7740\u91CC\u53BB\u8FC7\u53D1\u90FD\u7ECF\u5F53\u4E0E\u5B66\u8FDB\u8FD8\u6CA1\u73B0\u5979\u4ED6\u4EEC\u5199\u542C\u5934\u95EE\u8BDD\u5E26\u8BA9\u6837\u7ED9\u4ECE\u5173\u53D8\u603B\u4E24\u5E94\u95F4\u957F\u8F66\u95E8\u89C1\u4E66\u7535\u4F24\u52A8\u5F00\u6761\u8FB9\u4E1C\u5904\u529E\u5E2E\u5B9D\u5907\u7B14\u4EA7\u573A\u89C6\u8BA4\u673A\u5B9E\u4E1A\u5F20\u8282\u8BED\u867D\u968F\u5C81\u5B59\u635F\u7F29\u9501\u6001\u6EE9\u575B\u53F9\u6C64\u8BA8\u4F53\u94C1\u5385\u7EDF\u56FE\u56E2\u8131\u7F51\u4F2A\u8FDD\u56F4\u536B\u95FB\u7A33\u52A1\u8BEF\u88AD\u4E60\u620F\u7EC6\u663E\u9669\u7EBF\u53BF\u54CD\u9879\u9500\u4E9B\u8C22\u5174\u987B\u865A\u8BB8\u53D9\u7EED\u9009\u8BE2\u5BFB\u8BAD\u538B\u4E25\u5CA9\u76D0\u538C\u626C\u9633\u517B\u836F\u9875\u53F6\u533B\u4EBF\u4E49\u827A\u8BAE\u8BD1\u5F02\u9690\u9E70\u5A74\u8425\u8D62\u4F18\u72B9\u6CB9\u90AE\u6CB9\u6E38\u8BF1\u9C7C\u6E14\u5A31\u4E0E\u5C7F\u8BED\u5401\u72F1\u8A89\u9884\u5458\u5706\u56ED\u8FDC\u6028\u613F\u7EA6\u8DC3\u8FD0\u6742\u707E\u8F7D\u6682\u8D5E\u5219\u62E9\u6CFD\u8D23\u8D3C\u6218\u5F20\u8D75\u7167\u9488\u4FA6\u73CD\u8BCA\u9547\u9635\u4E89\u5F81\u6323\u7741\u8BC1\u53EA\u7EC7\u804C\u6267\u7EB8\u6307\u8D28\u949F\u7EC8\u79CD\u91CD\u5468\u663C\u8BF8\u6731\u73E0\u77A9\u52A9\u4E13\u7816\u8F6C\u8D5A\u5E84\u88C5\u58EE\u72B6\u8FFD\u51C6\u603B\u7EC4\u5417\u5427\u5462\u554A\u4E48\u600E\u8C01\u4E3A\u4EC0\u4E48\u600E\u4E48\u56E0\u4E3A\u6240\u4EE5\u5982\u679C\u4F46\u662F"
      );
    }
  });

  // src/core/chunker.ts
  function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  function createBudgetChunks(items, maxChars = CHUNK_BUDGET_CHARACTERS, maxItems = CHUNK_BUDGET_MAX_ITEMS) {
    if (!items || items.length === 0) return [];
    const chunks = [];
    let currentChunk = [];
    let currentChars = 0;
    for (const item of items) {
      const itemLength = item.text ? item.text.length : 0;
      if (currentChunk.length > 0 && (currentChars + itemLength > maxChars || currentChunk.length >= maxItems)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChars = 0;
      }
      currentChunk.push(item);
      currentChars += itemLength;
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    return chunks;
  }
  var CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS;
  var init_chunker = __esm({
    "src/core/chunker.ts"() {
      "use strict";
      CHUNK_BUDGET_CHARACTERS = 2e3;
      CHUNK_BUDGET_MAX_ITEMS = 40;
    }
  });

  // src/core/turbo.ts
  function isUsDstRule(d = /* @__PURE__ */ new Date()) {
    const year = d.getFullYear();
    const march1 = new Date(year, 2, 1);
    const firstSunMarch = (7 - march1.getDay()) % 7 + 1;
    const secondSunMarch = firstSunMarch + 7;
    const dstStart = new Date(year, 2, secondSunMarch, 2, 0, 0);
    const nov1 = new Date(year, 10, 1);
    const firstSunNov = (7 - nov1.getDay()) % 7 + 1;
    const dstEnd = new Date(year, 10, firstSunNov, 2, 0, 0);
    return d >= dstStart && d < dstEnd;
  }
  function detectCutoffInfo(turboCutoffHour = null) {
    if (turboCutoffHour === 16) {
      return { hour: 16, isDst: true, label: "16:00 (\uC218\uB3D9)" };
    }
    if (turboCutoffHour === 17) {
      return { hour: 17, isDst: false, label: "17:00 (\uC218\uB3D9)" };
    }
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        timeZoneName: "short"
      }).formatToParts(/* @__PURE__ */ new Date());
      const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "";
      const isDst = tzName.includes("PDT") || !tzName.includes("PST") && isUsDstRule(/* @__PURE__ */ new Date());
      return {
        hour: isDst ? 16 : 17,
        isDst,
        label: isDst ? "16:00 (\uC368\uBA38\uD0C0\uC784)" : "17:00 (\uD45C\uC900\uC2DC)"
      };
    } catch (e) {
      const isDst = isUsDstRule(/* @__PURE__ */ new Date());
      return {
        hour: isDst ? 16 : 17,
        isDst,
        label: isDst ? "16:00 (\uC368\uBA38\uD0C0\uC784)" : "17:00 (\uD45C\uC900\uC2DC)"
      };
    }
  }
  function calculateNextCutoffTimestamp(cutoffHour) {
    const now = /* @__PURE__ */ new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoffHour, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }
  function checkCutoffTimeReached(turboCutoffHour, turboTargetTimestamp) {
    let target = turboTargetTimestamp;
    if (!target) {
      const info = detectCutoffInfo(turboCutoffHour);
      target = calculateNextCutoffTimestamp(info.hour);
    }
    return Date.now() >= target;
  }
  function getCurrentQuotaWindow(now = /* @__PURE__ */ new Date(), turboCutoffHour = null) {
    const cutoffHour = detectCutoffInfo(turboCutoffHour).hour;
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = now.getHours();
    if (hour < cutoffHour) {
      const prev = new Date(now.getTime() - 24 * 3600 * 1e3);
      const pYear = prev.getFullYear();
      const pMonth = String(prev.getMonth() + 1).padStart(2, "0");
      const pDay = String(prev.getDate()).padStart(2, "0");
      return `${pYear}-${pMonth}-${pDay}_${cutoffHour}`;
    }
    return `${year}-${month}-${day}_${cutoffHour}`;
  }
  var init_turbo = __esm({
    "src/core/turbo.ts"() {
      "use strict";
    }
  });

  // src/core/adaptive_throttle.ts
  async function recordRecentEpisode(cleanUrl) {
    if (!cleanUrl) return;
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1e3;
    try {
      const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
      let list = Array.isArray(data[RECENT_EPISODES_STORAGE_KEY]) ? data[RECENT_EPISODES_STORAGE_KEY].filter((item) => item && item.timestamp >= tenMinutesAgo) : [];
      const existingIndex = list.findIndex((item) => item.url === cleanUrl);
      if (existingIndex >= 0) {
        list[existingIndex].timestamp = now;
      } else {
        list.push({ url: cleanUrl, timestamp: now });
      }
      recentEpisodesMemoryCache = list;
      await chrome.storage.local.set({ [RECENT_EPISODES_STORAGE_KEY]: list });
    } catch (e) {
      console.warn("[recordRecentEpisode] Failed to save recent episode:", e);
    }
  }
  async function getRecentEpisodeCount(windowMinutes = 5) {
    const now = Date.now();
    const cutoffTime = now - windowMinutes * 60 * 1e3;
    try {
      const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
      const list = Array.isArray(data[RECENT_EPISODES_STORAGE_KEY]) ? data[RECENT_EPISODES_STORAGE_KEY] : recentEpisodesMemoryCache;
      recentEpisodesMemoryCache = list;
      const recentItems = list.filter((item) => item && item.timestamp >= cutoffTime && item.url);
      const uniqueUrls = new Set(recentItems.map((item) => item.url));
      return uniqueUrls.size;
    } catch (e) {
      console.warn("[getRecentEpisodeCount] Fallback to memory cache:", e);
      const recentItems = recentEpisodesMemoryCache.filter((item) => item && item.timestamp >= cutoffTime && item.url);
      return new Set(recentItems.map((item) => item.url)).size;
    }
  }
  function calculateAdaptiveEpisodeDelay(recentCount, isTurbo) {
    if (isTurbo) {
      if (recentCount <= 2) return 8e3;
      if (recentCount === 3) return 15e3;
      if (recentCount === 4) return 22e3;
      if (recentCount === 5) return 3e4;
      if (recentCount === 6) return 4e4;
      return 55e3;
    }
    if (recentCount <= 4) return 6e4;
    if (recentCount <= 6) return 75e3;
    return 9e4;
  }
  function calculateAdaptiveChunkDelay(recentCount, isTurbo) {
    if (isTurbo) {
      if (recentCount <= 3) return 2e3;
      if (recentCount <= 5) return 3e3;
      return 4500;
    }
    if (recentCount <= 4) return 5e3;
    return 6500;
  }
  function getNovelWorkKey(customUrl, customNovelTitle) {
    const url = customUrl ?? (typeof window !== "undefined" ? window.location.href : "");
    let host = "";
    try {
      host = customUrl ? new URL(customUrl).hostname : typeof window !== "undefined" ? window.location.hostname : "";
    } catch (_) {
      host = typeof window !== "undefined" ? window.location.hostname : "";
    }
    if (host.includes("kakuyomu.jp")) {
      const match = url.match(/\/works\/(\d+)/);
      if (match) return `kakuyomu_${match[1]}`;
    }
    if (host.includes("syosetu.com")) {
      const match = url.match(/\/(n\d+[a-z]+)(\/|$)/i);
      if (match) return `syosetu_${match[1].toLowerCase()}`;
    }
    if (host.includes("novelup.plus")) {
      const match = url.match(/\/story\/(\d+)/);
      if (match) return `novelup_${match[1]}`;
    }
    if (host.includes("syosetu.org")) {
      const match = url.match(/\/novel\/(\d+)/);
      if (match) return `hameln_${match[1]}`;
    }
    if (host.includes("alphapolis.co.jp")) {
      const match = url.match(/\/novel\/(\d+)/);
      if (match) return `alphapolis_${match[1]}`;
    }
    const novelTitle = customNovelTitle || "";
    if (novelTitle && novelTitle !== "\uAE30\uBCF8 \uC18C\uC124" && novelTitle !== "\u9589\u3058\u308B") {
      const sanitized = novelTitle.trim().replace(/[^a-zA-Z0-9가-힣\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff_]/g, "_");
      if (sanitized && sanitized.replace(/_/g, "").length > 0) {
        return `novel_${sanitized}`;
      }
    }
    return "default";
  }
  async function updateAndGetBatchCount(currentCleanUrl, onLog, novelTitle = "", turboCutoffHour = null) {
    const workKey = getNovelWorkKey(currentCleanUrl, novelTitle);
    const stateKey = `lanovel_batch_state_${workKey}`;
    try {
      const allKeys = await chrome.storage.local.get(null);
      const legacyKeys = Object.keys(allKeys).filter((k) => k.startsWith("lanovel_batch_count_"));
      if (legacyKeys.length > 0) {
        await chrome.storage.local.remove(legacyKeys);
      }
    } catch (_) {
    }
    const currentWindow = getCurrentQuotaWindow(/* @__PURE__ */ new Date(), turboCutoffHour);
    const cutoffInfo = detectCutoffInfo(turboCutoffHour);
    const cutoffHour = cutoffInfo.hour;
    const now = Date.now();
    const SESSION_TIMEOUT_MS = 30 * 60 * 1e3;
    const batchState = {
      consecutiveCount: 0,
      lastUpdated: 0,
      lastUrl: "",
      window: currentWindow
    };
    try {
      const stored = await chrome.storage.local.get(stateKey);
      if (stored && stored[stateKey]) {
        const s = stored[stateKey];
        batchState.consecutiveCount = typeof s.consecutiveCount === "number" ? s.consecutiveCount : 0;
        batchState.lastUpdated = s.lastUpdated || 0;
        batchState.lastUrl = s.lastUrl || "";
        batchState.window = s.window || currentWindow;
      }
    } catch (e) {
      console.warn("[Notification] Failed to read batch state from storage:", e);
    }
    if (batchState.window && batchState.window !== currentWindow) {
      if (onLog) {
        onLog(`\u{1F504} [\uC77C\uC77C \uAC31\uC2E0] Gemini API \uCFFC\uD130 \uCD08\uAE30\uD654 \uC2DC\uAC04(${cutoffHour}\uC2DC)\uC5D0 \uB3C4\uB2EC\uD558\uC5EC \uC774\uBC88 \uC138\uC158 \uC5F0\uC18D \uBC88\uC5ED \uCE74\uC6B4\uD130\uB97C \uC0C8\uB85C \uC2DC\uC791\uD569\uB2C8\uB2E4.`);
      }
      batchState.consecutiveCount = 0;
      batchState.lastUrl = "";
      batchState.window = currentWindow;
    }
    const isSessionExpired = !batchState.lastUpdated || now - batchState.lastUpdated > SESSION_TIMEOUT_MS;
    if (isSessionExpired) {
      batchState.consecutiveCount = 0;
      batchState.lastUrl = "";
    }
    const isSameEpisode = Boolean(batchState.lastUrl && batchState.lastUrl === currentCleanUrl);
    if (isSameEpisode) {
      if (!batchState.consecutiveCount || batchState.consecutiveCount < 1) {
        batchState.consecutiveCount = 1;
      }
      if (onLog) {
        onLog(`[\uBC88\uC5ED \uC9C4\uD589 \uCE74\uC6B4\uD130] \uB3D9\uC77C \uD68C\uCC28 \uC7AC\uBC88\uC5ED \uAC10\uC9C0: \uC774\uBC88 \uC5F0\uC18D \uBC88\uC5ED \uCE74\uC6B4\uD130\uB97C \uC720\uC9C0\uD569\uB2C8\uB2E4. (${batchState.consecutiveCount}\uD654)`);
      }
    } else {
      batchState.consecutiveCount = (batchState.consecutiveCount || 0) + 1;
    }
    batchState.lastUpdated = now;
    batchState.lastUrl = currentCleanUrl;
    batchState.window = currentWindow;
    try {
      await chrome.storage.local.set({ [stateKey]: batchState });
    } catch (e) {
      console.warn("[Notification] Failed to save batch state:", e);
    }
    let novelTodayCount = batchState.consecutiveCount;
    let totalTodayCount = cachedTodayTotalEpisodes || 0;
    try {
      const syncUrl = `http://127.0.0.1:8001/api/translation_session_count?url=${encodeURIComponent(currentCleanUrl)}&work_key=${encodeURIComponent(workKey)}&novel_title=${encodeURIComponent(novelTitle || "")}`;
      const serverResp = await fetch(syncUrl);
      if (serverResp.ok) {
        const serverData = await serverResp.json();
        if (typeof serverData.total_today_count === "number") {
          totalTodayCount = serverData.total_today_count;
          cachedTodayTotalEpisodes = totalTodayCount;
        }
        if (typeof serverData.count === "number" && serverData.count > 0) {
          novelTodayCount = serverData.count;
        }
      }
    } catch (_) {
    }
    return {
      consecutiveCount: batchState.consecutiveCount,
      novelTodayCount,
      totalTodayCount
    };
  }
  async function sendProgressNotification(novelTitle, episodeTitle, current, total, percentage, url, episodeCount = null) {
    try {
      const payload = {
        novel_title: novelTitle || "",
        episode_title: episodeTitle || "",
        current,
        total,
        percentage,
        url: url || ""
      };
      if (episodeCount !== null && episodeCount !== void 0) {
        payload.episode_count = episodeCount;
      }
      await fetch("http://127.0.0.1:8001/api/notifications/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
    }
  }
  async function sendCompleteNotification(novelTitle, episodeTitle, totalCount, url, episodeCount = null) {
    try {
      const payload = {
        novel_title: novelTitle || "",
        episode_title: episodeTitle || "",
        total_count: totalCount,
        url: url || ""
      };
      if (episodeCount !== null && episodeCount !== void 0) {
        payload.episode_count = episodeCount;
      }
      await fetch("http://127.0.0.1:8001/api/notifications/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
    }
  }
  var RECENT_EPISODES_STORAGE_KEY, recentEpisodesMemoryCache, cachedTodayTotalEpisodes;
  var init_adaptive_throttle = __esm({
    "src/core/adaptive_throttle.ts"() {
      "use strict";
      init_turbo();
      RECENT_EPISODES_STORAGE_KEY = "lanovel_recent_episodes";
      recentEpisodesMemoryCache = [];
      cachedTodayTotalEpisodes = 0;
    }
  });

  // src/ui/review_panel.ts
  function focusAndScrollToPid(pid) {
    if (!pid) return;
    const targetP = document.getElementById(pid);
    if (targetP) {
      targetP.scrollIntoView({ behavior: "smooth", block: "center" });
      targetP.classList.remove("lanovel-highlight-pulse");
      void targetP.offsetWidth;
      targetP.classList.add("lanovel-highlight-pulse");
      setTimeout(() => {
        targetP.classList.remove("lanovel-highlight-pulse");
      }, 1800);
    }
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    if (row) {
      showSidebar();
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.remove("lanovel-row-highlight");
      void row.offsetWidth;
      row.classList.add("lanovel-row-highlight");
      setTimeout(() => {
        row.classList.remove("lanovel-row-highlight");
      }, 1800);
    }
  }
  function highlightReviewTargetDOMs() {
    if (!state.reviewTargetPids || state.reviewTargetPids.size === 0) return;
    state.reviewTargetPids.forEach((pid) => {
      const p = document.getElementById(pid);
      if (p) {
        p.classList.add("review-target-dom");
        p.title = "\u26A1 [\uC54C\uB9BC \uC13C\uD130] \uC7AC\uBC88\uC5ED \uAC80\uC218 \uB300\uC0C1 \uBB38\uC7A5\uC785\uB2C8\uB2E4. \uD074\uB9AD \uC2DC \uC0AC\uC774\uB4DC\uBC14\uC5D0\uC11C \uD655\uC778\uD569\uB2C8\uB2E4.";
      }
    });
  }
  function updateSidebarReviewTargetHighlights() {
    if (!state.reviewTargetPids || state.reviewTargetPids.size === 0) return;
    state.reviewTargetPids.forEach((pid) => {
      const row = document.querySelector(`tr[data-pid="${pid}"]`);
      if (row) {
        row.classList.add("review-target-row");
        const oriCell = row.querySelector(".original-text");
        if (oriCell && !oriCell.querySelector(".review-badge")) {
          const badge = document.createElement("span");
          badge.className = "review-badge";
          badge.textContent = "\u26A1\uC7AC\uAC80\uC218";
          oriCell.prepend(badge);
        }
      }
    });
  }
  function updateReviewCardTranslation(pid, text, isWaiting = false) {
    const reviewTraEl = document.getElementById(`review-tra-${pid}`);
    if (!reviewTraEl) return;
    reviewTraEl.textContent = text;
    if (isWaiting) {
      reviewTraEl.classList.add("waiting");
    } else {
      reviewTraEl.classList.remove("waiting");
    }
  }
  function renderReviewTargetPanel() {
    const panel = document.getElementById("review-target-panel");
    if (!panel) return;
    if (!state.reviewTargetsData || !state.reviewTargetsData.targets || state.reviewTargetsData.targets.length === 0) {
      panel.style.display = "none";
      return;
    }
    const targets = state.reviewTargetsData.targets;
    const notifId = state.reviewTargetsData.notif_id;
    let cardsHtml = "";
    targets.forEach((t) => {
      const cached = state.translationCache.get(t.pid);
      const transText = cached && cached.translated ? cached.translated : "";
      const isWaiting = !transText || transText.includes("\uBC88\uC5ED \uC911");
      cardsHtml += `
      <div class="review-card" data-pid="${escapeHtml(t.pid)}" title="\uD074\uB9AD\uD558\uBA74 \uBCF8\uBB38 \uBC0F \uC0AC\uC774\uB4DC\uBC14\uC758 \uD574\uB2F9 \uBB38\uC7A5\uC73C\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4">
        <div class="review-card-pid">ID: ${escapeHtml(t.pid)} ${t.reason_category ? `(${escapeHtml(t.reason_category)})` : ""}</div>
        <div class="review-card-ori">\uC6D0\uBB38: ${escapeHtml(t.original || "")}</div>
        <div class="review-card-tra ${isWaiting ? "waiting" : ""}" id="review-tra-${escapeHtml(t.pid)}">
          ${isWaiting ? "\u23F3 \uBC88\uC5ED \uB300\uAE30 \uB610\uB294 \uC7AC\uBC88\uC5ED \uC9C4\uD589 \uC911..." : `\uBC88\uC5ED: ${escapeHtml(transText)}`}
        </div>
      </div>
    `;
    });
    panel.innerHTML = `
    <div class="review-panel-header">
      <div class="review-panel-title">
        <span>\u{1F514} \uC7AC\uBC88\uC5ED \uAC80\uC218 \uB300\uC0C1 (${targets.length}\uAC74)</span>
      </div>
      <div class="review-panel-actions">
        ${notifId ? `<button id="review-dismiss-notif-btn" class="review-dismiss-btn" title="\uAC80\uC218\uB97C \uC644\uB8CC\uD558\uACE0 \uC54C\uB9BC \uC13C\uD130\uC5D0\uC11C \uC774 \uC54C\uB9BC\uC744 \uB2EB\uC2B5\uB2C8\uB2E4">\u2713 \uAC80\uC218 \uC644\uB8CC</button>` : ""}
        <button id="review-panel-close-btn" class="review-panel-close-btn" title="\uD328\uB110 \uC811\uAE30">&times;</button>
      </div>
    </div>
    <div class="review-panel-body">
      ${cardsHtml}
    </div>
  `;
    panel.style.display = "block";
    panel.querySelectorAll(".review-card").forEach((card) => {
      card.addEventListener("click", () => {
        const pid = card.getAttribute("data-pid");
        if (pid) focusAndScrollToPid(pid);
      });
    });
    const closeBtn = document.getElementById("review-panel-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        panel.style.display = "none";
      });
    }
    const dismissBtn = document.getElementById("review-dismiss-notif-btn");
    if (dismissBtn && notifId) {
      dismissBtn.addEventListener("click", async () => {
        try {
          dismissBtn.disabled = true;
          dismissBtn.textContent = "\uCC98\uB9AC \uC911...";
          await fetch(`http://127.0.0.1:8001/cleanup/notifications/${notifId}/dismiss`, {
            method: "POST"
          });
          try {
            await chrome.storage.local.set({ lastNotificationDismissed: Date.now() });
          } catch (storageErr) {
            console.warn("[ReviewTarget] Failed to notify popup via storage:", storageErr);
          }
          panel.style.display = "none";
          logToSidebar("\u2713 \uC7AC\uBC88\uC5ED \uAC80\uC218\uAC00 \uC644\uB8CC \uCC98\uB9AC\uB418\uC5B4 \uC54C\uB9BC\uC774 \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
        } catch (e) {
          console.error("Failed to dismiss notification:", e);
          dismissBtn.disabled = false;
          dismissBtn.textContent = "\u2713 \uAC80\uC218 \uC644\uB8CC";
        }
      });
    }
  }
  async function checkAndLoadReviewTargets(cleanUrl) {
    try {
      let batchId = null;
      if (window.location.hash.includes("lanovel_review=")) {
        state.isReviewSession = true;
        const hashMatch = window.location.hash.match(/lanovel_review=([^&]+)/);
        if (hashMatch) {
          batchId = decodeURIComponent(hashMatch[1]);
        }
      } else if (window.location.hash.includes("lanovel_review")) {
        state.isReviewSession = true;
      }
      let apiUrl = `http://127.0.0.1:8001/cleanup/review_targets?url=${encodeURIComponent(cleanUrl)}`;
      if (batchId) {
        apiUrl += `&batch_id=${encodeURIComponent(batchId)}`;
      }
      const res = await fetch(apiUrl);
      if (!res.ok) return;
      const data = await res.json();
      if (data.has_targets && Array.isArray(data.targets) && data.targets.length > 0) {
        state.isReviewSession = true;
        state.reviewTargetsData = data;
        state.reviewTargetPids = new Set(data.targets.map((t) => t.pid).filter(Boolean));
        renderReviewTargetPanel();
        highlightReviewTargetDOMs();
        updateSidebarReviewTargetHighlights();
        if (window.location.hash.includes("lanovel_review")) {
          showSidebar();
          logToSidebar(
            `\u{1F514} [\uC54C\uB9BC \uC13C\uD130 \uC5F0\uACC4] \uC7AC\uBC88\uC5ED \uAC80\uC218 \uB300\uC0C1 ${data.targets.length}\uAC74\uC774 \uAC10\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
          );
          const firstPid = data.targets[0].pid;
          if (firstPid) {
            setTimeout(() => focusAndScrollToPid(firstPid), 600);
          }
        }
      }
    } catch (e) {
      console.warn("[checkAndLoadReviewTargets] Failed to load review targets:", e);
    }
  }
  var init_review_panel = __esm({
    "src/ui/review_panel.ts"() {
      "use strict";
      init_state();
      init_sidebar();
    }
  });

  // src/core/row_actions.ts
  async function saveSingleTranslation(pid, originalText, newTranslatedText) {
    const url = getCleanUrl();
    const scraper = getScraper();
    const title = scraper.extractEpisodeTitle() || document.title;
    const record = {
      url,
      pid,
      original: originalText,
      translated: newTranslatedText,
      timestamp: Math.floor(Date.now() / 1e3),
      folderName: null,
      title
    };
    if (!newTranslatedText || !newTranslatedText.trim()) {
      state.userDeletedTranslationPids.add(String(pid));
      state.translationCache.delete(pid);
      if (state.isPageApplied) {
        const pTag = document.getElementById(pid);
        if (pTag && pTag.dataset.lanovelOriginalHtml) {
          pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
          pTag.classList.remove("lanovel-applied-text");
          pTag.removeAttribute("style");
          if (pTag.dataset.lanovelOriginalStyle) {
            pTag.setAttribute("style", pTag.dataset.lanovelOriginalStyle);
          }
        }
      }
    } else {
      state.userDeletedTranslationPids.delete(String(pid));
      state.translationCache.set(pid, {
        pid,
        original: originalText,
        translated: newTranslatedText
      });
      if (state.isPageApplied) {
        const pTag = document.getElementById(pid);
        if (pTag) {
          if (!pTag.dataset.lanovelOriginalHtml) {
            pTag.dataset.lanovelOriginalHtml = pTag.innerHTML;
            pTag.dataset.lanovelOriginalStyle = pTag.getAttribute("style") || "";
          }
          pTag.innerHTML = newTranslatedText;
          pTag.classList.add("lanovel-applied-text");
          Object.assign(pTag.style, { color: "#E2E8F0", fontFamily: "TwoCon" });
        }
      }
    }
    updateApplyButtonUI(state.isPageApplied);
    if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
      if (newTranslatedText && newTranslatedText.trim()) {
        updateReviewCardTranslation(pid, `\uBC88\uC5ED: ${newTranslatedText}`, false);
      } else {
        updateReviewCardTranslation(pid, "\u23F3 \uBC88\uC5ED \uB300\uAE30 \uB610\uB294 \uC7AC\uBC88\uC5ED \uC9C4\uD589 \uC911...", true);
      }
    }
    try {
      const response = await fetch("http://127.0.0.1:8001/translations/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([record])
      });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      logToSidebar(`\uBC88\uC5ED(ID: ${pid})\uC744 \uC11C\uBC84\uC5D0 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.`);
    } catch (error) {
      console.error(`Error saving single translation for ${pid} to server:`, error);
      logToSidebar(`\uC11C\uBC84\uC5D0 \uC800\uC7A5 \uC2E4\uD328 (ID: ${pid}): ${error.message}`, "log-error");
    }
  }
  async function retranslateSingleRow(pid, originalText) {
    if (!pid || !originalText) return;
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    const translatedCell = row ? row.querySelector(".translated-text") : null;
    const retranslateBtn = row ? row.querySelector(".retranslate-row-btn") : null;
    const saveBtn = row ? row.querySelector(".save-btn") : null;
    if (retranslateBtn) retranslateBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    if (translatedCell) {
      translatedCell.textContent = "\u23F3 \uC7AC\uBC88\uC5ED \uC911...";
      translatedCell.style.color = "#64748b";
    }
    const cleanedText = originalText.replace(/([あアいイうウえエおオ])\1{2,}/g, "$1\u30FC");
    logToSidebar(`\uB2E8\uC77C \uBB38\uC7A5 \uC7AC\uBC88\uC5ED \uC694\uCCAD \uC911... (ID: ${pid})`);
    try {
      const response = await chrome.runtime.sendMessage({
        action: "batchTranslate",
        items: [{ id: pid, text: cleanedText }],
        isRetranslation: true
      });
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      if (response && response.error) {
        throw new Error(response.error);
      }
      if (response && response.notification) {
        logToSidebar(response.notification, "log-error");
        if (translatedCell) {
          const cached = state.translationCache.get(pid);
          translatedCell.textContent = cached ? cached.translated : "\u26A0\uFE0F \uC7AC\uBC88\uC5ED \uC77C\uC2DC \uC911\uB2E8\uB428";
          translatedCell.style.color = "";
        }
        return;
      }
      if (response && response.translations && response.translations.length > 0) {
        const result = response.translations[0];
        const newTranslation = result.translated;
        const isVerbatim = Boolean(result.verbatim) || newTranslation && checkIsVerbatimOrParaphrased(originalText, newTranslation);
        if (isVerbatim) {
          logToSidebar(
            `\u26A0\uFE0F [\uC6D0\uBB38 \uBCF5\uC81C\xB7\uBCC0\uD615 \uAC10\uC9C0] \uB2E8\uC77C \uC7AC\uBC88\uC5ED \uBB38\uC7A5(ID: ${pid})\uC774 \uC6D0\uBB38\uACFC \uB3D9\uC77C/\uBCC0\uD615\uB418\uC5B4 \uC790\uB3D9 \uC0AD\uC81C \uBC0F \uD734\uC9C0\uD1B5\uC73C\uB85C \uC774\uC804\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
            "log-error"
          );
          state.translationCache.delete(pid);
          if (translatedCell) {
            translatedCell.textContent = "";
            translatedCell.style.color = "";
            translatedCell.setAttribute("contenteditable", "true");
          }
          if (saveBtn) saveBtn.disabled = false;
          if (state.isPageApplied) {
            const pTag = document.getElementById(pid);
            if (pTag && pTag.dataset.lanovelOriginalHtml) {
              pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
              pTag.classList.remove("lanovel-applied-text");
              pTag.removeAttribute("style");
              if (pTag.dataset.lanovelOriginalStyle) {
                pTag.setAttribute("style", pTag.dataset.lanovelOriginalStyle);
              }
            }
          }
          updateApplyButtonUI(state.isPageApplied);
          if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
            updateReviewCardTranslation(pid, "\uBC88\uC5ED: (\uC6D0\uBB38 \uBCF5\uC81C\xB7\uBCC0\uD615 \uAC10\uC9C0\uB418\uC5B4 \uC790\uB3D9 \uC0AD\uC81C\uB428)", true);
          }
          await saveSingleTranslation(pid, originalText, "");
        } else if (newTranslation && !newTranslation.includes("\uBC88\uC5ED \uC2E4\uD328")) {
          if (translatedCell) {
            translatedCell.textContent = newTranslation;
            translatedCell.style.color = "";
            translatedCell.setAttribute("contenteditable", "true");
          }
          state.userDeletedTranslationPids.delete(String(pid));
          state.translationCache.set(pid, {
            pid,
            original: originalText,
            translated: newTranslation
          });
          if (state.isPageApplied) {
            const pTag = document.getElementById(pid);
            if (pTag) {
              if (!pTag.dataset.lanovelOriginalHtml) {
                pTag.dataset.lanovelOriginalHtml = pTag.innerHTML;
                pTag.dataset.lanovelOriginalStyle = pTag.getAttribute("style") || "";
              }
              pTag.innerHTML = newTranslation;
              pTag.classList.add("lanovel-applied-text");
              Object.assign(pTag.style, { color: "#E2E8F0", fontFamily: "TwoCon" });
            }
          }
          updateApplyButtonUI(state.isPageApplied);
          if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
            updateReviewCardTranslation(pid, `\uBC88\uC5ED: ${newTranslation}`, false);
          }
          await saveSingleTranslation(pid, originalText, newTranslation);
          logToSidebar(`\uB2E8\uC77C \uBB38\uC7A5 \uC7AC\uBC88\uC5ED \uC644\uB8CC (ID: ${pid})`);
        } else {
          throw new Error(newTranslation || "\uBC88\uC5ED \uC2E4\uD328");
        }
      } else {
        throw new Error("\uBC88\uC5ED \uACB0\uACFC\uB97C \uBC1B\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      }
    } catch (err) {
      console.error(`[retranslateSingleRow] Error for ${pid}:`, err);
      logToSidebar(`\uB2E8\uC77C \uC7AC\uBC88\uC5ED \uC2E4\uD328 (ID: ${pid}): ${err.message}`, "log-error");
      if (translatedCell) {
        const cached = state.translationCache.get(pid);
        translatedCell.textContent = cached ? cached.translated : `\u274C \uC7AC\uBC88\uC5ED \uC2E4\uD328: ${err.message}`;
        translatedCell.style.color = cached ? "" : "#ef4444";
      }
    } finally {
      if (retranslateBtn) retranslateBtn.disabled = false;
    }
  }
  var init_row_actions = __esm({
    "src/core/row_actions.ts"() {
      "use strict";
      init_state();
      init_filters();
      init_page_translator();
      init_scrapers();
      init_sidebar();
      init_review_panel();
    }
  });

  // src/ui/separator_panel.ts
  var separator_panel_exports = {};
  __export(separator_panel_exports, {
    addSeparatorTag: () => addSeparatorTag,
    bindSeparatorPanelEvents: () => bindSeparatorPanelEvents,
    checkAndExcludeSeparatorTranslations: () => checkAndExcludeSeparatorTranslations,
    openExcludedManager: () => openExcludedManager,
    removeSeparatorTag: () => removeSeparatorTag,
    renderSeparatorExcludePanel: () => renderSeparatorExcludePanel,
    renderSeparatorSettingsPanel: () => renderSeparatorSettingsPanel,
    restoreExcludedItems: () => restoreExcludedItems,
    toggleSeparatorPanel: () => toggleSeparatorPanel
  });
  function toggleSeparatorPanel() {
    const panel = document.getElementById("separator-settings-panel");
    if (!panel) return;
    if (panel.style.display === "none" || !panel.style.display) {
      panel.style.display = "block";
      renderSeparatorSettingsPanel();
    } else {
      panel.style.display = "none";
    }
  }
  function renderSeparatorSettingsPanel() {
    const panel = document.getElementById("separator-settings-panel");
    if (!panel) return;
    const novelNameDisplay = document.getElementById("panel-novel-name-display");
    if (novelNameDisplay) {
      novelNameDisplay.textContent = `'${state.currentNovelTitle || "\uAE30\uBCF8 \uC18C\uC124"}'`;
    }
    const useDefaultsCheck = document.getElementById("use-global-defaults-check");
    if (useDefaultsCheck) {
      useDefaultsCheck.checked = state.separatorConfig.useDefaults !== false;
    }
    const tagsContainer = document.getElementById("active-separators-container");
    if (tagsContainer) {
      tagsContainer.innerHTML = "";
      if (state.activeSeparators.length === 0) {
        tagsContainer.innerHTML = '<span style="color:#94a3b8; font-style:italic; font-size:11px;">\uC124\uC815\uB41C \uAD6C\uBD84\uC120\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</span>';
      } else {
        state.activeSeparators.forEach((sep) => {
          const isDefault = DEFAULT_GLOBAL_SEPARATORS.includes(sep);
          const tag = document.createElement("span");
          tag.className = "sep-tag" + (isDefault ? "" : " is-custom");
          tag.innerHTML = `<span>${escapeHtml(sep)}</span><span class="sep-tag-remove" title="\uC81C\uAC70">&times;</span>`;
          tag.querySelector(".sep-tag-remove")?.addEventListener("click", () => {
            removeSeparatorTag(sep);
          });
          tagsContainer.appendChild(tag);
        });
      }
    }
    const presetsContainer = document.getElementById("preset-buttons-container");
    if (presetsContainer) {
      presetsContainer.innerHTML = "";
      PRESET_SEPARATORS.forEach((preset) => {
        const isAdded = state.activeSeparators.includes(preset.sep);
        const btn = document.createElement("button");
        btn.className = "sep-preset-btn";
        btn.textContent = (isAdded ? "\u2713 " : "+ ") + preset.name;
        if (isAdded) {
          btn.style.opacity = "0.6";
          btn.style.borderColor = "#10b981";
          btn.style.color = "#059669";
        }
        btn.addEventListener("click", () => {
          if (!isAdded) {
            addSeparatorTag(preset.sep);
          } else {
            removeSeparatorTag(preset.sep);
          }
        });
        presetsContainer.appendChild(btn);
      });
    }
  }
  function addSeparatorTag(sep) {
    const trimmed = sep.trim();
    if (!trimmed) return;
    if (!state.activeSeparators.includes(trimmed)) {
      state.activeSeparators.push(trimmed);
      if (!state.separatorConfig.customSeparators.includes(trimmed)) {
        state.separatorConfig.customSeparators.push(trimmed);
      }
      renderSeparatorSettingsPanel();
    }
  }
  function removeSeparatorTag(sep) {
    state.activeSeparators = state.activeSeparators.filter((s) => s !== sep);
    state.separatorConfig.customSeparators = state.separatorConfig.customSeparators.filter((s) => s !== sep);
    renderSeparatorSettingsPanel();
  }
  function renderSeparatorExcludePanel(excludedItems) {
    const panel = document.getElementById("separator-exclude-panel");
    if (!panel) return;
    if (!excludedItems || excludedItems.length === 0) {
      panel.style.display = "none";
      return;
    }
    let cardsHtml = "";
    excludedItems.forEach((item, idx) => {
      const typeLabel = item.isPreface ? "\uC0C1\uB2E8 \uAD6C\uBD84\uC120 \uC774\uC804 \uC7A1\uAE00" : item.isSubsequent ? "\uAD6C\uBD84\uC120 \uC774\uD6C4 \uD6C4\uAE30 \uB2E8\uB77D" : "\uAD6C\uBD84\uC120 \uC9C1\uC811 \uC77C\uCE58";
      cardsHtml += `
      <div class="separator-exclude-card" data-pid="${escapeHtml(item.pid || "")}" data-idx="${idx}">
        <div class="sep-card-pid">
          <span>ID: ${escapeHtml(item.pid || "-")} (${typeLabel})</span>
          <span class="sep-card-match">\uB9E4\uCE6D: '${escapeHtml(item.matchedSep || "")}'</span>
        </div>
        <div class="sep-card-ori">\uC6D0\uBB38: ${escapeHtml(item.original || "")}</div>
        <div class="sep-card-tra">\uC81C\uC678\uB41C \uBC88\uC5ED: <del>${escapeHtml(item.translated || "(\uBC88\uC5ED\uBB38 \uC5C6\uC74C \u2014 \uC81C\uC678 \uADDC\uCE59 \uC801\uC6A9 \uC911)")}</del></div>
        <div class="sep-card-footer">
          <span class="sep-card-hint">\uD074\uB9AD \uC2DC \uBCF8\uBB38 \uC704\uCE58 \uD655\uC778</span>
          <button class="sep-card-restore-btn" data-idx="${idx}" title="\uC774 \uB2E8\uB77D\uC758 \uBC88\uC5ED \uC81C\uC678\uB97C \uCDE8\uC18C\uD558\uACE0 \uB2E4\uC2DC \uBCF5\uC6D0\uD569\uB2C8\uB2E4">\u21A9\uFE0F \uBCF5\uC6D0</button>
        </div>
      </div>
    `;
    });
    panel.innerHTML = `
    <div class="separator-exclude-header">
      <div class="separator-exclude-title">
        <span>\u2702\uFE0F \uAD6C\uBD84\uC120 \uAE30\uC900 \uBC88\uC5ED \uC790\uB3D9 \uC81C\uC678 (${excludedItems.length}\uAC74)</span>
      </div>
      <div class="separator-exclude-actions">
        <button id="sep-exclude-restore-all-btn" class="sep-exclude-restore-all-btn" title="\uC81C\uC678\uB41C ${excludedItems.length}\uAC74\uC744 \uBAA8\uB450 \uBC88\uC5ED \uC0C1\uD0DC\uB85C \uBCF5\uC6D0\uD569\uB2C8\uB2E4">\u21A9\uFE0F \uC804\uCCB4 \uBCF5\uC6D0</button>
        <button id="sep-exclude-panel-close-btn" class="sep-exclude-close-btn" title="\uD328\uB110 \uB2EB\uAE30">&times;</button>
      </div>
    </div>
    <div class="separator-exclude-desc">
      \uC124\uC815\uB41C \uAD6C\uBD84\uC120\uACFC \uC77C\uCE58\uD558\uAC70\uB098 \uAD6C\uBD84\uC120 \uC774\uD6C4(\uD6C4\uAE30)\uC5D0 \uC704\uCE58\uD558\uC5EC \uAE30\uC874 \uBC88\uC5ED\uC774 \uC81C\uC678(\uC6D0\uBB38 \uBCF5\uC6D0)\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC798\uBABB \uC81C\uC678\uB41C \uACBD\uC6B0 [\uBCF5\uC6D0]\uC744 \uB20C\uB7EC \uB418\uB3CC\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.
    </div>
    <div class="separator-exclude-body">
      ${cardsHtml}
    </div>
  `;
    panel.style.display = "block";
    panel.querySelectorAll(".separator-exclude-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const target = e.target;
        if (target && target.closest(".sep-card-restore-btn")) return;
        const pid = card.getAttribute("data-pid");
        if (pid) focusAndScrollToPid(pid);
      });
    });
    panel.querySelectorAll(".sep-card-restore-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-idx") || "0", 10);
        const targetItem = excludedItems[idx];
        if (!targetItem) return;
        const btnEl = btn;
        btnEl.disabled = true;
        btnEl.textContent = "\uBCF5\uC6D0 \uC911...";
        await restoreExcludedItems([targetItem]);
      });
    });
    const restoreAllBtn = document.getElementById("sep-exclude-restore-all-btn");
    if (restoreAllBtn) {
      restoreAllBtn.addEventListener("click", async () => {
        restoreAllBtn.disabled = true;
        restoreAllBtn.textContent = "\uC804\uCCB4 \uBCF5\uC6D0 \uC911...";
        await restoreExcludedItems([...excludedItems]);
      });
    }
    const closeBtn = document.getElementById("sep-exclude-panel-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        panel.style.display = "none";
      });
    }
  }
  async function checkAndExcludeSeparatorTranslations(translationsList) {
    if (!translationsList || !Array.isArray(translationsList) || translationsList.length === 0) return;
    if (!state.activeSeparators || state.activeSeparators.length === 0) return;
    const allParagraphs = getTargetParagraphs();
    const validParagraphs = [];
    allParagraphs.forEach((p) => {
      if (!p || p.id === "tagCount" || /^(la|lp)\d+$/i.test(p.id)) return;
      const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
      if (text) {
        validParagraphs.push({ element: p, text, pid: p.id });
      }
    });
    const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);
    const excludedPidMap = sepAnalysis.excludedPidMap;
    const targetsToExclude = [];
    const targetIds = [];
    translationsList.forEach((t) => {
      if (!t || !t.id) return;
      if (state.exclusionSet.has(t.original)) return;
      let matchedInfo = null;
      if (t.pid && excludedPidMap.has(t.pid)) {
        matchedInfo = excludedPidMap.get(t.pid);
      } else if (t.original) {
        const matchedSep = checkSeparatorMatch(t.original.trim(), state.activeSeparators);
        if (matchedSep) {
          matchedInfo = { matchedSep, isSubsequent: false, isPreface: false };
        }
      }
      if (matchedInfo && t.translated && t.translated.trim()) {
        targetsToExclude.push({
          id: t.id,
          pid: t.pid,
          original: t.original,
          translated: t.translated,
          matchedSep: matchedInfo.matchedSep,
          isSubsequent: matchedInfo.isSubsequent,
          isPreface: matchedInfo.isPreface
        });
        targetIds.push(t.id);
      }
    });
    if (targetsToExclude.length === 0) return;
    try {
      const response = await fetch("http://127.0.0.1:8001/translations/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: targetIds })
      });
      if (!response.ok) return;
      targetsToExclude.forEach((item) => {
        if (item.pid) {
          state.userDeletedTranslationPids.add(String(item.pid));
          state.translationCache.delete(item.pid);
        }
        if (item.original) {
          state.exclusionSet.add(item.original);
        }
        const idx = translationsList.findIndex((t) => t.id === item.id);
        if (idx !== -1) {
          translationsList.splice(idx, 1);
        }
        if (item.pid) {
          const row = document.querySelector(`tr[data-pid="${item.pid}"]`);
          if (row) row.remove();
          const pTag = document.getElementById(item.pid);
          if (pTag && pTag.dataset.lanovelOriginalHtml) {
            pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
            pTag.classList.remove("lanovel-applied-text");
            if (pTag.dataset.lanovelOriginalStyle) {
              pTag.setAttribute("style", pTag.dataset.lanovelOriginalStyle);
            } else {
              pTag.removeAttribute("style");
            }
          }
        }
      });
      updateApplyButtonUI(state.isPageApplied);
      state.separatorExcludedItems = targetsToExclude;
      renderSeparatorExcludePanel(targetsToExclude);
      showSidebar();
    } catch (e) {
      console.warn("[checkAndExcludeSeparatorTranslations] Server call failed:", e);
    }
  }
  async function restoreExcludedItems(itemsToRestore) {
    if (!itemsToRestore || itemsToRestore.length === 0) return;
    const cleanUrl = getCleanUrl();
    try {
      const response = await fetch("http://127.0.0.1:8001/translations/restore_excluded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanUrl,
          items: itemsToRestore.map((it) => ({
            id: it.id,
            pid: it.pid,
            original: it.original,
            translated: it.translated
          }))
        })
      });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const allParagraphs = getTargetParagraphs();
      itemsToRestore.forEach((item) => {
        if (item.original) {
          state.exclusionSet.delete(item.original);
        }
        if (item.pid) {
          state.userDeletedTranslationPids.delete(String(item.pid));
          if (item.translated && item.translated.trim()) {
            const restoredEntry = {
              id: item.id,
              pid: item.pid,
              original: item.original,
              translated: item.translated
            };
            state.translationCache.set(item.pid, restoredEntry);
            addEntryToSidebar(restoredEntry);
          }
        }
      });
      sortSidebar(allParagraphs.map((p) => p.id));
      if (state.isPageApplied) {
        const validRestored = itemsToRestore.filter(
          (it) => it.pid && it.translated && it.translated.trim()
        );
        if (validRestored.length > 0) {
          applyTranslationsToPage(validRestored, false);
        }
      }
      updateApplyButtonUI(state.isPageApplied);
      const restoredOriginals = new Set(itemsToRestore.map((it) => it.original));
      state.separatorExcludedItems = state.separatorExcludedItems.filter(
        (it) => !restoredOriginals.has(it.original)
      );
      renderSeparatorExcludePanel(state.separatorExcludedItems);
      logToSidebar(`\u2713 \uC81C\uC678\uB418\uC5C8\uB358 \uB2E8\uB77D ${itemsToRestore.length}\uAC74\uC744 \uB2E4\uC2DC \uBCF5\uC6D0\uD588\uC2B5\uB2C8\uB2E4.`);
    } catch (err) {
      console.error("[restoreExcludedItems] Failed to restore:", err);
      logToSidebar(`\uC81C\uC678 \uB2E8\uB77D \uBCF5\uC6D0 \uC2E4\uD328: ${err.message}`, "log-error");
      renderSeparatorExcludePanel(state.separatorExcludedItems);
    }
  }
  async function openExcludedManager() {
    const cleanUrl = getCleanUrl();
    try {
      const resp = await fetch(
        `http://127.0.0.1:8001/translations/excluded_details?url=${encodeURIComponent(cleanUrl)}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = data.excluded_items || [];
      if (items.length === 0) {
        alert("\uD604\uC7AC \uD398\uC774\uC9C0(\uD68C\uCC28)\uC5D0\uC11C \uBC88\uC5ED \uC81C\uC678\uB41C \uB2E8\uB77D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        return;
      }
      state.separatorExcludedItems = items.map((it) => ({
        id: it.id,
        pid: it.pid,
        original: it.original,
        translated: it.translated,
        matchedSep: "\uC81C\uC678\uB428",
        isSubsequent: false
      }));
      renderSeparatorExcludePanel(state.separatorExcludedItems);
      const sepSettingsPanel = document.getElementById("separator-settings-panel");
      if (sepSettingsPanel) sepSettingsPanel.style.display = "none";
      showSidebar();
    } catch (e) {
      console.error("[openExcludedManager] Error:", e);
      logToSidebar(`\uC81C\uC678 \uB2E8\uB77D \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328: ${e.message}`, "log-error");
    }
  }
  function bindSeparatorPanelEvents() {
    const sepBtn1 = document.getElementById("separator-settings-btn");
    const sepBtn2 = document.getElementById("toggle-sep-panel-btn");
    const closeSepBtn = document.getElementById("close-sep-panel-btn");
    if (sepBtn1) sepBtn1.addEventListener("click", toggleSeparatorPanel);
    if (sepBtn2) sepBtn2.addEventListener("click", toggleSeparatorPanel);
    if (closeSepBtn) {
      closeSepBtn.addEventListener("click", () => {
        const panel = document.getElementById("separator-settings-panel");
        if (panel) panel.style.display = "none";
      });
    }
    const useDefaultsCheck = document.getElementById("use-global-defaults-check");
    if (useDefaultsCheck) {
      useDefaultsCheck.addEventListener("change", (e) => {
        const checked = e.target.checked;
        state.separatorConfig.useDefaults = checked;
        if (checked) {
          DEFAULT_GLOBAL_SEPARATORS.forEach((d) => {
            if (!state.activeSeparators.includes(d)) state.activeSeparators.unshift(d);
          });
        } else {
          state.activeSeparators = state.activeSeparators.filter(
            (s) => !DEFAULT_GLOBAL_SEPARATORS.includes(s) || state.separatorConfig.customSeparators.includes(s)
          );
        }
        renderSeparatorSettingsPanel();
      });
    }
    const addSepBtn = document.getElementById("add-separator-btn");
    const newSepInput = document.getElementById("new-separator-input");
    if (addSepBtn && newSepInput) {
      const handleAdd = () => {
        const val = newSepInput.value.trim();
        if (val) {
          addSeparatorTag(val);
          newSepInput.value = "";
        }
      };
      addSepBtn.addEventListener("click", handleAdd);
      newSepInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAdd();
      });
    }
    const saveSepBtn = document.getElementById("save-separators-btn");
    if (saveSepBtn) {
      saveSepBtn.addEventListener("click", async () => {
        const useDefaults = useDefaultsCheck ? useDefaultsCheck.checked : true;
        const customList = state.activeSeparators.filter((s) => !DEFAULT_GLOBAL_SEPARATORS.includes(s));
        const saved = await saveNovelSeparators(
          state.currentNovelTitle,
          useDefaults ? customList : state.activeSeparators,
          useDefaults
        );
        if (saved) {
          state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
          state.activeSeparators = state.separatorConfig.effectiveSeparators;
          renderSeparatorSettingsPanel();
          logToSidebar(
            `[\uAD6C\uBD84\uC120 \uC800\uC7A5 \uC644\uB8CC] '${state.currentNovelTitle}' \uC18C\uC124\uC758 \uAD6C\uBD84\uC120 \uC124\uC815(${state.activeSeparators.length}\uAC1C)\uC774 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
          );
          const panel = document.getElementById("separator-settings-panel");
          if (panel) panel.style.display = "none";
          const currentTranslations = await ensureTranslationsLoaded();
          if (currentTranslations && currentTranslations.length > 0) {
            await checkAndExcludeSeparatorTranslations(currentTranslations);
          }
        } else {
          logToSidebar("[\uC624\uB958] \uAD6C\uBD84\uC120 \uC124\uC815 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.", "log-error");
        }
      });
    }
    const resetSepBtn = document.getElementById("reset-separators-btn");
    if (resetSepBtn) {
      resetSepBtn.addEventListener("click", async () => {
        const ok = await resetNovelSeparators(state.currentNovelTitle);
        if (ok) {
          state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
          state.activeSeparators = state.separatorConfig.effectiveSeparators;
          renderSeparatorSettingsPanel();
          logToSidebar(
            `[\uAD6C\uBD84\uC120 \uCD08\uAE30\uD654] '${state.currentNovelTitle || "\uAE30\uBCF8 \uC18C\uC124"}'\uC758 \uAD6C\uBD84\uC120\uC774 \uAE30\uBCF8\uAC12\uC73C\uB85C \uBCF5\uC6D0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
          );
        } else {
          logToSidebar("[\uC624\uB958] \uAD6C\uBD84\uC120 \uCD08\uAE30\uD654\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.", "log-error");
        }
      });
    }
    const openExcludedBtn = document.getElementById("open-excluded-manager-btn");
    if (openExcludedBtn) {
      openExcludedBtn.addEventListener("click", () => {
        openExcludedManager();
      });
    }
    const headerExcludedBtn = document.getElementById("sidebar-excluded-list-btn");
    if (headerExcludedBtn) {
      headerExcludedBtn.addEventListener("click", () => {
        openExcludedManager();
      });
    }
  }
  var init_separator_panel = __esm({
    "src/ui/separator_panel.ts"() {
      "use strict";
      init_state();
      init_separators();
      init_page_translator();
      init_sidebar();
      init_review_panel();
    }
  });

  // src/ui/hud.ts
  function escapeHtml2(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
  function showLanovelHud(message, icon = "\u{1F4D6}", durationMs = 2200) {
    let hud = document.getElementById("lanovel-hud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "lanovel-hud";
      document.body.appendChild(hud);
    }
    hud.innerHTML = `<span class="hud-icon">${icon}</span><span class="hud-message">${escapeHtml2(message)}</span>`;
    hud.classList.add("visible");
    if (hudTimer) {
      clearTimeout(hudTimer);
    }
    hudTimer = setTimeout(() => {
      if (hud) hud.classList.remove("visible");
    }, durationMs);
  }
  var hudTimer;
  var init_hud = __esm({
    "src/ui/hud.ts"() {
      "use strict";
      hudTimer = null;
    }
  });

  // src/ui/toc_quick_jump.ts
  function normalizeUrlKey(url) {
    if (!url) return "";
    return url.split("#")[0].split("?")[0].replace(/\/$/, "");
  }
  async function getExcludedEpisodeUrls() {
    try {
      const stored = await chrome.storage.local.get(EXCLUDED_EPISODES_STORAGE_KEY);
      if (Array.isArray(stored[EXCLUDED_EPISODES_STORAGE_KEY])) {
        return stored[EXCLUDED_EPISODES_STORAGE_KEY];
      }
    } catch (e) {
      console.warn("[LANOVEL] \uC81C\uC678 \uD68C\uCC28 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328:", e);
    }
    return [];
  }
  async function isEpisodeUrlExcluded(targetUrl) {
    if (!targetUrl) return false;
    const clean = normalizeUrlKey(targetUrl);
    const list = await getExcludedEpisodeUrls();
    const set = new Set(list.map(normalizeUrlKey));
    return set.has(clean);
  }
  async function toggleEpisodeUrlExcluded(targetUrl) {
    if (!targetUrl) return false;
    const clean = normalizeUrlKey(targetUrl);
    const list = await getExcludedEpisodeUrls();
    const set = new Set(list.map(normalizeUrlKey));
    let isNowExcluded = false;
    if (set.has(clean)) {
      set.delete(clean);
      isNowExcluded = false;
    } else {
      set.add(clean);
      isNowExcluded = true;
    }
    try {
      await chrome.storage.local.set({ [EXCLUDED_EPISODES_STORAGE_KEY]: Array.from(set) });
    } catch (e) {
      console.warn("[LANOVEL] \uC81C\uC678 \uD68C\uCC28 \uBAA9\uB85D \uC800\uC7A5 \uC2E4\uD328:", e);
    }
    return isNowExcluded;
  }
  function escapeHtml3(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
  async function initTocPageFeatures(scraper) {
    if (!scraper.isTocPage(window.location.href, window.location.pathname)) return;
    console.log("[LANOVEL] \uBAA9\uCC28 \uD398\uC774\uC9C0 \uAC10\uC9C0: \uD68C\uCC28\uBCC4 \uBC88\uC5ED \uC0C1\uD0DC \uBC30\uC9C0 \uBC0F \uD035 \uC810\uD504 \uD328\uB110\uC744 \uCD08\uAE30\uD654\uD569\uB2C8\uB2E4.");
    let episodeItems = [];
    for (let retry = 0; retry < 5; retry++) {
      if (scraper.getTocEpisodes) {
        episodeItems = scraper.getTocEpisodes();
      }
      if (episodeItems.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!episodeItems.length) {
      console.log("[LANOVEL] \uBAA9\uCC28 \uD398\uC774\uC9C0\uC774\uB098 \uD68C\uCC28 \uB9C1\uD06C \uC694\uC18C\uB97C \uBC1C\uACAC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    const episodeDataList = [];
    const urlSet = /* @__PURE__ */ new Set();
    episodeItems.forEach((item) => {
      if (!item.url) return;
      const cleanUrl = new URL(item.url, window.location.href).href.split("#")[0];
      if (!urlSet.has(cleanUrl)) {
        urlSet.add(cleanUrl);
        episodeDataList.push({
          element: item.element,
          url: cleanUrl,
          title: item.title
        });
      }
    });
    if (!episodeDataList.length) return;
    const translatedSet = /* @__PURE__ */ new Set();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5e3);
      const resp = await fetch("http://127.0.0.1:8001/api/check_translated_urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: Array.from(urlSet) }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        const list = data.translated_urls || [];
        list.forEach((u) => {
          const norm = normalizeUrlKey(u);
          translatedSet.add(norm);
          translatedSet.add(norm + "/");
          if (norm.startsWith("http://") || norm.startsWith("https://")) {
            const pathOnly = norm.replace(/^https?:\/\/[^\/]+/, "");
            if (pathOnly) {
              translatedSet.add(pathOnly);
              translatedSet.add(pathOnly + "/");
            }
          }
        });
      }
    } catch (e) {
      console.warn("[LANOVEL] \uC11C\uBC84 \uBC88\uC5ED URL \uD655\uC778 \uC911 \uC624\uB958 \uBC1C\uC0DD (\uAE30\uBCF8 \uC9C4\uD589):", e);
    }
    const excludedUrls = await getExcludedEpisodeUrls();
    const excludedSet = new Set(excludedUrls.map(normalizeUrlKey));
    untranslatedEpisodesCache = [];
    episodeDataList.forEach((item, index) => {
      const cleanNoSlash = normalizeUrlKey(item.url);
      const pathOnly = cleanNoSlash.replace(/^https?:\/\/[^\/]+/, "");
      const isTranslated = translatedSet.has(cleanNoSlash) || translatedSet.has(cleanNoSlash + "/") || pathOnly && (translatedSet.has(pathOnly) || translatedSet.has(pathOnly + "/"));
      const isExcluded = excludedSet.has(cleanNoSlash);
      const badge = document.createElement("span");
      badge.className = `lanovel-toc-badge ${isTranslated ? "translated" : isExcluded ? "excluded" : "untranslated"}`;
      badge.innerHTML = `<span class="badge-dot"></span>${isTranslated ? "\uC644\uB8CC" : isExcluded ? "\uC81C\uC678" : "\uBBF8\uBC88\uC5ED"}`;
      badge.title = isTranslated ? "\uBC88\uC5ED \uC644\uB8CC" : isExcluded ? "\uBC88\uC5ED \uC81C\uC678\uB428 (\uD074\uB9AD\uD558\uC5EC \uD574\uC81C)" : "\uBBF8\uBC88\uC5ED (\uD074\uB9AD\uD558\uC5EC \uBC88\uC5ED \uC81C\uC678)";
      if (!isTranslated) {
        badge.style.cursor = "pointer";
        badge.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await toggleExclusionForItem(item.url, item.title);
        });
      }
      if (item.element) {
        const existingBadge = item.element.parentNode?.querySelector(".lanovel-toc-badge") || item.element.querySelector(".lanovel-toc-badge");
        if (!existingBadge) {
          if (item.element.parentNode) {
            item.element.insertAdjacentElement("afterend", badge);
          } else {
            item.element.appendChild(badge);
          }
        }
      }
      if (!isTranslated) {
        untranslatedEpisodesCache.push({
          index: untranslatedEpisodesCache.length,
          tocIndex: index,
          title: item.title,
          url: item.url,
          element: item.element,
          badgeElement: badge,
          isExcluded
        });
      }
    });
    console.log(`[LANOVEL] TOC \uCD08\uAE30\uD654 \uC644\uB8CC: \uCD1D ${episodeDataList.length}\uAC1C \uD68C\uCC28 \uC911 ${untranslatedEpisodesCache.length}\uAC1C \uBBF8\uBC88\uC5ED \uBC1C\uACAC`);
    renderQuickJumpPanel(untranslatedEpisodesCache);
  }
  function renderQuickJumpPanel(untranslatedList) {
    let container = document.getElementById("lanovel-quick-jump-container");
    if (container) container.remove();
    container = document.createElement("div");
    container.id = "lanovel-quick-jump-container";
    const activeCount = untranslatedList.filter((ep) => !ep.isExcluded).length;
    const count = activeCount;
    const sidebarCtrlBtn = document.getElementById("sidebar-quick-jump-toggle-btn");
    if (sidebarCtrlBtn) {
      sidebarCtrlBtn.title = `\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D (${count}\uD654) \uB744\uC6B0\uAE30/\uB2EB\uAE30`;
    }
    const bannerBtn = document.getElementById("banner-quick-jump-btn");
    if (bannerBtn) {
      bannerBtn.textContent = `\u26A1 \uBBF8\uBC88\uC5ED ${count}\uD654`;
    }
    const triggerHtml = `
    <div id="lanovel-quick-jump-trigger" title="\uD074\uB9AD\uD558\uAC70\uB098 'N' \uD0A4\uB97C \uB20C\uB7EC \uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D \uBCF4\uAE30">
      <span class="trigger-icon">\u26A1</span>
      <span>\uBBF8\uBC88\uC5ED <strong id="lanovel-trigger-count">${count}</strong>\uD654</span>
      <span class="trigger-keyhint">N</span>
    </div>
  `;
    const itemsHtml = untranslatedList.length > 0 ? untranslatedList.map(
      (ep, idx) => `
      <li class="quick-jump-item ${ep.isExcluded ? "is-excluded" : ""}" data-jump-index="${idx}" data-url="${escapeHtml3(ep.url)}" title="${escapeHtml3(ep.title)}">
        <span class="item-title ${ep.isExcluded ? "is-excluded" : ""}">${escapeHtml3(ep.title)}</span>
        <div class="item-actions">
          <button type="button" class="quick-jump-exclude-btn ${ep.isExcluded ? "is-excluded" : ""}" data-url="${escapeHtml3(ep.url)}" title="${ep.isExcluded ? "\uBC88\uC5ED \uC81C\uC678 \uCDE8\uC18C" : "\uC774 \uD68C\uCC28 \uBC88\uC5ED \uC81C\uC678"}">
            ${ep.isExcluded ? "\uC81C\uC678\uB428" : "\uC81C\uC678"}
          </button>
          <span class="item-action-hint">Enter \uC774\uB3D9</span>
        </div>
      </li>
    `
    ).join("") : `
      <li class="quick-jump-item" style="justify-content: center; color: #10b981; cursor: default;">
        \u{1F389} \uBAA8\uB4E0 \uD68C\uCC28\uC758 \uBC88\uC5ED\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!
      </li>
    `;
    const drawerHtml = `
    <div id="lanovel-quick-jump-drawer">
      <div class="quick-jump-header">
        <div class="title-wrap">
          <span style="color: #f59e0b; font-size: 14px;">\u26A1</span>
          <h4>\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D</h4>
          <span class="count-badge" id="lanovel-header-count">${count}</span>
        </div>
        <button class="close-btn" id="lanovel-quick-jump-close" title="\uB2EB\uAE30 (ESC)">\u2715</button>
      </div>
      <ul class="quick-jump-list" id="lanovel-quick-jump-list">
        ${itemsHtml}
      </ul>
      <div class="quick-jump-footer">
        <span><kbd>N</kbd> / <kbd>\u2191\u2193</kbd> \uC120\uD0DD</span>
        <span><kbd>Enter</kbd> \uC790\uB3D9 \uBC88\uC5ED \uC9C4\uC785</span>
      </div>
    </div>
  `;
    container.innerHTML = triggerHtml + drawerHtml;
    document.body.appendChild(container);
    const trigger = document.getElementById("lanovel-quick-jump-trigger");
    if (trigger) {
      trigger.addEventListener("click", () => {
        toggleQuickJumpDrawer();
      });
    }
    const closeBtn = document.getElementById("lanovel-quick-jump-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        toggleQuickJumpDrawer(false);
      });
    }
    const listEl = document.getElementById("lanovel-quick-jump-list");
    if (listEl) {
      listEl.querySelectorAll(".quick-jump-exclude-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const url = btn.getAttribute("data-url");
          if (!url) return;
          const targetEp = untranslatedList.find((it) => it.url === url);
          await toggleExclusionForItem(url, targetEp ? targetEp.title : "");
        });
      });
      listEl.querySelectorAll(".quick-jump-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          if (e.target.closest(".quick-jump-exclude-btn")) return;
          const idx = parseInt(item.getAttribute("data-jump-index") || "-1", 10);
          if (!isNaN(idx) && untranslatedList[idx]) {
            const ep = untranslatedList[idx];
            if (ep.isExcluded) {
              showLanovelHud(`'${ep.title}'\uC740(\uB294) \uC81C\uC678\uB41C \uD68C\uCC28\uC785\uB2C8\uB2E4.`, "\u26A0\uFE0F", 2e3);
              return;
            }
            sessionStorage.setItem("lanovel_auto_translate_next", "1");
            showLanovelHud(`'${ep.title}' \uC9C4\uC785 \uBC0F \uC790\uB3D9 \uBC88\uC5ED...`, "\u26A1");
            setTimeout(() => {
              window.location.href = ep.url;
            }, 150);
          }
        });
      });
    }
  }
  async function toggleExclusionForItem(url, title) {
    if (!url) return;
    const targetEp = untranslatedEpisodesCache.find((it) => normalizeUrlKey(it.url) === normalizeUrlKey(url));
    const nowExcluded = await toggleEpisodeUrlExcluded(url);
    if (targetEp) {
      targetEp.isExcluded = nowExcluded;
      if (targetEp.badgeElement) {
        targetEp.badgeElement.className = `lanovel-toc-badge ${nowExcluded ? "excluded" : "untranslated"}`;
        targetEp.badgeElement.innerHTML = `<span class="badge-dot"></span>${nowExcluded ? "\uC81C\uC678" : "\uBBF8\uBC88\uC5ED"}`;
        targetEp.badgeElement.title = nowExcluded ? "\uBC88\uC5ED \uC81C\uC678\uB428 (\uD074\uB9AD\uD558\uC5EC \uD574\uC81C)" : "\uBBF8\uBC88\uC5ED (\uD074\uB9AD\uD558\uC5EC \uBC88\uC5ED \uC81C\uC678)";
      }
    }
    const listEl = document.getElementById("lanovel-quick-jump-list");
    if (listEl) {
      const itemEl = listEl.querySelector(`.quick-jump-item[data-url="${escapeHtml3(url)}"]`);
      if (itemEl) {
        itemEl.classList.toggle("is-excluded", nowExcluded);
        const titleEl = itemEl.querySelector(".item-title");
        if (titleEl) titleEl.classList.toggle("is-excluded", nowExcluded);
        const btnEl = itemEl.querySelector(".quick-jump-exclude-btn");
        if (btnEl) {
          btnEl.classList.toggle("is-excluded", nowExcluded);
          btnEl.textContent = nowExcluded ? "\uC81C\uC678\uB428" : "\uC81C\uC678";
          btnEl.setAttribute("title", nowExcluded ? "\uBC88\uC5ED \uC81C\uC678 \uCDE8\uC18C" : "\uC774 \uD68C\uCC28 \uBC88\uC5ED \uC81C\uC678");
        }
      }
    }
    const activeCount = untranslatedEpisodesCache.filter((ep) => !ep.isExcluded).length;
    const headerCount = document.getElementById("lanovel-header-count");
    if (headerCount) headerCount.textContent = String(activeCount);
    const triggerCount = document.getElementById("lanovel-trigger-count");
    if (triggerCount) triggerCount.textContent = String(activeCount);
    const sidebarCtrlBtn = document.getElementById("sidebar-quick-jump-toggle-btn");
    if (sidebarCtrlBtn) {
      sidebarCtrlBtn.title = `\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D (${activeCount}\uD654) \uB744\uC6B0\uAE30/\uB2EB\uAE30`;
    }
    const bannerBtn = document.getElementById("banner-quick-jump-btn");
    if (bannerBtn) {
      bannerBtn.textContent = `\u26A1 \uBBF8\uBC88\uC5ED ${activeCount}\uD654`;
    }
    if (nowExcluded) {
      showLanovelHud(`'${title || "\uD68C\uCC28"}' \uBC88\uC5ED \uBAA9\uB85D\uC5D0\uC11C \uC81C\uC678\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`, "\u{1F6AB}", 2200);
    } else {
      showLanovelHud(`'${title || "\uD68C\uCC28"}' \uBC88\uC5ED \uBAA9\uB85D\uC5D0 \uB2E4\uC2DC \uD3EC\uD568\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`, "\u26A1", 2200);
    }
  }
  function toggleQuickJumpDrawer(open) {
    const drawer = document.getElementById("lanovel-quick-jump-drawer");
    if (!drawer) return;
    if (typeof open === "boolean") {
      if (open) {
        drawer.classList.add("open");
      } else {
        drawer.classList.remove("open");
      }
    } else {
      drawer.classList.toggle("open");
    }
  }
  function handleQuickJumpNKey() {
    const activeEpisodes = untranslatedEpisodesCache.map((ep, idx) => ({ ep, idx })).filter((item) => !item.ep.isExcluded);
    if (!activeEpisodes.length) {
      showLanovelHud("\uBAA8\uB4E0 \uD68C\uCC28\uAC00 \uC774\uBBF8 \uBC88\uC5ED \uC644\uB8CC \uB610\uB294 \uC81C\uC678\uB418\uC5C8\uC2B5\uB2C8\uB2E4!", "\u{1F389}");
      return;
    }
    const drawer = document.getElementById("lanovel-quick-jump-drawer");
    if (!drawer) return;
    if (!drawer.classList.contains("open")) {
      drawer.classList.add("open");
      quickJumpFocusedIndex = activeEpisodes[0].idx;
    } else {
      const currentPos = activeEpisodes.findIndex((item) => item.idx === quickJumpFocusedIndex);
      const nextPos = (currentPos + 1) % activeEpisodes.length;
      quickJumpFocusedIndex = activeEpisodes[nextPos].idx;
    }
    updateQuickJumpFocusUI();
  }
  function moveQuickJumpFocus(delta) {
    if (!untranslatedEpisodesCache.length) return;
    quickJumpFocusedIndex = (quickJumpFocusedIndex + delta + untranslatedEpisodesCache.length) % untranslatedEpisodesCache.length;
    updateQuickJumpFocusUI();
  }
  function updateQuickJumpFocusUI() {
    const listEl = document.getElementById("lanovel-quick-jump-list");
    if (!listEl) return;
    const items = listEl.querySelectorAll(".quick-jump-item");
    items.forEach((item, idx) => {
      if (idx === quickJumpFocusedIndex) {
        item.classList.add("focused");
        item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        item.classList.remove("focused");
      }
    });
    const targetEp = untranslatedEpisodesCache[quickJumpFocusedIndex];
    if (targetEp && targetEp.element && targetEp.element.isConnected) {
      targetEp.element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  function getNovelTocUrl(scraper, currentUrl = window.location.href) {
    if (scraper.findTocLink) {
      const link = scraper.findTocLink();
      if (link && link.href) {
        const clean = link.href.split("#")[0].split("?")[0];
        if (clean) return clean;
      }
    }
    try {
      const parsed = new URL(currentUrl);
      const host = parsed.hostname;
      const path = parsed.pathname;
      if (host.includes("kakuyomu.jp")) {
        const m = path.match(/\/works\/(\d+)/);
        if (m) return `https://kakuyomu.jp/works/${m[1]}`;
      }
      if (host.includes("syosetu.com")) {
        const m = path.match(/\/(n[a-z0-9]+)/i);
        if (m) return `${parsed.origin}/${m[1].toLowerCase()}/`;
      }
      if (host.includes("novelup.plus")) {
        const m = path.match(/\/story\/(\d+)/);
        if (m) return `https://novelup.plus/story/${m[1]}`;
      }
      if (host.includes("alphapolis.co.jp")) {
        const m = path.match(/\/novel\/(\d+\/\d+)/);
        if (m) return `https://www.alphapolis.co.jp/novel/${m[1]}`;
      }
      if (host.includes("syosetu.org")) {
        const m = path.match(/\/novel\/(\d+)/);
        if (m) return `https://syosetu.org/novel/${m[1]}/`;
      }
    } catch (e) {
      console.warn("[LANOVEL] \uBAA9\uCC28 URL \uC5ED\uC0B0 \uC2E4\uD328:", e);
    }
    return null;
  }
  async function loadRemoteTocEpisodes(scraper) {
    const tocUrl = getNovelTocUrl(scraper);
    if (!tocUrl) {
      showLanovelHud("\uC18C\uC124 \uBAA9\uCC28 URL\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", "\u26A0\uFE0F", 2500);
      return false;
    }
    showLanovelHud("\uC18C\uC124 \uBAA9\uCC28 \uBC0F \uBC88\uC5ED \uC0C1\uD0DC\uB97C \uBD88\uB7EC\uC624\uB294 \uC911...", "\u23F3", 3e3);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6e3);
      const resp = await fetch(tocUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        showLanovelHud(`\uBAA9\uCC28 \uC694\uCCAD \uC2E4\uD328 (HTTP ${resp.status})`, "\u26A0\uFE0F", 2500);
        return false;
      }
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      let episodeItems = [];
      if (scraper.getTocEpisodes) {
        episodeItems = scraper.getTocEpisodes(doc);
      }
      if (!episodeItems.length) {
        showLanovelHud("\uBAA9\uCC28\uC5D0\uC11C \uD68C\uCC28 \uBAA9\uB85D\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", "\u26A0\uFE0F", 2500);
        return false;
      }
      const episodeDataList = [];
      const urlSet = /* @__PURE__ */ new Set();
      episodeItems.forEach((item) => {
        if (!item.url) return;
        const cleanUrl = new URL(item.url, tocUrl).href.split("#")[0];
        if (!urlSet.has(cleanUrl)) {
          urlSet.add(cleanUrl);
          episodeDataList.push({
            element: item.element,
            url: cleanUrl,
            title: item.title
          });
        }
      });
      if (!episodeDataList.length) return false;
      const translatedSet = /* @__PURE__ */ new Set();
      try {
        const serverCtrl = new AbortController();
        const sTimeout = setTimeout(() => serverCtrl.abort(), 5e3);
        const checkResp = await fetch("http://127.0.0.1:8001/api/check_translated_urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: Array.from(urlSet) }),
          signal: serverCtrl.signal
        });
        clearTimeout(sTimeout);
        if (checkResp.ok) {
          const data = await checkResp.json();
          const list = data.translated_urls || [];
          list.forEach((u) => {
            const norm = normalizeUrlKey(u);
            translatedSet.add(norm);
            translatedSet.add(norm + "/");
            if (norm.startsWith("http://") || norm.startsWith("https://")) {
              const pathOnly = norm.replace(/^https?:\/\/[^\/]+/, "");
              if (pathOnly) {
                translatedSet.add(pathOnly);
                translatedSet.add(pathOnly + "/");
              }
            }
          });
        }
      } catch (e) {
        console.warn("[LANOVEL] \uC11C\uBC84 \uBC88\uC5ED URL \uD655\uC778 \uC911 \uC624\uB958 \uBC1C\uC0DD:", e);
      }
      const excludedUrls = await getExcludedEpisodeUrls();
      const excludedSet = new Set(excludedUrls.map(normalizeUrlKey));
      untranslatedEpisodesCache = [];
      episodeDataList.forEach((item, index) => {
        const cleanNoSlash = normalizeUrlKey(item.url);
        const pathOnly = cleanNoSlash.replace(/^https?:\/\/[^\/]+/, "");
        const isTranslated = translatedSet.has(cleanNoSlash) || translatedSet.has(cleanNoSlash + "/") || pathOnly && (translatedSet.has(pathOnly) || translatedSet.has(pathOnly + "/"));
        const isExcluded = excludedSet.has(cleanNoSlash);
        if (!isTranslated) {
          untranslatedEpisodesCache.push({
            index: untranslatedEpisodesCache.length,
            tocIndex: index,
            title: item.title,
            url: item.url,
            element: item.element,
            isExcluded
          });
        }
      });
      console.log(`[LANOVEL] \uC6D0\uACA9 \uBAA9\uCC28 \uB85C\uB4DC \uC644\uB8CC: \uCD1D ${episodeDataList.length}\uAC1C \uD68C\uCC28 \uC911 ${untranslatedEpisodesCache.length}\uAC1C \uBBF8\uBC88\uC5ED \uBC1C\uACAC`);
      renderQuickJumpPanel(untranslatedEpisodesCache);
      if (untranslatedEpisodesCache.length > 0) {
        showLanovelHud(`\uBBF8\uBC88\uC5ED \uD68C\uCC28 ${untranslatedEpisodesCache.length}\uD654 \uB85C\uB4DC \uC644\uB8CC`, "\u26A1", 1800);
      } else {
        showLanovelHud("\uBAA8\uB4E0 \uD68C\uCC28\uC758 \uBC88\uC5ED\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!", "\u{1F389}", 2e3);
      }
      return true;
    } catch (err) {
      console.error("[LANOVEL] \uBE44\uB3D9\uAE30 \uBAA9\uCC28 \uB85C\uB4DC \uC2E4\uD328:", err);
      showLanovelHud("\uBAA9\uCC28\uB97C \uBD88\uB7EC\uC624\uB294 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", "\u274C", 2500);
      return false;
    }
  }
  async function toggleQuickJumpFromSidebar() {
    const drawer = document.getElementById("lanovel-quick-jump-drawer");
    const container = document.getElementById("lanovel-quick-jump-container");
    if (drawer && drawer.classList.contains("open")) {
      toggleQuickJumpDrawer(false);
      showLanovelHud("\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uC11C\uB78D\uC744 \uB2EB\uC558\uC2B5\uB2C8\uB2E4.", "\u26A1", 1500);
      return;
    }
    if (drawer && container) {
      toggleQuickJumpDrawer(true);
      showLanovelHud("\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uC11C\uB78D\uC744 \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4.", "\u26A1", 1500);
      return;
    }
    const scraper = getScraper();
    if (scraper.isTocPage(window.location.href, window.location.pathname)) {
      showLanovelHud("\uBAA9\uCC28 \uD68C\uCC28 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911...", "\u23F3", 1500);
      await initTocPageFeatures(scraper);
      const newDrawer = document.getElementById("lanovel-quick-jump-drawer");
      if (newDrawer) {
        toggleQuickJumpDrawer(true);
        showLanovelHud("\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uC11C\uB78D\uC744 \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4.", "\u26A1", 1500);
      }
    } else {
      const ok = await loadRemoteTocEpisodes(scraper);
      if (ok) {
        toggleQuickJumpDrawer(true);
        showLanovelHud("\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uC11C\uB78D\uC744 \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4.", "\u26A1", 1500);
      }
    }
  }
  var EXCLUDED_EPISODES_STORAGE_KEY, quickJumpFocusedIndex, untranslatedEpisodesCache;
  var init_toc_quick_jump = __esm({
    "src/ui/toc_quick_jump.ts"() {
      "use strict";
      init_scrapers();
      init_hud();
      EXCLUDED_EPISODES_STORAGE_KEY = "lanovel_excluded_urls";
      quickJumpFocusedIndex = -1;
      untranslatedEpisodesCache = [];
    }
  });

  // src/ui/sidebar.ts
  function escapeHtml(text) {
    if (!text) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
  function logToSidebar(message, level = "log") {
    const consoleEl = document.getElementById("sidebar-log-console");
    if (!consoleEl) return;
    const now = /* @__PURE__ */ new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const p = document.createElement("p");
    p.className = `log-entry ${level === "log-error" ? "log-error" : level === "info" ? "log-info" : ""}`;
    p.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="log-msg">${escapeHtml(message)}</span>`;
    consoleEl.prepend(p);
    if (consoleEl.children.length > 60) {
      consoleEl.removeChild(consoleEl.lastChild);
    }
    const scrollContainer = consoleEl.closest(".sidebar-footer") || consoleEl;
    scrollContainer.scrollTop = 0;
    consoleEl.scrollTop = 0;
    state.recordLog(message);
  }
  function showSidebar() {
    const sidebar = document.getElementById("jp-translator-sidebar");
    if (sidebar) {
      sidebar.classList.add("visible");
      updateEmptyState();
      if (!state.hasScannedForPTags && state.onStartTranslation) {
        state.hasScannedForPTags = true;
        state.onStartTranslation(false);
      }
      state.broadcastStatus();
    }
  }
  function hideSidebar() {
    const sidebar = document.getElementById("jp-translator-sidebar");
    if (sidebar) {
      sidebar.classList.remove("visible");
    }
  }
  function toggleSidebar() {
    const sidebar = document.getElementById("jp-translator-sidebar");
    if (sidebar && sidebar.classList.contains("visible")) {
      hideSidebar();
    } else {
      showSidebar();
    }
  }
  function injectSidebar() {
    if (document.getElementById("jp-translator-sidebar")) return;
    const sidebar = document.createElement("div");
    sidebar.id = "jp-translator-sidebar";
    sidebar.innerHTML = `
    <div class="sidebar-header">
      <h3>\u{1F5FE} \uBC88\uC5ED \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4</h3>
      <div class="sidebar-controls">
        <button id="sidebar-quick-jump-toggle-btn" title="\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D(\uD035 \uC810\uD504 \uC11C\uB78D) \uB744\uC6B0\uAE30/\uB2EB\uAE30">\u26A1</button>
        <button id="sidebar-excluded-list-btn" title="\uC81C\uC678\uB41C \uB2E8\uB77D \uD655\uC778 \uBC0F \uBCF5\uC6D0">\u{1F6E1}\uFE0F</button>
        <button id="separator-settings-btn" title="\uC18C\uC124\uBCC4 \uAD6C\uBD84\uC120 \uC124\uC815">\u2699\uFE0F</button>
        <button id="stop-translation-btn" title="\uBC88\uC5ED \uC911\uC9C0" style="display:none;">\u23F9\uFE0F</button>
        <button id="resume-translation-btn" title="\uBC88\uC5ED \uC7AC\uAC1C" style="display:none;">\u25B6\uFE0F</button>
        <button id="retry-translation-btn" title="\uB2E4\uC2DC \uC2DC\uB3C4" style="display:none;">\u{1F504}</button>
        <button id="sidebar-close-btn" title="\uB2EB\uAE30">&times;</button>
      </div>
    </div>
    <div id="sidebar-novel-banner" class="sidebar-novel-banner">
      <div class="novel-banner-info">
        <span class="novel-banner-icon">\u{1F4D6}</span>
        <span id="current-novel-title-display" class="novel-banner-title" title="\uD074\uB9AD\uD558\uC5EC \uC18C\uC124 \uC81C\uBAA9 \uC218\uC815">\uC18C\uC124 \uAC10\uC9C0 \uC911...</span>
        <button id="edit-novel-title-btn" class="novel-banner-btn" title="\uC18C\uC124 \uC81C\uBAA9 \uC9C1\uC811 \uBCC0\uACBD">\u270F\uFE0F</button>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button id="banner-quick-jump-btn" class="novel-banner-btn" style="background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;" title="\uBBF8\uBC88\uC5ED \uD68C\uCC28 \uBAA9\uB85D \uB744\uC6B0\uAE30/\uB2EB\uAE30">\u26A1 \uBBF8\uBC88\uC5ED \uBAA9\uB85D</button>
        <button id="toggle-sep-panel-btn" class="novel-banner-sep-toggle" title="\uC774 \uC18C\uC124\uC758 \uAD6C\uBD84\uC120 \uC124\uC815">\u2699\uFE0F \uAD6C\uBD84\uC120 \uC124\uC815</button>
      </div>
    </div>
    <div id="separator-settings-panel" class="separator-settings-panel" style="display: none;">
      <div class="sep-panel-header">
        <span class="sep-panel-title">\u2699\uFE0F \uC18C\uC124\uBCC4 \uBC88\uC5ED \uAD6C\uBD84\uC120(\uC791\uAC00\uC758 \uB9D0) \uC124\uC815</span>
        <button id="close-sep-panel-btn" class="sep-close-btn">&times;</button>
      </div>
      <div class="sep-panel-body">
        <div class="sep-info-box">
          <span class="sep-novel-name" id="panel-novel-name-display"></span>\uC758 \uC791\uAC00\uC758 \uB9D0 \uAD6C\uBD84\uC120 \uC124\uC815\uC785\uB2C8\uB2E4. \uBCF8\uBB38 \uB9E5\uB77D\uC120\uACFC \uACB9\uCE58\uC9C0 \uC54A\uAC8C \uC8FC\uC758\uD558\uC138\uC694.
        </div>
        <div class="sep-form-group">
          <label class="sep-checkbox-label">
            <input type="checkbox" id="use-global-defaults-check" checked>
            <span>\uACF5\uD1B5 \uD6C4\uAE30 \uD0A4\uC6CC\uB4DC \uD3EC\uD568 (\uFF1C\u3042\u3068\u304C\u304D\uFF1E, \u3010\u5927\u4E8B\u306A\u304A\u77E5\u3089\u305B\u3011 \uB4F1)</span>
          </label>
        </div>
        <div class="sep-section-title">\uC801\uC6A9 \uC911\uC778 \uAD6C\uBD84\uC120 \uBAA9\uB85D:</div>
        <div id="active-separators-container" class="sep-tags-wrap"></div>
        <div class="sep-section-title">\uC790\uC8FC \uC4F0\uB294 \uAE30\uD638 \uBE60\uB978 \uCD94\uAC00:</div>
        <div id="preset-buttons-container" class="sep-presets-wrap"></div>
        <div class="sep-section-title">\uC0C8 \uAD6C\uBD84\uC120 \uC9C1\uC811 \uCD94\uAC00:</div>
        <div class="sep-input-row">
          <input type="text" id="new-separator-input" placeholder="\uCD94\uAC00\uD560 \uAE30\uD638/\uBB38\uC790\uC5F4 \uC785\uB825 (\uC608: \u25CE\u25CE\u25CE)" class="sep-input">
          <button id="add-separator-btn" class="sep-add-btn">\uCD94\uAC00</button>
        </div>
        <div class="sep-panel-footer">
          <button id="save-separators-btn" class="sep-save-btn">\u{1F4BE} \uC124\uC815 \uC800\uC7A5</button>
          <button id="reset-separators-btn" class="sep-reset-btn">\uAE30\uBCF8\uAC12 \uBCF5\uC6D0</button>
          <button id="open-excluded-manager-btn" class="sep-manage-excluded-btn" title="\uD604\uC7AC \uD398\uC774\uC9C0\uC5D0\uC11C \uC81C\uC678\uB41C \uBAA8\uB4E0 \uB2E8\uB77D\uC744 \uC870\uD68C\uD558\uACE0 \uBCF5\uC6D0\uD569\uB2C8\uB2E4">\u{1F6E1}\uFE0F \uC81C\uC678 \uB2E8\uB77D \uD655\uC778/\uBCF5\uC6D0</button>
        </div>
      </div>
    </div>
    <div id="sidebar-turbo-banner" class="sidebar-turbo-banner">
      <div class="turbo-info">
        <span class="turbo-icon">\u26A1</span>
        <span class="turbo-label">\uCF8C\uC18D\uBAA8\uB4DC</span>
        <span class="turbo-desc" id="turbo-desc-text">\uB300\uAE30: 2\uCD08 / 8\uCD08</span>
      </div>
      <div class="turbo-controls">
        <span id="turbo-cutoff-badge" class="turbo-cutoff-badge" title="\uD074\uB9AD\uD558\uC5EC \uAE30\uC900 \uC2DC\uAC04 \uBCC0\uACBD (\uC790\uB3D9 / 16:00 / 17:00)">\uAE30\uC900 16:00 (\uC368\uBA38\uD0C0\uC784)</span>
        <label class="turbo-switch" title="\uCF8C\uC18D\uBAA8\uB4DC ON/OFF (\uCD08\uAE30\uD654 \uC815\uAC01\uAE4C\uC9C0 \uBE60\uB978 \uBC88\uC5ED)">
          <input type="checkbox" id="sidebar-turbo-toggle">
          <span class="turbo-slider round"></span>
        </label>
      </div>
    </div>
    <div id="sidebar-apply-banner" class="sidebar-apply-banner">
      <div class="apply-status-info">
        <span id="apply-status-dot" class="status-dot"></span>
        <span id="apply-status-text" class="apply-status-text">\uC6D0\uBB38 \uD45C\uC2DC \uC911</span>
        <span id="apply-stats-count" class="apply-stats-count">(0\uAC1C \uC801\uC6A9)</span>
      </div>
      <button id="sidebar-apply-toggle-btn" class="sidebar-apply-btn" title="\uC6F9\uD398\uC774\uC9C0 \uBCF8\uBB38\uC5D0 \uBC88\uC5ED\uC744 \uC989\uC2DC \uC801\uC6A9\uD558\uAC70\uB098 \uC6D0\uBB38\uC73C\uB85C \uBCF5\uC6D0\uD569\uB2C8\uB2E4">
        <span id="apply-btn-icon" class="apply-btn-icon">\u{1F4C4}</span>
        <span id="apply-btn-text" class="apply-btn-text">\uD398\uC774\uC9C0\uC5D0 \uC801\uC6A9</span>
      </button>
    </div>
    <div id="review-target-panel" class="review-target-panel" style="display: none;"></div>
    <div id="separator-exclude-panel" class="separator-exclude-panel" style="display: none;"></div>
    <div class="sidebar-content">
      <table id="translation-table">
        <thead>
          <tr>
            <th>\uC6D0\uBB38 (\uC77C\uBCF8\uC5B4)</th>
            <th>\uBC88\uC5ED (\uD55C\uAD6D\uC5B4)</th>
            <th>\uAD00\uB9AC</th>
          </tr>
        </thead>
        <tbody id="translation-table-body"></tbody>
      </table>
      <div id="sidebar-empty-state" style="display: none; text-align: center; padding: 20px; color: #888;">
        <p>\uD398\uC774\uC9C0\uC758 &lt;p&gt; \uD0DC\uADF8\uC5D0\uC11C \uC77C\uBCF8\uC5B4\uB97C \uC2A4\uCE94\uD558\uC5EC \uBC88\uC5ED\uD569\uB2C8\uB2E4.</p>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-footer-header">
        <span class="footer-header-title">\u{1F4CB} \uC2E4\uC2DC\uAC04 \uC54C\uB9BC \uB85C\uADF8</span>
        <button id="clear-sidebar-log-btn" class="footer-clear-btn" title="\uC54C\uB9BC \uB85C\uADF8 \uBE44\uC6B0\uAE30">\uBE44\uC6B0\uAE30</button>
      </div>
      <div id="sidebar-log-console"></div>
    </div>
  `;
    document.body.appendChild(sidebar);
    const toggleButton = document.createElement("button");
    toggleButton.id = "jp-translator-toggle-btn";
    toggleButton.innerHTML = "\u6587";
    document.body.appendChild(toggleButton);
    document.getElementById("sidebar-close-btn")?.addEventListener("click", hideSidebar);
    toggleButton.addEventListener("click", toggleSidebar);
    document.getElementById("clear-sidebar-log-btn")?.addEventListener("click", () => {
      const consoleEl = document.getElementById("sidebar-log-console");
      if (consoleEl) consoleEl.innerHTML = "";
    });
    document.getElementById("sidebar-quick-jump-toggle-btn")?.addEventListener("click", () => {
      toggleQuickJumpFromSidebar();
    });
    document.getElementById("banner-quick-jump-btn")?.addEventListener("click", () => {
      toggleQuickJumpFromSidebar();
    });
    bindSeparatorPanelEvents();
    const editTitleBtn = document.getElementById("edit-novel-title-btn");
    const titleDisplay = document.getElementById("current-novel-title-display");
    if (editTitleBtn) editTitleBtn.addEventListener("click", promptEditNovelTitle);
    if (titleDisplay) titleDisplay.addEventListener("click", promptEditNovelTitle);
    const turboToggle = document.getElementById("sidebar-turbo-toggle");
    if (turboToggle) {
      turboToggle.addEventListener("change", (e) => {
        const checked = e.target.checked;
        if (state.onToggleTurboMode) {
          state.onToggleTurboMode(checked, true);
        }
      });
    }
    const turboCutoffBadge = document.getElementById("turbo-cutoff-badge");
    if (turboCutoffBadge) {
      turboCutoffBadge.addEventListener("click", () => {
        cycleTurboCutoff();
      });
    }
  }
  function updateEmptyState() {
    const tableBody = document.getElementById("translation-table-body");
    const emptyState = document.getElementById("sidebar-empty-state");
    if (tableBody && emptyState) {
      emptyState.style.display = tableBody.rows.length === 0 ? "block" : "none";
    }
  }
  function updateNovelTitleUI(title) {
    const display = document.getElementById("current-novel-title-display");
    if (display) {
      display.textContent = title || "\uC81C\uBAA9 \uBBF8\uAC10\uC9C0";
      display.title = `\uD604\uC7AC \uC18C\uC124: ${title}
(\uD074\uB9AD\uD558\uC5EC \uC18C\uC124 \uC81C\uBAA9 \uC9C1\uC811 \uC9C0\uC815 \uAC00\uB2A5)`;
    }
  }
  async function promptEditNovelTitle() {
    const nextTitle = prompt("\uC774 \uC18C\uC124\uC758 \uC81C\uBAA9(\uC2DD\uBCC4\uC790)\uC744 \uC785\uB825\uD558\uC138\uC694:", state.currentNovelTitle || "");
    if (nextTitle !== null && nextTitle.trim() !== "") {
      state.currentNovelTitle = nextTitle.trim();
      updateNovelTitleUI(state.currentNovelTitle);
      const { loadNovelSeparators: loadNovelSeparators2 } = await Promise.resolve().then(() => (init_separators(), separators_exports));
      const { renderSeparatorSettingsPanel: renderSeparatorSettingsPanel2 } = await Promise.resolve().then(() => (init_separator_panel(), separator_panel_exports));
      state.separatorConfig = await loadNovelSeparators2(state.currentNovelTitle);
      state.activeSeparators = state.separatorConfig.effectiveSeparators;
      renderSeparatorSettingsPanel2();
      logToSidebar(`[\uC18C\uC124 \uC804\uD658] '${state.currentNovelTitle}'\uC758 \uAD6C\uBD84\uC120 \uC124\uC815\uC744 \uBD88\uB7EC\uC654\uC2B5\uB2C8\uB2E4.`);
    }
  }
  function updateTurboModeUI(enabled) {
    const toggle = document.getElementById("sidebar-turbo-toggle");
    const banner = document.getElementById("sidebar-turbo-banner");
    const desc = document.getElementById("turbo-desc-text");
    if (toggle) toggle.checked = !!enabled;
    if (banner) {
      if (enabled) {
        banner.classList.add("active");
      } else {
        banner.classList.remove("active");
      }
    }
    if (desc) {
      if (enabled) {
        const targetDate = state.turboTargetTimestamp ? new Date(state.turboTargetTimestamp) : null;
        const timeStr = targetDate ? `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, "0")} \uC815\uAC01 \uC911\uB2E8` : "\uB300\uAE30: 2\uCD08 / 8\uCD08";
        desc.textContent = `ON (${timeStr})`;
      } else {
        desc.textContent = "OFF (\uAE30\uBCF8 \uC9C0\uC5F0)";
      }
    }
  }
  function updateTurboBadgeUI() {
    const badge = document.getElementById("turbo-cutoff-badge");
    if (!badge) return;
    const info = detectCutoffInfo(state.turboCutoffHour);
    badge.textContent = `\uAE30\uC900 ${info.label}`;
  }
  async function cycleTurboCutoff() {
    if (state.turboCutoffHour === null) {
      state.turboCutoffHour = 16;
    } else if (state.turboCutoffHour === 16) {
      state.turboCutoffHour = 17;
    } else {
      state.turboCutoffHour = null;
    }
    const info = detectCutoffInfo(state.turboCutoffHour);
    if (state.isTurboMode) {
      state.turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
    }
    try {
      await chrome.storage.local.set({
        lanovel_turbo_cutoff: state.turboCutoffHour,
        lanovel_turbo_target: state.turboTargetTimestamp
      });
    } catch (e) {
    }
    updateTurboBadgeUI();
    updateTurboModeUI(state.isTurboMode);
    logToSidebar(`\u23F0 \uCF8C\uC18D\uBAA8\uB4DC \uC815\uAC01 \uC911\uB2E8 \uAE30\uC900\uC774 [${info.label}]\uC73C\uB85C \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`);
  }
  function updateApplyButtonUI(applied, totalTargetCount) {
    const dot = document.getElementById("apply-status-dot");
    const text = document.getElementById("apply-status-text");
    const count = document.getElementById("apply-stats-count");
    const btn = document.getElementById("sidebar-apply-toggle-btn");
    const btnIcon = document.getElementById("apply-btn-icon");
    const btnText = document.getElementById("apply-btn-text");
    const totalTarget = totalTargetCount ?? document.querySelectorAll("p[id]:not(.blank)").length;
    const translatedCount = state.translationCache.size;
    if (count) {
      count.textContent = `(\uBC88\uC5ED ${translatedCount}\uAC1C / \uBCF8\uBB38 ${totalTarget}\uAC1C)`;
    }
    if (applied) {
      if (dot) dot.className = "status-dot applied";
      if (text) {
        text.className = "apply-status-text applied";
        text.textContent = "\uBCF8\uBB38 \uBC88\uC5ED \uC801\uC6A9 \uC911";
      }
      if (btn) {
        btn.className = "sidebar-apply-btn applied";
        btn.title = "\uD074\uB9AD\uD558\uBA74 \uC6F9\uD398\uC774\uC9C0 \uBCF8\uBB38\uC744 \uC6D0\uBB38\uC73C\uB85C \uBCF5\uC6D0\uD569\uB2C8\uB2E4.";
      }
      if (btnIcon) btnIcon.textContent = "\u2705";
      if (btnText) btnText.textContent = "\uC801\uC6A9 \uC911 (\uC6D0\uBB38 \uBCF5\uC6D0)";
    } else {
      if (dot) dot.className = "status-dot";
      if (text) {
        text.className = "apply-status-text";
        text.textContent = "\uC6D0\uBB38 \uD45C\uC2DC \uC911";
      }
      if (btn) {
        btn.className = "sidebar-apply-btn";
        btn.title = "\uD074\uB9AD\uD558\uBA74 \uBC88\uC5ED\uBB38\uC744 \uC6F9\uD398\uC774\uC9C0 \uBCF8\uBB38\uC5D0 \uC801\uC6A9\uD569\uB2C8\uB2E4.";
      }
      if (btnIcon) btnIcon.textContent = "\u{1F4C4}";
      if (btnText) btnText.textContent = "\uD398\uC774\uC9C0\uC5D0 \uC801\uC6A9";
    }
  }
  function bindRowEvents(row, pid, originalText) {
    const translatedCell = row.querySelector(".translated-text");
    const saveBtn = row.querySelector(".save-btn");
    const retranslateBtn = row.querySelector(".retranslate-row-btn");
    if (translatedCell && saveBtn) {
      translatedCell.addEventListener("input", () => {
        saveBtn.disabled = false;
      });
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newTranslatedText = translatedCell.textContent || "";
        saveSingleTranslation(pid, originalText, newTranslatedText);
        saveBtn.disabled = true;
      });
    }
    if (retranslateBtn) {
      retranslateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retranslateSingleRow(pid, originalText);
      });
    }
    row.addEventListener("click", (e) => {
      handleSidebarRowClick(pid, e);
    });
  }
  function populateSidebar(translations) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    tableBody.innerHTML = "";
    const seenPids = /* @__PURE__ */ new Set();
    const uniqueTranslations = [];
    for (let i = translations.length - 1; i >= 0; i--) {
      const t = translations[i];
      if (t.pid && !seenPids.has(t.pid)) {
        seenPids.add(t.pid);
        uniqueTranslations.unshift(t);
      }
    }
    uniqueTranslations.forEach((t) => {
      addEntryToSidebar(t);
    });
    updateEmptyState();
  }
  function addEntryToSidebar(t) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    const pid = t.pid || (t.id !== void 0 ? String(t.id) : "");
    if (!pid) return;
    let isAutoDeleted = false;
    if (t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated)) {
      isAutoDeleted = true;
      state.translationCache.delete(pid);
    }
    const existingRow = tableBody.querySelector(`tr[data-pid="${pid}"]`);
    const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(pid);
    const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">\u26A1\uC7AC\uAC80\uC218</span>` : "";
    const displayTranslation = isAutoDeleted ? "" : escapeHtml(t.translated || "");
    if (existingRow) {
      if (isReviewTarget) existingRow.classList.add("review-target-row");
      const oriCell = existingRow.querySelector(".original-text");
      if (oriCell && isReviewTarget && !oriCell.querySelector(".review-badge")) {
        oriCell.innerHTML = `${reviewBadgeHtml}${escapeHtml(t.original)}`;
      }
      const transCell = existingRow.querySelector(".translated-text");
      if (transCell) {
        transCell.innerHTML = displayTranslation;
        transCell.setAttribute("contenteditable", "true");
      }
      const saveBtn = existingRow.querySelector(".save-btn");
      if (saveBtn) saveBtn.disabled = !isAutoDeleted;
      const retranslateBtn = existingRow.querySelector(".retranslate-row-btn");
      if (retranslateBtn) retranslateBtn.disabled = false;
      return;
    }
    const row = tableBody.insertRow();
    row.dataset.pid = pid;
    if (isReviewTarget) row.classList.add("review-target-row");
    row.innerHTML = `
    <td class="original-text">${reviewBadgeHtml}${escapeHtml(t.original)}</td>
    <td class="translated-text" contenteditable="true">${displayTranslation}</td>
    <td>
      <div class="action-btns">
        <button class="save-btn" disabled title="\uC218\uC815\uD55C \uBC88\uC5ED \uC800\uC7A5">\uC800\uC7A5</button>
        <button class="retranslate-row-btn" title="\uC774 \uBB38\uC7A5\uB9CC \uC989\uC2DC \uC7AC\uBC88\uC5ED">\u{1F504}</button>
      </div>
    </td>
  `;
    bindRowEvents(row, pid, t.original);
  }
  function addPlaceholderRows(items) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (tableBody.querySelector(`tr[data-pid="${item.id}"]`)) continue;
      const row = tableBody.insertRow(0);
      row.dataset.pid = item.id;
      const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(item.id);
      if (isReviewTarget) row.classList.add("review-target-row");
      const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">\u26A1\uC7AC\uAC80\uC218</span>` : "";
      row.innerHTML = `
      <td class="original-text">${reviewBadgeHtml}${escapeHtml(item.text)}</td>
      <td class="translated-text">\u23F3 \uBC88\uC5ED \uC911...</td>
      <td>
        <div class="action-btns">
          <button class="save-btn" disabled title="\uC218\uC815\uD55C \uBC88\uC5ED \uC800\uC7A5">\uC800\uC7A5</button>
          <button class="retranslate-row-btn" disabled title="\uC774 \uBB38\uC7A5\uB9CC \uC989\uC2DC \uC7AC\uBC88\uC5ED">\u{1F504}</button>
        </div>
      </td>
    `;
      bindRowEvents(row, item.id, item.text);
    }
    updateEmptyState();
  }
  function updateSidebarWithTranslations(translations) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody || !translations || translations.length === 0) return;
    const rowsToPrepend = [];
    translations.forEach((item) => {
      let row = tableBody.querySelector(`tr[data-pid="${item.id}"]`);
      const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(item.id);
      const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">\u26A1\uC7AC\uAC80\uC218</span>` : "";
      if (!row) {
        row = document.createElement("tr");
        row.dataset.pid = item.id;
        if (isReviewTarget) row.classList.add("review-target-row");
        row.innerHTML = `
        <td class="original-text">${reviewBadgeHtml}${escapeHtml(item.original)}</td>
        <td class="translated-text" contenteditable="true">${escapeHtml(item.translated)}</td>
        <td>
          <div class="action-btns">
            <button class="save-btn" disabled title="\uC218\uC815\uD55C \uBC88\uC5ED \uC800\uC7A5">\uC800\uC7A5</button>
            <button class="retranslate-row-btn" title="\uC774 \uBB38\uC7A5\uB9CC \uC989\uC2DC \uC7AC\uBC88\uC5ED">\u{1F504}</button>
          </div>
        </td>
      `;
        bindRowEvents(row, item.id, item.original);
      } else {
        const cell = row.querySelector(".translated-text");
        if (cell) {
          cell.textContent = item.translated;
          cell.setAttribute("contenteditable", "true");
          cell.style.color = "";
        }
        const saveBtn = row.querySelector(".save-btn");
        if (saveBtn) saveBtn.disabled = true;
        const retranslateBtn = row.querySelector(".retranslate-row-btn");
        if (retranslateBtn) retranslateBtn.disabled = false;
      }
      if (isReviewTarget) {
        updateReviewCardTranslation(item.id, `\uBC88\uC5ED: ${item.translated}`, false);
      }
      rowsToPrepend.push(row);
    });
    for (let i = rowsToPrepend.length - 1; i >= 0; i--) {
      tableBody.prepend(rowsToPrepend[i]);
    }
  }
  function updateSidebarWithCancelled() {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll("tr");
    rows.forEach((row) => {
      const translatedCell = row.querySelector(".translated-text");
      if (translatedCell && translatedCell.textContent?.includes("\uBC88\uC5ED \uC911")) {
        translatedCell.textContent = "";
        translatedCell.setAttribute("contenteditable", "true");
        const saveBtn = row.querySelector(".save-btn");
        if (saveBtn) saveBtn.disabled = false;
        const retranslateBtn = row.querySelector(".retranslate-row-btn");
        if (retranslateBtn) retranslateBtn.disabled = false;
      }
    });
  }
  function sortSidebar(paragraphOrderPids) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll("tr[data-pid]"));
    const pidMap = new Map(rows.map((row) => [row.dataset.pid, row]));
    tableBody.innerHTML = "";
    paragraphOrderPids.forEach((pid) => {
      const row = pidMap.get(pid);
      if (row) {
        tableBody.appendChild(row);
        pidMap.delete(pid);
      }
    });
    pidMap.forEach((row) => tableBody.appendChild(row));
  }
  function handleSidebarRowClick(pid, e) {
    const target = e.target;
    if (target && (target.closest("button") || target.closest(".translated-text") || target.tagName === "INPUT")) {
      return;
    }
    const targetP = document.getElementById(pid);
    if (targetP) {
      targetP.scrollIntoView({ behavior: "smooth", block: "center" });
      targetP.classList.remove("lanovel-highlight-pulse");
      void targetP.offsetWidth;
      targetP.classList.add("lanovel-highlight-pulse");
      setTimeout(() => {
        targetP.classList.remove("lanovel-highlight-pulse");
      }, 1600);
    }
  }
  var init_sidebar = __esm({
    "src/ui/sidebar.ts"() {
      "use strict";
      init_state();
      init_turbo();
      init_filters();
      init_row_actions();
      init_review_panel();
      init_separator_panel();
      init_toc_quick_jump();
    }
  });

  // src/core/dom_applier.ts
  function getCleanUrl() {
    return window.location.href.split("#")[0].trim();
  }
  function getTargetParagraphs() {
    const allParagraphs = document.querySelectorAll("p[id]");
    return Array.from(allParagraphs).filter((p) => !p.classList.contains("blank") && PID_REGEX.test(p.id));
  }
  function applyTranslationsToPage(translations, logNotification = true) {
    if (!translations || translations.length === 0) return;
    const translationMap = new Map(translations.map((t) => [t.pid || t.id, t.translated]));
    const paragraphs = getTargetParagraphs();
    let replacementCount = 0;
    paragraphs.forEach((p) => {
      if (translationMap.has(p.id)) {
        const translatedText = translationMap.get(p.id);
        if (translatedText && !translatedText.includes("\uBC88\uC5ED \uC2E4\uD328") && !translatedText.includes("API \uC624\uB958")) {
          if (!p.dataset.lanovelOriginalHtml) {
            p.dataset.lanovelOriginalHtml = p.innerHTML;
            p.dataset.lanovelOriginalStyle = p.getAttribute("style") || "";
          }
          p.innerHTML = translatedText;
          p.classList.add("lanovel-applied-text");
          const appliedStyle = { color: "#E2E8F0", fontFamily: "TwoCon" };
          Object.assign(p.style, appliedStyle);
          replacementCount++;
        }
      }
    });
    if (logNotification && replacementCount > 0) {
      logToSidebar(`\uD398\uC774\uC9C0\uC5D0 \uBC88\uC5ED ${replacementCount}\uAC1C\uB97C \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4.`);
    }
    updateApplyButtonUI(true, paragraphs.length);
    setupParagraphInteraction();
  }
  function restoreOriginalPage() {
    const paragraphs = getTargetParagraphs();
    let restoredCount = 0;
    paragraphs.forEach((p) => {
      if (p.dataset.lanovelOriginalHtml) {
        p.innerHTML = p.dataset.lanovelOriginalHtml;
        if (p.dataset.lanovelOriginalStyle) {
          p.setAttribute("style", p.dataset.lanovelOriginalStyle);
        } else {
          p.removeAttribute("style");
        }
        p.classList.remove("lanovel-applied-text");
        restoredCount++;
      }
    });
    logToSidebar(`\uBCF8\uBB38\uC744 \uC6D0\uBB38\uC73C\uB85C \uBCF5\uC6D0\uD588\uC2B5\uB2C8\uB2E4 (${restoredCount}\uAC1C \uBB38\uB2E8).`);
    updateApplyButtonUI(false, paragraphs.length);
    setupParagraphInteraction();
  }
  async function setPageApplyStatus(applied, syncStorageAndServer = true) {
    state.isPageApplied = applied;
    if (state.isPageApplied) {
      const allTranslations = Array.from(state.translationCache.values());
      applyTranslationsToPage(allTranslations, true);
    } else {
      restoreOriginalPage();
    }
    const paragraphs = getTargetParagraphs();
    updateApplyButtonUI(state.isPageApplied, paragraphs.length);
    if (syncStorageAndServer) {
      const cleanUrl = getCleanUrl();
      const currentUrl = window.location.href;
      try {
        await fetch("http://127.0.0.1:8001/api/urls/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl, apply: state.isPageApplied })
        });
      } catch (e) {
        console.warn("[setPageApplyStatus] Failed to sync apply status to server:", e);
      }
      try {
        const statusObj = { applied: state.isPageApplied, timestamp: Date.now() };
        await chrome.storage.local.set({
          ["status-" + cleanUrl]: statusObj,
          ["status-" + currentUrl]: statusObj
        });
      } catch (e) {
        console.warn("[setPageApplyStatus] Failed to sync apply status to chrome storage:", e);
      }
    }
  }
  function setupParagraphInteraction() {
    const paragraphs = getTargetParagraphs();
    paragraphs.forEach((p) => {
      if (p.dataset.lanovelLinked) return;
      p.dataset.lanovelLinked = "true";
      p.addEventListener("click", () => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) return;
        p.classList.remove("lanovel-highlight-pulse");
        void p.offsetWidth;
        p.classList.add("lanovel-highlight-pulse");
        setTimeout(() => {
          p.classList.remove("lanovel-highlight-pulse");
        }, 1600);
        const row = document.querySelector(`tr[data-pid="${p.id}"]`);
        if (row) {
          showSidebar();
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.remove("lanovel-row-highlight");
          void row.offsetWidth;
          row.classList.add("lanovel-row-highlight");
          setTimeout(() => {
            row.classList.remove("lanovel-row-highlight");
          }, 1600);
        }
      });
    });
  }
  var init_dom_applier = __esm({
    "src/core/dom_applier.ts"() {
      "use strict";
      init_state();
      init_filters();
      init_sidebar();
    }
  });

  // src/core/page_translator.ts
  function sleepResponsive(getDelayFn) {
    return new Promise((resolve) => {
      state.currentDelayStart = Date.now();
      state.activeDelayFn = getDelayFn;
      const checkInterval = 50;
      const intervalId = setInterval(() => {
        if (state.isTranslationCancelled) {
          clearInterval(intervalId);
          state.currentDelayResolver = null;
          state.activeDelayFn = null;
          resolve();
          return;
        }
        const elapsed = Date.now() - state.currentDelayStart;
        const targetDelay = typeof getDelayFn === "function" ? getDelayFn() : getDelayFn;
        if (elapsed >= targetDelay) {
          clearInterval(intervalId);
          state.currentDelayResolver = null;
          state.activeDelayFn = null;
          resolve();
        }
      }, checkInterval);
      state.currentDelayResolver = () => {
        const elapsed = Date.now() - state.currentDelayStart;
        const targetDelay = typeof getDelayFn === "function" ? getDelayFn() : getDelayFn;
        if (elapsed >= targetDelay) {
          clearInterval(intervalId);
          state.currentDelayResolver = null;
          state.activeDelayFn = null;
          resolve();
        }
      };
    });
  }
  async function loadTurboModeState() {
    try {
      const stored = await chrome.storage.local.get([
        "lanovel_turbo_mode",
        "lanovel_turbo_cutoff",
        "lanovel_turbo_target"
      ]);
      state.isTurboMode = !!stored.lanovel_turbo_mode;
      state.turboCutoffHour = stored.lanovel_turbo_cutoff || null;
      state.turboTargetTimestamp = stored.lanovel_turbo_target || 0;
      if (state.isTurboMode) {
        if (!state.turboTargetTimestamp || Date.now() >= state.turboTargetTimestamp) {
          state.turboAbortedOnLoad = true;
          await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
          return;
        }
      }
      updateTurboModeUI(state.isTurboMode);
      updateTurboBadgeUI();
    } catch (e) {
      console.warn("[TurboMode] Error loading state from storage:", e);
    }
  }
  async function setTurboMode(enabled, manual = true) {
    state.isTurboMode = enabled;
    const info = detectCutoffInfo(state.turboCutoffHour);
    if (enabled) {
      state.turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
    } else {
      state.turboTargetTimestamp = 0;
    }
    try {
      await chrome.storage.local.set({
        lanovel_turbo_mode: state.isTurboMode,
        lanovel_turbo_cutoff: state.turboCutoffHour,
        lanovel_turbo_target: state.turboTargetTimestamp
      });
    } catch (e) {
      console.warn("[TurboMode] Failed to save state:", e);
    }
    updateTurboModeUI(state.isTurboMode);
    updateTurboBadgeUI();
    if (state.currentDelayResolver) {
      state.currentDelayResolver();
    }
    if (manual) {
      if (state.isTurboMode) {
        const targetDate = new Date(state.turboTargetTimestamp);
        const targetTimeStr = `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, "0")}`;
        logToSidebar(
          `\u26A1 [\uCF8C\uC18D\uBAA8\uB4DC \uD65C\uC131\uD654] \uBC88\uC5ED\uAC04 \uB300\uAE30 2\uCD08, \uB2E4\uC74C\uD654 \uB118\uC5B4\uAC00\uAE30 8\uCD08\uB85C \uC124\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4. (\uCD08\uAE30\uD654 \uAE30\uC900: ${info.label}, ${targetTimeStr} \uC815\uAC01 \uB3C4\uB2EC \uC2DC \uC989\uC2DC \uC911\uB2E8)`
        );
      } else {
        logToSidebar(`\u26A1 [\uCF8C\uC18D\uBAA8\uB4DC \uBE44\uD65C\uC131\uD654] \uC77C\uBC18 \uBC88\uC5ED \uBAA8\uB4DC\uB85C \uC804\uD658\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`);
      }
    }
    state.broadcastStatus();
  }
  async function abortTurboMode(reason = "\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC") {
    state.isTranslationCancelled = true;
    state.isTurboMode = false;
    state.turboTargetTimestamp = 0;
    try {
      await chrome.storage.local.set({
        lanovel_turbo_mode: false,
        lanovel_turbo_target: 0
      });
    } catch (e) {
    }
    updateTurboModeUI(false);
    const stopBtn = document.getElementById("stop-translation-btn");
    if (stopBtn) stopBtn.style.display = "none";
    const retryBtn = document.getElementById("retry-translation-btn");
    if (retryBtn) retryBtn.style.display = "inline-block";
    logToSidebar(`\u23F0 [\uCF8C\uC18D\uBAA8\uB4DC \uC790\uB3D9 \uC911\uB2E8] \uC0AC\uC720: ${reason}. \uC790\uB3D9 \uBC88\uC5ED \uBC0F \uB2E4\uC74C \uD654 \uC774\uB3D9\uC774 \uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`, "log-error");
    showLanovelHud(`\uCF8C\uC18D\uBAA8\uB4DC \uC790\uB3D9 \uC911\uB2E8 (${reason})`, "\u23F0", 3500);
    state.broadcastStatus();
  }
  async function fetchTranslationsForUrl(url) {
    try {
      const fetchUrl = `http://127.0.0.1:8001/translations?url=${encodeURIComponent(url)}&limit=5000`;
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        console.warn(`[fetchTranslationsForUrl] Server responded with ${response.status}`);
        return null;
      }
      const data = await response.json();
      return data.translations;
    } catch (error) {
      console.error("Error fetching translations for URL:", error);
      logToSidebar("\uC11C\uBC84\uC5D0\uC11C \uBC88\uC5ED\uC744 \uBD88\uB7EC\uC624\uB294 \uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.", "log-error");
      return null;
    }
  }
  async function fetchExclusionsForUrl(url) {
    try {
      const fetchUrl = `http://127.0.0.1:8001/excluded_sentences?url=${encodeURIComponent(url)}`;
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        console.warn(`[fetchExclusionsForUrl] Server responded with ${response.status}`);
        return null;
      }
      const data = await response.json();
      return data.excluded_texts;
    } catch (error) {
      console.error("Error fetching exclusions for URL:", error);
      return null;
    }
  }
  async function ensureTranslationsLoaded() {
    if (state.translationsLoadedPromise) {
      return state.translationsLoadedPromise;
    }
    state.translationsLoadedPromise = (async () => {
      const url = getCleanUrl();
      logToSidebar("\uC800\uC7A5\uB41C \uBC88\uC5ED\uC744 \uC11C\uBC84\uC5D0\uC11C \uBD88\uB7EC\uC624\uB294 \uC911...");
      try {
        const [translations, excluded] = await Promise.all([
          fetchTranslationsForUrl(url),
          fetchExclusionsForUrl(url)
        ]);
        if (excluded) {
          state.exclusionSet = new Set(excluded);
        }
        if (translations && Array.isArray(translations) && translations.length > 0) {
          state.translationCache.clear();
          translations.forEach((t) => {
            if (t.pid && t.translated && t.translated.trim()) {
              state.translationCache.set(t.pid, t);
            }
          });
          populateSidebar(translations);
          logToSidebar(`\uC11C\uBC84\uC5D0\uC11C ${translations.length}\uAC1C\uC758 \uC800\uC7A5\uB41C \uBC88\uC5ED\uC744 \uBD88\uB7EC\uC654\uC2B5\uB2C8\uB2E4.`);
        } else {
          logToSidebar("\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB41C \uAE30\uC874 \uBC88\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        }
        return translations;
      } catch (e) {
        console.error("[ensureTranslationsLoaded] \uBC88\uC5ED \uB85C\uB4DC \uC2E4\uD328:", e);
        logToSidebar(`\uC800\uC7A5\uB41C \uBC88\uC5ED \uB85C\uB4DC \uC2E4\uD328: ${e.message}`, "log-error");
        return null;
      }
    })();
    return state.translationsLoadedPromise;
  }
  function hasUntranslatedParagraphs() {
    const allParagraphs = getTargetParagraphs();
    const validParagraphs = [];
    allParagraphs.forEach((p) => {
      if (!p || p.id === "tagCount" || /^(la|lp)\d+$/i.test(p.id)) return;
      const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
      if (text) {
        validParagraphs.push({ element: p, text, pid: p.id });
      }
    });
    const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);
    for (const item of validParagraphs) {
      if (sepAnalysis.prefacePids.has(item.pid)) continue;
      if (sepAnalysis.afterwordPids.has(item.pid)) continue;
      if (sepAnalysis.separatorPids.has(item.pid)) continue;
      const cached = state.translationCache.get(item.pid);
      if (cached && cached.translated && cached.translated.trim()) {
        continue;
      }
      const cleanedText = item.text.replace(/([あアいイうウえエおオ])\1{2,}/g, "$1\u30FC");
      if (state.exclusionSet.has(cleanedText)) continue;
      if (isTranslatableText(cleanedText)) {
        return true;
      }
    }
    return false;
  }
  async function saveAllTranslations(itemsToSave) {
    const validItems = itemsToSave.filter((item) => item.translated && item.translated.trim());
    if (validItems.length === 0) return;
    const url = getCleanUrl();
    const scraper = getScraper();
    const title = scraper.extractEpisodeTitle() || document.title;
    const records = validItems.map((item) => ({
      url,
      pid: item.id || item.pid,
      original: item.original,
      translated: item.translated,
      timestamp: Math.floor(Date.now() / 1e3),
      folderName: null,
      title
    }));
    try {
      const response = await fetch("http://127.0.0.1:8001/translations/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records)
      });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      logToSidebar(`${records.length}\uAC1C\uC758 \uBC88\uC5ED\uC744 \uC11C\uBC84\uC5D0 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.`);
    } catch (error) {
      console.error("Error saving all translations to server:", error);
      logToSidebar(`\uC11C\uBC84\uC5D0 \uC77C\uAD04 \uC800\uC7A5 \uC2E4\uD328: ${error.message}`, "log-error");
    }
  }
  function startFullRetranslation() {
    logToSidebar("\uBC88\uC5ED\uC744 \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uC2DC\uC791\uD569\uB2C8\uB2E4.");
    const tableBody = document.getElementById("translation-table-body");
    if (tableBody) tableBody.innerHTML = "";
    state.translationCache.clear();
    state.userDeletedTranslationPids.clear();
    state.translationsLoadedPromise = null;
    state.hasScannedForPTags = false;
    translateAllPTags(true);
    showSidebar();
  }
  async function translateAllPTags(isRetranslation = false) {
    if (isTranslatingInProgress) {
      console.log("[translateAllPTags] \uC774\uBBF8 \uBC88\uC5ED \uC791\uC5C5\uC774 \uC9C4\uD589 \uC911\uC774\uBBC0\uB85C \uC911\uBCF5 \uC2E4\uD589\uC744 \uCC28\uB2E8\uD569\uB2C8\uB2E4.");
      return;
    }
    if (state.turboAbortedOnLoad) {
      console.log("[translateAllPTags] \uCF8C\uC18D\uBAA8\uB4DC \uC815\uAC01 \uB3C4\uB2EC\uB85C \uBC88\uC5ED\uC774 \uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      return;
    }
    isTranslatingInProgress = true;
    state.hasScannedForPTags = true;
    state.isTranslationCancelled = false;
    state.notifyInflightStart();
    const stopBtn = document.getElementById("stop-translation-btn");
    if (stopBtn) stopBtn.style.display = "inline-block";
    const retryBtn = document.getElementById("retry-translation-btn");
    if (retryBtn) retryBtn.style.display = "none";
    try {
      if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
        await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
        return;
      }
      if (!isRetranslation) {
        await ensureTranslationsLoaded();
      }
      const prepScraper = getScraper();
      if (prepScraper.prepareContent) {
        prepScraper.prepareContent();
      }
      const allParagraphs = getTargetParagraphs();
      const validParagraphs = [];
      allParagraphs.forEach((p) => {
        if (!p || p.id === "tagCount" || /^(la|lp)\d+$/i.test(p.id)) return;
        const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
        if (text) {
          validParagraphs.push({ element: p, text, pid: p.id });
        }
      });
      const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);
      if (sepAnalysis.topSeparator) {
        logToSidebar(
          `[\uC0C1\uB2E8 \uAD6C\uBD84\uC120 \uAC10\uC9C0] '${sepAnalysis.topSeparator.sep}' \uC774\uC804 \uC7A1\uAE00 ${sepAnalysis.prefacePids.size}\uAC1C \uBB38\uB2E8(\uAD6C\uBD84\uC120 \uD3EC\uD568)\uC744 \uBC88\uC5ED\uC5D0\uC11C \uC790\uB3D9 \uC81C\uC678\uD569\uB2C8\uB2E4.`
        );
      }
      if (sepAnalysis.bottomSeparator) {
        logToSidebar(
          `[\uD558\uB2E8 \uAD6C\uBD84\uC120 \uAC10\uC9C0] '${sepAnalysis.bottomSeparator.sep}' \uC774\uD6C4 \uD6C4\uAE30 ${sepAnalysis.afterwordPids.size}\uAC1C \uBB38\uB2E8(\uAD6C\uBD84\uC120 \uD3EC\uD568)\uC744 \uBC88\uC5ED\uC5D0\uC11C \uC790\uB3D9 \uC81C\uC678\uD569\uB2C8\uB2E4.`
        );
      }
      const textsToTranslate = [];
      const instantPunctuationItems = [];
      validParagraphs.forEach((item) => {
        if (sepAnalysis.prefacePids.has(item.pid)) return;
        if (sepAnalysis.afterwordPids.has(item.pid)) return;
        if (sepAnalysis.separatorPids.has(item.pid)) return;
        const cached = state.translationCache.get(item.pid);
        if (cached && cached.translated && cached.translated.trim()) {
          return;
        }
        const cleanedText = item.text.replace(/([あアいイうウえエおオ])\1{2,}/g, "$1\u30FC");
        if (state.exclusionSet.has(cleanedText)) return;
        if (cleanedText && isTranslatableText(cleanedText)) {
          if (isPurePunctuationOnly(cleanedText)) {
            instantPunctuationItems.push({ id: item.pid, original: cleanedText, translated: cleanedText });
          } else {
            textsToTranslate.push({ id: item.pid, text: cleanedText });
          }
        }
      });
      if (instantPunctuationItems.length > 0) {
        instantPunctuationItems.forEach((item) => {
          state.userDeletedTranslationPids.delete(String(item.id));
          state.translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
          addEntryToSidebar({ pid: item.id, original: item.original, translated: item.translated });
        });
        updateSidebarWithTranslations(instantPunctuationItems);
        sortSidebar(allParagraphs.map((p) => p.id));
        if (state.isPageApplied) {
          applyTranslationsToPage(instantPunctuationItems, false);
        }
        await saveAllTranslations(instantPunctuationItems);
        logToSidebar(`[\uC989\uC2DC \uB300\uC785] \uBB38\uC790 \uC5C6\uB294 \uBB38\uC7A5\uBD80\uD638 \uBB38\uC7A5 ${instantPunctuationItems.length}\uAC1C\uB97C \uC989\uC2DC \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4.`);
      }
      if (textsToTranslate.length === 0) {
        if (instantPunctuationItems.length > 0) {
          logToSidebar("\uBAA8\uB4E0 \uBC88\uC5ED \uC791\uC5C5\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. (\uC21C\uC218 \uBB38\uC7A5\uBD80\uD638 \uC989\uC2DC \uB300\uC785 \uC644\uB8CC)");
        } else {
          logToSidebar("\uBC88\uC5ED\uD560 \uC0C8\uB85C\uC6B4 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        }
        if (stopBtn) stopBtn.style.display = "none";
        if (retryBtn) retryBtn.style.display = "inline-block";
        return;
      }
      const sepCount = state.activeSeparators ? state.activeSeparators.length : 0;
      const sepPreview = sepCount > 0 ? state.activeSeparators.slice(0, 3).join(", ") + (sepCount > 3 ? ` \uC678 ${sepCount - 3}\uAC1C` : "") : "\uC5C6\uC74C";
      const modelDesc = isRetranslation ? "\uACE0\uC131\uB2A5 \uBAA8\uB378(Gemini 3.0 Flash)" : "\uAE30\uBCF8 \uC5D4\uC9C4";
      const turboDesc = state.isTurboMode ? " \u26A1\uCF8C\uC18D\uBAA8\uB4DC" : "";
      const chunks = createBudgetChunks(textsToTranslate, CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS);
      const totalChars = textsToTranslate.reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0);
      logToSidebar(
        `[\uC18C\uC124: ${state.currentNovelTitle || "\uAE30\uBCF8"}] \uCD1D ${textsToTranslate.length}\uAC1C \uBB38\uC7A5(\uC57D ${totalChars.toLocaleString()}\uC790) \uAE00\uC790 \uC218\xB7\uD1A0\uD070 \uC608\uC0B0 \uAE30\uBC18 ${chunks.length}\uAC1C \uCD5C\uC801 \uBB36\uC74C\uC73C\uB85C \uBC88\uC5ED\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4. (${modelDesc}${turboDesc}, \uAD6C\uBD84\uC120: ${sepPreview})`
      );
      addPlaceholderRows(textsToTranslate);
      async function translateChunk(items, chunkSize) {
        if (state.isTranslationCancelled) return;
        const MAX_MESSAGE_RETRIES = 5;
        for (let attempt = 0; attempt < MAX_MESSAGE_RETRIES; attempt++) {
          try {
            const response = await chrome.runtime.sendMessage({
              action: "batchTranslate",
              items,
              isRetranslation
            });
            if (state.isTranslationCancelled) return;
            if (chrome.runtime.lastError) {
              throw new Error(chrome.runtime.lastError.message);
            }
            if (response && response.error) {
              if (response.error.includes("\uCD08\uAE30\uD654 \uC2DC\uAC04") || response.error.includes("\uC790\uB3D9 \uBC88\uC5ED\uC744 \uC911\uC9C0")) {
                await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
                return;
              }
              throw new Error(response.error);
            }
            if (response && response.notification) {
              logToSidebar(response.notification, "log-error");
              if (response.stop) {
                if (response.isQuotaResetStop || response.isServerOffline) {
                  await abortTurboMode(response.isServerOffline ? "\uC11C\uBC84 \uC624\uD504\uB77C\uC778" : "\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
                  return;
                }
                items.forEach((item) => {
                  const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                  if (row) {
                    const cell = row.querySelector(".translated-text");
                    if (cell && cell.textContent?.includes("\uBC88\uC5ED \uC911")) {
                      cell.textContent = "";
                    }
                  }
                });
                if (stopBtn) stopBtn.style.display = "none";
                const resumeBtn = document.getElementById("resume-translation-btn");
                if (resumeBtn) resumeBtn.style.display = "inline-block";
                logToSidebar("\uBC88\uC5ED\uC774 \uC77C\uC2DC \uC911\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC7AC\uAC1C \uBC84\uD2BC(\u25B6\uFE0F)\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.");
                await new Promise((resolve) => {
                  state.resolveResume = resolve;
                });
                return await translateChunk(items, chunkSize);
              }
              return;
            }
            if (response && response.translations) {
              const censoredItems = response.translations.filter(
                (t) => t.censored || t.translated && t.translated.includes("[\uAC80\uC5F4\uB85C \uC778\uD574 \uBC88\uC5ED \uC0DD\uB7B5]")
              );
              if (censoredItems.length > 0) {
                censoredItems.forEach((item) => {
                  const preview = item.original ? item.original.length > 25 ? item.original.slice(0, 25) + "..." : item.original : "";
                  logToSidebar(`\u26A0\uFE0F [\uAC80\uC5F4 \uAC10\uC9C0] \uBB38\uC7A5(ID: ${item.id}) \uBC88\uC5ED\uC774 \uAC80\uC5F4\uB85C \uC778\uD574 \uC0DD\uB7B5\uB418\uC5C8\uC2B5\uB2C8\uB2E4. (\uC6D0\uBB38: ${preview})`, "log-error");
                });
              }
              const verbatimItems = response.translations.filter(
                (t) => Boolean(t.verbatim) || t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated)
              );
              if (verbatimItems.length > 0) {
                verbatimItems.forEach((item) => {
                  const preview = item.original ? item.original.length > 25 ? item.original.slice(0, 25) + "..." : item.original : "";
                  logToSidebar(
                    `\u26A0\uFE0F [\uC6D0\uBB38 \uBCF5\uC81C\xB7\uBCC0\uD615 \uAC10\uC9C0] \uBB38\uC7A5(ID: ${item.id})\uC774 \uC6D0\uBB38\uACFC \uB3D9\uC77C/\uBCC0\uD615\uB418\uC5B4 \uC790\uB3D9 \uC0AD\uC81C \uBC0F \uD734\uC9C0\uD1B5\uC73C\uB85C \uC774\uC804\uB418\uC5C8\uC2B5\uB2C8\uB2E4. (\uC6D0\uBB38: ${preview})`,
                    "log-error"
                  );
                  state.translationCache.delete(item.id);
                  if (state.isPageApplied) {
                    const pTag = document.getElementById(item.id);
                    if (pTag && pTag.dataset.lanovelOriginalHtml) {
                      pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
                      pTag.classList.remove("lanovel-applied-text");
                      pTag.removeAttribute("style");
                      if (pTag.dataset.lanovelOriginalStyle) {
                        pTag.setAttribute("style", pTag.dataset.lanovelOriginalStyle);
                      }
                    }
                  }
                  const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                  if (row) {
                    const cell = row.querySelector(".translated-text");
                    if (cell) {
                      cell.textContent = "";
                      cell.setAttribute("contenteditable", "true");
                    }
                    const saveBtnEl = row.querySelector(".save-btn");
                    if (saveBtnEl) saveBtnEl.disabled = false;
                    const retransBtnEl = row.querySelector(".retranslate-row-btn");
                    if (retransBtnEl) retransBtnEl.disabled = false;
                  }
                  if (state.reviewTargetPids && state.reviewTargetPids.has(item.id)) {
                    updateReviewCardTranslation(item.id, "\uBC88\uC5ED: (\uC6D0\uBB38 \uBCF5\uC81C\xB7\uBCC0\uD615 \uAC10\uC9C0\uB418\uC5B4 \uC790\uB3D9 \uC0AD\uC81C\uB428)", true);
                  }
                });
                updateApplyButtonUI(state.isPageApplied);
              }
              const verbatimIdSet = new Set(verbatimItems.map((v) => String(v.id)));
              const successes = response.translations.filter(
                (t) => !verbatimIdSet.has(String(t.id)) && t.translated !== null && !t.translated.includes("\uBC88\uC5ED \uC2E4\uD328")
              );
              const failures = response.translations.filter(
                (t) => !verbatimIdSet.has(String(t.id)) && (t.translated === null || t.translated.includes("\uBC88\uC5ED \uC2E4\uD328"))
              );
              if (successes.length > 0) {
                updateSidebarWithTranslations(successes);
                successes.forEach((s) => {
                  state.translationCache.set(s.id, { pid: s.id, original: s.original, translated: s.translated });
                });
                if (state.isPageApplied) {
                  applyTranslationsToPage(successes, false);
                }
                await saveAllTranslations(successes);
              }
              if (failures.length > 0) {
                const failedOriginalItems = items.filter(
                  (originalItem) => failures.some((failedItem) => failedItem.id === originalItem.id)
                );
                logToSidebar(`${failedOriginalItems.length}\uAC1C \uD56D\uBAA9 \uBC88\uC5ED \uC2E4\uD328. \uB354 \uC791\uC740 \uB2E8\uC704\uB85C \uC7AC\uC2DC\uB3C4\uD569\uB2C8\uB2E4.`, "log-error");
                await handleFailure(failedOriginalItems, chunkSize);
              }
              return;
            } else {
              throw new Error("Malformed response from background script");
            }
          } catch (error) {
            if (error.message && (error.message.includes("\uCD08\uAE30\uD654 \uC2DC\uAC04") || error.message.includes("\uC790\uB3D9 \uBC88\uC5ED\uC744 \uC911\uC9C0"))) {
              await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
              return;
            }
            if (attempt < MAX_MESSAGE_RETRIES - 1) {
              const delay = (40 + Math.pow(2, attempt)) * 1e3 + Math.floor(Math.random() * 1e3);
              logToSidebar(`\uD1B5\uC2E0 \uC624\uB958. ${Math.round(delay / 1e3)}\uCD08 \uD6C4 \uC7AC\uC2DC\uB3C4... (${attempt + 1}/${MAX_MESSAGE_RETRIES})`, "log-error");
              await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
              logToSidebar(`${items.length}\uAC1C \uD56D\uBAA9 \uD1B5\uC2E0 \uCD5C\uC885 \uC2E4\uD328. \uB2E8\uC704\uB97C \uC904\uC5EC \uC7AC\uC2DC\uB3C4\uD569\uB2C8\uB2E4.`, "log-error");
              await handleFailure(items, chunkSize);
            }
          }
        }
      }
      async function handleFailure(failedItems, currentChunkSize) {
        if (state.isTranslationCancelled) return;
        if (currentChunkSize > 1 && failedItems.length > 1) {
          const newChunkSize = Math.ceil(currentChunkSize / 2);
          logToSidebar(`\uBB36\uC74C \uB2E8\uC704\uB97C ${newChunkSize}\uC73C\uB85C \uC904\uC5EC \uC7AC\uC2DC\uB3C4\uD569\uB2C8\uB2E4.`);
          const subChunks = chunkArray(failedItems, newChunkSize);
          for (const [index, subChunk] of subChunks.entries()) {
            if (state.isTranslationCancelled) break;
            await translateChunk(subChunk, newChunkSize);
            if (index < subChunks.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 3e3));
            }
          }
        } else if (failedItems.length > 0) {
          for (const item of failedItems) {
            if (state.isTranslationCancelled) break;
            const sentences = item.text.split("\u3002").filter((s) => s.trim().length > 0);
            if (sentences.length > 1) {
              logToSidebar(`\uBB38\uC7A5 \uBD84\uD560 \uC7AC\uC2DC\uB3C4... (ID: ${item.id})`, "info");
              const subItems = sentences.map((sentence, idx) => ({
                id: `${item.id}-part${idx}`,
                text: sentence + "\u3002"
              }));
              try {
                const res = await chrome.runtime.sendMessage({
                  action: "batchTranslate",
                  items: subItems,
                  isRetranslation: true
                });
                if (res && res.translations) {
                  const combined = res.translations.map((t) => t.translated || "").join(" ");
                  const finalResult = { id: item.id, original: item.text, translated: combined };
                  updateSidebarWithTranslations([finalResult]);
                  await saveAllTranslations([finalResult]);
                }
              } catch (e) {
                console.error("Sentence split retry failed:", e);
              }
            }
          }
        }
      }
      const recentEpCount = await getRecentEpisodeCount(5);
      const chunkDelay = calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode);
      logToSidebar(
        state.isTurboMode ? recentEpCount >= 4 ? `\u26A1 [\uCF8C\uC18D\uBAA8\uB4DC] \uCD5C\uADFC \uBC88\uC5ED \uD68C\uCC28(${recentEpCount}\uD654) \uACFC\uC5F4 \uBC29\uC9C0: \uBB36\uC74C \uAC04 \uB300\uAE30 \uC2DC\uAC04\uC744 ${(chunkDelay / 1e3).toFixed(1)}\uCD08\uB85C \uC644\uCDA9\uD569\uB2C8\uB2E4.` : `\u26A1 [\uCF8C\uC18D\uBAA8\uB4DC] \uBC88\uC5ED \uBB36\uC74C \uAC04 \uB300\uAE30 \uC2DC\uAC04\uC744 ${(chunkDelay / 1e3).toFixed(1)}\uCD08\uB85C \uC124\uC815\uD569\uB2C8\uB2E4.` : `RPM \uC81C\uD55C\uC744 \uD53C\uD558\uAE30 \uC704\uD574 \uBB36\uC74C \uAC04 \uB300\uAE30 \uC2DC\uAC04\uC744 ${(chunkDelay / 1e3).toFixed(1)}\uCD08\uB85C \uC124\uC815\uD569\uB2C8\uB2E4.`
      );
      let progress = 0;
      for (const [index, chunk] of chunks.entries()) {
        if (state.isTranslationCancelled) break;
        let currentChunk = chunk;
        const isLastChunk = index === chunks.length - 1;
        if (isLastChunk) {
          const currentChunkIdSet = new Set(chunk.map((c) => String(c.id)));
          const emptyItems = getPendingEmptyItems(
            textsToTranslate,
            currentChunkIdSet,
            state.translationCache,
            state.userDeletedTranslationPids,
            state.exclusionSet,
            state.activeSeparators
          );
          if (emptyItems.length > 0) {
            logToSidebar(
              `[\uB9C8\uC9C0\uB9C9 \uAFB8\uB7EC\uBBF8 \uD3EC\uD568] \uBC88\uC5ED \uC644\uB8CC \uD55C\uC2A4\uD15D\uC804, \uC774\uC804 \uBC88\uC5ED \uC911 \uBE48\uCE78(\uBBF8\uC644\uB8CC) \uBB38\uC7A5 ${emptyItems.length}\uAC1C\uB97C \uB9C8\uC9C0\uB9C9 \uBC88\uC5ED\uAFB8\uB7EC\uBBF8\uC5D0 \uD3EC\uD568\uD558\uC5EC \uD568\uAED8 \uBC88\uC5ED\uD569\uB2C8\uB2E4.`
            );
            emptyItems.forEach((item) => {
              const row = document.querySelector(`tr[data-pid="${item.id}"]`);
              if (row) {
                const cell = row.querySelector(".translated-text");
                if (cell) {
                  cell.textContent = "\u23F3 \uBC88\uC5ED \uC911...";
                  cell.style.color = "";
                }
              }
            });
            currentChunk = [...chunk, ...emptyItems];
          }
        }
        const currentChunkChars = currentChunk.reduce((sum, it) => sum + (it.text ? it.text.length : 0), 0);
        progress += chunk.length;
        logToSidebar(
          `(${progress}/${textsToTranslate.length}\uBB38\uC7A5, \uBB36\uC74C ${index + 1}/${chunks.length} [\uC57D ${currentChunkChars.toLocaleString()}\uC790]) \uBC88\uC5ED \uC9C4\uD589 \uC911...${currentChunk.length > chunk.length ? ` (\uBE48\uCE78 \uBB38\uC7A5 ${currentChunk.length - chunk.length}\uAC1C \uCD94\uAC00 \uD3EC\uD568)` : ""}`
        );
        await translateChunk(currentChunk, currentChunk.length);
        if (index < chunks.length - 1 && !state.isTranslationCancelled) {
          const currentDelay = calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode);
          logToSidebar(`${(currentDelay / 1e3).toFixed(1)}\uCD08 \uD6C4 \uB2E4\uC74C \uBB36\uC74C\uC744 \uBC88\uC5ED\uD569\uB2C8\uB2E4.`);
          await sleepResponsive(() => calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode));
          if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
            await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
            break;
          }
        }
      }
      if (!state.isTranslationCancelled) {
        const remainingEmptyItems = getPendingEmptyItems(
          textsToTranslate,
          /* @__PURE__ */ new Set(),
          state.translationCache,
          state.userDeletedTranslationPids,
          state.exclusionSet,
          state.activeSeparators
        );
        if (remainingEmptyItems.length > 0) {
          logToSidebar(
            `[\uBCF4\uC644 \uBC88\uC5ED\uAFB8\uB7EC\uBBF8] \uBC88\uC5ED \uC644\uB8CC \uC9C1\uC804, \uBBF8\uC644\uB8CC \uBE48\uCE78 \uBC88\uC5ED ${remainingEmptyItems.length}\uAC1C\uAC00 \uAC10\uC9C0\uB418\uC5B4 \uB9C8\uC9C0\uB9C9 \uBC88\uC5ED\uAFB8\uB7EC\uBBF8\uB85C \uCD94\uAC00 \uBC88\uC5ED\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4.`
          );
          remainingEmptyItems.forEach((item) => {
            const row = document.querySelector(`tr[data-pid="${item.id}"]`);
            if (row) {
              const cell = row.querySelector(".translated-text");
              if (cell) {
                cell.textContent = "\u23F3 \uBC88\uC5ED \uC911...";
                cell.style.color = "";
              }
            }
          });
          await translateChunk(remainingEmptyItems, remainingEmptyItems.length);
        }
      }
      sortSidebar(allParagraphs.map((p) => p.id));
      logToSidebar("\uBAA8\uB4E0 \uBC88\uC5ED \uC791\uC5C5\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      if (!state.isTranslationCancelled) {
        if (state.isReviewSession || window.location.hash.includes("lanovel_review") || state.reviewTargetPids && state.reviewTargetPids.size > 0) {
          logToSidebar("\u{1F514} [\uC54C\uB9BC \uC13C\uD130 \uAC80\uC218 \uBAA8\uB4DC] \uC7AC\uBC88\uC5ED \uAC80\uC218 \uD68C\uCC28\uC774\uBBC0\uB85C \uB2E4\uC74C \uD398\uC774\uC9C0 \uC790\uB3D9 \uB118\uAE30\uAE30\uAC00 \uBE44\uD65C\uC131\uD654\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
          return;
        }
        const currentUrl = getCleanUrl();
        const scraper = getScraper();
        const episodeTitle = scraper.extractEpisodeTitle() || document.title || "";
        const batchStats = await updateAndGetBatchCount(
          currentUrl,
          logToSidebar,
          state.currentNovelTitle,
          state.turboCutoffHour
        );
        const consecutiveCount = batchStats.consecutiveCount;
        const novelTodayCount = batchStats.novelTodayCount;
        const totalTodayCount = batchStats.totalTodayCount;
        const totalTodayMsg = totalTodayCount ? ` / \uC804\uCCB4: ${totalTodayCount}\uD654` : "";
        logToSidebar(
          `[\uBC88\uC5ED \uC9C4\uD589 \uCE74\uC6B4\uD130] \uD604\uC7AC \uC18C\uC124 \uC774\uBC88 \uC5F0\uC18D: ${consecutiveCount}\uD654 \uC644\uB8CC (\uC624\uB298 \uC774 \uC18C\uC124: ${novelTodayCount}\uD654${totalTodayMsg})`
        );
        if (consecutiveCount > 0 && consecutiveCount % 10 === 0) {
          logToSidebar(`\u{1F514} [\uC54C\uB9BC] \uC774\uBC88 \uC5F0\uC18D ${consecutiveCount}\uD654 \uB2EC\uC131! 10\uD654 \uB2E8\uC704 \uBC88\uC5ED \uC9C4\uD589 \uC54C\uB9BC\uC744 \uBC1C\uC1A1\uD569\uB2C8\uB2E4.`);
          sendProgressNotification(
            state.currentNovelTitle,
            episodeTitle,
            textsToTranslate.length,
            textsToTranslate.length,
            100,
            currentUrl,
            consecutiveCount
          );
        } else {
          logToSidebar(
            `[\uC54C\uB9BC] 10\uD654 \uB2E8\uC704 \uC54C\uB9BC \uC815\uCC45 \uC801\uC6A9 \uC911 (\uD604\uC7AC \uC774\uBC88 \uC5F0\uC18D: ${consecutiveCount}\uD654, \uB2E4\uC74C \uC54C\uB9BC: ${Math.ceil(consecutiveCount / 10) * 10}\uD654)`
          );
        }
        await recordRecentEpisode(currentUrl);
        const completedRecentCount = await getRecentEpisodeCount(5);
        const targetDelay = calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode);
        const delaySec = Math.round(targetDelay / 1e3);
        if (state.isTurboMode) {
          if (completedRecentCount >= 3) {
            logToSidebar(
              `\u26A1 [RPM \uC801\uC751\uD615 \uBCF4\uD638] \uCD5C\uADFC 5\uBD84\uAC04 \uBC88\uC5ED \uD68C\uCC28: ${completedRecentCount}\uD654 \uAC10\uC9C0 (\uACFC\uC5F4 \uBC29\uC9C0 \uAD6C\uAC04) \u2192 \uB2E4\uC74C \uD68C\uCC28 \uB300\uAE30 \uC2DC\uAC04\uC744 ${delaySec}\uCD08\uB85C \uC790\uB3D9 \uC5F0\uC7A5\uD569\uB2C8\uB2E4.`
            );
            showLanovelHud(`RPM \uBCF4\uD638 \uC9C0\uC5F0 \uC911... (${delaySec}\uCD08)`, "\u{1F6E1}\uFE0F", 4e3);
          } else {
            logToSidebar(
              `\u26A1 [\uCF8C\uC18D\uBAA8\uB4DC] \uBC88\uC5ED \uC644\uB8CC (\uCD5C\uADFC 5\uBD84: ${completedRecentCount}\uD654, \uC548\uC804 \uAD6C\uAC04). ${delaySec}\uCD08 \uD6C4 \uB2E4\uC74C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.`
            );
          }
        } else {
          if (completedRecentCount >= 5) {
            logToSidebar(
              `[RPM \uC801\uC751\uD615 \uBCF4\uD638] \uCD5C\uADFC 5\uBD84\uAC04 \uBC88\uC5ED \uD68C\uCC28: ${completedRecentCount}\uD654 \uAC10\uC9C0 \u2192 \uB2E4\uC74C \uD68C\uCC28 \uB300\uAE30 \uC2DC\uAC04\uC744 ${delaySec}\uCD08\uB85C \uC5F0\uC7A5\uD569\uB2C8\uB2E4.`
            );
          } else {
            logToSidebar(`\uBC88\uC5ED \uC644\uB8CC. ${delaySec}\uCD08 \uD6C4 \uD398\uC774\uC9C0 \uB05D\uC73C\uB85C \uC790\uB3D9 \uC2A4\uD06C\uB864\uD569\uB2C8\uB2E4.`);
          }
        }
        await sleepResponsive(() => calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode));
        if (state.isTranslationCancelled) return;
        if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
          await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
          return;
        }
        logToSidebar("\uD398\uC774\uC9C0 \uB05D\uC73C\uB85C \uC2A4\uD06C\uB864 \uD6C4 \uB2E4\uC74C \uD398\uC774\uC9C0 \uC561\uC158\uC744 \uC2E4\uD589\uD569\uB2C8\uB2E4.");
        const scrollTarget = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        window.scrollTo({ top: scrollTarget, behavior: "smooth" });
        await new Promise((resolve) => {
          let scrollCheckAttempts = 0;
          const checkScrollEndInterval = setInterval(() => {
            if (state.isTranslationCancelled) {
              clearInterval(checkScrollEndInterval);
              resolve();
              return;
            }
            scrollCheckAttempts++;
            const currentScroll = window.innerHeight + window.scrollY;
            const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            if (currentScroll >= maxScroll - 50 || scrollCheckAttempts >= 30) {
              clearInterval(checkScrollEndInterval);
              resolve();
            }
          }, 100);
        });
        if (state.isTranslationCancelled) return;
        const nextLink = scraper.findNextEpisodeLink();
        if (nextLink && nextLink.href) {
          const navDelay = Math.floor(Math.random() * 1e3) + 1500;
          logToSidebar(`\uB2E4\uC74C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4 (${(navDelay / 1e3).toFixed(1)}\uCD08 \uB300\uAE30): ${nextLink.href}`);
          sessionStorage.setItem("lanovel_auto_translate_next", "1");
          showLanovelHud("\uB2E4\uC74C \uD654\uB85C \uC790\uB3D9 \uC774\uB3D9...", "\u26A1");
          setTimeout(() => {
            window.location.href = nextLink.href;
          }, navDelay);
        } else {
          logToSidebar("\uB2E4\uC74C \uD398\uC774\uC9C0 \uBC84\uD2BC\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (\uC18C\uC124 \uC5F0\uC18D \uBC88\uC5ED \uC885\uB8CC)");
          sendCompleteNotification(
            state.currentNovelTitle,
            episodeTitle,
            textsToTranslate.length,
            currentUrl,
            consecutiveCount
          );
        }
      }
    } finally {
      isTranslatingInProgress = false;
      state.notifyInflightEnd();
      if (stopBtn) stopBtn.style.display = "none";
      if (retryBtn) retryBtn.style.display = "inline-block";
    }
  }
  var isTranslatingInProgress;
  var init_page_translator = __esm({
    "src/core/page_translator.ts"() {
      "use strict";
      init_state();
      init_filters();
      init_chunker();
      init_turbo();
      init_separators();
      init_adaptive_throttle();
      init_sidebar();
      init_hud();
      init_review_panel();
      init_scrapers();
      init_dom_applier();
      isTranslatingInProgress = false;
    }
  });

  // src/content.ts
  init_state();
  init_scrapers();
  init_page_translator();
  init_separators();
  init_turbo();
  init_sidebar();
  init_review_panel();
  init_separator_panel();

  // src/ui/key_nav.ts
  init_state();
  init_hud();
  init_toc_quick_jump();
  function setupLanovelKeyboardNavigation(scraper, onShowSidebar) {
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target) {
        const tagName = target.tagName ? target.tagName.toUpperCase() : "";
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key;
      const lowerKey = key.toLowerCase();
      if (key === "]" || lowerKey === "l") {
        const nextLink = scraper.findNextEpisodeLink();
        if (nextLink && nextLink.href) {
          e.preventDefault();
          sessionStorage.setItem("lanovel_auto_translate_next", "1");
          showLanovelHud("\uB2E4\uC74C \uD654\uB85C \uC774\uB3D9 \uBC0F \uC790\uB3D9 \uBC88\uC5ED...", "\u26A1");
          setTimeout(() => {
            window.location.href = nextLink.href;
          }, 150);
        } else {
          showLanovelHud("\uB2E4\uC74C \uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4 (\uB9C8\uC9C0\uB9C9 \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4)", "\u{1F3C1}");
        }
        return;
      }
      if (key === "[" || lowerKey === "h") {
        const prevLink = scraper.findPrevEpisodeLink();
        if (prevLink && prevLink.href) {
          e.preventDefault();
          showLanovelHud("\uC774\uC804 \uD654\uB85C \uC774\uB3D9 \uC911...", "\u23EE\uFE0F");
          setTimeout(() => {
            window.location.href = prevLink.href;
          }, 150);
        } else {
          showLanovelHud("\uCCAB \uBC88\uC9F8 \uD68C\uCC28\uC785\uB2C8\uB2E4", "\u{1F3C1}");
        }
        return;
      }
      if (lowerKey === "o" || lowerKey === "t") {
        if (!scraper.isTocPage(window.location.href, window.location.pathname)) {
          const tocLink = scraper.findTocLink();
          if (tocLink && tocLink.href) {
            e.preventDefault();
            showLanovelHud("\uC18C\uC124 \uBAA9\uCC28\uB85C \uC774\uB3D9 \uC911...", "\u{1F4D1}");
            setTimeout(() => {
              window.location.href = tocLink.href;
            }, 150);
          } else {
            showLanovelHud("\uBAA9\uCC28 \uB9C1\uD06C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", "\u2753");
          }
        }
        return;
      }
      const quickJumpDrawer = document.getElementById("lanovel-quick-jump-drawer");
      const isDrawerOpen = quickJumpDrawer && quickJumpDrawer.classList.contains("open");
      if (scraper.isTocPage(window.location.href, window.location.pathname) || isDrawerOpen) {
        if (lowerKey === "n") {
          e.preventDefault();
          handleQuickJumpNKey();
          return;
        }
        if (isDrawerOpen) {
          if (key === "ArrowDown") {
            e.preventDefault();
            moveQuickJumpFocus(1);
          } else if (key === "ArrowUp") {
            e.preventDefault();
            moveQuickJumpFocus(-1);
          } else if (key === "Enter") {
            if (quickJumpFocusedIndex >= 0 && quickJumpFocusedIndex < untranslatedEpisodesCache.length) {
              e.preventDefault();
              const targetEp = untranslatedEpisodesCache[quickJumpFocusedIndex];
              if (targetEp && targetEp.url) {
                if (targetEp.isExcluded) {
                  showLanovelHud(`'${targetEp.title}'\uC740(\uB294) \uC81C\uC678\uB41C \uD68C\uCC28\uC785\uB2C8\uB2E4.`, "\u26A0\uFE0F", 2e3);
                  return;
                }
                sessionStorage.setItem("lanovel_auto_translate_next", "1");
                showLanovelHud(`'${targetEp.title}' \uC9C4\uC785 \uBC0F \uC790\uB3D9 \uBC88\uC5ED...`, "\u26A1");
                setTimeout(() => {
                  window.location.href = targetEp.url;
                }, 150);
              }
            }
          } else if (key === "Escape") {
            e.preventDefault();
            toggleQuickJumpDrawer(false);
          }
        }
      }
    });
  }
  function checkAutoTranslateNextTrigger(onShowSidebar) {
    if (sessionStorage.getItem("lanovel_auto_translate_next") === "1") {
      sessionStorage.removeItem("lanovel_auto_translate_next");
      if (state.turboAbortedOnLoad || state.isTranslationCancelled) {
        console.log("[checkAutoTranslateNextTrigger] \uCF8C\uC18D\uBAA8\uB4DC \uC815\uAC01 \uB3C4\uB2EC\uB85C \uC0C8 \uD68C\uCC28 \uC790\uB3D9 \uBC88\uC5ED \uCDE8\uC18C");
        return;
      }
      showLanovelHud("\uC0C8 \uD68C\uCC28 \uC790\uB3D9 \uBC88\uC5ED\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4!", "\u26A1", 2500);
      setTimeout(() => {
        if (!state.turboAbortedOnLoad && !state.isTranslationCancelled) {
          onShowSidebar();
        }
      }, 500);
    }
  }

  // src/content.ts
  init_toc_quick_jump();
  init_hud();
  var DEFAULT_ALLOWED_DOMAINS = [
    "kakuyomu.jp",
    "syosetu.com",
    "novel18.syosetu.com",
    "ncode.syosetu.com",
    "noc.syosetu.com",
    "mid.syosetu.com",
    "mnlt.syosetu.com",
    "novelup.plus",
    "syosetu.org",
    "alphapolis.co.jp"
  ];
  async function init() {
    try {
      const hostname = window.location.hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.")) {
        return;
      }
      const currentUrl = window.location.href;
      let isAllowed = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const response = await fetch("http://127.0.0.1:8001/api/allowed_origins", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const allowedOrigins = await response.json();
          isAllowed = allowedOrigins.some((origin) => currentUrl.startsWith(origin));
        }
      } catch (e) {
        console.warn("[LANOVEL] \uD5C8\uC6A9 \uB3C4\uBA54\uC778 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328 (\uAE30\uBCF8 \uB3C4\uBA54\uC778 \uBAA9\uB85D \uD3F4\uBC31 \uC9C4\uD589)");
      }
      if (!isAllowed) {
        const isDefaultDomain = DEFAULT_ALLOWED_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith("." + domain)
        );
        if (isDefaultDomain) {
          isAllowed = true;
        }
      }
      if (!isAllowed) {
        console.log(`[LANOVEL] \uD604\uC7AC URL(${currentUrl})\uC774 \uD5C8\uC6A9 \uBAA9\uB85D\uC5D0 \uC5C6\uC5B4 \uD655\uC7A5\uC744 \uBE44\uD65C\uC131\uD654\uD569\uB2C8\uB2E4.`);
        return;
      }
      console.log("[LANOVEL] \uC6F9\uC18C\uC124 \uBC88\uC5ED \uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8 \uCD08\uAE30\uD654 \uC2DC\uC791...");
      const scraper = getScraper();
      state.onExtractEpisodeTitle = () => scraper.extractEpisodeTitle();
      if (scraper.prepareContent) {
        scraper.prepareContent();
      }
      injectSidebar();
      setupLanovelKeyboardNavigation(scraper, () => {
        showSidebar();
        translateAllPTags(false);
      });
      if (scraper.isTocPage(window.location.href, window.location.pathname)) {
        console.log("[LANOVEL] \uBAA9\uCC28(TOC) \uD398\uC774\uC9C0 \uAC10\uC9C0: \uBAA9\uCC28 \uAE30\uB2A5(\uBC30\uC9C0 \uBC0F \uD035 \uC810\uD504 \uC11C\uB78D)\uC744 \uC989\uC2DC \uCD08\uAE30\uD654\uD569\uB2C8\uB2E4.");
        try {
          const title = await scraper.detectNovelTitle() || "\uAE30\uBCF8 \uC18C\uC124";
          state.currentNovelTitle = title;
          updateNovelTitleUI(title);
        } catch (_) {
        }
        await initTocPageFeatures(scraper);
        return;
      }
      await loadTurboModeState();
      const currentCleanUrl = getCleanUrl();
      const isExcluded = await isEpisodeUrlExcluded(currentCleanUrl);
      if (isExcluded) {
        console.log(`[LANOVEL] \uC81C\uC678\uB41C \uD68C\uCC28 \uAC10\uC9C0: ${currentCleanUrl} - \uBC88\uC5ED\uC744 \uC218\uD589\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
        let nextLink = scraper.findNextEpisodeLink ? scraper.findNextEpisodeLink() : null;
        if (!nextLink) {
          await new Promise((r) => setTimeout(r, 300));
          nextLink = scraper.findNextEpisodeLink ? scraper.findNextEpisodeLink() : null;
        }
        if (nextLink && nextLink.href) {
          showLanovelHud("\uBC88\uC5ED \uC81C\uC678 \uD68C\uCC28\uC785\uB2C8\uB2E4. \uB2E4\uC74C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4...", "\u23ED\uFE0F", 2e3);
          sessionStorage.setItem("lanovel_auto_translate_next", "1");
          setTimeout(() => {
            window.location.href = nextLink.href;
          }, 600);
          return;
        } else {
          sessionStorage.removeItem("lanovel_auto_translate_next");
          showLanovelHud("\uB9C8\uC9C0\uB9C9 \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4. (\uC18C\uC124 \uC5F0\uC18D \uBC88\uC5ED \uC885\uB8CC)", "\u{1F3C1}", 5e3);
          logToSidebar("\uB2E4\uC74C \uD398\uC774\uC9C0 \uBC84\uD2BC\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (\uB9C8\uC9C0\uB9C9 \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4)");
          return;
        }
      }
      const cleanUrl = getCleanUrl();
      let novelTitle = "";
      try {
        const resp = await fetch(`http://127.0.0.1:8001/api/novel_info?url=${encodeURIComponent(cleanUrl)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.folderName) novelTitle = data.folderName;
        }
      } catch (e) {
      }
      if (!novelTitle) {
        novelTitle = await scraper.detectNovelTitle() || "\uAE30\uBCF8 \uC18C\uC124";
      }
      state.currentNovelTitle = novelTitle;
      updateNovelTitleUI(novelTitle);
      state.separatorConfig = await loadNovelSeparators(novelTitle);
      state.activeSeparators = state.separatorConfig.effectiveSeparators;
      renderSeparatorSettingsPanel();
      const translations = await ensureTranslationsLoaded();
      if (translations) {
        await checkAndExcludeSeparatorTranslations(translations);
      }
      checkAutoTranslateNextTrigger(() => {
        showSidebar();
        translateAllPTags(false);
      });
      await checkAndLoadReviewTargets(cleanUrl);
      let initialApplied = false;
      try {
        const resp = await fetch(`http://127.0.0.1:8001/api/urls/apply_status?url=${encodeURIComponent(cleanUrl)}`);
        if (resp.ok) {
          const status = await resp.json();
          initialApplied = !!status.applied;
        }
      } catch (e) {
        const storageResult = await chrome.storage.local.get(["status-" + cleanUrl, "status-" + window.location.href]);
        const localStatus = storageResult["status-" + cleanUrl] || storageResult["status-" + window.location.href];
        if (localStatus && typeof localStatus.applied === "boolean") {
          initialApplied = localStatus.applied;
        }
      }
      state.isPageApplied = initialApplied;
      updateApplyButtonUI(state.isPageApplied);
      if (state.isPageApplied && translations) {
        applyTranslationsToPage(translations, false);
      }
      setupParagraphInteraction();
      state.onExtractEpisodeTitle = () => scraper.extractEpisodeTitle();
      state.onNextEpisode = () => {
        const link = scraper.findNextEpisodeLink();
        if (!link || !link.href) return { ok: false, message: "\uB2E4\uC74C \uD654 \uB9C1\uD06C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
        sessionStorage.setItem("lanovel_auto_translate_next", "1");
        showLanovelHud("\uC6D0\uACA9: \uB2E4\uC74C \uD654\uB85C \uC774\uB3D9", "\u27A1\uFE0F");
        setTimeout(() => {
          window.location.href = link.href;
        }, 300);
        return { ok: true, message: "\uB2E4\uC74C \uD654\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4." };
      };
      state.onPrevEpisode = () => {
        const link = scraper.findPrevEpisodeLink();
        if (!link || !link.href) return { ok: false, message: "\uC774\uC804 \uD654 \uB9C1\uD06C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
        sessionStorage.setItem("lanovel_auto_translate_next", "1");
        showLanovelHud("\uC6D0\uACA9: \uC774\uC804 \uD654\uB85C \uC774\uB3D9", "\u23EE\uFE0F");
        setTimeout(() => {
          window.location.href = link.href;
        }, 300);
        return { ok: true, message: "\uC774\uC804 \uD654\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4." };
      };
      state.onRetranslate = () => {
        startFullRetranslation();
        return { ok: true, message: "\uC7AC\uBC88\uC5ED\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4." };
      };
      state.onStartTranslation = async (isRetrans = false) => {
        await translateAllPTags(isRetrans);
      };
      state.onToggleTurboMode = (enabled, save) => {
        setTurboMode(enabled, save);
      };
      const stopBtn = document.getElementById("stop-translation-btn");
      if (stopBtn) {
        stopBtn.addEventListener("click", () => {
          state.isTranslationCancelled = true;
          stopBtn.style.display = "none";
          const retryBtn2 = document.getElementById("retry-translation-btn");
          if (retryBtn2) retryBtn2.style.display = "inline-block";
          logToSidebar("\uBC88\uC5ED\uC774 \uC911\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
          updateSidebarWithCancelled();
          state.broadcastStatus();
        });
      }
      const retryBtn = document.getElementById("retry-translation-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          startFullRetranslation();
        });
      }
      const resumeBtn = document.getElementById("resume-translation-btn");
      if (resumeBtn) {
        resumeBtn.addEventListener("click", () => {
          if (state.resolveResume) {
            resumeBtn.style.display = "none";
            if (stopBtn) stopBtn.style.display = "inline-block";
            const resolver = state.resolveResume;
            state.resolveResume = null;
            resolver();
          }
        });
      }
      const applyToggleBtn = document.getElementById("sidebar-apply-toggle-btn");
      if (applyToggleBtn) {
        applyToggleBtn.addEventListener("click", () => {
          setPageApplyStatus(!state.isPageApplied, true);
        });
      }
      if (getTargetParagraphs().length === 0) {
        for (let retry = 0; retry < 3; retry++) {
          await new Promise((r) => setTimeout(r, 250));
          if (scraper.prepareContent) {
            scraper.prepareContent();
          }
          if (getTargetParagraphs().length > 0) {
            setupParagraphInteraction();
            break;
          }
        }
      }
      if (state.turboAbortedOnLoad || state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
        if (!state.turboAbortedOnLoad) {
          await abortTurboMode("\uCD08\uAE30\uD654 \uC2DC\uAC04 \uB3C4\uB2EC");
        }
        logToSidebar("\u23F0 [\uC815\uAC01 \uB3C4\uB2EC] \uCF8C\uC18D\uBAA8\uB4DC \uCD08\uAE30\uD654 \uC815\uAC01\uC5D0 \uB3C4\uB2EC\uD558\uC5EC \uC790\uB3D9 \uBC88\uC5ED\uC774 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", "log-error");
      } else {
        if (hasUntranslatedParagraphs()) {
          showSidebar();
          translateAllPTags(false);
        } else {
          if (retryBtn) retryBtn.style.display = "inline-block";
          console.log("[LANOVEL] \uBAA8\uB4E0 \uBB38\uC7A5\uC774 \uC774\uBBF8 \uBC88\uC5ED\uB418\uC5B4 \uC788\uC5B4 \uC790\uB3D9 \uBC88\uC5ED\uC744 \uC0DD\uB7B5\uD569\uB2C8\uB2E4.");
        }
      }
      await initTocPageFeatures(scraper);
    } catch (error) {
      console.error("[LANOVEL] \uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8 \uCD08\uAE30\uD654 \uC624\uB958:", error);
    }
  }
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.action === "remoteCommand") {
      try {
        const result = state.handleRemoteCommand(request.type, request.params || {});
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, message: String(e && e.message || e) });
      }
      return false;
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    const cleanUrl = getCleanUrl();
    const statusKey = "status-" + window.location.href;
    const cleanStatusKey = "status-" + cleanUrl;
    const change = changes[statusKey] || changes[cleanStatusKey];
    if (change && change.newValue) {
      const targetApplied = !!change.newValue.applied;
      if (targetApplied !== state.isPageApplied) {
        setPageApplyStatus(targetApplied, false);
      }
    }
    if (changes.lanovel_turbo_mode) {
      const newTurbo = !!changes.lanovel_turbo_mode.newValue;
      if (newTurbo !== state.isTurboMode) {
        state.isTurboMode = newTurbo;
        updateTurboModeUI(state.isTurboMode);
        if (state.currentDelayResolver) state.currentDelayResolver();
      }
    }
    if (changes.lanovel_turbo_cutoff) {
      state.turboCutoffHour = changes.lanovel_turbo_cutoff.newValue;
      updateTurboBadgeUI();
    }
    if (changes.lanovel_turbo_target) {
      state.turboTargetTimestamp = changes.lanovel_turbo_target.newValue || 0;
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=content.js.map
