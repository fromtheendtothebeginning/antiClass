// useLandingAdmin.js — 开始界面（访客落地页）配置状态与处理
import { useState } from "react";
import { saveAppearance } from "../api.js";
import { TAB_LABELS } from "../constants.js";

export function useLandingAdmin({ token, landingTab, setLandingTab, landingPick, setLandingPick }) {
  const [landingMsg, setLandingMsg] = useState(null);
  const [landingBusy, setLandingBusy] = useState(false);

  // ---------- 开始界面（未登录访客进入网站时看到的界面） ----------
  async function handleSaveLanding() {
    setLandingBusy(true);
    setLandingMsg(null);
    try {
      const d = await saveAppearance({ landing: landingPick }, token);
      setLandingTab(d.landing || "");
      setLandingPick(d.landing || "");
      setLandingMsg({
        type: "ok",
        text: d.landing ? `已保存：访客进入网站直接看到「${TAB_LABELS[d.landing]}」` : "已保存：访客进入网站只显示侧边栏，自行点选界面",
      });
    } catch (err) {
      setLandingMsg({ type: "err", text: err.message });
    } finally {
      setLandingBusy(false);
    }
  }
  return { landingPick, setLandingPick, landingMsg, landingBusy, handleSaveLanding };
}
