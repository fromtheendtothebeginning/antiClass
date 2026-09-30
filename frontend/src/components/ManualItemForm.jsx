import GlassSelect from "./GlassSelect.jsx";
import TextField from "./TextField.jsx";
import { CATEGORY_OPTIONS } from "../constants.js";

/** 一遍过「手动添加加分项」表单（未识别到加分项 / 已识别到多条两种状态下复用同一份） */
export default function ManualItemForm({ value, onChange, onSubmit }) {
  return (
    <form className="assess-item-card" onSubmit={onSubmit}>
      <GlassSelect
        value={value.category}
        onChange={(v) => onChange({ ...value, category: v })}
        options={CATEGORY_OPTIONS}
      />
      <input
        type="number" step="0.5" min="0"
        max={value.category === "附加分" ? 5 : 100}
        value={value.points}
        onChange={(e) => onChange({ ...value, points: e.target.value })}
      />
      <TextField
        className="assess-basis"
        placeholder="加分依据（引用原文条款）"
        value={value.basis}
        onChange={(e) => onChange({ ...value, basis: e.target.value })}
      />
      <button type="submit" className="btn small">添加</button>
    </form>
  );
}
