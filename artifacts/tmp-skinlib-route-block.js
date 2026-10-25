    // ★2026-09-28（用户第 1 大点·皮肤库机制）：从 GitHub 皮肤库列出/安装皮肤。
    //   皮肤库 = 插件仓库（或任意 fork/第三方仓库）里的 skins/ 目录，开发者按皮肤规范提 PR 上传。
    //   安装落点 = SKIN_DIRS.user（~/.dsh/memory/skins/<name>/），与宿主三层扫描同一真源。
    //   安全：loopback-only；仓库坐标/皮肤名双正则；只抓 3 个固定文件名；单文件 256KB 上限。
    {
      kind: 'exact',
      path: API.skinLibraryFetch,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req).catch(() => ({}))
        const repo = String((body && body.repo) || '').trim()
        const action = String((body && body.action) || 'list').trim()
        try {
          if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return writeJson(res, 400, { error: 'bad repo (expect owner/repo)' })
          const apiBase = 'https://api.github.com/repos/' + repo + '/contents/skins'
          if (action === 'list') {
            const r = await fetch(apiBase, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-auto-memory-skinlib' }, signal: AbortSignal.timeout(12000) })
            if (!r.ok) return writeJson(res, 200, { ok: false, error: 'GitHub ' + r.status + ' (' + repo + '/skins)' })
            const j = await r.json().catch(() => null)
            const skins = Array.isArray(j) ? j.filter((x) => x && x.type === 'dir').map((x) => String(x.name || '')).filter(Boolean) : []
            return writeJson(res, 200, { ok: true, repo: repo, skins: skins })
          }
          if (action === 'install') {
            const name = String((body && body.name) || '').trim()
            if (!/^[\w.-]{1,64}$/.test(name)) return writeJson(res, 400, { error: 'bad skin name' })
            const destDir = path.join(dshHome(), SKIN_DIRS.user, name)
            const want = ['theme.json', 'skin.css', 'README.md']
            const saved = []
            const failures = []
            for (const fileName of want) {
              try {
                const r = await fetch(apiBase + '/' + encodeURIComponent(name) + '/' + fileName, { headers: { accept: 'application/vnd.github.raw', 'user-agent': 'dsh-auto-memory-skinlib' }, signal: AbortSignal.timeout(15000) })
                if (!r.ok) { failures.push(fileName + ':HTTP' + r.status); continue }
                const buf = Buffer.from(await r.arrayBuffer())
                if (buf.length > 262144) { failures.push(fileName + ':too-large'); continue }
                mkdirSync(destDir, { recursive: true })
                const tmp = path.join(destDir, '.' + fileName + '.tmp')
                writeFileSync(tmp, buf)
                renameSync(tmp, path.join(destDir, fileName))
                saved.push(fileName)
              } catch (ef) { failures.push(fileName + ':' + String((ef && ef.message) || ef)) }
            }
            if (!saved.length) return writeJson(res, 200, { ok: false, error: 'nothing installed (' + failures.join('; ') + ')' })
            return writeJson(res, 200, { ok: true, dir: '~/.dsh/memory/skins/' + name, files: saved, failed: failures })
          }
          return writeJson(res, 400, { error: 'bad action (list|install)' })
        } catch (e) { return writeJson(res, 500, { error: String((e && e.message) || e) }) }
      },
    },
