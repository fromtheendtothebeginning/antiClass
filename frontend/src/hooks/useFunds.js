// useFunds.js — 班费公示页状态：公开查看 + 管理员发布增加/减少记录、删除错录
import { useEffect, useRef, useState } from "react";
import { createFund, deleteFund, listFunds } from "../api.js";

const EMPTY_SUMMARY = { income: 0, expense: 0, balance: 0 };

export function useFunds({ token, tab, classSel, setError }) {
  const [funds, setFunds] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [fundKind, setFundKind] = useState("in"); // in=增加 / out=减少
  const [fundAmount, setFundAmount] = useState("");
  const [fundTitle, setFundTitle] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundMsg, setFundMsg] = useState("");
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
        { class_id: classSel, kind: fundKind, amount, title: fundTitle.trim() },
        token
      );
      setFundAmount("");
      setFundTitle("");
      setFundMsg("已发布");
      await loadFunds(classSel, { loading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setFundBusy(false);
    }
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
    deletingId, handleDeleteFund
  };
}
