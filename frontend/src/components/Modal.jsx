import { useEffect } from "react";

function Modal({
  open,
  title,
  message,
  children,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  showConfirm = true,
  showCancel = true,
  confirmDisabled = false,
  onConfirm,
  onCancel
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && onCancel) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children != null ? <div className="modal-body">{children}</div> : <p>{message}</p>}
        {(showConfirm || showCancel) && (
          <div className="modal-actions">
            {showCancel && (
              <button className="btn btn-secondary" onClick={onCancel}>
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
    </div>
  );
}

export default Modal;