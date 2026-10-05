// Exercise the controller with a minimal DOM adapter. Actual engraving is checked separately.
const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const real = require('../vendor/abcjs-basic-min.js');
class Element {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.hidden = false;
    this.checked = false;
    this.options = [];
    this.style = {};
    this.dataset = {};
    this.classList = {toggle() {}};
    this.innerHTML = '';
  }
  add(o) {
    this.options.push(o);
    if (this.options.length === 1) this.value = o.value;
  }
  addEventListener() {}
  scrollIntoView() {}
  insertAdjacentHTML() {}
  focus() {}
  setSelectionRange() {}
  querySelector() {
    return null;
  }
}
const elements = new Map();
const get = id => {
  if (!elements.has(id)) elements.set(id, new Element(id));
  return elements.get(id);
};
for (const [id, value] of Object.entries({
  search: '',
  'level-filter': 'all',
  'skill-filter': 'all',
  'kind-filter': 'all',
  'instrument-filter': 'all',
  'genre-filter': 'all',
  'sort-filter': 'featured',
  'collection-filter': 'all',
  'license-filter': 'all',
  bpm: '100',
  duration: '1',
  octave: 'middle',
  volume: '.3',
  speed: '100',
  'start-measure': '1'
}))
  get(id).value = value;
for (const id of ['genre-filter', 'collection-filter', 'license-filter', 'skill-filter'])
  get(id).options = [{value: 'all'}];
for (const id of ['meter', 'key']) get(id).options = [{value: id === 'meter' ? '4/4' : 'C'}];
const persisted = new Map([
  [
    'commonnote-scores-v1',
    JSON.stringify([
      {
        id: 'legacy-score',
        title: 'Existing saved tune',
        abc: 'X:1\nT:Existing saved tune\nM:4/4\nL:1/4\nK:C\nC4 |]',
        updated: 1
      }
    ])
  ],
  ['commonnote-favorites-v1', '["ode"]']
]);
const events = {};
const document = {
  getElementById: get,
  querySelectorAll: () => [],
  addEventListener: (name, cb) => (events[name] = cb),
  hidden: false
};
const context = {
  document,
  console,
  Option: function (text, value) {
    this.text = text;
    this.value = value;
  },
  localStorage: {getItem: key => persisted.get(key) || null, setItem: (key, val) => persisted.set(key, val)},
  location: {hash: ''},
  history: {replaceState() {}},
  window: {scrollTo() {}, addEventListener() {}},
  ABCJS: {...real, renderAbc: (_, source) => real.parseOnly(source)},
  setTimeout: () => 1,
  clearTimeout() {},
  confirm: () => true,
  crypto: {randomUUID: () => 'new-score-test'},
  Uint8Array,
  DataView,
  Map,
  atob
};
vm.createContext(context);
for (const file of [
  'catalog.js',
  'catalog-expanded.js',
  'score-tools.js',
  'rights-tools.js',
  'catalog-licensed.js',
  'catalog-skills.js',
  'shared.js',
  'library.js',
  'editor.js',
  'playback.js',
  'app.js'
])
  vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context);
const run = code => vm.runInContext(code, context);
assert.equal(run('saved[0].id'), 'legacy-score', 'Renaming preserves existing saved scores');
assert.ok(run('favorites.includes("ode")'), 'Existing favorites preserved');
assert.ok(run('filteredCatalog().length') >= 200);
assert.equal(get('hero-count').textContent, '01 / ' + run('catalog.length'));
get('search').value = 'The Entertainer';
get('sort-filter').value = 'title';
assert.ok(run('filteredCatalog().some(x=>x.title==="The Entertainer")'));
run('renderCards()');
assert.ok(get('cards').innerHTML.includes('Complete PDF'));
assert.equal(get('pagination').hidden, true);
get('search').value = '';
get('genre-filter').value = 'Original exercises';
assert.equal(run('filteredCatalog().length'), 8);
get('genre-filter').value = 'all';
run('libraryPage=1;renderCards()');
assert.ok(get('page-status').textContent.startsWith('Page 2'));
assert.ok((get('cards').innerHTML.match(/<article /g) || []).length <= 24);
run('libraryPage=0;renderCards()');
assert.ok(get('cards').innerHTML.includes('data-listen="'), 'Cards offer a Listen button');
assert.equal(
  run('cardSnippet(catalog.find(x=>x.id==="ode")).split("\\n").pop()'),
  run('catalog.find(x=>x.id==="ode").abc.split("\\n")[7]'),
  'Preview plays the first line shown on the card'
);
// Skill filter: tags come from catalog-skills.js, the chip on a card matches the filter, and search finds tags.
get('skill-filter').value = 'Chords';
assert.equal(run('filteredCatalog().length'), run('catalog.filter(x=>scoreSkills(x).includes("Chords")).length'));
assert.ok(run('filteredCatalog().every(x=>scoreSkills(x).includes("Chords"))'));
run('renderCards()');
assert.ok(
  get('cards').innerHTML.includes('data-skill="Chords" aria-pressed="true"'),
  'The active skill chip is pressed'
);
get('skill-filter').value = 'all';
get('search').value = 'compound meter';
assert.ok(
  run('filteredCatalog().length') >= 800 &&
    run('filteredCatalog().every(x=>scoreSkills(x).includes("Compound meter")||/compound/i.test(x.skill+x.title))'),
  'Search matches skill tags'
);
get('search').value = '';
// Try next: suggestions share skills, sit at the same level or one up, skip the score itself and played scores; opening a score marks it played.
{
  get('sort-filter').value = 'featured';
  run('libraryPage=0');
  run('openScore(catalog.find(x=>x.id==="ode"))');
  assert.ok(run('played.has("ode")'), 'Opening a library score records it as played');
  assert.ok(JSON.parse(persisted.get('fretfree-played')).includes('ode'), 'Played scores persist');
  run('renderCards()');
  assert.ok(get('cards').innerHTML.includes('✓ Played'), 'Library cards mark played scores');
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
  assert.ok(
    get('next-up').innerHTML.includes('Try next') && !get('next-up').hidden,
    'Try next panel shows for a library score'
  );
  run('newScore()');
  assert.equal(get('next-up').hidden, true, 'No suggestions for a new score');
}
run('openScore(catalog.find(x=>x.pdf))');
assert.equal(get('source-edition').hidden, false);
assert.ok(get('source-edition').innerHTML.includes('Download PDF'));
run('newScore()');
assert.equal(get('source-edition').hidden, true);
get('title').value = 'My new music';
run("setHeader('T','My new music')");
get('save').onclick();
assert.equal(run('saved.length'), 2);
get('save').onclick();
assert.equal(run('saved.length'), 2, 'Saving again updates existing record');
console.log(
  'PASS: legacy saved scores/favorites, title search, skill filter and chips, try-next suggestions and played marks, genre filters, pagination, full-score links, and save/update behavior.'
);
