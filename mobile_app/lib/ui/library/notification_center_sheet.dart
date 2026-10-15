import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/app_notification.dart';
import '../../services/notification_service.dart';
import '../themes/reader_themes.dart';
import '../viewer/reader_screen.dart';

class NotificationCenterSheet extends StatefulWidget {
  final ReaderThemeData theme;
  final VoidCallback? onNotificationOpened;

  const NotificationCenterSheet({
    super.key,
    required this.theme,
    this.onNotificationOpened,
  });

  @override
  State<NotificationCenterSheet> createState() => _NotificationCenterSheetState();
}

class _NotificationCenterSheetState extends State<NotificationCenterSheet> {
  List<AppNotification> _notifications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() => _isLoading = true);
    final list = await NotificationService.fetchRecentNotifications();
    if (mounted) {
      setState(() {
        _notifications = list;
        _isLoading = false;
      });
    }
  }

  void _onNotificationTapped(AppNotification item) {
    NotificationService.markAsRead(item.id);
    setState(() {});

    if (item.bookTitle != null && item.bookTitle!.isNotEmpty) {
      Navigator.pop(context); // 시트 닫기
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ReaderScreen(
            bookName: item.bookTitle!,
            initialChapterTitle: item.chapterTitle,
          ),
        ),
      );
      widget.onNotificationOpened?.call();
    }
  }

  String _formatTimestamp(int ts) {
    if (ts <= 0) return '';
    final dt = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inMinutes < 1) return '방금 전';
    if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
    if (diff.inHours < 24) return '${diff.inHours}시간 전';
    if (diff.inDays < 7) return '${diff.inDays}일 전';
    return DateFormat('M월 d일').format(dt);
  }

  IconData _getIconForType(String type) {
    switch (type) {
      case 'db_alert':
        return Icons.warning_amber_rounded;
      case 'complete':
        return Icons.celebration_rounded;
      case 'progress':
      case 'episode_milestone':
        return Icons.hourglass_top_rounded;
      case 'error':
        return Icons.error_outline_rounded;
      case 'cleanup':
        return Icons.cleaning_services_rounded;
      case 'task':
        return Icons.task_alt_rounded;
      default:
        return Icons.notifications_none_rounded;
    }
  }

  Color _getColorForType(String type, ReaderThemeData theme) {
    switch (type) {
      case 'db_alert':
        return Colors.red;
      case 'complete':
        return Colors.green;
      case 'progress':
      case 'episode_milestone':
        return Colors.orange;
      case 'error':
        return Colors.redAccent;
      case 'cleanup':
        return Colors.purpleAccent;
      case 'task':
        return Colors.teal;
      default:
        return theme.accentColor;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;

    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        children: [
          // 상단 핸들바 & 타이틀 헤더
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 12, 8),
            child: Row(
              children: [
                Icon(Icons.notifications_active_rounded, color: theme.accentColor, size: 22),
                const SizedBox(width: 8),
                Text(
                  '알림 센터',
                  style: TextStyle(
                    color: theme.textColor,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                if (_notifications.isNotEmpty)
                  TextButton(
                    onPressed: () {
                      NotificationService.markAllAsRead();
                      setState(() {});
                    },
                    child: Text('모두 읽음', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
                  ),
                IconButton(
                  icon: Icon(Icons.close_rounded, color: theme.subTextColor),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
          const Divider(height: 1),

          // 알림 목록 본문
          Expanded(
            child: _isLoading
                ? Center(child: CircularProgressIndicator(color: theme.accentColor))
                : _notifications.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.notifications_off_outlined, color: theme.subTextColor.withOpacity(0.5), size: 48),
                            const SizedBox(height: 12),
                            Text(
                              '새로운 알림이 없습니다.',
                              style: TextStyle(color: theme.subTextColor, fontSize: 14),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '번역 완료, 진행도 마일스톤 등의 알림이 여기에 표시됩니다.',
                              style: TextStyle(color: theme.subTextColor.withOpacity(0.7), fontSize: 11),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _fetch,
                        color: theme.accentColor,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: _notifications.length,
                          separatorBuilder: (_, __) => Divider(height: 1, indent: 64, endIndent: 20, color: theme.borderColor.withOpacity(0.5)),
                          itemBuilder: (context, index) {
                            final item = _notifications[index];
                            final iconColor = _getColorForType(item.type, theme);
                            final timeStr = _formatTimestamp(item.timestamp);
                            final isClickable = item.bookTitle != null && item.bookTitle!.isNotEmpty;

                            return ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                              leading: Stack(
                                children: [
                                  CircleAvatar(
                                    radius: 20,
                                    backgroundColor: iconColor.withOpacity(0.12),
                                    child: Icon(_getIconForType(item.type), color: iconColor, size: 20),
                                  ),
                                  if (!item.isRead)
                                    Positioned(
                                      right: 0,
                                      top: 0,
                                      child: Container(
                                        width: 8,
                                        height: 8,
                                        decoration: BoxDecoration(
                                          color: theme.accentColor,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                              title: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      item.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: theme.textColor,
                                        fontSize: 14,
                                        fontWeight: item.isRead ? FontWeight.normal : FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  if (timeStr.isNotEmpty)
                                    Text(
                                      timeStr,
                                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                                    ),
                                ],
                              ),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  item.message,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(color: theme.subTextColor, fontSize: 12),
                                ),
                              ),
                              trailing: isClickable
                                  ? Icon(Icons.chevron_right_rounded, color: theme.subTextColor, size: 18)
                                  : null,
                              onTap: () => _onNotificationTapped(item),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
