import { readFileSync } from 'node:fs'
import { stripGeneratedSkin } from './skin-bundle.mjs'
// Settings now have one shipped implementation. Tests that also inspect classic
// helpers include that implementation once instead of counting three copies.
export function shippedSettings(source) {
  const marker='    // ===== ITER5-LEGACY-GENERATED:END ====='
  const from=source.indexOf('function Iter5Settings(props) {',source.indexOf(marker)+marker.length)
  const to=source.indexOf('function Iter5Storage(props) {',from)
  if(from<0 || to<from)throw Error('shared shipped settings implementation missing')
  return source.slice(from,to)
}
export function sharedSettingsClient(source) { return stripGeneratedSkin(source)+(source.includes('\r\n')?'\r\n':'\n')+shippedSettings(source) }
export function canonicalSettings() { return readFileSync(new URL('../../skins/iter5/settings-source.js',import.meta.url),'utf8') }
