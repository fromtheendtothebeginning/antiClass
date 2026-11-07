import Pinyin from "tiny-pinyin";

// 拼音搜索：把汉字串编译成每字 [全拼, 首字母] 段，查询串按序逐字消费（全拼或首字母均可），
// 支持 wang→王梓高、wzg→王梓高、zigao→王梓高（从姓名任意汉字起拼）。
// 匹配必须从某个汉字的拼音段开始：纯学号/字母数字串无法被误配成子序列，sid 语义不受影响。
const segsCache = new Map(); // 文本 → 每字拼音段数组（非汉字为 null，不能参与拼音匹配）

function segsOf(text) {
  let segs = segsCache.get(text);
  if (!segs) {
    segs = text.split("").map((c) => {
      // 只把 CJK 汉字当拼音段：tiny-pinyin 对 ASCII 也返回「支持」（原字符），
      // 不设码位限制的话纯数字学号会被当成可匹配段、子序列误配（"14" 搜到 1234）
      if (c < "\u3400" || c > "\u9fff" || !Pinyin.isSupported(c.charCodeAt(0))) return null;
      const full = Pinyin.convertToPinyin(c, "", true);
      return [full, full[0]];
    });
    segsCache.set(text, segs);
  }
  return segs;
}

export function pinyinMatch(text, query) {
  const q = (query || "").toLowerCase();
  if (!q) return false;
  const segs = segsOf(text || "");
  if (!segs.some(Boolean)) return false; // 全是非汉字（学号等），字面匹配已覆盖
  const memo = new Map();
  const dfs = (i, j) => {
    if (j === q.length) return true;
    if (i >= segs.length) return false;
    const key = i * (q.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    const s = segs[i];
    if (s) {
      for (const seg of s) {
        if (q.startsWith(seg, j) && dfs(i + 1, j + seg.length)) {
          ok = true;
          break;
        }
      }
      // 允许跳过该汉字（微信式模糊搜索：yuh 也能命中「俞玺皓阳」的 俞+皓）
      if (!ok && dfs(i + 1, j)) ok = true;
    }
    memo.set(key, ok);
    return ok;
  };
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] && dfs(i, 0)) return true;
  }
  return false;
}
