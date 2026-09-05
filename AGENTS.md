# AGENTS.md

上海应用技术大学智能技术学部综合奖学金评定网站项目。

## 技术栈与运行（重要）
- 后端：Python 3.14 + FastAPI + uvicorn + openpyxl，代码在 `backend/main.py`，**必须使用虚拟环境** `backend/.venv`（用 `backend\.venv\Scripts\python.exe` / `pythonw.exe`，不要用全局 python）。
- 前端：React 18 + Vite，代码在 `frontend/`，构建产物 `frontend/dist` 由 FastAPI 静态托管，**只启动后端一个进程即可访问整个网站**（http://127.0.0.1:8000）。
- **前端设计体系**：样式仿照 `D:\anticraft\index`（anticraft 首页）——CSS 变量主题（紫 `#6c5ce7`/青 `#00cec9`，支持明暗模式）、渐变按钮、`Modal`/`Reveal` 组件（`frontend/src/components/`）、滚动揭示动画、背景网格+光晕。改样式先对齐该设计体系。
- 一键操作：`setup.bat`（首次：建 venv + 装依赖 + 构建前端）、`run.bat`（启动）、`stop.bat`（停止）。
- 手动命令：后端 `backend\.venv\Scripts\python.exe backend\main.py`；前端 `npm.cmd install` / `npm.cmd run build`（**必须用 npm.cmd**，npm 脚本被 ExecutionPolicy 禁用）。
- 运行后端进程在 pythonw（无控制台）下会因 sys.stdout/stderr 为 None 而崩溃退出，main.py 已做兼容（重定向到 backend/server.log）；改后端代码时勿删该处理。
- pip 全局配置指向清华镜像（对部分包/新 Python 版本返回空），安装失败时改用 `-i https://mirrors.aliyun.com/pypi/simple/`。
- 默认管理员账号：admin / admin123（`backend/main.py`，可用环境变量 `ADMIN_PASSWORD` 覆盖）。登录限速 5 次/分钟/IP。token 存内存、**12 小时过期**、登出即失效，前端存 localStorage。
- 安全基线（2026-09 安全审计后固化，勿回退）：证据下载强制 `Content-Disposition: attachment` + 扩展名 Content-Type 白名单 + nosniff；公开上传接口限单文件 10MB、最多 5 个、text ≤2000 字、analyze/class-committee 每 IP 每小时 10 次；数据库凭据在 `backend/db_config.json`（gitignore），勿提交。
- **榜单公开可见**（`GET /api/leaderboard`、`GET /api/export` 无需登录）；仅管理员可修改（上传 xlsx 需 Bearer token）。前端未登录只显示榜单（可切班），登录后显示导入/调分/管理入口。
- **按班「清除数据」**（`POST /api/classes/{cid}/clear`，仅 role=root）：清空该班 students + awards + adjust_log 与 meta、删除该班上传证据文件与 folder，其他班级不受影响（前端班级管理确认弹窗已注明）。全局 `/api/exit` 已废弃删除，勿回退为全局清空。
- **存储用 MySQL**（2026-09 起，**运行时不使用任何 JSON 文件**）：`backend/db.py` 存储层，六张表：`classes`、`admins`、`students`（复合主键 class_id+sid）、`awards`（evidence 存 JSON 列，带 class_id）、`adjust_log`（自增 id）、`meta`+`settings`（k/v：AI 配置 `ai_config`、提示词覆盖 `ai_prompts`）。连接配置读 `backend/db_config.json`（gitignore，模板 `db_config.example.json`——仅数据库引导凭据用文件，环境变量 MYSQL_HOST/PORT/USER/PASSWORD/DB 可覆盖），默认库 `scholarship`（utf8mb4）。启动时自动建库建表（含 class_id 列与复合主键迁移）、把遗留 JSON 迁入后删除；班级空则创建 251184Y3 并归入全部存量学生，榜单空且根目录 xlsx 存在则重新初始化。排名实时按班计算（ORDER BY total/score/gpa/sid），多步写操作走 `db.tx()` 事务。上传证据仍是 `backend/data/uploads/` 文件。
- 管理员调分走「加分申报 → 分数调整」表单：`POST /api/scores/adjust`（`{sids,field,op,points}`，op 限 add/sub/set，sids 支持精确学号+正则 fullmatch 混合，写入 adjust_log 留痕）；榜单只读，`PUT /api/students/{sid}/scores` 已删除。
- **多班级 + 超级管理员(root)/管理员账号体系**（2026-09）：`classes` 表（每班一张榜单，含 row_count/source 元数据）、`admins` 表（salted sha256 密码，role=root/admin）。**权限一律按 `role` 判断，不依赖固定用户名**——超级管理员可改名（如线上已改名 end），删除/重置密码守卫按 role；播种在“无 role=root 账号”时才创建 `root`（密码环境变量 `ROOT_PASSWORD`，默认 `root123`，仅对全新库生效），因此改名后重启不会复活 root 后门。role=root 可管理全部班级；admin 绑定一个班级，只能看/改本班榜单、审批本班申报、调本班分数（`check_class_scope` 服务端强制）。账号管理/班级管理/AI 设置/按班清除数据仅 role=root。students 主键为 (class_id, sid)。`GET /api/leaderboard?class_id=`、`GET /api/awards?class_id=`、`GET /api/export?class_id=` 按班过滤；`GET /api/classes` 公开。
- 端口 8000；启动前先 `netstat -ano | findstr ":8000"` 检查残留进程。

## 业务规则（核心，勿随意改动）
- 数据源 `Y3第二学期成绩导出.xlsx`：Sheet `sheet1`，第 1 行表头，524 行（523 条课程记录）、40 名学生、班级 251184Y3、学年 2025-2026 学期 2。35 列。
- 智育 = ∑(成绩×学分)/∑学分；**排除**：课程类别=通识课、课程名称含"体育"（体育课类别是公共基础课，必须按名称匹配）、成绩作废=是。
- 同课程多行（考试性质）取值优先级：**重修 > 补考一 > 正常考试**，同优先级取成绩最高者（`backend/main.py` 的 `EXAM_PRIORITY`）。
- 旷考成绩记 0。榜单按 综合测评成绩降序 → 智育降序 → 绩点降序 → 学号升序，rank 从 1 起。
- 综合测评成绩 = 德育×15% + 智育×60% + 体育×10% + 美育×5% + 劳育×10% + 附加分(≤5)（`calc_total`）。
- 德育/美育/劳育**默认 70**（PDF 基础分）、附加分**默认 0**、体育 = 体育课成绩平均（无体育课按 60，PDF 规定），这些默认值存于榜单数据（MySQL students 表）。**榜单只读**，管理员通过「加分申报 → 分数调整」表单批量调整（支持正则选人，adjust_log 留痕）；加分仍走申报/审批流程。

## 加分申报/审批（AI 分类）
- 申报流程：任何人填学号+自然语言描述+上传证据文件 → `POST /api/awards/analyze`（公开，生成 AI 草稿）→ 本人审核后 `POST /api/awards/submit` → 待审批记录存 MySQL `awards` 表。证据原文件存 `backend/data/uploads/{folder}/`。
- AI 配置存 MySQL `settings` 表（`ai_config` 键：provider/base_url/api_key/model/search），在「AI 设置」界面管理；`api_key` 留空时自动用环境变量 `DEEPSEEK_API_KEY`；默认模型 `deepseek-v4-flash-vision-exp`（DeepSeek 识图模型）。**未配置时 analyze 返回 400**。
- **AI 定分管线四阶段**（`backend/ai.py`，全部 system prompt 含「不可信内容警示」防提示词注入，用户文本用【申报原文开始/结束】包裹，默认提示词为 Markdown 格式）：**阶段0** 提示词优化+下位赛/别称核实（`optimize_prompt`，联网搜索注入，输出优化描述/sub_event 下位赛/alias 别称/补充搜索词；如 CCPC 是 ICPC 下位赛、「TI 杯」「电赛」是全国大学生电子设计竞赛别称——别称归一规范全称且不降级，下位赛强制降档）；**阶段1** 分类+证据图片编号归属；**阶段2** 按 PDF 原文逐项定分（`_score_one`，下位赛/别称提示经 `__SUB_NOTE__` 注入）；**阶段3** AI 审查（非审批，`_review`：核对算错分并修正、发现漏分项补跑阶段2定分，结论存 item.review 前端展示）。任一阶段 JSON 解析失败都安全回退（原文/跳过），审查失败不阻塞出稿。
- **两阶段定分**（`backend/ai.py`）：①先用联网搜索+识图把申报分类并提取「栏目/赛事/级别」（不喂规则）；②再按分类把 **PDF 评分办法原文**（`backend/pdf_rules.txt`，从 PDF 第 3~15 页提取，含细则加分表与附录1竞赛目录）完整注入 prompt，让 AI 依据原文表格定分。**禁止用阉割/摘要版规则 prompt**。改动定分规则时只需重新生成 pdf_rules.txt。
- **联网搜索**：分类阶段用 `search.provider` 联网搜索申报内容并注入 prompt（供 AI 核实赛事名称/级别）。provider 支持 `bing`（默认，免 key，RSS 解析）/ `duckduckgo`（国内不可达）/ `tavily`（需 key）；实测 Bing 可显著提升定分准确率。搜索源可在 AI 设置界面切换。
- **AI 设置管理界面**（管理员「AI 设置」Tab，参考 anticraft/index 的 aisettings.py 模式）：`backend/ai_settings.py` 提供商注册表（deepseek/opencode-go/kimi/glm/qwen/custom，OpenAI 兼容，标注 vision 识图模型）+ Key 脱敏（`mask_key`）+ 连通性测试（`test_chat`，浏览器 UA 绕 Cloudflare）+ GET /models 拉模型列表（失败回退注册表）。端点：`GET/POST /api/ai/settings`（读写 settings 表，api_key 留空=保持现有）、`POST /api/ai/test`、`POST /api/ai/models`、`POST /api/ai/prompts`（校验必需占位符，存 settings 表 `ai_prompts` 键）、`POST /api/ai/prompts/reset`。提示词默认值在 `ai.py` 的 `PROMPT_DEFAULTS`，`get_prompts()` 合并覆盖；「不可信内容警示」由 `_system()` 强制附加在所有阶段 prompt 末尾，自定义提示词无法移除。
- 审批：**申报列表与证据公开可见**（`GET /api/awards`、`GET /api/awards/{id}/evidence/{file}` 无需登录）；`POST /api/awards/{id}/approve`、`reject`、`withdraw`（撤回，撤销已加分并回到待审批）、`delete`（删除记录+证据，若已通过则一并撤销加分）均需 Bearer token。通过时可传 `{points,category}` 覆盖 AI 定分；通过后按 `CATEGORY_FIELD`（德育→deyu…附加分→fujia）累加并**封顶**（板块 100/附加分 5），重算 total 重排榜；同一记录不可重复审批。
- **加分一遍过**（2026-09，`backend/assess.py`）：AI 依据评分办法原文**逐项提问**、学生逐项回答的对话小程序，全程**流式输出**（SSE，`ai.stream_chat`；响应带 `X-Accel-Buffering: no` + 服务器 nginx `proxy_buffering off` 保证逐字到达）。入口在顶部 Tab「加分一遍过」独立页，需先介绍+确认（学号+开始）；每轮 AI 回复以 `==JSON== {...}` 尾行上报新加分项（category/points/basis，后端去重+封顶钳制）与 `done` 结束标记；忽略 JSON 或解析失败时安全降级为纯对话。规则要点：**固定回复模板**（【要点】复述→【判定】引原文判分并同步进 add→【下一问】接着问下一项，判完加分不得停）；快捷词义 没有/确认/继续（无/有/推进下一项）；栏目归属 AI 自查原文严禁反问；涉及后续栏目的内容先记录、到该栏目统一核定；小节问完自动过渡；班级活动出勤/第二课堂/智育/班委**静默跳过不出现**；**只读注入该生系统已有申报（approved=是）**→ 命中项不再询问且 add 上报按栏目+分值硬去重拒绝（发 warning 防重复加分）。正文有加分判定但 add 漏报 → warning 提示可用**手动添加加分项**补录。**done 后允许一次补充对话**，补充轮结束会话（ended），ended 后再发消息返回 400。加分项可编辑（栏目/分值/依据/删除）并在提交时按条上传证据（multipart `items` JSON + `file_{i}`）。前端：AI 气泡 Markdown 渲染、聊天窗高度固定自动滚底、快捷按钮 没有/确认/继续、按条证据。端点：`POST /api/assess/start`（Form sid，10 次/时/IP，返回 existing 只读清单）、`/{id}/message`（SSE，30 次/10 分/IP）、`/finish`、`/submit`（公开，10 次/时/IP）。会话存内存（上限 100、TTL 1h），重启即失。
- **班委加分**：`POST /api/awards/class-committee`（公开）multipart `sid`+`role`+`files[]`（可选证据）→ 生成 德育 待审批记录。role 限 `CLASS_ROLE_POINTS`（班长/团支书/辅导员助理 8、副班长/学习委员 4、班级其他学干 2）。前端「加分申报」Tab 有班委快捷表单。

## 源数据文件
- `Y3第二学期成绩导出.xlsx` — 学生成绩导出（智育数据源）。
- `上海应用技术大学智能技术学部本科学生综合奖学金评定办法（试行稿）docx.pdf` — 评分规则唯一依据（15 页，含加分表与竞赛目录附录）。

## 成绩导出.xlsx 列结构（35 列，按序，0 起索引）
班级(0) 学号(1) 课程代码(2) 成绩(3) 姓名(4) 学生类别(5) 课程名称(6) 学年(7) 学期(8) 学院(9) 专业(10) 年级(11) 学生标记(12) 开课学院(13) 教学班(14) 任课教师(15) 学分(16) 成绩备注(17) 考试性质(18) 绩点(19) 课程标记(20) 课程类别(21) 课程归属(22) 课程性质(23) 考核方式(24) 是否成绩作废(25) 提交人(26) 提交时间(27) 是否学位课程(28) 性别(29) 专业方向(30) 课程英文名称(31) 学分绩点(32) 备注信息(33) 开课类型(34)

智育计算关键列：学号(1)、姓名(4)、成绩(3)、课程名称(6)、学分(16)、成绩备注(17)、考试性质(18)、绩点(19)、课程类别(21)、是否成绩作废(25)。

## API 契约
- `POST /api/login` `{"username","password"}` → `{"token"}`（限速 5 次/分钟/IP）；`POST /api/logout` + Bearer token 使 token 失效
- `POST /api/upload` multipart 字段 `file` + `Authorization: Bearer <token>`（无/错 token 返回 401）
- `GET /api/leaderboard` → `{"students":[{rank,sid,name,course_count,credits,gpa,deyu,score,tiyu,meiyu,laoyu,fujia,total}], "meta":{rows,source}}`（score 即智育，total 即综合测评成绩）。**榜单只读，不再支持点击改分**
- `POST /api/scores/adjust` + Bearer token `{"sids","field","op","points"}` → `{"changed":[{sid,name,field,old,new,total}]}`（管理员批量调整分数表单：field 限 deyu/meiyu/laoyu/fujia，op 限 add/sub/set，数值按板块封顶 100/附加 5；sids 逗号/空格分隔，每项先精确匹配学号、否则按正则 fullmatch，任一项匹配不到整体 400；每次调整写入 MySQL `adjust_log` 表留痕）
- `GET /api/export` → Excel(.xlsx，openpyxl 生成，13 列：排名,学号,姓名,课程数,总学分,平均学分绩点,德育,智育,体育,美育,劳育,附加分,综合测评成绩)
- `POST /api/awards/analyze`（公开）multipart `sid`+`text`+`files[]` → `{"draft_id","sid","name","items":[{category,points,basis,evidence}]}`（AI 分类生成**草稿**，不直接入库；未配 AI/学号不存在/未识别出加分项返回 400）。stage1 AI 会为每个加分项输出 `images`（1 起始的图片编号列表），后端据此把证据图片**按加分项分配**；AI 未给 images 时回退全部图片，非图片文件每条都带。草稿存内存 `DRAFTS`（重启即失，上限 200 个）。
- `POST /api/awards/manual`（公开，10 次/小时/IP）multipart `sid`+`category`+`points`+`basis`+`files[]` → `{"created":[...]}`（传统表单申报，不经 AI，直接生成待审批记录；basis 必填 ≤2000 字，分值按栏目封顶）。
- `POST /api/awards/submit`（公开）`{"submissions":[{draft_id, items:[{category,points,basis,evidence}]}]}` → `{"created":[...]}`（本人审核草稿后提交，支持一键提交多份草稿；evidence 会按草稿校验白名单；提交后草稿删除）。
- `GET /api/awards`（公开）→ `{"awards":[...]}`；`GET /api/awards/{id}/evidence/{file}`（公开）下载/预览证据；`POST /api/awards/{id}/approve` body 可带 `{points,category}`；`POST /api/awards/{id}/reject`；`POST /api/awards/{id}/withdraw`（撤回，撤销加分回待审批）；`POST /api/awards/{id}/delete`（删除，若已通过一并撤销加分）；`POST /api/awards/class-committee`（公开）`sid`+`role` 生成班委德育加分
- 其余路径由 `frontend/dist` 静态托管（未构建返回 404）

## 已知未定义（实现前需与用户确认，勿臆测）
- 德育/美育/劳育/附加分无源数据，当前按 PDF 基础分默认（70/70/70/0）并支持管理员逐人手动修改；是否改为批量录入待定。
- 榜单是否按获奖比例（一等 ≤3%、二等 ≤7%、三等 ≤20%，同分智育高者优先）划分等级需确认。
- 板块加分目前仅"累加 + 板块封顶"，未实现 PDF 中各加分小项的细粒度累计上限（如"累计不超10分"）与"不重复加分"去重。

## PDF 读取（重要）
- 当前模型无法直接读取 PDF；用 `python -c "import fitz; doc=fitz.open('...'); print(page.get_text())"` 提取（fitz/pypdf 均已装），或用 `vision-reader` skill。
- 评分细节、加分表、竞赛目录全部在 PDF 中；改动评分逻辑前先重新提取对照原文，勿凭记忆实现。

## 环境与工具（Windows）
- Shell 为 PowerShell 5.1；npm 脚本被 ExecutionPolicy 禁用，需用 `npm.cmd`。
- 全局 python 3.14 未装 fastapi/uvicorn/openpyxl；一律用 `backend/.venv`。