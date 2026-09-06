# assess.py — 「加分一遍过」对话会话：AI 依据评分办法逐项提问，学生逐项回答，流式输出。
# 会话存内存（与 DRAFTS 一致，重启即失）；加分项由 AI 在每轮回复尾行的 ==JSON== 段上报。

import json
import re
import threading
import time
import uuid

import ai
import db

SESSION_LIMIT = 100
SESSION_TTL = 3600  # 1 小时无交互自动回收

# 可加分栏目（与系统一致）
CATEGORIES = ["德育", "体育", "美育", "劳育", "附加分"]
CAP = {"德育": 100, "体育": 100, "美育": 100, "劳育": 100, "附加分": 5}

# 范围外项目硬过滤：即使模型误报也绝不入库（仅用户明确排除的四类）
OUT_OF_SCOPE_KW = ["第二课堂", "班级活动", "主题团日", "班会", "出勤", "班委", "班长", "团支书"]

# 正文加分判定句模式：用于检测"判了加分但 add 漏报"的兜底（排除规则描述性语句）
_SCORE_CLAIM_RE = re.compile(
    r"(?:该项|本项|对应|可)?\*{0,2}\s*(?:可|应|确认)?加(?:的)?分(?:为|是)?[:：*]*\s*\d+(?:\.\d+)?"
    r"|本项加分[:：]?|加\s*\d+(?:\.\d+)?\s*分|得分[:：]?\s*\d+(?:\.\d+)?",
)
SCORE_CLAIM_RE = _SCORE_CLAIM_RE

SYSTEM_PROMPT = """你是上海应用技术大学智能技术学部综合奖学金评定系统中的**「加分一遍过」访谈助手**。
目标：对照【评分办法原文】，按加分栏目**从头到尾逐项提问**，把学生在本学期能加分的项目一次性问全、问清，边问边判定加分。

# 学生快捷回复（界面按钮）含义
- 学生发送「没有/无」：表示当前所问的小项不存在/未获得，按"无"处理并继续下一项。
- 学生发送「确认/是/有」：确认当前小项确实存在/已获得，按"有"处理并给出判定。
- 学生发送「继续」：表示上一轮判定已了解，催促你直接推进到**下一个**小项提问（不要重复已说内容）。

# 回复风格（自然问答，不要带任何结构化标签前缀）
你的输出是对学生说的话，**贴近日常问答语气**：先自然确认学生说了什么，再给出能不能加分的结论（能加分的话明确说清"加几分、依据是什么"），然后顺势自然地接着问下一个项目。整体读起来应像老师在和学生一问一答，**不要在每段前面加"【要点】/【判定】/【下一问】之类的标签或编号**。
- 可加分 → 结论里要包含"本项加分：栏目=德育，分值=2，依据=……"这种**机器可读的固定句式**（必须含"本项加分："且分值写阿拉伯数字，后端靠它/JSON 落库）；同时该加分项**必须同步写入本轮 add**。
- 不可加/无 → 用自然口吻说"这个不加分"或"好的，没有就不计了"，一句带过即可。
- 给出任何加分判定后，**不要停在结论上**，要紧接着自然地接着问下一个要确认的小项（一次只问一个）。

# 访谈方式
- 一轮**只提一个问题**。学生回答并给出判定后，最多再进入下一小项提一个新问题；严禁在一轮回复里同时抛多个不同的问题。
- 问题要**具体、单一、好回答**：一次只问一个栏目里的一小项（如"是否有校级及以上荣誉称号"），不要把整个栏目或多个小项打包问。
- 按原文顺序推进：德育（思想政治素养→社会实践→荣誉称号与学生骨干）→ 体育 → 美育 → 劳育（学科技能竞赛、专业证书、星级寝室、劳动教育）→ 附加分。上一项问完并判定后再进入下一项，不要跳跃、不要漏项。
- **小节过渡**：当某个小部分（如"德育-思想政治素养"）的全部小项都已问完且未确认加分项时，用一句过渡（如"至此德育—思想政治素养部分结束，已确认无加分项。"）小结，然后**立即继续询问下一小部分**，不要停下来问学生"是否继续/还有吗"。

# 栏目归属：一律自查原文，严禁反问学生
- 学生提到的赛事/证书/活动属于哪个加分栏目、能否加分、加多少，全部由你依据【评分办法原文】（含附录1学科技能竞赛目录、各分值表）自行判定，**绝不向学生提问"这属于哪一类/哪个栏目/该不该加分"**。
- 例如：蓝桥杯等学科技能竞赛在附录1竞赛目录中 → 归**劳育-学科技能竞赛**，按目录与分值表判定；不要把分类问题抛回给学生。
- 若学生描述的内容**涉及尚未问到的栏目**（例如正问德育时学生说"获得了蓝桥杯省一"），不要当场打断追问归属，也不要跳到该栏目去判定；简短回应"已记录，稍后到劳育-学科技能竞赛部分统一对照原文核定"，然后**回到当前栏目继续下一个问题**。等到对应栏目时才结合之前记录统一对照、给结论。
- 学生回答后：能对应到原文加分表条目的，给出明确加分结论并**引用原文条款/表格**；信息不足（缺级别、缺名次、时间不符等）时先追问澄清，不要臆断加分。

# 本访谈范围外的项目：原文虽列出，但必须【静默跳过】——不提问、不在正文出现、不报小节名
以下小项**虽然出现在评分办法原文中**（如"社会实践(1)第二课堂学分达标""思想政治素养(3)班级主题团日/班会""智育成绩""班委任职"等），但**不属于本访谈范围**。按原文顺序推进时遇到它们，**直接略过进入下一小项**：
- 不要复述该小项名称或编号（例如不要输出"社会实践(1)：第二课堂学分达标"），不要向学生提问该小项内容。
- 不要用过渡句介绍它、不要总结它。
- 输出应与该小项从未存在过一样，紧接着去问**下一项真正需要申报的项目**。
- 仅当学生**主动提起**范围外项目时，用一句"该项由学校/班级按统一流程处理，此处不申报。"带过，然后回到当前进度继续，不展开、不追问、不计分。

范围外小项清单：
- 智育成绩相关（智育按成绩自动计算，无加分项）
- 班级主题团日、班会、班级活动出勤
- 当学期第二课堂学分达标
- 班委任职（请走系统「班委加分」快捷入口）

**即使学生主动声称达到/取得了范围外项目（如"我第二课堂学分达标了"），也一律不得判定加分、不得在 add 上报、不得输出"确认加分/本项加X分"**——只用一句"该项由学校/班级按统一流程处理，此处不申报。"带过，然后**立刻继续问下一项真正要申报的项目**。

**示例（正确）**：原文"社会实践"下有小项"①第二课堂学分达标；②社会实践立项"。问完思想政治素养后，你应**不提①**，直接问"请问你本学期是否参与并立项了社会实践项目（院/校/市级）？组长或组员？"
**反例（错误）**：输出"社会实践(1)：第二课堂学分达标。请问你本学期第二课堂学分达标了吗？"——这是**绝对禁止**的。

# 输出协议（严格遵守）
**每一轮**回复都必须以协议收尾：正文结束后，另起一行单独输出机器可读的 JSON 段（**不要**包在```代码块里、**不要**在其后再写任何文字），格式为一行：

==JSON== {"add":[],"done":false}

- `add` 数组内容形如：`{"category":"德育","points":2,"basis":"依据…"}`；本轮**有**加分结论就写入，**没有也一定要输出**（空数组），**绝不允许省略这一行**——系统完全依赖它把加分项显示并提交给学生。
- **正文的加分判定必须与 add 一一对应**：用户在界面看到的加分列表只来自每轮 `add` 数组。凡是在正文中给出了明确加分结论的项目（"该项加 X 分""确认加分""得分"等），**必须同步写入当轮 add**；add 中的每一项也须在正文有对应说明。正文说加分而 add 漏报，等于该项"判了但没显示/没法提交"，是**严重错误**。
- `done`：只有学生明确表示"没有更多/结束/就这些"或全部栏目问完才置 `true`；否则 `false`。判定某一项有无加分本身绝不构成结束，正文结尾必须是一句接着问下一个项目的话。
- 收尾 JSON 之后不要再输出任何文字。

【评分办法原文】：
__RULES__
"""


def build_system():
    return (
        SYSTEM_PROMPT.replace("__RULES__", ai.load_rules())
        + "\n\n"
        + ai.UNTRUSTED_NOTE
    )


_SESSIONS = {}
_LOCK = threading.Lock()


def _gc():
    now = time.time()
    for sid in [k for k, s in _SESSIONS.items() if now - s["updated"] > SESSION_TTL]:
        _SESSIONS.pop(sid, None)


def start(sid, name, class_id):
    with _LOCK:
        _gc()
        if len(_SESSIONS) >= SESSION_LIMIT:
            # 挤掉最旧会话
            oldest = min(_SESSIONS, key=lambda k: _SESSIONS[k]["updated"])
            _SESSIONS.pop(oldest, None)
        # 载入该生已存在的申报/加分记录（只读），用于防重复加分
        existing = []
        try:
            for a in db.list_awards(class_id or None):
                if a.get("sid") == sid and a.get("approved") in ("是", "否", "驳回"):
                    existing.append(
                        {
                            "category": a.get("category", ""),
                            "points": float(a.get("points", 0)),
                            "approved": a.get("approved", ""),
                            "basis": (a.get("basis") or "")[:200],
                        }
                    )
        except Exception:
            existing = []
        sess = {
            "id": uuid.uuid4().hex,
            "sid": sid,
            "name": name,
            "class_id": class_id,
            "created": time.time(),
            "updated": time.time(),
            "messages": [],
            "items": [],
            "existing": existing,
            "done": False,
            "ended": False,
        }
        _SESSIONS[sess["id"]] = sess
        return dict(sess)


def get(session_id):
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if not s:
            return None
        s["updated"] = time.time()
        return s


def touch_updated(session):
    with _LOCK:
        session["updated"] = time.time()


def finish(session_id):
    """学生主动结束（不再补充）：标记完成且不再接受消息。"""
    with _LOCK:
        s = _SESSIONS.get(session_id)
        if not s:
            return None
        s["done"] = True
        s["ended"] = True
        s["updated"] = time.time()
        return dict(s)


def drop(session_id):
    with _LOCK:
        _SESSIONS.pop(session_id, None)


def _trim_messages(messages):
    # 保留最近 24 条对话（约 12 轮），避免早期记录的跨栏目事项被挤出窗口
    return messages[-24:]


def _try_json(text):
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return obj if isinstance(obj, dict) else None


def _fallback_items(body):
    """JSON 段缺失时的兜底：从正文的标准加分句「本项加分：栏目=…，分值=…，依据=…」提取加分项。"""
    CAT = "|".join(CATEGORIES)
    out = []
    pat = re.compile(
        r"本项加分[:：]\s*(?:栏目=)?(?P<cat>" + CAT + r")[\s,，;；]+"
        r"(?:分值|分数|得分)\s*=\s*(?P<pts>\d+(?:\.\d+)?)[\s,，;；]+"
        r"(?:依据\s*=\s*)?(?P<basis>.{2,200}?)(?=【|。|\n|$)",
        re.S,
    )
    for m in pat.finditer(body):
        cat = m.group("cat").strip()
        pts = round(max(0.0, min(float(m.group("pts")), CAP.get(cat, 100))), 1)
        basis = m.group("basis").strip().rstrip("。")[:500]
        if basis:
            out.append({"category": cat, "points": pts, "basis": basis})
    return out


def _split_protocol(full):
    """把模型整段回复拆成 (正文, 协议payload)。兼容多种格式：
    - ==JSON== {"add":...,"done":...}（裸单行）
    - ==JSON==\n```json\n{多行}\n```（代码块包裹）
    - 整段仅一个末尾 JSON（无 ==JSON== 标记）
    - JSON 前有【返回格式】等前缀说明
    解析失败返回 (全文, {})，由调用方安全降级。"""
    full = (full or "").strip()
    if not full:
        return "", {}

    # 形态1/2：==JSON== 之后取首个 { 到最后一个 }（容忍中间换行/代码围栏）
    m = re.search(r"==JSON==\s*(?:```(?:json)?\s*)?(\{.*\})(?:\s*```)?\s*$", full, re.S)
    if m:
        payload = _try_json(m.group(1))
        if payload is not None:
            return full[: m.start()].strip(), payload

    # 形态2b：正文后 ```json 代码块内的完整 JSON（无 ==JSON== 标记）
    m = re.search(r"```(?:json)?\s*\n?(\{.*\})\s*```\s*$", full, re.S)
    if m:
        payload = _try_json(m.group(1))
        if payload is not None and ("add" in payload or "done" in payload):
            idx = full.find("```")
            return full[:idx].strip(), payload

    # 形态3：全文最后一段 {…} 若可解析且含 add/done 字段
    for cand in re.findall(r"\{.*?\}", full, re.S):
        payload = _try_json(cand)
        if payload is not None and ("add" in payload or "done" in payload):
            idx = full.find(cand)
            return full[:idx].strip(), payload

    return full, {}


def _body_is_zero_or_already_scored(body, sess):
    """正文疑似判分但没有结构化 add 时，判断是否为「0 分判定」或「已加过分的重复说明」——
    两者都是正常对话，不该提示「未能自动识别」。返回 True 表示应静默。"""
    # 1. 判出的是 0 分：如"该项加 0 分/加分为0/得0分/不加分" → 静默
    text = body.replace("*", "").replace(" ", "")
    zero = re.search(r"(?:加|得|评|计|记)?0(?:\.0)?\s*分|分(?:为|是|：|:)?0(?:\.0)?(?:分)?|不加分|无加分", text)
    if zero and not re.search(r"(?:加|得|评)[1-9]", text):
        return True
    # 2. 正文把该项判为"已加过/已通过/之前确认过" → 静默
    if re.search(r"已(?:经)?(?:加过|通过|确认|上报|记录)(?:加分|该项|这项)?", body):
        return True
    # 3. 正文点名栏目与分值，而该生系统中已有同栏目同分值已通过记录（防重复语境）
    existing = sess.get("existing") or []
    for e in existing:
        if e.get("approved") != "是":
            continue
        cat, pts = e.get("category", ""), e.get("points", 0)
        if cat and cat in body and re.search(rf"{cat}[^。]{0,20}?{pts:g}\s*分", body):
            return True
    return False


def run_turn(session_id, user_text, image_paths=None):
    """执行一轮问答，产出 SSE 事件 dict（delta/add/done）。
    支持本轮附带图片（image_paths：本地临时图片路径列表），随文字一起发给 AI 识别。
    done 之后允许一次「补充对话」，该轮结束即 ended，不再接受新消息。"""
    sess = get(session_id)
    if not sess:
        raise RuntimeError("会话不存在或已过期，请重新开始")
    if sess.get("ended"):
        raise RuntimeError("会话已结束，如需继续请重新开始")
    was_done = sess["done"]
    user_text = (user_text or "").strip()[:500]
    if image_paths and not user_text:
        user_text = "（上传了图片，请查看图片内容并继续判定/提问）"
    if not user_text and not image_paths:
        raise RuntimeError("请输入内容")

    cfg = ai.load_config()
    if not cfg:
        raise RuntimeError("AI 未配置，请在管理界面「AI 设置」填写 base_url/api_key/model")

    with _LOCK:
        sess["messages"].append({"role": "user", "content": user_text})
        history = _trim_messages(sess["messages"])
    sess["updated"] = time.time()

    messages = [{"role": "system", "content": build_system()}] + history
    # 每轮注入已确认加分项摘要，防止模型重复判定同一项目
    if sess["items"]:
        summary = "\n".join(
            f"- {it['category']} +{it['points']}：{it['basis']}"
            for it in sess["items"]
        )
        messages.append(
            {
                "role": "system",
                "content": "【本会话已确认的加分项（只读，不得重复判定或再次上报）】\n" + summary,
            }
        )
    # 注入该生系统中已存在的申报/加分记录（只读）→ 命中这些的不再询问与上报，避免重复加分
    existing = sess.get("existing") or []
    if existing:
        lines = [
            f"- {e['category']} +{e['points']}（{e['approved']}）{e['basis']}"
            for e in existing
        ]
        messages.append(
            {
                "role": "system",
                "content": "【该生已在系统中申报/获得过的加分项（只读）】涉及这些内容请**不再询问、不再判定、不写入 add**，避免重复加分：\n" + "\n".join(lines),
            }
        )
    if was_done:
        messages.append(
            {
                "role": "system",
                "content": "【补充对话】主体询问已结束，这是学生主动发起的最后一次补充。只回应学生本条补充内容，判断是否有遗漏的加分项需上报；不要再继续询问新问题，回复后对话结束。",
            }
        )
    # 本轮附带图片：把最后一条 user 文本换成 content 数组（文本 + 图片），随请求发给 AI
    if image_paths:
        parts = [{"type": "text", "text": user_text or ""}]
        for p in image_paths[:6]:
            img = ai.image_part(p)
            if img:
                parts.append(img)
        messages.append({"role": "user", "content": parts})
    body_parts = []
    try:
        for delta in ai.stream_chat(messages, cfg):
            body_parts.append(delta)
            yield {"type": "delta", "text": delta}
    except (RuntimeError, OSError, KeyError, json.JSONDecodeError) as e:
        yield {"type": "error", "text": f"请求失败：{e}"}
        return

    full = "".join(body_parts)
    # 解析收尾 JSON 段（兼容：==JSON== 裸行 / ```json 代码块包裹 / 多行 / 最后一段 JSON）
    body, payload = _split_protocol(full)
    add_items = payload.get("add", []) if isinstance(payload, dict) else []
    done = bool((payload.get("done") if isinstance(payload, dict) else False))
    # JSON 段缺失/为空时，兜底从正文标准加分句提取（防止模型漏输 JSON 导致整轮丢失）
    if not add_items and not done:
        add_items = _fallback_items(body)

    new_items = []
    blocked_dup = False
    for it in add_items:
        if not isinstance(it, dict):
            continue
        category = str(it.get("category", "")).strip()
        if category not in CAP:
            continue
        try:
            points = float(it.get("points", 0))
        except (TypeError, ValueError):
            points = 0.0
        points = round(max(0.0, min(points, CAP[category])), 1)
        basis = str(it.get("basis", "")).strip()[:500]
        if not basis:
            continue
        # 硬过滤：范围外项目（第二课堂/班级活动/出勤/班委等）绝不入库
        if any(kw in basis for kw in OUT_OF_SCOPE_KW):
            continue
        # 同项去重（栏目+分值+依据一致：与会话内已确认或系统中已通过/申报项）
        existing = sess.get("existing") or []
        dup = any(
            (i["category"] == category and i["points"] == points and i["basis"] == basis)
            for i in sess["items"]
        ) or any(
            e["category"] == category and e["points"] == points
            for e in existing
            if e.get("approved") == "是"  # 仅已通过项硬去重；待审批/驳回允许重新申报
        )
        if dup:
            blocked_dup = True
            continue
        new_items.append({"category": category, "points": points, "basis": basis})

    with _LOCK:
        sess["items"].extend(new_items)
        sess["done"] = sess["done"] or done
        # 补充轮（was_done）结束后彻底结束会话
        if was_done:
            sess["ended"] = True
        sess["messages"].append({"role": "assistant", "content": body or "（本轮无输出）"})

    if new_items:
        yield {"type": "add", "items": list(new_items)}
    elif blocked_dup:
        yield {
            "type": "warning",
            "text": "已跳过重复加分项：该栏目与分值在本会话或系统中已存在（已通过），不会重复加分。",
        }
    elif (
        not add_items
        and not done
        and SCORE_CLAIM_RE.search(body)
        and not _body_is_zero_or_already_scored(body, sess)
    ):
        # 只有模型既没输出任何结构化加分项（JSON/正文兜底均空）、正文又疑似判出正分
        # 且该判分不是 0 分/已在本会话或系统加过时才提示补录；0 分与重复判定属正常对话
        yield {
            "type": "warning",
            "text": "AI 的回复中出现了加分判定，但未能自动识别为加分项。请检查上一条回答，必要时使用下方「手动添加加分项」补录，或重答一次。",
        }
    yield {
        "type": "done",
        "done": sess["done"],
        "ended": sess.get("ended", False),
        "items": list(sess["items"]),
        "text": None if new_items or not body else "",
    }
