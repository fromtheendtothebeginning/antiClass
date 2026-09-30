# routers/auth.py — 登录/登出/会话验活/个人资料（昵称、头像）

import re
import secrets
import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

import db
from common import TOKENS, rate_limit, require_token

router = APIRouter()


class LoginBody(BaseModel):
    username: str
    password: str


AVATAR_PREFIX = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$")
MAX_AVATAR_CHARS = 300_000  # ≈225 KB 原始图片，前端已压到 192px


class ProfileBody(BaseModel):
    nickname: str = ""
    avatar: str | None = None  # None=不变，""=清除，data URL=替换


@router.post("/api/login")
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


@router.post("/api/logout")
def logout(authorization: str = Header(default="")):
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    TOKENS.pop(token, None)
    return {"ok": True}


@router.get("/api/me")
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


@router.post("/api/profile")
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
