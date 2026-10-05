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
  'editor.js',
  'playback.js',
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
  console.log(
    'PASS (jsdom): blank sheets and add bars, share links, legacy storage, damaged played list, search and sort, genre filter, pagination, Listen buttons, skill filter and chips, try-next suggestions and played marks, source editions, and save/update.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
