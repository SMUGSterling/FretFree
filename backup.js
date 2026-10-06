'use strict';
// Backup and restore: one JSON file holding everything this browser keeps for a student (saved scores, favorites,
// the played list and practice settings). Backing up uses the browser's Save As dialog where it exists, so the file
// can live in a synced folder (OneDrive, Google Drive, iCloud) and the same file is reused on the next backup;
// elsewhere it is a plain download. Restoring merges: nothing is deleted, and a score present on both sides keeps
// whichever copy was saved more recently.
const BACKUP_FORMAT = 1,
  LAST_BACKUP_KEY = 'fretfree-last-backup',
  BACKUP_SETTING_KEYS = () => [
    KEYS.fingering,
    KEYS.noteNames,
    ...['loop', 'metronome', 'count-in', 'trainer'].map(KEYS.practice)
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
    settings
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
const loadBackupHandle = () => handleStore('readonly', store => store.get('backup')),
  saveBackupHandle = handle => handleStore('readwrite', store => store.put(handle, 'backup')),
  forgetBackupHandle = () => handleStore('readwrite', store => store.delete('backup'));
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
  storage.set(LAST_BACKUP_KEY, {at: Date.now(), name});
  renderBackupStatus();
  toast(`Backed up ${count} score${count === 1 ? '' : 's'} to ${where} (${name}).`);
}
// Merge a backup into this browser. Returns a summary; throws on anything that is not a FretFree backup.
function applyBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'FretFree' || !Array.isArray(data.scores))
    throw new Error('This is not a FretFree backup file.');
  if (typeof data.format !== 'number' || data.format > BACKUP_FORMAT)
    throw new Error('This backup comes from a newer FretFree. Update the app first.');
  const incoming = data.scores.filter(
    x =>
      x && typeof x === 'object' && typeof x.id === 'string' && typeof x.abc === 'string' && typeof x.title === 'string'
  );
  const byId = new Map(saved.map(x => [x.id, x]));
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
    }
  }
  const nextSaved = [...byId.values()],
    nextFavorites = [...new Set([...favorites, ...(Array.isArray(data.favorites) ? data.favorites : [])])].filter(
      x => typeof x === 'string'
    ),
    nextPlayed = [...new Set([...played, ...(Array.isArray(data.played) ? data.played : [])])].filter(
      x => typeof x === 'string'
    );
  if (!storage.set(KEYS.scores, nextSaved)) throw new Error('This browser could not store the restored scores.');
  storage.set(KEYS.favorites, nextFavorites);
  storage.set(KEYS.played, nextPlayed);
  const favoritesAdded = nextFavorites.length - favorites.length;
  saved = nextSaved;
  favorites = nextFavorites;
  played = new Set(nextPlayed);
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  for (const key of BACKUP_SETTING_KEYS()) if (key in settings) storage.set(key, settings[key]);
  return {
    added,
    updated,
    unchanged: incoming.length - added - updated,
    favoritesAdded,
    settings: Object.keys(settings).length
  };
}
function restoreSummary(s) {
  const parts = [];
  if (s.added) parts.push(`${s.added} score${s.added === 1 ? '' : 's'} added`);
  if (s.updated) parts.push(`${s.updated} updated to a newer copy`);
  if (s.unchanged) parts.push(`${s.unchanged} already up to date`);
  if (s.favoritesAdded) parts.push(`${s.favoritesAdded} favorite${s.favoritesAdded === 1 ? '' : 's'} added`);
  return parts.length ? 'Restored: ' + parts.join(', ') + '.' : 'Nothing new to restore.';
}
async function restoreFromFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) throw new Error('That backup is larger than 20 MB; please check the file.');
  const summary = applyBackup(JSON.parse(await file.text()));
  renderSaved();
  renderCards();
  renderBackupStatus();
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
  if (!last?.at) {
    el.textContent = saved.length
      ? `${saved.length} saved score${saved.length === 1 ? '' : 's'} on this device, never backed up.`
      : 'Nothing backed up yet.';
    return;
  }
  const changed = saved.filter(x => (x.updated || 0) > last.at).length;
  el.textContent =
    `Last backed up ${new Date(last.at).toLocaleString()} to ${last.name}.` +
    (changed ? ` ${changed} score${changed === 1 ? '' : 's'} changed since.` : ' Everything saved is in that backup.');
}
$('backup').onclick = () => backUp().catch(e => toast('Backup failed: ' + e.message));
$('restore').onclick = () => $('restore-file').click();
$('restore-file').onchange = () =>
  restoreFromFile($('restore-file').files[0])
    .catch(e => toast(e.message))
    .finally(() => ($('restore-file').value = ''));
