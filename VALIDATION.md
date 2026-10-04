# FretFree validation — 2026-10-03

Baseline: the supplied ZIP, containing 841 scores. Final library: **3,883 scores**, with **3,042 additions** (1,828 O’Neill, 272 Open Hymnal, 942 Mutopia).

## Completed checks

- All 3,883 ABC entries parse without warnings, produce playable MIDI, and transpose by -12, +2, and +9 semitones without warnings. First MIDI pitches move by the requested amount; source concert pitches remain correct.
- All 3,883 scores engrave to SVG in a real Chromium browser without rendering exceptions or warnings.
- Every bundled PDF, original MIDI, and original ABC/LilyPond/source ZIP is checked against its recorded SHA-256. Original MIDI decodes to finite, nonempty playback.
- All 841 original IDs and original ABC remain intact. Edition source URLs/IDs are deduplicated; distinct arrangements/settings of a shared title remain separate.
- Existing `commonnote-scores-v1` and `commonnote-favorites-v1` records survive initialization and score operations; saving again updates a saved item rather than duplicating it.
- Native mouse clicks select the original concert-pitch ABC, and upward drags raise source pitch across transposing instruments. The engraving/controller regression additionally covers all instrument configurations, Unicode offsets, chord/rhythm preservation, repeats, pickups, ties, and tempo changes.
- Playback begins at a selected measure. Live percent speed updates preserve the original ABC and Q tempo; speed scaling preserves timing relationships.
- Every collection and exact-license filter returns the expected entries. Browser pagination, title/genre search, original-score links, saved-score updates, and mobile viewport width pass.
- ABC, MIDI, SVG, and print retain credits/license notices for every represented license version. MIDI metadata leaves note events/timing unchanged. Re-exporting a credited ABC replaces its notice block without multiplying it.
- GPL ABC/MIDI/SVG include the full GPL v2 text and editable source; printed GPL output includes a source/license appendix. All 1,828 downloadable GPL original-source bundles include the exact original ABC, full license, and contributor notices.

## Deliberate exclusions and limits

- 22 O’Neill transcriptions fail notation/transposition checks; they are excluded, without silently correcting source music. The earlier chat’s reported count was not substituted for actual results here.
- 26 Open Hymnal settings fail the unrestricted per-score public-domain admission rule; 8 additional candidates fail notation/transposition checks. Accepted upper voices omit lyrics/accompaniment and unsupported decorations; complete original ABC is retained. Some upper voices contain chords.
- Additional Mutopia candidates are excluded if source downloads fail, contributor credits cannot be resolved for a licensed edition, the upper MIDI reduction is empty, or the meter is unsupported. Separate multipart source editions without a supported import path were not guessed into the library.
- No Public Domain Song Anthology entries were added: official Dataverse, Fulcrum, and UVA Libra byte downloads returned HTTP 403. The official publication and dataset’s CC0 declaration were identified, but not used to invent missing score bytes.
- Full-score PDFs/MIDI and original sources are preserved; editable Mutopia practice parts remain upper-part reductions limited to 32 bars. Playback uses local synthesized tones, not source recordings. Automated checks do not replace manual musical proofreading of every transcription.

## Test entry points

`tests/check.cjs`, `tests/library-ui.cjs`, `tests/editor-playback.cjs`, `tests/browser.cjs`, `tests/rights-browser.cjs`. See README for development dependencies and execution.
