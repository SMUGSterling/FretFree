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
  'palette.js',
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
// Notation palette: buttons show the selected note's state and make the same edit as the menu or key, one undo step each.
{
  const abc = 'X:1\nM:4/4\nL:1/8\nK:C\n^G3- G E F G A | B4 z3 z |]';
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Flute'})`);
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    press = action => run(`document.querySelector('[data-palette="${action}"]').click()`),
    pressed = () =>
      run(`[...document.querySelectorAll('#palette [aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`),
    disabled = () =>
      run(`[...document.querySelectorAll('#palette [aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`),
    status = () => run("$('selection-status').textContent");
  assert.equal(run("$('palette').getAttribute('role')"), 'toolbar');
  pick(0);
  assert.equal(pressed(), 'len:0.25 dot tie acc:^', 'A dotted quarter G sharp tied to the next note');
  assert.equal(disabled(), 'beam:join beam:break', 'A dotted quarter has no flag to beam');
  pick(2);
  assert.equal(pressed(), 'len:0.125 acc:', 'A plain eighth');
  assert.equal(disabled(), 'beam:break', 'Break needs a beamed note');
  pick(7);
  assert.equal(pressed(), 'len:0.25 dot', 'A rest shows only its length (here a dotted quarter)');
  assert.equal(disabled(), 'tie to-rest acc:^ acc:_ acc:= acc: beam:join beam:break');
  press('acc:^');
  assert.equal(body(), '^G3- G E F G A | B4 z3 z |]', 'Disabled buttons change nothing');
  assert.equal(status(), 'Rests have no accidental, tie or beam.');
  // Each button matches the note menu and the keys, as one undo step.
  const same = (i, action, key) => {
    pick(i);
    press(action);
    const viaPalette = body();
    run('stepHistory(-1)');
    pick(i);
    if (key) run(`scoreKey({key:${JSON.stringify(key)}})`);
    else run(`(s=>editNote(s.entry,s.display,${JSON.stringify(action)}))(selectedNote())`);
    assert.equal(body(), viaPalette, `${action} matches ${key ? 'the ' + key + ' key' : 'the note menu'}`);
    run('stepHistory(-1)');
    assert.equal(body(), '^G3- G E F G A | B4 z3 z |]', `${action} is one undo step`);
    return viaPalette;
  };
  assert.equal(same(2, 'len:0.5', '6'), '^G3- G E4 F G A | B4 z3 z |]');
  assert.equal(same(0, 'dot', '.'), '^G2- G E F G A | B4 z3 z |]');
  assert.equal(same(0, 'tie', '+'), '^G3 G E F G A | B4 z3 z |]');
  assert.equal(same(2, 'acc:_', '-'), '^G3- G _E F G A | B4 z3 z |]');
  assert.equal(same(0, 'acc:'), 'G3- G E F G A | B4 z3 z |]');
  assert.equal(same(2, 'delete', 'Delete'), '^G3- G F G A | B4 z3 z |]');
  assert.equal(same(0, 'to-rest'), 'z3 G E F G A | B4 z3 z |]', 'Rest keeps the length and drops the tie');
  assert.equal(same(2, 'beam:join'), '^G3- G EF G A | B4 z3 z |]', 'Join removes the space');
  pick(2);
  press('beam:join');
  assert.equal(pressed(), 'len:0.125 acc: beam:join', 'Joined notes show Join pressed');
  assert.equal(status(), 'Beamed to the next note.');
  press('beam:break');
  assert.equal(body(), '^G3- G E F G A | B4 z3 z |]', 'Break puts the space back');
  pick(5);
  assert.ok(disabled().includes('beam:join'), 'No beam across a bar line');
  // With nothing selected a length button sets the length of new notes, like keys 3–7.
  run("scoreKey({key:'Escape'})");
  assert.equal(disabled(), 'dot tie to-rest acc:^ acc:_ acc:= acc: beam:join beam:break delete');
  assert.equal(pressed(), 'len:0.5', 'Shows the length new notes get: the last one chosen (key 6 above)');
  run('inputLength=null;updatePalette()');
  assert.equal(pressed(), 'len:0.25', 'New notes default to one beat');
  press('len:0.0625');
  assert.equal(run('inputLength'), 0.0625);
  assert.equal(status(), 'New notes will be sixteenth notes.');
  assert.equal(pressed(), 'len:0.0625');
  run("scoreKey({key:'c'})");
  assert.equal(body(), '^G3- G E F G A | B4 z3 z c/2 |]', 'The next note takes the palette length');
  // A selected rest keeps its length; the next letter writes a note of the chosen length over it.
  pick(7);
  press('len:0.125');
  assert.equal(status(), 'New notes will be eighth notes. Type a letter to write one over the rest.');
  // An unknown editNote action changes nothing (it used to write NaN).
  pick(1);
  const before = run("$('abc').value");
  for (const action of ['bogus', 'len:', 'len:x', 'len:-1'])
    run(`(s=>editNote(s.entry,s.display,${JSON.stringify(action)}))(selectedNote())`);
  assert.equal(run("$('abc').value"), before, 'Unknown actions are ignored');
  // Accidentals show in written pitch for transposing instruments, like the note menu.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n^F c d e |]')},instrument:'Clarinet in B♭'})`);
  pick(0);
  assert.equal(pressed(), 'len:0.25 acc:^', 'Concert F sharp is a written G sharp');
  assert.equal(run("$('warnings').textContent"), '');
}
// Palette presses only say they worked when they did: beams need two flagged notes, a multi-measure rest has no dot,
// a press that changes nothing keeps the score saved, Rest takes the tie off the note before it, and a press's
// message gives way once the selection moves on.
{
  const open = music =>
      run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + music)},instrument:'Flute'})`),
    body = () => run("$('abc').value.split('\\n').slice(4).join('\\n').trim()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    press = action => run(`document.querySelector('[data-palette="${action}"]').click()`),
    pressed = () =>
      run(`[...document.querySelectorAll('#palette [aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`),
    disabled = () =>
      run(`[...document.querySelectorAll('#palette [aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`),
    status = () => run("$('selection-status').textContent"),
    beams = () => run("$('notation').querySelectorAll('.abcjs-beam-elem').length");
  open('G A B c|]');
  pick(0);
  assert.equal(disabled(), 'beam:join beam:break', 'Quarter notes have no flags to beam');
  press('beam:join');
  assert.equal(body(), 'G A B c|]', 'Join leaves quarter notes apart');
  assert.equal(status(), 'Only eighth notes and shorter can be beamed.');
  assert.equal(run('dirty'), false);
  open('GA B c|]');
  pick(0);
  assert.equal(pressed(), 'len:0.25 acc:', 'Quarter notes written together are not beamed, so Join is not pressed');
  open('G/ A B/ z/ c|]');
  pick(0);
  press('beam:join');
  assert.equal(status(), 'Only eighth notes and shorter can be beamed.', 'The next note has to be short too');
  pick(2);
  press('beam:join');
  assert.equal(body(), 'G/ A B/ z/ c|]');
  assert.equal(status(), 'A beam cannot end on a rest.');
  open('G/ A/ B c|]');
  pick(0);
  press('beam:join');
  assert.equal(body(), 'G/A/ B c|]');
  assert.equal(beams(), 1, 'Two eighth notes are beamed');
  // Rest takes the tie off the note before it (a tie into a rest means nothing), as one undo step.
  open('G- G A B|]');
  pick(1);
  press('to-rest');
  assert.equal(body(), 'G z A B|]', 'No tie into a rest');
  assert.equal(run("$('abc').value.slice(...selectedRange).trim()"), 'z', 'The new rest stays selected');
  run('stepHistory(-1)');
  assert.equal(body(), 'G- G A B|]', 'Rest and the tie it drops are one undo step');
  open('G2- | G2 A B|]');
  pick(1);
  press('to-rest');
  assert.equal(body(), 'G2 | z2 A B|]', 'Also across a bar line');
  open('G- G/>A/ B c|]');
  pick(1);
  press('to-rest');
  assert.equal(body(), 'G z3/4A/4 B c|]', 'Also on the first note of a broken-rhythm pair');
  open('V:1\nG2 A B-|\nV:2\nC2 D E-|\nV:1\nB4|\nV:2\nE4|]');
  pick(6);
  press('to-rest');
  assert.equal(body(), 'V:1\nG2 A B|\nV:2\nC2 D E-|\nV:1\nz4|\nV:2\nE4|]', 'Only the tie in the same voice');
  // A multi-measure rest shows no length and cannot be dotted; nothing changes, so the score stays saved.
  open('Z2 | C D E F|]');
  pick(0);
  assert.equal(pressed(), '', 'A multi-measure rest shows no length');
  assert.ok(disabled().startsWith('dot '), 'Dot is off for a multi-measure rest');
  press('dot');
  assert.equal(status(), 'A multi-measure rest cannot be dotted.');
  run("scoreKey({key:'.'})");
  assert.equal(body(), 'Z2 | C D E F|]');
  assert.equal(run("dirty || $('save-status').textContent"), '', 'The . key on Z changes nothing either');
  press('len:0.5');
  assert.equal(status(), 'New notes will be half notes.', 'Letters go after a multi-measure rest, not over it');
  open('^C D E F|]');
  pick(0);
  press('acc:^');
  assert.equal(status(), 'No change.', 'Sharp on a sharp note');
  press('len:0.25');
  assert.equal(status(), 'Already a quarter note.');
  assert.equal(run('dirty'), false, 'Presses that change nothing keep the score saved');
  // The message for a press gives way once the selection moves on.
  run("scoreKey({key:'Escape'})");
  press('dot');
  assert.equal(status(), 'Select a note on the score first.');
  run("scoreKey({key:'c'})");
  assert.equal(status(), 'Measure 1 selected.', 'Typing a note replaces the stale hint');
  press('dot');
  assert.equal(status(), 'Dotted.');
  run("scoreKey({key:'ArrowLeft'})");
  assert.match(status(), /^Measure 1 selected · type A–G/, 'Selecting another note replaces it too');
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
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, slur- and tuplet-start note edits, notation palette state, edits and guards, repeats, pickups, ties, tempo changes, speed scaling, practice ranges, count-in, metronome, bar checks, and legacy storage.'
  );
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
