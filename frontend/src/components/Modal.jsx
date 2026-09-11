import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** 可聚焦元素选择器（排除 tabindex="-1"，避免把弹窗自身算进去） */
const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * 通用弹窗（createPortal 到 body，Esc 关闭，打开期间锁定背景滚动）
 *
 * @param {boolean} open - 是否显示
 * @param {string} title - 标题
 * @param {string} message - 纯文本内容（未传 children 时才会渲染）
 * @param {ReactNode} children - 自定义内容（渲染在 .modal-body 内，超高自动滚动）
 * @param {'sm'|'md'|'lg'} [size='md'] - 宽度档位，附加到 .modal-sheet 上（md 即默认 400px，不加 class）
 * @param {string} [sheetClass=''] - 附加到 .modal-sheet 的自定义 class（如 "login-sheet"，用于单独挂样式/入场动画）
 * @param {string} [confirmText='确认'] - 确认按钮文案
 * @param {string} [cancelText='取消'] - 取消按钮文案
 * @param {boolean} [danger=false] - 确认按钮是否用危险样式
 * @param {boolean} [showConfirm=true] - 是否显示确认按钮
 * @param {boolean} [showCancel=true] - 是否显示取消按钮（也决定点遮罩能否关闭）
 * @param {boolean} [confirmDisabled=false] - 确认按钮禁用
 * @param {boolean} [closeOnOverlay=true] - 点击遮罩层（非弹窗内容）是否等同取消
 * @param {function} onConfirm - 确认回调
 * @param {function} onCancel - 取消/关闭回调（Esc、取消按钮、点遮罩都走它）
 */
function Modal({
  open,
  title,
  message,
  children,
  size = "md",
  sheetClass = "",
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  showConfirm = true,
  showCancel = true,
  confirmDisabled = false,
  closeOnOverlay = true,
  onConfirm,
  onCancel
}) {
  const sheetRef = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        if (onCancel) onCancel();
        return;
      }
      // 简单焦点圈定：Tab 在弹窗内循环，不跑到背景页面
      if (e.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const nodes = sheet.querySelectorAll(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!sheet.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);

    // 弹窗打开期间锁定背景滚动，禁止操作弹窗外的页面
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel]);

  // 仅在「打开」这一刻把焦点移入弹窗：优先 [data-autofocus]，危险弹窗其次聚焦取消按钮（避免回车误确认），
  // 否则第一个可聚焦元素，兜底弹窗自身。单独一个 effect + 只依赖 open/danger，避免父组件重渲染时反复抢焦点
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const target =
      sheet.querySelector("[data-autofocus]") ||
      (danger ? cancelRef.current : null) ||
      sheet.querySelector(FOCUSABLE) ||
      sheet;
    if (target && typeof target.focus === "function") target.focus();
  }, [open, danger]);

  if (!open) return null;

  const onOverlayClick = (e) => {
    // 只有点在遮罩自身（不是弹窗内容）才关闭
    if (e.target !== e.currentTarget) return;
    if (!closeOnOverlay || showCancel === false) return;
    if (onCancel) onCancel();
  };

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onOverlayClick}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={["modal-sheet", size === "sm" || size === "lg" ? size : "", sheetClass].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children != null ? <div className="modal-body">{children}</div> : <p>{message}</p>}
        {(showConfirm || showCancel) && (
          <div className="modal-actions">
            {showCancel && (
              <button ref={cancelRef} className="btn btn-secondary" onClick={onCancel}>
                {cancelText}
              </button>
            )}
            {showConfirm && (
              <button
                className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
                onClick={onConfirm}
                disabled={confirmDisabled}
              >
                {confirmText}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
