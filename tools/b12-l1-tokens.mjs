#!/usr/bin/env node
/**
 * B12 L1 token tool (dsh-auto-memory)
 *
 * Extracts literal scale values from the CSS region of lib/client.js into --dam-* tokens.
 * VISUAL ZERO-CHANGE proven offline: expanding var(--dam-x, V) back to V yields
 * byte-identical CSS region (sha256 compared).
 *
 * Discipline: operates on the WHOLE string, never splits into a line array.
 * (This repo has twice burned itself by split("\n") + join("\n") on CRLF files.)
 *
 * Usage:  node tools/b12-l1-tokens.mjs --dry  |  --apply
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CLIENT = resolve(ROOT, "lib/client.js")
const APPLY = process.argv.indexOf("--apply") >= 0
const DRY = !APPLY
let FAIL = 0
const ok = function (m) { console.log("  OK  " + m) }
const bad = function (m) { FAIL++; console.log("  NG  " + m) }
const eq = function (a, b, m) { if (a === b) ok(m + " = " + a); else bad(m + ": got " + a + ", want " + b) }
const sha256 = function (s) { return createHash("sha256").update(s, "utf8").digest("hex") }
const sha16 = function (s) { return sha256(s).slice(0, 16).toUpperCase() }

// ── token tables (value -> semantic name) ────────────────
const RADIUS = {
  "50%": "circle", "99px": "pill", "0": "none",
  "3px": "xs", "5px": "xs2", "6px": "sm", "7px": "sm2", "8px": "md", "9px": "md2",
  "10px": "lg", "11px": "lg2", "12px": "xl", "14px": "xl2", "16px": "xxl",
  "18px": "xxl2", "20px": "xxxl", "22px": "xxxl2", "23px": "xxxl3",
  "27px": "r27", "28px": "r28", "31px": "r31",
  "16px 16px 0 0": "top", "0 0 16px 0": "br", "0 0 14px 14px": "bottom",
  "8px 8px 12px 12px": "foot", "20px 20px 9px 9px": "foot2",
  "46% 54% 52% 48% / 50% 44% 56% 50%": "blob-a",
  "54% 46% 47% 53% / 44% 56% 45% 55%": "blob-b",
  "70% 30% 58% 42% / 66% 40% 60% 34%": "blob-c",
}
const FONTSIZE = {
  "9.5px": "xxs", "10px": "xs", "10.5px": "xs2", "11px": "sm", "11.5px": "sm2",
  "12px": "base", "12.5px": "base2", "13px": "md", "13.5px": "md2",
  "14px": "lg", "17px": "xl", "18px": "xl2", "20px": "xxl", "23px": "xxl2", "26px": "xxl3",
}
const SPACE = {
  "0": "none", "2px": "s0-5", "4px": "s1", "5px": "s1-5", "6px": "s2", "7px": "s2-5",
  "8px": "s3", "9px": "s3-5", "10px": "s4", "11px": "s5", "12px": "s6", "13px": "s6-5",
  "14px": "s7", "16px": "s8", "18px": "s9", "20px": "s10", "22px": "s11",
  "24px": "s12", "26px": "s13", "28px": "s14", "31px": "s15", "4px 12px": "pair-1-3",
}
const BLUR = {
  "blur(5px)": "sm", "blur(6px)": "sm2", "blur(12px)": "md", "blur(14px)": "md2",
  "blur(16px)": "lg", "blur(26px)": "lg2", "blur(28px)": "xl", "blur(30px)": "xl2",
}
// Not tokenized on purpose (documented, not an oversight):
const SKIP = [
  /^calc\([\d.]+px \* var\(--dam-scale\)\)$/,
  /^blur\([\d.]+px\) saturate\(/,
  /-webkit-|or \(-webkit-/,
]
const RULES = [
  { prop: "border-radius",   table: RADIUS,   pre: "radius",   rx: /(border-radius\s*:\s*)([^;"}\n]*?)(\s*)(?=[;"}\n])/g },
  { prop: "font-size",       table: FONTSIZE, pre: "fontsize", rx: /(font-size\s*:\s*)([^;"}\n]*?)(\s*)(?=[;"}\n])/g },
  { prop: "gap",             table: SPACE,    pre: "space",    rx: /((?<![-\w])gap\s*:\s*)([^;"}\n]*?)(\s*)(?=[;"}\n])/g },
  { prop: "backdrop-filter", table: BLUR,     pre: "blur",     rx: /(backdrop-filter\s*:\s*)([^;"}\n]*?)(\s*)(?=[;"}\n])/g },
]

// ── read file + locate CSS region (whole-string, never line-split) ──
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + LF
const raw = readFileSync(CLIENT, "utf8")
const bareLF = (raw.match(/(?<!\r)\n/g) || []).length
const crlfCount = (raw.match(/\r\n/g) || []).length

const START_MARK = "var CSS = ["
const QUOTE = String.fromCharCode(39)
const END_MARK = "].join(" + QUOTE
const iStart = raw.indexOf(START_MARK)
const iEnd = raw.indexOf(END_MARK, iStart)
if (iStart < 0 || iEnd < 0) { console.error("NG: CSS region not found"); process.exit(1) }
const cssRegion = raw.slice(iStart, iEnd)
const head = raw.slice(0, iStart)
const tail = raw.slice(iEnd)
const lineOf = function (i) { return raw.slice(0, i).split(LF).length }

console.log("===== B12 L1 token " + (DRY ? "[DRY readonly]" : "[APPLY]") + " =====")
console.log("file : " + CLIENT)
console.log("bytes: " + Buffer.byteLength(raw) + " | CRLF: " + crlfCount + " | bareLF: " + bareLF)
console.log("CSS  : L" + lineOf(iStart) + "-L" + lineOf(iEnd) + " (" + cssRegion.length + " chars)")

// ── transform ────────────────────────────────────────────
const hits = []
let outRegion = cssRegion
for (let ri = 0; ri < RULES.length; ri++) {
  const rule = RULES[ri]
  const re = new RegExp(rule.rx.source, "g")
  outRegion = outRegion.replace(re, function (whole, pre, valRaw, sp) {
    const val = valRaw.trim()
    if (val.indexOf("var(--dam-") === 0) return whole
    const name = rule.table[val]
    if (!name) return whole
    const token = "--dam-" + rule.pre + "-" + name
    hits.push({ prop: rule.prop, val: val, token: token })
    return pre + "var(" + token + ", " + val + ")" + sp
  })
}

// ── token definition block (ES5, CRLF per line) ──────────
function emitTable(table, prefix, per) {
  const keys = Object.keys(table)
  const out = []
  for (let i = 0; i < keys.length; i += per) {
    const seg = keys.slice(i, i + per).map(function (v) { return "--dam-" + prefix + "-" + table[v] + ": " + v + ";" }).join(" ")
    out.push("        " + QUOTE + seg + QUOTE + "," + CRLF)
  }
  return out
}
const blockLines = [
  "      // B12 L1 token (2026-09-27): literal scales extracted to --dam-* tokens." + CRLF,
  "      // Proof of zero visual change: expanding var(--dam-x, V) back to V yields" + CRLF,
  "      // byte-identical CSS. Customers override these to re-skin (L2 base)." + CRLF,
  "      " + QUOTE + "[data-dam-panel], [data-dam-page] {" + QUOTE + " + CRLF,"
]
  .concat(emitTable(RADIUS, "radius", 4))
  .concat(emitTable(FONTSIZE, "fontsize", 4))
  .concat(emitTable(SPACE, "space", 5))
  .concat(emitTable(BLUR, "blur", 3))
  .concat(["      " + QUOTE + "}" + QUOTE + " + CRLF,"])
const blockText = blockLines.join("")
const out = head + outRegion + blockText + tail

// ── assertions ───────────────────────────────────────────
console.log("")
console.log("[1] replacement tally")
const byProp = {}
for (const h of hits) byProp[h.prop] = (byProp[h.prop] || 0) + 1
console.log("  total hits: " + hits.length)
for (const kv of Object.entries(byProp)) console.log("    " + kv[0] + ": " + kv[1])
const tokSet = new Set(hits.map(function (h) { return h.token }))
console.log("  distinct tokens: " + tokSet.size)

console.log("")
console.log("[2] negative path: every literal must be covered by a token table")
let uncovered = 0
for (const rule of RULES) {
  const vals = new Set()
  for (const m of cssRegion.matchAll(new RegExp(rule.rx.source, "g"))) {
    const v = (m[2] || "").trim()
    if (v && v.indexOf("var(--dam-") !== 0) vals.add(v)
  }
  for (const v of vals) {
    if (rule.table[v]) continue
    let skip = false
    for (const re of SKIP) if (re.test(v)) skip = true
    if (skip) continue
    uncovered++; bad(rule.prop + " uncovered value: '" + v + "'")
  }
}
if (uncovered === 0) ok("all literals in " + RULES.length + " property classes are covered or whitelisted")

console.log("")
console.log("[3] count conservation: var() occurrences per token === original literal count")
let countBad = 0
for (const t of tokSet) {
  const want = hits.filter(function (h) { return h.token === t }).length
  const got = outRegion.split("var(" + t + ",").length - 1
  if (got !== want) { countBad++; bad(t + ": " + got + " occurrences, want " + want) }
}
if (countBad === 0) ok(tokSet.size + " tokens all conserve their replacement count")

console.log("")
console.log("[4] ZERO-VISUAL-CHANGE PROOF: expand var(--dam-x, V) -> V, compare sha256")
const EXPAND = /var\(--dam-(?:radius|fontsize|space|blur)-[a-z0-9-]+, ([^)]+)\)/g
const expanded = outRegion.replace(EXPAND, "$1")
if (expanded === cssRegion) {
  ok("expanded sha256 = " + sha16(expanded) + " === original " + sha16(cssRegion))
} else {
  bad("expanded CSS differs from original")
  for (let i = 0; i < Math.max(expanded.length, cssRegion.length); i++) {
    if (expanded[i] !== cssRegion[i]) {
      console.log("    first diff @" + i)
      console.log("      orig: " + JSON.stringify(cssRegion.slice(Math.max(0, i - 60), i + 60)))
      console.log("      exp : " + JSON.stringify(expanded.slice(Math.max(0, i - 60), i + 60)))
      break
    }
  }
}

console.log("")
console.log("[5] token definition block validity")
const defCount = (blockText.match(/--dam-(?:radius|fontsize|space|blur)-[a-z0-9-]+\s*:/g) || []).length
eq(defCount >= tokSet.size, true, "block defines " + defCount + " tokens, needs >= " + tokSet.size)
let missing = 0
for (const t of tokSet) if (blockText.indexOf(t + ":") < 0) { missing++; bad("block missing " + t) }
if (missing === 0) ok("no token definition missing")
if (/--[a-z0-9-]+:\s*;/.test(blockText)) bad("block has empty value"); else ok("block has no empty value")

console.log("")
console.log("[6] ES5 syntax check on new lines (no const/let/arrow/template)")
const ES_BAD = new RegExp("\\b(const|let)\\s|=>|" + String.fromCharCode(96))
const es5Bad = blockLines.filter(function (l) { return ES_BAD.test(l) })
if (es5Bad.length) { bad("block has " + es5Bad.length + " non-ES5 lines"); es5Bad.slice(0, 3).forEach(function (l) { console.log("    " + l.trim().slice(0, 90)) }) }
else ok("block is pure ES5")

console.log("")
console.log("[7] anchor conservation (must not decrease)")
const aBefore = (raw.match(/data-dam-[a-z0-9-]+/g) || []).length
const aAfter = (out.match(/data-dam-[a-z0-9-]+/g) || []).length
eq(aAfter >= aBefore, true, "data-dam-* anchors " + aBefore + " -> " + aAfter)

console.log("")
console.log("[8] EOL property unchanged")
const oBare = (out.match(/(?<!\r)\n/g) || []).length
const oCrlf = (out.match(/\r\n/g) || []).length
eq(oBare, 0, "bare LF count")
ok("CRLF lines: " + oCrlf + " (was " + crlfCount + ", +" + (oCrlf - crlfCount) + ")")

console.log("")
console.log("[9] append-only: head and tail must be byte-identical")
eq(out.slice(0, iStart) === head, true, "bytes before CSS region (" + iStart + ")")
eq(out.slice(iStart + outRegion.length + blockText.length) === tail, true, "bytes after CSS region (" + tail.length + ")")

console.log("")
console.log("[10] CSS body line count unchanged (token-ization only)")
eq(outRegion.split(LF).length, cssRegion.split(LF).length, "CSS region line count")

console.log("")
console.log("[11] output size and sha")
console.log("  new bytes: " + Buffer.byteLength(out) + " (+" + (Buffer.byteLength(out) - Buffer.byteLength(raw)) + ")")
console.log("  new sha16: " + sha16(out) + " (was " + sha16(raw) + ")")

console.log("")
console.log("------------------------------------------------------------")
if (FAIL > 0) {
  console.log("NG  " + FAIL + " assertion(s) failed — " + (APPLY ? "refusing to write" : "dry did not pass"))
  process.exit(1)
}
console.log("OK  all assertions passed")
if (APPLY) {
  const bak = CLIENT + ".bak-l1-" + Date.now()
  copyFileSync(CLIENT, bak)
  writeFileSync(CLIENT, out, "utf8")
  console.log("OK  written: " + CLIENT)
  console.log("    backup : " + bak)
} else {
  console.log("(dry mode: nothing written)")
}
process.exit(0)
