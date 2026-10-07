'use strict';
// Record yourself: the student records the microphone while the score plays the practice range once, after a count-in,
// and the takes stay in this browser (IndexedDB), per score. A take plays alone, or with the score, lined up by where
// the score started in the recording plus the device's round-trip latency, which Calibrate measures by recording its
// own clicks. Nothing is uploaded, and takes are not in backups. The latency is not backed up either: it belongs to
// this device and its speakers. The offset, onset and file-name helpers are in score-tools.js.
const RECORDINGS_DB = 'fretfree-recordings',
  RECORD_TAIL_MS = 500,
  // Echo cancellation, noise suppression and automatic gain are for calls: they thin out and pump a played instrument.
  MIC_CONSTRAINTS = {audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}},
  TAKE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'],
  // Calibration clicks, in seconds after the first: uneven gaps, so a regular noise in the room cannot pass for them.
  CALIBRATION_CLICKS = [0, 0.7, 1.35, 2.15, 2.8, 3.65, 4.3, 5.1];

// Storage: one IndexedDB store of takes, indexed by score. Without IndexedDB (or when it fails) takes are kept for the
// session only, and the panel says so.
let takesDB = null,
  takesInMemory = false;
const memoryTakes = new Map();
function openTakes() {
  takesDB ||= new Promise(resolve => {
    if (embedView || typeof indexedDB === 'undefined') return resolve(null);
    let request;
    try {
      request = indexedDB.open(RECORDINGS_DB, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () =>
      request.result.createObjectStore('takes', {keyPath: 'id'}).createIndex('scoreKey', 'scoreKey');
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  }).then(db => {
    if (!db) takesInMemory = true;
    return db;
  });
  return takesDB;
}
async function takesRequest(mode, action) {
  const db = await openTakes();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('takes', mode),
        op = action(tx.objectStore('takes'));
      tx.oncomplete = () => resolve(op.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage failed'));
    } catch (e) {
      reject(e);
    }
  });
}
async function listTakes(key) {
  let stored = [];
  try {
    stored = (await takesRequest('readonly', s => s.index('scoreKey').getAll(key))) || [];
  } catch {}
  return [...stored, ...[...memoryTakes.values()].filter(t => t.scoreKey === key)].sort((a, b) => a.at - b.at);
}
// Returns false when the take could only be kept for this session.
async function putTake(take) {
  try {
    if (await openTakes()) {
      await takesRequest('readwrite', s => s.put(take));
      return true;
    }
  } catch {}
  memoryTakes.set(take.id, take);
  return false;
}
async function removeTake(id) {
  memoryTakes.delete(id);
  try {
    await takesRequest('readwrite', s => s.delete(id));
  } catch {}
}
// Storing a finished take and moving takes to a saved score run one after the other, so a take still being stored
// when its score is saved moves with it.
let takesTurn = Promise.resolve();
function inTurn(job) {
  const done = takesTurn.then(job);
  takesTurn = done.catch(() => {});
  return done;
}
// A score's takes follow it when it is first saved, as its key changes to its saved id: all of unsaved work's takes
// and the recording in progress, but of a library edition only the takes recorded since it was opened. The edition's
// other takes on this device (a teacher's model take, another student's) stay with the edition.
function rekeyTakes(from, to) {
  if (!from || from === to) return;
  if (rec?.key === from) rec.key = to;
  const all = !from.startsWith('library:');
  return inTurn(async () => {
    for (const take of await listTakes(from))
      if (all || recordedHere.has(take.id)) {
        memoryTakes.delete(take.id);
        await putTake({...take, scoreKey: to});
      }
    await updateTakes(true);
  });
}
// Deleting a saved score deletes its takes (app.js), and the panel can delete takes no score can reach any more.
async function deleteTakesOf(keys) {
  let count = 0;
  for (const key of keys)
    for (const take of await listTakes(key)) {
      await removeTake(take.id);
      decodedTakes.delete(take.id);
      count++;
    }
  await updateTakes(true);
  return count;
}
// Which score the takes belong to: a saved score by its id, a library score by its id. Anything else (a new, imported
// or shared score) gets an id of its own when it opens, which its unsaved-work draft keeps, so two blank sheets never
// share takes and recovered work gets its takes back.
let openedKey = null,
  // The takes recorded since the open score was opened, by id.
  recordedHere = new Set();
const newTakesKey = () =>
  'new:' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
function recordKey() {
  if (savedId) return 'saved:' + savedId;
  return (openedKey ||= newTakesKey());
}
// openScore calls takesOpened with the score that opens, and restoreDraft calls takesRestored with its draft's key.
function takesOpened(item) {
  openedKey = item?.id && typeof catalog !== 'undefined' && catalog.includes(item) ? 'library:' + item.id : null;
  recordedHere = new Set();
}
function takesRestored(key) {
  if (typeof key !== 'string' || key.length > 200 || !/^(new|library):./.test(key)) return;
  openedKey = key;
  updateTakes(true);
}
// The score of every stored take, read without the recordings: how many takes a saved score has, so deleting it can
// say so, and which takes no score here can reach (their saved score deleted, or their unsaved work closed or
// discarded, and neither kept in any draft nor open in another tab).
let storedTakeKeys = [];
async function indexTakes() {
  const keys = [...memoryTakes.values()].map(t => t.scoreKey),
    db = await openTakes();
  if (db)
    await new Promise(resolve => {
      try {
        const tx = db.transaction('takes'),
          cursor = tx.objectStore('takes').index('scoreKey').openKeyCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          keys.push(cursor.result.key);
          cursor.result.continue();
        };
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      } catch {
        resolve();
      }
    });
  storedTakeKeys = keys;
}
const takeCount = key => storedTakeKeys.filter(k => k === key).length;
// Unsaved work open in another tab may have no draft (a score opened unchanged, or a draft pushed out by newer ones).
// While a tab's open score is unsaved work with takes, the tab holds a Web Lock named for their key, which the browser
// lets go when the tab closes, so no other tab counts those takes as out of reach. It is held only then, as a held
// lock stops the browser keeping the page for Back and Forward. Without Web Locks, only drafts show what is still open.
const TAKES_LOCK = 'fretfree-takes ';
let heldTakes = null;
function holdTakes(key) {
  if ((heldTakes?.key ?? null) === key || typeof navigator.locks?.request !== 'function') return;
  heldTakes?.release();
  heldTakes = null;
  if (!key) return;
  const hold = (heldTakes = {key}),
    released = new Promise(resolve => (hold.release = resolve));
  navigator.locks.request(TAKES_LOCK + key, {mode: 'shared'}, () => released).catch(() => {});
}
async function takesOpenElsewhere() {
  try {
    const {held = [], pending = []} = (await navigator.locks?.query?.()) || {};
    return [...held, ...pending]
      .map(lock => String(lock?.name))
      .filter(name => name.startsWith(TAKES_LOCK))
      .map(name => name.slice(TAKES_LOCK.length));
  } catch {
    return [];
  }
}
let libraryKeys = null;
async function strayTakeKeys() {
  libraryKeys ||= new Set(typeof catalog === 'undefined' ? [] : catalog.map(x => 'library:' + x.id));
  const live = new Set([
    recordKey(),
    ...(typeof saved === 'undefined' ? [] : saved.map(x => 'saved:' + x.id)),
    ...(typeof storedDrafts === 'function' ? storedDrafts().map(d => d.takes) : []),
    ...(await takesOpenElsewhere())
  ]);
  return storedTakeKeys.filter(k => !live.has(k) && !libraryKeys.has(k));
}

// Latency: the calibrated value, or the browser's own estimate of its output delay until then.
function storedLatency() {
  const value = storage.get(KEYS.latency, null);
  return value && Number.isFinite(value.ms) && value.ms >= 0 && value.ms <= 1000 ? value : null;
}
function estimatedLatency(stream) {
  const input = stream?.getAudioTracks?.()[0]?.getSettings?.().latency;
  return Math.round(((+audio?.baseLatency || 0) + (+audio?.outputLatency || 0) + (+input || 0)) * 1000);
}
// An older take recorded before calibration lines up by the calibration made since.
const takeLatency = take => (take.calibrated ? take.latencyMs : (storedLatency()?.ms ?? take.latencyMs));

// What stops recording here, as a sentence for the student, or '' when it can work.
function recordingProblem() {
  if (!navigator.mediaDevices?.getUserMedia)
    return 'This browser can’t use a microphone here. Recording needs a recent Chrome, Edge, Firefox or Safari, on a secure (https) page.';
  if (typeof MediaRecorder !== 'function')
    return 'This browser can’t record audio. Try a recent Chrome, Edge, Firefox or Safari.';
  if (!(window.AudioContext || window.webkitAudioContext))
    return 'This browser can’t play audio, so it can’t record along.';
  return '';
}
function micProblem(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'Microphone access is blocked. Allow the microphone for this site in the browser’s settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return 'No microphone was found. Plug one in, or check the device’s sound settings.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'The microphone is busy. Close other apps or tabs that use it, then try again.';
  return 'The microphone could not start' + (error?.message ? ': ' + error.message : '.');
}
const recordStatus = text => ($('record-status').textContent = text);
function audioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  audio ||= new Context();
  audio.resume?.()?.catch?.(() => {});
  return audio;
}
const releaseMic = stream => stream?.getTracks?.().forEach(track => track.stop());

// Microphone level while the mic is open, so a student can see that it hears them. It is drawn only, never played.
let level = null;
function watchLevel(stream) {
  stopLevel();
  if (typeof audio.createMediaStreamSource !== 'function' || typeof audio.createAnalyser !== 'function') return;
  try {
    const source = audio.createMediaStreamSource(stream),
      analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize),
      watch = (level = {source, value: 0});
    const tick = () => {
      if (level !== watch) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      watch.value = Math.max(peak, watch.value * 0.9);
      $('record-level').value = Math.min(1, watch.value);
      watch.frame = nextFrame(tick);
    };
    tick();
  } catch {}
}
function stopLevel() {
  if (!level) return;
  if (level.frame) cancelFrame(level.frame);
  try {
    level.source.disconnect();
  } catch {}
  level = null;
  $('record-level').value = 0;
}
// Opens the mic and starts a MediaRecorder on it. Resolves to the session with startAudio, the audio-clock time when
// the recorder reported starting; the take's lead and the calibration are both measured from it.
async function openRecorder(session) {
  session.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  if (session.cancelled) throw new Error('cancelled');
  watchLevel(session.stream);
  const mime = TAKE_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) || '',
    recorder = new MediaRecorder(session.stream, mime ? {mimeType: mime} : undefined);
  session.recorder = recorder;
  session.mime = recorder.mimeType || mime || 'audio/webm';
  session.chunks = [];
  recorder.addEventListener('dataavailable', e => e.data?.size && session.chunks.push(e.data));
  session.done = new Promise(resolve => recorder.addEventListener('stop', resolve, {once: true}));
  await new Promise(resolve => {
    recorder.addEventListener('start', resolve, {once: true});
    setTimeout(resolve, 1000);
    recorder.start();
  });
  session.startAudio = audio.currentTime;
  return session;
}
function closeRecorder(session) {
  try {
    if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {}
}

// Recording: the practice range plays once, at the playback speed, after the chosen count-in. It ends with the
// playback (at the end, ■ Stop or Stop recording, or anything else that stops it) plus a short tail for the last note.
let rec = null;
async function startRecording() {
  if (rec) return stopRecording();
  if (calibrating) return;
  const problem = recordingProblem();
  if (problem) return recordStatus(problem);
  stop();
  audioContext();
  const session = (rec = {state: 'starting', key: recordKey(), title: field('T', 'Untitled')});
  showRecording();
  recordStatus('Allow the microphone if the browser asks.');
  try {
    await openRecorder(session);
  } catch (e) {
    releaseMic(session.stream);
    stopLevel();
    if (rec === session) rec = null;
    showRecording();
    if (!session.cancelled) recordStatus(micProblem(e));
    return;
  }
  // Stopped, another score opened or Compose left while the browser asked for the microphone: nothing records, and
  // the microphone is let go at once. (stop() itself cannot cancel here, since every render calls it.) The score is
  // known by its takes key, which saving carries over (rekeyTakes): a Mixer change puts a library score's mix on a
  // copy of it, which is still the same score.
  if (session.cancelled || recordKey() !== session.key || $('studio').hidden)
    return discardRecording(session, session.why || 'Recording cancelled.');
  session.latencyMs = storedLatency()?.ms ?? estimatedLatency(session.stream);
  session.calibrated = !!storedLatency();
  session.done.then(() => finishTake(session));
  recordStatus('Count-in, then play along. Recording…');
  await play(null, {
    countInBars: +$('record-count-in').value || 1,
    once: true,
    onStart: ({clock, from, until, percent}) =>
      Object.assign(session, {state: 'live', lead: clock - session.startAudio, from, until, speed: percent})
  });
  // Playback could not start (no notes in the range); play() has said why.
  if (session.state !== 'live') discardRecording(session);
}
// While the take is being saved (the tail after playback ends), another press does nothing, so a double press or a
// press just after the range ends keeps the take.
function stopRecording() {
  if (rec?.state === 'live') stop();
  else if (rec?.state === 'starting') discardRecording(rec);
}
// The transport's ■ Stop also cancels a recording still waiting for the microphone.
function cancelStartingRecording() {
  if (rec?.state === 'starting') discardRecording(rec, 'Recording cancelled.');
}
function discardRecording(session, why = 'No take was recorded.') {
  session.cancelled = true;
  session.why ||= why;
  session.state = 'done';
  closeRecorder(session);
  releaseMic(session.stream);
  stopLevel();
  if (rec === session) rec = null;
  showRecording();
  recordStatus(why);
}
// The hook stop() calls: a live recording winds down, and a take playing stops. Stopped during the count-in, before
// the score's first note, the recording holds nothing of the score, so it is not kept (a false start).
function takeStopped() {
  stopTake();
  if (rec?.state !== 'live') return;
  const session = rec;
  if (audio.currentTime < session.startAudio + session.lead)
    return discardRecording(session, 'Stopped in the count-in, so no take was recorded.');
  session.state = 'stopping';
  session.end = audio.currentTime + RECORD_TAIL_MS / 1000;
  recordStatus('Saving the take…');
  showRecording();
  setTimeout(() => closeRecorder(session), RECORD_TAIL_MS);
}
// The take is stored under the key of the score it was recorded on: if that score was saved while it recorded, the
// save moved the key on (rekeyTakes), and a save from here on comes after the take in turn and moves it.
function finishTake(session) {
  releaseMic(session.stream);
  stopLevel();
  if (rec === session) rec = null;
  showRecording();
  if (session.cancelled || session.lead == null) return;
  const blob = new Blob(session.chunks, {type: session.mime});
  if (!blob.size) return recordStatus('The microphone sent no sound, so no take was saved.');
  const duration = Math.max(0, Math.max(session.end || 0, audio.currentTime) - session.startAudio);
  return inTurn(() => storeTake(session, blob, duration));
}
async function storeTake(session, blob, duration) {
  const earlier = await listTakes(session.key),
    take = {
      id: globalThis.crypto?.randomUUID?.() || 'take-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      scoreKey: session.key,
      n: Math.max(0, ...earlier.map(t => t.n || 0)) + 1,
      title: session.title,
      at: Date.now(),
      duration,
      mime: session.mime,
      blob,
      latencyMs: session.latencyMs,
      calibrated: session.calibrated,
      lead: session.lead,
      from: session.from,
      until: session.until,
      speed: session.speed
    };
  recordedHere.add(take.id);
  const kept = await putTake(take);
  recordStatus(
    `Take ${take.n} saved (${clockText(take.duration)}).` +
      (!kept
        ? ' This browser can’t keep it after the tab closes, so download it to keep it.'
        : take.scoreKey.startsWith('new:') && take.scoreKey === recordKey()
          ? ' Save the score to keep its takes with it.'
          : '')
  );
  await updateTakes(true);
}
// While the take is saved, Start recording is marked unavailable with aria-disabled, which keeps keyboard focus on it.
function showRecording() {
  const live = !!rec,
    saving = rec?.state === 'stopping';
  $('record-start').textContent = saving ? '● Saving…' : live ? '■ Stop recording' : '● Start recording';
  $('record-start').classList.toggle('recording', live);
  if (saving) $('record-start').setAttribute('aria-disabled', 'true');
  else $('record-start').removeAttribute('aria-disabled');
  $('record').classList.toggle('recording', live);
  $('record').textContent = live ? '● Recording' : '● Record';
  $('record-start').disabled = calibrating;
  $('record-count-in').disabled = live;
  $('record-calibrate').disabled = live;
}

// Takes: played through the master bus, so the Volume slider applies. With the score, the take starts at the audio
// time where the score's first note sounds, from the point in the take where that note was recorded.
let takePlayer = null,
  shownTakes = [],
  shownKey = null;
// Older Safari has no Blob.arrayBuffer and only the callback form of decodeAudioData.
async function decodeBlob(blob) {
  const bytes = await (blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer());
  return new Promise((resolve, reject) => audio.decodeAudioData(bytes, resolve, reject)?.then?.(resolve, reject));
}
const decodedTakes = new Map();
function decodeTake(take) {
  if (!decodedTakes.has(take.id)) {
    const decoded = decodeBlob(take.blob);
    decoded.catch(() => decodedTakes.delete(take.id));
    decodedTakes.set(take.id, decoded);
    // A few decoded takes are kept for replaying; decoded audio is large.
    if (decodedTakes.size > 3) decodedTakes.delete(decodedTakes.keys().next().value);
  }
  return decodedTakes.get(take.id);
}
function stopTake() {
  const player = takePlayer;
  if (!player) return;
  takePlayer = null;
  try {
    player.source?.stop();
  } catch {}
  markTakes();
}
async function playTake(id, withScore) {
  const again = takePlayer?.id === id && takePlayer.withScore === withScore;
  stop();
  if (again || rec) return;
  const take = shownTakes.find(t => t.id === id);
  if (!take || typeof audioContext().createBufferSource !== 'function') return;
  let buffer;
  try {
    buffer = await decodeTake(take);
  } catch {
    recordStatus('This browser can’t play this take. Download it to listen.');
    return;
  }
  const player = {id, withScore},
    begin = (when, offset) => {
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(outputNode());
      source.onended = () => {
        if (takePlayer !== player) return;
        takePlayer = null;
        markTakes();
      };
      source.start(when, Math.min(offset, buffer.duration));
      player.source = source;
      takePlayer = player;
      markTakes();
    };
  if (!withScore) return begin(audio.currentTime + 0.05, 0);
  await play(take.from, {
    once: true,
    percent: take.speed,
    until: take.until,
    onStart: ({clock}) => begin(clock, takeOffset(take, takeLatency(take)))
  });
}
// A library edition's credits go with a recording of it, as a text file: '' for a score without credits. A GPL
// edition's licence goes in full, as in every other export.
function takeCredits(take, item) {
  const credit = exportCredit(item);
  if (!credit) return '';
  const gpl = scoreLicense(item).startsWith('GPL-') && typeof GPL_LICENSE === 'string';
  return (
    `Recording: ${takeFileName(take.title, take.n, takeExtension(take.mime))}, made in FretFree on ` +
    `${new Date(take.at).toLocaleDateString()}. It is a performance of this edition:\n\n${credit}\n` +
    (gpl ? '\n' + GPL_LICENSE : '')
  );
}
function downloadTake(id) {
  const take = shownTakes.find(t => t.id === id);
  if (!take) return;
  download(take.blob, takeFileName(take.title, take.n, takeExtension(take.mime)), take.mime);
  const credits = takeCredits(take, current);
  if (credits) download(credits, takeFileName(take.title, take.n, 'txt', ' credits'), 'text/plain');
}
async function deleteTake(id) {
  const take = shownTakes.find(t => t.id === id);
  if (!take || !confirm(`Delete take ${take.n}? It can’t be brought back.`)) return;
  if (takePlayer?.id === id) stop();
  const index = shownTakes.indexOf(take);
  await removeTake(id);
  decodedTakes.delete(id);
  recordStatus(`Take ${take.n} deleted.`);
  await updateTakes(true);
  // Focus stays in the list: on the take that moved into its place, or the one before, or Start recording.
  const buttons = [...$('take-list').querySelectorAll('[data-take-play]')];
  (buttons[Math.min(index, buttons.length - 1)] || $('record-start')).focus();
}
// The takes for the open score. Called after every render, so it reads storage only when the score changes.
async function updateTakes(force = false) {
  if (embedView) return;
  const key = recordKey();
  if (!force && key === shownKey) return;
  shownKey = key;
  const takes = await listTakes(key);
  if (key !== shownKey) return;
  if (takePlayer && !takes.some(t => t.id === takePlayer.id)) stopTake();
  shownTakes = takes;
  holdTakes(key.startsWith('new:') && takes.length ? key : null);
  const when = at =>
    new Date(at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  $('take-list').innerHTML = takes
    .map(
      t =>
        `<li data-n="${t.n}"><span class="take-name"><strong>Take ${t.n}</strong> <span class="small">${clockText(t.duration)} · ${esc(
          when(t.at)
        )}</span></span><span class="take-actions"><button data-take-play="${esc(t.id)}" aria-label="Play take ${
          t.n
        }">▶ Play</button><button data-take-score="${esc(t.id)}" aria-label="Play take ${
          t.n
        } with the score">▶ With score</button><button data-take-download="${esc(t.id)}" aria-label="Download take ${
          t.n
        }">Download</button><button data-take-delete="${esc(t.id)}" aria-label="Delete take ${
          t.n
        }">Delete</button></span></li>`
    )
    .join('');
  $('take-list').hidden = !takes.length;
  $('takes-empty').hidden = !!takes.length;
  $('record').title = takes.length
    ? `Record yourself along with the score (${takes.length} ${takes.length === 1 ? 'take' : 'takes'})`
    : 'Record yourself along with the score';
  markTakes();
  await indexTakes();
  if (key === shownKey) showStorageUse();
}
// The playing take's button turns into its Stop button.
function markTakes() {
  for (const button of $('take-list').querySelectorAll('[data-take-play], [data-take-score]')) {
    const withScore = button.hasAttribute('data-take-score'),
      n = button.closest('li').dataset.n,
      on =
        takePlayer?.id === (button.dataset.takePlay || button.dataset.takeScore) && takePlayer.withScore === withScore;
    button.textContent = on ? '■ Stop' : withScore ? '▶ With score' : '▶ Play';
    button.setAttribute('aria-label', on ? `Stop take ${n}` : `Play take ${n}${withScore ? ' with the score' : ''}`);
  }
}
async function showStorageUse() {
  let text =
    'Takes stay in this browser on this device. They are not uploaded and not in backups: download any take you want to keep.';
  if (takesInMemory) text = 'This browser can’t keep takes after the tab closes: download any take you want to keep.';
  try {
    const {usage} = (await navigator.storage?.estimate?.()) || {};
    if (Number.isFinite(usage))
      text += ` FretFree is using ${(usage / 1048576).toFixed(usage < 10485760 ? 1 : 0)} MB of storage here.`;
  } catch {}
  $('record-storage').textContent = text;
  const stray = (await strayTakeKeys()).length;
  $('takes-stray').hidden = !stray;
  $('takes-stray-text').textContent =
    stray === 1
      ? '1 take here belongs to a score that was deleted or never saved.'
      : `${stray} takes here belong to scores that were deleted or never saved.`;
}
async function deleteStrayTakes() {
  const keys = await strayTakeKeys();
  if (
    !keys.length ||
    !confirm(
      `Delete ${keys.length === 1 ? 'the take' : `the ${keys.length} takes`} of scores that were deleted or never saved? They can’t be brought back.`
    )
  )
    return;
  const count = await deleteTakesOf(new Set(keys));
  recordStatus(`${count} ${count === 1 ? 'take' : 'takes'} deleted.`);
  $('record-start').focus();
}

// Calibration: eight clicks through the speakers, recorded the way a take is. The delay between when each click was
// scheduled and when it starts in the recording is the round-trip latency, kept as fretfree-latency.
let calibrating = false;
function showLatency() {
  const stored = storedLatency();
  $('calibrate-status').textContent = stored
    ? `Calibrated: this device records ${stored.ms} ms behind what it plays, and takes are lined up by that.`
    : 'Not calibrated yet, so a take may sound a little late against the score. Calibrate once on each device.';
}
async function calibrate() {
  if (rec || calibrating) return;
  const problem = recordingProblem();
  if (problem) return ($('calibrate-status').textContent = problem);
  stop();
  audioContext();
  calibrating = true;
  showRecording();
  $('calibrate-status').textContent = 'Allow the microphone if asked, then stay quiet while FretFree plays 8 clicks.';
  const session = {};
  try {
    await openRecorder(session);
    const base = audio.currentTime + 0.4,
      clicks = CALIBRATION_CLICKS.map(t => base + t);
    for (const t of clicks) click(t, true);
    $('calibrate-status').textContent = 'Listening…';
    await new Promise(resolve => setTimeout(resolve, (clicks.at(-1) + 0.8 - audio.currentTime) * 1000));
    closeRecorder(session);
    await session.done;
    releaseMic(session.stream);
    stopLevel();
    const buffer = await decodeBlob(new Blob(session.chunks, {type: session.mime})),
      onsets = audioOnsets(buffer.getChannelData(0), buffer.sampleRate),
      result = estimateLatency(
        clicks.map(t => t - session.startAudio),
        onsets
      );
    if (result) {
      storage.set(KEYS.latency, {ms: result.latencyMs, at: Date.now()});
      showLatency();
    } else
      $('calibrate-status').textContent =
        'FretFree couldn’t hear the clicks clearly. Turn the volume up, unplug headphones, and try again somewhere quiet.';
  } catch (e) {
    $('calibrate-status').textContent = session.recorder ? 'Calibration didn’t work in this browser.' : micProblem(e);
  } finally {
    closeRecorder(session);
    releaseMic(session.stream);
    stopLevel();
    calibrating = false;
    showRecording();
  }
}

// The panel opens from ● Record in the transport.
function toggleRecordPanel(open = $('record-panel').hidden) {
  $('record-panel').hidden = !open;
  $('record').setAttribute('aria-expanded', open);
  if (!open) return;
  updateTakes(true);
  showLatency();
  $('record-panel').scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
  $('record-start').focus({preventScroll: true});
}
function applyRecordSettings() {
  $('record-count-in').value = storage.get(KEYS.recordCountIn, 1) === 2 ? '2' : '1';
}
applyRecordSettings();
$('record').onclick = () => toggleRecordPanel();
$('record-close').onclick = () => {
  toggleRecordPanel(false);
  $('record').focus();
};
$('record-start').onclick = () => startRecording();
$('record-calibrate').onclick = () => calibrate();
$('takes-stray-delete').onclick = () => deleteStrayTakes();
$('record-count-in').onchange = () => storage.set(KEYS.recordCountIn, +$('record-count-in').value === 2 ? 2 : 1);
$('take-list').onclick = e => {
  const button = e.target.closest('button');
  if (!button) return;
  const {takePlay, takeScore, takeDownload, takeDelete} = button.dataset;
  if (takePlay) playTake(takePlay, false);
  else if (takeScore) playTake(takeScore, true);
  else if (takeDownload) downloadTake(takeDownload);
  else if (takeDelete) deleteTake(takeDelete);
};
$('record-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || rec) return;
  e.stopPropagation();
  $('record-close').click();
});
