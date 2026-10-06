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
function scrollPianoTo(midi, center = false) {
  const strip = $('piano-scroll'),
    key = pianoKey(Math.max(PIANO_LOW, Math.min(PIANO_HIGH, midi)));
  if (!strip || !key || !strip.clientWidth) return;
  const left = key.offsetLeft,
    right = left + key.offsetWidth;
  if (center || left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth)
    strip.scrollLeft = left - (strip.clientWidth - key.offsetWidth) / 2;
}
// The middle line of the instrument's staff, B4 in treble clef and D3 in bass, starts in the middle of the strip.
function scrollPianoToRange() {
  pianoInstrument = currentInstrument();
  scrollPianoTo(instruments[pianoInstrument]?.clef === 'bass' ? 50 : 71, true);
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
function keyAt(tune, at, voice) {
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
    key = keyAt(ABCJS.parseOnly(source)[0], at, voice),
    core = midiToken(concert, key),
    test = chord
      ? source.slice(0, at) + addChordPitch(chord, core) + source.slice(at + chord.length)
      : source.slice(0, at) + ' ' + core + ' ' + source.slice(at),
    label = noteLabels(ABCJS.parseOnly(test)[0], 'letters').find(l => l.at === at || l.at === at + 1),
    pitches = label ? (chord ? label.written : label.written.slice(0, 1)) : [];
  return pitches.includes(concert) ? core : midiToken(concert, key, true);
}
// Name of a key as the written key signature would spell it (flat names in flat keys).
function pianoName(midi) {
  const key = pianoDisplay?.lines?.[0]?.staff?.[0]?.key,
    flat = (key?.accidentals || []).some(a => a.acc === 'flat');
  return (flat ? PIANO_FLATS : PIANO_SHARPS)[midi % 12] + (Math.floor(midi / 12) - 1);
}
// A key press: written MIDI to concert (written − the instrument's transposition), then enter the note over the
// selected rest or after the selected note, or add it to the selected note's chord. Each is one undo step and sounds
// the result (Hear notes).
function pianoPress(written, chord = false) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const concert = written - (instruments[currentInstrument()].shift || 0),
    sel = selectedNote(),
    voice = sel ? sel.entry.key.split(':').slice(0, 2).join(':') : '0:0',
    name = pianoName(written);
  const target = chord && chordTarget(sel);
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
// Pointer input. Entry happens on pointerdown, so a held key is known when the next one goes down (two fingers on a
// tablet make a chord); the click that follows is skipped. Clicks with no pointerdown (assistive tech) still work.
const pianoHeld = new Set();
let pianoSkipClick = false;
function pianoRove(key) {
  $('piano-keys')
    .querySelectorAll('[tabindex="0"]')
    .forEach(k => (k.tabIndex = -1));
  key.tabIndex = 0;
}
function releasePiano(e) {
  pianoHeld.delete(e.pointerId);
  if (!pianoHeld.size)
    $('piano-keys')
      ?.querySelectorAll('.down')
      .forEach(k => k.classList.remove('down'));
  setTimeout(() => (pianoSkipClick = false));
}
if ($('piano-keys')) {
  buildPiano();
  const keys = $('piano-keys');
  keys.addEventListener('pointerdown', e => {
    const key = e.target.closest('[data-piano-midi]');
    if (!key || e.button > 0) return;
    pianoHeld.delete(e.pointerId);
    const chord = e.shiftKey || pianoHeld.size > 0;
    pianoHeld.add(e.pointerId);
    pianoSkipClick = true;
    key.classList.add('down');
    pianoRove(key);
    pianoPress(+key.dataset.pianoMidi, chord);
  });
  window.addEventListener('pointerup', releasePiano);
  window.addEventListener('pointercancel', releasePiano);
  window.addEventListener('blur', () => pianoHeld.clear());
  keys.addEventListener('click', e => {
    const key = e.target.closest('[data-piano-midi]');
    if (!key || pianoSkipClick) return;
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
  setPiano(storage.get(KEYS.piano, false) === true, false);
}
