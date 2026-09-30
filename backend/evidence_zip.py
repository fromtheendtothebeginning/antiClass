# evidence_zip.py — 已通过申报的证据归档导出（zip + 零依赖 YAML 明细）

import io
import re
import zipfile
from pathlib import Path

from fastapi import HTTPException

import db
from common import UPLOADS_DIR

# zip 内禁止出现的目录名字符（Windows/常规 zip 工具不友好的字符一律替换）
_ZIP_NAME_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _evidence_readable(stored_name):
    """去掉 save_upload 加的 32 位 hex 前缀，还原成可读文件名。"""
    m = re.fullmatch(r"[0-9a-f]{32}_(.+)", stored_name)
    return m.group(1) if m else stored_name


def _yaml_dumps(obj, indent=0):
    """轻量 YAML 序列化（零依赖），支持 dict/list/str/int/float/bool/None。"""
    pad = "  " * indent
    if obj is None:
        return f"{pad}null"
    if isinstance(obj, bool):
        return f"{pad}{'true' if obj else 'false'}"
    if isinstance(obj, (int, float)):
        return f"{pad}{obj}"
    if isinstance(obj, str):
        # 需要加引号的情况
        if obj == "" or obj in ("true", "false", "null", "yes", "no") or re.search(r'[:#{}\[\],&*?|>!%@`]', obj) or obj.startswith((" ", "\t", "\n", "-", "?")):
            return f'{pad}"{obj.replace(chr(92), chr(92)+chr(92)).replace(chr(34), chr(92)+chr(34))}"'
        return f"{pad}{obj}"
    if isinstance(obj, list):
        if not obj:
            return f"{pad}[]"
        lines = []
        for item in obj:
            if isinstance(item, dict):
                # dict 作为列表项：第一行 key: value，后续缩进
                first = True
                for k, v in item.items():
                    if first:
                        lines.append(f"{pad}- {k}: {_yaml_value(v, indent + 2)}")
                        first = False
                    else:
                        lines.append(f"{pad}  {k}: {_yaml_value(v, indent + 2)}")
            else:
                lines.append(f"{pad}- {_yaml_value(item, indent + 1)}")
        return "\n".join(lines)
    if isinstance(obj, dict):
        if not obj:
            return f"{pad}{{}}"
        lines = []
        for k, v in obj.items():
            lines.append(f"{pad}{k}: {_yaml_value(v, indent + 1)}")
        return "\n".join(lines)
    return f"{pad}{obj}"


def _yaml_value(v, indent):
    """内联简单值，嵌套结构换行缩进。"""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        if v == "" or v in ("true", "false", "null") or re.search(r'[:#{}\[\],&*?|>!%@`]', v) or v.startswith((" ", "-", "?")):
            return f'"{v.replace(chr(92), chr(92)+chr(92)).replace(chr(34), chr(92)+chr(34))}"'
        return v
    # 嵌套结构：换行 + 缩进
    return "\n" + _yaml_dumps(v, indent)


def build_evidence_zip(class_id=None):
    """把「已通过(approved=是)」申报按人打包：每人一个「学号_姓名/」目录，
    内含 申报明细.yaml 与 evidence/ 证据文件，外加总 index.yaml。返回 BytesIO。

    被多人引用的同一证据文件放入顶层「公共证据/」目录，个人以 ref 引用。
    """
    records = [r for r in db.list_awards(class_id or None) if r.get("approved") == "是"]
    if not records:
        raise HTTPException(status_code=400, detail="当前范围暂无已通过的申报，无需导出")

    # 按学号聚合（同班同人多次申报合并；姓名用记录快照，空则回退学号）
    people = {}
    for r in records:
        people.setdefault(r["sid"], {"name": r.get("name") or r["sid"], "records": []})["records"].append(r)

    uploads_root = UPLOADS_DIR.resolve()

    # ── 第一遍：收集所有证据，按 canonical path 聚合，判断是否被多人引用 ──
    # canonical_path → {"readable": str, "ref_sids": set}
    shared_map = {}
    for sid, p in people.items():
        for r in p["records"]:
            base = (UPLOADS_DIR / (r.get("folder") or "")).resolve()
            for f in r.get("evidence") or []:
                if not r.get("folder"):
                    continue
                path = (base / f).resolve()
                if not path.is_relative_to(uploads_root) or not path.exists():
                    continue
                if path not in shared_map:
                    shared_map[path] = {"readable": _evidence_readable(f), "ref_sids": set()}
                shared_map[path]["ref_sids"].add(sid)

    # 被 ≥2 人引用 → 公共证据
    public_files = {k: v for k, v in shared_map.items() if len(v["ref_sids"]) >= 2}

    # 公共证据文件名去重（同一可读名只出现一次）
    public_zip_names = {}  # canonical_path → zip 内文件名
    used_public = set()
    for path, info in public_files.items():
        name = info["readable"]
        stem, dot = Path(name).stem, Path(name).suffix
        archive = name
        n = 2
        while archive in used_public:
            archive = f"{stem}_{n}{dot}"
            n += 1
        used_public.add(archive)
        public_zip_names[path] = archive

    # ── 第二遍：写 zip ──
    buf = io.BytesIO()
    summary = {"students": [], "total_records": len(records), "total_files": 0}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 写公共证据目录
        for path, archive in public_zip_names.items():
            zf.write(path, f"公共证据/{archive}")

        for sid, p in people.items():
            folder_name = _ZIP_NAME_BAD.sub("_", f"{sid}_{p['name']}") or sid
            used_names = set()  # 同人证据去重名
            person_files = 0
            person_json = {"sid": sid, "name": p["name"], "class_id": p["records"][0].get("class_id", ""), "records": []}
            for r in p["records"]:
                rec_json = {
                    "id": r["id"],
                    "category": r["category"],
                    "points": r["points"],
                    "basis": r["basis"],
                    "created_at": r["created_at"],
                    "approved": r["approved"],
                    "evidence": [],
                }
                base = (UPLOADS_DIR / (r.get("folder") or "")).resolve()
                for f in r.get("evidence") or []:
                    if not r.get("folder"):
                        rec_json["evidence"].append({"source": f, "missing": True})
                        continue
                    path = (base / f).resolve()
                    if not path.is_relative_to(uploads_root) or not path.exists():
                        rec_json["evidence"].append({"source": f, "missing": True})
                        continue
                    # 归档名：还原可读原名，冲突时加序号（如 xxx_2.png）
                    name = _evidence_readable(f)
                    stem, dot = Path(name).stem, Path(name).suffix
                    archive = name
                    n = 2
                    while archive in used_names:
                        archive = f"{stem}_{n}{dot}"
                        n += 1
                    used_names.add(archive)

                    if path in public_zip_names:
                        # 公共证据：不在个人目录放副本，只在申报明细.json 中标注引用
                        rec_json["evidence"].append({"source": f, "ref": f"公共证据/{public_zip_names[path]}", "missing": False})
                    else:
                        # 非公共证据：写入个人 evidence/ 目录
                        zf.write(path, f"{folder_name}/evidence/{archive}")
                        rec_json["evidence"].append({"file": f"evidence/{archive}", "source": f, "missing": False})
                        person_files += 1
                person_json["records"].append(rec_json)
            zf.writestr(f"{folder_name}/申报明细.yaml", _yaml_dumps(person_json))
            summary["students"].append({"sid": sid, "name": p["name"], "records": len(person_json["records"]), "files": person_files, "folder": folder_name})
            summary["total_files"] += person_files
        zf.writestr("index.yaml", _yaml_dumps(summary))
    buf.seek(0)
    return buf
