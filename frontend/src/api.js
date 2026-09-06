const API = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `请求失败（${res.status}）`);
  }
  return res.json();
}

export function login(username, password) {
  return request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export function logout(token) {
  return request("/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => {});
}

export function fetchLeaderboard(classId) {
  return request(`/leaderboard${classId ? `?class_id=${encodeURIComponent(classId)}` : ""}`);
}

export function fetchClasses() {
  return request("/classes");
}

export function createClass(name, token) {
  return request("/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name })
  });
}

export function deleteClass(id, token) {
  return request(`/classes/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function clearClassData(id, token) {
  return request(`/classes/${id}/clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function fetchAdmins(token) {
  return request("/admins", { headers: { Authorization: `Bearer ${token}` } });
}

export function createAdmin(payload, token) {
  return request("/admins", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function resetAdminPassword(username, password, token) {
  return request(`/admins/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password })
  });
}

export function deleteAdmin(username, token) {
  return request(`/admins/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function uploadXlsx(file, token, classId) {
  const form = new FormData();
  form.append("file", file);
  form.append("class_id", classId);
  return request("/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function exitData(token) {
  return request("/exit", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function adjustScores(payload, token) {
  return request("/scores/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function getAiSettings(token) {
  return request("/ai/settings", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function saveAiSettings(payload, token) {
  return request("/ai/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function testAi(payload, token) {
  return request("/ai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function listAiModels(payload, token) {
  return request("/ai/models", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function saveAiPrompts(payload, token) {
  return request("/ai/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function resetAiPrompts(token) {
  return request("/ai/prompts/reset", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function exportExcel(classId) {
  const res = await fetch(`${API}/export${classId ? `?class_id=${encodeURIComponent(classId)}` : ""}`);
  if (!res.ok) throw new Error("导出失败");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leaderboard.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function analyzeAward(sid, text, files) {
  const form = new FormData();
  form.append("sid", sid);
  form.append("text", text);
  files.forEach((f) => form.append("files", f));
  return request("/awards/analyze", {
    method: "POST",
    body: form
  });
}

export function submitAwards(submissions) {
  return request("/awards/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissions })
  });
}

export function manualAward(sid, category, points, basis, files) {
  const form = new FormData();
  form.append("sid", sid);
  form.append("category", category);
  form.append("points", points);
  form.append("basis", basis);
  files.forEach((f) => form.append("files", f));
  return request("/awards/manual", {
    method: "POST",
    body: form
  });
}

export function classCommitteeAward(sid, role, files) {
  const form = new FormData();
  form.append("sid", sid);
  form.append("role", role);
  files.forEach((f) => form.append("files", f));
  return request("/awards/class-committee", {
    method: "POST",
    body: form
  });
}

export function batchAward(payload, token) {
  const form = new FormData();
  form.append("sids", payload.sids);
  form.append("category", payload.category);
  form.append("points", payload.points);
  form.append("basis", payload.basis);
  (payload.files || []).forEach((f) => form.append("files", f));
  return request("/awards/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function listAwards(classId) {
  return request(`/awards${classId ? `?class_id=${encodeURIComponent(classId)}` : ""}`);
}

export function approveAward(id, token, payload = {}) {
  return request(`/awards/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function rejectAward(id, token, reason = "") {
  return request(`/awards/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason })
  });
}

export function editAward(id, payload, token) {
  const hasFiles = (payload.files || []).length > 0;
  const body = {
    category: payload.category,
    points: payload.points,
    basis: payload.basis
  };
  if (!hasFiles) {
    return request(`/awards/${id}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  }
  const form = new FormData();
  form.append("category", body.category);
  form.append("points", String(body.points));
  form.append("basis", body.basis);
  payload.files.forEach((f) => form.append("files", f));
  return request(`/awards/${id}/edit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function withdrawAward(id, token) {
  return request(`/awards/${id}/withdraw`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function deleteAward(id, token) {
  return request(`/awards/${id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function evidenceUrl(id, filename) {
  return `/api/awards/${id}/evidence/${encodeURIComponent(filename)}`;
}

export function startAssess(sid) {
  const form = new FormData();
  form.append("sid", sid);
  return request("/assess/start", { method: "POST", body: form });
}

// 发送一轮消息（可附带文件/图片，multipart），返回可读流（text/event-stream）
export function sendAssess(sessionId, text, files = []) {
  const form = new FormData();
  form.append("text", text);
  files.forEach((f) => form.append("files", f));
  return fetch(`${API}/assess/${sessionId}/message`, {
    method: "POST",
    body: form
  });
}

export function finishAssess(sessionId) {
  return request(`/assess/${sessionId}/finish`, { method: "POST" });
}

// items: [{category,points,basis}]；filesByIndex: {0:[File,...],1:[File,...]} 按加分项上传证据
export function submitAssess(sessionId, items, filesByIndex = {}) {
  const form = new FormData();
  form.append("items", JSON.stringify(items));
  Object.keys(filesByIndex).forEach((idx) => {
    (filesByIndex[idx] || []).forEach((f) => form.append(`file_${idx}`, f));
  });
  return request(`/assess/${sessionId}/submit`, { method: "POST", body: form });
}