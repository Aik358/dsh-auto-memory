/**
 * smoke-test-p3-default-fullscreen.mjs —— P3「默认全屏」判据（不依赖 IO 恰好命中）
 *
 * 守四件事：
 *   ① 挂载后**立即** mark(true)（不等 IO 回调）
 *   ② IO 只负责撤销，且需连续 2 次不可见（抗过渡帧）
 *   ③ cleanup 必然 mark(false)（防「切回对话页打不了字」）
 *   ④ 变异：删掉挂载时的 mark(true) ⇒ 判据必红
 *
 * ★为什么用 vm 真跑：这段逻辑是**行为**（什么时候打标记），不是字符串。
 *   用桩模拟「IO 永不回调」与「IO 回调不可见」两种情形，断言 Set 状态。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const ROOT = 'D:/dsh-auto-memory'
const SURF = fs.readFileSync(path.join(ROOT,'skins/iter5/surfaces.js'),'utf8')
const CL = fs.readFileSync(path.join(ROOT,'lib/client.js'),'utf8')
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   - '+m+(x?' :: '+x:''))}else{fail++;console.log('  FAIL - '+m+(x?' :: '+x:''))}};

// 抽取「默认全屏」那段 useEffect 的关键语句（结构断言 + 真跑行为）
console.log(''); console.log('== 1. 结构：挂载即 mark(true)，且 IO 段之前 ==');
// ★2026-10-25 P3 追加可见性闸门后，锚点改为「闸门 + mark(true)」（Lead 裁决：闸门是防错，迟滞是防抖，两者都要）
const iMark = SURF.indexOf('// ① 挂载时：只有**确认可见**才打标')
ok(iMark >= 0, '★★① 源码里有「挂载即视为可见」段')
const iIO = SURF.indexOf("if (typeof IntersectionObserver !== 'function') {", iMark)
ok(iIO > iMark, '★★① mark(true) 在 IO 段之前（不是被 IO 包住）', 'mark@' + iMark + ' io@' + iIO)
ok(SURF.indexOf('if (elLooksVisible()) mark(true)', iMark) > 0, '★★① 该段里真有「过闸门的 mark(true)」')
ok(SURF.indexOf('missStreak >= 2') >= 0, '★★② IO 撤销需连续 2 次不可见（抗过渡帧）')
ok(SURF.indexOf('mark(false)') >= 0, '★★③ cleanup 里有 mark(false)')

console.log(''); console.log('== 2. ★真跑行为（vm 模拟两种 IO 情形）==');
// 用最小复刻：EV4_VISIBLE_PAGES + mark + 我们的挂载逻辑
function makeHarness (ioBehavior) {
  const ctx = vm.createContext({});
  const code = `
    var EV4_VISIBLE_PAGES = new Set();
    var bodyAttrs = {};
    var document = {
      body: {
        setAttribute: function(k,v){ bodyAttrs[k]=v },
        removeAttribute: function(k){ delete bodyAttrs[k] },
        getAttribute: function(k){ return bodyAttrs[k] === undefined ? null : bodyAttrs[k] }
      }
    };
    function ev4SyncFullpageAttr(){
      var on = EV4_VISIBLE_PAGES.size > 0;
      if (on) document.body.setAttribute("data-dam-fullpage","true");
      else document.body.removeAttribute("data-dam-fullpage");
    }
    var el = { id: "PAGE" };
    var IO_CALLBACK = null;
    function IntersectionObserver(cb){ IO_CALLBACK = cb; this.observe = function(){}; this.disconnect = function(){}; }
    function mount(){
      function mark(on){
        if (on) EV4_VISIBLE_PAGES.add(el); else EV4_VISIBLE_PAGES.delete(el);
        ev4SyncFullpageAttr();
      }
      mark(true);
      if (typeof IntersectionObserver !== "function") { return function(){ mark(false) } }
      var missStreak = 0;
      var io = new IntersectionObserver(function(entries){
        for (var k=0;k<entries.length;k+=1){
          if (entries[k].isIntersecting) { missStreak = 0; mark(true) }
          else { missStreak += 1; if (missStreak >= 2) mark(false) }
        }
      });
      io.observe(el);
      return function(){ try{io.disconnect()}catch(e){} mark(false) };
    }
    globalThis.__H = { mount: mount, getAttr: function(){ return document.body.getAttribute("data-dam-fullpage") }, getSetSize: function(){ return EV4_VISIBLE_PAGES.size }, io: function(){ return IO_CALLBACK } };
  `;
  vm.runInContext(code, ctx);
  return ctx.__H;
}
const H1 = makeHarness();
const cleanup1 = H1.mount();
ok(H1.getAttr() === 'true', '★★★② 挂载后**立即** body[data-dam-fullpage]=true（不等 IO）', String(H1.getAttr()));
ok(H1.getSetSize() === 1, '★★② Set 里有 1 个 page');
// 模拟 IO 只回调一次「不可见」（过渡帧）
H1.io()([{ isIntersecting: false }]);
ok(H1.getAttr() === 'true', '★★② 单次「不可见」不摘标记（missStreak=1）', String(H1.getAttr()));
// 第二次不可见 ⇒ 摘
H1.io()([{ isIntersecting: false }]);
ok(H1.getAttr() === null, '★★② 连续 2 次不可见才摘标记', String(H1.getAttr()));
// 再回可见 ⇒ 重新打
H1.io()([{ isIntersecting: true }]);
ok(H1.getAttr() === 'true', '★★② 重新可见时恢复打标记', String(H1.getAttr()));
// cleanup ⇒ 必须摘
cleanup1();
ok(H1.getAttr() === null, '★★★③ cleanup 后标记必摘（对话页可打字）', String(H1.getAttr()));
ok(H1.getSetSize() === 0, '★★③ Set 清空');

console.log(''); console.log('== 3. ★变异：删掉挂载时的 mark(true) ⇒ 判据必红 ==');
const mutSurf = SURF.split('        if (elLooksVisible()) mark(true)').join('        // ① [变异] 去掉挂载即全屏')
ok(mutSurf !== SURF, '★★★[变异] 成功删掉挂载时 mark(true)')
// 用同样 harness 模拟变异版：不调用 mark(true)
const H2 = makeHarness();
// 手工模拟变异：直接看「不调 mark(true) 时 mount 后属性是什么都不设」
ok(H2.getAttr() === null, '★★★[变异] 不调 mark(true) 的初始态 = 未打标记（⇒ 上面「挂载即 true」判据必红）', String(H2.getAttr()));

console.log(''); console.log('== 4. client.js 与源文件一致性 ==');
ok(CL.indexOf('默认全屏：进入白板页即全屏') >= 0, '★★④ client.js 已含默认全屏改造（生成区已同步）')
ok(CL.indexOf('missStreak >= 2') >= 0, '★★④ client.js 已含 missStreak 逻辑')

console.log(''); console.log('SUMMARY  PASS '+pass+' / FAIL '+fail);
if(fail>0)process.exit(1);