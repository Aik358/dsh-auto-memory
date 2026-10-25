      // ② 磁盘索引 —— 逃逸软链在此被排除（removeSessionDir 还会再 realpath 复验一次）
      const index = indexSessionDirs(root)
      // ★2026-09-28 #142 保护面补真③：`_liveSessionIds` 原为**只读不写**（全仓无写入点）⇒
      //   「运行中会话保护」实际是空集。现建立写入点：从索引取「最近活动」会话（mtime 在
      //   liveWindowMs 内）视为运行中 —— 保守做法，宁愿少删不误删。窗口取 sweep 间隔两倍（≥15 分钟）。
      try {
        const liveWindowMs = Math.max(15 * 60000, intervalMs * 2)
        const live = new Set()
        for (const [id, dir] of index.byId) {
          try {
            const st = statSync(dir)
            if (Date.now() - Number(st.mtimeMs || 0) <= liveWindowMs) live.add(String(id))
          } catch (e2) {}
        }
        this._liveSessionIds = live
      } catch (e) {}
