const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ABCJS=require('../vendor/abcjs-basic-min.js');
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
console.log('PASS: '+context.library.length+' scores; catalog parsing, MIDI export/decoding, source-pitch fidelity, transposition, chords, public-domain declarations, and source-file hashes.');
