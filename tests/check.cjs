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
}
console.log(
  'PASS: ' +
    context.library.length +
    ' scores; catalog parsing, skill tags, teaching-score bar lengths, writing-prompt examples, MIDI export/decoding, source-pitch fidelity, transposition, chords, public-domain declarations, source-file hashes, and MusicXML export (notes, pitches, durations, notation elements and credits).'
);
