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
  // Transpose panel, key changes and the key and meter menus.
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    keyLine = () => run("$('abc').value.match(/^K:.*$/m)[0]");
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F\n"F"F "Bb"G A B | c d e f | F2 A2 |]')},instrument:'Flute'})`
  );
  const steps = () => run('historyIndex');
  run('toggleTranspose(true)');
  assert.equal(run("$('transpose-interval').value + $('transpose-direction').value"), 'M21', 'Up a major 2nd first');
  assert.equal(run("$('transpose-selection').disabled"), true, 'Selection only needs a selection');
  assert.match(run("$('transpose-note').textContent"), /F major \(1♭\) becomes G major \(1♯\)/);
  let stepAt = steps();
  run('applyTranspose()');
  assert.equal(keyLine(), 'K:G');
  assert.equal(body(), '"G"G "C"A B c | d e f g | G2 B2 |]', 'Whole score up a major 2nd');
  assert.equal(steps(), stepAt + 1, 'Transposing is one undo step');
  assert.ok(run("$('transpose-panel').hidden"), 'The panel closes after transposing');
  run('stepHistory(-1)');
  assert.equal(body(), '"F"F "Bb"G A B | c d e f | F2 A2 |]', 'Undo restores the score');
  run("setRange(2,2);toggleTranspose(true);$('transpose-interval').value='m3';$('transpose-direction').value='-1'");
  run("$('transpose-selection').checked=true;refreshTranspose()");
  assert.equal(run("$('transpose-selection-label').textContent"), 'Selection only: measure 2');
  stepAt = steps();
  run('applyTranspose()');
  assert.equal(body(), '"F"F "Bb"G A B | A =B ^c d | F2 A2 |]', 'Only the selected bar moves down a minor 3rd');
  assert.equal(keyLine(), 'K:F', 'The key signature stays');
  assert.equal(steps(), stepAt + 1);
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]')}})`);
  run("selectEntry(scoreNotes()[4]);toggleTranspose(true);$('transpose-by-key').checked=true");
  run("$('transpose-key').value='Gb';$('transpose-selection').checked=false;refreshTranspose()");
  assert.ok(run("$('transpose-interval-row').hidden && !$('transpose-key-row').hidden"), 'To key hides the interval');
  assert.equal(run("$('transpose-selection-label').textContent"), 'Selection only: measure 2');
  run('applyTranspose()');
  assert.equal(keyLine() + ' ' + body(), 'K:Gb G A B c | d4 |]', 'To key Gb goes up a diminished 5th');
  run("toggleTranspose(true);$('transpose-by-key').checked=true;$('transpose-key').value='F#';applyTranspose()");
  assert.equal(keyLine() + ' ' + body(), 'K:F# F G A B | c4 |]', 'Gb to F# respells at the same pitch');
  run("$('transpose-by-interval').checked=true");
  // Key menu: 15 major and 15 minor keys, the modes, and the Transpose/Keep choice that keeps clef=.
  const keys = run("[...$('key').querySelectorAll('optgroup')].map(g=>g.label+':'+g.children.length).join()");
  assert.equal(keys, 'Major:15,Minor:15,Dorian:7,Phrygian:7,Lydian:7,Mixolydian:7,Locrian:7');
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F clef=bass\nF, A, C2 |]')},instrument:'Cello'})`);
  assert.equal(run("$('key').value"), 'F');
  run("$('key').value='G';$('key').dispatchEvent(new Event('input'))");
  assert.equal(run("$('key-choice').hidden"), false, 'Choosing a key asks first');
  assert.equal(keyLine(), 'K:F clef=bass', 'Nothing changes until the choice');
  stepAt = steps();
  run("$('key-keep').click()");
  assert.equal(keyLine() + ' ' + body(), 'K:G clef=bass F, A, C2 |]', 'Keep notes changes only the key');
  assert.equal(steps(), stepAt + 1);
  run("$('key').value='Bb';$('key').dispatchEvent(new Event('input'));$('key-transpose').click()");
  assert.equal(
    keyLine() + ' ' + body(),
    'K:Bb clef=bass A, C E2 |]',
    'Transpose notes moves them up a minor 3rd, the nearer way'
  );
  run("$('key').value='DDor';$('key').dispatchEvent(new Event('input'));$('key-cancel').click()");
  assert.equal(run("$('key').value") + ' ' + keyLine(), 'Bb K:Bb clef=bass', 'Cancel puts the key back');
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:D dorian\nz4 |]')}})`);
  assert.equal(run("$('key').value"), 'DDor', 'Mode keys are recognized');
  run("$('key').value='Em';$('key').dispatchEvent(new Event('input'))");
  assert.equal(run("$('key-choice').hidden") + ' ' + keyLine(), 'true K:Em', 'A score of rests changes key at once');
  const meters = run("[...$('meter').options].map(o=>o.value).join(' ')");
  for (const m of ['2/2', '3/8', '5/4', '6/4', '7/8', '9/8', '12/8', 'C', 'C|', 'none'])
    assert.ok(meters.split(' ').includes(m), `Meter ${m} listed`);
  // A transposing instrument: the concert source moves, and the written display follows.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F\nF G A B |]')},instrument:'Clarinet in B♭'})`);
  run("toggleTranspose(true);$('transpose-interval').value='M2';$('transpose-direction').value='1';refreshTranspose()");
  assert.match(run("$('transpose-note').textContent"), /Keys are concert pitch/);
  run('applyTranspose()');
  assert.equal(keyLine() + ' ' + body(), 'K:G G A B c |]', 'The source moves in concert pitch');
  assert.equal(run('writtenABC().match(/^K:(.*)$/m)[1]'), 'A clef=treble', 'The written display follows');
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:E\nE F G A |]')},instrument:'Clarinet in B♭'})`);
  assert.equal(run('writtenABC().match(/^K:(\\S+)/m)[1]'), 'F#', 'Written keys are spelled by the interval');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, repeats, pickups, ties, tempo changes, speed scaling, practice ranges, count-in, metronome, bar checks, transposing (whole score, selected measures, to a key, transposing instruments), key changes that keep clef=, the key and meter menus, and legacy storage.'
  );
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
