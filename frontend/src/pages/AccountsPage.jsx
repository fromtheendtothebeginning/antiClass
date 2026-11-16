// pages/AccountsPage.jsx — 纯展示组件：账号管理（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import TextField from "../components/TextField.jsx";
import Modal from "../components/Modal.jsx";

const INVITE_STATUS = { unused: "待使用", used: "已使用", revoked: "已撤销" };
const INVITE_BADGE = { unused: "pending", used: "approved", revoked: "rejected" };

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function AccountsPage({accounts, classes, manageMsg}) {
  const {
    adminsList, newAdminUser, setNewAdminUser, newAdminPass, setNewAdminPass, newAdminClass, setNewAdminClass,
    deleteAdminTarget, setDeleteAdminTarget, handleCreateAdmin, handleDeleteAdmin,
    invitesList, inviteClassId, setInviteClassId, inviteBusy, inviteMsg, revokeTarget, setRevokeTarget,
    copiedCode, copyCode, handleCreateInvite, handleRevokeInvite,
  } = accounts;

  const mcpEndpoint = `${window.location.origin}/mcp`;
  const mcpConfig = JSON.stringify(
    {
      transport: "streamable-http",
      serverName: "anticlass-apply",
      url: mcpEndpoint,
      headers: { Authorization: "Bearer <专属 MCP token>" },
    },
    null,
    2
  );
  const mcpToolExample = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "submit_application",
    "arguments": {
      "sid": "251184Y330",
      "items": [
        { "category": "德育", "points": 2, "basis": "担任班级职务满六个月" }
      ]
    }
  }
}`;
  const mcpResultExample = `{
  "content": [{ "type": "text", "text": "已提交 1 条待审批申报（德育+2），等待管理员审批。" }],
  "structuredContent": {
    "ok": true,
    "created": 1,
    "skipped": 0,
    "ids": ["<申报记录 id>"],
    "items": [{ "category": "德育", "points": 2, "basis": "担任班级职务满六个月", "evidence": 0 }],
    "sid": "251184Y330",
    "name": "杨帅",
    "class_name": "251184Y3",
    "semester": "大一下",
    "message": "已提交 1 条待审批申报（德育+2），等待管理员审批。"
  },
  "isError": false
}`;
  return (
    <>
        {/* 配置 → 账号管理（root）：新增管理员账号、查看/删除现有账号 */}
          <div className="panel">
            <h2>账号管理</h2>
            <p className="hint">每个管理员只能管理其负责班级的榜单、申报审批与分数调整；昵称与头像由各账号在「个人资料」里自行设置。</p>
            {manageMsg && <div className={`ai-msg ${manageMsg.type}`}>{manageMsg.text}</div>}
            <div className="ai-section">
              <h3>管理员账号</h3>
              <div className="manage-list">
                {adminsList.map((a) => (
                  <div key={a.username} className="result-item">
                    <div className="ri-head">
                      <strong>{a.username}</strong>
                      <span className="badge">{a.role === "root" ? "超级管理员" : "管理员"}</span>
                    </div>
                    <span className="ri-sub">{a.nickname || "（未设昵称）"}</span>
                    <span className="ri-sub">{classes.find((c) => c.id === a.class_id)?.name || "全部班级"}</span>
                    {a.role !== "root" && (
                      <div className="ri-actions">
                        <button className="btn small danger" onClick={() => setDeleteAdminTarget(a.username)}>删除</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <form className="apply-form" onSubmit={handleCreateAdmin}>
                <label>用户名 *</label>
                <TextField value={newAdminUser} onChange={(e) => setNewAdminUser(e.target.value)} placeholder="3-32 位字母/数字/下划线" />
                <label>初始密码 *</label>
                <input type="password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} placeholder="至少 6 位" autoComplete="off" />
                <label>负责班级 *</label>
                <Dropdown
                  value={newAdminClass}
                  onChange={setNewAdminClass}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="请选择班级"
                />
                <button type="submit" className="btn primary-btn">创建管理员</button>
              </form>
            </div>

            <div className="ai-section">
              <h3>邀请码</h3>
              <p className="hint">
                生成绑定班级的一次性邀请码，发给该班管理员：对方在登录窗口点「有邀请码？注册管理员」即可自助注册，
                注册成功后码立即失效。已使用/已撤销的码保留在下方作为记录。
              </p>
              {inviteMsg && <div className={`ai-msg ${inviteMsg.type}`}>{inviteMsg.text}</div>}
              <form className="invite-create" onSubmit={handleCreateInvite}>
                <Dropdown
                  value={inviteClassId}
                  onChange={setInviteClassId}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择邀请码对应班级"
                />
                <button type="submit" className="btn primary-btn" disabled={inviteBusy || !inviteClassId}>
                  {inviteBusy ? "生成中…" : "生成邀请码"}
                </button>
              </form>
              <div className="manage-list">
                {invitesList.map((inv) => (
                  <div key={inv.id} className="result-item">
                    <div className="ri-head">
                      <code className="invite-code">{inv.code}</code>
                      <span className={`badge ${INVITE_BADGE[inv.status] || ""}`}>{INVITE_STATUS[inv.status] || inv.status}</span>
                      <button type="button" className="btn small ghost" onClick={() => copyCode(inv.code)}>
                        {copiedCode === inv.code ? "已复制" : "复制"}
                      </button>
                    </div>
                    <span className="ri-sub">{inv.class_name || "（班级已删除）"}</span>
                    <span className="ri-sub">生成：{inv.created_by || "—"} · {fmtTime(inv.created_at)}</span>
                    {inv.used_by && <span className="ri-sub">使用：{inv.used_by} · {fmtTime(inv.used_at)}</span>}
                    {inv.status === "unused" && (
                      <div className="ri-actions">
                        <button className="btn small danger" onClick={() => setRevokeTarget(inv)}>撤销</button>
                      </div>
                    )}
                  </div>
                ))}
                {invitesList.length === 0 && <p className="hint">暂无邀请码。</p>}
              </div>
            </div>

            <div className="ai-section">
              <h3>申报 MCP</h3>
              <p className="hint">
                一遍过聊天内部由工作流调用同一工具（AI 生成工单 → stage 放入暂存队列，学生点提交 → submit）；
                外部 MCP 客户端固定走提交，使用各班管理员在「配置 → MCP Token」生成的专属 token。
                服务端<strong>只暴露一个工具</strong>，不能调用其他工具。
              </p>
              <div className="mcp-spec">
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">端点</span>
                  <code className="mcp-endpoint">{mcpEndpoint}</code>
                  <button type="button" className="btn small ghost" onClick={() => copyCode(mcpEndpoint)}>
                    {copiedCode === mcpEndpoint ? "已复制" : "复制"}
                  </button>
                </div>
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">传输</span>
                  <span>Streamable HTTP（JSON-RPC 2.0；POST /mcp，GET 回 405）</span>
                </div>
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">鉴权</span>
                  <span>
                    <code>Authorization: Bearer &lt;专属 MCP token&gt;</code>
                    （各班管理员在「配置 → MCP Token」生成/发放，token 绑定班级）
                  </span>
                </div>
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">工具</span>
                  <span><code>submit_application</code>（title「申报 MCP」，唯一工具）</span>
                </div>
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">外部</span>
                  <span>固定提交：提交到当前开放申报学期，生成待审批记录；同栏目+分值+依据已存在时自动跳过</span>
                </div>
                <div className="mcp-spec-row">
                  <span className="mcp-spec-key">内部</span>
                  <span>一遍过：AI 生成加分项时调用 stage 放入暂存队列；学生点「提交审批」时调用 submit 生成待审批（不依赖模型 function calling）</span>
                </div>
              </div>

              <details className="mcp-doc">
                <summary>工具入参与返回示例</summary>
                <div className="mcp-doc-body">
                  <p className="hint">调用（外部客户端需带 sid；一遍过聊天内部由系统注入 sid 与当前加分项列表）：</p>
                  <pre className="mcp-pre">{mcpToolExample}</pre>
                  <p className="hint">返回（content 文本 + structuredContent）：</p>
                  <pre className="mcp-pre">{mcpResultExample}</pre>
                </div>
              </details>

              <details className="mcp-doc">
                <summary>MCP 客户端配置示例（DeepSeek Harness mcp-client 字段）</summary>
                <div className="mcp-doc-body">
                  <pre className="mcp-pre">{mcpConfig}</pre>
                  <div className="mcp-doc-actions">
                    <button type="button" className="btn small ghost" onClick={() => copyCode(mcpConfig)}>
                      {copiedCode === mcpConfig ? "已复制" : "复制配置"}
                    </button>
                  </div>
                  <p className="hint">
                    token 获取：<code>配置 → MCP Token</code>（各班管理员生成/发放，token 绑定班级，只能为该班学生提交）。
                    其他 MCP 客户端把 URL 和 Bearer 头填到对应位置即可。
                  </p>
                </div>
              </details>
            </div>
          </div>
      <Modal
        open={!!deleteAdminTarget}
        title="删除管理员账号"
        message={`确认删除管理员账号 ${deleteAdminTarget || ""}？删除后该账号立即失效（已登录的会话也会被一并登出），不可恢复。`}
        danger
        confirmText="删除"
        onConfirm={() => { const name = deleteAdminTarget; setDeleteAdminTarget(null); handleDeleteAdmin(name); }}
        onCancel={() => setDeleteAdminTarget(null)}
      />
      <Modal
        open={!!revokeTarget}
        title="撤销邀请码"
        message={`确认撤销邀请码 ${revokeTarget ? revokeTarget.code : ""}（${revokeTarget ? revokeTarget.class_name : ""}）？撤销后该码不能再用于注册。`}
        danger
        confirmText="撤销"
        confirmDisabled={inviteBusy}
        onConfirm={handleRevokeInvite}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
