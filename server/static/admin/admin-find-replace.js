/**
 * admin-find-replace.js
 * Global Find & Replace modal and regex substitution engine.
 */

import { state, dom, escapeHtml, showToast } from './admin-state.js';
import { escapeRegExp } from './admin-dock.js';

export function openFindReplaceModal() {
    if (!dom.findReplaceModal) return;

    // Reset form
    if (dom.findText) dom.findText.value = '';
    if (dom.replaceText) dom.replaceText.value = '';
    if (dom.conditionText) dom.conditionText.value = '';
    if (dom.useRegex) dom.useRegex.checked = false;
    if (dom.caseSensitive) dom.caseSensitive.checked = false;
    if (dom.findCount) dom.findCount.textContent = '(0개)';

    // Populate folder scope dropdown
    if (dom.folderScope) {
        dom.folderScope.innerHTML = '';
        if (state.selectedIds && state.selectedIds.size > 0) {
            const selectedOption = document.createElement('option');
            selectedOption.value = '__selected__';
            selectedOption.textContent = `선택된 ${state.selectedIds.size}개 항목`;
            dom.folderScope.appendChild(selectedOption);
        }

        const allOption = document.createElement('option');
        allOption.value = '__all__';
        allOption.textContent = '모든 폴더';
        dom.folderScope.appendChild(allOption);

        const folders = Array.isArray(state.allFolders) ? state.allFolders : [];
        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder.name;
            option.textContent = folder.name;
            dom.folderScope.appendChild(option);
        });
    }

    dom.findReplaceModal.style.display = 'flex';
    if (dom.findText) dom.findText.focus();
}

export function closeFindReplaceModal() {
    if (!dom.findReplaceModal) return;
    dom.findReplaceModal.style.display = 'none';
}

export function countOccurrences() {
    if (!dom.findText || !dom.conditionText || !dom.folderScope || !dom.useRegex || !dom.caseSensitive || !dom.findCount) return;

    const findTextValue = dom.findText.value;
    const conditionTextValue = dom.conditionText.value;
    const selectedFolder = dom.folderScope.value;
    const useRegexValue = dom.useRegex.checked;
    const caseSensitiveValue = dom.caseSensitive.checked;

    if (!findTextValue) {
        dom.findCount.textContent = '(0개)';
        return;
    }

    let count = 0;
    const flags = caseSensitiveValue ? 'g' : 'gi';
    let findRegex;
    try {
        findRegex = new RegExp(useRegexValue ? findTextValue : escapeRegExp(findTextValue), flags);
    } catch (e) {
        dom.findCount.textContent = '(유효하지 않은 정규식)';
        return;
    }

    const isSelectedScope = selectedFolder === '__selected__';
    const dataSources = [state.groupedTranslations, state.rawAbnormalData, state.rawCleanupData].filter(Boolean);
    const countedIds = new Set();

    for (const source of dataSources) {
        for (const folderName in source) {
            if (!isSelectedScope && selectedFolder !== '__all__' && folderName !== selectedFolder) {
                continue;
            }

            const urlGroups = source[folderName];
            if (!Array.isArray(urlGroups)) continue;

            for (const urlGroup of urlGroups) {
                const items = urlGroup.items;
                if (!Array.isArray(items)) continue;

                for (const item of items) {
                    if (countedIds.has(item.id)) continue;
                    if (isSelectedScope && !state.selectedIds.has(item.id)) continue;

                    // Check conditionText in original (null-safe)
                    if (conditionTextValue) {
                        const originalContent = caseSensitiveValue ? (item.original || '') : (item.original || '').toLowerCase();
                        const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
                        if (!originalContent.includes(conditionContent)) {
                            continue;
                        }
                    }

                    // Check findText in translated
                    if (item.translated) {
                        const matches = item.translated.match(findRegex);
                        if (matches) {
                            count += matches.length;
                            countedIds.add(item.id);
                        }
                    }
                }
            }
        }
    }
    dom.findCount.textContent = `(${count}개)`;
}

export function applyFindReplaceToLocalData(findTextValue, replaceTextValue, conditionTextValue, selectedFolder, useRegexValue, caseSensitiveValue, targetIds = null) {
    let regex;
    const flags = caseSensitiveValue ? 'g' : 'gi';
    try {
        regex = new RegExp(useRegexValue ? findTextValue : escapeRegExp(findTextValue), flags);
    } catch (e) {
        console.error("Regex build error in local update:", e);
        return;
    }

    const targetIdSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
    const isSelectedScope = selectedFolder === '__selected__' || Boolean(targetIdSet);

    // 1. 메모리 상의 모든 활성 데이터 소스 동기화
    const sourcesToUpdate = [state.groupedTranslations, state.rawAbnormalData, state.rawCleanupData].filter(Boolean);

    for (const source of sourcesToUpdate) {
        for (const folderName in source) {
            if (!isSelectedScope && selectedFolder !== '__all__' && folderName !== selectedFolder) {
                continue;
            }

            const urlGroups = source[folderName];
            if (!Array.isArray(urlGroups)) continue;

            for (const urlGroup of urlGroups) {
                const items = urlGroup.items;
                if (!Array.isArray(items)) continue;

                for (const item of items) {
                    if (targetIdSet && !targetIdSet.has(item.id)) {
                        continue;
                    }

                    if (conditionTextValue) {
                        const originalContent = caseSensitiveValue ? (item.original || '') : (item.original || '').toLowerCase();
                        const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
                        if (!originalContent.includes(conditionContent)) {
                            continue;
                        }
                    }

                    if (item.translated) {
                        item.translated = item.translated.replace(regex, () => replaceTextValue);
                    }
                }
            }
        }
    }

    // 2. 현재 화면에 이미 렌더링된 번역 텍스트 요소들 즉시 갱신
    document.querySelectorAll('.translated-text').forEach(el => {
        const itemId = parseInt(el.dataset.id, 10);
        if (targetIdSet && !targetIdSet.has(itemId)) {
            return;
        }

        const itemFolder = el.dataset.folder || '';
        if (!isSelectedScope && selectedFolder !== '__all__' && itemFolder !== selectedFolder) {
            return;
        }

        if (conditionTextValue) {
            const itemOrig = caseSensitiveValue ? (el.dataset.original || '') : (el.dataset.original || '').toLowerCase();
            const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
            if (!itemOrig.includes(conditionContent)) {
                return;
            }
        }

        if (el.textContent && regex.test(el.textContent)) {
            el.textContent = el.textContent.replace(regex, () => replaceTextValue);
        }
    });

    // 3. 통계 갱신 알림 트리거
    window.dispatchEvent(new CustomEvent('lanovel:update-stats'));
}

export async function executeGlobalFindReplace() {
    if (!dom.findText || !dom.replaceText || !dom.conditionText || !dom.folderScope || !dom.useRegex || !dom.caseSensitive || !dom.executeFindReplaceBtn) return;

    const findTextValue = dom.findText.value;
    const replaceTextValue = dom.replaceText.value;
    const conditionTextValue = dom.conditionText.value;
    const selectedFolder = dom.folderScope.value;
    const useRegexValue = dom.useRegex.checked;
    const caseSensitiveValue = dom.caseSensitive.checked;

    if (!findTextValue) {
        showToast('찾을 내용을 입력하세요.', 'error');
        return;
    }

    const isSelectedScope = selectedFolder === '__selected__';
    const targetIds = isSelectedScope ? Array.from(state.selectedIds) : null;
    const scopeLabel = isSelectedScope 
        ? `선택된 ${targetIds.length}개 항목` 
        : (selectedFolder === '__all__' ? '전체 번역 기록' : `'${selectedFolder}' 폴더`);

    if (!confirm(`[${scopeLabel}] 범위에서 "${findTextValue}"을(를) "${replaceTextValue}"(으)로 바꾸시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    const originalBtnText = dom.executeFindReplaceBtn.textContent;
    dom.executeFindReplaceBtn.disabled = true;
    dom.executeFindReplaceBtn.textContent = '치환 중...';

    try {
        const payload = {
            find_text: findTextValue,
            replace_text: replaceTextValue,
            condition_text: conditionTextValue,
            folder: selectedFolder,
            use_regex: useRegexValue,
            case_sensitive: caseSensitiveValue
        };
        if (targetIds && targetIds.length > 0) {
            payload.target_ids = targetIds;
        }

        const response = await fetch('/translations/find_replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const result = await response.json();
        showToast(result.message, 'success');
        closeFindReplaceModal();

        applyFindReplaceToLocalData(findTextValue, replaceTextValue, conditionTextValue, selectedFolder, useRegexValue, caseSensitiveValue, targetIds);

    } catch (error) {
        console.error("Global find and replace failed:", error);
        showToast(`오류: ${error.message}`, 'error');
    } finally {
        dom.executeFindReplaceBtn.disabled = false;
        dom.executeFindReplaceBtn.textContent = originalBtnText;
    }
}
