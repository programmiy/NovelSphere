
from sqlalchemy import (create_engine, Column, Integer, Text, 
                        ForeignKey, UniqueConstraint, Index, BigInteger)
from sqlalchemy.orm import declarative_base
from sqlalchemy.ext.declarative import declarative_base

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
    is_bookmarked = Column(Integer, default=0)
    notes = Column(Text)
    summary = Column(Text)
    summary_source_url = Column(Text)

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


