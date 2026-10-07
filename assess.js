'use strict';
// Play-along check: the student plays or sings the practice range along with the score, once, after a one-bar count-in,
// and FretFree listens through the microphone. Every 20 ms the latest samples of an AnalyserNode go through
// detectPitch, timed by the audio clock from where the score started (play's onStart) less the device's latency
// (Calibrate timing in Record yourself, or the browser's own estimate). Each melody note is marked as it passes: a
// colored bar under it, added to the score's SVG without a render, so playback carries on. The result (Pitch %,
// Rhythm %, stars and the notes to work on) stays in the panel, and each check is kept in the score's history
// (fretfree-attempts), which a turn-in link carries. Nothing is recorded or uploaded. The pitch detection, the notes
// listened for and the marking are in score-tools.js; the microphone and latency helpers are record.js's.
const CHECK_FRAME_MS = 20,
  CHECK_FFT = 2048,
  CHECK_TAIL_MS = 300,
  CHECK_HISTORY = 20,
  CHECK_SCORES = 100,
  CHECK_PROBLEMS_SHOWN = 8,
  CHECK_METER_FRAMES = 10,
  SVG_NS = 'http://www.w3.org/2000/svg';
const checkStatus = text => ($('assess-status').textContent = text);

// History: the latest checks of each score, by the score's takes key (recordKey), kept for the 100 scores checked
// most recently. Each check is read through cleanCheck, as storage can be edited.
function allChecks() {
  const value = storage.get(KEYS.attempts, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function storedChecks(key) {
  const list = allChecks()[key];
  return Array.isArray(list) ? list.map(cleanCheck).filter(Boolean) : [];
}
function addCheck(key, entry) {
  const all = allChecks();
  all[key] = [...storedChecks(key), entry].slice(-CHECK_HISTORY);
  const latest = list => Math.max(0, ...(Array.isArray(list) ? list.map(c => +c?.at || 0) : []));
  const keys = Object.keys(all)
    .sort((a, b) => latest(all[b]) - latest(all[a]))
    .slice(0, CHECK_SCORES);
  checkedHere.add(entry.at);
  return storage.set(KEYS.attempts, Object.fromEntries(keys.map(k => [k, all[k]])));
}
// The checks made since the open score was opened, by time: saving a library edition as your own copy takes only these
// with it, as with takes. A check in progress when the score is first saved is kept with the saved score.
let checkedHere = new Set();
function rekeyChecks(from, to) {
  if (!from || from === to) return;
  if (check?.key === from) check.key = to;
  const list = storedChecks(from),
    moving = from.startsWith('library:') ? list.filter(c => checkedHere.has(c.at)) : list;
  if (!moving.length) return;
  const all = allChecks(),
    staying = list.filter(c => !moving.includes(c));
  all[to] = [...storedChecks(to), ...moving].sort((a, b) => a.at - b.at).slice(-CHECK_HISTORY);
  if (staying.length) all[from] = staying;
  else delete all[from];
  storage.set(KEYS.attempts, all);
}
function deleteChecksOf(key) {
  const all = allChecks();
  if (!(key in all)) return;
  delete all[key];
  storage.set(KEYS.attempts, all);
}
// openScore calls this: the marks and result belong to the score that was open. A check still waiting for the
// microphone was for that score too, so it stops there.
function checksOpened() {
  if (check?.state === 'starting') endCheck(check, 'Another score was opened, so the check was cancelled.');
  checkedHere = new Set();
  lastCheck = null;
  showCheckResult();
  if (!$('assess-panel').hidden) showCheckHistory();
}

// Where each checked note is on the score: its timing event's box, and its measure and place in the measure in the
// first voice (the melody), counting notes, not rests. start is the note's written start in score seconds.
let notePlaces = null;
function notePlace(start) {
  if (notePlaces?.tune !== renderedTune) {
    const counts = new Map(),
      numbers = new Map();
    const melody = [...new Set(noteSources.values())]
      .filter(e => e?.element.el_type === 'note' && !e.element.rest && e.key.startsWith('0:0:'))
      .sort((a, b) => +a.key.split(':')[2] - +b.key.split(':')[2]);
    for (const e of melody) {
      const n = (counts.get(e.measure) || 0) + 1;
      counts.set(e.measure, n);
      numbers.set(e, n);
    }
    notePlaces = {tune: renderedTune, numbers};
  }
  let best = null;
  for (const e of renderedTune?.noteTimings || []) {
    if (e.type !== 'event' || e.left == null || Math.abs(e.milliseconds / 1000 - start) > 0.03) continue;
    const entry = (e.startCharArray || []).map(c => noteSources.get(c)).find(x => notePlaces.numbers.has(x));
    if (entry && (!best || Math.abs(e.milliseconds / 1000 - start) < best.off))
      best = {off: Math.abs(e.milliseconds / 1000 - start), e, entry};
  }
  if (!best) return null;
  const {e, entry} = best;
  return {
    left: e.left,
    top: e.top,
    width: e.width,
    height: e.height,
    measure: entry.measure,
    n: notePlaces.numbers.get(entry)
  };
}
// A note that a grace note delays sounds after its drawn place, so it takes the place of the event before it (its
// grace note, drawn with it).
function placesOf(events) {
  const places = events.map(e => notePlace(e.start));
  for (let i = 1; i < places.length; i++)
    if (!places[i] && places[i - 1] && events[i].start - events[i - 1].start < 0.5) places[i] = places[i - 1];
  return places;
}
const placeWords = place => (place ? `Measure ${place.measure}, note ${place.n}` : 'A note');

// Marks: a bar under each checked note, green, yellow or red (red ones taller, so they stand out without color too).
// The bars are drawn as paths in the score's SVG, up to 16 bars of a color in each: hundreds of separate shapes, or
// one path over the whole score, make each redraw slow while a long score plays. They are left out of SVG export and
// print, like the practice range shading.
const MARKS_PER_PATH = 16;
function drawMark(note, place) {
  const svg = $('notation')?.querySelector?.('svg');
  if (!svg || !place) return;
  let path = [...svg.querySelectorAll(`.assess-mark.assess-${note.mark}`)].at(-1);
  if (!path || +path.getAttribute('data-marks') >= MARKS_PER_PATH) {
    path = svg.appendChild(document.createElementNS(SVG_NS, 'path'));
    path.setAttribute('class', `assess-mark assess-${note.mark}`);
  }
  const width = Math.max(8, place.width + 2);
  path.setAttribute('data-marks', (+path.getAttribute('data-marks') || 0) + 1);
  path.setAttribute(
    'd',
    `${path.getAttribute('d') || ''}M${place.left - 1} ${place.top + place.height + 2}h${width}v${note.mark === 'red' ? 6 : 4}h${-width}z`
  );
}
function clearMarks() {
  $('notation')
    ?.querySelectorAll?.('.assess-mark')
    .forEach(el => el.remove());
}
// render() calls this: the latest check's marks come back on a fresh drawing of the same music (a zoom, a speed
// change, Play), and are left off once the music changes.
let historyKey = null;
function updateCheckMarks() {
  if (!$('assess-panel').hidden && historyKey !== recordKey()) showCheckHistory();
  if (check || !lastCheck || lastCheck.source !== $('abc').value) return;
  clearMarks();
  lastCheck.places = placesOf(lastCheck.result.notes);
  lastCheck.result.notes.forEach((note, i) => drawMark(note, lastCheck.places[i]));
}

// A check: the microphone is opened, the range plays once (with or without the melody), and the frames are marked as
// each note's time passes. It ends with the playback (at the end, ■ Stop, or anything else that stops it) plus a short
// tail for the last note.
let check = null,
  lastCheck = null;
function checkUnavailable() {
  if (!navigator.mediaDevices?.getUserMedia)
    return 'This browser can’t use a microphone here. The check needs a recent Chrome, Edge, Firefox or Safari, on a secure (https) page.';
  if (!(window.AudioContext || window.webkitAudioContext))
    return 'This browser can’t play audio, so it can’t check your playing.';
  return '';
}
async function startCheck() {
  if (check) return stopCheck();
  if (rec || calibrating) return checkStatus('Finish recording or calibrating first.');
  const problem = checkUnavailable();
  if (problem) return checkStatus(problem);
  stop();
  const ctx = audioContext();
  if (typeof ctx.createAnalyser !== 'function' || typeof ctx.createMediaStreamSource !== 'function')
    return checkStatus('This browser can’t listen to the microphone, so it can’t check your playing.');
  const level = CHECK_LEVELS[$('assess-level').value] ? $('assess-level').value : 'medium',
    melody = $('assess-melody').checked,
    session = (check = {state: 'starting', key: recordKey(), level, melody, calls: 0, ticks: 0, marked: 0});
  lastCheck = null;
  clearMarks();
  showCheckResult();
  showChecking();
  checkStatus('Allow the microphone if the browser asks.');
  try {
    session.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    if (session.cancelled) return endCheck(session);
    session.input = audio.createMediaStreamSource(session.stream);
    session.analyser = audio.createAnalyser();
    session.analyser.fftSize = CHECK_FFT;
    session.input.connect(session.analyser);
    session.buffer = new Float32Array(session.analyser.fftSize);
  } catch (e) {
    if (!session.cancelled) endCheck(session, micProblem(e));
    return;
  }
  session.latency = (storedLatency()?.ms ?? estimatedLatency(session.stream)) / 1000;
  session.timer = setInterval(() => listen(session), CHECK_FRAME_MS);
  session.range = measureRange();
  checkStatus('Count-in, then play along. Listening…');
  await play(null, {
    countInBars: 1,
    once: true,
    melodyOff: !melody,
    onStart: ({clock, from, until, percent, full}) => {
      const expected = expectedEvents(melodyNotes(full.notes), from, until, percent / 100);
      Object.assign(session, {
        state: 'live',
        clock,
        percent,
        expected,
        marker: attemptMarker(expected, CHECK_LEVELS[level]),
        places: placesOf(expected),
        source: $('abc').value
      });
    }
  });
  // Playback could not start (no notes in the range, which play() has said, or Play pressed while the microphone was
  // being asked for).
  if (session.state === 'starting' && !session.cancelled) endCheck(session, 'The check didn’t start. Try again.');
}
// One frame: the level for the meter, and once the score plays, the pitch heard, in seconds after the range started
// as the student heard it. The analyser's samples end about now, so a frame is timed at their middle. The meter shows
// the loudest of every ten frames, five times a second: redrawing it every frame makes the browser redraw the score
// too, which on a slow device and a long score leaves too little time to listen.
function listen(session) {
  if (check !== session) return;
  const analyser = session.analyser,
    samples = session.buffer;
  if (typeof analyser.getFloatTimeDomainData === 'function') analyser.getFloatTimeDomainData(samples);
  else {
    const bytes = new Uint8Array(samples.length);
    analyser.getByteTimeDomainData(bytes);
    for (let i = 0; i < bytes.length; i++) samples[i] = (bytes[i] - 128) / 128;
  }
  let energy = 0;
  for (const v of samples) energy += v * v;
  const level = Math.sqrt(energy / samples.length);
  session.loudest = Math.max(session.loudest || 0, level);
  if (++session.calls % CHECK_METER_FRAMES === 0) {
    $('assess-meter').value = Math.min(1, session.loudest * 4);
    session.loudest = 0;
  }
  if (session.state !== 'live' && session.state !== 'finishing') return;
  const t = audio.currentTime - samples.length / 2 / audio.sampleRate - session.clock - session.latency;
  if (t < -0.5) return;
  const pitch = detectPitch(samples, audio.sampleRate);
  session.marker.add({t, freq: pitch?.freq || 0, level});
  if (++session.ticks % 10 === 0) markPassed(session, t);
}
// Notes whose time (and the reach of a late start) has passed are marked while the score plays on, each once, so
// the marking keeps up at the end of a long piece. Music changed since the check started is left unmarked.
function markPassed(session, now) {
  if (session.state !== 'live') return;
  let done = session.marked;
  while (done < session.expected.length && session.expected[done].end + session.marker.reach < now) done++;
  if (done === session.marked) return;
  const notes = session.marker.mark(done);
  if (session.source === $('abc').value)
    for (let i = session.marked; i < done; i++) drawMark(notes[i], session.places[i]);
  session.marked = done;
}
// The hook stop() calls. Stopped in the count-in, before the first note, there is nothing to mark.
function checkStopped() {
  const session = check;
  if (session?.state !== 'live') return;
  if (audio.currentTime < session.clock) return endCheck(session, 'Stopped in the count-in, so nothing was checked.');
  session.state = 'finishing';
  session.stoppedAt = audio.currentTime - session.clock;
  showChecking();
  checkStatus('Marking…');
  session.tail = setTimeout(() => finishCheck(session), CHECK_TAIL_MS);
}
function stopCheck() {
  if (check?.state === 'live') stop();
  else if (check?.state === 'starting') endCheck(check, 'The check was cancelled.');
}
function endCheck(session, why = '') {
  session.cancelled = true;
  clearInterval(session.timer);
  clearTimeout(session.tail);
  try {
    session.input?.disconnect();
  } catch {}
  releaseMic(session.stream);
  $('assess-meter').value = 0;
  if (check === session) check = null;
  showChecking();
  if (why) checkStatus(why);
}
// The notes played through to their end are marked (all of them unless the check was stopped early), shown, and kept in
// the score's history. A check that heard nothing at all is not kept: the microphone is likely off or muted.
function finishCheck(session) {
  endCheck(session);
  const count = session.expected.filter(e => e.end <= session.stoppedAt + 0.1).length;
  if (!count) return checkStatus('Stopped before the first note ended, so nothing was checked.');
  const result = session.marker.result(count);
  if (!result.heard) {
    clearMarks();
    return checkStatus('FretFree heard nothing from the microphone. Check that it’s on and not muted, then try again.');
  }
  const last = session.places.slice(0, count).filter(Boolean).at(-1),
    entry = {
      at: Date.now(),
      level: session.level,
      speed: Math.round(session.percent),
      from: session.range.from,
      to: Math.max(session.range.from, last?.measure || session.range.to),
      pitch: result.pitch,
      rhythm: result.rhythm,
      stars: result.stars,
      ...(session.melody ? {melody: true} : {})
    };
  const kept = addCheck(session.key, entry);
  // The music changed (another score opened, or an edit) while the last note was marked: the check is kept with its
  // score, and the music now on screen is left unmarked.
  if (session.source !== $('abc').value || session.key !== recordKey()) {
    clearMarks();
    showCheckHistory();
    return checkStatus(
      `Checked ${count} ${count === 1 ? 'note' : 'notes'} and kept the result. The music on screen has changed since, so it isn’t marked.`
    );
  }
  lastCheck = {source: session.source, result, entry, places: session.places};
  clearMarks();
  result.notes.forEach((note, i) => drawMark(note, session.places[i]));
  showCheckResult();
  showCheckHistory();
  // An open Turn in panel counts the new check.
  if (typeof updateTurnIn === 'function') updateTurnIn();
  checkStatus(
    `Checked ${count} ${count === 1 ? 'note' : 'notes'}: ${checkWords(entry)}.` +
      (count < session.expected.length ? ' Stopped early, so only the notes played so far are marked.' : '') +
      (kept ? '' : ' This browser couldn’t keep it in the history.')
  );
}
function showChecking() {
  const live = !!check,
    busy = check?.state === 'finishing';
  $('assess-start').textContent = busy ? '● Marking…' : live ? '■ Stop check' : '● Start check';
  $('assess-start').classList.toggle('recording', live);
  if (busy) $('assess-start').setAttribute('aria-disabled', 'true');
  else $('assess-start').removeAttribute('aria-disabled');
  $('assess').classList.toggle('recording', live);
  $('assess').textContent = live ? '● Listening' : '✓ Check';
  $('assess-level').disabled = live;
  $('assess-melody').disabled = live;
}

// The result: percentages, stars and the notes to work on, in written pitch as the score shows it.
function showCheckResult() {
  const result = lastCheck?.result;
  $('assess-result').hidden = !result;
  if (!result) return;
  $('assess-pitch').textContent = result.pitch + '%';
  $('assess-rhythm').textContent = result.rhythm + '%';
  $('assess-stars').textContent = starText(result.stars);
  $('assess-stars').setAttribute('aria-label', `${result.stars} of 5 stars`);
  const problems = result.notes
    .map((note, i) => ({note, place: lastCheck.places[i]}))
    .filter(({note}) => note.mark !== 'green');
  const shown = problems
    .slice(0, CHECK_PROBLEMS_SHOWN)
    .map(
      ({note, place}) =>
        `<li class="assess-${note.mark}">${esc(placeWords(place))}: ${esc(checkProblem(note, displayShift()))}</li>`
    );
  if (problems.length > CHECK_PROBLEMS_SHOWN)
    shown.push(`<li>And ${problems.length - CHECK_PROBLEMS_SHOWN} more, marked on the score.</li>`);
  $('assess-problems').innerHTML = shown.length
    ? shown.join('')
    : '<li class="assess-green">Every note was right.</li>';
}
function showCheckHistory() {
  historyKey = recordKey();
  const list = storedChecks(historyKey).reverse();
  $('assess-history').innerHTML = list
    .map(
      c =>
        `<li><span class="small">${esc(draftTime(c.at))} · ${CHECK_LEVELS[c.level].label} · ${c.speed}% · ${c.from === c.to ? `measure ${c.from}` : `measures ${c.from}–${c.to}`}${c.melody ? ' · melody on' : ''}</span> <span>Pitch ${c.pitch}% · Rhythm ${c.rhythm}% · <span class="assess-stars" role="img" aria-label="${c.stars} of 5 stars">${starText(c.stars)}</span></span></li>`
    )
    .join('');
  $('assess-history').hidden = !list.length;
  $('assess-empty').hidden = !!list.length;
}
function toggleCheckPanel(open = $('assess-panel').hidden) {
  $('assess-panel').hidden = !open;
  $('assess').setAttribute('aria-expanded', open);
  if (!open) return;
  showCheckHistory();
  $('assess-panel').scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
  $('assess-start').focus({preventScroll: true});
}
// The melody is off unless the student turns it on: through speakers, the microphone would hear it as their playing.
function applyCheckSettings() {
  const level = storage.get(KEYS.checkLevel, 'medium');
  $('assess-level').value = CHECK_LEVELS[level] ? level : 'medium';
  $('assess-melody').checked = storage.get(KEYS.checkMelody, false) === true;
}
applyCheckSettings();
$('assess').onclick = () => toggleCheckPanel();
$('assess-close').onclick = () => {
  toggleCheckPanel(false);
  $('assess').focus();
};
$('assess-start').onclick = () => startCheck();
$('assess-level').onchange = () => storage.set(KEYS.checkLevel, $('assess-level').value);
$('assess-melody').onchange = () => storage.set(KEYS.checkMelody, $('assess-melody').checked);
$('assess-clear').onclick = () => {
  lastCheck = null;
  clearMarks();
  showCheckResult();
  checkStatus('Marks cleared.');
  $('assess-start').focus();
};
$('assess-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || check) return;
  e.stopPropagation();
  $('assess-close').click();
});
