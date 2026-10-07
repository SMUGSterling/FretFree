'use strict';
// MusicXML export: abcToMusicXML() turns the ABC source (concert pitch, as written) into a MusicXML 4.0 partwise
// score for MuseScore, Noteflight, Finale, Sibelius or Dorico. DOM-free, so the node checks run it directly. It walks
// the abcjs parse voice by voice; each staff is a part, and a {braced} staff group from %%score is one part with
// several staves. Credits and the license travel in <identification>, a page-1 <credit> and a fretfree-rights field.
const MXL_TYPES = [
    [4, 'long'],
    [2, 'breve'],
    [1, 'whole'],
    [1 / 2, 'half'],
    [1 / 4, 'quarter'],
    [1 / 8, 'eighth'],
    [1 / 16, '16th'],
    [1 / 32, '32nd'],
    [1 / 64, '64th'],
    [1 / 128, '128th']
  ],
  MXL_ALTER = {sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2, quartersharp: 0.5, quarterflat: -0.5},
  MXL_ACCIDENTAL = {
    sharp: 'sharp',
    flat: 'flat',
    natural: 'natural',
    dblsharp: 'double-sharp',
    dblflat: 'flat-flat',
    quartersharp: 'quarter-sharp',
    quarterflat: 'quarter-flat'
  },
  MXL_MODES = {
    '': 'major',
    maj: 'major',
    m: 'minor',
    min: 'minor',
    ion: 'ionian',
    dor: 'dorian',
    phr: 'phrygian',
    lyd: 'lydian',
    mix: 'mixolydian',
    aeo: 'aeolian',
    loc: 'locrian'
  },
  MXL_ARTICULATIONS = {
    staccato: 'staccato',
    tenuto: 'tenuto',
    accent: 'accent',
    emphasis: 'accent',
    marcato: 'strong-accent',
    wedge: 'staccatissimo',
    breath: 'breath-mark'
  },
  MXL_ORNAMENTS = {
    trill: 'trill-mark',
    mordent: 'mordent',
    lowermordent: 'mordent',
    uppermordent: 'inverted-mordent',
    pralltriller: 'inverted-mordent',
    turn: 'turn',
    turnx: 'turn',
    invertedturn: 'inverted-turn',
    irishroll: 'turn',
    roll: 'turn'
  },
  MXL_TECHNICAL = {
    upbow: 'up-bow',
    downbow: 'down-bow',
    open: 'open-string',
    thumb: 'thumb-position',
    snap: 'snap-pizzicato',
    plus: 'stopped'
  },
  MXL_DYNAMICS = new Set([
    'pppp',
    'ppp',
    'pp',
    'p',
    'mp',
    'mf',
    'f',
    'ff',
    'fff',
    'ffff',
    'sfz',
    'sf',
    'fp',
    'rfz',
    'fz'
  ]),
  MXL_WEDGES = {
    'crescendo(': 'crescendo',
    '<(': 'crescendo',
    'diminuendo(': 'diminuendo',
    '>(': 'diminuendo',
    'crescendo)': 'stop',
    '<)': 'stop',
    'diminuendo)': 'stop',
    '>)': 'stop'
  },
  MXL_WORDS = {
    fine: 'Fine',
    'D.C.': 'D.C.',
    'D.S.': 'D.S.',
    dacapo: 'Da Capo',
    dacoda: 'Da Coda',
    'D.C.alcoda': 'D.C. al Coda',
    'D.C.alfine': 'D.C. al Fine',
    'D.S.alcoda': 'D.S. al Coda',
    'D.S.alfine': 'D.S. al Fine'
  },
  // Chord-symbol suffixes; anything else keeps its text and is read as the nearest basic chord.
  MXL_KINDS = {
    '': 'major',
    maj: 'major',
    M: 'major',
    m: 'minor',
    min: 'minor',
    '-': 'minor',
    7: 'dominant',
    maj7: 'major-seventh',
    M7: 'major-seventh',
    Δ: 'major-seventh',
    Δ7: 'major-seventh',
    m7: 'minor-seventh',
    min7: 'minor-seventh',
    '-7': 'minor-seventh',
    dim: 'diminished',
    '°': 'diminished',
    o: 'diminished',
    dim7: 'diminished-seventh',
    '°7': 'diminished-seventh',
    o7: 'diminished-seventh',
    aug: 'augmented',
    '+': 'augmented',
    m7b5: 'half-diminished',
    'm7♭5': 'half-diminished',
    ø: 'half-diminished',
    ø7: 'half-diminished',
    6: 'major-sixth',
    m6: 'minor-sixth',
    9: 'dominant-ninth',
    maj9: 'major-ninth',
    m9: 'minor-ninth',
    11: 'dominant-11th',
    13: 'dominant-13th',
    sus: 'suspended-fourth',
    sus4: 'suspended-fourth',
    sus2: 'suspended-second',
    5: 'power',
    mmaj7: 'major-minor',
    'm(maj7)': 'major-minor',
    aug7: 'augmented-seventh',
    '7#5': 'augmented-seventh',
    '7♯5': 'augmented-seventh'
  };
// Text for XML: escaped, and without the control characters XML 1.0 forbids (the GPL text carries form feeds).
function xmlText(value) {
  return String(value ?? '')
    .replace(/[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const xmlTag = (name, value, attrs = '') => `<${name}${attrs}>${xmlText(value)}</${name}>`;
// A float length in whole notes as [numerator, denominator], read back exactly by continued fractions.
function mxlFraction(x) {
  let [h0, h1, k0, k1] = [0, 1, 1, 0],
    v = x;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(v);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (Math.abs(h1 / k1 - x) < 1e-9 * Math.max(1, x) || k1 > 100000) break;
    v = 1 / (v - a);
  }
  return [h1, k1];
}
const mxlGcd = (a, b) => (b ? mxlGcd(b, a % b) : a);
// Note type and dots for a notated length in whole notes; null when no single note has that length.
function mxlType(length) {
  for (const [value, type] of MXL_TYPES)
    for (let dots = 0; dots <= 3; dots++)
      if (Math.abs(value * (2 - 1 / 2 ** dots) - length) < 1e-6) return {type, dots};
  return null;
}
const MXL_VALUES = MXL_TYPES.flatMap(([value]) => [0, 1, 2, 3].map(dots => value * (2 - 1 / 2 ** dots))).sort(
  (a, b) => b - a
);
// A length no single note has, such as the z5 left by filling a 6/8 bar, as the fewest note values, longest first
// (5/8 is 1/2 + 1/8). The writer ties them or writes consecutive rests. Null when no short sum makes it up exactly.
function mxlPieces(length) {
  if (mxlType(length)) return [length];
  const pieces = [];
  let left = length;
  while (left > 1e-9 && pieces.length < 8) {
    const value = MXL_VALUES.find(v => v <= left + 1e-9);
    if (!value) return null;
    pieces.push(value);
    left -= value;
  }
  return left > 1e-9 ? null : pieces;
}
// abcjs plays a transpose= or %%MIDI transpose part away from its written notes; MusicXML says so with <transpose>,
// in semitones within the octave plus whole octaves, and the matching number of letter steps.
function mxlTranspose(semitones, number) {
  const octaves = Math.trunc(semitones / 12),
    chromatic = semitones - 12 * octaves,
    diatonic = Math.sign(chromatic) * [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6][Math.abs(chromatic)];
  return (
    `<transpose${number ? ` number="${number}"` : ''}><diatonic>${diatonic}</diatonic>` +
    `<chromatic>${chromatic}</chromatic>${octaves ? `<octave-change>${octaves}</octave-change>` : ''}</transpose>`
  );
}
function mxlKey(key) {
  const accs = (key?.accidentals || []).filter(a => a.acc !== 'natural'),
    sharps = 'FCGDAEB',
    flats = 'BEADGCF',
    letters = accs.map(a => a.note.toUpperCase()).join(''),
    mode =
      MXL_MODES[
        String(key?.mode || '')
          .toLowerCase()
          .slice(0, 3)
      ] ?? MXL_MODES[key?.mode];
  let fifths = null;
  if (!accs.length) fifths = 0;
  else if (accs.every(a => a.acc === 'sharp') && sharps.startsWith(letters)) fifths = accs.length;
  else if (accs.every(a => a.acc === 'flat') && flats.startsWith(letters)) fifths = -accs.length;
  if (fifths == null)
    return (
      '<key>' +
      accs
        .map(a => `<key-step>${a.note.toUpperCase()}</key-step><key-alter>${MXL_ALTER[a.acc] ?? 0}</key-alter>`)
        .join('') +
      '</key>'
    );
  return `<key><fifths>${fifths}</fifths>${mode && /^[A-G]/.test(key?.root || '') ? `<mode>${mode}</mode>` : ''}</key>`;
}
function mxlTime(meter) {
  const info = typeof meterInfo === 'function' ? meterInfo(meter) : null;
  if (info === 'free') return '<time print-object="no"><senza-misura/></time>';
  if (meter?.type === 'common_time') return '<time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>';
  if (meter?.type === 'cut_time') return '<time symbol="cut"><beats>2</beats><beat-type>2</beat-type></time>';
  const parts = (meter?.value || []).filter(v => v.num && v.den);
  if (!parts.length) return '';
  return '<time>' + parts.map(v => xmlTag('beats', v.num) + xmlTag('beat-type', v.den)).join('') + '</time>';
}
// Clef sign, line and octave shift. A treble-8 clef sounds an octave below the written letters, so the shift also moves
// the exported pitch, and MusicXML's clef-octave-change draws the note back in the same place.
function mxlClef(type = 'treble') {
  const octave = /([+-])(8|15)$/.exec(type),
    shift = octave ? (octave[1] === '+' ? 1 : -1) * (octave[2] === '15' ? 2 : 1) : 0,
    base = type.replace(/[+-](8|15)$/, ''),
    [sign, line] = {
      treble: ['G', 2],
      bass: ['F', 4],
      bass3: ['F', 3],
      baritone: ['F', 3],
      alto: ['C', 3],
      alto1: ['C', 1],
      alto2: ['C', 2],
      tenor: ['C', 4],
      perc: ['percussion', 0],
      none: ['G', 2]
    }[base] || ['G', 2];
  return {sign, line, shift, hidden: base === 'none'};
}
function mxlClefXML(clef, number) {
  return (
    `<clef${number ? ` number="${number}"` : ''}${clef.hidden ? ' print-object="no"' : ''}><sign>${clef.sign}</sign>` +
    (clef.line ? `<line>${clef.line}</line>` : '') +
    (clef.shift ? `<clef-octave-change>${clef.shift}</clef-octave-change>` : '') +
    '</clef>'
  );
}
function mxlHarmony(name, staff) {
  const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/.exec(name.trim());
  if (!m) return null;
  const alter = a => (/[#♯]/.test(a) ? 1 : /[b♭]/.test(a) ? -1 : 0),
    suffix = m[3],
    kind =
      MXL_KINDS[suffix] ||
      (/^(m|min|-)(?!aj)/.test(suffix)
        ? 'minor'
        : /^(dim|°|o)/.test(suffix)
          ? 'diminished'
          : /^(aug|\+)/.test(suffix)
            ? 'augmented'
            : /^(maj|M|Δ)/.test(suffix)
              ? 'major-seventh'
              : /^sus/.test(suffix)
                ? 'suspended-fourth'
                : /^[0-9]/.test(suffix)
                  ? 'dominant'
                  : 'major');
  return (
    '<harmony print-frame="no"><root>' +
    `<root-step>${m[1]}</root-step>${alter(m[2]) ? `<root-alter>${alter(m[2])}</root-alter>` : ''}</root>` +
    `<kind text="${xmlText(suffix)}">${kind}</kind>` +
    (m[4]
      ? `<bass><bass-step>${m[4]}</bass-step>${alter(m[5]) ? `<bass-alter>${alter(m[5])}</bass-alter>` : ''}</bass>`
      : '') +
    (staff ? `<staff>${staff}</staff>` : '') +
    '</harmony>'
  );
}
// "1,2" or "1-3" as MusicXML's ending number list.
function mxlEnding(text) {
  const numbers = [];
  for (const part of String(text).split(/[,\s]+/)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) for (let n = +range[1]; n <= +range[2] && n < +range[1] + 20; n++) numbers.push(n);
    else if (/^\d+$/.test(part) && +part > 0) numbers.push(+part);
  }
  return numbers.length ? numbers.join(', ') : '1';
}
const MXL_BARS = {
  bar_thin_thin: {style: 'light-light'},
  bar_thin_thick: {style: 'light-heavy'},
  bar_thick_thin: {style: 'heavy-light'},
  bar_right_repeat: {style: 'light-heavy', backward: true},
  bar_dbl_repeat: {style: 'light-heavy', backward: true, forward: true},
  bar_left_repeat: {forward: true},
  bar_invisible: {style: 'none'}
};

const mxlMetronome = t => {
  const beats = t.duration || [],
    unit = beats.length === 1 && mxlType(beats[0]),
    words = [t.preString, t.postString].filter(Boolean),
    total = beats.reduce((a, b) => a + b, 0),
    // For a text-only tempo such as Q:"Andante", abcjs makes up a beat and speed: it plays them but does not show them.
    shown = !t.suppressBpm && t.bpm,
    types = [];
  if (words.length) types.push(`<words>${xmlText(words.join(' '))}</words>`);
  if (unit && shown)
    types.push(
      `<metronome><beat-unit>${unit.type}</beat-unit>${'<beat-unit-dot/>'.repeat(unit.dots)}` +
        `<per-minute>${xmlText(t.bpm)}</per-minute></metronome>`
    );
  else if (shown) types.push(`<words>${xmlText('♩ = ' + t.bpm)}</words>`);
  return types.length
    ? {types, sound: t.bpm > 0 && total ? `<sound tempo="${+(t.bpm * total * 4).toFixed(2)}"/>` : ''}
    : null;
};
// The swing feel (%%MIDI swing, see swingAmount) travels as MusicXML 4's <swing> in the opening tempo's <sound>, or in
// a <sound> of its own when there is no opening tempo: the long and short eighths' ratio, so Light (60), Swing (66)
// and Hard (75) come back as they were.
const mxlSwing = (sound, amount) => {
  if (!(amount > 50)) return sound;
  const gcd = mxlGcd(amount, 100 - amount),
    swing =
      `<swing><first>${amount / gcd}</first><second>${(100 - amount) / gcd}</second>` +
      '<swing-type>eighth</swing-type></swing>';
  return sound ? sound.replace(/\/>$/, `>${swing}</sound>`) : `<sound>${swing}</sound>`;
};
const mxlBlank = () => ({content: [], length: 0, notes: false, left: {}, right: {}});

function abcToMusicXML(source, meta = {}) {
  const tune = ABCJS.parseOnly(source)[0],
    swing = typeof swingAmount === 'function' ? swingAmount(source) : 0;
  if (!tune?.lines?.some(line => line.staff?.length)) throw Error('There is no music to export.');
  const voices = tune.lines.flatMap(line => (line.staff || []).flatMap(staff => staff.voices));
  if (voices.some(voice => voice.some(e => e.el_type === 'note' && Number.isNaN(e.duration))))
    throw Error(
      'The note lengths in this score can’t be read (check the L: line), so it can’t be exported as MusicXML.'
    );
  // Voices are keyed staff:voice like scoreEvents(); staffs braced in %%score {…} share one part.
  const staffInfo = new Map();
  for (const line of tune.lines)
    for (const [s, staff] of (line.staff || []).entries())
      if (!staffInfo.has(s)) staffInfo.set(s, {staff, voices: staff.voices.length});
      else staffInfo.get(s).voices = Math.max(staffInfo.get(s).voices, staff.voices.length);
  const staffIds = [...staffInfo.keys()].sort((a, b) => a - b),
    parts = [];
  for (let i = 0; i < staffIds.length; i++) {
    const group = [staffIds[i]];
    if (staffInfo.get(staffIds[i]).staff.brace === 'start')
      while (i + 1 < staffIds.length && staffInfo.get(group.at(-1)).staff.brace !== 'end') group.push(staffIds[++i]);
    parts.push({staffs: group, voices: []});
  }
  for (const part of parts)
    for (const [n, s] of part.staffs.entries())
      for (let v = 0; v < staffInfo.get(s).voices; v++)
        part.voices.push({s, v, staffNo: part.staffs.length > 1 ? n + 1 : 0, number: part.voices.length + 1});
  // Divisions per quarter note: the least common multiple of every sounding length's denominator, counting each piece
  // of a note that is written as several tied ones.
  let divisions = 1;
  for (const voice of voices) {
    let tuplet = 1;
    for (const e of voice) {
      if (e.el_type !== 'note') continue;
      if (e.startTriplet) tuplet = e.tripletMultiplier || 1;
      for (const piece of e.duration > 0 ? mxlPieces(e.duration) || [e.duration] : []) {
        const d = mxlFraction(piece * tuplet * 4)[1];
        divisions = Math.min((divisions / mxlGcd(divisions, d)) * d, 100000);
      }
      if (e.endTriplet) tuplet = 1;
    }
  }
  if (divisions >= 100000) divisions = 10080;
  const dur = whole => Math.max(0, Math.round(whole * 4 * divisions)),
    lineStarts = [];
  for (const part of parts)
    for (const pv of part.voices)
      Object.assign(pv, walkVoice(pv, pv === part.voices[0], part, pv === parts[0].voices[0]));

  // One voice, line by line, into measures of MusicXML fragments plus their bar lines. Key and time changes come from
  // the part's first voice and clef changes from each staff's first voice, so they are written once.
  function walkVoice(pv, leads, part, firstOfScore) {
    const measures = [],
      clefOwner = part.voices.find(x => x.s === pv.s) === pv,
      voiceTag = `<voice>${pv.number}</voice>`,
      staffTag = pv.staffNo ? `<staff>${pv.staffNo}</staff>` : '';
    let m = null,
      first = null,
      key = {},
      keySig = '',
      clef = mxlClef(),
      clefType = '',
      // Playback transposition in semitones, kept the way abcjs's player keeps it: from %%MIDI transpose in the
      // header or the voice, or from the clef. A clef's transpose= sets it; an octave clef replaces it with -12 or
      // 12, which a plain clef at the start of a later line (but not an inline one) sets back to 0.
      transpose = tune.formatting?.midi?.transpose?.[0] || 0,
      octaveClef = false,
      transposeSig = '',
      meter = null,
      meterSig = '',
      carried = new Map(),
      tuplet = null,
      inBeam = false,
      ending = null,
      wavy = false,
      // Each pitch the last note tied on, with its alter and where it was written; a tie only carries to the same
      // pitch in the next note.
      tiedFrom = new Map();
    const slurs = new Map(),
      slurNumbers = new Set(),
      lyricOpen = [];
    const open = () => (m ??= mxlBlank()),
      // A tie that no note continues is taken off the note it started on.
      untie = ({content, at}) =>
        (content[at] = content[at]
          .replace('<tie type="start"/>', '')
          .replace('<tied type="start"/>', '')
          .replace('<notations></notations>', '')),
      close = () => {
        if (!m) return;
        measures.push(m);
        m = null;
        carried = new Map();
      },
      pad = target => {
        if (!m?.notes) while (measures.length < target) measures.push(mxlBlank());
      },
      meterLength = () => {
        const info = meterInfo(meter);
        return info && info !== 'free' ? info.length : 0;
      },
      direction = (types, placement = 'above', sound = '') =>
        open().content.push(
          `<direction placement="${placement}">` +
            []
              .concat(types)
              .map(x => `<direction-type>${x}</direction-type>`)
              .join('') +
            `${voiceTag}${staffTag}${sound}</direction>`
        ),
      attributes = xml => xml && open().content.push(`<attributes>${xml}</attributes>`),
      setKey = k => {
        const sig = mxlKey(k);
        key = keyAlters(k);
        if (first && leads && sig !== keySig) attributes(sig);
        keySig = sig;
      },
      // Notes are written where the clef draws them; whatever abcjs plays beyond the clef's octave is a <transpose>.
      setTranspose = () => {
        const sig = mxlTranspose(transpose - 12 * clef.shift, pv.staffNo);
        if (first && clefOwner && sig !== transposeSig) attributes(sig);
        transposeSig = sig;
      },
      setClef = (c, atLine) => {
        const type = c.type || 'treble',
          octaves = /[-+]8/.exec(type);
        clef = mxlClef(type);
        if (c.transpose && !(atLine && type === 'perc')) {
          transpose = c.transpose;
          if (atLine) octaveClef = false;
        }
        if (octaves) {
          transpose = octaves[0] === '-8' ? -12 : 12;
          if (atLine) octaveClef = true;
        } else if (atLine && octaveClef) [transpose, octaveClef] = [0, false];
        if (first && clefOwner && type !== clefType) attributes(mxlClefXML(clef, pv.staffNo));
        clefType = type;
        setTranspose();
      },
      setMeter = mt => {
        const sig = mxlTime(mt);
        meter = mt;
        if (first && leads && sig && sig !== meterSig) attributes(sig);
        meterSig = sig;
      },
      // Pitch as ABC spells it: an accidental lasts to the bar line at that octave, a tie carries it over the bar,
      // and otherwise the key signature applies.
      spell = (p, tied) => {
        const step = 'CDEFGAB'[((p.pitch % 7) + 7) % 7],
          explicit = p.accidental in MXL_ALTER;
        if (explicit) carried.set(p.pitch, MXL_ALTER[p.accidental]);
        const alter = explicit
          ? MXL_ALTER[p.accidental]
          : tied != null
            ? tied
            : carried.has(p.pitch)
              ? carried.get(p.pitch)
              : key[step] || 0;
        return {
          alter,
          pitch:
            `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}` +
            `<octave>${4 + Math.floor(p.pitch / 7) + clef.shift}</octave></pitch>`,
          accidental: explicit ? `<accidental>${MXL_ACCIDENTAL[p.accidental]}</accidental>` : ''
        };
      },
      typeXML = length => {
        const t = mxlType(length);
        return t ? `<type>${t.type}</type>` + '<dot/>'.repeat(t.dots) : '';
      },
      tempo = (t, header) => {
        const mark = t && mxlMetronome(t);
        if (mark) direction(mark.types, 'above', header ? mxlSwing(mark.sound, swing) : mark.sound);
        // Without an opening tempo mark, the swing feel goes in a <sound> of its own at the start.
        else if (header && swing > 50) open().content.push(mxlSwing('', swing));
      };
    for (const [li, line] of tune.lines.entries()) {
      const staff = line.staff?.[pv.s],
        voice = staff?.voices[pv.v];
      if (!voice) continue;
      if (!first) {
        setKey(staff.key);
        setClef(staff.clef || {}, true);
        setMeter(staff.meter);
        first = {
          line: li,
          key: keySig,
          clef,
          meter: meterSig,
          transpose: transpose - 12 * clef.shift ? transposeSig : '',
          length: meterLength()
        };
        // A voice that first appears on a later line starts in the measure the others have reached.
        pad(lineStarts[li] || 0);
        if (firstOfScore) tempo(tune.metaText?.tempo, true);
      } else {
        if (staff.key) setKey(staff.key);
        if (staff.clef?.type) setClef(staff.clef, true);
        if (staff.meter) setMeter(staff.meter);
        pad(lineStarts[li] || 0);
      }
      if (!m?.notes && li > first.line) open().newSystem = true;
      lineStarts[li] = Math.max(lineStarts[li] || 0, measures.length);
      for (const e of voice) {
        if (e.el_type === 'key') setKey(e);
        else if (e.el_type === 'clef') setClef(e);
        else if (e.el_type === 'midi' && e.cmd === 'transpose') {
          transpose = +e.params?.[0] || 0;
          setTranspose();
        } else if (e.el_type === 'meter') setMeter(e);
        else if (e.el_type === 'tempo' && leads) tempo(e);
        else if (e.el_type === 'part' && leads) direction(`<rehearsal>${xmlText(e.title)}</rehearsal>`);
        else if (e.el_type === 'bar') bar(e);
        else if (e.el_type === 'note') note(e);
      }
    }
    tiedFrom.forEach(untie);
    if (m?.notes) {
      if (ending) m.right.ending = {number: ending, type: 'discontinue'};
      close();
    } else if (m && measures.length) {
      // Anything after the last bar line, such as the end of a hairpin, joins the last measure.
      const last = measures.at(-1);
      last.content.push(...m.content);
      if (ending && !last.right.ending) last.right.ending = {number: ending, type: 'discontinue'};
    }
    return {measures, first};

    function decorate(d) {
      if (MXL_DYNAMICS.has(d)) direction(`<dynamics><${d}/></dynamics>`, 'below');
      else if (d in MXL_WEDGES) direction(`<wedge type="${MXL_WEDGES[d]}"/>`, 'below');
      else if (d === 'segno') direction('<segno/>');
      else if (d === 'coda') direction('<coda/>');
      else if (d in MXL_WORDS) direction(`<words>${MXL_WORDS[d]}</words>`);
    }
    // A bar line closes the measure that has notes. Its repeat and ending marks split between this measure's right
    // bar line and the next one's left; one with nothing before it (the opening |:) only opens the next measure.
    function bar(e) {
      for (const d of e.decoration || []) decorate(d);
      const kind = MXL_BARS[e.type] || {},
        target = m?.notes ? m : measures.at(-1);
      if (target && (m?.notes || (!target.right.style && kind.style !== 'none'))) {
        if (kind.style) target.right.style = kind.style;
        if (kind.backward) target.right.backward = true;
        if (ending && (e.endEnding || e.startEnding)) {
          target.right.ending = {number: ending, type: kind.backward ? 'stop' : 'discontinue'};
          ending = null;
        }
      }
      if (m?.notes) close();
      if (kind.forward) open().left.forward = true;
      if (e.startEnding) {
        ending = mxlEnding(e.startEnding);
        open().left.ending = {number: ending, text: String(e.startEnding)};
      }
    }
    function note(e) {
      const rest = e.rest?.type;
      for (const d of e.decoration || []) decorate(d);
      for (const c of e.chord || []) {
        const harmony = c.position === 'default' && mxlHarmony(c.name, pv.staffNo);
        if (harmony) open().content.push(harmony);
        else if (c.name?.trim())
          direction(`<words>${xmlText(c.name)}</words>`, c.position === 'below' ? 'below' : 'above');
      }
      if (rest === 'spacer' || !(e.duration > 0)) return;
      const measure = open();
      measure.notes = true;
      if (/multimeasure/.test(rest)) {
        // Z4 is four bars of rest: four measures, drawn as one multi-bar rest if the whole part rests in them.
        const count = Math.max(1, Math.round(+e.rest.text) || 1),
          each = dur(meterLength() || e.duration / count),
          hidden = rest === 'multimeasure' ? '' : ' print-object="no"';
        if (count > 1 && leads && !hidden) measure.multiRest = count;
        for (let i = 0; i < count; i++) {
          if (i) {
            close();
            open().notes = true;
          }
          m.content.push(
            `<note${hidden}><rest measure="yes"/><duration>${each}</duration>${voiceTag}${staffTag}</note>`
          );
          m.length += each;
        }
        return;
      }
      if (e.startTriplet) {
        const multiplier = e.tripletMultiplier || 1;
        tuplet = {actual: e.startTriplet, normal: Math.round(e.startTriplet * multiplier), multiplier, start: true};
      }
      // A length no single note has is written as several: tied notes, or rests one after another.
      const pieces = (mxlPieces(e.duration) || [e.duration]).map(value => ({
          length: dur(value * (tuplet?.multiplier || 1)),
          type: typeXML(value)
        })),
        last = pieces.length - 1,
        timeMod = tuplet
          ? `<time-modification><actual-notes>${tuplet.actual}</actual-notes>` +
            `<normal-notes>${tuplet.normal}</normal-notes></time-modification>`
          : '';
      // Slurs, the tuplet bracket, articulations and ornaments belong to the chord, so they go on its first note, and
      // on the first of the pieces; a tuplet ends on the last piece.
      const shared = [],
        articulations = [],
        ornaments = [],
        technical = [],
        pitches = e.pitches || [];
      for (const label of [...(e.endSlur || []), ...pitches.flatMap(p => p.endSlur || [])]) {
        const n = slurs.get(label)?.pop();
        if (!n) continue;
        slurNumbers.delete(n);
        shared.push(`<slur type="stop" number="${n}"/>`);
      }
      for (const {label} of [...(e.startSlur || []), ...pitches.flatMap(p => p.startSlur || [])]) {
        let n = 1;
        while (slurNumbers.has(n) && n < 16) n++;
        slurNumbers.add(n);
        slurs.set(label, [...(slurs.get(label) || []), n]);
        shared.push(`<slur type="start" number="${n}"/>`);
      }
      if (tuplet?.start) shared.push('<tuplet type="start" bracket="yes"/>');
      const marks = k => [
        ...(k ? [] : shared),
        ...(tuplet && e.endTriplet && k === last ? ['<tuplet type="stop"/>'] : [])
      ];
      let arpeggio = false;
      for (const d of e.decoration || []) {
        // A trill line's start already writes the trill mark, so a trill on the same note adds no second one.
        if (d === 'trill' && e.decoration.includes('trill(')) continue;
        if (d in MXL_ARTICULATIONS) articulations.push(`<${MXL_ARTICULATIONS[d]}/>`);
        else if (d in MXL_ORNAMENTS) ornaments.push(`<${MXL_ORNAMENTS[d]}/>`);
        else if (d in MXL_TECHNICAL) technical.push(`<${MXL_TECHNICAL[d]}/>`);
        else if (/^[0-5]$/.test(d)) technical.push(`<fingering>${d}</fingering>`);
        else if (d === 'fermata') shared.push('<fermata type="upright"/>');
        else if (d === 'invertedfermata') shared.push('<fermata type="inverted"/>');
        else if (d === 'arpeggio') arpeggio = true;
        else if (d === 'trill(') {
          ornaments.push('<trill-mark/><wavy-line type="start"/>');
          wavy = true;
        } else if (d === 'trill)' && wavy) {
          ornaments.push('<wavy-line type="stop"/>');
          wavy = false;
        } else if (d === 'glissando(') shared.push('<glissando type="start"/>');
        else if (d === 'glissando)') shared.push('<glissando type="stop"/>');
      }
      if (ornaments.length) shared.push(`<ornaments>${ornaments.join('')}</ornaments>`);
      if (technical.length) shared.push(`<technical>${technical.join('')}</technical>`);
      if (articulations.length) shared.push(`<articulations>${articulations.join('')}</articulations>`);
      // Beams follow abcjs's grouping; only notes shorter than a quarter carry one.
      let beam = '';
      if (!rest && e.duration < 0.25) {
        if (e.startBeam && !e.endBeam) {
          beam = 'begin';
          inBeam = true;
        } else if (inBeam && e.endBeam) {
          beam = 'end';
          inBeam = false;
        } else if (inBeam) beam = 'continue';
      } else if (!rest) inBeam = false;
      const beamAt = k =>
        beam &&
        `<beam number="1">${(beam === 'begin' && !k) || (beam === 'end' && k === last) ? beam : 'continue'}</beam>`;
      // Lyrics: a syllable followed by "-" begins or continues a word; "_" holds it over the next notes.
      const lyrics = [];
      if (!rest)
        for (const [i, l] of (e.lyric || []).entries()) {
          if (!l?.syllable) continue;
          const continues = l.divider === '-',
            syllabic = lyricOpen[i] ? (continues ? 'middle' : 'end') : continues ? 'begin' : 'single';
          lyricOpen[i] = continues;
          lyrics.push(
            `<lyric number="${i + 1}"><syllabic>${syllabic}</syllabic>${xmlTag('text', l.syllable)}` +
              `${l.divider === '_' ? '<extend/>' : ''}</lyric>`
          );
        }
      for (const g of e.gracenotes || []) {
        const {pitch, accidental} = spell(g);
        measure.content.push(
          `<note><grace${g.acciaccatura ? ' slash="yes"' : ''}/>${pitch}${voiceTag}` +
            `${typeXML(g.duration) || '<type>eighth</type>'}${accidental}${staffTag}</note>`
        );
      }
      if (rest || !pitches.length)
        for (const [k, {length, type}] of pieces.entries())
          measure.content.push(
            `<note${rest === 'invisible' ? ' print-object="no"' : ''}><rest/><duration>${length}</duration>` +
              `${voiceTag}${type}${timeMod}${staffTag}` +
              (marks(k).length ? `<notations>${marks(k).join('')}</notations>` : '') +
              '</note>'
          );
      else {
        // abcjs marks the next note as tied even when its pitch differs; only the same pitch continues the tie.
        const from = tiedFrom,
          spelled = pitches.map(p => {
            const endTie = p.endTie && from.has(p.pitch);
            return {...spell(p, endTie ? from.get(p.pitch).alter : null), endTie};
          });
        for (const [pitch, tie] of from)
          if (!pitches.some((p, i) => spelled[i].endTie && p.pitch === pitch)) untie(tie);
        tiedFrom = new Map();
        for (const [k, {length, type}] of pieces.entries())
          for (const [i, p] of pitches.entries()) {
            const ties = [...(spelled[i].endTie || k ? ['stop'] : []), ...(p.startTie || k < last ? ['start'] : [])],
              notations = [
                ...ties.map(t => `<tied type="${t}"/>`),
                ...(i ? [] : marks(k)),
                ...(arpeggio && !k ? ['<arpeggiate/>'] : [])
              ];
            measure.content.push(
              `<note>${i ? '<chord/>' : ''}${spelled[i].pitch}<duration>${length}</duration>` +
                ties.map(t => `<tie type="${t}"/>`).join('') +
                `${voiceTag}${type}${k ? '' : spelled[i].accidental}${timeMod}${staffTag}${i ? '' : beamAt(k)}` +
                (notations.length ? `<notations>${notations.join('')}</notations>` : '') +
                (i || k ? '' : lyrics.join('')) +
                '</note>'
            );
            if (p.startTie && k === last)
              tiedFrom.set(p.pitch, {
                alter: spelled[i].alter,
                content: measure.content,
                at: measure.content.length - 1
              });
          }
        measure.sounds = true;
      }
      measure.length += pieces.reduce((sum, piece) => sum + piece.length, 0);
      if (tuplet) tuplet.start = false;
      if (e.endTriplet) tuplet = null;
    }
  }

  // Assemble the parts measure by measure; the voices of a part follow one another, joined by <backup>.
  const count = Math.max(0, ...parts.flatMap(p => p.voices.map(v => v.measures.length)));
  if (!count) throw Error('There is no music to export.');
  const lead = parts[0].voices[0],
    pickup = lead.first.length && lead.measures[0]?.length < dur(lead.first.length) ? 1 : 0;
  const body = parts.map((part, pi) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const bars = (part.voices.find(v => v.measures[i]) || part.voices[0]).measures[i] || mxlBlank(),
        voices = part.voices.filter(v => v.measures[i]?.content.length);
      let xml = bars.newSystem ? '<print new-system="yes"/>' : '';
      if (i === 0)
        xml +=
          `<attributes><divisions>${divisions}</divisions>${part.voices[0].first.key}${part.voices[0].first.meter}` +
          (part.staffs.length > 1 ? `<staves>${part.staffs.length}</staves>` : '') +
          part.staffs
            .map(s => part.voices.find(v => v.s === s))
            .map(v => mxlClefXML(v.first?.clef || mxlClef(), v.staffNo))
            .join('') +
          part.staffs.map(s => part.voices.find(v => v.s === s).first?.transpose || '').join('') +
          '</attributes>';
      if (bars.left.forward || bars.left.ending)
        xml +=
          '<barline location="left">' +
          `<bar-style>${bars.left.forward ? 'heavy-light' : 'regular'}</bar-style>` +
          (bars.left.ending
            ? `<ending number="${bars.left.ending.number}" type="start">${xmlText(bars.left.ending.text)}.</ending>`
            : '') +
          (bars.left.forward ? '<repeat direction="forward"/>' : '') +
          '</barline>';
      // multiple-rest covers every staff and voice of the part, so a Z rest is drawn as one only when all of them rest.
      const multiRest = part.voices[0].measures[i]?.multiRest;
      if (multiRest && part.voices.every(v => !v.measures.slice(i, i + multiRest).some(x => x.sounds)))
        xml += `<attributes><measure-style><multiple-rest>${multiRest}</multiple-rest></measure-style></attributes>`;
      for (const [k, v] of voices.entries()) {
        xml += v.measures[i].content.join('');
        if (k < voices.length - 1 && v.measures[i].length)
          xml += `<backup><duration>${v.measures[i].length}</duration></backup>`;
      }
      if (!voices.some(v => v.measures[i].length)) {
        // No voice of this part plays here: rest for as long as the other parts' measure.
        const length = Math.max(
          dur(part.voices[0].first?.length || 0),
          ...parts.flatMap(p => p.voices.map(v => v.measures[i]?.length || 0))
        );
        if (length)
          xml += `<note><rest measure="yes"/><duration>${length}</duration><voice>1</voice>${part.staffs.length > 1 ? '<staff>1</staff>' : ''}</note>`;
      }
      const r = bars.right;
      if (r.style || r.backward || r.ending)
        xml +=
          '<barline location="right">' +
          `<bar-style>${r.style || 'regular'}</bar-style>` +
          (r.ending ? `<ending number="${r.ending.number}" type="${r.ending.type}"/>` : '') +
          (r.backward ? '<repeat direction="backward"/>' : '') +
          '</barline>';
      out.push(`<measure number="${i + 1 - pickup}"${i === 0 && pickup ? ' implicit="yes"' : ''}>${xml}</measure>`);
    }
    return `<part id="P${pi + 1}">\n${out.join('\n')}\n</part>`;
  });

  // Credits: the same notice as every other export, in <rights>, on page 1, and as JSON for a later re-import.
  const item = meta.item,
    title = tune.metaText?.title || item?.title || 'Untitled',
    composer = tune.metaText?.composer || '',
    credit = typeof exportCredit === 'function' ? exportCredit(item) : '',
    // A copyright line kept from an imported file (%%abc-copyright) travels when there is no FretFree credit.
    copyright = credit ? '' : tune.metaText?.['abc-copyright'] || '',
    gpl = credit && scoreLicense(item).startsWith('GPL-') && typeof GPL_LICENSE === 'string',
    metadata = {...item},
    date = meta.date || new Date().toISOString().slice(0, 10);
  delete metadata.abc;
  // Part names come from V: name=; a braced group takes its top staff's, and voices sharing a staff list theirs.
  // MuseScore wants an instrument for each part, so each has one by the same name.
  const partList = parts.map((part, i) => {
    const name =
      [...new Set((staffInfo.get(part.staffs[0]).staff.title || []).filter(Boolean))].join(', ') ||
      (parts.length === 1 ? meta.instrument || 'Music' : 'Part ' + (i + 1));
    return (
      `<score-part id="P${i + 1}">${xmlTag('part-name', name)}` +
      `<score-instrument id="P${i + 1}-I1">${xmlTag('instrument-name', name)}</score-instrument></score-part>`
    );
  });
  const credits = [
    ['title', title, 'default-x="612" default-y="1504" justify="center" valign="top" font-size="22"'],
    composer && ['composer', composer, 'default-x="1140" default-y="1424" justify="right" valign="bottom"'],
    (credit || copyright) && [
      'rights',
      credit || copyright,
      'default-x="612" default-y="80" justify="center" valign="bottom" font-size="7"'
    ]
  ].filter(Boolean);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0">\n' +
    `<work>${xmlTag('work-title', title)}</work>\n` +
    '<identification>' +
    (composer ? xmlTag('creator', composer, ' type="composer"') : '') +
    (credit || copyright ? xmlTag('rights', credit || copyright) : '') +
    `<encoding><software>FretFree</software><encoding-date>${date}</encoding-date>` +
    '<supports element="accidental" type="yes"/><supports element="beam" type="yes"/>' +
    '<supports element="print" attribute="new-system" type="yes" value="yes"/>' +
    '<supports element="stem" type="no"/></encoding>' +
    (credit && item.source ? xmlTag('source', item.source) : '') +
    (credit
      ? '<miscellaneous>' +
        xmlTag('miscellaneous-field', JSON.stringify(metadata), ' name="fretfree-rights"') +
        (gpl
          ? xmlTag('miscellaneous-field', GPL_LICENSE, ' name="fretfree-license-text"') +
            xmlTag('miscellaneous-field', creditedABC(unmarkedSource(source), item), ' name="fretfree-abc-source"')
          : '') +
        '</miscellaneous>'
      : '') +
    '</identification>\n' +
    '<defaults><scaling><millimeters>7.0556</millimeters><tenths>40</tenths></scaling>' +
    '<page-layout><page-height>1584</page-height><page-width>1224</page-width></page-layout></defaults>\n' +
    credits
      .map(
        ([type, text, at]) =>
          `<credit page="1"><credit-type>${type}</credit-type>${xmlTag('credit-words', text, ' ' + at)}</credit>\n`
      )
      .join('') +
    `<part-list>${partList.join('')}</part-list>\n` +
    body.join('\n') +
    '\n</score-partwise>\n'
  );
}

// MusicXML import: musicXMLToABC() turns a parsed MusicXML document (partwise or timewise, from MuseScore, Noteflight,
// Finale, Sibelius, Dorico or FretFree) into ABC at concert pitch. Each staff becomes an ABC voice, voices that share a
// staff are merged with %%score (…), and the staves of a part are braced. Timing comes from <duration>, so a gap in a
// voice becomes a rest and every voice has the same bars. What ABC or abcjs cannot show is listed in plain words.
// Only standard DOM calls are used, so the tests run it on jsdom documents.
const MXI_TYPES = {
    maxima: 8,
    long: 4,
    breve: 2,
    whole: 1,
    half: 1 / 2,
    quarter: 1 / 4,
    eighth: 1 / 8,
    '16th': 1 / 16,
    '32nd': 1 / 32,
    '64th': 1 / 64,
    '128th': 1 / 128,
    '256th': 1 / 256
  },
  MXI_STEPS = 'CDEFGAB',
  MXI_ACC = {'-2': '__', '-1': '_', 0: '=', 1: '^', 2: '^^'},
  MXI_MODES = {
    major: '',
    ionian: '',
    minor: 'm',
    aeolian: 'm',
    dorian: 'Dor',
    phrygian: 'Phr',
    lydian: 'Lyd',
    mixolydian: 'Mix',
    locrian: 'Loc'
  },
  MXI_ARTICULATIONS = {
    staccato: '.',
    tenuto: '!tenuto!',
    accent: '!accent!',
    'strong-accent': '!marcato!',
    staccatissimo: '!wedge!',
    spiccato: '!wedge!',
    'detached-legato': '!tenuto!.',
    'breath-mark': '!breath!'
  },
  MXI_ORNAMENTS = {
    'trill-mark': '!trill!',
    mordent: '!mordent!',
    'inverted-mordent': '!uppermordent!',
    turn: '!turn!',
    'delayed-turn': '!turn!',
    'inverted-turn': '!invertedturn!',
    'delayed-inverted-turn': '!invertedturn!',
    shake: '!uppermordent!'
  },
  MXI_TECHNICAL = {
    'up-bow': '!upbow!',
    'down-bow': '!downbow!',
    'open-string': '!open!',
    'thumb-position': '!thumb!',
    'snap-pizzicato': '!snap!',
    stopped: '!plus!'
  },
  // abcjs draws these dynamics; strong accents become sfz, and anything else is shown as text below the staff.
  MXI_DYNAMICS = new Set(['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sfz']),
  MXI_ACCENTS = new Set(['sf', 'sffz', 'fz', 'rfz', 'rf', 'sfzp']),
  // Chord-symbol suffixes for a <kind> that has no text of its own.
  MXI_KINDS = {
    major: '',
    minor: 'm',
    augmented: '+',
    diminished: 'dim',
    dominant: '7',
    'major-seventh': 'maj7',
    'minor-seventh': 'm7',
    'diminished-seventh': 'dim7',
    'augmented-seventh': '7#5',
    'half-diminished': 'm7b5',
    'major-minor': 'm(maj7)',
    'major-sixth': '6',
    'minor-sixth': 'm6',
    'dominant-ninth': '9',
    'major-ninth': 'maj9',
    'minor-ninth': 'm9',
    'dominant-11th': '11',
    'major-11th': 'maj11',
    'minor-11th': 'm11',
    'dominant-13th': '13',
    'major-13th': 'maj13',
    'minor-13th': 'm13',
    'suspended-second': 'sus2',
    'suspended-fourth': 'sus4',
    power: '5'
  },
  // Road-map words abcjs draws as marks.
  MXI_WORDS = {
    fine: '!fine!',
    'd.c.': '!D.C.!',
    'd.s.': '!D.S.!',
    'd.c. al fine': '!D.C.alfine!',
    'd.c. al coda': '!D.C.alcoda!',
    'd.s. al fine': '!D.S.alfine!',
    'd.s. al coda': '!D.S.alcoda!'
  },
  // What is left out, in plain words, by MusicXML element name or reason. Several names share one description.
  MXI_LEFT_OUT = {
    pedal: 'pedal marks',
    'octave-shift': '8va lines (the notes keep their pitch)',
    'figured-bass': 'figured bass',
    tremolo: 'tremolos',
    bracket: 'lines and brackets over the staff',
    dashes: 'lines and brackets over the staff',
    image: 'pictures',
    'string-mute': 'mute marks',
    'harp-pedals': 'harp pedal diagrams',
    'accordion-registration': 'accordion registrations',
    percussion: 'percussion pictograms',
    fingering: 'fingerings above 5',
    string: 'string numbers',
    fret: 'fret numbers',
    harmonic: 'harmonics',
    bend: 'bends',
    'hammer-on': 'hammer-ons and pull-offs',
    'pull-off': 'hammer-ons and pull-offs',
    caesura: 'caesuras',
    doit: 'jazz articulations',
    falloff: 'jazz articulations',
    plop: 'jazz articulations',
    scoop: 'jazz articulations',
    notehead: 'special noteheads',
    slash: 'slash notation',
    cue: 'cue notes (left as space)',
    unpitched: 'percussion notes (written and played as pitched notes)',
    tab: 'tablature staves (the notation staff is kept)',
    'tab-only': 'tablature (shown as standard notation)',
    quarter: 'quarter tones (rounded to the nearest note)',
    'grace-chord': 'chords in grace notes (the first note is kept)',
    overlap: 'notes that overlap in one voice',
    'time-mix': 'combined time signatures (written as one meter)',
    repeat: 'repeat counts other than two',
    verses: 'lyrics after verse 8'
  },
  // FretFree instruments a part name can choose; a B♭ or E♭ one only when the part is written for it.
  // The import writes concert pitch, so only instruments that read the source at that octave are listed: the ones
  // FretFree draws an octave above the source (cello, bassoon, bass guitar and the like) and the glockenspiel and
  // baritone sax, which sound in another octave, are left to the Instrument menu. A bass guitar is not a guitar.
  MXI_INSTRUMENTS = [
    [/flute|piccolo/i, 'Flute'],
    [/viola/i, 'Viola'],
    [/violin|fiddle/i, 'Violin'],
    [/recorder/i, 'Recorder'],
    [/oboe/i, 'Oboe'],
    [/clarinet/i, 'Clarinet in B♭', 10],
    [/trumpet|cornet/i, 'Trumpet in B♭', 10],
    [/alto sax/i, 'Alto sax in E♭', 3],
    [/tenor sax/i, 'Tenor sax in B♭', 10],
    [/english horn|cor anglais/i, '', 5],
    [/horn/i, 'Horn in F', 5],
    // A soprano or alto part is a voice; a soprano saxophone, an alto trombone or an alto xylophone is not.
    [
      /voice|vocal|^(?=.*\b(?:sopranos?|mezzo|altos?)\b)(?:[\s\d.,()-]|\b[IVX]+\b|sopranos?|mezzo|altos?|contraltos?|solo|choir|chorus)*$/i,
      'Voice'
    ],
    [/piano|keyboard/i, 'Piano'],
    [/ukulele/i, 'Ukulele'],
    [/bass guitar|electric bass/i, ''],
    [/guitar/i, 'Guitar']
  ];
// Element children are listed once per element: the lookups below run many times on each note.
const xmlChildList = new WeakMap(),
  xmlChildren = el => {
    let list = xmlChildList.get(el);
    if (!list) xmlChildList.set(el, (list = [...el.children]));
    return list;
  },
  xmlKids = (el, name) => (el ? xmlChildren(el).filter(c => c.localName === name) : []),
  xmlKid = (el, name) => (el ? xmlChildren(el).find(c => c.localName === name) || null : null),
  xmlValue = (el, name) => xmlKid(el, name)?.textContent.trim() ?? '',
  // Text for an ABC field: one line. % starts a comment in ABC and abcjs does not read \% back, so a percent sign
  // becomes the full-width ％, which looks the same and keeps the rest of the line. Inside quotes, a quote becomes an
  // apostrophe.
  abcText = text =>
    String(text ?? '')
      .replace(/\s+/g, ' ')
      .replace(/%/g, '％')
      .trim(),
  abcQuoted = text => abcText(text).replace(/"/g, "'");
// A written pitch moved by a <transpose>: its letter by `diatonic` steps and its sound by `chromatic` semitones.
function mxiTranspose({step, alter, octave}, diatonic, chromatic) {
  const index = MXI_STEPS.indexOf(step) + 7 * octave + diatonic,
    semitone = LETTER_SEMIS[MXI_STEPS.indexOf(step)] + 12 * octave + alter + chromatic,
    newOctave = Math.floor(index / 7);
  return {
    step: MXI_STEPS[posMod(index, 7)],
    octave: newOctave,
    alter: semitone - LETTER_SEMIS[posMod(index, 7)] - 12 * newOctave
  };
}
// The key signature's alter for each letter: from the circle of fifths, or the steps of a non-traditional key.
function mxiKeyAlters(key) {
  const alters = {};
  if (key.steps) for (const [step, alter] of key.steps) alters[step] = alter;
  else
    for (let i = 0; i < Math.abs(key.fifths); i++)
      alters[(key.fifths > 0 ? 'FCGDAEB' : 'BEADGCF')[i]] = Math.sign(key.fifths);
  return alters;
}
function mxiKeyText(key) {
  const steps = (key.steps || []).filter(([, alter]) => alter);
  if (steps.length) return 'C exp ' + steps.map(([step, alter]) => MXI_ACC[alter] + step.toLowerCase()).join(' ');
  if (key.steps) return 'C';
  const mode = KEY_MODES.find(m => m.mode === key.mode) || KEY_MODES[0];
  return tonicName(key.fifths - mode.offset) + mode.mode;
}
// abcjs clef names. An octave clef's letters are drawn an octave from its sound; abcjs plays them back down.
function mxiClef(el) {
  const sign = xmlValue(el, 'sign').toUpperCase(),
    line = +xmlValue(el, 'line') || 0,
    change = Math.sign(Math.round(+xmlValue(el, 'clef-octave-change') || 0));
  let name = 'treble';
  if (sign === 'F') name = line === 3 ? 'bass3' : 'bass';
  else if (sign === 'C') name = {1: 'alto1', 2: 'alto2', 4: 'tenor'}[line] || 'alto';
  else if (sign === 'PERCUSSION') name = 'perc';
  else if (sign === 'NONE') name = 'none';
  const octave = change && /^(treble|bass|alto|tenor)$/.test(name) ? (change < 0 ? '-8' : '+8') : '';
  return {name: name + octave, shift: octave ? change : 0, tab: sign === 'TAB'};
}
function mxiMeter(el) {
  if (xmlKid(el, 'senza-misura')) return {text: 'none', length: 0};
  const symbol = el.getAttribute('symbol'),
    beats = xmlKids(el, 'beats').map(b => b.textContent.trim()),
    types = xmlKids(el, 'beat-type').map(b => Math.round(+b.textContent.trim()));
  if (!beats.length || types.length !== beats.length || !types.every(t => t > 0)) return null;
  const count = text => text.split('+').reduce((sum, n) => sum + (+n || 0), 0);
  if (beats.length === 1) {
    if (!/^\d+(\+\d+)*$/.test(beats[0]) || !count(beats[0])) return null;
    const length = count(beats[0]) / types[0];
    if (symbol === 'common' && beats[0] === '4' && types[0] === 4) return {text: 'C', length};
    if (symbol === 'cut' && beats[0] === '2' && types[0] === 2) return {text: 'C|', length};
    return {text: `${beats[0]}/${types[0]}`, length};
  }
  // 2/4 + 3/8 is written as the meter of the whole bar, 7/8.
  const den = Math.max(...types),
    num = beats.reduce((sum, b, i) => sum + (count(b) * den) / types[i], 0);
  return Number.isInteger(num) && num > 0 ? {text: `${num}/${den}`, length: num / den, mixed: true} : null;
}
// A Q: field: the beat from <metronome> (a quarter for a bare <sound tempo>) and the words beside it.
function mxiTempo(words, metronome, sound) {
  let beat = '',
    speed = 0;
  if (metronome && xmlKid(metronome, 'per-minute')) {
    const unit = MXI_TYPES[xmlValue(metronome, 'beat-unit')],
      dots = xmlKids(metronome, 'beat-unit-dot').length;
    speed = parseFloat(xmlValue(metronome, 'per-minute').replace(/^[^\d.]*/, ''));
    if (unit && speed > 0) {
      const [n, d] = mxlFraction(unit * (2 - 1 / 2 ** dots));
      beat = `${n}/${d}`;
    }
  }
  if (!beat && sound > 0) [beat, speed] = ['1/4', sound];
  const text = words.map(abcQuoted).filter(Boolean).join(' ');
  return [text && `"${text}"`, beat && `${beat}=${+speed.toFixed(2)}`].filter(Boolean).join(' ');
}

function musicXMLToABC(doc, {name = ''} = {}) {
  const root = doc?.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length)
    throw Error('This file could not be read as MusicXML. It may be damaged, or it may be another kind of file.');
  if (root.localName === 'opus') throw Error('This MusicXML file is a list of scores. Open one of its scores instead.');
  if (!/^score-(partwise|timewise)$/.test(root.localName)) throw Error('This file is not a MusicXML score.');
  const skipped = new Set(),
    skip = what => skipped.add(MXI_LEFT_OUT[what] || what.replace(/-/g, ' '));

  // Parts in part-list order, each with its measures; a timewise file is turned around.
  const partInfo = new Map(),
    partOf = id => {
      if (!partInfo.has(id)) partInfo.set(id, {name: '', abbreviation: '', instrument: '', measures: []});
      return partInfo.get(id);
    };
  for (const sp of xmlKids(xmlKid(root, 'part-list'), 'score-part')) {
    const nameEl = xmlKid(sp, 'part-name'),
      shown = nameEl?.getAttribute('print-object') !== 'no';
    Object.assign(partOf(sp.getAttribute('id')), {
      name: shown ? abcQuoted(nameEl?.textContent) : '',
      abbreviation: shown ? abcQuoted(xmlValue(sp, 'part-abbreviation')) : '',
      instrument: (nameEl?.textContent || '') + ' ' + xmlValue(xmlKid(sp, 'score-instrument'), 'instrument-name')
    });
  }
  if (root.localName === 'score-partwise')
    for (const p of xmlKids(root, 'part'))
      partOf(p.getAttribute('id')).measures.push(...xmlKids(p, 'measure').map(m => ({el: m, measure: m})));
  else
    for (const m of xmlKids(root, 'measure'))
      for (const p of xmlKids(m, 'part')) partOf(p.getAttribute('id')).measures.push({el: p, measure: m});
  // One tick grid for the whole file: the least common multiple of every <divisions>.
  let ticks = 1;
  for (const d of doc.getElementsByTagName('divisions')) {
    const n = Math.round(+d.textContent);
    if (n > 0 && n <= 1e5 && ticks <= 1e9) ticks = (ticks / mxlGcd(ticks, n)) * n;
  }
  const whole = t => t / (4 * ticks),
    tempos = [];
  // The first <swing> in a <sound> sets the swing feel (see mxlSwing); a straight one or an even ratio is none.
  let swing = 0;
  const readSwing = sound => {
    const el = xmlKid(sound, 'swing');
    if (!el || swing || xmlKid(el, 'straight')) return;
    const first = +xmlValue(el, 'first'),
      second = +xmlValue(el, 'second');
    if (first > 0 && second > 0) swing = Math.round((100 * first) / (first + second));
  };
  let parts = [...partInfo.values()].filter(p => p.measures.length).map(readPart);
  // A part that is only tablature repeats the notes of a notation part; it stays only when nothing else is there.
  if (parts.some(p => p.tabOnly) && parts.some(p => !p.tabOnly)) {
    parts = parts.filter(p => !p.tabOnly);
    skip('tab');
  } else if (parts.some(p => p.tabOnly)) skip('tab-only');
  if (!parts.some(p => p.hasNotes)) throw Error('There is no music in this MusicXML file.');
  const count = Math.max(...parts.map(p => p.measures.length));

  // ABC voices: each staff's voices in number order, and one voice for a staff without notes.
  const voices = [];
  for (const part of parts)
    for (let s = 1; s <= part.staves; s++) {
      if (part.dropStaves.has(s)) continue;
      const keys = [...part.voiceOrder.entries()]
        .filter(([, v]) => v.staff === s)
        .sort((a, b) => (parseInt(a[1].voice) || 0) - (parseInt(b[1].voice) || 0) || a[1].order - b[1].order)
        .map(([key]) => key);
      if (!keys.length) keys.push(s + ':');
      keys.forEach((key, index) =>
        voices.push({
          part,
          staff: s,
          key,
          index,
          shared: keys.length > 1,
          id: String(voices.length + 1),
          first: !voices.some(v => v.part === part)
        })
      );
    }
  // Every measure lasts as long as its longest voice in any part; an empty one lasts a bar of its meter.
  const lengths = [];
  let meterLength = 0;
  for (let i = 0; i < count; i++) {
    for (const c of parts[0].measures[i]?.changes || []) if (c.type === 'meter') meterLength = c.length;
    lengths.push(
      Math.max(...parts.map(p => p.measures[i]?.length || 0)) || Math.round(meterLength * 4 * ticks) || 4 * ticks
    );
  }
  for (const v of voices) {
    let graces = [];
    v.items = lengths.map((length, i) => {
      const events = [...(v.part.measures[i]?.voices.get(v.key) || [])].sort((a, b) => a.t - b.t),
        items = [];
      let pos = 0;
      const gap = (t, span) =>
        span > 0 && items.push({gap: true, t, ticks: span, rest: true, pitches: [], pre: [], chords: [], inline: []});
      for (const e of events) {
        if (e.grace) {
          graces.push(e);
          continue;
        }
        if (e.t < pos) {
          skip('overlap');
          continue;
        }
        gap(pos, e.t - pos);
        e.graces = graces;
        graces = [];
        items.push(e);
        pos = e.t + e.ticks;
      }
      gap(pos, length - pos);
      // A voice with nothing in a measure shows a whole-bar rest on its staff's first voice and space elsewhere.
      if (!v.index && items.every(x => x.gap)) items.forEach(x => (x.shown = true));
      return items;
    });
  }
  // Directions and chord symbols go on the voice they name (or the staff's first voice), on the first note or rest
  // at or after their time. A hairpin ends on the note it reaches; one that ends between notes ends on the one before.
  for (const part of parts)
    part.measures.forEach((m, i) => {
      for (const mark of m.marks) {
        const staffVoices = voices.filter(v => v.part === part && v.staff === mark.staff),
          v = staffVoices.find(x => x.key === mark.staff + ':' + mark.voice) || staffVoices[0];
        if (!v) continue;
        const items = v.items[i],
          after = items.find(x => x.t >= mark.t),
          target =
            mark.stop && after?.t !== mark.t ? items.findLast(x => x.t < mark.t) || after : after || items.at(-1);
        if (!target) continue;
        if (mark.chord) target.chords.push(mark.chord);
        if (mark.pre) target.pre.push(mark.pre);
        if (mark.part) target.inline.push(`[P:${mark.part}]`);
        if (mark.wedge) {
          if (mark.wedge === 'stop') {
            if (v.wedge) target.pre.push(`!${v.wedge})!`);
            v.wedge = null;
          } else {
            if (v.wedge) target.pre.push(`!${v.wedge})!`);
            target.pre.push(`!${mark.wedge}(!`);
            v.wedge = mark.wedge;
          }
        }
      }
    });
  // Tempo marks from any part, once each: the first one is the Q: header when it comes before any note.
  const seen = new Set();
  let headerTempo = '';
  for (const tempo of tempos.sort((a, b) => a.measure - b.measure || a.t - b.t || a.part - b.part)) {
    const id = tempo.measure + ':' + tempo.t + ':' + tempo.q;
    if (seen.has(id) || !tempo.q) continue;
    seen.add(id);
    if (!tempo.measure && !tempo.t && !headerTempo) headerTempo = tempo.q;
    else {
      const items = voices[0].items[tempo.measure];
      (items?.find(x => x.t >= tempo.t) || items?.at(-1))?.inline.push(`[Q:${tempo.q}]`);
    }
  }

  // Lines: the file's system breaks when it has them (at most 8 bars a line), otherwise 4 bars a line.
  const hinted = parts.some(p => p.measures.some(m => m.newSystem)),
    lineStarts = [0];
  for (let i = 1, since = 1; i < count; i++, since++)
    if (hinted ? parts.some(p => p.measures[i]?.newSystem) || since >= 8 : since >= 4) {
      lineStarts.push(i);
      since = 0;
    }

  // Each voice's starting key, meter and clef come from its part's first changes; the header uses the first voice's.
  for (const v of voices) {
    v.start = {key: {fifths: 0, mode: ''}, meter: null, clef: 'treble'};
    for (const c of v.part.measures[0]?.changes || [])
      if (c.t === 0 && applies(c, v)) v.start[c.type] = c.type === 'clef' ? c.text : c.type === 'key' ? c.key : c;
  }
  const head = voices[0].start,
    header = {key: mxiKeyText(head.key), meter: head.meter?.text || 'none'};
  for (const v of voices) {
    v.state = {
      key: header.key,
      alters: mxiKeyAlters(head.key),
      meter: header.meter,
      beat: beatOf(head.meter),
      clef: v.start.clef,
      bar: new Map(),
      tied: new Map(),
      slurs: new Map(),
      hold: new Map()
    };
    v.verses = Math.max(0, ...v.items.flat().flatMap(x => [...(x.lyric?.keys() || [])]));
  }
  // abcjs keeps one key for the whole score: an inline [K:] in one voice also sets the key of every voice written after
  // it, from the start of that voice's line, and a [K:clef=…] takes that key too. So when the parts' keys differ, or
  // the key changes in a score of several voices, each line of every voice starts by naming its key. abcjs also starts
  // each voice's line in its V: clef, so a voice that has changed clef names its clef (with its key) again.
  const keyTrail = v =>
      [
        mxiKeyText(v.start.key),
        ...v.part.measures.flatMap((m, i) =>
          m.changes.filter(c => c.type === 'key' && applies(c, v)).map(c => `${i}:${c.t}:${mxiKeyText(c.key)}`)
        )
      ].join(),
    keysDiffer = voices.some(v => keyTrail(v) !== keyTrail(voices[0])),
    keyChanges = voices.some(v =>
      v.part.measures.some((m, i) => m.changes.some(c => c.type === 'key' && applies(c, v) && (i || c.t)))
    ),
    restate = keysDiffer || (voices.length > 1 && keyChanges),
    multi = voices.length > 1 || voices[0].start.clef !== 'treble',
    body = [];
  lineStarts.forEach((from, li) => {
    const to = lineStarts[li + 1] ?? count;
    for (const v of voices) {
      const st = v.state,
        before = {key: st.key, clef: st.clef};
      for (const c of (v.part.measures[from]?.changes || []).filter(c => !c.t && applies(c, v) && c.type !== 'meter')) {
        (c.done ??= new Set()).add(v);
        if (c.type === 'clef') st.clef = c.text;
        else {
          st.key = mxiKeyText(c.key);
          st.alters = mxiKeyAlters(c.key);
        }
      }
      const clef = (li && st.clef !== v.start.clef) || st.clef !== before.clef ? 'clef=' + st.clef : '',
        key = restate || clef || st.key !== before.key ? st.key : '';
      v.lyrics = Array.from({length: v.verses}, () => []);
      let line = key || clef ? `[K:${[key, clef].filter(Boolean).join(' ')}] ` : '';
      const left = v.part.measures[from]?.left || {};
      if (left.forward) line += '|:';
      if (left.ending) line += '[' + left.ending + ' ';
      for (let i = from; i < to; i++) line += measureText(v, i) + barToken(v.part, i, i === to - 1);
      if (multi) body.push('V:' + v.id);
      body.push(line.replace(/ +/g, ' ').trim());
      v.lyrics.forEach((tokens, n) => {
        while (tokens.at(-1) === '*') tokens.pop();
        if (tokens.length || v.lyrics.slice(n + 1).some(t => t.some(x => x !== '*')))
          body.push('w: ' + (tokens.join(' ') || '*'));
      });
    }
  });

  // Header: titles, people, rights, meter, unit, tempo, voices and key.
  const work = xmlKid(root, 'work'),
    identification = xmlKid(root, 'identification'),
    credits = xmlKids(root, 'credit').map(c => ({
      type: xmlValue(c, 'credit-type'),
      words: xmlKids(c, 'credit-words'),
      text: xmlKids(c, 'credit-words')
        .map(w => w.textContent)
        .join(' ')
    })),
    creators = xmlKids(identification, 'creator'),
    creator = type =>
      creators.filter(c => (c.getAttribute('type') || 'composer') === type).map(c => abcText(c.textContent)),
    fields = xmlKids(xmlKid(identification, 'miscellaneous'), 'miscellaneous-field'),
    rightsField = fields.find(f => f.getAttribute('name') === 'fretfree-rights');
  let metadata = {};
  if (rightsField)
    try {
      const value = JSON.parse(rightsField.textContent);
      if (value && typeof value === 'object' && !Array.isArray(value)) metadata = value;
    } catch {}
  delete metadata.abc;
  const largest = credits
      .filter(c => !c.type || c.type === 'title')
      .sort(
        (a, b) =>
          (b.type === 'title') - (a.type === 'title') ||
          +b.words[0]?.getAttribute('font-size') - +a.words[0]?.getAttribute('font-size')
      )[0],
    // Titles from <work> and <movement-title>; a file with neither uses its largest title credit or its name.
    named = [...new Set([xmlValue(work, 'work-title'), xmlValue(root, 'movement-title')].map(abcText).filter(Boolean))],
    titles = named.length ? named : [abcText(largest?.text) || abcText(name.replace(/\.[^.]*$/, '')) || 'Untitled'],
    composers = creator('composer').length
      ? creator('composer')
      : credits.filter(c => c.type === 'composer').map(c => abcText(c.text)),
    rights = metadata.rights
      ? []
      : (xmlKids(identification, 'rights').length
          ? xmlKids(identification, 'rights').map(r => r.textContent)
          : credits.filter(c => c.type === 'rights').map(c => c.text)
        ).flatMap(text => text.split(/\n+/).map(abcText).filter(Boolean));
  const lines = [
    'X:1',
    ...titles.map(t => 'T:' + t),
    ...composers.map(c => 'C:' + c),
    ...creator('lyricist').map(c => 'C:Words: ' + c),
    ...creator('arranger').map(c => 'C:Arranged by ' + c),
    ...rights.map(r => '%%abc-copyright ' + r),
    'M:' + header.meter,
    'L:1/8'
  ];
  if (headerTempo) lines.push('Q:' + headerTempo);
  if (swing > 50) lines.push('%%MIDI swing ' + Math.min(75, swing));
  if (voices.length > 1 && voices.some(v => v.shared || v.part.staves - v.part.dropStaves.size > 1))
    lines.push(
      '%%score ' +
        parts
          .map(part => {
            const staves = [...new Set(voices.filter(v => v.part === part).map(v => v.staff))].map(s => {
              const ids = voices.filter(v => v.part === part && v.staff === s).map(v => v.id);
              return ids.length > 1 ? `(${ids.join(' ')})` : ids[0];
            });
            return staves.length > 1 ? `{${staves.join(' | ')}}` : staves[0];
          })
          .join(' ')
    );
  // A score of one voice is a melody like FretFree's own, with no staff name (the caption above it names the
  // instrument), whatever its clef; a voice on a bass staff still needs a V: line for the clef.
  if (multi)
    for (const v of voices) {
      const info = v.part.info,
        named = v.first && voices.length > 1;
      lines.push(
        `V:${v.id}` +
          (named && info.name ? ` name="${info.name}"` : '') +
          (named && info.abbreviation ? ` snm="${info.abbreviation}"` : '') +
          ` clef=${v.start.clef}` +
          (v.shared ? (v.index % 2 ? ' stem=down' : ' stem=up') : '')
      );
    }
  lines.push('K:' + header.key);
  // The instrument setting shows every voice written for that instrument, so a B♭ or E♭ one is chosen only when all
  // the parts are written in its transposition. Parts in different transpositions are shown at concert pitch (Piano).
  const transposition = p => posMod(p.transposed || 0, 12),
    same = parts.every(p => transposition(p) === transposition(parts[0])),
    instrument =
      MXI_INSTRUMENTS.find(
        ([pattern, , chromatic]) =>
          pattern.test(parts[0].info.instrument) && (chromatic ?? 0) === transposition(parts[0]) && (same || !chromatic)
      )?.[1] || (same ? '' : 'Piano');
  return {
    abc: lines.join('\n') + '\n' + body.join('\n') + '\n',
    metadata,
    skipped: [...skipped],
    parts: parts.length,
    measures: count,
    instrument: instrument || ''
  };

  // Whether a key, meter or clef change applies to a voice: meters to all, keys to the part or one staff.
  function applies(c, v) {
    return (
      c.type === 'meter' ||
      (c.type === 'key' && (!c.staff || c.staff === v.staff)) ||
      (c.type === 'clef' && c.staff === v.staff)
    );
  }
  function beatOf(meter) {
    const [num, den] = String(meter?.text || '')
      .split('/')
      .map(Number);
    return den === 8 && num % 3 === 0 && num > 3 ? 3 / 8 : 1 / 4;
  }
  // One bar line; at the end of a line it leaves the next measure's repeat and ending to the start of the next line.
  // abcjs ends an ending's bracket only at a bar line other than a plain one, so a stop there becomes a double bar.
  function barToken(part, i, lineEnd) {
    const right = part.measures[i]?.right || {},
      next = (!lineEnd && part.measures[i + 1]?.left) || {};
    let token =
      right.backward && next.forward
        ? '::'
        : next.forward
          ? '|:'
          : right.backward
            ? ':|'
            : {
                'light-light': '||',
                'light-heavy': '|]',
                'heavy-light': '[|',
                'heavy-heavy': '|]',
                dotted: '.|',
                dashed: '.|',
                none: '[|]'
              }[right.style] || '|';
    if (right.endingStop && token === '|' && !part.measures[i + 1]?.left.ending) token = '||';
    return ' ' + token + (next.ending ? '[' + next.ending : '') + ' ';
  }
  // A measure of one voice: its key, meter and clef changes, then each note, chord or rest with what goes on it.
  function measureText(v, i) {
    const st = v.state,
      changes = (v.part.measures[i]?.changes || []).filter(c => applies(c, v)),
      items = v.items[i];
    st.bar = new Map();
    const out = [];
    tuplets(items);
    items.forEach((x, k) => {
      let text = '';
      for (const c of changes.filter(c => c.t <= x.t && !c.done?.has(v))) {
        (c.done ??= new Set()).add(v);
        if (c.type === 'key' && mxiKeyText(c.key) !== st.key) {
          st.key = mxiKeyText(c.key);
          st.alters = mxiKeyAlters(c.key);
          text += `[K:${st.key}] `;
        } else if (c.type === 'meter' && c.text !== st.meter) {
          st.meter = c.text;
          st.beat = beatOf(c);
          text += `[M:${st.meter}] `;
        } else if (c.type === 'clef' && c.text !== st.clef) {
          // The clef alone: this voice's line has named its key whenever another voice could change it, and a key
          // here would draw the key signature again after the clef.
          st.clef = c.text;
          text += `[K:clef=${st.clef}] `;
        }
      }
      text += x.inline.map(f => f + ' ').join('');
      text += itemText(v, x);
      const next = items[k + 1],
        beamed = !x.rest && x.notated < 1 / 4 && next && !next.rest && next.notated < 1 / 4;
      out.push(
        text +
          (beamed &&
          (v.part.beams
            ? x.beam === 'begin' || x.beam === 'continue'
            : Math.floor(whole(x.t) / st.beat + 1e-9) === Math.floor(whole(next.t) / st.beat + 1e-9))
            ? ''
            : ' ')
      );
    });
    // Changes after the last note (a clef at the end of a bar) come at the end.
    for (const c of changes.filter(c => !c.done?.has(v))) {
      (c.done ??= new Set()).add(v);
      if (c.type === 'clef' && c.text !== st.clef) out.push(`[K:clef=${(st.clef = c.text)}]`);
      else if (c.type === 'key' && mxiKeyText(c.key) !== st.key) {
        st.key = mxiKeyText(c.key);
        st.alters = mxiKeyAlters(c.key);
        out.push(`[K:${st.key}]`);
      } else if (c.type === 'meter' && c.text !== st.meter) {
        st.meter = c.text;
        st.beat = beatOf(c);
        out.push(`[M:${st.meter}]`);
      }
    }
    return ' ' + out.join('').trim();
  }
  // Notes with a time modification form a tuplet until the bracket stops or the ratio changes; (p:q:r counts them.
  function tuplets(items) {
    const flag = (x, type) => x.notations?.some(n => xmlKids(n, 'tuplet').some(t => t.getAttribute('type') === type));
    for (const x of items) {
      x.notated = x.gap ? whole(x.ticks) : whole(x.ticks) * (x.ratio ? x.ratio.actual / x.ratio.normal : 1);
      if (!x.gap && x.type && !x.measureRest && !mxlPieces(x.notated)) x.notated = x.type;
      x.pieces = mxlPieces(x.notated) || [x.notated];
    }
    for (let k = 0; k < items.length; k++) {
      const x = items[k];
      if (!x.ratio) continue;
      let j = k;
      while (
        !flag(items[j], 'stop') &&
        items[j + 1]?.ratio?.actual === x.ratio.actual &&
        items[j + 1].ratio.normal === x.ratio.normal &&
        !flag(items[j + 1], 'start')
      )
        j++;
      x.tuplet = `(${x.ratio.actual}:${x.ratio.normal}:${items.slice(k, j + 1).reduce((n, y) => n + y.pieces.length, 0)}`;
      k = j;
    }
  }
  // A pitch as ABC spells it in this bar: an accidental lasts to the bar line at that octave, a tie carries the
  // tied-from note's accidental over the bar line, and otherwise the key signature applies.
  function pitchText(p, shift, st, carried) {
    const octave = Math.max(0, Math.min(9, p.octave - shift)),
      id = p.step + octave;
    let acc = '';
    if (carried !== p.alter) {
      const effective = st.bar.has(id) ? st.bar.get(id) : st.alters[p.step] || 0;
      if (p.alter !== effective || p.shown) {
        acc = MXI_ACC[p.alter] ?? '';
        st.bar.set(id, p.alter);
      }
    }
    return {
      id,
      text: acc + (octave >= 5 ? p.step.toLowerCase() + "'".repeat(octave - 5) : p.step + ','.repeat(4 - octave))
    };
  }
  function itemText(v, x) {
    const st = v.state,
      len = value => lengthText(value * 8);
    if (x.gap || x.rest) {
      st.tied = new Map();
      lyricTokens(v, x, 0);
      const r = x.gap ? (x.shown ? 'z' : 'x') : x.hidden ? 'x' : 'z',
        {pre, open, close} = marks(v, x);
      return (
        (x.tuplet || '') +
        x.chords.map(c => `"${c}"`).join('') +
        [...x.pre, ...pre].join('') +
        open +
        x.pieces.map(piece => r + len(piece)).join(' ') +
        close
      );
    }
    const {pre, open, close} = marks(v, x),
      graces = x.graces.length
        ? '{' +
          (x.graces[0].grace.slash ? '/' : '') +
          x.graces.map(g => pitchText(g.pitches[0], g.shift, st).text + len(g.type || 1 / 8)).join('') +
          '}'
        : '',
      spelled = x.pitches.map(p => ({
        ...pitchText(
          p,
          x.shift,
          st,
          p.tieStop ? st.tied.get(p.step + Math.max(0, Math.min(9, p.octave - x.shift))) : undefined
        ),
        p
      }));
    st.tied = new Map(spelled.filter(s => s.p.tieStart).map(s => [s.id, s.p.alter]));
    lyricTokens(v, x, x.pieces.length);
    const last = x.pieces.length - 1;
    return (
      (x.tuplet || '') +
      x.chords.map(c => `"${c}"`).join('') +
      [...x.pre, ...pre].join('') +
      graces +
      open +
      x.pieces
        .map((piece, k) => {
          const tie = s => (k < last || s.p.tieStart ? '-' : ''),
            // Later pieces are tied on from the first, so they need no accidental of their own.
            names = spelled.map(s => (k ? s.text.replace(/^[_^=]+/, '') : s.text));
          return spelled.length > 1
            ? '[' + spelled.map((s, n) => names[n] + tie(s)).join('') + ']' + len(piece)
            : names[0] + len(piece) + tie(spelled[0]);
        })
        .join(' ') +
      close
    );
  }
  // Slurs, articulations, ornaments, fermatas and the like from a note's <notations>.
  function marks(v, x) {
    const pre = [];
    let open = '',
      close = '';
    for (const n of x.notations || [])
      for (const c of xmlChildren(n)) {
        const name = c.localName,
          type = c.getAttribute('type');
        if (name === 'slur') {
          const number = c.getAttribute('number') || '1';
          if (type === 'start' && !v.state.slurs.get(number)) {
            v.state.slurs.set(number, true);
            open += '(';
          } else if (type === 'stop' && v.state.slurs.get(number)) {
            v.state.slurs.delete(number);
            close += ')';
          }
        } else if (name === 'articulations' || name === 'ornaments' || name === 'technical') {
          // A trill line is written as a trill mark with a wavy line (MuseScore does the same); it comes back as the
          // line alone, which draws the tr itself and plays as written.
          const trillLine = xmlChildren(c).some(a => a.localName === 'wavy-line' && a.getAttribute('type') === 'start');
          for (const a of xmlChildren(c)) {
            if (trillLine && a.localName === 'trill-mark') continue;
            const mark = {articulations: MXI_ARTICULATIONS, ornaments: MXI_ORNAMENTS, technical: MXI_TECHNICAL}[name][
              a.localName
            ];
            if (mark) pre.push(mark);
            else if (a.localName === 'wavy-line') {
              const t = a.getAttribute('type');
              if (t === 'start') pre.push('!trill(!');
              else if (t === 'stop') pre.push('!trill)!');
            } else if (a.localName === 'fingering' && /^[0-5]$/.test(a.textContent.trim()))
              pre.push(`!${a.textContent.trim()}!`);
            else if (!/^(accidental-mark|other-articulation|other-ornament|other-technical)$/.test(a.localName))
              skip(a.localName);
          }
        } else if (name === 'fermata') pre.push(type === 'inverted' ? '!invertedfermata!' : '!fermata!');
        else if (name === 'arpeggiate') pre.push('!arpeggio!');
        else if (name === 'glissando' || name === 'slide') {
          if (type === 'start') pre.push('!glissando(!');
          else if (type === 'stop') pre.push('!glissando)!');
        } else if (name === 'dynamics')
          for (const d of xmlChildren(c))
            pre.push(
              MXI_DYNAMICS.has(d.localName)
                ? `!${d.localName}!`
                : MXI_ACCENTS.has(d.localName)
                  ? '!sfz!'
                  : `"_${abcQuoted(d.textContent || d.localName)}"`
            );
        else if (!/^(tied|tuplet|accidental-mark|other-notation|non-arpeggiate)$/.test(name)) skip(name);
      }
    return {pre: [...new Set(pre)], open, close};
  }
  // w: tokens: a syllable (with - inside a word or _ for a melisma), _ to hold it over the next note, * to skip one.
  // ABC aligns lyrics to notes, not rests, and each tied piece is a note.
  function lyricTokens(v, x, notes) {
    v.lyrics.forEach((tokens, n) => {
      const verse = n + 1,
        l = x.lyric?.get(verse);
      if (!notes) {
        if (x.lyric) v.state.hold.delete(verse);
        return;
      }
      for (let k = 0; k < notes; k++)
        if (l && !k) {
          const word = /^(begin|middle)$/.test(l.syllabic);
          tokens.push((l.text || '*') + (word ? '-' : l.extend ? '_' : ''));
          v.state.hold.set(verse, l.extend);
        } else tokens.push(v.state.hold.get(verse) ? '_' : '*');
    });
  }

  // One part: its measures, each with the events of every staff:voice, the directions to place, the key, meter and
  // clef changes, and the bar lines.
  function readPart(info, pi) {
    let divTicks = ticks,
      staves = 1,
      transpose = null,
      transposed = null,
      hasNotes = false,
      beams = false,
      lastNote = null;
    const clefShift = {},
      tabStaves = new Set(),
      voiceOrder = new Map(),
      measures = [];
    for (const [mi, {el, measure}] of info.measures.entries()) {
      const m = {
        voices: new Map(),
        marks: [],
        changes: [],
        left: {},
        right: {},
        length: 0,
        newSystem: xmlKids(el, 'print').some(
          p => p.getAttribute('new-system') === 'yes' || p.getAttribute('new-page') === 'yes'
        )
      };
      measures.push(m);
      let t = 0;
      const offset = child => t + Math.round((+xmlValue(child, 'offset') || 0) * divTicks);
      for (const child of xmlChildren(el)) {
        const name = child.localName;
        if (name === 'attributes') attributes(child, m, t);
        else if (name === 'note') t += note(child, m, t);
        else if (name === 'backup') t = Math.max(0, t - Math.round((+xmlValue(child, 'duration') || 0) * divTicks));
        else if (name === 'forward') t += Math.max(0, Math.round((+xmlValue(child, 'duration') || 0) * divTicks));
        else if (name === 'direction') direction(child, m, offset(child), mi);
        else if (name === 'harmony') harmony(child, m, offset(child));
        else if (name === 'sound') {
          readSwing(child);
          if (+child.getAttribute('tempo') > 0)
            tempos.push({measure: mi, t, part: pi, q: mxiTempo([], null, +child.getAttribute('tempo'))});
        } else if (name === 'figured-bass') skip(name);
        else if (name === 'barline') barline(child, m);
        m.length = Math.max(m.length, t);
      }
    }
    const allTab = tabStaves.size >= staves;
    return {
      info,
      measures,
      hasNotes,
      beams,
      staves,
      transposed,
      voiceOrder,
      tabOnly: allTab,
      dropStaves: allTab ? new Set() : tabStaves
    };

    function attributes(el, m, t) {
      for (const child of xmlChildren(el)) {
        const name = child.localName;
        if (name === 'divisions' && Math.round(+child.textContent) > 0)
          divTicks = ticks / Math.round(+child.textContent);
        else if (name === 'staves') staves = Math.max(1, Math.min(8, Math.round(+child.textContent) || 1));
        else if (name === 'transpose' && !(+child.getAttribute('number') > 1)) {
          // No instrument is written more than a few octaves from its sound; larger values come from a damaged file.
          const amount = (field, limit) => Math.max(-limit, Math.min(limit, Math.round(+xmlValue(child, field) || 0))),
            octave = amount('octave-change', 4),
            diatonic = amount('diatonic', 48) + 7 * octave,
            chromatic = amount('chromatic', 48) + 12 * octave;
          transpose = diatonic || chromatic ? {diatonic, chromatic} : null;
          transposed ??= chromatic;
          // A key given earlier in this measure was written for the old transposition.
          for (const c of m.changes) if (c.type === 'key') c.key = concertKey(c.written);
        } else if (name === 'key') {
          const written = readKey(child);
          m.changes.push({
            t,
            type: 'key',
            staff: +child.getAttribute('number') || 0,
            written,
            key: concertKey(written)
          });
        } else if (name === 'time') {
          const meter = mxiMeter(child);
          if (meter?.mixed) skip('time-mix');
          if (meter) m.changes.push({t, type: 'meter', ...meter});
        } else if (name === 'clef') {
          const staff = +child.getAttribute('number') || 1,
            clef = mxiClef(child);
          clefShift[staff] = clef.shift;
          if (clef.tab) tabStaves.add(staff);
          else m.changes.push({t, type: 'clef', staff, text: clef.name});
        } else if (name === 'measure-style' && xmlKid(child, 'slash')) skip('slash');
      }
    }
    function readKey(el) {
      if (xmlKid(el, 'fifths'))
        return {
          fifths: Math.max(-7, Math.min(7, Math.round(+xmlValue(el, 'fifths') || 0))),
          mode: MXI_MODES[xmlValue(el, 'mode').toLowerCase()] ?? ''
        };
      const alters = xmlKids(el, 'key-alter');
      return {
        steps: xmlKids(el, 'key-step')
          .map((s, i) => [
            s.textContent.trim().toUpperCase(),
            Math.max(-2, Math.min(2, Math.round(+alters[i]?.textContent || 0)))
          ])
          .filter(([step]) => MXI_STEPS.includes(step) && step.length === 1)
      };
    }
    // A transposing part's written key at concert pitch: a semitone up adds seven fifths, a letter up takes twelve. A
    // key past seven sharps or flats goes twelve fifths round the circle, to its enharmonic key.
    function concertKey(key) {
      if (!transpose) return key;
      if (key.steps)
        return {
          steps: key.steps.map(([step, alter]) => {
            const p = mxiTranspose({step, alter, octave: 4}, transpose.diatonic, transpose.chromatic);
            return [p.step, p.alter];
          })
        };
      const fifths = key.fifths + 7 * transpose.chromatic - 12 * transpose.diatonic;
      return {
        fifths: fifths > 7 ? posMod(fifths - 8, 12) - 4 : fifths < -7 ? 4 - posMod(-8 - fifths, 12) : fifths,
        mode: key.mode
      };
    }
    // A note: returns how far it moves the time on. A <chord/> note joins the note before it.
    function note(n, m, t) {
      const grace = xmlKid(n, 'grace'),
        rest = xmlKid(n, 'rest'),
        pitchEl = xmlKid(n, 'pitch') || xmlKid(n, 'unpitched'),
        cue = !!xmlKid(n, 'cue'),
        notations = xmlKids(n, 'notations'),
        type = MXI_TYPES[xmlValue(n, 'type')],
        dots = xmlKids(n, 'dot').length,
        mod = xmlKid(n, 'time-modification'),
        actual = Math.round(+xmlValue(mod, 'actual-notes')),
        normal = Math.round(+xmlValue(mod, 'normal-notes')),
        ratio = actual > 0 && normal > 0 && actual !== normal ? {actual, normal} : null,
        notated = type ? type * (2 - 1 / 2 ** dots) : 0;
      let span = grace ? 0 : Math.max(0, Math.round((+xmlValue(n, 'duration') || 0) * divTicks));
      if (!grace && !span && notated)
        span = Math.round(notated * 4 * ticks * (ratio ? ratio.normal / ratio.actual : 1));
      if (cue) skip('cue');
      const notehead = xmlValue(n, 'notehead');
      if (notehead && !/^(normal|none)$/.test(notehead)) skip('notehead');
      let pitch = null;
      if (pitchEl && !rest && !cue && n.getAttribute('print-object') !== 'no') {
        const unpitched = pitchEl.localName === 'unpitched',
          step = xmlValue(pitchEl, unpitched ? 'display-step' : 'step').toUpperCase(),
          octave = Math.round(+xmlValue(pitchEl, unpitched ? 'display-octave' : 'octave'));
        let alter = unpitched ? 0 : +xmlValue(pitchEl, 'alter') || 0;
        if (unpitched) skip('unpitched');
        if (alter !== Math.round(alter)) skip('quarter');
        if (
          step.length === 1 &&
          MXI_STEPS.includes(step) &&
          xmlValue(pitchEl, unpitched ? 'display-octave' : 'octave') !== '' &&
          Number.isFinite(octave)
        ) {
          pitch = {step, alter: Math.round(alter), octave};
          if (transpose && !unpitched) pitch = mxiTranspose(pitch, transpose.diatonic, transpose.chromatic);
          pitch.alter = Math.max(-2, Math.min(2, pitch.alter));
          const accidental = xmlKid(n, 'accidental');
          pitch.shown = !!accidental && accidental.getAttribute('print-object') !== 'no';
          const ties = [
            ...xmlKids(n, 'tie').map(x => x.getAttribute('type')),
            ...notations.flatMap(x => xmlKids(x, 'tied')).map(x => x.getAttribute('type'))
          ];
          pitch.tieStart = ties.includes('start') || ties.includes('continue');
          pitch.tieStop = ties.includes('stop') || ties.includes('continue');
        }
      }
      if (xmlKid(n, 'chord') && lastNote?.measure === m) {
        if (pitch && lastNote.pitches.length) {
          if (lastNote.grace) skip('grace-chord');
          else lastNote.pitches.push(pitch);
        }
        lastNote.notations.push(...notations);
        lyrics(n, lastNote);
        return 0;
      }
      const staff = Math.max(1, Math.min(staves, Math.round(+xmlValue(n, 'staff')) || 1)),
        voice = xmlValue(n, 'voice') || '1',
        key = staff + ':' + voice;
      if (!voiceOrder.has(key)) voiceOrder.set(key, {staff, voice, order: voiceOrder.size});
      const e = {
        t,
        measure: m,
        ticks: span,
        rest: !pitch,
        hidden: n.getAttribute('print-object') === 'no' || cue || (!pitch && !rest),
        measureRest: rest?.getAttribute('measure') === 'yes',
        pitches: pitch ? [pitch] : [],
        shift: clefShift[staff] || 0,
        type: notated,
        ratio,
        grace: grace ? {slash: grace.getAttribute('slash') === 'yes'} : null,
        notations,
        beam: xmlKids(n, 'beam')
          .find(b => (b.getAttribute('number') || '1') === '1')
          ?.textContent.trim(),
        lyric: new Map(),
        pre: [],
        chords: [],
        inline: [],
        graces: []
      };
      if (e.beam) beams = true;
      if (pitch) hasNotes = true;
      // A grace note without a pitch is dropped; a rest has no grace form in ABC.
      if (!(grace && !pitch)) {
        if (!m.voices.has(key)) m.voices.set(key, []);
        m.voices.get(key).push(e);
      }
      lastNote = e;
      lyrics(n, e);
      return span;
    }
    function lyrics(n, e) {
      for (const [i, l] of xmlKids(n, 'lyric').entries()) {
        const number =
          Math.round(+l.getAttribute('number')) || +(/\d+/.exec(l.getAttribute('name') || '')?.[0] || 0) || i + 1;
        if (number > 8) skip('verses');
        if (e.lyric.has(number) || number > 8 || number < 1) continue;
        e.lyric.set(number, {
          text: xmlKids(l, 'text')
            .map(x =>
              x.textContent
                .trim()
                .replace(/[\\_*|~%"]/g, '')
                .replace(/-/g, '\\-')
                .replace(/\s+/g, '~')
            )
            .filter(Boolean)
            .join('~'),
          syllabic: xmlValue(l, 'syllabic') || 'single',
          extend: xmlKid(l, 'extend')?.getAttribute('type') !== 'stop' && !!xmlKid(l, 'extend')
        });
      }
    }
    function mark(m, t, el, item) {
      const staff = Math.max(1, Math.min(staves, Math.round(+xmlValue(el, 'staff')) || 1));
      m.marks.push({t, staff, voice: xmlValue(el, 'voice'), ...item});
    }
    function direction(el, m, t, mi) {
      const placement = el.getAttribute('placement'),
        sound = xmlKid(el, 'sound'),
        speed = +sound?.getAttribute('tempo') || 0,
        words = [];
      readSwing(sound);
      let metronome = null;
      for (const type of xmlKids(el, 'direction-type'))
        for (const d of xmlChildren(type)) {
          const name = d.localName;
          if (name === 'dynamics')
            for (const dyn of xmlChildren(d)) {
              const value = dyn.localName === 'other-dynamics' ? dyn.textContent.trim() : dyn.localName;
              if (value)
                mark(m, t, el, {
                  pre: MXI_DYNAMICS.has(value)
                    ? `!${value}!`
                    : MXI_ACCENTS.has(value)
                      ? '!sfz!'
                      : `"_${abcQuoted(value)}"`
                });
            }
          else if (name === 'wedge') {
            const type = d.getAttribute('type');
            if (type === 'crescendo' || type === 'diminuendo') mark(m, t, el, {wedge: type});
            else if (type === 'stop') mark(m, t, el, {wedge: 'stop', stop: true});
          } else if (name === 'words') words.push(d.textContent);
          else if (name === 'rehearsal' && abcText(d.textContent))
            mark(m, t, el, {part: abcText(d.textContent).replace(/[\]]/g, '')});
          else if (name === 'segno') mark(m, t, el, {pre: '!segno!'});
          else if (name === 'coda') mark(m, t, el, {pre: '!coda!'});
          else if (name === 'metronome') metronome = d;
          else if (
            !/^(other-direction|swing|staff-divide|eyeglasses|damp|damp-all|principal-voice|scordatura|rehearsal)$/.test(
              name
            )
          )
            skip(name);
        }
      // Words beside a metronome mark or a playback tempo are the tempo's text.
      if (metronome || speed) {
        const q = mxiTempo(words, metronome, speed);
        if (q) tempos.push({measure: mi, t, part: pi, q});
        if (metronome || words.length) return;
      }
      for (const w of words) {
        const text = abcQuoted(w);
        if (text)
          mark(m, t, el, {pre: MXI_WORDS[text.toLowerCase()] || `"${placement === 'below' ? '_' : '^'}${text}"`});
      }
    }
    function harmony(el, m, t) {
      const rootEl = xmlKid(el, 'root'),
        step = xmlValue(rootEl, 'root-step').toUpperCase(),
        kind = xmlKid(el, 'kind'),
        kindValue = kind?.textContent.trim() || '';
      if (kindValue === 'none') return mark(m, t, el, {chord: 'N.C.'});
      if (step.length !== 1 || !MXI_STEPS.includes(step)) return;
      const spell = (s, alter) => {
        let p = {step: s, alter: Math.max(-2, Math.min(2, Math.round(+alter || 0))), octave: 4};
        if (transpose) p = mxiTranspose(p, transpose.diatonic, transpose.chromatic);
        const sharps = Math.max(-2, Math.min(2, p.alter));
        return p.step + (sharps > 0 ? '#'.repeat(sharps) : 'b'.repeat(-sharps));
      };
      let suffix = kind?.hasAttribute('text') ? kind.getAttribute('text') : (MXI_KINDS[kindValue] ?? '');
      if (!kind?.hasAttribute('text'))
        for (const d of xmlKids(el, 'degree')) {
          const value = xmlValue(d, 'degree-value'),
            alter = +xmlValue(d, 'degree-alter') || 0,
            sign = alter > 0 ? '#' : alter < 0 ? 'b' : '',
            type = xmlValue(d, 'degree-type');
          suffix += type === 'subtract' ? `no${value}` : type === 'alter' ? sign + value : `add${sign}${value}`;
        }
      const bass = xmlKid(el, 'bass'),
        bassStep = xmlValue(bass, 'bass-step').toUpperCase();
      mark(m, t, el, {
        chord: abcQuoted(
          spell(step, xmlValue(rootEl, 'root-alter')) +
            suffix +
            (bass && MXI_STEPS.includes(bassStep) && bassStep.length === 1
              ? '/' + spell(bassStep, xmlValue(bass, 'bass-alter'))
              : '')
        )
      });
    }
    function barline(el, m) {
      const location = el.getAttribute('location') || 'right';
      if (location === 'middle') return;
      const side = location === 'left' ? m.left : m.right,
        style = xmlValue(el, 'bar-style'),
        repeat = xmlKid(el, 'repeat'),
        ending = xmlKid(el, 'ending');
      if (style) side.style = style;
      if (repeat) {
        side[repeat.getAttribute('direction') === 'forward' ? 'forward' : 'backward'] = true;
        const times = +repeat.getAttribute('times');
        if (times && times !== 2 && !ending) skip('repeat');
      }
      if (ending) {
        const numbers = (ending.getAttribute('number') || '').match(/\d+/g)?.join(',');
        if (ending.getAttribute('type') === 'start') m.left.ending = numbers || '1';
        else m.right.endingStop = true;
      }
    }
  }
}

// Reading a chosen file. MusicXML bytes become text by their byte-order mark (UTF-16) or the encoding their XML
// declaration names, UTF-8 otherwise.
function musicXMLText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/.exec(
    String.fromCharCode(...bytes.subarray(0, 200))
  )?.[1];
  try {
    return new TextDecoder(declared || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
// A compressed .mxl file is a zip archive whose META-INF/container.xml names the score. This reads the archive's
// central directory and inflates the score with the browser's DecompressionStream; nothing leaves the device.
const MXL_UNZIPPED_LIMIT = 30 * 1024 * 1024,
  MXL_DAMAGED = 'This .mxl file could not be opened. It may be damaged.';
async function mxlInflate(data) {
  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    throw Error(
      'This browser can’t open compressed .mxl files. Export the score as uncompressed MusicXML (.musicxml) and open that.'
    );
  }
  const writer = stream.writable.getWriter(),
    reader = stream.readable.getReader(),
    chunks = [];
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MXL_UNZIPPED_LIMIT) {
        reader.cancel().catch(() => {});
        throw Error('This .mxl file holds more music than FretFree can open.');
      }
      chunks.push(value);
    }
  } catch (e) {
    throw /holds more/.test(e.message) ? e : Error(MXL_DAMAGED);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
async function mxlScore(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = i => view.getUint16(i, true),
    u32 = i => view.getUint32(i, true),
    entries = new Map();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557) && end < 0; i--)
    if (u32(i) === 0x06054b50) end = i;
  if (end < 0) throw Error(MXL_DAMAGED);
  for (let n = u16(end + 10), at = u32(end + 16); n > 0 && at + 46 <= bytes.length && u32(at) === 0x02014b50; n--) {
    const length = u16(at + 28);
    entries.set(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length)), {
      flags: u16(at + 8),
      method: u16(at + 10),
      size: u32(at + 20),
      offset: u32(at + 42)
    });
    at += 46 + length + u16(at + 30) + u16(at + 32);
  }
  const read = name => {
    const e = entries.get(name);
    if (e.flags & 1) throw Error('This .mxl file is password-protected, so it can’t be opened.');
    if (e.offset + 30 > bytes.length || u32(e.offset) !== 0x04034b50) throw Error(MXL_DAMAGED);
    const start = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28),
      data = bytes.subarray(start, start + e.size);
    if (data.length < e.size || (e.method !== 0 && e.method !== 8)) throw Error(MXL_DAMAGED);
    return e.method ? mxlInflate(data) : data;
  };
  // The first rootfile is the score; without a container, the first MusicXML file in the archive.
  const container = entries.has('META-INF/container.xml') ? musicXMLText(await read('META-INF/container.xml')) : '',
    named = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1]?.replace(/&amp;/g, '&'),
    path = entries.has(named)
      ? named
      : [...entries.keys()].find(k => !k.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(k));
  if (!path) throw Error('This .mxl file has no MusicXML score inside.');
  return read(path);
}
// A chosen File: compressed or not (by its first bytes, whatever its extension), then converted.
async function readMusicXMLFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = musicXMLText(zipped ? await mxlScore(bytes) : bytes);
  return musicXMLToABC(new DOMParser().parseFromString(text, 'application/xml'), {name: file.name});
}
