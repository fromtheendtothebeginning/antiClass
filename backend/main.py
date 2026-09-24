import base64
import binascii
import hashlib
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
from urllib.parse import quote

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils.exceptions import InvalidFileException
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

app = FastAPI(title="anticlass")


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


AVATAR_PREFIX = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$")
MAX_AVATAR_CHARS = 300_000  # ≈225 KB 原始图片，前端已压到 192px


class ProfileBody(BaseModel):
    nickname: str = ""
    avatar: str | None = None  # None=不变，""=清除，data URL=替换


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


def _first_exam_score(course_rows):
    """按办法「第一次考试」口径取课程成绩：优先正常考试（取其中最高），
    无正常考试记录才降级取 重修>补考一 的优先级最高记录；旷考按 0 分。"""
    normals = [r for r in course_rows if r[18] == "正常考试"]
    if normals:
        return max(to_float(r[3]) for r in normals)
    best = pick_best(course_rows)
    score = to_float(best[3])
    if best[17] == "旷考":
        score = 0.0
    return score


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
            {"sid": sid, "name": names[sid], "course_count": 0, "credits": 0.0, "score_weight": 0.0, "gpa_weight": 0.0, "tiyu_total": 0.0, "tiyu_count": 0, "failed": False},
        )
        stu["course_count"] += 1
        stu["credits"] += credits
        stu["score_weight"] += score * credits
        stu["gpa_weight"] += to_float(best[19]) * credits
        # 参评资格：当学期课程（不含通识课/体育课）第一次考试无不及格；任一 <60 即挂科
        if _first_exam_score(course_rows) < 60:
            stu["failed"] = True

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
                "failed": stu["failed"],
                "total": calc_total(deyu, zhiyu, tiyu, meiyu, laoyu, fujia),
            }
        )
    result.sort(key=lambda s: (-s["total"], -s["score"], -s["gpa"], s["sid"]))
    for rank, stu in enumerate(result, start=1):
        stu["rank"] = rank
    return result


def calc_total(deyu, zhiyu, tiyu, meiyu, laoyu, fujia):
    return round(deyu * 0.15 + zhiyu * 0.60 + tiyu * 0.10 + meiyu * 0.05 + laoyu * 0.10 + fujia, 2)


# 解析 xlsx 时的“文件本身有问题”类异常：非 zip/损坏（BadZipFile）、
# 不支持的格式（InvalidFileException）、缺内部部件（KeyError）、空表/短行（IndexError）
XLSX_PARSE_ERRORS = (zipfile.BadZipFile, InvalidFileException, KeyError, IndexError)


def drop_tmp(path):
    """删除临时 xlsx。解析中途抛错时 openpyxl 可能仍占用文件句柄，Windows 会拒绝删除
    （PermissionError），此处忽略删除失败，避免把 400 顺手变成 500。"""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


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
    return {
        "token": token,
        "username": admin["username"],
        "role": admin["role"],
        "class_id": admin.get("class_id"),
        "nickname": admin.get("nickname", ""),
    }


@app.post("/api/logout")
def logout(authorization: str = Header(default="")):
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    TOKENS.pop(token, None)
    return {"ok": True}


@app.get("/api/me")
def me(authorization: str = Header(default="")):
    """校验当前 token 是否仍有效，供前端刷新页面时验证会话。"""
    session = require_token(authorization)
    admin = db.get_admin(session["username"]) or {}
    return {
        "username": session["username"],
        "role": session["role"],
        "class_id": session.get("class_id"),
        "nickname": admin.get("nickname", ""),
        "avatar": db.get_avatar(session["username"]),
        "exp": session["exp"],
    }


@app.post("/api/profile")
def save_profile(body: ProfileBody, authorization: str = Header(default="")):
    """当前账号改自己的昵称/头像（头像存 data URL，前端已压到 192px）。"""
    session = require_token(authorization)
    username = session["username"]
    nickname = re.sub(r"[\x00-\x1f\x7f]", "", body.nickname).strip()
    if len(nickname) > 24:
        raise HTTPException(status_code=400, detail="昵称最多 24 个字")
    avatar = body.avatar
    if avatar:  # None=不变、""=清除 都不需要校验
        if len(avatar) > MAX_AVATAR_CHARS:
            raise HTTPException(status_code=400, detail="头像图片过大（请压缩到 192px 以内）")
        if not AVATAR_PREFIX.match(avatar):
            raise HTTPException(status_code=400, detail="头像只支持 PNG/JPG/WebP/GIF 图片")
    db.update_profile(username, nickname=nickname, avatar=avatar)
    return {"ok": True, "nickname": nickname, "avatar": db.get_avatar(username)}


# ---------- 背景图案（全站外观：公开可读，登录后可改） ----------
# 电脑端（宽屏）/ 手机端（≤768px）两套独立配置；内置图案只存 id（前端 index.css 里定义画法），
# 自定义图案存 data/patterns/ 下的文件并由 /api/appearance/pattern/{slot} 公开提供（带内容版本号便于缓存）。

PATTERN_NAME = {"grid": "网格", "dots": "点阵", "stripes": "斜纹", "custom": "自定义", "none": "无图案"}
PATTERN_SLOTS = ("desktop", "mobile")
DEFAULT_PATTERN = "grid"
PATTERNS_DIR = DATA_DIR / "patterns"
PATTERN_IMAGE_RE = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,")
PATTERN_EXT = {"png": ".png", "jpeg": ".jpg", "jpg": ".jpg", "webp": ".webp", "gif": ".gif"}
PATTERN_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
MAX_PATTERN_CHARS = 1_200_000  # ≈900 KB 原始图片（前端已压到 ≤1600px 并按宽度铺满）


class PatternSlotBody(BaseModel):
    pattern: str
    image: str = ""  # 仅「自定义」且这次换了新图时传 data URL；留空表示沿用已上传的图


class AppearanceBody(BaseModel):
    desktop: PatternSlotBody
    mobile: PatternSlotBody


def _appearance_raw():
    cfg = db.get_setting("appearance")
    return cfg if isinstance(cfg, dict) else {}


def _pattern_slot(cfg, slot):
    """取某一端的配置。兼容早期单槽格式 {"pattern": "dots"}（当作电脑端/手机端同款）。"""
    raw = cfg.get(slot)
    if not isinstance(raw, dict):
        raw = cfg if cfg.get("pattern") else {}
    pattern = raw.get("pattern")
    if pattern not in PATTERN_NAME:
        pattern = DEFAULT_PATTERN
    file = raw.get("file") if isinstance(raw.get("file"), str) else ""
    return {"pattern": pattern, "file": file, "v": raw.get("v", "") if isinstance(raw.get("v"), str) else ""}


def _pattern_response(slot, data):
    """给前端的形态：自带可缓存的图片 URL；自定义图丢失时退回默认图案，避免全站空白。"""
    out = {"pattern": data["pattern"], "url": ""}
    if data["pattern"] == "custom" and data["file"] and (PATTERNS_DIR / data["file"]).is_file():
        out["url"] = f"/api/appearance/pattern/{slot}?v={data['v'] or '0'}"
    elif data["pattern"] == "custom":
        out["pattern"] = DEFAULT_PATTERN
    return out


@app.get("/api/appearance")
def get_appearance():
    """背景图案是全站的，访客（未登录）也要按保存的图案渲染，故无需 token。"""
    cfg = _appearance_raw()
    return {slot: _pattern_response(slot, _pattern_slot(cfg, slot)) for slot in PATTERN_SLOTS}


@app.get("/api/appearance/pattern/{slot}")
def get_pattern_image(slot: str):
    """自定义图案图片（公开，长缓存）：文件名由服务端生成，扩展名只可能是图片白名单里的几个。"""
    if slot not in PATTERN_SLOTS:
        raise HTTPException(status_code=404, detail="无此图案位")
    data = _pattern_slot(_appearance_raw(), slot)
    path = (PATTERNS_DIR / data["file"]) if data["file"] else None
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="尚未上传自定义图案")
    ext = Path(data["file"]).suffix.lower()
    return FileResponse(
        path,
        media_type=PATTERN_MEDIA.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff"},
    )


@app.post("/api/appearance")
def save_appearance(body: AppearanceBody, authorization: str = Header(default="")):
    """登录的管理员即可调整（后台配置项，不区分 role）：一次提交电脑端 + 手机端两端。"""
    require_token(authorization)
    cur = _appearance_raw()
    saved = {}
    for slot in PATTERN_SLOTS:
        slot_body = getattr(body, slot)
        old = _pattern_slot(cur, slot)
        if slot_body.pattern not in PATTERN_NAME:
            raise HTTPException(status_code=400, detail="背景图案无效，可选：" + "、".join(PATTERN_NAME.values()))
        entry = {"pattern": slot_body.pattern}
        # 已上传的图跨开关保留：切回「自定义」时不必重新上传
        if old["file"]:
            entry["file"], entry["v"] = old["file"], old["v"]
        if slot_body.pattern == "custom":
            if slot_body.image:
                if len(slot_body.image) > MAX_PATTERN_CHARS:
                    raise HTTPException(status_code=400, detail=f"{slot} 端的自定义图案过大（请压到 1600px 以内）")
                m = PATTERN_IMAGE_RE.match(slot_body.image)
                if not m:
                    raise HTTPException(status_code=400, detail="自定义图案只支持 PNG/JPG/WebP/GIF 图片")
                try:
                    blob = base64.b64decode(slot_body.image.split(",", 1)[1], validate=True)
                except (binascii.Error, ValueError):
                    raise HTTPException(status_code=400, detail="自定义图案图片数据损坏，请重新导入")
                ext = PATTERN_EXT[m.group(1)]
                PATTERNS_DIR.mkdir(parents=True, exist_ok=True)
                for other in PATTERN_MEDIA:
                    if other != ext:
                        (PATTERNS_DIR / f"{slot}{other}").unlink(missing_ok=True)
                (PATTERNS_DIR / f"{slot}{ext}").write_bytes(blob)
                entry["file"] = f"{slot}{ext}"
                entry["v"] = hashlib.sha256(blob).hexdigest()[:8]  # 版本号变了 URL 才变，否则浏览器用缓存
            elif not entry.get("file"):
                raise HTTPException(status_code=400, detail=f"{slot} 端选择了自定义图案，请先导入图片")
        saved[slot] = entry
    db.set_setting("appearance", saved)
    return {"ok": True, **{slot: _pattern_response(slot, saved[slot]) for slot in PATTERN_SLOTS}}


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


def _assess_classify_items(sess, text, image_paths, saved_names, upload_dir):
    """一遍过对话传图后：调智能分类识别加分项，映射本轮图片为证据，去重后返回新增项。

    返回 list[dict]：{category, points, basis, evidence:[文件名]}（evidence 是已落盘在会话 folder 的文件名）。
    AI 未配置 / classify 失败 / 未识别出有效项 → 返回 []，不阻塞对话。
    """
    if not saved_names or not is_configured():
        return []
    items = classify(text, image_paths)
    if not items:
        return []
    image_names = [
        n for n in saved_names
        if Path(n).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
    ]
    other_names = [n for n in saved_names if n not in image_names]
    sess_items = sess.get("items") or []
    existing = sess.get("existing") or []
    out = []
    for it in items:
        category = str(it.get("category", "")).strip()
        if category not in CATEGORY_FIELD:
            continue
        try:
            points = float(it.get("points", 0))
        except (TypeError, ValueError):
            points = 0.0
        cap = CATEGORY_CAP[category]
        points = round(max(0.0, min(points, cap)), 1)
        basis = str(it.get("basis", "")).strip()
        if not basis:
            continue
        # 证据映射：AI 给出 images 编号则按编号取本轮图片，否则全部图片；非图片一律带上
        if isinstance(it.get("images"), list):
            files = []
            for i in it["images"]:
                if isinstance(i, int) and 1 <= i <= len(image_names) and image_names[i - 1] not in files:
                    files.append(image_names[i - 1])
        else:
            files = list(image_names)
        files += [n for n in other_names if n not in files]
        if not files:
            continue  # 本轮无图可作证据则跳过（纯文字分类不在此路径）
        # 去重：栏目+分值+依据与会话内已确认项一致，或与系统已通过项冲突 → 跳过（保留先来）
        dup = any(
            i["category"] == category and i["points"] == points and i["basis"] == basis
            for i in sess_items
        ) or any(
            e["category"] == category and e["points"] == points
            for e in existing
            if e.get("approved") == "是"
        )
        if dup:
            continue
        with assess._LOCK:
            sess["items"].append({"category": category, "points": points, "basis": basis})
        out.append(
            {
                "category": category,
                "points": points,
                "basis": basis,
                "evidence": files,
                "auto": True,
            }
        )
    return out


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
    upload_dir = None
    saved_names = []
    file_list = [f for f in files if getattr(f, "filename", None)][:MAX_FILES]
    if file_list:
        # 会话证据目录：首次上传时创建并回填 session["folder"]，之后复用（不随流删除）
        folder = session.get("folder") or ""
        if not folder:
            folder = uuid.uuid4().hex
            session["folder"] = folder
        upload_dir = UPLOADS_DIR / folder
        upload_dir.mkdir(parents=True, exist_ok=True)
        try:
            for f in file_list:
                name = save_upload(f, upload_dir)
                saved_names.append(name)
                if Path(f.filename).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
                    image_paths.append(str(upload_dir / name))
        except HTTPException:
            # 保存失败：若会话 folder 为本轮新建且无任何已存文件，清理该目录
            if folder and not saved_names and not (UPLOADS_DIR / folder).iterdir():
                shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)
                session["folder"] = ""
            raise

    def _gen():
        assess.begin_turn(session_id)
        try:
            yield from assess.run_turn(session_id, text, image_paths or None)
            # 本轮有图片 → 走智能分类识图定分，识别出的加分项带证据自动汇入（SSE auto_items）
            if image_paths:
                try:
                    auto = _assess_classify_items(session, text, image_paths, saved_names, upload_dir)
                except Exception:
                    auto = []
                for it in auto:
                    yield {"type": "auto_items", "items": [it]}
        finally:
            # 轮次标记须在「流式 + 分类」全部写完后打（分类那批加分项也要计入切片），
            # 放 finally 保证流报错/客户端断开时也归零 busy 并打上标记；会话目录不在此删除
            assess.end_turn(session_id, mark=True)

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


@app.post("/api/assess/{session_id}/rewind")
async def assess_rewind(session_id: str, request: Request):
    """服务端回滚：保留前 keep_users 条学生发言（不含开场「开始」轮），丢弃其后的对话与加分项。
    返回回滚后的权威状态（剩余加分项全量/done/ended），前端据此重建列表。"""
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"assess_rewind:{ip}", 30, 600)
    try:
        body = await request.json()
    except Exception:
        body = None
    keep_users = body.get("keep_users") if isinstance(body, dict) else None
    try:
        return assess.rewind(session_id, keep_users)
    except assess.SessionMissing:
        raise HTTPException(status_code=404, detail="会话不存在或已过期，请重新开始")
    except assess.SessionBusy:
        raise HTTPException(status_code=409, detail="上一轮仍在进行中，请稍候再撤回")
    except assess.RewindInvalid:
        raise HTTPException(status_code=400, detail="无法撤回该轮（会话状态不完整），请重新开始")


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

    # 校验并规范化加分项（保留前端回传的服务端已存证据文件名）
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
        cleaned.append(
            {
                "category": category,
                "points": points,
                "basis": basis,
                "ev_server": [str(x) for x in (it.get("evidence") or []) if isinstance(x, str)],
            }
        )
    if not cleaned:
        raise HTTPException(status_code=400, detail="加分项内容无效")

    # 会话 folder（自动分类存的服务端证据所在目录）；提交后若无引用则清理
    sess_folder = sess.get("folder") or ""
    sess_dir = UPLOADS_DIR / sess_folder if sess_folder else None
    if sess_dir and not sess_dir.is_dir():
        sess_dir = None

    # 证据：每项 = 会话已存证据(白名单) + 按加分项编号新上传(file_0..file_n)
    upload_dir = None
    evidence_by_index = [[] for _ in cleaned]
    for i in range(len(cleaned)):
        evs = []
        # ① 会话中智能分类已存的服务端证据（校验确在该会话 folder 内）
        for name in cleaned[i]["ev_server"]:
            if sess_dir:
                p = (sess_dir / name).resolve()
                if p.is_relative_to(sess_dir.resolve()) and p.is_file():
                    evs.append(name)
        # ② 手动补传的证据文件（字段 file_{i}，可多文件）
        files = form.getlist(f"file_{i}")
        if files:
            if upload_dir is None:
                # 无会话目录时新建；有会话目录则直接存进会话目录，避免证据分散
                if sess_dir:
                    upload_dir = sess_dir
                else:
                    folder = uuid.uuid4().hex
                    upload_dir = UPLOADS_DIR / folder
                    upload_dir.mkdir(parents=True, exist_ok=True)
            try:
                for f in files[:MAX_FILES]:
                    evs.append(save_upload(f, upload_dir))
            except HTTPException:
                if upload_dir and upload_dir != sess_dir and not list(upload_dir.iterdir()):
                    shutil.rmtree(upload_dir, ignore_errors=True)
                raise
        evidence_by_index[i] = evs

    created = []
    now = datetime.now()
    for i, it in enumerate(cleaned):
        folder_used = (sess_folder) if (sess_dir and evidence_by_index[i]) else ""
        if not folder_used and upload_dir:
            folder_used = upload_dir.name
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
                "folder": folder_used,
                "approved": "否",
                "created_at": now,
            }
        )
    db.insert_awards(created)
    for r in created:
        r["created_at"] = r["created_at"].isoformat(timespec="seconds")
    # 清理：会话目录若无任何 award 引用（该轮证据全部未入库/被删），删除之
    if sess_dir and sess_dir.is_dir():
        used = any(r["folder"] == sess_folder for r in created)
        if not used and not db.folder_in_use(sess_folder):
            shutil.rmtree(sess_dir, ignore_errors=True)
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
    except XLSX_PARSE_ERRORS:
        # 损坏/改名的非法 xlsx：给出可读中文提示，避免 500
        drop_tmp(tmp)
        raise HTTPException(status_code=400, detail="文件无法解析，请上传成绩导出 xlsx")
    db.replace_students(students, class_id)
    db.set_class_meta(class_id, rows, filename)
    tmp.unlink(missing_ok=True)
    return {"ok": True, "students": len(students), "rows": rows, "source": filename}


@app.post("/api/secondclass/import")
def import_secondclass(
    file: UploadFile = File(...),
    class_id: str = Form(""),
    threshold: float = Form(2.0),
    authorization: str = Header(default=""),
):
    """导入第二课堂统计 xlsx：对「学分 ≥ threshold」的学生德育(deyu)+10。

    - 防重复：同班再次导入先撤销上一次导入加的 10 分，再按新文件应用。
    - 未达标 / 名单外学生不动（保留现有德育分）。
    - 每次加减写 adjust_log 留痕；meta 记上次达标学号集。
    """
    session = require_token(authorization)
    if session["role"] == "admin":
        class_id = session.get("class_id") or ""
        if not class_id:
            raise HTTPException(status_code=400, detail="你尚未分配负责班级，请联系 root")
    elif not class_id:
        raise HTTPException(status_code=400, detail="请选择班级")
    check_class_scope(session, class_id)
    if not db.get_class(class_id):
        raise HTTPException(status_code=400, detail="班级不存在，请先创建班级")
    if threshold < 0:
        raise HTTPException(status_code=400, detail="阈值不能为负")
    filename = file.filename or "secondclass.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 文件")
    # meta.k 列仅 32 字符，class_id 32 位 hex，短 key 用前缀+截断
    meta_key = f"sc2_{class_id[:27]}"

    tmp = DATA_DIR / f"{uuid.uuid4().hex}.xlsx"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    size = 0
    with tmp.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                f.close()
                tmp.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="文件超过大小限制（10MB）")
            f.write(chunk)
    try:
        wb = load_workbook(tmp, data_only=True)
        ws = wb[wb.sheetnames[0]]
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            raise HTTPException(status_code=400, detail="文件为空")
        header = [str(h).strip() if h is not None else "" for h in rows[0]]
        sid_col = next((i for i, h in enumerate(header) if h == "学号"), None)
        cred_col = next((i for i, h in enumerate(header) if h == "学分"), None)
        if sid_col is None or cred_col is None:
            raise HTTPException(
                status_code=400,
                detail=f"表头缺少「学号」或「学分」列（实际表头：{'、'.join(header[:8])}…）",
            )
        # 解析文件：sid -> 学分（单元格可能是文本，容错转换）
        file_credits = {}
        for r in rows[1:]:
            if not r or sid_col >= len(r) or cred_col >= len(r):
                continue
            sid = str(r[sid_col]).strip() if r[sid_col] is not None else ""
            if not sid:
                continue
            try:
                val = float(str(r[cred_col]).strip())
            except (TypeError, ValueError):
                continue
            file_credits[sid] = val
        if not file_credits:
            raise HTTPException(status_code=400, detail="未能从文件中解析出学号与学分数据")
    except XLSX_PARSE_ERRORS:
        # 损坏/改名的非法 xlsx：给出可读中文提示，避免 500
        raise HTTPException(status_code=400, detail="文件无法解析，请上传第二课堂统计 xlsx")
    finally:
        drop_tmp(tmp)

    pool = {s["sid"]: s for s in db.list_students(class_id)}
    now = datetime.now().isoformat(timespec="seconds")

    # 1) 防重复：撤销上一次导入（meta 记录的达标学号集）
    ops = []  # {sid,name,op,points,old,new,total}
    last_raw = db.get_meta(meta_key, "")
    last = {}
    if last_raw:
        try:
            last = json.loads(last_raw)
        except (json.JSONDecodeError, TypeError):
            last = {}
    for sid in last.get("sids", []) or []:
        stu = pool.get(sid)
        if not stu:
            continue
        old = round(float(stu["deyu"]), 2)
        new = round(max(old - 10.0, 0.0), 2)
        if new == old:
            continue
        stu["deyu"] = new
        total = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
        ops.append(
            {
                "sid": sid, "name": stu["name"], "op": "sub", "points": 10.0,
                "old": old, "new": new, "total": total,
            }
        )

    # 2) 应用新文件：学分 >= threshold 且在本班榜单的学生 +10（封顶 100）
    applied = []
    skipped = []
    qualified = []
    for sid, credit in file_credits.items():
        stu = pool.get(sid)
        if not stu:
            skipped.append({"sid": sid, "reason": "学号不在本班榜单"})
            continue
        if credit < threshold:
            continue  # 未达标不动
        qualified.append(sid)
        old = round(float(stu["deyu"]), 2)
        new = round(min(old + 10.0, 100.0), 2)
        if new != old:
            stu["deyu"] = new
            total = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
            ops.append(
                {
                    "sid": sid, "name": stu["name"], "op": "add", "points": 10.0,
                    "old": old, "new": new, "total": total,
                }
            )
        applied.append({"sid": sid, "name": stu["name"], "credit": credit, "old": old, "new": new})

    # 3) 单事务写库 + 留痕 + 更新 meta
    meta_value = json.dumps({"threshold": round(float(threshold), 2), "sids": qualified, "time": now}, ensure_ascii=False)
    if ops:
        for o in ops:
            o["created_at"] = now
        db.apply_secondclass(class_id, ops, meta_key, meta_value)
    else:
        db.set_meta(meta_key, meta_value)  # 无变化也更新阈值/名单，保证下次撤销依据最新

    return {
        "ok": True,
        "threshold": round(float(threshold), 2),
        "qualified": len(qualified),
        "applied": len(applied),
        "changes": len(ops),
        "skipped": skipped,
    }


@app.get("/api/leaderboard")
def leaderboard(class_id: str | None = None):
    # 榜单必须指明班级：不带 class_id 会把多个班的学生按总分混排、统一编号名次，故直接拒绝
    cid = (class_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少 class_id：榜单按班级展示，请指定班级")
    students = db.list_students(cid)
    cls = db.get_class(cid)
    meta = {
        "rows": cls["row_count"] if cls else 0,
        "source": cls["source"] if cls else "",
        # 回传班级标识，便于前端/排查时自证当前展示的是哪个班（class_id 不存在时为空）
        "class_id": cid,
        "class_name": cls["name"] if cls else "",
    }
    # 挂科（无参评资格）学生沉底且不占名次：rank 置 0，综合测评成绩列显示 -1
    ranked = [s for s in students if not s.get("failed")]
    disq = [s for s in students if s.get("failed")]
    for rank, s in enumerate(ranked, start=1):
        s["rank"] = rank
    for s in disq:
        s["rank"] = 0
        s["total"] = -1
    return {"students": ranked + disq, "meta": meta}


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
    # 榜单按班级导出：不带 class_id 会导出跨班混排的合并榜单（且文件名班级名为空），故直接拒绝
    cid = (class_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少 class_id：请先选择要导出的班级")
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    headers = ["学号", "姓名", "德*15%", "智*60%", "体*10%", "美*5%", "劳*10%", "附加", "总分"]

    # 文件名对齐附件「25-26下学期xx班综合测评总分.xlsx」：xx 处放实际班级名
    cls = db.get_class(cid)
    cls_name = cls["name"] if cls else ""
    file_name = f"25-26下学期{cls_name}班综合测评总分.xlsx"

    # 样式严格对齐附件「25-26下学期xx班综合测评总分.xlsx」：
    # 等线 11 号（学号列仿宋）、全表细边框、学号列白色实底+文本格式、表头居中
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    font_body = Font(name="等线", size=11)
    font_sid = Font(name="仿宋", size=11)
    red_font = Font(name="等线", size=11, color="FFFF0000")
    red_sid_font = Font(name="仿宋", size=11, color="FFFF0000")
    center = Alignment(horizontal="center", vertical="center")
    header_font = Font(name="等线", size=11)

    ws.append(headers)
    for col in "ABCDEFGHI":
        cell = ws[f"{col}1"]
        cell.font = header_font
        cell.alignment = center
        cell.border = border
    # 学号列表头也用仿宋（附件 A1 是仿宋）
    ws["A1"].font = Font(name="仿宋", size=11)
    ws["A1"].fill = PatternFill(fill_type="solid", start_color="FFFFFFFF", end_color="FFFFFFFF")
    ws["A1"].number_format = "@"
    ws["B1"].number_format = "@"

    for stu in db.list_students(cid):
        total = -1 if stu.get("failed") else stu["total"]
        row = [
            str(stu["sid"]),
            stu["name"],
            stu["deyu"],
            stu["score"],
            stu["tiyu"],
            stu["meiyu"],
            stu["laoyu"],
            stu["fujia"],
            total,
        ]
        ws.append(row)
        r = ws.max_row
        for i, col in enumerate("ABCDEFGHI", start=1):
            cell = ws.cell(row=r, column=i)
            cell.border = border
            # 挂科（无参评资格）行整行标红
            cell.font = red_sid_font if (col == "A" and stu.get("failed")) else (red_font if stu.get("failed") else (font_sid if col == "A" else font_body))
            if col in ("A", "B"):
                # 学号/姓名：文本格式（附件 A、B 列均为 @），学号列附白色实底
                cell.number_format = "@"
                cell.alignment = Alignment(horizontal="center", vertical="center")
                if col == "A":
                    cell.fill = PatternFill(fill_type="solid", start_color="FFFFFFFF", end_color="FFFFFFFF")
            elif i == 2:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(vertical="center")

    # 表头行高 + 列宽（附件值）
    ws.row_dimensions[1].height = 24.85
    for col, width in zip("ABC", (8.71, 8.71, 8.71)):
        ws.column_dimensions[col].width = width
    for col in "DEFGHI":
        ws.column_dimensions[col].width = 13
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(file_name)},
    )


# zip 内禁止出现的目录名字符（Windows/常规 zip 工具不友好的字符一律替换）
_ZIP_NAME_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _evidence_readable(stored_name):
    """去掉 save_upload 加的 32 位 hex 前缀，还原成可读文件名。"""
    m = re.fullmatch(r"[0-9a-f]{32}_(.+)", stored_name)
    return m.group(1) if m else stored_name


def _yaml_dumps(obj, indent=0):
    """轻量 YAML 序列化（零依赖），支持 dict/list/str/int/float/bool/None。"""
    pad = "  " * indent
    if obj is None:
        return f"{pad}null"
    if isinstance(obj, bool):
        return f"{pad}{'true' if obj else 'false'}"
    if isinstance(obj, (int, float)):
        return f"{pad}{obj}"
    if isinstance(obj, str):
        # 需要加引号的情况
        if obj == "" or obj in ("true", "false", "null", "yes", "no") or re.search(r'[:#{}\[\],&*?|>!%@`]', obj) or obj.startswith((" ", "\t", "\n", "-", "?")):
            return f'{pad}"{obj.replace(chr(92), chr(92)+chr(92)).replace(chr(34), chr(92)+chr(34))}"'
        return f"{pad}{obj}"
    if isinstance(obj, list):
        if not obj:
            return f"{pad}[]"
        lines = []
        for item in obj:
            if isinstance(item, dict):
                # dict 作为列表项：第一行 key: value，后续缩进
                first = True
                for k, v in item.items():
                    if first:
                        lines.append(f"{pad}- {k}: {_yaml_value(v, indent + 2)}")
                        first = False
                    else:
                        lines.append(f"{pad}  {k}: {_yaml_value(v, indent + 2)}")
            else:
                lines.append(f"{pad}- {_yaml_value(item, indent + 1)}")
        return "\n".join(lines)
    if isinstance(obj, dict):
        if not obj:
            return f"{pad}{{}}"
        lines = []
        for k, v in obj.items():
            lines.append(f"{pad}{k}: {_yaml_value(v, indent + 1)}")
        return "\n".join(lines)
    return f"{pad}{obj}"


def _yaml_value(v, indent):
    """内联简单值，嵌套结构换行缩进。"""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        if v == "" or v in ("true", "false", "null") or re.search(r'[:#{}\[\],&*?|>!%@`]', v) or v.startswith((" ", "-", "?")):
            return f'"{v.replace(chr(92), chr(92)+chr(92)).replace(chr(34), chr(92)+chr(34))}"'
        return v
    # 嵌套结构：换行 + 缩进
    return "\n" + _yaml_dumps(v, indent)


def build_evidence_zip(class_id=None):
    """把「已通过(approved=是)」申报按人打包：每人一个「学号_姓名/」目录，
    内含 申报明细.yaml 与 evidence/ 证据文件，外加总 index.yaml。返回 BytesIO。

    被多人引用的同一证据文件放入顶层「公共证据/」目录，个人以 ref 引用。
    """
    records = [r for r in db.list_awards(class_id or None) if r.get("approved") == "是"]
    if not records:
        raise HTTPException(status_code=400, detail="当前范围暂无已通过的申报，无需导出")

    # 按学号聚合（同班同人多次申报合并；姓名用记录快照，空则回退学号）
    people = {}
    for r in records:
        people.setdefault(r["sid"], {"name": r.get("name") or r["sid"], "records": []})["records"].append(r)

    uploads_root = UPLOADS_DIR.resolve()

    # ── 第一遍：收集所有证据，按 canonical path 聚合，判断是否被多人引用 ──
    # canonical_path → {"readable": str, "ref_sids": set}
    shared_map = {}
    for sid, p in people.items():
        for r in p["records"]:
            base = (UPLOADS_DIR / (r.get("folder") or "")).resolve()
            for f in r.get("evidence") or []:
                if not r.get("folder"):
                    continue
                path = (base / f).resolve()
                if not path.is_relative_to(uploads_root) or not path.exists():
                    continue
                if path not in shared_map:
                    shared_map[path] = {"readable": _evidence_readable(f), "ref_sids": set()}
                shared_map[path]["ref_sids"].add(sid)

    # 被 ≥2 人引用 → 公共证据
    public_files = {k: v for k, v in shared_map.items() if len(v["ref_sids"]) >= 2}

    # 公共证据文件名去重（同一可读名只出现一次）
    public_zip_names = {}  # canonical_path → zip 内文件名
    used_public = set()
    for path, info in public_files.items():
        name = info["readable"]
        stem, dot = Path(name).stem, Path(name).suffix
        archive = name
        n = 2
        while archive in used_public:
            archive = f"{stem}_{n}{dot}"
            n += 1
        used_public.add(archive)
        public_zip_names[path] = archive

    # ── 第二遍：写 zip ──
    buf = io.BytesIO()
    summary = {"students": [], "total_records": len(records), "total_files": 0}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 写公共证据目录
        for path, archive in public_zip_names.items():
            zf.write(path, f"公共证据/{archive}")

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
                    if not path.is_relative_to(uploads_root) or not path.exists():
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

                    if path in public_zip_names:
                        # 公共证据：不在个人目录放副本，只在申报明细.json 中标注引用
                        rec_json["evidence"].append({"source": f, "ref": f"公共证据/{public_zip_names[path]}", "missing": False})
                    else:
                        # 非公共证据：写入个人 evidence/ 目录
                        zf.write(path, f"{folder_name}/evidence/{archive}")
                        rec_json["evidence"].append({"file": f"evidence/{archive}", "source": f, "missing": False})
                        person_files += 1
                person_json["records"].append(rec_json)
            zf.writestr(f"{folder_name}/申报明细.yaml", _yaml_dumps(person_json))
            summary["students"].append({"sid": sid, "name": p["name"], "records": len(person_json["records"]), "files": person_files, "folder": folder_name})
            summary["total_files"] += person_files
        zf.writestr("index.yaml", _yaml_dumps(summary))
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
    # 软连接可能指向 _content_hashes/，只要最终路径仍在 UPLOADS_DIR 内即合法
    uploads_root = UPLOADS_DIR.resolve()
    if not path.is_relative_to(uploads_root) or not path.exists():
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
elif DEFAULT_XLSX.exists():
    # 已存在学生数据：仅按源文件重算参评资格 failed 标记（不动分数/调分/附加分）
    try:
        students, _ = parse_xlsx(DEFAULT_XLSX)
        db.update_failed_flags(FIRST_CLASS, {s["sid"]: s["failed"] for s in students})
    except HTTPException:
        pass

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