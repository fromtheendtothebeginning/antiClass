// useMcpTokens.js — 申报 MCP 专属 token（各班管理员生成/发放，绑定班级）
import { useEffect, useState } from "react";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "../api.js";

export function useMcpTokens({ token, role, myClassId, tab, classes, setError }) {
  const [tokens, setTokens] = useState([]);
  const [label, setLabel] = useState("");
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [created, setCreated] = useState(null); // {token, item}
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [copied, setCopied] = useState("");

  async function load() {
    if (!token) return;
    try {
      const d = await listMcpTokens(token);
      setTokens(d.tokens || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (tab === "cfg_mcp" && token) load();
  }, [tab, token, role, myClassId]);

  // 默认班级：admin 固定本班；root 默认第一个班
  useEffect(() => {
    if (role === "admin" && myClassId) {
      setClassId(myClassId);
    } else if (role === "root" && !classId && classes[0]) {
      setClassId(classes[0].id);
    }
  }, [role, myClassId, classes]);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(text);
    setTimeout(() => setCopied((v) => (v === text ? "" : v)), 1600);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!classId) {
      setMsg({ type: "err", text: "请选择 token 绑定的班级" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const d = await createMcpToken(label.trim(), classId, token);
      setCreated({ token: d.token, item: d.item });
      setLabel("");
      await load();
    } catch (err) {
      setMsg({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    const target = revokeTarget;
    if (!target) return;
    setRevokeTarget(null);
    setBusy(true);
    setMsg(null);
    try {
      await revokeMcpToken(target.id, token);
      setMsg({ type: "ok", text: `已撤销 token ${target.token_prefix}…` });
      await load();
    } catch (err) {
      setMsg({ type: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return {
    tokens, label, setLabel, classId, setClassId, busy, msg, created, setCreated,
    revokeTarget, setRevokeTarget, copied, copyText, load,
    handleCreate, handleRevoke,
  };
}
