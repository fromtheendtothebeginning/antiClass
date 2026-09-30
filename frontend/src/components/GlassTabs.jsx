import { useEffect, useRef, useState } from "react";

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** 量取容器内 [data-active="1"] 子元素相对容器的位置（含 flex 换行后的 offsetTop） */
function useActiveRect(ref, dep) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const active = el.querySelector('[data-active="1"]');
      if (active) {
        setRect({
          left: active.offsetLeft,
          top: active.offsetTop,
          width: active.offsetWidth,
          height: active.offsetHeight
        });
      }
    };
    measure();
    // 容器尺寸变化（窗口缩放/字体就绪/标签文字变宽）时重新量取
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return rect;
}

/**
 * 液态玻璃分段切换：玻璃轨道上一块滑块跟着选中项滑动（spring 惯性回弹），
 * 滑块本体在每次移动时轻微拉伸再回弹（液态感）。选项文字/节点由 options.label 给出。
 * 支持按住拖动换挡，**二维跟手**：滑块横纵都跟随手指（手机端 Tab 换行成两行时，
 * 可以从第一行拖到第二行），松手落入指下选项并回弹落位。
 * 位移 ≥6px（任意方向）即接管；轨道 touch-action: none，触摸手势全归滑块、
 * 不再与页面滚动抢（页面滚动从 Tab 栏下方的内容区划）；触摸指针不做显式捕获
 * （部分手机内核会因此拦掉原生行为），靠触摸自带的隐式捕获接收后续事件，
 * 松手 click 用标志位吃掉防误切。
 */
export default function GlassTabs({ className = "", value, onChange, options, ariaLabel }) {
  const ref = useRef(null);
  const rect = useActiveRect(ref, value);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [drag, setDrag] = useState(null);

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ref.current;
    if (!el || !rect || dragRef.current) return;
    suppressClickRef.current = false;
    const cRect = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll(".gtab")];
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      thumbW: rect.width,
      thumbH: rect.height,
      target: value,
      items: buttons.map((b, i) => {
        const r = b.getBoundingClientRect();
        return {
          value: options[i]?.value,
          left: r.left - cRect.left,
          top: r.top - cRect.top,
          width: r.width,
          height: r.height
        };
      })
    };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 6) return; // 位移过小 = 还是普通点击，交给按钮自己的 onClick
      d.moved = true;
      if (e.pointerType === "mouse") {
        try {
          el.setPointerCapture(d.id); // 鼠标移出轨道也跟手；松手 click 落在容器上不误触按钮
        } catch {
          /* 指针已释放 */
        }
      }
    }
    const right = Math.max(...d.items.map((it) => it.left + it.width));
    const bottom = Math.max(...d.items.map((it) => it.top + it.height));
    const left = clamp(d.startLeft + dx, d.items[0].left, right - d.thumbW);
    const top = clamp(d.startTop + dy, d.items[0].top, bottom - d.thumbH);
    const cRect = el.getBoundingClientRect();
    const x = e.clientX - cRect.left;
    const y = e.clientY - cRect.top;
    const hit = d.items.find(
      (it) => x >= it.left && x <= it.left + it.width && y >= it.top && y <= it.top + it.height
    );
    if (hit) d.target = hit.value;
    setDrag({ left, top, width: d.thumbW, height: d.thumbH, target: d.target });
  };

  const onPointerEnd = (e, commit) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    if (!d.moved) return; // 原地松手 = 普通点击，交给按钮自己的 onClick
    suppressClickRef.current = true; // 触摸隐式捕获下松手 click 会落在起点按钮上，吃掉防误切
    setDrag(null); // 恢复过渡，滑块 spring 回弹到落位选项
    if (commit && d.target && d.target !== value) onChange(d.target);
  };

  const thumb = drag || rect;
  return (
    <div
      className={`glass-tabs${drag ? " dragging" : ""}${className ? ` ${className}` : ""}`}
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, true)}
      onPointerCancel={(e) => onPointerEnd(e, false)}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
    >
      <span
        className={`slide-thumb${thumb ? " on" : ""}`}
        style={thumb ? { transform: `translate(${thumb.left}px, ${thumb.top}px)`, width: thumb.width, height: thumb.height } : undefined}
        aria-hidden="true"
      >
        {/* key 变化 = 重新播放拉伸动画；位移动画由外层 transform 过渡承担，互不打架。拖动中 key 固定，避免每帧重播 */}
        <span className="slide-thumb-goo" key={drag ? "drag" : rect ? `${rect.left}:${rect.top}:${rect.width}` : "init"} />
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-selected={value === o.value}
          data-active={value === o.value ? "1" : undefined}
          title={o.title}
          className={`gtab${value === o.value ? " active" : ""}${drag && drag.target === o.value && o.value !== value ? " drag-target" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
