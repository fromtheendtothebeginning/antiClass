// codeEditorUi.js — CodeEditor 的纯函数 UI 辅助（移植自 anticraft/index，highlight.js 依赖
// 替换为内置轻量 tokenizer，覆盖 json/js 等提示词常用语言）

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 计算 textarea 内光标的像素坐标（供悬浮菜单等使用）
let mirror = null;
export function getCaretCoordinates(ta, pos, container) {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.pointerEvents = "none";
    mirror.style.overflow = "hidden";
    mirror.style.textAlign = "left";
    container.appendChild(mirror);
  }
  const cs = getComputedStyle(ta);
  const styles = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "boxSizing", "textTransform", "wordSpacing", "tabSize",
  ];
  for (const s of styles) mirror.style[s] = cs[s];
  mirror.style.width = cs.width;
  mirror.style.height = "auto";
  const text = ta.value.slice(0, pos);
  const marker = "\u200b";
  mirror.textContent = text;
  const span = document.createElement("span");
  span.textContent = marker;
  mirror.appendChild(span);
  const rect = span.getBoundingClientRect();
  const lineH = parseFloat(cs.lineHeight) || parseInt(cs.fontSize, 10) * 1.7;
  return {
    top: rect.top - ta.scrollTop,
    left: rect.left - ta.scrollLeft,
    height: lineH,
  };
}

// 轻量 tokenizer：输出 hljs 兼容 class（hljs-string/number/attr/literal/comment），
// 颜色由 CSS 的 --hljs-* 变量控制。json 精细分词，其余语言只高亮字符串/数字/注释。
function highlightCode(code, lang) {
  const l = (lang || "").toLowerCase();
  if (l !== "json" && l !== "js" && l !== "javascript") {
    // 通用：字符串 + 数字 + # 注释
    return esc(code)
      .replace(/(&quot;|&#39;)([^&]*?)\1/g, '<span class="hljs-string">$1$2$1</span>')
      .replace(/(^|\s)(#\s[^<]*)/g, '$1<span class="hljs-comment">$2</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="hljs-number">$1</span>');
  }
  // JSON/JS：键、字符串、数字、字面量、注释
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === "\\") j++;
        j++;
      }
      const raw = code.slice(i, j + 1);
      // 紧跟冒号的字符串视为键
      let k = j + 1;
      while (k < n && /\s/.test(code[k])) k++;
      const cls = code[k] === ":" ? "hljs-attr" : "hljs-string";
      out += `<span class="${cls}">${esc(raw)}</span>`;
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch) && !/[A-Za-z_]/.test(code[i - 1] || "")) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(code[j])) {
        if ((code[j] === "+" || code[j] === "-") && !/[eE]/.test(code[j - 1] || "")) break;
        j++;
      }
      out += `<span class="hljs-number">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (/^(true|false|null|undefined)$/.test(word)) {
        out += `<span class="hljs-literal">${word}</span>`;
      } else {
        out += esc(word);
      }
      i = j;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      let j = code.indexOf("\n", i);
      if (j === -1) j = n;
      out += `<span class="hljs-comment">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out;
}

// Markdown 源码 → "代码块高亮 + 其余普通文本"的 HTML。
// 与 textarea 逐行像素级对齐——高亮层只改颜色，绝不改变行结构。
export function renderSourceHighlight(src) {
  const lines = src.split("\n");
  const outRows = [];
  let i = 0;
  let inFence = false;
  let fenceLang = "";
  const buf = [];

  const flushCode = () => {
    if (buf.length === 0) return;
    const code = buf.join("\n");
    let html;
    try {
      html = highlightCode(code, fenceLang);
    } catch {
      html = esc(code);
    }
    const hlRows = html.split("\n");
    for (let r = 0; r < buf.length; r++) {
      outRows.push(`<span class="code-editor-fence-line${fenceLang ? " has-lang" : ""}">${hlRows[r] || ""}</span>`);
    }
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^```(\S*)\s*$/);
    if (fenceMatch) {
      if (!inFence) {
        outRows.push(`<span>${esc(line)}</span>`);
        inFence = true;
        fenceLang = fenceMatch[1] || "";
        i++;
        continue;
      }
      flushCode();
      inFence = false;
      fenceLang = "";
      outRows.push(`<span>${esc(line)}</span>`);
      i++;
      continue;
    }
    if (inFence) {
      buf.push(line);
    } else {
      outRows.push(`<span>${esc(line)}</span>`);
    }
    i++;
  }
  flushCode();
  return outRows.join("\n");
}
