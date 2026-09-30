# drafts.py — AI 分析草稿存储（MySQL 持久化，重启不丢）：超量/过期清理连带回收证据目录

import shutil
from datetime import datetime, timedelta

import db
from common import UPLOADS_DIR

MAX_DRAFTS = 200
DRAFT_TTL = 24 * 3600


def _drop_folder_if_unused(folder):
    if folder and not db.folder_in_use(folder):
        shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)


def create(draft):
    db.insert_draft(draft)
    purge_expired()
    for d in db.evict_drafts_beyond(MAX_DRAFTS):
        _drop_folder_if_unused(d["folder"])


def get(draft_id):
    return db.get_draft(draft_id)


def pop(draft_id):
    d = db.get_draft(draft_id)
    if d:
        db.delete_draft(draft_id)
    return d


def purge_expired():
    for d in db.list_drafts_before(datetime.now() - timedelta(seconds=DRAFT_TTL)):
        db.delete_draft(d["id"])
        _drop_folder_if_unused(d["folder"])
