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
  }
};
let saved = storage.get(KEYS.scores, []),
  favorites = storage.get(KEYS.favorites, []),
  played = new Set(storage.get(KEYS.played, []));
if (!Array.isArray(saved)) saved = [];
if (!Array.isArray(favorites)) favorites = [];
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('toast').style.display = 'none'), 3500);
}
// The instrument chosen in the editor; its clef, transposition and sound come from `instruments` in catalog.js.
const currentInstrument = () => $('instrument').value;
