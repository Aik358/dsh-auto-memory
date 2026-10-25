  /**
   * ★2026-09-28 #142 保护面补真②（辅助）：读某会话目录的会话头（只取前 8KB，不解全量）。
   *   与 sessionHeaderOf 同一字段口径（parentSession / origin / delegationDepth）。
   *   fail-closed：读不到一律返 null（调用方按「无血缘」处理，绝不误伤）。
   */
  _sessionHeaderOfDir(dirPath) {
    try {
      const names = readdirSync(dirPath)
      const hit = names.filter((n) => /^session[.-].*[.]jsonl([.]zstd)?$/i.test(n) && !/backup|corrupt/i.test(n))[0]
      if (!hit) return null
      const buf = readFileSync(path.join(dirPath, hit))
      try {
        const txt = hit.endsWith('.zstd') ? decodeZstdFramesHead(buf, 8192) : buf.toString('utf8', 0, 8192)
        const first = String(txt || '').split('\n')[0]
        if (!first) return null
        const j = JSON.parse(first)
        return (j && (j.header || j.session || j)) || null
      } catch (e2) { return null }
    } catch (e) { return null }
  }

