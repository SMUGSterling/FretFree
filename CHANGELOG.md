# Integration fixes · 2026-10-07

- **Keyboard.** K and L pressed on a piano key keep the chord or lyric box open, and Enter or Esc returns to that key (the letters typed next used to go into the score as notes). The score is one Tab stop again: abcjs made every note and bar line a tab stop (988 on a long library song), and the arrow keys already move between notes. Esc, Ctrl+Z or Tab in the note menu gives the keyboard back to the score instead of the page. Inside the menu, ↑ ↓ Home End move between items, and the keys the items name (K, L, Z, T, Delete, Shift+Delete) run them. Undo or Redo pressed from the keyboard until it runs out moves focus to the other button or the score. Holding Space starts playback once instead of toggling it with each key repeat. The Share panel and the writing-prompt picker close on Esc, and their ✕ returns focus to their button. The hint after clicking a rest says letters write over it, and after a bar line it no longer offers ↑↓. Symbols typed with AltGr or Mac Option (| [ ] # on German, French and Spanish keyboards) reach the score, Cmd+↑↓ moves by an octave on a Mac (Ctrl+↑↓ belongs to Mission Control there), and the shortcut sheet lists Cmd+↑↓ and Ctrl+Y.
- **Saved work across tabs.** Save, a Mixer setting, Delete, a favorite, a played mark and Restore now re-read what is stored before writing, so a second open tab no longer drops scores, favorites or played marks the other tab saved; a tab also shows what another tab saved. One damaged entry in the saved list no longer empties My scores (it is skipped). A damaged last-backup record counts as never backed up.
- **Restore.** Feedback typed on another device comes over to a submission this device has without feedback. The summary names the settings a restore changed ("2 settings applied"), a failed restore removes settings it added, and a file that is not JSON gets the plain "not a FretFree backup" message. A share link, inbox entry, draft or backup naming `constructor` or another name every object has no longer passes as an instrument. A share link pasted into an open tab opens. Unsaved work is asked about only once the link has been read, so a damaged or cut-off link leaves the work unsaved, with its draft, in the view it was in; a refused or declined link leaves the address as it was, so the same link can be pasted again.
- **Credits.** Share links, embeds, drafts, assignments and turn-ins name the edition that was opened; whole tunebooks share one rights text and source address, so 2,608 editions used to name the first tune of their book, with its composer, change notice and GPL source download. A saved copy keeps its edition's id (`libraryId`) and title (`workTitle`), so credits keep the work's title whatever the student calls the copy. Copies that cannot name their edition that way keep its license all the same: a FretFree ABC or MusicXML export opened again names the edition it was made from (when that edition has the file's rights text and source), and a copy saved before this change, or an older export, names the edition of its tunebook it is closest to (its music, its title, the details it kept, its X: number), or else the first, which carries the same license. FretFree's own credited ABC exports open again (the notice before `X:` counted as a second tune). Prints and embeds of changed notation from a licensed edition say "Notation edited in FretFree from this edition", and the on-screen editing hint no longer prints. The GPL print appendix carries the day it was printed.
- **Range edits.** Delete, Shift+Delete, copy and Duplicate keep slurs, hairpins, trill lines and tuplets whole: a slur or tuplet opened just before a marked first note (`(.E`, `(3.C`, `!<(!(!mf!E`) goes with the run, and an end whose other end is outside the run stays on the notes either side (copied, it is left out): a `)` after the note before the run, a hairpin or trill line end before it (a decoration marks the note after it). A slur, hairpin or trill line left on one note comes off, and a slur opening carried past a deleted bar lands on the next note. The palette works out a range's marks in a few passes instead of one per mark button, so Ctrl+A on a 3,000-note part no longer lags.
- **Elsewhere.** ■ Stop, another view or another score while the browser asks for the microphone cancels the recording, and the microphone is let go; a Mixer change meanwhile does not. On phones the status line keeps room for its longest message, so a tap after an edit no longer selects the note above. MusicXML import recognises Oboe, Viola, Tenor sax, Horn in F, Ukulele and Voice parts (Soprano, Altos 2 and the like, but not an alto trombone or a soprano saxophone) and no longer takes a bass guitar for a guitar; trill lines come back without a second trill mark, and the swing feel (Light, Swing or Hard) survives as MusicXML's `<swing>`, also in a score without a tempo mark. A finished assignment's checklist points to Turn in, and a teacher viewing the work sees only "All goals met." Audio files are scaled and written a stretch at a time, so the page no longer freezes for about a second at the end of a long export. The pauses between stretches are messages, not timers, which a hidden tab holds back for a second or more each, and a hidden tab does not pause. README and About say that browsers keep saved work per site origin, so a class copy should have an address of its own.
- Tests: new checks in the node, jsdom and browser suites for each of these.

---

# Studio layout: score first, in bands · 2026-10-06

- The Compose view's music panel runs in bands: playback (Play, Stop, Undo, Redo, Record, Chords, Volume, Mixer), practice (Loop, Metronome and Count-in move here from the playback bar, then measures, speed and the speed trainer), note entry (Draw notes, Hear notes, Keep bars full, Piano keys and MIDI input, then the Select, Copy, Cut, Paste and Duplicate buttons, set apart by a wider gap rather than a rule that would hang at the start of a wrapped row), the notation toolbar, a help row, and a view strip on top of the score paper (Zoom, Measures per line, Note names, Colors, Fingering, Dark paper). Undo and Redo sit next to Play; Piano keys and MIDI input leave the Write notes panel. Every control keeps its id, label and shortcut.
- Wider than 1100px nothing is folded. The notation toolbar's groups get small headings (Length, Note, Tuplet, Accidental, Beam, Articulation, Dynamics, Text, Lines, Grace, and inside More and Measure), in ink at 80% so they reach 6.2:1 in the light theme and 9.6:1 in the dark one, and hidden from screen readers since each group already has a label. The score starts at 793px on a 1440px screen (was 882).
- Up to 1100px (iPads, small Chromebook windows, phones) the studio is one column. **Score settings**, **Write notes & ABC**, **⏱ Practice** and **👁 View** are toggle buttons (`aria-expanded`) that fold their part, and the toolbar's second row (Beam, Articulation, Dynamics, Lines, Grace notes) opens with **More**; Chord and Lyrics stay in view. The arrow keys skip the second row while it is folded, More's name lists the lit buttons in it, and the page scrolls as the row opens or closes above More, so More stays under the finger. An open toggle has a green underline and its ▾ turns up. Practice and View show a small **on** badge on the corner, and their names say "settings on", while Loop, a speed other than 100%, a practice range, note names or the like is on; Write notes & ABC shows a **!** badge and says so when the ABC has warnings, and screen readers still hear new warnings while it is folded. The bar check's **Show** opens Write notes & ABC before it selects the bar. On phones the practice band's buttons and boxes are 40px tall, the speed and volume sliders take the rest of their rows, and the selection buttons are as wide as their labels. Which folds are open is remembered on the device (`fretfree-studio-panels`; not in backups). The score starts at 884px at iPad width (was 1555) and at 1086px on a 390px phone (was 3164).
- The keyboard help is a **⌨ Keyboard keys** fold, grouped as Add, Change, Marks, Select and Play, closed at first and remembered. It is hidden on phones, where **All shortcuts** lists every command, and no longer prints.
- **Mixer** sits after Volume in the playback band and is never folded, and its panel opens under the practice band, above Record yourself. From 1101 to 1366px the Volume slider is 80px wide, so Mixer stays on the first row with Play. **Keep bars full** sits in the note-entry bar after Hear notes; wider than 1100px the bar's buttons have 8px side padding (were 10px) and a 20px gap before Select (was 28px), so the bar stays one row at 1440px. The keyboard keys list Shift+Delete under Select. Empty slots mark where the Play-along check button and panel and the teacher's Feedback marks go.
- Tests: new browser checks for every control showing at 1280 and 1440px, Mixer's place on the first playback row and in view on a phone, Keep bars full after Hear notes with the note-entry bar on one row at 1440px, the palette headings' contrast in both themes, the score's position at 1440px, 820px and 390px, the folds by pointer, touch and keyboard with their remembered state, in-use badges that look unlike an open toggle, warnings kept for screen readers while folded, phone touch sizes and selection labels at 390 and 360px, the toolbar's second tier and arrow keys at phone width with Chord and Lyrics in view and More kept in place, the toolbar's tab stop after an iPad turns upright, the bar check's Show at iPad width, Key → Transpose notes tab order at iPad width, and print.

---

# Keep bars full · 2026-10-06

- **Keep bars full**, a switch next to Hear notes, keeps every bar at its time signature while you change lengths, as Noteflight's duration palette does. It is on for blank sheets, new scores from a template, writing prompts and assignments, and off for library editions and imported or shared music. A saved score and a draft keep the setting they were left with.
- A note made shorter (length keys 3–7, the toolbar's Length buttons, the note menu, or taking off a dot) leaves rests for the difference right after it, merged with the rests already there and written on the beat: in a blank 4/4 bar, `C2 z2` with 5 becomes `C z z2`, and in 6/8 the rests fill to the dotted-quarter beat. In a bar that is already too long, the extra time goes first. Anything else written between the rests (an inline field such as `[K:G]`, a comment, a line break or a line of words) stays, and the rests after it keep their place.
- A note made longer, or dotted, takes its time from plain rests after it in its bar, nearest first, and the notes in between move later; what is left of a rest is written on the beat again. A bar left short can give its missing time too. With no room the score stays as it is and the status line says so: "No room in measure 1: there is only 1 beat of rest after this note. Delete a later note to make room, or turn off Keep bars full." Rests with a chord symbol or a mark keep their place.
- Delete turns a note into a rest of the same length (as Cut does), and on a rest it says how to remove it; Shift+Delete, or Remove in the note menu, takes a note or rest out. On a range selection, Delete leaves rests and Shift+Delete removes the notes; on a touch screen, turning the switch off does the same. A note tied into the first new rest loses its tie, in the same undo step. A range changes length bar by bar, with each bar's rests after its last changed note, and the rests inside it make room rather than change.
- Notes in a tuplet, dotted pairs written with `>` or `<` and multi-measure rests keep their length, and the status line says why. In free time (`M:none`) lengths change as usual, though Delete still leaves a rest. New lengths are written in the unit length where they go, also after an inline `[L:]`. The . key on a range says what changed, as the toolbar's Dot does. Every change is one undo step. With the switch off, lengths and Delete work exactly as before.
- `fitLength`, `fitBar` and `restValues` in score-tools.js work out the edits; the shortcut sheet lists Shift+Delete.

---

# Mixer · 2026-10-06

- **Mixer** in the transport opens a panel with a row for each voice of the score, **Chords** when the score's chord symbols play, and **Metronome**. Each row has **Mute**, **Solo**, **Volume** (0–150%) and **Pan**, so a student can practice one part against the others, turn the chords down or the click up, and a teacher can make a minus-one track. Voices are named from their `V:` line (`name="Alto"`), or Voice and their number; a one-voice score lists Melody, and the voices of a brace with one name take it: the Piano template's staffs are Piano (RH) and Piano (LH), and an imported piano's numbered voices are Piano 1, Piano 2 and so on. A row says when it is muted, silent because another track is on Solo, or switched off by the transport's Metronome or Chords switch. The Mixer button shows a dot when a mix is set, and **Reset** clears it. Escape or ✕ closes the panel and returns to the button.
- Each track plays through its own chain into the master bus: a gate, its level and, where the browser has one, a `StereoPannerNode`. Mute closes the gate at once during playback; Volume and Pan glide to the new value without restarting. Muted tracks are not scheduled at all, which saves oscillators, so a change that lets a track be heard again restarts playback from where it is, as the Chords switch does. Solo leaves the metronome alone, so it keeps time for the soloed part. The count-in takes the metronome's level and pan and plays even when the metronome is muted, since it has its own switch.
- Tracks come from each render: `mixerTracks()` in score-tools.js lists the voices in the order abcjs numbers their MIDI channels (staff by staff, `%%score` order), with an `&` overlay going with the voice it is written in, and Chords on the channel after the last voice. A test checks the channels against the decoded MIDI.
- Each voice keeps one MIDI channel throughout. abcjs numbers the staffs of each line on their own, so when a voice runs out of lines before the others, the voices below it would move up a channel on the later systems, and Mute or Solo on one voice would reach another's notes there. Playback, WAV and MIDI files now give every line every staff (`steadyLines()` in score-tools.js), with an empty one where a voice has ended. Each voice's later notes now follow its own earlier ones, so where the voices' lines hold different numbers of bars they no longer come in early on another voice's channel. Scores whose voices all have the same lines play exactly as before.
- The mix is stored on the score (`mixer`, keyed by voice id), not in the undo history. A saved score keeps a change straight away, without a new version in its History but with a new saved time, so the backup status counts it as changed and a restore takes the newer mix; other scores keep it when saved. A library score's mix goes on a copy of it, so the library's own entry never changes and opening the score again starts without a mix; the copy still counts as the library edition (its bar check and credits stay). Share links, embeds, turn-in links and unsaved-work drafts carry it as an optional `m` key; share links stay version 1. Reset clears it from the draft too.
- WAV export uses the mix: muted tracks are left out of the file and levels and pan apply, and the panel says so (it mentions muted tracks only when one is left out). A mix with every track muted is refused with a message.

---

# Road-map playback and fermatas · 2026-10-06

- Playback follows D.C., D.S., D.C. al Fine, D.S. al Coda, To Coda and Fine. It reads them as decorations, as Measure tools writes them (`!D.C.alfine!`, `!segno!`, `!coda!`, `!fine!`, and `S` and `O`), and as text in chord position, above or below the staff (`"D.C."`, `"^To Coda"`, `"Fine"`, `"^Coda"`), as 74 library tunes write them. A jump is taken on the last time through its measure, once. After it, repeats are not taken again, so the last ending plays; playback stops at Fine, or leaves at To Coda for the coda. With two coda signs the first is the To Coda and the second starts the coda; one coda sign is the To Coda when a "Coda" heading starts the coda. A plain D.C. or D.S. stops at a Fine and takes a coda if the score has them, and a D.S. with no segno is not taken. With neither, it stops at a fermata over a double, final or repeat bar line before the jump (on the bar line, on the last note or rest, or on an invisible rest, as in O'Neill's `Hx||`), the older way to mark the end, which 20 library tunes use; otherwise it plays on to the end again. Tunes that give that fermata only in a note (O'Neill's 219 and 226) or put it inside a bar (1515) still play to the end again. Marks are counted in bars, so a multi-measure rest (`Z3`) on one staff does not move a jump written on every staff.
- The note highlight, the metronome and count-in, measure starts, practice ranges, loops, Play from here and the WAV audio file follow the jumps, and the status line names each jump as it is taken ("D.C.: back to measure 1"). A practice range stops where a jump leaves it, and plays on through a jump that stays inside it. A note heard twice starts from its first time.
- A fermata note, chord or rest is held for twice its length, and the notes after it start later, on every staff and each time it is played. The highlight and the metronome wait for it. Ornaments, swing, dynamics and the Chords switch work as before.
- Measure tools no longer says playback ignores these marks. Adding one says what playback still needs, if anything: a segno for D.S., a Fine for D.C. al Fine, or a coda sign (a second one, unless the score has a To Coda or a Coda heading).
- MIDI export stays in written order, and a score with no jumps and no fermatas plays exactly the notes it did before. The road map reorders abcjs's own timeline (repeats and endings played out) rather than rewriting the ABC, so the drawn notes stay paired with the sound. `roadMarks`, `performanceOrder`, `performancePlan`, `planNotes` and `planEvents` are pure helpers in score-tools.js.

---

# Record yourself · 2026-10-06

- **● Record** (next to Stop) opens a panel under the practice controls. **● Start recording** asks for the microphone, counts in 1 or 2 bars (remembered and backed up), plays the practice range once at the playback speed and records you until the range ends, plus half a second for the last note, or until **■ Stop recording** or ■ Stop. A stop during the count-in, before the score's first note, keeps no take, so a false start is not numbered as one. While the take is saved the button reads **● Saving…**, and pressing it again keeps the take. Loop and the speed trainer are left out while recording, so a take is one pass. The microphone is opened without echo cancellation, noise suppression or automatic gain, which are made for calls and thin out an instrument, and is let go when the take ends. A level meter shows that it hears you.
- Each take is listed under its score with its number, length and time. **▶ Play** plays it alone; **▶ With score** plays it with the score, at the speed and range it was recorded at, starting the take where the score's first note was recorded: the time from the recorder starting to the score starting, plus the device's latency. Takes play through the master volume. **Download** saves `<title> take 3.webm` (`.m4a` in Safari), and for a library edition also `<title> take 3 credits.txt` with the edition's credits and licence. **Delete** asks first, then moves focus to the next take.
- **Calibrate timing** plays 8 unevenly spaced clicks through the speakers, records them the way a take is recorded and finds each one, so the round trip (output, input and recorder start-up) is measured on this device. Most clicks must be heard at delays within 15 ms of each other, or it says it couldn't hear them and keeps the previous value. The result is kept as `fretfree-latency` and is not backed up, since it belongs to the device. Before calibrating, the browser's own latency estimate is used, and takes recorded then use a calibration made later. In Chromium, with the score fed back 120 ms late as the microphone, a take's first note falls within 50 ms of where it is lined up (about 4 ms in testing).
- Takes are stored in this browser's IndexedDB (`fretfree-recordings`): a saved score's takes by its id, a library score's by its id, and any other score (new, imported or shared) by an id it gets when it opens, so two blank sheets never share takes, editing keeps them and the first save carries them over, also when the score is saved while it records or while its take is being saved. Saving your own copy of a library edition carries over only the takes recorded since you opened the edition; its earlier takes on this device (a teacher's model take on a shared computer, say) stay with the edition. Recovering unsaved work from its draft brings its takes back. Deleting a saved score deletes its takes too, and says so first. Takes no score can reach any more (unsaved work that was closed, or a score replaced by a backup) are counted in the panel with **Delete them**. Unsaved work that is still open in another tab holds a Web Lock for its takes while they exist, so they are not counted (without Web Locks, only drafts show what is still open). They are never uploaded and not in backups, and the panel says so and shows how much storage the site uses. Without IndexedDB they last until the tab closes, and the panel says that instead.
- Without microphone access (blocked, no microphone, busy) or without MediaRecorder, the panel says what is wrong in plain words. An embedded score has no Record button and stores nothing.
- `play()` takes options for this: a number of count-in bars, a single pass, a speed and end, and a callback with the audio time the score starts at. `takeOffset()`, `takePosition()`, `audioOnsets()`, `estimateLatency()`, `takeFileName()` and `clockText()` are in score-tools.js.

---

# Lyrics · 2026-10-06

- With a note selected, **L**, the notation toolbar's **Lyrics** button or **Lyrics…** in the note menu opens a box under the note's staff, below the words already there. **Space** saves the syllable and moves to the next note and **-** saves it with a hyphen, so typing `Twin-kle twin-kle` from the first note writes `w: Twin-kle twin-kle` under four notes. **_** holds the syllable over the next note, **\*** leaves a note without one, and a space typed straight after either only separates, as in a `w:` line. Space in an empty box passes a note as it is; - or _ there carries the word before on through the note. **Backspace** in an empty box goes back a note, **Tab** and **Shift+Tab** move on and back (**Next ▸** on touch screens), **Enter** starts the next verse at the note where typing started, and **Esc** or a click elsewhere saves and closes. Typing past the last note keeps the box open after it, so Enter still starts the next verse, and words typed there are left out rather than added to the music as notes. Rests are passed over, and on a rest the box opens on the next note.
- The words are written as `w:` lines under each line of music, one per verse, in the voice of the selected note. Each saved syllable is one undo step, and changing one syllable leaves the rest of its verse and the other verses as they were. abcjs stacks a note's syllables in the order the verses reach it, so earlier verses are padded with `*` to reach as far as later ones and every verse keeps its own row; verses left empty at the end go. abcjs lets a `*` or `_` land on a rest, so a rest in the way gets one of its own. A line's words go straight under its music, before a key or time change (`[K:G]`, `[M:6/4]` or a `K:` line) that starts the next line, so each line keeps its own words.
- Adding or deleting notes in a line with words under it shows a reminder to check that the words still line up, lines with the same words included. The separators are read from the typed text, so pasted words are spread over the notes and phone keyboards that send no key names work too. A syllable's own `-`, `_` or `*` (`mid\-day`) shows in the box as a look-alike, so editing it keeps it one syllable; a backslash typed before one of these keys keeps it in the syllable too. A voice written after `&` shares its staff's `w:` lines with the first voice, so the box explains that it takes no words of its own.
- Lyrics travel with saves, share links and the ABC, MusicXML, SVG and print exports. MIDI and WAV files carry no words.
- `lyricUnits`, `alignLyrics`, `lyricSlots`, `readLyrics`, `lyricVerses`, `lyricText`, `setSyllable`, `typeLyrics` and `lyricLines` in score-tools.js read and write the verses; the tests check that they read every generated verse exactly as abcjs does and write each one back to the same syllables, and that every note of the 211 OpenScore lieder whose lines start with a key or time change takes its own word.

---

# Audio export (WAV) · 2026-10-06

- **WAV** in the export bar makes an audio file of the score to hand in, share or practice along with. A panel under the bar has **Include metronome** and **Include chords** (shown only when the score's chord symbols play), which start from the transport's Metronome and Chords switches, and **Make WAV file**, which downloads `<title>.wav`. The panel names the instrument and speed the file will have, and follows the Speed slider and the Instrument menu while it is open. A bar shows how far the file has got, where the browser can suspend an offline render to report it; elsewhere it shows a busy bar. The status line gives the file's length and size. Escape or ✕ closes the panel, and it closes when another score opens; a file still being made then is stopped: its notes stop and its bus is cut off, so the rest renders as silence at once, and nothing downloads.
- The file has what Play sounds: the whole score in the chosen instrument's sound, with swing and dynamics, at the current playback speed, without the count-in. It is rendered on the device with `OfflineAudioContext`, faster than real time, as 16-bit stereo at 44.1 kHz, through its own master bus at full level (not the Volume slider) and the same limiter, and scaled so the loudest sample is 1 dB under full scale. A score that would play for more than 10 minutes at the chosen speed is refused with its length, because the recording is held in memory; the message suggests MIDI, and a faster speed when the fastest one would fit. About 50 of the 6150 library scores, mostly string quartet movements, are that long at 100%. Browsers without `OfflineAudioContext` show a plain message suggesting MIDI.
- Credits travel in the file's LIST/INFO chunk: the title (INAM) and composer or attribution (IART), and for a library edition its license (ICOP) and the full credit with the corresponding editable ABC (ICMT), as the MIDI export carries them, the GPL text included. A score of your own carries only its title and composer, or a copyright line kept from an imported file.
- `scheduleNotes()` and `click()` in playback.js take an audio context and an output node, so the export schedules exactly what playback does. The pure `wavBytes()` in score-tools.js writes the file and `creditedWavInfo()` in rights-tools.js its text. The mixer is not built yet, so there are no per-track mutes or levels to apply.

---

# Screen-reader announcements and a shortcut sheet · 2026-10-06

- Selecting a note names it in the status line under the score, which screen readers announce: its length, its pitch as the staff shows it, its measure and its beat, as in "Quarter note B♭4, measure 2, beat 1" or "Quarter note chord F4 A4, measure 2, beat 3". Pitches follow the key signature and the bar's accidentals, and are written pitch for transposing instruments (concert pitch in Concert pitch view). Ties, rests, invisible rests and multi-measure rests are named too.
- Beats count the meter's lower note, or dotted quarters in 6/8, 9/8 and 12/8. Notes between beats are named as part of a beat (beat 2½, beat 2⅓ for a triplet or the second eighth in 6/8), a pickup ends on the last beat, and free meter gives no beat. A short first bar is a pickup when the score opened with it or when a short closing bar makes up the rest of it; a first bar left short by deleting a note while writing still starts on beat 1. A short bar right after a short bar that ends a section is the next section's pickup when the two make one full bar.
- The arrow keys name each note they reach, without the longer hint a click gets. An edit that has no message of its own, such as typing a letter, ↑↓, an accidental key or a tie, names the note it changed; typing over a rest names the new note, not what is left of the rest. An edit that leaves nothing selected, such as **|** for a bar line, says so.
- **?** on the studio (outside text fields), or **All shortcuts** in the keyboard help line, opens a list of every editing command and its keys, grouped by task: Select, Write, Length, Tuplets and grace notes, Pitch, Marks, Dynamics, Lines and beams, Measure, Edit and Play. Its search box filters the list as you type, matching the start of any word in a command's name, its task, its keys or a few other words ("articulation" finds Staccato). ↑↓ choose a command, and Enter, or a click or tap, runs it on the selected notes as one undo step, with the same message as its key or palette button. A Measure command opens the Measure panel, and Time, Key and Clef from here give its menu the keyboard. Commands that need a letter typed on the score say so instead.
- The list is a modal dialog: Tab stays inside it, focus that wanders off comes back to the search box, and Esc, ✕ or a tap outside closes it. Closing gives the keyboard back to where it was; running a command gives it to the score. It fits a 390 px phone and is left out of prints. Pressed over the note properties menu, **?** closes the menu first. On phones and touch screens **All shortcuts** is a 40 px tap target.
- The notation palette's key hints and `aria-keyshortcuts` now come from the same table (`SHORTCUTS` in the new `shortcuts.js`). `describeNote`, `noteBeats` and the spelled `names` of `noteLabels` are in score-tools.js. A browser test checks that every studio button has an accessible name.

---

# Tuplets and grace notes · 2026-10-06

- With a note or rest selected, **T** or the notation toolbar's **Triplet** button splits it into a triplet, and the **Tuplet** menu next to it into a duplet, quintuplet, sextuplet or septuplet. The note becomes the first member and rests fill the others: a quarter in `L:1/4` becomes `(3C/2 z/2 z/2`, and a half note `(5:4:5C/2 z/2 z/2 z/2 z/2`. The first rest is selected, and each letter fills one rest at its own length and moves on, so typing D and E completes the triplet and the bar stays full; the status line says when the tuplet is filled. Notes shorter than a quarter are beamed to the note before them in the tuplet as they go in, so a filled triplet of eighths reads `(3C/2D/2E/2`. A rest split up keeps the tuplet opening when it is filled, and a note at the end of a source line keeps its line continuation (`\`) after the last member.
- Plain notes split into 3, 5, 6 or 7 in the time of 2 or 4; dotted notes into 2 in the time of 3, 5 in the time of 3 or 7 in the time of 6. A count that would give ordinary note lengths (a duplet on a plain note, 3 or 6 on a dotted one) is marked unavailable and the status line says why, as it does for broken rhythm, multi-measure rests and range selections. The Triplet button and the menu light up while the note is in a tuplet; the same count again takes the tuplet off while its other members are rests, and another count splits it again. A tuplet whose members do not add up to a single note, such as a hand-written `(3c2zz`, stays as it is. **Delete** on a note in a tuplet turns it into a rest, so the tuplet keeps its count and the notes after it keep their time, and Delete on a rest takes off a tuplet whose other members are rests, as T does. A length key on a tuplet rest sets the length for notes after the tuplet.
- **Grace** adds a grace note one step above the note (`{d}` before `c`), **Slashed** makes it a slashed grace note (`{/d}`), and **Grace ↑** and **Grace ↓** move only the grace note; ↑↓ still move the note itself. A lit Grace takes it off, and so does **Remove grace** in the note menu, which has the same tuplet counts and grace items. Grace notes go before slur and tuplet openings, and tuplet openings before a staccato dot, so abcjs reads every mark on the note. abcjs starts such a note at the dot (`(3.C`), and the selection follows it, so a staccato or another mark on a triplet's first note can be pressed on and off again.
- Each change is one undo step. Tuplets and grace notes parse without warnings and play in time; a grace note takes its time from the start of its note, as abcjs plays it. `tupletRatio`, `makeTuplet`, `tupletMembers`, `tupletSpec`, `graceOf`, `setGrace` and `moveGrace` in score-tools.js do the editing.

---

# Measure, repeat and form tools · 2026-10-06

- **Measure ▾** in the notation toolbar opens a panel of tools for the selected note's measure, or for a selected bar line. **+ Bar before** and **+ Bar after** insert an empty bar, a whole-bar rest in the time signature in force (`z4` in 4/4 with `L:1/4`, `z3` after a change to 3/4), and select its rest so typing writes over it. **Delete bar** removes the measure and joins the bar lines on either side: a repeat, double or final bar line that closed it moves to the measure before (`C | D |]` becomes `C |]`), a repeat or ending that held only that measure goes, and a start repeat or ending that opened it moves on to the next measure. A time, key or clef change in it stays, rehearsal letters after it close up, and a line of ABC left empty goes with the `w:` words under it. With several staves, every staff gets the same change, and an inserted bar goes inside the same repeat, ending or section as the measure. A multi-measure rest (`Z3`) on one staff puts the staves' measure numbers out of step, so an edit past it asks for it to be written as one rest per bar first; a score whose staves change partway through is left to the ABC text.
- **Single**, **Double** and **Final** replace the bar line after the measure instead of adding another. **Start repeat**, **End repeat**, **1st ending** and **2nd ending** toggle on the bar line before or after the measure, on every staff: `|:`, `:|`, `::` for both, `|1` and `:|2`, and `|:` or `[1` at the start of a line. With a bar line selected, these buttons restyle that bar line. Repeats and endings play, and an ending runs to the next repeat, double or final bar line.
- **Segno** and **Coda** go on the measure's first note; **Fine**, **D.C.**, **D.S.**, **D.C. al Fine** and **D.S. al Coda** on its last, one jump per note. Playback does not follow them yet, and the status line says so. **Rehearsal mark** writes `[P:A]` on the top staff and letters the marks A, B, C in order (AA, BB after Z); marks with names of their own stay as written. When a header `P:` line gives an order of parts (`P:AABA`), or a letter comes back, the letters are part names: they stay, and a new mark takes the first letter not in use.
- **From here: Time, Key, Clef** change the time signature (`[M:3/4]`, on every staff; the bar check counts 3/4 from there), the key (`[K:G]` on every staff, asking **Transpose notes** or **Keep notes** like the Key menu; transposed notes move up to the next key change) or the clef (treble, bass, alto, tenor or treble 8vb, on every voice of that staff) from the measure on. The same value as the measure before removes the change, and from measure 1 the time signature and key are the header's. The clef menu goes by the clef shown, so on cello or trombone, which show the music in the bass clef, Treble writes `[K:clef=treble]`. abcjs starts a line's later staves in the key its earlier staves reached, so a staff whose line starts before a key change names its own key at the start of that line.
- Piano and hymn music often switches voices with inline `[V:]` fields. abcjs mishandles a key, time or clef field written straight after one at the start of a line: the staff takes the top staff's clef, the time signature goes to another staff, and on a staff's second voice the tune does not draw at all. When a change lands there, that voice field moves to a `V:` line of its own, where abcjs reads the field correctly. The bar check now also reads a time signature that starts a line after a `V:` line. Decorations written before a bar line (`!fermata!|]`) stay when the bar line changes.
- Buttons light up for what the measure has, unavailable buttons say why, every change is one undo step, and every construct parses in abcjs without warnings. The panel works from the keyboard (one tab stop for the toolbar, arrow keys, Escape cancels a key change) and wraps at phone width.
- Left out: the dotted bar line, which abcjs 6.5.2 draws as a plain bar line with a dot above it.
- Pure helpers in score-tools.js: `measureBounds(tune, voice, measure)`, `measureOpen`, `replaceBarLine(abc, bar, type)`, `insertInlineField(abc, at, field)`, `insertMeasure`, `deleteMeasure`, `editBars`, `meterChange`, `keyChange`, `clefChange`, `toggleFormMark` and `toggleRehearsal`; the panel is in `measure-tools.js`.

---

# Instrument sounds · 2026-10-06

- Thirteen more instruments: oboe, bassoon, tenor sax in B♭, baritone sax in E♭, horn in F, euphonium, tuba, viola (alto clef), double bass, ukulele, bass guitar, glockenspiel and voice. The Instrument menu and the library's Instrument filter are both built from the one list in catalog.js and grouped by family (Woodwinds, Brass, Strings, Guitars, Keyboard and percussion, Voice); the filter's hard-coded list is gone.
- Every instrument has its own synthesized sound instead of a bare sine, triangle or sawtooth wave: a waveform built from its harmonics (`partials`, played through `createPeriodicWave` and made once per audio context), an envelope (winds, brass, strings and voice swell in and hold; guitar, ukulele, bass guitar, piano and glockenspiel fade while held) and, for flute, oboe, saxes, euphonium, strings and voice, vibrato through detune automation once the note has sounded for a moment. Each note is still one oscillator and nothing uses the metronome's square wave; browsers without periodic waves or detune automation play the basic wave without vibrato. Playback, Hear notes, library Listen and version History previews all use the new sounds.
- An instrument's playback octave is now its own setting (`sound`), apart from its written transposition (`shift`); the default is unchanged (an octave down only for shift −12, as on cello and trombone). Horn in F is written a perfect 5th above concert pitch and tenor sax a major 9th. Baritone sax is written an octave and a major 6th above how it sounds: it reads the part a major 6th up, like alto sax, and plays the melody an octave lower. Double bass and bass guitar sound an octave below the written part and glockenspiel two octaves above. Guitar still plays as written.
- The caption under the title gives the interval from the instrument (*Horn in F · treble clef · Written pitch shown; it sounds a perfect 5th lower. ABC source and MIDI are concert pitch.*), and the embed view names the part the same way, including tenor and baritone sax and the octave instruments. Baritone sax plays the source an octave lower, so its caption says the ABC source and MIDI are an octave above how it sounds, and its Concert pitch view is labeled *ABC source shown*, instead of calling either concert pitch. `intervalPhrase()`, `instrumentSound()`, `writtenAboveSound()`, `noteEnvelope()` and `vibratoCurve()` are pure helpers in score-tools.js.

---

# Cut-time tempo · 2026-10-06

- Scores with a written tempo in 2/2, 3/2, 4/2 and C| (359 in the library) played at half speed, and Listen previews and MIDI exports with them. abcjs's MIDI writer took the tempo, which abcjs counts in the meter's beat (a half note in 2/2), as quarter notes a minute, so `Q:1/2=60` sounded as quarter = 60. A written tempo now plays in the note it names: `Q:1/2=60` is 60 half notes a minute and `Q:1/4=120` in 2/2 is 120 quarter notes a minute.
- The same slip changed the speed of a written tempo in other meters, and those scores now play as written too: in 6/4, 9/4 and 12/4 (45 scores, where abcjs counts dotted halves) it played three times too slow and in 2/1 (3 scores) four times too slow; in 6/16, 9/16 and 12/16 (6 scores) it played a third too fast and in 4/16 and 21/16 (2 scores) four times too fast. A bare number such as `Q:60` counts the note of the meter, as abcjs reads it: half notes in 2/2, eighth notes in 6/8 and quarter notes in C and C|, so the one such score in C| (The Three Captains) now plays at quarter = 60 instead of 30. MIDI from every other library score (5,735 of 6,150, among them the 496 in 2/2 and C| with no `Q:`) is unchanged byte for byte.
- With no `Q:` these meters keep the speed they have always sounded at, quarter = 180 (half = 90, a usual reel speed). The note highlight, measure starts, practice ranges, metronome and count-in were timed at half = 180, twice as fast as the sound: the highlight ran ahead, a one-measure range stopped halfway through the bar and the clicks missed the notes. They now follow the sound.
- abcjs had two defaults for a score with no tempo, one for the sound and one for the timing. `settleTempo` in score-tools.js gives the parsed tune the tempo the sound uses, after engraving, so no tempo mark is drawn and the ABC is unchanged; `midiBytes` writes it to the MIDI file in quarter notes. A tempo with no number (`Q:"Slowly"`) now plays at the default instead of 60; a body tempo with no number (`[Q:"Slower"]`) keeps the tempo before it, and a tempo word with no note (`[Q:"Allegro"]`) counts beats, as it does in the header. Tempo and meter changes in the body, including from 4/4 into 2/2, stay in step.
- **Swing** on a score with no `Q:` writes out the tempo the score plays at, now `Q:"Swing" 1/4=180` in 2/2 and C| as in 4/4 (abcjs's own default, 1/2=180, would now play twice as fast), so choosing a feel keeps the speed.
- The **Tempo** slider reads and writes the tempo in the header's own note: with `Q:1/2=60` it reads 60, and moving it writes `Q:1/2=61`. It used to write `Q:1/4=`, which now halved the speed of a 2/2 score at the first move. A score with no `Q:` reads the tempo it plays at (180, or 120 dotted quarters in 6/8) instead of 100.
- A practice range, a loop and playing from a note no longer sound a click of the note before the range or of the next bar's first note. Range edges are timed in whole milliseconds and the MIDI is not (a bar at quarter = 180 is 1.333 s against 1.333332 s), so those notes overlapped the range by a fraction of a millisecond and were played as a click of about 25 ms. A note that overlaps a range by less than 10 ms now stays out. This happened at most range edges whenever a bar does not last a whole number of milliseconds, as at the default quarter = 180, in any meter.
- `tests/check.cjs` checks note times in 2/2, 3/2, 4/2, C| and 6/4, with and without `Q:`, through tempo and meter changes, and that every library score's MIDI tempo is the tempo abcjs times its notes by, and that Swing keeps the tempo of 2/2, C|, 3/2 and 6/4 scores with no `Q:`. `tests/editor-playback.cjs` checks a one-bar range, the metronome and the count-in in 2/2 against the notes heard, a range, a loop and a start note in C| with no stray notes, swing on a C| reel, and the Tempo slider in 2/2, C| and 6/8. `tests/browser.cjs` checks in Chromium that the lit note is the one sounding in 2/2 and C|. `tests/rights-browser.cjs` compares every drawn note's time with the MIDI in the 1,434 library scores outside plain x/4 and x/8 meters or with tempo or meter changes (99.6% of their notes agree; the rest are other abcjs slips, after uneven tuplets or ties into rests).

---

# Turn in and Submissions · 2026-10-06

- **Turn in** appears next to Share link on a score with an assignment or a writing prompt. The student writes their name once (it is remembered on the device, and selected so the next student on a shared computer types over it) and gets a link to paste where the teacher collects work, plus a `.json` file to attach. The link adds the name, the time, the assignment's id and which goals were met to the usual payload (`n`, `t`, `x`, `g`; `v` stays 1). Editing after turning in takes the link away, so the newest work is what goes in. The file carries the credited ABC, so library credits and licences travel with it.
- **My scores → Submissions** is the teacher's inbox. Paste the links, one per line, or drop the files: each is decoded and checked, goals and bar checks are worked out again from the music, and lines that are not turn-in links are listed by number (files over 1 MB by name) while the rest are added. Submissions are grouped by assignment, with the student, time, goals met and bars to fix, and sort by name, goals met or time.
- **Open** shows a submission in Compose under "Turned in by …", with the checklist, **Previous** and **Next** through the class and a feedback box. Feedback is kept per student as it is typed, even if the tab closes with the box still focused, and recovering unsaved work brings a submission back with its bar. **Save** makes a copy of your own, without the bar, that can be turned in. **Copy return link** sends the music back with the feedback (`c`); the student sees it above the checklist, keeps it when saving, and can revise and turn in again. A turned-in link opened directly shows the same bar with **Add to submissions**, after which stepping through the class no longer asks about unsaved changes.
- The inbox keeps up to 200 submissions (`fretfree-inbox`) with Delete and Clear all, and backups now include it and the remembered name. Names, feedback and everything else from links, files and backups are checked field by field and shown escaped.
- My scores' buttons wrap on a phone instead of widening the page.

---

# Install as an app and work offline · 2026-10-06

- After one visit FretFree opens and works without internet: the library, saved scores, a score opened before, the editor and playback. A PDF or MIDI file from the library works offline once it has been opened; one never opened does not.
- New `sw.js` service worker (scope `./`). The page is network-first with the last complete copy as the offline fallback, so a new deploy shows within one reload. `?v=`-stamped scripts and styles are cache-first: the small ones are cached at install and the large catalogs at runtime, with the page handing over the files it loaded before the worker took charge, so the first visit is enough. A newly fetched page replaces the offline copy only once every stamped file it loads is cached, and only then are the files the old page alone loaded dropped, so an update cut short by lost Wi-Fi or a closed lid leaves the previous copy working. Files under `scores/` are cached only when opened, and are fetched again when online, so a corrected edition reaches students. Older FretFree caches for the same folder are dropped; other projects' caches on a shared github.io origin are left alone. It never fetches from another site.
- New `manifest.webmanifest` (relative URLs, standalone display, theme colors) with local icons in `icons/` (192 and 512 px, maskable, Apple touch icon and an SVG favicon), drawn from the SVGs by `node scripts/make-icons.cjs`. Chrome's installability check passes.
- **Install app** appears in the header when the browser offers installing (Chrome and Edge) and works from the keyboard. A **Working offline** notice in the header, announced to screen readers, shows while the device is offline, with a toast when the connection drops. They sit with the theme choice: above the nav at iPad and phone widths, and on a row below the nav at narrow laptop widths when they do not fit beside it, so the nav labels stay on one line. The About page explains offline use and installing on iPads and iPhones, and says whether this browser has an offline copy or whether part of it is missing; a copy cut short is finished when the connection comes back.
- Registration runs only on https and localhost, after the page has loaded, and never in an embedded score, which keeps nothing on the visitor's device; without service workers the site works online as before.

---

# Slurs, hairpins and trill lines · 2026-10-06

- Select notes and press **S** to slur them; **S** again takes the slur off. With one note selected the slur goes to the next note in the same voice, and **S** on that note again removes it.
- The notation toolbar has a **Lines** group: **Slur**, **Cresc.**, **Dim.** and **Trill line**. Each puts its line over the selected notes, or from one note to the next, and lights up while the selection has it; pressing a lit one takes the line off. The status line says what changed, or why nothing did (a slur on a rest, no next note).
- Slurs and trill lines run from the first to the last selected note and leave out rests at either end; a hairpin may start or end on a rest. A new line replaces the lines of its kind that it covers or crosses, so slurring a longer run joins two short slurs into one, and a crescendo replaces a diminuendo. A slur around it stays, as a phrase mark, and so do lines that only meet it at its first or last note.
- Slurs are read the way abcjs draws them: a note's `)` ends a slur from an earlier note, so `(C D (E) F)` is a slur from C to E and one from E to F, and **S** on either takes off just that one; slurs on chords and rests pair apart from slurs on single notes, as in abcjs, and where that would join a new slur to the slur around it, the slur around it comes off. A line also carries on into the voice's next block in scores that write their voices in turns (`V:1`, `V:2`, `V:1` …).
- Lines go into the ABC as `(` … `)`, `!<(!` … `!<)!`, `!>(!` … `!>)!` and `!trill(!` … `!trill)!`. Spellings such as `!crescendo(!` come off too. abcjs starts a note's text after any mark that follows a `(`, and reads `.(` as a dotted slur, so hairpin and trill marks go before slur and tuplet openings and a slur opening goes before a staccato dot. A slur written just before a staccato dot is still found and taken off. Each change is one undo step that keeps the selection.
- abcjs draws only the tr of a trill line, so FretFree draws the wavy line from the tr to the end of the last note, carrying on across system breaks; it shows in embedded scores, prints and SVG exports. Hairpins change the playback volume note by note, in exported MIDI too; trill lines print but the notes play as written. Slurs, hairpins and trill lines parse without warnings and survive transposition. `lineEdits`, `toggleSlur` and `toggleSpan` in score-tools.js do the editing.

---

# Swing feel · 2026-10-06

- **Feel** in Score settings plays a score straight or with a swing feel: Light swing (60), Swing (66) or Hard swing (75). The off-beat eighth of each quarter beat starts late, at that percent of the beat, and the on-beat eighth before it lasts longer, so at Swing and 120 BPM the second of two eighths starts at 2/3 of the beat instead of halfway.
- Only beats made of eighths swing: a beat with sixteenths, triplets or other off-beat notes plays as written, each voice on its own. A pickup eighth swings as an off-beat, also when it is played again at a repeat or leads into a new section. Each measure swings at its own tempo, through tempo changes and repeats, at any tempo and in 2/2 and C|. Meters that are not x/4 or x/2 play straight, and the menu says so.
- The feel is written into the ABC header, where it prints and travels with saved scores and share links: `Q:"Swing" 1/4=120` (the tempo text abcjs prints above the staff) and `%%MIDI swing 66` (the abc2midi directive). Tempo text already there stays: "Allegro" becomes "Allegro, swing", and Straight turns it back. Choosing a feel keeps the tempo: a score with no `Q:`, a bare number such as `Q:120` or tempo text alone gets the beat it plays at written out (1/4=180 for a score with no `Q:`), because abcjs ignores a bare number after tempo text. Tempo text alone that abcjs does not know, which played at 60 but highlighted at 180, then plays at 180. A tempo change in the tune body stays where it is. Straight removes the directive and the swing text and keeps the beat. The Tempo slider and `setHeader('Q')` keep the tempo text before and after the beat. Each change is one undo step.
- Playing from a swung off-beat note starts with that note. Straight scores play exactly as before. The note highlight, metronome, count-in and MIDI export keep the straight beat. The pure `swingAmount()`, `setSwing()`, `tempoParts()`, `swingNotes()` and `swingPlayback()` are in score-tools.js, and `parseMidi()` also reports the opening tempo.

---

# Embed code and QR code for share links · 2026-10-06

- The share panel has **Link**, **Embed** and **QR code** tabs (arrow keys, Home and End move between them). All three describe the score that was shared, and the panel closes when another score opens.
- **Embed** gives a copyable `<iframe>` for a class website, Google Sites, Canvas or a blog, with width (pixels, with or without `px`, or a percentage) and height (200 to 2,000 pixels) fields; a value that cannot be used is marked and replaced. Its `#e=` link carries the share link's own payload (still `v: 1`). It opens a read-only view: the score, Play, Stop, volume and speed, the credit line with any non-commercial label, and **Open in FretFree ↗** for an editable copy. A part for a transposing instrument is named under the title, with how it sounds (for example "Clarinet in B♭ part, in written pitch: it sounds a major 2nd lower."). Nothing on the embedded score can be selected or dragged, an assignment's goals are left to the student's copy, and the view reads and writes no storage, so no saved scores, played marks or drafts, and its theme follows the device. The frame keeps its address, so a reload shows the same score; a damaged embed link says so.
- **QR code** draws the share link as an SVG QR code for students to scan from the projector, with **Show full screen** where the browser supports it. The code is drawn at 3 pixels per module (at least 280 pixels, up to the panel's width), so a long link's dense code stays readable, and links over 997 characters also suggest full screen or the link. Links over 2,331 characters, the most a QR code holds, get an explanation instead.
- QR codes are encoded on the page by qrcode-generator 2.0.4 (Kazuhiko Arase, MIT), vendored as `vendor/qrcode.js` with its licence in `vendor/QRCODE-LICENSE.md` and credited on the About page.

---

# Dark theme · 2026-10-06

- **Theme** in the header: Auto, Light or Dark. Auto follows the device's light or dark setting, and changes when the device does. Below 820px wide (tablets in portrait, phones) it sits beside the logo and the page buttons take a row of their own. Every view goes dark: library, Compose, My scores and About, with body text at a contrast of at least 4.5:1, dark form controls and scroll bars, and a dimmer piano strip.
- The score stays black on white in the dark theme, and so do the music-stand sheet, the card previews in the library and the version History preview. **Dark paper** (beside Zoom, shown only in the dark theme) turns them light-on-dark, with lighter selection, drag and playback highlights, open recorder holes in the paper color, and letters in noteheads that stay readable.
- Prints and SVG exports are black on white in every theme and with Dark paper; the score's SVG is not redrawn when the theme changes.
- Both choices are remembered in the browser (`fretfree-theme`, `fretfree-dark-paper`) and included in backups. A small script, `theme.js`, loads before the stylesheet and applies them before the page first paints, so a page that loads slowly does not show in the other theme first. If the browser cannot save them (storage full or blocked), they still apply until the page is reloaded or closed.
- The page colors are now tokens on `:root` in style.css, redefined for the dark theme. In the light theme a few panel tints that were almost the same now share one token and shift by at most 3 of 255 per channel; the rest are unchanged.

---

# Version history for saved scores · 2026-10-06

- Saving a saved score with changed music keeps the copy it replaces as an earlier version, with the time that copy was saved and its instrument. Each save gets its own time, so two quick saves never share one.
- **History (n)** on a My scores card opens a panel listing the versions newest first. **Preview** draws a version read-only, in the instrument's written pitch (or concert pitch with Concert pitch on) with the editor's zoom and measures per line (200% on a phone), and **▶ Play** plays it with its notes lit, through the same player as the library's Listen; leaving My scores stops it. **Restore** opens the version in Compose as unsaved work on the same score; nothing stored changes until Save, and saving keeps the replaced copy in the list. The panel works from the keyboard (focus moves to it, Escape closes it and returns to the card) and fits a phone screen.
- Versions are stored apart from the scores (`fretfree-versions`): up to 20 per score and about 1.5 MB in all, oldest dropped first. When storage is full the oldest versions make room for the save, and a version that cannot be stored is let go, so saving never fails because of history; if the save fails anyway, the versions are put back as they were. Deleting a score deletes its versions.
- Backups carry a top-level `versions` key (format stays 1; older apps ignore it). Restoring unions versions by save time without duplicates, leaves out versions of scores the device does not keep, and turns a copy replaced by a newer one from the backup into a version. When storage is short, the oldest versions make room for the restored scores and settings rather than stop the restore; a restore that fails anyway puts them back with everything else, so it still changes nothing.

---

# Chord symbols · 2026-10-06

- With a note or rest selected, **K**, the notation toolbar's **Chord** button or **Chord symbol…** in the note menu opens a box just above it. **Enter** saves, **Tab** saves and moves to the next note (**Shift+Tab** the one before; **Next ▸** does the same on touch screens), **Esc** cancels, and an empty box removes the symbol. Clicking another note saves the box and selects that note.
- Symbols go into the ABC as `"G7"` in front of the note, replacing the note's first chord symbol and leaving text annotations (`"^Verse"`) alone. A lower-case root is capitalized, `nc` becomes `N.C.`, and a `%` or backslash is dropped (abcjs would read the rest of the line as a comment, or the closing quote as part of the text). Text that is not a chord name (a root, sharp or flat, a quality such as m7b5, maj7, dim, aug, sus4, alt or m(maj7), and slash bass, optionally in parentheses) is still written, and the box and the status line say it prints but does not play. The Chord button is marked, and names the symbol, when the note has one. Each change is one undo step.
- On a B♭ or E♭ instrument the box shows and takes written pitch, and the source keeps concert pitch: written `C7` on clarinet is stored as `Bb7`. With Concert pitch on, the box shows and takes concert pitch, as the score does.
- Only chord names play. abcjs played any text starting with A–G as a chord (`Coda` as C, `D.C.` as D, `Fine` as F) and carried the last chord on through `N.C.`; now such text is silent, and `N.C.` stops the accompaniment until the next symbol.
- **Chords** (next to Count-in) plays the chord symbols as an accompaniment, on by default. Turning it off leaves the accompaniment out of playback, carrying on from the same place if the score is playing; MIDI export keeps it. The setting is remembered (`fretfree-practice-chords`) and backed up.
- Transposing (the Transpose panel and the written-pitch display) moves chord symbols by the interval's letters. abcjs spelled them without regard to the key, so concert `Db` showed as `D#` on a B♭ clarinet instead of `Eb`, and `Ab/C` as `A#/D`. It also moved any text starting with A–G (`Coda` became `Doda`, `D.C.` became `E.C.`); text that is not a chord name now stays as written, before notes and bar lines alike.
- `parseChordSymbol`, `tidyChordSymbol`, `chordSymbolOf`, `setChordSymbol` and `transposeChordSymbol` in score-tools.js read, tidy, find, set and move chord symbols; `midiBytes(source, {chordsOff})` leaves them out of the MIDI.

---

# New score templates · 2026-10-06

- **＋ New score** now opens a setup panel with Title, Template, Key, Time signature, Tempo, Pickup (none or 1–3 beats) and Bars (1–64). Templates: Melody, Lead sheet, Piano (braced right and left hand), Duet (two staves for the current instrument), Melody and bass, SATB choir and String quartet (viola in alto clef, cello in bass clef). Every staff starts as whole-bar rests that pass the bar check, with the pickup excused; the first rest is selected and the score has focus, so typing starts at once. The panel works from the keyboard (Enter creates, Escape closes) and fits a phone screen. **＋ New score** on My scores opens the same panel.
- **Blank melody** (and *Write something new* on the library page) keeps the one-click start: eight empty bars of 4/4 in C major. The Bars box moved into the panel.
- In a score with several staves, **＋ 4 bars** adds the bars to every staff in one undo step (an `&` overlay gets them once, with its staff), letters typed with nothing selected go to the top staff, and typing on a rest picks the octave from that staff's clef and earlier notes (C on a blank left-hand staff is `C,`, not `C`). The caption under the title counts the staves (*Piano · 4 staves · Concert pitch.*) instead of naming one clef; guitar tab is not counted as a staff. With guitar tab shown, drawing on a staff below the top one uses that staff's clef.
- A lead sheet starts its chord line with the key's tonic chord over the first full bar (`"C"`, `"Am"`, `"Em"` in E dorian). A chord symbol on a rest now stays on that beat when a note is written over the rest.
- Piano, Melody and bass and SATB choir use the piano sound and the string quartet the violin, so nothing is transposed; per-part sounds are planned. Melody, Lead sheet and Duet keep the current instrument, and a duet's staves take its clef and transposition (two bass staves on cello). `templateSource({template, title, key, meter, unit, tempo, bars, pickup})` in score-tools.js writes the ABC: one voice block per staff with `clef=` (none on a duet, so the instrument's clef applies), `name=` and `snm=`, grouped by `%%score`, four bars to a line.

---

# MusicXML import · 2026-10-06

- **Open ABC or MusicXML** in the studio now also opens MusicXML from MuseScore, Noteflight, Finale, Sibelius or Dorico: `.musicxml` and `.xml` files, and compressed `.mxl` files, which a small zip reader in `musicxml.js` unpacks with the browser's own `DecompressionStream`. Files up to 5 MB are read on the device; nothing is uploaded.
- `musicXMLToABC` writes the score as ABC at concert pitch, from partwise or timewise files. Each staff becomes a voice with the part's name and clef (a score of one voice is a plain melody, without a staff name); a piano's staves are braced and two voices on one staff share it with `%%score`. abcjs carries an inline key change from one voice into the voices written after it, so when the key changes in a score of several voices, each voice's line starts by naming its own key. ABC reads `%` as a comment, so a percent sign in a title, name or copyright line is written as the full-width `％`. It reads pitches with key-aware accidentals (and accidentals carried by ties over the bar line), rests, chords, ties, dots, tuplets, grace notes, beams, mid-score key, meter and clef changes, octave clefs, transposing parts (moved to concert pitch), chord symbols, up to eight verses of lyrics, dynamics, hairpins, articulations, ornaments, fermatas, slurs, rehearsal marks, segno, coda and D.C./D.S./Fine words, repeats with numbered endings, tempo marks and the file's system breaks. Timing comes from each note's duration, so a gap in a voice becomes a rest and every voice keeps the same bars.
- After opening, the status line says how many parts and measures came in and lists in plain words what was left out, for example *"Left out: pedal marks and tremolos."* The first part's name picks the instrument when it matches one. The instrument setting shows every part for that instrument, so a B♭ or E♭ instrument is chosen only when every part is written for it; parts in different transpositions open as Piano, at concert pitch. A damaged file, another kind of file, a password-protected `.mxl`, a file with no music or a browser that cannot unpack `.mxl` gets a message, and the open score stays as it was.
- A FretFree MusicXML export comes back with its `fretfree-rights` metadata, so later exports carry the same credits and license. Since anyone can write such a file, only the credit and source fields come back, and a link only when it is a web address or a path on this site; a `javascript:` or `data:` link is dropped. The `% FretFree-Rights:` line of an opened ABC file goes through the same check (`importedRights` in `rights-tools.js`). A copyright line from another program is kept as `%%abc-copyright`: abcjs prints it under the score, and the MIDI and MusicXML exports carry it.
- `tests/check.cjs` round-trips the FretFree scores (abcjs must play the same pitches at the same times, with the same chord symbols and lyrics) and a 200-score library sample (exporting the import again gives the same notes, rests, lyrics and chord symbols), and checks that the rights metadata comes back. Fixtures in `tests/fixtures/` (CC0): a MuseScore 3.2.3 `.mxl` with a flute, a B♭ clarinet and a two-staff piano, its uncompressed `.musicxml`, a timewise file full of things ABC cannot show, and a flute and cello that change key inside a line while the cello changes clef (abcjs must play the file's own pitches in every voice). Small built-in files check the instrument choice, part names, percent signs and damaged transpositions, which are held to a few octaves so they cannot hang the page. `tests/library-ui.cjs` opens them through the file picker, with damaged, oversized and unreadable files, and with crafted `javascript:` links in a MusicXML and an ABC file. `tests/browser.cjs` opens the `.mxl` from the keyboard at phone width in Chromium.
- Checked by hand: all 6,149 library scores that export give the same notes, rests, lyrics, chord symbols and rights metadata after export, import and export again, with no abcjs warnings; 48 library scores converted to `.mxl` by MuseScore 3.2.3 import without errors or warnings.

---

# Concert pitch view · 2026-10-06

- **Concert pitch** (a checkbox under Instrument) appears for Clarinet in B♭, Trumpet in B♭ and Alto sax in E♭. Ticked, the score shows the key and pitches of the ABC source, as the instrument sounds; unticked, it shows the written part as before. The caption under the score says which one is shown.
- Typed letters, drawn notes, accidentals in the note menu and palette, Shift+letter chord notes, piano keys and MIDI keyboard notes all enter the pitch shown, so on a B♭ clarinet the C key writes concert C in Concert pitch view and concert B♭ in the written view.
- Note names, letters in noteheads, classroom colors and the spelling Respell names in the status line follow the pitch shown.
- Playback, the ABC source and the undo history do not change when the view changes. Writing-prompt goals and new assignments still use written pitch, so a clarinet asked for G major is judged in G major in either view; while Concert pitch is on, the checklist says its goals are in written pitch.
- Changing the view closes an open note menu. A note menu left open while the score is redrawn for another instrument asks for a fresh right-click instead of editing the wrong note.
- Display only, remembered in the browser (`fretfree-concert-pitch`) and included in backups. Prints and SVG exports show the score as it is on screen.

---

# MIDI keyboard input and respelling · 2026-10-06

- **MIDI input** (next to Piano keys) enters notes and chords from a USB MIDI keyboard. The button shows only where the browser has Web MIDI (Chrome, Edge and other Chromium browsers, and Firefox); it asks for MIDI access without SysEx, listens to every connected input, and the status line names the keyboards and follows them being plugged in or out. Blocked access gets a plain message, and the button stays off.
- Each note goes in through the piano strip's entry path: keys are written pitch, notes land over the selected rest or after the selected note at the current length, spelled for the key in force, and each sounds with Hear notes. Notes that start within 40 ms of each other make one chord, entered lowest first (60, 64 and 67 together give `[CEG]`). Held keys light the piano strip. Notes played while the score is playing, or away from Compose, are ignored, and so are drum pads (MIDI channel 10). Turning MIDI input off closes the keyboard's connection, so other apps can use it.
- **Z** respells the selected note or chord at the same pitch: `^C` becomes `_D` and back, `E` becomes `_F`, and D, G and A cycle through double accidentals. On a touch screen, **Respell** in the notation palette (and in the note menu) does the same. A chord moves as one and comes back in two presses: its other pitches swap (`[GCE]` becomes `[G^B,_F]`) while D, G and A stay plain, unless the chord has nothing else. A plain letter is read with the key signature and the bar's earlier accidentals, accidentals are written out only where the plain letter would change the pitch, and later notes in the bar keep theirs: `^C D` becomes `_D =D`, and the natural goes again with `^C`. Pressing again on the same note returns exactly the text it started from, and each press is one undo step. It works on one note or chord at a time; on a range selection it says so and changes nothing. The status line names the new spelling in written pitch. The pure `respell(text, key, {midis, explicit})` and `respellEdit()` are in score-tools.js.

---

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
