# Selection leaves the practice range alone · 2026-10-05

- Clicking a note (or typing notes, which moves the selection) no longer changes the practice start. Set the range with Shift+click: from the selected note's measure to the clicked one, or from the clicked measure to the end when nothing is selected. The note menu gains **🔁 Practise from here**, and the Start/End boxes still work.

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
