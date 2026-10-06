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
      musicxml: abcToMusicXML($('abc').value, {item: current}),
      turnIn: JSON.parse(
        turnInFile({
          name: 'A student',
          at: Date.now(),
          title: 'Practice',
          met: 0,
          total: 0,
          url: '',
          abc: $('abc').value
        })
      ).abc
    }));
    assert.ok(exported.abc.includes(license));
    assert.ok(exported.turnIn.includes(license), 'The turn-in file carries the credits');
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
      assert.ok(exported.turnIn.includes('GNU GENERAL PUBLIC LICENSE'));
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
  const renderErrors = [];
  for (let start = 0; start < length; start += 100) {
    const failures = await page.evaluate(
      ({start}) => {
        const box = document.createElement('div');
        document.body.appendChild(box);
        const failures = [];
        for (const score of catalog.slice(start, start + 100)) {
          try {
            const tune = ABCJS.renderAbc(box, score.abc, {staffwidth: 740})[0];
            if (!box.querySelector('svg') || !tune?.engraver) throw Error('No SVG');
            if (tune.warnings?.length) throw Error(tune.warnings.join(';'));
          } catch (e) {
            failures.push({id: score.id, error: e.message});
          }
          box.replaceChildren();
        }
        box.remove();
        return failures;
      },
      {start}
    );
    renderErrors.push(...failures);
    if (start % 500 === 0) console.log('Engraved', start, 'of', length);
  }
  fs.writeFileSync('render-errors.json', JSON.stringify(renderErrors, null, 2));
  assert.deepEqual(renderErrors, []);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS: every catalog score engraves; collection/exact-license filters; ABC, MIDI, SVG, MusicXML, turn-in file and print credits; GPL license/source embedding (MusicXML too); exported MIDI preserves playback.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
