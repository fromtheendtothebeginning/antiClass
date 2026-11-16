// pages/McpTokenPage.jsx — 申报 MCP 专属 token：各班管理员生成/发放、查看、撤销
import { useState } from "react";
import Dropdown from "../components/Dropdown.jsx";
import TextField from "../components/TextField.jsx";
import Modal from "../components/Modal.jsx";

// CC Switch 深度链接支持的应用（ccswitch:// 文档列出的 app id）
const CCSWITCH_APPS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "opencode", label: "OpenCode" },
  { value: "pi", label: "Pi" },
  { value: "mcode", label: "MiniMax Code" },
  { value: "agy", label: "Agy" },
  { value: "grokbuild", label: "Grok Build" },
  { value: "hermes", label: "Hermes" },
];

function buildCcConfig(token) {
  return JSON.stringify({
    mcpServers: {
      "anticlass-apply": {
        type: "http",
        url: `${window.location.origin}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
}

function buildCcSwitchLink(token, app) {
  // 深度链接要求 config 为 {"mcpServers": {...}} 的 Base64（再做 URL 转义）
  const b64 = btoa(buildCcConfig(token));
  return `ccswitch://v1/import?resource=mcp&apps=${encodeURIComponent(app)}&config=${encodeURIComponent(b64)}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function McpTokenPage({ mcpTokens, classes, role, myClassId }) {
  const {
    tokens, label, setLabel, classId, setClassId, busy, msg, created, setCreated,
    revokeTarget, setRevokeTarget, copied, copyText, load, handleCreate, handleRevoke,
  } = mcpTokens;
  const myClassName = classes.find((c) => c.id === myClassId)?.name;
  const [ccApp, setCcApp] = useState("claude");

  return (
    <>
      <div className="panel">
        <h2>MCP Token</h2>
        <p className="hint">
          外部 MCP 客户端使用专属 token 调用申报接口。token 绑定班级后，只能为该班学生提交申报；
          明文只显示一次，请妥善保存，泄露后立即撤销。一遍过聊天内部不走这个 token。
        </p>
        {msg && <div className={`ai-msg ${msg.type}`}>{msg.text}</div>}

        <div className="ai-section">
          <h3>生成 Token</h3>
          <form className="apply-form" onSubmit={handleCreate}>
            <label>用途备注（可选）</label>
            <TextField
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：DSH、班级智能体、外部申报工具"
              maxLength={64}
            />
            <label>绑定班级 *</label>
            {role === "root" ? (
              <Dropdown
                value={classId}
                onChange={setClassId}
                options={classes.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="选择班级"
              />
            ) : (
              <p className="hint">绑定本班：{myClassName || "（未分配班级，请联系 root）"}</p>
            )}
            <button type="submit" className="btn primary-btn" disabled={busy || !classId}>
              {busy ? "生成中…" : "生成 Token"}
            </button>
          </form>
          <p className="hint">token 撤销后立即失效；同一班级可以发放多个 token（按客户端/用途区分）。</p>
        </div>

        <div className="ai-section">
          <div className="assess-edit-head">
            <h3>已发放 Token</h3>
            <button type="button" className="btn small ghost" onClick={() => load()}>刷新</button>
          </div>
          <div className="manage-list">
            {tokens.map((t) => (
              <div key={t.id} className="result-item">
                <div className="ri-head">
                  <code className="mcp-token-prefix">{t.token_prefix}…</code>
                  <span className={`badge ${t.revoked ? "rejected" : "approved"}`}>
                    {t.revoked ? "已撤销" : "有效"}
                  </span>
                </div>
                <span className="ri-sub">{t.label || "（未备注）"}</span>
                <span className="ri-sub">{t.class_name || "（班级已删除）"}</span>
                <span className="ri-sub">生成：{t.created_by || "—"} · {fmtTime(t.created_at)}</span>
                <span className="ri-sub">
                  最近使用：{t.last_used_at ? fmtTime(t.last_used_at) : "从未使用"}
                </span>
                {!t.revoked && (
                  <div className="ri-actions">
                    <button type="button" className="btn small danger" onClick={() => setRevokeTarget(t)}>
                      撤销
                    </button>
                  </div>
                )}
              </div>
            ))}
            {tokens.length === 0 && <p className="hint">还没有发放 token。</p>}
          </div>
        </div>
      </div>

      <Modal
        open={!!created}
        size="lg"
        sheetClass="token-created-sheet"
        title="MCP Token 已生成"
        showConfirm={false}
        cancelText="我已保存"
        onCancel={() => setCreated(null)}
      >
        {created && (
          <div className="token-created">
            <div className="token-created-banner">
              <span className="token-created-check" aria-hidden="true">✓</span>
              <div>
                <strong>请立即保存 Token</strong>
                <p>完整 token 只显示这一次；关闭后只能看到前缀，丢失请撤销后重新生成。</p>
              </div>
            </div>

            <div className="token-created-grid">
              <section className="token-created-card">
                <div className="token-created-label">
                  <span>专属 MCP Token</span>
                  <span className="badge pending">仅显示一次</span>
                </div>
                <code className="mcp-token-value">{created.token}</code>
                <div className="token-created-actions">
                  <button
                    type="button"
                    className="btn primary-btn"
                    onClick={() => copyText(created.token)}
                  >
                    {copied === created.token ? "已复制 Token" : "复制 Token"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => copyText(buildCcConfig(created.token))}
                  >
                    {copied === buildCcConfig(created.token) ? "已复制配置" : "复制 MCP 配置"}
                  </button>
                </div>
                <dl className="token-created-meta">
                  <div>
                    <dt>MCP 端点</dt>
                    <dd>{window.location.origin}/mcp</dd>
                  </div>
                  <div>
                    <dt>绑定班级</dt>
                    <dd>{created.item.class_name || created.item.class_id}</dd>
                  </div>
                  <div>
                    <dt>用途备注</dt>
                    <dd>{created.item.label || "（无）"}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{fmtTime(created.item.created_at)}</dd>
                  </div>
                </dl>
              </section>

              <section className="token-created-card">
                <div className="token-created-label">
                  <span>导入 CC Switch</span>
                  <span className="hint">一步添加 MCP 服务器</span>
                </div>
                <p className="hint">选择要写入的应用，点击后到 CC Switch 确认。</p>
                <Dropdown
                  value={ccApp}
                  onChange={setCcApp}
                  options={CCSWITCH_APPS}
                  placeholder="选择应用"
                />
                <button
                  type="button"
                  className="btn primary-btn token-import-btn"
                  onClick={() => {
                    window.location.href = buildCcSwitchLink(created.token, ccApp);
                  }}
                >
                  一键导入 CC Switch
                </button>
                <p className="hint">
                  若系统未注册 ccswitch://，用左侧「复制 MCP 配置」在 CC Switch → MCP → 导入
                  中粘贴。
                </p>
                <ol className="token-steps">
                  <li>复制 token 或一键导入</li>
                  <li>在 CC Switch 中确认</li>
                  <li>外部客户端即可调用 /mcp</li>
                </ol>
              </section>
            </div>

            <p className="token-security">
              token 等同于本班申报权限，请勿发到群聊或公开截图；泄露后立即在下方「已发放 Token」
              列表撤销。
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={!!revokeTarget}
        title="撤销 MCP Token"
        danger
        confirmText="撤销"
        confirmDisabled={busy}
        message={`确认撤销 token ${revokeTarget ? `${revokeTarget.token_prefix}…` : ""}（${revokeTarget ? revokeTarget.class_name : ""}）？撤销后使用该 token 的外部客户端会立即收到 401。`}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
