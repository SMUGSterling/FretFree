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
console.log(
  'PASS: ' +
    context.library.length +
    ' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, assignment building and validation, slur and tuplet note edits, note-to-rest edits, MIDI export/decoding, source-pitch fidelity, transposition, the key menu, intervals, slice transposition and respelling, octave-safe transposition of every listed key, written letters, chords, public-domain declarations, and source-file hashes.'
);
