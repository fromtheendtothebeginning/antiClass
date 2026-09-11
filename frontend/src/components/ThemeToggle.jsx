import { useEffect, useState } from "react";

/**
 * 主题切换（跟随系统 / 浅色 / 深色）
 *
 * 主题只由 CSS 变量承担：在 <html> 上写 `data-theme` 属性即可，
 * 深层（含 Modal 用 createPortal 渲染到 body 的弹窗）都能命中，
 * 因此组件自包含、不进 App state。
 *  - data-theme="light" / "dark" → index.css 的显式块生效
 *  - 无 data-theme                 → 交给 @media (prefers-color-scheme: dark) 兜底
 */

const THEME_KEY = "theme";

const OPTIONS = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"],
];

/** 非法值一律归为 system */
function normalize(mode) {
  return mode === "light" || mode === "dark" ? mode : "system";
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
}

function readStored() {
  try {
    return normalize(localStorage.getItem(THEME_KEY));
  } catch (e) {
    return "system";
  }
}

export default function ThemeToggle() {
  const [mode, setMode] = useState(readStored);

  // 每次模式变化同步到 <html>
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // 跟随系统时实时响应系统深浅切换（index 未做，这里补上）
  useEffect(() => {
    if (mode !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  // 跨标签同步（同标签内不派发合成 StorageEvent）
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== THEME_KEY) return;
      const next = normalize(e.newValue);
      setMode(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const change = (next) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* 隐私模式等禁用 localStorage 时忽略，仅本次会话生效 */
    }
    applyTheme(next);
    setMode(next);
  };

  return (
    <div className="theme-toggle" role="group" aria-label="主题模式">
      {OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={`theme-toggle-option${mode === value ? " active" : ""}`}
          aria-pressed={mode === value}
          title={label}
          onClick={() => change(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
