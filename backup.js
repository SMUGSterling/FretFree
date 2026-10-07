'use strict';
// Backup and restore: one JSON file holding everything this browser keeps for a student (saved scores and their
// earlier versions, favorites, the played list and practice settings) or a teacher (the Submissions inbox). Backing up uses the browser's Save As dialog
// where it exists, so the file can live in a synced folder (OneDrive, Google Drive, iCloud) and the same file is reused
// on the next backup; elsewhere it is a plain download. Restoring merges: nothing is deleted, and a score present on
// both sides keeps whichever copy was saved more recently.
const BACKUP_FORMAT = 1,
  LAST_BACKUP_KEY = 'fretfree-last-backup',
  BACKUP_SETTING_KEYS = () => [
    KEYS.fingering,
    KEYS.noteNames,
    KEYS.noteColors,
    KEYS.audition,
    KEYS.zoom,
    KEYS.measuresPerLine,
    KEYS.piano,
    KEYS.concertPitch,
    KEYS.theme,
    KEYS.darkPaper,
    KEYS.studentName,
    KEYS.recordCountIn,
    KEYS.checkLevel,
    KEYS.checkMelody,
    KEYS.markAuthor,
    ...['loop', 'metronome', 'count-in', 'trainer', 'chords'].map(KEYS.practice)
  ];
function backupData() {
  const settings = {};
  for (const key of BACKUP_SETTING_KEYS()) {
    const value = storage.get(key, null);
    if (value !== null) settings[key] = value;
  }
  return {
    app: 'FretFree',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    scores: saved,
    favorites,
    played: [...played],
    settings,
    versions: storedVersions(),
    ...(typeof storedInbox === 'function' ? {inbox: storedInbox()} : {})
  };
}
const backupFileName = () => `fretfree-backup-${new Date().toISOString().slice(0, 10)}.json`;
// The remembered file handle lives in IndexedDB, the only browser store that can hold one.
const HANDLE_DB = 'fretfree-backup';
function handleStore(mode, action) {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(undefined);
    let request;
    try {
      request = indexedDB.open(HANDLE_DB, 1);
    } catch {
      return resolve(undefined);
    }
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => {
      try {
        const tx = request.result.transaction('handles', mode),
          op = action(tx.objectStore('handles'));
        op.onsuccess = () => resolve(op.result);
        op.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    };
  });
}
function loadBackupHandle() {
  return handleStore('readonly', store => store.get('backup'));
}
function saveBackupHandle(handle) {
  return handleStore('readwrite', store => store.put(handle, 'backup'));
}
function forgetBackupHandle() {
  return handleStore('readwrite', store => store.delete('backup'));
}
async function writableHandle(handle) {
  if (!handle?.createWritable) return null;
  try {
    const ok = async () => (await handle.queryPermission({mode: 'readwrite'})) === 'granted';
    if ((await ok()) || (await handle.requestPermission({mode: 'readwrite'})) === 'granted') return handle;
  } catch {}
  return null;
}
async function backUp() {
  const data = backupData(),
    text = JSON.stringify(data, null, 1),
    count = data.scores.length;
  let name = backupFileName(),
    where = 'your downloads';
  if (typeof showSaveFilePicker === 'function') {
    try {
      let handle = await writableHandle(await loadBackupHandle());
      if (!handle) {
        handle = await showSaveFilePicker({
          suggestedName: name,
          types: [{description: 'FretFree backup', accept: {'application/json': ['.json']}}]
        });
        await saveBackupHandle(handle);
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      name = handle.name;
      where = 'the chosen file';
    } catch (e) {
      if (e?.name === 'AbortError') return;
      await forgetBackupHandle();
      download(text, name, 'application/json');
    }
  } else download(text, name, 'application/json');
  storage.set(LAST_BACKUP_KEY, {
    at: Date.now(),
    name,
    scores: Object.fromEntries(data.scores.map(x => [x.id, x.updated || 0]))
  });
  renderBackupStatus();
  toast(`Backed up ${count} score${count === 1 ? '' : 's'} to ${where} (${name}).`);
}
// Merge a backup into this browser. Returns a summary; throws on anything that is not a sound FretFree backup, and
// changes nothing unless every write succeeds.
function applyBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'FretFree' || !Array.isArray(data.scores))
    throw new Error('This is not a FretFree backup file.');
  if (typeof data.format !== 'number' || data.format > BACKUP_FORMAT)
    throw new Error('This backup comes from a newer FretFree. Update the app first.');
  const incoming = data.scores;
  if (
    !incoming.every(
      x =>
        x &&
        typeof x === 'object' &&
        typeof x.id === 'string' &&
        typeof x.abc === 'string' &&
        typeof x.title === 'string'
    )
  )
    throw new Error('This backup file is damaged: a score entry is incomplete. Nothing was restored.');
  // Merge onto what is stored now, which another tab may have changed.
  rereadLists();
  const byId = new Map(saved.map(x => [x.id, x])),
    myVersions = storedVersions(),
    versions = cleanVersions(data.versions);
  let added = 0,
    updated = 0;
  for (const x of incoming) {
    const mine = byId.get(x.id);
    if (!mine) {
      byId.set(x.id, x);
      added++;
    } else if ((x.updated || 0) > (mine.updated || 0)) {
      byId.set(x.id, x);
      updated++;
      // The copy a newer one replaces becomes one of its versions, as when saving.
      if (mine.abc !== x.abc)
        (versions[x.id] ||= []).push({
          at: Number.isFinite(mine.updated) ? mine.updated : 0,
          abc: mine.abc,
          ...(mine.instrument ? {instrument: mine.instrument} : {})
        });
    }
  }
  // Versions are unioned by the time each was saved, for scores this device keeps.
  const versionCount = map => Object.values(map).reduce((n, list) => n + list.length, 0),
    union = Object.create(null);
  for (const id of byId.keys()) {
    const list = [...(myVersions[id] || []), ...(versions[id] || [])];
    if (list.length) union[id] = list;
  }
  const nextVersions = trimVersions(cleanVersions(union));
  const nextSaved = [...byId.values()],
    nextFavorites = [...new Set([...favorites, ...(Array.isArray(data.favorites) ? data.favorites : [])])].filter(
      x => typeof x === 'string'
    ),
    nextPlayed = [...new Set([...played, ...(Array.isArray(data.played) ? data.played : [])])].filter(
      x => typeof x === 'string'
    ),
    settings = data.settings && typeof data.settings === 'object' ? data.settings : {},
    settingKeys = BACKUP_SETTING_KEYS().filter(key => key in settings),
    settingsChanged = settingKeys.filter(
      key => JSON.stringify(storage.get(key, null)) !== JSON.stringify(settings[key])
    ).length;
  // Submissions merge like scores: entries this device lacks are added (each checked again), up to the inbox limit,
  // and feedback typed, or notes marked, on another device come over to an entry here that has none.
  const myInbox = typeof storedInbox === 'function' ? storedInbox() : [],
    nextInbox = typeof mergeInbox === 'function' ? mergeInbox(myInbox, data.inbox) : myInbox,
    feedbackAdded = myInbox.filter(e => {
      const next = nextInbox.find(x => x.id === e.id);
      return (!e.feedback && next?.feedback) || (!e.marks && next?.marks);
    }).length;
  // Every write must land before memory changes; on any failure put the previous values back and report. When storage
  // is short the oldest stored versions make room, as when saving, so they are put back too (last, once the rest has
  // shrunk back).
  const previous = [
    [KEYS.scores, saved],
    [KEYS.favorites, favorites],
    [KEYS.played, [...played]],
    ...settingKeys.map(key => [key, storage.get(key, null)]),
    [KEYS.inbox, storage.get(KEYS.inbox, null)],
    [KEYS.versions, storage.get(KEYS.versions, null)]
  ];
  const writes = [
    [KEYS.scores, nextSaved],
    [KEYS.favorites, nextFavorites],
    [KEYS.played, nextPlayed],
    ...settingKeys.map(key => [key, settings[key]]),
    ...(JSON.stringify(nextInbox) !== JSON.stringify(myInbox) ? [[KEYS.inbox, nextInbox]] : [])
  ];
  if (!writes.every(([key, value]) => storeMakingRoom(key, value))) {
    // A key this device did not have before is removed again.
    for (const [key, value] of previous) value === null ? storage.remove(key) : storage.set(key, value);
    throw new Error('This browser could not store the restored data (storage may be full). Nothing was changed.');
  }
  // Versions go last and never stop a restore: when they do not fit, the oldest give way.
  const versionsKept = storeVersions(nextVersions),
    versionsAdded = Math.max(0, versionCount(versionsKept) - versionCount(myVersions));
  const favoritesAdded = nextFavorites.length - favorites.length;
  saved = nextSaved;
  favorites = nextFavorites;
  played = new Set(nextPlayed);
  return {
    added,
    updated,
    unchanged: incoming.length - added - updated,
    favoritesAdded,
    settings: settingKeys.length,
    settingsChanged,
    versionsAdded,
    submissionsAdded: nextInbox.length - myInbox.length,
    feedbackAdded
  };
}
function restoreSummary(s) {
  const parts = [];
  if (s.added) parts.push(`${s.added} score${s.added === 1 ? '' : 's'} added`);
  if (s.updated) parts.push(`${s.updated} updated to a newer copy`);
  if (s.unchanged) parts.push(`${s.unchanged} already up to date`);
  if (s.favoritesAdded) parts.push(`${s.favoritesAdded} favorite${s.favoritesAdded === 1 ? '' : 's'} added`);
  if (s.versionsAdded) parts.push(`${s.versionsAdded} earlier version${s.versionsAdded === 1 ? '' : 's'} added`);
  if (s.submissionsAdded) parts.push(`${s.submissionsAdded} submission${s.submissionsAdded === 1 ? '' : 's'} added`);
  if (s.feedbackAdded) parts.push(`feedback added to ${s.feedbackAdded} submission${s.feedbackAdded === 1 ? '' : 's'}`);
  if (s.settingsChanged) parts.push(`${s.settingsChanged} setting${s.settingsChanged === 1 ? '' : 's'} applied`);
  return parts.length ? 'Restored: ' + parts.join(', ') + '.' : 'Nothing new to restore.';
}
async function restoreFromFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) throw new Error('That backup is larger than 20 MB; please check the file.');
  // A file that is not JSON at all (a zip, a cut-off download) gets the same plain message as any other wrong file.
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a FretFree backup file, or it is damaged or incomplete.');
  }
  const summary = applyBackup(data);
  renderSaved();
  renderCards();
  renderBackupStatus();
  if (typeof renderInbox === 'function') renderInbox();
  if (summary.settings) {
    applyStoredSettings();
    render();
  }
  toast(restoreSummary(summary));
}
function renderBackupStatus() {
  const last = storage.get(LAST_BACKUP_KEY, null),
    el = $('backup-status');
  if (!el) return;
  // A damaged record (not an object with a time) counts as never backed up.
  if (!last || typeof last !== 'object' || !Number.isFinite(last.at) || last.at <= 0) {
    el.textContent = saved.length
      ? `${saved.length} saved score${saved.length === 1 ? '' : 's'} on this device, never backed up.`
      : 'Nothing backed up yet.';
    return;
  }
  // A score counts as not backed up when the backup lacks it or holds another revision of it.
  const snapshot = last.scores && typeof last.scores === 'object' ? last.scores : null;
  const changed = saved.filter(x =>
    snapshot ? snapshot[x.id] === undefined || snapshot[x.id] !== (x.updated || 0) : (x.updated || 0) > last.at
  ).length;
  el.textContent =
    `Last backed up ${new Date(last.at).toLocaleString()}${typeof last.name === 'string' ? ` to ${last.name}` : ''}.` +
    (changed ? ` ${changed} score${changed === 1 ? '' : 's'} changed since.` : ' Everything saved is in that backup.');
}
$('backup').onclick = () => backUp().catch(e => toast('Backup failed: ' + e.message));
$('restore').onclick = () => $('restore-file').click();
$('restore-file').onchange = () =>
  restoreFromFile($('restore-file').files[0])
    .catch(e => toast(e.message))
    .finally(() => ($('restore-file').value = ''));
