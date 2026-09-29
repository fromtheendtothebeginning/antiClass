import { useEffect, useRef, useState } from "react";

/**
 * 玻璃风格下拉选择：自绘菜单替代原生 <select>（原生展开的系统菜单样式不受控、无法贴合全站风格）。
 * - 触发器复用「表单控件统一」配方（--neutral-soft-hover 底 + --border-strong 边 + 12px 圆角），
 *   展开时箭头旋转；菜单用 --menu-bg 实底玻璃（--award-suggest 同款观感）。
 * - 点外部关闭 / Esc 关闭 / 选中即关闭；options: [{ value, label, disabled? }]。
 * - 按钮一律 type="button"，在 <form> 里不会误触发提交。
 */
export default function GlassSelect({ value, onChange, options, disabled = false, className = "", title }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const pick = (o) => {
    if (o.disabled) return;
    setOpen(false);
    if (o.value !== value) onChange(o.value);
  };

  return (
    <div className={`glass-select${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className={`select-trigger${open ? " open" : ""}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="select-value">{current ? current.label : ""}</span>
        <span className="arrow-down" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="select-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              className={`select-option${o.value === value ? " picked" : ""}${o.disabled ? " is-disabled" : ""}`}
              onClick={() => pick(o)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
