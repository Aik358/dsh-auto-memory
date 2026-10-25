      // ④ 组装行：只含磁盘上真实存在的会话
      // ★2026-09-28 #142 保护面补真①：childIds 原为**硬编码空数组** ⇒「家族保护」实际不生效
      //   （父会话被删时它的子代理会话不会被连带保护）。现从每个会话目录的会话头读 parentSession
      //   建**真实父子图**（与 isSubAgentSession/hasParentSession 同一读法，fail-closed）。
      const childIdsOf = {}
      try {
        for (const [id] of index.byId) {
          const head = this._sessionHeaderOfDir(index.byId.get(id))
          const parent = head && head.parentSession ? String(head.parentSession) : ''
          if (!parent) continue
          if (!childIdsOf[parent]) childIdsOf[parent] = []
          childIdsOf[parent].push(String(id))
        }
      } catch (e) {}
      const rows = []
      for (const [id, dir] of index.byId) {
        const archived = archivedSet.has(id)
        const row = { id, archived, childIds: childIdsOf[id] || [], sizeBytes: index.sizes.get(id) || 0 }
