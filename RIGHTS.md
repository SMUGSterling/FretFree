# Music rights and provenance

The definitive per-edition record is `catalog-rights.json`. The app’s MIT license applies to site code, not to every piece of music. Edition labels and filters refer to notation/transcription/arrangement rights, separately from the historical composition.

## Admission policy

Public Domain, CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, and GPL music is accepted. Exact license versions and source declarations are retained; restricted worship-only, no-derivatives, CPDL-only, informal (“free for non-commercial use” without a licence granting modification and redistribution), or ambiguous declarations are not admitted. FretFree itself is a free, ad-free site, so Creative Commons NonCommercial editions are admitted as a distinct class: they are labelled **NON-COMMERCIAL EDITION** on cards and in the rights box, every export and share link carries the restriction in plain words, and users are told they may use, share and adapt them for lessons, practice and free events but not sell them, use them at paid events, or place them on advertising-supported sites. Anyone deploying a fork of this site commercially must remove the NC collections; the MIT code licence does not cover the music. A free download alone is not permission to redistribute an edition. Distinct licensed editions of the same composition can remain separate; an identical existing edition ID/source is never imported again.

## O’Neill’s Music of Ireland (1903), 1,850 collection

Original historical music is out of copyright according to the collection’s own notice. The modern ABC transcriptions are copyright 1997–2000 by the O’Neill’s Project contributors and licensed **GNU GPL version 2 or, at the recipient’s option, any later version** (`GPL-2.0-or-later`). See:

- https://trillian.mit.edu/~jc/music/book/ONeills/_1850/Copyright.html
- `licenses/oneill-copyright.html`
- `licenses/oneill-contributors.html`
- `licenses/GPL-2.0.txt`
- ABC mirror: https://github.com/folkies/oneill/tree/master/1850/abc

Per-file contributor initials are resolved using the original contributor list. Files with a numeric suffix lacking an individual credit retain collective project attribution and explicitly state that the individual transcriber is unspecified. Original files are unchanged and hashed. Playable catalog ABC adds attribution/license comments. No permission is inferred for the separate 1,001 collection; none of it is bundled.

Redistribution must retain notices, the GPL license, identifiable change notices, and corresponding editable source. ABC exports include these notices and the GPL text. MIDI and SVG exports embed the corresponding editable ABC and license. Printed GPL exports include an editable-source/license appendix. Keep the notices and appendix when distributing copies or adaptations.

## Open Hymnal

Source: http://openhymnal.org/OpenHymnal2014.06-abc.zip

Copying policy: http://openhymnal.org/copying.html (retained in `licenses/openhymnal-copying.html`). Every included setting must individually declare public domain without conflicting restrictions. The complete original ABC is retained unchanged, including words, accompaniment, credits, source citations, and copyright declarations. Some files in this named archive carry revisions later than 2014; each declaration is retained verbatim.

The practice part is explicitly labeled **extracted upper voice/melody**. FretFree removes other voices, lyrics, and unsupported decorations, supplies a default tempo only when needed, and retains playable inline tempo instructions. Some upper voices contain chords. This reduction is not the complete original hymnal setting. Score-specific declaration checks and notation/transposition exclusions are recorded in `scripts/`.

## Mutopia

Source policy: https://www.mutopiaproject.org/legal.html

Each edition has its own public-domain dedication or exact CC BY / CC BY-SA version. Do not equate the historical composition’s age with the modern edition’s rights. Original PDFs, MIDI, and editable LilyPond files/source ZIPs retain credits and notices unchanged. Listing HTML, contributor headers, hashes, and per-edition URLs are recorded.

The editable FretFree study is an adaptation: upper MIDI track, highest note at simultaneous onsets, up to 32 bars, durations quantized to sixteenth notes, with accompaniment/performance markings omitted. CC BY credit, license, source, and change notices remain attached. CC BY-SA studies and user adaptations retain the same exact edition license when shared. Public-domain editions remain explicitly distinguished from licensed transcriptions/arrangements.

## OpenScore Lieder Corpus

Source: https://github.com/OpenScore/Lieder (MuseScore `.mscx` editions), pinned to the commit recorded in `scripts/lieder-exclusions.json` and on every entry (`sourceCommit`, `sourceFile`, `sourceSHA256`). License: https://github.com/OpenScore/Lieder/blob/main/LICENSE.txt, **CC0 1.0 Universal**; the project asks for, but does not require, credit to OpenScore Lieder. The compositions are nineteenth-century songs in the public domain.

The practice part is explicitly labeled **vocal line only**: `scripts/import-openscore.py` (profile `lieder`) takes the top vocal staff's first voice and writes pitch spelling (from MuseScore's tonal pitch class), durations, ties, tuplets, repeats and endings, key and meter changes, and the opening tempo. The piano part, lyrics, grace notes, dynamics and other markings are omitted, and bars of silence before the first and after the last sung note are trimmed (the entry's `studyTransform` says how many). Irregular bar lengths in the source (cadenza bars, written-out pickups) are kept as written. Each candidate must parse, play and transpose cleanly under `scripts/validate-candidates.cjs`; the few that do not are listed in `scripts/lieder-exclusions.json` with the reason. Original files are not vendored (665 MB): each entry records the pinned GitHub path and SHA-256 of its source instead.

## OpenScore String Quartets

Source: https://github.com/OpenScore/StringQuartets (MuseScore `.mscx` editions), pinned to the commit recorded in `scripts/quartets-exclusions.json` and on every entry. License: https://github.com/OpenScore/StringQuartets/blob/main/LICENSE.txt, **CC0 1.0 Universal**, credit requested. Composition rights follow the US public-domain context: without per-work publication dates, only composers who died before 1930 are admitted, whose quartets were published before 1930 with near certainty. Fifteen later composers (Bartók, Beach, Bridge, Delius, Elgar, Glazunov, d'Indy, Krzyżanowska, Moeran, Müller-Hermann, Nielsen, Ravel, Schulhoff, Smyth, Richard Strauss) are listed in the exclusions file pending a publication-date check, not because their encodings are restricted.

The practice part is explicitly labeled **first violin part of one movement**: `scripts/import-openscore.py quartets` takes the Violin 1 staff's first voice, splits the file into movements at section breaks or where a final barline is followed by a new tempo marking, and writes each movement as the Lieder profile does. The other three parts, grace notes, dynamics and other markings are omitted. Movement titles come from the movement's opening tempo marking.

## Paul Hardy’s Session Tunebook

Source: Paul Hardy’s Session Tunebook, 2016 edition (ABC), http://www.paulhardy.net/. The tunebook header declares “Copyright Paul Hardy (paul@paulhardy.net) 2004-2016. This work is licenced under a Creative Commons ‘Attribution Non-Commercial Share Alike’ cc by-nc-sa licence. See http://creativecommons.org/licenses/by-nc-sa/3.0/ - Contact Paul Hardy for commercial licensing terms.” Every tune carries a `Z:` credit line repeating the licence. Notation licence: **CC-BY-NC-SA-3.0**. The copy imported is the one in https://github.com/danwatford/abc (commit `012724a7`), whose whole-file SHA-256 is recorded in `scripts/library-stats.json` and on every entry (`sourceFileSHA256`); the tunebook and its licence block are retained in `licenses/pgh-session-tunebook-2016.abc` and `licenses/pgh-session-tunebook-notice.txt`, and each tune’s original text in `scores/pgh-<number>/original.abc`.

Composition rights are judged per tune from the `C:` field under the US public-domain rule used for the quartets: traditional, anonymous and pre-1930 compositions are admitted (534 tunes); 35 tunes are excluded: those credited to named composers with dates of 1930 or later or with no dates at all (for example Scan Tester, Pat Shaw, John Kirkpatrick, Jay Ungar), and three credited as traditional that are known later compositions (Mairi’s Wedding, Bannerman 1934; Stop the Cavalry, Lewie 1980; Wild Mountain Thyme, McPeake 1957), kept in a hand-reviewed list in the importer and listed in `scripts/pgh-exclusions.json`. The practice part is the complete original transcription with its guitar chords, which play as accompaniment; `%%` typesetting and MIDI-accompaniment directives are removed and nothing is musically reduced (`scripts/import-pgh.py`). Difficulty labels are estimates from range and rhythm.

Non-commercial terms, as shown to users: free to use, share and adapt with credit for lessons, practice and free events; not for sale, paid events or advertising-supported sites; adaptations keep the same licence. Contact Paul Hardy for commercial terms.

## FretFree baseline studies

The four historical teaching melodies and eight original exercises retain their baseline CC0-1.0 notation dedication. Their IDs, ABC, and favorites remain compatible. Other baseline Mutopia editions retain their public-domain declarations.

## Exports and saved work

Rights metadata remains attached to saved scores. ABC export/reimport preserves metadata. MIDI includes copyright/text metadata plus editable ABC without changing note events or tempo. SVG includes visible attribution/license text and editable ABC metadata, covering all engraved sections. Printed output retains credit, edition license, and source/license links; GPL output also includes a source/license appendix.

Private composition remains the user’s work. Importing, editing, transposing, or exporting another score does not remove its original permissions. Only include originals in redistributed bundles when their individual rights permit it.

## Public Domain Song Anthology

Official publication: https://aperio.press/news/2020-03-17-public-domain-song-anthology/

Dataset: https://dataverse.lib.virginia.edu/dataset.xhtml?persistentId=doi%3A10.18130%2FV3%2FC4RD06

The publication identifies the songs and contributed harmonizations as unrestricted/public domain; the dataset identifies CC0-1.0. Official Dataverse, Fulcrum XML, and UVA Libra downloads returned HTTP 403 in this environment. No inaccessible songs are included or counted. The investigation log is retained for a future import from official bytes.

## Jurisdiction

Public-domain claims follow the sources’ United States context. Rights in other jurisdictions may differ. The edition manifest records actual source declarations, not an independent global copyright clearance.
