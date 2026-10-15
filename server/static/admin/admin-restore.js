/**
 * admin-restore.js
 * Restore Center modal, notification badges, trash recovery, abnormal whitelist, and cleanup queues.
 */

import { state, dom, escapeHtml, showToast, showCyberLoader, hideCyberLoader } from './admin-state.js';
import { renderGroupedHistory, loadAndRenderGrouped, updateBulkActionPanel } from './admin-tree.js';
import { closeRecommendPanel } from './admin-dock.js';

// Event listeners for cross-module decoupled refreshes
window.addEventListener('lanovel:refresh-abnormal', () => {
    loadAndRenderAbnormal();
});

window.addEventListener('lanovel:refresh-cleanup', () => {
    loadAndRenderCleanupQueue();
});

window.addEventListener('lanovel:refresh-notifications', () => {
    loadNotificationsAndBadge();
});

async function loadAndRenderAbnormal() {
    if (state.isLoading) return;
    state.isLoading = true;
    showToast('이상 번역 기록을 불러오는 중...', 'info');
    showCyberLoader();
    dom.historyContainer.innerHTML = '';
    state.selectedIds.clear();
    updateBulkActionPanel();

    try {
        const response = await fetch(`/translations/abnormal?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const abnormalData = await response.json();
        
        state.appliedUrlsSet = new Set(abnormalData._applied_urls || []);
        delete abnormalData._applied_urls;

        const catCounts = abnormalData._category_counts || { total: 0, partial_untranslated: 0, other_language: 0 };
        delete abnormalData._category_counts;

        state.rawAbnormalData = abnormalData;

        if (dom.filterAbnormalAll) dom.filterAbnormalAll.textContent = `전체 이상번역 (${catCounts.total || 0})`;
        if (dom.filterAbnormalPartial) dom.filterAbnormalPartial.textContent = `일부 번역 안 함 (${catCounts.partial_untranslated || 0})`;
        if (dom.filterAbnormalOther) dom.filterAbnormalOther.textContent = `다른 언어로 번역 (${catCounts.other_language || 0})`;

        renderGroupedHistory(abnormalData);

        const totalItems = catCounts.total || 0;
        if (totalItems === 0) {
            showToast("이상 번역 기록이 없습니다.", "info");
        }

    } catch (error) {
        console.error("Failed to load abnormal translations:", error);
        showToast("이상 번역 기록 로딩 실패.", "error");
    } finally {
        state.isLoading = false;
        await hideCyberLoader();
        updateBulkActionPanel();
    }
}

function setAbnormalFilter(filterType) {
    state.currentAbnormalFilter = filterType;
    [dom.filterAbnormalAll, dom.filterAbnormalPartial, dom.filterAbnormalOther].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    if (state.rawAbnormalData) {
        renderGroupedHistory(state.rawAbnormalData);
    }
}

function toggleFindEmpty() {
    state.isFindingEmpty = !state.isFindingEmpty;
    dom.findEmptyBtn.classList.toggle('active', state.isFindingEmpty);
    if (dom.searchBox) dom.searchBox.value = '';
    state.currentSearch = '';

    if (state.isFindingEmpty) {
        if (state.isCleanupQueue) {
            state.isCleanupQueue = false;
            dom.cleanupQueueBtn.classList.remove('active');
            dom.cleanupSectionBar.style.display = 'none';
        }
        dom.abnormalFilterBar.style.display = 'flex';
        loadAndRenderAbnormal();
    } else {
        dom.abnormalFilterBar.style.display = 'none';
        closeRecommendPanel();
        loadAndRenderGrouped();
    }
}

function toggleCleanupQueue() {
    state.isCleanupQueue = !state.isCleanupQueue;
    dom.cleanupQueueBtn.classList.toggle('active', state.isCleanupQueue);
    if (dom.searchBox) dom.searchBox.value = '';
    state.currentSearch = '';

    if (state.isCleanupQueue) {
        if (state.isFindingEmpty) {
            state.isFindingEmpty = false;
            dom.findEmptyBtn.classList.remove('active');
            dom.abnormalFilterBar.style.display = 'none';
            closeRecommendPanel();
        }
        dom.cleanupSectionBar.style.display = 'flex';
        loadAndRenderCleanupQueue();
    } else {
        dom.cleanupSectionBar.style.display = 'none';
        loadAndRenderGrouped();
    }
}

async function loadAndRenderCleanupQueue() {
    if (state.isLoading) return;
    state.isLoading = true;
    showToast('원문 복제·변형 정리 대기열을 불러오는 중...', 'info');
    showCyberLoader();
    dom.historyContainer.innerHTML = '';
    state.selectedIds.clear();
    updateBulkActionPanel();

    try {
        const response = await fetch(`/translations/cleanup_queue?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const cleanupData = await response.json();

        const summary = cleanupData._summary || { total: 0, verbatim_count: 0, paraphrased_count: 0, moved_count: 0 };
        delete cleanupData._summary;
        state.rawCleanupData = cleanupData;

        if (dom.cleanupSummaryText) {
            dom.cleanupSummaryText.textContent = `원문 그대로 반환 ${summary.verbatim_count || 0}건 / 원문 변형 ${summary.paraphrased_count || 0}건 / 이동된 항목 ${summary.moved_count || 0}건 (총 ${summary.total || 0}건)`;
        }

        renderGroupedHistory(cleanupData);

        if (summary.total === 0) {
            showToast("정리할 원문 복제·변형 기록이 없습니다.", "info");
        }

    } catch (error) {
        console.error("Failed to load cleanup queue:", error);
        showToast("원문 정리 대기열 로딩 실패.", "error");
    } finally {
        state.isLoading = false;
        await hideCyberLoader();
        updateBulkActionPanel();
    }
}

async function deleteSelectedCleanup() {
    if (state.selectedIds.size === 0) {
        showToast('삭제할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = state.selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 삭제하시겠습니까?\n\n(삭제된 항목은 휴지통에 보관되며 '알림 및 복원 센터'에서 언제든 되돌릴 수 있습니다.)`)) {
        return;
    }

    try {
        const response = await fetch('/translations/cleanup_queue/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(state.selectedIds) })
        });
        if (!response.ok) throw new Error('삭제 요청 실패');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 삭제되었습니다.`, 'success');
        state.selectedIds.clear();
        loadAndRenderCleanupQueue();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('정리 삭제 실패:', err);
        showToast('삭제 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function deleteAllCleanup() {
    if (!confirm('정리 대기열의 모든 항목을 일괄 삭제하시겠습니까?\n\n(삭제된 모든 항목은 휴지통에 보관되며 알림 및 복원 센터에서 회차별 확인 및 복원이 가능합니다.)')) {
        return;
    }

    try {
        const response = await fetch('/translations/cleanup_queue/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all_queue: true })
        });
        if (!response.ok) throw new Error('전체 삭제 요청 실패');
        const res = await response.json();
        showToast(res.message || '정리 대기열 전체가 삭제되었습니다.', 'success');
        state.selectedIds.clear();
        loadAndRenderCleanupQueue();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('대기열 전체 삭제 실패:', err);
        showToast('대기열 삭제 중 오류가 발생했습니다.', 'error');
    }
}

async function moveToCleanupQueueSelected() {
    if (state.selectedIds.size === 0) {
        showToast('원문 정리 섹션으로 이동할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = state.selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 [원문 복제·변형 정리] 섹션(삭제 대기열)으로 이동하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch('/translations/move_to_cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(state.selectedIds) })
        });
        if (!response.ok) throw new Error('이동 실패');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 원문 정리 섹션으로 이동되었습니다.`, 'success');
        state.selectedIds.clear();
        loadAndRenderAbnormal();
    } catch (err) {
        console.error('원문 정리 섹션 이동 실패:', err);
        showToast('이동 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function whitelistSelectedAbnormal() {
    if (state.selectedIds.size === 0) {
        showToast('이상번역 검사에서 제외할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = state.selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 이상번역 검사에서 제외하시겠습니까?\n(의도적으로 외국어(일본어/영어/스페인어 등)를 남겨둔 문장으로 처리되며, 복원 센터의 [이상번역 예외 목록] 탭에서 언제든지 다시 포함할 수 있습니다.)`)) {
        return;
    }

    try {
        const response = await fetch('/translations/abnormal_whitelist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(state.selectedIds) })
        });
        if (!response.ok) throw new Error('서버 응답 오류');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 이상번역 검사에서 제외되었습니다.`, 'success');
        state.selectedIds.clear();
        loadAndRenderAbnormal();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('이상번역 제외 실패:', err);
        showToast(`이상번역 제외 실패: ${err.message}`, 'error');
    }
}

async function loadNotificationsAndBadge() {
    try {
        const [notifsRes, trashRes, whitelistRes] = await Promise.all([
            fetch(`/cleanup/notifications?t=${Date.now()}`),
            fetch(`/translations/trash?t=${Date.now()}`),
            fetch(`/translations/abnormal_whitelist?t=${Date.now()}`)
        ]);

        if (notifsRes.ok) {
            const data = await notifsRes.json();
            const activeCount = (data.active_notifications || []).length;
            if (dom.notifBadge) {
                dom.notifBadge.textContent = activeCount;
                dom.notifBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
            }
            if (dom.modalNotifBadge) {
                dom.modalNotifBadge.textContent = activeCount;
            }
        }

        if (trashRes.ok) {
            const trashData = await trashRes.json();
            const trashCount = (trashData.trash || []).length;
            if (dom.modalTrashBadge) {
                dom.modalTrashBadge.textContent = trashCount;
            }
        }

        if (whitelistRes && whitelistRes.ok) {
            const wlData = await whitelistRes.json();
            const wlCount = (wlData.whitelist || []).length;
            if (dom.modalWhitelistBadge) {
                dom.modalWhitelistBadge.textContent = wlCount;
            }
        }
    } catch (err) {
        console.warn('알림 및 휴지통 뱃지 로딩 실패:', err);
    }
}

function openRestoreCenterModal(defaultTab = 'notifications') {
    if (!dom.cleanupRestoreModal) return;
    dom.cleanupRestoreModal.style.display = 'flex';
    switchRestoreTab(defaultTab);
    startModalAutoRefresh();
}

function closeRestoreCenterModal() {
    if (!dom.cleanupRestoreModal) return;
    dom.cleanupRestoreModal.style.display = 'none';
    stopModalAutoRefresh();
}

function startModalAutoRefresh() {
    stopModalAutoRefresh();
    state.modalAutoRefreshTimer = setInterval(() => {
        if (!dom.cleanupRestoreModal || dom.cleanupRestoreModal.style.display === 'none') {
            stopModalAutoRefresh();
            return;
        }
        if (state.currentRestoreTab === 'notifications') {
            loadAndRenderNotifications(true);
        }
    }, 4000);
}

function stopModalAutoRefresh() {
    if (state.modalAutoRefreshTimer) {
        clearInterval(state.modalAutoRefreshTimer);
        state.modalAutoRefreshTimer = null;
    }
}

function refreshRestoreCenterIfVisible() {
    if (dom.cleanupRestoreModal && dom.cleanupRestoreModal.style.display !== 'none') {
        if (state.currentRestoreTab === 'notifications') {
            loadAndRenderNotifications(true);
        }
    }
}

async function updateGlobalNotifBadge() {
    try {
        const res = await fetch(`/cleanup/notifications?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const activeCount = (data.active_notifications || []).length;
        if (dom.modalNotifBadge) dom.modalNotifBadge.textContent = activeCount;
        if (dom.notifBadge) {
            dom.notifBadge.textContent = activeCount;
            dom.notifBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) {
        // silent fail
    }
}

function switchRestoreTab(tab) {
    state.currentRestoreTab = tab;
    if (tab === 'notifications') {
        if (dom.tabBtnNotifications) dom.tabBtnNotifications.classList.add('active');
        if (dom.tabBtnTrash) dom.tabBtnTrash.classList.remove('active');
        if (dom.tabBtnAbnormalWhitelist) dom.tabBtnAbnormalWhitelist.classList.remove('active');
        if (dom.tabContentNotifications) dom.tabContentNotifications.style.display = 'block';
        if (dom.tabContentTrash) dom.tabContentTrash.style.display = 'none';
        if (dom.tabContentAbnormalWhitelist) dom.tabContentAbnormalWhitelist.style.display = 'none';
        loadAndRenderNotifications(false);
        startModalAutoRefresh();
    } else if (tab === 'trash') {
        stopModalAutoRefresh();
        if (dom.tabBtnNotifications) dom.tabBtnNotifications.classList.remove('active');
        if (dom.tabBtnTrash) dom.tabBtnTrash.classList.add('active');
        if (dom.tabBtnAbnormalWhitelist) dom.tabBtnAbnormalWhitelist.classList.remove('active');
        if (dom.tabContentNotifications) dom.tabContentNotifications.style.display = 'none';
        if (dom.tabContentTrash) dom.tabContentTrash.style.display = 'block';
        if (dom.tabContentAbnormalWhitelist) dom.tabContentAbnormalWhitelist.style.display = 'none';
        loadAndRenderTrash();
    } else if (tab === 'whitelist') {
        stopModalAutoRefresh();
        if (dom.tabBtnNotifications) dom.tabBtnNotifications.classList.remove('active');
        if (dom.tabBtnTrash) dom.tabBtnTrash.classList.remove('active');
        if (dom.tabBtnAbnormalWhitelist) dom.tabBtnAbnormalWhitelist.classList.add('active');
        if (dom.tabContentNotifications) dom.tabContentNotifications.style.display = 'none';
        if (dom.tabContentTrash) dom.tabContentTrash.style.display = 'none';
        if (dom.tabContentAbnormalWhitelist) dom.tabContentAbnormalWhitelist.style.display = 'block';
        loadAndRenderAbnormalWhitelist();
    }
}

async function loadAndRenderNotifications(silent = false) {
    if (!dom.notificationsTableBody) return;
    if (!silent) {
        dom.notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">알림 불러오는 중...</td></tr>';
    }

    try {
        const res = await fetch(`/cleanup/notifications?t=${Date.now()}`);
        if (!res.ok) throw new Error('알림 조회 실패');
        const data = await res.json();
        const activeList = data.active_notifications || [];
        const dismissedList = data.recent_dismissed || [];

        if (dom.modalNotifBadge) dom.modalNotifBadge.textContent = activeList.length;
        if (dom.notifBadge) {
            dom.notifBadge.textContent = activeList.length;
            dom.notifBadge.style.display = activeList.length > 0 ? 'inline-flex' : 'none';
        }

        if (activeList.length === 0) {
            dom.notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">활성화된 삭제 알림이 없습니다.</td></tr>';
        } else {
            dom.notificationsTableBody.innerHTML = activeList.map(n => {
                const baseCleanUrl = (n.url || '').split('#')[0];
                const reviewUrl = `${baseCleanUrl}#lanovel_review=${encodeURIComponent(n.batch_id || n.id)}`;
                return `
                <tr>
                    <td style="font-weight: 500;">${escapeHtml(n.novel_title || '미분류')}</td>
                    <td>${escapeHtml(n.episode_title || n.url)}</td>
                    <td style="text-align: center;"><span style="color: var(--danger-color); font-weight: 600;">${n.deleted_count}건</span></td>
                    <td>
                        <a href="${escapeHtml(reviewUrl)}" target="_blank" class="btn btn-sm btn-primary" style="text-decoration: none;">🔍 검수 회차 열기 ↗</a>
                    </td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-outline dismiss-notif-btn" data-id="${n.id}">해제</button>
                    </td>
                </tr>
            `;
            }).join('');
        }

        if (dom.dismissedNotifsCount) dom.dismissedNotifsCount.textContent = dismissedList.length;
        if (dom.dismissedTableBody) {
            if (dismissedList.length === 0) {
                dom.dismissedTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 16px;">최근 7일간 해제된 이력이 없습니다.</td></tr>';
            } else {
                dom.dismissedTableBody.innerHTML = dismissedList.map(d => {
                    const dismissedDate = d.dismissed_at ? new Date(d.dismissed_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                    const baseCleanUrl = (d.url || '').split('#')[0];
                    const reviewUrl = `${baseCleanUrl}#lanovel_review=${encodeURIComponent(d.batch_id || d.id)}`;
                    return `
                        <tr>
                            <td>${escapeHtml(d.novel_title || '미분류')}</td>
                            <td>${escapeHtml(d.episode_title || d.url)}</td>
                            <td>${d.deleted_count}건</td>
                            <td>${dismissedDate}</td>
                            <td><a href="${escapeHtml(reviewUrl)}" target="_blank" style="color: var(--primary-color);">열기 ↗</a></td>
                        </tr>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        console.error('알림 로딩 실패:', err);
        if (!silent) {
            dom.notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 20px;">알림 로딩 실패</td></tr>';
        }
    }
}

// 브라우저 창 포커스 또는 가시성 변경 시 알림 및 뱃지 자동 동기화
window.addEventListener('focus', () => {
    refreshRestoreCenterIfVisible();
    updateGlobalNotifBadge();
});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        refreshRestoreCenterIfVisible();
        updateGlobalNotifBadge();
    }
});

async function dismissNotification(id) {
    try {
        const res = await fetch(`/cleanup/notifications/${id}/dismiss`, { method: 'POST' });
        if (!res.ok) throw new Error('해제 실패');
        showToast('삭제 알림이 해제되었습니다. (7일간 보존 이력에 보관됩니다)', 'info');
        loadAndRenderNotifications();
    } catch (err) {
        console.error('알림 해제 실패:', err);
        showToast('알림 해제 중 오류가 발생했습니다.', 'error');
    }
}

async function dismissAllNotifications() {
    if (!confirm('모든 삭제 알림을 해제하시겠습니까?')) return;
    try {
        const res = await fetch('/cleanup/notifications/dismiss_all', { method: 'POST' });
        if (!res.ok) throw new Error('전체 해제 실패');
        showToast('모든 알림이 해제되었습니다.', 'info');
        loadAndRenderNotifications();
    } catch (err) {
        console.error('전체 해제 실패:', err);
        showToast('알림 전체 해제 중 오류가 발생했습니다.', 'error');
    }
}

function toggleDismissedHistoryView() {
    if (!dom.dismissedHistoryContainer) return;
    const isHidden = dom.dismissedHistoryContainer.style.display === 'none';
    dom.dismissedHistoryContainer.style.display = isHidden ? 'block' : 'none';
    const icon = document.getElementById('dismissedToggleIcon');
    if (icon) icon.textContent = isHidden ? '▼' : '▶';
}

async function loadAndRenderTrash() {
    if (!dom.trashTableBody) return;
    dom.trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">휴지통 목록 불러오는 중...</td></tr>';

    try {
        const res = await fetch(`/translations/trash?t=${Date.now()}`);
        if (!res.ok) throw new Error('휴지통 조회 실패');
        const data = await res.json();
        const trashList = data.trash || [];

        if (dom.modalTrashBadge) dom.modalTrashBadge.textContent = trashList.length;

        if (trashList.length === 0) {
            dom.trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">휴지통이 비어 있습니다. (7일 경과 항목은 자동 영구 정리됩니다)</td></tr>';
            return;
        }

        dom.trashTableBody.innerHTML = trashList.map(item => {
            const delDate = item.deleted_at ? new Date(item.deleted_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
            let catBadge = '';
            if (item.reason_category === 'verbatim_or_empty' || item.reason_category === 'verbatim') {
                catBadge = '<span class="category-badge badge-verbatim">원문 그대로</span>';
            } else if (item.reason_category === 'paraphrased_jp' || item.reason_category === 'paraphrased_zh' || item.reason_category === 'paraphrased') {
                catBadge = '<span class="category-badge badge-paraphrased">원문 변형</span>';
            } else {
                catBadge = '<span class="category-badge badge-moved">다른 언어</span>';
            }

            return `
                <tr>
                    <td style="font-size: 12px;">
                        <div><strong>${escapeHtml(item.folderName || '미분류')}</strong></div>
                        <div style="color: var(--text-muted);">${escapeHtml(item.title || item.url)}</div>
                    </td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.original)}</div></td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.translated || '(없음)')}</div></td>
                    <td>${catBadge}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${delDate}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-primary restore-trash-btn" data-id="${item.id}">복원</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('휴지통 로딩 실패:', err);
        dom.trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 20px;">휴지통 로딩 실패</td></tr>';
    }
}

async function restoreTrashItem(trashId) {
    try {
        const res = await fetch('/translations/trash/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trash_ids: [trashId] })
        });
        if (!res.ok) throw new Error('복원 실패');
        const data = await res.json();
        showToast(data.message || '항목이 원래 번역 목록으로 복원되었습니다.', 'success');
        loadAndRenderTrash();
        loadNotificationsAndBadge();
        if (!state.isFindingEmpty && !state.isCleanupQueue) {
            loadAndRenderGrouped();
        } else if (state.isCleanupQueue) {
            loadAndRenderCleanupQueue();
        }
    } catch (err) {
        console.error('복원 실패:', err);
        showToast('복원 중 오류가 발생했습니다.', 'error');
    }
}

async function restoreAllTrash() {
    if (!confirm('휴지통의 모든 항목을 일괄 복원하시겠습니까?')) return;
    try {
        const res = await fetch('/translations/trash/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all_trash: true })
        });
        if (!res.ok) throw new Error('전체 복원 실패');
        const data = await res.json();
        showToast(data.message || '모든 항목이 복원되었습니다.', 'success');
        loadAndRenderTrash();
        loadNotificationsAndBadge();
        if (!state.isFindingEmpty && !state.isCleanupQueue) {
            loadAndRenderGrouped();
        } else if (state.isCleanupQueue) {
            loadAndRenderCleanupQueue();
        }
    } catch (err) {
        console.error('휴지통 전체 복원 실패:', err);
        showToast('전체 복원 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function loadAndRenderAbnormalWhitelist() {
    if (!dom.whitelistTableBody) return;
    dom.whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">예외 목록 불러오는 중...</td></tr>';

    try {
        const res = await fetch(`/translations/abnormal_whitelist?t=${Date.now()}`);
        if (!res.ok) throw new Error('예외 목록 조회 실패');
        const data = await res.json();
        const wlList = data.whitelist || [];

        if (dom.modalWhitelistBadge) dom.modalWhitelistBadge.textContent = wlList.length;

        if (wlList.length === 0) {
            dom.whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">이상번역에서 제외된 단락이 없습니다.</td></tr>';
            return;
        }

        dom.whitelistTableBody.innerHTML = wlList.map(item => {
            const dateStr = item.created_at ? new Date(item.created_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
            return `
                <tr>
                    <td style="font-size: 12px;">
                        <div><strong>${escapeHtml(item.folderName || '미분류')}</strong></div>
                        <div style="color: var(--text-muted);">${escapeHtml(item.title || item.url || '')}</div>
                    </td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.original)}</div></td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.translated || '(없음)')}</div></td>
                    <td style="font-size: 12px; color: var(--text-muted);">${dateStr}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-outline remove-whitelist-btn" data-id="${item.translation_id}">해제</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('예외 목록 로딩 실패:', err);
        dom.whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 20px;">예외 목록 로딩 실패</td></tr>';
    }
}

async function removeSingleWhitelist(translationId) {
    try {
        const res = await fetch('/translations/abnormal_whitelist/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [translationId] })
        });
        if (!res.ok) throw new Error('해제 실패');
        const data = await res.json();
        showToast(data.message || '이상번역 제외가 해제되었습니다.', 'success');
        loadAndRenderAbnormalWhitelist();
        loadNotificationsAndBadge();
        if (state.isFindingEmpty) {
            loadAndRenderAbnormal();
        }
    } catch (err) {
        console.error('예외 해제 실패:', err);
        showToast('예외 해제 중 오류가 발생했습니다.', 'error');
    }
}

async function clearAllAbnormalWhitelist() {
    if (!confirm('등록된 모든 이상번역 예외 항목을 일괄 해제하시겠습니까?\n해제 시 다시 이상번역 찾기 검사 대상에 포함됩니다.')) return;
    try {
        const res = await fetch('/translations/abnormal_whitelist/clear', {
            method: 'POST'
        });
        if (!res.ok) throw new Error('전체 해제 실패');
        const data = await res.json();
        showToast(data.message || '모든 이상번역 예외 항목이 해제되었습니다.', 'success');
        loadAndRenderAbnormalWhitelist();
        loadNotificationsAndBadge();
        if (state.isFindingEmpty) {
            loadAndRenderAbnormal();
        }
    } catch (err) {
        console.error('전체 예외 해제 실패:', err);
        showToast('전체 예외 해제 중 오류가 발생했습니다.', 'error');
    }
}


export {
    loadAndRenderAbnormal,
    setAbnormalFilter,
    toggleFindEmpty,
    toggleCleanupQueue,
    loadAndRenderCleanupQueue,
    deleteSelectedCleanup,
    deleteAllCleanup,
    moveToCleanupQueueSelected,
    whitelistSelectedAbnormal,
    loadNotificationsAndBadge,
    openRestoreCenterModal,
    closeRestoreCenterModal,
    startModalAutoRefresh,
    stopModalAutoRefresh,
    refreshRestoreCenterIfVisible,
    updateGlobalNotifBadge,
    switchRestoreTab,
    loadAndRenderNotifications,
    dismissNotification,
    dismissAllNotifications,
    toggleDismissedHistoryView,
    loadAndRenderTrash,
    restoreTrashItem,
    restoreAllTrash,
    loadAndRenderAbnormalWhitelist,
    removeSingleWhitelist,
    clearAllAbnormalWhitelist
};
