// usePassSession.js — 加分一遍过的全部会话状态与处理（挂在 App 层：切换界面不丢对话）
import { useEffect, useRef, useState } from "react";
import { startAssess, sendAssess, finishAssess, rewindAssess, submitAssess } from "../api.js";
import { rebuildPassItems } from "./passItems.js";

export function usePassSession({ setError, setSubmitting, setSubmitMsg, loadAwards }) {
  const [passSid, setPassSid] = useState("");
  const [passSess, setPassSess] = useState(null);
  const [passMsgs, setPassMsgs] = useState([]);
  const [passItems, setPassItems] = useState([]);
  const [passBusy, setPassBusy] = useState(false);
  const [passDone, setPassDone] = useState(false);
  const [passEnded, setPassEnded] = useState(false);
  const [passProgress, setPassProgress] = useState(null); // 访谈进度 {done,total}（小节）
  const [passInput, setPassInput] = useState("");
  const [passErr, setPassErr] = useState("");
  const [passWarn, setPassWarn] = useState("");
  const [passAttach, setPassAttach] = useState([]); // 聊天待发送附件（图片/文件）
  const [passConfirmSubmit, setPassConfirmSubmit] = useState(false);
  const [passNoEvItems, setPassNoEvItems] = useState([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualItem, setManualItem] = useState({ category: "德育", points: "1", basis: "" });
  const [recallIdx, setRecallIdx] = useState(null); // 哪个用户气泡正显示撤回符号（null=无）
  const [recallTarget, setRecallTarget] = useState(null); // 待确认撤回的气泡下标（null=无）
  const [recalling, setRecalling] = useState(false); // 撤回请求进行中
  const chatBoxRef = useRef(null);
  const passInputRef = useRef(null); // 一遍过输入框（撤回后聚焦）

  // 一遍过聊天区：新内容到达后自动滚动到底部（窗口高度固定不随内容变化）
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [passMsgs, passBusy]);

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
      setPassProgress(null);
      setRecallIdx(null);
      setRecallTarget(null);
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
    setPassMsgs((prev) => [...prev, { role: "user", text, files: [], fileObjs: [] }]);
    await sendPassMsg(passSess.session_id, text, []);
  }

  async function handlePassSend(e) {
    e.preventDefault();
    if (passBusy || (!passInput.trim() && passAttach.length === 0)) return;
    const text = passInput.trim();
    const files = passAttach;
    setPassInput("");
    setPassAttach([]);
    // fileObjs 留一份原始 File 对象，撤回时可放回输入区重新发送
    setPassMsgs((prev) => [...prev, { role: "user", text, files: files.map((f) => f.name), fileObjs: files }]);
    await sendPassMsg(passSess.session_id, text, files);
  }

  function addPassAttach(fileList) {
    const files = Array.from(fileList || []).slice(0, 5);
    if (!files.length) return;
    setPassAttach((prev) => [...prev, ...files].slice(0, 5));
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
              const added = ev.items.map((it) => ({ ...it, evidence: [], evServer: [] }));
              setPassItems((prev) => [...prev, ...added]);
              setPassWarn("");
            } else if (ev.type === "auto_items" && ev.items) {
              // 智能分类识图自动识别：每项带服务端已存证据文件名
              const auto = ev.items
                .map((it) => ({
                  category: it.category,
                  points: parseFloat(it.points) || 0,
                  basis: (it.basis || "").trim(),
                  evidence: [],
                  evServer: Array.isArray(it.evidence) ? it.evidence : [],
                  auto: true
                }))
                .filter((it) => it.basis);
              if (auto.length) {
                setPassItems((prev) => {
                  const known = new Set(prev.map((x) => `${x.category}|${x.points}|${x.basis}`));
                  const fresh = auto.filter((x) => !known.has(`${x.category}|${x.points}|${x.basis}`));
                  return fresh.length ? [...prev, ...fresh] : prev;
                });
                setPassWarn("");
              }
            } else if (ev.type === "warning") {
              setPassWarn(ev.text || "AI 判定可能有加分项但未能自动识别。");
            } else if (ev.type === "error") {
              setPassErr(ev.text || "请求失败");
            } else if (ev.type === "done") {
              if (ev.done) setPassDone(true);
              if (ev.ended) setPassEnded(true);
              if (ev.progress) setPassProgress(ev.progress);
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

  // 撤回某条用户发言：删除该条及其后所有对话，并让 AI 撤销相应的加分项
  async function handlePassRecall(idx) {
    if (passBusy || recalling || !passSess) return;
    // keepUsers = 该条之前（不含该条）的学生发言条数，即需要保留的轮数
    const keepUsers = passMsgs.slice(0, idx).filter((m) => m.role === "user").length;
    const clicked = passMsgs[idx];
    setRecalling(true);
    setPassErr("");
    setPassWarn("");
    try {
      const res = await rewindAssess(passSess.session_id, keepUsers);
      setPassMsgs((prev) => prev.slice(0, idx));
      setPassItems((prev) => rebuildPassItems(res.items, prev));
      setPassDone(!!res.done);
      setPassEnded(!!res.ended);
      if (res.progress) setPassProgress(res.progress);
      // 把被撤回的发言放回输入区，便于改一改再发（附件无法从服务端找回，用本地存的 File 对象）
      setPassInput(clicked && clicked.text !== "开始" ? clicked.text || "" : "");
      setPassAttach((clicked && clicked.fileObjs) || []);
      setRecallIdx(null);
      setRecallTarget(null);
      passInputRef.current?.focus();
    } catch (err) {
      setPassErr(err.message);
    } finally {
      setRecalling(false);
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
      evidence: [],
      evServer: []
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

  function removePassItemServerFile(idx, fi) {
    setPassItems((prev) => prev.map((it, i) => (i === idx ? { ...it, evServer: (it.evServer || []).filter((_, j) => j !== fi) } : it)));
  }

  async function handlePassSubmit() {
    if (!passSess || passItems.length === 0) return;
    // 首次点击：无论有无证据都先弹确认框（提醒证据与结束流程）；确认后再真正提交
    if (!passConfirmSubmit) {
      const noEv = passItems.filter(
        (it) => (!it.evidence || it.evidence.length === 0) && (!it.evServer || it.evServer.length === 0)
      );
      setPassNoEvItems(noEv);
      setPassConfirmSubmit(true);
      return;
    }
    setPassConfirmSubmit(false);
    setPassNoEvItems([]);
    const filesByIndex = {};
    passItems.forEach((it, i) => {
      if (it.evidence && it.evidence.length) filesByIndex[i] = it.evidence;
    });
    const itemsPayload = passItems.map((it) => ({
      category: it.category,
      points: parseFloat(it.points) || 0,
      basis: it.basis || "",
      evidence: it.evServer || []
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
      setPassProgress(null);
      setPassSid("");
      setPassConfirmSubmit(false);
      setPassNoEvItems([]);
      loadAwards();
    } catch (err) {
      setPassErr(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    passSid, setPassSid, passSess, passMsgs, passItems, passBusy, passDone, passEnded, passProgress,
    passInput, setPassInput, passErr, passWarn, passAttach, setPassAttach,
    passConfirmSubmit, setPassConfirmSubmit, passNoEvItems, setPassNoEvItems,
    manualOpen, setManualOpen, manualItem, setManualItem,
    recallIdx, setRecallIdx, recallTarget, setRecallTarget, recalling,
    chatBoxRef, passInputRef,
    handlePassStart, handlePassQuick, handlePassSend, addPassAttach, handlePassFinish, handlePassRecall,
    updatePassItem, removePassItem, handleAddManualItem, addPassItemFiles, removePassItemFile, removePassItemServerFile,
    handlePassSubmit,
  };
}
