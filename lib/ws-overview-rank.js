/**
 * M10 工作区总览采样排序(2026-09-08,issue #24)。
 *
 * 背景:workspaceOverview 对 discoverWorkspaces() 的结果做 slice(0,8) 字母序取样,
 * 而会话目录字母序靠前的位置常被临时/一次性工作区占据(ppt_build、jobs-issue-* 等,
 * 实测字母序前 24 位全是无记忆目录),真正带记忆的活跃工作区排在 20 位开外,
 * 永远进不了跨工作区总结 → 面板「今日工作 0 条日志」。
 *
 * 修复:按「最新日志文件 mtime」降序排列后再交给调用方取样。无记忆工作区(latest=0)
 * 自然沉底;同分保持原字母序(sort 稳定)。纯函数、零运行时依赖,IO 全部注入,可回归锁定。
 * 截尾(slice(0,8))仍由调用方决定,本函数只负责排序,恒返回全部 cwd。
 */
import path from 'node:path'

/** 日志文件名日期识别(与 index.js readWorkspaceMemory 的 DATE_RE 同源)。 */
const DATE_RE = /\d{4}-\d{2}-\d{2}/

/**
 * 按记忆活跃度(最新日志 mtime)降序排列工作区。
 * @param {string[]} cwds - discoverWorkspaces 产出的工作区路径(原顺序)。
 * @param {(cwd:string)=>string} projectDirOf - cwd → 记忆目录 映射。
 * @param {(dir:string)=>Promise<string[]>} readdir - 目录列表(条目名数组)。
 * @param {(p:string)=>Promise<{mtimeMs:number}>} stat - 文件状态。
 * @returns {Promise<string[]>} 排序后的 cwd 数组(恒返回全部,截尾由调用方决定)。
 */
export async function rankWorkspacesByMemoryRecencyPre(cwds, projectDirOf, readdir, stat) {
  const ranked = await Promise.all((Array.isArray(cwds) ? cwds : []).map(async (cwd) => {
    let latest = 0
    try {
      const dir = projectDirOf(cwd)
      for (const en of await readdir(dir)) {
        if (!DATE_RE.test(String(en).replace(/\.md$/, ''))) continue
        const m = (await stat(path.join(dir, String(en)))).mtimeMs
        if (m > latest) latest = m
      }
    } catch (e) {}
    return { cwd, latest }
  }))
  return ranked.sort((a, b) => b.latest - a.latest).map((x) => x.cwd)
}
