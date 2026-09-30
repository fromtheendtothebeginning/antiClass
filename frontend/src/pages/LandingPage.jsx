// pages/LandingPage.jsx — 纯展示组件：开始界面（状态与处理在 App/hooks，切界面不丢状态）
import GlassSelect from "../components/GlassSelect.jsx";
import { PUBLIC_TABS, TAB_LABELS } from "../constants.js";

export default function LandingPage({landingTab, landing}) {
  const { landingPick, setLandingPick, landingMsg, landingBusy, handleSaveLanding } = landing;
  return (
    <>
        {/* 配置 → 开始界面：未登录访客进入网站时直接看到的界面 */}
          <div className="panel">
            <h2>开始界面</h2>
            <p className="hint">
              选择未登录访客打开网站时直接进入的界面（登录用户不受影响，仍只显示侧边栏）。
              「什么都不选」保持默认行为：只显示侧边栏，由访客自己点选。退出登录 / 会话过期的用户也会回到这里。
            </p>
            {landingMsg && <div className={`ai-msg ${landingMsg.type}`}>{landingMsg.text}</div>}
            <div className="apply-form">
              <label>访客开始界面</label>
              <GlassSelect
                value={landingPick}
                onChange={(v) => { setLandingPick(v); setLandingMsg(null); }}
                options={[
                  { value: "", label: "什么都不选（默认，只显示侧边栏）" },
                  ...PUBLIC_TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))
                ]}
              />
              <div className="ai-actions">
                <button
                  type="button"
                  className="btn primary-btn"
                  disabled={landingBusy || landingPick === landingTab}
                  onClick={handleSaveLanding}
                >
                  {landingBusy ? <><span className="spin" /> 保存中…</> : "保存开始界面"}
                </button>
                <span className="file-count">
                  当前：{landingTab ? `访客进入直接看到「${TAB_LABELS[landingTab]}」` : "什么都不选（只显示侧边栏）"}
                  {landingPick !== landingTab && "（有未保存改动）"}
                </span>
              </div>
            </div>
          </div>
    </>
  );
}
