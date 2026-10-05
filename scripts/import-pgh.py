#!/usr/bin/env python3
"""Import Paul Hardy's Session Tunebook (ABC) into FretFree as catalog-pgh.js.

Usage: python3 scripts/import-pgh.py <pgh_session_tunebook.abc> [--mirror URL] [--mirror-commit SHA]

The tunebook is one ABC file whose header declares "Copyright Paul Hardy 2004-2016 ... Creative Commons
Attribution Non-Commercial Share Alike (cc by-nc-sa) 3.0" and whose every tune carries a Z: credit line. The
notation licence is therefore CC-BY-NC-SA-3.0 for every tune. Composition rights are judged per tune from the C:
field under the US public-domain rule used elsewhere in the library: traditional or anonymous tunes and composers
whose dates all fall before 1930 are admitted; tunes credited to a named composer with any year 1930 or later, or
with no dates at all, are excluded and listed in scripts/pgh-exclusions.json.

Each tune's original text is kept unchanged in scores/<id>/original.abc; the whole tunebook and its licence block are
kept in licenses/. Candidates are validated by scripts/validate-candidates.cjs (parse, MIDI, transposition), which
also estimates a difficulty level. catalog-rights.json and scripts/library-stats.json are updated idempotently.
"""
import datetime, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = 'pgh-'
COLLECTION = "Paul Hardy’s Session Tunebook"
LICENSE = 'CC-BY-NC-SA-3.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/3.0/'
SOURCE = 'https://www.paulhardy.net/'
TRAD = re.compile(r'^\s*(trad\b|traditional\b|anon\b|music trad\b|from arbeau)', re.I)


def read_text(path):
    data = open(path, 'rb').read()
    try:
        return data.decode('utf-8'), data
    except UnicodeDecodeError:
        return data.decode('latin-1'), data


def split_tunes(text):
    """Yield (header_block, [tune_text, ...]) where each tune starts at X: and runs to the next X: or EOF."""
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if l.startswith('X:')]
    header = '\n'.join(lines[: starts[0]]) if starts else text
    tunes = []
    for n, i in enumerate(starts):
        j = starts[n + 1] if n + 1 < len(starts) else len(lines)
        block = lines[i:j]
        while block and not block[-1].strip():
            block.pop()
        tunes.append('\n'.join(block) + '\n')
    return header, tunes


def field(tune, key, default=''):
    m = re.search(r'^' + key + r':\s*(.*)$', tune, re.M)
    return m.group(1).strip() if m else default


def fields(tune, key):
    return [m.group(1).strip() for m in re.finditer(r'^' + key + r':\s*(.*)$', tune, re.M)]


def composition_status(composer):
    """Return (admitted, status text, reason) for a C: field under the US public-domain rule."""
    c = composer.strip()
    years = [int(y) for y in re.findall(r'(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)', c)]
    if not c or TRAD.match(c):
        if any(y >= 1930 for y in years):
            # e.g. "Trad. Words X (1874-1952)": the tune is traditional; later dates refer to words or a source person.
            pass
        return True, 'Traditional tune, public domain; CC BY-NC-SA 3.0 transcription', ''
    if years and max(years) < 1930:
        return True, f'Composition by {c}, published before 1930 (US public domain); CC BY-NC-SA 3.0 transcription', ''
    if years:
        return False, '', f'Composer credit "{c}" carries a date of 1930 or later; composition may still be in copyright'
    return False, '', f'Composer credit "{c}" has no dates; composition status cannot be established'


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path = args[0]
    mirror = args[args.index('--mirror') + 1] if '--mirror' in args else ''
    commit = args[args.index('--mirror-commit') + 1] if '--mirror-commit' in args else ''
    text, raw = read_text(path)
    whole_sha = hashlib.sha256(raw).hexdigest()
    header, tunes = split_tunes(text)
    edition = re.search(r'Session Tunebook (\d{4})', header)
    edition = edition.group(1) if edition else 'unknown edition'
    notice = '\n'.join(l[2:].strip() for l in header.splitlines() if l.startswith('%%center') or l.startswith('%%'))
    notice_lines = [l for l in header.splitlines() if re.search(r'Copyright|licen[cs]ed|creativecommons', l)]
    if not any('by-nc-sa' in l for l in notice_lines):
        sys.exit('Tunebook header does not declare the expected cc by-nc-sa licence; refusing to import.')
    os.makedirs(os.path.join(ROOT, 'licenses'), exist_ok=True)
    with open(os.path.join(ROOT, 'licenses', f'pgh-session-tunebook-{edition}.abc'), 'wb') as fh:
        fh.write(raw)
    with open(os.path.join(ROOT, 'licenses', 'pgh-session-tunebook-notice.txt'), 'w', encoding='utf-8') as fh:
        fh.write(f"Paul Hardy's Session Tunebook {edition}: licence and introduction, as declared in the tunebook header.\n")
        fh.write(f'Whole-file SHA-256: {whole_sha}\n')
        if mirror:
            fh.write(f'Copy obtained from: {mirror}' + (f' at commit {commit}' if commit else '') + '\n')
        fh.write('\n' + '\n'.join(re.sub(r'^%%(center|begintext justify|text|endtext|vskip.*|textfont.*|newpage|multicol.*|leftmargin.*|EPS.*)?\s*', '', l) for l in header.splitlines() if l.startswith('%%')).strip() + '\n')
    today = datetime.date.today().isoformat()
    candidates, excluded = [], []
    for tune in tunes:
        x = field(tune, 'X')
        titles = fields(tune, 'T')
        title = titles[0] if titles else f'Tune {x}'
        composer = field(tune, 'C', '')
        admitted, status, reason = composition_status(composer)
        if not admitted:
            excluded.append({'file': f'X:{x}', 'title': title, 'composer': composer, 'reason': reason})
            continue
        if re.search(r'^N:.*(copyright|©|all rights|permission)', tune, re.I | re.M):
            excluded.append({'file': f'X:{x}', 'title': title, 'composer': composer, 'reason': 'Tune carries its own rights note: ' + field(tune, 'N')})
            continue
        entry_id = f'{PREFIX}{x}'
        folder = os.path.join(ROOT, 'scores', entry_id)
        os.makedirs(folder, exist_ok=True)
        tune_bytes = tune.encode('utf-8')
        with open(os.path.join(folder, 'original.abc'), 'wb') as fh:
            fh.write(tune_bytes)
        # Playable copy: the tune as written, minus typesetting and MIDI-accompaniment directives, with X:1 and credits.
        body = [l for l in tune.splitlines() if not l.startswith('%%')]
        body = ['X:1' if l.startswith('X:') else l for l in body]
        rhythm = field(tune, 'R', '')
        origin = field(tune, 'O', '')
        abc = '\n'.join([
            f"% Paul Hardy’s Session Tunebook {edition} (www.paulhardy.net). © Paul Hardy 2004–{edition}; CC BY-NC-SA 3.0.",
            f'% Source: {SOURCE} ; original tune X:{x}; see licenses/pgh-session-tunebook-notice.txt',
        ] + body) + '\n'
        composer_text = composer if composer and not TRAD.match(composer) else (composer or 'Traditional')
        description = f"{rhythm or 'Session tune'}{' from ' + origin if origin else ''}, as played at folk sessions around Cambridge and Redlands. Paul Hardy’s transcription with guitar chords."
        candidates.append({
            'id': entry_id,
            'title': title,
            'composer': composer_text,
            'abc': abc,
            'collection': COLLECTION,
            'notationLicense': LICENSE,
            'declaredLicense': 'Creative Commons Attribution Non-Commercial Share Alike (cc by-nc-sa) 3.0, as declared in the tunebook',
            'licenseURL': LICENSE_URL,
            'localLicense': 'licenses/pgh-session-tunebook-notice.txt',
            'compositionStatus': status,
            'attribution': f'Paul Hardy, Session Tunebook {edition} edition (www.paulhardy.net)',
            'source': SOURCE,
            'sourceLabel': f'Paul Hardy’s Session Tunebook {edition} · ABC edition',
            'sourceMirror': mirror,
            'sourceCommit': commit,
            'sourceFileSHA256': whole_sha,
            'sourceSHA256': hashlib.sha256(tune_bytes).hexdigest(),
            'originalSource': f'scores/{entry_id}/original.abc',
            'originalTuneNumber': x,
            'aliases': ' · '.join(titles[1:]) if len(titles) > 1 else '',
            'origin': origin,
            'genre': (rhythm.split(',')[0].strip().capitalize() or 'Session tune'),
            'description': description,
            'studyTransform': 'Original ABC transcription; typesetting and MIDI accompaniment directives removed; no musical reduction.',
            'rights': (
                f'Underlying tune: {status.split(";")[0]}. ABC transcription © Paul Hardy 2004–{edition}, licensed '
                'CC BY-NC-SA 3.0; keep the credit and licence on copies and adaptations. Contact Paul Hardy for commercial terms.'
            ),
            'kind': 'historic',
            'skill': 'Melody practice',
            'reviewedAt': today,
        })
    scratch = os.path.join(ROOT, 'scripts', 'pgh-candidates.json')
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
    kept = {r['id'] for r in ready}
    for d in os.listdir(os.path.join(ROOT, 'scores')):
        if d.startswith(PREFIX) and d not in kept:
            for f in os.listdir(os.path.join(ROOT, 'scores', d)):
                os.remove(os.path.join(ROOT, 'scores', d, f))
            os.rmdir(os.path.join(ROOT, 'scores', d))
    with open(os.path.join(ROOT, 'catalog-pgh.js'), 'w', encoding='utf-8') as fh:
        fh.write(f"/* Paul Hardy’s Session Tunebook {edition}. CC BY-NC-SA 3.0 transcriptions of traditional and pre-1930 tunes; generated by scripts/import-pgh.py. */\n")
        fh.write('catalog.push(...' + json.dumps(ready, ensure_ascii=False) + ');\n')
    rights_path = os.path.join(ROOT, 'catalog-rights.json')
    rights = [r for r in json.load(open(rights_path, encoding='utf-8')) if not str(r.get('id', '')).startswith(PREFIX)]
    for row in ready:
        meta = dict(row)
        meta.pop('abc', None)
        rights.append(meta)
    with open(rights_path, 'w', encoding='utf-8') as fh:
        json.dump(rights, fh, ensure_ascii=False, indent=2)
    stats_path = os.path.join(ROOT, 'scripts', 'library-stats.json')
    stats = json.load(open(stats_path, encoding='utf-8'))
    previous = stats.get('pghAdded', 0)
    stats['collections'][COLLECTION] = len(ready)
    stats['licenses'][LICENSE] = stats['licenses'].get(LICENSE, 0) - previous + len(ready)
    stats['added'] = stats['added'] - previous + len(ready)
    stats['total'] = stats['baseline'] + stats['added']
    stats['pghAdded'] = len(ready)
    stats['pghSource'] = {'edition': edition, 'file': os.path.basename(path), 'sha256': whole_sha, 'mirror': mirror, 'commit': commit, 'tunes': len(tunes), 'accepted': len(ready), 'excluded': len(excluded)}
    with open(stats_path, 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    with open(os.path.join(ROOT, 'scripts', 'pgh-exclusions.json'), 'w', encoding='utf-8') as fh:
        json.dump({'edition': edition, 'sha256': whole_sha, 'tunes': len(tunes), 'accepted': len(ready), 'excluded': excluded}, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    levels = {}
    for r in ready:
        levels[r['level']] = levels.get(r['level'], 0) + 1
    print(f'{COLLECTION} {edition}: {len(tunes)} tunes, {len(ready)} accepted, {len(excluded)} excluded; levels {levels}')


if __name__ == '__main__':
    main()
