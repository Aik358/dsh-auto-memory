// Read-only checks for stale sheets and glass leaking beyond the floating panel.
(function () {
  var global = document.getElementById('dam-skin-v4-style')
  var shared = document.getElementById('dam-shared-ui-style')
  var skin = localStorage.getItem('dam-skin'), family = localStorage.getItem('dam-skin-style') || 'legacy'
  var expected = skin === 'classic' ? 'classic' : family === 'legacy' ? 'legacy' : 'iter5'
  var wrongSheets = [global, shared].filter(function (sheet) { return !sheet || sheet.dataset.damSkinCss !== expected })
    .map(function (sheet) { return sheet ? { id: sheet.id, flavor: sheet.dataset.damSkinCss } : { error: 'Missing stylesheet' } })
  if (global && shared && !(global.compareDocumentPosition(shared) & 4)) wrongSheets.push({ error: 'Common settings must follow the skin sheet' })
  var glassRules = []
  if (global && global.sheet) Array.from(global.sheet.cssRules).forEach(function (rule) {
    if (rule.selectorText && (rule.selectorText.includes('[data-dam-theme][data-dam-theme]') || rule.selectorText.includes('[data-dam-theme="panel"][data-dam-theme="panel"]'))) glassRules.push(rule.selectorText)
  })
  var leaks = []
  // Detached specimens exercise both existing entries and a future/unknown entry.
  ;['settings', 'page', 'entry', 'dialogs', 'autocont', 'drawer', 'future-overlay'].forEach(function (kind) {
    ;['true', 'false'].forEach(function (deep) {
      var boundary = document.createElement('div')
      boundary.dataset.damTheme = kind; boundary.dataset.deep = deep
      var child = document.createElement('div'); child.setAttribute('data-iter5', ''); boundary.appendChild(child)
      glassRules.forEach(function (selector) {
        selector = selector.replace(/::(?:before|after)/g, '')
        if (boundary.matches(selector) || child.matches(selector)) leaks.push({ kind: kind, deep: deep, selector: selector })
      })
    })
  })
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  var faces = Array.from(document.querySelectorAll('[data-dam-tour],[data-dam-status-dialog],[data-dam-autocont],.i5-native-notice,.i5-dialog'))
    .filter(visible).map(function (el) {
      var style = getComputedStyle(el), color = style.backgroundColor, parts = color.match(/[\d.]+/g) || []
      var alpha = parts.length === 4 ? Number(parts[3]) : parts.length === 3 ? 1 : 0
      // Gradient cards use an opaque face token; an unset face makes the gradient invalid.
      var face = style.getPropertyValue('--i5-face').trim(), faceParts = face.match(/[\d.]+/g) || []
      var gradientOpaque = style.backgroundImage !== 'none' && (face.startsWith('#') || faceParts.length === 3 || (faceParts.length === 4 && Number(faceParts[3]) === 1))
      return { label: el.getAttribute('aria-label') || el.className, background: color, image: style.backgroundImage, opaque: alpha === 1 || gradientOpaque }
    })
  return { pass: wrongSheets.length === 0 && leaks.length === 0 && faces.every(function (face) { return face.opaque }),
    expected: expected, wrongSheets: wrongSheets, glassLeaks: leaks, faces: faces }
})()
