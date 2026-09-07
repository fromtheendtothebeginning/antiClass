import io
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
import uuid
import zipfile
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel

from ai import (
    PROMPT_DEFAULTS,
    PROMPT_PLACEHOLDERS,
    classify,
    get_prompts,
    is_configured,
    load_config,
    moderate_content,
)
from ai_settings import PROVIDERS, SEARCH_PROVIDERS, list_models, mask_key, test_chat
import assess
import db

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DIST_DIR = BASE_DIR.parent / "frontend" / "dist"
DEFAULT_XLSX = BASE_DIR.parent / "Y3第二学期成绩导出.xlsx"
LEGACY_AI_CONFIG = BASE_DIR / "ai_config.json"
LEGACY_AI_PROMPTS = BASE_DIR / "ai_prompts.json"
UPLOADS_DIR = DATA_DIR / "uploads"

ADMIN_USER = "admin"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ROOT_PASSWORD = os.environ.get("ROOT_PASSWORD", "root123")

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

EXAM_PRIORITY = {"重修": 3, "补考一": 2, "正常考试": 1}
CATEGORY_FIELD = {"德育": "deyu", "体育": "tiyu", "美育": "meiyu", "劳育": "laoyu", "附加分": "fujia"}
CATEGORY_CAP = {"德育": 100, "体育": 100, "美育": 100, "劳育": 100, "附加分": 5}
CLASS_ROLE_POINTS = {"班长、团支书、辅导员助理": 8, "副班长、学习委员": 4, "班级其他学干": 2}

DRAFTS = {}
TOKENS = {}
DRAFTS_LOCK = threading.Lock()
RATE_BUCKET = defaultdict(deque)

app = FastAPI(title="综合奖学金评定")


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


def rate_limit(key, limit, window):
    now = time.time()
    bucket = RATE_BUCKET[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="操作过于频繁，请稍后再试")
    bucket.append(now)


def save_upload(f, upload_dir):
    suffix = Path(f.filename or "file").suffix.lower()
    if suffix in DANGEROUS_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"文件 {f.filename} 类型不允许上传（{suffix}），请转换为图片/PDF/Word 等普通文档",
        )
    name = f"{uuid.uuid4().hex}_{Path(f.filename or 'file').name}"
    target = upload_dir / name
    size = 0
    with target.open("wb") as out:
        while True:
            chunk = f.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"文件 {f.filename} 超过大小限制（10MB）")
            out.write(chunk)
    return name



class LoginBody(BaseModel):
    username: str
    password: str


class ApproveBody(BaseModel):
    points: float | None = None
    category: str | None = None


class RejectBody(BaseModel):
    reason: str = ""


class EditAwardBody(BaseModel):
    category: str
    points: float = 0
    basis: str = ""


class DraftItemBody(BaseModel):
    category: str
    points: float = 0
    basis: str = ""
    evidence: list[str] = []


class DraftSubmissionBody(BaseModel):
    draft_id: str
    items: list[DraftItemBody]


class SubmitBody(BaseModel):
    submissions: list[DraftSubmissionBody]


ADJUST_FIELDS = {"deyu": "德育", "meiyu": "美育", "laoyu": "劳育", "fujia": "附加分"}
ADJUST_OPS = {"add", "sub", "set"}


class AdjustBody(BaseModel):
    sids: str
    field: str
    op: str
    points: float


class ClassNameBody(BaseModel):
    name: str


class AdminBody(BaseModel):
    username: str
    password: str
    class_id: str = ""
    role: str = "admin"


class AdminPasswordBody(BaseModel):
    password: str


class AiConfigBody(BaseModel):
    provider: str = "custom"
    base_url: str
    model: str
    api_key: str = ""
    search_provider: str = "bing"
    search_api_key: str = ""


class AiTestBody(BaseModel):
    provider: str = "custom"
    base_url: str = ""
    model: str = ""
    api_key: str = ""


class AiPromptsBody(BaseModel):
    stage0: str
    stage1: str
    stage2: str
    stage3: str


def is_excluded(row):
    category = row[21]
    course_name = row[6]
    invalid = row[25]
    if category == "通识课":
        return True
    if "体育" in course_name:
        return True
    if invalid == "是":
        return True
    return False


def to_float(value):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return 0.0


def pick_best(course_rows):
    return max(course_rows, key=lambda r: (EXAM_PRIORITY.get(r[18], 1), to_float(r[3])))


def compute_students(rows):
    groups = {}
    sports = {}
    names = {}
    for row in rows:
        sid = row[1]
        if not sid:
            continue
        names[sid] = row[4]
        if "体育" in row[6]:
            sports.setdefault((sid, row[2]), []).append(row)
        elif not is_excluded(row):
            groups.setdefault((sid, row[2]), []).append(row)

    students = {}
    for (sid, course_code), course_rows in groups.items():
        best = pick_best(course_rows)
        score = to_float(best[3])
        if best[17] == "旷考":
            score = 0.0
        credits = to_float(best[16])
        stu = students.setdefault(
            sid,
            {"sid": sid, "name": names[sid], "course_count": 0, "credits": 0.0, "score_weight": 0.0, "gpa_weight": 0.0, "tiyu_total": 0.0, "tiyu_count": 0},
        )
        stu["course_count"] += 1
        stu["credits"] += credits
        stu["score_weight"] += score * credits
        stu["gpa_weight"] += to_float(best[19]) * credits

    for (sid, course_code), sport_rows in sports.items():
        best = pick_best(sport_rows)
        stu = students.setdefault(
            sid,
            {"sid": sid, "name": names[sid], "course_count": 0, "credits": 0.0, "score_weight": 0.0, "gpa_weight": 0.0, "tiyu_total": 0.0, "tiyu_count": 0},
        )
        stu["tiyu_total"] += to_float(best[3])
        stu["tiyu_count"] += 1

    result = []
    for stu in students.values():
        credits = stu["credits"]
        zhiyu = round(stu["score_weight"] / credits, 2) if credits else 0.0
        gpa = round(stu["gpa_weight"] / credits, 2) if credits else 0.0
        tiyu = round(stu["tiyu_total"] / stu["tiyu_count"], 2) if stu["tiyu_count"] else 60.0
        deyu, meiyu, laoyu, fujia = 70.0, 70.0, 70.0, 0.0
        result.append(
            {
                "sid": stu["sid"],
                "name": stu["name"],
                "course_count": stu["course_count"],
                "credits": round(credits, 2),
                "gpa": gpa,
                "deyu": deyu,
                "score": zhiyu,
                "tiyu": tiyu,
                "meiyu": meiyu,
                "laoyu": laoyu,
                "fujia": fujia,
                "total": calc_total(deyu, zhiyu, tiyu, meiyu, laoyu, fujia),
            }
        )
    result.sort(key=lambda s: (-s["total"], -s["score"], -s["gpa"], s["sid"]))
    for rank, stu in enumerate(result, start=1):
        stu["rank"] = rank
    return result


def calc_total(deyu, zhiyu, tiyu, meiyu, laoyu, fujia):
    return round(deyu * 0.15 + zhiyu * 0.60 + tiyu * 0.10 + meiyu * 0.05 + laoyu * 0.10 + fujia, 2)


def parse_xlsx(path):
    wb = load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = rows[0]
    if "学号" not in header:
        raise HTTPException(status_code=400, detail="表头不含「学号」列，不是有效的成绩导出文件")
    data_rows = [row for row in rows[1:] if row and row[1]]
    return compute_students(data_rows), len(data_rows)


def find_student(sid):
    return db.get_student(sid)


def undo_award_points(record):
    if record["approved"] != "是":
        return False
    stu = db.get_student(record["sid"])
    if not stu:
        return False
    field = CATEGORY_FIELD[record["category"]]
    stu[field] = round(max(stu[field] - record["points"], 0.0), 2)
    stu["total"] = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
    db.update_student_score(record["sid"], stu["class_id"], field, stu[field], stu["total"])
    return True


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


@app.post("/api/login")
def login(body: LoginBody, request: Request):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"login:{ip}", 5, 60)
    admin = db.verify_admin(body.username.strip(), body.password)
    if not admin:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    token = secrets.token_hex(16)
    TOKENS[token] = {
        "username": admin["username"],
        "role": admin["role"],
        "class_id": admin.get("class_id"),
        "exp": time.time(),
    }
    return {"token": token, "username": admin["username"], "role": admin["role"], "class_id": admin.get("class_id")}


@app.post("/api/logout")
def logout(authorization: str = Header(default="")):
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    TOKENS.pop(token, None)
    return {"ok": True}


# ---------- 加分一遍过（AI 逐项问答，流式输出） ----------

class AssessMsgBody(BaseModel):
    text: str


def _sse(events):
    for e in events:
        yield "data: " + json.dumps(e, ensure_ascii=False) + "\n\n"


@app.post("/api/assess/start")
def assess_start(sid: str = Form(...), request: Request = None):
    ip = request.client.host if request and request.client else "unknown"
    rate_limit(f"assess_start:{ip}", 10, 3600)
    sid = sid.strip()
    stu = db.get_student(sid)
    if not stu:
        raise HTTPException(status_code=400, detail=f"学号 {sid} 不存在")
    if not is_configured():
        raise HTTPException(status_code=400, detail="AI 未配置，请在管理界面「AI 设置」填写 base_url/api_key/model")
    sess = assess.start(stu["sid"], stu["name"], stu.get("class_id", ""))
    return {
        "session_id": sess["id"],
        "sid": sess["sid"],
        "name": sess["name"],
        "existing": sess.get("existing", []),
    }


@app.post("/api/assess/{session_id}/message")
async def assess_message(session_id: str, request: Request):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"assess_msg:{ip}", 30, 600)
    session = assess.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期，请重新开始")
    if session.get("ended"):
        raise HTTPException(status_code=400, detail="会话已结束，如需继续请重新开始")

    ctype = (request.headers.get("content-type") or "").lower()
    text = ""
    files = []
    if ctype.startswith("multipart/"):
        form = await request.form()
        text = (form.get("text") or "").strip()
        files = form.getlist("files") if "files" in form else []
    elif ctype.startswith("application/json"):
        body = await request.json()
        text = (body.get("text") or "").strip() if isinstance(body, dict) else ""
    if not text and not files:
        raise HTTPException(status_code=400, detail="请输入内容")

    image_paths = []
    temp_dir = None
    file_list = [f for f in files if getattr(f, "filename", None)][:MAX_FILES]
    if file_list:
        temp_dir = UPLOADS_DIR / ("assess_" + uuid.uuid4().hex)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            for f in file_list:
                name = save_upload(f, temp_dir)
                if Path(f.filename).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
                    image_paths.append(str(temp_dir / name))
        except HTTPException:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

    def _gen():
        try:
            yield from assess.run_turn(session_id, text, image_paths or None)
        finally:
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)

    return StreamingResponse(
        _sse(_gen()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 穿透 nginx 缓冲，保证流式
            "Connection": "keep-alive",
        },
    )


@app.post("/api/assess/{session_id}/finish")
def assess_finish(session_id: str):
    session = assess.finish(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")
    return {"ok": True, "done": True, "ended": True, "items": session["items"]}


@app.post("/api/assess/{session_id}/submit")
async def assess_submit(session_id: str, request: Request):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"assess_submit:{ip}", 10, 3600)
    sess = assess.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")
    form = await request.form()
    items_raw = (form.get("items") or "").strip()
    try:
        raw_items = json.loads(items_raw) if items_raw else []
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="items 格式错误")
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(status_code=400, detail="尚未确认任何加分项")

    # 校验并规范化加分项
    cleaned = []
    for it in raw_items[:30]:
        if not isinstance(it, dict):
            continue
        category = str(it.get("category", "")).strip()
        if category not in CATEGORY_FIELD:
            continue
        try:
            points = float(it.get("points", 0))
        except (TypeError, ValueError):
            points = 0.0
        cap = CATEGORY_CAP[category]
        points = round(max(0.0, min(points, cap)), 1)
        basis = str(it.get("basis", "")).strip()[:MAX_TEXT_LEN]
        if not basis:
            continue
        cleaned.append({"category": category, "points": points, "basis": basis})
    if not cleaned:
        raise HTTPException(status_code=400, detail="加分项内容无效")

    # 证据：按加分项编号上传（字段 file_0..file_n，可多文件）
    upload_dir = None
    evidence_by_index = [[] for _ in cleaned]
    has_files = False
    for i in range(len(cleaned)):
        files = form.getlist(f"file_{i}")
        if not files:
            continue
        if upload_dir is None:
            folder = uuid.uuid4().hex
            upload_dir = UPLOADS_DIR / folder
            upload_dir.mkdir(parents=True, exist_ok=True)
        try:
            for f in files[:MAX_FILES]:
                evidence_by_index[i].append(save_upload(f, upload_dir))
            has_files = True
        except HTTPException:
            if upload_dir:
                shutil.rmtree(upload_dir, ignore_errors=True)
            raise

    created = []
    now = datetime.now()
    for i, it in enumerate(cleaned):
        created.append(
            {
                "id": uuid.uuid4().hex,
                "sid": sess["sid"],
                "name": sess["name"],
                "class_id": sess["class_id"],
                "category": it["category"],
                "points": it["points"],
                "basis": it["basis"],
                "evidence": evidence_by_index[i],
                "folder": upload_dir.name if upload_dir else "",
                "approved": "否",
                "created_at": now,
            }
        )
    db.insert_awards(created)
    for r in created:
        r["created_at"] = r["created_at"].isoformat(timespec="seconds")
    assess.drop(session_id)
    return {"created": created}


@app.get("/api/classes")
def list_classes():
    return {"classes": db.list_classes()}


@app.post("/api/classes")
def add_class(body: ClassNameBody, authorization: str = Header(default="")):
    require_root(authorization)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="班级名称不能为空")
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="班级名称过长")
    if any(c["name"] == name for c in db.list_classes()):
        raise HTTPException(status_code=400, detail="班级名称已存在")
    return {"ok": True, "class": db.create_class(name)}


@app.delete("/api/classes/{cid}")
def remove_class(cid: str, authorization: str = Header(default="")):
    require_root(authorization)
    if not db.get_class(cid):
        raise HTTPException(status_code=404, detail="班级不存在")
    if db.list_students(cid):
        raise HTTPException(status_code=400, detail="该班级仍有学生，请先清除班级数据")
    db.delete_class(cid)
    return {"ok": True}


@app.post("/api/classes/{cid}/clear")
def clear_class(cid: str, authorization: str = Header(default="")):
    require_root(authorization)
    cls = db.get_class(cid)
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    folders = db.clear_class_data(cid)
    db.set_class_meta(cid, 0, "")
    for folder in folders:
        if folder and not db.folder_in_use(folder):
            shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)
    return {"ok": True, "class": cls["name"]}


@app.post("/api/admins")
def add_admin(body: AdminBody, authorization: str = Header(default="")):
    require_root(authorization)
    username = body.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{3,32}", username):
        raise HTTPException(status_code=400, detail="用户名限 3-32 位字母/数字/下划线")
    if username == "root" or db.get_admin(username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if body.role != "admin":
        raise HTTPException(status_code=400, detail="只能创建管理员账号")
    cls = db.get_class(body.class_id or "")
    if not cls:
        raise HTTPException(status_code=400, detail="负责的班级不存在")
    db.create_admin(username, body.password, "admin", cls["id"])
    return {"ok": True}


@app.delete("/api/admins/{username}")
def remove_admin(username: str, authorization: str = Header(default="")):
    session = require_root(authorization)
    admin = db.get_admin(username)
    if admin is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    if admin["role"] == "root" or username == session["username"]:
        raise HTTPException(status_code=400, detail="不能删除该账号")
    db.delete_admin(username)
    for t, s in list(TOKENS.items()):
        if s["username"] == username:
            TOKENS.pop(t, None)
    return {"ok": True}


@app.put("/api/admins/{username}")
def reset_admin_password(username: str, body: AdminPasswordBody, authorization: str = Header(default="")):
    require_root(authorization)
    admin = db.get_admin(username)
    if admin is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    if admin["role"] == "root":
        raise HTTPException(status_code=400, detail="超级管理员密码请由运维直接重置")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    db.update_admin(username, password=body.password)
    return {"ok": True}


@app.get("/api/admins")
def get_admins(authorization: str = Header(default="")):
    require_root(authorization)
    return {"admins": db.list_admins()}


@app.post("/api/upload")
def upload(
    file: UploadFile = File(...),
    class_id: str = Form(""),
    authorization: str = Header(default=""),
):
    session = require_token(authorization)
    if session["role"] == "admin":
        class_id = session.get("class_id") or ""
        if not class_id:
            raise HTTPException(status_code=400, detail="你尚未分配负责班级，请联系 root")
    cls = db.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=400, detail="班级不存在，请先创建班级")
    filename = file.filename or "upload.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 文件")
    tmp = DATA_DIR / f"{uuid.uuid4().hex}.xlsx"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tmp.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        students, rows = parse_xlsx(tmp)
    except HTTPException:
        tmp.unlink(missing_ok=True)
        raise
    db.replace_students(students, class_id)
    db.set_class_meta(class_id, rows, filename)
    tmp.unlink(missing_ok=True)
    return {"ok": True, "students": len(students), "rows": rows, "source": filename}


@app.get("/api/leaderboard")
def leaderboard(class_id: str | None = None):
    students = db.list_students(class_id or None)
    meta = {"rows": 0, "source": ""}
    if class_id:
        cls = db.get_class(class_id)
        if cls:
            meta = {"rows": cls["row_count"], "source": cls["source"]}
    return {"students": students, "meta": meta}


@app.post("/api/scores/adjust")
def adjust_scores(body: AdjustBody, authorization: str = Header(default="")):
    session = require_token(authorization)
    if body.field not in ADJUST_FIELDS:
        raise HTTPException(status_code=400, detail="分数项无效，可选：" + "、".join(ADJUST_FIELDS.values()))
    if body.op not in ADJUST_OPS:
        raise HTTPException(status_code=400, detail="操作无效，可选 add（增加）/sub（减少）/set（设为）")
    if body.points < 0:
        raise HTTPException(status_code=400, detail="数值不能为负")
    cap = 5.0 if body.field == "fujia" else 100.0
    pool = db.list_students(session.get("class_id") if session["role"] == "admin" else None)
    tokens = [t for t in re.split(r"[\s,，;；]+", body.sids.strip()) if t]
    if not tokens:
        raise HTTPException(status_code=400, detail="请填写学号（支持正则，如 251184Y3.*）")
    matched = {}
    for token in tokens:
        try:
            rx = re.compile(token)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"无效的正则表达式 {token}：{e}")
        hits = [s for s in pool if s["sid"] == token or rx.fullmatch(s["sid"])]
        if not hits:
            raise HTTPException(status_code=400, detail=f"学号/正则 {token} 未匹配到任何学生")
        for s in hits:
            matched[s["sid"]] = s
    field = body.field
    op = body.op
    changes = []
    log_entries = []
    for stu in sorted(matched.values(), key=lambda s: s["sid"]):
        old = stu[field]
        if op == "add":
            new = min(old + body.points, cap)
        elif op == "sub":
            new = max(old - body.points, 0.0)
        else:
            new = min(max(body.points, 0.0), cap)
        new = round(new, 2)
        stu[field] = new
        stu["total"] = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
        db.update_student_score(stu["sid"], stu["class_id"], field, new, stu["total"])
        changes.append({"sid": stu["sid"], "name": stu["name"], "field": field, "old": old, "new": new, "total": stu["total"]})
        log_entries.append(
            {
                "created_at": datetime.now().isoformat(timespec="seconds"),
                "sid": stu["sid"],
                "name": stu["name"],
                "field": field,
                "op": op,
                "points": body.points,
                "old": old,
                "new": new,
            }
        )
    db.insert_adjust_log(log_entries)
    return {"changed": changes}


@app.get("/api/export")
def export(class_id: str | None = None):
    wb = Workbook()
    ws = wb.active
    ws.title = "榜单"
    ws.append(["学号", "姓名", "德育", "智育", "体育", "美育", "劳育", "综合测评成绩"])
    for stu in db.list_students(class_id or None):
        ws.append(
            [
                stu["sid"],
                stu["name"],
                stu["deyu"],
                stu["score"],
                stu["tiyu"],
                stu["meiyu"],
                stu["laoyu"],
                stu["total"],
            ]
        )
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=leaderboard.xlsx"},
    )


# zip 内禁止出现的目录名字符（Windows/常规 zip 工具不友好的字符一律替换）
_ZIP_NAME_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _evidence_readable(stored_name):
    """去掉 save_upload 加的 32 位 hex 前缀，还原成可读文件名。"""
    m = re.fullmatch(r"[0-9a-f]{32}_(.+)", stored_name)
    return m.group(1) if m else stored_name


def build_evidence_zip(class_id=None):
    """把「已通过(approved=是)」申报按人打包：每人一个「学号_姓名/」目录，
    内含 申报明细.json 与 evidence/ 证据文件，外加总 index.json。返回 BytesIO。"""
    records = [r for r in db.list_awards(class_id or None) if r.get("approved") == "是"]
    if not records:
        raise HTTPException(status_code=400, detail="当前范围暂无已通过的申报，无需导出")

    # 按学号聚合（同班同人多次申报合并；姓名用记录快照，空则回退学号）
    people = {}
    for r in records:
        people.setdefault(r["sid"], {"name": r.get("name") or r["sid"], "records": []})["records"].append(r)

    buf = io.BytesIO()
    summary = {"students": [], "total_records": len(records), "total_files": 0}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sid, p in people.items():
            folder_name = _ZIP_NAME_BAD.sub("_", f"{sid}_{p['name']}") or sid
            used_names = set()  # 同人证据去重名
            person_files = 0
            person_json = {"sid": sid, "name": p["name"], "class_id": p["records"][0].get("class_id", ""), "records": []}
            for r in p["records"]:
                rec_json = {
                    "id": r["id"],
                    "category": r["category"],
                    "points": r["points"],
                    "basis": r["basis"],
                    "created_at": r["created_at"],
                    "approved": r["approved"],
                    "evidence": [],
                }
                base = (UPLOADS_DIR / (r.get("folder") or "")).resolve()
                for f in r.get("evidence") or []:
                    if not r.get("folder"):
                        rec_json["evidence"].append({"source": f, "missing": True})
                        continue
                    path = (base / f).resolve()
                    if not path.is_relative_to(base) or not path.exists():
                        rec_json["evidence"].append({"source": f, "missing": True})
                        continue
                    # 归档名：还原可读原名，冲突时加序号（如 xxx_2.png）
                    name = _evidence_readable(f)
                    stem, dot = Path(name).stem, Path(name).suffix
                    archive = name
                    n = 2
                    while archive in used_names:
                        archive = f"{stem}_{n}{dot}"
                        n += 1
                    used_names.add(archive)
                    zf.write(path, f"{folder_name}/evidence/{archive}")
                    rec_json["evidence"].append({"file": f"evidence/{archive}", "source": f, "missing": False})
                    person_files += 1
                person_json["records"].append(rec_json)
            zf.writestr(f"{folder_name}/申报明细.json", json.dumps(person_json, ensure_ascii=False, indent=2))
            summary["students"].append({"sid": sid, "name": p["name"], "records": len(person_json["records"]), "files": person_files, "folder": folder_name})
            summary["total_files"] += person_files
        zf.writestr("index.json", json.dumps(summary, ensure_ascii=False, indent=2))
    buf.seek(0)
    return buf


@app.get("/api/export/evidence-zip")
def export_evidence_zip(class_id: str | None = None, authorization: str = Header(default="")):
    session = require_token(authorization)
    if class_id:
        check_class_scope(session, class_id)
    else:
        if session["role"] != "root":
            class_id = session.get("class_id")
            if not class_id:
                raise HTTPException(status_code=403, detail="账号未绑定班级，无法导出")
    buf = build_evidence_zip(class_id)
    zip_name = f"evidence_backup_{datetime.now():%Y%m%d}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={zip_name}",
            # zip 已在内存完整生成，显式给 Content-Length，避免 chunked 下载在某些浏览器被拦截
            "Content-Length": str(len(buf.getvalue())),
        },
    )


@app.post("/api/awards/analyze")
def analyze_award(
    sid: str = Form(...),
    text: str = Form(""),
    files: list[UploadFile] | None = File(default=None),
    request: Request = None,
):
    ip = request.client.host if request and request.client else "unknown"
    rate_limit(f"analyze:{ip}", 10, 3600)
    sid = sid.strip()
    stu = find_student(sid)
    if not stu:
        raise HTTPException(status_code=400, detail=f"学号 {sid} 不存在")
    if len(text) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail=f"申报描述过长（最多 {MAX_TEXT_LEN} 字）")
    if not is_configured():
        raise HTTPException(status_code=400, detail="AI 未配置，请在管理界面「AI 设置」填写 base_url/api_key/model")
    file_list = [f for f in (files or []) if f.filename][:MAX_FILES]
    folder = uuid.uuid4().hex
    upload_dir = UPLOADS_DIR / folder
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    image_paths = []
    try:
        for f in file_list:
            name = save_upload(f, upload_dir)
            saved.append(name)
            if Path(f.filename).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
                image_paths.append(str(upload_dir / name))
        items = classify(text, image_paths)
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except RuntimeError as e:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(e))
    with DRAFTS_LOCK:
        image_names = [n for n in saved if Path(n).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}]
        other_names = [n for n in saved if n not in image_names]
        draft_items = []
        for it in items:
            category = it.get("category", "")
            if category not in CATEGORY_FIELD:
                continue
            if "images" in it and isinstance(it.get("images"), list):
                files = []
                for i in it["images"]:
                    if isinstance(i, int) and 1 <= i <= len(image_names) and image_names[i - 1] not in files:
                        files.append(image_names[i - 1])
            else:
                files = list(image_names)
            files += [n for n in other_names if n not in files]
            try:
                points = float(it.get("points", 0))
            except (TypeError, ValueError):
                points = 0.0
            points = round(max(0.0, min(points, CATEGORY_CAP[category])), 1)
            draft_items.append(
                {
                    "category": category,
                    "points": points,
                    "basis": str(it.get("basis", "")).strip(),
                    "review": str(it.get("review", "")).strip(),
                    "evidence": files,
                }
            )
        if not draft_items:
            shutil.rmtree(upload_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="未能从材料中识别出加分项")
        draft_id = uuid.uuid4().hex
        DRAFTS[draft_id] = {
            "id": draft_id,
            "sid": stu["sid"],
            "name": stu["name"],
            "class_id": stu.get("class_id", ""),
            "folder": folder,
            "items": draft_items,
            "evidence": sorted({f for it in draft_items for f in it["evidence"]}),
        }
        if len(DRAFTS) > 200:
            for k in list(DRAFTS)[: len(DRAFTS) - 200]:
                DRAFTS.pop(k, None)
    return {"draft_id": draft_id, "sid": stu["sid"], "name": stu["name"], "items": draft_items}


@app.post("/api/awards/drafts/{draft_id}/delete")
def delete_award_draft(draft_id: str, request: Request):
    """删除未提交的 AI 分析草稿（公开）：仅限内存中存在的草稿，连带清理其临时证据文件。"""
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"draft_delete:{ip}", 30, 600)
    with DRAFTS_LOCK:
        draft = DRAFTS.get(draft_id)
        if not draft:
            raise HTTPException(status_code=404, detail="草稿不存在或已提交")
        folder = draft.get("folder", "")
        DRAFTS.pop(draft_id, None)
    if folder and not db.folder_in_use(folder):
        shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)
    return {"ok": True}


@app.post("/api/awards/submit")
def submit_awards(request: Request, body: SubmitBody):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"submit:{ip}", 30, 600)
    with DRAFTS_LOCK:
        created = []
        for sub in body.submissions[:20]:
            draft = DRAFTS.get(sub.draft_id)
            if not draft:
                raise HTTPException(status_code=404, detail=f"草稿 {sub.draft_id[:8]}… 不存在或已提交，请重新分析")
            for it in sub.items[:20]:
                category = it.category
                if category not in CATEGORY_FIELD:
                    raise HTTPException(status_code=400, detail="加分栏目无效")
                if len(it.basis) > MAX_TEXT_LEN:
                    raise HTTPException(status_code=400, detail="加分依据过长")
                evidence = [f for f in it.evidence if f in draft["evidence"]]
                cap = CATEGORY_CAP[category]
                points = round(min(max(it.points, 0.0), cap), 1)
                created.append(
                    {
                        "id": uuid.uuid4().hex,
                        "sid": draft["sid"],
                        "name": draft["name"],
                        "class_id": draft.get("class_id", ""),
                        "category": category,
                        "points": points,
                        "basis": it.basis,
                        "evidence": evidence,
                        "folder": draft["folder"],
                        "approved": "否",
                        "created_at": datetime.now(),
                    }
                )
        db.insert_awards(created)
        for sub in body.submissions:
            DRAFTS.pop(sub.draft_id, None)
    return {"created": created}


@app.get("/api/awards")
def list_awards(class_id: str | None = None):
    return {"awards": db.list_awards(class_id or None)}


@app.get("/api/awards/{aid}/evidence/{filename}")
def award_evidence(aid: str, filename: str):
    record = db.get_award(aid)
    if not record:
        record = DRAFTS.get(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    if filename not in record["evidence"]:
        raise HTTPException(status_code=404, detail="证据文件不存在")
    media_type = EVIDENCE_MEDIA.get(Path(filename).suffix.lower(), "application/octet-stream")
    base = (UPLOADS_DIR / record["folder"]).resolve()
    path = (base / filename).resolve()
    if not path.is_relative_to(base) or not path.exists():
        raise HTTPException(status_code=404, detail="证据文件不存在")
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.post("/api/awards/manual")
def manual_award(
    sid: str = Form(...),
    category: str = Form(...),
    points: float = Form(0),
    basis: str = Form(""),
    files: list[UploadFile] | None = File(default=None),
    request: Request = None,
):
    ip = request.client.host if request and request.client else "unknown"
    rate_limit(f"manual:{ip}", 10, 3600)
    sid = sid.strip()
    stu = find_student(sid)
    if not stu:
        raise HTTPException(status_code=400, detail=f"学号 {sid} 不存在")
    if category not in CATEGORY_FIELD:
        raise HTTPException(status_code=400, detail="加分栏目无效，可选：" + "、".join(CATEGORY_FIELD))
    if not basis.strip():
        raise HTTPException(status_code=400, detail="请填写加分依据")
    if len(basis) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail=f"加分依据过长（最多 {MAX_TEXT_LEN} 字）")
    file_list = [f for f in (files or []) if f.filename][:MAX_FILES]
    folder = uuid.uuid4().hex
    upload_dir = UPLOADS_DIR / folder
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    try:
        for f in file_list:
            saved.append(save_upload(f, upload_dir))
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    cap = CATEGORY_CAP[category]
    points = round(min(max(points, 0.0), cap), 1)
    record = {
        "id": uuid.uuid4().hex,
        "sid": stu["sid"],
        "name": stu["name"],
        "class_id": stu.get("class_id", ""),
        "category": category,
        "points": points,
        "basis": basis.strip(),
        "evidence": saved,
        "folder": folder,
        "approved": "否",
        "created_at": datetime.now(),
    }
    db.insert_awards([record])
    record["created_at"] = record["created_at"].isoformat(timespec="seconds")
    return {"created": [record]}


@app.post("/api/awards/class-committee")
def class_committee(
    sid: str = Form(...),
    role: str = Form(...),
    files: list[UploadFile] | None = File(default=None),
    request: Request = None,
):
    ip = request.client.host if request and request.client else "unknown"
    rate_limit(f"committee:{ip}", 10, 3600)
    sid = sid.strip()
    stu = find_student(sid)
    if not stu:
        raise HTTPException(status_code=400, detail=f"学号 {sid} 不存在")
    if role not in CLASS_ROLE_POINTS:
        raise HTTPException(status_code=400, detail="班委职务无效，可选：" + "、".join(CLASS_ROLE_POINTS))
    file_list = [f for f in (files or []) if f.filename][:MAX_FILES]
    folder = uuid.uuid4().hex
    upload_dir = UPLOADS_DIR / folder
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    try:
        for f in file_list:
            saved.append(save_upload(f, upload_dir))
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    record = {
        "id": uuid.uuid4().hex,
        "sid": stu["sid"],
        "name": stu["name"],
        "class_id": stu.get("class_id", ""),
        "category": "德育",
        "points": CLASS_ROLE_POINTS[role],
        "basis": f"担任班级职务：{role}，任职满六个月，按评分办法德育·学生骨干类（班级档）加分",
        "evidence": saved,
        "folder": folder,
        "approved": "否",
        "created_at": datetime.now(),
    }
    db.insert_awards([record])
    record["created_at"] = record["created_at"].isoformat(timespec="seconds")
    return {"created": [record]}


@app.post("/api/awards/batch")
def batch_award(
    sids: str = Form(...),
    category: str = Form(...),
    points: float = Form(0),
    basis: str = Form(""),
    files: list[UploadFile] | None = File(default=None),
    authorization: str = Header(default=""),
):
    session = require_token(authorization)
    if category not in CATEGORY_FIELD:
        raise HTTPException(status_code=400, detail="加分栏目无效，可选：" + "、".join(CATEGORY_FIELD))
    if len(basis) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail=f"加分依据过长（最多 {MAX_TEXT_LEN} 字）")
    raw_sids = re.split(r"[\s,，;；]+", sids.strip())
    sid_list = list(dict.fromkeys(s for s in raw_sids if s))
    invalid = [s for s in sid_list if not find_student(s)]
    if invalid:
        raise HTTPException(status_code=400, detail="学号不存在：" + "、".join(invalid))
    file_list = [f for f in (files or []) if f.filename][:MAX_FILES]
    folder = uuid.uuid4().hex
    upload_dir = UPLOADS_DIR / folder
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    try:
        for f in file_list:
            saved.append(save_upload(f, upload_dir))
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    cap = CATEGORY_CAP[category]
    points = round(min(max(points, 0.0), cap), 1)
    created = []
    now = datetime.now()
    for sid in sid_list:
        stu = find_student(sid)
        check_class_scope(session, stu.get("class_id", ""))
        record = {
            "id": uuid.uuid4().hex,
            "sid": stu["sid"],
            "name": stu["name"],
            "class_id": stu.get("class_id", ""),
            "category": category,
            "points": points,
            "basis": basis,
            "evidence": saved,
            "folder": folder,
            "approved": "否",
            "created_at": now,
        }
        created.append(record)
    db.insert_awards(created)
    for r in created:
        r["created_at"] = r["created_at"].isoformat(timespec="seconds")
    return {"created": created}


@app.post("/api/awards/{aid}/approve")
def approve_award(aid: str, body: ApproveBody, authorization: str = Header(default="")):
    session = require_token(authorization)
    record = db.get_award(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    check_class_scope(session, record.get("class_id", ""))
    if record["approved"] != "否":
        raise HTTPException(status_code=400, detail="该申报已处理，不能重复审批")
    category = body.category or record["category"]
    points = body.points if body.points is not None else record["points"]
    if category not in CATEGORY_FIELD:
        raise HTTPException(status_code=400, detail="加分栏目无效")
    stu = db.get_student(record["sid"])
    if not stu:
        raise HTTPException(status_code=400, detail="学生不存在")
    field = CATEGORY_FIELD[category]
    cap = CATEGORY_CAP[category]
    points = round(min(max(points, 0.0), cap), 1)
    stu[field] = round(min(stu[field] + points, cap), 2)
    stu["total"] = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
    db.update_student_score(stu["sid"], stu["class_id"], field, stu[field], stu["total"])
    db.update_award(aid, category=category, points=points, approved="是")
    record = db.get_award(aid)
    return {"ok": True, "award": record, "student": stu}


@app.post("/api/awards/{aid}/reject")
def reject_award(aid: str, body: RejectBody = None, authorization: str = Header(default="")):
    session = require_token(authorization)
    record = db.get_award(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    check_class_scope(session, record.get("class_id", ""))
    if record["approved"] != "否":
        raise HTTPException(status_code=400, detail="该申报已处理，不能重复审批")
    reason = ((body.reason if body else "") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="请填写驳回理由")
    reason = reason[:500]
    db.update_award(aid, approved="驳回", reject_reason=reason)
    record = db.get_award(aid)
    return {"ok": True, "award": record}


@app.post("/api/awards/{aid}/edit")
async def edit_award(
    aid: str,
    request: Request,
    authorization: str = Header(default=""),
):
    """驳回后编辑重提：公开（申报人本人即可修改后重交），仅 approved=驳回 的记录允许
    修改栏目/分值/依据并追加证据文件。支持 multipart（category/points/basis/files[]）
    与 JSON 两种提交；新上传证据经类型黑名单 + AI 内容审核（图片/文本）双重检查，违规拒收。
    服务端不校验登录——驳回状态本身就是"待本人修订"；带 token 时仍校验班级范围一致性。
    """
    ip = request.client.host if request and request.client else "unknown"
    rate_limit(f"award_edit:{ip}", 10, 3600)
    session = None
    if (authorization or "").startswith("Bearer "):
        session = require_token(authorization)
    record = db.get_award(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    if session and record.get("class_id"):
        check_class_scope(session, record.get("class_id", ""))
    if record["approved"] != "驳回":
        raise HTTPException(status_code=400, detail="仅已驳回的申报可编辑后重提")

    ctype = (request.headers.get("content-type") or "").lower()
    category = None
    points = None
    basis = None
    new_files = []
    if ctype.startswith("multipart/"):
        form = await request.form()
        category = (form.get("category") or "").strip()
        try:
            points = float(form.get("points") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="加分分值无效")
        basis = (form.get("basis") or "").strip()
        new_files = form.getlist("files") if "files" in form else []
    else:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="请求格式错误")
        category = (body.get("category") or "").strip()
        try:
            points = float(body.get("points") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="加分分值无效")
        basis = (body.get("basis") or "").strip()

    if category not in CATEGORY_FIELD:
        raise HTTPException(status_code=400, detail="加分栏目无效")
    cap = CATEGORY_CAP[category]
    points = round(min(max(points, 0.0), cap), 1)
    if not basis:
        raise HTTPException(status_code=400, detail="加分依据不能为空")
    basis = basis[:MAX_TEXT_LEN]

    # 追加证据：先落盘临时目录 → 类型/内容审核 → 通过则移入证据文件夹
    evidence = list(record.get("evidence") or [])
    uploaded = []
    folder = record.get("folder") or ""
    file_list = [f for f in new_files if getattr(f, "filename", None)][:MAX_FILES]
    if file_list:
        if not folder:
            folder = uuid.uuid4().hex
        upload_dir = UPLOADS_DIR / folder
        upload_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir = UPLOADS_DIR / ("edit_" + uuid.uuid4().hex)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            for f in file_list:
                name = save_upload(f, tmp_dir)  # 危险扩展名在此被拒
                uploaded.append(name)
            # AI 内容审核：图片（识图）+ 文本类文件取前 2KB 内容
            image_paths = [
                str(tmp_dir / n) for n in uploaded
                if Path(n).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
            ]
            text_snips = []
            for n in uploaded:
                suf = Path(n).suffix.lower()
                if suf in {".txt", ".md", ".csv", ".json", ".log", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip"}:
                    try:
                        data = (tmp_dir / n).read_bytes()[:4096]
                        text_snips.append(f"[{n}] " + data.decode("utf-8", "ignore")[:2000])
                    except OSError:
                        pass
            if image_paths or text_snips:
                ok, reason = moderate_content(image_paths=image_paths, texts=text_snips)
                if not ok:
                    raise HTTPException(status_code=400, detail=f"文件内容审核未通过：{reason}")
            # 通过 → 移入正式证据目录
            for n in uploaded:
                shutil.move(str(tmp_dir / n), str(upload_dir / n))
            evidence = evidence + uploaded
        except HTTPException:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
        finally:
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir, ignore_errors=True)

    db.update_award(
        aid,
        category=category, points=points, basis=basis,
        evidence=evidence, folder=folder, approved="否", reject_reason="",
    )
    record = db.get_award(aid)
    return {"ok": True, "award": record}


@app.post("/api/awards/{aid}/withdraw")
def withdraw_award(aid: str, authorization: str = Header(default="")):
    session = require_token(authorization)
    record = db.get_award(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    check_class_scope(session, record.get("class_id", ""))
    if record["approved"] == "否":
        raise HTTPException(status_code=400, detail="该申报为待审批状态，无需撤回")
    undone = undo_award_points(record)
    db.update_award(aid, approved="否")
    record = db.get_award(aid)
    return {"ok": True, "undone": undone, "award": record}


@app.post("/api/awards/{aid}/delete")
def delete_award(aid: str, authorization: str = Header(default="")):
    session = require_token(authorization)
    record = db.get_award(aid)
    if not record:
        raise HTTPException(status_code=404, detail="申报不存在")
    check_class_scope(session, record.get("class_id", ""))
    undone = undo_award_points(record)
    db.delete_award(aid)
    folder = record["folder"]
    # folder 为空时 UPLOADS_DIR / "" 等于 uploads 根目录，会误删全部证据，必须跳过
    if folder and not db.folder_in_use(folder):
        shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)
    return {"ok": True, "undone": undone}


def _read_ai_config_raw():
    cfg = db.get_setting("ai_config")
    return cfg if isinstance(cfg, dict) else {}


def _guess_provider(base_url):
    for pid, p in PROVIDERS.items():
        if p["base_url"] and base_url.rstrip("/") == p["base_url"].rstrip("/"):
            return pid
    return "custom"


@app.get("/api/ai/settings")
def get_ai_settings(authorization: str = Header(default="")):
    require_root(authorization)
    raw = _read_ai_config_raw()
    cfg = load_config() or {}
    base_url = cfg.get("base_url", "")
    key = cfg.get("api_key", "")
    search = raw.get("search") or {}
    search_key = search.get("api_key", "")
    return {
        "config": {
            "provider": raw.get("provider") or _guess_provider(base_url),
            "base_url": base_url,
            "model": cfg.get("model", ""),
            "api_key_masked": mask_key(key),
            "has_key": bool(key),
            "search": {
                "provider": search.get("provider", "bing"),
                "api_key_masked": mask_key(search_key),
                "has_key": bool(search_key),
            },
        },
        "providers": [
            {
                "id": pid,
                "label": p["label"],
                "base_url": p["base_url"],
                "default_model": p["default_model"],
                "models": p["models"],
            }
            for pid, p in PROVIDERS.items()
        ],
        "search_providers": list(SEARCH_PROVIDERS),
        "prompts": get_prompts(),
        "defaults": PROMPT_DEFAULTS,
        "placeholders": PROMPT_PLACEHOLDERS,
    }


@app.post("/api/ai/settings")
def save_ai_settings(body: AiConfigBody, authorization: str = Header(default="")):
    require_root(authorization)
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")
    if not body.model.strip():
        raise HTTPException(status_code=400, detail="模型 ID 不能为空")
    if body.search_provider not in SEARCH_PROVIDERS:
        raise HTTPException(status_code=400, detail="搜索源无效")
    raw = _read_ai_config_raw()
    old_search = raw.get("search") or {}
    config = {
        "provider": body.provider if body.provider in PROVIDERS else "custom",
        "base_url": body.base_url.strip().rstrip("/"),
        "model": body.model.strip(),
        "api_key": body.api_key.strip() or raw.get("api_key", ""),
        "search": {
            "provider": body.search_provider,
            "api_key": body.search_api_key.strip() or old_search.get("api_key", ""),
        },
    }
    db.set_setting("ai_config", config)
    return {
        "ok": True,
        "config": {
            "provider": config["provider"],
            "base_url": config["base_url"],
            "model": config["model"],
            "api_key_masked": mask_key(config["api_key"]),
            "has_key": bool(config["api_key"]),
            "search": {
                "provider": config["search"]["provider"],
                "api_key_masked": mask_key(config["search"]["api_key"]),
                "has_key": bool(config["search"]["api_key"]),
            },
        },
    }


@app.post("/api/ai/test")
def test_ai_settings(body: AiTestBody, authorization: str = Header(default="")):
    require_root(authorization)
    cfg = load_config() or {}
    base_url = body.base_url.strip() or cfg.get("base_url", "")
    model = body.model.strip() or cfg.get("model", "")
    api_key = body.api_key.strip() or cfg.get("api_key", "")
    if not base_url or not model:
        return {"ok": False, "latency_ms": 0, "error": "请先填写 Base URL 和模型"}
    ok, latency, error = test_chat(api_key, model, base_url)
    return {"ok": ok, "latency_ms": latency, "error": error}


@app.post("/api/ai/models")
def ai_model_list(body: AiTestBody, authorization: str = Header(default="")):
    require_root(authorization)
    cfg = load_config() or {}
    pid = body.provider if body.provider in PROVIDERS else "custom"
    provider = PROVIDERS[pid]
    base_url = body.base_url.strip() or provider["base_url"] or cfg.get("base_url", "")
    api_key = body.api_key.strip() or cfg.get("api_key", "")
    fallback = [m["id"] for m in provider.get("models", [])]
    ok, models, error = list_models(api_key, base_url, fallback)
    return {"ok": ok, "models": models, "error": error}


@app.post("/api/ai/prompts")
def save_ai_prompts(body: AiPromptsBody, authorization: str = Header(default="")):
    require_root(authorization)
    data = {"stage0": body.stage0, "stage1": body.stage1, "stage2": body.stage2, "stage3": body.stage3}
    missing = []
    for stage, required in PROMPT_PLACEHOLDERS.items():
        for ph in required:
            if ph not in data[stage]:
                missing.append(f"{stage} 缺少占位符 {ph}")
    if missing:
        raise HTTPException(status_code=400, detail="；".join(missing))
    for stage, text in data.items():
        if len(text) > 20000:
            raise HTTPException(status_code=400, detail=f"{stage} 提示词过长（>20000 字符）")
    db.set_setting("ai_prompts", data)
    return {"ok": True, "prompts": get_prompts()}


@app.post("/api/ai/prompts/reset")
def reset_ai_prompts(authorization: str = Header(default="")):
    require_root(authorization)
    db.delete_setting("ai_prompts")
    return {"ok": True, "prompts": dict(PROMPT_DEFAULTS)}


def _read_json_legacy(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


db.init_db()

# 账号播种：无超级管理员时创建 root（密码 ROOT_PASSWORD 环境变量，默认 root123）。
# 按 role 判断而非固定用户名，保证超级管理员改名（如 root→end）后重启不会复活 root 后门。
if not db.root_exists():
    db.create_admin("root", ROOT_PASSWORD, "root", None)

# 班级迁移：已存在但无班级的学生/申报归入第一个班级
if not db.list_classes():
    db.create_class("251184Y3")
with db.tx() as cur:
    cur.execute("SELECT id FROM classes ORDER BY created_at ASC LIMIT 1")
    FIRST_CLASS = cur.fetchone()["id"]
with db.tx() as cur:
    cur.execute("UPDATE students SET class_id=%s WHERE class_id=''", (FIRST_CLASS,))
    cur.execute("UPDATE awards SET class_id=%s WHERE class_id=''", (FIRST_CLASS,))
if not db.get_admin("admin"):
    db.create_admin("admin", ADMIN_PASSWORD, "admin", FIRST_CLASS)

# 一次性迁移：旧 JSON 数据与 AI 配置/提示词 → MySQL，迁完即删
if not db.list_students():
    state = _read_json_legacy(DATA_DIR / "state.json")
    if state and state.get("students"):
        db.replace_students(state["students"], FIRST_CLASS)
        db.set_class_meta(FIRST_CLASS, state.get("rows", 0), state.get("source", ""))
if not db.list_awards():
    awards = _read_json_legacy(DATA_DIR / "awards.json")
    if awards:
        db.insert_awards(awards)
if db.get_setting("ai_config") is None and LEGACY_AI_CONFIG.exists():
    cfg = _read_json_legacy(LEGACY_AI_CONFIG)
    if isinstance(cfg, dict):
        db.set_setting("ai_config", cfg)
if db.get_setting("ai_prompts") is None and LEGACY_AI_PROMPTS.exists():
    prompts = _read_json_legacy(LEGACY_AI_PROMPTS)
    if isinstance(prompts, dict):
        db.set_setting("ai_prompts", prompts)
for legacy in (DATA_DIR / "state.json", DATA_DIR / "awards.json", DATA_DIR / "adjust_log.json", LEGACY_AI_CONFIG, LEGACY_AI_PROMPTS):
    legacy.unlink(missing_ok=True)

if not db.list_students() and DEFAULT_XLSX.exists():
    students, rows = parse_xlsx(DEFAULT_XLSX)
    db.replace_students(students, FIRST_CLASS)
    db.set_class_meta(FIRST_CLASS, rows, DEFAULT_XLSX.name)

if DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="frontend")
else:
    @app.get("/")
    def index():
        return JSONResponse({"detail": "前端未构建（frontend/dist 不存在），请先构建前端"}, status_code=404)


if __name__ == "__main__":
    if sys.stdout is None:
        sys.stdout = open(BASE_DIR / "server.log", "a", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = sys.stdout
    uvicorn.run(app, host="127.0.0.1", port=8000)