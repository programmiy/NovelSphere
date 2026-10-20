
from datetime import datetime
from sqlalchemy import (Column, Integer, Text, String, DateTime,
                        ForeignKey, UniqueConstraint, Index, BigInteger)
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Translation(Base):
    __tablename__ = 'translations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(Text, nullable=False)
    pid = Column(Text)
    original = Column(Text, nullable=False)
    translated = Column(Text)
    timestamp = Column(Integer, nullable=False)
    folderName = Column(Text)
    title = Column(Text)
    toc_sort_order = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint('url', 'pid', 'original', name='_url_pid_original_uc'),
        Index('ix_url', 'url'),
        Index('ix_folderName', 'folderName'),
        Index('ix_title', 'title'),
        Index('ix_folder_title', 'folderName', 'title'),
        Index('ix_folder_url', 'folderName', 'url'),
    )

class ExcludedSentence(Base):
    __tablename__ = 'excluded_sentences'
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(Text, nullable=False)
    original = Column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint('url', 'original', name='_url_original_uc'),
        Index('ix_excluded_url_original', 'url', 'original'),
    )

class PinnedBook(Base):
    __tablename__ = 'pinned_books'
    folderName = Column(Text, primary_key=True)

class Tag(Base):
    __tablename__ = 'tags'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False, unique=True)

class BookTag(Base):
    __tablename__ = 'book_tags'
    book_folderName = Column(Text, primary_key=True)
    tag_id = Column(Integer, ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True)

class BookActivity(Base):
    __tablename__ = 'book_activity'
    folderName = Column(Text, primary_key=True)
    last_read_timestamp = Column(Integer)
    last_read_pid = Column(Text)
    last_read_chapter_title = Column(Text)
    is_completed = Column(Integer, default=0)
    is_visible = Column(Integer, default=1)
    is_bookmarked = Column(Integer, default=0)
    notes = Column(Text)
    summary = Column(Text)
    summary_source_url = Column(Text)

    __table_args__ = (
        Index('ix_book_activity_is_visible', 'is_visible'),
    )

class AppliedUrl(Base):
    __tablename__ = 'applied_urls'
    url = Column(Text, primary_key=True)

class UrlMetadata(Base):
    __tablename__ = 'url_metadata'
    url = Column(Text, primary_key=True)
    sort_order = Column(Integer)
    # New column to be added
    first_accessed_at = Column(BigInteger)

    __table_args__ = (
        Index('ix_url_metadata_sort_order', 'sort_order'),
    )

class NovelSeparatorSetting(Base):
    __tablename__ = 'novel_separator_settings'
    novel_title = Column(Text, primary_key=True)
    separators = Column(Text, nullable=False, default='[]') # JSON array of separator strings
    use_defaults = Column(Integer, default=1) # 1 if true, 0 if false
    updated_at = Column(BigInteger, nullable=True)

class TranslationTrash(Base):
    __tablename__ = 'translation_trash'
    id = Column(Integer, primary_key=True, autoincrement=True)
    original_translation_id = Column(Integer, nullable=True)
    url = Column(Text, nullable=False)
    pid = Column(Text)
    original = Column(Text, nullable=False)
    translated = Column(Text)
    timestamp = Column(Integer, nullable=False)
    folderName = Column(Text)
    title = Column(Text)
    toc_sort_order = Column(Integer, nullable=True)
    reason_category = Column(Text, nullable=True) # 'verbatim', 'paraphrased', 'other_lang'
    deleted_at = Column(BigInteger, nullable=False)
    cleanup_batch_id = Column(Text, nullable=True)

    __table_args__ = (
        Index('ix_trash_url', 'url'),
        Index('ix_trash_deleted_at', 'deleted_at'),
        Index('ix_trash_batch_id', 'cleanup_batch_id'),
    )

class CleanupNotification(Base):
    __tablename__ = 'cleanup_notifications'
    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Text, nullable=False)
    novel_title = Column(Text, nullable=True)
    episode_title = Column(Text, nullable=True)
    url = Column(Text, nullable=False)
    deleted_count = Column(Integer, default=0)
    is_dismissed = Column(Integer, default=0) # 0: active, 1: dismissed
    created_at = Column(BigInteger, nullable=False)
    dismissed_at = Column(BigInteger, nullable=True)

    __table_args__ = (
        Index('ix_notif_batch_id', 'batch_id'),
        Index('ix_notif_is_dismissed', 'is_dismissed'),
        Index('ix_notif_created_at', 'created_at'),
    )

class CleanupQueuedItem(Base):
    __tablename__ = 'cleanup_queued_items'
    translation_id = Column(Integer, primary_key=True)
    queued_at = Column(BigInteger, nullable=False)

class AbnormalWhitelist(Base):
    __tablename__ = 'abnormal_whitelist'
    id = Column(Integer, primary_key=True, autoincrement=True)
    translation_id = Column(Integer, nullable=False, index=True)
    url = Column(Text, nullable=True)
    pid = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_abnormal_wl_url_pid', 'url', 'pid'),
    )

class ApiCallLog(Base):
    __tablename__ = 'api_call_logs'
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(Integer, nullable=False, index=True)
    model = Column(Text, nullable=True)
    status_code = Column(Integer, default=200)





class AiReviewQueue(Base):
    __tablename__ = 'ai_review_queue'
    id = Column(Integer, primary_key=True, autoincrement=True)
    translation_id = Column(Integer, ForeignKey('translations.id', ondelete='CASCADE'), nullable=False, unique=True)
    original_text = Column(Text, nullable=False)
    old_translated_text = Column(Text)
    ai_translated_text = Column(Text)
    status = Column(Text, nullable=False, default='pending_review') # pending_review, pending_reretranslate, approved, rejected
    model_used = Column(Text)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_ai_review_status', 'status'),
    )


class SystemTask(Base):
    __tablename__ = 'system_tasks'

    id = Column(String(64), primary_key=True)
    task_type = Column(String(64), nullable=False)
    status = Column(String(32), default="PENDING")  # PENDING, RUNNING, DONE, FAILED, CANCELLED, INTERRUPTED
    progress = Column(Integer, default=0)
    total_items = Column(Integer, default=0)
    processed_items = Column(Integer, default=0)
    result_data = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('ix_system_tasks_status', 'status'),
        Index('ix_system_tasks_created_at', 'created_at'),
    )


class SpecialBatchQueue(Base):
    __tablename__ = 'special_batch_queue'

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(64), index=True, nullable=False)
    url = Column(Text, index=True, nullable=False)
    folder_name = Column(Text, index=True, nullable=True, default=None)
    chapter_title = Column(Text, default="")
    chapter_index = Column(Integer, default=0)
    pid = Column(String(64), nullable=False)
    original_text = Column(Text, nullable=False)
    translated_text = Column(Text, nullable=False)
    status = Column(String(32), default="staged", index=True)  # staged, approved, skipped
    created_at = Column(BigInteger, nullable=False)
    promoted_at = Column(BigInteger, nullable=True)

    __table_args__ = (
        Index('ix_special_batch_folder_status', 'folder_name', 'status'),
        Index('ix_special_batch_url_pid', 'url', 'pid'),
    )

class NovelQueueItem(Base):
    """다음에 번역할 소설 목록 (소설 개요 페이지 URL 1개 = 1행)"""
    __tablename__ = 'novel_queue_items'

    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(Text, nullable=False, unique=True)          # 정규화된 개요 페이지 URL
    site = Column(String(32), nullable=False)                # kakuyomu / ncode / nocturne
    title = Column(Text, default="")
    position = Column(Integer, nullable=False, default=0)    # 작은 값이 먼저
    status = Column(String(16), nullable=False, default="pending", index=True)  # pending, running, done, failed
    fail_reason = Column(Text, default="")
    attempts = Column(Integer, default=0)                    # 시작 URL 계산/접속 실패 누적 횟수
    next_attempt_at = Column(BigInteger, nullable=True)      # 다음 재시도 시각(epoch 초)
    start_url = Column(Text, default="")                     # 마지막으로 계산된 시작 회차 URL
    created_at = Column(BigInteger, nullable=False)
    started_at = Column(BigInteger, nullable=True)
    finished_at = Column(BigInteger, nullable=True)


class NovelQueueEvent(Base):
    """목록 진행 이력 (리모컨 '최근 이슈' 표시용)"""
    __tablename__ = 'novel_queue_events'

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(BigInteger, nullable=False, index=True)
    kind = Column(String(24), nullable=False)   # novel_done, novel_start, failed, skipped, cinderella, list_done, halted
    message = Column(Text, nullable=False)
    item_id = Column(Integer, nullable=True)


class RemoteSetting(Base):
    """원격 제어/목록 설정 key-value (예: cinderella, queue_running)"""
    __tablename__ = 'remote_settings'

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False, default="")
