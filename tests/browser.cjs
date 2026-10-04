// Optional real-browser regression: npm install --no-save playwright; npx playwright install chromium
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{if(!localStorage.getItem('commonnote-scores-v1')){localStorage.setItem('commonnote-scores-v1',JSON.stringify([{id:'legacy',title:'Old saved score',abc:'X:1\nT:Old saved score\nM:4/4\nL:1/4\nK:C\nC4 |]',updated:1}]));localStorage.setItem('commonnote-favorites-v1','["ode","mutopia-263"]')}});
 await page.goto(process.env.FRETFREE_URL||'http://localhost:8000');
 assert.ok(await page.evaluate(()=>catalog.length>=800));
 const source='X:1\nT:Browser test\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC D E F | G4 | c4 |]';
 for(const instrument of ['Flute','Clarinet in B♭','Alto sax in E♭','Cello']){
  await page.evaluate(({source,instrument})=>{openScore({abc:source,instrument});window.scrollTo({top:0,behavior:'instant'})},{source,instrument});
  const head=page.locator('#notation .abcjs-notehead').first();await head.scrollIntoViewIfNeeded();let box=await head.boundingBox();assert.ok(box);
  const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.click(x,y);
  assert.equal(await page.evaluate(()=>$('abc').value.slice($('abc').selectionStart,$('abc').selectionEnd).trim()),'C');
  box=await head.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-12,{steps:8});await page.mouse.up();
  assert.ok(await page.evaluate(()=>parseMidi(midiBytes($('abc').value)).notes[0].note>60),'Mouse upward raises source pitch: '+instrument);
  assert.equal(await page.locator('#warnings').textContent(),'');
 }
 // Drag ratio: 10 screen px per staff step, steady under sideways jitter, and finished even when released outside the score.
 await page.evaluate(({source})=>{openScore({abc:source,instrument:'Flute'});window.scrollTo({top:0,behavior:'instant'})},{source});
 {const head=page.locator('#notation .abcjs-notehead').first();await head.scrollIntoViewIfNeeded();const box=await head.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=20;i++)await page.mouse.move(x+(i%2?3:-3),y+40*i/20);await page.mouse.up();
  assert.match(await page.evaluate(()=>$('abc').value),/\nF, D E F \|/,'40px down lowers exactly four staff steps')}
 await page.evaluate(({source})=>{openScore({abc:source,instrument:'Flute'});$('start-measure').value=1},{source});await page.click('#play');await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#notation .abcjs-playing')].filter(e=>e.classList.contains('abcjs-note')).length),1,'Sounding note lights up');
 await page.click('#stop');assert.equal(await page.locator('#notation .abcjs-playing').count(),0,'Stop clears highlight');
 // Draw mode: a click on the middle line between notes 2 and 3 adds a one-beat B4; the note menu edits it.
 await page.evaluate(({source})=>{openScore({abc:source,instrument:'Flute'});window.scrollTo({top:0,behavior:'instant'})},{source});await page.click('#draw-mode');
 {const [x,y]=await page.evaluate(()=>{const svg=$('notation').querySelector('svg'),st=renderedTune.engraver.staffgroups[0].staffs[0],[a,b]=renderedTune.engraver.selectables.slice(1,3).map(s=>{const r=s.svgEl.getBBox();return r.x+r.width/2});const p=new DOMPoint((a+b)/2,st.absoluteY-6*93/24).matrixTransform(svg.getScreenCTM());return [p.x,p.y]});
  await page.mouse.click(x,y);assert.match(await page.evaluate(()=>$('abc').value),/\nC D B E F \|/,'Draw adds a quarter note at the clicked pitch and position')}
 await page.click('#draw-mode');
 for(const [label,expected] of [['♯ Sharp',/C D \^B E/],['Half',/C D \^B2 E/],['Dotted',/C D \^B3 E/],['Delete note',/C D E F/]]){
  await page.locator('#notation .abcjs-notehead').nth(2).click({button:'right',force:true});await page.locator('#note-menu button',{hasText:label}).click();
  assert.match(await page.evaluate(()=>$('abc').value),expected,'Note menu: '+label);
 }
 await page.evaluate(({source})=>{openScore({abc:source,instrument:'Flute'});$('start-measure').value=3;window.scrollTo({top:0,behavior:'instant'})},{source});
 await page.click('#play');assert.match(await page.locator('#play-status').textContent(),/From measure 3/);
 await page.evaluate(()=>$('speed').value=75);await page.locator('#speed').dispatchEvent('input');assert.equal(await page.locator('#speed-value').textContent(),'75%');
 assert.equal(await page.evaluate(()=>$('abc').value),source,'Speed preserves Q/source');await page.click('#stop');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('commonnote-scores-v1'))[0].id),'legacy');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('commonnote-favorites-v1'))),['ode','mutopia-263']);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile page fits viewport');
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: native mouse clicks and upward drags across instruments, drag ratio, playback note highlight, draw mode, note properties menu, measure playback, live percent speed, legacy storage, mobile width, and no browser errors.');
})().catch(e=>{console.error(e);process.exit(1)});
