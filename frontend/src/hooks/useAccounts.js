// useAccounts.js — 账号管理（root）状态与处理
import { useEffect, useState } from "react";
import { fetchAdmins, createAdmin, deleteAdmin } from "../api.js";

export function useAccounts({ token, role, tab, setManageMsg }) {
  const [adminsList, setAdminsList] = useState([]);
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [newAdminClass, setNewAdminClass] = useState("");
  const [deleteAdminTarget, setDeleteAdminTarget] = useState(null);

  async function loadAdmins() {
    if (role !== "root") return;
    try {
      const d = await fetchAdmins(token);
      setAdminsList(d.admins || []);
    } catch (err) {
      setError(err.message);
    }
  }
  // root 每次进入「配置 → 账号管理」都刷新账号列表，保证始终看到全部账号
  useEffect(() => {
    if (tab === "cfg_accounts" && role === "root") loadAdmins();
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
  return {
    adminsList, newAdminUser, setNewAdminUser, newAdminPass, setNewAdminPass, newAdminClass, setNewAdminClass,
    deleteAdminTarget, setDeleteAdminTarget, handleCreateAdmin, handleDeleteAdmin,
  };
}
