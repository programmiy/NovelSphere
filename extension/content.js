"use strict";
(() => {
  // src/core/separators.ts
  var DEFAULT_GLOBAL_SEPARATORS = [
    "\u25C6\u25C7\u25C6\u25C7",
    "\u25C7\u25C6\u25C7\u25C6",
    "----------------",
    "------------------------------------------------",
    "\uFF0A\uFF0A\uFF0A",
    "***",
    "==="
  ];
  var PRESET_SEPARATORS = [
    { name: "\uB2E4\uC774\uC544 (\u25C6\u25C7\u25C6\u25C7)", sep: "\u25C6\u25C7\u25C6\u25C7" },
    { name: "\uC5ED\uB2E4\uC774\uC544 (\u25C7\u25C6\u25C7\u25C6)", sep: "\u25C7\u25C6\u25C7\u25C6" },
    { name: "\uC9E7\uC740 \uB300\uC2DC (----------------)", sep: "----------------" },
    { name: "\uAE34 \uB300\uC2DC (------------------------------------------------)", sep: "------------------------------------------------" },
    { name: "\uC804\uAC01 \uBCC4 (\uFF0A\uFF0A\uFF0A)", sep: "\uFF0A\uFF0A\uFF0A" },
    { name: "\uBC18\uAC01 \uBCC4 (***)", sep: "***" }
  ];
  function checkSeparatorMatch(text, separators) {
    if (!text || !separators || separators.length === 0) return null;
    const trimmed = text.trim();
    for (const sep of separators) {
      if (!sep || !sep.trim()) continue;
      const cleanSep = sep.trim();
      if (trimmed === cleanSep || trimmed.includes(cleanSep)) {
        return sep;
      }
    }
    return null;
  }
  function analyzeSeparatorSections(validParagraphs, separators) {
    const result = {
      prefacePids: /* @__PURE__ */ new Set(),
      afterwordPids: /* @__PURE__ */ new Set(),
      separatorPids: /* @__PURE__ */ new Set()
    };
    if (!validParagraphs || validParagraphs.length === 0 || !separators || separators.length === 0) {
      return result;
    }
    const matches = [];
    validParagraphs.forEach((p, idx) => {
      const matched = checkSeparatorMatch(p.text, separators);
      if (matched) {
        matches.push({ index: idx, pid: p.pid, sep: matched });
        result.separatorPids.add(p.pid);
      }
    });
    if (matches.length === 0) {
      return result;
    }
    const total = validParagraphs.length;
    if (matches.length === 1) {
      const single = matches[0];
      if (single.index <= total * 0.3) {
        result.topSeparator = { sep: single.sep, index: single.index };
        for (let i = 0; i <= single.index; i++) {
          result.prefacePids.add(validParagraphs[i].pid);
        }
      } else {
        result.bottomSeparator = { sep: single.sep, index: single.index };
        for (let i = single.index; i < total; i++) {
          result.afterwordPids.add(validParagraphs[i].pid);
        }
      }
      return result;
    }
    const first = matches[0];
    const last = matches[matches.length - 1];
    result.topSeparator = { sep: first.sep, index: first.index };
    for (let i = 0; i <= first.index; i++) {
      result.prefacePids.add(validParagraphs[i].pid);
    }
    result.bottomSeparator = { sep: last.sep, index: last.index };
    for (let i = last.index; i < total; i++) {
      result.afterwordPids.add(validParagraphs[i].pid);
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
    try {
      await fetch("http://127.0.0.1:8001/api/separators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("[saveNovelSeparators] Server save failed:", e);
    }
    const cacheKey = `separators_${novelTitle}`;
    await chrome.storage.local.set({ [cacheKey]: config });
    return config;
  }

  // src/core/state.ts
  var ExtensionState = class {
    // 번역 수명주기 상태
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
    // 콜백 핸들러 주입 (순환 참조 방지)
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
      if (this.reportIntervalTimer) clearInterval(this.reportIntervalTimer);
      this.reportIntervalTimer = setInterval(() => {
        this.broadcastStatus();
      }, 2e3);
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
  var state = new ExtensionState();

  // src/scrapers/kakuyomu.ts
  var KakuyomuScraper = class {
    name = "kakuyomu";
    matches(_url, host) {
      return host.includes("kakuyomu.jp");
    }
    detectNovelTitle() {
      const workLink = Array.from(document.querySelectorAll('header a[href*="/works/"]')).find((a) => {
        const txt = (a.textContent || "").trim();
        const aria = a.getAttribute("aria-label") || "";
        const href = a.getAttribute("href") || "";
        return txt && !txt.includes("\u9589\u3058\u308B") && !aria.includes("\u9589\u3058\u308B") && !txt.includes("\u76EE\u6B21") && !txt.includes("TOP") && /\/works\/\d+$/.test(href.split("?")[0]);
      }) || document.querySelector(".widget-toc-main-title") || document.querySelector('a[href^="/works/"][class*="Title"]') || document.querySelector('header a[class*="workTitle"]');
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
      }
      return null;
    }
    extractEpisodeTitle() {
      const epEl = document.querySelector('.widget-episodeTitle, [class*="widget-episodeTitle"], h1[class*="episodeTitle"]');
      if (epEl && epEl.textContent && epEl.textContent.trim()) {
        return epEl.textContent.trim();
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
      return /\/works\/\d+\/?$/.test(path) || !!document.querySelector(".widget-toc-episode");
    }
    findNextEpisodeLink() {
      const direct = document.getElementById("contentMain-nextEpisode") || document.querySelector("a.widget-episodeNavigation-next") || document.querySelector("#contentMain-readNextEpisode") || document.querySelector("a.js-read-next-episode") || document.querySelector('a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"]');
      if (direct && direct.href) return direct;
      const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
      const found = candidates.find((a) => (a.textContent || "").includes("\u6B21\u306E\u30A8\u30D4\u30BD\u30FC\u30C9"));
      if (found && found.href) return found;
      const relNext = document.querySelector('a[rel="next"], link[rel="next"]');
      if (relNext && relNext.href) return relNext;
      return null;
    }
    findPrevEpisodeLink() {
      const direct = document.getElementById("contentMain-previousEpisode") || document.querySelector("a.widget-episodeNavigation-previous");
      if (direct && direct.href) return direct;
      const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
      const found = candidates.find((a) => (a.textContent || "").includes("\u524D\u306E\u30A8\u30D4\u30BD\u30FC\u30C9"));
      if (found && found.href) return found;
      return null;
    }
    findTocLink() {
      const links = Array.from(
        document.querySelectorAll('header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"]')
      );
      const found = links.find((a) => /\/works\/\d+$/.test((a.getAttribute("href") || "").split("?")[0]));
      return found || null;
    }
    getTocEpisodes() {
      const elements = Array.from(
        document.querySelectorAll(".widget-toc-episode a, a.widget-toc-episode-episodeTitle")
      );
      return elements.map((el) => ({
        element: el,
        url: el.href.split("#")[0],
        title: (el.textContent || "").trim()
      }));
    }
  };

  // src/scrapers/syosetu.ts
  var SyosetuScraper = class {
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
      if (epEl && epEl.textContent && epEl.textContent.trim()) {
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
    getTocEpisodes() {
      const elements = Array.from(
        document.querySelectorAll(
          "a.p-eplist__subtitle, .p-eplist a.p-eplist__subtitle, .p-eplist__sublist a, .p-eplist a, .index_box .subtitle a, .subtitle a"
        )
      ).filter((el) => {
        const rawHref = el.getAttribute("href") || "";
        const cleanHref = rawHref.split("#")[0].split("?")[0];
        return /\/\d+\/?$/.test(cleanHref);
      });
      return elements.map((el) => ({
        element: el,
        url: el.href.split("#")[0],
        title: (el.textContent || "").trim()
      }));
    }
  };

  // src/scrapers/novelup.ts
  var NovelUpScraper = class {
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
      if (epEl && epEl.textContent && epEl.textContent.trim()) {
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
      const lines = rawHtml.split(/\r?\n/);
      if (lines.length <= 1 && epContent.querySelectorAll("p").length > 1) {
        return;
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
    getTocEpisodes() {
      let elements = Array.from(
        document.querySelectorAll(
          '.episodeListItem a.episodeTitle, #section_episode a.episodeTitle, .episodeListItem a, a.episodeTitle, .storyList .episode a, .episode_list a, .storyList a[href*="/story/"]'
        )
      ).filter((el) => {
        const rawHref = el.getAttribute("href") || "";
        const cleanHref = rawHref.split("#")[0].split("?")[0];
        return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
      });
      if (!elements.length) {
        elements = Array.from(document.querySelectorAll('a[href*="/story/"]')).filter((el) => {
          const rawHref = el.getAttribute("href") || "";
          const cleanHref = rawHref.split("#")[0].split("?")[0];
          return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
        });
      }
      return elements.map((el) => ({
        element: el,
        url: el.href.split("#")[0],
        title: (el.textContent || "").trim()
      }));
    }
  };

  // src/scrapers/hameln.ts
  var HamelnScraper = class {
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
      if (epEl && epEl.textContent && epEl.textContent.trim()) {
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
      return /\/novel\/\d+\/?$/.test(path) || !path.endsWith(".html") && document.querySelectorAll('table a[href*="/novel/"]').length > 3;
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
    getTocEpisodes() {
      const elements = Array.from(document.querySelectorAll('table a[href*="/novel/"]'));
      return elements.map((el) => ({
        element: el,
        url: el.href.split("#")[0],
        title: (el.textContent || "").trim()
      }));
    }
  };

  // src/scrapers/alphapolis.ts
  var AlphapolisScraper = class {
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
      if (epEl && epEl.textContent && epEl.textContent.trim()) {
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
      return /\/novel\/\d+\/?$/.test(path) || !!document.querySelector(".content-statuses, .episode-list, .episodes");
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
    getTocEpisodes() {
      const elements = Array.from(
        document.querySelectorAll(".episode a, .episode-list a, .episodes a")
      );
      return elements.map((el) => ({
        element: el,
        url: el.href.split("#")[0],
        title: (el.textContent || "").trim()
      }));
    }
  };

  // src/scrapers/generic.ts
  var GenericScraper = class {
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

  // src/scrapers/index.ts
  var scrapers = [
    new KakuyomuScraper(),
    new SyosetuScraper(),
    new NovelUpScraper(),
    new HamelnScraper(),
    new AlphapolisScraper()
  ];
  var genericScraper = new GenericScraper();
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

  // src/core/filters.ts
  var JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;
  var PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
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
  var SIMPLIFIED_CHINESE_CHARS = new Set(
    "\u4F24\u4F53\u56FD\u7231\u65F6\u95E8\u5B66\u4E66\u7535\u89C1\u540E\u53D1\u957F\u6C14\u8F66\u5F00\u4E3A\u8FC7\u4E48\u8FD9\u5934\u7ECF\u52A8\u95EE\u5E94\u73B0\u5B9E\u5173\u70B9\u8FDB\u4ECE\u603B\u5C06\u5185\u95F4\u6765\u8BF4\u8BDD\u5BF9\u7ED9\u4F1A\u628A\u6CA1\u8BA9\u6837\u600E\u4E48\u53BB\u91CC\u4E24\u8D77\u5E26\u542C\u8BF4\u53D8\u4EEC\u8FD9\u4E3A\u4E48\u7740\u8BF4\u5BF9\u8BA9\u7ED9\u6837\u600E\u4E24\u5E26\u542C\u53D8\u5934\u7ECF\u52A8\u95EE\u5E94\u5173\u8FDB\u4ECE\u95F4\u957F\u8F66\u95E8\u89C1\u4E66\u7535\u4F24\u53D1\u8FC7\u65F6\u8FD8\u5F00\u5199\u8BDD\u8FB9\u4E1C\u5904\u529E\u5E2E\u5B9D\u5907\u7B14\u4EA7\u573A\u89C6\u8BA4\u673A\u4E1A\u5F20\u8282\u8BED\u867D\u968F\u5C81\u5B59\u635F\u7F29\u9501\u6001\u644A\u8D2A\u6EE9\u575B\u53F9\u6C64\u70EB\u6D9B\u8BA8\u817E\u94C1\u5385\u94DC\u7EDF\u56FE\u6D82\u56E2\u9893\u817F\u6258\u8131\u6D3C\u889C\u7F51\u4F2A\u8FDD\u56F4\u7EAC\u4F1F\u536B\u6E29\u95FB\u7A33\u6DA1\u7A9D\u545C\u575E\u59A9\u96FE\u52A1\u8BEF\u9521\u727A\u88AD\u4E60\u620F\u7EC6\u867E\u5413\u663E\u9669\u7EBF\u5BAA\u53BF\u54CD\u9879\u9500\u6653\u4E9B\u6CC4\u8C22\u950C\u5174\u6C79\u7EE3\u9508\u987B\u865A\u5618\u8BB8\u53D9\u7EEA\u7EED\u8F69\u60AC\u9009\u8BE2\u5BFB\u8BAD\u8BAF\u900A\u538B\u9E26\u9E2D\u54D1\u4E9A\u8BB6\u4E25\u5CA9\u76D0\u538C\u626C\u9633\u517B\u7476\u6447\u5C27\u9065\u7A91\u836F\u7237\u9875\u53F6\u533B\u4EBF\u4E49\u827A\u8BAE\u8BD1\u5F02\u836B\u9634\u94F6\u996E\u9690\u9E70\u5A74\u83B9\u8425\u8367\u8747\u8D62\u9896\u54DF\u62E5\u4F63\u548F\u8E0A\u6D8C\u75C8\u4F18\u72B9\u6CB9\u90AE\u94C0\u6E38\u8BF1\u9C7C\u6E14\u5A31\u4E0E\u5C7F\u5401\u9A6D\u72F1\u8A89\u9884\u6E0A\u5458\u5706\u56ED\u8F95\u8FDC\u6028\u613F\u7EA6\u8DC3\u94A5\u5CB3\u7CA4\u60A6\u9605\u4E91\u5300\u9668\u8FD0\u8574\u915D\u6655\u97F5\u6742\u707E\u8F7D\u6512\u6682\u8D5E\u51FF\u7076\u5219\u62E9\u6CFD\u8D23\u8D3C\u95F8\u624E\u658B\u503A\u6BE1\u6218\u6808\u5360\u7C98\u6DA8\u5E10\u8D26\u80C0\u8D75\u7167\u6298\u54F2\u9488\u4FA6\u73CD\u771F\u8BCA\u9547\u9635\u4E89\u5F81\u6323\u7741\u72F0\u8BC1\u652F\u53EA\u7EC7\u804C\u6267\u7EB8\u6307\u63B7\u5E1C\u8D28\u949F\u7EC8\u79CD\u80BF\u91CD\u5468\u6D32\u663C\u6731\u732A\u8BF8\u8BDB\u70DB\u77A9\u5C5E\u8457\u52A9\u94F8\u7B51\u6293\u62FD\u4E13\u7816\u8F6C\u8D5A\u5E84\u6869\u88C5\u58EE\u72B6\u9525\u8FFD\u51C6\u6D4A\u7EB5\u90B9\u963B\u7EC4\u94BB\u522B\u6CA1\u4E48\u4E3A\u4EC0\u4E48\u600E\u4E48\u5982\u679C\u56E0\u4E3A\u6240\u4EE5\u4F46\u662F\u800C\u4E14\u7136\u540E\u77E5\u9053\u770B\u89C1\u89C9\u5F97"
  );
  var CHINESE_INDICATOR_CHARS = new Set(
    "\u7684\u4E86\u662F\u5728\u6211\u6709\u4E2A\u4EBA\u8FD9\u4E3A\u8BF4\u548C\u65F6\u8981\u4F60\u3479\u540E\u5BF9\u7740\u91CC\u53BB\u8FC7\u53D1\u90FD\u7ECF\u5F53\u4E0E\u5B66\u8FDB\u8FD8\u6CA1\u73B0\u5979\u4ED6\u4EEC\u5199\u542C\u5934\u95EE\u8BDD\u5E26\u8BA9\u6837\u7ED9\u4ECE\u5173\u53D8\u603B\u4E24\u5E94\u95F4\u957F\u8F66\u95E8\u89C1\u4E66\u7535\u4F24\u52A8\u5F00\u6761\u8FB9\u4E1C\u5904\u529E\u5E2E\u5B9D\u5907\u7B14\u4EA7\u573A\u89C6\u8BA4\u673A\u5B9E\u4E1A\u5F20\u8282\u8BED\u867D\u968F\u5C81\u5B59\u635F\u7F29\u9501\u6001\u6EE9\u575B\u53F9\u6C64\u8BA8\u4F53\u94C1\u5385\u7EDF\u56FE\u56E2\u8131\u7F51\u4F2A\u8FDD\u56F4\u536B\u95FB\u7A33\u52A1\u8BEF\u88AD\u4E60\u620F\u7EC6\u663E\u9669\u7EBF\u53BF\u54CD\u9879\u9500\u4E9B\u8C22\u5174\u987B\u865A\u8BB8\u53D9\u7EED\u9009\u8BE2\u5BFB\u8BAD\u538B\u4E25\u5CA9\u76D0\u538C\u626C\u9633\u517B\u836F\u9875\u53F6\u533B\u4EBF\u4E49\u827A\u8BAE\u8BD1\u5F02\u9690\u9E70\u5A74\u8425\u8D62\u4F18\u72B9\u6CB9\u90AE\u6CB9\u6E38\u8BF1\u9C7C\u6E14\u5A31\u4E0E\u5C7F\u8BED\u5401\u72F1\u8A89\u9884\u5458\u5706\u56ED\u8FDC\u6028\u613F\u7EA6\u8DC3\u8FD0\u6742\u707E\u8F7D\u6682\u8D5E\u5219\u62E9\u6CFD\u8D23\u8D3C\u6218\u5F20\u8D75\u7167\u9488\u4FA6\u73CD\u8BCA\u9547\u9635\u4E89\u5F81\u6323\u7741\u8BC1\u53EA\u7EC7\u804C\u6267\u7EB8\u6307\u8D28\u949F\u7EC8\u79CD\u91CD\u5468\u663C\u8BF8\u6731\u73E0\u77A9\u52A9\u4E13\u7816\u8F6C\u8D5A\u5E84\u88C5\u58EE\u72B6\u8FFD\u51C6\u603B\u7EC4\u5417\u5427\u5462\u554A\u4E48\u600E\u8C01\u4E3A\u4EC0\u4E48\u600E\u4E48\u56E0\u4E3A\u6240\u4EE5\u5982\u679C\u4F46\u662F"
  );
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

  // src/core/chunker.ts
  var CHUNK_BUDGET_CHARACTERS = 2e3;
  var CHUNK_BUDGET_MAX_ITEMS = 40;
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

  // src/core/adaptive_throttle.ts
  var RECENT_EPISODES_STORAGE_KEY = "lanovel_recent_episodes";
  var recentEpisodesMemoryCache = [];
  async function recordRecentEpisode(cleanUrl) {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1e3;
    try {
      const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
      let list = data[RECENT_EPISODES_STORAGE_KEY] || [];
      list = list.filter((item) => item.timestamp >= tenMinutesAgo);
      list = list.filter((item) => item.url !== cleanUrl);
      list.push({ url: cleanUrl, timestamp: now });
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
      const list = data[RECENT_EPISODES_STORAGE_KEY] || [];
      recentEpisodesMemoryCache = list;
      const recentItems = list.filter((item) => item.timestamp >= cutoffTime);
      const uniqueUrls = new Set(recentItems.map((item) => item.url));
      return uniqueUrls.size;
    } catch (e) {
      console.warn("[getRecentEpisodeCount] Fallback to memory cache:", e);
      const recentItems = recentEpisodesMemoryCache.filter((item) => item.timestamp >= cutoffTime);
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
  async function updateAndGetBatchCount(currentCleanUrl) {
    const now = Date.now();
    const sessionTimeoutMs = 30 * 60 * 1e3;
    const todayDateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    try {
      const data = await chrome.storage.local.get([
        "lanovel_consecutive_batch_count",
        "lanovel_last_batch_timestamp",
        "lanovel_last_batch_url",
        "lanovel_daily_counts"
      ]);
      let consecutive = data.lanovel_consecutive_batch_count || 0;
      const lastTimestamp = data.lanovel_last_batch_timestamp || 0;
      const lastUrl = data.lanovel_last_batch_url || "";
      let dailyCounts = data.lanovel_daily_counts || {};
      if (!dailyCounts[todayDateStr]) {
        dailyCounts = { [todayDateStr]: { total: 0, byUrl: {} } };
      }
      if (now - lastTimestamp > sessionTimeoutMs) {
        consecutive = 0;
      }
      if (lastUrl !== currentCleanUrl) {
        consecutive++;
        dailyCounts[todayDateStr].total = (dailyCounts[todayDateStr].total || 0) + 1;
        dailyCounts[todayDateStr].byUrl[currentCleanUrl] = (dailyCounts[todayDateStr].byUrl[currentCleanUrl] || 0) + 1;
        await chrome.storage.local.set({
          lanovel_consecutive_batch_count: consecutive,
          lanovel_last_batch_timestamp: now,
          lanovel_last_batch_url: currentCleanUrl,
          lanovel_daily_counts: dailyCounts
        });
      }
      return {
        consecutiveCount: consecutive,
        novelTodayCount: dailyCounts[todayDateStr]?.byUrl[currentCleanUrl] || 1,
        totalTodayCount: dailyCounts[todayDateStr]?.total || 1
      };
    } catch (e) {
      console.warn("[updateAndGetBatchCount] Failed to update batch count:", e);
      return { consecutiveCount: 1, novelTodayCount: 1, totalTodayCount: 1 };
    }
  }
  function sendProgressNotification(novelTitle, episodeTitle, translatedCount, totalCount, percent, url, consecutiveEpisodes) {
    try {
      fetch("http://127.0.0.1:8001/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "progress",
          novel_title: novelTitle,
          episode_title: episodeTitle,
          translated_count: translatedCount,
          total_count: totalCount,
          progress_percentage: percent,
          url,
          consecutive_episodes: consecutiveEpisodes
        })
      }).catch(() => {
      });
    } catch (e) {
    }
  }
  function sendCompleteNotification(novelTitle, episodeTitle, totalCount, url, consecutiveEpisodes) {
    try {
      fetch("http://127.0.0.1:8001/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "complete",
          novel_title: novelTitle,
          episode_title: episodeTitle,
          total_count: totalCount,
          url,
          consecutive_episodes: consecutiveEpisodes
        })
      }).catch(() => {
      });
    } catch (e) {
    }
  }

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
  function injectSidebarStyles() {
    if (document.getElementById("lanovel-sidebar-style")) return;
    const style = document.createElement("style");
    style.id = "lanovel-sidebar-style";
    style.textContent = `
    #jp-translator-sidebar {
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 460px !important;
      max-width: 90vw !important;
      min-width: 320px !important;
      height: 100% !important;
      background-color: #f8f9fa !important;
      color: #212529 !important;
      border-left: 1px solid #dee2e6 !important;
      box-shadow: -2px 0 8px rgba(0,0,0,0.1) !important;
      z-index: 9999 !important;
      transform: translateX(100%) !important;
      transition: transform 0.3s ease-in-out !important;
      display: flex !important;
      flex-direction: column !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
    }
    #jp-translator-sidebar.visible {
      transform: translateX(0) !important;
    }
    .sidebar-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 10px 15px !important;
      background-color: #667eea !important;
      color: white !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .sidebar-header h3 {
      margin: 0 !important;
      font-size: 16px !important;
      color: white !important;
      font-weight: 600 !important;
    }
    .sidebar-controls {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    .sidebar-controls button {
      background: none !important;
      border: none !important;
      color: white !important;
      font-size: 18px !important;
      cursor: pointer !important;
      margin-left: 4px !important;
      padding: 2px 4px !important;
      line-height: 1 !important;
      border-radius: 4px !important;
      transition: background-color 0.2s !important;
    }
    .sidebar-controls button:hover {
      background-color: rgba(255, 255, 255, 0.2) !important;
    }
    .sidebar-novel-banner {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 7px 12px !important;
      background: #eef2ff !important;
      border-bottom: 1px solid #c7d2fe !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .novel-banner-info {
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }
    .novel-banner-icon {
      font-size: 14px !important;
    }
    .novel-banner-title {
      font-weight: 600 !important;
      color: #3730a3 !important;
      max-width: 220px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      border-bottom: 1px dashed #6366f1 !important;
    }
    .novel-banner-title:hover {
      color: #4338ca !important;
      background: #e0e7ff !important;
    }
    .novel-banner-btn {
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      font-size: 12px !important;
      padding: 0 2px !important;
      line-height: 1 !important;
    }
    .novel-banner-sep-toggle {
      background: #4f46e5 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 3px 8px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      font-weight: 500 !important;
      white-space: nowrap !important;
      transition: background-color 0.2s !important;
    }
    .novel-banner-sep-toggle:hover {
      background: #4338ca !important;
    }
    .sidebar-apply-banner {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 8px 12px !important;
      background: #ffffff !important;
      border-bottom: 1px solid #e2e8f0 !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .apply-status-info {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .status-dot {
      width: 8px !important;
      height: 8px !important;
      border-radius: 50% !important;
      background-color: #94a3b8 !important;
      display: inline-block !important;
      transition: background-color 0.3s !important;
    }
    .status-dot.applied {
      background-color: #10b981 !important;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.6) !important;
    }
    .apply-status-text {
      font-weight: 600 !important;
      color: #475569 !important;
    }
    .apply-status-text.applied {
      color: #059669 !important;
    }
    .apply-stats-count {
      font-size: 11px !important;
      color: #64748b !important;
    }
    .sidebar-apply-btn {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      border: 1px solid #cbd5e1 !important;
      background: #f8fafc !important;
      color: #334155 !important;
      padding: 4px 10px !important;
      border-radius: 5px !important;
      font-size: 11.5px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }
    .sidebar-apply-btn:hover {
      background: #f1f5f9 !important;
      border-color: #94a3b8 !important;
    }
    .sidebar-apply-btn.applied {
      background: #10b981 !important;
      border-color: #059669 !important;
      color: white !important;
    }
    .sidebar-apply-btn.applied:hover {
      background: #059669 !important;
    }
    .separator-settings-panel {
      background: #ffffff !important;
      border-bottom: 2px solid #6366f1 !important;
      padding: 12px 14px !important;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1) !important;
      font-size: 12px !important;
      max-height: 380px !important;
      overflow-y: auto !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .sep-panel-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-bottom: 8px !important;
    }
    .sep-panel-title {
      font-weight: 600 !important;
      color: #1e1b4b !important;
      font-size: 13px !important;
    }
    .sep-close-btn {
      background: none !important;
      border: none !important;
      font-size: 18px !important;
      cursor: pointer !important;
      color: #64748b !important;
      line-height: 1 !important;
    }
    .sep-info-box {
      background: #f8f9fa !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 4px !important;
      padding: 6px 10px !important;
      margin-bottom: 8px !important;
      color: #475569 !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
    }
    .sep-novel-name {
      font-weight: 600 !important;
      color: #4f46e5 !important;
    }
    .sep-form-group {
      margin-bottom: 8px !important;
    }
    .sep-checkbox-label {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      cursor: pointer !important;
      color: #334155 !important;
      font-size: 11.5px !important;
    }
    .sep-section-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #475569 !important;
      margin: 8px 0 4px !important;
    }
    .sep-tags-wrap {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 5px !important;
      margin-bottom: 8px !important;
      min-height: 26px !important;
    }
    .sep-tag {
      display: inline-flex !important;
      align-items: center !important;
      background: #e0e7ff !important;
      color: #3730a3 !important;
      padding: 2px 7px !important;
      border-radius: 12px !important;
      font-size: 11px !important;
      font-weight: 500 !important;
    }
    .sep-tag.is-custom {
      background: #fef3c7 !important;
      color: #92400e !important;
      border: 1px solid #fde68a !important;
    }
    .sep-tag-remove {
      margin-left: 4px !important;
      cursor: pointer !important;
      color: #ef4444 !important;
      font-weight: bold !important;
      font-size: 13px !important;
    }
    .sep-tag-remove:hover {
      color: #b91c1c !important;
    }
    .sep-presets-wrap {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 4px !important;
      margin-bottom: 8px !important;
    }
    .sep-preset-btn {
      background: #f1f5f9 !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      padding: 2px 6px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      color: #334155 !important;
      transition: background 0.2s !important;
    }
    .sep-preset-btn:hover {
      background: #e2e8f0 !important;
    }
    .sep-input-row {
      display: flex !important;
      gap: 4px !important;
      margin-bottom: 10px !important;
    }
    .sep-input {
      flex: 1 !important;
      padding: 4px 8px !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      font-size: 12px !important;
      outline: none !important;
    }
    .sep-input:focus {
      border-color: #6366f1 !important;
    }
    .sep-add-btn {
      background: #6366f1 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 4px 10px !important;
      font-size: 12px !important;
      cursor: pointer !important;
    }
    .sep-add-btn:hover {
      background: #4f46e5 !important;
    }
    .sep-panel-footer {
      display: flex !important;
      justify-content: flex-end !important;
      gap: 6px !important;
      border-top: 1px solid #f1f5f9 !important;
      padding-top: 8px !important;
    }
    .sep-save-btn {
      background: #10b981 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 5px 12px !important;
      font-size: 12px !important;
      cursor: pointer !important;
      font-weight: 500 !important;
    }
    .sep-save-btn:hover {
      background: #059669 !important;
    }
    .sep-reset-btn {
      background: #94a3b8 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 5px 10px !important;
      font-size: 12px !important;
      cursor: pointer !important;
    }
    .sep-reset-btn:hover {
      background: #64748b !important;
    }
    .sidebar-content {
      flex-grow: 1 !important;
      overflow-y: auto !important;
      box-sizing: border-box !important;
    }
    #translation-table {
      width: 100% !important;
      border-collapse: collapse !important;
      table-layout: fixed !important;
    }
    #translation-table th, #translation-table td {
      padding: 8px 10px !important;
      text-align: left !important;
      border-bottom: 1px solid #e9ecef !important;
      box-sizing: border-box !important;
      vertical-align: top !important;
    }
    #translation-table th:nth-child(1) {
      width: 40% !important;
    }
    #translation-table th:nth-child(2) {
      width: 42% !important;
    }
    #translation-table th:nth-child(3) {
      width: 18% !important;
    }
    #translation-table th {
      background-color: #f1f3f5 !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #495057 !important;
    }
    #translation-table tbody tr {
      cursor: pointer !important;
      transition: background-color 0.2s !important;
    }
    #translation-table tbody tr:hover {
      background-color: #f1f5f9 !important;
    }
    #translation-table .original-text {
      font-size: 13px !important;
      color: #495057 !important;
      word-break: break-all !important;
      line-height: 1.5 !important;
    }
    #translation-table .translated-text {
      font-size: 13px !important;
      color: #212529 !important;
      outline: none !important;
      width: 100% !important;
      word-break: break-all !important;
      line-height: 1.5 !important;
      -webkit-user-modify: read-write-plaintext-only !important;
    }
    #translation-table .translated-text:focus {
      background-color: #e9f7fd !important;
      border-radius: 3px !important;
    }
    #translation-table .action-btns {
      display: flex !important;
      gap: 4px !important;
      align-items: center !important;
    }
    #translation-table .save-btn {
      background-color: #4CAF50 !important;
      color: white !important;
      border: none !important;
      padding: 4px 6px !important;
      border-radius: 4px !important;
      cursor: pointer !important;
      font-size: 11px !important;
      white-space: nowrap !important;
      transition: background-color 0.2s !important;
    }
    #translation-table .save-btn:hover {
      background-color: #45a049 !important;
    }
    #translation-table .save-btn:disabled {
      background-color: #cccccc !important;
      cursor: not-allowed !important;
    }
    #translation-table .retranslate-row-btn {
      background: #ffffff !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      padding: 3px 5px !important;
      cursor: pointer !important;
      font-size: 11px !important;
      line-height: 1 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
    }
    #translation-table .retranslate-row-btn:hover {
      background: #f1f5f9 !important;
      border-color: #94a3b8 !important;
    }
    #translation-table .retranslate-row-btn:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
    }
    .lanovel-row-highlight {
      animation: lanovelRowPulse 1.5s ease-out !important;
    }
    @keyframes lanovelRowPulse {
      0% { background-color: #fef08a !important; }
      100% { background-color: transparent !important; }
    }
    @keyframes lanovelPulse {
      0% { background-color: rgba(99, 102, 241, 0.4) !important; outline: 2px solid #6366f1 !important; outline-offset: 2px !important; }
      50% { background-color: rgba(99, 102, 241, 0.18) !important; outline: 2px solid #818cf8 !important; outline-offset: 2px !important; }
      100% { background-color: transparent !important; outline: none !important; }
    }
    .lanovel-highlight-pulse {
      animation: lanovelPulse 1.5s ease-out !important;
      border-radius: 4px !important;
    }
    .review-target-card {
      background: #ffffff !important;
      border: 1px solid #fde68a !important;
      border-left: 3px solid #f59e0b !important;
      border-radius: 6px !important;
      padding: 6px 8px !important;
      margin-bottom: 6px !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }
    .review-target-card:hover {
      background: #fffdf5 !important;
      border-color: #f59e0b !important;
      transform: translateX(2px) !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
    }
    .review-target-card .card-top {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-bottom: 4px !important;
    }
    .review-target-card .pid-badge {
      font-size: 10px !important;
      font-weight: 700 !important;
      color: #b45309 !important;
    }
    .review-target-card .reason-badge {
      font-size: 10px !important;
      background: #fef3c7 !important;
      color: #92400e !important;
      padding: 1px 5px !important;
      border-radius: 4px !important;
    }
    .review-target-card .card-body .orig-text {
      color: #4b5563 !important;
      font-size: 11px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      margin-bottom: 2px !important;
    }
    .review-target-card .card-body .trans-text {
      color: #1f2937 !important;
      font-weight: 600 !important;
      font-size: 12px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .review-panel-close-btn {
      background: none !important;
      border: none !important;
      font-size: 18px !important;
      cursor: pointer !important;
      color: #b45309 !important;
      line-height: 1 !important;
    }
    .sidebar-footer {
      flex-shrink: 0 !important;
      border-top: 1px solid #334155 !important;
      background-color: #0f172a !important;
      color: #e2e8f0 !important;
      font-family: Consolas, "Fira Code", Menlo, Monaco, monospace !important;
      font-size: 11px !important;
      max-height: 145px !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .sidebar-footer-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 4px 10px !important;
      background: #1e293b !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      flex-shrink: 0 !important;
      user-select: none !important;
    }
    .footer-header-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #94a3b8 !important;
      letter-spacing: -0.2px !important;
    }
    .footer-clear-btn {
      background: none !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      color: #94a3b8 !important;
      border-radius: 3px !important;
      font-size: 10px !important;
      padding: 1px 6px !important;
      cursor: pointer !important;
      line-height: 1.2 !important;
      transition: all 0.15s ease !important;
    }
    .footer-clear-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #f1f5f9 !important;
      border-color: rgba(255, 255, 255, 0.3) !important;
    }
    #sidebar-log-console {
      padding: 6px 10px !important;
      overflow-y: auto !important;
      flex: 1 !important;
      box-sizing: border-box !important;
    }
    #sidebar-log-console::-webkit-scrollbar {
      width: 5px !important;
    }
    #sidebar-log-console::-webkit-scrollbar-thumb {
      background: #334155 !important;
      border-radius: 3px !important;
    }
    #sidebar-log-console p, #sidebar-log-console .log-entry {
      margin: 0 0 4px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
      padding-bottom: 3px !important;
      line-height: 1.45 !important;
      word-break: break-all !important;
      display: flex !important;
      align-items: baseline !important;
      gap: 6px !important;
      font-size: 11px !important;
    }
    .log-time {
      color: #64748b !important;
      font-size: 10.5px !important;
      flex-shrink: 0 !important;
      user-select: none !important;
      font-family: inherit !important;
    }
    .log-msg {
      color: #e2e8f0 !important;
      flex: 1 !important;
      font-family: inherit !important;
    }
    .log-error, .log-error .log-msg {
      color: #f87171 !important;
    }
    .log-info, .log-info .log-msg {
      color: #38bdf8 !important;
    }
    #jp-translator-toggle-btn {
      position: fixed !important;
      top: 50% !important;
      left: 0 !important;
      transform: translateY(-50%) !important;
      background-color: #667eea !important;
      color: white !important;
      border: none !important;
      border-top-right-radius: 5px !important;
      border-bottom-right-radius: 5px !important;
      padding: 10px 5px !important;
      cursor: pointer !important;
      z-index: 9998 !important;
      font-size: 18px !important;
      writing-mode: vertical-rl !important;
      box-sizing: border-box !important;
    }
  `;
    document.head.appendChild(style);
  }
  function updateEmptyState() {
    const tableBody = document.getElementById("translation-table-body");
    const emptyState = document.getElementById("sidebar-empty-state");
    if (!tableBody || !emptyState) return;
    emptyState.style.display = tableBody.children.length === 0 ? "block" : "none";
  }
  function updateTurboModeUI(enabled) {
    const toggle = document.getElementById("sidebar-turbo-toggle");
    const desc = document.getElementById("turbo-desc-text");
    if (toggle) toggle.checked = enabled;
    if (desc) {
      desc.textContent = enabled ? "\u26A1 2\uCD08 / 8\uCD08 (\uCF8C\uC18D)" : "\uC77C\uBC18 \uBAA8\uB4DC (RPM \uBCF4\uC218\uC801)";
    }
  }
  function updateTurboBadgeUI() {
    const badge = document.getElementById("turbo-cutoff-badge");
    if (!badge) return;
    const info = detectCutoffInfo(state.turboCutoffHour);
    badge.textContent = `\uAE30\uC900 ${info.label}`;
  }
  function updateApplyButtonUI(applied, totalTargetCount = 0) {
    const dot = document.getElementById("apply-status-dot");
    const text = document.getElementById("apply-status-text");
    const count = document.getElementById("apply-stats-count");
    const btn = document.getElementById("sidebar-apply-toggle-btn");
    const btnIcon = document.getElementById("apply-btn-icon");
    const btnText = document.getElementById("apply-btn-text");
    const translatedCount = state.translationCache.size;
    if (count) {
      count.textContent = `(\uBC88\uC5ED ${translatedCount}\uAC1C / \uBCF8\uBB38 ${totalTargetCount}\uAC1C)`;
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
  function updateNovelTitleUI(title) {
    const el = document.getElementById("current-novel-title-display");
    const panelNovel = document.getElementById("panel-novel-name-display");
    if (el) el.textContent = title || "\uAE30\uBCF8 \uC18C\uC124";
    if (panelNovel) panelNovel.textContent = title || "\uAE30\uBCF8 \uC18C\uC124";
  }
  function toggleSeparatorPanel() {
    const panel = document.getElementById("separator-settings-panel");
    if (!panel) return;
    const isOpen = panel.style.display !== "none";
    panel.style.display = isOpen ? "none" : "block";
    if (!isOpen) {
      renderSeparatorSettingsPanel();
    }
  }
  function renderSeparatorSettingsPanel() {
    const container = document.getElementById("active-separators-container");
    const presetsContainer = document.getElementById("preset-buttons-container");
    const defaultCheck = document.getElementById("use-global-defaults-check");
    if (!container || !presetsContainer) return;
    if (defaultCheck) {
      defaultCheck.checked = state.separatorConfig.useDefaults;
    }
    container.innerHTML = "";
    state.activeSeparators.forEach((sep) => {
      const isCustom = state.separatorConfig.customSeparators.includes(sep);
      const tag = document.createElement("span");
      tag.className = `sep-tag ${isCustom ? "is-custom" : ""}`;
      tag.innerHTML = `<span>${escapeHtml(sep)}</span><span class="sep-tag-remove" title="\uC0AD\uC81C">&times;</span>`;
      const removeBtn = tag.querySelector(".sep-tag-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          state.activeSeparators = state.activeSeparators.filter((s) => s !== sep);
          state.separatorConfig.customSeparators = state.separatorConfig.customSeparators.filter((s) => s !== sep);
          renderSeparatorSettingsPanel();
        });
      }
      container.appendChild(tag);
    });
    presetsContainer.innerHTML = "";
    PRESET_SEPARATORS.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "sep-preset-btn";
      btn.textContent = p.name;
      btn.addEventListener("click", () => {
        if (!state.activeSeparators.includes(p.sep)) {
          state.activeSeparators.push(p.sep);
          if (!state.separatorConfig.customSeparators.includes(p.sep)) {
            state.separatorConfig.customSeparators.push(p.sep);
          }
          renderSeparatorSettingsPanel();
        }
      });
      presetsContainer.appendChild(btn);
    });
  }
  function renderReviewTargetPanel() {
    const panel = document.getElementById("review-target-panel");
    if (!panel) return;
    if (!state.reviewTargetsData || !state.reviewTargetsData.targets || state.reviewTargetsData.targets.length === 0) {
      panel.style.display = "none";
      return;
    }
    const targets = state.reviewTargetsData.targets;
    panel.style.display = "block";
    panel.innerHTML = `
    <div class="review-panel-header">
      <div class="review-panel-title">
        <span>\u26A1 \uC7AC\uBC88\uC5ED \uAC80\uC218 \uB300\uC0C1 (${targets.length}\uAC1C)</span>
      </div>
      <button class="review-panel-close-btn" id="close-review-panel-btn">&times;</button>
    </div>
    <div class="review-panel-list">
      ${targets.map(
      (t) => `
        <div class="review-target-card" data-pid="${t.pid}">
          <div class="card-top">
            <span class="pid-badge">#${t.pid}</span>
            <span class="reason-badge">${escapeHtml(t.reason || "\uD488\uC9C8 \uC7AC\uAC80\uC218")}</span>
          </div>
          <div class="card-body">
            <div class="orig-text">\uC6D0\uBB38: ${escapeHtml(t.original)}</div>
            <div class="trans-text" id="review-tra-${t.pid}">\uBC88\uC5ED: ${escapeHtml(t.translated || "(\uBBF8\uBC88\uC5ED)")}</div>
          </div>
        </div>
      `
    ).join("")}
    </div>
  `;
    const closeBtn = document.getElementById("close-review-panel-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        panel.style.display = "none";
      });
    }
    const cardList = panel.querySelector(".review-panel-list");
    if (cardList) {
      cardList.addEventListener("click", (e) => {
        const target = e.target;
        const card = target ? target.closest(".review-target-card") : null;
        if (card && card.dataset.pid) {
          handleSidebarRowClick(card.dataset.pid);
        }
      });
    }
  }
  function populateSidebar(translations) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    tableBody.innerHTML = "";
    translations.forEach((t) => {
      addEntryToSidebar(t);
    });
    updateEmptyState();
  }
  function handleSidebarRowClick(pid, e) {
    if (e) {
      const target = e.target;
      if (target && (target.closest("button") || target.closest(".translated-text") || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
    }
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    if (row) {
      row.classList.remove("lanovel-row-highlight");
      void row.offsetWidth;
      row.classList.add("lanovel-row-highlight");
      setTimeout(() => {
        row.classList.remove("lanovel-row-highlight");
      }, 1600);
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
  function addPlaceholderRows(items) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    items.forEach((item) => {
      let row = document.querySelector(`tr[data-pid="${item.id}"]`);
      if (!row) {
        const newRow = tableBody.insertRow(0);
        newRow.setAttribute("data-pid", item.id);
        newRow.addEventListener("click", (e) => handleSidebarRowClick(item.id, e));
        newRow.innerHTML = `
        <td><div class="original-text">${escapeHtml(item.text)}</div></td>
        <td><div class="translated-text">\u23F3 \uBC88\uC5ED \uC911...</div></td>
        <td>
          <div class="action-btns">
            <button class="save-btn" disabled>\uC800\uC7A5</button>
            <button class="retranslate-row-btn" disabled title="\uACE0\uC131\uB2A5 \uBAA8\uB378\uB85C \uC7AC\uBC88\uC5ED">\u{1F504}</button>
          </div>
        </td>
      `;
      } else {
        const cell = row.querySelector(".translated-text");
        if (cell) cell.textContent = "\u23F3 \uBC88\uC5ED \uC911...";
        tableBody.prepend(row);
      }
    });
    updateEmptyState();
  }
  function updateSidebarWithTranslations(translations) {
    translations.forEach((t) => {
      const pid = t.id || t.pid;
      const row = document.querySelector(`tr[data-pid="${pid}"]`);
      if (row) {
        const cell = row.querySelector(".translated-text");
        if (cell) {
          cell.textContent = t.translated || "";
          cell.removeAttribute("style");
        }
        const saveBtn = row.querySelector(".save-btn");
        if (saveBtn) saveBtn.disabled = false;
        const retransBtn = row.querySelector(".retranslate-row-btn");
        if (retransBtn) retransBtn.disabled = false;
      } else {
        addEntryToSidebar({
          pid,
          original: t.original,
          translated: t.translated
        });
      }
    });
    state.broadcastStatus();
  }
  function addEntryToSidebar(translation) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody || !translation.pid) return;
    if (document.querySelector(`tr[data-pid="${translation.pid}"]`)) return;
    const pid = String(translation.pid);
    const row = tableBody.insertRow();
    row.setAttribute("data-pid", pid);
    row.addEventListener("click", (e) => handleSidebarRowClick(pid, e));
    const isReviewTarget = state.reviewTargetPids.has(pid);
    if (isReviewTarget) {
      row.classList.add("review-target-row");
      const p = document.getElementById(pid);
      if (p) p.classList.add("review-target-dom");
    }
    const badgeHtml = isReviewTarget ? '<span class="review-badge" title="\uC54C\uB9BC \uC13C\uD130 \uC5F0\uACC4 \uC7AC\uBC88\uC5ED \uAC80\uC218 \uBB38\uC7A5">\u26A1\uC7AC\uAC80\uC218</span>' : "";
    row.innerHTML = `
    <td><div class="original-text" title="\uD074\uB9AD\uD558\uBA74 \uBCF8\uBB38\uC758 \uD574\uB2F9 \uBB38\uB2E8\uC73C\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4">${badgeHtml}${escapeHtml(translation.original)}</div></td>
    <td><div class="translated-text" contenteditable="true">${escapeHtml(translation.translated)}</div></td>
    <td>
      <div class="action-btns">
        <button class="save-btn">\uC800\uC7A5</button>
        <button class="retranslate-row-btn" title="\uACE0\uC131\uB2A5 \uBAA8\uB378\uB85C \uC7AC\uBC88\uC5ED">\u{1F504}</button>
      </div>
    </td>
  `;
    const saveBtn = row.querySelector(".save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const cell = row.querySelector(".translated-text");
        const editedText = cell ? (cell.textContent || "").trim() : "";
        if (!editedText) {
          state.userDeletedTranslationPids.add(String(translation.pid));
          row.setAttribute("data-user-deleted", "true");
        } else {
          state.userDeletedTranslationPids.delete(String(translation.pid));
          row.removeAttribute("data-user-deleted");
        }
        const record = {
          url: window.location.href.split("#")[0].trim(),
          pid: translation.pid,
          original: translation.original,
          translated: editedText,
          timestamp: Math.floor(Date.now() / 1e3),
          folderName: null,
          title: state.onExtractEpisodeTitle && state.onExtractEpisodeTitle() || document.title
        };
        state.translationCache.set(translation.pid, { pid: translation.pid, original: translation.original, translated: editedText });
        try {
          await fetch("http://127.0.0.1:8001/translations/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([record])
          });
          saveBtn.textContent = "\uC800\uC7A5\uB428!";
          setTimeout(() => {
            saveBtn.textContent = "\uC800\uC7A5";
          }, 1500);
        } catch (err) {
          logToSidebar(`\uBC88\uC5ED \uC800\uC7A5 \uC2E4\uD328: ${err.message}`, "log-error");
        }
      });
    }
    const retransBtn = row.querySelector(".retranslate-row-btn");
    if (retransBtn) {
      retransBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        retransBtn.disabled = true;
        const cell = row.querySelector(".translated-text");
        if (cell) {
          cell.textContent = "\u23F3 \uC7AC\uBC88\uC5ED \uC911...";
        }
        logToSidebar(`(pid: ${translation.pid}) \uACE0\uC131\uB2A5 \uBAA8\uB378\uB85C \uC7AC\uBC88\uC5ED \uC694\uCCAD \uC911...`);
        try {
          const response = await chrome.runtime.sendMessage({
            action: "batchTranslate",
            items: [{ id: translation.pid, text: translation.original }],
            isRetranslation: true
          });
          if (response && response.translations && response.translations.length > 0) {
            const item = response.translations[0];
            updateSidebarWithTranslations([item]);
            logToSidebar(`(pid: ${translation.pid}) \uC7AC\uBC88\uC5ED \uC644\uB8CC!`);
          }
        } catch (err) {
          logToSidebar(`\uC7AC\uBC88\uC5ED \uC2E4\uD328: ${err.message}`, "log-error");
        } finally {
          retransBtn.disabled = false;
        }
      });
    }
    updateEmptyState();
  }
  function sortSidebar(orderedPids) {
    const tableBody = document.getElementById("translation-table-body");
    if (!tableBody) return;
    const rows = Array.from(tableBody.querySelectorAll("tr[data-pid]"));
    const pidOrderMap = new Map(orderedPids.map((id, idx) => [id, idx]));
    rows.sort((a, b) => {
      const pidA = a.dataset.pid || "";
      const pidB = b.dataset.pid || "";
      const idxA = pidOrderMap.has(pidA) ? pidOrderMap.get(pidA) : 999999;
      const idxB = pidOrderMap.has(pidB) ? pidOrderMap.get(pidB) : 999999;
      return idxA - idxB;
    });
    rows.forEach((r) => tableBody.appendChild(r));
  }
  function injectSidebar() {
    if (document.getElementById("jp-translator-sidebar")) return;
    injectSidebarStyles();
    const sidebar = document.createElement("div");
    sidebar.id = "jp-translator-sidebar";
    sidebar.innerHTML = `
    <div class="sidebar-header">
      <h3>\u{1F5FE} \uBC88\uC5ED \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4</h3>
      <div class="sidebar-controls">
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
      <button id="toggle-sep-panel-btn" class="novel-banner-sep-toggle" title="\uC774 \uC18C\uC124\uC758 \uAD6C\uBD84\uC120 \uC124\uC815">\u2699\uFE0F \uAD6C\uBD84\uC120 \uC124\uC815</button>
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
        <span class="footer-header-title">\u{1F4E1} \uC2DC\uC2A4\uD15C \uC54C\uB9BC \uBC0F \uC9C4\uD589 \uB85C\uADF8</span>
        <button id="clear-sidebar-log-btn" class="footer-clear-btn" title="\uB85C\uADF8 \uC9C0\uC6B0\uAE30">\uBE44\uC6B0\uAE30</button>
      </div>
      <div id="sidebar-log-console"></div>
    </div>
  `;
    document.body.appendChild(sidebar);
    const toggleButton = document.createElement("button");
    toggleButton.id = "jp-translator-toggle-btn";
    toggleButton.innerHTML = "\u6587";
    document.body.appendChild(toggleButton);
    toggleButton.addEventListener("click", toggleSidebar);
    const closeBtn = document.getElementById("sidebar-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", hideSidebar);
    const clearLogBtn = document.getElementById("clear-sidebar-log-btn");
    if (clearLogBtn) {
      clearLogBtn.addEventListener("click", () => {
        const consoleEl = document.getElementById("sidebar-log-console");
        if (consoleEl) consoleEl.innerHTML = "";
      });
    }
    const editNovelTitleBtn = document.getElementById("edit-novel-title-btn");
    const novelTitleDisplay = document.getElementById("current-novel-title-display");
    const handleEditNovelTitle = async () => {
      const newTitle = prompt("\uD604\uC7AC \uC18C\uC124\uC758 \uC81C\uBAA9\uC744 \uC785\uB825\uD558\uC138\uC694 (\uC18C\uC124\uBCC4 \uAD6C\uBD84\uC120 \uBC0F \uD3F4\uB354 \uAE30\uC900\uC774 \uB429\uB2C8\uB2E4):", state.currentNovelTitle);
      if (newTitle && newTitle.trim() && newTitle.trim() !== state.currentNovelTitle) {
        state.currentNovelTitle = newTitle.trim();
        updateNovelTitleUI(state.currentNovelTitle);
        state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
        state.activeSeparators = state.separatorConfig.effectiveSeparators;
        renderSeparatorSettingsPanel();
        logToSidebar(`\uC18C\uC124 \uC81C\uBAA9\uC774 '${state.currentNovelTitle}'(\uC73C)\uB85C \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`);
      }
    };
    if (editNovelTitleBtn) editNovelTitleBtn.addEventListener("click", handleEditNovelTitle);
    if (novelTitleDisplay) novelTitleDisplay.addEventListener("click", handleEditNovelTitle);
    const excludedBtn = document.getElementById("sidebar-excluded-list-btn");
    if (excludedBtn) {
      excludedBtn.addEventListener("click", () => {
        const panel = document.getElementById("separator-exclude-panel");
        if (panel) {
          panel.style.display = panel.style.display === "none" ? "block" : "none";
        }
      });
    }
    const toggleSepBtn = document.getElementById("toggle-sep-panel-btn");
    if (toggleSepBtn) toggleSepBtn.addEventListener("click", toggleSeparatorPanel);
    const sepSettingsBtn = document.getElementById("separator-settings-btn");
    if (sepSettingsBtn) sepSettingsBtn.addEventListener("click", toggleSeparatorPanel);
    const closeSepBtn = document.getElementById("close-sep-panel-btn");
    if (closeSepBtn) closeSepBtn.addEventListener("click", toggleSeparatorPanel);
    const addSepBtn = document.getElementById("add-separator-btn");
    const newSepInput = document.getElementById("new-separator-input");
    if (addSepBtn && newSepInput) {
      addSepBtn.addEventListener("click", () => {
        const val = newSepInput.value.trim();
        if (val && !state.activeSeparators.includes(val)) {
          state.activeSeparators.push(val);
          state.separatorConfig.customSeparators.push(val);
          newSepInput.value = "";
          renderSeparatorSettingsPanel();
        }
      });
    }
    const saveSepBtn = document.getElementById("save-separators-btn");
    const defaultCheck = document.getElementById("use-global-defaults-check");
    if (saveSepBtn) {
      saveSepBtn.addEventListener("click", async () => {
        const useDefaults = defaultCheck ? defaultCheck.checked : true;
        await saveNovelSeparators(state.currentNovelTitle, state.separatorConfig.customSeparators, useDefaults);
        logToSidebar(`[\uAD6C\uBD84\uC120 \uC124\uC815] '${state.currentNovelTitle || "\uAE30\uBCF8 \uC18C\uC124"}'\uC758 \uAD6C\uBD84\uC120 \uC124\uC815\uC774 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`);
        toggleSeparatorPanel();
      });
    }
    const turboToggle = document.getElementById("sidebar-turbo-toggle");
    if (turboToggle) {
      turboToggle.addEventListener("change", () => {
        const isChecked = turboToggle.checked;
        if (state.onToggleTurboMode) {
          state.onToggleTurboMode(isChecked, true);
        }
      });
    }
    const turboBadge = document.getElementById("turbo-cutoff-badge");
    if (turboBadge) {
      turboBadge.addEventListener("click", () => {
        if (state.turboCutoffHour === null) {
          state.turboCutoffHour = 16;
        } else if (state.turboCutoffHour === 16) {
          state.turboCutoffHour = 17;
        } else {
          state.turboCutoffHour = null;
        }
        chrome.storage.local.set({ lanovel_turbo_cutoff: state.turboCutoffHour });
        updateTurboBadgeUI();
      });
    }
    const tableBody = document.getElementById("translation-table-body");
    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        const target = e.target;
        if (!target) return;
        if (target.closest("button") || target.closest(".translated-text") || target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        const row = target.closest("tr[data-pid]");
        if (row && row.dataset.pid) {
          handleSidebarRowClick(row.dataset.pid, e);
        }
      });
    }
  }

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
  var hudTimer = null;
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

  // src/core/page_translator.ts
  function getCleanUrl() {
    return window.location.href.split("#")[0].trim();
  }
  function getTargetParagraphs() {
    const allParagraphs = document.querySelectorAll("p[id]");
    return Array.from(allParagraphs).filter((p) => !p.classList.contains("blank") && PID_REGEX.test(p.id));
  }
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
    const targetsToExclude = [];
    const targetIds = [];
    translationsList.forEach((t) => {
      if (!t || !t.id) return;
      if (state.exclusionSet.has(t.original)) return;
      let isExcluded = false;
      if (t.pid && (sepAnalysis.prefacePids.has(t.pid) || sepAnalysis.afterwordPids.has(t.pid) || sepAnalysis.separatorPids.has(t.pid))) {
        isExcluded = true;
      } else if (t.original && checkSeparatorMatch(t.original.trim(), state.activeSeparators)) {
        isExcluded = true;
      }
      if (isExcluded && t.translated && t.translated.trim()) {
        targetsToExclude.push(t);
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
      if (response.ok) {
        targetsToExclude.forEach((item) => {
          if (item.pid) {
            state.userDeletedTranslationPids.add(String(item.pid));
            state.translationCache.delete(item.pid);
            const row = document.querySelector(`tr[data-pid="${item.pid}"]`);
            if (row) row.remove();
          }
          if (item.original) {
            state.exclusionSet.add(item.original);
          }
        });
        logToSidebar(`[\uAD6C\uBD84\uC120/\uD6C4\uAE30 \uAC10\uC9C0] ${targetsToExclude.length}\uAC1C \uB2E8\uB77D\uC744 \uBC88\uC5ED\uC5D0\uC11C \uC790\uB3D9 \uC81C\uC678\uD588\uC2B5\uB2C8\uB2E4.`);
      }
    } catch (e) {
      console.warn("[checkAndExcludeSeparatorTranslations] Server call failed:", e);
    }
  }
  async function checkAndLoadReviewTargets() {
    try {
      const cleanUrl = getCleanUrl();
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
        if (window.location.hash.includes("lanovel_review")) {
          showSidebar();
          logToSidebar(
            `\u{1F514} [\uC54C\uB9BC \uC13C\uD130 \uC5F0\uACC4] \uC7AC\uBC88\uC5ED \uAC80\uC218 \uB300\uC0C1 ${data.targets.length}\uAC74\uC774 \uAC10\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
          );
        }
      }
    } catch (e) {
      console.warn("[checkAndLoadReviewTargets] Failed to load review targets:", e);
    }
  }
  var isTranslatingInProgress = false;
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
              const verbatimItems = response.translations.filter(
                (t) => Boolean(t.verbatim) || t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated)
              );
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
      if (!state.isTranslationCancelled && !state.isReviewSession) {
        const currentUrl = getCleanUrl();
        const batchStats = await updateAndGetBatchCount(currentUrl);
        const consecutiveCount = batchStats.consecutiveCount;
        if (consecutiveCount > 0 && consecutiveCount % 10 === 0) {
          sendProgressNotification(
            state.currentNovelTitle,
            getScraper().extractEpisodeTitle() || document.title,
            textsToTranslate.length,
            textsToTranslate.length,
            100,
            currentUrl,
            consecutiveCount
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
            logToSidebar(`\uBC88\uC5ED \uC644\uB8CC. ${delaySec}\uCD08 \uD6C4 \uB2E4\uC74C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.`);
          }
        }
        await sleepResponsive(() => calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode));
        if (state.isTranslationCancelled) return;
        const scraper = getScraper();
        const nextLink = scraper.findNextEpisodeLink();
        if (nextLink && nextLink.href) {
          sessionStorage.setItem("lanovel_auto_translate_next", "1");
          showLanovelHud("\uB2E4\uC74C \uD654\uB85C \uC790\uB3D9 \uC774\uB3D9...", "\u26A1");
          setTimeout(() => {
            window.location.href = nextLink.href;
          }, 1500);
        } else {
          logToSidebar("\uB2E4\uC74C \uD398\uC774\uC9C0 \uB9C1\uD06C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (\uB9C8\uC9C0\uB9C9 \uD68C\uCC28)");
          sendCompleteNotification(
            state.currentNovelTitle,
            scraper.extractEpisodeTitle() || document.title,
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

  // src/ui/toc_quick_jump.ts
  var EXCLUDED_EPISODES_STORAGE_KEY = "lanovel_excluded_urls";
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
  var quickJumpFocusedIndex = -1;
  var untranslatedEpisodesCache = [];
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
    if (scraper.getTocEpisodes) {
      episodeItems = scraper.getTocEpisodes();
    }
    if (!episodeItems.length) {
      await new Promise((r) => setTimeout(r, 250));
      if (scraper.getTocEpisodes) {
        episodeItems = scraper.getTocEpisodes();
      }
    }
    if (!episodeItems.length) {
      console.log("[LANOVEL] \uBAA9\uCC28 \uD398\uC774\uC9C0\uC774\uB098 \uD68C\uCC28 \uB9C1\uD06C \uC694\uC18C\uB97C \uBC1C\uACAC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    const episodeDataList = [];
    const urlSet = /* @__PURE__ */ new Set();
    episodeItems.forEach((item) => {
      if (!item.url) return;
      const cleanUrl = item.url.split("#")[0];
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
      const resp = await fetch("http://127.0.0.1:8001/api/check_translated_urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: Array.from(urlSet) })
      });
      if (resp.ok) {
        const data = await resp.json();
        const list = data.translated_urls || [];
        list.forEach((u) => {
          translatedSet.add(u.replace(/\/$/, ""));
          translatedSet.add(u.replace(/\/$/, "") + "/");
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
      const isTranslated = translatedSet.has(cleanNoSlash) || translatedSet.has(cleanNoSlash + "/");
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
      if (item.element.parentNode) {
        const existingBadge = item.element.parentNode.querySelector(".lanovel-toc-badge");
        if (!existingBadge) {
          item.element.parentNode.appendChild(badge);
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
    renderQuickJumpPanel(untranslatedEpisodesCache);
  }
  function renderQuickJumpPanel(untranslatedList) {
    let container = document.getElementById("lanovel-quick-jump-container");
    if (container) container.remove();
    container = document.createElement("div");
    container.id = "lanovel-quick-jump-container";
    const activeCount = untranslatedList.filter((ep) => !ep.isExcluded).length;
    const count = activeCount;
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
    if (targetEp && targetEp.element) {
      targetEp.element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // src/ui/key_nav.ts
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
      if (scraper.isTocPage(window.location.href, window.location.pathname)) {
        if (lowerKey === "n") {
          e.preventDefault();
          handleQuickJumpNKey();
          return;
        }
        const drawer = document.getElementById("lanovel-quick-jump-drawer");
        if (drawer && drawer.classList.contains("open")) {
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
      checkAutoTranslateNextTrigger(() => {
        showSidebar();
      });
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
      await checkAndLoadReviewTargets();
      renderReviewTargetPanel();
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
        translateAllPTags(true);
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
          state.broadcastStatus();
        });
      }
      const retryBtn = document.getElementById("retry-translation-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          translateAllPTags(true);
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
