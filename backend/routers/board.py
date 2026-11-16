# routers/board.py — 榜单展示与导出：按班榜单、综合测评 Excel、证据 zip 归档

import io
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

import db
from common import check_class_scope, require_token
from evidence_zip import build_evidence_zip

router = APIRouter()


@router.get("/api/leaderboard")
def leaderboard(class_id: str | None = None, semester_id: str | None = None):
    # 榜单必须指明班级与学期：不带会把多个班/多个学期的学生按总分混排、统一编号名次
    cid = (class_id or "").strip()
    sid = (semester_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少 class_id：榜单按班级展示，请指定班级")
    if not sid:
        raise HTTPException(status_code=400, detail="缺少 semester_id：榜单按学期展示，请指定学期")
    sem = db.get_semester(sid)
    if not sem:
        raise HTTPException(status_code=400, detail="学期不存在")
    students = db.list_students(cid, sid)
    cls = db.get_class(cid)
    cmeta = db.get_class_meta(cid, sid)
    meta = {
        "rows": cmeta["row_count"],
        "source": cmeta["source"],
        # 回传班级/学期标识，便于前端/排查时自证当前展示的是哪份数据
        "class_id": cid,
        "class_name": cls["name"] if cls else "",
        "semester_id": sid,
        "semester_label": sem["label"],
        "semester_term": sem["term"],
    }
    # 挂科（无参评资格）学生沉底且不占名次：rank 置 0，综合测评成绩列显示 -1
    ranked = [s for s in students if not s.get("failed")]
    disq = [s for s in students if s.get("failed")]
    for rank, s in enumerate(ranked, start=1):
        s["rank"] = rank
    for s in disq:
        s["rank"] = 0
        s["total"] = -1
    return {"students": ranked + disq, "meta": meta}


@router.get("/api/export")
def export(class_id: str | None = None, semester_id: str | None = None):
    # 榜单按班级+学期导出：缺任一项都会导出跨班/跨学期混排的合并榜单，故直接拒绝
    cid = (class_id or "").strip()
    sid = (semester_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少 class_id：请先选择要导出的班级")
    if not sid:
        raise HTTPException(status_code=400, detail="缺少 semester_id：请先选择要导出的学期")
    sem = db.get_semester(sid)
    if not sem:
        raise HTTPException(status_code=400, detail="学期不存在")
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    headers = ["学号", "姓名", "德*15%", "智*60%", "体*10%", "美*5%", "劳*10%", "附加", "总分"]

    # 文件名对齐附件「25-26下学期xx班综合测评总分.xlsx」：学年学期 + 实际班级名
    cls = db.get_class(cid)
    cls_name = cls["name"] if cls else ""
    file_name = f"{sem['term'] or sem['label']}{cls_name}班综合测评总分.xlsx"

    # 样式严格对齐附件「25-26下学期xx班综合测评总分.xlsx」：
    # 等线 11 号（学号列仿宋）、全表细边框、学号列白色实底+文本格式、表头居中
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    font_body = Font(name="等线", size=11)
    font_sid = Font(name="仿宋", size=11)
    red_font = Font(name="等线", size=11, color="FFFF0000")
    red_sid_font = Font(name="仿宋", size=11, color="FFFF0000")
    center = Alignment(horizontal="center", vertical="center")
    header_font = Font(name="等线", size=11)

    ws.append(headers)
    for col in "ABCDEFGHI":
        cell = ws[f"{col}1"]
        cell.font = header_font
        cell.alignment = center
        cell.border = border
    # 学号列表头也用仿宋（附件 A1 是仿宋）
    ws["A1"].font = Font(name="仿宋", size=11)
    ws["A1"].fill = PatternFill(fill_type="solid", start_color="FFFFFFFF", end_color="FFFFFFFF")
    ws["A1"].number_format = "@"
    ws["B1"].number_format = "@"

    for stu in db.list_students(cid, sid):
        total = -1 if stu.get("failed") else stu["total"]
        row = [
            str(stu["sid"]),
            stu["name"],
            stu["deyu"],
            stu["score"],
            stu["tiyu"],
            stu["meiyu"],
            stu["laoyu"],
            stu["fujia"],
            total,
        ]
        ws.append(row)
        r = ws.max_row
        for i, col in enumerate("ABCDEFGHI", start=1):
            cell = ws.cell(row=r, column=i)
            cell.border = border
            # 挂科（无参评资格）行整行标红
            cell.font = red_sid_font if (col == "A" and stu.get("failed")) else (red_font if stu.get("failed") else (font_sid if col == "A" else font_body))
            if col in ("A", "B"):
                # 学号/姓名：文本格式（附件 A、B 列均为 @），学号列附白色实底
                cell.number_format = "@"
                cell.alignment = Alignment(horizontal="center", vertical="center")
                if col == "A":
                    cell.fill = PatternFill(fill_type="solid", start_color="FFFFFFFF", end_color="FFFFFFFF")
            elif i == 2:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(vertical="center")

    # 表头行高 + 列宽（附件值）
    ws.row_dimensions[1].height = 24.85
    for col, width in zip("ABC", (8.71, 8.71, 8.71)):
        ws.column_dimensions[col].width = width
    for col in "DEFGHI":
        ws.column_dimensions[col].width = 13
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(file_name)},
    )


@router.get("/api/export/evidence-zip")
def export_evidence_zip(class_id: str | None = None, semester_id: str | None = None, authorization: str = Header(default="")):
    session = require_token(authorization)
    sem = (semester_id or "").strip() or None
    if sem and not db.get_semester(sem):
        raise HTTPException(status_code=400, detail="学期不存在")
    if class_id:
        check_class_scope(session, class_id)
    else:
        if session["role"] != "root":
            class_id = session.get("class_id")
            if not class_id:
                raise HTTPException(status_code=403, detail="账号未绑定班级，无法导出")
    buf = build_evidence_zip(class_id, sem)
    zip_name = f"evidence_backup_{datetime.now():%Y%m%d}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={zip_name}",
            # zip 已在内存完整生成，显式给 Content-Length，避免 chunked 下载在某些浏览器被拦截
            "Content-Length": str(len(buf.getvalue())),
        },
    )
