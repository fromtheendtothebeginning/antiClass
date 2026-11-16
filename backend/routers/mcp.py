# routers/mcp.py — 申报 MCP：对外 Streamable HTTP 端点 + 专属 token 管理
# 只暴露一个工具 submit_application；外部鉴权只用各班管理员生成的专属 MCP token。

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import db
import mcp_apply
from common import rate_limit, require_token

router = APIRouter()


def _unauthorized():
    return JSONResponse(
        {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "未授权：需要专属 MCP token"}},
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _auth(request: Request):
    header = request.headers.get("authorization") or ""
    if not header.startswith("Bearer "):
        return None
    return db.verify_mcp_token(header[7:].strip())


@router.post("/mcp")
async def mcp_endpoint(request: Request):
    session = _auth(request)
    if not session:
        return _unauthorized()
    ip = request.client.host if request.client else "unknown"
    rate_limit(f"mcp:{ip}", 120, 60)
    rate_limit(f"mcp_token:{session['token_id']}", 60, 60)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
            status_code=400,
        )

    # 支持 JSON-RPC 批量；通知（无 id）不返回响应体
    if isinstance(body, list):
        responses = [mcp_apply.handle_rpc(m, session) for m in body]
        responses = [r for r in responses if r is not None]
        if not responses:
            return Response(status_code=202)
        return JSONResponse(responses, headers={"MCP-Protocol-Version": "2025-03-26"})

    response = mcp_apply.handle_rpc(body, session)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response, headers={"MCP-Protocol-Version": "2025-03-26"})


@router.get("/mcp")
def mcp_get():
    # 无服务端主动推送需求：按协议返回 405，客户端会继续用 POST
    return Response(status_code=405, headers={"Allow": "POST"})


# ---------- 专属 MCP token 管理（班级管理员生成/发放；root 可看全部） ----------

class McpTokenBody(BaseModel):
    label: str = ""
    class_id: str = ""


@router.get("/api/mcp/tokens")
def list_mcp_tokens(authorization: str = Header(default="")):
    session = require_token(authorization)
    if session["role"] == "root":
        return {"tokens": db.list_mcp_tokens(None)}
    class_id = session.get("class_id") or ""
    if not class_id:
        raise HTTPException(status_code=400, detail="你尚未分配负责班级，请联系 root")
    return {"tokens": db.list_mcp_tokens(class_id)}


@router.post("/api/mcp/tokens")
def create_mcp_token(body: McpTokenBody, authorization: str = Header(default="")):
    session = require_token(authorization)
    if session["role"] == "admin":
        class_id = session.get("class_id") or ""
        if not class_id:
            raise HTTPException(status_code=400, detail="你尚未分配负责班级，请联系 root")
    else:
        class_id = (body.class_id or "").strip()
        if not class_id:
            raise HTTPException(status_code=400, detail="请选择 token 绑定的班级")
    cls = db.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=400, detail="班级不存在")
    label = (body.label or "").strip()[:64]
    token, item = db.create_mcp_token(class_id, label, session["username"])
    item["class_name"] = cls["name"]
    # 明文 token 只在这里返回一次，之后只能看到前缀；丢失请撤销后重新生成
    return {"ok": True, "token": token, "item": item}


@router.post("/api/mcp/tokens/{tid}/revoke")
def revoke_mcp_token(tid: str, authorization: str = Header(default="")):
    session = require_token(authorization)
    row = db.get_mcp_token(tid)
    if not row:
        raise HTTPException(status_code=404, detail="token 不存在")
    if session["role"] != "root" and row["class_id"] != session.get("class_id"):
        raise HTTPException(status_code=403, detail="只能撤销本班的 token")
    if not db.revoke_mcp_token(tid, None if session["role"] == "root" else session.get("class_id")):
        raise HTTPException(status_code=400, detail="该 token 已撤销")
    return {"ok": True}
