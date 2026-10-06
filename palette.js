'use strict';
// Notation palette: a toolbar above the score for the selected note's length, dot, tie, rest, accidental and beam,
// and Delete. Buttons light up (aria-pressed) to show the selection's state and send the same action as the note menu
// or the matching key to editNote, so each press is one undo step. Later notation tools add their own groups here.
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
// What the palette shows: the selected note's length (without its dot), dot, tie, accidental and whether it is
// beamed to the next note, or, with nothing selected, the length new notes will get.
function paletteState() {
  const sel = selectedNote();
  if (!sel) return {sel: null, length: inputLength ?? beatLength()};
  const element = sel.entry.element,
    isRest = !element.pitches?.length,
    source = $('abc').value.slice(element.startChar, element.endChar),
    len = element.duration || 0,
    dotted = DOTTABLE.some(v => Math.abs(len - v * 1.5) < 1e-9);
  // Accidentals are shown as the player reads them, in written pitch, like the note menu.
  const text = !isRest && transposing() && sel.display ? writtenNote(sel.display).text : source;
  return {
    sel,
    isRest,
    length: dotted ? len / 1.5 : len,
    dotted,
    tied: !isRest && /^-/.test(noteParts(source)?.post || ''),
    accidental: isRest ? null : (noteParts(text)?.core.match(/^\[?(\^{1,2}|_{1,2}|=)/) || [])[1] || '',
    beam: isRest ? null : beamGap(sel.entry)
  };
}
// Why a button does nothing for the current selection, or '' when it applies.
function paletteBlocked(action, state) {
  if (action.startsWith('len:')) return '';
  if (!state.sel) return 'Select a note on the score first.';
  if (state.isRest && !['dot', 'delete'].includes(action))
    return action === 'to-rest' ? 'This is already a rest.' : 'Rests have no accidental, tie or beam.';
  if (action.startsWith('beam:') && !state.beam) return 'There is no next note in this bar to beam to.';
  if (action === 'beam:break' && !state.beam.joined) return 'This note is not beamed to the next one.';
  return '';
}
function updatePalette() {
  const bar = $('palette');
  if (!bar) return;
  const state = paletteState(),
    near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const b of bar.querySelectorAll('[data-palette]')) {
    const action = b.dataset.palette;
    let pressed = null;
    if (action.startsWith('len:')) pressed = near(state.length, +action.slice(4));
    else if (action === 'dot') pressed = !!state.dotted;
    else if (action === 'tie') pressed = !!state.tied;
    else if (action.startsWith('acc:')) pressed = state.accidental === action.slice(4);
    else if (action === 'beam:join') pressed = !!state.beam?.joined;
    if (pressed != null) b.setAttribute('aria-pressed', pressed);
    b.setAttribute('aria-disabled', !!paletteBlocked(action, state));
  }
}
$('palette').addEventListener('click', e => {
  const b = e.target.closest('[data-palette]');
  if (!b) return;
  const action = b.dataset.palette;
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const state = paletteState(),
    blocked = paletteBlocked(action, state);
  if (blocked) $('selection-status').textContent = blocked;
  else if (action.startsWith('len:')) chooseLength(+action.slice(4), state.sel);
  else {
    editNote(state.sel.entry, state.sel.display, action);
    $('selection-status').textContent =
      action === 'dot'
        ? state.dotted
          ? 'Dot removed.'
          : 'Dotted.'
        : action === 'tie'
          ? state.tied
            ? 'Tie removed.'
            : 'Tied to the next note.'
          : PALETTE_DONE[action] || '';
  }
  updatePalette();
  // Pointer presses hand the keyboard back to the score so letters and keys reach it; keyboard presses stay on the button.
  if (e.detail === 0) b.focus({preventScroll: true});
  else focusScore();
});
// One tab stop for the toolbar: the last button used. Arrow keys, Home and End move between the buttons.
function paletteTabStop(target) {
  for (const b of $('palette').querySelectorAll('[data-palette]')) b.tabIndex = b === target ? 0 : -1;
}
$('palette').addEventListener('keydown', e => {
  const buttons = [...$('palette').querySelectorAll('[data-palette]')],
    i = buttons.indexOf(e.target),
    to = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1}[e.key];
  if (i < 0 || to == null) return;
  e.preventDefault();
  buttons[(to + buttons.length) % buttons.length].focus();
});
$('palette').addEventListener('focusin', e => {
  if (e.target.matches('[data-palette]')) paletteTabStop(e.target);
});
paletteTabStop($('palette').querySelector('[data-palette]'));
updatePalette();
