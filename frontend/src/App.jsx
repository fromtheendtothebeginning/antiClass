import { useEffect, useRef, useState } from "react";
import {
  adjustScores,
  analyzeAward,
  approveAward,
  batchAward,
  classCommitteeAward,
  clearClassData,
  createAdmin,
  createClass,
  deleteAdmin,
  deleteAward,
  deleteClass,
  editAward,
  evidenceUrl,
  exportExcel,
  fetchAdmins,
  fetchClasses,
  fetchLeaderboard,
  getAiSettings,
  listAiModels,
  listAwards,
  login,
  logout,
  manualAward,
  rejectAward,
  resetAiPrompts,
  saveAiPrompts,
  saveAiSettings,
  sendAssess,
  startAssess,
  submitAwards,
  submitAssess,
  testAi,
  uploadXlsx,
  withdrawAward,
  finishAssess
} from "./api.js";
import Modal from "./components/Modal.jsx";
import Reveal from "./components/Reveal.jsx";
import Dropdown from "./components/Dropdown.jsx";
import { renderMd } from "./utils/markdown.js";

const TOKEN_KEY = "token";
const ROLE_KEY = "role";
const MY_CLASS_KEY = "my_class_id";
const CATEGORIES = ["德育", "体育", "美育", "劳育", "附加分"];
const CC_ROLES = [
  { role: "班长、团支书、辅导员助理", points: 8 },
  { role: "副班长、学习委员", points: 4 },
  { role: "班级其他学干", points: 2 }
];
const IMG_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const STAGE_LABELS = {
  stage0: "阶段0 · 提示词优化与下位赛核实",
  stage1: "阶段1 · 加分项分类",
  stage2: "阶段2 · 按评分办法原文定分 *",
  stage3: "阶段3 · AI 定分审查（非审批） *"
};

function isImage(name) {
  return IMG_EXT.some((e) => name.toLowerCase().endsWith(e));
}

function AwardCard({ award, token, onRefresh, onPreview }) {
  const [category, setCategory] = useState(award.category);
  const [points, setPoints] = useState(String(award.points));
  const [basis, setBasis] = useState(award.basis || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = !!token;
  const isRejected = award.approved === "驳回";
  const statusClass = award.approved === "否" ? "pending" : award.approved === "是" ? "approved" : "rejected";
  const statusText = award.approved === "否" ? "待审批" : award.approved === "是" ? "已通过" : "已驳回";

  async function act(action, payload) {
    setBusy(true);
    setError("");
    try {
      if (action === "approve") {
        await approveAward(award.id, token, { category, points: parseFloat(points) || 0 });
      } else if (action === "reject") {
        await rejectAward(award.id, token, payload?.reason || "");
      } else if (action === "edit") {
        await editAward(award.id, { category, points: parseFloat(points) || 0, basis: basis.trim() }, token);
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
      <div className="award-head">
        <strong>{award.sid} {award.name}</strong>
        <span className={`badge ${statusClass}`}>{statusText}</span>
      </div>
      <div className="award-body">
        <div className="award-field">
          <span>加分栏目</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit || (award.approved !== "否" && !isRejected)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="award-field">
          <span>加分分值</span>
          <input
            type="number"
            step="0.5"
            min="0"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            disabled={!canEdit || (award.approved !== "否" && !isRejected)}
          />
        </div>
        <div className="award-field">
          <span>状态</span>
          <span className="created-at">{award.created_at}</span>
        </div>
        <div className="award-field wide">
          <span>加分依据</span>
          {isRejected && canEdit ? (
            <textarea value={basis} onChange={(e) => setBasis(e.target.value)} rows={3} />
          ) : (
            <p>{award.basis || "（无）"}</p>
          )}
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
      {canEdit && (
        <div className="award-actions">
          {award.approved === "否" && (
            <>
              <button className="btn small" disabled={busy} onClick={() => act("approve")}>通过</button>
              <button className="btn small danger" disabled={busy} onClick={() => setRejectOpen(true)}>驳回</button>
            </>
          )}
          {isRejected && (
            <>
              <button className="btn small" disabled={busy} onClick={() => setEditOpen(true)}>编辑并重新提交</button>
            </>
          )}
          {award.approved === "是" && (
            <button className="btn small" disabled={busy} onClick={() => act("withdraw")}>撤回</button>
          )}
          <button className="btn small ghost" disabled={busy} onClick={() => setConfirmDel(true)}>删除</button>
        </div>
      )}

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
        <textarea
          className="assess-basis modal-textarea"
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="例如：证据图片不清晰，请上传获奖证书原件后重新提交"
        />
      </Modal>

      <Modal
        open={editOpen}
        title={`编辑并重新提交（${award.sid} ${award.name}）`}
        message="保存后该申报将回到「待审批」状态，重新进入审批流程。"
        confirmText="保存并重新提交"
        confirmDisabled={!basis.trim()}
        onConfirm={() => { setEditOpen(false); act("edit"); }}
        onCancel={() => setEditOpen(false)}
      />

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

function DraftCard({ draft, submitting, onChangeItem, onSubmit, onPreview }) {
  return (
    <div className="draft-card">
      <div className="draft-head">
        <strong>{draft.sid} {draft.name} · AI 分类结果</strong>
        <button className="btn small" disabled={submitting} onClick={() => onSubmit(draft)}>
          提交此申报
        </button>
      </div>
      <p className="hint">请本人核对以下加分项的栏目、分值与依据，可修改后提交。</p>
      {draft.items.map((it, idx) => (
        <div key={idx} className="result-item draft-item">
          <select value={it.category} onChange={(e) => onChangeItem(draft.draft_id, idx, { category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.5"
            min="0"
            max={it.category === "附加分" ? 5 : 100}
            value={it.points}
            className="draft-points"
            onChange={(e) => onChangeItem(draft.draft_id, idx, { points: e.target.value })}
          />
          <input
            className="draft-basis"
            value={it.basis}
            placeholder="加分依据"
            onChange={(e) => onChangeItem(draft.draft_id, idx, { basis: e.target.value })}
          />
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
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [role, setRole] = useState(localStorage.getItem(ROLE_KEY) || "");
  const [myClassId, setMyClassId] = useState(localStorage.getItem(MY_CLASS_KEY) || "");
  const [tab, setTab] = useState("board");
  const [showLogin, setShowLogin] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [students, setStudents] = useState([]);
  const [meta, setMeta] = useState({});
  const [classes, setClasses] = useState([]);
  const [classSel, setClassSel] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadClassId, setUploadClassId] = useState("");
  const [awards, setAwards] = useState([]);
  const [awardQuery, setAwardQuery] = useState("");
  const [awardCategory, setAwardCategory] = useState("");
  const [awardStatus, setAwardStatus] = useState("");
  const fileRef = useRef(null);

  const [newClassName, setNewClassName] = useState("");
  const [adminsList, setAdminsList] = useState([]);
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [newAdminClass, setNewAdminClass] = useState("");
  const [manageMsg, setManageMsg] = useState(null);
  const [clearClassTarget, setClearClassTarget] = useState(null);

  const [applyType, setApplyType] = useState("ai");
  const [applySid, setApplySid] = useState("");
  const [applyText, setApplyText] = useState("");
  const [applyFiles, setApplyFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [preview, setPreview] = useState(null);

  const [passSid, setPassSid] = useState("");
  const [passSess, setPassSess] = useState(null);
  const [passMsgs, setPassMsgs] = useState([]);
  const [passItems, setPassItems] = useState([]);
  const [passBusy, setPassBusy] = useState(false);
  const [passDone, setPassDone] = useState(false);
  const [passEnded, setPassEnded] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passErr, setPassErr] = useState("");
  const [passWarn, setPassWarn] = useState("");
  const [passAttach, setPassAttach] = useState([]); // 聊天待发送附件（图片/文件）
  const [manualOpen, setManualOpen] = useState(false);
  const [manualItem, setManualItem] = useState({ category: "德育", points: "1", basis: "" });
  const chatBoxRef = useRef(null);

  const [ccSid, setCcSid] = useState("");
  const [ccRole, setCcRole] = useState(CC_ROLES[0].role);
  const [ccBusy, setCcBusy] = useState(false);
  const [ccResult, setCcResult] = useState(null);

  const [formSid, setFormSid] = useState("");
  const [formCategory, setFormCategory] = useState("德育");
  const [formPoints, setFormPoints] = useState("1");
  const [formBasis, setFormBasis] = useState("");
  const [formFiles, setFormFiles] = useState([]);
  const [formBusy, setFormBusy] = useState(false);
  const [formResult, setFormResult] = useState(null);

  const [adjSids, setAdjSids] = useState("");
  const [adjField, setAdjField] = useState("deyu");
  const [adjOp, setAdjOp] = useState("add");
  const [adjPoints, setAdjPoints] = useState("1");
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjResult, setAdjResult] = useState(null);

  const [aiMeta, setAiMeta] = useState(null);
  const [aiForm, setAiForm] = useState({ provider: "custom", base_url: "", model: "", searchProvider: "bing" });
  const [aiKey, setAiKey] = useState("");
  const [aiSearchKey, setAiSearchKey] = useState("");
  const [aiPrompts, setAiPrompts] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [promptViews, setPromptViews] = useState({});

  const [batchSids, setBatchSids] = useState("");
  const [batchCategory, setBatchCategory] = useState("德育");
  const [batchPoints, setBatchPoints] = useState("1");
  const [batchBasis, setBatchBasis] = useState("");
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState(null);

  const [uploadMsg, setUploadMsg] = useState(null);

  async function loadBoard(cid) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLeaderboard(cid);
      setStudents(data.students || []);
      setMeta(data.meta || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAwards() {
    setError("");
    try {
      const filter = role === "admin" ? myClassId : classSel;
      const data = await listAwards(filter || undefined);
      setAwards(data.awards || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadClasses() {
    try {
      const d = await fetchClasses();
      setClasses(d.classes || []);
      setClassSel((prev) => prev || (d.classes[0] ? d.classes[0].id : ""));
      setUploadClassId((prev) => prev || (role === "admin" && myClassId) || (d.classes[0] ? d.classes[0].id : ""));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadAdmins() {
    if (role !== "root") return;
    try {
      const d = await fetchAdmins(token);
      setAdminsList(d.admins || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadClasses().then(() => setMounted(true));
  }, [token, role, myClassId]);

  useEffect(() => {
    loadBoard(classSel);
    loadAwards();
  }, [token, classSel, role, myClassId]);

  // root 每次进入「管理」Tab 都刷新管理员账号列表，保证始终看到全部账号
  useEffect(() => {
    if (tab === "manage" && role === "root") loadAdmins();
  }, [tab, token, role]);

  // 一遍过聊天区：新内容到达后自动滚动到底部（窗口高度固定不随内容变化）
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [passMsgs, passBusy]);

  useEffect(() => {
    if (tab === "ai" && token && !aiMeta) {
      loadAiSettings();
    }
  }, [tab, token, aiMeta]);

  async function loadAiSettings() {
    setError("");
    try {
      const d = await getAiSettings(token);
      setAiMeta(d);
      setAiForm({
        provider: d.config.provider,
        base_url: d.config.base_url,
        model: d.config.model,
        searchProvider: d.config.search.provider
      });
      setAiPrompts(d.prompts);
      const p = d.providers.find((x) => x.id === d.config.provider);
      setAiModels(p ? p.models.map((m) => m.id) : []);
    } catch (err) {
      setError(err.message);
    }
  }

  function pickProvider(pid) {
    const p = aiMeta.providers.find((x) => x.id === pid);
    setAiForm((f) => ({
      ...f,
      provider: pid,
      base_url: p && p.base_url ? p.base_url : f.base_url,
      model: p && p.default_model ? p.default_model : f.model
    }));
    setAiModels(p ? p.models.map((m) => m.id) : []);
  }

  async function handleAiSave(e) {
    e.preventDefault();
    setAiBusy(true);
    setAiMsg(null);
    setError("");
    try {
      const d = await saveAiSettings(
        {
          provider: aiForm.provider,
          base_url: aiForm.base_url,
          model: aiForm.model,
          api_key: aiKey,
          search_provider: aiForm.searchProvider,
          search_api_key: aiSearchKey
        },
        token
      );
      setAiForm((f) => ({
        ...f,
        provider: d.config.provider,
        base_url: d.config.base_url,
        model: d.config.model,
        searchProvider: d.config.search.provider
      }));
      setAiKey("");
      setAiSearchKey("");
      setAiMeta((m) => (m ? { ...m, config: d.config } : m));
      setAiMsg({ type: "ok", text: "连接设置已保存，立即生效" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAiTest() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const d = await testAi(
        { provider: aiForm.provider, base_url: aiForm.base_url, model: aiForm.model, api_key: aiKey },
        token
      );
      setAiMsg(
        d.ok
          ? { type: "ok", text: `连接成功（${d.latency_ms}ms）` }
          : { type: "err", text: `连接失败：${d.error}` }
      );
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAiModels() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const d = await listAiModels(
        { provider: aiForm.provider, base_url: aiForm.base_url, api_key: aiKey },
        token
      );
      setAiModels(d.models);
      setAiMsg(
        d.ok
          ? { type: "ok", text: `已获取 ${d.models.length} 个可用模型（输入框可下拉选择）` }
          : { type: "err", text: d.error || "获取模型列表失败" }
      );
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  async function handleSavePrompts() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      await saveAiPrompts(aiPrompts, token);
      setAiMsg({ type: "ok", text: "提示词已保存，下次 AI 分析即生效" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  async function handleResetPrompts() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const d = await resetAiPrompts(token);
      setAiPrompts(d.prompts);
      setAiMsg({ type: "ok", text: "已恢复默认提示词" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    try {
      const data = await login(username, password);
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(ROLE_KEY, data.role || "");
      localStorage.setItem(MY_CLASS_KEY, data.class_id || "");
      setToken(data.token);
      setRole(data.role || "");
      setMyClassId(data.class_id || "");
      setPassword("");
      setShowLogin(false);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    logout(token);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(MY_CLASS_KEY);
    setToken("");
    setRole("");
    setMyClassId("");
    setShowLogin(false);
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const targetClass = uploadClassId || (role === "admin" ? myClassId : classes[0]?.id);
    if (!targetClass) {
      setError("请先创建班级");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const res = await uploadXlsx(file, token, targetClass);
      await loadClasses();
      await loadBoard(classSel);
      setUploadMsg(`导入成功：${res.students} 名学生，${res.rows} 条课程记录`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleExport() {
    setError("");
    try {
      await exportExcel(classSel);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearClass() {
    const target = clearClassTarget;
    setClearClassTarget(null);
    setManageMsg(null);
    try {
      await clearClassData(target.id, token);
      setManageMsg({ type: "ok", text: `已清除 ${target.name} 的榜单、申报与留痕数据` });
      await loadClasses();
      await loadBoard(classSel);
      await loadAwards();
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    setManageMsg(null);
    try {
      await createClass(newClassName, token);
      setNewClassName("");
      setManageMsg({ type: "ok", text: "班级已创建" });
      await loadClasses();
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleDeleteClass(cid) {
    setManageMsg(null);
    try {
      await deleteClass(cid, token);
      setManageMsg({ type: "ok", text: "班级已删除" });
      await loadClasses();
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleCreateAdmin(e) {
    e.preventDefault();
    setManageMsg(null);
    try {
      await createAdmin(
        { username: newAdminUser, password: newAdminPass, class_id: newAdminClass, role: "admin" },
        token
      );
      setNewAdminUser("");
      setNewAdminPass("");
      setManageMsg({ type: "ok", text: "管理员账号已创建" });
      await loadAdmins();
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleDeleteAdmin(username) {
    setManageMsg(null);
    try {
      await deleteAdmin(username, token);
      setManageMsg({ type: "ok", text: "账号已删除" });
      await loadAdmins();
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!applySid.trim()) {
      setError("请填写学号");
      return;
    }
    setAnalyzing(true);
    setError("");
    setSubmitMsg("");
    try {
      const data = await analyzeAward(applySid.trim(), applyText, applyFiles);
      setDrafts((prev) => [...prev, data]);
      setApplyText("");
      setApplyFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  // ---------- 加分一遍过（AI 逐项问答 · 流式） ----------
  async function handlePassStart(e) {
    e.preventDefault();
    if (!passSid.trim()) {
      setError("请填写学号");
      return;
    }
    setPassErr("");
    setError("");
    try {
      const data = await startAssess(passSid.trim());
      setPassSess(data);
      setPassMsgs([]);
      setPassItems([]);
      setPassAttach([]);
      setPassDone(false);
      setPassEnded(false);
      // 自动发送「开始」让 AI 提第一个问题（流式）
      await sendPassMsg(data.session_id, "开始");
    } catch (err) {
      setPassErr(err.message);
    }
  }

  // 快速回复：发送预设文本（如「没有」）——不带附件
  async function handlePassQuick(text) {
    if (passBusy || passEnded || !passSess) return;
    setPassInput("");
    setPassMsgs((prev) => [...prev, { role: "user", text }]);
    await sendPassMsg(passSess.session_id, text, []);
  }

  async function handlePassSend(e) {
    e.preventDefault();
    if (passBusy || (!passInput.trim() && passAttach.length === 0)) return;
    const text = passInput.trim();
    const files = passAttach;
    setPassInput("");
    setPassAttach([]);
    setPassMsgs((prev) => [...prev, { role: "user", text, files: files.map((f) => f.name) }]);
    await sendPassMsg(passSess.session_id, text, files);
  }

  function onPassAttach(e) {
    const files = Array.from(e.target.files || []).slice(0, 5);
    if (!files.length) return;
    setPassAttach((prev) => [...prev, ...files].slice(0, 5));
    e.target.value = "";
  }

  async function sendPassMsg(sessionId, text, files = []) {
    setPassBusy(true);
    setPassErr("");
    try {
      const res = await sendAssess(sessionId, text, files);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败（${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let ev;
            try {
              ev = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (ev.type === "delta" && ev.text) {
              setPassMsgs((prev) => {
                const arr = [...prev];
                const last = arr[arr.length - 1];
                if (last && last.role === "ai") {
                  arr[arr.length - 1] = { role: "ai", text: last.text + ev.text };
                } else {
                  arr.push({ role: "ai", text: ev.text });
                }
                return arr;
              });
            } else if (ev.type === "add" && ev.items) {
              const added = ev.items.map((it) => ({ ...it, evidence: [] }));
              setPassItems((prev) => [...prev, ...added]);
              setPassWarn("");
            } else if (ev.type === "warning") {
              setPassWarn(ev.text || "AI 判定可能有加分项但未能自动识别。");
            } else if (ev.type === "error") {
              setPassErr(ev.text || "请求失败");
            } else if (ev.type === "done") {
              if (ev.done) setPassDone(true);
              if (ev.ended) setPassEnded(true);
            }
          }
        }
      }
    } catch (err) {
      setPassErr(err.message);
    } finally {
      setPassBusy(false);
    }
  }

  async function handlePassFinish() {
    if (!passSess) return;
    try {
      await finishAssess(passSess.session_id);
      setPassDone(true);
      setPassEnded(true);
    } catch (err) {
      setPassErr(err.message);
    }
  }

  // ---------- 加分项编辑 ----------
  function updatePassItem(idx, patch) {
    setPassItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removePassItem(idx) {
    setPassItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleAddManualItem(e) {
    e.preventDefault();
    if (!manualItem.basis.trim()) {
      setPassWarn("请填写加分依据");
      return;
    }
    const it = {
      category: manualItem.category,
      points: parseFloat(manualItem.points) || 0,
      basis: manualItem.basis.trim(),
      evidence: []
    };
    setPassItems((prev) => [...prev, it]);
    setManualItem({ category: "德育", points: "1", basis: "" });
    setManualOpen(false);
    setPassWarn("");
  }

  function addPassItemFiles(idx, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setPassItems((prev) => prev.map((it, i) => (i === idx ? { ...it, evidence: [...it.evidence, ...files] } : it)));
  }

  function removePassItemFile(idx, fi) {
    setPassItems((prev) => prev.map((it, i) => (i === idx ? { ...it, evidence: it.evidence.filter((_, j) => j !== fi) } : it)));
  }

  async function handlePassSubmit() {
    if (!passSess || passItems.length === 0) return;
    const filesByIndex = {};
    passItems.forEach((it, i) => {
      if (it.evidence && it.evidence.length) filesByIndex[i] = it.evidence;
    });
    const itemsPayload = passItems.map((it) => ({
      category: it.category,
      points: parseFloat(it.points) || 0,
      basis: it.basis || ""
    }));
    setSubmitting(true);
    setPassErr("");
    try {
      const data = await submitAssess(passSess.session_id, itemsPayload, filesByIndex);
      setSubmitMsg(`一遍过完成：已提交 ${data.created.length} 条申报，等待管理员审批`);
      setPassSess(null);
      setPassMsgs([]);
      setPassItems([]);
      setPassDone(false);
      setPassEnded(false);
      setPassSid("");
      loadAwards();
    } catch (err) {
      setPassErr(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateDraftItem(draftId, idx, patch) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.draft_id === draftId
          ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
          : d
      )
    );
  }

  function buildSubmission(d) {
    return {
      draft_id: d.draft_id,
      items: d.items.map((it) => ({
        category: it.category,
        points: parseFloat(it.points) || 0,
        basis: it.basis,
        evidence: it.evidence
      }))
    };
  }

  async function doSubmit(submissions, submittedIds) {
    setSubmitting(true);
    setError("");
    try {
      const data = await submitAwards(submissions);
      setDrafts((prev) => prev.filter((d) => !submittedIds.includes(d.draft_id)));
      setSubmitMsg(`已提交 ${data.created.length} 条申报，等待管理员审批`);
      loadAwards();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function submitDraft(d) {
    doSubmit([buildSubmission(d)], [d.draft_id]);
  }

  function submitAll() {
    doSubmit(drafts.map(buildSubmission), drafts.map((d) => d.draft_id));
  }

  async function handleManual(e) {
    e.preventDefault();
    if (!formSid.trim()) {
      setError("请填写学号");
      return;
    }
    if (!formBasis.trim()) {
      setError("请填写加分依据");
      return;
    }
    setFormBusy(true);
    setError("");
    setFormResult(null);
    try {
      const data = await manualAward(formSid.trim(), formCategory, formPoints || "0", formBasis, formFiles);
      setFormResult(data.created);
      setFormBasis("");
      setFormFiles([]);
      loadAwards();
    } catch (err) {
      setError(err.message);
    } finally {
      setFormBusy(false);
    }
  }

  async function handleAdjust(e) {
    e.preventDefault();
    if (!adjSids.trim()) {
      setError("请填写学号（支持正则）");
      return;
    }
    setAdjBusy(true);
    setError("");
    setAdjResult(null);
    try {
      const data = await adjustScores(
        { sids: adjSids, field: adjField, op: adjOp, points: parseFloat(adjPoints) || 0 },
        token
      );
      setAdjResult(data.changed);
      await loadBoard();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdjBusy(false);
    }
  }

  async function handleClassCommittee(e) {
    e.preventDefault();
    if (!ccSid.trim()) {
      setError("请填写学号");
      return;
    }
    setCcBusy(true);
    setError("");
    setCcResult(null);
    try {
      const data = await classCommitteeAward(ccSid.trim(), ccRole, []);
      setCcResult(data.created);
      loadAwards();
    } catch (err) {
      setError(err.message);
    } finally {
      setCcBusy(false);
    }
  }

  async function handleBatch(e) {
    e.preventDefault();
    if (!batchSids.trim()) {
      setError("请填写学号（可多个）");
      return;
    }
    if (!batchBasis.trim()) {
      setError("请填写加分依据");
      return;
    }
    setBatchBusy(true);
    setError("");
    setBatchResult(null);
    try {
      const data = await batchAward(
        {
          sids: batchSids,
          category: batchCategory,
          points: batchPoints || "0",
          basis: batchBasis,
          files: batchFiles
        },
        token
      );
      setBatchResult(data.created);
      setBatchFiles([]);
      loadAwards();
    } catch (err) {
      setError(err.message);
    } finally {
      setBatchBusy(false);
    }
  }

  function switchTab(next) {
    setTab(next);
    setError("");
    if (next === "approve") loadAwards();
  }

  const pendingCount = awards.filter((a) => a.approved === "否").length;
  const awardQueryTrim = awardQuery.trim();
  const awardTokens = awardQueryTrim ? awardQueryTrim.split(/\s+/).filter(Boolean) : [];
  const awardTokenHit = (a, t) => {
    let re = null;
    try {
      re = new RegExp(t, "i");
    } catch {
      re = null; // 无效正则回退为普通包含匹配
    }
    return re
      ? re.test(a.sid) || re.test(a.name || "")
      : a.sid.toLowerCase().includes(t.toLowerCase()) || (a.name || "").toLowerCase().includes(t.toLowerCase());
  };
  const filteredAwards = awards.filter((a) => {
    if (awardTokens.length && !awardTokens.some((t) => awardTokenHit(a, t))) {
      return false; // 模糊搜索：空格分隔的多个片段，任一片段命中即通过
    }
    return (!awardCategory || a.category === awardCategory) && (!awardStatus || a.approved === awardStatus);
  });
  const awardStudentOptions = [
    ...new Map(awards.map((a) => [a.sid, `${a.sid} ${a.name}`])).values(),
  ];

  return (
    <div className={`page${mounted ? " mounted" : ""}`}>
      <div className="bg-grid" />
      <div className="bg-glow glow-1" />
      <div className="bg-glow glow-2" />
      <header className="topbar">
        <div className="brand">
          <h1>综合奖学金评定</h1>
          <span className="meta">
            {meta.source ? `数据来源：${meta.source}` : "暂无数据"} · 共 {meta.rows ?? 0} 条课程记录 · {students.length} 名学生
          </span>
        </div>
        <div className="actions">
          <button className="btn" onClick={handleExport}>导出 Excel</button>
          {token ? (
            <button className="btn ghost" onClick={handleLogout}>退出登录</button>
          ) : (
            <button className="btn" onClick={() => setShowLogin(!showLogin)}>
              {showLogin ? "取消" : "管理员登录"}
            </button>
          )}
        </div>
      </header>

      {showLogin && !token && (
        <form className="login-card inline" onSubmit={handleLogin}>
          <h2>管理员登录</h2>
          <label>账号</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入管理员账号"
            autoComplete="username"
          />
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入管理员密码"
            autoComplete="current-password"
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" className="primary">登 录</button>
        </form>
      )}

      <nav className="tabs">
        <button className={tab === "board" ? "tab active" : "tab"} onClick={() => switchTab("board")}>榜单</button>
        <button className={tab === "apply" ? "tab active" : "tab"} onClick={() => switchTab("apply")}>加分申报</button>
        <button className={tab === "pass" ? "tab active" : "tab"} onClick={() => switchTab("pass")}>加分一遍过</button>
        <button className={tab === "approve" ? "tab active" : "tab"} onClick={() => switchTab("approve")}>
          加分审批{pendingCount > 0 ? `（${pendingCount}）` : ""}
        </button>
        {token && (
          <button className={tab === "manage" ? "tab active" : "tab"} onClick={() => switchTab("manage")}>管理</button>
        )}
        {token && role === "root" && (
          <button className={tab === "ai" ? "tab active" : "tab"} onClick={() => switchTab("ai")}>AI 设置</button>
        )}
      </nav>

      <datalist id="student-list">
        {students.map((s) => (
          <option key={s.sid} value={s.sid}>{s.name}</option>
        ))}
      </datalist>

      {error && !showLogin && <div className="error bar">{error}</div>}

      <main>
        {tab === "pass" && (
          <div className="panel">
            <h2>加分一遍过</h2>
            {classes.length > 1 && (
              <div className="class-bar">
                <label>当前班级</label>
                <Dropdown
                  value={classSel}
                  onChange={setClassSel}
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
                    <input
                      list="student-list"
                      value={passSid}
                      onChange={(e) => setPassSid(e.target.value)}
                      placeholder="如 251184Y313"
                    />
                    <button type="submit" className="btn primary-btn">
                      {passBusy ? "准备中…" : "开始一遍过"}
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
                      <div key={i} className={`chat-msg ${m.role}`}>
                        <div className="chat-bubble">
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
                  <form className="apply-form chat-form" onSubmit={handlePassSend}>
                    <input
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
                    <label className="btn small ghost chat-attach-btn" title="上传图片/文件供 AI 识别">
                      附件
                      <input type="file" multiple hidden onChange={onPassAttach} disabled={passBusy || passEnded || !passSess} />
                    </label>
                    <button
                      type="submit" className="btn small"
                      disabled={passBusy || passEnded || (!passInput.trim() && passAttach.length === 0)}
                    >{passDone && !passEnded ? "补充并结束" : "发送"}</button>
                  </form>
                  {passAttach.length > 0 && (
                    <div className="chat-attach-preview">
                      {passAttach.map((f, fi) => (
                        <span key={fi} className="file-chip">
                          {f.name}
                          <button type="button" className="chip-x" onClick={() => setPassAttach((prev) => prev.filter((_, i) => i !== fi))}>×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  {passItems.length === 0 && (
                    <div className="assess-items edit">
                      <div className="assess-edit-head">
                        <span className="file-count">尚未识别到加分项</span>
                        <button className="btn small ghost" onClick={() => setManualOpen((v) => !v)}>
                          {manualOpen ? "收起" : "＋ 手动添加加分项"}
                        </button>
                      </div>
                      {manualOpen && (
                        <form className="assess-item-card" onSubmit={handleAddManualItem}>
                          <select
                            value={manualItem.category}
                            onChange={(e) => setManualItem({ ...manualItem, category: e.target.value })}
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <input
                            type="number" step="0.5" min="0"
                            max={manualItem.category === "附加分" ? 5 : 100}
                            value={manualItem.points}
                            onChange={(e) => setManualItem({ ...manualItem, points: e.target.value })}
                          />
                          <input
                            className="assess-basis"
                            placeholder="加分依据（引用原文条款）"
                            value={manualItem.basis}
                            onChange={(e) => setManualItem({ ...manualItem, basis: e.target.value })}
                          />
                          <button type="submit" className="btn small">添加</button>
                        </form>
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
                        <form className="assess-item-card" onSubmit={handleAddManualItem}>
                          <select
                            value={manualItem.category}
                            onChange={(e) => setManualItem({ ...manualItem, category: e.target.value })}
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <input
                            type="number" step="0.5" min="0"
                            max={manualItem.category === "附加分" ? 5 : 100}
                            value={manualItem.points}
                            onChange={(e) => setManualItem({ ...manualItem, points: e.target.value })}
                          />
                          <input
                            className="assess-basis"
                            placeholder="加分依据（引用原文条款）"
                            value={manualItem.basis}
                            onChange={(e) => setManualItem({ ...manualItem, basis: e.target.value })}
                          />
                          <button type="submit" className="btn small">添加</button>
                        </form>
                      )}
                      {passItems.map((it, idx) => (
                        <div key={idx} className="assess-item-card">
                          <select
                            value={it.category}
                            onChange={(e) => updatePassItem(idx, { category: e.target.value })}
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <input
                            type="number" step="0.5" min="0"
                            max={it.category === "附加分" ? 5 : 100}
                            value={it.points}
                            onChange={(e) => updatePassItem(idx, { points: e.target.value })}
                          />
                          <input
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
                          <button className="btn small danger" onClick={() => removePassItem(idx)}>删</button>
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
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="assess-actions">
                    {passItems.length > 0 && (
                      <button className="btn primary-btn" disabled={submitting} onClick={handlePassSubmit}>
                        {submitting ? "提交中…" : `提交 ${passItems.length} 条为待审批申报`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {tab === "board" && (
          <>
            <div className="promo-bar">
              <span className="promo-text">
                想核对还有哪些项目能加分？试试<b>「加分一遍过」</b>——AI 按评定办法逐项提问，当场确认加分项。
              </span>
              <button className="btn small" onClick={() => switchTab("pass")}>去加分一遍过 →</button>
            </div>
            {classes.length > 1 && (
              <div className="class-bar">
                <label>班级</label>
                <Dropdown
                  value={classSel}
                  onChange={setClassSel}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择班级"
                />
              </div>
            )}
            {loading ? (
              <div className="loading">加载中…</div>
            ) : (
              <div className="table-wrap">
                <table className="board">
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>学号</th>
                      <th>姓名</th>
                      <th>德育</th>
                      <th>智育</th>
                      <th>体育</th>
                      <th>美育</th>
                      <th>劳育</th>
                      <th>附加分</th>
                      <th>综合测评成绩</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.sid} style={{ "--i": s.rank - 1 }} className={s.rank <= 3 ? `top top-${s.rank}` : ""}>
                        <td className="rank">{s.rank}</td>
                        <td>{s.sid}</td>
                        <td className="name">{s.name}</td>
                        <td>{s.deyu.toFixed(1)}</td>
                        <td className="score">{s.score.toFixed(1)}</td>
                        <td>{s.tiyu.toFixed(1)}</td>
                        <td>{s.meiyu.toFixed(1)}</td>
                        <td>{s.laoyu.toFixed(1)}</td>
                        <td>{s.fujia.toFixed(1)}</td>
                        <td className="total">{s.total.toFixed(2)}</td>
                      </tr>
                    ))}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={10} className="empty">暂无数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="formula">
              综合测评成绩 = 德育×15% + 智育×60% + 体育×10% + 美育×5% + 劳育×10% + 附加分（≤5）。
              榜单公开查看；德育/美育/劳育默认 70（基础分），附加分默认 0，体育取体育课成绩。
              {token
                ? "分数调整请使用「加分申报 → 分数调整」表单，支持正则批量选人并留痕。"
                : "管理员登录后可在「加分申报」页导入 xlsx、批量加分和调整分数。"}
            </p>
          </>
        )}

        {tab === "apply" && (
          <div className="panel">
            <h2>加分申报</h2>
            {classes.length > 1 && (
              <div className="class-bar">
                <label>当前班级</label>
                <Dropdown
                  value={classSel}
                  onChange={setClassSel}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择班级"
                />
              </div>
            )}
            <p className="hint">
              选择申报类型：AI 智能分类支持填学号 + 自然语言描述 + 上传奖状/证书图片或文件，AI 分析后请本人核对加分项再提交审批（支持一键提交全部）；传统表单可直接提交申报；班委加分可快速生成班级职务的德育加分申报；想要 AI 按评分办法逐项询问请使用顶部「加分一遍过」。学号输入框支持自动补全。
            </p>
            <div className="type-tabs">
              <button className={applyType === "ai" ? "tab active" : "tab"} onClick={() => setApplyType("ai")}>AI 智能分类</button>
              <button className={applyType === "form" ? "tab active" : "tab"} onClick={() => setApplyType("form")}>传统表单申报</button>
              <button className={applyType === "cc" ? "tab active" : "tab"} onClick={() => setApplyType("cc")}>班委加分</button>
              {token && (
                <button className={applyType === "batch" ? "tab active" : "tab"} onClick={() => setApplyType("batch")}>批量加分（管理员）</button>
              )}
              {token && (
                <button className={applyType === "adjust" ? "tab active" : "tab"} onClick={() => setApplyType("adjust")}>分数调整（管理员）</button>
              )}
            </div>

            {applyType === "ai" ? (
              <>
                <form className="apply-form" onSubmit={handleAnalyze}>
                  <label>学号 *</label>
                  <input
                    list="student-list"
                    value={applySid}
                    onChange={(e) => setApplySid(e.target.value)}
                    placeholder="如 251184Y313"
                  />
                  <label>情况描述</label>
                  <textarea
                    rows={4}
                    value={applyText}
                    onChange={(e) => setApplyText(e.target.value)}
                    placeholder="例如：获得2025年全国大学生电子设计竞赛省级二等奖，见证书图片；或：我担任班长，任职满六个月"
                  />
                  <label>上传证据（图片/文件，可多选）</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => setApplyFiles(Array.from(e.target.files || []))}
                  />
                  {applyFiles.length > 0 && (
                    <span className="file-count">已选 {applyFiles.length} 个文件</span>
                  )}
                  <span className="file-count ai-peak-hint">
                    请尽量不要在北京时间周一至周五 9:00 - 12:00、14:00 - 18:00 使用该功能
                  </span>
                  <button type="submit" className="btn primary-btn" disabled={analyzing}>
                    {analyzing ? "AI 分析中…" : "AI 分析"}
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
                        onSubmit={submitDraft}
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
                  <input
                    list="student-list"
                    value={formSid}
                    onChange={(e) => setFormSid(e.target.value)}
                    placeholder="如 251184Y313"
                  />
                  <label>加分栏目 *</label>
                  <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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
                  <textarea
                    rows={3}
                    value={formBasis}
                    onChange={(e) => setFormBasis(e.target.value)}
                    placeholder="例如：获校级三好学生荣誉称号，加2分"
                  />
                  <label>上传证据（可选，图片/文件）</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => setFormFiles(Array.from(e.target.files || []))}
                  />
                  {formFiles.length > 0 && <span className="file-count">已选 {formFiles.length} 个文件</span>}
                  <button type="submit" className="btn primary-btn" disabled={formBusy}>
                    {formBusy ? "提交中…" : "提交申报"}
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
                  <input
                    list="student-list"
                    value={ccSid}
                    onChange={(e) => setCcSid(e.target.value)}
                    placeholder="如 251184Y313"
                  />
                  <label>班委职务 *</label>
                  <select value={ccRole} onChange={(e) => setCcRole(e.target.value)}>
                    {CC_ROLES.map((r) => (
                      <option key={r.role} value={r.role}>{r.role}（+{r.points}）</option>
                    ))}
                  </select>
                  <p className="hint">任职满六个月；班委加分计入德育板块。</p>
                  <button type="submit" className="btn primary-btn" disabled={ccBusy}>
                    {ccBusy ? "提交中…" : "提交班委加分"}
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
                  <textarea
                    rows={2}
                    value={adjSids}
                    onChange={(e) => setAdjSids(e.target.value)}
                    placeholder="251184Y330, 251184Y3[12]"
                  />
                  <label>分数项 *</label>
                  <select value={adjField} onChange={(e) => setAdjField(e.target.value)}>
                    <option value="deyu">德育</option>
                    <option value="meiyu">美育</option>
                    <option value="laoyu">劳育</option>
                    <option value="fujia">附加分</option>
                  </select>
                  <label>操作 *</label>
                  <select value={adjOp} onChange={(e) => setAdjOp(e.target.value)}>
                    <option value="add">增加</option>
                    <option value="sub">减少</option>
                    <option value="set">设为</option>
                  </select>
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
                    {adjBusy ? "调整中…" : "执行调整"}
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
                  <textarea
                    rows={3}
                    value={batchSids}
                    onChange={(e) => setBatchSids(e.target.value)}
                    placeholder="251184Y313,251184Y325,251184Y331"
                  />
                  <label>加分栏目 *</label>
                  <select value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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
                  <textarea
                    rows={3}
                    value={batchBasis}
                    onChange={(e) => setBatchBasis(e.target.value)}
                    placeholder="例如：校级优秀志愿者表彰（每生加3分）"
                  />
                  <label>证据文件（可选，多人共用）</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => setBatchFiles(Array.from(e.target.files || []))}
                  />
                  {batchFiles.length > 0 && <span className="file-count">已选 {batchFiles.length} 个文件</span>}
                  <button type="submit" className="btn primary-btn" disabled={batchBusy}>
                    {batchBusy ? "提交中…" : "批量生成加分申报"}
                  </button>
                </form>
                {batchResult && (
                  <div className="apply-result">
                    <h3>已为 {batchResult.length} 名学生生成待审批申报</h3>
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
        )}

        {tab === "approve" && (
          <div className="panel">
            <h2>加分审批</h2>
            {role !== "admin" && classes.length > 1 && (
              <div className="class-bar">
                <label>班级</label>
                <Dropdown
                  value={classSel}
                  onChange={setClassSel}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择班级"
                />
              </div>
            )}
            {role === "admin" && (
              <p className="hint">当前班级：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}（管理员仅能查看和审批本班申报）</p>
            )}
            <p className="hint">
              申报公示公开，任何人可查看依据与证据；仅管理员登录后可审批（通过/驳回/撤回/删除）。
              {!token && " 点击右上角「管理员登录」进行审批。"}
            </p>
            <div className="filter-bar">
              <input
                className="filter-input"
                placeholder="学号 / 姓名（支持正则与空格分隔模糊搜索）"
                value={awardQuery}
                list="award-student-list"
                onChange={(e) => setAwardQuery(e.target.value)}
              />
              <datalist id="award-student-list">
                {awardStudentOptions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <Dropdown
                value={awardCategory}
                onChange={setAwardCategory}
                options={[{ value: "", label: "全部分类" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
                placeholder="全部分类"
              />
              <Dropdown
                value={awardStatus}
                onChange={setAwardStatus}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "否", label: "待审批" },
                  { value: "是", label: "已通过" },
                  { value: "驳回", label: "已驳回" }
                ]}
                placeholder="全部状态"
              />
              <span className="file-count">共 {filteredAwards.length} 条</span>
            </div>
            {awards.length === 0 ? (
              <p className="hint">暂无申报记录。</p>
            ) : filteredAwards.length === 0 ? (
              <p className="hint">没有符合筛选条件的申报。</p>
            ) : (
              filteredAwards.map((a, i) => (
                <Reveal key={a.id} delay={(i % 10) * 70}>
                  <AwardCard award={a} token={token} onRefresh={() => { loadAwards(); loadBoard(); }} onPreview={(aid, f) => setPreview({ aid, file: f })} />
                </Reveal>
              ))
            )}
          </div>
        )}
        {tab === "manage" && token && (
          <div className="panel">
            <h2>管理</h2>
            {manageMsg && <div className={`ai-msg ${manageMsg.type}`}>{manageMsg.text}</div>}
            <div className="ai-section">
              <h3>导入班级表格</h3>
              <form className="apply-form" onSubmit={(e) => e.preventDefault()}>
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
                  <p className="hint">你负责的班级：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}</p>
                )}
                <label>成绩 xlsx *</label>
                <input ref={fileRef} type="file" accept=".xlsx" onChange={handleUpload} disabled={uploading} />
                <span className="file-count">{uploading ? "导入中…" : "导入会替换该班级现有榜单数据"}</span>
              </form>
            </div>
            {role === "root" && (
              <>
                <div className="ai-section">
                  <h3>班级管理</h3>
                  <div className="manage-list">
                    {classes.map((c) => (
                      <div key={c.id} className="result-item">
                        <strong>{c.name}</strong>
                        <span>{c.students} 名学生</span>
                        <span>{c.row_count ?? 0} 条课程记录 · {c.source || "未导入"}</span>
                        <button
                          className="btn small danger"
                          disabled={c.students === 0}
                          onClick={() => setClearClassTarget({ id: c.id, name: c.name })}
                        >清除数据</button>
                        <button className="btn small danger" disabled={c.students > 0} onClick={() => handleDeleteClass(c.id)} title={c.students > 0 ? "班级仍有学生，无法删除" : undefined}>删除</button>
                      </div>
                    ))}
                    {classes.length === 0 && <p className="hint">暂无班级。</p>}
                  </div>
                  <form className="apply-form" onSubmit={handleCreateClass}>
                    <label>新增班级名称 *</label>
                    <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="如 251185Y3" />
                    <button type="submit" className="btn primary-btn">创建班级</button>
                  </form>
                </div>
                <div className="ai-section">
                  <h3>管理员账号</h3>
                  <p className="hint">每个管理员只能管理其负责班级的榜单、申报审批与分数调整。</p>
                  <div className="manage-list">
                    {adminsList.map((a) => (
                      <div key={a.username} className="result-item">
                        <strong>{a.username}</strong>
                        <span className="badge">{a.role === "root" ? "root" : "管理员"}</span>
                        <span>{classes.find((c) => c.id === a.class_id)?.name || "全部班级"}</span>
                        {a.role !== "root" && (
                          <button className="btn small danger" onClick={() => handleDeleteAdmin(a.username)}>删除</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <form className="apply-form" onSubmit={handleCreateAdmin}>
                    <label>用户名 *</label>
                    <input value={newAdminUser} onChange={(e) => setNewAdminUser(e.target.value)} placeholder="3-32 位字母/数字/下划线" />
                    <label>初始密码 *</label>
                    <input type="password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} placeholder="至少 6 位" autoComplete="off" />
                    <label>负责班级 *</label>
                    <Dropdown
                      value={newAdminClass}
                      onChange={setNewAdminClass}
                      options={classes.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="请选择班级"
                    />
                    <button type="submit" className="btn primary-btn">创建管理员</button>
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "ai" && token && (
          <div className="panel">
            <h2>AI 设置</h2>
            <p className="hint">
              仅管理员可见。连接设置与提示词保存后立即生效（无需重启）；API Key 只显示脱敏形式，留空表示保持不变。
            </p>
            {aiMsg && <div className={`ai-msg ${aiMsg.type}`}>{aiMsg.text}</div>}
            {aiMeta && aiPrompts && (
              <>
                <div className="ai-section">
                  <h3>连接</h3>
                  <form className="apply-form" onSubmit={handleAiSave}>
                    <label>提供商</label>
                    <select value={aiForm.provider} onChange={(e) => pickProvider(e.target.value)}>
                      {aiMeta.providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <label>Base URL *</label>
                    <input
                      value={aiForm.base_url}
                      onChange={(e) => setAiForm({ ...aiForm, base_url: e.target.value })}
                      placeholder="https://api.deepseek.com"
                    />
                    <label>API Key{aiMeta.config.has_key ? `（已保存 ${aiMeta.config.api_key_masked}，留空保持不变）` : " *"}</label>
                    <input
                      type="password"
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder={aiMeta.config.has_key ? "留空保持现有 Key" : "sk-…"}
                      autoComplete="off"
                    />
                    <label>模型 *（标 ★ 为支持识图，加分申报需识图模型）</label>
                    <input
                      list="ai-model-list"
                      value={aiForm.model}
                      onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })}
                      placeholder="deepseek-v4-flash-vision-exp"
                    />
                    <datalist id="ai-model-list">
                      {aiModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    {aiForm.provider !== "custom" && (
                      <span className="file-count">
                        注册表模型：{aiMeta.providers.find((p) => p.id === aiForm.provider).models.map((m) => (m.vision ? `★${m.id}` : m.id)).join("、")}
                      </span>
                    )}
                    <label>联网搜索源</label>
                    <select value={aiForm.searchProvider} onChange={(e) => setAiForm({ ...aiForm, searchProvider: e.target.value })}>
                      {aiMeta.search_providers.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {aiForm.searchProvider === "tavily" && (
                      <>
                        <label>Tavily API Key{aiMeta.config.search.has_key ? `（已保存 ${aiMeta.config.search.api_key_masked}，留空保持不变）` : ""}</label>
                        <input
                          type="password"
                          value={aiSearchKey}
                          onChange={(e) => setAiSearchKey(e.target.value)}
                          autoComplete="off"
                        />
                      </>
                    )}
                    <div className="ai-actions">
                      <button type="submit" className="btn primary-btn" disabled={aiBusy}>保存连接设置</button>
                      <button type="button" className="btn" disabled={aiBusy} onClick={handleAiTest}>测试连接</button>
                      <button type="button" className="btn ghost" disabled={aiBusy} onClick={handleAiModels}>获取模型列表</button>
                    </div>
                  </form>
                </div>
                <div className="ai-section">
                  <h3>提示词（AI 定分管线四阶段）</h3>
                  <p className="hint">
                    系统会在每个提示词末尾自动附加「不可信内容警示」防提示词注入，无需自行添加；带 * 的占位符为运行时注入变量，不可删除。
                  </p>
                  {["stage0", "stage1", "stage2", "stage3"].map((stage) => (
                    <div key={stage} className="prompt-block">
                      <label>
                        {STAGE_LABELS[stage]}
                        {aiMeta.placeholders[stage].length > 0 && (
                          <em className="file-count">　必需占位符：{aiMeta.placeholders[stage].join(" ")}</em>
                        )}
                      </label>
                      <div className="type-tabs md-toggle">
                        <button
                          className={promptViews[stage] !== "preview" ? "tab active" : "tab"}
                          onClick={() => setPromptViews((v) => ({ ...v, [stage]: "edit" }))}
                        >编辑</button>
                        <button
                          className={promptViews[stage] === "preview" ? "tab active" : "tab"}
                          onClick={() => setPromptViews((v) => ({ ...v, [stage]: "preview" }))}
                        >预览</button>
                      </div>
                      {promptViews[stage] === "preview" ? (
                        <div
                          className="markdown-body"
                          dangerouslySetInnerHTML={{ __html: renderMd(aiPrompts[stage]) }}
                        />
                      ) : (
                        <textarea
                          className="mono"
                          rows={stage === "stage2" || stage === "stage3" ? 14 : 10}
                          value={aiPrompts[stage]}
                          onChange={(e) => setAiPrompts({ ...aiPrompts, [stage]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                  <div className="ai-actions">
                    <button className="btn primary-btn" disabled={aiBusy} onClick={handleSavePrompts}>保存提示词</button>
                    <button className="btn ghost" disabled={aiBusy} onClick={handleResetPrompts}>恢复默认提示词</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

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
        open={!!uploadMsg}
        title="导入成功"
        message={uploadMsg}
        confirmText="知道了"
        showCancel={false}
        onConfirm={() => setUploadMsg(null)}
      />

      <Modal
        open={!!preview}
        title={preview ? preview.file.slice(preview.file.indexOf("_") + 1) : ""}
        showConfirm={false}
        cancelText="关闭"
        onCancel={() => setPreview(null)}
      >
        {preview && <img className="img-preview" src={evidenceUrl(preview.aid, preview.file)} alt={preview.file} />}
      </Modal>
    </div>
  );
}