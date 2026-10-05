const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ABCJS=require('../vendor/abcjs-basic-min.js');
// Every local script and stylesheet carries ?v=<content hash>; a stale stamp means the bump step was skipped.
{const {assets,assetVersion}=require('../scripts/bump-version.cjs'),html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 const tags=[...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="(?!https?:|\/\/)([^"]+\.(?:js|css)[^"]*)"/g)].map(m=>m[1]);
 assert.ok(tags.length>=8&&assets(html).length===tags.length,'index.html lists its local assets');
 const expected=assetVersion(html),stale=tags.filter(t=>!t.endsWith('?v='+expected));
 assert.deepEqual(stale,[],`Assets changed or unstamped; run node scripts/bump-version.cjs (expected ?v=${expected})`)}
const context={ABCJS,console,Uint8Array,DataView,Map,atob};vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../catalog.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(require.resolve('../catalog-expanded.js'),'utf8')+'\nglobalThis.library=catalog;',context);
vm.runInContext(fs.readFileSync(require.resolve('../rights-tools.js'),'utf8'),context);vm.runInContext(fs.readFileSync(require.resolve('../catalog-licensed.js'),'utf8')+'\nglobalThis.library=catalog;',context);
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('function midiBytes'),app.indexOf('function stop()')),context);
assert.ok(context.library.length>=200,'Expanded library should contain at least 200 scores');
assert.equal(new Set(context.library.map(x=>x.id)).size,context.library.length,'Unique score IDs');
for(const score of context.library){
 const parsed=ABCJS.parseOnly(score.abc);assert.equal(parsed.length,1,score.title);assert.ok(!parsed[0].warnings?.length,`${score.title}: ${parsed[0].warnings}`);
 const midi=context.midiBytes(score.abc);assert.equal(Buffer.from(midi.slice(0,4)).toString(),'MThd');const data=context.parseMidi(midi);assert.ok(data.notes.length>0);assert.ok(data.duration>0&&Number.isFinite(data.duration));
 for(const step of [-12,2,9]){const transposed=ABCJS.strTranspose(score.abc,parsed,step);assert.ok(!ABCJS.parseOnly(transposed)[0].warnings?.length);const shifted=context.parseMidi(context.midiBytes(transposed));assert.equal(shifted.notes[0].note,data.notes[0].note+step);}
 assert.ok(score.rights&&/^https?:/.test(score.source));
 if(score.pdf){assert.ok(['Public Domain','CC-BY-2.5','CC-BY-3.0','CC-BY-4.0','CC-BY-SA-2.0','CC-BY-SA-2.5','CC-BY-SA-3.0','CC-BY-SA-4.0'].includes(score.notationLicense));assert.equal(data.notes[0].note,score.firstNotePitch,'Study remains at source concert pitch');const path=require('node:path'),crypto=require('node:crypto');for(const [file,hash] of [[score.pdf,score.pdfSHA256],[score.originalMidi,score.midiSHA256]]){const bytes=fs.readFileSync(path.join(__dirname,'..',file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash,'Unchanged source asset');}const original=context.parseMidi(Uint8Array.from(fs.readFileSync(path.join(__dirname,'..',score.originalMidi))));assert.ok(original.notes.length>0&&Number.isFinite(original.duration));}
 if(score.originalSource){const path=require('node:path'),crypto=require('node:crypto'),b=fs.readFileSync(path.join(__dirname,'..',score.originalSource));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),score.sourceSHA256,'Unchanged editable source');}
 console.log(`${score.title}: ${data.notes.length} notes, ${data.duration.toFixed(1)} seconds; transpositions passed`);
}
const chords=context.parseMidi(context.midiBytes(context.library.find(x=>x.id==='chords').abc));assert.ok(chords.notes.filter(x=>x.start===0).length===3,'chord playback is polyphonic');
// FretFree's own teaching notation must pass the bar check; imported historic editions may keep their irregular bars.
vm.runInContext(fs.readFileSync(require.resolve('../score-tools.js'),'utf8'),context);
// Skill tags are read from the music; catalog-skills.js must match what skillTags() says about every score today.
{const tags=abc=>context.skillTags(ABCJS.parseOnly(abc)[0]).join(', ');
 assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | c B A G | F E D C |]'),'Steps');
 assert.equal(tags('X:1\nM:3/4\nL:1/8\nK:Am\nA,2 C2 E2 | A2 E2 C2 | ^G3 A B2 | a4 z2 |]'),'Skips, Leaps, Eighth notes, Dotted rhythms, Triple meter, Minor key, Wide range','Thirds are skips, wider intervals leaps; meter, mode and range are read from the staff');
 assert.equal(tags('X:1\nM:6/8\nL:1/8\nK:G\n|: (3GAB c/d/e/ f/g/a/ | [GBd]3 z3 :|'),'Steps, Eighth notes, Sixteenth notes, Dotted rhythms, Triplets, Compound meter, Chords, Repeats','Triplet eighths count as eighths; one short rest is not a rest study');
 assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:C\nC C C C | D D D D |]'),'Repeated notes');
 assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:D\nD ^D E =F | F ^F G ^G |]'),'Steps, Accidentals');
 const {buildSkills,render}=require('../scripts/build-skills.cjs');
 assert.equal(fs.readFileSync(require.resolve('../catalog-skills.js'),'utf8'),render(buildSkills()),'catalog-skills.js is stale; run node scripts/build-skills.cjs');}
{const own=context.library.filter(x=>x.kind==='historic'&&!x.collection||x.kind==='original').filter(x=>context.barProblems(ABCJS.parseOnly(x.abc)[0]).length).map(x=>x.id);
 assert.equal(own.join(', '),'','FretFree teaching scores have correct bar lengths')}
// Writing prompts: every example meets all its goals, and the blank starting score does not.
vm.runInContext(fs.readFileSync(require.resolve('../prompts.js'),'utf8').replace('const writingPrompts','globalThis.writingPrompts'),context);
for(const prompt of context.writingPrompts){
 const goals=source=>context.checkPrompt(prompt,context.melodyBars(ABCJS.parseOnly(source)[0]));
 const missed=goals(context.promptSource(prompt,prompt.key,prompt.example)).filter(g=>!g.ok).map(g=>g.label);
 assert.equal(missed.join('; '),'',`Prompt ${prompt.id}: example misses goals`);
 assert.ok(goals(context.promptSource(prompt)).some(g=>!g.ok),`Prompt ${prompt.id}: blank score must not pass`);
 const otherMeter=context.promptSource(prompt,prompt.key,prompt.example).replace(/^M:.*$/m,prompt.meter==='4/4'?'M:3/4':'M:4/4');
 assert.equal(goals(otherMeter)[0].ok,false,`Prompt ${prompt.id}: changing the meter must not satisfy the bars goal`);
}
console.log('PASS: '+context.library.length+' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, MIDI export/decoding, source-pitch fidelity, transposition, chords, public-domain declarations, and source-file hashes.');
