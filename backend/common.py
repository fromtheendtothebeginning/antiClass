# common.py — 全局常量与横切依赖：路径/限制/栏目映射、登录会话、限流、上传落盘

import hashlib
import os
import re
import shutil
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path

from fastapi import HTTPException

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_FILES = 5
MAX_TEXT_LEN = 2000
TOKEN_TTL = 12 * 3600
# 上传证据的危险类型黑名单：可执行/脚本/网页/Office 宏等一律拒收
DANGEROUS_EXT = {
    ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
    ".sh", ".bash", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".hta",
    ".html", ".htm", ".svg", ".xml", ".php", ".asp", ".aspx", ".jsp", ".cgi",
    ".jar", ".apk", ".py", ".rb", ".pl", ".php3", ".php5",
    ".docm", ".xlsm", ".pptm", ".mht", ".mhtml",
}
EVIDENCE_MEDIA = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".pdf": "application/pdf", ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}

CATEGORY_FIELD = {"德育": "deyu", "体育": "tiyu", "美育": "meiyu", "劳育": "laoyu", "附加分": "fujia"}
CATEGORY_CAP = {"德育": 100, "体育": 100, "美育": 100, "劳育": 100, "附加分": 5}
CLASS_ROLE_POINTS = {"班长、团支书、辅导员助理": 8, "副班长、学习委员": 4, "班级其他学干": 2}
ADJUST_FIELDS = {"deyu": "德育", "meiyu": "美育", "laoyu": "劳育", "fujia": "附加分"}
ADJUST_OPS = {"add", "sub", "set"}

TOKENS = {}
RATE_BUCKET = defaultdict(deque)


def rate_limit(key, limit, window):
    now = time.time()
    bucket = RATE_BUCKET[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="操作过于频繁，请稍后再试")
    bucket.append(now)


def save_upload(f, upload_dir):
    """保存上传文件，相同内容自动去重：首次写入 _content_hashes/，后续用软连接指向。

    Windows 不支持 os.symlink 时自动回退为复制。
    """
    suffix = Path(f.filename or "file").suffix.lower()
    if suffix in DANGEROUS_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"文件 {f.filename} 类型不允许上传（{suffix}），请转换为图片/PDF/Word 等普通文档",
        )
    original_name = Path(f.filename or "file").name
    # 读取全部内容以计算哈希（文件上限 10 MB，内存可承受）
    content = b""
    size = 0
    while True:
        chunk = f.file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"文件 {f.filename} 超过大小限制（10MB）")
        content += chunk
    content_hash = hashlib.sha256(content).hexdigest()
    hash_dir = UPLOADS_DIR / "_content_hashes"
    hash_dir.mkdir(parents=True, exist_ok=True)
    canonical = hash_dir / f"{content_hash}_{original_name}"
    if not canonical.exists():
        canonical.write_bytes(content)
    # 在目标目录创建软连接指向内容寻址存储的原始文件
    name = f"{uuid.uuid4().hex}_{original_name}"
    target = upload_dir / name
    rel = os.path.relpath(canonical, upload_dir)
    try:
        os.symlink(rel, target)
    except OSError:
        # Windows 等不支持 symlink 的环境：回退为复制
        shutil.copy2(canonical, target)
    return name


def require_token(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.split(" ", 1)[1]
    session = TOKENS.get(token)
    if session is None:
        raise HTTPException(status_code=401, detail="token 无效或已过期")
    if time.time() - session["exp"] > TOKEN_TTL:
        TOKENS.pop(token, None)
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    return session


def require_root(authorization):
    session = require_token(authorization)
    if session["role"] != "root":
        raise HTTPException(status_code=403, detail="需要 root 权限")
    return session


def check_class_scope(session, class_id):
    """admin 只能操作本班；root 不限。"""
    if session["role"] == "root":
        return
    if session.get("class_id") != class_id:
        raise HTTPException(status_code=403, detail="只能管理本班级的数据")


def find_student(sid):
    return db.get_student(sid)
