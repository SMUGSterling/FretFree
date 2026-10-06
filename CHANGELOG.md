# Articulations, dynamics and ornaments · 2026-10-06

- With a note selected, **;** **:** **>** **"** **^** toggle staccato, tenuto, accent, marcato and fermata. The notation toolbar gains an **Articulation** group with the same five and a **Dynamics** group (ppp to fff, and sfz); **More** opens staccatissimo, up bow, down bow, breath mark, trill, mordent, turn and arpeggio. The note menu has a Marks section with the five articulations and the dynamics.
- Buttons light up for the marks the selected note has; pressing a lit one takes it off. A new dynamic replaces the note's old one. Rests take a dynamic or a fermata, and invisible rests nothing; the status line says what changed or why nothing did. On a range selection a mark goes on every selected note that can take it, or comes off them all when they all have it, and a dynamic goes on the first note. While More is closed, its button shows when the note has one of its marks.
- Marks go into the ABC as decorations just before the pitch, after chord symbols, slur and tuplet openings and grace notes: staccato as `.`, the others as `!tenuto!`, `!mf!` and so on. Shorthands already in a score (`L`, `H`, `T`, `u`, `v`, `M`, `!>!`) count as their mark and come off with it. Each change is one undo step, and marks stay through instrument changes and the written-pitch display.
- Playback follows dynamics, accents and staccato, and sfz and marcato now play as accents (abcjs engraved them but played them at the current volume). Ornaments play only roughly: abcjs trills and mordents a whole step from the note, and turns a whole step above and a half step below, whatever the key, so they can sound a half step off. Every offered mark parses in abcjs without warnings; `fp` and `!staccatissimo!` do not, so they are not offered.
- Two abcjs playback slips are mended. Above about 95 bpm a staccato note rang on to the next note of its pitch, and a repeated note after a tenuto or inside a slur went unheard (404 library scores lost notes this way). Staccato notes now sound for 60% of their length at any tempo and other notes for their full length, in playback and in exported MIDI.
- The note menu scrolls when it is taller than the window.

---

# Zoom and measures per line · 2026-10-06

- **Zoom** (− / 100% / +) above the score sets the notation size from 70% to 200%. Zoom narrows the width abcjs lays the score out in and the drawing is stretched back to the panel width, so notes grow without changing the engraving scale; clicking, dragging (10 px per staff step) and drawing stay accurate at every size. Above 100% on Auto, lines re-flow so they fit. Titles, composer, tempo and other text around the music keep their 100% size, so a long title still fits. Each step is announced in the status line (*Zoom 140%.*), including at the smallest and largest sizes.
- **Measures per line** (Auto, 2, 3, 4 or 6) lays the score out with that many bars on each line where they fit. Auto keeps the line breaks written in the ABC at 100% and below. Re-flowing lays the score out twice, so very long scores redraw more slowly.
- Print / PDF and SVG exports use the same layout, so a zoomed score prints in large print. The SVG is as wide as the score, with the credit wrapped to fit. Both settings are display only, remembered in the browser (`fretfree-zoom`, `fretfree-measures-per-line`) and included in backups.

---

# Select, copy, paste and duplicate · 2026-10-06

- **Shift+←→** and **Shift+click** select a run of notes in one voice; **Ctrl/Cmd+A** selects the whole voice. Shift+click still sets the practice range, as before.
- **Ctrl/Cmd+C** copies the selection, **Ctrl/Cmd+X** copies it and leaves rests of the same length, **Ctrl/Cmd+V** pastes after the selection or over a selected rest that is long enough, and **Ctrl/Cmd+D** repeats the selection right after itself and selects the copy. Whole measures copy with their bar line (the last measure too when no bar line closes the music). Pasted notes keep their length and pitch, in another score too: lengths are respelled for its unit length, and a note gets an accidental where the key or an accidental earlier in the measure needs one, including a note whose sharp or flat came from earlier in the measure it was copied from. Key, meter and unit-length changes inside a selection are not copied. The clip stays in memory, and is offered to the system clipboard as ABC where the browser allows.
- ↑↓ (Ctrl: octave), sharp/flat/natural, dot, tie, length keys and Delete act on every selected note, as do the notation toolbar's Length, Dot, Tie, ♯ ♭ ♮ and Delete buttons, and the new **[** and **]** keys halve or double every length (a single note too). Letters and piano keys add notes after the last selected note. Notes after an edit in the same measure keep their pitch, with an accidental where they now need one (a pasted, cut or deleted sharp no longer changes them). Deleting whole measures takes one bar line with them, and a line left empty goes too, as a blank line would end the tune.
- **◂ Select, Select ▸, Copy, Cut, Paste and Duplicate** buttons under the keyboard help do the same on touch screens. Every edit is one undo step; pasting does not re-bar, and the bar check reports any overflow.
- **Selection only** in the Transpose panel now covers every measure of a range selection.
- Messages at the bottom of the window no longer block clicks on the notes beneath them.

---

# Classroom colors and letters in noteheads · 2026-10-06

- **Colors: Classroom** (next to Note names) colors each notehead by its letter, in the Boomwhacker and handbell order: C red, D orange, E yellow with a dark outline, F green, G light blue, A dark blue, B purple. Sharps and flats keep their letter's color, in every octave and inside chords. Stems, rests and accidentals stay black.
- **Letters in noteheads** (a new Note names choice) writes the letter inside each head, in black or white for contrast, and in ink on half and whole notes. Grace notes are colored but too small for a letter.
- Both follow written pitch for transposing instruments, appear in prints and SVG exports, are remembered and backed up (`fretfree-note-colors`; the letters reuse `fretfree-note-names`), and never change the ABC source. A selected or playing note still shows its highlight color.
- Fixes: a note under the "Score saved" message can be clicked, and the note menu no longer closes at once when the page shifts a few pixels as the status line above the score rewraps.

---

# On-screen piano keys · 2026-10-06

- **Piano keys** (under the note buttons) shows a piano strip, C2 to C7, under the score. It stays at the bottom of the window and scrolls to the selected note or to the instrument's range. Tap a key to write the note over the selected rest or after the selected note; tapping in turn enters a melody at the current length, and each tap sounds with Hear notes. On a touch screen the note goes in when the finger lifts, so a swipe that starts on a key scrolls the strip or the page without entering anything. Keys are written pitch: on Clarinet in B♭ the D key writes concert `C`.
- **Chords:** Shift+tap, or hold one key while tapping others on a touch screen, to add the pitch to the selected note or the note just entered (`C2` becomes `[CE]2`). <kbd>Shift</kbd>+<kbd>A</kbd>–<kbd>G</kbd> on the score does the same with the letter just above the chord's top note.
- **Spelling** follows the key in force: in-key notes need no accidental (the black key between A and B is `B` in F major, F♯ is `F` in G major), others take sharps in sharp keys and C (`^C`) and flats in flat keys, and a natural is written where an earlier accidental in the bar would change the note. An accidental from the piano does not change notes after it in the bar: they get their own accidental (`z C` with C♯ tapped over the rest becomes `^C =C`).
- The selected note's keys are lit, and keys light as playback sounds them. From the keyboard, ←→ move between keys, Enter adds the note, Shift+Enter adds it to the chord, and the score's other shortcuts still work. The setting is remembered and backed up (`fretfree-piano`), and the strip is hidden in print.
- `midiToken(midi, key)`, `addChordPitch(text, pitch)` and `keepLaterPitches(...)` in score-tools.js spell a MIDI note for a key signature, add a pitch to a note or chord, and write out the accidentals later notes in the bar need after an edit; `insertNote` now goes through `insertCore(pitch, selection)`, which later input methods (MIDI keyboards, fretboard) can share.

---

# MusicXML export · 2026-10-06

- **Studio → MusicXML** downloads the score as MusicXML 4.0 for MuseScore, Noteflight, Finale, Sibelius or Dorico, at concert pitch. The converter (`musicxml.js`) walks the abcjs parse: each staff is a part, and staves braced with `%%score {RH | LH}` share one part. It writes key (with mode), time and clef changes, pickups, notes, rests, chords, ties, tuplets, grace notes, multi-bar rests, chord symbols as harmony, lyrics (syllables and extenders), dynamics, hairpins, articulations, ornaments, fingerings, slurs, segno/coda/D.C. text, repeats with numbered endings, and tempo marks.
- A length no single note has, such as the `z5` left when an eighth note goes into an empty 6/8 bar, is written as tied notes or as rests one after another, so every note has a type. A `Z` rest is drawn as one multi-bar rest only when every staff of its part rests. A text-only tempo such as `Q:"Andante"` shows only its words. A part the ABC transposes for playback (`transpose=`, `%%MIDI transpose`) keeps its written notes and gets a `<transpose>`, so it sounds as it does in FretFree. A tie carries an accidental over the bar line only to the same pitch in the next note; ABC ties between two different pitches are left out.
- Credits travel as in every other export: the license and credit text in `<rights>` and as a page-1 credit, the rights metadata as JSON in a `fretfree-rights` field, and for GPL editions the full GPL text and the editable ABC.
- `tests/check.cjs` exports the FretFree scores and a 200-score library sample and checks that every voice's notes, pitches and lengths match the parse, tied-over notes and transposed parts included. Fixtures check each notation feature's element, including split lengths, ties over the bar line, slurs, multi-bar rests, text tempos and transposition. Run by hand over all 6,150 library scores, the same check matched everywhere except nine notes where abcjs's own player carries an accidental or key change back over a repeat, and one O’Neill tune whose `L: a/8` line abcjs cannot read (its export says so). The exports of the fixtures and 103 library scores were also validated against the MusicXML 4.0 schema.
- Checked by hand in MuseScore 3.2.3, the version Ubuntu packages: the fixtures, a half-finished 6/8 jig, a two-hand piano score and a transposed clarinet part open and engrave with their notes, ties, rests, multi-bar rests, chord symbols, lyrics, endings, tempo text and transposition, and the same 103 library scores open without import errors. MuseScore 4 could not be installed in the build environment, so opening the files there still needs a check.

---

# Notation palette · 2026-10-06

- A **notation toolbar** above the score: Length (whole to 16th), Dot, Tie, Rest, Accidental (♯ ♭ ♮ None), Beam (Join, Break) and Delete. It lights up to show the selected note's length, dot, tie, accidental and beam, and gives every edit a touch target, so Chromebook and iPad users no longer need the right-click menu or the keyboard.
- Each button makes the same ABC edit as the matching key or note-menu item, as one undo step. **Rest** is new: it turns a note or chord into a rest of the same length, keeps decorations, slurs and tuplet marks, and takes the tie off the note before it. **Join** removes the space before the next note so they share a beam; **Break** puts it back. Only eighth notes and shorter can be beamed, and a beam cannot end on a rest.
- A button that does not fit the selection, such as Dot on a multi-measure rest or Join on a quarter note, is marked unavailable, and pressing it says why in the status line. Once the selection moves on, that message gives way. A press that changes nothing says so, and an edit that leaves the ABC text as it was (from the toolbar, a key or the note menu) no longer marks the score as unsaved.
- With nothing selected, or a rest selected, a length button sets the length of the next notes, like keys 3–7, and the status line says so. On a blank sheet, pick a length and type letters to write over the rest.
- The toolbar is one Tab stop with arrow keys inside it, its buttons are at least 40 px, it wraps on phones and it is left out of prints.
- `editNote` ignores actions it does not know instead of writing `NaN` into the score.

---

# Transpose and key changes · 2026-10-06

- **Transpose…** in Score settings moves the notes, key signatures and chord symbols by an interval up or down, or to a chosen key the nearer way round, as one undo step. Spelling follows the interval (an augmented 4th up from C is F♯ major, a diminished 5th is G♭). **Selection only** transposes the selected note's measure, or the practice range, and keeps the key signature.
- The **Key** menu lists all 30 major and minor keys and the Dorian, Phrygian, Lydian, Mixolydian and Locrian modes, with their signatures. Picking a key asks **Transpose notes** or **Keep notes**; either way `clef=` and other modifiers on the K: line are kept (before, the key menu dropped them and never moved the notes).
- The **Time signature** menu adds 2/2, 3/8, 5/4, 6/4, 7/8, 9/8, 12/8, C, C| and none.
- Written pitch for B♭ and E♭ instruments now keeps `clef=` on the key line instead of garbling the key, and spells keys by the instrument's interval: concert E shows F♯ major on a B♭ clarinet, not G♭. Where a key has to fall back to another spelling (concert F♯ major is written in A♭ major on a B♭ clarinet), typed letters, drawn notes and accidentals from the note menu follow the written key, so typing A shows an A.
- Transposing moves every note by the chosen interval in every listed key, including the cases where abcjs's own transposition slips an octave (F♯ major up an octave, B♭ major down a major 7th). On a cello or trombone, C♭ major and A♭ minor no longer show an octave too high. A tune with no K: line is read in C major and gains a K: line when transposed.
- Ctrl/Cmd+Z and redo now also work while a menu, slider or checkbox has focus, such as the Key menu right after a key change. Text fields other than the ABC box keep their own undo.

---

# Unsaved-work recovery · 2026-10-06

- While a score has unsaved changes, FretFree keeps a draft copy in the browser, two seconds after each edit and straight away when the tab is hidden. If the tab is closed or a Chromebook discards it, the next visit offers **Unsaved work from 3:42 PM: Title. Restore / Discard**.
- **Restore** brings back the exact ABC, instrument, writing prompt and library credits, marked unsaved, and saving updates the same saved score. Saving, Discard, replacing the score, or undoing back to the opened text clears the draft. A share link opened at start-up opens first and the offer follows.
- Each open tab keeps its own draft, so a second tab never replaces or clears the first tab's work. When more than one is waiting, they are offered newest first, and Discard moves on to the next.
- Drafts are kept under `fretfree-draft`: up to three, 500 KB in all, and the oldest is dropped first. A full storage quota is ignored, and drafts stay out of backups.

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
