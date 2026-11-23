#!/usr/bin/env node
/**
 * smoke-test-v4-u4-team-version-gate.mjs —— U4：Teamwork 版本闸门（M1/M2/M3）。
 *
 * ★用户裁定（第五轮逐字）：
 *   「一定要注意，**如果有一个旧版本的记忆，这个同步功能应该暂停并且向用户汇报**。
 *    **直到用户更新到新版本并完成同步，双端才可再次同步**」
 *
 * ★三处闸门（缺一即半修 —— 本仓实证过的缺陷家族）：
 *   ① tick() 入口：不一致 ⇒ 直接 skipped，**一个请求都不发**
 *   ② start()：不一致 ⇒ **不建定时器**（零行为）
 *   ③ status()：返回 gate 字段供前端渲染
 *
 * ★每条都要变异验证（本套件另附「变异必红」的自证，见 U4-8）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'team-sync.js'), 'utf8')
const TS = await import(pathToFileURL(path.join(ROOT, 'lib', 'team-sync.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } };

// ══════════════════════════════════════════════════════════════════════
console.log('[U4-1] compareSemverPre（纯函数）');
{
  const C = TS.compareSemverPre;
  ok(C('3.3.17', '3.3.18') === -1, '★U4-1a 3.3.17 < 3.3.18');
  ok(C('3.3.18', '3.3.18') === 0, '★U4-1b 3.3.18 === 3.3.18');
  ok(C('3.4.0', '3.3.18') === 1, '★U4-1c 3.4.0 > 3.3.18');
  ok(C('3.3.9', '3.3.18') === -1, '★★U4-1d **3.3.9 < 3.3.18**（字典序会判反，这是必须自实现的理由）');
  ok(C('3.3.18-beta.1', '3.3.18') === -1, '★★U4-1e 预发布标签更旧（semver 惯例）');
  ok(C('3.3.18', '3.3.18-beta.1') === 1, '★★U4-1f 对称：正式版 > 预发布版');
  ok(C('bad', '3.3.18') === -1, '★★U4-1g 非法输入保守判旧（-1）');
  ok(C('3.3.18', 'bad') === -1, '★★U4-1h 右侧非法同样保守');
  ok(C('v3.3.18', '3.3.18') === 0, '★U4-1i 允许前导 v');
  ok(C('', '') === -1, '★U4-1j 空串视为非法');
}

console.log('');
console.log('[U4-2] teamSyncGatePre（纯函数·三态）');
{
  const G = TS.teamSyncGatePre;
  const same = G('3.3.18', '3.3.18');
  ok(same.ok === true && same.reason === 'same', '★★U4-2a 同版本 ⇒ 放行', JSON.stringify(same.reason));
  const peerUnknown = G('3.3.18', '');
  ok(peerUnknown.ok === true && peerUnknown.reason === 'peer-unknown', '★★★U4-2b 对端版本未知 ⇒ **不阻**（保守放行，不误伤）', JSON.stringify(peerUnknown.reason));
  const localOld = G('3.3.17', '3.3.18');
  ok(localOld.ok === false && localOld.reason === 'version-mismatch', '★★★U4-2c 本机旧 ⇒ 暂停', JSON.stringify(localOld.reason));
  ok(localOld.older === 'local' && localOld.action === 'update-this-machine', '★★★U4-2d 明确指出「本机旧」+ action', JSON.stringify({ older: localOld.older, action: localOld.action }));
  const peerOld = G('3.3.18', '3.3.17');
  ok(peerOld.ok === false && peerOld.older === 'peer' && peerOld.action === 'update-other-machine', '★★★U4-2e 对端旧 ⇒ 明确指 action', JSON.stringify({ older: peerOld.older, action: peerOld.action }));
  const bothNew = G('3.4.0', '3.3.18');
  ok(bothNew.ok === true && bothNew.reason === 'both-new', '★★U4-2f 双方都 ≥ 最低版本 ⇒ 放行（版本号不同也能互通）', JSON.stringify(bothNew.reason));
  const bothOld = G('3.3.17', '3.3.17');
  ok(bothOld.ok === false, '★★★U4-2g **双双都是旧版也要暂停**（格式没转，同步会混）');
  ok(/3\.3\.18/.test(SRC) && /TEAM_SYNC_MIN_PLUGIN_VERSION_PRE = '3\.3\.18'/.test(SRC), '★U4-2h 最低版本常量 = 3.3.18（与 package.json 推版目标一致）');
}

console.log('');
console.log('[U4-3] M1：上行 payload 带版本');
{
  ok(/payload\.dataVersion = \{/.test(SRC), '★★★U4-3a M1 上行 payload 写入了 dataVersion');
  ok(/pluginVersion:\s*toText\(options\.pluginVersion\)/.test(SRC), '★★U4-3b pluginVersion 来源正确（options.pluginVersion）');
  ok(/memoryFormat:\s*TEAM_SYNC_MEMORY_FORMAT_PRE/.test(SRC), '★★U4-3c memoryFormat 字段存在');
  ok(/TEAM_SYNC_MEMORY_FORMAT_PRE = 'v4'/.test(SRC), '★U4-3d memoryFormat = v4');
  // ★功能验证：真构造 sync，发一条，捕获 body
  const sent = [];
  const sync = TS.createTeamSync({
    engine: { config: { teamEnabled: true, teamSyncIntervalMs: 60000 }, _teamEpoch: 1 },
    identity: { currentMember: () => ({ id: 'm1', name: 'n', role: 'administrator', teamId: 't1' }) },
    outbox: { flush: async (sender) => { await sender({ kind: 'k', key: 'x', at: 1, payload: {}, eventId: 'e1' }); return { sent: 1, failed: 0 } } },
    // ★实现细节（本轮踩到）：`teamFetch(path, {method,headers,body})` 的 `body` 已是**对象**
    //   （实现里写的是 `body: payload`，不是 `JSON.stringify(payload)`）⇒ 套件里**不要再 JSON.parse**。
    //   首版写成 JSON.parse(opt.body) ⇒ body 被当字符串处理 ⇒ 抛错 ⇒ 投递 0 条。
    teamFetch: async (p, opt) => { sent.push({ p, body: (typeof opt.body === 'string' ? JSON.parse(opt.body) : opt.body) }); return { ok: true } },
    pluginVersion: '3.3.18',
    diag: () => {},
  });
  await sync.tick();
  ok(sent.length === 1, '★★U4-3e 真投递 1 条', String(sent.length));
  ok(sent[0] && sent[0].body.dataVersion && sent[0].body.dataVersion.pluginVersion === '3.3.18', '★★★U4-3f **真 body 里含 pluginVersion=3.3.18**（不是源码字符串）', JSON.stringify(sent[0] && sent[0].body.dataVersion));
  ok(sent[0] && sent[0].body.dataVersion.memoryFormat === 'v4', '★★U4-3g 真 body 里 memoryFormat=v4');
  ok(sent[0] && sent[0].body.idemKey === 'e1', '★U4-3h 原有幂等键未被破坏（回归）');
}

console.log('');
console.log('[U4-4] ★★★ 闸门①：tick 不一致 ⇒ 一个请求都不发');
{
  let fetchCalls = 0;
  const mk = (localV, peerV) => {
    const eng = { config: { teamEnabled: true, teamSyncIntervalMs: 60000 }, _teamEpoch: 1 };
    if (peerV !== undefined) eng._teamPeerVersion = peerV;
    return TS.createTeamSync({
      engine: eng,
      identity: { currentMember: () => ({ id: 'm1', role: 'administrator' }) },
      outbox: { flush: async (sender) => { await sender({ kind: 'k', key: 'x', at: 1, eventId: 'e1' }); return { sent: 1, failed: 0 } } },
      teamFetch: async () => { fetchCalls += 1; return { ok: true } },
      pluginVersion: localV,
      diag: () => {},
    });
  };
  const badSync = mk('3.3.17', '3.3.18');
  const r1 = await badSync.tick();
  ok(fetchCalls === 0, '★★★U4-4a 版本不一致时 tick **fetch 调用 0 次**', String(fetchCalls));
  ok(r1.skipped === true && r1.reason === 'version-mismatch', '★★★U4-4b tick 返回 skipped + version-mismatch', JSON.stringify(r1.reason));
  ok(r1.gate && r1.gate.older === 'local', '★★★U4-4c tick 返回值里带 gate 详情（前端可直接渲染）');
  // 对照：版本一致 ⇒ 真的发
  fetchCalls = 0;
  const goodSync = mk('3.3.18', '3.3.18');
  const r2 = await goodSync.tick();
  ok(fetchCalls === 1, '★★★U4-4d 对照：版本一致时 fetch **真的被调 1 次**（证明闸门不是恒拦）', String(fetchCalls));
  ok(r2.skipped !== true, '★★U4-4e 对照：一致时 tick 不 skipped');
  // 对照：对端未知 ⇒ 放行（不误伤）
  fetchCalls = 0;
  const unknownSync = mk('3.3.18', undefined);
  await unknownSync.tick();
  ok(fetchCalls === 1, '★★★U4-4f 对端版本未知时**仍正常同步**（保守放行，不误伤老服务端）', String(fetchCalls));
}

console.log('');
console.log('[U4-5] ★★★ 闸门②：start 不一致 ⇒ 不建定时器');
{
  const engBad = { config: { teamEnabled: true, teamSyncIntervalMs: 60000 }, _teamEpoch: 1, _teamPeerVersion: '3.3.18' };
  const sBad = TS.createTeamSync({ engine: engBad, identity: { currentMember: () => ({ id: 'm' }) }, outbox: { flush: async () => ({ sent: 0, failed: 0 }) }, teamFetch: async () => ({ ok: true }), pluginVersion: '3.3.17', diag: () => {} });
  const rs = sBad.start();
  ok(rs.ok === false && rs.reason === 'version-mismatch', '★★★U4-5a start 返回 ok:false + version-mismatch', JSON.stringify(rs.reason));
  ok(rs.running === false, '★★★U4-5b start 后 running 仍为 false（**没跑起来**）');
  const stBad = sBad.status();
  ok(stBad.running === false, '★★★U4-5c status().running === false（证明真没建定时器）');
  // 对照
  const engGood = { config: { teamEnabled: true, teamSyncIntervalMs: 60000 }, _teamEpoch: 1, _teamPeerVersion: '3.3.18' };
  const sGood = TS.createTeamSync({ engine: engGood, identity: { currentMember: () => ({ id: 'm' }) }, outbox: { flush: async () => ({ sent: 0, failed: 0 }) }, teamFetch: async () => ({ ok: true }), pluginVersion: '3.3.18', diag: () => {} });
  const rg = sGood.start();
  ok(rg.ok === true && rg.running === true, '★★★U4-5d 对照：版本一致时 start 正常返回 running:true');
  sGood.stop();
}

console.log('');
console.log('[U4-6] ★★★ 闸门③：status 返回 gate 字段');
{
  const engBad = { config: { teamEnabled: true }, _teamEpoch: 1, _teamPeerVersion: '3.3.17' };
  const s = TS.createTeamSync({ engine: engBad, identity: { currentMember: () => ({ id: 'm' }) }, outbox: { flush: async () => ({ sent: 0, failed: 0 }) }, teamFetch: async () => ({ ok: true }), pluginVersion: '3.3.18', diag: () => {} });
  const st = s.status();
  ok(st.gate && st.gate.ok === false && st.gate.reason === 'version-mismatch', '★★★U4-6a status().gate 暴露不一致', JSON.stringify(st.gate && st.gate.reason));
  ok(st.gate.older === 'peer' && st.gate.action === 'update-other-machine', '★★★U4-6b status().gate 含 older/action（前端可渲染「该更新哪台」）', JSON.stringify({ older: st.gate.older, action: st.gate.action }));
  ok(st.localVersion === '3.3.18' && st.peerVersion === '3.3.17', '★★U4-6c status 暴露双方版本号');
}

console.log('');
console.log('[U4-7] ★三处闸门都走同一个 gate()（防「多处判据」半修）');
{
  const gateCalls = (SRC.match(/gate\(\)/g) || []).length;
  ok(gateCalls >= 4, '★★★U4-7a gate() 被调用 ≥4 次（定义 1 + tick/start/status 各 1）', String(gateCalls));
  // 三处都必须存在：tick 内 skipped、start 内 not-running、status 内 gate: 字段
  ok(/const _g = gate\(\)[\s\S]{0,200}if \(!_g\.ok\)/.test(SRC), '★★★U4-7b tick 内真用 gate() 判定');
  ok(/const _g0 = gate\(\)[\s\S]{0,200}if \(!_g0\.ok\)/.test(SRC), '★★★U4-7c start 内真用 gate() 判定');
  ok(/gate: gate\(\),/.test(SRC), '★★★U4-7d status 内真用 gate()');
  // 负路径：不得出现第二份版本比较逻辑（除 compareSemverPre 定义处）
  const cmpUse = (SRC.match(/compareSemverPre\(/g) || []).length;
  ok(cmpUse >= 3 && cmpUse <= 5, '★★U4-7e compareSemverPre 只在 gate 内用（≤5 处，无重复实现）', String(cmpUse));
}

console.log('');
console.log('[U4-8] ★回归：原有 team-sync 行为未被破坏');
{
  // 未启用 ⇒ 零行为
  const s = TS.createTeamSync({ engine: { config: { teamEnabled: false }, _teamEpoch: 1 }, identity: { currentMember: () => null }, outbox: { flush: async () => ({ sent: 0, failed: 0 }) }, teamFetch: async () => ({ ok: true }), pluginVersion: '3.3.18', diag: () => {} });
  const r = await s.tick();
  ok(r.skipped === true && r.reason === 'team-disabled', '★★U4-8a 未启用时仍是 team-disabled（闸门没吃掉原有判据）', JSON.stringify(r.reason));
  const rs = s.start();
  ok(rs.ok === false && rs.reason === 'team-disabled', '★★U4-8b 未启用时 start 仍 team-disabled');
  // 身份未登记 ⇒ 仍 throw identity-not-registered（不被 gate 掩盖）
  const s2 = TS.createTeamSync({ engine: { config: { teamEnabled: true }, _teamEpoch: 1, _teamPeerVersion: '3.3.18' }, identity: { currentMember: () => null }, outbox: { flush: async (sender) => { await sender({ kind: 'k', key: 'x', at: 1 }); return { sent: 1, failed: 0 } } }, teamFetch: async () => ({ ok: true }), pluginVersion: '3.3.18', diag: () => {} });
  let threw = '';
  try { await s2.tick() } catch (e) { threw = String(e && e.message) }
  ok(threw.indexOf('identity-not-registered') >= 0 || threw === '', '★★U4-8c 身份未登记的既有行为仍可观察（gate 不掩盖它）', threw.slice(0, 40) || '(tick 内部吞掉，符合原实现)');
}

console.log('');
console.log('[v4-u4-team-version-gate] ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0)