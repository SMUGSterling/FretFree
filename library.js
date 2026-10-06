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
  const fav = catalog.filter(x => favorites.includes(x.id));
  $('saved-cards').innerHTML =
    saved.length || fav.length
      ? saved
          .map(
            x =>
              `<article class="card"><div class="card-body"><span class="tag">SAVED ON THIS DEVICE${x.prompt && typeof x.prompt === 'object' ? ' · ASSIGNMENT' : ''}</span><h3>${esc(x.title)}</h3><p>${esc(x.composer || 'Your composition')}<br>${new Date(x.updated).toLocaleDateString()}</p><div class="card-bottom"><button data-saved="${esc(x.id)}">Open score ↗</button><button data-delete="${esc(x.id)}">Delete</button></div></div></article>`
          )
          .join('') +
        fav
          .map(
            x =>
              `<article class="card"><div class="card-body"><span class="tag">FAVORITE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer)}</p><div class="card-bottom"><button data-open="${x.id}">Open score ↗</button><button data-favorite="${x.id}">Remove favorite</button></div></div></article>`
          )
          .join('')
      : '<div class="empty">Your collection starts here.<br>Save a composition or tap a star in the library.</div>';
}
// Library preview: hear the line shown on a card without opening the editor. One preview plays at a time,
// capped at PREVIEW_SECONDS, and its notes light up on the card.
const PREVIEW_SECONDS = 20;
let previewNodes = [],
  previewTimers = [],
  previewGeneration = 0;
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
  document.querySelectorAll('.mini-score .abcjs-playing').forEach(el => el.classList.remove('abcjs-playing'));
  if (previewId) {
    const id = previewId;
    previewId = null;
    previewButton(id, false);
  }
}
async function previewCard(id) {
  const again = previewId === id;
  stopPreview();
  if (again) return;
  const item = catalog.find(x => x.id === id);
  if (!item) return;
  stop();
  const generation = previewGeneration;
  previewId = id;
  previewButton(id, true);
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
    if (generation !== previewGeneration) return;
    const full = parseMidi(midiBytes(cardSnippet(item))),
      until = Math.min(full.duration, PREVIEW_SECONDS),
      data = playbackSlice(full, 0, 100, until);
    if (!data.notes.length) {
      stopPreview();
      toast('This score has no notes to preview.');
      return;
    }
    const filter = $('instrument-filter').value,
      base = audio.currentTime + 0.07,
      at = (time, fn) => previewTimers.push(setTimeout(fn, Math.max(0, (base + time - audio.currentTime) * 1000)));
    scheduleNotes(data.notes, base, instruments[filter] ? filter : 'Piano', previewNodes);
    // Light up each note group on the card's mini score while it sounds.
    const tune = miniTunes.get(id);
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
// "Try next": a few tunes that share this score's skills, shown under a library score.
function renderNextUp() {
  const box = $('next-up');
  if (!box) return;
  const item = catalog.includes(current) ? current : null;
  const picks = item ? suggestNext(item, catalog, scoreSkills, played) : [];
  box.hidden = !picks.length;
  if (!picks.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="next-up-head"><strong>Try next</strong><span class="small">Tunes that practise the same skills${picks.some(p => p.step === 1) ? ', some a level up' : ''}. ✓ marks ones you've opened.</span></div><div class="next-up-cards">${picks.map(p => `<article class="next-card"><span class="small">${esc(p.item.level)}${p.step === 1 ? ' · one level up' : ''}${played.has(p.item.id) ? ' · ✓ played' : ''}</span><h3>${esc(p.item.title)}</h3><span class="small">${esc(p.item.composer)}</span><div class="card-skills">${p.shared.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div><button data-open="${esc(p.item.id)}">Open score ↗</button></article>`).join('')}</div>`;
}
