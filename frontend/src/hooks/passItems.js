// passItems.js — 撤回后按服务端权威 items 重建本地加分项列表

// 撤回后按服务端权威 items 重建本地加分项列表：以「栏目|分值|依据」三元组匹配，
// 命中则保留本地已挂的 evidence/evServer/auto 字段，命中不了才新建
// （不能用下标切片：auto_items 分支的客户端去重会让本地下标与后端错位）
export function rebuildPassItems(serverItems, localItems) {
  const pool = [...localItems];
  const key = (x) => `${x.category}|${Number(x.points) || 0}|${(x.basis || "").trim()}`;
  return (serverItems || []).map((it) => {
    const hit = pool.findIndex((x) => key(x) === key(it));
    if (hit >= 0) return pool.splice(hit, 1)[0];
    return { category: it.category, points: it.points, basis: it.basis, evidence: [], evServer: [] };
  });
}
