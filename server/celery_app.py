
from celery import Celery
from server.settings import settings

celery_app = Celery(
    'tasks',
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=['server.routers.tasks']
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Seoul',
    enable_utc=True,
    task_always_eager=settings.celery_always_eager,
)

if __name__ == '__main__':
    celery_app.start()
