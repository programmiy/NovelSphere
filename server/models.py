
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

