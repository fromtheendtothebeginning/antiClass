# routers/funds.py — 班费公示：所有人按班查看收支记录，登录的管理员直接发布增加/减少（无需审批）。
# 结余 = 增加合计 - 减少合计，允许为负（班费可以透支）。每条记录可带票据图片，公开可看。

import math
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

import db
from common import EVIDENCE_MEDIA, UPLOADS_DIR, check_class_scope, require_token, save_upload

router = APIRouter()

KINDS = ("in", "out")  # in=增加（收）, out=减少（支）
MAX_AMOUNT = 10_000_000
MAX_TITLE = 200
MAX_IMAGES = 5
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _fund_dir(fid):
    return UPLOADS_DIR / "funds" / fid


def _summary(items):
    income = sum(float(i["amount"]) for i in items if i["kind"] == "in")
    expense = sum(float(i["amount"]) for i in items if i["kind"] == "out")
    return {"income": round(income, 2), "expense": round(expense, 2), "balance": round(income - expense, 2)}


@router.get("/api/funds")
def list_funds(class_id: str = ""):
    """班费记录全站公开（访客也能看）；按班级展示，必须显式指定 class_id。"""
    cid = (class_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少 class_id：班费按班级展示，请指定班级")
    items = db.list_funds(cid)
    cls = db.get_class(cid)
    return {
        "items": items,
        "summary": _summary(items),
        "meta": {"class_id": cid, "class_name": cls["name"] if cls else ""},
    }


@router.post("/api/funds")
def add_fund(
    class_id: str = Form(...),
    kind: str = Form(...),
    amount: float = Form(...),
    title: str = Form(...),
    files: list[UploadFile] | None = File(default=None),
    authorization: str = Header(default=""),
):
    """管理员发布一条班费记录（增加/减少），可附票据图片；直接生效，不经审批。"""
    session = require_token(authorization)
    cid = class_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="请选择班级")
    if not db.get_class(cid):
        raise HTTPException(status_code=404, detail="班级不存在")
    check_class_scope(session, cid)
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="类型无效，只能是增加或减少")
    try:
        amount = round(float(amount), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="金额格式不正确")
    if not math.isfinite(amount) or amount <= 0:
        raise HTTPException(status_code=400, detail="金额必须大于 0（增加/减少由类型决定）")
    if amount > MAX_AMOUNT:
        raise HTTPException(status_code=400, detail=f"单笔金额不能超过 {MAX_AMOUNT:,.0f} 元")
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写事由")
    if len(title) > MAX_TITLE:
        raise HTTPException(status_code=400, detail=f"事由过长（最多 {MAX_TITLE} 字）")
    file_list = [f for f in (files or []) if f.filename]
    if len(file_list) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"最多上传 {MAX_IMAGES} 张图片")
    for f in file_list:
        if Path(f.filename).suffix.lower() not in IMAGE_EXTS:
            raise HTTPException(status_code=400, detail=f"{f.filename} 不是图片（仅支持 JPG/PNG/WebP/GIF/BMP）")

    fid = uuid.uuid4().hex
    upload_dir = _fund_dir(fid)
    saved = []
    try:
        if file_list:
            upload_dir.mkdir(parents=True, exist_ok=True)
            for f in file_list:
                saved.append(save_upload(f, upload_dir))
        db.insert_fund(fid, cid, kind, amount, title, saved, session["username"])
    except Exception:
        # 上传或入库失败都不留半截图片目录
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    return {"ok": True, "item": db.get_fund(fid)}


@router.get("/api/funds/{fid}/image/{filename}")
def fund_image(fid: str, filename: str):
    """班费票据图片公开可看（与班费记录同级的公示内容）。"""
    item = db.get_fund(fid)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    if filename not in (item.get("evidence") or []):
        raise HTTPException(status_code=404, detail="图片不存在")
    media_type = EVIDENCE_MEDIA.get(Path(filename).suffix.lower())
    if not media_type:
        raise HTTPException(status_code=404, detail="图片不存在")
    base = _fund_dir(fid).resolve()
    path = (base / filename).resolve()
    if not path.is_relative_to(UPLOADS_DIR.resolve()) or not path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/api/funds/{fid}/delete")
def delete_fund(fid: str, authorization: str = Header(default="")):
    """管理员删除一条发布错误的记录（按班级权限校验），一并删除其票据图片。"""
    session = require_token(authorization)
    item = db.get_fund(fid)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    check_class_scope(session, item["class_id"])
    db.delete_fund(fid)
    shutil.rmtree(_fund_dir(fid), ignore_errors=True)
    return {"ok": True}
