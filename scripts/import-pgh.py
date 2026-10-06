#!/usr/bin/env python3
"""Import Paul Hardy's tunebooks (ABC) into FretFree as catalog-pgh.js.

Usage: python3 scripts/import-pgh.py <tunebook.abc> [<tunebook.abc> ...] [--mirror URL] [--mirror-commit SHA]

Each tunebook is one ABC file whose header declares "Copyright Paul Hardy ... Creative Commons Attribution
Non-Commercial Share Alike (cc by-nc-sa) 3.0" and whose every tune carries a Z: credit line; the import refuses a
file without that declaration. The notation licence is therefore CC-BY-NC-SA-3.0 for every tune. Books are processed
in the order given and a tune whose title already appears in an earlier book is skipped as a duplicate (the Annex and
Possible books feed the next Session edition), so give the Session Tunebook first.

Composition rights are judged per tune from the C: field under the US public-domain rule used elsewhere in the
library: traditional or anonymous tunes and composers whose dates all fall before 1930 are admitted; tunes credited to
a named composer with any year 1930 or later, or with no dates at all, are excluded, as are tunes in KNOWN_COMPOSITIONS,
which a book credits as traditional but are known later compositions. Exclusions go to scripts/pgh-exclusions.json.

Each tune's original text is kept unchanged in scores/<id>/original.abc; the whole tunebooks and their licence blocks
are kept in licenses/. Candidates are validated by scripts/validate-candidates.cjs (parse, MIDI, transposition), which
also estimates a difficulty level. catalog-rights.json and scripts/library-stats.json are updated idempotently.
"""
import datetime, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = 'pgh-'
COLLECTION = "Paul Hardy’s Tunebooks"
LICENSE = 'CC-BY-NC-SA-3.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/3.0/'
SOURCE = 'https://www.paulhardy.net/'
TRAD = re.compile(r'^\s*(trad\b|traditional\b|anon\b|music trad\b|from arbeau)', re.I)
# Tunes a book credits as traditional but which are known compositions of 1930 or later (reviewed by hand), by id.
KNOWN_COMPOSITIONS = {
    'pgh-13003': 'Mairi’s Wedding: composed by Johnny Bannerman, 1934',
    'pgh-19050': 'Stop the Cavalry: melody composed by Jona Lewie, 1980',
    'pgh-23006': 'Wild Mountain Thyme: the version played is Francis McPeake’s, 1957 (after the traditional Braes o’ Balquhidder)',
}


def read_text(path):
    data = open(path, 'rb').read()
    try:
        return data.decode('utf-8'), data
    except UnicodeDecodeError:
        return data.decode('latin-1'), data


def split_tunes(text):
    """Return (header_block, [tune_text, ...]) where each tune starts at X: and runs to the next X: or EOF."""
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


def title_key(title):
    t = title.lower().strip()
    t = re.sub(r',\s*(the|a|an)$', '', t)
    t = re.sub(r'^(the|a|an)\s+', '', t)
    return re.sub(r'[^a-z0-9]', '', t)


def composition_status(composer):
    """Return (admitted, status text, reason) for a C: field under the US public-domain rule."""
    c = composer.strip()
    years = [int(y) for y in re.findall(r'(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)', c)]
    if not c or TRAD.match(c):
        # Later dates after a traditional credit refer to words or to the source person, not to the tune.
        return True, 'Traditional tune, public domain; CC BY-NC-SA 3.0 transcription', ''
    if years and max(years) < 1930:
        return True, f'Composition by {c}, published before 1930 (US public domain); CC BY-NC-SA 3.0 transcription', ''
    if years:
        return False, '', f'Composer credit "{c}" carries a date of 1930 or later; composition may still be in copyright'
    return False, '', f'Composer credit "{c}" has no dates; composition status cannot be established'


def book_info(header, path, first_tune=''):
    # The edition year follows the book title on the cover line, or on the tunes' Z: credit; the copyright line
    # gives the span of years.
    dated = re.search(r"Paul Hardy's (\w+) Tunebook (\d{4})", header) or re.search(r"Paul Hardy's (\w+) Tunebook (\d{4})", first_tune)
    named = re.search(r"Paul Hardy's (\w+) Tunebook", header)
    years_line = re.search(r'Copyright Paul Hardy[^\n]*?(\d{4})-(\d{4})', header)
    name = (dated or named).group(1) if (dated or named) else os.path.basename(path)
    year = dated.group(2) if dated else (years_line.group(2) if years_line else '')
    span = f'{years_line.group(1)}–{years_line.group(2)}' if years_line else year
    return {'name': f'{name} Tunebook', 'slug': name.lower(), 'year': year, 'span': span}


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    mirror = args[args.index('--mirror') + 1] if '--mirror' in args else ''
    commit = args[args.index('--mirror-commit') + 1] if '--mirror-commit' in args else ''
    paths = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
    os.makedirs(os.path.join(ROOT, 'licenses'), exist_ok=True)
    today = datetime.date.today().isoformat()
    candidates, excluded, books, seen_titles = [], [], [], {}
    notice_parts = []
    for path in paths:
        text, raw = read_text(path)
        whole_sha = hashlib.sha256(raw).hexdigest()
        header, tunes = split_tunes(text)
        if not any('by-nc-sa' in l for l in header.splitlines() if re.search(r'Copyright|licen[cs]ed|creativecommons', l)):
            sys.exit(f'{path}: header does not declare the expected cc by-nc-sa licence; refusing to import.')
        book = book_info(header, path, tunes[0] if tunes else '')
        book.update({'file': os.path.basename(path), 'sha256': whole_sha, 'tunes': len(tunes)})
        with open(os.path.join(ROOT, 'licenses', f"pgh-{book['slug']}-tunebook-{book['year']}.abc"), 'wb') as fh:
            fh.write(raw)
        notice_parts.append(
            f"Paul Hardy's {book['name']} {book['year']}: licence and introduction, as declared in the tunebook header.\n"
            f'Whole-file SHA-256: {whole_sha}\n'
            + (f'Copy obtained from: {mirror}' + (f' at commit {commit}' if commit else '') + '\n' if mirror else '')
            + '\n'
            + '\n'.join(
                re.sub(r'^%%(center|begintext justify|text|endtext|vskip.*|textfont.*|newpage|multicol.*|leftmargin.*|EPS.*)?\s*', '', l)
                for l in header.splitlines()
                if l.startswith('%%')
            ).strip()
            + '\n'
        )
        id_prefix = PREFIX if book['slug'] == 'session' else f"{PREFIX}{book['slug']}-"
        accepted_here = 0
        titles_before = dict(seen_titles)  # duplicates are judged against earlier books only, not within a book
        for tune in tunes:
            x = field(tune, 'X')
            titles = fields(tune, 'T')
            title = titles[0] if titles else f'Tune {x}'
            composer = field(tune, 'C', '')
            entry_id = f'{id_prefix}{x}'
            label = f"{book['name']} X:{x}"
            dup = next((titles_before[title_key(t)] for t in titles if title_key(t) in titles_before), None)
            if dup:
                excluded.append({'file': label, 'title': title, 'composer': composer, 'reason': f'Duplicate of {dup} (the same tune in an earlier book)'})
                continue
            admitted, status, reason = composition_status(composer)
            if entry_id in KNOWN_COMPOSITIONS:
                admitted, reason = False, 'Known later composition despite the traditional credit: ' + KNOWN_COMPOSITIONS[entry_id]
            if not admitted:
                excluded.append({'file': label, 'title': title, 'composer': composer, 'reason': reason})
                continue
            if re.search(r'^N:.*(copyright|©|all rights|permission)', tune, re.I | re.M):
                excluded.append({'file': label, 'title': title, 'composer': composer, 'reason': 'Tune carries its own rights note: ' + field(tune, 'N')})
                continue
            folder = os.path.join(ROOT, 'scores', entry_id)
            os.makedirs(folder, exist_ok=True)
            tune_bytes = tune.encode('utf-8')
            with open(os.path.join(folder, 'original.abc'), 'wb') as fh:
                fh.write(tune_bytes)
            # Playable copy: the tune as written, minus typesetting and MIDI-accompaniment directives, with X:1 and credits.
            body = ['X:1' if l.startswith('X:') else l for l in tune.splitlines() if not l.startswith('%%')]
            rhythm = field(tune, 'R', '')
            origin = field(tune, 'O', '')
            abc = '\n'.join([
                f"% Paul Hardy’s {book['name']} {book['year']} (www.paulhardy.net). © Paul Hardy {book['span']}; CC BY-NC-SA 3.0.",
                f'% Source: {SOURCE} ; original tune X:{x}; see licenses/pgh-tunebooks-notice.txt',
            ] + body) + '\n'
            composer_text = composer if composer and not TRAD.match(composer) else (composer or 'Traditional')
            candidates.append({
                'id': entry_id,
                'title': title,
                'composer': composer_text,
                'abc': abc,
                'collection': COLLECTION,
                'notationLicense': LICENSE,
                'declaredLicense': 'Creative Commons Attribution Non-Commercial Share Alike (cc by-nc-sa) 3.0, as declared in the tunebook',
                'licenseURL': LICENSE_URL,
                'localLicense': 'licenses/pgh-tunebooks-notice.txt',
                'compositionStatus': status,
                'attribution': f"Paul Hardy, {book['name']} {book['year']} edition (www.paulhardy.net)",
                'source': SOURCE,
                'sourceLabel': f"Paul Hardy’s {book['name']} {book['year']} · ABC edition",
                'edition': f"{book['name']} {book['year']}",
                'sourceMirror': mirror,
                'sourceCommit': commit,
                'sourceFileSHA256': whole_sha,
                'sourceSHA256': hashlib.sha256(tune_bytes).hexdigest(),
                'originalSource': f'scores/{entry_id}/original.abc',
                'originalTuneNumber': x,
                'aliases': ' · '.join(titles[1:]) if len(titles) > 1 else '',
                'origin': origin,
                'genre': (rhythm.split(',')[0].strip().capitalize() or 'Session tune'),
                'description': f"{rhythm or 'Session tune'}{' from ' + origin if origin else ''}, as played at folk sessions around Cambridge and Redlands. Paul Hardy’s transcription with guitar chords ({book['name']} {book['year']}).",
                'studyTransform': 'Original ABC transcription; typesetting and MIDI accompaniment directives removed; no musical reduction.',
                'rights': (
                    f"Underlying tune: {status.split(';')[0]}. ABC transcription © Paul Hardy {book['span']}, licensed "
                    'CC BY-NC-SA 3.0; keep the credit and licence on copies and adaptations. Contact Paul Hardy for commercial terms.'
                ),
                'kind': 'historic',
                'skill': 'Melody practice',
                'reviewedAt': today,
            })
            for t in titles:
                seen_titles.setdefault(title_key(t), entry_id)
            accepted_here += 1
        book['candidates'] = accepted_here
        books.append(book)
    with open(os.path.join(ROOT, 'licenses', 'pgh-tunebooks-notice.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n\n'.join(notice_parts))
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
    for stale in ('pgh-session-tunebook-notice.txt',):
        if os.path.exists(os.path.join(ROOT, 'licenses', stale)):
            os.remove(os.path.join(ROOT, 'licenses', stale))
    with open(os.path.join(ROOT, 'catalog-pgh.js'), 'w', encoding='utf-8') as fh:
        fh.write(f"/* Paul Hardy’s Tunebooks ({', '.join(b['name'] + ' ' + b['year'] for b in books)}). CC BY-NC-SA 3.0 transcriptions of traditional and pre-1930 tunes; generated by scripts/import-pgh.py. */\n")
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
    stats['collections'].pop("Paul Hardy’s Session Tunebook", None)
    stats['collections'][COLLECTION] = len(ready)
    stats['licenses'][LICENSE] = stats['licenses'].get(LICENSE, 0) - previous + len(ready)
    stats['added'] = stats['added'] - previous + len(ready)
    stats['total'] = stats['baseline'] + stats['added']
    stats['pghAdded'] = len(ready)
    per_book = {b['name']: sum(1 for r in ready if r['edition'].startswith(b['name'])) for b in books}
    stats['pghSource'] = {'mirror': mirror, 'commit': commit, 'books': books, 'acceptedByBook': per_book, 'accepted': len(ready), 'excluded': len(excluded)}
    with open(stats_path, 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    with open(os.path.join(ROOT, 'scripts', 'pgh-exclusions.json'), 'w', encoding='utf-8') as fh:
        json.dump({'books': books, 'accepted': len(ready), 'excluded': excluded}, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    levels = {}
    for r in ready:
        levels[r['level']] = levels.get(r['level'], 0) + 1
    print(f"{COLLECTION}: {sum(b['tunes'] for b in books)} tunes in {len(books)} books, {len(ready)} accepted {per_book}, {len(excluded)} excluded; levels {levels}")


if __name__ == '__main__':
    main()
