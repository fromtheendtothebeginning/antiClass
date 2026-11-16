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


class RegisterBody(BaseModel):
    code: str
    username: str
    password: str


USERNAME_RE = re.compile(r"[A-Za-z0-9_]{3,32}")


def _issue_session(admin):
    """创建登录会话（登录与邀请码注册共用）。"""
    token = secrets.token_hex(16)
    TOKENS[token] = {
        "username": admin["username"],
        "role": admin["role"],
        "class_id": admin.get("class_id"),
        "exp": time.time(),
    }
    return token


@router.post("/api/login")
def login(body: LoginBody, request: Request):
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"login:{ip}", 5, 60)
    admin = db.verify_admin(body.username.strip(), body.password)
    if not admin:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    token = _issue_session(admin)
    return {
        "token": token,
        "username": admin["username"],
        "role": admin["role"],
        "class_id": admin.get("class_id"),
        "nickname": admin.get("nickname", ""),
    }


@router.post("/api/register")
def register(body: RegisterBody, request: Request):
    """凭一次性邀请码注册管理员账号：班级由邀请码决定，注册成功直接返回登录会话。"""
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"register:{ip}", 10, 3600)
    code = body.code.strip().upper()
    username = body.username.strip()
    if not code:
        raise HTTPException(status_code=400, detail="请输入邀请码")
    if not USERNAME_RE.fullmatch(username) or username == "root":
        raise HTTPException(status_code=400, detail="用户名限 3-32 位字母/数字/下划线，且不能与已有账号重复")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    admin, err = db.register_with_invite(code, username, body.password)
    if err == "invalid":
        raise HTTPException(status_code=400, detail="邀请码无效、已被使用或已撤销，请联系管理员")
    if err == "exists":
        raise HTTPException(status_code=400, detail="用户名已存在，请换一个")
    if err == "no_class":
        raise HTTPException(status_code=400, detail="邀请码对应的班级已被删除，请联系管理员")
    token = _issue_session(admin)
    return {
        "token": token,
        "username": admin["username"],
        "role": admin["role"],
        "class_id": admin["class_id"],
        "nickname": "",
        "class_name": admin["class_name"],
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
