# main.py — 应用组装入口：创建 FastAPI、挂载各域路由、启动迁移/播种、静态托管前端。
# 路由按业务域拆在 routers/（auth/appearance/assess/manage/board/awards/ai_admin/feedback），
# 横切依赖在 common.py，算分在 scoring.py，证据归档在 evidence_zip.py，草稿存储在 drafts.py。

import json
import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import drafts
from routers import ai_admin, appearance, assess, auth, awards, board, feedback, funds, manage, mcp
from scoring import parse_xlsx

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DIST_DIR = BASE_DIR.parent / "frontend" / "dist"
DEFAULT_XLSX = BASE_DIR.parent / "Y3第二学期成绩导出.xlsx"
LEGACY_AI_CONFIG = BASE_DIR / "ai_config.json"
LEGACY_AI_PROMPTS = BASE_DIR / "ai_prompts.json"

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ROOT_PASSWORD = os.environ.get("ROOT_PASSWORD", "root123")

app = FastAPI(title="anticlass")


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


app.include_router(auth.router)
app.include_router(appearance.router)
app.include_router(assess.router)
app.include_router(manage.router)
app.include_router(board.router)
app.include_router(awards.router)
app.include_router(ai_admin.router)
app.include_router(feedback.router)
app.include_router(funds.router)
app.include_router(mcp.router)


def _read_json_legacy(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


DEFAULT_SEMESTER_ID, SEMESTER_CREATED = db.init_db()

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

# 老库第二课堂 meta 键补上默认学期（否则升级后首次重导会把 10 分再加一遍）
if SEMESTER_CREATED:
    db.migrate_secondclass_meta(DEFAULT_SEMESTER_ID)
    # 老库的榜单数据就来自根目录这份 xlsx，记下它对应的学期供后续 failed 重算
    if db.list_students(semester_id=DEFAULT_SEMESTER_ID) and not db.get_meta("seed_semester"):
        db.set_meta("seed_semester", DEFAULT_SEMESTER_ID)

# 一次性迁移：旧 JSON 数据与 AI 配置/提示词 → MySQL，迁完即删
if not db.list_students(semester_id=DEFAULT_SEMESTER_ID):
    state = _read_json_legacy(DATA_DIR / "state.json")
    if state and state.get("students"):
        db.replace_students(state["students"], FIRST_CLASS, DEFAULT_SEMESTER_ID)
        db.set_class_meta(FIRST_CLASS, state.get("rows", 0), state.get("source", ""), DEFAULT_SEMESTER_ID)
if not db.list_awards():
    awards = _read_json_legacy(DATA_DIR / "awards.json")
    if awards:
        for a in awards:
            a.setdefault("semester_id", DEFAULT_SEMESTER_ID)
            a.setdefault("class_id", FIRST_CLASS)
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

if SEMESTER_CREATED and not db.list_students(semester_id=DEFAULT_SEMESTER_ID) and DEFAULT_XLSX.exists():
    # 仅首次引入学期（升级/全新库）时播种；之后清空榜单不会被重启自动复活
    students, rows = parse_xlsx(DEFAULT_XLSX)
    db.replace_students(students, FIRST_CLASS, DEFAULT_SEMESTER_ID)
    db.set_class_meta(FIRST_CLASS, rows, DEFAULT_XLSX.name, DEFAULT_SEMESTER_ID)
    db.set_meta("seed_semester", DEFAULT_SEMESTER_ID)  # 该 xlsx 对应的学期，供 failed 重算使用
elif DEFAULT_XLSX.exists():
    # 已存在学生数据：仅按源文件重算参评资格 failed 标记（不动分数/调分/附加分）。
    # 只重算这份 xlsx 对应的学期，避免把大一下的挂科结果写到其它学期。
    seed_sid = db.get_meta("seed_semester")
    if seed_sid and db.get_semester(seed_sid):
        try:
            students, _ = parse_xlsx(DEFAULT_XLSX)
            db.update_failed_flags(FIRST_CLASS, seed_sid, {s["sid"]: s["failed"] for s in students})
        except HTTPException:
            pass

# 清理上次运行遗留的过期 AI 分析草稿（草稿已持久化到 MySQL，重启不再丢失）
drafts.purge_expired()

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
