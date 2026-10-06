# Classroom colors and letters in noteheads · 2026-10-06

- **Colors: Classroom** (next to Note names) colors each notehead by its letter, in the Boomwhacker and handbell order: C red, D orange, E yellow with a dark outline, F green, G light blue, A dark blue, B purple. Sharps and flats keep their letter's color, in every octave and inside chords. Stems, rests and accidentals stay black.
- **Letters in noteheads** (a new Note names choice) writes the letter inside each head, in black or white for contrast, and in ink on half and whole notes. Grace notes are colored but too small for a letter.
- Both follow written pitch for transposing instruments, appear in prints and SVG exports, are remembered and backed up (`fretfree-note-colors`; the letters reuse `fretfree-note-names`), and never change the ABC source. A selected or playing note still shows its highlight color.
- Fixes: a note under the "Score saved" message can be clicked, and the note menu no longer closes at once when the page shifts a few pixels as the status line above the score rewraps.

---

# Assignments in a link · 2026-10-06

- **✎ Assignment** in the studio turns the open score into an assignment: a title, instructions and goals chosen from the writing-prompt goal types (filled bars, note lengths, first and last note, the note that ends a bar, steps, range, staying in key, at least so many rests, eighth notes or leaps). Bar count, meter and written key (minor and modal keys too) come from the score, and the goal labels are written in plain words. The filled-bars goal needs every bar to be a full bar of the meter, so it is not offered on a score with a pickup, a short closing bar or a meter change. The builder keeps up with edits and instrument changes while it is open, and closes when another score opens.
- **Use and copy link** shares the score with the assignment inside the link. Each student who opens it gets their own copy, starting from the teacher's music, with the instructions above the score and a checklist that ticks off as they write. Saved copies keep the assignment through My scores and backup/restore.
- The link adds an optional key `q`; payload version 1 is unchanged, built-in prompt links (`p`) work as before, and older copies of the app open the score without the checklist. Assignments from links and backups are checked field by field and shown escaped.
- Printing a prompt or assignment now puts its title and instructions above the score; the checklist stays on screen.

---

# Hear notes and live volume · 2026-10-06

- **Hear notes** (on by default, next to Draw notes): clicking, typing, drawing or moving a note plays it once, as does changing its accidental or stepping to it with ←→. Chords play every pitch. It uses the chosen instrument's sound at concert pitch with playback's octave rule, stays silent during playback, and is remembered and backed up (`fretfree-audition`).
- **Volume** no longer stops playback: it changes loudness live. All notes and metronome clicks now pass through one master gain and, where the browser supports it, a limiter, so chords and accompaniment do not clip. This bus is the base for a later mixer, audio export and recording.
- Note names and audition now apply bar accidentals from every pitch of a chord, not only the first, and a note tied across a bar line keeps the accidental it was tied from.
- Audition follows the same pitch rules as playback: octave clefs (`clef=treble-8`, `bass-8`, `treble+8`), `transpose=` on K: and V: lines, and `%%MIDI transpose`. The note sounds before the score redraws, so long scores do not delay it.

---

# Edit notes that start a slur or tuplet · 2026-10-06

- The note menu and the keyboard now edit notes written with a slur opening or a tuplet in front, such as `(C`, `(3C` or `(3:2:3C`. Before, length, dot, accidental and tie edits on these notes did nothing. The `(` or `(3` stays in place, and a slur end `C)` keeps its `)`.
- `noteParts` and `editNoteText` in score-tools.js accept slur openings and tuplet specs in the prefix, in any order with decorations and chord symbols. Later notation tools (palette, articulations, slurs, tuplets) build on this.

---

# Backup and restore · 2026-10-06

- **My scores → ⬇ Back up** writes every saved score, favorite, played mark and practice setting to one JSON file. Where the browser offers a Save As dialog (Chrome, Edge) the file can go in a synced folder and is remembered for one-click repeat backups; elsewhere it downloads.
- **⬆ Restore** merges a backup: nothing is deleted, the newer copy of a score wins, favorites and played marks are combined, settings are applied. A status line shows the last backup and how many scores have changed since.

---

# Paul Hardy’s Annex and Possible tunebooks · 2026-10-06

- The non-commercial collection is now **Paul Hardy’s Tunebooks**: the Session Tunebook (2016) plus the Annex (2015) and Possible (2015) books, 554 tunes in all under CC BY-NC-SA 3.0. The two smaller books mostly feed the Session edition, so duplicates across books are skipped, as are blocks without the per-tune licence credit and traditional tunes carrying a named arranger’s undated variations; the net gain is 21 tunes. `scripts/import-pgh.py` now takes several tunebooks at once.
- Every other non-commercial source surveyed (Traditional Tune Archive, Richard Robinson’s Tunebook, the Dottes books, kern2abc) is unreachable from the build environment; see the README for how to supply a downloaded copy.

---

# Non-commercial editions and Paul Hardy’s Session Tunebook · 2026-10-05

- **Policy.** Creative Commons NonCommercial editions (CC BY-NC, CC BY-NC-SA) are now admitted as a distinct class. They are labelled **NON-COMMERCIAL EDITION** on cards and in the rights box, and every export and share link carries the restriction in plain words. No-derivatives and informal “free for non-commercial use” statements stay excluded.
- **Paul Hardy’s Session Tunebook (2016 edition):** 534 traditional and pre-1930 session tunes, CC BY-NC-SA 3.0, with guitar chords. 35 tunes by later named composers, or known later compositions credited as traditional, are excluded. New importer `scripts/import-pgh.py`.
- The library’s pitch checks and difficulty estimates now follow the melody track, since chord symbols add an accompaniment track whose bass notes stay in range under transposition.

---

# Selection leaves the practice range alone · 2026-10-05

- Clicking a note (or typing notes, which moves the selection) no longer changes the practice start. Set the range with Shift+click: from the selected note's measure to the clicked one, or from the clicked measure to the end when nothing is selected. The note menu gains **🔁 Practice from here**, and the Start/End boxes still work.

---

# Blank sheets · 2026-10-05

- **New score** opens a blank sheet: eight bars of whole-bar rests in 4/4 (set the number in the **Bars** box, 1–64), with the first bar selected so typing or drawing starts at once.
- **Draw notes** on a bar that holds a rest fills the rest from its start instead of squeezing a note in beside it, so blank bars fill bar by bar.
- **＋ 4 bars** adds four blank bars in the current meter before the closing barline.
- The header and footer logo is now an inline SVG natural sign instead of the ♮ text character, which depended on each device's symbol font and rendered as a broken glyph on some systems.

---

# OpenScore String Quartets · 2026-10-05

- **368 first-violin movements** from 104 string quartets (Haydn, Mozart, Beethoven, Emilie Mayer, Mendelssohn, Brahms and more) join the library as Advanced practice parts, from the CC0 OpenScore String Quartets corpus, under a new **Chamber music** genre and **OpenScore String Quartets** collection.
- The Lieder importer became `scripts/import-openscore.py` with profiles; the quartets profile splits each file into movements and admits only composers who died before 1930 (US public-domain rule), listing the rest for a publication-date check.

---

# OpenScore Lieder Corpus · 2026-10-05

- **1,345 art songs** join the library as vocal-line practice parts, from the CC0 OpenScore Lieder Corpus: 143 composers; 25 Beginner, 702 Intermediate and 618 Advanced by the usual estimate, with a new **Art song** genre and **OpenScore Lieder** collection filter.
- `scripts/import-openscore.py lieder` converts MuseScore `.mscx` to ABC (pitch spelling, ties, tuplets, repeats and endings, key and meter changes, tempo), trims piano introductions, validates each score, and records the pinned source path and hash per entry.

---

# Share by link · 2026-10-05

- **Share link** under a score: the URL carries the score itself (ABC, instrument, source edition for credits), compressed into the `#s=` hash. Nothing is uploaded. Opening a link shows the copy as a "Shared score" ready to play, edit or save.
- The About page now describes share links instead of saying there is no sharing feature.

---

# Library tests on jsdom · 2026-10-05

- `tests/library-ui.cjs` now runs the real `index.html` in jsdom with the real engraving library, instead of a hand-written DOM mock. Filters fire real input events, cards and chips are clicked, and saved data is read back from localStorage.

---

# Code layout · 2026-10-05

- `app.js` split into `shared.js`, `library.js`, `editor.js`, `playback.js` and a small `app.js` for wiring; `render()` broken into engrave, index, selection, caption, source-edition and rights steps.
- One Prettier style across the first-party scripts (`npm run format`, checked in CI); storage keys gathered in `KEYS`; the instrument select read through `currentInstrument()`.

---

# Test runner and CI · 2026-10-05

- `package.json` with `npm test` (node suites), `npm run test:browser` and `npm run test:all`; GitHub Actions runs all suites on every pull request and push to `main`.
- `midiBytes` and `parseMidi` moved from `app.js` to `score-tools.js`, so `tests/check.cjs` loads the real file instead of slicing `app.js` by text.

---

# Try next · 2026-10-05

- **Try next** under each library score: three tunes that share its skill tags, at the same level or one up, with tunes you haven't opened first.
- Opened library scores are remembered on this browser and marked **✓ Played** in the library.

---

# Search by skill · 2026-10-05

- **Skill filter** in the library, and clickable skill tags on every card: Steps, Skips, Leaps, Repeated notes, Eighth notes, Sixteenth notes, Dotted rhythms, Triplets, Triple meter, Compound meter, Minor key, Accidentals, Chords, Rests, Wide range, Repeats.
- Tags are read from the music by `skillTags()` and stored in `catalog-skills.js` (`node scripts/build-skills.cjs`); search matches them too.

---

# Library card previews · 2026-10-04

- **▶ Listen** on each library card plays the opening line shown on the card, up to 20 seconds, and lights up its notes.
- Plays with the instrument filter's sound (piano when none is chosen). One preview at a time; it stops on a second click, when another card starts, when the cards change (filters, pages, favorites), when a score opens, or when you leave the library.

---

# Phase 1 practice tools complete · 2026-10-04

- **Play from a note**: double-click, Space, or **▶ Play from here**; count-in applies.
- **Note names**: Off / Letters / Do re mi (movable do) under each note, in written pitch.
- **Guitar tab** for Guitar; **recorder fingering diagrams** (baroque soprano, C to D′ plus F♯ and B♭) for Recorder.
- The score keeps keyboard focus across re-renders.

---

# Writing prompts · 2026-10-04

- **✎ Writing prompts**: nine assignments (first melody, steps, rests, waltz, eighths, question and answer, minor, leaps, jig) with a blank score of rests and a live goals checklist.
- Typing a note on a rest writes over it and keeps the bar full; length keys with a rest selected set the next note's length.
- Prompt keys are written pitch for transposing instruments; the prompt stays attached to saved scores.
- Each prompt's example melody is checked against its goals in `tests/check.cjs`.

---

# Simpler note input · 2026-10-04

- **Keyboard note entry** on the score: A–G add notes (nearest octave, written pitch), R rest, 3–7 length, . dot, ↑↓ pitch (Ctrl octave), ←→ select, # - = accidentals, + tie, | bar line, Delete.
- Note menu: **Tie to next note**, **Insert after: Rest / Bar line**.
- Clicking a note focuses the score instead of the ABC box, so typing goes to the score.

---

# Undo and redo · 2026-10-04

- **Undo / Redo** buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y for every change to the score: drag, draw, note menu, bar-check fixes, note buttons, header fields and typing.
- Score edits are one step each; typing bursts in one field merge; undoing to the opened text clears "Unsaved changes".

# Teaching score fixes · 2026-10-04

- **Für Elise · opening:** rewritten to Beethoven's actual rhythm at doubled note values (the old excerpt had 4-beat bars in 3/4).
- **Little engine:** now in 3/4, matching its 3-beat eighth-eighth-quarter-quarter figure; only the two cadence bars changed.
- `tests/check.cjs` requires every FretFree teaching score to pass the bar check.

---

# Bar check · 2026-10-04

- Flags bars with too many or too few beats in plain words, tints them on the score, and offers **Fill with a rest** or **Split the bar**.
- Understands pickups, section-closing bars that complete a pickup, free meter, multi-bar rests, tuplets and inline meter changes.
- Library editions: historic irregular bars are noted once, not flagged; only bars the student changes are checked.
- Practice-range and bar-check overlays are left out of SVG exports and prints.

---

# Practice tools · 2026-10-04

- **Practice range:** choose start and end measures, or click a note then Shift+click another. The range is shaded on the score.
- **Gapless loop:** each pass is scheduled on the audio clock before the previous one ends.
- **Metronome and count-in:** click on every beat with an accented downbeat; compound meters count dotted beats; pickup bars align to the barline. Count-in plays one bar at the starting tempo.
- **Speed trainer:** +2/5/10% after each pass up to a goal speed; the speed slider shows the current tempo.
- Practice toggles are remembered per browser.

---

# Cache-safe releases · 2026-10-04

- `index.html` loads every local script and stylesheet with `?v=` set to a hash of their contents, so browsers can't run a new page with stale cached code. Refresh it with `node scripts/bump-version.cjs`; `tests/check.cjs` fails if it is missing or out of date.

---

# Editor feel · 2026-10-04

- Note dragging now needs 10 screen pixels per staff step and reads one consistent pointer coordinate, so notes no longer race ahead of the cursor or jitter. Drags keep tracking, and still apply, when the pointer leaves the score.
- **Draw mode** (✎ Draw notes): click anywhere on a staff to add a note at that pitch and position. It lasts one beat of the time signature (quarter in 4/4 and 3/4, eighth in 6/8). A ghost notehead previews the pitch. Bass clef and transposing instruments write the correct concert pitch to the ABC source.
- **Note properties menu**: right-click (or long-press) any note or rest to set sharp, flat, natural or no accidental; whole through 16th length; dotted; or delete. Chords change together.
- During playback the sounding note lights up on the score, follows speed changes and resumes, scrolls into view on long scores, and clears on stop.

---

# Free-library expansion · 2026-10-03

- Expanded from **841 to 3,883 scores**, adding **3,042** playable entries: **1,828 O’Neill GPL transcriptions**, **272 individually declared public-domain Open Hymnal upper voices**, and **942 additional Mutopia editions**.
- Added collection and exact-edition-license filters, contributor search, and distinct public-domain/licensed-edition labels. Preserved actual CC versions and GPL-2.0-or-later permissions.
- Retained contributor credits, per-edition provenance, original PDFs/MIDI/editable sources, source hashes, Open Hymnal’s complete original ABC, and O’Neill’s contributor/copyright/GPL notices.
- ABC export/reimport retains rights metadata without multiplying notices. MIDI exports add credit and editable-source events without changing the music; SVG exports cover all rendered sections with visible credits and source metadata; print retains notices and adds a GPL source/license appendix.
- GPL original downloads bundle the unchanged ABC with attribution and license documents.
- Preserved all original 841 IDs and ABC, note dragging, source-text selection, chosen-measure playback, percentage-speed playback, and both original localStorage keys.
- Updated the rights manifest, README, source investigation/exclusion logs, and validation report. All 3,883 scores passed rendering, playback/MIDI, and transposition checks; original asset hashes and legacy browser storage checks passed.
- Investigated the Public Domain Song Anthology through official Dataverse, Fulcrum, and UVA downloads. Those byte endpoints returned HTTP 403, so no anthology placeholders or songs are counted.

---

# Latest update · 2026-10-03

- Expanded the library from 212 to 841 scores, adding 629 verified public-domain source editions with complete local PDFs/MIDI and retained declarations and hashes.
- Added vertical pitch dragging, including chord groups and transposing/bass displays.
- Fixed sheet clicks selecting the wrong ABC text by mapping musical events back to original source positions.
- Added start-at-measure controls and selection by clicking a note, with pickups/repeats/ties supported.
- Added independent 25–200% playback speed and reset to 100%, retaining the original Q: tempo and MIDI export tempo. Live changes resume at the current position.
- Preserved existing storage keys and catalog IDs for saved scores and favorites.
- Added real-engraving and native-browser regression tests.

# FretFree · Expanded library

- Renamed CommonNote to FretFree.
- Added 200 editions explicitly declared Public Domain by Mutopia, for 212 total scores.
- Bundled complete unchanged source PDF scores and original MIDI files, plus editable upper-part practice studies of up to 32 bars.
- Included per-edition rights records, source evidence snapshots, and file hashes.
- Added genre filters, title/composer sorting, common-title aliases, and 24-score pagination.
- Kept the previous browser-storage namespace so existing saved scores and favorites remain accessible on the same website address.
- Verified all 212 scores' parsing, MIDI generation, transposition, and source-pitch register; source asset integrity; library controls and legacy saves.

Complete source PDFs preserve the music as published by Mutopia. Editable practice studies omit accompaniment and expressive markings, and quantize rhythms to sixteenth notes. They are labeled as studies, not complete arrangements.
