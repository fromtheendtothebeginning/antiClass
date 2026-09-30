# routers/assess.py — 加分一遍过（AI 逐项问答，SSE 流式输出）

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import assess
import db
from ai import classify, is_configured
from common import (
    CATEGORY_CAP,
    CATEGORY_FIELD,
    MAX_FILES,
    MAX_TEXT_LEN,
    UPLOADS_DIR,
    rate_limit,
    save_upload,
)

router = APIRouter()


class AssessMsgBody(BaseModel):
    text: str


def _sse(events):
    for e in events:
        yield "data: " + json.dumps(e, ensure_ascii=False) + "\n\n"


@router.post("/api/assess/start")
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


@router.post("/api/assess/{session_id}/message")
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


@router.post("/api/assess/{session_id}/finish")
def assess_finish(session_id: str):
    session = assess.finish(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")
    return {"ok": True, "done": True, "ended": True, "items": session["items"]}


@router.post("/api/assess/{session_id}/rewind")
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


@router.post("/api/assess/{session_id}/submit")
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
