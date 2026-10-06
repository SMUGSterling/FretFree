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
const oscillators = [],
  gains = [];
class FakeAudio {
  constructor() {
    this.currentTime = 10;
    this.destination = {};
  }
  async resume() {}
  createOscillator() {
    const o = {
      frequency: {value: 0},
      connect(to) {
        this.to = to;
      },
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
    const g = {
      gain: {setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}},
      connect(to) {
        this.to = to;
      }
    };
    gains.push(g);
    return g;
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
assert.equal(
  labels('X:1\nL:1/4\nK:C\nC D E ^F-|F F [^G_B]-|[GB] B|]', 'letters'),
  'C D E F♯ F♯ F G♯ G♯ B',
  'A note tied across a bar line keeps its accidental; the next note in the bar does not'
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
// Notes that open a slur or a tuplet: the menu and the keyboard edit the note and keep the ( or (3 in front.
{
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nK:C\n(C D E F) (3GAB c2 |]')},instrument:'Flute'})`);
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    edit = action => run(`(s=>editNote(s.entry,s.display,${JSON.stringify(action)}))(selectedNote())`),
    key = k => run(`scoreKey({key:${JSON.stringify(k)}})`);
  pick(0);
  edit('len:0.25');
  assert.equal(body(), '(C2 D E F) (3GAB c2 |]', 'Menu length on a slur-start note');
  key('.');
  key('#');
  key('+');
  assert.equal(body(), '(^C3- D E F) (3GAB c2 |]', 'Dot, sharp and tie keys on a slur-start note');
  key('ArrowUp');
  assert.equal(body(), '(^D3- D E F) (3GAB c2 |]', 'Arrow moves a slur-start note');
  pick(4);
  key('5');
  key('-');
  assert.equal(body(), '(^D3- D E F) (3_G2AB c2 |]', 'Length and flat keys on a tuplet-start note');
  pick(3);
  edit('len:0.25');
  assert.equal(body(), '(^D3- D E F2) (3_G2AB c2 |]', 'Slur-end note keeps its )');
  run('stepHistory(-1)');
  assert.equal(body(), '(^D3- D E F) (3_G2AB c2 |]', 'Each edit is one undo step');
  assert.equal(run("$('warnings').textContent"), '');
  // Accidentals are edited in written pitch for transposing instruments, so the prefix survives the round trip.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nK:C\n(3:2:3CDE (F G) A2 B2 |]')},instrument:'Clarinet in B♭'})`
  );
  pick(0);
  key('#');
  pick(3);
  key('=');
  assert.equal(body(), '(3:2:3^CDE (=F G) A2 B2 |]', 'Written-pitch accidentals on tuplet- and slur-start notes');
}
// Master bus and note audition: every note and click reaches the speakers through one gain node that follows the
// Volume slider live; entering, selecting or moving a note sounds it once at concert pitch when Hear notes is on.
async function checkAudio() {
  const hz = midi => 440 * 2 ** ((midi - 69) / 12),
    near = (a, b) => Math.abs(a - b) < 1e-6;
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC [EG] E F | G4 |]')},instrument:'Flute'})`);
  run("$('metronome').checked=true;$('count-in').checked=true;$('volume').value='0.3'");
  oscillators.length = 0;
  await run('play()');
  const bus = run('outputNode()');
  assert.equal(bus.to, run('audio.destination'), 'Without a limiter the master bus feeds the speakers');
  assert.ok(
    oscillators.length > 6 && oscillators.every(o => o.to?.to === bus),
    'Every note and click uses the master bus'
  );
  assert.equal(bus.gain.value, 0.3, 'Master gain starts at the Volume setting');
  run("$('volume').value='0.8';$('volume').dispatchEvent(new Event('input'))");
  assert.equal(run('playing'), true, 'Moving Volume keeps playing');
  assert.equal(bus.gain.value, 0.8, 'Master gain follows Volume live');
  oscillators.length = 0;
  run(`scoreClick(scoreEvents(renderedTune).find(e=>e.element.pitches).element,0,[],{},{step:0},{})`);
  assert.equal(oscillators.length, 0, 'No audition during playback');
  run("stop();$('metronome').checked=false;$('count-in').checked=false;$('volume').value='0.3'");
  const clickNote = i =>
    run(`scoreClick(scoreEvents(renderedTune).filter(e=>e.element.pitches)[${i}].element,0,[],{},{step:0},{})`);
  const heard = () => oscillators.map(o => o.frequency.value);
  oscillators.length = 0;
  clickNote(0);
  assert.deepEqual(heard(), [hz(60)], 'Clicking a note plays it once');
  assert.ok(
    oscillators[0].type !== 'square' && oscillators[0].to.to === bus,
    'Audition uses the instrument and the bus'
  );
  oscillators.length = 0;
  clickNote(1);
  assert.deepEqual(heard(), [hz(64), hz(67)], 'Clicking a chord plays every pitch');
  oscillators.length = 0;
  run(`scoreKey({key:'ArrowRight'})`);
  assert.deepEqual(heard(), [hz(64)], 'Arrow keys sound the newly selected note');
  oscillators.length = 0;
  // The note sounds before the render, so engraving a long score does not delay it.
  w.__sounded = () => oscillators.length;
  run('var engrave=render;render=()=>{window.__soundedAtRender=__sounded();engrave()}');
  run(`scoreKey({key:'ArrowUp'})`);
  run('render=engrave');
  assert.equal(run('__soundedAtRender'), 1, 'An edit sounds the note before the score is redrawn');
  assert.match(run("$('abc').value"), /\[EG\] F F/);
  assert.deepEqual(heard(), [hz(65)], 'Up arrow sounds the new pitch');
  oscillators.length = 0;
  run(`scoreKey({key:'#'})`);
  assert.deepEqual(heard(), [hz(66)], 'An accidental sounds the new pitch');
  oscillators.length = 0;
  run(`scoreKey({key:'b'})`);
  assert.match(run("$('abc').value"), /\[EG\] \^F B F/);
  assert.deepEqual(heard(), [hz(71)], 'Typing a letter sounds the new note');
  oscillators.length = 0;
  clickNote(0);
  run(`scoreClick(scoreEvents(renderedTune).filter(e=>e.element.pitches)[0].element,0,[],{},{step:-1},{})`);
  assert.deepEqual(heard(), [hz(60), hz(62)], 'A drag sounds the moved note once');
  oscillators.length = 0;
  run(`scoreClick(scoreEvents(renderedTune).filter(e=>e.element.pitches)[2].element,0,[],{},null)`);
  assert.equal(oscillators.length, 0, 'Selecting from code (the note menu) stays quiet');
  // Typing over a rest (and drawing on one) sounds the note that replaces it.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:D\nz4 | z4 |]')},instrument:'Flute'});selectEntry(scoreNotes()[0])`
  );
  oscillators.length = 0;
  run(`scoreKey({key:'f'})`);
  assert.match(run("$('abc').value"), /\nF z3 \|/);
  assert.deepEqual(heard(), [hz(66)], 'Key signature applies: F is F sharp in D');
  run('selectEntry(scoreNotes().find(n=>n.element.rest&&n.measure===2))');
  oscillators.length = 0;
  run(`scoreKey({key:'a'})`);
  assert.match(run("$('abc').value"), /\| A z3 \|/);
  assert.deepEqual(heard(), [hz(69)], 'A note written over the rest after a bar line sounds');
  // Concert pitch and the playback octave rule: a cello sounds an octave below the source, a clarinet as written in ABC.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nc d e f |]')},instrument:'Cello'})`);
  oscillators.length = 0;
  clickNote(0);
  assert.deepEqual(heard(), [hz(60)], 'Cello audition drops the source an octave, as playback does');
  run("$('instrument').value='Clarinet in B♭';$('instrument').onchange();clearTimeout(renderTimer);render()");
  oscillators.length = 0;
  clickNote(0);
  assert.deepEqual(heard(), [hz(72)], 'Transposing instruments sound the concert source');
  // A note tied across a bar line sounds the sharp playback holds; an octave clef sounds an octave down, as in playback.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E ^F-|F G A B|]')},instrument:'Flute'})`);
  oscillators.length = 0;
  clickNote(4);
  assert.deepEqual(heard(), [hz(66)], 'A tied note after the bar line keeps its sharp');
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:G clef=treble-8\nG A B c|]')},instrument:'Guitar'})`);
  oscillators.length = 0;
  clickNote(0);
  assert.deepEqual(heard(), [hz(55)], 'An octave clef sounds an octave down');
  // Off: nothing sounds, and the choice is saved and backed up.
  run("$('audition').checked=false;$('audition').dispatchEvent(new Event('change'))");
  oscillators.length = 0;
  clickNote(1);
  run(`scoreKey({key:'ArrowUp'})`);
  assert.equal(oscillators.length, 0, 'Hear notes off stays silent');
  assert.equal(w.localStorage.getItem('fretfree-audition'), 'false', 'Hear notes is remembered');
  assert.ok(run('BACKUP_SETTING_KEYS()').includes('fretfree-audition'), 'Hear notes is in backups');
  w.localStorage.setItem('fretfree-audition', 'true');
  run('applyStoredSettings()');
  assert.equal(run("$('audition').checked"), true, 'Restored settings apply Hear notes');
  // Audition pitches match playback pitches note for note, through key signatures, bar accidentals, chords, octave
  // clefs (on a line or inline), transpose= on K: and V: lines, and %%MIDI transpose for the tune or from a line on.
  const sounds = abc => [
    run(`noteLabels(ABCJS.parseOnly(${JSON.stringify(abc)})[0],'letters').flatMap(l=>l.midis).join()`),
    run(`parseMidi(midiBytes(${JSON.stringify(abc)})).notes.map(n=>n.note).join()`)
  ];
  for (const abc of [
    'X:1\nM:4/4\nL:1/4\nK:A\n[FA] ^G =G G | [C=E] c G, g |]',
    'X:1\nL:1/4\nK:G clef=treble-8\nG A B c|\nd e f g|]',
    'X:1\nL:1/4\nK:C clef=bass-8\nC, D, [K:clef=treble+8] E F|]',
    'X:1\nL:1/4\nK:C clef=treble-8\nC D|\n[K:clef=treble] E F|]',
    'X:1\nL:1/4\nK:C transpose=-2\nC D|\nE F|]',
    'X:1\nL:1/4\nK:C\nV:1 transpose=-2\nC D E F|]',
    'X:1\nL:1/4\n%%MIDI transpose -2\nK:C\nC D|\n%%MIDI transpose 3\nE F|]'
  ]) {
    const [heard, played] = sounds(abc);
    assert.equal(heard, played, 'Audition MIDI equals playback MIDI: ' + JSON.stringify(abc));
  }
  // Playback holds a tied note, so the note after the bar line sounds the pitch it was tied from.
  assert.deepEqual(
    sounds('X:1\nM:4/4\nL:1/4\nK:C\nC D E ^F-|F F A B|]'),
    ['60,62,64,66,66,65,69,71', '60,62,64,66,65,69,71'],
    'A note tied across a bar line sounds the held sharp'
  );
}
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
  await checkAudio();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, slur- and tuplet-start note edits, repeats, pickups, ties, tempo changes, speed scaling, practice ranges, count-in, metronome, master volume bus, note audition, bar checks, and legacy storage.'
  );
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
