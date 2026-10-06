// Library and saved-score behaviour on a real DOM (jsdom) with the real engraving library.
// Run with: node tests/library-ui.cjs  (set JSDOM_PATH to a jsdom install if it isn't in node_modules)
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
const root = path.resolve(__dirname, '..');
const SCRIPTS = [
  'vendor/abcjs-basic-min.js',
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
  'palette.js',
  'playback.js',
  'keyboard.js',
  'assignments.js',
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
  seed(w.localStorage);
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
$('new-bars').value = '3';
$('new-score').click();
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
  $('new-score').click();
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
      'fretfree-zoom': 140
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
  console.log(
    'PASS (jsdom): unsaved-work recovery, teacher-written assignments (builder defaults, pickups, minor keys, transposing instruments, staying in step with the score, escaping, q links, focus, save, reopen, backup, tampered links), backup and restore (with classroom colors and zoom), blank sheets and add bars, notation palette on a blank sheet, share links, legacy storage, damaged played list, search and sort, genre filter, pagination, Listen buttons, skill filter and chips, try-next suggestions and played marks, source editions, save/update, MusicXML export, and opening MusicXML (.mxl and .musicxml, left-out report, instrument, rights metadata, crafted links in MusicXML and ABC files, damaged and oversized files).'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
