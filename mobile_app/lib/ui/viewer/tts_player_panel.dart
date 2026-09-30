import 'package:flutter/material.dart';
import '../../services/tts_audio_service.dart';
import '../themes/reader_themes.dart';

class TtsPlayerPanel extends StatefulWidget {
  final String bookName;
  final String chapterTitle;
  final ReaderThemeData theme;
  final VoidCallback onClose;

  const TtsPlayerPanel({
    super.key,
    required this.bookName,
    required this.chapterTitle,
    required this.theme,
    required this.onClose,
  });

  @override
  State<TtsPlayerPanel> createState() => _TtsPlayerPanelState();
}

class _TtsPlayerPanelState extends State<TtsPlayerPanel> {
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _checkAndPlay();
  }

  Future<void> _checkAndPlay() async {
    setState(() => _isLoading = true);
    final ok = await TtsAudioService.playChapterAudio(widget.bookName, widget.chapterTitle);
    setState(() => _isLoading = false);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('PC 서버에 생성된 TTS 오디오가 없거나 다운로드할 수 없습니다.'),
          backgroundColor: Colors.redAccent,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(Icons.headphones_rounded, color: theme.accentColor, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'TTS 낭독: ${widget.chapterTitle}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.textColor,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close, color: theme.subTextColor, size: 20),
                  onPressed: () {
                    TtsAudioService.stop();
                    widget.onClose();
                  },
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                // 10초 뒤로
                IconButton(
                  icon: Icon(Icons.replay_10_rounded, color: theme.textColor),
                  onPressed: () => TtsAudioService.seekRelative(-10),
                ),
                // 재생 / 일시정지
                if (_isLoading)
                  const SizedBox(
                    width: 32,
                    height: 32,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  IconButton(
                    iconSize: 40,
                    icon: Icon(
                      TtsAudioService.isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_fill_rounded,
                      color: theme.accentColor,
                    ),
                    onPressed: () async {
                      if (TtsAudioService.isPlaying) {
                        await TtsAudioService.pause();
                      } else {
                        await TtsAudioService.resume();
                      }
                      setState(() {});
                    },
                  ),
                // 10초 앞으로
                IconButton(
                  icon: Icon(Icons.forward_10_rounded, color: theme.textColor),
                  onPressed: () => TtsAudioService.seekRelative(10),
                ),
                // 배속 변경 버튼 (0.8x, 1.0x, 1.25x, 1.5x)
                TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    backgroundColor: theme.background,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: () {
                    final speeds = [0.8, 1.0, 1.25, 1.5, 2.0];
                    final currentIdx = speeds.indexOf(TtsAudioService.speed);
                    final nextSpeed = speeds[(currentIdx + 1) % speeds.length];
                    TtsAudioService.setSpeed(nextSpeed);
                    setState(() {});
                  },
                  child: Text(
                    '${TtsAudioService.speed}x',
                    style: TextStyle(
                      color: theme.accentColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
