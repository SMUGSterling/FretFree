'use strict';
// Feedback marks on notes (Noteflight's annotations and feedback colors): a teacher colors a note and writes a short
// comment on it, and the student sees where to fix. The marks are comment lines in the ABC (readMarks and writeMarks
// in score-tools.js), so they travel with saves, share links, backups, turned-in work and return links. Each render
// colors the marked notes and puts a numbered bubble over each comment; a bubble, or the comment's line in the list
// above the score, opens the comment with its author and time and a Resolve button. A mark whose note was taken out
// is listed as "note removed" and not drawn on another note. The colors and bubbles are left out of SVG exports
// (rights-tools.js), and out of prints unless Print comments is ticked. Every change is one undo step.
const MARK_COLOR_WORDS = {red: 'red', orange: 'orange', green: 'green', blue: 'blue'};
let feedbackMemo = {sources: null, source: null, placed: []},
  feedbackPending = null,
  commentBox = null;
// The score's notes and rests as scoreEvents entries, for anchorOf and entryForAnchor.
const feedbackEvents = () => [...new Set(noteSources.values())].filter(Boolean);
// The score's marks with the note each is on now (entry, null when its note is gone), in score order: by voice, then
// by place, with the marks whose note is gone last. number is the mark's place in that order, as the bubbles show it.
function placedFeedback() {
  const source = $('abc').value;
  if (renderedSource !== source) return feedbackMemo.placed;
  if (feedbackMemo.sources === noteSources && feedbackMemo.source === source) return feedbackMemo.placed;
  const events = feedbackEvents(),
    voice = vo => vo.split(':').map(Number),
    order = (a, b) => {
      if (!a.entry || !b.entry) return !a.entry - !b.entry;
      const [sa, va] = voice(a.mark.vo),
        [sb, vb] = voice(b.mark.vo);
      return sa - sb || va - vb || a.entry.element.startChar - b.entry.element.startChar;
    };
  const placed = readMarks(source)
    .map(mark => {
      const entry = entryForAnchor(events, mark, source),
        now = entry && anchorOf(events, entry.element.startChar, source);
      return {mark, entry: now ? entry : null, at: now || mark};
    })
    .sort(order);
  placed.forEach((p, i) => (p.number = i + 1));
  feedbackMemo = {sources: noteSources, source, placed};
  return placed;
}
const feedbackOn = entry => (entry ? placedFeedback().find(p => p.entry === entry) || null : null);
// "Measure 3, note 2", with the staff and voice in a score with more than one.
function feedbackWhere({vo, m, n}) {
  const [s, v] = vo.split(':').map(Number);
  return `Measure ${m}, note ${n}` + (s || v ? ` (staff ${s + 1}${v ? `, voice ${v + 1}` : ''})` : '');
}
const feedbackTime = at =>
  at
    ? new Date(at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
    : '';
const feedbackMeta = mark => [mark.a, feedbackTime(mark.at)].filter(Boolean).join(' · ');
// Words for the status line when a marked note is selected (noteDescription).
function feedbackSaid(entry) {
  const p = feedbackOn(entry);
  if (!p) return '';
  const {t, a, c} = p.mark;
  return t ? `, comment ${p.number}${a ? ` from ${a}` : ''}: “${t}”` : `, marked ${MARK_COLOR_WORDS[c]}`;
}

// Drawing, after each render: the class on the marked heads (or the rest) gives them the mark's color on screen, and
// a bubble with the comment's number goes over each note with a comment. A score drawn while the studio is hidden
// cannot be measured, so its bubbles wait until the studio shows.
function updateFeedbackMarks() {
  const placed = embedView ? [] : placedFeedback();
  showFeedbackList(placed);
  drawFeedback(placed);
  updateTeacherTools();
  if (typeof keepSubmissionMarks === 'function') keepSubmissionMarks();
  // Another score opened (its history starts again), or the comment taken out another way (undo, an edit to the ABC),
  // closes the box without saving; the keyboard stays where it is.
  if (
    commentBox &&
    (commentBox.history !== editHistory || (commentBox.id && !placed.some(p => p.mark.id === commentBox.id)))
  )
    closeCommentBox(null, false);
  else if (commentBox) placeCommentBox();
}
function drawFeedback(placed = placedFeedback()) {
  const svg = $('notation').querySelector('svg');
  feedbackPending = null;
  if (!svg) return;
  svg.querySelectorAll('.feedback-bubble').forEach(b => b.remove());
  const shown = placed.filter(p => p.entry);
  if (!shown.length) return;
  const byStart = new Map((renderedTune?.engraver?.selectables || []).map(s => [s.absEl.abcelem.startChar, s.svgEl])),
    bubbles = [];
  for (const p of shown) {
    const el = byStart.get(displayOf(p.entry)?.startChar);
    if (!el) continue;
    const heads = el.querySelectorAll('.abcjs-notehead');
    for (const part of heads.length ? heads : el.querySelectorAll('path'))
      part.classList.add('feedback-head', 'mark-' + p.mark.c);
    if (p.mark.t) bubbles.push({p, el});
  }
  if (!bubbles.length) return;
  if (!svg.getBoundingClientRect().width) {
    feedbackPending = renderedTune;
    return;
  }
  // A bubble is 20 by 18 score units, and at least 22 pixels wide on screen, so a phone's narrower score keeps it
  // big enough to tap. Its tail points down at the note, just clear of it.
  const ns = 'http://www.w3.org/2000/svg',
    width = +svg.getAttribute('viewBox')?.split(/[ ,]+/)[2] || svg.getBoundingClientRect().width,
    k = Math.max(1, 22 / 20 / (svg.getBoundingClientRect().width / width || 1)),
    boxes = bubbles.map(({el}) => {
      try {
        return el.getBBox();
      } catch {
        return null;
      }
    });
  bubbles.forEach(({p, el}, i) => {
    const box = boxes[i];
    if (!box) return;
    const g = document.createElementNS(ns, 'g'),
      hit = document.createElementNS(ns, 'rect'),
      path = document.createElementNS(ns, 'path'),
      text = document.createElementNS(ns, 'text'),
      title = document.createElementNS(ns, 'title');
    g.setAttribute('class', 'feedback-bubble mark-' + p.mark.c);
    g.setAttribute('data-mark', p.mark.id);
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute(
      'transform',
      `translate(${(box.x + box.width / 2 - 10 * k).toFixed(2)} ${Math.max(1, box.y - 2 - 18 * k).toFixed(2)}) scale(${k.toFixed(3)})`
    );
    // A clear margin around the bubble, but not over the note, is what a finger has to hit.
    hit.setAttribute('class', 'feedback-hit');
    hit.setAttribute('x', -4);
    hit.setAttribute('y', -4);
    hit.setAttribute('width', 28);
    hit.setAttribute('height', 22);
    path.setAttribute(
      'd',
      'M 3 0 h 14 a 3 3 0 0 1 3 3 v 8 a 3 3 0 0 1 -3 3 h -4 l -3 4 l -3 -4 h -4 a 3 3 0 0 1 -3 -3 v -8 a 3 3 0 0 1 3 -3 z'
    );
    text.setAttribute('x', 10);
    text.setAttribute('y', 7.3);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.textContent = String(p.number);
    title.textContent = `Comment ${p.number}: ${p.mark.t}${p.mark.a ? ` (${p.mark.a})` : ''}`;
    g.append(title, hit, path, text);
    svg.appendChild(g);
  });
}
if (typeof MutationObserver === 'function')
  new MutationObserver(() => {
    if (feedbackPending && feedbackPending === renderedTune && !$('studio').hidden) drawFeedback();
  }).observe($('studio'), {attributes: true, attributeFilter: ['hidden']});

// The list above the score: every mark in score order, numbered as the bubbles are, with Show and Resolve.
function showFeedbackList(placed) {
  $('marks-panel').hidden = !placed.length;
  $('marks-heading').textContent = `Comments on notes (${placed.length})`;
  $('marks-list').innerHTML = placed
    .map(({mark, entry, at, number}) => {
      const where = feedbackWhere(at),
        text = mark.t
          ? `<span class="mark-text">${esc(mark.t)}</span>`
          : `<span class="mark-text mark-plain">Marked ${MARK_COLOR_WORDS[mark.c]}</span>`,
        meta = feedbackMeta(mark);
      return (
        `<li class="mark-item mark-${mark.c}${entry ? '' : ' orphan'}"><span class="mark-number" aria-hidden="true">${number}</span>` +
        `<div class="mark-body">${
          entry
            ? `<button type="button" class="mark-where" data-mark-show="${esc(mark.id)}" aria-haspopup="dialog">${esc(where)}</button>`
            : `<span class="mark-where">${esc(where)} · note removed</span>`
        }${text}${meta ? `<span class="mark-meta">${esc(meta)}</span>` : ''}</div>` +
        `<button type="button" class="mark-resolve" data-mark-resolve="${esc(mark.id)}" aria-label="Resolve: ${esc(where)}">✓ Resolve</button></li>`
      );
    })
    .join('');
}
$('marks-list').addEventListener('click', e => {
  const show = e.target.closest('[data-mark-show]'),
    resolve = e.target.closest('[data-mark-resolve]');
  if (!show && !resolve) return;
  if (!freshScore()) return;
  if (resolve) return resolveFeedback(resolve.dataset.markResolve);
  const p = placedFeedback().find(q => q.mark.id === show.dataset.markShow);
  if (!p?.entry) return;
  selectEntry(p.entry);
  openCommentBox(p.entry, {mode: 'view', opener: show});
});
$('print-comments').addEventListener('change', () =>
  document.body.classList.toggle('print-comments', $('print-comments').checked)
);
// A click or tap on a bubble opens its comment. The bubble is over the score, so abcjs, drag and draw mode must not
// take the press for a click on the staff: it stops here, before it reaches the score.
for (const type of ['mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu'])
  document.addEventListener(
    type,
    e => {
      const bubble = e.target.closest?.('#notation .feedback-bubble');
      if (!bubble) return;
      e.stopPropagation();
      if (type === 'contextmenu') e.preventDefault();
      if (type !== 'click' || !freshScore()) return;
      if (typeof closeNoteMenu === 'function') closeNoteMenu();
      const p = placedFeedback().find(q => q.mark.id === bubble.dataset.mark);
      if (!p?.entry) return;
      selectEntry(p.entry);
      openCommentBox(p.entry, {mode: 'view'});
    },
    {capture: true, passive: type !== 'contextmenu'}
  );
// The score must be drawn from the text as it is now before a mark is placed or changed.
function freshScore() {
  if (renderedSource === $('abc').value) return true;
  clearTimeout(renderTimer);
  render();
  toast('Score updated. Try again.');
  return false;
}

// Writing marks: the new list goes into the ABC as one undo step. Marks still on their notes are anchored again where
// those notes are now, so later edits are measured from here. Mark lines found before the selection (music added
// after them) move to the end, and the selection moves back with its note.
function storeFeedback(next, message) {
  flushTyping();
  const area = $('abc'),
    source = area.value,
    events = feedbackEvents(),
    placed = renderedSource === source ? placedFeedback() : [];
  const marks = next.map(mark => {
    const entry = placed.find(p => p.mark.id === mark.id)?.entry,
      anchor = entry && anchorOf(events, entry.element.startChar, source);
    return anchor ? {...mark, ...anchor} : mark;
  });
  const after = writeMarks(source, marks);
  if (after === source) return false;
  const lines = source.split('\n'),
    removedBefore = at => {
      let pos = 0,
        removed = 0;
      for (const line of lines) {
        if (pos >= at) break;
        if (MARK_LINE.test(line)) removed += line.length + 1;
        pos += line.length + 1;
      }
      return removed;
    };
  if (selectedRange) selectedRange = selectedRange.map(at => at - removedBefore(at));
  area.value = after;
  dirty = true;
  $('save-status').textContent = 'Unsaved changes';
  clearTimeout(renderTimer);
  render();
  if (selectedRange) area.setSelectionRange(...selectedRange);
  $('selection-status').textContent = message;
  return true;
}
const newFeedbackId = marks => {
  let id;
  do id = (Date.now() % 1e9).toString(36) + Math.floor(Math.random() * 1296).toString(36);
  while (marks.some(m => m.id === id));
  return id;
};
const rememberedAuthor = () => markString(storage.get(KEYS.markAuthor, ''), MARK_AUTHOR_MAX);
function resolveFeedback(id) {
  const marks = readMarks($('abc').value),
    mark = marks.find(m => m.id === id);
  if (!mark) return;
  closeCommentBox(null, false);
  storeFeedback(
    marks.filter(m => m !== mark),
    mark.t ? 'Comment resolved and removed.' : 'Color mark removed.'
  );
  toast(mark.t ? 'Comment resolved.' : 'Color mark removed.');
}
// A color for the note: a new mark without a comment, or a new color for the note's mark. The color the note already
// has, on a mark without a comment, takes the mark away.
function colorFeedback(entry, color) {
  const source = $('abc').value,
    marks = readMarks(source),
    p = feedbackOn(entry),
    anchor = anchorOf(feedbackEvents(), entry.element.startChar, source);
  if (!anchor || !MARK_COLORS.includes(color)) return;
  const where = feedbackWhere(anchor);
  if (p && p.mark.c === color && !p.mark.t) {
    storeFeedback(
      marks.filter(m => m.id !== p.mark.id),
      `${where}: color mark removed.`
    );
    return;
  }
  const next = p
    ? marks.map(m => (m.id === p.mark.id ? {...m, c: color} : m))
    : [...marks, {...anchor, c: color, a: rememberedAuthor(), at: Date.now(), id: newFeedbackId(marks)}];
  storeFeedback(next, `${where} marked ${MARK_COLOR_WORDS[color]}.`);
}

// The note menu's Feedback items: Comment…, a color for each mark color, and Resolve when the note has a mark.
function feedbackMenuHTML(entry) {
  if (embedView) return '';
  const mark = feedbackOn(entry)?.mark,
    short = t => (t.length > 24 ? t.slice(0, 23) + '…' : t);
  return (
    `<div class="menu-label">FEEDBACK</div>` +
    `<button role="menuitem" data-edit="mark:comment" aria-haspopup="dialog">💬 ${mark?.t ? 'Comment: ' + esc(short(mark.t)) : 'Comment'}…</button>` +
    `<div class="menu-row menu-mark-colors">${MARK_COLORS.map(
      c =>
        `<button role="menuitemradio" aria-checked="${mark?.c === c}" data-edit="mark:color:${c}" aria-label="Mark ${MARK_COLOR_WORDS[c]}" title="Mark the note ${MARK_COLOR_WORDS[c]}"><span class="mark-swatch mark-${c}" aria-hidden="true"></span></button>`
    ).join('')}</div>` +
    (mark
      ? `<button role="menuitem" data-edit="mark:resolve">✓ ${mark.t ? 'Resolve comment' : 'Remove color'}</button>`
      : '')
  );
}
function feedbackMenuAction(picked, action) {
  const [, kind, color] = action.split(':');
  if (kind === 'comment') openCommentBox(picked.entry, {mode: 'edit'});
  else if (kind === 'color') colorFeedback(picked.entry, color);
  else if (kind === 'resolve') {
    const p = feedbackOn(picked.entry);
    if (p) resolveFeedback(p.mark.id);
  }
}

// The comment box over the score, by the note: the comment, its author and time with Edit and Resolve (view), or a
// box to write it with the author's name and the color (edit). opener is where the keyboard goes back to.
function openCommentBox(entry, {mode = 'edit', opener = null} = {}) {
  const display = displayOf(entry),
    source = $('abc').value,
    anchor = display && anchorOf(feedbackEvents(), entry.element.startChar, source);
  if (!anchor) return;
  if (typeof closeChordEntry === 'function' && chordEditing) closeChordEntry(chordEditing);
  const p = feedbackOn(entry),
    mark = p?.mark || null;
  if (mode === 'view' && !mark) mode = 'edit';
  commentBox = {id: mark?.id || null, anchor, start: entry.element.startChar, mode, opener, history: editHistory};
  const where = feedbackWhere(anchor);
  $('mark-title').textContent = mark?.t
    ? `Comment ${p.number} on ${where.toLowerCase()}`
    : mark
      ? `${where}, marked ${MARK_COLOR_WORDS[mark.c]}`
      : `Comment on ${where.toLowerCase()}`;
  $('mark-box').className = `chord-entry mark-box mark-${mark?.c || 'red'}`;
  $('mark-view').hidden = mode !== 'view';
  $('mark-form').hidden = mode !== 'edit';
  if (mode === 'view') {
    $('mark-view-text').textContent = mark.t || 'No comment, just the color.';
    $('mark-view-text').classList.toggle('mark-plain', !mark.t);
    $('mark-view-meta').textContent = feedbackMeta(mark);
    $('mark-view-meta').hidden = !feedbackMeta(mark);
  } else {
    $('mark-text').value = mark?.t || '';
    $('mark-author').value = rememberedAuthor() || mark?.a || '';
    for (const radio of document.querySelectorAll('[name="mark-color"]'))
      radio.checked = radio.value === (mark?.c || 'red');
    $('mark-form-resolve').hidden = !mark;
  }
  $('mark-box').hidden = false;
  placeCommentBox();
  (mode === 'view' ? $('mark-close') : $('mark-text')).focus({preventScroll: true});
  $('mark-box').scrollIntoView?.({block: 'nearest'});
}
// Just above the note (below it near the top of the score), inside the score's paper, like the chord symbol box.
function placeCommentBox() {
  const box = $('mark-box'),
    paper = box.parentElement,
    entry = commentBox && scoreNotes().find(e => e.element.startChar === commentBox.start),
    display = entry && displayOf(entry),
    note = display && renderedTune?.engraver?.selectables?.find(s => s.absEl.abcelem.startChar === display.startChar),
    rect = note?.svgEl.getBoundingClientRect?.(),
    outer = paper.getBoundingClientRect();
  if (!rect) return;
  const left = rect.left - outer.left - paper.clientLeft + paper.scrollLeft,
    top = rect.top - outer.top - paper.clientTop + paper.scrollTop,
    above = top - box.offsetHeight - 6;
  box.style.left =
    Math.max(paper.scrollLeft + 4, Math.min(left - 8, paper.scrollLeft + paper.clientWidth - box.offsetWidth - 4)) +
    'px';
  box.style.top = (above >= 4 ? above : top + rect.height + 6) + 'px';
}
function closeCommentBox(focusTo = null, refocus = true) {
  const box = commentBox;
  commentBox = null;
  $('mark-box').hidden = true;
  if (!refocus) return;
  const to = focusTo || box?.opener;
  if (to?.isConnected && !to.closest('[hidden]')) to.focus({preventScroll: true});
  else focusScore();
}
function saveComment() {
  const box = commentBox;
  if (!box) return;
  // A comment begun on another score is not saved on this one.
  if (box.history !== editHistory) return closeCommentBox();
  if (!freshScore()) return;
  const source = $('abc').value,
    marks = readMarks(source),
    text = markString($('mark-text').value, MARK_TEXT_MAX),
    author = markString($('mark-author').value, MARK_AUTHOR_MAX).replace(/\s+/g, ' '),
    color = document.querySelector('[name="mark-color"]:checked')?.value || 'red',
    where = feedbackWhere(box.anchor),
    old = box.id && marks.find(m => m.id === box.id);
  storage.set(KEYS.markAuthor, author);
  let next, message;
  if (old) {
    next = marks.map(m => (m === old ? {...m, c: color, t: text, a: author, at: Date.now()} : m));
    message = text ? `Comment on ${where.toLowerCase()} saved.` : `${where} marked ${MARK_COLOR_WORDS[color]}.`;
  } else {
    // The note can have moved in the text since the box opened (an edit elsewhere): its anchor finds it.
    const entry = entryForAnchor(feedbackEvents(), box.anchor, source);
    if (!entry) {
      closeCommentBox();
      toast('That note is no longer in the score.');
      return;
    }
    const anchor = anchorOf(feedbackEvents(), entry.element.startChar, source);
    next = [...marks, {...anchor, c: color, t: text, a: author, at: Date.now(), id: newFeedbackId(marks)}];
    message = text ? `Comment added to ${where.toLowerCase()}.` : `${where} marked ${MARK_COLOR_WORDS[color]}.`;
  }
  closeCommentBox();
  storeFeedback(next, message);
  if (box.opener?.isConnected && !box.opener.closest('[hidden]')) box.opener.focus({preventScroll: true});
}
$('mark-save').addEventListener('click', saveComment);
$('mark-cancel').addEventListener('click', () => closeCommentBox());
$('mark-close').addEventListener('click', () => closeCommentBox());
$('mark-edit').addEventListener('click', () => {
  const entry = commentBox && scoreNotes().find(e => e.element.startChar === commentBox.start);
  if (entry) openCommentBox(entry, {mode: 'edit', opener: commentBox.opener});
});
for (const id of ['mark-resolve', 'mark-form-resolve'])
  $(id).addEventListener('click', () => {
    if (commentBox?.id && freshScore()) {
      const {opener} = commentBox;
      resolveFeedback(commentBox.id);
      if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus({preventScroll: true});
      else focusScore();
    }
  });
$('mark-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    saveComment();
  }
});
// Escape closes the box; Enter in the name or on a color saves, as it does in the comment.
$('mark-box').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('#mark-author, [name="mark-color"]') && !e.isComposing) {
    e.preventDefault();
    saveComment();
  }
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeCommentBox();
});
// A press elsewhere closes the comment when it is only shown; a comment being written waits for Save or Cancel.
document.addEventListener('mousedown', e => {
  if (commentBox?.mode === 'view' && !$('mark-box').contains(e.target) && !e.target.closest?.('.feedback-bubble'))
    closeCommentBox(null, false);
});
// The teacher's Feedback group in the note-entry bar (the studio's teacher-tools slot): Comment and the four colors for
// the selected note, shown while turned-in work is open, so marking a student's notes takes one press each. A color
// is pressed when the selected note has it; pressing it again takes a color alone off, as in the note menu.
function updateTeacherTools() {
  const tools = $('teacher-tools');
  tools.hidden = embedView || $('submission-bar').hidden;
  if (tools.hidden) return;
  const sel = renderedSource === $('abc').value ? selectedNote() : null,
    color = (sel && feedbackOn(sel.entry)?.mark.c) || '';
  for (const b of tools.querySelectorAll('[data-teacher^="color:"]'))
    b.setAttribute('aria-pressed', b.dataset.teacher === 'color:' + color);
}
$('teacher-tools').addEventListener('click', e => {
  const b = e.target.closest('[data-teacher]');
  if (!b) return;
  const keyboard = e.detail === 0,
    [kind, color] = b.dataset.teacher.split(':');
  if (kind === 'comment') return commentSelected(keyboard ? b : null);
  if (!freshScore()) return;
  const sel = selectedNote();
  if (!sel?.display) {
    $('selection-status').textContent = 'Select a note on the score first, then choose a color.';
    toast('Select a note on the score first.');
    return;
  }
  colorFeedback(sel.entry, color);
  updateTeacherTools();
  // A pointer press gives the keyboard back to the score, so arrow keys go on to the next note to mark.
  (keyboard ? b : $('notation')).focus({preventScroll: true});
});
if (typeof MutationObserver === 'function')
  new MutationObserver(updateTeacherTools).observe($('submission-bar'), {
    attributes: true,
    attributeFilter: ['hidden']
  });

// 💬 Comment in the notation palette (palette.js): the selected note's comment, or a new one. opener is the button
// after a keyboard press, so the keyboard goes back to it.
function commentSelected(opener = null) {
  if (renderedSource !== $('abc').value) {
    clearTimeout(renderTimer);
    render();
  }
  const sel = selectedNote();
  if (!sel?.display) {
    $('selection-status').textContent = 'Select a note on the score first, then choose Comment.';
    toast('Select a note on the score first.');
    return;
  }
  openCommentBox(sel.entry, {mode: feedbackOn(sel.entry)?.mark.t ? 'view' : 'edit', opener});
}
