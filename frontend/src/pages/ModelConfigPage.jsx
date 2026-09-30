// pages/ModelConfigPage.jsx — 纯展示组件：模型配置（状态与处理在 App/hooks，切界面不丢状态）
import GlassTabs from "../components/GlassTabs.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import TextField from "../components/TextField.jsx";
import { renderMd } from "../utils/markdown.js";

const STAGE_LABELS = {
  stage0: "阶段0 · 提示词优化与下位赛核实",
  stage1: "阶段1 · 加分项分类",
  stage2: "阶段2 · 按评分办法原文定分 *",
  stage3: "阶段3 · AI 定分审查（非审批） *"
};

export default function ModelConfigPage({ai}) {
  const {
    aiMeta, aiForm, setAiForm, aiKey, setAiKey, aiSearchKey, setAiSearchKey, aiPrompts, setAiPrompts, aiModels, aiMsg,
    aiBusy, aiAct, promptViews, setPromptViews, pickProvider, handleAiSave, handleAiTest, handleAiModels,
    handleSavePrompts, handleResetPrompts,
  } = ai;
  return (
    <>
          <div className="panel">
            <h2>模型配置</h2>
            <p className="hint">
              仅超级管理员可见。连接设置与提示词保存后立即生效（无需重启）；API Key 只显示脱敏形式，留空表示保持不变。
            </p>
            {aiMsg && <div className={`ai-msg ${aiMsg.type}`}>{aiMsg.text}</div>}
            {aiMeta && aiPrompts && (
              <>
                <div className="ai-section">
                  <h3>连接</h3>
                  <form className="apply-form" onSubmit={handleAiSave}>
                    <label>提供商</label>
                    <GlassSelect
                      value={aiForm.provider}
                      onChange={pickProvider}
                      options={aiMeta.providers.map((p) => ({ value: p.id, label: p.label }))}
                    />
                    <label>Base URL *</label>
                    <TextField
                      value={aiForm.base_url}
                      onChange={(e) => setAiForm({ ...aiForm, base_url: e.target.value })}
                      placeholder="https://api.deepseek.com"
                    />
                    <label>API Key{aiMeta.config.has_key ? `（已保存 ${aiMeta.config.api_key_masked}，留空保持不变）` : " *"}</label>
                    <input
                      type="password"
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder={aiMeta.config.has_key ? "留空保持现有 Key" : "sk-…"}
                      autoComplete="off"
                    />
                    <label>模型 *（标 ★ 为支持识图，加分申报需识图模型）</label>
                    <TextField
                      list="ai-model-list"
                      value={aiForm.model}
                      onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })}
                      placeholder="deepseek-v4-flash-vision-exp"
                    />
                    <datalist id="ai-model-list">
                      {aiModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    {aiForm.provider !== "custom" && (
                      <span className="file-count">
                        注册表模型：{aiMeta.providers.find((p) => p.id === aiForm.provider).models.map((m) => (m.vision ? `★${m.id}` : m.id)).join("、")}
                      </span>
                    )}
                    <label>联网搜索源</label>
                    <GlassSelect
                      value={aiForm.searchProvider}
                      onChange={(v) => setAiForm({ ...aiForm, searchProvider: v })}
                      options={aiMeta.search_providers.map((s) => ({ value: s, label: s }))}
                    />
                    {aiForm.searchProvider === "tavily" && (
                      <>
                        <label>Tavily API Key{aiMeta.config.search.has_key ? `（已保存 ${aiMeta.config.search.api_key_masked}，留空保持不变）` : ""}</label>
                        <input
                          type="password"
                          value={aiSearchKey}
                          onChange={(e) => setAiSearchKey(e.target.value)}
                          autoComplete="off"
                        />
                      </>
                    )}
                    <div className="ai-actions">
                      <button type="submit" className="btn primary-btn" disabled={aiBusy}>
                        {aiAct === "save" && <span className="spin" />}保存连接设置
                      </button>
                      <button type="button" className="btn" disabled={aiBusy} onClick={handleAiTest}>
                        {aiAct === "test" && <span className="spin" />}测试连接
                      </button>
                      <button type="button" className="btn ghost" disabled={aiBusy} onClick={handleAiModels}>
                        {aiAct === "models" && <span className="spin" />}获取模型列表
                      </button>
                    </div>
                  </form>
                </div>
                <div className="ai-section">
                  <h3>提示词（AI 定分管线四阶段）</h3>
                  <p className="hint">
                    系统会在每个提示词末尾自动附加「不可信内容警示」防提示词注入，无需自行添加；带 * 的占位符为运行时注入变量，不可删除。
                  </p>
                  {["stage0", "stage1", "stage2", "stage3"].map((stage) => (
                    <div key={stage} className="prompt-block">
                      <label>
                        {STAGE_LABELS[stage]}
                        {aiMeta.placeholders[stage].length > 0 && (
                          <em className="file-count">　必需占位符：{aiMeta.placeholders[stage].join(" ")}</em>
                        )}
                      </label>
                      <GlassTabs
                        className="type-tabs md-toggle"
                        value={promptViews[stage] !== "preview" ? "edit" : "preview"}
                        onChange={(v) => setPromptViews((s) => ({ ...s, [stage]: v }))}
                        options={[
                          { value: "edit", label: "编辑" },
                          { value: "preview", label: "预览" }
                        ]}
                      />
                      {promptViews[stage] === "preview" ? (
                        <div
                          className="markdown-body"
                          dangerouslySetInnerHTML={{ __html: renderMd(aiPrompts[stage]) }}
                        />
                      ) : (
                        <TextField
                          multiline
                          className="mono"
                          rows={stage === "stage2" || stage === "stage3" ? 14 : 10}
                          value={aiPrompts[stage]}
                          onChange={(e) => setAiPrompts({ ...aiPrompts, [stage]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                  <div className="ai-actions">
                    <button className="btn primary-btn" disabled={aiBusy} onClick={handleSavePrompts}>
                      {aiAct === "prompts" && <span className="spin" />}保存提示词
                    </button>
                    <button className="btn ghost" disabled={aiBusy} onClick={handleResetPrompts}>
                      {aiAct === "reset" && <span className="spin" />}恢复默认提示词
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
    </>
  );
}
