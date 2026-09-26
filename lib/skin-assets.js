/**
 * 皮肤资源清单(skin-assets)—— **纯数据 + 一个取值函数**,零 IO、零依赖、零副作用。
 *
 * 三条纪律(源自 docs/teamwork-impl/12-皮肤资源插口清单.md §4):
 *  ① **代码只认 key,不认文件** —— 结构代码一律 assetOf('<key>'),不出现任何路径拼接/通配/import;
 *     `file` 是全模块**唯一**的资源引用入口,初始为 ''(未就绪)⇒ 首版必然走占位分支。
 *  ② **占位必须「像成品」** —— 占位样式由 CSS 承担(同尺寸、同构图、同色调,见该文档纪律二),
 *     本模块只负责给出**确定性**占位对象:不抛错、不留白、不改结构。
 *  ③ **每张图必须带尺寸** —— `size` 是版位预留(防布局跳动)与生图构图的唯一依据。
 *
 * 换图 = 改 `file` 一行(如 `file: 'hero-welcome.png'`),结构代码零改动。
 * 6 个 key 与 12-皮肤资源插口清单.md §2 的表**逐条一致**(key / alt / size 三项)。
 */

/** 6 个插口:key = 槽位,value = { file, alt, size, status }。 */
export const SKIN_ASSETS = Object.freeze({
  /** page-welcome 首屏主视觉:抽象「记忆网络/思维星图」氛围图,左侧留 40% 空白放文案,不要出现文字。 */
  'hero.welcome':   { file: '', alt: '欢迎主视觉',     size: [1600, 1000], status: 'pending' },
  /** page-library 空状态:空的收纳盒/空书架,要有「轻盈、可填满」的感觉。 */
  'empty.library':  { file: '', alt: '记忆库空状态',   size: [800, 600],   status: 'pending' },
  /** page-timeline 空状态:一条未点亮的轨迹/路的起点,暗示「接下来会发生」。 */
  'empty.timeline': { file: '', alt: '时间线空状态',   size: [800, 600],   status: 'pending' },
  /** page-recall 空状态:放大镜下的空白/刚清扫过的桌面,干净、安静。 */
  'empty.recall':   { file: '', alt: '召回审查空状态', size: [800, 600],   status: 'pending' },
  /** page-mindmap 背景:极淡的神经元/星系纹理,对比度必须很低,单色/近单色。 */
  'bg.mindmap':     { file: '', alt: '思维导图背景',   size: [2000, 1400], status: 'pending' },
  /** page-home 同步状态卡:两台设备之间的双向箭头 + 光点流动,横向构图。 */
  'illust.sync':    { file: '', alt: '同步示意',       size: [600, 400],   status: 'pending' },
})

function toText(value) {
  if (value === null || value === undefined) return ''
  try { return String(value).trim() } catch (_) { return '' }
}

/**
 * 取资源:未就绪 / 未知 key 一律返回**确定性占位**;永不抛、不留白。
 *  · 未就绪 → { placeholder:true,  key, alt }   —— 与文档 §4 占位分支一致
 *  · 已就绪 → { placeholder:false, url, alt }    —— url 即 SKIN_ASSETS[key].file
 * @param {string} key 6 个插口之一
 */
export function assetOf(key) {
  let name = key
  let entry = null
  try {
    name = toText(key)
    entry = name ? SKIN_ASSETS[name] : null
  } catch (_) { entry = null }
  if (!entry || !entry.file) return { placeholder: true, key: name, alt: (entry && entry.alt) || name }
  return { placeholder: false, url: entry.file, alt: entry.alt }
}
