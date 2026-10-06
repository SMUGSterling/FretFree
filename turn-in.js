'use strict';
// Turning in and the teacher's inbox. A student turns in an assignment as a share link that also carries their name,
// the time, their goal results and their latest play-along checks (n, t, x, g, h); nothing is uploaded. The teacher
// pastes the links (or drops the .json files) into My scores → Submissions, which lists them by assignment and steps
// through the class in the studio. A return link carries the teacher's feedback (c) back to the student. The checks on
// these keys are in score-tools.js.
const INBOX_LIMIT = 200,
  INBOX_ABC_MAX = 200 * 1024;

// The prompt an inbox entry carries: a teacher's assignment object or a built-in prompt's id. A link carries the first
// as q and the second as p, read as openSharedLink reads them.
const resolvePrompt = prompt => (typeof prompt === 'string' ? promptById(prompt) : validPrompt(prompt)) || null,
  linkPrompt = payload => validPrompt(payload?.q) || (typeof payload?.p === 'string' && promptById(payload.p)) || null;
const goalWords = (met, total) => (total ? `${met} of ${total} goal${total === 1 ? '' : 's'}` : 'No goals');
const barWords = bars => (bars ? `${bars} bar${bars === 1 ? '' : 's'} to fix` : 'Bars ✓');
// Play-along checks in a few words: the best of them, and how many there were.
const checksWords = checks =>
  checks?.length
    ? `${checks.length === 1 ? 'Play-along check' : `Best of ${checks.length} play-along checks`}: ${checkWords(bestCheck(checks))}`
    : '';
const openChecks = () => (typeof storedChecks === 'function' ? storedChecks(recordKey()) : []);

// Student: Turn in. The button shows on a score with an assignment or a writing prompt, but not on work someone turned
// in, which the teacher answers with feedback instead.
let turnInSource = null;
function turnInChecks(prompt = activePrompt()) {
  return submissionChecks($('abc').value, prompt, instrumentShift());
}
function updateTurnIn() {
  const prompt = activePrompt(),
    can = !!prompt && !current?.submission;
  $('turn-in').hidden = !can;
  if (!can) closeTurnIn();
  else if (!$('turn-in-panel').hidden) {
    showTurnInSummary(prompt);
    // A link made before the latest edit would hand in older work, so it goes until the student turns in again.
    if ($('abc').value !== turnInSource) $('turn-in-result').hidden = true;
  }
  showFeedbackNote();
  showSubmission();
}
function showTurnInSummary(prompt) {
  const {met, total, bars} = turnInChecks(prompt);
  const checks = openChecks().slice(-CHECKS_IN_LINK);
  $('turn-in-summary').textContent =
    `${prompt.level === 'Custom' ? 'Assignment' : 'Writing prompt'}: ${prompt.title}. ${goalWords(met, total)} met` +
    (bars ? `; ${bars} bar${bars === 1 ? ' doesn’t' : 's don’t'} match the time signature.` : '.') +
    (checks.length ? ` ${checksWords(checks)}; ${checks.length === 1 ? 'it goes' : 'they go'} with your work.` : '');
}
function openTurnIn() {
  const prompt = activePrompt();
  if (!prompt) return;
  $('turn-in-panel').hidden = false;
  $('turn-in').setAttribute('aria-expanded', 'true');
  $('turn-in-result').hidden = true;
  $('turn-in-status').textContent = '';
  if (!$('student-name').value) $('student-name').value = cleanStudentName(storage.get(KEYS.studentName, ''));
  showTurnInSummary(prompt);
  $('turn-in-panel').scrollIntoView({block: 'nearest', behavior: 'smooth'});
  // A remembered name is selected, so on a shared computer the next student just types theirs over it.
  $('student-name').focus({preventScroll: true});
  $('student-name').select();
}
function closeTurnIn() {
  if ($('turn-in-panel').hidden) return;
  $('turn-in-panel').hidden = true;
  $('turn-in').setAttribute('aria-expanded', 'false');
  turnInSource = null;
}
let turnedIn = null;
async function turnIn() {
  const prompt = activePrompt(),
    name = cleanStudentName($('student-name').value);
  if (!prompt) return;
  if (!name) {
    $('turn-in-status').textContent = $('student-name').value.trim()
      ? `Keep your name under ${STUDENT_NAME_MAX} characters.`
      : 'Write your name, so your teacher knows whose work this is.';
    $('student-name').focus();
    return;
  }
  $('turn-in-status').textContent = '';
  storage.set(KEYS.studentName, name);
  flushTyping();
  const checks = turnInChecks(prompt),
    at = Date.now(),
    played = openChecks(),
    payload = {
      ...sharePayload(),
      n: name,
      t: at,
      x: prompt.id,
      g: checks.goals.map(g => (g.ok ? 1 : 0)),
      ...(played.length ? {h: checksForLink(played)} : {})
    };
  const url = `${shareBase()}#s=${await encodeShare(payload)}`;
  turnInSource = payload.a;
  turnedIn = {
    name,
    at,
    title: prompt.title,
    met: checks.met,
    total: checks.total,
    checks: readChecks(payload.h),
    url,
    abc: payload.a
  };
  $('turn-in-url').value = url;
  $('turn-in-result').hidden = false;
  await copyField(
    'turn-in-url',
    'Turn-in link copied. Paste it where your teacher collects work.',
    'Select the link and copy it, or download the file.'
  );
}
// The turn-in file: the link (which the inbox reads), a summary a person can read, and the credited ABC, so the
// edition's credits and license travel with the file as with every export.
function turnInFile({name, at, title, met, total, checks, url, abc}, item = current) {
  return JSON.stringify(
    {
      app: 'FretFree',
      kind: 'turn-in',
      format: 1,
      name,
      assignment: title,
      turnedIn: new Date(at).toISOString(),
      goals: goalWords(met, total),
      ...(checks?.length ? {checks: checksWords(checks)} : {}),
      link: url,
      abc: creditedABC(abc, item)
    },
    null,
    1
  );
}
$('turn-in').onclick = () => ($('turn-in-panel').hidden ? openTurnIn() : closeTurnIn());
$('turn-in-close').onclick = () => {
  closeTurnIn();
  $('turn-in').focus();
};
$('turn-in-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeTurnIn();
  $('turn-in').focus();
});
$('turn-in-form').addEventListener('submit', e => {
  e.preventDefault();
  turnIn().catch(err => toast('Could not make a link: ' + err.message));
});
$('turn-in-copy').onclick = () => copyField('turn-in-url', 'Turn-in link copied.');
$('turn-in-download').onclick = () => {
  if (!turnedIn) return;
  const who = turnedIn.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'student';
  download(turnInFile(turnedIn), `${safeName()}-${who}.json`, 'application/json');
};

// Student: the teacher's feedback from a return link, kept with the score (saves, backups and drafts carry it).
function showFeedbackNote() {
  const text = readFeedback(current?.feedback);
  $('feedback-note').hidden = !text;
  $('feedback-note-text').textContent = text || '';
}

// Opening a link: the parts turn-in.js reads (openSharedLink adds them to the score). A turned-in link becomes
// current.submission; the entry it would make in the inbox is kept so "Add to submissions" can store it as it came.
const SUBMISSION_STATUS = 'Turned-in work, kept in Submissions. Save it to My scores for a copy of your own.';
let linkEntry = null;
function linkExtras(payload, prompt) {
  const extras = {},
    entry = inboxEntry(payload, prompt || null);
  linkEntry = entry;
  if (entry) extras.submission = {id: entry.id, name: entry.name, at: entry.at, assignment: entry.assignment};
  const feedback = readFeedback(payload.c);
  if (feedback) extras.feedback = feedback;
  return extras;
}
// current.submission as an unsaved-work draft brings it back: which entry, who, when and for which assignment, and
// feedback typed for work not in Submissions. Checked like a link's n, t and x; null when it does not fit. While the
// music is as it was turned in, the draft can still be added to Submissions.
function draftSubmission(draft, prompt) {
  const sub = draft?.submission,
    read =
      sub && typeof sub === 'object' && readSubmission({n: sub.name, t: sub.at, x: sub.assignment}, prompt || null);
  if (!read || typeof sub.id !== 'string' || !/^sub-[a-z0-9]{1,13}$/.test(sub.id)) return null;
  const entry = inboxEntry(
    {n: read.name, t: read.at, x: read.assignment, a: draft.abc, i: draft.instrument, s: draft.sourceId},
    prompt
  );
  if (entry?.id === sub.id) linkEntry = entry;
  const feedback = readFeedback(sub.feedback);
  return {id: sub.id, ...read, ...(feedback ? {feedback} : {})};
}

// The inbox: entries in KEYS.inbox, checked again whenever they are read (storage and backups can be edited).
function inboxEntry(payload, prompt = linkPrompt(payload)) {
  const sub = readSubmission(payload, prompt);
  if (!sub || typeof payload.a !== 'string' || payload.a.length > INBOX_ABC_MAX || !SHARE_ABC.test(payload.a))
    return null;
  const instrument = instruments[payload.i] ? payload.i : undefined,
    source = catalog.some(x => x.id === payload.s) ? payload.s : undefined,
    played = readChecks(payload.h);
  let checks;
  try {
    checks = submissionChecks(payload.a, prompt, instruments[instrument]?.shift || 0);
  } catch {
    return null;
  }
  return {
    id: 'sub-' + hashText([sub.name, sub.at, sub.assignment, payload.a].join('\n')).toString(36),
    ...sub,
    title: prompt.title,
    prompt: prompt.level === 'Custom' ? prompt : prompt.id,
    abc: payload.a,
    ...(instrument ? {instrument} : {}),
    ...(source ? {source} : {}),
    met: checks.met,
    total: checks.total,
    bars: checks.bars,
    ...(played.length ? {checks: played} : {}),
    added: Date.now()
  };
}
const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max,
  checksOf = e => (Array.isArray(e.checks) ? e.checks.map(cleanCheck).filter(Boolean).slice(-CHECKS_IN_LINK) : []);
function cleanInboxEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const prompt = resolvePrompt(e.prompt),
    name = cleanStudentName(e.name);
  if (
    !prompt ||
    !name ||
    typeof e.id !== 'string' ||
    !/^sub-[a-z0-9]{1,13}$/.test(e.id) ||
    !Number.isInteger(e.at) ||
    e.at <= 0 ||
    e.assignment !== prompt.id ||
    typeof e.abc !== 'string' ||
    e.abc.length > INBOX_ABC_MAX ||
    !SHARE_ABC.test(e.abc) ||
    !isCount(e.total, 12) ||
    !isCount(e.met, e.total) ||
    !isCount(e.bars, 9999)
  )
    return null;
  return {
    id: e.id,
    name,
    at: e.at,
    assignment: prompt.id,
    title: prompt.title,
    prompt: prompt.level === 'Custom' ? prompt : prompt.id,
    abc: e.abc,
    ...(instruments[e.instrument] ? {instrument: e.instrument} : {}),
    ...(catalog.some(x => x.id === e.source) ? {source: e.source} : {}),
    met: e.met,
    total: e.total,
    bars: e.bars,
    ...(checksOf(e).length ? {checks: checksOf(e)} : {}),
    added: Number.isFinite(e.added) ? e.added : 0,
    ...(readFeedback(e.feedback) ? {feedback: readFeedback(e.feedback)} : {})
  };
}
function cleanInbox(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(cleanInboxEntry)
    .filter(e => e && !seen.has(e.id) && seen.add(e.id))
    .slice(0, INBOX_LIMIT);
}
const storedInbox = () => cleanInbox(storage.get(KEYS.inbox, []));
function storeInbox(list) {
  if (list.length) return storage.set(KEYS.inbox, list);
  storage.remove(KEYS.inbox);
  return true;
}
// A backup's inbox merges into this device's: entries this device lacks are added, up to the limit.
function mergeInbox(mine, incoming) {
  const have = new Set(mine.map(e => e.id)),
    added = cleanInbox(incoming).filter(e => !have.has(e.id));
  return [...mine, ...added].slice(0, INBOX_LIMIT);
}
// Add entries, skipping ones already here. Returns {added, already, full}; nothing is stored when the write fails.
function addToInbox(entries) {
  const list = storedInbox(),
    have = new Set(list.map(e => e.id)),
    result = {added: 0, already: 0, full: 0};
  for (const entry of entries) {
    if (have.has(entry.id)) result.already++;
    else if (list.length >= INBOX_LIMIT) result.full++;
    else {
      list.push(entry);
      have.add(entry.id);
      result.added++;
    }
  }
  if (result.added && !storeInbox(list)) throw new Error('This browser could not store the submissions.');
  return result;
}
// Read pasted text ({text}) or files ({name, text}, or {name, tooLarge}): a turn-in file (its link), or links one per
// line. Each readable link becomes an entry; anything else is reported by line number or file name, and the rest are
// still added.
async function readTurnIns(sources) {
  const entries = [],
    problems = [],
    large = [];
  for (const {name, text, tooLarge} of sources) {
    if (tooLarge) {
      large.push(name);
      continue;
    }
    let lines = turnInCodes(text);
    if (name && /^\s*\{/.test(text)) {
      let file = null;
      try {
        file = JSON.parse(text);
      } catch {}
      lines = file?.app === 'FretFree' && file.kind === 'turn-in' ? turnInCodes(String(file.link ?? '')) : [];
    }
    if (name && !lines.length) problems.push(name);
    for (const {line, code} of lines) {
      const entry = code ? inboxEntry(await decodeShare(code)) : null;
      if (entry) entries.push(entry);
      else problems.push(name ? (lines.length > 1 ? `${name} line ${line}` : name) : `line ${line}`);
    }
  }
  return {entries, problems, large};
}
async function addTurnIns(sources) {
  const {entries, problems, large} = await readTurnIns(sources);
  let result;
  try {
    result = addToInbox(entries);
  } catch (e) {
    $('inbox-status').textContent = e.message + ' Storage may be full; delete old submissions first.';
    return null;
  }
  const parts = [];
  parts.push(`Added ${result.added} submission${result.added === 1 ? '' : 's'}.`);
  if (result.already) parts.push(`${result.already} ${result.already === 1 ? 'was' : 'were'} already here.`);
  if (result.full) parts.push(`${result.full} did not fit: the inbox holds ${INBOX_LIMIT}. Delete some first.`);
  if (problems.length)
    parts.push(
      `Not a turn-in link: ${listWords(problems.slice(0, 8))}${problems.length > 8 ? ` and ${problems.length - 8} more` : ''}.`
    );
  if (large.length)
    parts.push(
      `Too large to read (over 1 MB): ${listWords(large.slice(0, 8))}${large.length > 8 ? ` and ${large.length - 8} more` : ''}.`
    );
  $('inbox-status').textContent = parts.join(' ');
  renderInbox();
  return result;
}
// Rows are grouped by assignment (by title), and sorted within each group.
const INBOX_SORTS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}) || a.at - b.at,
  goals: (a, b) => b.met - a.met || a.bars - b.bars || INBOX_SORTS.name(a, b),
  time: (a, b) => a.at - b.at || INBOX_SORTS.name(a, b)
};
function inboxGroups(list = storedInbox()) {
  const groups = new Map(),
    sort = INBOX_SORTS[$('inbox-sort').value] || INBOX_SORTS.name;
  for (const e of list) {
    if (!groups.has(e.assignment)) groups.set(e.assignment, []);
    groups.get(e.assignment).push(e);
  }
  return [...groups.values()]
    .map(entries => entries.sort(sort))
    .sort((a, b) => a[0].title.localeCompare(b[0].title) || a[0].assignment.localeCompare(b[0].assignment));
}
function renderInbox() {
  const list = storedInbox(),
    groups = inboxGroups(list);
  $('inbox-open').textContent = list.length ? `Submissions (${list.length})` : 'Submissions';
  $('inbox-clear').hidden = !list.length;
  $('inbox-list').innerHTML = groups.length
    ? groups
        .map(
          (entries, g) =>
            `<section class="inbox-group" aria-labelledby="inbox-group-${g}"><h3 id="inbox-group-${g}">${esc(entries[0].title)} <span class="small">${entries.length} turned in</span></h3><ol class="history-list inbox-list">${entries
              .map(
                e =>
                  `<li data-entry="${esc(e.id)}"><span class="inbox-who"><strong>${esc(e.name)}</strong> <span class="small">${esc(draftTime(e.at))}</span></span> <span class="inbox-goals${e.total && e.met === e.total ? ' met' : ''}">${goalWords(e.met, e.total)}</span> <span class="inbox-bars${e.bars ? ' fix' : ''}">${barWords(e.bars)}</span>${e.checks ? ` <span class="inbox-checks small">${esc(checksWords(e.checks))}</span>` : ''} <span class="history-actions"><button data-inbox-open="${esc(e.id)}" aria-label="Open the work ${esc(e.name)} turned in">Open</button><button data-inbox-delete="${esc(e.id)}" aria-label="Delete the work ${esc(e.name)} turned in">Delete</button></span></li>`
              )
              .join('')}</ol></section>`
        )
        .join('')
    : '<p class="small">No submissions yet.</p>';
}
function toggleInbox(open) {
  $('inbox-panel').hidden = !open;
  $('inbox-open').setAttribute('aria-expanded', open);
  if (open) {
    renderInbox();
    $('inbox-panel').scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
}
$('inbox-open').onclick = () => {
  const open = $('inbox-panel').hidden;
  toggleInbox(open);
  if (open) $('inbox-heading').focus({preventScroll: true});
};
$('inbox-close').onclick = () => {
  toggleInbox(false);
  $('inbox-open').focus();
};
$('inbox-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  toggleInbox(false);
  $('inbox-open').focus();
});
$('inbox-add').onclick = async () => {
  if (!$('inbox-paste').value.trim()) {
    $('inbox-status').textContent = 'Paste turn-in links first, one per line.';
    $('inbox-paste').focus();
    return;
  }
  const result = await addTurnIns([{text: $('inbox-paste').value}]);
  if (result) $('inbox-paste').value = '';
};
$('inbox-choose').onclick = () => $('inbox-file').click();
// A file over 1 MB is not read; it is reported by name with the rest.
const readFiles = files =>
  Promise.all(
    [...files].map(async f =>
      f.size > 1024 * 1024 ? {name: f.name || 'file', tooLarge: true} : {name: f.name || 'file', text: await f.text()}
    )
  );
$('inbox-file').onchange = async () => {
  await addTurnIns(await readFiles($('inbox-file').files));
  $('inbox-file').value = '';
};
// Files dropped anywhere on the panel; dropped text (a link dragged from a message) goes into the box as usual.
$('inbox-panel').addEventListener('dragover', e => {
  if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
});
$('inbox-panel').addEventListener('drop', async e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  await addTurnIns(await readFiles(e.dataTransfer.files));
});
$('inbox-sort').onchange = renderInbox;
$('inbox-clear').onclick = () => {
  const n = storedInbox().length;
  if (!n || !confirm(`Delete all ${n} submission${n === 1 ? '' : 's'} from this device?`)) return;
  storeInbox([]);
  $('inbox-status').textContent = 'Submissions cleared.';
  renderInbox();
  showSubmission(true);
  $('inbox-open').focus();
};
$('inbox-list').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b?.dataset.inboxOpen) openSubmission(b.dataset.inboxOpen);
  if (b?.dataset.inboxDelete) {
    const id = b.dataset.inboxDelete,
      list = storedInbox(),
      entry = list.find(x => x.id === id);
    if (!entry || !confirm(`Delete the work ${entry.name} turned in?`)) return;
    const row = b.closest('li'),
      next = row.nextElementSibling || row.previousElementSibling;
    storeInbox(list.filter(x => x.id !== id));
    $('inbox-status').textContent = `Deleted the work ${entry.name} turned in.`;
    renderInbox();
    showSubmission(true);
    // Focus moves to the neighboring row, or the panel heading when the list is empty.
    const target = next && $('inbox-list').querySelector(`[data-inbox-delete="${next.dataset.entry}"]`);
    (target || $('inbox-heading')).focus();
  }
});

// Teacher: opening a submission in the studio, with Previous and Next through its assignment's group.
function openSubmission(id, focus = null) {
  const entry = storedInbox().find(e => e.id === id);
  if (!entry || !allowReplace()) return false;
  saveFeedback();
  dirty = false;
  openScore({
    ...sharedItem({a: entry.abc, i: entry.instrument, s: entry.source}),
    prompt: entry.prompt,
    submission: {id: entry.id, name: entry.name, at: entry.at, assignment: entry.assignment}
  });
  $('save-status').textContent = SUBMISSION_STATUS;
  $(focus || 'submission-text')?.focus?.({preventScroll: true});
  return true;
}
// The submission bar: who turned the work in and when, its place in the class, and the feedback box. Drawn when the
// open score changes, or with force when the inbox changes.
let submissionShown = null,
  feedbackFor = null;
function showSubmission(force = false) {
  if (!force && submissionShown === current) return;
  submissionShown = current;
  const sub = current?.submission,
    bar = $('submission-bar');
  bar.hidden = !sub;
  if (!sub) {
    feedbackFor = null;
    return;
  }
  const name = cleanStudentName(sub.name) || 'a student',
    prompt = activePrompt(),
    group = inboxGroups().find(g => g[0].assignment === sub.assignment) || [],
    at = group.findIndex(e => e.id === sub.id),
    entry = group[at];
  const played = (entry || (linkEntry?.id === sub.id ? linkEntry : null))?.checks;
  $('submission-text').innerHTML =
    `Turned in by <strong>${esc(name)}</strong> · ${esc(draftTime(sub.at))}` +
    (prompt ? ` · ${esc(prompt.title)}` : '') +
    (played?.length ? ` · ${esc(checksWords(played))}` : '');
  $('submission-pos').textContent = at >= 0 ? `${at + 1} of ${group.length}` : '';
  for (const id of ['submission-prev', 'submission-next', 'submission-pos']) $(id).hidden = at < 0;
  $('submission-prev').disabled = at <= 0;
  $('submission-next').disabled = at < 0 || at >= group.length - 1;
  $('submission-add').hidden = at >= 0 || !linkEntry || linkEntry.id !== sub.id;
  $('feedback-name').textContent = name;
  // The feedback box keeps what was typed while the same submission stays open; the inbox remembers it per entry, and
  // work not in Submissions keeps it itself.
  if (feedbackFor !== sub.id) {
    feedbackFor = sub.id;
    $('feedback-text').value = entry?.feedback || sub.feedback || '';
    $('feedback-result').hidden = true;
  }
}
function stepSubmission(by) {
  const sub = current?.submission,
    group = sub && inboxGroups().find(g => g[0].assignment === sub.assignment),
    at = group ? group.findIndex(e => e.id === sub.id) : -1,
    next = at >= 0 && group[at + by];
  if (!next) return;
  saveFeedback();
  const button = by < 0 ? 'submission-prev' : 'submission-next';
  openSubmission(next.id, button);
  // At either end the button goes disabled, so focus moves to the one that still works.
  if ($(button).disabled) $(by < 0 ? 'submission-next' : 'submission-prev').focus({preventScroll: true});
}
// The typed feedback is kept on the inbox entry, so stepping away and back does not lose it. Work opened from a link
// and not added to Submissions keeps it on current.submission instead, which its unsaved-work draft carries.
let feedbackTimer = null;
function saveFeedback() {
  clearTimeout(feedbackTimer);
  feedbackTimer = null;
  const sub = current?.submission;
  if (!sub || feedbackFor !== sub.id) return;
  const list = storedInbox(),
    entry = list.find(e => e.id === sub.id),
    text = $('feedback-text').value.trim().slice(0, FEEDBACK_MAX),
    keep = entry || sub;
  if ((keep.feedback || '') === text) return;
  if (text) keep.feedback = text;
  else delete keep.feedback;
  if (entry) storeInbox(list);
  else scheduleDraft();
}
$('submission-prev').onclick = () => stepSubmission(-1);
$('submission-next').onclick = () => stepSubmission(1);
// Kept as it is typed, and when the tab is hidden or closed, so a reload with the box still focused loses nothing.
// (This runs before app.js's pagehide, which writes the draft.)
$('feedback-text').addEventListener('input', () => {
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(saveFeedback, 500);
});
$('feedback-text').addEventListener('change', saveFeedback);
window.addEventListener('pagehide', saveFeedback);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveFeedback();
});
$('submission-all').onclick = () => {
  const id = current?.submission?.id;
  saveFeedback();
  show('saved');
  toggleInbox(true);
  const open = id && $('inbox-list').querySelector(`[data-inbox-open="${id}"]`);
  (open || $('inbox-heading')).focus({preventScroll: !!open});
  open?.scrollIntoView({block: 'center'});
};
$('submission-add').onclick = () => {
  if (!linkEntry || linkEntry.id !== current?.submission?.id) return;
  let result;
  try {
    result = addToInbox([linkEntry]);
  } catch (e) {
    toast(e.message);
    return;
  }
  if (result.full) {
    toast(`Submissions holds ${INBOX_LIMIT}. Delete some first.`);
    return;
  }
  toast(result.added ? `Added the work ${linkEntry.name} turned in to Submissions.` : 'Already in Submissions.');
  // Feedback typed so far moves to the entry. Unchanged music is kept there now, so it is no longer unsaved work.
  saveFeedback();
  delete current.submission.feedback;
  if ($('abc').value === linkEntry.abc) {
    dirty = false;
    markClean();
    scheduleDraft();
    $('save-status').textContent = SUBMISSION_STATUS;
  }
  showSubmission(true);
  $('submission-all').focus();
};
// The return link: the music as it is now (with any corrections) and the assignment, plus the feedback as c. It has
// no name or time, so it opens as the student's own work again, ready to revise and turn in.
async function returnLink() {
  const text = $('feedback-text').value.trim();
  if (!text) {
    toast('Write some feedback first.');
    $('feedback-text').focus();
    return;
  }
  saveFeedback();
  flushTyping();
  const url = `${shareBase()}#s=${await encodeShare({...sharePayload(), c: text.slice(0, FEEDBACK_MAX)})}`;
  $('feedback-url').value = url;
  $('feedback-result').hidden = false;
  const name = cleanStudentName(current?.submission?.name) || 'the student';
  await copyField(
    'feedback-url',
    `Return link copied. Send it to ${name}.`,
    `Select the return link and copy it, then send it to ${name}.`
  );
}
$('feedback-link').onclick = () => returnLink().catch(e => toast('Could not make a link: ' + e.message));
$('feedback-copy').onclick = () => copyField('feedback-url', 'Return link copied.');
