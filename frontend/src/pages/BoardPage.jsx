// pages/BoardPage.jsx — 纯展示组件：榜单（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";

export default function BoardPage({token, classes, classSel, students, loading, guideClass, setGuideClass, handlePickClass, switchTab}) {

  return (
    <>
          <>
            <div className="promo-bar">
              <span className="promo-text">
                想核对还有哪些项目能加分？试试<b>「加分一遍过」</b>——AI 按评定办法逐项提问，当场确认加分项。
              </span>
              <button className="btn small" onClick={() => switchTab("pass")}>去加分一遍过 →</button>
            </div>
            {classSel && classes.length > 1 && (
              <div className="class-bar">
                <label>班级</label>
                <Dropdown
                  value={classSel}
                  onChange={handlePickClass}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="选择班级"
                />
              </div>
            )}
            {!classSel ? (
              // 未选班级（如未登录的访客）先询问班级：榜单按班展示，不能展示跨班合并的榜单
              <div className="panel guide-card">
                <h2>请选择要查看的班级</h2>
                <p className="hint">榜单按班级分别展示。选择后会记住该班级，下次打开直接显示。</p>
                {classes.length === 0 ? (
                  <p className="hint">暂无班级数据，请联系管理员。</p>
                ) : (
                  <div className="class-bar">
                    <label>班级</label>
                    <Dropdown
                      value={guideClass || classes[0].id}
                      onChange={setGuideClass}
                      options={classes.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="选择班级"
                    />
                    <button
                      type="button"
                      className="btn primary-btn"
                      onClick={() => handlePickClass(guideClass || classes[0].id)}
                    >
                      查看榜单
                    </button>
                  </div>
                )}
              </div>
            ) : loading ? (
              <div className="loading">加载中…</div>
            ) : (
              <div className="table-wrap">
                <table className="board">
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>学号</th>
                      <th>姓名</th>
                      <th>德育</th>
                      <th>智育</th>
                      <th>体育</th>
                      <th>美育</th>
                      <th>劳育</th>
                      <th>附加分</th>
                      <th>综合测评成绩</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr
                        key={`${s.class_id || ""}:${s.sid}`}
                        style={{ "--i": Math.max(s.rank - 1, 0) }}
                        className={`${s.rank > 0 && s.rank <= 3 ? `top top-${s.rank}` : ""}${s.rank === 0 ? " disq" : ""}`}
                      >
                        {/* data-label：手机端表格变卡片后，各分数项的标签由 CSS ::before 取用 */}
                        <td className="rank"><span>{s.rank > 0 ? s.rank : "无资格"}</span></td>
                        <td data-label="学号">{s.sid}</td>
                        <td className="name">{s.name}</td>
                        <td data-label="德育">{s.deyu.toFixed(1)}</td>
                        <td data-label="智育" className="score">{s.score.toFixed(1)}</td>
                        <td data-label="体育">{s.tiyu.toFixed(1)}</td>
                        <td data-label="美育">{s.meiyu.toFixed(1)}</td>
                        <td data-label="劳育">{s.laoyu.toFixed(1)}</td>
                        <td data-label="附加分">{s.fujia.toFixed(1)}</td>
                        <td className="total">{s.total.toFixed(2)}</td>
                      </tr>
                    ))}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={10} className="empty">暂无数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="formula">
              综合测评成绩 = 德育×15% + 智育×60% + 体育×10% + 美育×5% + 劳育×10% + 附加分（≤5）。
              榜单公开查看；德育/美育/劳育默认 70（基础分），附加分默认 0，体育取体育课成绩。
              {token
                ? "分数调整请使用「加分申报 → 分数调整」表单，支持正则批量选人并留痕。"
                : "管理员登录后可在「数据管理」页导入 xlsx，在「加分申报」页批量加分和调整分数。"}
            </p>
          </>
    </>
  );
}
