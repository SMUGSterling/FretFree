const fs = require('fs'),
  vm = require('vm'),
  ABCJS = require('../vendor/abcjs-basic-min.js');
const ctx = {ABCJS, atob, Uint8Array, DataView, Map};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../score-tools.js'), 'utf8'), ctx);
// Difficulty estimate from the played notes: range in semitones and how much shorter the quickest notes are than
// the typical one. Labels are estimates, as elsewhere in the library.
function levelFor(notes) {
  const pitches = notes.map(n => n.note),
    span = Math.max(...pitches) - Math.min(...pitches),
    durations = notes.map(n => n.duration).sort((a, b) => a - b),
    typical = durations[Math.floor(durations.length / 2)],
    quick = durations[Math.floor(durations.length * 0.05)];
  if (span >= 19 || quick < typical / 3.5) return 'Advanced';
  if (span <= 12 && quick >= typical / 2.2) return 'Beginner';
  return 'Intermediate';
}
const rows = JSON.parse(fs.readFileSync(process.argv[2]));
let ready = [],
  errors = [];
for (const row of rows) {
  try {
    const parsed = ABCJS.parseOnly(row.abc);
    if (parsed.length !== 1 || parsed[0].warnings?.length) throw Error('ABC: ' + parsed[0].warnings);
    let mid = ctx.midiBytes(row.abc),
      data = ctx.parseMidi(mid),
      melody = ctx.melodyNotes(data.notes);
    if (!melody.length || !Number.isFinite(data.duration) || data.duration <= 0) throw Error('No playable notes');
    for (const shift of [-12, 2, 9]) {
      const trans = ABCJS.strTranspose(row.abc, parsed, shift),
        p = ABCJS.parseOnly(trans);
      if (p[0].warnings?.length) throw Error('Transposition: ' + p[0].warnings);
      const d = ctx.melodyNotes(ctx.parseMidi(ctx.midiBytes(trans)).notes);
      if (d[0].note !== melody[0].note + shift) throw Error('Transposition pitch mismatch');
    }
    row.firstNotePitch = melody[0].note;
    if (!row.level) row.level = levelFor(melody);
    ready.push(row);
  } catch (e) {
    errors.push({id: row.id, title: row.title, error: e.message});
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(ready));
fs.writeFileSync(process.argv[3] + '.errors.json', JSON.stringify(errors, null, 2));
console.log('Accepted', ready.length, 'excluded', errors.length, JSON.stringify(errors.slice(0, 8)));
