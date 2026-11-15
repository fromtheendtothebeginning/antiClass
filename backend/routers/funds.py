# routers/funds.py — 班费公示：所有人按班查看收支记录，登录的管理员直接发布增加/减少（无需审批）。
# 结余 = 增加合计 - 减少合计，允许为负（班费可以透支）。

import math
import uuid

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import db
from common import check_class_scope, require_token

router = APIRouter()

KINDS = ("in", "out")  # in=增加（收）, out=减少（支）
MAX_AMOUNT = 10_000_000
MAX_TITLE = 200


class FundBody(BaseModel):
    class_id: str
    kind: str
    amount: float
    title: str


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
def add_fund(body: FundBody, authorization: str = Header(default="")):
    """管理员发布一条班费记录（增加/减少），直接生效，不经审批。"""
    session = require_token(authorization)
    cid = body.class_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="请选择班级")
    if not db.get_class(cid):
        raise HTTPException(status_code=404, detail="班级不存在")
    check_class_scope(session, cid)
    if body.kind not in KINDS:
        raise HTTPException(status_code=400, detail="类型无效，只能是增加或减少")
    try:
        amount = round(float(body.amount), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="金额格式不正确")
    if not math.isfinite(amount) or amount <= 0:
        raise HTTPException(status_code=400, detail="金额必须大于 0（增加/减少由类型决定）")
    if amount > MAX_AMOUNT:
        raise HTTPException(status_code=400, detail=f"单笔金额不能超过 {MAX_AMOUNT:,.0f} 元")
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写事由")
    if len(title) > MAX_TITLE:
        raise HTTPException(status_code=400, detail=f"事由过长（最多 {MAX_TITLE} 字）")
    fid = uuid.uuid4().hex
    db.insert_fund(fid, cid, body.kind, amount, title, session["username"])
    return {"ok": True, "item": db.get_fund(fid)}


@router.post("/api/funds/{fid}/delete")
def delete_fund(fid: str, authorization: str = Header(default="")):
    """管理员删除一条发布错误的记录（按班级权限校验）。"""
    session = require_token(authorization)
    item = db.get_fund(fid)
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    check_class_scope(session, item["class_id"])
    db.delete_fund(fid)
    return {"ok": True}
