'use strict';
// On-screen piano: a keyboard under the score for entering notes and chords by tapping keys. Keys are written pitch,
// as the staff shows them; the ABC source gets concert pitch, spelled for the key in force. Shift+tap, Shift+Enter,
// or holding one key while tapping others adds the pitch to the selected note as a chord. The selected note's keys
// are lit, and keys light while playback sounds them.
const PIANO_LOW = 36,
  PIANO_HIGH = 96,
  PIANO_SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  PIANO_FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const pianoBlack = midi => PIANO_SHARPS[midi % 12].length > 1,
  pianoKey = midi => $('piano-keys')?.querySelector(`[data-piano-midi="${midi}"]`);
// Five octaves, C2 to C7, in a scrolling strip. White keys sit side by side; each black key straddles the gap after
// the white key before it. Keys stay in pitch order in the DOM so screen readers and arrow keys go low to high.
function buildPiano() {
  const box = $('piano-keys');
  if (!box) return;
  let whites = 0,
    html = '';
  for (let midi = PIANO_LOW; midi <= PIANO_HIGH; midi++) {
    const octave = Math.floor(midi / 12) - 1,
      sharp = PIANO_SHARPS[midi % 12],
      tab = midi === 60 ? 0 : -1;
    if (pianoBlack(midi))
      html += `<button type="button" class="piano-key black" data-piano-midi="${midi}" style="--x:${whites}" tabindex="${tab}" aria-label="${sharp}${octave} or ${PIANO_FLATS[midi % 12]}${octave}"></button>`;
    else {
      html += `<button type="button" class="piano-key white" data-piano-midi="${midi}" style="--x:${whites}" tabindex="${tab}" aria-label="${sharp}${octave}"><span aria-hidden="true">${sharp}${midi % 12 ? '' : octave}</span></button>`;
      whites++;
    }
  }
  box.style.setProperty('--whites', whites);
  box.innerHTML = html;
}
// Written pitches of each drawn note, by display offset, read lazily from the last render.
let pianoDisplay = null,
  pianoWritten = null,
  pianoInstrument = null;
const pianoSounding = new Map();
function writtenAt(at) {
  if (!pianoWritten)
    pianoWritten = new Map(pianoDisplay ? noteLabels(pianoDisplay, 'letters').map(l => [l.at, l.written]) : []);
  return pianoWritten.get(at) || [];
}
const pianoShown = () => $('piano') && !$('piano').hidden;
// Called after every render: index the new drawing, light the selection, and face the instrument's range when the
// instrument changes.
function updatePiano(display) {
  pianoDisplay = display;
  pianoWritten = null;
  if (!pianoShown()) return;
  if (pianoInstrument !== currentInstrument()) scrollPianoToRange();
  showPianoSelection();
}
// Keys of the selected note or chord are held down; the strip scrolls to them when they are out of view.
function showPianoSelection() {
  const box = $('piano-keys');
  if (!box) return;
  box.querySelectorAll('.held').forEach(k => k.classList.remove('held'));
  if (!pianoShown()) return;
  const display = selectedNote()?.display,
    midis = display ? writtenAt(display.startChar) : [];
  for (const midi of midis) pianoKey(midi)?.classList.add('held');
  if (midis.length) scrollPianoTo(Math.min(...midis));
}
// Returns false when the strip has no width to scroll (the editor is hidden).
function scrollPianoTo(midi, center = false) {
  const strip = $('piano-scroll'),
    key = pianoKey(Math.max(PIANO_LOW, Math.min(PIANO_HIGH, midi)));
  if (!strip || !key || !strip.clientWidth) return false;
  const left = key.offsetLeft,
    right = left + key.offsetWidth;
  if (center || left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth)
    strip.scrollLeft = left - (strip.clientWidth - key.offsetWidth) / 2;
  return true;
}
// The middle line of the instrument's staff, B4 in treble clef and D3 in bass, starts in the middle of the strip.
// The instrument counts as faced only once the strip could scroll, so a strip set up while hidden faces it on showing.
function scrollPianoToRange() {
  if (scrollPianoTo(instruments[currentInstrument()]?.clef === 'bass' ? 50 : 71, true))
    pianoInstrument = currentInstrument();
}
// Playback lights: abcjs timing events name the drawn note (display offset); a key stays lit while any note on it sounds.
function pianoFollow(at, on) {
  const box = $('piano-keys');
  if (!box) return;
  if (at == null) {
    pianoSounding.clear();
    box.querySelectorAll('.sounding').forEach(k => k.classList.remove('sounding'));
    return;
  }
  for (const midi of writtenAt(at)) {
    const count = Math.max(0, (pianoSounding.get(midi) || 0) + (on ? 1 : -1));
    pianoSounding.set(midi, count);
    pianoKey(midi)?.classList.toggle('sounding', count > 0);
  }
}
// The key signature in force at a source position in one voice ('staff:voice'): the line's key, then inline K: changes.
function pianoKeyAt(tune, at, voice) {
  let key = null;
  for (const line of tune?.lines || [])
    for (const [s, staff] of (line.staff || []).entries())
      for (const [v, items] of (staff.voices || []).entries()) {
        if (s + ':' + v !== voice) continue;
        if (staff.key && (!key || (items[0]?.startChar ?? Infinity) <= at)) key = staff.key;
        for (const e of items) if (e.el_type === 'key' && e.startChar < at) key = e;
      }
  return key;
}
// ABC pitch for a concert MIDI note entered at a source position, or added to the chord there (chord: its text).
// The key signature decides the spelling; an accidental earlier in the bar or chord, or a tie into the new note,
// could change a plain letter, so check the pitch the source would give and write the accidental out if it differs.
function pianoCore(concert, at, voice, chord = null) {
  const source = $('abc').value,
    key = pianoKeyAt(ABCJS.parseOnly(source)[0], at, voice),
    core = midiToken(concert, key),
    test = chord
      ? source.slice(0, at) + addChordPitch(chord, core) + source.slice(at + chord.length)
      : source.slice(0, at) + ' ' + core + ' ' + source.slice(at),
    label = noteLabels(ABCJS.parseOnly(test)[0], 'letters').find(l => l.at === at || l.at === at + 1),
    pitches = label ? (chord ? label.written : label.written.slice(0, 1)) : [];
  return pitches.includes(concert) ? core : midiToken(concert, key, true);
}
// Name of a key as the written key signature in force at a drawn note spells it (flat names in flat keys).
function pianoName(midi, note, voice) {
  const flat = (pianoKeyAt(pianoDisplay, note?.startChar ?? Infinity, voice)?.accidentals || []).some(
    a => a.acc === 'flat'
  );
  return (flat ? PIANO_FLATS : PIANO_SHARPS)[midi % 12] + (Math.floor(midi / 12) - 1);
}
// A key press: written MIDI to concert (written − the instrument's transposition), then enter the note over the
// selected rest or after the selected note (after the last note of a range selection), or add it to the chord of
// the selected note or the note just entered. Each is one undo step and sounds the result (Hear notes).
function pianoPress(written, chord = false) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const concert = written - (instruments[currentInstrument()].shift || 0),
    sel = entrySelection(),
    target = chord && chordTarget(sel),
    note = target || sel,
    voice = note ? note.entry.key.split(':').slice(0, 2).join(':') : '0:0',
    name = pianoName(written, note?.display, voice);
  if (target) {
    const {startChar, endChar} = target.entry.element,
      added = addToChord(sel, pianoCore(concert, startChar, voice, $('abc').value.slice(startChar, endChar)));
    $('selection-status').textContent = added ? `Added ${name} to the chord.` : `${name} is already in the chord.`;
    if (!added) auditionAt(startChar);
    return;
  }
  insertCore(pianoCore(concert, entryPosition(sel), voice), sel);
  $('selection-status').textContent =
    `Added ${name}. Tap the next key to go on; Shift+tap or hold a key to add to the chord.`;
}
function setPiano(on, remember = true) {
  const piano = $('piano'),
    toggle = $('piano-toggle');
  if (!piano || !toggle) return;
  piano.hidden = !on;
  toggle.setAttribute('aria-pressed', on);
  if (remember) storage.set(KEYS.piano, on);
  if (!on) return;
  scrollPianoToRange();
  showPianoSelection();
}
// Pointer input. A mouse press enters its note at once. A touch or pen press enters on lift, because a swipe that
// starts on a key scrolls the strip or the page: it enters nothing when the browser takes it as a scroll
// (pointercancel) or it moves more than a few pixels. Keys pressed while others are down make a chord: when one lifts,
// every waiting key enters in the order it went down, the first as a note and the rest into its chord. The click
// that follows a press is skipped; clicks with no press (assistive tech) still work.
const pianoHeld = new Map(),
  PIANO_SLOP = 10;
let pianoChording = false,
  pianoLiftedAt = -Infinity;
function pianoRove(key) {
  $('piano-keys')
    .querySelectorAll('[tabindex="0"]')
    .forEach(k => (k.tabIndex = -1));
  key.tabIndex = 0;
}
// Enter every held key not yet entered. Once one has entered a note, the others go into its chord.
function pianoEnter() {
  for (const press of pianoHeld.values()) {
    if (press.entered) continue;
    press.entered = true;
    pianoPress(+press.key.dataset.pianoMidi, press.shift || pianoChording);
    pianoChording = true;
    press.key.focus({preventScroll: true});
  }
}
function pianoLift(e, enter) {
  const press = pianoHeld.get(e.pointerId);
  if (!press) return;
  if (enter) pianoEnter();
  pianoHeld.delete(e.pointerId);
  press.key.classList.remove('down');
  pianoLiftedAt = performance.now();
  if (!pianoHeld.size) pianoChording = false;
}
if ($('piano-keys')) {
  buildPiano();
  const keys = $('piano-keys');
  keys.addEventListener('pointerdown', e => {
    const key = e.target.closest('[data-piano-midi]');
    if (!key || e.button > 0) return;
    pianoHeld.delete(e.pointerId);
    pianoHeld.set(e.pointerId, {key, x: e.clientX, y: e.clientY, shift: e.shiftKey, entered: false});
    key.classList.add('down');
    pianoRove(key);
    if (e.pointerType === 'mouse') pianoEnter();
  });
  window.addEventListener(
    'pointermove',
    e => {
      const press = pianoHeld.get(e.pointerId);
      if (press && !press.entered && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PIANO_SLOP)
        pianoLift(e, false);
    },
    {passive: true}
  );
  window.addEventListener('pointerup', e => pianoLift(e, true));
  window.addEventListener('pointercancel', e => pianoLift(e, false));
  window.addEventListener('blur', () => {
    for (const press of pianoHeld.values()) press.key.classList.remove('down');
    pianoHeld.clear();
    pianoChording = false;
  });
  keys.addEventListener('click', e => {
    const key = e.target.closest('[data-piano-midi]');
    if (!key || pianoHeld.size || performance.now() - pianoLiftedAt < 600) return;
    pianoRove(key);
    pianoPress(+key.dataset.pianoMidi, e.shiftKey);
    key.focus({preventScroll: true});
  });
  // A long press on a touch screen would open the browser's menu.
  keys.addEventListener('contextmenu', e => e.preventDefault());
  // Keyboard: ←→ move between keys (Home/End to the ends), Enter or Space enters the note, Shift adds it to the chord.
  // Other keys go to the score's own shortcuts, so 3–7 set the length and Delete removes the note without leaving.
  keys.addEventListener('keydown', e => {
    const key = e.target.closest('[data-piano-midi]');
    if (!key) return;
    const midi = +key.dataset.pianoMidi,
      move = {ArrowLeft: -1, ArrowRight: 1, Home: PIANO_LOW - midi, End: PIANO_HIGH - midi}[e.key];
    if (move != null && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const next = pianoKey(Math.max(PIANO_LOW, Math.min(PIANO_HIGH, midi + move)));
      pianoRove(next);
      next.focus();
      scrollPianoTo(+next.dataset.pianoMidi);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return;
      pianoPress(midi, e.shiftKey);
      key.focus({preventScroll: true});
      return;
    }
    if (e.key !== 'Tab' && scoreKey(e)) {
      e.preventDefault();
      key.focus({preventScroll: true});
    }
  });
  keys.addEventListener('keyup', e => {
    if (e.key === ' ') e.preventDefault();
  });
  $('piano-toggle').onclick = () => setPiano($('piano').hidden);
  // The strip has no width while the editor is hidden (the app opens on the library, and a score renders before its
  // view shows), so it faces the instrument's range and the selection when it appears.
  if (typeof ResizeObserver === 'function')
    new ResizeObserver(() => {
      if (!$('piano-scroll').clientWidth) pianoInstrument = null;
      else if (pianoInstrument !== currentInstrument()) {
        scrollPianoToRange();
        showPianoSelection();
      }
    }).observe($('piano-scroll'));
  setPiano(storage.get(KEYS.piano, false) === true, false);
}
