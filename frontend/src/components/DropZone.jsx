import { useRef, useState } from "react";

/** 缺省的「上传」图标（用 currentColor，跟随父级文字颜色） */
function UploadIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V17" />
    </svg>
  );
}

/**
 * 大窗口拖拽 / 点击选择文件区（无状态，选完交给调用方处理）
 *
 * @param {string} [accept] - 透传给隐藏 input 的 accept
 * @param {boolean} [multiple=false] - 是否允许多选
 * @param {boolean} [disabled=false] - 禁用：不响应点击与拖拽
 * @param {boolean} [busy=false] - 忙碌态：图标换成 spinner、标题换成 busyText、禁止交互
 * @param {string} [busyText='处理中…'] - 忙碌文案
 * @param {string} [title='把文件拖到这里'] - 主文案
 * @param {string} [hint] - 副文案
 * @param {ReactNode} [icon=null] - 自定义图标节点，缺省为内联上传箭头 SVG
 * @param {function(FileList)} [onFiles] - 选中 / 拖入文件回调（参数为 FileList）
 * @param {string} [className=''] - 额外 class
 * @param {ReactRef} [inputRef] - 可选：拿到内部 input 的 ref（父组件可 `inputRef.current.value = ""` 清空重置）
 */
function DropZone({
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  busyText = "处理中…",
  title = "把文件拖到这里",
  hint = "或点击选择文件",
  icon = null,
  onFiles,
  className = "",
  inputRef
}) {
  const innerRef = useRef(null);
  const ref = inputRef || innerRef;
  const [isOver, setIsOver] = useState(false);
  const blocked = disabled || busy;

  const handleFiles = (files) => {
    if (files && files.length && onFiles) onFiles(files);
  };

  const openPicker = () => {
    if (blocked) return;
    ref.current?.click();
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openPicker();
  };

  // 拖拽事件四件套：dragover / dragenter 必须 preventDefault 才能收到 drop；
  // 移入子元素时 dragleave 也会触发，用 relatedTarget 判断是否仍在区域内，避免高亮抖动。
  const handleDragOver = (e) => {
    e.preventDefault();
    if (blocked) return;
    if (!isOver) setIsOver(true);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (blocked) return;
    setIsOver(true);
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsOver(false);
  };

  const handleDrop = (e) => {
    // 禁用时也要拦截，否则浏览器会直接打开被拖入的文件
    e.preventDefault();
    setIsOver(false);
    if (blocked) return;
    handleFiles(e.dataTransfer && e.dataTransfer.files);
    // 清空 input 值，保证同一个文件还能再次选择 / 拖入
    if (ref.current) ref.current.value = "";
  };

  const handleChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  };

  const cls =
    "dropzone" +
    (isOver && !blocked ? " is-over" : "") +
    (blocked ? " disabled" : "") +
    (className ? " " + className : "");

  return (
    <div
      className={cls}
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked || undefined}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={handleChange}
      />
      <span className="dropzone-icon">{busy ? <span className="spin" /> : icon || <UploadIcon />}</span>
      <span className="dropzone-title">{busy ? busyText : title}</span>
      {!busy && hint && <span className="dropzone-hint">{hint}</span>}
    </div>
  );
}

export default DropZone;
