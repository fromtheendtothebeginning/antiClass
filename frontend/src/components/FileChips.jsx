/**
 * 已选文件 chip 列表（空数组时不渲染任何东西）
 *
 * @param {Array<{name: string}>} files - 已选文件（File[] 或任意带 name 的对象）
 * @param {function(number)} onRemove - 点击 ✕ 回调，参数为该文件下标
 * @param {string} [className='chat-files'] - 容器 class（表单区可用 chat-attach-preview）
 */
function FileChips({ files, onRemove, className = "chat-files" }) {
  if (!files || files.length === 0) return null;

  return (
    <div className={className}>
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="file-chip">
          {f.name}
          <button type="button" className="chip-x" onClick={() => onRemove && onRemove(i)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export default FileChips;
