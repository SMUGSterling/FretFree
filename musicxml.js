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
    .replace(/[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
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
// Clef sign, line and octave shift. abcjs plays treble-8 an octave below the written letters, so the shift also moves
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
    types = [];
  if (words.length) types.push(`<words>${xmlText(words.join(' '))}</words>`);
  if (unit && t.bpm)
    types.push(
      `<metronome><beat-unit>${unit.type}</beat-unit>${'<beat-unit-dot/>'.repeat(unit.dots)}` +
        `<per-minute>${xmlText(t.bpm)}</per-minute></metronome>`
    );
  else if (t.bpm) types.push(`<words>${xmlText('♩ = ' + t.bpm)}</words>`);
  return types.length
    ? {types, sound: t.bpm > 0 && total ? `<sound tempo="${+(t.bpm * total * 4).toFixed(2)}"/>` : ''}
    : null;
};
const mxlBlank = () => ({content: [], length: 0, notes: false, left: {}, right: {}});

function abcToMusicXML(source, meta = {}) {
  const tune = ABCJS.parseOnly(source)[0];
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
  // Divisions per quarter note: the least common multiple of every sounding length's denominator.
  let divisions = 1;
  for (const voice of voices) {
    let tuplet = 1;
    for (const e of voice) {
      if (e.el_type !== 'note') continue;
      if (e.startTriplet) tuplet = e.tripletMultiplier || 1;
      const d = e.duration > 0 ? mxlFraction(e.duration * tuplet * 4)[1] : 1;
      divisions = Math.min((divisions / mxlGcd(divisions, d)) * d, 100000);
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
      octave = 0,
      clefType = '',
      meter = null,
      meterSig = '',
      carried = new Map(),
      tuplet = null,
      inBeam = false,
      ending = null,
      wavy = false;
    const tieAlters = new Map(),
      slurs = new Map(),
      slurNumbers = new Set(),
      lyricOpen = [];
    const open = () => (m ??= mxlBlank()),
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
      // Like abcjs playback, an inline clef without -8/+8 keeps the octave shift until the next line's clef.
      setClef = (type, inline) => {
        clef = mxlClef(type);
        if (!inline || clef.shift) octave = clef.shift;
        if (first && clefOwner && type !== clefType) attributes(mxlClefXML(clef, pv.staffNo));
        clefType = type;
      },
      setMeter = mt => {
        const sig = mxlTime(mt);
        meter = mt;
        if (first && leads && sig && sig !== meterSig) attributes(sig);
        meterSig = sig;
      },
      // Pitch as ABC spells it: an accidental lasts to the bar line at that octave, a tie carries it over the bar,
      // and otherwise the key signature applies.
      spell = (p, endTie) => {
        const step = 'CDEFGAB'[((p.pitch % 7) + 7) % 7],
          explicit = p.accidental in MXL_ALTER;
        if (explicit) carried.set(p.pitch, MXL_ALTER[p.accidental]);
        const alter = explicit
          ? MXL_ALTER[p.accidental]
          : endTie && tieAlters.has(p.pitch)
            ? tieAlters.get(p.pitch)
            : carried.has(p.pitch)
              ? carried.get(p.pitch)
              : key[step] || 0;
        return {
          alter,
          pitch:
            `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}` +
            `<octave>${4 + Math.floor(p.pitch / 7) + octave}</octave></pitch>`,
          accidental: explicit ? `<accidental>${MXL_ACCIDENTAL[p.accidental]}</accidental>` : ''
        };
      },
      typeXML = length => {
        const t = mxlType(length);
        return t ? `<type>${t.type}</type>` + '<dot/>'.repeat(t.dots) : '';
      },
      tempo = t => {
        const mark = mxlMetronome(t);
        if (mark) direction(mark.types, 'above', mark.sound);
      };
    for (const [li, line] of tune.lines.entries()) {
      const staff = line.staff?.[pv.s],
        voice = staff?.voices[pv.v];
      if (!voice) continue;
      if (!first) {
        setKey(staff.key);
        setClef(staff.clef?.type || 'treble');
        setMeter(staff.meter);
        first = {line: li, key: keySig, clef, meter: meterSig, length: meterLength()};
        // A voice that first appears on a later line starts in the measure the others have reached.
        pad(lineStarts[li] || 0);
        if (firstOfScore && tune.metaText?.tempo) tempo(tune.metaText.tempo);
      } else {
        if (staff.key) setKey(staff.key);
        if (staff.clef?.type) setClef(staff.clef.type);
        if (staff.meter) setMeter(staff.meter);
        pad(lineStarts[li] || 0);
      }
      if (!m?.notes && li > first.line) open().newSystem = true;
      lineStarts[li] = Math.max(lineStarts[li] || 0, measures.length);
      for (const e of voice) {
        if (e.el_type === 'key') setKey(e);
        else if (e.el_type === 'clef') setClef(e.type, true);
        else if (e.el_type === 'meter') setMeter(e);
        else if (e.el_type === 'tempo' && leads) tempo(e);
        else if (e.el_type === 'part' && leads) direction(`<rehearsal>${xmlText(e.title)}</rehearsal>`);
        else if (e.el_type === 'bar') bar(e);
        else if (e.el_type === 'note') note(e);
      }
    }
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
        // Z4 is four bars of rest: four measures, drawn as one multi-bar rest.
        const count = Math.max(1, Math.round(+e.rest.text) || 1),
          each = dur(meterLength() || e.duration / count),
          hidden = rest === 'multimeasure' ? '' : ' print-object="no"';
        if (count > 1 && leads) attributes(`<measure-style><multiple-rest>${count}</multiple-rest></measure-style>`);
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
      const length = dur(e.duration * (tuplet?.multiplier || 1)),
        type = typeXML(e.duration),
        timeMod = tuplet
          ? `<time-modification><actual-notes>${tuplet.actual}</actual-notes>` +
            `<normal-notes>${tuplet.normal}</normal-notes></time-modification>`
          : '';
      // Slurs, the tuplet bracket, articulations and ornaments belong to the chord, so they go on its first note.
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
      if (tuplet && e.endTriplet) shared.push('<tuplet type="stop"/>');
      let arpeggio = false;
      for (const d of e.decoration || []) {
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
          beam = '<beam number="1">begin</beam>';
          inBeam = true;
        } else if (inBeam && e.endBeam) {
          beam = '<beam number="1">end</beam>';
          inBeam = false;
        } else if (inBeam) beam = '<beam number="1">continue</beam>';
      } else if (!rest) inBeam = false;
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
        const {pitch, accidental} = spell(g, false);
        measure.content.push(
          `<note><grace${g.acciaccatura ? ' slash="yes"' : ''}/>${pitch}${voiceTag}` +
            `${typeXML(g.duration) || '<type>eighth</type>'}${accidental}${staffTag}</note>`
        );
      }
      if (rest || !pitches.length)
        measure.content.push(
          `<note${rest === 'invisible' ? ' print-object="no"' : ''}><rest/><duration>${length}</duration>` +
            `${voiceTag}${type}${timeMod}${staffTag}` +
            (shared.length ? `<notations>${shared.join('')}</notations>` : '') +
            '</note>'
        );
      else
        for (const [i, p] of pitches.entries()) {
          const {pitch, accidental, alter} = spell(p, p.endTie),
            ties = [...(p.endTie ? ['stop'] : []), ...(p.startTie ? ['start'] : [])];
          if (p.startTie) tieAlters.set(p.pitch, alter);
          else if (p.endTie) tieAlters.delete(p.pitch);
          const notations = [
            ...ties.map(t => `<tied type="${t}"/>`),
            ...(i ? [] : shared),
            ...(arpeggio ? ['<arpeggiate/>'] : [])
          ];
          measure.content.push(
            `<note>${i ? '<chord/>' : ''}${pitch}<duration>${length}</duration>` +
              ties.map(t => `<tie type="${t}"/>`).join('') +
              `${voiceTag}${type}${accidental}${timeMod}${staffTag}${i ? '' : beam}` +
              (notations.length ? `<notations>${notations.join('')}</notations>` : '') +
              (i ? '' : lyrics.join('')) +
              '</note>'
          );
        }
      measure.length += length;
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
          '</attributes>';
      if (bars.left.forward || bars.left.ending)
        xml +=
          '<barline location="left">' +
          (bars.left.forward ? '<bar-style>heavy-light</bar-style>' : '') +
          (bars.left.ending
            ? `<ending number="${bars.left.ending.number}" type="start">${xmlText(bars.left.ending.text)}.</ending>`
            : '') +
          (bars.left.forward ? '<repeat direction="forward"/>' : '') +
          '</barline>';
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
          (r.style ? `<bar-style>${r.style}</bar-style>` : '') +
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
    gpl = credit && scoreLicense(item).startsWith('GPL-') && typeof GPL_LICENSE === 'string',
    metadata = {...item},
    date = meta.date || new Date().toISOString().slice(0, 10);
  delete metadata.abc;
  // Part names come from V: name=; a braced group takes its top staff's, and voices sharing a staff list theirs.
  const partList = parts.map((part, i) => {
    const name =
      [...new Set((staffInfo.get(part.staffs[0]).staff.title || []).filter(Boolean))].join(', ') ||
      (parts.length === 1 ? meta.instrument || 'Music' : 'Part ' + (i + 1));
    return `<score-part id="P${i + 1}">${xmlTag('part-name', name)}</score-part>`;
  });
  const credits = [
    ['title', title, 'default-x="612" default-y="1504" justify="center" valign="top" font-size="22"'],
    composer && ['composer', composer, 'default-x="1140" default-y="1424" justify="right" valign="bottom"'],
    credit && ['rights', credit, 'default-x="612" default-y="80" justify="center" valign="bottom" font-size="7"']
  ].filter(Boolean);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0">\n' +
    `<work>${xmlTag('work-title', title)}</work>\n` +
    '<identification>' +
    (composer ? xmlTag('creator', composer, ' type="composer"') : '') +
    (credit ? xmlTag('rights', credit) : '') +
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
            xmlTag('miscellaneous-field', creditedABC(source, item), ' name="fretfree-abc-source"')
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
