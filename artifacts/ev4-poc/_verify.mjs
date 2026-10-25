
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const HERE='D:/dsh-auto-memory/artifacts/ev4-poc';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitJson(u,t=90){for(let i=0;i<t;i++){try{const r=await fetch(u);if(r.ok)return await r.json();}catch(e){}await sleep(200);}throw new Error('cdp');}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.onmessage=e=>this.onMsg(e.data);}
static async connect(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});return new CDP(ws);}
onMsg(d){const m=JSON.parse(d);if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}}
send(m,p={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;}}
const port=9448, profile=path.join(HERE,'.cdp3-'+Date.now());
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1600,1000','--remote-debugging-port='+port,'--user-data-dir='+profile,'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
const out={steps:[]};
const shot=async(cdp,name)=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});const p=path.join(HERE,name);fs.writeFileSync(p,Buffer.from(r.data,'base64'));return fs.statSync(p).size;};
try{
  await waitJson('http://127.0.0.1:'+port+'/json/version');
  const list=await waitJson('http://127.0.0.1:'+port+'/json/list');
  const cdp=await CDP.connect(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:'file:///'+path.join(HERE,'index.html').replace(/\\/g,'/')});
  await sleep(2600);
  out.initial = await cdp.eval('({cards:document.querySelectorAll(".card").length,ticks:document.querySelectorAll(".tick").length,cols:getComputedStyle(document.querySelector(".layout")).gridTemplateColumns,railW:Math.round(document.querySelector(".rail").getBoundingClientRect().width),detailW:Math.round(document.querySelector(".detail").getBoundingClientRect().width),detailOpen:document.querySelector(".detail")?document.querySelector(".detail").getBoundingClientRect().width>100:null})');

  // 1) drag the splitter? prototype has none -> resize rail wide/narrow test (user asked "两栏可调小/增大")
  out.resizeProbe = await cdp.eval('(function(){try{var r=document.documentElement.style;r.setProperty("--rail-w","240px");var w=Math.round(document.querySelector(".rail").getBoundingClientRect().width);r.setProperty("--rail-w","420px");var w2=Math.round(document.querySelector(".rail").getBoundingClientRect().width);r.removeProperty("--rail-w");return {narrow:w,wide:w2,adjustable:(w!==w2)};}catch(e){return "ERR "+e}})()');

  // 2) collapse detail (抽屉)
  out.collapse = await cdp.eval('(function(){var b=document.getElementById("dtoggle"); if(!b) return "no-btn"; b.click(); return new Promise(function(res){setTimeout(function(){res({cols:getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, detailW:Math.round(document.querySelector(".detail").getBoundingClientRect().width), ls:localStorage.getItem("damEv4.detailOpen")});},700);});})()');
  out.shotCollapsed = await shot(cdp,'poc-05-detail-collapsed.png');
  await cdp.eval('document.getElementById("dtoggle").click()');
  await sleep(700);

  // 3) dark / light toggle
  out.themeDark = await cdp.eval('({theme:document.getElementById("ev4-app").dataset.theme, bg:getComputedStyle(document.getElementById("ev4-app")).backgroundColor})');
  await cdp.eval('document.getElementById("themebtn").click()');
  await sleep(400);
  out.themeLight = await cdp.eval('({theme:document.getElementById("ev4-app").dataset.theme, bg:getComputedStyle(document.getElementById("ev4-app")).backgroundColor, card:getComputedStyle(document.querySelector(".card")).backgroundColor, ink:getComputedStyle(document.querySelector(".card .ttl")).color})');
  out.shotLight = await shot(cdp,'poc-06-light.png');
  await cdp.eval('document.getElementById("themebtn").click()');
  await sleep(300);

  // 4) font scale
  out.fs = await cdp.eval('(function(){var before=getComputedStyle(document.querySelector(".card .ttl")).fontSize; document.querySelector(".fsctl button[data-fs=\\"2\\"]").click(); var after=getComputedStyle(document.querySelector(".card .ttl")).fontSize; return {before:before,after:after};})()');
  await cdp.eval('document.querySelector(".fsctl button[data-fs=\\"1\\"]").click()');

  // 5) lazy load earlier
  out.lazy = await cdp.eval('(function(){var b=document.getElementById("lm-more"); if(!b) return "no-btn"; var before=document.querySelectorAll(".card").length; b.click(); return new Promise(function(res){setTimeout(function(){res({before:before,after:document.querySelectorAll(".card").length,cnt:(document.getElementById("lm-cnt")||{}).textContent});},500);});})()');

  // 6) search filter
  out.filter = await cdp.eval('(function(){var q=document.getElementById("q"); q.value="ZCode"; q.dispatchEvent(new Event("input")); return new Promise(function(res){setTimeout(function(){res({cards:document.querySelectorAll(".card").length, visible:Array.from(document.querySelectorAll(".card")).filter(function(c){return c.style.display!=="none"}).length, cnt:(document.getElementById("cnt")||{}).textContent});},400);});})()');
  out.shotFilter = await shot(cdp,'poc-07-filter.png');
  await cdp.eval('(function(){var q=document.getElementById("q"); q.value=""; q.dispatchEvent(new Event("input"));})()');
  await sleep(500);

  // 7) deep link
  out.deeplink = await cdp.eval('(function(){location.hash="#evt-050"; return new Promise(function(res){setTimeout(function(){res({hash:location.hash, cur:window.__wb&&window.__wb.curId, sel:document.querySelectorAll(".card.on").length});},600);});})()');

  // 8) narrow viewport
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:480,height:900,deviceScaleFactor:1,mobile:true});
  await sleep(700);
  out.narrow = await cdp.eval('({iw:innerWidth, scrollW:document.documentElement.scrollWidth, railPos:getComputedStyle(document.querySelector(".rail")).position, detailPos:getComputedStyle(document.querySelector(".detail")).position})');
  out.shotNarrow = await shot(cdp,'poc-08-narrow.png');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});

  // 9) grip drag: rail
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await sleep(400);
  out.grip = await cdp.eval('(function(){var g=document.querySelector(".ev4-grip--rail"); if(!g) return "no-grip"; var before=Math.round(document.querySelector(".rail").getBoundingClientRect().width); var r=g.getBoundingClientRect(); function pe(t,x){return new PointerEvent(t,{bubbles:true,clientX:x,clientY:300,pointerId:1})} g.dispatchEvent(pe("pointerdown",r.left+4)); g.dispatchEvent(pe("pointermove",r.left+104)); g.dispatchEvent(pe("pointerup",r.left+104)); var after=Math.round(document.querySelector(".rail").getBoundingClientRect().width); return {before:before,after:after,ls:localStorage.getItem("damEv4.railW")};})()');
  await sleep(300);
  out.shotGrip = await shot(cdp,'poc-09-grip-wide-rail.png');
  out.gripReset = await cdp.eval('(function(){var g=document.querySelector(".ev4-grip--rail"); g.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})); return Math.round(document.querySelector(".rail").getBoundingClientRect().width);})()');
  // 10) font scale (rem scoped)
  out.fs2 = await cdp.eval('(function(){var el=document.querySelector(".card .ttl"); var b=getComputedStyle(el).fontSize; document.querySelector(".fsctl button[data-fs=\\"2\\"]").click(); var a=getComputedStyle(el).fontSize; document.querySelector(".fsctl button[data-fs=\\"1\\"]").click(); return {before:b,after:a,changed:b!==a};})()');
  out.shots = fs.readdirSync(HERE).filter(f=>f.startsWith('poc-')&&f.endsWith('.png')).map(f=>({f,bytes:fs.statSync(path.join(HERE,f)).size}));
}catch(e){out.fatal=String(e&&e.stack||e)}finally{try{chrome.kill()}catch(e){}}
console.log(JSON.stringify(out,null,1));
