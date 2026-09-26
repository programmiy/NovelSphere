class AppNotification {
  final String id;
  final String title;
  final String message;
  final String type; // complete, progress, episode_milestone, error, cleanup, task
  final String? bookTitle;
  final String? chapterTitle;
  final String? clickUrl;
  final String priority;
  final int timestamp;
  bool isRead;

  AppNotification({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    this.bookTitle,
    this.chapterTitle,
    this.clickUrl,
    required this.priority,
    required this.timestamp,
    this.isRead = false,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      message: json['message'] ?? '',
      type: json['type'] ?? 'general',
      bookTitle: json['book_title'],
      chapterTitle: json['chapter_title'],
      clickUrl: json['click_url'],
      priority: json['priority'] ?? 'default',
      timestamp: json['timestamp'] ?? 0,
    );
  }
}
