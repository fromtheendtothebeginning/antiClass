# mcp_apply.py — 「申报 MCP」工具：MCP JSON-RPC 处理 + 单工具 submit_application
# 同一份实现同时服务：① 一遍过聊天（内部调用，带会话上下文）② 对外 /mcp Streamable HTTP。
# 工具集合刻意只保留这一个（聊天也只向模型暴露这一个工具）。

import uuid
from datetime import datetime

import db
from common import CATEGORY_CAP, CATEGORY_FIELD, UPLOADS_DIR

TOOL_NAME = "submit_application"
SERVER_NAME = "anticlass-apply"
SERVER_VERSION = "1.0.0"

# 工具输入 schema：items 可选（聊天内部以学生当前确认列表为准，忽略模型重复列出的内容；
# 外部客户端必须自己给 items + sid）。sid 同理：聊天内部由后端注入，外部必须显式给。
_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": list(CATEGORY_FIELD.keys()), "description": "加分栏目"},
        "points": {"type": "number", "minimum": 0, "description": "加分分值"},
        "basis": {"type": "string", "description": "加分依据"},
    },
    "required": ["category", "points", "basis"],
}

INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "sid": {"type": "string", "description": "学号（外部 MCP 客户端必填；一遍过聊天内部由系统注入）"},
        "items": {"type": "array", "items": _ITEM_SCHEMA, "description": "要提交的加分项（聊天内部以学生当前确认列表为准）"},
    },
}

TOOL_DESCRIPTION = (
    "申报 MCP：把加分项提交为待审批的综合奖学金申报记录。"
    "外部客户端必须提供 sid 与 items，调用后直接生成待审批记录（固定 submit，不接受 stage）；"
    "一遍过聊天内部由系统工作流调用（AI 生成工单时 stage 放入暂存队列，学生确认提交时 submit）。"
)

MCP_TOOL = {
    "name": TOOL_NAME,
    "title": "申报 MCP",
    "description": TOOL_DESCRIPTION,
    "inputSchema": INPUT_SCHEMA,
    "annotations": {
        "title": "申报 MCP",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": False,
    },
}

SUPPORTED_PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}


class ToolError(Exception):
    """工具执行的可读失败（回给模型 isError=true，不抛 HTTP 500）。"""


def _ok(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _err(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def _normalize_items(raw):
    """校验并规范化加分项；非法项跳过（聊天内部已校验，外部也容错）。"""
    out = []
    if not isinstance(raw, list):
        return out
    for it in raw[:30]:
        if not isinstance(it, dict):
            continue
        category = str(it.get("category", "")).strip()
        if category not in CATEGORY_FIELD:
            continue
        try:
            points = float(it.get("points", 0))
        except (TypeError, ValueError):
            continue
        cap = CATEGORY_CAP[category]
        points = round(min(max(points, 0.0), cap), 1)
        basis = str(it.get("basis", "")).strip()[:2000]
        if not basis:
            continue
        evidence = [str(x) for x in (it.get("evidence") or []) if isinstance(x, str)]
        out.append({"category": category, "points": points, "basis": basis, "evidence": evidence})
    return out


def _safe_evidence(names, folder, allowed):
    """只保留会话目录内、且确实存在的证据文件名（防外部传入任意路径）。"""
    if not folder:
        return []
    base = (UPLOADS_DIR / folder).resolve()
    root = UPLOADS_DIR.resolve()
    out = []
    for name in names:
        if name not in allowed or name in out:
            continue
        path = (base / name).resolve()
        if path.is_relative_to(root) and path.is_file():
            out.append(name)
    return out


def submit_application(sid, class_id, semester_id, items, folder="", allowed_evidence=None, by=""):
    """创建待审批申报记录。返回结构化结果；无有效项/学生不存在时抛 ToolError。"""
    sid = (sid or "").strip()
    if not sid:
        raise ToolError("缺少学号")
    semester = db.get_semester(semester_id) if semester_id else None
    if not semester:
        raise ToolError("学期不存在，无法申报")
    stu = db.get_student(sid, semester_id, class_id)
    if not stu:
        raise ToolError(f"该学期名单中没有学号 {sid}")

    cleaned = _normalize_items(items)
    if not cleaned:
        raise ToolError("没有可提交的加分项（请先确认加分项）")

    allowed = set(allowed_evidence or [])
    records = []
    now = datetime.now()
    for it in cleaned:
        evs = _safe_evidence(it["evidence"], folder, allowed)
        records.append(
            {
                "id": uuid.uuid4().hex,
                "sid": sid,
                "name": stu["name"],
                "class_id": stu["class_id"],
                "semester_id": semester_id,
                "category": it["category"],
                "points": it["points"],
                "basis": it["basis"],
                "evidence": evs,
                "folder": folder if evs else "",
                "approved": "否",
                "created_at": now,
            }
        )

    # 去重 + 插入在同一事务内完成（锁学生行），并发/重复调用同项只落一条
    created_records, skipped = db.insert_awards_dedup(records, sid, stu["class_id"], semester_id)
    submitted = [
        {
            "category": r["category"],
            "points": r["points"],
            "basis": r["basis"],
            "evidence": len(r["evidence"]),
        }
        for r in created_records
    ]

    summary = "、".join(f"{x['category']}+{x['points']:g}" for x in submitted) or "无新增"
    cls = db.get_class(stu["class_id"])
    if created_records:
        message = f"已提交 {len(created_records)} 条待审批申报（{summary}），等待管理员审批。"
    elif skipped:
        message = "这些加分项已在系统中（待审批或已通过），未重复提交。"
    else:
        message = "没有可提交的加分项。"
    if skipped and created_records:
        message += f" 另有 {skipped} 条已存在，已跳过。"

    return {
        "ok": True,
        "created": len(created_records),
        "skipped": skipped,
        "ids": [r["id"] for r in created_records],
        "items": submitted,
        "sid": sid,
        "name": stu["name"],
        "class_id": stu["class_id"],
        "class_name": cls["name"] if cls else "",
        "semester": semester["label"],
        "message": message,
        "by": by,
    }


def _stage_items(raw_items, session_items, folder, allowed):
    """内部暂存：只校验/去重，不落库、不写会话（调用方在锁内追加到 sess['items']）。"""
    cleaned = _normalize_items(raw_items)
    existing = {
        (i.get("category"), round(float(i.get("points", 0)), 1), (i.get("basis") or "").strip())
        for i in (session_items or [])
    }
    staged = []
    for it in cleaned:
        key = (it["category"], round(float(it["points"]), 1), it["basis"])
        if key in existing:
            continue
        existing.add(key)
        staged.append(
            {
                "category": it["category"],
                "points": it["points"],
                "basis": it["basis"],
                "evidence": _safe_evidence(it["evidence"], folder, allowed),
            }
        )
    return staged


def _call_submit(args, auth_ctx):
    """tools/call 的分发：内部会话用后端注入的 ctx；外部用管理员 token + sid/items。"""
    args = args if isinstance(args, dict) else {}
    if auth_ctx.get("internal"):
        ctx = auth_ctx.get("ctx") or {}
        mode = str(args.get("mode") or "submit").lower()
        session_items = ctx.get("items") or []
        if mode == "stage":
            # 模型生成工单（JSON add / 手动补录）这一步就是 MCP 调用：只放入暂存队列
            staged = _stage_items(
                args.get("items") or [],
                session_items,
                ctx.get("folder", ""),
                ctx.get("allowed_evidence") or [],
            )
            if not staged:
                return {
                    "ok": True,
                    "mode": "stage",
                    "staged": 0,
                    "staged_items": [],
                    "message": "没有新增加分项（已在暂存队列中）。",
                }
            return {
                "ok": True,
                "mode": "stage",
                "staged": len(staged),
                "staged_items": staged,
                "message": f"已放入暂存队列 {len(staged)} 项，核对后点「提交审批」。",
            }
        result = submit_application(
            ctx.get("sid"),
            ctx.get("class_id"),
            ctx.get("semester_id"),
            session_items or args.get("items"),
            folder=ctx.get("folder", ""),
            allowed_evidence=ctx.get("allowed_evidence") or [],
            by="assess-chat",
        )
        result["mode"] = "submit"
        return result

    role = auth_ctx.get("role")
    if role not in ("root", "admin"):
        raise ToolError("未授权：外部 MCP 调用需要管理员登录 token")
    sid = str(args.get("sid", "")).strip()
    if not sid:
        raise ToolError("外部 MCP 调用必须提供 sid")
    sem = db.get_open_semester()
    if not sem:
        raise ToolError("当前没有开放申报的学期")
    stu = db.get_student(sid, sem["id"])
    if not stu:
        raise ToolError(f"当前开放申报学期（{sem['label']}）名单中没有学号 {sid}")
    if role == "admin" and stu.get("class_id") != auth_ctx.get("class_id"):
        raise ToolError("只能申报本班学生")
    # 外部 MCP 固定走提交（生成待审批记录），不接受 stage
    result = submit_application(
        sid,
        stu["class_id"],
        sem["id"],
        args.get("items"),
        folder="",
        allowed_evidence=[],
        by=auth_ctx.get("username", ""),
    )
    result["mode"] = "submit"
    return result


def handle_rpc(message, auth_ctx):
    """处理一条 MCP JSON-RPC 消息；通知返回 None（HTTP 层回 202）。"""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _err(message.get("id") if isinstance(message, dict) else None, -32600, "Invalid Request")
    method = message.get("method")
    if not isinstance(method, str) or not method:
        return _err(message.get("id"), -32600, "Invalid Request")
    mid = message.get("id")

    if method == "initialize":
        requested = ((message.get("params") or {}).get("protocolVersion") or "").strip()
        version = requested if requested in SUPPORTED_PROTOCOLS else "2025-03-26"
        return _ok(
            mid,
            {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": "anticlass 申报 MCP：只提供 submit_application 一个工具。",
            },
        )
    if method.startswith("notifications/"):
        return None
    if method == "ping":
        return _ok(mid, {})
    if method == "tools/list":
        return _ok(mid, {"tools": [MCP_TOOL]})
    if method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        if name != TOOL_NAME:
            return _err(mid, -32602, f"未知工具：{name}")
        try:
            result = _call_submit(params.get("arguments") or {}, auth_ctx)
            return _ok(
                mid,
                {
                    "content": [{"type": "text", "text": result["message"]}],
                    "structuredContent": result,
                    "isError": False,
                },
            )
        except ToolError as e:
            # 工具级失败按 MCP 约定走正常 result + isError，让模型/客户端看到原因并可继续对话
            return _ok(
                mid,
                {
                    "content": [{"type": "text", "text": f"申报失败：{e}"}],
                    "structuredContent": {"ok": False, "error": str(e)},
                    "isError": True,
                },
            )
        except Exception as e:  # noqa: BLE001 - MCP 边界兜底，避免把 500 抛给客户端
            return _ok(
                mid,
                {
                    "content": [{"type": "text", "text": f"申报失败（内部错误）：{e}"}],
                    "structuredContent": {"ok": False, "error": str(e)},
                    "isError": True,
                },
            )
    return _err(mid, -32601, f"Method not found: {method}")


def call_tool_internal(name, arguments, ctx):
    """聊天内部调用：走同一套 MCP JSON-RPC 处理（不经过 HTTP），返回 structuredContent。"""
    resp = handle_rpc(
        {"jsonrpc": "2.0", "id": "chat", "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        {"internal": True, "ctx": ctx},
    )
    if not resp or "error" in resp:
        return {"ok": False, "error": (resp or {}).get("error", {}).get("message", "工具调用失败")}
    result = resp["result"]
    return result.get("structuredContent") or {"ok": not result.get("isError")}


def tool_result_text(result):
    if result.get("ok"):
        return result.get("message") or "已提交"
    return f"申报失败：{result.get('error', '未知错误')}"
