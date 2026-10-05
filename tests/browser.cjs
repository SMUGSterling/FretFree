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
  await page
    .locator('#notation .abcjs-notehead')
    .nth(9)
    .click({force: true, modifiers: ['Shift']});
  assert.deepEqual(
    await page.evaluate(() => [$('start-measure').value, $('end-measure').value]),
    ['2', '3'],
    'Shift+click sets the loop end'
  );
  assert.equal(await page.locator('#notation .range-shade').count(), 1, 'Practice range is shaded');
  await page.evaluate(() => {
    $('speed').value = 50;
    $('speed').oninput();
    $('trainer-step').value = '10';
  });
  await page.check('#trainer');
  await page.check('#metronome');
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
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Mobile page fits viewport'
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS: try-next suggestions and played marks, skill filter chips, library card previews, native mouse clicks and upward drags across instruments, drag ratio, playback note highlight, draw mode, note properties menu (written-pitch accidentals, chords, broken rhythm, implicit L:), sustained highlights, practice ranges, gapless loops, speed trainer, metronome, bar check, undo/redo, keyboard note entry, writing prompts, play from a note, note names, guitar tab, recorder fingering, measure playback, live percent speed, legacy storage, mobile width, and no browser errors.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
