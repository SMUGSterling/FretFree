'use strict';
// Editor: the open score and its state, rendering, selection and drag, range selection and the clipboard, undo/redo,
// bar check, draw mode, the note menu, keyboard note entry, fingering diagrams and writing prompts.
let current = null,
  savedId = null,
  dirty = false,
  renderTimer;
let renderedSource = null,
  renderedWritten = null,
  renderedTune = null,
  noteSources = new Map(),
  measureStarts = new Map(),
  selectedRange = null,
  selectionAnchor = null;
let staffClefs = [],
  shownElements = new Map(),
  inputLength = null,
  instrumentShown = '';
function field(name, defaultValue = '') {
  const match = $('abc').value.match(new RegExp('^' + name + ':(.*)$', 'm'));
  return match ? match[1].trim() : defaultValue;
}
function assignSelect(id, value, label = value) {
  const select = $(id);
  if (![...select.options].some(o => o.value === value)) select.add(new Option(label, value));
  select.value = value;
}
function syncFields() {
  $('title').value = field('T', 'Untitled');
  $('composer').value = field('C');
  assignSelect('meter', field('M', '4/4'));
  assignSelect('key', canonicalKey(field('K', 'C')), keyLabel(field('K', 'C')));
  hideKeyChoice();
  const m = field('Q', '100').match(/(\d+)\s*$/);
  $('bpm').value = m ? Math.max(40, Math.min(200, +m[1])) : 100;
  $('bpm-value').textContent = $('bpm').value;
}
function setHeader(name, value) {
  if (name === 'K') $('abc').value = withKey($('abc').value);
  const lines = $('abc').value.split('\n'),
    i = lines.findIndex(x => x.startsWith(name + ':'));
  let text = name + ':' + String(value).replace(/[\r\n]/g, ' ');
  // A new key keeps the clef and other modifiers written after the old one.
  if (name === 'K' && i >= 0) text += keyParts(lines[i].slice(2)).rest.replace(/^(?=\S)/, ' ');
  if (i >= 0) lines[i] = text;
  else
    lines.splice(
      Math.max(
        0,
        lines.findIndex(x => x.startsWith('K:'))
      ),
      0,
      text
    );
  $('abc').value = lines.join('\n');
}
// The instrument's shift: its part is written this many semitones above the concert source (2 for a B-flat clarinet,
// 9 for an E-flat alto sax). Cello and trombone show the source an octave lower, a range change, not a transposition.
const instrumentShift = () => instruments[currentInstrument()]?.shift || 0,
  transposesInstrument = () => instrumentShift() % 12 !== 0;
// Concert pitch view, display only: a transposing instrument's score shows the source's sounding pitches and key.
// Everything that reads or enters what is shown goes through displayShift(); playback and the ABC never change.
const concertView = () => transposesInstrument() && $('concert-pitch')?.checked === true,
  displayShift = () => (concertView() ? 0 : instrumentShift());
// The score as drawn: the source at the display shift (the instrument's written pitch unless Concert pitch is on),
// with the instrument's clef and the display-only labels. Pass the instrument's shift to get the written part.
function writtenABC(shift = displayShift()) {
  let source = $('abc').value;
  const config = instruments[currentInstrument()];
  if (shift)
    try {
      source = transposeABC(source, shift);
    } catch {
      source = ABCJS.strTranspose(source, ABCJS.parseOnly(source), shift);
    }
  source = source.replace(/^K:(.*)$/m, (_, key) => 'K:' + key.replace(/\s+clef=\S+/g, '') + ' clef=' + config.clef);
  if (fingeringShown() === 'recorder') source = source.replace(/^(X:.*)$/m, '$1\n%%staffsep 190');
  // abcjs draws no trill lines, so the score shows tr on the first note and updateTrillLines draws the wavy line.
  source = source.replace(/!trill\(!/g, '!trill!');
  return labelSource(source, noteNamesMode());
}
// Note names under the score: off, letters or movable-do solfège; display only, never written to the ABC source.
// "Letters in noteheads" draws inside the heads instead (updateNoteColors), so it adds no labels under the score.
const noteNamesMode = () => ($('note-names')?.value === 'heads' ? 'off' : $('note-names')?.value || 'off');
const lettersInHeads = () => $('note-names')?.value === 'heads';
// Classroom colors (Boomwhacker and handbell order) by written letter; accidentals keep their letter's color.
// `ink` is the letter drawn inside a colored head; E's light yellow gets a dark outline so it shows on white paper.
const NOTE_COLORS = {
  C: {fill: '#d62828', ink: 'white'},
  D: {fill: '#f77f00', ink: 'black'},
  E: {fill: '#ffd60a', ink: 'black', stroke: '#6b5300'},
  F: {fill: '#2b8a3e', ink: 'white'},
  G: {fill: '#4cc9f0', ink: 'black'},
  A: {fill: '#1d3fbb', ink: 'white'},
  B: {fill: '#7b2cbf', ink: 'white'}
};
const noteColorsShown = () => $('note-colors')?.value === 'classroom';
// Fingering under the score: guitar tab (abcjs) for Guitar, hole diagrams for Recorder; display only.
const FINGERING = {
  Guitar: {kind: 'guitar', label: 'Guitar tab'},
  Recorder: {kind: 'recorder', label: 'Recorder fingering'}
};
const fingeringShown = () => ($('fingering')?.checked !== false && FINGERING[currentInstrument()]?.kind) || null;
// Zoom and measures per line, display only. Zoom narrows the staff width abcjs lays out and `responsive: 'resize'`
// stretches the SVG back to the panel width, so the notes grow while abcjs keeps its default scale (drag, draw and
// STAFF_STEP assume it). A chosen number of measures per line, or zooming in on Auto, lets abcjs re-flow the lines.
const ZOOM_LEVELS = [70, 85, 100, 120, 140, 170, 200],
  MEASURES_PER_LINE = [2, 3, 4, 6],
  BASE_STAFF_WIDTH = 740;
let zoomPercent = 100;
const validZoom = z => (ZOOM_LEVELS.includes(+z) ? +z : 100),
  validMeasuresPerLine = n => (MEASURES_PER_LINE.includes(+n) ? +n : 0),
  measuresPerLine = () => validMeasuresPerLine($('measures-per-line')?.value);
// Text set across the page (title, subtitles, composer, rhythm, parts, tempo, words and notes under the music) keeps
// its 100% size when zoomed in, so a long title or composer credit still fits the narrower staff width. Sizes are
// the abcjs defaults in points; a font directive in the ABC itself still wins.
const PAGE_FONTS = {
  titlefont: [20],
  subtitlefont: [16],
  composerfont: [14, 'italic'],
  infofont: [14, 'italic'],
  partsfont: [15],
  tempofont: [15, 'bold'],
  historyfont: [16],
  wordsfont: [16],
  textfont: [16]
};
const pageFonts = scale =>
  Object.fromEntries(
    Object.entries(PAGE_FONTS).map(([name, [size, style = '']]) => [
      name,
      `"Times New Roman" ${+(size * scale).toFixed(2)} ${style}`.trim()
    ])
  );
function layoutOptions(zoom = zoomPercent, perLine = measuresPerLine()) {
  const spacing = {minSpacing: 1.8, maxSpacing: 2.7};
  zoom = validZoom(zoom);
  return {
    staffwidth: Math.round(BASE_STAFF_WIDTH / (zoom / 100)),
    ...(perLine ? {wrap: {...spacing, preferredMeasuresPerLine: perLine}} : zoom > 100 ? {wrap: spacing} : {}),
    ...(zoom > 100 ? {format: pageFonts(100 / zoom)} : {})
  };
}
// The end buttons stay focusable at the limits (aria-disabled), so a keyboard user pressing + again keeps focus.
function showZoom(z) {
  zoomPercent = validZoom(z);
  const i = ZOOM_LEVELS.indexOf(zoomPercent);
  $('zoom-out')?.setAttribute('aria-disabled', String(i === 0));
  $('zoom-in')?.setAttribute('aria-disabled', String(i === ZOOM_LEVELS.length - 1));
  if ($('zoom-reset')) {
    $('zoom-reset').textContent = zoomPercent + '%';
    $('zoom-reset').setAttribute('aria-label', `Zoom ${zoomPercent}%. Reset to 100%`);
  }
}
// step -1 or +1 moves one zoom level; 0 goes back to 100%. The choice is remembered and the score redrawn. The zoom
// buttons keep their names, so the status line announces the new size, and says so when a limit is reached.
function stepZoom(step) {
  const i = ZOOM_LEVELS.indexOf(zoomPercent),
    next = step ? ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + step))] : 100,
    limit =
      step && next === zoomPercent ? (step > 0 ? ' This is the largest size.' : ' This is the smallest size.') : '';
  if (next !== zoomPercent) {
    showZoom(next);
    storage.set(KEYS.zoom, zoomPercent);
    render();
  }
  $('selection-status').textContent = `Zoom ${zoomPercent}%.${limit}`;
}
function scoreClick(element, tuneNumber, classes, analysis, drag, event) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Select the note again.');
    return;
  }
  const entry = noteSources.get(element.startChar);
  if (!entry) return;
  // A note picked on the score takes chord pitches from now on, not the note entered last.
  lastEntry = null;
  const area = $('abc'),
    start = entry.element.startChar,
    end = entry.element.endChar;
  if (start == null || end == null) return;
  // Shift+click extends the selection from its anchor, the note where it started.
  const before = selectedNotes(),
    anchorEntry = selectionAnchor === 'last' ? before.at(-1) : before[0],
    anchor = anchorEntry?.measure;
  selectionAnchor = null;
  let nextEnd = end;
  // Bundled abcjs 6.5.2 reports SVG Y steps: negative is upward.
  if (drag?.step && entry.element.pitches?.length) {
    flushTyping();
    const old = area.value.slice(start, end),
      replacement = moveNoteText(old, -drag.step);
    area.setRangeText(replacement, start, end, 'select');
    nextEnd = start + replacement.length;
    dirty = true;
    $('save-status').textContent = 'Unsaved changes';
    clearTimeout(renderTimer);
    selectedRange = [start, nextEnd];
    auditionEdit(start);
    render();
  }
  selectedRange = [start, nextEnd];
  area.setSelectionRange(start, nextEnd);
  focusScore();
  if (typeof showPianoSelection === 'function') showPianoSelection();
  // A plain click only selects, so editing never moves the practice range. Shift+click selects the notes from the
  // anchor to the clicked one and sets the range from the anchor's measure to the clicked one (from the clicked
  // measure to the end when nothing was selected).
  if (event?.shiftKey && !drag?.step) {
    const from = anchor ?? entry.measure,
      to = anchor == null ? +$('end-measure').max : entry.measure,
      run = anchorEntry && entry.element.el_type === 'note' ? selectNotesBetween(anchorEntry, entry) : [];
    setRange(from, to);
    if (run.length > 1) $('selection-status').textContent += ` ${run.length} notes selected.`;
    refreshPalette();
    return;
  }
  $('selection-status').textContent =
    `Measure ${entry.measure} selected · type A–G to add notes after it, ↑↓ to change pitch · Shift+click another note to practice from here to there`;
  // A pointer click sounds the note (Hear notes); a drag sounded it before the render. Calls from code pass no
  // event, so the note menu stays quiet.
  if (event && !drag?.step) auditionAt(start);
  refreshPalette();
}
// The notation palette (palette.js) shows the selection's state; it is optional, so editing works without it.
function refreshPalette() {
  if (typeof updatePalette === 'function') updatePalette();
}
function updateMeasures() {
  measureStarts = new Map();
  if (renderedTune?.engraver) {
    renderedTune.setTiming();
    for (const event of renderedTune.noteTimings || []) {
      if (event.type !== 'event') continue;
      const entries = (event.startCharArray || []).map(c => noteSources.get(c)).filter(Boolean);
      for (const entry of entries)
        if (!measureStarts.has(entry.measure)) measureStarts.set(entry.measure, event.milliseconds / 1000);
    }
  }
  const total = Math.max(
    1,
    ...[...noteSources.values()]
      .filter(Boolean)
      .filter(e => e.element.el_type === 'note')
      .map(e => e.measure)
  );
  // The end follows the last measure unless the student picked an earlier one.
  const followEnd = !+$('end-measure').value || +$('end-measure').value >= +$('end-measure').max;
  $('start-measure').max = $('end-measure').max = total;
  $('start-measure').value = Math.max(1, Math.min(total, +$('start-measure').value || 1));
  $('end-measure').value = followEnd
    ? total
    : Math.max(+$('start-measure').value, Math.min(total, +$('end-measure').value));
  $('measure-count').textContent = `of ${total}`;
  shadeRange();
}
// Rendering the open score: engrave the written-pitch ABC, index the drawn notes against the source, then refresh
// the measures, checks and panels around the score. Everything else reads the state this sets.
function render() {
  stop();
  recordHistory();
  instrumentShown = currentInstrument();
  const scoreFocused = $('notation')?.contains?.(document.activeElement);
  try {
    const source = writtenABC();
    renderedSource = $('abc').value;
    renderedWritten = source;
    const original = ABCJS.parseOnly(renderedSource)[0];
    const display = ABCJS.parseOnly(source)[0];
    noteSources = sourceMap(original, display);
    renderedTune = ABCJS.renderAbc('notation', source, engraveOptions())[0];
    if (scoreFocused) focusScore();
    updateFingering(source);
    updateNoteColors();
    indexDisplay(display);
    updateTrillLines();
    updateMeasures();
    updateBarCheck(original);
    updatePromptCheck(display);
    if (typeof updateAssignmentBuilder === 'function') updateAssignmentBuilder();
    restoreSelection(display);
    if (typeof updatePiano === 'function') updatePiano(display);
    $('warnings').textContent = (renderedTune?.warnings || []).map(x => String(x).replace(/<[^>]+>/g, '')).join(' · ');
    updateCaption();
    updateSourceEdition();
    updateRights();
    refreshTranspose();
  } catch (e) {
    $('warnings').textContent = 'Could not render this score: ' + e.message;
  }
  scheduleDraft();
  refreshPalette();
}
// abcjs 6.5.2 loses the tablature when it re-parses a re-flowed score, so the re-parsed tune gets it back here. The
// tablature setup depends only on these options, so a bare tune is parsed for it instead of the whole score again.
const GUITAR_TAB = [{instrument: 'guitar', label: 'Guitar'}];
function keepTablature(tune) {
  if (!tune.tablatures) tune.tablatures = ABCJS.parseOnly('X:1\nK:C\n', {tablature: GUITAR_TAB})[0]?.tablatures;
}
// abcjs options for the main score: zoom and line layout from the view controls. Guitar adds a tab staff; recorder
// leaves room below for the fingering diagrams.
function engraveOptions() {
  const fingering = fingeringShown();
  return {
    responsive: 'resize',
    ...layoutOptions(),
    add_classes: true,
    dragging: true,
    selectTypes: ['note', 'bar'],
    selectionColor: '#317761',
    dragColor: '#ba663d',
    clickListener: scoreClick,
    ...(fingering === 'guitar' ? {tablature: GUITAR_TAB, paddingbottom: 40, afterParsing: keepTablature} : {}),
    ...(fingering === 'recorder' ? {paddingbottom: 120} : {})
  };
}
// Per drawn note: its effective duration and parsed element (by display offset), plus each staff's clef offset.
function indexDisplay(display) {
  const shown = scoreEvents(display),
    lengths = effectiveDurations(shown);
  noteDurations = new Map(shown.map(e => [e.element.startChar, lengths.get(e.element) || 0]));
  shownElements = new Map(shown.map(e => [e.element.startChar, e.element]));
  // Clefs per drawn line. abcjs re-parses a re-flowed score, so its lines (not the display's) match the staff groups.
  // Guitar tablature adds a TAB staff to the line; it is left out, so these are the notation staves only.
  staffClefs = (renderedTune?.lines || display.lines)
    .filter(l => l.staff)
    .map(l => l.staff.filter(st => st.clef?.type !== 'TAB').map(st => st.clef?.verticalPos || 0));
}
// Keep the selected note highlighted across a re-render.
function restoreSelection(display) {
  if (!selectedRange || !renderedTune?.engraver) return;
  if (selectionAnchor) {
    const run = selectedNotes();
    if (run.length > 1) {
      selectedRange = [run[0].element.startChar, run.at(-1).element.endChar];
      highlightRun(run);
      return;
    }
    selectionAnchor = null;
    if (run.length) selectedRange = [run[0].element.startChar, run[0].element.endChar];
  }
  const match = [...noteSources.entries()].find(([, e]) => e?.element.startChar === selectedRange[0]);
  if (!match) return;
  const shown = scoreEvents(display).find(e => e.element.startChar === match[0]);
  if (shown) renderedTune.engraver.rangeHighlight(shown.element.startChar, shown.element.endChar);
}
function updateCaption() {
  $('workspace-heading').textContent = field('T', 'Untitled melody');
  const config = instruments[currentInstrument()],
    staves = staffClefs[0]?.length || 1;
  const pitch = concertView()
    ? 'Concert pitch shown, as it sounds; turn off Concert pitch for the written part.'
    : transposesInstrument()
      ? 'Written pitch shown; ABC source and MIDI are concert pitch.'
      : config.shift === -12
        ? `${staves > 1 ? 'Parts' : 'Melody'} lowered one octave for bass range.`
        : staves > 1
          ? 'Concert pitch.'
          : 'Concert pitch melody part.';
  // A score with several staves (a template or V: voices) has their own clefs, so it counts them instead.
  $('score-caption').textContent =
    `${currentInstrument()} · ${staves > 1 ? `${staves} staves` : `${config.clef} clef`} · ${pitch}`;
  if ($('concert-pitch-option')) $('concert-pitch-option').hidden = !transposesInstrument();
}
// Links to the complete source edition behind a library practice part.
function updateSourceEdition() {
  const edition = $('source-edition');
  edition.hidden = !(current?.pdf || current?.originalSource);
  if (current?.pdf) {
    edition.innerHTML = `<strong>Complete source edition</strong><p>The editor shows an extracted upper-part study, up to 32 bars. The original PDF below includes the complete score for ${esc(current.originalInstrument)}.</p><div class="source-actions"><a class="button-link" href="${esc(current.pdf)}" target="_blank" rel="noopener">Open complete PDF ↗</a><a class="button-link" href="${esc(current.pdf)}" download>Download PDF</a><a class="button-link" href="${esc(current.originalMidi)}" download>Original MIDI</a>${current.originalSource ? `<a class="button-link" href="${esc(current.originalSource)}" download>Original editable source</a>` : ''}</div>`;
  } else if (current?.originalSource) {
    edition.innerHTML = `<strong>Complete original ABC source</strong><p>${esc(current.studyTransform)} License: ${esc(scoreLicense(current))}. See the credit notice below before sharing.</p><a class="button-link" href="${esc(current.originalSourceDownload || current.originalSource)}" download>${current.originalSourceDownload ? 'Download original ABC + license bundle' : 'Download complete original ABC'}</a>`;
  }
}
// The rights notice under the score: the edition's license and credits, or a note that personal work stays private.
function updateRights() {
  const r = current?.rights;
  if (r) {
    $('rights').innerHTML =
      `<strong>${esc(licenseLabel(current))} · ${esc(scoreCollection(current))}</strong>${esc(r)}<br>${nonCommercial(current) ? `<em>${esc(nonCommercialNote(current))}</em><br>` : ''}${current.attribution ? `Credit: ${esc(current.attribution)}<br>` : ''}${current.licenseURL ? `<a href="${esc(current.licenseURL)}" target="_blank" rel="noopener">License terms ↗</a><br>` : ''}<a href="${esc(current.source)}" target="_blank" rel="noopener">${esc(current.sourceLabel)} ↗</a><br><span class="small">${dirty ? 'Your edits stay private. Export or save a copy to preserve them.' : 'Use, print, practice, and adapt this teaching version.'}</span>`;
  } else if (current?.kind === 'shared') {
    $('rights').innerHTML =
      '<strong>Shared score</strong>Opened from a link. The music arrived inside the link itself; nothing was uploaded or stored elsewhere. Save it to My scores to keep a copy on this device.';
  } else {
    $('rights').innerHTML =
      '<strong>Your private workspace</strong>Your work stays on this device. Imported music keeps its original rights; importing or editing a file does not make it public domain.';
  }
}
function changed() {
  stop();
  selectedRange = null;
  selectionAnchor = null;
  dirty = true;
  $('save-status').textContent = 'Unsaved changes';
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 220);
  // Started here as well as after render(), so a tab hidden or closed before the render still writes the draft.
  scheduleDraft();
}
function noteLength() {
  const match = field('L', '1/8').match(/^(\d+)\/(\d+)$/);
  const base = match ? +match[1] / +match[2] : 0.125;
  const beats = {1: 1, '/2': 0.5, 2: 2, 4: 4}[$('duration').value];
  const length = beats / 4 / base;
  return length === 1 ? '' : Number.isInteger(length) ? String(length) : '/' + String(Math.round(1 / length));
}
function insertToken(token) {
  flushTyping();
  const area = $('abc'),
    start = area.selectionStart,
    end = area.selectionEnd;
  const keyLine = area.value.match(/^K:.*(?:\n|$)/m);
  if (!keyLine) {
    toast('Add a K: key header before writing notes.');
    return;
  }
  const musicStart = keyLine.index + keyLine[0].length;
  if (start < musicStart) {
    toast('Place the cursor after the K: line to add notes.');
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    return;
  }
  const prefix = ['^', '_', '='].includes(token);
  let text = token;
  if (/^[A-G]$/.test(token)) {
    if ($('octave').value === 'upper') text = token.toLowerCase();
    if ($('octave').value === 'lower') text = token + ',';
    text += noteLength();
  }
  if (token === 'z') text += noteLength();
  if (!prefix) text += ' ';
  area.setRangeText(text, start, end, 'end');
  area.focus();
  changed();
  clearTimeout(renderTimer);
  // A letter after a ♯ ♭ ♮ button starts its note at the accidental.
  let at = start;
  while (at > 0 && /[\^_=]/.test(area.value[at - 1])) at--;
  if (/^[A-G]$/.test(token)) auditionEdit(at);
  render();
}
function safeName() {
  return (
    field('T', 'score')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .slice(0, 80) || 'score'
  );
}
function download(data, name, type) {
  const blob = new Blob([data], {type}),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Undo/redo for every change to the ABC source. Programmatic edits (drag, draw, menu, bar fixes, buttons) are one step
// each; a burst of typing is one step. Undoing back to the opened text clears the unsaved-changes state.
let editHistory = [],
  historyIndex = 0,
  typingEdit = false,
  lastTypingAt = 0,
  cleanKey = '';
const HISTORY_LIMIT = 200;
// A history state is the ABC text plus the instrument, which is saved with the score.
function snapshot() {
  const a = $('abc');
  return {abc: a.value, instrument: currentInstrument(), start: a.selectionStart || 0, end: a.selectionEnd || 0};
}
const stateKey = s => s.abc + '\u0000' + s.instrument;
// The clean state is the opened score, or the last save; undoing or redoing onto it clears "Unsaved changes".
function markClean() {
  cleanKey = stateKey(snapshot());
}
function resetHistory() {
  editHistory = [snapshot()];
  historyIndex = 0;
  markClean();
  typingEdit = false;
  lastTypingAt = 0;
  updateHistoryButtons();
}
function recordHistory() {
  const now = snapshot();
  if (!editHistory.length) {
    resetHistory();
    return;
  }
  if (stateKey(now) === stateKey(editHistory[historyIndex])) {
    typingEdit = false;
    return;
  }
  editHistory.length = historyIndex + 1;
  const coalesce =
    typingEdit &&
    editHistory[historyIndex].typing === typingEdit &&
    Date.now() - lastTypingAt < 1500 &&
    historyIndex > 0;
  if (coalesce) editHistory[historyIndex] = {...now, typing: typingEdit};
  else {
    editHistory.push({...now, typing: typingEdit});
    historyIndex++;
  }
  lastTypingAt = typingEdit ? Date.now() : 0;
  typingEdit = false;
  if (editHistory.length > HISTORY_LIMIT) {
    editHistory.shift();
    historyIndex--;
  }
  updateHistoryButtons();
}
// typingEdit names what is being typed into (the ABC box or a header field) so bursts merge into one step,
// but a burst in one place never merges with a different one or with an edit made on the score.
function noteTyping(source) {
  if (typingEdit && typingEdit !== source) {
    clearTimeout(renderTimer);
    recordHistory();
  }
  typingEdit = source;
}
function flushTyping() {
  if (typingEdit) {
    clearTimeout(renderTimer);
    recordHistory();
  }
}
function updateHistoryButtons() {
  const u = $('undo'),
    r = $('redo');
  if (u) u.disabled = historyIndex <= 0;
  if (r) r.disabled = historyIndex >= editHistory.length - 1;
}
function stepHistory(delta) {
  clearTimeout(renderTimer);
  recordHistory();
  const next = historyIndex + delta;
  if (next < 0 || next >= editHistory.length) return;
  // Offsets held by the note menu, a pending typing merge or a selection belong to the text being replaced.
  closeNoteMenu();
  lastTypingAt = 0;
  historyIndex = next;
  const state = editHistory[next],
    a = $('abc');
  a.value = state.abc;
  $('instrument').value = state.instrument;
  a.setSelectionRange?.(state.start, state.end);
  dirty = stateKey(state) !== cleanKey;
  $('save-status').textContent = dirty ? 'Unsaved changes' : '';
  selectedRange = null;
  selectionAnchor = null;
  syncFields();
  render();
  updateHistoryButtons();
  $('selection-status').textContent = delta < 0 ? 'Undid the last change.' : 'Redid the change.';
}
// Tinted boxes behind measures: one per line for a span, or one per measure.
function shadeMeasures(cls, include, perMeasure = false) {
  const svg = $('notation')?.querySelector?.('svg');
  if (!svg) return;
  svg.querySelectorAll('.' + cls).forEach(el => el.remove());
  const boxes = new Map();
  for (const e of renderedTune?.noteTimings || []) {
    if (e.type !== 'event' || e.left == null) continue;
    const measure = (e.startCharArray || []).map(c => noteSources.get(c)?.measure).find(Boolean);
    if (!measure || !include(measure)) continue;
    const key = perMeasure ? e.line + '|' + measure : e.line,
      box = boxes.get(key) || {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, measure};
    box.x0 = Math.min(box.x0, e.left);
    box.x1 = Math.max(box.x1, e.left + e.width);
    box.y0 = Math.min(box.y0, e.top);
    box.y1 = Math.max(box.y1, e.top + e.height);
    boxes.set(key, box);
  }
  for (const b of boxes.values()) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', cls);
    r.dataset.measure = b.measure;
    r.setAttribute('x', b.x0 - 8);
    r.setAttribute('y', b.y0 - 6);
    r.setAttribute('width', b.x1 - b.x0 + 16);
    r.setAttribute('height', b.y1 - b.y0 + 12);
    r.setAttribute('rx', 4);
    svg.insertBefore(r, svg.firstChild);
  }
}
// Tint the practice range on the score so students can see what will play and loop.
function shadeRange() {
  const {from, to, total} = measureRange();
  shadeMeasures('range-shade', m => !(from === 1 && to === total) && m >= from && m <= to);
}
// Bar check: flag measures with too many or too few beats, in plain words, with a one-click fix where one is safe.
// Library editions keep their historic irregular bars, so only bars that differ from the opened edition are flagged.
let barBaseline = [],
  barIssues = [];
const barText = m => $('abc').value.slice(m.notes[0].element.startChar, (m.bar || m.notes.at(-1).element).endChar);
const barKey = m => m.voice + '|' + barText(m).replace(/\s+/g, '');
const NOTE_VALUES = {
  1: 'a whole note',
  0.75: 'a dotted half note',
  0.5: 'a half note',
  0.375: 'a dotted quarter',
  0.25: 'a quarter note',
  0.1875: 'a dotted eighth',
  0.125: 'an eighth note',
  0.0625: 'a sixteenth note'
};
function beatCount(value) {
  const whole = Math.floor(value + 1e-9),
    part = value - whole,
    frac = {0.25: '¼', 0.5: '½', 0.75: '¾'}[Math.round(part * 4) / 4];
  return Math.abs(part) < 1e-6
    ? String(whole)
    : frac && Math.abs(part - Math.round(part * 4) / 4) < 1e-6
      ? (whole || '') + frac
      : value.toFixed(2);
}
function beatWords(length, meter) {
  const unit = {2: 'half-note beat', 4: 'beat', 8: 'eighth', 16: 'sixteenth'}[meter.den] || 'beat',
    n = length * meter.den,
    text = beatCount(n);
  return text + ' ' + unit + (text === '1' ? '' : 's');
}
function amountWords(whole, meter) {
  return NOTE_VALUES[Math.round(whole * 1e6) / 1e6] || beatWords(whole, meter) + "' worth";
}
function barSplit(m) {
  const k = m.notes.findIndex(n => Math.abs(n.at - m.expected) < 1e-6);
  return k >= 0 && k < m.notes.length - 1 ? m.notes[k] : null;
}
// Each irregular bar of the opened edition excuses one current bar with the same text: the nearest by measure number,
// so a student's identical bar elsewhere is still flagged and repeated edition bars are counted separately.
function newBarProblems(problems) {
  const left = problems.slice();
  for (const b of barBaseline) {
    let best = -1;
    for (const [i, m] of left.entries())
      if (
        barKey(m) === b.key &&
        (best < 0 || Math.abs(m.measure - b.measure) < Math.abs(left[best].measure - b.measure))
      )
        best = i;
    if (best >= 0) left.splice(best, 1);
  }
  return left;
}
function updateBarCheck(tune) {
  const problems = barProblems(tune),
    fromLibrary = catalog.includes(current),
    voices = new Set(barLengths(tune).map(m => m.voice)).size;
  if (!dirty) barBaseline = fromLibrary ? problems.map(m => ({key: barKey(m), measure: m.measure})) : [];
  barIssues = newBarProblems(problems);
  shadeMeasures('bar-flag', m => barIssues.some(i => i.measure === m), true);
  const box = $('bar-check');
  if (!box) return;
  if (!barIssues.length) {
    box.className = 'bar-check ok';
    box.innerHTML =
      !dirty && barBaseline.length
        ? `This historic edition has ${barBaseline.length} bar${barBaseline.length === 1 ? ' that doesn’t' : 's that don’t'} match the time signature. That's how the source was written.`
        : noteSources.size && (dirty || !fromLibrary)
          ? '✓ Every bar has the right number of beats.'
          : '';
    box.hidden = !box.innerHTML;
    return;
  }
  box.className = 'bar-check';
  box.hidden = false;
  const items = barIssues
    .slice(0, 6)
    .map((m, i) => {
      const where = (voices > 1 ? `Voice ${+m.voice.split(':')[1] + 1}, measure ` : 'Measure ') + m.measure,
        diff = Math.abs(m.length - m.expected);
      const said = `${where} has ${beatWords(m.length, m.meter)}; ${m.meter.label} needs ${beatWords(m.expected, m.meter)}.`;
      const advice =
        m.length < m.expected
          ? `Add ${amountWords(diff, m.meter)} or rest.`
          : `It's ${amountWords(diff, m.meter)} too long. Shorten or remove a note${barSplit(m) ? ', or split the bar' : ''}.`;
      const fix =
        m.length < m.expected
          ? `<button data-bar-fix="rest" data-bar="${i}">Fill with a rest</button>`
          : barSplit(m)
            ? `<button data-bar-fix="split" data-bar="${i}">Split the bar</button>`
            : '';
      return `<li><span>${said} ${advice}</span><span class="bar-actions"><button data-bar-fix="show" data-bar="${i}">Show</button>${fix}</span></li>`;
    })
    .join('');
  box.innerHTML = `<strong>Check your bars</strong><ul>${items}</ul>${barIssues.length > 6 ? `<p class="small">${barIssues.length - 6} more bar${barIssues.length - 6 === 1 ? '' : 's'} to check.</p>` : ''}`;
}
function setRange(from, to) {
  if (to < from) [from, to] = [to, from];
  stop();
  $('start-measure').value = from;
  $('end-measure').value = to;
  shadeRange();
  $('selection-status').textContent = `Practice range: measures ${from}–${to}. Turn on Loop to repeat it.`;
}
// abcjs moves one staff step per ~4px of raw offsetY and switches coordinate sources mid-drag, so notes race ahead and jitter.
// Take over the move: measure screen distance from the press point and require DRAG_PX_PER_STEP per staff step.
const DRAG_PX_PER_STEP = 10,
  STAFF_STEP = 93 / 24;
let dragStartY = null;
$('notation').addEventListener(
  'mousedown',
  e => {
    dragStartY = e.clientY;
  },
  true
);
$('notation').addEventListener(
  'touchstart',
  e => {
    dragStartY = e.touches[0]?.clientY ?? null;
  },
  {capture: true, passive: true}
);
function dragMove(e) {
  const c = renderedTune?.engraver,
    point = e.touches ? e.touches[0] : e;
  if (dragStartY == null || !point || !c?.dragTarget?.isDraggable || c.dragMechanism !== 'mouse') return;
  e.stopPropagation();
  if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
  const step = Math.round((point.clientY - dragStartY) / DRAG_PX_PER_STEP);
  if (step !== c.dragYStep) {
    c.dragYStep = step;
    c.dragTarget.svgEl.setAttribute('transform', 'translate(0,' + step * STAFF_STEP + ')');
  }
}
// Track on window so the drag keeps working when the pointer leaves the score; abcjs only hears events inside its SVG.
window.addEventListener('mousemove', dragMove, true);
$('notation').addEventListener('touchmove', dragMove, {capture: true, passive: false});
window.addEventListener(
  'mouseup',
  e => {
    const c = renderedTune?.engraver,
      svg = $('notation').querySelector('svg');
    dragStartY = null;
    if (c?.dragTarget && c.dragMechanism === 'mouse' && svg && !svg.contains(e.target))
      svg.dispatchEvent(new MouseEvent('mouseup', {clientX: e.clientX, clientY: e.clientY, button: e.button}));
  },
  true
);
// Draw mode: click an empty staff position to add a one-beat note. Right-click (or long-press) any note for its properties.
let drawMode = false,
  ghost = null,
  menuEntry = null;
const meterParts = () => {
  const m = field('M', '4/4').trim();
  if (m === 'C') return [4, 4];
  if (m === 'C|') return [2, 2];
  const x = m.match(/(\d+)\s*\/\s*(\d+)/);
  return x ? [+x[1], +x[2]] : [4, 4];
};
// Without L:, ABC's unit is 1/16 for meters under 3/4 and 1/8 otherwise.
const unitLength = () => {
  const m = field('L', '').match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  const [n, d] = meterParts();
  return n / d < 0.75 ? 1 / 16 : 1 / 8;
};
const beatLength = () => 1 / meterParts()[1];
// Meter in force at a source position: the last M: field before it, on a header line or inline as [M:].
function meterPartsAt(pos) {
  let found = null;
  for (const m of $('abc')
    .value.slice(0, pos)
    .matchAll(/(?:^|\n)M:[ \t]*([^\n%]*)|\[M:\s*([^\]]*)\]/g))
    found = m;
  const text = (found ? found[1] || found[2] : field('M', '4/4')).trim();
  if (text === 'C') return [4, 4];
  if (text === 'C|') return [2, 2];
  const x = text.match(/(\d+)\s*\/\s*(\d+)/);
  return x ? [+x[1], +x[2]] : [4, 4];
}
// Unit length in force at a source position: the last L: field before it, on a header line or inline as [L:].
function unitLengthAt(pos) {
  let found = null;
  for (const m of $('abc')
    .value.slice(0, pos)
    .matchAll(/(?:^|\n)L:\s*(\d+)\s*\/\s*(\d+)|\[L:\s*(\d+)\s*\/\s*(\d+)\s*\]/g))
    found = m;
  return found ? +(found[1] || found[3]) / +(found[2] || found[4]) : unitLength();
}
const pitchName = p => 'CDEFGAB'[((p % 7) + 7) % 7] + (4 + Math.floor(p / 7));
const lengthName = v =>
  ({1: 'whole', 0.5: 'half', 0.25: 'quarter', 0.125: 'eighth', 0.0625: '16th', 0.03125: '32nd'})[v] || '';
function scorePoint(e) {
  const svg = $('notation').querySelector('svg');
  return svg && new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
}
// The drawn notation staves with their clefs. A tab staff sits under the staff it belongs to, so the notation staves
// are counted without it to find their clefs.
function staffList() {
  return (renderedTune?.engraver?.staffgroups || []).flatMap((g, gi) =>
    g.staffs
      .filter(st => !st.isTabStaff)
      .map((st, si) => ({id: gi + ':' + si, y: st.absoluteY, clef: staffClefs[gi]?.[si] ?? 0}))
  );
}
const nearestStaff = (staffs, y) =>
  staffs.reduce(
    (best, st) => (Math.abs(y - (st.y - 6 * STAFF_STEP)) < Math.abs(y - (best.y - 6 * STAFF_STEP)) ? st : best),
    staffs[0]
  );
// Staff lines sit at verticalPos 2-10; abcjs draws verticalPos v at absoluteY - v*STEP and v = written pitch - clef offset.
function drawTarget(e) {
  const pt = scorePoint(e),
    staffs = staffList();
  if (!pt || !staffs.length) return null;
  const staff = nearestStaff(staffs, pt.y);
  if (Math.abs(pt.y - (staff.y - 6 * STAFF_STEP)) > 11 * STAFF_STEP) return null;
  const v = Math.max(-4, Math.min(16, Math.round((staff.y - pt.y) / STAFF_STEP)));
  return {x: pt.x, y: staff.y - v * STAFF_STEP, written: v + staff.clef, staff};
}
// Hit-test by bounding box too: the hollow centre of a half or whole note is bare SVG.
function selectableAt(e) {
  const c = renderedTune?.engraver;
  if (!c) return null;
  const direct = c.selectables.find(s => s.svgEl.contains(e.target));
  if (direct) return direct;
  const pt = scorePoint(e);
  if (!pt) return null;
  let best = null,
    dist = Infinity;
  for (const s of c.selectables) {
    const b = s.svgEl.getBBox();
    if (pt.x < b.x - 2 || pt.x > b.x + b.width + 2 || pt.y < b.y - 2 || pt.y > b.y + b.height + 2) continue;
    const d = Math.abs(pt.x - (b.x + b.width / 2));
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}
const onNote = e => !!selectableAt(e);
function showGhost(t) {
  const svg = $('notation').querySelector('svg');
  if (!svg) return;
  if (!ghost || ghost.ownerSVGElement !== svg) {
    ghost = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ghost.setAttribute('class', 'draw-ghost');
    ghost.setAttribute('rx', '5');
    ghost.setAttribute('ry', '3.8');
    svg.appendChild(ghost);
  }
  ghost.style.display = t ? '' : 'none';
  if (!t) return;
  ghost.setAttribute('cx', t.x);
  ghost.setAttribute('cy', t.y);
  ghost.setAttribute('transform', `rotate(-20 ${t.x} ${t.y})`);
  $('selection-status').textContent =
    `Draw: click to add ${pitchName(t.written)} (${lengthName(beatLength()) || 'one-beat'} note) · right-click a note to change it`;
}
// Pass hear (a source position in the new text) to sound that note (Hear notes).
// With keep, notes after the edit keep their pitch: an accidental it writes would otherwise carry to them.
// With anchor ('first' or 'last'), select spans several notes and stays a range selection anchored at that end.
function applyNoteEdit(
  start,
  end,
  text,
  select = text ? [start, start + text.length] : null,
  hear = null,
  keep = false,
  anchor = null
) {
  flushTyping();
  const area = $('abc');
  if (keep)
    try {
      ({end, text, select} = keepLaterPitches(area.value, start, end, text, select));
    } catch {}
  // An edit that leaves the text as it was (a dot on a multi-measure rest) keeps the score saved.
  if (area.value.slice(start, end) !== text) {
    dirty = true;
    $('save-status').textContent = 'Unsaved changes';
  }
  area.setRangeText(text, start, end, 'end');
  clearTimeout(renderTimer);
  syncFields();
  selectedRange = select;
  selectionAnchor = select && anchor;
  if (hear != null) auditionEdit(hear);
  render();
  if (selectedRange) area.setSelectionRange(...selectedRange);
  focusScore();
}
// Note audition: the concert pitches of the note or chord that starts at a source position, as playback sounds them
// (octave clefs and transpose= included), keyed by startChar and cached per source text. scheduleNotes then adds the
// instrument's octave (a cello sounds an octave below the source).
let concertPitches = {source: null, at: new Map()};
function concertPitchesAt(at) {
  const source = $('abc').value;
  if (concertPitches.source !== source)
    concertPitches = {
      source,
      at: new Map(noteLabels(ABCJS.parseOnly(source)[0], 'letters').map(l => [l.at, l.midis]))
    };
  // abcjs can start an element at the whitespace before it (after a bar line, for one).
  while (!concertPitches.at.has(at) && at > 0 && /\s/.test(source[at - 1])) at--;
  return concertPitches.at.get(at) || [];
}
function auditionAt(at) {
  if (playing || $('audition')?.checked === false) return;
  try {
    auditionPitches(concertPitchesAt(at));
  } catch {}
}
// After an edit, sound the note before the render: engraving a long score can take a second or more, and the audio
// clock plays a scheduled note on time while the page is busy. The render stops playback anyway, so stop it first.
function auditionEdit(at) {
  stop();
  auditionAt(at);
}
function drawNote(t) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Click again to add the note.');
    return;
  }
  // The staff shows written pitch (or concert pitch in Concert pitch view); the source takes the concert note, as many
  // letters away as the key at that point.
  const concert = at => pitchToken(t.written - writtenSteps($('abc').value, at, displayShift()));
  // Neighbours on the clicked staff, in reading order; the new note goes before the first one to the right of the click.
  const staffs = staffList(),
    items = [];
  for (const sel of renderedTune.engraver.selectables) {
    const entry = noteSources.get(sel.absEl.abcelem.startChar);
    if (!entry) continue;
    const box = sel.svgEl.getBBox();
    if (nearestStaff(staffs, box.y + box.height / 2).id !== t.staff.id) continue;
    items.push({x: box.x + box.width / 2, entry});
  }
  items.sort((a, b) => a.x - b.x);
  // A click in a bar that still holds a rest fills the nearest one (a blank sheet fills bar by bar) instead of
  // adding beats beside the notes already there. Multimeasure rests (Z2) stand for whole bars and are left alone.
  const isBar = i => i.entry.element.el_type === 'bar',
    leftBar = items.filter(i => isBar(i) && i.x <= t.x).at(-1),
    rightBar = items.find(i => isBar(i) && i.x > t.x),
    rests = items.filter(
      i =>
        i.entry.element.rest &&
        i.entry.element.rest.type !== 'multimeasure' &&
        (!leftBar || i.x > leftBar.x) &&
        (!rightBar || i.x < rightBar.x)
    ),
    nearest = rests.reduce((best, i) => (!best || Math.abs(i.x - t.x) < Math.abs(best.x - t.x) ? i : best), null);
  if (nearest) {
    fillRest(nearest.entry, concert(nearest.entry.element.startChar), beatLength());
    $('selection-status').textContent =
      `Added ${pitchName(t.written)} on the rest · right-click it to change accidental or length`;
    return;
  }
  const next = items.find(i => i.x > t.x),
    last = items.at(-1),
    value = $('abc').value;
  let at,
    lead = '',
    trail = '';
  const tuneEnd = Math.max(...[...noteSources.values()].filter(Boolean).map(e => e.element.startChar));
  // Past the closing barline: add the note inside the tune, before that barline.
  if (!next && last?.entry.element.el_type === 'bar' && last.entry.element.startChar === tuneEnd) {
    at = last.entry.element.startChar;
    trail = ' ';
  } else if (next) {
    at = next.entry.element.startChar;
    trail = ' ';
  } else if (last) {
    at = last.entry.element.endChar;
    lead = ' ';
  } else {
    at = value.length;
    lead = value.endsWith('\n') ? '' : '\n';
  }
  const token = concert(at) + lengthText(beatLength() / unitLength());
  let text = lead + token + trail;
  if (at > 0 && !/\s/.test(value[at - 1]) && !text.startsWith(' ') && !text.startsWith('\n')) text = ' ' + text;
  const start = at + text.indexOf(token);
  applyNoteEdit(at, at, text, [start, start + token.length], start);
  $('selection-status').textContent = `Added ${pitchName(t.written)} · right-click it to change accidental or length`;
}
function setDrawMode(on) {
  drawMode = on;
  $('draw-mode').setAttribute('aria-pressed', on);
  $('notation').classList.toggle('drawing', on);
  showGhost(null);
  $('selection-status').textContent = on
    ? 'Draw mode: click the staff to add a note. Right-click a note to change it.'
    : 'Click a note to select its ABC text. Drag up/down to change pitch; right-click for accidentals, length and practice range.';
}
$('draw-mode').onclick = () => setDrawMode(!drawMode);
for (const type of ['mousedown', 'touchstart'])
  $('notation').addEventListener(
    type,
    e => {
      if (!drawMode || onNote(e) || (type === 'mousedown' && e.button !== 0)) return;
      e.stopPropagation();
      if (!$('note-menu').hidden) {
        e.preventDefault();
        closeNoteMenu();
        return;
      }
      if (type === 'mousedown') {
        e.preventDefault();
        const t = drawTarget(e);
        if (t) drawNote(t);
      }
    },
    {capture: true, passive: false}
  );
$('notation').addEventListener('mousemove', e => {
  if (drawMode && !renderedTune?.engraver?.dragTarget) showGhost(onNote(e) ? null : drawTarget(e));
});
$('notation').addEventListener('mouseleave', () => showGhost(null));
// Add blank bars (whole-bar rests in the meter in force there) before the closing barline, or at the end.
function addBars(count = 4) {
  flushTyping();
  if (addVoiceBars(count)) return;
  const value = $('abc').value,
    close = value.lastIndexOf('|]'),
    at = close >= 0 ? close : value.length,
    [num, den] = meterPartsAt(at),
    rest = 'z' + lengthText(num / den / unitLengthAt(at)),
    bars = Array(count).fill(rest).join(' | ');
  let text;
  if (close >= 0) {
    text = (/\|\s*$/.test(value.slice(0, close)) ? '' : '| ') + bars + ' ';
  } else {
    // Without a closing barline the last measure may still be open: a newline does not end it, so close it first.
    const last = [...noteSources.values()]
      .filter(Boolean)
      .reduce((a, e) => (!a || e.element.startChar > a.element.startChar ? e : a), null);
    const open = last && last.element.el_type !== 'bar';
    text = (value.endsWith('\n') ? '' : '\n') + (open ? '| ' : '') + bars + ' |]';
  }
  const first = at + text.indexOf(rest);
  applyNoteEdit(at, at, text, [first, first + rest.length]);
  $('selection-status').textContent = `Added ${count} blank bars at the end.`;
}
// With several voices, every voice gets the bars in one edit: before its closing |], or after its last note or bar
// line, each sized by that voice's meter. An & overlay is a voice of its own in abcjs, but it is written inside its
// staff's voice and shares that voice's bar lines, so it goes with that voice and gets no bars of its own. Returns
// false for a score with one voice (and any overlays), which addBars handles as before.
function addVoiceBars(count) {
  const value = $('abc').value;
  let tune;
  try {
    tune = ABCJS.parseOnly(value)[0];
  } catch {
    return false;
  }
  const events = scoreEvents(tune),
    owner = new Map(),
    barVoice = new Map(),
    last = new Map(),
    meters = new Map();
  // An overlay meets the bar lines of the voice it is written in. One with no bar line of its own follows an &, so
  // it goes with the voice of the nearest earlier note on its staff.
  const staffOf = e => voiceOf(e).split(':')[0];
  for (const e of events.filter(x => x.element.el_type === 'bar')) {
    const at = staffOf(e) + '@' + e.element.startChar,
      first = barVoice.get(at);
    if (!first) barVoice.set(at, voiceOf(e));
    else if (first !== voiceOf(e) && !owner.has(voiceOf(e))) owner.set(voiceOf(e), first);
  }
  for (const e of events) {
    const voice = voiceOf(e),
      at = e.element.startChar;
    if (owner.has(voice) || !/&\s*$/.test(value.slice(Math.max(0, at - 40), at))) continue;
    const before = events
      .filter(x => staffOf(x) === staffOf(e) && voiceOf(x) !== voice && x.element.startChar < at)
      .reduce((a, x) => (!a || x.element.startChar > a.element.startChar ? x : a), null);
    if (before) owner.set(voice, owner.get(voiceOf(before)) ?? voiceOf(before));
  }
  // Each voice's last element in the source, its overlays included; a bar line wins over a rest at the same place.
  for (const e of events) {
    const voice = owner.get(voiceOf(e)) ?? voiceOf(e),
      prev = last.get(voice),
      el = e.element;
    if (!prev || el.startChar > prev.startChar || (el.startChar === prev.startChar && el.el_type === 'bar'))
      last.set(voice, el);
  }
  for (const m of barLengths(tune)) meters.set(m.voice, m.meter);
  if (last.size < 2) return false;
  const inserts = [...last].map(([voice, e]) => {
    const closing = e.el_type === 'bar' && /^\s*\|\]\s*$/.test(value.slice(e.startChar, e.endChar)),
      at = closing ? value.indexOf('|]', e.startChar) : e.endChar,
      meter = meters.get(voice),
      [num, den] = meterPartsAt(at),
      rest = 'z' + lengthText((meter?.length || num / den) / unitLengthAt(at)),
      bars = Array(count).fill(rest).join(' | ');
    const text = closing
      ? (/\|\s*$/.test(value.slice(0, at)) ? '' : '| ') + bars + ' '
      : (e.el_type === 'bar' ? ' ' : ' | ') + bars + ' |]';
    return {voice, at, text, rest};
  });
  inserts.sort((a, b) => a.at - b.at);
  const start = inserts[0].at,
    end = inserts.at(-1).at;
  let text = '',
    pos = start,
    select = null;
  for (const x of inserts) {
    text += value.slice(pos, x.at);
    const first = start + text.length + x.text.indexOf(x.rest);
    if (!select || x.voice === '0:0') select = [first, first + x.rest.length];
    text += x.text;
    pos = x.at;
  }
  applyNoteEdit(start, end, text, select);
  $('selection-status').textContent = `Added ${count} blank bars at the end of every staff.`;
  return true;
}
$('add-bars').onclick = () => addBars(4);
// Note properties menu. Lengths come from the parsed (effective) duration, so chords and broken rhythm read correctly.
const DOTTABLE = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
function closeNoteMenu() {
  $('note-menu').hidden = true;
  menuEntry = null;
}
// The transposition the score is drawn at: 0 for concert-pitch instruments and in Concert pitch view.
const transposing = () => {
  const shift = displayShift();
  return shift % 12 !== 0 ? shift : 0;
};
// Accidentals are what the player sees, so read and edit them in written pitch, then transpose back to the concert source.
function writtenNote(display, w = writtenABC()) {
  return {
    text: w.slice(display.startChar, display.endChar).replace(noteNamesMode() === 'off' ? /^$/ : /^"_[^"]*"/, ''),
    key: keyAt(w, display.startChar)
  };
}
// For an accidental on many notes (a range selection): the written score and the letters each key moved are worked
// out once, not once per note, and each different written note goes back to concert pitch once.
function writtenBatch() {
  const source = $('abc').value,
    shift = transposing(),
    fields = keyFields(source).map(f => f.start),
    steps = new Map();
  return {
    written: shift ? writtenABC() : null,
    // The letters depend only on which key is in force, so on how many K: fields come before the note.
    steps: at => {
      const n = fields.filter(start => start < at).length;
      if (!steps.has(n)) steps.set(n, writtenSteps(source, at, shift));
      return steps.get(n);
    },
    notes: new Map()
  };
}
function accidentalEdit(entry, display, acc, batch = null) {
  const old = $('abc').value.slice(entry.element.startChar, entry.element.endChar),
    shift = transposing();
  if (!shift) return editNoteText(old, {accidental: acc});
  const {text, key} = writtenNote(display, batch?.written),
    steps = batch ? batch.steps(entry.element.startChar) : writtenSteps($('abc').value, entry.element.startChar, shift),
    mini = `X:1\nL:1/8\nK:${key}\n${editNoteText(text, {accidental: acc})}\n`,
    done = batch?.notes.get(steps + mini);
  // Only the new pitch goes into the source note: the rest of the written text can differ from the source for display
  // (a trill line's start is drawn as a plain trill), and that must not be written back.
  const pitch = note => {
    const m = old.match(NOTE_PARTS),
      core = note?.match(NOTE_PARTS)?.[2];
    return m && core ? m[1] + core + m[3] + m[4] : (note ?? old);
  };
  if (done !== undefined) return pitch(done);
  // Back to concert pitch by the letters the written key moved, so a plain note means what the source's key says
  // (a plain C in written Ab major is A# in concert F# major, not the Bb that abcjs's own Gb major would give).
  let note = null;
  try {
    const lines = transposeABC(mini, -shift, -steps, 7).split('\n');
    note = lines[lines.findIndex(l => l.startsWith('K:')) + 1] ?? null;
  } catch {}
  batch?.notes.set(steps + mini, note);
  return pitch(note);
}
// A note joined to its neighbour by > or < (broken rhythm), as [first, second] source entries.
function brokenPair(entry) {
  const v = $('abc').value,
    notes = [...noteSources.values()]
      .filter(e => e?.element.el_type === 'note')
      .sort((a, b) => a.element.startChar - b.element.startChar);
  const marked = e => /[<>]/.test(noteParts(v.slice(e.element.startChar, e.element.endChar))?.post || ''),
    i = notes.indexOf(entry);
  if (marked(entry) && notes[i + 1]) return [entry, notes[i + 1]];
  if (i > 0 && marked(notes[i - 1])) return [notes[i - 1], entry];
  return null;
}
// The note menu's marks: the five articulations with keys (a rest offers only the fermata) and the dynamics.
function markItemsHTML(entry) {
  const marks = noteMarks($('abc').value.slice(entry.element.startChar, entry.element.endChar));
  if (!marks || markBlocked('dyn:', entry.element)) return '';
  const keyOf = name => Object.keys(MARK_KEYS).find(k => MARK_KEYS[k] === name),
    item = (action, label, glyph, checked, key) =>
      `<button role="menuitemcheckbox" aria-checked="${checked}" data-edit="${action}" aria-label="${label}" title="${label}${key ? ` (${key.replace('"', '&quot;')})` : ''}">${glyph}</button>`;
  return (
    `<div class="menu-label">MARKS</div><div class="menu-row menu-marks">` +
    Object.values(MARK_KEYS)
      .filter(name => !markBlocked('deco:' + name, entry.element))
      .map(name => item('deco:' + name, MARK_WORDS[name], MARK_GLYPHS[name], marks.marks.includes(name), keyOf(name)))
      .join('') +
    `</div><div class="menu-row menu-marks">` +
    DYNAMICS.map(d =>
      item('dyn:' + d, `${d}, ${DYNAMIC_WORDS[d]}`, `<i class="dynamic">${d}</i>`, marks.dynamic === d)
    ).join('') +
    '</div>'
  );
}
function openNoteMenu(entry, display, x, y) {
  menuEntry = {entry, display, written: renderedWritten};
  const isRest = !entry.element.pitches?.length,
    text = transposing()
      ? writtenNote(display).text
      : $('abc').value.slice(entry.element.startChar, entry.element.endChar);
  const acc = (noteParts(text)?.core.match(/^\[?(\^{1,2}|_{1,2}|=)/) || [])[1] || '',
    len = entry.element.duration || 0,
    chord = shownChord({entry, display});
  const durations = [
    [1, '𝅝 Whole'],
    [0.5, '𝅗𝅥 Half'],
    [0.25, '♩ Quarter'],
    [0.125, '♪ Eighth'],
    [0.0625, '𝅘𝅥𝅯 16th']
  ];
  const dotted = DOTTABLE.some(v => Math.abs(len - v * 1.5) < 1e-9),
    base = dotted ? len / 1.5 : len;
  const item = (action, label, checked) =>
    `<button role="menuitemradio" aria-checked="${!!checked}" data-edit="${action}">${label}</button>`;
  $('note-menu').innerHTML =
    (isRest
      ? ''
      : `<div class="menu-label">ACCIDENTAL</div><div class="menu-row">${item('acc:^', '♯ Sharp', acc === '^')}${item('acc:_', '♭ Flat', acc === '_')}${item('acc:=', '♮ Natural', acc === '=')}${item('acc:', 'None', !acc)}</div><button role="menuitem" aria-keyshortcuts="Z" data-edit="respell">♯♭ Respell (same pitch)</button>`) +
    `<div class="menu-label">LENGTH</div>${durations.map(([v, l]) => item('len:' + v, l, Math.abs(base - v) < 1e-9)).join('')}` +
    `<button role="menuitemcheckbox" aria-checked="${dotted}" data-edit="dot">· Dotted</button>` +
    (isRest
      ? ''
      : `<button role="menuitemcheckbox" aria-checked="${/^-/.test(noteParts($('abc').value.slice(entry.element.startChar, entry.element.endChar))?.post || '')}" data-edit="tie">⁀ Tie to next note</button>`) +
    markItemsHTML(entry) +
    `<button role="menuitem" data-edit="chord" aria-keyshortcuts="K" title="Chord symbol (K)">Chord symbol${chord ? ': ' + esc(chord) : ''}…</button>` +
    `<div class="menu-row"><button role="menuitem" data-edit="play-from">▶ Play from here</button><button role="menuitem" data-edit="range-from">🔁 Practice from here</button></div>` +
    `<div class="menu-label">INSERT AFTER</div><div class="menu-row"><button role="menuitem" data-edit="rest-after">𝄽 Rest</button><button role="menuitem" data-edit="bar-after">| Bar line</button></div><hr><button role="menuitem" class="danger" data-edit="delete">Delete ${isRest ? 'rest' : 'note'}</button>`;
  const menu = $('note-menu');
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.querySelector('button')?.focus({preventScroll: true});
  menu.dataset.scrollY = window.scrollY;
}
$('notation').addEventListener('contextmenu', e => {
  if (renderedSource !== $('abc').value) {
    e.preventDefault();
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Right-click the note again.');
    return;
  }
  const sel = selectableAt(e),
    display = sel?.absEl.abcelem;
  const entry = display?.el_type === 'note' && noteSources.get(display.startChar);
  if (!entry) return;
  e.preventDefault();
  showGhost(null);
  scoreClick(display, 0, [], {}, null);
  const box = sel.svgEl.getBoundingClientRect();
  openNoteMenu(entry, display, e.clientX || box.right, e.clientY || box.bottom);
});
// The source between a note and the next one (next) when only spaces or tabs separate them: notes written without a
// space share a beam. Null at the end of the music or before a bar line, a line break or anything else.
function beamGap(entry) {
  const v = $('abc').value,
    {startChar, endChar} = entry.element,
    from = startChar + v.slice(startChar, endChar).trimEnd().length,
    next = scoreNotes().find(n => n.element.startChar >= endChar);
  if (!next) return null;
  const gap = v.slice(from, next.element.startChar);
  return /^[ \t]*$/.test(gap) ? {from, to: next.element.startChar, joined: !gap, next} : null;
}
// Articulations, ornaments and dynamics (NOTE_MARKS and DYNAMICS in score-tools.js): the words the toolbar, the note
// menu and the status line use, and the keys for the five common articulations.
const MARK_WORDS = {
  staccato: 'Staccato',
  tenuto: 'Tenuto',
  accent: 'Accent',
  marcato: 'Marcato',
  fermata: 'Fermata',
  wedge: 'Staccatissimo',
  upbow: 'Up bow',
  downbow: 'Down bow',
  breath: 'Breath mark',
  trill: 'Trill',
  mordent: 'Mordent',
  turn: 'Turn',
  arpeggio: 'Arpeggio'
};
const MARK_KEYS = {';': 'staccato', ':': 'tenuto', '>': 'accent', '"': 'marcato', '^': 'fermata'},
  MARK_GLYPHS = {staccato: '•', tenuto: '–', accent: '>', marcato: '∧', fermata: '𝄐'},
  DYNAMIC_WORDS = {
    ppp: 'very, very soft',
    pp: 'very soft',
    p: 'soft',
    mp: 'medium soft',
    mf: 'medium loud',
    f: 'loud',
    ff: 'very loud',
    fff: 'very, very loud',
    sfz: 'sudden accent'
  };
// Why a mark (deco:<name> or dyn:<name>) cannot go on a note or rest, or '' when it can. A rest takes a dynamic or
// a fermata; an invisible rest takes nothing.
function markBlocked(action, element) {
  if (element.rest?.type === 'invisible') return 'Invisible rests take no marks.';
  if (action.startsWith('deco:') && !element.pitches?.length && action !== 'deco:fermata')
    return 'Rests take only a dynamic or a fermata.';
  return '';
}
// The status line after a mark edit, from the marks the note had before it.
function markDone(action, before) {
  const [kind, name] = action.split(':');
  if (kind === 'dyn') return !name || before?.dynamic === name ? 'Dynamic removed.' : `Dynamic ${name}.`;
  return MARK_WORDS[name] + (before?.marks.includes(name) ? ' removed.' : ' added.');
}
// A mark from a key or the note menu, saying what happened in the status line.
function markNote(sel, action) {
  const element = sel.entry.element,
    blocked = markBlocked(action, element),
    v = $('abc').value;
  if (blocked) {
    $('selection-status').textContent = blocked;
    return;
  }
  const before = noteMarks(v.slice(element.startChar, element.endChar));
  editNote(sel.entry, sel.display, action);
  $('selection-status').textContent = $('abc').value === v ? 'No change.' : markDone(action, before);
}
// Each note's marks, kept per source text: the palette asks for every mark button over a range selection.
let marksMemo = {source: null, at: new Map()};
function marksOf(entry) {
  const v = $('abc').value,
    {startChar, endChar} = entry.element,
    key = startChar + ':' + endChar;
  if (marksMemo.source !== v) marksMemo = {source: v, at: new Map()};
  if (!marksMemo.at.has(key)) marksMemo.at.set(key, noteMarks(v.slice(startChar, endChar)));
  return marksMemo.at.get(key);
}
// The notes and rests of a range selection a mark can go on, each with the marks it has, and why none can.
function markTargets(action, picked) {
  const able = [];
  let why = '';
  for (const entry of picked) {
    const marks = marksOf(entry),
      blocked = marks ? markBlocked(action, entry.element) : 'These cannot take marks.';
    if (!blocked) able.push({entry, marks});
    else why ||= blocked;
  }
  return {able, why: able.length ? '' : why};
}
// What the palette shows for a range selection: the articulations and ornaments every note that can take them has,
// and the dynamic of the first note or rest that can take one.
function rangeMarks(picked) {
  const first = markTargets('dyn:p', picked).able[0];
  return {
    marks: NOTE_MARKS.filter(name => {
      const {able} = markTargets('deco:' + name, picked);
      return able.length > 0 && able.every(t => t.marks.marks.includes(name));
    }),
    dynamic: first?.marks.dynamic ?? null
  };
}
// A mark on a range selection, as one undo step that keeps the selection. An articulation or ornament goes on every
// selected note that can take it, or comes off them all when they all have it; a dynamic goes on the first note or
// rest that can take one, or comes off it. Returns the status line.
function markRange(picked, action) {
  const [kind, name] = action.split(':'),
    {able, why} = markTargets(action, picked),
    v = $('abc').value;
  if (kind === 'dyn' ? name && !DYNAMICS.includes(name) : !NOTE_MARKS.includes(name)) return 'No change.';
  if (!able.length) return why;
  if (kind === 'dyn') {
    const [{entry, marks}] = able,
      dyn = !name || marks.dynamic === name ? null : name;
    editNotes([entry], (n, text) => (n === entry ? setDynamic(text, dyn) : text), picked);
    return $('abc').value === v ? 'No change.' : markDone(action, marks);
  }
  const all = able.every(t => t.marks.marks.includes(name)),
    targets = (all ? able : able.filter(t => !t.marks.marks.includes(name))).map(t => t.entry);
  editNotes(targets, (n, text) => (targets.includes(n) ? toggleDecoration(text, name) : text), picked);
  return `${MARK_WORDS[name]} ${all ? 'removed from' : 'added to'} ${countWords(targets.length)}.`;
}
// Slurs, hairpins and trill lines (lineEdits in score-tools.js). S or the toolbar's Lines group puts one over the
// selected notes, from the first note to the last (rests at either end are left out of slurs and trill lines; a
// hairpin may start or end on a rest), or from one selected note to the next. The same press on the same notes takes
// it off. Each is one undo step that keeps the selection.
const LINE_WORDS = {slur: 'Slur', crescendo: 'Crescendo', diminuendo: 'Diminuendo', trill: 'Trill line'};
// Each voice's notes in order, worked out once per render: the toolbar asks about all four kinds of line on every
// selection change.
let voicesMemo = null;
function notesByVoice() {
  if (voicesMemo?.sources !== noteSources) {
    const voices = new Map();
    for (const n of scoreNotes()) voices.get(voiceOf(n))?.push(n) ?? voices.set(voiceOf(n), [n]);
    voicesMemo = {sources: noteSources, voices};
  }
  return voicesMemo.voices;
}
// The notes a line of a kind would join for the selection ({first, last, count}; last is null to take off the line
// that starts on a single selected note), or {why} when it cannot go on.
function lineEnds(kind, picked = selectedNotes()) {
  const hairpin = kind === 'crescendo' || kind === 'diminuendo',
    fits = n => (hairpin ? !!marksOf(n) : pitched(n)),
    word = LINE_WORDS[kind].toLowerCase();
  if (!picked.length) return {why: 'Select a note on the score first.'};
  if (picked.length > 1) {
    const ends = picked.filter(fits);
    if (ends.length < 2) return {why: `A ${word} needs two ${hairpin ? 'notes or rests' : 'notes'}.`};
    return {first: ends[0], last: ends.at(-1), count: picked.indexOf(ends.at(-1)) - picked.indexOf(ends[0]) + 1};
  }
  const [first] = picked;
  if (!fits(first))
    return {why: hairpin ? 'Invisible rests take no marks.' : `A ${word} starts on a note, not a rest.`};
  if (lineAt($('abc').value, first.element, null, kind)) return {first, last: null};
  const voice = notesByVoice().get(voiceOf(first)) || [],
    i = voice.indexOf(first),
    j = voice.findIndex((n, k) => k > i && fits(n));
  if (j < 0) return {why: `There is no next note to end the ${word} on.`};
  return {first, last: voice[j], count: j - i + 1};
}
// Whether the selection has a line of a kind over it (for one note, starting on it), and why the toolbar's button
// cannot add one.
function lineState(kind, picked) {
  const ends = lineEnds(kind, picked);
  return {why: ends.why || '', on: !ends.why && !!lineAt($('abc').value, ends.first.element, ends.last?.element, kind)};
}
function toggleLineSelected(kind, picked = selectedNotes()) {
  const status = $('selection-status'),
    ends = lineEnds(kind, picked),
    v = $('abc').value,
    change = !ends.why && lineEdits(v, ends.first.element, ends.last?.element ?? null, kind);
  if (!change) {
    status.textContent = ends.why || 'No change.';
    return;
  }
  // The selection keeps its notes: positions move with the edits before them, and a slur's ) belongs to the note it
  // closes.
  const moved = (at, end) =>
      at +
      change.edits.reduce(
        (sum, e) =>
          e.at < at || (end && e.at === at && e.insert === ')')
            ? sum + e.insert.length - Math.min(e.remove, at - e.at)
            : sum,
        0
      ),
    text = applyLineEdits(v, change.edits),
    from = Math.min(...change.edits.map(e => e.at)),
    to = Math.max(...change.edits.map(e => e.at + e.remove));
  applyNoteEdit(
    from,
    to,
    text.slice(from, to + text.length - v.length),
    [moved(picked[0].element.startChar), moved(picked.at(-1).element.endChar, true)],
    null,
    false,
    picked.length > 1 ? selectionAnchor || 'first' : null
  );
  status.textContent = change.on
    ? `${LINE_WORDS[kind]} added over ${countWords(ends.count)}.`
    : `${LINE_WORDS[kind]} removed.`;
}
// Chord symbols. K, the toolbar's Chord button or the note menu opens a box above the selected note. Enter saves,
// Tab saves and moves on to the next note (Shift+Tab the one before), Escape cancels, and an empty box removes the
// symbol. Symbols are typed and shown in written pitch and stored in concert pitch, like the notes.
let chordEditing = null;
// The chord symbol the student sees on a note: written pitch on a transposing instrument.
function shownChord(sel) {
  const v = $('abc').value,
    {startChar, endChar} = sel.entry.element;
  if (!transposing() || !sel.display) return chordSymbolOf(v.slice(startChar, endChar));
  return chordSymbolOf(writtenNote(sel.display, (renderedSource === v && renderedWritten) || undefined).text);
}
// A typed (written) chord symbol in concert pitch, moved back by the letters the written key moved at that note. Other
// text stays as typed, as the written display leaves it (both go through transposeChordSymbol).
function concertChord(name, sel) {
  const shift = transposing();
  return shift
    ? transposeChordSymbol(name, -shift, -writtenSteps($('abc').value, sel.entry.element.startChar, shift))
    : name;
}
// The box sits just above the note (below it near the top of the score), inside the score's scrolling paper.
function placeChordEntry(display) {
  const box = $('chord-entry'),
    paper = box.parentElement,
    note = renderedTune?.engraver?.selectables?.find(s => s.absEl.abcelem.startChar === display.startChar),
    rect = note?.svgEl.getBoundingClientRect?.(),
    outer = paper.getBoundingClientRect();
  if (!rect) return;
  const left = rect.left - outer.left - paper.clientLeft + paper.scrollLeft,
    top = rect.top - outer.top - paper.clientTop + paper.scrollTop,
    above = top - box.offsetHeight - 6;
  box.style.left =
    Math.max(paper.scrollLeft + 4, Math.min(left - 8, paper.scrollLeft + paper.clientWidth - box.offsetWidth - 4)) +
    'px';
  box.style.top = (above >= 4 ? above : top + rect.height + 6) + 'px';
}
function chordHint() {
  const text = tidyChordSymbol($('chord-input').value);
  $('chord-hint').textContent =
    text && !parseChordSymbol(text)
      ? 'Not a chord name: it will print but not play.'
      : !text && chordEditing?.had
        ? 'Empty removes the chord symbol.'
        : 'Enter saves · Tab next note · Esc cancels';
}
// opener is the toolbar button to return to after a keyboard press there; otherwise the keyboard goes back to the score.
function openChordEntry(sel, opener = null) {
  if (!sel?.display) return;
  // On a range selection the box opens on its first note, which becomes the selection.
  if (selectionAnchor) {
    selectEntry(sel.entry);
    sel = selectedNote();
  }
  const had = shownChord(sel);
  chordEditing = {start: sel.entry.element.startChar, source: $('abc').value, had, opener};
  $('chord-input').value = had || '';
  $('chord-entry').hidden = false;
  chordHint();
  placeChordEntry(sel.display);
  $('chord-input').focus({preventScroll: true});
  $('chord-input').select();
  $('chord-entry').scrollIntoView?.({block: 'nearest'});
}
function closeChordEntry(editing, focusTo) {
  chordEditing = null;
  $('chord-entry').hidden = true;
  const to = focusTo || editing?.opener;
  if (to?.isConnected) to.focus({preventScroll: true});
  else focusScore();
}
// Save the box's text as one undo step, then move on by move notes (1 next, -1 previous) and open the box there.
// focusTo is where the keyboard goes when the box closes (by default the opener or the score). Returns the status line.
function commitChord(move = 0, focusTo = null) {
  const editing = chordEditing;
  if (!editing) return '';
  const typed = tidyChordSymbol($('chord-input').value);
  chordEditing = null;
  $('chord-entry').hidden = true;
  const entry = $('abc').value === editing.source && scoreNotes().find(e => e.element.startChar === editing.start);
  if (!entry) {
    closeChordEntry(editing, focusTo);
    toast('Score updated. Select the note again.');
    return '';
  }
  const sel = {entry, display: displayOf(entry)},
    {startChar: start, endChar: end} = entry.element,
    old = $('abc').value.slice(start, end);
  let message = '',
    moved = 0;
  if (typed !== (editing.had || '')) {
    const text = setChordSymbol(old, typed ? concertChord(typed, sel) : null);
    moved = text.length - old.length;
    if (text !== old) applyNoteEdit(start, end, text);
    message = !typed
      ? 'Chord symbol removed.'
      : parseChordSymbol(typed)
        ? `Chord symbol ${typed}.`
        : `Chord symbol “${typed}” added. It is not a chord name, so it prints but does not play.`;
  }
  const notes = scoreNotes(),
    next = move ? notes[notes.findIndex(e => e.element.startChar === start) + move] : null;
  if (next) {
    selectEntry(next);
    if (message) $('selection-status').textContent = message;
    openChordEntry(selectedNote(), editing.opener);
    return message;
  }
  const clicked =
    editing.clicked != null &&
    editing.clicked !== start &&
    notes.find(e => e.element.startChar === editing.clicked + (editing.clicked > start ? moved : 0));
  if (clicked) selectEntry(clicked);
  if (move) message += (message ? ' ' : '') + (move > 0 ? 'That was the last note.' : 'That was the first note.');
  if (message) $('selection-status').textContent = message;
  refreshPalette();
  closeChordEntry(editing, focusTo);
  return message;
}
$('chord-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    commitChord(e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeChordEntry(chordEditing);
  }
});
$('chord-input').addEventListener('input', chordHint);
// Leaving the box another way (a click or tap elsewhere) saves it, and the keyboard goes where the student went.
// Switching to another window keeps the box open.
$('chord-input').addEventListener('blur', e => {
  if (!chordEditing || !document.hasFocus() || $('chord-entry').contains(e.relatedTarget)) return;
  commitChord(0, e.relatedTarget || $('notation'));
});
// A click or tap on another note while the box is open saves the box, then selects that note (by its place in the
// source, which the save may move along).
$('notation').addEventListener(
  'mousedown',
  e => {
    if (!chordEditing) return;
    const hit = selectableAt(e)?.absEl.abcelem;
    chordEditing.clicked = (hit?.el_type === 'note' && noteSources.get(hit.startChar)?.element.startChar) ?? null;
  },
  true
);
// Next is for touch screens without a Tab key; pressing it keeps the box focused.
$('chord-next').addEventListener('mousedown', e => e.preventDefault());
$('chord-next').addEventListener('click', () => commitChord(1));
// One edit on one note, shared by the note menu, the keyboard and the palette. Actions: acc:<^|_|=|>, len:<whole>,
// dot, tie, to-rest, beam:join, beam:break, deco:<mark>, dyn:<dynamic|>, delete, rest-after, bar-after, play-from,
// range-from, respell, chord (opens the chord symbol box). Others do nothing.
function editNote(entry, display, action) {
  const area = $('abc'),
    v = area.value,
    start = entry.element.startChar,
    end = entry.element.endChar,
    old = v.slice(start, end);
  if (/^(deco|dyn):/.test(action)) {
    // deco toggles an articulation or ornament; dyn sets a dynamic, and the note's own dynamic (or none) removes it.
    const [kind, name] = action.split(':'),
      marks = noteMarks(old),
      known = kind === 'dyn' ? !name || DYNAMICS.includes(name) : NOTE_MARKS.includes(name);
    if (!marks || !known || markBlocked(action, entry.element)) return;
    applyNoteEdit(
      start,
      end,
      kind === 'dyn' ? setDynamic(old, marks.dynamic === name ? null : name || null) : toggleDecoration(old, name)
    );
    return;
  }
  if (action === 'play-from') {
    playFromNote(display);
    return;
  }
  if (action === 'chord') {
    openChordEntry({entry, display});
    return;
  }
  if (action === 'range-from') {
    const to = +$('end-measure').value;
    setRange(entry.measure, to >= entry.measure ? to : +$('end-measure').max);
    return;
  }
  if (action === 'respell') {
    respellSelected({entry, display});
    return;
  }
  if (action.startsWith('acc:')) {
    applyNoteEdit(start, end, accidentalEdit(entry, display, action.slice(4)), undefined, start);
    return;
  }
  if (action === 'tie') {
    applyNoteEdit(start, end, editNoteText(old, {tie: !/^-/.test(noteParts(old)?.post || '')}));
    return;
  }
  if (action === 'rest-after' || action === 'bar-after') {
    const token =
      action === 'bar-after' ? '|' : 'z' + lengthText((entry.element.duration || beatLength()) / unitLengthAt(end));
    insertAt(end, token, action === 'rest-after');
    return;
  }
  if (action === 'beam:join' || action === 'beam:break') {
    // Join by removing the space before the next note; break by adding one. The note stays selected.
    const gap = beamGap(entry),
      join = action === 'beam:join';
    if (gap && gap.joined !== join) applyNoteEdit(gap.from, gap.to, join ? '' : ' ', [start, gap.from]);
    return;
  }
  const newLength = action.startsWith('len:') ? +action.slice(4) : null;
  if (!(newLength > 0) && !['dot', 'delete', 'to-rest'].includes(action)) return;
  if (action === 'to-rest' && !entry.element.pitches?.length) return;
  const unit = unitLength(),
    len = entry.element.duration || 0,
    dotted = DOTTABLE.some(x => Math.abs(len - x * 1.5) < 1e-9);
  const change = t =>
    action === 'delete'
      ? ''
      : action === 'to-rest'
        ? editNoteText(t, {rest: true})
        : editNoteText(t, {length: (action === 'dot' ? (dotted ? len / 1.5 : len * 1.5) : newLength) / unit});
  // Nothing can be tied to a rest, so a note that becomes one also takes the tie off the note before it in its voice,
  // in the same edit (one undo step).
  const voice = e => e.key.replace(/:\d+$/, ''),
    tiedFrom =
      action === 'to-rest' &&
      scoreNotes()
        .filter(n => voice(n) === voice(entry) && n.element.startChar < start)
        .pop()?.element,
    untie =
      tiedFrom && /^-/.test(noteParts(v.slice(tiedFrom.startChar, tiedFrom.endChar))?.post || '') ? tiedFrom : null;
  const edit = (from, to, text) => {
    if (!untie || untie.endChar > from) return applyNoteEdit(from, to, text);
    const lead = editNoteText(v.slice(untie.startChar, untie.endChar), {tie: false}) + v.slice(untie.endChar, from),
      at = untie.startChar + lead.length;
    applyNoteEdit(untie.startChar, to, lead + text, [at, at + text.length]);
  };
  const pair = brokenPair(entry);
  if (!pair) {
    // Deleting keeps the previous note selected so typing can carry on from there.
    const prev =
      action === 'delete'
        ? scoreNotes()
            .filter(n => n.element.startChar < start)
            .pop()
        : null;
    if (action === 'delete')
      applyNoteEdit(
        start,
        end + (v[end] === ' ' ? 1 : 0),
        '',
        prev ? [prev.element.startChar, prev.element.endChar] : null
      );
    else edit(start, end, change(old));
    return;
  }
  // Spell the broken-rhythm pair out with explicit lengths so the neighbour keeps its duration.
  const [a, c] = pair,
    fixed = n =>
      editNoteText(v.slice(n.element.startChar, n.element.endChar), {
        length: (n.element.duration || 0) / unit,
        unbroken: true,
        tie: n.element === untie ? false : undefined
      });
  const first = a === entry ? change(fixed(a)) : fixed(a),
    second = c === entry ? change(fixed(c)) : fixed(c);
  const text = (first + v.slice(a.element.endChar, c.element.startChar) + second).replace(/^\s+/, m =>
    first ? m : ''
  );
  const spaced = second || !first ? text : text.replace(/\s*$/, ' ');
  if (action === 'delete') applyNoteEdit(a.element.startChar, c.element.endChar, spaced, null);
  else edit(a.element.startChar, c.element.endChar, spaced);
}
$('note-menu').addEventListener('click', e => {
  const b = e.target.closest('[data-edit]'),
    picked = menuEntry;
  if (!b || !picked) return;
  e.stopPropagation();
  closeNoteMenu();
  // The menu's note offsets belong to the drawing it was opened on. A new instrument or Concert pitch view draws
  // other text from the same source, so the source alone does not show that they are stale.
  if (renderedSource !== $('abc').value || picked.written !== writtenABC()) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Right-click the note again.');
    return;
  }
  if (/^(deco|dyn):/.test(b.dataset.edit)) markNote(picked, b.dataset.edit);
  else editNote(picked.entry, picked.display, b.dataset.edit);
});
document.addEventListener('mousedown', e => {
  if (!$('note-menu').hidden && !$('note-menu').contains(e.target)) closeNoteMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('note-menu').hidden) closeNoteMenu();
});
window.addEventListener(
  'scroll',
  () => {
    // The browser can nudge the page a few pixels when the status line above the score rewraps (scroll anchoring);
    // only a real scroll moves the note away from the menu.
    if (!$('note-menu').hidden && Math.abs(window.scrollY - +$('note-menu').dataset.scrollY) > 24) closeNoteMenu();
  },
  {passive: true}
);
// Keyboard note entry on the score (MuseScore-style): A–G add a note after the selection in the nearest octave,
// Shift+A–G add a pitch to the selected chord, R or 0 a rest, 3–7 set the length (16th…whole), . dots, ↑↓ move by
// step (Ctrl: octave), ←→ change the selection, # - = set sharp/flat/natural, + ties, | adds a bar line, Delete
// removes the note, [ ] halve or double the length, ; : > " ^ toggle staccato, tenuto, accent, marcato and fermata,
// K opens the chord symbol box.
// Shift+←→ and Ctrl/Cmd+A, C, X, V, D work on a range selection (see below).
const LENGTH_KEYS = {3: 1 / 16, 4: 1 / 8, 5: 1 / 4, 6: 1 / 2, 7: 1};
function focusScore() {
  $('notation').focus?.({preventScroll: true});
}
// Notes and rests of the source in reading order, one entry each.
function scoreNotes() {
  return [...new Set(noteSources.values())]
    .filter(e => e?.element.el_type === 'note')
    .sort((a, b) => a.element.startChar - b.element.startChar);
}
// The displayed element of a source entry, from a reverse index kept for each render (a range edit asks for many).
let displayIndex = null;
function displayOf(entry) {
  if (displayIndex?.sources !== noteSources || displayIndex.shown !== shownElements) {
    const map = new Map();
    for (const [key, e] of noteSources) if (!map.has(e)) map.set(e, shownElements.get(key));
    displayIndex = {sources: noteSources, shown: shownElements, map};
  }
  return displayIndex.map.get(entry) ?? null;
}
// The selected note, or the first note of a range selection.
function selectedNote() {
  const entry = selectionAnchor
    ? selectedNotes()[0]
    : selectedRange && scoreNotes().find(e => e.element.startChar === selectedRange[0]);
  return entry ? {entry, display: displayOf(entry)} : null;
}
// Where note entry goes on from: the selected note, or the last note of a range selection, marked after so that a
// rest there is kept and the new note goes after it.
function entrySelection(picked = selectedNotes()) {
  if (picked.length < 2) return selectedNote();
  const entry = picked.at(-1);
  return {entry, display: displayOf(entry), after: true};
}
function selectEntry(entry) {
  const display = displayOf(entry);
  if (!display) return;
  scoreClick(display, 0, [], {}, null);
  renderedTune?.engraver?.rangeHighlight?.(display.startChar, display.endChar);
}
// Insert a token at a source position with spacing, then select it (and sound it, with hear). Returns where it starts.
function insertAt(at, token, select = true, hear = false, keep = false) {
  const v = $('abc').value,
    before = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '',
    after = v[at] && !/\s/.test(v[at]) ? ' ' : '';
  applyNoteEdit(
    at,
    at,
    before + token + after,
    select ? [at + before.length, at + before.length + token.length] : null,
    hear ? at + before.length : null,
    keep
  );
  return at + before.length;
}
// Where a new note goes with nothing selected: before the closing bar line, or at the end of the music. In a score
// with several voices that is the end of the first voice (the top staff).
function tuneEndPosition() {
  const all = [...new Set(noteSources.values())]
      .filter(e => e && voiceOf(e) === '0:0')
      .sort((a, b) => a.element.startChar - b.element.startChar),
    last = all.at(-1);
  if (!last) return $('abc').value.length;
  return last.element.el_type === 'bar' && /thick|dbl/.test(last.element.type || '')
    ? last.element.startChar
    : last.element.endChar;
}
// Where a new note goes: over the selected rest (typing on a rest writes over it, as in MuseScore), after the
// selected note, or at the end of the music. After a range selection (sel.after, see entrySelection) a rest at its
// end is kept and the note goes after it.
const fillsRest = sel =>
  sel && !sel.after && !sel.entry.element.pitches?.length && sel.entry.element.rest?.type !== 'multimeasure';
const entryPosition = sel =>
  fillsRest(sel) ? sel.entry.element.startChar : sel ? sel.entry.element.endChar : tuneEndPosition();
// Letters name what the student sees, so pick the octave in written pitch, nearest the previous note.
function insertNote(letter, sel) {
  insertCore(letterToken(letter, entryPosition(sel)), sel);
}
// Enter a pitch (or z), without a length, at the input length: a selected rest keeps whatever time is left and
// stays selected so the next note continues; otherwise the note goes after the selection and is selected. An
// accidental on the new note does not change later notes in the bar (see keepLaterPitches).
function insertCore(core, sel) {
  const keep = /^[_^=]/.test(core),
    at = entryPosition(sel),
    start = fillsRest(sel)
      ? fillRest(sel.entry, core, undefined, keep)
      : insertAt(at, core + lengthText((inputLength ?? beatLength()) / unitLengthAt(at)), true, core !== 'z', keep);
  rememberEntry(core === 'z' ? null : start);
}
// The note the last entry wrote, while the source and selection are as that entry left them. Filling a rest
// completely passes the selection on to the next note, so chord pitches still need to know the note just entered.
let lastEntry = null;
function rememberEntry(at) {
  lastEntry = at == null ? null : {at, source: $('abc').value, range: String(selectedRange)};
}
// The note a chord pitch goes on: the note just entered, the selected note, or the note just before a selected rest.
// Entering a note over a rest moves the selection on to what is left of the rest, so that is the note just entered.
function chordTarget(sel) {
  if (lastEntry && lastEntry.source === $('abc').value && lastEntry.range === String(selectedRange)) {
    // abcjs can start a note at the space before it (after a bar line), so look for the note that holds the offset.
    const {at} = lastEntry,
      entry = scoreNotes().find(n => n.element.startChar <= at && at < n.element.endChar && n.element.pitches?.length);
    if (entry) return entry === sel?.entry ? sel : {entry, display: displayOf(entry)};
  }
  if (!sel || sel.entry.element.pitches?.length) return sel;
  const voice = sel.entry.key.split(':').slice(0, 2).join(':') + ':',
    notes = scoreNotes().filter(n => n.key.startsWith(voice)),
    prev = notes[notes.indexOf(sel.entry) - 1];
  return prev?.element.pitches?.length ? {entry: prev, display: displayOf(prev)} : null;
}
// Add a pitch (without a length) to the chord target, making it a chord or adding to one; one undo step. A selected
// rest stays selected, so entry carries on after the chord. Returns false when the pitch is already there.
function addToChord(sel, core) {
  const target = chordTarget(sel),
    start = target.entry.element.startChar,
    end = target.entry.element.endChar,
    old = $('abc').value.slice(start, end),
    text = addChordPitch(old, core),
    delta = text.length - old.length;
  if (text === old) return false;
  const select =
    target === sel
      ? [start, start + text.length]
      : [sel.entry.element.startChar + delta, sel.entry.element.endChar + delta];
  applyNoteEdit(start, end, text, select, start, /^[_^=]/.test(core));
  rememberEntry(target === sel ? null : start);
  return true;
}
// Shift+A–G: the letter's pitch just above the chord's top note (in written pitch, letters as the written key names
// them), as the key signature spells it.
function addLetterToChord(letter, sel) {
  const target = chordTarget(sel),
    steps = writtenSteps($('abc').value, target.entry.element.startChar, displayShift()),
    top = Math.max(...target.entry.element.pitches.map(p => p.pitch)) + steps,
    index = 'CDEFGAB'.indexOf(letter),
    pitch = index + 7 * (Math.floor((top - index) / 7) + 1);
  $('selection-status').textContent = addToChord(sel, pitchToken(pitch - steps))
    ? `Added ${letter} to the chord. Shift+A–G adds more.`
    : `${letter} is already in the chord.`;
}
// Z or Respell: spell the selected note or chord another way at the same pitch (C♯ as D♭ and back), as one undo
// step. The bar's accidentals decide what a plain letter sounds, so the new text is checked against the parse and its
// accidentals are written out where the plain spelling would change the pitch; later notes in the bar keep theirs,
// and lose an accidental only the old spelling needed (respellEdit). Pressing again on the same note, with nothing
// else edited in between, comes back to the very text it started from once the spelling comes round (respellRun).
let respellRun = null;
function respellSelected(sel) {
  const status = $('selection-status');
  if (!sel?.entry.element.pitches?.length) {
    status.textContent = 'Z respells a note. Select a note or chord first.';
    return;
  }
  const source = $('abc').value,
    {startChar: start, endChar: end} = sel.entry.element,
    old = source.slice(start, end),
    pitchesAt = (text, at) => noteLabels(ABCJS.parseOnly(text)[0], 'letters').find(l => l.at === at)?.written,
    midis = pitchesAt(source, start),
    key = pianoKeyAt(ABCJS.parseOnly(source)[0], start, sel.entry.key.split(':').slice(0, 2).join(':')),
    sounds = text => String(pitchesAt(source.slice(0, start) + text + source.slice(end), start)) === String(midis);
  let text = midis && respell(old, key, {midis});
  if (text && !sounds(text)) text = respell(old, key, {midis, explicit: true});
  if (!text || text === old) {
    status.textContent = 'This note has no other spelling.';
    return;
  }
  const again = respellRun?.at === start && respellRun.after === source ? respellRun : null;
  let edit = null;
  try {
    edit =
      again && text === again.note
        ? sourceEdit(source, again.from, start, end, start + text.length)
        : respellEdit(source, start, end, text);
  } catch {}
  if (edit) applyNoteEdit(start, edit.end, edit.text, [start, start + text.length], start);
  else applyNoteEdit(start, end, text, undefined, start, true);
  respellRun = {at: start, note: again ? again.note : old, from: again ? again.from : source, after: $('abc').value};
  // Name the new spelling as the staff shows it (written pitch for transposing instruments, unless Concert pitch
  // view is on).
  const display = selectedNote()?.display,
    label =
      display &&
      midis.length === 1 &&
      noteLabels(ABCJS.parseOnly(writtenABC())[0], 'letters').find(l => l.at === display.startChar);
  status.textContent = `${label ? 'Respelled as ' + label.text : 'Respelled the chord'}. Respell again (Z) for the next spelling.`;
}
// Note token for a letter as the staff shows it (written pitch, or concert in Concert pitch view), in the octave
// nearest the last note before a source position in the same voice, or else the middle of that voice's staff.
function letterToken(letter, at) {
  if (letter === 'z') return 'z';
  const notes = scoreNotes(),
    here = notes.filter(n => n.element.startChar <= at).pop() || notes[0],
    voice = here ? voiceOf(here) : '0:0',
    steps = writtenSteps($('abc').value, at, displayShift()),
    prev = notes.filter(n => n.element.startChar < at && n.element.pitches?.length && voiceOf(n) === voice).pop();
  const ref = prev ? prev.element.pitches[0].pitch + steps : 6 + (staffClefs[0]?.[+voice.split(':')[0]] || 0),
    letterIndex = 'CDEFGAB'.indexOf(letter);
  return pitchToken(letterIndex + 7 * Math.round((ref - letterIndex) / 7) - steps);
}
// Put a note (its pitch token, without a length) at the start of a rest, taking its length from the rest; the rest
// keeps what is left, which stays selected so the next note continues. A filled rest passes the selection on.
// Chord symbols and text written on the rest mark that beat, so the note takes them. Returns where the note starts.
function fillRest(rest, core, wanted = inputLength ?? beatLength(), keep = false) {
  const v = $('abc').value,
    start = rest.element.startChar,
    end = rest.element.endChar,
    old = v.slice(start, end),
    unit = unitLengthAt(start);
  const restLength = rest.element.duration || 0,
    length = Math.min(wanted, restLength || Infinity),
    left = restLength - length,
    chords = (noteParts(old.trim())?.pre.match(/"[^"]*"/g) || []).join('');
  const token = chords + core + lengthText(length / unit),
    trail = old.match(/\s*$/)[0],
    lead = old.match(/^\s*/)[0] || (start > 0 && !/\s/.test(v[start - 1]) ? ' ' : '');
  if (left > 1e-6) {
    const remainder = 'z' + lengthText(left / unit),
      text = lead + token + ' ' + remainder + trail,
      at = start + lead.length + token.length + 1;
    applyNoteEdit(start, end, text, [at, at + remainder.length], start + lead.length, keep);
    return start + lead.length;
  }
  const text = lead + token + trail,
    delta = text.length - (end - start),
    next = scoreNotes().find(n => n.element.startChar >= end);
  applyNoteEdit(
    start,
    end,
    text,
    next
      ? [next.element.startChar + delta, next.element.endChar + delta]
      : [start + lead.length, start + lead.length + token.length],
    start + lead.length,
    keep
  );
  return start + lead.length;
}
// Keys 3–7 and the palette's length buttons: set the length of new notes, and of the selected note. A selected rest
// keeps its length, so typing a letter writes a note of the new length over it.
// With a range selection, every note in it takes the length (rests keep theirs).
function chooseLength(value, sel = selectedNote()) {
  inputLength = value;
  const name = (NOTE_VALUES[value] || 'that length').replace(/^an? /, ''),
    picked = selectedNotes();
  if (picked.length > 1) {
    const before = $('abc').value;
    setLengths(picked, n => (pitched(n) ? value : null));
    $('selection-status').textContent = ($('abc').value === before ? 'Already ' : 'Changed to ') + name + 's.';
  } else if (sel && sel.entry.element.pitches?.length) {
    const before = $('abc').value;
    editNote(sel.entry, sel.display, 'len:' + value);
    $('selection-status').textContent =
      ($('abc').value === before ? 'Already ' : 'Changed to ') + (NOTE_VALUES[value] || 'that length') + '.';
  } else {
    // Letters write over a selected rest, but go after a multi-measure rest (Z).
    const over = sel && sel.entry.element.rest?.type !== 'multimeasure';
    $('selection-status').textContent =
      'New notes will be ' + name + 's.' + (over ? ' Type a letter to write one over the rest.' : '');
    refreshPalette();
  }
}
function scoreKey(e) {
  // Ctrl/Cmd+Shift with these letters stays the browser's.
  const mod = e.ctrlKey || e.metaKey,
    command = mod && !e.shiftKey && /^[acdvx]$/i.test(e.key);
  if (e.altKey || !$('note-menu').hidden) return false;
  if (mod && !command && (e.metaKey || !/^Arrow(Up|Down)$/.test(e.key))) return false;
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const key = e.key,
    sel = selectedNote(),
    notes = scoreNotes(),
    picked = selectedNotes(),
    many = picked.length > 1,
    last = many ? entrySelection(picked) : sel;
  if (command) {
    selectionCommand(key.toLowerCase());
    return true;
  }
  if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    extendSelection(key === 'ArrowLeft' ? -1 : 1);
    return true;
  }
  if (key === ' ') {
    if (playing) stop();
    else if (sel) playFromNote(sel.display);
    else play();
    return true;
  }
  // Typing after a range selection adds the note after its last note, and Shift+A–G adds to that note's chord.
  if (e.shiftKey && /^[A-G]$/.test(key) && chordTarget(last)) {
    addLetterToChord(key, last);
    return true;
  }
  if (/^[a-g]$/i.test(key)) {
    insertNote(key.toUpperCase(), last);
    return true;
  }
  if (key === 'r' || key === 'R' || key === '0') {
    insertNote('z', last);
    return true;
  }
  if (LENGTH_KEYS[key]) {
    chooseLength(LENGTH_KEYS[key], sel);
    return true;
  }
  if (key === '|') {
    if (last) editNote(last.entry, last.display, 'bar-after');
    else insertAt(tuneEndPosition(), '|', false);
    return true;
  }
  // ← and → leave a range selection from its first or last note.
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (!notes.length) return true;
    const from = key === 'ArrowLeft' ? picked[0] : picked.at(-1),
      i = from ? notes.indexOf(from) : key === 'ArrowLeft' ? notes.length : -1,
      next = notes[Math.max(0, Math.min(notes.length - 1, i + (key === 'ArrowLeft' ? -1 : 1)))];
    selectEntry(next);
    auditionAt(next.element.startChar);
    return true;
  }
  if (key === 'Escape' && sel) {
    selectedRange = null;
    selectionAnchor = null;
    renderedTune?.engraver?.rangeHighlight?.(-1, -1);
    if (typeof showPianoSelection === 'function') showPianoSelection();
    $('selection-status').textContent = 'Nothing selected. Letters add notes at the end.';
    refreshPalette();
    return true;
  }
  if (key === 'k' || key === 'K') {
    if (sel) openChordEntry(sel);
    else $('selection-status').textContent = 'Select a note on the score first.';
    return true;
  }
  if (key === 'z' || key === 'Z') {
    // Respelling works on one note or chord, as the palette's Respell does.
    if (many) $('selection-status').textContent = 'Z respells one note or chord. Select a single note for this.';
    else respellSelected(sel);
    return true;
  }
  if (key === 's' || key === 'S') {
    toggleLineSelected('slur', picked);
    return true;
  }
  if (!sel) return false;
  if (key === '[' || key === ']') {
    scaleLengths(picked, key === ']' ? 2 : 0.5);
    return true;
  }
  if (many) return rangeKey(e, picked);
  const isNote = !!sel.entry.element.pitches?.length,
    start = sel.entry.element.startChar,
    end = sel.entry.element.endChar;
  if (key === '.') {
    editNote(sel.entry, sel.display, 'dot');
    return true;
  }
  if (key === 'Delete' || key === 'Backspace') {
    editNote(sel.entry, sel.display, 'delete');
    return true;
  }
  if (MARK_KEYS[key]) {
    markNote(sel, 'deco:' + MARK_KEYS[key]);
    return true;
  }
  if (!isNote) return false;
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const v = $('abc').value;
    applyNoteEdit(
      start,
      end,
      moveNoteText(v.slice(start, end), (key === 'ArrowUp' ? 1 : -1) * (e.ctrlKey ? 7 : 1)),
      undefined,
      start
    );
    return true;
  }
  const accidental = {'#': '^', '-': '_', '=': '='}[key];
  if (accidental) {
    editNote(sel.entry, sel.display, 'acc:' + accidental);
    return true;
  }
  if (key === '+') {
    editNote(sel.entry, sel.display, 'tie');
    return true;
  }
  return false;
}
$('notation').addEventListener(
  'keydown',
  e => {
    if (scoreKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);
// Range selection. selectedRange can span a run of notes in one voice, from the anchor (the note where the selection
// started) to the focus that Shift+←→ and Shift+click move; selectionAnchor says which end the anchor is ('first' or
// 'last'), and is null for one note. A run stops where another voice's note comes between, so it is always one
// stretch of source text.
const voiceOf = entry => entry.key.split(':').slice(0, 2).join(':');
// The notes from a to b (either order) in reading order.
function noteRun(a, b) {
  const notes = scoreNotes(),
    i = notes.indexOf(a),
    j = notes.indexOf(b),
    step = j >= i ? 1 : -1,
    run = [a];
  if (i < 0 || j < 0) return run;
  for (let k = i + step; k !== j + step; k += step) {
    if (voiceOf(notes[k]) !== voiceOf(a)) break;
    run.push(notes[k]);
  }
  return step > 0 ? run : run.reverse();
}
function selectedNotes() {
  if (!selectedRange) return [];
  if (!selectionAnchor) {
    const sel = selectedNote();
    return sel ? [sel.entry] : [];
  }
  const inside = scoreNotes().filter(
    n => n.element.startChar < selectedRange[1] && n.element.endChar > selectedRange[0]
  );
  if (!inside.length) return [];
  return selectionAnchor === 'last' ? noteRun(inside.at(-1), inside[0]) : noteRun(inside[0], inside.at(-1));
}
function highlightRun(run) {
  const a = displayOf(run[0]),
    b = displayOf(run.at(-1));
  if (a && b) renderedTune?.engraver?.rangeHighlight?.(a.startChar, b.endChar);
}
// Select from anchor a to focus b; a note in another voice is selected on its own.
function selectNotesBetween(a, b) {
  if (voiceOf(a) !== voiceOf(b)) a = b;
  const run = noteRun(a, b);
  if (run.length < 2) {
    selectEntry(a);
    return run;
  }
  const first = run[0],
    last = run.at(-1);
  selectedRange = [first.element.startChar, last.element.endChar];
  selectionAnchor = a === first ? 'first' : 'last';
  $('abc').setSelectionRange(...selectedRange);
  highlightRun(run);
  const where =
    first.measure === last.measure ? `measure ${first.measure}` : `measures ${first.measure}–${last.measure}`;
  $('selection-status').textContent =
    `${run.length} notes selected in ${where} · Copy, Cut or Duplicate them (Ctrl+C, X, D) · ↑↓, # and [ ] change them all`;
  refreshTranspose();
  refreshPalette();
  if (typeof showPianoSelection === 'function') showPianoSelection();
  return run;
}
// Shift+← and Shift+→: move the focus one note, within the voice.
function extendSelection(step) {
  const picked = selectedNotes(),
    notes = scoreNotes();
  if (!notes.length) return;
  if (!picked.length) {
    selectEntry(step < 0 ? notes.at(-1) : notes[0]);
    return;
  }
  const anchor = selectionAnchor === 'last' ? picked.at(-1) : picked[0],
    focus = anchor === picked[0] ? picked.at(-1) : picked[0],
    next = notes[notes.indexOf(focus) + step];
  if (!next || voiceOf(next) !== voiceOf(anchor)) return;
  selectNotesBetween(anchor, next);
  auditionAt(next.element.startChar);
}
// Ctrl/Cmd+A: every note of the voice around the selection (the first voice when nothing is selected).
function selectAllNotes() {
  const notes = scoreNotes(),
    from = selectedNotes()[0] || notes[0];
  if (!from) return;
  let i = notes.indexOf(from),
    j = i;
  while (i > 0 && voiceOf(notes[i - 1]) === voiceOf(from)) i--;
  while (j < notes.length - 1 && voiceOf(notes[j + 1]) === voiceOf(from)) j++;
  selectNotesBetween(notes[i], notes[j]);
}
// The bar lines around a run in its voice. A run of whole measures starts a measure and ends at a bar line or at the
// end of the voice's music (open: no bar line closes it).
function runBars(run) {
  const voice = voiceOf(run[0]),
    items = [...new Set(noteSources.values())]
      .filter(e => e && voiceOf(e) === voice)
      .sort((a, b) => a.element.startChar - b.element.startChar),
    i = items.indexOf(run[0]),
    j = items.indexOf(run.at(-1)),
    bar = e => (e?.element.el_type === 'bar' ? e : null),
    before = bar(items[i - 1]),
    after = bar(items[j + 1]),
    open = j === items.length - 1;
  return {before, after, open, whole: (!!after || open) && (i === 0 || !!before), items: items.slice(i, j + 1)};
}
const plainBar = b => !!b && b.element.type === 'bar_thin' && !b.element.startEnding;
// Accidentals last to the end of their measure, so an edit that adds, removes or moves one can change the pitch of
// notes after it that it never touched. pitchWalk reads each pitch as noteLabels does: a written accidental, else the
// accidental carried through a tie or earlier in the measure (at that octave), else the key signature, inline key
// changes included. It gives each note's alterations (semitones off the plain letter, chord pitches in source order,
// grace notes aside) by startChar. want(element) may name the alterations a note should have; a pitch that reads
// otherwise is listed in fixes with the accidental it needs, and the reading goes on as if it had it.
function pitchWalk(tune, want = () => null) {
  const alters = new Map(),
    fixes = [],
    voices = new Map();
  for (const line of tune?.lines || [])
    for (const [s, staff] of (line.staff || []).entries())
      for (const [v, voice] of (staff.voices || []).entries()) {
        const id = s + ':' + v,
          state = voices.get(id) || {key: {}, carried: {}, tied: {}};
        voices.set(id, state);
        if (staff.key) state.key = keyAlters(staff.key);
        for (const e of voice) {
          if (e.el_type === 'key') state.key = keyAlters(e);
          if (e.el_type === 'bar') state.carried = {};
          if (e.el_type !== 'note' || !e.pitches?.length || e.rest) continue;
          const wanted = want(e),
            tied = {},
            fix = [];
          const read = e.pitches.map((p, k) => {
            let alter = p.accidental
              ? (ALTER[p.accidental] ?? 0)
              : ((p.endTie ? state.tied[p.pitch] : null) ??
                state.carried[p.pitch] ??
                state.key['CDEFGAB'[posMod(p.pitch, 7)]] ??
                0);
            if (wanted?.[k] != null && wanted[k] !== alter) alter = fix[k] = wanted[k];
            if (p.accidental || fix[k] != null) state.carried[p.pitch] = alter;
            if (p.startTie) tied[p.pitch] = alter;
            return alter;
          });
          alters.set(e.startChar, read);
          state.tied = tied;
          if (fix.length) fixes.push({start: e.startChar, end: e.endChar, fix});
        }
      }
  return {alters, fixes};
}
// Write the accidentals a note needs (fix: alterations by pitch, in source order) into its text.
function setAccidentals(text, fix) {
  let k = 0;
  return text.replace(/"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|(\^{1,2}|_{1,2}|=)?([A-Ga-g])/g, (m, acc, letter) => {
    if (!letter) return m;
    const alter = fix[k++];
    return alter == null ? m : ACC_TEXT[alter] + letter;
  });
}
const solidAt = (text, at) => {
  while (/[ \t]/.test(text[at] || '')) at++;
  return at;
};
// applyNoteEdit for edits that move notes about (paste, duplicate, cut, delete and the multi-note edits): every note
// outside start..end keeps the pitch it had, with an accidental of its own where it now needs one. pasted ({start,
// end, alters}, positions in the new text) gives the notes pasted there the pitches they had where they were copied,
// spelled for the key and the accidentals around them. The fixes go into the same undo step.
function editKeepingPitches(start, end, text, select, hear = null, anchor = null, pasted = null) {
  const v = $('abc').value,
    delta = text.length - (end - start),
    shifts = [];
  let next = v.slice(0, start) + text + v.slice(end);
  try {
    // Notes are matched by where their music starts, as abcjs counts a space before a note after a bar line as its own.
    const kept = new Map(),
      copied = new Map();
    for (const [at, alters] of pitchWalk(ABCJS.parseOnly(v)[0]).alters) {
      const p = solidAt(v, at);
      if (p < start) kept.set(p, alters);
      else if (p >= end) kept.set(p + delta, alters);
    }
    const tune = ABCJS.parseOnly(next)[0];
    if (pasted?.alters) {
      const notes = scoreEvents(tune)
        .map(e => e.element)
        .filter(e => e.el_type === 'note' && e.pitches?.length && !e.rest)
        .filter(e => solidAt(next, e.startChar) >= pasted.start && solidAt(next, e.startChar) < pasted.end)
        .sort((a, b) => a.startChar - b.startChar);
      if (notes.length === pasted.alters.length) notes.forEach((e, i) => copied.set(e.startChar, pasted.alters[i]));
    }
    const {fixes} = pitchWalk(tune, e => copied.get(e.startChar) ?? kept.get(solidAt(next, e.startChar)));
    for (const f of fixes.sort((a, b) => b.start - a.start)) {
      const fixed = setAccidentals(next.slice(f.start, f.end), f.fix);
      next = next.slice(0, f.start) + fixed + next.slice(f.end);
      shifts.push([f.start, fixed.length - (f.end - f.start)]);
    }
  } catch {
    shifts.length = 0;
  }
  if (!shifts.length) return applyNoteEdit(start, end, text, select, hear, false, anchor);
  // Positions in the new text move by the fixes before them; a fix at a position belongs to the note starting there.
  const moved = at => at + shifts.reduce((sum, [from, d]) => sum + (from < at ? d : 0), 0);
  let same = 0;
  while (same < Math.min(v.length, next.length) - start && v.at(-1 - same) === next.at(-1 - same)) same++;
  applyNoteEdit(
    start,
    v.length - same,
    next.slice(start, next.length - same),
    select && select.map(moved),
    hear == null ? null : moved(hear),
    false,
    anchor
  );
}
// One edit over several notes: change(entry, text) gives each note's new source text and the text between them stays.
// The selection becomes the rewritten picked notes, keeping its anchor; hear (an entry) sounds that note. Notes after
// them keep their pitch.
function editNotes(entries, change, picked = entries, hear = null) {
  const v = $('abc').value,
    list = [...new Set([...entries, ...picked])].sort((a, b) => a.element.startChar - b.element.startChar),
    from = list[0].element.startChar,
    spans = new Map();
  let text = '',
    at = from;
  for (const n of list) {
    text += v.slice(at, n.element.startChar);
    const next = change(n, v.slice(n.element.startChar, n.element.endChar));
    spans.set(n, [from + text.length, from + text.length + next.length]);
    text += next;
    at = n.element.endChar;
  }
  const first = spans.get(picked[0]),
    last = spans.get(picked.at(-1));
  editKeepingPitches(
    from,
    at,
    text,
    [first[0], last[1]],
    hear ? spans.get(hear)[0] : null,
    picked.length > 1 ? selectionAnchor || 'first' : null
  );
}
const pitched = n => !!n.element.pitches?.length;
// Give notes new lengths (whole notes; null keeps a note's own). A note joined by > or < to a neighbour is spelled
// out with explicit lengths, with its neighbour, so the neighbour keeps its duration.
function setLengths(picked, lengthOf) {
  const touched = [...picked],
    paired = new Set();
  for (const n of picked)
    for (const m of brokenPair(n) || []) {
      paired.add(m);
      if (!touched.includes(m)) touched.push(m);
    }
  editNotes(
    touched,
    (n, text) => {
      const length = picked.includes(n) ? lengthOf(n) : null;
      if (length == null && !paired.has(n)) return text;
      return editNoteText(text, {
        length: (length ?? n.element.duration ?? 0) / unitLengthAt(n.element.startChar),
        unbroken: paired.has(n)
      });
    },
    picked,
    picked.find(pitched)
  );
}
// [ and ]: halve or double every length in the selection.
function scaleLengths(picked, factor) {
  const lengths = picked.map(n => (n.element.duration || 0) * factor);
  if (lengths.some(l => l > 2 + 1e-9)) {
    $('selection-status').textContent = 'That would make a note longer than two whole notes.';
    return;
  }
  if (lengths.some(l => l && l < 1 / 64 - 1e-9)) {
    $('selection-status').textContent = 'That would make a note shorter than a 64th note.';
    return;
  }
  setLengths(picked, n => (n.element.duration || 0) * factor);
  $('selection-status').textContent =
    `${factor > 1 ? 'Doubled' : 'Halved'} the length of ${countWords(picked.length)}.`;
}
const countWords = n => (n === 1 ? '1 note' : `${n} notes`);
const isDotted = n => DOTTABLE.some(x => Math.abs((n.element.duration || 0) - x * 1.5) < 1e-9);
// Keys on a range selection: ↑↓ (Ctrl: octave), sharp/flat/natural, dot, tie, Delete and the articulation keys act on
// every note.
function rangeKey(e, picked) {
  const key = e.key,
    first = picked.find(pitched),
    each = fn => editNotes(picked, (n, text) => (pitched(n) ? fn(n, text) : text), picked, first);
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const steps = (key === 'ArrowUp' ? 1 : -1) * (e.ctrlKey ? 7 : 1);
    each((n, text) => moveNoteText(text, steps));
    return true;
  }
  const accidental = {'#': '^', '-': '_', '=': '='}[key];
  if (accidental) {
    const batch = writtenBatch();
    each(n => accidentalEdit(n, displayOf(n), accidental, batch));
    return true;
  }
  if (key === '+') {
    const tie = !picked
      .filter(pitched)
      .every(n => /^-/.test(noteParts($('abc').value.slice(n.element.startChar, n.element.endChar))?.post || ''));
    each((n, text) => editNoteText(text, {tie}));
    return true;
  }
  if (key === '.') {
    const all = picked.every(isDotted);
    setLengths(picked, n => (all ? n.element.duration / 1.5 : isDotted(n) ? null : n.element.duration * 1.5));
    return true;
  }
  if (key === 'Delete' || key === 'Backspace') {
    deleteRun(picked);
    return true;
  }
  if (MARK_KEYS[key]) {
    $('selection-status').textContent = markRange(picked, 'deco:' + MARK_KEYS[key]);
    return true;
  }
  return false;
}
// The notation palette on a range selection: Dot, Tie, Sharp, Flat, Natural and Delete act on every selected note,
// as their keys do. Returns false, and changes nothing, for one note or another action.
const RANGE_PALETTE = {dot: '.', tie: '+', 'acc:^': '#', 'acc:_': '-', 'acc:=': '=', delete: 'Delete'};
function rangePalette(action, picked = selectedNotes()) {
  return picked.length > 1 && !!RANGE_PALETTE[action] && rangeKey({key: RANGE_PALETTE[action]}, picked);
}
// Delete a run. Whole measures go with one of their bar lines, so no empty measure is left behind, and a line left
// with nothing on it goes with its line break: a blank line ends the tune in ABC, which would drop every measure
// after it. A line break between notes that stay is kept. Anything else between the notes (an inline field, a
// comment) stays, and then only the notes go. The notes after the run keep their pitch.
function deleteRun(picked) {
  const v = $('abc').value,
    {before, after, whole, items} = runBars(picked);
  let start = picked[0].element.startChar,
    end = picked.at(-1).element.endChar;
  if (whole && plainBar(after)) end = after.element.endChar;
  else if (whole && plainBar(before)) start = before.element.startChar;
  const parts = [
    ...items,
    ...[before, after].filter(b => b && b.element.startChar >= start && b.element.endChar <= end)
  ];
  let rest = v.slice(start, end);
  for (const n of parts.sort((a, b) => b.element.startChar - a.element.startChar))
    rest = rest.slice(0, n.element.startChar - start) + rest.slice(n.element.endChar - start);
  let text = '';
  if (rest.trim()) {
    // Keep what is not a note: remove each note's text only.
    start = picked[0].element.startChar;
    end = picked.at(-1).element.endChar;
    text = v.slice(start, end);
    for (const n of [...picked].reverse())
      text = text.slice(0, n.element.startChar - start) + text.slice(n.element.endChar - start);
  } else {
    // Close the gap over the spaces on both sides: a whole line goes with one line break, a line's start or end
    // closes up, and in the middle of a line one space stays (none between beamed notes).
    let a = start,
      b = end;
    while (a > 0 && /[ \t]/.test(v[a - 1])) a--;
    while (b < v.length && /[ \t]/.test(v[b])) b++;
    const lineStart = a === 0 || v[a - 1] === '\n',
      lineEnd = b === v.length || v[b] === '\n';
    if (lineStart && lineEnd) {
      if (b < v.length) b++;
      else if (a > 0) a--;
    } else if (!lineStart && !lineEnd) text = rest.includes('\n') && !whole ? '\n' : a < start || b > end ? ' ' : '';
    start = a;
    end = b;
  }
  const prev = scoreNotes()
    .filter(
      n => n.element.startChar < Math.min(start, picked[0].element.startChar) && voiceOf(n) === voiceOf(picked[0])
    )
    .pop();
  editKeepingPitches(start, end, text, prev ? [prev.element.startChar, Math.min(prev.element.endChar, start)] : null);
  $('selection-status').textContent = `Deleted ${countWords(picked.length)}.`;
}
// The clipboard. Copy keeps the selection's source text in memory (and offers it to the system clipboard when the
// browser allows), with what it needs to paste elsewhere: its total length, the unit length it was written in, the
// pitch each note sounded (accidentals carry through a measure, so a note's text alone does not say), and whether it
// is whole measures (then the bar line after it comes along).
let clip = null;
// Fields inside the music: inline ones such as [K:D] or [L:1/8], and field or %% lines between lines of music.
const MUSIC_FIELDS = /[ \t]*\[[A-Za-z]:[^\]\n]*\]|\n(?:[A-Za-z+]:|%%)[^\n]*/g;
function clipOf(picked) {
  const v = $('abc').value,
    start = picked[0].element.startChar,
    unit = unitLengthAt(start),
    {whole} = runBars(picked),
    alters = pitchWalk(ABCJS.parseOnly(v)[0]).alters;
  let notes = v.slice(start, picked.at(-1).element.endChar).trim();
  // A field in the clip would go on applying to the music after the paste. The notes keep the lengths (written out
  // in the clip's unit length) and pitches (in alters) it gave them, and the fields stay behind.
  if (notes.search(MUSIC_FIELDS) >= 0) {
    if (/\[L:|\nL:/.test(notes)) notes = rescaleMusic(notes, unit, unit);
    notes = notes.replace(MUSIC_FIELDS, '').trim();
  }
  return {
    notes,
    bar: whole,
    count: picked.length,
    length: picked.reduce((sum, n) => {
      const shown = displayOf(n);
      return sum + ((shown && noteDurations.get(shown.startChar)) ?? (n.element.duration || 0));
    }, 0),
    unit,
    alters: picked.filter(pitched).map(n => alters.get(n.element.startChar) || [])
  };
}
const unitText = unit => {
  const t = lengthText(unit) || '1';
  return t.startsWith('/') ? '1' + t : t;
};
// Respell the lengths of a stretch of music for another unit length (L:), each note with its own explicit length.
function rescaleMusic(text, from, to) {
  const head = `X:1\nL:${unitText(from)}\nK:C\n`,
    tune = ABCJS.parseOnly(head + text)[0];
  let out = head + text;
  for (const {element: n} of scoreEvents(tune)
    .filter(e => e.element.el_type === 'note')
    .sort((a, b) => b.element.startChar - a.element.startChar))
    out =
      out.slice(0, n.startChar) +
      editNoteText(out.slice(n.startChar, n.endChar), {length: (n.duration || 0) / to, unbroken: true}) +
      out.slice(n.endChar);
  return out.slice(head.length);
}
// The clip's text for a place in the open score, rewritten for that place's unit length so every note keeps its
// length. Pitches are spelled for the place's key and bar as it goes in (see pasteText).
function clipText(c, at) {
  const unit = unitLengthAt(at);
  try {
    if (Math.abs(unit - c.unit) > 1e-9) return rescaleMusic(c.notes, c.unit, unit);
  } catch {}
  return c.notes;
}
// Put the clip's text in place of start..end and select it, its notes at the pitches they were copied at (and the
// notes after them at theirs). lead and tail go around it.
function pasteText(c, start, end, lead, notes, tail) {
  const at = start + lead.length;
  editKeepingPitches(start, end, lead + notes + tail, [at, at + notes.length], at, c.count > 1 ? 'first' : null, {
    start: at,
    end: at + notes.length,
    alters: c.alters
  });
}
// Put a clip after a note (at the end of the music without one), then select it. Whole measures go after the bar
// line that ends the note's measure, or before it when it is a closing or repeat bar line, or after a new bar line
// at the end of music that has none.
function pasteAfter(last, c, verb) {
  const v = $('abc').value,
    bars = last && runBars([last]);
  let at = last ? last.element.endChar : tuneEndPosition(),
    before = '',
    behind = '';
  if (c.bar && plainBar(bars?.after)) {
    at = bars.after.element.endChar;
    behind = ' |';
  } else if (c.bar && (bars?.after || bars?.open)) {
    if (bars.after) at = bars.after.element.startChar;
    before = '| ';
  }
  const lead = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '',
    trail = v[at] && !/\s/.test(v[at]) ? ' ' : '';
  pasteText(c, at, at, lead + before, clipText(c, at), behind + trail);
  $('selection-status').textContent = `${verb} ${countWords(c.count)}.`;
}
// Ctrl+V: a selected rest at least as long as the clip is written over from its start, keeping what is left as a
// rest; otherwise the clip goes after the selection. Pasting never re-bars; the bar check reports any overflow.
function pasteClip(picked) {
  if (!clip) {
    $('selection-status').textContent = 'Nothing to paste yet. Select notes, then Copy (Ctrl+C).';
    return;
  }
  const v = $('abc').value,
    rest = picked.length === 1 && !pitched(picked[0]) ? picked[0] : null,
    old = rest ? v.slice(rest.element.startChar, rest.element.endChar) : '',
    shown = rest && displayOf(rest),
    room = rest ? ((shown && noteDurations.get(shown.startChar)) ?? (rest.element.duration || 0)) : 0;
  if (!rest || !/^\s*z[\d/]*\s*$/.test(old) || room < clip.length - 1e-9) {
    pasteAfter(picked.at(-1) || scoreNotes().at(-1), clip, 'Pasted');
    return;
  }
  const start = rest.element.startChar,
    unit = unitLengthAt(start),
    left = room - clip.length,
    lead = old.match(/^\s*/)[0] || (start > 0 && !/\s/.test(v[start - 1]) ? ' ' : ''),
    trail = old.match(/\s*$/)[0] || (/[A-Za-z^_=[(]/.test(v[rest.element.endChar] || '') ? ' ' : '');
  pasteText(
    clip,
    start,
    rest.element.endChar,
    lead,
    clipText(clip, start),
    (left > 1e-6 ? ' z' + lengthText(left / unit) : '') + trail
  );
  $('selection-status').textContent = `Pasted ${countWords(clip.count)} over the rest.`;
}
// A rest as long as a note, for Cut: the length as written, so tuplets and broken rhythm still add up. Slurs, tuplet
// marks and chord symbols stay; decorations, grace notes and ties go.
function restText(text) {
  const p = noteParts(text);
  if (!p || /^[zx]/.test(p.core)) return text;
  const inner = p.core[0] === '[' ? lengthValue(p.core.match(/[A-Ga-g][,']*(\d*\/*\d*)/)?.[1] || '') : 1,
    pre = (p.pre.match(/"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|\((?:\d+(?::\d*){0,2})?|[.~HLMOPSTuv]|\s/g) || [])
      .filter(t => /^["(\s]/.test(t))
      .join('');
  return pre + 'z' + lengthText(p.length * inner) + p.post.replace(/-/g, '');
}
function copySelection(picked, verb = 'Copied') {
  clip = clipOf(picked);
  try {
    navigator.clipboard?.writeText?.(clip.notes + (clip.bar ? ' |' : ''))?.catch?.(() => {});
  } catch {}
  $('selection-status').textContent =
    `${verb} ${countWords(picked.length)}. Paste (Ctrl+V) puts them after the selection.`;
}
// Ctrl/Cmd with A (select all), C (copy), X (cut to rests), V (paste) and D (duplicate after itself, then select the
// copy). Each edit is one undo step.
function selectionCommand(command) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  if (command === 'a') {
    selectAllNotes();
    return;
  }
  const picked = selectedNotes();
  if (command === 'v') {
    pasteClip(picked);
    return;
  }
  if (!picked.length) {
    $('selection-status').textContent =
      'Select notes first: click a note, then Select ▸ (Shift+→) or Shift+click another to select more.';
    return;
  }
  if (command === 'c') copySelection(picked);
  if (command === 'x') {
    copySelection(picked);
    editNotes(picked, (n, text) => restText(text), picked);
    $('selection-status').textContent =
      `Cut ${countWords(picked.length)}; rests keep their place. Paste (Ctrl+V) puts the notes after the selection.`;
  }
  if (command === 'd') pasteAfter(picked.at(-1), clipOf(picked), 'Duplicated');
}
// Buttons for the same commands, for touch screens.
for (const [id, command] of [
  ['copy-notes', 'c'],
  ['cut-notes', 'x'],
  ['paste-notes', 'v'],
  ['duplicate-notes', 'd']
])
  $(id).onclick = () => selectionCommand(command);
for (const [id, step] of [
  ['select-left', -1],
  ['select-right', 1]
])
  $(id).onclick = () => {
    if (renderedSource !== $('abc').value) {
      clearTimeout(renderTimer);
      render();
    }
    extendSelection(step);
  };
function updateFingering(source) {
  const option = $('fingering-option'),
    kind = FINGERING[currentInstrument()];
  if (option) {
    option.hidden = !kind;
    if (kind) $('fingering-label').textContent = kind.label;
  }
  if (fingeringShown() !== 'recorder') return;
  const svg = $('notation').querySelector('svg'),
    staffs = staffList(),
    notes = new Map(noteLabels(ABCJS.parseOnly(source)[0], 'letters').map(l => [l.at, l.midi]));
  const ns = 'http://www.w3.org/2000/svg',
    dot = (g, x, y, closed) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x);
      c.setAttribute('cy', y);
      c.setAttribute('r', 3.2);
      c.setAttribute('fill', closed ? 'currentColor' : 'white');
      c.setAttribute('stroke', 'currentColor');
      c.setAttribute('stroke-width', 0.8);
      g.appendChild(c);
    };
  for (const sel of renderedTune?.engraver?.selectables || []) {
    const midi = notes.get(sel.absEl.abcelem.startChar),
      holes = RECORDER_FINGERING[midi],
      head = sel.svgEl.querySelector('.abcjs-notehead');
    if (!holes || !head) continue;
    const box = head.getBBox(),
      x = box.x + box.width / 2,
      staff = nearestStaff(staffs, box.y + box.height / 2),
      top = staff.y + (noteNamesMode() === 'off' ? 20 : 34);
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'recorder-fingering');
    g.setAttribute(
      'aria-label',
      `Recorder fingering: ${
        holes
          .map((h, i) => (h ? (i ? i : 'thumb') : ''))
          .filter(Boolean)
          .join(' ') || 'all open'
      }`
    );
    // Thumb hole offset left, as on printed charts; a gap separates the left and right hands.
    dot(g, x - 7, top, holes[0]);
    for (let i = 1; i < 8; i++) dot(g, x, top + 2 + i * 7.6 + (i > 3 ? 4 : 0), holes[i]);
    svg.appendChild(g);
  }
}
// Classroom colors and letters in noteheads, drawn on the engraved SVG after each render. Both stay in print and SVG
// export (worksheets), so they are set as attributes; the class only lets a selected or playing note show as one.
// Each head names its written pitch in data-name ("^c", "A,"), which covers chords and grace notes; heads without
// one pair with the pitches by height, lowest first, and grace heads with the grace notes in order.
// abcjs shrinks grace heads with a CSS scale that getBBox() ignores, so they are found by that style instead.
// Every head is read and measured before anything is drawn: measuring after each note's letter goes in would make
// the browser lay out the whole score again for every note.
function updateNoteColors() {
  const colors = noteColorsShown(),
    letters = lettersInHeads();
  if (!colors && !letters) return;
  const letter = pitch => (pitch == null ? null : 'CDEFGAB'[((pitch % 7) + 7) % 7]),
    drawn = [];
  for (const sel of renderedTune?.engraver?.selectables || []) {
    const note = sel.absEl.abcelem;
    if (note.el_type !== 'note' || note.rest || !note.pitches?.length) continue;
    const heads = [...sel.svgEl.querySelectorAll('.abcjs-notehead')],
      grace = heads.map(h => /scale\(/.test(h.getAttribute('style') || ''));
    let names = heads.map(h => (h.getAttribute('data-name') || '').match(/[A-G]/i)?.[0].toUpperCase());
    const unnamed = names.some(n => !n),
      boxes = heads.map((h, i) => ((letters || unnamed) && !grace[i] && h.getBBox?.()) || null);
    if (unnamed) {
      const pitches = note.pitches.map(p => p.pitch).sort((a, b) => a - b),
        graces = (note.gracenotes || []).map(g => g.pitch);
      names = heads.map((h, i) => (grace[i] ? letter(graces.shift()) : null));
      heads
        .map((h, i) => [i, boxes[i]?.y || 0])
        .filter(([i]) => !grace[i])
        .sort((a, b) => b[1] - a[1])
        .forEach(([i], n) => (names[i] = letter(pitches[n])));
    }
    drawn.push({sel, heads, names, grace, boxes, hollow: note.duration >= 0.5});
  }
  const ns = 'http://www.w3.org/2000/svg';
  // Half and whole heads are hollow, so their letter is drawn in ink; grace heads are too small for one.
  for (const {sel, heads, names, grace, boxes, hollow} of drawn) {
    heads.forEach((head, i) => {
      const color = colors && NOTE_COLORS[names[i]];
      if (color) {
        head.setAttribute('fill', color.fill);
        head.classList.add('classroom-color');
        if (color.stroke) {
          head.setAttribute('stroke', color.stroke);
          head.setAttribute('stroke-width', '0.6');
        }
      }
      const box = boxes[i];
      if (!letters || !names[i] || grace[i] || !box) return;
      // The letter goes last in the note's group so ledger lines do not cross it.
      const cx = box.x + box.width / 2,
        cy = box.y + box.height / 2,
        text = document.createElementNS(ns, 'text');
      text.setAttribute('class', hollow ? 'notehead-letter hollow' : 'notehead-letter');
      text.setAttribute('x', cx);
      text.setAttribute('y', cy);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('font-size', Math.max(5, box.height).toFixed(1));
      text.setAttribute('fill', hollow ? 'black' : color ? color.ink : 'white');
      text.setAttribute('aria-hidden', 'true');
      text.textContent = names[i];
      sel.svgEl.appendChild(text);
    });
  }
}
// Trill lines (!trill(! … !trill)!): abcjs draws only the tr (see writtenABC), so a wavy line goes from it to the end
// of the line's last note, carrying on across system breaks. It is part of the score, so prints and SVG exports keep it.
// A score drawn while the studio is hidden (openScore draws it before showing it) cannot be measured, so its lines
// wait until the studio shows.
let trillsPending = null;
function updateTrillLines() {
  const svg = $('notation').querySelector('svg'),
    selectables = renderedTune?.engraver?.selectables || [];
  trillsPending = null;
  if (!svg || !selectables.length || !/[!+]trill\(/.test($('abc').value)) return;
  svg.querySelectorAll('.trill-line').forEach(p => p.remove());
  if (!svg.getBoundingClientRect().width) {
    trillsPending = renderedTune;
    return;
  }
  const byStart = new Map(selectables.map(s => [s.absEl.abcelem?.startChar, s.svgEl])),
    svgOf = entry => byStart.get(displayOf(entry)?.startChar),
    lineOf = el => el.getAttribute('class')?.match(/abcjs-l(\d+)/)?.[1] ?? '',
    box = el => {
      try {
        return el?.getBBox?.() || null;
      } catch {
        return null;
      }
    },
    // The top lines of a system's staves, top to bottom.
    tops = line =>
      [...svg.querySelectorAll(`.abcjs-staff.abcjs-l${line} .abcjs-top-line`)]
        .map(l => box(l)?.y ?? 0)
        .sort((a, b) => a - b);
  const draw = run => {
    const els = run.map(svgOf).filter(Boolean),
      tr = box(els[0]?.querySelector('[data-name="scripts.trill"]'));
    if (!tr) return;
    const lines = new Map();
    for (const el of els) lines.get(lineOf(el))?.push(el) ?? lines.set(lineOf(el), [el]);
    // On a later system the line keeps its height above the same staff.
    const first = lineOf(els[0]),
      y0 = tr.y + tr.height / 2,
      head = box(els[0].querySelector('.abcjs-notehead')),
      staff = Math.max(0, tops(first).filter(y => y <= (head?.y ?? y0)).length - 1),
      above = y0 - (tops(first)[staff] ?? 0);
    for (const [line, group] of lines) {
      const heads = group.map(el => box(el.querySelector('.abcjs-notehead') || el)).filter(Boolean);
      if (!heads.length) continue;
      const x0 = line === first ? tr.x + tr.width + 1 : Math.min(...heads.map(b => b.x)) - 2,
        x1 = Math.max(...heads.map(b => b.x + b.width)),
        y = line === first ? y0 : (tops(line)[staff] ?? 0) + above;
      if (x1 - x0 < 3) continue;
      let d = `M ${x0.toFixed(1)} ${y.toFixed(1)}`;
      for (let x = x0; x + 3 <= x1; x += 3) d += ' q 0.75 -2 1.5 0 q 0.75 2 1.5 0';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'trill-line');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.1');
      path.setAttribute('aria-hidden', 'true');
      svg.appendChild(path);
    }
  };
  // Each voice's trill lines, from the note that opens one to the note that closes it (or just its first note).
  for (const notes of notesByVoice().values()) {
    let start = null;
    notes.forEach((n, i) => {
      const deco = n.element.decoration || [];
      if (start != null && deco.includes('trill)')) {
        draw(notes.slice(start, i + 1));
        start = null;
      }
      if (deco.includes('trill(')) start = i;
    });
    if (start != null) draw(notes.slice(start, start + 1));
  }
}
if (typeof MutationObserver === 'function')
  new MutationObserver(() => {
    if (trillsPending && trillsPending === renderedTune && !$('studio').hidden) updateTrillLines();
  }).observe($('studio'), {attributes: true, attributeFilter: ['hidden']});
// Writing prompts: a short assignment with a blank score (one whole-bar rest per bar) and goals that tick off live.
function promptById(id) {
  return (typeof writingPrompts === 'undefined' ? [] : writingPrompts).find(p => p.id === id);
}
// The open score's prompt: a built-in prompt's id, or a teacher's assignment object. An object can come from a link,
// a backup or storage, so it is checked every time it is used.
function activePrompt(prompt = current?.prompt) {
  return typeof prompt === 'string' ? promptById(prompt) : validPrompt(prompt) || undefined;
}
function renderPromptCards() {
  $('prompt-cards').innerHTML = writingPrompts
    .map(
      p =>
        `<article class="prompt-card"><span class="tag">${esc(p.level.toUpperCase())} · ${esc(p.meter)} · ${esc(p.key.replace('m', ' minor').replace(/^([A-G])$/, '$1 major'))}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p><button class="primary" data-prompt="${esc(p.id)}">Start writing</button></article>`
    )
    .join('');
}
function togglePrompts(open) {
  $('prompt-picker').hidden = !open;
  $('open-prompts').setAttribute('aria-expanded', open);
  if (open) {
    if (typeof toggleAssignmentBuilder === 'function') toggleAssignmentBuilder(false);
    if (typeof toggleNewScore === 'function') toggleNewScore(false);
    renderPromptCards();
    $('prompt-picker').scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
}
function startPrompt(prompt) {
  // The prompt's key is written pitch; the source keeps concert pitch, so transpose the key for transposing instruments.
  const shift = instruments[currentInstrument()].shift % 12 ? instruments[currentInstrument()].shift : 0;
  let key = prompt.key;
  if (shift) {
    const mini = `X:1\nK:${key}\n`;
    key = (ABCJS.strTranspose(mini, ABCJS.parseOnly(mini), -shift).match(/^K:\s*(\S+)/m) || [, key])[1];
  }
  const abc = promptSource(prompt, key);
  if (!allowReplace()) return;
  dirty = false;
  openScore({
    title: prompt.title,
    composer: '',
    kind: 'personal',
    abc,
    instrument: currentInstrument(),
    prompt: prompt.id
  });
  togglePrompts(false);
  const first = scoreNotes()[0];
  if (first) selectEntry(first);
  $('selection-status').textContent =
    'The first rest is selected. Type note letters (A–G) to write over it; 3–7 change the length.';
}
function updatePromptCheck(shown) {
  const box = $('prompt-check'),
    prompt = activePrompt();
  if (!box) return;
  if (!prompt) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  // Goals are written pitch (a B-flat clarinet asked for G major writes in G), so Concert pitch view checks a written
  // copy of the score and says so above the checklist.
  const concert = concertView();
  if (concert) shown = ABCJS.parseOnly(writtenABC(instrumentShift()))[0];
  // A teacher's assignment may have instructions and no goals; then there is no checklist.
  const goals = checkPrompt(prompt, melodyBars(shown)),
    done = goals.length > 0 && goals.every(g => g.ok);
  box.hidden = false;
  box.classList.toggle('done', done);
  box.innerHTML = `<div class="prompt-check-head"><strong>${prompt.level === 'Custom' ? 'Assignment' : 'Writing prompt'} · ${esc(prompt.title)}</strong>${goals.length ? `<span class="small">${goals.filter(g => g.ok).length} of ${goals.length} goals</span>` : ''}</div>${prompt.text ? `<p class="prompt-text">${esc(prompt.text)}</p>` : ''}${concert && goals.length ? '<p class="small">Goals are in written pitch; turn off Concert pitch to see the written part.</p>' : ''}${goals.length ? `<ul>${goals.map(g => `<li class="${g.ok ? 'met' : ''}"><span aria-hidden="true">${g.ok ? '✓' : '○'}</span> ${esc(g.label)}<span class="sr-only">${g.ok ? ' (done)' : ' (not yet)'}</span></li>`).join('')}</ul>` : ''}${done ? '<p class="prompt-done">All goals met. Play it back, then save it or export it to hand in.</p>' : ''}`;
}
$('open-prompts').onclick = () => togglePrompts($('prompt-picker').hidden);
$('close-prompts').onclick = () => togglePrompts(false);
$('prompt-cards').addEventListener('click', e => {
  const b = e.target.closest('[data-prompt]');
  if (b) startPrompt(promptById(b.dataset.prompt));
});
// Key changes and transposing. Keys here are the source's concert keys. Picking a key asks first: move the notes to
// the new key, or keep them where they are and change only the signature. A score without notes just changes key.
function fillKeySelect(select) {
  for (const group of new Set(KEY_LIST.map(k => k.group))) {
    const g = document.createElement('optgroup');
    g.label = group;
    for (const k of KEY_LIST.filter(x => x.group === group)) g.append(new Option(k.label, k.value));
    select.append(g);
  }
}
const sourceKey = () => canonicalKey(field('K', 'C'));
let keyPending = null;
function hideKeyChoice() {
  keyPending = null;
  if ($('key-choice')) $('key-choice').hidden = true;
}
function chooseKey(value) {
  const from = sourceKey();
  if (value === from) {
    hideKeyChoice();
    return;
  }
  const notes = scoreEvents(ABCJS.parseOnly($('abc').value)[0]).some(e => e.element.pitches?.length);
  if (!notes) {
    changeKey(value, false);
    return;
  }
  keyPending = value;
  $('key-choice-text').textContent = `Change the key to ${keyLabel(value)}:`;
  $('key-transpose').disabled = !keyInterval(from, value);
  $('key-choice').hidden = false;
}
function cancelKeyChoice() {
  hideKeyChoice();
  assignSelect('key', sourceKey(), keyLabel(field('K', 'C')));
}
// "up a major 2nd", or a count of semitones for moves that are not one of the listed intervals.
function intervalWords(semitones, letters) {
  const i = TRANSPOSE_INTERVALS.find(x => x.semitones === Math.abs(semitones) && x.letters === Math.abs(letters)),
    way = semitones < 0 ? 'down' : 'up';
  if (i) return `${way} ${/^[aeiou]/.test(i.name) ? 'an' : 'a'} ${i.name}`;
  return `${way} ${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? '' : 's'}`;
}
// Record a rewrite of the whole source, made from before, as one undo step. A rewrite that changed nothing is not an edit.
function commitSource(before, message) {
  if ($('abc').value === before) {
    syncFields();
    toast('Nothing to change.');
    return;
  }
  dirty = true;
  $('save-status').textContent = 'Unsaved changes';
  selectedRange = null;
  clearTimeout(renderTimer);
  syncFields();
  render();
  $('selection-status').textContent = message;
  toast(message);
}
function changeKey(value, transpose) {
  flushTyping();
  hideKeyChoice();
  const before = $('abc').value,
    move = transpose ? keyInterval(sourceKey(), value) : null;
  try {
    if (move) $('abc').value = transposeABC($('abc').value, move.semitones, move.letters, 7);
  } catch (e) {
    toast(e.message);
    cancelKeyChoice();
    return;
  }
  setHeader('K', value);
  const words = !move
    ? 'The notes stay where they are.'
    : move.semitones
      ? `The notes moved ${intervalWords(move.semitones, move.letters)}.`
      : 'The notes keep their pitches.';
  commitSource(before, `Key: ${keyLabel(value)}. ${words}`);
}
// The choice's buttons hide with it, so focus goes back to the Key menu.
for (const [id, transpose] of [
  ['key-transpose', true],
  ['key-keep', false]
])
  $(id).onclick = () => {
    if (!keyPending) return;
    changeKey(keyPending, transpose);
    $('key').focus();
  };
$('key-cancel').onclick = () => {
  cancelKeyChoice();
  $('key').focus();
};
$('key').addEventListener('keydown', e => {
  if (e.key === 'Escape' && keyPending) cancelKeyChoice();
});
$('key-choice').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  cancelKeyChoice();
  $('key').focus();
});
// The Transpose panel: by an interval up or down, or to a key the nearer way round, for the whole score or only the
// selected measures (the practice range when one is set, otherwise the selected note's measure).
function transposeTarget() {
  const {from, to, total} = measureRange();
  if (noteSources.size && !(from === 1 && to === total)) return {from, to};
  const picked = selectedNotes();
  return picked.length ? {from: picked[0].measure, to: picked.at(-1).measure} : null;
}
const measuresText = t => (t.from === t.to ? `measure ${t.from}` : `measures ${t.from}–${t.to}`);
// What the panel would do, or null when the score's key cannot move (K:HP).
function transposePlan() {
  if ($('transpose-by-key').checked) {
    const to = $('transpose-key').value,
      move = keyInterval(sourceKey(), to);
    return move && {...move, to};
  }
  if (keyFifths(sourceKey()) == null) return null;
  const i = TRANSPOSE_INTERVALS.find(x => x.id === $('transpose-interval').value),
    way = +$('transpose-direction').value;
  return {semitones: i.semitones * way, letters: i.letters * way};
}
// Bring the open panel up to date with the score, its key and the selection; render() calls this after every change,
// so a new score, an undo or a key change never leaves a stale summary or a stale Selection only box.
function refreshTranspose() {
  if ($('transpose-panel')?.hidden !== false) return;
  const byKey = $('transpose-by-key').checked,
    target = transposeTarget(),
    only = $('transpose-selection');
  $('transpose-interval-row').hidden = byKey;
  $('transpose-key-row').hidden = !byKey;
  only.disabled = !target;
  if (!target) only.checked = false;
  const plan = transposePlan(),
    key = sourceKey();
  let note;
  try {
    if (!plan) note = 'This key cannot be transposed.';
    else {
      const moved = intervalWords(plan.semitones, plan.letters);
      if (plan.to === key) note = `The score is already in ${keyLabel(key)}.`;
      else if (only.checked)
        note = plan.semitones
          ? `The notes in ${measuresText(target)} move ${moved}. The key signature stays.`
          : 'The selected notes keep their pitches.';
      else if (!plan.semitones) note = `${keyLabel(key)} becomes ${keyLabel(plan.to)}: the same pitches, spelled anew.`;
      else {
        const head = transposeABC(`X:1\nK:${key}\n`, plan.semitones, plan.letters, plan.to ? 7 : 6),
          next = plan.to || keyParts(keyFields(head)[0].value).key;
        note =
          canonicalKey(next) === key
            ? `The notes move ${moved}. The key stays ${keyLabel(key)}. Chord symbols move too.`
            : `${keyLabel(key)} becomes ${keyLabel(next)}: the notes move ${moved}. Chord symbols move too.`;
      }
      if (transposing()) note += ` Keys are concert pitch; the score shows written pitch for ${currentInstrument()}.`;
    }
  } catch {
    note = 'This key cannot be transposed.';
  }
  // Only changed text is written, so screen readers do not hear the same summary after every edit.
  const label = target
    ? `Selection only: ${measuresText(target)}`
    : 'Selection only (click a note, or Shift+click to choose measures)';
  if ($('transpose-selection-label').textContent !== label) $('transpose-selection-label').textContent = label;
  if ($('transpose-note').textContent !== note) $('transpose-note').textContent = note;
  $('transpose-apply').disabled = !plan || (!plan.semitones && !posMod(plan.letters, 7));
}
function toggleTranspose(open) {
  $('transpose-panel').hidden = !open;
  $('transpose-open').setAttribute('aria-expanded', open);
  if (!open) return;
  // Each opening starts on the whole score, so an old selection is never transposed by surprise.
  $('transpose-selection').checked = false;
  assignSelect('transpose-key', sourceKey(), keyLabel(field('K', 'C')));
  refreshTranspose();
  $('transpose-panel').querySelector('input:checked')?.focus();
}
function applyTranspose() {
  // Read the box first: a render refreshes the panel, and an emptied selection clears the box.
  const only = $('transpose-selection').checked;
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  flushTyping();
  const plan = transposePlan(),
    target = only ? transposeTarget() : null,
    value = $('abc').value;
  if (!plan) {
    toast('This key cannot be transposed.');
    return;
  }
  // Selection only with nothing selected must not fall back to moving the whole score.
  if (only && !target) {
    refreshTranspose();
    toast('No measures are selected. Click a note, or clear Selection only.');
    return;
  }
  let text = value;
  try {
    if (target)
      for (const s of measureSpans(ABCJS.parseOnly(value)[0], target.from, target.to).reverse()) {
        const unit = '1/' + Math.round(1 / unitLengthAt(s.start)),
          moved = transposeSlice(
            value.slice(s.start, s.end),
            keyAt(value, s.start),
            unit,
            plan.semitones,
            plan.letters
          );
        text = text.slice(0, s.start) + moved + text.slice(s.end);
      }
    else text = transposeABC(value, plan.semitones, plan.letters, plan.to ? 7 : 6);
  } catch (e) {
    toast(e.message);
    return;
  }
  $('abc').value = text;
  if (plan.to && !target) setHeader('K', plan.to);
  const moved = plan.semitones ? `moved ${intervalWords(plan.semitones, plan.letters)}` : 'kept their pitches';
  toggleTranspose(false);
  commitSource(
    value,
    target ? `The notes in ${measuresText(target)} ${moved}.` : `The notes ${moved}. Key: ${keyLabel(field('K', 'C'))}.`
  );
  $('transpose-open').focus();
}
$('transpose-open').onclick = () => toggleTranspose($('transpose-panel').hidden);
$('transpose-close').onclick = () => {
  toggleTranspose(false);
  $('transpose-open').focus();
};
$('transpose-apply').onclick = applyTranspose;
$('transpose-panel').addEventListener('input', refreshTranspose);
$('transpose-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  toggleTranspose(false);
  $('transpose-open').focus();
});
// The selection and the practice range can change while the panel is open.
for (const [id, type] of [
  ['notation', 'click'],
  ['notation', 'keyup'],
  ['start-measure', 'change'],
  ['end-measure', 'change']
])
  $(id).addEventListener(type, refreshTranspose);
// Bar check fixes.
$('bar-check').addEventListener('click', e => {
  const b = e.target.closest('[data-bar-fix]'),
    m = barIssues[+b?.dataset.bar];
  if (!m) return;
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Check the bars again.');
    return;
  }
  const area = $('abc'),
    v = area.value,
    start = m.notes[0].element.startChar,
    end = (m.bar || m.notes.at(-1).element).endChar;
  if (b.dataset.barFix === 'show') {
    area.focus({preventScroll: true});
    area.setSelectionRange(start, end);
    const rect = $('notation').querySelector(`.bar-flag[data-measure="${m.measure}"]`);
    rect?.scrollIntoView({block: 'center', behavior: 'smooth'});
    $('selection-status').textContent = `Measure ${m.measure} selected in the ABC text.`;
    return;
  }
  if (b.dataset.barFix === 'rest') {
    // The rest goes just before the closing bar line, or at the end of an unbarred last measure.
    const at = m.bar ? m.bar.startChar : m.notes.at(-1).element.endChar,
      rest = 'z' + lengthText((m.expected - m.length) / unitLengthAt(at));
    const text = (/\s/.test(v[at - 1] || ' ') ? '' : ' ') + rest + (m.bar ? ' ' : '');
    applyNoteEdit(at, at, text, [at + text.indexOf(rest), at + text.indexOf(rest) + rest.length]);
    return;
  }
  const cut = barSplit(m);
  if (!cut) return;
  const at = cut.element.endChar,
    text = (/\s/.test(v[at - 1]) ? '' : ' ') + '| ';
  applyNoteEdit(at, at, text, null);
});
// Undo/redo buttons and shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y). In the ABC box they replace the browser's
// own undo, which doesn't know about edits made on the score. Other text fields keep their own; menus, sliders and
// boxes have none, so a key change made from the Key menu undoes from there.
$('undo').onclick = () => stepHistory(-1);
$('redo').onclick = () => stepHistory(1);
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || $('studio').hidden) return;
  const key = e.key.toLowerCase(),
    field = e.target.closest?.('input,select,textarea');
  if (field && field.id !== 'abc' && !/^(select-one|checkbox|radio|range)$/.test(field.type)) return;
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    stepHistory(-1);
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    stepHistory(1);
  }
});

// Share by link. The link carries the score itself, so anyone with it gets a copy; nothing is uploaded.
// Scores from a library edition carry the edition's id, so the rights notice travels with them.
const SHARE_WARN_LENGTH = 8000;
function shareSourceId() {
  if (!current) return undefined;
  const source = catalog.find(
    x => x === current || (x.rights && x.rights === current.rights && x.source === current.source)
  );
  return source?.id;
}
async function shareLink() {
  const payload = {v: 1, a: $('abc').value, i: currentInstrument()};
  const source = shareSourceId();
  if (source) payload.s = source;
  // A built-in prompt travels by id (p); a teacher's assignment travels whole (q). Older apps ignore q.
  const prompt = activePrompt();
  if (prompt?.level === 'Custom') payload.q = prompt;
  else if (prompt) payload.p = prompt.id;
  const url = `${location.origin}${location.pathname}#s=${await encodeShare(payload)}`;
  const panel = $('share-panel');
  panel.hidden = false;
  $('share-url').value = url;
  $('share-note').textContent =
    `${url.length.toLocaleString()} characters. ` +
    (url.length > SHARE_WARN_LENGTH
      ? 'Some messaging apps cut links this long; export ABC for a safer copy.'
      : 'Anyone with the link gets a copy of the score. Nothing is uploaded; the music is inside the link.');
  let copied = false;
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {}
  toast(copied ? 'Link copied. Paste it anywhere.' : 'Select the link and copy it.');
  if (!copied) {
    $('share-url').focus();
    $('share-url').select();
  }
}
// A shared score opens as a copy, in the sender's instrument, with the library edition's credits when it has one.
async function openSharedLink(hash) {
  const payload = await decodeShare(hash.slice(2));
  if (!payload) {
    toast('This link did not contain a readable score.');
    return false;
  }
  const source = catalog.find(x => x.id === payload.s);
  const title = payload.a.match(/^T:(.*)$/m)?.[1]?.trim() || 'Shared score';
  // A teacher's assignment opens only if it passes validPrompt; otherwise the score still opens, without it.
  const assignment = 'q' in payload ? validPrompt(payload.q) : null;
  openScore({
    ...(source || {}),
    title,
    composer: source?.composer || payload.a.match(/^C:(.*)$/m)?.[1]?.trim() || '',
    kind: 'shared',
    abc: payload.a,
    instrument: instruments[payload.i] ? payload.i : undefined,
    prompt: assignment || (typeof payload.p === 'string' && promptById(payload.p) ? payload.p : undefined)
  });
  // The link was the only copy and show() has replaced it in the address bar, so treat the score as unsaved work.
  dirty = true;
  cleanKey = '';
  $('save-status').textContent = 'Shared copy, not yet saved on this device. Save it to My scores to keep it.';
  // An assignment starts like a writing prompt: the first note or rest is selected, ready for typing.
  const first = assignment && scoreNotes()[0];
  if (first) {
    selectEntry(first);
    $('selection-status').textContent =
      'The first note is selected. Type note letters (A–G) to write from there; 3–7 change the length.';
  }
  toast(
    assignment
      ? 'Opened an assignment. Its goals tick off as you write; save it to My scores to keep your work.'
      : 'q' in payload
        ? 'This link’s assignment could not be read, so only the score opened.'
        : 'Opened a shared score. Save it to My scores to keep a copy.'
  );
  scheduleDraft();
  return true;
}
$('share-link').onclick = () => shareLink().catch(e => toast('Could not make a link: ' + e.message));
$('share-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('share-url').value);
    toast('Link copied.');
  } catch {
    $('share-url').focus();
    $('share-url').select();
  }
};
$('share-close').onclick = () => ($('share-panel').hidden = true);

// Unsaved-work recovery. While the score has unsaved changes, a copy goes to the local draft list two seconds later
// (at once when the tab is hidden), so a discarded tab or a closed window does not lose the work. Each tab keeps one
// entry, marked with its own tab id, so a second open tab never overwrites or clears the first tab's work. Saving,
// undoing back to the opened text, or replacing the score removes this tab's entry; render() runs after each of these,
// so it is the hook. Drafts found at start-up are offered newest first and stay stored until restored or discarded.
const DRAFT_DELAY = 2000,
  DRAFT_MAX_LENGTH = 500 * 1024,
  DRAFT_LIMIT = 3,
  draftTab = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let draftTimer = null,
  draftOwned = false,
  pendingDrafts = [],
  draftCount = 0;
function draftData() {
  return {
    abc: $('abc').value,
    instrument: currentInstrument(),
    title: field('T', current?.title || 'Untitled'),
    prompt: current?.prompt,
    sourceId: shareSourceId(),
    savedId,
    kind: current?.kind,
    tab: draftTab,
    at: Date.now()
  };
}
const sameDraft = (a, b) => a.tab === b.tab && a.at === b.at;
// The stored drafts, newest first, without damaged entries.
function storedDrafts() {
  const list = storage.get(KEYS.draft, []);
  return (Array.isArray(list) ? list : [])
    .filter(d => d && typeof d === 'object' && typeof d.abc === 'string' && d.abc.trim())
    .sort((a, b) => (+b.at || 0) - (+a.at || 0));
}
function storeDrafts(list) {
  if (list.length) return storage.set(KEYS.draft, list);
  storage.remove(KEYS.draft);
  return true;
}
function removeDrafts(match) {
  const list = storedDrafts(),
    rest = list.filter(d => !match(d));
  if (rest.length < list.length) storeDrafts(rest);
}
// This tab's draft goes first. The oldest other drafts make room when the list is over its count or size limit;
// with `keep`, nothing is written instead, so two open tabs never take turns pushing each other out.
function writeDraft(keep = false) {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!dirty) return;
  const data = draftData();
  // Very long scores are skipped rather than crowding saved scores out of storage; a full quota is ignored.
  if (JSON.stringify(data).length > DRAFT_MAX_LENGTH) return;
  const list = [data, ...storedDrafts().filter(d => d.tab !== draftTab)];
  while (list.length > 1 && (list.length > DRAFT_LIMIT || JSON.stringify(list).length > DRAFT_MAX_LENGTH)) {
    if (keep) return;
    list.pop();
  }
  if (storeDrafts(list)) draftOwned = true;
}
function scheduleDraft() {
  if (!dirty) clearDraft();
  else if (!draftTimer) draftTimer = setTimeout(() => writeDraft(), DRAFT_DELAY);
}
function flushDraft() {
  if (draftTimer) writeDraft();
}
function clearDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!draftOwned) return;
  draftOwned = false;
  removeDrafts(d => d.tab === draftTab);
}
// Another tab's banner can restore or discard this tab's draft while this tab is still open. If the work here is
// still unsaved, it goes back in the list.
function keepDraft() {
  if (draftOwned && dirty && !storedDrafts().some(d => d.tab === draftTab)) writeDraft(true);
}
// The drafts to offer at start-up. One that matches the saved score it came from, text and instrument, is dropped;
// a saved score from before instruments were saved never matches, so its draft is kept.
function loadDrafts() {
  const list = storedDrafts();
  pendingDrafts = list.filter(draft => {
    const entry = draft.savedId && saved.find(x => x.id === draft.savedId);
    return !entry || entry.abc !== draft.abc || entry.instrument !== draft.instrument;
  });
  if (pendingDrafts.length < list.length) storeDrafts(pendingDrafts);
  draftCount = pendingDrafts.length;
  return pendingDrafts;
}
function draftTime(at) {
  const when = new Date(at);
  if (!Number.isFinite(when.getTime())) return 'earlier';
  return when.toDateString() === new Date().toDateString()
    ? when.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})
    : when.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}
// Shown at start-up, and again after Discard while more drafts wait. Focus moves to Restore so the choice is announced
// and one key away; the start-up score would otherwise hold focus, with every note a tab stop before the banner. The
// reload's scroll restoration is turned off so the banner at the top stays in view.
function offerDraft() {
  const banner = $('draft-banner'),
    draft = pendingDrafts[0];
  banner.hidden = !draft;
  if (!draft) return;
  const place = draftCount > 1 ? ` (${draftCount - pendingDrafts.length + 1} of ${draftCount})` : '';
  $('draft-text').textContent =
    `Unsaved work from ${draftTime(draft.at)}: ${String(draft.title || 'Untitled')}${place}.`;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  $('draft-restore').focus({preventScroll: true});
}
// Restoring rebuilds the score as a shared link does: the library edition's credits, the saved entry it belongs to,
// and the draft's own text, instrument and prompt, marked unsaved. Other waiting drafts stay stored for the next visit.
function restoreDraft() {
  const draft = pendingDrafts[0];
  if (!draft || !allowReplace()) return;
  pendingDrafts = [];
  $('draft-banner').hidden = true;
  dirty = false;
  const source = catalog.find(x => x.id === draft.sourceId),
    entry = draft.savedId ? saved.find(x => x.id === draft.savedId) : null,
    title = String(draft.title || 'Untitled');
  openScore(
    {
      ...(source || {}),
      ...(entry || {}),
      title,
      composer: entry?.composer ?? source?.composer ?? (draft.abc.match(/^C:(.*)$/m)?.[1]?.trim() || ''),
      kind: draft.kind || source?.kind || 'personal',
      abc: draft.abc,
      instrument: instruments[draft.instrument] ? draft.instrument : undefined,
      prompt: draft.prompt
    },
    entry ? entry.id : null
  );
  dirty = true;
  cleanKey = '';
  updateRights();
  $('save-status').textContent = `Restored unsaved work from ${draftTime(draft.at)}. Save it to keep it.`;
  focusScore();
  // The work is now this tab's own draft; the entry it came from goes once that copy is stored.
  writeDraft();
  if (draftOwned) removeDrafts(d => sameDraft(d, draft));
}
// Discarding removes only the offered draft; the next one, if any, takes its place in the banner.
function discardDraft() {
  const draft = pendingDrafts.shift();
  if (!draft) return;
  removeDrafts(d => sameDraft(d, draft));
  toast('Unsaved work discarded.');
  if (pendingDrafts.length) offerDraft();
  else {
    $('draft-banner').hidden = true;
    document.querySelector('.nav.active')?.focus();
  }
}
