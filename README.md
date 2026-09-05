# 综合奖学金评定网站

上海应用技术大学智能技术学部综合奖学金评定 Demo。

## 功能
- 榜单公开可见，无需登录即可查看排名
- 管理员账号密码登录（admin / admin123），登录后才能修改/导入
- 管理员导入 xlsx 成绩导出（按 重修 > 补考一 > 正常考试 取成绩）
- 自动计算智育成绩 = ∑(成绩×学分)/∑学分（排除通识课与体育课）
- 按 PDF 规则计算各板块分数：德育/美育/劳育默认 70、附加分 0、体育取体育课成绩
- 综合测评成绩 = 德育×15% + 智育×60% + 体育×10% + 美育×5% + 劳育×10% + 附加分（≤5），按总分排名
- 点击德育/美育/劳育/附加分数值可逐人修改，实时重算总成绩并重排榜
- 导出 Excel（.xlsx）
- 加分申报：填学号 + 自然语言描述 + 上传奖状/证书图片或文件，AI（DeepSeek 识图模型 + 联网搜索核实）自动分类为一条或多条加分项（德育/体育/美育/劳育/附加分），生成待审批记录（含证据文件）
- 班委加分：选择班委职务（班长/团支书/辅导员助理 +8、副班长/学习委员 +4、班级其他学干 +2）一键生成德育加分申报
- 加分审批：**公示公开**（任何人可查看依据与证据预览）；仅管理员可审批——通过/驳回，通过后自动给对应学生加分并重排榜；已通过的可**撤回**（撤销已加分数，回到待审批）或**删除**（连同证据，已加分数一并撤销）

## 配置 AI（可选，未配置时申报功能不可用）
编辑 `backend/ai_config.json`：
```json
{
  "base_url": "https://api.deepseek.com",
  "api_key": "",
  "model": "deepseek-v4-flash-vision-exp",
  "search": { "provider": "bing", "api_key": "" }
}
```
- `api_key` 留空时自动读取环境变量 `DEEPSEEK_API_KEY`（DeepSeek 官方 OpenAI 兼容 `/chat/completions` 接口）
- `deepseek-v4-flash-vision-exp` 支持识图；`search.provider` 可选 `bing`（免 key，国内可用）/ `duckduckgo` / `tavily`（需 api_key）
- 定分流程：先联网搜索 + 识图分类出「栏目/赛事/级别」，再把 `backend/pdf_rules.txt`（PDF 评分办法原文，第 3~15 页）完整注入 AI 依据原文表格定分

## 快速开始
1. 首次安装：双击 `setup.bat`（创建虚拟环境、装依赖、构建前端）
2. 启动：双击 `run.bat`，访问 http://127.0.0.1:8000
3. 停止：双击 `stop.bat`

## 手动命令
```powershell
# 后端（必须用虚拟环境）
backend\.venv\Scripts\python.exe backend\main.py

# 前端
npm.cmd install
npm.cmd run build
```

## 技术栈
- 后端：Python + FastAPI + uvicorn + openpyxl（`backend/`）
- 前端：React 18 + Vite（`frontend/`），构建后由后端静态托管

## 数据
- 数据源：`Y3第二学期成绩导出.xlsx`（智育课程成绩）
- 评分办法：`上海应用技术大学智能技术学部本科学生综合奖学金评定办法（试行稿）docx.pdf`
- 运行状态持久化在 `backend/data/state.json`，删除后重启会从根目录 xlsx 重新初始化