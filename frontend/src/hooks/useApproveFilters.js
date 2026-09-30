// useApproveFilters.js — 加分审批页的筛选/自动补全/分批加载状态（挂 App 层，切界面保留筛选条件）
import { useEffect, useRef, useState } from "react";
import { evidenceUrl } from "../api.js";
import { isImage } from "../utils/img.js";

export function useApproveFilters({ awards, classSel, tab }) {
  const [awardQuery, setAwardQuery] = useState("");
  const [awardSuggestOpen, setAwardSuggestOpen] = useState(false);
  const [awardSuggestIdx, setAwardSuggestIdx] = useState(-1); // 键盘高亮项（替代原生 datalist 的方向键选择）
  const [awardCategory, setAwardCategory] = useState("");
  const [awardStatus, setAwardStatus] = useState("");
  const [visibleCount, setVisibleCount] = useState(4);
  const awardSentinelRef = useRef(null); // 审批列表底部的滚动预加载哨兵
  const awardObserverRef = useRef(null); // 哨兵的 IntersectionObserver（卸载/重建时 disconnect）
  const prefetchedRef = useRef(new Set()); // 已预取的证据图 URL，避免重复拉取

  // 筛选条件（关键词/栏目/状态）、班级或 Tab 变化时重置分批数量，避免切换后一次显示很长一截
  useEffect(() => {
    setVisibleCount(4);
  }, [awardQuery, awardCategory, awardStatus, classSel, tab]);

  const awardQueryTrim = awardQuery.trim();
  const awardTokens = awardQueryTrim ? awardQueryTrim.split(/\s+/).filter(Boolean) : [];
  // 搜索词 → 匹配函数：/.../ 包裹按正则（写错退回字面），其余字面包含、忽略大小写。
  // 普通关键词里的 . ? + ( 等若被静默当正则，会出现意外全中（"三?" 等价空匹配）或意外漏配
  const awardTokenMatcher = (t) => {
    if (t.length > 2 && t.startsWith("/") && t.endsWith("/")) {
      try {
        const re = new RegExp(t.slice(1, -1), "i");
        return (text) => re.test(text);
      } catch {
        // 正则写错时退回字面搜索，至少还能搜到内容
      }
    }
    const low = t.toLowerCase();
    return (text) => (text || "").toLowerCase().includes(low);
  };
  const awardMatchers = awardTokens.map(awardTokenMatcher);
  const filteredAwards = awards.filter((a) => {
    if (awardMatchers.length && !awardMatchers.some((m) => m(a.sid) || m(a.name || ""))) {
      return false; // 模糊搜索：空格分隔的多个片段，任一片段命中即通过
    }
    return (!awardCategory || a.category === awardCategory) && (!awardStatus || a.approved === awardStatus);
  });
  const awardStudentOptions = [
    ...new Map(awards.map((a) => [a.sid, `${a.sid} ${a.name}`])).values(),
  ];
  // 自动补全建议：与搜索框同一套匹配规则（datalist 原生只按字面过滤，匹配不了 /正则/）
  const awardSuggestOptions = awardSuggestOpen
    ? (awardMatchers.length
        ? awardStudentOptions.filter((v) => awardMatchers.some((m) => m(v)))
        : awardStudentOptions
      ).slice(0, 10)
    : [];
  const awardSuggestPick = (v) => {
    setAwardQuery(v);
    setAwardSuggestOpen(false);
    setAwardSuggestIdx(-1);
  };
  // 输入框键盘导航：↑↓ 在建议间移动、回车确认、Esc 关闭（对齐原生 datalist 的手感）
  const awardSuggestKeyDown = (e) => {
    if (e.key === "Escape") {
      setAwardSuggestOpen(false);
      setAwardSuggestIdx(-1);
      return;
    }
    if (!awardSuggestOptions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAwardSuggestIdx((i) => {
        const last = awardSuggestOptions.length - 1;
        if (e.key === "ArrowDown") return i >= last ? 0 : i + 1;
        return i <= 0 ? last : i - 1;
      });
    } else if (e.key === "Enter" && awardSuggestIdx >= 0 && awardSuggestIdx < awardSuggestOptions.length) {
      e.preventDefault();
      awardSuggestPick(awardSuggestOptions[awardSuggestIdx]);
    }
  };

  // 滚动预加载：列表底部哨兵进入「视口下方 400px」范围即自动追加一批，替代手动「显示更多」
  // 依赖 visibleCount 重建观察器：新建的观察器会立刻上报一次当前相交状态，因此一批加完后
  // 哨兵若仍在提前量内会继续加载下一批（首屏 4 条折叠卡不满一屏时不会卡住），
  // 直到哨兵被推出提前量之外或数据取完（哨兵此时已不渲染）
  useEffect(() => {
    const el = awardSentinelRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + 4, filteredAwards.length));
        }
      },
      { rootMargin: "0px 0px 400px 0px" }
    );
    ob.observe(el);
    awardObserverRef.current = ob;
    return () => ob.disconnect();
  }, [visibleCount, filteredAwards.length, tab]);

  // 证据图片预加载：在下一批（slice(visibleCount, visibleCount+4)）插入 DOM 之前，
  // 就把它用到的图片类证据拉进浏览器缓存，滚动下去即刻有图、不用等现拉。
  // 只预取下一批（不把整份列表的图都拉下来），同一 URL 只预取一次，失败静默忽略。
  // 仅在「加分审批」Tab 生效，避免用户没打开审批页就白白拉图
  useEffect(() => {
    if (tab !== "approve") return;
    filteredAwards.slice(visibleCount, visibleCount + 4).forEach((a) => {
      (a.evidence || []).forEach((f) => {
        if (!isImage(f)) return; // 非图片证据（pdf/zip 等）不预取
        const url = evidenceUrl(a.id, f);
        if (prefetchedRef.current.has(url)) return;
        prefetchedRef.current.add(url);
        const img = new Image();
        img.onerror = () => {}; // 预取失败（404 等）静默吞掉，不打扰界面
        img.src = url;
      });
    });
  }, [visibleCount, awards, awardQuery, awardCategory, awardStatus, tab]);

  return {
    awardQuery, setAwardQuery, awardSuggestOpen, setAwardSuggestOpen, awardSuggestIdx, setAwardSuggestIdx,
    awardCategory, setAwardCategory, awardStatus, setAwardStatus, visibleCount, setVisibleCount,
    filteredAwards, awardSuggestOptions, awardSuggestPick, awardSuggestKeyDown, awardSentinelRef,
  };
}
