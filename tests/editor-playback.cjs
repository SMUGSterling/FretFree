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
  'vendor/qrcode.js',
  'catalog.js',
  'catalog-expanded.js',
  'score-tools.js',
  'rights-tools.js',
  'musicxml.js',
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
  'keyboard.js',
  'assignments.js',
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
// MusicXML follows the edited ABC at concert pitch, however the chosen instrument transposes the staff on screen.
for (const instrument of ['Clarinet in B♭', 'Cello']) {
  run(`openScore({abc:${JSON.stringify(source)},instrument:${JSON.stringify(instrument)}})`);
  assert.notEqual(run('writtenABC()'), source, instrument + ' is shown transposed');
  run('scoreClick(scoreEvents(renderedTune).find(e=>e.element.pitches).element,0,[],{},{step:-1})');
  const xml = run("abcToMusicXML($('abc').value, {item: current})");
  assert.equal(
    [...xml.matchAll(/<step>(\w)<\/step><octave>(\d)/g)].map(m => m[1] + m[2]).join(' '),
    'D4 D4 E4 F4 G4 C5',
    instrument + ': concert pitch, with the dragged note'
  );
  assert.match(xml, /<repeat direction="forward"\/>[\s\S]*<repeat direction="backward"\/>/);
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
// Classroom colors and letters in noteheads: drawn on the SVG by written letter, never written to the ABC source.
{
  const abc = 'X:1\nL:1/4\nK:D\nC, c [CEG] ^c | g G, z [G^g] | {a}_B2 e2 |]',
    instrument = run('currentInstrument()');
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Flute'})`);
  run("$('note-colors').value='classroom';$('note-colors').onchange()");
  const heads = () =>
    run(
      `[...document.querySelectorAll('#notation .abcjs-notehead')].map(h=>(h.getAttribute('data-name').match(/[A-G]/i)[0].toUpperCase())+'='+h.getAttribute('fill')).join(' ')`
    );
  const fills = new Set(heads().split(' '));
  for (const [letter, fill] of [
    ['C', '#d62828'],
    ['G', '#4cc9f0'],
    ['E', '#ffd60a'],
    ['B', '#7b2cbf'],
    ['A', '#1d3fbb']
  ])
    assert.deepEqual(
      [...fills].filter(f => f.startsWith(letter + '=')),
      [letter + '=' + fill],
      `Every ${letter} head is colored, in all octaves, chords and with accidentals`
    );
  assert.equal(run("document.querySelectorAll('#notation .abcjs-notehead:not([fill])').length"), 0);
  assert.equal(run("document.querySelectorAll('#notation .abcjs-stem[fill], #notation .abcjs-rest [fill]').length"), 0);
  assert.equal(
    run("document.querySelector('#notation .abcjs-notehead[data-name=\"E\"]').getAttribute('stroke')"),
    '#6b5300'
  );
  assert.equal(run("storage.get('fretfree-note-colors')"), 'classroom', 'Colors setting persists');
  run("$('note-names').value='heads';$('note-names').onchange()");
  assert.equal(
    run("[...document.querySelectorAll('#notation .notehead-letter')].map(t=>t.textContent).join('')"),
    'CCCEGCGGGGBE',
    'A letter in every head but the grace note'
  );
  // Every head is measured before the first color or letter goes in, so the browser lays out the score only once.
  assert.equal(
    run(`(() => {
      const log = [], bbox = SVGElement.prototype.getBBox, append = Node.prototype.appendChild,
        set = Element.prototype.setAttribute;
      SVGElement.prototype.getBBox = function () { log.push('read'); return bbox.call(this); };
      Node.prototype.appendChild = function (c) { log.push('write'); return append.call(this, c); };
      Element.prototype.setAttribute = function (...a) { log.push('write'); return set.apply(this, a); };
      try { updateNoteColors(); } finally {
        SVGElement.prototype.getBBox = bbox;
        Node.prototype.appendChild = append;
        Element.prototype.setAttribute = set;
      }
      render();
      return log.filter((x, i) => x !== log[i - 1]).join(' ');
    })()`),
    'read write',
    'Heads are measured before anything is drawn'
  );
  assert.equal(run("document.querySelectorAll('#notation .abcjs-annotation').length"), 0, 'No labels under the score');
  assert.equal(run("$('abc').value"), abc, 'The ABC source is byte-identical');
  run(`openScore({abc:${JSON.stringify('X:1\nL:1/4\nK:C\nC E G c|]')},instrument:'Clarinet in B♭'})`);
  assert.equal(
    run("[...document.querySelectorAll('#notation .notehead-letter')].map(t=>t.textContent).join('')"),
    'DFAD',
    'Written letters for a transposing instrument'
  );
  assert.equal(
    run("document.querySelector('#notation .abcjs-notehead').getAttribute('fill')"),
    '#f77f00',
    'Written D is orange'
  );
  run(
    "$('note-colors').value='off';$('note-colors').onchange();$('note-names').value='off';$('note-names').onchange()"
  );
  assert.equal(
    run("document.querySelectorAll('#notation .notehead-letter, #notation .abcjs-notehead[fill]').length"),
    0
  );
  w.localStorage.removeItem('fretfree-note-colors');
  w.localStorage.removeItem('fretfree-note-names');
  run(`openScore({abc:${JSON.stringify(abc)},instrument:${JSON.stringify(instrument)}})`);
}
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
// On-screen piano: keys are written pitch; notes go into the source at concert pitch, spelled for the key in force,
// over a selected rest or after the selected note; Shift (or a held key) adds to the chord. One undo step per tap.
{
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    tap = (midi, shift = false) =>
      run(
        `$('piano-keys').querySelector('[data-piano-midi="${midi}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:${shift}}))`
      ),
    open = (abc, instrument = 'Flute') =>
      run(
        `openScore({abc:${JSON.stringify(abc)},instrument:${JSON.stringify(instrument)}});selectEntry(scoreNotes()[0])`
      ),
    held = () => run("[...document.querySelectorAll('#piano-keys .held')].map(k=>k.dataset.pianoMidi).join()");
  assert.equal(run("$('piano').hidden"), true, 'The piano starts hidden');
  assert.equal(run("$('piano-keys').querySelectorAll('[data-piano-midi]').length"), 61, 'C2 to C7');
  assert.equal(run(`$('piano-keys').querySelector('[data-piano-midi="61"]').getAttribute('aria-label')`), 'C♯4 or D♭4');
  run("$('piano-toggle').click()");
  assert.equal(run("$('piano').hidden"), false);
  assert.equal(run("$('piano-toggle').getAttribute('aria-pressed')"), 'true');
  assert.equal(w.localStorage.getItem('fretfree-piano'), 'true', 'The piano setting is remembered');
  assert.ok(run('BACKUP_SETTING_KEYS()').includes('fretfree-piano'), 'The piano setting is in backups');
  open('X:1\nM:4/4\nL:1/4\nK:C\nz4 | z4 |]');
  tap(64);
  assert.equal(body(), 'E z3 | z4 |]', 'Tapping E4 with a rest selected writes E over it');
  tap(65);
  tap(67);
  assert.equal(body(), 'E F G z | z4 |]', 'Tapping in sequence enters a melody');
  tap(72, true);
  assert.equal(body(), 'E F [Gc] z | z4 |]', 'Shift+tap adds to the note just entered');
  run("scoreKey({key:'E',shiftKey:true})");
  assert.equal(body(), 'E F [Gce] z | z4 |]', 'Shift+E adds the E above the chord');
  assert.ok(run('!!selectedNote().entry.element.rest'), 'The rest after the chord stays selected');
  tap(60);
  assert.equal(body(), 'E F [Gce] C | z4 |]', 'The rest stays selected, so entry carries on after the chord');
  run('stepHistory(-1)');
  assert.equal(body(), 'E F [Gce] z | z4 |]', 'Each tap is one undo step');
  run('selectEntry(scoreNotes()[2])');
  assert.equal(held(), '67,72,76', "The selected chord's keys are lit");
  run('pianoFollow(selectedNote().display.startChar,true)');
  assert.equal(run("document.querySelectorAll('#piano-keys .sounding').length"), 3, 'Sounding notes light their keys');
  run('stop()');
  assert.equal(run("document.querySelectorAll('#piano-keys .sounding').length"), 0, 'Stopping clears the lights');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC z3 |]');
  run("scoreKey({key:'E',shiftKey:true})");
  assert.equal(body(), '[CE] z3 |]', 'Shift+E turns C into [CE]');
  run('stepHistory(-1);selectEntry(scoreNotes()[0])');
  tap(64, true);
  assert.equal(body(), '[CE] z3 |]', 'Shift+tap turns C into [CE]');
  tap(64, true);
  assert.equal(body(), '[CE] z3 |]', 'A pitch already in the chord is not added twice');
  // Spelling: in-key notes need no accidental; others use sharps in sharp keys and C, flats in flat keys; an
  // accidental earlier in the bar is cancelled with a natural.
  open('X:1\nM:4/4\nL:1/4\nK:F\nz4 |]');
  tap(70);
  tap(66);
  assert.equal(body(), 'B _G z2 |]', 'In F major the black key between A and B is B; F sharp is G flat');
  open('X:1\nM:4/4\nL:1/4\nK:G\nz4 |]');
  tap(66);
  tap(65);
  assert.equal(body(), 'F =F z2 |]', 'In G major the F sharp key enters F, and F natural needs =');
  open('X:1\nM:4/4\nL:1/4\nK:C\nz4 |]');
  tap(61);
  tap(60);
  tap(84);
  tap(48);
  assert.equal(body(), "^C =C c' C, |]", 'In C the C sharp key enters ^C; C after it in the bar needs =');
  // Transposing instruments: keys are written pitch, the source is concert.
  open('X:1\nM:4/4\nL:1/4\nK:C\nz4 |]', 'Clarinet in B♭');
  tap(62);
  assert.equal(body(), 'C z3 |]', 'On Clarinet in B♭ written D4 enters concert C');
  assert.equal(held(), '', 'A rest lights no keys');
  run('selectEntry(scoreNotes()[0])');
  assert.equal(held(), '62', 'Lights show the written pitch');
  open('X:1\nM:4/4\nL:1/4\nK:C\nz4 |]', 'Cello');
  tap(48);
  assert.equal(body(), 'C z3 |]', 'On Cello written C3 enters the source an octave up, as the cello part is written');
  // With nothing selected a tap adds the note at the end of the music.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:D\nD E |]')},instrument:'Flute'})`);
  tap(66);
  assert.equal(body(), 'D E F |]', 'With nothing selected the note goes at the end');
  assert.equal(run("$('warnings').textContent"), '');
  // Filling a rest completely passes the selection on to the next note, but chord pitches still go on the note just
  // entered, until the student picks a note on the score.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D z F |]');
  run('selectEntry(scoreNotes()[2])');
  tap(64);
  tap(67, true);
  assert.equal(body(), 'C D [EG] F |]', 'A chord after a filled rest goes on the note just entered');
  tap(72, true);
  assert.equal(body(), 'C D [EGc] F |]', 'And it keeps growing');
  run('stepHistory(-1);stepHistory(-1);stepHistory(-1);selectEntry(scoreNotes()[2])');
  tap(64);
  run("scoreKey({key:'G',shiftKey:true})");
  assert.equal(body(), 'C D [EG] F |]', 'Shift+G after a filled rest adds to the note just entered');
  run('selectEntry(scoreNotes()[3])');
  tap(72, true);
  assert.equal(body(), 'C D [EG] [Fc] |]', 'A note picked on the score takes the next chord pitch');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | z G A B |]');
  run('selectEntry(scoreNotes()[4])');
  tap(64);
  tap(67, true);
  assert.equal(body(), 'C D E F | [EG] G A B |]', 'Also for a note just after a bar line');
  // An accidental from the piano does not change later notes of that pitch in the bar: they get their own accidental.
  const midis = () => run("parseMidi(midiBytes($('abc').value)).notes.map(n=>n.note).join()");
  open('X:1\nM:4/4\nL:1/4\nK:C\nz C D C | C4 |]');
  tap(61);
  assert.equal(body(), '^C =C D C | C4 |]', 'The C after a new C sharp keeps its pitch');
  assert.equal(midis(), '61,60,62,60,60');
  run('stepHistory(-1)');
  assert.equal(body(), 'z C D C | C4 |]', 'One undo step');
  open('X:1\nM:4/4\nL:1/4\nK:G\nE z F2 |]');
  tap(65, true);
  assert.equal(body(), '[E=F] z ^F2 |]', 'A chord pitch with an accidental keeps later notes too');
  run('selectEntry(scoreNotes()[1])');
  tap(70);
  assert.equal(body(), '[E=F] ^A ^F2 |]', 'Notes of other letters are left alone');
  // The status line names the key as the key signature in force spells it.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D [K:Bb] z2 |]');
  run('selectEntry(scoreNotes()[2])');
  tap(70);
  assert.equal(body(), 'C D [K:Bb] B z |]');
  assert.match(run("$('selection-status').textContent"), /^Added B♭4\./, 'Named for the key after an inline K:');
  w.localStorage.setItem('fretfree-piano', 'false');
  run('applyStoredSettings()');
  assert.equal(run("$('piano').hidden"), true, 'Restored settings apply the piano setting');
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
  // The panel follows the score: another score closes it, and key changes and undo refresh the summary.
  const fScore = JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F\nF G A B | c d e f |]'),
    gScore = JSON.stringify('X:1\nM:4/4\nL:1/4\nK:G\nG A B c | d e f g |]');
  run(`openScore({abc:${fScore},instrument:'Flute'});selectEntry(scoreNotes()[4]);toggleTranspose(true)`);
  run("$('transpose-selection').checked=true;refreshTranspose()");
  assert.match(run("$('transpose-note').textContent"), /measure 2 move up/);
  run(`dirty=false;openScore({abc:${gScore},instrument:'Flute'})`);
  assert.ok(run("$('transpose-panel').hidden"), 'Opening another score closes the panel');
  run("toggleTranspose(true);$('transpose-selection').checked=true;applyTranspose()");
  assert.equal(body(), 'G A B c | d e f g |]', 'Selection only with nothing selected moves nothing');
  assert.match(run("$('toast').textContent"), /No measures are selected/);
  assert.equal(run('dirty'), false);
  run("selectEntry(scoreNotes()[4]);$('transpose-selection').checked=true;refreshTranspose();selectedRange=null");
  run("$('notation').dispatchEvent(new Event('click'))");
  assert.equal(run("$('transpose-selection').checked"), false, 'A cleared selection clears Selection only');
  run("changeKey('D',false)");
  assert.match(run("$('transpose-note').textContent"), /^D major \(2♯\) becomes E major/, 'A key change refreshes it');
  run('stepHistory(-1)');
  assert.match(run("$('transpose-note').textContent"), /^G major \(1♯\) becomes A major/, 'and so does undo');
  run("$('transpose-by-key').checked=true;$('transpose-key').value='G';refreshTranspose()");
  assert.ok(run("$('transpose-apply').disabled"), 'Transposing to the same key is not offered');
  stepAt = steps();
  run('applyTranspose()');
  assert.equal(run('dirty') + ' ' + steps(), 'false ' + stepAt, 'and changes nothing if run');
  run("$('transpose-by-interval').checked=true;toggleTranspose(false)");
  // Bagpipe keys do not transpose; the panel says so instead of failing.
  run(`openScore({abc:${JSON.stringify('X:1\nL:1/8\nK:HP\nA B c d |]')}});toggleTranspose(true)`);
  assert.equal(run("$('transpose-note').textContent"), 'This key cannot be transposed.');
  assert.ok(run("$('transpose-apply').disabled"));
  run('toggleTranspose(false)');
  // A tune with no K: line is in C: transposing adds the key, and a key change goes after the header.
  run(`openScore({abc:${JSON.stringify('X:1\nT:t\nL:1/4\nC D E F|]')}});toggleTranspose(true);applyTranspose()`);
  assert.equal(run("$('abc').value"), 'X:1\nT:t\nL:1/4\nK:D\nD E F G|]', 'No K: transposes from C major');
  run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nT:t\nL:1/4\nC D E F|]')}})`);
  run("$('key').value='G';$('key').dispatchEvent(new Event('input'));$('key-keep').click()");
  assert.equal(run("$('abc').value"), 'X:1\nT:t\nL:1/4\nK:G\nC D E F|]', 'Keep notes adds K: after the header');
  // Typed letters, drawn notes and accidentals use the written key's letters: concert F# on a B-flat clarinet is
  // written in Ab, two letters up, and concert C# on an E-flat alto sax in Bb, six.
  run(
    `dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F#\nF G ^A B |]')},instrument:'Clarinet in B♭'})`
  );
  assert.equal(run("letterToken('A', $('abc').value.length - 2)"), 'F', 'Typed A is written A-flat: concert F#');
  assert.equal(run("(e => accidentalEdit(e, displayOf(e), ''))(scoreNotes()[2])"), 'A ', 'A plain written C is A#');
  assert.equal(run("(e => accidentalEdit(e, displayOf(e), '^'))(scoreNotes()[2])"), '^^A ');
  run("selectEntry(scoreNotes()[0]);scoreKey({key:'C',shiftKey:true})");
  assert.equal(body(), '[FA] G ^A B |]', 'Shift+C adds the written C above written A-flat: concert A#');
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C#\nC D E F |]')},instrument:'Alto sax in E♭'})`);
  assert.equal(run("letterToken('A', $('abc').value.length - 2)"), 'B', 'Typed A on alto sax is concert B#');
  await checkAudio();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, Unicode offsets, drag direction, chord/rhythm preservation, slur- and tuplet-start note edits, notation palette state, edits and guards, repeats, pickups, ties, tempo changes, speed scaling, practice ranges, count-in, metronome, master volume bus, note audition, on-screen piano entry, spelling and chords, bar checks, transposing (whole score, selected measures, to a key, transposing instruments, no K: line, bagpipe keys), a transpose panel that follows the score, key changes that keep clef=, written-key letters for typing and accidentals, the key and meter menus, classroom colors and letters in noteheads, MusicXML at concert pitch, and legacy storage.'
  );
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
