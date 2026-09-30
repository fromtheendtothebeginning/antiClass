# routers/ai_admin.py — AI 设置管理（root）：提供商/模型/搜索源配置、连通性测试、提示词覆盖

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import db
from ai import PROMPT_DEFAULTS, PROMPT_PLACEHOLDERS, get_prompts, load_config
from ai_settings import PROVIDERS, SEARCH_PROVIDERS, list_models, mask_key, test_chat
from common import require_root

router = APIRouter()


class AiConfigBody(BaseModel):
    provider: str = "custom"
    base_url: str
    model: str
    api_key: str = ""
    search_provider: str = "bing"
    search_api_key: str = ""


class AiTestBody(BaseModel):
    provider: str = "custom"
    base_url: str = ""
    model: str = ""
    api_key: str = ""


class AiPromptsBody(BaseModel):
    stage0: str
    stage1: str
    stage2: str
    stage3: str


def _read_ai_config_raw():
    cfg = db.get_setting("ai_config")
    return cfg if isinstance(cfg, dict) else {}


def _guess_provider(base_url):
    for pid, p in PROVIDERS.items():
        if p["base_url"] and base_url.rstrip("/") == p["base_url"].rstrip("/"):
            return pid
    return "custom"


@router.get("/api/ai/settings")
def get_ai_settings(authorization: str = Header(default="")):
    require_root(authorization)
    raw = _read_ai_config_raw()
    cfg = load_config() or {}
    base_url = cfg.get("base_url", "")
    key = cfg.get("api_key", "")
    search = raw.get("search") or {}
    search_key = search.get("api_key", "")
    return {
        "config": {
            "provider": raw.get("provider") or _guess_provider(base_url),
            "base_url": base_url,
            "model": cfg.get("model", ""),
            "api_key_masked": mask_key(key),
            "has_key": bool(key),
            "search": {
                "provider": search.get("provider", "bing"),
                "api_key_masked": mask_key(search_key),
                "has_key": bool(search_key),
            },
        },
        "providers": [
            {
                "id": pid,
                "label": p["label"],
                "base_url": p["base_url"],
                "default_model": p["default_model"],
                "models": p["models"],
            }
            for pid, p in PROVIDERS.items()
        ],
        "search_providers": list(SEARCH_PROVIDERS),
        "prompts": get_prompts(),
        "defaults": PROMPT_DEFAULTS,
        "placeholders": PROMPT_PLACEHOLDERS,
    }


@router.post("/api/ai/settings")
def save_ai_settings(body: AiConfigBody, authorization: str = Header(default="")):
    require_root(authorization)
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")
    if not body.model.strip():
        raise HTTPException(status_code=400, detail="模型 ID 不能为空")
    if body.search_provider not in SEARCH_PROVIDERS:
        raise HTTPException(status_code=400, detail="搜索源无效")
    raw = _read_ai_config_raw()
    old_search = raw.get("search") or {}
    config = {
        "provider": body.provider if body.provider in PROVIDERS else "custom",
        "base_url": body.base_url.strip().rstrip("/"),
        "model": body.model.strip(),
        "api_key": body.api_key.strip() or raw.get("api_key", ""),
        "search": {
            "provider": body.search_provider,
            "api_key": body.search_api_key.strip() or old_search.get("api_key", ""),
        },
    }
    db.set_setting("ai_config", config)
    return {
        "ok": True,
        "config": {
            "provider": config["provider"],
            "base_url": config["base_url"],
            "model": config["model"],
            "api_key_masked": mask_key(config["api_key"]),
            "has_key": bool(config["api_key"]),
            "search": {
                "provider": config["search"]["provider"],
                "api_key_masked": mask_key(config["search"]["api_key"]),
                "has_key": bool(config["search"]["api_key"]),
            },
        },
    }


@router.post("/api/ai/test")
def test_ai_settings(body: AiTestBody, authorization: str = Header(default="")):
    require_root(authorization)
    cfg = load_config() or {}
    base_url = body.base_url.strip() or cfg.get("base_url", "")
    model = body.model.strip() or cfg.get("model", "")
    api_key = body.api_key.strip() or cfg.get("api_key", "")
    if not base_url or not model:
        return {"ok": False, "latency_ms": 0, "error": "请先填写 Base URL 和模型"}
    ok, latency, error = test_chat(api_key, model, base_url)
    return {"ok": ok, "latency_ms": latency, "error": error}


@router.post("/api/ai/models")
def ai_model_list(body: AiTestBody, authorization: str = Header(default="")):
    require_root(authorization)
    cfg = load_config() or {}
    pid = body.provider if body.provider in PROVIDERS else "custom"
    provider = PROVIDERS[pid]
    base_url = body.base_url.strip() or provider["base_url"] or cfg.get("base_url", "")
    api_key = body.api_key.strip() or cfg.get("api_key", "")
    fallback = [m["id"] for m in provider.get("models", [])]
    ok, models, error = list_models(api_key, base_url, fallback)
    return {"ok": ok, "models": models, "error": error}


@router.post("/api/ai/prompts")
def save_ai_prompts(body: AiPromptsBody, authorization: str = Header(default="")):
    require_root(authorization)
    data = {"stage0": body.stage0, "stage1": body.stage1, "stage2": body.stage2, "stage3": body.stage3}
    missing = []
    for stage, required in PROMPT_PLACEHOLDERS.items():
        for ph in required:
            if ph not in data[stage]:
                missing.append(f"{stage} 缺少占位符 {ph}")
    if missing:
        raise HTTPException(status_code=400, detail="；".join(missing))
    for stage, text in data.items():
        if len(text) > 20000:
            raise HTTPException(status_code=400, detail=f"{stage} 提示词过长（>20000 字符）")
    db.set_setting("ai_prompts", data)
    return {"ok": True, "prompts": get_prompts()}


@router.post("/api/ai/prompts/reset")
def reset_ai_prompts(authorization: str = Header(default="")):
    require_root(authorization)
    db.delete_setting("ai_prompts")
    return {"ok": True, "prompts": dict(PROMPT_DEFAULTS)}
