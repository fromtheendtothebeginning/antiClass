// pages/PassPage.jsx — 纯展示组件：加分一遍过（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import Modal from "../components/Modal.jsx";
import StudentInput from "../components/StudentInput.jsx";
import DropZone from "../components/DropZone.jsx";
import FileChips from "../components/FileChips.jsx";
import TextField from "../components/TextField.jsx";
import ManualItemForm from "../components/ManualItemForm.jsx";
import { renderMd } from "../utils/markdown.js";
import { isImage } from "../utils/img.js";
import { CATEGORY_OPTIONS } from "../constants.js";

export default function PassPage({chat, classes, classSel, handlePickClass, students, submitting}) {
  const {
    passSid, setPassSid, passSess, passMsgs, passItems, passBusy, passDone, passEnded, passInput, setPassInput,
    passErr, passWarn, passAttach, setPassAttach, passConfirmSubmit, setPassConfirmSubmit, passNoEvItems,
    setPassNoEvItems, manualOpen, setManualOpen, manualItem, setManualItem, recallIdx, setRecallIdx,
    recallTarget, setRecallTarget, recalling, chatBoxRef, passInputRef, handlePassStart, handlePassQuick,
    handlePassSend, addPassAttach, handlePassFinish, handlePassRecall, updatePassItem, removePassItem,
    handleAddManualItem, addPassItemFiles, removePassItemFile, removePassItemServerFile, handlePassSubmit,
  } = chat;
  return (
    <>
          <div className="panel">
            <h2>加分一遍过</h2>
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
            <div className="assess-wrap">
              {!passSess ? (
                <>
                  <div className="assess-intro">
                    <h3>加分一遍过 · AI 逐项问答</h3>
                    <p>
                      AI 将按照《综合奖学金评定办法》从德育、体育、美育、劳育到附加分，<strong>从头到尾逐项提问</strong>，
                      你逐项如实回答（如"获得过 XX 竞赛省级二等奖"），AI 依据原文条款实时判定能否加分并给出依据。
                    </p>
                    <ul className="hint">
                      <li>一次只回答当前问题；答"没有/无"会继续下一项；随时可点「结束询问」或回复"结束"。</li>
                      <li>智育成绩、班级活动出勤、第二课堂学分达标、班委任职等由统一流程认定，AI 不会询问、不在此加分。</li>
                      <li>全程流式输出，识别到的加分项会实时汇总在下方，可一键提交为待审批申报。</li>
                    </ul>
                    <p className="ai-peak-hint">请尽量不要在北京时间周一至周五 9:00 - 12:00、14:00 - 18:00 使用该功能</p>
                  </div>
                  <form className="apply-form" onSubmit={handlePassStart}>
                    <label>学号 *</label>
                    <StudentInput
                      value={passSid}
                      onChange={setPassSid}
                      students={students}
                      placeholder="如 251184Y313"
                    />
                    <button type="submit" className="btn primary-btn">
                      {passBusy ? <><span className="spin" /> 准备中…</> : "开始一遍过"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div className="assess-head">
                    <strong>{passSess.sid} {passSess.name} · 加分一遍过</strong>
                    {passDone && !passEnded && <span className="badge pending">询问完成 · 可补充一次</span>}
                    {passEnded && <span className="badge pending">对话已结束</span>}
                    {!passDone && (
                      <button className="btn small ghost" disabled={passBusy} onClick={handlePassFinish}>结束询问</button>
                    )}
                  </div>
                  <div className="chat-box" ref={chatBoxRef}>
                    {passMsgs.length === 0 && <p className="hint">正在等待 AI 提问…</p>}
                    {passMsgs.map((m, i) => (
                      <div key={i} className={`chat-msg ${m.role}${m.role === "user" && recallIdx === i ? " recall-open" : ""}`}>
                        {/* 撤回按钮常驻渲染，由 CSS 在「悬停整行 / 键盘聚焦 / 触屏点击固定」时显示。
                            recallIdx 仅作触屏兜底（无 hover 设备点气泡=常驻）。
                            流式输出中不渲染：此时撤回会把后续增量拼到已删除的消息上。 */}
                        {m.role === "user" && !passBusy && (
                          <button
                            type="button"
                            className="chat-undo"
                            title="撤回这条发言及其后的对话"
                            onClick={(e) => { e.stopPropagation(); setRecallTarget(i); }}
                          >↺ 撤回</button>
                        )}
                        <div
                          className="chat-bubble"
                          role={m.role === "user" ? "button" : undefined}
                          tabIndex={m.role === "user" ? 0 : undefined}
                          onClick={m.role === "user" ? () => !passBusy && setRecallIdx(recallIdx === i ? null : i) : undefined}
                          onKeyDown={
                            m.role === "user"
                              ? (e) => {
                                  if (e.key !== "Enter" && e.key !== " ") return;
                                  e.preventDefault();
                                  if (!passBusy) setRecallIdx(recallIdx === i ? null : i);
                                }
                              : undefined
                          }
                        >
                          {m.role === "ai" ? (
                            <div
                              className="markdown-body chat-md"
                              dangerouslySetInnerHTML={{ __html: renderMd((m.text || "…").split("==JSON==")[0]) }}
                            />
                          ) : (
                            <>
                              <div>{m.text || "…"}</div>
                              {m.files && m.files.length > 0 && (
                                <div className="chat-files">
                                  {m.files.map((fn) => (
                                    <span key={fn} className={`file-chip ${isImage(fn) ? "is-img" : ""}`}>
                                      {isImage(fn) ? "图片 " : "文件 "}{fn}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {passBusy && <p className="hint streaming-hint">AI 正在输出…</p>}
                  </div>

                  {passErr && <div className="error">{passErr}</div>}
                  {passWarn && <div className="error warn">{passWarn}</div>}

                  <div className="chat-actions">
                    <button
                      className="btn small"
                      disabled={passBusy || passDone || !passSess}
                      onClick={() => handlePassQuick("没有")}
                    >没有</button>
                    <button
                      className="btn small"
                      disabled={passBusy || passDone || !passSess}
                      onClick={() => handlePassQuick("确认")}
                    >确认</button>
                    <button
                      className="btn small"
                      disabled={passBusy || passDone || !passSess}
                      onClick={() => handlePassQuick("继续")}
                    >继续</button>
                  </div>
                  {passSess && !passEnded && (
                    <DropZone
                      className="slim"
                      multiple
                      disabled={passBusy}
                      title="拖入图片 / 文件，或点击选择（最多 5 个）"
                      hint=""
                      onFiles={addPassAttach}
                    />
                  )}
                  <form className="apply-form chat-form" onSubmit={handlePassSend}>
                    <TextField
                      ref={passInputRef}
                      value={passInput}
                      onChange={(e) => setPassInput(e.target.value)}
                      placeholder={
                        passBusy
                          ? "AI 正在输出，请稍候…"
                          : passDone && !passEnded
                            ? "还有要补充的吗？（这是最后一次补充，发送后对话结束）"
                            : passEnded
                              ? "对话已结束"
                              : "回答当前问题，可附证书/奖状图片，如：我获得了蓝桥杯省级二等奖"
                      }
                      disabled={passBusy || passEnded || !passSess}
                    />
                    <button
                      type="submit" className="btn small"
                      disabled={passBusy || passEnded || (!passInput.trim() && passAttach.length === 0)}
                    >{passDone && !passEnded ? "补充并结束" : "发送"}</button>
                  </form>
                  <FileChips
                    files={passAttach}
                    className="chat-attach-preview"
                    onRemove={(i) => setPassAttach((prev) => prev.filter((_, j) => j !== i))}
                  />

                  {passItems.length === 0 && (
                    <div className="assess-items edit">
                      <div className="assess-edit-head">
                        <span className="file-count">尚未识别到加分项</span>
                        <button className="btn small ghost" onClick={() => setManualOpen((v) => !v)}>
                          {manualOpen ? "收起" : "＋ 手动添加加分项"}
                        </button>
                      </div>
                      {manualOpen && (
                        <ManualItemForm value={manualItem} onChange={setManualItem} onSubmit={handleAddManualItem} />
                      )}
                    </div>
                  )}
                  {passItems.length > 0 && (
                    <div className="assess-items edit">
                      <div className="assess-edit-head">
                        <span className="file-count">加分项（{passItems.length}）· 可修改栏目/分值/依据并添加证据</span>
                        <button className="btn small ghost" onClick={() => setManualOpen((v) => !v)}>
                          {manualOpen ? "收起" : "＋ 手动添加加分项"}
                        </button>
                      </div>
                      {manualOpen && (
                        <ManualItemForm value={manualItem} onChange={setManualItem} onSubmit={handleAddManualItem} />
                      )}
                      {passItems.map((it, idx) => (
                        <div key={idx} className="assess-item-card">
                          <GlassSelect
                            value={it.category}
                            onChange={(v) => updatePassItem(idx, { category: v })}
                            options={CATEGORY_OPTIONS}
                          />
                          <input
                            type="number" step="0.5" min="0"
                            max={it.category === "附加分" ? 5 : 100}
                            value={it.points}
                            onChange={(e) => updatePassItem(idx, { points: e.target.value })}
                          />
                          <TextField
                            className="assess-basis"
                            value={it.basis}
                            onChange={(e) => updatePassItem(idx, { basis: e.target.value })}
                          />
                          <label className="btn small ghost assess-file-btn">
                            +证据
                            <input
                              type="file" multiple hidden
                              onChange={(e) => addPassItemFiles(idx, e.target.files)}
                            />
                          </label>
                          <button className="btn small danger" disabled={passBusy || submitting} onClick={() => removePassItem(idx)}>删</button>
                          {it.evidence && it.evidence.length > 0 && (
                            <div className="assess-evidence">
                              {it.evidence.map((f, fi) => (
                                <span key={fi} className="file-count">
                                  {f.name}
                                  <button className="link" onClick={() => removePassItemFile(idx, fi)}> ✕</button>
                                </span>
                              ))}
                            </div>
                          )}
                          {it.evServer && it.evServer.length > 0 && (
                            <div className="assess-evidence">
                              {it.evServer.map((f, fi) => (
                                <span key={`s${fi}`} className="file-count assess-ev-server" title="智能识别自动挂载的证据（已存服务器）">
                                  {f.replace(/^[0-9a-f]{32}_/, "").slice(0, 40)}
                                  <button className="link" onClick={() => removePassItemServerFile(idx, fi)}> ✕</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="assess-actions">
                    {passItems.length > 0 && (
                      <button className="btn primary-btn" disabled={submitting} onClick={handlePassSubmit}>
                        {submitting ? <><span className="spin" /> 提交中…</> : `提交 ${passItems.length} 条为待审批申报`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
      <Modal
        open={passConfirmSubmit}
        title="确认提交加分项？"
        danger
        confirmText="确认提交（结束流程）"
        cancelText="取消，继续筛查"
        onConfirm={handlePassSubmit}
        onCancel={() => { setPassConfirmSubmit(false); setPassNoEvItems([]); }}
      >
        <p><b>1. 是否已确认证据？</b>{passNoEvItems.length > 0
          ? <>以下 {passNoEvItems.length} 条加分项<b>尚未上传任何证据</b>（证书/截图等）。无证据提交仍会生成申报，但审批时可能因材料不足被驳回。</>
          : "当前加分项均已带证据。"}</p>
        {passNoEvItems.length > 0 && (
          <ul className="manage-list">
            {passNoEvItems.map((it, i) => (
              <li key={i} className="result-item">
                <span>{it.category}</span>
                <span>{it.points} 分</span>
                <span className="basis-preview">{(it.basis || "").slice(0, 40)}</span>
              </li>
            ))}
          </ul>
        )}
        <p><b>2. 提交后将结束本次流程。</b>如果还想继续筛查其他加分项，请点「取消，继续筛查」，等全部核对完再一起提交。</p>
      </Modal>
      <Modal
        open={recallTarget !== null}
        title="撤回这条发言？"
        danger
        confirmText="确认撤回"
        cancelText="取消"
        confirmDisabled={recalling}
        onConfirm={() => handlePassRecall(recallTarget)}
        onCancel={() => setRecallTarget(null)}
      >
        <p><b>1. 这条发言及其之后的所有对话会被删除。</b>AI 之后提出的问题、你的回答都将一并清除，你可以从这条重新回答。</p>
        <p><b>2. 其后 AI 已给出的加分项也会一并撤销。</b>它们会从下方加分项列表中移除；如需保留，请先记下内容或先点「手动添加加分项」。</p>
        <p><b>3. 这条发言的文字与附件会放回输入框。</b>可以修改后重新发送。</p>
      </Modal>
    </>
  );
}
