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
const context = {ABCJS, console, Uint8Array, DataView, Map, atob};
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
for (const score of context.library) {
  const parsed = ABCJS.parseOnly(score.abc);
  assert.equal(parsed.length, 1, score.title);
  assert.ok(!parsed[0].warnings?.length, `${score.title}: ${parsed[0].warnings}`);
  const midi = context.midiBytes(score.abc);
  assert.equal(Buffer.from(midi.slice(0, 4)).toString(), 'MThd');
  const data = context.parseMidi(midi);
  assert.ok(data.notes.length > 0);
  assert.ok(data.duration > 0 && Number.isFinite(data.duration));
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
// Turning in: names are cleaned, a link's n/t/x/g must fit the assignment it carries, feedback is capped, goals are
// checked in written pitch, and pasted text gives one code per line.
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
  for (const [why, payload] of Object.entries({
    'no name': {...good, n: '  '},
    'name not text': {...good, n: ['Sam']},
    'time as text': {...good, t: '1790000000000'},
    'fractional time': {...good, t: 1.5},
    'negative time': {...good, t: -1},
    'another assignment': {...good, x: 'custom-other'},
    'goal results of the wrong length': {...good, g: [1, 1]},
    'goal results not 0 or 1': {...good, g: [1, 2, 0]}
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
musicXMLImportFiles()
  .then(() =>
    console.log(
      'PASS: ' +
        context.library.length +
        ' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, new score templates (every template, meter and pickup), assignment building and validation, turning in (names, n/t/x/g checks, feedback, written-pitch goals, pasted links), slur and tuplet note edits, note-to-rest edits, articulations, ornaments and dynamics (toggling, shorthands, no stacking, every mark parses, velocity with sfz and marcato as accents, staccato at any tempo, repeated tenuto and slurred notes), piano spelling, chord building and later bar accidentals, enharmonic respelling (Z), MIDI export/decoding, source-pitch fidelity, transposition, the key menu, intervals, slice transposition and respelling, octave-safe transposition of every listed key, written letters, chords, chord symbols (parsing, tidying, setting, spelling under transposition with words left as written, only chord names playing, N.C. stopping the accompaniment, chords-off MIDI), public-domain declarations, source-file hashes, MusicXML export (notes, pitches, durations, notation elements and credits) and MusicXML import (round trips, a MuseScore .mxl, left-out marks and damaged files).'
    )
  )
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
