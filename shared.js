'use strict';
// Shared helpers: DOM lookup, HTML escaping, localStorage with graceful failure, toasts, and the chosen instrument.
const $ = id => document.getElementById(id),
  esc = s =>
    String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
// localStorage keys. The commonnote- names predate the FretFree name and stay, so saved scores and favorites still load.
const KEYS = {
  scores: 'commonnote-scores-v1',
  favorites: 'commonnote-favorites-v1',
  played: 'fretfree-played',
  fingering: 'fretfree-fingering',
  noteNames: 'fretfree-note-names',
  noteColors: 'fretfree-note-colors',
  draft: 'fretfree-draft',
  audition: 'fretfree-audition',
  zoom: 'fretfree-zoom',
  measuresPerLine: 'fretfree-measures-per-line',
  piano: 'fretfree-piano',
  concertPitch: 'fretfree-concert-pitch',
  theme: 'fretfree-theme',
  darkPaper: 'fretfree-dark-paper',
  practice: id => 'fretfree-practice-' + id
};
let storageOK = true;
const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      storageOK = false;
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
};
// Stored values are checked for shape: a damaged entry must not stop the app from loading.
const storedList = key => {
  const value = storage.get(key, []);
  return Array.isArray(value) ? value : [];
};
// Theme: Auto follows the device's light or dark setting, and Light or Dark overrides it. style.css reads data-theme
// and data-paper on <html>; they are set here, as the scripts start, so the library is drawn in the chosen theme.
// Dark paper turns the score dark too, and only shows in the dark theme.
const THEMES = ['auto', 'light', 'dark'],
  storedTheme = () => {
    const theme = storage.get(KEYS.theme, 'auto');
    return THEMES.includes(theme) ? theme : 'auto';
  },
  darkScheme = (() => {
    try {
      return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    } catch {
      return null;
    }
  })(),
  themeShown = () => (storedTheme() === 'auto' ? (darkScheme?.matches ? 'dark' : 'light') : storedTheme());
function applyTheme() {
  const root = document.documentElement,
    theme = storedTheme(),
    paper = storage.get(KEYS.darkPaper, false) === true;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  if (paper) root.dataset.paper = 'dark';
  else root.removeAttribute('data-paper');
  if ($('theme')) $('theme').value = theme;
  if ($('dark-paper')) $('dark-paper').checked = paper;
  if ($('dark-paper-option')) $('dark-paper-option').hidden = themeShown() !== 'dark';
}
applyTheme();
// Auto follows the device as it switches; older Safari only has addListener.
if (darkScheme?.addEventListener) darkScheme.addEventListener('change', applyTheme);
else darkScheme?.addListener?.(applyTheme);
let saved = storedList(KEYS.scores),
  favorites = storedList(KEYS.favorites),
  played = new Set(storedList(KEYS.played));
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('toast').style.display = 'none'), 3500);
}
// The instrument chosen in the editor; its clef, transposition and sound come from `instruments` in catalog.js.
const currentInstrument = () => $('instrument').value;
