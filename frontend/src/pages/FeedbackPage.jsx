// pages/FeedbackPage.jsx — 纯展示组件：体验反馈工单（状态与处理在 App/hooks，切界面不丢）
import TextField from "../components/TextField.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import GlassTabs from "../components/GlassTabs.jsx";
import { FEEDBACK_CATEGORY_OPTIONS } from "../constants.js";

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function FeedbackPage({ feedback, token }) {
  // 客户端筛选：状态（全部/待处理/已解决）× 分类（全部/问题/建议/其他）
  const shown = feedback.feedback.filter(
    (it) =>
      (feedback.fbStatus === "all" || (feedback.fbStatus === "resolved") === !!it.resolved) &&
      (feedback.fbCat === "all" || it.category === feedback.fbCat)
  );

  return (
    <div className="panel">
      <h2>体验反馈</h2>
      <p className="hint">
        网站用着不顺手、有功能想加？在这里说一声——反馈所有人可见，管理员会处理并标记解决状态。
      </p>

      <form className="feedback-form" onSubmit={feedback.handleFeedbackSubmit}>
        <GlassSelect
          value={feedback.fbCategory}
          onChange={feedback.setFbCategory}
          options={FEEDBACK_CATEGORY_OPTIONS}
          title="反馈分类"
        />
        <TextField
          multiline
          rows={4}
          placeholder="反馈内容（必填，最多 1000 字）"
          value={feedback.fbContent}
          onChange={(e) => feedback.setFbContent(e.target.value)}
          maxLength={1000}
        />
        <TextField
          placeholder="称呼/联系方式（选填，方便管理员联系你）"
          value={feedback.fbContact}
          onChange={(e) => feedback.setFbContact(e.target.value)}
          maxLength={64}
        />
        <div className="feedback-submit-row">
          <button className="btn primary-btn" disabled={feedback.fbBusy}>
            {feedback.fbBusy ? "提交中…" : "提交反馈"}
          </button>
          {feedback.fbMsg && <p className="hint">{feedback.fbMsg}</p>}
        </div>
      </form>

      <h3>反馈工单</h3>
      <div className="feedback-filters">
        <GlassTabs
          className="feedback-filter"
          ariaLabel="状态筛选"
          value={feedback.fbStatus}
          onChange={feedback.setFbStatus}
          options={[
            { value: "all", label: "全部" },
            { value: "pending", label: "待处理" },
            { value: "resolved", label: "已解决" },
          ]}
        />
        <GlassTabs
          className="feedback-filter"
          ariaLabel="分类筛选"
          value={feedback.fbCat}
          onChange={feedback.setFbCat}
          options={[{ value: "all", label: "全部" }, ...FEEDBACK_CATEGORY_OPTIONS]}
        />
      </div>
      {feedback.loading ? (
        <div className="loading">加载中…</div>
      ) : feedback.feedback.length === 0 ? (
        <div className="empty">还没有反馈，来提第一条吧</div>
      ) : shown.length === 0 ? (
        <div className="empty">该筛选条件下暂无反馈</div>
      ) : (
        <div className="feedback-list">
          {shown.map((it) => (
            <div key={it.id} className={`feedback-item${it.resolved ? " resolved" : ""}`}>
              <div className="feedback-head">
                <span className={`badge ${it.resolved ? "approved" : "pending"}`}>
                  {it.resolved ? "已解决" : "待处理"}
                </span>
                <span className="feedback-cat">{it.category}</span>
                <span className="feedback-time">{fmtTime(it.created_at)}</span>
              </div>
              <p className="feedback-content">{it.content}</p>
              <div className="feedback-meta">{it.contact ? `联系方式：${it.contact}` : "匿名反馈"}</div>
              {it.reply && (
                <div className="feedback-reply">
                  <strong>管理员回复：</strong>
                  {it.reply}
                </div>
              )}
              {token && (
                <div className="feedback-admin">
                  <label className="feedback-resolve">
                    <input
                      type="checkbox"
                      checked={!!it.resolved}
                      disabled={feedback.toggleId === it.id}
                      onChange={() => feedback.handleToggleResolved(it)}
                    />
                    已解决
                  </label>
                  {feedback.replyEditId === it.id ? (
                    <div className="feedback-reply-edit">
                      <TextField
                        multiline
                        rows={2}
                        maxLength={500}
                        placeholder="处理说明（留空保存 = 清除回复）"
                        value={feedback.replyDraft}
                        onChange={(e) => feedback.setReplyDraft(e.target.value)}
                      />
                      <div className="feedback-reply-actions">
                        <button className="btn small" disabled={feedback.replyBusy} onClick={() => feedback.handleReplySave(it)}>
                          保存回复
                        </button>
                        <button className="btn small ghost" onClick={feedback.cancelReplyEdit}>
                          收起
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn small ghost" onClick={() => feedback.startReplyEdit(it)}>
                      {it.reply ? "编辑回复" : "回复"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
