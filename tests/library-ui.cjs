// Library and saved-score behaviour on a real DOM (jsdom) with the real engraving library.
// Run with: node tests/library-ui.cjs  (set JSDOM_PATH to a jsdom install if it isn't in node_modules)
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'http://localhost:8000'
});
const w = dom.window,
  ctx = dom.getInternalVMContext(),
  run = s => vm.runInContext(s, ctx),
  $ = id => w.document.getElementById(id);
w.SVGElement.prototype.getBBox = function () {
  return {x: 0, y: 0, width: Math.max(1, (this.textContent || '').length * 7), height: 14};
};
w.scrollTo = () => {};
w.Element.prototype.scrollIntoView = () => {};
w.confirm = () => true;
// Storage written by the app's previous name must still load; a damaged played list must not stop start-up.
w.localStorage.setItem(
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
w.localStorage.setItem('commonnote-favorites-v1', '["ode"]');
w.localStorage.setItem('fretfree-played', '{"unexpected":true}');
for (const file of [
  'vendor/abcjs-basic-min.js',
  'catalog.js',
  'catalog-expanded.js',
  'score-tools.js',
  'rights-tools.js',
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
  'playback.js',
  'assignments.js',
  'app.js'
])
  run(fs.readFileSync(path.join(root, file), 'utf8'));
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
    settings: {'fretfree-practice-loop': true, 'fretfree-note-names': 'letters'}
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
  run('dirty = false');
  console.log(
    'PASS (jsdom): teacher-written assignments (builder defaults, escaping, q links, save, reopen, backup, tampered links), backup and restore, blank sheets and add bars, share links, legacy storage, damaged played list, search and sort, genre filter, pagination, Listen buttons, skill filter and chips, try-next suggestions and played marks, source editions, and save/update.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
