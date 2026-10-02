// pages/ManagePage.jsx — 纯展示组件：数据管理（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import TextField from "../components/TextField.jsx";
import DropZone from "../components/DropZone.jsx";
import FileChips from "../components/FileChips.jsx";
import Modal from "../components/Modal.jsx";

export default function ManagePage({manage, token, role, myClassId, classes, manageMsg}) {
  const {
    uploading, importOpen, setImportOpen, importErr, setImportErr, uploadClassId, setUploadClassId, uploadMsg, setUploadMsg,
    newClassName, setNewClassName, clearClassTarget, setClearClassTarget, deleteClassTarget, setDeleteClassTarget,
    evidenceZipClass, setEvidenceZipClass, zipping, scOpen, setScOpen, scClassId, setScClassId, scThreshold,
    setScThreshold, scFile, setScFile, scBusy, scMsg, setScMsg, handleUpload, handleClearClass, handleCreateClass,
    handleDeleteClass, handleExportZip, handleImportSecondClass,
  } = manage;
  return (
    <>
          <div className="panel">
            <h2>数据管理</h2>
            <p className="hint">奖学金评定的数据入口：导入成绩、第二课堂加分、证据归档与班级数据维护。</p>
            {manageMsg && <div className={`ai-msg ${manageMsg.type}`}>{manageMsg.text}</div>}
            <div className="ai-section">
              <h3>导入班级表格</h3>
              <p className="hint">把成绩 xlsx 拖进导入窗口即可替换该班级的榜单数据。</p>
              <button
                className="btn primary-btn"
                onClick={() => { setUploadMsg(""); setImportErr(""); setImportOpen(true); }}
              >
                打开导入窗口
              </button>
            </div>
            <div className="ai-section">
              <h3>第二课堂导入</h3>
              <p className="hint">上传第二课堂统计 xlsx（含「学号」「学分」列），对学分达到阈值的学生德育加 10 分并生成自动通过的德育申报记录；未达标与名单外学生不变。同一班级重复导入会自动先撤销上次加的 10 分再按新文件重加，不会重复累加。</p>
              <button
                className="btn primary-btn"
                onClick={() => { setScMsg(null); setScFile(null); setScOpen(true); }}
              >
                打开第二课堂导入窗口
              </button>
            </div>
            <div className="ai-section">
              <h3>申报证据导出</h3>
              <p className="hint">将已通过审批的申报按人打包：每人一个「学号_姓名」文件夹，内含该生申报明细 JSON 与全部证据文件，并附汇总 index.json，下载为 zip。</p>
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
        message={`确认清除 ${clearClassTarget ? clearClassTarget.name : ""} 的全部数据？该班级的榜单、申报记录（含已加分）与证据文件将被清空，需重新导入 xlsx 才能恢复榜单。`}
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
            <label>目标班级 *</label>
            <Dropdown
              value={uploadClassId}
              onChange={setUploadClassId}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="选择班级"
            />
          </>
        ) : (
          <p className="hint">将导入到本班：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
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
              <label>目标班级 *</label>
              <Dropdown
                value={scClassId}
                onChange={setScClassId}
                options={classes.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="选择班级"
              />
            </>
          ) : (
            <p className="hint">将导入到本班：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
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
    </>
  );
}
