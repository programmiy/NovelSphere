/**
 * admin-analytics.js
 * Deep stats & quality analytics dashboard controller (SVG charts & metrics).
 */

import { state, dom, escapeHtml, showToast } from './admin-state.js';


let analyticsDataCache = null;
let currentActivityPeriod = '14';
let currentActivityMetric = 'count';
let currentActivityTrendMode = 'daily';

function initStatsAnalyticsModal() {
    const openBtn = document.getElementById('openStatsModalBtn');
    const modal = document.getElementById('statsAnalyticsModal');
    const closeBtn = document.getElementById('closeStatsModalBtn');
    const closeBottomBtn = document.getElementById('closeStatsModalBottomBtn');
    const scopeFilter = document.getElementById('modalNovelFilter');

    if (!openBtn || !modal) return;

    // 모달 열기
    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        populateStatsScopeFilter();
        const currentSelected = scopeFilter ? scopeFilter.value : '__all__';
        loadAdminAnalytics(currentSelected);
    });

    // 모달 닫기
    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // 작품 스코프 변경 필터
    if (scopeFilter) {
        scopeFilter.addEventListener('change', (e) => {
            loadAdminAnalytics(e.target.value);
        });
    }

    // 탭 전환 이벤트
    const tabButtons = modal.querySelectorAll('.stats-tabs .modal-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetPaneId = btn.dataset.tab;
            modal.querySelectorAll('.stats-tab-pane').forEach(pane => {
                pane.style.display = (pane.id === targetPaneId) ? 'block' : 'none';
            });
        });
    });

    // 활동 추이 모드 버튼 토글 (일일 번역량, 7일 이동평균, 누적 성장량)
    const trendModeButtons = document.querySelectorAll('#activityTrendModeButtons button');
    trendModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            trendModeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityTrendMode = btn.dataset.mode;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 활동 추이 기간 버튼 토글 (7일, 14일, 30일, 전체)
    const periodButtons = document.querySelectorAll('#activityPeriodButtons button');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityPeriod = btn.dataset.period;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 활동 추이 지표 버튼 토글 (문단 수 vs 글자 수)
    const metricButtons = document.querySelectorAll('#activityMetricButtons button');
    metricButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            metricButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityMetric = btn.dataset.metric;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 작품 심층 분석 패널 닫기 버튼
    const closeDrilldownBtn = document.getElementById('closeNovelDrilldownBtn');
    if (closeDrilldownBtn) {
        closeDrilldownBtn.addEventListener('click', () => {
            const panel = document.getElementById('novelDrilldownPanel');
            if (panel) panel.style.display = 'none';
        });
    }

    // 품질 탭 내 바로가기 카드 연결
    const abnormalBtn = document.getElementById('openAbnormalFromStatsBtn');
    if (abnormalBtn) {
        abnormalBtn.addEventListener('click', () => {
            closeModal();
            const findEmpty = document.getElementById('findEmptyBtn');
            if (findEmpty) findEmpty.click();
        });
    }

    const whitelistBtn = document.getElementById('openWhitelistFromStatsBtn');
    if (whitelistBtn) {
        whitelistBtn.addEventListener('click', () => {
            closeModal();
            const restoreBtn = document.getElementById('openRestoreCenterBtn');
            if (restoreBtn) {
                restoreBtn.click();
                setTimeout(() => {
                    const tab = document.getElementById('tabBtnAbnormalWhitelist');
                    if (tab) tab.click();
                }, 100);
            }
        });
    }

    const trashBtn = document.getElementById('openTrashFromStatsBtn');
    if (trashBtn) {
        trashBtn.addEventListener('click', () => {
            closeModal();
            const restoreBtn = document.getElementById('openRestoreCenterBtn');
            if (restoreBtn) {
                restoreBtn.click();
                setTimeout(() => {
                    const tab = document.getElementById('tabBtnTrash');
                    if (tab) tab.click();
                }, 100);
            }
        });
    }

    // 작품별 랭킹 테이블에서 특정 소설로 즉시 필터 이동 또는 회차별 스파크라인 상세 분석 열기
    const novelTableBody = document.getElementById('novelStatsTableBody');
    if (novelTableBody) {
        novelTableBody.addEventListener('click', (e) => {
            const jumpBtn = e.target.closest('.jump-to-novel-btn');
            if (jumpBtn && jumpBtn.dataset.novel) {
                const targetNovel = jumpBtn.dataset.novel;
                closeModal();
                if (targetNovel === '미분류' || targetNovel === '폴더 추가 대기 상태') {
                    openUnclassifiedDrawer();
                    return;
                }
                const folderFilter = document.getElementById('folderFilterDropdown');
                if (folderFilter) {
                    folderFilter.value = targetNovel;
                    folderFilter.dispatchEvent(new Event('change'));
                }
                return;
            }

            const drillBtn = e.target.closest('.drilldown-novel-btn') || e.target.closest('tr');
            if (drillBtn && drillBtn.dataset.novel) {
                openNovelDrilldown(drillBtn.dataset.novel);
            }
        });
    }
}

function populateStatsScopeFilter() {
    const scopeFilter = document.getElementById('modalNovelFilter');
    if (!scopeFilter) return;

    const curVal = scopeFilter.value;
    scopeFilter.innerHTML = '<option value="__all__">🌐 전체 작품 종합</option>';
    
    // allFolders 기반 옵션 채우기
    const folders = Array.isArray(state.allFolders) ? state.allFolders : [];
    if (folders.length > 0) {
        folders.forEach(folder => {
            const opt = document.createElement('option');
            opt.value = folder.name;
            opt.textContent = `📖 ${folder.name}`;
            scopeFilter.appendChild(opt);
        });
    }
    scopeFilter.value = curVal || '__all__';
}

async function loadAdminAnalytics(folderScope = '__all__') {
    const scopeBadge = document.getElementById('modalStatsCurrentScope');
    if (scopeBadge) {
        scopeBadge.textContent = folderScope === '__all__' ? '전체 통계' : folderScope;
    }

    try {
        const query = (folderScope && folderScope !== '__all__') ? `?folder_name=${encodeURIComponent(folderScope)}` : '';
        const res = await fetch(`/admin/analytics${query}`);
        if (!res.ok) throw new Error(`Analytics API error: ${res.statusText}`);

        const data = await res.json();
        analyticsDataCache = data;

        renderActivityTab(data.activity);
        renderQualityTab(data.quality, data.summary);
        renderNovelsTab(data.novels);
        renderScaleTab(data.scale);
    } catch (err) {
        console.error("통계 분석 로딩 실패:", err);
        showToast("통계 데이터를 불러오지 못했습니다.", "error");
    }
}

// 탭 1: 활동 & 생산성 추이 렌더러
function renderActivityTab(activity) {
    if (!activity) return;

    // KPI 카드 업데이트
    const resetH = activity.quota_reset_hour || 16;
    const resetHStr = resetH > 12 ? `오후 ${resetH - 12}시` : `${resetH}시`;

    const todayEpisodes = document.getElementById('kpiTodayEpisodes');
    if (todayEpisodes) {
        const eps = activity.today_episodes || 0;
        todayEpisodes.innerHTML = `${eps.toLocaleString()}<span class="kpi-unit">화</span>`;
        const todayLabelEl = todayEpisodes.parentElement ? todayEpisodes.parentElement.querySelector('.kpi-label') : null;
        if (todayLabelEl) {
            todayLabelEl.innerHTML = `⚡ 오늘 번역 회차 <span style="font-size: 11px; font-weight: normal; opacity: 0.85;">(${resetHStr} 초기화)</span>`;
        }
    }

    const todaySub = document.getElementById('kpiTodaySub');
    if (todaySub) {
        const chars = (activity.today_kr_chars || 0).toLocaleString();
        const paras = (activity.today_paragraphs || 0).toLocaleString();
        todaySub.textContent = `${chars}자 / ${paras}문단`;
    }

    const dailyAvgCount = document.getElementById('kpiDailyAvgCount');
    if (dailyAvgCount) dailyAvgCount.innerHTML = `${activity.daily_avg_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const dailyAvgChars = document.getElementById('kpiDailyAvgChars');
    if (dailyAvgChars) dailyAvgChars.textContent = `${activity.daily_avg_chars.toLocaleString()}자 / 일`;

    const peakCount = document.getElementById('kpiPeakCount');
    if (peakCount) peakCount.innerHTML = `${activity.peak_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const peakDate = document.getElementById('kpiPeakDate');
    if (peakDate) peakDate.textContent = activity.peak_date || '-';

    const streakDays = document.getElementById('kpiStreakDays');
    if (streakDays) streakDays.innerHTML = `${activity.streak_days}<span class="kpi-unit">일 연속</span>`;

    const last7dCount = document.getElementById('kpiLast7dCount');
    if (last7dCount) last7dCount.innerHTML = `${activity.last_7d_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const last7dChars = document.getElementById('kpiLast7dChars');
    if (last7dChars) last7dChars.textContent = `${activity.last_7d_chars.toLocaleString()}자`;

    // 피크 시간대 배지
    const peakBadge = document.getElementById('peakHourBadge');
    if (peakBadge) {
        peakBadge.textContent = `🔥 피크 시간대: ${activity.peak_hour}시 (${activity.peak_hour_count.toLocaleString()}건, API 주기 기준)`;
    }

    // SVG 차트 렌더링
    renderDailyTrendSvg(activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
    renderHourlySvg(activity.hourly_distribution, activity.peak_hour);
    renderDowSvg(activity.dow_distribution, activity.peak_dow, activity.weekday_pct, activity.weekend_pct);
}

// 일별 추이 인터랙티브 SVG 차트 렌더링 (일일 번역량 / 7일 이동평균 / 누적 성장량 지원)
function renderDailyTrendSvg(dailyTrends, period, metric, mode = 'daily') {
    const svg = document.getElementById('dailyTrendSvg');
    const tooltip = document.getElementById('dailyTrendChartTooltip');
    if (!svg || !Array.isArray(dailyTrends)) return;

    // 기간 필터링
    let trends = [...dailyTrends];
    if (period !== 'all') {
        const days = parseInt(period, 10);
        trends = trends.slice(-days);
    }

    svg.innerHTML = '';
    const width = 800;
    const height = 240;
    const padLeft = 65;
    const padRight = 24;
    const padTop = 24;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    if (trends.length === 0) {
        svg.innerHTML = `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-muted)">표시할 번역 활동 데이터가 없습니다.</text>`;
        return;
    }

    // 값 산출 함수
    const getVal = (t) => {
        if (mode === 'cumulative') {
            return metric === 'chars' ? (t.cum_chars ?? t.kr_chars) : (t.cum_count ?? t.count);
        } else if (mode === 'ma7') {
            return metric === 'chars' ? (t.ma7_chars ?? t.kr_chars) : (t.ma7_count ?? t.count);
        } else {
            return metric === 'chars' ? t.kr_chars : t.count;
        }
    };

    const values = trends.map(getVal);
    const maxVal = Math.max(...values, 10);

    // 테마 컬러 및 그라디언트 설정
    let themeColor = '#4f46e5'; // indigo (daily)
    if (mode === 'ma7') themeColor = '#8b5cf6'; // violet (ma7)
    else if (mode === 'cumulative') themeColor = '#059669'; // emerald (cumulative)

    // Y축 가이드선 4단계
    for (let i = 0; i <= 3; i++) {
        const yVal = Math.round((maxVal / 3) * i);
        const yPos = padTop + plotH - (plotH * (i / 3));

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padLeft);
        line.setAttribute('x2', padLeft + plotW);
        line.setAttribute('y1', yPos);
        line.setAttribute('y2', yPos);
        line.setAttribute('stroke', 'var(--border-color, #e2e8f0)');
        line.setAttribute('stroke-dasharray', '3 3');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', padLeft - 10);
        text.setAttribute('y', yPos + 4);
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('fill', 'var(--text-muted, #64748b)');
        text.setAttribute('font-size', '10px');
        text.textContent = yVal.toLocaleString();
        svg.appendChild(text);
    }

    // 포인트 좌표 계산
    const n = trends.length;
    const points = trends.map((t, idx) => {
        const val = getVal(t);
        const x = padLeft + (n > 1 ? (plotW * (idx / (n - 1))) : (plotW / 2));
        const y = padTop + plotH - (plotH * (val / maxVal));
        return { x, y, val, raw: t, date: t.date };
    });

    // 그라디언트 정의
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
        <linearGradient id="trendGradient_${mode}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${themeColor}" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="${themeColor}" stop-opacity="0.0"/>
        </linearGradient>
    `;
    svg.appendChild(defs);

    // Area & Line Path
    if (points.length > 1) {
        let areaD = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach(pt => { areaD += ` L ${pt.x} ${pt.y}`; });
        areaD += ` L ${points[points.length - 1].x} ${padTop + plotH} L ${points[0].x} ${padTop + plotH} Z`;

        const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        areaPath.setAttribute('d', areaD);
        areaPath.setAttribute('fill', `url(#trendGradient_${mode})`);
        svg.appendChild(areaPath);

        let lineD = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach(pt => { lineD += ` L ${pt.x} ${pt.y}`; });

        const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        linePath.setAttribute('d', lineD);
        linePath.setAttribute('fill', 'none');
        linePath.setAttribute('stroke', themeColor);
        linePath.setAttribute('stroke-width', '2.5');
        linePath.setAttribute('stroke-linejoin', 'round');
        linePath.setAttribute('stroke-linecap', 'round');
        svg.appendChild(linePath);
    }

    // 포인트 도트 및 인터랙션
    const stepLabel = Math.max(1, Math.floor(n / 8));
    points.forEach((pt, idx) => {
        // X축 날짜 라벨
        if (idx % stepLabel === 0 || idx === n - 1) {
            const dateText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            dateText.setAttribute('x', pt.x);
            dateText.setAttribute('y', padTop + plotH + 18);
            dateText.setAttribute('text-anchor', 'middle');
            dateText.setAttribute('fill', 'var(--text-muted, #64748b)');
            dateText.setAttribute('font-size', '10px');
            dateText.textContent = pt.date.slice(5); // MM-DD
            svg.appendChild(dateText);
        }

        // 도트 서클
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pt.x);
        circle.setAttribute('cy', pt.y);
        circle.setAttribute('r', '3.5');
        circle.setAttribute('fill', themeColor);
        circle.setAttribute('stroke', '#ffffff');
        circle.setAttribute('stroke-width', '1.5');
        circle.style.cursor = 'pointer';
        circle.style.transition = 'r 0.15s, fill 0.15s';

        // 툴팁 이벤트
        circle.addEventListener('mouseenter', () => {
            circle.setAttribute('r', '6');
            circle.setAttribute('fill', '#f59e0b');
            if (tooltip) {
                tooltip.style.display = 'block';
                const unit = metric === 'chars' ? '자' : '문단';
                let modeTitle = '일일 번역량';
                let extraInfo = '';
                if (mode === 'ma7') {
                    modeTitle = '7일 이동평균';
                    const dailyVal = metric === 'chars' ? pt.raw.kr_chars : pt.raw.count;
                    extraInfo = `<br/><span style="color: #94a3b8; font-size: 11px;">(당일 실적: ${dailyVal.toLocaleString()}${unit})</span>`;
                } else if (mode === 'cumulative') {
                    modeTitle = '누적 번역량';
                    const dailyVal = metric === 'chars' ? pt.raw.kr_chars : pt.raw.count;
                    extraInfo = `<br/><span style="color: #94a3b8; font-size: 11px;">(당일 증가: +${dailyVal.toLocaleString()}${unit})</span>`;
                }

                tooltip.innerHTML = `<strong>${pt.date}</strong><br/>${modeTitle}: <strong>${pt.val.toLocaleString()}${unit}</strong>${extraInfo}`;
                const rect = svg.getBoundingClientRect();
                const scaleX = rect.width / width;
                const scaleY = rect.height / height;
                tooltip.style.left = `${(pt.x * scaleX)}px`;
                tooltip.style.top = `${(pt.y * scaleY)}px`;
            }
        });

        circle.addEventListener('mouseleave', () => {
            circle.setAttribute('r', '3.5');
            circle.setAttribute('fill', themeColor);
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(circle);
    });
}

// 24시간 시간대별 활동 분포 SVG 차트 렌더링
function renderHourlySvg(hourlyDistribution, peakHour) {
    const svg = document.getElementById('hourlySvg');
    const tooltip = document.getElementById('hourlyChartTooltip');
    if (!svg || !Array.isArray(hourlyDistribution)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 240;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const counts = hourlyDistribution.map(h => h.count);
    const maxVal = Math.max(...counts, 10);
    const barW = Math.max(12, (plotW / 24) - 6);

    hourlyDistribution.forEach((h, idx) => {
        const x = padLeft + (idx * (plotW / 24)) + ((plotW / 24 - barW) / 2);
        const barH = plotH * (h.count / maxVal);
        const y = padTop + plotH - barH;
        const isPeak = (h.hour === peakHour);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 2));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', isPeak ? '#f59e0b' : '#4f46e5');
        rect.setAttribute('opacity', isPeak ? '1' : '0.8');
        rect.style.cursor = 'pointer';
        rect.style.transition = 'opacity 0.15s, y 0.15s';

        // 툴팁 이벤트
        rect.addEventListener('mouseenter', () => {
            rect.setAttribute('opacity', '1');
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong>${h.hour}:00 ~ ${h.hour}:59</strong><br/>번역량: ${h.count.toLocaleString()}문단 (${h.pct}%)${isPeak ? ' 🔥 피크' : ''}`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            rect.setAttribute('opacity', isPeak ? '1' : '0.8');
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);

        // X축 시간 라벨 (3시간 간격)
        if (h.hour % 3 === 0 || h.hour === 23) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x + barW / 2);
            text.setAttribute('y', padTop + plotH + 18);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'var(--text-muted, #64748b)');
            text.setAttribute('font-size', '10px');
            text.textContent = `${h.hour}시`;
            svg.appendChild(text);
        }
    });
}

// 요일별 활동 분포 SVG 차트 렌더링 (월~일)
function renderDowSvg(dowDistribution, peakDow, weekdayPct, weekendPct) {
    const svg = document.getElementById('dowSvg');
    const tooltip = document.getElementById('dowChartTooltip');
    const peakDowBadge = document.getElementById('peakDowBadge');
    const ratioBadge = document.getElementById('weekdayWeekendRatioBadge');

    if (peakDowBadge && peakDow) {
        peakDowBadge.textContent = `🔥 가장 활발한 요일: ${peakDow}`;
    }
    if (ratioBadge && weekdayPct !== undefined && weekendPct !== undefined) {
        ratioBadge.textContent = `평일 ${weekdayPct}% / 주말 ${weekendPct}%`;
    }

    if (!svg || !Array.isArray(dowDistribution)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 190;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const counts = dowDistribution.map(d => d.count);
    const maxVal = Math.max(...counts, 10);
    const slotW = plotW / 7;
    const barW = Math.min(52, slotW - 20);

    dowDistribution.forEach((d, idx) => {
        const x = padLeft + (idx * slotW) + ((slotW - barW) / 2);
        const barH = plotH * (d.count / maxVal);
        const y = padTop + plotH - barH;
        const isPeak = (d.name === peakDow);
        const isWeekend = (d.dow === 0 || d.dow === 6);

        let barColor = '#4f46e5'; // 平日: indigo
        if (isPeak) barColor = '#f59e0b'; // 피크: gold
        else if (isWeekend) barColor = '#0ea5e9'; // 주말: sky

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 3));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', barColor);
        rect.setAttribute('opacity', isPeak ? '1' : '0.85');
        rect.classList.add('dow-bar');

        rect.addEventListener('mouseenter', () => {
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong>${d.name}</strong><br/>번역량: <strong>${d.count.toLocaleString()}문단</strong> (${d.pct}%)<br/><span style="font-size: 11px; color: #94a3b8;">${d.chars.toLocaleString()}자</span>${isPeak ? ' 🔥 피크 요일' : ''}`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);

        // X축 요일 라벨
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + barW / 2);
        text.setAttribute('y', padTop + plotH + 18);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', isWeekend ? '#0ea5e9' : 'var(--text-muted, #64748b)');
        text.setAttribute('font-weight', isWeekend ? '700' : '500');
        text.setAttribute('font-size', '11px');
        text.textContent = d.short_name;
        svg.appendChild(text);
    });
}

// 탭 2: 품질 & 데이터 건강도 렌더러
function renderQualityTab(quality, summary) {
    if (!quality || !summary) return;

    // 종합 건강도 점수 원형 링
    const scoreVal = document.getElementById('healthScoreValue');
    const ringFill = document.getElementById('scoreRingFill');
    const scoreGradePill = document.getElementById('scoreGradePill');
    const score = quality.health_score || 0;

    if (scoreVal) scoreVal.innerHTML = `${score}<span class="score-unit">점</span>`;
    if (ringFill) {
        const circumference = 314.159;
        const offset = circumference * (1 - (score / 100));
        ringFill.style.strokeDashoffset = offset;
        if (score >= 90) ringFill.style.stroke = '#10b981';
        else if (score >= 75) ringFill.style.stroke = '#3b82f6';
        else if (score >= 60) ringFill.style.stroke = '#f59e0b';
        else ringFill.style.stroke = '#ef4444';
    }

    if (scoreGradePill) {
        if (score >= 95) {
            scoreGradePill.textContent = 'GRADE S+';
            scoreGradePill.className = 'score-grade-pill grade-s';
        } else if (score >= 88) {
            scoreGradePill.textContent = 'GRADE A';
            scoreGradePill.className = 'score-grade-pill grade-a';
        } else if (score >= 75) {
            scoreGradePill.textContent = 'GRADE B';
            scoreGradePill.className = 'score-grade-pill grade-b';
        } else {
            scoreGradePill.textContent = 'ATTENTION';
            scoreGradePill.className = 'score-grade-pill grade-c';
        }
    }

    // 메트릭 리스트
    const metricNormal = document.getElementById('metricNormalRate');
    if (metricNormal) metricNormal.textContent = `${quality.normal_rate}%`;

    const metricEmpty = document.getElementById('metricEmptyCount');
    if (metricEmpty) metricEmpty.textContent = `${quality.empty_count.toLocaleString()}건 (${quality.empty_rate}%)`;

    const metricAbnormal = document.getElementById('metricAbnormalRate');
    if (metricAbnormal) metricAbnormal.textContent = `${quality.abnormal_rate}%`;

    const metricApplied = document.getElementById('metricAppliedRate');
    if (metricApplied) metricApplied.textContent = `${quality.applied_rate}%`;

    // 원문 대비 번역문 확장률
    const expNum = document.getElementById('expansionRatioNumber');
    if (expNum) expNum.innerHTML = `${summary.expansion_ratio}<span class="ratio-unit">x</span>`;

    const marker = document.getElementById('expansionMarker');
    if (marker) {
        // 0.5x ~ 1.8x 스케일 매핑
        const ratio = summary.expansion_ratio || 1.1;
        const pct = Math.max(0, Math.min(100, ((ratio - 0.5) / 1.3) * 100));
        marker.style.left = `${pct}%`;
    }

    const expOrig = document.getElementById('expansionOrigChars');
    if (expOrig) expOrig.textContent = summary.total_jp_chars.toLocaleString();

    const expTrans = document.getElementById('expansionTransChars');
    if (expTrans) expTrans.textContent = summary.total_kr_chars.toLocaleString();

    // 문단 길이 5구간 분포 리스트
    const lenList = document.getElementById('lengthDistributionList');
    if (lenList && Array.isArray(quality.length_distribution)) {
        lenList.innerHTML = quality.length_distribution.map((d, idx) => `
            <div class="length-dist-item phase-${idx + 1}">
                <div class="length-dist-header">
                    <div class="length-dist-title-group">
                        <span class="length-dist-badge">SEC 0${idx + 1}</span>
                        <span class="length-dist-label">${escapeHtml(d.label)}</span>
                        <span class="length-dist-desc">(${escapeHtml(d.desc)})</span>
                    </div>
                    <span class="length-dist-count">${d.count.toLocaleString()}건 <span class="dist-pct-tag">${d.pct}%</span></span>
                </div>
                <div class="length-dist-track">
                    <div class="length-dist-fill" style="width: ${d.pct}%;"></div>
                </div>
            </div>
        `).join('');
    }

    // 품질 위생 지표 카드
    const statAbnormal = document.getElementById('statAbnormalTotalCount');
    if (statAbnormal) statAbnormal.textContent = `${quality.abnormal_total_count.toLocaleString()}건`;

    const statWhitelist = document.getElementById('statWhitelistCount');
    if (statWhitelist) statWhitelist.textContent = `${quality.whitelist_count.toLocaleString()}건`;

    const statTrash = document.getElementById('statTrashTotalCount');
    if (statTrash) statTrash.textContent = `${quality.trash_total_count.toLocaleString()}건`;

    const statPending = document.getElementById('statPendingFolderCount');
    if (statPending) statPending.textContent = `${quality.pending_folder_count.toLocaleString()}건`;
}

// 탭 3: 작품별 심층 랭킹 렌더러
function renderNovelsTab(novels) {
    const tbody = document.getElementById('novelStatsTableBody');
    const badge = document.getElementById('novelTotalCountBadge');
    if (!tbody || !Array.isArray(novels)) return;

    if (badge) badge.textContent = `총 ${novels.length}개 작품`;

    if (novels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">작품 데이터가 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = novels.map(n => {
        let rankBadgeClass = 'novel-rank-badge';
        if (n.rank === 1) rankBadgeClass += ' novel-rank-1';
        else if (n.rank === 2) rankBadgeClass += ' novel-rank-2';
        else if (n.rank === 3) rankBadgeClass += ' novel-rank-3';

        return `
            <tr class="novel-stat-row" data-novel="${escapeHtml(n.name)}" style="cursor: pointer;" title="클릭하여 회차별 세부 분량 스파크라인 확인">
                <td style="text-align: center;"><span class="${rankBadgeClass}">${n.rank}</span></td>
                <td><strong>${escapeHtml(n.name)}</strong></td>
                <td style="text-align: right;">${n.episode_count.toLocaleString()}화</td>
                <td style="text-align: right;">${n.paragraph_count.toLocaleString()}문단</td>
                <td style="text-align: right;">${n.total_chars.toLocaleString()}자</td>
                <td style="text-align: right;">${n.avg_paragraphs_per_ep}</td>
                <td>
                    <div class="share-bar-container">
                        <div class="share-bar-track">
                            <div class="share-bar-fill" style="width: ${n.share_pct}%;"></div>
                        </div>
                        <span class="share-bar-pct">${n.share_pct}%</span>
                    </div>
                </td>
                <td style="text-align: center;" onclick="event.stopPropagation();">
                    <div style="display: inline-flex; gap: 4px;">
                        <button type="button" class="btn btn-sm btn-outline drilldown-novel-btn" data-novel="${escapeHtml(n.name)}" title="회차별 분량 스파크라인 분석">
                            <span class="material-icons" style="font-size: 14px;">analytics</span>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline jump-to-novel-btn" data-novel="${escapeHtml(n.name)}" title="해당 소설 필터로 이동">
                            <span class="material-icons" style="font-size: 14px;">filter_alt</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 작품 심층 분석 및 회차별 스파크라인 열기
async function openNovelDrilldown(folderName) {
    if (!folderName) return;
    const panel = document.getElementById('novelDrilldownPanel');
    const titleEl = document.getElementById('drilldownNovelTitle');
    if (!panel) return;

    if (titleEl) titleEl.textContent = `📖 ${folderName} 회차별 세부 분량 분석`;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const res = await fetch(`/admin/analytics/novel?folder_name=${encodeURIComponent(folderName)}`);
        if (!res.ok) throw new Error('작품 상세 분석 데이터를 가져오지 못했습니다.');
        const data = await res.json();

        const totalEpsEl = document.getElementById('drilldownTotalEps');
        if (totalEpsEl) totalEpsEl.textContent = data.total_episodes.toLocaleString();

        const appliedRateEl = document.getElementById('drilldownAppliedRate');
        if (appliedRateEl) appliedRateEl.textContent = `${data.applied_pct}%`;

        const appliedEpsEl = document.getElementById('drilldownAppliedEps');
        if (appliedEpsEl) appliedEpsEl.textContent = data.applied_episodes.toLocaleString();

        const avgCharsEl = document.getElementById('drilldownAvgChars');
        if (avgCharsEl) avgCharsEl.textContent = data.avg_chars_per_ep.toLocaleString();

        const maxEpEl = document.getElementById('drilldownMaxEp');
        if (maxEpEl) {
            maxEpEl.textContent = data.max_episode ? `${data.max_episode.title} (${data.max_episode.char_count.toLocaleString()}자)` : '-';
        }

        const minEpEl = document.getElementById('drilldownMinEp');
        if (minEpEl) {
            minEpEl.textContent = data.min_episode ? `${data.min_episode.title} (${data.min_episode.char_count.toLocaleString()}자)` : '-';
        }

        renderNovelSparkline(data.episodes, data.avg_chars_per_ep);
    } catch (err) {
        console.error("작품 스파크라인 로딩 실패:", err);
        showToast("작품 회차 데이터를 불러오지 못했습니다.", "error");
    }
}

// 회차별 분량 인터랙티브 스파크라인 SVG 차트 렌더링
function renderNovelSparkline(episodes, avgChars) {
    const svg = document.getElementById('novelEpisodeSparklineSvg');
    const tooltip = document.getElementById('novelSparklineTooltip');
    if (!svg || !Array.isArray(episodes)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 190;
    const padLeft = 50;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    if (episodes.length === 0) {
        svg.innerHTML = `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-muted)">회차 분량 데이터가 없습니다.</text>`;
        return;
    }

    const charCounts = episodes.map(e => e.char_count);
    const maxVal = Math.max(...charCounts, avgChars, 100);

    // 평균 기준선 (Red Dashed Line)
    if (avgChars > 0) {
        const avgY = padTop + plotH - (plotH * (avgChars / maxVal));
        const avgLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        avgLine.setAttribute('x1', padLeft);
        avgLine.setAttribute('x2', padLeft + plotW);
        avgLine.setAttribute('y1', avgY);
        avgLine.setAttribute('y2', avgY);
        avgLine.setAttribute('stroke', '#ef4444');
        avgLine.setAttribute('stroke-dasharray', '4 4');
        avgLine.setAttribute('stroke-width', '1.5');
        svg.appendChild(avgLine);

        const avgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        avgText.setAttribute('x', padLeft + plotW);
        avgText.setAttribute('y', avgY - 4);
        avgText.setAttribute('text-anchor', 'end');
        avgText.setAttribute('fill', '#ef4444');
        avgText.setAttribute('font-size', '10px');
        avgText.setAttribute('font-weight', '600');
        avgText.textContent = `화당 평균: ${avgChars.toLocaleString()}자`;
        svg.appendChild(avgText);
    }

    const n = episodes.length;
    const slotW = plotW / n;
    const barW = Math.max(3, Math.min(16, slotW - 2));

    episodes.forEach((ep, idx) => {
        const x = padLeft + (idx * slotW) + ((slotW - barW) / 2);
        const barH = plotH * (ep.char_count / maxVal);
        const y = padTop + plotH - barH;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 2));
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', ep.is_applied ? '#10b981' : '#4f46e5');
        rect.setAttribute('opacity', ep.is_applied ? '0.9' : '0.7');
        rect.style.cursor = 'pointer';
        rect.style.transition = 'opacity 0.15s, fill 0.15s';

        rect.addEventListener('mouseenter', () => {
            rect.setAttribute('opacity', '1');
            rect.setAttribute('fill', '#f59e0b');
            if (tooltip) {
                tooltip.style.display = 'block';
                const statusTag = ep.is_applied ? '✅ 웹페이지 적용 완료' : '⏳ 미적용 상태';
                tooltip.innerHTML = `<strong>#${ep.index} ${escapeHtml(ep.title)}</strong><br/>글자 수: <strong>${ep.char_count.toLocaleString()}자</strong> (${ep.paragraph_count}문단)<br/><span style="font-size: 11px;">${statusTag}</span>`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            rect.setAttribute('opacity', ep.is_applied ? '0.9' : '0.7');
            rect.setAttribute('fill', ep.is_applied ? '#10b981' : '#4f46e5');
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);
    });

    // 1화 라벨 & 최신화 라벨
    if (n > 0) {
        const firstLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        firstLabel.setAttribute('x', padLeft);
        firstLabel.setAttribute('y', padTop + plotH + 18);
        firstLabel.setAttribute('fill', 'var(--text-muted, #64748b)');
        firstLabel.setAttribute('font-size', '10px');
        firstLabel.textContent = `1화 (${episodes[0].char_count.toLocaleString()}자)`;
        svg.appendChild(firstLabel);

        const lastLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lastLabel.setAttribute('x', padLeft + plotW);
        lastLabel.setAttribute('y', padTop + plotH + 18);
        lastLabel.setAttribute('text-anchor', 'end');
        lastLabel.setAttribute('fill', 'var(--text-muted, #64748b)');
        lastLabel.setAttribute('font-size', '10px');
        lastLabel.textContent = `${n}화 (${episodes[n - 1].char_count.toLocaleString()}자)`;
        svg.appendChild(lastLabel);
    }
}

// 탭 4: 번역 규모 & 독서 환산 렌더러
function renderScaleTab(scale) {
    if (!scale) return;

    const scaleBig = document.getElementById('scaleKrCharsBig');
    if (scaleBig) scaleBig.innerHTML = `${scale.kr_chars.toLocaleString()}<span class="kpi-unit">자</span>`;

    const scaleSub = document.getElementById('scaleJpCharsSub');
    if (scaleSub) scaleSub.textContent = `원문 ${scale.jp_chars.toLocaleString()}자 대비 1.16배`;

    const scaleBooks = document.getElementById('scaleBooksCount');
    if (scaleBooks) scaleBooks.innerHTML = `${scale.books_count}<span class="kpi-unit">권</span>`;

    const scaleManuscript = document.getElementById('scaleManuscriptCount');
    if (scaleManuscript) scaleManuscript.innerHTML = `${scale.manuscript_count.toLocaleString()}<span class="kpi-unit">매</span>`;

    const scaleHours = document.getElementById('scaleReadingHours');
    if (scaleHours) scaleHours.innerHTML = `${scale.reading_hours}<span class="kpi-unit">시간</span>`;

    const scaleDays = document.getElementById('scaleReadingDays');
    if (scaleDays) scaleDays.textContent = `약 ${scale.reading_days}일 연속 완독`;

    const paceFast = document.getElementById('paceFastHours');
    if (paceFast) paceFast.textContent = `${scale.pace_fast_hours}시간`;

    const paceStd = document.getElementById('paceStandardHours');
    if (paceStd) paceStd.textContent = `${scale.pace_standard_hours}시간`;

    const paceSlow = document.getElementById('paceSlowHours');
    if (paceSlow) paceSlow.textContent = `${scale.pace_slow_hours}시간`;

    const avgChars = document.getElementById('avgCharsPerChapter');
    if (avgChars) avgChars.textContent = `${scale.avg_chars_per_chapter.toLocaleString()}자 / 화`;

    const avgParas = document.getElementById('avgParagraphsPerChapter');
    if (avgParas) avgParas.textContent = `${scale.avg_paragraphs_per_chapter}단락 / 화`;

    const fitBadge = document.getElementById('novelFitBadge');
    if (fitBadge) fitBadge.textContent = scale.novel_fit_badge;
}


export {
    initStatsAnalyticsModal,
    populateStatsScopeFilter,
    loadAdminAnalytics,
    renderActivityTab,
    renderDailyTrendSvg,
    renderHourlySvg,
    renderDowSvg,
    renderQualityTab,
    renderNovelsTab,
    openNovelDrilldown,
    renderNovelSparkline,
    renderScaleTab
};
