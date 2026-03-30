"""add toc_sort_order to translations

Revision ID: 4e7ec2137dd4
Revises: dfc6b75a9337
Create Date: 2025-11-08 01:06:56.915087

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4e7ec2137dd4'
down_revision: Union[str, Sequence[str], None] = 'dfc6b75a9337'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('translations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('toc_sort_order', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('translations', schema=None) as batch_op:
        batch_op.drop_column('toc_sort_order')

