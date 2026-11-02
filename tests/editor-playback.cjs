// Integration with the real engraving library. Install jsdom as a dev dependency to run.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm'),
  assert = require('assert/strict');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'http://localhost:8000'
});
const w = dom.window,
  ctx = dom.getInternalVMContext(),
  run = s => vm.runInContext(s, ctx);
w.SVGElement.prototype.getBBox = function () {
  return {x: 0, y: 0, width: Math.max(1, (this.textContent || '').length * 7), height: 14};
};
w.scrollTo = () => {};
w.confirm = () => true;
const legacy = {
  id: 'legacy',
  title: 'Saved before update',
  abc: 'X:1\nT:Saved before update\nM:4/4\nL:1/4\nK:C\nC4 |]',
  updated: 1
};
w.localStorage.setItem('commonnote-scores-v1', JSON.stringify([legacy]));
w.localStorage.setItem('commonnote-favorites-v1', '["ode","mutopia-263"]');
const oscillators = [];
class FakeAudio {
  constructor() {
    this.currentTime = 10;
    this.destination = {};
  }
  async resume() {}
  createOscillator() {
    const o = {
      frequency: {value: 0},
      connect() {},
      start(t) {
        this.startAt = t;
      },
      stop(t) {
        this.stopAt = t;
      }
    };
    oscillators.push(o);
    return o;
  }
  createGain() {
    return {gain: {setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}};
  }
}
w.AudioContext = FakeAudio;
for (const f of [
  'vendor/abcjs-basic-min.js',
  'catalog.js',
  'catalog-expanded.js',
  'score-tools.js',
  'rights-tools.js',
  'catalog-licensed.js',
  'catalog-lieder.js',
  'catalog-quartets.js',
  'catalog-pgh.js',
  'shared.js',
  'library.js',
  'backup.js',
  'editor.js',
  'playback.js',
  'app.js'
])
  run(fs.readFileSync(path.join(root, f), 'utf8'));
const source = '% Unicode ♫\n\nX:1\nT:Click and drag\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\n|: C D E F | G4 :| c4 |]';
// Tab and fingering are display-only extra staffs; this loop checks note-to-source mapping on the music staff.
run("$('fingering').checked=false");
for (const instrument of Object.keys(run('instruments'))) {
  run(`openScore({abc:${JSON.stringify(source)},instrument:${JSON.stringify(instrument)}})`);
  const entries = run('scoreEvents(renderedTune).filter(e=>e.element.el_type==="note")');
  for (let i = 0; i < entries.length; i++) {
    run(`scoreClick(scoreEvents(renderedTune).filter(e=>e.element.el_type==='note')[${i}].element,0,[],{},null)`);
    assert.equal(
      run("$('abc').value.slice($('abc').selectionStart,$('abc').selectionEnd)"),
      source.slice(
        run(`[...noteSources.values()].filter(e=>e?.element.el_type==='note')[${i}].element.startChar`),
        run(`[...noteSources.values()].filter(e=>e?.element.el_type==='note')[${i}].element.endChar`)
      )
    );
  }
  run('scoreClick(scoreEvents(renderedTune).find(e=>e.element.pitches).element,0,[],{},{step:-1})');
  assert.match(
    run("$('abc').value"),
    /\|: D D E F/,
    'Up one visual staff step raises the source pitch for ' + instrument
  );
  assert.equal(run("$('abc').selectionStart"), source.indexOf(' C D E F'));
  assert.equal(run("$('warnings').textContent"), '');
}
assert.equal(run(`moveNoteText('"Am"!accent!{a}[=CEG]2-',1)`), '"Am"!accent!{a}[=DFA]2-');
assert.equal(run(`moveNoteText('B,2 c/2 ^f-',1)`), 'C2 d/2 ^g-');
// Bar check: pickups, section-closing bars that complete a pickup, free meter, multi-bar rests, tuplets and meter changes are fine.
// Note names: written letters and movable-do solfège, raised/lowered against the key signature.
const labels = (abc, mode) =>
  run(`noteLabels(ABCJS.parseOnly(${JSON.stringify(abc)})[0],'${mode}').map(l=>l.text).join(' ')`);
assert.equal(labels('X:1\nL:1/4\nK:D\nD F A d | c ^c =c _B |]', 'letters'), 'D F♯ A D C♯ C♯ C B♭');
assert.equal(labels('X:1\nL:1/4\nK:D\nD F A d | c ^c =c _B |]', 'solfege'), 'do mi sol do ti ti te le');
assert.equal(labels('X:1\nL:1/4\nK:Am\nA c e ^G | A2 |]', 'solfege'), 'la do mi si la', 'Minor keys are la-based');
assert.equal(
  labels('X:1\nL:1/4\nK:D\n%%score (1 2)\nV:1\nF ^G G =F|]\nV:2\nF, G, ^G, G,|]', 'letters'),
  'F♯ G♯ G♯ F F♯ G G♯ G♯',
  'Every voice is labelled with its own accidentals'
);
assert.equal(run(`labelSource('X:1\\nL:1/4\\nK:G\\nG A|]','letters')`), 'X:1\nL:1/4\nK:G\n"_G"G "_A"A|]');
const flaggedBars = abc => run(`barProblems(ABCJS.parseOnly(${JSON.stringify(abc)})[0]).map(m=>m.measure).join()`);
assert.equal(flaggedBars('X:1\nM:4/4\nL:1/4\nK:C\nC D E | F G A B | c4 |]'), '', 'Short opening bar is a pickup');
assert.equal(
  flaggedBars('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B | c d e f g | a4 |]'),
  '2,3',
  'Short and long bars are flagged'
);
assert.equal(flaggedBars('X:1\nM:6/8\nL:1/8\nK:G\nD|:G2A B2c|d3 d2:|'), '', 'Section end completes the pickup');
assert.equal(flaggedBars('X:1\nM:none\nL:1/4\nK:C\nC D E | F G |]'), '', 'Free meter is not checked');
assert.equal(flaggedBars('X:1\nM:3/4\nL:1/4\nK:C\nC D E | Z2 | F G A |]'), '', 'Multi-bar rests are not checked');
assert.equal(flaggedBars('X:1\nM:2/4\nL:1/8\nK:C\n(3CDE F2 | G4 |]'), '', 'Tuplets count at their sounding length');
assert.equal(flaggedBars('X:1\nM:4/4\nL:1/4\nK:C\nC4 | [M:3/4] D3 | E3 |]'), '', 'Inline meter changes apply');
assert.equal(run(`editNoteText('"Am"!accent!^c2-',{accidental:'_'})`), '"Am"!accent!_c2-');
assert.equal(run(`editNoteText('[CEG]2',{accidental:'^',length:4})`), '[^C^E^G]4');
assert.equal(run(`editNoteText('B,/2>',{length:1.5})`), 'B,3/2>');
assert.equal(run(`editNoteText('=F',{accidental:''})`), 'F');
assert.equal(run(`editNoteText('C2 ',{tie:true})`), 'C2- ');
assert.equal(run(`editNoteText('C2- ',{tie:false})`), 'C2 ');
assert.equal(run(`[1,2,.5,1.5,.25,2/3].map(lengthText).join(',')`), ',2,/2,3/2,/4,2/3', 'Lengths stay exact for L:3/8');
assert.equal(run(`editNoteText('[C2E2G2]',{length:2})`), '[CEG]2', 'New chord length replaces per-pitch lengths');
assert.equal(run(`editNoteText('C>',{length:1.5,unbroken:true})`), 'C3/2');
// Transposition: the K: line extras abcjs would mangle survive, and the checked version refuses misplaced notes.
assert.equal(run(`transposeABC('X:1\\nL:1/4\\nK:C clef=bass\\nC D|]',2)`), 'X:1\nL:1/4\nK:D clef=bass\nD E|]');
assert.equal(run(`transposeABC('X:1\\nL:1/4\\nK:A minor\\nc e|]',-2)`), 'X:1\nL:1/4\nK:G minor\nB d|]');
assert.equal(
  run(`transposeChecked('X:1\\nL:1/4\\nK:G\\n"G"G A "D7"B c|]',2)`),
  'X:1\nL:1/4\nK:A\n"A"A B "E7"c d|]',
  'Notes, key and chord symbols move together'
);
assert.equal(
  run(`transposeChecked('X:1\\nL:1/4\\nK:none\\nA B ^c d|]',2)`),
  'X:1\nL:1/4\nK:none\nB ^c ^d e|]',
  'Without a key signature every note carries its own accidental'
);
// abcjs's own transposer drops these: a natural the bar needs, a chord's note lengths, a grace before a slur.
assert.equal(run(`transposeChecked('X:1\\nL:1/8\\nK:C\\nE ^D E =D|]',-5)`), 'X:1\nL:1/8\nK:G\nB, ^A, B, =A,|]');
assert.equal(
  run(`transposeChecked('X:1\\nL:1/4\\nK:F\\n[F3/2c3/2] [F/c/]|]',-5)`),
  'X:1\nL:1/4\nK:C\n[C3/2G3/2] [C/G/]|]'
);
assert.equal(run(`transposeChecked('X:1\\nL:1/8\\nK:G\\nG {B}(~A>G)|]',2)`), 'X:1\nL:1/8\nK:A\nA {c}(~B>A)|]');
// Ties continue the first note; explicit signature accidentals move with the key.
assert.equal(run(`transposeChecked('X:1\\nL:1/4\\nK:C\\n^F- | F F|]',2)`), 'X:1\nL:1/4\nK:D\n^G- | G G|]');
assert.equal(run(`transposeChecked('X:1\\nL:1/8\\nK:EPhr ^G\\nE G F E|]',-5)`), 'X:1\nL:1/8\nK:BPhr ^D\nB, D C B,|]');
assert.throws(() => run(`transposeChecked('X:1\\nL:1/4\\nK:C\\n^/c d|]',2)`), /Quarter-tone/);
// Instruments: each caption states the written-to-sounding interval.
const caption = name => {
  run(`$('instrument').value=${JSON.stringify(name)};updateCaption()`);
  return run("$('score-caption').textContent");
};
assert.match(caption('Clarinet in B♭'), /sounding a major 2nd lower/);
assert.match(caption('Clarinet in E♭'), /sounding a minor 3rd higher/);
assert.match(caption('Horn in F'), /sounding a perfect 5th lower/);
assert.match(caption('Tenor sax in B♭'), /sounding an octave and a major 2nd lower/);
assert.match(caption('Baritone sax in E♭'), /sounding an octave and a major 6th lower/);
assert.match(caption('Guitar'), /Sounds an octave below the written notes/);
assert.match(caption('Bass guitar'), /bass clef · Sounds an octave below/);
assert.match(caption('Cello'), /Melody lowered one octave/);
assert.match(caption('Flute'), /Concert pitch melody part/);
assert.equal(
  run("[...$('instrument').querySelectorAll('optgroup')].map(g=>g.label).join()"),
  'Woodwinds,Brass,Strings,Keyboard'
);
assert.equal(run("$('instrument').options.length"), Object.keys(run('instruments')).length);
assert.equal(run("$('instrument-filter').options.length"), Object.keys(run('instruments')).length + 1);
// The Transpose control: options name the destination key (and the written key), Apply rewrites the source as one undo step.
run(`openScore({abc:'X:1\\nT:Move me\\nM:4/4\\nL:1/4\\nK:G\\n"G"G A B c|d4|]',instrument:'Flute'})`);
const optionText = v => run(`[...$('transpose').options].find(o=>o.value==='${v}').text`);
assert.equal(optionText('2'), 'Up 2 · A major');
assert.equal(optionText('-5'), 'Down 5 · D major');
assert.equal(optionText('12'), 'Up an octave');
assert.ok(run("$('transpose-apply').disabled"), 'Apply waits for a choice');
run("$('transpose').value='2';$('transpose').onchange();$('transpose-apply').onclick();render()");
assert.equal(run("$('abc').value"), 'X:1\nT:Move me\nM:4/4\nL:1/4\nK:A\n"A"A B c d|e4|]');
assert.equal(run("$('key').value"), 'A');
assert.equal(run("$('transpose').value"), '', 'The menu resets after applying');
assert.match(run("$('selection-status').textContent"), /Moved up 2 semitones to A major\. Undo .* in G major/);
assert.equal(optionText('-2'), 'Down 2 · G major', 'Options follow the new key');
run('stepHistory(-1)');
assert.match(run("$('abc').value"), /K:G\n"G"G A B c\|d4\|\]/, 'One undo restores the original key');
run(`$('instrument').value='Clarinet in B♭';$('instrument').onchange();updateCaption()`);
run("$('transpose').value='2';$('transpose').onchange()");
assert.match(
  run("$('transpose-note').textContent"),
  /^Up 2 semitones to A major; the Clarinet in B♭ part will read in B major\./
);
assert.ok(!run("$('transpose-apply').disabled"));
run(`openScore({abc:'X:1\\nL:1/4\\nK:C\\n^/c d|]'})`);
run("$('transpose').value='2';$('transpose-apply').onclick()");
assert.equal(run("$('abc').value"), 'X:1\nL:1/4\nK:C\n^/c d|]', 'A score that cannot move safely is left alone');
assert.match(run("$('toast').textContent"), /Could not transpose this score\. Quarter-tone/);
async function checkPlayback() {
  run(`openScore({abc:${JSON.stringify(source)},instrument:'Flute'});$('start-measure').value=3;$('speed').value=50`);
  assert.equal(run('measureStarts.get(3)'), 9.6, 'Measure after repeated section uses performed timing');
  const before = run("$('abc').value");
  oscillators.length = 0;
  await run('play()');
  assert.equal(oscillators.length, 1, 'Start after repeats skips earlier notes');
  assert.equal(oscillators[0].frequency.value, 440 * 2 ** ((72 - 69) / 12));
  assert.ok(Math.abs(oscillators[0].stopAt - oscillators[0].startAt - 4.83) < 0.001, '50% doubles note time');
  run('stop()');
  assert.equal(run("$('abc').value"), before, 'Playback settings never change source tempo');
  for (const [instrument, octaves] of [
    ['Tenor sax in B♭', -1],
    ['Guitar', -1],
    ['Bass guitar', -2],
    ['Clarinet in B♭', 0]
  ]) {
    run(`$('instrument').value=${JSON.stringify(instrument)}`);
    oscillators.length = 0;
    await run('play()');
    assert.equal(
      oscillators[0].frequency.value,
      440 * 2 ** ((72 + 12 * octaves - 69) / 12),
      instrument + ' sounding pitch'
    );
    run('stop()');
  }
  run("$('instrument').value='Flute'");
  const tempo = 'X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC4 | [Q:1/4=50]D4 | E4 |]';
  run(`openScore({abc:${JSON.stringify(tempo)}})`);
  assert.equal(run('measureStarts.get(3)'), 7.2);
  const pickup = 'X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC | D4 | E4 |]';
  run(`openScore({abc:${JSON.stringify(pickup)}})`);
  assert.equal(run('measureStarts.get(2)'), 0.6, 'Pickup counted as measure one');
  const tied = 'X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC4- | C4 | D4 |]';
  run(`openScore({abc:${JSON.stringify(tied)}});$('start-measure').value=2;$('speed').value=100`);
  oscillators.length = 0;
  await run('play()');
  assert.ok(oscillators.length > 0, 'Tied note resumes at measure boundary');
  assert.ok(Math.abs(oscillators[0].stopAt - oscillators[0].startAt - 2.43) < 0.001);
  run('stop()');
  // Practice range, count-in and metronome.
  const sliced = run(
    `playbackSlice({duration:4,notes:[{start:0,duration:3,note:60,velocity:80},{start:3,duration:1,note:62,velocity:80}]},1,100,2.5)`
  );
  assert.equal(sliced.notes.length, 1, 'Range end drops later notes');
  assert.equal(sliced.notes[0].duration, 1.5, 'Range end clips a held note');
  assert.equal(sliced.duration, 1.5);
  run(`openScore({abc:${JSON.stringify(source)},instrument:'Flute'});$('speed').value=100;setRange(1,1)`);
  assert.equal(run('rangeEnd(1,99)'), 2.4, 'Range ends where the next measure is first played');
  oscillators.length = 0;
  await run('play()');
  assert.equal(oscillators.length, 4, 'Range plays only its measures');
  run('stop()');
  run("$('metronome').checked=true;$('count-in').checked=true");
  oscillators.length = 0;
  await run('play()');
  const clicks = oscillators.filter(o => o.type === 'square');
  assert.equal(clicks.length, 8, 'Count-in bar plus one click per beat');
  assert.ok(
    Math.abs(oscillators.find(o => o.type !== 'square').startAt - clicks[4].startAt) < 1e-9,
    'First note lands on the first metronome click after the count-in'
  );
  assert.ok(Math.abs(clicks[4].startAt - clicks[0].startAt - 2.4) < 1e-9, 'Count-in lasts one bar');
  run('stop()');
  run("$('metronome').checked=false;$('count-in').checked=false");
  run(`openScore({abc:${JSON.stringify(tempo)}})`);
  assert.equal(
    run('clickTimes(0,99,12).map(c=>c.time.toFixed(1)+(c.down?"*":"")).slice(0,9).join()'),
    '0.0*,0.6,1.2,1.8,2.4*,3.6,4.8,6.0,7.2*',
    'Clicks follow a tempo change at a barline'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nM:6/8\nL:1/8\nQ:3/8=60\nK:C\nc3 (3ded c | B3 A3 |]')}})`);
  assert.equal(
    run('clickTimes(0,1.9,4).map(c=>c.time.toFixed(2)).join()'),
    '0.00,1.00',
    'A triplet bar keeps the beat'
  );
  assert.equal(
    run(
      `[...effectiveDurations(scoreEvents(ABCJS.parseOnly('X:1\\nL:1/8\\nK:C\\n(3CDE F|]')[0])).values()].map(d=>d.toFixed(4)).join()`
    ),
    '0.0833,0.0833,0.0833,0.1250',
    'Tuplet multiplier applies to every tuplet note'
  );
  run("$('trainer').checked=true;$('speed').value=100;$('trainer-goal').value=100;prepareTrainer()");
  assert.equal(run("$('speed').value"), '80', 'A restored trainer starts below its goal');
  run("$('trainer-goal').value=30;$('trainer-goal').dispatchEvent(new Event('change'))");
  assert.equal(run("$('trainer-goal').value"), '45', 'Goal keeps room for the 20-point start');
  run("$('trainer').checked=false;$('speed').value=100;$('trainer-goal').value=100");
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G A B c | d e f g |]')}});setRange(1,1)`
  );
  oscillators.length = 0;
  await run('play(2.5,{countIn:true})');
  assert.equal(oscillators.length, 7, 'A start past the range plays to the end of the tune');
  run('stop()');
  run('setRange(1,2)');
  oscillators.length = 0;
  await run('play(2.5,{countIn:true})');
  assert.equal(oscillators.length, 3, 'A start inside the range stops at its end');
  run('stop()');
  run(`openScore({abc:${JSON.stringify(pickup)}})`);
  assert.equal(
    run('clickTimes(0,1.3).map(c=>c.time.toFixed(1)+(c.down?"*":"")).join()'),
    '0.0,0.6*,1.2',
    'Pickup clicks align to the bar line'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nM:6/8\nL:1/8\nK:C\nc3 d3|]')}})`);
  assert.equal(run('beatsPerBar()'), 2, '6/8 counts two dotted beats');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, repeats, pickups, ties, tempo changes, speed scaling, practice ranges, count-in, metronome, bar checks, and legacy storage.'
  );
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
