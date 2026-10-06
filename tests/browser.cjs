// Optional real-browser regression: npm install --no-save playwright; npx playwright install chromium
const {chromium} = require('playwright'),
  assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? {executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage']}
      : {})
  });
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    if (!localStorage.getItem('commonnote-scores-v1')) {
      localStorage.setItem(
        'commonnote-scores-v1',
        JSON.stringify([
          {id: 'legacy', title: 'Old saved score', abc: 'X:1\nT:Old saved score\nM:4/4\nL:1/4\nK:C\nC4 |]', updated: 1}
        ])
      );
      localStorage.setItem('commonnote-favorites-v1', '["ode","mutopia-263"]');
    }
  });
  await page.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
  assert.ok(await page.evaluate(() => catalog.length >= 800));
  const source = 'X:1\nT:Browser test\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC D E F | G4 | c4 |]';
  for (const instrument of ['Flute', 'Clarinet in B♭', 'Alto sax in E♭', 'Cello']) {
    await page.evaluate(
      ({source, instrument}) => {
        openScore({abc: source, instrument});
        window.scrollTo({top: 0, behavior: 'instant'});
      },
      {source, instrument}
    );
    const head = page.locator('#notation .abcjs-notehead').first();
    await head.scrollIntoViewIfNeeded();
    let box = await head.boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    assert.equal(
      await page.evaluate(() => $('abc').value.slice($('abc').selectionStart, $('abc').selectionEnd).trim()),
      'C'
    );
    box = await head.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, {steps: 8});
    await page.mouse.up();
    assert.ok(
      await page.evaluate(() => parseMidi(midiBytes($('abc').value)).notes[0].note > 60),
      'Mouse upward raises source pitch: ' + instrument
    );
    assert.equal(await page.locator('#warnings').textContent(), '');
  }
  // Drag ratio: 10 screen px per staff step, steady under sideways jitter, and finished even when released outside the score.
  await page.evaluate(
    ({source}) => {
      openScore({abc: source, instrument: 'Flute'});
      window.scrollTo({top: 0, behavior: 'instant'});
    },
    {source}
  );
  {
    const head = page.locator('#notation .abcjs-notehead').first();
    await head.scrollIntoViewIfNeeded();
    const box = await head.boundingBox(),
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x + (i % 2 ? 3 : -3), y + (40 * i) / 20);
    await page.mouse.up();
    assert.match(
      await page.evaluate(() => $('abc').value),
      /\nF, D E F \|/,
      '40px down lowers exactly four staff steps'
    );
  }
  await page.evaluate(
    ({source}) => {
      openScore({abc: source, instrument: 'Flute'});
      $('start-measure').value = 1;
    },
    {source}
  );
  await page.click('#play');
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('#notation .abcjs-playing')].filter(e => e.classList.contains('abcjs-note'))
          .length
    ),
    1,
    'Sounding note lights up'
  );
  await page.click('#stop');
  assert.equal(await page.locator('#notation .abcjs-playing').count(), 0, 'Stop clears highlight');
  // Draw mode: a click on the middle line between notes 2 and 3 adds a one-beat B4; the note menu edits it.
  await page.evaluate(
    ({source}) => {
      openScore({abc: source, instrument: 'Flute'});
      window.scrollTo({top: 0, behavior: 'instant'});
    },
    {source}
  );
  await page.click('#draw-mode');
  {
    const [x, y] = await page.evaluate(() => {
      const svg = $('notation').querySelector('svg'),
        st = renderedTune.engraver.staffgroups[0].staffs[0],
        [a, b] = renderedTune.engraver.selectables.slice(1, 3).map(s => {
          const r = s.svgEl.getBBox();
          return r.x + r.width / 2;
        });
      const p = new DOMPoint((a + b) / 2, st.absoluteY - (6 * 93) / 24).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    });
    await page.mouse.click(x, y);
    assert.match(
      await page.evaluate(() => $('abc').value),
      /\nC D B E F \|/,
      'Draw adds a quarter note at the clicked pitch and position'
    );
  }
  await page.click('#draw-mode');
  for (const [label, expected] of [
    ['♯ Sharp', /C D \^B E/],
    ['Half', /C D \^B2 E/],
    ['Dotted', /C D \^B3 E/],
    ['Delete note', /C D E F/]
  ]) {
    await page.locator('#notation .abcjs-notehead').nth(2).click({button: 'right', force: true});
    await page.locator('#note-menu button', {hasText: label}).click();
    assert.match(await page.evaluate(() => $('abc').value), expected, 'Note menu: ' + label);
  }
  // Practice loop: Shift+click sets the range; passes are gapless and the speed trainer steps up each pass.
  await page.evaluate(() => {
    const orig = AudioContext.prototype.createOscillator;
    window.__starts = [];
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this),
        s = o.start.bind(o);
      o.start = t => {
        __starts.push({t, click: o.type === 'square'});
        s(t);
      };
      return o;
    };
  });
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nM:4/4\nL:1/4\nQ:1/4=240\nK:C\nC D E F | G A B c | d e f g | a4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.locator('#notation .abcjs-notehead').nth(4).click({force: true});
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['1', '4'],
    'A plain click selects a note without moving the practice range'
  );
  await page
    .locator('#notation .abcjs-notehead')
    .nth(9)
    .click({force: true, modifiers: ['Shift']});
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['2', '3'],
    'Shift+click sets the range from the selected note to the clicked one'
  );
  assert.equal(await page.locator('#notation .range-shade').count(), 1, 'Practice range is shaded');
  // "Practice from here" in the note menu moves the start and keeps the end unless it would fall before the start.
  await page.locator('#notation .abcjs-notehead').nth(1).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Practice from here'}).click();
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['1', '3'],
    'Practice from here moves the start and keeps a later end'
  );
  await page.locator('#notation .abcjs-notehead').nth(12).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Practice from here'}).click();
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['4', '4'],
    'Practice from here past the end runs to the last measure'
  );
  await page.locator('#notation .abcjs-notehead').nth(4).click({force: true});
  await page
    .locator('#notation .abcjs-notehead')
    .nth(9)
    .click({force: true, modifiers: ['Shift']});
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['2', '3'],
    'Shift+click resets the range for the loop'
  );
  await page.evaluate(() => {
    $('speed').value = 50;
    $('speed').oninput();
    $('trainer-step').value = '10';
  });
  await page.check('#trainer');
  await page.check('#metronome');
  // Clicking notes above sounded them (Hear notes); count only what playback schedules.
  await page.evaluate(() => (__starts.length = 0));
  await page.click('#play');
  await page.waitForTimeout(4600);
  const starts = await page.evaluate(() => __starts);
  assert.match(await page.locator('#play-status').textContent(), /Measures 2–3 · 60% speed · loop 2/);
  await page.click('#stop');
  const notes = starts.filter(s => !s.click).map(s => s.t);
  assert.ok(notes.length >= 9, 'Second pass scheduled');
  assert.ok(Math.abs(notes[8] - notes[7] - 0.5) < 0.01, 'Loop restarts on the next beat with no gap');
  assert.ok(Math.abs(notes[9] - notes[8] - 0.25 / 0.6) < 0.01, 'Second pass plays at the trained speed');
  assert.ok(starts.filter(s => s.click).length >= 8, 'Metronome clicks every beat');
  await page.evaluate(() => {
    for (const id of ['trainer', 'metronome', 'loop', 'count-in']) $(id).checked = false;
    $('speed').value = 100;
    $('speed').oninput();
  });
  // Bar check: plain-language flags with fixes; library editions only flag bars the student changed.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:Bars\nM:4/4\nL:1/4\nK:C\nC D E F | G A B | c d e f g | a4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  assert.match(
    await page.locator('#bar-check').innerText(),
    /Measure 2 has 3 beats; 4\/4 needs 4 beats\. Add a quarter note or rest\./
  );
  assert.equal(await page.locator('#notation .bar-flag').count(), 2, 'Flagged bars are tinted');
  await page.click('[data-bar-fix="rest"]');
  assert.match(await page.evaluate(() => $('abc').value), /G A B z \|/, 'Fill with a rest');
  await page.click('[data-bar-fix="split"]');
  assert.match(await page.evaluate(() => $('abc').value), /c d e f \| g \|/, 'Split the bar');
  assert.equal(
    await page.evaluate(() => creditedSVG($('notation'), $('abc').value, current).includes('bar-flag')),
    false,
    'Exports omit overlays'
  );
  await page.evaluate(() => {
    dirty = false;
    openScore(catalog.find(i => i.id === 'oneill-1850-0005'));
  });
  assert.match(await page.locator('#bar-check').innerText(), /historic edition has 1 bar that doesn’t match/);
  assert.equal(await page.locator('#notation .bar-flag').count(), 0);
  await page.evaluate(() => {
    const a = $('abc');
    a.value = a.value.replace('B>cd cAG', 'B>cd cA');
    a.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(500);
  assert.match(
    await page.locator('#bar-check').innerText(),
    /Measure 4 has 5 eighths; 6\/8 needs 6 eighths/,
    'Only the student’s change is flagged'
  );
  await page.evaluate(() => {
    const item = {
      id: 'test-edition',
      title: 'Edition',
      abc: 'X:1\nT:Edition\nM:4/4\nL:1/4\nK:C\nC D E F | G A B | c d e f | G A B | c4 |]',
      rights: 'test'
    };
    catalog.push(item);
    dirty = false;
    openScore(item);
  });
  assert.match(
    await page.locator('#bar-check').innerText(),
    /2 bars that don’t match/,
    'Repeated edition bars are counted separately'
  );
  await page.evaluate(() => {
    const a = $('abc');
    a.value = a.value.replace('| G A B | c4', '| G A B | G A B | c4');
    a.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(500);
  assert.match(
    await page.locator('#bar-check').innerText(),
    /Measure 5 has 3 beats/,
    'A student copy of an edition bar is still flagged'
  );
  await page.evaluate(() => {
    catalog.pop();
    dirty = false;
    openScore({abc: 'X:1\nT:L\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 | [L:1/16] G4 A4 B4 | c16 |]'});
  });
  await page.click('[data-bar-fix="rest"]');
  assert.match(await page.evaluate(() => $('abc').value), /B4 z4 \|/, 'Rest fix uses the inline unit length');
  // Undo/redo: score edits and typing are separate steps; undoing to the opened text clears unsaved state.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:U\nM:4/4\nL:1/4\nK:C\nC D E F | G A B | c4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  assert.ok(await page.locator('#undo').isDisabled(), 'Nothing to undo after opening');
  await page.click('[data-bar-fix="rest"]');
  await page.locator('#notation .abcjs-notehead').nth(0).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Sharp'}).click();
  await page.fill('#title', 'Renamed');
  await page.evaluate(() => {
    const a = $('abc');
    a.focus();
    a.setSelectionRange(a.value.length, a.value.length);
  });
  await page.keyboard.type(' % note', {delay: 20});
  await page.waitForTimeout(400);
  const body = () => page.evaluate(() => $('abc').value.trim().split('\n').pop());
  await page.keyboard.press('Control+z');
  assert.equal(await body(), '^C D E F | G A B z | c4 |]', 'Ctrl+Z in the ABC box undoes the typing burst');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#title').inputValue(), 'U', 'Header edit is its own step');
  await page.click('#undo');
  assert.equal(await body(), 'C D E F | G A B z | c4 |]', 'Menu edit undone');
  await page.click('#undo');
  assert.equal(await body(), 'C D E F | G A B | c4 |]', 'Bar fix undone');
  assert.equal(await page.evaluate(() => dirty), false, 'Back at the opened text');
  assert.ok(await page.locator('#undo').isDisabled());
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await body(), 'C D E F | G A B z | c4 |]', 'Redo');
  await page.click('#undo');
  await page.locator('#notation .abcjs-notehead').nth(1).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Flat'}).click();
  assert.ok(await page.locator('#redo').isDisabled(), 'A new edit clears redo');
  // Undo review fixes: note buttons, instrument, typing bursts, menu, saved clean state.
  const reopenU = () =>
    page.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:U\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |]', instrument: 'Flute'});
      window.scrollTo({top: 0, behavior: 'instant'});
    });
  await reopenU();
  await page.evaluate(() => {
    const a = $('abc');
    a.setSelectionRange(a.value.length, a.value.length);
  });
  await page.click('[data-token="D"]');
  await page.click('[data-token="E"]');
  await page.click('#undo');
  assert.match(await page.evaluate(() => $('abc').value), /c \|\]D $/, 'Each note-button click is its own step');
  await reopenU();
  await page.selectOption('#instrument', 'Clarinet in B♭');
  await page.waitForTimeout(400);
  await page.click('#undo');
  assert.equal(await page.inputValue('#instrument'), 'Flute', 'Instrument change is undoable');
  assert.equal(await page.evaluate(() => dirty), false);
  await reopenU();
  await page.evaluate(() => {
    const a = $('abc');
    a.focus();
    a.setSelectionRange(a.value.length, a.value.length);
  });
  for (const t of [' %a', ' %b', ' %c']) {
    await page.keyboard.type(t, {delay: 10});
    await page.waitForTimeout(500);
  }
  assert.equal(await page.evaluate(() => historyIndex), 1, 'Typing bursts in one field merge');
  await page.locator('#notation .abcjs-notehead').nth(0).click({button: 'right', force: true});
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+z');
  assert.ok(await page.locator('#note-menu').isHidden(), 'Undo closes the note menu');
  await reopenU();
  await page.evaluate(() => {
    const a = $('abc');
    a.setSelectionRange(a.value.length, a.value.length);
  });
  await page.click('[data-token="G"]');
  await page.click('#save');
  await page.click('#undo');
  assert.equal(await page.evaluate(() => dirty), true, 'Undo away from a save is unsaved');
  await page.click('#redo');
  assert.equal(await page.evaluate(() => dirty), false, 'Redo back to the save is clean');
  await page.evaluate(() => {
    saved = saved.filter(x => x.id !== savedId);
    localStorage.setItem('commonnote-scores-v1', JSON.stringify(saved));
    dirty = false;
  });
  // Keyboard note entry: letters in the nearest octave at the input length, arrows, accidentals, tie, delete; menu inserts.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:G\nG2 A2 B2 c2 | d8 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  const kbody = () => page.evaluate(() => $('abc').value.trim().split('\n').pop());
  await page.locator('#notation .abcjs-notehead').nth(3).click({force: true});
  for (const k of ['e', '4', 'f', 'g', 'ArrowUp', 'Control+ArrowDown', '#']) await page.keyboard.press(k);
  assert.equal(await kbody(), 'G2 A2 B2 c2 e f ^A | d8 |]', 'Keys add, resize, move and sharpen notes');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('+');
  await page.keyboard.press('Delete');
  assert.equal(await kbody(), 'G2 A2 B2 c2 e ^A | d8 |]', 'Arrow selects, Delete removes');
  assert.equal(
    await page.evaluate(() => $('abc').value.slice(...selectedRange)),
    'e ',
    'Delete keeps the previous note selected'
  );
  await page.keyboard.press('r');
  await page.keyboard.press('|');
  assert.equal(await kbody(), 'G2 A2 B2 c2 e z | ^A | d8 |]', 'Rest and bar line keys');
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), 'G2 A2 B2 c2 e z ^A | d8 |]', 'Keyboard edits are undoable');
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', instrument: 'Clarinet in B♭'});
  });
  await page.locator('#notation .abcjs-notehead').nth(3).click({force: true});
  await page.keyboard.press('a');
  assert.equal(await kbody(), 'C D E F G | G4 |]', 'Letters name the written pitch for transposing instruments');
  await page.locator('#notation .abcjs-notehead').nth(1).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Tie to next'}).click();
  await page.locator('#notation .abcjs-notehead').nth(1).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Rest'}).click();
  assert.equal(await kbody(), 'C D- z E F G | G4 |]', 'Menu ties and inserts a rest');
  // Notes that open a slur or tuplet take menu and key edits and keep the ( or (3.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:C\n(C D E F) (3GAB c2 |]', instrument: 'Flute'});
  });
  await page.locator('#notation .abcjs-notehead').nth(0).click({button: 'right', force: true});
  await page.locator('#note-menu button', {hasText: 'Quarter'}).click();
  await page.locator('#notation .abcjs-notehead').nth(4).click({force: true});
  await page.keyboard.press('#');
  await page.keyboard.press('.');
  assert.equal(await kbody(), '(C2 D E F) (3^G3/2AB c2 |]', 'Slur- and tuplet-start notes are editable');
  // Range selection and the clipboard with real keys and clicks: Shift+→ selects and highlights a run, Ctrl+C/V/D/X
  // copy, paste, duplicate and cut (one undo each), and the buttons do the same.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:R\nM:4/4\nL:1/4\nK:G\nG A B c | d4 | z4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  const rbody = () => page.evaluate(() => $('abc').value.trim().split('\n').pop()),
    rsel = () => page.evaluate(() => $('abc').value.slice($('abc').selectionStart, $('abc').selectionEnd).trim()),
    lit = () => page.evaluate(() => document.querySelectorAll('#notation .abcjs-note[fill="#317761"]').length);
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await rsel(), 'G A B c', 'Shift+→ three times selects four notes in the ABC text');
  assert.equal(await lit(), 4, 'and highlights all four');
  await page.keyboard.press('Control+c');
  await page.locator('#notation .abcjs-rest').first().click({force: true});
  await page.keyboard.press('Control+v');
  assert.equal(await rbody(), 'G A B c | d4 | G A B c |]', 'Ctrl+V writes the copy over a whole-bar rest');
  assert.equal(await lit(), 4, 'The pasted notes are selected');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+d');
  assert.equal(await rbody(), 'G A B c | d4 | G A B c | G A B c | G A B c |]', 'Ctrl+D twice: three copies');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('#');
  assert.equal(await rbody(), 'G A B c | d4 | G A B c | G A B c | ^A ^B ^c ^d |]', '↑ and # change every note');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await rbody(), 'G A B c | d4 | G A B c | G A B c |]', 'One undo per edit');
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+x');
  assert.equal(await rbody(), 'G z z c | d4 | G A B c | G A B c |]', 'Ctrl+X leaves rests of the same length');
  assert.equal(await page.locator('#bar-check').getAttribute('class'), 'bar-check ok', 'The bar check stays clean');
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page
    .locator('#notation .abcjs-notehead')
    .nth(2)
    .click({force: true, modifiers: ['Shift']});
  assert.equal(await rsel(), 'c | d4', 'Shift+click selects across a bar line');
  await page.click('#duplicate-notes');
  assert.equal(await rbody(), 'G z z c | d4 c | d4 | G A B c | G A B c |]', 'The Duplicate button');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'notation',
    'Focus goes back to the score, ready for keys'
  );
  // Writing prompts: blank bars of rests, typing writes over them, goals tick off live; keys follow written pitch.
  await page.evaluate(() => {
    dirty = false;
    $('instrument').value = 'Flute';
  });
  await page.click('#open-prompts');
  assert.equal(await page.locator('.prompt-card').count(), 9, 'Prompt picker lists every prompt');
  await page.click('[data-prompt="first-melody"]');
  const pbody = () => page.evaluate(() => $('abc').value.trim().split('\n').pop());
  assert.equal(await pbody(), 'z4 | z4 | z4 | z4 |]', 'Prompt starts with one rest per bar');
  const met = () => page.evaluate(() => document.querySelectorAll('#prompt-check li.met').length);
  assert.equal(await met(), 0);
  for (const k of ['c', 'd', 'e', 'f', 'g', '6', 'e', '5', 'f', 'd', 'e', 'd', '6', 'c', 'c'])
    await page.keyboard.press(k);
  assert.equal(await pbody(), 'c d e f | g e2 f | d e d c | c2 z2 |]', 'Typing over rests keeps every bar full');
  assert.equal(await met(), 5, 'All goals met');
  assert.match(await page.locator('#prompt-check').innerText(), /All goals met/);
  await page.evaluate(() => {
    dirty = false;
    $('instrument').value = 'Clarinet in B♭';
  });
  await page.click('#open-prompts');
  await page.click('[data-prompt="step-by-step"]');
  assert.equal(
    await page.evaluate(() => [$('abc').value.match(/^K:.*/m)[0], writtenABC().match(/^K:(\S+)/m)[1]].join(' ')),
    'K:F G',
    'Prompt key is written pitch for transposing instruments'
  );
  for (const k of ['g', 'a', 'b', 'a', 'g', 'a', 'b', 'c', 'd', 'c', 'b', 'a', 'b', 'a', 'g', 'g'])
    await page.keyboard.press(k);
  await page.selectOption('#instrument', 'Flute');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => writtenABC().trim().split('\n').pop()),
    'G A B A | G A B c | d c B A | B A G G |]',
    'Changing instrument keeps the written notes of a prompt'
  );
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('#prompt-check li.met').length),
    4,
    'Goals still met after changing instrument'
  );
  await page.evaluate(() => {
    dirty = false;
    $('instrument').value = 'Flute';
    newScore();
  });
  assert.ok(await page.locator('#prompt-check').isHidden(), 'No prompt panel on a plain score');
  // Phase 1: play from a note, note names, guitar tab, recorder fingering.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:P\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G A B c |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
    window.__plays = [];
    const p = window.play;
    window.play = (...a) => {
      __plays.push(JSON.stringify(a));
      return p(...a);
    };
  });
  await page.locator('#notation .abcjs-notehead').nth(5).dblclick({force: true});
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => __plays.at(-1)),
    '[2.5,{"countIn":true}]',
    'Double-click plays from the note with count-in'
  );
  await page.evaluate(() => stop());
  await page.locator('#notation .abcjs-notehead').nth(2).click({force: true});
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __plays.at(-1)), '[1,{"countIn":true}]', 'Space plays from the selected note');
  assert.equal(await page.evaluate(() => playing), true);
  await page.keyboard.press(' ');
  assert.equal(await page.evaluate(() => playing), false, 'Space stops');
  await page.selectOption('#note-names', 'solfege');
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll('#notation .abcjs-annotation')].map(a => a.textContent).join(' ')
    ),
    'do re mi fa sol la ti do',
    'Solfège under each note'
  );
  assert.ok(!(await page.evaluate(() => $('abc').value)).includes('"_'), 'Labels never touch the ABC source');
  await page.selectOption('#note-names', 'off');
  await page.selectOption('#instrument', 'Recorder');
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#fingering-label'), 'Recorder fingering');
  assert.equal(
    await page.locator('#notation .recorder-fingering').count(),
    8,
    'A fingering diagram under every note in range'
  );
  await page.selectOption('#instrument', 'Guitar');
  await page.waitForTimeout(400);
  assert.ok(
    await page.evaluate(() => renderedTune.engraver.staffgroups[0].staffs.some(s => s.isTabStaff)),
    'Guitar shows tab'
  );
  await page.uncheck('#fingering');
  assert.ok(
    !(await page.evaluate(() => renderedTune.engraver.staffgroups[0].staffs.some(s => s.isTabStaff))),
    'Tab can be hidden'
  );
  await page.check('#fingering');
  await page.selectOption('#instrument', 'Flute');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#fingering-option'));
  await page.evaluate(() => {
    window.play = window.play;
    localStorage.removeItem('fretfree-note-names');
    localStorage.removeItem('fretfree-fingering');
  });
  // Review fixes: sustained highlights, implicit L:, written-pitch accidentals, chord and broken-rhythm lengths.
  const reopen = (abc, instrument = 'Flute') =>
    page.evaluate(
      ([abc, instrument]) => {
        dirty = false;
        openScore({abc, instrument});
        window.scrollTo({top: 0, behavior: 'instant'});
      },
      [abc, instrument]
    );
  const menuEdit = async (n, label) => {
    await page.locator('#notation .abcjs-notehead').nth(n).click({button: 'right', force: true});
    await page.locator('#note-menu button', {hasText: label}).click();
    return page.evaluate(() => $('abc').value);
  };
  await reopen('X:1\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n%%score (1 2)\nV:1\nE F G A|]\nV:2\nC,4|]');
  await page.click('#play');
  await page.waitForTimeout(800);
  assert.equal(
    await page.locator('#notation .abcjs-note.abcjs-playing').count(),
    2,
    'Held whole note stays lit under moving quarters'
  );
  await page.click('#stop');
  await reopen('X:1\nM:2/4\nK:C\nC4 D4|]');
  assert.match(await menuEdit(0, 'Half'), /C8 D4/, 'Implicit L:1/16 in 2/4');
  await reopen('X:1\nM:4/4\nL:1/4\nK:C\nB c d e|]', 'Clarinet in B♭');
  assert.match(await menuEdit(0, 'Natural'), /_B c d e/, 'Natural applies to written pitch');
  await reopen('X:1\nM:4/4\nL:1/4\nK:C\n[C2E2G2] z2|]');
  assert.match(await menuEdit(0, 'Whole'), /\[CEG\]4 z2/, 'Chord length replaces inner lengths');
  await reopen('X:1\nM:4/4\nL:1/4\nK:C\nC>D E F|]');
  assert.match(await menuEdit(0, 'Half'), /C2D\/2 E F/, 'Broken rhythm neighbour keeps its length');
  await page.evaluate(
    ({source}) => {
      openScore({abc: source, instrument: 'Flute'});
      $('start-measure').value = 3;
      window.scrollTo({top: 0, behavior: 'instant'});
    },
    {source}
  );
  await page.click('#play');
  assert.match(await page.locator('#play-status').textContent(), /Measures 3–3/);
  await page.evaluate(() => ($('speed').value = 75));
  await page.locator('#speed').dispatchEvent('input');
  assert.equal(await page.locator('#speed-value').textContent(), '75%');
  assert.equal(await page.evaluate(() => $('abc').value), source, 'Speed preserves Q/source');
  await page.click('#stop');
  // Blank sheet: a new score is empty bars; draw mode fills a bar's rest instead of adding beats beside it.
  await page.evaluate(() => {
    dirty = false;
    newScore();
  });
  const sheet = () => page.evaluate(() => $('abc').value.trim().split('\n').pop());
  assert.equal(await sheet(), 'z4 | z4 | z4 | z4 | z4 | z4 | z4 | z4 |]', 'New score is a blank sheet');
  await page.click('#draw-mode');
  const firstRest = await page.locator('#notation .abcjs-rest').first().boundingBox();
  await page.mouse.click(firstRest.x + firstRest.width / 2 - 20, firstRest.y + firstRest.height / 2);
  await page.waitForFunction(() => !$('abc').value.includes('z4 | z4 | z4 | z4 | z4 | z4 | z4 | z4'));
  assert.match(
    await sheet(),
    /^[A-Ga-g][,']* z3 \| z4 \| z4 \| z4 \| z4 \| z4 \| z4 \| z4 \|\]$/,
    'Drawing on a blank bar replaces the start of its rest'
  );
  // A second click just right of the new note, nearer to it than to the rest, still fills the bar's rest.
  const firstNote = await page.locator('#notation .abcjs-note').first().boundingBox();
  await page.mouse.click(firstNote.x + firstNote.width + 6, firstNote.y - 12);
  await page.waitForFunction(() => !/^[A-Ga-g][,']* z3 \|/.test($('abc').value.trim().split('\n').pop()));
  assert.match(
    await sheet(),
    /^[A-Ga-g][,']* [A-Ga-g][,']* z2 \| z4 \| z4 \| z4 \| z4 \| z4 \| z4 \| z4 \|\]$/,
    'Drawing beside a note in a part-filled bar consumes the rest rather than overfilling the bar'
  );
  await page.click('#draw-mode');
  await page.click('#add-bars');
  assert.equal(await page.evaluate(() => $('measure-count').textContent), 'of 12', 'Add 4 bars extends the sheet');
  // Backup and restore: Back up falls back to a download when no Save As dialog exists; Restore merges a file.
  await page.evaluate(() => {
    dirty = false;
    window.showSaveFilePicker = undefined;
    window.__downloads = [];
    download = (data, name, type) => __downloads.push({data, name, type});
    show('saved');
  });
  await page.click('#backup');
  await page.waitForFunction(() => __downloads.length === 1);
  const backup = await page.evaluate(() => JSON.parse(__downloads[0].data));
  assert.equal(backup.app, 'FretFree', 'Backup is a FretFree file');
  assert.match(
    await page.locator('#backup-status').textContent(),
    /Last backed up .* Everything saved is in that backup\./
  );
  await page.locator('#restore-file').setInputFiles({
    name: 'fretfree-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'FretFree',
        format: 1,
        scores: [
          {id: 'from-backup', title: 'From backup', abc: 'X:1\nT:From backup\nM:4/4\nL:1/4\nK:G\nG4 |]', updated: 1}
        ],
        favorites: ['ode']
      })
    )
  });
  await page.waitForFunction(() => saved.some(x => x.id === 'from-backup'));
  assert.ok(
    await page
      .locator('#saved-cards')
      .textContent()
      .then(t => t.includes('From backup')),
    'Restored score listed'
  );
  assert.ok(await page.evaluate(() => favorites.includes('ode')), 'Restored favorite merged');
  assert.match(await page.locator('#toast').textContent(), /Restored: 1 score added/);
  assert.match(
    await page.locator('#backup-status').textContent(),
    /1 score changed since/,
    'A restored score counts as not yet backed up'
  );
  // The Save As path: a mocked picker writes the file, a remembered handle is reused without asking again, a
  // cancelled picker changes nothing, and a handle that fails to write falls back to a download.
  await page.evaluate(() => {
    window.__writes = [];
    window.__pickerCalls = 0;
    window.__handle = {
      name: 'chosen.json',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({write: async t => __writes.push(t), close: async () => {}})
    };
    window.__stored = null;
    loadBackupHandle = async () => __stored;
    saveBackupHandle = async h => (__stored = h);
    forgetBackupHandle = async () => (__stored = null);
    window.showSaveFilePicker = async () => {
      __pickerCalls++;
      if (window.__cancel) {
        const e = new Error('cancelled');
        e.name = 'AbortError';
        throw e;
      }
      return __handle;
    };
  });
  await page.click('#backup');
  await page.waitForFunction(() => __writes.length === 1);
  assert.equal(await page.evaluate(() => __pickerCalls), 1, 'Picker asked once');
  assert.match(await page.locator('#backup-status').textContent(), /to chosen\.json/);
  await page.click('#backup');
  await page.waitForFunction(() => __writes.length === 2);
  assert.equal(await page.evaluate(() => __pickerCalls), 1, 'Remembered handle reused without a second dialog');
  await page.evaluate(() => {
    __stored = null;
    __cancel = true;
    __downloads.length = 0;
  });
  const statusBefore = await page.locator('#backup-status').textContent();
  await page.click('#backup');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __writes.length + __downloads.length), 2, 'Cancelling writes nothing');
  assert.equal(await page.locator('#backup-status').textContent(), statusBefore, 'Cancelling leaves the status alone');
  await page.evaluate(() => {
    __cancel = false;
    __stored = {...__handle, createWritable: async () => Promise.reject(new Error('disk'))};
  });
  await page.click('#backup');
  await page.waitForFunction(() => __downloads.length === 1);
  assert.equal(await page.evaluate(() => __stored), null, 'A handle that fails to write is forgotten');
  assert.match(await page.locator('#backup-status').textContent(), /to fretfree-backup-/, 'Fell back to a download');
  // Share by link: the link carries the edited score, instrument and the library edition's credits; opening it shows the copy.
  await page.evaluate(() => {
    dirty = false;
    show('library');
  });
  await page.locator('#cards [data-open="elise"]').click();
  await page.evaluate(() => {
    $('abc').value = $('abc').value.replace('T:Für Elise', 'T:Für Elise (shared)');
    $('instrument').value = 'Cello';
    changed();
  });
  await page.click('#share-link');
  await page.waitForFunction(() => $('share-url').value.startsWith('http'));
  const shareUrl = await page.inputValue('#share-url');
  assert.match(shareUrl, /#s=1[A-Za-z0-9_-]+$/, 'Share link is compressed and URL-safe');
  const shared = await browser.newPage({viewport: {width: 1280, height: 900}});
  await shared.goto(shareUrl);
  await shared.waitForFunction(() => current?.kind === 'shared');
  assert.deepEqual(
    await shared.evaluate(() => [
      $('title').value,
      $('instrument').value,
      current.rights === catalog.find(x => x.id === 'elise').rights,
      $('rights').textContent.includes('CC0'),
      $('studio').hidden
    ]),
    ['Für Elise (shared) · opening melody', 'Cello', true, true, false],
    'The shared copy opens with its edit, instrument and the edition credits'
  );
  await shared.close();
  const broken = await browser.newPage({viewport: {width: 1280, height: 900}});
  await broken.goto((process.env.FRETFREE_URL || 'http://localhost:8000') + '/#s=1garbage');
  await broken.waitForFunction(() => !$('library').hidden);
  assert.match(await broken.evaluate(() => $('toast').textContent), /did not contain a readable score/);
  await broken.close();
  // Teacher-written assignment: build it with the keyboard on a 4-bar sheet, share it, open the link as a student,
  // write to meet every goal, and check that the instructions print above the score while the checklist does not.
  await page.evaluate(() => {
    dirty = false;
    $('instrument').value = 'Flute';
    newScore(4);
  });
  await page.click('#open-assignment');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'assignment-title',
    'The builder focuses its title'
  );
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Step <b>up</b>');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Move by step.\nEnd on C.');
  await page.focus('#goal-steps');
  await page.keyboard.press('Space');
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('#assignment-goals [data-goal]:checked')].map(b => b.id)),
    ['goal-bars', 'goal-end', 'goal-steps', 'goal-inKey']
  );
  // With the clipboard allowed, the link is copied and focus returns to ✎ Assignment instead of being lost.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.focus('#assignment-form button[type="submit"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => $('share-url').value.includes('#s='));
  const assignmentUrl = await page.inputValue('#share-url');
  assert.equal(await page.locator('#assignment-builder').isHidden(), true);
  await page.waitForFunction(() => $('toast').textContent.includes('Link copied'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-assignment', 'Focus is not lost');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), assignmentUrl);
  const student = await browser.newPage({viewport: {width: 1280, height: 900}});
  student.on('pageerror', e => errors.push(e.message));
  await student.goto(assignmentUrl);
  await student.waitForFunction(() => current?.kind === 'shared' && !$('prompt-check').hidden);
  assert.deepEqual(
    await student.evaluate(() => [
      document.querySelector('#prompt-check strong').textContent,
      document.querySelector('#prompt-check .prompt-text').textContent,
      document.querySelectorAll('#prompt-check li').length,
      document.querySelectorAll('#prompt-check b').length
    ]),
    ['Assignment · Step <b>up</b>', 'Move by step.\nEnd on C.', 4, 0],
    'The link opens with escaped instructions and a checklist of the chosen goals'
  );
  for (const k of ['c', 'd', 'e', 'f', 'g', 'f', 'e', 'd', 'c', 'd', 'e', 'f', 'e', 'd', 'c', 'c'])
    await student.keyboard.press(k);
  await student.waitForFunction(() => document.querySelectorAll('#prompt-check li.met').length === 4);
  assert.match(await student.locator('#prompt-check').innerText(), /All goals met/);
  await student.emulateMedia({media: 'print'});
  assert.deepEqual(
    await student.evaluate(() => {
      const box = $('prompt-check'),
        visible = el => !!el && getComputedStyle(el).display !== 'none';
      return [
        visible(box.querySelector('.prompt-text')),
        visible(box.querySelector('ul')),
        visible(box.querySelector('.prompt-done')),
        box.getBoundingClientRect().bottom <= $('notation').getBoundingClientRect().top
      ];
    }),
    [true, false, false, true],
    'Instructions print above the score; the checklist does not'
  );
  await student.emulateMedia({media: 'screen'});
  await student.setViewportSize({width: 390, height: 844});
  await student.click('#open-assignment');
  assert.ok(
    await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The assignment builder fits a phone'
  );
  await student.keyboard.press('Escape');
  assert.deepEqual(
    await student.evaluate(() => [$('assignment-builder').hidden, document.activeElement.id]),
    [true, 'open-assignment'],
    'Escape closes the builder and returns focus'
  );
  await student.close();
  await page.evaluate(() => {
    dirty = false;
  });
  await page.evaluate(() => {
    dirty = false;
  });
  // Try next: a library score shows three suggestions sharing its skills; opening one swaps the panel to the new score; a new score hides it.
  await page.evaluate(() => {
    dirty = false;
    show('library');
  });
  await page.locator('#cards [data-open="ode"]').click();
  const titles = () =>
    page.evaluate(() => [...document.querySelectorAll('#next-up .next-card h3')].map(h => h.textContent));
  const first = await titles();
  assert.equal(first.length, 3, 'Three suggestions');
  assert.ok(
    await page.evaluate(() => [...document.querySelectorAll('#next-up .chip')].some(c => c.textContent === 'Steps')),
    'Suggestions share the Steps skill'
  );
  assert.ok(
    await page.evaluate(() =>
      document.querySelector('#cards [data-favorite="ode"]').previousElementSibling?.classList.contains('played')
    ),
    'The open card gets its Played tag in place, without a library redraw'
  );
  await page.locator('#next-up [data-open]').first().click();
  assert.equal(
    await page.evaluate(() => $('title').value.split(' · ')[0]),
    first[0].split(' · ')[0],
    'Opening a suggestion loads it'
  );
  assert.deepEqual(
    await page.evaluate(() => [
      played.has('ode'),
      JSON.parse(localStorage.getItem('fretfree-played')).includes('ode'),
      JSON.parse(localStorage.getItem('fretfree-played')).length >= 2
    ]),
    [true, true, true],
    'Opened scores are remembered as played'
  );
  await page.click('#new-score');
  assert.equal(await page.evaluate(() => $('next-up').hidden), true, 'No suggestions for a new score');
  await page.evaluate(() => {
    dirty = false;
    show('library');
  });
  assert.ok((await page.locator('#cards .tag.played').count()) >= 1, 'Library marks played scores');
  // Skill chips: clicking a card's chip filters the library to that skill; clicking it again clears the filter.
  await page.evaluate(() => {
    dirty = false;
    show('library');
  });
  await page.locator('#cards .chip', {hasText: 'Steps'}).first().click();
  assert.deepEqual(
    await page.evaluate(() => [
      $('skill-filter').value,
      filteredCatalog().every(x => scoreSkills(x).includes('Steps')),
      document.querySelectorAll('#cards .chip[aria-pressed="true"]').length > 0
    ]),
    ['Steps', true, true],
    'Chip applies the skill filter'
  );
  await page.locator('#cards .chip[aria-pressed="true"]').first().click();
  assert.equal(await page.evaluate(() => $('skill-filter').value), 'all', 'Clicking the active chip clears the filter');
  // Library preview: Listen plays the card's opening line and lights its notes; one preview at a time; opening a score stops it.
  // Feature: transpose panel and key changes, by pointer and keyboard.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:T\nM:4/4\nL:1/4\nK:F clef=bass\nF, G, A, B, | C D E F | F,4 |]', instrument: 'Cello'});
  });
  const tbody = () => page.evaluate(() => $('abc').value.trim().split('\n').slice(-2).join(' '));
  const heads = page.locator('#notation .abcjs-note .abcjs-notehead');
  await heads.nth(4).click();
  await heads.nth(6).click({modifiers: ['Shift']});
  await page.click('#transpose-open');
  assert.equal(await page.locator('#transpose-selection-label').textContent(), 'Selection only: measure 2');
  await page.selectOption('#transpose-interval', 'm3');
  await page.selectOption('#transpose-direction', '-1');
  await page.click('#transpose-selection');
  assert.match(await page.locator('#transpose-note').textContent(), /measure 2 move down a minor 3rd/);
  await page.click('#transpose-apply');
  assert.equal(await tbody(), 'K:F clef=bass F, G, A, B, | A, =B, ^C D | F,4 |]', 'Only the selected measure moves');
  assert.ok(await page.locator('#transpose-panel').isHidden());
  await page.selectOption('#key', 'G');
  assert.ok(await page.locator('#key-choice').isVisible(), 'A new key asks before moving notes');
  const focused = () => page.evaluate(() => document.activeElement.id);
  await page.locator('#key').focus();
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'key-transpose', 'The choice comes next after Key in tab order');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.equal(await tbody(), 'K:G clef=bass F, G, A, B, | A, =B, ^C D | F,4 |]', 'Keep notes changes the key only');
  assert.equal(await focused(), 'key', 'Focus returns to Key when the choice closes');
  await page.keyboard.press('Control+z');
  assert.equal(
    await tbody(),
    'K:F clef=bass F, G, A, B, | A, =B, ^C D | F,4 |]',
    'One undo, from the Key menu, restores the key'
  );
  assert.equal(await page.locator('#key').inputValue(), 'F');
  await page.locator('#transpose-open').focus();
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('#transpose-by-interval').evaluate(e => e === document.activeElement));
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.locator('#transpose-key-row').isVisible(), 'Arrow keys pick To key');
  await page.locator('#transpose-key').selectOption('Bb');
  await page.locator('#transpose-apply').press('Enter');
  assert.equal(
    await tbody(),
    'K:Bb clef=bass B, C D E | D =E ^F G | B,4 |]',
    'To key goes the nearer way, keeping clef='
  );
  assert.match(await page.locator('#selection-status').textContent(), /up a perfect 4th\. Key: B♭ major/);
  await page.locator('#transpose-open').press('Enter');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#transpose-panel').isHidden(), 'Escape closes the panel');
  assert.ok(await page.locator('#transpose-open').evaluate(e => e === document.activeElement), 'and returns focus');
  // Concert F# major on a B-flat clarinet is written in Ab major, two letters up: the middle line (written B-flat)
  // drawn between notes 2 and 3 is concert G#, a plain G in the source.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nM:4/4\nL:1/4\nK:F#\nC D E F |]', instrument: 'Clarinet in B♭'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.click('#draw-mode');
  {
    const [x, y] = await page.evaluate(() => {
      const svg = $('notation').querySelector('svg'),
        st = renderedTune.engraver.staffgroups[0].staffs[0],
        [a, b] = renderedTune.engraver.selectables.slice(1, 3).map(s => {
          const r = s.svgEl.getBBox();
          return r.x + r.width / 2;
        });
      const p = new DOMPoint((a + b) / 2, st.absoluteY - (6 * 93) / 24).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    });
    await page.mouse.click(x, y);
    assert.equal(await tbody(), 'K:F# C D G E F |]', "Drawn notes follow the written key's letters");
  }
  await page.click('#draw-mode');
  await page.evaluate(() => {
    dirty = false;
    show('library');
  });
  await page.locator('[data-listen="ode"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.mini-score .abcjs-playing').length > 0);
  assert.deepEqual(
    await page.evaluate(() => [
      previewId,
      previewNodes.length,
      $('cards').querySelector('[data-listen="ode"]').textContent,
      document.querySelectorAll('.card.previewing').length
    ]),
    ['ode', 15, '■ Stop', 1],
    'Preview plays the 15 notes shown on the card'
  );
  await page.locator('[data-listen="mozart"]').click();
  assert.deepEqual(
    await page.evaluate(() => [previewId, $('cards').querySelector('[data-listen="ode"]').textContent]),
    ['mozart', '▶ Listen'],
    'Starting another preview stops the first'
  );
  await page.locator('[data-listen="mozart"]').click();
  assert.equal(await page.evaluate(() => previewId), null, 'Second click stops the preview');
  await page.locator('[data-listen="ode"]').click();
  await page.locator('#cards [data-favorite="mozart"]').click();
  assert.deepEqual(
    await page.evaluate(() => [previewId, previewNodes.length, document.querySelectorAll('.card.previewing').length]),
    [null, 0, 0],
    'Re-rendering the cards stops the preview'
  );
  await page.locator('#cards [data-favorite="mozart"]').click();
  await page.locator('[data-listen="ode"]').click();
  await page.locator('#cards [data-open="ode"]').click();
  assert.deepEqual(
    await page.evaluate(() => [previewId, previewNodes.length]),
    [null, 0],
    'Opening a score stops the preview'
  );
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('commonnote-scores-v1'))[0].id), 'legacy');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('commonnote-favorites-v1'))), [
    'ode',
    'mutopia-263'
  ]);
  // Master bus and note audition in a real AudioContext: every note and click reaches the speakers through one gain
  // node and a limiter; Volume changes loudness without stopping; clicks, letters, arrows and drawing sound the note
  // once; nothing sounds during playback or with Hear notes off.
  assert.deepEqual(
    await page.evaluate(() => {
      const pairs = [],
        connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (to, ...rest) {
        pairs.push([this, to]);
        return connect.call(this, to, ...rest);
      };
      const ctx = new AudioContext(),
        bus = outputNode(ctx),
        limiter = pairs.find(([from]) => from === bus)?.[1];
      AudioNode.prototype.connect = connect;
      ctx.close();
      return [
        bus instanceof GainNode,
        limiter instanceof DynamicsCompressorNode,
        pairs.some(([from, to]) => from === limiter && to === ctx.destination),
        outputNode(ctx) === bus
      ];
    }),
    [true, true, true, true],
    'Master gain feeds a limiter, then the speakers, once per context'
  );
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:Hear\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\nC D E F | z4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
    $('metronome').checked = true;
    $('volume').value = '0.3';
    window.__routes = [];
    window.__heard = [];
    const connect = AudioNode.prototype.connect,
      make = AudioContext.prototype.createOscillator;
    AudioNode.prototype.connect = function (to, ...rest) {
      __routes.push([this, to]);
      return connect.call(this, to, ...rest);
    };
    AudioContext.prototype.createOscillator = function () {
      const o = make.call(this),
        start = o.start.bind(o);
      o.start = t => {
        __heard.push({hz: Math.round(o.frequency.value * 100) / 100, type: o.type});
        start(t);
      };
      return o;
    };
  });
  await page.click('#play');
  await page.waitForTimeout(300);
  assert.deepEqual(
    await page.evaluate(() => {
      const bus = outputNode(),
        notes = __routes.filter(([from]) => from instanceof GainNode && from !== bus);
      return [notes.length > 4, notes.every(([, to]) => to === bus), __heard.some(h => h.type === 'square')];
    }),
    [true, true, true],
    'Every note and click connects to the master gain'
  );
  await page.locator('#volume').fill('0.8');
  await page.waitForTimeout(250);
  assert.deepEqual(
    await page.evaluate(() => [playing, Math.round(outputNode().gain.value * 100) / 100]),
    [true, 0.8],
    'Volume changes loudness live without stopping playback'
  );
  await page.evaluate(() => (__heard.length = 0));
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() => [playing, __heard.length]),
    [true, 0],
    'Selecting a note during playback stays quiet'
  );
  await page.click('#stop');
  await page.evaluate(() => {
    $('metronome').checked = false;
    $('volume').value = '0.3';
    updateVolume();
    __heard.length = 0;
  });
  const heard = async () => {
    await page.waitForTimeout(80);
    return page.evaluate(() => __heard.splice(0).map(h => h.hz));
  };
  await page.locator('#notation .abcjs-notehead').nth(2).click({force: true});
  assert.deepEqual(await heard(), [329.63], 'Clicking a note sounds it once');
  await page.keyboard.press('g');
  assert.deepEqual(await heard(), [392], 'Typing a letter sounds the new note');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await heard(), [349.23], 'Down arrow sounds the lowered note');
  await page.click('#draw-mode');
  {
    const [x, y] = await page.evaluate(() => {
      const svg = $('notation').querySelector('svg'),
        st = renderedTune.engraver.staffgroups[0].staffs[0],
        rest = renderedTune.engraver.selectables.find(s => s.absEl.abcelem.rest).svgEl.getBBox();
      const p = new DOMPoint(rest.x + rest.width / 2, st.absoluteY - (6 * 93) / 24).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    });
    await page.mouse.click(x, y);
  }
  assert.match(await page.evaluate(() => $('abc').value), /\| B z3 \|\]/, 'Drawing writes over the rest');
  assert.deepEqual(await heard(), [493.88], 'Drawing a note sounds it');
  await page.click('#draw-mode');
  // Note buttons: a ♯ ♭ ♮ button and then a letter sound the altered note once; letters follow the key signature.
  const cursorAfter = (abc, after) =>
    page.evaluate(
      ([abc, after]) => {
        dirty = false;
        openScore({abc, instrument: 'Flute'});
        const a = $('abc'),
          at = a.value.lastIndexOf(after) + after.length;
        a.focus();
        a.setSelectionRange(at, at);
        __heard.length = 0;
      },
      [abc, after]
    );
  await cursorAfter('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | z4 |]', 'F ');
  await page.click('[data-token="^"]');
  await page.click('[data-token="C"]');
  assert.match(await page.evaluate(() => $('abc').value), /F \^C \| z4/);
  assert.deepEqual(await heard(), [277.18], 'Sharp then C on the note buttons sounds C sharp once');
  await cursorAfter('X:1\nM:4/4\nL:1/4\nK:D\nD E | z2 |]', 'E ');
  await page.click('[data-token="F"]');
  assert.deepEqual(await heard(), [369.99], 'A note button follows the key signature');
  await page.uncheck('#audition');
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await heard(), [], 'Hear notes off is silent');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('fretfree-audition')),
    'false',
    'Hear notes is remembered'
  );
  await page.check('#audition');
  await page.evaluate(() => {
    dirty = false;
  });
  // Unsaved-work recovery: an edit made with the keyboard survives a reload; Restore (keyboard) brings it back with
  // its instrument and credits, Save clears it, and on a phone the banner fits and Discard removes the draft.
  {
    const tab = await browser.newPage({viewport: {width: 1280, height: 900}});
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    await tab.locator('#cards [data-open="ode"]').click();
    await tab.selectOption('#instrument', 'Violin');
    await tab.locator('#notation .abcjs-notehead').first().click({force: true});
    await tab.keyboard.press('ArrowUp');
    const edited = await tab.evaluate(() => $('abc').value);
    assert.notEqual(edited, await tab.evaluate(() => catalog.find(x => x.id === 'ode').abc), 'The key edits the score');
    await tab.waitForFunction(() => storedDrafts().some(d => d.tab === draftTab && d.abc === $('abc').value), null, {
      timeout: 15000
    });
    await tab.reload();
    await tab.waitForSelector('#draft-banner:not([hidden])');
    assert.match(await tab.locator('#draft-text').textContent(), /^Unsaved work from .+: Ode to Joy\.$/);
    assert.equal(await tab.evaluate(() => document.activeElement.id), 'draft-restore', 'Restore has focus');
    await tab.keyboard.press('Enter');
    assert.deepEqual(
      await tab.evaluate(() => [
        $('abc').value,
        $('instrument').value,
        current.rights === catalog.find(x => x.id === 'ode').rights,
        dirty,
        $('studio').hidden,
        $('draft-banner').hidden
      ]),
      [edited, 'Violin', true, true, false, true],
      'Restore brings back the edit, instrument and credits, marked unsaved'
    );
    await tab.click('#save');
    assert.equal(await tab.evaluate(() => localStorage.getItem('fretfree-draft')), null, 'Saving clears the draft');
    await tab.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    await tab.keyboard.press('ArrowDown');
    // No waiting for the two-second timer: the page writes the draft as it is hidden and unloaded.
    assert.equal(await tab.evaluate(() => localStorage.getItem('fretfree-draft')), null, 'The timer has not run yet');
    await tab.setViewportSize({width: 390, height: 844});
    await tab.reload();
    await tab.waitForSelector('#draft-banner:not([hidden])');
    assert.ok(
      await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'The banner fits a phone screen'
    );
    await tab.click('#draft-discard');
    assert.deepEqual(
      await tab.evaluate(() => [$('draft-banner').hidden, localStorage.getItem('fretfree-draft'), saved.length]),
      [true, null, 1],
      'Discard removes the draft and keeps the saved score'
    );
    await tab.close();
  }
  // Two tabs keep a draft each. The second tab offers the first tab's live draft; discarding it there does not lose
  // it, and an edit in the second tab does not replace it, so when both tabs are gone the next visit offers both.
  {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const open = async () => {
      const tab = await context.newPage();
      tab.on('pageerror', e => errors.push(e.message));
      tab.on('dialog', dialog => dialog.accept());
      await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
      return tab;
    };
    const edit = async tab => {
      await tab.locator('#notation .abcjs-notehead').first().click({force: true});
      await tab.keyboard.press('ArrowUp');
      await tab.evaluate(() => flushDraft());
      return tab.evaluate(() => $('abc').value);
    };
    const stored = tab => tab.evaluate(() => storedDrafts().map(d => d.abc));
    const first = await open();
    await first.locator('#cards [data-open="ode"]').click();
    const firstAbc = await edit(first);
    const second = await open();
    assert.match(
      await second.locator('#draft-text').textContent(),
      /: Ode to Joy\.$/,
      "The first tab's draft is offered"
    );
    await second.click('#draft-discard');
    await second.waitForFunction(abc => storedDrafts().some(d => d.abc === abc), firstAbc, {timeout: 15000});
    await second.evaluate(() => openScore(catalog.find(x => x.id === 'mozart')));
    const secondAbc = await edit(second);
    assert.deepEqual(await stored(second), [secondAbc, firstAbc], 'Both drafts are kept, newest first');
    await first.close({runBeforeUnload: false});
    await second.close({runBeforeUnload: false});
    const third = await open();
    assert.match(await third.locator('#draft-text').textContent(), /\(1 of 2\)\.$/);
    await third.click('#draft-discard');
    assert.match(await third.locator('#draft-text').textContent(), /: Ode to Joy \(2 of 2\)\.$/);
    await third.click('#draft-restore');
    assert.deepEqual(
      [await third.evaluate(() => $('abc').value), await stored(third)],
      [firstAbc, [firstAbc]],
      "The first tab's work comes back"
    );
    await context.close();
  }
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Mobile page fits viewport'
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS: unsaved-work recovery, backup and restore, blank sheets and draw-on-rest, try-next suggestions and played marks, skill filter chips, library card previews, native mouse clicks and upward drags across instruments, drag ratio, playback note highlight, draw mode, note properties menu (written-pitch accidentals, chords, broken rhythm, implicit L:), sustained highlights, practice ranges, gapless loops, speed trainer, metronome, bar check, undo/redo, keyboard note entry, slur- and tuplet-start edits, range selection with copy, cut, paste and duplicate, writing prompts, teacher-written assignment links (keyboard builder, student copy, print), play from a note, note names, guitar tab, recorder fingering, transposing selected measures and to a key, key changes with Keep notes, focus and undo, drawing in a respelled written key, measure playback, live percent speed, master volume bus and limiter, live volume, note audition (click, letters, note buttons, arrows, draw, off, quiet during playback), legacy storage, mobile width, and no browser errors.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
