import { useMemo, useState } from "react";
import TextField from "./TextField.jsx";

/**
 * 学号选择输入框：玻璃风格自绘补全下拉，替代原生 datalist（原生候选框样式不受控、无法贴合全站风格）。
 * 交互对齐审批搜索框（award-suggest）：↑↓ 循环高亮 / 回车选中 / Esc 关闭、悬停即高亮、
 * 失焦收起（候选项 onMouseDown 阻止默认，避免输入框先失焦把列表收掉）。
 * 过滤规则：学号或姓名包含输入片段即命中；空输入显示前 10 个学生。onChange 回传选中的学号字符串。
 */
export default function StudentInput({ value, onChange, students, ...rest }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);

  const token = (value || "").trim().toLowerCase();
  const options = useMemo(() => {
    const pool = (students || []).filter((s) => s.sid);
    const hit = token
      ? pool.filter(
          (s) => s.sid.toLowerCase().includes(token) || (s.name || "").toLowerCase().includes(token)
        )
      : pool;
    return hit.slice(0, 10);
  }, [students, token]);

  const pick = (s) => {
    onChange(s.sid);
    setOpen(false);
    setIdx(-1);
  };

  const onKeyDown = (e) => {
    if (!open || !options.length) return;
    if (e.key === "Escape") {
      setOpen(false);
      setIdx(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => {
        const last = options.length - 1;
        if (e.key === "ArrowDown") return i >= last ? 0 : i + 1;
        return i <= 0 ? last : i - 1;
      });
    } else if (e.key === "Enter" && idx >= 0 && idx < options.length) {
      e.preventDefault();
      pick(options[idx]);
    }
  };

  return (
    <div className="student-input">
      <TextField
        {...rest}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setIdx(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <div className="award-suggest">
          {options.map((s, i) => (
            <button
              key={s.sid}
              type="button"
              className={i === idx ? "picked" : ""}
              // mousedown 阻止默认行为，避免输入框先失焦把建议列表收掉
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(s)}
            >
              {s.sid} {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
