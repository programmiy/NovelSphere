import 'package:flutter/widgets.dart';

/// 디바이스 폼팩터(바형 스마트폰 vs 태블릿) 판별 유틸리티.
///
/// Material Design 기준 `shortestSide >= 600.0`을 태블릿으로 간주합니다.
class DeviceUtils {
  DeviceUtils._();

  static const double tabletShortestSideThreshold = 600.0;

  /// 논리 픽셀 기준 최단 변(`shortestSide`)이 태블릿 기준인지 판별합니다.
  static bool isTabletWidth(double shortestSide) {
    return shortestSide >= tabletShortestSideThreshold;
  }

  /// 현재 `BuildContext`의 `MediaQuery`를 기반으로 태블릿 여부를 반환합니다.
  ///
  /// 주의: `initState()` 내부에서는 동기 호출하지 말고 `build()`나 사용자 이벤트 핸들러에서 호출하세요.
  static bool isTablet(BuildContext context) {
    final shortestSide = MediaQuery.of(context).size.shortestSide;
    return isTabletWidth(shortestSide);
  }
}
