'use strict';
// Library: filters, cards and pagination, card previews, played marks and Try next suggestions.
let libraryPage = 0,
  previewId = null,
  miniTunes = new Map();
const PAGE_SIZE = 24;
// Skill tags come from catalog-skills.js (built by scripts/build-skills.cjs); a score missing from it is tagged on the spot.
function scoreSkills(x) {
  const masks = typeof catalogSkills === 'object' ? catalogSkills : {};
  if (!(x.id in masks)) {
    try {
      masks[x.id] = skillMask(skillTags(ABCJS.parseOnly(x.abc)[0]));
    } catch {
      masks[x.id] = 0;
    }
  }
  return skillsFromMask(masks[x.id]);
}
function filteredCatalog() {
  const q = $('search').value.toLowerCase(),
    level = $('level-filter').value,
    skill = $('skill-filter').value,
    kind = $('kind-filter').value,
    genre = $('genre-filter').value,
    collection = $('collection-filter').value,
    license = $('license-filter').value;
  const list = catalog.filter(
    x =>
      (collection === 'all' || scoreCollection(x) === collection) &&
      (license === 'all' || scoreLicense(x) === license) &&
      (level === 'all' || x.level === level) &&
      (skill === 'all' || scoreSkills(x).includes(skill)) &&
      (kind === 'all' || x.kind === kind) &&
      (genre === 'all' || (x.genre || 'Teaching melodies') === genre) &&
      `${x.title} ${x.composer} ${x.skill} ${scoreSkills(x).join(' ')} ${x.originalInstrument || ''} ${x.aliases || ''} ${x.attribution || ''} ${scoreCollection(x)}`
        .toLowerCase()
        .includes(q)
  );
  const order = $('sort-filter').value;
  if (order === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
  if (order === 'composer') list.sort((a, b) => a.composer.localeCompare(b.composer) || a.title.localeCompare(b.title));
  return list;
}
function renderCards() {
  const list = filteredCatalog();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  libraryPage = Math.min(libraryPage, pages - 1);
  const visible = list.slice(libraryPage * PAGE_SIZE, (libraryPage + 1) * PAGE_SIZE); // Re-rendering replaces the mini scores the preview lights up, so stop it first.
  stopPreview();
  $('result-count').textContent = `${list.length} scores · curated collection`;
  $('empty').hidden = list.length > 0;
  $('pagination').hidden = list.length <= PAGE_SIZE;
  $('prev-page').disabled = libraryPage === 0;
  $('next-page').disabled = libraryPage >= pages - 1;
  $('page-status').textContent = `Page ${libraryPage + 1} of ${pages} · ${list.length} scores`;
  $('cards').innerHTML = visible
    .map(
      x =>
        `<article class="card"><div class="mini-score" id="mini-${x.id}" aria-hidden="true"></div><div class="card-body"><div class="card-top"><span class="tag">${esc(licenseLabel(x))}</span>${played.has(x.id) ? '<span class="tag played" title="You have opened this score">✓ Played</span>' : ''}<button class="favorite" data-favorite="${x.id}" aria-label="${favorites.includes(x.id) ? 'Unfavorite' : 'Favorite'} ${esc(x.title)}" aria-pressed="${favorites.includes(x.id)}">${favorites.includes(x.id) ? '★' : '☆'}</button></div><h3>${esc(x.title)}</h3><span class="small">${esc(x.composer)}</span><p>${esc(x.description)}</p><div class="card-skills">${scoreSkills(
          x
        )
          .map(
            t =>
              `<button class="chip" data-skill="${esc(t)}" aria-pressed="${$('skill-filter').value === t}" title="Show scores that practise ${esc(t.toLowerCase())}">${esc(t)}</button>`
          )
          .join(
            ''
          )}</div>${x.pdf ? `<a class="pdf-link" href="${esc(x.pdf)}" target="_blank" rel="noopener">Complete PDF · ${esc(x.originalInstrument)} ↗</a>` : ''}<div class="card-bottom"><span>${x.level} · ${esc(x.skill)}</span><button class="listen" data-listen="${x.id}" aria-pressed="false" aria-label="Listen to the opening of ${esc(x.title)}">▶ Listen</button><button data-open="${x.id}">${x.pdf ? 'Practice part' : 'Open score'} ↗</button></div></div></article>`
    )
    .join('');
  miniTunes.clear();
  for (const x of visible)
    miniTunes.set(
      x.id,
      ABCJS.renderAbc(`mini-${x.id}`, cardSnippet(x), {
        staffwidth: 380,
        scale: 0.7,
        responsive: 'resize',
        paddingtop: 15
      })?.[0]
    );
}

function renderSaved() {
  const fav = catalog.filter(x => favorites.includes(x.id)),
    versions = storedVersions();
  // History (n) appears once a score has an earlier version.
  const historyButton = x => {
    const n = versions[x.id]?.length || 0;
    return n
      ? `<button data-history="${esc(x.id)}" aria-label="History of ${esc(x.title)}: ${n} earlier version${n === 1 ? '' : 's'}">History (${n})</button>`
      : '';
  };
  $('saved-cards').innerHTML =
    saved.length || fav.length
      ? saved
          .map(
            x =>
              `<article class="card"><div class="card-body"><span class="tag">SAVED ON THIS DEVICE${x.prompt && typeof x.prompt === 'object' ? ' · ASSIGNMENT' : ''}</span><h3>${esc(x.title)}</h3><p>${esc(x.composer || 'Your composition')}<br>${new Date(x.updated).toLocaleDateString()}</p><div class="card-bottom"><button data-saved="${esc(x.id)}">Open score ↗</button>${historyButton(x)}<button data-delete="${esc(x.id)}">Delete</button></div></div></article>`
          )
          .join('') +
        fav
          .map(
            x =>
              `<article class="card"><div class="card-body"><span class="tag">FAVORITE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer)}</p><div class="card-bottom"><button data-open="${x.id}">Open score ↗</button><button data-favorite="${x.id}">Remove favorite</button></div></div></article>`
          )
          .join('')
      : '<div class="empty">Your collection starts here.<br>Save a composition or tap a star in the library.</div>';
  if (historyId) renderHistory();
}
// Library preview: hear the line shown on a card without opening the editor. One preview plays at a time,
// capped at PREVIEW_SECONDS, and its notes light up on the card.
const PREVIEW_SECONDS = 20;
let previewNodes = [],
  previewTimers = [],
  previewGeneration = 0,
  previewShow = null;
// The card shows the header (without title and composer) and the first line of music.
function cardSnippet(x) {
  const lines = x.abc.split('\n'),
    k = lines.findIndex(l => l.startsWith('K:'));
  return (
    lines
      .slice(0, k + 1)
      .filter(l => !/^T:|^C:/.test(l))
      .join('\n') +
    '\n' +
    lines[k + 1]
  );
}
function previewButton(id, on) {
  const b = document.querySelector?.(`[data-listen="${id}"]`);
  if (!b) return;
  const title = catalog.find(x => x.id === id)?.title || '';
  b.textContent = on ? '■ Stop' : '▶ Listen';
  b.setAttribute('aria-pressed', on);
  b.setAttribute('aria-label', `${on ? 'Stop' : 'Listen to'} the opening of ${title}`);
  b.closest('.card')?.classList.toggle('previewing', on);
}
function stopPreview() {
  previewGeneration++;
  previewTimers.forEach(clearTimeout);
  previewTimers = [];
  for (const node of previewNodes) {
    try {
      node.stop();
    } catch {}
  }
  previewNodes = [];
  document
    .querySelectorAll('.mini-score .abcjs-playing, .history-score .abcjs-playing')
    .forEach(el => el.classList.remove('abcjs-playing'));
  if (previewId) {
    const show = previewShow;
    previewId = null;
    previewShow = null;
    show?.(false);
  }
}
function previewCard(id) {
  const again = previewId === id;
  stopPreview();
  if (again) return;
  const item = catalog.find(x => x.id === id);
  if (!item) return;
  const filter = $('instrument-filter').value;
  playPreview(id, cardSnippet(item), instruments[filter] ? filter : 'Piano', miniTunes.get(id), PREVIEW_SECONDS, on =>
    previewButton(id, on)
  );
}
// Plays `abc` (up to `seconds`) in the given instrument and lights up the notes of `tune`, its drawing. `show(on)`
// updates the button that started it; Version history uses the same player for its preview.
async function playPreview(id, abc, instrument, tune, seconds, show) {
  stopPreview();
  stop();
  const generation = previewGeneration;
  previewId = id;
  previewShow = show;
  show(true);
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
    if (generation !== previewGeneration) return;
    const full = parseMidi(midiBytes(abc)),
      until = Math.min(full.duration, seconds),
      data = playbackSlice(full, 0, 100, until);
    if (!data.notes.length) {
      stopPreview();
      toast('This score has no notes to preview.');
      return;
    }
    const base = audio.currentTime + 0.07,
      at = (time, fn) => previewTimers.push(setTimeout(fn, Math.max(0, (base + time - audio.currentTime) * 1000)));
    scheduleNotes(data.notes, base, instrument, previewNodes);
    // Light up each note group on the drawing while it sounds.
    try {
      if (tune?.setTiming) settleTempo(tune).setTiming();
    } catch {}
    const events = (tune?.noteTimings || []).filter(
      e => e.type === 'event' && e.elements?.length && e.milliseconds / 1000 < until
    );
    let lit = [];
    for (const e of events)
      at(e.milliseconds / 1000, () => {
        if (generation !== previewGeneration) return;
        lit.forEach(el => el.classList.remove('abcjs-playing'));
        lit = e.elements.flat(2).filter(el => el?.classList);
        lit.forEach(el => el.classList.add('abcjs-playing'));
      });
    at(until + 0.15, () => {
      if (generation === previewGeneration) stopPreview();
    });
  } catch (e) {
    stopPreview();
    toast('Preview unavailable: ' + e.message);
  }
}
// Add the Played tag to a card that's already drawn, without redrawing the library's mini scores.
function markPlayedCard(id) {
  const star = document.querySelector?.(`#cards [data-favorite="${id}"]`);
  if (star && !star.parentElement.querySelector('.played'))
    star.insertAdjacentHTML(
      'beforebegin',
      '<span class="tag played" title="You have opened this score">✓ Played</span>'
    );
}
// The library entry the open score is: the entry itself, or the copy mixer.js makes of it to hold a mix, so the
// catalog never changes and the next opening of the entry starts without one.
const libraryCopies = new WeakMap();
function libraryEntry() {
  return catalog.includes(current) ? current : libraryCopies.get(current) || null;
}
// "Try next": a few tunes that share this score's skills, shown under a library score.
function renderNextUp() {
  const box = $('next-up');
  if (!box) return;
  const item = libraryEntry();
  const picks = item ? suggestNext(item, catalog, scoreSkills, played) : [];
  box.hidden = !picks.length;
  if (!picks.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="next-up-head"><strong>Try next</strong><span class="small">Tunes that practise the same skills${picks.some(p => p.step === 1) ? ', some a level up' : ''}. ✓ marks ones you've opened.</span></div><div class="next-up-cards">${picks.map(p => `<article class="next-card"><span class="small">${esc(p.item.level)}${p.step === 1 ? ' · one level up' : ''}${played.has(p.item.id) ? ' · ✓ played' : ''}</span><h3>${esc(p.item.title)}</h3><span class="small">${esc(p.item.composer)}</span><div class="card-skills">${p.shared.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div><button data-open="${esc(p.item.id)}">Open score ↗</button></article>`).join('')}</div>`;
}
// Version history for saved scores. Saving a changed copy of a saved score keeps the copy it replaces, so a student can
// look back at earlier work, hear it and restore it. Versions live apart from the scores, as score id to a list oldest
// first, each {at, abc, instrument} where `at` is when that copy was saved. They are the first thing to go when storage
// runs short: the oldest are dropped, and saving a score never fails because of them.
const VERSION_LIMIT = 20,
  VERSION_BYTES = 1.5 * 1024 * 1024;
// A stored or backed-up version map, checked for shape: damaged entries are dropped and each `at` appears once per score.
// Maps have no prototype, so any score id is a plain key.
function cleanVersions(value) {
  const out = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const kept = new Map();
    for (const v of list)
      if (v && typeof v === 'object' && Number.isFinite(v.at) && typeof v.abc === 'string' && !kept.has(v.at))
        kept.set(v.at, {at: v.at, abc: v.abc, ...(typeof v.instrument === 'string' ? {instrument: v.instrument} : {})});
    if (kept.size) out[id] = [...kept.values()].sort((a, b) => a.at - b.at);
  }
  return out;
}
const storedVersions = () => cleanVersions(storage.get(KEYS.versions, {})),
  versionsOf = id => storedVersions()[id] || [],
  versionsSize = map => JSON.stringify(map).length;
// Keeps the newest VERSION_LIMIT versions of each score, then drops the oldest of all until the map fits `budget`.
function trimVersions(map, budget = VERSION_BYTES) {
  const all = [];
  for (const id of Object.keys(map))
    for (const v of map[id].slice(-VERSION_LIMIT)) all.push({id, v, size: JSON.stringify(v).length + id.length + 6});
  let total = all.reduce((sum, x) => sum + x.size, 0);
  const out = Object.create(null);
  for (const x of all.sort((a, b) => a.v.at - b.v.at)) {
    if (total > budget) total -= x.size;
    else (out[x.id] ||= []).push(x.v);
  }
  return out;
}
// Writes the map, trimmed to its budget. When the browser refuses it, half as much is tried, down to nothing.
function storeVersions(map) {
  let budget = VERSION_BYTES;
  for (;;) {
    map = trimVersions(map, budget);
    if (!Object.keys(map).length) {
      storage.remove(KEYS.versions);
      return map;
    }
    if (storage.set(KEYS.versions, map)) return map;
    budget = versionsSize(map) / 2;
  }
}
// Stores `value` under `key`. When storage is full, the oldest versions make room first. If even dropping them all is
// not enough, the versions are put back as they were (they fit, since the write did not land) and false is returned.
function storeMakingRoom(key, value) {
  if (storage.set(key, value)) return true;
  const before = storage.get(KEYS.versions, null);
  let map = cleanVersions(before);
  while (Object.keys(map).length) {
    map = storeVersions(trimVersions(map, versionsSize(map) / 2));
    if (storage.set(key, value)) return true;
  }
  if (before !== null) storage.set(KEYS.versions, before);
  return false;
}
// Saves the score list, making room as above.
const storeScores = list => storeMakingRoom(KEYS.scores, list);
// Called after a save replaced `entry`, the previous copy of a saved score. Never throws.
function keepVersion(entry) {
  try {
    const map = storedVersions(),
      list = map[entry.id] || [],
      at = Number.isFinite(entry.updated) ? entry.updated : 0;
    if (list.some(v => v.at === at)) return;
    map[entry.id] = [...list, {at, abc: entry.abc, ...(entry.instrument ? {instrument: entry.instrument} : {})}];
    storeVersions(map);
  } catch {}
}
function removeVersions(id) {
  const map = storedVersions();
  if (!(id in map)) return;
  delete map[id];
  storeVersions(map);
}
// A score saved before saves were timed has no real time.
const versionTime = at => (at > 1e11 ? draftTime(at) : 'earlier');
// The History panel on My scores: the earlier versions of one saved score, newest first. Preview draws a version as
// the student would see it (written pitch for their instrument) and plays it; Restore opens it in the editor as
// unsaved work under the same score, so saving it keeps the copy it replaces in the list.
let historyId = null,
  historyAt = null,
  historyTune = null;
function openHistory(id) {
  if (!versionsOf(id).length) return;
  if (historyId !== id) closeHistoryPreview();
  historyId = id;
  renderHistory();
  $('history-panel').scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
  $('history-heading').focus({preventScroll: true});
}
function closeHistory(returnFocus = true) {
  const id = historyId;
  closeHistoryPreview();
  historyId = null;
  $('history-panel').hidden = true;
  if (returnFocus) [...document.querySelectorAll('[data-history]')].find(b => b.dataset.history === id)?.focus();
}
function closeHistoryPreview() {
  if (previewId === 'history') stopPreview();
  historyAt = null;
  historyTune = null;
  $('history-preview').hidden = true;
  $('history-score').innerHTML = '';
}
// Redrawn when the panel opens and whenever My scores is drawn, so its count and list stay current.
function renderHistory() {
  const entry = saved.find(x => x.id === historyId),
    list = entry ? versionsOf(historyId) : [];
  if (!list.length) {
    if (historyId) closeHistory(false);
    return;
  }
  $('history-panel').hidden = false;
  $('history-heading').textContent = `History: ${entry.title}`;
  $('history-current').textContent =
    `${list.length} earlier version${list.length === 1 ? '' : 's'}. The saved score is from ${versionTime(entry.updated)}.`;
  $('history-list').innerHTML = list
    .map((v, i) => {
      const name = `Version ${i + 1}`;
      return `<li data-at="${v.at}"><span><strong>${name}</strong> · saved ${esc(versionTime(v.at))}${v.instrument ? ' · ' + esc(v.instrument) : ''}</span><span class="history-actions"><button data-version-preview="${v.at}" aria-pressed="false" aria-label="Preview ${name}">Preview</button><button data-version-restore="${v.at}" aria-label="Restore ${name}">Restore</button></span></li>`;
    })
    .reverse()
    .join('');
  if (historyAt !== null && !list.some(v => v.at === historyAt)) closeHistoryPreview();
  markHistoryPreview();
}
function markHistoryPreview() {
  for (const b of $('history-list').querySelectorAll('[data-version-preview]')) {
    const on = +b.dataset.versionPreview === historyAt;
    b.setAttribute('aria-pressed', on);
    b.closest('li').classList.toggle('selected', on);
  }
}
// A version saved without an instrument (from an older score or backup) is drawn and played in the score's instrument.
const versionInstrument = (v, entry) => [v.instrument, entry?.instrument].find(name => instruments[name]);
// The version as drawn: the instrument's written pitch and clef, or concert pitch when Concert pitch is ticked.
function versionSource(abc, instrument) {
  const config = instruments[instrument];
  if (!config) return abc;
  let source = abc,
    shift = config.shift || 0;
  if (shift % 12 && $('concert-pitch')?.checked) shift = 0;
  if (shift)
    try {
      source = transposeABC(source, shift);
    } catch {
      source = ABCJS.strTranspose(source, ABCJS.parseOnly(source), shift);
    }
  return source.replace(/^K:(.*)$/m, (_, key) => 'K:' + key.replace(/\s+clef=\S+/g, '') + ' clef=' + config.clef);
}
function previewVersion(at) {
  const entry = saved.find(x => x.id === historyId),
    list = versionsOf(historyId),
    i = list.findIndex(v => v.at === at);
  if (i < 0) return;
  if (previewId === 'history') stopPreview();
  historyAt = at;
  markHistoryPreview();
  $('history-preview').hidden = false;
  $('history-preview-title').textContent = `Version ${i + 1}, saved ${versionTime(at)}`;
  // The editor's zoom and measures per line apply; on a phone-width panel it is drawn at 200%, so it reads.
  const width = $('history-score').clientWidth,
    zoom = width && width < 520 ? 200 : zoomPercent;
  try {
    historyTune = ABCJS.renderAbc('history-score', versionSource(list[i].abc, versionInstrument(list[i], entry)), {
      responsive: 'resize',
      ...layoutOptions(zoom),
      paddingtop: 10,
      paddingbottom: 10
    })?.[0];
  } catch {
    historyTune = null;
    $('history-score').textContent = 'This version could not be drawn.';
  }
}
function historyPlayButton(on) {
  const b = $('history-play');
  b.textContent = on ? '■ Stop' : '▶ Play';
  b.setAttribute('aria-pressed', on);
}
function playVersion() {
  if (previewId === 'history') return stopPreview();
  const entry = saved.find(x => x.id === historyId),
    v = versionsOf(historyId).find(v => v.at === historyAt);
  if (!entry || !v) return;
  playPreview('history', v.abc, versionInstrument(v, entry) || 'Piano', historyTune, Infinity, historyPlayButton);
}
// Restoring changes nothing stored: the version opens as unsaved work on the same saved score.
function restoreVersion(at) {
  const entry = saved.find(x => x.id === historyId),
    v = versionsOf(historyId).find(v => v.at === at);
  if (!entry || !v || !allowReplace()) return;
  closeHistory(false);
  dirty = false;
  openScore({...entry, abc: v.abc, instrument: versionInstrument(v, entry) || entry.instrument}, entry.id);
  dirty = true;
  cleanKey = '';
  updateRights();
  $('save-status').textContent =
    `Opened the version saved ${versionTime(at)}. Save to make it the current copy; the copy it replaces stays in History.`;
  scheduleDraft();
  focusScore();
}
$('history-close').onclick = () => closeHistory();
$('history-play').onclick = playVersion;
$('history-restore').onclick = () => restoreVersion(historyAt);
$('history-list').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b?.dataset.versionPreview) previewVersion(+b.dataset.versionPreview);
  if (b?.dataset.versionRestore) restoreVersion(+b.dataset.versionRestore);
});
$('history-panel').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHistory();
});
