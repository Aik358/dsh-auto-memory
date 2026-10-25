/**
 * smoke-test-p3-fullpage-height.mjs —— P3 全屏高度纯函数（档 1 · Lead 裁决签名）
 *
 * 签名（Lead 裁决）：computeFullpageHeightPre(areaH, padT, padB, composerTop, elTop, fullpageOn) ⇒ number
 *
 * ★为什么抽纯函数：真因排查要求「composer 隐藏后 rect 是否异常」可复算；
 *   浏览器里的 rect 取值不可控，但**决策逻辑**可以 100% 单测。
 *
 * ★核心决策（Lead 裁决，不依赖实测）：全屏态的语义就是「composer 已被隐藏」，
 *   在这个态里用 composer 几何约束高度，无论 rect 返回 0 还是真实值都是逻辑错误：
 *     返回 0     → 「碰巧不生效」（潜在脆弱）
 *     返回真实值 → 「压缩高度」（当前症状）
 *   ⇒ 夹取**限定在非全屏态**。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const ROOT = 'D:/dsh-auto-memory'
const CL = fs.readFileSync(path.join(ROOT,'lib/client.js'),'utf8')
let pass=0,fail=0;
const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   - '+m+(x?' :: '+x:''))}else{fail++;console.log('  FAIL - '+m+(x?' :: '+x:''))}};

function extractFn (src, name) {
  let idx = src.indexOf('function ' + name + '(');
  if (idx < 0) return null;
  const o = src.indexOf('{', idx);
  let d=1,i=o+1,s=null,e=false;
  for(;i<src.length;i++){const c=src[i];
    if(e){e=false;continue}
    if(c===String.fromCharCode(92)){e=true;continue}
    if(s){if(c===s)s=null;continue}
    if(c==='"'||c==="'"||c===String.fromCharCode(96)){s=c;continue}
    if(c==='{')d++;else if(c==='}'){d--;if(d===0){i++;break}}}
  return src.slice(idx,i);
}

console.log(''); console.log('== 1. 纯函数存在且按 Lead 签名可抽取 ==');
const fnSrc = extractFn(CL,'computeFullpageHeightPre')
ok(!!fnSrc,'★★① 可抽取','len='+(fnSrc?fnSrc.length:0))
ok(/function computeFullpageHeightPre\(areaH, padT, padB, composerTop, elTop, fullpageOn\)/.test(fnSrc),'★★① 签名与 Lead 裁决**逐字一致**')
const ctx=vm.createContext({});
vm.runInContext(fnSrc+';globalThis.__F=computeFullpageHeightPre;',ctx);
const F=ctx.__F;
ok(typeof F==='function','★★① 真执行得到函数')

console.log(''); console.log('== 2. 档 1 表驱动（Lead 给出的全部期望值）==');
const CASES = [
  { n:'正路径·全屏态不吃 composer 夹取', a:[800,0,0,720,60,true],  want:800 },
  { n:'正路径·非全屏态夹到 composer 上方 −8', a:[800,0,0,720,60,false], want:652 },
  { n:'负路径A·composerTop=0（display:none 情形）+ 非全屏', a:[800,0,0,0,60,false], want:800 },
  { n:'负路径B·composerTop < elTop ⇒ 不夹取', a:[800,0,0,40,60,false], want:800 },
  { n:'下界·areaH=100 ⇒ 160', a:[100,0,0,0,0,true], want:160 },
];
for (const c of CASES) {
  const got = F.apply(null, c.a);
  ok(got === c.want, '★★★② ' + c.n, 'F(' + c.a.join(',') + ') = ' + got + ' want ' + c.want);
}

console.log(''); console.log('== 3. 补充边界（padding / 非数字 / 负数）==');
ok(F(800,20,30,720,60,true)===750,'★★③ 扣 padding（800-20-30=750）','got '+F(800,20,30,720,60,true));
ok(F(NaN,0,0,0,0,true)===160,'★★③ areaH=NaN ⇒ 160（不产出 NaN）','got '+F(NaN,0,0,0,0,true));
ok(F(800,null,undefined,0,0,true)===800,'★★③ pad 为 null/undefined ⇒ 按 0','got '+F(800,null,undefined,0,0,true));
ok(F(800,0,0,-5,60,false)===800,'★★③ composerTop 负值 ⇒ 不夹','got '+F(800,0,0,-5,60,false));
ok(F(800,0,0,720,60,false)===652,'★★③ 非全屏夹取边界值复核','got '+F(800,0,0,720,60,false));

console.log(''); console.log('== 4. ★变异：删掉 !fullpageOn 条件 ⇒ 第一条必红 ==');
const mut = fnSrc.replace('if (!fullpageOn && Number(composerTop) > 0', 'if (Number(composerTop) > 0')
ok(mut !== fnSrc, '★★★[变异] 成功删掉 !fullpageOn 条件')
const mctx=vm.createContext({});
vm.runInContext(mut+';globalThis.__F=computeFullpageHeightPre;',mctx);
const MF=mctx.__F;
const m1 = MF(800,0,0,720,60,true);
ok(m1 !== 800, '★★★[变异] 变异版 F(800,0,0,720,60,true) = ' + m1 + '（≠800）⇒ 上面「全屏不夹」判据必红')

console.log(''); console.log('== 5. client.js 接线：fit() 真调用 + 观测属性 ==');
ok(CL.indexOf('computeFullpageHeightPre(')>=0,'★★⑤ fit() 调用纯函数')
ok(CL.indexOf("'data-dam-fit-h'")>=0,'★★⑤ 写 data-dam-fit-h（真 Chrome 可直读实测 px）')
ok(CL.indexOf("'data-dam-fit-fullpage'")>=0,'★★⑤ 写 data-dam-fit-fullpage（可观测判定分支）')
ok(CL.indexOf("document.body.getAttribute('data-dam-fullpage') === 'true'")>=0,'★★⑤ fit() 真读 body[data-dam-fullpage]')
ok(CL.indexOf('padTop, padB, hostTop')<0,'★★⑤ 旧签名已无残留')

console.log(''); console.log('SUMMARY  PASS '+pass+' / FAIL '+fail);
if(fail>0)process.exit(1);