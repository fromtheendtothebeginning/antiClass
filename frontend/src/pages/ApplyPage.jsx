// pages/ApplyPage.jsx — 纯展示组件：加分申报（状态与处理在 App/hooks，切界面不丢状态）
import GlassTabs from "../components/GlassTabs.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import StudentInput from "../components/StudentInput.jsx";
import TextField from "../components/TextField.jsx";
import DropZone from "../components/DropZone.jsx";
import DraftCard from "../components/DraftCard.jsx";
import Dropdown from "../components/Dropdown.jsx";
import { CATEGORY_OPTIONS, CC_ROLE_OPTIONS } from "../constants.js";

const ADJ_FIELD_OPTIONS = [
  { value: "deyu", label: "德育" },
  { value: "meiyu", label: "美育" },
  { value: "laoyu", label: "劳育" },
  { value: "fujia", label: "附加分" }
];
const ADJ_OP_OPTIONS = [
  { value: "add", label: "增加" },
  { value: "sub", label: "减少" },
  { value: "set", label: "设为" }
];
const IMG_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

export default function ApplyPage({apply, token, classes, classSel, handlePickClass, students, submitting, submitMsg, setPreview}) {
  const {
    applyType, setApplyType, applySid, setApplySid, applyText, setApplyText, applyFiles, setApplyFiles, analyzing, drafts,
    handleAnalyze, formSid, setFormSid, formCategory, setFormCategory, formPoints, setFormPoints, formBasis, setFormBasis,
    formFiles, setFormFiles, formBusy, formResult, handleManual, ccSid, setCcSid, ccRole, setCcRole, ccBusy, ccResult,
    handleClassCommittee, adjSids, setAdjSids, adjField, setAdjField, adjOp, setAdjOp, adjPoints, setAdjPoints, adjBusy,
    adjResult, handleAdjust, batchSids, setBatchSids, batchCategory, setBatchCategory, batchPoints, setBatchPoints,
    batchBasis, setBatchBasis, batchFiles, setBatchFiles, batchBusy, batchResult, handleBatch, updateDraftItem,
    removeDraftItem, deleteDraft, submitDraft, submitAll,
  } = apply;
  return (
    <>
          <div className="panel">
            <h2>加分申报</h2>
            {classes.length > 1 && (
              <div className="class-bar">
                <label>当前班级</label>
                <Dropdown
                  value={classSel}
                  onChange={handlePickClass}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择班级"
                />
              </div>
            )}
            <p className="hint">
              选择申报类型：AI 智能分类支持填学号 + 自然语言描述 + 上传奖状/证书图片或文件，AI 分析后请本人核对加分项再提交审批（支持一键提交全部）；传统表单可直接提交申报；班委加分可快速生成班级职务的德育加分申报；想要 AI 按评分办法逐项询问请使用顶部「加分一遍过」。学号输入框支持自动补全。
            </p>
            <GlassTabs
              className="type-tabs"
              value={applyType}
              onChange={setApplyType}
              options={[
                { value: "ai", label: "AI 智能分类" },
                { value: "form", label: "传统表单申报" },
                { value: "cc", label: "班委加分" },
                ...(token ? [
                  { value: "batch", label: "批量加分（管理员）" },
                  { value: "adjust", label: "分数调整（管理员）" }
                ] : [])
              ]}
            />

            {applyType === "ai" ? (
              <>
                <form className="apply-form" onSubmit={handleAnalyze}>
                  <label>学号 *</label>
                  <StudentInput
                    value={applySid}
                    onChange={setApplySid}
                    students={students}
                    placeholder="如 251184Y313"
                  />
                  <label>情况描述</label>
                  <TextField
                    multiline
                    rows={4}
                    value={applyText}
                    onChange={(e) => setApplyText(e.target.value)}
                    placeholder="例如：获得2025年全国大学生电子设计竞赛省级二等奖，见证书图片；或：我担任班长，任职满六个月"
                  />
                  <label>上传证据（图片/文件，可多选）</label>
                  <DropZone
                    accept="image/*,.pdf,.doc,.docx"
                    multiple
                    className="compact"
                    title="拖入证据文件，或点击选择"
                    hint="支持图片 / PDF / Word，可多选"
                    onFiles={(files) => setApplyFiles(Array.from(files || []))}
                  />
                  {applyFiles.length > 0 && (
                    <span className="file-count">已选 {applyFiles.length} 个文件</span>
                  )}
                  <span className="file-count ai-peak-hint">
                    请尽量不要在北京时间周一至周五 9:00 - 12:00、14:00 - 18:00 使用该功能
                  </span>
                  <button type="submit" className="btn primary-btn" disabled={analyzing}>
                    {analyzing ? <><span className="spin" /> AI 分析中…</> : "AI 分析"}
                  </button>
                </form>
                {submitMsg && <div className="apply-result"><p className="hint">{submitMsg}</p></div>}
                {drafts.length > 0 && (
                  <div className="apply-result">
                    <div className="draft-head">
                      <h3>待本人审核（{drafts.length} 份）</h3>
                      {drafts.length > 1 && (
                        <button className="btn small primary" disabled={submitting} onClick={submitAll}>
                          一键提交全部
                        </button>
                      )}
                    </div>
                    {drafts.map((d) => (
                      <DraftCard
                        key={d.draft_id}
                        draft={d}
                        submitting={submitting}
                        onChangeItem={updateDraftItem}
                        onRemoveItem={removeDraftItem}
                        onSubmit={submitDraft}
                        onDelete={deleteDraft}
                        onPreview={(aid, f) => setPreview({ aid, file: f })}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : applyType === "form" ? (
              <>
                <form className="apply-form" onSubmit={handleManual}>
                  <label>学号 *</label>
                  <StudentInput
                    value={formSid}
                    onChange={setFormSid}
                    students={students}
                    placeholder="如 251184Y313"
                  />
                  <label>加分栏目 *</label>
                  <GlassSelect value={formCategory} onChange={setFormCategory} options={CATEGORY_OPTIONS} />
                  <label>申报分值 *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={formCategory === "附加分" ? 5 : 100}
                    value={formPoints}
                    onChange={(e) => setFormPoints(e.target.value)}
                  />
                  <label>加分依据 *</label>
                  <TextField
                    multiline
                    rows={3}
                    value={formBasis}
                    onChange={(e) => setFormBasis(e.target.value)}
                    placeholder="例如：获校级三好学生荣誉称号，加2分"
                  />
                  <label>上传证据（可选，图片/文件）</label>
                  <DropZone
                    accept="image/*,.pdf,.doc,.docx"
                    multiple
                    className="compact"
                    title="拖入证据文件，或点击选择"
                    hint="支持图片 / PDF / Word，可多选"
                    onFiles={(files) => setFormFiles(Array.from(files || []))}
                  />
                  {formFiles.length > 0 && <span className="file-count">已选 {formFiles.length} 个文件</span>}
                  <button type="submit" className="btn primary-btn" disabled={formBusy}>
                    {formBusy ? <><span className="spin" /> 提交中…</> : "提交申报"}
                  </button>
                </form>
                {formResult && (
                  <div className="apply-result">
                    <h3>已提交 {formResult.length} 条申报，等待管理员审批</h3>
                    {formResult.map((r) => (
                      <div key={r.id} className="result-item">
                        <span className="badge">{r.category}</span>
                        <strong>+{r.points}</strong>
                        <span>{r.basis}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : applyType === "cc" ? (
              <>
                <form className="apply-form" onSubmit={handleClassCommittee}>
                  <label>学号 *</label>
                  <StudentInput
                    value={ccSid}
                    onChange={setCcSid}
                    students={students}
                    placeholder="如 251184Y313"
                  />
                  <label>班委职务 *</label>
                  <GlassSelect value={ccRole} onChange={setCcRole} options={CC_ROLE_OPTIONS} />
                  <p className="hint">任职满六个月；班委加分计入德育板块。</p>
                  <button type="submit" className="btn primary-btn" disabled={ccBusy}>
                    {ccBusy ? <><span className="spin" /> 提交中…</> : "提交班委加分"}
                  </button>
                </form>
                {ccResult && (
                  <div className="apply-result">
                    <h3>已生成 {ccResult.length} 条待审批申报</h3>
                    {ccResult.map((r) => (
                      <div key={r.id} className="result-item">
                        <span className="badge">{r.category}</span>
                        <strong>+{r.points}</strong>
                        <span>{r.basis}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : applyType === "adjust" ? (
              <>
                <form className="apply-form" onSubmit={handleAdjust}>
                  <label>学号（可多个，支持正则，如 251184Y3.* 选全班）*</label>
                  <TextField
                    multiline
                    rows={2}
                    value={adjSids}
                    onChange={(e) => setAdjSids(e.target.value)}
                    placeholder="251184Y330, 251184Y3[12]"
                  />
                  <label>分数项 *</label>
                  <GlassSelect value={adjField} onChange={setAdjField} options={ADJ_FIELD_OPTIONS} />
                  <label>操作 *</label>
                  <GlassSelect value={adjOp} onChange={setAdjOp} options={ADJ_OP_OPTIONS} />
                  <label>数值 *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={adjField === "fujia" ? 5 : 100}
                    value={adjPoints}
                    onChange={(e) => setAdjPoints(e.target.value)}
                  />
                  <button type="submit" className="btn primary-btn" disabled={adjBusy}>
                    {adjBusy ? <><span className="spin" /> 调整中…</> : "执行调整"}
                  </button>
                </form>
                {adjResult && (
                  <div className="apply-result">
                    <h3>已调整 {adjResult.length} 名学生（即时生效，已留痕 adjust_log）</h3>
                    {adjResult.map((r) => (
                      <div key={r.sid} className="result-item">
                        <strong>{r.sid} {r.name}</strong>
                        <span>{r.old.toFixed(1)} → {r.new.toFixed(1)}</span>
                        <span>综合 {r.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <form className="apply-form" onSubmit={handleBatch}>
                  <label>学号（可多个，用逗号/空格/换行分隔）*</label>
                  <TextField
                    multiline
                    rows={3}
                    value={batchSids}
                    onChange={(e) => setBatchSids(e.target.value)}
                    placeholder="251184Y313,251184Y325,251184Y331"
                  />
                  <label>加分栏目 *</label>
                  <GlassSelect value={batchCategory} onChange={setBatchCategory} options={CATEGORY_OPTIONS} />
                  <label>加分分值 *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={batchCategory === "附加分" ? 5 : 100}
                    value={batchPoints}
                    onChange={(e) => setBatchPoints(e.target.value)}
                  />
                  <label>加分依据 *</label>
                  <TextField
                    multiline
                    rows={3}
                    value={batchBasis}
                    onChange={(e) => setBatchBasis(e.target.value)}
                    placeholder="例如：校级优秀志愿者表彰（每生加3分）"
                  />
                  <label>证据文件（可选，多人共用）</label>
                  <DropZone
                    accept="image/*,.pdf,.doc,.docx"
                    multiple
                    className="compact"
                    title="拖入证据文件，或点击选择"
                    hint="支持图片 / PDF / Word，可多选"
                    onFiles={(files) => setBatchFiles(Array.from(files || []))}
                  />
                  {batchFiles.length > 0 && <span className="file-count">已选 {batchFiles.length} 个文件</span>}
                  <button type="submit" className="btn primary-btn" disabled={batchBusy}>
                    {batchBusy ? <><span className="spin" /> 提交中…</> : "批量加分（自动通过）"}
                  </button>
                </form>
                {batchResult && (
                  <div className="apply-result">
                    <h3>已为 {batchResult.length} 名学生自动通过并加分</h3>
                    {batchResult.map((r) => (
                      <div key={r.id} className="result-item">
                        <span className="badge">{r.category}</span>
                        <strong>{r.sid} {r.name} +{r.points}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
    </>
  );
}
