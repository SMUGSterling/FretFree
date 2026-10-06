'use strict';
// Playback: Web Audio scheduling of the practice range, loop, count-in, metronome, speed trainer,
// the moving note highlight, play from a note, the master volume bus and note audition.
let audio = null,
  playing = false,
  nodes = [],
  playGeneration = 0,
  playOrigin = 0,
  playClock = 0,
  playSpeed = 1;
// Practice playback: plays a measure range, optionally looped, with count-in, metronome and a speed trainer.
// Each pass is scheduled on the audio clock just before the previous one ends, so loops are gapless.
let playTimers = [];
function stop() {
  playing = false;
  playGeneration++;
  playTimers.forEach(clearTimeout);
  playTimers = [];
  stopFollow();
  for (const node of nodes) {
    try {
      node.stop();
    } catch {}
  }
  nodes = [];
  $('play').textContent = '▶ Play';
  $('play-status').textContent = 'Ready to play';
  // A recording ends with the playback it follows, and a take playing with the score stops with it.
  if (typeof takeStopped === 'function') takeStopped();
}
// Where playback is, in score seconds, so a speed change or the Chords switch can carry on from there.
const playPosition = () => (playing ? playOrigin + Math.max(0, audio.currentTime - playClock) * playSpeed : null);
const atAudioTime = (time, fn) => playTimers.push(setTimeout(fn, Math.max(0, (time - audio.currentTime) * 1000)));
function measureRange() {
  const total = +$('start-measure').max || 1,
    clamp = v => Math.max(1, Math.min(total, Math.round(v) || 1));
  const from = clamp(+$('start-measure').value),
    to = Math.max(from, clamp(+$('end-measure').value || total));
  return {from, to, total};
}
// Score seconds where the range ends: the first performance of the next measure, or the end of the tune.
function rangeEnd(to, duration, from = -Infinity) {
  const later = [...measureStarts].filter(([m, t]) => m > to && t > from).map(([, t]) => t);
  return later.length ? Math.min(...later) : duration;
}
// Beats per bar: compound meters (6/8, 9/8, 12/8) count dotted beats.
function beatsPerBar() {
  const [n, d] = meterParts();
  return d === 8 && n > 3 && n % 3 === 0 ? n / 3 : n;
}
// Written length of each measure in whole notes: the longest voice, so pickups and short final bars are measured, not assumed.
function measureLengths() {
  const sums = new Map(),
    events = [...new Set(noteSources.values())].filter(Boolean),
    durations = effectiveDurations(events);
  for (const e of events) {
    if (e.element.el_type !== 'note') continue;
    const key = e.measure + '|' + e.key.split(':').slice(0, 2).join(':');
    sums.set(key, (sums.get(key) || 0) + durations.get(e.element));
  }
  const lengths = new Map();
  for (const [key, sum] of sums) {
    const m = +key.split('|')[0];
    lengths.set(m, Math.max(lengths.get(m) || 0, sum));
  }
  return lengths;
}
// Metronome clicks in score seconds. Each bar's clicks are spaced from that bar's real start and end, so they follow
// repeats and tempo changes at barlines; a pickup bar is aligned to its end.
function clickTimes(from, until, end = until) {
  const beats = beatsPerBar(),
    bar = renderedTune?.getBarLength?.() || 1,
    beat = bar / beats,
    lengths = measureLengths(),
    out = [];
  const starts = (renderedTune?.noteTimings || []).filter(e => e.type === 'event' && e.measureStart);
  for (const [i, e] of starts.entries()) {
    const t = e.milliseconds / 1000,
      next = starts[i + 1] ? starts[i + 1].milliseconds / 1000 : end;
    const measure = (e.startCharArray || []).map(c => noteSources.get(c)?.measure).find(Boolean);
    const length = lengths.get(measure) || bar,
      secondsPerWhole = (next - t) / length,
      pickup = i === 0 && length < bar - 1e-9;
    for (let k = 0; k < beats; k++) {
      const p = pickup ? length - (beats - k) * beat : k * beat;
      if (p < -1e-9 || p >= length - 1e-9) continue;
      const c = t + p * secondsPerWhole;
      if (c >= from - 1e-6 && c < until - 1e-6) out.push({time: c, down: k === 0 && !pickup});
    }
  }
  return out;
}
// Swing grid for playback, in the decoded MIDI's seconds: each measure as played, with its quarter-note length from its
// real start and end, so swing follows repeats and tempo changes. Only x/4 and x/2 meters swing. The note timings and
// the MIDI share one tempo (settleTempo), so scale is 1 to within MIDI's whole microseconds; abcjs's note timings are
// whole milliseconds, so each measure start is then moved onto the MIDI note that starts there, if one does.
function swingBars(midi) {
  if (![2, 4].includes(meterParts()[1])) return [];
  const bar = renderedTune?.getBarLength?.() || 1,
    perQuarter = (renderedTune?.millisecondsPerMeasure?.() || 0) / 1000 / bar / 4,
    scale = perQuarter > 0 && midi.quarter > 0 ? midi.quarter / perQuarter : 1,
    onsets = [...new Set(midi.notes.map(n => n.start))].sort((a, b) => a - b),
    lengths = measureLengths(),
    timings = renderedTune?.noteTimings || [],
    starts = timings.filter(e => e.type === 'event' && e.measureStart),
    end = timings.find(e => e.type === 'end');
  if (!starts.length) return [];
  const sizes = starts.map(
      e => lengths.get((e.startCharArray || []).map(c => noteSources.get(c)?.measure).find(Boolean)) || bar
    ),
    marks = starts
      .map(e => (e.milliseconds / 1000) * scale)
      .concat(end ? (end.milliseconds / 1000) * scale : midi.duration);
  // MIDI ticks round each step, so a measure can drift from its timing by a few ticks; the drift found at one measure
  // carries to the next. A measure starts on a MIDI note within a 64th note of where it should, and the tune ends
  // where the MIDI does if that is as close.
  let drift = 0,
    k = 0;
  const times = marks.map((mark, i) => {
    const t = mark + drift,
      j = Math.min(i, sizes.length - 1),
      window = (marks[j + 1] - marks[j]) / sizes[j] / 64;
    while (k + 1 < onsets.length && onsets[k + 1] <= t) k++;
    const hit = (i < sizes.length ? onsets.slice(k, k + 2) : [midi.duration]).reduce(
      (best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best),
      Infinity
    );
    if (!(Math.abs(hit - t) < window)) return t;
    drift += hit - t;
    return hit;
  });
  const short = i => sizes[i] < bar - 1e-9;
  return starts.map((e, i) => {
    // A pickup, at the start or after a short measure that it completes (at a repeat or a new section), ends on the beat.
    const pickup = short(i) && (i === 0 || (short(i - 1) && Math.abs(sizes[i - 1] + sizes[i] - bar) < 1e-9));
    return {
      time: times[i],
      quarter: (times[i + 1] - times[i]) / sizes[i] / 4,
      origin: pickup ? times[i + 1] : times[i]
    };
  });
}
// Master bus: every note and click goes through one gain node that follows the Volume slider live, then a limiter
// (where the browser has one) so chords and accompaniment do not clip. Built once per audio context, on first use; an
// audio export builds its own at full level.
const masterBuses = new WeakMap();
function outputNode(ctx = audio, volume = +$('volume').value) {
  let bus = masterBuses.get(ctx);
  if (bus) return bus;
  bus = ctx.createGain();
  bus.gain.value = volume;
  let out = bus;
  if (typeof ctx.createDynamicsCompressor === 'function') {
    out = ctx.createDynamicsCompressor();
    for (const [name, value] of Object.entries({threshold: -6, knee: 4, ratio: 20, attack: 0.003, release: 0.2}))
      if (out[name]) out[name].value = value;
    bus.connect(out);
  }
  out.connect(ctx.destination);
  masterBuses.set(ctx, bus);
  return bus;
}
// Volume changes glide over a few milliseconds, so moving the slider during playback does not crackle.
function updateVolume() {
  const bus = audio && masterBuses.get(audio),
    volume = +$('volume').value;
  if (!bus) return;
  if (typeof bus.gain.setTargetAtTime === 'function') {
    bus.gain.cancelScheduledValues?.(audio.currentTime);
    bus.gain.setTargetAtTime(volume, audio.currentTime, 0.02);
  } else bus.gain.value = volume;
}
function click(time, down, ctx = audio, out = outputNode(ctx), into = nodes) {
  const osc = ctx.createOscillator(),
    gain = ctx.createGain(),
    level = down ? 0.5 : 0.3;
  osc.type = 'square';
  osc.frequency.value = down ? 1760 : 1320;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(level, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain);
  gain.connect(out);
  osc.start(time);
  osc.stop(time + 0.06);
  osc.onended = () => (osc.done = true);
  into.push(osc);
}
// Each instrument's partials (catalog.js) as a periodic wave, made once per audio context. Without
// createPeriodicWave (or if it fails) the instrument falls back to its basic `wave`.
const periodicWaves = new WeakMap();
function instrumentWave(ctx, name, config) {
  if (!config.partials || typeof ctx.createPeriodicWave !== 'function') return null;
  let waves = periodicWaves.get(ctx);
  if (!waves) periodicWaves.set(ctx, (waves = new Map()));
  if (!waves.has(name))
    try {
      waves.set(
        name,
        ctx.createPeriodicWave(new Float32Array(config.partials.length + 1), Float32Array.from([0, ...config.partials]))
      );
    } catch {
      waves.set(name, null);
    }
  return waves.get(name);
}
// One oscillator and one gain per note: the instrument's wave, its octave (instrumentSound), its envelope and, where
// the browser can automate detune, its vibrato. ctx and out are the live context and its master bus unless an export
// renders offline.
function scheduleNotes(
  notes,
  base,
  instrument = currentInstrument(),
  into = nodes,
  ctx = audio,
  out = outputNode(ctx)
) {
  if (!instruments[instrument]) instrument = 'Piano';
  const config = instruments[instrument],
    wave = instrumentWave(ctx, instrument, config),
    octave = instrumentSound(config);
  for (const n of notes) {
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = config.wave;
    osc.frequency.value = 440 * 2 ** ((n.note + octave - 69) / 12);
    const start = base + n.start,
      envelope = noteEnvelope(config.env, start, n.duration, (0.12 * n.velocity) / 100);
    for (const [kind, level, time] of envelope.steps)
      if (kind === 'set') gain.gain.setValueAtTime(level, time);
      else if (kind === 'exp') gain.gain.exponentialRampToValueAtTime(level, time);
      else gain.gain.linearRampToValueAtTime(level, time);
    const vibrato = vibratoCurve(config.vibrato, n.duration);
    if (vibrato && typeof osc.detune?.setValueCurveAtTime === 'function')
      try {
        osc.detune.setValueCurveAtTime(Float32Array.from(vibrato.values), start + vibrato.start, vibrato.length);
      } catch {}
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(envelope.stop);
    osc.onended = () => (osc.done = true);
    into.push(osc);
  }
}
// Note audition: a short note when the student enters, selects or moves a note (Hear notes), in the chosen
// instrument's sound and octave. It keeps its own node list, so the render() after an edit (which stops playback)
// does not cut it off, and it stays silent while the score is playing.
const AUDITION_SECONDS = 0.35;
let auditionNodes = [];
function auditionPitches(midis) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (playing || !midis?.length || $('audition')?.checked === false || !Context) return false;
  try {
    audio ||= new Context();
    audio.resume?.()?.catch?.(() => {});
    auditionNodes = auditionNodes.filter(n => !n.done);
    const notes = midis.map(note => ({note, start: 0, duration: AUDITION_SECONDS, velocity: 80}));
    scheduleNotes(notes, audio.currentTime + 0.02, currentInstrument(), auditionNodes);
    return true;
  } catch {
    return false;
  }
}
function schedulePass(p, from, percent, base, pass) {
  // A note that ends by from as written stays out, even if swing lengthened it past from: playing from a swung
  // off-beat starts with that note, not a blip of the one before it.
  const speed = percent / 100,
    notes = p.full.notes.filter(n => !(n.straightEnd <= from + SLICE_EDGE)),
    data = playbackSlice({...p.full, notes}, from, percent, p.until),
    looping = !p.once && ($('loop').checked || $('trainer').checked);
  scheduleNotes(data.notes, base);
  if ($('metronome').checked)
    for (const c of clickTimes(from, p.until, p.full.duration)) click(base + (c.time - from) / speed, c.down);
  atAudioTime(base, () => {
    if (p.generation !== playGeneration) return;
    playOrigin = from;
    playClock = base;
    playSpeed = speed;
    nodes = nodes.filter(n => !n.done);
    startFollow(p.generation);
    if (looping && $('trainer').checked) {
      $('speed').value = percent;
      $('speed-value').textContent = percent + '%';
      if (typeof updateWavSummary === 'function') updateWavSummary();
    }
    $('play-status').textContent =
      `Measures ${p.range.from}–${p.range.to} · ${percent}% speed` + (looping ? ` · loop ${pass}` : '');
  });
  const end = base + (p.until - from) / speed;
  if (looping)
    atAudioTime(Math.max(base, end - 0.25), () => {
      if (p.generation !== playGeneration) return;
      // Speed trainer: raise the tempo after each pass until it reaches the goal.
      let next = percent;
      if ($('trainer').checked)
        next = Math.min(Math.max(percent, trainerGoal()), percent + (+$('trainer-step').value || 5));
      schedulePass(p, p.start, next, end, pass + 1);
    });
  else
    atAudioTime(end + 0.12, () => {
      if (p.generation === playGeneration) stop();
    });
}
// Options for recording and takes: countInBars counts in that many bars whatever the Count-in box says, once plays the
// range a single time (no loop or trainer), percent and until replace the speed and the end, and onStart gets the audio
// time where score time `from` sounds.
async function play(resumeFrom = null, {countIn = false, countInBars = 0, once = false, percent, until, onStart} = {}) {
  if (playing) {
    stop();
    return;
  }
  stopPreview();
  clearTimeout(renderTimer);
  render();
  const generation = ++playGeneration;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
    if (generation !== playGeneration) return;
    // Swing moves note times only; measure starts, clicks and the note highlight keep the written beat.
    const midi = parseMidi(midiBytes($('abc').value, {chordsOff: $('chords')?.checked === false})),
      full = swingPlayback(midi, swingAmount($('abc').value), swingBars(midi)),
      range = measureRange(),
      start = measureStarts.get(range.from);
    const from = resumeFrom ?? start;
    if (from == null) {
      toast('This measure has no playback event. Check the ABC notation.');
      return;
    }
    // Playing from a note after the practice range runs to the end of the tune.
    // A start inside the range ends at the range's end; a start past it plays to the end of the tune, and loops from there.
    const rangeStop = start == null ? full.duration : rangeEnd(range.to, full.duration, start),
      past = from >= rangeStop - 1e-6;
    until = Math.min(until ?? (past ? full.duration : rangeEnd(range.to, full.duration, from)), full.duration);
    percent ??= +$('speed').value;
    if (!playbackSlice(full, from, percent, until).notes.length) {
      toast('Add some notes before playback.');
      return;
    }
    playing = true;
    $('play').textContent = '■ Playing';
    let base = audio.currentTime + 0.07;
    // Count-in: one bar of clicks at the starting tempo when starting fresh or from a chosen note, not on a speed change.
    // A recording asks for its own number of bars.
    if (countInBars > 0 || ((resumeFrom == null || countIn) && $('count-in').checked)) {
      // Beat length at the start: the spacing of the first full-bar clicks from the starting measure onward.
      const beats = beatsPerBar(),
        bars = Math.max(1, Math.round(countInBars) || 1),
        grid = clickTimes(from, full.duration, full.duration),
        down = grid.findIndex((c, i) => c.down && grid[i + 1]);
      const step = (down >= 0 ? grid[down + 1].time - grid[down].time : 0.5) / (percent / 100);
      for (let k = 0; k < beats * bars; k++) click(base + k * step, k % beats === 0);
      const counting = left => (bars > 1 ? `Count-in: ${left} ${left === 1 ? 'bar' : 'bars'} to go…` : 'Count-in…');
      $('play-status').textContent = counting(bars);
      for (let b = 1; b < bars; b++)
        atAudioTime(base + b * beats * step, () => {
          if (generation === playGeneration) $('play-status').textContent = counting(bars - b);
        });
      base += beats * bars * step;
    } else $('play-status').textContent = `Measures ${range.from}–${range.to} · ${percent}% speed`;
    playOrigin = from;
    playClock = base;
    playSpeed = percent / 100;
    schedulePass({full, range, start: past ? from : start, until, generation, once}, from, percent, base, 1);
    onStart?.({clock: base, from, until, percent});
  } catch (e) {
    stop();
    toast('Playback unavailable: ' + e.message);
  }
}
// Audio export: the whole score as Play sounds it (instrument, swing, the Chords choice and the playback speed),
// rendered offline into a stereo WAV, with the metronome if asked and no count-in. The export's master bus is at full
// level, not the Volume slider, and the mix is scaled so its loudest sample is 1 dB under full scale. An offline render
// holds the whole recording in memory, so a score that would play for more than 10 minutes is refused before it starts;
// the refusal points to MIDI, which has no such limit.
const WAV_RATE = 44100,
  WAV_MAX_SECONDS = 600,
  WAV_TAIL = 1,
  WAV_STEP = 5;
const offlineAudio = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;
const clockTime = seconds => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// progress(done) hears how far the render has got, from 0 to 1, every WAV_STEP seconds of audio, where the browser can
// suspend an offline render. An offline render cannot be stopped, so an abort from signal cuts the export's bus off and
// stops its notes: the rest renders as silence, quickly, and nothing is scaled or encoded.
async function renderWav({metronome = false, chords = true, signal = null, progress = null} = {}) {
  const Offline = offlineAudio();
  if (!Offline) throw Error('This browser cannot make audio files.');
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const source = $('abc').value,
    midi = parseMidi(midiBytes(source, {chordsOff: !chords})),
    full = swingPlayback(midi, swingAmount(source), swingBars(midi)),
    percent = +$('speed').value,
    data = playbackSlice(full, 0, percent, full.duration);
  if (!data.notes.length) throw Error('Add some notes before making an audio file.');
  if (data.duration > WAV_MAX_SECONDS)
    throw Error(
      `At this speed the score plays for ${clockTime(data.duration)}, and an audio file can be up to 10 minutes. ` +
        ((full.duration * 100) / +$('speed').max <= WAV_MAX_SECONDS
          ? 'Choose a faster speed, or export MIDI instead.'
          : 'Export MIDI instead.')
    );
  const cancelled = () => Error('The audio file was cancelled.');
  if (signal?.aborted) throw cancelled();
  const length = Math.ceil((data.duration + WAV_TAIL) * WAV_RATE),
    ctx = new Offline(2, length, WAV_RATE),
    out = outputNode(ctx, 1),
    made = [];
  scheduleNotes(data.notes, 0, currentInstrument(), made, ctx, out);
  if (metronome)
    for (const c of clickTimes(0, full.duration, full.duration))
      click(c.time / (percent / 100), c.down, ctx, out, made);
  const resume = () => {
    try {
      ctx.resume?.()?.catch?.(() => {});
    } catch {}
  };
  if (progress && typeof ctx.suspend === 'function')
    for (let t = WAV_STEP; t < length / WAV_RATE; t += WAV_STEP)
      try {
        ctx
          .suspend(t)
          .then(() => {
            resume();
            if (!signal?.aborted) progress((t * WAV_RATE) / length);
          })
          .catch(() => {});
      } catch {}
  let cancel;
  // Older Safari finishes through oncomplete instead of a promise.
  const buffer = await new Promise((resolve, reject) => {
    cancel = () => {
      try {
        out.disconnect();
      } catch {}
      for (const node of made)
        try {
          node.stop();
        } catch {}
      resume();
      reject(cancelled());
    };
    signal?.addEventListener('abort', cancel);
    ctx.oncomplete = e => resolve(e.renderedBuffer);
    ctx.startRendering()?.then?.(resolve, reject);
  }).finally(() => signal?.removeEventListener('abort', cancel));
  if (signal?.aborted) throw cancelled();
  const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak > 0) for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= 0.89 / peak;
  return {
    bytes: wavBytes(channels, WAV_RATE, creditedWavInfo(source, current)),
    seconds: buffer.length / WAV_RATE,
    notes: data.notes.length
  };
}
// Light up sounding notes (and their keys on the on-screen piano). Score time comes from the audio clock, so speed
// changes and resumes stay in sync.
// abcjs timing events group notes by onset, so each note keeps its own end time; a held note stays lit while others move.
let followFrame = 0,
  noteDurations = new Map();
const nextFrame = f => (window.requestAnimationFrame ? requestAnimationFrame(f) : setTimeout(f, 16)),
  cancelFrame = id => (window.cancelAnimationFrame ? cancelAnimationFrame(id) : clearTimeout(id));
function stopFollow() {
  if (followFrame) cancelFrame(followFrame);
  followFrame = 0;
  document.querySelectorAll('#notation .abcjs-playing').forEach(el => el.classList.remove('abcjs-playing'));
  if (typeof pianoFollow === 'function') pianoFollow(null);
}
function startFollow(generation) {
  stopFollow();
  if (!renderedTune?.noteTimings) return;
  const bar = renderedTune.getBarLength?.() || 1,
    events = renderedTune.noteTimings.filter(e => e.type === 'event' && e.elements?.length),
    notes = [];
  for (const [i, e] of events.entries())
    for (const [j, group] of e.elements.entries()) {
      const start = e.milliseconds / 1000,
        whole = noteDurations.get(e.startCharArray?.[j]);
      const end = whole
        ? start + (whole * e.millisecondsPerMeasure) / bar / 1000
        : (events[i + 1]?.milliseconds ?? Infinity) / 1000;
      notes.push({start, end, at: e.startCharArray?.[j], els: [group].flat(2).filter(el => el?.classList)});
    }
  notes.sort((a, b) => a.start - b.start);
  let next = 0,
    active = [];
  const tick = () => {
    if (generation !== playGeneration) return;
    const now = playOrigin + Math.max(0, audio.currentTime - playClock) * playSpeed + 0.005;
    active = active.filter(n => {
      if (n.end > now) return true;
      for (const el of n.els) el.classList.remove('abcjs-playing');
      if (typeof pianoFollow === 'function') pianoFollow(n.at, false);
      return false;
    });
    while (next < notes.length && notes[next].start <= now) {
      const n = notes[next++];
      if (n.end <= now) continue;
      for (const el of n.els) el.classList.add('abcjs-playing');
      if (typeof pianoFollow === 'function') pianoFollow(n.at, true);
      active.push(n);
      const box = n.els[0]?.getBoundingClientRect();
      if (box && (box.top < 0 || box.bottom > window.innerHeight))
        n.els[0].scrollIntoView({block: 'center', behavior: 'smooth'});
    }
    followFrame = nextFrame(tick);
  };
  tick();
}
// Speed trainer starts 20 points below its goal so there is room to climb; the goal's 45% minimum keeps that within the slider.
const trainerGoal = () => Math.max(45, Math.min(200, +$('trainer-goal').value || 100));
function prepareTrainer() {
  if ($('trainer').checked && +$('speed').value >= trainerGoal()) {
    $('speed').value = trainerGoal() - 20;
    $('speed').oninput();
  }
}
// Play from a note: double-click it, press Space with it selected, or choose Play from here in its menu.
function noteStartTime(display) {
  const e = (renderedTune?.noteTimings || []).find(
    t => t.type === 'event' && (t.startCharArray || []).includes(display.startChar)
  );
  return e ? e.milliseconds / 1000 : null;
}
function playFromNote(display) {
  if (!display) return;
  stop();
  const time = noteStartTime(display);
  if (time == null) {
    toast('This note has no playback time. Check the ABC notation.');
    return;
  }
  play(time, {countIn: true});
}
// abcjs focuses the clicked note on mouse-up, which can scroll the page between the two clicks; fall back to the note
// the first click selected.
$('notation').addEventListener('dblclick', e => {
  const hit = selectableAt(e)?.absEl.abcelem,
    display = hit?.el_type === 'note' ? hit : selectedNote()?.display;
  if (display) {
    e.preventDefault();
    playFromNote(display);
  }
});
