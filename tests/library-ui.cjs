// Library and saved-score behaviour on a real DOM (jsdom) with the real engraving library.
// Run with: node tests/library-ui.cjs  (set JSDOM_PATH to a jsdom install if it isn't in node_modules)
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
const root = path.resolve(__dirname, '..');
const SCRIPTS = [
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
  'catalog-skills.js',
  'prompts.js',
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
  'app.js'
];
// A fresh page load: `seed` fills localStorage before the scripts run, as a previous visit would have left it.
function boot(seed = () => {}, url = 'http://localhost:8000') {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {runScripts: 'outside-only', url});
  const w = dom.window,
    ctx = dom.getInternalVMContext();
  w.SVGElement.prototype.getBBox = function () {
    return {x: 0, y: 0, width: Math.max(1, (this.textContent || '').length * 7), height: 14};
  };
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  seed(w.localStorage, w);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  return {w, run: s => vm.runInContext(s, ctx), $: id => w.document.getElementById(id)};
}
// Storage written by the app's previous name must still load; a damaged played list must not stop start-up.
const {w, run, $} = boot(storage => {
  storage.setItem(
    'commonnote-scores-v1',
    JSON.stringify([
      {
        id: 'legacy-score',
        title: 'Existing saved tune',
        abc: 'X:1\nT:Existing saved tune\nM:4/4\nL:1/4\nK:C\nC4 |]',
        updated: 1
      }
    ])
  );
  storage.setItem('commonnote-favorites-v1', '["ode"]');
  storage.setItem('fretfree-played', '{"unexpected":true}');
});
const cards = () => $('cards').innerHTML,
  setFilter = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event('input', {bubbles: true}));
  };

assert.equal(run('saved[0].id'), 'legacy-score', 'Renaming preserves existing saved scores');
assert.ok(run('favorites.includes("ode")'), 'Existing favorites preserved');
assert.equal(run('played.size'), 0, 'A damaged played list is ignored instead of breaking start-up');
assert.ok(run('filteredCatalog().length') >= 200);
assert.equal($('hero-count').textContent, '01 / ' + run('catalog.length'));
{
  const first = [...$('cards').querySelectorAll('.card')];
  assert.equal(first.length, 24, 'The first page holds a full page of cards');
  assert.ok(
    first.every(card => card.querySelector('.mini-score svg')),
    'Every card on the first page is engraved'
  );
}

// Search and sort go through the real input events.
setFilter('sort-filter', 'title');
setFilter('search', 'The Entertainer');
assert.ok(run('filteredCatalog().some(x=>x.title==="The Entertainer")'));
assert.ok(cards().includes('Complete PDF'));
assert.equal($('pagination').hidden, true);
setFilter('search', '');
setFilter('genre-filter', 'Original exercises');
assert.equal(run('filteredCatalog().length'), 8);
setFilter('genre-filter', 'all');
$('next-page').click();
assert.ok($('page-status').textContent.startsWith('Page 2'));
assert.ok($('cards').querySelectorAll('article').length <= 24);
$('prev-page').click();
assert.ok(cards().includes('data-listen="'), 'Cards offer a Listen button');
assert.equal(
  run('cardSnippet(catalog.find(x=>x.id==="ode")).split("\\n").pop()'),
  run('catalog.find(x=>x.id==="ode").abc.split("\\n")[7]'),
  'Preview plays the first line shown on the card'
);

// Skill filter: tags come from catalog-skills.js, the chip on a card matches the filter, and search finds tags.
setFilter('skill-filter', 'Chords');
assert.equal(run('filteredCatalog().length'), run('catalog.filter(x=>scoreSkills(x).includes("Chords")).length'));
assert.ok(run('filteredCatalog().every(x=>scoreSkills(x).includes("Chords"))'));
assert.ok(
  $('cards').querySelector('.chip[data-skill="Chords"][aria-pressed="true"]'),
  'The active skill chip is pressed'
);
$('cards').querySelector('.chip[aria-pressed="true"]').click();
assert.equal($('skill-filter').value, 'all', 'Clicking the pressed chip clears the filter');
setFilter('search', 'compound meter');
assert.ok(
  run('filteredCatalog().length') >= 800 &&
    run('filteredCatalog().every(x=>scoreSkills(x).includes("Compound meter")||/compound/i.test(x.skill+x.title))'),
  'Search matches skill tags'
);
setFilter('search', '');

// Try next: suggestions share skills, sit at the same level or one up, skip the score itself and played scores;
// opening a score marks it played on its card without redrawing the library.
setFilter('sort-filter', 'featured');
$('cards').querySelector('[data-open="ode"]').click();
assert.equal($('studio').hidden, false, 'Opening a card shows the studio');
assert.ok(run('played.has("ode")'), 'Opening a library score records it as played');
assert.ok(JSON.parse(w.localStorage.getItem('fretfree-played')).includes('ode'), 'Played scores persist');
assert.ok(
  $('cards').querySelector('[data-favorite="ode"]').previousElementSibling?.classList.contains('played'),
  'The card gets its Played tag in place'
);
assert.equal(
  run('suggestNext(catalog.find(x=>x.id==="mutopia-1006"),catalog,scoreSkills).length'),
  0,
  'A score with no skill tags gets no suggestions'
);
const picks = run(
  'suggestNext(catalog.find(x=>x.id==="ode"),catalog,scoreSkills,played).map(p=>[p.item.id,p.item.level,p.shared.join("/")])'
);
assert.equal(picks.length, 3);
assert.ok(
  picks.every(
    ([id, level, shared]) => id !== 'ode' && ['Beginner', 'Intermediate'].includes(level) && shared.includes('Steps')
  ),
  'Suggestions share Steps and stay within one level: ' + JSON.stringify(picks)
);
const skip = run(
  `suggestNext(catalog.find(x=>x.id==="ode"),catalog,scoreSkills,new Set(${JSON.stringify(picks.map(p => p[0]))})).map(p=>p.item.id)`
);
assert.ok(!skip.some(id => picks.map(p => p[0]).includes(id)), 'Played suggestions give way to unplayed ones');
assert.equal(
  run('suggestNext(catalog.find(x=>x.id==="mutopia-263"),catalog,scoreSkills).every(p=>p.item.level==="Advanced")'),
  true,
  'An advanced score suggests advanced scores'
);
assert.equal($('next-up').hidden, false, 'Try next panel is shown for a library score');
assert.equal($('next-up').querySelectorAll('.next-card').length, 3, 'Try next panel shows three cards');
assert.equal(
  $('next-up').querySelector('.next-card h3').textContent,
  picks[0][0] && run(`catalog.find(x=>x.id===${JSON.stringify(picks[0][0])}).title`)
);
$('next-up').querySelector('[data-open]').click();
assert.equal(
  $('title').value.split(' · ')[0],
  picks[0][0] && run(`catalog.find(x=>x.id===${JSON.stringify(picks[0][0])}).title`).split(' · ')[0],
  'Opening a suggestion loads it'
);
$('new-score').click();
assert.equal($('next-up').hidden, true, 'No suggestions for a new score');
// A new score is a blank sheet of whole-bar rests, sized by the Bars box; Add 4 bars extends it in the current meter.
assert.equal(
  $('abc').value.trim().split('\n').pop(),
  'z4 | z4 | z4 | z4 | z4 | z4 | z4 | z4 |]',
  'New score is eight blank bars'
);
assert.equal(run('scoreNotes().length'), 8);
assert.ok(
  run('selectedRange && selectedRange[0] === $("abc").value.indexOf("z4")'),
  'The first bar is selected, ready for typing'
);
// The quick start ignores the New score panel's Bars box; the panel's Melody template with 3 bars is the same sheet.
const submitNewScore = () => $('new-score-form').dispatchEvent(new w.Event('submit', {cancelable: true}));
$('new-bars').value = '3';
$('new-score').click();
assert.equal(run('scoreNotes().length'), 8, 'Blank melody is always eight bars');
submitNewScore();
assert.equal($('abc').value.trim().split('\n').pop(), 'z4 | z4 | z4 |]', 'Bars box sets the sheet length');
$('add-bars').click();
assert.equal(
  $('abc').value.trim().split('\n').pop(),
  'z4 | z4 | z4 | z4 | z4 | z4 | z4 |]',
  'Add 4 bars appends rests before the final barline'
);
// Notation palette on a blank sheet: it shows the selected rest's length; a length button keeps the rest and sets
// the length that typing writes over it.
{
  const pressed = () =>
    [...w.document.querySelectorAll('#palette [aria-pressed="true"]')].map(b => b.dataset.palette).join(' ');
  submitNewScore();
  assert.equal(pressed(), 'len:1', 'The selected whole-bar rest shows Whole');
  w.document.querySelector('[data-palette="len:0.5"]').click();
  assert.equal($('abc').value.trim().split('\n').pop(), 'z4 | z4 | z4 |]', 'A length button leaves the rest alone');
  run("scoreKey({key:'c'})");
  assert.equal(
    $('abc').value.trim().split('\n').pop(),
    'c2 z2 | z4 | z4 |]',
    'Typing writes a half note over the rest'
  );
  assert.equal(pressed(), 'len:0.5', 'The rest that is left is selected and shows its length');
  run('inputLength = null');
}
// Appended bars take the meter and unit length in force at the end, and an open last measure is closed first.
run(`$('abc').value = 'X:1\\nT:t\\nM:4/4\\nL:1/8\\nK:C\\nC2 D2 [M:3/4] [L:1/16] E4 F4 G4\\n'; syncFields(); render();`);
$('add-bars').click();
assert.equal(
  $('abc').value.trim().split('\n').pop(),
  '| z12 | z12 | z12 | z12 |]',
  'Add 4 bars closes the open measure and sizes rests by the inline meter and unit'
);
// Cancelling the unsaved-changes prompt leaves the open score, its selection and status alone.
run('dirty = true; selectedRange = [7, 9]');
$('selection-status').textContent = 'before';
w.confirm = () => false;
$('new-score').click();
w.confirm = () => true;
assert.ok($('abc').value.includes('[M:3/4]'), 'Cancelled new score keeps the current score');
assert.ok(run('selectedRange[0] === 7 && selectedRange[1] === 9'), 'Cancelled new score keeps the selection');
assert.equal($('selection-status').textContent, 'before', 'Cancelled new score keeps the status line');
run('dirty = false');
$('new-bars').value = '8';
// New score panel: a template with title, key, meter, tempo, pickup and bars. SATB has four named staves.
{
  const choose = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event('input', {bubbles: true}));
  };
  $('new-score-open').click();
  assert.equal($('new-score-panel').hidden, false);
  assert.equal($('new-score-open').getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.activeElement, $('new-title'), 'The panel opens on its first field');
  assert.deepEqual(
    [...$('new-template').options].map(o => o.text),
    ['Melody', 'Lead sheet', 'Piano', 'Duet', 'Melody and bass', 'SATB choir', 'String quartet']
  );
  assert.ok(![...$('new-meter').options].some(o => o.value === 'none'), 'No free time for a sheet of bars');
  choose('new-meter', '2/4');
  assert.deepEqual(
    [...$('new-pickup').options].map(o => o.disabled),
    [false, false, true, true],
    'A 2/4 pickup is one beat at most'
  );
  choose('new-pickup', '1');
  choose('new-meter', '6/8');
  assert.equal($('new-pickup').value, '1', 'One dotted-quarter beat fits 6/8');
  choose('new-meter', '3/4');
  choose('new-pickup', '2');
  choose('new-meter', '2/2');
  assert.equal($('new-pickup').value, '0', 'A pickup too long for the new meter is dropped');
  $('new-title').value = 'Evening <hymn>';
  choose('new-template', 'satb');
  choose('new-key', 'F');
  choose('new-meter', '3/4');
  choose('new-pickup', '1');
  choose('new-tempo', '72');
  choose('new-bars', '6');
  assert.equal(
    $('new-score-summary').textContent,
    'SATB choir: soprano, alto, tenor and bass staves. A 1-beat pickup, then 6 bars of 3/4 in F major (1♭) at 72 BPM.'
  );
  // Opening the writing prompts closes the panel, and the panel closes them.
  $('open-prompts').click();
  assert.equal($('new-score-panel').hidden, true);
  $('new-score-open').click();
  assert.equal($('prompt-picker').hidden, true);
  submitNewScore();
  assert.equal($('new-score-panel').hidden, true, 'Creating closes the panel');
  assert.equal($('new-score-open').getAttribute('aria-expanded'), 'false');
  const tune = w.ABCJS.parseOnly($('abc').value)[0];
  assert.ok(!tune.warnings?.length, 'The SATB score parses cleanly');
  assert.deepEqual(
    [...tune.lines[0].staff.map(st => st.title?.[0])],
    ['Soprano', 'Alto', 'Tenor', 'Bass'],
    'Four named staves'
  );
  assert.deepEqual([...tune.lines[0].staff.map(st => st.clef.type)], ['treble', 'treble', 'treble-8', 'bass']);
  assert.equal($('title').value, 'Evening <hymn>');
  assert.equal($('meter').value, '3/4');
  assert.equal($('key').value, 'F');
  assert.equal($('bpm').value, '72');
  assert.equal($('instrument').value, 'Piano', 'A choir plays on the piano sound, at concert pitch');
  assert.equal($('bar-check').textContent.includes('Every bar'), true, 'The pickup passes the bar check');
  assert.ok(
    run('selectedRange && $("abc").value.slice(...selectedRange).trim() === "z"'),
    'The soprano pickup rest is selected'
  );
  assert.match($('selection-status').textContent, /SATB choir template, 4 staves/);
  assert.equal($('score-caption').textContent, 'Piano · 4 staves · Concert pitch.');
  assert.equal($('new-title').value, '', 'The next new score starts with a fresh title');
  // ＋ 4 bars on a piano score adds four bars to both staves in one undo step; typing on a left-hand rest fills
  // only that staff; with nothing selected, letters go to the top staff.
  $('new-score-open').click();
  choose('new-template', 'piano');
  choose('new-key', 'C');
  choose('new-meter', '4/4');
  choose('new-pickup', '0');
  choose('new-bars', '4');
  submitNewScore();
  assert.equal($('title').value, 'Untitled');
  const staffBars = () =>
    [...run('barLengths(ABCJS.parseOnly($("abc").value)[0])')].reduce(
      (n, m) => ({...n, [m.voice]: (n[m.voice] || 0) + 1}),
      {}
    );
  assert.deepEqual(staffBars(), {'0:0': 4, '1:0': 4});
  const before = $('abc').value;
  $('add-bars').click();
  assert.deepEqual(staffBars(), {'0:0': 8, '1:0': 8}, 'Both staves grow');
  assert.equal(run('barProblems(ABCJS.parseOnly($("abc").value)[0]).length'), 0);
  assert.match($('selection-status').textContent, /every staff/);
  $('undo').click();
  assert.equal($('abc').value, before, 'One undo takes the bars off both staves');
  const lh = run('scoreNotes().filter(n => voiceOf(n) === "1:0")[1]');
  run(`selectEntry(scoreNotes().find(n => n.element.startChar === ${lh.element.startChar}))`);
  run("scoreKey({key:'c'}); scoreKey({key:'e'})");
  assert.equal(
    $('abc').value.split('V:LH clef=bass\n')[1].trim(),
    'z4 | C, E, z2 | z4 | z4 |]',
    'Typing on a left-hand rest fills that staff, in the bass octave'
  );
  assert.ok($('abc').value.includes('V:RH clef=treble name="Piano" snm="Pno."\nz4 | z4 | z4 | z4 |]'));
  run('selectedRange = null; selectionAnchor = null');
  run("scoreKey({key:'g'})");
  assert.ok(
    $('abc').value.includes('V:RH clef=treble name="Piano" snm="Pno."\nz4 | z4 | z4 | z4 G |]'),
    'With nothing selected a letter goes to the end of the top staff'
  );
  // Guitar tab adds a staff under the top one, which the caption does not count; a one-staff library score on
  // guitar still names its clef.
  const instrumentBefore = $('instrument').value,
    setInstrument = name => {
      $('instrument').value = name;
      $('instrument').dispatchEvent(new w.Event('change'));
      run('clearTimeout(renderTimer); render()');
    };
  setInstrument('Guitar');
  assert.equal(run('fingeringShown()'), 'guitar');
  assert.equal($('score-caption').textContent, 'Guitar · 2 staves · Concert pitch.', 'The tab staff is not a staff');
  run('dirty = false; openScore({...catalog.find(x => x.id === "skipping"), instrument: "Guitar"})');
  assert.equal($('score-caption').textContent, 'Guitar · treble clef · Concert pitch melody part.');
  // An & overlay is a voice of its own but shares its staff's bar lines, so ＋ 4 bars adds four bars once.
  const addToOverlay = body => {
    run(
      `dirty = false; openScore({kind: 'personal', instrument: 'Piano', title: 't', abc: ${JSON.stringify(`X:1\nT:t\nM:4/4\nL:1/4\n${body}`)}})`
    );
    $('add-bars').click();
    return staffBars();
  };
  assert.deepEqual(addToOverlay('K:C\nC D E F & E4 | G4 | A4 | B4 |]\n'), {'0:0': 8, '0:1': 8}, 'One staff, overlay');
  assert.equal($('abc').value.trim().split('\n').pop(), 'C D E F & E4 | G4 | A4 | B4 | z4 | z4 | z4 | z4 |]');
  assert.deepEqual(addToOverlay('K:C\nC D E F & z4 | G4 & E4 |]\n'), {'0:0': 6, '0:1': 6});
  assert.deepEqual(
    addToOverlay('%%score {RH LH}\nK:C\nV:RH\nC D E F & E4 | G4 |]\nV:LH clef=bass\nC,4 | C,4 |]\n'),
    {'0:0': 6, '0:1': 6, '1:0': 6},
    'Piano with an overlay in the right hand'
  );
  assert.deepEqual(
    addToOverlay('%%score {RH LH}\nK:C\nV:RH\nC D E F & E4\nV:LH clef=bass\nC,4 |]\n'),
    {'0:0': 5, '0:1': 5, '1:0': 5},
    'An overlay before any bar line'
  );
  assert.deepEqual(
    addToOverlay('%%score (S A)\nK:C\nV:S\nC D E F | G4 |]\nV:A\nC4 & E4 | C4 |]\n'),
    {'0:0': 6, '0:1': 6, '0:2': 6},
    'Two voices on one staff, the second with an overlay'
  );
  assert.equal(run('barProblems(ABCJS.parseOnly($("abc").value)[0]).length'), 0);
  // A duet keeps the student's instrument, so on cello both staves are bass staves and c d types C D, as on the
  // Melody template.
  setInstrument('Cello');
  run('dirty = false');
  $('new-score-open').click();
  choose('new-template', 'duet');
  choose('new-bars', '2');
  assert.match($('new-score-summary').textContent, /^Duet: two staves for the current instrument\./);
  submitNewScore();
  assert.equal($('instrument').value, 'Cello');
  assert.deepEqual([...run('renderedTune.lines[0].staff.map(st => st.clef.type)')], ['bass', 'bass']);
  run("scoreKey({key:'c'}); scoreKey({key:'d'})");
  assert.equal($('abc').value.split('\nV:2')[0].split('\n').pop(), 'C D z2 | z4 |]', 'Cello octave on a duet staff');
  assert.equal($('score-caption').textContent, 'Cello · 2 staves · Parts lowered one octave for bass range.');
  setInstrument(instrumentBefore);
  // A lead sheet starts its chord line with the tonic chord, which stays when a note is written over the rest.
  run('dirty = false');
  $('new-score-open').click();
  choose('new-template', 'lead');
  choose('new-key', 'Am');
  choose('new-bars', '2');
  submitNewScore();
  assert.equal($('abc').value.trim().split('\n').pop(), '"Am"z4 | z4 |]');
  run("scoreKey({key:'a'})");
  assert.equal($('abc').value.trim().split('\n').pop(), '"Am"A z3 | z4 |]', 'The chord symbol stays on the beat');
  // Escape closes the panel and returns focus to its button; a cancelled replace keeps the panel and the score.
  $('new-score-open').click();
  $('new-score-panel').dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  assert.equal($('new-score-panel').hidden, true);
  assert.equal(w.document.activeElement, $('new-score-open'));
  $('new-score-open').click();
  w.confirm = () => false;
  submitNewScore();
  w.confirm = () => true;
  assert.equal($('new-score-panel').hidden, false, 'A cancelled replace leaves the panel open');
  assert.ok($('abc').value.includes('"Am"A z3'), 'and the score as it was');
  $('close-new-score').click();
  assert.equal($('new-score-panel').hidden, true);
  run('dirty = false');
  $('new-score').click();
  choose('new-template', 'melody');
  choose('new-key', 'C');
  choose('new-bars', '8');
}

// Backup and restore: the file holds everything on the device; restoring merges, newer copy wins, nothing deleted.
{
  const data = run('backupData()');
  assert.equal(data.app, 'FretFree');
  assert.equal(data.scores.length, run('saved.length'));
  assert.ok(Array.isArray(data.favorites) && Array.isArray(data.played) && typeof data.settings === 'object');
  const mine = run('saved[0]');
  const incoming = {
    app: 'FretFree',
    format: 1,
    scores: [
      {...mine, abc: mine.abc + '\n% older', updated: (mine.updated || 1) - 1},
      {id: 'restored-1', title: 'Restored tune', abc: 'X:1\nT:Restored tune\nM:4/4\nL:1/4\nK:D\nD4 |]', updated: 5}
    ],
    favorites: ['elise', 'elise'],
    played: ['ode'],
    settings: {
      'fretfree-practice-loop': true,
      'fretfree-note-names': 'letters',
      'fretfree-note-colors': 'classroom',
      'fretfree-zoom': 140,
      'fretfree-practice-chords': false
    }
  };
  const before = run('saved.length');
  const summary = run(`applyBackup(${JSON.stringify(incoming)})`);
  assert.equal(summary.added, 1, 'New score added');
  assert.equal(summary.updated, 0, 'An older copy does not replace mine');
  assert.equal(summary.unchanged, 1);
  assert.equal(run('saved.length'), before + 1);
  assert.equal(run('saved.find(x => x.id === saved[0].id).abc').includes('% older'), false, 'My newer copy kept');
  assert.ok(run("favorites.includes('elise')") && run("played.has('ode')"), 'Favorites and played marks merged');
  assert.equal(run("storage.get('fretfree-note-names')"), 'letters', 'Settings restored');
  assert.equal(run("storage.get('fretfree-zoom')"), 140, 'Zoom restored from a backup');
  assert.equal(run("storage.get('fretfree-note-colors')"), 'classroom', 'Classroom colors restored');
  assert.equal(run('backupData().settings')['fretfree-note-colors'], 'classroom', 'Classroom colors backed up');
  assert.equal(run("applyStoredSettings();$('chords').checked"), false, 'The Chords switch restored from a backup');
  assert.equal(run('backupData().settings')['fretfree-practice-chords'], false, 'and backed up');
  const newer = {
    app: 'FretFree',
    format: 1,
    scores: [{...mine, title: 'Renamed elsewhere', updated: Date.now() + 1000}]
  };
  assert.equal(run(`applyBackup(${JSON.stringify(newer)})`).updated, 1, 'A newer copy replaces mine');
  assert.equal(
    run(`saved.find(x => x.id === ${JSON.stringify(mine.id)}).title`),
    'Renamed elsewhere',
    'Newer title restored'
  );
  assert.throws(() => run('applyBackup({app: "Other", scores: []})'), /not a FretFree backup/);
  assert.throws(() => run('applyBackup({app: "FretFree", format: 99, scores: []})'), /newer FretFree/);
  // A damaged file is refused whole rather than partly restored.
  const countBefore = run('saved.length');
  assert.throws(
    () =>
      run(
        'applyBackup({app: "FretFree", format: 1, scores: [{id: "ok", title: "t", abc: "X:1\\nK:C\\nC4|]"}, {id: "bad"}]})'
      ),
    /damaged/
  );
  assert.equal(run('saved.length'), countBefore, 'Nothing restored from a damaged file');
  // A storage failure rolls back and reports instead of leaving memory and storage out of step.
  run('window.__realSet = storage.set; storage.set = () => false');
  assert.throws(
    () =>
      run('applyBackup({app: "FretFree", format: 1, scores: [{id: "fail-1", title: "t", abc: "X:1\\nK:C\\nC4|]"}]})'),
    /could not store/
  );
  run('storage.set = window.__realSet');
  assert.equal(run('saved.length'), countBefore, 'Memory unchanged after a failed restore');
  assert.equal(run('storedList(KEYS.scores).length'), countBefore, 'Storage unchanged after a failed restore');
  // The status compares against what the backup actually holds, not just timestamps.
  run(
    "storage.set('fretfree-last-backup', {at: Date.now(), name: 'old.json', scores: Object.fromEntries(saved.map(x => [x.id, x.updated || 0]))})"
  );
  run('renderBackupStatus()');
  assert.match($('backup-status').textContent, /Everything saved is in that backup/);
  run(
    "applyBackup({app: 'FretFree', format: 1, scores: [{id: 'restored-2', title: 'Old but new here', abc: 'X:1\\nK:C\\nC4|]', updated: 1}]})"
  );
  run('renderBackupStatus()');
  assert.match(
    $('backup-status').textContent,
    /1 score changed since/,
    'A restored score with an old timestamp still counts as not backed up'
  );
  run("saved = saved.filter(x => x.id !== 'restored-2'); storage.set(KEYS.scores, saved)");
  // Leave the saved list as the later tests expect it.
  run("saved = saved.filter(x => x.id !== 'restored-1'); storage.set(KEYS.scores, saved)");
}

// Source editions and saving.
run('openScore(catalog.find(x=>x.pdf))');
assert.equal($('source-edition').hidden, false);
assert.ok($('source-edition').innerHTML.includes('Download PDF'));
$('new-score').click();
assert.equal($('source-edition').hidden, true);
$('title').value = 'My new music';
run("setHeader('T','My new music')");
$('save').click();
assert.equal(run('saved.length'), 2);
$('save').click();
assert.equal(run('saved.length'), 2, 'Saving again updates existing record');
assert.equal(
  JSON.parse(w.localStorage.getItem('commonnote-scores-v1')).length,
  2,
  'Saved scores persist under the legacy key'
);
// MusicXML export from the export bar: a .musicxml download that keeps the edition's credits and the GPL text. A
// concert-pitch instrument names a one-part score; a transposing one does not, since the file is at concert pitch.
{
  const realDownload = run('download');
  w.__downloads = [];
  run('download = (data, name, type) => __downloads.push({data, name, type})');
  run("openScore(catalog.find(x => scoreLicense(x).startsWith('GPL-')))");
  $('instrument').value = 'Violin';
  $('export-musicxml').click();
  const [file] = w.__downloads;
  assert.match(file.name, /\.musicxml$/);
  assert.equal(file.type, 'application/vnd.recordare.musicxml+xml');
  const doc = new w.DOMParser().parseFromString(file.data, 'application/xml');
  assert.equal(doc.querySelector('parsererror'), null);
  assert.equal(doc.querySelector('part-name').textContent, 'Violin');
  assert.ok(doc.querySelector('rights').textContent.includes('GPL-2.0-or-later'));
  assert.ok(file.data.includes('GNU GENERAL PUBLIC LICENSE'));
  assert.equal(doc.querySelector('work-title').textContent, run("field('T')"));
  $('instrument').value = 'Clarinet in B♭';
  $('export-musicxml').click();
  assert.equal(
    new w.DOMParser().parseFromString(w.__downloads[1].data, 'application/xml').querySelector('part-name').textContent,
    'Music'
  );
  run("$('abc').value = 'X:1\\nT:Empty\\nK:C\\n'");
  $('export-musicxml').click();
  assert.equal(w.__downloads.length, 2, 'Nothing to export: no file');
  assert.match($('toast').textContent, /no music to export/);
  w.__realDownload = realDownload;
  run('download = __realDownload');
  $('new-score').click();
}
// Version history: each changed save keeps the copy it replaces; History (n) on My scores lists them newest first with
// times; Preview draws one read-only in written pitch; Restore opens it unsaved under the same score, and saving it
// keeps the replaced copy. Versions travel in backups without duplicates, follow a deleted score out, keep to their
// caps, and never stop a save when storage is full.
{
  const page = boot(),
    {run: r, $: q} = page,
    bars = n => `X:1\nT:Growing tune\nM:4/4\nL:1/4\nK:C\n${Array(n).fill('C D E F').join(' | ')} |]`,
    edit = abc => r(`$('abc').value = ${JSON.stringify(abc)}; changed(); render();`),
    json = s => JSON.parse(r(`JSON.stringify(${s})`)),
    versions = () => json('storedVersions()');
  q('new-score').click();
  edit(bars(1));
  q('save').click();
  const id = r('savedId');
  edit(bars(2));
  q('save').click();
  q('instrument').value = 'Clarinet in B♭';
  edit(bars(3));
  q('save').click();
  assert.equal(r('saved.length'), 1, 'Three saves of one score keep one saved entry');
  assert.deepEqual(
    versions()[id].map(v => v.abc),
    [bars(1), bars(2)],
    'Saving three changed copies keeps the two earlier ones, oldest first'
  );
  const times = versions()[id].map(v => v.at);
  assert.ok(times[0] < times[1] && times[1] < r('saved[0].updated'), 'Each version is timed by its own save');
  assert.equal(versions()[id][0].instrument, 'Flute', 'A version keeps its instrument');
  q('save').click();
  assert.equal(versions()[id].length, 2, 'Saving unchanged music adds no version');
  // A damaged history from an earlier visit is ignored instead of breaking the page.
  assert.deepEqual(json('cleanVersions({a: "x", b: [{at: "1", abc: "X:1"}, null, {at: 5}], c: [1]})'), {});
  assert.equal(
    r(`cleanVersions(JSON.parse('{"__proto__": [{"at": 1, "abc": "X:1"}]}'))['__proto__'].length`),
    1,
    'Any score id is a plain key'
  );
  // History (n) on the card opens the panel, newest first, with times; focus moves to its heading.
  r("show('saved')");
  const history = q('saved-cards').querySelector(`[data-history="${id}"]`);
  assert.equal(history.textContent, 'History (2)');
  assert.equal(history.getAttribute('aria-label'), 'History of Growing tune: 2 earlier versions');
  history.click();
  assert.equal(q('history-panel').hidden, false);
  assert.equal(q('history-heading').textContent, 'History: Growing tune');
  assert.equal(page.w.document.activeElement.id, 'history-heading', 'Focus moves to the history heading');
  const rows = [...q('history-list').querySelectorAll('li')].map(li => li.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^Version 2 · saved .+ · Flute/, 'The newest version comes first');
  assert.match(rows[1], /^Version 1 · saved /);
  assert.ok(
    rows.every(t => t.includes(r(`draftTime(${times[0]})`))),
    'Each row shows when the version was saved'
  );
  assert.match(q('history-current').textContent, /^2 earlier versions\. The saved score is from /);
  // Preview draws the version (as the instrument reads it) without touching the editor.
  const opened = r("$('abc').value");
  q('history-list').querySelector(`[data-version-preview="${times[0]}"]`).click();
  assert.equal(q('history-preview').hidden, false);
  assert.ok(q('history-score').querySelector('svg'), 'Preview engraves the version');
  assert.equal(
    r('historyTune.lines[0].staff[0].voices[0].filter(e => e.el_type === "note").length'),
    4,
    'The preview is version 1, one bar'
  );
  assert.equal(
    q('history-list').querySelector('[aria-pressed="true"]').dataset.versionPreview,
    String(times[0]),
    'The previewed version is marked'
  );
  assert.match(q('history-preview-title').textContent, /^Version 1, saved /);
  assert.equal(r("$('abc').value"), opened, 'Preview leaves the editor alone');
  assert.equal(r('versionSource("X:1\\nK:C\\nC4|]", "Clarinet in B♭")'), 'X:1\nK:D clef=treble\nD4|]');
  // A version saved without an instrument (from an older score or backup) is drawn and played in the score's
  // instrument: here an alto sax part, so concert C is drawn as a written A.
  const keptVersions = r('localStorage.getItem(KEYS.versions)'),
    keptInstrument = r('saved[0].instrument');
  r(`localStorage.setItem(KEYS.versions, JSON.stringify({[savedId]: [{at: 1, abc: 'X:1\\nK:C\\nC4|]'}]}));
     saved[0].instrument = 'Alto sax in E♭';
     previewVersion(1);`);
  assert.equal(r('historyTune.lines[0].staff[0].key.root'), 'A', 'A version without an instrument takes the score’s');
  assert.equal(r('versionInstrument({abc: "X:1", instrument: "Cello"}, saved[0])'), 'Cello');
  r(`saved[0].instrument = ${JSON.stringify(keptInstrument)};
     localStorage.setItem(KEYS.versions, ${JSON.stringify(keptVersions)});
     previewVersion(${times[0]});`);
  // Escape closes the panel and returns focus to the card's History button.
  q('history-panel').dispatchEvent(new page.w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  assert.equal(q('history-panel').hidden, true, 'Escape closes the history');
  assert.equal(page.w.document.activeElement.dataset.history, id, 'Focus returns to History');
  // Restore opens version 1 unsaved under the same score and changes nothing stored.
  page.w.document.activeElement.click();
  q('history-list').querySelector(`[data-version-restore="${times[0]}"]`).click();
  assert.equal(q('studio').hidden, false, 'Restore opens Compose');
  assert.equal(r("$('abc').value"), bars(1));
  assert.equal(q('instrument').value, 'Flute', 'Restore brings back the version’s instrument');
  assert.ok(
    r('dirty') && r(`savedId === ${JSON.stringify(id)}`),
    'The restored version is unsaved work on the same score'
  );
  assert.match(q('save-status').textContent, /^Opened the version saved .+\. Save to make it the current copy/);
  assert.equal(r('saved[0].abc'), bars(3), 'Restoring changes nothing stored');
  assert.equal(versions()[id].length, 2);
  // Saving it makes it the current copy and keeps the copy it replaced.
  q('save').click();
  assert.equal(r('saved[0].abc'), bars(1));
  assert.deepEqual(
    versions()[id].map(v => v.abc),
    [bars(1), bars(2), bars(3)],
    'Restore, then Save, keeps the replaced version in the list'
  );
  assert.equal(versions()[id][2].instrument, 'Clarinet in B♭');
  r("show('saved')");
  assert.equal(q('saved-cards').querySelector('[data-history]').textContent, 'History (3)');
  // Backups carry the versions; restoring the same file adds none, and a version from elsewhere is unioned in.
  const backup = JSON.parse(JSON.stringify(r('backupData()')));
  assert.equal(backup.versions[id].length, 3, 'Versions travel in backups');
  assert.equal(r(`applyBackup(${JSON.stringify(backup)})`).versionsAdded, 0);
  assert.equal(versions()[id].length, 3, 'Restoring the same backup adds no duplicates');
  const elsewhere = {
    ...backup,
    versions: {
      [id]: [...backup.versions[id], {at: times[0] - 5, abc: bars(4), instrument: 'Violin'}],
      'no-such-score': [{at: 1, abc: bars(1)}]
    }
  };
  const summary = r(`applyBackup(${JSON.stringify(elsewhere)})`);
  assert.equal(summary.versionsAdded, 1);
  assert.match(r(`restoreSummary(${JSON.stringify(summary)})`), /1 earlier version added/);
  assert.deepEqual(
    versions()[id].map(v => v.abc),
    [bars(4), bars(1), bars(2), bars(3)],
    'Versions merge by time without duplicates'
  );
  assert.equal(versions()['no-such-score'], undefined, 'Versions of scores this device lacks are left out');
  // A newer copy from a backup replaces mine, and mine becomes a version.
  const mine = r('saved[0]');
  r(
    `applyBackup(${JSON.stringify({app: 'FretFree', format: 1, scores: [{...mine, abc: bars(5), updated: mine.updated + 10}]})})`
  );
  assert.equal(r('saved[0].abc'), bars(5));
  assert.equal(versions()[id].at(-1).abc, bars(1), 'The copy a newer backup replaces is kept as a version');
  // Caps: 20 versions per score, about 1.5 MB in all, oldest dropped first.
  for (let n = 6; n < 30; n++) {
    r('dirty = false');
    edit(bars(n));
    q('save').click();
  }
  assert.equal(versions()[id].length, 20, 'At most 20 versions per score');
  assert.equal(versions()[id].at(-1).abc, bars(28), 'The newest versions are kept');
  const big = {
    a: Array.from({length: 10}, (_, i) => ({at: 1000 + i, abc: 'x'.repeat(100000)})),
    b: Array.from({length: 10}, (_, i) => ({at: 2000 + i, abc: 'y'.repeat(100000)}))
  };
  const trimmed = json(`trimVersions(${JSON.stringify(big)})`);
  assert.ok(r(`versionsSize(${JSON.stringify(trimmed)})`) <= 1.5 * 1024 * 1024, 'Versions keep to about 1.5 MB');
  assert.equal(trimmed.b.length, 10, 'The oldest versions go first');
  assert.equal(trimmed.a.length, 5);
  assert.equal(trimmed.a[0].at, 1005);
  // Storage full: the oldest versions make room, so the save itself goes through.
  r(
    `localStorage.setItem(KEYS.versions, JSON.stringify(${JSON.stringify({...versions(), other: [{at: 5, abc: 'z'.repeat(50000)}]})}))`
  );
  // A quota just above what is stored now: the bigger score does not fit until versions give way.
  r(`window.__realSet = storage.set;
     window.__used = () => Object.values({...localStorage}).join('').length;
     const quota = __used() + 50;
     storage.set = (key, value) => {
       const items = {...localStorage, [key]: JSON.stringify(value)};
       return Object.values(items).join('').length > quota ? false : __realSet(key, value);
     };`);
  edit(bars(40));
  q('save').click();
  assert.match(q('save-status').textContent, /^Saved on this device/, 'A full storage still saves the score');
  assert.equal(r('saved[0].abc'), bars(40));
  assert.equal(versions().other, undefined, 'The oldest version made room');
  assert.equal(versions()[id].at(-1).abc, bars(29), 'Newer versions stay');
  // Restoring a backup when storage is short: the oldest versions make room for the restored scores, as when saving,
  // and a restore that fails anyway puts them back with everything else.
  const fromBackup = JSON.stringify({
      app: 'FretFree',
      format: 1,
      scores: [{id: 'from-backup', title: 'From a backup', abc: bars(30), updated: 5}]
    }),
    stored = key => r(`localStorage.getItem(KEYS.${key})`),
    before = {scores: stored('scores'), versions: stored('versions')};
  r(`const restoreQuota = __used() + 200;
     window.__quotaSet = (key, value) => {
       const items = {...localStorage, [key]: JSON.stringify(value)};
       return Object.values(items).join('').length > restoreQuota ? false : __realSet(key, value);
     };
     storage.set = (key, value) => (key === KEYS.played ? false : __quotaSet(key, value));`);
  assert.throws(() => r(`applyBackup(${fromBackup})`), /Nothing was changed/);
  assert.deepEqual(
    {scores: stored('scores'), versions: stored('versions')},
    before,
    'A failed restore puts back the versions that made room'
  );
  assert.equal(r('saved.length'), 1);
  r('storage.set = __quotaSet');
  r(`applyBackup(${fromBackup})`);
  assert.deepEqual(
    json('saved.map(x => x.id)'),
    [id, 'from-backup'],
    'The oldest versions make room for a restored score'
  );
  assert.ok(versions()[id].length < 20 && versions()[id].at(-1).abc === bars(29), 'The newest versions stay');
  r(`localStorage.setItem(KEYS.scores, ${JSON.stringify(before.scores)}); saved = storedList(KEYS.scores);`);
  // A version that does not fit is dropped, and the save still counts.
  r('storage.set = (key, value) => (key === KEYS.versions ? false : __realSet(key, value))');
  edit(bars(41));
  q('save').click();
  assert.equal(r('saved[0].abc'), bars(41), 'Saving never fails because of versions');
  assert.equal(r('localStorage.getItem(KEYS.versions)'), null, 'Versions that cannot be stored are let go');
  r('storage.set = __realSet');
  // A save that fails even once every version has made room puts the versions back: dropping them gained nothing.
  edit(bars(42));
  q('save').click();
  r(`storage.set(KEYS.versions, {...storedVersions(), other: [{at: 5, abc: 'X:1'}]})`);
  const allVersions = r('localStorage.getItem(KEYS.versions)');
  r('storage.set = (key, value) => (key === KEYS.scores ? false : __realSet(key, value))');
  edit(bars(43));
  q('save').click();
  r('storage.set = __realSet');
  assert.match(q('save-status').textContent, /^This browser could not save/);
  assert.equal(r('saved[0].abc'), bars(42), 'The failed save changes nothing saved');
  assert.equal(r('localStorage.getItem(KEYS.versions)'), allVersions, 'A failed save keeps every version');
  // Deleting a score deletes its versions and no others.
  r("show('saved')");
  assert.equal(versions()[id].length, 1);
  q('saved-cards').querySelector(`[data-delete="${id}"]`).click();
  assert.equal(r('saved.length'), 0);
  assert.equal(versions()[id], undefined, 'Deleting a score deletes its versions');
  assert.equal(versions().other.length, 1, 'Other scores keep theirs');
}
// Share by link without CompressionStream (jsdom): the plain-encoded link opens as a shared copy with the edition's credits.
(async () => {
  const link = await run(
    'encodeShare({v:1,a:catalog.find(x=>x.id==="ode").abc.replace("T:Ode to Joy","T:Ode (shared)"),i:"Violin",s:"ode"})'
  );
  assert.equal(link[0], '0', 'Falls back to plain base64url without CompressionStream');
  assert.equal(await run(`openSharedLink("s=${link}")`), true);
  assert.equal($('title').value, 'Ode (shared)');
  assert.equal($('instrument').value, 'Violin');
  assert.equal(run('current.kind'), 'shared');
  assert.equal(run('dirty'), true, 'A shared copy counts as unsaved work until it is saved');
  assert.match($('save-status').textContent, /not yet saved/);
  assert.ok($('rights').textContent.includes('CC0'), 'Credits travel with the link');
  assert.equal($('next-up').hidden, true, 'No suggestions for a shared copy');
  assert.equal(await run('openSharedLink("s=1garbage")'), false, 'A damaged link is refused');

  // Embed code and QR code. The Embed tab's snippet carries the link's own payload as #e=, with sizes kept in range and
  // the title escaped; the tabs follow the ARIA pattern; the QR code draws the vendored encoder's modules exactly, and
  // a link too long for a QR code gets a note instead.
  {
    run('dirty = false');
    const nc = run('catalog.find(x => nonCommercial(x)).id');
    run(`openScore(catalog.find(x => x.id === ${JSON.stringify(nc)}))`);
    $('abc').value = $('abc').value.replace(/^T:.*$/m, 'T:Tom & "Jerry" <reel>');
    run('changed(); clearTimeout(renderTimer); render()');
    await run('shareLink()');
    const url = $('share-url').value,
      code = url.split('#s=')[1];
    assert.deepEqual(
      [$('share-tab-link').getAttribute('aria-selected'), $('share-pane-link').hidden, $('share-pane-embed').hidden],
      ['true', false, true],
      'The panel opens on the Link tab'
    );
    $('share-tab-embed').click();
    assert.deepEqual(
      [
        $('share-pane-link').hidden,
        $('share-pane-embed').hidden,
        $('share-tab-embed').tabIndex,
        $('share-tab-link').tabIndex
      ],
      [true, false, 0, -1],
      'The Embed tab shows its pane and takes the tab stop'
    );
    assert.equal(
      $('embed-code').value,
      `<iframe src="http://localhost:8000/#e=${code}" width="100%" height="420" title="Score: Tom &amp; &quot;Jerry&quot; &lt;reel&gt;" loading="lazy"></iframe>`
    );
    // A value the snippet cannot use is replaced, and its field is marked invalid.
    for (const [width, height, expected, invalid] of [
      ['640', '300', 'width="640" height="300"', 'false false'],
      ['640px', '2000', 'width="640" height="2000"', 'false false'],
      [' 80% ', '50', 'width="80%" height="200"', 'false true'],
      ['150%', '99999', 'width="100%" height="2000"', 'true true'],
      ['wide', '', 'width="100%" height="420"', 'true true']
    ]) {
      $('embed-width').value = width;
      $('embed-height').value = height;
      $('embed-width').dispatchEvent(new w.Event('input'));
      assert.ok(
        $('embed-code').value.includes(expected),
        `Size ${width} × ${height}: ${$('embed-code').value.slice(-90)}`
      );
      assert.equal(
        `${$('embed-width').getAttribute('aria-invalid')} ${$('embed-height').getAttribute('aria-invalid')}`,
        invalid,
        `Size ${width} × ${height} marks the fields it replaces`
      );
    }
    $('embed-width').value = '100%';
    $('embed-height').value = '420';
    // The snippet keeps the title of the score that was shared, even if the title is edited afterwards.
    const sharedABC = $('abc').value;
    $('abc').value = sharedABC.replace(/^T:.*$/m, 'T:Renamed later');
    $('embed-height').dispatchEvent(new w.Event('input'));
    assert.match($('embed-code').value, /title="Score: Tom &amp; &quot;Jerry&quot; &lt;reel&gt;"/);
    $('abc').value = sharedABC;
    const key = (id, k) => $(id).dispatchEvent(new w.KeyboardEvent('keydown', {key: k, bubbles: true}));
    key('share-tab-embed', 'ArrowRight');
    assert.equal(w.document.activeElement.id, 'share-tab-qr', 'ArrowRight moves to the QR code tab');
    key('share-tab-qr', 'ArrowRight');
    assert.equal(w.document.activeElement.id, 'share-tab-link', 'and wraps round to Link');
    key('share-tab-link', 'End');
    assert.equal($('share-pane-qr').hidden, false, 'End opens the last tab');
    const svg = $('share-qr').querySelector('svg');
    assert.ok(svg && !$('share-qr').hidden, 'A typical tune gets a QR code');
    assert.equal(svg.getAttribute('role'), 'img');
    assert.match(svg.getAttribute('aria-label'), /^QR code of the link to Tom & "Jerry"/);
    const dark = run(`(() => {
      const q = qrcode(0, 'M');
      q.addData(${JSON.stringify(url)});
      q.make();
      const cells = [];
      for (let y = 0; y < q.getModuleCount(); y++)
        for (let x = 0; x < q.getModuleCount(); x++) if (q.isDark(y, x)) cells.push((x + 4) + ',' + (y + 4));
      return {count: q.getModuleCount(), cells: cells.join(' ')};
    })()`);
    assert.equal(svg.getAttribute('viewBox'), `0 0 ${dark.count + 8} ${dark.count + 8}`, 'Four modules of quiet zone');
    const drawn = [];
    for (const [, x, y, run] of svg
      .querySelector('path')
      .getAttribute('d')
      .matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g))
      for (let i = 0; i < +run; i++) drawn.push(+x + i + ',' + y);
    assert.equal(
      drawn.sort().join(' '),
      dark.cells.split(' ').sort().join(' '),
      'Every dark module is drawn, and nothing else'
    );
    assert.match($('qr-note').textContent, /^Scan it/);
    assert.equal(/dense code/.test($('qr-note').textContent), url.length > run('QR_DENSE_BYTES'));
    // The code is drawn at 3px per module, at least 280px: a typical tune's code at 280px, a dense one larger.
    assert.equal(svg.getAttribute('width'), String(Math.max(280, 3 * (dark.count + 8))));
    assert.equal(svg.getAttribute('height'), svg.getAttribute('width'));
    const modules = n =>
      run(`(() => { const q = qrcode(0, 'M'); q.addData('x'.repeat(${n})); q.make(); return q.getModuleCount(); })()`);
    assert.deepEqual(
      [modules('QR_DENSE_BYTES'), modules('QR_DENSE_BYTES + 1')],
      [117, 121],
      'QR_DENSE_BYTES is the most a version 25 code holds'
    );
    for (const [length, size, dense] of [
      [run('QR_DENSE_BYTES'), (117 + 8) * 3, false],
      [run('QR_MAX_BYTES'), (177 + 8) * 3, true]
    ]) {
      const long = 'http://localhost:8000/#s=' + 'x'.repeat(length - 25);
      run(`updateShareQR(${JSON.stringify(long)})`);
      assert.equal(
        $('share-qr').querySelector('svg').getAttribute('width'),
        String(size),
        `A ${length}-character link's code is ${size}px`
      );
      assert.equal(/dense code/.test($('qr-note').textContent), dense, $('qr-note').textContent);
    }
    assert.match(
      $('qr-note').textContent,
      /This long link makes a dense code: if a camera can’t read it, share the link/
    );
    run(`updateShareQR(${JSON.stringify(url)})`);
    $('abc').value = $('abc').value.replace(/^K:.*$/m, line => line + '\n% ' + 'a'.repeat(2400));
    run('changed(); clearTimeout(renderTimer); render()');
    await run('shareLink()');
    assert.equal($('share-qr').hidden, true, 'No QR code for a link longer than one holds');
    assert.match($('qr-note').textContent, /too long for a QR code: [\d,]+ characters/);
    assert.equal(run('qrSVG("x".repeat(QR_MAX_BYTES + 1), "")'), null, 'The encoder refuses what does not fit');
    assert.ok(run('qrSVG("x".repeat(QR_MAX_BYTES), "")'), 'The longest link that fits is drawn');
    $('share-close').click();
    run('dirty = false');
    // Opening another score closes the panel, so its link, embed code and QR code never describe a different score.
    run('openScore(catalog[0])');
    await run('shareLink()');
    assert.equal($('share-panel').hidden, false);
    run('openScore(catalog[5])');
    assert.deepEqual(
      [$('share-panel').hidden, run('shareCode'), $('share-url').value, $('embed-code').value, $('share-qr').innerHTML],
      [true, '', '', '', ''],
      'Opening another score closes and clears the share panel'
    );
    $('embed-width').value = '600';
    $('embed-width').dispatchEvent(new w.Event('input'));
    assert.equal($('embed-code').value, '', 'A closed panel makes no embed code');
    await run('shareLink()');
    const second = await run(`decodeShare(${JSON.stringify($('share-url').value.split('#s=')[1])})`);
    assert.equal(second.a, run('catalog[5].abc'), 'Sharing again carries the open score');
    assert.ok(
      $('embed-code').value.includes(`#e=${$('share-url').value.split('#s=')[1]}" width="600"`) &&
        $('embed-code').value.includes(`title="${run('esc("Score: " + field("T"))')}"`),
      'The embed code and its title come from the same score'
    );
    $('embed-width').value = '100%';
    // A link still being made when another score opens is dropped rather than shown for the new score.
    const pending = run('shareLink()');
    run('openScore(catalog[0])');
    await pending;
    assert.deepEqual(
      [$('share-panel').hidden, run('shareCode')],
      [true, ''],
      'A share overtaken by another score is dropped'
    );

    // The embed route (#e=): the score alone, read-only, with its credits and NC label, a link that opens an editable
    // copy, and no storage read or written. A damaged embed says so.
    const before = storage => {
      storage.setItem(
        'commonnote-scores-v1',
        JSON.stringify([{id: 'mine', title: 'Mine', abc: 'X:1\nT:Mine\nK:C\nC4 |]', updated: 1}])
      );
      storage.setItem('fretfree-played', '["ode"]');
    };
    const page = boot(before, 'http://localhost:8000/index.html#e=' + code),
      snapshot = () => JSON.stringify({...page.w.localStorage});
    for (let i = 0; i < 100 && page.run('current?.kind') !== 'shared'; i++) await new Promise(r => setTimeout(r, 20));
    const stored = snapshot();
    assert.deepEqual(
      [
        page.w.document.body.classList.contains('embed'),
        page.$('studio').hidden,
        page.$('library').hidden,
        page.$('embed-bar').hidden,
        page.$('embed-title').textContent,
        page.w.document.title,
        page.w.location.hash.startsWith('#e='),
        page.$('embed-open').href,
        page.$('embed-open').target,
        page.$('notation').hasAttribute('tabindex'),
        page.$('cards').children.length
      ],
      [
        true,
        false,
        true,
        false,
        'Tom & "Jerry" <reel>',
        'Tom & "Jerry" <reel> · FretFree',
        true,
        'http://localhost:8000/index.html#s=' + code,
        '_blank',
        false,
        0
      ],
      'The embed shows the score alone, keeps its address and links to an editable copy'
    );
    assert.match(page.$('rights').textContent, /NON-COMMERCIAL EDITION/, 'The embed shows the NC label');
    assert.match(page.$('rights').textContent, /Non-commercial edition: free to use/);
    assert.ok(page.$('notation').querySelector('svg'), 'The score is engraved');
    assert.deepEqual(
      [page.run('engraveOptions().selectTypes'), page.run('engraveOptions().clickListener'), page.run('dirty')],
      [false, undefined, false],
      'Nothing on the embedded score can be selected or dragged, and it is not unsaved work'
    );
    assert.deepEqual(
      [page.run('saved.length'), page.run('played.size'), page.$('draft-banner').hidden],
      [0, 0, true],
      'The embed reads no saved scores, played marks or drafts'
    );
    page.run('render(); flushDraft()');
    page.w.dispatchEvent(new page.w.Event('pagehide'));
    page.$('speed').value = 80;
    page.$('speed').oninput();
    assert.equal(snapshot(), stored, 'The embed writes nothing to storage');
    // A transposing instrument's part is drawn in written pitch, so the embed names the part and how it sounds.
    const clarinetCode = await run(`encodeShare({v: 1, a: catalog[0].abc, i: 'Clarinet in B♭', s: catalog[0].id})`),
      clarinet = boot(() => {}, 'http://localhost:8000/#e=' + clarinetCode);
    for (let i = 0; i < 100 && clarinet.run('current?.kind') !== 'shared'; i++)
      await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(
      [
        clarinet.$('embed-part').hidden,
        clarinet.$('embed-part').textContent,
        clarinet.$('notation').getAttribute('aria-label'),
        clarinet.run('writtenABC()').match(/^K:(\S+)/m)[1]
      ],
      [
        false,
        'Clarinet in B♭ part, in written pitch: it sounds a major 2nd lower.',
        'Score: Ode to Joy. Clarinet in B♭ part, in written pitch: it sounds a major 2nd lower. Read-only; press Play to hear it.',
        'D'
      ],
      'The embed names a transposing part'
    );
    assert.equal(
      clarinet.run(`embedPart('Alto sax in E♭')`),
      'Alto sax in E♭ part, in written pitch: it sounds a major 6th lower.'
    );
    assert.deepEqual(
      ['Flute', 'Cello', 'Piano', 'Guitar'].map(name => clarinet.run(`embedPart(${JSON.stringify(name)})`)),
      ['', '', '', ''],
      'Parts that sound as written are not labeled'
    );
    const damaged = boot(() => {}, 'http://localhost:8000/#e=1garbage');
    for (let i = 0; i < 100 && !damaged.w.document.body.classList.contains('embed-unreadable'); i++)
      await new Promise(r => setTimeout(r, 20));
    assert.equal(damaged.$('embed-title').textContent, 'This embedded score could not be read.');
    assert.equal(damaged.$('embed-open').hidden, true);
    assert.equal(damaged.$('library').hidden, true, 'A damaged embed does not fall back to the library');
  }

  // Teacher-written assignments: the builder takes its defaults from the score, three goals become a live checklist,
  // the link carries the assignment as q (never p), and the student's copy keeps it through save, reopen and backup.
  run(
    'dirty = false; openScore({kind: "personal", abc: "X:1\\nT:Starter\\nM:3/4\\nL:1/4\\nQ:1/4=90\\nK:G\\nG A B | z3 | z3 | z3 |]"})'
  );
  $('open-assignment').click();
  assert.equal($('assignment-builder').hidden, false);
  assert.equal($('open-assignment').getAttribute('aria-expanded'), 'true');
  assert.equal($('assignment-title').value, 'Starter', 'Title defaults to the score title');
  assert.match($('assignment-basis').textContent, /4 bars · 3\/4 · key of G/);
  assert.deepEqual(
    [...$('assignment-goals').querySelectorAll('[data-goal]:checked')].map(b => b.dataset.goal),
    ['bars', 'end', 'inKey'],
    'Three goals are ticked by default'
  );
  assert.equal($('goal-inKey').parentElement.textContent.trim(), 'Stay in G major');
  $('assignment-title').value = '';
  $('assignment-apply').click();
  assert.match($('assignment-status').textContent, /title/, 'A title is required');
  $('assignment-title').value = 'Echo <img src=x onerror=alert(1)>';
  $('assignment-text').value = 'Answer my phrase.\nEnd on G.';
  $('goal-inKey').checked = false;
  $('goal-start-degree').value = '0';
  $('goal-start-degree').dispatchEvent(new w.Event('input', {bubbles: true}));
  assert.equal($('goal-start').checked, true, 'Changing a goal setting ticks the goal');
  $('assignment-apply').click();
  assert.equal($('assignment-builder').hidden, true);
  assert.equal(run('current.prompt.level'), 'Custom');
  assert.equal(
    run('current.prompt.goals.map(g => g.label).join(" / ")'),
    'Fill all 4 bars with notes / Start on G / End on G'
  );
  assert.equal(run('dirty'), true, 'Adding an assignment is an unsaved change');
  const check = $('prompt-check');
  assert.equal(check.hidden, false);
  assert.equal(check.querySelectorAll('li').length, 3, 'A checklist of the three goals');
  assert.equal(check.querySelector('img'), null, 'The title is escaped');
  assert.match(check.textContent, /Assignment · Echo <img src=x onerror=alert\(1\)>/);
  assert.equal(check.querySelector('.prompt-text').textContent, 'Answer my phrase.\nEnd on G.');
  assert.equal(check.querySelectorAll('li.met').length, 1, 'The starter music already starts on G');
  // The share link carries the assignment whole as q, and payload v stays 1.
  await run('shareLink()');
  const assignmentLink = $('share-url').value.split('#')[1];
  const payload = await run(`decodeShare(${JSON.stringify(assignmentLink.slice(2))})`);
  assert.equal(payload.v, 1);
  assert.equal(payload.p, undefined, 'A custom assignment is not sent as a built-in prompt id');
  assert.equal(payload.q.id, run('current.prompt.id'));
  // A student opens it: the instructions and the checklist arrive with the music.
  run('dirty = false; newScore()');
  assert.equal(check.hidden, true);
  assert.equal(await run(`openSharedLink(${JSON.stringify(assignmentLink)})`), true);
  assert.equal(run('current.kind'), 'shared');
  assert.equal(run('current.prompt.title'), 'Echo <img src=x onerror=alert(1)>');
  assert.equal($('prompt-check').querySelectorAll('li').length, 3);
  assert.match($('toast').textContent, /Opened an assignment/);
  assert.match($('abc').value, /G A B \| z3/, "The teacher's music is the starting point");
  // Saved to My scores, reopened, backed up and restored: the assignment stays with the score.
  $('save').click();
  const id = run('savedId'),
    find = `saved.find(x => x.id === ${JSON.stringify(id)})`;
  assert.equal(run(`${find}.prompt.title`), 'Echo <img src=x onerror=alert(1)>');
  run('dirty = false; newScore(); show("saved")');
  assert.match($('saved-cards').textContent, /ASSIGNMENT/, 'My scores marks the assignment');
  assert.equal($('saved-cards').querySelector('img'), null);
  $('saved-cards').querySelector(`[data-saved="${id}"]`).click();
  assert.equal($('prompt-check').querySelectorAll('li').length, 3, 'Reopened from My scores with its checklist');
  const backup = JSON.parse(JSON.stringify(run('backupData()')));
  run(`saved = saved.filter(x => x.id !== ${JSON.stringify(id)}); storage.set(KEYS.scores, saved)`);
  assert.equal(run(`applyBackup(${JSON.stringify(backup)})`).added, 1);
  run(`dirty = false; newScore(); openScore(${find}, ${JSON.stringify(id)})`);
  assert.equal($('prompt-check').querySelectorAll('li').length, 3, 'Restored from a backup with its checklist');
  // A tampered assignment in storage or a link is ignored; the music still opens.
  run(`dirty = false; openScore({...${find}, prompt: {...${find}.prompt, goals: [{type: 'rm -rf', label: 'x'}]}})`);
  assert.equal($('prompt-check').hidden, true, 'An invalid stored assignment shows no checklist');
  const tampered = await run(`encodeShare({v: 1, a: $('abc').value, q: {...${find}.prompt, text: 'y'.repeat(5000)}})`);
  run('dirty = false');
  assert.equal(await run(`openSharedLink("s=${tampered}")`), true, 'The score still opens');
  assert.equal(run('current.prompt'), undefined);
  assert.equal($('prompt-check').hidden, true);
  assert.match($('toast').textContent, /assignment could not be read/);
  // Built-in prompt links (p) still work and still travel as p; an object smuggled in p is ignored.
  const builtIn = await run(`encodeShare({v: 1, a: promptSource(promptById('first-melody')), p: 'first-melody'})`);
  run('dirty = false');
  await run(`openSharedLink("s=${builtIn}")`);
  assert.equal(run('current.prompt'), 'first-melody');
  assert.match($('prompt-check').textContent, /Writing prompt · My first melody/);
  await run('shareLink()');
  const again = await run(`decodeShare(${JSON.stringify($('share-url').value.split('#s=')[1])})`);
  assert.deepEqual([again.p, again.q], ['first-melody', undefined], 'Built-in prompts still travel as p');
  const smuggled = await run(`encodeShare({v: 1, a: $('abc').value, p: ${JSON.stringify(payload.q)}})`);
  run('dirty = false');
  await run(`openSharedLink("s=${smuggled}")`);
  assert.equal(run('current.prompt'), undefined, 'p must name a built-in prompt');
  // The builder reopens with the score's assignment, and Remove assignment takes it off.
  run('dirty = false');
  await run(`openSharedLink(${JSON.stringify(assignmentLink)})`);
  $('open-assignment').click();
  assert.equal($('assignment-remove').hidden, false);
  assert.equal($('assignment-title').value, 'Echo <img src=x onerror=alert(1)>');
  assert.deepEqual([$('goal-start').checked, $('goal-inKey').checked], [true, false]);
  $('assignment-remove').click();
  assert.equal(run('"prompt" in current'), false);
  assert.equal($('prompt-check').hidden, true);
  // The builder describes the score it was opened on: opening another score closes it, so its title, bar count and
  // note names are never read back against a different score.
  const checkedGoals = () =>
    [...$('assignment-goals').querySelectorAll('[data-goal]:checked')].map(b => b.dataset.goal);
  run('dirty = false; openScore({kind: "personal", abc: "X:1\\nT:First\\nM:4/4\\nL:1/4\\nK:G\\nG A B c | d4 |]"})');
  $('open-assignment').click();
  $('goal-end-degree').value = '7';
  run('dirty = false; openScore(catalog.find(x => x.id === "elise"))');
  assert.equal($('assignment-builder').hidden, true, 'Opening another score closes the builder');
  assert.equal($('open-assignment').getAttribute('aria-expanded'), 'false');
  // Für Elise starts with a pickup, which is never a full bar, so the bars goal could not be met: it is not offered.
  $('open-assignment').click();
  assert.equal($('assignment-title').value, run('field("T")'), 'Reopened with the new score');
  assert.match($('assignment-basis').textContent, /9 bars · 3\/4 · key of A minor/);
  assert.deepEqual([$('goal-bars').checked, $('goal-bars').disabled], [false, true], 'No bars goal over a pickup');
  assert.match($('goal-bars').parentElement.textContent, /Fill all 9 bars with notes \(only scores whose bars are all/);
  assert.deepEqual(checkedGoals(), ['end', 'inKey']);
  assert.equal($('goal-end-degree').selectedOptions[0].textContent, 'A (home note)');
  // The builder follows edits while it is open: with the pickup and the short last bar made whole, the goal returns.
  run(
    'dirty = false; openScore({kind: "personal", abc: "X:1\\nT:Pickup\\nM:4/4\\nL:1/4\\nK:D\\nA | d2 f2 | a4 | f2 d2 | d3 |]"})'
  );
  $('open-assignment').click();
  assert.match($('assignment-basis').textContent, /5 bars · 4\/4 · key of D/);
  assert.equal($('goal-bars').disabled, true, 'A short pickup and closing bar rule out the bars goal');
  $('abc').value = $('abc').value.replace('A | d2 f2', 'z3 A | d2 f2').replace('d3 |]', 'd4 |]');
  run('render()');
  assert.equal($('goal-bars').disabled, false);
  assert.equal($('goal-bars').parentElement.textContent.trim(), 'Fill all 5 bars with notes');
  // An instrument change while it is open redraws the note names in the new written key. A note choice keeps its
  // place above the key note, so concert A chosen on flute is the clarinet's written B.
  $('goal-end-degree').value = '7';
  $('goal-bars').checked = true;
  $('instrument').value = 'Clarinet in B♭';
  $('instrument').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 300));
  assert.match($('assignment-basis').textContent, /key of E \(written\)/);
  assert.equal($('goal-end-degree').selectedOptions[0].textContent, 'B');
  assert.equal($('goal-inKey').parentElement.textContent.trim(), 'Stay in E major');
  $('assignment-apply').click();
  assert.equal(run('current.prompt.key'), 'E', 'The assignment is in the written key');
  assert.equal(
    run('current.prompt.goals.map(g => g.label).join(" / ")'),
    'Fill all 5 bars with notes / End on B / Stay in E major'
  );
  assert.equal($('prompt-check').querySelectorAll('li.met').length, 2, 'The teacher’s own music meets them');
  // A key written with a spaced mode is read with its mode, on every instrument.
  run(
    'dirty = false; openScore({kind: "personal", instrument: "Flute", abc: "X:1\\nT:Minor\\nM:4/4\\nL:1/4\\nK:A minor\\nA B c d | e4 |]"})'
  );
  $('open-assignment').click();
  assert.match($('assignment-basis').textContent, /key of A minor/);
  assert.equal($('goal-inKey').parentElement.textContent.trim(), 'Stay in A minor');
  const names = () => [...$('goal-end-degree').options].map(o => o.textContent.replace(' (home note)', '')).join(' ');
  assert.equal(names(), 'A B C D E F G G♯');
  $('instrument').value = 'Clarinet in B♭';
  run('render()');
  assert.equal($('goal-inKey').parentElement.textContent.trim(), 'Stay in B minor');
  assert.equal(names(), 'B C♯ D E F♯ G A A♯');
  $('assignment-apply').click();
  assert.equal(run('current.prompt.key'), 'Bm');
  assert.match(run('current.prompt.goals.map(g => g.label).join(" / ")'), /End on B \/ Stay in B minor/);
  // One bar is "the bar"; a score with no bars has none to fill.
  run(
    'dirty = false; openScore({kind: "personal", instrument: "Flute", abc: "X:1\\nT:One\\nM:4/4\\nL:1/4\\nK:G\\nG4 |]"})'
  );
  $('open-assignment').click();
  assert.equal($('goal-bars').parentElement.textContent.trim(), 'Fill the bar with notes');
  run(
    'dirty = false; openScore({kind: "personal", instrument: "Flute", abc: "X:1\\nT:Empty\\nM:4/4\\nL:1/4\\nK:G\\n"})'
  );
  $('open-assignment').click();
  assert.equal($('goal-bars').disabled, true, 'An empty score has no bars to fill');
  // After Use and copy link, focus returns to ✎ Assignment when the link was copied, or goes to the link when not.
  Object.defineProperty(w.navigator, 'clipboard', {configurable: true, value: {writeText: async () => {}}});
  run('dirty = false; newScore(4)');
  $('open-assignment').click();
  $('assignment-form').querySelector('[type="submit"]').focus();
  $('assignment-form').requestSubmit();
  for (let i = 0; i < 100 && !$('toast').textContent.includes('Link copied'); i++)
    await new Promise(r => setTimeout(r, 20));
  assert.match($('toast').textContent, /Link copied/);
  assert.equal(w.document.activeElement.id, 'open-assignment', 'Focus returns to the button');
  delete w.navigator.clipboard;
  $('open-assignment').click();
  $('assignment-form').requestSubmit();
  for (let i = 0; i < 100 && w.document.activeElement.id !== 'share-url'; i++)
    await new Promise(r => setTimeout(r, 20));
  assert.equal(w.document.activeElement.id, 'share-url', 'Without a clipboard the link is selected to copy by hand');
  run('dirty = false');

  // Turning in and the Submissions inbox. The student turns in with their name (remembered), the link carries n, t, x
  // and g at payload v 1, and opening it shows who turned it in, with the checklist. Thirty links pasted into the inbox
  // list as thirty rows under their assignment and bad lines are reported; Previous and Next step through the class,
  // feedback reaches the student in a return link, and the inbox is capped, backed up and restored.
  const until = async test => {
    for (let i = 0; i < 200 && !test(); i++) await new Promise(r => setTimeout(r, 20));
  };
  run(
    'dirty = false; openScore({kind: "personal", instrument: "Flute", abc: "X:1\\nT:Steps\\nM:4/4\\nL:1/4\\nK:C\\nz4 | z4 |]"})'
  );
  assert.equal($('turn-in').hidden, true, 'No Turn in without an assignment');
  $('open-assignment').click();
  $('assignment-apply').click();
  assert.equal($('turn-in').hidden, false, 'Turn in shows on an assignment');
  const stepsId = run('current.prompt.id');
  await run('shareLink()');
  const handout = $('share-url').value.split('#')[1];
  run('dirty = false');
  await run(`openSharedLink(${JSON.stringify(handout)})`);
  run(
    "$('abc').value = $('abc').value.replace('z4 | z4', 'E D C D | E D D C'); changed(); clearTimeout(renderTimer); render()"
  );
  $('turn-in').click();
  assert.deepEqual(
    [$('turn-in-panel').hidden, $('turn-in').getAttribute('aria-expanded'), w.document.activeElement.id],
    [false, 'true', 'student-name']
  );
  assert.equal($('turn-in-summary').textContent, 'Assignment: Steps. 3 of 3 goals met.');
  $('student-name').value = '   ';
  $('turn-in-form').requestSubmit();
  assert.match($('turn-in-status').textContent, /Write your name/, 'A name is required');
  assert.equal($('turn-in-result').hidden, true);
  $('student-name').value = 'Ana <img src=x onerror=alert(1)>';
  $('turn-in-form').requestSubmit();
  await until(() => !$('turn-in-result').hidden);
  assert.equal(
    JSON.parse(w.localStorage.getItem('fretfree-student-name')),
    'Ana <img src=x onerror=alert(1)>',
    'The name is remembered'
  );
  await until(() => w.document.activeElement.id === 'turn-in-url');
  assert.equal(w.document.activeElement.id, 'turn-in-url', 'Without a clipboard the link is selected to copy by hand');
  assert.match($('toast').textContent, /Select the link and copy it/);
  const turnInLink = $('turn-in-url').value.split('#')[1],
    sent = await run(`decodeShare(${JSON.stringify(turnInLink.slice(2))})`);
  assert.deepEqual(
    [sent.v, sent.n, sent.x, sent.q.id, [...sent.g], Math.abs(sent.t - Date.now()) < 60000],
    [1, 'Ana <img src=x onerror=alert(1)>', stepsId, stepsId, [1, 1, 1], true],
    'The link carries the name, the time, the assignment and the goal results'
  );
  const file = JSON.parse(run('turnInFile(turnedIn)'));
  assert.deepEqual(
    [file.app, file.kind, file.link, file.goals, file.abc.includes('E D C D | E D D C')],
    ['FretFree', 'turn-in', $('turn-in-url').value, '3 of 3 goals', true]
  );
  // An edit after turning in takes the link away, so older work is not handed in by mistake.
  run("$('abc').value = $('abc').value.replace('D D C', 'D D E'); changed(); clearTimeout(renderTimer); render()");
  assert.equal($('turn-in-result').hidden, true);
  assert.equal($('turn-in-summary').textContent, 'Assignment: Steps. 2 of 3 goals met.');
  $('turn-in-close').click();
  $('student-name').value = '';
  $('turn-in').click();
  assert.equal($('student-name').value, 'Ana <img src=x onerror=alert(1)>', 'The remembered name fills in');
  $('turn-in-close').click();
  // The teacher opens the turned-in link: who and when, the checklist, and an offer to add it to Submissions.
  const linkDraftAfter = () =>
    (JSON.parse(w.localStorage.getItem('fretfree-draft')) || []).find(d => d.tab === run('draftTab'));
  run('dirty = false');
  await run(`openSharedLink(${JSON.stringify(turnInLink)})`);
  assert.equal($('submission-bar').hidden, false);
  assert.match($('submission-text').textContent, /^Turned in by Ana <img src=x onerror=alert\(1\)> · .+ · Steps$/);
  assert.equal($('submission-bar').querySelector('img'), null, 'The name is escaped');
  assert.equal($('prompt-check').querySelectorAll('li.met').length, 3, 'The checklist shows the goals met');
  assert.equal($('turn-in').hidden, true, 'Turned-in work is answered with feedback, not turned in again');
  assert.match($('toast').textContent, /Opened the work Ana <img src=x onerror=alert\(1\)> turned in/);
  assert.deepEqual([$('submission-add').hidden, $('submission-prev').hidden], [false, true]);
  // Feedback typed for a link not in Submissions stays with the work: leaving the page with the box still focused
  // writes it into the unsaved-work draft, which comes back as the turned-in work, ready to add to Submissions.
  $('feedback-text').value = 'Check bar 2.';
  $('feedback-text').dispatchEvent(new w.Event('input'));
  w.dispatchEvent(new w.Event('pagehide'));
  const linkDraft = JSON.parse(w.localStorage.getItem('fretfree-draft')).find(d => d.tab === run('draftTab'));
  assert.deepEqual(
    [linkDraft.submission.name, linkDraft.submission.feedback],
    ['Ana <img src=x onerror=alert(1)>', 'Check bar 2.']
  );
  {
    const next = boot(storage => storage.setItem('fretfree-draft', JSON.stringify([linkDraft])));
    next.$('draft-restore').click();
    assert.deepEqual(
      [
        next.run('current.submission.name'),
        next.$('submission-bar').hidden,
        next.$('turn-in').hidden,
        next.$('submission-add').hidden,
        next.$('feedback-text').value
      ],
      ['Ana <img src=x onerror=alert(1)>', false, true, false, 'Check bar 2.'],
      'A restored draft of turned-in work keeps "Turned in by", the feedback and Add to submissions'
    );
    next.$('submission-add').click();
    assert.equal(next.run('storedInbox()[0].feedback'), 'Check bar 2.');
    const prompt = next.run('current.prompt');
    for (const damaged of [{id: 'sub-"x'}, {name: ' '}, {at: '1'}, {assignment: 'custom-other'}, {feedback: 7}])
      assert.equal(
        next.run(
          `JSON.stringify(draftSubmission(${JSON.stringify({...linkDraft, submission: {...linkDraft.submission, ...damaged}})}, ${JSON.stringify(prompt)}))`
        ),
        'feedback' in damaged ? JSON.stringify({...linkDraft.submission, feedback: undefined}) : 'null',
        `A draft's submission is checked: ${Object.keys(damaged)[0]}`
      );
  }
  $('submission-add').click();
  assert.equal(run('storedInbox().length'), 1);
  assert.deepEqual(
    [$('submission-add').hidden, $('submission-prev').hidden, $('submission-pos').textContent],
    [true, false, '1 of 1']
  );
  // Added as it came, the work is kept in Submissions with the feedback typed for it, so it is not unsaved work: no
  // draft, and Previous or Next would not ask to replace it.
  assert.deepEqual(
    [run('storedInbox()[0].feedback'), run('dirty'), run("'feedback' in current.submission"), linkDraftAfter()],
    ['Check bar 2.', false, false, undefined]
  );
  assert.equal($('save-status').textContent, run('SUBMISSION_STATUS'));
  // Thirty links, one per line, with a blank line, a line of text and a link without a name.
  const links = await run(`(async () => {
    const sent = ${JSON.stringify(sent)}, links = [];
    links.push(location.href.split('#')[0] + '#s=' + await encodeShare(sent));
    for (let i = 1; i < 30; i++)
      links.push(location.href.split('#')[0] + '#s=' + await encodeShare({
        ...sent, n: 'Student ' + String(i).padStart(2, '0'), t: sent.t + i,
        a: i % 3 ? sent.a : sent.a.replace('E D C D', 'E D C D E').replace('D D C', 'D D E')
      }));
    const {n, ...nameless} = sent;
    links.splice(10, 0, '', 'see you tomorrow', location.href.split('#')[0] + '#s=' + await encodeShare(nameless));
    return links;
  })()`);
  run('show("saved")');
  $('inbox-open').click();
  assert.deepEqual([$('inbox-panel').hidden, w.document.activeElement.id], [false, 'inbox-heading']);
  $('inbox-clear').click();
  assert.equal(run('storedInbox().length'), 0, 'Clear all empties the inbox');
  $('inbox-paste').value = links.join('\n');
  $('inbox-add').click();
  await until(() => /Added/.test($('inbox-status').textContent));
  assert.equal(
    $('inbox-status').textContent,
    'Added 30 submissions. Not a turn-in link: line 12 and line 13.',
    'Bad lines are reported by number and the rest are added'
  );
  assert.equal($('inbox-paste').value, '');
  const groups = $('inbox-list').querySelectorAll('.inbox-group');
  assert.equal(groups.length, 1, 'One assignment');
  assert.equal(groups[0].querySelector('h3').textContent, 'Steps 30 turned in');
  assert.equal(groups[0].querySelectorAll('li').length, 30, 'Thirty rows');
  assert.equal($('inbox-list').querySelector('img'), null, 'Names are escaped');
  assert.equal($('inbox-open').textContent, 'Submissions (30)');
  const rowText = i => groups[0].querySelectorAll('li')[i].textContent;
  assert.match(rowText(0), /^Ana <img src=x onerror=alert\(1\)> .+ 3 of 3 goals Bars ✓ OpenDelete$/);
  assert.match(rowText(3), /^Student 03 .+ 1 of 3 goals 1 bar to fix/, 'Goals and the bar check are checked again');
  $('inbox-paste').value = links.slice(0, 3).join('\n');
  $('inbox-add').click();
  await until(() => /already/.test($('inbox-status').textContent));
  assert.equal($('inbox-status').textContent, 'Added 0 submissions. 3 were already here.');
  // Files: a link in a text file is read; a file over 1 MB is not, and is named in the report.
  run(`(async () => addTurnIns(await readFiles([
    new File(['{' + ' '.repeat(1100000) + '}'], 'big.json'),
    new File([${JSON.stringify(links[0])}], 'ana.txt')
  ])))()`);
  await until(() => /large/.test($('inbox-status').textContent));
  assert.equal(
    $('inbox-status').textContent,
    'Added 0 submissions. 1 was already here. Too large to read (over 1 MB): big.json.'
  );
  $('inbox-sort').value = 'goals';
  $('inbox-sort').dispatchEvent(new w.Event('change'));
  assert.match(
    [...$('inbox-list').querySelectorAll('li')].at(-1).textContent,
    /^Student 27 .+ 1 of 3 goals/,
    'Sorted by goals met'
  );
  $('inbox-sort').value = 'name';
  $('inbox-sort').dispatchEvent(new w.Event('change'));
  // Open the first, step with Next and Previous; feedback typed for one student stays with that student.
  $('inbox-list').querySelector('[data-inbox-open]').click();
  assert.equal($('studio').hidden, false);
  assert.deepEqual(
    [$('submission-pos').textContent, $('submission-prev').disabled, $('submission-next').disabled],
    ['1 of 30', true, false]
  );
  assert.equal(w.document.activeElement.id, 'submission-text', 'Focus goes to who turned it in');
  assert.equal(run('dirty'), false, 'The inbox keeps it, so it is not unsaved work');
  $('feedback-text').value = 'Lovely steps. <b>End</b> on C.';
  $('feedback-text').dispatchEvent(new w.Event('change'));
  $('submission-next').click();
  assert.deepEqual(
    [$('submission-pos').textContent, run('current.submission.name'), $('feedback-text').value],
    ['2 of 30', 'Student 01', '']
  );
  assert.match($('abc').value, /D D C \|\]/);
  assert.equal(w.document.activeElement.id, 'submission-next');
  $('submission-prev').click();
  assert.equal($('feedback-text').value, 'Lovely steps. <b>End</b> on C.', 'Feedback is kept per student');
  assert.equal(w.document.activeElement.id, 'submission-next', 'At the start, focus moves to Next');
  for (let i = 0; i < 29; i++) $('submission-next').click();
  assert.deepEqual([$('submission-pos').textContent, $('submission-next').disabled], ['30 of 30', true]);
  // Feedback is kept as it is typed, after a pause, and at once when the page goes, with the box still focused.
  const lastFeedback = () => run('storedInbox().find(e => e.id === current.submission.id).feedback');
  $('feedback-text').value = 'Last one.';
  $('feedback-text').dispatchEvent(new w.Event('input'));
  assert.equal(lastFeedback(), undefined);
  await until(() => lastFeedback() === 'Last one.');
  assert.equal(lastFeedback(), 'Last one.', 'Typed feedback is kept without leaving the box');
  $('feedback-text').value = 'Last one, again.';
  $('feedback-text').dispatchEvent(new w.Event('input'));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(lastFeedback(), 'Last one, again.', 'Leaving the page keeps it at once');
  // Corrections the teacher makes come back from the unsaved-work draft as the same submission, in its place.
  run("$('abc').value = $('abc').value.replace(/\|\]/, 'z4 |]'); changed(); clearTimeout(renderTimer); render()");
  run('flushDraft()');
  {
    const next = boot(storage => {
      for (const key of ['fretfree-draft', 'fretfree-inbox']) storage.setItem(key, w.localStorage.getItem(key));
    });
    next.$('draft-restore').click();
    assert.deepEqual(
      [
        next.run('current.submission.id') === run('current.submission.id'),
        next.$('submission-pos').textContent,
        next.$('turn-in').hidden,
        next.$('feedback-text').value,
        /z4 \|\]/.test(next.$('abc').value)
      ],
      [true, '30 of 30', true, 'Last one, again.', true],
      'A restored draft of a submission keeps its place in the class and its feedback'
    );
  }
  $('undo').click();
  assert.equal(linkDraftAfter(), undefined);
  $('submission-all').click();
  assert.equal($('saved').hidden, false);
  assert.equal(
    w.document.activeElement.dataset.inboxOpen,
    run('current.submission.id'),
    'All submissions returns to the row'
  );
  // The return link carries the feedback (c) and the assignment, without a name or time.
  $('inbox-list').querySelector('[data-inbox-open]').click();
  $('feedback-link').click();
  await until(() => !$('feedback-result').hidden);
  assert.match($('toast').textContent, /copy it, then send it to Ana/);
  const returned = await run(`decodeShare(${JSON.stringify($('feedback-url').value.split('#s=')[1])})`);
  assert.deepEqual(
    [returned.v, returned.c, returned.q.id, 'n' in returned, 't' in returned],
    [1, 'Lovely steps. <b>End</b> on C.', stepsId, false, false]
  );
  run('dirty = false');
  await run(`openSharedLink("s=${$('feedback-url').value.split('#s=')[1]}")`);
  assert.equal($('feedback-note').hidden, false, 'The student sees the feedback');
  assert.equal($('feedback-note-text').textContent, 'Lovely steps. <b>End</b> on C.');
  assert.equal($('feedback-note').querySelector('b'), null, 'Feedback is escaped');
  assert.deepEqual([$('submission-bar').hidden, $('turn-in').hidden], [true, false], 'Ready to revise and turn in');
  assert.match($('toast').textContent, /feedback from your teacher/);
  $('save').click();
  const feedbackId = run('savedId');
  run('dirty = false; newScore()');
  assert.equal($('feedback-note').hidden, true);
  run(`openScore(saved.find(x => x.id === ${JSON.stringify(feedbackId)}), ${JSON.stringify(feedbackId)})`);
  assert.equal($('feedback-note-text').textContent, 'Lovely steps. <b>End</b> on C.', 'Saved copies keep it');
  // Saving turned-in work (a student checking their own link, or a teacher keeping a copy) makes a copy of one's own:
  // "Turned in by" stays behind, and the copy can be turned in, now and when reopened.
  run('dirty = false');
  await run(`openSharedLink(${JSON.stringify(turnInLink)})`);
  assert.deepEqual([$('submission-bar').hidden, $('turn-in').hidden], [false, true]);
  $('save').click();
  const copyId = run('savedId');
  assert.deepEqual(
    [
      run(`'submission' in saved.find(x => x.id === ${JSON.stringify(copyId)})`),
      $('submission-bar').hidden,
      $('turn-in').hidden
    ],
    [false, true, false],
    'A saved copy of turned-in work is not a submission'
  );
  run('dirty = false; newScore()');
  run(`openScore(saved.find(x => x.id === ${JSON.stringify(copyId)}), ${JSON.stringify(copyId)})`);
  assert.deepEqual([$('submission-bar').hidden, $('turn-in').hidden], [true, false], 'Reopened, it can be turned in');
  // Backups carry the inbox; restoring adds what this device lacks. Damaged entries are dropped when read.
  const inboxBackup = JSON.parse(JSON.stringify(run('backupData()')));
  assert.equal(inboxBackup.inbox.length, 30);
  assert.equal(inboxBackup.settings['fretfree-student-name'], 'Ana <img src=x onerror=alert(1)>');
  run('storeInbox(storedInbox().slice(0, 10))');
  const restored = run(`applyBackup(${JSON.stringify(inboxBackup)})`);
  assert.equal(restored.submissionsAdded, 20);
  assert.match(run(`restoreSummary(${JSON.stringify(restored)})`), /20 submissions added/);
  assert.equal(run('storedInbox().length'), 30);
  const stored = JSON.parse(w.localStorage.getItem('fretfree-inbox'));
  w.localStorage.setItem(
    'fretfree-inbox',
    JSON.stringify([
      {...stored[0], name: ' '},
      {...stored[1], prompt: {...stored[1].prompt, goals: [{type: 'nope'}]}},
      {...stored[2], met: 9},
      {...stored[3], abc: 'not abc'},
      ...stored.slice(4)
    ])
  );
  assert.equal(run('storedInbox().length'), 26, 'Damaged entries are dropped');
  // The inbox holds 200; extra links are reported, not stored.
  const capped = run(
    'addToInbox(Array.from({length: 180}, (_, i) => ({...storedInbox()[0], id: "sub-cap" + i.toString(36)})))'
  );
  assert.deepEqual([capped.added, capped.full, run('storedInbox().length')], [174, 6, 200]);
  run('show("saved")');
  const firstDelete = $('inbox-list').querySelector('[data-inbox-delete]');
  firstDelete.click();
  assert.equal(run('storedInbox().length'), 199);
  assert.equal(w.document.activeElement.dataset.inboxDelete !== undefined, true, 'Focus moves to the next row');
  $('inbox-clear').click();
  assert.equal(w.localStorage.getItem('fretfree-inbox'), null);
  assert.equal($('inbox-list').textContent, 'No submissions yet.');
  run('toggleInbox(false); dirty = false');

  // Unsaved-work recovery: an edit leaves this tab's draft in the local list; undoing to the opened text or saving
  // removes it.
  const drafts = () => JSON.parse(w.localStorage.getItem('fretfree-draft')) || [],
    draft = () => drafts().find(d => d.tab === run('draftTab')) ?? null,
    tabs = () => drafts().map(d => (d.tab === run('draftTab') ? 'this' : d.tab));
  const change = js => run(`${js}; changed(); clearTimeout(renderTimer); render()`),
    edit = js => {
      change(js);
      run('flushDraft()');
    };
  run('dirty = false; openScore(catalog.find(x => x.id === "ode"))');
  assert.equal(draft(), null, 'Opening a score leaves no draft');
  $('instrument').value = 'Violin';
  edit("$('abc').value = $('abc').value.replace('E E F G', 'G G F G')");
  assert.deepEqual(
    (({abc, instrument, title, sourceId, kind}) => ({
      edited: abc.includes('G G F G'),
      instrument,
      title,
      sourceId,
      kind
    }))(draft()),
    {edited: true, instrument: 'Violin', title: 'Ode to Joy', sourceId: 'ode', kind: 'historic'},
    'The draft holds the text, instrument, title and the edition id'
  );
  assert.ok(Math.abs(draft().at - Date.now()) < 60000, 'The draft is timed');
  $('undo').click();
  assert.equal(w.localStorage.getItem('fretfree-draft'), null, 'Undoing back to the opened text clears the draft');
  $('redo').click();
  run('flushDraft()');
  assert.ok(draft(), 'Redoing the edit writes the draft again');
  $('save').click();
  assert.equal(w.localStorage.getItem('fretfree-draft'), null, 'Saving clears the draft');
  edit("$('abc').value += '\\n%' + 'x'.repeat(600000)");
  assert.equal(draft(), null, 'Drafts over 500 KB are skipped');
  {
    const setItem = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = () => {
      throw new w.DOMException('full', 'QuotaExceededError');
    };
    assert.doesNotThrow(
      () => edit("$('abc').value = $('abc').value.replace(/\\n%x+$/, '')"),
      'A full quota is ignored'
    );
    w.Storage.prototype.setItem = setItem;
    assert.equal(draft(), null);
  }
  // A hidden tab (Chromebooks discard these) or a closing page writes the waiting draft at once, before the timer.
  change("$('abc').value = $('abc').value.replace('G G F G', 'A G F G')");
  assert.equal(draft(), null, 'The draft waits for the timer');
  assert.equal(w.document.hidden, true);
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.ok(draft()?.abc.includes('A G F G'), 'Hiding the tab writes the draft');
  run("$('abc').value = $('abc').value.replace('A G F G', 'B G F G'); changed()");
  w.dispatchEvent(new w.Event('pagehide'));
  assert.ok(draft()?.abc.includes('B G F G'), 'Leaving the page writes the draft, even before the edit has rendered');
  run('clearTimeout(renderTimer); render()');
  // Each tab keeps its own entry. When another tab's banner restores or discards this tab's draft, the work here is
  // still unsaved, so it goes straight back; a full list is left alone so open tabs never take turns pushing each
  // other out, and the next edit here drops the oldest draft instead.
  const other = n => ({abc: 'X:1\nT:Other\nK:C\nC4 |]', title: 'Other', tab: 'other' + n, at: Date.now() - n * 1000});
  const otherTab = list => {
    w.localStorage.setItem('fretfree-draft', JSON.stringify(list));
    w.dispatchEvent(new w.StorageEvent('storage', {key: 'fretfree-draft'}));
  };
  otherTab([other(1)]);
  assert.deepEqual(tabs(), ['this', 'other1'], "This tab's draft goes back, next to the other tab's");
  assert.ok(draft().abc.includes('B G F G'));
  otherTab([other(1), other(2), other(3)]);
  assert.deepEqual(tabs(), ['other1', 'other2', 'other3'], 'A full list is left alone');
  edit("$('abc').value = $('abc').value.replace('B G F G', 'C G F G')");
  assert.deepEqual(tabs(), ['this', 'other1', 'other2'], 'An edit here drops the oldest draft');
  $('save').click();
  assert.deepEqual(tabs(), ['other1', 'other2'], "Saving removes only this tab's draft");
  // Damaged drafts are not offered, nor one that matches the saved score it came from. A saved score from before
  // instruments were saved opens with a default instrument, so a draft with only a new instrument is kept.
  for (const value of ['[1]', '{"abc": "X:1\\nK:C\\nC|]"}', '[{"abc": " "}]']) {
    w.localStorage.setItem('fretfree-draft', value);
    assert.equal(run('loadDrafts().length'), 0, 'A damaged draft is ignored: ' + value);
  }
  w.localStorage.setItem(
    'fretfree-draft',
    JSON.stringify([
      {
        abc: run('saved.at(-1).abc'),
        instrument: run('saved.at(-1).instrument'),
        savedId: run('saved.at(-1).id'),
        at: 2
      },
      {abc: run('saved[0].abc'), instrument: 'Violin', savedId: run('saved[0].id'), tab: 'legacy', at: 1}
    ])
  );
  assert.equal(run('saved[0].instrument'), undefined, 'The first saved score is from before instruments were saved');
  assert.equal(
    run('loadDrafts().map(d => d.tab).join()'),
    'legacy',
    'A draft that matches its saved score is not offered'
  );
  assert.deepEqual(tabs(), ['legacy'], 'and is cleared');
  run('pendingDrafts = []; dirty = false');
  w.localStorage.removeItem('fretfree-draft');

  // Reloading with a draft of a library edition: the banner offers it; Restore brings back the exact text,
  // instrument and credits, marked unsaved; the legacy keys are untouched.
  const odeAbc = run('catalog.find(x => x.id === "ode").abc').replace('E E F G', 'G G F G'),
    legacy = storage => {
      storage.setItem('commonnote-scores-v1', '[]');
      storage.setItem('commonnote-favorites-v1', '["ode"]');
    };
  {
    const at = new Date(2026, 9, 6, 15, 42).getTime();
    const page = boot(storage => {
      legacy(storage);
      storage.setItem(
        'fretfree-draft',
        JSON.stringify([
          {abc: odeAbc, instrument: 'Violin', title: 'Ode to Joy', sourceId: 'ode', kind: 'historic', tab: 'gone', at}
        ])
      );
    });
    assert.equal(page.$('draft-banner').hidden, false, 'Start-up offers the draft');
    assert.match(page.$('draft-text').textContent, /^Unsaved work from .*3:42.*: Ode to Joy\.$/);
    assert.equal(page.$('library').hidden, false, 'The start view is unchanged');
    page.$('draft-restore').click();
    assert.deepEqual(
      [
        ...page.run(`[$('abc').value, $('instrument').value, current.rights === catalog.find(x => x.id === 'ode').rights,
        dirty, $('studio').hidden, $('draft-banner').hidden]`)
      ],
      [odeAbc, 'Violin', true, true, false, true],
      'Restore brings back the exact text, instrument and credits, marked unsaved'
    );
    assert.ok(page.$('rights').textContent.includes('CC0'), 'Library credits are shown');
    assert.match(page.$('save-status').textContent, /Restored unsaved work/);
    assert.deepEqual(
      JSON.parse(page.w.localStorage.getItem('fretfree-draft')).map(d => [d.tab === page.run('draftTab'), d.abc]),
      [[true, odeAbc]],
      "The restored work becomes this tab's draft, in place of the old one"
    );
    assert.deepEqual(
      [page.w.localStorage.getItem('commonnote-scores-v1'), page.w.localStorage.getItem('commonnote-favorites-v1')],
      ['[]', '["ode"]'],
      'Legacy keys are untouched'
    );
  }
  // A draft of a saved prompt score restores its prompt and saved entry, so saving updates that entry.
  {
    const prompt = run('writingPrompts[0].id'),
      base = run(`promptSource(writingPrompts[0])`);
    const page = boot(storage => {
      storage.setItem(
        'commonnote-scores-v1',
        JSON.stringify([{id: 'mine', title: 'My first melody', abc: base, instrument: 'Flute', prompt, updated: 1}])
      );
      storage.setItem(
        'fretfree-draft',
        JSON.stringify([
          {
            abc: base.replace('z4', 'C D E F'),
            instrument: 'Flute',
            title: 'My first melody',
            prompt,
            savedId: 'mine',
            kind: 'personal',
            tab: 'gone',
            at: Date.now()
          }
        ])
      );
    });
    page.$('draft-restore').click();
    assert.deepEqual(
      [...page.run('[savedId, current.prompt, $("prompt-check").hidden, $("abc").value.includes("C D E F")]')],
      ['mine', prompt, false, true],
      'Prompt and saved entry come back'
    );
    page.$('save').click();
    assert.equal(page.run('saved.length'), 1, 'Saving updates the saved entry');
    assert.equal(page.w.localStorage.getItem('fretfree-draft'), null, 'Saving clears the draft');
  }
  // A share link opened at start-up opens first and the banner follows. The shared copy is unsaved, so it becomes this
  // tab's own draft beside the earlier one, never in its place, and undoing an edit to it updates only its own entry.
  {
    const link = await run('encodeShare({v: 1, a: catalog.find(x => x.id === "mozart").abc, i: "Flute"})'),
      earlier = {abc: odeAbc, title: 'Ode to Joy', kind: 'personal', tab: 'gone', at: 1};
    const page = boot(storage => {
      legacy(storage);
      storage.setItem('fretfree-draft', JSON.stringify([earlier]));
    }, 'http://localhost:8000/#s=' + link);
    for (let i = 0; i < 100 && page.run('current?.kind') !== 'shared'; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(page.run('current.kind'), 'shared', 'The shared score opens');
    assert.equal(page.$('studio').hidden, false);
    assert.equal(page.$('draft-banner').hidden, false, 'The banner follows the shared score');
    assert.match(page.$('draft-text').textContent, /: Ode to Joy\.$/);
    const stored = () => JSON.parse(page.w.localStorage.getItem('fretfree-draft')),
      opened = page.run("$('abc').value"),
      own = () => stored().find(d => d.tab === page.run('draftTab'));
    page.run('flushDraft()');
    assert.equal(own().abc, opened, 'The unedited shared copy is drafted');
    page.run("$('abc').value = $('abc').value.replace(/^T:.*$/m, 'T:Edited'); changed(); clearTimeout(renderTimer)");
    page.run('render(); flushDraft()');
    assert.match(own().abc, /T:Edited/);
    page.$('undo').click();
    page.run('flushDraft()');
    assert.deepEqual(
      [page.run('dirty'), own().abc === opened, stored().find(d => d.tab === 'gone')],
      [true, true, earlier],
      'After undo the shared copy is still unsaved; its draft follows the undo and the earlier draft is kept'
    );
    // The next visit offers both, newest first; Discard moves on to the next, and Restore leaves the rest stored.
    const next = boot(storage => storage.setItem('fretfree-draft', page.w.localStorage.getItem('fretfree-draft')));
    const title = page.run('current.title');
    assert.equal(
      next.$('draft-text').textContent.endsWith(`: ${title} (1 of 2).`),
      true,
      'The newest is offered first'
    );
    next.$('draft-discard').click();
    assert.match(next.$('draft-text').textContent, /: Ode to Joy \(2 of 2\)\.$/, 'Discard offers the next draft');
    assert.equal(next.$('draft-banner').hidden, false);
    assert.equal(next.w.document.activeElement.id, 'draft-restore', 'Restore keeps the focus');
    assert.deepEqual(
      JSON.parse(next.w.localStorage.getItem('fretfree-draft')).map(d => d.tab),
      ['gone'],
      'Discard removes only the offered draft'
    );
    next.$('draft-discard').click();
    assert.equal(next.$('draft-banner').hidden, true, 'Discarding the last draft hides the banner');
    assert.equal(next.w.localStorage.getItem('fretfree-draft'), null, 'and no draft is left');
    page.$('draft-discard').click();
    assert.equal(page.$('draft-banner').hidden, true, 'Discard hides the banner');
    assert.deepEqual(
      stored().map(d => d.tab),
      [page.run('draftTab')],
      "Discard removes the earlier draft and keeps this tab's own"
    );
    assert.equal(page.run('current.kind'), 'shared', 'Discard leaves the open score alone');
  }
  // Theme: Auto, Light or Dark goes on <html> as the scripts start, persists, is backed up and restored. Dark paper
  // shows only in the dark theme, and Auto follows the device as it switches.
  {
    const page = boot(storage => storage.setItem('fretfree-theme', '"purple"')),
      html = page.w.document.documentElement;
    assert.equal(page.$('theme').value, 'auto', 'A damaged theme falls back to Auto');
    assert.equal(html.hasAttribute('data-theme'), false, 'Auto leaves the choice to the device');
    assert.equal(page.$('dark-paper-option').hidden, true, 'No matchMedia: Auto is light, so Dark paper is hidden');
    page.$('theme').value = 'dark';
    page.$('theme').dispatchEvent(new page.w.Event('change'));
    assert.equal(html.dataset.theme, 'dark');
    assert.equal(page.run("storage.get('fretfree-theme')"), 'dark', 'The theme is remembered');
    assert.equal(page.$('dark-paper-option').hidden, false, 'Dark paper is offered in the dark theme');
    page.$('dark-paper').checked = true;
    page.$('dark-paper').dispatchEvent(new page.w.Event('change'));
    assert.equal(html.dataset.paper, 'dark');
    assert.equal(page.run("storage.get('fretfree-dark-paper')"), true);
    const settings = page.run('backupData().settings');
    assert.equal(settings['fretfree-theme'], 'dark', 'The theme is backed up');
    assert.equal(settings['fretfree-dark-paper'], true, 'Dark paper is backed up');
    const before = page.$('notation').innerHTML;
    page.$('theme').value = 'light';
    page.$('theme').dispatchEvent(new page.w.Event('change'));
    assert.equal(html.dataset.theme, 'light');
    assert.equal(page.$('dark-paper-option').hidden, true, 'Dark paper is hidden in the light theme');
    assert.equal(page.$('notation').innerHTML, before, 'A theme change does not redraw the score');
    // Restoring a backup applies its theme straight away.
    page.run(
      `applyBackup(${JSON.stringify({app: 'FretFree', format: 1, scores: [], settings: {'fretfree-theme': 'dark', 'fretfree-dark-paper': false}})})`
    );
    page.run('applyStoredSettings()');
    assert.deepEqual(
      [html.dataset.theme, html.hasAttribute('data-paper'), page.$('theme').value, page.$('dark-paper').checked],
      ['dark', false, 'dark', false],
      'A restored theme applies at once'
    );
    // A device in dark mode: Auto is dark and offers Dark paper; switching the device back to light hides it.
    let listeners = [],
      deviceDark = true;
    const darkDevice = win => {
        listeners = [];
        deviceDark = true;
        win.matchMedia = query => ({
          media: query,
          get matches() {
            return /dark/.test(query) && deviceDark;
          },
          addEventListener: (type, fn) => listeners.push(fn)
        });
      },
      switchDevice = dark => {
        deviceDark = dark;
        listeners.forEach(fn => fn({matches: dark}));
      };
    const device = boot((storage, win) => {
      darkDevice(win);
      storage.setItem('fretfree-dark-paper', 'true');
    });
    assert.equal(device.$('theme').value, 'auto');
    assert.equal(device.w.document.documentElement.dataset.paper, 'dark', 'Dark paper is applied at start-up');
    assert.equal(device.$('dark-paper-option').hidden, false, 'Auto on a dark device offers Dark paper');
    assert.equal(device.$('dark-paper').checked, true);
    switchDevice(false);
    assert.equal(device.$('dark-paper-option').hidden, true, 'Auto follows the device back to light');
    // Storage full or blocked: Theme and Dark paper still apply for the session, and a device switch keeps them.
    const full = boot((storage, win) => {
        darkDevice(win);
        win.Storage.prototype.setItem = () => {
          throw new win.DOMException('Storage is full', 'QuotaExceededError');
        };
      }),
      fullRoot = full.w.document.documentElement,
      choose = (id, value) => {
        if (id === 'theme') full.$(id).value = value;
        else full.$(id).checked = value;
        full.$(id).dispatchEvent(new full.w.Event('change'));
      },
      shown = () => [
        full.$('theme').value,
        fullRoot.getAttribute('data-theme'),
        full.$('dark-paper').checked,
        fullRoot.getAttribute('data-paper'),
        full.$('dark-paper-option').hidden
      ];
    choose('theme', 'dark');
    assert.deepEqual(shown(), ['dark', 'dark', false, null, false], 'Dark applies although it cannot be saved');
    assert.equal(full.run('storage.get(KEYS.theme)'), undefined, 'and nothing was saved');
    choose('dark-paper', true);
    assert.deepEqual(shown(), ['dark', 'dark', true, 'dark', false], 'Dark paper applies although it cannot be saved');
    switchDevice(false);
    assert.deepEqual(shown(), ['dark', 'dark', true, 'dark', false], 'A device switch keeps the unsaved choice');
    choose('theme', 'auto');
    assert.deepEqual(shown(), ['auto', null, true, 'dark', true], 'Auto on a light device hides Dark paper');
    switchDevice(true);
    assert.deepEqual(shown(), ['auto', null, true, 'dark', false], 'and the device going dark shows it, still ticked');
  }
  // theme.js runs first, without defer and ahead of the stylesheet, so the stored theme is on <html> before the first
  // paint instead of after the catalogs download. It reads the KEYS names before KEYS exists and skips damaged values.
  {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
      tag = html.match(/<script[^>]*\ssrc="theme\.js[^"]*"[^>]*>/);
    assert.ok(tag, 'index.html loads theme.js');
    assert.doesNotMatch(tag[0], /\s(defer|async)\b/, 'theme.js is not deferred');
    assert.ok(
      tag.index < html.indexOf('<link rel="stylesheet"') && tag.index < html.indexOf('<script defer'),
      'theme.js comes before the stylesheet and the deferred scripts'
    );
    const keys = run('[KEYS.theme, KEYS.darkPaper]'),
      early = (theme, paper, blocked, hash = '') => {
        const dom = new JSDOM(html, {runScripts: 'outside-only', url: 'http://localhost:8000/' + hash});
        if (theme !== undefined) dom.window.localStorage.setItem(keys[0], theme);
        if (paper !== undefined) dom.window.localStorage.setItem(keys[1], paper);
        if (blocked)
          dom.window.Storage.prototype.getItem = () => {
            throw new dom.window.DOMException('Blocked', 'SecurityError');
          };
        vm.runInContext(fs.readFileSync(path.join(root, 'theme.js'), 'utf8'), dom.getInternalVMContext());
        const el = dom.window.document.documentElement;
        return [el.getAttribute('data-theme'), el.getAttribute('data-paper')];
      };
    assert.deepEqual(early('"dark"', 'true'), ['dark', 'dark'], 'Stored Dark and Dark paper apply before shared.js');
    assert.deepEqual(early('"light"', 'false'), ['light', null]);
    assert.deepEqual(early('"auto"'), [null, null], 'Auto leaves the choice to the device');
    assert.deepEqual(early('"purple"', '"yes"'), [null, null], 'Damaged values are ignored');
    assert.deepEqual(early('{broken', 'true'), [null, 'dark']);
    assert.deepEqual(early('"dark"', 'true', true), [null, null], 'Blocked storage does not stop the page');
    assert.deepEqual(early('"dark"', 'true', false, '#e=abc'), [null, null], 'An embed reads no stored theme');
    assert.deepEqual(early('"dark"', 'true', false, '#s=abc'), ['dark', 'dark'], 'A share link still does');
  }
  // Opening MusicXML: .mxl and .musicxml files become an editable personal copy, with a report of what was left out,
  // a guessed instrument, and a FretFree export's rights metadata restored. Damaged and oversized files say so.
  {
    const page = boot(),
      fixture = name => fs.readFileSync(path.join(root, 'tests/fixtures', name));
    Object.assign(page.w, {DecompressionStream, TextDecoder});
    const choose = async (data, name) => {
      Object.defineProperty(page.$('import-file'), 'files', {
        value: [new page.w.File([data], name)],
        configurable: true
      });
      await page.$('import-file').onchange();
    };
    await choose(fixture('morning-walk.mxl'), 'morning-walk.mxl');
    assert.equal(page.$('title').value, 'Morning Walk');
    assert.equal(page.$('instrument').value, 'Flute', 'The first part names the instrument');
    assert.equal(
      page.$('save-status').textContent,
      'Imported from MusicXML (3 parts, 5 measures). Save or export to keep a copy.'
    );
    assert.deepEqual([page.run('current.kind'), page.run('dirty')], ['personal', true]);
    assert.ok(page.$('abc').value.includes('%%score 1 2 {(3 4) | 5}'));
    assert.equal(page.$('notation').querySelectorAll('svg').length > 0, true, 'The imported score is engraved');
    await choose(fixture('left-out.musicxml'), 'left-out.musicxml');
    assert.equal(page.$('instrument').value, 'Piano', 'A B♭ trumpet with a guitar is shown at concert pitch');
    assert.match(page.$('save-status').textContent, /^Imported from MusicXML \(2 parts, 2 measures\)\. .* Left out: /);
    assert.match(page.$('save-status').textContent, /Left out: pedal marks, .*, tremolos, .* and string numbers\.$/);
    assert.ok(page.$('abc').value.includes('%%abc-copyright © 2026 Sam Writer. CC BY 4.0'), 'The copyright is kept');
    // A FretFree export comes back with its edition's rights metadata, so later exports carry the same credit.
    const item = page.run("catalog.find(x => scoreLicense(x).startsWith('CC-BY-SA'))"),
      exported = page.run(
        `abcToMusicXML(catalog.find(x => x.id === ${JSON.stringify(item.id)}).abc, {item: catalog.find(x => x.id === ${JSON.stringify(item.id)})})`
      );
    await choose(exported, 'edition.musicxml');
    assert.equal(page.run('current.rights'), item.rights);
    assert.equal(
      page.run('exportCredit(current)'),
      page.run(`exportCredit(catalog.find(x => x.id === ${JSON.stringify(item.id)}))`)
    );
    assert.ok(page.run("creditedABC($('abc').value, current)").includes('Notation/edition license: CC-BY-SA'));
    assert.equal(page.run('current.kind'), 'personal', 'An imported edition is a personal copy');
    // Links come back only as web addresses or paths on this site: a crafted file's javascript: or data: link is
    // dropped, in a MusicXML file and in an ABC file alike, and so is anything that is not rights metadata.
    const edition = page.run('catalog.find(x => x.pdf && x.originalSource)'),
      editionXML = page.run(
        `abcToMusicXML(catalog.find(x => x.id === ${JSON.stringify(edition.id)}).abc, {item: catalog.find(x => x.id === ${JSON.stringify(edition.id)})})`
      );
    await choose(editionXML, 'pdf-edition.musicxml');
    assert.deepEqual(
      [page.run('current.pdf'), page.run('current.originalSource'), page.$('source-edition').hidden],
      [edition.pdf, edition.originalSource, false],
      'A source edition keeps its PDF and source links'
    );
    const {abc: _, ...fields} = edition,
      crafted = {
        ...fields,
        pdf: "javascript:void(document.title='pwned')",
        originalMidi: ' javascript:alert(1)',
        originalSource: 'data:text/html,<b>hi</b>',
        licenseURL: 'java\tscript:alert(1)',
        source: 'JAVASCRIPT:alert(1)',
        instrument: 'Alto sax in E♭',
        prompt: {title: 'Not from this file'},
        id: 'ode'
      },
      linksSafe = () =>
        [...page.$('rights').querySelectorAll('a'), ...page.$('source-edition').querySelectorAll('a')].every(a =>
          /^https?:$/.test(a.protocol)
        );
    for (const [data, name] of [
      [
        editionXML.replace(
          /(<miscellaneous-field name="fretfree-rights">)[^<]*/,
          (field, open) => open + JSON.stringify(crafted).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        ),
        'crafted.musicxml'
      ],
      [`% FretFree-Rights: ${JSON.stringify(crafted)}\nX:1\nT:Crafted\nK:C\nCDE|]\n`, 'crafted.abc']
    ]) {
      await choose(data, name);
      assert.equal(page.run('current.rights'), edition.rights, `${name}: the rights text comes back`);
      for (const key of ['pdf', 'originalMidi', 'originalSource', 'licenseURL', 'source', 'prompt', 'id'])
        assert.equal(page.run(`current.${key}`), undefined, `${name}: ${key} is dropped`);
      assert.notEqual(
        page.$('instrument').value,
        crafted.instrument,
        `${name}: the file does not choose the instrument`
      );
      assert.equal(page.$('source-edition').hidden, true);
      assert.ok(linksSafe(), `${name}: every link opens a web page`);
    }
    // Problems: the open score stays, and the message is shown and kept in the status line.
    const before = page.$('abc').value;
    await choose('X:1\nK:C\nCDE|', 'not-really.xml');
    assert.match(page.$('toast').textContent, /could not be read as MusicXML/);
    assert.match(page.$('save-status').textContent, /could not be read as MusicXML/);
    await choose(fixture('morning-walk.mxl').subarray(0, 900), 'cut-short.mxl');
    assert.match(page.$('toast').textContent, /could not be opened/);
    await choose(new Uint8Array(5 * 1024 * 1024 + 1), 'huge.musicxml');
    assert.equal(page.$('toast').textContent, 'Please use a MusicXML file smaller than 5 MB.');
    delete page.w.DecompressionStream;
    await choose(fixture('morning-walk.mxl'), 'morning-walk.mxl');
    assert.match(page.$('toast').textContent, /can’t open compressed \.mxl files/);
    assert.equal(page.$('abc').value, before, 'A file that cannot be opened changes nothing');
    assert.equal(page.$('import-file').value, '', 'The same file can be chosen again');
    assert.match(page.$('import-file').accept, /\.musicxml,\.xml,\.mxl/);
  }
  // Offline notice and Install app. jsdom has no service worker, so the About page says offline use is unavailable.
  {
    assert.match($('offline-ready').textContent, /^This browser cannot keep an offline copy/);
    assert.equal($('offline-status').textContent, '');
    assert.equal($('offline-status').getAttribute('role'), 'status');
    Object.defineProperty(w.navigator, 'onLine', {value: false, configurable: true});
    w.dispatchEvent(new w.Event('offline'));
    assert.equal($('offline-status').textContent, '● Working offline');
    assert.match($('toast').textContent, /^You are offline\. FretFree keeps working/);
    Object.defineProperty(w.navigator, 'onLine', {value: true, configurable: true});
    w.dispatchEvent(new w.Event('online'));
    assert.equal($('offline-status').textContent, '');
    // The browser's install offer is held for the button, which uses it once and then goes.
    assert.equal($('install-app').hidden, true);
    let prompted = 0;
    const offer = new w.Event('beforeinstallprompt', {cancelable: true});
    offer.prompt = async () => prompted++;
    offer.userChoice = Promise.resolve({outcome: 'dismissed'});
    w.dispatchEvent(offer);
    assert.ok(offer.defaultPrevented, 'The mini-infobar is replaced by the button');
    assert.equal($('install-app').hidden, false);
    $('install-app').click();
    $('install-app').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(prompted, 1, 'An offer prompts once');
    assert.equal($('install-app').hidden, true);
    assert.equal(w.document.activeElement, w.document.querySelector('.nav.active'), 'Focus goes back to the nav');
    w.dispatchEvent(offer);
    w.dispatchEvent(new w.Event('appinstalled'));
    assert.equal($('install-app').hidden, true);
    assert.match($('toast').textContent, /^FretFree is installed/);
  }
  console.log(
    'PASS (jsdom): theme (Auto, Light, Dark, Dark paper, device switch, backup and restore, storage full, theme.js before the first paint), embed code (sizes, escaping, tabs), QR codes (modules, quiet zone, long links), the embed route (score alone, NC credits, read-only, no storage, damaged links), version history (save, History panel, preview, restore, backups, caps, full storage, delete), unsaved-work recovery, teacher-written assignments (builder defaults, pickups, minor keys, transposing instruments, staying in step with the score, escaping, q links, focus, save, reopen, backup, tampered links), turning in (name required and remembered, n/t/x/g links, the .json file, stale links after edits, Turned in by, escaping) and Submissions (30 pasted links in one group, bad lines reported, duplicates, sorting, Previous/Next with focus, feedback kept per student, return links with c, feedback on the student’s saved copy, backup and restore, damaged entries, the 200 cap, delete and clear), backup and restore (with classroom colors, zoom and the Chords switch), blank sheets and add bars, new score templates (panel fields, pickups per meter, SATB with four named staves, piano bars on both staves with one undo, left-hand typing, letters to the top staff, lead-sheet chord kept, Escape and cancel), notation palette on a blank sheet, share links, legacy storage, damaged played list, search and sort, genre filter, pagination, Listen buttons, skill filter and chips, try-next suggestions and played marks, source editions, save/update, MusicXML export, opening MusicXML (.mxl and .musicxml, left-out report, instrument, rights metadata, crafted links in MusicXML and ABC files, damaged and oversized files), and the offline notice and Install app.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
