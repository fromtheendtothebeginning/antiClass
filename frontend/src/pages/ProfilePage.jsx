// pages/ProfilePage.jsx — 纯展示组件：个人资料（状态与处理在 App/hooks，切界面不丢状态）
import Avatar from "../components/Avatar.jsx";
import TextField from "../components/TextField.jsx";

export default function ProfilePage({profileForm, account, role, myClassId, classes}) {
  const { nickInput, setNickInput, avatarPreview, setAvatarPreview, profileMsg, profileBusy, handlePickAvatar, handleSaveProfile } = profileForm;
  return (
    <>
        {/* 配置 → 个人资料：所有登录账号都能改自己的昵称/头像 */}
          <div className="panel">
            <h2>个人资料</h2>
            <p className="hint">昵称与头像显示在左侧工作台和账号列表里；账号与权限由超级管理员分配。</p>
            {profileMsg && <div className={`ai-msg ${profileMsg.type}`}>{profileMsg.text}</div>}
            <form className="apply-form profile-form" onSubmit={handleSaveProfile}>
              <div className="profile-avatar-row">
                <Avatar avatar={avatarPreview} nickname={nickInput} username={account} size={72} />
                <div className="profile-avatar-actions">
                  <label className="btn small ghost assess-file-btn">
                    选择头像
                    <input type="file" accept="image/*" hidden onChange={(e) => { handlePickAvatar(e.target.files); e.target.value = ""; }} />
                  </label>
                  {avatarPreview && (
                    <button type="button" className="btn small ghost" onClick={() => setAvatarPreview("")}>移除头像</button>
                  )}
                  <span className="file-count">支持 PNG/JPG/WebP/GIF，保存时会自动裁剪压缩</span>
                </div>
              </div>
              <label>昵称（最多 24 个字，留空则显示账号名）</label>
              <TextField value={nickInput} onChange={(e) => setNickInput(e.target.value)} placeholder={account} />
              <label>账号</label>
              <p className="hint">@{account} · {role === "root" ? "超级管理员（可管理全部班级与配置）" : `管理员（负责班级：${classes.find((c) => c.id === myClassId)?.name || "未分配"}）`}</p>
              <button type="submit" className="btn primary-btn" disabled={profileBusy}>
                {profileBusy ? <><span className="spin" /> 保存中…</> : "保存个人资料"}
              </button>
            </form>
          </div>
    </>
  );
}
