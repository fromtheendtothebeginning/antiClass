// pages/AccountsPage.jsx — 纯展示组件：账号管理（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import TextField from "../components/TextField.jsx";
import Modal from "../components/Modal.jsx";

export default function AccountsPage({accounts, classes, manageMsg}) {
  const {
    adminsList, newAdminUser, setNewAdminUser, newAdminPass, setNewAdminPass, newAdminClass, setNewAdminClass,
    deleteAdminTarget, setDeleteAdminTarget, handleCreateAdmin, handleDeleteAdmin,
  } = accounts;
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
                    <strong>{a.username}</strong>
                    <span className="badge">{a.role === "root" ? "超级管理员" : "管理员"}</span>
                    <span>{a.nickname || "（未设昵称）"}</span>
                    <span>{classes.find((c) => c.id === a.class_id)?.name || "全部班级"}</span>
                    {a.role !== "root" && (
                      <button className="btn small danger" onClick={() => setDeleteAdminTarget(a.username)}>删除</button>
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
    </>
  );
}
