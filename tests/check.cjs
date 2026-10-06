const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const ABCJS = require('../vendor/abcjs-basic-min.js');
// Every local script and stylesheet carries ?v=<content hash>; a stale stamp means the bump step was skipped.
{
  const {assets, assetVersion} = require('../scripts/bump-version.cjs'),
    html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const tags = [
    ...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="(?!https?:|\/\/)([^"]+\.(?:js|css)[^"]*)"/g)
  ].map(m => m[1]);
  assert.ok(tags.length >= 8 && assets(html).length === tags.length, 'index.html lists its local assets');
  const expected = assetVersion(html),
    stale = tags.filter(t => !t.endsWith('?v=' + expected));
  assert.deepEqual(
    stale,
    [],
    `Assets changed or unstamped; run node scripts/bump-version.cjs (expected ?v=${expected})`
  );
}
// Admission policy (RIGHTS.md): PD, CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA and GPL, exact versions as declared.
const ADMITTED_LICENSES = new Set([
  'Public Domain',
  'CC0-1.0',
  'CC-BY-2.5',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-2.0',
  'CC-BY-SA-2.5',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-3.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-3.0',
  'CC-BY-NC-SA-4.0',
  'GPL-2.0-or-later'
]);
const context = {ABCJS, console, Uint8Array, DataView, Map, atob, TextEncoder};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../catalog.js'), 'utf8'), context);
vm.runInContext(
  fs.readFileSync(require.resolve('../catalog-expanded.js'), 'utf8') + '\nglobalThis.library=catalog;',
  context
);
vm.runInContext(fs.readFileSync(require.resolve('../rights-tools.js'), 'utf8'), context);
vm.runInContext(
  fs.readFileSync(require.resolve('../catalog-licensed.js'), 'utf8') +
    fs.readFileSync(require.resolve('../catalog-lieder.js'), 'utf8') +
    fs.readFileSync(require.resolve('../catalog-quartets.js'), 'utf8') +
    fs.readFileSync(require.resolve('../catalog-pgh.js'), 'utf8') +
    '\nglobalThis.library=catalog;',
  context
);
vm.runInContext(fs.readFileSync(require.resolve('../score-tools.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(require.resolve('../musicxml.js'), 'utf8'), context);
assert.ok(context.library.length >= 200, 'Expanded library should contain at least 200 scores');
assert.equal(new Set(context.library.map(x => x.id)).size, context.library.length, 'Unique score IDs');
// The opening tempo of a MIDI file, in milliseconds a quarter note.
const midiQuarter = bytes => {
  const at = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x51 && bytes[i + 2] === 3);
  return ((bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5]) / 1000;
};
for (const score of context.library) {
  const parsed = ABCJS.parseOnly(score.abc);
  assert.equal(parsed.length, 1, score.title);
  assert.ok(!parsed[0].warnings?.length, `${score.title}: ${parsed[0].warnings}`);
  const midi = context.midiBytes(score.abc);
  assert.equal(Buffer.from(midi.slice(0, 4)).toString(), 'MThd');
  const data = context.parseMidi(midi);
  assert.ok(data.notes.length > 0);
  assert.ok(data.duration > 0 && Number.isFinite(data.duration));
  // The sound's tempo is the one abcjs times the drawn notes by (the highlight, practice ranges and metronome).
  const timed = context.settleTempo(ABCJS.parseOnly(score.abc)[0]);
  assert.ok(
    Math.abs(midiQuarter(midi) - timed.millisecondsPerMeasure() / timed.getBarLength() / 4) < 0.01,
    `${score.id}: MIDI tempo ${midiQuarter(midi)} ms a quarter, timed at ${timed.millisecondsPerMeasure()} ms a bar`
  );
  for (const step of [-12, 2, 9]) {
    const transposed = ABCJS.strTranspose(score.abc, parsed, step);
    assert.ok(!ABCJS.parseOnly(transposed)[0].warnings?.length);
    const shifted = context.parseMidi(context.midiBytes(transposed));
    assert.equal(context.melodyNotes(shifted.notes)[0].note, context.melodyNotes(data.notes)[0].note + step);
  }
  assert.ok(score.rights && /^https?:/.test(score.source));
  // Fail closed: every edition must declare its license; scoreLicense() defaults are for display only.
  assert.ok(score.notationLicense || score.declaredLicense, `${score.id}: edition declares no license`);
  assert.ok(
    ADMITTED_LICENSES.has(context.scoreLicense(score)),
    `${score.id}: edition license ${context.scoreLicense(score)} is outside the admission policy in RIGHTS.md`
  );
  if (score.pdf) {
    assert.ok(
      [
        'Public Domain',
        'CC-BY-2.5',
        'CC-BY-3.0',
        'CC-BY-4.0',
        'CC-BY-SA-2.0',
        'CC-BY-SA-2.5',
        'CC-BY-SA-3.0',
        'CC-BY-SA-4.0'
      ].includes(score.notationLicense)
    );
    assert.equal(
      context.melodyNotes(data.notes)[0].note,
      score.firstNotePitch,
      'Study remains at source concert pitch'
    );
    const path = require('node:path'),
      crypto = require('node:crypto');
    for (const [file, hash] of [
      [score.pdf, score.pdfSHA256],
      [score.originalMidi, score.midiSHA256]
    ]) {
      const bytes = fs.readFileSync(path.join(__dirname, '..', file));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, 'Unchanged source asset');
    }
    const original = context.parseMidi(
      Uint8Array.from(fs.readFileSync(path.join(__dirname, '..', score.originalMidi)))
    );
    assert.ok(original.notes.length > 0 && Number.isFinite(original.duration));
  }
  if (score.originalSource) {
    const path = require('node:path'),
      crypto = require('node:crypto'),
      b = fs.readFileSync(path.join(__dirname, '..', score.originalSource));
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'), score.sourceSHA256, 'Unchanged editable source');
  }
  console.log(`${score.title}: ${data.notes.length} notes, ${data.duration.toFixed(1)} seconds; transpositions passed`);
}
const chords = context.parseMidi(context.midiBytes(context.library.find(x => x.id === 'chords').abc));
assert.ok(chords.notes.filter(x => x.start === 0).length === 3, 'chord playback is polyphonic');
// Note edits keep slur openings and tuplet specs in the prefix, mixed in any order with decorations and annotations.
for (const [text, pre, core] of [
  ['(C', '(', 'C'],
  ['(3C/2', '(3', 'C'],
  ['(3:2:3C', '(3:2:3', 'C'],
  ['(3::2 G ', '(3::2 ', 'G'],
  ['"G"(C', '"G"(', 'C'],
  ['!f!(C', '!f!(', 'C'],
  ['"G"!f!(C', '"G"!f!(', 'C'],
  ['.(c ', '.(', 'c'],
  ['("G"C', '("G"', 'C'],
  ['([CE]', '(', '[CE]'],
  ['(3(z', '(3(', 'z']
]) {
  const parts = context.noteParts(text);
  assert.ok(parts, 'noteParts reads ' + text);
  assert.equal(parts.pre + '|' + parts.core, pre + '|' + core, 'noteParts prefix of ' + text);
}
assert.equal(context.noteParts('(3C/2').length, 0.5);
assert.equal(context.noteParts('C)').post, ')');
assert.equal(context.noteParts('3C'), null, 'A bare digit is not a prefix');
for (const [text, edit, expected] of [
  ['(C', {length: 2}, '(C2'],
  ['(3C/2', {length: 1.5, accidental: '^'}, '(3^C3/2'],
  ['(3:2:3C', {tie: true}, '(3:2:3C-'],
  ['"G"!f!(C2- ', {accidental: '_', tie: false}, '"G"!f!(_C2 '],
  ['C)', {length: 2}, 'C2)'],
  ['C2-)', {tie: false}, 'C2)'],
  ['([CE]2', {length: 1, accidental: '='}, '([=C=E]'],
  ['(C>', {length: 1.5, unbroken: true}, '(C3/2'],
  ['"G"!f!(^C3/2- ', {rest: true}, '"G"!f!(z3/2 '],
  ['(3[CE]2)', {rest: true}, '(3z2)'],
  ['[C2E2]3', {rest: true}, 'z6'],
  ['z2', {rest: true}, 'z2']
])
  assert.equal(context.editNoteText(text, edit), expected, `editNoteText(${text}, ${JSON.stringify(edit)})`);
// Articulations and ornaments go just before the pitch, after chord symbols, slur and tuplet openings and grace notes,
// and toggling again restores the text. Shorthands and other spellings count as the mark. Dynamics never stack.
for (const [text, name, expected] of [
  ['"G"C2', 'accent', '"G"!accent!C2'],
  ['(C', 'accent', '(!accent!C'],
  ['[CEG]', 'accent', '!accent![CEG]'],
  ['(3"Am"[CE]/2 ', 'staccato', '(3"Am".[CE]/2 '],
  ['!p!{g}C-', 'trill', '!p!{g}!trill!C-'],
  ['z2', 'fermata', '!fermata!z2'],
  ['Z2', 'fermata', '!fermata!Z2']
]) {
  assert.equal(context.toggleDecoration(text, name), expected, `toggleDecoration(${text}, ${name})`);
  assert.equal(context.toggleDecoration(expected, name), text, `toggleDecoration(${expected}, ${name}) undoes it`);
}
for (const [text, name] of [
  ['L"G"C', 'accent'],
  ['!>!"G"C', 'accent'],
  ['+accent+"G"C', 'accent'],
  ['"G"!emphasis!C', 'accent'],
  ['"G"HC', 'fermata'],
  ['"G"TC', 'trill'],
  ['"G"uC', 'upbow'],
  ['"G"vC', 'downbow'],
  ['"G"MC', 'mordent'],
  ['"G"!lowermordent!C', 'mordent']
])
  assert.equal(context.toggleDecoration(text, name), '"G"C', `${text} carries ${name}`);
assert.equal(context.toggleDecoration('"."C', 'staccato'), '".".C', 'A dot inside a chord symbol is not a staccato');
for (const [text, name] of [
  ['x2', 'accent'],
  ['C', 'staccatissimo'],
  ['|', 'accent']
])
  assert.equal(context.toggleDecoration(text, name), text, `toggleDecoration(${text}, ${name}) changes nothing`);
for (const [text, dyn, expected] of [
  ['!p!C', 'f', '!f!C'],
  ['"G"C', 'mf', '"G"!mf!C'],
  ['!pp!.!sf!C', 'ff', '!ff!.C'],
  ['!fp!(C', 'p', '!p!(C'],
  ['!p!!accent!C', null, '!accent!C'],
  ['+f+z4', 'sfz', '!sfz!z4'],
  ['C', 'fp', 'C'],
  ['x', 'f', 'x']
])
  assert.equal(context.setDynamic(text, dyn), expected, `setDynamic(${text}, ${dyn})`);
assert.equal(
  JSON.stringify(context.noteMarks('!mf!.H(3+accent+{g}C2 ')),
  JSON.stringify({marks: ['staccato', 'fermata', 'accent'], dynamic: 'mf'})
);
assert.equal(context.noteMarks('x4'), null, 'Invisible rests take no marks');
// Every offered mark parses without warnings and reaches the note, on notes, chords and slur starts; rests take
// dynamics and fermatas.
{
  const marks = vm.runInContext('NOTE_MARKS', context),
    dynamics = vm.runInContext('DYNAMICS', context);
  assert.equal(marks.length, 13);
  assert.equal(dynamics.join(' '), 'ppp pp p mp mf f ff fff sfz');
  const check = (body, add, name) => {
    const tune = ABCJS.parseOnly(`X:1\nL:1/4\nK:C\n${add(body)} D|]`)[0],
      note = tune.lines[0].staff[0].voices[0].find(e => e.el_type === 'note');
    assert.ok(!tune.warnings?.length, `${add(body)}: ${tune.warnings}`);
    assert.ok(note.decoration?.includes(name), `${add(body)} carries ${name}`);
  };
  for (const name of marks)
    for (const body of ['C', '"G"[CEG]', '(C D)', '(3C D E']) check(body, t => context.toggleDecoration(t, name), name);
  for (const name of dynamics)
    for (const body of ['C', 'z', 'Z2', '"G"[CEG]']) check(body, t => context.setDynamic(t, name), name);
  check('z', t => context.toggleDecoration(t, 'fermata'), 'fermata');
}
// Playback follows the marks: louder dynamics, accents, sfz and marcato raise the MIDI velocity, staccato shortens the
// note at any tempo. On its own abcjs lets a staccato note ring on above about 95 bpm and loses a repeated note after
// a tenuto or inside a slur; midiBytes mends both, so the exported file is right too.
{
  const notes = (body, tempo = 'Q:1/4=60\n') =>
    context.parseMidi(context.midiBytes(`X:1\nL:1/4\n${tempo}K:C\n${body}|]`)).notes;
  const [soft, loud] = notes('!pp!C !ff!D');
  assert.ok(loud.velocity > soft.velocity, `ff (${loud.velocity}) is louder than pp (${soft.velocity})`);
  const [plain, accented] = notes('!mf!C !accent!C');
  assert.ok(accented.velocity > plain.velocity, 'An accent is louder');
  for (const mark of ['!sfz!', '!marcato!']) {
    const [before, marked, after] = notes(`!p!C ${mark}C C`);
    assert.ok(marked.velocity > before.velocity, `${mark} is louder (${marked.velocity} > ${before.velocity})`);
    assert.equal(after.velocity, before.velocity, `${mark} lasts one note`);
  }
  for (const tempo of ['Q:1/4=60\n', '', 'Q:1/4=120\n', 'Q:1/4=200\n']) {
    const played = notes('C .C .C .C C', tempo),
      beat = played[0].duration;
    assert.equal(played.length, 5, `Every staccato note sounds at ${tempo || 'the default tempo'}`);
    assert.ok(
      played.slice(1, 4).every(n => n.duration < beat * 0.8 && n.duration > beat * 0.4),
      `Staccato is shorter at ${tempo || 'the default tempo'}: ${played.map(n => n.duration.toFixed(3))}`
    );
  }
  for (const body of ['!tenuto!C C C', '(C C C)', '(C !tenuto!C) C']) {
    const played = notes(body, '');
    assert.equal(played.length, 3, `${body}: every repeated note sounds`);
    assert.ok(
      played.every(n => Math.abs(n.duration - played[0].duration) < 0.01),
      `${body}: at full length: ${played.map(n => n.duration.toFixed(3))}`
    );
  }
}
// Tuplets: makeTuplet splits a note into p members lasting as long as it did, the note first and rests after; plain
// notes go p in the time of the power of two below p, dotted notes p in the time of 3 or 6.
{
  assert.deepEqual(
    [3, 5, 6, 7, 2, 4].map(p => context.tupletRatio(1 / 4, p)),
    [2, 4, 4, 4, null, null],
    'Plain quarter: 3:2, 5:4, 6:4, 7:4; 2 and 4 are ordinary lengths'
  );
  assert.deepEqual(
    [2, 4, 5, 7, 3, 6].map(p => context.tupletRatio(3 / 8, p)),
    [3, 3, 3, 6, null, null],
    'Dotted quarter: 2:3, 4:3, 5:3, 7:6; 3 and 6 are ordinary lengths'
  );
  assert.equal(context.tupletRatio(1 / 3, 3), null, 'A tuplet member length is not split again');
  for (const [text, p, unit, expected] of [
    ['C', 3, 1 / 4, '(3C/2 z/2 z/2'],
    ['C2 ', 5, 1 / 4, '(5:4:5C/2 z/2 z/2 z/2 z/2 '],
    ['C', 6, 1 / 8, '(6:4:6C/4 z/4 z/4 z/4 z/4 z/4'],
    ['C', 7, 1 / 8, '(7:4:7C/4 z/4 z/4 z/4 z/4 z/4 z/4'],
    ['C3', 2, 1 / 8, '(2C z'],
    ['C3', 5, 1 / 8, '(5:3:5C z z z z'],
    ['C3', 7, 1 / 8, '(7:6:7C/2 z/2 z/2 z/2 z/2 z/2 z/2'],
    ['"G"!f!.C-', 3, 1 / 4, '"G"!f!(3.C/2 z/2 z/2'],
    ['{e}(C', 3, 1 / 4, '{e}((3C/2 z/2 z/2'],
    ['C)', 3, 1 / 4, '(3C/2) z/2 z/2'],
    ['[CE]2', 3, 1 / 8, '(3[CE] z z'],
    ['[C2E2]', 3, 1 / 8, '(3[CE] z z'],
    ['z', 3, 1 / 4, '(3z/2 z/2 z/2'],
    ['F \\', 3, 1 / 4, '(3F/2 z/2 z/2 \\'],
    ['F- \\\n\\', 3, 1 / 4, '(3F/2 z/2 z/2 \\\n\\'],
    ['C', 2, 1 / 4, null],
    ['C3', 3, 1 / 8, null],
    ['C/16', 3, 1 / 4, null],
    ['C>', 3, 1 / 4, null],
    ['(3C', 3, 1 / 4, null],
    ['x', 3, 1 / 4, null],
    ['Z', 3, 1 / 4, null]
  ])
    assert.equal(context.makeTuplet(text, p, unit), expected, `makeTuplet(${text}, ${p}, ${unit})`);
  // abcjs counts a line continuation (\) as part of the last note on a line; it stays after the last member, so the
  // tuplet and its filled form stay on one line of music without warnings.
  for (const made of [context.makeTuplet('F \\', 3, 1 / 4), '(3F/2G/2A/2 \\']) {
    const tune = ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:C\nC D E ${made}\n| G A B c|]`)[0];
    assert.ok(!tune.warnings?.length, `${made}: ${tune.warnings}`);
    assert.equal(tune.lines.length, 1, `${made}: one line of music`);
  }
  assert.deepEqual(
    [1 / 4, 3 / 8, 7 / 16, 2, 1 / 3, 5 / 8, 0].map(context.oneNoteLength),
    [true, true, true, true, false, false, false],
    'Plain, dotted and double-dotted lengths are one note; 1/3 and 5/8 are not'
  );
  assert.deepEqual({...context.tupletSpec('"G"(3:2:3C')}, {index: 3, text: '(3:2:3', p: 3});
  assert.equal(context.tupletSpec('(C'), null, 'A slur opening is not a tuplet');
  // Every tuplet parses cleanly, has p members and lasts as long as the note, so the bar stays full.
  for (const [note, unit, meter] of [
    ['C', '1/4', '4/4'],
    ['C2', '1/4', '4/4'],
    ['C', '1/8', '2/4'],
    ['"G"!f!.C', '1/4', '4/4'],
    ['C3', '1/8', '6/8'],
    ['z3', '1/8', '6/8']
  ])
    for (const p of [2, 3, 5, 6, 7]) {
      const made = context.makeTuplet(note, p, 1 / +unit.slice(2));
      if (!made) continue;
      const abc = `X:1\nM:${meter}\nL:${unit}\nK:C\n${made} ${note}|]`,
        tune = ABCJS.parseOnly(abc)[0],
        notes = tune.lines[0].staff[0].voices[0].filter(e => e.el_type === 'note'),
        lengths = context.effectiveDurations(context.scoreEvents(tune));
      assert.ok(!tune.warnings?.length, `${made}: ${tune.warnings}`);
      assert.equal(notes[0].startTriplet, p, `${made} starts a ${p}-tuplet`);
      assert.ok(notes[p - 1].endTriplet && !notes[p].startTriplet, `${made} has ${p} members`);
      const sum = notes.slice(0, p).reduce((s, n) => s + lengths.get(n), 0);
      assert.ok(Math.abs(sum - lengths.get(notes[p])) < 1e-9, `${made} lasts as long as ${note}`);
    }
  // Filled in, the tuplets play at even fractions of the note: a triplet of eighths in a quarter beat, five eighths in
  // a half note and a duplet across a dotted quarter.
  const starts = abc =>
    context
      .parseMidi(context.midiBytes(abc))
      .notes.map(n => +n.start.toFixed(3))
      .join(' ');
  assert.equal(starts('X:1\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\n(3C/2 D/2 E/2 F G A|]'), '0 0.333 0.667 1 2 3');
  assert.equal(starts('X:1\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\n(5:4:5C/2 D/2 E/2 F/2 G/2 A2|]'), '0 0.4 0.8 1.2 1.6 2');
  assert.equal(starts('X:1\nM:6/8\nL:1/8\nQ:3/8=60\nK:C\n(2C E F3|]'), '0 0.5 1');
}
// Grace notes: setGrace adds one a step above the note's top pitch, before slur and tuplet openings; it sets or
// clears the slash, or removes the group. moveGrace moves only the grace notes.
{
  for (const [text, grace, expected] of [
    ['c', {}, '{d}c'],
    ['C', {slashed: true}, '{/D}C'],
    ['B,2', {}, '{C}B,2'],
    ['[CEg]', {}, '{a}[CEg]'],
    ['"G"!f!(3C/2', {}, '"G"!f!{D}(3C/2'],
    ['.C', {}, '.{D}C'],
    ['{d}C', {slashed: true}, '{/d}C'],
    ['{/ga}C', {slashed: false}, '{ga}C'],
    ['{/d}C ', null, 'C '],
    ['{d}z', null, 'z'],
    ['z', {}, 'z'],
    ['|', {}, '|']
  ])
    assert.equal(context.setGrace(text, grace), expected, `setGrace(${text}, ${JSON.stringify(grace)})`);
  assert.equal(context.moveGrace('{d}C', 1), '{e}C');
  assert.equal(context.moveGrace('"G"{/^ga}C2-', -1), '"G"{/^fg}C2-', 'Only the grace notes move');
  assert.equal(context.moveGrace('C', 1), 'C');
  assert.deepEqual({...context.graceOf('!f!{/d}C')}, {index: 3, text: '{/d}', slashed: true});
  assert.equal(context.graceOf('C'), null);
  for (const text of ['c', 'C', '"G"!f!(3C/2 z/2 z/2', '!f!(3.C/2 z/2 z/2']) {
    for (const slashed of [false, true]) {
      const abc = `X:1\nM:4/4\nL:1/4\nK:C\n${context.setGrace(text, {slashed})} D|]`,
        tune = ABCJS.parseOnly(abc)[0],
        [note] = tune.lines[0].staff[0].voices[0].filter(e => e.el_type === 'note');
      assert.ok(!tune.warnings?.length, `${abc}: ${tune.warnings}`);
      assert.equal(note.gracenotes?.length, 1, `${text}: the note has the grace note`);
      assert.equal(!!note.gracenotes[0].acciaccatura, slashed, `${text}: slashed ${slashed}`);
    }
  }
  // The grace note sounds first and takes its time from the start of the note; the beat after it is on time.
  const played = context.parseMidi(context.midiBytes('X:1\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\n{d}c {/d}c c c|]')).notes;
  assert.equal(played.map(n => n.note).join(' '), '74 72 74 72 72 72', 'Each grace note sounds before its note');
  assert.ok(played[0].start === 0 && played[1].start > 0 && played[1].start < 1, 'Grace then note in beat 1');
  assert.ok(Math.abs(played[2].start - 1) < 1e-3 && Math.abs(played[4].start - 2) < 1e-3, 'Later beats on time');
}
// Tempo in 2/2, 3/2 and C|. abcjs wrote their MIDI at half speed (Q:1/2=60 played as quarter = 60) and, with no Q:,
// timed the drawn notes twice as fast as they sounded. A written tempo now plays in its own beat; with no Q: these
// meters keep the speed they always sounded at, quarter = 180 (half = 90), and the timing follows.
{
  const starts = abc => context.parseMidi(context.midiBytes(abc)).notes.map(n => n.start),
    same = (heard, expected, label) =>
      assert.ok(
        expected.every((t, i) => t == null || Math.abs(heard[i] - t) < 1e-3),
        `${label}: ${heard.map(t => t.toFixed(3))}`
      );
  const bars = 'CDEF GABc | cBAG FEDC |]';
  same(starts(`X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\n${bars}`), [0, 0.25, 0.5, 0.75, 1], '2/2, half = 60');
  same(starts(`X:1\nM:2/2\nL:1/8\nQ:1/4=120\nK:C\n${bars}`), [0, 0.25, 0.5, 0.75, 1], '2/2, quarter = 120');
  same(starts(`X:1\nM:2/2\nL:1/8\nQ:120\nK:C\n${bars}`), [0, 0.125, 0.25], '2/2, Q:120 counts half notes');
  same(starts(`X:1\nM:3/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc cBAG |]`), [0, 0.25, 0.5], '3/2, half = 60');
  same(starts(`X:1\nM:4/2\nL:1/4\nQ:1/2=60\nK:C\nCDEF GABc |]`), [0, 0.5, 1], '4/2, half = 60');
  same(starts(`X:1\nM:C|\nL:1/8\nK:C\n${bars}`), [0, 1 / 6, 2 / 6], 'C| with no Q:, quarter = 180');
  same(starts(`X:1\nM:2/2\nL:1/8\nK:C\n${bars}`), [0, 1 / 6, 2 / 6], '2/2 with no Q:, quarter = 180');
  same(starts(`X:1\nM:6/4\nL:1/8\nK:C\n${bars}`), [0, 1 / 6, 2 / 6], '6/4 with no Q:, quarter = 180');
  same(starts(`X:1\nM:4/4\nL:1/8\nK:C\n${bars}`), [0, 1 / 6, 2 / 6], '4/4 with no Q: is unchanged');
  same(starts(`X:1\nM:6/8\nL:1/8\nK:C\nCDE FGA|]`), [0, 1 / 6, 2 / 6], '6/8 with no Q: is unchanged');
  same(starts(`X:1\nM:4/4\nL:1/8\nQ:"Slowly"\nK:C\n${bars}`), [0, 1 / 6], 'A tempo with no number plays at 180');
  // Tempo changes in the body, written inline or on their own line, with or without a Q: in the header.
  const change = starts(`X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc | [Q:1/2=120] cBAG FEDC |]`);
  same(change.slice(7), [1.75, 2, 2.125, 2.25], 'Half = 60, then half = 120');
  const line = starts(`X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc |\nQ:1/4=60\ncBAG FEDC |]`);
  same(line.slice(7), [1.75, 2, 2.5, 3], 'A Q: line in the body, quarter = 60');
  const unset = starts(`X:1\nM:C|\nL:1/8\nK:C\nCDEF GABc | [Q:1/2=60] cBAG FEDC |]`);
  same(unset.slice(8), [4 / 3, 4 / 3 + 0.25], 'No Q:, then half = 60');
  const bare = starts(`X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc | [Q:120] cBAG | [Q:"Slower"] FEDC |]`);
  same(bare.slice(8), [2, 2.125, 2.25, 2.375, 2.5, 2.625], '[Q:120] counts half notes, and a word keeps the tempo');
  // Meter changes in the body: the opening meter's beat sets the tempo, so the notes keep their speed.
  const meters = starts(`X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc | [M:4/4] cBAG FEDC | [M:3/2] CDEF GABc cBAG |]`);
  same([meters[8], meters[16], meters[27]], [2, 4, 6.75], '2/2 to 4/4 to 3/2 at half = 60');
  const into = starts(`X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc | [M:2/2] cBAG FEDC | [M:6/8] CDE FGA |]`);
  same([into[8], into[16], into[21]], [4 / 3, 8 / 3, 3.5], '4/4 to 2/2 to 6/8 with no Q:');
  // Exported MIDI says the same tempo in its own terms: half = 60 is 120 quarter notes a minute.
  assert.equal(midiQuarter(context.midiBytes(`X:1\nM:C|\nL:1/8\nQ:1/2=60\nK:C\n${bars}`)), 500);
  assert.equal(midiQuarter(context.midiBytes(`X:1\nM:6/8\nL:1/8\nQ:3/8=60\nK:C\nCDE FGA|]`)), 666.667);
}
// Slurs, hairpins and trill lines over a run of notes: toggleSlur and toggleSpan write ( … ) and the !<(! … !<)!,
// !>(! … !>)! and !trill(! … !trill)! decorations, take them off again, replace the lines of the same family they
// cover or cross (keeping a slur around them and lines that only meet them at an end note), and keep each note's text
// whole for abcjs (decorations before slur and tuplet openings, ( before a staccato dot). Slurs pair as abcjs pairs
// them, and a line goes on in its voice's next block.
{
  const head = 'X:1\nL:1/4\nM:4/4\nK:C\n',
    tuneOf = body => ABCJS.parseOnly(head + body + '\n')[0],
    notesOf = tune =>
      tune.lines.flatMap(l => l.staff || []).flatMap(s => s.voices[0].filter(e => e.el_type === 'note')),
    toggle = (body, i, j, kind) => {
      const abc = head + body + '\n',
        notes = notesOf(tuneOf(body)),
        last = j == null ? null : notes[j];
      return (kind === 'slur' ? context.toggleSlur(abc, notes[i], last) : context.toggleSpan(abc, notes[i], last, kind))
        .slice(head.length)
        .trim();
    };
  for (const [body, i, j, kind, expected] of [
    ['C D E F|', 0, 3, 'slur', '(C D E F)|'],
    ['(C D E F)|', 0, 3, 'slur', 'C D E F|'],
    ['(C D) (E F)|G', 0, 3, 'slur', '(C D E F)|G'],
    ['(C D) E (F|G)', 0, 3, 'slur', '(C D E (F)|G)'],
    ['(C D E F|G)|', 0, 2, 'slur', '(C D E) F|G|'],
    ['"G"!p!.C D E F2-|', 0, 3, 'slur', '"G"!p!(.C D E F2-)|'],
    ['"G"(.C D E) F|', 0, null, 'slur', '"G".C D E F|'],
    ['C (D E F|G) A|', 1, null, 'slur', 'C D E F|G A|'],
    ['C D E F|', 0, null, 'slur', 'C D E F|'],
    ['(3C D E F|', 0, 3, 'slur', '(3(C D E F)|'],
    ['C D>E F|', 0, 2, 'slur', '(C D>E) F|'],
    ['[CE] D [EG]2-|[EG]', 0, 2, 'slur', '([CE] D [EG]2-)|[EG]'],
    ['z D E z|', 0, 3, 'slur', 'z D E z|'],
    ['C D E F|', 0, 3, 'crescendo', '!<(!C D E !<)!F|'],
    ['!<(!C D E !<)!F|', 0, 3, 'crescendo', 'C D E F|'],
    ['!crescendo(!C D E !crescendo)!F|', 0, 3, 'crescendo', 'C D E F|'],
    ['!>(!C D E !>)!F|', 0, 3, 'crescendo', '!<(!C D E !<)!F|'],
    ['C D E F|', 0, 3, 'diminuendo', '!>(!C D E !>)!F|'],
    ['(3C D E F|', 0, 3, 'crescendo', '!<(!(3C D E !<)!F|'],
    ['(C D) E F|', 1, 3, 'crescendo', '(C !<(!D) E !<)!F|'],
    ['C D | E F|', 1, 2, 'crescendo', 'C !<(!D | !<)!E F|'],
    ['C D | (E F)|', 1, 2, 'trill', 'C !trill(!D | !trill)!(E F)|'],
    ['z D E Z|', 0, 3, 'crescendo', '!<(!z D E !<)!Z|'],
    ['x D E F|', 0, 3, 'crescendo', 'x D E F|'],
    ['C D E F|', 0, 3, 'trill', '!trill(!C D E !trill)!F|'],
    ['!trill(!C D E !trill)!F|', 0, null, 'trill', 'C D E F|'],
    // Chained slurs: abcjs reads a note's ) before its (, so (C D (E) F) is C to E and E to F.
    ['(C D E) F|', 2, 3, 'slur', '(C D (E) F)|'],
    ['(C D (E) F)|', 0, 2, 'slur', 'C D (E F)|'],
    ['(C D (E) F)|', 2, 3, 'slur', '(C D E) F|'],
    ['(C D (E) F)|', 2, null, 'slur', '(C D E) F|'],
    ['(C (D) E) F|', 1, null, 'slur', '(C D) E F|'],
    ['(C D>)E F|', 1, 3, 'slur', '(C (D>)E F)|'],
    // Lines that start before the run and end inside it come off; a slur around it stays, a hairpin around it goes.
    ['(B, C D) E F|', 1, 3, 'slur', 'B, (C D E) F|'],
    ['!<(!B, C D !<)!E F|', 1, 4, 'crescendo', 'B, !<(!C D E !<)!F|'],
    ['!<(!B, C D !<)!E F|', 1, 4, 'diminuendo', 'B, !>(!C D E !>)!F|'],
    ['!trill(!B, C D !trill)!E F|', 1, 4, 'trill', 'B, !trill(!C D E !trill)!F|'],
    ['(B, C D E F)|', 1, 3, 'slur', '(B, (C D E) F)|'],
    ['!<(!B, C D E !<)!F|', 1, 3, 'crescendo', 'B, !<(!C D !<)!E F|'],
    ['(B, C D E F|', 1, 3, 'slur', '(B, (C D E) F|'],
    ['C D) E F|', 0, 3, 'slur', '(C D E F)|'],
    // abcjs pairs slurs on chords and rests apart from slurs on single notes, so this slur would take the outer one's
    // end; the outer one comes off instead.
    ['(C [CE] D E)|', 1, 2, 'slur', 'C ([CE] D) E|'],
    ['([CE] C D [EG])|', 1, 2, 'slur', '([CE] (C D) [EG])|'],
    // Hairpins meeting at a note: the one ending there ends before the next starts.
    ['C D !<(!E !<)!F|', 0, 2, 'crescendo', '!<(!C D !<)!!<(!E !<)!F|'],
    ['!<(!C !<)!D E F|', 1, 3, 'crescendo', '!<(!C !<)!!<(!D E !<)!F|'],
    // Marks just before a ( that abcjs starts the note after are the note's.
    ['!<(!(.C D) E !<)!F|', 0, 3, 'crescendo', '(.C D) E F|'],
    ['((3{d}C D E)|', 0, 2, 'slur', '(3{d}C D E|']
  ]) {
    const result = toggle(body, i, j, kind);
    assert.equal(result, expected, `${kind} from note ${i} to ${j} on ${body}`);
    assert.ok(!tuneOf(result).warnings?.length, `${result} parses cleanly: ${tuneOf(result).warnings}`);
  }
  // FretFree finds the slurs abcjs draws, and no others.
  for (const body of [
    '(C D (E) F)|',
    '(C (D) E) F|',
    '((C D) E)|',
    '(C D (E F))|',
    '((E)) F)|',
    '(C ([CE] D) E)|',
    '([CE] (D [EG]) F)|',
    '(z C) (D z)|',
    '(  .D E) F|'
  ]) {
    const abc = head + body + '\n',
      notes = notesOf(tuneOf(body)),
      open = new Map(),
      drawn = [];
    notes.forEach((n, k) => {
      for (const label of [n, ...(n.pitches || [])].flatMap(x => x.endSlur || []))
        if (open.has(label)) (drawn.push([open.get(label), k]), open.delete(label));
      for (const {label} of [n, ...(n.pitches || [])].flatMap(x => x.startSlur || [])) open.set(label, k);
    });
    for (const [i, j] of drawn) assert.ok(context.lineAt(abc, notes[i], notes[j], 'slur'), `${body}: ${i} to ${j}`);
    assert.equal(
      context.linePairs(abc).pairs.filter(p => p.kind === 'slur' && p.open && p.close).length,
      drawn.length,
      body
    );
  }
  // A voice written in blocks (V:1, V:2, V:1 ...): a line goes on to the voice's next block, and comes off again.
  for (const voice of ['V:1\n', '[V:1] ']) {
    const other = voice.replace('1', '2'),
      abc = `${head}${voice}C D E F|\n${other}C, D, E, F,|\n${voice}G A B c|\n${other}G, A, B, C|\n`,
      first = abc => {
        const notes = ABCJS.parseOnly(abc)[0].lines.flatMap(l =>
          l.staff[0].voices[0].filter(e => e.el_type === 'note')
        );
        return [notes[3], notes[4], notes[2]];
      },
      [f, g] = first(abc),
      slurred = context.toggleSlur(abc, f, g);
    assert.equal(slurred, abc.replace('F|', '(F|').replace('G A', 'G) A'));
    assert.equal(context.toggleSlur(slurred, ...first(slurred).slice(0, 2)), abc, 'Taken off again');
    assert.equal(context.toggleSlur(slurred, first(slurred)[0], null), abc, 'Taken off from its first note');
    const [, g2, e2] = first(abc),
      louder = context.toggleSpan(abc, e2, g2, 'crescendo');
    assert.equal(louder, abc.replace('E F|', '!<(!E F|').replace('G A', '!<)!G A'));
    assert.ok(context.lineAt(louder, first(louder)[2], first(louder)[1], 'crescendo'));
    assert.equal(context.toggleSpan(louder, first(louder)[2], first(louder)[1], 'crescendo'), abc);
  }
  // Each note keeps all its text, so a slur and its marks stay part of the note abcjs reads, and lines reach the
  // right notes.
  const [c, , e, f, g] = notesOf(tuneOf('"G"!p!(.C D !<(!(E F)- | !<)!F)'));
  assert.ok(c.pitches[0].startSlur && g.pitches[0].endSlur && e.pitches[0].startSlur && f.pitches[0].endSlur);
  assert.deepEqual([e.decoration, g.decoration], [['crescendo('], ['crescendo)']]);
  {
    const abc = head + 'C !p!.D E F|\n',
      [, d, , last] = notesOf(ABCJS.parseOnly(abc)[0]),
      slurred = context.toggleSlur(abc, d, last),
      [, d2, , f2] = notesOf(ABCJS.parseOnly(slurred)[0]);
    assert.equal(slurred.slice(head.length), 'C !p!(.D E F)|\n');
    assert.ok(d2.pitches[0].startSlur && f2.pitches[0].endSlur);
    assert.ok(
      context.lineAt(slurred, d2, f2, 'slur'),
      'The slur is found again, though abcjs starts the note at the dot'
    );
    assert.equal(context.lineAt(slurred, d2, f2, 'crescendo'), null);
    assert.equal(context.toggleSlur(slurred, d2, f2), abc, 'And taken off');
  }
  // Note edits on slurred notes keep working: length, accidental, tie, rest and pitch moves keep ( and ).
  for (const [text, edit, expected] of [
    ['(C ', {length: 2}, '(C2 '],
    ['"G"(C', {accidental: '^'}, '"G"(^C'],
    ['F2-)', {tie: false}, 'F2)'],
    ['F2)', {tie: true}, 'F2-)'],
    ['!<(!(E', {rest: true}, '!<(!(z']
  ])
    assert.equal(context.editNoteText(text, edit), expected, `editNoteText(${text}, ${JSON.stringify(edit)})`);
  assert.equal(context.moveNoteText('!<(!(E2-)', 1), '!<(!(F2-)');
  // A crescendo raises the velocity note by note and a diminuendo lowers it.
  const velocities = body =>
    context
      .parseMidi(context.midiBytes(`${head}Q:1/4=120\n${body}|]`))
      .notes.slice(0, 4)
      .map(n => n.velocity);
  const up = velocities(toggle('!p!C D E F|G', 0, 3, 'crescendo')),
    down = velocities(toggle('!f!C D E F|G', 0, 3, 'diminuendo'));
  assert.ok(
    up.every((v, k) => !k || v > up[k - 1]),
    `Velocities rise across a crescendo: ${up}`
  );
  assert.ok(
    down.every((v, k) => !k || v < down[k - 1]),
    `Velocities fall across a diminuendo: ${down}`
  );
  // Transposing keeps slurs, hairpins and trill lines.
  const moved = context.transposeABC(`${head}"G"!<(!(C D E !<)!F)|!trill(!G2 !trill)!A2|]\n`, 2);
  assert.equal(moved.trim().split('\n').at(-1), '"A"!<(!(D E F !<)!G)|!trill(!A2 !trill)!B2|]');
  assert.ok(!ABCJS.parseOnly(moved)[0].warnings?.length);
}
// Swing feel: the setting round-trips through Q: text and %%MIDI swing, and playback delays off-beat eighths only.
{
  const head = 'X:1\nT:Blues\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\n',
    swung = context.setSwing(head + 'CDEF GABc|]', 66);
  assert.equal(swung, 'X:1\nT:Blues\nM:4/4\nL:1/8\nQ:"Swing" 1/4=120\n%%MIDI swing 66\nK:C\nCDEF GABc|]');
  assert.deepEqual(ABCJS.parseOnly(swung)[0].warnings, undefined, 'Swing tempo text and directive parse cleanly');
  assert.equal(ABCJS.parseOnly(swung)[0].metaText.tempo.preString, 'Swing', '"Swing" prints with the tempo');
  assert.equal(context.swingAmount(swung), 66);
  assert.equal(context.swingAmount(context.setSwing(swung, 75)), 75, 'A new amount replaces the directive');
  assert.equal(context.setSwing(swung, 75).match(/%%MIDI swing/g).length, 1);
  assert.equal(context.setSwing(swung, 0), head + 'CDEF GABc|]', 'Straight removes both');
  assert.equal(
    context.setSwing('X:1\nQ:"Allegro" 1/4=120\nK:C\nC|]', 0),
    'X:1\nQ:"Allegro" 1/4=120\nK:C\nC|]',
    'Straight keeps other tempo text'
  );
  assert.equal(
    context.setSwing('X:1\nQ:"Allegro" 1/4=120\nK:C\nC|]', 66),
    'X:1\nQ:"Allegro, swing" 1/4=120\n%%MIDI swing 66\nK:C\nC|]',
    'Swing adds to other tempo text'
  );
  for (const tempo of ['"Allegro" 1/4=120', '1/4=120 "Allegro"', '"Medium swing" 1/4=120', '"Andante" 1/8=90 "Swing"'])
    assert.equal(
      context.setSwing(context.setSwing(`X:1\nQ:${tempo}\nK:C\nC|]`, 66), 0),
      `X:1\nQ:${tempo.replace(/"[^"]*swing"/i, '').trim()}\nK:C\nC|]`,
      `Swing and back to Straight keeps the other text: ${tempo}`
    );
  assert.match(context.setSwing('X:1\nQ:"Medium swing" 1/4=120\nK:C\nC|]', 66), /^Q:"Medium swing" 1\/4=120$/m);
  // abcjs drops a bare number after tempo text, so Swing writes out the beat the score plays at (settleTempo) when Q:
  // has none: the tempo stays as it was. With no Q:, 2/2, C|, 3/2 and 6/4 play at quarter = 180, not abcjs's own
  // 1/2=180 or 3/4=180, which would now play two or three times as fast.
  for (const [source, tempo] of [
    ['X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc|]', '1/4=180'],
    ['X:1\nM:2/2\nL:1/8\nK:C\nCDEF GABc|]', '1/4=180'],
    ['X:1\nM:C|\nL:1/8\nK:D\ndAFA dAFA|]', '1/4=180'],
    ['X:1\nM:3/2\nL:1/8\nK:C\nCDEF GABc cBAG|]', '1/4=180'],
    ['X:1\nM:6/4\nL:1/8\nK:C\nCDEF GABc cBAG|]', '1/4=180'],
    ['X:1\nM:6/8\nL:1/8\nK:C\nCDE FGA|]', '3/8=120'],
    ['X:1\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEF GABc|]', '1/4=120'],
    ['X:1\nM:2/2\nL:1/8\nQ:120\nK:C\nCDEF GABc|]', '1/2=120'],
    ['X:1\nM:C|\nL:1/8\nQ:60\nK:C\nCDEF GABc|]', '1/4=60'],
    ['X:1\nM:6/8\nL:1/8\nQ:100\nK:C\nCDE FGA|]', '1/8=100'],
    ['X:1\nM:4/4\nL:1/8\nQ: 1/4=100\nK:C\nCDEF GABc|]', '1/4=100'],
    ['X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc|\nQ:1/4=80\nCDEF GABc|]', '1/4=80']
  ]) {
    const swing = context.setSwing(source, 60),
      parsed = ABCJS.parseOnly(swing)[0],
      seconds = abc => context.parseMidi(context.midiBytes(abc)).duration;
    assert.equal(swing.match(/^Q:.*$/m)[0], 'Q:"Swing" ' + tempo, source);
    assert.deepEqual([parsed.warnings, parsed.metaText.tempo.preString], [undefined, 'Swing']);
    assert.ok(Math.abs(seconds(swing) - seconds(source)) < 1e-3, `Swing keeps the tempo of ${source}`);
    assert.equal(context.setSwing(swing, 0).match(/^Q:.*$/m)[0], 'Q:' + tempo, 'Straight keeps the beat');
  }
  {
    const slowly = 'X:1\nM:2/2\nL:1/8\nQ:"Slowly"\nK:C\nCDEF GABc|]',
      swing = context.setSwing(slowly, 66),
      quarter = abc => context.parseMidi(context.midiBytes(abc)).quarter;
    assert.equal(swing.match(/^Q:.*$/m)[0], 'Q:"Slowly, swing" 1/4=180', 'Tempo text alone in 2/2');
    assert.deepEqual(
      [quarter(swing), quarter(slowly)],
      [1 / 3, 1 / 3].map(x => +x.toFixed(6)),
      'keeps its tempo'
    );
  }
  assert.equal(
    context.setSwing('X:1\nT:t\nM:4/4\nL:1/8\nK:C\nCDEF GABc|\nQ:1/4=80\nCDEF GABc|]', 66),
    'X:1\nT:t\nM:4/4\nL:1/8\nQ:"Swing" 1/4=80\n%%MIDI swing 66\nK:C\nCDEF GABc|\nQ:1/4=80\nCDEF GABc|]',
    'A tempo change in the tune body stays as it is'
  );
  assert.equal(context.setSwing('X:1\nQ:"Swing"\n%%MIDI swing 60\nK:C\nC|]', 0), 'X:1\nK:C\nC|]');
  assert.equal(context.swingAmount('X:1\nQ:"Medium swing" 1/4=120\nK:C\n'), 66, 'Swing text alone means 66');
  assert.equal(context.swingAmount('X:1\nK:C\nC|\nQ:"Swing" 1/4=100\nC|]'), 0, 'Only the header tempo sets the feel');
  assert.deepEqual(
    JSON.parse(
      JSON.stringify([
        context.tempoParts('"Allegro" 1/4=120 "Swing"'),
        context.tempoParts(' 120'),
        context.tempoParts('"Swing"'),
        context.tempoParts('"Swing 1/4=120')
      ])
    ),
    [
      {pre: '"Allegro"', beat: '1/4=120', post: '"Swing"'},
      {pre: '', beat: '120', post: ''},
      {pre: '"Swing"', beat: '', post: ''},
      {pre: '', beat: '"Swing 1/4=120', post: ''}
    ]
  );
  assert.equal(context.swingAmount('X:1\n%%MIDI swing 90\nK:C\n'), 75, 'Amounts stop at 75');
  assert.equal(context.swingAmount('X:1\nQ:"Swing"\n%%MIDI swing 50\nK:C\n'), 0, '50 is straight');
  assert.equal(context.swingAmount(head), 0);
  const note = (start, duration, ch = 0) => ({start, duration, ch, note: 60, velocity: 80}),
    times = notes => notes.map(n => +n.start.toFixed(4) + '+' + +n.duration.toFixed(4)).join(' ');
  const eighths = [note(0, 0.25), note(0.25, 0.25), note(0.5, 0.25), note(0.75, 0.25)];
  assert.equal(times(context.swingNotes(eighths, 0.5, 66)), '0+0.33 0.33+0.17 0.5+0.33 0.83+0.17');
  assert.equal(times(context.swingNotes(eighths, 0.5, 75)), '0+0.375 0.375+0.125 0.5+0.375 0.875+0.125');
  assert.equal(context.swingNotes(eighths, 0.5, 50), eighths, 'Straight returns the notes untouched');
  assert.equal(
    times(context.swingNotes([note(0, 0.125), note(0.125, 0.125), note(0.25, 0.25)], 0.5, 66)),
    '0+0.125 0.125+0.125 0.25+0.25',
    'A beat with sixteenths stays straight'
  );
  assert.equal(
    times(context.swingNotes([note(0, 0.5), note(0, 0.25, 1), note(0.25, 0.75, 1), note(1, 0.25, 1)], 0.5, 66)),
    '0+0.5 0+0.33 0.33+0.67 1+0.25',
    'Each channel swings on its own, and a syncopated note keeps its end'
  );
  assert.equal(
    times(context.swingNotes([note(0, 0.15), note(0.25, 0.15)], 0.5, 66)),
    '0+0.198 0.33+0.102',
    'Staccato eighths keep their proportions'
  );
  assert.equal(
    times(context.swingNotes([note(0, 0.25), note(0.25, 0.25)], 0.5, 66, 0.25)),
    '0.08+0.17 0.25+0.25',
    'origin puts a pickup eighth on the off-beat'
  );
  // Note times rounded to MIDI ticks and a beat grid from whole milliseconds still swing (90 bpm, 1 ms off).
  assert.equal(
    times(context.swingNotes([note(0.0005, 0.3333), note(0.3338, 0.3333), note(0.6672, 0.3333)], 0.6667, 66, 0.0005)),
    '0.0005+0.44 0.4405+0.2266 0.6672+0.3333',
    'Swing allows for rounding'
  );
  assert.equal(
    context
      .swingNotes(eighths, 0.5, 66)
      .map(n => n.straightEnd)
      .join(),
    '0.25,0.5,0.75,1',
    'Each note keeps its straight end'
  );
  assert.deepEqual(
    ['1/4=120', '1/4=90', '1/8=240'].map(
      Q => context.parseMidi(context.midiBytes(`X:1\nM:4/4\nQ:${Q}\nK:C\nC|]`)).quarter
    ),
    [0.5, 0.666667, 0.5],
    'parseMidi reports the opening tempo'
  );
  const data = context.parseMidi(context.midiBytes(head + 'CDEF GABc|[Q:1/4=60] CDEF GABc|]'));
  assert.equal(
    times(
      context
        .swingPlayback(data, 66, [
          {time: 0, quarter: 0.5, origin: 0},
          {time: 2, quarter: 1, origin: 2}
        ])
        .notes.slice(6, 10)
    ),
    '1.5+0.33 1.83+0.17 2+0.66 2.66+0.34',
    'Each measure swings at its own tempo'
  );
  assert.equal(context.swingPlayback(data, 0, [{time: 0, quarter: 0.5, origin: 0}]), data);
}
// FretFree's own teaching notation must pass the bar check; imported historic editions may keep their irregular bars.
// Share links: the payload round-trips through deflate+base64url, and through plain base64url where
// CompressionStream is missing; damaged links decode to null.
(async () => {
  const payload = {v: 1, a: 'X:1\nT:Shared\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', i: 'Flute', s: 'ode'};
  Object.assign(context, {CompressionStream, DecompressionStream, Response, Blob, TextEncoder, TextDecoder, btoa});
  const packed = await context.encodeShare(payload);
  assert.equal(packed[0], '1', 'Compressed when CompressionStream exists');
  assert.match(packed, /^[A-Za-z0-9_-]+$/, 'Link-safe characters only');
  assert.equal(JSON.stringify(await context.decodeShare(packed)), JSON.stringify(payload));
  const plain = vm.runInContext(
    '(p=>{const C=CompressionStream;CompressionStream=undefined;try{return encodeShare(p)}finally{CompressionStream=C}})',
    context
  );
  const fallback = await plain(payload);
  assert.equal(fallback[0], '0', 'Plain base64url without CompressionStream');
  assert.equal(JSON.stringify(await context.decodeShare(fallback)), JSON.stringify(payload));
  assert.ok(packed.length < fallback.length, 'Compression shortens the link');
  assert.equal(await context.decodeShare('1garbage'), null);
  assert.equal(await context.decodeShare('2' + packed.slice(1)), null, 'Unknown pack markers are refused');
  assert.equal(
    await context.decodeShare('0' + btoa('{"v":1,"a":"garbage K:"}')),
    null,
    'ABC needs real X: and K: header lines'
  );
  assert.equal(
    await context.decodeShare('0' + btoa(JSON.stringify({...payload, v: 2}))),
    null,
    'Only payload version 1 opens'
  );
  const big = await plain({...payload, a: payload.a + '\n' + 'C D E F | G A B c |\n'.repeat(20000)});
  assert.ok(
    big[0] === '0' && big.length > 400000 && (await context.decodeShare(big)).a.length > 300000,
    'A 400 KB score reaches the plain encoder uncompressed and encodes without overflowing the stack'
  );
  assert.equal(
    await context.decodeShare('0' + btoa('{"a":"not abc"}')),
    null,
    'A payload without a key line is rejected'
  );
  console.log('Share links: compressed and plain round trips passed');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
// Non-commercial wording: the NC note appears for every CC NC licence, and the ShareAlike sentence only for -SA-,
// including the plain CC BY-NC case that no catalog edition exercises yet.
{
  const nc = {notationLicense: 'CC-BY-NC-4.0', rights: 'r'},
    ncsa = {notationLicense: 'CC-BY-NC-SA-3.0', rights: 'r'},
    sa = {notationLicense: 'CC-BY-SA-4.0', rights: 'r'};
  assert.ok(context.nonCommercial(nc) && context.nonCommercial(ncsa) && !context.nonCommercial(sa));
  assert.equal(context.licenseLabel(nc), 'CC-BY-NC-4.0 · NON-COMMERCIAL EDITION');
  assert.equal(context.licenseLabel(sa), 'CC-BY-SA-4.0 · LICENSED EDITION');
  assert.match(context.nonCommercialNote(nc), /^Non-commercial edition: .*not for sale/);
  assert.ok(!/same license/.test(context.nonCommercialNote(nc)), 'Plain CC BY-NC carries no ShareAlike obligation');
  assert.match(context.nonCommercialNote(ncsa), /Adaptations keep the same license\.$/);
  assert.ok(context.exportCredit(nc).includes('Non-commercial edition'), 'Exports carry the NC note');
  assert.ok(!context.exportCredit(sa).includes('Non-commercial edition'), 'SA-only exports do not');
}
// WAV export: wavBytes writes a 16-bit PCM RIFF file whose chunk sizes add up, with the INFO text before the samples;
// creditedWavInfo gives a library edition its license and full credit, and a score of your own only its title and
// composer.
{
  const readWav = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n)),
      chunks = [];
    assert.equal(text(0, 4) + text(8, 4), 'RIFFWAVE');
    assert.equal(view.getUint32(4, true), bytes.length - 8, 'RIFF size');
    for (let at = 12; at < bytes.length;) {
      const size = view.getUint32(at + 4, true);
      chunks.push({id: text(at, 4), at: at + 8, size});
      at += 8 + size + (size & 1);
      assert.ok(at <= bytes.length, 'Chunks fit the file');
    }
    const fmt = chunks.find(c => c.id === 'fmt '),
      data = chunks.find(c => c.id === 'data'),
      list = chunks.find(c => c.id === 'LIST'),
      info = {};
    if (list) {
      assert.equal(text(list.at, 4), 'INFO');
      for (let at = list.at + 4; at < list.at + list.size;) {
        const size = view.getUint32(at + 4, true),
          value = bytes.slice(at + 8, at + 8 + size);
        assert.equal(value[size - 1], 0, 'INFO text ends in a zero byte');
        info[text(at, 4)] = Buffer.from(value.slice(0, -1)).toString('utf8');
        at += 8 + size + (size & 1);
      }
    }
    return {
      ids: chunks.map(c => c.id),
      format: [
        view.getUint16(fmt.at, true),
        view.getUint16(fmt.at + 2, true),
        view.getUint32(fmt.at + 4, true),
        view.getUint32(fmt.at + 8, true),
        view.getUint16(fmt.at + 12, true),
        view.getUint16(fmt.at + 14, true)
      ],
      fmtSize: fmt.size,
      samples: Array.from({length: data.size / 2}, (_, i) => view.getInt16(data.at + i * 2, true)),
      info
    };
  };
  const left = Float32Array.from([0, 1, -1, 0.5, 2]),
    right = Float32Array.from([0, -0.5, 1, -2, -1]);
  const wav = readWav(context.wavBytes([left, right], 44100, {title: 'Ode to Joy ♫', artist: 'Beethoven'}));
  assert.deepEqual(wav.ids, ['fmt ', 'LIST', 'data'], 'INFO comes before the samples');
  assert.equal(wav.fmtSize, 16);
  assert.deepEqual(wav.format, [1, 2, 44100, 176400, 4, 16], 'PCM, stereo, 44.1 kHz, 16-bit');
  assert.deepEqual(
    wav.samples,
    [0, 0, 32767, -16384, -32768, 32767, 16384, -32768, 32767, -32768],
    'Interleaved, scaled and clipped'
  );
  assert.deepEqual(wav.info, {INAM: 'Ode to Joy ♫', IART: 'Beethoven'}, 'UTF-8 title, odd lengths padded');
  const mono = readWav(context.wavBytes([new Float32Array(3)], 22050));
  assert.deepEqual(mono.ids, ['fmt ', 'data'], 'No INFO chunk without text');
  assert.deepEqual(mono.format, [1, 1, 22050, 44100, 2, 16]);
  // A score of your own: title and composer only; an imported copyright line still travels.
  const own = 'X:1\nT:My Waltz\nC:A. Student\nM:3/4\nK:G\nG3 |]';
  assert.deepEqual(
    {...context.creditedWavInfo(own, {title: 'My Waltz', abc: own})},
    {title: 'My Waltz', artist: 'A. Student'}
  );
  assert.deepEqual({...context.creditedWavInfo('X:1\nK:C\nC', null)}, {title: '', artist: ''});
  assert.equal(
    context.creditedWavInfo('%%abc-copyright © 2024 A. Arranger\nX:1\nT:Kept\nK:C\nC', {}).copyright,
    '© 2024 A. Arranger'
  );
  // Every catalog license reaches ICOP, and the full credit and ABC source reach ICMT; GPL editions carry the license.
  const licenses = new Map(context.library.map(item => [context.scoreLicense(item), item]));
  for (const [license, item] of licenses) {
    const {info} = readWav(context.wavBytes([new Float32Array(2)], 44100, context.creditedWavInfo(item.abc, item)));
    assert.equal(info.ICOP, license, license + ' in ICOP');
    assert.ok(info.ICMT.startsWith(context.exportCredit(item)), license + ': the full credit in ICMT');
    assert.ok(info.ICMT.includes('Corresponding editable ABC source:\n% FretFree-Notice-Begin'));
    assert.equal(info.IART, item.attribution || item.composer);
    if (license.startsWith('GPL')) assert.ok(info.ICMT.includes('GNU GENERAL PUBLIC LICENSE'));
  }
  assert.ok(licenses.size >= 10, 'Checked WAV credits for ' + licenses.size + ' licenses');
}
// Skill tags are read from the music; catalog-skills.js must match what skillTags() says about every score today.
{
  const tags = abc => context.skillTags(ABCJS.parseOnly(abc)[0]).join(', ');
  assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | c B A G | F E D C |]'), 'Steps');
  assert.equal(
    tags('X:1\nM:3/4\nL:1/8\nK:Am\nA,2 C2 E2 | A2 E2 C2 | ^G3 A B2 | a4 z2 |]'),
    'Skips, Leaps, Eighth notes, Dotted rhythms, Triple meter, Minor key, Wide range',
    'Thirds are skips, wider intervals leaps; meter, mode and range are read from the staff'
  );
  assert.equal(
    tags('X:1\nM:6/8\nL:1/8\nK:G\n|: (3GAB c/d/e/ f/g/a/ | [GBd]3 z3 :|'),
    'Steps, Eighth notes, Sixteenth notes, Dotted rhythms, Triplets, Compound meter, Chords, Repeats',
    'Triplet eighths count as eighths; one short rest is not a rest study'
  );
  assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:C\nC C C C | D D D D |]'), 'Repeated notes');
  assert.equal(tags('X:1\nM:4/4\nL:1/4\nK:D\nD ^D E =F | F ^F G ^G |]'), 'Steps, Accidentals');
  assert.equal(
    tags('X:1\nM:4/4\nL:1/4\nK:C\nF x F [K:G] F x2 [K:C] F x | F [K:G] F [K:C] F x |]'),
    'Steps, Repeated notes',
    'Inline key changes alter the notes that follow; invisible rests are not rests or rhythms'
  );
  assert.equal(
    tags('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | [K:Am] A B c d |]'),
    'Steps, Minor key',
    'An inline minor key tags the score'
  );
  const {buildSkills, render} = require('../scripts/build-skills.cjs');
  assert.equal(
    fs.readFileSync(require.resolve('../catalog-skills.js'), 'utf8'),
    render(buildSkills()),
    'catalog-skills.js is stale; run node scripts/build-skills.cjs'
  );
}
{
  const own = context.library
    .filter(x => (x.kind === 'historic' && !x.collection) || x.kind === 'original')
    .filter(x => context.barProblems(ABCJS.parseOnly(x.abc)[0]).length)
    .map(x => x.id);
  assert.equal(own.join(', '), '', 'FretFree teaching scores have correct bar lengths');
}
// Screen-reader note descriptions: noteBeats places each note on a beat, noteLabels spells it with its octave in the
// key and the bar's accidentals, and describeNote puts them into words. Each score is read as just opened, so a short
// first bar is a pickup.
{
  const describeAll = abc => {
    const tune = ABCJS.parseOnly('X:1\n' + abc)[0],
      beats = context.noteBeats(tune, context.openingPickups(tune)),
      names = new Map(context.noteLabels(tune, 'letters').map(l => [l.at, l.names]));
    return [...context.scoreEvents(tune)]
      .filter(e => e.element.el_type === 'note')
      .map(e =>
        context.describeNote(e.element, e.measure, beats.get(e.element.startChar), names.get(e.element.startChar))
      );
  };
  assert.deepEqual(describeAll('M:4/4\nL:1/8\nK:D\nF2 | C2 [CEG]2 z2 x2 | ^c =c c4- | c8 |]'), [
    'Quarter note F♯4, measure 1, beat 4',
    'Quarter note C♯4, measure 2, beat 1',
    'Quarter note chord C♯4 E4 G4, measure 2, beat 2',
    'Quarter rest, measure 2, beat 3',
    'Invisible quarter rest, measure 2, beat 4',
    'Eighth note C♯5, measure 3, beat 1',
    'Eighth note C5, measure 3, beat 1½',
    'Half note C5, tied to the next note, measure 3, beat 2',
    'Whole note C5, measure 4, beat 1'
  ]);
  assert.deepEqual(describeAll('M:6/8\nL:1/8\nK:F\nB3 B/c/ d e | Z2 |]'), [
    'Dotted quarter note B♭4, measure 1, beat 1',
    '16th note B♭4, measure 1, beat 2',
    '16th note C5, measure 1, after beat 2',
    'Eighth note D5, measure 1, beat 2⅓',
    'Eighth note E5, measure 1, beat 2⅔',
    'Rest for 2 measures, measure 2'
  ]);
  assert.deepEqual(describeAll('M:2/2\nL:1/4\nK:C\nC D2 E | (3FGA B2 |]').slice(1), [
    'Half note D4, measure 1, beat 1½',
    'Quarter note E4, measure 1, beat 2½',
    'Quarter note F4, measure 2, beat 1',
    'Quarter note G4, measure 2, beat 1⅓',
    'Quarter note A4, measure 2, beat 1⅔',
    'Half note B4, measure 2, beat 2'
  ]);
  assert.deepEqual(describeAll('M:3/4\nL:1/16\nK:C\nG,,3 A,,7 B,,14 |]'), [
    'Dotted eighth note G2, measure 1, beat 1',
    'Double-dotted quarter note A2, measure 1, beat 1¾',
    'Double-dotted half note B2, measure 1, beat 3½'
  ]);
  assert.deepEqual(describeAll('M:none\nL:1/4\nK:C\n__D ^^F/3 |]'), [
    'Quarter note D𝄫4, measure 1',
    'Note F𝄪4, measure 1'
  ]);
  assert.deepEqual(
    describeAll('M:4/4\nL:1/4\nK:C\nC y D E F |]'),
    [
      'Quarter note C4, measure 1, beat 1',
      '',
      'Quarter note D4, measure 1, beat 2',
      'Quarter note E4, measure 1, beat 3',
      'Quarter note F4, measure 1, beat 4'
    ],
    'A spacer is not a rest and takes no time'
  );
  assert.equal(context.describeNote({duration: 0.375, rest: {type: 'rest'}}, 5), 'Dotted quarter rest, measure 5');
}
// Pickups: a short first bar is one when the score opened with it, or when a short bar that closes a section or the
// tune makes up the rest of it. A first bar shortened by deleting a note while writing starts on beat 1.
{
  const parse = abc => ABCJS.parseOnly('X:1\nM:4/4\nL:1/4\nK:C\n' + abc)[0],
    beats = (abc, opened) =>
      [
        ...context.noteBeats(parse(abc), opened == null ? undefined : context.openingPickups(parse(opened))).values()
      ].join(' ');
  assert.equal(beats('C E F | G A B c |]'), '1 2 3 1 2 3 4', 'A first bar left short by a deletion');
  assert.equal(beats('C E F | G A B c |]', 'C D E F | G A B c |]'), '1 2 3 1 2 3 4', 'It opened full');
  assert.equal(beats('C D | E F G A | B c |]'), '3 4 1 2 3 4 1 2', 'A last bar that makes up the bar');
  assert.equal(beats('C D | E F G A | B c |'), '3 4 1 2 3 4 1 2', 'without a final bar line too');
  assert.equal(beats('C D | E F G A | B |]'), '1 2 1 2 3 4 1', 'A short last bar that does not');
  assert.equal(beats('C | E F G A | B c d :| e f g a |]'), '4 1 2 3 4 1 2 3 1 2 3 4', 'A repeat that makes it up');
  assert.equal(
    beats('C | E F G A | B c d :| e | f g a b |]'),
    '4 1 2 3 4 1 2 3 4 1 2 3 4',
    "A short bar after a short repeat bar is the next section's pickup"
  );
  assert.equal(beats('E F G A | B c d || e | f g a b |]'), '1 2 3 4 1 2 3 4 1 2 3 4', 'after any section end');
  assert.equal(beats('E F G A | B c d | e | f g a b |]'), '1 2 3 4 1 2 3 1 1 2 3 4', 'but not after a plain bar line');
  assert.equal(beats('E F G A | B c d :| e'), '1 2 3 4 1 2 3 1', 'nor before its bar line is written');
  assert.equal(beats('E F G A | B c d :| e f |]'), '1 2 3 4 1 2 3 1 2', 'nor when the two are not one bar');
  assert.equal(beats('M:2/4\nC | D E |1 F :|2 G || A | B c |]'), '2 1 2 1 1 2 1 2', 'A second ending starts on beat 1');
  assert.equal(beats('C D | E F G A |]', 'C D | E F G A |]'), '3 4 1 2 3 4', 'The score opened with a pickup');
  assert.equal(beats('C | E F G A |]', 'C D | E F G A |]'), '4 1 2 3 4', 'and it stays one after an edit');
  assert.equal(beats('C D |]', 'C D |]'), '1 2', 'One short bar is not a pickup');
  assert.equal(beats('C D E F | G |]', 'C D | G |]'), '1 2 3 4 1', 'A first bar filled in is not');
  assert.deepEqual(
    [...context.openingPickups(ABCJS.parseOnly('X:1\nM:3/4\nL:1/4\nK:C\nV:1\nC | D E F |]\nV:2\nC,3 | D,3 |]')[0])],
    ['0:0'],
    'Each voice has its own'
  );
}
// On-screen piano spelling and chords: midiToken spells a MIDI note for a key signature; addChordPitch builds chords.
{
  const key = k => ABCJS.parseOnly(`X:1\nK:${k}\nC`)[0].lines[0].staff[0].key,
    spell = (k, ...midis) => midis.map(m => context.midiToken(m, key(k))).join(' ');
  assert.equal(spell('C', 60, 61, 63, 66, 72, 48, 84, 59), "C ^C ^D ^F c C, c' B,");
  assert.equal(spell('F', 70, 71, 66, 61), 'B =B _G _D', 'Flat keys use flats; B flat is in the key');
  assert.equal(spell('G', 66, 65, 70), 'F =F ^A', 'Sharp keys use sharps; F sharp is in the key');
  assert.equal(spell('Bb', 70, 63, 68), 'B E _A');
  assert.equal(spell('Am', 68, 69), '^G A', 'Minor keys spell from their signature');
  assert.equal(spell('C#', 60, 65), 'B, E', 'B sharp and E sharp are in C sharp major');
  assert.equal(context.midiToken(70, key('F'), true), '_B', 'Explicit writes the key accidental');
  assert.equal(context.midiToken(60, key('C'), true), '=C');
  assert.equal(context.midiToken(61, null), '^C', 'No key is C major');
  const add = (text, core) => context.addChordPitch(text, core);
  assert.equal(add('C2', 'E'), '[CE]2');
  assert.equal(add('[CE]2', 'G'), '[CEG]2');
  assert.equal(add('"Am"!f!(C2- ', '^g'), '"Am"!f!([C^g]2- ', 'Decorations, slur, tie and spacing stay put');
  assert.equal(add('[C2E2]', 'G'), '[C2E2G2]', 'Per-pitch chord lengths are copied');
  assert.equal(add('[CE]', 'E'), '[CE]', 'A pitch already there is not added');
  assert.equal(add('z2', 'E'), 'z2', 'Rests are left alone');
  // respell (Z): the next spelling at the same pitch, keeping length, ties and decorations.
  const re = (text, k = 'C', options) => context.respell(text, key(k), options),
    cycle = (text, k = 'C') => {
      const seen = [text];
      for (let i = 0; i < 4 && (i === 0 || seen.at(-1) !== text); i++) seen.push(re(seen.at(-1), k));
      return seen.join(' ');
    };
  assert.equal(cycle('^C'), '^C _D ^C', '^C turns into _D and back');
  assert.equal(cycle('E'), 'E _F E');
  assert.equal(cycle('C'), 'C ^B, C', 'B sharp is a letter lower, in the octave below');
  assert.equal(cycle('b'), "b _c' b", 'C flat is in the octave above');
  assert.equal(cycle('D'), 'D __E ^^C D', 'D, G and A cycle through double accidentals');
  assert.equal(re('[^C^F]2'), '[_D_G]2', 'Every pitch of a chord');
  assert.equal(re('[C2E2]'), '[^B,2_F2]', 'Per-pitch chord lengths stay');
  assert.equal(re('!f!"Am"(^c/2-'), '!f!"Am"(_d/2-', 'Decorations, chord symbol, slur, length and tie stay');
  assert.equal(re('z2'), 'z2', 'Rests are left alone');
  assert.equal(cycle('C', 'D'), 'C _D C', 'In D major a plain C is C sharp, and comes back plain');
  assert.equal(cycle('B', 'F'), 'B ^A B', 'In F major a plain B is B flat');
  assert.equal(re('=C', 'D'), '^B,', 'A natural against the key');
  assert.equal(re('^B,', 'D'), '=C', 'Back to C natural needs the natural sign in D major');
  assert.equal(re('C', 'C', {midis: [61]}), '_D', 'midis: an earlier ^C in the bar makes this C sharp');
  assert.equal(re('_D', 'D', {explicit: true}), '^C', 'explicit writes the accidental the key would give');
  assert.equal(re('__D'), 'C', 'A spelling outside the cycle goes to the plainest one');
  // A chord moves as one and comes back in two presses: D, G and A stay plain unless the chord is nothing else.
  assert.equal(cycle('[GCE]'), '[GCE] [G^B,_F] [GCE]');
  assert.equal(cycle('[A^CE]'), '[A^CE] [A_D_F] [A^CE]');
  assert.equal(cycle('[^CE^G]'), '[^CE^G] [_D_F_A] [^CE^G]', 'C sharp minor as D flat minor');
  assert.equal(cycle('[DG]'), '[DG] [__E__A] [^^C^^F] [DG]');
  assert.equal(re('[^^CE]'), '[D_F]', 'A double sharp D in a chord goes plain');
  // respellEdit: later notes keep their pitch, and lose an accidental that only the old spelling needed.
  const zFirst = (body, text, k = 'C') => {
    const source = `X:1\nM:4/4\nL:1/4\nK:${k}\n` + body,
      start = source.length - body.length,
      edit = context.respellEdit(source, start, start + body.indexOf(' '), text);
    return (source.slice(0, start) + edit.text + source.slice(edit.end)).slice(start);
  };
  assert.equal(zFirst('^C D E F |]', '_D'), '_D =D E F |]', 'A later D keeps its pitch');
  assert.equal(zFirst('_D =D E F |]', '^C'), '^C D E F |]', 'and loses the natural only D flat needed');
  assert.equal(zFirst('^C C D z |]', '_D'), '_D ^C =D z |]');
  assert.equal(zFirst('_D ^C =D z |]', '^C'), '^C ^C D z |]', 'Only on the letter the note leaves');
  assert.equal(zFirst('C =C E _D |]', '_D', 'D'), '_D =C E _D |]', 'In D major, accidentals the key needs stay');
  assert.equal(zFirst('_D =D =D z | =D4 |]', '^C'), '^C D =D z | =D4 |]', 'Courtesy naturals and later bars stay');
  assert.equal(zFirst('_D [F=D] z2 |]', '^C'), '^C [FD] z2 |]', 'In a chord too');
  assert.equal(zFirst('_D =d z2 |]', '^C'), '^C =d z2 |]', 'Only the same octave');
  // keepLaterPitches: an accidental entered on one note writes out the accidental later notes in the bar had.
  const keep = (body, from, to, text, select = null) => {
    const source = 'X:1\nL:1/4\nK:C\n' + body,
      at = source.length - body.length,
      r = context.keepLaterPitches(source, at + from, at + to, text, select && select.map(x => at + x));
    return [source.slice(at, at + from) + r.text + source.slice(r.end), r.select && r.select.map(x => x - at)];
  };
  assert.deepEqual(keep('z C D C | C', 0, 1, '^C', [3, 4]), ['^C =C D C | C', [3, 5]], 'Only the first later C');
  assert.deepEqual(keep('z c [EC] C', 0, 1, '_C'), ['_C c [E=C] C', null], 'Other octaves keep theirs; chords too');
  assert.deepEqual(keep('z | C', 0, 1, '^C'), ['^C | C', null], 'The next bar is not touched');
  assert.equal(keep('z F G', 0, 1, '=F').join(), '=F F G,', 'A natural against the key: later F is natural anyway');
  const g = (body, ...edit) => {
    const source = 'X:1\nL:1/4\nK:G\n' + body,
      at = source.length - body.length,
      r = context.keepLaterPitches(source, at + edit[0], at + edit[1], edit[2], null);
    return source.slice(at, at + edit[0]) + r.text + source.slice(r.end);
  };
  assert.equal(g('z !f!F2 F', 0, 1, '=F'), '=F !f!^F2 F', 'The key signature sharp is written after decorations');
  assert.equal(g('z ^^G G', 0, 1, '_G'), '_G ^^G G', 'Notes with their own accidental are left alone');
}
// Keys and transposition: key names and signatures, the key menu, intervals, whole-tune and slice transposition.
{
  const parts = v => {
    const k = context.keyParts(v);
    return [k.tonic, k.mode, k.key, k.rest].join('|');
  };
  assert.equal(parts('F clef=bass'), 'F||F| clef=bass', 'Modifiers after the key are kept apart');
  assert.equal(parts('D dorian clef=bass'), 'D|Dor|D dorian| clef=bass');
  assert.equal(parts('Bbm % flat'), 'Bb|m|Bbm| % flat');
  assert.equal(parts('G treble'), 'G||G| treble', 'A clef name is not a mode');
  assert.equal(parts('clef=bass'), '|||clef=bass', 'A clef-only field names no key');
  assert.deepEqual(
    ['C', 'G', 'F#', 'Cb', 'Am', 'Ebm', 'DDor', 'Dmix', 'BLoc', 'FLyd', 'none', 'HP'].map(context.keyFifths),
    [0, 1, 6, -7, 0, -6, 0, 1, 0, 0, 0, null]
  );
  assert.deepEqual(['A minor', 'D dorian clef=bass', 'Gmaj', 'clef=bass'].map(context.canonicalKey), [
    'Am',
    'DDor',
    'G',
    'C'
  ]);
  assert.equal(context.keyLabel('Bb'), 'B♭ major (2♭)');
  assert.equal(context.keyLabel('F#m'), 'F♯ minor (3♯)');
  const keyList = vm.runInContext('KEY_LIST', context),
    groups = name => keyList.filter(k => k.group === name).map(k => k.value);
  assert.equal(groups('Major').length, 15, '15 major keys');
  assert.equal(groups('Minor').length, 15, '15 minor keys');
  assert.ok(groups('Major').includes('C#') && groups('Major').includes('Cb') && groups('Minor').includes('A#m'));
  for (const [mode, value] of [
    ['Dorian', 'DDor'],
    ['Phrygian', 'EPhr'],
    ['Lydian', 'FLyd'],
    ['Mixolydian', 'GMix'],
    ['Locrian', 'BLoc']
  ])
    assert.ok(groups(mode).includes(value), `${mode} mode listed`);
  for (const k of keyList)
    assert.ok(!ABCJS.parseOnly(`X:1\nK:${k.value}\nC|]`)[0].warnings?.length, `${k.value} parses`);
  const move = (a, b) => JSON.stringify(context.keyInterval(a, b));
  assert.equal(move('C', 'F#'), '{"semitones":6,"letters":3}', 'C to F# is an augmented 4th');
  assert.equal(move('C', 'Gb'), '{"semitones":6,"letters":4}', 'C to Gb is a diminished 5th');
  assert.equal(move('C', 'G'), '{"semitones":-5,"letters":-3}', 'The nearer way: down a 4th');
  assert.equal(move('C', 'Em'), move('C', 'G'), 'A minor key moves by its signature');
  const T = (abc, ...a) => context.transposeABC(abc, ...a);
  assert.equal(
    T('X:1\nL:1/4\nK:F\n"F"F "Bb"G|]', 2),
    'X:1\nL:1/4\nK:G\n"G"G "C"A|]',
    'Key, notes and chord symbols move'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:F clef=bass\nE F B c|]', 2),
    'X:1\nL:1/4\nK:G clef=bass\nF G c d|]',
    'clef= survives (strTranspose alone garbles the key)'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:clef=bass\nE F B c|]', 2),
    'X:1\nL:1/4\nK:D clef=bass\nF G c d|]',
    'A clef-only header key is C'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:C\n"C"C ^F "Am"=c {^g}G|]', 6, 3),
    'X:1\nL:1/4\nK:F#\n"F#"F ^B "D#m"^f {^^c\'}c|]',
    'Up an augmented 4th spells in F#'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:C\n"C"C ^F "Am"=c {^g}G|]', 6, 4),
    'X:1\nL:1/4\nK:Gb\n"Gb"G =c "Ebm"_g {=d\'}d|]',
    'Up a diminished 5th spells in Gb'
  );
  assert.equal(T('X:1\nK:B\nB|]', 2), 'X:1\nK:Db\nd|]', 'Seven sharps fall back to five flats');
  assert.equal(T('X:1\nK:B\nB|]', 2, 1, 7), 'X:1\nK:C#\nc|]', 'unless seven are allowed');
  assert.equal(
    T('X:1\nL:1/4\nK:G\nG A|[K:clef=bass] B, C|[K:D] D E|]', -3),
    'X:1\nL:1/4\nK:E\nE F|[K:clef=bass] G, A,|[K:B] B, C|]',
    'Inline key changes move; clef-only fields stay'
  );
  assert.throws(() => T('X:1\nK:HP\nA|]', 2), /Bagpipe/);
  assert.equal(
    T('X:1\nL:1/8\nK:A\n!c2B-A GABG | A4 |]', 9),
    'X:1\nL:1/8\nK:F#\n!a2g-f efge | f4 |]',
    'A lone ! (the old line break) is not a decoration: the note after it moves with the key'
  );
  assert.equal(T('X:1\nT:t\nL:1/4\nC D E F|]', 2), 'X:1\nT:t\nL:1/4\nK:D\nD E F G|]', 'No K: line means C major');
  // strTranspose moves some keys an octave off; every note lands where the interval says.
  assert.equal(T('X:1\nL:1/4\nK:F#\nC D|]', 12), 'X:1\nL:1/4\nK:F#\nc d|]', 'F# major up an octave');
  assert.equal(T('X:1\nL:1/4\nK:Bb\nC D|]', -11), 'X:1\nL:1/4\nK:B\nC, D,|]', 'Bb major down a major 7th');
  assert.equal(T('X:1\nL:1/4\nK:Cb\nC D|]', -12), 'X:1\nL:1/4\nK:Cb\nC, D,|]', 'Cb major down an octave');
  assert.equal(T('X:1\nL:1/4\nK:Cb\nC D|]', 0, 6, 7), 'X:1\nL:1/4\nK:B\nB, C|]', 'Cb major respelled as B major');
  {
    const midi = abc => context.melodyNotes(context.parseMidi(context.midiBytes(abc)).notes).map(n => n.note),
      body = 'C D E F G A B c | ^C _D =E ^F | _G ^A _B c\' | "Am"A "C#m"c "Gb"G2|]',
      wrong = [];
    for (const k of keyList)
      for (let s = -12; s <= 12; s++) {
        const abc = `X:1\nL:1/4\nK:${k.value}\n${body}`,
          from = midi(abc),
          to = midi(T(abc, s));
        if (to.length !== from.length || from.some((p, i) => to[i] - p !== s)) wrong.push(`${k.value} ${s}`);
      }
    assert.deepEqual(wrong, [], 'Every listed key moves every note by the interval, -12 to 12 semitones');
  }
  // Chord symbols move by the interval's letters, not abcjs's spelling (it gives D# for Eb and A#/D for Bb/D).
  assert.equal(
    T('X:1\nL:1/4\nK:F\n"Eb"C "Db"C "Ab/C"C "C#dim"C|]', 2),
    'X:1\nL:1/4\nK:G\n"F"D "Eb"D "Bb/D"D "D#dim"D|]',
    'Chord symbols up a major 2nd'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:C\n"Eb"C "Db"C "Bb7"C "N.C."C|]', 9),
    'X:1\nL:1/4\nK:A\n"C"A "Bb"A "G7"A "N.C."A|]',
    'Up a major 6th; N.C. stays'
  );
  assert.equal(
    T('X:1\nL:1/4\nK:A\n"Eb"C "(E7)"C|]', 9),
    'X:1\nL:1/4\nK:F#\n"C"A "(C#7)"A|]',
    'A key abcjs spells as Gb and FretFree respells as F# keeps its chords natural'
  );
  // Text in chord-symbol position that is not a chord name stays as written, before notes and bar lines; abcjs moved
  // anything starting with A–G (Coda to Doda, (End) to (F#nd), D.C. to E.C.). Chord names it does not know still move.
  for (const [s, body] of [
    [2, 'K:D\n"Coda"D "(End)"E "Fine"F "Dm(maj7)"G "D.C."|"D7alt"A4 "Fine"|]'],
    [9, 'K:A\n"Coda"A "(End)"B "Fine"c "Am(maj7)"d "D.C."|"A7alt"e4 "Fine"|]'],
    [-2, 'K:Bb\n"Coda"B, "(End)"C "Fine"D "Bbm(maj7)"E "D.C."|"Bb7alt"F4 "Fine"|]']
  ])
    assert.equal(
      T('X:1\nL:1/4\nK:C\n"Coda"C "(End)"D "Fine"E "Cm(maj7)"F "D.C."|"C7alt"G4 "Fine"|]', s),
      'X:1\nL:1/4\n' + body,
      `Words stay and chords move, ${s} semitones`
    );
  // Chord symbols: parseChordSymbol reads what abcjs can play; setChordSymbol replaces, adds or removes the first one.
  {
    const parse = t => JSON.stringify(context.parseChordSymbol(t));
    for (const name of ['C', 'Cm', 'C7', 'Cmaj7', 'Cm7b5', 'Cdim', 'Caug', 'Csus4', 'C6', 'C9', 'C/E', 'F#m', 'Bb7'])
      assert.ok(context.parseChordSymbol(name), name + ' is a chord symbol');
    for (const name of ['Cm7(b5)', 'C7sus4', 'Cadd9', 'C6/9', 'C-7', 'Cø7', 'C°7', 'C+', 'C13#11', 'Ebmaj7/G', 'B♭7'])
      assert.ok(context.parseChordSymbol(name), name + ' is a chord symbol');
    for (const name of ['Cm(maj7)', 'C7alt', 'Gm9(maj7)', 'Cm/maj7', 'CMaj7', 'CmM7', 'C7(b9,#11)', 'C(add9)', 'C7+'])
      assert.ok(context.parseChordSymbol(name), name + ' is a chord symbol too');
    for (const name of ['H7', 'hello', '', 'c7', 'Cx', 'C/H', 'G7/', 'Am7 D7'])
      assert.equal(context.parseChordSymbol(name), null, JSON.stringify(name) + ' is not');
    for (const name of ['Coda', 'Fine', '(End)', 'End', 'D.C.', 'DC', 'D.S.', 'Bridge', 'Emma', 'Ebb', 'C major'])
      assert.equal(context.parseChordSymbol(name), null, name + ' is a word, not a chord symbol');
    assert.equal(parse('(E7)'), parse('E7'), 'A chord in parentheses is a chord');
    assert.equal(parse('(N.C.)'), parse('N.C.'));
    assert.equal(parse('F#m7b5'), '{"root":"F","accidental":"#","quality":"m7b5","bass":null}');
    assert.equal(parse('Bbmaj7'), '{"root":"B","accidental":"b","quality":"maj7","bass":null}');
    assert.equal(parse('G7/B'), '{"root":"G","accidental":"","quality":"7","bass":"B"}');
    assert.equal(parse('D/F♯'), '{"root":"D","accidental":"","quality":"","bass":"F#"}');
    assert.equal(parse('N.C.'), '{"root":null,"accidental":"","quality":"N.C.","bass":null}', 'N.C. is no chord');
    const tidy = context.tidyChordSymbol;
    assert.deepEqual(
      ['  Bb7 ', 'bb7', 'g/b', 'nc', 'n.c.', 'say "hi"', '^G', 'hello'].map(t => tidy(t)),
      ['Bb7', 'Bb7', 'G/B', 'N.C.', 'N.C.', 'say hi', 'G', 'hello'],
      'Typed symbols are tidied'
    );
    assert.deepEqual(
      ['rit. 80%', 'C\\', 'B\\b7'].map(t => tidy(t)),
      ['rit. 80', 'C', 'Bb7'],
      'No % (a comment to abcjs) or backslash (an escape that can swallow the closing quote)'
    );
    const set = context.setChordSymbol;
    assert.equal(set('C', 'Bb7'), '"Bb7"C', 'A new symbol goes in front');
    assert.equal(set(' C2 ', 'G'), ' "G"C2 ', 'after any leading space');
    assert.equal(set('"F"!f!(C', 'G7'), '"G7"!f!(C', 'An existing symbol is replaced');
    assert.equal(set('"^intro""F"C', 'G'), '"^intro""G"C', 'A text annotation is left alone');
    assert.equal(set('"^intro"C', 'G'), '"G""^intro"C', 'and is not taken for a chord symbol');
    assert.equal(set('"F"!f!C-', null), '!f!C-', 'null removes it');
    assert.equal(set('"F"C', ''), 'C', 'and so does an empty name');
    assert.equal(set('"F""G"[CEG]2', 'Am'), '"Am""G"[CEG]2', 'Only the first one changes');
    assert.equal(set('z2', 'N.C.'), '"N.C."z2', 'Rests take symbols');
    assert.equal(set('x', 'D7'), '"D7"x', 'and so do invisible rests');
    assert.equal(set('|', 'D7'), '|', 'A bar line does not');
    assert.equal(set('C', 'say "hi"'), '"say hi"C', 'Quotes cannot end the symbol early');
    for (const typed of ['rit. 80%', 'C\\'])
      assert.equal(
        ABCJS.parseOnly(`X:1\nL:1/4\nK:C\n${set('C', typed)} D E F|G A B c|]`)[0].lines[0].staff[0].voices[0].filter(
          e => e.el_type === 'note'
        ).length,
        8,
        JSON.stringify(typed) + ' leaves every note on the line'
      );
    assert.equal(context.chordSymbolOf('"_C""^x""G7"!f!.C'), 'G7');
    assert.equal(context.chordSymbolOf('"^x"C'), null);
    const tc = (name, ...a) => context.transposeChordSymbol(name, ...a);
    assert.deepEqual(
      ['C7', 'Bb7/D', 'F#m7b5', 'Db', 'N.C.', 'hello', '(A7)'].map(n => tc(n, 2)),
      ['D7', 'C7/E', 'G#m7b5', 'Eb', 'N.C.', 'hello', '(B7)'],
      'Up a major 2nd'
    );
    assert.equal(tc('C7', -2, -1), 'Bb7', 'Written C7 on a B-flat instrument is concert Bb7');
    assert.equal(tc('Gmaj7', -9, -5), 'Bbmaj7', 'Written Gmaj7 on an E-flat instrument is concert Bbmaj7');
    assert.equal(tc('Cb', -2, -1), 'A', 'A name that would need a double flat (Bbb) takes the next letter');
    assert.deepEqual(
      ['Coda', 'Fine', '(End)', 'D.C.', 'Cm(maj7)', 'C7alt', ' G7'].map(n => tc(n, -2, -1)),
      ['Coda', 'Fine', '(End)', 'D.C.', 'Bbm(maj7)', 'Bb7alt', ' F7'],
      'Words stay; every chord parseChordSymbol reads moves'
    );
    // Chords off leaves out the accompaniment channel; the melody is unchanged.
    const lead = 'X:1\nM:4/4\nL:1/4\nK:C\n"C"C D E F | "G7"G A B c |]',
      withChords = context.parseMidi(context.midiBytes(lead)).notes,
      without = context.parseMidi(context.midiBytes(lead, {chordsOff: true})).notes;
    assert.ok(withChords.length > 8 && new Set(withChords.map(n => n.ch)).size === 2, 'Chord symbols play');
    assert.deepEqual(
      without.map(n => [n.ch, n.note, n.start.toFixed(4)]),
      context.melodyNotes(withChords).map(n => [n.ch, n.note, n.start.toFixed(4)]),
      'chordsOff plays only the melody'
    );
    // Only chord names play: abcjs played Coda as a C chord and D.C. as a D chord, and carried G on through N.C.
    const accompaniment = music => {
      const notes = context.parseMidi(context.midiBytes(`X:1\nM:4/4\nL:1/4\nK:C\n${music}`)).notes,
        melody = new Set(context.melodyNotes(notes));
      return notes.filter(n => !melody.has(n));
    };
    for (const word of ['Coda', 'Fine', '(End)', 'D.C.', 'hello'])
      assert.equal(accompaniment(`"${word}"C D E F|G4|]`).length, 0, word + ' does not play');
    for (const chord of ['(E7)', 'Cm(maj7)', 'C7alt'])
      assert.ok(accompaniment(`"${chord}"C D E F|G4|]`).length > 0, chord + ' plays');
    assert.ok(
      accompaniment('"G"C D E F|"N.C."G4|]').every(n => n.start < 1),
      'N.C. stops the accompaniment'
    );
    assert.ok(
      accompaniment('"G"C D E F|"N.C."G2 "C"G2|]').some(n => n.start >= 1.25),
      'until the next chord'
    );
    assert.ok(
      accompaniment('"G"C D E F|"Fine"G4|]').some(n => n.start >= 1),
      'A word leaves the chord playing'
    );
  }
  const W = (abc, s) => context.writtenSteps(abc, abc.length - 3, s);
  assert.deepEqual(
    [W('X:1\nK:E\nC|]', 2), W('X:1\nK:F#\nC|]', 2), W('X:1\nK:C#\nC|]', 9), W('X:1\nK:C\nC|]', -12)],
    [1, 2, 6, -7],
    'Written letters follow the written key: F# major on a B-flat instrument is written in Ab'
  );
  assert.equal(context.writtenSteps('X:1\nK:C\nC D|[K:F#] C D|]', 13, 2), 1, 'Each key change has its own letters');
  const S = (...a) => context.transposeSlice(...a);
  assert.equal(S('"F"F G A B|', 'F', '1/4', -3), '"D"D E ^F G|', 'A slice keeps its key signature');
  assert.equal(S('E F ^F F|G', 'G', '1/4', 2), 'F ^G ^G G|A', 'Accidentals carry to the bar line');
  assert.equal(S('c d e f', 'F', '1/4', -3, -2), 'A =B ^c d', 'Signature notes get naturals');
  assert.throws(() => S('C [K:G] D', 'C', '1/4', 2), /changes key/);
  const spans = abc =>
    context
      .measureSpans(ABCJS.parseOnly(abc)[0], 2, 2)
      .map(s => abc.slice(s.start, s.end))
      .join(' / ');
  assert.equal(spans('X:1\nL:1/4\nK:C\nC D | E F | G A |]'), ' E F ', 'One measure, without its bar lines');
  assert.equal(
    spans('X:1\nL:1/4\nK:C\nV:1\nC D | E F | G A |]\nV:2\nc d | e f | g a |]'),
    ' E F  /  e f ',
    'One stretch per voice'
  );
}
// Lyrics: lyricUnits and alignLyrics read w: lines exactly as abcjs does (checked on generated music and words full of
// rests, skips, bar jumps, holds and escapes), lyricText writes a verse back so abcjs reads the same syllables,
// setSyllable changes one syllable and keeps every verse on its own row (with key and time changes starting the next
// line too), typeLyrics follows the typing keys, and the lieder take a word on every note.
{
  const ABCJS_ = context.ABCJS,
    rows = (abc, voice = '0:0') => {
      const tune = ABCJS_.parseOnly(abc)[0];
      return JSON.parse(
        JSON.stringify(
          context
            .lyricSlots(tune, voice)
            .map(slot =>
              context
                .lyricVerses(abc, slot)
                .verses.map(v => context.verseLyrics(slot, v.text).map(x => x?.syllable || null))
            )
        )
      );
    },
    syllables = (abc, verse = 0, voice = '0:0') =>
      JSON.parse(JSON.stringify(context.voiceLyrics(abc, voice, verse).map(x => x && x.syllable)));
  let seed = 7;
  const random = n => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n),
    pick = list => list[random(list.length)];
  let checked = 0;
  for (let t = 0; t < 300; t++) {
    let music = '';
    for (let i = 0; i < 4 + random(10); i++)
      music += pick(['C', 'D', 'z', 'E2', 'z/', '[CE]', 'F-', 'y', 'x', '{g}A', '(3ABc', '|']) + (random(2) ? ' ' : '');
    const verses = [];
    for (let v = 0; v < 1 + random(3); v++) {
      let w = '';
      for (let i = 0; i < random(12); i++)
        w += pick(['la', 'Twin', ' ', ' ', '-', '_', '*', '|', '~', 'a~b', '\\-', 'x', ' - ', '__']);
      verses.push('w:' + w);
    }
    const abc = 'X:1\nK:C\nL:1/8\n' + music + '|\n' + verses.join('\n') + '\n',
      tune = ABCJS_.parseOnly(abc)[0];
    for (const slot of context.lyricSlots(tune, '0:0')) {
      const found = context.lyricVerses(abc, slot).verses,
        stacked = new Map();
      for (const v of found)
        for (const [e, x] of context.alignLyrics(slot.elements, context.lyricUnits(v.text)))
          stacked.set(e, [...(stacked.get(e) || []), x]);
      for (const e of slot.elements)
        assert.equal(
          JSON.stringify(stacked.get(e) || []),
          JSON.stringify(context.readLyrics(e)),
          'Syllables as abcjs reads them in ' + JSON.stringify(abc)
        );
      for (const v of found) {
        const only = list => list.map(x => (x?.syllable ? x : null)),
          entries = only(context.verseLyrics(slot, v.text)),
          // A hold (_) cannot be kept when the next note has a syllable of its own.
          kept = list => list.map((x, i) => x && {...x, divider: x.divider === '_' && list[i + 1] ? ' ' : x.divider});
        assert.deepEqual(
          kept(only(context.verseLyrics(slot, context.lyricText(slot, entries)))),
          kept(entries),
          'A verse written back reads the same: ' + JSON.stringify(v.text)
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 300, 'Enough verses checked');
  const twinkle = 'X:1\nM:4/4\nL:1/4\nK:C\nCCGG|AAG2|\nFFEE|DDC2|]\n';
  let abc = twinkle;
  for (const [i, s, d] of [
    [0, 'Twin', '-'],
    [1, 'kle', ' '],
    [2, 'twin', '-'],
    [3, 'kle', ' ']
  ])
    abc = context.setSyllable(abc, 0, 0, i, s, d);
  assert.equal(abc, twinkle.replace('G2|\n', 'G2|\nw: Twin-kle twin-kle\n'), 'Four syllables under four notes');
  abc = context.setSyllable(abc, 0, 1, 1, 'a', '-');
  assert.equal(abc.split('\n')[6], 'w: * a-', 'A second verse pads the notes before it with *');
  abc = context.setSyllable(abc, 0, 2, 6, 'star', ' ');
  assert.deepEqual(
    abc.split('\n').slice(5, 9),
    ['w: Twin-kle twin-kle * * *', 'w: * a- * * * * *', 'w: * * * * * * star', 'FFEE|DDC2|]'],
    'Earlier verses reach as far as later ones, so abcjs keeps each on its own row'
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(ABCJS_.parseOnly(abc)[0].lines[0].staff[0].voices[0].at(-2).lyric)).map(l => l.syllable),
    ['', '', 'star']
  );
  const edited = context.setSyllable(abc, 0, 0, 2, 'TWIN', '-');
  assert.equal(edited.replace('TWIN', 'twin'), abc, 'Editing one syllable changes only that syllable');
  abc = context.setSyllable(abc, 0, 2, 6, '', ' ');
  abc = context.setSyllable(abc, 0, 1, 1, '', ' ');
  assert.equal(abc, twinkle.replace('G2|\n', 'G2|\nw: Twin-kle twin-kle * * *\n'), 'Empty verses at the end go');
  assert.equal(context.setSyllable(twinkle, 1, 0, 0, 'How', ' '), twinkle + 'w: How\n', 'The second line has its own');
  assert.equal(context.setSyllable(twinkle, 0, 0, 9, 'x'), twinkle, 'A note past the line changes nothing');
  // Rests are passed over; a skip that a rest would take gets one of its own; marks typed in a syllable stay plain.
  const rests = 'X:1\nL:1/4\nK:C\nC z D E|z F G z|]';
  assert.equal(context.setSyllable(rests, 0, 0, 3, 'la'), rests + '\nw: * * * * la', 'The rests between take a * each');
  assert.deepEqual(syllables(rests + '\nw: * * * * la'), [null, null, null, 'la', null]);
  assert.equal(context.setSyllable(rests, 0, 0, 1, 'mid-day'), rests + '\nw: * mid\\-day');
  assert.deepEqual(syllables(rests + '\nw: * mid\\-day'), [null, 'mid-day', null, null, null]);
  assert.equal(context.setSyllable(rests, 0, 0, 0, 'O 100%'), rests + '\nw: O~100', 'Spaces as ~, % dropped');
  // Words already written stay as written in the lines and verses not changed, + lines and comments included.
  const kept = 'X:1\nL:1/4\nK:C\nC D E F|\n% words\nw: do | re\nw:mi fa\nG A B c|]\nw: sol';
  assert.equal(
    context.setSyllable(kept, 0, 1, 3, 'so'),
    kept.replace('w:mi fa', 'w:mi fa * so'),
    'Only the changed verse is written again'
  );
  assert.deepEqual(rows(kept), [
    [
      ['do', null, null, null],
      ['mi', 'fa', null, null]
    ],
    [['sol', null, null, null]]
  ]);
  // Two voices: each voice's line takes its own w: lines.
  const duet = 'X:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nC D E F|\nV:2\nC, D, E, F,|]\n';
  const both = context.setSyllable(context.setSyllable(duet, 0, 0, 0, 'hi', ' ', '0:0'), 0, 0, 1, 'lo', ' ', '1:0');
  assert.equal(both, 'X:1\nL:1/4\nV:1\nV:2\nK:C\nV:1\nC D E F|\nw: hi\nV:2\nC, D, E, F,|]\nw: * lo\n');
  assert.deepEqual(syllables(both, 0, '1:0'), [null, 'lo', null, null]);
  // Typing: space, -, _ and * from a note, across lines, and the space after -, _ or * that only separates.
  let typed = context.typeLyrics(twinkle, '0:0', 0, 0, 'Twin-kle twin-kle lit-tle star How I won');
  assert.deepEqual(
    [typed.abc.split('\n').filter(l => l.startsWith('w:')), typed.pos, typed.rest],
    [['w: Twin-kle twin-kle lit-tle star', 'w: How I'], 9, 'won'],
    'Typing goes on to the next line'
  );
  typed = context.typeLyrics(twinkle, '0:0', 0, 0, 'Ah_ men * * so-');
  assert.deepEqual(
    [typed.abc.split('\n')[5], typed.pos, typed.after],
    ['w: Ah_ men * * so-', 6, true],
    '_ holds a syllable over the next note, * leaves a note out, a space after them only separates'
  );
  typed = context.typeLyrics(twinkle, '0:0', 0, 0, 'Ky- - ri ');
  assert.equal(typed.abc.split('\n')[5], 'w: Ky - ri', '- with nothing typed carries the word on');
  typed = context.typeLyrics(twinkle + 'w: a b c d e f g\n', '0:0', 0, 11, ' *');
  assert.deepEqual(
    [typed.abc.split('\n').at(-2), typed.pos],
    ['w: a b c d e * g', 13],
    'A space passes a note as it is; * takes a syllable away'
  );
  typed = context.typeLyrics(twinkle, '0:0', 0, 12, 'star end more ');
  assert.deepEqual([typed.abc.split('\n').at(-2), typed.pos], ['w: * * * * * star end', 14], 'and stops at the end');
  // The hint about notes added under words compares the notes of each line that has words.
  assert.deepEqual(JSON.parse(JSON.stringify(context.lyricLines(both))), [
    {voice: '0:0', line: 0, notes: 4, words: 'hi'},
    {voice: '1:0', line: 0, notes: 4, words: '* lo'}
  ]);
  // abcjs gives a field that starts the next line of music ([M:3/4], [K:G] or a K: line) to the line before, but that
  // line's words go straight under its music, and the next line keeps its own.
  const engraved = (abc, voice = '0:0') =>
    ABCJS_.parseOnly(abc)[0]
      .lines.flatMap(l => l.staff?.[voice[0]]?.voices?.[voice[2]] || [])
      .filter(e => e.el_type === 'note' && e.rest === undefined)
      .map(e => (e.lyric || []).map(x => x.syllable).join('/') || null);
  for (const next of ['[M:3/4] d e f | a b c |', '[K:G] d e f g | a b c d |', 'K:G\nd e f g | a b c d |']) {
    const music = 'X:1\nL:1/4\nK:C\nC D E F | G A B c |\n' + next + '\n',
      worded = music + 'w: keep me safe here ok\n',
      count = engraved(music).length,
      one = context.setSyllable(worded, 0, 0, 0, 'hi');
    assert.equal(one, worded.replace('c |\n', 'c |\nw: hi\n'), 'Words for a line go under it: ' + next);
    assert.deepEqual(
      engraved(one),
      ['hi', ...Array(7).fill(null), 'keep', 'me', 'safe', 'here', 'ok', ...Array(count - 13).fill(null)],
      'and the next line keeps its words'
    );
    const letters = [...'abcdefghijklmnop'];
    typed = context.typeLyrics(music, '0:0', 0, 0, letters.join(' ') + ' ');
    assert.deepEqual(engraved(typed.abc), letters.slice(0, count), 'Typing over both lines puts each word on its note');
    assert.equal(typed.over, count < letters.length, 'and says when words were left over');
  }
  // Fields and comments between a line and its words are passed over, as abcjs does; a V: field ends them.
  const field = 'X:1\nL:1/4\nK:C\nC D E F|\nK:G\n% words\nw: a b\nd e f g|\n';
  assert.equal(context.setSyllable(field, 0, 0, 2, 'c'), field.replace('a b', 'a b c'));
  assert.equal(context.setSyllable(field, 0, 1, 0, 'x'), field.replace('a b\n', 'a b\nw: x\n'));
  assert.deepEqual(engraved(context.setSyllable(field, 0, 1, 0, 'x')), ['a/x', 'b', ...Array(6).fill(null)]);
  assert.deepEqual(rows('X:1\nL:1/4\nK:C\nC D E F|\nV:2\nw: lo\nc d e f|\n'), [[], []], 'abcjs drops these');
  // A voice written after & shares the staff's w: lines with the first voice, so it takes no words of its own; a voice
  // of its own on the same staff does.
  const overlay = 'X:1\nL:1/4\nK:C\nC D E F & c d e f|G A B c|\n(C D) & (c d)\n';
  assert.equal(context.lyricSlots(ABCJS_.parseOnly(overlay)[0], '0:1', overlay).length, 0);
  assert.equal(context.typeLyrics(overlay, '0:1', 0, 0, 'a b c d ').abc, overlay, 'Nothing is written for it');
  assert.equal(context.setSyllable(overlay, 0, 0, 0, 'a', ' ', '0:1'), overlay);
  const shared = 'X:1\nL:1/4\n%%score (1 2)\nV:1\nV:2\nK:C\nV:1\nC D E F|\nV:2\nc d e f|\n';
  assert.equal(context.typeLyrics(shared, '0:1', 0, 0, 'a b ').abc, shared + 'w: a b\n');
  assert.deepEqual(engraved(shared + 'w: a b\n', '0:1'), ['a', 'b', null, null]);
  // A backslash makes the next character part of the syllable, as in a w: line.
  typed = context.typeLyrics(twinkle, '0:0', 0, 0, 'mid\\-day a\\_b \\*c\\');
  assert.deepEqual(
    [typed.abc.split('\n')[5], typed.rest, syllables(typed.abc).slice(0, 2)],
    ['w: mid\\-day a\\_b', '*c\\', ['mid-day', 'a_b']]
  );
  // Words for every note of the OpenScore lieder whose lines start with a key or time change: abcjs reads each on its
  // note, the music and its warnings are unchanged, and editing one syllable changes only that one.
  const lieder = context.library.filter(
      s => s.id.startsWith('lieder-') && /\n\[?[KM]:/.test(s.abc.slice(s.abc.indexOf('\nK:') + 1))
    ),
    unworded = abc => abc.replace(/^w:.*\n?/gm, ''),
    warnings = abc => (ABCJS_.parseOnly(abc)[0].warnings || []).length;
  assert.ok(lieder.length > 150, 'Enough lieder checked');
  for (const score of lieder) {
    const words = engraved(score.abc).map((_, i) => 's' + i),
      done = context.typeLyrics(score.abc, '0:0', 0, 0, words.join(' ') + ' ').abc;
    assert.deepEqual(engraved(done), words, score.id + ': one word on each note');
    assert.equal(unworded(done), unworded(score.abc), score.id + ': the music is unchanged');
    assert.equal(warnings(done), warnings(score.abc), score.id + ': no new warnings');
    const mid = words.length >> 1,
      session = context.lyricSession(done, '0:0', 0);
    session.set(mid, {syllable: 'X', divider: ' '});
    words[mid] = 'X';
    assert.deepEqual(engraved(session.text()), words, score.id + ': one syllable edited');
  }
}
// Measure and form tools: bars inserted and deleted in every voice as whole-bar rests in the meter in force, bar lines
// that replace each other, repeats and endings that toggle, form marks, rehearsal letters in order, and time, key and
// clef changes from a measure on. Every construct parses without warnings, and repeats and endings play.
{
  const P = abc => ABCJS.parseOnly(abc)[0],
    H = 'X:1\nM:4/4\nL:1/8\nK:C\n',
    body = abc => abc.slice(abc.indexOf('\n', abc.indexOf('\nK:') + 1) + 1),
    made = [],
    run = (fn, abc, ...args) => {
      const out = context[fn](abc, P(abc), ...args);
      made.push(out);
      return out;
    },
    bars = (abc, measure, side, change) => run('editBars', abc, measure, side, change),
    style = glyph => old => ({glyph, ending: old.ending}),
    repeat = (which, on) => old => ({glyph: context.repeatGlyph(old.glyph, which, on), ending: old.ending}),
    ending = n => old => ({glyph: old.glyph, ending: n}),
    tune = H + 'C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]';
  // Measures as scoreEvents numbers them, with the bar lines on each side.
  {
    const m = context.measureBounds(P(tune), '0:0', 2);
    assert.equal(tune.slice(m.first.startChar, m.last.endChar).trim(), 'G2 A2 B2 c2');
    assert.equal(tune.slice(m.before.startChar, m.bar.endChar), '| G2 A2 B2 c2 |');
    assert.equal(context.measureBounds(P(tune), '0:0', 5), null);
    assert.equal(context.voiceMeasures(P(H + '|: C8 | D8 :|'), '0:0')[0].opens, true, 'A bar line of its own');
  }
  // Insert before measure 3 and after the last; a 3/4 bar gets a 3/4 rest; delete takes the bar line with it.
  assert.equal(body(run('insertMeasure', tune, 3)), 'C2 D2 E2 F2 | G2 A2 B2 c2 | z8 | d2 e2 f2 g2 | c8 |]');
  assert.equal(body(run('insertMeasure', tune, 4, true)), 'C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 | c8 | z8 |]');
  assert.equal(body(run('insertMeasure', tune, 1)), 'z8 | C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]');
  assert.equal(
    body(run('insertMeasure', H + 'C8 | [M:3/4] D6 | E6 |]', 2, true)),
    'C8 | [M:3/4] D6 | z6 | E6 |]',
    'The meter in force after a change'
  );
  assert.equal(body(run('insertMeasure', H + 'C8 | [M:3/4] D6 | E6 |]', 2)), 'C8 | z8 | [M:3/4] D6 | E6 |]');
  assert.equal(body(run('insertMeasure', 'X:1\nM:6/8\nK:C\nC6 | D6', 2, true)), 'C6 | D6 | z6', 'Default L:1/8');
  assert.equal(
    body(run('insertMeasure', 'X:1\nM:5/8\nL:1/8\nK:C\nC4 C |]', 1, true)),
    'C4 C | z4 z |]',
    'abcjs draws no single rest of 5/8, so the bar gets two'
  );
  assert.equal(body(run('insertMeasure', 'X:1\nM:9/8\nL:1/8\nK:C\nC9 |]', 1)), 'z9 | C9 |]');
  assert.equal(body(run('deleteMeasure', tune, 3)), 'C2 D2 E2 F2 | G2 A2 B2 c2 | c8 |]');
  assert.equal(body(run('deleteMeasure', tune, 1)), 'G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]');
  assert.equal(
    body(run('deleteMeasure', tune, 4)),
    'C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 |]',
    'The final bar stays'
  );
  assert.equal(
    body(run('deleteMeasure', H + 'C8 | [M:3/4] [P:A] D6 | E6 |]', 2)),
    'C8 | [M:3/4] E6 |]',
    'A meter change outlives its measure; a rehearsal mark goes with it'
  );
  assert.equal(body(run('deleteMeasure', H + 'C8 |\nD8 |\nE8 |]', 2)), 'C8 |\nE8 |]', 'No blank line is left');
  assert.equal(
    body(run('deleteMeasure', H + 'C8 \\\n| D8 \\\n| E8 :|', 2)),
    'C8 \\\n| E8 :|',
    'A measure over a continued line'
  );
  assert.throws(
    () => context.deleteMeasure(H + 'C8 | D4\nM:3/4\nE4 | F6 |]', P(H + 'C8 | D4\nM:3/4\nE4 | F6 |]'), 2),
    /line of fields/
  );
  assert.equal(body(run('deleteMeasure', H + '|: C8 | D8 :| E8 |]', 2)), '|: C8 :| E8 |]', 'The repeat moves back');
  assert.throws(() => context.deleteMeasure(H + 'C8 |]', P(H + 'C8 |]'), 1), /at least one bar/);
  // The bar lines either side of a deleted measure join: a repeat, double or final bar line that closed it moves back,
  // a repeat or an ending that held only that measure goes, and a start repeat or an ending that opened it moves on.
  for (const [abc, measure, want] of [
    ['C8 || D8 |]', 2, 'C8 |]'],
    ['C8 :| D8 |]', 2, 'C8 :|]'],
    ['C8 |1 D8 :|2 E8 |]', 3, 'C8 |1 D8 :|]'],
    ['C8 |1 D8 :|2 E8 |]', 2, 'C8 :|2 E8 |]'],
    ['|: C8 | D8 |1 E8 | F8 :|2 G8 |]', 3, '|: C8 | D8 |1 F8 :|2 G8 |]'],
    ['|: C8 :| D8 |]', 1, 'D8 |]'],
    ['C8 |: D8 :| E8 |]', 2, 'C8 | E8 |]'],
    ['C8 :| D8', 2, 'C8 :|'],
    ['C8 |\n|: D8 | F8 |\nE8 :|', 2, 'C8 |\n|: F8 |\nE8 :|'],
    ['C8 |\n|: D8 :|\nE8 |]', 2, 'C8 |\nE8 |]'],
    ['C8 :|\n[2 D8 | F8 |\nE8 |]', 2, 'C8 :|\n[2 F8 |\nE8 |]'],
    ['C8 | D8 !fermata!|]', 2, 'C8 |]']
  ])
    assert.equal(body(run('deleteMeasure', H + abc, measure)), want, `Delete measure ${measure} of ${abc}`);
  {
    // A line that held only the measure goes with the words under it; a voice field stays when the lines after it
    // may be in that voice.
    const words = H + 'C D E F |\nw: a b c d\nG A B c |\nw: e f g h\n',
      piano = 'X:1\nL:1/4\n%%score {RH LH}\nV:RH\nV:LH clef=bass\nK:C\n';
    assert.equal(body(run('deleteMeasure', words, 1)), 'G A B c |\nw: e f g h\n');
    assert.equal(body(run('deleteMeasure', words, 2)), 'C D E F |\nw: a b c d\n');
    assert.equal(
      body(
        run(
          'deleteMeasure',
          piano + '[V:RH] C D E F |\nw: a b c d\n[V:LH] C, D, E, F, |\n[V:RH] G A B c |]\n[V:LH] G,4 |]',
          1
        )
      ),
      '[V:RH] G A B c |]\n[V:LH] G,4 |]'
    );
    assert.equal(
      body(run('deleteMeasure', piano + '[V:RH] C4 |\nG4 |]\n[V:LH] C,4 |\nG,4 |]', 1)),
      '[V:RH]\nG4 |]\n[V:LH]\nG,4 |]'
    );
    // Rehearsal letters stay in order.
    assert.equal(body(run('deleteMeasure', H + '[P:A] C8 | [P:B] D8 | [P:C] E8 |]', 2)), '[P:A] C8 | [P:B] E8 |]');
  }
  // Every voice gets the bar, in its own meter and clef; an & overlay is covered by its voice.
  const duet = H + '%%score 1 2\nV:1\nC8 | D8 |\nE8 | F8 |]\nV:2 clef=bass\nC,8 | D,8 |\nE,8 | F,8 |]';
  assert.deepEqual([...context.scoreVoices(P(duet), duet)], ['0:0', '1:0']);
  assert.deepEqual([...context.scoreVoices(P(H + 'C8 & E8 | D8 |]'), H + 'C8 & E8 | D8 |]')], ['0:0']);
  assert.equal(
    body(run('insertMeasure', duet, 3)),
    '%%score 1 2\nV:1\nC8 | D8 |\nz8 | E8 | F8 |]\nV:2 clef=bass\nC,8 | D,8 |\nz8 | E,8 | F,8 |]'
  );
  assert.equal(
    body(run('deleteMeasure', duet, 2)),
    '%%score 1 2\nV:1\nC8 |\nE8 | F8 |]\nV:2 clef=bass\nC,8 |\nE,8 | F,8 |]'
  );
  assert.equal(body(run('insertMeasure', H + 'C8 & E8 | D8 |]', 1, true)), 'C8 & E8 | z8 | D8 |]');
  {
    // A multi-measure rest (Z3) is one measure of its voice but three bars, so the staves no longer line up after it.
    const rest = H + '%%score 1 2\nV:1\nC8 | D8 | E8 | F8 |]\nV:2\nZ3 | F,8 |]';
    for (const edit of [
      () => context.insertMeasure(rest, P(rest), 2),
      () => context.deleteMeasure(rest, P(rest), 1),
      () => context.editBars(rest, P(rest), 2, 'close', style('||')),
      () => context.meterChange(rest, P(rest), 2, '3/4'),
      () => context.keyChange(rest, P(rest), 2, 'G')
    ])
      assert.throws(edit, /out of step/);
    assert.equal(
      body(run('insertMeasure', H + '%%score 1 2\nV:1\nC8 | Z2 | F8 |]\nV:2\nC,8 | Z2 | F,8 |]', 3)),
      '%%score 1 2\nV:1\nC8 | Z2 | z8 | F8 |]\nV:2\nC,8 | Z2 | z8 | F,8 |]',
      'Rests in step'
    );
    // Staves are numbered by place, so a score whose staves change partway through is left to the ABC text.
    const restaffed = duet.replace('V:2 clef=bass', '%%score 1\nV:2 clef=bass');
    assert.throws(() => context.insertMeasure(restaffed, P(restaffed), 2), /staves change/);
    // Edits that would overlap are refused rather than garbling the score.
    assert.throws(
      () =>
        context.spliceAll('abcdef', [
          {start: 1, end: 3, text: 'x'},
          {start: 2, end: 4, text: 'y'}
        ]),
      /does not fit/
    );
  }
  // Bar lines replace each other instead of stacking, and keep the ending they start.
  let x = bars(tune, 2, 'close', style('||'));
  assert.equal(body(x), 'C2 D2 E2 F2 | G2 A2 B2 c2 || d2 e2 f2 g2 | c8 |]');
  x = bars(x, 2, 'close', style('|]'));
  assert.equal(body(x), 'C2 D2 E2 F2 | G2 A2 B2 c2 |] d2 e2 f2 g2 | c8 |]');
  assert.equal(bars(x, 2, 'close', style('|')), tune, 'Back to a single bar line');
  assert.equal(context.replaceBarLine('C |1 D', {startChar: 2, endChar: 4}, '||'), 'C ||1 D');
  assert.equal(context.replaceBarLine('C :| [2 D', {startChar: 2, endChar: 7}, ':|', null), 'C :| D');
  assert.deepEqual(
    ['|', '||', '|:', ':|', '::', '[|', '|]', ''].map(g => [
      context.repeatGlyph(g, 'start', true),
      context.repeatGlyph(g, 'end', true),
      context.repeatGlyph(g, 'start', false),
      context.repeatGlyph(g, 'end', false)
    ]),
    [
      ['|:', ':|', '|', '|'],
      ['||:', ':||', '||', '||'],
      ['|:', '::', '|', '|:'],
      ['::', ':|', ':|', '|'],
      ['::', '::', ':|', '|:'],
      ['[|:', ':|', '[|', '[|'],
      ['|:', ':|]', '|]', '|]'],
      ['|:', ':|', '', '']
    ]
  );
  // Repeats and endings: on the bar line before the measure (written at the start of its line when that has none) or
  // after it, the same on every staff, and off again.
  x = bars(tune, 2, 'open', repeat('start', true));
  assert.equal(body(x), 'C2 D2 E2 F2 |: G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]');
  x = bars(x, 3, 'close', repeat('end', true));
  x = bars(x, 3, 'open', ending('1'));
  x = bars(x, 4, 'open', ending('2'));
  assert.equal(body(x), 'C2 D2 E2 F2 |: G2 A2 B2 c2 |1 d2 e2 f2 g2 :|2 c8 |]');
  assert.equal(body(bars(x, 4, 'open', ending(null))), 'C2 D2 E2 F2 |: G2 A2 B2 c2 |1 d2 e2 f2 g2 :| c8 |]');
  assert.equal(
    body(bars(bars(x, 2, 'open', repeat('start', false)), 3, 'close', repeat('end', false))),
    'C2 D2 E2 F2 | G2 A2 B2 c2 |1 d2 e2 f2 g2 |2 c8 |]'
  );
  assert.equal(
    body(bars(tune, 1, 'open', repeat('start', true))),
    '|: C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]'
  );
  const lines = H + 'C8 |\nD8 |\nE8 |]';
  assert.equal(body(bars(lines, 2, 'open', repeat('start', true))), 'C8 |\n|: D8 |\nE8 |]', 'At the start of its line');
  assert.equal(bars(bars(lines, 2, 'open', repeat('start', true)), 2, 'open', repeat('start', false)), lines);
  assert.equal(body(bars(lines, 3, 'open', ending('2'))), 'C8 |\nD8 |\n[2 E8 |]');
  assert.equal(
    body(bars(duet, 2, 'close', repeat('end', true))),
    '%%score 1 2\nV:1\nC8 | D8 :|\nE8 | F8 |]\nV:2 clef=bass\nC,8 | D,8 :|\nE,8 | F,8 |]'
  );
  // Played: |: A | B |1 C :|2 D |] sounds A B C A B D.
  {
    const notes = abc => [...context.parseMidi(context.midiBytes(abc)).notes].map(n => n.note),
      form = bars(
        bars(
          bars(bars(H + 'A8 | B8 | c8 | d8 |]', 1, 'open', repeat('start', true)), 3, 'close', repeat('end', true)),
          3,
          'open',
          ending('1')
        ),
        4,
        'open',
        ending('2')
      );
    assert.equal(body(form), '|: A8 | B8 |1 c8 :|2 d8 |]');
    assert.deepEqual(notes(form), [69, 71, 72, 69, 71, 74]);
  }
  // Form marks: segno and coda on the first note, Fine and the jumps on the last; a new jump replaces another.
  assert.equal(context.toggleFormMark('"Am"C2', 'segno'), '"Am"!segno!C2');
  assert.equal(context.toggleFormMark('"Am"!segno!C2', 'segno'), '"Am"C2');
  assert.equal(context.toggleFormMark('!D.C.!c2', 'D.S.alcoda'), '!D.S.alcoda!c2');
  assert.equal(context.toggleFormMark('!fine!c2', 'D.C.'), '!D.C.!c2');
  assert.equal(context.toggleFormMark('Sc2', 'segno'), 'c2', 'S is a segno');
  assert.deepEqual([...context.formMarks('O!D.C.alfine!.c2')], ['coda', 'D.C.alfine']);
  for (const name of vm.runInContext('FORM_MARKS', context))
    made.push(H + `C2 D2 E2 ${context.toggleFormMark('F2', name)} |]`);
  // Rehearsal marks are lettered in order; a name of the teacher's own stays.
  x = run('toggleRehearsal', tune, 3);
  assert.equal(body(x), 'C2 D2 E2 F2 | G2 A2 B2 c2 | [P:A] d2 e2 f2 g2 | c8 |]');
  x = run('toggleRehearsal', x, 2);
  assert.equal(body(x), 'C2 D2 E2 F2 | [P:A] G2 A2 B2 c2 | [P:B] d2 e2 f2 g2 | c8 |]');
  assert.equal(body(run('toggleRehearsal', x, 2)), 'C2 D2 E2 F2 | G2 A2 B2 c2 | [P:A] d2 e2 f2 g2 | c8 |]');
  assert.equal(
    body(run('toggleRehearsal', H.replace('K:', 'P:AB\nK:') + 'C8 | [P:Intro] D8 | E8 |]', 3)),
    'C8 | [P:Intro] D8 | [P:C] E8 |]',
    'Named marks are left alone, and the letters of a header P: line are taken'
  );
  assert.equal(vm.runInContext('rehearsalLetter(27)', context), 'BB');
  // A header order of parts (P:AABA) or a letter that comes back makes the letters part names: they stay, and a new
  // mark takes the first letter not in use.
  {
    const parts = H.replace('K:C\n', 'P:AABA\nK:C\nP:A\n') + 'C8 | D8 | E8 |\nP:B\nF8 | G8 |]',
      added = run('toggleRehearsal', parts, 2);
    assert.equal(body(added), 'P:A\nC8 | [P:C] D8 | E8 |\nP:B\nF8 | G8 |]');
    assert.equal(run('toggleRehearsal', added, 2), parts, 'Taken away again');
    assert.equal(body(run('deleteMeasure', added, 2)), 'P:A\nC8 | E8 |\nP:B\nF8 | G8 |]');
    assert.equal(
      body(run('toggleRehearsal', H + '[P:A] C8 | [P:B] D8 | [P:A] E8 | F8 |]', 4)),
      '[P:A] C8 | [P:B] D8 | [P:A] E8 | [P:C] F8 |]'
    );
  }
  // A meter change from measure 3 writes [M:3/4] in every voice; the bar check counts 3/4 from there.
  const four = H + 'C8 | D8 | E6 | F6 | G6 |]';
  x = run('meterChange', four, 3, '3/4');
  assert.equal(body(x), 'C8 | D8 | [M:3/4] E6 | F6 | G6 |]');
  assert.deepEqual(
    [...context.barProblems(P(four))].map(m => m.measure),
    [3, 4, 5],
    'Too short in 4/4'
  );
  assert.deepEqual(
    [...context.barProblems(P(x))].map(m => m.measure),
    [],
    'Full bars of 3/4'
  );
  {
    const five = H + 'C8 | D8 | E8 | F8 | G6 | A6 |]',
      changed = run('meterChange', five, 5, '3/4');
    assert.equal(body(changed), 'C8 | D8 | E8 | F8 | [M:3/4] G6 | A6 |]', 'A meter change at measure 5');
    assert.deepEqual(
      [...context.barProblems(P(five))].map(m => m.measure),
      [5, 6]
    );
    assert.deepEqual(
      [...context.barProblems(P(changed))].map(m => m.measure),
      [],
      '3/4 from measure 5 on'
    );
  }
  assert.equal(run('meterChange', x, 3, '6/8'), x.replace('[M:3/4]', '[M:6/8]'), 'A new meter replaces the old');
  assert.equal(run('meterChange', x, 3, '4/4'), four, 'Back to the meter before: no field');
  assert.equal(run('meterChange', four, 1, 'C|'), four.replace('M:4/4', 'M:C|'), 'From measure 1: the header');
  assert.equal(
    body(run('meterChange', duet, 2, '3/4')),
    '%%score 1 2\nV:1\nC8 | [M:3/4] D8 |\nE8 | F8 |]\nV:2 clef=bass\nC,8 | [M:3/4] D,8 |\nE,8 | F,8 |]'
  );
  // Piano music often switches voices with inline [V:] fields. abcjs gives a time signature written straight after
  // one to another staff, so the voice field moves to a line of its own; the bar check reads the meter there.
  const inline =
    'X:1\nM:4/4\nL:1/4\n%%score {RH LH}\nV:RH clef=treble\nV:LH clef=bass\nK:C\n' +
    '[V:RH] C D E F | G A B c |\n[V:LH] C, D, E, F, | G, A, B, C |\n' +
    '[V:RH] d e f g | c4 |]\n[V:LH] D, E, F, G, | C,4 |]\n';
  {
    const clefs = abc => P(abc).lines.map(l => l.staff.map(s => s.clef.type).join()),
      out = run('meterChange', inline, 3, '3/4');
    assert.equal(
      body(out),
      '[V:RH] C D E F | G A B c |\n[V:LH] C, D, E, F, | G, A, B, C |\n' +
        'V:RH\n[M:3/4] d e f g | c4 |]\nV:LH\n[M:3/4] D, E, F, G, | C,4 |]\n'
    );
    assert.deepEqual(clefs(out), ['treble,bass', 'treble,bass']);
    assert.deepEqual(
      [...context.barProblems(P(out))].map(m => m.voice + ' ' + m.measure),
      ['0:0 3', '0:0 4', '1:0 3', '1:0 4'],
      'Bars of 4 beats in 3/4'
    );
    assert.equal(context.measureBounds(P(out), '1:0', 4).meter.label, '3/4');
  }
  // Key changes: keep the notes, or move them to the new key up to the next key change; a clef after the key stays.
  const keyed = H + 'C2 E2 G2 c2 | C2 E2 G2 c2 | [K:F] F8 |]';
  assert.equal(body(run('keyChange', keyed, 2, 'G')), 'C2 E2 G2 c2 | [K:G] C2 E2 G2 c2 | [K:F] F8 |]');
  assert.equal(body(run('keyChange', keyed, 2, 'G', true)), 'C2 E2 G2 c2 | [K:G] G,2 B,2 D2 G2 | [K:F] F8 |]');
  assert.equal(body(run('keyChange', keyed, 2, 'Eb', true)), 'C2 E2 G2 c2 | [K:Eb] E2 G2 B2 e2 | [K:F] F8 |]');
  assert.equal(body(run('keyChange', H + 'C8 | [K:D clef=bass] D8 |]', 2, 'A')), 'C8 | [K:A clef=bass] D8 |]');
  assert.equal(body(run('keyChange', H + 'C8 | [K:D] D8 |]', 2, 'C')), 'C8 | D8 |]', 'Back to the key before');
  assert.equal(
    run('keyChange', keyed, 1, 'D', true),
    H.replace('K:C', 'K:D') + 'D2 F2 A2 d2 | D2 F2 A2 d2 | [K:F] F8 |]',
    'From measure 1: the header key'
  );
  {
    // abcjs starts a line's later staves in the key its earlier staves reached, so they name their own key.
    const out = run('keyChange', duet, 2, 'G'),
      keys = P(out).lines.map(l => l.staff.map(s => s.key.accidentals.length).join());
    assert.equal(
      body(out),
      '%%score 1 2\nV:1\nC8 | [K:G] D8 |\nE8 | F8 |]\nV:2 clef=bass\n[K:C] C,8 | [K:G] D,8 |\nE,8 | F,8 |]'
    );
    assert.deepEqual(keys, ['0,0', '1,1']);
    assert.equal(context.voiceKeyAt(out, P(out), '1:0', out.indexOf('D,8')), 'G');
    assert.equal(context.voiceKeyAt(out, P(out), '1:0', out.indexOf('C,8')), 'C');
  }
  {
    // With inline [V:] fields a key written straight after one gives the staff the first staff's clef, so the voice
    // field moves to a line of its own: the left hand keeps its bass clef.
    const clefs = abc => P(abc).lines.map(l => l.staff.map(s => s.clef.type).join()),
      keys = abc => P(abc).lines.map(l => l.staff.map(s => s.key.accidentals.length).join()),
      piano =
        'X:1\nM:4/4\nL:1/4\n%%score {RH LH}\nV:RH clef=treble\nV:LH clef=bass\nK:C\n' +
        '[V:RH] C D E F | G A B c | d e f g | c4 |]\n[V:LH] C,, D,, E,, F,, | G,, A,, B,, C, | D, E, F, G, | C,4 |]\n';
    let out = run('keyChange', piano, 3, 'D');
    assert.equal(
      body(out),
      '[V:RH] C D E F | G A B c | [K:D] d e f g | c4 |]\n' +
        'V:LH\n[K:C] C,, D,, E,, F,, | G,, A,, B,, C, | [K:D] D, E, F, G, | C,4 |]\n'
    );
    assert.deepEqual(clefs(out), ['treble,bass']);
    assert.deepEqual(keys(out), ['0,0']);
    out = run('keyChange', inline, 3, 'D');
    assert.deepEqual(clefs(out), ['treble,bass', 'treble,bass'], 'A key at the start of a line');
    assert.deepEqual(keys(out), ['0,0', '2,2']);
    // A staff's second voice takes the staff's key at the start of a line; a key field written there after an inline
    // [V:] field stops abcjs parsing the tune.
    const hymn =
      'X:1\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble\nV:A\nV:T clef=bass\nV:B\nK:F\n' +
      '[V:S] c2 | c c d c |\n[V:A] A2 | A F F F |\n[V:T] C2 | C A, B, A, |\n[V:B] F,2 | F, F, B, F, |\n' +
      '[V:S] c4 |]\n[V:A] A4 |]\n[V:T] C4 |]\n[V:B] F,4 |]\n';
    for (const measure of [2, 3]) {
      out = run('keyChange', hymn, measure, 'D');
      assert.deepEqual(clefs(out), ['treble,bass', 'treble,bass'], `Hymn, key at measure ${measure}`);
      assert.deepEqual(
        [...context.parseMidi(context.midiBytes(out)).notes].map(n => n.note).slice(-4),
        [73, 69, 61, 54],
        'Every voice plays in D'
      );
    }
    // A line that starts with the end of a measure begun on the line before: the later staff names its own key at
    // the very start of its line.
    const carried =
      'X:1\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble\nV:A\nV:T clef=bass\nV:B\nK:F\n' +
      '[V:S] c c d c | c2\n[V:A] A F F F | A2\n[V:T] C A, B, A, | C2\n[V:B] F, F, B, F, | F,2\n' +
      '[V:S] c2 | c4 |]\n[V:A] A2 | A4 |]\n[V:T] C2 | C4 |]\n[V:B] F,2 | F,4 |]\n';
    out = run('keyChange', carried, 3, 'D');
    assert.equal(
      body(out).split('\n').slice(4).join('\n'),
      '[V:S] c2 | [K:D] c4 |]\n[V:A] A2 | [K:D] A4 |]\nV:T\n[K:F] C2 | [K:D] C4 |]\n[V:B] F,2 | [K:D] F,4 |]\n'
    );
    assert.deepEqual(keys(out).at(-1).split(',').map(Number), [1, 1], 'Line 2 starts in F on both staves');
  }
  // Clef changes in one voice; the clef already in force writes nothing.
  assert.equal(
    body(run('clefChange', tune, '0:0', 3, 'bass')),
    'C2 D2 E2 F2 | G2 A2 B2 c2 | [K:clef=bass] d2 e2 f2 g2 | c8 |]'
  );
  for (const clef of ['alto', 'tenor', 'treble-8']) {
    const out = run('clefChange', tune, '0:0', 2, clef);
    assert.equal(context.measureBounds(P(out), '0:0', 2).clef, clef);
  }
  assert.equal(run('clefChange', duet, '1:0', 2, 'bass'), duet, 'Already bass');
  assert.equal(
    body(run('clefChange', duet, '1:0', 2, 'treble')),
    '%%score 1 2\nV:1\nC8 | D8 |\nE8 | F8 |]\nV:2 clef=bass\nC,8 | [K:clef=treble] D,8 |\nE,8 | F,8 |]'
  );
  // Against the clef shown: the cello shows a treble-clef source in the bass clef, so Treble is written and Bass is not.
  assert.equal(
    body(run('clefChange', tune, '0:0', 2, 'treble', 'bass')),
    'C2 D2 E2 F2 | [K:clef=treble] G2 A2 B2 c2 | d2 e2 f2 g2 | c8 |]'
  );
  assert.equal(run('clefChange', tune, '0:0', 2, 'bass', 'bass'), tune);
  assert.equal(
    body(run('clefChange', H + 'C8 | [K:D clef=bass] D8 |]', '0:0', 2, 'alto')),
    'C8 | [K:D clef=alto] D8 |]'
  );
  {
    // Every voice of the staff takes the clef; after an inline [V:] field the voice field moves to a line of its own.
    const shared =
      'X:1\nM:4/4\nL:1/4\n%%score (S A)\nV:S\nV:A\nK:C\n' +
      '[V:S] c d e f | g a b c |\n[V:A] C D E F | G A B c |\n[V:S] c4 |]\n[V:A] C4 |]\n';
    assert.equal(
      body(run('clefChange', shared, '0:1', 2, 'alto')),
      '[V:S] c d e f | [K:clef=alto] g a b c |\n[V:A] C D E F | [K:clef=alto] G A B c |\n[V:S] c4 |]\n[V:A] C4 |]\n'
    );
    const out = run('clefChange', shared, '0:1', 3, 'alto');
    assert.equal(
      body(out),
      '[V:S] c d e f | g a b c |\n[V:A] C D E F | G A B c |\nV:S\n[K:clef=alto] c4 |]\nV:A\n[K:clef=alto] C4 |]\n'
    );
    assert.deepEqual(
      P(out).lines.map(l => l.staff[0].clef.type),
      ['treble', 'alto']
    );
  }
  // A bar line's decorations are not part of its symbol.
  assert.equal(body(bars(H + 'C8 | D8 !fermata!|]', 2, 'close', repeat('end', true))), 'C8 | D8 !fermata!:|]');
  // Every construct the tools write parses without warnings.
  const noisy = made.filter(abc => (P(abc).warnings || []).length);
  assert.deepEqual(noisy, [], 'Measure tools write ABC that parses without warnings');
}
// Writing prompts: every example meets all its goals, and the blank starting score does not.
vm.runInContext(
  fs
    .readFileSync(require.resolve('../prompts.js'), 'utf8')
    .replace('const writingPrompts', 'globalThis.writingPrompts'),
  context
);
for (const prompt of context.writingPrompts) {
  const goals = source => context.checkPrompt(prompt, context.melodyBars(ABCJS.parseOnly(source)[0]));
  const missed = goals(context.promptSource(prompt, prompt.key, prompt.example))
    .filter(g => !g.ok)
    .map(g => g.label);
  assert.equal(missed.join('; '), '', `Prompt ${prompt.id}: example misses goals`);
  assert.ok(
    goals(context.promptSource(prompt)).some(g => !g.ok),
    `Prompt ${prompt.id}: blank score must not pass`
  );
  const otherMeter = context
    .promptSource(prompt, prompt.key, prompt.example)
    .replace(/^M:.*$/m, prompt.meter === '4/4' ? 'M:3/4' : 'M:4/4');
  assert.equal(
    goals(otherMeter)[0].ok,
    false,
    `Prompt ${prompt.id}: changing the meter must not satisfy the bars goal`
  );
}
// New score templates: every template, meter and pickup parses without warnings, has its staves (one voice each),
// and is all whole-bar rests that pass the bar check, the pickup bar excused.
{
  const json = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(
    json(['4/4', '3/4', '2/4', '6/8', '2/2', 'C|', '12/8', '7/8', '5/4'].map(m => context.templateMeter(m).pickups)),
    [3, 2, 1, 1, 1, 1, 3, 3, 3],
    'Pickups are up to 3 beats and shorter than a bar'
  );
  assert.deepEqual(json(context.templateMeter('6/8')), {bar: 0.75, beat: 0.375, beats: 2, unit: '1/8', pickups: 1});
  assert.deepEqual(json(context.templateMeter('C')), {bar: 1, beat: 0.25, beats: 4, unit: '1/4', pickups: 3});
  assert.deepEqual(
    ['C', 'Am', 'EDor', 'BLoc', 'FLyd', 'F#m', 'Bb', 'GMix'].map(k => context.tonicChord(k)),
    ['C', 'Am', 'Em', 'Bdim', 'F', 'F#m', 'Bb', 'G']
  );
  const templates = vm.runInContext('SCORE_TEMPLATES', context);
  assert.deepEqual(json(templates.map(t => t.id)), [
    'melody',
    'lead',
    'piano',
    'duet',
    'melody-bass',
    'satb',
    'quartet'
  ]);
  let built = 0;
  for (const t of templates)
    for (const meter of ['4/4', '3/4', '2/4', '6/8', '2/2', 'C', 'C|', '3/8', '5/4', '7/8', '9/8', '12/8'])
      for (const pickup of [0, 1, 2, 3])
        for (const bars of [1, 5, 9]) {
          const m = context.templateMeter(meter);
          if (pickup > m.pickups) continue;
          const source = context.templateSource({
              template: t.id,
              title: 'T',
              key: 'Eb',
              meter,
              tempo: 90,
              bars,
              pickup
            }),
            label = `${t.id} ${meter} pickup ${pickup} bars ${bars}`,
            tune = ABCJS.parseOnly(source)[0];
          assert.ok(!tune.warnings?.length, `${label}: ${tune.warnings}`);
          assert.ok(
            tune.lines.every(l => l.staff.length === t.staves.length && l.staff.every(st => st.voices.length === 1)),
            `${label}: one voice on each of ${t.staves.length} staves`
          );
          const events = context.scoreEvents(tune).filter(e => e.element.el_type === 'note');
          assert.ok(events.length && events.every(e => e.element.rest), `${label}: rests only`);
          assert.deepEqual(json(context.barProblems(tune)), [], `${label}: bar check`);
          const measures = context.barLengths(tune);
          for (let v = 0; v < t.staves.length; v++) {
            const mine = measures.filter(x => x.voice === v + ':0');
            assert.equal(mine.length, bars + (pickup ? 1 : 0), `${label}: bars in staff ${v + 1}`);
            mine.forEach((x, i) =>
              assert.ok(
                Math.abs(x.length - (pickup && i === 0 ? pickup * m.beat : m.bar)) < 1e-9,
                `${label}: staff ${v + 1} bar ${i + 1} length`
              )
            );
          }
          assert.equal(Buffer.from(context.midiBytes(source).slice(0, 4)).toString(), 'MThd', `${label}: MIDI`);
          built++;
        }
  assert.ok(built > 500, 'Template combinations checked');
  const piano = context.templateSource({template: 'piano', title: 'Study', key: 'G', meter: '3/4', bars: 6});
  assert.equal(
    piano,
    'X:1\nT:Study\nC:\nM:3/4\nL:1/4\nQ:1/4=100\n%%score {RH LH}\nK:G\n' +
      'V:RH clef=treble name="Piano" snm="Pno."\nz3 | z3 | z3 | z3 |\nz3 | z3 |]\n' +
      'V:LH clef=bass\nz3 | z3 | z3 | z3 |\nz3 | z3 |]\n'
  );
  const staves = id =>
    ABCJS.parseOnly(context.templateSource({template: id}))[0].lines[0].staff.map(st => [
      st.clef.type,
      st.title?.[0] || ''
    ]);
  assert.deepEqual(json(staves('satb')), [
    ['treble', 'Soprano'],
    ['treble', 'Alto'],
    ['treble-8', 'Tenor'],
    ['bass', 'Bass']
  ]);
  assert.deepEqual(json(staves('quartet')), [
    ['treble', 'Violin I'],
    ['treble', 'Violin II'],
    ['alto', 'Viola'],
    ['bass', 'Cello']
  ]);
  assert.deepEqual(json(staves('melody-bass')), [
    ['treble', 'Melody'],
    ['bass', 'Bass']
  ]);
  // A duet keeps the student's instrument: its staves name no clef, so both take the one the app puts on K: for a
  // bass instrument.
  const duet = context.templateSource({template: 'duet', key: 'F', bars: 1});
  assert.equal(
    duet,
    'X:1\nT:Untitled\nC:\nM:4/4\nL:1/4\nQ:1/4=100\n%%score [1 2]\nK:F\n' +
      'V:1 name="Part 1" snm="1"\nz4 |]\nV:2 name="Part 2" snm="2"\nz4 |]\n'
  );
  assert.deepEqual(json(staves('duet')), [
    ['treble', 'Part 1'],
    ['treble', 'Part 2']
  ]);
  assert.deepEqual(
    json(ABCJS.parseOnly(duet.replace('K:F', 'K:F clef=bass'))[0].lines[0].staff.map(st => st.clef.type)),
    ['bass', 'bass'],
    'Both duet staves follow the clef on K:'
  );
  // The quick 8-bar melody and the Melody template write the same bars; a lead sheet puts the tonic chord on the
  // first full bar, after the pickup.
  assert.match(context.templateSource({}), /^K:C\nz4 \| z4 \| z4 \| z4 \|\nz4 \| z4 \| z4 \| z4 \|]\n$/m);
  assert.ok(
    context
      .templateSource({template: 'lead', key: 'Dm', meter: '6/8', pickup: 1, bars: 2})
      .endsWith('\nz3 | "Dm"z6 | z6 |]\n')
  );
  // Out-of-range choices are brought into range, and a title cannot add header lines.
  const odd = context.templateSource({title: 'One\nK:G', bars: 100, pickup: 3, meter: '2/4', tempo: 999});
  assert.match(odd, /^T:One K:G$/m);
  assert.match(odd, /^Q:1\/4=200$/m);
  assert.equal(ABCJS.parseOnly(odd)[0].lines.length, 16, '64 bars at most, four to a line');
  assert.match(odd, /^z \| z2 \| /m, 'A 2/4 pickup is one beat');
  assert.match(context.templateSource({title: '  '}), /^T:Untitled$/m);
  assert.equal(
    context.barLengths(ABCJS.parseOnly(context.templateSource({bars: -3}))[0]).length,
    1,
    'At least one bar'
  );
}
// Teacher-written assignments: goals name notes spelled in the written key, every built-in prompt rebuilt as an
// assignment survives validPrompt and still passes on its example, and anything malformed from a link is refused.
{
  const names = key =>
    context
      .keyDegrees(key)
      .map(d => d.name)
      .join(' ');
  assert.equal(names('G'), 'G A B C D E F♯');
  assert.equal(names('Bb'), 'B♭ C D E♭ F G A');
  assert.equal(names('F#m'), 'F♯ G♯ A B C♯ D E E♯', 'Minor adds the raised 7th');
  assert.equal(names('Edor'), 'E F♯ G A B C♯ D', 'Modal keys use their own degrees');
  assert.equal(context.keyScale('Edor').scale, null, 'Only major and minor keys have an inKey scale');
  assert.deepEqual(
    ['G', 'F#m', 'Bbmin', 'Edor', 'Amix'].map(k => context.keyInWords(k)),
    ['G', 'F♯ minor', 'B♭ minor', 'E dorian', 'A mixolydian']
  );
  const json = x => JSON.stringify(x);
  for (const prompt of context.writingPrompts) {
    const goals = prompt.goals.map(({label, ...g}) => g),
      made = context.makeAssignment({...prompt, goals});
    assert.match(made.id, /^custom-[a-z0-9]+$/);
    assert.equal(made.level, 'Custom');
    assert.equal(json(context.validPrompt(JSON.parse(json(made)))), json(made), `${prompt.id}: round trip`);
    const result = context.checkPrompt(
      made,
      context.melodyBars(ABCJS.parseOnly(context.promptSource(prompt, prompt.key, prompt.example))[0])
    );
    assert.ok(
      result.every(g => g.ok),
      `${prompt.id} as an assignment: ${result
        .filter(g => !g.ok)
        .map(g => g.label)
        .join('; ')}`
    );
  }
  const base = context.makeAssignment({
    title: 'Echo',
    text: 'Answer the phrase.',
    meter: '3/4',
    unit: '1/8',
    key: 'D',
    tempo: 96,
    bars: 8,
    goals: [
      {type: 'bars'},
      {type: 'lengths', allowed: [0.25, 0.5, 0.75]},
      {type: 'endBar', bar: 4, degree: 7},
      {type: 'range', max: 12},
      {type: 'inKey', scale: 'major'},
      {type: 'atLeast', kind: 'rest', count: 1}
    ]
  });
  assert.equal(
    base.goals.map(g => g.label).join(' / '),
    'Fill all 8 bars with notes / Use only quarter, half and dotted half notes / Bar 4 ends on A / Stay within one octave / Stay in D major / Use at least one rest'
  );
  assert.equal(
    context.makeAssignment({...base, bars: 1, goals: [{type: 'bars'}]}).goals[0].label,
    'Fill the bar with notes',
    'One bar is not "all 1 bars"'
  );
  assert.equal(
    context.makeAssignment({...base, goals: base.goals}).id,
    context.makeAssignment({...base, goals: base.goals}).id,
    'The same assignment always gets the same id'
  );
  const plain = JSON.parse(json(base)),
    refused = {
      'unknown goal type': {...plain, goals: [{type: 'compose-for-me', label: 'x'}]},
      'inherited goal type': {...plain, goals: [{type: 'constructor', label: 'x'}]},
      'inherited atLeast kind': {...plain, goals: [{type: 'atLeast', kind: 'toString', count: 1, label: 'x'}]},
      'string bars': {...plain, bars: '8'},
      'fractional bars': {...plain, bars: 2.5},
      'infinite tempo': {...plain, tempo: Infinity},
      'oversized text': {...plain, text: 'x'.repeat(2001)},
      'oversized title': {...plain, title: 'x'.repeat(121)},
      'empty title': {...plain, title: '  '},
      'bar past the end': {...plain, goals: [{type: 'endBar', bar: 9, degree: 0, label: 'x'}]},
      'degree out of range': {...plain, goals: [{type: 'end', degree: 12, label: 'x'}]},
      'null length': {...plain, goals: [{type: 'lengths', allowed: [null], label: 'x'}]},
      'NaN length': {...plain, goals: [{type: 'lengths', allowed: [NaN], label: 'x'}]},
      'NaN degree': {...plain, goals: [{type: 'start', degree: NaN, label: 'x'}]},
      'bad id': {...plain, id: 'first-melody'},
      'bad key': {...plain, key: 'K:C\nX:2'},
      'bad meter': {...plain, meter: 'C'},
      'too many goals': {...plain, goals: Array(13).fill({type: 'steps', label: 'x'})},
      'array instead of object': [plain]
    };
  for (const [why, q] of Object.entries(refused)) assert.equal(context.validPrompt(q), null, `Refuses ${why}`);
  assert.equal(context.validPrompt(null), null);
  const cleaned = context.validPrompt({
    ...plain,
    text: 'x'.repeat(2000),
    onload: 'alert(1)',
    goals: [{type: 'steps', label: 'Anything you like', extra: '<img src=x onerror=alert(1)>'}]
  });
  assert.equal(
    json(cleaned.goals),
    json([{type: 'steps', label: 'Move only by step or repeat a note'}]),
    'Unknown fields are dropped and labels are rebuilt from the goal'
  );
  assert.ok(!('onload' in cleaned), 'Unknown top-level fields are dropped');
  assert.equal(cleaned.text.length, 2000, '2,000 characters of instructions are allowed');
}
// Instrument sounds: every instrument has its own timbre (partials, envelope and vibrato) with a basic wave that is
// never the metronome's square; plucked and struck ones fade while held, winds, strings and voice sustain. The
// written interval above the sound and the playback octave come from shift and sound.
{
  const all = vm.runInContext('instruments', context),
    names = Object.keys(all),
    plucked = ['Guitar', 'Ukulele', 'Bass guitar', 'Piano', 'Glockenspiel'];
  assert.ok(names.length >= 22, 'At least 22 instruments');
  for (const name of ['Voice', 'Viola', 'Double bass', 'Horn in F', 'Tenor sax in B♭', 'Baritone sax in E♭', 'Oboe'])
    assert.ok(all[name], name + ' is listed');
  for (const name of ['Bassoon', 'Tuba', 'Euphonium', 'Ukulele', 'Bass guitar', 'Glockenspiel'])
    assert.ok(all[name], name + ' is listed');
  const timbres = new Set();
  for (const [name, config] of Object.entries(all)) {
    assert.ok(['treble', 'bass', 'alto'].includes(config.clef), name + ' clef');
    assert.ok(['sine', 'triangle', 'sawtooth'].includes(config.wave), name + ' falls back to a basic wave, not square');
    assert.equal(typeof config.family, 'string', name + ' family');
    assert.ok(
      config.partials.length >= 4 && config.partials.every(a => a >= 0 && a <= 1) && config.partials.some(a => a > 0),
      name + ' partials'
    );
    timbres.add(JSON.stringify([config.partials, config.env, config.vibrato]));
    const peak = 0.12,
      held = env => {
        const {steps, stop} = context.noteEnvelope(env, 10, 2, peak);
        assert.ok(
          steps.every(([, level, time], i) => level >= 0 && level <= peak && (!i || time >= steps[i - 1][2])),
          name + ' envelope steps run forward within the peak'
        );
        assert.ok(stop > steps.at(-1)[2] && steps.at(-1)[1] === 0, name + ' releases to silence before it stops');
        return steps.find(([, , time]) => time === 12)[1] / peak;
      };
    if (plucked.includes(name)) assert.ok(config.env.pluck > 0 && held(config.env) < 0.3, name + ' decays');
    else assert.ok(!config.env.pluck && held(config.env) >= 0.7, name + ' sustains');
  }
  assert.equal(timbres.size, names.length, 'Each instrument has a distinct timbre');
  // Very short notes still rise and fall in order.
  for (const env of [all.Flute.env, all.Guitar.env, {}]) {
    const {steps} = context.noteEnvelope(env, 0, 0.02, 0.1);
    assert.ok(
      steps.every(([, , t], i) => !i || t >= steps[i - 1][2]),
      'A 20 ms note keeps its steps in order'
    );
  }
  // The default envelope stops 30 ms after the note, as before.
  assert.equal(context.noteEnvelope({}, 1, 0.5, 0.1).stop, 1.53);
  const sound = name => vm.runInContext('instrumentSound', context)(all[name]),
    written = name => vm.runInContext('writtenAboveSound', context)(all[name]);
  assert.deepEqual(
    ['Flute', 'Clarinet in B♭', 'Cello', 'Trombone', 'Tuba', 'Baritone sax in E♭', 'Double bass', 'Glockenspiel'].map(
      sound
    ),
    [0, 0, -12, -12, -12, -12, -24, 24],
    'Playback octave: -12 only for shift -12 unless sound is set'
  );
  assert.deepEqual(
    [
      'Clarinet in B♭',
      'Trumpet in B♭',
      'Alto sax in E♭',
      'Horn in F',
      'Tenor sax in B♭',
      'Baritone sax in E♭',
      'Cello',
      'Double bass',
      'Glockenspiel',
      'Viola'
    ].map(written),
    [2, 2, 9, 7, 14, 21, 0, 12, -24, 0],
    'Written above sounding'
  );
  assert.deepEqual([2, 7, 8, 9, 11, 12, 13, 14, 16, 21, 24, -7].map(context.intervalPhrase), [
    'a major 2nd',
    'a perfect 5th',
    'a minor 6th',
    'a major 6th',
    'a major 7th',
    'an octave',
    'a minor 9th',
    'a major 9th',
    'a major 10th',
    'an octave and a major 6th',
    'two octaves',
    'a perfect 5th'
  ]);
  // Horn in F is written a fifth above concert and tenor sax a ninth; the transposition keeps the key's spelling.
  const ode = 'X:1\nM:4/4\nL:1/4\nK:F\nF G A B | c4 |]';
  assert.match(context.transposeABC(ode, all['Horn in F'].shift), /K:C\nc d e f \| g4 \|\]/);
  assert.match(context.transposeABC(ode, all['Tenor sax in B♭'].shift), /K:G\ng a b c' \| d'4 \|\]/);
  assert.match(context.transposeABC(ode, all['Baritone sax in E♭'].shift), /K:D\nd e f g \| a4 \|\]/);
  // Vibrato: a detune curve from its delay to the note's end, within its depth and fading in from zero.
  assert.equal(context.vibratoCurve(undefined, 2), null);
  assert.equal(context.vibratoCurve(all.Violin.vibrato, 0.3), null, 'Short notes have no vibrato');
  const curve = context.vibratoCurve(all.Violin.vibrato, 2.2);
  assert.ok(
    curve.start === 0.2 &&
      Math.abs(curve.length - 2) < 1e-9 &&
      curve.values[0] === 0 &&
      curve.values.every(v => Math.abs(v) <= all.Violin.vibrato.depth) &&
      Math.max(...curve.values) > all.Violin.vibrato.depth * 0.95,
    'Violin vibrato curve'
  );
  assert.ok(context.vibratoCurve(all.Voice.vibrato, 600).values.length <= 2048, 'Long notes keep a bounded curve');
}
// Turning in: names are cleaned, a link's n/t/x must fit the assignment it carries (g is not read), feedback is
// capped, goals are checked in written pitch, and pasted text gives one code per line.
{
  const prompt = context.makeAssignment({
    title: 'Steps',
    text: '',
    meter: '4/4',
    unit: '1/4',
    key: 'C',
    tempo: 90,
    bars: 2,
    goals: [{type: 'bars'}, {type: 'end', degree: 0}, {type: 'steps'}]
  });
  assert.equal(context.cleanStudentName('  Ana \n\t López  '), 'Ana López', 'Control characters become spaces');
  assert.equal(context.cleanStudentName('x'.repeat(81)), '', 'Names over 80 characters are refused');
  assert.equal(context.cleanStudentName(42), '');
  assert.equal(
    context.cleanStudentName('<img src=x onerror=alert(1)>'),
    '<img src=x onerror=alert(1)>',
    'Kept as text'
  );
  const good = {v: 1, a: 'X:1\nK:C\nC|]', q: prompt, n: ' Sam ', t: 1790000000000, x: prompt.id, g: [1, 0, 1]};
  assert.deepEqual({...context.readSubmission(good, prompt)}, {name: 'Sam', at: 1790000000000, assignment: prompt.id});
  assert.ok(context.readSubmission({...good, g: undefined}, prompt), 'g is optional');
  // The inbox works goals out again from the music, so goal results from before a prompt's goals changed are fine.
  assert.ok(context.readSubmission({...good, g: [1, 1]}, prompt), 'g of another length is ignored');
  assert.ok(context.readSubmission({...good, g: 'x'}, prompt), 'g that is not a list is ignored');
  for (const [why, payload] of Object.entries({
    'no name': {...good, n: '  '},
    'name not text': {...good, n: ['Sam']},
    'time as text': {...good, t: '1790000000000'},
    'fractional time': {...good, t: 1.5},
    'negative time': {...good, t: -1},
    'another assignment': {...good, x: 'custom-other'}
  }))
    assert.equal(context.readSubmission(payload, prompt), null, `Refuses ${why}`);
  assert.equal(context.readSubmission(good, null), null, 'No assignment, no submission');
  assert.equal(context.readFeedback('  Good work.  '), 'Good work.');
  assert.equal(context.readFeedback('x'.repeat(2001)), null);
  assert.equal(context.readFeedback(' '), null);
  assert.equal(context.readFeedback({text: 'x'}), null);
  // Goals and bar checks: two full bars of steps ending on C; a short bar counts once.
  const done = context.submissionChecks('X:1\nM:4/4\nL:1/4\nK:C\nE D C D | E D D C |]', prompt);
  assert.deepEqual([done.met, done.total, done.bars], [3, 3, 0]);
  const short = context.submissionChecks('X:1\nM:4/4\nL:1/4\nK:C\nE D C D | E D | G4 |]', prompt);
  assert.deepEqual([short.met, short.total, short.bars], [0, 3, 1]);
  // A B-flat clarinet writes a tone above concert pitch: concert B-flat ends on the written C the goal asks for.
  const clarinet = context.submissionChecks('X:1\nM:4/4\nL:1/4\nK:Bb\nD C B, C | D C C B, |]', prompt, 2);
  assert.deepEqual(
    clarinet.goals.map(g => g.ok),
    [true, true, true],
    'Goals are checked in written pitch'
  );
  assert.equal(context.submissionChecks('X:1\nK:C\nCDE|]', null).total, 0, 'No prompt, no goals');
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        context.turnInCodes(
          'https://example.org/FretFree/#s=1AbC_-9xyz12\n\n  0QUJDREVGR0g  \nnot a link\nhttps://example.org/#s=2bad\n#s=1short'
        )
      )
    ),
    [
      {line: 1, code: '1AbC_-9xyz12'},
      {line: 3, code: '0QUJDREVGR0g'},
      {line: 4, code: null},
      {line: 5, code: null},
      {line: 6, code: null}
    ]
  );
}
// MusicXML export. The notes of every voice must match the parse: count, sounding length in divisions, and pitch as
// abcjs plays it (midiPitches, or for a tied-over note the pitch its tie started on), after the part's <transpose>.
// A note no single note value fits is written as several, which together must last as long. abcjs's player loses an
// accidental written on a note it does not sound (a tied-over note, or one its tie handling swallows), but the ABC
// rule (and the export) keeps it for the rest of the bar, so later notes of that pitch in that bar are not compared.
{
  const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
  const {DOMParser} = new JSDOM('').window,
    SEMITONES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
  const parseXML = xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    assert.equal(doc.getElementsByTagName('parsererror').length, 0, 'Well-formed MusicXML');
    return doc;
  };
  const kid = (n, name) => [...n.children].find(c => c.tagName === name) || null;
  const exportedVoices = doc => {
    const voices = [];
    for (const part of doc.getElementsByTagName('part')) {
      const byNumber = new Map(),
        transpose = {};
      // getElementsByTagName keeps document order, which jsdom's querySelectorAll('transpose, note') does not.
      for (const n of [...part.getElementsByTagName('*')].filter(x => /^(transpose|note)$/.test(x.tagName))) {
        if (n.tagName === 'transpose') {
          transpose[n.getAttribute('number') || 'all'] =
            +kid(n, 'chromatic').textContent + 12 * +(kid(n, 'octave-change')?.textContent || 0);
          continue;
        }
        if (kid(n, 'grace')) continue;
        const v = +kid(n, 'voice').textContent,
          p = kid(n, 'pitch'),
          midi = p
            ? 12 * (+kid(p, 'octave').textContent + 1) +
              SEMITONES[kid(p, 'step').textContent] +
              +(kid(p, 'alter')?.textContent || 0) +
              (transpose[kid(n, 'staff')?.textContent] ?? transpose.all ?? 0)
            : null;
        if (!byNumber.has(v)) byNumber.set(v, []);
        const list = byNumber.get(v);
        if (kid(n, 'chord')) list.at(-1).pitches.push(midi);
        else list.push({pitches: midi == null ? [] : [midi], duration: +kid(n, 'duration').textContent});
      }
      voices.push(...[...byNumber.keys()].sort((a, b) => a - b).map(k => byNumber.get(k)));
    }
    return voices;
  };
  const matchesParse = (source, item, label) => {
    const xml = context.abcToMusicXML(source, {item}),
      doc = parseXML(xml),
      divisions = +doc.getElementsByTagName('divisions')[0].textContent,
      tune = ABCJS.parseOnly(source)[0];
    tune.setUpAudio();
    const events = context.scoreEvents(tune),
      lengths = context.effectiveDurations(events),
      expected = new Map(),
      retied = new Map(),
      tied = new Map();
    for (const {element: e, key} of events) {
      const voice = key.split(':').slice(0, 2).join(':');
      if (!expected.has(voice)) {
        expected.set(voice, []);
        tied.set(voice, new Map());
      }
      if (e.el_type === 'bar' || !retied.has(voice)) retied.set(voice, new Set());
      if (e.el_type !== 'note' || !(e.duration > 0) || e.rest?.type === 'spacer') continue;
      const skip = (e.pitches || []).some(p => retied.get(voice).has(p.pitch)),
        list = expected.get(voice);
      for (const p of e.pitches || [])
        if (p.accidental && (p.endTie || !e.midiPitches?.length)) retied.get(voice).add(p.pitch);
      // abcjs sounds a tied-over note as part of the previous note, whose tie on the same pitch gives its pitch;
      // midiPitches lists the rest of the chord in order. A tie to another pitch is not compared.
      const sounding = (e.midiPitches || []).map(x => x.pitch),
        swallowed = sounding.length < (e.pitches || []).length,
        pitches = (e.pitches || []).map(p =>
          swallowed && p.endTie ? (p.accidental ? null : tied.get(voice).get(p.pitch)) : sounding.shift()
        );
      if (e.pitches?.length)
        tied.set(voice, new Map(e.pitches.flatMap((p, i) => (p.startTie ? [[p.pitch, pitches[i]]] : []))));
      if (/multimeasure/.test(e.rest?.type || ''))
        for (let i = 0; i < (Math.round(+e.rest.text) || 1); i++) list.push({rest: true, pieces: 1});
      else
        list.push({
          rest: !!e.rest,
          pieces: (context.mxlPieces(e.duration) || [0]).length,
          duration: Math.round(lengths.get(e) * 4 * divisions),
          pitches:
            e.rest || skip || sounding.length || pitches.some(x => x == null) ? null : pitches.sort((a, b) => a - b)
        });
    }
    const got = exportedVoices(doc),
      order = [...expected.keys()].sort(
        (a, b) => a.split(':')[0] - b.split(':')[0] || a.split(':')[1] - b.split(':')[1]
      );
    assert.equal(got.length, order.length, `${label}: one MusicXML voice per ABC voice`);
    order.forEach((voice, i) => {
      const want = expected.get(voice);
      assert.equal(
        got[i].length,
        want.reduce((sum, x) => sum + x.pieces, 0),
        `${label} voice ${voice}: note count`
      );
      let j = 0;
      want.forEach((x, w) => {
        const at = `${label} voice ${voice} note ${w + 1}`,
          pieces = got[i].slice(j, (j += x.pieces));
        if (x.duration != null)
          assert.equal(
            pieces.reduce((sum, n) => sum + n.duration, 0),
            x.duration,
            at + ': duration'
          );
        for (const n of pieces)
          if (x.rest) assert.deepEqual(n.pitches, [], at + ': rest');
          else if (x.pitches?.length)
            assert.deepEqual(
              [...n.pitches].sort((a, b) => a - b),
              x.pitches,
              at
            );
      });
    });
    return {xml, doc};
  };
  const own = context.library.filter(x => /^FretFree /.test(context.scoreCollection(x))),
    others = context.library.filter(x => !own.includes(x)),
    sample = others.filter((x, i) => i % Math.floor(others.length / 200) === 0).slice(0, 200);
  assert.ok(own.length >= 12 && sample.length === 200);
  const licenses = new Set();
  for (const score of [...own, ...sample]) {
    // One O'Neill tune has "L: a/8", which abcjs reads as no note lengths at all; the export says so instead.
    if (
      ABCJS.parseOnly(score.abc)[0].lines.some(l =>
        l.staff?.some(s => s.voices.flat().some(e => Number.isNaN(e.duration)))
      )
    ) {
      assert.throws(() => context.abcToMusicXML(score.abc, {item: score}), /note lengths/);
      continue;
    }
    const {xml, doc} = matchesParse(score.abc, score, score.id),
      license = context.scoreLicense(score),
      field = name => [...doc.getElementsByTagName('miscellaneous-field')].find(f => f.getAttribute('name') === name);
    licenses.add(license);
    const rights = doc.getElementsByTagName('rights')[0]?.textContent || '';
    assert.ok(rights.includes(license) && rights.includes(score.rights), `${score.id}: license and credit in <rights>`);
    assert.equal(
      [...doc.getElementsByTagName('credit')]
        .find(c => kid(c, 'credit-type').textContent === 'rights')
        ?.querySelector('credit-words').textContent,
      context.exportCredit(score),
      `${score.id}: page-1 credit`
    );
    const {abc, ...meta} = score;
    assert.deepEqual(JSON.parse(field('fretfree-rights').textContent), JSON.parse(JSON.stringify(meta)));
    if (license.startsWith('GPL-')) {
      assert.ok(field('fretfree-license-text').textContent.includes('GNU GENERAL PUBLIC LICENSE'), score.id);
      assert.ok(
        field('fretfree-abc-source').textContent.includes(abc.split('\n').at(-1)),
        'GPL editions carry the ABC'
      );
    } else assert.ok(!xml.includes('GNU GENERAL PUBLIC LICENSE'));
  }
  assert.ok(licenses.size >= 5, 'The sample covers several licenses');
  // Fixtures: each notation feature becomes the matching MusicXML element.
  const fixture = [
    'X:1',
    'T:Fixture & <friends>',
    'C:Ann Composer',
    'M:6/8',
    'L:1/8',
    'Q:"Allegro" 3/8=80',
    'K:F',
    '|: "F"!f!(3FG^A c2-c | {/g}A3 !<(! z3 !<)! |1 "Bb7/D"[CEG]2 .d _B=B B :|2 "Am"c6 |]',
    'w: Hel- lo there_ friend, sing'
  ].join('\n');
  const {doc} = matchesParse(fixture, null, 'fixture'),
    all = name => [...doc.getElementsByTagName(name)],
    text = name => all(name).map(n => n.textContent);
  assert.equal(text('work-title')[0], 'Fixture & <friends>');
  assert.equal(text('creator')[0], 'Ann Composer');
  assert.equal(all('rights').length + all('miscellaneous').length, 0, 'A personal score has no rights notice');
  assert.equal(text('fifths')[0], '-1');
  assert.deepEqual([text('beats')[0], text('beat-type')[0]], ['6', '8']);
  assert.deepEqual(
    all('harmony').map(h => [h.querySelector('root-step').textContent, h.querySelector('kind').textContent]),
    [
      ['F', 'major'],
      ['B', 'dominant'],
      ['A', 'minor']
    ],
    'Chord symbols become harmony'
  );
  assert.equal(all('harmony')[1].querySelector('root-alter').textContent, '-1');
  assert.equal(all('harmony')[1].querySelector('bass-step').textContent, 'D');
  assert.deepEqual(
    all('lyric').map(l => l.querySelector('syllabic').textContent + ':' + l.querySelector('text').textContent),
    ['begin:Hel', 'end:lo', 'single:there', 'single:friend,', 'single:sing']
  );
  assert.equal(all('extend').length, 1, 'An underscore holds the syllable');
  assert.deepEqual(
    all('tied').map(t => t.getAttribute('type')),
    ['start', 'stop']
  );
  assert.equal(all('time-modification').length, 3);
  assert.equal(
    all('tuplet')
      .map(t => t.getAttribute('type'))
      .join(),
    'start,stop'
  );
  assert.equal(all('grace')[0].getAttribute('slash'), 'yes');
  assert.ok(all('dynamics')[0].querySelector('f'));
  assert.deepEqual(
    all('wedge').map(w => w.getAttribute('type')),
    ['crescendo', 'stop']
  );
  assert.ok(all('staccato').length === 1 && all('accidental').length === 3);
  assert.deepEqual(
    all('repeat').map(r => r.getAttribute('direction')),
    ['forward', 'backward']
  );
  assert.deepEqual(
    all('ending').map(e => e.getAttribute('number') + ':' + e.getAttribute('type')),
    ['1:start', '1:stop', '2:start', '2:discontinue']
  );
  assert.equal(all('per-minute')[0].textContent, '80');
  assert.equal(all('sound')[0].getAttribute('tempo'), '120', 'Q:3/8=80 is 120 quarter notes a minute');
  assert.equal(all('measure')[0].getAttribute('implicit'), 'yes', 'A short first bar is a pickup');
  // Two staves braced in %%score make one part; key, meter and clef changes and Z rests line up across the staves.
  const piano = [
    'X:1',
    'T:Two hands',
    '%%score {RH | LH}',
    'M:3/4',
    'L:1/4',
    'K:Dm',
    'V:RH name="Piano"',
    'V:LH clef=bass',
    'V:Tenor name="Tenor" clef=treble-8',
    '[V:RH] d e f |[K:G] g a b |[M:2/4] Z2 |]',
    '[V:LH] D, E, F, |[K:G] G, A, B, |[M:2/4] C,2 |[K:clef=treble] D2 |]',
    '[V:Tenor] c3 |[K:G] c3 |[M:2/4] c2 | c2 |]'
  ].join('\n');
  const two = matchesParse(piano, null, 'piano').doc,
    parts = [...two.getElementsByTagName('part')];
  assert.deepEqual(
    [...two.getElementsByTagName('part-name')].map(n => n.textContent),
    ['Piano', 'Tenor']
  );
  assert.equal(parts[0].querySelector('staves').textContent, '2');
  assert.deepEqual(
    [...parts[0].querySelectorAll('clef')].map(c => c.getAttribute('number') + c.querySelector('sign').textContent),
    ['1G', '2F', '2G']
  );
  assert.equal(parts[0].querySelectorAll('backup').length, 4);
  assert.equal(parts[0].querySelectorAll('multiple-rest').length, 0, 'The left hand plays under the Z2 rest');
  assert.deepEqual(
    parts.map(p => p.querySelectorAll('measure').length),
    [4, 4],
    'Parts have the same measures'
  );
  assert.equal(parts[1].querySelector('clef-octave-change').textContent, '-1');
  assert.equal(parts[1].querySelector('octave').textContent, '4', 'treble-8 sounds an octave down, as abcjs plays it');
  assert.equal(two.querySelectorAll('transpose').length, 0, 'An octave clef needs no transposition');
  const pick = (doc, selector) => [...doc.querySelectorAll(selector)],
    noteKinds = doc =>
      pick(doc, 'note').map(
        n =>
          (kid(n, 'rest') ? 'r' : '') +
          (kid(n, 'chord') ? '+' : '') +
          kid(n, 'type')?.textContent +
          '.'.repeat(n.querySelectorAll('dot').length)
      );
  // A length no single note has, like the z5 left when a 6/8 bar is filled, becomes tied notes or several rests.
  const split = matchesParse(
    'X:1\nM:6/8\nL:1/8\nK:C\nd z5 | A5 B | [CE]5 z |\nw: one two three four',
    null,
    'split lengths'
  ).doc;
  assert.deepEqual(noteKinds(split), [
    'eighth',
    'rhalf',
    'reighth',
    'half',
    'eighth',
    'eighth',
    'half',
    '+half',
    'eighth',
    '+eighth',
    'reighth'
  ]);
  assert.deepEqual(
    pick(split, 'tied').map(t => t.getAttribute('type')),
    ['start', 'stop', 'start', 'start', 'stop', 'stop']
  );
  assert.equal(pick(split, 'lyric').length, 4, 'A lyric goes on the first of the tied notes');
  assert.deepEqual(noteKinds(matchesParse('X:1\nM:4/4\nL:1/16\nK:C\nC3 z13 |', null, 'dotted eighth').doc), [
    'eighth.',
    'rhalf.',
    'r16th'
  ]);
  // A tie carries an accidental over the bar line to the same pitch only; slurs open and close in pairs.
  const ties = matchesParse('X:1\nL:1/4\nK:C\n^F2- | F2 [^F^A]2- | [FA] (AB) ^c- d | d- c |]', null, 'ties').doc;
  assert.deepEqual(
    pick(ties, 'note')
      .filter(n => n.querySelector('tie[type="stop"]'))
      .map(n => kid(n, 'pitch').textContent),
    ['F14', 'F14', 'A14'],
    'Tied-over notes keep the sharp; the last c, tied from d, is natural'
  );
  assert.equal(pick(ties, 'note').at(-1).querySelector('pitch').textContent, 'C5');
  assert.deepEqual(
    pick(ties, 'slur').map(n => n.getAttribute('type') + n.getAttribute('number')),
    ['start1', 'stop1']
  );
  // multiple-rest covers the whole part, so it is written only when both hands rest.
  const rests = '%%score {RH | LH}\nM:2/4\nL:1/4\nK:C\nV:RH\nV:LH clef=bass\n[V:RH] Z2 | c d |]\n';
  assert.equal(
    pick(matchesParse('X:1\n' + rests + '[V:LH] z2 | Z | E,F, |]', null, 'both rest').doc, 'multiple-rest')
      .map(n => n.textContent)
      .join(),
    '2'
  );
  assert.equal(
    pick(matchesParse('X:1\n' + rests + '[V:LH] C,2 | D,2 | E,F, |]', null, 'LH plays').doc, 'multiple-rest').length,
    0
  );
  // A text-only tempo shows only its text; abcjs's made-up speed is kept for playback.
  const andante = matchesParse('X:1\nM:6/8\nL:1/8\nQ:"Andante"\nK:C\nCDE FGA |', null, 'Andante').doc;
  assert.deepEqual([pick(andante, 'words')[0].textContent, pick(andante, 'metronome').length], ['Andante', 0]);
  assert.equal(pick(andante, 'sound')[0].getAttribute('tempo'), '120');
  // Playback transposition (transpose=, %%MIDI transpose) keeps the written notes and adds <transpose>; matchesParse
  // checks the sounding pitches against abcjs's.
  const shifted = matchesParse(
    'X:1\nL:1/4\n%%MIDI transpose -12\nK:C\nV:1 transpose=-2\nC D | E F |\nV:2\nC D |[K:clef=treble-8] E F |\nV:3 clef=treble-8\nC D | E F |',
    null,
    'transposed'
  ).doc;
  assert.deepEqual(
    pick(shifted, 'part').map(part =>
      pick(part, 'transpose').map(n => [...n.children].map(c => c.tagName + c.textContent).join(' '))
    ),
    [['diatonic-1 chromatic-2'], ['diatonic0 chromatic0 octave-change-1', 'diatonic0 chromatic0'], []]
  );
  assert.equal(pick(shifted, 'octave')[0].textContent, '4', 'The written notes stay as they are drawn');
  assert.deepEqual(
    [...parts[0].querySelectorAll('fifths')].map(n => n.textContent),
    ['-1', '1']
  );
  assert.throws(() => context.abcToMusicXML('X:1\nT:Empty\nK:C\n'), /no music/);
  assert.ok(
    !/[\f]/.test(
      context.abcToMusicXML(context.library.find(x => context.scoreLicense(x).startsWith('GPL-')).abc, {
        item: context.library.find(x => context.scoreLicense(x).startsWith('GPL-'))
      })
    ),
    'Form feeds in the GPL text are dropped; XML 1.0 forbids them'
  );
  console.log(`MusicXML: ${own.length} FretFree scores, a ${sample.length}-score library sample and fixtures passed`);

  // MusicXML import, round trip: ABC to MusicXML to ABC. For the FretFree scores, abcjs must sound the same notes at
  // the same times (pitch, start and length, ties included), with the same chord symbols and lyrics. For the library
  // sample, exporting the imported ABC again must give the same notes, rests, lyrics and chord symbols as the first
  // export (whose own check above ties it to the parse), and the rights metadata must come back.
  const importXML = (xml, name) =>
    context.musicXMLToABC(new DOMParser().parseFromString(xml, 'application/xml'), {name});
  const heard = source => {
    const tune = ABCJS.parseOnly(source)[0];
    tune.setUpAudio();
    const voices = new Map();
    for (const {element: e, key} of context.scoreEvents(tune)) {
      const id = key.split(':').slice(0, 2).join(':');
      if (!voices.has(id)) voices.set(id, {notes: [], chords: [], lyrics: []});
      const v = voices.get(id);
      if (e.el_type !== 'note') continue;
      for (const p of e.midiPitches || []) v.notes.push(`${p.start.toFixed(4)}:${p.pitch}:${p.duration.toFixed(4)}`);
      for (const c of e.chord || []) if (c.position === 'default') v.chords.push(c.name);
      if (!e.rest) (e.lyric || []).forEach((l, i) => l?.syllable && v.lyrics.push(`${i}:${l.syllable}:${l.divider}`));
    }
    return [...voices.keys()].sort().map(k => voices.get(k));
  };
  // Notes of each voice in an export, read straight from the text: consecutive rests are summed and hidden ones
  // (ABC's x) are skipped, since the import writes space as x and a part's silent measure as a rest.
  const exportedNotes = xml => {
    const divisions = +/<divisions>(\d+)/.exec(xml)[1],
      tag = (n, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(n)?.[1],
      voices = [];
    for (const part of xml.split('<part id=').slice(1)) {
      const byVoice = new Map(),
        transpose = {};
      for (const [n] of part.matchAll(/<transpose[^>]*>.*?<\/transpose>|<note[^>]*>.*?<\/note>/g)) {
        if (n.startsWith('<transpose')) {
          transpose[/number="(\d)"/.exec(n)?.[1] || 'all'] =
            +tag(n, 'chromatic') + 12 * +(tag(n, 'octave-change') || 0);
          continue;
        }
        if (n.includes('<grace') || (n.includes('print-object="no"') && n.includes('<rest'))) continue;
        const voice = +tag(n, 'voice'),
          step = tag(n, 'step'),
          length = +tag(n, 'duration') / divisions,
          midi =
            step &&
            12 * (+tag(n, 'octave') + 1) +
              SEMITONES[step] +
              +(tag(n, 'alter') || 0) +
              (transpose[tag(n, 'staff')] ?? transpose.all ?? 0);
        if (!byVoice.has(voice)) byVoice.set(voice, {notes: [], lyrics: []});
        const v = byVoice.get(voice);
        for (const [l] of n.matchAll(/<lyric.*?<\/lyric>/g))
          v.lyrics.push(
            [/number="(\d+)"/.exec(l)[1], tag(l, 'syllabic'), tag(l, 'text'), l.includes('<extend')].join()
          );
        if (n.includes('<chord/>')) v.notes[v.notes.length - 1].pitches.push(midi);
        else if (!step && v.notes.at(-1)?.rest) v.notes.at(-1).length += length;
        else v.notes.push({rest: !step, pitches: step ? [midi] : [], length});
      }
      voices.push(
        ...[...byVoice.keys()]
          .sort((a, b) => a - b)
          .map(k => ({
            notes: byVoice.get(k).notes.map(x => (x.rest ? 'rest ' : x.pitches.join(',') + ' ') + x.length.toFixed(4)),
            lyrics: byVoice.get(k).lyrics
          }))
      );
    }
    return {voices, harmony: [...xml.matchAll(/<harmony.*?<\/harmony>/g)].map(([h]) => h.replace(/<[^>]+>/g, ''))};
  };
  for (const score of own) {
    const {abc, metadata, skipped} = importXML(context.abcToMusicXML(score.abc, {item: score}), score.id);
    assert.deepEqual(ABCJS.parseOnly(abc)[0].warnings || [], [], `${score.id}: the imported ABC parses cleanly`);
    assert.deepEqual(
      heard(abc),
      heard(score.abc),
      `${score.id}: notes, chord symbols and lyrics survive the round trip`
    );
    assert.equal(skipped.join(), '', `${score.id}: nothing is left out`);
    const {abc: _, ...meta} = score;
    assert.equal(JSON.stringify(metadata), JSON.stringify(meta), `${score.id}: rights metadata comes back`);
  }
  for (const score of sample) {
    let xml;
    try {
      xml = context.abcToMusicXML(score.abc, {item: score});
    } catch {
      continue;
    }
    const {abc, metadata} = importXML(xml, score.id);
    assert.deepEqual(ABCJS.parseOnly(abc)[0].warnings || [], [], `${score.id}: the imported ABC parses cleanly`);
    assert.deepEqual(
      exportedNotes(context.abcToMusicXML(abc, {item: score})),
      exportedNotes(xml),
      `${score.id}: exporting the import again gives the same music`
    );
    const {abc: _, ...meta} = score;
    assert.equal(JSON.stringify(metadata), JSON.stringify(meta), `${score.id}: rights metadata comes back`);
  }
  console.log(
    `MusicXML import: ${own.length} FretFree scores and a ${sample.length}-score library sample round-trip correctly`
  );
}
// Offline use: the web app manifest and icons meet Chrome's install rules, and sw.js only ever talks to its own site.
// The worker runs here against fake caches and a fake server: install, a new deploy, going offline, opened and
// unopened PDFs, and old caches dropped without touching another project's caches on the same origin.
{
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.webmanifest'), 'utf8')),
    html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal(manifest.name, 'FretFree');
  assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'A short name fits under an app icon');
  assert.deepEqual(
    [manifest.id, manifest.start_url, manifest.scope, manifest.display],
    ['./', './', './', 'standalone']
  );
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.equal(html.match(/<meta name="theme-color" content="([^"]+)"/)[1], manifest.theme_color);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" \/>/);
  // A PNG's width and height are bytes 16-23 of its IHDR chunk.
  const pngSize = file => {
    const png = fs.readFileSync(require.resolve('../' + file));
    assert.equal(png.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
    return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
  };
  for (const icon of manifest.icons) {
    assert.ok(!/^(https?:)?\/\//.test(icon.src), `${icon.src} is local`);
    if (icon.type === 'image/png') assert.equal(pngSize(icon.src), icon.sizes, `${icon.src} is ${icon.sizes}`);
    else assert.match(fs.readFileSync(require.resolve('../' + icon.src), 'utf8'), /^<svg/);
  }
  assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
  for (const size of ['192x192', '512x512'])
    assert.ok(
      manifest.icons.some(i => i.sizes === size && i.type === 'image/png' && i.purpose === 'any'),
      size
    );
  assert.ok(
    manifest.icons.some(i => i.purpose === 'maskable'),
    'A maskable icon for Android'
  );
  const source = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  assert.doesNotMatch(source, /https?:|['"`]\/\/|importScripts|\bimport\s*\(/, 'sw.js references no other site');
}
async function offlineWorker() {
  const SCOPE = 'https://student.github.io/fretfree/',
    html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  // The fake server: path -> body. Bodies are strings, and every response is an ordinary same-origin one.
  let files = {},
    online = true,
    cut = null,
    fetched = [];
  const reply = (body, status = 200) => ({
    status,
    ok: status === 200,
    type: 'basic',
    body,
    clone: () => reply(body, status),
    text: async () => body
  });
  const serve = page => {
    files = {'': page, 'index.html': page, 'manifest.webmanifest': '{}', 'RIGHTS.md': '# Rights'};
    for (const icon of ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) files[icon] = icon;
    for (const m of page.matchAll(/(?:src|href)="([^"?]+)\?v=[^"]+"/g)) files[m[1]] = 'asset ' + m[1];
    files['scores/a/score.pdf'] = 'PDF a';
    files['scores/b/score.pdf'] = 'PDF b';
  };
  const fakeFetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    fetched.push(url.href);
    const path = url.pathname.slice(new URL(SCOPE).pathname.length);
    // Offline, or a connection that drops on the files matching cut.
    if (!online || cut?.test(path)) throw new TypeError('Failed to fetch');
    return url.origin === new URL(SCOPE).origin && path in files ? reply(files[path]) : reply('Not found', 404);
  };
  const stores = new Map(),
    keyOf = r => (typeof r === 'string' ? r : r.url);
  const openCache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      async match(r, {ignoreSearch} = {}) {
        const key = keyOf(r),
          base = u => u.split('?')[0];
        const hit = ignoreSearch ? [...map].find(([k]) => base(k) === base(key))?.[1] : map.get(key);
        return hit?.clone();
      },
      async put(r, response) {
        map.set(keyOf(r), response);
      },
      async addAll(urls) {
        for (const url of urls) {
          const response = await fakeFetch(url);
          if (!response.ok) throw new TypeError(`${url} failed`);
          map.set(url, response);
        }
      },
      keys: async () => [...map.keys()].map(url => ({url})),
      delete: async r => map.delete(keyOf(r))
    };
  };
  const caches = {
    open: async name => openCache(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name)
  };
  const handlers = {},
    self = {
      registration: {scope: SCOPE},
      addEventListener: (type, handler) => (handlers[type] = handler),
      skipWaiting: async () => {},
      clients: {claim: async () => {}}
    };
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), {
    self,
    caches,
    fetch: fakeFetch,
    URL,
    console
  });
  // Runs one event to the end, including the work it keeps going with waitUntil.
  const dispatch = async (type, props = {}) => {
    const waits = [];
    let answer = null,
      responded = false;
    handlers[type]({
      ...props,
      waitUntil: p => waits.push(p),
      respondWith: p => {
        responded = true;
        answer = p;
      }
    });
    const response = await answer;
    for (let i = 0; i < waits.length; i++) await waits[i];
    return responded ? response : 'not handled';
  };
  const request = (path, mode = 'cors', headers = {}, method = 'GET') => ({
    url: new URL(path, SCOPE).href,
    method,
    mode,
    headers: new Headers(headers)
  });
  const get = async (path, mode) => {
    try {
      const response = await dispatch('fetch', {request: request(path, mode)});
      return response === 'not handled' ? response : `${response.status} ${response.body}`;
    } catch {
      return 'failed';
    }
  };
  const cached = name => [...(stores.get(name)?.keys() || [])].map(url => url.slice(SCOPE.length));
  const APP = 'fretfree-app-v1:/fretfree/',
    SCORES = 'fretfree-scores-v1:/fretfree/';
  const stamps = page => [...page.matchAll(/(?:src|href)="([^"]+\?v=[^"]+)"/g)].map(m => m[1]);
  serve(html);
  // Install keeps the manifest, the icons and the small assets; the catalogs wait until they are fetched, and the page
  // waits with them until it is complete. Offline before then, the waiting page opens with what there is.
  await dispatch('install');
  const first = stamps(html);
  assert.ok(first.length >= 20 && first.some(s => /^catalog-licensed\.js\?v=/.test(s)));
  assert.deepEqual(
    cached(APP).sort(),
    [
      'index.html?next',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/icon.svg',
      'manifest.webmanifest',
      ...first.filter(s => !s.startsWith('catalog-'))
    ].sort()
  );
  online = false;
  assert.equal(await get('', 'navigate'), '200 ' + html, 'A first visit cut short opens what it has');
  online = true;
  // Activating drops this site's older caches only.
  for (const name of ['fretfree-app-v0:/fretfree/', 'fretfree-app-v0:/other-project/', 'someone-else'])
    await caches.open(name);
  await dispatch('activate');
  assert.deepEqual((await caches.keys()).sort(), [APP, 'fretfree-app-v0:/other-project/', 'someone-else'].sort());
  // The page hands over what it loaded before the worker took charge: only stamped files from this site are kept.
  const replies = [];
  await dispatch('message', {
    data: {
      type: 'keep',
      urls: [...first.map(s => SCOPE + s), 'https://elsewhere.example/x.js?v=1', SCOPE + 'RIGHTS.md']
    },
    source: {postMessage: m => replies.push({...m})}
  });
  assert.deepEqual(replies, [{type: 'kept', kept: first.length, total: first.length}], 'Only stamped files count');
  assert.ok(first.every(s => cached(APP).includes(s)) && !cached(APP).includes('RIGHTS.md'));
  assert.ok(cached(APP).includes('') && !cached(APP).includes('index.html?next'), 'The complete page is the copy');
  // Requests for other sites, and anything but GET, are left to the browser.
  assert.equal(await get('https://elsewhere.example/font.woff'), 'not handled');
  assert.equal(await dispatch('fetch', {request: request('index.html', 'cors', {}, 'POST')}), 'not handled');
  assert.equal(
    await dispatch('fetch', {request: request('scores/a/score.pdf', 'no-cors', {range: 'bytes=0-99'})}),
    'not handled',
    'Range requests (partial PDFs) go straight to the network'
  );
  // A deploy cut short: the new page and its small assets arrive, then the connection drops on the catalogs. The page
  // hears that part of the copy is missing, and offline the old page opens with every asset it loads.
  const cutShort = html.replace(/\?v=\w+/g, '?v=cutshort'),
    catalogs = first.filter(s => s.startsWith('catalog'));
  serve(cutShort);
  cut = /^catalog/;
  assert.equal(await get('', 'navigate'), '200 ' + cutShort);
  for (const s of stamps(cutShort))
    assert.equal(await get(s), s.startsWith('catalog') ? 'failed' : `200 asset ${s.split('?')[0]}`);
  replies.length = 0;
  await dispatch('message', {
    data: {type: 'keep', urls: stamps(cutShort).map(s => SCOPE + s)},
    source: {postMessage: m => replies.push({...m})}
  });
  assert.deepEqual(replies, [{type: 'kept', kept: first.length - catalogs.length, total: first.length}]);
  cut = null;
  online = false;
  assert.equal(await get('', 'navigate'), '200 ' + html, 'Offline, the last complete page opens');
  for (const s of first) assert.equal(await get(s), `200 asset ${s.split('?')[0]}`, `${s} is still there`);
  online = true;
  // A new deploy: the page comes from the network and becomes the offline copy once all its assets are cached; then
  // the assets it no longer loads, including those of the deploy cut short, are dropped.
  const deployed = html.replace(/\?v=\w+/g, '?v=newdeploy');
  serve(deployed);
  assert.equal(await get('', 'navigate'), '200 ' + deployed);
  assert.ok(
    first.every(s => cached(APP).includes(s)),
    'Old assets stay while the new page is incomplete'
  );
  for (const s of stamps(deployed)) await get(s);
  assert.ok(!cached(APP).some(s => first.includes(s)), 'Old stamped assets are dropped');
  assert.ok(!cached(APP).some(s => s.endsWith('?v=cutshort')), 'So are those of the deploy cut short');
  assert.ok(cached(APP).includes('manifest.webmanifest'), 'Unstamped files stay');
  const catalogNow = stamps(deployed).find(s => s.startsWith('catalog-licensed.js'));
  assert.equal(await get(catalogNow), '200 asset catalog-licensed.js');
  // Opening a PDF keeps it; a missing file is not kept. Online, a corrected edition replaces the kept copy.
  assert.equal(await get('scores/a/score.pdf', 'navigate'), '200 PDF a');
  assert.equal(await get('scores/missing.pdf'), '404 Not found');
  assert.equal(await get('RIGHTS.md', 'navigate'), '200 # Rights');
  assert.deepEqual(cached(SCORES), ['scores/a/score.pdf']);
  files['scores/a/score.pdf'] = 'PDF a, corrected';
  assert.equal(await get('scores/a/score.pdf'), '200 PDF a, corrected', 'An opened PDF is fetched again online');
  // Offline: the page (with or without a query), assets, the opened PDF and RIGHTS.md come from the cache.
  online = false;
  fetched = [];
  assert.equal(await get('', 'navigate'), '200 ' + deployed);
  assert.equal(await get('?from=home-screen', 'navigate'), '200 ' + deployed);
  assert.equal(await get('index.html', 'navigate'), '200 ' + deployed);
  assert.equal(await get(catalogNow), '200 asset catalog-licensed.js');
  assert.equal(await get('scores/a/score.pdf', 'navigate'), '200 PDF a, corrected');
  assert.equal(await get('RIGHTS.md', 'navigate'), '200 # Rights');
  assert.equal(await get('scores/b/score.pdf', 'navigate'), 'failed', 'A PDF never opened is not there offline');
  assert.equal(await get('licenses/GPL-2.0.txt', 'navigate'), 'failed', 'Other pages do not turn into the app');
  assert.ok(!fetched.includes(SCOPE + catalogNow), 'Stamped assets are served from the cache without asking');
  console.log(
    'Offline use: manifest, icons, install, activate, keep, a deploy cut short, deploy, offline and PDF caching passed'
  );
}
// MusicXML import from files: a MuseScore .mxl (zip) and its uncompressed .musicxml, a hand-written timewise file
// full of things ABC cannot show, damaged files, and a copyright line that must survive later exports.
async function musicXMLImportFiles() {
  const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
  const {DOMParser} = new JSDOM('').window,
    fixture = name => new Uint8Array(fs.readFileSync(require.resolve('./fixtures/' + name))),
    parse = text => new DOMParser().parseFromString(text, 'application/xml');
  Object.assign(context, {TextDecoder, TextEncoder, DecompressionStream});
  const open = async (bytes, name) =>
    context.musicXMLToABC(parse(context.musicXMLText(bytes[0] === 0x50 ? await context.mxlScore(bytes) : bytes)), {
      name
    });
  // morning-walk.abc in tests/fixtures, through MuseScore 3.2.3: flute, B♭ clarinet, and a two-staff piano whose right
  // hand has two voices, with a repeat and 1st/2nd endings, a key, meter and clef change, chord symbols and lyrics.
  const walk = await open(fixture('morning-walk.mxl'), 'morning-walk.mxl'),
    plain = await open(fixture('morning-walk.musicxml'), 'morning-walk.musicxml');
  assert.equal(walk.abc, plain.abc, 'The .mxl and the .musicxml give the same ABC');
  assert.deepEqual([walk.parts, walk.measures, walk.skipped.length, walk.instrument], [3, 5, 0, 'Flute']);
  const tune = ABCJS.parseOnly(walk.abc)[0],
    lines = walk.abc.split('\n');
  assert.deepEqual(tune.warnings || [], []);
  for (const field of ['T:Morning Walk', 'C:FretFree test fixture (CC0)', 'M:4/4', 'Q:"Moderato" 1/4=96', 'K:G'])
    assert.ok(lines.includes(field), field);
  assert.ok(lines.includes('%%score 1 2 {(3 4) | 5}'), 'Parts, a braced piano and two voices on one staff');
  assert.ok(lines.includes('V:2 name="Clarinet in Bb" clef=treble') && lines.includes('V:5 clef=bass'));
  assert.deepEqual(
    tune.lines.map(l => l.staff.map(s => s.voices.length).join('')),
    ['1121', '1121'],
    'Two systems, as MuseScore laid them out'
  );
  const voice = n => lines[lines.indexOf('V:' + n, lines.indexOf('K:G')) + 1];
  // The parts' keys differ (the clarinet's is F at concert pitch), so each voice's line names its own key.
  assert.equal(
    voice(1),
    '[K:G] |: "G"!mf!G2 AB c2 Bc | "Em"(d2 e2) !crescendo(!d4 | (3:2:3"C"cBA "D7"!crescendo)!d2- d4 :|'
  );
  assert.equal(lines[lines.indexOf(voice(1)) + 1], 'w: Sing a long and car- ry on the way_ _');
  assert.equal(voice(2), '[K:F] |: F4 G4 | A4 B4 | G4 E4 :|', 'The B♭ clarinet is written at concert pitch');
  assert.ok(walk.abc.includes('[K:G] [1 !p!{a}g2 .f.e d2 c2 |[2 [K:D] [M:3/4] !f!d6 |]'), 'Endings and changes');
  assert.ok(walk.abc.includes('[K:D clef=treble] [1 G,8 |[2 [K:clef=bass] D,6 |]'), 'A clef change and back');

  // A timewise file with a B♭ trumpet, a guitar on an octave clef, and a tablature part that repeats the guitar.
  const odd = await open(fixture('left-out.musicxml'), 'left-out.musicxml');
  assert.deepEqual(ABCJS.parseOnly(odd.abc)[0].warnings || [], []);
  // The trumpet is in B♭ and the guitar is not, so the score opens at concert pitch.
  assert.deepEqual([odd.parts, odd.measures, odd.instrument], [2, 2, 'Piano']);
  for (const text of [
    'T:Odds & Ends',
    'C:Words: Lee Poet',
    '%%abc-copyright © 2026 Sam Writer. CC BY 4.0',
    'Q:"Brightly" 3/8=60',
    'V:2 name="Guitar" clef=treble-8',
    // Written D major and F♯ sound C major and E; the chord symbol moves too, and the quarter-tone F is rounded.
    '[K:C] "Dm7/A"E2 _E2 !fermata!=E2- | [K:C exp _a] [P:B] E2 .A2 A x :|',
    'w: Hel- lo_ _ _ _ _',
    'w: Two',
    '[K:C] {/D}E2 E2 x2 | b4 x2 |'
  ])
    assert.ok(odd.abc.split('\n').includes(text), text);
  assert.deepEqual([...odd.skipped].sort(), [
    '8va lines (the notes keep their pitch)',
    'caesuras',
    'chords in grace notes (the first note is kept)',
    'cue notes (left as space)',
    'figured bass',
    'fret numbers',
    'notes that overlap in one voice',
    'pedal marks',
    'percussion notes (written and played as pitched notes)',
    'quarter tones (rounded to the nearest note)',
    'repeat counts other than two',
    'special noteheads',
    'string numbers',
    'tablature staves (the notation staff is kept)',
    'tremolos'
  ]);
  // The copyright line is kept in later exports of the score: MusicXML rights and the MIDI copyright event.
  const again = context.abcToMusicXML(odd.abc, {item: {kind: 'personal', abc: odd.abc}});
  assert.ok(again.includes('<rights>© 2026 Sam Writer. CC BY 4.0</rights>'));
  const midi = Buffer.from(context.creditedMidi(context.midiBytes(odd.abc), odd.abc, {kind: 'personal'}));
  assert.ok(midi.includes(Buffer.from('© 2026 Sam Writer. CC BY 4.0')), 'MIDI export keeps the copyright');

  // Damaged and unexpected files fail with a plain message instead of throwing anything else.
  const fails = async (bytes, pattern) => {
    let message = '';
    try {
      await open(bytes, 'bad.musicxml');
    } catch (e) {
      message = e.message;
    }
    assert.match(message, pattern);
  };
  const text = value => new TextEncoder().encode(value);
  await fails(text('X:1\nK:C\nCDE|'), /could not be read as MusicXML/);
  await fails(text('<score-partwise><part-list/></score-partwise>'), /no music/);
  await fails(
    text(
      '<score-partwise><part id="P1"><measure><note><rest/><duration>4</duration></note></measure></part></score-partwise>'
    ),
    /no music/
  );
  await fails(text('<html><body>Hello</body></html>'), /not a MusicXML score/);
  await fails(text('<opus><score/></opus>'), /list of scores/);
  await fails(fixture('morning-walk.mxl').slice(0, 900), /could not be opened/);
  // A stored (uncompressed) zip without a container file still opens its score; one without a score says so.
  const zip = files => {
    const local = [],
      central = [];
    let offset = 0;
    for (const [name, data] of files) {
      const n = text(name),
        head = new Uint8Array(30 + n.length),
        dir = new Uint8Array(46 + n.length),
        h = new DataView(head.buffer),
        d = new DataView(dir.buffer);
      h.setUint32(0, 0x04034b50, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, n.length, true);
      head.set(n, 30);
      d.setUint32(0, 0x02014b50, true);
      d.setUint32(20, data.length, true);
      d.setUint32(24, data.length, true);
      d.setUint16(28, n.length, true);
      d.setUint32(42, offset, true);
      dir.set(n, 46);
      local.push(head, data);
      central.push(dir);
      offset += head.length + data.length;
    }
    const size = central.reduce((sum, x) => sum + x.length, 0),
      end = new Uint8Array(22),
      e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, size, true);
    e.setUint32(16, offset, true);
    return new Uint8Array(Buffer.concat([...local, ...central, end]));
  };
  const stored = await open(zip([['score.xml', fixture('morning-walk.musicxml')]]), 'stored.mxl');
  assert.equal(stored.abc, walk.abc, 'A stored entry is read without inflating');
  await fails(zip([['notes.txt', text('hello')]]), /no MusicXML score inside/);
  // Keys and pitches: modes on the circle of fifths, and a written pitch moved to concert pitch.
  assert.deepEqual(
    [
      {fifths: 3, mode: 'm'},
      {fifths: -2, mode: 'Dor'},
      {fifths: -6, mode: ''},
      {fifths: 1, mode: 'Mix'}
    ].map(context.mxiKeyText),
    ['F#m', 'CDor', 'Gb', 'DMix']
  );
  assert.equal(
    JSON.stringify(context.mxiTranspose({step: 'C', alter: 1, octave: 5}, -5, -9)),
    JSON.stringify({step: 'E', octave: 4, alter: 0}),
    'C♯ on an E♭ alto sax sounds E a sixth lower'
  );

  // abcjs carries an inline [K:] into every voice written after it, from the start of that voice's line. In this
  // hand-written file a flute and a cello in F major change to D major in bar 3 of a four-bar line, and the cello goes
  // to the tenor clef and back inside bars: what abcjs plays must be the file's own pitches, voice by voice.
  const keyChange = fixture('key-change.musicxml'),
    changed = await open(keyChange, 'key-change.musicxml'),
    semitones = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11},
    written = new TextDecoder()
      .decode(keyChange)
      .split('<part id=')
      .slice(1)
      .map(part =>
        [...part.matchAll(/<step>(\w)<\/step>(?:<alter>(-?\d)<\/alter>)?<octave>(\d)<\/octave>/g)].map(
          ([, step, alter, octave]) => 12 * (+octave + 1) + semitones[step] + (+alter || 0)
        )
      ),
    played = source => {
      const tune = ABCJS.parseOnly(source)[0],
        voices = new Map();
      tune.setUpAudio();
      for (const {element: e, key} of context.scoreEvents(tune)) {
        const id = key.split(':').slice(0, 2).join(':');
        if (!voices.has(id)) voices.set(id, []);
        if (e.el_type === 'note') voices.get(id).push(...(e.midiPitches || []).map(p => p.pitch));
      }
      return [...voices.keys()].sort().map(k => voices.get(k));
    };
  assert.deepEqual(ABCJS.parseOnly(changed.abc)[0].warnings || [], []);
  assert.deepEqual(played(changed.abc), written, 'Every voice plays its own key on both sides of the change');
  for (const line of [
    '[K:F] B4 F4 | B2 c2 f4 | [K:D] f4 c2 B2 | d8 |]',
    '[K:F] B,,4 F,,4 | F,2 [K:clef=tenor] C2 B,4 | [K:D] F,4 B,4 | C,4 [K:clef=bass] D,,4 |]'
  ])
    assert.ok(changed.abc.split('\n').includes(line), line);

  // Small one-measure files: part names, instruments, percent signs, and transpositions too large to be real.
  const whole = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>',
    score = (parts, head = '') =>
      text(
        `<score-partwise>${head}<part-list>` +
          parts.map(([name], i) => `<score-part id="P${i + 1}"><part-name>${name}</part-name></score-part>`).join('') +
          '</part-list>' +
          parts
            .map(
              ([, attributes = '', notes = whole], i) =>
                `<part id="P${i + 1}"><measure number="1"><attributes><divisions>1</divisions>${attributes}` +
                `<time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part>`
            )
            .join('') +
          '</score-partwise>'
      ),
    trumpet = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
    bass = '<clef><sign>F</sign><line>4</line></clef>';
  // The instrument setting shows every voice for that instrument, so a B♭ one is chosen only when every part is in B♭.
  const instrumentOf = async parts => (await open(score(parts), 'parts.musicxml')).instrument;
  assert.equal(await instrumentOf([['Trumpet in Bb', trumpet]]), 'Trumpet in B♭');
  assert.equal(
    await instrumentOf([
      ['Trumpet 1', trumpet],
      ['Trumpet 2', trumpet]
    ]),
    'Trumpet in B♭'
  );
  assert.equal(
    await instrumentOf([
      ['Trumpet', trumpet],
      ['Trombone', bass],
      ['Tuba', bass]
    ]),
    'Piano'
  );
  assert.equal(await instrumentOf([['Flute'], ['Clarinet', trumpet]]), 'Flute', 'A concert-pitch first part');
  assert.equal(await instrumentOf([['Oboe'], ['Horn']]), '', 'No guess');
  // One voice is a plain melody without a staff name, in any clef; several parts are named.
  const alto = await open(
    score([['Alto Saxophone', '<transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></transpose>']]),
    'alto.musicxml'
  );
  assert.deepEqual([alto.instrument, /^V:/m.test(alto.abc)], ['Alto sax in E♭', false]);
  const bassoon = await open(score([['Bassoon', bass]]), 'bassoon.musicxml');
  assert.ok(bassoon.abc.split('\n').includes('V:1 clef=bass'), 'A bass-clef melody has its clef and no name');
  assert.ok(!bassoon.abc.includes('Bassoon'));
  // abcjs reads % as the start of a comment and cuts \% short, so a percent sign is written as the full-width ％,
  // and the title and copyright survive the next export whole.
  const percent = await open(
    score(
      [['Flute']],
      '<work><work-title>100% Fun &amp; "Games"</work-title></work>' +
        '<identification><creator type="composer">Ten% Tunes</creator>' +
        '<rights>© 2020 Someone 50% share</rights></identification>'
    ),
    'percent.musicxml'
  );
  const percentTune = ABCJS.parseOnly(percent.abc)[0];
  assert.deepEqual(
    [percentTune.metaText.title, percentTune.metaText.composer, percentTune.metaText['abc-copyright']],
    ['100％ Fun & "Games"', 'Ten％ Tunes', '© 2020 Someone 50％ share']
  );
  const percentXML = context.abcToMusicXML(percent.abc, {item: {kind: 'personal', abc: percent.abc}});
  assert.ok(percentXML.includes('<work-title>100％ Fun &amp; &quot;Games&quot;</work-title>'));
  assert.ok(percentXML.includes('<rights>© 2020 Someone 50％ share</rights>'), 'The whole copyright line is kept');
  // A damaged <transpose> or chord root is held to a few octaves, so the file opens at once instead of hanging.
  for (const amount of ['1e300', '2000000000', '-1e300', 'Infinity']) {
    const started = Date.now(),
      wild = await open(
        score([
          [
            'Clarinet',
            `<key><fifths>2</fifths></key><transpose><diatonic>${amount}</diatonic><chromatic>${amount}</chromatic>` +
              `<octave-change>${amount}</octave-change></transpose>`,
            '<harmony><root><root-step>C</root-step><root-alter>1e300</root-alter></root><kind>major</kind></harmony>' +
              whole
          ]
        ]),
        'wild.musicxml'
      );
    assert.ok(Date.now() - started < 1000, `A transposition of ${amount} is read at once`);
    assert.match(wild.abc, /^K:[A-G]/m);
    assert.deepEqual(ABCJS.parseOnly(wild.abc)[0].warnings || [], []);
  }

  // Rights metadata from an opened file keeps the credit and source fields, as text, and links that open web pages.
  Object.assign(context, {URL});
  for (const item of context.library) {
    const back = context.importedRights(JSON.parse(JSON.stringify(item)));
    assert.equal(context.exportCredit(back), context.exportCredit(item), `${item.id}: the credit comes back whole`);
    assert.equal(context.scoreLicense(back), context.scoreLicense(item));
    for (const key of ['pdf', 'originalMidi', 'originalSource', 'originalSourceDownload'])
      assert.equal(back[key], item[key], `${item.id}: ${key}`);
  }
  // The objects come from the test context, so they are copied before they are compared.
  assert.deepEqual(
    {
      ...context.importedRights({
        rights: 'CC0',
        source: 'https://example.org/tune',
        pdf: 'scores/x/score.pdf',
        licenseURL: 'javascript:alert(1)',
        originalMidi: ' JavaScript:alert(1)',
        originalSource: 'java\tscript:alert(1)',
        sourceFile: 'data:text/html,hello',
        originalSourceDownload: 'vbscript:x',
        title: {toString: () => 'x'},
        composer: 7,
        prompt: 'first',
        instrument: 'Flute',
        kind: 'original',
        id: 'ode',
        abc: 'X:1'
      })
    },
    {rights: 'CC0', source: 'https://example.org/tune', pdf: 'scores/x/score.pdf'}
  );
  assert.deepEqual(
    [null, [], 'text', 3].map(x => ({...context.importedRights(x)})),
    [{}, {}, {}, {}]
  );
  console.log(
    'MusicXML import files: a MuseScore .mxl, a timewise file with left-out marks, damaged files, key changes across ' +
      'voices, instrument choice, part names, percent signs, damaged transpositions and imported rights links passed'
  );
}
// Record yourself: where the score sits in a take, calibration from recorded clicks, and take file names.
{
  const take = {lead: 2.1, latencyMs: 150, from: 3, speed: 50};
  assert.equal(context.takeOffset(take), 2.25, 'Score time `from` is at the lead plus the latency');
  assert.equal(context.takeOffset(take, 0), 2.1);
  assert.equal(context.takePosition(take, 4), 4.25, 'One score second at 50% speed is two seconds of take');
  // A simulated device: the recorder reports starting 30 ms after it does, output takes 90 ms and input 40 ms. Clicks
  // and played notes are 20 ms bursts of a decaying tone over a little noise.
  const rate = 48000,
    roundTrip = 0.03 + 0.09 + 0.04;
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.004;
  const recording = (times, seconds, level = 0.5) => {
    const samples = new Float32Array(Math.round(rate * seconds)).map(noise);
    for (const t of times)
      for (let i = 0; i < rate * 0.02; i++) {
        const at = Math.round(t * rate) + i;
        if (at < samples.length) samples[at] += level * Math.exp(-i / 200) * Math.sin((2 * Math.PI * 1000 * i) / rate);
      }
    return samples;
  };
  const clicks = [0, 0.7, 1.35, 2.15, 2.8, 3.65, 4.3, 5.1].map(t => 0.4 + t),
    heard = context.audioOnsets(
      recording(
        clicks.map(c => c + roundTrip),
        6.5
      ),
      rate
    );
  assert.equal(heard.length, 8, 'Each click is one onset');
  const calibration = context.estimateLatency(clicks, heard);
  assert.ok(Math.abs(calibration.latencyMs - 160) <= 1, `Calibration finds the round trip (${calibration.latencyMs})`);
  assert.equal(calibration.heard, 8);
  // A take: the score starts 2.07 s after the recorder (a count-in), at 80% speed from score time 1.5. The student
  // plays each note as they hear it, so it lands one round trip after it was scheduled.
  const score = [1.5, 2, 2.5, 3.25],
    lead = 2.07,
    recorded = context.audioOnsets(
      recording(
        score.map(s => lead + (s - 1.5) / 0.8 + roundTrip),
        8
      ),
      rate
    ),
    played = {lead, latencyMs: calibration.latencyMs, from: 1.5, speed: 80};
  for (const [i, s] of score.entries())
    assert.ok(
      Math.abs(context.takePosition(played, s) - recorded[i]) < 0.05,
      `Note ${i + 1} of the take lines up with the score within 50 ms`
    );
  assert.ok(Math.abs(context.takePosition(played, 1.5) - recorded[0]) < 0.002, 'and, here, within 2 ms');
  // Without calibration the take is off by the whole round trip.
  assert.ok(Math.abs(context.takePosition({...played, latencyMs: 0}, 1.5) - recorded[0]) > 0.15);
  // Silence, noise, missing clicks or clicks heard at scattered delays set no latency.
  assert.equal(context.estimateLatency(clicks, context.audioOnsets(new Float32Array(rate * 6), rate)), null);
  assert.equal(context.estimateLatency(clicks, context.audioOnsets(recording([], 6.5), rate)), null);
  assert.equal(context.estimateLatency(clicks, heard.slice(0, 4)), null, 'Half the clicks are not enough');
  assert.equal(
    context.estimateLatency(
      clicks,
      clicks.map((c, i) => c + 0.05 + i * 0.03)
    ),
    null,
    'Delays that wander are not a latency'
  );
  assert.equal(context.takeFileName('Ode to Joy', 3, 'webm'), 'Ode to Joy take 3.webm');
  assert.equal(context.takeFileName(' A/B: "Duet"? ', 1, 'm4a'), 'A B Duet take 1.m4a');
  assert.equal(context.takeFileName('', 2, 'txt', ' credits'), 'Recording take 2 credits.txt');
  assert.equal(
    ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg; codecs=opus', 'audio/wav', '']
      .map(context.takeExtension)
      .join(),
    'webm,m4a,ogg,wav,webm'
  );
  assert.equal([0.4, 9.6, 65.4, 600].map(context.clockText).join(), '0:00,0:10,1:05,10:00');
}
musicXMLImportFiles()
  .then(offlineWorker)
  .then(() =>
    console.log(
      'PASS: ' +
        context.library.length +
        ' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, new score templates (every template, meter and pickup), assignment building and validation, turning in (names, n/t/x checks with g ignored, feedback, written-pitch goals, pasted links), slur and tuplet note edits, note-to-rest edits, screen-reader note descriptions (lengths, spelling with octaves, beats in simple, compound, cut and free meters, pickups and triplets), articulations, ornaments and dynamics (toggling, shorthands, no stacking, every mark parses, velocity with sfz and marcato as accents, staccato at any tempo, repeated tenuto and slurred notes), tuplets (counts for plain and dotted notes, members, openings before a staccato dot, clean parses, full bars and MIDI timings), grace notes (adding, slashing, moving and removing, clean parses and playback), slurs, hairpins and trill lines (toggling, replacing covered and crossing lines, chained slurs, pairing as abcjs does, voices written in blocks, clean parses, whole note text, velocity ramps, transposition), piano spelling, chord building and later bar accidentals, enharmonic respelling (Z), MIDI export/decoding (the written tempo in every meter, through tempo and meter changes), WAV files (RIFF sizes, 16-bit PCM, stereo at 44.1 kHz, INFO text with every license and its full credit, title and composer only for your own score), swing feel (tempo text kept with other text, a written-out beat that keeps the tempo in every meter, directive, off-beat eighths per channel and tempo, rounded times), source-pitch fidelity, transposition, the key menu, intervals, slice transposition and respelling, octave-safe transposition of every listed key, written letters, measure and form tools (bars inserted and deleted on every staff, bar lines, repeats and endings that play, form marks, rehearsal letters, time, key and clef changes from a measure, all without warnings), chords, chord symbols (parsing, tidying, setting, spelling under transposition with words left as written, only chord names playing, N.C. stopping the accompaniment, chords-off MIDI), lyrics (read as abcjs reads them, written back the same, one syllable changed, verses kept on their rows, rests and voices, key and time changes at line starts, voices after &, typing keys, every note of the lieder with line-start changes), instrument sounds (distinct timbres, no square wave, plucked decay and sustained winds and strings, envelopes, vibrato curves, playback octaves, written intervals and their names, horn and tenor and baritone sax transposition), public-domain declarations, source-file hashes, MusicXML export (notes, pitches, durations, notation elements and credits), MusicXML import (round trips, a MuseScore .mxl, left-out marks and damaged files), recording takes (offsets, calibration from recorded clicks, lining a take up within 50 ms, refusing noise and silence, file names) and offline use (manifest and icons, a service worker that stays on its own site, install, a deploy cut short, a new deploy, offline pages, assets, and opened PDFs fetched again online).'
    )
  )
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
