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
  }
  return { pass: Object.keys(checks).every(function (key) { return checks[key] }), checks: checks,
    expanded: expanded, skin: root.dataset.i5Style, theme: root.closest('[data-dam-theme]').dataset.deep, background: bg,
    viewport: [innerWidth, innerHeight], contentWidth: [content.clientWidth, content.scrollWidth] }
})()
