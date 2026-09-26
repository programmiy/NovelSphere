import 'package:flutter/material.dart';
import 'package:network_info_plus/network_info_plus.dart';

import '../../services/app_update_service.dart';
import '../../services/local_notification_service.dart';
import '../../services/notification_service.dart';
import '../../services/preferences_service.dart';
import '../../services/status_dashboard_service.dart';
import '../../services/sync_service.dart';
import '../themes/reader_themes.dart';

class SettingsScreen extends StatefulWidget {
  final VoidCallback onThemeChanged;

  const SettingsScreen({super.key, required this.onThemeChanged});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _wifi1Controller = TextEditingController();
  final TextEditingController _wifi2Controller = TextEditingController();
  final TextEditingController _serverUrlController = TextEditingController();

  String _currentWifiSsid = '확인 중...';
  bool _isTrustedWifi = false;
  bool _isCheckingServer = false;
  String _serverStatusText = '확인 전';
  Color _serverStatusColor = Colors.grey;

  bool _hideWifiSection = false;
  bool _hideServerSection = false;

  bool _enableSystemNotification = true;
  bool _enableDashboardNotification = true;

  bool _isSyncing = false;
  double _syncProgress = 0.0;
  String _syncStatusMessage = '';

  String _appVersionText = '확인 중...';
  bool _isCheckingUpdate = false;

  @override
  void initState() {
    super.initState();
    _wifi1Controller.text = PreferencesService.trustedWifi1;
    _wifi2Controller.text = PreferencesService.trustedWifi2;
    _serverUrlController.text = PreferencesService.serverUrl;
    _hideWifiSection = PreferencesService.hideWifiSection;
    _hideServerSection = PreferencesService.hideServerSection;
    _enableSystemNotification = PreferencesService.enableSystemNotification;
    _enableDashboardNotification = PreferencesService.enableDashboardNotification;
    _checkCurrentWifi();
    _loadAppVersion();
  }

  Future<void> _loadAppVersion() async {
    try {
      final info = await AppUpdateService.getPackageInfo();
      if (mounted) {
        setState(() {
          _appVersionText = 'v${info.version} (빌드 ${info.buildNumber})';
        });
      }
    } catch (_) {}
  }

  Future<void> _autoRegisterCurrentWifi() async {
    final info = NetworkInfo();
    String? ssid;
    try {
      ssid = await info.getWifiName();
      ssid = ssid?.replaceAll('"', '').trim();
    } catch (_) {}

    if (ssid == null || ssid.isEmpty || ssid.contains('연결 안 됨') || ssid.contains('확인 불가')) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('현재 활성화된 Wi-Fi 네트워크를 감지할 수 없습니다. Wi-Fi 연결을 확인해주세요.')),
        );
      }
      return;
    }

    // Wi-Fi 1이 비어있거나 동일하면 1에, 아니면 Wi-Fi 2가 비어있으면 2에, 둘 다 차있으면 1을 갱신
    if (_wifi1Controller.text.trim().isEmpty || _wifi1Controller.text.trim() == ssid) {
      _wifi1Controller.text = ssid;
    } else if (_wifi2Controller.text.trim().isEmpty) {
      _wifi2Controller.text = ssid;
    } else {
      _wifi1Controller.text = ssid;
    }

    await PreferencesService.setTrustedWifi1(_wifi1Controller.text.trim());
    await PreferencesService.setTrustedWifi2(_wifi2Controller.text.trim());
    await _checkCurrentWifi();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('현재 Wi-Fi ("$ssid")가 신뢰 네트워크로 자동 등록되었습니다.'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  Future<void> _toggleHideWifiSection() async {
    final next = !_hideWifiSection;
    setState(() => _hideWifiSection = next);
    await PreferencesService.setHideWifiSection(next);
  }

  Future<void> _toggleHideServerSection() async {
    final next = !_hideServerSection;
    setState(() => _hideServerSection = next);
    await PreferencesService.setHideServerSection(next);
  }

  Future<void> _checkCurrentWifi() async {
    final info = NetworkInfo();
    try {
      String? ssid = await info.getWifiName();
      ssid = ssid?.replaceAll('"', '').trim() ?? '연결 안 됨 / 모바일 데이터';
      final isTrusted = await SyncService.isConnectedToTrustedWifi();
      setState(() {
        _currentWifiSsid = ssid!;
        _isTrustedWifi = isTrusted;
      });
    } catch (_) {
      setState(() {
        _currentWifiSsid = '확인 불가';
        _isTrustedWifi = false;
      });
    }
  }

  Future<void> _saveSettings() async {
    final normalized = PreferencesService.normalizeServerUrl(_serverUrlController.text.trim());
    _serverUrlController.text = normalized;
    await PreferencesService.setTrustedWifi1(_wifi1Controller.text.trim());
    await PreferencesService.setTrustedWifi2(_wifi2Controller.text.trim());
    await PreferencesService.setServerUrl(normalized);
    await PreferencesService.setEnableSystemNotification(_enableSystemNotification);
    await PreferencesService.setEnableDashboardNotification(_enableDashboardNotification);

    if (_enableDashboardNotification) {
      StatusDashboardService.start();
      await StatusDashboardService.syncStatus();
    } else {
      StatusDashboardService.stop();
      await LocalNotificationService.cancelDashboardNotification();
    }

    await _checkCurrentWifi();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('동기화 및 알림 설정이 저장되었습니다.')),
      );
    }
  }

  Future<void> _syncDashboardNow() async {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('번역 현황판 알림을 갱신하는 중...')),
      );
    }
    await StatusDashboardService.syncStatus();
  }

  Future<void> _sendTestNotification() async {
    await NotificationService.sendTestNotification();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('테스트 알림이 발송되었습니다. 스마트폰 상단바를 확인해주세요!'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  Future<void> _testServerPing() async {
    final typedUrl = PreferencesService.normalizeServerUrl(_serverUrlController.text.trim());
    _serverUrlController.text = typedUrl;
    await PreferencesService.setServerUrl(typedUrl);

    setState(() {
      _isCheckingServer = true;
      _serverStatusText = '연결 확인 중...';
      _serverStatusColor = Colors.orange;
    });

    final isAlive = await SyncService.pingServer(typedUrl);

    setState(() {
      _isCheckingServer = false;
      if (isAlive) {
        _serverStatusText = '온라인 (PC 서버 정상 응답)';
        _serverStatusColor = Colors.green;
      } else {
        _serverStatusText = '오프라인 (서버 응답 없음 - IP/포트 확인)';
        _serverStatusColor = Colors.redAccent;
      }
    });
  }

  Future<void> _runFullSeedDownload() async {
    final typedUrl = PreferencesService.normalizeServerUrl(_serverUrlController.text.trim());
    _serverUrlController.text = typedUrl;
    await PreferencesService.setServerUrl(typedUrl);

    setState(() {
      _isSyncing = true;
      _syncProgress = 0.0;
      _syncStatusMessage = 'PC 서버에서 23만 문장 압축 패키지 생성 및 다운로드 중...';
    });

    final result = await SyncService.downloadFullSeed(
      ignoreWifiCheck: true,
      onProgress: (progress) {
        setState(() => _syncProgress = progress);
      },
    );

    setState(() {
      _isSyncing = false;
      _syncStatusMessage = result.message;
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.message),
          backgroundColor: result.success ? Colors.green : Colors.redAccent,
        ),
      );
    }
  }

  Future<void> _runIncrementalSync() async {
    final typedUrl = PreferencesService.normalizeServerUrl(_serverUrlController.text.trim());
    _serverUrlController.text = typedUrl;
    await PreferencesService.setServerUrl(typedUrl);

    setState(() {
      _isSyncing = true;
      _syncStatusMessage = '양방향 증분 동기화 진행 중...';
    });

    final result = await SyncService.performIncrementalSync(ignoreWifiCheck: true);

    setState(() {
      _isSyncing = false;
      _syncStatusMessage = result.message;
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.message),
          backgroundColor: result.success ? Colors.green : Colors.redAccent,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        title: Text(
          '동기화 & 앱 설정',
          style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          TextButton(
            onPressed: _saveSettings,
            child: Text('저장', style: TextStyle(color: theme.accentColor, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // 1. 신뢰 Wi-Fi 2개 설정 섹션 (사용자 코멘트 반영)
          _buildSectionHeader(
            theme,
            '신뢰 Wi-Fi 동기화 보안 (최대 2개 등록)',
            Icons.wifi_lock_rounded,
            isCollapsible: true,
            isCollapsed: _hideWifiSection,
            onToggle: _toggleHideWifiSection,
          ),
          const SizedBox(height: 8),
          if (_hideWifiSection)
            _buildCollapsedWifiCard(theme)
          else
            _buildExpandedWifiCard(theme),
          const SizedBox(height: 24),

          // 2. PC 서버 연결 섹션
          _buildSectionHeader(
            theme,
            'PC LANOVEL 서버 연동',
            Icons.computer_rounded,
            isCollapsible: true,
            isCollapsed: _hideServerSection,
            onToggle: _toggleHideServerSection,
          ),
          const SizedBox(height: 8),
          if (_hideServerSection)
            _buildCollapsedServerCard(theme)
          else
            _buildExpandedServerCard(theme),
          const SizedBox(height: 24),

          // 3. 수동 동기화 트리거
          _buildSectionHeader(theme, '수동 동기화 작업', Icons.sync_rounded),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.surfaceColor,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.borderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_isSyncing) ...[
                  LinearProgressIndicator(
                    value: _syncProgress > 0 ? _syncProgress : null,
                    color: theme.accentColor,
                    backgroundColor: theme.borderColor,
                  ),
                  const SizedBox(height: 8),
                  Text(_syncStatusMessage, style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                  const SizedBox(height: 16),
                ],
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: theme.accentColor,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 46),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: _isSyncing ? null : _runIncrementalSync,
                  icon: const Icon(Icons.sync_alt_rounded),
                  label: const Text('양방향 증분 동기화 (최신 번역문 & 진도 반영)'),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.textColor,
                    side: BorderSide(color: theme.borderColor),
                    minimumSize: const Size(double.infinity, 44),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: _isSyncing ? null : _runFullSeedDownload,
                  icon: const Icon(Icons.cloud_download_outlined),
                  label: const Text('전체 서재 시드 다운로드 (최초 1회, 약 26MB)'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // 4. 실시간 작업 알림 & 푸시 설정 (Phase 2)
          _buildSectionHeader(theme, '실시간 작업 알림 & 푸시', Icons.notifications_active_rounded),
          const SizedBox(height: 8),
          _buildNotificationSettingsCard(theme),
          const SizedBox(height: 24),

          // 5. 앱 버전 및 무선 자동 업데이트 (OTA)
          _buildSectionHeader(theme, '앱 버전 & 무선 자동 업데이트 (OTA)', Icons.system_update_rounded),
          const SizedBox(height: 8),
          _buildAppUpdateCard(theme),
        ],
      ),
    );
  }

  // 알림 설정 카드 (통합 현황판)
  Widget _buildNotificationSettingsCard(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              '스마트폰 시스템 상단바 알림',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 13),
            ),
            subtitle: Text(
              '소설 번역, 다운로드 완료 시 안드로이드 상태표시줄 푸시 알림을 띄웁니다.',
              style: TextStyle(color: theme.subTextColor, fontSize: 11),
            ),
            value: _enableSystemNotification,
            activeColor: theme.accentColor,
            onChanged: (val) {
              setState(() => _enableSystemNotification = val);
            },
          ),
          Divider(color: theme.borderColor, height: 20),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              '번역 작업 통합 현황판 (배민 알림 스타일)',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 13),
            ),
            subtitle: Text(
              '화별 반복 알림 대신 단일 알림창에서 실시간 번역 진행률, 검수 대기, Gemini API 오류 현황을 표시합니다. (삼성 Now Bar/잠금화면 지원)',
              style: TextStyle(color: theme.subTextColor, fontSize: 11),
            ),
            value: _enableDashboardNotification,
            activeColor: theme.accentColor,
            onChanged: (val) {
              setState(() => _enableDashboardNotification = val);
            },
          ),
          if (_enableDashboardNotification) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.background,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: theme.borderColor.withOpacity(0.5)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline_rounded, size: 16, color: theme.accentColor),
                      const SizedBox(width: 6),
                      Text(
                        '현황판 알림 동작 안내',
                        style: TextStyle(color: theme.textColor, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '• 번역 작업이 없고 대기 검수 및 오류가 없으면 상단바가 자동으로 정리됩니다.\n• 15분 주기 스마트 조회로 배터리 소모를 극소화합니다.\n• One UI 잠금화면 및 Now Bar에 실시간 진행 상황이 연동됩니다.',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.accentColor,
                side: BorderSide(color: theme.accentColor),
                minimumSize: const Size(double.infinity, 40),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: _syncDashboardNow,
              icon: const Icon(Icons.sync_rounded, size: 18),
              label: const Text('현황판 알림 즉시 갱신', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            ),
          ],
          const SizedBox(height: 12),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: theme.subTextColor,
              side: BorderSide(color: theme.borderColor),
              minimumSize: const Size(double.infinity, 40),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: _sendTestNotification,
            icon: const Icon(Icons.notifications_active_outlined, size: 18),
            label: const Text('스마트폰 상단바 테스트 알림 띄우기', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // 앱 버전 및 무선 자동 업데이트 카드
  Widget _buildAppUpdateCard(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.phone_android_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '현재 설치된 버전',
                  style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 13),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.borderColor.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  _appVersionText,
                  style: TextStyle(color: theme.textColor, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'PC 서버에서 새 버전이 감지되면 수동 파일 전송 없이 앱 안에서 바로 다운로드 및 설치를 진행합니다.',
            style: TextStyle(color: theme.subTextColor, fontSize: 11, height: 1.4),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: theme.accentColor,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 44),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: _isCheckingUpdate
                ? null
                : () async {
                    setState(() => _isCheckingUpdate = true);
                    await AppUpdateService.checkForUpdate(
                      silent: false,
                      context: context,
                    );
                    if (mounted) {
                      setState(() => _isCheckingUpdate = false);
                    }
                  },
            icon: _isCheckingUpdate
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.refresh_rounded, size: 18),
            label: Text(_isCheckingUpdate ? '서버 버전 확인 중...' : '최신 버전 확인 및 원클릭 업데이트'),
          ),
        ],
      ),
    );
  }

  // 접힌 상태의 Wi-Fi 간략 요약 카드
  Widget _buildCollapsedWifiCard(ReaderThemeData theme) {
    final wifi1 = _wifi1Controller.text.trim();
    final wifi2 = _wifi2Controller.text.trim();
    final registeredList = [if (wifi1.isNotEmpty) wifi1, if (wifi2.isNotEmpty) wifi2];
    final registeredText = registeredList.isNotEmpty ? registeredList.join(', ') : '등록된 Wi-Fi 없음';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Row(
        children: [
          Icon(
            _isTrustedWifi ? Icons.check_circle : Icons.wifi_protected_setup_rounded,
            color: _isTrustedWifi ? Colors.green : theme.accentColor,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '신뢰 Wi-Fi 보호 활성화됨',
                  style: TextStyle(color: theme.textColor, fontWeight: FontWeight.w600, fontSize: 13),
                ),
                const SizedBox(height: 2),
                Text(
                  '등록: $registeredText (현재: $_currentWifiSsid)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.subTextColor, fontSize: 11),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _toggleHideWifiSection,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text('설정/펼치기', style: TextStyle(color: theme.accentColor, fontSize: 12)),
          ),
        ],
      ),
    );
  }

  // 펼쳐진 상태의 Wi-Fi 전체 설정 카드
  Widget _buildExpandedWifiCard(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                _isTrustedWifi ? Icons.check_circle : Icons.warning_amber_rounded,
                color: _isTrustedWifi ? Colors.green : Colors.orange,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '현재 접속 Wi-Fi: $_currentWifiSsid',
                  style: TextStyle(color: theme.textColor, fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ),
              IconButton(
                icon: Icon(Icons.refresh, color: theme.subTextColor, size: 20),
                onPressed: _checkCurrentWifi,
              ),
            ],
          ),
          Text(
            _isTrustedWifi
                ? '등록된 신뢰 Wi-Fi에 연결되어 있어 자동/백그라운드 동기화가 활성화됩니다.'
                : '등록되지 않은 네트워크입니다. 배터리 소모 방지를 위해 동기화가 차단됩니다.',
            style: TextStyle(color: theme.subTextColor, fontSize: 11),
          ),
          const SizedBox(height: 12),
          // [Issue 4] 현재 연결된 Wi-Fi 원터치 자동 등록 버튼
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: theme.accentColor,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 40),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: _autoRegisterCurrentWifi,
            icon: const Icon(Icons.wifi_find_rounded, size: 18),
            label: const Text('현재 연결된 Wi-Fi 자동 등록 (1탭 저장)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _wifi1Controller,
            style: TextStyle(color: theme.textColor, fontSize: 14),
            decoration: InputDecoration(
              labelText: '신뢰 Wi-Fi 1 (SSID)',
              labelStyle: TextStyle(color: theme.subTextColor),
              hintText: '예: MyHome_5G',
              suffixIcon: IconButton(
                icon: const Icon(Icons.input_rounded, size: 18),
                tooltip: '현재 Wi-Fi 입력',
                onPressed: () {
                  if (_currentWifiSsid.isNotEmpty && !_currentWifiSsid.contains('연결 안 됨')) {
                    _wifi1Controller.text = _currentWifiSsid;
                  }
                },
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _wifi2Controller,
            style: TextStyle(color: theme.textColor, fontSize: 14),
            decoration: InputDecoration(
              labelText: '신뢰 Wi-Fi 2 (SSID)',
              labelStyle: TextStyle(color: theme.subTextColor),
              hintText: '예: Office_WiFi',
              suffixIcon: IconButton(
                icon: const Icon(Icons.input_rounded, size: 18),
                tooltip: '현재 Wi-Fi 입력',
                onPressed: () {
                  if (_currentWifiSsid.isNotEmpty && !_currentWifiSsid.contains('연결 안 됨')) {
                    _wifi2Controller.text = _currentWifiSsid;
                  }
                },
              ),
            ),
          ),
          const SizedBox(height: 8),
          // [Issue 5] Wi-Fi 등록 후 가리기 버튼
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: _toggleHideWifiSection,
              icon: const Icon(Icons.visibility_off_outlined, size: 15),
              label: const Text('등록 완료 후 설정 영역 가리기', style: TextStyle(fontSize: 11)),
              style: TextButton.styleFrom(foregroundColor: theme.subTextColor),
            ),
          ),
        ],
      ),
    );
  }

  // 접힌 상태의 PC 서버 간략 카드
  Widget _buildCollapsedServerCard(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: _serverStatusColor, shape: BoxShape.circle),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'PC 서버: ${_serverUrlController.text.trim()}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.textColor, fontWeight: FontWeight.w600, fontSize: 13),
                ),
                const SizedBox(height: 2),
                Text(
                  _serverStatusText,
                  style: TextStyle(color: _serverStatusColor, fontSize: 11),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _toggleHideServerSection,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text('테스트/펼치기', style: TextStyle(color: theme.accentColor, fontSize: 12)),
          ),
        ],
      ),
    );
  }

  // 펼쳐진 상태의 PC 서버 연동 전체 카드
  Widget _buildExpandedServerCard(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _serverUrlController,
            style: TextStyle(color: theme.textColor, fontSize: 14),
            decoration: InputDecoration(
              labelText: 'PC 서버 주소 (IP:포트)',
              labelStyle: TextStyle(color: theme.subTextColor),
              hintText: 'http://192.168.219.103:8001',
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                avatar: const Icon(Icons.computer, size: 14),
                label: const Text('현재 PC 자동입력 (192.168.219.103:8001)', style: TextStyle(fontSize: 11)),
                onPressed: () {
                  setState(() {
                    _serverUrlController.text = 'http://192.168.219.103:8001';
                  });
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(color: _serverStatusColor, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 8),
                  Text(_serverStatusText, style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                ],
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.accentColor,
                  side: BorderSide(color: theme.accentColor),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onPressed: _isCheckingServer ? null : _testServerPing,
                icon: const Icon(Icons.network_ping_rounded, size: 16),
                label: const Text('연결 테스트'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // [Issue 6] 서버 연결 테스트 영역 가리기 버튼
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: _toggleHideServerSection,
              icon: const Icon(Icons.visibility_off_outlined, size: 15),
              label: const Text('서버 연결 설정 가리기', style: TextStyle(fontSize: 11)),
              style: TextButton.styleFrom(foregroundColor: theme.subTextColor),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(
    ReaderThemeData theme,
    String title,
    IconData icon, {
    bool isCollapsible = false,
    bool isCollapsed = false,
    VoidCallback? onToggle,
  }) {
    return InkWell(
      onTap: isCollapsible ? onToggle : null,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Icon(icon, color: theme.accentColor, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                style: TextStyle(color: theme.textColor, fontSize: 14, fontWeight: FontWeight.bold),
              ),
            ),
            if (isCollapsible)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    isCollapsed ? '펼치기' : '가리기',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    isCollapsed ? Icons.keyboard_arrow_down_rounded : Icons.keyboard_arrow_up_rounded,
                    color: theme.subTextColor,
                    size: 18,
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
