/**
 * 皮肤资源清单(skin-assets)—— **纯数据 + 一个取值函数**,零 IO、零依赖、零副作用。
 *
 * 三条纪律(源自 docs/teamwork-impl/12-皮肤资源插口清单.md §4):
 *  ① **代码只认 key,不认文件** —— 结构代码一律 assetOf('<key>'),不出现任何路径拼接/通配/import;
 *     `file` / `fileDark` 是全模块**唯一**的资源引用入口;空串 = 未就绪 ⇒ 走确定性占位分支。
 *  ② **占位必须「像成品」** —— 占位样式由 CSS 承担(同尺寸、同构图、同色调,见该文档纪律二),
 *     本模块只负责给出**确定性**占位对象:不抛错、不留白、不改结构。
 *  ③ **每张图必须带尺寸** —— `size` 是版位预留(防布局跳动)与生图构图的唯一依据。
 *
 * 换图 = 改 `file` 一行(如 `file: 'hero.welcome.png'`),结构代码零改动。
 * ★2026-09-27 S2 收口:6 槽位**全部填充** —— 6 张浅色图逐像素符合 12 卷尺寸要求,已物理复核
 *   (PNG IHDR 直读,见 docs/teamwork-impl/64-S2皮肤通路接通与验收.md §二);
 *   深色版 2 槽位(`bg.mindmap` / `hero.welcome`)填 `fileDark`(WebP,同尺寸),其余 4 槽位深色
 *   回落到浅色 `file` —— 不新增占位(无深色素材时浅色图仍可用,且避免 4 张空占位)。
 */

/** 6 个插口:key = 槽位,value = { file, fileDark, alt, size, status }。 */
export const SKIN_ASSETS = Object.freeze({
  /** page-welcome 首屏主视觉:抽象「记忆网络/思维星图」氛围图,左侧留 40% 空白放文案,不要出现文字。 */
  'hero.welcome':   { file: 'slots/hero.welcome.png',   fileDark: 'slots-dark/hero.welcome.webp',   alt: '欢迎主视觉',       size: [1600, 1000], status: 'ready' },
  /** page-library 空状态:空的收纳盒/空书架,要有「轻盈、可填满」的感觉。 */
  'empty.library':  { file: 'slots/empty.library.png',  fileDark: '',                               alt: '记忆库空状态',     size: [800, 600],   status: 'ready' },
  /** page-timeline 空状态:一条未点亮的轨迹/路的起点,暗示「接下来会发生」。 */
  'empty.timeline': { file: 'slots/empty.timeline.png', fileDark: '',                               alt: '时间线空状态',     size: [800, 600],   status: 'ready' },
  /** page-recall 空状态:放大镜下的空白/刚清扫过的桌面,干净、安静。 */
  'empty.recall':   { file: 'slots/empty.recall.png',   fileDark: '',                               alt: '召回审查空状态',   size: [800, 600],   status: 'ready' },
  /** page-mindmap 背景:极淡的神经元/星系纹理,对比度必须很低,单色/近单色。 */
  'bg.mindmap':     { file: 'slots/bg.mindmap.png',     fileDark: 'slots-dark/bg.mindmap.webp',     alt: '思维导图背景',     size: [2000, 1400], status: 'ready' },
  /** page-home 同步状态卡:两台设备之间的双向箭头 + 光点流动,横向构图。 */
  'illust.sync':    { file: 'slots/illust.sync.png',    fileDark: '',                               alt: '同步示意',         size: [600, 400],   status: 'ready' },
})

function toText(value) {
  if (value === null || value === undefined) return ''
  try { return String(value).trim() } catch (_) { return '' }
}

/**
 * 取资源:未就绪 / 未知 key 一律返回**确定性占位**;永不抛、不留白。
 *  · 未就绪 → { placeholder:true,  key, alt }   —— 与文档 §4 占位分支一致
 *  · 已就绪 → { placeholder:false, url, alt }    —— url 即 file(或 deep 为真时的 fileDark || file)
 * @param {string} key  6 个插口之一
 * @param {boolean} [deep]  true = 优先取深色素材;无深色素材(空串)时**自动回落浅色**(不产占位)
 */
export function assetOf(key, deep) {
  let name = key
  let entry = null
  try {
    name = toText(key)
    entry = name ? SKIN_ASSETS[name] : null
  } catch (_) { entry = null }
  if (!entry) return { placeholder: true, key: name, alt: name }
  let file = toText(entry.file)
  if (deep === true) {
    const dark = toText(entry.fileDark)
    if (dark) file = dark          // ★只认 fileDark;空串 ⇒ 回落浅色(不把「无深色素材」当成未就绪)
  }
  if (!file) return { placeholder: true, key: name, alt: entry.alt || name }
  return { placeholder: false, url: file, alt: entry.alt, size: entry.size, deep: deep === true }
}

/** 6 个 key 的稳定顺序(供路由白名单与前端遍历;不进 SKIN_ASSETS 本体,避免污染 6 键表)。 */
export const SKIN_ASSET_KEYS = Object.freeze([
  'hero.welcome', 'empty.library', 'empty.timeline', 'empty.recall', 'bg.mindmap', 'illust.sync',
])

/** 资源根目录(相对插件根)—— 路由与消费点**共用**这一个常量,不许各写一份。 */
export const SKIN_ASSET_ROOT = 'assets/skin'
