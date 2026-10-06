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
  piano: 'fretfree-piano',
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
