const API = "/api";

let onAuthExpired = null;

/** 注册会话失效回调（token 过期/无效时触发，参数为提示文案）。 */
export function setOnAuthExpired(fn) {
  onAuthExpired = fn;
}

const AUTH_EXPIRED_MSG = "登录已过期，请重新登录";

// 统一处理 401：登录接口密码错也是 401，不能当会话过期处理
function handleUnauthorized(path, status, detail) {
  const msg = detail || AUTH_EXPIRED_MSG;
  if (status === 401 && path !== "/login") {
    onAuthExpired?.(msg);
    const err = new Error(msg);
    err.status = status;
    err.authExpired = true;
    return err;
  }
  return null;
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const authErr = handleUnauthorized(path, res.status, err.detail);
    if (authErr) throw authErr;
    const e = new Error(err.detail || `请求失败（${res.status}）`);
    e.status = res.status;
    throw e;
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

export function fetchMe(token) {
  return request("/me", { headers: { Authorization: `Bearer ${token}` } });
}

// 凭一次性邀请码注册管理员：成功即返回登录会话（token/role/class_id/class_name）
export function registerAdmin(code, username, password) {
  return request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, username, password })
  });
}

// 改当前账号的昵称/头像：avatar 省略/传 null = 不变，"" = 清除，data URL = 替换
export function updateProfile(payload, token) {
  return request("/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// 全站背景图案：GET 公开（访客也要按保存的图案渲染），POST 需登录
// 形态：{desktop: {pattern, url}, mobile: {pattern, url}}；pattern=custom 时 url 是图片地址
export function getAppearance() {
  return request("/appearance");
}

// payload: {desktop: {pattern, image}, mobile: {pattern, image}}，image 是自定义图的 data URL（不换图留空）
export function saveAppearance(payload, token) {
  return request("/appearance", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

export function fetchLeaderboard(classId, semesterId) {
  const q = new URLSearchParams();
  if (classId) q.set("class_id", classId);
  if (semesterId) q.set("semester_id", semesterId);
  return request(`/leaderboard${q.toString() ? `?${q}` : ""}`);
}

export function fetchClasses(semesterId) {
  return request(`/classes${semesterId ? `?semester_id=${encodeURIComponent(semesterId)}` : ""}`);
}

// 学期（班级跨学期；同一时间只有一个学期开放申报）
export function fetchSemesters() {
  return request("/semesters");
}

export function createSemester(label, term, token) {
  return request("/semesters", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label, term })
  });
}

export function updateSemesterTerm(id, term, token) {
  return request(`/semesters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ term })
  });
}

export function openSemester(id, token) {
  return request(`/semesters/${id}/open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function deleteSemester(id, token) {
  return request(`/semesters/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
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

export function clearClassData(id, semesterId, token) {
  return request(`/classes/${id}/clear${semesterId ? `?semester_id=${encodeURIComponent(semesterId)}` : ""}`, {
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

// 邀请码（root）：生成时绑定班级，一次性使用；撤销只能作用于未使用的码
export function listInvites(token) {
  return request("/invites", { headers: { Authorization: `Bearer ${token}` } });
}

export function createInvite(classId, token) {
  return request("/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ class_id: classId })
  });
}

export function revokeInvite(id, token) {
  return request(`/invites/${id}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// 申报 MCP 专属 token：各班管理员生成/发放，绑定班级；明文只在创建时返回一次
export function listMcpTokens(token) {
  return request("/mcp/tokens", { headers: { Authorization: `Bearer ${token}` } });
}

export function createMcpToken(label, classId, token) {
  return request("/mcp/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label, class_id: classId })
  });
}

export function revokeMcpToken(id, token) {
  return request(`/mcp/tokens/${id}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function uploadXlsx(file, token, classId, semesterId) {
  const form = new FormData();
  form.append("file", file);
  form.append("class_id", classId);
  form.append("semester_id", semesterId);
  return request("/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function importSecondClass(file, token, classId, semesterId, threshold) {
  const form = new FormData();
  form.append("file", file);
  form.append("class_id", classId);
  form.append("semester_id", semesterId);
  form.append("threshold", String(threshold));
  return request("/secondclass/import", {
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

export async function exportExcel(classId, semesterId) {
  const q = new URLSearchParams();
  if (classId) q.set("class_id", classId);
  if (semesterId) q.set("semester_id", semesterId);
  const res = await fetch(`${API}/export${q.toString() ? `?${q}` : ""}`);
  if (!res.ok) throw new Error("导出失败");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // 优先用响应头里的文件名（含班级名），无则回退
  const cd = res.headers.get("Content-Disposition") || "";
  let fileName = "综合测评总分.xlsx";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
  if (m) {
    try {
      fileName = decodeURIComponent(m[1].replace(/^"|"$/g, ""));
    } catch {
      fileName = m[1].replace(/^"|"$/g, "");
    }
  }
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 5000);
}

export async function exportEvidenceZip(classId, semesterId, token) {
  const q = new URLSearchParams();
  if (classId) q.set("class_id", classId);
  if (semesterId) q.set("semester_id", semesterId);
  const res = await fetch(`${API}/export/evidence-zip${q.toString() ? `?${q}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const authErr = handleUnauthorized("/export/evidence-zip", res.status, err.detail);
    if (authErr) throw authErr;
    throw new Error(err.detail || "导出失败");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename=([^;]+)/.exec(cd);
  a.href = url;
  a.download = m ? m[1].replace(/^"|"$/g, "") : "evidence_backup.zip";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  // 延迟撤销 blob URL：立即 revoke 会在某些浏览器/大文件下载尚未开始时取消下载
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 5000);
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

export function deleteAwardDraft(draftId) {
  return request(`/awards/drafts/${draftId}/delete`, { method: "POST" });
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
  if (payload.semester_id) form.append("semester_id", payload.semester_id);
  (payload.files || []).forEach((f) => form.append("files", f));
  return request("/awards/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function listAwards(classId, semesterId) {
  const q = new URLSearchParams();
  if (classId) q.set("class_id", classId);
  if (semesterId) q.set("semester_id", semesterId);
  return request(`/awards${q.toString() ? `?${q}` : ""}`);
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
// stateItems: 前端当前确认的加分项（含服务端证据名），供「申报 MCP」按学生所见列表提交
export async function sendAssess(sessionId, text, files = [], stateItems = null) {
  const form = new FormData();
  form.append("text", text);
  if (Array.isArray(stateItems)) form.append("state_items", JSON.stringify(stateItems));
  files.forEach((f) => form.append("files", f));
  const path = `/assess/${sessionId}/message`;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    body: form
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const authErr = handleUnauthorized(path, res.status, err.detail);
    if (authErr) throw authErr;
    const e = new Error(err.detail || `请求失败（${res.status}）`);
    e.status = res.status;
    throw e;
  }
  return res;
}

// 按条添加的证据即时上传到会话目录，返回服务端文件名（申报 MCP 落库时带上）
export function uploadAssessEvidence(sessionId, files) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request(`/assess/${sessionId}/evidence`, { method: "POST", body: form });
}

export function finishAssess(sessionId) {
  return request(`/assess/${sessionId}/finish`, { method: "POST" });
}

// 撤回一遍过对话到指定轮次：keepUsers = 保留的学生发言条数（不含开场轮）
export const rewindAssess = (sessionId, keepUsers) =>
  request(`/assess/${sessionId}/rewind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keep_users: keepUsers })
  });

// items: [{category,points,basis}]；filesByIndex: {0:[File,...],1:[File,...]} 按加分项上传证据
export function submitAssess(sessionId, items, filesByIndex = {}) {
  const form = new FormData();
  form.append("items", JSON.stringify(items));
  Object.keys(filesByIndex).forEach((idx) => {
    (filesByIndex[idx] || []).forEach((f) => form.append(`file_${idx}`, f));
  });
  return request(`/assess/${sessionId}/submit`, { method: "POST", body: form });
}

// 体验反馈：GET 公开可见，POST 公开提交（限流在后端），update 需管理员 token
export function listFeedback() {
  return request("/feedback");
}

export function submitFeedback(payload) {
  return request("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// payload: {resolved?, reply?} 部分更新（勾选与回复互不覆盖）
export function updateFeedback(id, payload, token) {
  return request(`/feedback/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}

// 班费公示：GET 公开（按班），发布/删除需管理员 token
export function listFunds(classId) {
  return request(`/funds${classId ? `?class_id=${encodeURIComponent(classId)}` : ""}`);
}

// payload: {class_id, kind: "in"|"out", amount, title, files?: File[]}
export function createFund(payload, token) {
  const form = new FormData();
  form.append("class_id", payload.class_id);
  form.append("kind", payload.kind);
  form.append("amount", String(payload.amount));
  form.append("title", payload.title);
  (payload.files || []).forEach((f) => form.append("files", f));
  return request("/funds", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export function fundImageUrl(id, filename) {
  return `/api/funds/${id}/image/${encodeURIComponent(filename)}`;
}

export function deleteFund(id, token) {
  return request(`/funds/${id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}