# db.py — MySQL 存储层：连接管理 / 建库建表 / JSON 存量数据一次性迁移

import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pymysql

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "db_config.json"
DATA_DIR = BASE_DIR / "data"


def _load_db_config():
    cfg = {}
    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError):
            cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    return {
        "host": os.environ.get("MYSQL_HOST", cfg.get("host", "127.0.0.1")),
        "port": int(os.environ.get("MYSQL_PORT", cfg.get("port", 3306))),
        "user": os.environ.get("MYSQL_USER", cfg.get("user", "root")),
        "password": os.environ.get("MYSQL_PASSWORD", cfg.get("password", "")),
    }


DB_CONFIG = {**_load_db_config(), "charset": "utf8mb4"}
DB_NAME = os.environ.get("MYSQL_DB", "scholarship")

STUDENT_FIELDS = ("sid", "name", "class_id", "semester_id", "course_count", "credits", "gpa", "deyu", "score", "tiyu", "meiyu", "laoyu", "fujia", "failed", "total")
AWARD_FIELDS = ("id", "sid", "name", "class_id", "semester_id", "category", "points", "basis", "evidence", "folder", "approved", "reject_reason", "created_at")
ADMIN_FIELDS = ("username", "role", "class_id", "created_at", "nickname")
FUND_FIELDS = ("id", "class_id", "kind", "amount", "title", "evidence", "created_by", "created_at")

# 学期档位固定（sort 取下标）；学年学期用于导出文件名，如「26-27上学期」
SEMESTER_LABELS = ["大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下"]
DEFAULT_SEMESTER = {"label": "大一下", "term": "25-26下学期"}

# 邀请码字符表：去掉 0/O/1/I 等易混字符，8 位足够防猜
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    semester_id CHAR(32) NOT NULL DEFAULT '',
    class_id CHAR(32) NOT NULL DEFAULT '',
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    course_count INT NOT NULL DEFAULT 0,
    credits DECIMAL(9,2) NOT NULL DEFAULT 0,
    gpa DECIMAL(7,2) NOT NULL DEFAULT 0,
    deyu DECIMAL(7,2) NOT NULL DEFAULT 0,
    score DECIMAL(7,2) NOT NULL DEFAULT 0,
    tiyu DECIMAL(7,2) NOT NULL DEFAULT 0,
    meiyu DECIMAL(7,2) NOT NULL DEFAULT 0,
    laoyu DECIMAL(7,2) NOT NULL DEFAULT 0,
    fujia DECIMAL(6,2) NOT NULL DEFAULT 0,
    failed TINYINT(1) NOT NULL DEFAULT 0,
    total DECIMAL(9,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (semester_id, class_id, sid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS awards (
    id CHAR(32) PRIMARY KEY,
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    class_id CHAR(32) NOT NULL DEFAULT '',
    semester_id CHAR(32) NOT NULL DEFAULT '',
    category VARCHAR(16) NOT NULL,
    points DECIMAL(6,1) NOT NULL DEFAULT 0,
    basis TEXT,
    evidence JSON NOT NULL,
    folder VARCHAR(64) NOT NULL DEFAULT '',
    approved VARCHAR(8) NOT NULL DEFAULT '否',
    reject_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS adjust_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL,
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    class_id CHAR(32) NOT NULL DEFAULT '',
    semester_id CHAR(32) NOT NULL DEFAULT '',
    field VARCHAR(8) NOT NULL,
    op VARCHAR(4) NOT NULL,
    points DECIMAL(7,2) NOT NULL DEFAULT 0,
    old DECIMAL(7,2) NOT NULL DEFAULT 0,
    new DECIMAL(7,2) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meta (
    k VARCHAR(32) PRIMARY KEY,
    v TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(64) PRIMARY KEY,
    v LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
    id CHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    row_count INT NOT NULL DEFAULT 0,
    source VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS semesters (
    id CHAR(32) PRIMARY KEY,
    label VARCHAR(16) NOT NULL,
    term VARCHAR(32) NOT NULL DEFAULT '',
    sort INT NOT NULL DEFAULT 99,
    is_open TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_semester_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS class_semesters (
    semester_id CHAR(32) NOT NULL,
    class_id CHAR(32) NOT NULL,
    row_count INT NOT NULL DEFAULT 0,
    source VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (semester_id, class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(32) PRIMARY KEY,
    salt CHAR(32) NOT NULL,
    password_hash CHAR(64) NOT NULL,
    role VARCHAR(8) NOT NULL DEFAULT 'admin',
    class_id CHAR(32) NULL,
    nickname VARCHAR(32) NOT NULL DEFAULT '',
    avatar MEDIUMTEXT,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invites (
    id CHAR(32) PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    class_id CHAR(32) NOT NULL,
    created_by VARCHAR(32) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    used_by VARCHAR(32) NULL,
    used_at DATETIME NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mcp_tokens (
    id CHAR(32) PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    token_prefix VARCHAR(16) NOT NULL,
    class_id CHAR(32) NOT NULL,
    label VARCHAR(64) NOT NULL DEFAULT '',
    created_by VARCHAR(32) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_mcp_tokens_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS drafts (
    id CHAR(32) PRIMARY KEY,
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    class_id CHAR(32) NOT NULL DEFAULT '',
    semester_id CHAR(32) NOT NULL DEFAULT '',
    folder VARCHAR(64) NOT NULL DEFAULT '',
    items JSON NOT NULL,
    evidence JSON NOT NULL,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assess_sessions (
    id CHAR(32) PRIMARY KEY,
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    class_id CHAR(32) NOT NULL DEFAULT '',
    semester_id CHAR(32) NOT NULL DEFAULT '',
    folder VARCHAR(64) NOT NULL DEFAULT '',
    state JSON NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
    id CHAR(32) PRIMARY KEY,
    category VARCHAR(8) NOT NULL DEFAULT '其他',
    content TEXT NOT NULL,
    contact VARCHAR(64) NOT NULL DEFAULT '',
    reply VARCHAR(500) NOT NULL DEFAULT '',
    resolved TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS funds (
    id CHAR(32) PRIMARY KEY,
    class_id CHAR(32) NOT NULL DEFAULT '',
    kind VARCHAR(8) NOT NULL DEFAULT 'in',
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    title VARCHAR(200) NOT NULL DEFAULT '',
    evidence JSON NOT NULL,
    created_by VARCHAR(32) NOT NULL DEFAULT '',
    created_at DATETIME(6) NOT NULL,
    INDEX idx_funds_class (class_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


def _connect(db=None):
    return pymysql.connect(**DB_CONFIG, database=db, autocommit=False)


@contextmanager
def tx():
    """事务上下文：出异常回滚，正常退出提交。"""
    conn = _connect(DB_NAME)
    try:
        cur = conn.cursor(pymysql.cursors.DictCursor)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """建库建表 + 学期迁移：老数据（无 semester_id）统一归入默认学期「大一下」。

    返回 (default_semester_id, created)：老库升级时 created=True，用于播种/回填判断。
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.commit()
    with tx() as cur:
        for stmt in SCHEMA.strip().split(";"):
            if stmt.strip():
                cur.execute(stmt)
        for table, column, ddl in (
            ("students", "class_id", "class_id CHAR(32) NOT NULL DEFAULT ''"),
            ("students", "semester_id", "semester_id CHAR(32) NOT NULL DEFAULT ''"),
            ("students", "failed", "failed TINYINT(1) NOT NULL DEFAULT 0"),
            ("awards", "class_id", "class_id CHAR(32) NOT NULL DEFAULT ''"),
            ("awards", "semester_id", "semester_id CHAR(32) NOT NULL DEFAULT ''"),
            ("awards", "reject_reason", "reject_reason VARCHAR(500) NOT NULL DEFAULT ''"),
            ("adjust_log", "class_id", "class_id CHAR(32) NOT NULL DEFAULT ''"),
            ("adjust_log", "semester_id", "semester_id CHAR(32) NOT NULL DEFAULT ''"),
            ("drafts", "semester_id", "semester_id CHAR(32) NOT NULL DEFAULT ''"),
            ("assess_sessions", "semester_id", "semester_id CHAR(32) NOT NULL DEFAULT ''"),
            ("admins", "nickname", "nickname VARCHAR(32) NOT NULL DEFAULT ''"),
            ("admins", "avatar", "avatar MEDIUMTEXT"),
            ("funds", "evidence", "evidence JSON NULL"),
        ):
            cur.execute(
                "SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s",
                (DB_NAME, table, column),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(f"ALTER TABLE `{table}` ADD COLUMN {ddl}")

        # 第二课堂导入的 meta 键要带学期（sc2_<semester>_<class>），把 32 位键宽扩到 128
        cur.execute(
            "SELECT CHARACTER_MAXIMUM_LENGTH AS n FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='meta' AND COLUMN_NAME='k'",
            (DB_NAME,),
        )
        meta_col = cur.fetchone()
        if meta_col and int(meta_col["n"] or 0) < 128:
            cur.execute("ALTER TABLE meta MODIFY k VARCHAR(128) NOT NULL")

        # 默认学期：库中还没有学期时创建「大一下 / 25-26下学期」并开放申报。
        # 返回 created=True 表示本次是首建（后续启动不再重复播种）。
        cur.execute("SELECT id FROM semesters ORDER BY is_open DESC, sort ASC, created_at ASC LIMIT 1")
        row = cur.fetchone()
        created = False
        if row:
            default_semester_id = row["id"]
        else:
            default_semester_id = uuid.uuid4().hex
            created = True
            cur.execute(
                "INSERT INTO semesters (id,label,term,sort,is_open,created_at) VALUES (%s,%s,%s,%s,1,%s)",
                (
                    default_semester_id, DEFAULT_SEMESTER["label"], DEFAULT_SEMESTER["term"],
                    SEMESTER_LABELS.index(DEFAULT_SEMESTER["label"]), datetime.now(),
                ),
            )

        # 老数据回填默认学期
        for table in ("students", "awards", "adjust_log", "drafts", "assess_sessions"):
            cur.execute(
                f"UPDATE `{table}` SET semester_id=%s WHERE semester_id='' OR semester_id IS NULL",
                (default_semester_id,),
            )

        # 班级的 row_count/source 原本只有一份，迁移到 class_semesters（仅首次，避免覆盖后续值）
        cur.execute("SELECT COUNT(*) AS n FROM class_semesters")
        if int(cur.fetchone()["n"]) == 0:
            cur.execute(
                "INSERT INTO class_semesters (semester_id,class_id,row_count,source) "
                "SELECT %s, id, row_count, source FROM classes",
                (default_semester_id,),
            )

        # students 主键改为 (semester_id, class_id, sid)：老库可能是 sid 或 (class_id,sid)
        cur.execute(
            "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='students' AND CONSTRAINT_NAME='PRIMARY' "
            "ORDER BY ORDINAL_POSITION",
            (DB_NAME,),
        )
        pk = tuple(r["COLUMN_NAME"] for r in cur.fetchall())
        if pk != ("semester_id", "class_id", "sid"):
            cur.execute("ALTER TABLE students DROP PRIMARY KEY, ADD PRIMARY KEY (semester_id, class_id, sid)")
    return default_semester_id, created


def _plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat(timespec="seconds")
    return value


def _row_student(row):
    result = {k: _plain(row[k]) for k in STUDENT_FIELDS if k in row}
    result.setdefault("failed", 0)
    return result


def _row_award(row):
    row = {k: _plain(row[k]) for k in AWARD_FIELDS}
    if isinstance(row["evidence"], str):
        try:
            row["evidence"] = json.loads(row["evidence"])
        except (json.JSONDecodeError, TypeError):
            row["evidence"] = []
    return row


# ---------- students ----------

def list_students(class_id=None, semester_id=None):
    where, params = [], []
    if class_id:
        where.append("class_id=%s")
        params.append(class_id)
    if semester_id:
        where.append("semester_id=%s")
        params.append(semester_id)
    sql = "SELECT * FROM students"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY total DESC, score DESC, gpa DESC, sid ASC"
    with tx() as cur:
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
    result = [_row_student(r) for r in rows]
    for rank, s in enumerate(result, start=1):
        s["rank"] = rank
    return result


def get_student(sid, semester_id=None, class_id=None):
    """按学号定位学生；给了学期/班级就精确到该学期该班（多学期下学号会重复，必须带学期）。"""
    where, params = ["sid=%s"], [sid]
    if semester_id:
        where.append("semester_id=%s")
        params.append(semester_id)
    if class_id:
        where.append("class_id=%s")
        params.append(class_id)
    with tx() as cur:
        cur.execute(
            "SELECT * FROM students WHERE " + " AND ".join(where) + " ORDER BY class_id ASC LIMIT 1",
            tuple(params),
        )
        row = cur.fetchone()
    return _row_student(row) if row else None


def replace_students(students, class_id, semester_id):
    with tx() as cur:
        cur.execute(
            "DELETE FROM students WHERE class_id=%s AND semester_id=%s",
            (class_id, semester_id),
        )
        for s in students:
            cur.execute(
                "INSERT INTO students (sid,name,class_id,semester_id,course_count,credits,gpa,deyu,score,tiyu,meiyu,laoyu,fujia,failed,total) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                tuple(
                    int(s["failed"]) if f == "failed"
                    else (class_id if f == "class_id" else (semester_id if f == "semester_id" else s.get(f, 0)))
                    for f in STUDENT_FIELDS
                ),
            )


def clear_students(class_id=None):
    with tx() as cur:
        if class_id:
            cur.execute("DELETE FROM students WHERE class_id=%s", (class_id,))
        else:
            cur.execute("DELETE FROM students")


def clear_awards():
    with tx() as cur:
        cur.execute("DELETE FROM awards")


def clear_adjust_log():
    with tx() as cur:
        cur.execute("DELETE FROM adjust_log")


def update_student_score(sid, class_id, semester_id, field, value, total):
    with tx() as cur:
        cur.execute(
            f"UPDATE students SET `{field}`=%s, total=%s WHERE sid=%s AND class_id=%s AND semester_id=%s",
            (round(float(value), 2), round(float(total), 2), sid, class_id, semester_id),
        )


def update_failed_flags(class_id, semester_id, failed_map):
    """按源数据重算 failed（参评资格）标记；只写 failed 列，不动分数与 total。"""
    with tx() as cur:
        for sid, failed in failed_map.items():
            cur.execute(
                "UPDATE students SET failed=%s WHERE sid=%s AND class_id=%s AND semester_id=%s",
                (1 if failed else 0, sid, class_id, semester_id),
            )


# ---------- awards ----------

def insert_awards(records):
    with tx() as cur:
        for r in records:
            cur.execute(
                "INSERT INTO awards (id,sid,name,class_id,semester_id,category,points,basis,evidence,folder,approved,reject_reason,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    r["id"], r["sid"], r["name"], r.get("class_id", ""), r.get("semester_id", ""),
                    r["category"], round(float(r["points"]), 1),
                    r["basis"], json.dumps(r["evidence"], ensure_ascii=False), r["folder"],
                    r["approved"], r.get("reject_reason", "") or "", r["created_at"],
                ),
            )


def insert_awards_dedup(records, sid, class_id, semester_id):
    """单事务内按学生行锁串行化，按 栏目+分值+依据 去重后插入待审批申报。

    用于 MCP/一遍过提交：外部 MCP 并发调用、页面双击/重试都只会落一条。
    已通过/待审批的同项跳过；已驳回的允许重新提交。
    返回 (created_records, skipped)。
    """
    created = []
    skipped = 0
    with tx() as cur:
        # 锁定该学生行：同学生的并发提交在此排队，后到的事务能看到先到者已插入的记录
        cur.execute(
            "SELECT 1 FROM students WHERE sid=%s AND class_id=%s AND semester_id=%s FOR UPDATE",
            (sid, class_id, semester_id),
        )
        cur.execute(
            "SELECT category, points, basis FROM awards "
            "WHERE sid=%s AND class_id=%s AND semester_id=%s AND approved IN ('是','否') FOR UPDATE",
            (sid, class_id, semester_id),
        )
        keys = {
            (r["category"], round(float(r["points"]), 1), (r["basis"] or "").strip())
            for r in cur.fetchall()
        }
        for r in records:
            key = (r["category"], round(float(r["points"]), 1), (r["basis"] or "").strip())
            if key in keys:
                skipped += 1
                continue
            keys.add(key)
            cur.execute(
                "INSERT INTO awards (id,sid,name,class_id,semester_id,category,points,basis,evidence,folder,approved,reject_reason,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    r["id"], r["sid"], r["name"], r.get("class_id", ""), r.get("semester_id", ""),
                    r["category"], round(float(r["points"]), 1),
                    r["basis"], json.dumps(r["evidence"], ensure_ascii=False), r["folder"],
                    r["approved"], r.get("reject_reason", "") or "", r["created_at"],
                ),
            )
            created.append(r)
    return created, skipped


def list_awards(class_id=None, semester_id=None):
    where, params = [], []
    if class_id:
        where.append("class_id=%s")
        params.append(class_id)
    if semester_id:
        where.append("semester_id=%s")
        params.append(semester_id)
    sql = "SELECT * FROM awards"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, id DESC"
    with tx() as cur:
        cur.execute(sql, tuple(params))
        return [_row_award(r) for r in cur.fetchall()]


def get_award(aid):
    with tx() as cur:
        cur.execute("SELECT * FROM awards WHERE id=%s", (aid,))
        row = cur.fetchone()
    return _row_award(row) if row else None


def update_award(aid, **fields):
    allowed = {"category", "points", "approved", "reject_reason", "basis", "evidence"}
    sets = ", ".join(f"`{k}`=%s" for k in fields)
    with tx() as cur:
        cur.execute(
            f"UPDATE awards SET {sets} WHERE id=%s",
            tuple(
                json.dumps(v, ensure_ascii=False) if k == "evidence" else (round(float(v), 1) if k == "points" else v)
                for k, v in fields.items()
            ) + (aid,),
        )


def delete_award(aid):
    with tx() as cur:
        cur.execute("DELETE FROM awards WHERE id=%s", (aid,))


def folder_in_use(folder):
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM awards WHERE folder=%s", (folder,))
        return cur.fetchone()["n"] > 0


# ---------- drafts（AI 分析草稿，提交/删除即清理；24h 过期） ----------

def _row_draft(row):
    row = {k: _plain(row[k]) for k in ("id", "sid", "name", "class_id", "semester_id", "folder", "items", "evidence", "created_at")}
    for k in ("items", "evidence"):
        if isinstance(row[k], str):
            try:
                row[k] = json.loads(row[k])
            except (json.JSONDecodeError, TypeError):
                row[k] = []
    return row


def insert_draft(draft):
    with tx() as cur:
        cur.execute(
            "INSERT INTO drafts (id,sid,name,class_id,semester_id,folder,items,evidence,created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                draft["id"], draft["sid"], draft["name"], draft.get("class_id", ""),
                draft.get("semester_id", ""), draft.get("folder", ""),
                json.dumps(draft["items"], ensure_ascii=False), json.dumps(draft["evidence"], ensure_ascii=False),
                draft.get("created_at", datetime.now()),
            ),
        )


def get_draft(draft_id):
    with tx() as cur:
        cur.execute("SELECT * FROM drafts WHERE id=%s", (draft_id,))
        row = cur.fetchone()
    return _row_draft(row) if row else None


def delete_draft(draft_id):
    with tx() as cur:
        cur.execute("DELETE FROM drafts WHERE id=%s", (draft_id,))


def list_drafts_before(cutoff):
    with tx() as cur:
        cur.execute("SELECT * FROM drafts WHERE created_at < %s", (cutoff,))
        return [_row_draft(r) for r in cur.fetchall()]


def evict_drafts_beyond(cap):
    """超过 cap 个草稿时按 created_at 淘汰最旧的，返回被淘汰的草稿（调用方负责清理其证据目录）。"""
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM drafts")
        extra = int(cur.fetchone()["n"]) - cap
        if extra <= 0:
            return []
        cur.execute("SELECT * FROM drafts ORDER BY created_at ASC, id ASC LIMIT %s", (extra,))
        rows = [_row_draft(r) for r in cur.fetchall()]
        for d in rows:
            cur.execute("DELETE FROM drafts WHERE id=%s", (d["id"],))
    return rows


# ---------- assess_sessions（加分一遍过会话持久化；busy 为进程内易失态不入库） ----------

def assess_upsert(sess):
    state = {
        "messages": sess.get("messages", []),
        "items": sess.get("items", []),
        "existing": sess.get("existing", []),
        "done": bool(sess.get("done")),
        "ended": bool(sess.get("ended")),
        "turns": sess.get("turns", []),
        "submitted": bool(sess.get("submitted")),
        "submitted_ids": sess.get("submitted_ids", []),
    }
    with tx() as cur:
        cur.execute(
            "INSERT INTO assess_sessions (id,sid,name,class_id,semester_id,folder,state,created_at,updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE sid=VALUES(sid), name=VALUES(name), class_id=VALUES(class_id), "
            "semester_id=VALUES(semester_id), folder=VALUES(folder), state=VALUES(state), updated_at=VALUES(updated_at)",
            (
                sess["id"], sess["sid"], sess.get("name", ""), sess.get("class_id", ""),
                sess.get("semester_id", ""), sess.get("folder", ""),
                json.dumps(state, ensure_ascii=False),
                datetime.fromtimestamp(sess.get("created", time.time())),
                datetime.fromtimestamp(sess.get("updated", time.time())),
            ),
        )


def assess_get_row(session_id):
    with tx() as cur:
        cur.execute("SELECT * FROM assess_sessions WHERE id=%s", (session_id,))
        row = cur.fetchone()
    if not row:
        return None
    try:
        state = json.loads(row["state"])
    except (json.JSONDecodeError, TypeError):
        state = {}
    row["state"] = state if isinstance(state, dict) else {}
    return row


def assess_delete(session_id):
    with tx() as cur:
        cur.execute("DELETE FROM assess_sessions WHERE id=%s", (session_id,))


def assess_delete_stale(ttl_seconds):
    """删除 updated_at 早于 TTL 的会话行，返回删除数量。"""
    with tx() as cur:
        cur.execute(
            "DELETE FROM assess_sessions WHERE updated_at < %s",
            (datetime.now() - timedelta(seconds=ttl_seconds),),
        )
        return cur.rowcount


def assess_evict_beyond(limit):
    """活跃会话超过 limit 时按 updated_at 淘汰最旧的，返回被淘汰的会话 id 列表。"""
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM assess_sessions")
        extra = int(cur.fetchone()["n"]) - limit
        if extra <= 0:
            return []
        cur.execute("SELECT id FROM assess_sessions ORDER BY updated_at ASC LIMIT %s", (extra,))
        ids = [r["id"] for r in cur.fetchall()]
        for i in ids:
            cur.execute("DELETE FROM assess_sessions WHERE id=%s", (i,))
    return ids


# ---------- feedback（体验反馈工单：公开可读可提交，管理员勾选解决/回复） ----------

def _row_feedback(row):
    return {k: _plain(row[k]) for k in ("id", "category", "content", "contact", "reply", "resolved", "created_at")}


def list_feedback():
    """未解决在前（新→旧），已解决沉底。"""
    with tx() as cur:
        cur.execute("SELECT * FROM feedback ORDER BY resolved ASC, created_at DESC, id ASC")
        return [_row_feedback(r) for r in cur.fetchall()]


def get_feedback(fid):
    with tx() as cur:
        cur.execute("SELECT * FROM feedback WHERE id=%s", (fid,))
        row = cur.fetchone()
    return _row_feedback(row) if row else None


def insert_feedback(fid, category, content, contact):
    with tx() as cur:
        cur.execute(
            "INSERT INTO feedback (id,category,content,contact,created_at) VALUES (%s,%s,%s,%s,%s)",
            (fid, category, content, contact, datetime.now()),
        )


def update_feedback(fid, fields):
    """fields 的键只允许 resolved/reply（调用方白名单组装），传了才更新、互不覆盖。"""
    sets = ", ".join(f"{k}=%s" for k in fields)
    with tx() as cur:
        cur.execute(f"UPDATE feedback SET {sets} WHERE id=%s", (*fields.values(), fid))


# ---------- funds（班费公示：管理员发布收支记录，所有人可查看；结余允许为负） ----------

def _row_fund(row):
    result = {k: _plain(row[k]) for k in FUND_FIELDS if k in row}
    evidence = result.get("evidence")
    if isinstance(evidence, str):
        try:
            result["evidence"] = json.loads(evidence)
        except (json.JSONDecodeError, TypeError):
            result["evidence"] = []
    elif not isinstance(evidence, list):
        result["evidence"] = []
    return result


def list_funds(class_id):
    with tx() as cur:
        cur.execute(
            "SELECT * FROM funds WHERE class_id=%s ORDER BY created_at DESC, id DESC",
            (class_id,),
        )
        return [_row_fund(r) for r in cur.fetchall()]


def get_fund(fid):
    with tx() as cur:
        cur.execute("SELECT * FROM funds WHERE id=%s", (fid,))
        row = cur.fetchone()
    return _row_fund(row) if row else None


def insert_fund(fid, class_id, kind, amount, title, evidence, created_by):
    with tx() as cur:
        cur.execute(
            "INSERT INTO funds (id,class_id,kind,amount,title,evidence,created_by,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                fid, class_id, kind, round(float(amount), 2), title,
                json.dumps(list(evidence), ensure_ascii=False), created_by, datetime.now(),
            ),
        )


def delete_fund(fid):
    with tx() as cur:
        cur.execute("DELETE FROM funds WHERE id=%s", (fid,))


# ---------- adjust_log ----------

def insert_adjust_log(entries):
    with tx() as cur:
        for e in entries:
            cur.execute(
                "INSERT INTO adjust_log (created_at,sid,name,class_id,semester_id,field,op,points,old,new) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    e["created_at"], e["sid"], e["name"], e.get("class_id", ""), e.get("semester_id", ""),
                    e["field"], e["op"],
                    round(float(e["points"]), 2), round(float(e["old"]), 2), round(float(e["new"]), 2),
                ),
            )


def list_adjust_log(limit=500):
    with tx() as cur:
        cur.execute("SELECT * FROM adjust_log ORDER BY id DESC LIMIT %s", (limit,))
        return [{k: _plain(v) for k, v in r.items()} for r in cur.fetchall()]


def apply_secondclass(class_id, semester_id, ops, meta_key, meta_value, records=(), delete_aids=()):
    """第二课堂导入：单事务内批量调 deyu 并留痕 adjust_log，删除上次导入的申报记录、
    写入本次自动通过的申报记录，最后写 meta。

    ops: list[dict]，每项 {sid, name, field, op('add'/'sub'), points, old, new}
    — 调用方已算好 old/new（含封顶/下限）与 total，这里按 new 写回 students 并同步 total。
    records/delete_aids: 本次导入生成的申报记录（与 insert_awards 同构）与上次导入的记录 id，
    调分与记录必须同事务，否则中途失败会出现「分已动、记录还在」的双重撤销。
    """
    with tx() as cur:
        for aid in delete_aids:
            cur.execute("DELETE FROM awards WHERE id=%s", (aid,))
        for e in ops:
            cur.execute(
                "UPDATE students SET `deyu`=%s, total=%s WHERE sid=%s AND class_id=%s AND semester_id=%s",
                (
                    round(float(e["new"]), 2),
                    round(float(e["total"]), 2),
                    e["sid"],
                    class_id,
                    semester_id,
                ),
            )
            cur.execute(
                "INSERT INTO adjust_log (created_at,sid,name,class_id,semester_id,field,op,points,old,new) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    e["created_at"], e["sid"], e["name"], class_id, semester_id, "deyu", e["op"],
                    round(float(e["points"]), 2), round(float(e["old"]), 2), round(float(e["new"]), 2),
                ),
            )
        for r in records:
            cur.execute(
                "INSERT INTO awards (id,sid,name,class_id,semester_id,category,points,basis,evidence,folder,approved,reject_reason,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    r["id"], r["sid"], r["name"], r.get("class_id", ""), r.get("semester_id", ""),
                    r["category"], round(float(r["points"]), 1),
                    r["basis"], json.dumps(r["evidence"], ensure_ascii=False), r["folder"],
                    r["approved"], r.get("reject_reason", "") or "", r["created_at"],
                ),
            )
        cur.execute(
            "INSERT INTO meta (k,v) VALUES (%s,%s) ON DUPLICATE KEY UPDATE v=VALUES(v)",
            (meta_key, str(meta_value)),
        )


# ---------- meta ----------

def set_meta(key, value):
    with tx() as cur:
        cur.execute(
            "INSERT INTO meta (k,v) VALUES (%s,%s) ON DUPLICATE KEY UPDATE v=VALUES(v)",
            (key, str(value)),
        )


def get_meta(key, default=""):
    with tx() as cur:
        cur.execute("SELECT v FROM meta WHERE k=%s", (key,))
        row = cur.fetchone()
    return row["v"] if row else default


# ---------- settings（AI 配置/提示词等，存 JSON 字符串） ----------

def get_setting(key, default=None):
    with tx() as cur:
        cur.execute("SELECT v FROM settings WHERE k=%s", (key,))
        row = cur.fetchone()
    if not row:
        return default
    try:
        return json.loads(row["v"])
    except (json.JSONDecodeError, TypeError):
        return default


def set_setting(key, value):
    with tx() as cur:
        cur.execute(
            "INSERT INTO settings (k,v) VALUES (%s,%s) ON DUPLICATE KEY UPDATE v=VALUES(v)",
            (key, json.dumps(value, ensure_ascii=False)),
        )


def delete_setting(key):
    with tx() as cur:
        cur.execute("DELETE FROM settings WHERE k=%s", (key,))


# ---------- classes ----------

def _row_class(row):
    return {k: _plain(row[k]) for k in ("id", "name", "row_count", "source", "created_at")}


def list_classes(semester_id=None):
    """班级是跨学期的稳定实体；传 semester_id 时返回该学期的学生数/课程记录元数据。"""
    with tx() as cur:
        if semester_id:
            cur.execute(
                "SELECT c.id, c.name, c.created_at, "
                "COALESCE(cs.row_count, 0) AS row_count, COALESCE(cs.source, '') AS source, "
                "(SELECT COUNT(*) FROM students s WHERE s.class_id=c.id AND s.semester_id=%s) AS students "
                "FROM classes c LEFT JOIN class_semesters cs "
                "ON cs.class_id=c.id AND cs.semester_id=%s ORDER BY c.created_at ASC",
                (semester_id, semester_id),
            )
        else:
            cur.execute(
                "SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) AS students "
                "FROM classes c ORDER BY c.created_at ASC"
            )
        return [{**_row_class(r), "students": int(r["students"])} for r in cur.fetchall()]


def get_class(cid):
    with tx() as cur:
        cur.execute("SELECT * FROM classes WHERE id=%s", (cid,))
        row = cur.fetchone()
    return _row_class(row) if row else None


def create_class(name):
    cid = uuid.uuid4().hex
    with tx() as cur:
        cur.execute(
            "INSERT INTO classes (id,name,row_count,source,created_at) VALUES (%s,%s,0,'',%s)",
            (cid, name, datetime.now()),
        )
    return {"id": cid, "name": name, "row_count": 0, "source": ""}


def delete_class(cid):
    with tx() as cur:
        cur.execute("DELETE FROM classes WHERE id=%s", (cid,))
        cur.execute("DELETE FROM class_semesters WHERE class_id=%s", (cid,))
        cur.execute("DELETE FROM invites WHERE class_id=%s", (cid,))
        cur.execute("DELETE FROM mcp_tokens WHERE class_id=%s", (cid,))


def clear_class_data(cid, semester_id):
    """清空某学期某班的数据（榜单/申报/调分留痕），返回被删申报占用的证据文件夹列表。

    班费是跨学期账本，不在这里清空。
    """
    with tx() as cur:
        cur.execute(
            "SELECT DISTINCT folder FROM awards WHERE class_id=%s AND semester_id=%s",
            (cid, semester_id),
        )
        folders = [r["folder"] for r in cur.fetchall()]
        cur.execute("DELETE FROM awards WHERE class_id=%s AND semester_id=%s", (cid, semester_id))
        cur.execute("DELETE FROM students WHERE class_id=%s AND semester_id=%s", (cid, semester_id))
        cur.execute("DELETE FROM adjust_log WHERE class_id=%s AND semester_id=%s", (cid, semester_id))
        cur.execute(
            "DELETE FROM class_semesters WHERE class_id=%s AND semester_id=%s",
            (cid, semester_id),
        )
    return folders


def get_class_meta(cid, semester_id):
    with tx() as cur:
        cur.execute(
            "SELECT row_count, source FROM class_semesters WHERE class_id=%s AND semester_id=%s",
            (cid, semester_id),
        )
        row = cur.fetchone()
    return {"row_count": int(row["row_count"]), "source": row["source"] or ""} if row else {"row_count": 0, "source": ""}


def set_class_meta(cid, rows, source, semester_id):
    with tx() as cur:
        cur.execute(
            "INSERT INTO class_semesters (semester_id,class_id,row_count,source) VALUES (%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE row_count=VALUES(row_count), source=VALUES(source)",
            (semester_id, cid, int(rows), source),
        )
        # 兼容旧字段（无学期语境下发榜单不再使用它，保留最后导入值便于排查）
        cur.execute("UPDATE classes SET row_count=%s, source=%s WHERE id=%s", (int(rows), source, cid))


# ---------- semesters（学期：跨学期的稳定班级，每学期一套榜单/申报；同时只有一个开放申报） ----------

def _row_semester(row):
    result = {k: _plain(row[k]) for k in ("id", "label", "term", "sort", "is_open", "created_at")}
    result["is_open"] = bool(row["is_open"])
    return result


def list_semesters():
    with tx() as cur:
        cur.execute("SELECT * FROM semesters ORDER BY sort ASC, created_at ASC")
        return [_row_semester(r) for r in cur.fetchall()]


def get_semester(sid):
    with tx() as cur:
        cur.execute("SELECT * FROM semesters WHERE id=%s", (sid,))
        row = cur.fetchone()
    return _row_semester(row) if row else None


def get_open_semester():
    """当前开放申报的学期（学生提交自动落到这里）；没有开放学期时返回 None。"""
    with tx() as cur:
        cur.execute("SELECT * FROM semesters WHERE is_open=1 ORDER BY sort ASC LIMIT 1")
        row = cur.fetchone()
    return _row_semester(row) if row else None


def create_semester(label, term):
    sid = uuid.uuid4().hex
    sort = SEMESTER_LABELS.index(label) if label in SEMESTER_LABELS else 99
    with tx() as cur:
        cur.execute(
            "INSERT INTO semesters (id,label,term,sort,is_open,created_at) VALUES (%s,%s,%s,%s,0,%s)",
            (sid, label, term, sort, datetime.now()),
        )
    return {"id": sid, "label": label, "term": term, "sort": sort, "is_open": False}


def update_semester_term(sid, term):
    with tx() as cur:
        cur.execute("UPDATE semesters SET term=%s WHERE id=%s", (term, sid))


def open_semester(sid):
    """把某学期设为唯一开放申报的学期（同一时间只开放一个）。"""
    with tx() as cur:
        cur.execute("UPDATE semesters SET is_open=0")
        cur.execute("UPDATE semesters SET is_open=1 WHERE id=%s", (sid,))


def delete_semester(sid):
    with tx() as cur:
        cur.execute("DELETE FROM semesters WHERE id=%s", (sid,))
        cur.execute("DELETE FROM class_semesters WHERE semester_id=%s", (sid,))


def semester_data_count(sid):
    """该学期已有多少学生/申报记录（非 0 时禁止删除学期）。"""
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM students WHERE semester_id=%s", (sid,))
        students = int(cur.fetchone()["n"])
        cur.execute("SELECT COUNT(*) AS n FROM awards WHERE semester_id=%s", (sid,))
        awards = int(cur.fetchone()["n"])
    return students, awards


def migrate_secondclass_meta(semester_id):
    """老库的 sc2_<class_id[:27]> 键迁移为 sc2_<semester_id>_<class_id>（否则升级后首次重导
    找不到上次记录，会把 10 分再加一遍）。"""
    with tx() as cur:
        cur.execute("SELECT k, v FROM meta WHERE k LIKE 'sc2/_%' ESCAPE '/'")
        rows = cur.fetchall()
        for r in rows:
            old = r["k"]
            if old.startswith(f"sc2_{semester_id}_"):
                continue
            suffix = old[4:]
            cur.execute("SELECT id FROM classes WHERE id LIKE %s LIMIT 1", (suffix + "%",))
            cls = cur.fetchone()
            if not cls:
                continue
            new = f"sc2_{semester_id}_{cls['id']}"
            cur.execute(
                "INSERT INTO meta (k,v) VALUES (%s,%s) ON DUPLICATE KEY UPDATE v=VALUES(v)",
                (new, r["v"]),
            )
            cur.execute("DELETE FROM meta WHERE k=%s", (old,))


# ---------- admins ----------

def hash_password(password, salt):
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def _row_admin(row):
    return {k: _plain(row[k]) for k in ADMIN_FIELDS}


def get_admin(username):
    with tx() as cur:
        cur.execute("SELECT * FROM admins WHERE username=%s", (username,))
        row = cur.fetchone()
    return dict(row) if row else None


def list_admins():
    with tx() as cur:
        cur.execute("SELECT * FROM admins ORDER BY created_at ASC")
        return [_row_admin(r) for r in cur.fetchall()]


def root_exists():
    """是否存在超级管理员（按 role 判断，不依赖固定用户名，允许改名）。"""
    with tx() as cur:
        cur.execute("SELECT 1 FROM admins WHERE role='root' LIMIT 1")
        return cur.fetchone() is not None


def create_admin(username, password, role, class_id=None):
    salt = secrets.token_hex(16)
    with tx() as cur:
        cur.execute(
            "INSERT INTO admins (username,salt,password_hash,role,class_id,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (username, salt, hash_password(password, salt), role, class_id, datetime.now()),
        )


def update_admin(username, password=None, class_id=None):
    with tx() as cur:
        if password:
            salt = secrets.token_hex(16)
            cur.execute(
                "UPDATE admins SET salt=%s, password_hash=%s WHERE username=%s",
                (salt, hash_password(password, salt), username),
            )
        if class_id is not None:
            cur.execute("UPDATE admins SET class_id=%s WHERE username=%s", (class_id, username))


def delete_admin(username):
    with tx() as cur:
        cur.execute("DELETE FROM admins WHERE username=%s", (username,))


def get_avatar(username):
    """头像单独取（data URL，可能几十 KB，不随账号列表/登录响应一起传）。"""
    with tx() as cur:
        cur.execute("SELECT avatar FROM admins WHERE username=%s", (username,))
        row = cur.fetchone()
    return (row["avatar"] or "") if row else ""


def update_profile(username, nickname=None, avatar=None):
    """昵称/头像自改；传 None 表示该项保持不变（头像传 '' 表示清除）。"""
    with tx() as cur:
        if nickname is not None:
            cur.execute("UPDATE admins SET nickname=%s WHERE username=%s", (nickname, username))
        if avatar is not None:
            cur.execute("UPDATE admins SET avatar=%s WHERE username=%s", (avatar or None, username))


def verify_admin(username, password):
    admin = get_admin(username)
    if not admin:
        return None
    if hmac.compare_digest(admin["password_hash"], hash_password(password, admin["salt"])):
        return _row_admin(admin)
    return None


# ---------- invites（邀请码：root 生成、绑定班级、一次性注册管理员） ----------

def _row_invite(row):
    result = {k: _plain(row[k]) for k in ("id", "code", "class_id", "created_by", "created_at", "used_by", "used_at")}
    result["class_name"] = row.get("class_name") or ""
    result["revoked"] = bool(row["revoked"])
    result["status"] = "revoked" if row["revoked"] else ("used" if row["used_by"] else "unused")
    return result


def list_invites():
    with tx() as cur:
        cur.execute(
            "SELECT i.*, c.name AS class_name FROM invites i "
            "LEFT JOIN classes c ON c.id=i.class_id ORDER BY i.created_at DESC, i.id DESC"
        )
        return [_row_invite(r) for r in cur.fetchall()]


def create_invite(class_id, created_by):
    """生成一次性邀请码（8 位，绑定班级）。唯一冲突时重试，极端情况抛 RuntimeError。"""
    with tx() as cur:
        cur.execute("SELECT name FROM classes WHERE id=%s", (class_id,))
        cls = cur.fetchone()
        if not cls:
            return None
        for _ in range(8):
            code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
            cur.execute("SELECT 1 FROM invites WHERE code=%s", (code,))
            if cur.fetchone():
                continue
            iid = uuid.uuid4().hex
            now = datetime.now()
            cur.execute(
                "INSERT INTO invites (id,code,class_id,created_by,created_at) VALUES (%s,%s,%s,%s,%s)",
                (iid, code, class_id, created_by, now),
            )
            return {
                "id": iid, "code": code, "class_id": class_id, "class_name": cls["name"],
                "created_by": created_by, "created_at": now.isoformat(timespec="seconds"),
                "used_by": None, "used_at": None, "revoked": False, "status": "unused",
            }
    raise RuntimeError("生成邀请码失败，请重试")


def revoke_invite(iid):
    """撤销未使用的邀请码；已使用/已撤销的返回 False（保留使用记录）。"""
    with tx() as cur:
        cur.execute(
            "UPDATE invites SET revoked=1 WHERE id=%s AND used_by IS NULL AND revoked=0",
            (iid,),
        )
        return cur.rowcount > 0


def register_with_invite(code, username, password):
    """用邀请码注册管理员：单事务内锁定邀请码 → 校验 → 建账号 → 标记已使用。

    返回 (admin_dict, error)。error 取值：invalid（无效/已用/已撤销）、exists（用户名已被占用）、
    no_class（邀请码对应班级已被删除）。
    """
    salt = secrets.token_hex(16)
    try:
        with tx() as cur:
            cur.execute("SELECT * FROM invites WHERE code=%s FOR UPDATE", (code,))
            inv = cur.fetchone()
            if not inv or inv["revoked"] or inv["used_by"]:
                return None, "invalid"
            cur.execute("SELECT 1 FROM admins WHERE username=%s", (username,))
            if cur.fetchone():
                return None, "exists"
            cur.execute("SELECT name FROM classes WHERE id=%s", (inv["class_id"],))
            cls = cur.fetchone()
            if not cls:
                return None, "no_class"
            now = datetime.now()
            cur.execute(
                "INSERT INTO admins (username,salt,password_hash,role,class_id,created_at) VALUES (%s,%s,%s,'admin',%s,%s)",
                (username, salt, hash_password(password, salt), inv["class_id"], now),
            )
            cur.execute(
                "UPDATE invites SET used_by=%s, used_at=%s WHERE id=%s",
                (username, now, inv["id"]),
            )
            return {
                "username": username,
                "role": "admin",
                "class_id": inv["class_id"],
                "class_name": cls["name"],
                "nickname": "",
            }, None
    except pymysql.err.IntegrityError:
        # 并发注册同名账号：唯一键兜底
        return None, "exists"


# ---------- mcp_tokens（申报 MCP 专属 token：各班管理员生成/发放，绑定班级） ----------

MCP_TOKEN_PREFIX = "mcp_"


def _row_mcp_token(row):
    result = {
        k: _plain(row[k])
        for k in ("id", "token_prefix", "class_id", "label", "created_by", "created_at", "last_used_at", "revoked")
    }
    result["class_name"] = row.get("class_name") or ""
    result["revoked"] = bool(row["revoked"])
    return result


def list_mcp_tokens(class_id=None):
    with tx() as cur:
        sql = (
            "SELECT t.*, c.name AS class_name FROM mcp_tokens t "
            "LEFT JOIN classes c ON c.id=t.class_id"
        )
        params = ()
        if class_id:
            sql += " WHERE t.class_id=%s"
            params = (class_id,)
        sql += " ORDER BY t.created_at DESC, t.id DESC"
        cur.execute(sql, params)
        return [_row_mcp_token(r) for r in cur.fetchall()]


def get_mcp_token(tid):
    with tx() as cur:
        cur.execute(
            "SELECT t.*, c.name AS class_name FROM mcp_tokens t "
            "LEFT JOIN classes c ON c.id=t.class_id WHERE t.id=%s",
            (tid,),
        )
        row = cur.fetchone()
    return _row_mcp_token(row) if row else None


def create_mcp_token(class_id, label, created_by):
    """生成专属 MCP token；明文只返回一次，库里只存 sha256 哈希与展示前缀。"""
    token = MCP_TOKEN_PREFIX + secrets.token_hex(16)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    prefix = token[:12]
    iid = uuid.uuid4().hex
    now = datetime.now()
    with tx() as cur:
        cur.execute(
            "INSERT INTO mcp_tokens (id,token_hash,token_prefix,class_id,label,created_by,created_at,revoked) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,0)",
            (iid, token_hash, prefix, class_id, label, created_by, now),
        )
    return token, {
        "id": iid, "token_prefix": prefix, "class_id": class_id, "label": label,
        "created_by": created_by, "created_at": now.isoformat(timespec="seconds"),
        "last_used_at": None, "revoked": False,
    }


def revoke_mcp_token(tid, class_id=None):
    """撤销 token；admin 只能撤销本班，root 不限（class_id=None 表示 root）。"""
    with tx() as cur:
        if class_id:
            cur.execute(
                "UPDATE mcp_tokens SET revoked=1 WHERE id=%s AND class_id=%s AND revoked=0",
                (tid, class_id),
            )
        else:
            cur.execute("UPDATE mcp_tokens SET revoked=1 WHERE id=%s AND revoked=0", (tid,))
        return cur.rowcount > 0


def verify_mcp_token(token):
    """校验专属 MCP token；成功时刷新 last_used_at 并返回班级范围会话。"""
    token = (token or "").strip()
    if not token.startswith(MCP_TOKEN_PREFIX):
        return None
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with tx() as cur:
        cur.execute(
            "SELECT * FROM mcp_tokens WHERE token_hash=%s AND revoked=0",
            (token_hash,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cur.execute("UPDATE mcp_tokens SET last_used_at=%s WHERE id=%s", (datetime.now(), row["id"]))
        return {
            "role": "admin",
            "class_id": row["class_id"],
            "username": row["created_by"] or "mcp",
            "token_id": row["id"],
            "token_label": row["label"],
        }

