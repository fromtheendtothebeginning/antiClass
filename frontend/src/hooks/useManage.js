// useManage.js — 数据管理页状态与处理（成绩导入 / 第二课堂 / 证据 zip / 班级管理 / 学期管理）
import { useState } from "react";
import {
  uploadXlsx,
  clearClassData,
  createClass,
  deleteClass,
  exportEvidenceZip,
  importSecondClass,
  createSemester,
  deleteSemester,
  openSemester,
  updateSemesterTerm,
} from "../api.js";
import { SEMESTER_LABELS } from "../constants.js";

export function useManage({
  token, role, myClassId, classSel, uploadClassId, setUploadClassId, loadClasses, loadBoard, loadAwards, setManageMsg,
  semesters, semesterSel, openSemesterId, loadSemesters, handlePickSemester,
}) {
  const [uploading, setUploading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [uploadMsg, setUploadMsg] = useState(null);
  const [newClassName, setNewClassName] = useState("");
  const [clearClassTarget, setClearClassTarget] = useState(null);
  const [deleteClassTarget, setDeleteClassTarget] = useState(null);
  const [evidenceZipClass, setEvidenceZipClass] = useState("");
  const [zipping, setZipping] = useState(false);

  const [scOpen, setScOpen] = useState(false);
  const [scClassId, setScClassId] = useState("");
  const [scThreshold, setScThreshold] = useState("2");
  const [scFile, setScFile] = useState(null);
  const [scBusy, setScBusy] = useState(false);
  const [scMsg, setScMsg] = useState(null);

  // 学期管理（root）
  const [newSemesterLabel, setNewSemesterLabel] = useState("");
  const [newSemesterTerm, setNewSemesterTerm] = useState("");
  const [semesterBusy, setSemesterBusy] = useState(false);
  const [semesterMsg, setSemesterMsg] = useState(null);
  const [termEditTarget, setTermEditTarget] = useState(null); // {id,label,term}
  const [semesterDeleteTarget, setSemesterDeleteTarget] = useState(null); // {id,label}

  const semesterLabel = semesters.find((s) => s.id === semesterSel)?.label || "";

  async function handleUpload(file) {
    if (!file) return;
    // 目标班级必须明确：admin 固定导入本班，root 必须显式选择（避免拖入即静默导入到第一个班级）
    const targetClass = role === "admin" ? myClassId : uploadClassId;
    if (!targetClass || !semesterSel) {
      setImportErr(!targetClass ? (role === "admin" ? "请先创建班级" : "请先选择目标班级") : "请先在页面上方选择学期");
      return;
    }
    setUploading(true);
    setImportErr("");
    try {
      const res = await uploadXlsx(file, token, targetClass, semesterSel);
      await loadClasses(semesterSel);
      await loadBoard(classSel, semesterSel);
      setUploadMsg(`导入成功：${res.students} 名学生，${res.rows} 条课程记录（${res.semester}）`);
    } catch (err) {
      setImportErr(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleClearClass() {
    const target = clearClassTarget;
    setClearClassTarget(null);
    setManageMsg(null);
    if (!semesterSel) {
      setManageMsg({ type: "err", text: "请先在页面上方选择学期" });
      return;
    }
    try {
      await clearClassData(target.id, semesterSel, token);
      setManageMsg({ type: "ok", text: `已清除 ${target.name} 在 ${semesterLabel} 的榜单、申报与留痕数据（班费不受影响）` });
      await loadClasses(semesterSel);
      await loadBoard(classSel, semesterSel);
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
      await loadClasses(semesterSel);
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleDeleteClass(cid) {
    setManageMsg(null);
    try {
      await deleteClass(cid, token);
      setManageMsg({ type: "ok", text: "班级已删除" });
      await loadClasses(semesterSel);
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function handleExportZip() {
    if (!token) return;
    const target = evidenceZipClass || (role === "admin" ? myClassId : "");
    setManageMsg(null);
    setZipping(true);
    try {
      await exportEvidenceZip(target, semesterSel, token);
      setManageMsg({
        type: "ok",
        text: target
          ? `已导出 ${semesterLabel} 该班级证据压缩包（仅已通过的申报）`
          : `已导出全部班级在 ${semesterLabel} 的证据压缩包（仅已通过的申报）`,
      });
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    } finally {
      setZipping(false);
    }
  }

  async function handleImportSecondClass(e) {
    e.preventDefault();
    if (!scFile) {
      setScMsg({ type: "err", text: "请选择第二课堂统计 xlsx 文件" });
      return;
    }
    const target = scClassId || (role === "admin" ? myClassId : "");
    if (!target) {
      setScMsg({ type: "err", text: "请选择班级" });
      return;
    }
    if (!semesterSel) {
      setScMsg({ type: "err", text: "请先在页面上方选择学期" });
      return;
    }
    const threshold = parseFloat(scThreshold) || 0;
    setScMsg(null);
    setScBusy(true);
    try {
      const res = await importSecondClass(scFile, token, target, semesterSel, threshold);
      setScMsg({
        type: "ok",
        text: `导入完成（${semesterLabel}）：${res.qualified} 人达标（学分≥${res.threshold}），已对 ${res.applied} 人德育 +10 分，并生成自动通过的德育申报记录（申报列表可见）；重复导入自动先撤后加，不会重复累加。${res.skipped && res.skipped.length ? `跳过 ${res.skipped.length} 个不在本班榜单的学号。` : ""}`,
      });
      setScFile(null);
      await loadBoard(classSel, semesterSel);
    } catch (err) {
      setScMsg({ type: "err", text: err.message });
    } finally {
      setScBusy(false);
    }
  }

  // ---------- 学期管理 ----------
  async function handleCreateSemester(e) {
    e.preventDefault();
    const label = newSemesterLabel || SEMESTER_LABELS.find((l) => !semesters.some((s) => s.label === l)) || "";
    if (!label) {
      setSemesterMsg({ type: "err", text: "请选择学期档位" });
      return;
    }
    setSemesterBusy(true);
    setSemesterMsg(null);
    try {
      const res = await createSemester(label, newSemesterTerm.trim(), token);
      setNewSemesterTerm("");
      setSemesterMsg({ type: "ok", text: `已创建 ${label}${res.semester.term ? ` · ${res.semester.term}` : ""}` });
      await loadSemesters();
      handlePickSemester(res.semester.id);
    } catch (err) {
      setSemesterMsg({ type: "err", text: err.message });
    } finally {
      setSemesterBusy(false);
    }
  }

  async function handleOpenSemester(sem) {
    setSemesterBusy(true);
    setSemesterMsg(null);
    try {
      await openSemester(sem.id, token);
      await loadSemesters();
      setSemesterMsg({ type: "ok", text: `已设为开放申报学期：${sem.label}（学生申报将自动提交到该学期）` });
    } catch (err) {
      setSemesterMsg({ type: "err", text: err.message });
    } finally {
      setSemesterBusy(false);
    }
  }

  async function handleSaveSemesterTerm(e) {
    e.preventDefault();
    const target = termEditTarget;
    if (!target) return;
    setSemesterBusy(true);
    setSemesterMsg(null);
    try {
      await updateSemesterTerm(target.id, (target.term || "").trim(), token);
      setTermEditTarget(null);
      await loadSemesters();
      setSemesterMsg({ type: "ok", text: `${target.label} 的学年学期已保存` });
    } catch (err) {
      setSemesterMsg({ type: "err", text: err.message });
    } finally {
      setSemesterBusy(false);
    }
  }

  async function handleDeleteSemester() {
    const target = semesterDeleteTarget;
    if (!target) return;
    setSemesterDeleteTarget(null);
    setSemesterBusy(true);
    setSemesterMsg(null);
    try {
      await deleteSemester(target.id, token);
      await loadSemesters();
      setSemesterMsg({ type: "ok", text: `已删除学期：${target.label}` });
    } catch (err) {
      setSemesterMsg({ type: "err", text: err.message });
    } finally {
      setSemesterBusy(false);
    }
  }

  return {
    uploading, importOpen, setImportOpen, importErr, setImportErr, uploadClassId, setUploadClassId, uploadMsg, setUploadMsg,
    newClassName, setNewClassName, clearClassTarget, setClearClassTarget, deleteClassTarget, setDeleteClassTarget,
    evidenceZipClass, setEvidenceZipClass, zipping,
    scOpen, setScOpen, scClassId, setScClassId, scThreshold, setScThreshold, scFile, setScFile, scBusy, scMsg, setScMsg,
    handleUpload, handleClearClass, handleCreateClass, handleDeleteClass, handleExportZip, handleImportSecondClass,
    // 学期管理
    semesterLabel, semesterBusy, semesterMsg, newSemesterLabel, setNewSemesterLabel, newSemesterTerm, setNewSemesterTerm,
    termEditTarget, setTermEditTarget, semesterDeleteTarget, setSemesterDeleteTarget,
    handleCreateSemester, handleOpenSemester, handleSaveSemesterTerm, handleDeleteSemester,
  };
}
