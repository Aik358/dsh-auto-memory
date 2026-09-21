import { readFileSync, writeFileSync } from 'node:fs';

/* 去掉 data-en 元素内部的行内强调标签（语言切换用 textContent，会把它们一起抹平）
   保留 .evidence 里作为标签的 <b data-en="VERIFY"> 这类「本身就有 data-en 的」元素。
   用法: node tools/strip-nested-em.mjs site/index.html */

const file = process.argv[2];
let h = readFileSync(file, 'utf8');
const before = (h.match(/<b\b/g) || []).length;

// 匹配：包含 data-en 的开标签 → 任意文本 → <b>…</b>  （<b 后面必须紧跟 '>'，排除 <b data-en=…>）
let n = 0;
h = h.replace(/(<[a-z][\w-]*\b[^>]*\sdata-en="[^"]*">)([^<]*?)<b>([^<]*?)<\/b>/g, (_m, head, pre, mid) => {
  n++;
  return head + pre + mid;
});

writeFileSync(file, h);
console.log(`移除 data-en 内嵌 <b>: ${n} 处；文件内 <b> 计数 ${before} → ${(h.match(/<b\b/g) || []).length}`);
