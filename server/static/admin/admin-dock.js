/**
 * admin-dock.js
 * Sliding bottom dock for similar translation recommendations & text drag selection search.
 */

import { state, dom, escapeHtml, showToast } from './admin-state.js';

export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function closeRecommendPanel() {
    if (!dom.similarRecommendPanel) return;
    dom.similarRecommendPanel.style.display = 'none';
}

export function toggleRecommendCollapse() {
    if (!dom.similarRecommendPanel) return;
    state.isRecommendCollapsed = !state.isRecommendCollapsed;
    dom.similarRecommendPanel.classList.toggle('is-collapsed', state.isRecommendCollapsed);
    if (dom.recommendToggleIcon) {
        dom.recommendToggleIcon.textContent = state.isRecommendCollapsed ? '▲' : '▼';
    }
    if (dom.recommendToggleText) {
        dom.recommendToggleText.textContent = state.isRecommendCollapsed ? '펼치기' : '접기';
    }
}

export function handleTranslatedFocus(el) {
    state.activeTargetInput = el;
    if (!state.isFindingEmpty && !el.dataset.keywords) {
        return;
    }
    const kwString = el.dataset.keywords || '';
    const keywords = kwString.split(',').map(s => s.trim()).filter(Boolean);
    let keywordToSearch = keywords[0];

    if (!keywordToSearch) {
        const orig = el.dataset.original || '';
        const match = orig.match(/[\u30a0-\u30ff]{2,}|[\u4e00-\u9faf]{2,}/);
        if (match) {
            keywordToSearch = match[0];
        }
    }

    if (keywordToSearch) {
        const folder = el.dataset.folder || '';
        loadSimilarRecommendations(keywordToSearch, folder, keywords);
    }
}

export async function loadSimilarRecommendations(keyword, folder = '', allKeywords = []) {
    if (!dom.similarRecommendPanel) return;
    dom.similarRecommendPanel.style.display = 'flex';
    dom.similarRecommendPanel.classList.toggle('is-collapsed', state.isRecommendCollapsed);
    if (dom.recommendToggleIcon) {
        dom.recommendToggleIcon.textContent = state.isRecommendCollapsed ? '▲' : '▼';
    }
    if (dom.recommendToggleText) {
        dom.recommendToggleText.textContent = state.isRecommendCollapsed ? '펼치기' : '접기';
    }

    if (dom.recommendKeyword) {
        dom.recommendKeyword.textContent = `"${keyword}" 검색 중...`;
    }
    if (dom.recommendCardsContainer) {
        dom.recommendCardsContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted);">유사 단락 검색 중...</div>';
    }

    try {
        const url = `/translations/similar_examples?keyword=${encodeURIComponent(keyword)}&folder=${encodeURIComponent(folder)}&limit=8`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('추천 검색 실패');
        const data = await res.json();
        const examples = data.examples || [];

        renderSimilarRecommendations(keyword, examples, allKeywords);
    } catch (err) {
        console.error('추천 로딩 실패:', err);
        if (dom.recommendCardsContainer) {
            dom.recommendCardsContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--danger-color);">추천 불러오기 실패</div>';
        }
    }
}

export function highlightKeyword(text, keyword) {
    if (!keyword) return text;
    const escapedKw = escapeRegExp(keyword);
    return text.replace(new RegExp(`(${escapedKw})`, 'gi'), '<mark style="background-color: #ffec99; padding: 0 2px; border-radius: 2px;">$1</mark>');
}

export function renderSimilarRecommendations(keyword, examples, allKeywords = []) {
    if (!dom.similarRecommendPanel) return;

    let kwHeaderHtml = `<strong>"${escapeHtml(keyword)}"</strong> <span style="font-size: 12px; font-weight: normal; color: var(--text-muted);">(${examples.length}건)</span>`;
    if (allKeywords && allKeywords.length > 1) {
        kwHeaderHtml = allKeywords.map(k => `
            <span class="kw-chip ${k === keyword ? 'active' : ''}" style="cursor: pointer; text-decoration: underline; margin-right: 4px;" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</span>
        `).join(' ');
    }

    const encKw = encodeURIComponent(keyword);
    const dictLinksHtml = `
        <span class="recommend-dict-links" style="display: inline-flex; gap: 6px; margin-left: 8px; align-items: center; flex-wrap: wrap;">
            <a href="https://ja.dict.naver.com/#/search?range=all&q=${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #03c75a; border-color: #03c75a; text-decoration: none;">네이버 사전 ↗</a>
            <a href="https://www.weblio.jp/content/${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #0f6fec; border-color: #0f6fec; text-decoration: none;">Weblio ↗</a>
            <a href="https://jisho.org/search/${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #7952b3; border-color: #7952b3; text-decoration: none;">Jisho ↗</a>
        </span>
    `;

    if (dom.recommendKeyword) {
        dom.recommendKeyword.innerHTML = kwHeaderHtml + dictLinksHtml;
    }

    if (!examples || examples.length === 0) {
        if (dom.recommendCardsContainer) {
            dom.recommendCardsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted);">'${escapeHtml(keyword)}'에 대한 다른 번역 사례를 찾지 못했습니다.</div>`;
        }
        return;
    }

    const cardsHtml = examples.map(ex => {
        const novelTitle = ex.folderName || '소설';
        const epTitle = ex.title || '회차';
        const escOri = escapeHtml(ex.original || '');
        const escTra = escapeHtml(ex.translated || '');
        const highlightedOri = highlightKeyword(escOri, keyword);
        const highlightedTra = highlightKeyword(escTra, keyword);
        const pidBadge = ex.pid ? `<span class="recommend-card-pid">${escapeHtml(ex.pid)}</span>` : '';

        const baseCleanUrl = (ex.url || '').split('#')[0];
        const targetUrl = ex.pid ? `${baseCleanUrl}#${ex.pid}` : baseCleanUrl;

        return `
            <div class="recommend-card" data-url="${escapeHtml(targetUrl)}" data-id="${ex.id}" title="클릭 시 새 창에서 해당 단락 열기">
                <div class="recommend-card-header">
                    <span class="recommend-card-novel">[${escapeHtml(novelTitle)}]</span>
                    <span class="recommend-card-ep" title="${escapeHtml(epTitle)}">${escapeHtml(epTitle)}</span>
                    ${pidBadge}
                    <span class="recommend-card-ext-icon">🔗 새 창 ↗</span>
                </div>
                <div class="recommend-card-ori">${highlightedOri}</div>
                <div class="recommend-card-tra">${highlightedTra}</div>
                <div class="recommend-card-actions">
                    <button type="button" class="btn btn-sm btn-outline recommend-copy-btn" data-text="${escTra}" title="번역문 복사 또는 현재 셀에 적용">📋 번역 복사</button>
                    <button type="button" class="btn btn-sm btn-primary recommend-open-btn" data-url="${escapeHtml(targetUrl)}" title="새 창에서 원본 웹소설의 해당 단락으로 이동">🔗 해당 단락 열기 ↗</button>
                </div>
            </div>
        `;
    }).join('');

    if (dom.recommendCardsContainer) {
        dom.recommendCardsContainer.innerHTML = cardsHtml;
    }
}

export function handleRecommendCardClick(e) {
    const copyBtn = e.target.closest('.recommend-copy-btn');
    if (copyBtn) {
        e.stopPropagation();
        const text = copyBtn.dataset.text || '';
        if (state.activeTargetInput) {
            state.activeTargetInput.textContent = text;
            showToast('추천 번역문이 입력창에 적용되었습니다. (💾 저장 버튼을 눌러 확정하세요)', 'success');
        } else {
            navigator.clipboard.writeText(text);
            showToast('추천 번역문이 클립보드에 복사되었습니다.', 'success');
        }
        return;
    }

    const openBtn = e.target.closest('.recommend-open-btn');
    const card = e.target.closest('.recommend-card');
    const targetUrl = openBtn ? openBtn.dataset.url : (card ? card.dataset.url : null);

    if (targetUrl) {
        window.open(targetUrl, '_blank');
    }
}

let dragSearchAbortController = null;

export function handleDocumentMouseUp(e) {
    if (e.target && (e.target.closest('#similarRecommendPanel') || e.target.closest('.modal-content') || e.target.closest('.master-controls'))) {
        return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText.length < 2 || selectedText.length > 80) return;

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const translatedEl = (anchorNode ? (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement).closest('.translated-text') : null) ||
                         (focusNode ? (focusNode.nodeType === 1 ? focusNode : focusNode.parentElement).closest('.translated-text') : null);

    if (!translatedEl) return;

    state.activeTargetInput = translatedEl;
    const currentId = parseInt(translatedEl.dataset.id, 10) || null;
    const folder = translatedEl.dataset.folder || '';

    if (state.dragSearchTimeout) clearTimeout(state.dragSearchTimeout);
    state.dragSearchTimeout = setTimeout(() => {
        handleDragTranslationSearch(selectedText, currentId, folder);
    }, 200);
}

export async function handleDragTranslationSearch(keyword, excludeId, folder) {
    if (dragSearchAbortController) {
        dragSearchAbortController.abort();
    }
    dragSearchAbortController = new AbortController();

    try {
        const url = `/translations/similar_examples?keyword=${encodeURIComponent(keyword)}&exclude_id=${excludeId || ''}&folder=${encodeURIComponent(folder || '')}&limit=8`;
        const res = await fetch(url, { signal: dragSearchAbortController.signal });
        if (!res.ok) return;
        const data = await res.json();
        const examples = data.examples || [];

        if (examples.length > 0) {
            renderSimilarRecommendations(keyword, examples, [keyword]);
            if (dom.similarRecommendPanel) {
                dom.similarRecommendPanel.style.display = 'flex';
                dom.similarRecommendPanel.classList.toggle('is-collapsed', state.isRecommendCollapsed);
                if (dom.recommendToggleIcon) dom.recommendToggleIcon.textContent = state.isRecommendCollapsed ? '▲' : '▼';
                if (dom.recommendToggleText) dom.recommendToggleText.textContent = state.isRecommendCollapsed ? '펼치기' : '접기';
            }
        } else {
            if (dom.similarRecommendPanel && dom.similarRecommendPanel.style.display === 'flex') {
                if (dom.recommendKeyword) dom.recommendKeyword.textContent = `"${keyword}" (0건)`;
                if (dom.recommendCardsContainer) {
                    dom.recommendCardsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted);">'${escapeHtml(keyword)}'을(를) 포함하는 다른 번역문을 찾지 못했습니다.</div>`;
                }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('드래그 단어 검색 오류:', err);
        }
    }
}

export function initSimilarDock() {
    if (dom.closeRecommendPanelBtn) dom.closeRecommendPanelBtn.addEventListener('click', closeRecommendPanel);
    if (dom.toggleRecommendPanelBtn) {
        dom.toggleRecommendPanelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRecommendCollapse();
        });
    }
    if (dom.recommendHeader) {
        dom.recommendHeader.addEventListener('click', (e) => {
            if (e.target.closest('#closeRecommendPanel') || e.target.closest('#toggleRecommendPanel') || e.target.closest('a') || e.target.closest('.kw-chip')) {
                return;
            }
            toggleRecommendCollapse();
        });
    }
    if (dom.recommendCardsContainer) {
        dom.recommendCardsContainer.addEventListener('click', handleRecommendCardClick);
    }
    document.addEventListener('mouseup', handleDocumentMouseUp);
}
