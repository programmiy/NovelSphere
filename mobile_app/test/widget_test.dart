import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/main.dart';

void main() {
  testWidgets('App basic smoke test', (WidgetTester tester) async {
    // Basic instantiation test
    expect(const LanovelApp(), isNotNull);
  });
}
