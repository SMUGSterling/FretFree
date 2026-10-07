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
  // Scrolling closes the note menu, so scroll a note into view and let the scroll settle before right-clicking it.
  const rightClick = async note => {
    await note.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    await note.click({button: 'right', force: true});
  };
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
      // The controls above the score push its staff low in a 900 px window; a mouse click needs it in view.
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
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
    await rightClick(page.locator('#notation .abcjs-notehead').nth(2));
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
  await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
  await page.locator('#note-menu button', {hasText: 'Practice from here'}).click();
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['1', '3'],
    'Practice from here moves the start and keeps a later end'
  );
  await rightClick(page.locator('#notation .abcjs-notehead').nth(12));
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
  await rightClick(page.locator('#notation .abcjs-notehead').nth(0));
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
  await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
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
  await rightClick(page.locator('#notation .abcjs-notehead').nth(0));
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
    // The "Score saved" toast sits over the lower edge of the window, where the forced clicks below may land.
    $('toast').style.display = 'none';
  });
  // Keyboard note entry: letters in the nearest octave at the input length, arrows, accidentals, tie, delete; menu inserts.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:G\nG2 A2 B2 c2 | d8 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
    // The "Saved" toast from the step above can sit over the score near the bottom of the window.
    $('toast').style.display = 'none';
  });
  const kbody = () => page.evaluate(() => $('abc').value.trim().split('\n').pop());
  // The shortcut sheet opened and scrolled to its last command: the bottom edges of the dialog and of that command.
  const sheetEdges = () =>
    page.evaluate(() => {
      openShortcuts();
      const list = $('shortcuts-list');
      list.scrollTop = list.scrollHeight;
      const bottoms = [
        document.querySelector('.shortcuts-dialog'),
        [...list.querySelectorAll('[role="option"]')].at(-1)
      ].map(e => e.getBoundingClientRect().bottom);
      closeShortcuts();
      return {bottoms, height: innerHeight};
    });
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
  await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
  await page.locator('#note-menu button', {hasText: 'Tie to next'}).click();
  await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
  await page.locator('#note-menu button', {hasText: 'Rest'}).click();
  assert.equal(await kbody(), 'C D- z E F G | G4 |]', 'Menu ties and inserts a rest');
  // Notes that open a slur or tuplet take menu and key edits and keep the ( or (3. Opening a score scrolls smoothly
  // to the top, and a scroll closes the note menu, so the scroll ends at once.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:C\n(C D E F) (3GAB c2 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await rightClick(page.locator('#notation .abcjs-notehead').nth(0));
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
  // Notation palette: a click on a note lights up its state; pointer presses return the keyboard to the score, and
  // the toolbar works from the keyboard with one tab stop and arrow keys.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:C\n^G3- G E F G A | B8 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  const pressedNow = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#palette [aria-pressed="true"]')].map(b => b.dataset.palette).join(' ')
    );
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  assert.equal(await pressedNow(), 'len:0.25 dot tie acc:^', 'Palette shows a dotted quarter G sharp tied');
  await page.locator('[data-palette="len:0.5"]').click();
  assert.equal(await kbody(), '^G4- G E F G A | B8 |]', 'Palette Half sets a plain half note');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'notation',
    'A pointer press returns to the score'
  );
  await page.keyboard.press('.');
  assert.equal(await kbody(), '^G6- G E F G A | B8 |]', 'Keys still work after a palette press');
  assert.equal(await pressedNow(), 'len:0.5 dot tie acc:^');
  await page.locator('#notation .abcjs-notehead').nth(2).click({force: true});
  await page.locator('[data-palette="beam:join"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await kbody(), '^G6- G EF G A | B8 |]', 'Enter on Join beams the note to the next one');
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.palette),
    'beam:join',
    'A keyboard press stays on the toolbar'
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  assert.equal(await kbody(), '^G6- G E F G A | B8 |]', 'Arrow to Break, Space breaks the beam');
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('#palette [data-palette]')]
        .filter(b => b.tabIndex === 0)
        .map(b => b.dataset.palette)
    ),
    ['beam:break'],
    'The toolbar is one tab stop'
  );
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), '^G6- G EF G A | B8 |]', 'A palette edit is one undo step');
  // Articulations and dynamics: real key presses on a clicked note, palette clicks, More from the keyboard, the note menu.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  for (const k of [';', ':', '>', '"', '^']) await page.keyboard.press(k);
  assert.equal(await kbody(), '.!tenuto!!accent!!marcato!!fermata!C D E F | G4 |]', 'The five articulation keys');
  assert.equal(
    await pressedNow(),
    'len:0.25 acc: deco:staccato deco:tenuto deco:accent deco:marcato deco:fermata',
    'The palette shows every mark on the note'
  );
  await page.keyboard.press('>');
  assert.equal(await page.locator('#selection-status').textContent(), 'Accent removed.');
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page.locator('[data-palette="dyn:mf"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'A mark press returns to the score');
  await page.keyboard.press(';');
  assert.equal(await kbody(), '.!tenuto!!marcato!!fermata!C !mf!.D E F | G4 |]');
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('#notation .abcjs-dynamics').length),
    1,
    'The dynamic is engraved'
  );
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), '.!tenuto!!marcato!!fermata!C !mf!D E F | G4 |]', 'Each mark is one undo step');
  // Keyboard only: More opens from the toolbar and the arrow keys reach its buttons; closed, they are skipped.
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page.locator('[data-palette="more"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'delete', 'Closed More is skipped');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-palette="more"]').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'deco:wedge');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  assert.equal(await kbody(), '.!tenuto!!marcato!!fermata!C !mf!!trill!D E F | G4 |]', 'Space on Trill adds a trill');
  // The note menu adds a dynamic.
  await rightClick(page.locator('#notation .abcjs-notehead').nth(2));
  await page.locator('#note-menu [data-edit="dyn:pp"]').click();
  assert.equal(
    await kbody(),
    '.!tenuto!!marcato!!fermata!C !mf!!trill!D !pp!E F | G4 |]',
    'Dynamic from the note menu'
  );
  await page.locator('[data-palette="more"]').click();
  // Screen-reader announcements and the shortcut sheet, with real keys: a clicked note and the arrow keys are named
  // in the status line; ? opens the sheet, "tie" filters it to Tie and Enter ties the selected note; Tab stays in
  // the sheet, Escape gives the keyboard back to the score; and every studio button has an accessible name.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:A\nM:3/4\nL:1/8\nK:F\nC | B2 c3/2 d/ [FA]2 | z6 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  {
    const status = () => page.locator('#selection-status').textContent();
    await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    assert.match(await status(), /^Quarter note B♭4, measure 2, beat 1 · /, 'A clicked note is named');
    assert.equal(await page.locator('#selection-status').getAttribute('role'), 'status');
    await page.keyboard.press('ArrowRight');
    assert.equal(await status(), 'Dotted eighth note C5, measure 2, beat 2.', 'So is the next note');
    await page.keyboard.press('ArrowUp');
    assert.equal(await status(), 'Dotted eighth note D5, measure 2, beat 2.', 'And the note an edit changed');
    await page.keyboard.press('Control+z');
    await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    await page.keyboard.press('?');
    assert.equal(await page.locator('#shortcuts').isVisible(), true, '? opens the sheet');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcuts-search');
    await page.keyboard.type('tie');
    assert.deepEqual(
      await page.locator('#shortcuts-list [role="option"] .shortcut-name').allTextContents(),
      ['Tie to the next note'],
      'Typing "tie" filters to Tie'
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#shortcuts').isVisible(), false);
    assert.equal(await kbody(), 'C | B2- c3/2 d/ [FA]2 | z6 |]', 'Enter ties the selected note');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'The score has the keyboard again');
    await page.keyboard.press('Control+z');
    assert.equal(await kbody(), 'C | B2 c3/2 d/ [FA]2 | z6 |]', 'One undo step');
    await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    await page.keyboard.press('?');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => $('shortcuts').contains(document.activeElement)), 'Tab stays in the sheet');
    await page.locator('#shortcuts-list [role="option"]', {hasText: 'Staccato'}).click();
    assert.equal(await kbody(), 'C | .B2 c3/2 d/ [FA]2 | z6 |]', 'A click on a command runs it');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('?');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#shortcuts').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'Escape returns to the score');
    // A click on the sheet's heading or on a hint command keeps the keyboard in the sheet, so Escape still closes it;
    // Ctrl+Shift+Z on its ✕ leaves the score behind it alone.
    await page.keyboard.press('?');
    await page.locator('#shortcuts-heading').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcuts-search', 'A click on the heading');
    await page
      .locator('#shortcuts-list [role="option"]', {hasText: 'Add a note after the selection'})
      .click({force: true});
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcuts-search', 'and on a hint');
    assert.equal(await page.locator('#shortcuts-status').textContent(), 'Type a letter from A to G on the score.');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shortcuts-close');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await kbody(), 'C | B2 c3/2 d/ [FA]2 | z6 |]', 'No redo behind the open sheet');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#shortcuts').isVisible(), false, 'Escape closes it with focus on the page');
    // ? over the note menu closes the menu, so the chosen command runs on the note.
    await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
    assert.equal(await page.locator('#note-menu').isVisible(), true);
    await page.keyboard.press('?');
    assert.equal(await page.locator('#note-menu').isVisible(), false, '? closes the note menu');
    await page.keyboard.type('up a step');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), 'C | c2 c3/2 d/ [FA]2 | z6 |]', 'The command runs on the note');
    await page.keyboard.press('Control+z');
    const sheet = await sheetEdges();
    assert.ok(
      sheet.bottoms.every(b => b <= sheet.height),
      `The sheet and its last command fit: ${JSON.stringify(sheet)}`
    );
    // Every studio button has an accessible name, as Chromium computes it, with More open and the sheet shown.
    await page.locator('[data-palette="more"]').click();
    await page.click('#shortcuts-open');
    const cdp = await page.context().newCDPSession(page);
    const {root} = await cdp.send('DOM.getDocument', {depth: 0}),
      {nodeIds} = await cdp.send('DOM.querySelectorAll', {nodeId: root.nodeId, selector: '#studio button'}),
      unnamed = [];
    let checked = 0;
    for (const nodeId of nodeIds) {
      const {nodes} = await cdp.send('Accessibility.getPartialAXTree', {nodeId, fetchRelatives: false}),
        node = nodes[0];
      if (!node || node.ignored) continue;
      checked++;
      if (!node.name?.value?.trim()) {
        const {outerHTML} = await cdp.send('DOM.getOuterHTML', {nodeId});
        unnamed.push(outerHTML.slice(0, 120));
      }
    }
    await cdp.detach();
    assert.ok(checked > 60, `Checked ${checked} shown buttons`);
    assert.deepEqual(unnamed, [], 'Every shown studio button has an accessible name');
    // Hidden ones (panels not open now) have a name in their text, aria-label or title.
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll('#studio button')]
          .filter(
            b => !(b.getAttribute('aria-label') || b.textContent.trim() || b.title || b.getAttribute('aria-labelledby'))
          )
          .map(b => b.outerHTML.slice(0, 120))
      ),
      [],
      'Every studio button has a name'
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-palette="more"]').click();
  }
  // Measure tools with a real keyboard and pointer: the Measure panel opens from the toolbar, Enter inserts a bar that
  // typing fills, pointer presses add a repeat with 1st and 2nd endings that engrave, and a key change by keyboard.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | d e f g | c4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.locator('#notation .abcjs-notehead').nth(4).click({force: true});
  await page.locator('[data-palette="measure"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-palette="measure"]').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'bar:before');
  await page.keyboard.press('Enter');
  assert.equal(await kbody(), 'C D E F | z4 | G A B c | d e f g | c4 |]', 'Enter inserts a bar before measure 2');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'bar:before');
  await page.locator('#notation').focus();
  await page.keyboard.press('g');
  assert.equal(await kbody(), 'C D E F | G z3 | G A B c | d e f g | c4 |]', 'Typing writes over the new rest');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), 'C D E F | G A B c | d e f g | c4 |]', 'Undo takes the bar away again');
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  await page.locator('[data-palette="repeat:start"]').click();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'notation',
    'A pointer press returns to the score'
  );
  await page.locator('#notation .abcjs-notehead').nth(8).click({force: true});
  await page.locator('[data-palette="repeat:end"]').click();
  await page.locator('[data-palette="ending:1"]').click();
  await page.locator('#notation .abcjs-notehead').nth(12).click({force: true});
  await page.locator('[data-palette="ending:2"]').click();
  await page.locator('[data-palette="barline:|]"]').click();
  assert.equal(await kbody(), '|: C D E F | G A B c |1 d e f g :|2 c4 |]');
  assert.equal(await page.locator('#notation .abcjs-ending').count(), 2, 'Both endings are engraved');
  assert.equal(await page.locator('#warnings').textContent(), '');
  await page.locator('[data-palette="form:D.C."]').click();
  await page.locator('[data-palette="rehearsal:mark"]').click();
  assert.ok(
    await page.evaluate(() => [...document.querySelectorAll('#notation .abcjs-part')].some(e => e.textContent === 'A')),
    'The rehearsal mark is engraved'
  );
  // A key change by keyboard: the menu, then Keep notes; Escape on the choice cancels another.
  await page.locator('#notation .abcjs-notehead').nth(8).click({force: true});
  await page.selectOption('#measure-key', 'D');
  await page.locator('#measure-key-keep').focus();
  await page.keyboard.press('Enter');
  assert.match(await kbody(), /\|1 \[K:D\] d e f g :\|2/, 'Keep notes writes the key at measure 3');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'measure-key');
  await page.selectOption('#measure-key', 'F');
  await page.locator('#measure-key-transpose').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#measure-key-choice').isHidden(), true);
  assert.equal(await page.locator('#measure-key').inputValue(), 'D', 'Escape cancels the key change');
  await page.locator('[data-palette="measure"]').click();
  // Slurs and hairpins with real clicks and keys: Shift+click selects four notes, S slurs them and S again takes the
  // slur off; Cresc. draws a hairpin and hands the keyboard back to the score; one note and S slur to the next note;
  // the Lines buttons work from the keyboard; each is one undo step.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:S\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  await page
    .locator('#notation .abcjs-notehead')
    .nth(3)
    .click({force: true, modifiers: ['Shift']});
  await page.keyboard.press('s');
  assert.equal(await kbody(), '(C D E F) | G4 |]', 'S slurs the selected notes');
  assert.equal(await page.locator('#notation .abcjs-slur').count(), 1, 'The slur is engraved');
  assert.equal(await page.locator('#selection-status').textContent(), 'Slur added over 4 notes.');
  assert.equal(await page.locator('[data-palette="line:slur"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('s');
  assert.equal(await kbody(), 'C D E F | G4 |]', 'S again takes it off');
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), '(C D E F) | G4 |]', 'One undo step');
  await page.locator('#notation .abcjs-notehead').nth(0).click({force: true});
  await page
    .locator('#notation .abcjs-notehead')
    .nth(3)
    .click({force: true, modifiers: ['Shift']});
  await page.locator('[data-palette="line:crescendo"]').click();
  assert.equal(await kbody(), '!<(!(C D E !<)!F) | G4 |]', 'Cresc. adds a hairpin');
  assert.equal(await page.locator('#notation .abcjs-dynamics').count(), 1, 'The hairpin is engraved');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'The press returns to the score');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await kbody(), 'C D E F | G4 |]');
  await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
  await page.keyboard.press('S');
  assert.equal(await kbody(), 'C (D E) F | G4 |]', 'One note slurs to the next');
  // Keyboard only: arrow keys reach the Lines buttons in the toolbar, and Enter presses one.
  await page.locator('[data-palette="line:slur"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'line:diminuendo');
  await page.keyboard.press('Enter');
  assert.equal(await kbody(), 'C !>(!(D !>)!E) F | G4 |]', 'Dim. from the keyboard');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'line:diminuendo');
  // abcjs draws only the tr of a trill line, so FretFree draws the wavy line from it to the last note.
  await page.locator('#notation .abcjs-notehead').nth(3).click({force: true});
  await page.locator('[data-palette="line:trill"]').click();
  assert.equal(await kbody(), 'C !>(!(D !>)!E) !trill(!F | !trill)!G4 |]', 'Trill line to the next note');
  const [tr, wave, last] = await page.evaluate(() =>
    [
      document.querySelector('#notation [data-name="scripts.trill"]'),
      document.querySelector('#notation .trill-line'),
      document.querySelectorAll('#notation .abcjs-notehead')[4]
    ].map(e => {
      const {x, y, width, height} = e?.getBBox() || {};
      return e && {x, y, width, height};
    })
  );
  assert.ok(tr && wave, 'The tr and the wavy line are drawn');
  assert.ok(wave.x >= tr.x + tr.width && wave.x + wave.width > last.x, 'The line runs from the tr to the last note');
  assert.ok(Math.abs(wave.y + wave.height / 2 - (tr.y + tr.height / 2)) < 3, 'Level with the tr');
  assert.equal(await page.locator('#warnings').textContent(), '');
  // An embedded score has nothing selectable, and still gets the wavy line.
  {
    const code = await page.evaluate(() => encodeShare({v: 1, a: $('abc').value, i: 'Flute'})),
      embed = await browser.newPage({viewport: {width: 800, height: 700}});
    embed.on('pageerror', e => errors.push('trill embed: ' + e.message));
    await embed.goto(`${process.env.FRETFREE_URL || 'http://localhost:8000'}/#e=${code}`);
    await embed.waitForSelector('#notation .trill-line', {state: 'attached'});
    assert.equal(await embed.evaluate(() => renderedTune.engraver.selectables.length), 0, 'Nothing is selectable');
    await embed.close();
  }
  // Tuplets and grace notes with real clicks and keys: T makes a triplet whose rests letters fill, the Tuplet menu
  // opens from the toolbar, and Grace and Grace ↑ work by pointer and from the keyboard; each is one undo step.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:T\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  {
    const head = i => page.locator('#notation .abcjs-notehead').nth(i),
      status = () => page.locator('#selection-status').textContent();
    await head(0).click({force: true});
    await page.keyboard.press('t');
    assert.equal(await kbody(), '(3C/2 z/2 z/2 D E F | G4 |]', 'T makes a triplet');
    assert.equal(await page.locator('#notation .abcjs-triplet').count(), 1, 'The 3 is engraved');
    assert.equal(await page.locator('[data-palette="tuplet:3"]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    assert.equal(await kbody(), '(3C/2D/2E/2 D E F | G4 |]', 'Letters fill the rests');
    assert.equal(await page.locator('#notation .abcjs-beam-elem').count(), 1, 'The filled triplet is beamed');
    assert.equal(await status(), 'Triplet filled.');
    assert.match(await page.locator('#bar-check').textContent(), /Every bar has the right number of beats/);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.equal(await kbody(), 'C D E F | G4 |]', 'One undo step each');
    // Staccato twice on the triplet's note puts the dot on and takes it off; Delete on a rest takes the triplet off.
    await head(0).click({force: true});
    await page.keyboard.press('t');
    await head(0).click({force: true});
    await page.keyboard.press(';');
    assert.equal(await kbody(), '(3.C/2 z/2 z/2 D E F | G4 |]', 'Staccato on the first note');
    await page.keyboard.press(';');
    assert.equal(await kbody(), '(3C/2 z/2 z/2 D E F | G4 |]', 'and off again');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    assert.equal(await kbody(), 'C D E F | G4 |]', 'Delete on its rest takes the triplet off');
    assert.equal(await status(), 'Triplet removed.');
    // The Tuplet menu by pointer: a quintuplet on the half note, five eighths.
    await page.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:T\nM:4/4\nL:1/4\nK:C\nC2 D2 | G4 |]', instrument: 'Flute'});
    });
    await head(0).click({force: true});
    await page.locator('[data-palette="tuplets"]').click();
    assert.equal(await page.locator('[data-palette="tuplets"]').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-palette="tuplet:5"]').click();
    assert.equal(await kbody(), '(5:4:5C/2 z/2 z/2 z/2 z/2 D2 | G4 |]', 'Quintuplet from the menu');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'The press returns to the score');
    await page.keyboard.type('defg');
    assert.equal(await kbody(), '(5:4:5C/2D/2E/2F/2G/2 D2 | G4 |]');
    await page.locator('[data-palette="tuplets"]').click();
    assert.equal(await page.locator('#palette-tuplets').isHidden(), true, 'The menu closes again');
    // Grace notes: Grace by pointer, Grace ↑ from the keyboard (arrow keys move along the toolbar, Enter presses).
    await head(5).click({force: true});
    await page.locator('[data-palette="grace"]').click();
    assert.equal(await kbody(), '(5:4:5C/2D/2E/2F/2G/2 {E}D2 | G4 |]', 'Grace adds a grace note a step above');
    assert.equal(await status(), 'Grace note added.');
    assert.equal(await page.locator('#notation .abcjs-notehead').count(), 8, 'The grace note is engraved');
    await page.locator('[data-palette="grace"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'grace:up');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '(5:4:5C/2D/2E/2F/2G/2 {F}D2 | G4 |]', 'Grace ↑ moves only the grace note');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'grace:up', 'Focus stays');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '(5:4:5C/2D/2E/2F/2G/2 {/F}D2 | G4 |]', 'Slashed from the keyboard');
    await page.keyboard.press('Control+z');
    assert.equal(await kbody(), '(5:4:5C/2D/2E/2F/2G/2 {F}D2 | G4 |]');
    assert.equal(await page.locator('#warnings').textContent(), '');
  }
  // Chord symbols with real keys: K opens a box just above the note, Enter saves, Tab moves on; the symbols are
  // engraved and undo one at a time; the toolbar button works from the keyboard; clicking another note saves the box
  // and selects that note; Chords leaves the accompaniment out of playback.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |]', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  {
    const head = i => page.locator('#notation .abcjs-notehead').nth(i),
      chords = () =>
        page.evaluate(() => [...document.querySelectorAll('#notation .abcjs-chord')].map(e => e.textContent));
    await head(0).click({force: true});
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chord-input', 'K opens the chord box');
    const entry = await page.locator('#chord-entry').boundingBox(),
      note = await head(0).boundingBox();
    assert.ok(
      entry.y + entry.height <= note.y && note.x >= entry.x && note.x <= entry.x + 40,
      'The box sits just above the note'
    );
    await page.keyboard.type('Bb7');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '"Bb7"C D E F | G4 |]', 'Enter writes the symbol');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'and returns to the score');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('k');
    await page.keyboard.type('Gm');
    await page.keyboard.press('Tab');
    await page.keyboard.type('C7');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.type('F');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '"Bb7"C "Gm"D "C7"E F | "F"G4 |]', 'Tab moves from note to note');
    assert.deepEqual(await chords(), ['B♭7', 'Gm', 'C7', 'F'], 'The symbols are engraved');
    await page.keyboard.press('Control+z');
    assert.equal(await kbody(), '"Bb7"C "Gm"D "C7"E F | G4 |]', 'Each symbol is one undo step');
    await head(2).click({force: true});
    await page.locator('[data-palette="chord"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#chord-input').inputValue(), 'C7', 'The Chord button opens the box');
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.palette),
      'chord',
      'Escape goes back to the button'
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '"Bb7"C "Gm"D E F | G4 |]', 'An empty box removes the symbol');
    await head(0).click({force: true});
    await page.keyboard.press('k');
    await page.keyboard.type('F');
    await head(3).click({force: true});
    assert.equal(await kbody(), '"F"C "Gm"D E F | G4 |]', 'Clicking another note saves the box');
    assert.deepEqual(
      await page.evaluate(() => [$('abc').value.slice(...selectedRange), $('chord-entry').hidden]),
      ['F ', true],
      'and selects that note'
    );
    await page.keyboard.press('k');
    await page.keyboard.type('rit. 80%');
    await page.keyboard.press('Enter');
    assert.equal(await kbody(), '"F"C "Gm"D E "rit. 80"F | G4 |]', 'A % is dropped: abcjs would read a comment');
    assert.equal(await page.locator('#notation .abcjs-notehead').count(), 5, 'so every note is still engraved');
    await page.keyboard.press('Control+z');
    assert.equal(await kbody(), '"F"C "Gm"D E F | G4 |]');
    const scheduled = () =>
      page.evaluate(async () => {
        $('metronome').checked = $('count-in').checked = false;
        await play();
        const count = nodes.length;
        stop();
        return count;
      });
    const all = await scheduled();
    await page.locator('#chords').click();
    assert.equal(await scheduled(), 5, 'Without Chords only the five melody notes play');
    assert.ok(all > 5, 'With Chords the accompaniment plays too');
    await page.locator('#chords').click();
  }
  // Lyrics with real keys: L opens a box under the note's staff, typing writes the words under the notes, Enter starts
  // the second verse on the same notes and the box moves down under it, each syllable undoes on its own, the toolbar
  // button works from the keyboard, and clicking another note saves the box and selects that note.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:L\nM:4/4\nL:1/4\nK:C\nCCGG|AAG2|]\n', instrument: 'Flute'});
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  {
    const head = i => page.locator('#notation .abcjs-notehead').nth(i),
      verses = () =>
        page.evaluate(() =>
          $('abc')
            .value.split('\n')
            .filter(l => l.startsWith('w:'))
        ),
      shown = () =>
        page.evaluate(() => [...document.querySelectorAll('#notation .abcjs-lyric')].map(e => e.textContent));
    await head(0).click({force: true});
    await page.keyboard.press('l');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyric-input', 'L opens the lyrics box');
    const staff = await page.locator('#notation .abcjs-staff').first().boundingBox(),
      note = await head(0).boundingBox(),
      entry = await page.locator('#lyric-entry').boundingBox();
    assert.ok(
      entry.y >= staff.y + staff.height && entry.y < staff.y + staff.height + 30 && Math.abs(entry.x - note.x) < 20,
      'The box sits just under the staff, at the note'
    );
    await page.keyboard.type('Twin-kle twin-kle');
    await page.keyboard.press('Enter');
    assert.deepEqual(await verses(), ['w: Twin-kle twin-kle'], 'Typing writes the words under four notes');
    assert.deepEqual(await shown(), ['Twin-', 'kle', 'twin-', 'kle'], 'and they are engraved');
    assert.equal(await page.locator('#lyric-verse').textContent(), 'Verse 2', 'Enter starts the second verse');
    const lower = await page.locator('#lyric-entry').boundingBox();
    assert.ok(lower.y > entry.y + 8 && Math.abs(lower.x - entry.x) < 10, 'on the first note, under the first verse');
    await page.keyboard.type('Up a-bove ');
    assert.deepEqual(await verses(), ['w: Twin-kle twin-kle', 'w: Up a-bove']);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notation', 'Escape goes back to the score');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await verses(), ['w: Twin-kle twin-kle', 'w: Up a-'], 'Each syllable is one undo step');
    await head(2).click({force: true});
    await page.locator('[data-palette="lyric"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#lyric-input').inputValue(), 'twin', 'The Lyrics button opens the box');
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.palette),
      'lyric',
      'Escape goes back to the button'
    );
    await head(4).click({force: true});
    await page.keyboard.press('l');
    await page.keyboard.type('lit');
    await head(6).click({force: true});
    assert.deepEqual(await verses(), ['w: Twin-kle twin-kle lit', 'w: Up a-'], 'Clicking another note saves the box');
    assert.deepEqual(
      await page.evaluate(() => [$('abc').value.slice(...selectedRange), $('lyric-entry').hidden]),
      ['G2', true],
      'and selects that note'
    );
    // A verse typed to the last note keeps the box open after it: words past it go nowhere (never into the music),
    // and Enter starts the next verse.
    await page.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:L\nM:4/4\nL:1/4\nK:C\nCCGG|AAG2|]\n', instrument: 'Flute'});
    });
    await head(0).click({force: true});
    await page.keyboard.press('l');
    await page.keyboard.type('Twin-kle twin-kle lit-tle star and more ');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyric-input', 'The box stays open at the end');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Up a-bove the world so high ');
    await page.keyboard.type('x-');
    await page.keyboard.press('Escape');
    assert.deepEqual(
      [await verses(), (await page.evaluate(() => $('abc').value)).split('\n')[5]],
      [['w: Twin-kle twin-kle lit-tle star', 'w: Up a-bove the world so high'], 'CCGG|AAG2|]'],
      'Enter after the last note starts the second verse, and the music is unchanged'
    );
    assert.equal(await page.locator('#warnings').textContent(), '');
  }
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
  // Phase 1: play from a note, note names, classroom colors, guitar tab, recorder fingering.
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
  // Classroom colors and letters in noteheads: chosen from the keyboard, shown on screen, in print and in SVG export.
  {
    const before = await page.evaluate(() => $('abc').value),
      abc = 'X:1\nT:Colors\nM:4/4\nL:1/4\nK:G\nC, c [CEG] g | G, ^c z [G^g] | {a}_B2 e2 |]';
    // Opening a score scrolls smoothly to the top; the scroll is cut short so it cannot move a note under a click.
    await page.evaluate(abc => {
      dirty = false;
      openScore({abc, instrument: 'Flute'});
      window.scrollTo({top: 0, behavior: 'instant'});
    }, abc);
    await page.focus('#note-colors');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.inputValue('#note-colors'), 'classroom', 'Colors chosen from the keyboard');
    const fillsOf = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#notation .abcjs-notehead')].map(
          h =>
            h
              .getAttribute('data-name')
              .replace(/[^A-G]/gi, '')
              .toUpperCase() +
            '=' +
            getComputedStyle(h).fill
        )
      );
    const byLetter = fills => Object.fromEntries(fills.map(f => f.split('=')));
    let fills = await fillsOf();
    assert.equal(fills.filter(f => f.startsWith('C=')).length, 4);
    assert.ok(
      fills.filter(f => /^[CG]=/.test(f)).every(f => f === 'C=rgb(214, 40, 40)' || f === 'G=rgb(76, 201, 240)'),
      'Every C is red and every G light blue, in all octaves and chords: ' + fills
    );
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll('#notation .abcjs-stem, #notation .abcjs-rest path')].every(
          el => getComputedStyle(el).fill === getComputedStyle(document.querySelector('#notation .abcjs-bar path')).fill
        )
      ),
      'Stems and rests keep the ink color'
    );
    await page.selectOption('#note-names', 'heads');
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('#notation .notehead-letter')].map(t => t.textContent).join('')
      ),
      'CCCEGGGCGGBE',
      'A letter inside every head but the grace note'
    );
    assert.equal(
      await page.evaluate(() =>
        document.querySelector('#notation .abcjs-notehead[data-name="a"]').getAttribute('fill')
      ),
      '#1d3fbb',
      'The grace note is colored'
    );
    await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelectorAll('#notation .abcjs-notehead')[1]).fill),
      'rgb(49, 119, 97)',
      'A selected colored note shows the selection color'
    );
    await page.evaluate(() => {
      selectedRange = null;
      render();
    });
    const svg = await page.evaluate(() => creditedSVG($('notation'), $('abc').value, current));
    assert.ok(svg.includes('fill="#d62828"') && svg.includes('class="notehead-letter"'), 'Colors and letters export');
    assert.deepEqual(
      await page.evaluate(() => {
        const heads = [...document.querySelectorAll('#notation .abcjs-notehead')],
          fills = heads.map(h => h.getAttribute('fill'));
        for (const h of heads) {
          h.removeAttribute('data-name');
          h.removeAttribute('fill');
        }
        document.querySelectorAll('#notation .notehead-letter').forEach(t => t.remove());
        updateNoteColors();
        const letters = [...document.querySelectorAll('#notation .notehead-letter')].map(t => t.textContent).join(''),
          same = heads.every((h, i) => h.getAttribute('fill') === fills[i]);
        render();
        return [letters, same];
      }),
      ['CCCEGGGCGGBE', true],
      'Without data-name, heads pair with pitches by height and grace heads with the grace notes'
    );
    await page.emulateMedia({media: 'print'});
    assert.equal(byLetter(await fillsOf()).C, 'rgb(214, 40, 40)', 'Colors print');
    assert.ok(await page.locator('#notation .notehead-letter').first().isVisible(), 'Letters print');
    await page.emulateMedia({media: 'screen'});
    assert.equal(await page.evaluate(() => $('abc').value), abc, 'The ABC source is byte-identical');
    const later = await browser.newContext({storageState: await page.context().storageState()}),
      again = await later.newPage();
    await again.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    await again.evaluate(abc => {
      show('studio');
      openScore({abc, instrument: 'Clarinet in B♭'});
    }, 'X:1\nL:1/4\nK:C\nC E G c|]');
    assert.deepEqual(
      [await again.inputValue('#note-colors'), await again.inputValue('#note-names')],
      ['classroom', 'heads'],
      'Settings persist'
    );
    assert.equal(
      await again.evaluate(() =>
        [...document.querySelectorAll('#notation .notehead-letter')].map(t => t.textContent).join('')
      ),
      'DFAD',
      'Letters show the written pitch for a transposing instrument'
    );
    await later.close();
    await page.selectOption('#note-colors', 'off');
    await page.selectOption('#note-names', 'off');
    assert.equal(await page.locator('#notation .notehead-letter, #notation .classroom-color').count(), 0);
    await page.evaluate(abc => {
      localStorage.removeItem('fretfree-note-colors');
      dirty = false;
      openScore({abc, instrument: 'Flute'});
    }, before);
  }
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
    await rightClick(page.locator('#notation .abcjs-notehead').nth(n));
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
  // In cut time the highlight stays on the note being heard: abcjs played 2/2 MIDI at half speed (and, with no Q:,
  // timed the drawn notes at twice the speed they sounded), so the highlight ran ahead of the sound.
  for (const abc of [
    'X:1\nM:2/2\nL:1/4\nQ:1/2=60\nK:C\nC D E F | G A B c |]',
    'X:1\nM:C|\nL:1/4\nK:C\nC D E F | G A B c |]'
  ]) {
    await reopen(abc);
    await page.click('#play');
    const samples = await page.evaluate(
      abc =>
        new Promise(done => {
          const heard = parseMidi(midiBytes(abc)).notes,
            heads = [...document.querySelectorAll('#notation .abcjs-note')],
            out = [];
          const sample = () => {
            const at = playPosition();
            if (at == null || at > heard.at(-1).start) return done(out);
            const sounding = heard.findIndex(n => n.start <= at && at < n.start + n.duration);
            // Skip the moments a note changes, which the next animation frame catches up with.
            if (
              sounding >= 0 &&
              heard.every(n => Math.abs(n.start - at) > 0.05 && Math.abs(n.start + n.duration - at) > 0.05)
            )
              out.push({sounding, lit: heads.findIndex(h => h.classList.contains('abcjs-playing'))});
            setTimeout(sample, 40);
          };
          sample();
        }),
      abc
    );
    await page.click('#stop');
    assert.ok(
      samples.length >= 10 && new Set(samples.map(s => s.sounding)).size >= 6,
      `${abc}: ${samples.length} samples`
    );
    assert.deepEqual(
      samples.filter(s => s.lit !== s.sounding),
      [],
      `${abc.split('\n')[1]}: the lit note is the one sounding`
    );
  }
  // Feature: road-map playback. The highlight and the status line follow a D.C. al Fine back to the start, from the
  // Play button and from a note played with Space; the sound follows the same order (tests/editor-playback.cjs).
  {
    await reopen('X:1\nM:4/4\nL:1/4\nQ:1/4=300\nK:C\nC4|D4 !fine!|E4|F4 !D.C.alfine!|]');
    await page.evaluate(() => {
      for (const id of ['trainer', 'metronome', 'loop', 'count-in']) $(id).checked = false;
    });
    const follow = () =>
      page.evaluate(
        () =>
          new Promise(done => {
            const heads = [...document.querySelectorAll('#notation .abcjs-note')],
              lit = [],
              said = new Set();
            const sample = () => {
              const i = heads.findIndex(h => h.classList.contains('abcjs-playing'));
              if (i >= 0 && lit.at(-1) !== i) lit.push(i);
              said.add($('play-status').textContent);
              if (!playing) return done({lit, said: [...said]});
              setTimeout(sample, 25);
            };
            setTimeout(sample, 25);
          })
      );
    await page.click('#play');
    const fromStart = await follow();
    assert.deepEqual(fromStart.lit, [0, 1, 2, 3, 0, 1], 'The highlight goes back to measure 1 and stops at Fine');
    assert.ok(
      fromStart.said.includes('Measures 1–4 · 100% speed · D.C.: back to measure 1'),
      'The status line names the jump: ' + fromStart.said.join(' | ')
    );
    await page.locator('#notation .abcjs-notehead').nth(1).click({force: true});
    await page.keyboard.press('Space');
    const fromNote = await follow();
    assert.deepEqual(fromNote.lit, [1, 2, 3, 0, 1], 'Space plays from the selected note through the jump');
  }
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
  // The controls above the score push it low in a 900 px window; a mouse click needs it in view.
  await page.evaluate(() => $('notation').scrollIntoView({block: 'center', behavior: 'instant'}));
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
  // Keep bars full with real keys and clicks: on for the blank sheet; a half note made a quarter leaves a rest, a
  // longer note takes it back, a dot with no room says why, Delete leaves a rest and Shift+Delete removes; the switch
  // is reached by keyboard and fits a phone.
  {
    await page.evaluate(() => {
      dirty = false;
      newScore(2);
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
    });
    const bars = () => page.evaluate(() => $('abc').value.trim().split('\n').pop()),
      said = () => page.evaluate(() => $('selection-status').textContent),
      clickFirst = async kind => {
        const target = page.locator(`#notation .abcjs-${kind}`).first();
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
    assert.equal(await page.isChecked('#keep-bars'), true, 'On for a blank sheet');
    await clickFirst('rest');
    await page.keyboard.press('6');
    await page.keyboard.press('c');
    assert.equal(await bars(), 'c2 z2 | z4 |]');
    await clickFirst('note');
    await page.keyboard.press('5');
    assert.equal(await bars(), 'c z z2 | z4 |]', 'A shorter note leaves rests');
    assert.equal(await said(), 'Changed to a quarter note. Rests fill the gap.');
    await page.keyboard.press('7');
    assert.equal(await bars(), 'c4 | z4 |]', 'A longer note takes the rests after it');
    await page.click('#palette [data-palette="dot"]');
    assert.equal(await bars(), 'c4 | z4 |]');
    assert.match(await said(), /^No room in measure 1: there is no rest after this note\./);
    await page.keyboard.press('Delete');
    assert.equal(await bars(), 'z4 | z4 |]', 'Delete leaves a rest');
    await page.keyboard.press('Shift+Delete');
    assert.equal(await bars(), '| z4 |]', 'Shift+Delete removes it');
    await page.keyboard.press('Control+z');
    await page.focus('#keep-bars');
    await page.keyboard.press('Space');
    assert.equal(await page.isChecked('#keep-bars'), false, 'The switch works from the keyboard');
    await clickFirst('rest');
    await page.keyboard.press('Delete');
    assert.equal(await bars(), '| z4 |]', 'Off: Delete removes, as before');
    await page.setViewportSize({width: 390, height: 800});
    const fits = await page.evaluate(() => {
      const r = $('keep-bars').closest('label').getBoundingClientRect();
      return r.width > 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    });
    assert.ok(fits, 'The switch fits a phone without a sideways scroll');
    await page.setViewportSize({width: 1280, height: 900});
  }
  // New score panel by keyboard: a piano template opens with the score focused; a click on a left-hand rest and
  // letters fill only that staff, and ＋ 4 bars grows both staves.
  await page.evaluate(() => {
    dirty = false;
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  await page.focus('#new-score-open');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'new-title', 'The panel opens on Title');
  await page.keyboard.type('Two hands');
  await page.keyboard.press('Tab');
  await page.selectOption('#new-template', 'piano');
  await page.selectOption('#new-meter', '3/4');
  await page.focus('#new-bars');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page.evaluate(() => [
      $('new-score-panel').hidden,
      document.activeElement.id,
      $('title').value,
      $('notation').querySelectorAll('.abcjs-staff').length >= 2
    ]),
    [true, 'notation', 'Two hands', true],
    'Enter creates the score and focuses it'
  );
  await page.keyboard.press('g');
  assert.match(
    await page.evaluate(() => $('abc').value),
    /V:RH[^\n]*\nG z2 \| z3 \| z3 \| z3 \|]\nV:LH clef=bass\nz3 \| z3 \| z3 \| z3 \|]/,
    'Letters write over the first right-hand rest'
  );
  await page.evaluate(() => $('notation').scrollIntoView({block: 'center', behavior: 'instant'}));
  const rests = await page.$$eval('#notation .abcjs-rest', els =>
    els.map(e => {
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })
  );
  const leftHand = rests.filter(([, y]) => y > rests[0][1] + 30);
  await page.mouse.click(leftHand[1][0], leftHand[1][1]);
  await page.keyboard.press('c');
  await page.keyboard.press('e');
  assert.equal(
    await page.evaluate(() => $('abc').value.split('V:LH clef=bass\n')[1].trim()),
    'z3 | C, E, z | z3 | z3 |]',
    'Clicking a left-hand rest and typing fills only that staff, in the bass octave'
  );
  await page.click('#add-bars');
  assert.deepEqual(
    await page.evaluate(() =>
      Object.values(
        barLengths(ABCJS.parseOnly($('abc').value)[0]).reduce((n, m) => ({...n, [m.voice]: (n[m.voice] || 0) + 1}), {})
      )
    ),
    [8, 8],
    '＋ 4 bars adds four bars to both staves'
  );
  // Guitar tab goes under the right hand. It is not counted as a staff, and a click on the left hand's middle line
  // still reads the bass clef (D,).
  await page.selectOption('#instrument', 'Guitar');
  await page.waitForFunction(() => renderedTune?.engraver?.staffgroups[0].staffs.some(s => s.isTabStaff));
  assert.equal(await page.locator('#score-caption').textContent(), 'Guitar · 2 staves · Concert pitch.');
  const rightHand = await page.evaluate(() => $('abc').value.split('V:LH')[0]);
  await page.click('#draw-mode');
  {
    const [x, y] = await page.evaluate(() => {
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
      const svg = $('notation').querySelector('svg'),
        lh = staffList().at(-1),
        rest = [...$('notation').querySelectorAll('.abcjs-rest')]
          .map(e => e.getBBox())
          .filter(r => Math.abs(r.y + r.height / 2 - (lh.y - 6 * STAFF_STEP)) < 6 * STAFF_STEP)
          .at(-1),
        p = new DOMPoint(rest.x + rest.width / 2, lh.y - 6 * STAFF_STEP).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    });
    await page.mouse.click(x, y);
  }
  assert.match(
    await page.evaluate(() => $('abc').value.split('V:LH')[1]),
    /D, z2 \|\]\n$/,
    'Drawing on the left hand under guitar tab writes in the bass clef'
  );
  assert.equal(await page.evaluate(() => $('abc').value.split('V:LH')[0]), rightHand, 'The right hand is unchanged');
  await page.click('#draw-mode');
  await page.selectOption('#instrument', 'Piano');
  // At phone width the panel's fields fit without a sideways scroll; Escape closes it and returns focus.
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => (dirty = false));
  await page.click('#new-score-open');
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        [...$('new-score-form').querySelectorAll('input, select, button')].every(el => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        })
    ),
    'The New score panel fits a phone screen'
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => [$('new-score-panel').hidden, document.activeElement.id]), [
    true,
    'new-score-open'
  ]);
  await page.setViewportSize({width: 1280, height: 900});
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
  // Embed code and QR code: the share panel's tabs work by keyboard; the copied snippet, pasted into a local HTML file,
  // shows the score read-only with Play and the edition's credits, and writes nothing to storage; long links get a note.
  {
    await page.focus('#share-tab-link');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'share-tab-embed', 'Arrow keys move along tabs');
    assert.ok(await page.isVisible('#embed-code'), 'The Embed tab shows the code');
    await page.fill('#embed-height', '480');
    const snippet = await page.inputValue('#embed-code'),
      code = shareUrl.split('#s=')[1];
    assert.ok(
      snippet.includes(`#e=${code}" width="100%" height="480" title="Score: Für Elise (shared)`) &&
        snippet.endsWith('loading="lazy"></iframe>'),
      'The embed code carries the same score as the link: ' + snippet.slice(-90)
    );
    await page.focus('#share-tab-embed');
    await page.keyboard.press('End');
    assert.ok(await page.isVisible('#share-qr svg'), 'A typical tune gets a QR code');
    const fs = require('node:fs'),
      os = require('node:os'),
      path = require('node:path'),
      file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fretfree-embed-')), 'class.html');
    fs.writeFileSync(
      file,
      `<!doctype html><meta charset="utf-8"><title>Class page</title><h1>Our class</h1>${snippet}`
    );
    // The studio's own pending draft is written now, so the storage comparison below sees only the embed.
    await page.evaluate(() => flushDraft());
    for (const width of [1280, 390]) {
      const host = await browser.newPage({viewport: {width, height: 900}});
      host.on('pageerror', e => errors.push('embed: ' + e.message));
      await host.goto('file://' + file);
      const frame = await (await host.waitForSelector('iframe')).contentFrame();
      await frame.waitForFunction(
        () => typeof current !== 'undefined' && current?.kind === 'shared' && document.querySelector('#notation svg')
      );
      // Every stored value, not only the key names, so an overwrite of an existing key is caught too.
      const stored = await frame.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
      assert.deepEqual(
        await frame.evaluate(() => [
          document.body.classList.contains('embed'),
          $('embed-title').textContent,
          $('rights').textContent.includes('CC0'),
          location.hash.startsWith('#e='),
          $('embed-open').href.endsWith(location.hash.replace('#e=', '#s='))
        ]),
        [true, 'Für Elise (shared) · opening melody', true, true, true],
        'The embed shows the score with its credits and an Open in FretFree link'
      );
      for (const hidden of ['header', 'nav', '.editor-panel', '#palette', '.export-bar', '#loop', '#start-measure'])
        assert.equal(await frame.isVisible(hidden), false, `The embed hides ${hidden}`);
      for (const shown of ['#play', '#stop', '#speed', '#rights', '#embed-open'])
        assert.ok(await frame.isVisible(shown), `The embed shows ${shown}`);
      assert.ok(
        await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `No sideways scroll in the embed at ${width}px`
      );
      const abc = await frame.evaluate(() => $('abc').value);
      await frame.locator('#notation .abcjs-notehead').first().click({force: true});
      await frame.click('#play');
      await frame.waitForFunction(() => playing);
      await frame.click('#stop');
      assert.equal(await frame.evaluate(() => $('abc').value), abc, 'Clicking the embedded score changes nothing');
      assert.equal(
        await frame.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())),
        stored,
        'Playing an embedded score writes no storage'
      );
      await host.close();
    }
    // A dense code (the longest link that fits) is drawn square at 3px per module, scaled down only to fit the panel,
    // and its note suggests full screen.
    const dense = await page.evaluate(() => {
      const base = location.origin + location.pathname + '#s=';
      updateShareQR(base + 'x'.repeat(QR_MAX_BYTES - base.length));
      const svg = $('share-qr').querySelector('svg'),
        box = svg.getBoundingClientRect();
      return {
        side: +svg.getAttribute('viewBox').split(' ')[2],
        width: box.width,
        height: box.height,
        room: $('share-qr').getBoundingClientRect().width,
        note: $('qr-note').textContent
      };
    });
    assert.equal(dense.side, 185, 'The longest link makes a version 40 code');
    assert.ok(
      Math.abs(dense.width - Math.min(3 * dense.side, dense.room)) <= 2 && Math.abs(dense.height - dense.width) < 1,
      'A dense code is drawn at 3px per module: ' + JSON.stringify(dense)
    );
    assert.match(dense.note, /dense code/);
    // A link longer than a QR code holds gets an explanation instead (a comment of random letters does not compress).
    await page.evaluate(() => {
      const letters = Array.from(
        crypto.getRandomValues(new Uint8Array(3000)),
        b => 'abcdefghijklmnopqrstuvwxyz'[b % 26]
      );
      $('abc').value = $('abc').value.replace(/^K:.*$/m, line => `${line}\n% ${letters.join('')}`);
      changed();
    });
    await page.click('#share-link');
    await page.waitForFunction(() => $('qr-note').textContent.includes('too long'));
    assert.equal(await page.isVisible('#share-qr svg'), false, 'No QR code for a very long link');
    await page.evaluate(() => {
      dirty = false;
      $('share-panel').hidden = true;
    });
  }
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
  assert.match(
    await student.locator('#prompt-check').innerText(),
    /All goals met\. Play it back, then press Turn in to send it to your teacher\./,
    'The finished checklist points to Turn in'
  );
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
  // Turn in at phone width with a tap and the keyboard, twice under two names; the teacher pastes both links into
  // Submissions, steps through them, and sends feedback back in a return link that the student opens.
  await student.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await student.tap('#turn-in').catch(() => student.click('#turn-in'));
  assert.equal(await student.evaluate(() => document.activeElement.id), 'student-name', 'Turn in focuses the name');
  assert.match(await student.locator('#turn-in-summary').textContent(), /Step <b>up<\/b>\. 4 of 4 goals met\./);
  await student.keyboard.type('Ana <i>Ruiz</i>');
  await student.keyboard.press('Enter');
  await student.waitForFunction(() => $('toast').textContent.includes('Turn-in link copied'));
  const turnIns = [await student.evaluate(() => navigator.clipboard.readText())];
  assert.equal(turnIns[0], await student.inputValue('#turn-in-url'));
  assert.ok(
    await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The Turn in panel fits a phone'
  );
  await student.fill('#student-name', 'Ben');
  await student.focus('#student-name');
  await student.keyboard.press('Enter');
  await student.waitForFunction(first => $('turn-in-url').value !== first, turnIns[0]);
  turnIns.push(await student.inputValue('#turn-in-url'));
  await student.keyboard.press('Escape');
  assert.deepEqual(
    await student.evaluate(() => [$('turn-in-panel').hidden, document.activeElement.id]),
    [true, 'turn-in'],
    'Escape closes Turn in and returns focus'
  );
  await page.evaluate(() => {
    dirty = false;
    show('saved');
  });
  await page.click('#inbox-open');
  await page.fill('#inbox-paste', [...turnIns, 'not a link'].join('\n'));
  await page.click('#inbox-add');
  await page.waitForFunction(() => /Added/.test($('inbox-status').textContent));
  assert.equal(await page.textContent('#inbox-status'), 'Added 2 submissions. Not a turn-in link: line 3.');
  assert.equal(await page.locator('#inbox-list li').count(), 2);
  assert.equal(await page.locator('#inbox-list i').count(), 0, 'Names are escaped');
  await page.locator('#inbox-list [data-inbox-open]').first().click();
  assert.match(await page.textContent('#submission-text'), /^Turned in by Ana <i>Ruiz<\/i> · .+ · Step <b>up<\/b>$/);
  assert.equal(await page.textContent('#submission-pos'), '1 of 2');
  assert.equal(await page.locator('#prompt-check li.met').count(), 4, 'The checklist comes with the work');
  assert.equal(
    await page.textContent('#prompt-check .prompt-done'),
    'All goals met.',
    'The teacher gets no instructions meant for the student'
  );
  await page.focus('#submission-next');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => $('submission-pos').textContent === '2 of 2');
  assert.equal(await page.evaluate(() => current.submission.name), 'Ben');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'submission-prev', 'Focus stays on the bar');
  await page.click('#submission-prev');
  await page.waitForFunction(() => $('submission-pos').textContent === '1 of 2');
  await page.focus('#feedback-text');
  await page.keyboard.type('Nice climb. End on the home note.');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => $('toast').textContent.includes('Return link copied'));
  const returnUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(returnUrl, await page.inputValue('#feedback-url'));
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The submission bar fits a phone'
  );
  await page.click('#submission-all');
  assert.ok(
    await page.evaluate(
      () => !$('inbox-panel').hidden && document.documentElement.scrollWidth <= window.innerWidth + 1
    ),
    'Submissions fit a phone'
  );
  await page.setViewportSize({width: 1280, height: 900});
  // The app reads the link when it loads, so the student opens it as a fresh page.
  await student.evaluate(() => (dirty = false));
  await student.goto('about:blank');
  await student.goto(returnUrl);
  await student.waitForFunction(() => !$('feedback-note').hidden);
  assert.equal(await student.textContent('#feedback-note-text'), 'Nice climb. End on the home note.');
  assert.deepEqual(
    await student.evaluate(() => [$('submission-bar').hidden, $('turn-in').hidden, $('prompt-check').hidden]),
    [true, false, false],
    'The student gets the feedback with the assignment, ready to turn in again'
  );
  await page.evaluate(() => {
    storeInbox([]);
    show('studio');
    dirty = false;
  });
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
      // The controls above the score push its staff low in a 900 px window; a mouse click needs it in view.
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
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
  // Concert pitch view on a B-flat clarinet: the checkbox (reached by keyboard) shows the source's key and pitches,
  // and drawn and typed notes are the pitches shown. The ABC itself does not change.
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nM:4/4\nL:1/4\nK:F\nF G A B |]', instrument: 'Clarinet in B♭'});
    // openScore scrolls smoothly to the top; stop that, so the page holds still for the mouse below.
    window.scrollTo({top: 0, behavior: 'instant'});
  });
  assert.ok(await page.locator('#concert-pitch-option').isVisible(), 'Concert pitch is offered for a B-flat clarinet');
  // A note menu still open when the view changes from the keyboard (no mouse press closed it) closes too.
  await rightClick(page.locator('#notation .abcjs-notehead').nth(1));
  assert.ok(await page.locator('#note-menu').isVisible());
  await page.locator('#concert-pitch').focus();
  await page.keyboard.press('Space');
  assert.ok(await page.locator('#note-menu').isHidden(), 'Changing the view closes the note menu');
  assert.equal(await tbody(), 'K:F F G A B |]', 'Turning on Concert pitch leaves the ABC alone');
  assert.match(await page.locator('#score-caption').textContent(), /Concert pitch shown/);
  const signature = () =>
    page.evaluate(() =>
      [...$('notation').querySelectorAll('.abcjs-key-signature path')].map(p => p.dataset.name).join()
    );
  assert.equal(await signature(), 'accidentals.flat', 'The concert key, F major, is drawn');
  {
    const [x, y] = await page.evaluate(() => {
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
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
    assert.equal(await tbody(), 'K:F F G B A B |]', 'The middle line drawn in concert view is concert B-flat');
  }
  await page.click('#draw-mode');
  await page.locator('#notation .abcjs-note .abcjs-notehead').nth(0).click();
  await page.keyboard.press('c');
  assert.equal(await tbody(), 'K:F F C G B A B |]', 'A typed C is concert C, the nearest C to concert F');
  await page.locator('#concert-pitch-option').click();
  assert.equal(await page.locator('#concert-pitch').isChecked(), false, 'A click on the label turns it off');
  assert.equal(await signature(), 'accidentals.sharp', 'Off, the written key is G major');
  assert.match(await page.locator('#score-caption').textContent(), /Written pitch shown/);
  await page.click('#draw-mode');
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
    // An earlier step's toast can still cover the bottom of the screen, where the score's first notes sit.
    $('toast').style.display = 'none';
    $('metronome').checked = true;
    $('volume').value = '0.3';
    window.__routes = [];
    window.__heard = [];
    // The mixer's chains are made again, so their connections are recorded too.
    if (audio) mixChains.delete(audio);
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
      // Notes and clicks reach it through their mixer track's gate, level and panner.
      const bus = outputNode(),
        next = new Map(__routes),
        reaches = node => {
          for (let i = 0; node && i < 6; i++, node = next.get(node)) if (node === bus) return true;
          return false;
        },
        notes = __routes.filter(([from]) => from instanceof GainNode && from !== bus);
      return [notes.length > 4, notes.every(([from]) => reaches(from)), __heard.some(h => h.type === 'square')];
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
    // The point has to be on screen for the mouse to reach it, however tall the toolbar above the score is.
    await page.locator('#notation svg').scrollIntoViewIfNeeded();
    const [x, y] = await page.evaluate(() => {
      // The controls above the score push its staff to the bottom of a 900 px window; a mouse click needs it in view.
      $('notation').scrollIntoView({block: 'center', behavior: 'instant'});
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
  // Mixer in real Web Audio, by keyboard and pointer: each track has a gate, a level and a StereoPannerNode; Mute
  // closes the gate at once, Volume and Pan move live, all without restarting playback, and unmuting picks up where
  // playback was. At phone width the rows fit without a sideways scroll.
  {
    await page.evaluate(() => {
      dirty = false;
      openScore({
        abc:
          'X:1\nT:Mixer\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\nV:1\n"C"cdef|"F"fedc|"G"gfed|"C"c4|]\n' +
          'V:2 clef=bass\nC,E,G,C|F,A,CF|G,B,DG|C4|]\n',
        instrument: 'Flute'
      });
      $('count-in').checked = $('loop').checked = false;
      $('metronome').checked = true;
      window.scrollTo({top: 0, behavior: 'instant'});
    });
    await page.focus('#mixer-toggle');
    await page.keyboard.press('Enter');
    const focused = () =>
      page.evaluate(() => [
        document.activeElement.closest('.mixer-track')?.dataset.key,
        document.activeElement.className || document.activeElement.closest('label')?.className
      ]);
    assert.deepEqual(await focused(), ['V:1', 'mixer-mute'], 'Enter opens the mixer on the first Mute');
    assert.equal(
      await page.evaluate(() => [...document.querySelectorAll('.mixer-track')].map(r => r.ariaLabel).join('|')),
      'Voice 1|Voice 2|Chords|Metronome'
    );
    await page.click('#play');
    await page.waitForTimeout(200);
    const generation = await page.evaluate(() => playGeneration);
    await page.focus('.mixer-track[data-key="V:1"] .mixer-mute');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    assert.deepEqual(await focused(), ['V:2', 'mixer-mute'], 'Tab moves through Mute, Solo, Volume and Pan');
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const live = () =>
      page.evaluate(() => {
        const chain = key => mixChains.get(audio).get(key),
          round = v => Math.round(v * 100) / 100;
        return {
          playing,
          generation: playGeneration,
          gate: round(chain('V:2').gate.gain.value),
          level: round(chain('V:1').level.gain.value),
          pan: round(chain('V:1').pan.pan.value),
          panner: chain('V:1').pan instanceof StereoPannerNode && chain('V:1').level instanceof GainNode
        };
      });
    assert.deepEqual(
      await live(),
      {playing: true, generation, gate: 0, level: 1, pan: 0, panner: true},
      'Space on Mute silences Voice 2 at once, without a restart'
    );
    await page.locator('.mixer-track[data-key="V:1"] .mixer-level input').fill('0.5');
    await page.locator('.mixer-track[data-key="V:1"] .mixer-pan input').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    assert.deepEqual(
      await live(),
      {playing: true, generation, gate: 0, level: 0.5, pan: -0.3, panner: true},
      'Volume by pointer and Pan by arrow keys apply live'
    );
    assert.equal(await page.locator('.mixer-track[data-key="V:1"] .mixer-pan output').textContent(), 'Left 30%');
    await page.click('.mixer-track[data-key="V:2"] .mixer-mute');
    await page.waitForTimeout(150);
    const back = await live();
    assert.ok(back.playing && back.generation > generation && back.gate === 1, 'Unmuting carries on with Voice 2');
    await page.click('#stop');
    await page.setViewportSize({width: 390, height: 844});
    assert.deepEqual(
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.mixer-track')].map(r => r.getBoundingClientRect());
        return [
          document.documentElement.scrollWidth <= innerWidth,
          rows.every(r => r.left >= 0 && r.right <= innerWidth)
        ];
      }),
      [true, true],
      'At 390px the mixer fits without a sideways scroll'
    );
    await page.setViewportSize({width: 1280, height: 900});
    await page.click('#mixer-reset');
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await page.evaluate(() => [$('mixer-panel').hidden, document.activeElement.id, current.mixer]),
      [true, 'mixer-toggle', undefined],
      'Reset clears the mix; Escape closes the mixer and returns to its button'
    );
    await page.evaluate(() => ($('metronome').checked = false));
  }
  // Instrument sounds in real Web Audio: rendered offline, each instrument's note has its own waveform (a periodic wave
  // from its partials), a guitar or piano note fades while a flute or violin holds, and playback gives each note one
  // oscillator with vibrato as detune automation. The library filter lists the same instruments and sets the sound.
  {
    const offline = await page.evaluate(async () => {
      const live = audio,
        rms = (data, from, to) => {
          let sum = 0;
          for (let i = from; i < to; i++) sum += data[i] * data[i];
          return Math.sqrt(sum / (to - from));
        },
        out = {};
      try {
        for (const name of Object.keys(instruments)) {
          audio = new OfflineAudioContext(1, 44100 * 2, 44100);
          const made = [];
          scheduleNotes([{note: 60, start: 0, duration: 1.5, velocity: 100}], 0, name, made);
          const data = (await audio.startRendering()).getChannelData(0),
            early = rms(data, 4410, 6615),
            window = data.slice(4410, 6615);
          out[name] = {
            count: made.length,
            type: made[0].type,
            held: rms(data, 59535, 61740) / early,
            shape: Array.from(window, v => v / early)
          };
        }
      } finally {
        audio = live;
      }
      return out;
    });
    const names = Object.keys(offline);
    for (const name of names) {
      assert.deepEqual([offline[name].count, offline[name].type], [1, 'custom'], name + ' uses its periodic wave');
      if (['Guitar', 'Ukulele', 'Bass guitar', 'Piano', 'Glockenspiel'].includes(name))
        assert.ok(offline[name].held < 0.6, name + ' fades while held: ' + offline[name].held);
      else assert.ok(offline[name].held > 0.7, name + ' holds its note: ' + offline[name].held);
    }
    for (const [i, a] of names.entries())
      for (const b of names.slice(i + 1)) {
        const x = offline[a].shape,
          y = offline[b].shape,
          distance = Math.sqrt(x.reduce((sum, v, k) => sum + (v - y[k]) ** 2, 0) / x.length);
        assert.ok(distance > 0.1, `${a} and ${b} sound different (${distance.toFixed(3)})`);
      }
    await page.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nM:4/4\nL:1/4\nQ:1/4=60\nK:C\nC D E F |]', instrument: 'Violin'});
      $('count-in').checked = $('loop').checked = $('metronome').checked = false;
      window.__curves = 0;
      const curve = AudioParam.prototype.setValueCurveAtTime;
      AudioParam.prototype.setValueCurveAtTime = function (...args) {
        __curves++;
        return curve.apply(this, args);
      };
      __heard.length = 0;
    });
    await page.click('#play');
    await page.waitForTimeout(250);
    assert.deepEqual(
      await page.evaluate(() => [__heard.map(h => h.type).join(), __heard.map(h => h.hz).join(), __curves]),
      ['custom,custom,custom,custom', '261.63,293.66,329.63,349.23', 4],
      'Violin playback: one oscillator per note, its own wave and vibrato on each held note'
    );
    await page.click('#stop');
    await page.evaluate(() => {
      __heard.length = 0;
      show('library');
    });
    assert.deepEqual(
      await page.evaluate(() => [...$('instrument-filter').options].map(o => o.value)),
      ['all', ...names],
      'The library filter lists every instrument'
    );
    // Listen plays the first card in the filtered instrument: the piano when none is chosen, and with Double bass the
    // same notes two octaves down, in the double bass's own periodic wave.
    const listen = async filter => {
      await page.selectOption('#instrument-filter', filter);
      await page.evaluate(() => {
        __heard.length = 0;
        window.__waves = [];
        const set = OscillatorNode.prototype.setPeriodicWave;
        OscillatorNode.prototype.setPeriodicWave = function (wave) {
          __waves.push(wave);
          return set.call(this, wave);
        };
        window.__unspyWaves = () => (OscillatorNode.prototype.setPeriodicWave = set);
      });
      await page.locator('.card [data-listen]').first().click();
      await page.waitForFunction(() => __heard.length > 0);
      return page.evaluate(
        name => {
          stopPreview();
          __unspyWaves();
          const own = instrumentWave(audio, name, instruments[name]);
          return {hz: __heard.splice(0).map(h => h.hz), own: __waves.length > 0 && __waves.every(w => w === own)};
        },
        filter === 'all' ? 'Piano' : filter
      );
    };
    const piano = await listen('all'),
      bass = await listen('Double bass');
    assert.deepEqual([piano.own, bass.own], [true, true], 'Listen uses the instrument’s own periodic wave');
    assert.deepEqual(
      piano.hz.map((h, i) => Math.round(12 * Math.log2(h / bass.hz[i]))),
      piano.hz.map(() => 24),
      'Listen plays in the filtered instrument’s octave: ' + bass.hz.join()
    );
    assert.equal(bass.hz.length, piano.hz.length, 'Listen plays the same notes in either instrument');
    await page.selectOption('#instrument-filter', 'Horn in F');
    await page.locator('.card [data-open]').first().click();
    assert.equal(await page.inputValue('#instrument'), 'Horn in F', 'The opened score uses the filtered instrument');
    assert.match(
      await page.locator('#score-caption').textContent(),
      /^Horn in F · treble clef · Written pitch shown; it sounds a perfect 5th lower\./
    );
    await page.evaluate(() => {
      $('instrument-filter').value = 'all';
      $('instrument-filter').dispatchEvent(new Event('input'));
    });
  }
  // WAV export in real Web Audio, from the keyboard: Enter on WAV opens the panel on Make WAV file, and Enter makes the
  // file, Ode-to-Joy.wav, handed to download(): 16-bit stereo at 44.1 kHz, as long as playback at the chosen
  // speed and a second more, sounding from the first note, scaled to 1 dB under full, with the license in INFO. A
  // click on Include metronome adds the clicks. The summary follows the Speed slider and the Instrument menu while the
  // panel is open, and the progress checkpoints leave the file as it is. Escape closes the panel and hands focus back
  // to WAV. On a long quartet movement the bar fills, and closing the panel stops the render at once: nothing downloads,
  // and the browser is not left rendering it for minutes.
  {
    const readWav = bytes => {
      const chunks = {};
      for (let at = 12; at + 8 <= bytes.length;) {
        const size = bytes.readUInt32LE(at + 4);
        chunks[bytes.toString('latin1', at, at + 4)] = bytes.subarray(at + 8, at + 8 + size);
        at += 8 + size + (size & 1);
      }
      const fmt = chunks['fmt '],
        data = chunks.data,
        samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
      return {
        riff: bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 12),
        size: bytes.readUInt32LE(4) === bytes.length - 8,
        format: [fmt.readUInt16LE(0), fmt.readUInt16LE(2), fmt.readUInt32LE(4), fmt.readUInt16LE(14)],
        seconds: samples.length / 2 / 44100,
        samples,
        info: chunks.LIST.toString('utf8')
      };
    };
    // The file the page last handed to download(), read back as bytes.
    const lastFile = async () => {
      const {name, type, base64} = await page.evaluate(() => {
        const {data, name, type} = __downloads.at(-1);
        let text = '';
        for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return {name, type, base64: btoa(text)};
      });
      return {name, type, bytes: Buffer.from(base64, 'base64')};
    };
    await page.evaluate(() => {
      dirty = false;
      openScore(catalog.find(x => x.id === 'ode'));
      window.__downloads = [];
      download = (data, name, type) => __downloads.push({data, name, type});
      $('metronome').checked = false;
      $('chords').checked = true;
      $('speed').value = 200;
      $('speed').oninput();
    });
    const wavButton = page.locator('#export-wav');
    await wavButton.scrollIntoViewIfNeeded();
    await wavButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !$('wav-panel').hidden && document.activeElement.id === 'wav-make');
    assert.equal(await wavButton.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#wav-chords-option').isHidden(), true, 'Ode to Joy has no chords to include');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => __downloads.length === 1);
    const first = await lastFile();
    assert.deepEqual([first.name, first.type], ['Ode-to-Joy.wav', 'audio/wav']);
    const wav = readWav(first.bytes),
      expected = await page.evaluate(() => parseMidi(midiBytes($('abc').value)).duration / 2 + 1);
    assert.deepEqual([wav.riff, wav.size], ['RIFFWAVE', true], 'A valid RIFF file');
    assert.deepEqual(wav.format, [1, 2, 44100, 16], 'PCM, stereo, 44.1 kHz, 16-bit');
    assert.ok(Math.abs(wav.seconds - expected) < 0.001, `As long as playback at 200%: ${wav.seconds} s`);
    let peak = 0,
      early = 0;
    for (const v of wav.samples) peak = Math.max(peak, Math.abs(v));
    for (let i = 4410 * 2; i < 8820 * 2; i++) early = Math.max(early, Math.abs(wav.samples[i]));
    assert.ok(Math.abs(peak - 0.89 * 32768) < 40, 'Scaled to 1 dB under full scale: ' + peak);
    assert.ok(early > 3000, 'The first note sounds from the start: ' + early);
    assert.match(
      wav.info,
      /^INFOINAM[\s\S]*Ode to Joy[\s\S]*ICOP[\s\S]*CC0-1\.0[\s\S]*ICMT[\s\S]*Ludwig van Beethoven/
    );
    assert.match(
      await page.locator('#wav-status').textContent(),
      /^Downloaded Ode-to-Joy\.wav \(0:\d\d, \d+\.\d MB\)\.$/
    );
    await page.locator('#wav-metronome').click();
    await page.locator('#wav-make').click();
    await page.waitForFunction(() => __downloads.length === 2);
    const clicked = readWav((await lastFile()).bytes);
    assert.equal(clicked.samples.length, wav.samples.length, 'The metronome does not change the length');
    assert.ok(
      clicked.samples.some((v, i) => v !== wav.samples[i]),
      'Include metronome adds the clicks'
    );
    const instrument = await page.inputValue('#instrument');
    await page.locator('#speed').focus();
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.locator('#wav-summary').textContent(), / sound at 195% speed,/);
    await page.selectOption('#instrument', 'Cello');
    assert.match(
      await page.locator('#wav-summary').textContent(),
      /^The whole score in the Cello sound at 195% speed,/
    );
    await page.selectOption('#instrument', instrument);
    await page.evaluate(() => {
      dirty = false;
      $('speed').value = 200;
      $('speed').oninput();
    });
    assert.ok(
      await page.evaluate(async () => {
        const plain = await renderWav(),
          checked = await renderWav({progress: () => {}});
        return plain.bytes.length === checked.bytes.length && plain.bytes.every((v, i) => v === checked.bytes[i]);
      }),
      'The same file with and without progress checkpoints'
    );
    // The pauses while the file is scaled and written are messages, not timers: a hidden tab holds each timer back for
    // a second or more, which would add that much per pause to a long export. A hidden tab does not pause at all.
    const [quick, slowTimers, hidden] = await page.evaluate(async () => {
      const timed = async () => {
        const started = performance.now(),
          {bytes} = await renderWav({progress: () => {}});
        return [performance.now() - started, bytes];
      };
      const [quick, plain] = await timed(),
        timer = window.setTimeout;
      window.setTimeout = (f, ms, ...rest) => timer(f, Math.max(+ms || 0, 1000), ...rest);
      const [slow] = await timed().finally(() => (window.setTimeout = timer));
      Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
      const [, unseen] = await timed().finally(() => delete document.visibilityState);
      return [quick, slow, unseen.length === plain.length && unseen.every((v, i) => v === plain[i])];
    });
    assert.ok(slowTimers < quick + 900, `Slow timers do not hold the file up: ${Math.round(slowTimers)} ms`);
    assert.ok(hidden, 'A hidden tab makes the same file');
    await page.locator('#wav-make').focus();
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await page.evaluate(() => [$('wav-panel').hidden, document.activeElement.id]),
      [true, 'export-wav'],
      'Escape closes the panel and hands focus back'
    );
    await page.evaluate(() => {
      dirty = false;
      openScore(catalog.find(x => x.id === 'sq-7224846-4'));
      const start = OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering = function () {
        const render = (window.__render = {});
        return start.call(this).then(buffer => ((render.done = performance.now()), buffer));
      };
      window.__unspyRender = () => (OfflineAudioContext.prototype.startRendering = start);
    });
    await wavButton.click();
    await page.locator('#wav-make').click();
    await page.waitForFunction(() => $('wav-progress').value > 0, null, {timeout: 120000});
    assert.equal(await page.locator('#wav-progress').isVisible(), true, 'The bar shows how far the file has got');
    await page.locator('#wav-close').click();
    const closed = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => __render.done, null, {timeout: 300000});
    const left = await page.evaluate(closed => __render.done - closed, closed);
    assert.ok(left < 10000, `Closing the panel stops the render at once: ${Math.round(left)} ms`);
    assert.equal(await page.evaluate(() => __downloads.length), 2, 'and nothing downloads');
    await page.evaluate(() => {
      __unspyRender();
      dirty = false;
      openScore(catalog.find(x => x.id === 'ode'));
      $('speed').value = 100;
      $('speed').oninput();
    });
  }
  // On-screen piano: mouse taps enter notes over the selected rest and sound them; Shift+click and a held touch make
  // chords; arrows and Enter work from the keyboard; keys light for the selection and during playback.
  {
    const body = () => page.evaluate(() => $('abc').value.trim().split('\n').pop()),
      key = midi => page.locator(`[data-piano-midi="${midi}"]`);
    await page.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:Piano\nM:4/4\nL:1/4\nQ:1/4=120\nK:F\nz4 | z4 |]', instrument: 'Flute'});
      selectEntry(scoreNotes()[0]);
      $('count-in').checked = $('loop').checked = $('metronome').checked = false;
      __heard.length = 0;
    });
    await page.click('#piano-toggle');
    assert.equal(await page.evaluate(() => localStorage.getItem('fretfree-piano')), 'true');
    assert.ok(await key(71).isVisible(), 'The strip starts at the treble staff');
    await key(65).click();
    assert.deepEqual(await heard(), [349.23], 'A tap sounds its pitch');
    await key(70).click();
    await key(72).click();
    await key(76).click({modifiers: ['Shift']});
    assert.equal(await body(), 'F B [ce] z | z4 |]', 'Taps enter a melody in F; Shift+click adds to the chord');
    assert.deepEqual(await heard(), [466.16, 523.25, 523.25, 659.26], 'Each tap sounds; a chord sounds whole');
    // Two fingers: the second key goes down while the first is held.
    await page.evaluate(() => {
      const down = (midi, pointerId) =>
        document.querySelector(`[data-piano-midi="${midi}"]`).dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 7
          })
        );
      down(69, 7);
      down(72, 8);
      for (const pointerId of [7, 8])
        window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId, pointerType: 'touch'}));
    });
    assert.equal(await body(), 'F B [ce] [Ac] | z4 |]', 'Holding one key while tapping another makes a chord');
    await page.waitForTimeout(20);
    await key(67).click();
    assert.equal(await body(), 'F B [ce] [Ac] | G z3 |]', 'After the fingers lift, a tap enters a new note');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.pianoMidi),
      '67',
      'The tapped key keeps focus'
    );
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    assert.equal(
      await page.evaluate(() => $('abc').value.trim().split('\n').pop()),
      'F B [ce] [Ac] | G [AB] A z |]',
      'Arrows move between keys; Enter enters, Shift+Enter adds to the chord, Space enters once'
    );
    await page.keyboard.press('Shift+C');
    assert.equal(await body(), 'F B [ce] [Ac] | G [AB] [Ac] z |]', 'Score shortcuts work from the piano');
    // The piano stays at the bottom of the window, so bring the score to the top before clicking on it.
    await page.evaluate(() => $('notation').scrollIntoView({block: 'start', behavior: 'instant'}));
    await page.locator('#notation .abcjs-notehead').nth(2).click({force: true});
    assert.equal(await body(), 'F B [ce] [Ac] | G [AB] [Ac] z |]', 'Clicking the score does not enter a note');
    assert.deepEqual(
      await page.evaluate(() => [...document.querySelectorAll('#piano-keys .held')].map(k => k.dataset.pianoMidi)),
      ['72', '76'],
      'Clicking a chord lights its keys'
    );
    await page.click('#play');
    // Sample until every key of the first bar has been seen lit, or playback has had plenty of time.
    const lit = new Set(),
      until = Date.now() + 8000;
    while (!['65', '70', '72', '76'].every(k => lit.has(k)) && Date.now() < until) {
      await page.waitForTimeout(40);
      for (const k of await page.evaluate(() =>
        [...document.querySelectorAll('#piano-keys .sounding')].map(k => k.dataset.pianoMidi)
      ))
        lit.add(k);
    }
    await page.click('#stop');
    assert.ok(
      ['65', '70', '72', '76'].every(k => lit.has(k)),
      'Keys light during playback: ' + [...lit]
    );
    assert.equal(await page.locator('#piano-keys .sounding').count(), 0, 'Stopping clears the lights');
    await page.emulateMedia({media: 'print'});
    assert.equal(await page.locator('#piano').isVisible(), false, 'The piano is hidden in print');
    await page.emulateMedia({media: 'screen'});
    await page.setViewportSize({width: 390, height: 844});
    await key(64).scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(() => {
        const strip = $('piano-scroll');
        return strip.scrollWidth > strip.clientWidth && document.documentElement.scrollWidth <= innerWidth + 1;
      }),
      'At 390px the keys scroll inside their strip, not the page'
    );
    await page.setViewportSize({width: 1280, height: 900});
    await page.click('#piano-toggle');
    assert.equal(
      await page.evaluate(() => [$('piano').hidden, localStorage.getItem('fretfree-piano')]).then(String),
      'true,false'
    );
  }
  // On-screen piano on a phone, with the setting saved as on: the strip faces the instrument's range when a score opens
  // from the library. A key enters its note when the finger lifts, so swiping the strip or the page from a key enters
  // nothing; a tap still enters, and a second finger while one is down makes a chord.
  {
    const phone = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    phone.on('pageerror', e => errors.push(e.message));
    await phone.addInitScript(() => localStorage.setItem('fretfree-piano', 'true'));
    await phone.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    const cdp = await phone.context().newCDPSession(phone),
      touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints}),
      body = () => phone.evaluate(() => $('abc').value.trim().split('\n').pop()),
      shown = midi =>
        phone
          .waitForFunction(
            midi => {
              const strip = $('piano-scroll').getBoundingClientRect(),
                key = document.querySelector(`[data-piano-midi="${midi}"]`).getBoundingClientRect();
              return strip.width > 0 && key.left >= strip.left && key.right <= strip.right;
            },
            midi,
            {timeout: 3000}
          )
          .then(
            () => true,
            () => false
          ),
      center = midi =>
        phone.evaluate(midi => {
          const r = document.querySelector(`[data-piano-midi="${midi}"]`).getBoundingClientRect();
          return {x: r.left + r.width / 2, y: r.bottom - 15};
        }, midi),
      swipe = async (from, to) => {
        await touch('touchStart', [from]);
        for (let i = 1; i <= 10; i++) {
          await touch('touchMove', [{x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10}]);
          await phone.waitForTimeout(16);
        }
        await touch('touchEnd');
        await phone.waitForTimeout(300);
      };
    assert.equal(await phone.evaluate(() => $('studio').hidden && !$('piano').hidden), true, 'Starts on the library');
    await phone.evaluate(() => {
      const bars = Array(40).fill('z4').join(' | ');
      openScore({abc: 'X:1\nT:Touch\nM:4/4\nL:1/4\nK:C\n' + bars + ' |]', instrument: 'Flute'});
    });
    assert.ok(await shown(71), 'Opened from the library, the strip shows B4 for a flute');
    await phone.waitForTimeout(500);
    await phone.evaluate(() => {
      selectEntry(scoreNotes()[0]);
      // The score at the top of the window, so the page has room to scroll back up (the studio's folds put the score
      // within the first screen and a half on a phone).
      window.scrollTo({top: $('notation').getBoundingClientRect().top + scrollY, behavior: 'instant'});
      $('piano').scrollIntoView({block: 'end', behavior: 'instant'});
    });
    const before = await phone.evaluate(() => [$('abc').value, $('piano-scroll').scrollLeft, scrollY]),
      e4 = await center(64);
    await swipe(e4, {x: e4.x - 250, y: e4.y});
    const top = await phone.evaluate(() => $('piano-keys').getBoundingClientRect().top + 10);
    await swipe({x: 200, y: top}, {x: 200, y: Math.min(top + 200, 835)});
    const after = await phone.evaluate(() => [$('abc').value, $('piano-scroll').scrollLeft, scrollY]);
    assert.ok(after[1] > before[1], 'A sideways swipe scrolls the strip');
    assert.ok(after[2] < before[2], 'A swipe down from a key scrolls the page');
    assert.equal(after[0], before[0], 'Swiping from a key enters nothing');
    await phone.evaluate(() => scrollPianoTo(67, true));
    await phone.tap('[data-piano-midi="67"]');
    assert.equal(await body(), 'G z3 | ' + Array(39).fill('z4').join(' | ') + ' |]', 'A tap enters the note');
    await phone.evaluate(() => {
      scrollPianoTo(74, true);
      $('piano').scrollIntoView({block: 'end', behavior: 'instant'});
    });
    const c = await center(72),
      e = await center(76);
    await touch('touchStart', [{...c, id: 1}]);
    await touch('touchStart', [
      {...c, id: 1},
      {...e, id: 2}
    ]);
    await touch('touchEnd', [{...c, id: 1}]);
    await touch('touchEnd');
    await phone.waitForTimeout(300);
    assert.match(await body(), /^G \[ce\] z2 \|/, 'Two fingers make a chord');
    await phone.evaluate(() => {
      dirty = false;
      show('library');
    });
    await phone.waitForTimeout(100);
    await phone.evaluate(() => openScore({abc: 'X:1\nT:Low\nM:4/4\nL:1/4\nK:C\nz4 |]', instrument: 'Cello'}));
    assert.ok(await shown(50), 'A bass-clef score shows D3');
    await phone.close();
  }
  await page.evaluate(() => {
    dirty = false;
  });
  // MIDI keyboards, with a mocked Web MIDI input: the toggle works by keyboard, notes 100 ms apart enter one after
  // another, notes within 40 ms make a chord, held keys light the piano, Z respells; without Web MIDI there is no
  // toggle, and a refusal says so.
  {
    const tab = await browser.newPage({viewport: {width: 1280, height: 900}});
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.addInitScript(() => {
      const input = {name: 'Practice Keys', state: 'connected', onmidimessage: null};
      window.__midi = {input, asked: [], deny: false};
      navigator.requestMIDIAccess = async options => {
        __midi.asked.push(options);
        if (__midi.deny) throw new DOMException('Permission denied', 'NotAllowedError');
        return (__midi.access = {inputs: new Map([['in', input]]), onstatechange: null});
      };
      window.__note = (on, ...notes) =>
        notes.forEach(note => input.onmidimessage?.({data: [on ? 0x90 : 0x80, note, on ? 100 : 0]}));
    });
    await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    const body = () => tab.evaluate(() => $('abc').value.trim().split('\n').pop());
    await tab.evaluate(() => {
      openScore({abc: 'X:1\nT:MIDI\nM:4/4\nL:1/4\nK:C\nz4 | z4 |]', instrument: 'Flute'});
      show('studio');
      selectEntry(scoreNotes()[0]);
    });
    assert.equal(await tab.locator('#midi-toggle').isVisible(), true, 'The toggle shows with Web MIDI');
    await tab.focus('#midi-toggle');
    await tab.keyboard.press('Enter');
    await tab.waitForFunction(() => $('midi-toggle').getAttribute('aria-pressed') === 'true');
    assert.match(await tab.locator('#midi-status').textContent(), /^MIDI input from Practice Keys\./);
    assert.deepEqual(await tab.evaluate(() => __midi.asked), [{sysex: false}], 'No SysEx is requested');
    await tab.click('#piano-toggle');
    const entered = text => tab.waitForFunction(text => $('abc').value.includes(text), text);
    await tab.evaluate(() => ((window.__t = performance.now()), __note(true, 60)));
    assert.equal(await tab.locator('[data-piano-midi="60"].down').count(), 1, 'A held MIDI key lights the piano');
    // 64 comes 100 ms after 60 on the page's clock, after the 40 ms chord timer (due first, so it fires first).
    await tab.evaluate(
      () =>
        new Promise(done =>
          setTimeout(() => done((__note(false, 60), __note(true, 64))), __t + 100 - performance.now())
        )
    );
    await entered('C E z2');
    await tab.evaluate(() => __note(false, 64));
    assert.equal(await body(), 'C E z2 | z4 |]', 'Note-on 60 then 64, 100 ms apart, enter C then E');
    assert.equal(await tab.locator('#piano-keys .down').count(), 0, 'Released keys go dark');
    await tab.evaluate(() => {
      __note(true, 67);
      setTimeout(() => __note(true, 60), 5);
      setTimeout(() => __note(true, 64), 10);
    });
    await entered('[CEG]');
    assert.deepEqual(
      await tab.evaluate(() => [...document.querySelectorAll('#piano-keys .down')].map(k => +k.dataset.pianoMidi)),
      [60, 64, 67],
      "The held chord's keys are lit"
    );
    await tab.evaluate(() => __note(false, 60, 64, 67));
    assert.equal(await body(), 'C E [CEG] z | z4 |]', '60, 64 and 67 within 40 ms enter [CEG]');
    // Black keys come in as sharps in C major; Z respells the note just entered from the keyboard.
    await tab.evaluate(() => __note(true, 61));
    await entered('^C |');
    await tab.evaluate(() => __note(false, 61));
    assert.equal(await body(), 'C E [CEG] ^C | z4 |]');
    await tab.evaluate(() => selectEntry(scoreNotes()[3]));
    await tab.keyboard.press('z');
    assert.equal(await body(), 'C E [CEG] _D | z4 |]', 'Z turns ^C into _D');
    await tab.keyboard.press('z');
    assert.equal(await body(), 'C E [CEG] ^C | z4 |]', 'and back');
    await tab.click('#midi-toggle');
    await tab.waitForFunction(() => $('midi-toggle').getAttribute('aria-pressed') === 'false');
    assert.equal(await tab.evaluate(() => __midi.input.onmidimessage), null, 'Off stops listening');
    // At phone width the toggle and status fit.
    await tab.setViewportSize({width: 390, height: 844});
    await tab.click('#midi-toggle');
    await tab.waitForFunction(() => $('midi-toggle').getAttribute('aria-pressed') === 'true');
    assert.equal(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'No sideways scroll at 390 px'
    );
    await tab.close();
    // Without a hardware keyboard (a phone or tablet), the palette's Respell button does what Z does.
    const touch = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    touch.on('pageerror', e => errors.push(e.message));
    await touch.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    await touch.evaluate(() => {
      openScore({abc: 'X:1\nT:Respell\nM:4/4\nL:1/4\nK:C\n^C D E F |]', instrument: 'Flute'});
      show('studio');
      selectEntry(scoreNotes()[0]);
    });
    const touchBody = () => touch.evaluate(() => $('abc').value.trim().split('\n').pop());
    await touch.tap('[data-palette="respell"]');
    assert.equal(await touchBody(), '_D =D E F |]', 'Tapping Respell turns ^C into _D');
    assert.match(await touch.locator('#selection-status').textContent(), /^Respelled as D♭\./);
    await touch.tap('[data-palette="respell"]');
    assert.equal(await touchBody(), '^C D E F |]', 'and back, with the natural gone again');
    await touch.close();
    const denied = await browser.newPage({viewport: {width: 1280, height: 900}});
    denied.on('pageerror', e => errors.push(e.message));
    await denied.addInitScript(() => {
      navigator.requestMIDIAccess = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
    });
    await denied.goto((process.env.FRETFREE_URL || 'http://localhost:8000') + '#studio');
    await denied.click('#midi-toggle');
    await denied.waitForFunction(() => $('midi-status').textContent);
    assert.match(await denied.locator('#midi-status').textContent(), /^MIDI access was blocked\./);
    assert.equal(await denied.locator('#midi-toggle').getAttribute('aria-pressed'), 'false');
    await denied.close();
    const without = await browser.newPage({viewport: {width: 1280, height: 900}});
    without.on('pageerror', e => errors.push(e.message));
    await without.addInitScript(() => delete Navigator.prototype.requestMIDIAccess);
    await without.goto((process.env.FRETFREE_URL || 'http://localhost:8000') + '#studio');
    assert.equal(await without.locator('#midi-toggle').isHidden(), true, 'No toggle without Web MIDI');
    await without.close();
  }
  // Zoom and measures per line. Zoom only narrows the staff width, so at 70% and 200% a native click still selects the
  // note, a 40 px drag still moves it four staff steps, and the draw ghost and click land on the line under the
  // pointer. 200% about doubles the noteheads and still fits a phone; 4 per line engraves eight bars as two systems
  // of four; both settings survive a reload. Each zoom step is announced. Titles and credits stay inside the narrower
  // layout and the SVG export, and a re-flowed guitar score keeps its tab.
  {
    const tab = await browser.newPage({viewport: {width: 1280, height: 900}});
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    const eight =
      'X:1\nT:Zoom test\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c | c B A G | F E D C | C E G c | c G E C | D F A c | c4 |]';
    const open = (instrument = 'Flute') =>
      tab.evaluate(
        ([eight, instrument]) => {
          openScore({abc: eight, instrument});
          dirty = false;
          window.scrollTo({top: 0, behavior: 'instant'});
        },
        [eight, instrument]
      );
    const head = () => tab.locator('#notation .abcjs-notehead').first();
    const zoomTo = async (button, presses) => {
      await tab.focus(button);
      for (let i = 0; i < presses; i++) await tab.keyboard.press('Enter');
    };
    await open();
    const width100 = (await head().boundingBox()).width;
    for (const [zoom, button, presses] of [
      [70, '#zoom-out', 2],
      [200, '#zoom-in', 4]
    ]) {
      await tab.click('#zoom-reset');
      await zoomTo(button, presses);
      assert.equal(await tab.locator('#zoom-reset').textContent(), zoom + '%');
      assert.equal(await tab.evaluate(() => document.activeElement.id), button.slice(1), 'Zoom keeps keyboard focus');
      assert.equal(await tab.textContent('#selection-status'), `Zoom ${zoom}%.`, 'The new size is announced');
      await tab.keyboard.press('Enter');
      assert.deepEqual(
        [await tab.textContent('#zoom-reset'), await tab.textContent('#selection-status')],
        [zoom + '%', `Zoom ${zoom}%. This is the ${zoom === 200 ? 'largest' : 'smallest'} size.`],
        'Pressing past the last size says so'
      );
      await open();
      const ratio = (await head().boundingBox()).width / width100;
      if (zoom === 200) assert.ok(ratio > 1.7 && ratio < 2.3, 'Noteheads about twice as large at 200%: ' + ratio);
      else assert.ok(ratio > 0.6 && ratio < 0.8, 'Noteheads smaller at 70%: ' + ratio);
      await head().scrollIntoViewIfNeeded();
      let box = await head().boundingBox();
      await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(
        await tab.evaluate(() => $('abc').value.slice($('abc').selectionStart, $('abc').selectionEnd).trim()),
        'C',
        'A click selects the note at ' + zoom + '%'
      );
      box = await head().boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await tab.mouse.move(x, y);
      await tab.mouse.down();
      for (let i = 1; i <= 20; i++) await tab.mouse.move(x + (i % 2 ? 3 : -3), y + (40 * i) / 20);
      await tab.mouse.up();
      assert.match(
        await tab.evaluate(() => $('abc').value),
        /\nF, D E F \|/,
        '40 px down lowers four staff steps at ' + zoom + '%'
      );
      await open();
      await tab.click('#draw-mode');
      const [gx, gy, lineY] = await tab.evaluate(() => {
        // The controls above the score push its staff low in a 900 px window; a mouse move needs it in view.
        renderedTune.engraver.selectables[1].svgEl.scrollIntoView({block: 'center', behavior: 'instant'});
        const svg = $('notation').querySelector('svg'),
          st = renderedTune.engraver.staffgroups[0].staffs[0],
          [a, b] = renderedTune.engraver.selectables.slice(1, 3).map(s => {
            const r = s.svgEl.getBBox();
            return r.x + r.width / 2;
          });
        const p = new DOMPoint((a + b) / 2, st.absoluteY - (6 * 93) / 24).matrixTransform(svg.getScreenCTM());
        return [p.x, p.y, st.absoluteY - (6 * 93) / 24];
      });
      await tab.mouse.move(gx, gy);
      assert.ok(
        Math.abs(
          (await tab.evaluate(() => +document.querySelector('#notation .draw-ghost').getAttribute('cy'))) - lineY
        ) < 0.01,
        'The draw ghost sits on the middle line at ' + zoom + '%'
      );
      await tab.mouse.click(gx, gy);
      assert.match(
        await tab.evaluate(() => $('abc').value),
        /\nC D B E F \|/,
        'Draw adds B at the clicked line at ' + zoom + '%'
      );
      await tab.click('#draw-mode');
    }
    // Still at 200%: a library hymn whose long title and composer credit fit at 100% keeps them inside the score, and
    // its SVG export is as wide as the score, with the credit wrapped inside it.
    const hymn = await tab.evaluate(() => {
      dirty = false;
      openScore(catalog.find(x => x.id === 'openhymnal-o-for-a-thousand-tongues-azmon'));
      const svg = $('notation').querySelector('svg'),
        width = svg.viewBox.baseVal.width,
        inside = (els, right) =>
          els.length > 0 && els.every(el => el.getBBox().x >= 0 && el.getBBox().x + el.getBBox().width <= right),
        holder = document.createElement('div');
      holder.innerHTML = creditedSVG($('notation'), $('abc').value, current);
      document.body.appendChild(holder);
      const exported = holder.querySelector('svg'),
        lines = [...exported.children].filter(el => el.tagName === 'text'),
        result = {
          header: inside([...svg.querySelectorAll('.abcjs-title, .abcjs-composer')], width),
          exportWidth: Math.round(exported.viewBox.baseVal.width - width),
          credit: inside(lines, exported.viewBox.baseVal.width),
          licence: lines
            .map(el => el.textContent)
            .join('')
            .includes(scoreLicense(current))
        };
      holder.remove();
      return result;
    });
    assert.deepEqual(
      hymn,
      {header: true, exportWidth: 0, credit: true, licence: true},
      'At 200% the title and composer fit, and the SVG export is as wide as the score with its credit inside'
    );
    // Guitar re-flowed at 200% (Auto) and at 4 per line keeps a tab staff on every line and a number under every note.
    const guitarTab = async label => {
      await open('Guitar');
      assert.deepEqual(
        await tab.evaluate(() => {
          const groups = renderedTune.engraver.staffgroups;
          return [
            groups.length > 1,
            groups.every(g => g.staffs.some(s => s.isTabStaff)),
            $('notation').querySelectorAll('.abcjs-tab-number').length,
            $('warnings').textContent
          ];
        }),
        [true, true, 29, ''],
        'Guitar tab survives re-flow at ' + label
      );
    };
    await guitarTab('200%');
    await open();
    const systems = () =>
      tab.evaluate(() =>
        renderedTune.lines.filter(l => l.staff).map(l => l.staff[0].voices[0].filter(e => e.el_type === 'bar').length)
      );
    await tab.click('#zoom-reset');
    assert.equal((await systems()).length, 1, 'Auto at 100% keeps the one source line');
    await tab.selectOption('#measures-per-line', '4');
    assert.deepEqual(await systems(), [4, 4], '4 per line engraves eight bars as two systems of four');
    await guitarTab('4 per line');
    await zoomTo('#zoom-in', 4);
    await tab.reload();
    await tab.evaluate(() => show('studio'));
    assert.deepEqual(
      await tab.evaluate(() => [
        $('zoom-reset').textContent,
        $('measures-per-line').value,
        engraveOptions().staffwidth
      ]),
      ['200%', '4', 370],
      'Zoom and measures per line survive a reload'
    );
    await tab.setViewportSize({width: 390, height: 844});
    await open();
    assert.ok(
      await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No sideways scroll at 200% on a phone'
    );
    await tab.close();
  }
  // Version history: three saves edited with the keyboard leave two earlier versions. History opens from the keyboard,
  // Preview draws a version and Play sounds and lights it; Restore opens it unsaved, and saving it keeps the copy it
  // replaced. On a phone the panel fits the screen.
  {
    const tab = await browser.newPage({viewport: {width: 1280, height: 900}});
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    await tab.locator('#cards [data-open="ode"]').click();
    const copies = [];
    for (const n of [0, 1, 2]) {
      await tab.locator('#notation .abcjs-notehead').nth(n).click({force: true});
      await tab.keyboard.press('ArrowUp');
      await tab.click('#save');
      copies.push(await tab.evaluate(() => $('abc').value));
    }
    assert.deepEqual(
      await tab.evaluate(() => storedVersions()[savedId].map(v => v.abc)),
      copies.slice(0, 2),
      'Three saved copies leave two earlier versions'
    );
    await tab.click('.nav[data-view="saved"]');
    const history = tab.locator('#saved-cards [data-history]');
    assert.equal(await history.textContent(), 'History (2)');
    await history.focus();
    await tab.keyboard.press('Enter');
    await tab.waitForSelector('#history-panel:not([hidden])');
    assert.equal(await tab.evaluate(() => document.activeElement.id), 'history-heading', 'Focus moves to the panel');
    const rows = await tab.locator('#history-list li').allTextContents();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^Version 2 · saved \d{1,2}:\d\d/, 'Newest first, with the time it was saved');
    await tab.locator('#history-list [data-version-preview]').last().click();
    await tab.waitForSelector('#history-score svg');
    await tab.locator('#history-play').focus();
    await tab.keyboard.press('Enter');
    await tab.waitForFunction(() => document.querySelectorAll('#history-score .abcjs-playing').length > 0);
    assert.deepEqual(
      await tab.evaluate(() => [
        previewId,
        previewNodes.length === parseMidi(midiBytes(storedVersions()[savedId][0].abc)).notes.length,
        $('history-play').textContent
      ]),
      ['history', true, '■ Stop'],
      'Play sounds every note of the version and lights it up'
    );
    // Leaving My scores silences the version, as leaving the library silences a card's Listen.
    await tab.click('.nav[data-view="library"]');
    assert.deepEqual(
      await tab.evaluate(() => [previewId, previewNodes.length, previewTimers.length, $('history-play').textContent]),
      [null, 0, 0, '▶ Play'],
      'Leaving My scores stops the version'
    );
    await tab.click('.nav[data-view="saved"]');
    await tab.locator('#history-play').focus();
    await tab.keyboard.press('Enter');
    await tab.waitForFunction(() => previewId === 'history' && previewNodes.length > 0);
    await tab.keyboard.press('Enter');
    assert.deepEqual(
      await tab.evaluate(() => [previewId, previewNodes.length, $('history-play').textContent]),
      [null, 0, '▶ Play'],
      'Play again stops'
    );
    await tab.click('#history-restore');
    assert.deepEqual(
      await tab.evaluate(() => [$('studio').hidden, $('abc').value, dirty, saved[0].abc]),
      [false, copies[0], true, copies[2]],
      'Restore opens version 1 as unsaved work and changes nothing saved'
    );
    await tab.locator('#save').focus();
    await tab.keyboard.press('Enter');
    assert.deepEqual(
      await tab.evaluate(() => storedVersions()[savedId].map(v => v.abc)),
      copies,
      'Saving the restored version keeps the copy it replaced'
    );
    await tab.setViewportSize({width: 390, height: 844});
    await tab.click('.nav[data-view="saved"]');
    await tab.locator('#saved-cards [data-history]').click();
    await tab.locator('#history-list [data-version-preview]').first().click();
    await tab.waitForSelector('#history-score svg');
    const restore = await tab.locator('#history-list [data-version-restore]').first().boundingBox();
    assert.ok(restore.x >= 0 && restore.x + restore.width <= 390, 'Restore fits a phone screen');
    assert.ok(
      await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'The history panel fits a phone screen'
    );
    await tab.keyboard.press('Escape');
    assert.equal(await tab.evaluate(() => $('history-panel').hidden), true, 'Escape closes the history');
    await tab.close();
  }
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
  // Dark theme: the page follows a dark device or the header choice, and the score stays black on white unless Dark
  // paper is ticked. Prints and SVG exports come out the same in every theme.
  {
    const tab = await browser.newPage({viewport: {width: 1280, height: 900}, colorScheme: 'dark'});
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    const rgb = s => s.match(/\d+/g).slice(0, 3).map(Number),
      lum = c => {
        const [r, g, b] = rgb(c).map(v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      },
      contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const colors = () =>
      tab.evaluate(() => {
        const css = el => getComputedStyle(el),
          head = document.querySelector('#notation .abcjs-note_selected'),
          hole = document.querySelector('#notation .recorder-fingering circle[fill="white"]');
        return {
          body: css(document.body).backgroundColor,
          text: css(document.body).color,
          muted: css(document.querySelector('.keyboard-help')).color,
          panel: css(document.querySelector('.editor-panel')).backgroundColor,
          paper: css(document.querySelector('.notation-paper')).backgroundColor,
          ink: css($('notation')).color,
          hero: css(document.querySelector('.hero-score')).backgroundColor,
          selected: head && css(head).fill,
          hole: hole && css(hole).fill
        };
      });
    const exportSVG = () =>
      tab.evaluate(() => {
        window.__downloads = [];
        download = data => __downloads.push(data);
        $('export-svg').click();
        return __downloads[0];
      });
    await tab.evaluate(() => {
      openScore({...catalog.find(x => x.id === 'ode'), instrument: 'Recorder'});
      $('note-names').value = 'letters';
      $('note-names').onchange();
      window.scrollTo({top: 0, behavior: 'instant'});
    });
    const head = tab.locator('#notation .abcjs-notehead').nth(1);
    await head.scrollIntoViewIfNeeded();
    const box = await head.boundingBox();
    await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    let c = await colors();
    assert.equal(await tab.evaluate(() => $('theme').value), 'auto');
    assert.equal(c.body, 'rgb(18, 24, 22)', 'A dark device gives a dark page');
    assert.ok(contrast(c.text, c.body) >= 4.5 && contrast(c.muted, c.body) >= 4.5, 'Body text contrast in the dark');
    assert.ok(contrast(c.text, c.panel) >= 4.5 && contrast(c.muted, c.panel) >= 4.5, 'Panel text contrast');
    assert.deepEqual(
      [c.paper, c.ink, c.hero, c.selected, c.hole],
      ['rgb(255, 255, 255)', 'rgb(17, 17, 17)', 'rgb(255, 254, 249)', 'rgb(49, 119, 97)', 'rgb(255, 255, 255)'],
      'The notation stays black on white in the dark theme'
    );
    const lightSVG = await exportSVG();
    assert.ok(lightSVG.includes('<svg') && lightSVG.includes('color:black;background:white'));
    // From the keyboard: Dark in the header, then Dark paper beside the zoom.
    assert.equal(await tab.locator('#dark-paper-option').isVisible(), true, 'Dark paper is offered on a dark device');
    await tab.focus('#theme');
    await tab.keyboard.press('ArrowDown');
    await tab.keyboard.press('ArrowDown');
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await tab.focus('#dark-paper');
    await tab.keyboard.press('Space');
    c = await colors();
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.paper), 'dark');
    assert.ok(contrast(c.ink, c.paper) >= 7, 'Dark paper: light ink on dark paper');
    assert.equal(c.hole, c.paper, 'Open recorder holes take the paper color');
    assert.equal(c.selected, 'rgb(116, 212, 166)', 'The selected note is drawn in the dark-paper highlight');
    assert.ok(contrast(c.selected, c.paper) >= 4.5, 'and stands out from the paper');
    assert.ok(contrast(c.hero, c.body) < 1.5, 'The library sheet goes dark too');
    assert.equal(await exportSVG(), lightSVG, 'SVG export is the same on dark paper');
    await tab.emulateMedia({media: 'print'});
    assert.deepEqual(
      await tab.evaluate(() => [
        getComputedStyle(document.body).backgroundColor,
        getComputedStyle(document.querySelector('.notation-paper')).backgroundColor,
        getComputedStyle($('notation')).color
      ]),
      ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(17, 17, 17)'],
      'Print stays black on white'
    );
    await tab.emulateMedia({media: 'screen'});
    // Remembered after a reload; Light (by pointer) overrides the dark device and hides Dark paper.
    await tab.reload();
    assert.deepEqual(
      await tab.evaluate(() => [$('theme').value, document.documentElement.dataset.paper, $('dark-paper').checked]),
      ['dark', 'dark', true],
      'The theme and Dark paper persist'
    );
    await tab.setViewportSize({width: 390, height: 844});
    const select = await tab.locator('#theme').boundingBox();
    assert.ok(select.x >= 0 && select.x + select.width <= 390, 'The theme choice fits a phone');
    await tab.selectOption('#theme', 'light');
    c = await colors();
    assert.equal(c.body, 'rgb(245, 244, 237)', 'Light overrides a dark device');
    assert.equal(c.paper, 'rgb(255, 255, 255)', 'Dark paper only applies in the dark theme');
    assert.equal(await tab.locator('#dark-paper-option').isVisible(), false);
    assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No sideways scroll');
    await tab.close();
  }
  // The stored theme is on <html> before the first paint. Here the catalogs are held back, so the deferred scripts
  // have not run, and a light device still shows the stored Dark. Tablet widths keep the nav labels on one line next to
  // the theme choice, and Dark paper is easy to tap on a phone.
  {
    const context = await browser.newContext({viewport: {width: 768, height: 900}, colorScheme: 'light'});
    await context.addInitScript(() => {
      localStorage.setItem('fretfree-theme', '"dark"');
      localStorage.setItem('fretfree-dark-paper', 'true');
    });
    let release;
    const held = new Promise(resolve => (release = resolve));
    await context.route(/catalog-licensed\.js/, async route => {
      await held;
      await route.continue();
    });
    const tab = await context.newPage();
    tab.on('pageerror', e => errors.push(e.message));
    const loaded = tab.goto(process.env.FRETFREE_URL || 'http://localhost:8000');
    await tab.waitForFunction(
      () =>
        document.readyState === 'interactive' && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'
    );
    assert.deepEqual(
      await tab.evaluate(() => [
        typeof applyTheme,
        document.documentElement.dataset.theme,
        document.documentElement.dataset.paper,
        getComputedStyle(document.body).backgroundColor
      ]),
      ['undefined', 'dark', 'dark', 'rgb(18, 24, 22)'],
      'The stored theme paints before the deferred scripts run'
    );
    release();
    await loaded;
    assert.deepEqual(await tab.evaluate(() => [$('theme').value, $('dark-paper').checked]), ['dark', true]);
    for (const width of [721, 744, 768, 820, 821, 1024]) {
      await tab.setViewportSize({width, height: 900});
      const header = await tab.evaluate(() => ({
        nav: [...document.querySelectorAll('.nav')].map(b => b.getBoundingClientRect().height),
        theme: $('theme').getBoundingClientRect().right,
        scroll: document.documentElement.scrollWidth
      }));
      assert.ok(
        header.nav.every(h => h < 45),
        `Nav labels stay on one line at ${width}px`
      );
      assert.ok(header.theme <= width && header.scroll <= width + 1, `The header fits at ${width}px`);
    }
    await tab.setViewportSize({width: 390, height: 844});
    await tab.evaluate(() => document.querySelector('.nav[data-view="studio"]').click());
    assert.ok((await tab.locator('#dark-paper-option').boundingBox()).height >= 32, 'Dark paper is easy to tap');
    await context.close();
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => {
    dirty = false;
    openScore({abc: 'X:1\nT:K\nM:4/4\nL:1/8\nK:C\nG2 A2 B2 c2 |]', instrument: 'Flute'});
    $('toast').style.display = 'none';
  });
  {
    await page.locator('[data-palette="more"]').click();
    await page.locator('[data-palette="tuplets"]').click();
    await page.locator('[data-palette="measure"]').click();
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('#palette [data-palette], #shortcuts-open')].map(b => {
        const r = b.getBoundingClientRect();
        return [r.left, r.right, r.width, r.height];
      })
    );
    assert.ok(
      boxes.every(([l, r, wd, h]) => l >= 0 && r <= 390 && wd >= 40 && h >= 40),
      'Palette buttons and All shortcuts fit a phone and are at least 40px'
    );
    const sheet = await sheetEdges();
    assert.ok(
      sheet.bottoms.every(b => b <= sheet.height),
      `The shortcut sheet fits a phone: ${JSON.stringify(sheet)}`
    );
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll('#palette-measure select')].every(s => s.getBoundingClientRect().right <= 390)
      ),
      'The Measure menus fit a phone'
    );
    await page.locator('[data-palette="measure"]').click();
    const note = page.locator('#notation .abcjs-notehead').nth(1);
    await note.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await note.click({force: true});
    assert.equal(
      await page.evaluate(() => $('abc').value.slice(...selectedRange)),
      'A2 ',
      'A tap selects at phone width'
    );
    await page.locator('[data-palette="len:0.125"]').click();
    assert.equal(await kbody(), 'G2 A B2 c2 |]', 'The palette works at phone width');
    // The chord box fits a phone; Next moves on without a Tab key.
    await page.locator('[data-palette="chord"]').click();
    await page.keyboard.type('Am');
    await page.locator('#chord-next').click();
    await page.keyboard.type('D7');
    const entry = await page.locator('#chord-entry').boundingBox();
    assert.ok(entry.x >= 0 && entry.x + entry.width <= 390, 'The chord box fits a phone');
    await page.locator('#chord-next').click();
    assert.equal(await kbody(), 'G2 "Am"A "D7"B2 c2 |]', 'Next saves and moves on');
    await page.keyboard.press('Escape');
    const chordsBox = await page.locator('#chords').boundingBox();
    assert.ok(chordsBox && chordsBox.x + chordsBox.width <= 390, 'The Chords switch fits a phone');
    // The lyrics box fits a phone too, under the staff; Next moves on without a Tab key.
    await note.click({force: true});
    await page.locator('[data-palette="lyric"]').click();
    await page.keyboard.type('la');
    await page.locator('#lyric-next').click();
    const words = await page.locator('#lyric-entry').boundingBox();
    assert.ok(words.x >= 0 && words.x + words.width <= 390, 'The lyrics box fits a phone');
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(() => $('abc').value), /\nw: \* la\n?$/, 'Next saves and moves on');
  }
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Mobile page fits viewport'
  );
  // WAV export at phone width: the button and its panel fit the screen, and a tap opens and closes the panel.
  {
    await page.evaluate(() => {
      dirty = false;
      openScore(catalog.find(x => x.id === 'ode'));
    });
    const wavButton = page.locator('#export-wav');
    await wavButton.scrollIntoViewIfNeeded();
    const button = await wavButton.boundingBox();
    assert.ok(button && button.x >= 0 && button.x + button.width <= 390, 'WAV button fits a phone screen');
    await wavButton.click();
    await page.waitForFunction(() => !$('wav-panel').hidden);
    const panel = await page.locator('#wav-panel').boundingBox(),
      make = await page.locator('#wav-make').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, 'The WAV panel fits a phone');
    assert.ok(make.height >= 30 && make.x + make.width <= 390, 'Make WAV file is easy to tap');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No sideways scroll with the WAV panel open'
    );
    await page.locator('#wav-close').click();
    assert.equal(await page.locator('#wav-panel').isHidden(), true);
  }
  // MusicXML export at phone width, from the keyboard: the button is on screen and Enter downloads the file.
  await page.evaluate(() => {
    dirty = false;
    openScore(catalog.find(x => x.id === 'ode'));
    window.__downloads = [];
    download = (data, name, type) => __downloads.push({data, name, type});
  });
  const exportButton = page.locator('#export-musicxml');
  await exportButton.scrollIntoViewIfNeeded();
  const box = await exportButton.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'MusicXML button fits a phone screen');
  await exportButton.focus();
  await page.keyboard.press('Enter');
  const mxl = await page.evaluate(() => __downloads[0]);
  assert.match(mxl.name, /^Ode-to-Joy\.musicxml$/);
  assert.match(mxl.data, /<work-title>Ode to Joy<\/work-title>[\s\S]*<rights>[^<]*CC0-1\.0/);
  // MusicXML import at phone width, from the keyboard: Enter on the open button picks a MuseScore .mxl, which the
  // browser's own DecompressionStream unpacks; the parts are engraved and the page still fits the screen.
  await page.evaluate(() => (dirty = false));
  const importButton = page.locator('#import');
  await importButton.scrollIntoViewIfNeeded();
  const importBox = await importButton.boundingBox();
  assert.ok(importBox && importBox.x >= 0 && importBox.x + importBox.width <= 390, 'Open button fits a phone screen');
  // Other tabs were opened above, and headless Chromium shows a file chooser only from the tab in front. The tab can
  // take a moment to come to the front under load, so Enter is pressed again if no chooser opened.
  let chooser = null;
  for (let attempt = 0; !chooser && attempt < 3; attempt++) {
    await page.bringToFront();
    await importButton.focus();
    [chooser] = await Promise.all([
      page.waitForEvent('filechooser', {timeout: 10000}).catch(() => null),
      page.keyboard.press('Enter')
    ]);
  }
  assert.ok(chooser, 'Enter on the open button opens the file chooser');
  await chooser.setFiles(require('node:path').join(__dirname, 'fixtures/morning-walk.mxl'));
  await page.waitForFunction(() => /^Imported from MusicXML/.test($('save-status').textContent));
  assert.equal(
    await page.locator('#save-status').textContent(),
    'Imported from MusicXML (3 parts, 5 measures). Save or export to keep a copy.'
  );
  assert.equal(await page.inputValue('#title'), 'Morning Walk');
  assert.match(await page.inputValue('#abc'), /^%%score 1 2 \{\(3 4\) \| 5\}$/m);
  assert.equal(await page.locator('#notation .abcjs-staff').count(), 8, 'Two systems of four staves');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'An imported score fits a phone screen'
  );
  // Offline use and installing, against a server of the test's own that is stopped to go offline: after one visit the
  // library, an opened score and its PDF, the editor and playback all work, and the PDF never opened does not. A deploy
  // whose catalogs never arrive leaves the last complete copy working offline. Bringing the server back with a new
  // deploy shows it after one reload and drops the old assets, and a corrected PDF replaces the kept one. No request
  // leaves the site, and Chrome's installability check passes (it needs a profile, so this uses a persistent context).
  {
    const http = require('node:http'),
      fs = require('node:fs'),
      os = require('node:os'),
      path = require('node:path');
    const root = path.join(__dirname, '..'),
      TYPES = {
        html: 'text/html',
        js: 'text/javascript',
        css: 'text/css',
        json: 'application/json',
        svg: 'image/svg+xml'
      };
    Object.assign(TYPES, {webmanifest: 'application/manifest+json', png: 'image/png', pdf: 'application/pdf'});
    // deploy rewrites index.html, the connection drops on requests matching refuse, and replaced swaps a file's bytes.
    let deploy = null,
      refuse = null,
      replaced = {};
    const server = http.createServer((req, res) => {
      if (refuse?.test(req.url)) {
        req.socket.destroy();
        return;
      }
      const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html');
      const file = path.join(root, path.normalize(name));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      let body = fs.readFileSync(file);
      if (name === '/index.html' && deploy) body = deploy(body.toString());
      if (replaced[name]) body = replaced[name];
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file).slice(1)] || 'application/octet-stream'});
      res.end(body);
    });
    const listen = port => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const halt = () => new Promise(resolve => (server.close(resolve), server.closeAllConnections()));
    await listen(0);
    const port = server.address().port,
      origin = `http://127.0.0.1:${port}/`,
      profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fretfree-pwa-'));
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: {width: 1280, height: 900},
      ...(process.env.CHROMIUM_PATH
        ? {executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage']}
        : {})
    });
    const requests = [];
    context.on('request', r => requests.push(r.url()));
    const tab = context.pages()[0] || (await context.newPage());
    tab.on('pageerror', e => errors.push(e.message));
    tab.on('dialog', dialog => dialog.accept());
    await tab.goto(origin);
    await tab.waitForFunction(() => /has an offline copy/.test($('offline-ready').textContent), null, {timeout: 60000});
    const cdp = await context.newCDPSession(tab);
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, [], 'Installable');
    const item = await tab.evaluate(() => catalog.find(x => x.pdf).id),
      pdf = await tab.evaluate(id => catalog.find(x => x.id === id).pdf, item),
      unopened = await tab.evaluate(id => catalog.find(x => x.pdf && x.id !== id).pdf, item);
    await tab.locator('#search').fill(await tab.evaluate(id => catalog.find(x => x.id === id).title, item));
    await tab.locator(`#cards [data-open="${item}"]`).click();
    const pdfTab = await context.newPage();
    await pdfTab.goto(origin + pdf).catch(() => {}); // headless Chromium may abort on the PDF viewer
    await pdfTab.close();
    await tab.waitForFunction(
      url =>
        caches.keys().then(async names => {
          for (const name of names) if (await (await caches.open(name)).match(url)) return true;
          return false;
        }),
      origin + pdf
    );
    // Offline: the server is gone, and the browser says so.
    await halt();
    await context.setOffline(true);
    await tab.reload();
    assert.equal(await tab.locator('#cards .card').count(), 24, 'The library opens offline');
    assert.equal(await tab.locator('#offline-status').textContent(), '● Working offline');
    await tab.evaluate(id => openScore(catalog.find(x => x.id === id)), item);
    assert.ok((await tab.locator('#notation .abcjs-notehead').count()) > 0, 'An opened score opens offline');
    await tab.locator('#notation .abcjs-notehead').first().click({force: true});
    const before = await tab.inputValue('#abc');
    await tab.keyboard.press('ArrowUp');
    assert.notEqual(await tab.inputValue('#abc'), before, 'The editor works offline');
    await tab.click('#play');
    await tab.waitForFunction(() => playPosition() > 0.05, null, {timeout: 10000});
    await tab.click('#stop');
    assert.deepEqual(
      await tab.evaluate(
        urls =>
          Promise.all(
            urls.map(u =>
              fetch(u).then(
                r => r.status,
                () => 'failed'
              )
            )
          ),
        [pdf, unopened]
      ),
      [200, 'failed'],
      'An opened PDF works offline; one never opened does not'
    );
    // A deploy cut short: the connection drops on its catalogs. The About page says part of the copy is missing, and
    // offline the last complete version still opens with its whole library.
    const old = await tab.evaluate(() => document.querySelector('script[src]').src),
      oldTitle = await tab.title();
    deploy = html => html.replace(/\?v=\w+/g, '?v=cutshort').replace('<title>', '<title>Cut short · ');
    refuse = /\/catalog-[^/]*\.js\?v=cutshort/;
    await listen(port);
    await context.setOffline(false);
    await tab.evaluate(() => (dirty = false));
    await tab.reload();
    assert.match(await tab.title(), /^Cut short · /);
    await tab.waitForFunction(() => /^Part of the offline copy is missing;/.test($('offline-ready').textContent));
    await halt();
    await context.setOffline(true);
    await tab.reload();
    assert.equal(await tab.title(), oldTitle, 'Offline, the last complete version opens');
    assert.equal(await tab.locator('#cards .card').count(), 24, 'with its whole library');
    await tab.waitForFunction(() => /has an offline copy/.test($('offline-ready').textContent));
    // A new deploy (new stamps and a changed page) is picked up within one reload. Once all of it is kept, the assets
    // of the old version and of the deploy cut short are dropped.
    refuse = null;
    deploy = html => html.replace(/\?v=\w+/g, '?v=newdeploy').replace('<title>', '<title>New deploy · ');
    await listen(port);
    await context.setOffline(false);
    await tab.reload();
    assert.match(await tab.title(), /^New deploy · /, 'A new deploy shows after one reload');
    assert.ok(await tab.evaluate(() => [...document.scripts].every(s => !s.src || s.src.endsWith('?v=newdeploy'))));
    await tab.waitForFunction(() => /has an offline copy/.test($('offline-ready').textContent));
    await tab.waitForFunction(
      url =>
        caches.keys().then(async names => {
          for (const name of names)
            for (const request of await (await caches.open(name)).keys())
              if (request.url === url || request.url.endsWith('?v=cutshort')) return false;
          return true;
        }),
      old
    );
    // Online, an opened PDF is fetched again, so a corrected edition reaches students, and it is the copy kept offline.
    const corrected = '%PDF-1.4 corrected edition';
    replaced = {[decodeURIComponent(new URL(pdf, origin).pathname)]: Buffer.from(corrected)};
    assert.equal(await tab.evaluate(url => fetch(url).then(r => r.text()), pdf), corrected);
    await tab.waitForFunction(
      ([url, text]) =>
        caches
          .match(url)
          .then(r => (r ? r.text() : ''))
          .then(t => t === text),
      [origin + pdf, corrected]
    );
    // At phone width, with the offline notice showing, Install app fits above the nav and works from the keyboard.
    // Headless Chromium never offers installing, so the browser's offer is stood in for.
    await tab.setViewportSize({width: 390, height: 844});
    await context.setOffline(true);
    await tab.waitForFunction(() => $('offline-status').textContent === '● Working offline');
    assert.match(await tab.locator('#toast').textContent(), /^You are offline\./);
    await tab.evaluate(() => {
      const offer = new Event('beforeinstallprompt', {cancelable: true});
      offer.prompt = () => (window.__prompted = true);
      offer.userChoice = Promise.resolve({outcome: 'accepted'});
      window.dispatchEvent(offer);
      window.scrollTo(0, 0);
    });
    const install = tab.locator('#install-app'),
      installBox = await install.boundingBox(),
      navBox = await tab.locator('header nav').boundingBox();
    assert.ok(installBox && installBox.x >= 0 && installBox.x + installBox.width <= 390, 'Install app fits a phone');
    assert.ok(installBox.y + installBox.height <= navBox.y, 'Install app sits above the nav');
    assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.equal(
      await tab.evaluate(url => fetch(url).then(r => r.text()), pdf),
      corrected,
      'The corrected PDF offline'
    );
    // The notice and Install app sit with the theme choice. At iPad widths (820px and below) they share the first row
    // with the logo, above the nav; at narrow laptop widths they move to a row below the nav when they do not fit
    // beside it, rather than squeezing the nav labels onto several lines.
    for (const width of [768, 820, 1024, 1150]) {
      await tab.setViewportSize({width, height: 1024});
      const header = await tab.evaluate(() => {
        const lines = button => {
            const range = document.createRange();
            range.selectNodeContents(button);
            return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
          },
          buttons = [...document.querySelectorAll('header .nav')],
          nav = buttons.map(b => b.getBoundingClientRect()),
          status = document.querySelector('.header-tools').getBoundingClientRect();
        return {
          lines: buttons.map(lines),
          above: status.bottom <= Math.min(...nav.map(r => r.top)),
          beside: status.left >= Math.max(...nav.map(r => r.right)),
          below: status.top >= Math.max(...nav.map(r => r.bottom)),
          fits: status.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1
        };
      });
      assert.deepEqual(header.lines, [1, 1, 1, 1], `Nav labels stay on one line at ${width}px`);
      assert.ok(
        width > 820 ? header.beside || header.below : header.above,
        `The notice sits clear of the nav at ${width}px`
      );
      assert.ok(header.fits, `The notice fits at ${width}px`);
    }
    await tab.setViewportSize({width: 390, height: 844});
    await install.focus();
    await tab.keyboard.press('Enter');
    await tab.waitForFunction(() => $('install-app').hidden);
    assert.ok(
      await tab.evaluate(() => window.__prompted && document.activeElement === document.querySelector('.nav.active'))
    );
    await context.setOffline(false);
    await tab.waitForFunction(() => $('offline-status').textContent === '');
    assert.deepEqual(
      requests.filter(url => !url.startsWith(origin)),
      [],
      'No request leaves the site'
    );
    await context.close();
    await halt();
    fs.rmSync(profile, {recursive: true, force: true});
  }
  // Record yourself in real Chromium. The "microphone" is a loopback of FretFree's own output, 120 ms late, so
  // calibration has clicks to hear and the take holds the score as played: its first note must fall where the take is
  // lined up with the score, within 50 ms.
  {
    await page.setViewportSize({width: 1280, height: 900});
    const takeSource = 'X:1\nT:Browser take\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G4 |]',
      offSite = [];
    const watchRequests = request => {
      if (!request.url().startsWith(new URL(page.url()).origin)) offSite.push(request.url());
    };
    page.on('request', watchRequests);
    const openTakeScore = () =>
      page.evaluate(source => {
        openScore({title: 'Browser take', abc: source});
        $('metronome').checked = false;
        $('trainer').checked = false;
        $('loop').checked = true;
        $('speed').value = 100;
        $('speed').oninput();
        $('record-count-in').value = '1';
        window.scrollTo({top: 0, behavior: 'instant'});
      }, takeSource);
    await openTakeScore();
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        audioContext();
        const loop = audio.createMediaStreamDestination(),
          delay = audio.createDelay(1);
        delay.delayTime.value = 0.12;
        outputNode().connect(delay);
        delay.connect(loop);
        return loop.stream;
      };
    });
    await page.click('#record');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'record-start');
    await page.focus('#record-calibrate');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => !calibrating && /^Calibrated|couldn’t/.test($('calibrate-status').textContent),
      null,
      {
        timeout: 20000
      }
    );
    const latency = await page.evaluate(() => storedLatency()?.ms);
    assert.ok(latency >= 100 && latency <= 400, `Calibration hears its clicks (${latency} ms)`);
    await page.focus('#record-start');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => rec?.state === 'live');
    assert.equal(await page.textContent('#record'), '● Recording');
    await page.waitForFunction(() => document.querySelector('#take-list li'), null, {timeout: 20000});
    assert.match(
      await page.textContent('#record-status'),
      /^Take 1 saved \(0:0[6-8]\)\. Save the score to keep its takes with it\.$/,
      'One pass, though Loop is on'
    );
    const lined = await page.evaluate(async () => {
      const take = shownTakes[0],
        buffer = await decodeBlob(take.blob),
        rate = buffer.sampleRate,
        at = takeOffset(take, takeLatency(take)),
        from = Math.round((at - 0.3) * rate),
        samples = buffer.getChannelData(0).subarray(from);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      return {
        at,
        heard: samples.findIndex(v => Math.abs(v) > peak * 0.3) / rate + from / rate,
        calibrated: take.calibrated
      };
    });
    assert.ok(
      lined.calibrated && Math.abs(lined.heard - lined.at) < 0.05,
      `Take and score line up: ${JSON.stringify(lined)}`
    );
    // The score is unsaved and unchanged, so it has no draft. Another tab of the same browser still does not count its
    // take as out of reach while this tab is open, through the Web Lock this tab holds.
    const [otherTab] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => window.open(location.origin + location.pathname, '_blank'))
    ]);
    otherTab.on('pageerror', e => errors.push(e.message));
    await otherTab.waitForFunction(() => typeof strayTakeKeys === 'function' && renderedTune);
    const elsewhere = await otherTab.evaluate(
      async key => {
        await indexTakes();
        return {stored: storedTakeKeys.includes(key), stray: (await strayTakeKeys()).includes(key)};
      },
      await page.evaluate(() => recordKey())
    );
    assert.deepEqual(elsewhere, {stored: true, stray: false}, 'Takes of work open in another tab are kept');
    await otherTab.close();
    // Takes are kept in IndexedDB and go with the score when it is saved: after a reload the saved score shows its
    // take, which plays with the score and downloads.
    await page.click('#save');
    await page.waitForFunction(async () => /^saved:/.test(recordKey()) && (await listTakes(recordKey())).length === 1);
    await page.reload();
    await page.waitForFunction(() => typeof recordKey === 'function' && renderedTune);
    await page.evaluate(() => {
      const score = saved.find(x => x.title === 'Browser take');
      openScore(score, score.id);
      $('loop').checked = true;
      window.scrollTo({top: 0, behavior: 'instant'});
    });
    await page.click('#record');
    await page.waitForFunction(() => document.querySelector('#take-list li'));
    assert.match(await page.textContent('#take-list'), /Take 1 0:0[6-8]/);
    await page.click('[data-take-score]');
    await page.waitForFunction(() => takePlayer?.withScore && playing);
    assert.equal(await page.textContent('[data-take-score]'), '■ Stop');
    await page.click('[data-take-score]');
    await page.waitForFunction(() => !takePlayer && !playing);
    const [file] = await Promise.all([page.waitForEvent('download'), page.click('[data-take-download]')]);
    assert.equal(file.suggestedFilename(), 'Browser take take 1.webm');
    // Phone width: the panel and its takes fit without scrolling the page sideways.
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#record-panel').scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'No sideways scroll at 390px'
    );
    const buttons = await page
      .locator('#take-list button')
      .evaluateAll(els =>
        els.map(el => el.getBoundingClientRect()).map(r => r.right <= window.innerWidth && r.height >= 30)
      );
    assert.ok(buttons.length === 4 && buttons.every(Boolean), 'Take buttons stay on screen and easy to tap');
    await page.focus('[data-take-delete]');
    await page.keyboard.press('Enter');
    // The list empties before the delete moves focus, so wait for both.
    await page.waitForFunction(
      () => !document.querySelector('#take-list li') && document.activeElement.id === 'record-start'
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => $('record-panel').hidden), true, 'Escape closes the panel');
    await page.setViewportSize({width: 1280, height: 900});
    page.off('request', watchRequests);
    assert.deepEqual(offSite, [], 'Recording makes no request off the site');
    await page.evaluate(() => {
      $('loop').checked = false;
      storage.remove(KEYS.latency);
      saved = saved.filter(x => x.id !== savedId);
      storeScores(saved);
    });
  }
  // Studio layout: wide screens show every control with nothing to open; up to 1100px the editor panel's halves, the
  // practice band and the view options fold behind toggles (pointer, touch and keyboard, remembered per device), More
  // also holds the palette's second tier, and the score comes first on a phone.
  {
    const url = process.env.FRETFREE_URL || 'http://localhost:8000';
    const openOde = async tab => {
      await tab.goto(url);
      await tab.waitForFunction(() => typeof openScore === 'function' && catalog.length);
      await tab.evaluate(() => {
        openScore(catalog.find(x => x.id === 'ode'));
        window.scrollTo({top: 0, behavior: 'instant'});
      });
      await tab.waitForSelector('#notation svg');
    };
    const notationTop = tab => tab.evaluate(() => $('notation').getBoundingClientRect().top + scrollY);
    const noSideways = tab => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const desk = await browser.newContext({viewport: {width: 1280, height: 900}});
    const wide = await desk.newPage();
    wide.on('pageerror', e => errors.push('studio layout: ' + e.message));
    await openOde(wide);
    for (const width of [1280, 1440]) {
      await wide.setViewportSize({width, height: 900});
      for (const id of ['settings-toggle', 'write-toggle', 'practice-toggle', 'view-toggle'])
        assert.equal(await wide.isVisible('#' + id), false, `No fold toggle at ${width}px: ${id}`);
      const hiddenControls = await wide.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.editor-panel :is(input:not([type=file]), select, textarea, button), .music-panel :is(.transport, #practice-panel, #edit-bar, #palette, #help-row, #score-view) :is(input, select, button, summary)'
          )
        ]
          .filter(
            el => !el.closest('[hidden], .disclose, #abc-help, #palette-more, #palette-tuplets, #palette-measure')
          )
          .filter(el => !el.getClientRects().length)
          .map(el => el.id || el.dataset.palette || el.textContent.trim())
      );
      assert.deepEqual(hiddenControls, [], `Every studio control shows at ${width}px without opening anything`);
      for (const id of ['score-settings', 'write-notes', 'practice-panel', 'view-options'])
        assert.ok(await wide.isVisible('#' + id), `${id} shows at ${width}px`);
      assert.equal(
        await wide
          .locator('#palette > .tier-2')
          .evaluateAll(els => els.filter(el => !el.getClientRects().length).length),
        0,
        `The palette's second tier shows at ${width}px`
      );
      assert.ok(await noSideways(wide), `No sideways scroll at ${width}px`);
      // Mixer sits after Volume on the first playback row, and its panel opens between the practice band and Record.
      assert.deepEqual(
        await wide.evaluate(() => {
          const top = id => Math.round($(id).getBoundingClientRect().top),
            after = (a, b) => !!($(a).compareDocumentPosition($(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
          return [
            top('mixer-toggle') === top('play'),
            $('volume').closest('label').nextElementSibling === $('mixer-toggle'),
            after('practice-panel', 'mixer-panel') && after('mixer-panel', 'record-panel')
          ];
        }),
        [true, true, true],
        `Mixer is on the first playback row at ${width}px`
      );
      // Keep bars full sits after Hear notes in the note-entry bar, which stays one row at 1440px.
      assert.deepEqual(
        await wide.evaluate(() => {
          const shown = [...document.querySelectorAll('#edit-bar :is(button, label)')].filter(
            el => el.getClientRects().length
          );
          return [
            $('audition').closest('label').nextElementSibling === $('keep-bars-option'),
            $('keep-bars-option').closest('.entry-tools') !== null,
            innerWidth < 1440 || new Set(shown.map(el => Math.round(el.getBoundingClientRect().top))).size === 1
          ];
        }),
        [true, true, true],
        `Keep bars full is in the note-entry bar at ${width}px`
      );
    }
    assert.ok((await notationTop(wide)) <= 820, 'The score starts high on the page at 1440px');
    // The palette's group headings are small text, so they need 4.5:1 against the page in both themes.
    for (const colorScheme of ['light', 'dark']) {
      await wide.emulateMedia({colorScheme});
      const ratios = await wide.evaluate(() => {
        const parse = c => c.match(/[\d.]+/g).map(Number),
          channel = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
          lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b),
          background = el => {
            for (; el; el = el.parentElement) {
              const c = parse(getComputedStyle(el).backgroundColor);
              if (c.length < 4 || c[3] > 0) return c.slice(0, 3);
            }
            return [255, 255, 255];
          };
        return [...document.querySelectorAll('.palette [data-heading]')].map(group => {
          const style = getComputedStyle(group, '::before'),
            bg = background(group),
            alpha = (parse(style.color)[3] ?? 1) * +style.opacity,
            fg = parse(style.color)
              .slice(0, 3)
              .map((v, i) => v * alpha + bg[i] * (1 - alpha));
          return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        });
      });
      assert.ok(ratios.length && Math.min(...ratios) >= 4.5, `Palette headings reach 4.5:1 (${colorScheme})`);
    }
    await wide.emulateMedia({colorScheme: 'light'});
    // The note-entry bar wraps at 1280px; no divider is left hanging at the start of its second row.
    assert.equal(
      await wide.evaluate(() => getComputedStyle(document.querySelector('#edit-bar .selection-tools')).borderLeftStyle),
      'none'
    );
    // The keyboard keys open from their summary by keyboard and by pointer, and stay open after a reload. The
    // details element saves its state from its toggle event, which comes a moment after the key press.
    await wide.focus('#keyboard-help > summary');
    await wide.keyboard.press('Enter');
    assert.ok(await wide.isVisible('#keyboard-help .kb-groups'), 'Enter opens the keyboard keys');
    await wide.waitForFunction(
      () => JSON.parse(localStorage.getItem('fretfree-studio-panels') || '{}')['keyboard-help'] === true
    );
    await openOde(wide);
    assert.ok(await wide.evaluate(() => $('keyboard-help').open), 'The keyboard keys stay open after a reload');
    await wide.click('#keyboard-help > summary');
    assert.equal(await wide.isVisible('#keyboard-help .kb-groups'), false, 'A click closes the keyboard keys');
    await desk.close();

    // Phone: everything folded at first, so the score is about a screen and a bit down.
    const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    const phone = await context.newPage();
    phone.on('pageerror', e => errors.push('studio layout phone: ' + e.message));
    await openOde(phone);
    const folds = {
      'settings-toggle': 'score-settings',
      'write-toggle': 'write-notes',
      'practice-toggle': 'practice-panel',
      'view-toggle': 'view-options'
    };
    for (const [toggle, fold] of Object.entries(folds)) {
      assert.equal(await phone.getAttribute('#' + toggle, 'aria-expanded'), 'false', `${toggle} starts closed`);
      assert.equal(await phone.isVisible('#' + fold), false, `${fold} starts folded`);
    }
    const top = await notationTop(phone);
    assert.ok(top < 1200, `The score starts within 1200px on a phone (was about 3100px): ${top}`);
    assert.ok(await noSideways(phone), 'No sideways scroll at 390px');
    assert.ok(await phone.isVisible('#mixer-toggle'), 'Mixer stays in view at phone width, outside the Practice fold');
    // The status line keeps room for its longest message, so the score does not move under a finger between a tap's
    // touch events and the mouse events after them (abcjs selects on both, and would pick the note above).
    for (const width of [390, 360]) {
      await phone.setViewportSize({width, height: 844});
      const heights = await phone.evaluate(() => {
        const status = $('selection-status'),
          was = status.textContent,
          heights = [];
        for (const text of [
          'Sharp.',
          'Quarter note D5, measure 12, beat 3 · type A–G to add notes after it, ↑↓ to change pitch · Shift+click another note to practice from here to there'
        ]) {
          status.textContent = text;
          heights.push([status.getBoundingClientRect().height, $('notation').getBoundingClientRect().top]);
        }
        status.textContent = was;
        return heights;
      });
      assert.deepEqual(heights[0], heights[1], `The score stays put as the status line changes at ${width}px`);
    }
    await phone.setViewportSize({width: 390, height: 844});
    // Touch and pointer open each fold.
    for (const [toggle, fold] of Object.entries(folds)) {
      if (toggle === 'practice-toggle' || toggle === 'settings-toggle') await phone.tap('#' + toggle);
      else await phone.click('#' + toggle);
      assert.equal(await phone.getAttribute('#' + toggle, 'aria-expanded'), 'true', `${toggle} opens`);
      assert.ok(await phone.isVisible('#' + fold), `${fold} shows once open`);
    }
    assert.ok(await phone.isVisible('#abc'), 'The ABC source is under Write notes & ABC');
    assert.ok(await noSideways(phone), 'No sideways scroll with every fold open');
    assert.deepEqual(
      await phone.evaluate(() => JSON.parse(localStorage.getItem('fretfree-studio-panels'))),
      {'score-settings': true, 'write-notes': true, 'practice-panel': true, 'view-options': true},
      'The open folds are remembered'
    );
    await openOde(phone);
    for (const [toggle, fold] of Object.entries(folds)) {
      assert.equal(await phone.getAttribute('#' + toggle, 'aria-expanded'), 'true', `${toggle} is open after a reload`);
      assert.ok(await phone.isVisible('#' + fold), `${fold} shows after a reload`);
    }
    // The keyboard closes and opens them too: Enter and Space on the toggle.
    for (const [toggle, fold] of Object.entries(folds)) {
      await phone.focus('#' + toggle);
      await phone.keyboard.press(toggle === 'view-toggle' ? 'Space' : 'Enter');
      assert.equal(await phone.getAttribute('#' + toggle, 'aria-expanded'), 'false', `The keyboard closes ${toggle}`);
      assert.equal(await phone.isVisible('#' + fold), false, `${fold} folds again`);
    }
    await phone.focus('#practice-toggle');
    await phone.keyboard.press('Space');
    assert.ok(await phone.isVisible('#loop'), 'Space opens Practice');
    await phone.keyboard.press('Tab');
    assert.equal(
      await phone.evaluate(() => document.activeElement.id),
      'loop',
      'The practice band comes right after its toggle in tab order'
    );
    // A folded toggle says when something inside is on.
    await phone.click('#loop');
    await phone.click('#practice-toggle');
    assert.equal(await phone.isVisible('#loop'), false);
    assert.ok(
      await phone.evaluate(() => $('practice-toggle').classList.contains('in-use')),
      'Practice is marked while Loop is on'
    );
    assert.equal(
      await phone.getByRole('button', {name: /Practice \(settings on\)/}).count(),
      1,
      "Practice's name says its settings are on"
    );
    // Folded and in use looks different from open: a badge on the corner, no underline, and the mark points down.
    const look = id =>
      phone.evaluate(id => {
        const b = $(id),
          badge = b.querySelector('.disclose-badge');
        return {
          badge: badge.getClientRects().length > 0,
          underline: getComputedStyle(b).boxShadow !== 'none',
          up: getComputedStyle(b.querySelector('.disclose-mark')).transform !== 'none'
        };
      }, id);
    assert.deepEqual(
      await look('practice-toggle'),
      {badge: true, underline: false, up: false},
      'Folded with Loop on: the badge shows'
    );
    await phone.evaluate(() => {
      $('loop').checked = false;
      $('loop').dispatchEvent(new Event('change', {bubbles: true}));
    });
    assert.equal(await phone.evaluate(() => $('practice-toggle').classList.contains('in-use')), false);
    assert.deepEqual(await look('practice-toggle'), {badge: false, underline: false, up: false}, 'A plain toggle');
    await phone.tap('#practice-toggle');
    assert.deepEqual(
      await look('practice-toggle'),
      {badge: false, underline: true, up: true},
      'Open: the underline, and the mark points up'
    );
    // Touch sizes on a phone: the practice band's buttons and boxes are 40px tall, and the sliders take the rest of
    // their rows.
    const sizes = await phone.evaluate(() =>
      Object.fromEntries(
        ['speed-reset', 'start-measure', 'end-measure', 'trainer-goal', 'speed', 'volume'].map(id => {
          const r = $(id).getBoundingClientRect();
          return [id, [r.width, r.height]];
        })
      )
    );
    for (const id of ['speed-reset', 'start-measure', 'end-measure', 'trainer-goal'])
      assert.ok(sizes[id][1] >= 40, `${id} is at least 40px tall on a phone: ${sizes[id]}`);
    assert.ok(sizes.speed[0] >= 150, `The speed slider takes the rest of its row: ${sizes.speed}`);
    assert.ok(sizes.volume[0] > 72, `Volume takes the rest of its row: ${sizes.volume}`);
    await phone.tap('#practice-toggle');
    // Every selection button's label fits inside it, at 390 and 360px.
    for (const width of [390, 360]) {
      await phone.setViewportSize({width, height: 844});
      assert.deepEqual(
        await phone.evaluate(() =>
          [...document.querySelectorAll('#edit-bar .selection-tools button')]
            .filter(b => b.scrollWidth > b.clientWidth)
            .map(b => b.id)
        ),
        [],
        `The selection buttons' labels fit at ${width}px`
      );
    }
    await phone.setViewportSize({width: 390, height: 844});
    // Folded, Write notes & ABC shows that the ABC has warnings, and screen readers still have them (a live region).
    await phone.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:Warning\nM:4/4\nL:1/4\nK:C\nC D E F | !nonsense! G A B c |]', instrument: 'Flute'});
    });
    await phone.waitForFunction(() => $('write-toggle').classList.contains('in-use'));
    assert.equal(await phone.isVisible('#abc'), false, 'Write notes is folded');
    assert.deepEqual(
      await look('write-toggle'),
      {badge: true, underline: false, up: false},
      'The warnings badge shows'
    );
    assert.match(
      await phone.locator('#write-notes').ariaSnapshot(),
      /status: .*Unknown decoration/,
      'The folded warnings stay in the accessibility tree'
    );
    assert.equal(
      await phone.getByRole('button', {name: /Write notes & ABC \(check the ABC warnings\)/}).count(),
      1,
      "Write notes' name says so"
    );
    await openOde(phone);
    assert.equal(await phone.evaluate(() => $('write-toggle').classList.contains('in-use')), false);
    // The palette's second tier waits behind More, and the arrow keys skip it while it is folded.
    const tier2 = () =>
      phone.locator('#palette > .tier-2').evaluateAll(els => els.filter(el => el.getClientRects().length).length);
    assert.equal(await tier2(), 0, 'The second tier is folded on a phone');
    assert.ok(
      (await phone.isVisible('[data-palette="chord"]')) && (await phone.isVisible('[data-palette="lyric"]')),
      'Chord and Lyrics stay in view with the second tier folded'
    );
    await phone.locator('#notation .abcjs-notehead').first().tap({force: true});
    await phone.focus('[data-palette="respell"]');
    await phone.keyboard.press('ArrowRight');
    assert.equal(
      await phone.evaluate(() => document.activeElement.dataset.palette),
      'chord',
      'ArrowRight from Respell skips the folded Beam, Articulation and Dynamics'
    );
    await phone.focus('[data-palette="lyric"]');
    await phone.keyboard.press('ArrowRight');
    assert.equal(
      await phone.evaluate(() => document.activeElement.dataset.palette),
      'more',
      'ArrowRight from Lyrics skips the folded Lines and Grace notes'
    );
    await phone.keyboard.press('Enter');
    assert.equal(await tier2(), 5, 'More shows the second tier');
    await phone.focus('[data-palette="respell"]');
    await phone.keyboard.press('ArrowRight');
    assert.equal(await phone.evaluate(() => document.activeElement.dataset.palette), 'beam:join');
    await phone.click('[data-palette="more"]');
    assert.equal(await tier2(), 0, 'Closing More folds the second tier again');
    // More opens the second tier above itself, so the page scrolls by as much: More stays under the finger, and the
    // marks it opens below it stay on screen.
    const moreTop = () =>
      phone.evaluate(() => document.querySelector('[data-palette="more"]').getBoundingClientRect().top);
    await phone.evaluate(() => {
      const more = document.querySelector('[data-palette="more"]');
      window.scrollTo({top: more.getBoundingClientRect().top + scrollY - 500, behavior: 'instant'});
    });
    const moreAt = await moreTop();
    await phone.tap('[data-palette="more"]');
    assert.equal(await tier2(), 5);
    assert.ok(Math.abs((await moreTop()) - moreAt) < 2, 'Opening More leaves it where it was');
    assert.ok(
      await phone.evaluate(
        () =>
          $('palette-more').querySelector('[data-palette="deco:arpeggio"]').getBoundingClientRect().bottom <=
          innerHeight
      ),
      'The marks under More are on screen'
    );
    await phone.tap('[data-palette="more"]');
    assert.equal(await tier2(), 0);
    assert.ok(Math.abs((await moreTop()) - moreAt) < 2, 'Closing More leaves it where it was');
    await context.close();

    // iPad: one column, the folds work by touch, and Key still leads to its choice in tab order.
    const ipadContext = await browser.newContext({viewport: {width: 820, height: 1180}, hasTouch: true});
    const ipad = await ipadContext.newPage();
    ipad.on('pageerror', e => errors.push('studio layout iPad: ' + e.message));
    await openOde(ipad);
    assert.ok(await noSideways(ipad), 'No sideways scroll at 820px');
    assert.ok((await notationTop(ipad)) < 1000, 'The score starts within the first screen on an iPad');
    // Turned upright, an iPad folds the second tier; if one of its buttons held the toolbar's tab stop, More takes it.
    await ipad.setViewportSize({width: 1180, height: 820});
    await ipad.focus('[data-palette="respell"]');
    await ipad.keyboard.press('ArrowRight');
    assert.equal(await ipad.evaluate(() => document.activeElement.dataset.palette), 'beam:join');
    await ipad.setViewportSize({width: 820, height: 1180});
    await ipad.waitForFunction(() => document.querySelector('[data-palette="more"]').tabIndex === 0, null, {
      timeout: 5000
    });
    await ipad.focus('#duplicate-notes');
    await ipad.keyboard.press('Tab');
    assert.equal(
      await ipad.evaluate(() => document.activeElement.dataset.palette),
      'more',
      'Tab from the selection tools reaches the toolbar'
    );
    await ipad.tap('#settings-toggle');
    assert.ok(await ipad.isVisible('#key'), 'Score settings opens by touch');
    await ipad.selectOption('#key', 'G');
    await ipad.locator('#key').focus();
    await ipad.keyboard.press('Tab');
    assert.equal(await ipad.evaluate(() => document.activeElement.id), 'key-transpose', 'Key → Transpose notes');
    await ipad.click('#key-cancel');
    // The bar check's Show opens Write notes & ABC, then selects the bar in the ABC text.
    await ipad.evaluate(() => {
      dirty = false;
      openScore({abc: 'X:1\nT:Bars\nM:4/4\nL:1/4\nK:C\nC D E F | G A B | c d e f g | a4 |]', instrument: 'Flute'});
    });
    await ipad.waitForSelector('[data-bar-fix="show"]');
    assert.equal(await ipad.isVisible('#abc'), false, 'Write notes starts folded');
    await ipad.tap('[data-bar-fix="show"]');
    assert.deepEqual(
      await ipad.evaluate(() => [
        $('write-toggle').getAttribute('aria-expanded'),
        document.activeElement.id,
        $('abc').value.slice($('abc').selectionStart, $('abc').selectionEnd).trim()
      ]),
      ['true', 'abc', 'G A B |'],
      'Show opens Write notes & ABC and selects the short bar'
    );
    assert.ok(await ipad.isVisible('#abc'));
    // Printing shows the score, not the layout's toggles and bands.
    await ipad.emulateMedia({media: 'print'});
    for (const selector of ['#edit-bar', '#help-row', '.panel-toggles', '#practice-toggle', '#view-toggle'])
      assert.equal(await ipad.isVisible(selector), false, `${selector} does not print`);
    assert.ok(await ipad.isVisible('#notation svg'), 'The score prints');
    // A changed library edition prints that its notation was edited, and not the screen's editing hint.
    await ipad.emulateMedia({media: 'screen'});
    await ipad.evaluate(() => {
      dirty = false;
      openScore(catalog.find(x => x.id === 'pgh-1002'));
      $('add-bars').click();
    });
    await ipad.emulateMedia({media: 'print'});
    assert.match(await ipad.innerText('#rights'), /Notation edited in FretFree from this edition/);
    assert.equal(await ipad.isVisible('#rights .rights-hint'), false, 'The editing hint does not print');
    await ipad.emulateMedia({media: 'screen'});
    assert.equal(await ipad.isVisible('#rights .rights-hint'), true);
    await ipadContext.close();
  }
  // Play-along check in real Chromium. The "microphone" is first a loopback of FretFree's own output, 120 ms late, so a
  // perfect player is heard: notes are marked green while the score plays on, and Pitch and Rhythm are shown. Then a
  // steady wrong note: every note is red. Marks never reach SVG export or print, and nothing leaves the site.
  {
    await page.setViewportSize({width: 1280, height: 900});
    const offSite = [],
      watchRequests = request => {
        if (!request.url().startsWith(new URL(page.url()).origin)) offSite.push(request.url());
      };
    page.on('request', watchRequests);
    await page.evaluate(() => {
      openScore({
        title: 'Browser check',
        abc: 'X:1\nT:Browser check\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G2 A2 |]'
      });
      $('metronome').checked = false;
      $('loop').checked = false;
      $('speed').value = 100;
      $('speed').oninput();
      // The loopback's own delay (output to stream to analyser) comes on top of the 120 ms.
      storage.set(KEYS.latency, {ms: 160, at: Date.now()});
      window.__mic = 'loopback';
      navigator.mediaDevices.getUserMedia = async () => {
        audioContext();
        const loop = audio.createMediaStreamDestination();
        if (window.__mic === 'loopback') {
          const delay = audio.createDelay(1);
          delay.delayTime.value = 0.12;
          outputNode().connect(delay);
          delay.connect(loop);
        } else {
          // F sharp, which this C major tune never has.
          const osc = audio.createOscillator(),
            gain = audio.createGain();
          osc.frequency.value = 370;
          gain.gain.value = 0.3;
          osc.connect(gain).connect(loop);
          osc.start();
        }
        return loop.stream;
      };
      window.scrollTo({top: 0, behavior: 'instant'});
    });
    await page.focus('#assess');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'assess-start', 'Focus goes to Start check');
    // The loopback plays the student's part, so the melody plays (it is off at first).
    assert.equal(await page.isChecked('#assess-melody'), false);
    await page.check('#assess-melody');
    await page.focus('#assess-start');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => check?.state === 'live');
    assert.equal(await page.textContent('#assess'), '● Listening');
    assert.equal(
      ...(await page.evaluate(() => ['assess', 'assess-start'].map(id => getComputedStyle($(id)).backgroundColor))),
      'Check turns red while it listens, like Start check'
    );
    // The bars of each color are drawn as paths, each holding a number of them.
    const marked = which =>
      page.evaluate(
        which =>
          [...document.querySelectorAll(`#notation .assess-${which}`)].reduce(
            (n, p) => n + +p.getAttribute('data-marks'),
            0
          ),
        which
      );
    await page.waitForFunction(
      () => [...document.querySelectorAll('#notation .assess-mark')].some(p => +p.getAttribute('data-marks') >= 2),
      null,
      {timeout: 15000}
    );
    assert.equal(await page.evaluate(() => playing), true, 'Marks are drawn while the score plays on');
    await page.waitForFunction(() => !check && lastCheck, null, {timeout: 20000});
    const heard = await page.evaluate(() => ({
      pitch: parseInt($('assess-pitch').textContent),
      rhythm: parseInt($('assess-rhythm').textContent),
      marks: lastCheck.result.notes.map(n => n.mark),
      status: $('assess-status').textContent
    }));
    assert.match(heard.status, /^Checked 6 notes: pitch \d+%, rhythm \d+%, \d stars?\.$/);
    assert.match(await page.textContent('#assess-history'), / · melody on /, 'The check says the melody played');
    assert.equal(await marked('mark'), 6, 'Every note is marked');
    assert.ok(
      heard.pitch >= 80 && heard.rhythm >= 80 && heard.marks.filter(m => m === 'green').length >= 5,
      `The score, played back, is heard as right: ${JSON.stringify(heard)}`
    );
    assert.equal(
      await marked('green'),
      heard.marks.filter(m => m === 'green').length,
      'Green bars for the green notes'
    );
    const exported = await page.evaluate(() => {
      window.__downloads = [];
      download = data => __downloads.push(data);
      $('export-svg').click();
      return __downloads[0];
    });
    assert.ok(exported.includes('<svg') && !exported.includes('assess-mark'), 'Marks are left out of SVG export');
    await page.emulateMedia({media: 'print'});
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('#notation .assess-mark')).display),
      'none',
      'Marks do not print'
    );
    await page.emulateMedia({media: 'screen'});
    await page.evaluate(() => (window.__mic = 'wrong'));
    await page.click('#assess-start');
    await page.waitForFunction(() => !check && lastCheck && $('assess-history').children.length === 2, null, {
      timeout: 20000
    });
    const wrong = await page.evaluate(() => ({
      pitch: $('assess-pitch').textContent,
      reds: [...document.querySelectorAll('#notation .assess-red')].reduce(
        (n, p) => n + +p.getAttribute('data-marks'),
        0
      ),
      problems: $('assess-problems').children.length,
      first: $('assess-problems').firstElementChild.textContent
    }));
    assert.deepEqual([wrong.pitch, wrong.reds, wrong.problems], ['0%', 6, 6], 'A steady wrong note is red throughout');
    assert.match(wrong.first, /^Measure 1, note 1: heard F♯, not C$/);
    // Phone width: the panel fits without scrolling the page sideways, and its controls stay on screen.
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#assess-panel').scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'No sideways scroll at 390px'
    );
    assert.ok(
      await page
        .locator('#assess-panel button, #assess-panel select')
        .evaluateAll(els => els.every(el => el.getBoundingClientRect().right <= window.innerWidth)),
      'The check’s controls stay on screen'
    );
    // ✓ Check is in the practice band, folded on a phone: closed there, the focus goes to ⏱ Practice, and a click opens
    // the fold and then the panel.
    await page.evaluate(() => setFold('practice-panel', false));
    await page.focus('#assess-start');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => $('assess-panel').hidden), true, 'Escape closes the panel');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'practice-toggle');
    assert.equal(await page.isVisible('#assess'), false, 'Check is folded away with the practice band');
    await page.click('#practice-toggle');
    await page.click('#assess');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'assess-start');
    assert.ok(await page.isVisible('#assess-start'), 'The panel opens on a phone');
    await page.focus('#assess-start');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'assess', 'Open, the focus goes back to Check');
    await page.evaluate(() => setFold('practice-panel', false));
    await page.setViewportSize({width: 1280, height: 900});
    page.off('request', watchRequests);
    assert.deepEqual(offSite, [], 'The check makes no request off the site');
    await page.evaluate(() => {
      storage.remove(KEYS.latency);
      storage.remove(KEYS.attempts);
      storage.remove(KEYS.checkMelody);
      applyCheckSettings();
    });
  }
  // Play-along checks as a student makes them: the melody off, and the speakers leaking into the microphone. The
  // check's clicks are noise, never heard as notes, so a silent student is heard as nothing and nothing is kept, and
  // one who comes in late is late, not wrong. Speed and Chords are off while a check runs, and a change that would
  // carry playback on leaves it alone. Notes after a fermata and through a D.C. al Fine are marked under their own
  // notes (here the melody plays and is heard), and a bass guitar's lowest notes are heard.
  {
    await page.evaluate(() => {
      storage.set(KEYS.latency, {ms: 40, at: Date.now()});
      navigator.mediaDevices.getUserMedia = async () => {
        audioContext();
        const loop = audio.createMediaStreamDestination(),
          leak = audio.createGain();
        leak.gain.value = window.__leak;
        outputNode().connect(leak);
        leak.connect(loop);
        window.__student = loop;
        return loop.stream;
      };
      // The student: a sawtooth for each note, from offsetMs after its time to just before its end.
      window.__play = offsetMs => {
        for (const e of check.expected) {
          const osc = audio.createOscillator(),
            gain = audio.createGain(),
            start = check.clock + e.time + offsetMs / 1000,
            stop = check.clock + e.end + offsetMs / 1000 - 0.03;
          osc.type = 'sawtooth';
          osc.frequency.value = 440 * 2 ** ((e.midis[0] - 69) / 12);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.3, start + 0.01);
          gain.gain.setValueAtTime(0.3, stop);
          gain.gain.linearRampToValueAtTime(0, stop + 0.02);
          osc.connect(gain).connect(__student);
          osc.start(start);
          osc.stop(stop + 0.03);
        }
      };
    });
    const startLeakyCheck = async (abc, {melody = false, instrument = 'Flute'} = {}) => {
      // With the melody on the speakers are the student, heard at full level.
      await page.evaluate(
        ({abc, melody, instrument}) => {
          window.__leak = melody ? 1 : 0.3;
          openScore({title: 'Leaky check', abc, instrument});
          $('metronome').checked = false;
          $('loop').checked = false;
          $('speed').value = 100;
          $('speed').oninput();
          if ($('assess-panel').hidden) toggleCheckPanel(true);
          $('assess-melody').checked = melody;
        },
        {abc, melody, instrument}
      );
      await page.click('#assess-start');
      await page.waitForFunction(() => check?.state === 'live', null, {timeout: 10000});
    };
    const leakyResult = async () => {
      await page.waitForFunction(() => !check, null, {timeout: 30000});
      return page.evaluate(() => ({
        status: $('assess-status').textContent,
        marks: lastCheck?.result.notes.map(n => n.mark),
        places: lastCheck?.places.map(p => p && `${p.measure}.${p.n}`),
        problems: lastCheck ? [...$('assess-problems').children].map(li => li.textContent) : [],
        kept: storedChecks(recordKey())
      }));
    };
    const head = 'X:1\nT:Leaky check\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n';
    await startLeakyCheck(head + 'A E A E | E A E A |]');
    assert.deepEqual(
      await page.evaluate(() => ['speed', 'speed-reset', 'chords', 'trainer'].map(id => $(id).disabled)),
      [true, true, true, true],
      'Speed, Chords and the trainer are off while a check runs'
    );
    await page.evaluate(() => {
      $('speed').value = 80;
      $('speed').oninput();
    });
    assert.deepEqual(
      await page.evaluate(() => [check?.state, playing]),
      ['live', true],
      'A change that would carry playback on leaves the check playing'
    );
    const silent = await leakyResult();
    assert.match(silent.status, /^FretFree heard nothing from the microphone/, 'The clicks are not heard as notes');
    assert.deepEqual(silent.kept, [], 'and nothing is kept');
    assert.equal(await page.evaluate(() => $('speed').disabled), false, 'Speed is back after the check');
    await startLeakyCheck(head + 'C D E F | G A B c |]');
    await page.evaluate(() => __play(250));
    const late = await leakyResult();
    assert.ok(
      late.marks.every(m => m === 'yellow'),
      `A student 250 ms late throughout is late on every note: ${JSON.stringify(late)}`
    );
    assert.match(late.problems[0], /^Measure 1, note 1: (1[5-9]\d|2\d\d) ms late$/);
    await startLeakyCheck(
      'X:1\nT:Leaky check\nM:4/4\nL:1/4\nQ:1/4=200\nK:C\nC D E HF | G A B c !fine!| d e f g !D.C.alfine!|]',
      {melody: true}
    );
    const road = await leakyResult();
    assert.deepEqual(
      road.places,
      '1.1 1.2 1.3 1.4 2.1 2.2 2.3 2.4 3.1 3.2 3.3 3.4 1.1 1.2 1.3 1.4 2.1 2.2 2.3 2.4'.split(' '),
      'After the fermata, and again after the D.C., each note is found in its own measure'
    );
    assert.ok(road.marks.filter(m => m === 'green').length >= 18, `Heard as played: ${road.marks}`);
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('#notation .assess-mark')].reduce((n, p) => n + +p.getAttribute('data-marks'), 0)
      ),
      20,
      'Every note is marked'
    );
    assert.deepEqual([road.kept.at(-1).from, road.kept.at(-1).to], [1, 3], 'The check went as far as measure 3');
    await startLeakyCheck(head.replace('120', '160') + 'E, A, E, A, | D, G, C2 |]', {
      melody: true,
      instrument: 'Bass guitar'
    });
    const bass = await leakyResult();
    assert.ok(
      bass.marks.filter(m => m === 'green').length >= 6 && !bass.problems.some(p => /not heard/.test(p)),
      `A bass guitar’s E and A strings (41 and 55 Hz) are heard: ${JSON.stringify(bass)}`
    );
    await page.evaluate(() => {
      storage.remove(KEYS.latency);
      storage.remove(KEYS.attempts);
      storage.remove(KEYS.checkMelody);
      applyCheckSettings();
      $('speed').value = 100;
      $('speed').oninput();
    });
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS: studio layout (every control shown at 1280 and 1440px, Mixer on the first playback row and in view on a phone, Keep bars full after Hear notes with the note-entry bar on one row at 1440px, the score high on the page, palette heading contrast, keyboard keys by keyboard and pointer and remembered, folds by touch, pointer and keyboard at phone width, remembered after a reload, in-use badges unlike the open look, warnings kept for screen readers while folded, phone touch sizes, the palette’s second tier behind More, skipped by arrow keys and More kept under the finger, Chord and Lyrics in view, the tab stop after an iPad turns, the bar check’s Show opening Write notes, iPad tab order and touch, print), Keep bars full (rests left by a shorter note, taken back by a longer one, a dot refused with the reason, Delete and Shift+Delete, the switch by keyboard and at phone width), screen-reader note names on click, arrow keys and edits, the shortcut sheet (?, search, Enter, click, focus trap, Escape, over the note menu, fits the window and a phone) and an accessible name on every studio button, dark theme (device setting, keyboard and pointer choice, Dark paper, contrast, print, SVG export, reload, phone width, applied before the first paint, tablet header, Dark paper tap size), embed code in a local HTML file (desktop and phone width, read-only, credits, no storage), QR codes (dense codes at 3px per module) and the long-link note, share panel tabs by keyboard, version history (keyboard and pointer, preview, play, stopping on leaving My scores, restore, save, phone width), zoom and measures per line (clicks, drags and drawing at 70% and 200%, announcements, long titles and SVG export at 200%, reflow, guitar tab after reflow, reload, phone width), unsaved-work recovery, backup and restore, blank sheets and draw-on-rest, new score templates (keyboard panel, piano staves, left-hand typing, add bars to every staff, guitar tab caption and drawing on the left hand, phone width), try-next suggestions and played marks, skill filter chips, library card previews, native mouse clicks and upward drags across instruments, drag ratio, playback note highlight, road-map playback (the highlight and status line through a D.C. al Fine, from Play and from a note with Space), draw mode, note properties menu (written-pitch accidentals, chords, broken rhythm, implicit L:), sustained highlights, practice ranges, gapless loops, speed trainer, metronome, bar check, undo/redo, keyboard note entry, slur- and tuplet-start edits, range selection with copy, cut, paste and duplicate, notation palette (state, pointer, keyboard, phone width), articulation keys, dynamics, More marks and note-menu marks, measure tools (keyboard and pointer, inserted bars typed over, engraved repeats, endings and rehearsal marks, key changes by keyboard, phone width), slurs, hairpins and trill lines (Shift+click and S, Cresc., one note to the next, Lines from the keyboard, undo, the drawn trill line), tuplets and grace notes (T and letters filling and beaming the rests, staccato on and off and Delete in a triplet, the Tuplet menu by pointer, Grace, Grace ↑ and Slashed by pointer and keyboard, undo), chord symbols (K, Enter, Tab, undo, the toolbar button by keyboard, removal, click away, Chords in playback, phone width), lyrics (L, a verse typed with hyphens, Enter for the next verse with the box under it, undo, the toolbar button by keyboard, click away, a verse typed past the last note then Enter, phone width), writing prompts, teacher-written assignment links (keyboard builder, student copy, print), turning in by tap and keyboard and the Submissions inbox (paste, bad lines, Previous/Next, feedback return link, phone width), play from a note, note names, classroom colors and letters in noteheads (keyboard, selection, print, SVG export, persistence, written pitch), guitar tab, recorder fingering, transposing selected measures and to a key, key changes with Keep notes, focus and undo, drawing in a respelled written key, concert pitch view (keyboard and pointer, drawing and typing in concert pitch, closing the note menu), measure playback, live percent speed, master volume bus and limiter, live volume, the mixer (keyboard and pointer, Mute at once, live Volume and Pan through a StereoPannerNode, unmuting during playback, Reset, Escape, phone width), play-along checks (by keyboard, the melody off at first, the score heard back through a loopback with the melody on marked green while it plays on and labeled, Pitch and Rhythm shown, a steady wrong note all red with its words, marks out of SVG export and print, phone width, Escape, no off-site requests, the speakers leaking into the microphone with the melody off: a silent student heard as nothing and a late one as late, Speed and Chords off while a check runs, notes after a fermata and through a D.C. al Fine marked in their own measures, a bass guitar’s lowest notes heard), note audition (click, letters, note buttons, arrows, draw, off, quiet during playback), instrument sounds (a periodic wave per instrument, distinct waveforms, plucked notes fading and held notes holding in offline renders, violin vibrato, the library filter list, Listen in the filtered instrument’s wave and octave, opening in the filtered instrument), WAV export (keyboard and pointer, a real download as long as playback at the chosen speed, 16-bit stereo at 44.1 kHz, sound from the first note, scaling, INFO credits, metronome, a summary that follows the Speed slider and the Instrument menu, the same file with progress checkpoints, Escape, a progress bar on a long score and closing the panel stopping its render at once, phone width), on-screen piano (taps, Shift+click and held-key chords, keyboard, lights, print, mobile, touch swipes and taps, range after reload), MIDI keyboard entry (mocked input, timing, chords, lights, keyboard toggle, refusal, no Web MIDI, phone width), Z respelling, recording yourself (calibration by keyboard, a take lined up with the score within 50 ms, one pass with Loop on, not out of reach in another tab, kept with the score through a save and a reload, playing with the score, download, delete by keyboard, Escape, phone width, no off-site requests), offline use (library, an opened score and its PDF, editing and playback with the server gone; a deploy cut short leaving the last complete copy; a new deploy after one reload; old assets dropped; a corrected PDF online and offline; installability; Install app by keyboard at phone width; the header at iPad and laptop widths; no off-site requests), legacy storage, mobile width, MusicXML export by keyboard, opening a MusicXML .mxl by keyboard at phone width, and no browser errors.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
