// App.jsx — 应用外壳：登录态/路由(tab)/班级数据等共享状态，页面渲染分派给 pages/（逻辑在 hooks/）
import { useEffect, useRef, useState } from "react";
import {
  login,
  logout,
  fetchMe,
  fetchLeaderboard,
  fetchClasses,
  exportExcel,
  getAppearance,
  listAwards,
  evidenceUrl,
  setOnAuthExpired,
} from "./api.js";
import Avatar from "./components/Avatar.jsx";
import GlassTabs from "./components/GlassTabs.jsx";
import Modal from "./components/Modal.jsx";
import TextField from "./components/TextField.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import { SCH_TABS, PUBLIC_TABS, TAB_LABELS } from "./constants.js";
import { patternCss } from "./utils/pattern.js";
import { usePassSession } from "./hooks/usePassSession.js";
import { useApply } from "./hooks/useApply.js";
import { useApproveFilters } from "./hooks/useApproveFilters.js";
import { useManage } from "./hooks/useManage.js";
import { useAccounts } from "./hooks/useAccounts.js";
import { useAiConfig } from "./hooks/useAiConfig.js";
import { useAppearanceAdmin } from "./hooks/useAppearanceAdmin.js";
import { useLandingAdmin } from "./hooks/useLandingAdmin.js";
import { useProfile } from "./hooks/useProfile.js";
import PassPage from "./pages/PassPage.jsx";
import BoardPage from "./pages/BoardPage.jsx";
import ApplyPage from "./pages/ApplyPage.jsx";
import ApprovePage from "./pages/ApprovePage.jsx";
import ManagePage from "./pages/ManagePage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";
import ModelConfigPage from "./pages/ModelConfigPage.jsx";
import AppearancePage from "./pages/AppearancePage.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";

const TOKEN_KEY = "token";
const ROLE_KEY = "role";
const MY_CLASS_KEY = "my_class_id";
const CLASS_KEY = "sel_class_id"; // 访客看榜时选定的班级（榜单按班展示，需记住选择）

export default function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [role, setRole] = useState(localStorage.getItem(ROLE_KEY) || "");
  const [myClassId, setMyClassId] = useState(localStorage.getItem(MY_CLASS_KEY) || "");
  const [account, setAccount] = useState(""); // 当前登录账号（用户名，来自 login / GET /api/me）
  const [profile, setProfile] = useState({ nickname: "", avatar: "" }); // 昵称 + 头像（data URL）
  const [nickInput, setNickInput] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(""); // 个人资料页待保存的头像

  const [bgSaved, setBgSaved] = useState({
    desktop: { pattern: "grid", url: "" },
    mobile: { pattern: "grid", url: "" }
  });
  const [bgPick, setBgPick] = useState({
    desktop: { pattern: "grid", image: "" },
    mobile: { pattern: "grid", image: "" }
  });
  const [landingTab, setLandingTab] = useState("");
  const [landingPick, setLandingPick] = useState("");
  const [tab, setTab] = useState(""); // 空串 = 刚进入，只显示侧边栏，等用户点具体界面
  const schTabRef = useRef("board"); // 记住「奖学金评定」界面内最后停留的子页面

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // 登录弹窗：字段级行内错误、提交中标记（服务端错误仍走 error/loginNotice）、密码可见性
  const [loginFieldErr, setLoginFieldErr] = useState({});
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginShowPass, setLoginShowPass] = useState(false);

  const [students, setStudents] = useState([]);
  const [meta, setMeta] = useState({});
  const [classes, setClasses] = useState([]);
  const [classSel, setClassSel] = useState(localStorage.getItem(CLASS_KEY) || "");
  const [guideClass, setGuideClass] = useState(""); // 未选班级时引导卡片里的待选班级
  const [loading, setLoading] = useState(false);
  const [awards, setAwards] = useState([]);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [uploadClassId, setUploadClassId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [manageMsg, setManageMsg] = useState(null);
  const [preview, setPreview] = useState(null);

  const boardSeq = useRef(0); // 榜单请求序号：快速切班时丢弃先发后到的旧响应

  // 各页面的状态与处理（自定义 hook 挂在 App 层：切界面不丢状态，行为与拆分前一致）
  const chat = usePassSession({ setError, setSubmitting, setSubmitMsg, loadAwards });
  const apply = useApply({ token, setError, setSubmitting, setSubmitMsg, loadAwards, loadBoard, classSel });
  const filters = useApproveFilters({ awards, classSel, tab });
  const manage = useManage({ token, role, myClassId, classSel, uploadClassId, setUploadClassId, loadClasses, loadBoard, loadAwards, setManageMsg });
  const accounts = useAccounts({ token, role, tab, setManageMsg });
  const ai = useAiConfig({ token, setError, tab });
  const bgAdmin = useAppearanceAdmin({ token, bgSaved, setBgSaved, bgPick, setBgPick });
  const landing = useLandingAdmin({ token, landingTab, setLandingTab, landingPick, setLandingPick });
  const profileForm = useProfile({ token, profile, setProfile, nickInput, setNickInput, avatarPreview, setAvatarPreview });

  async function loadBoard(cid) {
    // 榜单按班级展示：未选班级一律不发请求，避免拿到后端跨班合并的榜单
    if (!cid) {
      boardSeq.current += 1; // 作废在途请求的结果
      setStudents([]);
      setMeta({});
      setLoading(false);
      return;
    }
    const my = ++boardSeq.current;
    setLoading(true);
    setError("");
    try {
      const data = await fetchLeaderboard(cid);
      if (my !== boardSeq.current) return; // 已有更新的请求发出（快速切班），丢弃本次旧响应
      setStudents(data.students || []);
      setMeta(data.meta || {});
    } catch (err) {
      if (my !== boardSeq.current) return;
      setError(err.message);
    } finally {
      if (my === boardSeq.current) setLoading(false);
    }
  }

  // 切班的唯一入口：先清空上一班数据（防止竞态下旧行残留），再切换并记住选择
  function handlePickClass(id) {
    if (!id || id === classSel) return;
    setStudents([]);
    setMeta({});
    setClassSel(id);
    localStorage.setItem(CLASS_KEY, id);
  }
  async function loadAwards() {
    setAwardsLoading(true);
    setError("");
    try {
      const filter = role === "admin" ? myClassId : classSel;
      const data = await listAwards(filter || undefined);
      setAwards(data.awards || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setAwardsLoading(false);
    }
  }
  async function loadClasses() {
    try {
      const d = await fetchClasses();
      const list = d.classes || [];
      setClasses(list);
      // 选班兜底（榜单必须带 class_id，不能靠后端合并）：admin 固定本班（不问）；
      // root 用「已存且仍存在」的班级，否则第一个班（root 可自由切换）；
      // 未登录只认本地存过且仍存在的班级，没存过就保持空 → 由榜单页引导卡片询问
      setClassSel((prev) => {
        const cur = prev || localStorage.getItem(CLASS_KEY) || "";
        if (cur && list.some((c) => c.id === cur)) return cur;
        if (role === "admin" && myClassId && list.some((c) => c.id === myClassId)) return myClassId;
        if (role === "root" && list[0]) return list[0].id;
        return "";
      });
      // 导入目标班级：admin 固定本班；root 不预填，必须显式选择（避免拖入时误导入到第一个班级）
      setUploadClassId((prev) => prev || (role === "admin" ? myClassId : ""));
    } catch (err) {
      setError(err.message);
    }
  }

  // 注册会话失效回调：任何带 token 的请求返回 401 时自动登出并弹登录窗
  useEffect(() => {
    setOnAuthExpired(expireSession);
  }, []);
  // 刷新页面时用 token 换取真实 role/班级，避免 localStorage 里的旧值过期
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    fetchMe(saved)
      .then((r) => {
        localStorage.setItem(ROLE_KEY, r.role);
        localStorage.setItem(MY_CLASS_KEY, r.class_id || "");
        setRole(r.role);
        setMyClassId(r.class_id || "");
        setAccount(r.username || "");
        setProfile({ nickname: r.nickname || "", avatar: r.avatar || "" });
        setNickInput(r.nickname || "");
        setAvatarPreview(r.avatar || "");
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadClasses().then(() => setMounted(true));
  }, [token, role, myClassId]);
  // 背景图案与访客开始界面是全站设置，公开接口：访客也要按管理员保存的值渲染
  useEffect(() => {
    getAppearance()
      .then((d) => {
        setBgSaved({ desktop: d.desktop, mobile: d.mobile });
        setBgPick({
          desktop: { pattern: d.desktop.pattern, image: "" },
          mobile: { pattern: d.mobile.pattern, image: "" }
        });
        const landing = PUBLIC_TABS.includes(d.landing) ? d.landing : "";
        setLandingTab(landing);
        setLandingPick(landing);
        if (!token && landing) {
          // 访客直接落到配置的开始界面；用户已抢先点了别的界面则不打扰
          setTab((t) => (t === "" ? landing : t));
          schTabRef.current = landing;
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadBoard(classSel);
    loadAwards();
  }, [token, classSel, role, myClassId]);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    try {
      const data = await login(username, password);
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(ROLE_KEY, data.role || "");
      localStorage.setItem(MY_CLASS_KEY, data.class_id || "");
      setToken(data.token);
      setRole(data.role || "");
      setMyClassId(data.class_id || "");
      setAccount(data.username || "");
      setProfile({ nickname: data.nickname || "", avatar: "" });
      setNickInput(data.nickname || "");
      setAvatarPreview("");
      setPassword("");
      setLoginOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  // 登录表单提交：先做字段级非空校验（不发请求），通过后再交给 handleLogin。
  // 注意：管理员密码可能短于 6 位，这里只校验非空，不做长度限制。
  async function handleLoginSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!username.trim()) errs.username = "请输入账号";
    if (!password) errs.password = "请输入密码";
    setLoginFieldErr(errs);
    if (errs.username || errs.password) return;
    setLoginBusy(true);
    try {
      await handleLogin(e);
    } finally {
      setLoginBusy(false);
    }
  }

  // 会话失效（token 过期或已失效）：清本地登录态、退回公开榜单并弹登录窗提示
  function expireSession(msg) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(MY_CLASS_KEY);
    setToken("");
    setRole("");
    setMyClassId("");
    setAccount("");
    setProfile({ nickname: "", avatar: "" });
    // 退出后成为访客：回到配置的「开始界面」（未配置则只显示侧边栏）
    setTab((t) => (PUBLIC_TABS.includes(t) ? t : landingTab)); // 登录态专属界面（数据管理/配置）随之退出
    schTabRef.current = "board"; // 防止记住的子页面是登录态专属（如数据管理），点「奖学金评定」落空
    setLoginNotice(msg || "登录已过期，请重新登录");
    setLoginOpen(true);
  }

  function handleLogout() {
    logout(token);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(MY_CLASS_KEY);
    setToken("");
    setRole("");
    setMyClassId("");
    setAccount("");
    setProfile({ nickname: "", avatar: "" });
    setTab((t) => (PUBLIC_TABS.includes(t) ? t : landingTab));
    schTabRef.current = "board";
    setLoginNotice("");
  }

  function switchTab(next) {
    // 记住「奖学金评定」界面里最后停留的子页面，从工作台其它界面点回来时不会丢上下文
    if (SCH_TABS.includes(next)) schTabRef.current = next;
    setTab(next);
    setError("");
    if (next === "approve") loadAwards();
  }

  const pendingCount = awards.filter((a) => a.approved === "否").length;

  async function handleExport() {
    setError("");
    // 榜单按班级导出：未选班级不导出，避免把跨班合并榜单导成「某班」文件
    if (!classSel) {
      setError("请先选择班级");
      return;
    }
    try {
      await exportExcel(classSel);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    // 背景图案通过 CSS 变量下发（电脑端/手机端各一套，媒体查询切换，见 index.css「背景图案」）
    <div
      className={`page${mounted ? " mounted" : ""}`}
      style={{
        "--bg-desktop": patternCss("desktop", bgPick, bgSaved).image,
        "--bg-size-desktop": patternCss("desktop", bgPick, bgSaved).size,
        "--bg-repeat-desktop": patternCss("desktop", bgPick, bgSaved).repeat,
        "--bg-pos-desktop": patternCss("desktop", bgPick, bgSaved).pos,
        "--bg-mobile": patternCss("mobile", bgPick, bgSaved).image,
        "--bg-size-mobile": patternCss("mobile", bgPick, bgSaved).size,
        "--bg-repeat-mobile": patternCss("mobile", bgPick, bgSaved).repeat,
        "--bg-pos-mobile": patternCss("mobile", bgPick, bgSaved).pos
      }}
    >
      <div className="bg-grid" />
      <header className="topbar">
        <div className="brand">
          <h1>anticlass</h1>
          {/* 未选班级时副标题整行不显示（榜单按班展示，没选班也没有数据来源可写） */}
          {classSel && (
            <span className="meta">
              {meta.source ? `数据来源：${meta.source}` : "暂无数据"} · 共 {meta.rows ?? 0} 条课程记录 · {students.length} 名学生
            </span>
          )}
        </div>
        <div className="actions">
          <ThemeToggle />
          {token ? (
            <button className="btn ghost" onClick={handleLogout}>退出登录</button>
          ) : (
            <button className="btn" onClick={() => { setLoginNotice(""); setError(""); setLoginOpen(true); }}>
              登录
            </button>
          )}
        </div>
      </header>

      {/* 侧边栏所有访客都显示（不登录也能看榜单/申报/审批）；tab 为空 = 刚进入，只有侧边栏、不显示任何界面。
          功能栏目用 GlassTabs 液态滑块（与二级 Tab 同款）；以后新增功能界面 = 对应组的 options 加一项 + main 里加一个 {tab === "xxx" && …} 分支。 */}
      <div className="shell">
        <aside className="shell-nav">
          {token && (
            <div className="shell-user">
              <Avatar avatar={profile.avatar} nickname={profile.nickname} username={account} size={42} />
              <div className="shell-user-text">
                <strong>{profile.nickname || account}</strong>
                <span>@{account} · {role === "root" ? "超级管理员" : "管理员"}</span>
              </div>
            </div>
          )}
          <div className="nav-group">
            <span className="nav-group-title">统计界面</span>
            {/* 伪值 "sch"：奖学金评定组覆盖 5 个子页，激活态由 tab 是否属于 SCH_TABS 决定 */}
            <GlassTabs
              className="nav-tabs"
              ariaLabel="统计界面"
              value={SCH_TABS.includes(tab) ? "sch" : tab}
              onChange={() => switchTab(schTabRef.current)}
              options={[{ value: "sch", label: "奖学金评定" }]}
            />
          </div>
          {token && (
            <div className="nav-group">
              <span className="nav-group-title">配置</span>
              <GlassTabs
                className="nav-tabs"
                ariaLabel="配置"
                value={tab}
                onChange={switchTab}
                options={[
                  ...(role === "root"
                    ? [
                        { value: "cfg_model", label: "模型配置" },
                        { value: "cfg_accounts", label: "账号管理" },
                      ]
                    : []),
                  { value: "cfg_appearance", label: "背景图案" },
                  { value: "cfg_landing", label: "开始界面" },
                  { value: "cfg_profile", label: "个人资料" },
                ]}
              />
            </div>
          )}
        </aside>

        <div className="shell-body">
          {/* 二级 Tab 只在进入「奖学金评定」后出现；未登录少一个「数据管理」。
              右侧「导出 Excel」是该界面自己的操作（导出当前班级的综合测评总分），未选班级时禁用 */}
          {(token ? SCH_TABS : PUBLIC_TABS).includes(tab) && (
            <nav className="tabs">
              <GlassTabs
                value={tab}
                onChange={switchTab}
                options={(token ? SCH_TABS : PUBLIC_TABS).map((t) => ({
                  value: t,
                  label: (
                    <>
                      {TAB_LABELS[t]}
                      {t === "approve" && pendingCount > 0 ? `（${pendingCount}）` : ""}
                    </>
                  )
                }))}
              />
              <span className="tabs-fill" />
              <button
                className="btn small tabs-action"
                onClick={handleExport}
                disabled={!classSel}
                title={classSel ? "导出当前班级的综合测评总分 xlsx" : "请先选择班级"}
              >
                导出 Excel
              </button>
            </nav>
          )}

          {error && !loginOpen && <div className="error bar">{error}</div>}

          <main>

            {tab === "pass" && (
              <PassPage
                chat={chat}
                classes={classes}
                classSel={classSel}
                handlePickClass={handlePickClass}
                students={students}
                submitting={submitting}
              />
            )}
            {tab === "board" && (
              <BoardPage
                token={token}
                classes={classes}
                classSel={classSel}
                students={students}
                loading={loading}
                guideClass={guideClass}
                setGuideClass={setGuideClass}
                handlePickClass={handlePickClass}
                switchTab={switchTab}
              />
            )}
            {tab === "apply" && (
              <ApplyPage
                apply={apply}
                token={token}
                classes={classes}
                classSel={classSel}
                handlePickClass={handlePickClass}
                students={students}
                submitting={submitting}
                submitMsg={submitMsg}
                setPreview={setPreview}
              />
            )}
            {tab === "approve" && (
              <ApprovePage
                filters={filters}
                awards={awards}
                awardsLoading={awardsLoading}
                token={token}
                role={role}
                myClassId={myClassId}
                classes={classes}
                classSel={classSel}
                handlePickClass={handlePickClass}
                loadAwards={loadAwards}
                loadBoard={loadBoard}
                setPreview={setPreview}
              />
            )}
            {tab === "manage" && token && (
              <ManagePage
                manage={manage}
                token={token}
                role={role}
                myClassId={myClassId}
                classes={classes}
                manageMsg={manageMsg}
              />
            )}
            {tab === "cfg_accounts" && token && role === "root" && (
              <AccountsPage accounts={accounts} classes={classes} manageMsg={manageMsg} />
            )}
            {tab === "cfg_appearance" && token && (
              <AppearancePage
                bgSaved={bgSaved}
                bgPick={bgPick}
                setBgPick={setBgPick}
                bg={bgAdmin}
              />
            )}
            {tab === "cfg_landing" && token && (
              <LandingPage landingTab={landingTab} landing={landing} />
            )}
            {tab === "cfg_profile" && token && (
              <ProfilePage
                profileForm={profileForm}
                account={account}
                role={role}
                myClassId={myClassId}
                classes={classes}
              />
            )}
            {tab === "cfg_model" && token && role === "root" && <ModelConfigPage ai={ai} />}
          </main>
        </div>
      </div>

      <Modal
        open={loginOpen}
        sheetClass="login-sheet"
        title="登录"
        showConfirm={false}
        cancelText="取消"
        onCancel={() => { setLoginOpen(false); setPassword(""); setError(""); setLoginFieldErr({}); setLoginShowPass(false); }}
      >
        <form className="login-form" onSubmit={handleLoginSubmit} noValidate>
          <p className="login-hint">管理员登录后可进行审批、调分与数据管理</p>
          {loginNotice && <div className="login-server-error warn" role="alert">{loginNotice}</div>}
          {error && <div className="login-server-error" role="alert">{error}</div>}

          <div className="login-field">
            <label className="login-label" htmlFor="login-username">账号</label>
            <TextField
              id="login-username"
              className={`login-input${loginFieldErr.username ? " invalid" : ""}`}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (loginFieldErr.username) setLoginFieldErr({ ...loginFieldErr, username: "" });
              }}
              placeholder="请输入账号"
              autoComplete="username"
              aria-invalid={loginFieldErr.username ? "true" : undefined}
              data-autofocus
            />
            {loginFieldErr.username && <span className="login-field-error" role="alert">{loginFieldErr.username}</span>}
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">密码</label>
            <div className="login-pass-wrap">
              <TextField
                id="login-password"
                className={`login-input${loginFieldErr.password ? " invalid" : ""}`}
                type={loginShowPass ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (loginFieldErr.password) setLoginFieldErr({ ...loginFieldErr, password: "" });
                }}
                placeholder="请输入密码"
                autoComplete="current-password"
                aria-invalid={loginFieldErr.password ? "true" : undefined}
              />
              <button
                type="button"
                className="login-pass-toggle"
                aria-pressed={loginShowPass}
                aria-label={loginShowPass ? "隐藏密码" : "显示密码"}
                onClick={() => setLoginShowPass((v) => !v)}
              >
                {loginShowPass ? "隐藏" : "显示"}
              </button>
            </div>
            {loginFieldErr.password && <span className="login-field-error" role="alert">{loginFieldErr.password}</span>}
          </div>

          <button type="submit" className="btn login-submit" aria-busy={loginBusy ? "true" : undefined} disabled={loginBusy}>
            {loginBusy ? <><span className="spin" /> 登录中…</> : "登 录"}
            {!loginBusy && <span className="login-arrow" aria-hidden="true">→</span>}
          </button>
        </form>
      </Modal>

      <Modal
        open={!!preview}
        title={preview ? preview.file.slice(preview.file.indexOf("_") + 1) : ""}
        showConfirm={false}
        cancelText="关闭"
        onCancel={() => setPreview(null)}
      >
        {preview && <img className="img-preview" src={evidenceUrl(preview.aid, preview.file)} alt={preview.file} />}
      </Modal>
    </div>
  );
}
