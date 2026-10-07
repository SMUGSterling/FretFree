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
  versions: 'fretfree-versions',
  studentName: 'fretfree-student-name',
  inbox: 'fretfree-inbox',
  recordCountIn: 'fretfree-record-count-in',
  latency: 'fretfree-latency',
  attempts: 'fretfree-attempts',
  checkLevel: 'fretfree-check-level',
  checkMelody: 'fretfree-check-melody',
  markAuthor: 'fretfree-mark-author',
  // Which studio folds are open in the compact layout: a per-device layout choice, so backups leave it out.
  studioPanels: 'fretfree-studio-panels',
  practice: id => 'fretfree-practice-' + id
};
// An embedded score (#e=…, usually in an iframe on a class website) is a read-only view. It neither reads nor writes
// this browser's FretFree storage: the host page's visitors see no one's saved work, and a visit leaves nothing behind.
const embedView = /^#e=/.test(location.hash);
if (embedView) document.body.classList.add('embed');
let storageOK = true;
const storage = {
  get(key, fallback) {
    if (embedView) return fallback;
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    if (embedView) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      storageOK = false;
      return false;
    }
  },
  remove(key) {
    if (embedView) return;
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
// and data-paper on <html>. theme.js sets them from storage before the first paint; applyTheme keeps them and the
// controls in step after that. Dark paper turns the score dark too, and only shows in the dark theme.
const THEMES = ['auto', 'light', 'dark'],
  darkScheme = (() => {
    try {
      return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    } catch {
      return null;
    }
  })();
let themeChoice = 'auto',
  darkPaperChoice = false;
const themeShown = () => (themeChoice === 'auto' ? (darkScheme?.matches ? 'dark' : 'light') : themeChoice);
// Without arguments it applies the stored choice (start-up, a restored backup). The controls pass their own values, so
// a choice still applies for the session when it cannot be saved (storage full or blocked).
function applyTheme(theme = storage.get(KEYS.theme, 'auto'), paper = storage.get(KEYS.darkPaper, false)) {
  const root = document.documentElement;
  themeChoice = THEMES.includes(theme) ? theme : 'auto';
  darkPaperChoice = paper === true;
  if (themeChoice === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = themeChoice;
  if (darkPaperChoice) root.dataset.paper = 'dark';
  else root.removeAttribute('data-paper');
  if ($('theme')) $('theme').value = themeChoice;
  if ($('dark-paper')) $('dark-paper').checked = darkPaperChoice;
  if ($('dark-paper-option')) $('dark-paper-option').hidden = themeShown() !== 'dark';
}
applyTheme();
// Auto follows the device as it switches; older Safari only has addListener.
const followDevice = () => applyTheme(themeChoice, darkPaperChoice);
if (darkScheme?.addEventListener) darkScheme.addEventListener('change', followDevice);
else darkScheme?.addListener?.(followDevice);
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
