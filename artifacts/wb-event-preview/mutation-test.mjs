#!/usr/bin/env node
/**
 * mutation-test.mjs — 变异反向验证（负路径的负路径）
 *
 * 判据纪律：一条断言若「删掉/破坏被检对象后仍然全绿」，它就不是验收，只是装饰。
 * 本脚本对三条关键保证做真变异，断言 verify.mjs 必须变红，然后恢复并断言重新变绿。
 *
 * 变异层在 **build.mjs**（数据真正生成的地方），不是 events.json —— 因为 verify 自己会重跑
 * build，改 events.json 会被 build 覆盖回正确值，那样测出来的是 build 的幂等性，不是负路径。
 *
 * 用法：node mutation-test.mjs   （内部用 SKIP_BROWSER=1 跑 verify，最后再做一次含浏览器的完整全绿校验）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build.mjs');
const FX = path.join(HERE, 'fixtures', 'concurrent-demo.json');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function runBuild() {
  try { execFileSync(process.execPath, [BUILD], { cwd: HERE, stdio: 'pipe' }); return { ok: true }; }
  catch (e) { return { ok: false, err: String((e.stderr && e.stderr.toString()) || e.message).slice(0, 200) }; }
}

/**
 * verify.mjs 先读 events.json、再重建 —— 所以「改 build.mjs」必须先跑一次 build 让产物跟上，
 * 否则 verify 读到的是上一轮的旧产物（实测会串成 off-by-one：第 2 次变异报出第 1 次的失败项）。
 */
function runVerify(skipBrowser = true) {
  const env = { ...process.env };
  if (skipBrowser) env.SKIP_BROWSER = '1'; else delete env.SKIP_BROWSER;
  try {
    const out = execFileSync(process.execPath, [path.join(HERE, 'verify.mjs')], { cwd: HERE, stdio: 'pipe', env }).toString();
    return { code: 0, fails: [] };
  } catch (e) {
    const out = String((e.stdout && e.stdout.toString()) || '');
    return { code: e.status == null ? 1 : e.status, fails: out.split('\n').filter(l => l.startsWith('FAIL ')) };
  }
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: String(detail == null ? '' : detail) });

// 先重建一次，确保产物与「未变异的 build.mjs」一致（否则 verify 的幂等断言会拿旧产物比新产物）
execFileSync(process.execPath, [BUILD], { cwd: HERE, stdio: 'pipe' });
const buildSrc = fs.readFileSync(BUILD, 'utf8');
const buildSha = sha(buildSrc);
const fxBuf = fs.readFileSync(FX);
const fxSha = sha(fxBuf);

const mutations = [
  {
    name: '把合成 demo 事件混进真实时间轴',
    from: 'const timeline = sortEvents(events.concat(buckets).concat(unplanned ? [unplanned] : []));',
    to: "const _mut = { id: 'demo-alpha', ordinal: 999, kind: 'ledger', title: '【合成】Alpha · 事件容器落地', summary: 'mutation', rationale: 'mutation', confidence: 'low', status: 'active', date: '2026-10-05', start: '2026-10-05 10:00', end: '2026-10-05 10:00', startMs: 1759629600000, endMs: 1759629600000, members: [], checkpoints: [], outcomes: [], skills: { hitCount: 0, names: [], touched: false }, userPercept: [], agentTrace: [], sharedGround: [], commitments: [], sourceCount: 0 };\n  const timeline = sortEvents(events.concat(buckets).concat(unplanned ? [unplanned] : []).concat([_mut]));",
    expect: '0 个 demo id'
  },
  {
    name: '静默关掉「计划外账本」兜底（计划外账本被无声丢弃）',
    from: 'export function unplannedBucket(docs, plan) {',
    to: 'export function unplannedBucket(docs, plan) {\n  if (docs && plan) return null; // mutation: 兜底被静默关闭',
    expect: '计划外账本兜底'
  }
];

try {
  for (const m of mutations) {
    if (!buildSrc.includes(m.from)) { check('变异「' + m.name + '」锚点存在', false, 'build.mjs 里找不到锚点'); continue; }
    fs.writeFileSync(BUILD, buildSrc.replace(m.from, m.to));
    const rb = runBuild();
    if (!rb.ok) {
      check('变异「' + m.name + '」→ verify 必红，且失败项命中「' + m.expect + '」', true, 'build 自身已拒绝该变异: ' + rb.err);
      fs.writeFileSync(BUILD, buildSrc);
      runBuild();
      continue;
    }
    const r = runVerify();
    const hit = r.fails.some(f => f.includes(m.expect));
    check('变异「' + m.name + '」→ verify 必红，且失败项命中「' + m.expect + '」', r.code !== 0 && hit,
      'exit=' + r.code + ' | hits=' + r.fails.length + ' :: ' + (r.fails.slice(0, 3).join(' ; ') || '(no FAIL line)').slice(0, 200));
    fs.writeFileSync(BUILD, buildSrc);
    runBuild();
  }

  /* ---- 变异 3：删掉 fixture 文件 ---- */
  fs.rmSync(FX);
  const r3 = runVerify();
  const hit3 = r3.fails.some(f => f.includes('合成 fixture 存在'));
  check('变异「删掉 fixtures/concurrent-demo.json」→ verify 必红，命中 fixture 存在性', r3.code !== 0 && hit3,
    'exit=' + r3.code + ' | ' + (r3.fails.slice(0, 2).join(' ; ') || '(no FAIL line)').slice(0, 160));
} finally {
  // fail-closed：任何一步抛错都要把被变异的两份文件还原，并重建一次产物
  fs.writeFileSync(BUILD, buildSrc);
  fs.mkdirSync(path.dirname(FX), { recursive: true });
  fs.writeFileSync(FX, fxBuf);
  try { execFileSync(process.execPath, [BUILD], { cwd: HERE, stdio: 'pipe' }); } catch (e) {}
}

/* ---- 还原后必须重新全绿（这次含真浏览器 32 项） ---- */
const m0 = runVerify(false);
check('还原后 verify 重新全绿（含真浏览器断言）', m0.code === 0, 'exit=' + m0.code + (m0.fails.length ? ' | ' + m0.fails[0].slice(0, 100) : ''));
check('变异来回后 build.mjs sha256 与变异前一致', sha(fs.readFileSync(BUILD)) === buildSha, sha(fs.readFileSync(BUILD)).slice(0, 16));
check('变异来回后 fixtures/concurrent-demo.json sha256 与变异前一致', sha(fs.readFileSync(FX)) === fxSha, sha(fs.readFileSync(FX)).slice(0, 16));

const pass = results.filter(r => r.ok).length;
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  =>  ' + r.detail);
console.log('');
console.log('TOTAL ' + results.length + '  PASS ' + pass + '  FAIL ' + (results.length - pass));
process.exit(pass === results.length ? 0 : 1);