import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SK = '.dsh/skills/transitions-motion/references';
const cat = JSON.parse(readFileSync(join(SK, 'catalog.json'), 'utf-8'));

console.log(`共 ${cat.length} 个动画\n`);
console.log('slug'.padEnd(34) + 'pro  ' + 'when（用途，截断）');
console.log('-'.repeat(110));
for (const it of cat) {
  const when = String(it.when || '').replace(/\s+/g, ' ').slice(0, 62);
  console.log((it.slug || '').padEnd(34) + (it.pro ? ' ★ ' : '   ') + when);
}

/* 首页真正需要的几个（按 skill §3 速查表 + 官方决策规则匹配，不臆造） */
const PICK = [
  'texts-reveal',                    // 首屏文案带节奏进场（hero 标题+副标题）
  'skeleton-loader-and-reveal',      // 占位 → 真内容
  'notification-badge',              // 角标/计数
  'tabs-sliding',                    // 互斥选项滑动指示器
  'accordion',                       // 可折叠主体
  'icon-swap',                       // 同槽位图标切换
  'success-check',                   // 确认/完成时刻
  'error-state-shake',               // 校验失败
  'toast-open-close',                // Toast
  'modal-open-close',                // 弹窗
  'tooltip-open-close',              // 提示气泡
  'panel-reveal',                    // 侧栏/抽屉
  'spinner-check-morph',             // 加载 → 打勾（Pro）
  'matrix-dot-loader',               // 矩阵点加载器
  'thinking-states',                 // AI 思考状态
  'reasoning-stream',                // 推理流
  'streaming-text',                  // 流式文字
];

mkdirSync('artifacts/_transitions', { recursive: true });
const bundle = {};
let ok = 0, miss = [];
for (const slug of PICK) {
  try {
    const p = join(SK, 'items', slug + '.json');
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    const code = j.code || j;
    bundle[slug] = {
      meta: cat.find(c => c.slug === slug) || null,
      css: code.css || '',
      markup: code.markup || '',
      js: code.js || '',
      react: (code.react || '').slice(0, 200),  // 只要开头，避免巨大
    };
    ok++;
    const when = (bundle[slug].meta?.when || '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`\n✓ ${slug}  css=${(code.css || '').length}B markup=${(code.markup || '').length}B js=${(code.js || '').length}B`);
    console.log(`  ${when}`);
  } catch (e) { miss.push(slug); }
}
writeFileSync('artifacts/_transitions/bundle.json', JSON.stringify(bundle, null, 2));
console.log(`\n抽出 ${ok} 个；缺失 ${miss.length} 个：${miss.join(', ') || '（无）'}`);
console.log('→ artifacts/_transitions/bundle.json');
