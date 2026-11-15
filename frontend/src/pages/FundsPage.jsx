// pages/FundsPage.jsx — 纯展示组件：班费公示（公开可看，管理员发布增加/减少记录）
import Dropdown from "../components/Dropdown.jsx";
import DropZone from "../components/DropZone.jsx";
import FileChips from "../components/FileChips.jsx";
import GlassTabs from "../components/GlassTabs.jsx";
import Modal from "../components/Modal.jsx";
import TextField from "../components/TextField.jsx";
import { fundImageUrl } from "../api.js";

const KIND_OPTIONS = [
  { value: "in", label: "增加" },
  { value: "out", label: "减少" }
];

function money(n) {
  return Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function FundsPage({ funds, token, role, myClassId, classes, classSel, handlePickClass, guideClass, setGuideClass }) {
  if (!classSel) {
    return (
      <div className="panel guide-card">
        <h2>请选择要查看的班级</h2>
        <p className="hint">班费按班级分别公示。选择后会记住该班级，下次打开直接显示。</p>
        {classes.length === 0 ? (
          <p className="hint">暂无班级数据，请联系管理员。</p>
        ) : (
          <div className="class-bar">
            <label>班级</label>
            <Dropdown
              value={guideClass || classes[0].id}
              onChange={setGuideClass}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="选择班级"
            />
            <button
              type="button"
              className="btn primary-btn"
              onClick={() => handlePickClass(guideClass || classes[0].id)}
            >
              查看班费
            </button>
          </div>
        )}
      </div>
    );
  }

  const { balance, income, expense } = funds.summary;
  // 普通管理员只能在本班发布（root 不限）：切到别的班只看不发，避免点了才 403
  const canPublish = !!token && (role === "root" || (!!myClassId && classSel === myClassId));

  return (
    <div className="panel">
      <h2>班费公示</h2>
      <p className="hint">
        管理员发布每一笔班费增加/减少记录，全班可见，无需审批。结余 = 累计增加 − 累计减少，允许为负数。
      </p>

      {classes.length > 1 && (
        <div className="class-bar">
          <label>班级</label>
          <Dropdown
            value={classSel}
            onChange={handlePickClass}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="选择班级"
          />
        </div>
      )}

      <div className="fund-summary">
        <div className={`fund-stat${balance < 0 ? " negative" : ""}`}>
          <span>当前结余</span>
          <strong>{balance < 0 ? "-" : ""}¥{money(Math.abs(balance))}</strong>
        </div>
        <div className="fund-stat in">
          <span>累计增加</span>
          <strong>+¥{money(income)}</strong>
        </div>
        <div className="fund-stat out">
          <span>累计减少</span>
          <strong>-¥{money(expense)}</strong>
        </div>
      </div>

      {token && !canPublish && (
        <p className="hint fund-no-publish">当前查看的是其他班级，只能查看；发布/删除请切回本班。</p>
      )}

      {canPublish && (
        <form className="fund-form" onSubmit={funds.handleAddFund}>
          <div className="fund-form-row">
            <GlassTabs
              className="fund-kind"
              ariaLabel="班费类型"
              value={funds.fundKind}
              onChange={funds.setFundKind}
              options={KIND_OPTIONS}
            />
            <TextField
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="金额（元）"
              value={funds.fundAmount}
              onChange={(e) => funds.setFundAmount(e.target.value)}
            />
            <TextField
              placeholder="事由（如：班服采购、班费收缴）"
              maxLength={200}
              value={funds.fundTitle}
              onChange={(e) => funds.setFundTitle(e.target.value)}
            />
            <button className="btn primary-btn" disabled={funds.fundBusy}>
              {funds.fundBusy ? "发布中…" : "发布记录"}
            </button>
            {funds.fundMsg && <span className="hint fund-msg">{funds.fundMsg}</span>}
          </div>
          <div className="fund-upload-row">
            <DropZone
              className="slim fund-upload"
              accept="image/*"
              multiple
              title="添加票据图片（最多 5 张）"
              onFiles={funds.addFundFiles}
            />
            <FileChips
              files={funds.fundFiles}
              onRemove={funds.removeFundFile}
              className="fund-files"
            />
          </div>
        </form>
      )}

      {funds.loading ? (
        <div className="loading">加载中…</div>
      ) : funds.funds.length === 0 ? (
        <div className="empty">暂无班费记录{canPublish ? "，发布第一条吧" : ""}</div>
      ) : (
        <div className="fund-list">
          {funds.funds.map((it) => {
            const isIn = it.kind === "in";
            return (
              <div key={it.id} className={`fund-item ${isIn ? "in" : "out"}`}>
                <span className={`badge ${isIn ? "approved" : "rejected"}`}>{isIn ? "增加" : "减少"}</span>
                <div className="fund-main">
                  <p className="fund-title">{it.title}</p>
                  <div className="fund-meta">
                    {fmtTime(it.created_at)}
                    {it.created_by ? ` · 发布人 ${it.created_by}` : ""}
                  </div>
                  {it.evidence?.length > 0 && (
                    <div className="fund-thumbs">
                      {it.evidence.map((file) => (
                        <button
                          key={file}
                          type="button"
                          className="fund-thumb"
                          title={file}
                          onClick={() => funds.openFundPreview(it, file)}
                        >
                          <img src={fundImageUrl(it.id, file)} alt={file} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <strong className={`fund-amount ${isIn ? "in" : "out"}`}>
                  {isIn ? "+" : "-"}¥{money(it.amount)}
                </strong>
                {canPublish && (
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={funds.deletingId === it.id}
                    onClick={() => funds.handleDeleteFund(it)}
                  >
                    删除
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!funds.fundPreview}
        title={funds.fundPreview?.title || "图片预览"}
        showConfirm={false}
        cancelText="关闭"
        onCancel={funds.closeFundPreview}
      >
        {funds.fundPreview && (
          <img className="img-preview" src={funds.fundPreview.url} alt={funds.fundPreview.title} />
        )}
      </Modal>
    </div>
  );
}
