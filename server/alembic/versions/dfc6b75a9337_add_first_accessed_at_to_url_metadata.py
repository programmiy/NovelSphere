'''Add first_accessed_at to url_metadata

Revision ID: dfc6b75a9337
Revises: 
Create Date: 2025-11-06 17:35:09.739606

'''
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dfc6b75a9337'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('applied_urls', schema=None) as batch_op:
        batch_op.alter_column('url', existing_type=sa.TEXT(), nullable=False)

    with op.batch_alter_table('book_activity', schema=None) as batch_op:
        batch_op.alter_column('folderName', existing_type=sa.TEXT(), nullable=False)

    with op.batch_alter_table('excluded_sentences', schema=None) as batch_op:
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=False, autoincrement=True)
        batch_op.create_index('ix_excluded_url_original', ['url', 'original'], unique=False)
        batch_op.create_unique_constraint('_url_original_uc', ['url', 'original'])

    with op.batch_alter_table('pinned_books', schema=None) as batch_op:
        batch_op.alter_column('folderName', existing_type=sa.TEXT(), nullable=False)

    with op.batch_alter_table('tags', schema=None) as batch_op:
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=False, autoincrement=True)

    with op.batch_alter_table('translations', schema=None) as batch_op:
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=False, autoincrement=True)
        batch_op.create_index('ix_folderName', ['folderName'], unique=False)
        batch_op.create_index('ix_url', ['url'], unique=False)
        batch_op.create_unique_constraint('_url_pid_original_uc', ['url', 'pid', 'original'])
        batch_op.drop_column('sort_order_text')
        batch_op.drop_column('sort_order')

    with op.batch_alter_table('url_metadata', schema=None) as batch_op:
        batch_op.add_column(sa.Column('first_accessed_at', sa.BigInteger(), nullable=True))
        batch_op.alter_column('url', existing_type=sa.TEXT(), nullable=False)
        batch_op.create_index('ix_url_metadata_sort_order', ['sort_order'], unique=False)

    # ### Backfill first_accessed_at for existing data ###
    op.execute("""
    UPDATE url_metadata
    SET first_accessed_at = (
        SELECT MIN(T.timestamp)
        FROM translations AS T
        WHERE T.url = url_metadata.url
    )
    WHERE EXISTS (
        SELECT 1
        FROM translations AS T
        WHERE T.url = url_metadata.url
    )
    """)
    # ### end Backfill ###

def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('url_metadata', schema=None) as batch_op:
        batch_op.drop_index('ix_url_metadata_sort_order')
        batch_op.alter_column('url', existing_type=sa.TEXT(), nullable=True)
        batch_op.drop_column('first_accessed_at')

    with op.batch_alter_table('translations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sort_order', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('sort_order_text', sa.TEXT(), nullable=True))
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=True, autoincrement=True)
        batch_op.drop_constraint('_url_pid_original_uc', type_='unique')
        batch_op.drop_index('ix_url')
        batch_op.drop_index('ix_folderName')

    with op.batch_alter_table('tags', schema=None) as batch_op:
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=True, autoincrement=True)

    with op.batch_alter_table('pinned_books', schema=None) as batch_op:
        batch_op.alter_column('folderName', existing_type=sa.TEXT(), nullable=True)

    with op.batch_alter_table('excluded_sentences', schema=None) as batch_op:
        batch_op.drop_constraint('_url_original_uc', type_='unique')
        batch_op.drop_index('ix_excluded_url_original')
        batch_op.alter_column('id', existing_type=sa.INTEGER(), nullable=True, autoincrement=True)

    with op.batch_alter_table('book_activity', schema=None) as batch_op:
        batch_op.alter_column('folderName', existing_type=sa.TEXT(), nullable=True)

    with op.batch_alter_table('applied_urls', schema=None) as batch_op:
        batch_op.alter_column('url', existing_type=sa.TEXT(), nullable=True)

