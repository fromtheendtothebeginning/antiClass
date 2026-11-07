import { useEffect, useRef, useState } from "react";

function Reveal({ as: Tag = "div", className = "", delay = 0, children, ...rest }) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 挂载时已在视口内或已滚过（顶边在视口上方）就直接显示：列表底部滚到头时
    // 只露出很小一截，若全靠 observer 的阈值判定会永远不触发、卡片一直透明占位
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setRevealed(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRevealed(true);
            obs.unobserve(entry.target);
          }
        });
      },
      // 只要露出任意一部分就显示（不设阈值和负边距，列表末尾的卡片也能正常出现）
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cls = `scroll-reveal${revealed ? " revealed" : ""}${className ? " " + className : ""}`;
  return (
    <Tag ref={ref} className={cls} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  );
}

export default Reveal;