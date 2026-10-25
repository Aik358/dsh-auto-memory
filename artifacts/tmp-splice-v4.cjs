/* 批次2 精修轮拼接脚本(welcome/settings 可视化重做)——2026-09-27
 * 改点:①token 行补 --skin-space-3/4/5(此前 10+ 规则引用但从未定义,静默失效)
 *      ②CSS 数组追加精修轮规则(无裸 hex,全部走 --skin-* token)
 *      ③DamSkinV4Welcome/DamSkinV4Settings 整体替换(概念图 02/10 可视化,真键同步)
 *      ④屏分发给 welcome 传 onNav(跳过引导→home)
 * 纪律:改前备份;锚点唯一性校验;CRLF 保持;改后计数验证。 */
const fs = require('fs')
const path = require('path')

const SRC = 'D:/dsh-auto-memory/lib/client.js'
const BLOCK = 'D:/dsh-auto-memory/artifacts/tmp-v4block.js'
const CSSF = 'D:/dsh-auto-memory/artifacts/tmp-v4css.js'

function once(s, needle) {
  const i = s.indexOf(needle)
  if (i < 0) throw new Error('anchor missing: ' + needle.slice(0, 60))
  if (s.indexOf(needle, i + 1) >= 0) throw new Error('anchor not unique: ' + needle.slice(0, 60))
  return i
}
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

const src = fs.readFileSync(SRC, 'utf8')
const bytes0 = Buffer.byteLength(src, 'utf8')
const hash0 = require('crypto').createHash('sha256').update(src).digest('hex').slice(0, 8).toUpperCase()
const bak = 'D:/dsh-auto-memory/artifacts/backup/client.js.r42-' + bytes0 + '-' + hash0 + '.js'
fs.writeFileSync(bak, src, 'utf8')
console.log('backup:', bak)

let out = src

// ① token 行补空隙 token(--skin-space-* 被 10+ 规则引用但从未定义 → gap/padding 静默失效)
{
  const a = '--skin-dur-slow:320ms;}'
  const i = once(out, a)
  out = out.slice(0, i) + '--skin-dur-slow:320ms;--skin-space-3:12px;--skin-space-4:16px;--skin-space-5:24px;}' + out.slice(i + a.length)
  console.log('① token line: --skin-space-3/4/5 defined')
}

// ② CSS 追加(插在 note 规则后)
{
  const a = "'[data-dam-skin-v4-note]{font-size:11px;color:var(--skin-text-3);font-style:italic;}',"
  const i = once(out, a)
  const cssBlock = crlf(fs.readFileSync(CSSF, 'utf8').replace(/\r?\n$/, ''))
  out = out.slice(0, i + a.length) + '\r\n' + cssBlock + out.slice(i + a.length)
  console.log('② css: inserted', cssBlock.split('\r\n').length, 'rules')
}

// ③ welcome+settings 两函数整体替换
{
  const a1 = '    /** 批次2 粗装:welcome 屏 = SkinHero'
  const a2 = '    /** 批次2 屏分发:home ⇒ DamSkinV4Home'
  const i1 = once(out, a1)
  const i2 = once(out, a2)
  if (i2 <= i1) throw new Error('anchor order wrong')
  let block = fs.readFileSync(BLOCK, 'utf8').replace(/\r?\n$/, '')
  if (!block.startsWith('    /** ===== 欢迎引导')) throw new Error('block head unexpected: ' + JSON.stringify(block.slice(0, 40)))
  if (!block.endsWith('    }')) throw new Error('block tail unexpected: ' + JSON.stringify(block.slice(-20)))
  out = out.slice(0, i1) + crlf(block) + '\r\n\r\n' + out.slice(i2)
  console.log('③ block: replaced', i2 - i1, 'chars with', Buffer.byteLength(block, 'utf8'))
}

// ④ 屏分发:welcome 传 onNav(跳过引导/开始使用 → home)
{
  const a = 'return h(DamSkinV4Welcome, {})'
  const i = once(out, a)
  out = out.slice(0, i) + 'return h(DamSkinV4Welcome, { onNav: props && props.onNav })' + out.slice(i + a.length)
  console.log('④ dispatcher: onNav wired')
}

fs.writeFileSync(SRC, out, 'utf8')

// 验证
const chk = fs.readFileSync(SRC, 'utf8')
const loneLF = (chk.match(/(^|[^\r])\n/g) || []).length
const count = (s) => chk.split(s).length - 1
console.log('--- verify ---')
console.log('bytes:', Buffer.byteLength(chk, 'utf8'), '(was', bytes0 + ')')
console.log('lone-LF lines:', loneLF)
console.log('ctlrow:', count('data-dam-skin-v4-ctlrow'), 'setcols:', count('data-dam-skin-v4-setcols'),
  'stepdot:', count('data-dam-skin-v4-stepdot'), 'wnext:', count('data-dam-skin-v4-wnext'),
  'setcol:', count('data-dam-skin-v4-setcol"'), 'SkinHero calls:', count('h(SkinHero'))
console.log('welcome fn:', count('function DamSkinV4Welcome'), 'settings fn:', count('function DamSkinV4Settings'),
  'onNav-wired:', count('onNav: props && props.onNav'))
