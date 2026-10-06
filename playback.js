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
}
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
// Master bus: every note and click goes through one gain node that follows the Volume slider live, then a limiter
// (where the browser has one) so chords and accompaniment do not clip. Built once per audio context, on first use.
const masterBuses = new WeakMap();
function outputNode(ctx = audio) {
  let bus = masterBuses.get(ctx);
  if (bus) return bus;
  bus = ctx.createGain();
  bus.gain.value = +$('volume').value;
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
function click(time, down) {
  const osc = audio.createOscillator(),
    gain = audio.createGain(),
    level = down ? 0.5 : 0.3;
  osc.type = 'square';
  osc.frequency.value = down ? 1760 : 1320;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(level, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain);
  gain.connect(outputNode());
  osc.start(time);
  osc.stop(time + 0.06);
  osc.onended = () => (osc.done = true);
  nodes.push(osc);
}
function scheduleNotes(notes, base, instrument = currentInstrument(), into = nodes) {
  const config = instruments[instrument] || instruments.Piano,
    output = outputNode();
  for (const n of notes) {
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = config.wave;
    osc.frequency.value = 440 * 2 ** ((n.note + (config.shift === -12 ? -12 : 0) - 69) / 12);
    const start = base + n.start,
      end = start + n.duration,
      attack = Math.min(0.012, n.duration / 3);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime((0.12 * n.velocity) / 100, start + attack);
    gain.gain.setValueAtTime((0.08 * n.velocity) / 100, Math.max(start + attack, end - 0.04));
    gain.gain.linearRampToValueAtTime(0, end + 0.025);
    osc.connect(gain);
    gain.connect(output);
    osc.start(start);
    osc.stop(end + 0.03);
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
  const speed = percent / 100,
    data = playbackSlice(p.full, from, percent, p.until),
    looping = $('loop').checked || $('trainer').checked;
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
    if ($('trainer').checked) {
      $('speed').value = percent;
      $('speed-value').textContent = percent + '%';
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
async function play(resumeFrom = null, {countIn = false} = {}) {
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
    const full = parseMidi(midiBytes($('abc').value)),
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
    const until = past ? full.duration : rangeEnd(range.to, full.duration, from);
    const percent = +$('speed').value;
    if (!playbackSlice(full, from, percent, until).notes.length) {
      toast('Add some notes before playback.');
      return;
    }
    playing = true;
    $('play').textContent = '■ Playing';
    let base = audio.currentTime + 0.07;
    // Count-in: one bar of clicks at the starting tempo when starting fresh or from a chosen note, not on a speed change.
    if ((resumeFrom == null || countIn) && $('count-in').checked) {
      // Beat length at the start: the spacing of the first full-bar clicks from the starting measure onward.
      const beats = beatsPerBar(),
        grid = clickTimes(from, full.duration, full.duration),
        down = grid.findIndex((c, i) => c.down && grid[i + 1]);
      const step = (down >= 0 ? grid[down + 1].time - grid[down].time : 0.5) / (percent / 100);
      for (let k = 0; k < beats; k++) click(base + k * step, k === 0);
      $('play-status').textContent = 'Count-in…';
      base += beats * step;
    } else $('play-status').textContent = `Measures ${range.from}–${range.to} · ${percent}% speed`;
    playOrigin = from;
    playClock = base;
    playSpeed = percent / 100;
    schedulePass({full, range, start: past ? from : start, until, generation}, from, percent, base, 1);
  } catch (e) {
    stop();
    toast('Playback unavailable: ' + e.message);
  }
}
// Light up sounding notes. Score time comes from the audio clock, so speed changes and resumes stay in sync.
// abcjs timing events group notes by onset, so each note keeps its own end time; a held note stays lit while others move.
let followFrame = 0,
  noteDurations = new Map();
const nextFrame = f => (window.requestAnimationFrame ? requestAnimationFrame(f) : setTimeout(f, 16)),
  cancelFrame = id => (window.cancelAnimationFrame ? cancelAnimationFrame(id) : clearTimeout(id));
function stopFollow() {
  if (followFrame) cancelFrame(followFrame);
  followFrame = 0;
  document.querySelectorAll('#notation .abcjs-playing').forEach(el => el.classList.remove('abcjs-playing'));
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
      notes.push({start, end, els: [group].flat(2).filter(el => el?.classList)});
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
      return false;
    });
    while (next < notes.length && notes[next].start <= now) {
      const n = notes[next++];
      if (n.end <= now) continue;
      for (const el of n.els) el.classList.add('abcjs-playing');
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
