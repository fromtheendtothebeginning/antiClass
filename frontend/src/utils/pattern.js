// pattern.js — 某端当前生效的背景图案 CSS（本地选了自定义图就用它，否则用已保存的图 / 内置图案）
// 内置图案：按 tile 尺寸平铺；自定义图：一张图铺满整屏、不平铺，超出屏幕的部分居中裁切
// （电脑端按宽度适配 100% auto、手机端按高度适配 auto 100%，见 BG_SLOTS.fit）
import { BG_PATTERNS, BG_SLOTS } from "../constants.js";

  // 某端当前生效的 CSS：本地选了自定义图就用它，否则用已保存的图 / 内置图案
  // 内置图案：按 tile 尺寸平铺；自定义图：一张图铺满整屏、不平铺，超出屏幕的部分居中裁切
  // （电脑端按宽度适配 100% auto、手机端按高度适配 auto 100%，见 BG_SLOTS.fit）
export function patternCss(slot, bgPick, bgSaved) {
    const pick = bgPick[slot];
    if (pick.pattern === "custom") {
      const url = pick.image || bgSaved[slot].url;
      if (url) {
        return {
          image: `url("${url}")`,
          size: BG_SLOTS.find((s) => s.id === slot).fit,
          repeat: "no-repeat",
          pos: "center center",
          custom: true
        };
      }
    }
    const def = BG_PATTERNS.find((p) => p.id === pick.pattern) || BG_PATTERNS[0];
    return { image: def.image, size: def.size, repeat: "repeat", pos: "0 0", custom: false };
  }
