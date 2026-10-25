import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/book.dart';
import '../../models/chapter.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../../services/remote_control_service.dart';
import '../themes/reader_themes.dart';

/// PC 크롬 번역 탭을 원격 조종하는 리모컨 화면.
/// 화면이 열려 있는 동안 2초마다 상태를 갱신한다.
class RemoteControlScreen extends StatefulWidget {
  const RemoteControlScreen({super.key});

  @override
  State<RemoteControlScreen> createState() => _RemoteControlScreenState();
}

class _RemoteControlScreenState extends State<RemoteControlScreen> {
  RemoteStatus? _status;
  String? _error; // 연결 실패/인증 실패 메시지
  bool _offline = false;
  bool _busy = false;
  Timer? _timer;
  QueueOverview? _queue;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final s = await RemoteControlService.fetchStatus();
      QueueOverview? queue = _queue;
      try {
        queue = await RemoteControlService.fetchQueue();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _status = s;
        _queue = queue;
        _error = null;
        _offline = false;
      });
    } on RemoteException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _offline = e.offline;
      });
    }
  }

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(msg),
        backgroundColor: error ? Colors.redAccent : null,
        duration: const Duration(seconds: 3),
      ));
  }

  Future<void> _send(String type, {Map<String, dynamic>? params, String? okMessage}) async {
    if (_busy) return;
    HapticFeedback.mediumImpact();
    setState(() => _busy = true);
    try {
      final r = await RemoteControlService.sendCommand(type, params: params);
      if (!r.extensionOnline) {
        _toast('명령을 보냈지만 PC 확장이 연결되어 있지 않아요. 연결되면 실행됩니다 (10분 내).', error: true);
      } else {
        _toast(okMessage ?? '명령을 보냈어요');
      }
      _refresh();
    } on RemoteException catch (e) {
      _toast(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('확인')),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _gotoDialog() async {
    final controller = TextEditingController();
    final url = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('URL로 이동', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                hintText: 'https://ncode.syosetu.com/...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.list_alt_rounded),
                  label: const Text('목차에서 고르기'),
                  onPressed: () async {
                    final picked = await _pickChapterUrl();
                    if (picked != null && ctx.mounted) Navigator.pop(ctx, picked);
                  },
                ),
                const Spacer(),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                  child: const Text('이동'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (url == null || url.isEmpty) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      _toast('http:// 또는 https:// 로 시작하는 주소를 입력하세요', error: true);
      return;
    }
    if (await _confirm('이동할까요?', '번역 중이던 작업이 중단되고 아래 주소로 이동합니다.\n\n$url')) {
      await _send('goto', params: {'url': url}, okMessage: '이동 명령을 보냈어요');
    }
  }

  /// 앱에 저장된 소설 목차에서 회차 URL 고르기 (소설 → 회차)
  Future<String?> _pickChapterUrl() async {
    final List<Book> books = await LocalDbService.getBooks(sort: 'recent');
    if (!mounted || books.isEmpty) {
      _toast('앱에 저장된 소설이 없어요. 먼저 동기화하세요.', error: true);
      return null;
    }
    final book = await showDialog<Book>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('소설 선택'),
        children: books
            .map((b) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(ctx, b),
                  child: Text(b.folderName, maxLines: 2, overflow: TextOverflow.ellipsis),
                ))
            .toList(),
      ),
    );
    if (book == null) return null;
    final List<Chapter> chapters = await LocalDbService.getChapters(book.folderName);
    if (!mounted) return null;
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(book.folderName, maxLines: 1, overflow: TextOverflow.ellipsis),
        content: SizedBox(
          width: double.maxFinite,
          height: 420,
          child: ListView.builder(
            itemCount: chapters.length,
            itemBuilder: (_, i) {
              final c = chapters[i];
              return ListTile(
                dense: true,
                title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                enabled: c.url.startsWith('http'),
                onTap: () => Navigator.pop(ctx, c.url),
              );
            },
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ UI
  Color _stateColor(String state) {
    switch (state) {
      case 'running':
      case 'turbo':
      case 'idle':
        return const Color(0xFF10B981);
      case 'next_scheduled':
        return const Color(0xFF3B82F6);
      case 'delay_wait':
      case 'turbo_wait':
      case 'paused':
        return const Color(0xFFF59E0B);
      case 'censor_split':
        return const Color(0xFFF97316);
      case 'stalled':
      case 'extension_offline':
        return Colors.redAccent;
      default:
        return Colors.grey;
    }
  }

  Widget _statusCard(ReaderThemeData theme) {
    final s = _status;
    final String label;
    final Color color;
    if (_error != null && (_offline || s == null)) {
      label = _offline ? '🔴 서버 오프라인' : '⚠️ $_error';
      color = Colors.redAccent;
    } else if (s == null) {
      label = '연결 중...';
      color = Colors.grey;
    } else {
      label = s.label;
      color = _stateColor(s.state);
    }

    final subtitleStyle = TextStyle(color: theme.subTextColor, fontSize: 12);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: theme.textColor, fontSize: 20, fontWeight: FontWeight.bold)),
          if (_error != null && s != null) ...[
            const SizedBox(height: 4),
            Text('마지막 상태를 표시 중 · $_error', style: const TextStyle(color: Colors.redAccent, fontSize: 11)),
          ],
          if (s != null && (s.bookTitle.isNotEmpty || s.chapterTitle.isNotEmpty)) ...[
            const SizedBox(height: 10),
            if (s.bookTitle.isNotEmpty)
              Text(s.bookTitle, style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
            if (s.chapterTitle.isNotEmpty)
              Text(s.chapterTitle, style: subtitleStyle, maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
          if (s != null && s.extensionOnline) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(value: s.percentage / 100, minHeight: 8, color: color, backgroundColor: color.withOpacity(0.18)),
            ),
            const SizedBox(height: 6),
            Text(
              '${s.percentage}%'
              '${s.turbo ? ' · ⚡터보' : ''}'
              '${s.lastSeenAgoSec != null ? ' · ${s.lastSeenAgoSec}초 전 갱신' : ''}',
              style: subtitleStyle,
            ),
          ],
        ],
      ),
    );
  }

  Widget _btn(String label, IconData icon, VoidCallback? onTap, {Color? color}) {
    return FilledButton.tonalIcon(
      onPressed: (_busy || onTap == null) ? null : onTap,
      icon: Icon(icon, size: 20, color: color),
      label: Text(label),
      style: FilledButton.styleFrom(minimumSize: const Size(0, 56)),
    );
  }

  Widget _buttons(ReaderThemeData theme) {
    final s = _status;
    final paused = s?.state == 'paused';
    final turbo = s?.turbo ?? false;
    final nextScheduled = s?.nextScheduled ?? false;
    final enabled = _error == null || !_offline;

    final items = <Widget>[
      _btn('새로고침', Icons.refresh_rounded, enabled ? () => _send('reload', okMessage: '새로고침 명령을 보냈어요') : null),
      _btn(
        nextScheduled ? '다음화 예약 취소' : '다음화',
        nextScheduled ? Icons.cancel_schedule_send_rounded : Icons.skip_next_rounded,
        enabled
            ? () => _send(nextScheduled ? 'cancel_next' : 'next',
                okMessage: nextScheduled ? '예약을 취소했어요' : '번역이 끝나면 다음 화로 넘어가요')
            : null,
      ),
      _btn('이전화', Icons.skip_previous_rounded, enabled
          ? () async {
              if (await _confirm('이전 화로 이동할까요?', '번역 중이던 작업이 중단되고 이전 화로 이동합니다.')) {
                await _send('prev', okMessage: '이전 화로 이동 명령을 보냈어요');
              }
            }
          : null),
      _btn(paused ? '재개' : '일시정지', paused ? Icons.play_arrow_rounded : Icons.pause_rounded,
          enabled ? () => _send(paused ? 'resume' : 'pause') : null),
      _btn(turbo ? '터보 끄기' : '터보 켜기', Icons.bolt_rounded,
          enabled ? () => _send(turbo ? 'turbo_off' : 'turbo_on') : null,
          color: turbo ? const Color(0xFFF59E0B) : null),
      _btn('URL 이동', Icons.link_rounded, enabled ? _gotoDialog : null),
      _btn('현재 화 재번역', Icons.translate_rounded, enabled
          ? () async {
              if (await _confirm('현재 화를 재번역할까요?', '저장된 번역을 지우고 고성능 모델로 전체를 다시 번역합니다. (API 사용량이 늘어요)')) {
                await _send('retranslate');
              }
            }
          : null),
    ];

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 2.6,
      children: items,
    );
  }

  // ------------------------------------------------------------ 연속 번역 목록
  Future<void> _queueAction(Future<void> Function() action, {String? okMessage}) async {
    try {
      await action();
      if (okMessage != null) _toast(okMessage);
      await _refresh();
    } on RemoteException catch (e) {
      _toast(e.message, error: true);
    }
  }

  Future<void> _addQueueUrlsDialog() async {
    final controller = TextEditingController();
    final text = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('번역 목록에 소설 추가', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('소설 개요(목차) 페이지 주소를 붙여넣으세요. 여러 개는 줄바꿈으로 구분해요.',
                style: TextStyle(fontSize: 12)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.multiline,
              minLines: 3,
              maxLines: 8,
              decoration: const InputDecoration(
                hintText: 'https://ncode.syosetu.com/n0000a/',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: () => Navigator.pop(ctx, controller.text),
                child: const Text('추가'),
              ),
            ),
          ],
        ),
      ),
    );
    if (text == null) return;
    final urls = text.split(RegExp(r'[\n,]')).map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
    if (urls.isEmpty) return;
    try {
      final r = await RemoteControlService.addQueueUrls(urls);
      final parts = <String>[
        if (r.added > 0) '${r.added}개 추가',
        if (r.requeued > 0) '${r.requeued}개 다시 대기',
        if (r.rejectedReasons.isNotEmpty) '${r.rejectedReasons.length}개 제외 (${r.rejectedReasons.first})',
      ];
      _toast(parts.isEmpty ? '추가된 항목이 없어요' : parts.join(' · '), error: r.added + r.requeued == 0);
      await _refresh();
    } on RemoteException catch (e) {
      _toast(e.message, error: true);
    }
  }

  Future<void> _reorderQueue(int oldIndex, int newIndex) async {
    final q = _queue;
    if (q == null) return;
    if (newIndex > oldIndex) newIndex -= 1;
    final items = [...q.items];
    final moved = items.removeAt(oldIndex);
    items.insert(newIndex, moved);
    // 서버 응답 전에도 바로 반영해 끌어놓은 자리에 머물게 한다.
    setState(() => _queue = QueueOverview(
          items: items,
          running: q.running,
          cinderella: q.cinderella,
          pendingCount: q.pendingCount,
          failedCount: q.failedCount,
          recentEvents: q.recentEvents,
        ));
    await _queueAction(() => RemoteControlService.reorderQueue(items.map((e) => e.id).toList()));
  }

  String _statusIcon(String st) => switch (st) {
        'running' => '▶️',
        'done' => '✅',
        'failed' => '❌',
        _ => '⏳',
      };

  Widget _queueItemTile(QueueItem it, int index, ReaderThemeData theme) {
    final title = it.title.isEmpty ? it.url : it.title;
    final isRunning = it.status == 'running';
    return ListTile(
      key: ValueKey(it.id),
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Text(_statusIcon(it.status), style: const TextStyle(fontSize: 18)),
      title: Text(title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: isRunning ? FontWeight.bold : FontWeight.normal)),
      subtitle: it.status == 'failed' && it.failReason.isNotEmpty
          ? Text(it.failReason, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.redAccent, fontSize: 11))
          : (it.title.isNotEmpty
              ? Text(it.url, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: theme.subTextColor, fontSize: 11))
              : null),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (it.status == 'failed' || it.status == 'done')
            IconButton(
              tooltip: '다시 시도',
              icon: const Icon(Icons.replay_rounded, size: 20),
              onPressed: () => _queueAction(() => RemoteControlService.retryQueueItem(it.id), okMessage: '다시 대기열에 넣었어요'),
            ),
          IconButton(
            tooltip: '삭제',
            icon: const Icon(Icons.delete_outline_rounded, size: 20),
            onPressed: () async {
              if (await _confirm('목록에서 삭제할까요?', title)) {
                await _queueAction(() => RemoteControlService.removeQueueItem(it.id));
              }
            },
          ),
          ReorderableDragStartListener(index: index, child: const Icon(Icons.drag_handle_rounded, size: 20)),
        ],
      ),
    );
  }

  Widget _queueSection(ReaderThemeData theme) {
    final q = _queue;
    final events = (q?.recentEvents ?? []).take(3).toList();
    String fmtTime(int ts) {
      final d = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
      String two(int n) => n.toString().padLeft(2, '0');
      return '${two(d.month)}/${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.subTextColor.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '연속 번역 목록'
                  '${q != null ? ' · 대기 ${q.pendingCount}' : ''}'
                  '${q != null && q.failedCount > 0 ? ' · 실패 ${q.failedCount}' : ''}',
                  style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold),
                ),
              ),
              IconButton(
                tooltip: '소설 추가',
                icon: const Icon(Icons.add_circle_outline_rounded),
                onPressed: _error != null && _offline ? null : _addQueueUrlsDialog,
              ),
            ],
          ),
          if (q == null)
            Text('불러오는 중...', style: TextStyle(color: theme.subTextColor, fontSize: 12))
          else ...[
            SwitchListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('목록 자동 진행', style: TextStyle(color: theme.textColor, fontSize: 13)),
              subtitle: Text(q.running ? '켜짐 · 앞에서부터 차례로 번역해요' : '꺼짐 · 멈춰 있어요',
                  style: TextStyle(color: theme.subTextColor, fontSize: 11)),
              value: q.running,
              onChanged: (v) => _queueAction(() => RemoteControlService.setQueueConfig(running: v),
                  okMessage: v ? '목록 진행을 시작했어요' : '목록 진행을 멈췄어요'),
            ),
            SwitchListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('신데렐라 모드', style: TextStyle(color: theme.textColor, fontSize: 13)),
              subtitle: Text('17시 쿼터 중단 후 다음 날 자동 재개 · 문제가 있는 소설은 건너뛰어요',
                  style: TextStyle(color: theme.subTextColor, fontSize: 11)),
              value: q.cinderella,
              onChanged: (v) => _queueAction(() => RemoteControlService.setQueueConfig(cinderella: v)),
            ),
            const Divider(height: 16),
            if (q.items.isEmpty)
              Text('목록이 비어 있어요. 오른쪽 위 + 로 소설을 추가하세요.',
                  style: TextStyle(color: theme.subTextColor, fontSize: 12))
            else
              ReorderableListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                buildDefaultDragHandles: false,
                itemCount: q.items.length,
                onReorder: _reorderQueue,
                itemBuilder: (_, i) => _queueItemTile(q.items[i], i, theme),
              ),
            if (events.isNotEmpty) ...[
              const Divider(height: 16),
              Text('최근 이슈', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 4),
              ...events.map((e) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Text('${fmtTime(e.ts)}  ${e.message}',
                        style: TextStyle(color: theme.subTextColor, fontSize: 11), maxLines: 2, overflow: TextOverflow.ellipsis),
                  )),
            ],
          ],
        ],
      ),
    );
  }

  Widget _recentCommands(ReaderThemeData theme) {
    final list = _status?.recentCommands ?? [];
    if (list.isEmpty) return const SizedBox.shrink();
    String icon(String st) => switch (st) { 'done' => '✅', 'failed' => '❌', 'expired' => '⌛', _ => '⏳' };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('최근 명령', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        ...list.map((c) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Text(
                '${icon(c.status)} ${c.type}${c.resultMessage.isNotEmpty ? ' — ${c.resultMessage}' : ''}',
                style: TextStyle(color: theme.subTextColor, fontSize: 12),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            )),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        title: const Text('번역 리모컨'),
        backgroundColor: theme.background,
        foregroundColor: theme.textColor,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _statusCard(theme),
            const SizedBox(height: 16),
            _buttons(theme),
            const SizedBox(height: 16),
            _recentCommands(theme),
            const SizedBox(height: 16),
            _queueSection(theme),
          ],
        ),
      ),
    );
  }
}
