import { useState } from "react";

/**
 * 统一下拉选择器（悬停展开 + 动画），移植自 anticraft/index 的 CategoryDropdown。
 * 桌面端悬停展开菜单，移动端（≤768px）点击展开。
 *
 * @param {string} value - 当前选中值（显示在按钮上）
 * @param {function(string)} onChange - 选择回调
 * @param {Array<{value: string, label: string}>} options - 选项列表
 * @param {string} [placeholder='请选择'] - 无匹配时的按钮文案
 */
export default function Dropdown({ value, onChange, options = [], placeholder = "请选择" }) {
  const [open, setOpen] = useState(false);

  const pick = (v) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(v);
    setOpen(false);
  };

  const toggle = () => {
    if (window.innerWidth < 768) setOpen((o) => !o);
  };

  return (
    <div className={`nav-dropdown category-dropdown ${open ? "mobile-open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="category-btn" onClick={toggle}>
        {options.find((o) => o.value === value)?.label || value || placeholder}
        <span className="arrow-down">▾</span>
      </button>
      <div className="nav-dropdown-menu">
        {options.map((opt) => (
          <a key={opt.value} href="#" className={opt.value === value ? "picked" : ""} onClick={pick(opt.value)}>
            {opt.label}
          </a>
        ))}
      </div>
    </div>
  );
}
