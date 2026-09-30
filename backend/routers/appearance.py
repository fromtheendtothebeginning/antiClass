# routers/appearance.py — 全站外观：背景图案（电脑/手机两套）+ 访客开始界面
# 公开可读，登录后可改。内置图案只存 id（前端 index.css 里定义画法），
# 自定义图案存 data/patterns/ 下的文件并由 /api/appearance/pattern/{slot} 公开提供（带内容版本号便于缓存）。

import base64
import binascii
import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import db
from common import DATA_DIR, require_token

router = APIRouter()

PATTERN_NAME = {"grid": "网格", "dots": "点阵", "stripes": "斜纹", "custom": "自定义", "none": "无图案"}
PATTERN_SLOTS = ("desktop", "mobile")
DEFAULT_PATTERN = "grid"
PATTERNS_DIR = DATA_DIR / "patterns"
PATTERN_IMAGE_RE = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,")
PATTERN_EXT = {"png": ".png", "jpeg": ".jpg", "jpg": ".jpg", "webp": ".webp", "gif": ".gif"}
PATTERN_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
MAX_PATTERN_CHARS = 1_200_000  # ≈900 KB 原始图片（前端已压到 ≤1600px 并按宽度铺满）

# 访客（未登录）进入网站时的开始界面；空串 = 什么都不选（只显示侧边栏）。与前端 PUBLIC_TABS 保持一致
LANDING_TABS = ("board", "apply", "pass", "approve")


class PatternSlotBody(BaseModel):
    pattern: str
    image: str = ""  # 仅「自定义」且这次换了新图时传 data URL；留空表示沿用已上传的图


class AppearanceBody(BaseModel):
    desktop: PatternSlotBody | None = None
    mobile: PatternSlotBody | None = None
    landing: str | None = None  # 传了才更新（部分更新：只存背景或只存开始界面都行）


def _appearance_raw():
    cfg = db.get_setting("appearance")
    return cfg if isinstance(cfg, dict) else {}


def _pattern_slot(cfg, slot):
    """取某一端的配置。兼容早期单槽格式 {"pattern": "dots"}（当作电脑端/手机端同款）。"""
    raw = cfg.get(slot)
    if not isinstance(raw, dict):
        raw = cfg if cfg.get("pattern") else {}
    pattern = raw.get("pattern")
    if pattern not in PATTERN_NAME:
        pattern = DEFAULT_PATTERN
    file = raw.get("file") if isinstance(raw.get("file"), str) else ""
    return {"pattern": pattern, "file": file, "v": raw.get("v", "") if isinstance(raw.get("v"), str) else ""}


def _pattern_response(slot, data):
    """给前端的形态：自带可缓存的图片 URL；自定义图丢失时退回默认图案，避免全站空白。"""
    out = {"pattern": data["pattern"], "url": ""}
    if data["pattern"] == "custom" and data["file"] and (PATTERNS_DIR / data["file"]).is_file():
        out["url"] = f"/api/appearance/pattern/{slot}?v={data['v'] or '0'}"
    elif data["pattern"] == "custom":
        out["pattern"] = DEFAULT_PATTERN
    return out


def _landing_value(cfg):
    """访客开始界面：只认白名单里的公开界面，缺省/非法一律回落「什么都不选」。"""
    v = cfg.get("landing")
    return v if v in LANDING_TABS else ""


@router.get("/api/appearance")
def get_appearance():
    """背景图案与访客开始界面是全站设置，访客（未登录）也要按保存的值渲染，故无需 token。"""
    cfg = _appearance_raw()
    out = {slot: _pattern_response(slot, _pattern_slot(cfg, slot)) for slot in PATTERN_SLOTS}
    out["landing"] = _landing_value(cfg)
    return out


@router.get("/api/appearance/pattern/{slot}")
def get_pattern_image(slot: str):
    """自定义图案图片（公开，长缓存）：文件名由服务端生成，扩展名只可能是图片白名单里的几个。"""
    if slot not in PATTERN_SLOTS:
        raise HTTPException(status_code=404, detail="无此图案位")
    data = _pattern_slot(_appearance_raw(), slot)
    path = (PATTERNS_DIR / data["file"]) if data["file"] else None
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="尚未上传自定义图案")
    ext = Path(data["file"]).suffix.lower()
    return FileResponse(
        path,
        media_type=PATTERN_MEDIA.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/api/appearance")
def save_appearance(body: AppearanceBody, authorization: str = Header(default="")):
    """登录的管理员即可调整（后台配置项，不区分 role）。部分更新：desktop/mobile/landing 传了才改，
    「背景图案」页一次提交两端、「开始界面」页只提交 landing，互不覆盖。"""
    require_token(authorization)
    cur = _appearance_raw()
    saved = {}
    for slot in PATTERN_SLOTS:
        slot_body = getattr(body, slot)
        if slot_body is None:
            continue
        old = _pattern_slot(cur, slot)
        if slot_body.pattern not in PATTERN_NAME:
            raise HTTPException(status_code=400, detail="背景图案无效，可选：" + "、".join(PATTERN_NAME.values()))
        entry = {"pattern": slot_body.pattern}
        # 已上传的图跨开关保留：切回「自定义」时不必重新上传
        if old["file"]:
            entry["file"], entry["v"] = old["file"], old["v"]
        if slot_body.pattern == "custom":
            if slot_body.image:
                if len(slot_body.image) > MAX_PATTERN_CHARS:
                    raise HTTPException(status_code=400, detail=f"{slot} 端的自定义图案过大（请压到 1600px 以内）")
                m = PATTERN_IMAGE_RE.match(slot_body.image)
                if not m:
                    raise HTTPException(status_code=400, detail="自定义图案只支持 PNG/JPG/WebP/GIF 图片")
                try:
                    blob = base64.b64decode(slot_body.image.split(",", 1)[1], validate=True)
                except (binascii.Error, ValueError):
                    raise HTTPException(status_code=400, detail="自定义图案图片数据损坏，请重新导入")
                ext = PATTERN_EXT[m.group(1)]
                PATTERNS_DIR.mkdir(parents=True, exist_ok=True)
                for other in PATTERN_MEDIA:
                    if other != ext:
                        (PATTERNS_DIR / f"{slot}{other}").unlink(missing_ok=True)
                (PATTERNS_DIR / f"{slot}{ext}").write_bytes(blob)
                entry["file"] = f"{slot}{ext}"
                entry["v"] = hashlib.sha256(blob).hexdigest()[:8]  # 版本号变了 URL 才变，否则浏览器用缓存
            elif not entry.get("file"):
                raise HTTPException(status_code=400, detail=f"{slot} 端选择了自定义图案，请先导入图片")
        saved[slot] = entry
    if body.landing is not None:
        landing = body.landing.strip()
        if landing and landing not in LANDING_TABS:
            raise HTTPException(status_code=400, detail="开始界面无效，可选：什么都不选、" + "、".join(LANDING_TABS))
        saved["landing"] = landing
    if not saved:
        return {"ok": True, **get_appearance()}
    db.set_setting("appearance", {**cur, **saved})
    return {"ok": True, **get_appearance()}
