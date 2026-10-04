# Music rights and provenance

The definitive per-edition record is `catalog-rights.json`. The app’s MIT license applies to site code, not to every piece of music. Edition labels and filters refer to notation/transcription/arrangement rights, separately from the historical composition.

## Admission policy

Only Public Domain, CC0, CC BY, CC BY-SA, and GPL music is accepted. Exact license versions and source declarations are retained; restricted worship-only, noncommercial, no-derivatives, CPDL-only, or ambiguous declarations are not admitted. A free download alone is not permission to redistribute an edition. Distinct licensed editions of the same composition can remain separate; an identical existing edition ID/source is never imported again.

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
