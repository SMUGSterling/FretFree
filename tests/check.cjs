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
console.log(
  'PASS: ' +
    context.library.length +
    ' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, MIDI export/decoding, source-pitch fidelity, transposition, chords, public-domain declarations, and source-file hashes.'
);
