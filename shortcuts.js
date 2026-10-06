'use strict';
// Shortcut sheet and command search. SHORTCUTS lists the editing commands by task: each has a name, its keys, and how
// it runs (a notation palette button, a key on the score, a menu in the Measure panel, or a function). The palette's
// titles and aria-keyshortcuts come from it. ? on the studio, or the Shortcuts button, opens a dialog that lists it;
// typing in its search box filters the commands, and Enter runs the chosen one on the selection, like Noteflight's
// Editor Guide search. The dialog keeps the keyboard until it closes, then gives it back to the score.
const SHORTCUTS = [
  {group: 'Select', name: 'Select the next note', keys: ['→'], aria: 'ArrowRight', key: 'ArrowRight'},
  {group: 'Select', name: 'Select the previous note', keys: ['←'], aria: 'ArrowLeft', key: 'ArrowLeft'},
  {
    group: 'Select',
    name: 'Select one more note to the right',
    keys: ['Shift+→'],
    aria: 'Shift+ArrowRight',
    key: {key: 'ArrowRight', shiftKey: true},
    words: 'extend range'
  },
  {
    group: 'Select',
    name: 'Select one more note to the left',
    keys: ['Shift+←'],
    aria: 'Shift+ArrowLeft',
    key: {key: 'ArrowLeft', shiftKey: true},
    words: 'extend range'
  },
  {group: 'Select', name: 'Select all notes', keys: ['Ctrl+A'], aria: 'Control+A', key: {key: 'a', ctrlKey: true}},
  {group: 'Select', name: 'Clear the selection', keys: ['Esc'], aria: 'Escape', key: 'Escape', words: 'deselect'},
  {
    group: 'Write',
    name: 'Add a note after the selection',
    keys: ['A–G'],
    words: 'letter pitch enter type',
    hint: 'Type a letter from A to G on the score.'
  },
  {
    group: 'Write',
    name: 'Add a pitch to the chord',
    keys: ['Shift+A–G'],
    words: 'letter',
    hint: 'Hold Shift and type a letter from A to G on the score.'
  },
  {group: 'Write', name: 'Add a rest', keys: ['R', '0'], aria: 'R 0', key: 'r', words: 'silence'},
  {group: 'Write', name: 'Add a bar line', keys: ['|'], key: '|', words: 'barline measure'},
  {group: 'Write', name: 'Chord symbol', keys: ['K'], palette: 'chord', words: 'lead sheet harmony'},
  {group: 'Write', name: 'Lyrics', keys: ['L'], palette: 'lyric', words: 'words syllable verse sing'},
  {group: 'Length', name: 'Whole note', keys: ['7'], palette: 'len:1', words: 'duration semibreve'},
  {group: 'Length', name: 'Half note', keys: ['6'], palette: 'len:0.5', words: 'duration minim'},
  {group: 'Length', name: 'Quarter note', keys: ['5'], palette: 'len:0.25', words: 'duration crotchet'},
  {group: 'Length', name: 'Eighth note', keys: ['4'], palette: 'len:0.125', words: 'duration quaver'},
  {group: 'Length', name: '16th note', keys: ['3'], palette: 'len:0.0625', words: 'duration sixteenth semiquaver'},
  {group: 'Length', name: 'Dotted', keys: ['.'], palette: 'dot', words: 'dot'},
  {group: 'Length', name: 'Tie to the next note', keys: ['+'], palette: 'tie', words: 'hold'},
  {group: 'Length', name: 'Change to a rest', keys: [], palette: 'to-rest', words: 'silence'},
  {group: 'Length', name: 'Halve the lengths', keys: ['['], key: '[', words: 'shorter diminution'},
  {group: 'Length', name: 'Double the lengths', keys: [']'], key: ']', words: 'longer augmentation'},
  {group: 'Tuplets and grace notes', name: 'Triplet', keys: ['T'], palette: 'tuplet:3', words: 'tuplet three'},
  {group: 'Tuplets and grace notes', name: 'Duplet', keys: [], palette: 'tuplet:2', words: 'tuplet two'},
  {group: 'Tuplets and grace notes', name: 'Quintuplet', keys: [], palette: 'tuplet:5', words: 'tuplet five'},
  {group: 'Tuplets and grace notes', name: 'Sextuplet', keys: [], palette: 'tuplet:6', words: 'tuplet six'},
  {group: 'Tuplets and grace notes', name: 'Septuplet', keys: [], palette: 'tuplet:7', words: 'tuplet seven'},
  {group: 'Tuplets and grace notes', name: 'Grace note', keys: [], palette: 'grace', words: 'ornament appoggiatura'},
  {
    group: 'Tuplets and grace notes',
    name: 'Slashed grace note',
    keys: [],
    palette: 'grace:slash',
    words: 'ornament acciaccatura'
  },
  {group: 'Tuplets and grace notes', name: 'Move the grace note up', keys: [], palette: 'grace:up', words: 'higher'},
  {group: 'Tuplets and grace notes', name: 'Move the grace note down', keys: [], palette: 'grace:down', words: 'lower'},
  {group: 'Pitch', name: 'Up a step', keys: ['↑'], aria: 'ArrowUp', key: 'ArrowUp', words: 'higher raise'},
  {group: 'Pitch', name: 'Down a step', keys: ['↓'], aria: 'ArrowDown', key: 'ArrowDown', words: 'lower'},
  {
    group: 'Pitch',
    name: 'Up an octave',
    keys: ['Ctrl+↑'],
    aria: 'Control+ArrowUp',
    key: {key: 'ArrowUp', ctrlKey: true},
    words: 'higher raise'
  },
  {
    group: 'Pitch',
    name: 'Down an octave',
    keys: ['Ctrl+↓'],
    aria: 'Control+ArrowDown',
    key: {key: 'ArrowDown', ctrlKey: true},
    words: 'lower'
  },
  {group: 'Pitch', name: 'Sharp', keys: ['#'], palette: 'acc:^', words: 'accidental ♯'},
  {group: 'Pitch', name: 'Flat', keys: ['-'], palette: 'acc:_', words: 'accidental ♭'},
  {group: 'Pitch', name: 'Natural', keys: ['='], palette: 'acc:=', words: 'accidental ♮'},
  {group: 'Pitch', name: 'No accidental', keys: [], palette: 'acc:', words: 'remove'},
  {group: 'Pitch', name: 'Respell', keys: ['Z'], palette: 'respell', words: 'enharmonic spelling'},
  {group: 'Marks', name: 'Staccato', keys: [';'], palette: 'deco:staccato', words: 'articulation short'},
  {group: 'Marks', name: 'Tenuto', keys: [':'], palette: 'deco:tenuto', words: 'articulation'},
  {group: 'Marks', name: 'Accent', keys: ['>'], palette: 'deco:accent', words: 'articulation'},
  {group: 'Marks', name: 'Marcato', keys: ['"'], palette: 'deco:marcato', words: 'articulation'},
  {group: 'Marks', name: 'Fermata', keys: ['^'], palette: 'deco:fermata', words: 'hold pause'},
  {group: 'Marks', name: 'Staccatissimo', keys: [], palette: 'deco:wedge', words: 'articulation wedge'},
  {group: 'Marks', name: 'Up bow', keys: [], palette: 'deco:upbow', words: 'strings'},
  {group: 'Marks', name: 'Down bow', keys: [], palette: 'deco:downbow', words: 'strings'},
  {group: 'Marks', name: 'Breath mark', keys: [], palette: 'deco:breath', words: 'comma'},
  {group: 'Marks', name: 'Trill', keys: [], palette: 'deco:trill', words: 'ornament'},
  {group: 'Marks', name: 'Mordent', keys: [], palette: 'deco:mordent', words: 'ornament'},
  {group: 'Marks', name: 'Turn', keys: [], palette: 'deco:turn', words: 'ornament'},
  {group: 'Marks', name: 'Arpeggio', keys: [], palette: 'deco:arpeggio', words: 'ornament rolled chord'},
  ...[
    ['ppp', 'very, very soft'],
    ['pp', 'very soft'],
    ['p', 'soft'],
    ['mp', 'medium soft'],
    ['mf', 'medium loud'],
    ['f', 'loud'],
    ['ff', 'very loud'],
    ['fff', 'very, very loud'],
    ['sfz', 'sudden accent']
  ].map(([mark, meaning]) => ({
    group: 'Dynamics',
    name: `${mark} (${meaning})`,
    keys: [],
    palette: 'dyn:' + mark,
    words: 'dynamic volume'
  })),
  {group: 'Lines and beams', name: 'Slur', keys: ['S'], palette: 'line:slur', words: 'phrase legato'},
  {group: 'Lines and beams', name: 'Crescendo', keys: [], palette: 'line:crescendo', words: 'hairpin louder'},
  {group: 'Lines and beams', name: 'Diminuendo', keys: [], palette: 'line:diminuendo', words: 'hairpin softer'},
  {group: 'Lines and beams', name: 'Trill line', keys: [], palette: 'line:trill', words: 'ornament'},
  {group: 'Lines and beams', name: 'Join beam to the next note', keys: [], palette: 'beam:join'},
  {group: 'Lines and beams', name: 'Break the beam after this note', keys: [], palette: 'beam:break'},
  {group: 'Measure', name: 'Insert a bar before', keys: [], palette: 'bar:before', words: 'measure add empty'},
  {group: 'Measure', name: 'Insert a bar after', keys: [], palette: 'bar:after', words: 'measure add empty'},
  {group: 'Measure', name: 'Delete the bar', keys: [], palette: 'bar:delete', words: 'measure remove'},
  {group: 'Measure', name: 'Single bar line', keys: [], palette: 'barline:|', words: 'barline'},
  {group: 'Measure', name: 'Double bar line', keys: [], palette: 'barline:||', words: 'barline'},
  {group: 'Measure', name: 'Final bar line', keys: [], palette: 'barline:|]', words: 'barline end'},
  {group: 'Measure', name: 'Start repeat', keys: [], palette: 'repeat:start', words: 'sign'},
  {group: 'Measure', name: 'End repeat', keys: [], palette: 'repeat:end', words: 'sign'},
  {group: 'Measure', name: '1st ending', keys: [], palette: 'ending:1', words: 'first volta'},
  {group: 'Measure', name: '2nd ending', keys: [], palette: 'ending:2', words: 'second volta'},
  {group: 'Measure', name: 'Segno', keys: [], palette: 'form:segno', words: 'sign form'},
  {group: 'Measure', name: 'Coda', keys: [], palette: 'form:coda', words: 'sign form'},
  {group: 'Measure', name: 'Fine', keys: [], palette: 'form:fine', words: 'end form'},
  {group: 'Measure', name: 'D.C. (da capo)', keys: [], palette: 'form:D.C.', words: 'form'},
  {group: 'Measure', name: 'D.S. (dal segno)', keys: [], palette: 'form:D.S.', words: 'form'},
  {group: 'Measure', name: 'D.C. al Fine', keys: [], palette: 'form:D.C.alfine', words: 'da capo form'},
  {group: 'Measure', name: 'D.S. al Coda', keys: [], palette: 'form:D.S.alcoda', words: 'dal segno form'},
  {group: 'Measure', name: 'Rehearsal mark', keys: [], palette: 'rehearsal:mark', words: 'letter'},
  {group: 'Measure', name: 'Time signature from here', keys: [], menu: 'meter', words: 'meter change'},
  {group: 'Measure', name: 'Key from here', keys: [], menu: 'key', words: 'signature change'},
  {group: 'Measure', name: 'Clef from here', keys: [], menu: 'clef', words: 'change'},
  {group: 'Edit', name: 'Delete', keys: ['Delete'], aria: 'Delete Backspace', palette: 'delete', words: 'remove'},
  {
    group: 'Edit',
    name: 'Remove without leaving a rest',
    keys: ['Shift+Delete'],
    aria: 'Shift+Delete',
    key: {key: 'Delete', shiftKey: true},
    words: 'delete keep bars full'
  },
  {group: 'Edit', name: 'Copy', keys: ['Ctrl+C'], aria: 'Control+C', key: {key: 'c', ctrlKey: true}},
  {
    group: 'Edit',
    name: 'Cut to rests',
    keys: ['Ctrl+X'],
    aria: 'Control+X',
    key: {key: 'x', ctrlKey: true},
    words: 'cut'
  },
  {group: 'Edit', name: 'Paste', keys: ['Ctrl+V'], aria: 'Control+V', key: {key: 'v', ctrlKey: true}},
  {
    group: 'Edit',
    name: 'Duplicate',
    keys: ['Ctrl+D'],
    aria: 'Control+D',
    key: {key: 'd', ctrlKey: true},
    words: 'repeat copy'
  },
  {group: 'Edit', name: 'Undo', keys: ['Ctrl+Z'], aria: 'Control+Z', run: () => stepHistory(-1)},
  {group: 'Edit', name: 'Redo', keys: ['Ctrl+Shift+Z'], aria: 'Control+Shift+Z', run: () => stepHistory(1)},
  {
    group: 'Play',
    name: 'Play from the selected note, or stop',
    keys: ['Space'],
    aria: 'Space',
    key: ' ',
    words: 'listen start'
  }
];
// The commands whose name, task, keys or extra words have a word starting with each word of the query, in table
// order; "tie" finds Tie to the next note.
function filterShortcuts(query, list = SHORTCUTS) {
  const wanted = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(s => {
    const words = [s.name, s.group, s.words || '', ...s.keys]
      .join(' ')
      .toLowerCase()
      .split(/[\s,()]+/);
    return wanted.every(w => words.some(word => word.startsWith(w)));
  });
}
// Keys as <kbd> pieces: Ctrl+Shift+Z is three, + alone is one.
const shortcutKeysHTML = keys =>
  keys
    .map(k =>
      k
        .split(/\+(?=.)/)
        .map(part => `<kbd>${esc(part)}</kbd>`)
        .join('+')
    )
    .join(' or ');
// Palette buttons take their key hints from the table, so a key is named the same way everywhere.
for (const s of SHORTCUTS) {
  const button = s.palette && s.keys.length && document.querySelector(`#palette [data-palette="${s.palette}"]`);
  if (!button) continue;
  button.title = (button.title || s.name).replace(/ \([^()]*\)$/, '') + ` (${s.keys.join(', ')})`;
  button.setAttribute('aria-keyshortcuts', s.aria ?? s.keys[0]);
}
// Run a command on the selection, as its palette button or key would. A key that does nothing says why.
function runShortcut(s) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const palette = typeof pressPalette === 'function',
    button = palette && s.palette && $('palette')?.querySelector(`[data-palette="${s.palette}"]`);
  // The Measure panel's tools act on the selection only while the panel is open, so its commands open it first; its
  // Time, Key and Clef menus (menu) take the keyboard.
  if (palette && (s.menu || button?.closest('#palette-measure')) && selectedRange && $('palette-measure')?.hidden)
    pressPalette($('palette').querySelector('[aria-controls="palette-measure"]'));
  if (button) return pressPalette(button);
  const menu = s.menu && $('measure-' + s.menu);
  if (menu && !menu.disabled && $('palette-measure')?.hidden === false) return menu.focus({preventScroll: true});
  focusScore();
  if (s.menu) $('selection-status').textContent = 'Select a note or bar line on the score first.';
  if (s.run) return s.run();
  if (!s.key) return;
  const event = {
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...(typeof s.key === 'string' ? {key: s.key} : s.key)
  };
  if (!scoreKey(event))
    $('selection-status').textContent = selectedNote()
      ? `${s.name} does not apply to the selected note or rest.`
      : 'Select a note on the score first.';
}
// The dialog. shortcutsShown holds the commands listed and which one Enter runs; shortcutsReturn is where the
// keyboard goes back to on closing.
let shortcutsShown = {list: [], active: -1},
  shortcutsReturn = null;
function showShortcuts() {
  const query = $('shortcuts-search').value.trim(),
    list = query ? filterShortcuts(query) : SHORTCUTS;
  shortcutsShown = {list, active: query && list.length ? 0 : -1};
  const groups = [...new Set(list.map(s => s.group))];
  $('shortcuts-list').innerHTML = groups
    .map(
      (group, g) =>
        `<div role="group" aria-labelledby="shortcut-group-${g}"><div class="shortcut-group" id="shortcut-group-${g}">${esc(group)}</div>` +
        list
          .map((s, i) =>
            s.group !== group
              ? ''
              : `<div role="option" id="shortcut-${i}" data-shortcut="${i}" aria-selected="false"${s.hint ? ' aria-disabled="true"' : ''}><span class="shortcut-name">${esc(s.name)}</span><span class="shortcut-keys">${shortcutKeysHTML(s.keys)}</span></div>`
          )
          .join('') +
        '</div>'
    )
    .join('');
  $('shortcuts-status').textContent = query
    ? list.length
      ? `${list.length} command${list.length === 1 ? '' : 's'}. Enter runs ${list[0].name}.`
      : 'No commands match.'
    : '';
  markShortcut();
}
function markShortcut() {
  const {active} = shortcutsShown;
  for (const option of $('shortcuts-list').querySelectorAll('[role="option"]'))
    option.setAttribute('aria-selected', +option.dataset.shortcut === active);
  const option = active >= 0 && $('shortcut-' + active);
  if (option) {
    $('shortcuts-search').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView?.({block: 'nearest'});
  } else $('shortcuts-search').removeAttribute('aria-activedescendant');
}
function openShortcuts() {
  if (!$('shortcuts').hidden) return;
  shortcutsReturn = document.activeElement;
  // An open note menu closes first: score keys do nothing while it is shown, and the keyboard goes back to the score.
  if ($('note-menu') && !$('note-menu').hidden && typeof closeNoteMenu === 'function') {
    closeNoteMenu();
    shortcutsReturn = null;
  }
  $('shortcuts').hidden = false;
  $('shortcuts-open')?.setAttribute('aria-expanded', 'true');
  $('shortcuts-search').value = '';
  showShortcuts();
  $('shortcuts-search').focus({preventScroll: true});
}
// Closing gives the keyboard back to where it was (the score, or the Shortcuts button); running a command gives it
// to the score.
function closeShortcuts(toScore = false) {
  if ($('shortcuts').hidden) return;
  $('shortcuts').hidden = true;
  $('shortcuts-open')?.setAttribute('aria-expanded', 'false');
  const back = !toScore && shortcutsReturn?.isConnected && !shortcutsReturn.closest('#shortcuts') && shortcutsReturn;
  if (back && back !== document.body) back.focus({preventScroll: true});
  else focusScore();
  shortcutsReturn = null;
}
function chooseShortcut(i) {
  const s = shortcutsShown.list[i];
  if (!s) return;
  if (s.hint) {
    shortcutsShown.active = i;
    markShortcut();
    $('shortcuts-status').textContent = s.hint;
    return;
  }
  closeShortcuts(true);
  runShortcut(s);
}
$('shortcuts-open')?.addEventListener('click', openShortcuts);
$('shortcuts-close').addEventListener('click', () => closeShortcuts());
$('shortcuts-search').addEventListener('input', showShortcuts);
$('shortcuts-list').addEventListener('click', e => {
  const option = e.target.closest('[data-shortcut]');
  if (option) chooseShortcut(+option.dataset.shortcut);
});
// A press on the backdrop, outside the dialog box, closes it. A click on a part that takes no focus (the heading, a
// hint command) leaves the keyboard on the page, so it goes back to the search box; a tap leaves it there rather than
// bring up the on-screen keyboard.
$('shortcuts').addEventListener('click', e => {
  if (e.target === $('shortcuts')) closeShortcuts();
  else if (e.pointerType !== 'touch' && !$('shortcuts').hidden && !$('shortcuts').contains(document.activeElement))
    $('shortcuts-search').focus({preventScroll: true});
});
// Escape closes the dialog, and Tab and Shift+Tab go round its controls so focus stays in it. They also work while
// focus is on the page, as it is for a moment after a click on the dialog's text.
function dialogKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeShortcuts();
    return true;
  }
  if (e.key !== 'Tab') return false;
  const stops = [$('shortcuts-search'), $('shortcuts-close')],
    i = stops.indexOf(document.activeElement);
  e.preventDefault();
  stops[i < 0 ? (e.shiftKey ? 1 : 0) : (i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
  return true;
}
document.addEventListener('keydown', e => {
  if (!$('shortcuts').hidden && !$('shortcuts').contains(e.target)) dialogKey(e);
});
$('shortcuts').addEventListener('keydown', e => {
  const {list, active} = shortcutsShown;
  if (dialogKey(e)) return;
  if (e.target === $('shortcuts-search') && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length) {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    shortcutsShown.active = active < 0 ? (step > 0 ? 0 : list.length - 1) : (active + step + list.length) % list.length;
    markShortcut();
  } else if (e.target === $('shortcuts-search') && e.key === 'Enter') {
    e.preventDefault();
    if (active >= 0) chooseShortcut(active);
    else $('shortcuts-status').textContent = 'Type to find a command, or use ↑↓ to choose one.';
  }
});
// Focus that leaves the open dialog (a screen reader's cursor, a click behind it) comes back to the search box.
document.addEventListener('focusin', e => {
  if (!$('shortcuts').hidden && !$('shortcuts').contains(e.target)) $('shortcuts-search').focus({preventScroll: true});
});
// ? opens the sheet from anywhere in the studio but a text field, where it types a question mark.
document.addEventListener('keydown', e => {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || embedView || $('studio').hidden) return;
  const field = e.target.closest?.('input,select,textarea,[contenteditable]');
  if (field && !/^(checkbox|radio|range|button)$/.test(field.type)) return;
  e.preventDefault();
  openShortcuts();
});
