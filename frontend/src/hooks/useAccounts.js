// useAccounts.js — 账号管理（root）状态与处理：管理员账号 + 邀请码
import { useEffect, useState } from "react";
import { fetchAdmins, createAdmin, deleteAdmin, listInvites, createInvite, revokeInvite } from "../api.js";

export function useAccounts({ token, role, tab, setManageMsg }) {
  const [adminsList, setAdminsList] = useState([]);
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [newAdminClass, setNewAdminClass] = useState("");
  const [deleteAdminTarget, setDeleteAdminTarget] = useState(null);

  // 邀请码：生成（选班级）→ 列表（未使用/已使用/已撤销）→ 撤销
  const [invitesList, setInvitesList] = useState([]);
  const [inviteClassId, setInviteClassId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [copiedCode, setCopiedCode] = useState("");

  async function loadAdmins() {
    if (role !== "root") return;
    try {
      const d = await fetchAdmins(token);
      setAdminsList(d.admins || []);
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  async function loadInvites() {
    if (role !== "root") return;
    try {
      const d = await listInvites(token);
      setInvitesList(d.invites || []);
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    }
  }

  // root 每次进入「配置 → 账号管理」都刷新账号与邀请码列表
  useEffect(() => {
    if (tab === "cfg_accounts" && role === "root") {
      loadAdmins();
      loadInvites();
    }
  }, [tab, token, role]);

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

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // http 等非安全上下文没有 clipboard API：退回临时 textarea
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? "" : c)), 1600);
  }

  async function handleCreateInvite(e) {
    e.preventDefault();
    if (!inviteClassId) {
      setManageMsg({ type: "err", text: "请选择邀请码对应的班级" });
      return;
    }
    setInviteBusy(true);
    setManageMsg(null);
    setInviteMsg(null);
    try {
      const res = await createInvite(inviteClassId, token);
      setInviteMsg({
        type: "ok",
        text: `已生成邀请码 ${res.invite.code}（${res.invite.class_name}），一次性使用，注册后自动失效`,
      });
      await loadInvites();
      copyCode(res.invite.code);
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRevokeInvite() {
    const target = revokeTarget;
    if (!target) return;
    setRevokeTarget(null);
    setInviteBusy(true);
    setInviteMsg(null);
    try {
      await revokeInvite(target.id, token);
      await loadInvites();
      setInviteMsg({ type: "ok", text: `已撤销邀请码 ${target.code}` });
    } catch (err) {
      setManageMsg({ type: "err", text: err.message });
    } finally {
      setInviteBusy(false);
    }
  }

  return {
    adminsList, newAdminUser, setNewAdminUser, newAdminPass, setNewAdminPass, newAdminClass, setNewAdminClass,
    deleteAdminTarget, setDeleteAdminTarget, handleCreateAdmin, handleDeleteAdmin,
    invitesList, inviteClassId, setInviteClassId, inviteBusy, inviteMsg, revokeTarget, setRevokeTarget,
    copiedCode, copyCode, handleCreateInvite, handleRevokeInvite,
  };
}
