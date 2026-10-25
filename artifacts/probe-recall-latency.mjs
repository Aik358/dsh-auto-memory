
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { decodeZstdFramesHead } from '../lib/subagent-gc.js';

const root = path.join(os.homedir(), '.dsh', 'sessions');
const SCAN_CAP = 80, RAW_SKIP_BYTES = 16 * 1024 * 1024, DECODE_MAX_FRAMES = 160, DECODE_MAX_BYTES = 4 * 1024 * 1024;

// ---- enumerate exactly like lexicalSessionScanFallback ----
const t0 = performance.now();
const files = [];
let dirNamesFail = 0;
for (const ws of fs.readdirSync(root, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsPath = path.join(root, ws.name);
  let sids = []; try { sids = fs.readdirSync(wsPath, { withFileTypes: true }); } catch { dirNamesFail++; continue; }
  for (const sid of sids) {
    if (!sid.isDirectory()) continue;
    const dir = path.join(wsPath, sid.name);
    let dirNames = []; try { dirNames = fs.readdirSync(dir); } catch {}
    const shaped = dirNames.filter((n) => /^session(?:[.-].*)?\.jsonl(\.zstd)?$/i.test(n) && !/backup|corrupt/i.test(n));
    const nameList = shaped.length ? shaped : ['session.v3.jsonl.zstd', 'session.jsonl.zstd'];
    let selected = null;
    for (const name of nameList) {
      const file = path.join(dir, name);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      const ver = Number((/session\.v(\d+)\./i.exec(name) || [])[1] || 0);
      if (!selected || st.mtimeMs > selected.mt || (st.mtimeMs === selected.mt && ver > selected.ver)) selected = { file, mt: st.mtimeMs, size: st.size, ver };
    }
    if (selected) files.push(selected);
  }
}
files.sort((a, b) => b.mt - a.mt);
const tEnum = performance.now() - t0;
console.log(JSON.stringify({ phase: 'enumerate', ms: Math.round(tEnum), files: files.length, totalMB: +(files.reduce((a,b)=>a+b.size,0)/1048576).toFixed(1), dirNamesFail }));

// ---- run the scan exactly as the fallback does ----
const q = 'v4 事件';
const terms = q.toLowerCase().split(/[\s,，、;；。:：]+/).filter((t) => t.length >= 2).slice(0, 8);
let attempted = 0, scanned = 0, oversized = 0, unreadable = 0, headLimited = 0, failedFrames = 0, bytesRead = 0;
const hits = [];
const tScan = performance.now();
const perFile = [];
for (const f of files) {
  if (attempted >= SCAN_CAP || hits.length >= Math.max(8, 8) * 3) break;
  attempted++;
  if (f.size > RAW_SKIP_BYTES) { oversized++; continue; }
  let text = '';
  const s0 = performance.now();
  try {
    const buf = fs.readFileSync(f.file);
    bytesRead += buf.length;
    if (buf.length > RAW_SKIP_BYTES) { oversized++; continue; }
    const observation = {};
    text = decodeZstdFramesHead(buf, DECODE_MAX_FRAMES, DECODE_MAX_BYTES, observation);
    if (observation.limited) headLimited++;
    if (observation.failedFrames) failedFrames++;
    if (!text) continue;
  } catch (e) { unreadable++; continue; }
  scanned++;
  let score = 0, snippetSrc = '';
  const lines = text.split('\n');
  for (const t of terms) { for (const ln of lines) { if (ln.toLowerCase().indexOf(t) < 0) continue; score += 1; if (!snippetSrc) snippetSrc = ln; break; } }
  if (score && snippetSrc) hits.push({ mt: f.mt, score });
  perFile.push({ mb: +(f.size/1048576).toFixed(1), ms: Math.round(performance.now()-s0), score });
}
const msScan = performance.now() - tScan;
console.log(JSON.stringify({ phase: 'scan', ms: Math.round(msScan), attempted, scanned, oversized, unreadable, headLimited, failedFrames, bytesReadMB: +(bytesRead/1048576).toFixed(1), hits: hits.length }));
console.log('slowest files:', JSON.stringify(perFile.sort((a,b)=>b.ms-a.ms).slice(0,8)));
console.log('sumPerFileMs:', perFile.reduce((a,b)=>a+b.ms,0));
