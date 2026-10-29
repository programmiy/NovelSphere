/**
 * admin-drawer.js
 * Unclassified novels side drawer & Android APK Release management modal.
 */

import { state, dom, escapeHtml, showToast, unclassifiedParagraphsMap } from './admin-state.js';
import { handleTranslatedFocus } from './admin-dock.js';
import { renderItem, handleHistoryClick, handleCheckboxChange, loadAndRenderGrouped } from './admin-tree.js';

let selectedApkFile = null;

// Listen for refresh events
window.addEventListener('lanovel:check-unclassified', () => {
    checkAndLoadUnclassifiedNovels();
});

function initAppReleaseModal() {
    const openBtn = document.getElementById('openAppReleaseModalBtn');
    const modal = document.getElementById('appReleaseModal');
    const closeBtn = document.getElementById('closeAppReleaseModalBtn');
    const closeBottomBtn = document.getElementById('closeAppReleaseModalBottomBtn');
    const saveNotesBtn = document.getElementById('saveAppReleaseNotesBtn');
    const bumpVersionBtn = document.getElementById('bumpAppVersionBtn');
    const dropzone = document.getElementById('apkDropzone');
    const dropzoneInner = document.getElementById('apkDropzoneInner');
    const fileInput = document.getElementById('apkFileInput');
    const uploadBtn = document.getElementById('uploadApkBtn');

    if (!openBtn || !modal) return;

    // 모달 열기
    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        fetchAppReleaseInfo();
    });

    // 모달 닫기
    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // 릴리즈 노트 저장
    if (saveNotesBtn) {
        saveNotesBtn.addEventListener('click', async () => {
            const notesInput = document.getElementById('appReleaseNotesInput');
            const notes = notesInput ? notesInput.value.trim() : '';
            saveNotesBtn.disabled = true;
            saveNotesBtn.textContent = '저장 중...';

            try {
                const res = await fetch('/api/app/release_notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ release_notes: notes })
                });
                if (!res.ok) throw new Error(`릴리즈 노트 저장 실패: ${res.statusText}`);
                showToast('릴리즈 노트가 성공적으로 저장되었습니다.', 'success');
            } catch (err) {
                console.error(err);
                showToast('릴리즈 노트 저장 중 오류가 발생했습니다.', 'error');
            } finally {
                saveNotesBtn.disabled = false;
                saveNotesBtn.textContent = '릴리즈 노트 저장';
            }
        });
    }

    // 버전 및 빌드번호 범프
    if (bumpVersionBtn) {
        bumpVersionBtn.addEventListener('click', async () => {
            const verInput = document.getElementById('appVersionInput');
            const buildInput = document.getElementById('appBuildInput');
            const newVer = verInput ? verInput.value.trim() : null;
            const newBuild = buildInput ? (parseInt(buildInput.value.trim(), 10) + 1) : null;

            bumpVersionBtn.disabled = true;
            bumpVersionBtn.innerHTML = '<span class="material-icons" style="font-size: 15px;">hourglass_top</span> 처리 중...';

            try {
                const res = await fetch('/api/app/bump_version', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ version: newVer, build_number: newBuild })
                });
                if (!res.ok) throw new Error(`버전 갱신 실패: ${res.statusText}`);
                const data = await res.json();
                showToast(`버전이 v${data.version} (Build #${data.build_number})로 갱신되었습니다.`, 'success');
                fetchAppReleaseInfo();
            } catch (err) {
                console.error(err);
                showToast('버전 갱신 중 오류가 발생했습니다.', 'error');
            } finally {
                bumpVersionBtn.disabled = false;
                bumpVersionBtn.innerHTML = '<span class="material-icons" style="font-size: 15px;">trending_up</span> +1 빌드 올리기';
            }
        });
    }

    // APK 파일 선택 및 드래그 앤 드롭
    if (dropzoneInner && fileInput) {
        dropzoneInner.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleSelectedApkFile(e.target.files[0]);
            }
        });
    }

    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSelectedApkFile(e.dataTransfer.files[0]);
            }
        });
    }

    // 새 APK 업로드 시작
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            if (!selectedApkFile) return;

            uploadBtn.disabled = true;
            const statusText = document.getElementById('apkUploadStatusText');
            const progressWrap = document.getElementById('apkUploadProgressBarWrap');
            const progressBar = document.getElementById('apkUploadProgressBar');

            if (statusText) statusText.textContent = '업로드 스트리밍 전송 중...';
            if (progressWrap) progressWrap.style.display = 'block';
            if (progressBar) progressBar.style.width = '60%';

            try {
                const res = await fetch('/api/app/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: selectedApkFile
                });

                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.detail || `업로드 실패: ${res.statusText}`);
                }

                if (progressBar) progressBar.style.width = '100%';
                if (statusText) statusText.textContent = '업로드 완료 및 배포 적용 성공!';
                showToast('APK 바이너리가 성공적으로 업로드 및 배포되었습니다!', 'success');
                selectedApkFile = null;
                setTimeout(() => {
                    if (progressWrap) progressWrap.style.display = 'none';
                    if (progressBar) progressBar.style.width = '0%';
                    fetchAppReleaseInfo();
                }, 1000);
            } catch (err) {
                console.error(err);
                if (statusText) statusText.textContent = `업로드 실패: ${err.message}`;
                showToast(`업로드 실패: ${err.message}`, 'error');
            } finally {
                uploadBtn.disabled = true;
            }
        });
    }
}

function handleSelectedApkFile(file) {
    if (!file.name.toLowerCase().endsWith('.apk')) {
        showToast('.apk 파일만 업로드할 수 있습니다.', 'error');
        return;
    }

    selectedApkFile = file;
    const fileInfo = document.getElementById('selectedApkFileInfo');
    const uploadBtn = document.getElementById('uploadApkBtn');
    const statusText = document.getElementById('apkUploadStatusText');

    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    if (fileInfo) {
        fileInfo.textContent = `선택됨: ${file.name} (${sizeMb} MB)`;
    }
    if (statusText) {
        statusText.textContent = `업로드 준비 완료 (${sizeMb} MB)`;
    }
    if (uploadBtn) {
        uploadBtn.disabled = false;
    }
}

async function fetchAppReleaseInfo() {
    try {
        const res = await fetch('/api/app/version');
        if (!res.ok) throw new Error('앱 버전 정보를 가져오지 못했습니다.');

        const data = await res.json();

        const verBadge = document.getElementById('appCurrentVersionBadge');
        if (verBadge) verBadge.textContent = `v${data.version}`;

        const buildBadge = document.getElementById('appCurrentBuildBadge');
        if (buildBadge) buildBadge.textContent = `Build #${data.build_number}`;

        const statusBadge = document.getElementById('appApkStatusBadge');
        if (statusBadge) {
            if (data.has_apk) {
                statusBadge.textContent = 'APK 배포 완료';
                statusBadge.classList.remove('not-found');
            } else {
                statusBadge.textContent = 'APK 미등록 (빌드 필요)';
                statusBadge.classList.add('not-found');
            }
        }

        const fileNameEl = document.getElementById('appReleaseFileName');
        if (fileNameEl) fileNameEl.textContent = data.file_name;

        const fileSizeEl = document.getElementById('appReleaseFileSize');
        if (fileSizeEl) {
            const mb = (data.file_size / (1024 * 1024)).toFixed(1);
            fileSizeEl.textContent = `${mb} MB (${data.file_size.toLocaleString()} bytes)`;
        }

        const updatedAtEl = document.getElementById('appReleaseUpdatedAt');
        if (updatedAtEl) {
            if (data.updated_at) {
                const date = new Date(data.updated_at * 1000);
                updatedAtEl.textContent = date.toLocaleString();
            } else {
                updatedAtEl.textContent = '-';
            }
        }

        const verInput = document.getElementById('appVersionInput');
        if (verInput) verInput.value = data.base_version || '1.0.0';

        const buildInput = document.getElementById('appBuildInput');
        if (buildInput) buildInput.value = data.build_number || 1;

        const notesInput = document.getElementById('appReleaseNotesInput');
        if (notesInput) notesInput.value = data.release_notes || '';

    } catch (err) {
        console.error("앱 릴리즈 정보 조회 오류:", err);
    }
}

// =========================================================================
// Unclassified Novels Drawer & Floating Toggle Handle (content.js style)
// =========================================================================

let unclassifiedData = null;
let currentSelectedUnclassifiedNovel = null;

function initUnclassifiedDrawer() {
    const toggleBar = document.getElementById('unclassifiedToggleBar');
    const hudBtn = document.getElementById('openUnclassifiedDrawerBtn');
    const closeBtn = document.getElementById('closeUnclassifiedDrawerBtn');
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const refreshBtn = document.getElementById('refreshUnclassifiedBtn');
    const searchInput = document.getElementById('unclassifiedNovelSearchInput');
    const epListContainer = document.getElementById('unclassifiedEpisodeListContainer');

    if (toggleBar) toggleBar.addEventListener('click', toggleUnclassifiedDrawer);
    if (hudBtn) hudBtn.addEventListener('click', toggleUnclassifiedDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeUnclassifiedDrawer);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'unclassifiedDrawerOverlay') {
                closeUnclassifiedDrawer();
            }
        });
    }

    // Escape 키로 드로어 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const currentOverlay = document.getElementById('unclassifiedDrawerOverlay');
            if (currentOverlay && (currentOverlay.classList.contains('active') || currentOverlay.style.display === 'block')) {
                closeUnclassifiedDrawer();
            }
        }
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await checkAndLoadUnclassifiedNovels();
            showToast('미분류 소설 목록을 새로고침했습니다.', 'info');
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderUnclassifiedNovelList();
        });
    }

    // Attach delegated handlers to episode list container for full paragraph table interactivity
    if (epListContainer) {
        epListContainer.addEventListener('click', handleHistoryClick);
        epListContainer.addEventListener('change', handleCheckboxChange);
        epListContainer.addEventListener('focusin', (e) => {
            if (e.target.classList.contains('translated-text')) {
                handleTranslatedFocus(e.target);
            }
        });
    }

    // Toolbar Action Listeners
    const smartMergeBtn = document.getElementById('smartMergeBtn');
    if (smartMergeBtn) {
        smartMergeBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel || !currentSelectedUnclassifiedNovel.matched_existing_folder) return;
            const novel = currentSelectedUnclassifiedNovel;
            const target = novel.matched_existing_folder;
            if (!confirm(`'${novel.novel_title}'의 모든 회차(${novel.total_episodes}개, ${novel.total_paragraphs.toLocaleString()}개 단락)를 기존 폴더 '${target}'(으)로 일괄 합치시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, target, novel.work_url);
        });
    }

    const assignNewFolderBtn = document.getElementById('assignNewFolderBtn');
    if (assignNewFolderBtn) {
        assignNewFolderBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const input = document.getElementById('assignNewFolderNameInput');
            const folderName = input ? input.value.trim() : '';
            if (!folderName) {
                showToast('등록할 새 폴더명을 입력해주세요.', 'warning');
                return;
            }
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`'${novel.novel_title}'의 모든 회차를 새 폴더 '${folderName}'(으)로 일괄 등록하시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, folderName, novel.work_url);
        });
    }

    const assignExistingFolderBtn = document.getElementById('assignExistingFolderBtn');
    if (assignExistingFolderBtn) {
        assignExistingFolderBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const select = document.getElementById('assignExistingFolderDropdown');
            const folderName = select ? select.value : '';
            if (!folderName) {
                showToast('이동할 기존 폴더를 선택해주세요.', 'warning');
                return;
            }
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`'${novel.novel_title}'의 모든 회차를 기존 폴더 '${folderName}'(으)로 이동하시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, folderName, novel.work_url);
        });
    }

    const deleteNovelBtn = document.getElementById('deleteUnclassifiedNovelBtn');
    if (deleteNovelBtn) {
        deleteNovelBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`정말로 '${novel.novel_title}'의 모든 미분류 번역(${novel.total_paragraphs.toLocaleString()}개 단락)을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            try {
                const res = await fetch('/api/unclassified_novels/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ work_id: novel.work_id, work_url: novel.work_url })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || '삭제 실패');
                }
                const data = await res.json();
                showToast(data.message || '소설이 성공적으로 삭제되었습니다.', 'success');
                currentSelectedUnclassifiedNovel = null;
                await checkAndLoadUnclassifiedNovels();
                await loadAndRenderGrouped();
            } catch (e) {
                console.error('delete unclassified novel error:', e);
                showToast(`삭제 오류: ${e.message}`, 'error');
            }
        });
    }

    const editTitleBtn = document.getElementById('editNovelTitleBtn');
    if (editTitleBtn) {
        editTitleBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const novel = currentSelectedUnclassifiedNovel;
            const newTitle = prompt('수정할 소설 원제(제목)를 입력하세요:', novel.novel_title);
            if (!newTitle || !newTitle.trim() || newTitle.trim() === novel.novel_title) return;
            
            try {
                const res = await fetch('/api/unclassified_novels/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ work_id: novel.work_id, new_title: newTitle.trim() })
                });
                if (!res.ok) throw new Error('제목 수정 실패');
                showToast('소설 제목이 수정되었습니다.', 'success');
                novel.novel_title = newTitle.trim();
                document.getElementById('detailNovelTitle').textContent = novel.novel_title;
                const newFolderInput = document.getElementById('assignNewFolderNameInput');
                if (newFolderInput) newFolderInput.value = novel.novel_title;
                renderUnclassifiedNovelList();
            } catch (e) {
                showToast(`수정 오류: ${e.message}`, 'error');
            }
        });
    }
}

async function checkAndLoadUnclassifiedNovels() {
    try {
        const res = await fetch(`/api/unclassified_novels?t=${Date.now()}`);
        if (!res.ok) return;
        unclassifiedData = await res.json();

        // 미분류 데이터 변동 시 상단 오늘 번역 실적 및 쿼터 현황도 최신화
        try {
            const summaryRes = await fetch(`/api/notifications/summary?t=${Date.now()}`);
            if (summaryRes.ok) {
                state.latestQuotaSummary = await summaryRes.json();
                window.dispatchEvent(new CustomEvent('lanovel:update-stats'));
            }
        } catch (e) {
            // silent
        }
        
        const toggleBar = document.getElementById('unclassifiedToggleBar');
        const badge = document.getElementById('unclassifiedToggleBadge');
        const headerBadge = document.getElementById('unclassifiedHeaderStatsBadge');
        const hudBadge = document.getElementById('unclassifiedHudBadge');
        
        const totalParas = unclassifiedData.total_unclassified_paragraphs || 0;
        const totalNovels = unclassifiedData.total_unclassified_novels || 0;
        
        // 미분류 데이터가 존재할 때 우측 플로팅 토글바 및 상단 HUD 배지 표시
        if (totalParas > 0) {
            if (toggleBar) toggleBar.style.display = 'flex';
            if (badge) badge.textContent = totalParas.toLocaleString();
            if (headerBadge) headerBadge.textContent = `${totalNovels}개 작품 / ${totalParas.toLocaleString()}개 문장`;
            if (hudBadge) {
                hudBadge.textContent = totalNovels.toLocaleString();
                hudBadge.style.display = 'inline-block';
                hudBadge.title = `${totalNovels}개 작품 (${totalParas.toLocaleString()}개 문장)`;
            }
        } else {
            if (toggleBar) toggleBar.style.display = 'none';
            if (headerBadge) headerBadge.textContent = `0개 작품 / 0개 문장`;
            if (hudBadge) hudBadge.style.display = 'none';
            closeUnclassifiedDrawer();
        }

        // 드로어가 열려있는 상태라면 목록 갱신
        const overlay = document.getElementById('unclassifiedDrawerOverlay');
        if (overlay && overlay.classList.contains('active')) {
            renderUnclassifiedNovelList();
            if (currentSelectedUnclassifiedNovel) {
                const refreshed = (unclassifiedData.novels || []).find(n => n.work_id === currentSelectedUnclassifiedNovel.work_id);
                if (refreshed) {
                    selectUnclassifiedNovel(refreshed);
                } else {
                    currentSelectedUnclassifiedNovel = null;
                    const content = document.getElementById('unclassifiedDetailContent');
                    const emptyNotice = document.getElementById('unclassifiedDetailEmptyNotice');
                    if (content) content.style.display = 'none';
                    if (emptyNotice) emptyNotice.style.display = 'block';
                }
            }
        }
    } catch (e) {
        console.warn("[UnclassifiedNovels] Failed to check unclassified novels:", e);
    }
}

function toggleUnclassifiedDrawer() {
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const isOpen = overlay && (overlay.classList.contains('active') || overlay.style.display === 'block');
    if (isOpen) {
        closeUnclassifiedDrawer();
    } else {
        openUnclassifiedDrawer();
    }
}

function openUnclassifiedDrawer() {
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const panel = document.getElementById('unclassifiedDrawerPanel');
    const toggleBar = document.getElementById('unclassifiedToggleBar');
    const hudBtn = document.getElementById('openUnclassifiedDrawerBtn');
    const arrow = toggleBar ? toggleBar.querySelector('.unclassified-toggle-arrow') : null;

    if (overlay && panel) {
        overlay.style.display = 'block';
        void overlay.offsetWidth; // Force layout
        overlay.classList.add('active');
        panel.classList.add('active');

        if (toggleBar) {
            toggleBar.classList.add('drawer-open');
            toggleBar.title = '미분류 소설 보관함 닫기';
            if (arrow) arrow.textContent = 'chevron_right';
        }
        if (hudBtn) {
            hudBtn.classList.add('active');
        }
        if (window.soundFX) window.soundFX.playModalOpen();
        renderUnclassifiedNovelList();
    }
}

function closeUnclassifiedDrawer() {
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const panel = document.getElementById('unclassifiedDrawerPanel');
    const toggleBar = document.getElementById('unclassifiedToggleBar');
    const hudBtn = document.getElementById('openUnclassifiedDrawerBtn');
    const arrow = toggleBar ? toggleBar.querySelector('.unclassified-toggle-arrow') : null;

    if (overlay && panel) {
        overlay.classList.remove('active');
        panel.classList.remove('active');

        if (toggleBar) {
            toggleBar.classList.remove('drawer-open');
            toggleBar.title = '미분류 소설 보관함 열기';
            if (arrow) arrow.textContent = 'chevron_left';
        }
        if (hudBtn) {
            hudBtn.classList.remove('active');
        }
        if (window.soundFX) window.soundFX.playModalClose();

        setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.style.display = 'none';
            }
        }, 350);
    }
}

function renderUnclassifiedNovelList() {
    const container = document.getElementById('unclassifiedNovelListContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const searchVal = (document.getElementById('unclassifiedNovelSearchInput')?.value || '').trim().toLowerCase();
    const novels = (unclassifiedData?.novels || []).filter(n => {
        if (!searchVal) return true;
        return (n.novel_title && n.novel_title.toLowerCase().includes(searchVal)) ||
               (n.platform && n.platform.toLowerCase().includes(searchVal)) ||
               (n.work_url && n.work_url.toLowerCase().includes(searchVal));
    });

    if (novels.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 13px;">
                ${searchVal ? '검색된 소설이 없습니다.' : '미분류 소설이 없습니다.'}
            </div>
        `;
        return;
    }

    novels.forEach(novel => {
        const card = document.createElement('div');
        card.className = 'unclassified-novel-card';
        if (currentSelectedUnclassifiedNovel && currentSelectedUnclassifiedNovel.work_id === novel.work_id) {
            card.classList.add('active');
        }
        
        let platformClass = 'other';
        const pLower = (novel.platform || '').toLowerCase();
        if (pLower.includes('kakuyomu')) platformClass = 'kakuyomu';
        else if (pLower.includes('syosetu')) platformClass = 'syosetu';
        else if (pLower.includes('novelup')) platformClass = 'novelup';

        const smartBadgeHtml = novel.matched_existing_folder ? `
            <span class="card-smart-badge" title="기존 등록 폴더 '${escapeHtml(novel.matched_existing_folder)}'와 일치">
                <span class="material-icons" style="font-size: 13px;">auto_awesome</span>
                ${escapeHtml(novel.matched_existing_folder)}
            </span>
        ` : '';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="card-platform-badge ${platformClass}">${escapeHtml(novel.platform)}</span>
                ${smartBadgeHtml}
            </div>
            <div class="card-title" title="${escapeHtml(novel.novel_title)}">${escapeHtml(novel.novel_title)}</div>
            <div class="card-meta">
                <span><strong style="color: var(--primary-color);">${novel.total_episodes}</strong>개 회차</span>
                <span><strong>${novel.total_paragraphs.toLocaleString()}</strong>단락</span>
            </div>
        `;

        card.addEventListener('click', () => {
            container.querySelectorAll('.unclassified-novel-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectUnclassifiedNovel(novel);
        });

        container.appendChild(card);
    });

    // 자동 선택: 아직 선택된 소설이 없으면 첫 번째 소설 선택
    if (!currentSelectedUnclassifiedNovel && novels.length > 0) {
        selectUnclassifiedNovel(novels[0]);
        const firstCard = container.querySelector('.unclassified-novel-card');
        if (firstCard) firstCard.classList.add('active');
    }
}

function selectUnclassifiedNovel(novel) {
    currentSelectedUnclassifiedNovel = novel;
    const emptyNotice = document.getElementById('unclassifiedDetailEmptyNotice');
    const content = document.getElementById('unclassifiedDetailContent');
    if (!emptyNotice || !content) return;

    emptyNotice.style.display = 'none';
    content.style.display = 'block';

    // 1. 헤더 정보 바인딩
    document.getElementById('detailNovelTitle').textContent = novel.novel_title;
    const badgeEl = document.getElementById('detailPlatformBadge');
    badgeEl.textContent = novel.platform;
    let platformClass = 'other';
    const pLower = (novel.platform || '').toLowerCase();
    if (pLower.includes('kakuyomu')) platformClass = 'kakuyomu';
    else if (pLower.includes('syosetu')) platformClass = 'syosetu';
    else if (pLower.includes('novelup')) platformClass = 'novelup';
    badgeEl.className = `card-platform-badge ${platformClass}`;

    const workLink = document.getElementById('detailWorkLink');
    if (workLink) workLink.href = novel.work_url || '#';

    document.getElementById('detailNovelStats').textContent = 
        `총 ${novel.total_episodes}개 회차 · ${novel.total_paragraphs.toLocaleString()}개 번역 단락`;

    // 2. 스마트 자동 병합 액션 버튼 (기존 동일 소설 폴더가 있을 때)
    const smartMergeContainer = document.getElementById('smartMergeContainer');
    const smartMergeLabel = document.getElementById('smartMergeLabel');
    if (novel.matched_existing_folder) {
        smartMergeContainer.style.display = 'block';
        smartMergeLabel.textContent = `기존 폴더 '${novel.matched_existing_folder}'(으)로 자동 합치기`;
    } else {
        smartMergeContainer.style.display = 'none';
    }

    // 새 폴더 입력창 기본값 채우기 (추출된 소설 원제)
    const newFolderInput = document.getElementById('assignNewFolderNameInput');
    if (newFolderInput) {
        newFolderInput.value = novel.novel_title;
    }

    // 기존 폴더 드롭다운 채우기
    const existingDropdown = document.getElementById('assignExistingFolderDropdown');
    if (existingDropdown) {
        existingDropdown.innerHTML = '<option value="">기존 폴더 선택...</option>';
        (state.allFolders || []).forEach(f => {
            if (f.name && f.name !== '폴더 추가 대기 상태') {
                const opt = document.createElement('option');
                opt.value = f.name;
                opt.textContent = f.name;
                if (novel.matched_existing_folder === f.name) {
                    opt.selected = true;
                }
                existingDropdown.appendChild(opt);
            }
        });
    }

    // 3. 회차 및 단락 리스트 렌더링
    renderUnclassifiedEpisodes(novel);
}

function renderUnclassifiedEpisodes(novel) {
    const listContainer = document.getElementById('unclassifiedEpisodeListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    (novel.episodes || []).forEach((ep, idx) => {
        const epEl = document.createElement('div');
        epEl.className = 'unclassified-episode-item list-group';
        epEl.dataset.url = ep.url;
        epEl.dataset.folderName = '미분류';

        const isApplied = Boolean(state.appliedUrlsSet && state.appliedUrlsSet.has(ep.url.split('#')[0].replace(/\/$/, '')));

        epEl.innerHTML = `
            <div class="unclassified-episode-header list-group-header">
                <div class="unclassified-ep-title-wrap">
                    <span class="material-icons ep-toggle-icon">expand_more</span>
                    <h4 class="list-group-title">${escapeHtml(ep.title || `제 ${idx + 1}화`)}</h4>
                    <span class="episode-count-badge">${ep.paragraph_count}개 단락</span>
                </div>
                <div class="unclassified-ep-actions list-group-actions">
                    <a href="${ep.url}" target="lanovel_novel_reader" class="btn btn-outline btn-sm ext-link-btn" title="원본 웹페이지 열기">🔗 원본 ↗</a>
                    <button type="button" class="btn btn-outline btn-sm edit-title-btn" data-url="${escapeHtml(ep.url)}" title="회차 제목 수정">✏️ 수정</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-apply ${isApplied ? 'applied' : ''}" data-url="${escapeHtml(ep.url)}">${isApplied ? '적용 해제' : '적용'}</button>
                </div>
            </div>
            <div class="unclassified-episode-content list-group-content collapsed">
                <!-- 아코디언 오픈 시 단락 테이블 로딩 -->
            </div>
        `;

        const header = epEl.querySelector('.unclassified-episode-header');
        const content = epEl.querySelector('.unclassified-episode-content');
        const icon = epEl.querySelector('.ep-toggle-icon');

        header.addEventListener('click', async (e) => {
            // 버튼 클릭 시 아코디언 토글 방지
            if (e.target.closest('.unclassified-ep-actions') || e.target.closest('button') || e.target.closest('a')) {
                return;
            }

            e.stopPropagation(); // 상위 이벤트 위임 핸들러로의 버블링 방지

            const isCurrentlyOpen = content.classList.contains('open') && !content.classList.contains('collapsed');
            if (isCurrentlyOpen) {
                content.classList.remove('open');
                content.classList.add('collapsed');
                icon.textContent = 'expand_more';
                if (window.soundFX) window.soundFX.playAccordion();
            } else {
                content.classList.remove('collapsed');
                content.classList.add('open');
                icon.textContent = 'expand_less';
                if (window.soundFX) window.soundFX.playAccordion();

                // 아직 단락 테이블이 렌더링되지 않았으면 렌더링 수행
                if (!content.querySelector('.history-table')) {
                    content.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">단락 목록 불러오는 중...</div>';
                    
                    let items = null;
                    try {
                        const res = await fetch(`/api/unclassified_novels/paragraphs?url=${encodeURIComponent(ep.url)}`);
                        if (res.ok) {
                            const data = await res.json();
                            items = data.items;
                        }
                    } catch (err) {
                        console.error("Failed to fetch episode paragraphs:", err);
                    }

                    if (items && items.length > 0) {
                        items.forEach(t => unclassifiedParagraphsMap.set(t.id, t));
                        content.innerHTML = `
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
                                <tbody>
                                    ${items.map(t => renderItem(t, ep.url)).join('')}
                                </tbody>
                            </table>
                        `;
                    } else {
                        content.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">표시할 번역 단락이 없습니다.</div>';
                    }
                }
            }
        });

        listContainer.appendChild(epEl);
    });
}

async function executeAssignFolder(work_id, target_folder, work_url) {
    try {
        const res = await fetch('/api/unclassified_novels/assign_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_id, target_folder, work_url })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '폴더 등록에 실패했습니다.');
        }
        const data = await res.json();
        showToast(data.message || `'${target_folder}' 등록 완료!`, 'success');
        currentSelectedUnclassifiedNovel = null;
        await checkAndLoadUnclassifiedNovels();
        await loadAndRenderGrouped();
    } catch (e) {
        console.error('executeAssignFolder error:', e);
        showToast(`오류 발생: ${e.message}`, 'error');
    }
}


export {
    initAppReleaseModal,
    handleSelectedApkFile,
    fetchAppReleaseInfo,
    initUnclassifiedDrawer,
    checkAndLoadUnclassifiedNovels,
    toggleUnclassifiedDrawer,
    openUnclassifiedDrawer,
    closeUnclassifiedDrawer,
    renderUnclassifiedNovelList,
    selectUnclassifiedNovel,
    renderUnclassifiedEpisodes,
    executeAssignFolder
};
