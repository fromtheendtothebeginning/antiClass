// useFeedback.js — 体验反馈页全部状态与处理（公开提交 / 管理员勾选解决与回复）
import { useEffect, useState } from "react";
import { listFeedback, submitFeedback, updateFeedback } from "../api.js";
import { FEEDBACK_CATEGORIES } from "../constants.js";

export function useFeedback({ token, tab, setError }) {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fbCategory, setFbCategory] = useState(FEEDBACK_CATEGORIES[0]);
  const [fbContent, setFbContent] = useState("");
  const [fbContact, setFbContact] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbMsg, setFbMsg] = useState("");
  const [fbStatus, setFbStatus] = useState("all"); // 工单筛选：all / pending / resolved
  const [fbCat, setFbCat] = useState("all"); // 工单筛选分类：all / 问题 / 建议 / 其他
  const [toggleId, setToggleId] = useState(null); // 正在勾选解决状态的工单 id
  const [replyEditId, setReplyEditId] = useState(null); // 正在编辑回复的工单 id
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  // 进反馈页时拉取列表（带加载态）；勾选/回复/提交后的刷新传 {loading:false} 静默原地更新——
  // 若重放「加载中…」会把整个列表 DOM 拆掉、页面高度塌掉，滚动位置被钳制回顶部
  async function loadFeedback(opts = {}) {
    if (opts.loading !== false) setLoading(true);
    try {
      const data = await listFeedback();
      setFeedback(data.feedback);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "feedback") loadFeedback();
  }, [tab]);

  async function handleFeedbackSubmit(e) {
    e.preventDefault();
    if (!fbContent.trim()) {
      setError("请填写反馈内容");
      return;
    }
    setFbBusy(true);
    setError("");
    setFbMsg("");
    try {
      await submitFeedback({ category: fbCategory, content: fbContent, contact: fbContact });
      setFbContent("");
      setFbContact("");
      setFbMsg("已提交，感谢反馈！");
      await loadFeedback({ loading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setFbBusy(false);
    }
  }

  async function handleToggleResolved(item) {
    setToggleId(item.id);
    setError("");
    try {
      const data = await updateFeedback(item.id, { resolved: !item.resolved }, token);
      // 原地更新该卡片（不重拉不重排）：列表重排会让滚动锚定拖着视口跟着卡片跑，失去阅读位置
      setFeedback((prev) => prev.map((it) => (it.id === item.id ? data.item : it)));
    } catch (err) {
      setError(err.message);
    } finally {
      setToggleId(null);
    }
  }

  function startReplyEdit(item) {
    setReplyEditId(item.id);
    setReplyDraft(item.reply || "");
  }

  function cancelReplyEdit() {
    setReplyEditId(null);
    setReplyDraft("");
  }

  async function handleReplySave(item) {
    setReplyBusy(true);
    setError("");
    try {
      const data = await updateFeedback(item.id, { reply: replyDraft }, token);
      cancelReplyEdit();
      setFeedback((prev) => prev.map((it) => (it.id === item.id ? data.item : it))); // 同勾选：原地更新不重排
    } catch (err) {
      setError(err.message);
    } finally {
      setReplyBusy(false);
    }
  }

  return {
    feedback, loading,
    fbCategory, setFbCategory, fbContent, setFbContent, fbContact, setFbContact,
    fbBusy, fbMsg, handleFeedbackSubmit,
    fbStatus, setFbStatus, fbCat, setFbCat,
    toggleId, handleToggleResolved,
    replyEditId, replyDraft, setReplyDraft, replyBusy, startReplyEdit, cancelReplyEdit, handleReplySave,
  };
}
