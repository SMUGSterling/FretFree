'use strict';
// Editor: the open score and its state, rendering, selection and drag, undo/redo, bar check, draw mode,
// the note menu, keyboard note entry, fingering diagrams and writing prompts.
let current = null,
  savedId = null,
  dirty = false,
  renderTimer;
let renderedSource = null,
  renderedTune = null,
  noteSources = new Map(),
  measureStarts = new Map(),
  selectedRange = null;
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
function writtenABC() {
  let source = $('abc').value;
  const config = instruments[currentInstrument()];
  if (config.shift)
    try {
      source = transposeABC(source, config.shift);
    } catch {
      source = ABCJS.strTranspose(source, ABCJS.parseOnly(source), config.shift);
    }
  source = source.replace(/^K:(.*)$/m, (_, key) => 'K:' + key.replace(/\s+clef=\S+/g, '') + ' clef=' + config.clef);
  if (fingeringShown() === 'recorder') source = source.replace(/^(X:.*)$/m, '$1\n%%staffsep 190');
  return labelSource(source, noteNamesMode());
}
// Note names under the score: off, letters or movable-do solfège; display only, never written to the ABC source.
const noteNamesMode = () => $('note-names')?.value || 'off';
// Fingering under the score: guitar tab (abcjs) for Guitar, hole diagrams for Recorder; display only.
const FINGERING = {
  Guitar: {kind: 'guitar', label: 'Guitar tab'},
  Recorder: {kind: 'recorder', label: 'Recorder fingering'}
};
const fingeringShown = () => ($('fingering')?.checked !== false && FINGERING[currentInstrument()]?.kind) || null;
function scoreClick(element, tuneNumber, classes, analysis, drag, event) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Select the note again.');
    return;
  }
  const entry = noteSources.get(element.startChar);
  if (!entry) return;
  const area = $('abc'),
    start = entry.element.startChar,
    end = entry.element.endChar;
  if (start == null || end == null) return;
  const anchor = selectedNote()?.entry.measure;
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
  // A plain click only selects, so editing never moves the practice range. Shift+click sets the range from the
  // selected note's measure to the clicked one (from the clicked measure to the end when nothing was selected).
  if (event?.shiftKey && !drag?.step) {
    const from = anchor ?? entry.measure,
      to = anchor == null ? +$('end-measure').max : entry.measure;
    setRange(from, to);
    return;
  }
  $('selection-status').textContent =
    `Measure ${entry.measure} selected · type A–G to add notes after it, ↑↓ to change pitch · Shift+click another note to practice from here to there`;
  // A pointer click sounds the note (Hear notes); a drag sounded it before the render. Calls from code pass no
  // event, so the note menu stays quiet.
  if (event && !drag?.step) auditionAt(start);
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
    const original = ABCJS.parseOnly(renderedSource)[0];
    const display = ABCJS.parseOnly(source)[0];
    noteSources = sourceMap(original, display);
    renderedTune = ABCJS.renderAbc('notation', source, engraveOptions())[0];
    if (scoreFocused) focusScore();
    updateFingering(source);
    indexDisplay(display);
    updateMeasures();
    updateBarCheck(original);
    updatePromptCheck(display);
    if (typeof updateAssignmentBuilder === 'function') updateAssignmentBuilder();
    restoreSelection(display);
    $('warnings').textContent = (renderedTune?.warnings || []).map(x => String(x).replace(/<[^>]+>/g, '')).join(' · ');
    updateCaption();
    updateSourceEdition();
    updateRights();
    refreshTranspose();
  } catch (e) {
    $('warnings').textContent = 'Could not render this score: ' + e.message;
  }
  scheduleDraft();
}
// abcjs options for the main score. Guitar adds a tab staff; recorder leaves room below for the fingering diagrams.
function engraveOptions() {
  const fingering = fingeringShown();
  return {
    responsive: 'resize',
    staffwidth: 740,
    add_classes: true,
    dragging: true,
    selectTypes: ['note', 'bar'],
    selectionColor: '#317761',
    dragColor: '#ba663d',
    clickListener: scoreClick,
    ...(fingering === 'guitar' ? {tablature: [{instrument: 'guitar', label: 'Guitar'}], paddingbottom: 40} : {}),
    ...(fingering === 'recorder' ? {paddingbottom: 120} : {})
  };
}
// Per drawn note: its effective duration and parsed element (by display offset), plus each staff's clef offset.
function indexDisplay(display) {
  const shown = scoreEvents(display),
    lengths = effectiveDurations(shown);
  noteDurations = new Map(shown.map(e => [e.element.startChar, lengths.get(e.element) || 0]));
  shownElements = new Map(shown.map(e => [e.element.startChar, e.element]));
  staffClefs = display.lines.filter(l => l.staff).map(l => l.staff.map(st => st.clef?.verticalPos || 0));
}
// Keep the selected note highlighted across a re-render.
function restoreSelection(display) {
  if (!selectedRange || !renderedTune?.engraver) return;
  const match = [...noteSources.entries()].find(([, e]) => e?.element.startChar === selectedRange[0]);
  if (!match) return;
  const shown = scoreEvents(display).find(e => e.element.startChar === match[0]);
  if (shown) renderedTune.engraver.rangeHighlight(shown.element.startChar, shown.element.endChar);
}
function updateCaption() {
  $('workspace-heading').textContent = field('T', 'Untitled melody');
  const config = instruments[currentInstrument()];
  const pitch =
    config.shift === 2 || config.shift === 9
      ? 'Written pitch shown; ABC source and MIDI are concert pitch.'
      : config.shift === -12
        ? 'Melody lowered one octave for bass range.'
        : 'Concert pitch melody part.';
  $('score-caption').textContent = `${currentInstrument()} · ${config.clef} clef · ${pitch}`;
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
function staffList() {
  return (renderedTune?.engraver?.staffgroups || []).flatMap((g, gi) =>
    g.staffs
      .map((st, si) => (st.isTabStaff ? null : {id: gi + ':' + si, y: st.absoluteY, clef: staffClefs[gi]?.[si] ?? 0}))
      .filter(Boolean)
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
function applyNoteEdit(start, end, text, select = text ? [start, start + text.length] : null, hear = null) {
  flushTyping();
  const area = $('abc');
  area.setRangeText(text, start, end, 'end');
  dirty = true;
  $('save-status').textContent = 'Unsaved changes';
  clearTimeout(renderTimer);
  syncFields();
  selectedRange = select;
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
  // The staff shows written pitch; the source takes the concert note, as many letters away as the key at that point.
  const concert = at =>
    pitchToken(t.written - writtenSteps($('abc').value, at, instruments[currentInstrument()].shift));
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
$('add-bars').onclick = () => addBars(4);
// Note properties menu. Lengths come from the parsed (effective) duration, so chords and broken rhythm read correctly.
const DOTTABLE = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
function closeNoteMenu() {
  $('note-menu').hidden = true;
  menuEntry = null;
}
const transposing = () => {
  const shift = instruments[currentInstrument()].shift;
  return shift % 12 !== 0 ? shift : 0;
};
// Accidentals are what the player sees, so read and edit them in written pitch, then transpose back to the concert source.
function writtenNote(display) {
  const w = writtenABC();
  return {
    text: w.slice(display.startChar, display.endChar).replace(noteNamesMode() === 'off' ? /^$/ : /^"_[^"]*"/, ''),
    key: keyAt(w, display.startChar)
  };
}
function accidentalEdit(entry, display, acc) {
  const old = $('abc').value.slice(entry.element.startChar, entry.element.endChar),
    shift = transposing();
  if (!shift) return editNoteText(old, {accidental: acc});
  const {text, key} = writtenNote(display),
    mini = `X:1\nL:1/8\nK:${key}\n${editNoteText(text, {accidental: acc})}\n`;
  // Back to concert pitch by the letters the written key moved, so a plain note means what the source's key says
  // (a plain C in written Ab major is A# in concert F# major, not the Bb that abcjs's own Gb major would give).
  let lines;
  try {
    lines = transposeABC(mini, -shift, -writtenSteps($('abc').value, entry.element.startChar, shift), 7).split('\n');
  } catch {
    return old;
  }
  const note = lines[lines.findIndex(l => l.startsWith('K:')) + 1];
  return note == null ? old : note;
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
function openNoteMenu(entry, display, x, y) {
  menuEntry = {entry, display};
  const isRest = !entry.element.pitches?.length,
    text = transposing()
      ? writtenNote(display).text
      : $('abc').value.slice(entry.element.startChar, entry.element.endChar);
  const acc = (noteParts(text)?.core.match(/^\[?(\^{1,2}|_{1,2}|=)/) || [])[1] || '',
    len = entry.element.duration || 0;
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
      : `<div class="menu-label">ACCIDENTAL</div><div class="menu-row">${item('acc:^', '♯ Sharp', acc === '^')}${item('acc:_', '♭ Flat', acc === '_')}${item('acc:=', '♮ Natural', acc === '=')}${item('acc:', 'None', !acc)}</div>`) +
    `<div class="menu-label">LENGTH</div>${durations.map(([v, l]) => item('len:' + v, l, Math.abs(base - v) < 1e-9)).join('')}` +
    `<button role="menuitemcheckbox" aria-checked="${dotted}" data-edit="dot">· Dotted</button>` +
    (isRest
      ? ''
      : `<button role="menuitemcheckbox" aria-checked="${/^-/.test(noteParts($('abc').value.slice(entry.element.startChar, entry.element.endChar))?.post || '')}" data-edit="tie">⁀ Tie to next note</button>`) +
    `<div class="menu-row"><button role="menuitem" data-edit="play-from">▶ Play from here</button><button role="menuitem" data-edit="range-from">🔁 Practice from here</button></div>` +
    `<div class="menu-label">INSERT AFTER</div><div class="menu-row"><button role="menuitem" data-edit="rest-after">𝄽 Rest</button><button role="menuitem" data-edit="bar-after">| Bar line</button></div><hr><button role="menuitem" class="danger" data-edit="delete">Delete ${isRest ? 'rest' : 'note'}</button>`;
  const menu = $('note-menu');
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.querySelector('button')?.focus({preventScroll: true});
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
// One edit on one note, shared by the note menu and the keyboard. Actions: acc:<^|_|=|>, len:<whole>, dot, tie,
// delete, rest-after, bar-after, play-from, range-from.
function editNote(entry, display, action) {
  const area = $('abc'),
    v = area.value,
    start = entry.element.startChar,
    end = entry.element.endChar,
    old = v.slice(start, end);
  if (action === 'play-from') {
    playFromNote(display);
    return;
  }
  if (action === 'range-from') {
    const to = +$('end-measure').value;
    setRange(entry.measure, to >= entry.measure ? to : +$('end-measure').max);
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
  const unit = unitLength(),
    len = entry.element.duration || 0,
    dotted = DOTTABLE.some(x => Math.abs(len - x * 1.5) < 1e-9);
  const change = t =>
    action === 'delete'
      ? ''
      : editNoteText(t, {length: (action === 'dot' ? (dotted ? len / 1.5 : len * 1.5) : +action.slice(4)) / unit});
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
    else applyNoteEdit(start, end, change(old));
    return;
  }
  // Spell the broken-rhythm pair out with explicit lengths so the neighbour keeps its duration.
  const [a, c] = pair,
    fixed = n =>
      editNoteText(v.slice(n.element.startChar, n.element.endChar), {
        length: (n.element.duration || 0) / unit,
        unbroken: true
      });
  const first = a === entry ? change(fixed(a)) : fixed(a),
    second = c === entry ? change(fixed(c)) : fixed(c);
  const text = (first + v.slice(a.element.endChar, c.element.startChar) + second).replace(/^\s+/, m =>
    first ? m : ''
  );
  const spaced = second || !first ? text : text.replace(/\s*$/, ' ');
  applyNoteEdit(a.element.startChar, c.element.endChar, spaced, action === 'delete' ? null : undefined);
}
$('note-menu').addEventListener('click', e => {
  const b = e.target.closest('[data-edit]'),
    picked = menuEntry;
  if (!b || !picked) return;
  e.stopPropagation();
  closeNoteMenu();
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Right-click the note again.');
    return;
  }
  editNote(picked.entry, picked.display, b.dataset.edit);
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
    if (!$('note-menu').hidden) closeNoteMenu();
  },
  {passive: true}
);
// Keyboard note entry on the score (MuseScore-style): A–G add a note after the selection in the nearest octave,
// R or 0 a rest, 3–7 set the length (16th…whole), . dots, ↑↓ move by step (Ctrl: octave), ←→ change the selection,
// # - = set sharp/flat/natural, + ties, | adds a bar line, Delete removes the note.
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
function displayOf(entry) {
  for (const [key, e] of noteSources) if (e === entry) return shownElements.get(key);
  return null;
}
function selectedNote() {
  const entry = selectedRange && scoreNotes().find(e => e.element.startChar === selectedRange[0]);
  return entry ? {entry, display: displayOf(entry)} : null;
}
function selectEntry(entry) {
  const display = displayOf(entry);
  if (!display) return;
  scoreClick(display, 0, [], {}, null);
  renderedTune?.engraver?.rangeHighlight?.(display.startChar, display.endChar);
}
// Insert a token at a source position with spacing, then select it (and sound it, with hear).
function insertAt(at, token, select = true, hear = false) {
  const v = $('abc').value,
    before = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '',
    after = v[at] && !/\s/.test(v[at]) ? ' ' : '';
  applyNoteEdit(
    at,
    at,
    before + token + after,
    select ? [at + before.length, at + before.length + token.length] : null,
    hear ? at + before.length : null
  );
}
// Where a new note goes with nothing selected: before the closing bar line, or at the end of the music.
function tuneEndPosition() {
  const all = [...new Set(noteSources.values())]
      .filter(Boolean)
      .sort((a, b) => a.element.startChar - b.element.startChar),
    last = all.at(-1);
  if (!last) return $('abc').value.length;
  return last.element.el_type === 'bar' && /thick|dbl/.test(last.element.type || '')
    ? last.element.startChar
    : last.element.endChar;
}
function insertNote(letter, sel) {
  if (sel && !sel.entry.element.pitches?.length && sel.entry.element.rest?.type !== 'multimeasure') {
    overwriteRest(letter, sel.entry);
    return;
  }
  const at = sel ? sel.entry.element.endChar : tuneEndPosition(),
    length = inputLength ?? beatLength();
  let token = 'z';
  if (letter !== 'z') {
    // Letters name what the student sees, so pick the octave in written pitch, nearest the previous note.
    token = letterToken(letter, at);
  }
  insertAt(at, token + lengthText(length / unitLengthAt(at)), true, letter !== 'z');
}
// Written-pitch note token for a letter, in the octave nearest the last note before a source position.
function letterToken(letter, at) {
  if (letter === 'z') return 'z';
  const steps = writtenSteps($('abc').value, at, instruments[currentInstrument()].shift),
    prev = scoreNotes()
      .filter(n => n.element.startChar < at && n.element.pitches?.length)
      .pop();
  const ref = prev ? prev.element.pitches[0].pitch + steps : 6 + (staffClefs[0]?.[0] || 0),
    letterIndex = 'CDEFGAB'.indexOf(letter);
  return pitchToken(letterIndex + 7 * Math.round((ref - letterIndex) / 7) - steps);
}
// Typing on a rest writes over it (as in MuseScore): the note takes its length from the rest and the rest keeps
// what is left, which stays selected so the next letter continues. A filled rest passes the selection on.
function overwriteRest(letter, rest) {
  fillRest(rest, letterToken(letter, rest.element.startChar));
}
// Put a note (its pitch token, without a length) at the start of a rest; the rest keeps whatever time is left.
function fillRest(rest, core, wanted = inputLength ?? beatLength()) {
  const v = $('abc').value,
    start = rest.element.startChar,
    end = rest.element.endChar,
    old = v.slice(start, end),
    unit = unitLengthAt(start);
  const restLength = rest.element.duration || 0,
    length = Math.min(wanted, restLength || Infinity),
    left = restLength - length;
  const token = core + lengthText(length / unit),
    trail = old.match(/\s*$/)[0],
    lead = old.match(/^\s*/)[0] || (start > 0 && !/\s/.test(v[start - 1]) ? ' ' : '');
  if (left > 1e-6) {
    const remainder = 'z' + lengthText(left / unit),
      text = lead + token + ' ' + remainder + trail,
      at = start + lead.length + token.length + 1;
    applyNoteEdit(start, end, text, [at, at + remainder.length], start + lead.length);
    return;
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
    start + lead.length
  );
}
function scoreKey(e) {
  if (e.metaKey || e.altKey || (e.ctrlKey && !/^Arrow(Up|Down)$/.test(e.key)) || !$('note-menu').hidden) return false;
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const key = e.key,
    sel = selectedNote(),
    notes = scoreNotes();
  if (key === ' ') {
    if (playing) stop();
    else if (sel) playFromNote(sel.display);
    else play();
    return true;
  }
  if (/^[a-g]$/i.test(key)) {
    insertNote(key.toUpperCase(), sel);
    return true;
  }
  if (key === 'r' || key === 'R' || key === '0') {
    insertNote('z', sel);
    return true;
  }
  if (LENGTH_KEYS[key]) {
    inputLength = LENGTH_KEYS[key];
    if (sel && sel.entry.element.pitches?.length) editNote(sel.entry, sel.display, 'len:' + inputLength);
    else
      $('selection-status').textContent =
        'New notes will be ' + (NOTE_VALUES[inputLength] || 'that length').replace(/^an? /, '') + 's.';
    return true;
  }
  if (key === '|') {
    if (sel) editNote(sel.entry, sel.display, 'bar-after');
    else insertAt(tuneEndPosition(), '|', false);
    return true;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (!notes.length) return true;
    const i = sel ? notes.indexOf(sel.entry) : key === 'ArrowLeft' ? notes.length : -1,
      next = notes[Math.max(0, Math.min(notes.length - 1, i + (key === 'ArrowLeft' ? -1 : 1)))];
    selectEntry(next);
    auditionAt(next.element.startChar);
    return true;
  }
  if (key === 'Escape' && sel) {
    selectedRange = null;
    renderedTune?.engraver?.rangeHighlight?.(-1, -1);
    $('selection-status').textContent = 'Nothing selected. Letters add notes at the end.';
    return true;
  }
  if (!sel) return false;
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
  // A teacher's assignment may have instructions and no goals; then there is no checklist.
  const goals = checkPrompt(prompt, melodyBars(shown)),
    done = goals.length > 0 && goals.every(g => g.ok);
  box.hidden = false;
  box.classList.toggle('done', done);
  box.innerHTML = `<div class="prompt-check-head"><strong>${prompt.level === 'Custom' ? 'Assignment' : 'Writing prompt'} · ${esc(prompt.title)}</strong>${goals.length ? `<span class="small">${goals.filter(g => g.ok).length} of ${goals.length} goals</span>` : ''}</div>${prompt.text ? `<p class="prompt-text">${esc(prompt.text)}</p>` : ''}${goals.length ? `<ul>${goals.map(g => `<li class="${g.ok ? 'met' : ''}"><span aria-hidden="true">${g.ok ? '✓' : '○'}</span> ${esc(g.label)}<span class="sr-only">${g.ok ? ' (done)' : ' (not yet)'}</span></li>`).join('')}</ul>` : ''}${done ? '<p class="prompt-done">All goals met. Play it back, then save it or export it to hand in.</p>' : ''}`;
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
  const sel = selectedNote();
  return sel ? {from: sel.entry.measure, to: sel.entry.measure} : null;
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
