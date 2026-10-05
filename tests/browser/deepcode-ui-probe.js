// Read-only browser probe. Run after opening the actual plugin settings in a DSH host.
// bsk evaluate --session <id> <this file's contents> --json
(function () {
  var root = document.querySelector('[data-i5-embedded]')
  if (!root) return { pass: false, error: 'Open memory settings first' }
  var content = root.querySelector('[data-dam-settings-content]')
  var save = root.querySelector('[data-dam-savebar]')
  if (!content || !save) return { pass: false, error: 'Settings content or actions are missing' }
  var expanded = root.dataset.expanded === 'true'
  var scroller = root.parentElement
  while (scroller && !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  var visible = !expanded && scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight }
  var rect = root.getBoundingClientRect(), sr = save.getBoundingClientRect()
  var bg = getComputedStyle(root).backgroundColor
  var boundary = root.closest('[data-dam-theme]')
  var hostDark = document.body.hasAttribute('data-ds-dark-theme') || getComputedStyle(document.documentElement).colorScheme === 'dark'
  function rgb(value) { return (value.match(/[\d.]+/g) || []).map(Number) }
  function luminance(value) {
    var parts = rgb(value).slice(0, 3).map(function (n) { n /= 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4) })
    return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722
  }
  function contrast(fg, bg) { var a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  var faces = [root].concat(Array.from(root.querySelectorAll('.i5-main,.i5-settings-frame-head,.i5-tabs,[data-dam-savebar],.i5-card,[data-dam-settings-group],select,textarea,input:not([type=checkbox]):not([type=radio])')))
  var wrongFaces = faces.filter(function (el) {
    var color = getComputedStyle(el).backgroundColor, parts = rgb(color)
    return parts.length < 3 || (parts.length === 4 && parts[3] !== 1) || (hostDark ? luminance(color) >= 0.2 : luminance(color) <= 0.5)
  }).map(function (el) { return { element: el.tagName + '.' + el.className, background: getComputedStyle(el).backgroundColor } })
  var copies = Array.from(root.querySelectorAll('.i5-settings-intro,.i5-card-sub,.i5-setting-copy,[data-dam-hint]'))
  var lowContrast = copies.filter(function (el) {
    if (!el.getClientRects().length || !el.textContent.trim()) return false
    var ancestor = el, color
    do { color = getComputedStyle(ancestor).backgroundColor; ancestor = ancestor.parentElement } while (ancestor && rgb(color)[3] === 0)
    return contrast(getComputedStyle(el).color, color) < 4.5
  }).map(function (el) { return { element: el.tagName + '.' + el.className, color: getComputedStyle(el).color } })
  var hostTokens = getComputedStyle(boundary.parentElement), settingsTokens = getComputedStyle(root)
  var inheritedColors = ['--dsw-alias-bg-layer-2', '--dsw-alias-label-primary', '--dsw-alias-label-secondary'].every(function (key) {
    return settingsTokens.getPropertyValue(key).trim() === hostTokens.getPropertyValue(key).trim()
  })
  // BrowserSkill's own input guard is instrumentation, above the application.
  var hit = document.elementsFromPoint(sr.left + 8, sr.bottom - 8).filter(function (el) {
    return el.tagName.toLowerCase() !== 'browser-skill-overlay'
  })[0]
  var checks = {
    opaque: /^rgb\(/.test(bg) || /^rgba\([^)]*,\s*1\)$/.test(bg),
    viewport: rect.left >= -1 && rect.right <= innerWidth + 1 && (!expanded || rect.top >= -1 && rect.bottom <= innerHeight + 1),
    rootWidth: root.scrollWidth <= root.clientWidth + 1,
    contentWidth: content.scrollWidth <= content.clientWidth + 1,
    saveVisible: sr.top >= Math.max(0, visible.top) && sr.bottom <= Math.min(innerHeight, visible.bottom) + 1 && sr.height > 0 && save.contains(hit),
    contentScrolls: expanded ? getComputedStyle(content).overflowY === 'auto' : !!scroller && getComputedStyle(root.querySelector('.i5-main')).overflowY === 'visible',
    followsHost: boundary.dataset.deep === String(hostDark),
    nativeColors: inheritedColors,
    themedFaces: wrongFaces.length === 0,
    readableCopy: lowContrast.length === 0,
  }
  return { pass: Object.keys(checks).every(function (key) { return checks[key] }), checks: checks,
    expanded: expanded, skin: root.dataset.i5Style, theme: boundary.dataset.deep, hostDark: hostDark, background: bg,
    wrongFaces: wrongFaces, lowContrast: lowContrast,
    viewport: [innerWidth, innerHeight], contentWidth: [content.clientWidth, content.scrollWidth] }
})()
