# routers/awards.py — 加分申报域：AI 分析草稿（analyze/submit）、传统/班委/批量申报、
# 申报审批（通过/驳回/编辑重提/撤回/删除）、申报列表与证据下载

import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import db
import drafts
from ai import classify, is_configured, moderate_content
from common import (
    CATEGORY_CAP,
    CATEGORY_FIELD,
    CLASS_ROLE_POINTS,
    EVIDENCE_MEDIA,
    MAX_FILES,
    MAX_TEXT_LEN,
    UPLOADS_DIR,
    check_class_scope,
    find_student,
    rate_limit,
    require_token,
    save_upload,
)
from scoring import calc_total

router = APIRouter()


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


@router.post("/api/awards/analyze")
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
    drafts.create(
        {
            "id": draft_id,
            "sid": stu["sid"],
            "name": stu["name"],
            "class_id": stu.get("class_id", ""),
            "folder": folder,
            "items": draft_items,
            "evidence": sorted({f for it in draft_items for f in it["evidence"]}),
            "created_at": datetime.now(),
        }
    )
    return {"draft_id": draft_id, "sid": stu["sid"], "name": stu["name"], "items": draft_items}


@router.post("/api/awards/drafts/{draft_id}/delete")
def delete_award_draft(draft_id: str, request: Request):
    """删除未提交的 AI 分析草稿（公开）：仅限未提交的草稿，连带清理其临时证据文件。"""
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"draft_delete:{ip}", 30, 600)
    draft = drafts.pop(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="草稿不存在或已提交")
    folder = draft.get("folder", "")
    if folder and not db.folder_in_use(folder):
        shutil.rmtree(UPLOADS_DIR / folder, ignore_errors=True)
    return {"ok": True}


@router.post("/api/awards/submit")
def submit_awards(request: Request, body: SubmitBody):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"submit:{ip}", 30, 600)
    created = []
    popped = []
    for sub in body.submissions[:20]:
        draft = drafts.get(sub.draft_id)
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
        popped.append(sub.draft_id)
    db.insert_awards(created)
    for draft_id in popped:
        drafts.pop(draft_id)
    return {"created": created}


@router.get("/api/awards")
def list_awards(class_id: str | None = None):
    return {"awards": db.list_awards(class_id or None)}


@router.get("/api/awards/{aid}/evidence/{filename}")
def award_evidence(aid: str, filename: str):
    record = db.get_award(aid)
    if not record:
        record = drafts.get(aid)
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


@router.post("/api/awards/manual")
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


@router.post("/api/awards/class-committee")
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


@router.post("/api/awards/batch")
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
    field = CATEGORY_FIELD[category]
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
            "approved": "是",
            "created_at": now,
        }
        created.append(record)
        # 管理员批量申报自动通过：立即加分并重算总分，撤回/删除即撤销
        stu[field] = round(min(float(stu[field]) + points, cap), 2)
        stu["total"] = calc_total(stu["deyu"], stu["score"], stu["tiyu"], stu["meiyu"], stu["laoyu"], stu["fujia"])
        db.update_student_score(stu["sid"], stu["class_id"], field, stu[field], stu["total"])
    db.insert_awards(created)
    for r in created:
        r["created_at"] = r["created_at"].isoformat(timespec="seconds")
    return {"created": created}


@router.post("/api/awards/{aid}/approve")
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


@router.post("/api/awards/{aid}/reject")
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


@router.post("/api/awards/{aid}/edit")
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


@router.post("/api/awards/{aid}/withdraw")
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


@router.post("/api/awards/{aid}/delete")
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
