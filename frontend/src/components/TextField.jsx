import { forwardRef } from "react";

/**
 * 统一圆角文本输入框（全站「证据/依据/理由/描述」类文本框统一走这里）
 *
 * 设计约定：
 * - 不包 wrapper、不内置 label：className 与其余 props 全部透传到内层 input/textarea。
 *   原因：多处（.assess-basis / .draft-basis / .chat-form input）的尺寸与 flex 规则挂在输入元素本身，
 *   多包一层 div 会让 flex item 变成 div —— 依据框塌成默认宽度、聊天输入框与发送按钮错高。
 * - forwardRef：一遍过撤回后需要用 ref 把焦点放回聊天输入框。
 * - onChange 回调原始 event（组件不加工），调用方写法与原生 input 完全一致。
 *
 * 样式见 index.css 末尾的 .tf-input 段落。
 *
 * @param {boolean} [multiline=false] - true 渲染 textarea
 * @param {number} [rows] - 仅 multiline 生效（textarea 行数）
 * @param {string} [className] - 追加到内层元素的 class（如 modal-textarea / mono / assess-basis）
 */
const TextField = forwardRef(function TextField({ multiline = false, rows, className = "", ...rest }, ref) {
  const cls = className ? `tf-input ${className}` : "tf-input";
  if (multiline) {
    return <textarea ref={ref} className={cls} rows={rows} {...rest} />;
  }
  return <input ref={ref} className={cls} {...rest} />;
});

export default TextField;
