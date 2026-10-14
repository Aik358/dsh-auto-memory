export function calendarFieldEncodePre(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

export function calendarFieldDecodePre(value) {
  return String(value || '').replace(/\\([\\|])/g, '$1')
}

export function calendarQuadrantPre(value) {
  return value === '不重要紧急' ? '紧急不重要' : String(value || '未分类').trim()
}
