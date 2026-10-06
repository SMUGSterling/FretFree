const {chromium} = require('playwright'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
  for (const collection of await page.evaluate(() => [...new Set(catalog.map(scoreCollection))])) {
    await page.selectOption('#collection-filter', collection);
    const count = await page.evaluate(() => filteredCatalog().length);
    assert.ok(count > 0);
    assert.equal(count, await page.evaluate(c => catalog.filter(x => scoreCollection(x) === c).length, collection));
  }
  await page.selectOption('#collection-filter', 'all');
  const licenses = await page.evaluate(() => [...new Set(catalog.map(scoreLicense))]);
  for (const license of licenses) {
    await page.evaluate(() => show('library'));
    await page.selectOption('#license-filter', license);
    const id = await page.evaluate(() => filteredCatalog()[0].id);
    await page.evaluate(id => openScore(catalog.find(x => x.id === id)), id);
    assert.ok(
      (await page.locator('#rights').textContent()).includes(
        license === 'Public Domain' ? 'PUBLIC-DOMAIN' : license === 'CC0-1.0' ? 'CC0' : license
      )
    );
    const exported = await page.evaluate(() => ({
      abc: creditedABC($('abc').value, current),
      midi: Array.from(creditedMidi(midiBytes($('abc').value), $('abc').value, current)),
      svg: creditedSVG($('notation'), $('abc').value, current),
      notes: parseMidi(midiBytes($('abc').value)).notes,
      musicxml: abcToMusicXML($('abc').value, {item: current})
    }));
    assert.ok(exported.abc.includes(license));
    assert.equal(
      await page.evaluate(abc => creditedABC(abc, current), exported.abc),
      exported.abc,
      'Rights notice is idempotent'
    );
    assert.ok(exported.svg.includes(license));
    const musicxml = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml'),
        credit = [...doc.querySelectorAll('credit')].find(c => c.querySelector('credit-type').textContent === 'rights');
      return {
        wellFormed: !doc.querySelector('parsererror'),
        rights: doc.querySelector('identification > rights')?.textContent,
        credit: credit?.querySelector('credit-words').textContent,
        expected: exportCredit(current)
      };
    }, exported.musicxml);
    assert.ok(musicxml.wellFormed, 'MusicXML is well-formed');
    assert.ok(musicxml.rights.includes(license) && musicxml.credit === musicxml.expected, 'MusicXML credits');
    assert.ok(Buffer.from(exported.midi).toString('utf8').includes(license));
    const check = await page.evaluate(
      ({abc, midi, notes}) => {
        const parsed = ABCJS.parseOnly(abc);
        return {warnings: parsed[0].warnings || [], notes: parseMidi(Uint8Array.from(midi)).notes, original: notes};
      },
      {abc: exported.abc, midi: exported.midi, notes: exported.notes}
    );
    assert.deepEqual(check.warnings, []);
    assert.deepEqual(check.notes, check.original);
    if (license.startsWith('GPL')) {
      assert.ok(exported.svg.includes('GNU GENERAL PUBLIC LICENSE'));
      assert.ok(exported.abc.includes('GNU GENERAL PUBLIC LICENSE'));
      assert.ok(Buffer.from(exported.midi).toString().includes('GNU GENERAL PUBLIC LICENSE'));
      assert.ok(exported.musicxml.includes('GNU GENERAL PUBLIC LICENSE'));
    }
    await page.evaluate(() => {
      window.print = () => {};
      $('print').onclick();
    });
    await page.emulateMedia({media: 'print'});
    assert.equal(await page.locator('#rights').evaluate(e => getComputedStyle(e).display), 'block');
    if (license.startsWith('GPL'))
      assert.ok((await page.locator('#print-appendix').textContent()).includes('GNU GENERAL PUBLIC LICENSE'));
    await page.emulateMedia({media: 'screen'});
  }
  await page.evaluate(() => show('library'));
  await page.selectOption('#license-filter', 'all');
  const length = await page.evaluate(() => catalog.length);
  const renderErrors = [],
    timings = [];
  for (let start = 0; start < length; start += 100) {
    const {failures, timed} = await page.evaluate(
      ({start}) => {
        // The highlight's clock against the sound: each drawn note's time (noteTimings, set up as the studio does)
        // must be when the MIDI sounds its pitch. abcjs's two clocks also part after a tuplet of uneven notes
        // ((3:2:3 A3/2 A/ B, (3ABc>G, or one note in (3:2:1 B,3), which shifts what follows whatever the tempo, so
        // only the notes before such a tuplet count.
        const timing = (tune, score) => {
          settleTempo(tune).setUpAudio();
          tune.setTiming();
          const uneven = new Set();
          for (const line of tune.lines || [])
            for (const staff of line.staff || [])
              for (const voice of staff.voices || []) {
                let group = null;
                for (const e of voice) {
                  if (e.startTriplet) group = {size: e.startTriplet, notes: []};
                  if (group && e.el_type === 'note') group.notes.push(e);
                  if (group && e.endTriplet) {
                    if (group.notes.length < group.size || new Set(group.notes.map(n => n.duration)).size > 1)
                      uneven.add(group.notes[0].startChar);
                    group = null;
                  }
                }
              }
          const events = tune.noteTimings.filter(e => e.type === 'event'),
            cut = Math.min(...events.filter(e => e.startCharArray?.some(c => uneven.has(c))).map(e => e.milliseconds));
          const heard = new Map();
          for (const n of parseMidi(midiBytes(score.abc)).notes)
            heard.set(n.note, [...(heard.get(n.note) || []), n.start]);
          let notes = 0,
            off = 0;
          for (const e of events) {
            if (!e.midiPitches?.length || e.milliseconds >= cut) continue;
            const t = e.milliseconds / 1000,
              near = s => Math.abs(s - t) <= 0.003 + 0.002 * t;
            notes++;
            if (![...e.midiPitches, ...(e.midiGraceNotePitches || [])].some(p => heard.get(p.pitch)?.some(near))) off++;
          }
          return {id: score.id, notes, off};
        };
        const box = document.createElement('div');
        document.body.appendChild(box);
        const failures = [],
          timed = [];
        for (const score of catalog.slice(start, start + 100)) {
          try {
            const tune = ABCJS.renderAbc(box, score.abc, {staffwidth: 740})[0];
            if (!box.querySelector('svg') || !tune?.engraver) throw Error('No SVG');
            if (tune.warnings?.length) throw Error(tune.warnings.join(';'));
            // Meters whose beat is not a quarter or an eighth (2/2, C|, 3/2, 6/4…) and tempo or meter changes.
            const {den} = tune.getMeterFraction(),
              body = score.abc.slice(score.abc.search(/^K:/m)).replace(/^K:.*$/m, '');
            if ((den !== 8 && !(den === 4 && tune.getBeatLength() === 0.25)) || /^[MQ]:|\[[MQ]:/m.test(body))
              timed.push(timing(tune, score));
          } catch (e) {
            failures.push({id: score.id, error: e.message});
          }
          box.replaceChildren();
        }
        box.remove();
        return {failures, timed};
      },
      {start}
    );
    renderErrors.push(...failures);
    timings.push(...timed);
    if (start % 500 === 0) console.log('Engraved', start, 'of', length);
  }
  fs.writeFileSync('render-errors.json', JSON.stringify(renderErrors, null, 2));
  assert.deepEqual(renderErrors, []);
  // A tempo mismatch puts nearly every note off: before the cut-time fix, at least 78% in each 2/2, 3/2, 4/2 and C|
  // score. What remains are other abcjs slips, such as a tie into a rest that silences the tied note, or a note
  // beside a tuplet in another voice.
  const total = timings.reduce((a, x) => a + x.notes, 0),
    off = timings.reduce((a, x) => a + x.off, 0);
  assert.ok(timings.length > 900, `Timing checked in ${timings.length} scores`);
  assert.deepEqual(
    timings.filter(x => x.off > Math.max(2, x.notes * 0.2)),
    [],
    'Each drawn note is timed when it sounds'
  );
  assert.ok(off < total * 0.01, `Highlight and sound agree on ${total - off} of ${total} notes`);
  console.log(`Highlight and sound agree on ${total - off} of ${total} notes in ${timings.length} scores`);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS: every catalog score engraves; collection/exact-license filters; ABC, MIDI, SVG, MusicXML and print credits; GPL license/source embedding (MusicXML too); exported MIDI preserves playback; the highlight keeps time with the sound in cut time, 3/2, 6/4 and other meters, and through tempo and meter changes.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
