import 'package:flutter/material.dart';

import '../../models/pending_upload.dart';
import '../themes/hyper_aesthetic_theme.dart';
import '../themes/reader_themes.dart';

/// 모바일에서 PC로 업로드할 변경사항 상세 내역을 보여주는 모달 바텀시트.
///
/// [confirmUpload]가 `true`이면 하단에 `[취소]` / `[PC로 업로드]` 확정 버튼을 표시하고,
/// 사용자가 업로드를 확정하면 `true`, 취소하거나 닫으면 `false`를 반환합니다.
Future<bool> showPendingChangesSheet(
  BuildContext context, {
  required PendingUploadSummary summary,
  required ReaderThemeData theme,
  bool confirmUpload = false,
  String? confirmButtonLabel,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (ctx) => _PendingChangesSheetBody(
      summary: summary,
      theme: theme,
      confirmUpload: confirmUpload,
      confirmButtonLabel: confirmButtonLabel,
    ),
  );
  return result == true;
}

class _PendingChangesSheetBody extends StatefulWidget {
  final PendingUploadSummary summary;
  final ReaderThemeData theme;
  final bool confirmUpload;
  final String? confirmButtonLabel;

  const _PendingChangesSheetBody({
    required this.summary,
    required this.theme,
    required this.confirmUpload,
    this.confirmButtonLabel,
  });

  @override
  State<_PendingChangesSheetBody> createState() => _PendingChangesSheetBodyState();
}

class _PendingChangesSheetBodyState extends State<_PendingChangesSheetBody> {
  PendingUploadCategory? _selectedCategory;

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    final summary = widget.summary;
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    final filteredItems = _selectedCategory == null
        ? summary.items
        : summary.items.where((e) => e.category == _selectedCategory).toList();

    final maxHeight = MediaQuery.of(context).size.height * 0.82;

    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: theme.subTextColor.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.amber.withOpacity(0.16),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.cloud_upload_rounded, color: Colors.amber, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.confirmUpload ? '업로드 전 변경사항 확인' : '모바일 변경사항 내역',
                      style: TextStyle(
                        color: theme.textColor,
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      summary.isEmpty
                          ? 'PC로 전송할 대기 변경사항이 없습니다.'
                          : '${summary.logicalCount}개 항목 (${summary.briefSummaryText})',
                      style: TextStyle(color: theme.subTextColor, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context, false),
                icon: Icon(Icons.close_rounded, color: theme.subTextColor),
                tooltip: '닫기',
              ),
            ],
          ),
          if (summary.isNotEmpty) ...[
            const SizedBox(height: 12),
            _buildCategoryFilterChips(summary, theme, primary),
          ],
          const SizedBox(height: 10),
          Divider(height: 1, color: theme.borderColor),
          const SizedBox(height: 10),
          if (filteredItems.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Center(
                child: Column(
                  children: [
                    Icon(
                      Icons.check_circle_outline_rounded,
                      size: 40,
                      color: const Color(0xFF10B981).withOpacity(0.8),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '업로드 대기 중인 변경사항이 없습니다.',
                      style: TextStyle(
                        color: theme.textColor,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (summary.readingLogsCount > 0) ...[
                      const SizedBox(height: 6),
                      Text(
                        '참고: 독서 잔디 기록 ${summary.readingLogsCount}건은 다음 업로드 시 함께 병합됩니다.',
                        style: TextStyle(color: theme.subTextColor, fontSize: 11),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ],
                ),
              ),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: filteredItems.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (ctx, idx) => _buildChangeItemCard(filteredItems[idx], theme, primary),
              ),
            ),
          if (summary.isNotEmpty && summary.readingLogsCount > 0) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: primary.withOpacity(0.08),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: primary.withOpacity(0.2)),
              ),
              child: Row(
                children: [
                  Icon(Icons.calendar_today_rounded, size: 14, color: primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '독서 잔디·통계 기록 ${summary.readingLogsCount}건도 업로드 시 함께 동기화됩니다.',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          if (widget.confirmUpload)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.textColor,
                      side: BorderSide(color: theme.borderColor),
                      minimumSize: const Size(0, 46),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('취소'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton.icon(
                    onPressed: () => Navigator.pop(context, true),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.amber.shade700,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(0, 46),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: const Icon(Icons.cloud_upload_rounded, size: 18),
                    label: Text(
                      widget.confirmButtonLabel ??
                          (summary.isNotEmpty
                              ? 'PC로 업로드 (${summary.logicalCount}건)'
                              : '동기화 계속'),
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ],
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context, false),
                style: ElevatedButton.styleFrom(
                  backgroundColor: primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('확인', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildCategoryFilterChips(
    PendingUploadSummary summary,
    ReaderThemeData theme,
    Color primary,
  ) {
    final chips = <Widget>[
      _buildFilterChip(
        label: '전체 ${summary.logicalCount}',
        selected: _selectedCategory == null,
        color: primary,
        theme: theme,
        onTap: () => setState(() => _selectedCategory = null),
      ),
    ];

    void addIfNonZero(PendingUploadCategory cat, String label, int count, Color color) {
      if (count <= 0) return;
      chips.add(
        _buildFilterChip(
          label: '$label $count',
          selected: _selectedCategory == cat,
          color: color,
          theme: theme,
          onTap: () => setState(() => _selectedCategory = cat),
        ),
      );
    }

    addIfNonZero(PendingUploadCategory.translationEdit, '문장 수정', summary.translationEditCount, Colors.amber.shade700);
    addIfNonZero(PendingUploadCategory.glossaryRule, '찾아바꾸기', summary.glossaryRuleCount, Colors.purpleAccent);
    addIfNonZero(PendingUploadCategory.activity, '진도·상태', summary.activityCount, const Color(0xFF10B981));
    addIfNonZero(PendingUploadCategory.pin, '상단 고정', summary.pinCount, Colors.blueAccent);
    addIfNonZero(PendingUploadCategory.highlight, '마킹', summary.highlightCount, Colors.orange);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: chips
            .expand((c) => [c, const SizedBox(width: 6)])
            .toList()
          ..removeLast(),
      ),
    );
  }

  Widget _buildFilterChip({
    required String label,
    required bool selected,
    required Color color,
    required ReaderThemeData theme,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.18) : theme.background.withOpacity(0.5),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? color.withOpacity(0.65) : theme.borderColor,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? color : theme.subTextColor,
            fontSize: 11,
            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _buildChangeItemCard(
    PendingUploadItem item,
    ReaderThemeData theme,
    Color primary,
  ) {
    final badge = _categoryMeta(item.category, item.changeType, primary);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.background.withOpacity(0.45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(
                  color: badge.color.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(badge.icon, size: 12, color: badge.color),
                    const SizedBox(width: 4),
                    Text(
                      badge.label,
                      style: TextStyle(
                        color: badge.color,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              if (item.mergedCount > 1) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.subTextColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${item.mergedCount}회 통합',
                    style: TextStyle(color: theme.subTextColor, fontSize: 10),
                  ),
                ),
              ],
              const Spacer(),
              if (item.timestamp > 0)
                Text(
                  _formatTimestamp(item.timestamp),
                  style: TextStyle(color: theme.subTextColor, fontSize: 10),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            item.title,
            style: TextStyle(
              color: theme.textColor,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 3),
          Text(
            item.subtitle,
            style: TextStyle(color: theme.subTextColor, fontSize: 12),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (item.category == PendingUploadCategory.translationEdit &&
              (item.beforeText != null || item.afterText != null)) ...[
            const SizedBox(height: 8),
            _buildDiffPreviewBox(
              beforeText: item.beforeText,
              afterText: item.afterText,
              theme: theme,
            ),
          ] else if (item.category == PendingUploadCategory.highlight &&
              item.afterText != null &&
              item.afterText!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.amber.withOpacity(0.08),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                item.afterText!,
                style: TextStyle(color: theme.textColor, fontSize: 12),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDiffPreviewBox({
    required String? beforeText,
    required String? afterText,
    required ReaderThemeData theme,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: theme.surfaceColor.withOpacity(0.7),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.borderColor.withOpacity(0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (beforeText != null && beforeText.isNotEmpty) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '이전',
                  style: TextStyle(
                    color: Colors.redAccent.shade200,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    beforeText,
                    style: TextStyle(
                      color: theme.subTextColor,
                      fontSize: 11.5,
                      height: 1.3,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 5),
          ],
          if (afterText != null && afterText.isNotEmpty)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '이후',
                  style: TextStyle(
                    color: Color(0xFF10B981),
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    afterText,
                    style: TextStyle(
                      color: theme.textColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      height: 1.35,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  _CategoryMeta _categoryMeta(PendingUploadCategory category, String changeType, Color primary) {
    switch (category) {
      case PendingUploadCategory.translationEdit:
        return _CategoryMeta('문장 수정', Icons.edit_rounded, Colors.amber.shade700);
      case PendingUploadCategory.glossaryRule:
        return const _CategoryMeta('찾아바꾸기', Icons.find_replace_rounded, Colors.purpleAccent);
      case PendingUploadCategory.activity:
        return const _CategoryMeta('진도·상태', Icons.menu_book_rounded, Color(0xFF10B981));
      case PendingUploadCategory.pin:
        return const _CategoryMeta('상단 고정', Icons.push_pin_rounded, Colors.blueAccent);
      case PendingUploadCategory.highlight:
        return _CategoryMeta(
          changeType == 'highlight_delete' ? '마킹 해제' : '마킹 추가',
          changeType == 'highlight_delete' ? Icons.bookmark_remove_rounded : Icons.edit_note_rounded,
          Colors.orange,
        );
    }
  }

  String _formatTimestamp(int unixSeconds) {
    final dt = DateTime.fromMillisecondsSinceEpoch(unixSeconds * 1000);
    final mm = dt.month.toString();
    final dd = dt.day.toString();
    final hh = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    return '$mm/$dd $hh:$min';
  }
}

class _CategoryMeta {
  final String label;
  final IconData icon;
  final Color color;

  const _CategoryMeta(this.label, this.icon, this.color);
}
