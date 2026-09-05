// markdown.js — 轻量 Markdown 渲染器（基础版，移植自 anticraft/index src/utils/markdown.js）
// 支持：标题、段落、强调/删除线、行内代码、代码块、链接、引用、有序/无序列表、分隔线。
// 与 ../index 相同的防线：先整体转义 HTML 再解析，链接 URL 白名单，防 XSS。

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 链接 URL 白名单：仅 http(s)/协议相对/mailto/锚点/站内路径，拒绝 javascript: 等协议
function sanitizeUrl(url) {
  const u = (url || "").trim();
  if (/^(https?:)?\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  if (/^#/.test(u) || /^\//.test(u)) return u;
  return null;
}

function renderInline(text) {
  let s = text;
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, text, url, title) => {
    const u = sanitizeUrl(url);
    if (!u) return text;
    const t = title ? ` title="${title}"` : "";
    return `<a href="${u}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`;
  });
  // 粗体 **text** / __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // 斜体 *text* / _text_
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, "$1<em>$2</em>");
  // 删除线 ~~text~~
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s;
}

function renderCodeBlock(lang, code) {
  const l = String(lang || "").trim().toLowerCase();
  let body = code;
  if (l === "json") {
    try {
      body = JSON.stringify(JSON.parse(code), null, 2);
    } catch {
      /* 非 JSON 内容保持原样 */
    }
  }
  const attr = l ? ` data-lang="${escapeHtml(l)}"` : "";
  return `<div class="md-code-block"><pre class="lang-${escapeHtml(l)}"${attr}><code>${escapeHtml(body)}</code></pre></div>`;
}

export function renderMd(text) {
  if (!text) return "";

  // 预提取代码块与行内代码为占位符，防止其内容被当作 Markdown 语法
  const codeBlocks = [];
  const codeStash = [];
  text = String(text).replace(/```[\s\S]*?```/g, (m) => {
    const lang = m.match(/^```(\w*)/)?.[1] || "";
    const body = m.replace(/^```\w*\s*\n?/, "").replace(/\n?```$/, "");
    codeBlocks.push(renderCodeBlock(lang, body));
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeStash.push(escapeHtml(code));
    return `\u0000CODE${codeStash.length - 1}\u0000`;
  });

  // 转义 HTML（XSS 防线：所有标签字面量在此失效）
  let src = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r\n?/g, "\n");

  const lines = src.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块占位行
    const cbMatch = line.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
    if (cbMatch) {
      out.push(codeBlocks[Number(cbMatch[1])]);
      i++;
      continue;
    }

    // 未闭合代码块兜底
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      codeBlocks.push(renderCodeBlock(fence[1] || "", buf.join("\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")));
      out.push(`\u0000BLOCK${codeBlocks.length - 1}\u0000`);
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // 标题 # ~ ######
    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) {
      const level = header[1].length;
      out.push(`<h${level}>${renderInline(header[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 引用 > ...
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMd(buf.join("\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))}</blockquote>`);
      continue;
    }

    // 无序列表（含简单一层嵌套）
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        buf.push({ indent: m[1].length, content: m[2] });
        i++;
      }
      const buildList = (items, start, baseIndent) => {
        const lis = [];
        let j = start;
        while (j < items.length && items[j].indent >= baseIndent) {
          if (items[j].indent === baseIndent) {
            let content = renderInline(items[j].content);
            if (j + 1 < items.length && items[j + 1].indent > baseIndent) {
              const sub = buildList(items, j + 1, items[j + 1].indent);
              content += sub.html;
              j = sub.end;
            }
            lis.push(`<li>${content}</li>`);
            j++;
          } else {
            j++;
          }
        }
        return { html: `<ul>${lis.join("")}</ul>`, end: j };
      };
      if (buf.length > 0) out.push(buildList(buf, 0, buf[0].indent).html);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)(\d+)\.\s+(.*)$/);
        buf.push({ indent: m[1].length, content: m[3] });
        i++;
      }
      if (buf.length > 0) {
        out.push(`<ol>${buf.map((it) => `<li>${renderInline(it.content)}</li>`).join("")}</ol>`);
      }
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 普通段落（合并连续非块行）
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }

  let html = out.join("\n");
  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)] ?? "");
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)] ?? "");
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => {
    const c = codeStash[Number(idx)];
    return c === undefined ? "" : `<code>${c}</code>`;
  });
  return html;
}
