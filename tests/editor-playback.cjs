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
  'theme.js',
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
  'measure-tools.js',
  'palette.js',
  'shortcuts.js',
  'playback.js',
  'keyboard.js',
  'assignments.js',
  'turn-in.js',
  'record.js',
  'assess.js',
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
// Zoom and measures per line: zoom narrows the staff width (never abcjs scale); a chosen count re-flows the lines.
const json = expr => JSON.parse(run(`JSON.stringify(${expr})`));
assert.deepEqual(json('layoutOptions(100,0)'), {staffwidth: 740}, '100% on Auto keeps the source lines');
assert.deepEqual(json('layoutOptions(70,0)'), {staffwidth: 1057});
{
  // Zoomed in, text set across the page keeps its 100% size (half the abcjs default at 200%) and its style.
  const {format, ...layout} = json('layoutOptions(200,0)');
  assert.deepEqual(layout, {staffwidth: 370, wrap: {minSpacing: 1.8, maxSpacing: 2.7}});
  assert.deepEqual(
    [format.titlefont, format.composerfont, format.tempofont, format.wordsfont],
    ['"Times New Roman" 10', '"Times New Roman" 7 italic', '"Times New Roman" 7.5 bold', '"Times New Roman" 8']
  );
  assert.equal(json('layoutOptions(140,0)').format.titlefont, '"Times New Roman" 14.29');
  const tune = run(
    `ABCJS.parseOnly('X:1\\nT:Title\\nC:Composer\\nQ:"Slow" 1/4=60\\nK:C\\nC|\\nW:Words', layoutOptions(200,0))[0]`
  );
  assert.deepEqual(tune.warnings, undefined, 'abcjs accepts the header fonts');
  assert.deepEqual(
    [tune.formatting.titlefont.size, tune.formatting.composerfont.style, tune.formatting.tempofont.weight],
    [10, 'italic', 'bold']
  );
}
assert.deepEqual(json('layoutOptions(100,4)'), {
  staffwidth: 740,
  wrap: {minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: 4}
});
assert.deepEqual(
  json("[validZoom(150),validZoom('120'),validMeasuresPerLine(5),validMeasuresPerLine('6')]"),
  [100, 120, 0, 6]
);
assert.equal(run('engraveOptions().scale'), undefined, 'Zoom never sets abcjs scale');
{
  const eight =
    'X:1\nT:Eight bars\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | c B A G | F E D C | C E G c | c G E C | D F A c | c4 |]';
  run(`openScore({abc:${JSON.stringify(eight)},instrument:'Flute'})`);
  const systems = () => run('renderedTune.engraver.staffgroups.length');
  assert.equal(systems(), 1, 'Auto at 100% keeps the one source line');
  run("$('measures-per-line').value='2';$('measures-per-line').dispatchEvent(new Event('change'))");
  assert.equal(systems(), 4, '2 per line gives four systems');
  assert.equal(w.localStorage.getItem('fretfree-measures-per-line'), '2', 'Measures per line is remembered');
  assert.equal(run('editHistory.length'), 1, 'A layout change is not an undo step');
  run("$('zoom-in').click()");
  assert.deepEqual(
    json(
      "[zoomPercent,$('zoom-reset').textContent,engraveOptions().staffwidth,localStorage.getItem('fretfree-zoom'),$('selection-status').textContent]"
    ),
    [120, '120%', 617, '120', 'Zoom 120%.'],
    'Zoom in steps to 120%, is remembered and is announced'
  );
  run("for(let i=0;i<9;i++)$('zoom-in').click()");
  assert.deepEqual(
    json("[zoomPercent,$('zoom-in').getAttribute('aria-disabled'),$('selection-status').textContent]"),
    [200, 'true', 'Zoom 200%. This is the largest size.'],
    'Zoom stops at 200% and says so'
  );
  run("$('zoom-reset').click()");
  assert.deepEqual(json("[zoomPercent,$('zoom-in').getAttribute('aria-disabled'),$('selection-status').textContent]"), [
    100,
    'false',
    'Zoom 100%.'
  ]);
  assert.ok(
    run('BACKUP_SETTING_KEYS()').includes('fretfree-zoom') &&
      run('BACKUP_SETTING_KEYS()').includes('fretfree-measures-per-line'),
    'Zoom and measures per line are in backups'
  );
  // Restored values are checked: an unknown zoom or count falls back to 100% and Auto.
  w.localStorage.setItem('fretfree-zoom', '170');
  w.localStorage.setItem('fretfree-measures-per-line', '4');
  run('applyStoredSettings();render()');
  assert.deepEqual(
    json("[zoomPercent,$('measures-per-line').value]"),
    [170, '4'],
    'Restored settings apply the layout'
  );
  run('showZoom(100);render()');
  assert.equal(systems(), 2, '4 per line engraves eight bars as two systems');
  w.localStorage.setItem('fretfree-zoom', '"huge"');
  w.localStorage.setItem('fretfree-measures-per-line', '5');
  run('applyStoredSettings()');
  assert.deepEqual(json("[zoomPercent,$('measures-per-line').value]"), [100, '0']);
  w.localStorage.removeItem('fretfree-zoom');
  w.localStorage.removeItem('fretfree-measures-per-line');
  run('render()');
}
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
// Range selection and the clipboard: Shift+arrows and Shift+click extend the selection in one voice; Ctrl+C/X/V/D copy,
// cut to rests, paste and duplicate (in memory, as jsdom has no navigator.clipboard); arrows, accidentals, [ ] and
// Delete act on every selected note. Each edit is one undo step.
{
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    key = (k, mods = {}) => run(`scoreKey(${JSON.stringify({key: k, ...mods})})`),
    ctrl = k => key(k, {ctrlKey: true}),
    shown = () => run("$('abc').value.slice($('abc').selectionStart,$('abc').selectionEnd)").trim(),
    lit = () =>
      run(
        "new Set(renderedTune.engraver.selected.filter(x=>x.abcelem.el_type==='note').map(x=>x.abcelem.startChar)).size"
      ),
    open = abc => run(`openScore({abc:${JSON.stringify(abc)},instrument:'Flute'})`);
  assert.equal(run('typeof navigator.clipboard'), 'undefined', 'jsdom has no system clipboard');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | z4 |]');
  pick(0);
  for (let i = 0; i < 3; i++) assert.equal(key('ArrowRight', {shiftKey: true}), true);
  assert.equal(run('selectedNotes().length'), 4, 'Shift+→ three times selects four notes');
  assert.equal(shown(), 'C D E F', 'The ABC selection spans them');
  assert.equal(lit(), 4, 'All four are highlighted');
  assert.match(run("$('selection-status').textContent"), /^4 notes selected in measure 1/);
  key('ArrowRight', {shiftKey: true});
  assert.equal(run('selectedNotes().length'), 5, 'Shift+→ crosses the bar line');
  key('ArrowLeft', {shiftKey: true});
  ctrl('c');
  assert.equal(run('clip.notes'), 'C D E F');
  assert.equal(run('clip.bar'), true, 'A whole measure copies with its bar line');
  pick(7);
  ctrl('v');
  assert.equal(body(), 'C D E F | G A B c | C D E F | z4 |]', 'Ctrl+V inserts an exact copy after the measure');
  assert.equal(shown(), 'C D E F', 'The pasted notes are selected');
  assert.equal(lit(), 4);
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | G A B c | z4 |]', 'One undo removes the paste');
  pick(5);
  ctrl('v');
  assert.equal(body(), 'C D E F | G A C D E F B c | z4 |]', 'Mid-measure, the copy goes right after the note');
  assert.equal(run('barIssues.length'), 1, 'Pasting does not re-bar; the bar check reports the overflow');
  run('stepHistory(-1)');
  // A selected rest at least as long as the clip is written over from its start.
  run('selectEntry(scoreNotes()[8])');
  ctrl('v');
  assert.equal(body(), 'C D E F | G A B c | C D E F |]', 'Paste over a whole-bar rest');
  assert.equal(run('barIssues.length'), 0);
  open('X:1\nM:4/4\nL:1/4\nK:C\nz4 | z4 |]');
  run(`clip={notes:'C D',bar:false,count:2,length:0.5,unit:0.25,alters:[[0],[0]]}`);
  pick(1);
  ctrl('v');
  assert.equal(body(), 'z4 | C D z2 |]', 'A longer rest keeps what is left');
  // Ctrl+D twice on a one-bar selection: three copies in a row, the newest selected.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]');
  pick(0);
  ctrl('a');
  assert.equal(run('selectedNotes().length'), 5, 'Ctrl+A selects every note of the voice');
  pick(3);
  for (let i = 0; i < 3; i++) key('ArrowLeft', {shiftKey: true});
  assert.equal(run('selectionAnchor'), 'last', 'Selecting leftward keeps the anchor at the end');
  ctrl('d');
  ctrl('d');
  assert.equal(body(), 'C D E F | C D E F | C D E F | G4 |]', 'Ctrl+D twice makes three copies');
  assert.equal(run('selectedNotes().map(n=>n.measure).join()'), '3,3,3,3', 'The newest copy is selected');
  assert.equal(run('barIssues.length'), 0, 'Duplicated measures keep the bar check clean');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | C D E F | G4 |]', 'Each duplicate is one undo step');
  // Before a closing or repeat bar line, the copy goes inside it.
  open('X:1\nM:4/4\nL:1/4\nK:C\n|: C D E F :|');
  pick(0);
  ctrl('a');
  ctrl('d');
  assert.equal(body(), '|: C D E F | C D E F :|', 'Duplicate before a repeat bar line');
  // Ctrl+X on two quarter notes leaves two quarter rests.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC (D !accent!E- E) | G4 |]');
  pick(1);
  key('ArrowRight', {shiftKey: true});
  ctrl('x');
  assert.equal(body(), 'C (z z E) | G4 |]', 'Cut keeps slurs, drops ties and decorations');
  assert.equal(run('barIssues.length'), 0, 'The bar check stays clean after a cut');
  assert.equal(run('clip.notes'), '(D !accent!E-');
  assert.equal(run("$('warnings').textContent"), '');
  // Multi-note edits: arrows, accidentals, [ ] and dots act on every note; rests are left alone by pitch edits.
  open('X:1\nM:4/4\nL:1/8\nK:C\nC2 D2 z2 [EG]2 | A8 |]');
  pick(0);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  key('ArrowUp');
  assert.equal(body(), 'D2 E2 z2 [FA]2 | A8 |]', '↑ moves every selected note a step');
  key('#');
  assert.equal(body(), '^D2 ^E2 z2 [^F^A]2 | A8 |]', '# sharpens every selected note');
  key('ArrowDown', {ctrlKey: true});
  assert.equal(body(), '^D,2 ^E,2 z2 [^F,^A,]2 | A8 |]', 'Ctrl+↓ drops an octave');
  key(']');
  assert.equal(body(), '^D,4 ^E,4 z4 [^F,^A,]4 | A8 |]', '] doubles every length, rests too');
  assert.equal(run('selectedNotes().length'), 4, 'The selection follows the edit');
  key('[');
  key('[');
  assert.equal(body(), '^D, ^E, z [^F,^A,] | A8 |]', '[ halves every length');
  key('.');
  assert.equal(body(), '^D,3/2 ^E,3/2 z3/2 [^F,^A,]3/2 | A8 |]', '. dots every note');
  run('stepHistory(-1)');
  assert.equal(body(), '^D, ^E, z [^F,^A,] | A8 |]', 'One undo per multi-note edit');
  pick(0);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  key('5');
  assert.equal(body(), '^D,2 ^E,2 z [^F,^A,]2 | A8 |]', 'A length key sets every note, not rests');
  // Broken rhythm: a partner outside the selection keeps its length.
  open('X:1\nM:4/4\nL:1/8\nK:C\nC>D E F G2 A2 |]');
  pick(1);
  key('ArrowRight', {shiftKey: true});
  key(']');
  assert.equal(body(), 'C3/2D E2 F G2 A2 |]', 'A broken-rhythm partner outside the selection keeps its length');
  // Delete removes whole measures with a bar line, so no empty measure is left.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | d4 |]');
  pick(4);
  ctrl('a');
  pick(4);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  key('Delete');
  assert.equal(body(), 'C D E F | d4 |]', 'Deleting a measure takes its bar line');
  assert.equal(shown(), 'F', 'The note before stays selected');
  pick(4);
  key('ArrowLeft', {shiftKey: true});
  key('Delete');
  assert.equal(body(), 'C D E |]', 'Deleting across a bar line joins the measures');
  // Shift+click extends the selection and still sets the practice range.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | d4 |]');
  const el = i => `scoreEvents(renderedTune).filter(e=>e.element.el_type==='note')[${i}].element`;
  run(`scoreClick(${el(1)},0,[],{},null,{})`);
  run(`scoreClick(${el(5)},0,[],{},null,{shiftKey:true})`);
  assert.equal(shown(), 'D E F | G A', 'Shift+click selects the notes between');
  assert.equal(run("$('start-measure').value+'-'+$('end-measure').value"), '1-2', 'and sets the range');
  run(`scoreClick(${el(2)},0,[],{},null,{shiftKey:true})`);
  assert.equal(shown(), 'D E', 'Shift+click again moves the end, keeping the anchor');
  assert.equal(run("$('start-measure').value+'-'+$('end-measure').value"), '1-1');
  run("toggleTranspose(true);$('transpose-selection').checked=true");
  run(`scoreClick(${el(1)},0,[],{},null,{})`);
  run('extendSelection(1);extendSelection(1);extendSelection(1);extendSelection(1)');
  run("setRange(1,+$('end-measure').max);refreshTranspose()");
  assert.equal(run("$('transpose-selection-label').textContent"), 'Selection only: measures 1–2');
  run('toggleTranspose(false)');
  key('ArrowRight');
  assert.equal(shown(), 'B', '→ leaves a range from its last note');
  // Typing after a range adds the note after its last note.
  pick(0);
  key('ArrowRight', {shiftKey: true});
  key('g');
  assert.equal(body(), 'C D G E F | G A B c | d4 |]');
  // Pasting into another score respells for its unit length and key, so the notes keep their lengths and pitches.
  open('X:1\nM:4/4\nL:1/8\nK:G\nG2 F2 E>D C2 |]');
  pick(0);
  ctrl('a');
  ctrl('c');
  open('X:1\nM:4/4\nL:1/4\nK:F\nz4 |]');
  pick(0);
  ctrl('v');
  assert.equal(body(), 'G ^F E3/4D/4 C |]', 'Paste in L:1/4 and F major keeps rhythm and pitch');
  assert.equal(run("$('warnings').textContent"), '');
  // The buttons do the same for touch screens.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | z4 |]');
  pick(0);
  run("$('select-right').onclick();$('select-right').onclick()");
  assert.equal(run('selectedNotes().length'), 3);
  run("$('copy-notes').onclick()");
  run("selectEntry(scoreNotes().at(-1));$('paste-notes').onclick()");
  assert.equal(body(), 'C D E F | C D E z |]');
  run('selectEntry(scoreNotes()[0])');
  run("$('duplicate-notes').onclick()");
  assert.equal(body(), 'C C D E F | C D E z |]');
  // A selection stays in one voice.
  open('X:1\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F |]\nV:2\nC, D, E, F, |]');
  pick(2);
  ctrl('a');
  assert.equal(shown(), 'C D E F', 'Ctrl+A selects the voice, not the whole score');
  key('ArrowRight', {shiftKey: true});
  assert.equal(run('selectedNotes().length'), 4, 'Shift+→ stops at the end of the voice');
  ctrl('d');
  assert.equal(run("$('abc').value.split('\\n').slice(-3).join('|')"), 'C D E F | C D E F |]|V:2|C, D, E, F, |]');
  // Accidentals on a transposing instrument are set in written pitch, note by note.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |]')},instrument:'Clarinet in B♭'})`);
  pick(0);
  key('ArrowRight', {shiftKey: true});
  key('-');
  assert.equal(body(), '_C _D E F |]', 'Written flats on a B-flat clarinet');
  key('=');
  assert.equal(body(), '=C =D E F |]', 'Written naturals in written D major');
  // A range asks for the written score once, not once per note, so a long selection does not freeze the page.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + 'C D E F | '.repeat(16) + '|]')},instrument:'Clarinet in B♭'})`
  );
  pick(0);
  ctrl('a');
  run('window.plainWritten=writtenABC;window.writtenCalls=0;writtenABC=()=>(writtenCalls++,plainWritten())');
  key('#');
  assert.equal(run('writtenCalls'), 2, 'One written score for the 64 notes and one for the new render');
  run('writtenABC=plainWritten');
  assert.equal(body().slice(0, 25), '^C ^D =E ^F | ^C ^D =E ^F', 'Every note sharpened in written pitch');
  // Accidentals last to the end of the measure, so the notes an edit does not touch keep their pitch, and copied
  // notes keep theirs.
  const midis = () =>
    run("noteLabels(ABCJS.parseOnly($('abc').value)[0],'letters').map(l=>l.midis.join('+')).join(' ')");
  open('X:1\nM:4/4\nL:1/4\nK:C\n^C D C D | E F G A |]');
  pick(2);
  key('ArrowRight', {shiftKey: true});
  ctrl('c');
  assert.deepEqual(JSON.parse(run('JSON.stringify(clip.alters)')), [[1], [0]], 'The clip knows the C is sharp');
  pick(4);
  ctrl('v');
  assert.equal(body(), '^C D C D | E ^C D F G A |]', 'A note sharp from earlier in its measure is pasted sharp');
  assert.equal(midis(), '61 62 61 62 64 61 62 65 67 69');
  open('X:1\nM:4/4\nL:1/4\nK:C\n^C D C D | E F G A |]');
  pick(0);
  key('ArrowRight', {shiftKey: true});
  ctrl('x');
  assert.equal(body(), 'z z ^C D | E F G A |]', 'Cutting a sharp keeps the later C sharp');
  run('stepHistory(-1)');
  pick(0);
  key('ArrowRight', {shiftKey: true});
  key('Delete');
  assert.equal(body(), '^C D | E F G A |]', 'So does deleting it');
  open('X:1\nM:4/4\nL:1/4\nK:C\n^F G A B | G F E D |]');
  pick(0);
  key('ArrowRight', {shiftKey: true});
  ctrl('c');
  pick(4);
  ctrl('v');
  assert.equal(body(), '^F G A B | G ^F G =F E D |]', 'A pasted sharp does not raise the F after it');
  assert.equal(midis(), '66 67 69 71 67 66 67 65 64 62');
  run('stepHistory(-1)');
  assert.equal(body(), '^F G A B | G F E D |]', 'The natural goes in the same undo step');
  pick(4);
  key('ArrowRight', {shiftKey: true});
  ctrl('d');
  assert.equal(body(), '^F G A B | G F G F E D |]', 'Duplicating plain notes adds nothing');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D C D |]');
  pick(0);
  key('ArrowRight', {shiftKey: true});
  key('#');
  assert.equal(body(), '^C ^D =C =D |]', 'Sharpening notes leaves the notes after them alone');
  open('X:1\nM:4/4\nL:1/4\nK:G\nF G A B | c4 |]');
  pick(0);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  ctrl('c');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]');
  pick(3);
  ctrl('v');
  assert.equal(body(), 'C D E F | ^F G A B | G4 |]', 'A measure from G major keeps its F sharp after a bar line');
  assert.equal(shown(), '^F G A B', 'The pasted notes are selected, accidental and all');
  // Fields in a clip stay behind: they would go on applying to the music after the paste.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D [K:D] F G | A B c d |]');
  pick(1);
  key('ArrowRight', {shiftKey: true});
  ctrl('c');
  assert.equal(run('clip.notes'), 'D F', 'No [K:D] in the clip');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC E | F G A B | F4 |]');
  pick(0);
  ctrl('v');
  assert.equal(body(), 'C D ^F E | F G A B | F4 |]', 'The F from D major is pasted sharp; the Fs after it stay');
  assert.equal(midis(), '60 62 66 64 65 67 69 71 65');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D [L:1/8] E2 F2 | G A B c |]');
  pick(1);
  key('ArrowRight', {shiftKey: true});
  ctrl('c');
  assert.equal(run('clip.notes'), 'D E', 'Lengths are written out in the unit length the clip starts in');
  open('X:1\nM:4/4\nL:1/16\nK:C\nC4 z12 |]');
  pick(1);
  ctrl('v');
  assert.equal(body(), 'C4 D4 E4 z4 |]', 'and pasted at their own length');
  // The last measure of music with no closing bar line is a whole measure too.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c');
  pick(4);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  ctrl('d');
  assert.equal(body(), 'C D E F | G A B c | G A B c', 'Duplicating it adds a bar line between the copies');
  assert.equal(run('barIssues.length'), 0);
  // Deleting the measures of a whole line takes the line with it: a blank line would end the tune.
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nG A B c |\nd4 |]');
  pick(4);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  key('Delete');
  assert.equal(run("$('abc').value.split('K:C\\n')[1]"), 'C D E F |\nd4 |]', 'No blank line is left');
  assert.equal(run('scoreNotes().length'), 5, 'The measure after it still renders');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nG A B c | d e f g |\na4 |]');
  pick(4);
  for (let i = 0; i < 7; i++) key('ArrowRight', {shiftKey: true});
  key('Delete');
  assert.equal(run("$('abc').value.split('K:C\\n')[1]"), 'C D E F |\na4 |]', 'Two bars that fill a line');
  open('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nG A B c |]');
  pick(2);
  for (let i = 0; i < 3; i++) key('ArrowRight', {shiftKey: true});
  key('Delete');
  assert.equal(run("$('abc').value.split('K:C\\n')[1]"), 'C D\nB c |]', 'A line break between notes that stay is kept');
  // Messages after the touch buttons name the button as well as the key.
  run("$('copy-notes').onclick()");
  assert.match(run("$('selection-status').textContent"), /^Copied 1 note\. Paste \(Ctrl\+V\)/);
  run("selectedRange=null;selectionAnchor=null;$('duplicate-notes').onclick()");
  assert.match(run("$('selection-status').textContent"), /Select ▸ \(Shift\+→\)/);
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
  assert.equal(
    disabled(),
    'tuplet:3 tuplet:6 beam:join beam:break grace:up grace:down',
    'A dotted quarter has no flag to beam and already splits into 3'
  );
  pick(2);
  assert.equal(pressed(), 'len:0.125 acc:', 'A plain eighth');
  assert.equal(disabled(), 'tuplet:2 beam:break grace:up grace:down', 'Break needs a beamed note');
  pick(7);
  assert.equal(pressed(), 'len:0.25 dot', 'A rest shows only its length (here a dotted quarter)');
  assert.equal(
    disabled(),
    'tie to-rest tuplet:3 tuplet:6 acc:^ acc:_ acc:= acc: respell beam:join beam:break deco:staccato deco:tenuto ' +
      'deco:accent deco:marcato lyric line:slur line:trill grace grace:slash grace:up grace:down deco:wedge ' +
      'deco:upbow deco:downbow deco:breath deco:trill deco:mordent deco:turn deco:arpeggio',
    'A rest takes only a dynamic, a fermata, a hairpin or a tuplet (and no note follows this one for lyrics)'
  );
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
  assert.equal(same(2, 'respell', 'z'), '^G3- G _F =F G A | B4 z3 z |]', 'Respell keeps the next F');
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
  assert.equal(
    disabled(),
    'dot tie to-rest tuplet:3 tuplet:2 tuplet:5 tuplet:6 tuplet:7 acc:^ acc:_ acc:= acc: respell beam:join ' +
      'beam:break deco:staccato deco:tenuto deco:accent deco:marcato deco:fermata dyn:ppp dyn:pp dyn:p dyn:mp dyn:mf ' +
      'dyn:f dyn:ff dyn:fff dyn:sfz chord lyric line:slur line:crescendo line:diminuendo line:trill grace grace:slash ' +
      'grace:up grace:down deco:wedge deco:upbow deco:downbow deco:breath deco:trill deco:mordent deco:turn ' +
      'deco:arpeggio delete'
  );
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
  assert.equal(disabled(), 'tuplet:2 beam:join beam:break grace:up grace:down', 'Quarter notes have no flags to beam');
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
  // The new note is named for screen readers: the C♯ before it in the bar carries on, and a fifth quarter overfills it.
  assert.equal(status(), 'Quarter note C♯4, measure 1, beat 5.', 'Typing a note replaces the stale hint');
  press('dot');
  assert.equal(status(), 'Dotted.');
  run("scoreKey({key:'ArrowLeft'})");
  assert.equal(status(), 'Quarter note F4, measure 1, beat 4.', 'Selecting another note replaces it too');
}
// Screen-reader announcements: selecting a note, and every edit without a message of its own, names the note's length,
// written pitch (in the key and the bar's accidentals), measure and beat in the status line.
{
  const status = () => run("$('selection-status').textContent"),
    body = () => run("$('abc').value.trim().split('\\n').pop()"),
    key = (k, extra = '') =>
      run(
        `$('notation').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true${extra}}))`
      ),
    open = instrument =>
      run(
        `openScore({abc:${JSON.stringify('X:1\nM:3/4\nL:1/8\nK:F\nC | B2 c3/2 d/ [FA]2 | z6 |]')},instrument:'${instrument}'})`
      );
  open('Flute');
  run('selectEntry(scoreNotes()[0])');
  assert.equal(status(), 'Eighth note C4, measure 1, beat 3½.', 'A pickup ends on the last beat');
  key('ArrowRight');
  assert.equal(status(), 'Quarter note B♭4, measure 2, beat 1.', 'Arrow keys name the note, in the key');
  key('ArrowRight');
  assert.equal(status(), 'Dotted eighth note C5, measure 2, beat 2.');
  key('ArrowRight');
  assert.equal(status(), '16th note D5, measure 2, beat 2¾.');
  key('ArrowRight');
  assert.equal(status(), 'Quarter note chord F4 A4, measure 2, beat 3.');
  key('ArrowRight');
  assert.equal(status(), 'Dotted half rest, measure 3, beat 1.');
  run('scoreClick(displayOf(scoreNotes()[1]),0,[],{},null,{shiftKey:false})');
  assert.match(status(), /^Quarter note B♭4, measure 2, beat 1 · type A–G/, 'A click adds what to do next');
  key('ArrowUp');
  assert.equal(status(), 'Quarter note C5, measure 2, beat 1.', 'Edits name the changed note');
  key('+');
  assert.equal(status(), 'Quarter note C5, tied to the next note, measure 2, beat 1.');
  assert.equal(body(), 'C | c2- c3/2 d/ [FA]2 | z6 |]');
  key('#');
  assert.equal(status(), 'Quarter note C♯5, tied to the next note, measure 2, beat 1.');
  run('stepHistory(-1);stepHistory(-1);stepHistory(-1)');
  // Letters typed over a rest name the new note, not what is left of the rest.
  run('inputLength=null;selectEntry(scoreNotes()[5])');
  key('g');
  assert.equal(status(), 'Quarter note G4, measure 3, beat 1.');
  run('stepHistory(-1)');
  // A transposing instrument names the written pitch, as the staff shows it.
  open('Clarinet in B♭');
  run('selectEntry(scoreNotes()[1])');
  assert.equal(status(), 'Quarter note C5, measure 2, beat 1.', 'B♭ clarinet: written a tone higher');
  run("$('concert-pitch').checked=true;$('concert-pitch').dispatchEvent(new Event('change'))");
  run('selectEntry(scoreNotes()[1])');
  assert.equal(status(), 'Quarter note B♭4, measure 2, beat 1.', 'Concert pitch view names the sounding note');
  run("$('concert-pitch').checked=false;$('concert-pitch').dispatchEvent(new Event('change'))");
  // Other lengths, rests and meters.
  const describe = (abc, i) => {
    run(`openScore({abc:${JSON.stringify('X:1\n' + abc)},instrument:'Flute'})`);
    run(`selectEntry(scoreNotes()[${i}])`);
    return status();
  };
  assert.equal(
    describe('M:6/8\nL:1/8\nK:C\nA3 B C D |]', 2),
    'Eighth note C4, measure 1, beat 2⅓.',
    '6/8 counts two beats'
  );
  assert.equal(describe('M:4/4\nL:1/8\nK:C\n(3ABc d6 |]', 1), 'Eighth note B4, measure 1, beat 1⅓.', 'Triplets');
  assert.equal(describe('M:4/4\nL:1/4\nK:C\nZ3 | C4 |]', 0), 'Rest for 3 measures, measure 1.');
  assert.equal(describe('M:4/4\nL:1/16\nK:C\nA7 B x8 |]', 0), 'Double-dotted quarter note A4, measure 1, beat 1.');
  assert.equal(describe('M:4/4\nL:1/16\nK:C\nA7 B x8 |]', 2), 'Invisible half rest, measure 1, beat 3.');
  assert.equal(describe('M:none\nL:1/4\nK:C\nC ^C D |]', 1), 'Quarter note C♯4, measure 1.', 'Free meter has no beats');
  assert.equal(
    run("describeNote({duration:0.5,pitches:[{pitch:-3,accidental:'flat'},{pitch:9}]},2,4)"),
    'Half note chord G♭3 E5, measure 2, beat 4',
    'Without spelled names, the note is named from its own accidentals'
  );
  // A first bar shortened by deleting a note is not a pickup, so its first note stays on beat 1; a pickup the score
  // opened with stays one as it is edited.
  const openBody = abc => run(`dirty=false;openScore({abc:${JSON.stringify('X:1\n' + abc)},instrument:'Flute'})`);
  openBody('M:4/4\nL:1/4\nK:C\nC D E F | G A B c |]');
  run('selectEntry(scoreNotes()[1])');
  key('Delete');
  assert.equal(body(), 'C E F | G A B c |]');
  assert.equal(status(), 'Quarter note C4, measure 1, beat 1.', 'A first bar shortened by Delete starts on beat 1');
  key('ArrowRight');
  assert.equal(status(), 'Quarter note E4, measure 1, beat 2.');
  openBody('M:4/4\nL:1/4\nK:C\nC D | E F G A |]');
  run('selectEntry(scoreNotes()[1])');
  key('Delete');
  assert.equal(body(), 'C | E F G A |]');
  assert.equal(status(), 'Quarter note C4, measure 1, beat 4.', 'An opened pickup stays one');
  // A short bar after a short bar that ends a section is the next section's pickup.
  assert.equal(
    describe('M:4/4\nL:1/4\nK:C\nC | E F G A | B c d :| e | f g a b |]', 8),
    'Quarter note E5, measure 4, beat 4.'
  );
  assert.equal(describe('M:2/4\nL:1/16\nK:C\nC4 C4 | G2G2 G2z || G | A8 |]', 6), '16th note G4, measure 3, beat 2¾.');
  // An edit that leaves nothing selected says so, rather than naming a note that is no longer selected.
  openBody('M:4/4\nL:1/4\nK:C\nC D E z | G A B c |]');
  run('selectEntry(scoreNotes()[3])');
  assert.equal(status(), 'Quarter rest, measure 1, beat 4.');
  key('|');
  assert.equal(body(), 'C D E z | | G A B c |]');
  assert.equal(run('selectedNote() ?? null'), null);
  assert.equal(status(), 'Bar line added. Nothing selected. Letters add notes at the end.');
  key('ArrowUp');
  assert.equal(body(), 'C D E z | | G A B c |]', 'Nothing to move');
  run('stepHistory(-1)');
  key('|');
  assert.equal(body(), 'C D E z | G A B c | |]', 'With nothing selected, | adds a bar line at the end');
  assert.equal(status(), 'Bar line added. Nothing selected. Letters add notes at the end.');
}
// Shortcut sheet: one SHORTCUTS table gives the palette its key hints; ? opens a dialog that lists the commands by
// task, keeps the keyboard, filters as you type, and runs the chosen command on the selection with Enter.
{
  const status = () => run("$('selection-status').textContent"),
    body = () => run("$('abc').value.trim().split('\\n').pop()"),
    active = () => run('document.activeElement?.id'),
    shown = () => run("[...$('shortcuts-list').querySelectorAll('[role=option]')].map(o=>o.textContent).join(' | ')"),
    press = (target, k, extra = '') =>
      run(
        `${target}.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true${extra}}))`
      ),
    search = q =>
      run(`$('shortcuts-search').value=${JSON.stringify(q)};$('shortcuts-search').dispatchEvent(new Event('input'))`);
  assert.equal(run(`document.querySelector('[data-palette="dot"]').title`), 'Dotted (.)');
  assert.equal(run(`document.querySelector('[data-palette="len:1"]').title`), 'Whole note (7)');
  assert.equal(
    run(`document.querySelector('[data-palette="delete"]').getAttribute('aria-keyshortcuts')`),
    'Delete Backspace'
  );
  assert.equal(
    run('SHORTCUTS.filter(s=>s.palette).every(s=>document.querySelector(`#palette [data-palette="${s.palette}"]`))'),
    true,
    'Every palette command in the table has its button'
  );
  assert.deepEqual(
    JSON.parse(
      run(
        "JSON.stringify([...document.querySelectorAll('#palette [data-palette]')].map(b=>b.dataset.palette).filter(a=>!['more','tuplets','measure'].includes(a)&&!SHORTCUTS.some(s=>s.palette===a)))"
      )
    ),
    [],
    'and every palette button is in the table'
  );
  assert.equal(
    run(`document.querySelector('[data-palette="tuplet:3"]').title`),
    'Triplet: three notes in the time of two (T)'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |]')},instrument:'Flute'})`);
  run('selectEntry(scoreNotes()[1]);focusScore()');
  press("$('notation')", '?');
  assert.equal(run("$('shortcuts').hidden"), false, '? opens the sheet');
  assert.equal(active(), 'shortcuts-search', 'The search box has the keyboard');
  assert.equal(run("$('shortcuts-open').getAttribute('aria-expanded')"), 'true');
  assert.deepEqual(
    JSON.parse(
      run("JSON.stringify([...$('shortcuts-list').querySelectorAll('.shortcut-group')].map(g=>g.textContent))")
    ),
    [
      'Select',
      'Write',
      'Length',
      'Tuplets and grace notes',
      'Pitch',
      'Marks',
      'Dynamics',
      'Lines and beams',
      'Measure',
      'Edit',
      'Play'
    ],
    'Grouped by task'
  );
  // Focus stays in the dialog.
  press("$('shortcuts-search')", 'Tab');
  assert.equal(active(), 'shortcuts-close');
  press("$('shortcuts-close')", 'Tab');
  assert.equal(active(), 'shortcuts-search');
  press("$('shortcuts-search')", 'Tab', ',shiftKey:true');
  assert.equal(active(), 'shortcuts-close');
  run("$('play').focus()");
  assert.equal(active(), 'shortcuts-search', 'Focus that leaves the dialog comes back');
  search('tie');
  assert.equal(shown(), 'Tie to the next note+', 'Typing "tie" filters to Tie');
  assert.equal(run("$('shortcuts-search').getAttribute('aria-activedescendant')"), 'shortcut-0');
  assert.equal(run("$('shortcuts-status').textContent"), '1 command. Enter runs Tie to the next note.');
  press("$('shortcuts-search')", 'Enter');
  assert.equal(run("$('shortcuts').hidden"), true, 'Enter runs it and closes the sheet');
  assert.equal(body(), 'C D- E F |]', 'Tie applies to the selected note');
  assert.equal(status(), 'Tied to the next note.');
  assert.equal(active(), 'notation', 'The score gets the keyboard back');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F |]', 'One undo step');
  // Arrow keys choose among the matches; commands that need a key on the score say which.
  run('selectEntry(scoreNotes()[1]);focusScore()');
  press("$('notation')", '?');
  search('octave');
  assert.equal(shown(), 'Up an octaveCtrl+↑ | Down an octaveCtrl+↓');
  press("$('shortcuts-search')", 'ArrowDown');
  assert.equal(run("$('shortcuts-search').getAttribute('aria-activedescendant')"), 'shortcut-1');
  press("$('shortcuts-search')", 'Enter');
  assert.equal(body(), 'C D, E F |]', 'Down an octave');
  run('stepHistory(-1)');
  press("$('notation')", '?');
  search('chord');
  assert.match(shown(), /^Add a pitch to the chord.* \| Chord symbolK/);
  press("$('shortcuts-search')", 'Enter');
  assert.equal(run("$('shortcuts').hidden"), false, 'A command typed on the score is not run');
  assert.equal(run("$('shortcuts-status').textContent"), 'Hold Shift and type a letter from A to G on the score.');
  search('zzz');
  assert.equal(run("$('shortcuts-status').textContent"), 'No commands match.');
  search('');
  press("$('shortcuts-search')", 'Enter');
  assert.equal(run("$('shortcuts').hidden"), false, 'Enter with nothing chosen does nothing');
  // Escape closes and gives the keyboard back to where it was.
  press("$('shortcuts-search')", 'Escape');
  assert.equal(run("$('shortcuts').hidden"), true);
  assert.equal(active(), 'notation');
  run("$('shortcuts-open').focus();$('shortcuts-open').click()");
  assert.equal(active(), 'shortcuts-search', 'The Shortcuts button opens it too');
  run("$('shortcuts-close').click()");
  assert.equal(active(), 'shortcuts-open', 'and gets the keyboard back');
  // Key commands, and commands on nothing.
  run('selectEntry(scoreNotes()[1])');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Select all notes'))");
  assert.match(status(), /^4 notes selected in measure 1/);
  run("scoreKey({key:'Escape'})");
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Up a step'))");
  assert.equal(status(), 'Select a note on the score first.');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Sharp'))");
  assert.equal(status(), 'Select a note on the score first.', 'Palette commands say why too');
  // ? in a text field types a question mark.
  run("$('abc').focus()");
  press("$('abc')", '?');
  assert.equal(run("$('shortcuts').hidden"), true, '? in the ABC box is text');
  assert.deepEqual(
    JSON.parse(run("JSON.stringify(filterShortcuts('ctrl dup').map(s=>s.name))")),
    ['Duplicate'],
    'Every word of the query must match'
  );
  // ? over the note menu closes the menu, so the chosen command runs on the note, and Escape gives the keyboard to the
  // score rather than to the hidden menu.
  const menuOn = i =>
    run(`selectEntry(scoreNotes()[${i}]);openNoteMenu(scoreNotes()[${i}],displayOf(scoreNotes()[${i}]),10,10)`);
  run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |]')},instrument:'Flute'})`);
  menuOn(1);
  assert.equal(run("!!document.activeElement.closest('#note-menu')"), true);
  press('document.activeElement', '?');
  assert.equal(run("$('note-menu').hidden"), true, '? closes the note menu');
  assert.equal(active(), 'shortcuts-search');
  search('up a step');
  press("$('shortcuts-search')", 'Enter');
  assert.equal(body(), 'C E E F |]', 'The command runs on the note');
  assert.equal(status(), 'Quarter note E4, measure 1, beat 2.');
  menuOn(1);
  press('document.activeElement', '?');
  press("$('shortcuts-search')", 'Escape');
  assert.equal(active(), 'notation', 'Escape gives the keyboard to the score');
  run('stepHistory(-1)');
}
// Articulations, dynamics and ornaments: ; : > " ^ and the palette toggle marks, dynamics replace each other, rests take
// only a dynamic or a fermata, and every edit is one undo step that keeps the selection.
{
  const music = '"G"C (D E) [CEG] z | Z2 | x4 |]',
    open = (m = music) =>
      run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + m)},instrument:'Flute'})`),
    body = () => run("$('abc').value.split('\\n').slice(4).join('\\n').trim()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    key = k => run(`scoreKey({key:${JSON.stringify(k)}})`),
    press = action => run(`document.querySelector('[data-palette=${JSON.stringify(action)}]').click()`),
    pressed = () =>
      run(`[...document.querySelectorAll('#palette [aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`),
    disabled = () =>
      run(`[...document.querySelectorAll('#palette [aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`),
    status = () => run("$('selection-status').textContent"),
    selected = () => run("$('abc').value.slice(...selectedRange).trim()");
  open();
  // Each key adds its mark after the chord symbol, says so, and the same key or palette button takes it off again.
  for (const [k, mark, written] of [
    [';', 'staccato', '.'],
    [':', 'tenuto', '!tenuto!'],
    ['>', 'accent', '!accent!'],
    ['"', 'marcato', '!marcato!'],
    ['^', 'fermata', '!fermata!']
  ]) {
    pick(0);
    assert.equal(key(k), true, `${k} is handled on the score`);
    assert.equal(body(), music.replace('"G"C', `"G"${written}C`), `${k} adds ${mark}`);
    assert.equal(selected(), `"G"${written}C`, 'The note stays selected');
    assert.equal(pressed(), `len:0.25 acc: deco:${mark}`, `The ${mark} button is pressed`);
    assert.match(status(), new RegExp(`^${mark} added\\.$`, 'i'));
    run('stepHistory(-1)');
    assert.equal(body(), music, `${mark} is one undo step`);
    pick(0);
    press('deco:' + mark);
    assert.equal(body(), music.replace('"G"C', `"G"${written}C`), `The ${mark} button matches the ${k} key`);
    key(k);
    assert.equal(body(), music, `${k} again removes ${mark}`);
    assert.match(status(), / removed\.$/);
  }
  // Slur-start notes and chords take marks too; shorthands count as the mark they stand for.
  pick(1);
  key(';');
  pick(3);
  key('>');
  assert.equal(body(), '"G"C (.D E) !accent![CEG] z | Z2 | x4 |]');
  open('LC TD HE .F|]');
  pick(0);
  assert.equal(pressed(), 'len:0.25 acc: deco:accent', 'L is an accent');
  key('>');
  assert.equal(body(), 'C TD HE .F|]', 'Removing a mark removes its shorthand');
  pick(3);
  key(';');
  assert.equal(body(), 'C TD HE F|]');
  // Dynamics replace each other, the pressed one comes off, and they go on rests too.
  open();
  pick(0);
  press('dyn:p');
  assert.equal(status(), 'Dynamic p.');
  press('dyn:f');
  assert.equal(body(), music.replace('"G"C', '"G"!f!C'), 'A new dynamic replaces the old one');
  assert.equal(pressed(), 'len:0.25 acc: dyn:f');
  press('dyn:f');
  assert.equal(body(), music, 'Pressing the dynamic the note has removes it');
  assert.equal(status(), 'Dynamic removed.');
  pick(4);
  assert.equal(
    disabled(),
    'tie to-rest tuplet:2 acc:^ acc:_ acc:= acc: respell beam:join beam:break deco:staccato deco:tenuto deco:accent ' +
      'deco:marcato lyric line:slur line:trill grace grace:slash grace:up grace:down deco:wedge deco:upbow ' +
      'deco:downbow deco:breath deco:trill deco:mordent deco:turn deco:arpeggio',
    'A rest offers a dynamic, a fermata, a hairpin and a tuplet (no note follows it for lyrics)'
  );
  run('dirty=false');
  key(';');
  assert.equal(status(), 'Rests take only a dynamic or a fermata.');
  assert.equal(body(), music, 'No staccato on a rest');
  assert.equal(run('dirty'), false);
  key('^');
  press('dyn:mp');
  assert.equal(body(), music.replace('z |', '!fermata!!mp!z |'), 'A fermata and a dynamic on a rest');
  // A multi-measure rest takes them too; an invisible rest takes nothing.
  pick(5);
  key('^');
  press('dyn:pp');
  assert.match(body(), /\| !fermata!!pp!Z2 \|/);
  pick(6);
  assert.ok(
    ['deco:fermata', 'dyn:p', 'dyn:sfz'].every(a => disabled().split(' ').includes(a)),
    'Nothing for an invisible rest'
  );
  press('dyn:p');
  assert.equal(status(), 'Invisible rests take no marks.');
  assert.match(body(), /\| x4 \|\]$/);
  // Ornaments and the other articulations sit under More, which says when the note has one while it is closed.
  open();
  assert.equal(run("$('palette-more').hidden"), true, 'More starts closed');
  press('more');
  assert.equal(run("$('palette-more').hidden"), false);
  assert.equal(run(`document.querySelector('[data-palette="more"]').getAttribute('aria-expanded')`), 'true');
  pick(0);
  for (const mark of ['trill', 'mordent', 'turn', 'arpeggio', 'wedge', 'upbow', 'downbow', 'breath']) {
    press('deco:' + mark);
    assert.ok(body().startsWith(`"G"!${mark}!C`), `The ${mark} button adds !${mark}!`);
    assert.equal(pressed(), `len:0.25 acc: deco:${mark}`);
    press('deco:' + mark);
    assert.equal(body(), music);
  }
  press('deco:trill');
  press('more');
  assert.equal(
    run(`document.querySelector('[data-palette="more"]').getAttribute('aria-label')`),
    'More marks (this note has trill)'
  );
  assert.ok(run(`document.querySelector('[data-palette="more"]').classList.contains('in-use')`));
  // The note menu offers the five articulations and the dynamics; a rest gets the fermata and dynamics only.
  const menuMarks = i =>
    run(
      `(e=>{openNoteMenu(e,displayOf(e),0,0);return [...document.querySelectorAll('#note-menu [data-edit*=":"]')]` +
        `.filter(b=>/^(deco|dyn):/.test(b.dataset.edit))` +
        `.map(b=>b.dataset.edit+(b.getAttribute('aria-checked')==='true'?'*':'')).join(' ')})(scoreNotes()[${i}])`
    );
  assert.equal(
    menuMarks(0),
    'deco:staccato deco:tenuto deco:accent deco:marcato deco:fermata dyn:ppp dyn:pp dyn:p dyn:mp dyn:mf dyn:f dyn:ff dyn:fff dyn:sfz'
  );
  run(`document.querySelector('#note-menu [data-edit="deco:tenuto"]').click()`);
  assert.ok(body().startsWith('"G"!trill!!tenuto!C '), 'The note menu adds a mark');
  assert.equal(status(), 'Tenuto added.');
  assert.equal(menuMarks(4), 'deco:fermata dyn:ppp dyn:pp dyn:p dyn:mp dyn:mf dyn:f dyn:ff dyn:fff dyn:sfz');
  run(`document.querySelector('#note-menu [data-edit="dyn:sfz"]').click()`);
  assert.match(body(), /\[CEG\] !sfz!z \|/);
  assert.match(menuMarks(4), /dyn:sfz\*/, 'The menu shows the dynamic the rest has');
  run('closeNoteMenu()');
  // Unknown marks change nothing.
  pick(1);
  const before = run("$('abc').value");
  for (const action of ['deco:bogus', 'deco:', 'dyn:fp', 'dyn:loud'])
    run(`(s=>editNote(s.entry,s.display,${JSON.stringify(action)}))(selectedNote())`);
  assert.equal(run("$('abc').value"), before, 'Unknown marks are ignored');
  // Marks stay in the concert source through instrument changes and show in the written-pitch display and note names.
  open('!f!.C !accent!D !trill!E !fermata!F |]');
  run("$('instrument').value='Clarinet in B♭';$('instrument').onchange();clearTimeout(renderTimer);render()");
  assert.equal(body(), '!f!.C !accent!D !trill!E !fermata!F |]', 'The source keeps its marks');
  assert.match(run('writtenABC()'), /!f!\.D !accent!E !trill!F !fermata!G \|\]/, 'Written pitch keeps them');
  run("$('note-names').value='letters';$('note-names').onchange();clearTimeout(renderTimer);render()");
  assert.deepEqual(
    run("JSON.stringify(scoreEvents(renderedTune).filter(e=>e.element.el_type==='note').map(e=>e.element.decoration))"),
    JSON.stringify([['f', 'staccato'], ['accent'], ['trill'], ['fermata']]),
    'The engraved notes carry the marks'
  );
  pick(1);
  key('>');
  assert.equal(body(), '!f!.C D !trill!E !fermata!F |]', 'Keys edit the concert source on a transposing instrument');
  run(
    "$('note-names').value='off';$('note-names').onchange();$('instrument').value='Flute';$('instrument').onchange()"
  );
  assert.equal(run("$('warnings').textContent"), '');
}
// A range selection with the palette and the piano: Dot, Tie, the accidentals, the lengths and Delete act on every
// selected note, as their keys do; the other buttons ask for one note; a piano key adds its note after the last one.
{
  const open = music =>
      run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + music)},instrument:'Flute'})`),
    body = () => run("$('abc').value.split('\\n').slice(4).join('\\n').trim()"),
    select = (i, j) => run(`selectNotesBetween(scoreNotes()[${i}],scoreNotes()[${j}]).length`),
    press = action => run(`document.querySelector('[data-palette="${action}"]').click()`),
    disabled = () =>
      run(`[...document.querySelectorAll('#palette [aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`),
    status = () => run("$('selection-status').textContent");
  run('inputLength=null');
  open('C D E F | G4 |]');
  assert.equal(select(0, 2), 3);
  assert.equal(
    disabled(),
    'to-rest tuplet:3 tuplet:2 tuplet:5 tuplet:6 tuplet:7 acc: respell beam:join beam:break grace grace:slash ' +
      'grace:up grace:down',
    'Buttons that cannot act on every note are off'
  );
  press('to-rest');
  assert.equal(status(), 'Select a single note for this.');
  assert.equal(body(), 'C D E F | G4 |]');
  press('acc:^');
  assert.equal(body(), '^C ^D ^E F | G4 |]', 'Sharp on every selected note');
  assert.equal(status(), 'Changed 3 notes.');
  assert.equal(run('selectedNotes().length'), 3, 'The notes stay selected');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | G4 |]', 'One undo step');
  select(0, 2);
  press('len:0.5');
  assert.equal(body(), 'C2 D2 E2 F | G4 |]', 'A length button sets every length');
  assert.equal(status(), 'Changed to half notes.');
  run('stepHistory(-1);inputLength=null');
  select(0, 2);
  press('delete');
  assert.equal(body(), 'F | G4 |]', 'Delete removes every selected note');
  assert.equal(status(), 'Deleted 3 notes.');
  // The piano and letters go on after the last selected note, even when it is a rest.
  open('C D z2 | G4 |]');
  select(0, 2);
  run('pianoPress(64)');
  assert.equal(body(), 'C D z2 E | G4 |]', 'A piano key after a range ending on a rest');
  open('C D z2 | G4 |]');
  select(2, 0);
  assert.equal(run('selectedNote().entry.element.startChar===scoreNotes()[0].element.startChar'), true);
  run("scoreKey({key:'f'})");
  assert.equal(body(), 'C D z2 F | G4 |]', 'A letter too, whichever end the selection grew from');
  // Marks on a range: an articulation goes on every note that lacks it, or comes off them all when they all have it,
  // from the palette or its key; a fermata goes on rests too; a dynamic goes on the first note.
  const pressed = () =>
    run(`[...document.querySelectorAll('#palette [aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`);
  open('C .D z E | G4 |]');
  select(0, 3);
  assert.ok(!pressed().includes('deco:staccato'), 'Staccato is not pressed while some notes lack it');
  press('deco:staccato');
  assert.equal(body(), '.C .D z .E | G4 |]', 'Staccato on every note that lacked it');
  assert.equal(status(), 'Staccato added to 2 notes.');
  assert.equal(run('selectedNotes().length'), 4, 'The notes stay selected');
  assert.ok(pressed().includes('deco:staccato'), 'Staccato is pressed once every note has it');
  assert.equal(run("scoreKey({key:';'})"), true);
  assert.equal(body(), 'C D z E | G4 |]', 'The key takes it off them all');
  assert.equal(status(), 'Staccato removed from 3 notes.');
  run("scoreKey({key:'^'})");
  assert.equal(body(), '!fermata!C !fermata!D !fermata!z !fermata!E | G4 |]', 'A fermata goes on the rest too');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D z E | G4 |]', 'One undo step');
  select(0, 3);
  press('dyn:f');
  assert.equal(body(), '!f!C D z E | G4 |]', 'A dynamic goes on the first note');
  assert.equal(status(), 'Dynamic f.');
  assert.ok(pressed().includes('dyn:f'));
  press('dyn:f');
  assert.equal(body(), 'C D z E | G4 |]', 'And comes off it');
  open('z z | x2 |]');
  select(0, 1);
  assert.ok(disabled().includes('deco:staccato') && !disabled().includes('deco:fermata'), 'Rests take a fermata');
  press('deco:staccato');
  assert.equal(status(), 'Rests take only a dynamic or a fermata.');
  assert.equal(body(), 'z z | x2 |]');
}
// Slurs, hairpins and trill lines: S and the toolbar's Lines group put a line over the selected notes, or from one
// note to the next, and the same press takes it off; each is one undo step that keeps the selection.
{
  const open = music =>
      run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + music)},instrument:'Flute'})`),
    body = () => run("$('abc').value.split('\\n').slice(4).join('\\n').trim()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    select = (i, j) => run(`selectNotesBetween(scoreNotes()[${i}],scoreNotes()[${j}]).length`),
    key = k => run(`scoreKey({key:${JSON.stringify(k)}})`),
    press = action => run(`document.querySelector('[data-palette="${action}"]').click()`),
    pressed = () =>
      run(
        `[...document.querySelectorAll('#palette [data-palette^="line:"][aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`
      ),
    disabled = () =>
      run(
        `[...document.querySelectorAll('#palette [data-palette^="line:"][aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`
      ),
    status = () => run("$('selection-status').textContent"),
    selected = () => run("$('abc').value.slice(...selectedRange).trim()");
  open('C D E F | G4 |]');
  assert.equal(select(0, 3), 4);
  assert.equal(pressed(), '');
  assert.equal(key('S'), true, 'S is handled on the score');
  assert.equal(body(), '(C D E F) | G4 |]', 'Four selected notes plus S give a slur');
  assert.equal(status(), 'Slur added over 4 notes.');
  assert.equal(run('selectedNotes().length'), 4, 'The notes stay selected');
  assert.equal(selected(), '(C D E F)');
  assert.equal(pressed(), 'line:slur', 'Slur is pressed');
  assert.equal(run("$('notation').querySelectorAll('.abcjs-slur').length"), 1, 'abcjs draws it');
  key('s');
  assert.equal(body(), 'C D E F | G4 |]', 'S again removes it');
  assert.equal(status(), 'Slur removed.');
  assert.equal(run('selectedNotes().length'), 4);
  run('stepHistory(-1)');
  assert.equal(body(), '(C D E F) | G4 |]', 'Removing is one undo step');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | G4 |]', 'Adding is one undo step');
  // One note: the slur goes to the next note, across the bar line; S on it again takes that slur off.
  pick(3);
  key('S');
  assert.equal(body(), 'C D E (F | G4) |]');
  assert.equal(status(), 'Slur added over 2 notes.');
  assert.equal(selected(), '(F', 'The one note stays selected');
  assert.equal(pressed(), 'line:slur');
  key('S');
  assert.equal(body(), 'C D E F | G4 |]');
  run('dirty=false');
  pick(4);
  key('S');
  assert.equal(status(), 'There is no next note to end the slur on.');
  assert.equal(pressed(), '');
  assert.equal(run('dirty'), false, 'Nothing changed');
  // A slur over a longer run replaces the slurs inside it; a shorter one replaces the slur starting on its first note.
  open('(C D) (E F) | G4 |]');
  select(0, 4);
  assert.equal(pressed(), '');
  key('S');
  assert.equal(body(), '(C D E F | G4) |]');
  select(0, 2);
  key('S');
  assert.equal(body(), '(C D E) F | G4 |]');
  // Rests: slurs and trill lines join notes, so rests at the ends are left out; hairpins can start or end on rests.
  open('z C D z | x4 |]');
  select(0, 3);
  key('S');
  assert.equal(body(), 'z (C D) z | x4 |]', 'The slur joins the notes inside the selection');
  assert.equal(status(), 'Slur added over 2 notes.');
  press('line:crescendo');
  assert.equal(body(), '!<(!z (C D) !<)!z | x4 |]', 'A crescendo from rest to rest');
  assert.equal(status(), 'Crescendo added over 4 notes.');
  assert.equal(pressed(), 'line:slur line:crescendo', 'Both are pressed');
  pick(0);
  assert.equal(disabled(), 'line:slur line:trill', 'A rest takes a hairpin only');
  key('S');
  assert.equal(status(), 'A slur starts on a note, not a rest.');
  pick(4);
  assert.equal(disabled(), 'line:slur line:crescendo line:diminuendo line:trill', 'An invisible rest takes nothing');
  run("scoreKey({key:'Escape'})");
  key('S');
  assert.equal(status(), 'Select a note on the score first.');
  assert.equal(disabled(), 'line:slur line:crescendo line:diminuendo line:trill');
  // Hairpins and trill lines from the toolbar: a diminuendo replaces a crescendo, the pressed one comes off.
  open('C D E F | G4 |]');
  select(0, 3);
  press('line:crescendo');
  assert.equal(body(), '!<(!C D E !<)!F | G4 |]');
  assert.equal(pressed(), 'line:crescendo');
  press('line:diminuendo');
  assert.equal(body(), '!>(!C D E !>)!F | G4 |]', 'A diminuendo replaces the crescendo');
  assert.equal(status(), 'Diminuendo added over 4 notes.');
  press('line:diminuendo');
  assert.equal(body(), 'C D E F | G4 |]');
  assert.equal(status(), 'Diminuendo removed.');
  press('line:trill');
  assert.equal(body(), '!trill(!C D E !trill)!F | G4 |]');
  assert.equal(pressed(), 'line:trill');
  assert.match(run('writtenABC()'), /!trill!C D E !trill\)!F/, 'The score shows tr; the source keeps the trill line');
  assert.equal(run('selectedNotes().length'), 4);
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | G4 |]', 'One undo step');
  assert.equal(run("$('warnings').textContent"), '');
  // Note edits on slurred notes keep working, and a mark added to a slurred note leaves the slur in place.
  open('(C D E F) | G4 |]');
  pick(0);
  key('ArrowUp');
  assert.equal(body(), '(D D E F) | G4 |]');
  key('#');
  key(';');
  assert.equal(body(), '(.^D D E F) | G4 |]');
  pick(3);
  key('+');
  key('6');
  assert.equal(body(), '(.^D D E F2-) | G4 |]', 'The tie goes before the slur end');
  pick(0);
  assert.equal(pressed(), 'line:slur', 'The slur still starts on the note abcjs reads from the dot');
  key('S');
  assert.equal(body(), '.^D D E F2- | G4 |]');
  key('S');
  assert.equal(body(), '(.^D D) E F2- | G4 |]', 'A slur goes in before a staccato dot');
  // In a score with several voices the next note is in the same voice.
  open('V:1\nC D|\nV:2\nE F|]');
  pick(1);
  key('S');
  assert.equal(status(), 'There is no next note to end the slur on.');
  pick(2);
  key('S');
  assert.equal(body(), 'V:1\nC D|\nV:2\n(E F)|]');
  // A voice written in blocks (V:1, V:2, V:1 ...): the slur goes on to the voice's next block, and S takes it off.
  open('V:1\nC D|\nV:2\nE F|\nV:1\nG A|\nV:2\nB c|]');
  pick(1);
  key('S');
  assert.equal(body(), 'V:1\nC (D|\nV:2\nE F|\nV:1\nG) A|\nV:2\nB c|]');
  assert.equal(pressed(), 'line:slur', 'The slur is found across the other voice');
  key('S');
  assert.equal(body(), 'V:1\nC D|\nV:2\nE F|\nV:1\nG A|\nV:2\nB c|]', 'S takes off both ends');
  // Chained slurs: one ends on the note where the next starts, which abcjs reads as two slurs.
  open('C D E F | G4 |]');
  select(0, 2);
  key('S');
  select(2, 3);
  key('S');
  assert.equal(body(), '(C D (E) F) | G4 |]', 'A slur from the last note of another');
  assert.equal(status(), 'Slur added over 2 notes.');
  assert.equal(run("$('notation').querySelectorAll('.abcjs-slur').length"), 2);
  assert.equal(pressed(), 'line:slur', 'The new slur is found');
  select(0, 2);
  assert.equal(pressed(), 'line:slur', 'So is the first');
  key('S');
  assert.equal(body(), 'C D (E F) | G4 |]', 'S takes off the first and keeps the second');
  assert.equal(status(), 'Slur removed.');
  run('stepHistory(-1)');
  select(2, 3);
  key('S');
  assert.equal(body(), '(C D E) F | G4 |]', 'S takes off the second and keeps the first');
  // One note at a time: S on the note a slur ends on starts the next slur there, and S again takes off only that one.
  open('C D E F | G4 |]');
  pick(0);
  key('S');
  pick(1);
  assert.equal(pressed(), '', 'No slur starts on D');
  key('S');
  assert.equal(body(), '(C (D) E) F | G4 |]');
  assert.equal(pressed(), 'line:slur');
  key('S');
  assert.equal(body(), '(C D) E F | G4 |]', 'The slur from C to D stays');
  // A line that starts before the selection and ends inside it comes off, so lines of a kind never cross; one around
  // the selection stays for a slur (a phrase mark) and comes off for a hairpin.
  open('(B, C D) E F | G4 |]');
  select(1, 3);
  key('S');
  assert.equal(body(), 'B, (C D E) F | G4 |]');
  assert.equal(pressed(), 'line:slur');
  open('!<(!B, C D !<)!E F | G4 |]');
  select(1, 4);
  press('line:diminuendo');
  assert.equal(body(), 'B, !>(!C D E !>)!F | G4 |]', 'A diminuendo replaces a crescendo it crosses');
  assert.equal(pressed(), 'line:diminuendo');
  open('(B, C D E F) | G4 |]');
  select(1, 3);
  key('S');
  assert.equal(body(), '(B, (C D E) F) | G4 |]');
  assert.equal(pressed(), 'line:slur');
  assert.equal(run("$('warnings').textContent"), '');
  // On a transposing instrument the score shows a trill line's start as tr; an accidental on that note, from a key,
  // the toolbar or a range, changes only the pitch in the source.
  for (const instrument of ['Clarinet in B♭', 'Alto sax in E♭']) {
    run(
      `dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n!trill(!C D E !trill)!F | G4 |]')},instrument:${JSON.stringify(instrument)}})`
    );
    pick(0);
    key('#');
    assert.equal(body(), '!trill(!^C D E !trill)!F | G4 |]', `${instrument}: # keeps the trill line`);
    press('acc:_');
    assert.equal(body(), '!trill(!_C D E !trill)!F | G4 |]', `${instrument}: the toolbar's flat keeps it`);
    select(0, 3);
    key('#');
    assert.equal(body(), '!trill(!^C ^D =E !trill)!^F | G4 |]', `${instrument}: so does # on a range`);
    assert.equal(pressed(), 'line:trill');
    assert.equal(run("$('warnings').textContent"), '');
  }
}
// Tuplets and grace notes: T and the toolbar's Triplet button split the selected note into a triplet with rests that
// letters fill, the Tuplet menu into 2, 5, 6 or 7; the same count takes it off again. Grace, Slashed and Grace ↑↓
// add, slash and move a grace note. Each is one undo step, from the keys, the toolbar and the note menu alike.
{
  const open = (music, head = 'M:4/4\nL:1/4') =>
      run(`dirty=false;openScore({abc:${JSON.stringify(`X:1\n${head}\nK:C\n` + music)},instrument:'Flute'})`),
    body = () => run("$('abc').value.split('\\n').slice(4).join('\\n').trim()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    key = k => run(`scoreKey({key:${JSON.stringify(k)}})`),
    press = action => run(`document.querySelector('[data-palette="${action}"]').click()`),
    group = prefix =>
      run(
        `[...document.querySelectorAll('#palette [data-palette^="${prefix}"][aria-pressed="true"]')].map(b=>b.dataset.palette).join(' ')`
      ),
    disabled = prefix =>
      run(
        `[...document.querySelectorAll('#palette [data-palette^="${prefix}"][aria-disabled="true"]')].map(b=>b.dataset.palette).join(' ')`
      ),
    status = () => run("$('selection-status').textContent"),
    selected = () => run("$('abc').value.slice(...selectedRange).trim()"),
    clean = () => {
      assert.equal(run("$('warnings').textContent"), '', 'abcjs reads it without warnings');
      assert.match(run("$('bar-check').textContent"), /Every bar has the right number of beats/);
    };
  open('C D E F | G4 |]');
  pick(0);
  assert.equal(key('T'), true, 'T is handled on the score');
  assert.equal(body(), '(3C/2 z/2 z/2 D E F | G4 |]', 'Triplet on a quarter in L:1/4');
  assert.equal(status(), 'Triplet: type letters to fill its rests.');
  assert.equal(selected(), 'z/2', 'The first rest is selected');
  assert.equal(group('tuplet:'), 'tuplet:3', 'Triplet is pressed on a member');
  assert.equal(run("$('notation').querySelectorAll('.abcjs-triplet').length"), 1, 'abcjs draws the 3');
  clean();
  key('d');
  assert.equal(body(), '(3C/2D/2 z/2 D E F | G4 |]', 'D fills the first rest at its own length, beamed to C');
  assert.equal(selected(), 'z/2', 'and the next rest is selected');
  assert.equal(status(), 'Triplet: type letters to fill its rests.');
  key('e');
  assert.equal(body(), '(3C/2D/2E/2 D E F | G4 |]', 'E fills the last rest');
  assert.equal(selected(), 'D', 'The note after the triplet is selected');
  assert.equal(status(), 'Triplet filled.', 'The status line no longer asks for letters');
  assert.equal(run("$('notation').querySelectorAll('.abcjs-beam-elem').length"), 1, 'The three eighths share a beam');
  clean();
  run('stepHistory(-1)');
  run('stepHistory(-1)');
  assert.equal(body(), '(3C/2 z/2 z/2 D E F | G4 |]');
  run('stepHistory(-1)');
  assert.equal(body(), 'C D E F | G4 |]', 'Making the triplet is one undo step');
  run('stepHistory(1)');
  run('stepHistory(1)');
  // The same count takes it off while the other members are rests; once they hold notes it says what to do.
  pick(1);
  key('T');
  assert.equal(body(), '(3C/2D/2 z/2 D E F | G4 |]', 'Not taken off over a note');
  assert.equal(status(), 'To change this triplet, turn its other notes into rests first.');
  run('stepHistory(-1)');
  pick(2);
  key('t');
  assert.equal(body(), 'C D E F | G4 |]', 'T on a member of an empty triplet puts the note back');
  assert.equal(status(), 'Triplet removed.');
  assert.equal(selected(), 'C');
  // The Tuplet menu: five members totalling a half note, then a triplet in its place, from the toolbar.
  open('C2 D2 | G4 |]');
  pick(0);
  assert.equal(run("$('palette-tuplets').hidden"), true, 'The Tuplet menu starts closed');
  press('tuplets');
  assert.equal(run("document.querySelector('[data-palette=\"tuplets\"]').getAttribute('aria-expanded')"), 'true');
  press('tuplet:5');
  assert.equal(body(), '(5:4:5C/2 z/2 z/2 z/2 z/2 D2 | G4 |]', 'Quintuplet on a half note: five eighths');
  assert.equal(status(), 'Quintuplet: type letters to fill its rests.');
  clean();
  for (const k of 'defg') key(k);
  assert.equal(body(), '(5:4:5C/2D/2E/2F/2G/2 D2 | G4 |]');
  clean();
  run('stepHistory(-1);stepHistory(-1);stepHistory(-1);stepHistory(-1)');
  press('tuplets');
  pick(0);
  assert.equal(
    run("document.querySelector('[data-palette=\"tuplets\"]').getAttribute('aria-label')"),
    'Tuplet (this note is in a quintuplet)',
    'The closed menu names the tuplet it holds'
  );
  pick(3);
  press('tuplet:3');
  assert.equal(body(), '(3C z z D2 | G4 |]', 'Triplet replaces the empty quintuplet');
  assert.equal(group('tuplet:'), 'tuplet:3');
  pick(0);
  assert.equal(disabled('tuplet:'), 'tuplet:2', 'A duplet needs a dotted note');
  press('tuplet:2');
  assert.equal(status(), 'A duplet goes on a dotted note, such as a dotted quarter.');
  assert.equal(body(), '(3C z z D2 | G4 |]');
  // Duplets in 6/8, a rest split into a triplet (the opening stays on the first rest), marks and grace notes kept.
  open('C3 D3 | z3 E3 |]', 'M:6/8\nL:1/8');
  pick(0);
  assert.equal(disabled('tuplet:'), 'tuplet:3 tuplet:6', 'A dotted note already splits into 3 and 6');
  run(`(s=>editNote(s.entry,s.display,'tuplet:2'))(selectedNote())`);
  assert.equal(body(), '(2C z D3 | z3 E3 |]', 'The note menu action matches');
  key('e');
  assert.equal(body(), '(2CE D3 | z3 E3 |]');
  clean();
  open('C D E F | z G3 |]');
  pick(4);
  key('T');
  assert.equal(body(), 'C D E F | (3z/2 z/2 z/2 G3 |]');
  assert.equal(selected(), '(3z/2', 'A rest split up is selected from its first member');
  for (const k of 'gab') key(k);
  assert.equal(body(), 'C D E F | (3G/2A/2B/2 G3 |]', 'Letters keep the opening');
  clean();
  open('"G"!f!.C D E F |]');
  pick(0);
  key('T');
  assert.equal(body(), '"G"!f!(3.C/2 z/2 z/2 D E F |]', 'The opening goes before the staccato dot');
  pick(0);
  assert.equal(group('tuplet:'), 'tuplet:3', 'abcjs starts that note after the (3, and it still counts');
  key('T');
  assert.equal(body(), '"G"!f!.C D E F |]');
  // Guards: broken rhythm, multi-measure rests, range selections, nothing selected.
  open('C>D E F | Z |]');
  pick(0);
  key('T');
  assert.equal(status(), 'Take off the broken rhythm (> or <) first.');
  pick(1);
  key('T');
  assert.equal(status(), 'Take off the broken rhythm (> or <) first.', 'Either note of the pair');
  pick(4);
  key('T');
  assert.equal(status(), 'A multi-measure rest cannot be split into a tuplet.');
  run('selectNotesBetween(scoreNotes()[1],scoreNotes()[3])');
  key('T');
  assert.equal(status(), 'T makes one note a triplet. Select a single note for this.');
  assert.equal(disabled('tuplet:'), 'tuplet:3 tuplet:2 tuplet:5 tuplet:6 tuplet:7');
  run("scoreKey({key:'Escape'})");
  run('dirty=false');
  key('T');
  assert.equal(status(), 'Select a note on the score first.');
  assert.equal(run('dirty'), false, 'Nothing changed');
  // Grace notes: Grace adds one a step above, Grace ↑↓ move only it, Slashed slashes it, a lit Grace removes it.
  open('c D E F | G4 |]');
  pick(0);
  assert.equal(disabled('grace'), 'grace:up grace:down', 'Nothing to move yet');
  press('grace');
  assert.equal(body(), '{d}c D E F | G4 |]');
  assert.equal(status(), 'Grace note added.');
  assert.equal(group('grace'), 'grace');
  assert.equal(selected(), '{d}c', 'The note stays selected');
  clean();
  press('grace:up');
  assert.equal(body(), '{e}c D E F | G4 |]', 'Grace ↑ moves only the grace note');
  press('grace:down');
  press('grace:down');
  assert.equal(body(), '{c}c D E F | G4 |]');
  key('ArrowUp');
  assert.equal(body(), '{c}d D E F | G4 |]', '↑ still moves the note, not its grace note');
  key('ArrowDown');
  press('grace:slash');
  assert.equal(body(), '{/c}c D E F | G4 |]');
  assert.equal(group('grace'), 'grace grace:slash');
  press('grace:slash');
  assert.equal(body(), '{c}c D E F | G4 |]', 'Slashed again takes the slash off');
  press('grace');
  assert.equal(body(), 'c D E F | G4 |]', 'A lit Grace removes it');
  assert.equal(status(), 'Grace note removed.');
  run('stepHistory(-1)');
  assert.equal(body(), '{c}c D E F | G4 |]', 'Each press is one undo step');
  // The note menu offers the same, with Remove grace once the note has one; a triplet keeps the grace note first.
  pick(1);
  run('openNoteMenu(selectedNote().entry, selectedNote().display, 10, 10)');
  assert.equal(
    run(
      "[...$('note-menu').querySelectorAll('[data-edit^=tuplet],[data-edit^=grace]')].map(b=>b.dataset.edit).join(' ')"
    ),
    'tuplet:2 tuplet:3 tuplet:5 tuplet:6 tuplet:7 grace grace:slash'
  );
  run("$('note-menu').querySelector('[data-edit=\"grace:slash\"]').click()");
  assert.equal(body(), '{c}c {/E}D E F | G4 |]');
  assert.equal(status(), 'Slashed grace note added.');
  pick(1);
  run('openNoteMenu(selectedNote().entry, selectedNote().display, 10, 10)');
  run("$('note-menu').querySelector('[data-edit=\"tuplet:3\"]').click()");
  assert.equal(body(), '{c}c {/E}(3D/2 z/2 z/2 E F | G4 |]', 'The grace note goes before the triplet');
  clean();
  pick(1);
  run('openNoteMenu(selectedNote().entry, selectedNote().display, 10, 10)');
  assert.equal(
    run("$('note-menu').querySelector('[data-edit=\"tuplet:3\"]').getAttribute('aria-checked')"),
    'true',
    'The note menu shows the triplet'
  );
  run("$('note-menu').querySelector('[data-edit=\"grace:remove\"]').click()");
  assert.equal(body(), '{c}c (3D/2 z/2 z/2 E F | G4 |]');
  pick(2);
  assert.equal(disabled('grace'), 'grace grace:slash grace:up grace:down', 'Rests take no grace note');
  press('grace');
  assert.equal(status(), 'Grace notes go before notes, not rests.');
  // Written pitch: on a B♭ clarinet letters fill the triplet in written pitch and the source stays concert.
  run(
    `dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |]')},instrument:'Clarinet in B♭'})`
  );
  pick(0);
  key('T');
  key('e');
  key('f');
  assert.equal(body(), '(3C/2D/2E/2 D E F |]', 'Written E and F are concert D and E');
  // A note at the end of a source line keeps its line continuation (\) after the tuplet's last member, through
  // making, filling and taking off the tuplet, so the music stays on one line.
  open('C D E F \\\n| G A B c|]');
  pick(3);
  key('T');
  assert.equal(body(), 'C D E (3F/2 z/2 z/2 \\\n| G A B c|]', 'The continuation goes after the last rest');
  clean();
  assert.equal(run('renderedTune.lines.length'), 1, 'One line of music');
  key('g');
  key('a');
  assert.equal(body(), 'C D E (3F/2G/2A/2 \\\n| G A B c|]', 'Letters fill the rests before it');
  clean();
  run('stepHistory(-1);stepHistory(-1)');
  pick(5);
  key('T');
  assert.equal(body(), 'C D E F \\\n| G A B c|]', 'Taking the tuplet off keeps it');
  // Delete in a tuplet keeps its count: a note becomes a rest, a rest takes off a tuplet of rests, and a rest
  // between notes stays. abcjs would otherwise pull the next note into the tuplet.
  const starts = () =>
    run(
      "parseMidi(midiBytes($('abc').value.replace('K:C','Q:1/4=60\\nK:C'))).notes.map(n=>+n.start.toFixed(3)).join(' ')"
    );
  open('C D E F|]');
  pick(0);
  key('T');
  key('Delete');
  assert.equal(body(), 'C D E F|]', 'Delete on a rest of an empty triplet takes it off');
  assert.equal(status(), 'Triplet removed.');
  run('stepHistory(-1)');
  pick(0);
  key('Delete');
  assert.equal(body(), '(3z/2 z/2 z/2 D E F|]', 'Delete on a note in a triplet makes it a rest');
  assert.equal(status(), 'Changed to a rest, so the triplet stays whole.');
  assert.equal(selected(), '(3z/2', 'The rest stays selected for a letter');
  assert.equal(starts(), '1 2 3', 'D is not pulled into the triplet');
  clean();
  key('Backspace');
  assert.equal(body(), 'z D E F|]', 'Backspace on the rests takes the triplet off');
  run('stepHistory(-1);stepHistory(-1)');
  pick(1);
  key('d');
  pick(2);
  key('Delete');
  assert.equal(body(), '(3C/2D/2 z/2 D E F|]', 'A rest between notes stays');
  assert.equal(status(), 'This rest is part of a triplet. Type a letter to fill it.');
  pick(1);
  press('delete');
  assert.equal(body(), '(3C/2z/2 z/2 D E F|]', 'The toolbar Delete does the same');
  assert.equal(status(), 'Changed to a rest, so the triplet stays whole.');
  assert.equal(starts(), '0 1 2 3');
  clean();
  run('stepHistory(-1)');
  pick(1);
  run('openNoteMenu(selectedNote().entry, selectedNote().display, 10, 10)');
  run("$('note-menu').querySelector('[data-edit=\"delete\"]').click()");
  assert.equal(body(), '(3C/2z/2 z/2 D E F|]', 'So does the note menu');
  run('stepHistory(-1)');
  run('stepHistory(-1)');
  assert.equal(body(), '(3C/2 z/2 z/2 D E F|]', 'Each Delete is one undo step');
  // A length key on a tuplet rest sets the length for notes after the tuplet; letters still fill its rests.
  pick(1);
  key('5');
  assert.equal(
    status(),
    'New notes after the triplet will be quarter notes. Letters fill its rests at their own length.'
  );
  // Staccato on a triplet's first note: abcjs starts that note at the dot of (3.C, and the selection follows it, so
  // a second press takes the dot off again.
  pick(0);
  key(';');
  assert.equal(body(), '(3.C/2 z/2 z/2 D E F|]');
  assert.equal(selected(), '.C/2', 'The note is still selected');
  assert.equal(key(';'), true);
  assert.equal(body(), '(3C/2 z/2 z/2 D E F|]', 'A second press takes the staccato off');
  assert.equal(selected(), '(3C/2', 'and the whole note is selected again');
  press('deco:tenuto');
  press('deco:tenuto');
  assert.equal(body(), '(3C/2 z/2 z/2 D E F|]', 'Tenuto on and off from the toolbar');
  open('(C D) E F|]');
  pick(0);
  key(';');
  key(';');
  assert.equal(body(), '(C D) E F|]', 'Slur-start notes too');
  // Hand-written uneven members can add up to a length no single note has; the tuplet then stays as it is.
  run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nK:G\n(3c2zz G2 A4|]')},instrument:'Flute'})`);
  pick(0);
  key('T');
  assert.equal(body(), '(3c2zz G2 A4|]');
  assert.equal(status(), 'This triplet does not add up to a single note, so the editor cannot change it.');
  assert.equal(run("$('warnings').textContent"), '');
}
// Measure tools: the Measure panel inserts and deletes bars, sets bar lines, repeats, endings, form marks and rehearsal
// marks, and changes the time signature, key and clef from the selected measure, one undo step each.
{
  const abc = 'X:1\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC D E F | G A B c | d e f g | c4 |]',
    tune = 'C D E F | G A B c | d e f g | c4 |]';
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Flute'})`);
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    pickBar = i =>
      run(
        `scoreClick(displayOf([...new Set(noteSources.values())].filter(e=>e.element.el_type==='bar')` +
          `.sort((a,b)=>a.element.startChar-b.element.startChar)[${i}]),0,[],{},null)`
      ),
    press = action => run(`document.querySelector('[data-palette=${JSON.stringify(action)}]').click()`),
    shown = sel =>
      run(`[...document.querySelectorAll('#palette-measure [${sel}]')].map(b=>b.dataset.palette).join(' ')`),
    pressed = () => shown('aria-pressed="true"'),
    disabled = () => shown('aria-disabled="true"'),
    selected = () => run("$('abc').value.slice(...selectedRange)").trim(),
    status = () => run("$('selection-status').textContent"),
    choose = (what, value) =>
      run(
        `$('measure-${what}').value=${JSON.stringify(value)};$('measure-${what}').dispatchEvent(new Event('change'))`
      ),
    undo = () => run('stepHistory(-1)');
  assert.equal(run("$('palette-measure').hidden"), true, 'The Measure panel starts closed');
  pick(0);
  assert.equal(disabled(), '', 'Its buttons are left alone while it is closed');
  press('measure');
  assert.equal(run("$('palette-measure').hidden"), false);
  assert.equal(run(`document.querySelector('[data-palette="measure"]').getAttribute('aria-expanded')`), 'true');
  assert.equal(pressed(), 'barline:|', 'Measure 1 ends with a single bar line');
  run("scoreKey({key:'Escape'})");
  assert.ok(disabled().startsWith('bar:before bar:after bar:delete barline:|'), 'Nothing selected: nothing to act on');
  assert.equal(run("$('measure-meter').disabled && $('measure-key').disabled && $('measure-clef').disabled"), true);
  press('bar:before');
  assert.equal(status(), 'Select a note or bar line on the score first.');
  assert.equal(body(), tune);
  // Insert a bar before measure 3: a whole-bar rest, selected so that typing writes over it. Delete removes measure 3.
  pick(8);
  assert.equal(
    run("$('measure-meter').value + ' ' + $('measure-key').value + ' ' + $('measure-clef').value"),
    '4/4 C treble'
  );
  press('bar:before');
  assert.equal(body(), 'C D E F | G A B c | z4 | d e f g | c4 |]');
  assert.equal(selected(), 'z4');
  assert.equal(status(), 'Added a bar before measure 3. Type a letter to write over its rest.');
  run("scoreKey({key:'e'})");
  assert.equal(body(), 'C D E F | G A B c | e z3 | d e f g | c4 |]');
  undo();
  undo();
  assert.equal(body(), tune, 'Inserting is one undo step');
  pick(8);
  press('bar:after');
  assert.equal(body(), 'C D E F | G A B c | d e f g | z4 | c4 |]');
  undo();
  pick(8);
  press('bar:delete');
  assert.equal(body(), 'C D E F | G A B c | c4 |]');
  assert.equal(status(), 'Deleted measure 3.');
  assert.equal(selected(), 'c4', 'The next measure is selected');
  undo();
  assert.equal(body(), tune, 'Deleting is one undo step');
  // Bar lines replace each other; a selected bar line is restyled itself.
  pick(4);
  press('barline:||');
  assert.equal(body(), 'C D E F | G A B c || d e f g | c4 |]');
  assert.equal(pressed(), 'barline:||');
  assert.equal(status(), 'Double bar line after measure 2.');
  press('barline:|]');
  assert.equal(body(), 'C D E F | G A B c |] d e f g | c4 |]');
  undo();
  undo();
  pickBar(0);
  assert.equal(selected(), '|');
  press('repeat:end');
  press('repeat:start');
  assert.equal(body(), 'C D E F :: G A B c | d e f g | c4 |]', 'Both repeats on the selected bar line');
  assert.equal(selected(), '::', 'The bar line stays selected');
  assert.equal(pressed(), 'repeat:start repeat:end');
  undo();
  undo();
  // Repeats and 1st and 2nd endings engrave and play: measure 4 starts after measures 1 to 3 and 1 and 2 again.
  pick(0);
  press('repeat:start');
  pick(8);
  press('repeat:end');
  press('ending:1');
  assert.equal(status(), '1st ending from measure 3. It runs to the next repeat, double or final bar line.');
  pick(12);
  press('ending:2');
  assert.equal(body(), '|: C D E F | G A B c |1 d e f g :|2 c4 |]');
  assert.equal(pressed(), 'barline:|] ending:2');
  assert.equal(run("$('warnings').textContent"), '');
  assert.equal(run('measureStarts.get(3)'), 4.8);
  assert.equal(run('measureStarts.get(4)'), 12, 'The 2nd ending plays after the repeat');
  press('ending:2');
  assert.equal(body(), '|: C D E F | G A B c |1 d e f g :| c4 |]', 'Pressed again, the ending goes');
  for (let i = 0; i < 5; i++) undo();
  assert.equal(body(), tune);
  // Form marks and rehearsal letters.
  pick(12);
  press('form:D.C.alfine');
  assert.equal(body(), 'C D E F | G A B c | d e f g | !D.C.alfine!c4 |]');
  assert.match(status(), /^D\.C\. al Fine at the end of measure 4\. Playback does not follow/);
  pick(4);
  press('form:fine');
  press('form:segno');
  assert.equal(body(), 'C D E F | !segno!G A B !fine!c | d e f g | !D.C.alfine!c4 |]');
  assert.equal(pressed(), 'barline:| form:segno form:fine');
  press('rehearsal:mark');
  pick(12);
  press('rehearsal:mark');
  assert.equal(body(), 'C D E F | [P:A] !segno!G A B !fine!c | d e f g | [P:B] !D.C.alfine!c4 |]');
  assert.equal(status(), 'Rehearsal mark B at measure 4.');
  for (let i = 0; i < 5; i++) undo();
  assert.equal(body(), tune);
  // A meter change at measure 3 writes [M:3/4]; the bar check counts 3/4 from there.
  pick(8);
  choose('meter', '3/4');
  assert.equal(body(), 'C D E F | G A B c | [M:3/4] d e f g | c4 |]');
  assert.equal(status(), 'Time signature 3/4 from measure 3.');
  assert.deepEqual(json('barProblems(ABCJS.parseOnly($("abc").value)[0]).map(m=>m.measure)'), [3, 4]);
  assert.equal(run("$('measure-meter').value"), '3/4');
  undo();
  assert.equal(body(), tune, 'One undo step');
  // A key change asks whether the notes move, as the Key menu does.
  pick(8);
  choose('key', 'G');
  assert.equal(run("$('measure-key-choice').hidden"), false);
  assert.equal(run("$('measure-key-choice-text').textContent"), 'Change the key to G major (1♯) from measure 3:');
  run("$('measure-key-keep').click()");
  assert.equal(body(), 'C D E F | G A B c | [K:G] d e f g | c4 |]');
  assert.equal(status(), 'Key: G major (1♯) from measure 3. The notes stay where they are.');
  assert.equal(run("$('measure-key').value"), 'G');
  undo();
  pick(8);
  choose('key', 'G');
  run("$('measure-key-transpose').click()");
  assert.equal(body(), 'C D E F | G A B c | [K:G] A B c d | G4 |]');
  assert.equal(status(), 'Key: G major (1♯) from measure 3. The notes moved down a perfect 4th.');
  undo();
  pick(8);
  choose('key', 'D');
  run("$('measure-key-cancel').click()");
  assert.equal(body(), tune, 'Cancel changes nothing');
  assert.equal(run("$('measure-key').value"), 'C', 'and the menu shows the key again');
  // Clef from measure 3, and back.
  pick(8);
  choose('clef', 'bass');
  assert.equal(body(), 'C D E F | G A B c | [K:clef=bass] d e f g | c4 |]');
  assert.equal(status(), 'Bass clef from measure 3.');
  choose('clef', 'treble');
  assert.equal(body(), tune, 'The clef before needs no field');
  undo();
  undo();
  // On a piano score both staves get the bar and the repeat, in one undo step.
  const piano =
    'X:1\nM:3/4\nL:1/4\nK:C\n%%score {RH | LH}\nV:RH\nC D E | F G A |]\nV:LH clef=bass\nC, D, E, | F, G, A, |]';
  run(`openScore({abc:${JSON.stringify(piano)},instrument:'Piano'})`);
  pick(3);
  press('bar:before');
  assert.equal(
    run("$('abc').value").split('\nV:RH\n')[1],
    'C D E | z3 | F G A |]\nV:LH clef=bass\nC, D, E, | z3 | F, G, A, |]'
  );
  assert.equal(status(), 'Added a bar before measure 2 on every staff. Type a letter to write over its rest.');
  undo();
  assert.equal(run("$('abc').value"), piano);
  // Piano music that switches voices with inline [V:] fields and declares its clefs in the header keeps its bass clef
  // through a key change.
  const inline =
    'X:1\nM:4/4\nL:1/4\n%%score {RH LH}\nV:RH clef=treble\nV:LH clef=bass\nK:C\n' +
    '[V:RH] C D E F | G A B c | d e f g | c4 |]\n[V:LH] C,, D,, E,, F,, | G,, A,, B,, C, | D, E, F, G, | C,4 |]';
  run(`openScore({abc:${JSON.stringify(inline)},instrument:'Piano'})`);
  run("selectEntry(scoreNotes().find(e=>$('abc').value.slice(e.element.startChar,e.element.endChar).trim()==='d'))");
  choose('key', 'D');
  run("$('measure-key-keep').click()");
  assert.equal(status(), 'Key: D major (2♯) from measure 3. The notes stay where they are.');
  assert.equal(
    run("render(),ABCJS.parseOnly(renderedWritten)[0].lines.map(l=>l.staff.map(s=>s.clef.type).join()).join(' ')"),
    'treble,bass'
  );
  // A transposing instrument: the clef shown is the written one, keys are concert pitch.
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Cello'})`);
  pick(8);
  assert.equal(run("$('measure-clef').value"), 'bass');
  // The clef menu acts on the clef shown: the cello shows this treble-clef source in the bass clef.
  choose('clef', 'bass');
  assert.equal(body(), tune);
  assert.equal(status(), 'No change.');
  choose('clef', 'treble');
  assert.equal(body(), 'C D E F | G A B c | [K:clef=treble] d e f g | c4 |]');
  assert.equal(status(), 'Treble clef from measure 3.');
  assert.equal(run("$('measure-clef').value"), 'treble');
  choose('clef', 'bass');
  assert.equal(body(), tune, 'Back to the clef shown before');
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Trombone'})`);
  pick(8);
  choose('clef', 'treble');
  assert.equal(body(), 'C D E F | G A B c | [K:clef=treble] d e f g | c4 |]');
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Clarinet in B♭'})`);
  pick(8);
  choose('key', 'F');
  run("$('measure-key-keep').click()");
  assert.equal(body(), 'C D E F | G A B c | [K:F] d e f g | c4 |]');
  assert.match(status(), /Keys are concert pitch\.$/);
  press('measure');
  assert.equal(run("$('palette-measure').hidden"), true);
}
// The shortcut sheet runs tuplet and Measure panel commands too. The Measure panel's commands open it, and its Time, Key
// and Clef menus take the keyboard; with nothing selected they say so and leave it closed. This comes after the
// Measure tools' checks, which expect a panel that has never been opened.
{
  const status = () => run("$('selection-status').textContent"),
    body = () => run("$('abc').value.trim().split('\\n').pop()"),
    active = () => run('document.activeElement?.id');
  run(
    `dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |]')},instrument:'Flute'})`
  );
  run('selectEntry(scoreNotes()[1])');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Triplet'))");
  assert.equal(body(), 'C (3D/2 z/2 z/2 E F | G A B c |]', 'Triplet from the sheet');
  assert.equal(status(), 'Triplet: type letters to fill its rests.');
  run('stepHistory(-1);selectEntry(scoreNotes()[1])');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Double bar line'))");
  assert.equal(body(), 'C D E F || G A B c |]', 'A Measure command from the sheet');
  assert.equal(status(), 'Double bar line after measure 1.');
  assert.equal(run("$('palette-measure').hidden"), false, 'opens the Measure panel');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Key from here'))");
  assert.equal(active(), 'measure-key', 'The Key menu takes the keyboard');
  run("document.querySelector('[data-palette=measure]').click();stepHistory(-1);scoreKey({key:'Escape'})");
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Double bar line'))");
  assert.equal(body(), 'C D E F | G A B c |]');
  assert.equal(status(), 'Select a note or bar line on the score first.');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Clef from here'))");
  assert.equal(status(), 'Select a note or bar line on the score first.');
  assert.deepEqual([run("$('palette-measure').hidden"), active()], [true, 'notation']);
}
// Chord symbols: K, the toolbar's Chord button and the note menu open the box; Enter saves, Tab moves on, Escape
// cancels, empty removes; written pitch on transposing instruments; the Chords switch silences the accompaniment.
async function checkChordSymbols() {
  const body = () => run("$('abc').value.trim().split('\\n').pop()"),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    key = (k, o = {}) => run(`scoreKey(${JSON.stringify({key: k, ...o})})`),
    status = () => run("$('selection-status').textContent"),
    box = () => run("$('chord-entry').hidden ? null : $('chord-input').value"),
    type = (text, k = 'Enter', shiftKey = false) =>
      run(
        `$('chord-input').value=${JSON.stringify(text)};$('chord-input').dispatchEvent(new Event('input'));` +
          `$('chord-input').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:${shiftKey},bubbles:true}))`
      ),
    music = '"^Verse"C "F"D E z | G4 |]';
  run(`dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n' + music)},instrument:'Flute'})`);
  run('selectedRange=null;selectionAnchor=null');
  key('k');
  assert.equal(box(), null, 'K needs a selected note');
  assert.equal(status(), 'Select a note on the score first.');
  pick(0);
  key('k');
  assert.equal(box(), '', 'K opens an empty box on a note without a symbol');
  assert.equal(run('document.activeElement.id'), 'chord-input', 'The box takes the keyboard');
  assert.equal(run("$('chord-hint').textContent"), 'Enter saves · Tab next note · Esc cancels');
  type('Bb7');
  assert.equal(body(), '"Bb7""^Verse"C "F"D E z | G4 |]', 'Enter writes the symbol before the note');
  assert.equal(box(), null, 'and closes the box');
  assert.equal(run('document.activeElement.id'), 'notation', 'The keyboard goes back to the score');
  assert.equal(status(), 'Chord symbol Bb7.');
  assert.equal(run("$('abc').value.slice(...selectedRange)"), '"Bb7""^Verse"C ', 'The note stays selected');
  run('stepHistory(-1)');
  assert.equal(body(), music, 'One undo step');
  run('stepHistory(1)');
  pick(0);
  key('K');
  assert.equal(box(), 'Bb7', 'The box shows the symbol the note has');
  type('C', 'Tab');
  assert.equal(body(), '"C""^Verse"C "F"D E z | G4 |]', 'Editing replaces the symbol; the annotation stays');
  assert.equal(box(), 'F', 'Tab moves on to the next note');
  assert.equal(run("$('abc').value.slice(...selectedRange)"), '"F"D ');
  assert.equal(status(), 'Chord symbol C.');
  run("$('chord-input').value='';$('chord-input').dispatchEvent(new Event('input'))");
  assert.equal(run("$('chord-hint').textContent"), 'Empty removes the chord symbol.');
  type('', 'Tab');
  assert.equal(body(), '"C""^Verse"C D E z | G4 |]', 'An empty box removes the symbol');
  assert.equal(status(), 'Chord symbol removed.');
  type('', 'Tab');
  assert.equal(body(), '"C""^Verse"C D E z | G4 |]', 'Tab past a note without a symbol changes nothing');
  run("$('chord-input').value='hello';$('chord-input').dispatchEvent(new Event('input'))");
  assert.equal(run("$('chord-hint').textContent"), 'Not a chord name: it will print but not play.');
  type('n.c.', 'Tab', true);
  assert.equal(body(), '"C""^Verse"C D E "N.C."z | G4 |]', 'Shift+Tab saves and moves back; n.c. is N.C.');
  assert.equal(box(), '', 'The box is on the note before');
  run("$('chord-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(box(), null, 'Escape closes the box');
  assert.equal(body(), '"C""^Verse"C D E "N.C."z | G4 |]', 'and saves nothing');
  pick(3);
  key('k');
  assert.equal(box(), 'N.C.', 'A rest can carry a symbol');
  type('hello');
  assert.equal(body(), '"C""^Verse"C D E "hello"z | G4 |]', 'Text that is not a chord is still written');
  assert.match(status(), /prints but does not play/);
  pick(4);
  key('k');
  type('d7', 'Tab');
  assert.equal(body(), '"C""^Verse"C D E "hello"z | "D7"G4 |]', 'A lower-case root is capitalized');
  assert.equal(box(), null, 'Tab on the last note closes the box');
  assert.equal(status(), 'Chord symbol D7. That was the last note.');
  // The toolbar button and the note menu open the same box; the button names the symbol the note has.
  pick(4);
  const button = '[data-palette="chord"]';
  assert.equal(run(`document.querySelector('${button}').getAttribute('aria-label')`), 'Chord symbol (D7)');
  assert.equal(run(`document.querySelector('${button}').classList.contains('in-use')`), true);
  run(`document.querySelector('${button}').click()`);
  assert.equal(box(), 'D7', 'The Chord button opens the box');
  type('G7');
  assert.match(body(), /"G7"G4 \|\]$/);
  pick(1);
  assert.equal(run(`document.querySelector('${button}').getAttribute('aria-label')`), 'Chord symbol');
  assert.equal(run(`document.querySelector('${button}').getAttribute('aria-disabled')`), 'false');
  run('(e=>openNoteMenu(e,displayOf(e),0,0))(scoreNotes()[0])');
  assert.equal(run(`document.querySelector('#note-menu [data-edit="chord"]').textContent`), 'Chord symbol: C…');
  run(`document.querySelector('#note-menu [data-edit="chord"]').click()`);
  assert.equal(box(), 'C', 'The note menu opens the box on its note');
  type('Am');
  assert.match(body(), /^"Am""\^Verse"C D/);
  // On a range selection the box opens on the first note.
  run('selectNotesBetween(scoreNotes()[1],scoreNotes()[2])');
  key('k');
  assert.equal(box(), '', 'A range selection opens the box on its first note');
  type('F');
  assert.match(body(), /"\^Verse"C "F"D E/);
  // Clicking away saves the box.
  pick(2);
  key('k');
  run("$('chord-input').value='E7';$('chord-input').dispatchEvent(new FocusEvent('blur',{relatedTarget:$('abc')}))");
  assert.match(body(), /"F"D "E7"E/, 'Leaving the box saves it');
  // On a B-flat clarinet the box shows and takes written pitch; the source stays concert.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F\n"F"C "Bb"D "C7"E F |]')},instrument:'Clarinet in B♭'})`
  );
  const shown = () => run(`[...document.querySelectorAll('#notation .abcjs-chord')].map(e=>e.textContent).join(' ')`);
  assert.equal(shown(), 'G C D7', 'Symbols are drawn in written pitch');
  pick(1);
  key('k');
  assert.equal(box(), 'C', 'The box shows the written symbol');
  type('F7', 'Tab');
  assert.equal(body(), '"F"C "Eb7"D "C7"E F |]', 'Written F7 is concert Eb7 in the source');
  assert.equal(box(), 'D7');
  type('Db/F');
  assert.equal(body(), '"F"C "Eb7"D "Cb/Eb"E F |]', 'Root and bass both move by the interval');
  assert.equal(shown(), 'G F7 D♭/F');
  // In Concert pitch view the box shows and takes concert pitch, as the score does.
  run("$('concert-pitch').checked=true;$('concert-pitch').onchange()");
  assert.equal(shown(), 'F E♭7 C♭/E♭', 'Concert pitch view draws the source symbols');
  pick(1);
  key('k');
  assert.equal(box(), 'Eb7', 'The box shows the concert symbol');
  type('Ab7');
  assert.equal(body(), '"F"C "Ab7"D "Cb/Eb"E F |]', 'A symbol typed in concert pitch is stored as typed');
  run("$('concert-pitch').checked=false;$('concert-pitch').onchange()");
  assert.equal(shown(), 'G B♭7 D♭/F', 'and shown in written pitch with the view off');
  // Words are typed, stored and shown as they are; every chord name moves, including ones abcjs plays only as a triad.
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nC D E F|G4|]')},instrument:'Clarinet in B♭'})`);
  pick(0);
  key('k');
  type('Coda', 'Tab');
  type('(End)', 'Tab');
  type('Fine', 'Tab');
  type('Cm(maj7)', 'Tab');
  assert.equal(status(), 'Chord symbol Cm(maj7).');
  type('C7alt');
  assert.equal(body(), '"Coda"C "(End)"D "Fine"E "Bbm(maj7)"F|"Bb7alt"G4|]', 'Concert pitch in the source');
  assert.equal(shown(), 'Coda (End) Fine Cm(maj7) C7alt', 'Written pitch on the score');
  pick(0);
  key('k');
  assert.equal(box(), 'Coda', 'The box shows the word as typed');
  run("$('chord-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  // Chords: on by default; off leaves the accompaniment out of playback but not out of MIDI export; remembered and
  // backed up; switching it during playback carries on playing.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n"C"C D E F | "G7"G A B c |]')},instrument:'Flute'})`
  );
  run("$('metronome').checked=false;$('count-in').checked=false");
  assert.equal(run("$('chords').checked"), true, 'Chords is on by default');
  oscillators.length = 0;
  await run('play()');
  const withChords = oscillators.length;
  run('stop()');
  run("$('chords').checked=false;$('chords').dispatchEvent(new Event('change'))");
  assert.equal(w.localStorage.getItem('fretfree-practice-chords'), 'false', 'The setting is remembered');
  assert.ok(run('BACKUP_SETTING_KEYS()').includes('fretfree-practice-chords'), 'and backed up');
  oscillators.length = 0;
  await run('play()');
  assert.equal(oscillators.length, 8, 'Without chords only the eight melody notes play');
  assert.ok(withChords > 8, 'With chords the accompaniment plays too');
  run("$('chords').checked=true;$('chords').dispatchEvent(new Event('change'))");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(run('playing'), true, 'Switching Chords keeps playing');
  run('stop()');
  let exported = null;
  run('var keepDownload=download;download=d=>{window.__exported=d}');
  run("$('chords').checked=false;$('export-midi').onclick();download=keepDownload");
  exported = run('__exported');
  assert.equal(
    new Set(run('parseMidi')(exported).notes.map(n => n.ch)).size,
    2,
    'MIDI export keeps the chords with Chords off'
  );
  w.localStorage.setItem('fretfree-practice-chords', 'true');
  run('applyStoredSettings()');
  assert.equal(run("$('chords').checked"), true, 'Restored settings apply Chords');
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
// Record yourself: plain messages without a microphone, the count-in and one pass of the range while recording, the
// take listed with its length, playing it alone and lined up with the score, downloads with credits, and deleting.
async function checkRecording() {
  // Waits for what the asynchronous recording and storage code leads to, rather than for a fixed time.
  const until = async (check, what) => {
    for (let i = 0; i < 600 && !check(); i++) await new Promise(r => w.setTimeout(r, 5));
    assert.ok(check(), 'Timed out waiting for ' + what);
  };
  const takeCount = () => run("$('take-list').querySelectorAll('li').length"),
    memoryTake = (id, key) =>
      run(
        `memoryTakes.set(${JSON.stringify(id)},{id:${JSON.stringify(id)},scoreKey:${JSON.stringify(key)},n:1,at:1,duration:3,mime:'audio/webm',blob:new Blob(['x'])})`
      );
  run(
    `openScore({title:'Take test',abc:${JSON.stringify('X:1\nT:Take test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G4 |]')}})`
  );
  run("$('metronome').checked=false;$('count-in').checked=false;$('loop').checked=true");
  run("$('record').click()");
  assert.equal(run("$('record-panel').hidden"), false, '● Record opens the panel');
  assert.equal(run("$('record').getAttribute('aria-expanded')"), 'true');
  assert.equal(run('document.activeElement.id'), 'record-start', 'Focus goes to Start recording');
  assert.match(run("$('takes-empty').textContent"), /^No takes/);
  assert.match(run("$('record-storage').textContent"), /can’t keep takes after the tab closes/, 'No IndexedDB here');
  await run('startRecording()');
  assert.match(run("$('record-status').textContent"), /^This browser can’t use a microphone here/);
  let mic = () => Promise.reject(Object.assign(new Error('denied'), {name: 'NotAllowedError'})),
    constraints = null;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    configurable: true,
    value: {getUserMedia: c => ((constraints = c), mic())}
  });
  await run('startRecording()');
  assert.match(run("$('record-status').textContent"), /^This browser can’t record audio/, 'No MediaRecorder');
  const recorders = [];
  class FakeRecorder {
    static isTypeSupported(type) {
      return type === 'audio/webm;codecs=opus';
    }
    constructor(stream, options) {
      Object.assign(this, {stream, mimeType: options?.mimeType || '', state: 'inactive', listeners: {}});
      recorders.push(this);
    }
    addEventListener(type, f) {
      (this.listeners[type] ||= []).push(f);
    }
    emit(type, e = {}) {
      for (const f of this.listeners[type] || []) f(e);
    }
    start() {
      this.state = 'recording';
      w.setTimeout(() => this.emit('start'), 0);
    }
    stop() {
      this.state = 'inactive';
      this.emit('dataavailable', {data: new w.Blob(['take bytes'], {type: this.mimeType})});
      this.emit('stop');
    }
  }
  w.MediaRecorder = FakeRecorder;
  await run('startRecording()');
  assert.match(run("$('record-status').textContent"), /^Microphone access is blocked/, 'Denied permission');
  assert.deepEqual(
    JSON.parse(JSON.stringify(constraints)),
    {audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}},
    'The microphone is asked for without call processing'
  );
  mic = () => Promise.reject(Object.assign(new Error('none'), {name: 'NotFoundError'}));
  await run('startRecording()');
  assert.match(run("$('record-status').textContent"), /^No microphone was found/);
  assert.equal(run('rec'), null);
  // The microphone answers after a render (which stops playback); that must not end the recording before it starts.
  const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      getSettings: () => ({latency: 0.01})
    },
    stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  let allow;
  mic = () => new Promise(r => (allow = () => r(stream)));
  run("$('record-count-in').value='2';$('record-count-in').dispatchEvent(new Event('change'))");
  assert.equal(w.localStorage.getItem('fretfree-record-count-in'), '2', 'The count-in choice is remembered');
  oscillators.length = 0;
  const started = run('startRecording()');
  assert.equal(run("$('record-start').textContent"), '■ Stop recording');
  run('render()');
  allow();
  await started;
  assert.equal(run('rec.state'), 'live', 'Recording once the score plays');
  assert.equal(recorders.at(-1).mimeType, 'audio/webm;codecs=opus');
  const clicks = oscillators.filter(o => o.type === 'square'),
    notes = oscillators.filter(o => o.type !== 'square');
  assert.equal(clicks.length, 8, 'Two bars of count-in, though Count-in and Metronome are off');
  assert.equal(clicks.filter((c, i) => i % 4 === 0).length, 2);
  assert.equal(notes.length, 5, 'The range plays once');
  assert.ok(Math.abs(notes[0].startAt - clicks[0].startAt - 4) < 1e-9, 'The first note follows two bars at 120');
  assert.equal(run("$('play-status').textContent"), 'Count-in: 2 bars to go…');
  assert.ok(Math.abs(run('rec.lead') - (run('playClock') - run('rec.startAudio'))) < 1e-9);
  assert.ok(Math.abs(run('rec.lead') - 4.07) < 1e-9, 'The lead is the count-in and start-up');
  assert.equal(run("$('record').textContent"), '● Recording');
  // Playback ends (here, ■ Stop): the recorder runs on for a short tail, then the take is kept.
  run('audio.currentTime=16.2;stop()');
  assert.equal(recorders.at(-1).state, 'recording', 'A short tail for the last note');
  assert.equal(run("$('record-status').textContent"), 'Saving the take…');
  assert.equal(run("$('record-start').textContent"), '● Saving…', 'Stop recording is no longer offered');
  assert.equal(run("$('record-start').getAttribute('aria-disabled')"), 'true');
  // Pressing it again during the tail (a double press, or a press just after the range ends) keeps the take.
  run("$('record-start').click();$('record-start').click()");
  assert.equal(run('rec.state'), 'stopping', 'A press while saving does nothing');
  assert.equal(recorders.at(-1).state, 'recording');
  await until(() => takeCount() === 1, 'the take to be listed');
  assert.equal(recorders.at(-1).state, 'inactive');
  assert.ok(track.stopped, 'The microphone is released');
  assert.equal(
    run("$('record-status').textContent"),
    'Take 1 saved (0:07). This browser can’t keep it after the tab closes, so download it to keep it.'
  );
  assert.equal(run("$('record-start').textContent"), '● Start recording');
  assert.equal(run("$('record-start').hasAttribute('aria-disabled')"), false);
  assert.match(run("$('take-list').textContent"), /Take 1 0:07/);
  assert.equal(run("$('takes-empty').hidden"), true);
  const take = JSON.parse(run('JSON.stringify({...shownTakes[0], blob: undefined})'));
  assert.equal(take.scoreKey, run('recordKey()'));
  assert.equal(take.latencyMs, 10, 'Before calibration, the browser’s own latency estimate');
  assert.deepEqual([take.from, take.speed, take.mime, take.calibrated], [0, 100, 'audio/webm;codecs=opus', false]);
  // Playing the take, alone and with the score.
  const sources = [];
  w.AudioContext.prototype.createBufferSource = () => {
    const source = {
      connect(to) {
        this.to = to;
      },
      start(when, offset) {
        Object.assign(this, {when, offset});
      },
      stop() {
        this.stopped = true;
      }
    };
    sources.push(source);
    return source;
  };
  w.AudioContext.prototype.decodeAudioData = (bytes, ok) => ok({duration: 7});
  run("$('take-list').querySelector('[data-take-play]').click()");
  await until(() => sources.length === 1, 'the take to play');
  assert.equal(sources[0].to, run('outputNode()'), 'Takes play through the master bus');
  assert.deepEqual([sources[0].when, sources[0].offset], [16.25, 0], 'Alone, from the start');
  assert.equal(run("$('take-list').querySelector('[data-take-play]').textContent"), '■ Stop');
  assert.equal(run("$('take-list').querySelector('[data-take-play]').getAttribute('aria-label')"), 'Stop take 1');
  run("$('take-list').querySelector('[data-take-play]').click()");
  assert.ok(sources[0].stopped, 'Pressed again, it stops');
  assert.equal(run("$('take-list').querySelector('[data-take-play]').textContent"), '▶ Play');
  run("$('speed').value=50");
  oscillators.length = 0;
  run("$('take-list').querySelector('[data-take-score]').click()");
  await until(() => sources.length === 2, 'the take to play with the score');
  assert.ok(
    Math.abs(sources[1].when - run('playClock')) < 1e-9 && Math.abs(sources[1].offset - 4.08) < 1e-9,
    'With the score, the take starts where the score’s first note was recorded'
  );
  assert.equal(run('playSpeed'), 1, 'at the speed it was recorded at');
  assert.equal(oscillators.filter(o => o.type === 'square').length, 0, 'with no count-in');
  run('stop()');
  assert.ok(sources[1].stopped, 'Stopping the score stops the take');
  run("$('speed').value=100");
  // Calibrating afterwards lines up takes recorded before it.
  w.localStorage.setItem('fretfree-latency', JSON.stringify({ms: 150, at: 1}));
  run("$('take-list').querySelector('[data-take-score]').click()");
  await until(() => sources.length === 3, 'the take to play with the score again');
  assert.ok(Math.abs(sources[2].offset - 4.22) < 1e-9, 'An uncalibrated take uses the calibration made since');
  run('stop()');
  // Downloads: the audio, and for a library edition its credits.
  w.__downloads = [];
  run('download = (data, name, type) => __downloads.push({data, name, type})');
  run("$('take-list').querySelector('[data-take-download]').click()");
  assert.deepEqual(
    w.__downloads.map(d => d.name),
    ['Take test take 1.webm'],
    'A personal score has no credits file'
  );
  run(`openScore(catalog.find(x => x.rights && x.licenseURL))`);
  const library = run('current');
  await until(() => run("$('take-list').hidden"), 'the library score’s takes');
  assert.equal(run('recordKey()'), 'library:' + library.id, 'A library score’s takes go by its id');
  run("$('record-panel').hidden=true");
  w.__downloads = [];
  run(`shownTakes=[{id:'t9',n:4,title:${JSON.stringify(library.title)},at:0,mime:'audio/mp4',blob:new Blob(['x'])}]`);
  run("downloadTake('t9')");
  assert.deepEqual(
    w.__downloads.map(d => d.name),
    [`${run('takeFileName(current.title,4,"m4a")')}`, `${run('takeFileName(current.title,4,"txt"," credits")')}`]
  );
  assert.ok(w.__downloads[1].data.includes(library.licenseURL), 'The credits carry the licence');
  assert.ok(w.__downloads[1].data.includes(run('scoreLicense(current)')));
  assert.equal(w.__downloads[1].data, run('takeCredits(shownTakes[0], current)'));
  // The same text opened again is another score, with no takes. The first one's take can no longer be reached, so the
  // panel offers to delete it; a draft that kept the first score's key brings the take back.
  run(
    `openScore({title:'Take test',abc:${JSON.stringify('X:1\nT:Take test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G4 |]')}})`
  );
  await until(() => run("$('take-list').hidden") && !run("$('takes-stray').hidden"), 'the take to be out of reach');
  assert.notEqual(run('recordKey()'), take.scoreKey, 'Each opened score that is not saved has takes of its own');
  assert.equal(
    run("$('takes-stray-text').textContent"),
    '1 take here belongs to a score that was deleted or never saved.'
  );
  run(`takesRestored(${JSON.stringify(take.scoreKey)})`);
  await until(() => takeCount() === 1, 'the take to come back with its score');
  assert.equal(run("$('takes-stray').hidden"), true, 'The open score’s takes are not out of reach');
  run("$('record').click()");
  w.confirm = () => false;
  run("$('take-list').querySelector('[data-take-delete]').click()");
  await new Promise(r => w.setTimeout(r, 20));
  assert.equal(takeCount(), 1, 'Cancel keeps the take');
  w.confirm = () => true;
  run("$('take-list').querySelector('[data-take-delete]').click()");
  await until(() => takeCount() === 0, 'the take to be deleted');
  assert.equal(run("$('record-status').textContent"), 'Take 1 deleted.');
  assert.equal(run('document.activeElement.id'), 'record-start');
  // Two blank sheets from the same template do not share takes.
  run('dirty=false;newScore(2)');
  const firstSheet = run('recordKey()');
  assert.match(firstSheet, /^new:/);
  memoryTake('b1', firstSheet);
  run('updateTakes(true)');
  await until(() => takeCount() === 1, 'the blank sheet’s take');
  run('dirty=false;newScore(2)');
  assert.notEqual(run('recordKey()'), firstSheet, 'A second blank sheet has its own takes');
  await until(() => run("$('take-list').hidden"), 'the second sheet’s empty list');
  run("memoryTakes.delete('b1')");
  // Unsaved work recovered from its draft gets its takes back, and the first save carries them over.
  run("selectEntry(scoreNotes()[0]);scoreKey({key:'c'});clearTimeout(renderTimer);render()");
  assert.equal(run('dirty'), true);
  const drafted = run('recordKey()');
  memoryTake('d1', drafted);
  run('writeDraft()');
  const draft = JSON.parse(w.localStorage.getItem('fretfree-draft')).find(d => d.tab === run('draftTab'));
  assert.equal(draft.takes, drafted, 'The draft keeps the takes’ key');
  // A later visit: another score is open, and the draft from the earlier tab is restored.
  run(`dirty=false;openScore({title:'Other',abc:${JSON.stringify('X:1\nT:Other\nM:4/4\nL:1/4\nK:C\nC4 |]')}})`);
  run(`storage.set(KEYS.draft, [${JSON.stringify({...draft, tab: 'earlier'})}])`);
  run('loadDrafts();restoreDraft()');
  assert.equal(run('recordKey()'), drafted, 'Restored work has its takes’ key back');
  await until(() => takeCount() === 1, 'the restored work’s take');
  run("$('save').onclick()");
  await until(
    () =>
      run("memoryTakes.get('d1')?.scoreKey.startsWith('saved:') && $('take-list').querySelectorAll('li').length === 1"),
    'the saved score’s take'
  );
  const scoreId = run('savedId');
  assert.equal(run("memoryTakes.get('d1').scoreKey"), 'saved:' + scoreId, 'Saving keeps the takes');
  // A library edition's draft keeps the library key.
  run("dirty=false;openScore(catalog.find(x=>x.id==='ode'));selectEntry(scoreNotes()[0]);scoreKey({key:'c'})");
  run('clearTimeout(renderTimer);render();writeDraft()');
  const libraryDraft = JSON.parse(w.localStorage.getItem('fretfree-draft')).find(d => d.tab === run('draftTab'));
  assert.equal(libraryDraft.takes, 'library:ode');
  run(`dirty=false;openScore({title:'Other',abc:${JSON.stringify('X:1\nT:Other\nM:4/4\nL:1/4\nK:C\nC4 |]')}})`);
  run(`storage.set(KEYS.draft, [${JSON.stringify({...libraryDraft, tab: 'earlier'})}])`);
  run('loadDrafts();restoreDraft()');
  assert.equal(run('recordKey()'), 'library:ode', 'A restored library edition keeps its takes');
  run('dirty=false;storage.remove(KEYS.draft);updateTakes(true)');
  // Deleting a saved score deletes its takes, and says so first.
  await until(() => run(`takeCount('saved:${scoreId}')`) === 1, 'the take index');
  run("show('saved')");
  let asked = '';
  w.confirm = message => ((asked = message), true);
  run(`$('saved-cards').querySelector('[data-delete="${scoreId}"]').click()`);
  assert.equal(asked, 'Delete this locally saved score and its take?');
  await until(() => !run("memoryTakes.has('d1')"), 'the deleted score’s take to go');
  run("show('studio');newScore(2)");
  // Takes no score can reach (a deleted score's, closed unsaved work's) can be deleted from the panel. Library takes, the
  // open score's, and takes of work kept in a draft or open in another tab stay.
  w.confirm = () => true;
  memoryTake('s1', 'saved:gone');
  memoryTake('s2', 'new:closed');
  memoryTake('s3', 'library:ode');
  memoryTake('s4', 'new:drafted');
  memoryTake('s5', run('recordKey()'));
  run("storage.set(KEYS.draft, [{abc:'X:1\\nK:C\\nC|]',tab:'other',at:1,takes:'new:drafted'}])");
  // Unsaved work open in another tab, with no draft, holds a Web Lock for its takes, and this tab holds one for its own.
  const locks = [];
  Object.defineProperty(w.navigator, 'locks', {
    configurable: true,
    value: {
      request(name, options, callback) {
        const lock = `${name} (${options.mode})`;
        locks.push(lock);
        return Promise.resolve(callback()).then(() => locks.splice(locks.indexOf(lock), 1));
      },
      query: async () => ({held: locks.map(lock => ({name: lock.replace(/ \(\w+\)$/, '')})), pending: []})
    }
  });
  locks.push('fretfree-takes new:elsewhere (shared)');
  memoryTake('s6', 'new:elsewhere');
  run('updateTakes(true)');
  await until(() => run("$('takes-stray-text').textContent").startsWith('2 takes'), 'the stray takes');
  const ownLock = `fretfree-takes ${run('recordKey()')} (shared)`;
  assert.ok(locks.includes(ownLock), 'A tab with unsaved takes holds a lock for them');
  assert.equal(
    run("$('takes-stray-text').textContent"),
    '2 takes here belong to scores that were deleted or never saved.'
  );
  w.confirm = message => ((asked = message), false);
  run("$('takes-stray-delete').click()");
  await new Promise(r => w.setTimeout(r, 20));
  assert.equal(run('memoryTakes.size'), 6, 'Cancel keeps them');
  assert.equal(asked, 'Delete the 2 takes of scores that were deleted or never saved? They can’t be brought back.');
  w.confirm = () => true;
  run("$('takes-stray-delete').click()");
  await until(() => run("$('takes-stray').hidden"), 'the stray takes to go');
  assert.equal(run('[...memoryTakes.keys()].join()'), 's3,s4,s5,s6', 'Takes open in another tab stay');
  assert.equal(run("$('record-status').textContent"), '2 takes deleted.');
  assert.equal(run('document.activeElement.id'), 'record-start');
  run('memoryTakes.clear();storage.remove(KEYS.draft);updateTakes(true)');
  await until(() => !locks.includes(ownLock), 'the lock to go with the takes');
  delete w.navigator.locks;
  // Starting, then stopping before the microphone answers, records nothing and lets the microphone go.
  track.stopped = false;
  mic = () => new Promise(r => (allow = () => r(stream)));
  const cancelled = run('startRecording()');
  run("$('record-start').click()");
  allow();
  await cancelled;
  assert.ok(track.stopped, 'The microphone is released');
  assert.equal(run('rec'), null);
  assert.equal(run("$('record-status').textContent"), 'No take was recorded.');
  assert.equal(run('memoryTakes.size'), 0);
  // Stopping in the count-in (a false start) keeps no take. The count-in is 2 bars at 120, so the score starts at 14.07.
  mic = () => Promise.resolve(stream);
  const takeAbc = JSON.stringify('X:1\nT:Take test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G4 |]');
  run(`dirty=false;openScore({title:'Take test',abc:${takeAbc}})`);
  run('audio.currentTime=10');
  track.stopped = false;
  await run('startRecording()');
  assert.equal(run('rec.state'), 'live');
  run("audio.currentTime=13.9;$('record-start').click()");
  assert.equal(run('rec'), null);
  assert.equal(recorders.at(-1).state, 'inactive');
  assert.ok(track.stopped, 'The microphone is released');
  assert.equal(run("$('record-status').textContent"), 'Stopped in the count-in, so no take was recorded.');
  await new Promise(r => w.setTimeout(r, 20));
  assert.equal(run('memoryTakes.size'), 0, 'A false start is not a take');
  // Saving unsaved work while it records, while its take is saved (the tail), or while the take is stored, keeps the
  // take with the saved score, and leaves nothing out of reach.
  for (const when of ['recording', 'the tail', 'storing']) {
    run(`dirty=false;openScore({title:'Take test',abc:${takeAbc}})`);
    const unsaved = run('recordKey()');
    run('audio.currentTime=10');
    await run('startRecording()');
    run('audio.currentTime=15');
    if (when === 'recording') run("$('save').onclick()");
    else {
      run('stop()');
      assert.equal(run('rec.state'), 'stopping');
      if (when === 'the tail') run("$('save').onclick()");
      else {
        // The take's number is being worked out when the score is saved.
        run(
          'window.__list=listTakes;listTakes=async key=>{listTakes=__list;await new Promise(r=>(window.__go=r));return __list(key)};closeRecorder(rec)'
        );
        await until(() => run("typeof __go === 'function'"), 'the take to be stored');
        assert.equal(run('rec'), null);
        run("$('save').onclick();__go();delete window.__go");
      }
    }
    await until(() => takeCount() === 1, `the take saved in ${when}`);
    assert.equal(run('shownTakes[0].scoreKey'), 'saved:' + run('savedId'), `Saved in ${when}, the take is the score’s`);
    assert.equal(await run(`listTakes(${JSON.stringify(unsaved)}).then(takes => takes.length)`), 0);
    await run('indexTakes()');
    assert.equal((await run('strayTakeKeys()')).length, 0, `Saved in ${when}, no take is out of reach`);
    run('saved=saved.filter(x=>x.id!==savedId);storeScores(saved);memoryTakes.clear()');
  }
  // Saving one's own copy of a library edition takes along the takes recorded since it was opened. Takes recorded on
  // the edition before (a teacher's model take on a shared computer) stay with it.
  memoryTake('model', 'library:ode');
  run("dirty=false;openScore(catalog.find(x=>x.id==='ode'))");
  await until(() => takeCount() === 1, 'the edition’s take');
  run('audio.currentTime=10');
  await run('startRecording()');
  run('audio.currentTime=30;stop()');
  await until(() => takeCount() === 2, 'the take recorded on the edition');
  run("selectEntry(scoreNotes()[0]);scoreKey({key:'c'});$('save').onclick()");
  await until(() => run("shownKey.startsWith('saved:')") && takeCount() === 1, 'the saved copy’s take');
  const copy = run('savedId');
  assert.equal(run('shownTakes[0].n'), 2, 'The take recorded on the copy goes with it');
  assert.equal(run("memoryTakes.get('model').scoreKey"), 'library:ode', 'The earlier take stays with the edition');
  run("dirty=false;openScore(catalog.find(x=>x.id==='ode'))");
  await until(() => run("shownTakes[0]?.id === 'model'") && takeCount() === 1, 'the edition’s take again');
  run(`saved=saved.filter(x=>x.id!==${JSON.stringify(copy)});storeScores(saved);memoryTakes.clear();updateTakes(true)`);
  run("$('record-close').click()");
  assert.equal(run("$('record-panel').hidden"), true);
  assert.equal(run('document.activeElement.id'), 'record');
  run("$('loop').checked=false");
  w.localStorage.removeItem('fretfree-latency');
  delete w.MediaRecorder;
  delete w.navigator.mediaDevices;
}
// Play-along check: plain messages without a microphone, one pass of the range after a one-bar count-in (with or
// without the melody), each note marked from what the microphone hears while the score plays on, the result in words,
// history per score that follows a save, marks redrawn on the same music and left off changed music, and never in an
// SVG export.
async function checkPlayAlong() {
  const until = async (check, what) => {
    for (let i = 0; i < 600 && !check(); i++) await new Promise(r => w.setTimeout(r, 5));
    assert.ok(check(), 'Timed out waiting for ' + what);
  };
  const tune = 'X:1\nT:Check test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G2 A2 |]';
  run(`dirty=false;openScore({title:'Check test',abc:${JSON.stringify(tune)}})`);
  run("$('metronome').checked=false;$('count-in').checked=false;$('loop').checked=true;$('speed').value=100");
  run("$('assess').click()");
  assert.deepEqual(
    [
      run("$('assess-panel').hidden"),
      run("$('assess').getAttribute('aria-expanded')"),
      run('document.activeElement.id')
    ],
    [false, 'true', 'assess-start'],
    '✓ Check opens the panel with focus on Start check'
  );
  assert.equal(run("$('assess-empty').hidden"), false);
  await run('startCheck()');
  assert.match(run("$('assess-status').textContent"), /^This browser can’t use a microphone here/);
  let mic = () => Promise.reject(Object.assign(new Error('denied'), {name: 'NotAllowedError'}));
  Object.defineProperty(w.navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: () => mic()}});
  await run('startCheck()');
  assert.match(run("$('assess-status').textContent"), /can’t listen to the microphone/, 'No analyser node');
  // The fake microphone sounds whatever tone() gives for the moment its samples were heard.
  let tone = () => 0;
  const proto = Object.getPrototypeOf(run('audio'));
  proto.createMediaStreamSource = () => ({connect() {}, disconnect() {}});
  proto.createAnalyser = function () {
    const ctx = this;
    return {
      fftSize: 2048,
      getFloatTimeDomainData(buffer) {
        const f = tone(ctx.currentTime - buffer.length / 2 / 48000);
        for (let i = 0; i < buffer.length; i++) buffer[i] = f ? 0.3 * Math.sin((2 * Math.PI * f * i) / 48000) : 0;
      }
    };
  };
  run('audio.sampleRate=48000');
  await run('startCheck()');
  assert.match(run("$('assess-status').textContent"), /^Microphone access is blocked/, 'Denied permission');
  assert.equal(run('check'), null);
  const track = {stop() {}, getSettings: () => ({})},
    stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  mic = async () => stream;
  w.localStorage.setItem('fretfree-latency', JSON.stringify({ms: 50, at: 1}));
  run("$('assess-level').value='medium';$('assess-level').dispatchEvent(new Event('change'))");
  assert.equal(w.localStorage.getItem('fretfree-check-level'), '"medium"', 'The level is remembered');
  oscillators.length = 0;
  run('audio.currentTime=10');
  const started = run('startCheck()');
  assert.equal(run("$('assess-start').textContent"), '■ Stop check');
  await started;
  assert.equal(run('check.state'), 'live', 'Listening once the score plays');
  run('clearInterval(check.timer)');
  const clicks = oscillators.filter(o => o.type === 'square'),
    notes = oscillators.filter(o => o.type !== 'square');
  assert.equal(clicks.length, 4, 'One bar of count-in');
  assert.equal(notes.length, 6, 'The range plays once, though Loop is on');
  assert.equal(run("$('assess').textContent"), '● Listening');
  assert.equal(run("$('assess-level').disabled"), true);
  const clock = run('check.clock'),
    expected = JSON.parse(run('JSON.stringify(check.expected)'));
  assert.deepEqual(
    expected.map(e => [e.time, e.end, e.midis.join()]),
    [
      [0, 0.5, '60'],
      [0.5, 1, '62'],
      [1, 1.5, '64'],
      [1.5, 2, '65'],
      [2, 3, '67'],
      [3, 4, '69']
    ]
  );
  // The student plays the E a semitone flat and comes in 120 ms late on the G, holding the F; the frames reach the
  // check 50 ms late (the stored latency).
  const hz = m => 440 * 2 ** ((m - 69) / 12);
  tone = at => {
    const t = at - clock - 0.05,
      e = expected.find(x => t >= x.time && t < x.end - 0.03);
    if (!e) return 0;
    if (e.midis[0] === 64) return hz(63);
    if (e.midis[0] === 67 && t < 2.12) return hz(65);
    return hz(e.midis[0]);
  };
  const frame = t => run(`audio.currentTime=${t};listen(check)`);
  let t = clock - 0.3;
  for (; t < clock + 2.6; t += 0.02) frame(t);
  const early = run("document.querySelectorAll('#notation .assess-mark').length");
  assert.ok(early >= 3 && early < 6, `Notes are marked as their time passes (${early})`);
  assert.equal(run('playing'), true, 'Marking does not stop playback');
  for (; t < clock + 4.3; t += 0.02) frame(t);
  run(`audio.currentTime=${clock + 4.12};stop()`);
  assert.equal(run("$('assess-start').textContent"), '● Marking…');
  assert.equal(run("$('assess-start').getAttribute('aria-disabled')"), 'true');
  await until(() => run('!check'), 'the check to be marked');
  assert.deepEqual(
    [run("$('assess-pitch').textContent"), run("$('assess-rhythm').textContent"), run("$('assess-stars').textContent")],
    ['83%', '83%', '★★★☆☆']
  );
  assert.equal(run("$('assess-stars').getAttribute('aria-label')"), '3 of 5 stars');
  assert.match(
    run("[...$('assess-problems').children].map(li => li.textContent).join(' | ')"),
    /^Measure 1, note 3: about a semitone flat \| Measure 2, note 1: 1[12]\d ms late$/,
    'The notes to work on, in words (120 ms late, to within a frame)'
  );
  assert.equal(run("$('assess-status').textContent"), 'Checked 6 notes: pitch 83%, rhythm 83%, 3 stars.');
  assert.equal(
    run("[...document.querySelectorAll('#notation .assess-mark')].map(m => m.getAttribute('class').slice(19)).join()"),
    'green,green,red,green,yellow,green',
    'Each note is marked green, yellow or red'
  );
  assert.equal(
    run("document.querySelectorAll('#notation .assess-mark')[2].textContent"),
    'Measure 1, note 3: about a semitone flat'
  );
  assert.equal(run("$('assess').textContent"), '✓ Check');
  const key = run('recordKey()'),
    history = JSON.parse(w.localStorage.getItem('fretfree-attempts'))[key];
  assert.deepEqual(
    history.map(c => [c.level, c.speed, c.from, c.to, c.pitch, c.rhythm, c.stars]),
    [['medium', 100, 1, 2, 83, 83, 3]],
    'The check is kept with the score'
  );
  assert.match(run("$('assess-history').textContent"), /Medium · 100% · measures 1–2 Pitch 83% · Rhythm 83% · ★★★☆☆/);
  // Marks stay out of SVG export, come back when the same music is drawn again, and are left off changed music.
  assert.doesNotMatch(run("creditedSVG($('notation'), $('abc').value, current)"), /assess-mark/);
  run('render()');
  assert.equal(run("document.querySelectorAll('#notation .assess-mark').length"), 6, 'Redrawn on the same music');
  run("$('abc').value=$('abc').value.replace('A2','B2');changed();clearTimeout(renderTimer);render()");
  assert.equal(run("document.querySelectorAll('#notation .assess-mark').length"), 0, 'Not on changed music');
  assert.equal(run("$('assess-result').hidden"), false, 'The result stays');
  run("$('assess-clear').click()");
  assert.equal(run("$('assess-result').hidden"), true);
  // On Easy, 120 ms late is on time. Without the melody, the chords and metronome play instead.
  run("$('abc').value=$('abc').value.replace('B2','A2');changed();clearTimeout(renderTimer);render()");
  run(
    "$('assess-level').value='easy';$('assess-melody').checked=false;$('assess-melody').dispatchEvent(new Event('change'))"
  );
  assert.equal(w.localStorage.getItem('fretfree-check-melody'), 'false');
  oscillators.length = 0;
  run('audio.currentTime=20');
  await run('startCheck()');
  run('clearInterval(check.timer)');
  assert.equal(oscillators.filter(o => o.type !== 'square').length, 0, 'The melody is left out');
  assert.equal(oscillators.filter(o => o.type === 'square').length, 4 + 8, 'The count-in, then the metronome');
  const clock2 = run('check.clock');
  tone = at => {
    const s = at - clock2 - 0.05,
      e = expected.find(x => s >= x.time && s < x.end - 0.03);
    return !e ? 0 : e.midis[0] === 67 && s < 2.12 ? hz(65) : hz(e.midis[0]);
  };
  for (let s = clock2 - 0.3; s < clock2 + 4.3; s += 0.02) frame(s);
  run(`audio.currentTime=${clock2 + 4.12};stop()`);
  await until(() => run('!check'), 'the second check');
  assert.deepEqual(
    [run("$('assess-pitch').textContent"), run("$('assess-rhythm').textContent")],
    ['100%', '100%'],
    'Easy allows 150 ms'
  );
  assert.equal(run("$('assess-problems').textContent"), 'Every note was right.');
  assert.equal(run("$('assess-history').children.length"), 2, 'Newest first');
  assert.match(run("$('assess-history').firstElementChild.textContent"), /Easy/);
  // A stop in the count-in checks nothing and keeps nothing; silence is not kept either.
  run('audio.currentTime=30');
  await run('startCheck()');
  run('clearInterval(check.timer);audio.currentTime=31;stop()');
  assert.equal(run("$('assess-status').textContent"), 'Stopped in the count-in, so nothing was checked.');
  assert.equal(run('check'), null);
  tone = () => 0;
  run('audio.currentTime=40');
  await run('startCheck()');
  run('clearInterval(check.timer)');
  const clock3 = run('check.clock');
  for (let s = clock3 - 0.3; s < clock3 + 1.3; s += 0.02) frame(s);
  run(`audio.currentTime=${clock3 + 1.25};stop()`);
  await until(() => run('!check'), 'the silent check');
  assert.match(run("$('assess-status').textContent"), /^FretFree heard nothing from the microphone/);
  assert.equal(JSON.parse(w.localStorage.getItem('fretfree-attempts'))[key].length, 2, 'Silence is not kept');
  // An edit while the last note is marked: the check is kept, and the changed music is left unmarked.
  tone = at => hz(60 + Math.floor((at - run('check.clock')) / 0.5));
  run('audio.currentTime=50');
  await run('startCheck()');
  run('clearInterval(check.timer)');
  const clock4 = run('check.clock');
  for (let s = clock4 - 0.3; s < clock4 + 1.3; s += 0.02) frame(s);
  run(`audio.currentTime=${clock4 + 1.25};stop()`);
  run("$('abc').value=$('abc').value.replace('F |','G |');changed();clearTimeout(renderTimer);render()");
  await until(() => run('!check'), 'the check cut short by an edit');
  assert.match(
    run("$('assess-status').textContent"),
    /^Checked 2 notes and kept the result\. The music on screen has changed/
  );
  assert.equal(run("document.querySelectorAll('#notation .assess-mark').length"), 0);
  assert.equal(JSON.parse(w.localStorage.getItem('fretfree-attempts'))[key].length, 3);
  run("$('abc').value=$('abc').value.replace('G |','F |');changed();clearTimeout(renderTimer);render()");
  // The history follows the score's first save, and goes when the saved score is deleted.
  run("$('save').onclick()");
  const savedKey = 'saved:' + run('savedId');
  assert.equal(run('recordKey()'), savedKey);
  assert.deepEqual(Object.keys(JSON.parse(w.localStorage.getItem('fretfree-attempts'))), [savedKey]);
  assert.equal(run("$('assess-history').children.length"), 3, 'Saved, it keeps its checks');
  run(`deleteChecksOf(${JSON.stringify(savedKey)});saved=saved.filter(x=>x.id!==savedId);storeScores(saved)`);
  assert.equal(w.localStorage.getItem('fretfree-attempts'), '{}');
  run("$('assess-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.deepEqual([run("$('assess-panel').hidden"), run('document.activeElement.id')], [true, 'assess']);
  run("$('loop').checked=false;$('assess-melody').checked=true;$('assess-level').value='medium'");
  for (const k of ['fretfree-latency', 'fretfree-attempts', 'fretfree-check-level', 'fretfree-check-melody'])
    w.localStorage.removeItem(k);
  delete proto.createAnalyser;
  delete proto.createMediaStreamSource;
  delete w.navigator.mediaDevices;
}
// WAV export: without OfflineAudioContext the panel says so. With a fake one, the file has the notes Play schedules, at
// the same times and speed, clicks only with Include metronome and the chords only with Include chords; the export
// never touches the live context and downloads <title>.wav. The summary follows Speed and the instrument. A bar shows
// progress, and closing the panel while the file is being made cuts the render off and drops it. A score too long for
// one file is refused with its length and a way out.
async function checkWavExport() {
  const abc = 'X:1\nT:Wav test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n"C"C D "G"E F | G4 |]',
    downloads = [],
    offline = [];
  run(`openScore({abc:${JSON.stringify(abc)},instrument:'Flute'})`);
  assert.equal(typeof w.OfflineAudioContext, 'undefined');
  run("$('export-wav').click()");
  assert.equal(run("$('wav-panel').hidden"), false);
  assert.equal(run("$('export-wav').getAttribute('aria-expanded')"), 'true');
  assert.equal(run("$('wav-make').disabled"), true, 'Nothing to press without offline audio');
  assert.match(run("$('wav-summary').textContent"), /can’t make audio files\. Export MIDI instead/);
  assert.equal(run('document.activeElement.id'), 'wav-close');
  run("$('wav-close').click()");
  assert.equal(run("$('wav-panel').hidden"), true);
  assert.equal(run("$('export-wav').getAttribute('aria-expanded')"), 'false');
  assert.equal(run('document.activeElement.id'), 'export-wav', 'Closing hands focus back to the WAV button');
  // With FakeOffline.hold a render waits for finish(). Its bus records being cut off, its oscillators each stop, and
  // reads counts the rendered channels read back for scaling.
  class FakeOffline extends FakeAudio {
    constructor(channels, length, rate) {
      super();
      this.currentTime = 0;
      this.args = [channels, length, rate];
      this.checkpoints = [];
      this.reads = this.resumed = 0;
      offline.push(this);
    }
    createGain() {
      const g = super.createGain();
      g.disconnect = () => (g.cut = true);
      return g;
    }
    createOscillator() {
      const o = super.createOscillator(),
        stop = o.stop;
      o.stop = function (t) {
        this.stops = (this.stops || 0) + 1;
        stop.call(this, t);
      };
      return o;
    }
    async resume() {
      this.resumed++;
    }
    startRendering() {
      const data = [new Float32Array(this.args[1]), new Float32Array(this.args[1])];
      data[0][100] = 0.25;
      data[1][200] = -0.5;
      const buffer = {numberOfChannels: 2, length: this.args[1], getChannelData: i => (this.reads++, data[i])};
      return FakeOffline.hold ? new Promise(done => (this.finish = () => done(buffer))) : Promise.resolve(buffer);
    }
  }
  w.OfflineAudioContext = FakeOffline;
  w.__wavDownloads = downloads;
  run('var keepDownload=download;download=(data,name,type)=>__wavDownloads.push({data,name,type})');
  run("$('speed').value='50';$('metronome').checked=true;$('count-in').checked=false;$('loop').checked=false");
  run("$('chords').checked=true");
  oscillators.length = 0;
  await run('play()');
  const live = oscillators.slice(),
    liveBus = run('outputNode()'),
    base = Math.min(...live.map(o => o.startAt)),
    sounds = list =>
      list
        .filter(o => o.type !== 'square')
        .map(o => `${o.frequency.value.toFixed(2)}@${o.startAt.toFixed(4)}`)
        .sort();
  run('stop()');
  run("$('export-wav').click()");
  assert.equal(run("$('wav-metronome').checked"), true, 'Include metronome starts from the Metronome switch');
  assert.equal(run("$('wav-chords-option').hidden"), false, 'Include chords shows for a score with chord symbols');
  assert.match(run("$('wav-summary').textContent"), /^The whole score in the Flute sound at 50% speed/);
  // Speed and the instrument changed with the panel open show in its summary at once.
  run("$('speed').value='75';$('speed').oninput()");
  assert.match(run("$('wav-summary').textContent"), /^The whole score in the Flute sound at 75% speed/);
  run("$('instrument').value='Cello';$('instrument').onchange()");
  assert.match(run("$('wav-summary').textContent"), /^The whole score in the Cello sound at 75% speed/);
  run("$('instrument').value='Flute';$('instrument').onchange();$('speed').value='50';$('speed').oninput()");
  run('dirty=false');
  assert.match(run("$('wav-summary').textContent"), /^The whole score in the Flute sound at 50% speed/);
  oscillators.length = 0;
  await run('makeWav()');
  const made = oscillators.slice();
  assert.deepEqual(
    sounds(made),
    sounds(live.map(o => ({...o, startAt: o.startAt - base}))),
    'The file has the notes Play schedules, at the same times and speed'
  );
  assert.ok(sounds(made).length > 5, 'with the chords');
  assert.equal(
    made.filter(o => o.type === 'square').length,
    live.filter(o => o.type === 'square').length,
    'and the same metronome clicks'
  );
  assert.ok(
    made.every(o => o.to.to !== liveBus && o.to.to.gain.value === 1),
    'The export has its own bus at full level'
  );
  const [ctx] = offline;
  assert.deepEqual([ctx.args[0], ctx.args[2]], [2, 44100], 'Stereo at 44.1 kHz');
  assert.equal(ctx.args[1], Math.ceil((4 / 0.5 + 1) * 44100), 'Two bars at 120 BPM and 50% speed, and a second more');
  assert.equal(downloads.length, 1);
  const file = downloads[0],
    bytes = Buffer.from(file.data),
    view = new DataView(file.data.buffer),
    data = bytes.indexOf('data') + 8;
  assert.deepEqual([file.name, file.type], ['Wav-test.wav', 'audio/wav']);
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.ok(bytes.includes('INAM\x09\0\0\0Wav test\0'), 'The title is in INFO');
  assert.equal(view.getInt16(data + 200 * 4 + 2, true), Math.round(-0.89 * 0x8000), 'Scaled to 1 dB under full');
  assert.equal(view.getInt16(data + 100 * 4, true), Math.round(0.445 * 0x7fff));
  assert.match(run("$('wav-status').textContent"), /^Downloaded Wav-test\.wav \(0:09, 1\.5 MB\)\.$/);
  assert.equal(run("$('wav-make').disabled"), false);
  // Without the metronome or the chords: only the five melody notes.
  run("$('wav-metronome').checked=false;$('wav-chords').checked=false");
  oscillators.length = 0;
  await run('makeWav()');
  assert.equal(oscillators.length, 5, 'Only the melody, no clicks');
  assert.equal(run("$('wav-progress').hidden"), true, 'No progress bar between files');
  // While the file is made, a browser that cannot suspend an offline render shows a busy bar with no value.
  FakeOffline.hold = true;
  let pending = run('makeWav()');
  assert.deepEqual(
    JSON.parse(
      run("JSON.stringify([$('wav-progress').hidden, $('wav-progress').hasAttribute('value'), $('wav-make').disabled])")
    ),
    [false, false, true],
    'A busy bar while the file is made'
  );
  assert.deepEqual(offline.at(-1).checkpoints, [], 'No checkpoints without suspend');
  offline.at(-1).finish();
  await pending;
  assert.equal(downloads.length, 3);
  assert.equal(run("$('wav-progress').hidden"), true, 'The bar goes when the file is made');
  // Where it can, a checkpoint every 5 seconds of audio fills the bar and resumes the render. Closing the panel cuts
  // the export's bus off and stops every note, so the rest renders as silence; nothing is scaled, encoded or saved.
  FakeOffline.prototype.suspend = function (t) {
    return new Promise(go => this.checkpoints.push({t, go}));
  };
  pending = run('makeWav()');
  const held = offline.at(-1);
  assert.deepEqual(
    held.checkpoints.map(c => c.t),
    [5],
    'One checkpoint in 9 seconds'
  );
  held.checkpoints[0].go();
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(run("$('wav-progress').value").toFixed(3), ((5 * 44100) / held.args[1]).toFixed(3));
  assert.equal(held.resumed, 1, 'The render goes on after a checkpoint');
  const bus = oscillators.at(-1).to.to;
  run("$('wav-close').click()");
  await pending;
  assert.equal(bus.cut, true, 'Closing cuts the export bus off');
  assert.ok(
    oscillators.slice(-5).every(o => o.stops === 2),
    'and stops every note'
  );
  held.finish();
  await new Promise(resolve => setTimeout(resolve));
  assert.deepEqual([held.reads, downloads.length], [0, 3], 'A file still being made when the panel closes is dropped');
  assert.equal(run("$('wav-progress').hidden"), true);
  run("$('export-wav').click()");
  assert.deepEqual(
    JSON.parse(run("JSON.stringify([$('wav-status').textContent, $('wav-make').disabled, $('wav-progress').hidden])")),
    ['', false, true],
    'Opened again, the panel is ready for a new file'
  );
  run("$('wav-close').click()");
  delete FakeOffline.prototype.suspend;
  FakeOffline.hold = false;
  // A score that would play for over 10 minutes is refused with its length; one without chords has no chords option.
  // The refusal suggests a faster speed only when the fastest one would fit, and always MIDI.
  run(`openScore({abc:${JSON.stringify('X:1\nT:Slow\nM:4/4\nL:1/4\nQ:1/4=5\nK:C\nC D E F | G4 | E4 | C4 |]')}})`);
  run("$('speed').value='25'");
  run("$('export-wav').click()");
  assert.equal(run("$('wav-chords-option').hidden"), true, 'No chords option without chord symbols');
  await run('makeWav()');
  assert.equal(
    run("$('wav-status').textContent"),
    'At this speed the score plays for 12:48, and an audio file can be up to 10 minutes. Choose a faster speed, or ' +
      'export MIDI instead.'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nT:Slower\nM:4/4\nL:1/4\nQ:1/4=5\nK:C\n' + 'C4|'.repeat(26) + ']')}})`);
  run("$('speed').value='100'");
  run("$('export-wav').click()");
  await run('makeWav()');
  assert.equal(
    run("$('wav-status').textContent"),
    'At this speed the score plays for 20:48, and an audio file can be up to 10 minutes. Export MIDI instead.'
  );
  assert.equal(downloads.length, 3);
  run(`openScore({abc:${JSON.stringify(abc)}})`);
  assert.equal(run("$('wav-panel').hidden"), true, 'Opening another score closes the panel');
  run("download=keepDownload;$('speed').value='100';$('metronome').checked=false");
  delete w.OfflineAudioContext;
}
// Instrument sounds: both menus list catalog.js's instruments, every instrument plays one non-square oscillator per
// note (FakeAudio has no periodic waves, so each falls back to its basic wave) in its octave, and the captions and
// embed labels give the written interval, including horn in F, tenor and baritone sax and octave transpositions.
async function checkInstrumentSounds() {
  const hz = midi => 440 * 2 ** ((midi - 69) / 12),
    all = run('instruments'),
    names = Object.keys(all),
    options = id => run(`[...$('${id}').options].map(o=>o.value).join('|')`);
  assert.equal(options('instrument'), names.join('|'), 'The instrument menu lists every instrument');
  assert.equal(options('instrument-filter'), ['all', ...names].join('|'), 'The library filter lists the same ones');
  assert.equal(
    run(`[...$('instrument-filter').querySelectorAll('optgroup')].map(g=>g.label).join('|')`),
    'Woodwinds|Brass|Strings|Guitars|Keyboard and percussion|Voice',
    'Grouped by family'
  );
  run(`$('instrument-filter').value='Horn in F';$('instrument-filter').dispatchEvent(new Event('input'))`);
  run(`stop();dirty=false;openScore(catalog.find(x=>x.id==='ode'))`);
  assert.equal(run("$('instrument').value"), 'Horn in F', 'A score opens in the filtered instrument');
  run(`$('instrument-filter').value='all';$('instrument-filter').dispatchEvent(new Event('input'))`);
  run("$('metronome').checked=false;$('count-in').checked=false");
  const abc = 'X:1\nM:4/4\nL:1/4\nQ:1/4=240\nK:F\nF G A B | c4 |]',
    open = name => run(`stop();dirty=false;openScore({abc:${JSON.stringify(abc)},instrument:${JSON.stringify(name)}})`);
  for (const name of names) {
    open(name);
    oscillators.length = 0;
    await run('play()');
    run('stop()');
    const octave = run(`instrumentSound(instruments[${JSON.stringify(name)}])`);
    assert.equal(oscillators.length, 5, name + ' plays one oscillator per note');
    assert.ok(
      oscillators.every(o => o.type === all[name].wave && o.type !== 'square'),
      name + ' falls back to its basic wave'
    );
    assert.deepEqual(
      oscillators.map(o => +o.frequency.value.toFixed(6)),
      [65, 67, 69, 70, 72].map(m => +hz(m + octave).toFixed(6)),
      name + ' plays the concert source in its octave'
    );
  }
  const caption = () => run("$('score-caption').textContent");
  // A caption calls the source or the view concert pitch only when playback sounds the pitches the MIDI export holds:
  // the baritone sax plays the source an octave lower, so its captions give that distance instead.
  for (const name of names.filter(n => all[n].shift % 12)) {
    open(name);
    const exported = run("parseMidi(midiBytes($('abc').value)).notes.map(n=>n.note).join()");
    oscillators.length = 0;
    await run('play()');
    run('stop()');
    const played = oscillators.map(o => Math.round(69 + 12 * Math.log2(o.frequency.value / 440))).join();
    for (const concert of [true, false]) {
      run(`$('concert-pitch').checked=${concert};$('concert-pitch').onchange()`);
      assert.equal(
        /are concert pitch|Concert pitch shown/.test(caption()),
        played === exported,
        `${name}${concert ? ' in Concert pitch view' : ''}: ${caption()}`
      );
    }
  }
  open('Horn in F');
  assert.match(run('writtenABC()'), /K:C[^\n]*\nc d e f \| g4 \|\]/, 'Horn in F is written a fifth higher');
  assert.equal(
    caption(),
    'Horn in F · treble clef · Written pitch shown; it sounds a perfect 5th lower. ABC source and MIDI are concert pitch.'
  );
  // Typing a written letter on a horn writes the concert note.
  run('selectEntry(scoreNotes()[0])');
  run(`scoreKey({key:'d'})`);
  assert.match(run("$('abc').value"), /K:F\nF G G A B/, 'Written D on a horn is concert G');
  open('Tenor sax in B♭');
  assert.match(run('writtenABC()'), /K:G[^\n]*\ng a b c' \| d'4 \|\]/, 'Tenor sax is written a ninth higher');
  assert.equal(
    caption(),
    'Tenor sax in B♭ · treble clef · Written pitch shown; it sounds a major 9th lower. ABC source and MIDI are concert pitch.'
  );
  assert.equal(run('transposing()'), 14, 'The score is drawn 14 semitones up');
  run('selectEntry(scoreNotes()[0])');
  run(`scoreKey({key:'a'})`);
  assert.match(run("$('abc').value"), /K:F\nF G G A B/, 'Written A on a tenor sax is concert G');
  run("$('concert-pitch').checked=true;$('concert-pitch').onchange()");
  assert.match(run('writtenABC()'), /K:F[^\n]*\nF G G A B/, 'Concert pitch view shows the source');
  open('Baritone sax in E♭');
  assert.equal(
    caption(),
    'Baritone sax in E♭ · treble clef · ABC source shown, an octave above how it sounds; turn off Concert pitch for the written part.'
  );
  run("$('concert-pitch').checked=false;$('concert-pitch').onchange()");
  assert.match(run('writtenABC()'), /K:D[^\n]*\nd e f g \| a4 \|\]/);
  assert.equal(
    caption(),
    'Baritone sax in E♭ · treble clef · Written pitch shown; it sounds an octave and a major 6th lower. ABC source and MIDI are an octave above how it sounds.'
  );
  oscillators.length = 0;
  run(`scoreClick(scoreEvents(renderedTune).find(e=>e.element.pitches).element,0,[],{},{step:0},{})`);
  assert.deepEqual(
    oscillators.map(o => +o.frequency.value.toFixed(6)),
    [+hz(53).toFixed(6)],
    'Baritone sax audition sounds an octave below the source'
  );
  // A prompt's written key on a tenor sax: G written is concert F, so the written score is back in G.
  run(`$('instrument').value='Tenor sax in B♭';$('instrument').onchange();dirty=false`);
  run(`startPrompt({id:'in-g',title:'In G',meter:'4/4',unit:'1/4',key:'G',tempo:90,bars:2,goals:[]})`);
  assert.match(run("$('abc').value"), /^K:F/m, 'The prompt source is in concert F');
  assert.match(run('writtenABC()'), /^K:G/m, 'The tenor sax sees the prompt in G');
  open('Double bass');
  assert.equal(
    caption(),
    'Double bass · bass clef · Melody lowered one octave for bass range. It sounds an octave lower than written.'
  );
  open('Glockenspiel');
  assert.equal(caption(), 'Glockenspiel · treble clef · Melody part. It sounds two octaves higher than written.');
  open('Viola');
  assert.equal(caption(), 'Viola · alto clef · Concert pitch melody part.');
  assert.match(run('writtenABC()'), /clef=alto/);
  open('Cello');
  assert.equal(caption(), 'Cello · bass clef · Melody lowered one octave for bass range.', 'Cello is unchanged');
  assert.deepEqual(
    ['Horn in F', 'Tenor sax in B♭', 'Baritone sax in E♭', 'Double bass', 'Glockenspiel', 'Cello', 'Viola'].map(name =>
      run(`embedPart(${JSON.stringify(name)})`)
    ),
    [
      'Horn in F part, in written pitch: it sounds a perfect 5th lower.',
      'Tenor sax in B♭ part, in written pitch: it sounds a major 9th lower.',
      'Baritone sax in E♭ part, in written pitch: it sounds an octave and a major 6th lower.',
      'Double bass part, in written pitch: it sounds an octave lower.',
      'Glockenspiel part, in written pitch: it sounds two octaves higher.',
      '',
      ''
    ]
  );
  run('stop();dirty=false');
}
// Lyrics: L, the toolbar's Lyrics button and the note menu open the box under a note; Space, -, _ and * write the
// verse as typed, Enter starts the next verse on the same notes, Backspace and Tab move, rests are skipped, each saved
// syllable is one undo step, and the words survive transposing, instruments, saving, share links and exports.
async function checkLyrics() {
  const abc = () => run("$('abc').value"),
    words = () =>
      abc()
        .split('\n')
        .filter(l => l.startsWith('w:')),
    pick = i => run(`selectEntry(scoreNotes()[${i}])`),
    key = k => run(`scoreKey(${JSON.stringify({key: k})})`),
    box = () => run("$('lyric-entry').hidden ? null : $('lyric-input').value"),
    status = () => run("$('selection-status').textContent"),
    selected = () => run("$('abc').value.slice(...selectedRange)"),
    // Each character as a keyboard types it: over the selected text, or after what is there.
    type = text => {
      for (const c of text)
        run(
          `(i=>{i.value=i.selectionStart===0&&i.selectionEnd===i.value.length?${JSON.stringify(c)}:i.value+${JSON.stringify(c)};` +
            `i.dispatchEvent(new Event('input'))})($('lyric-input'))`
        );
    },
    press = (k, shiftKey = false) =>
      run(
        `$('lyric-input').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:${shiftKey},bubbles:true,cancelable:true}))`
      ),
    twinkle = 'X:1\nT:Twinkle\nM:4/4\nL:1/4\nK:C\nCCGG|AAG2|\nFFEE|DDC2|]\n';
  run(`dirty=false;openScore({abc:${JSON.stringify(twinkle)},instrument:'Flute'})`);
  run('selectedRange=null;selectionAnchor=null');
  key('l');
  assert.equal(box(), null, 'L needs a selected note');
  assert.equal(status(), 'Select a note on the score first.');
  pick(0);
  key('l');
  assert.equal(box(), '', 'L opens an empty box on the note');
  assert.equal(run('document.activeElement.id'), 'lyric-input', 'The box takes the keyboard');
  assert.equal(run("$('lyric-verse').textContent"), 'Verse 1');
  assert.equal(run("$('lyric-input').getAttribute('aria-label')"), 'Lyrics, verse 1');
  type('Twin-kle twin-kle ');
  assert.deepEqual(words(), ['w: Twin-kle twin-kle'], 'Syllables go on four notes, written under their line');
  assert.equal(abc(), twinkle.replace('G|AAG2|\n', 'G|AAG2|\nw: Twin-kle twin-kle\n'));
  assert.equal(box(), '', 'The box moves on to the fifth note');
  assert.equal(selected(), 'A');
  assert.equal(run('document.activeElement.id'), 'lyric-input');
  // The words engrave under the notes.
  assert.deepEqual(
    JSON.parse(run("JSON.stringify([...document.querySelectorAll('#notation .abcjs-lyric')].map(t=>t.textContent))")),
    ['Twin-', 'kle', 'twin-', 'kle']
  );
  press('Enter');
  assert.equal(run("$('lyric-verse').textContent"), 'Verse 2', 'Enter starts the next verse');
  assert.equal(selected(), 'C', 'on the note where typing started');
  assert.equal(box(), '');
  type('Up a-bove the ');
  assert.deepEqual(words(), ['w: Twin-kle twin-kle', 'w: Up a-bove the'], 'The second verse goes on the same notes');
  assert.equal(
    run("JSON.stringify(ABCJS.parseOnly($('abc').value)[0].lines[0].staff[0].voices[0][2].lyric.map(l=>l.syllable))"),
    '["twin","bove"]',
    'Each note stacks its verses in order'
  );
  press('Escape');
  assert.equal(box(), null, 'Escape closes the box');
  assert.equal(run('document.activeElement.id'), 'notation', 'and the keyboard goes back to the score');
  run('stepHistory(-1)');
  assert.deepEqual(words(), ['w: Twin-kle twin-kle', 'w: Up a-bove'], 'Each saved syllable is one undo step');
  run('stepHistory(1)');
  // Editing one syllable changes only that syllable; Tab keeps its hyphen.
  pick(2);
  key('L');
  assert.equal(box(), 'twin', 'The box shows the syllable the note has, selected');
  type('TWIN');
  press('Tab');
  assert.deepEqual(words(), ['w: Twin-kle TWIN-kle', 'w: Up a-bove the']);
  assert.equal(selected(), 'G', 'Tab moves on');
  assert.equal(box(), 'kle');
  press('Tab', true);
  assert.equal(box(), 'TWIN', 'Shift+Tab moves back');
  press('Escape');
  // A second line of music has its own w: line; typing past the last note keeps the box open after it, where more
  // words go nowhere (letters never reach the score) and Enter starts the next verse.
  pick(11);
  key('l');
  type('won-der what ');
  assert.deepEqual(words(), ['w: Twin-kle TWIN-kle', 'w: Up a-bove the', 'w: * * * * won-der what']);
  assert.equal(
    abc(),
    'X:1\nT:Twinkle\nM:4/4\nL:1/4\nK:C\nCCGG|AAG2|\nw: Twin-kle TWIN-kle\nw: Up a-bove the\nFFEE|DDC2|]\nw: * * * * won-der what\n',
    'Notes before the first syllable of a line are skipped with *'
  );
  assert.equal(box(), '', 'Typing past the last note keeps the box open');
  assert.equal(status(), 'That was the last note. Enter starts verse 2.');
  assert.match(run("$('lyric-hint').textContent"), /^No more notes · Enter verse 2/);
  const ended = abc();
  type('and a b ');
  assert.equal(abc(), ended, 'Words past the last note change nothing');
  assert.equal(status(), 'No more notes for those words. Enter starts verse 2.');
  assert.equal(selected(), 'C2', 'The last note stays selected');
  press('Enter');
  assert.deepEqual([run("$('lyric-verse').textContent"), selected(), box()], ['Verse 2', 'D', ''], 'Enter goes on');
  press('Escape');
  assert.equal(abc(), ended);
  // Backspace in an empty box goes back a note; an empty box takes a syllable away.
  pick(13);
  key('l');
  run("$('lyric-input').value='';$('lyric-input').dispatchEvent(new Event('input'))");
  assert.match(run("$('lyric-hint').textContent"), /^Empty removes the syllable/);
  press('Backspace');
  assert.equal(box(), 'der', 'Backspace in an empty box goes back a note');
  assert.deepEqual(words().at(-1), 'w: * * * * won-der', 'and takes away the syllable it left');
  press('Escape');
  // * leaves a note out, _ holds a syllable over the next note, and a space after either only separates.
  run(`openScore({abc:${JSON.stringify('X:1\nM:3/4\nL:1/4\nK:G\nG z A B|c2 d|e2-e d|]\n')},instrument:'Flute'})`);
  pick(0);
  key('l');
  assert.equal(selected(), 'G ');
  type('Ah_ * men a* way');
  assert.equal(box(), 'way', 'A space after _ or * only separates');
  press('Escape');
  assert.deepEqual(words(), ['w: Ah___ men a * way'], 'Rests are passed over; * and _ take a note each');
  assert.deepEqual(
    run("JSON.stringify(voiceLyrics($('abc').value).map(x=>x&&x.syllable))"),
    JSON.stringify(['Ah', null, null, 'men', 'a', null, 'way', null]),
    'Ah on G, A held, B left out, men on c, a on d, the first e left out, way on the tied e'
  );
  // A selected rest starts the words at the next note.
  pick(1);
  assert.equal(selected(), 'z ');
  key('l');
  assert.equal(selected(), 'A ', 'L on a rest opens the box on the next note');
  assert.equal(box(), '');
  press('Escape');
  // - and _ in an empty box carry the syllable before through the note.
  run(`openScore({abc:${JSON.stringify('X:1\nL:1/4\nK:C\nC D E F|]\n')},instrument:'Flute'})`);
  pick(0);
  key('l');
  type('Ky-');
  type('-');
  type('ri ');
  assert.deepEqual(words(), ['w: Ky - ri'], 'A hyphen in an empty box carries the word on through the note');
  // The toolbar button and the note menu open the box too, and the button names the syllable.
  press('Escape');
  pick(0);
  assert.equal(run(`document.querySelector('[data-palette="lyric"]').getAttribute('aria-label')`), 'Lyrics (Ky)');
  assert.equal(run(`document.querySelector('[data-palette="lyric"]').classList.contains('in-use')`), true);
  pick(1);
  assert.equal(run(`document.querySelector('[data-palette="lyric"]').getAttribute('aria-label')`), 'Lyrics');
  run(`document.querySelector('[data-palette="lyric"]').click()`);
  assert.equal(box(), '', 'The Lyrics button opens the box');
  press('Escape');
  run("runShortcut(SHORTCUTS.find(s=>s.name==='Lyrics'))");
  assert.equal(box(), '', 'and so does Lyrics in the shortcut sheet');
  press('Escape');
  run('openNoteMenu(scoreNotes()[2], displayOf(scoreNotes()[2]), 10, 10)');
  assert.match(run(`$('note-menu').querySelector('[data-edit="lyric"]').textContent`), /^Lyrics: ri…$/);
  run(`$('note-menu').querySelector('[data-edit="lyric"]').click()`);
  assert.equal(box(), 'ri', 'The note menu opens the box');
  // Leaving the box saves it.
  type('RI');
  run("$('lyric-input').dispatchEvent(new FocusEvent('blur',{relatedTarget:$('abc')}))");
  assert.equal(box(), null);
  assert.deepEqual(words(), ['w: Ky - RI'], 'Leaving the box saves it');
  // Adding or taking away notes in a line with words under it says to check them; other edits do not.
  assert.equal(run("$('lyric-check').hidden"), true);
  pick(1);
  key('g');
  assert.equal(run("$('lyric-check').hidden"), false, 'A new note in a line with lyrics shows the check');
  run('stepHistory(-1)');
  pick(0);
  key('ArrowUp');
  assert.equal(run("$('lyric-check').hidden"), true, 'A pitch change hides it');
  // Lines with the same words are told apart by their order.
  run(
    `openScore({abc:${JSON.stringify('X:1\nL:1/4\nK:C\nC D E F|\nw: la la la la\nG A B c d|\nw: la la la la\n')},instrument:'Flute'})`
  );
  pick(1);
  key('g');
  assert.equal(run("$('lyric-check').hidden"), false, 'A new note under a refrain shows the check');
  // A syllable's own hyphen is shown as a look-alike, so it is not read as the hyphen key and stays in the syllable;
  // a backslash typed before a mark keeps it in the syllable too.
  run(`openScore({abc:${JSON.stringify('X:1\nL:1/4\nK:C\nC D E F|\nw: mid\\-day sun hot\n')},instrument:'Flute'})`);
  pick(0);
  key('l');
  assert.equal(box(), 'mid\u2010day');
  run("(i=>{i.value+='s';i.dispatchEvent(new Event('input'))})($('lyric-input'))");
  assert.deepEqual([box(), words()], ['mid\u2010days', ['w: mid\\-day sun hot']], 'Typing at its end keeps it whole');
  type(' ');
  assert.deepEqual([words(), box()], [['w: mid\\-days sun hot'], 'sun']);
  type('a\\-b ');
  assert.deepEqual(words(), ['w: mid\\-days a\\-b hot'], 'A backslash keeps a mark in the syllable');
  press('Escape');
  // A voice written after & shares the words of the staff's first voice, so it cannot have its own.
  run(`openScore({abc:${JSON.stringify('X:1\nL:1/4\nK:C\nC D E F & c d e f|]\n')},instrument:'Flute'})`);
  run("selectEntry(scoreNotes().find(e => voiceOf(e) === '0:1'))");
  key('l');
  assert.deepEqual(
    [box(), status()],
    [null, 'Lyrics go under the first voice of a staff, not a voice written after &.'],
    'L explains why a voice after & takes no words'
  );
  // The words survive transposing, another instrument, saving, share links and exports.
  run(
    `openScore({abc:${JSON.stringify(twinkle.replace('G|AAG2|\n', 'G|AAG2|\nw: Twin-kle twin-kle lit-tle star\n'))},instrument:'Flute'})`
  );
  const verse = 'w: Twin-kle twin-kle lit-tle star';
  run('toggleTranspose(true);applyTranspose()');
  assert.ok(words().includes(verse) && /^K:D$/m.test(abc()), 'Transposing keeps the words');
  run("$('instrument').value='Clarinet in B♭';$('instrument').onchange();clearTimeout(renderTimer);render()");
  assert.equal(
    run("[...document.querySelectorAll('#notation .abcjs-lyric')].map(t=>t.textContent).join(' ')"),
    'Twin- kle twin- kle lit- tle star',
    'A transposing instrument shows the words'
  );
  assert.ok(run('sharePayload().a').includes(verse), 'Share links carry the words');
  assert.ok(run("creditedABC($('abc').value, current)").includes(verse), 'ABC export keeps the words');
  assert.match(
    run("abcToMusicXML($('abc').value, {item: current})"),
    /<lyric number="1"><syllabic>begin<\/syllabic><text>Twin<\/text>/
  );
  assert.match(run("creditedSVG($('notation'), $('abc').value, current)"), /abcjs-lyric/, 'SVG export draws the words');
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
  // Swing feel: the Feel menu writes the score in one undo step, the tempo slider keeps "Swing", and playback starts
  // the second of two eighths at 2/3 of the beat; a straight score schedules exactly as before.
  const blues = 'X:1\nT:Blues\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nCDEF GABc | c2 (3cde f4 | G,8 |]',
    starts = async () => {
      oscillators.length = 0;
      await run('play()');
      const notes = oscillators.filter(o => o.type !== 'square'),
        t0 = notes[0].startAt,
        times = notes.map(o => +(o.startAt - t0).toFixed(4) + '+' + +(o.stopAt - o.startAt).toFixed(4)).join(' ');
      run('stop()');
      return times;
    };
  run(`openScore({abc:${JSON.stringify(blues)}});$('speed').value=100;setRange(1,3)`);
  assert.equal(run("$('feel').value"), '0', 'A score without swing reads as Straight');
  const straightTimes = await starts();
  assert.equal(
    straightTimes,
    '0+0.28 0.25+0.28 0.5+0.28 0.75+0.28 1+0.28 1.25+0.28 1.5+0.28 1.75+0.28 2+0.53 2.5+0.1967 2.6667+0.1967 2.8333+0.1967 3+1.03 4+2.03',
    'Straight playback as before'
  );
  run("$('feel').value='66';$('feel').dispatchEvent(new Event('input'));clearTimeout(renderTimer);render()");
  assert.match(run("$('abc').value"), /\nQ:"Swing" 1\/4=120\n%%MIDI swing 66\nK:C\n/, 'Feel writes the tempo text');
  assert.equal(run("$('warnings').textContent"), '', 'The swing score parses cleanly');
  assert.ok([...run("$('notation').innerHTML").matchAll(/Swing/g)].length > 0, 'The engraved tempo mark says Swing');
  const swungTimes = await starts();
  assert.equal(
    swungTimes,
    '0+0.36 0.33+0.2 0.5+0.36 0.83+0.2 1+0.36 1.33+0.2 1.5+0.36 1.83+0.2 2+0.53 2.5+0.1967 2.6667+0.1967 2.8333+0.1967 3+1.03 4+2.03',
    'At 66 and 120 BPM the off-beat eighth starts 1/3 of a beat late (at 2/3 of the beat); quarters, triplets and long notes stay'
  );
  oscillators.length = 0;
  await run('play(0.25)');
  assert.deepEqual(
    oscillators.map(o => o.frequency.value.toFixed(1)).slice(0, 2),
    ['293.7', '329.6'],
    'Playing from a swung off-beat D starts with the D, without a blip of the C that swing lengthened'
  );
  assert.equal(oscillators.length, 13);
  run('stop()');
  run('stepHistory(-1)');
  assert.equal(run("$('abc').value"), blues, 'Choosing a feel is one undo step');
  assert.equal(run("$('feel').value"), '0', 'Undo restores the Feel menu');
  run('stepHistory(1)');
  assert.equal(run("$('feel').value"), '66');
  run("$('bpm').value='90';$('bpm').dispatchEvent(new Event('input'));clearTimeout(renderTimer);render()");
  assert.match(run("$('abc').value"), /\nQ:"Swing" 1\/4=90\n/, 'The tempo slider keeps "Swing"');
  run("setHeader('Q','1/4=120')");
  assert.match(run("$('abc').value"), /\nQ:"Swing" 1\/4=120\n/, 'setHeader keeps the tempo text');
  run("$('feel').value='0';$('feel').dispatchEvent(new Event('input'))");
  assert.equal(run("$('abc').value"), blues, 'Straight removes the tempo text and the directive');
  run(`$('abc').value=$('abc').value.replace(/^Q:.*$/m,'Q:"Allegro" 1/4=132 "swing"');syncFields()`);
  assert.equal(run("$('bpm').value"), '132', 'The Tempo slider reads a beat with text after it');
  run("setHeader('Q','1/4=120')");
  assert.match(run("$('abc').value"), /\nQ:"Allegro" 1\/4=120 "swing"\n/, 'and keeps the text on both sides');
  // A pickup eighth is an off-beat, and swing in a meter that is not x/4 or x/2 plays straight with a note.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nQ:"Swing" 1/4=120\n%%MIDI swing 66\nK:C\nB,|CDEF GABc|]')}});setRange(1,2)`
  );
  assert.equal(run("$('feel').value"), '66', 'The Feel menu reads the score');
  assert.equal(
    (await starts()).split(' ').slice(0, 4).join(' '),
    '0+0.2 0.17+0.36 0.5+0.2 0.67+0.36',
    'The pickup eighth plays late, on the swung off-beat'
  );
  assert.equal(run("$('feel-note').hidden"), true);
  const compound = 'X:1\nM:6/8\nL:1/8\nQ:"Swing" 3/8=60\n%%MIDI swing 70\nK:C\nCDE FGA|]';
  run(`openScore({abc:${JSON.stringify(compound)}});setRange(1,1)`);
  assert.equal(run("$('feel').value"), '70', 'An amount typed into the ABC gets its own entry');
  assert.equal(run("$('feel-note').hidden"), false, 'A note says swing needs a meter such as 4/4');
  assert.equal(
    await starts(),
    '0+0.3633 0.3333+0.3633 0.6667+0.3633 1+0.3633 1.3333+0.3633 1.6667+0.3633',
    '6/8 plays straight'
  );
  // Swing at tempos whose note timings are not whole milliseconds, through a tempo change, without Q: and in 2/2.
  const eighths = 'CDEF GABc|CDEF GABc|]',
    feel = amount =>
      run(`$('feel').value='${amount}';$('feel').dispatchEvent(new Event('input'));clearTimeout(renderTimer);render()`);
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\n' + eighths)}});setRange(1,2)`);
  feel(66);
  assert.equal(
    (await starts()).split(' ').slice(6, 10).join(' '),
    '2+0.47 2.44+0.2567 2.6667+0.47 3.1067+0.2567',
    'At 90 BPM the off-beat eighth starts at 2/3 of the beat'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nCDEF GABc|[Q:1/4=110]' + eighths)}})`);
  run('setRange(1,3)');
  feel(66);
  assert.equal(
    (await starts()).split(' ').slice(8, 12).join(' '),
    '2+0.3902 2.3603+0.2156 2.5458+0.3902 2.9061+0.2156',
    'Swing follows an inline tempo change to 110 BPM'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nT:No tempo\nM:4/4\nL:1/8\nK:C\n' + eighths)}});setRange(1,2)`);
  const plain = await starts();
  feel(66);
  assert.match(run("$('abc').value"), /\nQ:"Swing" 1\/4=180\n/, 'A score without Q: gets the beat abcjs plays it at');
  assert.equal(run("$('bpm').value"), '180', 'The Tempo slider shows that beat');
  const swungPlain = await starts();
  assert.equal(
    swungPlain.split(' ').slice(0, 4).join(' '),
    '0+0.25 0.22+0.1433 0.3333+0.25 0.5533+0.1433',
    'A score without Q: swings at its own tempo'
  );
  const ends = times =>
    times.split(' ').map(t =>
      t
        .split('+')
        .reduce((a, b) => +a + +b)
        .toFixed(3)
    );
  assert.equal(ends(swungPlain).pop(), ends(plain).pop(), 'and ends where it did');
  feel(0);
  assert.equal(await starts(), plain, 'Back to Straight plays as before');
  run(`openScore({abc:${JSON.stringify('X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\n' + eighths)}});setRange(1,2)`);
  feel(66);
  const cut = (await starts()).split(' ').map(t => +t.split('+')[0]);
  assert.equal(run("$('feel-note').hidden"), true, '2/2 swings, with no note');
  assert.deepEqual(
    [cut[1] / cut[2], (cut[3] - cut[2]) / (cut[4] - cut[2]), (cut[15] - cut[14]) / (cut[2] - cut[0])].map(
      r => +r.toFixed(3)
    ),
    [0.66, 0.66, 0.66],
    'In 2/2 each quarter beat swings'
  );
  // A pickup played again at a repeat, and a new section's pickup, swing as off-beats.
  run(
    `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/8\nQ:"Swing" 1/4=120\n%%MIDI swing 66\nK:C\nB,|CDEF GABc|CDEF GAB:|\nB,|CDEF GABc|]')}})`
  );
  run('setRange(1,+$("start-measure").max)');
  oscillators.length = 0;
  await run('play()');
  assert.deepEqual(
    oscillators.filter(o => o.frequency.value < 250).map(o => +(o.startAt - oscillators[0].startAt).toFixed(3)),
    [0, 4, 8],
    "The pickup played again at the repeat and the second section's pickup swing like the first"
  );
  assert.equal(+(oscillators[1].startAt - oscillators[0].startAt).toFixed(3), 0.17, 'The pickup plays late');
  run('stop()');
  run(`openScore({abc:${JSON.stringify(pickup)}})`);
  assert.equal(
    run('clickTimes(0,1.3).map(c=>c.time.toFixed(1)+(c.down?"*":"")).join()'),
    '0.0,0.6*,1.2',
    'Pickup clicks align to the bar line'
  );
  run(`openScore({abc:${JSON.stringify('X:1\nM:6/8\nL:1/8\nK:C\nc3 d3|]')}})`);
  assert.equal(run('beatsPerBar()'), 2, '6/8 counts two dotted beats');
  // Cut time: the practice range, metronome and count-in keep time with the notes as heard. abcjs wrote 2/2 MIDI at
  // half speed, so a one-bar range ended halfway through the bar and the clicks ran twice as fast as the notes.
  const cutTime = 'X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc | cBAG FEDC | C8 |]';
  run(`openScore({abc:${JSON.stringify(cutTime)},instrument:'Flute'});$('speed').value=100;setRange(1,1)`);
  const heard = run(`parseMidi(midiBytes(${JSON.stringify(cutTime)})).notes.map(n => n.start)`);
  assert.deepEqual([heard[1], heard[8], heard[16]], [0.25, 2, 4], 'Half = 60: eighths 0.25 s apart, bars 2 s');
  assert.deepEqual(
    [run('measureStarts.get(2)'), run('measureStarts.get(3)')],
    [heard[8], heard[16]],
    'Measure starts fall on the notes heard'
  );
  assert.equal(run('rangeEnd(1,99)'), 2, 'A one-bar range in 2/2 lasts the whole bar');
  oscillators.length = 0;
  await run('play()');
  assert.equal(oscillators.length, 8, 'The range plays every note of its bar');
  assert.ok(Math.abs(oscillators[7].startAt - oscillators[0].startAt - 1.75) < 1e-9, 'At the written tempo');
  run('stop()');
  run("$('metronome').checked=true;$('count-in').checked=true");
  oscillators.length = 0;
  await run('play()');
  {
    const clicks = oscillators.filter(o => o.type === 'square'),
      notes = oscillators.filter(o => o.type !== 'square');
    assert.equal(clicks.length, 4, 'Two half-note beats of count-in, then two clicks in the bar');
    assert.ok(Math.abs(clicks[1].startAt - clicks[0].startAt - 1) < 1e-9, 'Count-in at half = 60');
    assert.ok(Math.abs(notes[0].startAt - clicks[2].startAt) < 1e-9, 'The first note lands on the downbeat click');
    assert.ok(Math.abs(notes[4].startAt - clicks[3].startAt) < 1e-9, 'The fifth eighth lands on the second beat');
  }
  run('stop()');
  run("$('metronome').checked=false;$('count-in').checked=false");
  // C| with no Q: keeps the speed it always sounded at (quarter = 180, half = 90); the timing follows it.
  const reel = 'X:1\nM:C|\nL:1/8\nK:D\ndAFA dAFA | dfed cdeA |]';
  run(`openScore({abc:${JSON.stringify(reel)}})`);
  const reelNotes = run(`parseMidi(midiBytes(${JSON.stringify(reel)})).notes.map(n => n.start)`);
  assert.ok(Math.abs(reelNotes[1] - 1 / 6) < 1e-6, 'Eighths at quarter = 180');
  assert.ok(Math.abs(run('measureStarts.get(2)') - reelNotes[8]) < 1e-3, 'The bar starts with its first note');
  assert.equal(
    run('clickTimes(0,99,8/3).map(c=>c.time.toFixed(2)+(c.down?"*":"")).join()'),
    '0.00*,0.67,1.33*,2.00',
    'Clicks on the half-note beats'
  );
  // A range, a loop and a start note play only their own notes. Bars are timed in whole milliseconds (1.333 s) and the
  // MIDI at 333,333 microseconds a quarter, so the note before the range and the next bar's first note overlapped it
  // by a third of a millisecond and sounded as clicks.
  {
    const reel4 = 'X:1\nM:C|\nL:1/8\nK:D\ndAFA dAFA | dfed cdeA | FAdA FAdA | d2f2 a4 |]',
      bar2 = '74,78,76,74,73,74,76,69',
      pitches = () =>
        oscillators
          .filter(o => o.type !== 'square')
          .map(o => Math.round(69 + 12 * Math.log2(o.frequency.value / 440)))
          .join();
    run(`openScore({abc:${JSON.stringify(reel4)},instrument:'Flute'});$('speed').value=100;setRange(2,2)`);
    assert.ok(Math.abs(run('measureStarts.get(2)') - 4 / 3) > 1e-4, 'Bar 2 is timed apart from its MIDI note');
    oscillators.length = 0;
    await run('play()');
    assert.equal(pitches(), bar2, 'A one-bar range plays its own eight notes');
    run('stop()');
    run("$('loop').checked=true;$('speed').value=200");
    oscillators.length = 0;
    await run('play()');
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(pitches(), bar2 + ',' + bar2, 'and loops with no click at the seam');
    run('stop()');
    run("$('loop').checked=false;$('speed').value=100");
    oscillators.length = 0;
    await run(
      "play(noteStartTime({startChar: [...noteSources].filter(([, e]) => e?.element.el_type === 'note')[5][0]}))"
    );
    assert.equal(pitches(), '69,66,69,' + bar2, 'Playing from the sixth note starts with it');
    run('stop()');
    assert.equal(
      run(
        'playbackSlice({duration:3,notes:[{start:0,duration:1.2+0.1+0.1,note:60,velocity:80},{start:1.4,duration:0.1,note:62,velocity:80}]},1.4,100).notes.map(n=>n.note).join()'
      ),
      '62',
      'A note that ends at the range start, give or take a rounding error, stays out'
    );
  }
  // Swing on a reel with no Q: writes out the tempo it plays at, quarter = 180 (abcjs's own default would be half =
  // 180, twice as fast), so the reel keeps its speed and the swing grid's two clocks agree.
  run(`openScore({abc:${JSON.stringify(reel)},instrument:'Flute'});setRange(1,2)`);
  const straightReel = await starts();
  feel(66);
  assert.match(run("$('abc').value"), /\nQ:"Swing" 1\/4=180\n/, 'A reel without Q: swings at quarter = 180');
  assert.equal(run("$('bpm').value"), '180', 'The Tempo slider shows that beat');
  assert.ok(
    Math.abs(
      run(
        "parseMidi(midiBytes($('abc').value)).quarter / (renderedTune.millisecondsPerMeasure() / 1000 / renderedTune.getBarLength() / 4)"
      ) - 1
    ) < 1e-5,
    'The MIDI and the note timings have the same quarter note'
  );
  const swungReel = (await starts()).split(' ').map(t => +t.split('+')[0]);
  assert.deepEqual(
    [swungReel[1], swungReel[2], swungReel[15], +straightReel.split(' ')[15].split('+')[0]].map(t => +t.toFixed(3)),
    [0.22, 0.333, 2.553, 2.5],
    'Its off-beat eighths start at 2/3 of the quarter beat, and the bars keep their length'
  );
  feel(0);
  // The Tempo slider reads and writes the tempo in the header's own beat, and a score with no Q: at the beat it plays
  // at, so moving it by one changes the speed by one beat a minute. It used to write 1/4=, which halved the speed of
  // Q:1/2=60 at the first move, and to read 100 for a score with no Q:.
  for (const [abc, shown, moved] of [
    ['X:1\nM:2/2\nL:1/8\nQ:1/2=60\nK:C\nCDEF GABc|]', 60, 'Q:1/2=61'],
    ['X:1\nM:C|\nL:1/8\nK:D\ndAFA dAFA|]', 180, 'Q:1/4=181'],
    ['X:1\nM:6/8\nL:1/8\nK:C\nCDE FGA|]', 120, 'Q:3/8=121'],
    ['X:1\nM:2/2\nL:1/8\nQ:120\nK:C\nCDEF GABc|]', 120, 'Q:1/2=121'],
    ['X:1\nM:4/4\nL:1/8\nQ:"Allegro" 1/4=132\nK:C\nCDEF GABc|]', 132, 'Q:"Allegro" 1/4=133']
  ]) {
    run(`openScore({abc:${JSON.stringify(abc)}})`);
    assert.equal(run("$('bpm').value"), String(shown), `The Tempo slider reads ${shown} for ${abc.split('\n')[1]}`);
    const quarter = () => run("parseMidi(midiBytes($('abc').value)).quarter"),
      before = quarter();
    run(`$('bpm').value='${shown + 1}';$('bpm').dispatchEvent(new Event('input'))`);
    assert.equal(run("$('abc').value.match(/^Q:.*$/m)[0]"), moved, 'and moving it keeps the beat');
    assert.ok(Math.abs(before / quarter() - (shown + 1) / shown) < 1e-5, `${moved} is one beat a minute faster`);
  }
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
  // Concert pitch view: a transposing instrument can show the source's sounding pitches and key. It is display only
  // (the ABC, playback and undo stay put), remembered and backed up, and entry follows whichever pitch is shown.
  {
    const concertOn = on => run(`$('concert-pitch').checked=${on};$('concert-pitch').onchange()`),
      fScore = 'X:1\nM:4/4\nL:1/4\nK:F\nF G A B |]';
    run(`dirty=false;openScore({abc:${JSON.stringify(fScore)},instrument:'Flute'})`);
    assert.equal(run("$('concert-pitch-option').hidden"), true, 'Flute has no Concert pitch option');
    run(`dirty=false;openScore({abc:${JSON.stringify(fScore)},instrument:'Cello'})`);
    assert.equal(run("$('concert-pitch-option').hidden"), true, 'nor does Cello (an octave is not a transposition)');
    run(`dirty=false;openScore({abc:${JSON.stringify(fScore)},instrument:'Clarinet in B♭'})`);
    assert.equal(run("$('concert-pitch-option').hidden"), false, 'Clarinet in B♭ offers it');
    assert.equal(run('renderedWritten.match(/^K:(\\S+)/m)[1]'), 'G', 'Off: the written part, in G');
    const at = run('historyIndex'),
      midi = () => run("JSON.stringify(parseMidi(midiBytes($('abc').value)).notes.map(n=>n.note))");
    const sounding = midi();
    concertOn(true);
    assert.equal(w.localStorage.getItem('fretfree-concert-pitch'), 'true', 'Concert pitch is remembered');
    assert.ok(run('BACKUP_SETTING_KEYS()').includes('fretfree-concert-pitch'), 'and backed up');
    assert.equal(run("$('abc').value"), fScore, 'The ABC never changes');
    assert.equal(run('historyIndex') + ' ' + run('dirty'), at + ' false', 'Changing the view is not an edit');
    assert.equal(midi(), sounding, 'Playback is unchanged');
    assert.equal(run('renderedWritten.match(/^K:(.*)$/m)[1]'), 'F clef=treble', 'On: the source key, in F');
    assert.deepEqual(
      run("JSON.stringify(noteLabels(ABCJS.parseOnly(renderedWritten)[0],'letters').map(l=>l.written[0]))"),
      JSON.stringify([65, 67, 69, 70]),
      'and the source pitches'
    );
    assert.match(run("$('score-caption').textContent"), /Concert pitch shown/);
    // A note menu points into the drawing it was opened on. One that outlives a redraw (here the view changes without
    // its handler) asks for a fresh right-click instead of editing; changing the view with the checkbox closes it.
    const menuOn = n => run(`(e => openNoteMenu(e, displayOf(e), 0, 0))(scoreNotes()[${n}])`),
      pick = edit => run(`$('note-menu').querySelector('[data-edit="${edit}"]').click()`);
    menuOn(1);
    run("$('concert-pitch').checked=false;render()");
    pick('acc:^');
    assert.equal(run("$('abc').value"), fScore, 'A menu from the concert drawing does not edit the written one');
    menuOn(1);
    concertOn(true);
    assert.equal(run("$('note-menu').hidden"), true, 'Changing the view closes the note menu');
    menuOn(1);
    pick('acc:^');
    assert.equal(body(), 'F ^G A B |]', 'A menu opened on the concert drawing edits the concert note');
    run('stepHistory(-1)');
    // Letters, accidentals and piano keys enter what is shown: concert pitch here, written pitch with the view off.
    assert.equal(run("letterToken('A', $('abc').value.length - 2)"), 'A', 'Typed A is concert A');
    assert.equal(run("(e => accidentalEdit(e, displayOf(e), '='))(scoreNotes()[3])"), '=B ', 'Natural on B-flat is B');
    run('selectEntry(scoreNotes()[3]);pianoPress(72)');
    assert.equal(body(), 'F G A B c |]', 'The C5 key enters concert C');
    run('stepHistory(-1)');
    concertOn(false);
    assert.equal(run("letterToken('A', $('abc').value.length - 2)"), 'G', 'With the view off, typed A is written');
    run('selectEntry(scoreNotes()[3]);pianoPress(72)');
    assert.equal(body(), 'F G A B B |]', 'and the written C5 key enters concert B-flat');
    // The view follows the setting across instruments and restored settings.
    concertOn(true);
    run("$('instrument').value='Flute';$('instrument').onchange();clearTimeout(renderTimer);render()");
    assert.equal(run("$('concert-pitch-option').hidden + ' ' + concertView()"), 'true false', 'Flute hides it');
    run("$('instrument').value='Alto sax in E♭';$('instrument').onchange();clearTimeout(renderTimer);render()");
    assert.equal(run('renderedWritten.match(/^K:(\\S+)/m)[1]'), 'F', 'Alto sax keeps the view on');
    w.localStorage.setItem('fretfree-concert-pitch', 'false');
    run('applyStoredSettings();render()');
    assert.equal(run("$('concert-pitch').checked"), false, 'A restored setting is applied');
    assert.equal(run('renderedWritten.match(/^K:(\\S+)/m)[1]'), 'D', 'Alto sax written in D');
    // Writing-prompt goals stay in written pitch: a clarinet asked for G major writes concert F, in either view.
    run(
      `dirty=false;openScore({instrument:'Clarinet in B♭',abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:F\nF G A G | F G A B | c B A G | A G F2 |]')},prompt:makeAssignment({title:'Steps',text:'',meter:'4/4',unit:'1/4',key:'G',tempo:90,bars:4,goals:[{type:'bars'},{type:'steps'},{type:'end',degree:0},{type:'inKey',scale:'major'}]})})`
    );
    const goals = () => run("$('prompt-check').querySelector('.small').textContent");
    assert.equal(goals(), '4 of 4 goals', 'Written view meets every goal');
    assert.doesNotMatch(run("$('prompt-check').textContent"), /written pitch/, 'Written view needs no note');
    concertOn(true);
    assert.equal(goals(), '4 of 4 goals', 'Concert view judges the written part too');
    assert.match(
      run("$('prompt-check').textContent"),
      /Goals are in written pitch; turn off Concert pitch to see the written part\./,
      'and the checklist says so'
    );
    assert.equal(run('assignmentBasis().key'), 'G', 'An assignment from concert view keeps the written key');
    // Respell (Z) names the new spelling in the pitch shown.
    run(
      `dirty=false;openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\n^C z3 |]')},instrument:'Clarinet in B♭'})`
    );
    run("selectEntry(scoreNotes()[0]);scoreKey({key:'z'})");
    assert.equal(body(), '_D z3 |]');
    assert.match(run("$('selection-status').textContent"), /^Respelled as D♭\./, 'Respell names the concert note');
    concertOn(false);
  }
  // Z respells the selected note or chord at the same pitch, one undo step each; the bar's accidentals are kept right.
  {
    const open = (abc, instrument = 'Flute') =>
        run(`openScore({abc:${JSON.stringify(abc)},instrument:${JSON.stringify(instrument)}})`),
      pick = i => run(`selectEntry(scoreNotes()[${i}])`),
      z = () => run("scoreKey({key:'z'})"),
      status = () => run("$('selection-status').textContent"),
      midis = () => run("parseMidi(midiBytes($('abc').value)).notes.map(n=>n.note).join()");
    open('X:1\nM:4/4\nL:1/4\nK:C\n^C [^C^F]2 z |]');
    pick(0);
    assert.equal(z(), true, 'Z is a score shortcut');
    assert.equal(body(), '_D [^C^F]2 z |]', 'Z turns ^C into _D');
    assert.match(status(), /^Respelled as D♭\. Respell again \(Z\)/);
    z();
    assert.equal(body(), '^C [^C^F]2 z |]', 'and back');
    run('stepHistory(-1)');
    assert.equal(body(), '_D [^C^F]2 z |]', 'One undo step');
    pick(1);
    z();
    assert.equal(body(), '_D [_D_G]2 z |]', 'Z works on chords');
    assert.match(status(), /^Respelled the chord\./);
    pick(2);
    z();
    assert.match(status(), /select a note or chord first/i, 'A rest has no spelling');
    assert.equal(body(), '_D [_D_G]2 z |]');
    // The key signature and earlier accidentals in the bar decide what a plain letter sounds.
    open('X:1\nM:4/4\nL:1/4\nK:D\nC =C E _D |]');
    pick(0);
    z();
    assert.equal(body(), '_D =C E _D |]', 'In D major a plain C is C sharp: D flat');
    z();
    assert.equal(body(), 'C =C E _D |]', 'and back to the plain letter');
    pick(3);
    z();
    assert.equal(body(), 'C =C E ^C |]', 'After =C in the bar the C sharp needs its sharp');
    assert.equal(midis(), '61,60,64,61');
    open('X:1\nM:4/4\nL:1/4\nK:C\n^C z C2 |]');
    pick(0);
    z();
    assert.equal(body(), '_D z ^C2 |]', 'A later C that the sharp carried to keeps its pitch');
    assert.equal(midis(), '61,61');
    open('X:1\nM:4/4\nL:1/4\nK:C\nD F z2 |]');
    pick(0);
    z();
    z();
    z();
    assert.equal(body(), 'D F z2 |]', 'D cycles through E double flat and C double sharp back to D');
    open('X:1\nM:4/4\nL:1/4\nK:C\n^C z3 |]', 'Clarinet in B♭');
    pick(0);
    z();
    assert.equal(body(), '_D z3 |]');
    assert.match(status(), /^Respelled as E♭\./, 'Named in written pitch');
    // A chord moves as one and comes back in two presses; a natural that only the old spelling needed goes again.
    open('X:1\nM:4/4\nL:1/4\nK:C\n[GCE] ^C D E |]');
    pick(0);
    z();
    assert.equal(body(), '[G^B,_F] ^C D E |]', 'G stays while C and E swap');
    z();
    assert.equal(body(), '[GCE] ^C D E |]', 'Two presses bring the chord back');
    pick(1);
    z();
    assert.equal(body(), '[GCE] _D =D E |]', 'The later D keeps its pitch');
    pick(3);
    z();
    pick(1);
    z();
    assert.equal(body(), '[GCE] ^C D _F |]', 'and loses the natural again after another edit');
    assert.equal(midis(), '67,60,64,61,62,64');
    for (let i = 0; i < 3; i++) run('stepHistory(-1)');
    assert.equal(body(), '[GCE] ^C D E |]');
    pick(1);
    // Without a keyboard: the palette's Respell button and the note menu do the same, one undo step each.
    const respellButton = "$('palette').querySelector('[data-palette=\"respell\"]')";
    run(`${respellButton}.click()`);
    assert.equal(body(), '[GCE] _D =D E |]', 'The palette respells the selected note');
    assert.match(status(), /^Respelled as D♭\./);
    run('stepHistory(-1)');
    assert.equal(body(), '[GCE] ^C D E |]', 'One undo step');
    run('openNoteMenu(scoreNotes()[1], displayOf(scoreNotes()[1]), 10, 10)');
    run("$('note-menu').querySelector('[data-edit=\"respell\"]').click()");
    assert.equal(body(), '[GCE] _D =D E |]', 'So does the note menu');
    assert.equal(run("$('note-menu').hidden"), true);
    // Two presses in a row on the same note give back the very text, even a sharp the bar did not need.
    open('X:1\nM:4/4\nL:1/4\nK:C\n^C D ^C z |]');
    pick(0);
    z();
    assert.equal(body(), '_D =D ^C z |]');
    z();
    assert.equal(body(), '^C D ^C z |]', 'Back to the start');
    // A range selection is left alone: Z and Respell work on one note or chord.
    run('selectNotesBetween(scoreNotes()[0],scoreNotes()[2])');
    z();
    assert.equal(body(), '^C D ^C z |]', 'Z leaves a range selection as it is');
    assert.match(status(), /^Z respells one note or chord\./);
    run(`${respellButton}.click()`);
    assert.equal(body(), '^C D ^C z |]');
    assert.equal(status(), 'Select a single note for this.', 'So does the palette');
    open('X:1\nM:4/4\nL:1/4\nK:C\nC z3 |]');
    pick(1);
    run('updatePalette()');
    assert.equal(run(`${respellButton}.getAttribute('aria-disabled')`), 'true', 'A rest cannot be respelled');
  }
  // MIDI keyboards: the toggle shows only with Web MIDI; notes within 40 ms make a chord; no SysEx is asked for.
  {
    assert.equal(run("$('midi-toggle').hidden"), true, 'The MIDI toggle is hidden without Web MIDI');
    const asked = [];
    let deny = true;
    let closed = 0,
      access = null;
    const input = {
      name: 'Test Keys',
      state: 'connected',
      onmidimessage: null,
      close: async () => {
        closed++;
      }
    };
    w.navigator.requestMIDIAccess = async options => {
      asked.push(options);
      if (deny) throw new w.DOMException('Permission denied', 'NotAllowedError');
      return (access = {inputs: new Map([['in', input]]), onstatechange: null});
    };
    run(
      `openScore({abc:${JSON.stringify('X:1\nM:4/4\nL:1/4\nK:C\nz4 | z4 |]')},instrument:'Flute'});selectEntry(scoreNotes()[0])`
    );
    await run('setMidi(true)');
    assert.match(run("$('midi-status').textContent"), /^MIDI access was blocked\./, 'Denied permission says so');
    assert.equal(run("$('midi-toggle').getAttribute('aria-pressed')"), 'false');
    deny = false;
    await run('setMidi(true)');
    assert.deepEqual(JSON.parse(JSON.stringify(asked)), [{sysex: false}, {sysex: false}], 'No SysEx is requested');
    assert.equal(run("$('midi-toggle').getAttribute('aria-pressed')"), 'true');
    assert.match(run("$('midi-status').textContent"), /^MIDI input from Test Keys\./, 'The status names the device');
    assert.equal(typeof input.onmidimessage, 'function', 'Every input is heard');
    const play = (...notes) => {
      for (const note of notes) input.onmidimessage({data: [0x90, note, 100]});
      run('clearTimeout(midiTimer);midiEnter()');
      for (const note of notes) input.onmidimessage({data: [0x80, note, 0]});
    };
    play(60);
    play(64);
    assert.equal(body(), 'C E z2 | z4 |]', 'Notes one after another enter one after another');
    play(67, 60, 64);
    assert.equal(body(), 'C E [CEG] z | z4 |]', 'Notes played together enter as a chord, lowest first');
    run('stepHistory(-1)');
    assert.equal(body(), 'C E [CE] z | z4 |]', 'Each chord pitch is its own undo step, like Shift+tap');
    // Nothing goes in from drum pads (channel 10), while the score plays, or away from Compose.
    input.onmidimessage({data: [0x99, 38, 100]});
    assert.equal(run('midiPending.length'), 0, 'Channel 10 is ignored');
    run('playing = true');
    play(62);
    run('playing = false');
    assert.equal(body(), 'C E [CE] z | z4 |]', 'Nothing is entered during playback');
    assert.match(run("$('midi-status').textContent"), /^Stop playback to enter notes/);
    run("show('library')");
    play(62);
    run("show('studio')");
    assert.equal(body(), 'C E [CE] z | z4 |]', 'Nothing is entered outside Compose');
    // Plugging a keyboard in or out updates the status line.
    const second = {name: 'Stage Keys', state: 'connected', onmidimessage: null};
    access.inputs.set('in2', second);
    access.onstatechange({port: second});
    assert.match(run("$('midi-status').textContent"), /^MIDI input from Test Keys and Stage Keys\./);
    assert.equal(typeof second.onmidimessage, 'function', 'A keyboard plugged in later is heard');
    input.state = 'disconnected';
    access.onstatechange({port: input});
    assert.match(run("$('midi-status').textContent"), /^MIDI input from Stage Keys\./, 'Unplugged keyboards go');
    access.inputs.clear();
    access.onstatechange({port: second});
    assert.match(run("$('midi-status').textContent"), /^No MIDI keyboard found\./);
    access.inputs.set('in', input);
    input.state = 'connected';
    run("$('midi-toggle').click()");
    await new Promise(r => w.setTimeout(r, 0));
    assert.equal(input.onmidimessage, null, 'Turning MIDI input off stops listening');
    assert.equal(closed, 1, 'and closes the port for other apps');
    assert.equal(access.onstatechange, null);
    assert.equal(run("$('midi-status').hidden"), true);
    delete w.navigator.requestMIDIAccess;
  }
  await checkChordSymbols();
  await checkLyrics();
  await checkAudio();
  await checkRecording();
  await checkPlayAlong();
  await checkInstrumentSounds();
  await checkWavExport();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-scores-v1')), [legacy]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('commonnote-favorites-v1')), ['ode', 'mutopia-263']);
  run("openScore(saved[0],saved[0].id);$('save').onclick()");
  assert.equal(run('saved.length'), 1, 'Save updates existing score identity');
  console.log(
    'PASS: real SVG engraving, all instruments, zoom and measures per line (settings, backups, re-flowed systems), Unicode offsets, drag direction, chord/rhythm preservation, slur- and tuplet-start note edits, range selection (Shift+arrows, Shift+click, select all, one voice, palette buttons and piano keys on a range), copy, cut, paste and duplicate with one undo each, notes keeping their pitch through carried accidentals and fields, deletes that leave no blank line, multi-note pitch, accidental and length edits (written once per range on transposing instruments), notation palette state, edits and guards, screen-reader note descriptions (selection, arrow keys, edits, typing over rests, pickups, compound and free meters, triplets, written and concert pitch), the shortcut sheet (? and the button, groups, focus trap, search, Enter running a command as one undo step, hints, Escape, tuplet and Measure panel commands), measure tools (bars inserted and deleted with one undo, bar lines, a selected bar line, repeats and endings that play, form marks, rehearsal letters, time, key and clef changes, piano staves, transposing instruments), articulations, dynamics and ornaments (keys, palette, More, note menu, rests, written pitch, range selections), slurs, hairpins and trill lines (S and the Lines group on a range or to the next note, rests, voices and voices written in blocks, chained slurs, replacing covered and crossing lines, one undo each, edits on slurred notes, accidentals on trill-line notes on transposing instruments), tuplets and grace notes (T, the Triplet button and Tuplet menu, letters filling the rests and beaming them, taking off and splitting again, duplets in 6/8, rests, line continuations, Delete in a tuplet, marks on its first note, uneven tuplets, guards, Grace, Slashed and Grace ↑↓ from the toolbar and the note menu, written pitch, chord symbols (K, Chord button, note menu, Enter, Tab, Shift+Tab, Escape, removal, text that does not play, written pitch with words left as written, concert pitch view, the Chords switch in playback, export and backups), lyrics (L, the Lyrics button, the shortcut sheet and the note menu, Space, -, _ and * as typed, Enter for the next verse, the box kept open past the last note, Tab, Shift+Tab and Backspace, rests passed over, saving on blur, one undo per syllable, the check after notes change (refrains too), marks kept inside a syllable, voices after &, and words kept through transposing, instruments, share links and ABC, MusicXML and SVG export), repeats, pickups, ties, tempo changes, swing feel (Feel menu, tempo text, one undo, swung start times at 90 and 120 BPM, through a tempo change, without Q: and in 2/2, pickups at repeats, playing from an off-beat, straight 6/8), speed scaling, practice ranges (no stray notes at their edges), count-in, metronome, cut-time tempo (ranges, clicks, count-in, swing and the Tempo slider in the beat Q: names), master volume bus, note audition, recording yourself (no microphone, denied, count-in bars, one pass, the take and its length, playing alone and lined up with the score, calibration applied to older takes, downloads with credits, delete, a press while saving keeps the take, each unsaved score with takes of its own, takes back with a restored draft and kept through the first save, deleting a saved score with its takes, deleting takes no score can reach but not those open in another tab, cancelling, a stop in the count-in keeping no take, a save while recording, in the tail or while the take is stored keeping the take with the saved score, a library copy taking only the takes recorded since it opened), play-along checks (no microphone, denied, no analyser, one pass after a one-bar count-in, notes marked as they pass without stopping playback, green, yellow and red marks with their words, Pitch and Rhythm % and stars, Easy timing, leaving the melody out for the metronome, a stop in the count-in, silence not kept, an edit while the last note is marked, history per score through the first save and a delete, marks redrawn on the same music, left off changed music and out of SVG export, Escape), WAV export (the notes, times, speed, clicks and chords Play has, its own full-level bus, INFO title, scaling, no offline audio, a summary that follows Speed and the instrument, a busy or filling progress bar, a closed panel cutting the render off, too long with its length and MIDI as the way out), instrument sounds (both menus from one list, one oscillator per note with no square wave, playback octaves, horn in F, tenor and baritone sax written pitch, typing and prompts, captions and embed labels), on-screen piano entry, spelling and chords, Z respelling (keys, chords as one, bar accidentals and their tidying, written names, palette and note menu, not on a range), MIDI keyboard entry (chords, denied access, no SysEx, drum channel, playback and view guards, plugging in and out, closing ports), bar checks, transposing (whole score, selected measures, to a key, transposing instruments, no K: line, bagpipe keys), a transpose panel that follows the score, key changes that keep clef=, written-key letters for typing and accidentals, concert pitch view (display only, remembered and backed up, letters, accidentals, piano keys and Respell names in the pitch shown, stale note menus, prompt goals and assignments in written pitch with a note in concert view), the key and meter menus, classroom colors and letters in noteheads, MusicXML at concert pitch, and legacy storage.'
  );
  // Let the takes list that the last save refreshes finish before the window goes.
  await new Promise(r => setTimeout(r, 20));
  w.close();
}
checkPlayback().catch(e => {
  console.error(e);
  w.close();
  process.exitCode = 1;
});
