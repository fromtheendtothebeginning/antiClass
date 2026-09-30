// useApply.js — 加分申报页全部状态与处理（AI 分类草稿 / 传统表单 / 班委 / 批量 / 调分）
import { useState } from "react";
import { analyzeAward, submitAwards, deleteAwardDraft, manualAward, classCommitteeAward, adjustScores, batchAward } from "../api.js";
import { CC_ROLES } from "../constants.js";

export function useApply({ token, setError, setSubmitting, setSubmitMsg, loadAwards, loadBoard, classSel }) {
  const [applyType, setApplyType] = useState("ai");
  const [applySid, setApplySid] = useState("");
  const [applyText, setApplyText] = useState("");
  const [applyFiles, setApplyFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [drafts, setDrafts] = useState([]);

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

  const [batchSids, setBatchSids] = useState("");
  const [batchCategory, setBatchCategory] = useState("德育");
  const [batchPoints, setBatchPoints] = useState("1");
  const [batchBasis, setBatchBasis] = useState("");
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState(null);


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

  function updateDraftItem(draftId, idx, patch) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.draft_id === draftId
          ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
          : d
      )
    );
  }

  function removeDraftItem(draftId, idx) {
    let removedAll = false;
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.draft_id !== draftId) return d;
        const items = d.items.filter((_, i) => i !== idx);
        if (items.length === 0) {
          removedAll = true;
          return null; // 最后一条被删 → 整卡移除
        }
        return { ...d, items };
      }).filter(Boolean)
    );
    if (removedAll) {
      // 异步清理后端草稿与证据文件（本地已移除，失败不阻塞）
      deleteAwardDraft(draftId).catch(() => {});
    }
  }

  async function deleteDraft(draftId) {
    setError("");
    try {
      await deleteAwardDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.draft_id !== draftId));
    } catch (err) {
      // 后端草稿已过期（如重启丢失/已提交）时本地同步移除即可
      setDrafts((prev) => prev.filter((d) => d.draft_id !== draftId));
      setError(err.message);
    }
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
      await loadBoard(classSel);
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

  return {
    applyType, setApplyType, applySid, setApplySid, applyText, setApplyText, applyFiles, setApplyFiles,
    analyzing, drafts, handleAnalyze,
    formSid, setFormSid, formCategory, setFormCategory, formPoints, setFormPoints, formBasis, setFormBasis,
    formFiles, setFormFiles, formBusy, formResult, handleManual,
    ccSid, setCcSid, ccRole, setCcRole, ccBusy, ccResult, handleClassCommittee,
    adjSids, setAdjSids, adjField, setAdjField, adjOp, setAdjOp, adjPoints, setAdjPoints, adjBusy, adjResult, handleAdjust,
    batchSids, setBatchSids, batchCategory, setBatchCategory, batchPoints, setBatchPoints, batchBasis, setBatchBasis,
    batchFiles, setBatchFiles, batchBusy, batchResult, handleBatch,
    updateDraftItem, removeDraftItem, deleteDraft, submitDraft, submitAll,
  };
}
