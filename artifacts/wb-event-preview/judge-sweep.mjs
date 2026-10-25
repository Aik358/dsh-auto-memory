#!/usr/bin/env node
/**
 * judge-sweep.mjs — 对照组实验：把「机械判据」的簇数扫一遍，供 VERIFY.md 引用。
 *
 * 这不是生成产物用的判据（本版采用人判语义聚类），而是为了回答：
 * 「如果按机械阈值聚类，会得到多少个事件？」——全部实跑，不引用二手数字。
 *
 * 三组实验：
 *   A. 目标段字符 2-gram Jaccard + 单链聚类（任务卡里的旧基线）
 *   B. TF-IDF（目标 4/状态 2/失败 1/下一步 1）+ 增量聚类（按 mtime 顺序，24h 窗口）
 *   C. 纯时间分段（相邻账本间隔 > G 小时即切）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocuments, bulletLines, cleanText, termSet, jaccard, termCounts } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function ledgerDocs() {
  return loadDocuments().filter(d => d.kind === 'ledger');
}

/* ---------- A. 目标段 2-gram Jaccard 单链 ---------- */
function sweepNgram(ledgers, thresholds) {
  const vecs = ledgers.map(d => termSet(cleanText(bulletLines(d.sections.goal).join(' '))));
  return thresholds.map(T => {
    const parent = vecs.map((_, i) => i);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a === b) return; if (a < b) parent[b] = a; else parent[a] = b; };
    for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) if (jaccard(vecs[i], vecs[j]) >= T) uni(i, j);
    const g = new Map();
    for (let i = 0; i < vecs.length; i++) { const r = find(i); g.set(r, (g.get(r) || 0) + 1); }
    const sizes = [...g.values()];
    return { T, clusters: sizes.length, singles: sizes.filter(x => x === 1).length, singlePct: +(100 * sizes.filter(x => x === 1).length / sizes.length).toFixed(1), max: Math.max(...sizes) };
  });
}

/* ---------- B. TF-IDF 增量聚类 ---------- */
function sweepTfidf(ledgers, thresholds, windowH) {
  const docs = ledgers.map(d => {
    const m = new Map();
    const add = (t, w) => { for (const [k, v] of termCounts(t)) m.set(k, (m.get(k) || 0) + v * w); };
    add(cleanText(bulletLines(d.sections.goal).join(' ')), 4);
    add(cleanText(bulletLines(d.sections.state).join(' ')), 2);
    add(cleanText(bulletLines(d.sections.dead).join(' ')), 1);
    add(cleanText(bulletLines(d.sections.next).join(' ')), 1);
    return m;
  });
  const N = docs.length;
  const df = new Map();
  for (const m of docs) for (const k of m.keys()) df.set(k, (df.get(k) || 0) + 1);
  const idf = new Map();
  for (const [k, v] of df) idf.set(k, Math.log(N / (1 + v)) + 1);
  const V = docs.map(m => { const o = new Map(); for (const [k, v] of m) o.set(k, (1 + Math.log(v)) * idf.get(k)); return o; });
  const nrm = V.map(v => { let n = 0; for (const x of v.values()) n += x * x; return Math.sqrt(n) || 1; });
  const cos = (a, b) => { let s = 0; const [x, y] = V[a].size < V[b].size ? [V[a], V[b]] : [V[b], V[a]]; for (const [k, v] of x) { const z = y.get(k); if (z) s += v * z; } return s / (nrm[a] * nrm[b]); };
  return thresholds.map(T => {
    const evs = [];
    for (let i = 0; i < N; i++) {
      let best = -1, bestS = 0;
      for (let e = 0; e < evs.length; e++) {
        if ((ledgers[i].mtime - evs[e].lastMtime) / 3600000 > windowH) continue;
        const s = cos(i, evs[e].repr);
        if (s > bestS) { bestS = s; best = e; }
      }
      if (best >= 0 && bestS >= T) { evs[best].n++; evs[best].lastMtime = ledgers[i].mtime; }
      else evs.push({ n: 1, lastMtime: ledgers[i].mtime, repr: i });
    }
    const sizes = evs.map(e => e.n);
    return { T, clusters: sizes.length, singles: sizes.filter(x => x === 1).length, singlePct: +(100 * sizes.filter(x => x === 1).length / sizes.length).toFixed(1), max: Math.max(...sizes) };
  });
}

/* ---------- C. 纯时间分段 ---------- */
function sweepGap(ledgers, gapsH) {
  return gapsH.map(G => {
    let evs = 1;
    for (let i = 1; i < ledgers.length; i++) if ((ledgers[i].mtime - ledgers[i - 1].mtime) / 3600000 > G) evs++;
    return { G, clusters: evs };
  });
}

export function sweep() {
  const L = ledgerDocs();
  return {
    n: L.length,
    ngram: sweepNgram(L, [0.30, 0.40, 0.50, 0.60]),
    tfidf: sweepTfidf(L, [0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60], 24),
    gap: sweepGap(L, [1, 2, 4, 6, 12, 24])
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = sweep();
  console.log('账本数 n =', r.n);
  console.log('');
  console.log('A. 目标段字符 2-gram Jaccard + 单链聚类');
  for (const x of r.ngram) console.log('   T=' + x.T.toFixed(2) + '  簇 ' + x.clusters + '  单篇 ' + x.singlePct + '%  最大簇 ' + x.max);
  console.log('');
  console.log('B. TF-IDF 加权 + 增量聚类（24h 窗口）');
  for (const x of r.tfidf) console.log('   T=' + x.T.toFixed(2) + '  簇 ' + x.clusters + '  单篇 ' + x.singlePct + '%  最大簇 ' + x.max);
  console.log('');
  console.log('C. 纯时间分段（相邻间隔 > G 小时即切）');
  for (const x of r.gap) console.log('   G=' + x.G + 'h  事件 ' + x.clusters);
}
