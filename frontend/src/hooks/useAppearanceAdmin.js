// useAppearanceAdmin.js — 背景图案配置页状态与处理（bgSaved/bgPick 本体在 App，供根节点下发 CSS 变量）
import { useState } from "react";
import { saveAppearance } from "../api.js";
import { readPatternImage } from "../utils/imageCompress.js";
import { BG_PATTERNS } from "../constants.js";

export function useAppearanceAdmin({ token, bgSaved, setBgSaved, bgPick, setBgPick }) {
  const [bgMsg, setBgMsg] = useState(null);
  const [bgBusy, setBgBusy] = useState(false);

  // 某端是否有未保存改动（本地选择 vs 服务端已保存；换了新的自定义图也算）
  function patternDirty(slot) {
    const pick = bgPick[slot];
    if (pick.pattern !== bgSaved[slot].pattern) return true;
    return pick.pattern === "custom" && !!pick.image;
  }

  function patternLabel(saved) {
    if (saved.pattern === "custom") return saved.url ? "自定义图案" : "网格（自定义图缺失）";
    return BG_PATTERNS.find((p) => p.id === saved.pattern)?.label || saved.pattern;
  }

  async function handlePickPattern(slot, fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    setBgMsg(null);
    try {
      const image = await readPatternImage(file);
      // 导入即选中「自定义」，省掉再点一次卡片
      setBgPick((p) => ({ ...p, [slot]: { pattern: "custom", image } }));
    } catch (err) {
      setBgMsg({ type: "err", text: err.message });
    }
  }

  async function handleSaveBg() {
    setBgBusy(true);
    setBgMsg(null);
    try {
      const d = await saveAppearance(bgPick, token);
      setBgSaved({ desktop: d.desktop, mobile: d.mobile });
      setBgPick({
        desktop: { pattern: d.desktop.pattern, image: "" },
        mobile: { pattern: d.mobile.pattern, image: "" }
      });
      setBgMsg({ type: "ok", text: "背景图案已保存，全站立即生效" });
    } catch (err) {
      setBgMsg({ type: "err", text: err.message });
    } finally {
      setBgBusy(false);
    }
  }
  return { bgMsg, bgBusy, patternDirty, patternLabel, handlePickPattern, handleSaveBg };
}
