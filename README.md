# FretFree

A complete static sheet-music library and private ABC notation workspace for GitHub Pages. No accounts, API keys, server, ads, remote soundfonts, or build step. All playable notation, original score assets, and the abcjs engine are bundled locally.

## Publish

Unzip this package into the root of a GitHub repository. Keep `.nojekyll`. In **Settings → Pages**, deploy from the branch and root folder containing `index.html`. Relative asset paths work at a project URL such as `https://username.github.io/fretfree/`. For local testing, run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`.

## Library and permissions

See `scripts/library-stats.json` for exact counts and license versions. The original 841 score IDs and notation are retained. New editions use stable collection-specific IDs. Exact edition IDs/source URLs are deduplicated; different credited editions or settings of the same composition remain distinct.

- **O’Neill’s Music of Ireland (1903), 1,850 collection:** traditional historical tunes; modern ABC transcriptions are **GPL-2.0-or-later**, not public-domain notation. Original ABC bytes, source hashes, project contributor list, per-file transcriber credits where identified, copyright notice, and GPL v2 text are included. The separate 1,001 collection was not imported.
- **Open Hymnal:** only settings with an unqualified per-score public-domain declaration are admitted. The studio shows an **extracted upper voice**, with lyrics and lower voices omitted; some upper voices contain chords. Complete original ABC, including words, accompaniment, and declarations, remains available unchanged. Restricted settings are excluded. The endpoint named `OpenHymnal2014.06-abc.zip` currently contains later revisions as well; source revision text is retained rather than inferred from the archive filename.
- **Mutopia:** complete original PDFs and MIDI, editable LilyPond files or source ZIPs, contributors, edition provenance, hashes, and exact edition licenses. The editable studio part is an **upper-part practice reduction**, up to 32 bars, derived from MIDI and quantized to sixteenth notes. It omits accompaniment and performance markings. PDF/MIDI/source files are unchanged. Modern CC editions are labeled as licensed editions, separately from public-domain editions.
- **FretFree originals and teaching notation:** CC0-1.0 as in the baseline.

Filter by collection, exact notation/edition license, genre, difficulty, and score type. Search also includes collection and contributor credits. Accepted license families are PD, CC0, CC BY, CC BY-SA, and GPL. Actual versions are preserved; no licenses are silently upgraded. Difficulty labels are estimates.

**▶ Listen** on a library card plays the line of music shown on the card (up to 20 seconds) and lights up its notes, so students can hear a tune before opening it. It uses the instrument filter's sound, or piano when no instrument is chosen. One preview plays at a time; click again, open a score, or leave the library to stop it.

Public-domain declarations follow the source’s United States context. A public-domain composition does not make a modern transcription or arrangement public domain. Consult each edition’s rights notice and `catalog-rights.json` when sharing.

## Edit, play, and export

- Drag notes vertically to change pitch. Chords move together; rhythms and source positions are retained.
- Click a sheet-music note to select its **original concert-pitch ABC** and choose its starting measure, including transposing instruments.
- **Play from a note**: double-click it, press <kbd>Space</kbd> with it selected (Space again stops), or choose **▶ Play from here** in its menu. Count-in applies; playback runs to the end of the practice range, or of the tune when the note is past it.
- **Note names** (Off / Letters / Do re mi) print under each note in written pitch. Do re mi is movable do: do-based in major, la-based in minor, with sharp syllables for notes raised against the key signature and flat syllables for lowered ones. Display only; the ABC source never changes.
- **Fingering**: Guitar shows tablature (standard tuning, via abcjs); Recorder shows baroque soprano recorder hole diagrams (thumb, then holes 1–7) for the beginner range C to D′ plus F♯ and B♭. Both can be switched off, appear in prints and SVG exports, and never change the source.
- **Writing prompts** (✎ Writing prompts in the studio): nine short assignments, beginner to intermediate, such as *"Write 4 bars in G major that move only by step. End on G."* Each opens a score with the right key, meter and tempo and one whole-bar rest per bar. Typing note letters on a rest writes over it (as in MuseScore), so bars stay full; the leftover rest stays selected. A checklist of goals (filled bars, allowed note lengths, start/end note, staying in key, steps, range, leaps, required notes or rests) ticks off live. Keys are written pitch, so a B♭ clarinet asked for G major sees G major. The prompt stays attached when the score is saved. Each prompt has an example melody that `tests/check.cjs` verifies against its goals.
- **Keyboard note entry** (MuseScore-style): click a note, then <kbd>A</kbd>–<kbd>G</kbd> add notes after it in the nearest octave (letters are the written pitch for transposing instruments), <kbd>R</kbd>/<kbd>0</kbd> a rest, <kbd>3</kbd>–<kbd>7</kbd> set the length from 16th to whole, <kbd>.</kbd> dots, <kbd>↑</kbd><kbd>↓</kbd> move by step (<kbd>Ctrl</kbd>: octave), <kbd>←</kbd><kbd>→</kbd> change the selection, <kbd>#</kbd> <kbd>-</kbd> <kbd>=</kbd> set sharp/flat/natural, <kbd>+</kbd> ties, <kbd>|</kbd> adds a bar line, <kbd>Delete</kbd> removes the note. The note menu also offers **Tie to next note** and **Insert after: Rest / Bar line**. Clicking a note keeps focus on the score so keys reach it; the ABC text is still selected.
- **Undo / Redo** (buttons, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y) covers every change to the score: dragging, drawing, the note menu, bar-check fixes, note buttons, header fields and typing. Each score edit is one step; a burst of typing in one place is one step. Undoing back to the opened text clears the unsaved-changes state; a new edit after undo clears redo. History resets when another score is opened.
- **Bar check** flags measures with too many or too few beats in plain words ("Measure 2 has 3 beats; 4/4 needs 4 beats. Add a quarter note or rest."), tints them on the score, and offers **Fill with a rest** for short bars or **Split the bar** when a long bar has a clean break. Pickups, section-closing bars that complete a pickup, `M:none`, multi-bar rests, tuplets and inline meter changes are understood. Library editions keep their historic irregular bars without warnings; only bars the student changes are checked. Overlays never appear in prints or SVG exports.
- Practise a range of measures: click a note to set the start and Shift+click another to set the end (or type them), and the range is shaded on the score. **Loop** repeats it with no gap; **Metronome** clicks every beat, accented on beat one (compound meters count dotted beats); **Count-in** plays one bar first. **Speed trainer** raises the speed by 2, 5 or 10% after each pass until it reaches the goal. These toggles are remembered in the browser.
- Play from a chosen measure; speed is a percentage of the score’s original tempo. The speed slider preserves the ABC `Q:` tempo; the separate BPM control edits it.
- ABC exports preserve credits, exact licenses, source references, and change notices. FretFree ABC reimports restore this rights metadata. Exporting an imported credited ABC again replaces its notice block rather than multiplying notices.
- MIDI exports contain copyright/text events with credits and the corresponding editable ABC. Musical notes and timing are unchanged. Exported files use MIDI format 1 when a metadata track is added.
- SVG exports include every engraved SVG section, visible credits, and embedded editable ABC metadata.
- Print/PDF exports retain the rights notice and links. GPL scores additionally print the editable ABC and complete GPL v2 text as an appendix. Keep these pages with redistributed copies.
- When distributing CC BY adaptations, preserve attribution, license, source, and change notices. CC BY-SA adaptations also retain the same edition license. GPL derivatives retain credits, license, change notices, and corresponding editable source. The app’s MIT code license does not replace music licenses.

Piano selections do not generate accompaniment; Guitar shows tablature and Recorder shows fingering diagrams (see Fingering above). Sound is synthesized locally. Instrument selection changes written pitch/clef while MIDI stays in concert pitch (bass-range instruments sound an octave lower in playback).

## Saved-score compatibility

The keys remain exactly:

```
commonnote-scores-v1
commonnote-favorites-v1
```

The update performs no migration, clearing, or ID replacement. Existing saved ABC and favorites remain intact. Added metadata also survives saving new scores. Storage belongs to the browser and origin: use the same hosting origin to retain it, and export ABC backups before clearing browser data or moving to another host.

## Source audit and validation

`catalog-rights.json` records per-edition rights; `provenance/` preserves listing evidence; `scores/<id>/` preserves original assets and `RIGHTS.txt`; `licenses/` retains collection notices and license texts. `scripts/` includes import inputs, exclusions, duplicate reports, and library statistics. `VALIDATION.md` records the completed checks.

Tests (development dependencies are not required to host):

```
npm install --no-save playwright jsdom
npx playwright install chromium
node tests/check.cjs
node tests/library-ui.cjs
node tests/editor-playback.cjs
```

With the local HTTP server running:

```
node tests/browser.cjs
node tests/rights-browser.cjs
```

Before committing a change to any `.js` or `.css` file, run `node scripts/bump-version.cjs`. It stamps every local script and stylesheet in `index.html` with `?v=` set to a hash of their contents, so visitors get fresh code exactly when it changes, without a hard refresh. `tests/check.cjs` fails if any stamp is missing or no longer matches the files.

Set `CHROMIUM_PATH` to an existing Chromium executable if needed. The browser tests cover native note dragging and its pixel ratio, draw mode, the note properties menu, playback note highlighting, practice ranges, gapless loops, the speed trainer, metronome and count-in, the bar check and its fixes, undo/redo, keyboard note entry, writing prompts, play from a note, note names, guitar tab, recorder fingering, correct ABC selection, transposition, measure playback, percent speed, legacy storage, mobile width, all-score engraving, filters, and rights-preserving exports.

## Anthology investigation

The Public Domain Song Anthology’s official publication confirms unrestricted reuse, and the UVA dataset identifies CC0-1.0. However, Dataverse dataset/API/export downloads returned HTTP 403, as did the official Fulcrum XML archive and UVA Libra download. No anthology songs or placeholder entries are counted in this package. See `scripts/anthology-investigation.json` for official endpoints and results.

## Code license

FretFree code and abcjs use MIT; see `LICENSE` and `vendor/`. Music rights apply **per edition**, independently of the code license.
