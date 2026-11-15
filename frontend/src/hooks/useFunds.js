// useFunds.js — 班费公示页状态：公开查看 + 管理员发布增加/减少记录、删除错录
import { useEffect, useRef, useState } from "react";
import { createFund, deleteFund, fundImageUrl, listFunds } from "../api.js";

const EMPTY_SUMMARY = { income: 0, expense: 0, balance: 0 };
const MAX_IMAGES = 5;

export function useFunds({ token, tab, classSel, setError }) {
  const [funds, setFunds] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [fundKind, setFundKind] = useState("in"); // in=增加 / out=减少
  const [fundAmount, setFundAmount] = useState("");
  const [fundTitle, setFundTitle] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundMsg, setFundMsg] = useState("");
  const [fundFiles, setFundFiles] = useState([]); // 票据图片（最多 5 张）
  const [fundPreview, setFundPreview] = useState(null); // {url,title} 图片预览弹窗
  const [deletingId, setDeletingId] = useState(null);
  const seq = useRef(0); // 快速切班时丢弃先发后到的旧响应

  async function loadFunds(cid = classSel, opts = {}) {
    if (!cid) {
      seq.current += 1;
      setFunds([]);
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    if (opts.loading !== false) setLoading(true);
    try {
      const data = await listFunds(cid);
      if (my !== seq.current) return;
      setFunds(data.items || []);
      setSummary(data.summary || EMPTY_SUMMARY);
    } catch (err) {
      if (my === seq.current) setError(err.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "fund") loadFunds();
  }, [tab, classSel]);

  async function handleAddFund(e) {
    e.preventDefault();
    if (!token || !classSel) return;
    const amount = Number(fundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的金额");
      return;
    }
    if (!fundTitle.trim()) {
      setError("请填写事由");
      return;
    }
    setFundBusy(true);
    setError("");
    setFundMsg("");
    try {
      await createFund(
        { class_id: classSel, kind: fundKind, amount, title: fundTitle.trim(), files: fundFiles },
        token
      );
      setFundAmount("");
      setFundTitle("");
      setFundFiles([]);
      setFundMsg("已发布");
      await loadFunds(classSel, { loading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setFundBusy(false);
    }
  }

  // 拖入/选择图片：只收图片，最多 5 张（超出的部分丢弃并提示）
  function addFundFiles(fileList) {
    const picked = Array.from(fileList || []);
    const images = picked.filter((f) => (f.type || "").startsWith("image/"));
    if (images.length < picked.length) setError("只能上传图片文件");
    if (!images.length) return;
    const merged = [...fundFiles, ...images];
    if (merged.length > MAX_IMAGES) setError(`最多上传 ${MAX_IMAGES} 张图片`);
    setFundFiles(merged.slice(0, MAX_IMAGES));
  }

  function removeFundFile(index) {
    setFundFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function openFundPreview(item, filename) {
    setFundPreview({ url: fundImageUrl(item.id, filename), title: `${item.title} · ${filename}` });
  }

  function closeFundPreview() {
    setFundPreview(null);
  }

  async function handleDeleteFund(item) {
    if (!window.confirm(`确定删除「${item.title}」这条记录吗？`)) return;
    setDeletingId(item.id);
    setError("");
    try {
      await deleteFund(item.id, token);
      await loadFunds(classSel, { loading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return {
    funds, summary, loading,
    fundKind, setFundKind, fundAmount, setFundAmount, fundTitle, setFundTitle,
    fundBusy, fundMsg, handleAddFund,
    fundFiles, addFundFiles, removeFundFile,
    fundPreview, openFundPreview, closeFundPreview,
    deletingId, handleDeleteFund
  };
}
