'use strict';
// Mixer: Mute, Solo, Volume and Pan for each voice of the score, the chord accompaniment and the metronome, like
// Noteflight's Mixer Parts tab. The tracks come from each render (mixerTracks in score-tools.js) and the settings
// live on the open score (current.mixer, keyed by voice id), so they save with it, travel in its share link and are
// not part of undo. Each track feeds the master bus through its own chain: a gate (0 when the track does not sound),
// its level and, where the browser has one, a stereo panner. Notes of a track that does not sound are not scheduled
// at all, so a change that lets a track sound again while the score plays restarts playback from where it is.
let mixTracks = [],
  mixShown = '';
const mixChains = new WeakMap();
const mixAudible = () => audibleTracks(mixTracks, current?.mixer);
// Values glide over a few milliseconds where the browser can, so a change during playback does not crackle.
function setLive(param, value, ctx, glide) {
  if (!param) return;
  if (glide && typeof param.setTargetAtTime === 'function') {
    param.cancelScheduledValues?.(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, 0.02);
  } else param.value = value;
}
function setChain(chain, key, ctx, glide = true) {
  const s = mixSetting(current?.mixer, key);
  setLive(chain.gate.gain, mixAudible().has(key) ? 1 : 0, ctx, glide);
  setLive(chain.level.gain, s.volume, ctx, glide);
  if (chain.pan) setLive(chain.pan.pan, s.pan, ctx, glide);
}
// A track's chain in an audio context, made on first use and kept for that context.
function mixChain(ctx, key, out = outputNode(ctx)) {
  let chains = mixChains.get(ctx);
  if (!chains) mixChains.set(ctx, (chains = new Map()));
  let chain = chains.get(key);
  if (chain) return chain;
  chain = {gate: ctx.createGain(), level: ctx.createGain(), pan: null};
  if (typeof ctx.createStereoPanner === 'function')
    try {
      chain.pan = ctx.createStereoPanner();
    } catch {}
  chain.gate.connect(chain.level);
  if (chain.pan) {
    chain.level.connect(chain.pan);
    chain.pan.connect(out);
  } else chain.level.connect(out);
  setChain(chain, key, ctx, false);
  chains.set(key, chain);
  return chain;
}
// Notes grouped by the chain they play through, as [node, notes] pairs; notes of a track that does not sound are left
// out. A note on a channel no track owns (an abcjs drum track) goes straight to the bus.
function mixRoute(notes, ctx = audio, out = outputNode(ctx)) {
  const owner = new Map(),
    audible = mixAudible(),
    groups = new Map();
  for (const t of mixTracks) for (const c of t.channels) owner.set(c, t);
  for (const n of notes) {
    const t = owner.get(n.ch ?? 0);
    if (t && !audible.has(t.key)) continue;
    const node = t ? mixChain(ctx, t.key, out).gate : out;
    if (!groups.has(node)) groups.set(node, []);
    groups.get(node).push(n);
  }
  return [...groups];
}
// Where metronome clicks go: the Metronome track's chain, or null when it is muted. The count-in has its own switch,
// so it takes the track's level and pan but plays even when the track is muted.
function mixClick(ctx = audio, out = outputNode(ctx), {countIn = false} = {}) {
  const chain = mixChain(ctx, 'metronome', out);
  return countIn ? chain.level : mixAudible().has('metronome') ? chain.gate : null;
}
const mixChanged = () => !!validMixer(current?.mixer);
// The panel. Rows are rebuilt only when the tracks change, so a render while a slider is in use keeps its focus.
const panText = pan =>
  Math.abs(pan) < 0.005 ? 'Center' : `${pan < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(pan) * 100)}%`;
function mixRow(t) {
  const row = document.createElement('div'),
    name = esc(t.name);
  row.className = 'mixer-track';
  row.dataset.key = t.key;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', t.name);
  row.innerHTML =
    `<span class="mixer-name">${name}<span class="mixer-state small"></span></span>` +
    `<span class="mixer-buttons"><button type="button" class="mixer-mute" aria-pressed="false" aria-label="Mute ${name}"` +
    `>Mute</button>` +
    (t.kind === 'metronome'
      ? ''
      : `<button type="button" class="mixer-solo" aria-pressed="false" aria-label="Solo ${name}">Solo</button>`) +
    '</span>' +
    `<label class="mixer-level"><span>Volume</span><input type="range" min="0" max="${MIX_VOLUME_MAX}" step="0.05" ` +
    `aria-label="${name} volume" /><output></output></label>` +
    (mixPan()
      ? `<label class="mixer-pan"><span>Pan</span><input type="range" min="-1" max="1" step="0.1" aria-label="${name} pan" />` +
        '<output></output></label>'
      : '');
  return row;
}
// Pan needs a StereoPannerNode; browsers without one get no Pan sliders.
function mixPan() {
  const Context = window.AudioContext || window.webkitAudioContext;
  return typeof Context?.prototype?.createStereoPanner === 'function';
}
function drawMixer() {
  const list = $('mixer-tracks'),
    shape = mixTracks.map(t => t.key + '=' + t.name).join('\n');
  if (shape !== mixShown || list.children.length !== mixTracks.length) {
    mixShown = shape;
    list.replaceChildren(...mixTracks.map(mixRow));
  }
  const audible = mixAudible();
  for (const row of list.children) {
    const t = mixTracks.find(x => x.key === row.dataset.key),
      s = mixSetting(current?.mixer, t.key),
      off =
        (t.kind === 'metronome' && !$('metronome').checked) || (t.kind === 'chords' && $('chords')?.checked === false);
    row.querySelector('.mixer-mute').setAttribute('aria-pressed', s.mute);
    row.querySelector('.mixer-solo')?.setAttribute('aria-pressed', s.solo);
    const level = row.querySelector('.mixer-level input'),
      pan = row.querySelector('.mixer-pan input');
    level.value = s.volume;
    level.setAttribute('aria-valuetext', Math.round(s.volume * 100) + '%');
    level.nextElementSibling.textContent = Math.round(s.volume * 100) + '%';
    if (pan) {
      pan.value = s.pan;
      pan.setAttribute('aria-valuetext', panText(s.pan));
      pan.nextElementSibling.textContent = panText(s.pan);
    }
    const state = s.mute ? 'Muted' : !audible.has(t.key) ? 'Silent: Solo is on' : off ? `${t.name} is off` : '';
    row.querySelector('.mixer-state').textContent = state ? ' · ' + state : '';
    row.classList.toggle('silent', !!state);
  }
  $('mixer-toggle').classList.toggle('mixed', mixChanged());
  $('mixer-reset').disabled = !mixChanged();
  $('mixer-note').textContent = savedId
    ? 'The mix is saved with this score and its share links.'
    : 'The mix is kept with the score when you save it, and goes in its share links.';
}
// The render hook: this render's tracks, and the live chains brought up to date.
function updateMixer(tune) {
  mixTracks = mixerTracks(tune, renderedSource);
  applyMix();
  if (!$('mixer-panel').hidden) drawMixer();
  else $('mixer-toggle').classList.toggle('mixed', mixChanged());
}
function applyMix(glide = true) {
  const chains = audio && mixChains.get(audio);
  if (chains) for (const [key, chain] of chains) setChain(chain, key, audio, glide);
}
// A saved score keeps its mix straight away, without a new version in its History; other scores keep it on Save.
function storeMix() {
  const entry = savedId && saved.find(x => x.id === savedId);
  if (!entry) return;
  const {mixer, ...rest} = entry,
    mix = validMixer(current?.mixer),
    next = saved.map(x => (x === entry ? {...rest, ...(mix ? {mixer: mix} : {})} : x));
  if (storeScores(next)) saved = next;
}
// One change to the mix: applied live, drawn, and stored on change (a slider stores when it is let go).
function changeMix(key, patch, store = true) {
  if (!current) return;
  const before = mixAudible(),
    mix = validMixer({...(current.mixer || {}), [key]: {...mixSetting(current.mixer, key), ...patch}});
  if (mix) current.mixer = mix;
  else delete current.mixer;
  applyMix();
  drawMixer();
  updateWavSummary();
  if (store) {
    storeMix();
    scheduleDraft();
  }
  resumeMix(before);
}
// Playback carries on from where it is when a track that was left out of it can now be heard.
function resumeMix(before) {
  const position = playPosition();
  if (position != null && [...mixAudible()].some(k => !before.has(k))) {
    stop();
    play(position);
  }
}
function toggleMixer(open) {
  $('mixer-panel').hidden = !open;
  $('mixer-toggle').setAttribute('aria-expanded', open);
  if (open) {
    drawMixer();
    $('mixer-panel').scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
    $('mixer-panel').querySelector('.mixer-mute')?.focus({preventScroll: true});
  }
}
$('mixer-toggle').onclick = () => toggleMixer($('mixer-panel').hidden);
$('mixer-close').onclick = () => {
  toggleMixer(false);
  $('mixer-toggle').focus();
};
$('mixer-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  toggleMixer(false);
  $('mixer-toggle').focus();
});
$('mixer-reset').onclick = () => {
  if (!current) return;
  const before = mixAudible();
  delete current.mixer;
  applyMix();
  drawMixer();
  updateWavSummary();
  storeMix();
  resumeMix(before);
  $('mixer-tracks').querySelector('.mixer-mute')?.focus();
};
$('mixer-tracks').addEventListener('click', e => {
  const button = e.target.closest('button'),
    key = button?.closest('.mixer-track')?.dataset.key;
  if (!key) return;
  const s = mixSetting(current?.mixer, key);
  if (button.classList.contains('mixer-mute')) changeMix(key, {mute: !s.mute});
  else if (button.classList.contains('mixer-solo')) changeMix(key, {solo: !s.solo});
});
// Sliders apply as they move and store when let go.
for (const [type, store] of [
  ['input', false],
  ['change', true]
])
  $('mixer-tracks').addEventListener(type, e => {
    const input = e.target.closest('input[type=range]'),
      key = input?.closest('.mixer-track')?.dataset.key;
    if (!key) return;
    changeMix(key, input.closest('.mixer-pan') ? {pan: +input.value} : {volume: +input.value}, store);
  });
// The Metronome and Chords switches say on their rows when they are off.
for (const id of ['metronome', 'chords'])
  $(id)?.addEventListener('change', () => {
    if (!$('mixer-panel').hidden) drawMixer();
  });
