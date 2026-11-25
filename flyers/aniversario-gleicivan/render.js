const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
await p.goto('file://'+process.cwd()+'/'+(process.argv[3]||'flyer.html'));await p.evaluate(()=>document.fonts.ready);
const r=await p.evaluate(()=>window.centerScript?window.centerScript():null); if(r) console.log(JSON.stringify(r));
await p.waitForTimeout(400);await p.screenshot({path:process.argv[2]||'flyer.png'});await b.close();})();
