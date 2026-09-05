// codeFenceKeys.js — 编辑器内嵌代码块的智能按键（移植自 anticraft/index）
// 仅在 Markdown 围栏代码块（``` 内）生效：
//  - Enter 自动缩进（继承当前行缩进；花括号语言行尾 `{` 额外 +1 级）
//  - Tab 插入 4 空格缩进（多行选区则整块右移）
//  - Backspace 按缩进单元（4 空格）成块删除
//  - Ctrl/Cmd + / 切换本行（或选区行）注释
// 返回 { type: 'insert'|'replace'|'delete'|'skip', start, end, text, caret } 编辑动作，
// 由 CodeEditor 用 document.execCommand 执行以保留原生撤销栈；返回 null 表示不拦截。

export const INDENT_UNIT = "    ";

const LINE_COMMENT = {
  js: "//", jsx: "//", ts: "//", tsx: "//", javascript: "//", typescript: "//",
  java: "//", c: "//", cpp: "//", "c++": "//", cs: "//", "c#": "//", go: "//",
  rust: "//", swift: "//", kotlin: "//", php: "//", dart: "//", scala: "//",
  python: "#", py: "#", bash: "#", sh: "#", shell: "#", zsh: "#", ruby: "#",
  yaml: "#", yml: "#", perl: "#", ini: "#", toml: "#", dockerfile: "#",
  sql: "--", mysql: "--", postgresql: "--",
  css: "/* */", scss: "/* */", less: "/* */",
  html: "<!-- -->", xml: "<!-- -->", vue: "<!-- -->", svg: "<!-- -->",
  markdown: "<!-- -->", md: "<!-- -->",
};
const DEFAULT_COMMENT = "//";
const BRACE_LANGS = new Set([
  "js", "jsx", "ts", "tsx", "javascript", "typescript", "java", "c", "cpp", "c++",
  "cs", "c#", "go", "rust", "swift", "kotlin", "php", "dart", "scala", "css", "scss", "less",
]);

function getLineInfo(text, pos) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  let end = text.indexOf("\n", pos);
  if (end === -1) end = text.length;
  return { start, end, content: text.slice(start, end) };
}

function leadingWs(s) {
  const m = s.match(/^[ \t]*/);
  return m ? m[0] : "";
}

export function isFenceLine(line) {
  return /^```/.test(line.trim());
}

export function isInCodeFence(text, pos) {
  const before = text.slice(0, pos);
  const lines = before.split("\n");
  let fences = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isFenceLine(lines[i])) fences++;
  }
  return fences % 2 === 1;
}

export function getFenceLang(text, pos) {
  const before = text.slice(0, pos);
  const lines = before.split("\n");
  let lang = "";
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].trim().match(/^```(\S*)/);
    if (m) {
      if (!lang) lang = m[1] || "";
      else lang = "";
    }
  }
  return lang;
}

function commentFor(lang) {
  const l = (lang || "").trim().toLowerCase();
  return LINE_COMMENT[l] || DEFAULT_COMMENT;
}

function computeEnter(text, selStart, selEnd, lang) {
  const { content } = getLineInfo(text, selStart);
  let indent = leadingWs(content);
  const langL = (lang || "").toLowerCase();
  const trimmed = content.trimEnd();
  if (BRACE_LANGS.has(langL) && trimmed.endsWith("{")) {
    indent += INDENT_UNIT;
  }
  void selEnd;
  return { type: "insert", text: "\n" + indent };
}

function computeTab(text, selStart, selEnd) {
  const lineStart = getLineInfo(text, selStart).start;
  const lineEnd = getLineInfo(text, selEnd).end;
  if (selStart === selEnd) {
    return { type: "insert", text: INDENT_UNIT };
  }
  const block = text.slice(lineStart, lineEnd);
  const indented = block
    .split("\n")
    .map((l) => (l.trim() === "" ? l : INDENT_UNIT + l))
    .join("\n");
  return { type: "replace", start: lineStart, end: lineEnd, text: indented };
}

function computeBackspace(text, selStart, selEnd) {
  if (selStart !== selEnd) return null;
  const pos = selStart;
  const before = text.slice(0, pos);
  if (before.endsWith(INDENT_UNIT)) {
    return { type: "replace", start: pos - INDENT_UNIT.length, end: pos, text: "" };
  }
  return null;
}

function toggleLine(line, marker) {
  if (marker.includes(" ")) {
    const [open, close] = marker.split(" ");
    const m = line.trim().match(new RegExp(`^${open}(.*)${close}$`));
    if (m) {
      const inner = m[1].replace(/^\s+|\s+$/g, "");
      return leadingWs(line) + inner;
    }
    return leadingWs(line) + open + " " + line.trim() + " " + close;
  }
  const trimmed = line.trim();
  if (trimmed.startsWith(marker)) {
    return leadingWs(line) + trimmed.slice(marker.length).replace(/^ /, "");
  }
  return leadingWs(line) + marker + " " + trimmed;
}

function computeCommentToggle(text, selStart, selEnd, lang) {
  const marker = commentFor(lang);
  const first = getLineInfo(text, selStart).start;
  const last = getLineInfo(text, selEnd).end;
  const block = text.slice(first, last);
  const toggled = block.split("\n").map((l) => toggleLine(l, marker)).join("\n");
  return { type: "replace", start: first, end: last, text: toggled };
}

const BRACKET_PAIRS = {
  "(": ")", "[": "]", "{": "}",
  '"': '"', "'": "'",
};
const CLOSE_TO_OPEN = {
  ")": "(", "]": "[", "}": "{",
  '"': '"', "'": "'",
};

export function computeBracketPair(text, selStart, selEnd, inputChar) {
  const close = BRACKET_PAIRS[inputChar];
  if (close === undefined && CLOSE_TO_OPEN[inputChar] !== undefined) {
    if (selStart !== selEnd) return null;
    if (text[selStart] === inputChar) {
      return { type: "skip", caret: selStart + 1 };
    }
    return null;
  }
  if (!close) return null;
  if (selStart !== selEnd) {
    const selected = text.slice(selStart, selEnd);
    const result = inputChar + selected + close;
    return { type: "replace", start: selStart, end: selEnd, text: result, caret: selStart + inputChar.length + selected.length };
  }
  const nextChar = text[selStart];
  if (nextChar === close) {
    return { type: "skip", caret: selStart + 1 };
  }
  return { type: "insert", text: inputChar + close, caret: selStart + 1 };
}

export function handleCodeFenceKey(e, text) {
  const pos = e.target.selectionStart ?? 0;
  const end = e.target.selectionEnd ?? pos;
  if (!isInCodeFence(text, pos)) return null;
  const lang = getFenceLang(text, pos);

  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    return computeEnter(text, pos, end, lang);
  }
  if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    return computeTab(text, pos, end);
  }
  if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const r = computeBackspace(text, pos, end);
    if (r) {
      e.preventDefault();
      return r;
    }
    return null;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
    e.preventDefault();
    return computeCommentToggle(text, pos, end, lang);
  }
  return null;
}
