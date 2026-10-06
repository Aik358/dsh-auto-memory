import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { SKIN_ASSETS, SKIN_ASSET_ROOT } from '../../lib/skin-assets.js'
// ★V2-1：skinAbsPathOfPre 的根归属判定已收敛到公共工具（lib/file-boundary.js），
//   本套件用 vm 抽出函数体单独执行 ⇒ 必须把该工具显式注入其作用域（否则 ReferenceError）。
import { fileWithinRoots, canonPath, pathKey } from '../../lib/file-boundary.js'

const source = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const start = source.indexOf('function skinAssetRelOfPre(')
const end = source.indexOf('// ---------- HTTP 辅助 ----------', start)
assert(start > 0 && end > start)
const assets = { ...SKIN_ASSETS, escaped: { file: 'slots/safe.png', fileDark: '../outside.png' } }
const ctx = vm.createContext({ SKIN_ASSETS: assets, SKIN_ASSET_ROOT, path, pluginRootDir: () => process.cwd(), fileWithinRoots })
vm.runInContext(source.slice(start, end), ctx)
assert.equal(ctx.skinAssetRelOfPre('hero.welcome', true), 'slots/hero.native-folio-dark-v1.png')
assert.equal(ctx.skinAssetRelOfPre('hero.welcome'), 'slots/hero.native-folio-v1.png')
assert.equal(ctx.skinAssetRelOfPre('empty.timeline', true), assets['empty.timeline'].file)
assert.equal(ctx.skinAbsPathOfPre('escaped', true), null, 'dark variant cannot escape the asset root')
assert.equal(ctx.skinAbsPathOfPre('missing', true), null)
assert.equal(ctx.skinMimeOfPre(ctx.skinAssetRelOfPre('hero.welcome', true)), 'image/png')
const route = source.slice(source.indexOf('path: API.skinAsset,'), source.indexOf('// ★2026-09-28（用户第 1 大点', source.indexOf('path: API.skinAsset,')))
assert(route.includes("searchParams.get('deep') === '1'"))
assert(route.includes('skinAbsPathOfPre(key, deep)') && route.includes('skinMimeOfPre(skinAssetRelOfPre(key, deep))'))
console.log('PASS light/dark route selection, missing-dark fallback, MIME and path containment')
