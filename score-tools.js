'use strict';
// Match musical events, never character offsets in the altered display string.
function scoreEvents(tune) {
  const counts = new Map(),
    bars = new Map(),
    occupied = new Map(),
    out = [];
  for (const line of tune.lines || [])
    for (const [s, staff] of (line.staff || []).entries())
      for (const [v, voice] of staff.voices.entries()) {
        const id = s + ':' + v;
        for (const element of voice) {
          if (!['note', 'bar'].includes(element.el_type)) continue;
          const ordinal = counts.get(id) || 0;
          counts.set(id, ordinal + 1);
          const measure = bars.get(id) || 1;
          out.push({element, key: id + ':' + ordinal, measure});
          if (element.el_type === 'note') occupied.set(id, true);
          if (element.el_type === 'bar' && occupied.get(id)) {
            bars.set(id, measure + 1);
            occupied.set(id, false);
          }
        }
      }
  return out;
}
// Sounding length of each note in whole notes. abcjs puts a tuplet's multiplier only on its first note,
// so carry it per voice until the note marked endTriplet.
function effectiveDurations(events) {
  const out = new Map(),
    tuplet = new Map();
  for (const {element, key} of events) {
    if (element.el_type !== 'note') continue;
    const voice = key.split(':').slice(0, 2).join(':');
    if (element.startTriplet) tuplet.set(voice, element.tripletMultiplier || 1);
    out.set(element, (element.duration || 0) * (tuplet.get(voice) || 1));
    if (element.endTriplet) tuplet.delete(voice);
  }
  return out;
}
function sourceMap(original, display) {
  const originals = new Map(scoreEvents(original).map(e => [e.key, e]));
  return new Map(scoreEvents(display).map(e => [e.element.startChar, originals.get(e.key)]));
}
function pitchToken(pitch) {
  const names = 'CDEFGAB',
    octave = Math.floor(pitch / 7),
    letter = names[((pitch % 7) + 7) % 7];
  return octave <= 0 ? letter + ','.repeat(-octave) : letter.toLowerCase() + "'".repeat(octave - 1);
}
// Shift a note or chord diatonically; keep rhythm, ties, explicit accidentals and decorations.
function moveNoteText(text, steps) {
  let result = '',
    i = 0;
  while (i < text.length) {
    const c = text[i];
    let end;
    if (['"', '!', '+'].includes(c)) {
      end = text.indexOf(c, i + 1);
      if (end < 0) end = text.length - 1;
      result += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '{') {
      end = text.indexOf('}', i + 1);
      if (end < 0) end = text.length - 1;
      result += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '[' && /^[A-Za-z]:/.test(text.slice(i + 1))) {
      end = text.indexOf(']', i + 1);
      if (end < 0) end = text.length - 1;
      result += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const match = text.slice(i).match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/);
    if (match) {
      const pitch =
        'CDEFGAB'.indexOf(match[2].toUpperCase()) +
        (match[2] === match[2].toLowerCase() ? 7 : 0) +
        [...match[3]].reduce((n, c) => n + (c === "'" ? 7 : -7), 0);
      result += (match[1] || '') + pitchToken(pitch + steps);
      i += match[0].length;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}
// Notes sounding between from and until (score seconds), rebased to 0 and scaled to the playback speed. Range edges
// come from abcjs's note timings, in whole milliseconds, and the notes from the MIDI, in ticks at a tempo in whole
// microseconds, so at most tempos (quarter = 180: a bar of 1.333 s against 1.333332 s) the note before a range ends
// just after it starts and the next bar's first note starts just before it ends; in long scores the two drift apart
// by a few milliseconds more. A note that overlaps the range by less than SLICE_EDGE stays out: scheduled, it
// sounded as a click at full volume. parseMidi gives every note at least 25 ms, so no whole note is that short.
const SLICE_EDGE = 0.01;
function playbackSlice(data, from, percent, until = data.duration) {
  const speed = percent / 100;
  return {
    duration: Math.max(0, (until - from) / speed),
    notes: data.notes
      .filter(n => n.start + n.duration > from + SLICE_EDGE && n.start < until - SLICE_EDGE)
      .map(n => ({
        ...n,
        start: Math.max(0, n.start - from) / speed,
        duration: (Math.min(n.start + n.duration, until) - Math.max(from, n.start)) / speed
      }))
  };
}
// ABC lengths are multiples of L:, written as a reduced fraction. 1 -> '', 2 -> '2', .5 -> '/2', 1.5 -> '3/2', 2/3 -> '2/3'.
function lengthText(value) {
  let q = 1;
  while (q < 96 && Math.abs(value * q - Math.round(value * q)) > 1e-9) q++;
  const p = Math.round(value * q);
  return q === 1 ? (p === 1 ? '' : String(p)) : p === 1 ? '/' + q : p + '/' + q;
}
function lengthValue(text) {
  const m = String(text).match(/^(\d*)(\/*)(\d*)$/);
  if (!m) return 1;
  const num = m[1] ? +m[1] : 1;
  return m[2] ? num / (m[3] ? +m[3] : 2 ** m[2].length) : num;
}
// Decorations/annotations, slur openings and tuplet specs ((3, (3:2, (3:2:3) in any order, then a note, chord or
// rest, then its length, then ties, slur ends or broken rhythm.
const NOTE_PARTS =
  /^((?:"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|\((?:\d+(?::\d*){0,2})?|[.~HLMOPSTuv]|\s)*)(\[[^\]]*\]|(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][,']*|[zx])(\d*\/*\d*)([^]*)$/;
function noteParts(text) {
  const m = String(text).match(NOTE_PARTS);
  return m && {pre: m[1], core: m[2], length: lengthValue(m[3]), post: m[4]};
}
// What follows a note in its source text: spaces and line continuations (\), which abcjs counts as part of the last
// note on a line. noteHead is the note without it. Edits that rewrite a note keep its tail after the new text.
const NOTE_TAIL = /[\s\\]*$/,
  noteTail = text => String(text).match(NOTE_TAIL)[0],
  noteHead = text => String(text).replace(NOTE_TAIL, '');
// Set the accidental ('^', '_', '=', or '' for none) and/or length (multiple of L:) on every pitch of a note or chord.
// A new length replaces any per-pitch chord lengths; unbroken drops a trailing > or < broken-rhythm marker; tie adds or removes the tie (-).
// rest replaces the note or chord with a rest of the same length, keeping decorations, slurs and tuplet marks.
function editNoteText(text, {accidental, length, unbroken, tie, rest} = {}) {
  const m = String(text).match(NOTE_PARTS);
  if (!m) return text;
  let [, pre, core, len, post] = m;
  if (accidental != null) core = core.replace(/(\^{1,2}|_{1,2}|=)?([A-Ga-g])/g, (_, a, letter) => accidental + letter);
  if (length != null) {
    len = lengthText(length);
    if (core[0] === '[') core = core.replace(/([A-Ga-g][,']*)\d*\/*\d*/g, '$1');
  }
  if (rest) {
    const inner = core[0] === '[' ? core.match(/[A-Ga-g][,']*(\d*\/*\d*)/)?.[1] : '';
    if (inner) len = lengthText(lengthValue(inner) * lengthValue(len));
    core = 'z';
    post = post.replace(/^-/, '');
  }
  if (unbroken) post = post.replace(/[<>]+/g, '');
  if (tie === true && !/^-/.test(post)) post = '-' + post;
  if (tie === false) post = post.replace(/^-/, '');
  return pre + core + len + post;
}
// Articulations, ornaments and dynamics offered by the editor, as abcjs names them. Each one parses without warnings,
// and dynamics, accents, marcato and staccato change playback (see midiBytes); abcjs plays ornaments with fixed
// neighbour notes, whatever the key. abcjs knows staccato only as '.' and has no fp or !staccatissimo! (wedge is the
// staccatissimo mark).
const NOTE_MARKS = [
  'staccato',
  'tenuto',
  'accent',
  'marcato',
  'fermata',
  'wedge',
  'upbow',
  'downbow',
  'breath',
  'trill',
  'mordent',
  'turn',
  'arpeggio'
];
const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz'];
// One item of a note's prefix (the items NOTE_PARTS allows), and the prefix of a note, chord or rest, including a
// multi-measure rest (Z), which can carry a dynamic or a fermata. Invisible rests (x) take no marks.
const PRE_ITEM = /"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|\((?:\d+(?::\d*){0,2})?|[.~HLMOPSTuv]|\s/g;
const MARK_PRE = new RegExp(`^(?:${PRE_ITEM.source})*(?=[[A-Ga-g^_=zZ])`);
// Shorthands and other spellings of the marks: . H L T u v M, !>!, !emphasis!, !lowermordent! and +name+.
const MARK_ALIASES = {
  '.': 'staccato',
  H: 'fermata',
  L: 'accent',
  T: 'trill',
  u: 'upbow',
  v: 'downbow',
  M: 'mordent',
  '>': 'accent',
  emphasis: 'accent',
  lowermordent: 'mordent'
};
// Any dynamic a score may already have, including ones the editor does not offer, so setDynamic replaces it.
const DYNAMIC_MARK = /^(?:p{1,4}|f{1,4}|m[pf]|sfz?|sffz|fz|rfz|s?fp)$/;
function markName(item) {
  const name = /^([!+])(.*)\1$/.exec(item)?.[2] ?? item;
  return MARK_ALIASES[name] || name;
}
// A note's prefix split into items, and the rest of its text; null when the text is not a note, chord or rest.
function markItems(text) {
  const pre = String(text).match(MARK_PRE)?.[0];
  return pre == null ? null : {items: pre.match(PRE_ITEM) || [], rest: String(text).slice(pre.length)};
}
const isDynamicItem = item => !!item.trim() && DYNAMIC_MARK.test(markName(item));
// The marks on a note: its articulations and ornaments (canonical names, in source order) and its dynamic.
function noteMarks(text) {
  const parts = markItems(text);
  if (!parts) return null;
  const names = parts.items.filter(i => i.trim()).map(markName);
  return {marks: names.filter(n => NOTE_MARKS.includes(n)), dynamic: names.find(n => DYNAMIC_MARK.test(n)) || null};
}
// Add an articulation or ornament just before the pitch (after chord symbols, annotations, slur and tuplet openings
// and grace notes), or remove it in whatever spelling it has. Staccato is written '.', the others !name!.
function toggleDecoration(text, name) {
  const parts = markItems(text);
  if (!parts || !NOTE_MARKS.includes(name)) return text;
  const kept = parts.items.filter(i => !i.trim() || markName(i) !== name);
  if (kept.length === parts.items.length) kept.push(name === 'staccato' ? '.' : `!${name}!`);
  return kept.join('') + parts.rest;
}
// Set the note's dynamic (one of DYNAMICS) in place of any it has, or remove it with null. Dynamics never stack.
function setDynamic(text, dyn) {
  const parts = markItems(text);
  if (!parts || (dyn != null && !DYNAMICS.includes(dyn))) return text;
  let placed = !dyn;
  const items = parts.items.map(i => {
    if (!isDynamicItem(i)) return i;
    if (placed) return '';
    placed = true;
    return `!${dyn}!`;
  });
  if (!placed) items.push(`!${dyn}!`);
  return items.join('') + parts.rest;
}
// Tuplets. makeTuplet splits one note or rest into p members that together last as long as it did: the note becomes
// the first member and rests fill the others, so typing letters fills them. A plain note (whole, half, quarter …)
// splits into p in the time of the power of two below p (3:2, 5:4, 6:4, 7:4); a dotted note into p in the time of
// 3 or 6 (2:3, 4:3, 5:3, 7:6). A count that only gives ordinary lengths (2 on a plain note, 3 or 6 on a dotted
// one) makes no tuplet, and neither does any other length. tupletRatio gives q for a length in whole notes.
function tupletRatio(whole, p) {
  const exact = k => Math.abs(k - Math.round(k)) < 1e-9,
    base = exact(Math.log2(whole)) ? 1 : exact(Math.log2(whole / 3)) ? 3 : 0;
  if (!base || !Number.isInteger(p) || p < 2 || p > 9) return null;
  let q = base;
  while (q * 2 < p) q *= 2;
  return exact(Math.log2(p / q)) ? null : q;
}
// (3 and (2 are written short, as ABC reads them by default (3 in the time of 2, 2 in the time of 3); others in full.
const TUPLET_DEFAULT_Q = {2: 3, 3: 2, 4: 3, 6: 2, 8: 3},
  TUPLET_ITEM = /^\((\d+)(?::(\d*))?(?::(\d*))?$/;
// The tuplet opening in a note's prefix ({index, text, p}), or null.
function tupletSpec(text) {
  const pre = noteParts(text)?.pre;
  let index = 0;
  for (const item of pre?.match(PRE_ITEM) || []) {
    const m = TUPLET_ITEM.exec(item);
    if (m) return {index, text: item, p: +m[1]};
    index += item.length;
  }
  return null;
}
// A note's length in multiples of L: from noteParts. A chord's length can also be written on its pitches ([C2E2]);
// the first pitch's counts, as abcjs reads it.
function partsLength(parts) {
  const inner = parts.core[0] === '[' ? parts.core.match(/[A-Ga-g][,']*(\d*\/*\d*)/)?.[1] : '';
  return parts.length * (inner ? lengthValue(inner) : 1);
}
// The members of a p-tuplet made from a note or rest of L: unit (a whole-note fraction), first to last, or null when
// it makes none (see tupletRatio), a member would be shorter than a 64th, or the note already starts a tuplet or is
// half of a broken rhythm. The first member keeps the note's marks, chord symbol, grace notes and slurs, and loses
// its tie; the opening goes just before its pitch, but before a staccato dot, since abcjs reads .( as a dotted slur.
function tupletMembers(text, p, unit) {
  const note = noteHead(text),
    parts = noteParts(note);
  if (!parts || parts.core === 'x' || /[<>]/.test(parts.post) || tupletSpec(text)) return null;
  const length = partsLength(parts),
    q = tupletRatio(length * unit, p),
    member = length / (q || 1);
  if (!q || member * unit < 1 / 64 - 1e-9) return null;
  const first = editNoteText(note, {length: member, tie: false}),
    pre = noteParts(first).pre,
    items = pre.match(PRE_ITEM) || [];
  let at = items.length;
  while (at > 0 && items[at - 1] === '.') at--;
  items.splice(at, 0, TUPLET_DEFAULT_Q[p] === q ? `(${p}` : `(${p}:${q}:${p}`);
  return [items.join('') + first.slice(pre.length), ...Array(p - 1).fill('z' + lengthText(member))];
}
// The tuplet as text, with the note's tail after its last member: (3C/2 z/2 z/2 for a quarter in L:1/4.
function makeTuplet(text, p, unit) {
  const members = tupletMembers(text, p, unit);
  return members && members.join(' ') + noteTail(text);
}
// Whether a length in whole notes can be written as one note: plain, dotted or double-dotted.
function oneNoteLength(whole) {
  return [1, 1.5, 1.75].some(dots => {
    const k = Math.log2(whole / dots);
    return Math.abs(k - Math.round(k)) < 1e-9;
  });
}
// Grace notes: the {…} group before a note ({index, text, slashed}), or null. setGrace adds one ({d} one step above
// the note's top pitch, {/d} when slashed), sets or clears the slash of the group already there, or removes it
// (grace null). A new group goes before slur and tuplet openings, since abcjs starts a note's text after any mark
// that follows a (, and otherwise just before the pitch. Rests get none.
function graceOf(text) {
  const pre = noteParts(text)?.pre;
  let index = 0;
  for (const item of pre?.match(PRE_ITEM) || []) {
    if (item[0] === '{') return {index, text: item, slashed: item[1] === '/'};
    index += item.length;
  }
  return null;
}
function setGrace(text, grace) {
  const parts = noteParts(text);
  if (!parts) return text;
  const items = parts.pre.match(PRE_ITEM) || [],
    at = items.findIndex(i => i[0] === '{'),
    rest = String(text).slice(parts.pre.length);
  if (!grace) {
    if (at >= 0) items.splice(at, 1);
  } else if (at >= 0) items[at] = (grace.slashed ? '{/' : '{') + items[at].replace(/^\{\/?/, '');
  else if (/^[zx]/.test(parts.core)) return text;
  else {
    const top = Math.max(
        ...[...parts.core.matchAll(/([A-Ga-g])([,']*)/g)].map(
          ([, letter, marks]) =>
            'CDEFGAB'.indexOf(letter.toUpperCase()) +
            (letter === letter.toLowerCase() ? 7 : 0) +
            [...marks].reduce((n, c) => n + (c === "'" ? 7 : -7), 0)
        )
      ),
      open = items.findIndex(i => i[0] === '(');
    items.splice(open < 0 ? items.length : open, 0, `{${grace.slashed ? '/' : ''}${pitchToken(top + 1)}}`);
  }
  return items.join('') + rest;
}
// Move only the grace notes by diatonic steps, keeping their accidentals, lengths and slash.
function moveGrace(text, steps) {
  const g = graceOf(text);
  if (!g) return text;
  const s = String(text);
  return s.slice(0, g.index) + '{' + moveNoteText(g.text.slice(1, -1), steps) + '}' + s.slice(g.index + g.text.length);
}
// Slurs, hairpins and trill lines over a run of notes in one voice. A slur is ( just before the first note's pitch
// and ) after the last note's length and tie; a crescendo, diminuendo or trill line is a start decoration (!<(!,
// !>(!, !trill(!) on its first note and an end one (!<)!, !>)!, !trill)!) on its last, before the pitch. abcjs
// starts a note's text after any mark that follows a ( and reads .( as a dotted slur, so these decorations go before
// slur and tuplet openings, and a slur opening goes before a staccato dot. Such a ( then sits just before the note's
// text; it still counts as the note's.
const LINE_KINDS = ['slur', 'crescendo', 'diminuendo', 'trill'],
  LINE_MARKS = {crescendo: ['!<(!', '!<)!'], diminuendo: ['!>(!', '!>)!'], trill: ['!trill(!', '!trill)!']},
  // The spellings abcjs reads, so that a line written another way comes off too.
  LINE_DECORATIONS = {
    '<(': ['crescendo', 1],
    '<)': ['crescendo', -1],
    'crescendo(': ['crescendo', 1],
    'crescendo)': ['crescendo', -1],
    '>(': ['diminuendo', 1],
    '>)': ['diminuendo', -1],
    'diminuendo(': ['diminuendo', 1],
    'diminuendo)': ['diminuendo', -1],
    'trill(': ['trill', 1],
    'trill)': ['trill', -1]
  },
  // A new line replaces the lines of its family it covers: a crescendo replaces a diminuendo.
  LINE_FAMILY = {
    slur: ['slur'],
    crescendo: ['crescendo', 'diminuendo'],
    diminuendo: ['crescendo', 'diminuendo'],
    trill: ['trill']
  };
// Comments, field lines, quoted text, grace notes and inline fields are skipped. V: lines and [V:] fields change the
// voice, & starts an overlay voice that ends at the bar line, and X: starts a new tune.
const LINE_TOKEN =
  /%[^\n]*|(?:^|\n)(?:[A-Za-z+]:|%%)[^\n]*|"[^"]*"|\{[^}]*\}|\[[A-Za-z]:[^\]\n]*\]|([!+])([^!+\n]*)\1|\(\d+(?::\d*){0,2}|[()&|]/g;
// A note's text from just after a slur opening to its length, tie and broken rhythm; the group is its pitch, chord or
// rest.
const LINE_NOTE =
  /(?:"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|\((?:\d+(?::\d*){0,2})?|[.~HLMOPSTuv]|\s)*(\[[^\]]*\]|(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][,']*|[zx])\d*\/*\d*[-<>]*/y;
// abcjs starts a note's text after a slur or tuplet opening that a mark or grace note follows ((.C, (3{d}c), so such
// openings just before a note's text, and the marks before them, are the note's too.
const LINE_BEFORE =
  /(?:"[^"]*"|![^!\n]*!|\+[^+\n]*\+|\{[^}]*\}|[.~]|\((?:\d+(?::\d*){0,2})?)*\((?:\d+(?::\d*){0,2})?[ \t]*$/;
function lineStart(abc, at) {
  if (!/[(\d: \t]/.test(abc[at - 1] || '')) return at;
  return at - (abc.slice(Math.max(0, at - 80), at).match(LINE_BEFORE)?.[0].length || 0);
}
// abcjs pairs the slurs of chords and rests (0) apart from those of single notes (1): a ) closes the newest open slur
// of its own sort, or else the newest of the first sort that has one. It reads a note's ) before its (, so in
// (C D (E) F) the ) on E closes the slur from C and the ( on E opens one to F, and it drops a ( before a rest.
function closeSort(abc, at) {
  while (at > 0 && /[)\-\d/<>]/.test(abc[at - 1])) at--;
  return /[\]zxZX]/.test(abc[at - 1] || '') ? 0 : 1;
}
// Whether a ( that ends at open and the ) at close are on one note, as in (E) or ((E)).
function sameNote(abc, open, close) {
  LINE_NOTE.lastIndex = open;
  if (!LINE_NOTE.exec(abc) || LINE_NOTE.lastIndex > close) return false;
  for (let i = LINE_NOTE.lastIndex; i < close; i++) if (abc[i] !== ')') return false;
  return true;
}
// Every slur, hairpin and trill line in the ABC, paired as abcjs pairs them, each {kind, voice, open, close} with the
// [start, end) of its marks: open is null for an end mark that closes nothing and close is null for a line never
// closed. A hairpin or trill line that starts while one of its kind is open leaves that one unclosed. voices lists
// where each voice's text starts ({at, voice}, in order), so a line in a voice written in blocks (V:1, V:2, V:1 ...)
// carries on in the voice's next block. The last result is kept, as a toolbar refresh asks for it several times.
let lineMemo = null;
function linePairs(abc) {
  if (lineMemo?.abc === abc) return lineMemo;
  const pairs = [],
    voices = [],
    open = new Map(),
    token = new RegExp(LINE_TOKEN.source, 'g');
  let tune = 0,
    base = '0:',
    voice = null,
    overlay = 0;
  const enter = (id, at) => {
    if (id !== voice) voices.push({at, voice: id});
    voice = id;
  };
  enter(base, 0);
  for (let m; (m = token.exec(abc));) {
    const t = m[0],
      at = m.index;
    const field = /^\n?\[?([VX]):\s*([^\s\]]*)/.exec(t);
    if (field) {
      if (field[1] === 'X') tune++;
      base = `${tune}:${field[1] === 'V' ? field[2] : ''}`;
      overlay = 0;
      enter(base, at);
      continue;
    }
    if (t === '&' || (t === '|' && overlay)) {
      overlay = t === '&' ? overlay + 1 : 0;
      enter(overlay ? `${base}&${overlay}` : base, at);
      continue;
    }
    const [kind, dir] = t === '(' ? ['slur', 1] : t === ')' ? ['slur', -1] : (m[1] && LINE_DECORATIONS[m[2]]) || [];
    if (!kind) continue;
    if (!open.has(voice)) open.set(voice, {slur: [[], []]});
    const lines = open.get(voice),
      span = [at, at + t.length];
    let pair = null;
    if (kind === 'slur' && dir > 0) {
      LINE_NOTE.lastIndex = span[1];
      const core = LINE_NOTE.exec(abc)?.[1] || '';
      if (/^[zx]/.test(core)) continue;
      lines.slur[core[0] === '[' ? 0 : 1].push((pair = {kind, voice, open: span, close: null}));
    } else if (kind === 'slur') {
      const newest = stack => stack.findLastIndex(p => !sameNote(abc, p.open[1], at)),
        stack = [lines.slur[closeSort(abc, at)], ...lines.slur].find(s => newest(s) >= 0);
      if (stack) stack.splice(newest(stack), 1)[0].close = span;
      else pair = {kind, voice, open: null, close: span};
    } else if (dir > 0) lines[kind] = pair = {kind, voice, open: span, close: null};
    else if (lines[kind]) {
      lines[kind].close = span;
      lines[kind] = null;
    } else pair = {kind, voice, open: null, close: span};
    if (pair) pairs.push(pair);
  }
  return (lineMemo = {abc, pairs, voices});
}
function voiceAt(voices, at) {
  let voice = voices[0]?.voice;
  for (const v of voices) if (v.at <= at) voice = v.voice;
  return voice;
}
// The line of a kind that opens on note first ({startChar, endChar}, as abcjs gives them) and closes on note last,
// or anywhere when last is null; null when there is none.
function lineAt(abc, first, last, kind) {
  const from = lineStart(abc, first.startChar),
    to = last && lineStart(abc, last.startChar);
  return (
    linePairs(abc).pairs.find(
      p =>
        p.kind === kind &&
        p.open?.[0] >= from &&
        p.open[0] < first.endChar &&
        (!last || (p.close?.[0] >= to && p.close[0] < last.endChar))
    ) || null
  );
}
// Where a line's mark goes in a note's text: before the pitch, but before the slur and tuplet openings that end the
// prefix (a slur opening goes after them, but before a staccato dot just ahead of the pitch). An end mark goes before
// a start mark of its kind, so that a line ending on the note ends before the next one starts there.
function lineSlot(text, kind, end) {
  const items = String(text).match(MARK_PRE)?.[0].match(PRE_ITEM) || [];
  let i = items.length;
  if (kind === 'slur') {
    if (items[i - 1] === '.') i--;
  } else {
    while (i > 0 && /^(?:\(\d*(?::\d*)*|\s)$/.test(items[i - 1])) i--;
    if (end) {
      const starts = items.findIndex(item => {
        const [k, dir] = LINE_DECORATIONS[/^([!+])(.*)\1$/.exec(item)?.[2]] || [];
        return k === kind && dir > 0;
      });
      if (starts >= 0) i = Math.min(i, starts);
    }
  }
  // abcjs can start a note at the space after a bar line; the mark goes after that space.
  while (i < items.length && !items[i].trim()) i++;
  return items.slice(0, i).join('').length;
}
// The edits ({at, remove, insert}, source positions) that toggle a line of a kind from note first to note last.
// When that line is there it comes off, and only its marks change. Otherwise the new line goes on, and the lines of
// its family in the same voice that share more than an end note with it come off, with stray end marks inside it:
// lines of a kind never cross, and a crescendo replaces a diminuendo. A slur around the run stays (a phrase mark over
// shorter slurs) unless abcjs would then pair the new slur with it. Lines that only meet the run at its first or last
// note stay, so slurs and hairpins can follow on from one another. With last null, a line opening on the first note
// comes off and nothing else happens. Slurs and trill lines join notes; a hairpin may start or end on a rest. Returns
// {on, edits}, or null when there is nothing to do.
function lineEdits(abc, first, last, kind) {
  if (!LINE_KINDS.includes(kind)) return null;
  const off = p => [p.open, p.close].filter(Boolean).map(([s, e]) => ({at: s, remove: e - s, insert: ''})),
    here = lineAt(abc, first, last, kind);
  if (here) return {on: false, edits: off(here)};
  if (!last || last.startChar < first.endChar) return null;
  const firstText = abc.slice(first.startChar, first.endChar),
    lastText = abc.slice(last.startChar, last.endChar),
    hairpin = kind === 'crescendo' || kind === 'diminuendo',
    fits = text => (hairpin ? !!noteMarks(text) : /^[[A-Ga-g^_=]/.test(noteParts(text)?.core || ''));
  if (!fits(firstText) || !fits(lastText)) return null;
  const {pairs, voices} = linePairs(abc),
    voice = voiceAt(voices, first.startChar),
    from = lineStart(abc, first.startChar),
    to = lineStart(abc, last.startChar),
    shares = p =>
      p.open
        ? p.open[0] < to && (p.close?.[0] ?? Infinity) >= first.endChar
        : p.close[0] >= first.endChar && p.close[0] < last.endChar,
    around = p => kind === 'slur' && p.open?.[0] < from && (p.close?.[0] ?? Infinity) >= last.endChar,
    near = pairs.filter(p => p.voice === voice && LINE_FAMILY[kind].includes(p.kind) && shares(p));
  let marks;
  if (kind === 'slur') {
    const m = lastText.match(NOTE_PARTS);
    marks = [
      {at: first.startChar + lineSlot(firstText, kind), remove: 0, insert: '('},
      {
        at: last.startChar + m[1].length + m[2].length + m[3].length + m[4].match(/^-?\)*/)[0].length,
        remove: 0,
        insert: ')'
      }
    ];
  } else
    marks = [
      {at: first.startChar + lineSlot(firstText, kind), remove: 0, insert: LINE_MARKS[kind][0]},
      {at: last.startChar + lineSlot(lastText, kind, true), remove: 0, insert: LINE_MARKS[kind][1]}
    ];
  for (const keep of [true, false]) {
    const edits = near
      .filter(p => !keep || !around(p))
      .flatMap(off)
      .concat(marks);
    if (pairsUp(abc, edits, kind)) return {on: true, edits};
  }
  return null;
}
// Whether the line whose two marks end the edits reads as one line once they are made.
function pairsUp(abc, edits, kind) {
  const moved = at => edits.reduce((sum, e) => (e.at < at ? sum + e.insert.length - e.remove : sum), at),
    [open, close] = edits.slice(-2).map(e => moved(e.at));
  return linePairs(applyLineEdits(abc, edits)).pairs.some(
    p => p.kind === kind && p.open?.[0] === open && p.close?.[0] === close
  );
}
// Apply lineEdits' edits, last first; at one position a removal goes before an insertion.
function applyLineEdits(abc, edits) {
  for (const e of [...edits].sort((a, b) => b.at - a.at || b.remove - a.remove))
    abc = abc.slice(0, e.at) + e.insert + abc.slice(e.at + e.remove);
  return abc;
}
function toggleLine(abc, first, last, kind) {
  const change = lineEdits(abc, first, last, kind);
  return change ? applyLineEdits(abc, change.edits) : abc;
}
function toggleSlur(abc, first, last) {
  return toggleLine(abc, first, last, 'slur');
}
// kind: 'crescendo', 'diminuendo' or 'trill'.
function toggleSpan(abc, first, last, kind) {
  return kind === 'slur' ? abc : toggleLine(abc, first, last, kind);
}
// Chord symbols: a quoted string before a note that does not start with ^ _ < > @ (those place text annotations).
// abcjs prints any such string above the staff. A chord symbol is a root (A–G), an optional sharp or flat, a quality
// and an optional bass after a slash, optionally in parentheses; N.C. means no chord. The quality is an optional triad
// (m, maj, dim, aug…) then extensions and alterations as lead sheets write them (7, maj7, b9, #11, sus4, add9, alt,
// (maj7), 6/9…). Text that does not fit, such as Coda or D.C., prints but does not play or transpose (see midiBytes and
// transposeChordSymbol); abcjs would play and move anything starting with A–G.
// (?!\d) keeps each number in one piece, so text that does not fit fails quickly rather than by trying every split.
const CHORD_TRIAD = String.raw`(?:maj|Maj|ma|M|Δ|∆|min|mi|m|-|dim|°|˚|o|ø|Ø|aug|\+)`,
  CHORD_EXT =
    String.raw`(?:\d+(?!\d)|sus[24]?(?!\d)|add\d+(?!\d)|(?:maj|Maj|ma|M|Δ|∆)\d+(?!\d)|[b#♭♯+-]\d+(?!\d)|` +
    String.raw`\+(?!\d)|alt|omit\d|no\d)`;
const CHORD_QUALITY = new RegExp(
  String.raw`^${CHORD_TRIAD}?(?:\/?${CHORD_EXT}|\(${CHORD_EXT}(?:[, ]?${CHORD_EXT})*\))*$`
);
const CHORD_NAME = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/;
// {root, accidental, quality, bass} (accidentals as # or b), with root null for N.C.; null for other text.
function parseChordSymbol(text) {
  const t = String(text ?? '').trim(),
    plain = a => ({'♯': '#', '♭': 'b'})[a] || a;
  if (/^\(.*\)$/.test(t)) return parseChordSymbol(t.slice(1, -1));
  if (/^N\.C\.$/i.test(t)) return {root: null, accidental: '', quality: 'N.C.', bass: null};
  const m = t.match(CHORD_NAME);
  if (!m || !CHORD_QUALITY.test(m[3])) return null;
  return {root: m[1], accidental: plain(m[2]), quality: m[3], bass: m[4] ? m[4] + plain(m[5]) : null};
}
// A typed chord symbol tidied for the score: quotes, % and backslashes (abcjs reads % as the start of a comment and \
// as an escape, either of which can swallow the rest of the line) and line breaks dropped, spaces trimmed, a
// lower-case root or bass letter capitalized when that makes a chord (bb7 is Bb7), and nc or n.c. written N.C.
function tidyChordSymbol(text) {
  const t = String(text ?? '')
    .replace(/["%\\\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\^_<>@]+\s*/, '');
  if (/^n\.?c\.?$/i.test(t)) return 'N.C.';
  if (parseChordSymbol(t)) return t;
  const fixed = t
    .replace(/^[a-g]/, c => c.toUpperCase())
    .replace(/\/([a-g])([#b♯♭]?)$/, (_, c, a) => '/' + c.toUpperCase() + a);
  return parseChordSymbol(fixed) ? fixed : t;
}
// A note's prefix (as markItems, but an invisible rest x can carry a chord symbol too), and its chord-symbol item.
const CHORD_PRE = new RegExp(`^(?:${PRE_ITEM.source})*(?=[[A-Ga-g^_=zZx])`);
const isChordItem = item => /^"(?![\^_<>@])/.test(item);
// The chord symbol on a note, chord or rest, without its quotes, or null.
function chordSymbolOf(text) {
  const item = String(text).match(CHORD_PRE)?.[0].match(PRE_ITEM)?.find(isChordItem);
  return item ? item.slice(1, -1) : null;
}
// Replace the note's first chord symbol, add one in front (after any leading space), or remove it with null or ''.
// Text annotations ("^text") are left alone.
function setChordSymbol(text, chord) {
  text = String(text);
  const pre = text.match(CHORD_PRE)?.[0];
  if (pre == null) return text;
  const name = tidyChordSymbol(chord),
    items = pre.match(PRE_ITEM) || [],
    i = items.findIndex(isChordItem);
  if (i >= 0) items[i] = name ? `"${name}"` : '';
  else if (name) {
    let at = 0;
    while (at < items.length && !items[at].trim()) at++;
    items.splice(at, 0, `"${name}"`);
  }
  return items.join('') + text.slice(pre.length);
}
// Move a chord symbol's root and bass by semitones, spelled letters names away (C7 up a major 2nd, one letter, is D7;
// Db up a major 2nd is Eb, not D#). A name that would need a double sharp or flat takes the next letter instead.
// Anything parseChordSymbol does not read as a chord with a root (N.C., Coda, D.C.) comes back unchanged.
function transposeChordSymbol(name, semitones, letters = Math.round((semitones * 7) / 12)) {
  if (!parseChordSymbol(name)?.root) return String(name);
  return String(name).replace(/(^\s*\(?|\/)([A-G])([#b♯♭]?)/g, (_, lead, letter, acc) => {
    const from = 'CDEFGAB'.indexOf(letter),
      pc = LETTER_SEMIS[from] + ({'#': 1, '♯': 1, b: -1, '♭': -1}[acc] || 0) + semitones;
    for (const step of [0, 1, -1]) {
      const to = posMod(from + letters + step, 7),
        a = posMod(pc - LETTER_SEMIS[to] + 6, 12) - 6;
      if (Math.abs(a) <= 1) return lead + 'CDEFGAB'[to] + (a > 0 ? '#' : a < 0 ? 'b' : '');
    }
  });
}
// Bar-length check. Measures are numbered as in scoreEvents (a bar line ends a measure only once it holds notes).
const SECTION_END = /repeat|thin_thin|thin_thick|thick_thin|dbl/;
// A time signature as {length (whole notes), den, label}; 'free' for M:none, null when absent.
function meterInfo(meter) {
  if (!meter || !meter.type) return null;
  if (meter.type === 'common_time') return {length: 1, den: 4, label: '4/4'};
  if (meter.type === 'cut_time') return {length: 1, den: 2, label: '2/2'};
  const v = meter.value?.[0];
  if (meter.type !== 'specified' || !v) return 'free';
  const num = String(v.num)
    .split('+')
    .reduce((a, b) => a + +b, 0);
  return {length: num / +v.den, den: +v.den, label: num + '/' + v.den};
}
function barLengths(tune) {
  const out = [],
    states = new Map();
  let header = null;
  for (const line of tune.lines || [])
    for (const [s, staff] of (line.staff || []).entries()) {
      header ??= meterInfo(staff.meter);
      for (const [v, voice] of staff.voices.entries()) {
        const id = s + ':' + v;
        let st = states.get(id);
        if (!st) {
          st = {
            measure: 1,
            length: 0,
            meter: meterInfo(staff.meter) ?? header ?? 'free',
            notes: [],
            tuplet: 1,
            multi: false,
            ending: null
          };
          states.set(id, st);
        } else if (staff.meter) st.meter = meterInfo(staff.meter) ?? st.meter;
        for (const e of voice) {
          if (e.el_type === 'meter') {
            const m = meterInfo(e);
            if (m) st.meter = m;
            continue;
          }
          if (e.el_type === 'note') {
            if (e.startTriplet) st.tuplet = e.tripletMultiplier || 1;
            if (e.rest?.type === 'multimeasure') st.multi = true;
            st.length += (e.duration || 0) * st.tuplet;
            st.notes.push({element: e, at: st.length});
            if (e.endTriplet) st.tuplet = 1;
            continue;
          }
          if (e.el_type !== 'bar') continue;
          if (st.notes.length) {
            out.push({
              voice: id,
              measure: st.measure,
              length: st.length,
              meter: st.meter,
              expected: st.meter.length,
              multi: st.multi || st.meter === 'free',
              notes: st.notes,
              bar: e,
              sectionEnd: SECTION_END.test(e.type) || !!e.startEnding,
              ending: st.ending
            });
            st.measure++;
          }
          st.length = 0;
          st.notes = [];
          st.multi = false;
          st.ending = e.startEnding || (e.endEnding ? null : st.ending);
        }
      }
    }
  for (const [id, st] of states)
    if (st.notes.length)
      out.push({
        voice: id,
        measure: st.measure,
        length: st.length,
        meter: st.meter,
        expected: st.meter.length,
        multi: st.multi || st.meter === 'free',
        notes: st.notes,
        bar: null,
        sectionEnd: true,
        ending: st.ending
      });
  return out;
}
// Measures whose length doesn't match the time signature. A short opening bar (pickup) is fine, and so is a short
// bar that closes a section when it completes a pickup: the section's, the next section's, or the tune's.
function barProblems(tune) {
  const problems = [],
    byVoice = new Map(),
    near = (a, b) => Math.abs(a - b) < 1e-6;
  for (const m of barLengths(tune)) {
    if (!byVoice.has(m.voice)) byVoice.set(m.voice, []);
    byVoice.get(m.voice).push(m);
  }
  for (const measures of byVoice.values()) {
    const sections = [[]];
    for (const m of measures) {
      sections.at(-1).push(m);
      if (m.sectionEnd) sections.push([]);
    }
    if (!sections.at(-1).length) sections.pop();
    const tunePickup = measures[0] && measures[0].length < measures[0].expected - 1e-6 ? measures[0].length : 0;
    for (const [i, section] of sections.entries()) {
      const first = section[0],
        pickup = first.length < first.expected - 1e-6 ? first.length : 0,
        nextFirst = sections[i + 1]?.[0];
      for (const [j, m] of section.entries()) {
        if (m.multi || near(m.length, m.expected)) continue;
        const short = m.length < m.expected;
        if (short && j === 0) continue;
        if (
          short &&
          j === section.length - 1 &&
          [pickup, tunePickup, nextFirst && nextFirst.length < nextFirst.expected ? nextFirst.length : 0].some(
            p => p && near(m.length + p, m.expected)
          )
        )
          continue;
        problems.push(m);
      }
    }
  }
  return problems;
}
// A first measure (of barLengths) shaped like a pickup: shorter than the meter and closed by a bar line.
const shortStart = m => m.measure === 1 && m.meter !== 'free' && !!m.bar && m.length < m.expected - 1e-6;
// The voices (barLengths' ids) that open with that shape and have more music after it.
function openingPickups(tune) {
  const starts = new Set(),
    more = new Set();
  for (const m of barLengths(tune)) (shortStart(m) ? starts : more).add(m.voice);
  return new Set([...starts].filter(v => more.has(v)));
}
// Where each note and rest starts in its measure, as a beat counted from 1 (2.5 is halfway through beat 2), keyed by
// startChar. A beat is the meter's lower note, or three of them in 6/8, 9/8 and 12/8. Free meter (M:none) has no beats.
// A short first measure is a pickup, so it ends on the last beat, when a short bar that closes a section or the tune
// makes up the rest of it, or when its voice is in opened (openingPickups of the score as it was opened). A first bar
// that is short only because a note was deleted from it while writing starts on beat 1. A short bar after a short bar
// that closes a section is the next section's pickup when the two make one full bar (G2G2 G2z || G | in 2/4), unless
// it starts a second ending, which follows the bar before the first.
function noteBeats(tune, opened = new Set()) {
  const out = new Map(),
    measures = barLengths(tune),
    first = new Map(),
    last = new Map(),
    pickups = new Map(),
    near = (a, b) => Math.abs(a - b) < 1e-6,
    short = m => !m.multi && m.length < m.expected - 1e-6;
  for (const m of measures) last.set(m.voice, m);
  for (const m of measures) {
    if (m.measure === 1) {
      if (shortStart(m)) first.set(m.voice, m);
      continue;
    }
    const f = first.get(m.voice);
    if (
      f &&
      (opened.has(m.voice) || ((m.sectionEnd || m === last.get(m.voice)) && near(m.length + f.length, m.expected)))
    )
      pickups.set(m.voice, f.expected - f.length);
  }
  const before = new Map();
  for (const m of measures) {
    const p = before.get(m.voice);
    before.set(m.voice, m);
    if (m.meter === 'free') continue;
    const count = Math.round(m.meter.length * m.meter.den),
      beat = m.meter.den >= 8 && count > 3 && count % 3 === 0 ? 3 / m.meter.den : 1 / m.meter.den,
      pickup =
        m.measure === 1
          ? pickups.get(m.voice) || 0
          : p?.sectionEnd &&
              m.bar &&
              short(p) &&
              short(m) &&
              near(p.length + m.length, m.expected) &&
              !(p.ending && m.ending && p.ending !== m.ending)
            ? m.expected - m.length
            : 0;
    // A spacer (y) takes no time when played, though barLengths counts it.
    let start = 0,
      spacers = 0;
    for (const n of m.notes) {
      out.set(n.element.startChar, Math.round((1 + (pickup + start - spacers) / beat) * 1e6) / 1e6);
      if (n.element.rest?.type === 'spacer') spacers += n.at - start;
      start = n.at;
    }
  }
  return out;
}
// A note, chord or rest in words for the status line that screen readers announce: "Quarter note G4, measure 3,
// beat 2". names are the pitches as the staff spells them (noteLabels' names, which follow the key and the bar's
// accidentals); without them the letters and octaves are named with the note's own accidentals.
const LENGTH_WORDS = [
  [2, 'double whole'],
  [1, 'whole'],
  [1 / 2, 'half'],
  [1 / 4, 'quarter'],
  [1 / 8, 'eighth'],
  [1 / 16, '16th'],
  [1 / 32, '32nd'],
  [1 / 64, '64th']
];
function lengthWords(duration) {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const [v, word] of LENGTH_WORDS) {
    if (near(duration, v)) return word;
    if (near(duration, v * 1.5)) return 'dotted ' + word;
    if (near(duration, v * 1.75)) return 'double-dotted ' + word;
  }
  return '';
}
// Beat 2, beat 2½ for the eighth after it in 4/4, beat 2⅓ for the second eighth of a beat in 6/8 or of a triplet,
// and "after beat 2" for anything finer.
const BEAT_PARTS = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾']
];
function beatText(beat) {
  const whole = Math.floor(beat + 1e-6),
    part = beat - whole;
  if (part < 1e-6) return `beat ${whole}`;
  const named = BEAT_PARTS.find(([v]) => Math.abs(part - v) < 1e-6);
  return named ? `beat ${whole}${named[1]}` : `after beat ${whole}`;
}
function describeNote(element, measure, beat, names) {
  const where = `measure ${measure}` + (beat ? ', ' + beatText(beat) : ''),
    rest = element.rest,
    pitches = element.pitches || [];
  // A spacer (y) is only room on the staff: it is not a note and takes no time, so it has no description.
  if (rest?.type === 'spacer' && !pitches.length) return '';
  if (rest?.type === 'multimeasure')
    return `Rest for ${rest.text} measure${+rest.text === 1 ? '' : 's'}, measure ${measure}`;
  const length = lengthWords(element.duration || 0);
  let what;
  if (!pitches.length) what = [rest?.type === 'invisible' ? 'invisible' : '', length, 'rest'];
  else {
    names ??= pitches.map(
      p =>
        'CDEFGAB'[((p.pitch % 7) + 7) % 7] +
        ({sharp: '♯', flat: '♭', natural: '♮', dblsharp: '𝄪', dblflat: '𝄫'}[p.accidental] || '') +
        (4 + Math.floor(p.pitch / 7))
    );
    what = [length, pitches.length < 2 ? 'note' : length ? 'note chord' : 'chord', names.join(' ')];
  }
  const text = what.filter(Boolean).join(' '),
    tied = pitches.some(p => p.startTie) ? ', tied to the next note' : '';
  return text[0].toUpperCase() + text.slice(1) + tied + ', ' + where;
}
// The first voice as written, bar by bar: each note's MIDI pitch (null for rests) and sounding length. Accidentals
// follow ABC rules: the key signature, inline key changes, and accidentals carried to the end of the bar.
const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11],
  ALTER = {sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2},
  ALTER_SIGN = {'-2': '__', '-1': '_', 0: '=', 1: '^', 2: '^^'};
function keyAlters(key) {
  const alters = {};
  for (const a of key?.accidentals || []) alters[a.note.toUpperCase()] = ALTER[a.acc] ?? 0;
  return alters;
}
// ABC pitch for a MIDI note in a key (a parsed abcjs key, as keyAlters takes). A note in the key needs no accidental;
// any other uses a natural if one fits, else a sharp, or a flat in flat keys. With explicit, the accidental is always
// written (for a bar where an earlier accidental would otherwise change the note). midiToken(61, C major) is '^C'.
function midiToken(midi, key, explicit = false) {
  const alters = keyAlters(key),
    pc = ((midi % 12) + 12) % 12,
    token = (letter, alter, written) =>
      (written ? ALTER_SIGN[alter] : '') +
      pitchToken(letter + 7 * Math.round((midi - 60 - LETTER_SEMIS[letter] - alter) / 12));
  for (let letter = 0; letter < 7; letter++) {
    const alter = alters['CDEFGAB'[letter]] || 0;
    if ((LETTER_SEMIS[letter] + alter + 12) % 12 === pc) return token(letter, alter, explicit);
  }
  const natural = LETTER_SEMIS.indexOf(pc);
  if (natural >= 0) return token(natural, 0, true);
  return Object.values(alters).some(a => a < 0)
    ? token(LETTER_SEMIS.indexOf((pc + 1) % 12), -1, true)
    : token(LETTER_SEMIS.indexOf(pc - 1), 1, true);
}
// Add a pitch (an ABC pitch without a length, such as 'E' or '^f') to a note or chord, keeping its length, ties and
// decorations: C2 becomes [CE]2. A pitch already in the chord, or a rest, is left as it was.
function addChordPitch(text, core) {
  const parts = noteParts(text);
  if (!parts || /^[zx]/.test(parts.core)) return text;
  const pitches = parts.core.match(/(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][,']*/g) || [];
  if (pitches.includes(core)) return text;
  // Chords written with a length on each pitch ([C2E2]) give the new pitch the same length.
  const each =
    parts.core[0] === '[' ? (parts.core.match(/^\[(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][,']*(\d*\/*\d*)/) || [])[1] : '';
  const inner = parts.core[0] === '[' ? parts.core.slice(1, -1) : parts.core;
  return parts.pre + '[' + inner + core + (each || '') + ']' + text.slice(parts.pre.length + parts.core.length);
}
// An accidental carries to later notes on the same line or space in the bar, so writing ^C before a plain C would
// make that C sharp too. Widen an edit (replace source[start..end] with text) to write out the accidental each later
// note had, so only the edited note changes: '^C' over the rest in 'z C' gives '^C =C'. select is a range in the edited
// source, moved to match. Returns {end, text, select}.
function keepLaterPitches(source, start, end, text, select) {
  const later = (src, from) => noteLabels(ABCJS.parseOnly(src)[0], 'letters').filter(l => l.at >= from),
    was = later(source, end),
    base = start + text.length;
  let tail = source.slice(end);
  // One pass per changed note, earliest first: writing out its accidental puts back the pitch of those after it.
  for (let pass = 0; pass < 8; pass++) {
    const now = later(source.slice(0, start) + text + tail, base),
      i = now.findIndex((l, j) => String(l.written) !== String(was[j]?.written));
    if (i < 0 || now.length !== was.length) break;
    const k = now[i].written.findIndex((m, j) => m !== was[i].written[j]),
      parts = noteParts(tail.slice(now[i].at - base)),
      pitch = parts && [...parts.core.matchAll(/(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g)][k];
    if (!pitch || pitch[1]) break;
    const step =
        'CDEFGAB'.indexOf(pitch[2].toUpperCase()) +
        (pitch[2] === pitch[2].toLowerCase() ? 7 : 0) +
        [...pitch[3]].reduce((n, c) => n + (c === "'" ? 7 : -7), 0),
      sign = ALTER_SIGN[was[i].written[k] - (60 + 12 * Math.floor(step / 7) + LETTER_SEMIS[((step % 7) + 7) % 7])],
      at = now[i].at - base + parts.pre.length + pitch.index;
    if (!sign) break;
    tail = tail.slice(0, at) + sign + tail.slice(at);
    select = select && select.map(x => (x > base + at ? x + sign.length : x));
  }
  // Replace only up to the last change: the rest of the source is as it was.
  const old = source.slice(end);
  let same = 0;
  while (same < old.length && old[old.length - 1 - same] === tail[tail.length - 1 - same]) same++;
  return {end: source.length - same, text: text + tail.slice(0, tail.length - same), select};
}
// Z's edit: the note at source[start..end] respelled as text. Later notes keep their pitch (keepLaterPitches), and
// an accidental later in the bar that only the old spelling needed goes: '_D =D' respelled gives '^C D', not
// '^C =D', so that pressing Z again comes back to where it started. An accidental goes only on a letter the old
// spelling used, when its note sounded different without it before and sounds the same without it now; a courtesy
// accidental stays. Returns {end, text} for the source, as keepLaterPitches does.
function respellEdit(source, start, end, text) {
  const kept = keepLaterPitches(source, start, end, text, null),
    to = start + text.length,
    plain = t => noteParts(t)?.core.match(/[A-Ga-g][,']*/g) || [],
    letters = new Set(plain(source.slice(start, end))),
    heard = src => noteLabels(ABCJS.parseOnly(src)[0], 'letters'),
    sounds = labels => labels.map(l => l.written.join()).join(' '),
    drop = (src, at, n) => src.slice(0, at) + src.slice(at + n);
  let after = source.slice(0, start) + kept.text + source.slice(kept.end);
  // The rest of the bar: an accidental carries no further than the next bar line.
  const barEnd = (src, from) => (src.indexOf('|', from) + 1 || src.length + 1) - 1,
    was = heard(source),
    now = heard(after),
    soundedBefore = sounds(was),
    soundsNow = sounds(now),
    rest = (labels, from, src, stop = barEnd(src, from)) =>
      labels.filter(l => l.at >= from && l.at < stop).sort((a, b) => a.at - b.at),
    laterWas = rest(was, end, source),
    laterNow = rest(now, to, after);
  if (laterWas.length !== laterNow.length) return {end: kept.end, text: kept.text};
  // The pitches of the note at a position: [where its accidental starts, how long it is, the plain pitch].
  const marked = (src, at) => {
    const parts = noteParts(src.slice(at));
    return parts
      ? [...parts.core.matchAll(/(\^{1,2}|_{1,2}|=)?([A-Ga-g][,']*)/g)].map(m => [
          at + parts.pre.length + m.index,
          (m[1] || '').length,
          m[2]
        ])
      : [];
  };
  const done = new Set();
  let shift = 0;
  for (let j = 0; j < laterNow.length && done.size < letters.size; j++) {
    const before = marked(source, laterWas[j].at),
      current = marked(after, laterNow[j].at + shift);
    // Last pitch first, so a dropped accidental does not move the ones still to look at.
    for (let k = current.length - 1; k >= 0; k--) {
      const [at, n, pitch] = current[k],
        [atBefore, nBefore, pitchBefore] = before[k] || [];
      if (!n || !letters.has(pitch) || done.has(pitch) || pitchBefore !== pitch || nBefore !== n) continue;
      if (source.slice(atBefore, atBefore + n) !== after.slice(at, at + n)) continue;
      done.add(pitch);
      if (sounds(heard(drop(source, atBefore, n))) === soundedBefore) continue;
      const without = drop(after, at, n);
      if (sounds(heard(without)) !== soundsNow) continue;
      after = without;
      shift -= n;
    }
  }
  return sourceEdit(source, after, start, end, to);
}
// The edit that turns source into after, two texts that are the same up to start: {end, text} for source[start..end],
// leaving out the tail they share. It always covers source[start..end] and after[start..to].
function sourceEdit(source, after, start, end, to) {
  let same = 0;
  while (
    same < source.length - end &&
    same < after.length - to &&
    source[source.length - 1 - same] === after[after.length - 1 - same]
  )
    same++;
  return {end: source.length - same, text: after.slice(start, after.length - same)};
}
function melodyBars(tune) {
  const bars = [],
    lengths = barLengths(tune).filter(m => m.voice === '0:0');
  let key = {},
    bar = null,
    carried = {},
    tuplet = 1;
  const close = () => {
    if (bar?.notes.length) {
      const m = lengths[bars.length];
      bars.push({...bar, expected: m?.expected ?? bar.length});
    }
    bar = null;
    carried = {};
  };
  for (const line of tune.lines || []) {
    const staff = line.staff?.[0];
    if (!staff) continue;
    if (staff.key) key = keyAlters(staff.key);
    for (const e of staff.voices[0] || []) {
      if (e.el_type === 'key') {
        key = keyAlters(e);
        continue;
      }
      if (e.el_type === 'bar') {
        close();
        continue;
      }
      if (e.el_type !== 'note') continue;
      bar ??= {notes: [], length: 0, measure: bars.length + 1};
      if (e.startTriplet) tuplet = e.tripletMultiplier || 1;
      const duration = (e.duration || 0) * tuplet;
      let midi = null;
      if (e.pitches?.length && !e.rest) {
        const p = e.pitches[0],
          letter = ((p.pitch % 7) + 7) % 7,
          name = 'CDEFGAB'[letter];
        if (p.accidental) carried[p.pitch] = ALTER[p.accidental] ?? 0;
        midi = 60 + 12 * Math.floor(p.pitch / 7) + LETTER_SEMIS[letter] + (carried[p.pitch] ?? key[name] ?? 0);
      }
      bar.notes.push({midi, duration, rest: midi == null && e.rest?.type !== 'invisible'});
      bar.length += duration;
      if (e.endTriplet) tuplet = 1;
    }
  }
  close();
  return bars;
}
// Check a writing prompt's goals against the melody. Returns [{label, ok}].
const SCALES = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 9, 10, 11]};
function promptTonic(key) {
  const m = String(key).match(/^([A-G])([#b]?)/);
  return m ? (LETTER_SEMIS['CDEFGAB'.indexOf(m[1])] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : 0;
}
// The bars goal counts a bar only when it is a full bar of the prompt's meter and is written under that meter.
const fullMeterBar = (bar, length) => Math.abs(bar.length - length) < 1e-6 && Math.abs(bar.expected - length) < 1e-6;
function checkPrompt(prompt, bars) {
  const near = (a, b) => Math.abs(a - b) < 1e-6,
    tonic = promptTonic(prompt.key),
    degree = n => (((n.midi - tonic) % 12) + 12) % 12,
    promptBar = prompt.meter.split('/').reduce((n, d) => n / d);
  const notes = bars.flatMap(b => b.notes),
    pitched = notes.filter(n => n.midi != null),
    moves = pitched.slice(1).map((n, i) => Math.abs(n.midi - pitched[i].midi));
  const kinds = {
    rest: n => n.rest,
    eighth: n => n.midi != null && near(n.duration, 0.125),
    'dotted-half': n => n.midi != null && near(n.duration, 0.75),
    'dotted-quarter': n => n.midi != null && near(n.duration, 0.375)
  };
  return prompt.goals.map(g => {
    let ok = false;
    // Bars must match the prompt's own meter, so changing the time signature can't satisfy the goal.
    if (g.type === 'bars')
      ok =
        bars.length === prompt.bars && bars.every(b => fullMeterBar(b, promptBar) && b.notes.some(n => n.midi != null));
    else if (g.type === 'lengths')
      ok = pitched.length > 0 && pitched.every(n => g.allowed.some(a => near(a, n.duration)));
    else if (g.type === 'start') ok = !!pitched.length && degree(pitched[0]) === g.degree;
    else if (g.type === 'end') ok = !!pitched.length && degree(pitched.at(-1)) === g.degree;
    else if (g.type === 'endBar') {
      const b = bars[g.bar - 1]?.notes.filter(n => n.midi != null);
      ok = !!b?.length && degree(b.at(-1)) === g.degree;
    } else if (g.type === 'steps') ok = pitched.length > 1 && moves.every(m => m <= 2);
    else if (g.type === 'range')
      ok = pitched.length > 1 && Math.max(...pitched.map(n => n.midi)) - Math.min(...pitched.map(n => n.midi)) <= g.max;
    else if (g.type === 'inKey') ok = pitched.length > 0 && pitched.every(n => SCALES[g.scale].includes(degree(n)));
    else if (g.type === 'atLeast') {
      const count =
        g.kind === 'leap'
          ? moves.filter(m => m >= 5).length
          : g.kind === 'degree'
            ? pitched.filter(n => degree(n) === g.degree).length
            : notes.filter(kinds[g.kind]).length;
      ok = count >= g.count;
    }
    return {label: g.label, ok};
  });
}
// ABC for a writing prompt: the prompt's headers and key (pass the concert key for transposing instruments) and a
// body, by default one whole-bar rest per bar for the student to write over.
function promptSource(prompt, key = prompt.key, body = null) {
  const [n, d] = prompt.meter.split('/').map(Number),
    [un, ud] = prompt.unit.split('/').map(Number),
    rest = 'z' + lengthText(n / d / (un / ud));
  return `X:1\nT:${prompt.title}\nC:\nM:${prompt.meter}\nL:${prompt.unit}\nQ:1/4=${prompt.tempo}\nK:${key}\n${body ?? Array(prompt.bars).fill(rest).join(' | ')} |]`;
}
// New score templates. Each staff is one voice block (V: with clef, name and short name) after K:; %%score groups
// them with a brace (piano) or a bracket. instrument is the sound the app picks for a template whose staves have
// fixed clefs, which must not transpose. The others keep the student's instrument: a duet's staves have no clef=, so
// both take the clef the instrument puts on K: (bass for cello) and its transposition.
const SCORE_TEMPLATES = [
  {id: 'melody', name: 'Melody', words: 'one staff', staves: [{}]},
  {id: 'lead', name: 'Lead sheet', words: 'one staff with chord symbols', staves: [{}], chords: true},
  {
    id: 'piano',
    name: 'Piano',
    words: 'right hand and left hand staves',
    score: '{RH LH}',
    instrument: 'Piano',
    staves: [
      {id: 'RH', clef: 'treble', name: 'Piano', snm: 'Pno.'},
      {id: 'LH', clef: 'bass'}
    ]
  },
  {
    id: 'duet',
    name: 'Duet',
    words: 'two staves for the current instrument',
    score: '[1 2]',
    staves: [
      {id: '1', name: 'Part 1', snm: '1'},
      {id: '2', name: 'Part 2', snm: '2'}
    ]
  },
  {
    id: 'melody-bass',
    name: 'Melody and bass',
    words: 'a treble staff and a bass staff',
    score: '[M B]',
    instrument: 'Piano',
    staves: [
      {id: 'M', clef: 'treble', name: 'Melody', snm: 'Mel.'},
      {id: 'B', clef: 'bass', name: 'Bass', snm: 'Bass'}
    ]
  },
  {
    id: 'satb',
    name: 'SATB choir',
    words: 'soprano, alto, tenor and bass staves',
    score: '[S A T B]',
    instrument: 'Piano',
    staves: [
      {id: 'S', clef: 'treble', name: 'Soprano', snm: 'S.'},
      {id: 'A', clef: 'treble', name: 'Alto', snm: 'A.'},
      {id: 'T', clef: 'treble-8', name: 'Tenor', snm: 'T.'},
      {id: 'B', clef: 'bass', name: 'Bass', snm: 'B.'}
    ]
  },
  {
    id: 'quartet',
    name: 'String quartet',
    words: 'two violins, viola and cello',
    score: '[V1 V2 Va Vc]',
    instrument: 'Violin',
    staves: [
      {id: 'V1', clef: 'treble', name: 'Violin I', snm: 'Vln. I'},
      {id: 'V2', clef: 'treble', name: 'Violin II', snm: 'Vln. II'},
      {id: 'Va', clef: 'alto', name: 'Viola', snm: 'Vla.'},
      {id: 'Vc', clef: 'bass', name: 'Cello', snm: 'Vc.'}
    ]
  }
];
// A time signature's bar and beat in whole notes. Compound meters (6/8, 9/8, 12/8) count dotted beats, so a pickup
// of one beat in 6/8 is a dotted quarter. pickups is the longest pickup offered: up to 3 beats, shorter than a bar.
function templateMeter(meter) {
  const text = String(meter || '').trim(),
    [num, den] =
      text === 'C' ? [4, 4] : text === 'C|' ? [2, 2] : (text.match(/^(\d+)\/(\d+)$/) || [, 4, 4]).slice(1).map(Number),
    compound = den === 8 && num > 3 && num % 3 === 0,
    beat = (compound ? 3 : 1) / den,
    beats = Math.round(num / den / beat);
  return {bar: num / den, beat, beats, unit: den >= 8 ? '1/8' : '1/4', pickups: Math.max(0, Math.min(3, beats - 1))};
}
// The key's tonic chord, for the first bar of a lead sheet: C, Am, Bdim.
function tonicChord(key) {
  const k = keyParts(key);
  if (!/^[A-G]/.test(k.tonic || '')) return 'C';
  return k.tonic + ({m: 'm', Dor: 'm', Phr: 'm', Loc: 'dim'}[k.mode] || '');
}
// ABC for a new score: each staff gets the pickup rest, if any, then whole-bar rests, four bars to a line. A lead
// sheet starts its chord line with the key's tonic chord on the first full bar.
function templateSource({
  template = 'melody',
  title,
  key = 'C',
  meter = '4/4',
  unit,
  tempo = 100,
  bars = 8,
  pickup = 0
}) {
  const t = SCORE_TEMPLATES.find(x => x.id === template) || SCORE_TEMPLATES[0],
    m = templateMeter(meter),
    oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' '),
    [un, ud] = String(unit || m.unit)
      .split('/')
      .map(Number),
    restOf = length => 'z' + lengthText(length / (un / ud)),
    count = Math.max(1, Math.min(64, Math.round(+bars) || 8)),
    lead = Math.max(0, Math.min(m.pickups, Math.round(+pickup) || 0)),
    speed = Math.max(40, Math.min(200, Math.round(+tempo) || 100)),
    music = Array.from({length: count}, (_, i) => (t.chords && i === 0 ? `"${tonicChord(key)}"` : '') + restOf(m.bar)),
    lines = [];
  for (let i = 0; i < count; i += 4) lines.push(music.slice(i, i + 4));
  if (lead) lines[0].unshift(restOf(lead * m.beat));
  const body = lines.map((line, i) => line.join(' | ') + (i === lines.length - 1 ? ' |]' : ' |')).join('\n'),
    head = `X:1\nT:${oneLine(title).trim() || 'Untitled'}\nC:\nM:${oneLine(meter)}\nL:${un}/${ud}\nQ:1/4=${speed}\n`;
  if (t.staves.length === 1) return `${head}K:${oneLine(key)}\n${body}\n`;
  const voices = t.staves.map(
    s => `V:${s.id}${s.clef ? ` clef=${s.clef}` : ''}${s.name ? ` name="${s.name}" snm="${s.snm}"` : ''}\n${body}`
  );
  return `${head}%%score ${t.score}\nK:${oneLine(key)}\n${voices.join('\n')}\n`;
}
// Keys and transposition. A key is a tonic (C, F#, Bb) and a mode (m, Dor, Mix...); its place on the circle of
// fifths gives the signature: positive counts sharps, negative flats.
const LETTER_FIFTHS = {F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5},
  KEY_MODES = [
    {mode: '', name: 'major', group: 'Major', offset: 0},
    {mode: 'm', name: 'minor', group: 'Minor', offset: -3},
    {mode: 'Dor', name: 'Dorian', group: 'Dorian', offset: -2},
    {mode: 'Phr', name: 'Phrygian', group: 'Phrygian', offset: -4},
    {mode: 'Lyd', name: 'Lydian', group: 'Lydian', offset: 1},
    {mode: 'Mix', name: 'Mixolydian', group: 'Mixolydian', offset: -1},
    {mode: 'Loc', name: 'Locrian', group: 'Locrian', offset: -5}
  ],
  MODE_SUFFIX = {
    maj: '',
    ion: '',
    min: 'm',
    m: 'm',
    aeo: 'm',
    dor: 'Dor',
    phr: 'Phr',
    lyd: 'Lyd',
    mix: 'Mix',
    loc: 'Loc'
  };
const posMod = (n, m) => ((n % m) + m) % m;
// A K: value split into its key as written (tonic and mode) and what follows (clef=, middle=, a comment).
// tonic is null when the field names no key (K:clef=bass), and 'none', 'HP' or 'Hp' for those special keys.
function keyParts(value) {
  const text = String(value ?? ''),
    special = text.match(/^\s*(none|HP|Hp)(?![\w#])/);
  if (special) return {tonic: special[1], mode: '', key: special[1], rest: text.slice(special[0].length)};
  const t = text.match(/^\s*([A-G])([#b]?)/);
  if (!t) return {tonic: null, mode: '', key: '', rest: text};
  const m = text.slice(t[0].length).match(/^\s*(maj|min|ion|aeo|dor|phr|lyd|mix|loc|m)[a-z]*(?![^\s%\]])/i),
    end = t[0].length + (m ? m[0].length : 0);
  return {
    tonic: t[1] + t[2],
    mode: m ? MODE_SUFFIX[m[1].toLowerCase()] : '',
    key: text.slice(0, end).trim(),
    rest: text.slice(end)
  };
}
// Sharps (positive) or flats (negative) in a key's signature; null for the bagpipe keys, which do not transpose.
function keyFifths(value) {
  const k = keyParts(value);
  if (!k.tonic || k.tonic === 'none') return 0;
  if (!LETTER_FIFTHS.hasOwnProperty(k.tonic[0])) return null;
  const acc = k.tonic[1] === '#' ? 7 : k.tonic[1] === 'b' ? -7 : 0;
  return LETTER_FIFTHS[k.tonic[0]] + acc + KEY_MODES.find(x => x.mode === k.mode).offset;
}
// One spelling per key for the key menu: 'C', 'F#m', 'DDor'.
function canonicalKey(value) {
  const k = keyParts(value);
  return !k.tonic ? 'C' : k.tonic + k.mode;
}
const tonicName = fifths =>
  'FCGDAEB'[posMod(fifths + 1, 7)] + ['bb', 'b', '', '#', '##'][Math.floor((fifths + 1) / 7) + 2];
function keyLabel(value) {
  const k = keyParts(value),
    f = keyFifths(value);
  if (!k.tonic || k.tonic === 'none' || f == null) return k.tonic === 'none' ? 'No key signature' : k.key || 'C major';
  const name = KEY_MODES.find(x => x.mode === k.mode).name,
    sig = f > 0 ? ` (${f}♯)` : f < 0 ? ` (${-f}♭)` : '';
  return `${k.tonic.replace('#', '♯').replace('b', '♭')} ${name}${sig}`;
}
// The key menu: 15 major and 15 minor keys, and each mode on the tonics whose signature has up to three sharps or flats.
const KEY_LIST = KEY_MODES.flatMap(({mode, group, offset}) => {
  const most = mode === '' || mode === 'm' ? 7 : 3,
    sigs = [0, ...Array.from({length: most}, (_, i) => i + 1), ...Array.from({length: most}, (_, i) => -i - 1)];
  return sigs.map(sig => {
    const value = tonicName(sig - offset) + mode;
    return {value, group, label: keyLabel(value)};
  });
});
const TRANSPOSE_INTERVALS = [
  {id: 'm2', name: 'minor 2nd', semitones: 1, letters: 1},
  {id: 'M2', name: 'major 2nd', semitones: 2, letters: 1},
  {id: 'm3', name: 'minor 3rd', semitones: 3, letters: 2},
  {id: 'M3', name: 'major 3rd', semitones: 4, letters: 2},
  {id: 'P4', name: 'perfect 4th', semitones: 5, letters: 3},
  {id: 'A4', name: 'augmented 4th', semitones: 6, letters: 3},
  {id: 'd5', name: 'diminished 5th', semitones: 6, letters: 4},
  {id: 'P5', name: 'perfect 5th', semitones: 7, letters: 4},
  {id: 'm6', name: 'minor 6th', semitones: 8, letters: 5},
  {id: 'M6', name: 'major 6th', semitones: 9, letters: 5},
  {id: 'm7', name: 'minor 7th', semitones: 10, letters: 6},
  {id: 'M7', name: 'major 7th', semitones: 11, letters: 6},
  {id: 'P8', name: 'octave', semitones: 12, letters: 7}
];
// An interval in words, with its article, for captions: "a major 2nd", "a major 9th", "an octave and a major 6th".
function intervalPhrase(semitones) {
  semitones = Math.abs(Math.round(semitones));
  const article = name => (/^[aeiou]/.test(name) ? 'an ' : 'a ') + name,
    simple = n => article(TRANSPOSE_INTERVALS.find(i => i.semitones === n).name),
    compound = {13: 'minor 9th', 14: 'major 9th', 15: 'minor 10th', 16: 'major 10th'}[semitones];
  if (!semitones) return 'a unison';
  if (semitones <= 12) return simple(semitones);
  if (compound) return article(compound);
  const octaves = Math.floor(semitones / 12),
    words = octaves === 1 ? 'an octave' : octaves === 2 ? 'two octaves' : `${octaves} octaves`;
  return semitones % 12 ? `${words} and ${simple(semitones % 12)}` : words;
}
// An instrument's playback octave against the ABC source (`instruments` in catalog.js): its `sound`, or an octave
// down for the bass-range instruments (shift -12) that read treble-range melodies an octave lower.
const instrumentSound = config => config?.sound ?? (config?.shift === -12 ? -12 : 0);
// How far an instrument's part is written above how it sounds: 2 for a B-flat clarinet, 14 for a tenor sax, 12 for a
// double bass, -24 for a glockenspiel and 0 for a cello.
const writtenAboveSound = config => (config?.shift || 0) - instrumentSound(config);
// A note's loudness: [kind, level, time] steps for a gain AudioParam, kind 'set', 'linear' or 'exp' (the three
// automation calls every browser has). A plucked or struck sound (`pluck`) fades while it is held; others rise to
// `peak`, settle at `sustain` and hold it to the end. Both then release to silence; `stop` is when the oscillator
// can stop.
function noteEnvelope(env = {}, start, duration, peak) {
  const end = start + duration,
    release = env.release ?? 0.025,
    stop = end + +(release + 0.005).toFixed(4);
  if (env.pluck) {
    const attack = Math.min(0.005, duration / 4),
      held = Math.max(1e-4, peak * Math.exp(-(duration - attack) / env.pluck));
    const steps = [
      ['set', 0, start],
      ['linear', peak, start + attack],
      ['exp', held, end],
      ['linear', 0, end + release]
    ];
    return {steps, stop};
  }
  const attack = Math.min(env.attack ?? 0.012, duration / 3),
    decay = Math.min(env.decay ?? 0.04, duration / 3),
    level = peak * (env.sustain ?? 2 / 3);
  const steps = [
    ['set', 0, start],
    ['linear', peak, start + attack],
    ['linear', level, start + attack + decay],
    ['linear', level, end],
    ['linear', 0, end + release]
  ];
  return {steps, stop};
}
// Vibrato as detune values in cents for setValueCurveAtTime, sampled 16 times a cycle: it starts `delay` seconds into
// the note and fades in over a quarter second. Null for no vibrato or a note too short to hear it.
function vibratoCurve(vibrato, duration) {
  const length = duration - (vibrato?.delay ?? 0);
  if (!vibrato?.rate || !vibrato.depth || !(length > 0.15)) return null;
  const n = Math.min(2048, Math.ceil(length * vibrato.rate * 16) + 1),
    values = Array.from({length: n}, (_, i) => {
      const t = (i / (n - 1)) * length;
      return vibrato.depth * Math.min(1, t / 0.25) * Math.sin(2 * Math.PI * vibrato.rate * t);
    });
  return {values, start: vibrato.delay ?? 0, length};
}
// The move from one key to another, the nearer way round: semitones and letter names (C to F# is 6 and 3, C to Gb
// 6 and 4). Keys of different modes move by their signatures, so C major to E minor moves the notes to G major.
function keyInterval(from, to) {
  const a = keyFifths(from),
    b = keyFifths(to);
  if (a == null || b == null) return null;
  let semitones = posMod((b - a) * 7, 12),
    letters = posMod((b - a) * 4, 7);
  if (semitones > 6) {
    semitones -= 12;
    letters -= 7;
  }
  return {semitones, letters};
}
// K: fields in order, header lines and inline [K:...] alike, with the position of their values.
function keyFields(text) {
  return [...text.matchAll(/(^|\n)K:([^\n]*)|\[K:([^\]\n]*)\]/g)].map(m => {
    const value = m[2] ?? m[3],
      start = m.index + (m[2] != null ? m[1].length + 2 : 3);
    return {start, end: start + value.length, value};
  });
}
// The key in force at a position: the last K: field before it that names a key.
function keyAt(text, at) {
  const found = keyFields(text.slice(0, at)).filter(f => keyParts(f.value).tonic);
  return found.length ? keyParts(found.at(-1).value).key : 'C';
}
const ACC_TEXT = {'-2': '__', '-1': '_', 0: '=', 1: '^', 2: '^^'},
  ACC_VALUE = {__: -2, _: -1, '=': 0, '^': 1, '^^': 2},
  diatonicSemis = p => 12 * Math.floor(p / 7) + LETTER_SEMIS[posMod(p, 7)];
// Rewrite every pitch (notes, chords, grace notes) and every chord symbol in a stretch of ABC music. Decorations,
// annotations, inline fields and comments are kept. pitch({acc, pitch}) gets the written accidental (null when none)
// and the diatonic pitch (0 = middle C); a callback returning null abandons the rewrite and the result is null.
function mapMusic(text, pitch, chord = name => name) {
  let out = '',
    i = 0;
  while (i < text.length) {
    const c = text[i];
    if (
      c === '"' ||
      c === '!' ||
      c === '+' ||
      c === '%' ||
      (c === '[' && /^[A-Za-z]:/.test(text.slice(i + 1, i + 3)))
    ) {
      let end = text.indexOf({'[': ']', '%': '\n'}[c] || c, i + 1);
      // A ! or + with no partner later on its line is not a decoration: abcjs reads a lone ! as the old line break.
      if ((c === '!' || c === '+') && (end < 0 || text.slice(i, end).includes('\n'))) {
        out += c;
        i++;
        continue;
      }
      if (end < 0) end = text.length;
      const inner = text.slice(i + 1, end);
      if (c === '"' && !/^[_^<>@]/.test(inner)) {
        const name = chord(inner);
        if (name == null) return null;
        out += '"' + name + text.slice(end, end + 1);
      } else out += text.slice(i, end + (c === '%' ? 0 : 1));
      i = end + (c === '%' ? 0 : 1);
      continue;
    }
    const m = text.slice(i, i + 8).match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/);
    if (m) {
      const p =
        'CDEFGAB'.indexOf(m[2].toUpperCase()) +
        (m[2] >= 'a' ? 7 : 0) +
        [...m[3]].reduce((n, x) => n + (x === "'" ? 7 : -7), 0);
      const r = pitch({acc: m[1] ? ACC_VALUE[m[1]] : null, pitch: p});
      if (r == null) return null;
      out += r;
      i += m[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
// Spell a stretch of music d letter names away at the same pitch (Gb major written as F# major is d = -1). Written
// accidentals change to keep each pitch; the key signature changes with the letters, so plain notes stay plain.
function respellMusic(text, d) {
  return mapMusic(
    text,
    ({acc, pitch}) => {
      if (acc == null) return pitchToken(pitch + d);
      const a = acc + diatonicSemis(pitch) - diatonicSemis(pitch + d);
      return Math.abs(a) > 2 ? null : ACC_TEXT[a] + pitchToken(pitch + d);
    },
    name => {
      let ok = true;
      const out = name.replace(/(^|\/)([A-G])([#b]?)/g, (_, lead, letter, acc) => {
        const from = 'CDEFGAB'.indexOf(letter),
          to = posMod(from + d, 7),
          a = posMod(LETTER_SEMIS[from] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) - LETTER_SEMIS[to] + 6, 12) - 6;
        if (Math.abs(a) > 1) ok = false;
        return lead + 'CDEFGAB'[to] + (a > 0 ? '#' : a < 0 ? 'b' : '');
      });
      return ok ? out : name;
    }
  );
}
// Enharmonic respelling (Z): every pitch of a note or chord moves to its next spelling at the same pitch, keeping
// length, ties and decorations. ^C becomes _D and back; E becomes _F; D, G and A, which have no other spelling with
// one accidental, cycle through double ones (D, __E, ^^C). A chord moves as one, so that two presses bring it back:
// its D, G and A stay plain while any other pitch can swap ([GCE] gives [G^B,_F]), and cycle only in a chord of
// nothing else. key is a parsed abcjs key, as midiToken takes: an accidental is written only where the key signature
// would not give the new spelling, or always with explicit. midis gives each pitch's MIDI note in source order, for a
// bar where an earlier accidental changes a plain letter; without it, a pitch is read from its own accidental or the
// key. Rests are left as they are.
function respell(text, key, {midis = null, explicit = false} = {}) {
  const parts = noteParts(text);
  if (!parts || /^[zx]/.test(parts.core)) return text;
  const alters = keyAlters(key),
    PITCH = /(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g;
  const pitches = [...parts.core.matchAll(PITCH)].map(([, acc, letter, marks], i) => {
    const step =
        'CDEFGAB'.indexOf(letter.toUpperCase()) +
        (letter >= 'a' ? 7 : 0) +
        [...marks].reduce((n, c) => n + (c === "'" ? 7 : -7), 0),
      midi = midis?.[i] ?? 60 + diatonicSemis(step) + (acc ? ACC_VALUE[acc] : alters[letter.toUpperCase()] || 0);
    // Spellings of the pitch on nearby letters, lowest letter (most sharps) first.
    const spellings = [];
    for (let s = step - 2; s <= step + 2; s++) {
      const alter = midi - 60 - diatonicSemis(s);
      if (Math.abs(alter) <= 2) spellings.push({step: s, alter});
    }
    return {step, spellings, single: spellings.filter(s => Math.abs(s.alter) <= 1)};
  });
  const swap = pitches.some(p => p.single.length > 1);
  let i = 0;
  const core = parts.core.replace(PITCH, whole => {
    const {step, spellings, single} = pitches[i++];
    if (!spellings.length) return whole;
    const cycle = swap ? single : spellings,
      at = cycle.findIndex(s => s.step === step),
      // A spelling outside the cycle (__D for C) goes to the plainest one.
      next = at < 0 ? spellings.find(s => !s.alter) || cycle[0] : cycle[(at + 1) % cycle.length],
      keyAlter = alters['CDEFGAB'[posMod(next.step, 7)]] || 0;
    if (next.step === step && !explicit) return whole;
    return (explicit || next.alter !== keyAlter ? ACC_TEXT[next.alter] : '') + pitchToken(next.step);
  });
  return parts.pre + core + text.slice(parts.pre.length + parts.core.length);
}
// A tune without a K: line is read in C major. Transposing it needs a key to move, so K:C closes its header.
function withKey(source) {
  if (/(^|\n)K:/.test(source)) return source;
  const lines = source.split('\n'),
    i = lines.findIndex(x => !/^([A-Za-z]:|%)/.test(x));
  lines.splice(i < 0 ? lines.length : i, 0, 'K:C');
  return lines.join('\n');
}
// Transpose a whole tune by semitones, spelled letters names away (by default the usual interval for the distance:
// 2 is a major 2nd, 6 a diminished 5th). abcjs's strTranspose moves the notes, keys and chord symbols; around it, K:
// modifiers such as clef= are set aside (strTranspose garbles them), and each key it spells differently from the
// interval is respelled, F# rather than Gb for an augmented 4th up from C, unless that needs more than maxAccidentals.
// strTranspose also moves some keys an octave off (F# major asked up 12 semitones stays put, Bb major asked down 11
// goes up 1, Cb major asked for 0 goes up 12), so whole octaves move here, and each note it moves is checked against
// the source and put back in the octave the interval calls for.
function transposeABC(source, semitones, letters = Math.round((semitones * 7) / 12), maxAccidentals = 6) {
  if (!semitones && !posMod(letters, 7)) return source;
  source = withKey(source);
  const octaves = Math.trunc(semitones / 12),
    within = semitones - 12 * octaves;
  const fields = keyFields(source).map((f, i) => ({...f, ...keyParts(f.value), first: i === 0}));
  if (fields.some(f => keyFifths(f.value) == null)) throw new Error('Bagpipe keys (K:HP) cannot be transposed.');
  // A header K: without a key means C; strTranspose needs to see it. Inline clef-only fields keep the key in force.
  let stripped = source;
  for (const f of fields.slice().reverse())
    if (f.tonic || f.first) stripped = stripped.slice(0, f.start) + (f.key || 'C') + stripped.slice(f.end);
  const tune = ABCJS.parseOnly(stripped),
    moved = within ? ABCJS.strTranspose(stripped, tune, within) : stripped,
    after = keyFields(moved);
  if (after.length !== fields.length) throw new Error('Could not transpose the key signatures.');
  const regions = fields.map((f, i) => {
    const res = keyParts(after[i].value),
      region = {
        start: after[i].start,
        end: after[i].end,
        keyed: !!(f.tonic || f.first),
        key: res.key,
        d: 0,
        chords: letters
      };
    if (!region.keyed) return {...region, key: after[i].value};
    const rest = f.tonic ? f.rest : (f.rest.trim() ? ' ' : '') + f.rest.trim();
    if (!res.tonic || res.tonic === 'none') return {...region, key: res.key + rest};
    const from = 'CDEFGAB'.indexOf((f.tonic || 'C')[0]),
      want = posMod(from + letters, 7),
      have = 'CDEFGAB'.indexOf(res.tonic[0]),
      d = posMod(want - have + 3, 7) - 3,
      pc = LETTER_SEMIS[have] + (res.tonic[1] === '#' ? 1 : res.tonic[1] === 'b' ? -1 : 0),
      acc = posMod(pc - LETTER_SEMIS[want] + 6, 12) - 6,
      tonic = 'CDEFGAB'[want] + (acc > 0 ? '#' : acc < 0 ? 'b' : ''),
      key = tonic + res.key.slice(res.tonic.length);
    // Chord symbols move by the letters this key ends up moved: abcjs's, or the interval's once respelled.
    if (Math.abs(d) !== 1 || Math.abs(acc) > 1 || Math.abs(keyFifths(key)) > maxAccidentals)
      return {...region, key: res.key + rest, chords: have - from};
    return {...region, key: key + rest, plain: res.key + rest, d};
  });
  const edits = regions.map(r => ({start: r.start, end: r.end, text: r.key}));
  // Notes, and bar lines with text before them ("D.C."|), which abcjs moves like a chord symbol.
  const notesOf = t =>
      (t.lines || []).flatMap(line =>
        (line.staff || []).flatMap(staff =>
          (staff.voices || []).flat().filter(e => e.el_type === 'note' || (e.el_type === 'bar' && e.chord))
        )
      ),
    pitchesOf = text => {
      const list = [];
      mapMusic(text, ({pitch}) => (list.push(pitch), ''));
      return list;
    },
    chordsOf = text => {
      const list = [];
      mapMusic(
        text,
        () => '',
        name => (list.push(name), name)
      );
      return list;
    };
  const starts = regions.filter(r => r.keyed),
    was = notesOf(tune[0]),
    now = within ? notesOf(ABCJS.parseOnly(moved)[0]) : was,
    steps = Math.round((within * 7) / 12);
  if (was.length !== now.length) throw new Error('Could not transpose the notes.');
  for (const [n, e] of now.entries()) {
    const region = starts.filter(r => r.start < e.startChar).at(-1);
    if (!within && !octaves && !region?.d) continue;
    const old = pitchesOf(stripped.slice(was[n].startChar, was[n].endChar)),
      oldChords = chordsOf(stripped.slice(was[n].startChar, was[n].endChar));
    let j = 0,
      k = 0,
      text = mapMusic(moved.slice(e.startChar, e.endChar), ({acc, pitch}) => {
        // A note moved a whole octave off the interval's letters is abcjs's octave slip; move it back.
        const slip = j < old.length ? Math.round((pitch - old[j] - steps) / 7) : 0;
        j++;
        return (acc == null ? '' : ACC_TEXT[acc]) + pitchToken(pitch + 7 * (octaves - slip));
      });
    if (region?.d) text = respellMusic(text, region.d);
    // abcjs spells moved chord symbols without regard to the key (D# for Eb) and moves any text starting with A–G
    // (Coda to Doda), so each is redone here from the source's own: chord names moved by the key's letters, other text
    // (N.C., Coda, D.C.) left as it was.
    if (text != null && oldChords.length)
      text = mapMusic(
        text,
        ({acc, pitch}) => (acc == null ? '' : ACC_TEXT[acc]) + pitchToken(pitch),
        name => (k < oldChords.length ? transposeChordSymbol(oldChords[k++], within, region?.chords ?? letters) : name)
      );
    // A pitch that would need a triple sharp or flat: keep abcjs's spelling everywhere.
    if (text == null) return transposeABC(source, semitones, letters, -1);
    if (text !== moved.slice(e.startChar, e.endChar)) edits.push({start: e.startChar, end: e.endChar, text});
  }
  let out = '',
    at = 0;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    out += moved.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + moved.slice(at);
}
// Letter names from concert to written pitch at a position in a concert source, for an instrument whose written notes
// sound semitones lower. Plain notes move by the letters between the keys transposeABC writes: usually the shift's own
// interval, but F# major on a B-flat clarinet is written in Ab (G# major would need 8 sharps), 2 letters up, not 1.
function writtenSteps(source, at, semitones) {
  const usual = Math.round((semitones * 7) / 12);
  if (!semitones) return 0;
  const keyed = withKey(source),
    from = keyFields(keyed);
  let to;
  try {
    to = keyFields(transposeABC(keyed, semitones));
  } catch {
    return usual;
  }
  at += keyed.length - source.length;
  const i = from
    .map((f, n) => (f.start < at && (!n || keyParts(f.value).tonic) ? n : -1))
    .reduce((a, b) => Math.max(a, b));
  if (i < 0 || to.length !== from.length) return usual;
  const a = keyParts(from[i].value).tonic || 'C',
    b = keyParts(to[i].value).tonic;
  if (!/^[A-G]/.test(a) || !/^[A-G]/.test(b || '')) return usual;
  return usual + posMod('CDEFGAB'.indexOf(b[0]) - 'CDEFGAB'.indexOf(a[0]) - usual + 3, 7) - 3;
}
// Write each pitch of a tune under another key signature at the same pitch: accidentals are added where the new
// signature (or an accidental earlier in the bar) would change a note, and written accidentals are kept.
function rekeyMusic(source, fromFifths, toFifths) {
  const sig = fifths => {
    const s = {C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0};
    for (let i = 0; i < Math.abs(fifths); i++) s[(fifths > 0 ? 'FCGDAEB' : 'BEADGCF')[i % 7]] += Math.sign(fifths);
    return s;
  };
  const from = sig(fromFifths),
    to = sig(toFifths),
    edits = [];
  for (const line of ABCJS.parseOnly(source)[0].lines || [])
    for (const staff of line.staff || [])
      for (const voice of staff.voices || []) {
        let had = new Map(),
          has = new Map();
        for (const e of voice) {
          if (e.el_type === 'bar') {
            had = new Map();
            has = new Map();
          }
          if (e.el_type !== 'note') continue;
          const text = mapMusic(source.slice(e.startChar, e.endChar), ({acc, pitch}) => {
            const letter = 'CDEFGAB'[posMod(pitch, 7)],
              actual = acc ?? had.get(pitch) ?? from[letter];
            if (acc != null) had.set(pitch, acc);
            if (acc == null && actual === (has.get(pitch) ?? to[letter])) return pitchToken(pitch);
            has.set(pitch, actual);
            return ACC_TEXT[actual] + pitchToken(pitch);
          });
          edits.push({start: e.startChar, end: e.endChar, text});
        }
      }
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
// Transpose part of a tune: a slice of its music, read in the key and unit length in force there. The slice moves in
// a small tune of its own, then is written back under the original key signature with accidentals where needed.
function transposeSlice(slice, key, unit, semitones, letters = Math.round((semitones * 7) / 12)) {
  if (keyFields(slice).length) throw new Error('The selection changes key. Transpose the whole score instead.');
  const keyText = keyParts(key).key || 'C',
    mini = `X:1\nL:${unit}\nK:${keyText}\n`,
    moved = transposeABC(mini + slice, semitones, letters, 7),
    head = moved.indexOf('\n', keyFields(moved)[0].start) + 1;
  return rekeyMusic(moved, keyFifths(keyFields(moved)[0].value), keyFifths(keyText)).slice(head);
}
// The stretches of source text holding the notes of measures from..to, one per voice and per run of lines that
// voice occupies, so text between voices (V: lines, other voices' bars) is never touched.
function measureSpans(tune, from, to) {
  const spans = [];
  let run = null;
  for (const e of scoreEvents(tune).sort((a, b) => a.element.startChar - b.element.startChar)) {
    const voice = e.key.split(':').slice(0, 2).join(':'),
      inside = e.element.el_type === 'note' && e.measure >= from && e.measure <= to;
    if (inside && run?.voice === voice) run.end = e.element.endChar;
    else if (inside) spans.push((run = {voice, start: e.element.startChar, end: e.element.endChar}));
    else if (e.element.el_type === 'note' || voice !== run?.voice) run = null;
  }
  return spans;
}
// Measure and form tools. A voice ('staff:voice', as in scoreEvents) measure by measure, numbered as scoreEvents
// numbers them (a bar line ends a measure only once it holds notes). Each measure has its notes and rests, the bar line
// before it, the bar line that closes it (null for an open last measure), the line of the tune it starts on, and the
// meter and clef in force at the bar line before it and at its first note. opens is true when the bar line before it
// is one of its own, at the start of its line, rather than the one that closed the measure before.
const clefName = clef =>
  !clef?.type ? 'treble' : clef.type === 'alto' && clef.verticalPos === -8 ? 'tenor' : clef.type;
function voiceMeasures(tune, voice) {
  const [s, v] = voice.split(':').map(Number),
    out = [];
  let header = null,
    meter = null,
    clef = null,
    atBar = null,
    before = null,
    cur = null;
  for (const [line, row] of (tune.lines || []).entries()) {
    for (const staff of row.staff || []) header ??= meterInfo(staff.meter);
    const staff = row.staff?.[s];
    if (!staff?.voices?.[v]) continue;
    // A time signature at the start of a later line (after a V: line) is the staff's.
    meter = meterInfo(staff.meter) ?? meter ?? header ?? 'free';
    if (staff.clef) clef = staff.clef;
    atBar ??= {meter, clef};
    for (const e of staff.voices[v]) {
      if (e.el_type === 'meter') meter = meterInfo(e) || meter;
      else if (e.el_type === 'clef') clef = e;
      else if (e.el_type === 'note') {
        cur ??= {
          measure: out.length + 1,
          line,
          notes: [],
          before,
          opens: !!before && before !== out.at(-1)?.bar,
          meterBefore: atBar.meter,
          clefBefore: clefName(atBar.clef),
          meter,
          clef: clefName(clef)
        };
        cur.notes.push(e);
      } else if (e.el_type === 'bar') {
        if (cur) out.push({...cur, bar: e});
        cur = null;
        before = e;
        atBar = {meter, clef};
      }
    }
  }
  if (cur) out.push({...cur, bar: null});
  return out.map(m => ({...m, first: m.notes[0], last: m.notes.at(-1)}));
}
function measureBounds(tune, voice, measure) {
  return voiceMeasures(tune, voice)[measure - 1] || null;
}
// The voices of a score in reading order, without & overlays: an overlay is written inside another voice's bars
// (abcjs gives it the same bar lines), so measure edits to that voice cover it.
function scoreVoices(tune, source = '') {
  const order = [],
    overlay = new Set(),
    bars = new Map();
  for (const {element: e, key} of scoreEvents(tune)) {
    const id = key.split(':').slice(0, 2).join(':');
    if (!order.includes(id)) {
      order.push(id);
      if (/&\s*$/.test(source.slice(Math.max(0, e.startChar - 40), e.startChar))) overlay.add(id);
    }
    if (e.el_type !== 'bar') continue;
    if (!bars.has(e.startChar)) bars.set(e.startChar, id);
    else if (bars.get(e.startChar) !== id) overlay.add(id);
  }
  return order.filter(id => !overlay.has(id));
}
// The voices an edit to a measure goes to, each at the same measure number. A multi-measure rest (Z3) is one measure
// of its voice but several bars of the score, so when the staves' bars up to the measure do not line up there is no
// measure to edit on every staff.
function everyVoice(tune, source, measure) {
  const voices = scoreVoices(tune, source),
    bars = m => m.notes.reduce((n, e) => (e.rest?.type === 'multimeasure' ? Math.max(n, +e.rest.text || 1) : n), 1),
    spans = voices.map(voice => voiceMeasures(tune, voice).slice(0, measure).map(bars)),
    common = Math.min(...spans.map(s => s.length)),
    steps = new Set(spans.map(s => s.slice(0, common).join()));
  if (spans.some(s => s.some(n => n > 1)) && steps.size > 1)
    throw new Error('A multi-measure rest (Z) puts the staves out of step here. Write it as one rest per bar first.');
  // Staves are numbered by place, so a score whose staves change partway through has no measure to edit on each.
  if (voices.length > 1 && (source.match(/^%%(?:score|staves)\b/gm) || []).length > 1)
    throw new Error('The staves change partway through this score. Edit its bars in the ABC text.');
  return voices;
}
const lineStartOf = (source, at) => source.lastIndexOf('\n', at - 1) + 1;
// Where a voice's music on a line of the tune starts: at the start of its line of text, after any [V:] field there.
// The line may start with the end of a measure begun on the line before.
function lineOpen(source, tune, voice, line) {
  const [s, v] = voice.split(':').map(Number),
    first = tune.lines[line]?.staff?.[s]?.voices?.[v]?.find(e => e.startChar >= 0);
  if (!first) return source.length;
  const at = lineStartOf(source, first.startChar),
    field = source.slice(at, first.startChar).match(/^\s*\[V:[^\]\n]*\]/);
  return field ? at + field[0].length : at;
}
// Where a measure's text starts: after the bar line before it when that is on the same line of text, otherwise at the
// start of its line, after any [V:] field there. Inline fields at the start of the measure ([M:3/4], [P:A]) follow.
function measureOpen(source, m) {
  const first = m.first.startChar;
  let at =
    m.before && !source.slice(m.before.endChar, first).includes('\n') ? m.before.endChar : lineStartOf(source, first);
  const voiceField = [...source.slice(at, first).matchAll(/\[V:[^\]\n]*\]/g)].at(-1);
  if (voiceField) at += voiceField.index + voiceField[0].length;
  return at;
}
// A bar line's text as its symbol and the ending it starts: '|1' is '|' and '1', ':| [2' is ':|' and '2', a bare '[1'
// at the start of a line has no symbol.
function barParts(text) {
  const e = String(text).match(/\s*\[?(\d[\d,-]*)\s*$/);
  return {glyph: (e ? text.slice(0, e.index) : text).trim(), ending: e ? e[1] : null};
}
// Where a bar line's own text starts: abcjs counts decorations and annotations written before it (!fermata!|) in it.
const barFrom = (source, bar) =>
  bar.startChar +
  source.slice(bar.startChar, bar.endChar).match(/^(?:\s*(?:![^!\n]*!|\+[^+\n]*\+|"[^"\n]*"))*\s*/)[0].length;
const barOf = (source, bar) => barParts(source.slice(barFrom(source, bar), bar.endChar));
function barLineText(glyph, ending) {
  if (!ending) return glyph;
  return glyph.endsWith('|') ? glyph + ending : (glyph ? glyph + ' ' : '') + '[' + ending;
}
// Replace a bar line's symbol with type (a bar line such as '||' or '|]'), keeping the ending it starts unless ending
// is given ('2', or null for none). A bar line stays a bar line: with no symbol and no ending it is a plain '|'.
function barLineEdit(abc, bar, type, ending) {
  const old = barOf(abc, bar);
  return {
    start: barFrom(abc, bar),
    end: bar.endChar,
    text: barLineText(type ?? old.glyph, ending === undefined ? old.ending : ending) || '|'
  };
}
function replaceBarLine(abc, bar, type, ending) {
  return spliceAll(abc, [barLineEdit(abc, bar, type, ending)]);
}
// A bar line symbol with a start or end repeat turned on or off, keeping the other: '|' to '|:', ':|' to '::', '::'
// to ':|'. A final bar cannot start a repeat, so it gives way to a plain one.
const startsRepeat = glyph => /:$/.test(glyph),
  endsRepeat = glyph => /^:/.test(glyph);
function repeatGlyph(glyph, which, on) {
  const start = which === 'start' ? on : startsRepeat(glyph),
    end = which === 'end' ? on : endsRepeat(glyph);
  if (start && end) return '::';
  let core = glyph.replace(/^:+|:+$/g, '') || (start || end ? '|' : '');
  if ((start && core === '|]') || (end && core === '[|')) core = '|';
  return (end ? ':' : '') + core + (start ? ':' : '');
}
const onOneLine = (source, from, to) => !/\n|\[V:/.test(source.slice(from, to));
// The bar line that opens a measure: the one before it on its line, or one ending the line before that already starts
// a repeat or an ending. null when the measure starts its line, or the music, without one.
function openBar(source, m) {
  if (!m.before) return null;
  if (onOneLine(source, m.before.endChar, m.first.startChar)) return m.before;
  const {glyph, ending} = barOf(source, m.before);
  return startsRepeat(glyph) || ending ? m.before : null;
}
// Apply edits ({start, end, text}) to a source. Edits that overlap would garble it, so they are refused.
function spliceAll(source, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const [i, e] of sorted.entries()) {
    if (i && e.end > sorted[i - 1].start)
      throw new Error('This change does not fit the way this score is written. Make it in the ABC text.');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
// Change the bar line on one side of a measure ('open' or 'close') in every voice, so all staves repeat and end
// together. change({glyph, ending}) gives the new {glyph, ending}. A missing bar line is written when the change
// gives one (a start repeat at the start of a line); a bar line of a measure's own at the start of its line goes when
// nothing is left of it.
function editBars(source, tune, measure, side, change) {
  const edits = [];
  for (const voice of everyVoice(tune, source, measure)) {
    const m = measureBounds(tune, voice, measure);
    if (!m) continue;
    const bar = side === 'open' ? openBar(source, m) : m.bar,
      old = bar ? barOf(source, bar) : {glyph: '', ending: null},
      next = change(old),
      text = barLineText(next.glyph, next.ending);
    if (bar) {
      const lead = source.slice(lineStartOf(source, bar.startChar), barFrom(source, bar));
      if (bar === m.before && m.opens && (!text || text === '|') && /^(\s|\[[A-Za-z]:[^\]\n]*\])*$/.test(lead)) {
        let end = bar.endChar;
        while (source[end] === ' ') end++;
        edits.push({start: barFrom(source, bar), end, text: ''});
      } else edits.push(barLineEdit(source, bar, next.glyph, next.ending));
    } else if (text && side === 'open') {
      const at = measureOpen(source, m);
      edits.push({start: at, end: at, text: (at && !/\s/.test(source[at - 1]) ? ' ' : '') + text + ' '});
    } else if (text) {
      let at = m.last.endChar;
      while (at > 0 && /\s/.test(source[at - 1])) at--;
      edits.push({start: at, end: at, text: ' ' + text});
    }
  }
  return spliceAll(source, edits);
}
// The unit note length (L:) in force at a position: the last L: field before it, or the default for the header meter
// (1/16 below 3/4, 1/8 otherwise).
function unitLengthIn(source, at) {
  let found = null;
  for (const m of source.slice(0, at).matchAll(/(?:^|\n)L:\s*(\d+)\s*\/\s*(\d+)|\[L:\s*(\d+)\s*\/\s*(\d+)\s*\]/g))
    found = m;
  if (found) return +(found[1] || found[3]) / +(found[2] || found[4]);
  const meter = source.match(/(?:^|\n)M:[ \t]*(\d+)\s*\/\s*(\d+)/);
  return meter && +meter[1] / +meter[2] < 0.75 ? 1 / 16 : 1 / 8;
}
// A whole-bar rest for a meter, written in the unit length at a position. A bar in free time takes the length of the
// measure it is next to. abcjs cannot draw a rest shorter than a whole note that is no plain, dotted or double-dotted
// value (5/8, 9/16), so such a bar gets several rests, longest first: z4 z for 5/8 in eighths.
function barRest(source, at, meter, m) {
  const unit = unitLengthIn(source, at),
    fits = v => v > 1 - 1e-9 || [1, 1.5, 1.75].some(d => Number.isInteger(Math.round(Math.log2(d / v) * 1e6) / 1e6)),
    rests = [];
  let left = meter?.length || m.notes.reduce((sum, n) => sum + (n.duration || 0), 0) || 1;
  while (left > 1e-9 && rests.length < 8) {
    const part = fits(left) ? left : 2 ** Math.floor(Math.log2(left));
    rests.push('z' + lengthText(part / unit));
    left -= part;
  }
  return rests.join(' ');
}
// Insert an empty bar (a whole-bar rest in the meter in force there) before or after a measure, in every voice. The new
// bar takes the measure's place, or follows it inside the same repeat, ending or section: before the measure it goes
// after the bar line that opens it, and after it, before the bar line that closes it.
function insertMeasure(source, tune, measure, after = false) {
  const edits = [];
  for (const voice of everyVoice(tune, source, measure)) {
    const m = measureBounds(tune, voice, measure);
    if (!m) continue;
    if (!after) {
      const at = measureOpen(source, m),
        rest = barRest(source, at, m.meterBefore, m);
      edits.push({
        start: at,
        end: at,
        text: (at && !/\s/.test(source[at - 1]) ? ' ' : '') + rest + ' |' + (/\s/.test(source[at] || '') ? '' : ' ')
      });
    } else if (m.bar) {
      const at = m.bar.startChar;
      edits.push({
        start: at,
        end: at,
        text: (at && !/\s/.test(source[at - 1]) ? ' ' : '') + '| ' + barRest(source, at, m.meter, m) + ' '
      });
    } else {
      let at = m.last.endChar;
      while (at > 0 && /\s/.test(source[at - 1])) at--;
      edits.push({start: at, end: at, text: ' | ' + barRest(source, at, m.meter, m)});
    }
  }
  return spliceAll(source, edits);
}
// Inline fields that change the music after them (key, meter, unit length, tempo, voice, instructions) outlive a
// deleted measure; a rehearsal mark goes with it.
const KEPT_FIELD = /\[[KMLQVIU]:[^\]\n]*\]/g;
// The bar lines on either side of a deleted measure ({glyph, ending}; closing is null for an open last measure) made
// into one: {end, core, start, ending}. A repeat that held only that measure goes; an end repeat, double or final bar
// line that closed it moves back; a start repeat or an ending it opened moves on to the measure after it, or goes
// when nothing follows.
const barCore = glyph => glyph.replace(/^:+|:+$/g, '') || '|';
function joinBars(before, closing, last) {
  const opened = startsRepeat(before.glyph),
    closed = !!closing && endsRepeat(closing.glyph);
  return {
    end: endsRepeat(before.glyph) || (closed && !opened),
    core: closing && barCore(closing.glyph) !== '|' ? barCore(closing.glyph) : barCore(before.glyph),
    start: !last && ((!!closing && startsRepeat(closing.glyph)) || (opened && !closed)),
    ending: last ? null : closing?.ending || (closing?.glyph === '|' ? before.ending : null)
  };
}
const joinedBarText = ({end, core, start, ending}) =>
  barLineText(repeatGlyph(repeatGlyph(core, 'end', end), 'start', start), ending);
// The end of the w: lines (and their +: continuations) under the line of music that ends at lineEnd.
function lyricsEnd(source, lineEnd) {
  const words = /\n[ \t]*[w+]:[^\n]*/y;
  let at = lineEnd;
  words.lastIndex = at;
  while (words.exec(source)) at = words.lastIndex;
  return at;
}
// Delete a measure from every voice, with its bar lines joined into one (joinBars). When nothing but a voice field is
// left on its line of text, the music goes with the words under it, and so does the line when nothing is left: a
// blank line would end the tune. Rehearsal letters are then kept in order.
function deleteMeasure(source, tune, measure) {
  const edits = [],
    marks = rehearsalMarks(source).length,
    relabel = !partNames(source);
  for (const voice of everyVoice(tune, source, measure)) {
    const list = voiceMeasures(tune, voice),
      m = list[measure - 1];
    if (!m) continue;
    if (list.length < 2) throw new Error('A staff needs at least one bar.');
    const open = measureOpen(source, m);
    let end = m.bar ? m.bar.endChar : m.last.endChar;
    // A measure may run on over a line break, but not past a field line, a comment or another voice.
    if (/\n\s*(?:[A-Za-z+]:|%)|\[V:/.test(source.slice(open, end)))
      throw new Error('This measure runs over a line of fields or another voice. Delete it in the ABC text.');
    const parts = bar => barOf(source, bar),
      // A bar line of the measure's own at the start of its line goes with it; prior closes the measure before.
      own = m.opens ? m.before : null,
      prior = own ? list[measure - 2]?.bar : m.before,
      b = m.before && parts(m.before),
      a = prior ? parts(prior) : {glyph: '|', ending: null},
      joined =
        b &&
        joinBars(
          own
            ? {
                glyph: (endsRepeat(a.glyph) ? ':' : '') + barCore(a.glyph) + (startsRepeat(b.glyph) ? ':' : ''),
                ending: b.ending
              }
            : b,
          m.bar && parts(m.bar),
          !list[measure]
        ),
      // An open last measure takes a plain bar line before it on its line with it.
      dropPrior =
        !m.bar && !own && prior && onOneLine(source, prior.endChar, m.first.startChar) && joinedBarText(joined) === '|',
      kept = (source.slice(open, end).match(KEPT_FIELD) || []).join(' ');
    let start = own ? own.startChar : dropPrior ? prior.startChar : open;
    while (source[end] === ' ' || source[end] === '\t') end++;
    const lineStart = lineStartOf(source, start),
      lineEnd = source.indexOf('\n', end) < 0 ? source.length : source.indexOf('\n', end),
      left = source.slice(lineStart, start) + kept + source.slice(end, lineEnd),
      bare = !left.replace(/\[V:[^\]\n]*\]/g, '').trim();
    // While music is left on the line, a start repeat or an ending that moves on keeps a bar line of its own at the
    // start of the line; otherwise it joins the bar line before. A start repeat at the very start of the music is
    // implied.
    let opener = '';
    if (joined && own && !bare) opener = barLineText(joined.start ? '|:' : '', joined.ending);
    else if (!m.before && m.bar && !bare) opener = barLineText('', parts(m.bar).ending);
    if (joined && prior && !dropPrior) {
      const text = joinedBarText(own && !bare ? {...joined, start: false, ending: null} : joined);
      if (text !== source.slice(barFrom(source, prior), prior.endChar))
        edits.push({start: barFrom(source, prior), end: prior.endChar, text});
    }
    const text = [opener, kept].filter(Boolean).join(' ');
    if (!text && end >= lineEnd) while (start > lineStart && /[ \t]/.test(source[start - 1])) start--;
    if (!bare) {
      const lead = start > lineStart && !/\s/.test(source[start - 1]) ? ' ' : '';
      edits.push(
        splitVoiceLine(source, {
          start,
          end,
          text: text ? lead + text + (end < lineEnd ? ' ' : '') : start > lineStart && end < lineEnd ? lead : ''
        })
      );
      continue;
    }
    const words = lyricsEnd(source, lineEnd),
      next = source.slice(words + 1).match(/^[^\n]*/)[0];
    // Only a voice field is left: it stays while the lines after it may be in that voice.
    if (left.trim() && next.trim() && !/^\s*\[?V:/.test(next)) edits.push({start, end: words, text: ''});
    else
      edits.push(
        words < source.length
          ? {start: lineStart, end: words + 1, text: ''}
          : {start: Math.max(0, lineStart - 1), end: words, text: ''}
      );
  }
  const out = spliceAll(source, edits);
  return relabel && rehearsalMarks(out).length < marks ? letterRehearsalMarks(out) : out;
}
// The inline fields written directly at a position, in order: [{name, value, start, end}].
function fieldsAt(source, at) {
  const out = [],
    field = /\s*\[([A-Za-z]):([^\]\n]*)\]/y;
  field.lastIndex = at;
  let m;
  while ((m = field.exec(source)))
    out.push({name: m[1], value: m[2], start: m.index + m[0].indexOf('['), end: field.lastIndex});
  return out;
}
// What a field sets: its letter, and for K: whether it names a key ('K:key') or only a clef ('K:clef').
const fieldKind = (name, value) => (name === 'K' ? (keyParts(value).tonic ? 'K:key' : 'K:clef') : name);
// The edit that writes an inline field ('M:3/4', 'K:clef=bass', 'P:A') at a position, in place of a field of the same
// kind written there, or with field null removes that field: {start, end, text}, or null for no change. A key keeps the
// clef written after the key it replaces.
function inlineFieldEdit(abc, at, field, kind = field && fieldKind(field[0], field.slice(2))) {
  const old = fieldsAt(abc, at).find(f => fieldKind(f.name, f.value) === kind);
  if (old && kind === 'K:key') {
    const rest = keyParts(old.value).rest.trim();
    if (rest) field = field ? field + ' ' + rest : 'K:' + rest;
  }
  if (old && field) return {start: old.start, end: old.end, text: '[' + field + ']'};
  if (old) {
    const space = abc[old.end] === ' ' && (!old.start || /\s/.test(abc[old.start - 1]));
    return {start: old.start, end: old.end + (space ? 1 : 0), text: ''};
  }
  if (!field) return null;
  const text = (at && !/\s/.test(abc[at - 1]) ? ' ' : '') + '[' + field + ']' + (/\s/.test(abc[at] || '') ? '' : ' ');
  return {start: at, end: at, text};
}
function insertInlineField(abc, at, field, kind) {
  const edit = inlineFieldEdit(abc, at, field, kind);
  return edit ? spliceAll(abc, [edit]) : abc;
}
// Set a header field (the first line starting with name:), or add it before K:. A new key keeps the clef and other
// modifiers written after the old one.
function headerField(source, name, value) {
  if (name === 'K') source = withKey(source);
  const lines = source.split('\n'),
    i = lines.findIndex(x => x.startsWith(name + ':'));
  let text = name + ':' + String(value).replace(/[\r\n]/g, ' ');
  if (name === 'K' && i >= 0) text += keyParts(lines[i].slice(2)).rest.replace(/^(?=\S)/, ' ');
  if (i >= 0) lines[i] = text;
  else
    lines.splice(
      Math.max(
        0,
        lines.findIndex(x => x.startsWith('K:'))
      ),
      0,
      text
    );
  return lines.join('\n');
}
// The fields of one voice: header fields (before any music) and fields in the music that the voice's own notes or bar
// lines come after, in order.
function voiceFields(source, tune, voice, name) {
  const events = scoreEvents(tune)
    .map(e => ({at: e.element.startChar, voice: e.key.split(':').slice(0, 2).join(':')}))
    .sort((a, b) => a.at - b.at);
  const start = events[0]?.at ?? source.length,
    fields =
      name === 'K'
        ? keyFields(source)
        : [...source.matchAll(new RegExp(`(^|\\n)${name}:([^\\n%]*)|\\[${name}:([^\\]\\n]*)\\]`, 'g'))].map(m => ({
            start: m.index + (m[2] != null ? m[1].length + 2 : 3),
            value: m[2] ?? m[3]
          }));
  return fields.filter(f => f.start < start || events.find(e => e.at >= f.start)?.voice === voice);
}
// The key in force in a voice at a position (as keyAt, for one voice), and the time signature as written.
function voiceKeyAt(source, tune, voice, at) {
  const found = voiceFields(source, tune, voice, 'K').filter(f => f.start < at && keyParts(f.value).tonic);
  return found.length ? keyParts(found.at(-1).value).key : 'C';
}
function voiceMeterAt(source, tune, voice, at) {
  return (
    voiceFields(source, tune, voice, 'M')
      .filter(f => f.start < at)
      .at(-1)
      ?.value.trim() || 'none'
  );
}
const meterLabel = info => (info === 'free' || !info ? 'none' : info.label),
  meterValueLabel = value => ({C: '4/4', 'C|': '2/2'})[value] || value;
// A time signature from a measure on, in every voice. From measure 1 it is the header's M: field.
function meterChange(source, tune, measure, value) {
  if (measure === 1) return headerField(source, 'M', value);
  const edits = everyVoice(tune, source, measure)
    .map(voice => measureBounds(tune, voice, measure))
    .filter(Boolean)
    .map(m =>
      fieldEdit(
        source,
        measureOpen(source, m),
        meterLabel(m.meterBefore) === meterValueLabel(value) ? null : 'M:' + value,
        'M'
      )
    );
  return spliceAll(source, edits.filter(Boolean));
}
// Move a stretch of music from one key to another, written under the new key signature. Inline clef changes in it
// are kept.
function rekeySlice(slice, fromKey, toKey, unit) {
  const move = keyInterval(fromKey, toKey);
  if (!move) throw new Error('This key cannot be transposed.');
  const mini = `X:1\nL:${unit}\nK:${keyParts(fromKey).key || 'C'}\n`,
    moved = transposeABC(mini + slice, move.semitones, move.letters, 7),
    head = moved.indexOf('\n', keyFields(moved)[0].start) + 1;
  return rekeyMusic(moved, keyFifths(keyFields(moved)[0].value), keyFifths(toKey)).slice(head);
}
// abcjs mishandles a key, clef or time signature field written straight after an inline [V:] field that starts a line:
// a key gives the staff the first staff's clef, a clef is lost, a time signature goes to another staff, and on a
// staff's second voice the tune fails to parse. After a V: line of its own such fields work, so an edit ({start, end,
// text}) that leaves one there puts the voice field on a line of its own.
function splitVoiceLine(abc, edit) {
  if (!edit) return edit;
  const lineStart = lineStartOf(abc, edit.start),
    lead = abc.slice(lineStart, edit.start).match(/^[ \t]*\[V:([^\]\n]*)\]((?:[ \t]*\[[A-Za-z]:[^\]\n]*\])*)[ \t]*$/),
    text = edit.text.trim(),
    after = abc.slice(edit.end).match(/^(?:[ \t]*\[[A-Za-z]:[^\]\n]*\])*/)[0];
  if (!lead || !/^(?:\[[A-Za-z]:[^\]\n]*\]\s*)*$/.test(text) || !/\[[KM]:/.test(lead[2] + text + after)) return edit;
  const fields = [lead[2].trim(), text].filter(Boolean).join(' ');
  return {
    start: lineStart,
    end: edit.end,
    text: `V:${lead[1].trim()}\n${fields}${fields && /\S/.test(abc[edit.end] || '\n') ? ' ' : ''}`
  };
}
const fieldEdit = (abc, at, field, kind) => splitVoiceLine(abc, inlineFieldEdit(abc, at, field, kind));
// A key signature from a measure on, in every voice: an inline [K:] field (the header's K: from measure 1), up to the
// voice's next key change. With transpose the notes up to there move to the new key, the nearer way round; otherwise
// they stay where they are on the staff. abcjs starts every staff of a line in the key the line's earlier staves
// reached, so a later staff whose line starts before the change names its own key at the start of that line; a
// staff's other voices take the staff's key there.
function keyChange(source, tune, measure, key, transpose = false) {
  const voices = measure > 1 ? everyVoice(tune, source, measure) : scoreVoices(tune, source),
    edits = [];
  let header = false;
  for (const voice of voices) {
    const list = voiceMeasures(tune, voice),
      m = list[measure - 1];
    if (!m) continue;
    const at = measureOpen(source, m),
      from = voiceKeyAt(source, tune, voice, m.first.startChar),
      before = voiceKeyAt(source, tune, voice, at),
      next = voiceFields(source, tune, voice, 'K').find(f => f.start > m.first.startChar && keyParts(f.value).tonic),
      end = next ? next.start - 3 : source.length;
    if (transpose && canonicalKey(from) !== canonicalKey(key))
      for (const s of measureSpans(tune, measure, Infinity)) {
        if (s.voice !== voice || s.start >= end) continue;
        const stop = Math.min(s.end, end),
          unit = '1/' + Math.round(1 / unitLengthIn(source, s.start));
        edits.push({start: s.start, end: stop, text: rekeySlice(source.slice(s.start, stop), from, key, unit)});
      }
    if (measure === 1) header = true;
    else {
      const edit = fieldEdit(source, at, canonicalKey(before) === canonicalKey(key) ? null : 'K:' + key, 'K:key');
      if (edit) edits.push(edit);
    }
    const lineAt = lineOpen(source, tune, voice, m.line);
    if (/^[1-9]\d*:0$/.test(voice) && lineAt < at) {
      const own = voiceKeyAt(source, tune, voice, lineAt);
      if (
        canonicalKey(own) !== canonicalKey(key) &&
        !fieldsAt(source, lineAt).some(f => fieldKind(f.name, f.value) === 'K:key')
      )
        edits.push(fieldEdit(source, lineAt, 'K:' + own));
    }
  }
  const out = spliceAll(source, edits);
  return header ? headerField(out, 'K', key) : out;
}
// A clef from a measure on, on one voice's staff (every voice of it): an inline [K:clef=...] field, or none when the
// clef before is the same. shown is the clef shown before the measure, by default the source's: an instrument such as
// the cello shows the source in its own clef. A key field there that names a clef takes the new one instead.
function clefChange(source, tune, voice, measure, clef, shown) {
  const staff = voice.split(':')[0],
    same = (shown ?? measureBounds(tune, voice, measure)?.clefBefore) === clef,
    edits = [];
  for (const each of scoreVoices(tune, source).filter(v => v.split(':')[0] === staff)) {
    const m = measureBounds(tune, each, measure);
    if (!m) continue;
    const at = measureOpen(source, m),
      fields = fieldsAt(source, at),
      keyed = fields.find(f => fieldKind(f.name, f.value) === 'K:key' && /(^|\s)clef=\S+/.test(f.value));
    if (!keyed) {
      const edit = fieldEdit(source, at, same ? null : 'K:clef=' + clef, 'K:clef');
      if (edit) edits.push(edit);
      continue;
    }
    edits.push({start: keyed.start, end: keyed.end, text: `[K:${keyed.value.replace(/clef=\S+/, 'clef=' + clef)}]`});
    if (fields.some(f => fieldKind(f.name, f.value) === 'K:clef'))
      edits.push(inlineFieldEdit(source, at, null, 'K:clef'));
  }
  return spliceAll(source, edits);
}
// Form marks: segno and coda go on a measure's first note, Fine and the jumps on its last. A note has at most one
// jump, so a new one replaces another. abcjs's S and O shorthands count as segno and coda.
const FORM_MARKS = ['segno', 'coda', 'fine', 'D.C.', 'D.S.', 'D.C.alfine', 'D.S.alcoda'],
  JUMP_MARKS = FORM_MARKS.slice(2);
const formName = item => ({S: 'segno', O: 'coda'})[item] ?? markName(item);
function formMarks(text) {
  const parts = markItems(text);
  return parts ? parts.items.map(formName).filter(n => FORM_MARKS.includes(n)) : [];
}
function toggleFormMark(text, name) {
  const parts = markItems(text);
  if (!parts || !FORM_MARKS.includes(name)) return text;
  const had = parts.items.some(i => formName(i) === name),
    kept = parts.items.filter(i => {
      const n = formName(i);
      return n !== name && !(JUMP_MARKS.includes(name) && JUMP_MARKS.includes(n));
    });
  if (!had) kept.push(`!${name}!`);
  return kept.join('') + parts.rest;
}
// Rehearsal marks: inline [P:] fields and P: lines in the tune body. Marks lettered A to Z, then AA, BB and so on, are
// kept in order; other names are left as written. A P: line in the header names the order of parts, and a letter that
// comes back names a part played again, so then the letters are part names and stay as they are: a new mark takes
// the first letter not in use.
const rehearsalLetter = i => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26].repeat(Math.floor(i / 26) + 1),
  letteredMark = r => /^\s*([A-Z])\1*\s*$/.test(r.value);
function rehearsalMarks(source) {
  const k = /(^|\n)K:[^\n]*/.exec(source),
    from = k ? k.index + k[0].length : 0;
  return [...source.slice(from).matchAll(/\[P:([^\]\n]*)\]|\nP:([^\n%]*)/g)].map(m => {
    const value = m[1] ?? m[2],
      start = from + m.index + 3;
    return {start, end: start + value.length, value};
  });
}
// The header's order of parts (P:AABA), or null.
function partOrder(source) {
  const k = /(^|\n)K:/.exec(source);
  return source.slice(0, k ? k.index : 0).match(/(?:^|\n)P:([^\n%]*)/)?.[1] ?? null;
}
function partNames(source) {
  const letters = rehearsalMarks(source)
    .filter(letteredMark)
    .map(r => r.value.trim());
  return partOrder(source) != null || new Set(letters).size < letters.length;
}
function letterRehearsalMarks(source) {
  let i = 0;
  const edits = rehearsalMarks(source)
    .filter(letteredMark)
    .map(r => ({start: r.start, end: r.end, text: rehearsalLetter(i++)}));
  return spliceAll(source, edits);
}
// Add a rehearsal mark at the start of a measure in the first voice, or take away the one there; the marks are then
// lettered in order, unless they are part names.
function toggleRehearsal(source, tune, measure) {
  const m = measureBounds(tune, scoreVoices(tune, source)[0], measure);
  if (!m) return source;
  const at = measureOpen(source, m),
    has = fieldsAt(source, at).some(f => f.name === 'P');
  if (!partNames(source)) return letterRehearsalMarks(insertInlineField(source, at, has ? null : 'P:A', 'P'));
  const used = new Set([
    ...rehearsalMarks(source).map(r => r.value.trim()),
    ...((partOrder(source) || '').match(/[A-Z]/g) || [])
  ]);
  let i = 0;
  while (used.has(rehearsalLetter(i))) i++;
  return insertInlineField(source, at, has ? null : 'P:' + rehearsalLetter(i), 'P');
}
// Teacher-written assignments: a prompt object built from a score and carried in saves, backups and share links.
// Keys are written pitch, as for the built-in prompts. Goals name notes by the key's own degrees (minor adds the
// raised 7th); only major and minor keys have a scale for the inKey goal.
const MODE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10, 11],
  dor: [0, 2, 3, 5, 7, 9, 10],
  phr: [0, 1, 3, 5, 7, 8, 10],
  lyd: [0, 2, 4, 6, 7, 9, 11],
  mix: [0, 2, 4, 5, 7, 9, 10],
  loc: [0, 1, 3, 5, 6, 8, 10]
};
function keyScale(key) {
  const m = String(key).match(/^([A-G])([#b]?)(\S*)/),
    mode = (m?.[3] || '').toLowerCase().slice(0, 3);
  const name = /^(m|mi|min|aeo)$/.test(mode) ? 'minor' : /^(|ma|maj|ion)$/.test(mode) ? 'major' : mode;
  return {
    letter: m ? 'CDEFGAB'.indexOf(m[1]) : 0,
    tonic: m ? promptTonic(key) : 0,
    mode: MODE_STEPS[name] ? name : 'major',
    steps: MODE_STEPS[name] || MODE_STEPS.major,
    scale: m && (name === 'major' || name === 'minor') ? name : null
  };
}
function keyDegrees(key) {
  const {letter, tonic, steps} = keyScale(key);
  return steps.map((degree, i) => {
    const l = (letter + Math.min(i, 6)) % 7,
      alter = ((((tonic + degree - LETTER_SEMIS[l]) % 12) + 18) % 12) - 6;
    return {degree, name: 'CDEFGAB'[l] + ({'-2': '𝄫', '-1': '♭', 1: '♯', 2: '𝄪'}[alter] || '')};
  });
}
const degreeName = (key, degree) => keyDegrees(key).find(d => d.degree === degree)?.name || `${degree} semitones up`;
// A key in words, as written: "G", "F♯ minor", "D dorian".
const MODE_WORDS = {minor: 'minor', dor: 'dorian', phr: 'phrygian', lyd: 'lydian', mix: 'mixolydian', loc: 'locrian'};
function keyInWords(key) {
  const words = MODE_WORDS[keyScale(key).mode];
  return keyDegrees(key)[0].name + (words ? ' ' + words : '');
}
// The lengths, ranges and countable kinds a teacher can pick, with the words goal labels use.
const GOAL_LENGTHS = [
    [1 / 16, 'sixteenth'],
    [1 / 8, 'eighth'],
    [1 / 4, 'quarter'],
    [3 / 8, 'dotted quarter'],
    [1 / 2, 'half'],
    [3 / 4, 'dotted half'],
    [1, 'whole']
  ],
  GOAL_RANGES = [
    [7, 'a 5th'],
    [9, 'a 6th'],
    [12, 'one octave'],
    [19, 'an octave and a 5th'],
    [24, 'two octaves']
  ],
  GOAL_KINDS = {
    rest: ['rest', 'rests'],
    eighth: ['eighth note', 'eighth notes'],
    'dotted-quarter': ['dotted quarter note', 'dotted quarter notes'],
    'dotted-half': ['dotted half note', 'dotted half notes'],
    leap: ['leap of a 4th or more', 'leaps of a 4th or more']
  };
const listWords = words => (words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words.at(-1) : words[0]);
function goalLabel(goal, prompt) {
  const name = d => degreeName(prompt.key, d);
  if (goal.type === 'bars') return `Fill ${prompt.bars === 1 ? 'the bar' : `all ${prompt.bars} bars`} with notes`;
  if (goal.type === 'lengths') {
    const words = GOAL_LENGTHS.filter(([v]) => goal.allowed.includes(v)).map(([, w]) => w);
    return `Use only ${listWords(words.length ? words : ['the chosen'])} notes`;
  }
  if (goal.type === 'start') return `Start on ${name(goal.degree)}`;
  if (goal.type === 'end') return `End on ${name(goal.degree)}`;
  if (goal.type === 'endBar') return `Bar ${goal.bar} ends on ${name(goal.degree)}`;
  if (goal.type === 'steps') return 'Move only by step or repeat a note';
  if (goal.type === 'range')
    return `Stay within ${GOAL_RANGES.find(([v]) => v === goal.max)?.[1] || goal.max + ' semitones'}`;
  if (goal.type === 'inKey')
    return `Stay in ${prompt.key
      .match(/^[A-G][#b]?/)[0]
      .replace('#', '♯')
      .replace('b', '♭')} ${goal.scale}`;
  if (goal.kind === 'degree')
    return `Use ${name(goal.degree)} at least ${goal.count === 1 ? 'once' : goal.count + ' times'}`;
  const [one, many] = GOAL_KINDS[goal.kind];
  return `Use at least ${goal.count === 1 ? 'one ' + one : goal.count + ' ' + many}`;
}
// Build an assignment from the builder's choices. The id hashes the content, so the same assignment always has the
// same id wherever it is opened.
function makeAssignment({title, text, meter, unit, key, tempo, bars, goals}) {
  const prompt = {title, text, level: 'Custom', meter, unit, key, tempo, bars};
  prompt.goals = goals.map(g => ({...g, label: goalLabel(g, prompt)}));
  return {id: 'custom-' + hashText(JSON.stringify(prompt)).toString(36), ...prompt};
}
// An assignment from a link, a backup or storage is untrusted. Copy only known fields of the right type and size, or
// return null. Labels are rebuilt from the goal itself, so the checklist always says what is checked.
const ASSIGNMENT_TEXT_MAX = 2000;
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi,
  isDegree = d => isInt(d, 0, 11);
const GOAL_FIELDS = {
  bars: () => ({}),
  steps: () => ({}),
  lengths: g =>
    Array.isArray(g.allowed) &&
    g.allowed.length >= 1 &&
    g.allowed.length <= 8 &&
    g.allowed.every(a => typeof a === 'number' && Number.isFinite(a) && a > 0 && a <= 4)
      ? {allowed: [...g.allowed]}
      : null,
  start: g => (isDegree(g.degree) ? {degree: g.degree} : null),
  end: g => (isDegree(g.degree) ? {degree: g.degree} : null),
  endBar: (g, bars) => (isInt(g.bar, 1, bars) && isDegree(g.degree) ? {bar: g.bar, degree: g.degree} : null),
  range: g => (isInt(g.max, 0, 48) ? {max: g.max} : null),
  inKey: g => (g.scale === 'major' || g.scale === 'minor' ? {scale: g.scale} : null),
  atLeast: g =>
    !isInt(g.count, 1, 256)
      ? null
      : g.kind === 'degree'
        ? isDegree(g.degree)
          ? {kind: 'degree', degree: g.degree, count: g.count}
          : null
        : typeof g.kind === 'string' && Object.hasOwn(GOAL_KINDS, g.kind)
          ? {kind: g.kind, count: g.count}
          : null
};
function validPrompt(q) {
  const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x),
    isText = (s, max, empty = false) => typeof s === 'string' && s.length <= max && (empty || s.trim() !== '');
  if (!isObject(q)) return null;
  const {id, title, text, meter, unit, key, tempo, bars, goals} = q;
  if (
    !(typeof id === 'string' && /^custom-[a-z0-9]{1,13}$/.test(id)) ||
    !isText(title, 120) ||
    !isText(text, ASSIGNMENT_TEXT_MAX, true) ||
    !(typeof meter === 'string' && /^[1-9]\d?\/[1-9]\d?$/.test(meter)) ||
    !(typeof unit === 'string' && /^1\/[1-9]\d?$/.test(unit)) ||
    !(typeof key === 'string' && /^[A-G][#b]?[A-Za-z]{0,7}$/.test(key)) ||
    !(typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= 20 && tempo <= 400) ||
    !isInt(bars, 1, 999) ||
    !Array.isArray(goals) ||
    goals.length > 12
  )
    return null;
  const prompt = {id, title, text, level: 'Custom', meter, unit, key, tempo, bars, goals: []};
  for (const g of goals) {
    const fields =
      isObject(g) && typeof g.type === 'string' && Object.hasOwn(GOAL_FIELDS, g.type) && GOAL_FIELDS[g.type](g, bars);
    if (!fields) return null;
    const goal = {type: g.type, ...fields};
    prompt.goals.push({...goal, label: goalLabel(goal, prompt)});
  }
  return prompt;
}
// Note-name labels for every voice, as written: letters (F♯) or movable-do solfège (do-based major,
// la-based minor; notes raised against the key signature use sharp syllables, lowered ones flat syllables).
// Each voice keeps its own key and bar accidentals; a note tied across a bar line keeps the accidental it was tied
// from. Each label also has `midis`: every pitch of the note as playback sounds it (see playbackShift), `written`:
// every pitch as the staff shows it, before that shift, and `names`: every pitch spelled with its octave (F♯4).
const ACCIDENTAL_SIGNS = {1: '♯', 2: '𝄪', '-1': '♭', '-2': '𝄫'},
  SOLFEGE_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'],
  SOLFEGE_FLAT = ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'le', 'la', 'te', 'ti'];
function noteLabels(tune, mode) {
  const labels = [],
    voices = new Map(),
    globalShift = +tune.formatting?.midi?.transpose?.[0] || 0;
  const keyState = k => {
    const state = {key: keyAlters(k), doPc: 0};
    if (k?.root && k.root !== 'none') {
      const root = (LETTER_SEMIS['CDEFGAB'.indexOf(k.root)] + (k.acc === '#' ? 1 : k.acc === 'b' ? -1 : 0) + 12) % 12;
      state.doPc = /^m(in)?$/i.test(k.mode || '') ? (root + 3) % 12 : root;
    }
    return state;
  };
  for (const line of tune.lines || [])
    for (const [s, staff] of (line.staff || []).entries())
      for (const [v, voice] of (staff.voices || []).entries()) {
        const id = s + ':' + v,
          state = voices.get(id) || {carried: {}, tied: {}, shift: globalShift};
        voices.set(id, state);
        if (staff.key) Object.assign(state, keyState(staff.key));
        playbackShift(state, staff.clef, true);
        for (const e of voice) {
          if (e.el_type === 'key') {
            Object.assign(state, keyState(e));
            continue;
          }
          if (e.el_type === 'bar') {
            state.carried = {};
            continue;
          }
          if (e.el_type === 'clef' || (e.el_type === 'midi' && e.cmd === 'transpose')) {
            playbackShift(state, e);
            continue;
          }
          if (e.el_type !== 'note' || !e.pitches?.length || e.rest) continue;
          const key = state.key || {},
            tied = {};
          // Every pitch of a chord sets its own bar accidental and gets a MIDI number; the label names the first.
          const spelled = e.pitches.map(p => {
            const letter = ((p.pitch % 7) + 7) % 7,
              name = 'CDEFGAB'[letter];
            if (p.accidental) state.carried[p.pitch] = ALTER[p.accidental] ?? 0;
            const alter =
              (p.accidental || !p.endTie ? null : state.tied[p.pitch]) ?? state.carried[p.pitch] ?? key[name] ?? 0;
            if (p.startTie) tied[p.pitch] = alter;
            return {
              letter,
              name,
              alter,
              octave: 4 + Math.floor(p.pitch / 7),
              midi: 60 + 12 * Math.floor(p.pitch / 7) + LETTER_SEMIS[letter] + alter
            };
          });
          state.tied = tied;
          const {letter, name, alter, midi} = spelled[0],
            pc = (LETTER_SEMIS[letter] + alter + 12) % 12;
          // Lowered against the key signature (a flat, or a natural on a sharp) takes the flat syllable.
          const text =
            mode === 'solfege'
              ? (alter < (key[name] ?? 0) ? SOLFEGE_FLAT : SOLFEGE_SHARP)[(pc - (state.doPc || 0) + 12) % 12]
              : name + (ACCIDENTAL_SIGNS[alter] || '');
          labels.push({
            at: e.startChar,
            text,
            midi,
            midis: spelled.map(x => x.midi + state.shift),
            written: spelled.map(x => x.midi),
            names: spelled.map(x => x.name + (ACCIDENTAL_SIGNS[x.alter] || '') + x.octave)
          });
        }
      }
  return labels;
}
// How far playback moves a voice from the written pitches, by abcjs's MIDI rules. The latest change wins; they do not
// add up. %%MIDI transpose sets it for the whole tune. Each line's clef then applies its transpose= and octave
// (treble-8 sounds an octave down, and a plain clef after an octave clef goes back to 0). Inline clef changes and
// %%MIDI transpose lines in the voice apply where they stand. Pass lineStart for a line's clef.
function playbackShift(state, e, lineStart = false) {
  if (!e) return;
  if (e.el_type === 'midi') {
    state.shift = +e.params?.[0] || 0;
    return;
  }
  const octave = /-8/.test(e.type) ? -12 : /\+8/.test(e.type) ? 12 : 0;
  if (!lineStart) {
    if (e.transpose) state.shift = e.transpose;
    if (octave) state.shift = octave;
    return;
  }
  if (e.transpose && e.type !== 'perc') {
    state.shift = e.transpose;
    state.octaveClef = false;
  }
  if (octave) state.shift = octave;
  else if (state.octaveClef) state.shift = 0;
  state.octaveClef = !!octave;
}
// Add the labels to an ABC source as annotations below each note.
function labelSource(source, mode) {
  if (!mode || mode === 'off') return source;
  let out = source;
  for (const {at, text} of noteLabels(ABCJS.parseOnly(source)[0], mode).sort((a, b) => b.at - a.at))
    out = out.slice(0, at) + `"_${text}"` + out.slice(at);
  return out;
}
// Baroque soprano recorder fingerings by written MIDI pitch: [thumb, 1, 2, 3, 4, 5, 6, 7], 1 = covered.
// Limited to the beginner range (C to D', with F♯ and B♭) where school charts agree.
const RECORDER_FINGERING = {
  60: [1, 1, 1, 1, 1, 1, 1, 1],
  62: [1, 1, 1, 1, 1, 1, 1, 0],
  64: [1, 1, 1, 1, 1, 1, 0, 0],
  65: [1, 1, 1, 1, 1, 0, 1, 1],
  66: [1, 1, 1, 1, 0, 1, 1, 0],
  67: [1, 1, 1, 1, 0, 0, 0, 0],
  69: [1, 1, 1, 0, 0, 0, 0, 0],
  70: [1, 1, 0, 1, 1, 0, 0, 0],
  71: [1, 1, 0, 0, 0, 0, 0, 0],
  72: [1, 0, 1, 0, 0, 0, 0, 0],
  74: [0, 0, 1, 0, 0, 0, 0, 0]
};

// Skill tags, worked out from the music itself so every score can be found by what it teaches.
// Written in the words students use. Keep the list in this order: it's the order of the Skill filter.
const SKILLS = [
  'Steps',
  'Skips',
  'Leaps',
  'Repeated notes',
  'Eighth notes',
  'Sixteenth notes',
  'Dotted rhythms',
  'Triplets',
  'Triple meter',
  'Compound meter',
  'Minor key',
  'Accidentals',
  'Chords',
  'Rests',
  'Wide range',
  'Repeats'
];
// MIDI number of a parsed pitch: the key signature applies unless the bar already carried an accidental for that note.
function pitchMidi(p, alters, carried) {
  const letter = 'CDEFGAB'[((p.pitch % 7) + 7) % 7],
    explicit = p.accidental && p.accidental !== 'none';
  if (explicit) carried.set(p.pitch, ALTER[p.accidental] ?? 0);
  return (
    60 +
    Math.floor(p.pitch / 7) * 12 +
    LETTER_SEMIS['CDEFGAB'.indexOf(letter)] +
    (carried.has(p.pitch) ? carried.get(p.pitch) : alters[letter] || 0)
  );
}
function skillTags(tune) {
  const tags = new Set();
  let steps = 0,
    skips = 0,
    leaps = 0,
    same = 0,
    intervals = 0,
    notes = 0,
    rests = 0,
    accidentals = 0,
    lo = Infinity,
    hi = -Infinity;
  for (const line of tune.lines)
    for (const staff of line.staff || []) {
      const meter = staff.meter?.value?.[0],
        num = +meter?.num,
        den = +meter?.den;
      if (num === 3) tags.add('Triple meter');
      if (den === 8 && num > 3 && num % 3 === 0) tags.add('Compound meter');
      const minor = key => /^(m|min|minor|aeo|aeolian|dor|dorian|phr|phrygian)/i.test(key?.mode || '');
      if (minor(staff.key)) tags.add('Minor key');
      for (const voice of staff.voices || []) {
        let last = null,
          carried = new Map(),
          alters = keyAlters(staff.key);
        for (const e of voice) {
          if (e.el_type === 'bar') {
            if (/repeat/.test(e.type)) tags.add('Repeats');
            carried = new Map();
            continue;
          }
          // An inline [K:] changes the key for the notes that follow.
          if (e.el_type === 'key') {
            alters = keyAlters(e);
            if (minor(e)) tags.add('Minor key');
            continue;
          }
          if (e.el_type !== 'note') continue;
          // Invisible rests (x, y) only space the layout; students never see them.
          if (e.rest && e.rest.type !== 'rest' && e.rest.type !== 'multimeasure') continue;
          if (e.startTriplet) tags.add('Triplets');
          const d = e.duration;
          if (d > 0) {
            if (d < 1 / 8 + 1e-9 && d > 1 / 16 + 1e-9) tags.add('Eighth notes');
            if (d <= 1 / 16 + 1e-9) tags.add('Sixteenth notes');
            for (const base of [1 / 4, 1 / 8, 1 / 16, 1 / 2])
              if (Math.abs(d - base * 1.5) < 1e-9) tags.add('Dotted rhythms');
          }
          if (!e.pitches?.length) {
            rests++;
            last = null;
            continue;
          }
          notes++;
          if (e.pitches.length > 1) tags.add('Chords');
          let pitch = null;
          for (const p of e.pitches) {
            if (p.accidental && p.accidental !== 'none') accidentals++;
            const midi = pitchMidi(p, alters, carried);
            pitch ??= midi;
            lo = Math.min(lo, midi);
            hi = Math.max(hi, midi);
          }
          // Intervals in semitones: steps are seconds, skips thirds, leaps a fourth or more.
          if (last != null) {
            const gap = Math.abs(pitch - last);
            intervals++;
            if (gap === 0) same++;
            else if (gap <= 2) steps++;
            else if (gap <= 4) skips++;
            else leaps++;
          }
          last = pitch;
        }
      }
    }
  if (intervals >= 6) {
    if (steps / intervals >= 0.6) tags.add('Steps');
    if (skips / intervals >= 0.25) tags.add('Skips');
    if (leaps / intervals >= 0.2) tags.add('Leaps');
    if (same / intervals >= 0.3) tags.add('Repeated notes');
  }
  if (accidentals >= 2) tags.add('Accidentals');
  if (rests >= 3 && rests / (notes + rests) >= 0.08) tags.add('Rests');
  if (hi - lo >= 17) tags.add('Wide range');
  return SKILLS.filter(s => tags.has(s));
}
// catalog-skills.js stores each score's tags as a bit mask over SKILLS, to keep the file small.
const skillMask = tags => tags.reduce((m, t) => m | (1 << SKILLS.indexOf(t)), 0),
  skillsFromMask = mask => SKILLS.filter((s, i) => (mask >> i) & 1);
// "Try next" suggestions: scores that share this one's skills, at the same level or one level up, with unplayed
// scores first. `skillsOf` maps a score to its tags; `played` is the set of score ids the student has opened.
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
function suggestNext(item, catalog, skillsOf, played = new Set(), count = 3) {
  const mine = new Set(skillsOf(item)),
    level = LEVELS.indexOf(item.level);
  const scored = [];
  for (const x of catalog) {
    if (x.id === item.id || x.title === item.title) continue;
    const step = LEVELS.indexOf(x.level) - level;
    if (step < 0 || step > 1) continue;
    // A candidate must share at least one skill; a score with no tags gets no suggestions.
    const shared = skillsOf(x).filter(t => mine.has(t));
    if (!shared.length) continue;
    // Shared skills count most; each unfamiliar skill costs a little; played tunes drop down the list.
    const extra = skillsOf(x).length - shared.length;
    scored.push({
      item: x,
      shared,
      step,
      score: shared.length * 2 - Math.min(extra, 3) * 0.5 - (played.has(x.id) ? 4 : 0),
      tie: hashText(item.id + '|' + x.id)
    });
  }
  return scored.sort((a, b) => b.score - a.score || a.tie - b.tie).slice(0, count);
}
// Small stable hash, so ties between equally good suggestions vary from score to score instead of running alphabetically.
function hashText(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// One tempo for both of abcjs's clocks. abcjs times the drawn notes (setTiming, noteTimings: the highlight, practice
// ranges, metronome and count-in) in beats of the opening meter, a half note in 2/2 and a dotted quarter in 6/8, and
// with no Q: at 180 beats a minute (120 in 6/8, 9/8 and 12/8). Its sound has its own default: 180 quarter notes a
// minute outside x/8 meters, so a reel in C| sounded at half = 90 while the highlight ran at half = 180. A tempo with
// no number (Q:"Slowly") played at 60 and was timed at 180, and a body tempo with no note length ([Q:120]) was heard
// in quarters and timed in beats. This writes the tempo the sound uses into the parsed tune, where abcjs reads it for
// both: no Q: (or no number) gives the sound's default, a body tempo with no number keeps the tempo before it, and one
// with no length counts beats, as Q:120 does in the header. Nothing is drawn from it, since the tune is already
// engraved (or never drawn), and the ABC is left alone.
function settleTempo(tune) {
  if (!tune?.metaText || typeof tune.getBeatLength !== 'function') return tune;
  const beat = tune.getBeatLength(),
    {num, den} = tune.getMeterFraction(),
    tempo = tune.metaText.tempo;
  if (!(tempo?.bpm > 0))
    tune.metaText.tempo = {
      ...tempo,
      ...(+den === 8 ? {duration: [beat], bpm: +num !== 3 && num % 3 === 0 ? 120 : 180} : {duration: [1 / 4], bpm: 180})
    };
  else if (!tempo.duration?.length) tempo.duration = [beat];
  let current = tune.metaText.tempo;
  for (const line of tune.lines || [])
    for (const staff of line.staff || [])
      for (const e of (staff.voices || []).flat()) {
        if (e.el_type !== 'tempo') continue;
        if (!(e.bpm > 0)) Object.assign(e, {duration: current.duration, bpm: current.bpm});
        else if (!e.duration?.length) e.duration = [beat];
        current = e;
      }
  return tune;
}
// MIDI for playback and export. abcjs generates the file; parseMidi decodes its notes and tempo events.
// Four abcjs slips are mended first. Its MIDI writer takes the tempo, counted in beats of the meter, as quarter notes
// a minute (it corrects only x/8 meters), so 2/2, 3/2 and C| played at half speed: Q:1/2=60 sounded as quarter = 60.
// Here the file's tempo is in quarter notes, and settleTempo gives the sound and the highlight the same tempo. abcjs
// engraves sfz and marcato but plays them at the current volume, so they get an accent (half as loud again). It plays
// any text in chord-symbol position that starts with A–G (Coda as a C chord, D.C. as a D chord) and carries the last
// chord on through N.C.; here only what parseChordSymbol reads as a chord plays, and N.C. stops the accompaniment until
// the next one. Its MIDI writer scales each note's gap by the tempo a second time, so above about 95 bpm a staccato
// note-off comes before its note-on and the note rings on, and a tenuto or slurred note runs into a repeat of its
// pitch, so one of the two is lost. Here staccato notes sound for 60% of their length (abcjs's length at 60 bpm) and
// other notes for their full length. With chordsOff, chord symbols are not played (the Chords switch); exports leave
// it out, so files keep the accompaniment.
function midiBytes(source, {chordsOff = false} = {}) {
  const tune = ABCJS.parseOnly(source)[0];
  for (const line of tune?.lines || [])
    for (const staff of line.staff || [])
      for (const e of (staff.voices || []).flat()) {
        if (e.decoration?.some(d => /^(?:sfz|u?marcato)$/.test(d)) && !e.decoration.includes('accent'))
          e.decoration.push('accent');
        // abcjs plays the first chord in the default position, and stops for 'break' (this copy is never drawn).
        for (const c of e.chord || [])
          if (c.position === 'default') {
            const chord = parseChordSymbol(c.name);
            if (chord?.root) c.name = c.name.trim();
            else if (chord) c.name = 'break';
            else c.position = 'above';
          }
      }
  settleTempo(tune);
  const setUpAudio = tune?.setUpAudio;
  if (setUpAudio)
    tune.setUpAudio = function (options) {
      const sequence = setUpAudio.call(this, options);
      // Beats a minute to quarters a minute. Body tempo changes stretch the notes by a ratio, so they follow.
      sequence.tempo *= 4 * this.getBeatLength();
      for (const track of sequence.tracks)
        for (const e of track)
          if (e.cmd === 'note' && e.gap) {
            if (e.gap > 0) e.duration *= 0.6;
            e.gap = 0;
          }
      return sequence;
    };
  const uri = tune && ABCJS.synth.getMidiFile(tune, {midiOutputType: 'encoded', ...(chordsOff ? {chordsOff} : {})});
  if (typeof uri !== 'string' || !uri.startsWith('data:'))
    throw new Error('MIDI could not be generated. Check your notation.');
  const [meta, body] = uri.split(',');
  return meta.includes(';base64')
    ? Uint8Array.from(atob(body), c => c.charCodeAt(0))
    : Uint8Array.from(body.match(/%[0-9a-f]{2}|[^%]/gi) || [], t =>
        t[0] === '%' ? parseInt(t.slice(1), 16) : t.charCodeAt(0)
      );
}
// A WAV file: 16-bit PCM from one array of samples (-1 to 1) a channel, interleaved, with a LIST/INFO chunk before the
// samples for the text in info: INAM title, IART artist, ICOP copyright and ICMT comment, each left out when empty.
// The text is UTF-8 ending in a zero byte, and each chunk is padded to an even length, as RIFF requires.
const WAV_INFO = {title: 'INAM', artist: 'IART', copyright: 'ICOP', comment: 'ICMT'};
function wavBytes(channels, sampleRate, info = {}) {
  const encoder = new TextEncoder(),
    fields = Object.entries(WAV_INFO)
      .filter(([key]) => info[key])
      .map(([key, id]) => [id, encoder.encode(String(info[key]) + '\0')]),
    list = fields.length ? 4 + fields.reduce((sum, [, text]) => sum + 8 + text.length + (text.length & 1), 0) : 0,
    count = channels.length,
    frames = Math.min(...channels.map(c => c.length)),
    data = frames * count * 2,
    bytes = new Uint8Array(12 + 24 + (list ? 8 + list : 0) + 8 + data),
    view = new DataView(bytes.buffer);
  let pos = 0;
  const tag = text => {
    for (const c of text) bytes[pos++] = c.charCodeAt(0);
  };
  const u32 = n => (view.setUint32(pos, n, true), (pos += 4)),
    u16 = n => (view.setUint16(pos, n, true), (pos += 2));
  tag('RIFF');
  u32(bytes.length - 8);
  tag('WAVE');
  tag('fmt ');
  u32(16);
  u16(1);
  u16(count);
  u32(sampleRate);
  u32(sampleRate * count * 2);
  u16(count * 2);
  u16(16);
  if (list) {
    tag('LIST');
    u32(list);
    tag('INFO');
    for (const [id, text] of fields) {
      tag(id);
      u32(text.length);
      bytes.set(text, pos);
      pos += text.length + (text.length & 1);
    }
  }
  tag('data');
  u32(data);
  for (let i = 0; i < frames; i++)
    for (const channel of channels) {
      const v = Math.max(-1, Math.min(1, channel[i] || 0));
      view.setInt16(pos, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      pos += 2;
    }
  return bytes;
}
// The melody track of decoded MIDI: abcjs puts guitar-chord accompaniment ("G" symbols) on a later channel, whose
// bass notes stay in range under transposition, so pitch checks and difficulty estimates look at the lowest channel.
function melodyNotes(notes) {
  if (!notes.length) return notes;
  const first = Math.min(...notes.map(n => n.ch ?? 0));
  return notes.filter(n => (n.ch ?? 0) === first);
}
// Decode MIDI note and tempo events generated by abcjs, including polyphonic voices. quarter is the opening tempo,
// in seconds per quarter note.
function parseMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    division = v.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE MIDI timing is not supported');
  let pos = 14,
    events = [];
  const vlq = () => {
    let n = 0,
      b;
    do {
      b = bytes[pos++];
      n = (n << 7) | (b & 127);
    } while (b & 128);
    return n;
  };
  while (pos + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.slice(pos, pos + 4)),
      len = v.getUint32(pos + 4);
    pos += 8;
    const end = pos + len;
    if (tag !== 'MTrk') {
      pos = end;
      continue;
    }
    let tick = 0,
      running = 0;
    while (pos < end) {
      tick += vlq();
      let status = bytes[pos++];
      if (status < 128) {
        pos--;
        status = running;
      } else if (status < 240) running = status;
      if (status === 255) {
        const kind = bytes[pos++],
          size = vlq();
        if (kind === 81 && size === 3)
          events.push({tick, tempo: (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2]});
        pos += size;
        continue;
      }
      if (status === 240 || status === 247) {
        const size = vlq();
        pos += size;
        continue;
      }
      const cmd = status & 240,
        ch = status & 15,
        a = bytes[pos++],
        b = cmd === 192 || cmd === 208 ? 0 : bytes[pos++];
      if (cmd === 144 || cmd === 128) events.push({tick, ch, note: a, velocity: b, on: cmd === 144 && b > 0});
    }
    pos = end;
  }
  events.sort((a, b) => a.tick - b.tick);
  let tick = 0,
    time = 0,
    tempo = 500000,
    active = new Map(),
    notes = [];
  for (const e of events) {
    time += ((e.tick - tick) * tempo) / 1000000 / division;
    tick = e.tick;
    if (e.tempo) {
      tempo = e.tempo;
      continue;
    }
    const key = e.ch + ':' + e.note;
    if (e.on) {
      active.set(key, {note: e.note, start: time, velocity: e.velocity, ch: e.ch});
    } else if (active.has(key)) {
      const n = active.get(key);
      notes.push({...n, duration: Math.max(0.025, time - n.start)});
      active.delete(key);
    }
  }
  for (const n of active.values()) notes.push({...n, duration: Math.max(0.1, time - n.start)});
  return {
    notes,
    duration: Math.max(time, ...notes.map(n => n.start + n.duration), 0),
    quarter: (events.find(e => e.tempo)?.tempo || 500000) / 1000000
  };
}
// Swing feel, a score setting written as tempo text and an abc2midi directive: Q:"Swing" 1/4=120 and %%MIDI swing 66.
// The amount is the on-beat eighth's share of the quarter beat in percent: 66 is a triplet feel, 50 or less is
// straight. A "swing" tempo text in the header without the directive means 66; amounts stop at 75, as in abcjs.
const SWING_LINE = /^%%MIDI[ \t]+swing\b.*$/im,
  SWING_TEXT = /"[^"]*swing[^"]*"/i;
// The header's Q: line, before K:; a Q: in the tune body is a tempo change.
function headerTempo(lines) {
  const k = lines.findIndex(line => /^K:/.test(line));
  return (k >= 0 ? lines.slice(0, k) : lines).findIndex(line => /^Q:/.test(line));
}
function swingAmount(source) {
  const directive = source.match(SWING_LINE)?.[0].match(/swing\s+(\d+(?:\.\d+)?)/i),
    lines = source.split('\n');
  if (directive) return +directive[1] > 50 ? Math.min(75, Math.round(+directive[1])) : 0;
  return SWING_TEXT.test(lines[headerTempo(lines)] || '') ? 66 : 0;
}
// A Q: field's parts: the tempo text printed before the beat, the beat (1/4=120) and the text printed after it.
function tempoParts(field) {
  const m = field.trim().match(/^((?:"[^"]*"\s*)*)([^"]*?)\s*((?:"[^"]*"\s*)*)$/);
  return m ? {pre: m[1].trim(), beat: m[2], post: m[3].trim()} : {pre: '', beat: field.trim(), post: ''};
}
// The beat a score plays at, as Q: writes it: the header tempo's, or the one settleTempo gives a score with no Q:,
// only tempo text, or a bare number (Q:120, which abcjs counts in the meter's note value, quarter notes in C and C|).
// With no Q: that is 1/4=180 in 2/2 and C| and 3/8=120 in 6/8. abcjs's own default for 2/2, 1/2=180, plays twice as
// fast now that a written tempo plays as written.
function playedBeat(source) {
  const tune = settleTempo(ABCJS.parseOnly(source)[0]),
    tempo = tune?.metaText?.tempo,
    fraction = length => {
      const d = [1, 2, 4, 8, 16, 32, 64].find(d => Math.abs(length * d - Math.round(length * d)) < 1e-9) || 4;
      return Math.round(length * d) + '/' + d;
    };
  if (tempo?.bpm > 0 && tempo.duration?.length) return tempo.duration.map(fraction).join(' ') + '=' + tempo.bpm;
  return '1/4=180';
}
// Set the feel in the header's tempo line, with the directive just above K:. Swing prints "Swing", or adds ", swing"
// to tempo text already there such as "Allegro", and writes out the beat abcjs plays: abcjs drops a bare number after
// tempo text, and plays text alone at another tempo than its note timing. Straight removes the directive and the
// swing text, and keeps the beat and the other text.
function setSwing(source, amount) {
  amount = Math.min(75, Math.round(+amount) || 0);
  const lines = source.split('\n').filter(line => !SWING_LINE.test(line)),
    q = headerTempo(lines);
  if (amount <= 50 && !SWING_TEXT.test(lines[q] || '')) return lines.join('\n');
  let {pre, beat, post} = tempoParts(q >= 0 ? lines[q].slice(2) : '');
  if (amount > 50) {
    if (!beat.includes('=')) beat = playedBeat(source);
    if (!SWING_TEXT.test(pre + post)) {
      const add = text =>
        text.replace(/"([^"]*)"/, (_, words) => `"${words.trim() ? words.trim() + ', swing' : 'Swing'}"`);
      if (pre) pre = add(pre);
      else if (post) post = add(post);
      else pre = '"Swing"';
    }
  } else {
    // "Allegro, swing" goes back to "Allegro"; other text that says swing goes.
    const remove = text =>
      text
        .replace(/\s*"([^"]*)"/g, (all, words) => {
          const rest = words.replace(/\s*,\s*swing$/i, '');
          return !/swing/i.test(words) ? all : rest !== words && rest.trim() ? ` "${rest}"` : '';
        })
        .trim();
    pre = remove(pre);
    post = remove(post);
  }
  const text = 'Q:' + [pre, beat.trim(), post].filter(Boolean).join(' ');
  if (q >= 0 && text === 'Q:') lines.splice(q, 1);
  else if (q >= 0) lines[q] = text;
  if (amount > 50) {
    const k = lines.findIndex(line => /^K:/.test(line));
    lines.splice(k >= 0 ? k : lines.length, 0, ...(q >= 0 ? [] : [text]), '%%MIDI swing ' + amount);
  }
  return lines.join('\n');
}
// Swung playback times. Within a quarter beat, times before the half-beat stretch and times after it shrink, so the
// off-beat eighth starts late (at amount% of the beat) and its on-beat partner lasts longer. A beat is swung only in a
// channel where it has an off-beat note and every note starts on the beat or halfway through it: sixteenths, triplets
// and other channels' notes stay as written. origin is a time that falls on a beat (after a pickup). Times within
// 1/64 beat of the grid count as on it, since MIDI ticks and abcjs's note timings are rounded. Each note keeps its
// straight end, so playing from a note can leave out one that swing lengthened past it.
function swingNotes(notes, beatSeconds, amount, origin = 0) {
  if (!(amount > 50) || !(beatSeconds > 0)) return notes;
  const a = Math.min(75, amount) / 100,
    eps = 1 / 64,
    place = t => {
      const p = (t - origin) / beatSeconds,
        beat = Math.floor(p + eps);
      return {beat, f: p - beat};
    };
  const offbeat = new Set(),
    uneven = new Set();
  for (const n of notes) {
    const {beat, f} = place(n.start),
      key = (n.ch ?? 0) + ':' + beat;
    if (Math.abs(f - 0.5) < eps) offbeat.add(key);
    else if (f > eps) uneven.add(key);
  }
  const warp = (ch, t) => {
    const {beat, f} = place(t),
      key = ch + ':' + beat;
    if (!offbeat.has(key) || uneven.has(key)) return t;
    const g = f <= 0.5 ? (f * a) / 0.5 : a + ((f - 0.5) * (1 - a)) / 0.5;
    return t + (g - f) * beatSeconds;
  };
  return notes.map(n => {
    const ch = n.ch ?? 0,
      start = warp(ch, n.start);
    return {
      ...n,
      start,
      duration: Math.max(0.025, warp(ch, n.start + n.duration) - start),
      straightEnd: n.start + n.duration
    };
  });
}
// Swing decoded MIDI (parseMidi). bars lists each measure as played, {time, quarter, origin}: where it starts, its
// quarter-note length in seconds and a time on its beat grid, all in the MIDI's seconds. Tempo changes stretch abcjs's
// MIDI ticks rather than change its tempo, so the bars come from the score's timing, not from the MIDI tempo.
function swingPlayback(data, amount, bars) {
  if (!(amount > 50) || !bars?.length) return data;
  const parts = bars.map(() => []);
  let i = 0;
  for (const n of [...data.notes].sort((a, b) => a.start - b.start)) {
    while (i + 1 < bars.length && bars[i + 1].time <= n.start + 0.002) i++;
    parts[i].push(n);
  }
  return {...data, notes: parts.flatMap((part, i) => swingNotes(part, bars[i].quarter, amount, bars[i].origin))};
}

// Share links: the whole score rides in the URL hash (#s=…), so no server ever holds student work.
// Payload {v, a: abc, i: instrument, s: library source id, p: built-in prompt id,
// q: teacher-written assignment, checked by validPrompt}. A turned-in assignment adds n: the student's name,
// t: the time (ms), x: the assignment's id and g: each goal met (1) or not (0); a teacher's return link adds
// c: feedback text. The first character says how the rest is packed: '1' deflate-raw + base64url, '0' plain
// base64url (for browsers without CompressionStream).
const base64url = {
  // Built in chunks: spreading a large score into String.fromCharCode overflows the call stack.
  encode: bytes => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode: text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
};
const streamBytes = async (bytes, Transform, format) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Transform(format))).arrayBuffer());
async function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'function')
    return '1' + base64url.encode(await streamBytes(bytes, CompressionStream, 'deflate-raw'));
  return '0' + base64url.encode(bytes);
}
// A link opens only if its marker is known, its payload is version 1, and the ABC has real X: and K: header lines.
const SHARE_ABC = /^X:[^\n]*\n[\s\S]*^K:/m;
async function decodeShare(text) {
  try {
    if (text[0] !== '1' && text[0] !== '0') return null;
    const packed = base64url.decode(text.slice(1));
    const bytes = text[0] === '1' ? await streamBytes(packed, DecompressionStream, 'deflate-raw') : packed;
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload?.v === 1 && typeof payload.a === 'string' && SHARE_ABC.test(payload.a) ? payload : null;
  } catch {
    return null;
  }
}

// Turning in and the teacher's inbox. Everything here comes from a link or a file, so it is checked field by field.
// A name keeps printable characters and single spaces, up to 80 characters; anything else is no name.
const STUDENT_NAME_MAX = 80,
  FEEDBACK_MAX = 2000;
function cleanStudentName(name) {
  if (typeof name !== 'string') return '';
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= STUDENT_NAME_MAX ? clean : '';
}
// The turn-in parts of a link (n, t, x), read against the assignment the link carries: x must be its id. Returns
// {name, at, assignment} or null. g is not read: the inbox works the goals out again from the music, so a link stays
// readable after a built-in prompt's goals change.
function readSubmission(payload, prompt) {
  if (!payload || typeof payload !== 'object' || !prompt || typeof prompt.id !== 'string') return null;
  const name = cleanStudentName(payload.n),
    {t, x} = payload;
  if (!name || !Number.isInteger(t) || t <= 0 || t > 8.64e15 || x !== prompt.id) return null;
  return {name, at: t, assignment: x};
}
// A teacher's feedback (c): text up to 2,000 characters, or null.
function readFeedback(c) {
  return typeof c === 'string' && c.trim() && c.length <= FEEDBACK_MAX ? c.trim() : null;
}
// What the inbox shows for a submission: goals met (checked in written pitch, as the student's checklist is) and how
// many bars do not match the time signature. shift is the instrument's written-pitch shift.
function submissionChecks(abc, prompt, shift = 0) {
  let written = abc;
  if (shift)
    try {
      written = transposeABC(abc, shift);
    } catch {
      written = ABCJS.strTranspose(abc, ABCJS.parseOnly(abc), shift);
    }
  const goals = prompt ? checkPrompt(prompt, melodyBars(ABCJS.parseOnly(written)[0])) : [];
  return {
    goals,
    met: goals.filter(g => g.ok).length,
    total: goals.length,
    bars: barProblems(ABCJS.parseOnly(abc)[0]).length
  };
}
// The share codes in pasted text, one per line: a full link (…#s=CODE), or a bare code. Blank lines are skipped; a line
// with no code gives code null, so it can be reported by its line number.
function turnInCodes(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line, i) => ({line: i + 1, text: line.trim()}))
    .filter(l => l.text)
    .map(l => ({line: l.line, code: (l.text.match(/(?:^|[#&?]s=)([01][A-Za-z0-9_-]{8,})$/) || [])[1] || null}));
}
