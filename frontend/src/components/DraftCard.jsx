import { useState } from "react";
import { evidenceUrl } from "../api.js";
import GlassSelect from "./GlassSelect.jsx";
import Modal from "./Modal.jsx";
import TextField from "./TextField.jsx";
import { isImage } from "../utils/img.js";
import { CATEGORY_OPTIONS } from "../constants.js";

export default function DraftCard({ draft, submitting, onChangeItem, onRemoveItem, onSubmit, onPreview, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="draft-card">
      <div className="draft-head">
        <strong>{draft.sid} {draft.name} · AI 分类结果</strong>
        <div className="draft-head-actions">
          <button className="btn small ghost" disabled={submitting} onClick={() => setConfirmDel(true)}>删除</button>
          <button className="btn small" disabled={submitting} onClick={() => onSubmit(draft)}>
            提交此申报
          </button>
        </div>
      </div>
      <p className="hint">请本人核对以下加分项的栏目、分值与依据，可修改、删除单条后提交。</p>
      {draft.items.map((it, idx) => (
        <div key={idx} className="result-item draft-item">
          <GlassSelect
            value={it.category}
            onChange={(v) => onChangeItem(draft.draft_id, idx, { category: v })}
            options={CATEGORY_OPTIONS}
          />
          <input
            type="number"
            step="0.5"
            min="0"
            max={it.category === "附加分" ? 5 : 100}
            value={it.points}
            className="draft-points"
            onChange={(e) => onChangeItem(draft.draft_id, idx, { points: e.target.value })}
          />
          <TextField
            className="draft-basis"
            value={it.basis}
            placeholder="加分依据"
            onChange={(e) => onChangeItem(draft.draft_id, idx, { basis: e.target.value })}
          />
          <button
            type="button"
            className="btn small danger draft-item-del"
            title="删除该加分项（删空自动移除整份草稿）"
            disabled={submitting}
            onClick={() => onRemoveItem(draft.draft_id, idx)}
          >
            删
          </button>
          {it.review && <p className="review-note">{it.review}</p>}
          <div className="evidence-list">
            {it.evidence.length === 0 && <em className="file-count">无证据</em>}
            {it.evidence.map((f) =>
              isImage(f) ? (
                <img
                  key={f}
                  className="evidence-thumb"
                  src={evidenceUrl(draft.draft_id, f)}
                  alt={f}
                  title="点击放大预览"
                  onClick={() => onPreview(draft.draft_id, f)}
                />
              ) : (
                <a key={f} className="link" href={evidenceUrl(draft.draft_id, f)} target="_blank" rel="noreferrer">
                  查看 {f.slice(f.indexOf("_") + 1)}
                </a>
              )
            )}
           </div>
         </div>
       ))}
      <Modal
        open={confirmDel}
        title="删除 AI 分析草稿"
        message="确认删除这份草稿？其内容与已上传的证据将被移除，无法恢复。"
        danger
        confirmText="删除"
        onConfirm={() => { setConfirmDel(false); onDelete(draft.draft_id); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}
