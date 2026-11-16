// pages/ManagePage.jsx — 纯展示组件：数据管理（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import TextField from "../components/TextField.jsx";
import DropZone from "../components/DropZone.jsx";
import FileChips from "../components/FileChips.jsx";
import Modal from "../components/Modal.jsx";
import { SEMESTER_OPTIONS } from "../constants.js";

export default function ManagePage({manage, token, role, myClassId, classes, semesters, semesterSel, openSemesterId, manageMsg}) {
  const {
    uploading, importOpen, setImportOpen, importErr, setImportErr, uploadClassId, setUploadClassId, uploadMsg, setUploadMsg,
    newClassName, setNewClassName, clearClassTarget, setClearClassTarget, deleteClassTarget, setDeleteClassTarget,
    evidenceZipClass, setEvidenceZipClass, zipping, scOpen, setScOpen, scClassId, setScClassId, scThreshold,
    setScThreshold, scFile, setScFile, scBusy, scMsg, setScMsg, handleUpload, handleClearClass, handleCreateClass,
    handleDeleteClass, handleExportZip, handleImportSecondClass,
    semesterLabel, semesterBusy, semesterMsg, newSemesterLabel, setNewSemesterLabel, newSemesterTerm, setNewSemesterTerm,
    termEditTarget, setTermEditTarget, semesterDeleteTarget, setSemesterDeleteTarget,
    handleCreateSemester, handleOpenSemester, handleSaveSemesterTerm, handleDeleteSemester,
  } = manage;
  const openSemester = semesters.find((s) => s.id === openSemesterId) || null;
  const availableLabels = SEMESTER_OPTIONS.filter((o) => !semesters.some((s) => s.label === o.value));
  return (
    <>
          <div className="panel">
            <h2>数据管理</h2>
            <p className="hint">奖学金评定的数据入口：导入成绩、第二课堂加分、证据归档与班级数据维护。</p>
            <p className="hint">
              当前操作学期：<strong>{semesterLabel || "未选择"}</strong>
              {openSemester ? `（开放申报：${openSemester.label}）` : "（当前没有学期开放申报）"}
              {semesterLabel && openSemester && semesterSel !== openSemesterId
                ? "。注意：本页的导入与调分写入的是上方所选学期，不是开放申报学期。"
                : "。"}
            </p>
            {manageMsg && <div className={`ai-msg ${manageMsg.type}`}>{manageMsg.text}</div>}
            {role === "root" && (
              <div className="ai-section">
                <h3>学期管理</h3>
                <p className="hint">
                  一个学期一套独立的榜单与申报，班级跨学期复用；人员名单在每个学期单独导入。
                  同一时间只开放一个学期申报，学生提交会自动落到开放学期。
                </p>
                {semesterMsg && <div className={`ai-msg ${semesterMsg.type}`}>{semesterMsg.text}</div>}
                <div className="manage-list">
                  {semesters.map((s) => (
                    <div key={s.id} className="result-item">
                      <div className="ri-head">
                        <strong>{s.label}</strong>
                        {s.is_open && <span className="badge approved">开放申报</span>}
                        <span className="ri-sub">{s.term || "未填学年学期"}</span>
                      </div>
                      <div className="ri-actions">
                        <button
                          className="btn small"
                          disabled={semesterBusy || s.is_open}
                          onClick={() => handleOpenSemester(s)}
                        >{s.is_open ? "当前开放" : "开放申报"}</button>
                        <button
                          className="btn small ghost"
                          disabled={semesterBusy}
                          onClick={() => setTermEditTarget({ id: s.id, label: s.label, term: s.term || "" })}
                        >编辑学年</button>
                        <button
                          className="btn small danger"
                          disabled={semesterBusy || s.is_open}
                          title={s.is_open ? "正在开放申报，请先开放其他学期" : undefined}
                          onClick={() => setSemesterDeleteTarget({ id: s.id, label: s.label })}
                        >删除</button>
                      </div>
                    </div>
                  ))}
                  {semesters.length === 0 && <p className="hint">暂无学期。</p>}
                </div>
                {availableLabels.length > 0 ? (
                  <form className="apply-form" onSubmit={handleCreateSemester}>
                    <label>新增学期 *</label>
                    <div className="semester-create">
                      <Dropdown
                        value={newSemesterLabel}
                        onChange={setNewSemesterLabel}
                        options={availableLabels}
                        placeholder="选择学期档位"
                      />
                      <TextField
                        value={newSemesterTerm}
                        onChange={(e) => setNewSemesterTerm(e.target.value)}
                        placeholder="学年学期，如 26-27上学期（用于导出文件名）"
                        maxLength={32}
                      />
                      <button type="submit" className="btn primary-btn" disabled={semesterBusy}>创建学期</button>
                    </div>
                  </form>
                ) : (
                  <p className="hint">所有学期档位都已创建。</p>
                )}
              </div>
            )}
            <div className="ai-section">
              <h3>导入班级表格</h3>
              <p className="hint">把成绩 xlsx 拖进导入窗口即可替换该班级在 <b>{semesterLabel}</b> 的榜单数据（其他学期不受影响）。</p>
              <button
                className="btn primary-btn"
                onClick={() => { setUploadMsg(""); setImportErr(""); setImportOpen(true); }}
              >
                打开导入窗口
              </button>
            </div>
            <div className="ai-section">
              <h3>第二课堂导入</h3>
              <p className="hint">上传第二课堂统计 xlsx（含「学号」「学分」列），对学分达到阈值的学生德育加 10 分并生成自动通过的德育申报记录；未达标与名单外学生不变。同一班级同一学期重复导入会自动先撤销上次加的 10 分再按新文件重加，不会重复累加。</p>
              <button
                className="btn primary-btn"
                onClick={() => { setScMsg(null); setScFile(null); setScOpen(true); }}
              >
                打开第二课堂导入窗口
              </button>
            </div>
            <div className="ai-section">
              <h3>申报证据导出</h3>
              <p className="hint">将已通过审批的申报按人打包：每人一个「学号_姓名」文件夹，内含该生申报明细 JSON 与全部证据文件，并附汇总 index.json，下载为 zip。导出范围为当前学期（{semesterLabel}）。</p>
              {role === "root" ? (
                <>
                  <label>导出班级</label>
                  <Dropdown
                    value={evidenceZipClass}
                    onChange={setEvidenceZipClass}
                    options={[
                      { value: "", label: "全部班级" },
                      ...classes.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="选择班级"
                  />
                </>
              ) : (
                <p className="hint">你负责的班级：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
              )}
              {/* 按钮单独一行（.ai-actions 是横排容器）：否则会跟在上面「导出班级」下拉同一行，与其他分区的按钮不齐 */}
              <div className="ai-actions">
                <button type="button" className="btn primary-btn" onClick={handleExportZip} disabled={zipping || !token}>
                  {zipping ? <><span className="spin" /> 打包中…</> : "导出证据 zip"}
                </button>
              </div>
            </div>
            {role === "root" && (
              <div className="ai-section">
                <h3>班级管理</h3>
                <p className="hint">班级跨学期复用；下面的学生数、课程记录与来源按当前学期（{semesterLabel}）显示。</p>
                <div className="manage-list">
                  {classes.map((c) => (
                    <div key={c.id} className="result-item">
                      <div className="ri-head">
                        <strong>{c.name}</strong>
                        <span className="ri-sub">{c.students} 名学生</span>
                      </div>
                      <span className="ri-sub">{c.row_count ?? 0} 条课程记录 · {c.source || "未导入"}</span>
                      <div className="ri-actions">
                        <button
                          className="btn small danger"
                          disabled={c.students === 0}
                          onClick={() => setClearClassTarget({ id: c.id, name: c.name })}
                        >清除数据</button>
                        <button
                          className="btn small danger"
                          disabled={c.students > 0}
                          onClick={() => setDeleteClassTarget({ id: c.id, name: c.name })}
                          title={c.students > 0 ? "班级仍有学生，无法删除" : undefined}
                        >删除</button>
                      </div>
                    </div>
                  ))}
                  {classes.length === 0 && <p className="hint">暂无班级。</p>}
                </div>
                <form className="apply-form" onSubmit={handleCreateClass}>
                  <label>新增班级名称 *</label>
                  <TextField value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="如 251185Y3" />
                  <button type="submit" className="btn primary-btn">创建班级</button>
                </form>
              </div>
            )}
          </div>
      <Modal
        open={!!clearClassTarget}
        title="清除班级数据"
        message={`确认清除 ${clearClassTarget ? clearClassTarget.name : ""} 在 ${semesterLabel} 的全部数据？该学期的榜单、申报记录（含已加分）与证据文件将被清空，需重新导入 xlsx 才能恢复榜单。班费是跨学期账本，不受影响。`}
        danger
        confirmText="清除"
        onConfirm={handleClearClass}
        onCancel={() => setClearClassTarget(null)}
      />
      <Modal
        open={!!deleteClassTarget}
        title="删除班级"
        message={`确认删除班级 ${deleteClassTarget ? deleteClassTarget.name : ""}？该班学生、申报记录与已上传的证据文件将一并删除，不可恢复。`}
        danger
        confirmText="删除"
        onConfirm={() => { const target = deleteClassTarget; setDeleteClassTarget(null); handleDeleteClass(target.id); }}
        onCancel={() => setDeleteClassTarget(null)}
      />
      <Modal
        open={importOpen}
        size="lg"
        title="导入班级表格"
        showConfirm={false}
        cancelText="关闭"
        onCancel={() => { setImportOpen(false); setUploadMsg(""); setImportErr(""); }}
      >
        {role === "root" ? (
          <>
            <p className="hint">导入到学期：<b>{semesterLabel}</b>（在页面上方切换学期）</p>
            <label>目标班级 *</label>
            <Dropdown
              value={uploadClassId}
              onChange={setUploadClassId}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="选择班级"
            />
          </>
        ) : (
          <p className="hint">导入到：{semesterLabel} · {classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
        )}
        {role === "root" && !uploadClassId && (
          <p className="hint">请先在上方选择目标班级，再拖入或选择成绩 xlsx。</p>
        )}
        <DropZone
          accept=".xlsx"
          disabled={role === "root" && !uploadClassId}
          busy={uploading}
          busyText="导入中…"
          title="把成绩 xlsx 拖到这里"
          hint="或点击选择文件 · 导入会替换该班级现有榜单数据"
          onFiles={(files) => files && files[0] && handleUpload(files[0])}
        />
        {uploadMsg && <div className="ai-msg ok">{uploadMsg}</div>}
        {importErr && <div className="ai-msg err">{importErr}</div>}
      </Modal>
      <Modal
        open={scOpen}
        size="lg"
        title="第二课堂导入"
        showConfirm={false}
        cancelText="关闭"
        onCancel={() => { setScOpen(false); setScMsg(null); }}
      >
        <p className="hint">上传后对学分达到阈值的学生德育加 10 分，并生成自动通过的德育申报记录（申报列表可见）；重复导入自动先撤后加、不会重复累加。</p>
        <form className="apply-form" onSubmit={handleImportSecondClass}>
          {role === "root" ? (
            <>
              <p className="hint">导入到学期：<b>{semesterLabel}</b>（在页面上方切换学期）</p>
              <label>目标班级 *</label>
              <Dropdown
                value={scClassId}
                onChange={setScClassId}
                options={classes.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="选择班级"
              />
            </>
          ) : (
            <p className="hint">导入到：{semesterLabel} · {classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
          )}
          <label>达标阈值（学分 ≥ 阈值即达标）*</label>
          <TextField
            type="number"
            step="0.1"
            min="0"
            value={scThreshold}
            onChange={(e) => setScThreshold(e.target.value)}
          />
          <DropZone
            accept=".xlsx"
            disabled={scBusy}
            title="把第二课堂统计 xlsx 拖到这里"
            hint="或点击选择文件"
            onFiles={(files) => setScFile(files && files[0] ? files[0] : null)}
          />
          <FileChips files={scFile ? [scFile] : []} onRemove={() => setScFile(null)} />
          <button type="submit" className="btn primary-btn" disabled={scBusy}>
            {scBusy ? <><span className="spin" /> 导入中…</> : "导入并加分"}
          </button>
        </form>
        {scMsg && <div className={`ai-msg ${scMsg.type}`}>{scMsg.text}</div>}
      </Modal>
      <Modal
        open={!!termEditTarget}
        title={`编辑学年学期 · ${termEditTarget?.label || ""}`}
        showConfirm={false}
        cancelText="关闭"
        onCancel={() => setTermEditTarget(null)}
      >
        <form className="apply-form" onSubmit={handleSaveSemesterTerm}>
          <label>学年学期（用于导出文件名）</label>
          <TextField
            value={termEditTarget?.term || ""}
            onChange={(e) => setTermEditTarget((t) => (t ? { ...t, term: e.target.value } : t))}
            placeholder="如 26-27上学期"
            maxLength={32}
          />
          <button type="submit" className="btn primary-btn" disabled={semesterBusy}>保存</button>
        </form>
      </Modal>
      <Modal
        open={!!semesterDeleteTarget}
        title="删除学期"
        danger
        confirmText="删除"
        confirmDisabled={semesterBusy}
        message={`确认删除学期 ${semesterDeleteTarget?.label || ""}？仅在没有学生与申报数据时可以删除。`}
        onConfirm={handleDeleteSemester}
        onCancel={() => setSemesterDeleteTarget(null)}
      />
    </>
  );
}
