'use strict';
// Wiring and start-up: navigation, event bindings for the controls, persisted settings, first render.
// Loaded last; the other files define state and functions and bind events on their own elements.
function show(view) {
  document.querySelectorAll('.view').forEach(el => (el.hidden = el.id !== view));
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (view === 'saved') {
    renderSaved();
    renderBackupStatus();
  }
  if (view !== 'studio') stop();
  if (view !== 'library') stopPreview();
  history.replaceState(null, '', '#' + view);
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function allowReplace() {
  return !dirty || confirm('Replace your unsaved changes? Save or export first if you want to keep them.');
}
function openScore(item, id = null) {
  if (!allowReplace()) return;
  stop();
  stopPreview();
  current = item;
  savedId = id;
  dirty = false;
  selectedRange = null;
  $('selection-status').textContent =
    'Click a note to select its ABC text; Shift+click another to practice from the first to the second. Drag up/down to change pitch; chords move together.';
  $('start-measure').value = 1;
  $('end-measure').value = '';
  $('abc').value = item.abc;
  inputLength = null;
  $('instrument').value =
    item.instrument || ($('instrument-filter').value === 'all' ? 'Flute' : $('instrument-filter').value);
  resetHistory();
  syncFields();
  render();
  $('save-status').textContent = '';
  if (catalog.includes(item) && !played.has(item.id)) {
    played.add(item.id);
    storage.set(KEYS.played, [...played]);
    markPlayedCard(item.id);
  }
  renderNextUp();
  show('studio');
}
// A new score is a blank sheet: whole-bar rests in 4/4, so drawing or typing writes straight onto empty bars.
const DEFAULT_BARS = 8;
function newScore(bars) {
  if (typeof bars !== 'number') bars = +$('new-bars')?.value || DEFAULT_BARS;
  bars = Math.max(1, Math.min(64, Math.round(bars) || DEFAULT_BARS));
  if (!allowReplace()) return;
  dirty = false;
  openScore({
    title: 'Untitled melody',
    composer: '',
    kind: 'personal',
    abc: promptSource({title: 'Untitled melody', meter: '4/4', unit: '1/4', tempo: 100, key: 'C', bars})
  });
  const first = scoreNotes()[0];
  if (first) selectEntry(first);
  $('selection-status').textContent =
    `Blank sheet of ${bars} bars. Click a bar and type A–G, or turn on Draw notes and click the staff; each bar fills from its rest. ＋ 4 bars adds more.`;
}
for (const name of Object.keys(instruments)) $('instrument').add(new Option(name, name));
for (const note of 'CDEFGAB') {
  $('note-buttons').insertAdjacentHTML('beforeend', `<button data-token="${note}">${note}</button>`);
}
document.querySelectorAll('.nav').forEach(b => (b.onclick = () => show(b.dataset.view)));
document.querySelectorAll('.brand').forEach(
  a =>
    (a.onclick = e => {
      e.preventDefault();
      show('library');
    })
);
$('browse').onclick = () => $('library-top').scrollIntoView({behavior: 'smooth'});
$('start-writing').onclick = $('new-score').onclick = $('saved-new').onclick = newScore;
for (const id of [
  'search',
  'level-filter',
  'skill-filter',
  'kind-filter',
  'instrument-filter',
  'genre-filter',
  'sort-filter',
  'collection-filter',
  'license-filter'
])
  $(id).addEventListener('input', () => {
    libraryPage = 0;
    renderCards();
  });
$('prev-page').onclick = () => {
  libraryPage = Math.max(0, libraryPage - 1);
  renderCards();
  $('library-top').scrollIntoView({behavior: 'smooth'});
};
$('next-page').onclick = () => {
  libraryPage++;
  renderCards();
  $('library-top').scrollIntoView({behavior: 'smooth'});
};
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.listen) previewCard(b.dataset.listen);
  if (b.dataset.skill) {
    const f = $('skill-filter');
    f.value = f.value === b.dataset.skill ? 'all' : b.dataset.skill;
    libraryPage = 0;
    renderCards();
    $('library-top').scrollIntoView({behavior: 'smooth'});
  }
  if (b.dataset.open) openScore(catalog.find(x => x.id === b.dataset.open));
  if (b.dataset.saved) {
    const x = saved.find(x => x.id === b.dataset.saved);
    if (x) openScore(x, x.id);
  }
  if (b.dataset.favorite) {
    const id = b.dataset.favorite;
    const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id];
    if (storage.set(KEYS.favorites, next)) {
      favorites = next;
      renderCards();
      renderSaved();
    } else toast('This browser could not save favorites.');
  }
  if (b.dataset.delete && confirm('Delete this locally saved score?')) {
    const next = saved.filter(x => x.id !== b.dataset.delete);
    if (storage.set(KEYS.scores, next)) {
      saved = next;
      renderSaved();
      if (savedId === b.dataset.delete) savedId = null;
    } else toast('Deletion could not be saved.');
  }
  if (b.dataset.token) insertToken(b.dataset.token);
});
$('abc').addEventListener('beforeinput', () => noteTyping('abc'));
$('abc').addEventListener('input', () => {
  syncFields();
  changed();
});
for (const [id, header] of [
  ['title', 'T'],
  ['composer', 'C'],
  ['meter', 'M'],
  ['key', 'K'],
  ['bpm', 'Q']
])
  $(id).addEventListener('input', () => {
    noteTyping(id);
    setHeader(header, id === 'bpm' ? '1/4=' + $(id).value : $(id).value);
    $('bpm-value').textContent = $('bpm').value;
    changed();
  }); // On a prompt score the assignment is in written pitch, so a new instrument transposes the concert source to keep
// every written note, and the written key, exactly where the student put them.
$('instrument').onchange = () => {
  const before = instruments[instrumentShown]?.shift || 0,
    after = instruments[currentInstrument()].shift || 0,
    source = $('abc').value;
  if (current?.prompt && promptById(current.prompt) && before !== after) {
    flushTyping();
    $('abc').value = ABCJS.strTranspose(source, ABCJS.parseOnly(source), before - after);
    selectedRange = null;
  }
  instrumentShown = currentInstrument();
  changed();
};
$('volume').oninput = () => {
  if (playing) {
    stop();
    toast('Volume updated. Press Play to resume.');
  }
};
$('help-toggle').onclick = () => {
  $('abc-help').hidden = !$('abc-help').hidden;
};
$('save').onclick = () => {
  const id = savedId || globalThis.crypto?.randomUUID?.() || 'score-' + Date.now();
  const entry = {
    ...current,
    id,
    title: field('T', 'Untitled'),
    composer: field('C'),
    abc: $('abc').value,
    instrument: currentInstrument(),
    updated: Date.now()
  };
  const next = saved.filter(x => x.id !== id).concat(entry);
  if (storage.set(KEYS.scores, next)) {
    saved = next;
    savedId = id;
    dirty = false;
    markClean();
    $('save-status').textContent = 'Saved on this device. Back up from My scores to keep it safe.';
    renderBackupStatus();
    toast('Score saved');
    render();
  } else {
    $('save-status').textContent = 'This browser could not save. Export an ABC file to keep your score.';
  }
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async () => {
  const file = $('import-file').files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    toast('Please use an ABC file smaller than 1 MB.');
    return;
  }
  try {
    const source = await file.text();
    if (ABCJS.numberOfTunes(source) !== 1) throw new Error('Please import one ABC tune at a time.');
    if (!/^K:/m.test(source) || !/^X:/m.test(source)) throw new Error('Expected an ABC score with X: and K: headers.');
    if (!allowReplace()) return;
    dirty = false;
    const notice = source.match(/^% FretFree-Rights: (.*)$/m);
    let metadata = {};
    if (notice) {
      try {
        metadata = JSON.parse(notice[1]);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
      } catch {}
    }
    openScore({...metadata, kind: 'personal', abc: source});
    dirty = true;
    $('save-status').textContent = 'Imported locally. Save or export to keep a copy.';
  } catch (e) {
    toast(e.message);
  } finally {
    $('import-file').value = '';
  }
};
$('play').onclick = () => play();
for (const id of ['start-measure', 'end-measure'])
  $(id).onchange = () => {
    const {from, to} = measureRange();
    setRange(from, to);
  };
// Practice toggles are per-browser conveniences; applyStoredSettings() also runs after a backup is restored.
function applyStoredSettings() {
  for (const id of ['loop', 'metronome', 'count-in', 'trainer'])
    $(id).checked = !!storage.get(KEYS.practice(id), false);
  $('fingering').checked = storage.get(KEYS.fingering, true) !== false;
  $('note-names').value = storage.get(KEYS.noteNames, 'off');
  prepareTrainer();
}
for (const id of ['loop', 'metronome', 'count-in', 'trainer']) {
  $(id).checked = !!storage.get(KEYS.practice(id), false);
  $(id).addEventListener('change', () => {
    storage.set(KEYS.practice(id), $(id).checked);
    if (id === 'trainer') prepareTrainer();
  });
}
$('trainer-goal').addEventListener('change', () => {
  $('trainer-goal').value = trainerGoal();
  prepareTrainer();
});
$('speed').oninput = () => {
  const position = playing ? playOrigin + Math.max(0, audio.currentTime - playClock) * playSpeed : null;
  $('speed-value').textContent = $('speed').value + '%';
  if (position != null) {
    stop();
    play(position);
  }
};
$('speed-reset').onclick = () => {
  $('speed').value = 100;
  $('speed').oninput();
};
$('stop').onclick = stop;
$('print').onclick = () => {
  render();
  const appendix = $('print-appendix');
  appendix.innerHTML = scoreLicense(current).startsWith('GPL-')
    ? '<h2>Editable source and GPL license</h2><pre>' +
      esc(
        exportCredit(current) +
          '\n\nCorresponding editable ABC (FretFree export, 2026-10-03):\n' +
          $('abc').value +
          '\n\n' +
          GPL_LICENSE
      ) +
      '</pre>'
    : '';
  window.print();
};
$('export-abc').onclick = () => download(creditedABC($('abc').value, current), safeName() + '.abc', 'text/plain');
$('export-midi').onclick = () => {
  try {
    download(creditedMidi(midiBytes($('abc').value), $('abc').value, current), safeName() + '.mid', 'audio/midi');
  } catch (e) {
    toast(e.message);
  }
};
$('export-svg').onclick = () => {
  try {
    clearTimeout(renderTimer);
    render();
    download(creditedSVG($('notation'), $('abc').value, current), safeName() + '.svg', 'image/svg+xml');
  } catch (e) {
    toast(e.message);
  }
};
window.addEventListener('beforeunload', e => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
const initialView = location.hash.slice(1);
for (const name of [...new Set(catalog.map(scoreCollection))].sort())
  $('collection-filter').add(new Option(name, name));
for (const name of [...new Set(catalog.map(scoreLicense))].sort()) $('license-filter').add(new Option(name, name));
for (const skill of SKILLS) $('skill-filter').add(new Option(skill, skill));
for (const genre of [...new Set(catalog.map(x => x.genre || 'Teaching melodies'))].sort())
  $('genre-filter').add(new Option(genre, genre));
$('hero-count').textContent = '01 / ' + catalog.length;
ABCJS.renderAbc('hero-notation', catalog[0].abc, {
  staffwidth: 460,
  responsive: 'resize',
  scale: 0.9,
  paddingtop: 25,
  paddingbottom: 30
});
renderCards();
newScore();
if (initialView.startsWith('s=')) {
  show('studio');
  openSharedLink(initialView).then(ok => {
    if (!ok) show('library');
  });
} else show(['studio', 'saved', 'about'].includes(initialView) ? initialView : 'library');
$('fingering').checked = storage.get(KEYS.fingering, true) !== false;
$('fingering').onchange = () => {
  storage.set(KEYS.fingering, $('fingering').checked);
  render();
};
$('note-names').value = storage.get(KEYS.noteNames, 'off');
if (noteNamesMode() !== 'off') render();
$('note-names').onchange = () => {
  storage.set(KEYS.noteNames, $('note-names').value);
  render();
};
// A remembered speed trainer needs the same below-goal start as a freshly ticked one.
prepareTrainer();
