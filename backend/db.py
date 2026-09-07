# db.py — MySQL 存储层：连接管理 / 建库建表 / JSON 存量数据一次性迁移

import hashlib
import hmac
import json
import os
import secrets
import uuid
from contextlib import contextmanager
from datetime import date, datetime
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

STUDENT_FIELDS = ("sid", "name", "class_id", "course_count", "credits", "gpa", "deyu", "score", "tiyu", "meiyu", "laoyu", "fujia", "total")
AWARD_FIELDS = ("id", "sid", "name", "class_id", "category", "points", "basis", "evidence", "folder", "approved", "reject_reason", "created_at")
ADMIN_FIELDS = ("username", "role", "class_id", "created_at")

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    sid VARCHAR(32) PRIMARY KEY,
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
    total DECIMAL(9,2) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS awards (
    id CHAR(32) PRIMARY KEY,
    sid VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(32) PRIMARY KEY,
    salt CHAR(32) NOT NULL,
    password_hash CHAR(64) NOT NULL,
    role VARCHAR(8) NOT NULL DEFAULT 'admin',
    class_id CHAR(32) NULL,
    created_at DATETIME NOT NULL
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
            ("awards", "class_id", "class_id CHAR(32) NOT NULL DEFAULT ''"),
            ("awards", "reject_reason", "reject_reason VARCHAR(500) NOT NULL DEFAULT ''"),
        ):
            cur.execute(
                "SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s",
                (DB_NAME, table, column),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(f"ALTER TABLE `{table}` ADD COLUMN {ddl}")
        cur.execute(
            "SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='students' AND CONSTRAINT_NAME='PRIMARY' AND COLUMN_NAME='sid'",
            (DB_NAME,),
        )
        if cur.fetchone()["n"] > 0:
            cur.execute("ALTER TABLE students DROP PRIMARY KEY, ADD PRIMARY KEY (class_id, sid)")


def _plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat(timespec="seconds")
    return value


def _row_student(row):
    return {k: _plain(row[k]) for k in STUDENT_FIELDS}


def _row_award(row):
    row = {k: _plain(row[k]) for k in AWARD_FIELDS}
    if isinstance(row["evidence"], str):
        try:
            row["evidence"] = json.loads(row["evidence"])
        except (json.JSONDecodeError, TypeError):
            row["evidence"] = []
    return row


# ---------- students ----------

def list_students(class_id=None):
    with tx() as cur:
        if class_id:
            cur.execute(
                "SELECT * FROM students WHERE class_id=%s ORDER BY total DESC, score DESC, gpa DESC, sid ASC",
                (class_id,),
            )
        else:
            cur.execute("SELECT * FROM students ORDER BY total DESC, score DESC, gpa DESC, sid ASC")
        rows = cur.fetchall()
    result = [_row_student(r) for r in rows]
    for rank, s in enumerate(result, start=1):
        s["rank"] = rank
    return result


def get_student(sid):
    with tx() as cur:
        cur.execute("SELECT * FROM students WHERE sid=%s", (sid,))
        row = cur.fetchone()
    return _row_student(row) if row else None


def replace_students(students, class_id):
    with tx() as cur:
        cur.execute("DELETE FROM students WHERE class_id=%s", (class_id,))
        for s in students:
            cur.execute(
                "INSERT INTO students (sid,name,class_id,course_count,credits,gpa,deyu,score,tiyu,meiyu,laoyu,fujia,total) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                tuple(
                    class_id if f == "class_id" else s.get(f, 0)
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


def update_student_score(sid, class_id, field, value, total):
    with tx() as cur:
        cur.execute(
            f"UPDATE students SET `{field}`=%s, total=%s WHERE sid=%s AND class_id=%s",
            (round(float(value), 2), round(float(total), 2), sid, class_id),
        )


# ---------- awards ----------

def insert_awards(records):
    with tx() as cur:
        for r in records:
            cur.execute(
                "INSERT INTO awards (id,sid,name,class_id,category,points,basis,evidence,folder,approved,reject_reason,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    r["id"], r["sid"], r["name"], r.get("class_id", ""), r["category"], round(float(r["points"]), 1),
                    r["basis"], json.dumps(r["evidence"], ensure_ascii=False), r["folder"],
                    r["approved"], r.get("reject_reason", "") or "", r["created_at"],
                ),
            )


def list_awards(class_id=None):
    with tx() as cur:
        if class_id:
            cur.execute("SELECT * FROM awards WHERE class_id=%s ORDER BY created_at DESC, id DESC", (class_id,))
        else:
            cur.execute("SELECT * FROM awards ORDER BY created_at DESC, id DESC")
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


# ---------- adjust_log ----------

def insert_adjust_log(entries):
    with tx() as cur:
        for e in entries:
            cur.execute(
                "INSERT INTO adjust_log (created_at,sid,name,field,op,points,old,new) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    e["created_at"], e["sid"], e["name"], e["field"], e["op"],
                    round(float(e["points"]), 2), round(float(e["old"]), 2), round(float(e["new"]), 2),
                ),
            )


def list_adjust_log(limit=500):
    with tx() as cur:
        cur.execute("SELECT * FROM adjust_log ORDER BY id DESC LIMIT %s", (limit,))
        return [{k: _plain(v) for k, v in r.items()} for r in cur.fetchall()]


def apply_secondclass(class_id, ops, meta_key, meta_value):
    """第二课堂导入：单事务内批量调 deyu 并留痕 adjust_log，最后写 meta。

    ops: list[dict]，每项 {sid, name, field, op('add'/'sub'), points, old, new}
    — 调用方已算好 old/new（含封顶/下限）与 total，这里按 new 写回 students 并同步 total。
    """
    with tx() as cur:
        for e in ops:
            cur.execute(
                "UPDATE students SET `deyu`=%s, total=%s WHERE sid=%s AND class_id=%s",
                (
                    round(float(e["new"]), 2),
                    round(float(e["total"]), 2),
                    e["sid"],
                    class_id,
                ),
            )
            cur.execute(
                "INSERT INTO adjust_log (created_at,sid,name,field,op,points,old,new) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    e["created_at"], e["sid"], e["name"], "deyu", e["op"],
                    round(float(e["points"]), 2), round(float(e["old"]), 2), round(float(e["new"]), 2),
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


def list_classes():
    with tx() as cur:
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


def clear_class_data(cid):
    """清空班级数据：返回被删申报占用的证据文件夹列表。"""
    with tx() as cur:
        cur.execute("SELECT DISTINCT folder FROM awards WHERE class_id=%s", (cid,))
        folders = [r["folder"] for r in cur.fetchall()]
        cur.execute("DELETE FROM awards WHERE class_id=%s", (cid,))
        cur.execute("DELETE FROM students WHERE class_id=%s", (cid,))
    return folders


def set_class_meta(cid, rows, source):
    with tx() as cur:
        cur.execute("UPDATE classes SET row_count=%s, source=%s WHERE id=%s", (int(rows), source, cid))


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


def verify_admin(username, password):
    admin = get_admin(username)
    if not admin:
        return None
    if hmac.compare_digest(admin["password_hash"], hash_password(password, admin["salt"])):
        return _row_admin(admin)
    return None

