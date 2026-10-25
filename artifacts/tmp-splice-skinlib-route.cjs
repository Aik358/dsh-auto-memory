/* 2026-09-28 宿主侧皮肤库路由：GET/POST /skin-library-fetch
 * action=list    → 列 GitHub 仓库 owner/repo 的 skins/ 目录（GitHub contents API）
 * action=install → 拉取 skins/<name>/ 下 theme.json + skin.css(+README.md) 到 ~/.dsh/memory/skins/<name>/
 * 安全：loopback-only；仓库坐标白名单正则；皮肤名白名单正则（防路径穿越）；只抓固定 3 个文件名；
 *      每文件 256KB 上限；装到 user 层目录（SKIN_DIRS.user 单一真源，不另立路径）。
 * 纪律：不改写任何既有路由；只追加。写盘走原子写（临时文件 + rename）。 */
const fs = require('fs')
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')
const IB = 'D:/dsh-auto-memory/lib/index.js'
let s = fs.readFileSync(IB, 'utf8')
const b0 = Buffer.byteLength(s, 'utf8')
const h0 = require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase()
fs.writeFileSync('D:/dsh-auto-memory/artifacts/backup/index.js.r46-' + b0 + '-' + h0 + '.js', s, 'utf8')
const once = (n, t) => { let c = 0, i = -1; for (let p = 0; (p = s.indexOf(n, p)) >= 0; p += 1) { c++; if (i < 0) i = p } if (c !== 1) throw new Error(t + ' hits=' + c); return i }

// 在 skin-asset 路由块之后插入新路由
{
  const a = crlf([
    '        createReadStream(abs).on(\'error\', () => { try { res.end() } catch (_) {} }).pipe(res)',
    '      },',
    '    },',
  ].join('\n'))
  const i = once(s, a, 'R1')
  const route = crlf([
    '    // ★2026-09-28（用户第 1 大点·皮肤库机制）：从 GitHub 皮肤库列出/安装皮肤。',
    '    //   皮肤库 = 插件仓库（或任意 fork/第三方仓库）里的 skins/ 目录，开发者按皮肤规范提 PR 上传。',
    '    //   安装落点 = SKIN_DIRS.user（~/.dsh/memory/skins/<name>/），与宿主三层扫描同一真源。',
    '    //   安全：loopback-only；仓库坐标/皮肤名双正则；只抓 3 个固定文件名；单文件 256KB 上限。',
    '    {',
    '      kind: \'exact\',',
    '      path: API.skinLibraryFetch,',
    '      handler: async (req, res) => {',
    '        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: \'forbidden: loopback-only\' })',
    '        const body = await readJsonBody(req).catch(() => ({}))',
    '        const repo = String((body && body.repo) || \'\').trim()',
    '        const action = String((body && body.action) || \'list\').trim()',
    '        try {',
    '          if (!/^[\\w.-]+\\/[\\w.-]+$/.test(repo)) return writeJson(res, 400, { error: \'bad repo (expect owner/repo)\' })',
    '          const apiBase = \'https://api.github.com/repos/\' + repo + \'/contents/skins\'',
    '          if (action === \'list\') {',
    '            const r = await fetch(apiBase, { headers: { accept: \'application/vnd.github+json\', \'user-agent\': \'dsh-auto-memory-skinlib\' }, signal: AbortSignal.timeout(12000) })',
    '            if (!r.ok) return writeJson(res, 200, { ok: false, error: \'GitHub \' + r.status + \' (\' + repo + \'/skins)\' })',
    '            const j = await r.json().catch(() => null)',
    '            const skins = Array.isArray(j) ? j.filter((x) => x && x.type === \'dir\').map((x) => String(x.name || \'\')).filter(Boolean) : []',
    '            return writeJson(res, 200, { ok: true, repo: repo, skins: skins })',
    '          }',
    '          if (action === \'install\') {',
    '            const name = String((body && body.name) || \'\').trim()',
    '            if (!/^[\\w.-]{1,64}$/.test(name)) return writeJson(res, 400, { error: \'bad skin name\' })',
    '            const destDir = path.join(dshHome(), SKIN_DIRS.user, name)',
    '            const want = [\'theme.json\', \'skin.css\', \'README.md\']',
    '            const saved = []',
    '            const failures = []',
    '            for (const fileName of want) {',
    '              try {',
    '                const r = await fetch(apiBase + \'/\' + encodeURIComponent(name) + \'/\' + fileName, { headers: { accept: \'application/vnd.github.raw\', \'user-agent\': \'dsh-auto-memory-skinlib\' }, signal: AbortSignal.timeout(15000) })',
    '                if (!r.ok) { failures.push(fileName + \':HTTP\' + r.status); continue }',
    '                const buf = Buffer.from(await r.arrayBuffer())',
    '                if (buf.length > 262144) { failures.push(fileName + \':too-large\'); continue }',
    '                mkdirSync(destDir, { recursive: true })',
    '                const tmp = path.join(destDir, \'.\' + fileName + \'.tmp\')',
    '                writeFileSync(tmp, buf)',
    '                renameSync(tmp, path.join(destDir, fileName))',
    '                saved.push(fileName)',
    '              } catch (ef) { failures.push(fileName + \':\' + String((ef && ef.message) || ef)) }',
    '            }',
    '            if (!saved.length) return writeJson(res, 200, { ok: false, error: \'nothing installed (\' + failures.join(\'; \') + \')\' })',
    '            return writeJson(res, 200, { ok: true, dir: \'~/.dsh/memory/skins/\' + name, files: saved, failed: failures })',
    '          }',
    '          return writeJson(res, 400, { error: \'bad action (list|install)\' })',
    '        } catch (e) { return writeJson(res, 500, { error: String((e && e.message) || e) }) }',
    '      },',
    '    },',
  ].join('\n'))
  s = s.slice(0, i + a.length) + '\r\n' + route + s.slice(i + a.length)
}
fs.writeFileSync(IB, s, 'utf8')
console.log('index.js:', b0, '->', Buffer.byteLength(s, 'utf8'),
  '| lone-LF:', (s.match(/(^|[^\r])\n/g) || []).length,
  '| route:', (s.match(/API\.skinLibraryFetch/g) || []).length)
