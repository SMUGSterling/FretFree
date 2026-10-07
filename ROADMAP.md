# FretFree roadmap: features borrowed from Noteflight

Written 2026-10-06. This list compares Noteflight's editor, playback, classroom (Learn) and sharing features with what FretFree already has. It picks the features worth adapting to FretFree's rules: a static GitHub Pages site with no build step, server, accounts, API keys, ads or third-party requests at runtime. Sound is synthesized locally, ABC text stays the only source of truth, credits and licence notices survive every export, and the audience is students and teachers on school devices.

Items FretFree already covers are left out. These include keyboard note entry, draw mode with a ghost notehead, the note menu, undo/redo, practice ranges with loop/metronome/count-in/speed trainer, playback highlighting, note names, guitar tab, recorder fingering, writing prompts, share links, backup/restore, and ABC/MIDI/SVG/print exports with credits.

Server features become link- or file-based equivalents. SoundCheck becomes on-device pitch detection, and recordings stay in IndexedDB.

## Verified while planning

These facts were checked against the code and the vendored abcjs 6.5.2 (`node` probes against `vendor/abcjs-basic-min.js` and `score-tools.js`):

- abcjs MIDI already reflects markings, and FretFree plays MIDI velocity, so the main gap for these is entry, not playback:
  - `!pp!`/`!ff!` change velocity (45 vs 110).
  - `!crescendo(!` ramps it.
  - Staccato shortens notes (0.6 of value).
  - `!accent!` is louder.
  - Grace notes, trills, triplets and repeats with 1st/2nd endings all play.
- abcjs MIDI does **not** follow `!D.S.!` jumps and does not hold fermatas.
- `ABCJS.strTranspose` moves key signatures and chord symbols (`"F" "Bb" "C7" "Dm/A"` up a tone gives `"G" "C" "D7" "Em/B"`).
- These parse without warnings: `!marcato!`, `!wedge!`, `!upbow!`, `!downbow!`, `!segno!`, `!coda!`, `!fine!`, `!D.C.!`, `!D.S.alcoda!`, `!D.C.alfine!`, hairpins, `!sfz!`, `!mp!`, `!trill(!`, `!mordent!`, `!turn!`, `!arpeggio!`, `!glissando(!`, inline `[P:A]`, `[K:clef=bass]`, `[K:clef=treble-8]`, `(5:4:5`, `%%score {RH LH}`, `%%MIDI program`, `%%percmap`, `%%MIDI swing 66`, `Q:"Swing" 1/4=120` (the text is kept as `preString`), `clef=perc stafflines=1`, and `%%text` lines.
- These produce warnings: `!8va(!`, `!tremolo!`, `!fp!`, `!staccatissimo!` (use `!wedge!`), and unknown directives such as `%%fretfree-...`.
- `NOTE_PARTS` (score-tools.js:122) rejects a leading `(`. Note edits on slur-start and tuplet-start notes silently do nothing.
- `addBars` (editor.js:800) extends only the last `|]`, so in a multi-voice score only the last voice grows.
- The Key select rewrites `K:` without moving notes and drops `clef=`. The BPM slider rewrites `Q:` as `1/4=N` and drops tempo text. The Volume slider stops playback (app.js:170). Every note connects straight to `audio.destination`.
- `engraver.rangeHighlight(start, end)` highlights every element overlapping the character range, so it can show a multi-note selection.
- Notes on the abcjs SVG:
  - Chord symbols have the class `abcjs-chord`.
  - Drag/draw maths assume the default abcjs scale (`STAFF_STEP = 93/24`).
  - Zoom must change `staffwidth`, not `scale` or CSS transforms.

## Plan

**Status, 2026-10-07:** 36 of 40 items are done. Each was implemented on its own branch, reviewed adversarially, fixed and merged with the full test suite passing; see CHANGELOG.md for what each one does. Still to do: `multi-part-scores`, `guitar-ukulele-tools`, `midi-import`, `percussion-staff`. Also done outside this list: x/2-meter tempo (2/2, 3/2, C| and other meters now play at their written tempo), a score-first studio layout, and a cross-feature integration audit with fixes.

Known follow-ups found in review:

- Range delete across the join of two neighbouring slurs (`(C D) (E F)`, delete D–E) can leave one-note slurs.
- Deleting a single note that carries a hairpin or trill-line end leaves the line half open; range delete already handles this.
- MusicXML import does not read combined choral part names (`Soprano/Alto`, `Sopranos and Altos`) as Voice.
- abcjs: after a tuplet of uneven notes the highlight drifts from the sound, and its MIDI can drop a repeated pitch inside a triplet or a tie into a rest.
- abcjs plays trills, mordents and turns with fixed neighbour notes, whatever the key.
- The BPM control shows 100 for scores without `Q:`, which play at quarter = 180.

Effort: S is about half a focused session, M is one session, L is two or three, and XL is more. Priority: P0 has high value and fits one session with tests. P1 has high value but is larger. P2 is nice to have. The list is in recommended implementation order.

| # | ID | Title | Noteflight equivalent | Priority | Effort | Status |
|---|----|-------|----------------------|----------|--------|--------|
| 1 | note-prefix-parsing | Edit notes that start a slur or tuplet | Prerequisite for slurs, tuplets, articulations | P0 | S | Done |
| 2 | audio-bus-and-audition | Master audio bus, live volume, note audition | Mixer Master tab; note audition | P0 | S | Done |
| 3 | notation-palette | Notation palette with live selection state | Duration palette with live highlighting; unified palettes | P0 | M | Done |
| 4 | articulations-dynamics | Articulations, dynamics and ornaments | Articulation shortcuts; typed dynamics; ornaments | P0 | M | Done |
| 5 | chord-symbols | Chord symbol entry and chord playback toggle | Chord symbol entry (K) | P0 | M | Done |
| 6 | range-selection-clipboard | Range selection, copy, paste, duplicate | Selections; cut/copy/paste; repeat selection (R); [ ] augmentation | P0 | M | Done |
| 7 | transpose-and-key-changes | Transpose tool, full key and meter lists | Transpose dialog; Change Key dialog with modes | P0 | M | Done |
| 8 | zoom-and-layout | Zoom and measures per line | Zoom/fit; system layout | P0 | S | Done |
| 9 | draft-recovery | Unsaved-work recovery | Crash recovery prompt | P0 | S | Done |
| 10 | score-templates | New score setup and ensemble templates | New score from template; pickup setup | P0 | M | Done |
| 11 | assignment-links | Teacher-written assignments in a link | Activity templates; Show Prompt | P0 | M | Done |
| 12 | on-screen-piano | On-screen piano keyboard | Piano keyboard palette; Shift+letter chords | P0 | M | Done |
| 13 | classroom-colors | Classroom colors and note names in noteheads | Classroom Colors; Note Name noteheads | P1 | S | Done |
| 14 | web-midi-input | MIDI keyboard step entry and enharmonic respelling | MIDI step entry; Enharmonic shift (Z) | P1 | S | Done |
| 15 | slurs-and-hairpins | Slurs, hairpins and trill lines over a selection | Slurs (S); hairpins over a selection | P1 | S | Done |
| 16 | tuplets-and-grace-notes | Triplets, other tuplets and grace notes | Tuplets by number key; grace notes | P1 | M | Done |
| 17 | measure-and-form-tools | Measure, meter, key, clef, bar line and repeat tools | Measure palette; Repeat palette; rehearsal letters | P1 | M | Done |
| 18 | concert-pitch-toggle | Concert pitch view | Show in Concert Pitch | P1 | S | Done |
| 19 | mixer | Mixer for voices, chords and metronome | Mixer Parts tab | P1 | M | Done |
| 20 | swing-playback | Swing feel | Swing playback | P1 | S | Done |
| 21 | instrument-sounds | Better synthesized timbres and more instruments | Per-part instrument sounds | P1 | M | Done |
| 22 | wav-export | Audio export (WAV) | WAV/MP3 export; mixer-controlled export | P1 | M | Done |
| 23 | lyrics-entry | Lyrics entry | Lyrics keystrokes, verses, melisma | P1 | L | Done |
| 24 | accessible-editing | Screen-reader announcements and a shortcut sheet | Shortcut reference; Editor Guide search | P1 | S | Done |
| 25 | version-history | Version history for saved scores | Versions panel | P1 | M | Done |
| 26 | embed-and-qr | Embed code and QR code for share links | Embed score with playback; share link | P1 | M | Done |
| 27 | turn-in-and-inbox | Turn in and a teacher submissions inbox | Turn In; template copies roster | P1 | M | Done |
| 28 | musicxml-export | MusicXML export | MusicXML export | P1 | L | Done |
| 29 | musicxml-import | MusicXML import | MusicXML import | P1 | L | Done |
| 30 | record-yourself | Record yourself along with the score | Record Mode / Audio Sync; setup wizard | P1 | M | Done |
| 31 | mic-assessment | Play-along check (on-device assessment) | SoundCheck | P1 | L | Done |
| 32 | pwa-offline | Install as an app and work offline | Access anywhere (adapted) | P1 | M | Done |
| 33 | multi-part-scores | Parts with their own instruments | Parts panel; Edit Part; part view; print parts | P1 | XL | Follow-up |
| 34 | bar-preserving-edits | Keep bars full when changing lengths | Duration palette rules; delete-to-rest | P2 | M | Done |
| 35 | dark-mode | Dark theme | None (platform request) | P2 | M | Done |
| 36 | guitar-ukulele-tools | Chord diagrams and fretboard entry | Chord diagrams; fretboard palette | P2 | M | Follow-up |
| 37 | roadmap-playback | D.C., D.S., Coda, Fine and fermata playback | Road-map playback; expressive fermatas | P2 | L | Done |
| 38 | feedback-marks | Teacher feedback marks on notes | Annotations; note coloring for feedback | P2 | M | Done |
| 39 | midi-import | MIDI file import | MIDI import | P2 | L | Follow-up |
| 40 | percussion-staff | Rhythm and drum staves | Drum kit staff; slash/x noteheads | P2 | M | Follow-up |

## Rules for every item

- Musical data lives in the ABC (`$('abc').value`, concert pitch). Display-only features go in `writtenABC()` transforms or SVG overlays drawn after `renderAbc`. A display transform must never add or remove note or bar elements, because `sourceMap` pairs elements by ordinal.
- Edit the score through `applyNoteEdit`/`insertAt`/`fillRest`, or call `flushTyping()` and then `render()`, so each change is one undo step. Guard stale renders with the `renderedSource !== $('abc').value` pattern.
- `render()` calls `stop()`. Anything drawn during playback (assessment marks, keyboard lights) must change the DOM without re-rendering.
- New overlays that must not export are added to the strip selector in rights-tools.js:121 and hidden in `@media print`. Every new export path carries `exportCredit`, and `tests/rights-browser.cjs` asserts the licence string for every licence.
- Share payloads stay `v: 1`; add optional keys only. Storage keys use the `fretfree-` prefix through `KEYS`. Settings that should travel go in `BACKUP_SETTING_KEYS()` and `applyStoredSettings()`. Never touch `commonnote-*` keys.
- A new script goes in four places: index.html (before app.js), both jsdom load lists (tests/library-ui.cjs, tests/editor-playback.cjs), and the package.json format lists. Guard optional globals with `typeof`.
- Web Audio: keep one OscillatorNode per note, keep `'square'` for metronome clicks only, and feature-detect every node type FakeAudio lacks.
- Before committing, run `node scripts/bump-version.cjs` and `npm run format`, then add a CHANGELOG entry (`# Name · YYYY-MM-DD`) and a README bullet.

### Key reservations

These keys are reserved so parallel work does not collide. Existing keys: A–G, R/0, 3–7, `.`, arrows, Ctrl+↑↓, `#` `-` `=`, `+`, `|`, Delete, Escape, Space.

| Key | Item | Action |
|-----|------|--------|
| K | chord-symbols | Edit the chord symbol |
| L | lyrics-entry | Enter lyrics |
| S | slurs-and-hairpins | Toggle slur |
| T | tuplets-and-grace-notes | Make triplet |
| Z | web-midi-input | Respell enharmonically |
| Shift+A–G | on-screen-piano | Add a pitch to the selected chord |
| `;` `:` `>` `"` `^` | articulations-dynamics | Staccato, tenuto, accent, marcato, fermata |
| `[` `]` | range-selection-clipboard | Halve / double lengths |
| Shift+←→, Ctrl/Cmd+A/C/X/V/D | range-selection-clipboard | Extend selection; select all, copy, cut, paste, duplicate |
| `?` | accessible-editing | Shortcut sheet |

### Suggested parallel lanes

Lanes are grouped by file ownership to keep merges small:

- **A, notation editing** (editor.js, new palette.js, note helpers in score-tools.js): 1, 3, 4, 5, 6, then 15, 16, 17, 23, 34.
- **B, audio** (playback.js, instruments in catalog.js): 2, 19, 20, 21, 22, then 37.
- **C, input devices** (new keyboard.js): 12, 14, then 36, 39.
- **D, score setup and platform** (app.js, shared.js, backup.js): 7, 8, 9, 10, 18, 25, 32, 35.
- **E, classroom** (new assignments.js, record.js, assess.js): 11, 13, 26, 27, 30, 31, 38.
- **F, interchange** (new musicxml.js): 28, 29.

Expected conflicts:

- **`?v=` stamps:** re-run bump-version after each merge.
- **Other shared files:** the end of style.css, the top of CHANGELOG.md, README feature bullets, the render() hook list in editor.js, and `scoreKey`.

## Items

### 1. Edit notes that start a slur or tuplet (`note-prefix-parsing`)
P0 · S · Depends on: none · Noteflight: prerequisite for slurs, tuplets and articulation toggles

**Value.** The note menu, keyboard and any future palette silently do nothing on a note written `(C` (slur start) or `(3C` (first note of a triplet), because `NOTE_PARTS` does not accept `(` in the prefix. Every notation item below edits note prefixes, so this is fixed first.

**Design.**
- Extend the prefix group of `NOTE_PARTS` (score-tools.js:122). It should accept, mixed in any order with decorations and annotations:
  - slur openings `(` that are not followed by a digit;
  - tuplet specs `(p`, `(p:q` and `(p:q:r`.
- Keep `pre` ordering so chord symbols stay first. `post` already captures `)` and ties.
- Add check.cjs cases for `noteParts`/`editNoteText` on `(C`, `(3C/2`, `(3:2:3C`, `"G"!f!(C`, `C)` and `([CE]`.
- Add an editor-playback.cjs case that edits a slur-start note through `editNote`.

**Files.** score-tools.js, tests/check.cjs, tests/editor-playback.cjs, CHANGELOG.md

**Acceptance.**
- `noteParts` returns a result for `(C`, `(3C`, `(3:2:3C`, `"G"(C` and `!f!(C`, with the `(` or `(3` in `pre`.
- Length, dot, accidental and tie edits from the note menu and keyboard change slur-start and tuplet-start notes and keep the `(` or `(3` in place.
- `editNoteText('C)', {length: 2})` returns `C2)`.
- All existing suites pass unchanged.

### 2. Master audio bus, live volume and note audition (`audio-bus-and-audition`)
P0 · S · Depends on: none · Noteflight: Mixer Master tab (overall gain); note audition while entering or selecting

**Value.** Three problems today:
- Moving the volume slider stops playback.
- Chords plus accompaniment can clip, because every oscillator goes straight to the speakers.
- Students hear nothing when they enter or click a note, which Noteflight does instantly.

This bus is also the foundation for the mixer, WAV export and recording.

**Design.**
- In playback.js, add `outputNode(ctx = audio)`. It lazily builds a master GainNode and, where `createDynamicsCompressor` exists, a limiter, cached per context.
- `scheduleNotes` and `click` connect to it instead of `audio.destination`.
- The master gain follows `#volume` live, so the stop-on-volume handler at app.js:170 is removed. Per-note gain keeps the velocity scaling.
- Add `auditionPitches(midis)`. It resumes the context and schedules a short note into a separate node list. It never touches `playing` and is skipped while playback runs.
- Call it from editor.js after a click selects a note, after A–G entry, draw mode, `fillRest`, ↑/↓ and drag. Concert MIDI comes from `noteLabels(original, 'letters')` keyed by `startChar`, with playback's octave rule.
- Add a "Hear notes" checkbox (KEYS.audition = `fretfree-audition`, default on) to `BACKUP_SETTING_KEYS` and `applyStoredSettings`.

**Files.** playback.js, editor.js, app.js, shared.js, backup.js, index.html, tests/editor-playback.cjs, tests/browser.cjs

**Acceptance.**
- Moving Volume during playback changes loudness without stopping.
- All notes and clicks route through one master gain node.
- Clicking a note, typing A–G, drawing, or pressing ↑/↓ plays the resulting pitches once when Hear notes is on. Nothing plays when it is off or during playback.
- Audition uses concert pitch with the same octave rule as playback (a cello note sounds an octave below the source).
- The setting persists and is in backups.
- Metronome clicks stay the only `square` oscillators, and existing oscillator-count tests pass.

### 3. Notation palette with live selection state (`notation-palette`)
P0 · M · Depends on: note-prefix-parsing · Noteflight: duration palette with live state highlighting; unified palette system

**Value.** Editing relies on hidden shortcuts and a right-click menu that Chromebook and iPad users rarely find. A visible toolbar that lights up the selected note's length, dot, tie and accidental shows the state at a glance and gives every edit a touch target. Later items add their groups to it.

**Design.**
- Add a new file palette.js, loaded after editor.js.
- Markup: `<div id="palette" role="toolbar" aria-label="Notation">` between `#bar-check` and `.notation-paper`.
- Groups (each `role="group"`):
  - **Length:** whole to 16th.
  - **Dot**, **Tie**, **Rest:** Rest uses a new `to-rest` action that replaces the core with `z` and keeps the length.
  - **Accidental:** ♯ ♭ ♮ none.
  - **Beam:** join to the next note by removing the whitespace between them; break by inserting a space.
  - **Delete.**
- Buttons use a new `data-palette="len:0.25"` attribute (not `data-token` or `data-edit`, which other delegates own). They route to `editNote`.
- With nothing selected, Length buttons set `inputLength` like keys 3–7.
- `updatePalette()` runs at the end of `render()` (guarded with `typeof`) and after `scoreClick`, `selectEntry` and Escape. It reads state from `noteParts` on the selected source text and sets `aria-pressed`.
- Fix the `editNote` fall-through so an unknown action returns instead of writing `NaN`.
- Buttons are at least 40 px. The toolbar wraps at 720 px and is hidden in print.

**Files.** palette.js (new), editor.js, index.html, style.css, package.json, tests/editor-playback.cjs, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- The toolbar shows above the score at 1280 px and 390 px with no horizontal page scroll.
- Selecting a dotted quarter G♯ tied to the next note shows Quarter, Dot, Tie and ♯ pressed. A rest shows only its length.
- Each button makes the same ABC edit as the matching note-menu item or key, as one undo step.
- With nothing selected, a Length button sets the next note's length and says so in the status line.
- An unknown `editNote` action no longer writes `NaN` (test).
- The script is listed in index.html, both jsdom load lists and both package.json format lists.

### 4. Articulations, dynamics and ornaments (`articulations-dynamics`)
P0 · M · Depends on: note-prefix-parsing, notation-palette · Noteflight: articulation shortcuts and palette; typed dynamics that drive playback; trill, mordent, turn

**Value.** Students cannot add staccato, accents or dynamics without knowing ABC decoration syntax. Playback already honours these marks (verified), so the gap is entry.

**Design.**
- Pure helpers in score-tools.js:
  - `toggleDecoration(text, name)` adds or removes `!name!` in the note's `pre` part, after chord symbols and annotations, and recognises the shorthands `.` (staccato), `H` (fermata), `L` (accent) and `T` (trill).
  - `setDynamic(text, dyn | null)` replaces any existing dynamic.
- Marks:
  - Articulations: staccato, tenuto, accent, marcato, `wedge` (staccatissimo), fermata, up bow, down bow, breath.
  - Ornaments: trill, mordent, turn, arpeggio.
  - Dynamics: ppp, pp, p, mp, mf, f, ff, fff, sfz. `fp` is unsupported by abcjs and is left out.
- `editNote` actions `deco:<name>` and `dyn:<name>`, handled before the length branch.
- Palette groups Articulation and Dynamics, plus a note-menu section.
- Keys in `scoreKey`: `;` staccato, `:` tenuto, `>` accent, `"` marcato, `^` fermata. Dynamics may go on rests; articulations only on notes. Once range selection lands, marks apply to every selected note.

**Files.** score-tools.js, palette.js, editor.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- `toggleDecoration('"G"C2', 'accent')` returns `"G"!accent!C2`, and toggling again restores the input. It also works on `(C` and `[CEG]`.
- `setDynamic('!p!C', 'f')` returns `!f!C` (no stacking).
- Keys `;` `:` `>` `"` `^` toggle marks on the selected note, and palette buttons show pressed state.
- Every offered mark parses in abcjs without warnings (check.cjs loops the list).
- `!pp!C !ff!D` plays D with a higher velocity than C (parseMidi test).
- Marks survive instrument changes and the written-pitch display.

### 5. Chord symbol entry and chord playback toggle (`chord-symbols`)
P0 · M · Depends on: notation-palette · Noteflight: chord symbol entry (K) with auto-formatting, transposed with the score

**Value.** Lead sheets, harmonizing a melody and "label the chords" worksheets are core classroom tasks. abcjs already engraves `"G7"` and plays an accompaniment, but students can only type symbols as raw ABC and cannot silence the accompaniment.

**Design.**
- Pure helpers in score-tools.js:
  - `parseChordSymbol(text)` returns `{root, accidental, quality, bass}` or null. It accepts `C`, `F#m7b5`, `Bbmaj7`, `G7/B` and `N.C.`.
  - `setChordSymbol(noteText, chord | null)` replaces the first guitar-chord annotation in `pre` (a quoted string not starting with `^ _ < > @`) or inserts one at the start. Positioned annotations are left alone.
- **Entry box:** K, the palette's Chord button or the note menu opens `#chord-input` above the selected note, placed from the selectable's bounding box.
  - Enter commits. Tab commits and moves to the next note. Escape cancels. Empty removes the symbol.
  - Text that `parseChordSymbol` rejects is still written, with a hint that it will print but not play.
- **Playback toggle:** a Chords checkbox in the transport (KEYS.practice('chords'), default on, backed up).
  - It passes `chordsOff` through a new `midiBytes(source, options)` parameter.
  - MIDI export is unchanged.
- Transposition needs no work, because `strTranspose` already moves chord symbols.

**Files.** score-tools.js, editor.js, palette.js, playback.js, app.js, backup.js, index.html, style.css, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- With a note selected, K opens a box. `Bb7` + Enter writes `"Bb7"` before the note, and Tab moves on to the next note.
- Editing replaces an existing symbol, and an empty entry removes it. `"^text"` annotations are untouched.
- `parseChordSymbol` accepts C, Cm, C7, Cmaj7, Cm7b5, Cdim, Caug, Csus4, C6, C9, C/E, F#m, Bb7 and N.C., and rejects `H7` and `hello`.
- Unticking Chords removes the accompaniment channel from playback (oscillator count test). The setting persists and is backed up. MIDI export still includes chords.
- On a transposing instrument, symbols show in written pitch and stay concert in the source.

### 6. Range selection, copy, paste and duplicate (`range-selection-clipboard`)
P0 · M · Depends on: note-prefix-parsing · Noteflight: Shift+click/Ctrl+A selection; cut/copy/paste; repeat selection (R); multi-note pitch nudging; [ ] augmentation

**Value.** Students repeat bars and build sequences constantly, and today every note must be retyped. Selecting a passage to transpose, delete, copy or mark is basic editor behaviour.

**Design.**
- **Selection model.** `selectedRange` becomes a source range that can span several notes in one voice, plus a `selectionAnchor`.
  - Helpers: `selectedNotes()` and `selectNotesBetween(a, b)`.
  - `selectNotesBetween` highlights through `rangeHighlight(displayStart, displayEnd)`, which highlights by overlap (verified).
- **Extending the selection.**
  - Shift+←/→ extends it.
  - Shift+click extends it and still sets the practice range between the two measures, as it does today.
  - Ctrl/Cmd+A selects all notes of the voice.
- **Clipboard commands** go in the document keydown handler (editor.js:1372) when focus is in `#notation`:
  - Ctrl+C copies the source slice to an in-memory clip and to `navigator.clipboard` (try/catch).
  - Ctrl+X copies, then replaces each note with a rest of equal length.
  - Ctrl+V inserts after the selection. A selected rest at least as long as the clip is overwritten from its start, like `fillRest`.
  - Ctrl/Cmd+D duplicates the selection right after itself and selects the copy (Noteflight's R; FretFree's R is rest).
- **Multi-note edits**, each one `applyNoteEdit` over the range:
  - ↑/↓ and Ctrl+↑/↓ use `moveNoteText` on the slice.
  - Accidentals and marks are applied per note.
  - `[`/`]` halve or double every length.
- Copy/Paste/Duplicate palette buttons for touch.
- Pasting does not re-bar; the bar check reports overflow.

**Files.** editor.js, palette.js, index.html, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Shift+→ three times from a note selects and highlights four notes, and the textarea selection spans them.
- Ctrl+C then Ctrl+V inserts an exact copy, and one undo removes it.
- Ctrl+D twice on a one-bar selection gives three copies in a row, with the newest selected.
- Ctrl+X on two quarter notes leaves two quarter rests, and the bar check stays clean.
- ↑ moves every selected note a step, `#` sharpens all of them, and `]` doubles every length.
- Shift+click practice-range behaviour is unchanged (existing browser tests pass).
- Works without `navigator.clipboard` (jsdom) through the in-memory clip.

### 7. Transpose tool, full key and meter lists (`transpose-and-key-changes`)
P0 · M · Depends on: none · Noteflight: Transpose dialog (interval, direction, key signatures, chord symbols); Change Key Signature with mode labels

**Value.** Teachers transpose melodies for other instruments and voices daily. FretFree's Key select rewrites only the `K:` line, so notes stay put and `clef=` is lost. It also offers only 8 keys and 4 meters.

**Design.**
- **Transpose panel.** A "Transpose…" button opens `#transpose-panel`:
  - interval (m2 to P8, plus A4/d5), Up/Down, and a "To key" alternative that picks the nearest direction;
  - a "Selection only" checkbox, enabled when a range is selected.
- **Whole score:** `strTranspose` on the source as one undo step.
- **Selection only:** pure `transposeSlice(slice, key, unit, semitones)` in score-tools.js builds a mini tune with the key and `L:` in force, transposes it and returns the body. The result goes through `applyNoteEdit`.
- **Key select.** Generate the options from a constant list: 15 major and 15 minor keys plus Dorian, Phrygian, Lydian, Mixolydian and Locrian (`K:DDor`).
  - Choosing a key shows an inline choice: Transpose notes, or Keep notes (signature only).
  - `setHeader('K')` keeps `clef=` and other modifiers.
- **Meter select.** Adds 2/2, 3/8, 5/4, 6/4, 7/8, 9/8, 12/8, C, C| and none.

**Files.** editor.js, app.js, score-tools.js, index.html, style.css, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Transposing `K:F` `"F"F "Bb"G` up a major second gives `K:G` `"G"G "C"A`, as one undo step.
- Transposing a selected bar down a minor third changes only that bar.
- The key select lists 30 major/minor keys and the modes. Keep notes changes only the key value and preserves `clef=`.
- The meter select includes 2/2, 3/8, 6/4, 9/8, 12/8, C and C|.
- On a transposing instrument, the source transposes in concert pitch and the written display updates.

### 8. Zoom and measures per line (`zoom-and-layout`)
P0 · S · Depends on: none · Noteflight: zoom and fit-to-screen; system layout

**Value.** Projectors, small Chromebook screens and young readers need larger notation. Lines of six or more bars are hard to read and to tap.

**Design.**
- **Zoom.** Zoom − / 100% / + (70, 85, 100, 120, 140, 170, 200%) sets `staffwidth = round(740 / zoom)` in `engraveOptions()`. `responsive: 'resize'` keeps the SVG at panel width, so notes grow.
  - Do not use abcjs `scale` or CSS transforms. `STAFF_STEP` and `drawTarget` assume the default scale.
- **Measures per line.** A select (Auto, 2, 3, 4, 6) passes `wrap: {minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: n}`.
- Both settings persist (KEYS.zoom, KEYS.measuresPerLine) and are added to backups and `applyStoredSettings`.
- Print uses the same engraving, which allows large-print copies.

**Files.** editor.js, app.js, shared.js, backup.js, index.html, style.css, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- At 200%, noteheads are about twice as large on screen and there is no horizontal page scroll at 390 px.
- Drag (10 px per step), the draw ghost and note clicks stay accurate at 70% and 200% (browser test).
- "4 per line" engraves an 8-bar tune as two systems of 4.
- Settings persist across reloads and travel in backups.

### 9. Unsaved-work recovery (`draft-recovery`)
P0 · S · Depends on: none · Noteflight: crash recovery ("Save Changes" or discard work from a given time)

**Value.** Chromebooks discard background tabs and students close the wrong tab, so unsaved work is lost today.

**Design.**
- **What is stored.** KEYS.draft = `fretfree-draft` holds `{abc, instrument, title, prompt, sourceId, savedId, kind, at}`.
  - The edition is stored as its id (from `shareSourceId()`), not as the whole catalog object.
- **When it is written.** Debounced 2 s while dirty, from a hook after `render()`. Drafts over 500 KB are skipped, and a failed `storage.set` is ignored.
- **When it is cleared.** On save, on Discard, after a confirmed replace, and when undo returns to the clean state.
- **Restoring.** At start-up, after `newScore()`, show an in-page banner when a draft differs from its saved entry: "Unsaved work from 3:42 PM: Title. Restore / Discard".
  - The banner is deferred when the URL is a share link.
  - Restore rebuilds the item like `openSharedLink` does and sets `dirty = true`.
- Drafts are device-local and not backed up.

**Files.** app.js, editor.js, shared.js, index.html, style.css, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Edit, reload without saving: a banner offers Restore. Restore brings back the exact ABC, instrument, prompt and library credits, marked unsaved.
- Saving, Discard, or undoing to the opened text clears the draft.
- A share link opened at start-up is not covered by the banner.
- Legacy keys are untouched, and a full-quota failure does not throw.

### 10. New score setup and ensemble templates (`score-templates`)
P0 · M · Depends on: none · Noteflight: new score from template (lead sheet, piano, SATB, string quartet) with title, key, time, tempo and pickup setup

**Value.** Students and teachers need a piano grand staff, a duet, SATB or a lead sheet without writing `V:` headers by hand.

**Design.**
- **Panel.** "＋ New score" opens `#new-score-panel` with Title, Template, Key, Time signature, Tempo, Pickup (none, 1–3 beats) and Bars (1–64).
- **Templates:**
  - Melody (today's default);
  - Lead sheet (melody with an empty chord line);
  - Piano (`%%score {RH LH}`);
  - Duet (`%%score [1 2]`);
  - Melody and bass;
  - SATB (`%%score [S A T B]`, with `name=`/`snm=`);
  - String quartet (violin, violin, viola with `clef=alto`, cello with `clef=bass`).
- **Quick start.** A button keeps the one-click 8-bar melody, and `newScore()` is unchanged for tests.
- **Source builder.** Pure `templateSource({template, title, key, meter, unit, tempo, bars, pickup})` in score-tools.js.
- **Editing fixes for multi-voice scores:**
  - `addBars` adds whole-bar rests to every voice in one edit (each voice block's closing bar line).
  - Letters with nothing selected append to the first voice.
- Per-part instruments come later in multi-part-scores.

**Files.** score-tools.js, app.js, editor.js, index.html, style.css, tests/check.cjs, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Every template parses with no warnings and has the expected staves and voices. All bars are whole-bar rests that pass `barProblems`. Pickup bars are excused.
- ＋ 4 bars on the piano template adds four bars to both staves.
- Typing on a rest in the left-hand staff fills only that staff.
- The quick 8-bar melody stays one click, and existing 8-bar `z4` assertions pass.
- library-ui creates a SATB score with four named voices.

### 11. Teacher-written assignments in a link (`assignment-links`)
P0 · M · Depends on: none · Noteflight: activity templates; Show Prompt (instructions that travel with every student copy)

**Value.** The nine built-in prompts cannot be changed. Teachers want their own instructions, starter measures and goals, handed out as one link through Google Classroom or an LMS, with no accounts.

**Design.**
- **Builder panel** ("✎ Assignment"), opened from any score. Fields:
  - Title and Instructions.
  - Goal checkboxes built from the existing goal types (bars, lengths, start, end, endBar, steps, range, inKey, atLeast). Defaults come from the score: bar count, written key, meter.
- **Prompt object.** It builds `{id: 'custom-' + hashText(...), title, text, level: 'Custom', meter, unit, key, tempo, bars, goals}` with plain-language labels.
  - It is stored as `current.prompt` (an object), so saves and backups carry it.
  - `activePrompt()` replaces `promptById(current.prompt)` and accepts an id or an object.
- **Sharing.** The share payload gains optional key `q` (`p` stays for built-ins, and `v` stays 1).
- **Validation.** `openSharedLink` accepts `q` only after pure `validPrompt(q)`, which:
  - whitelists fields and goal types;
  - requires finite numbers;
  - caps text at 2,000 characters.

  All display uses `esc()`.
- **Starter music.** The teacher's ABC is the student's starting point.
- **Print.** The instructions paragraph prints above the score; the checklist does not.
- **Older apps.** They ignore `q` and open the score without the checklist.

**Files.** editor.js, score-tools.js, index.html, style.css, tests/check.cjs, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- The teacher writes instructions and picks three goals. The share link opens in a fresh page with those instructions and a live checklist of those goals.
- `validPrompt` rejects unknown goal types, non-numeric bars and oversized text. An `<img onerror>` title is shown escaped.
- A student's saved copy keeps the assignment after reload from My scores and through backup/restore.
- Built-in prompt links (`p`) still work, and payload `v` stays 1.
- Instructions print above the score; the checklist does not.

### 12. On-screen piano keyboard (`on-screen-piano`)
P0 · M · Depends on: audio-bus-and-audition · Noteflight: on-screen piano palette (enter notes and chords, shows the selected pitches); Shift+letter adds a chord note

**Value.** Students who cannot yet name notes, touch users and non-pianists can tap keys to enter and hear pitches. The keyboard also shows the selected note's pitch and lights up during playback.

**Design.**
- **Placement.** New file keyboard.js. A "Keyboard" toggle (`aria-pressed`, persisted, backed up) shows `#piano` under the score.
  - Three octaves of `<button data-piano-midi aria-label="C4">` keys sit in their own `overflow-x` container, scrolled to the selected note or the instrument's range.
- **Key to source pitch.** A key is written MIDI. Concert MIDI = written − instrument shift.
- **Spelling.** Pure `midiToken(midi, key)` in score-tools.js spells the note using `keyAlters`. In-key notes need no accidental. Otherwise it uses sharps in sharp keys and C, and flats in flat keys.
- **Entering a note.** Refactor `insertNote` into `insertCore(core, sel)`, then:
  - a selected rest is filled through `fillRest`;
  - otherwise the note is inserted after the selection.
- **Chords.**
  - Shift+tap, or holding one key while tapping others (tracked pointerdown set), adds pitches to the selected note through pure `addChordPitch(noteText, core)`: `C2` becomes `[CE]2`.
  - Shift+A–G does the same from the computer keyboard.
- **Lights.** Keys for the selected note get `.held`. A small hook in `startFollow` lights sounding keys without re-rendering.
- **Sound.** Each tap auditions its pitch.

**Files.** keyboard.js (new), score-tools.js, editor.js, playback.js, app.js, backup.js, index.html, style.css, package.json, tests/check.cjs, tests/editor-playback.cjs, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Tapping E4 with a quarter rest selected writes E over it, and tapping in sequence enters a melody.
- Spelling by key:
  - In F major, the black key between A and B enters `B` (no accidental).
  - In G major, the F♯ key enters `F`.
  - In C major, the C♯ key enters `^C`.
- On Clarinet in B♭, tapping written D4 writes concert `C`.
- Shift+tap and Shift+E both turn `C` into `[CE]`.
- The selected note's keys are lit, and keys light during playback.
- No horizontal page scroll at 390 px. Hidden in print. The preference persists.

### 13. Classroom colors and note names in noteheads (`classroom-colors`)
P1 · S · Depends on: none · Noteflight: Classroom Colors (Boomwhacker) palette; Note Name noteheads

**Value.** Elementary general-music classes read by Boomwhacker and handbell colors, and beginners benefit from letters inside noteheads.

**Design.**
- **Settings.** Add "Colors: Off / Classroom", and add "Letters in noteheads" to the Note names select. Both are persisted and backed up.
- **Drawing.** After `renderAbc`, `updateNoteColors(display)` walks `engraver.selectables` like `updateFingering` does.
  - It pairs each `.abcjs-notehead` (sorted by y, bottom to top) with the element's pitches (sorted ascending) and sets `fill`.
  - Colors: C red, D orange, E yellow with a dark outline, F green, G light blue, A dark blue, B purple. Accidentals keep their letter's color.
- **Letters.** "Letters in noteheads" adds an SVG `<text>` centered on each notehead, in black or white for contrast, using the written letter.
- **Output.** Both are kept in print and SVG export (worksheet use), so they are not added to the strip list.

**Files.** editor.js, app.js, backup.js, index.html, style.css, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Every C notehead is red and every G is light blue, in all octaves and inside chords. Stems and rests are unchanged.
- Letters show the written letter for transposing instruments.
- The ABC source is byte-identical before and after toggling.
- Colors appear in print and SVG export. Settings persist and are backed up.

### 14. MIDI keyboard step entry and enharmonic respelling (`web-midi-input`)
P1 · S · Depends on: on-screen-piano · Noteflight: MIDI controller step entry; Enharmonic shift (Z)

**Value.** Students with a USB keyboard enter notes and chords far faster than with a mouse. Z fixes sharp/flat spelling after MIDI, piano or transposed entry.

**Design.**
- **MIDI input** (in keyboard.js).
  - A "MIDI input" toggle appears only when `navigator.requestMIDIAccess` exists. It calls `requestMIDIAccess({sysex: false})` and listens to note-on from every input.
  - Notes within 40 ms form a chord. Each group goes through the on-screen piano's entry path (written MIDI to concert) at the current input length, and lights the piano keys.
  - A status line names connected devices, and `onstatechange` updates it.
- **Respelling.** Pure `respell(noteText, key)` cycles each pitch among its sharp, flat and natural spellings, keeping length and decorations. The Z key applies it to the selection.

**Files.** keyboard.js, score-tools.js, editor.js, index.html, tests/check.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- With a mocked MIDI input, note-on 60 then 64 (100 ms apart) enters C then E. 60, 64 and 67 within 40 ms enter `[CEG]`.
- The toggle is hidden without Web MIDI. Denied permission shows a plain message. No SysEx is requested.
- Z turns `^C` into `_D` and back, and works on chords.

### 15. Slurs, hairpins and trill lines over a selection (`slurs-and-hairpins`)
P1 · S · Depends on: range-selection-clipboard, articulations-dynamics · Noteflight: slurs (S); hairpins and cresc./dim. over a selection

**Value.** Phrasing and dynamic shape are part of most assignments and every method-book piece.

**Design.**
- Pure helpers in score-tools.js:
  - `toggleSlur(abc, firstNote, lastNote)` inserts `(` before the first note (after its decorations) and `)` after the last note's length, or removes a matching pair.
  - `toggleSpan(abc, first, last, 'crescendo' | 'diminuendo' | 'trill')` writes `!<(!` … `!<)!`, `!>(!` … `!>)!` or `!trill(!` … `!trill)!`.
- S toggles a slur. With one note selected, the slur goes to the next note.
- A palette Lines group offers Slur, Crescendo, Diminuendo and Trill line.

**Files.** score-tools.js, editor.js, palette.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Four selected notes plus S give `(` … `)`, and S again removes them. Each is one undo step.
- A crescendo over a range writes the decorations, and parseMidi velocities rise across it.
- Slurs and hairpins parse cleanly and survive transposition.
- Note edits on slurred notes keep working.

### 16. Triplets, other tuplets and grace notes (`tuplets-and-grace-notes`)
P1 · M · Depends on: note-prefix-parsing, notation-palette · Noteflight: tuplets by number key; grace notes and appoggiaturas

**Value.** Triplets appear throughout intermediate repertoire, and grace notes fill the O'Neill and Hardy collections. Students cannot write either without raw ABC.

**Design.**
- **Tuplets.** T or the palette's Triplet button, plus a Tuplet menu for 2, 3, 5, 6 and 7 (keys 3–7 already set lengths).
  - Pure `makeTuplet(noteText, n, unit)` turns a note into an explicit `(p:q:r` group. The original pitch becomes the first member and rests fill the rest; for example, a quarter in `L:1/4` becomes `(3C/2 z/2 z/2`.
  - `fillRest` uses the rest's own written length inside a tuplet, so letters fill members.
- **Grace notes.** "Grace note" inserts `{d}` (one step above) before the core. "Slashed" makes `{/d}`. Grace ↑/↓ moves only the grace group with `moveNoteText`. "Remove grace" clears it.

**Files.** score-tools.js, editor.js, palette.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Triplet on a quarter in `L:1/4` writes `(3C/2 z/2 z/2`. Typing D then E fills the rests, and the bar check stays clean.
- Tuplet 5 on a half note writes five members totalling a half.
- Grace adds `{d}` before C. Grace ↑/↓ moves only the grace. Remove clears it.
- All results parse cleanly and play with the expected timings.

### 17. Measure, meter, key, clef, bar line and repeat tools (`measure-and-form-tools`)
P1 · M · Depends on: notation-palette, transpose-and-key-changes · Noteflight: Measure palette; Repeat palette; rehearsal letters

**Value.** Students can only add bars at the end. Repeats, endings, double bars and mid-piece key, meter or clef changes all need raw ABC.

**Design.**
- A palette Measure group acting on the selected note's measure:
  - Insert bar before/after (whole-bar rest in the meter in force), Delete bar.
  - Meter here (`[M:3/4]`), Key here (`[K:G]`, with the Transpose/Keep choice), Clef here (`[K:clef=bass]`, alto, tenor, `treble-8`).
  - Bar line after (single, `||`, `|]`, dotted `.|`).
  - Start repeat `|:`, End repeat `:|`, 1st/2nd ending (`[1`, `[2`).
  - Segno, Coda, Fine, D.C., D.S., D.C. al Fine, D.S. al Coda (decorations on the measure's first or last note).
  - Rehearsal mark (inline `[P:A]`, next letter chosen automatically).
- Pure helpers in score-tools.js: `measureBounds(tune, voice, measure)` from `scoreEvents`, `replaceBarLine(abc, bar, type)` and `insertInlineField(abc, at, field)`.
- A selected bar line (`selectTypes` already includes bars) is restyled directly.
- Until roadmap-playback lands, a status note says playback does not follow D.C./D.S.

**Files.** score-tools.js, editor.js, palette.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Inserting a bar before measure 3 adds a correct whole-bar rest, and Delete removes measure 3. Each is one undo step.
- A meter change at measure 5 writes `[M:3/4]`, and the bar check uses 3/4 from there.
- Repeats and 1st/2nd endings engrave and play (measureStarts test).
- Double and final bar lines replace the existing bar line instead of stacking.
- Every construct parses without warnings.

### 18. Concert pitch view (`concert-pitch-toggle`)
P1 · S · Depends on: none · Noteflight: Show in Concert Pitch

**Value.** Band teachers need to see what actually sounds, and students check a transposed part against piano.

**Design.**
- A "Concert pitch" checkbox appears next to the instrument only for transposing instruments. It is persisted and backed up.
- Introduce `displayShift()` (0 in concert view). Replace direct shift reads in `writtenABC`, `letterToken`, `drawNote`, `accidentalEdit`, `writtenNote`, `transposing()`, `updateCaption` and keyboard.js.
- Playback is unchanged.
- `updatePromptCheck` keeps judging goals in written pitch by parsing a written copy when concert view is on.

**Files.** editor.js, app.js, backup.js, index.html, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Clarinet in B♭ with Concert pitch on shows source pitches and key, and off shows written pitch. The ABC never changes.
- Letters, draw mode, accidentals and the piano enter what is shown in either view.
- Writing-prompt goals are judged in written pitch in both views.

### 19. Mixer for voices, chords and metronome (`mixer`)
P1 · M · Depends on: audio-bus-and-audition, chord-symbols · Noteflight: Mixer Parts tab (mute, solo, volume, pan, metronome track)

**Value.** Students practise one part against the others, turn the chord accompaniment down or the click up, and teachers make minus-one tracks.

**Design.**
- **Audio graph.** In playback.js, add per-channel GainNode and StereoPannerNode (guarded) into the master bus. `scheduleNotes` routes by `n.ch`, and `click` routes to a Metronome gain.
- **Tracks.** Derived per render:
  - voices from parseOnly, in staff and voice order, mapped to MIDI channels (pin the mapping with a test);
  - Chords, the channel after the last voice, when chord symbols exist;
  - Metronome.
- **Panel.** A "Mixer" panel in the transport has Mute, Solo, Volume and Pan per track. Changes apply live through `gain.value`.
- **Muted tracks.** They are not scheduled at all, which saves oscillators.
- **Storage.** State is stored on `current.mixer`, keyed by voice id, so saved scores keep it. It is not part of undo.

**Files.** playback.js, editor.js, app.js, index.html, style.css, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- A two-voice score with chord symbols lists Voice 1, Voice 2, Chords and Metronome. A one-voice score without chords lists Melody and Metronome.
- Muting Voice 2 silences it at once during playback. Solo plays only that track (plus the metronome if on).
- Volume and pan apply without restarting playback.
- Settings save with the score and survive reload from My scores.

### 20. Swing feel (`swing-playback`)
P1 · S · Depends on: none · Noteflight: swing playback setting

**Value.** Jazz band charts and many pop tunes sound wrong played straight, and students practise swing feel.

**Design.**
- **Score setting.** Feel: Straight / Light (60) / Swing (66) / Hard (75).
  - It writes the tempo text `Q:"Swing" 1/4=N` (printed on the score, as on real charts) and `%%MIDI swing N`. Both parse cleanly.
  - `setHeader('Q')` and the BPM slider must keep the tempo text.
- **Playback.** Pure `swingNotes(notes, beatSeconds, amount)` in score-tools.js delays notes that start on the off-beat eighth of a quarter beat and lengthens the on-beat partner.
  - It applies only to x/4 and x/2 meters, using tempo from parseMidi.
  - It runs in `play()` before `playbackSlice`.
- The highlight timing is left as is.

**Files.** score-tools.js, playback.js, editor.js, app.js, index.html, tests/check.cjs, tests/editor-playback.cjs, README.md, CHANGELOG.md

**Acceptance.**
- At 66, the second of two eighths at 120 BPM starts 1/3 of a beat late (oscillator start-time test).
- Straight scores schedule exactly as today.
- The BPM slider keeps "Swing" in `Q:`.

### 21. Better synthesized timbres and more instruments (`instrument-sounds`)
P1 · M · Depends on: audio-bus-and-audition · Noteflight: per-part instrument sounds (Basic/Premium sound sets); instrument list

**Value.** Every instrument sounds like a bare sine, triangle or sawtooth, so students cannot tell flute from violin. Common school instruments are also missing: voice, viola, double bass, horn in F, tenor and baritone sax, oboe, bassoon, tuba, euphonium, ukulele, bass guitar, glockenspiel.

**Design.**
- **Timbres.** Optional fields on `instruments` entries in catalog.js:
  - `partials`, a harmonic amplitude list turned into `createPeriodicWave` and cached per context, with fallback to `wave` when missing (FakeAudio);
  - `env`, which is attack/decay/sustain/release, or a pluck decay for guitar, piano, ukulele and mallets.
  - Optional vibrato only through `osc.detune` automation when present.
  - Exactly one oscillator per note, never `square`.
- **Transposition.** Separate display transposition (`shift`) from playback octave (`sound`). The default keeps today's rule: −12 only when shift is −12. New entries include Horn in F (+7), Tenor sax (+14) and Baritone sax (+21, sound −12 adjusted).
- **Captions and transposing logic.** `updateCaption` builds its text from the interval. Check `transposing()` and `startPrompt` for shifts of 12 or more.
- **Library filter.** Generate `#instrument-filter` from `instruments` instead of the hard-coded list.

**Files.** catalog.js, playback.js, editor.js, app.js, index.html, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Each instrument has a distinct timbre in browsers. FakeAudio runs still see one oscillator per note and no `square`.
- Plucked and struck instruments decay; winds and strings sustain.
- New instruments appear in the editor and the library filter from one list.
- Horn in F shows notes a fifth higher than concert and tenor sax a ninth higher. Both play concert pitch, and their captions explain it.
- The existing −12/+2/+9 transposition checks pass.

### 22. Audio export (WAV) (`wav-export`)
P1 · M · Depends on: audio-bus-and-audition · Noteflight: WAV/MP3 export; mixer selection controls export

**Value.** Students hand in or share a recording of their composition. Teachers make practice and minus-one backing tracks. Noteflight reserves this for Premium.

**Design.**
- **Rendering.**
  - `scheduleNotes`/`click` take `(ctx, out)` parameters.
  - The export renders parseMidi notes (with the Chords toggle and mixer mutes and levels) into an `OfflineAudioContext(2, len, 44100)` at the current speed.
  - An export dialog has "Include metronome" and "Include chords" options.
- **Encoding.** Pure `wavBytes(channels, sampleRate, info)` in score-tools.js writes 16-bit PCM RIFF with a LIST/INFO chunk:
  - INAM title, IART composer or attribution;
  - ICOP licence, ICMT the full `exportCredit` text, both omitted when `exportCredit` is empty.
- **Fallback.** Without `OfflineAudioContext`, a plain message.

**Files.** playback.js, score-tools.js, app.js, index.html, tests/check.cjs, tests/rights-browser.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Export WAV downloads `<title>.wav` with the same notes and tempo as playback.
- `wavBytes` writes valid RIFF sizes, 44.1 kHz and 16-bit stereo (unit test).
- Every licence edition's WAV INFO contains its licence string (rights-browser loop). Personal scores carry only title and composer.
- Muted mixer tracks are left out of the file.

### 23. Lyrics entry (`lyrics-entry`)
P1 · L · Depends on: notation-palette · Noteflight: lyrics keystrokes (start, Space, -, _, Enter for verses)

**Value.** Choirs, general music and songwriting need words under notes. abcjs engraves `w:` lines, but aligning syllables by hand is error-prone.

**Design.**
- **Entry box.** L, the palette or the note menu opens `#lyric-input` under the selected note.
  - Space commits and moves to the next note.
  - `-` commits with a hyphen. `_` writes an extender. `*` skips a note.
  - Backspace in an empty box steps back. Enter starts the next verse. Escape exits.
- **Pure helpers** in score-tools.js:
  - `lyricSlots(tune, voice)` lists the notes that carry syllables per music line, skipping rests.
  - `readLyrics(element)` reads abcjs `lyric` arrays.
  - `setSyllable(abc, line, verse, index, syllable, divider)` rebuilds the nth `w:` line after that music line, padding with `*` and preserving other verses.
- **Hints.** Inserting or deleting notes in a line with lyrics shows a hint to check alignment.

**Files.** score-tools.js, editor.js, palette.js, index.html, style.css, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Typing `Twin-kle twin-kle` from the first note writes `w: Twin-kle twin-kle` aligned to four notes.
- Enter adds a second verse on the same notes, `_` writes an extender, and rests are skipped.
- Editing one syllable changes only that syllable.
- Lyrics survive transposition, instrument change, save, share and export.

### 24. Screen-reader announcements and a shortcut sheet (`accessible-editing`)
P1 · S · Depends on: notation-palette · Noteflight: keyboard shortcuts for everything with a reference panel; Editor Guide search

**Value.** Keyboard-only and screen-reader users need to know what is selected and what each key does, and schools must meet accessibility requirements.

**Design.**
- **Announcements.** Pure `describeNote(element, measure, beat, key)` gives text like "Quarter note G4, measure 3, beat 2". It feeds the existing `role="status"` `#selection-status` on every selection and edit.
- **Shortcut table.** One `SHORTCUTS` table supplies the palette titles and a `?` dialog grouped by task.
- **Command search.** The dialog has a search box: typing filters the commands, and Enter runs the chosen one on the selection (Noteflight's Editor Guide search).
- **Focus.** The dialog traps focus and returns it to the score.

**Files.** score-tools.js, editor.js, palette.js, index.html, style.css, tests/check.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Selecting a note announces its length, written pitch, measure and beat.
- `?` opens the sheet. Typing "tie" filters to Tie, and Enter applies it.
- Every studio button has an accessible name (browser check).

### 25. Version history for saved scores (`version-history`)
P1 · M · Depends on: none · Noteflight: Versions panel (view, play, restore without losing anything)

**Value.** Students overwrite good work, and teachers want to see how a composition evolved.

**Design.**
- **Recording versions.** On Save of an existing entry whose ABC changed, push `{at, abc, instrument}` of the previous copy into KEYS.versions (`fretfree-versions`, id to list).
  - Cap: 20 versions per score and about 1.5 MB total, oldest dropped first.
  - Saving the score itself never fails because of versions.
- **History panel.** A "History (n)" button on My scores cards (`data-history`) opens a list with Preview (read-only `renderAbc` plus Play) and Restore.
  - Restore opens the old ABC as unsaved under the same id. Saving it keeps the replaced version in the list.
- **Backups.** Add a top-level `versions` key, unioned by `at`, inside the rollback set. `BACKUP_FORMAT` stays 1.
- **Deleting a score** deletes its versions.

**Files.** app.js, library.js, backup.js, shared.js, index.html, style.css, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Saving three changed copies lists two earlier versions with times.
- Restore, then Save, keeps the replaced version in the list.
- Versions travel in backups and merge without duplicates.
- Quota exhaustion never blocks saving.

### 26. Embed code and QR code for share links (`embed-and-qr`)
P1 · M · Depends on: none · Noteflight: embed score with playback (iframe); share link

**Value.** Teachers put playable scores on Google Sites, Canvas or a class blog. A QR code on the projector gets a score onto student tablets without typing.

**Design.**
- **Embed route.** A new `#e=<payload>` start-up route next to `s=` (app.js:332) decodes with `decodeShare` and adds `body.embed`. The embed view:
  - shows the read-only score, Play/Stop, speed, and the credit line with any NC label;
  - links to "Open in FretFree" (the `#s=` link, new tab);
  - writes no storage and records no played marks.
- **Share panel.** It gains an Embed tab with width and height fields and a copyable `<iframe src="…#e=…" width="100%" height="420" title="Score: …" loading="lazy"></iframe>`.
- **QR code.** Uses a vendored MIT encoder (for example qrcode-generator by Kazuhiko Arase, added under `vendor/` with its licence), rendered as SVG.
  - It is shown when the URL is at most about 2,300 bytes. Longer links get an explanation instead.

**Files.** app.js, editor.js, index.html, style.css, vendor/ (QR encoder + licence), tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- `index.html#e=…` shows only the score, transport and credits, with no editor or nav and no storage writes.
- The copied snippet works in a local HTML file.
- Library editions show credits and NC labels in the embed.
- A typical teaching tune gets a QR code, and long links get the explanation.
- The vendored licence is in `vendor/` and README credits.

### 27. Turn in and a teacher submissions inbox (`turn-in-and-inbox`)
P1 · M · Depends on: assignment-links · Noteflight: Turn In This Score; View template copies roster; score comments

**Value.** Teachers collect work from 30 students without accounts. Today each student exports ABC and the teacher opens the files one at a time.

**Design.**
- **Turn in (student).** On assignment scores, "Turn in" asks for the student's name (remembered as `fretfree-student-name`). It builds a share link whose payload adds:
  - `n` name, `t` time, `x` assignment id;
  - `g` goal results;
  - later, assessment results.

  It copies the link and offers a `.json` download.
- **Submissions view (teacher).** In My scores:
  - Paste many links (one per line) or drop files. Each is decoded and validated.
  - Rows are grouped by assignment, with student, time, goals met and bar-check count, and sort by name or goals.
  - Open shows a banner "Turned in by …", with Previous/Next to step through the class.
- **Feedback.** A teacher feedback box adds `c` text to a return link, shown to the student in a feedback panel.
- **Storage.** The inbox is KEYS.inbox (capped at 200 entries, with delete and clear) and is backed up.
- All link text goes through `esc()`.

**Files.** assignments.js (new) or editor.js, app.js, library.js, backup.js, index.html, style.css, package.json, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- Turn in copies a link with name, time and goals, and opening it shows "Turned in by <name>" and the checklist.
- Pasting 30 links lists 30 rows under the assignment. Invalid lines are reported, not fatal.
- Previous/Next steps through submissions in the studio.
- Teacher feedback text reaches the student by link.
- An XSS payload in a name is shown escaped.

### 28. MusicXML export (`musicxml-export`)
P1 · L · Depends on: none · Noteflight: MusicXML export

**Value.** Teachers and students move work into MuseScore, Noteflight, Finale, Sibelius or Dorico. MusicXML is the interchange standard, and FretFree exports only ABC, MIDI and SVG today.

**Design.**
- **Converter.** New DOM-free file musicxml.js, loaded in index.html and the check.cjs vm. `abcToMusicXML(tune, meta)` walks the `parseOnly` output:
  - parts from voices, and two-staff parts from `%%score {}`;
  - measures; divisions; pitch, with alter worked out from accidental, key and bar state;
  - durations and types, dots, ties, chords, rests, tuplets (`time-modification`), grace notes;
  - key and mode, time, clef and mid-score changes;
  - `harmony` from chord symbols, lyrics (syllabic, extend);
  - dynamics, wedges, articulations, ornaments, slurs;
  - repeats and endings, and tempo.
- **Credits.**
  - `<identification>` carries the creator, `<rights>` (licence plus credit text) and an encoding software line.
  - A page-1 `<credit>` repeats the credit text.
  - A `fretfree-rights` miscellaneous field carries the metadata JSON for re-import.
- **Download.** As `.musicxml`.

**Files.** musicxml.js (new), app.js, index.html, package.json, tests/check.cjs, tests/library-ui.cjs, tests/editor-playback.cjs, tests/rights-browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- All teaching scores and a 200-score library sample export well-formed XML whose notes, pitches and durations match the parse.
- Fixtures show chord symbols, lyrics, ties, tuplets, dynamics, repeats and endings as the right elements.
- Every licence edition's export contains its licence and credit text, and GPL editions reference the GPL (rights-browser).
- Opens in MuseScore 4 (manual check recorded in CHANGELOG).

### 29. MusicXML import (`musicxml-import`)
P1 · L · Depends on: musicxml-export · Noteflight: MusicXML import

**Value.** Students and teachers bring in pieces from MuseScore, Noteflight or publisher downloads.

**Design.**
- **File routing.** `#import-file` branches on extension.
  - `.musicxml` and `.xml` are read as text.
  - `.mxl` goes through a small local zip reader: central directory, stored or `DecompressionStream('deflate-raw')` entries, and the `META-INF/container.xml` rootfile.
- **Conversion.** `musicXMLToABC(doc)` uses standard DOM APIs on a `DOMParser` document (tested in jsdom). It covers:
  - parts to voices with names and clefs, and multi-staff parts to `%%score {}`;
  - pitches with key-aware accidentals, rests, chords, ties, tuplets, grace notes, dots;
  - mid-score key, time and clef changes, harmony, verse-1 lyrics, dynamics, basic articulations, repeats and endings, tempo.
- **Reporting.** Skipped features are listed in plain words.
- **Limits.** 5 MB cap. Malformed files never throw.
- **Metadata.** A `fretfree-rights` field restores the rights metadata.

**Files.** musicxml.js, app.js, tests/library-ui.cjs, tests/fixtures/ (CC0 MusicXML and .mxl), README.md, CHANGELOG.md

**Acceptance.**
- ABC to MusicXML to ABC keeps pitches, durations, chord symbols and lyrics for all teaching scores.
- A MuseScore-exported .mxl fixture imports with the right parts, key, meter and notes.
- Unsupported elements are reported, and malformed files show a message.
- Re-importing a FretFree export restores its rights metadata.

### 30. Record yourself along with the score (`record-yourself`)
P1 · M · Depends on: audio-bus-and-audition · Noteflight: Record Mode / Audio Sync; recording count-in; setup wizard (mic level and latency)

**Value.** Students record a performance over the accompaniment or metronome to hear themselves or hand it in. Teachers record a model.

**Design.**
- **Recording.** New file record.js. "● Record" calls `getUserMedia` with echo cancellation, noise suppression and auto gain off.
  - It counts in (a 1–2 bar setting), starts `play()`, and records the mic with MediaRecorder until playback ends or ■.
- **Storage.** Takes go to IndexedDB `fretfree-recordings` as `{id, scoreKey (savedId or hashText(abc)), at, duration, mime, blob, latencyMs}`.
- **Takes list.**
  - Play a take alone, or with the score, aligned by the recorded offset minus calibrated latency.
  - Download `<title> take 3.webm`, plus a credits .txt for library editions.
  - Delete a take. Storage use is shown from `navigator.storage.estimate`.
- **Calibration wizard.** It plays clicks and detects their onsets in the mic to estimate latency (`fretfree-latency`).
- **Backups.** Takes are not backed up, and the UI says so.

**Files.** record.js (new), playback.js, app.js, index.html, style.css, package.json, tests/library-ui.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- With permission, Record counts in, records while the score plays and stops at the end. The take is listed with its duration.
- After calibration, take plus score line up within 50 ms (offset maths unit test plus a manual check).
- Takes persist per score and can be downloaded and deleted. Nothing is uploaded.
- Denied permission or a missing MediaRecorder shows a plain message.

### 31. Play-along check (on-device assessment) (`mic-assessment`)
P1 · L · Depends on: record-yourself · Noteflight: SoundCheck (pitch %, rhythm %, stars, colored feedback graph, attempts, mark section, tempo)

**Value.** Students get immediate, private feedback on pitch and rhythm while practising, and teachers get a summary in turned-in work.

**Design.**
- **Pure functions** in score-tools.js:
  - `detectPitch(samples, sampleRate)` uses YIN and returns `{freq, clarity}` or null.
  - `expectedEvents(melodyNotes, from, until, speed)`.
  - `scoreAttempt(expected, frames, {cents, onsetMs})`:
    - per note, pitch ok and timing early/late, as green, yellow or red;
    - Pitch %, Rhythm % and 1–5 stars;
    - Easy/Medium/Hard tolerances of 50/35/25 cents and 150/100/70 ms.
- **Runtime** (assess.js):
  - An AnalyserNode on the mic is sampled every 20 ms during `play()` of the practice range.
  - Audio time maps to score time through `playOrigin`/`playClock`/`playSpeed`, minus calibrated latency.
  - It compares sounding pitch (concert, octave rule) against the melody channel.
- **Results overlay.** Colored bars under notes use `noteTimings` boxes and are drawn without `render()`. The `.assess-mark` class goes on the strip list and is hidden in print.
- **Results panel.** Percentages, stars and plain problem notes ("Measure 3, note 2: about 40 cents flat").
- **Settings and history.**
  - The practice range is the marked section, and the speed slider is the tempo.
  - Per-score attempt history is stored (`fretfree-attempts`) and added to turn-in links.
  - A follow-me wait mode is a later extension.

**Files.** assess.js (new), score-tools.js, playback.js, rights-tools.js, style.css, index.html, package.json, tests/check.cjs, tests/editor-playback.cjs, tests/library-ui.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- `detectPitch` finds 440 Hz within 3 cents and 196 Hz within 5 cents in synthetic sine and sawtooth buffers, and returns null for noise and silence.
- `scoreAttempt` scores a perfect synthetic run 100/100, marks a semitone-flat note red and a 120 ms late note yellow on Medium.
- With a Chromium fake audio stream, notes are colored and percentages shown, and no network request is made.
- Marks never appear in SVG export or print, and drawing them never stops playback.
- Attempt history persists per score and appears in turn-in links.

### 32. Install as an app and work offline (`pwa-offline`)
P1 · M · Depends on: none · Noteflight: access anywhere (adapted to offline use)

**Value.** School Wi-Fi drops and Chromebooks go home without internet. An installed FretFree opens instantly and keeps working.

**Design.**
- **Manifest.** `manifest.webmanifest` with relative URLs, local icons, `display: standalone` and theme colors.
- **Service worker** (`sw.js` at the root, scope `./`):
  - index.html is network-first with a cache fallback.
  - Local `?v=`-stamped assets are cache-first, since the stamps are immutable. The large catalogs are cached at runtime on first fetch, not at install.
  - `scores/` PDFs and MIDI are cached only when opened.
  - Old caches are dropped on activate.
- **App wiring.** Registration in app.js only on https or localhost. An Install button from `beforeinstallprompt`, and an offline notice.
- check.cjs asserts that the manifest is valid JSON and that sw.js references no external URLs.

**Files.** manifest.webmanifest (new), sw.js (new), icons (new), index.html, app.js, tests/check.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- After one online visit, offline reload opens the library, a previously opened score and the editor, and playback works.
- A new deploy is picked up within one reload.
- No request leaves the origin.
- Chrome's installability criteria are met.

### 33. Parts with their own instruments (`multi-part-scores`)
P1 · XL · Depends on: score-templates, mixer, instrument-sounds · Noteflight: Instruments/Parts panel; Edit Part (instrument, transposition); part view; print individual parts in transposition

**Value.** Ensembles need each staff to have its own instrument sound, name and transposition, and players need their own part.

**Design.**
- **Storage in ABC.** Parts are `V:` lines with `name=`, `snm=` and `clef=`, plus `%%MIDI program n` per voice. A FretFree table maps program numbers to `instruments`. Custom `%%` directives warn in abcjs, so they are avoided.
- **Parts panel.** Lists voices with name, instrument, clef, ↑↓ reorder (moves `V:` blocks and `%%score`), delete, and "Add part" (rests matching voice 1's bars and meters).
- **Written display.** `writtenABC` transposes each voice block separately inside a mini tune with the header. Transposition keeps element ordinals, so `sourceMap` still pairs correctly.
- **Per-part entry.** Entry and the note menu use the selected note's part shift.
- **Playback.** Each channel uses its part's timbre.
- **Show part.** Renders one voice. Mapping goes by voice id rather than staff index, which must be tested.
- **Print parts.** Prints each part in its own transposition, with credits.
- **Single-instrument scores.** Behave exactly as today.

**Files.** editor.js, playback.js, app.js, score-tools.js, index.html, style.css, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, tests/rights-browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- A Flute + Clarinet in B♭ duet shows the clarinet staff a tone higher with its own key, plays both at concert pitch with distinct sounds, and exports MIDI with both programs.
- Add, reorder and delete keep `V:` blocks, `%%score` and bar counts consistent.
- Click, drag, keys and the note menu work in every part with that part's written pitch.
- Show part displays one part. Print parts prints each in its transposition with credits.
- Single-instrument scores are unchanged (existing suites pass).

### 34. Keep bars full when changing lengths (`bar-preserving-edits`)
P2 · M · Depends on: notation-palette · Noteflight: duration palette rules (rests fill the remainder; values never cross the bar line); delete-to-rest

**Value.** Wrong bar lengths are the most common student error. Noteflight prevents them by construction; FretFree only reports them afterwards.

**Design.**
- **Setting.** "Keep bars full", on by default for blank-sheet and prompt scores and off for library editions.
- **Pure helper.** `fitLength(bar, index, newLength)` in score-tools.js returns text edits:
  - shortening inserts a rest for the difference;
  - lengthening absorbs following rests in the bar, or refuses with a reason;
  - dots follow the same rule.
- **Delete.** Delete turns a note into a rest of equal length, and Shift+Delete removes it.
- With the setting off, behaviour is unchanged and existing tests stay valid.

**Files.** score-tools.js, editor.js, palette.js, index.html, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- In a blank 4/4 sheet, changing a half note to a quarter leaves `C z`, and the bar check stays clean.
- Lengthening into a following rest absorbs it. With no room, the bar is unchanged and the status explains why.
- Delete makes a rest and Shift+Delete removes the note, while the setting is on.
- With the setting off, behaviour is exactly as today.

### 35. Dark theme (`dark-mode`)
P2 · M · Depends on: none · Noteflight: none (platform request)

**Value.** Evening practice and dim classrooms, and less glare on Chromebooks.

**Design.**
- **Tokens.** Turn the roughly 30 hard-coded tints in style.css into `:root` tokens. Redefine them under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme=light])`, and again under `:root[data-theme=dark]`.
- **Control.** Auto/Light/Dark in the header, as `fretfree-theme`, backed up. It is applied by shared.js before the library renders, and feature-detects `matchMedia`.
- **Notation paper.** It stays white with dark ink. Optional "Dark paper" also maps `selectionColor`, `dragColor` and the recorder hole fill to CSS variables.
- Print and `creditedSVG` stay black on white.

**Files.** style.css, shared.js, app.js, editor.js, backup.js, index.html, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- In OS dark mode every view is dark, with body-text contrast of at least 4.5:1.
- The notation stays black on white unless Dark paper is chosen. Prints and SVG exports are identical in both themes.
- The choice persists and is backed up.

### 36. Chord diagrams and fretboard entry (`guitar-ukulele-tools`)
P2 · M · Depends on: chord-symbols, on-screen-piano · Noteflight: automatic guitar/ukulele chord diagrams; fretboard and tab entry

**Value.** Guitar and ukulele classes read chord frames on lead sheets and think in frets, not letters.

**Design.**
- **Chord shapes.** Pure `chordShape(symbol, 'guitar' | 'ukulele')` from a local table: open shapes and movable barre shapes for major, minor, 7, m7, maj7, sus, dim and aug in all keys, and GCEA ukulele.
- **Diagrams.** An overlay draws small SVG frames above each `.abcjs-chord` when "Chord diagrams" is on (persisted). They are kept in print and SVG export.
- **Fretboard.** A fretboard palette in keyboard.js (6 or 4 strings by 12 frets) enters written MIDI through the piano's path and highlights the selected note's positions.

**Files.** score-tools.js, editor.js, keyboard.js, index.html, style.css, tests/check.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- G, Em, C and D7 show correct guitar frames, and ukulele mode shows GCEA frames.
- Unknown chords get no frame and no error.
- Tapping guitar string 3, fret 2 enters written A3.

### 37. D.C., D.S., Coda, Fine and fermata playback (`roadmap-playback`)
P2 · L · Depends on: measure-and-form-tools · Noteflight: road-map playback (D.C., D.S., Coda, Fine); expressive fermatas

**Value.** Many method-book and band pieces use D.C. al Fine or D.S. al Coda. Playback ignores them today (verified), and fermatas are not held.

**Design.**
- **Performance order.** Pure `performanceOrder(tune)` in score-tools.js resolves repeats, endings, segno, coda, "To Coda" and Fine into a list of source measures in played order.
- **Playback source.** It builds an unrolled ABC for playback only, with a map from each unrolled note to its source `startChar`. Follow highlighting and the measure map use that map instead of `renderedTune.noteTimings` when jumps are present.
- **Fermatas.** Fermata notes are held about twice their value, and later notes shift.
- **No jumps.** Scores without jumps keep today's path unchanged.

**Files.** score-tools.js, playback.js, editor.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- D.C., D.C. al Fine, D.S. al Coda and To Coda fixtures play in the right order (note-order tests).
- The highlight follows the jumps.
- A fermata note lasts about twice as long and later notes start later.
- Scores without jumps produce byte-identical MIDI to today.

### 38. Teacher feedback marks on notes (`feedback-marks`)
P2 · M · Depends on: classroom-colors, turn-in-and-inbox · Noteflight: annotations (sticky notes on notes); note coloring for feedback

**Value.** Teachers point at one note ("should be F♯") without rewriting the student's music, and students see exactly where to fix.

**Design.**
- **Storage.** Marks are ABC comment lines: `% FretFree-Mark: {"v":"1","m":3,"n":2,"c":"red","t":"Should be F♯","a":"Ms. K","at":…}`.
  - Each is anchored by voice, measure and note index, so edits in other measures do not move it.
  - Being in the ABC, marks travel in saves, links and backups.
- **Pure helpers.** `readMarks`, `writeMarks`, `anchorOf` and `entryForAnchor`.
- **Menu.** The note menu gets "Comment…" and color swatches.
- **Overlay.** A colored notehead and a small bubble icon. The bubble opens a popover with text, author and time, and a Resolve button.
- **Orphans.** Marks whose note is gone are listed as "note removed".
- **Output.** Bubbles are stripped from export and hidden in print unless "Print comments" is chosen.

**Files.** score-tools.js, editor.js, rights-tools.js, style.css, index.html, tests/check.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- A mark added by the teacher shows on the student's copy, with a colored note and bubble text, author and time.
- Edits in other measures keep the mark on its note, and a deleted note's mark is listed, not misplaced.
- Marks are absent from SVG export and print by default.
- Mark text is escaped.

### 39. MIDI file import (`midi-import`)
P2 · L · Depends on: on-screen-piano · Noteflight: MIDI import (quantized into notation)

**Value.** Students bring melodies in from GarageBand, BandLab or a keyboard, and teachers convert MIDI exercises.

**Design.**
- **Decoding.** Extend `parseMidi` to keep the track index, ticks, and time- and key-signature meta events.
- **Conversion.** Pure `midiToABC(parsed, {grid: 1/16, maxVoices: 4})`:
  - tempo, meter (default 4/4) and key (from the meta event, or estimated);
  - one voice per track, with drums dropped;
  - quantized onsets and durations, ties across bar lines, chords from shared onsets, rests for gaps;
  - spelling via `midiToken`.
- **Opening.** Opens as a personal score with a "Quantized to 16th notes" note.

**Files.** score-tools.js, app.js, tests/check.cjs, tests/library-ui.cjs, README.md, CHANGELOG.md

**Acceptance.**
- FretFree's own MIDI export of each teaching score re-imports with the same pitches and durations.
- A two-track file gives two voices, and notes crossing bar lines are tied.
- Oversized or empty files show a plain message.

### 40. Rhythm and drum staves (`percussion-staff`)
P2 · M · Depends on: score-templates, instrument-sounds · Noteflight: drum kit staff with fixed line-to-sound map; slash and x noteheads

**Value.** General-music and band classes do rhythm reading, clapping and dictation, and drummers need a kit staff.

**Design.**
- **Templates.**
  - "Rhythm (one line)" uses `K:C clef=perc stafflines=1`; any letter key enters a hit on the line.
  - "Drum kit" uses `%%percmap` entries for kick, snare, hi-hat, ride, crash and toms, with `!style=x!` cymbals. Both parse cleanly.
- **Sounds.** Synthesized in playback.js: a noise AudioBuffer (made once) through a filter for each drum, plus a pitch-dropping sine for the kick.
  - FakeAudio lacks these nodes, so their use is guarded.
  - `square` stays reserved for the metronome.

**Files.** score-tools.js, playback.js, editor.js, app.js, tests/check.cjs, tests/editor-playback.cjs, tests/browser.cjs, README.md, CHANGELOG.md

**Acceptance.**
- The rhythm template shows a one-line staff, letter keys enter hits, and each plays a percussive sound.
- The drum kit template plays kick, snare and hi-hat with distinct sounds and shows x noteheads for cymbals.
- Rhythm exercises pass the bar check.

## Not borrowed

| Noteflight feature | Why not |
|---|---|
| Accounts, cloud save, auto-save to server, score cap, score manager in the cloud | No server or accounts. Local save, backup files, share links, draft recovery and version history cover it. |
| Groups, forums, member management, CSV rostering, admin/moderator roles, teacher access to all student scores | These need a server and student identities. Assignment links and the submissions inbox cover the workflow without collecting accounts. |
| Google Classroom assignment dialog, LTI "Attach To This Page", grade passback | These need OAuth, server endpoints and third-party requests. Teachers paste assignment links into Classroom or the LMS instead. |
| View/Comment/Edit permissions, privacy levels, public community gallery, favorites counts, public comments, profiles, view statistics | No server. FretFree links are private by possession, and favorites stay per device. |
| Collaborative editing | Needs a sync server. |
| Premium sampled sounds (85+) and remote soundfonts | Runtime third-party requests are not allowed, and bundled samples would add tens of megabytes. Synthesized timbres (item 21) instead. |
| Marketplace (Hal Leonard), editable copies of purchased music, premium content libraries, Essential Elements, licensed copyrighted arrangements | Commercial copyrighted content conflicts with FretFree's rights-verified open library. |
| Teacher lesson-plan database | Community submissions need a server. New CC0 prompts can be added to prompts.js instead. |
| MP3 export | Needs a bundled encoder (LAME is LGPL and large). WAV export (item 22) instead. |
| PDF import (optical music recognition) | Heavy machine-learning work, out of scope for a static site. |
| Media Sync with YouTube/SoundCloud | Third-party embeds and requests. A tap-to-map version for a local audio file may be reconsidered later. |
| SoundCheck video recording | Camera use and large files on school devices raise privacy and storage problems. Audio-only recording and assessment instead. |
| Noteflight Client API | No external API surface. The embed route (item 26) covers embedding. |
| User-customizable keyboard shortcuts and palette visibility | Low value for the complexity. A fixed, documented shortcut set with command search (item 24) instead. |
| Custom Styles, page setup sliders, Jazz music font, per-part independent layout | abcjs layout control is limited. Zoom and measures per line (item 8) cover the main need. A bundled handwritten font could come later. |
| Page, Strip, Flow and Perform views | FretFree has one responsive view. A strip view would break the pointer-to-staff maths. |
| Cross-staff beaming, dragging bar lines, Move Above/Below, Split System, Hide/Show Measures, hide empty staves, automatic multi-measure rests in parts | abcjs gives little or no control, and the value for students is low. ABC line breaks already fix systems. |
| Paste with automatic re-barring (splitting into tied notes) | Complex. Paste plus the bar check (item 6) is enough for now. |
| Real-time MIDI recording with quantization | Hard to get right. Step entry (item 14) comes first. |
| Octave lines (8va/8vb) and tremolo | Unsupported by abcjs 6.5.2 (verified: both warn). |
| Invisible color and spacer tricks, Create System lock, hide cautionaries | Worksheet layout tricks that abcjs cannot express. Assignment instructions and classroom colors cover most worksheet needs. |
| Portfolio carry-over (link accounts, copy to site) | No accounts. Backup files already move everything between devices. |
| Collections, tags and dashboard in My scores | Deferred. The local list is small enough. Search and folders may come later. |
