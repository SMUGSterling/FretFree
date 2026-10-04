// Integration with the real engraving library. Install jsdom as a dev dependency to run.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const root=path.resolve(__dirname,'..');const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',url:'http://localhost:8000'});
const w=dom.window,ctx=dom.getInternalVMContext(),run=s=>vm.runInContext(s,ctx);
w.SVGElement.prototype.getBBox=function(){return {x:0,y:0,width:Math.max(1,(this.textContent||'').length*7),height:14}};
w.scrollTo=()=>{};w.confirm=()=>true;
const legacy={id:'legacy',title:'Saved before update',abc:'X:1\nT:Saved before update\nM:4/4\nL:1/4\nK:C\nC4 |]',updated:1};
w.localStorage.setItem('commonnote-scores-v1',JSON.stringify([legacy]));w.localStorage.setItem('commonnote-favorites-v1','["ode","mutopia-263"]');
const oscillators=[];
class FakeAudio{constructor(){this.currentTime=10;this.destination={}}async resume(){}createOscillator(){const o={frequency:{value:0},connect(){},start(t){this.startAt=t},stop(t){this.stopAt=t}};oscillators.push(o);return o}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}}}}
w.AudioContext=FakeAudio;
for(const f of ['vendor/abcjs-basic-min.js','catalog.js','catalog-expanded.js','score-tools.js','rights-tools.js','catalog-licensed.js','app.js'])run(fs.readFileSync(path.join(root,f),'utf8'));
const source='% Unicode ♫\n\nX:1\nT:Click and drag\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\n|: C D E F | G4 :| c4 |]';
for(const instrument of Object.keys(run('instruments'))){
 run(`openScore({abc:${JSON.stringify(source)},instrument:${JSON.stringify(instrument)}})`);
 const entries=run('scoreEvents(renderedTune).filter(e=>e.element.el_type==="note")');
 for(let i=0;i<entries.length;i++){
  run(`scoreClick(scoreEvents(renderedTune).filter(e=>e.element.el_type==='note')[${i}].element,0,[],{},null)`);
  assert.equal(run("$('abc').value.slice($('abc').selectionStart,$('abc').selectionEnd)"),source.slice(run(`[...noteSources.values()].filter(e=>e?.element.el_type==='note')[${i}].element.startChar`),run(`[...noteSources.values()].filter(e=>e?.element.el_type==='note')[${i}].element.endChar`)));
 }
 run("scoreClick(scoreEvents(renderedTune).find(e=>e.element.pitches).element,0,[],{},{step:-1})");
 assert.match(run("$('abc').value"),/\|: D D E F/,'Up one visual staff step raises the source pitch for '+instrument);
 assert.equal(run("$('abc').selectionStart"),source.indexOf(' C D E F'));
 assert.equal(run("$('warnings').textContent"),'');
}
assert.equal(run(`moveNoteText('"Am"!accent!{a}[=CEG]2-',1)`),'"Am"!accent!{a}[=DFA]2-');
assert.equal(run(`moveNoteText('B,2 c/2 ^f-',1)`),'C2 d/2 ^g-');
async function checkPlayback(){
 run(`openScore({abc:${JSON.stringify(source)},instrument:'Flute'});$('start-measure').value=3;$('speed').value=50`);
 assert.equal(run('measureStarts.get(3)'),9.6,'Measure after repeated section uses performed timing');
 const before=run("$('abc').value");oscillators.length=0;await run('play()');
 assert.equal(oscillators.length,1,'Start after repeats skips earlier notes');
 assert.equal(oscillators[0].frequency.value,440*2**((72-69)/12));
 assert.ok(Math.abs(oscillators[0].stopAt-oscillators[0].startAt-4.83)<.001,'50% doubles note time');run('stop()');
 assert.equal(run("$('abc').value"),before,'Playback settings never change source tempo');
 const tempo='X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC4 | [Q:1/4=50]D4 | E4 |]';
 run(`openScore({abc:${JSON.stringify(tempo)}})`);assert.equal(run('measureStarts.get(3)'),7.2);
 const pickup='X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC | D4 | E4 |]';
 run(`openScore({abc:${JSON.stringify(pickup)}})`);assert.equal(run('measureStarts.get(2)'),.6,'Pickup counted as measure one');
 const tied='X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC4- | C4 | D4 |]';
 run(`openScore({abc:${JSON.stringify(tied)}});$('start-measure').value=2;$('speed').value=100`);oscillators.length=0;await run('play()');assert.ok(oscillators.length>0,'Tied note resumes at measure boundary');assert.ok(Math.abs(oscillators[0].stopAt-oscillators[0].startAt-2.43)<.001);run('stop()');
 assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')),[legacy]);
 assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')),['ode','mutopia-263']);
 run("openScore(saved[0],saved[0].id);$('save').onclick()");assert.equal(run('saved.length'),1,'Save updates existing score identity');
 console.log('PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, repeats, pickups, ties, tempo changes, speed scaling, and legacy storage.');w.close();
}
checkPlayback().catch(e=>{console.error(e);w.close();process.exitCode=1});
