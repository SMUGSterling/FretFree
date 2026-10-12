'use strict';
// Notation palette: a toolbar above the score. Its strip has the selected note's length, dot, tie, rest and accidental;
// Notes (spelling, tuplets, beam, grace notes, chord symbol, lyrics, a feedback comment and Delete), Marks
// (articulations, ornaments, dynamics and lines) and Measure open popovers (menus.js) whose buttons stay in #palette.
// Buttons light up (aria-pressed) to show the selection's state and send the same action as the note menu or the
// matching key to editNote, so each press is one undo step. The Measure popover (measure-tools.js) adds bar, bar line,
// repeat, form and key, time and clef tools. Later notation tools add their own groups here.
const PALETTE_DONE = {
  'to-rest': 'Changed to a rest.',
  'acc:^': 'Sharp.',
  'acc:_': 'Flat.',
  'acc:=': 'Natural.',
  'acc:': 'Accidental removed.',
  'beam:join': 'Beamed to the next note.',
  'beam:break': 'Beam broken after this note.',
  delete: 'Deleted.'
};
// What the palette shows: the selected note's length (without its dot), dot, tie, accidental, whether it is beamed
// to the next note, and its marks, or, with nothing selected, the length new notes will get. A range selection shows
// its first note and the marks its notes share, and picked lists its notes.
function paletteState() {
  const sel = selectedNote(),
    picked = selectedNotes();
  // The Measure panel's state (measure-tools.js) comes along: a selected bar line has no note but has a measure.
  const measure = typeof measureToolState === 'function' ? measureToolState() : null;
  if (!sel) return {sel: null, length: inputLength ?? beatLength(), measure};
  const element = sel.entry.element,
    isRest = !element.pitches?.length,
    multiRest = element.rest?.type === 'multimeasure',
    source = $('abc').value.slice(element.startChar, element.endChar),
    len = element.duration || 0,
    dotted = !multiRest && DOTTABLE.some(v => Math.abs(len - v * 1.5) < 1e-9);
  // Accidentals are shown as the player reads them, in written pitch, like the note menu. The written score is the
  // one just engraved, so refreshing the palette after a render does not transpose the whole score again.
  const written = (renderedSource === $('abc').value && renderedWritten) || undefined,
    text = !isRest && transposing() && sel.display ? writtenNote(sel.display, written).text : source;
  // A multi-measure rest (Z) lasts whole bars, so it shows no note length and cannot be dotted.
  return {
    sel,
    picked: picked.length > 1 ? picked : null,
    isRest,
    multiRest,
    length: multiRest ? null : dotted ? len / 1.5 : len,
    dotted,
    tied: !isRest && /^-/.test(noteParts(source)?.post || ''),
    accidental: isRest ? null : (noteParts(text)?.core.match(/^\[?(\^{1,2}|_{1,2}|=)/) || [])[1] || '',
    beam: isRest ? null : beamGap(sel.entry),
    marks: picked.length > 1 ? rangeMarks(picked) : noteMarks(source),
    chord: shownChord(sel),
    lyric: shownLyric(sel),
    tuplet: tupletGroup(sel.entry)?.p ?? null,
    grace: graceOf(source),
    lines: Object.fromEntries(Object.keys(LINE_WORDS).map(kind => [kind, lineState(kind, picked)])),
    measure
  };
}
// The Measure panel's actions, which measure-tools.js carries out.
const MEASURE_ACTION = /^(bar|barline|repeat|ending|form|rehearsal):/;
// Why a button does nothing for the current selection, or '' when it applies.
function paletteBlocked(action, state) {
  if (action.startsWith('len:')) return '';
  if (MEASURE_ACTION.test(action)) return measureBlocked(action, state.measure);
  if (!state.sel) return 'Select a note on the score first.';
  // Lyrics open on the selected note, the first note of a range, or the note after a selected rest.
  if (action === 'lyric') return lyricWhy(state.sel);
  // Chord opens its box on the selected note, or on the first note of a range selection; so does Comment.
  if (action === 'chord' || action === 'comment') return '';
  // Lines go over a range selection, or from one note to the next.
  if (action.startsWith('line:')) return state.lines[action.slice(5)]?.why ?? '';
  if (/^(deco|dyn):/.test(action))
    return state.picked
      ? markTargets(action, state.picked).why
      : markBlocked(action, state.sel.entry.element) || (state.marks ? '' : 'This cannot take marks.');
  if (state.picked) return RANGE_PALETTE[action] ? '' : 'Select a single note for this.';
  // The lit count stays pressable; when the tuplet cannot come off, the press says why.
  if (action.startsWith('tuplet:'))
    return state.tuplet === +action.slice(7) ? '' : tupletPlan(+action.slice(7), state.sel).why || '';
  if (action.startsWith('grace')) return gracePlan(action, state.sel).why || '';
  if (state.multiRest && action === 'dot') return 'A multi-measure rest cannot be dotted.';
  // Under Keep bars full, Delete leaves a rest as it is (Shift+Delete or Remove in the note menu takes it out).
  if (state.isRest && action === 'delete' && !state.tuplet && keepBars())
    return 'A rest keeps the bar full. Shift+Delete, or Remove in the note menu, takes it out.';
  if (state.isRest && !['dot', 'delete'].includes(action))
    return action === 'to-rest' ? 'This is already a rest.' : 'Rests have no accidental, tie or beam.';
  if (action.startsWith('beam:')) {
    const next = state.beam?.next.element;
    if (!next) return 'There is no next note in this bar to beam to.';
    if (!next.pitches?.length) return 'A beam cannot end on a rest.';
    // Only notes shorter than a quarter have flags, so only they can share a beam.
    if (!(state.sel.entry.element.duration < 0.25 && next.duration < 0.25))
      return 'Only eighth notes and shorter can be beamed.';
    if (action === 'beam:break' && !state.beam.joined) return 'This note is not beamed to the next one.';
  }
  return '';
}
// The popover triggers in the toolbar, and what a closed popover's trigger says the selected note has in it.
const PALETTE_TRIGGERS = ['notes', 'marks', 'measure'];
const HAS_WORDS = {'beam:join': 'a beam', grace: 'a grace note', 'grace:slash': '', 'acc:': ''};
// The words for the lit buttons in a closed Notes or Marks popover, as "is in a triplet" and "has a trill and mf".
function popoverWords(pop, state) {
  if (!pop) return [];
  const has = [],
    lit = [...pop.querySelectorAll('[data-palette][aria-pressed="true"], [data-palette].in-use')];
  let inTuplet = '';
  for (const b of lit) {
    const action = b.dataset.palette;
    if (action.startsWith('tuplet:')) inTuplet = `is in a ${tupletWord(+action.slice(7)).toLowerCase()}`;
    else if (action === 'chord') has.push(`a chord symbol ${state.chord}`);
    else if (action === 'lyric') has.push(`lyrics ${state.lyric}`);
    else if (action.startsWith('deco:')) has.push(MARK_WORDS[action.slice(5)]?.toLowerCase() || action.slice(5));
    else if (action.startsWith('dyn:')) has.push(action.slice(4));
    else if (action in HAS_WORDS) HAS_WORDS[action] && has.push(HAS_WORDS[action]);
    else has.push((b.getAttribute('aria-label') || b.textContent).trim().split(/[,(]/)[0].trim().toLowerCase());
  }
  return [inTuplet, has.length ? `has ${listWords(has)}` : ''].filter(Boolean);
}
// A closed popover's trigger is marked when the selected note has something in it, and its name says what. On a
// phone Notes opens the Marks and Measure tools too, so it names the marks as well.
function summarizeTrigger(key, state) {
  const trigger = $('menu-' + key),
    pop = $('palette-' + key);
  if (!trigger || !pop) return;
  const phone = !!window.matchMedia?.('(max-width: 720px)').matches,
    closed = pop.hidden,
    parts = closed ? popoverWords(pop, state) : [];
  if (key === 'notes' && phone && closed) {
    const marks = popoverWords($('palette-marks'), state).filter(p => p.startsWith('has '));
    if (marks.length) {
      const i = parts.findIndex(p => p.startsWith('has '));
      if (i < 0) parts.push(marks[0]);
      else parts[i] = `has ${listWords([parts[i].slice(4), marks[0].slice(4)])}`;
    }
  }
  const name = key[0].toUpperCase() + key.slice(1);
  if (typeof markTrigger === 'function') markTrigger(trigger, parts.length, `this note ${parts.join(' and ')}`);
  else trigger.classList.toggle('in-use', parts.length > 0);
  trigger.setAttribute('aria-label', parts.length ? `${name} (this note ${parts.join(' and ')})` : name);
}
// The status line after the last press, and the selection it was about.
let paletteMessage = null;
function updatePalette() {
  const bar = $('palette');
  if (!bar) return;
  const state = paletteState(),
    near = (a, b) => Math.abs(a - b) < 1e-9,
    status = $('selection-status');
  // A press's message is about the note it was pressed on. Once the selection moves on (typing a note, say), the
  // status line says what is selected now instead.
  if (paletteMessage && paletteMessage.at !== (selectedRange?.[0] ?? null)) {
    if (status.textContent === paletteMessage.text)
      status.textContent = state.sel
        ? (noteDescription(state.sel.entry) || `Measure ${state.sel.entry.measure} selected`) + '.'
        : NOTHING_SELECTED;
    paletteMessage = null;
  }
  // Chord is marked when the note has a chord symbol, and its name says which.
  const chord = bar.querySelector('[data-palette="chord"]');
  if (chord) {
    chord.classList.toggle('in-use', !!state.chord);
    chord.setAttribute('aria-label', state.chord ? `Chord symbol (${state.chord})` : 'Chord symbol');
  }
  const lyric = bar.querySelector('[data-palette="lyric"]');
  if (lyric) {
    lyric.classList.toggle('in-use', !!state.lyric);
    lyric.setAttribute('aria-label', state.lyric ? `Lyrics (${state.lyric})` : 'Lyrics');
  }
  for (const b of bar.querySelectorAll('[data-palette]')) {
    const action = b.dataset.palette;
    // The Measure panel's buttons are brought up to date while it is open.
    if (PALETTE_TRIGGERS.includes(action) || (MEASURE_ACTION.test(action) && $('palette-measure').hidden)) continue;
    let pressed = null;
    if (MEASURE_ACTION.test(action)) pressed = measurePressed(action, state.measure);
    else if (action.startsWith('len:')) pressed = near(state.length, +action.slice(4));
    else if (action === 'dot') pressed = !!state.dotted;
    else if (action === 'tie') pressed = !!state.tied;
    else if (action.startsWith('acc:')) pressed = state.accidental === action.slice(4);
    else if (action === 'beam:join') pressed = !!state.beam?.joined && !paletteBlocked(action, state);
    else if (action.startsWith('deco:')) pressed = !!state.marks?.marks.includes(action.slice(5));
    else if (action.startsWith('dyn:')) pressed = state.marks?.dynamic === action.slice(4);
    else if (action.startsWith('line:')) pressed = !!state.lines?.[action.slice(5)]?.on;
    else if (action.startsWith('tuplet:')) pressed = state.tuplet === +action.slice(7);
    else if (action === 'grace') pressed = !!state.grace;
    else if (action === 'grace:slash') pressed = !!state.grace?.slashed;
    if (pressed != null) b.setAttribute('aria-pressed', pressed);
    b.setAttribute('aria-disabled', !!paletteBlocked(action, state));
  }
  // The triggers of closed popovers name what the selected note has in them.
  summarizeTrigger('notes', state);
  summarizeTrigger('marks', state);
  if (typeof updateMeasureTools === 'function') updateMeasureTools(state.measure);
}
$('palette').addEventListener('click', e => {
  const b = e.target.closest('[data-palette]');
  if (b) pressPalette(b, e.detail === 0);
});
// A press on a palette button, from a pointer, the keyboard (keyboard) or the shortcut sheet's command search (a
// pointer press, so the score gets the keyboard back).
function pressPalette(b, keyboard = false) {
  const action = b.dataset.palette;
  // Notes, Marks and Measure open their popovers (menus.js); from the keyboard the focus moves into the popover.
  if (PALETTE_TRIGGERS.includes(action)) {
    paletteTabStop(b);
    if (typeof toggleMenu === 'function') toggleMenu(b, {keyboard});
    else {
      const panel = $(b.getAttribute('aria-controls'));
      panel.hidden = !panel.hidden;
      b.setAttribute('aria-expanded', !panel.hidden);
    }
    updatePalette();
    return;
  }
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const state = paletteState(),
    blocked = paletteBlocked(action, state);
  fitNote = null;
  // The chord box takes the keyboard; it hands it back to this button after a keyboard press, else to the score.
  if (action === 'chord' && !blocked) {
    openChordEntry(state.sel, keyboard ? b : null);
    return;
  }
  if (action === 'lyric' && !blocked) {
    openLyricEntry(state.sel, keyboard ? b : null);
    return;
  }
  // Comment opens the feedback box on the selected note (marks.js), which also hands the keyboard back.
  if (action === 'comment' && !blocked && typeof commentSelected === 'function') {
    commentSelected(keyboard ? b : null);
    return;
  }
  if (blocked) $('selection-status').textContent = blocked;
  else if (action.startsWith('len:')) chooseLength(+action.slice(4), state.sel);
  else if (action === 'respell') respellSelected(state.sel);
  else if (action.startsWith('line:')) toggleLineSelected(action.slice(5));
  else if (action.startsWith('tuplet:')) tupletSelected(+action.slice(7), state.sel);
  // Delete in a tuplet sets its own status line (see tupletDelete).
  else if (action === 'delete' && state.tuplet && !state.picked) editNote(state.sel.entry, state.sel.display, action);
  else if (action.startsWith('grace')) graceSelected(action, state.sel);
  else if (MEASURE_ACTION.test(action)) measureCommand(action);
  else {
    const before = $('abc').value,
      toggled = {
        dot: state.dotted ? 'Dot removed.' : 'Dotted.',
        tie: state.tied ? 'Tie removed.' : 'Tied to the next note.'
      };
    // On a range selection the buttons act on every note, as their keys do; Delete says how many notes went.
    if (state.picked && /^(deco|dyn):/.test(action))
      $('selection-status').textContent = markRange(state.picked, action);
    else if (state.picked && rangePalette(action, state.picked)) {
      if (action !== 'delete')
        $('selection-status').textContent = fitSaid(
          $('abc').value === before ? 'No change.' : `Changed ${countWords(state.picked.filter(pitched).length)}.`
        );
    } else {
      editNote(state.sel.entry, state.sel.display, action);
      // Keep bars full adds to the message or replaces it (see fitNote).
      $('selection-status').textContent = fitSaid(
        $('abc').value === before
          ? 'No change.'
          : toggled[action] ||
              PALETTE_DONE[action] ||
              (/^(deco|dyn):/.test(action) ? markDone(action, state.marks) : '')
      );
    }
  }
  paletteMessage = {text: $('selection-status').textContent, at: selectedRange?.[0] ?? null};
  updatePalette();
  // Pointer presses hand the keyboard back to the score so letters and keys reach it; keyboard presses stay on the button.
  if (keyboard) b.focus({preventScroll: true});
  else focusScore();
}
// One tab stop for the toolbar's strip and triggers: the last one used. Arrow keys, Home and End move between them,
// skipping a trigger the layout hides (Marks and Measure on a phone). The popovers' buttons are reached from their
// triggers, and menus.js moves between them.
const TOOLBAR_STOPS = '#palette :is(.palette-strip, .palette-triggers) [data-palette]';
function paletteTabStop(target) {
  for (const b of document.querySelectorAll(TOOLBAR_STOPS)) b.tabIndex = b === target ? 0 : -1;
}
$('palette').addEventListener('keydown', e => {
  if (e.target.closest('.menu-pop')) return;
  // jsdom lays nothing out, so there every trigger counts as shown.
  const laidOut = document.documentElement.getClientRects().length > 0,
    buttons = [...document.querySelectorAll(TOOLBAR_STOPS)].filter(
      b => !b.closest('[hidden]') && (!laidOut || b.getClientRects().length > 0)
    ),
    i = buttons.indexOf(e.target),
    to = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1}[e.key];
  if (i < 0 || to == null) return;
  e.preventDefault();
  buttons[(to + buttons.length) % buttons.length].focus();
});
$('palette').addEventListener('focusin', e => {
  if (e.target.matches(TOOLBAR_STOPS)) paletteTabStop(e.target);
});
paletteTabStop(document.querySelector(TOOLBAR_STOPS));
// The stop never stays on a button the layout hides: at phone width Marks and Measure go, and Notes (which opens them)
// takes the stop; a strip button that held it keeps it. The focus follows when it was on the hidden button.
function keepPaletteTabStop() {
  if (!document.documentElement.getClientRects().length) return;
  const all = [...document.querySelectorAll(TOOLBAR_STOPS)],
    stop = all.find(b => b.tabIndex === 0);
  if (stop?.getClientRects().length) return;
  const shown = all.filter(b => b.getClientRects().length > 0),
    to =
      (stop && PALETTE_TRIGGERS.includes(stop.dataset.palette)
        ? shown.find(b => PALETTE_TRIGGERS.includes(b.dataset.palette))
        : null) || shown[0];
  if (!to) return;
  paletteTabStop(to);
  if (stop && document.activeElement === stop) to.focus({preventScroll: true});
}
window.matchMedia?.('(max-width: 720px)').addEventListener?.('change', keepPaletteTabStop);
window.addEventListener('resize', keepPaletteTabStop);
updatePalette();
