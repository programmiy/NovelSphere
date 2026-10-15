/**
 * admin-tree.js
 * 3-Level hierarchy (Folder -> Episode -> Paragraph) rendering, Sortable, and table interactions.
 */

import { state, dom, escapeHtml, showToast, showCyberLoader, hideCyberLoader, getQuotaWindowStartMs, getCurrentDataSource, findTranslationById } from './admin-state.js';
import { handleTranslatedFocus } from './admin-dock.js';

let sortableInstances = [];

// Listen for stats update events
window.addEventListener('lanovel:update-stats', () => {
    updateStatistics(state.groupedTranslations);
});

window.addEventListener('lanovel:refresh-grouped', () => {
    loadAndRenderGrouped();
});

async function loadAndRenderGrouped() {
    if (state.isLoading) return;
    state.isLoading = true;
    showCyberLoader();
    dom.historyContainer.innerHTML = '';
    state.selectedIds.clear();
    updateBulkActionPanel();

    try {
        // Fetch all data from the server
        const [translationsRes, foldersRes] = await Promise.all([
            fetch(`/translations_by_folder?t=${Date.now()}`),
            fetch(`/folders?t=${Date.now()}`)
        ]);

        if (!translationsRes.ok) throw new Error(`Server error (translations): ${translationsRes.statusText}`);
        if (!foldersRes.ok) throw new Error(`Server error (folders): ${foldersRes.statusText}`);
        
        const responseData = await translationsRes.json();
        state.allFolders = await foldersRes.json(); // Assign to global state.allFolders

        // Populate the set of applied URLs from the server response
        state.appliedUrlsSet = new Set(responseData._applied_urls || []);
        delete responseData._applied_urls; // Clean up the metadata key
        state.groupedTranslations = responseData; // Assign clean data to global

        // Load auto-start setting
        const autoStartRes = await fetch('/api/settings/autostart');
        if (autoStartRes.ok) {
            const autoStartData = await autoStartRes.json();
            dom.autoStartCheckbox.checked = autoStartData.autostart;
        } else {
            console.error("Failed to load auto-start setting.");
        }

        // NOTE: state.translationStatuses logic is removed
        state.translationStatuses = {};

        // Load quota & status summary for accurate daily stats (4 PM/5 PM reset)
        try {
            const summaryRes = await fetch('/api/notifications/summary');
            if (summaryRes.ok) {
                state.latestQuotaSummary = await summaryRes.json();
            }
        } catch (e) {
            console.warn("Quota summary fetch failed:", e);
        }

        renderGroupedHistory(state.groupedTranslations); // Pass data to render
        populateFolderDropdowns(state.allFolders);
        updateStatistics(state.groupedTranslations);
        window.dispatchEvent(new CustomEvent('lanovel:check-unclassified'));
        
    } catch (error) {
        console.error("Failed to load data:", error);
        showToast("데이터 로딩 실패. 서버가 실행중인지 확인하세요.", "error");
    } finally {
        state.isLoading = false;
        await hideCyberLoader();
        dom.emptyState.style.display = Object.keys(state.groupedTranslations).length === 0 ? 'block' : 'none';
        updateBulkActionPanel();
    }
}

function updateStatistics(groupedData) {
    let totalCount = 0;
    let todayCount = 0;
    let todayEpisodes = 0;
    let totalLength = 0;
    let totalEpisodes = 0;
    const folders = Object.keys(groupedData || {});
    const totalBooks = folders.length;
    
    const quotaWindowStartMs = getQuotaWindowStartMs(state.latestQuotaSummary);

    for (const folderName in groupedData) {
        const urlGroups = groupedData[folderName]; // This is an array of urlGroup objects
        if (Array.isArray(urlGroups)) {
            totalEpisodes += urlGroups.length;
            for (const urlGroup of urlGroups) {
                const items = urlGroup.items || [];
                let hasTodayItem = false;
                for (const item of items) {
                    totalCount++;
                    totalLength += item.translated ? item.translated.length : 0;
                    
                    if ((item.timestamp * 1000) >= quotaWindowStartMs) {
                        todayCount++;
                        hasTodayItem = true;
                    }
                }
                if (hasTodayItem) {
                    todayEpisodes++;
                }
            }
        }
    }

    // 서버(/api/notifications/summary)에서 제공하는 미분류 포함 전체 DB 기준 오늘 실적이 있다면 최우선 적용
    if (state.latestQuotaSummary && typeof state.latestQuotaSummary.today_episodes_count === 'number') {
        todayEpisodes = state.latestQuotaSummary.today_episodes_count;
    }
    if (state.latestQuotaSummary && typeof state.latestQuotaSummary.today_translations_count === 'number') {
        todayCount = state.latestQuotaSummary.today_translations_count;
    }

    const avgLength = totalCount > 0 ? Math.round(totalLength / totalCount) : 0;

    const statTotalBooksEl = document.getElementById('statTotalBooks');
    if (statTotalBooksEl) statTotalBooksEl.textContent = totalBooks.toLocaleString();

    const statTotalEpisodesEl = document.getElementById('statTotalEpisodes');
    if (statTotalEpisodesEl) statTotalEpisodesEl.textContent = totalEpisodes.toLocaleString();

    const statTotalCharsEl = document.getElementById('statTotalChars');
    if (statTotalCharsEl) statTotalCharsEl.textContent = totalLength.toLocaleString();

    const totalCountEl = document.getElementById('totalCount');
    if (totalCountEl) totalCountEl.textContent = totalCount.toLocaleString();

    const todayEpisodesStatEl = document.getElementById('todayEpisodesStat');
    if (todayEpisodesStatEl) todayEpisodesStatEl.textContent = `${todayEpisodes.toLocaleString()}화`;

    const todayCountEl = document.getElementById('todayCount');
    if (todayCountEl) todayCountEl.textContent = todayCount.toLocaleString();

    const avgLengthEl = document.getElementById('avgLength');
    if (avgLengthEl) avgLengthEl.textContent = avgLength.toLocaleString();

    const currentResetHour = state.latestQuotaSummary ? (state.latestQuotaSummary.quota_reset_hour || 16) : 16;
    const currentResetHourStr = currentResetHour > 12 ? `오후 ${currentResetHour - 12}시` : `${currentResetHour}시`;
    const todayStatItem = document.getElementById('todayStatItem');
    if (todayStatItem) {
        todayStatItem.title = `오늘 번역된 회차(페이지) 및 문단 수 (API 리셋 기준: 매일 ${currentResetHourStr} 초기화)`;
    }
    const todayCountLabel = document.getElementById('todayCountLabel');
    if (todayCountLabel) {
        todayCountLabel.innerHTML = `오늘 번역 (<span id="todayCount">${todayCount.toLocaleString()}</span>문단) <span style="font-size: 11px; opacity: 0.85; font-weight: normal;">(${currentResetHourStr} 리셋)</span>`;
    }

    // API 쿼터 통계 갱신
    if (state.latestQuotaSummary) {
        const apiQuotaCountEl = document.getElementById('apiQuotaCount');
        const apiQuotaLabelEl = document.getElementById('apiQuotaLabel');
        const apiQuotaStatItem = document.getElementById('apiQuotaStatItem');
        const calls = state.latestQuotaSummary.api_calls_today || 0;
        const limit = state.latestQuotaSummary.api_quota_limit || 500;
        const pct = state.latestQuotaSummary.percentage || 0;
        const resetHour = state.latestQuotaSummary.quota_reset_hour || 16;
        
        if (apiQuotaCountEl) {
            apiQuotaCountEl.textContent = `${calls} / ${limit}`;
        }
        if (apiQuotaLabelEl) {
            apiQuotaLabelEl.textContent = `API 쿼터 (${pct}%)`;
        }
        if (apiQuotaStatItem) {
            apiQuotaStatItem.title = `오늘 Gemini API 쿼터 사용량: ${calls} / ${limit}회 (${pct}%)\n매일 오후 ${resetHour > 12 ? resetHour - 12 : resetHour}시(KST) 초기화`;
            if (pct >= 90) {
                apiQuotaStatItem.style.borderColor = 'rgba(239, 68, 68, 0.7)';
            } else if (pct >= 70) {
                apiQuotaStatItem.style.borderColor = 'rgba(245, 158, 11, 0.7)';
            }
        }

        const apiQuotaMiniFill = document.getElementById('apiQuotaMiniFill');
        if (apiQuotaMiniFill) {
            apiQuotaMiniFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
            if (pct >= 90) apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
            else if (pct >= 70) apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
            else apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #0284c7, #38bdf8)';
        }
    }
}


function populateFolderDropdowns(folders) {
    const folderFilterDropdown = dom.folderFilterDropdown || document.getElementById('folderFilterDropdown');

    if (dom.moveSelectedToFolderDropdown) {
        dom.moveSelectedToFolderDropdown.innerHTML = '<option value="">폴더로 이동...</option>';
        folders.forEach(folder => {
            const option = `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`;
            dom.moveSelectedToFolderDropdown.insertAdjacentHTML('beforeend', option);
        });
    }

    if (dom.folderFilterDropdown) {
        const currentValue = dom.folderFilterDropdown.value; // Preserve selection
        dom.folderFilterDropdown.innerHTML = '<option value="">모든 폴더</option>';
        folders.forEach(folder => {
            const option = `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`;
            dom.folderFilterDropdown.insertAdjacentHTML('beforeend', option);
        });
        dom.folderFilterDropdown.value = currentValue; // Restore selection if possible
    }
}



function renderGroupedHistory(dataToRender, selectedFolder = '') {
    dom.historyContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    sortableInstances = []; // Clear instances on re-render
    
    let folderNames = Array.from(new Set([...state.allFolders.map(f => f.name), ...Object.keys(dataToRender)])).sort();

    if (selectedFolder && selectedFolder !== '__all__') {
        folderNames = folderNames.filter(f => f === selectedFolder);
    }

    for (const folderName of folderNames) {
        const urlGroups = dataToRender[folderName] || []; // This is now an array of urlGroup objects
        const folderContainer = document.createElement('div');
        folderContainer.className = 'history-folder-group';
        folderContainer.dataset.folderName = folderName;

        let urlGroupsHtml = '';
        let totalTranslationsInFolder = 0;
        let validEpisodeCount = 0;

        for (const urlGroup of urlGroups) {
            const url = urlGroup.url;
            const translations = urlGroup.items || [];
            const sortOrder = urlGroup.sort_order;

            let filteredTranslations = translations.filter(t => {
                const matchesSearch = !state.currentSearch || 
                    (t.original && t.original.toLowerCase().includes(state.currentSearch)) || 
                    (t.translated && t.translated.toLowerCase().includes(state.currentSearch));
                if (!matchesSearch) return false;

                if (state.isFindingEmpty && currentAbnormalFilter !== 'all') {
                    return t.category === currentAbnormalFilter;
                }
                return true;
            });

            if (filteredTranslations.length === 0) continue;

            validEpisodeCount++;
            totalTranslationsInFolder += filteredTranslations.length;
            const title = filteredTranslations[0]?.title || url;
            const isApplied = state.appliedUrlsSet.has(url.split('#')[0].replace(/\/$/, ''));

            const shouldRenderImmediately = Boolean(state.currentSearch);
            const isUrlGroupCollapsed = shouldRenderImmediately ? false : true;
            const groupItemsHtml = shouldRenderImmediately ? filteredTranslations.map(t => renderItem(t)).join('') : '';

            urlGroupsHtml += `
                <div class="list-group fade-in" data-url="${escapeHtml(url)}" data-folder-name="${escapeHtml(folderName)}">
                    <div class="list-group-header">
                        <span class="list-group-toggle ${isUrlGroupCollapsed ? 'collapsed' : ''} material-icons">${isUrlGroupCollapsed ? 'chevron_right' : 'expand_more'}</span>
                        <div class="list-group-title-container">
                            <h3 class="list-group-title">${escapeHtml(title)}</h3>
                            <span class="episode-count-badge">${filteredTranslations.length}개 단락</span>
                        </div>
                        <div class="list-group-actions">
                            <a href="${url}" target="_blank" class="btn btn-outline btn-sm ext-link-btn" title="소설 원본 웹페이지 새 창으로 열기">🔗 원본 ↗</a>
                            <button class="btn btn-outline btn-sm edit-title-btn" data-url="${escapeHtml(url)}" title="회차 제목 수정">✏️ 수정</button>
                            <button class="btn btn-secondary btn-sm btn-apply ${isApplied ? 'applied' : ''}" data-url="${escapeHtml(url)}">${isApplied ? '적용 해제' : '적용'}</button>
                            <label class="checkbox-container select-all-label">
                                <input type="checkbox" class="group-select-all-checkbox">
                                <span class="checkmark"></span>
                                전체 선택
                            </label>
                        </div>
                    </div>
                    <div class="list-group-content ${isUrlGroupCollapsed ? 'collapsed' : ''}">
                        ${groupItemsHtml ? `
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th style="width: 44px; text-align: center;">선택</th>
                                    <th style="width: 75px;">PID</th>
                                    <th style="width: 42%;">원문 (일본어)</th>
                                    <th style="width: 42%;">번역 (한국어)</th>
                                    <th style="width: 150px; text-align: center;">관리</th>
                                </tr>
                            </thead>
                            <tbody>${groupItemsHtml}</tbody>
                        </table>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if ((state.isFindingEmpty || state.isCleanupQueue) && totalTranslationsInFolder === 0) {
            continue;
        }

        // 특정 폴더 선택 시 자동 펼침, 그 외 기본 접힘
        const isFolderCollapsed = (selectedFolder && selectedFolder !== '__all__') ? false : (Boolean(state.currentSearch) ? false : true);

        folderContainer.innerHTML = `
            <div class="folder-group-header">
                <span class="folder-group-toggle material-icons ${isFolderCollapsed ? 'collapsed' : ''}">expand_more</span>
                <div class="folder-title-wrapper">
                    <h2 class="folder-group-title">${escapeHtml(folderName)}</h2>
                    <span class="folder-stats-badge">${validEpisodeCount}개 회차 / ${totalTranslationsInFolder.toLocaleString()}개 단락</span>
                </div>
                <div class="list-group-actions">
                    <button class="btn btn-outline btn-sm toggle-all-episodes-btn" title="이 소설의 모든 회차를 한 번에 펼치거나 접습니다.">모든 회차 펼치기</button>
                    <label class="checkbox-container select-all-label">
                        <input type="checkbox" class="folder-select-all-checkbox">
                        <span class="checkmark"></span>
                        폴더 전체 선택
                    </label>
                </div>
            </div>
            <div class="folder-group-content ${isFolderCollapsed ? 'collapsed' : ''}">
                ${urlGroupsHtml || '<div class="empty-folder-notice">번역된 회차가 없습니다.</div>'}
            </div>
        `;
        fragment.appendChild(folderContainer);
    }
    dom.historyContainer.appendChild(fragment);
}

function renderUrlGroupContent(listGroupEl) {
    const contentEl = listGroupEl.querySelector('.list-group-content');
    if (!contentEl || contentEl.querySelector('.history-table')) return; // Already rendered

    const url = listGroupEl.dataset.url;
    const folderName = listGroupEl.dataset.folderName;
    const currentDataSource = state.isFindingEmpty ? state.rawAbnormalData : (state.isCleanupQueue ? state.rawCleanupData : state.groupedTranslations);
    const urlGroups = (currentDataSource && currentDataSource[folderName]) || [];
    const urlGroup = urlGroups.find(g => g.url === url);
    if (!urlGroup) return;

    let items = (urlGroup.items || []).slice();
    if (state.currentSearch) {
        items = items.filter(t => 
            (t.original && t.original.toLowerCase().includes(state.currentSearch)) || 
            (t.translated && t.translated.toLowerCase().includes(state.currentSearch))
        );
    }
    if (state.isFindingEmpty && currentAbnormalFilter !== 'all') {
        items = items.filter(t => t.category === currentAbnormalFilter);
    }
    items.sort((a, b) => (a.pid || '').localeCompare(b.pid || '', undefined, { numeric: true, sensitivity: 'base' }));

    const itemsHtml = items.map(t => renderItem(t)).join('');
    contentEl.innerHTML = `
        <table class="history-table">
            <thead>
                <tr>
                    <th style="width: 44px; text-align: center;">선택</th>
                    <th style="width: 75px;">PID</th>
                    <th style="width: 42%;">원문 (일본어)</th>
                    <th style="width: 42%;">번역 (한국어)</th>
                    <th style="width: 150px; text-align: center;">관리</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>
    `;
}

function renderItem(t) {
    const date = new Date(t.timestamp * 1000);
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    const isChecked = state.selectedIds.has(t.id);

    let badgeHtml = '';
    if (state.isFindingEmpty && t.category) {
        const badgeClass = t.category === 'partial_untranslated' ? 'badge-partial' : 'badge-other-lang';
        const label = t.category_label || (t.category === 'partial_untranslated' ? '일부 미번역' : '다른 언어로 번역');
        let queuedBadge = '';
        if (t.is_queued_for_cleanup) {
            queuedBadge = ' <span class="category-badge badge-moved" title="원문 정리 섹션으로 이동된 상태입니다.">정리 대기</span>';
        }
        badgeHtml = `<div class="badge-wrapper"><span class="category-badge ${badgeClass}">${escapeHtml(label)}</span>${queuedBadge}</div>`;
    } else if (state.isCleanupQueue && t.category) {
        let badgeClass = 'badge-verbatim';
        if (t.category === 'paraphrased_jp' || t.category === 'paraphrased_zh') badgeClass = 'badge-paraphrased';
        else if (t.category === 'moved') badgeClass = 'badge-moved';
        badgeHtml = `<div class="badge-wrapper"><span class="category-badge ${badgeClass}">${escapeHtml(t.category_label || t.category)}</span></div>`;
    }

    const kwList = Array.isArray(t.untranslated_keywords) ? t.untranslated_keywords.join(',') : '';

    // 미번역 키워드 칩 (이상번역 모드 + partial_untranslated 또는 other_language 카테고리)
    let keywordChipsHtml = '';
    if (state.isFindingEmpty && (t.category === 'partial_untranslated' || t.category === 'other_language') && Array.isArray(t.untranslated_keywords) && t.untranslated_keywords.length > 0) {
        const chips = t.untranslated_keywords.map(kw =>
            `<button class="keyword-chip" data-keyword="${escapeHtml(kw)}" data-folder="${escapeHtml(t.folderName || '')}" title="'${escapeHtml(kw)}'을(를) 찾아 바꾸기">🔍 ${escapeHtml(kw)}</button>`
        ).join('');
        keywordChipsHtml = `<div class="keyword-chips-container">${chips}</div>`;
    }

    return `
        <tr class="history-item" data-id="${t.id}">
            <td class="item-checkbox-cell">
                <input type="checkbox" class="item-checkbox" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
            </td>
            <td class="item-pid-cell">
                <span class="pid-badge">${escapeHtml(t.pid)}</span>
            </td>
            <td class="item-original-cell">
                <div class="original-cell-container">
                    <div class="text-content original-text" title="클릭 또는 드래그하여 원문을 복사할 수 있습니다.">${escapeHtml(t.original)}</div>
                    <div class="original-actions">
                        <button class="btn btn-sm btn-copy-orig copy-orig-btn" title="원문 일본어 복사" data-original="${escapeHtml(t.original)}">
                            📋 원문 복사
                        </button>
                    </div>
                </div>
            </td>
            <td class="item-translated-cell">
                <div class="translated-cell-container">
                    ${badgeHtml}
                    ${keywordChipsHtml}
                    <div class="text-content translated-text" contenteditable="true" data-id="${t.id}" data-folder="${escapeHtml(t.folderName || '')}" data-keywords="${escapeHtml(kwList)}" data-original="${escapeHtml(t.original)}">${escapeHtml(t.translated)}</div>
                    <div class="translated-actions">
                        <span class="edit-status-hint">✏️ 수정 가능</span>
                        <button class="btn btn-sm btn-save-inline save-item-btn" title="번역 수정 내용 저장">
                            💾 저장
                        </button>
                    </div>
                </div>
            </td>
            <td class="item-actions-container">
                <div class="item-date">${dateStr}</div>
                <div class="action-btn-clusters">
                    <!-- 1. AI 재번역 및 이상 제외 클러스터 (작업) -->
                    <div class="action-cluster work-cluster">
                        <button class="btn btn-sm btn-action retranslate-item-btn" title="고성능 AI 모델로 재번역">🔄 AI 재번역</button>
                        ${state.isFindingEmpty ? `
                            <button class="btn btn-sm btn-action-whitelist whitelist-item-btn" title="이 단락은 의도된 원문/외국어(일본어/영어/스페인어 등) 표기이므로 이상번역 찾기에서 제외합니다." data-id="${t.id}">🛡️ 이상 제외</button>
                        ` : ''}
                    </div>
                    <!-- 분리선: 오클릭 방지를 위한 시각적/물리적 격리 -->
                    <div class="action-divider"></div>
                    <!-- 2. 관리/위험 클러스터 (제외, 삭제) -->
                    <div class="action-cluster danger-cluster">
                        <button class="btn btn-sm btn-action-danger exclude-btn" title="번역에서 영구 제외">❌ 제외</button>
                        <button class="btn btn-sm btn-action-danger delete-btn" title="이 번역 항목 삭제">🗑️ 삭제</button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}



async function createFolder() {
    const newName = dom.newFolderNameInput.value.trim();
    if (!newName) {
        showToast('폴더 이름을 입력하세요.', 'error');
        return;
    }

    try {
        const response = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_name: newName })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `Server error: ${response.status}`);
        }

        showToast(result.message, 'success');
        dom.newFolderNameInput.value = '';
        
        // Fetch the updated folder list and repopulate the dropdown.
        const foldersRes = await fetch(`/folders?t=${Date.now()}`);
        if (foldersRes.ok) {
            state.allFolders = await foldersRes.json();
            populateFolderDropdowns(state.allFolders);
        }
        
        loadAndRenderGrouped(); // Reload all data to show the new folder
    } catch (error) {
        console.error("Failed to create folder:", error);
        showToast(`폴더 생성 실패: ${error.message}`, 'error');
    }
}

function handleCheckboxChange(e) {
    const target = e.target;
    if (!target.matches('input[type="checkbox"]')) return;

    const currentData = getCurrentDataSource();

    if (target.classList.contains('folder-select-all-checkbox')) {
        const folderGroup = target.closest('.history-folder-group');
        if (!folderGroup) return;

        const folderTitleEl = folderGroup.querySelector('.folder-group-title');
        const folderName = folderTitleEl ? folderTitleEl.textContent.split(' (')[0].trim() : '';
        const urlGroups = currentData[folderName] || [];
        for (const ug of urlGroups) {
            for (const item of ug.items || []) {
                if (target.checked) {
                    state.selectedIds.add(item.id);
                } else {
                    state.selectedIds.delete(item.id);
                }
            }
        }

        const groupCheckboxes = folderGroup.querySelectorAll('.group-select-all-checkbox');
        groupCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });

        const itemCheckboxes = folderGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });
    } else if (target.classList.contains('group-select-all-checkbox')) {
        const urlGroup = target.closest('.list-group');
        if (!urlGroup) return;

        const url = urlGroup.dataset.url;
        const folderName = urlGroup.dataset.folderName;
        const urlGroups = currentData[folderName] || [];
        const foundGroup = urlGroups.find(g => g.url === url);
        if (foundGroup) {
            for (const item of foundGroup.items || []) {
                if (target.checked) {
                    state.selectedIds.add(item.id);
                } else {
                    state.selectedIds.delete(item.id);
                }
            }
        }
        
        const itemCheckboxes = urlGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });
    } else if (target.classList.contains('item-checkbox')) {
        const id = parseInt(target.dataset.id);
        if (target.checked) {
            state.selectedIds.add(id);
        } else {
            state.selectedIds.delete(id);
        }
    }

    updateBulkActionPanel();
}



async function handleHistoryClick(e) {
    const target = e.target;

    // Ignore clicks on checkboxes, they are handled by a different listener
    if (target.matches('input[type="checkbox"]')) {
        return;
    }

    // 1. Handle Folder Name Edit
    if (target.classList.contains('edit-folder-name-btn')) {
        const oldFolderName = target.dataset.folderName;
        const newFolderName = prompt(`'${oldFolderName}' 폴더의 새 이름을 입력하세요:`);
        if (newFolderName && newFolderName.trim() !== '' && newFolderName !== oldFolderName) {
            renameFolder(oldFolderName, newFolderName.trim());
        }
        return; // Action handled
    }

    // 2. Handle URL-level actions (Title Edit, Apply, Episode toggle)
    const urlHeader = target.closest('.list-group-header');
    if (urlHeader) {
        if (target.closest('.edit-title-btn')) {
            const btn = target.closest('.edit-title-btn');
            const url = btn.dataset.url;
            const titleElement = urlHeader.querySelector('.list-group-title');
            const currentTitle = titleElement ? titleElement.textContent : '';
            const newTitle = prompt("새 회차 제목을 입력하세요:", currentTitle);
            if (newTitle && newTitle !== currentTitle) {
                if (titleElement) titleElement.textContent = newTitle;
                try {
                    await fetch('/translations/url_title', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url, title: newTitle })
                    });
                    showToast('회차 제목이 수정되었습니다.', 'success');
                } catch (error) {
                    showToast('제목 수정에 실패했습니다.', 'error');
                    if (titleElement) titleElement.textContent = currentTitle;
                }
            }
            return; // Action handled
        }

        if (target.closest('.btn-apply')) {
            const btn = target.closest('.btn-apply');
            const url = btn.dataset.url;
            toggleApplyStatus(url, btn); // Pass button for optimistic UI update
            return; // Action handled
        }

        if (target.closest('.ext-link-btn')) {
            // Let the browser open the external novel link naturally in new tab
            return;
        }

        if (target.closest('.group-select-all-checkbox') || target.closest('.checkbox-container')) {
            return; // Handled by change listener
        }

        // 미분류 소설 보관함(드로어) 내부의 회차 토글은 renderUnclassifiedEpisodes 자체 핸들러가 처리
        if (urlHeader.closest('#unclassifiedEpisodeListContainer')) {
            return;
        }

        // Clicking anywhere else in the episode header (title, chevron, or row background) toggles the episode
        const listGroupEl = urlHeader.closest('.list-group');
        const contentEl = urlHeader.nextElementSibling;
        const isExpanding = contentEl.classList.contains('collapsed');

        if (isExpanding) {
            renderUrlGroupContent(listGroupEl);
            contentEl.classList.remove('collapsed');
            const icon = urlHeader.querySelector('.list-group-toggle');
            if (icon) {
                icon.classList.remove('collapsed');
                icon.textContent = 'expand_more';
            }
        } else {
            contentEl.classList.add('collapsed');
            const icon = urlHeader.querySelector('.list-group-toggle');
            if (icon) {
                icon.classList.add('collapsed');
                icon.textContent = 'chevron_right';
            }
        }
        return;
    }

    // 3. Handle Item-level actions (Save, Copy, Exclude, Delete)
    const itemRow = target.closest('.history-item');
    if (itemRow) {
        const id = parseInt(itemRow.dataset.id);

        // 원문 복사 버튼 처리 (원문 텍스트 복사 및 시각 피드백)
        const copyOrigBtn = target.closest('.copy-orig-btn') || (target.classList.contains('copy-btn') ? target : null);
        if (copyOrigBtn) {
            const originalText = copyOrigBtn.dataset.original || itemRow.querySelector('.original-text')?.textContent;
            if (originalText) {
                navigator.clipboard.writeText(originalText);
                showToast('원문이 클립보드에 복사되었습니다.', 'success');
                const origHtml = copyOrigBtn.innerHTML;
                copyOrigBtn.innerHTML = '✅ 복사 완료!';
                copyOrigBtn.classList.add('copied');
                setTimeout(() => {
                    copyOrigBtn.innerHTML = origHtml;
                    copyOrigBtn.classList.remove('copied');
                }, 1500);
            }
            return;
        }

        const whitelistBtn = target.closest('.whitelist-item-btn');
        if (whitelistBtn) {
            try {
                const res = await fetch('/translations/abnormal_whitelist/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [id] })
                });
                if (!res.ok) throw new Error('서버 응답 오류');
                itemRow.style.transition = 'opacity 0.25s, transform 0.25s';
                itemRow.style.opacity = '0';
                itemRow.style.transform = 'translateX(20px)';
                setTimeout(() => itemRow.remove(), 250);
                showToast('해당 단락이 이상번역 검사에서 제외되었습니다.', 'success');
                loadNotificationsAndBadge();
            } catch (err) {
                console.error('이상번역 제외 실패:', err);
                showToast(`이상번역 제외 실패: ${err.message}`, 'error');
            }
            return;
        }

        const deleteBtn = target.closest('.delete-btn');
        if (deleteBtn) {
            if (!confirm('이 번역을 삭제하시겠습니까?')) return;
            await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
            itemRow.remove();
            showToast('삭제되었습니다.');
            return;
        }

        const excludeBtn = target.closest('.exclude-btn');
        if (excludeBtn) {
            if (!confirm('이 문장을 번역에서 영구적으로 제외하시겠습니까?')) return;
            try {
                const response = await fetch(`/translations/exclude`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [id] })
                });
                if (!response.ok) throw new Error('Server responded with an error');
                itemRow.remove();
                showToast('문장이 제외되고 삭제되었습니다.', 'success');
            } catch (error) {
                console.error('Failed to exclude translation:', error);
                showToast('문장 제외에 실패했습니다.', 'error');
            }
            return;
        }

        const retransBtn = target.closest('.retranslate-item-btn');
        if (retransBtn) {
            const originalItem = findTranslationById(id);
            if (!originalItem) {
                showToast('오류: 재번역할 항목을 찾을 수 없습니다.', 'error');
                return;
            }
            if (!confirm(`이 문장을 고성능 모델로 재번역하시겠습니까?\n\n원문: ${originalItem.original}`)) return;

            const translatedCell = itemRow.querySelector('.translated-text');
            const prevText = translatedCell.textContent;
            retransBtn.disabled = true;
            translatedCell.textContent = '⏳ 고성능 모델로 재번역 중...';

            try {
                const response = await fetch('/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: [{ id: String(originalItem.pid || id), text: originalItem.original }],
                        url: originalItem.url || '',
                        is_retranslation: true
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
                    throw new Error(errData.detail || '재번역 API 호출 실패');
                }

                const data = await response.json();
                if (data.translations && data.translations.length > 0) {
                    const newTranslated = data.translations[0].translated;
                    translatedCell.textContent = newTranslated;

                    // DB 저장
                    const updatedItemPayload = {
                        ...originalItem,
                        translated: newTranslated,
                        timestamp: Math.floor(Date.now() / 1000)
                    };
                    delete updatedItemPayload.id;

                    await fetch('/translations/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([updatedItemPayload])
                    });

                    originalItem.translated = newTranslated;
                    originalItem.timestamp = updatedItemPayload.timestamp;

                    const dateElement = itemRow.querySelector('.item-date');
                    if (dateElement) {
                        const date = new Date(updatedItemPayload.timestamp * 1000);
                        dateElement.textContent = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
                    }
                    showToast('고성능 모델로 재번역 및 저장되었습니다.', 'success');
                } else {
                    throw new Error('재번역 결과를 받지 못했습니다.');
                }
            } catch (error) {
                console.error('재번역 실패:', error);
                translatedCell.textContent = prevText;
                showToast(`재번역 실패: ${error.message}`, 'error');
            } finally {
                retransBtn.disabled = false;
            }
            return;
        }

        const saveBtn = target.closest('.save-item-btn');
        if (saveBtn) {
            const newTranslatedText = itemRow.querySelector('.translated-text').textContent;
            const originalItem = findTranslationById(id);
            if (!originalItem) {
                showToast('오류: 저장할 원본 항목을 찾을 수 없습니다.', 'error');
                return;
            }
            const updatedItemPayload = {
                ...originalItem,
                translated: newTranslatedText,
                timestamp: Math.floor(Date.now() / 1000)
            };
            delete updatedItemPayload.id;
            try {
                const response = await fetch('/translations/upsert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([updatedItemPayload])
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`Server error: ${response.status} - ${errorData.detail || 'Unknown error'}`);
                }
                showToast('저장되었습니다.');
                originalItem.translated = newTranslatedText;
                originalItem.timestamp = updatedItemPayload.timestamp;
                const dateElement = itemRow.querySelector('.item-date');
                if(dateElement) {
                     const date = new Date(updatedItemPayload.timestamp * 1000);
                     dateElement.textContent = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
                }
            } catch (error) {
                console.error('Failed to save translation:', error);
                showToast(`저장 실패: ${error.message}`, 'error');
            }
            return;
        }
        return; // Action handled
    }

    // 4. Handle Folder expand/collapse & Toggle All Episodes
    const folderHeader = target.closest('.folder-group-header');
    if (folderHeader) {
        if (target.closest('.folder-select-all-checkbox') || target.closest('.checkbox-container')) {
            return; // Handled by change listener
        }

        // Toggle all episodes button in this folder
        const toggleAllBtn = target.closest('.toggle-all-episodes-btn');
        if (toggleAllBtn) {
            const folderContent = folderHeader.nextElementSibling;
            if (folderContent.classList.contains('collapsed')) {
                folderContent.classList.remove('collapsed');
                folderHeader.querySelector('.folder-group-toggle')?.classList.remove('collapsed');
            }
            const isExpandingAll = toggleAllBtn.textContent.includes('펼치기');
            const listGroups = folderContent.querySelectorAll('.list-group');
            listGroups.forEach(lg => {
                const content = lg.querySelector('.list-group-content');
                const toggle = lg.querySelector('.list-group-toggle');
                if (isExpandingAll) {
                    renderUrlGroupContent(lg);
                    content?.classList.remove('collapsed');
                    if (toggle) {
                        toggle.classList.remove('collapsed');
                        toggle.textContent = 'expand_more';
                    }
                } else {
                    content?.classList.add('collapsed');
                    if (toggle) {
                        toggle.classList.add('collapsed');
                        toggle.textContent = 'chevron_right';
                    }
                }
            });
            toggleAllBtn.textContent = isExpandingAll ? '모든 회차 접기' : '모든 회차 펼치기';
            return;
        }

        // Toggle novel folder
        const folderContent = folderHeader.nextElementSibling;
        const toggle = folderHeader.querySelector('.folder-group-toggle');
        const isExpanding = folderContent.classList.contains('collapsed');
        if (isExpanding) {
            folderContent.classList.remove('collapsed');
            if (toggle) toggle.classList.remove('collapsed');
        } else {
            folderContent.classList.add('collapsed');
            if (toggle) toggle.classList.add('collapsed');
        }
        return;
    }
}
async function toggleApplyStatus(url, button) {
    const cleanUrl = url.split('#')[0].replace(/\/$/, '');
    const shouldApply = !button.classList.contains('applied');

    try {
        const response = await fetch('/api/urls/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl, apply: shouldApply })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        // Update UI optimistically
        if (shouldApply) {
            state.appliedUrlsSet.add(cleanUrl);
            button.textContent = '해제';
            button.classList.add('applied');
        } else {
            state.appliedUrlsSet.delete(cleanUrl);
            button.textContent = '적용';
            button.classList.remove('applied');
        }
        showToast(shouldApply ? '적용 설정 완료' : '적용 설정 해제', 'success');

    } catch (error) {
        console.error('Failed to toggle apply status:', error);
        showToast('상태 변경에 실패했습니다.', 'error');
    }
}

function updateBulkActionPanel() {
    const hasSelection = state.selectedIds.size > 0;

    if (hasSelection) {
        dom.bulkActionsPanel.style.display = 'flex';
        dom.selectionCount.textContent = `${state.selectedIds.size}개 선택됨`;
    } else {
        dom.bulkActionsPanel.style.display = 'none';
    }

    if (dom.bulkWhitelistAbnormalBtn) {
        dom.bulkWhitelistAbnormalBtn.style.display = (hasSelection && state.isFindingEmpty) ? 'inline-flex' : 'none';
    }
    if (dom.bulkMoveToCleanupBtn) {
        dom.bulkMoveToCleanupBtn.style.display = (hasSelection && state.isFindingEmpty) ? 'inline-flex' : 'none';
    }

    if (dom.deleteSelectedBtn) dom.deleteSelectedBtn.disabled = !hasSelection;
    if (dom.moveSelectedToFolderDropdown) dom.moveSelectedToFolderDropdown.disabled = !hasSelection;
    if (dom.retranslateSelectedBtn) dom.retranslateSelectedBtn.disabled = !hasSelection;
    if (dom.copySelectedOriginalBtn) dom.copySelectedOriginalBtn.disabled = !hasSelection;
    if (dom.bulkFindReplaceBtn) dom.bulkFindReplaceBtn.disabled = !hasSelection;
    if (dom.excludeSelectedBtn) dom.excludeSelectedBtn.disabled = !hasSelection;
}

function deselectAll() {
    state.selectedIds.clear();
    const checkboxes = dom.historyContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { cb.checked = false; });
    updateBulkActionPanel();
    showToast('선택이 해제되었습니다.', 'info');
}

function copySelectedOriginals() {
    if (state.selectedIds.size === 0) return;
    const originals = [];
    for (const id of state.selectedIds) {
        const item = findTranslationById(id);
        if (item && item.original) {
            originals.push(item.original);
        }
    }
    if (originals.length === 0) {
        showToast('복사할 원문이 없습니다.', 'error');
        return;
    }
    const text = originals.join('\n\n');
    navigator.clipboard.writeText(text);
    showToast(`선택한 ${originals.length}개 단락의 원문이 클립보드에 복사되었습니다.`, 'success');
}

async function excludeSelectedTranslations() {
    if (state.selectedIds.size === 0) return;
    const count = state.selectedIds.size;
    if (!confirm(`선택한 ${count}개 문장을 번역에서 영구적으로 제외하시겠습니까?\n(제외된 문장은 삭제되며, 이후 웹페이지 번역 시에도 자동으로 건너뜁니다.)`)) return;

    try {
        const response = await fetch('/translations/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(state.selectedIds) })
        });
        if (!response.ok) throw new Error('서버 응답 오류');
        showToast(`${count}개의 문장이 제외되고 삭제되었습니다.`, 'success');
        state.selectedIds.clear();
        if (state.isFindingEmpty) {
            window.dispatchEvent(new CustomEvent('lanovel:refresh-abnormal'));
        } else if (state.isCleanupQueue) {
            window.dispatchEvent(new CustomEvent('lanovel:refresh-cleanup'));
        } else {
            loadAndRenderGrouped();
        }
    } catch (err) {
        console.error('문장 일괄 제외 실패:', err);
        showToast(`문장 제외 실패: ${err.message}`, 'error');
    }
}

async function retranslateSelectedTranslations() {
    if (state.selectedIds.size === 0) return;
    const count = state.selectedIds.size;
    if (!confirm(`선택한 ${count}개의 단락을 고성능 AI 모델로 일괄 재번역하시겠습니까?`)) return;

    const itemsToRetranslate = [];
    for (const id of state.selectedIds) {
        const item = findTranslationById(id);
        if (item && item.original) {
            itemsToRetranslate.push(item);
        }
    }

    if (itemsToRetranslate.length === 0) {
        showToast('재번역할 문장을 찾을 수 없습니다.', 'error');
        return;
    }

    showToast(`${count}개 단락 재번역을 시작합니다...`, 'info');
    if (dom.retranslateSelectedBtn) dom.retranslateSelectedBtn.disabled = true;

    const CHUNK_SIZE = 10;
    let successCount = 0;
    let failCount = 0;

    try {
        for (let i = 0; i < itemsToRetranslate.length; i += CHUNK_SIZE) {
            const chunk = itemsToRetranslate.slice(i, i + CHUNK_SIZE);
            const reqPayload = {
                items: chunk.map(it => ({ id: String(it.pid || it.id), text: it.original })),
                url: chunk[0].url || '',
                is_retranslation: true
            };

            try {
                const res = await fetch('/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqPayload)
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const translations = data.translations || [];

                const upsertPayload = [];
                const now = Math.floor(Date.now() / 1000);

                for (const t of translations) {
                    const matched = chunk.find(it => String(it.pid || it.id) === String(t.id));
                    if (matched) {
                        matched.translated = t.translated;
                        matched.timestamp = now;

                        const p = { ...matched, translated: t.translated, timestamp: now };
                        delete p.id;
                        upsertPayload.push(p);
                        successCount++;
                    }
                }

                if (upsertPayload.length > 0) {
                    await fetch('/translations/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(upsertPayload)
                    });
                }
            } catch (err) {
                console.error('청크 재번역 실패:', err);
                failCount += chunk.length;
            }
        }

        showToast(`재번역 완료: ${successCount}건 성공${failCount > 0 ? `, ${failCount}건 실패` : ''}`, successCount > 0 ? 'success' : 'error');
        state.selectedIds.clear();
        if (state.isFindingEmpty) {
            window.dispatchEvent(new CustomEvent('lanovel:refresh-abnormal'));
        } else if (state.isCleanupQueue) {
            window.dispatchEvent(new CustomEvent('lanovel:refresh-cleanup'));
        } else {
            loadAndRenderGrouped();
        }
    } finally {
        if (dom.retranslateSelectedBtn) dom.retranslateSelectedBtn.disabled = false;
    }
}

function getTranslationsList(selectedOnly = false) {
    const list = [];
    const source = state.isFindingEmpty ? state.rawAbnormalData : (state.isCleanupQueue ? state.rawCleanupData : state.groupedTranslations);
    if (!source) return list;

    for (const folderName in source) {
        if (folderName.startsWith('_')) continue;
        const groups = source[folderName];
        if (!Array.isArray(groups)) continue;
        for (const grp of groups) {
            for (const item of (grp.items || [])) {
                if (!selectedOnly || state.selectedIds.has(item.id)) {
                    list.push({
                        ...item,
                        folderName: item.folderName || folderName,
                        title: item.title || grp.title || grp.url
                    });
                }
            }
        }
    }
    return list;
}

async function deleteSelectedTranslations() {
    if (state.selectedIds.size === 0 || !confirm(`정말로 ${state.selectedIds.size}개의 번역을 삭제하시겠습니까?`)) return;
    
    const idsToDelete = Array.from(state.selectedIds);
    await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToDelete }) });
    showToast(`${idsToDelete.length}개의 항목이 삭제되었습니다.`, 'success');
    state.selectedIds.clear();
    loadAndRenderGrouped();
}

async function moveSelectedTranslationsToFolder(event) {
    if (state.selectedIds.size === 0) return;
    const newFolderName = event.target.value;
    if (newFolderName === "") return;

    const idsToMove = Array.from(state.selectedIds);
    const folderForAPI = newFolderName === "__no_folder__" ? null : newFolderName;

    if (!confirm(`${idsToMove.length}개의 항목을 '${newFolderName}' 폴더로 이동하시겠습니까?`)) return;

    await fetch('/translations/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToMove, folder_name: folderForAPI }) });
    showToast(`${idsToMove.length}개의 항목이 이동되었습니다.`, 'success');
    state.selectedIds.clear();
    loadAndRenderGrouped();
}

async function renameFolder(oldName, newName) {
    try {
        const response = await fetch(`/api/folders/${encodeURIComponent(oldName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.detail || `Server error: ${response.status}`);
        }

        showToast(result.message, 'success');
        loadAndRenderGrouped(); // Reload data to show changes
    } catch (error) {
        console.error("Failed to rename folder:", error);
        showToast(`폴더 이름 변경 실패: ${error.message}`, 'error');
    }
}


export function refreshActiveView() {
    if (state.isFindingEmpty) {
        window.dispatchEvent(new CustomEvent('lanovel:refresh-abnormal'));
    } else if (state.isCleanupQueue) {
        window.dispatchEvent(new CustomEvent('lanovel:refresh-cleanup'));
    } else {
        loadAndRenderGrouped();
    }
}

export {
    loadAndRenderGrouped,
    updateStatistics,
    populateFolderDropdowns,
    renderGroupedHistory,
    renderUrlGroupContent,
    renderItem,
    handleCheckboxChange,
    handleHistoryClick,
    toggleApplyStatus,
    updateBulkActionPanel,
    deselectAll,
    copySelectedOriginals,
    excludeSelectedTranslations,
    retranslateSelectedTranslations,
    deleteSelectedTranslations,
    moveSelectedTranslationsToFolder,
    renameFolder,
    createFolder
};
