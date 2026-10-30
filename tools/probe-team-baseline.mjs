#!/usr/bin/env node
/**
 * 团队同步服务端「基线同步可行性」零副作用探测
 *
 * 目的：在动手实现方案 A 之前，用真实请求测出两件唯一未知的事：
 *   ① 服务端是否**校验 kind 白名单**（若是，A 需服务端放行）
 *   ② 服务端是否有**请求体大小上限**（若 854 KB 被拒，A 需分片或改走 C）
 *
 * 零副作用：探测包用 __probe__ 前缀，不写任何真实记忆数据。
 * 跑法：node tools/probe-team-baseline.mjs
 *      或 node tools/probe-team-baseline.mjs --url https://xxx --token yyy
 *
 * 输出：三种结论之一 —— A_OK / A_NEEDS_SPLIT / A_BLOCKED_BY_SERVER
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.dsh', 'dsh-auto-memory.json'),
];
if (process.env.APPDATA) CONFIG_CANDIDATES.push(path.join(process.env.APPDATA, 'dsh', 'dsh-auto-memory.json'));

function loadCfg() {
  for (const p of CONFIG_CANDIDATES) {
    try { if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) } catch { /* keep trying */ }
  }
  return {};
}

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const cfg = loadCfg();
const baseUrl = flag('url', cfg.teamServerUrl || '');
const token = flag('token', cfg.teamSecretAccessKey || '');
const teamId = flag('team', cfg.teamId || 'probe');

if (!baseUrl) {
  console.error('✗ 未配置 teamServerUrl（配置项为空，命令行也没给 --url）');
  console.error('  团队同步没启用的话，本探测无意义 —— 先确认团队已开启。');
  process.exit(2);
}

const pushPath = cfg.teamPushPath || 'api/team/sync/push';
const url = baseUrl.replace(/\/+$/, '') + '/' + pushPath.replace(/^\/+/, '');
const headers = { 'content-type': 'application/json' };
if (token) headers.authorization = 'Bearer ' + token;

async function post(label, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    return {
      label,
      status: res.status,
      ms: Date.now() - started,
      ok: parsed ? parsed.ok === true : false,
      reason: parsed ? (parsed.reason || parsed.error || '') : String(text).slice(0, 200),
      bytesSent: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    };
  } catch (e) {
    return { label, status: 0, ms: Date.now() - started, ok: false, reason: 'network: ' + String((e && e.message) || e), bytesSent: Buffer.byteLength(JSON.stringify(body), 'utf8') };
  } finally {
    clearTimeout(timer);
  }
}

const stamp = Date.now();

// ── 探测 ①：未知 kind 是否被拒
const probe1 = await post('unknown-kind', {
  kind: '__probe__',
  key: '__probe__:' + stamp,
  idemKey: '__probe__:' + stamp,
  at: stamp,
  payload: { v: 0, note: 'baseline feasibility probe, safe to delete' },
  member: { id: 'probe', role: 'probe' },
});

// ── 探测 ②：体积上限（padding 到约 900 KB）
const PAD = 'x'.repeat(900 * 1024);
const probe2 = await post('payload-900kb', {
  kind: '__probe__',
  key: '__probe_pad__:' + stamp,
  idemKey: '__probe_pad__:' + stamp,
  at: stamp,
  payload: { v: 0, pad: PAD },
  member: { id: 'probe', role: 'probe' },
});

const R = { url, probe1, probe2 };
console.log(JSON.stringify(R, null, 2));

// ── 结论
let verdict;
if (probe1.ok && probe2.ok) verdict = 'A_OK';
else if (probe1.ok && !probe2.ok) verdict = 'A_NEEDS_SPLIT';
else verdict = 'A_BLOCKED_BY_SERVER';

console.log('\n=== 结论: ' + verdict + ' ===');
if (verdict === 'A_OK') {
  console.log('服务端 kind-agnostic 且吃得住 900 KB ⇒ 方案 A 纯客户端可行，约 150 行。');
} else if (verdict === 'A_NEEDS_SPLIT') {
  console.log('kind 通过但体积被拒 ⇒ 基线需分片（key=baseline:current#<i>/<n>），约 220 行。');
  console.log('体积探测详情: status=' + probe2.status + ' reason=' + probe2.reason);
} else {
  console.log('未知 kind 被拒 ⇒ 方案 A 不可行，需服务端放行，或改走方案 C（对象存储）。');
  console.log('kind 探测详情: status=' + probe1.status + ' reason=' + probe1.reason);
}
console.log('\n★ 探测包 key 均带 __probe__ 前缀，可安全从服务端删除。');
process.exit(verdict === 'A_OK' ? 0 : 1);
