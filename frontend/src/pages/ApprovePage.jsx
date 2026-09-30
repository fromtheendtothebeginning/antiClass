// pages/ApprovePage.jsx — 纯展示组件：加分审批（状态与处理在 App/hooks，切界面不丢状态）
import Dropdown from "../components/Dropdown.jsx";
import Reveal from "../components/Reveal.jsx";
import AwardCard from "../components/AwardCard.jsx";
import { CATEGORIES } from "../constants.js";

export default function ApprovePage({filters, awards, awardsLoading, token, role, myClassId, classes, classSel, handlePickClass, loadAwards, loadBoard, setPreview}) {
  const {
    awardQuery, setAwardQuery, awardSuggestOpen, setAwardSuggestOpen, awardSuggestIdx, setAwardSuggestIdx,
    awardCategory, setAwardCategory, awardStatus, setAwardStatus, visibleCount, setVisibleCount, filteredAwards,
    awardSuggestOptions, awardSuggestPick, awardSuggestKeyDown, awardSentinelRef,
  } = filters;
  return (
    <>
          <div className="panel">
            <h2>加分审批</h2>
            {role !== "admin" && classes.length > 1 && (
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
            {role === "admin" && (
              <p className="hint">当前班级：{classes.find((c) => c.id === myClassId)?.name || "（未分配）"}（管理员仅能查看和审批本班申报）</p>
            )}
            <p className="hint">
              申报公示公开，任何人可查看依据与证据；仅管理员登录后可审批（通过/驳回/撤回/删除）。
              {!token && " 点击右上角「登录」进行审批。"}
            </p>
            <div className="filter-bar">
              <div className="award-search">
                <input
                  className="filter-input"
                  placeholder="学号 / 姓名（空格分隔模糊搜索，/正则/ 按正则匹配）"
                  value={awardQuery}
                  autoComplete="off"
                  onChange={(e) => { setAwardQuery(e.target.value); setAwardSuggestIdx(-1); }}
                  onFocus={() => setAwardSuggestOpen(true)}
                  onBlur={() => setAwardSuggestOpen(false)}
                  onKeyDown={awardSuggestKeyDown}
                />
                {awardSuggestOptions.length > 0 && (
                  <div className="award-suggest">
                    {awardSuggestOptions.map((v, i) => (
                      <button
                        key={v}
                        type="button"
                        className={i === awardSuggestIdx ? "picked" : ""}
                        // mousedown 阻止默认行为，避免输入框先失焦把建议列表收掉
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setAwardSuggestIdx(i)}
                        onClick={() => awardSuggestPick(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Dropdown
                value={awardCategory}
                onChange={setAwardCategory}
                options={[{ value: "", label: "全部分类" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
                placeholder="全部分类"
              />
              <Dropdown
                value={awardStatus}
                onChange={setAwardStatus}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "否", label: "待审批" },
                  { value: "是", label: "已通过" },
                  { value: "驳回", label: "已驳回" }
                ]}
                placeholder="全部状态"
              />
              <span className="file-count">共 {filteredAwards.length} 条</span>
            </div>
            {awardsLoading && awards.length === 0 ? (
              <div className="loading">加载中…</div>
            ) : awards.length === 0 ? (
              <p className="hint">暂无申报记录。</p>
            ) : filteredAwards.length === 0 ? (
              <p className="hint">没有符合筛选条件的申报。</p>
            ) : (
              <>
                {filteredAwards.slice(0, visibleCount).map((a, i) => (
                  <Reveal key={a.id} delay={(i % 10) * 70}>
                    <AwardCard award={a} token={token} onRefresh={() => { loadAwards(); loadBoard(classSel); }} onPreview={(aid, f) => setPreview({ aid, file: f })} />
                  </Reveal>
                ))}
                {/* 哨兵进入视口提前量即自动加载下一批；不支持 IntersectionObserver 时才回退为手动按钮 */}
                {filteredAwards.length > visibleCount &&
                  ("IntersectionObserver" in window ? (
                    <div ref={awardSentinelRef} className="award-sentinel" aria-hidden="true" />
                  ) : (
                    <div className="award-more">
                      <button className="btn ghost" onClick={() => setVisibleCount((c) => c + 4)}>
                        显示更多（剩余 {filteredAwards.length - visibleCount} 条）
                      </button>
                    </div>
                  ))}
              </>
            )}
          </div>
    </>
  );
}
