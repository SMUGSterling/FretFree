'use strict';
// Menus in the Compose app bar. A trigger (aria-haspopup="dialog", aria-controls) opens its popover (.menu-pop,
// role="dialog") under it: Score, Edit, Sound, View and Share on the first row, and Notes, Marks and Measure in the
// notation toolbar. One menu is open at a time. A press outside, Escape, or (for the first row) focus leaving the menu
// closes it; command items (data-close) close it before they run. The notation popovers stay open while notes are
// picked on the score, and Keep open pins one under the toolbar. On a phone the first row is a sheet behind ☰ that
// shows every menu at once, and Notes opens a sheet with the Notes, Marks and Measure tools. Every control keeps its
// id, and the panels these menus open (the panel dock) keep their own close buttons and Escape handlers.
const ROW_MENUS = ['settings-toggle', 'menu-edit', 'menu-sound', 'view-toggle', 'menu-share'],
  PALETTE_MENUS = ['menu-notes', 'menu-marks', 'menu-measure'],
  MENU_ITEMS = 'button:not([disabled]), summary, input[type="checkbox"]:not([disabled]), a[href]',
  FOCUSABLE =
    'button:not([disabled]), summary, a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
  // Presses here leave a notation popover open, so a teacher can pick note after note and mark each one.
  SCORE_AREA = '#notation, .notation-paper, #chord-entry, #lyric-entry, #mark-box, #note-menu, #piano';
// Whether el is on screen. jsdom lays nothing out, so there every element counts as shown (as in palette.js).
const laidOut = () => document.documentElement.getClientRects().length > 0;
const shownEl = el =>
  !!el && (!laidOut() || (el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'));
const phoneLayout = () => !!window.matchMedia?.('(max-width: 720px)').matches;
const menuPop = trigger => $(trigger?.getAttribute('aria-controls'));
const menuTrigger = pop => document.querySelector(`[aria-haspopup="dialog"][aria-controls="${pop?.id}"]`);
const isPalettePop = pop => !!pop?.classList.contains('palette-pop');
const allMenus = () => [...ROW_MENUS, ...PALETTE_MENUS].map(id => $(id)).filter(Boolean);
// What is open: the one menu (a popover; pinned rows are not menus), and the phone sheet ('menu' or 'notes').
let openPop = null,
  openSheet = null;

// Remembered per device with the Practice band and the ABC source (app.js): which notation popovers are pinned.
const panelState = () =>
  (s => (s && typeof s === 'object' && !Array.isArray(s) ? s : {}))(storage.get(KEYS.studioPanels, {}));
function rememberPanel(key, value) {
  storage.set(KEYS.studioPanels, {...panelState(), [key]: value});
}

// Keeps a popover under its trigger and inside the bar (and the window, 16px from either edge), no taller than the
// room below.
function placeMenu(pop, trigger) {
  if (pop.classList.contains('pinned') || openSheet) return;
  pop.style.left = pop.style.top = pop.style.maxHeight = '';
  const base = pop.offsetParent;
  if (!base || getComputedStyle(pop).position !== 'absolute') return;
  const box = base.getBoundingClientRect(),
    bar = $('app-bar').getBoundingClientRect(),
    t = trigger.getBoundingClientRect(),
    width = pop.offsetWidth,
    start = Math.max(16, bar.left),
    edge = Math.min(document.documentElement.clientWidth - 16, bar.right),
    left = Math.max(start, Math.min(t.left, edge - width));
  pop.style.left = `${Math.round(left - box.left)}px`;
  pop.style.top = `${Math.round(t.bottom - box.top + 4)}px`;
  pop.style.maxHeight = `${Math.max(220, Math.floor(innerHeight - t.bottom - 12))}px`;
}
function setMenu(pop, open, {focus = false} = {}) {
  const trigger = menuTrigger(pop);
  if (!pop || !trigger) return;
  if (open) {
    if (openPop && openPop !== pop) setMenu(openPop, false);
    if (openSheet) closeSheet(false);
    openPop = pop;
  } else if (openPop === pop) openPop = null;
  pop.hidden = !open;
  trigger.setAttribute('aria-expanded', open);
  if (open) {
    placeMenu(pop, trigger);
    if (isPalettePop(pop)) keepPopStop(pop);
    if (focus) firstItem(pop)?.focus({preventScroll: true});
  }
  // The notation popovers show the selected note's state while open; Measure's selects are filled when it opens.
  if (isPalettePop(pop) && typeof updatePalette === 'function') updatePalette();
}
function closeMenus() {
  if (openPop) setMenu(openPop, false);
}
// A trigger's press (click, tap, Enter or Space): opens or closes its menu. From the keyboard the focus goes to the
// menu's first item; from a pointer it stays on the trigger. On a phone, Notes (and the Measure commands that open
// their popover first) open the Notes sheet, which holds the Notes, Marks and Measure tools.
function toggleMenu(trigger, {keyboard = false} = {}) {
  const pop = menuPop(trigger);
  if (!pop) return;
  if (isPalettePop(pop) && phoneLayout()) {
    if (openSheet === 'notes') closeSheet();
    else openNotesSheet(keyboard);
    return;
  }
  if (pop.classList.contains('pinned')) {
    setPinned(pop, false);
    return;
  }
  setMenu(pop, pop.hidden, {focus: keyboard});
}
// A menu's items in order. In the notation popovers Keep open comes last, so the first item is the first tool.
function menuItems(pop) {
  const items = [...pop.querySelectorAll(MENU_ITEMS)].filter(shownEl);
  return [...items.filter(b => !b.matches('.pop-pin')), ...items.filter(b => b.matches('.pop-pin'))];
}
// Where a keyboard open puts the focus: the first control in the menu (Volume in Sound, a slider the arrow keys leave
// alone), or a notation popover's first tool.
function firstItem(pop) {
  if (isPalettePop(pop) || pop.id === 'palette-pops') return menuItems(pop)[0];
  return [...pop.querySelectorAll(FOCUSABLE)].find(el => shownEl(el) && el.tabIndex >= 0) || menuItems(pop)[0];
}
// A notation popover is one tab stop, like the toolbar: the tool last used in it (the arrow keys move between them).
// So a popover pinned under the toolbar, or open on the way to the score, adds one stop to Tab, not one per tool.
const POP_STOPS = '[data-palette], .pop-pin';
function popTabStop(pop, target) {
  for (const b of pop.querySelectorAll(POP_STOPS)) b.tabIndex = b === target ? 0 : -1;
}
// The popover's stop moves to its first tool when the one it had is not shown (Keep open on a phone, say).
function keepPopStop(pop) {
  const stop = [...pop.querySelectorAll(POP_STOPS)].find(b => b.tabIndex === 0);
  if (!stop || !shownEl(stop)) popTabStop(pop, menuItems(pop)[0] || pop.querySelector('.pop-body [data-palette]'));
}
for (const pop of document.querySelectorAll('.palette-pop'))
  popTabStop(pop, pop.querySelector('.pop-body [data-palette]'));
document.addEventListener('focusin', e => {
  const pop = e.target.closest?.('.palette-pop');
  if (pop && e.target.matches(POP_STOPS)) popTabStop(pop, e.target);
});

// Keep open: a notation popover shown as a row under the toolbar, with no light dismiss, until unpinned. Not on phones.
function setPinned(pop, on, remember = true) {
  const trigger = menuTrigger(pop),
    key = pop.id.replace('palette-', '');
  if (on && openPop === pop) openPop = null;
  if (on && openPop) setMenu(openPop, false);
  pop.classList.toggle('pinned', on);
  pop.querySelector('.pop-pin')?.setAttribute('aria-pressed', on);
  pop.style.left = pop.style.top = pop.style.maxHeight = '';
  pop.hidden = !on;
  trigger?.setAttribute('aria-expanded', on);
  if (on) keepPopStop(pop);
  if (remember) rememberPanel('pin:' + key, on);
  if (typeof updatePalette === 'function') updatePalette();
}
for (const pop of document.querySelectorAll('.palette-pop'))
  if (panelState()['pin:' + pop.id.replace('palette-', '')] === true && !phoneLayout()) setPinned(pop, true, false);

// The phone sheets. ☰ shows the first row's menus as sections of one modal sheet; Notes shows the three notation
// popovers in a sheet over the bottom of the screen that leaves the score above it free to tap.
let sheetBackdrop = null;
function openMenuSheet() {
  closeMenus();
  if (openSheet) closeSheet(false);
  openSheet = 'menu';
  $('menu-row').classList.add('sheet-open');
  $('menu-row').setAttribute('role', 'dialog');
  $('menu-row').setAttribute('aria-modal', 'true');
  $('menu-row').setAttribute('aria-label', 'Menu');
  $('phone-menu').setAttribute('aria-expanded', 'true');
  for (const id of ROW_MENUS) menuPop($(id)).hidden = false;
  sheetBackdrop = document.createElement('div');
  sheetBackdrop.className = 'sheet-backdrop';
  sheetBackdrop.addEventListener('click', () => closeSheet());
  document.body.append(sheetBackdrop);
  padSheets();
  $('save').focus({preventScroll: true});
}
// The sheets scroll under a sticky header (☰) or a sticky Done (Notes); scroll padding keeps what the keyboard
// focuses, or a section jumped to, clear of them.
function padSheets() {
  const head = $('menu-row').querySelector('.sheet-head'),
    done = $('palette-sheet-close');
  $('menu-row').style.scrollPaddingTop = openSheet === 'menu' ? `${head.offsetHeight + 8}px` : '';
  $('palette-pops').style.scrollPaddingBottom = openSheet === 'notes' ? `${done.offsetHeight + 16}px` : '';
}
// The ☰ sheet's section buttons (Edit, Score, Sound, View, Share) scroll to a section and move the focus to its first
// control, so Share or Zoom is not three screens down.
$('menu-row').addEventListener('click', e => {
  const jump = e.target.closest('[data-jump]');
  if (!jump || openSheet !== 'menu') return;
  const section = $(jump.dataset.jump);
  section.scrollIntoView({block: 'start', behavior: 'instant'});
  firstItem(section)?.focus({preventScroll: true});
});
function openNotesSheet(keyboard = false) {
  closeMenus();
  if (openSheet) closeSheet(false);
  openSheet = 'notes';
  $('palette-pops').classList.add('sheet-open');
  $('menu-notes').setAttribute('aria-expanded', 'true');
  for (const id of PALETTE_MENUS) menuPop($(id)).hidden = false;
  document.body.classList.add('notes-sheet-open');
  document.body.style.paddingBottom = `${$('palette-pops').offsetHeight}px`;
  padSheets();
  for (const id of PALETTE_MENUS) keepPopStop(menuPop($(id)));
  keepNoteAboveSheet();
  if (keyboard) firstItem($('palette-pops'))?.focus({preventScroll: true});
  if (typeof updatePalette === 'function') updatePalette();
}
// Closes the open sheet; the focus goes back to its button unless it is already somewhere else on purpose.
function closeSheet(refocus = true) {
  const was = openSheet;
  if (!was) return;
  openSheet = null;
  if (was === 'menu') {
    $('menu-row').classList.remove('sheet-open');
    for (const name of ['role', 'aria-modal', 'aria-label']) $('menu-row').removeAttribute(name);
    $('menu-row').setAttribute('role', 'group');
    $('menu-row').setAttribute('aria-label', 'Menus');
    $('phone-menu').setAttribute('aria-expanded', 'false');
    for (const id of ROW_MENUS) menuPop($(id)).hidden = true;
    sheetBackdrop?.remove();
    sheetBackdrop = null;
    padSheets();
    const at = document.activeElement;
    if (refocus && (!at || at === document.body || !shownEl(at) || $('menu-row').contains(at)))
      $('phone-menu').focus({preventScroll: true});
  } else {
    $('palette-pops').classList.remove('sheet-open');
    $('menu-notes').setAttribute('aria-expanded', 'false');
    for (const id of PALETTE_MENUS) {
      const pop = menuPop($(id));
      if (!pop.classList.contains('pinned')) pop.hidden = true;
    }
    document.body.classList.remove('notes-sheet-open');
    document.body.style.paddingBottom = '';
    padSheets();
    const at = document.activeElement;
    if (refocus && (!at || at === document.body || $('palette-pops').contains(at) || !shownEl(at)))
      $('menu-notes').focus({preventScroll: true});
    if (typeof updatePalette === 'function') updatePalette();
  }
}
// The selected note stays in view above the Notes sheet.
function keepNoteAboveSheet() {
  if (openSheet !== 'notes') return;
  const note = document.querySelector('#notation .abcjs-note_selected'),
    top = $('palette-pops').getBoundingClientRect().top;
  if (!note) return;
  const r = note.getBoundingClientRect();
  if (r.bottom > top - 12) window.scrollBy(0, r.bottom - top + 48);
  else if (r.top < 0) window.scrollBy(0, r.top - 48);
}
for (const type of ['click', 'keyup'])
  $('notation').addEventListener(type, () => openSheet === 'notes' && requestAnimationFrame(keepNoteAboveSheet));
$('phone-menu').addEventListener('click', () => (openSheet === 'menu' ? closeSheet() : openMenuSheet()));
$('sheet-close').addEventListener('click', () => closeSheet());
$('palette-sheet-close').addEventListener('click', () => closeSheet());

// The first row's triggers. The notation triggers are #palette buttons, so their presses come through pressPalette.
$('menu-row').addEventListener('click', e => {
  const trigger = e.target.closest('[aria-haspopup="dialog"][aria-controls]');
  if (!trigger || !ROW_MENUS.includes(trigger.id) || openSheet === 'menu') return;
  toggleMenu(trigger, {keyboard: e.detail === 0});
});
// Pin buttons.
document.addEventListener('click', e => {
  const pin = e.target.closest('.pop-pin');
  if (!pin) return;
  const pop = pin.closest('.palette-pop');
  setPinned(pop, !pop.classList.contains('pinned'));
  if (!pop.classList.contains('pinned')) menuTrigger(pop)?.focus({preventScroll: true});
});
// A command item closes its menu (or the ☰ sheet) first, then runs. When the command puts the focus nowhere in
// particular, it goes back to the menu's trigger, or to ☰.
document.addEventListener(
  'click',
  e => {
    const item = e.target.closest?.('[data-close]');
    if (!item) return;
    const pop = item.closest('.menu-pop'),
      sheet = openSheet === 'menu' && $('menu-row').contains(item),
      home = sheet ? $('phone-menu') : menuTrigger(pop);
    if (sheet) closeSheet(false);
    else if (pop && !pop.classList.contains('pinned') && !pop.hidden) setMenu(pop, false);
    else return;
    // The item is hidden now, so the keyboard waits on the trigger while the command runs (a slow one, like a share
    // link, included); a command that focuses something of its own moves it on from there.
    if (item === document.activeElement || item.contains(document.activeElement)) home?.focus({preventScroll: true});
    setTimeout(() => {
      const at = document.activeElement;
      if (!at || at === document.body || at === item || !shownEl(at)) home?.focus({preventScroll: true});
    });
  },
  true
);
// A press outside closes the open menu. The notation popovers stay open for presses on the score and its boxes.
document.addEventListener(
  'pointerdown',
  e => {
    if (!openPop) return;
    const trigger = menuTrigger(openPop);
    if (openPop.contains(e.target) || trigger?.contains(e.target)) return;
    if (isPalettePop(openPop) && e.target.closest?.(SCORE_AREA)) return;
    // A key change waiting for Transpose notes or Keep notes keeps its menu open.
    if (pendingChoice(openPop)) return;
    closeMenus();
  },
  true
);
// Focus that leaves a first-row menu and its trigger closes it (Tab past its end, a click into a field elsewhere).
$('menu-row').addEventListener('focusout', e => {
  if (!openPop || isPalettePop(openPop) || !e.relatedTarget) return;
  const trigger = menuTrigger(openPop);
  if (!openPop.contains(e.relatedTarget) && !trigger.contains(e.relatedTarget) && !pendingChoice(openPop)) closeMenus();
});
// The shortcut sheet and the note menu close every menu when they open.
if (typeof MutationObserver === 'function')
  for (const id of ['shortcuts', 'note-menu'])
    new MutationObserver(() => {
      if (!$(id).hidden) {
        closeMenus();
        if (openSheet === 'menu') closeSheet(false);
      }
    }).observe($(id), {attributes: true, attributeFilter: ['hidden']});
// A chord, lyric or comment box over the score closes the Notes sheet, so the sheet never covers it.
if (typeof MutationObserver === 'function')
  for (const id of ['chord-entry', 'lyric-entry', 'mark-box'])
    new MutationObserver(() => {
      if (!$(id).hidden && openSheet === 'notes') closeSheet(false);
    }).observe($(id), {attributes: true, attributeFilter: ['hidden']});

// Keyboard. Escape does one thing a press: the boxes, dialogs, key choices and Transpose handle their own first; then
// an open menu closes (the focus goes to its trigger, or stays on the score); then a phone sheet; then a dock panel,
// the Practice band or the ABC source with the focus inside (their own handlers); and last the score clears its
// selection.
const OWN_ESCAPE =
  '#chord-entry, #lyric-entry, #mark-box, #note-menu, #shortcuts, #key-choice, #measure-key-choice, #transpose-panel';
function pendingChoice(pop) {
  return [...pop.querySelectorAll('#key-choice, #measure-key-choice')].some(c => !c.hidden);
}
window.addEventListener(
  'keydown',
  e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (e.target.closest?.(OWN_ESCAPE)) return;
    if (!$('note-menu').hidden || !$('shortcuts').hidden) return;
    if (openPop) {
      if (pendingChoice(openPop) && openPop.contains(e.target)) return;
      const inside = openPop.contains(document.activeElement),
        trigger = menuTrigger(openPop);
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      if (inside) trigger.focus({preventScroll: true});
      return;
    }
    if (openSheet) {
      e.preventDefault();
      e.stopPropagation();
      const sheet = openSheet;
      closeSheet(false);
      (sheet === 'menu' ? $('phone-menu') : $('menu-notes')).focus({preventScroll: true});
    }
  },
  true
);
// Arrow keys: along the first row (opening the next menu when one was open), and through a menu's items. Text
// fields, number fields, sliders, selects and radio buttons keep their own arrow keys.
const OWN_ARROWS = 'input:not([type="checkbox"]):not([type="button"]), select, textarea';
function rowButtons() {
  return [...$('menu-row').querySelectorAll(':scope > .menu-wrap > button, :scope > button')].filter(shownEl);
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || openSheet === 'menu') return;
  const at = e.target;
  if (!(at instanceof Element)) return;
  // A trigger: ArrowDown opens its menu and moves into it.
  if (e.key === 'ArrowDown' && at.matches('[aria-haspopup="dialog"][aria-controls]') && allMenus().includes(at)) {
    e.preventDefault();
    e.stopPropagation();
    const pop = menuPop(at);
    if (pop.hidden) toggleMenu(at, {keyboard: true});
    else firstItem(openSheet === 'notes' ? $('palette-pops') : pop)?.focus({preventScroll: true});
    return;
  }
  // The first row: ArrowLeft and ArrowRight move between its buttons, wrapping.
  const row = rowButtons();
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && row.includes(at)) {
    e.preventDefault();
    const next = row[(row.indexOf(at) + (e.key === 'ArrowRight' ? 1 : -1) + row.length) % row.length],
      wasOpen = !!openPop && !isPalettePop(openPop);
    if (wasOpen) closeMenus();
    next.focus();
    if (wasOpen && ROW_MENUS.includes(next.id)) setMenu(menuPop(next), true);
    return;
  }
  // Inside a menu.
  const pop = at.closest('.menu-pop');
  if (!pop || at.matches(OWN_ARROWS)) return;
  const keys = isPalettePop(pop)
    ? {ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1}
    : {ArrowDown: 1, ArrowUp: -1};
  const items = menuItems(pop),
    i = items.indexOf(at);
  let to = null;
  if (e.key in keys) to = i < 0 ? 0 : (i + keys[e.key] + items.length) % items.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = items.length - 1;
  if (to == null || !items.length) return;
  e.preventDefault();
  e.stopPropagation();
  items[to].focus();
});
// The ☰ sheet is modal: Tab and Shift+Tab stay inside it, in the order the sections are shown: the header (✕ and the
// section buttons), Save, Edit, Score, Sound, View, Share, then All shortcuts. The order comes from the sections' CSS
// order and the DOM inside each, not from where things are on screen, which the sticky header changes as it scrolls.
function sheetStops() {
  return [...$('menu-row').children]
    .map((el, i) => ({el, i, order: parseFloat(getComputedStyle(el).order) || 0}))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .flatMap(({el}) => (el.matches(FOCUSABLE) ? [el] : [...el.querySelectorAll(FOCUSABLE)]))
    .filter(el => shownEl(el) && el.tabIndex >= 0);
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || openSheet !== 'menu') return;
  const stops = sheetStops(),
    i = stops.indexOf(document.activeElement);
  if (!stops.length) return;
  e.preventDefault();
  const next = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
  stops[next].focus();
});
document.addEventListener('focusin', e => {
  if (openSheet === 'menu' && !$('menu-row').contains(e.target) && $('shortcuts').hidden)
    $('save').focus({preventScroll: true});
});

// The open popover follows its trigger when the window changes size; a phone-width window closes the menus, and a
// wider one closes the sheets.
window.addEventListener('resize', () => {
  if (openPop) placeMenu(openPop, menuTrigger(openPop));
  keepNoteAboveSheet();
  padSheets();
});
// Crossing the phone width with the focus in a menu or a sheet that closes hands it to what holds that control now:
// the menu's trigger, ☰ or Notes (focusHome), never to the page.
// The browser may already have dropped the focus from a control the new layout hides, so the last focused one counts.
let lastFocus = null;
document.addEventListener('focusin', e => (lastFocus = e.target));
window.matchMedia?.('(max-width: 720px)').addEventListener?.('change', e => {
  const at = !document.activeElement || document.activeElement === document.body ? lastFocus : document.activeElement,
    held =
      at &&
      ((openPop && openPop.contains(at)) ||
        (openSheet === 'menu' && $('menu-row').contains(at)) ||
        (openSheet === 'notes' && $('palette-pops').contains(at)));
  if (e.matches) closeMenus();
  else if (openSheet) closeSheet(false);
  for (const pop of document.querySelectorAll('.palette-pop'))
    if (!e.matches && panelState()['pin:' + pop.id.replace('palette-', '')] === true) setPinned(pop, true, false);
  if (held && !shownEl(at)) focusHome(at);
});

// Where the bar sticks to the top of the window, the page scrolls things into view below it (scroll-padding-top),
// and the ABC source sticks under it; --bar-height is its height then, and 0 where it scrolls away.
// The toolbar sits beside the transport, so a pinned row reaches back under the transport by --palette-indent to span
// the whole tool row (0 when the toolbar starts its own line).
function measureBar() {
  const sticky = getComputedStyle($('app-bar')).position === 'sticky';
  document.documentElement.style.setProperty('--bar-height', `${sticky ? $('app-bar').offsetHeight : 0}px`);
  const palette = $('palette').getBoundingClientRect(),
    transport = document.querySelector('.tool-row > .transport')?.getBoundingClientRect(),
    beside = transport && !phoneLayout() && palette.top < transport.bottom && palette.left > transport.left;
  $('palette').style.setProperty('--palette-indent', `${beside ? Math.round(palette.left - transport.left) : 0}px`);
}
if (typeof ResizeObserver === 'function') new ResizeObserver(measureBar).observe($('app-bar'));
window.addEventListener('resize', measureBar);
// Focus home: where the keyboard goes when a panel closes. Its opener when that is shown; otherwise the shown trigger
// of the closed menu or fold that holds it (or ☰ on a phone). It never focuses a hidden element.
function focusHome(id) {
  const el = typeof id === 'string' ? $(id) : id;
  if (!el) return null;
  const candidates = [el];
  const pop = el.closest('.menu-pop');
  if (pop) candidates.push(menuTrigger(pop));
  if (el.closest('#practice-panel')) candidates.push($('practice-toggle'));
  if (el.closest('#write-notes')) candidates.push($('write-toggle'), $('view-toggle'));
  if (el.closest('#palette-pops')) candidates.push($('menu-notes'));
  candidates.push($('phone-menu'));
  const to = candidates.find(c => shownEl(c));
  to?.focus({preventScroll: true});
  return to || null;
}
// Where a control is, for the status line's hints: ✎ Draw notes on a blank sheet, else in Edit (☰ on a phone); and
// ＋ 4 bars in Measure (the Notes sheet on a phone).
function drawNotesPlace() {
  if (shownEl($('draw-chip'))) return '✎ Draw notes';
  return phoneLayout() ? '☰ ▸ Draw notes' : 'Edit ▸ Draw notes';
}
const addBarsPlace = () => (phoneLayout() ? 'Notes ▸ ＋ 4 bars at end' : 'Measure ▸ ＋ 4 bars at end');
// revealControl: opens whatever hides el (a menu, the Practice band, the ABC source, or a phone sheet) and says
// whether el is now on screen. revealFold (app.js) is the same.
function revealControl(el) {
  if (!el) return false;
  if (shownEl(el)) return true;
  if (el.closest('#practice-panel') && typeof setFold === 'function') setFold('practice-panel', true);
  if (el.closest('#write-notes') && typeof setFold === 'function') setFold('write-notes', true);
  const pop = el.closest('.menu-pop');
  if (pop && pop.hidden) {
    if ($('menu-row').contains(pop) && phoneLayout()) openMenuSheet();
    else if (isPalettePop(pop) && phoneLayout()) openNotesSheet();
    else setMenu(pop, true);
  }
  // The ☰ sheet shows its own control when the menu row is folded away on a phone.
  if (!shownEl(el) && $('menu-row').contains(el) && phoneLayout() && openSheet !== 'menu') openMenuSheet();
  if (!shownEl(el)) el.closest('details:not([open])')?.setAttribute('open', '');
  return shownEl(el);
}

// The state on a trigger: a badge on its corner, and the words in its accessible name.
function markTrigger(button, on, words) {
  if (!button) return;
  button.classList.toggle('in-use', !!on);
  const state = button.querySelector('.disclose-state');
  if (state) state.textContent = on ? ` (${words})` : '';
}
function updateMenuBadges() {
  const edit = [
    ['draw-mode', 'Draw notes'],
    ['piano-toggle', 'Piano keys'],
    ['midi-toggle', 'MIDI input']
  ]
    .filter(([id]) => $(id)?.getAttribute('aria-pressed') === 'true')
    .map(([, words]) => words);
  if ($('keep-bars')?.checked && !$('keep-bars-option')?.hidden) edit.push('Keep bars full');
  markTrigger($('menu-edit'), edit.length, `${typeof listWords === 'function' ? listWords(edit) : edit.join(', ')} on`);
  markTrigger(
    $('menu-sound'),
    !$('chords').checked || (typeof mixChanged === 'function' && mixChanged()),
    'settings on'
  );
}
if (typeof MutationObserver === 'function')
  new MutationObserver(updateMenuBadges).observe($('edit-bar'), {
    attributes: true,
    attributeFilter: ['aria-pressed', 'hidden'],
    subtree: true
  });
for (const id of ['edit-bar', 'sound-menu']) $(id).addEventListener('change', updateMenuBadges);
// The mixer marks Mixer… (.mixed) whenever its settings change or reset (mixer.js), so Sound follows it.
if (typeof MutationObserver === 'function' && $('mixer-toggle'))
  new MutationObserver(updateMenuBadges).observe($('mixer-toggle'), {attributes: true, attributeFilter: ['class']});
