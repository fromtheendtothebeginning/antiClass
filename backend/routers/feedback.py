# routers/feedback.py — 体验反馈工单：所有人可见可提交，管理员勾选「已解决」并可附处理说明。
# 工单全站公开（访客也能看/提），提交按 IP 限流；勾选与回复仅登录的管理员可操作。

import uuid

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

import db
from common import rate_limit, require_token

router = APIRouter()

CATEGORIES = ("问题", "建议", "其他")
MAX_CONTENT = 1000
MAX_CONTACT = 64
MAX_REPLY = 500


class FeedbackBody(BaseModel):
    category: str
    content: str
    contact: str = ""  # 选填：称呼/QQ/手机，方便管理员联系反馈人


class FeedbackUpdateBody(BaseModel):
    resolved: bool | None = None  # 传了才更新
    reply: str | None = None  # 传了才更新；空串 = 清除回复


@router.get("/api/feedback")
def list_feedback():
    """反馈工单全站公开可见（访客也要看），故无需 token。"""
    return {"feedback": db.list_feedback()}


@router.post("/api/feedback")
def submit_feedback(request: Request, body: FeedbackBody):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"fb:{ip}", 10, 3600)
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="分类无效，可选：" + "、".join(CATEGORIES))
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="请填写反馈内容")
    if len(content) > MAX_CONTENT:
        raise HTTPException(status_code=400, detail=f"反馈内容过长（最多 {MAX_CONTENT} 字）")
    contact = body.contact.strip()
    if len(contact) > MAX_CONTACT:
        raise HTTPException(status_code=400, detail=f"联系方式过长（最多 {MAX_CONTACT} 字）")
    fid = uuid.uuid4().hex
    db.insert_feedback(fid, body.category, content, contact)
    return {"ok": True}


@router.post("/api/feedback/{fid}/update")
def update_feedback(fid: str, body: FeedbackUpdateBody, authorization: str = Header(default="")):
    """登录的管理员（root/admin 均可）勾选解决状态与回复；resolved/reply 传了才改，互不覆盖。"""
    require_token(authorization)
    if not db.get_feedback(fid):
        raise HTTPException(status_code=404, detail="反馈不存在")
    fields = {}
    if body.resolved is not None:
        fields["resolved"] = 1 if body.resolved else 0
    if body.reply is not None:
        reply = body.reply.strip()
        if len(reply) > MAX_REPLY:
            raise HTTPException(status_code=400, detail=f"回复过长（最多 {MAX_REPLY} 字）")
        fields["reply"] = reply
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的内容")
    db.update_feedback(fid, fields)
    return {"ok": True, "item": db.get_feedback(fid)}
