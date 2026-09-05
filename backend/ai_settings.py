# ai_settings.py — AI 提供商注册表 / Key 脱敏 / 连通性测试 / 模型列表
# 参照 anticraft/index backend/aisettings.py 的实现方式，裁剪为 OpenAI 兼容 /chat/completions。

import json
import time
import urllib.error
import urllib.request

# 提供商注册表（OpenAI 兼容 /chat/completions，Bearer 认证）
# vision: 该模型支持图片输入（加分申报需要识图）
PROVIDERS = {
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "models": [
            {"id": "deepseek-v4-flash-vision-exp", "vision": True},
            {"id": "deepseek-v4-flash", "vision": False},
            {"id": "deepseek-v4-pro", "vision": False},
        ],
        "default_model": "deepseek-v4-flash-vision-exp",
    },
    "opencode-go": {
        "label": "OpenCode Go",
        "base_url": "https://opencode.ai/zen/go/v1",
        "models": [
            {"id": "deepseek-v4-flash-vision-exp", "vision": True},
            {"id": "deepseek-v4-flash", "vision": False},
            {"id": "deepseek-v4-pro", "vision": False},
            {"id": "glm-5.3", "vision": False},
            {"id": "kimi-k3", "vision": True},
            {"id": "qwen3.8-max", "vision": True},
        ],
        "default_model": "deepseek-v4-flash-vision-exp",
    },
    "kimi": {
        "label": "Kimi (月之暗面)",
        "base_url": "https://api.moonshot.cn/v1",
        "models": [
            {"id": "kimi-k3", "vision": True},
            {"id": "kimi-k2.7-code", "vision": False},
            {"id": "kimi-k2.6", "vision": False},
        ],
        "default_model": "kimi-k3",
    },
    "glm": {
        "label": "GLM (智谱)",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": [
            {"id": "glm-5.3", "vision": True},
            {"id": "glm-5.2", "vision": True},
            {"id": "glm-4.6", "vision": False},
        ],
        "default_model": "glm-5.3",
    },
    "qwen": {
        "label": "Qwen (通义千问)",
        "base_url": "https://dashscope.aliyun.com/compatible-mode/v1",
        "models": [
            {"id": "qwen3.8-max", "vision": True},
            {"id": "qwen3.7-max", "vision": True},
            {"id": "qwen-max", "vision": True},
            {"id": "qwen-plus", "vision": False},
        ],
        "default_model": "qwen3.8-max",
    },
    "custom": {
        "label": "自定义 (OpenAI 兼容)",
        "base_url": "",
        "models": [],
        "default_model": "",
    },
}

SEARCH_PROVIDERS = ["bing", "duckduckgo", "tavily"]

# opencode.ai 的 Cloudflare 拦截默认 urllib 请求（无浏览器 UA 返回 403 error code:1010）
_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"


def get_provider(pid):
    return PROVIDERS.get(pid)


def mask_key(plain):
    if not plain:
        return ""
    if len(plain) <= 8:
        return "***"
    return f"{plain[:5]}***{plain[-4:]}"


def _headers(api_key):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _BROWSER_UA,
    }


def test_chat(api_key, model, base_url, timeout=20):
    """发一条极小请求验证 Key/模型/Base URL 可用。返回 (ok, latency_ms, error|None)"""
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps(
        {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 8, "stream": False}
    ).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=_headers(api_key), method="POST")
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
            return True, int((time.monotonic() - start) * 1000), None
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        msg = {401: "API Key 无效或未授权", 403: "无权访问该模型", 404: "接口或模型不存在（检查 Base URL / 模型 ID）"}.get(e.code)
        return False, int((time.monotonic() - start) * 1000), msg or f"HTTP {e.code}: {detail}"
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        return False, int((time.monotonic() - start) * 1000), f"无法连接提供商：{reason}"
    except Exception as e:
        return False, int((time.monotonic() - start) * 1000), f"请求失败：{e}"


def list_models(api_key, base_url, fallback_models=None, timeout=15):
    """调提供商 GET /models 拉取可用模型列表，失败回退注册表内置列表。返回 (ok, models, error|None)"""
    url = base_url.rstrip("/") + "/models"
    req = urllib.request.Request(url, headers=_headers(api_key))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        ids = [str(m.get("id")) for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]
        ids = [i for i in ids if i]
        if not ids and fallback_models:
            return True, list(fallback_models), None
        return True, ids, None
    except urllib.error.HTTPError as e:
        if fallback_models:
            return True, list(fallback_models), None
        return False, [], f"HTTP {e.code}"
    except Exception as e:
        if fallback_models:
            return True, list(fallback_models), None
        return False, [], f"请求失败：{e}"
