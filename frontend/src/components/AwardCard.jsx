import { useEffect, useState } from "react";
import { approveAward, rejectAward, editAward, withdrawAward, deleteAward, evidenceUrl } from "../api.js";
import GlassSelect from "./GlassSelect.jsx";
import Modal from "./Modal.jsx";
import TextField from "./TextField.jsx";
import FileChips from "./FileChips.jsx";
import { isImage } from "../utils/img.js";
import { CATEGORY_OPTIONS } from "../constants.js";

export default function AwardCard({ award, token, onRefresh, onPreview }) {
  const [category, setCategory] = useState(award.category);
  const [points, setPoints] = useState(String(award.points));
  const [basis, setBasis] = useState(award.basis || "");
  // 卡片默认折叠，仅展开后显示依据/证据/操作按钮（各卡片独立，key 为 award.id 故列表重渲染时保留）
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editFiles, setEditFiles] = useState([]); // 编辑重提时追加的证据文件
  const canEdit = !!token;
  const isRejected = award.approved === "驳回";
  const statusClass = award.approved === "否" ? "pending" : award.approved === "是" ? "approved" : "rejected";
  const statusText = award.approved === "否" ? "待审批" : award.approved === "是" ? "已通过" : "已驳回";

  // 数据刷新（act 后 onRefresh 传入新 award）时同步本地字段
  useEffect(() => {
    setCategory(award.category);
    setPoints(String(award.points));
    setBasis(award.basis || "");
  }, [award.id, award.category, award.points, award.basis]);

  async function act(action, payload) {
    setBusy(true);
    setError("");
    try {
      if (action === "approve") {
        await approveAward(award.id, token, { category, points: parseFloat(points) || 0 });
      } else if (action === "reject") {
        await rejectAward(award.id, token, payload?.reason || "");
      } else if (action === "edit") {
        await editAward(
          award.id,
          { category, points: parseFloat(points) || 0, basis: basis.trim(), files: editFiles },
          token
        );
      } else if (action === "withdraw") {
        await withdrawAward(award.id, token);
      } else if (action === "delete") {
        await deleteAward(award.id, token);
      }
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`award-card ${statusClass}`}>
      {/* 头部整行可点：折叠时只暴露学号/姓名/栏目/分值 + 状态徽章 + 证据条数 */}
      <div
        className="award-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // 避免空格滚动页面
            setExpanded((v) => !v);
          }
        }}
      >
        <div className="award-head-main">
          <strong>{award.sid} {award.name}</strong>
          <span className="award-chip">{category}</span>
          <span className="award-chip">加分 {points || 0}</span>
          {award.evidence.length > 0 && <span className="award-chip muted">证据 {award.evidence.length}</span>}
        </div>
        <div className="award-head-side">
          <span className={`badge ${statusClass}`}>{statusText}</span>
          <svg
            className="award-chevron"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>
      <div className="award-collapse" data-open={expanded ? "1" : "0"}>
        <div className="award-collapse-inner">
          <div className="award-body">
            <div className="award-field">
              <span>加分栏目</span>
              <GlassSelect
                value={category}
                onChange={setCategory}
                disabled={!canEdit || award.approved !== "否"}
                options={CATEGORY_OPTIONS}
              />
            </div>
            <div className="award-field">
              <span>加分分值</span>
              <input
                type="number"
                step="0.5"
                min="0"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                disabled={!canEdit || award.approved !== "否"}
              />
            </div>
            <div className="award-field">
              <span>状态</span>
              <span className="created-at">{award.created_at}</span>
            </div>
            <div className="award-field wide">
              <span>加分依据</span>
              <p>{award.basis || "（无）"}</p>
            </div>
            {isRejected && (
              <div className="award-field wide">
                <span>驳回理由</span>
                <p className="reject-reason">{award.reject_reason || "（未填写）"}</p>
              </div>
            )}
            <div className="award-field wide">
              <span>证据文件</span>
              <div className="evidence-list">
                {award.evidence.length === 0 && <em>无</em>}
                {award.evidence.map((f) =>
                  isImage(f) ? (
                    <div key={f} className="evidence-img">
                      <img src={evidenceUrl(award.id, f)} alt={f} loading="lazy" onClick={() => onPreview(award.id, f)} title="点击放大预览" />
                      <a href={evidenceUrl(award.id, f)} target="_blank" rel="noreferrer">原图 {f}</a>
                    </div>
                  ) : (
                    <a key={f} className="link" href={evidenceUrl(award.id, f)} target="_blank" rel="noreferrer">查看 {f}</a>
                  )
                )}
              </div>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="award-actions">
            {isRejected && (
              // 驳回记录：任何人（申报人本人）可编辑后重新提交
              <button className="btn small" disabled={busy} onClick={() => setEditOpen(true)}>编辑并重新提交</button>
            )}
            {canEdit && (
              <>
                {award.approved === "否" && (
                  <>
                    <button className="btn small" disabled={busy} onClick={() => act("approve")}>通过</button>
                    <button className="btn small danger" disabled={busy} onClick={() => setRejectOpen(true)}>驳回</button>
                  </>
                )}
                {award.approved === "是" && (
                  <button className="btn small" disabled={busy} onClick={() => act("withdraw")}>撤回</button>
                )}
                <button className="btn small danger" disabled={busy} onClick={() => setConfirmDel(true)}>删除</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 弹窗保持在最外层（不放进折叠容器，避免收起时被 visibility:hidden 隐藏） */}
      <Modal
        open={rejectOpen}
        title={`驳回申报（${award.sid} ${award.name}）`}
        confirmText="确认驳回"
        danger
        confirmDisabled={!rejectReason.trim()}
        onConfirm={() => { setRejectOpen(false); act("reject", { reason: rejectReason }); setRejectReason(""); }}
        onCancel={() => { setRejectOpen(false); setRejectReason(""); }}
      >
        <label className="form-label">驳回理由 *（将展示给申报人，便于修改后重新提交）</label>
        <TextField
          multiline
          className="modal-textarea"
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="例如：证据图片不清晰，请上传获奖证书原件后重新提交"
        />
      </Modal>

      <Modal
        open={editOpen}
        title={`编辑并重新提交（${award.sid} ${award.name}）`}
        confirmText="保存并重新提交"
        confirmDisabled={!basis.trim() || busy}
        onConfirm={() => { setEditOpen(false); setEditFiles([]); act("edit"); }}
        onCancel={() => { setEditOpen(false); setEditFiles([]); }}
      >
        <p className="modal-note">
          被驳回的申报可在此修改栏目/分值/依据，并可补充证据文件（图片/PDF/Word）。保存后回到「待审批」重新审批，内容将经自动审核。
        </p>
        <div className="award-field">
          <span>加分栏目</span>
          <GlassSelect value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
        </div>
        <div className="award-field">
          <span>加分分值</span>
          <input
            type="number"
            step="0.5"
            min="0"
            max={category === "附加分" ? 5 : 100}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>
        <div className="award-field wide">
          <span>加分依据</span>
          <TextField multiline rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} />
        </div>
        {award.evidence.length > 0 && (
          <div className="award-field wide">
            <span>已有证据（点击可放大预览）</span>
            <div className="evidence-list">
              {award.evidence.map((f) =>
                isImage(f) ? (
                  <div key={f} className="evidence-img">
                    <img src={evidenceUrl(award.id, f)} alt={f} loading="lazy" onClick={() => onPreview(award.id, f)} title="点击放大预览" />
                  </div>
                ) : (
                  <a key={f} className="link" href={evidenceUrl(award.id, f)} target="_blank" rel="noreferrer">查看 {f}</a>
                )
              )}
            </div>
          </div>
        )}
        <label className="btn small ghost assess-file-btn" style={{ marginTop: 8 }}>
          ＋ 添加证据文件
          <input
            type="file" multiple hidden
            onChange={(e) => {
              const fs = Array.from(e.target.files || []).slice(0, 5);
              setEditFiles((prev) => [...prev, ...fs].slice(0, 5));
              e.target.value = "";
            }}
          />
        </label>
        <FileChips
          files={editFiles}
          className="chat-attach-preview"
          onRemove={(i) => setEditFiles((prev) => prev.filter((_, j) => j !== i))}
        />
      </Modal>

      <Modal
        open={confirmDel}
        title="删除申报"
        message={`确认删除该申报？删除后不可恢复。${award.approved === "是" ? "已加分数会一并撤销。" : ""}`}
        danger
        confirmText="删除"
        onConfirm={() => { setConfirmDel(false); act("delete"); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}
