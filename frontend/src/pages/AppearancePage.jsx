// pages/AppearancePage.jsx — 纯展示组件：背景图案（状态与处理在 App/hooks，切界面不丢状态）
import { patternCss } from "../utils/pattern.js";
import { BG_PATTERNS, BG_SLOTS } from "../constants.js";

export default function AppearancePage({bgSaved, bgPick, setBgPick, bg}) {
  const { bgMsg, bgBusy, patternDirty, patternLabel, handlePickPattern, handleSaveBg } = bg;
  return (
    <>
        {/* 配置 → 背景图案：全站外观设置，登录的管理员可改；电脑端/手机端各一套（点击即时预览，保存才落库） */}
          <div className="panel">
            <h2>背景图案</h2>
            <p className="hint">
              背景图案是全站外观：保存后所有访客（含未登录）看到的都是同一个图案。电脑端与手机端可以各配一套（手机端在 ≤768px 生效），
              每端支持四种内置图案（平铺）或导入自定义图片——自定义图一张铺满整屏、不平铺：
              <strong>电脑端按屏幕宽度</strong>适配（图片更高时上下溢出被裁掉，建议传横图如 1600×900）、
              <strong>手机端按屏幕高度</strong>适配（图片更宽时左右溢出被裁掉，建议传竖图）。
              点击图案即时预览，「保存背景图案」才会生效到全站。
            </p>
            {bgMsg && <div className={`ai-msg ${bgMsg.type}`}>{bgMsg.text}</div>}
            {BG_SLOTS.map((slot) => {
              const pick = bgPick[slot.id];
              const css = patternCss(slot.id, bgPick, bgSaved);
              const customImg = pick.image || bgSaved[slot.id].url;
              return (
                <div className="ai-section" key={slot.id}>
                  <h3>{slot.label}</h3>
                  <div className="bg-picker">
                    {BG_PATTERNS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`bg-option${pick.pattern === p.id ? " active" : ""}`}
                        aria-pressed={pick.pattern === p.id}
                        onClick={() => { setBgPick((v) => ({ ...v, [slot.id]: { pattern: p.id, image: "" } })); setBgMsg(null); }}
                      >
                        <span className="bg-swatch" style={{ backgroundImage: p.image, backgroundSize: p.swatchSize }} aria-hidden="true" />
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`bg-option${pick.pattern === "custom" ? " active" : ""}`}
                      aria-pressed={pick.pattern === "custom"}
                      disabled={!customImg}
                      title={customImg ? undefined : "请先导入自定义图案"}
                      onClick={() => { setBgPick((v) => ({ ...v, [slot.id]: { pattern: "custom", image: "" } })); setBgMsg(null); }}
                    >
                      <span
                        className="bg-swatch custom"
                        style={customImg ? { backgroundImage: `url("${customImg}")`, backgroundSize: slot.fit, backgroundPosition: "center" } : undefined}
                        aria-hidden="true"
                      >
                        {!customImg && "+"}
                      </span>
                      自定义
                    </button>
                  </div>
                  <div className="ai-actions">
                    <label className="btn small ghost assess-file-btn">
                      导入自定义图案
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => { handlePickPattern(slot.id, e.target.files); e.target.value = ""; }}
                      />
                    </label>
                    <span className="file-count">
                      {customImg
                        ? `自定义图已就绪（当前预览：${css.custom ? "自定义" : "内置图案"}）`
                        : `尚未导入自定义图（PNG/JPG/WebP/GIF，${slot.fitText}整屏、不平铺）`}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="ai-actions">
              <button
                type="button"
                className="btn primary-btn"
                disabled={bgBusy || BG_SLOTS.every((s) => !patternDirty(s.id))}
                onClick={handleSaveBg}
              >
                {bgBusy ? <><span className="spin" /> 保存中…</> : "保存背景图案"}
              </button>
              <span className="file-count">
                当前已保存：{BG_SLOTS.map((s) => `${s.id === "desktop" ? "电脑端" : "手机端"} ${patternLabel(bgSaved[s.id])}`).join(" · ")}
                {BG_SLOTS.some((s) => patternDirty(s.id)) && "（有未保存改动）"}
              </span>
            </div>
          </div>
    </>
  );
}
