// Read-only probe for the real DSH settings entry, before and after expansion.
(function () {
  var root = document.querySelector('[data-i5-embedded]')
  if (!root) return { pass: false, error: 'Open memory settings first' }
  var content = root.querySelector('[data-dam-settings-content]')
  var save = root.querySelector('[data-dam-savebar]')
  if (!content || !save) return { pass: false, error: 'Missing settings content or save actions' }
  var expanded = root.dataset.expanded === 'true'
  var boundary = root.closest('[data-dam-theme]')
  var hostDark = document.body.hasAttribute('data-ds-dark-theme') || getComputedStyle(document.documentElement).colorScheme === 'dark'
  function rgb(value) { return (value.match(/[\d.]+/g) || []).map(Number) }
  function alpha(value) { var p = rgb(value); return p.length === 4 ? p[3] : p.length === 3 ? 1 : 0 }
  function luminance(p) {
    var c = p.slice(0, 3).map(function (n) { n /= 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4) })
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
  }
  function background(el) {
    var p = rgb(getComputedStyle(el).backgroundColor), a = p.length === 4 ? p[3] : 1
    if (a === 1) return p
    var parent = el.parentElement ? background(el.parentElement) : [255, 255, 255]
    return parent.map(function (n, i) { return (p[i] || 0) * a + n * (1 - a) }).slice(0, 3)
  }
  var faces = [root].concat(Array.from(root.querySelectorAll('.i5-main,.i5-settings-frame-head,.i5-tabs,[data-dam-savebar]')))
  var wrongFaces = faces.filter(function (el) {
    var color = getComputedStyle(el).backgroundColor
    return alpha(color) !== 1 || (hostDark ? luminance(rgb(color)) >= 0.2 : luminance(rgb(color)) <= 0.5)
  }).map(function (el) { return { element: el.tagName + '.' + el.className, background: getComputedStyle(el).backgroundColor } })
  var lowContrast = Array.from(root.querySelectorAll('.i5-settings-intro,.i5-card-sub,.i5-setting-copy,[data-dam-hint]')).filter(function (el) {
    if (!el.getClientRects().length || !el.textContent.trim()) return false
    var bg = background(el), fg = rgb(getComputedStyle(el).color), a = fg.length === 4 ? fg[3] : 1
    fg = bg.map(function (n, i) { return fg[i] * a + n * (1 - a) })
    var x = luminance(fg), y = luminance(bg)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) < 4.5
  }).map(function (el) { return { element: el.tagName + '.' + el.className, color: getComputedStyle(el).color } })
  var rect = root.getBoundingClientRect(), sr = save.getBoundingClientRect()
  var hit = document.elementsFromPoint(sr.left + 8, sr.bottom - 8).filter(function (el) { return el.tagName.toLowerCase() !== 'browser-skill-overlay' })[0]
  var checks = {
    opaqueSurfaces: wrongFaces.length === 0,
    followsHost: boundary.dataset.deep === String(hostDark),
    rootWidth: root.scrollWidth <= root.clientWidth + 1,
    contentWidth: content.scrollWidth <= content.clientWidth + 1,
    viewport: rect.left >= -1 && rect.right <= innerWidth + 1 && (!expanded || rect.top >= -1 && rect.bottom <= innerHeight + 1),
    saveVisible: sr.top >= 0 && sr.bottom <= innerHeight + 1 && sr.height > 0 && save.contains(hit),
    contentScrolls: expanded ? getComputedStyle(content).overflowY === 'auto' && content.clientHeight > 24 : getComputedStyle(root.querySelector('.i5-main')).overflowY === 'visible',
    readableCopy: lowContrast.length === 0,
  }
  return { pass: Object.keys(checks).every(function (key) { return checks[key] }), checks: checks,
    expanded: expanded, theme: boundary.dataset.deep, hostDark: hostDark,
    wrongFaces: wrongFaces, lowContrast: lowContrast, viewport: [innerWidth, innerHeight],
    contentWidth: [content.clientWidth, content.scrollWidth] }
})()
