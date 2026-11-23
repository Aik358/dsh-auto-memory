#!/usr/bin/env node
/**
 * smoke-test-readme-links.mjs —— README 外链一致性守卫（2026-11-24）。
 *
 * ## 缺陷原文（用户实报）
 * 「README 里面所有的 GitHub Pages 的链接都是 404」。
 * 实测根因：README 把 owner 写成 **aik350**（该账号在 GitHub **不存在**，API 404），
 * 真实 owner 是 **Aik358** ⇒ 5 条 Pages 链接 + 31 条仓库链接全部 404。
 * 附带查出两处额外死链：① v3.2.10 的 commit SHA 写错（`0200500…` 在本仓不存在）；
 * ② 贡献者 issue 链接写成 `#0`（GitHub issue 从 1 起，实际是 #8）。
 * 又一处：`MINERVAOWL9.html` 实际文件名是 `MINERVAOWL7.html`。
 *
 * ## 本套件守什么（**离线、确定性、无网络**）
 *  A. owner 单一真源：canonical owner 从 package.json 的 repository.url 派生，不硬编码。
 *  B. 任何 `*.github.io/<repo>/...` 与 `github.com/<owner>/<repo>/...` 的 owner 必须 = canonical。
 *  C. Pages 上引用的 `*.html` 必须真实存在于 `docs/`（防「文件名写错」）。
 *  D. `tree/<sha>` 链接的 commit 必须在本仓存在（防「错乱 SHA」，本仓实证发生过）。
 *  E. 变异反向验证：把错 owner / 错文件名灌回 ⇒ B/C 必须变红。
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
let pass = 0, fail = 0
const ok = (c, n, d) => {
  if (c) { pass++; console.log("  ok   - " + n + (d ? " :: " + d : "")) }
  else { fail++; console.log("  FAIL - " + n + (d ? " :: " + d : "")) }
}

// ── A. canonical owner 从 package.json 派生（唯一真源，不硬编码）──
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
const repoUrl = String((PKG.repository && PKG.repository.url) || "")
const mm0 = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i)
ok(!!mm0, "A1 能从 package.json 的 repository.url 解析出 owner/repo", repoUrl)
const OWNER = mm0 ? mm0[1] : ""
const REPO = mm0 ? mm0[2] : ""
const OWNER_LC = OWNER.toLowerCase()
ok(OWNER === "Aik358", "A2 canonical owner 符合预期（repository 变更时本断言须同步）", OWNER)

const READMES = ["README.md", "README.zh-CN.md"]
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")
const urlsOf = (s) => [...new Set((s.match(/https?:\/\/[^\s)"'<>\]`]+/g) || []))]
const repoRe = new RegExp("github\\.com/[^/]+/" + REPO + "(?:[/?#]|$)", "i")
const ownerRe = new RegExp("github\\.com/([^/]+)/" + REPO, "i")

// ── B. 所有指向本仓的链接 owner 必须是 canonical ──
console.log("== B. owner 一致性 ==")
for (const f of READMES) {
  const src = read(f)
  const urls = urlsOf(src)
  const pagesUrls = urls.filter((u) => /\.github\.io\//.test(u))
  ok(pagesUrls.length >= 5, "B-" + f + "-0 至少 5 条 Pages 链接（防抽取失效变恒真）", "count=" + pagesUrls.length)
  const badSub = pagesUrls.filter((u) => {
    const mm = u.match(/^https?:\/\/([^.]+)\.github\.io\//i)
    return !mm || mm[1].toLowerCase() !== OWNER_LC
  })
  ok(badSub.length === 0, "B-" + f + "-1 所有 github.io 链接的子域 = canonical owner", badSub.join(" , "))
  const repoUrls = urls.filter((u) => repoRe.test(u))
  ok(repoUrls.length >= 20, "B-" + f + "-2 本仓链接数量合理", "count=" + repoUrls.length)
  const badOwner = repoUrls.filter((u) => {
    const mm = u.match(ownerRe)
    return !mm || mm[1].toLowerCase() !== OWNER_LC
  })
  ok(badOwner.length === 0, "B-" + f + "-3 所有本仓链接的 owner = canonical", badOwner.slice(0, 3).join(" , "))
  ok(!/aik350/i.test(src), "B-" + f + "-4 不含已证伪的旧账号 aik350（GitHub API 404）")
}

// ── C. Pages 引用的 html 必须真实存在于 docs/ ──
console.log("== C. Pages 文件真实性 ==")
for (const f of READMES) {
  const src = read(f)
  const pagesHtml = urlsOf(src)
    .filter((u) => /\.github\.io\//.test(u))
    .map((u) => { const mm = u.match(/\/([^/]+\.html)(?:[?#]|$)/); return mm ? mm[1] : null })
    .filter(Boolean)
  ok(pagesHtml.length >= 2, "C-" + f + "-0 抽到 Pages 上的 html 引用", "count=" + pagesHtml.length)
  for (const name of [...new Set(pagesHtml)]) {
    ok(fs.existsSync(path.join(ROOT, "docs", name)), "C-" + f + "-1 docs/" + name + " 存在（Pages 上才可能 200）")
  }
  ok(!/MINERVAOWL9\.html/.test(src), "C-" + f + "-2 不含错误文件名 MINERVAOWL9.html（实际为 MINERVAOWL7.html）")
}

// ── D. tree/<sha> 的 commit 必须存在 ──
console.log("== D. commit SHA 真实性 ==")
{
  const shaRe = new RegExp("github\\.com/[^/]+/" + REPO + "/tree/([0-9a-f]{7,40})", "gi")
  let total = 0; const bad = []
  for (const f of READMES) {
    const src = read(f)
    let mm
    while ((mm = shaRe.exec(src)) !== null) {
      total++
      try { execFileSync("git", ["cat-file", "-e", mm[1]], { cwd: ROOT, stdio: "ignore" }) }
      catch (e) { bad.push(f + ":" + mm[1]) }
    }
  }
  ok(total >= 1, "D1 抽到 tree/<sha> 链接（防抽取失效变恒真）", "count=" + total)
  ok(bad.length === 0, "D2 所有 tree/<sha> 的 commit 在本仓存在", bad.slice(0, 3).join(" , "))
}

// ── E. 变异反向验证 ──
console.log("== E. 变异反向验证 ==")
{
  const src = read("README.md")
  // 变异须同时覆盖大小写：Pages 子域是小写（aik358），仓库链接是 canonical 大小写（Aik358）
  const mutated = src.split(OWNER).join("Aik350").split(OWNER_LC).join("aik350")
  ok(mutated !== src, "E1 [变异] owner 替换动作生效")
  const badSub = urlsOf(mutated).filter((u) => /\.github\.io\//.test(u)).filter((u) => {
    const mm = u.match(/^https?:\/\/([^.]+)\.github\.io\//i)
    return !mm || mm[1].toLowerCase() !== OWNER_LC
  })
  ok(badSub.length > 0, "E2 [变异] 换成 aik350 ⇒ B1 会红（判据有区分力）", "bad=" + badSub.length)
  ok(!/aik350/i.test(src), "E3 [还原] 原 README 不含 aik350")
}
{
  ok(fs.existsSync(path.join(ROOT, "docs", "MINERVAOWL7.html")), "E4 [还原] docs/MINERVAOWL7.html 存在 ⇒ C 有区分力")
  ok(!fs.existsSync(path.join(ROOT, "docs", "MINERVAOWL9.html")), "E5 docs/MINERVAOWL9.html 不存在 ⇒ 写错必 404（C 可抓）")
}

console.log("")
console.log("[readme-links] " + pass + " PASS / " + fail + " FAIL")
process.exit(fail === 0 ? 0 : 1)
