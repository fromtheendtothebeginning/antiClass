import { useEffect, useRef, useState } from "react";

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
 */
export default function GlassTabs({ className = "", value, onChange, options, ariaLabel }) {
  const ref = useRef(null);
  const rect = useActiveRect(ref, value);
  return (
    <div className={`glass-tabs${className ? ` ${className}` : ""}`} ref={ref} role="group" aria-label={ariaLabel}>
      <span
        className={`slide-thumb${rect ? " on" : ""}`}
        style={rect ? { transform: `translate(${rect.left}px, ${rect.top}px)`, width: rect.width, height: rect.height } : undefined}
        aria-hidden="true"
      >
        {/* key 变化 = 重新播放拉伸动画；位移动画由外层 transform 过渡承担，互不打架 */}
        <span className="slide-thumb-goo" key={rect ? `${rect.left}:${rect.top}:${rect.width}` : "init"} />
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-selected={value === o.value}
          data-active={value === o.value ? "1" : undefined}
          title={o.title}
          className={`gtab${value === o.value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
