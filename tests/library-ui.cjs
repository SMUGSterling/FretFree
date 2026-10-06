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
  console.log(
    'PASS (jsdom): unsaved-work recovery, backup and restore, blank sheets and add bars, share links, legacy storage, damaged played list, search and sort, genre filter, pagination, Listen buttons, skill filter and chips, try-next suggestions and played marks, source editions, and save/update.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
