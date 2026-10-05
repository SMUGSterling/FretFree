#!/usr/bin/env python3
"""Import single-line practice parts from OpenScore corpora (CC0) into FretFree.

Usage: python3 scripts/import-openscore.py lieder   /path/to/Lieder-clone
       python3 scripts/import-openscore.py quartets /path/to/StringQuartets-clone

Reads every MuseScore .mscx file, takes one staff's first voice (the top vocal staff for Lieder, Violin 1 for
quartets), and writes it as single-line ABC: pitch spelling from MuseScore's tonal pitch class, durations, dots,
ties, tuplets, repeats and first/second endings, key and meter changes, and the opening tempo. Other staffs,
lyrics, grace notes, dynamics and other markings are omitted. Leading and trailing bars of silence are trimmed.
Quartets are split into movements at section breaks, or where a final barline is followed by a new tempo marking.
Each candidate is then checked by scripts/validate-candidates.cjs (abcjs parse, MIDI, transposition) and only
accepted rows are written to the profile's catalog file, with rights metadata appended to catalog-rights.json and
counts to scripts/library-stats.json. Exclusions are listed per profile in scripts/<profile>-exclusions.json.
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import date
from fractions import Fraction

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'

DURATIONS = {
    'breve': Fraction(2), 'whole': Fraction(1), 'half': Fraction(1, 2), 'quarter': Fraction(1, 4),
    'eighth': Fraction(1, 8), '16th': Fraction(1, 16), '32nd': Fraction(1, 32), '64th': Fraction(1, 64),
    '128th': Fraction(1, 128),
}
GRACE_TAGS = {'acciaccatura', 'appoggiatura', 'grace4', 'grace8', 'grace16', 'grace32', 'grace8after', 'grace16after', 'grace32after'}
MAJOR_KEYS = {-7: 'Cb', -6: 'Gb', -5: 'Db', -4: 'Ab', -3: 'Eb', -2: 'Bb', -1: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#'}
MINOR_KEYS = {-7: 'Abm', -6: 'Ebm', -5: 'Bbm', -4: 'Fm', -3: 'Cm', -2: 'Gm', -1: 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m'}
SHARP_ORDER = 'FCGDAEB'
VOCAL_WORDS = ('voice', 'voix', 'singstimme', 'stimme', 'gesang', 'chant', 'canto', 'soprano', 'sopran', 'alto', 'contralto', 'tenor', 'bass', 'baritone', 'bariton', 'mezzo', 'vocal', 'singer', 'sänger')


def sig_alters(accidentals):
    """Letter -> alteration for a key signature with n sharps (positive) or flats (negative)."""
    alters = {}
    if accidentals > 0:
        for letter in SHARP_ORDER[:accidentals]:
            alters[letter] = 1
    elif accidentals < 0:
        for letter in SHARP_ORDER[::-1][:-accidentals]:
            alters[letter] = -1
    return alters


def spell(pitch, tpc):
    """MuseScore tonal pitch class -> (letter, alteration, octave)."""
    letter = SHARP_ORDER[(tpc + 1) % 7]
    alter = (tpc + 1) // 7 - 2
    octave = (pitch - alter) // 12 - 1
    return letter, alter, octave


def abc_pitch(letter, alter, octave, carried, key_alters, explicit):
    """ABC note token, writing an accidental only when the bar does not already imply it."""
    acc = ''
    implied = carried.get((letter, octave), key_alters.get(letter, 0))
    if alter != implied or explicit:
        acc = {-2: '__', -1: '_', 0: '=', 1: '^', 2: '^^'}[alter]
    carried[(letter, octave)] = alter
    if octave >= 5:
        token = letter.lower() + "'" * (octave - 5)
    else:
        token = letter + ',' * (4 - octave)
    return acc + token


def abc_length(value, unit):
    """Duration as a multiple of the unit note length: 1 -> '', 2 -> '2', 1/2 -> '/2', 3/2 -> '3/2'."""
    f = Fraction(value) / unit
    if f == 1:
        return ''
    if f.denominator == 1:
        return str(f.numerator)
    if f.numerator == 1:
        return '/' + str(f.denominator) if f.denominator != 2 else '/'
    return f'{f.numerator}/{f.denominator}'


def split_duration(value, unit):
    """Break a duration into pieces abcjs can draw: unit multiples of the form 2^k x (1, 3/2 or 7/4), largest first."""
    pieces = []
    remaining = Fraction(value)
    shapes = sorted({Fraction(2) ** k * m for k in range(-2, 6) for m in (Fraction(1), Fraction(3, 2), Fraction(7, 4))}, reverse=True)
    while remaining > 0:
        for shape in shapes:
            piece = shape * unit
            if piece <= remaining:
                pieces.append(piece)
                remaining -= piece
                break
        else:
            pieces.append(remaining)
            remaining = Fraction(0)
    return pieces


def text_of(el, path, default=''):
    found = el.find(path)
    return (found.text or '').strip() if found is not None and found.text else default


# Metronome marks in MuseScore text are <sym> glyphs; name the common ones so a title can read "Allegro (♩ = 76)".
SMUFL_GLYPHS = str.maketrans({'\uECA2': '𝅝', '\uECA3': '𝅗𝅥', '\uECA5': '♩', '\uECA7': '♪', '\uECA9': '𝅘𝅥𝅯', '\uECB7': '.'})
METRONOME_GLYPHS = {'metNoteWhole': '𝅝', 'metNoteHalfUp': '𝅗𝅥', 'metNoteQuarterUp': '♩', 'metNote8thUp': '♪', 'metNote16thUp': '𝅘𝅥𝅯', 'metAugmentationDot': '.'}


def tempo_label(text_el):
    """Plain text of a MuseScore tempo marking, with metronome glyphs named and markup removed."""
    if text_el is None:
        return ''
    # MuseScore stores the marking's markup as text, so <sym> tags arrive escaped inside the text node.
    raw = ''.join(text_el.itertext())
    raw = re.sub(r'<sym>(\w+)</sym>', lambda m: METRONOME_GLYPHS.get(m.group(1), ''), raw)
    raw = re.sub(r'<[^>]+>', '', raw)
    # Glyphs typed in the ScoreText font are SMuFL private-use characters; name the metronome notes, drop the rest.
    raw = raw.translate(SMUFL_GLYPHS)
    raw = re.sub(r'[\ue000-\uf8ff]', '', raw)
    return re.sub(r'\s+', ' ', raw).strip(' .,;:-–')


class Voice:
    """The playable events of one staff's first voice, measure by measure."""

    def __init__(self, staff, version):
        self.measures = []
        key = 0
        meter = (4, 4)
        tempo = None
        for m in staff.findall('Measure'):
            voice = m.find('voice')
            container = voice if voice is not None else m
            events = []
            for el in container:
                tag = el.tag
                if tag == 'KeySig':
                    key = int(text_of(el, 'accidental', '0') or 0)
                    events.append(('key', key))
                elif tag == 'TimeSig':
                    meter = (int(text_of(el, 'sigN', '4')), int(text_of(el, 'sigD', '4')))
                    events.append(('meter', meter))
                elif tag == 'Tempo':
                    try:
                        value = float(text_of(el, 'tempo', '2'))
                    except ValueError:
                        value = None
                    events.append(('tempo', (value, tempo_label(el.find('text')))))
                    if tempo is None:
                        tempo = value
                elif tag in ('Chord', 'Rest'):
                    events.append(('note', el))
                elif tag == 'Tuplet':
                    events.append(('tuplet', el))
                elif tag == 'endTuplet':
                    events.append(('endtuplet', None))
                elif tag == 'Spanner' and el.get('type') == 'Volta' and el.find('Volta') is not None:
                    # Ending numbers 1-9 only: MuseScore sometimes stores 0 or a long list; abcjs reads [1, [2 or [1,2.
                    numbers = sorted({int(n) for n in re.findall(r'\d+', text_of(el, 'Volta/endings', '') or text_of(el, 'Volta/beginText', '')) if 1 <= int(n) <= 9})
                    if numbers:
                        events.append(('volta', ','.join(str(n) for n in numbers)))
            self.measures.append({
                'events': events,
                'start_repeat': m.find('startRepeat') is not None,
                'end_repeat': m.find('endRepeat') is not None,
                'len': m.get('len'),
                'section_end': any(b.text == 'section' for b in m.findall('LayoutBreak/subtype')),
                'final_bar': any((b.findtext('subtype') or '') == 'end' for b in m.iter('BarLine')),
            })
        self.tempo = tempo

    def movements(self):
        """Measure ranges of the movements: a new one starts after a section break, or after a final barline when
        the next bar carries a tempo marking. A file without either is one movement."""
        starts = [0]
        for i in range(1, len(self.measures)):
            prev = self.measures[i - 1]
            has_tempo = any(kind == 'tempo' for kind, _ in self.measures[i]['events'])
            if prev['section_end'] or (prev['final_bar'] and has_tempo):
                starts.append(i)
        return [(a, b - 1) for a, b in zip(starts, starts[1:] + [len(self.measures)])]


def load_voice(root, profile):
    """The staff this profile practises: the top vocal staff for Lieder, else the first staff."""
    score = root.find('Score')
    parts = score.findall('Part')
    staffs = score.findall('Staff')
    if not parts or not staffs:
        raise ValueError('no parts')
    chosen = None
    if profile['staff'] == 'vocal':
        for part in parts:
            name = (text_of(part, 'Instrument/longName') or text_of(part, 'Instrument/trackName')).lower()
            if any(w in name for w in VOCAL_WORDS):
                chosen = part.find('Staff').get('id')
                break
    staff = next((s for s in staffs if s.get('id') == chosen), staffs[0])
    return Voice(staff, root.get('version', ''))


def render(voice, lo=0, hi=None):
    """Measures lo..hi of a voice -> dict with ABC body and analysis, or raise ValueError when too little sounds."""
    if hi is None:
        hi = len(voice.measures) - 1
    # Pass 1: collect note durations to pick the unit length and find the first/last sounding measure.
    smallest = Fraction(1, 4)
    sounding = []
    for i, m in enumerate(voice.measures):
        if i < lo or i > hi:
            continue
        has_note = False
        for kind, el in m['events']:
            if kind != 'note' or el.tag != 'Chord':
                continue
            if any(child.tag in GRACE_TAGS for child in el):
                continue
            has_note = True
            d = DURATIONS.get(text_of(el, 'durationType'), Fraction(1, 4))
            smallest = min(smallest, d)
        if has_note:
            sounding.append(i)
    if len(sounding) < 4:
        raise ValueError('fewer than 4 bars with notes')
    first, last = sounding[0], sounding[-1]
    unit = Fraction(1, 16) if smallest < Fraction(1, 16) else Fraction(1, 8)
    # Pass 2: emit ABC. Key and meter carry in from everything before the first sounding bar; the tempo is the
    # range's first marking (a movement's own), with a default when it has none.
    key = 0
    meter = (4, 4)
    for m in voice.measures[:first + 1]:
        for kind, value in m['events']:
            if kind == 'key':
                key = value
            elif kind == 'meter':
                meter = value
    tempo, tempo_text = None, ''
    for m in voice.measures[lo:hi + 1]:
        marks = [value for kind, value in m['events'] if kind == 'tempo' and value[0] is not None]
        if marks:
            tempo, tempo_text = marks[0]
            break
    header_key, header_meter = key, meter
    key_alters = sig_alters(key)
    bars = []
    pitches = []
    accidentals = 0
    notes = 0
    has_tuplet = False
    for i in range(first, last + 1):
        m = voice.measures[i]
        carried = {}
        out = []
        if m['start_repeat']:
            out.append('|:')
        # Tuplet groups: 3.x brackets elements between Tuplet and endTuplet; 2.x tags each chord with the tuplet id.
        events = m['events']
        groups = {}
        current = None
        order = []
        for idx, (kind, el) in enumerate(events):
            if kind == 'tuplet':
                if el.find('normalNotes') is not None:
                    current = (int(text_of(el, 'actualNotes', '3')), int(text_of(el, 'normalNotes', '2')), [])
                    order.append(current)
                else:
                    groups[el.get('id')] = (int(text_of(el, 'actualNotes', '3')), int(text_of(el, 'normalNotes', '2')), [])
                    order.append(groups[el.get('id')])
            elif kind == 'endtuplet':
                current = None
            elif kind == 'note':
                if any(child.tag in GRACE_TAGS for child in el):
                    continue
                tid = text_of(el, 'Tuplet')
                if tid and tid in groups:
                    groups[tid][2].append(idx)
                elif current is not None:
                    current[2].append(idx)
        member_group = {idx: g for g in order for idx in g[2]}
        tie_pending = False
        for idx, (kind, value) in enumerate(events):
            if kind == 'key':
                if value != key:
                    key = value
                    key_alters = sig_alters(key)
                    out.append(f'[K:{MAJOR_KEYS[key]}]')
            elif kind == 'meter':
                if value != meter:
                    meter = value
                    out.append(f'[M:{value[0]}/{value[1]}]')
            elif kind == 'volta':
                out.append(f'[{value}')
            elif kind == 'note':
                el = value
                if any(child.tag in GRACE_TAGS for child in el):
                    continue
                group = member_group.get(idx)
                if group is not None:
                    actual, normal, members = group
                    # abcjs draws (p:q:r tuplets for p up to 9; r is however many notes the group holds here.
                    if not 2 <= actual <= 9 or not 1 <= normal <= 9 or len(members) > 9:
                        raise ValueError(f'tuplet {actual}:{normal} over {len(members)} notes unsupported')
                    if idx == members[0]:
                        out.append(f'({actual}:{normal}:{len(members)}')
                    has_tuplet = True
                dtype = text_of(el, 'durationType')
                if dtype == 'measure':
                    # A whole-bar rest is as long as its bar: MuseScore's <duration>, else the measure's own len, else the meter.
                    dur = Fraction(text_of(el, 'duration', m['len'] or f'{meter[0]}/{meter[1]}'))
                else:
                    dur = DURATIONS.get(dtype, Fraction(1, 4))
                    dots = int(text_of(el, 'dots', '0') or 0)
                    dur = dur * (2 - Fraction(1, 2 ** dots))
                pieces = split_duration(dur, unit)
                if el.tag == 'Rest':
                    out.append(' '.join('z' + abc_length(piece, unit) for piece in pieces))
                    continue
                note_els = el.findall('Note')
                if not note_els:
                    continue
                # Chords in a vocal line are rare (divisi); keep the top note.
                top = max(note_els, key=lambda n: int(text_of(n, 'pitch', '60')))
                pitch = int(text_of(top, 'pitch', '60'))
                tpc = int(text_of(top, 'tpc', '14'))
                letter, alter, octave = spell(pitch, tpc)
                explicit = top.find('Accidental') is not None and alter == 0 and key_alters.get(letter, 0) == 0 and (letter, octave) not in carried
                token = abc_pitch(letter, alter, octave, carried, key_alters, explicit)
                if token[0] in '^_=':
                    accidentals += 1
                tie = top.find('Tie') is not None or top.find("Spanner[@type='Tie']") is not None
                # A duration abcjs cannot draw becomes tied pieces; the pitch token repeats without its accidental.
                plain = token.lstrip('^_=')
                parts = [token + abc_length(pieces[0], unit)] + [plain + abc_length(piece, unit) for piece in pieces[1:]]
                out.append('-'.join(parts) + ('-' if tie else ''))
                pitches.append(pitch)
                notes += 1
        bar = ' '.join(out)
        bars.append(bar + (' :|' if m['end_repeat'] else ' |'))
    if notes < 8:
        raise ValueError('fewer than 8 notes')
    body_lines = []
    for n in range(0, len(bars), 4):
        body_lines.append(' '.join(bars[n:n + 4]))
    body = '\n'.join(body_lines)
    body = re.sub(r' \|$', ' |]', body)
    # Mode: minor when the last note is the relative minor's tonic.
    last_pc = pitches[-1] % 12
    minor_tonic = {k: (9 + 7 * k) % 12 for k in MAJOR_KEYS}[header_key]
    key_name = MINOR_KEYS[header_key] if last_pc == minor_tonic else MAJOR_KEYS[header_key]
    bpm = int(round(tempo * 60)) if tempo else 80
    bpm = max(30, min(240, bpm))
    return {
        'body': body, 'key': key_name, 'meter': f'{header_meter[0]}/{header_meter[1]}', 'unit': unit, 'bpm': bpm,
        'bars': len(bars), 'notes': notes, 'pitchMin': min(pitches), 'pitchMax': max(pitches),
        'accidentals': accidentals, 'tuplets': has_tuplet, 'smallest': smallest,
        'trimmed': (first - lo, hi - last), 'tempoText': tempo_text,
    }


def level_for(info):
    """Estimated difficulty from range, accidentals and rhythm; labels are estimates, as elsewhere in the library."""
    span = info['pitchMax'] - info['pitchMin']
    ratio = info['accidentals'] / max(1, info['notes'])
    if span >= 19 or ratio > 0.18 or (info['tuplets'] and info['smallest'] <= Fraction(1, 16)) or info['smallest'] < Fraction(1, 16):
        return 'Advanced'
    if span <= 12 and ratio <= 0.05 and info['smallest'] >= Fraction(1, 8) and not info['tuplets']:
        return 'Beginner'
    return 'Intermediate'


PROFILES = {
    'lieder': {
        'repo': 'https://github.com/OpenScore/Lieder',
        'staff': 'vocal',
        'split': False,
        'prefix': 'lieder-',
        'catalog': 'catalog-lieder.js',
        'exclusions': 'lieder-exclusions.json',
        'stats_key': 'lieder',
        'collection': 'OpenScore Lieder',
        'header': '% OpenScore Lieder Corpus (CC0 1.0). Encoded by OpenScore volunteers; vocal line only.',
        'file_comment': '/* OpenScore Lieder Corpus vocal lines. CC0 1.0 encodings of public-domain songs; generated by scripts/import-openscore.py. */',
        'declared': 'CC0 1.0 Universal (OpenScore Lieder Corpus)',
        'composition': 'Public-domain nineteenth-century song; CC0 encoding',
        'attribution': 'OpenScore Lieder Corpus, encoded by volunteers (https://github.com/OpenScore/Lieder)',
        'source_label': 'OpenScore Lieder Corpus · MuseScore edition (CC0)',
        'instrument': 'Voice and piano',
        'style': 'Lied',
        'edition': 'OpenScore Lieder Corpus',
        'transform': 'Vocal line (top voice) extracted from the CC0 MuseScore edition; piano part, lyrics, grace notes and performance markings omitted.',
        'genre': 'Art song',
        'skill': 'Art song melody',
        'rights': 'Nineteenth-century composition in the public domain. The OpenScore Lieder Corpus encoding is released under CC0 1.0; attribution to OpenScore Lieder is requested, not required. This practice part is the vocal line only.',
        'describe': lambda composer, lyricist, movement: f'Song for voice and piano by {composer}' + (f', words by {lyricist}' if lyricist else '') + '. Vocal line as an editable practice part.',
        'latest_death': None,
    },
    'quartets': {
        'repo': 'https://github.com/OpenScore/StringQuartets',
        'staff': 'first',
        'split': True,
        'prefix': 'sq-',
        'catalog': 'catalog-quartets.js',
        'exclusions': 'quartets-exclusions.json',
        'stats_key': 'quartets',
        'collection': 'OpenScore String Quartets',
        'header': '% OpenScore String Quartets (CC0 1.0). Encoded by OpenScore volunteers; first violin part only.',
        'file_comment': '/* OpenScore String Quartets first-violin parts, one movement each. CC0 1.0 encodings of public-domain works; generated by scripts/import-openscore.py. */',
        'declared': 'CC0 1.0 Universal (OpenScore String Quartets)',
        'composition': 'Public-domain string quartet (composer died before 1930); CC0 encoding',
        'attribution': 'OpenScore String Quartets, encoded by volunteers (https://github.com/OpenScore/StringQuartets)',
        'source_label': 'OpenScore String Quartets · MuseScore edition (CC0)',
        'instrument': 'String quartet (first violin)',
        'style': 'Chamber music',
        'edition': 'OpenScore String Quartets',
        'transform': 'First violin part of one movement, extracted from the CC0 MuseScore edition; the other three parts, grace notes and performance markings omitted.',
        'genre': 'Chamber music',
        'skill': 'First violin part',
        'rights': 'String quartet in the public domain (composer died before 1930). The OpenScore String Quartets encoding is released under CC0 1.0; attribution to OpenScore is requested, not required. This practice part is the first violin line of one movement.',
        'describe': lambda composer, lyricist, movement: f'First violin part of the string quartet by {composer}' + (f', {movement}' if movement else '') + '. One movement as an editable practice part.',
        # Composition rights follow the US public-domain context; without per-work publication dates, admit only
        # composers who died before 1930, whose works were published before 1930 with near certainty.
        'latest_death': 1929,
    },
}


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in PROFILES:
        sys.exit(__doc__)
    profile = PROFILES[sys.argv[1]]
    key_name = profile['stats_key']
    REPO = profile['repo']
    src = os.path.abspath(sys.argv[2])
    commit = subprocess.run(['git', '-C', src, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    composers = yaml.safe_load(open(os.path.join(src, 'data', 'composers.yaml'), encoding='utf-8'))
    by_path = {c['path']: c for c in composers.values() if isinstance(c, dict) and 'path' in c}
    today = date.today().isoformat()
    candidates = []
    excluded = []
    files = sorted(glob.glob(os.path.join(src, 'scores', '**', '*.mscx'), recursive=True))
    clean = lambda t: re.sub(r'\s+', ' ', t).replace('"', "'").strip()
    for path in files:
        rel = os.path.relpath(path, src)
        lc = os.path.splitext(os.path.basename(path))[0]
        composer_dir = rel.split(os.sep)[1]
        comp = by_path.get(composer_dir, {})
        if profile['latest_death'] is not None and (not comp.get('died') or int(comp['died']) > profile['latest_death']):
            excluded.append({'file': rel, 'reason': f"composition rights not verified: composer died {comp.get('died', 'unknown')}, after {profile['latest_death']}; needs a publication date check"})
            continue
        try:
            root = ET.parse(path).getroot()
            meta = {m.get('name'): (m.text or '').strip() for m in root.find('Score').findall('metaTag')}
            voice = load_voice(root, profile)
            ranges = voice.movements() if profile['split'] else [(0, len(voice.measures) - 1)]
            infos = []
            for n, (lo, hi) in enumerate(ranges, 1):
                try:
                    infos.append((n, render(voice, lo, hi)))
                except ValueError as e:
                    if not profile['split']:
                        raise
                    excluded.append({'file': rel, 'movement': n, 'reason': str(e)})
            if not infos:
                raise ValueError('no usable movements')
        except Exception as e:  # noqa: BLE001 - every failure is recorded, not hidden
            excluded.append({'file': rel, 'reason': str(e)})
            continue
        composer = clean(meta.get('composer') or comp.get('name') or composer_dir.replace('_', ' '))
        years = f" ({comp['born']}–{comp['died']})" if comp.get('born') and comp.get('died') else ''
        work = clean(meta.get('workTitle', ''))
        movement_title = clean(meta.get('movementTitle', ''))
        set_name = rel.split(os.sep)[2].replace('_', ' ').strip()
        lyricist = clean(meta.get('lyricist') or meta.get('poet') or '')
        with open(path, 'rb') as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        for n, info in infos:
            if profile['split']:
                movement = f"{n}. {info['tempoText']}" if info['tempoText'] else f'Movement {n}'
                title = f'{work or set_name or lc} · {movement}' if len(infos) > 1 else (work or set_name or lc)
                entry_id = f"{profile['prefix']}{lc[2:]}-{n}"
                describe_movement = movement if len(infos) > 1 else ''
            else:
                title = movement_title or work or lc
                if movement_title and work and work != movement_title:
                    title = f'{movement_title} · {work}'
                entry_id = f"{profile['prefix']}{lc[2:]}"
                describe_movement = ''
            header = [
                profile['header'],
                f'% Source: {meta.get("source", REPO)} ; {REPO}/blob/{commit}/{rel.replace(os.sep, "/")}',
                'X:1',
                f'T:{title}',
                f'C:{composer}',
            ]
            if lyricist:
                header.append(f'% Words: {lyricist}')
            header += [f'M:{info["meter"]}', f'L:{info["unit"].numerator}/{info["unit"].denominator}', f'Q:1/4={info["bpm"]}', f'K:{info["key"]}']
            abc = '\n'.join(header) + '\n' + info['body'] + '\n'
            level = level_for(info)
            trimmed_note = ''
            if info['trimmed'][0] or info['trimmed'][1]:
                trimmed_note = f" Trimmed {info['trimmed'][0]} opening and {info['trimmed'][1]} closing bars of silence."
            candidates.append({
                'id': entry_id,
                'title': title,
                'composer': composer + years,
                'abc': abc,
                'collection': profile['collection'],
                'notationLicense': 'CC0-1.0',
                'declaredLicense': profile['declared'],
                'licenseURL': LICENSE_URL,
                'compositionStatus': profile['composition'],
                'attribution': profile['attribution'],
                'source': meta.get('source') or REPO,
                'sourceLabel': profile['source_label'],
                'sourceFile': f'{REPO}/blob/{commit}/{rel.replace(os.sep, "/")}',
                'sourceSHA256': sha,
                'sourceCommit': commit,
                'originalInstrument': profile['instrument'],
                'lyricist': lyricist,
                'set': set_name,
                'style': profile['style'],
                'edition': profile['edition'],
                'studyTransform': profile['transform'] + trimmed_note,
                'bars': info['bars'],
                'studyNotes': info['notes'],
                'pitchMin': info['pitchMin'],
                'pitchMax': info['pitchMax'],
                'kind': 'historic',
                'genre': profile['genre'],
                'level': level,
                'skill': profile['skill'],
                'rights': profile['rights'],
                'description': profile['describe'](composer, lyricist, describe_movement),
                'reviewedAt': today,
                'aliases': set_name,
            })
    scratch = os.path.join(ROOT, 'scripts', f'{key_name}-candidates.json')
    with open(scratch, 'w', encoding='utf-8') as fh:
        json.dump(candidates, fh, ensure_ascii=False)
    ready_path = scratch + '.ready.json'
    subprocess.run(['node', os.path.join(ROOT, 'scripts', 'validate-candidates.cjs'), scratch, ready_path], check=True)
    ready = json.load(open(ready_path, encoding='utf-8'))
    errors = json.load(open(ready_path + '.errors.json', encoding='utf-8'))
    for e in errors:
        excluded.append({'file': e['id'], 'title': e.get('title'), 'reason': e['error']})
    for p in (scratch, ready_path, ready_path + '.errors.json'):
        os.remove(p)
    with open(os.path.join(ROOT, profile['catalog']), 'w', encoding='utf-8') as fh:
        fh.write(profile['file_comment'] + '\n')
        fh.write('catalog.push(...' + json.dumps(ready, ensure_ascii=False) + ');\n')
    # catalog-rights.json: replace any earlier rows of this profile, then append the new ones without ABC.
    rights_path = os.path.join(ROOT, 'catalog-rights.json')
    rights = [r for r in json.load(open(rights_path, encoding='utf-8')) if not str(r.get('id', '')).startswith(profile['prefix'])]
    for row in ready:
        meta = dict(row)
        meta.pop('abc', None)
        rights.append(meta)
    with open(rights_path, 'w', encoding='utf-8') as fh:
        json.dump(rights, fh, ensure_ascii=False, indent=2)
    # library-stats.json, idempotently: remove the previous contribution of this profile before adding this run's.
    stats_path = os.path.join(ROOT, 'scripts', 'library-stats.json')
    stats = json.load(open(stats_path, encoding='utf-8'))
    previous = stats.get(f'{key_name}Added', 0)
    stats['collections'][profile['collection']] = len(ready)
    stats['licenses']['CC0-1.0'] = stats['licenses'].get('CC0-1.0', 0) - previous + len(ready)
    stats['added'] = stats['added'] - previous + len(ready)
    stats['total'] = stats['baseline'] + stats['added']
    stats[f'{key_name}Added'] = len(ready)
    stats[f'{key_name}Source'] = {'repo': REPO, 'commit': commit, 'files': len(files), 'accepted': len(ready), 'excluded': len(excluded)}
    with open(stats_path, 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    with open(os.path.join(ROOT, 'scripts', profile['exclusions']), 'w', encoding='utf-8') as fh:
        json.dump({'commit': commit, 'files': len(files), 'accepted': len(ready), 'excluded': excluded}, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    levels = {}
    for r in ready:
        levels[r['level']] = levels.get(r['level'], 0) + 1
    print(f"{profile['collection']}: {len(files)} files, {len(ready)} accepted, {len(excluded)} excluded; levels {levels}")


if __name__ == '__main__':
    main()
