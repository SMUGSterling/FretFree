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
// Notes sounding between from and until (score seconds), rebased to 0 and scaled to the playback speed.
function playbackSlice(data, from, percent, until = data.duration) {
  const speed = percent / 100;
  return {
    duration: Math.max(0, (until - from) / speed),
    notes: data.notes
      .filter(n => n.start + n.duration > from && n.start < until - 1e-9)
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
        }
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
// one accidental, cycle through double ones (D, __E, ^^C). key is a parsed abcjs key, as midiToken takes: an
// accidental is written only where the key signature would not give the new spelling, or always with explicit.
// midis gives each pitch's MIDI note in source order, for a bar where an earlier accidental changes a plain letter;
// without it, a pitch is read from its own accidental or the key. Rests are left as they are.
function respell(text, key, {midis = null, explicit = false} = {}) {
  const parts = noteParts(text);
  if (!parts || /^[zx]/.test(parts.core)) return text;
  const alters = keyAlters(key);
  let i = 0;
  const core = parts.core.replace(/(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g, (_, acc, letter, marks) => {
    const step =
        'CDEFGAB'.indexOf(letter.toUpperCase()) +
        (letter >= 'a' ? 7 : 0) +
        [...marks].reduce((n, c) => n + (c === "'" ? 7 : -7), 0),
      midi = midis?.[i++] ?? 60 + diatonicSemis(step) + (acc ? ACC_VALUE[acc] : alters[letter.toUpperCase()] || 0);
    // Spellings of the pitch on nearby letters, lowest letter (most sharps) first.
    const spellings = [];
    for (let s = step - 2; s <= step + 2; s++) {
      const alter = midi - 60 - diatonicSemis(s);
      if (Math.abs(alter) <= 2) spellings.push({step: s, alter});
    }
    if (!spellings.length) return _;
    const single = spellings.filter(s => Math.abs(s.alter) <= 1),
      cycle = single.length > 1 ? single : spellings,
      at = cycle.findIndex(s => s.step === step),
      // A spelling outside the cycle (__D for C) goes to the plainest one.
      next = at < 0 ? spellings.find(s => !s.alter) || cycle[0] : cycle[(at + 1) % cycle.length],
      keyAlter = alters['CDEFGAB'[posMod(next.step, 7)]] || 0;
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
      region = {start: after[i].start, end: after[i].end, keyed: !!(f.tonic || f.first), key: res.key, d: 0};
    if (!region.keyed) return {...region, key: after[i].value};
    const rest = f.tonic ? f.rest : (f.rest.trim() ? ' ' : '') + f.rest.trim();
    if (!res.tonic || res.tonic === 'none') return {...region, key: res.key + rest};
    const want = posMod('CDEFGAB'.indexOf((f.tonic || 'C')[0]) + letters, 7),
      have = 'CDEFGAB'.indexOf(res.tonic[0]),
      d = posMod(want - have + 3, 7) - 3,
      pc = LETTER_SEMIS[have] + (res.tonic[1] === '#' ? 1 : res.tonic[1] === 'b' ? -1 : 0),
      acc = posMod(pc - LETTER_SEMIS[want] + 6, 12) - 6,
      tonic = 'CDEFGAB'[want] + (acc > 0 ? '#' : acc < 0 ? 'b' : ''),
      key = tonic + res.key.slice(res.tonic.length);
    if (Math.abs(d) !== 1 || Math.abs(acc) > 1 || Math.abs(keyFifths(key)) > maxAccidentals)
      return {...region, key: res.key + rest};
    return {...region, key: key + rest, plain: res.key + rest, d};
  });
  const edits = regions.map(r => ({start: r.start, end: r.end, text: r.key}));
  const notesOf = t =>
      (t.lines || []).flatMap(line =>
        (line.staff || []).flatMap(staff => (staff.voices || []).flat().filter(e => e.el_type === 'note'))
      ),
    pitchesOf = text => {
      const list = [];
      mapMusic(text, ({pitch}) => (list.push(pitch), ''));
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
    const old = pitchesOf(stripped.slice(was[n].startChar, was[n].endChar));
    let j = 0,
      text = mapMusic(moved.slice(e.startChar, e.endChar), ({acc, pitch}) => {
        // A note moved a whole octave off the interval's letters is abcjs's octave slip; move it back.
        const slip = j < old.length ? Math.round((pitch - old[j] - steps) / 7) : 0;
        j++;
        return (acc == null ? '' : ACC_TEXT[acc]) + pitchToken(pitch + 7 * (octaves - slip));
      });
    if (region?.d) text = respellMusic(text, region.d);
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
// from. Each label also has `midis`: every pitch of the note as playback sounds it (see playbackShift), and
// `written`: every pitch as the staff shows it, before that shift.
const SOLFEGE_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'],
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
            return {letter, name, alter, midi: 60 + 12 * Math.floor(p.pitch / 7) + LETTER_SEMIS[letter] + alter};
          });
          state.tied = tied;
          const {letter, name, alter, midi} = spelled[0],
            pc = (LETTER_SEMIS[letter] + alter + 12) % 12;
          // Lowered against the key signature (a flat, or a natural on a sharp) takes the flat syllable.
          const text =
            mode === 'solfege'
              ? (alter < (key[name] ?? 0) ? SOLFEGE_FLAT : SOLFEGE_SHARP)[(pc - (state.doPc || 0) + 12) % 12]
              : name + ({1: '♯', 2: '𝄪', '-1': '♭', '-2': '𝄫'}[alter] || '');
          labels.push({
            at: e.startChar,
            text,
            midi,
            midis: spelled.map(x => x.midi + state.shift),
            written: spelled.map(x => x.midi)
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

// MIDI for playback and export. abcjs generates the file; parseMidi decodes its notes and tempo events.
function midiBytes(source) {
  const result = ABCJS.synth.getMidiFile(source, {midiOutputType: 'encoded'});
  const uri = Array.isArray(result) ? result[0] : result;
  if (typeof uri !== 'string' || !uri.startsWith('data:'))
    throw new Error('MIDI could not be generated. Check your notation.');
  const [meta, body] = uri.split(',');
  return meta.includes(';base64')
    ? Uint8Array.from(atob(body), c => c.charCodeAt(0))
    : Uint8Array.from(body.match(/%[0-9a-f]{2}|[^%]/gi) || [], t =>
        t[0] === '%' ? parseInt(t.slice(1), 16) : t.charCodeAt(0)
      );
}
// The melody track of decoded MIDI: abcjs puts guitar-chord accompaniment ("G" symbols) on a later channel, whose
// bass notes stay in range under transposition, so pitch checks and difficulty estimates look at the lowest channel.
function melodyNotes(notes) {
  if (!notes.length) return notes;
  const first = Math.min(...notes.map(n => n.ch ?? 0));
  return notes.filter(n => (n.ch ?? 0) === first);
}
// Decode MIDI note and tempo events generated by abcjs, including polyphonic voices.
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
  return {notes, duration: Math.max(time, ...notes.map(n => n.start + n.duration), 0)};
}

// Share links: the whole score rides in the URL hash (#s=…), so no server ever holds student work.
// Payload {v, a: abc, i: instrument, s: library source id, p: built-in prompt id,
// q: teacher-written assignment, checked by validPrompt}. The first character says how the rest
// is packed: '1' deflate-raw + base64url, '0' plain base64url (for browsers without CompressionStream).
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
