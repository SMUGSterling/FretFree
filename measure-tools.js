'use strict';
// Measure tools: the Measure panel of the notation palette. It inserts and deletes bars, sets the bar line after a
// measure, adds repeats, 1st and 2nd endings, segno, coda, Fine, D.C. and D.S., and rehearsal marks, and changes the
// time signature, key or clef from a measure on. Each change is one edit of the ABC source, so one undo step; the
// pure helpers are in score-tools.js. The palette (palette.js) sends its button presses here and asks for their state.
const MEASURE_DONE = {
  '|': 'Single bar line',
  '||': 'Double bar line',
  '|]': 'Final bar line'
};
const FORM_WORDS = {
  segno: 'Segno',
  coda: 'Coda',
  fine: 'Fine',
  'D.C.': 'D.C.',
  'D.S.': 'D.S.',
  'D.C.alfine': 'D.C. al Fine',
  'D.S.alcoda': 'D.S. al Coda'
};
const NOT_PLAYED = ' Playback does not follow segno, coda, Fine, D.C. or D.S. yet.';
const ordinalWord = n => n + ({1: 'st', 2: 'nd', 3: 'rd'}[n] || 'th');
// The source parsed once per text: the palette asks for the state after every selection change.
let measureParse = {source: null, tune: null};
function sourceTune(source = $('abc').value) {
  if (measureParse.source !== source) measureParse = {source, tune: ABCJS.parseOnly(source)[0]};
  return measureParse.tune;
}
let shownParse = {source: null, tune: null};
function shownTune() {
  const source = renderedSource === $('abc').value && renderedWritten;
  if (!source) return null;
  if (shownParse.source !== source) shownParse = {source, tune: ABCJS.parseOnly(source)[0]};
  return shownParse.tune;
}
// The measure the tools act on: the selected note's (the first of a range), or, with a bar line selected, the measure
// it closes. A bar line at the start of a line closes none, so it opens the measure after it (side 'open').
function measureTarget() {
  if (!selectedRange || renderedSource !== $('abc').value) return null;
  const sel = selectedNote();
  if (sel) {
    const m = measureBounds(sourceTune(), voiceOf(sel.entry), sel.entry.measure);
    return (
      m && {voice: voiceOf(sel.entry), m, index: m.notes.findIndex(n => n.startChar === sel.entry.element.startChar)}
    );
  }
  const bar = [...new Set(noteSources.values())].find(
    e => e?.element.el_type === 'bar' && e.element.startChar === selectedRange[0]
  );
  if (!bar) return null;
  const voice = voiceOf(bar),
    m = measureBounds(sourceTune(), voice, bar.measure);
  if (!m) return null;
  return {voice, m, bar: true, side: m.bar?.startChar === bar.element.startChar ? 'close' : 'open'};
}
const glyphOf = (source, bar) => (bar ? barParts(source.slice(bar.startChar, bar.endChar)) : {glyph: '', ending: null});
// What the panel shows for the target: the bar line after it (or the selected bar line), its repeats and ending, its
// form marks, its rehearsal mark, and the time signature, key and clef in force.
function measureToolState() {
  if ($('palette-measure')?.hidden !== false) return null;
  const t = measureTarget();
  if (!t) return null;
  const source = $('abc').value,
    tune = sourceTune(),
    {m} = t,
    open = openBar(source, m),
    styleBar = t.bar ? (t.side === 'open' ? open : m.bar) : m.bar,
    startBar = t.bar ? styleBar : open,
    endBar = t.bar ? styleBar : m.bar,
    first = scoreVoices(tune, source)[0],
    top = first === t.voice ? m : measureBounds(tune, first, m.measure),
    shown = shownTune() && measureBounds(shownTune(), t.voice, m.measure);
  return {
    ...t,
    count: voiceMeasures(tune, t.voice).length,
    style: glyphOf(source, styleBar).glyph,
    start: startsRepeat(glyphOf(source, startBar).glyph),
    end: endsRepeat(glyphOf(source, endBar).glyph),
    ending: glyphOf(source, startBar).ending,
    marks: [
      ...formMarks(source.slice(m.first.startChar, m.first.endChar)).filter(n => !JUMP_MARKS.includes(n)),
      ...formMarks(source.slice(m.last.startChar, m.last.endChar)).filter(n => JUMP_MARKS.includes(n))
    ],
    rehearsal: !!top && fieldsAt(source, measureOpen(source, top)).some(f => f.name === 'P'),
    meter: voiceMeterAt(source, tune, t.voice, m.first.startChar),
    key: canonicalKey(voiceKeyAt(source, tune, t.voice, m.first.startChar)),
    clef: shown?.clef || m.clef
  };
}
function measurePressed(action, state) {
  if (!state) return action.startsWith('bar:') ? null : false;
  const [kind, value] = action.split(':');
  if (kind === 'barline') return state.style === value;
  if (kind === 'repeat') return value === 'start' ? state.start : state.end;
  if (kind === 'ending') return state.ending === value;
  if (kind === 'form') return state.marks.includes(value);
  if (kind === 'rehearsal') return state.rehearsal;
  return null;
}
function measureBlocked(action, state) {
  if (!state) return 'Select a note or bar line on the score first.';
  if (action === 'bar:delete' && state.count < 2) return 'A staff needs at least one bar.';
  return '';
}
// Commit a new source as one edit (the part that changed), keep the same note selected in the measure that focus
// names ({voice, measure, index}, or bar with side for a bar line), and say what happened.
function commitMeasure(next, focus, message) {
  const v = $('abc').value;
  if (next === v) {
    $('selection-status').textContent = 'No change.';
    return;
  }
  let a = 0,
    b = 0;
  while (a < v.length && a < next.length && v[a] === next[a]) a++;
  while (b < v.length - a && b < next.length - a && v[v.length - 1 - b] === next[next.length - 1 - b]) b++;
  let select = null;
  try {
    const m = focus && measureBounds(ABCJS.parseOnly(next)[0], focus.voice, focus.measure),
      el =
        m &&
        (focus.bar
          ? focus.side === 'open'
            ? openBar(next, m)
            : m.bar
          : m.notes[Math.min(focus.index || 0, m.notes.length - 1)]);
    if (el) select = [el.startChar, el.endChar];
  } catch {}
  applyNoteEdit(a, v.length - b, next.slice(a, next.length - b), select);
  $('selection-status').textContent = message;
}
// A palette press on the Measure panel.
function measureCommand(action) {
  const state = measureToolState();
  if (!state) return;
  const source = $('abc').value,
    tune = sourceTune(),
    {m, voice} = state,
    n = m.measure,
    many = scoreVoices(tune, source).length > 1 ? ' on every staff' : '',
    focus = {voice, measure: n, index: state.index, bar: state.bar, side: state.side},
    [kind, value] = action.split(':');
  // With a bar line selected, its buttons act on that bar line; otherwise a start repeat and an ending go on the bar line
  // before the measure, and the other bar lines on the one after it.
  const side = which => (state.bar ? state.side : which);
  try {
    if (action === 'bar:before' || action === 'bar:after') {
      const after = action === 'bar:after';
      commitMeasure(
        insertMeasure(source, tune, n, after),
        {voice, measure: after ? n + 1 : n, index: 0},
        `Added a bar ${after ? 'after' : 'before'} measure ${n}${many}. Type a letter to write over its rest.`
      );
    } else if (action === 'bar:delete') {
      const last = n >= voiceMeasures(tune, voice).length;
      commitMeasure(
        deleteMeasure(source, tune, n),
        {voice, measure: last ? n - 1 : n, index: last ? Infinity : 0},
        `Deleted measure ${n}${many}.`
      );
    } else if (kind === 'barline') {
      commitMeasure(
        editBars(source, tune, n, side('close'), old => ({glyph: value, ending: old.ending})),
        focus,
        `${MEASURE_DONE[value]} ${state.bar ? 'here' : 'after measure ' + n}.`
      );
    } else if (kind === 'repeat') {
      const on = !(value === 'start' ? state.start : state.end);
      commitMeasure(
        editBars(source, tune, n, side(value === 'start' ? 'open' : 'close'), old => ({
          glyph: repeatGlyph(old.glyph, value, on),
          ending: old.ending
        })),
        focus,
        on
          ? value === 'start'
            ? `Start repeat ${state.bar ? 'here' : 'at measure ' + n}.`
            : `End repeat ${state.bar ? 'here' : 'after measure ' + n}.`
          : `${value === 'start' ? 'Start' : 'End'} repeat removed.`
      );
    } else if (kind === 'ending') {
      const on = state.ending !== value;
      commitMeasure(
        editBars(source, tune, n, side('open'), old => ({glyph: old.glyph, ending: on ? value : null})),
        focus,
        on
          ? `${ordinalWord(value)} ending from ${state.bar ? 'here' : 'measure ' + n}. It runs to the next repeat, double or final bar line.`
          : `${ordinalWord(value)} ending removed.`
      );
    } else if (kind === 'form') {
      const note = JUMP_MARKS.includes(value) ? m.last : m.first,
        had = state.marks.includes(value),
        text = toggleFormMark(source.slice(note.startChar, note.endChar), value);
      commitMeasure(
        spliceAll(source, [{start: note.startChar, end: note.endChar, text}]),
        focus,
        had
          ? `${FORM_WORDS[value]} removed.`
          : `${FORM_WORDS[value]} ${JUMP_MARKS.includes(value) ? 'at the end of' : 'at the start of'} measure ${n}.` +
              NOT_PLAYED
      );
    } else if (kind === 'rehearsal') {
      const next = toggleRehearsal(source, tune, n),
        top = measureBounds(ABCJS.parseOnly(next)[0], scoreVoices(tune, source)[0], n),
        mark = top && fieldsAt(next, measureOpen(next, top)).find(f => f.name === 'P');
      commitMeasure(
        next,
        focus,
        state.rehearsal ? 'Rehearsal mark removed.' : `Rehearsal mark ${mark?.value || ''} at measure ${n}.`
      );
    }
  } catch (e) {
    $('selection-status').textContent = e.message;
  }
}
// Time signature, key and clef from the target measure on, from the panel's menus. A key change asks whether the notes
// move with it, as the Key menu in Score settings does, unless there are no notes to move.
let measureKeyPending = null;
function hideMeasureKeyChoice() {
  measureKeyPending = null;
  $('measure-key-choice').hidden = true;
}
function measureChange(what) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const t = measureTarget(),
    value = $('measure-' + what).value;
  if (!t) {
    $('selection-status').textContent = 'Select a note or bar line on the score first.';
    updatePalette();
    return;
  }
  const source = $('abc').value,
    tune = sourceTune(),
    n = t.m.measure,
    focus = {voice: t.voice, measure: n, index: t.index, bar: t.bar, side: t.side};
  hideMeasureKeyChoice();
  try {
    if (what === 'meter')
      commitMeasure(
        meterChange(source, tune, n, value),
        focus,
        `Time signature ${value === 'none' ? 'none (free time)' : value} from measure ${n}.`
      );
    else if (what === 'clef')
      commitMeasure(
        clefChange(source, tune, t.voice, n, value),
        focus,
        `${$('measure-clef').selectedOptions[0].text} clef from measure ${n}.`
      );
    else {
      const notes = scoreEvents(tune).some(e => e.element.pitches?.length && e.measure >= n);
      if (!notes) changeMeasureKey({...focus, key: value}, false);
      else measureKeyPending = {...focus, key: value};
    }
    if (measureKeyPending) {
      $('measure-key-choice-text').textContent = `Change the key to ${keyLabel(value)} from measure ${n}:`;
      $('measure-key-transpose').disabled = !keyInterval(voiceKeyAt(source, tune, t.voice, t.m.first.startChar), value);
      $('measure-key-choice').hidden = false;
    }
  } catch (e) {
    $('selection-status').textContent = e.message;
  }
  // An edit hands the keyboard to the score; the menu keeps it, as the Key menu in Score settings does.
  $('measure-' + what).focus({preventScroll: true});
}
function changeMeasureKey(pending, transpose) {
  hideMeasureKeyChoice();
  const source = $('abc').value,
    tune = sourceTune(),
    m = measureBounds(tune, pending.voice, pending.measure);
  if (!m) return;
  const from = voiceKeyAt(source, tune, pending.voice, m.first.startChar),
    move = transpose ? keyInterval(from, pending.key) : null,
    words = !move
      ? 'The notes stay where they are.'
      : move.semitones
        ? `The notes moved ${intervalWords(move.semitones, move.letters)}.`
        : 'The notes keep their pitches.';
  try {
    commitMeasure(
      keyChange(source, tune, pending.measure, pending.key, transpose),
      pending,
      `Key: ${keyLabel(pending.key)} from measure ${pending.measure}. ${words}` +
        (transposing() ? ' Keys are concert pitch.' : '')
    );
  } catch (e) {
    $('selection-status').textContent = e.message;
  }
}
// Keep the panel's menus on the target's time signature, key and clef; they are off with nothing selected.
function updateMeasureTools(state) {
  const panel = $('palette-measure');
  if (!panel || panel.hidden) return;
  for (const what of ['meter', 'key', 'clef']) $('measure-' + what).disabled = !state;
  // A key change waiting for Transpose or Keep is about the measure it was asked for.
  if (
    !state ||
    (measureKeyPending && (measureKeyPending.voice !== state.voice || measureKeyPending.measure !== state.m.measure))
  )
    hideMeasureKeyChoice();
  if (!state) return;
  if (!measureKeyPending) {
    assignSelect('measure-meter', state.meter);
    assignSelect('measure-key', state.key, keyLabel(state.key));
  }
  assignSelect('measure-clef', state.clef, state.clef);
}
for (const o of $('meter').options) $('measure-meter').add(new Option(o.text, o.value));
fillKeySelect($('measure-key'));
for (const what of ['meter', 'key', 'clef']) $('measure-' + what).addEventListener('change', () => measureChange(what));
for (const [id, transpose] of [
  ['measure-key-transpose', true],
  ['measure-key-keep', false]
])
  $(id).onclick = () => {
    if (measureKeyPending) changeMeasureKey(measureKeyPending, transpose);
    $('measure-key').focus();
  };
$('measure-key-cancel').onclick = () => {
  hideMeasureKeyChoice();
  updatePalette();
  $('measure-key').focus();
};
$('measure-key-choice').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  hideMeasureKeyChoice();
  updatePalette();
  $('measure-key').focus();
});
