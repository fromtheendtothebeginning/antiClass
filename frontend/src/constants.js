// constants.js — 跨界面共享的常量（各页面私有的常量放在各自文件里）

export const CATEGORIES = ["德育", "体育", "美育", "劳育", "附加分"];

export const SCH_TABS = ["board", "apply", "pass", "approve", "manage"];
export const PUBLIC_TABS = ["board", "apply", "pass", "approve"];
export const TAB_LABELS = { board: "榜单", apply: "加分申报", pass: "加分一遍过", approve: "加分审批", manage: "数据管理" };

export const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));

export const CC_ROLES = [
  { role: "班长、团支书、辅导员助理", points: 8 },
  { role: "副班长、学习委员", points: 4 },
  { role: "班级其他学干", points: 2 }
];

export const CC_ROLE_OPTIONS = CC_ROLES.map((r) => ({ value: r.role, label: `${r.role}（+${r.points}）` }));

export const BG_PATTERNS = [
  {
    id: "grid",
    label: "网格",
    image: "linear-gradient(var(--accent-1-soft) 1px, transparent 1px), linear-gradient(90deg, var(--accent-1-soft) 1px, transparent 1px)",
    size: "60px 60px",
    swatchSize: "14px 14px"
  },
  {
    id: "dots",
    label: "点阵",
    image: "radial-gradient(var(--accent-1-soft-strong) 1.4px, transparent 1.4px)",
    size: "26px 26px",
    swatchSize: "9px 9px"
  },
  {
    id: "stripes",
    label: "斜纹",
    image: "repeating-linear-gradient(45deg, var(--accent-1-soft) 0 2px, transparent 2px 20px)",
    size: "auto",
    swatchSize: "auto"
  },
  { id: "none", label: "无图案", image: "none", size: "auto", swatchSize: "auto" }
];

export const BG_SLOTS = [
  { id: "desktop", label: "电脑端（宽屏）", fit: "100% auto", fitText: "按宽度铺满" },
  { id: "mobile", label: "手机端（≤768px）", fit: "auto 100%", fitText: "按高度铺满" }
];
