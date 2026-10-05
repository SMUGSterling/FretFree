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
function assignSelect(id, value) {
  const select = $(id);
  if (![...select.options].some(o => o.value === value)) select.add(new Option(value, value));
  select.value = value;
}
function syncFields() {
  $('title').value = field('T', 'Untitled');
  $('composer').value = field('C');
  assignSelect('meter', field('M', '4/4'));
  assignSelect('key', field('K', 'C').split(/\s/)[0]);
  const m = field('Q', '100').match(/(\d+)\s*$/);
  $('bpm').value = m ? Math.max(40, Math.min(200, +m[1])) : 100;
  $('bpm-value').textContent = $('bpm').value;
}
function setHeader(name, value) {
  const lines = $('abc').value.split('\n'),
    i = lines.findIndex(x => x.startsWith(name + ':'));
  const text = name + ':' + String(value).replace(/[\r\n]/g, ' ');
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
  if (config.shift) source = ABCJS.strTranspose(source, ABCJS.parseOnly(source), config.shift);
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
    render();
  }
  selectedRange = [start, nextEnd];
  area.setSelectionRange(start, nextEnd);
  focusScore();
  // Shift+click sets the end of the practice range; a plain click sets its start.
  if (event?.shiftKey && !drag?.step) {
    setRange(+$('start-measure').value, entry.measure);
    return;
  }
  $('start-measure').value = entry.measure;
  if (+$('end-measure').value < entry.measure) $('end-measure').value = $('end-measure').max;
  shadeRange();
  $('selection-status').textContent =
    `Measure ${entry.measure} selected · type A–G to add notes after it, ↑↓ to change pitch · Shift+click another note to set the loop end`;
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
    restoreSelection(display);
    $('warnings').textContent = (renderedTune?.warnings || []).map(x => String(x).replace(/<[^>]+>/g, '')).join(' · ');
    updateCaption();
    updateSourceEdition();
    updateRights();
  } catch (e) {
    $('warnings').textContent = 'Could not render this score: ' + e.message;
  }
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
      `<strong>${esc(licenseLabel(current))} · ${esc(scoreCollection(current))}</strong>${esc(r)}<br>${current.attribution ? `Credit: ${esc(current.attribution)}<br>` : ''}${current.licenseURL ? `<a href="${esc(current.licenseURL)}" target="_blank" rel="noopener">License terms ↗</a><br>` : ''}<a href="${esc(current.source)}" target="_blank" rel="noopener">${esc(current.sourceLabel)} ↗</a><br><span class="small">${dirty ? 'Your edits stay private. Export or save a copy to preserve them.' : 'Use, print, practice, and adapt this teaching version.'}</span>`;
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
function applyNoteEdit(start, end, text, select = text ? [start, start + text.length] : null) {
  flushTyping();
  const area = $('abc');
  area.setRangeText(text, start, end, 'end');
  dirty = true;
  $('save-status').textContent = 'Unsaved changes';
  clearTimeout(renderTimer);
  syncFields();
  selectedRange = select;
  render();
  if (selectedRange) area.setSelectionRange(...selectedRange);
  focusScore();
}
function drawNote(t) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
    toast('Score updated. Click again to add the note.');
    return;
  }
  const config = instruments[currentInstrument()];
  const token = pitchToken(t.written - Math.round((config.shift * 7) / 12)) + lengthText(beatLength() / unitLength());
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
    fillRest(nearest.entry, pitchToken(t.written - Math.round((config.shift * 7) / 12)), beatLength());
    $('selection-status').textContent =
      `Added ${pitchName(t.written)} on the rest · right-click it to change accidental or length`;
    return;
  }
  const next = items.find(i => i.x > t.x),
    last = items.at(-1),
    value = $('abc').value;
  let at, text;
  const tuneEnd = Math.max(...[...noteSources.values()].filter(Boolean).map(e => e.element.startChar));
  // Past the closing barline: add the note inside the tune, before that barline.
  if (!next && last?.entry.element.el_type === 'bar' && last.entry.element.startChar === tuneEnd) {
    at = last.entry.element.startChar;
    text = token + ' ';
  } else if (next) {
    at = next.entry.element.startChar;
    text = token + ' ';
  } else if (last) {
    at = last.entry.element.endChar;
    text = ' ' + token;
  } else {
    at = value.length;
    text = (value.endsWith('\n') ? '' : '\n') + token;
  }
  if (at > 0 && !/\s/.test(value[at - 1]) && !text.startsWith(' ') && !text.startsWith('\n')) text = ' ' + text;
  const start = at + text.indexOf(token);
  applyNoteEdit(at, at, text, [start, start + token.length]);
  $('selection-status').textContent = `Added ${pitchName(t.written)} · right-click it to change accidental or length`;
}
function setDrawMode(on) {
  drawMode = on;
  $('draw-mode').setAttribute('aria-pressed', on);
  $('notation').classList.toggle('drawing', on);
  showGhost(null);
  $('selection-status').textContent = on
    ? 'Draw mode: click the staff to add a note. Right-click a note to change it.'
    : 'Click a note to select its ABC text and starting measure. Drag up/down to change pitch; right-click for accidentals and length.';
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
    key: (w.match(/^K:(.*)$/m) || [, 'C'])[1].replace(/\s+clef=\S+/g, '').trim()
  };
}
function accidentalEdit(entry, display, acc) {
  const old = $('abc').value.slice(entry.element.startChar, entry.element.endChar),
    shift = transposing();
  if (!shift) return editNoteText(old, {accidental: acc});
  const {text, key} = writtenNote(display),
    mini = `X:1\nL:1/8\nK:${key}\n${editNoteText(text, {accidental: acc})}\n`;
  const lines = ABCJS.strTranspose(mini, ABCJS.parseOnly(mini), -shift).split('\n'),
    note = lines[lines.findIndex(l => l.startsWith('K:')) + 1];
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
    `<button role="menuitem" data-edit="play-from">▶ Play from here</button>` +
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
// delete, rest-after, bar-after.
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
  if (action.startsWith('acc:')) {
    applyNoteEdit(start, end, accidentalEdit(entry, display, action.slice(4)));
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
// Insert a token at a source position with spacing, then select it.
function insertAt(at, token, select = true) {
  const v = $('abc').value,
    before = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '',
    after = v[at] && !/\s/.test(v[at]) ? ' ' : '';
  applyNoteEdit(
    at,
    at,
    before + token + after,
    select ? [at + before.length, at + before.length + token.length] : null
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
  insertAt(at, token + lengthText(length / unitLengthAt(at)));
}
// Written-pitch note token for a letter, in the octave nearest the last note before a source position.
function letterToken(letter, at) {
  if (letter === 'z') return 'z';
  const steps = Math.round((instruments[currentInstrument()].shift * 7) / 12),
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
    applyNoteEdit(start, end, text, [at, at + remainder.length]);
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
      : [start + lead.length, start + lead.length + token.length]
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
    applyNoteEdit(start, end, moveNoteText(v.slice(start, end), (key === 'ArrowUp' ? 1 : -1) * (e.ctrlKey ? 7 : 1)));
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
    prompt = current?.prompt && promptById(current.prompt);
  if (!box) return;
  if (!prompt) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const goals = checkPrompt(prompt, melodyBars(shown)),
    done = goals.every(g => g.ok);
  box.hidden = false;
  box.classList.toggle('done', done);
  box.innerHTML = `<div class="prompt-check-head"><strong>Writing prompt · ${esc(prompt.title)}</strong><span class="small">${goals.filter(g => g.ok).length} of ${goals.length} goals</span></div><p>${esc(prompt.text)}</p><ul>${goals.map(g => `<li class="${g.ok ? 'met' : ''}"><span aria-hidden="true">${g.ok ? '✓' : '○'}</span> ${esc(g.label)}<span class="sr-only">${g.ok ? ' (done)' : ' (not yet)'}</span></li>`).join('')}</ul>${done ? '<p class="prompt-done">All goals met. Play it back, then save it or export it to hand in.</p>' : ''}`;
}
$('open-prompts').onclick = () => togglePrompts($('prompt-picker').hidden);
$('close-prompts').onclick = () => togglePrompts(false);
$('prompt-cards').addEventListener('click', e => {
  const b = e.target.closest('[data-prompt]');
  if (b) startPrompt(promptById(b.dataset.prompt));
});
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
// own undo, which doesn't know about edits made on the score.
$('undo').onclick = () => stepHistory(-1);
$('redo').onclick = () => stepHistory(1);
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || $('studio').hidden) return;
  const key = e.key.toLowerCase(),
    field = e.target.closest?.('input,select,textarea');
  if (field && field.id !== 'abc') return;
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
  if (current?.prompt) payload.p = current.prompt;
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
  openScore({
    ...(source || {}),
    title,
    composer: source?.composer || payload.a.match(/^C:(.*)$/m)?.[1]?.trim() || '',
    kind: 'shared',
    abc: payload.a,
    instrument: instruments[payload.i] ? payload.i : undefined,
    prompt: payload.p
  });
  // The link was the only copy and show() has replaced it in the address bar, so treat the score as unsaved work.
  dirty = true;
  cleanKey = '';
  $('save-status').textContent = 'Shared copy, not yet saved on this device. Save it to My scores to keep it.';
  toast('Opened a shared score. Save it to My scores to keep a copy.');
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
