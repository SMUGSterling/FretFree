'use strict';
// Teacher-written assignments: the builder turns the open score into an assignment (title, instructions and goals).
// The score on the page is the students' starting point, and a share link hands each student their own copy with the
// instructions and a live checklist. makeAssignment and validPrompt in score-tools.js build and check the object.

// What the builder takes from the open score: written key and mode, meter, note unit, tempo, the number of bars, and
// whether every bar is a full bar of the meter (the bars goal can be met only then; a pickup, for one, never is).
function assignmentBasis() {
  const written = writtenABC(instrumentShift()),
    tune = ABCJS.parseOnly(written)[0],
    // The key as K:Am or K:A minor. A word after the key note that is not a mode (a clef, say) leaves it major.
    k = written.match(/^K:[ \t]*([A-G][#b]?)[ \t]*([A-Za-z]*)/m),
    mode = {m: 'm', min: 'm', aeo: 'm', dor: 'dor', phr: 'phr', lyd: 'lyd', mix: 'mix', loc: 'loc'}[
      k?.[2].toLowerCase().slice(0, 3)
    ],
    key = k ? k[1] + (mode || '') : 'C',
    m = field('M', '4/4').replace(/^C\|$/, '2/2').replace(/^C$/, '4/4'),
    meter = /^[1-9]\d?\/[1-9]\d?$/.test(m) ? m : '4/4',
    [n, d] = meter.split('/').map(Number),
    l = field('L'),
    tempo = +(field('Q').match(/(\d+)\s*$/)?.[1] || 100),
    bars = melodyBars(tune);
  return {
    key,
    meter,
    // ABC's default unit when L: is missing: an eighth, or a sixteenth for meters under 3/4.
    unit: /^1\/[1-9]\d?$/.test(l) ? l : n / d < 0.75 ? '1/16' : '1/8',
    tempo: Math.max(20, Math.min(400, tempo)),
    bars: Math.max(1, Math.min(999, bars.length)),
    fullBars: bars.length >= 1 && bars.length <= 999 && bars.every(b => fullMeterBar(b, n / d)),
    scale: keyScale(key).scale
  };
}
// One row per goal type: a checkbox with the goal in plain words, then the inputs that set it.
const ASSIGNMENT_GOALS = [
  {type: 'bars', lead: '<span id="goal-bars-name"></span>', controls: ''},
  {
    type: 'lengths',
    lead: 'Use only these lengths:',
    controls: `<span class="goal-lengths" role="group" aria-label="Allowed note lengths">${GOAL_LENGTHS.map(([v, w]) => `<label class="inline"><input type="checkbox" data-length="${v}" /> ${w}</label>`).join('')}</span>`
  },
  {type: 'start', lead: 'Start on', controls: '<select id="goal-start-degree" aria-label="First note"></select>'},
  {type: 'end', lead: 'End on', controls: '<select id="goal-end-degree" aria-label="Last note"></select>'},
  {
    type: 'endBar',
    lead: 'End a bar on a note:',
    controls:
      'bar <input id="goal-endBar-bar" type="number" min="1" value="1" aria-label="Bar number" /> ends on <select id="goal-endBar-degree" aria-label="Note that ends the bar"></select>'
  },
  {type: 'steps', lead: 'Move only by step or repeat a note', controls: ''},
  {
    type: 'range',
    lead: 'Stay within',
    controls: `<select id="goal-range-max" aria-label="Widest range">${GOAL_RANGES.map(([v, w]) => `<option value="${v}">${w}</option>`).join('')}</select>`
  },
  {type: 'inKey', lead: 'Stay in <span id="goal-inKey-name"></span>', controls: ''},
  {
    type: 'atLeast',
    lead: 'Use at least',
    controls: `<input id="goal-atLeast-count" type="number" min="1" max="64" value="2" aria-label="How many" /> <select id="goal-atLeast-kind" aria-label="Of what">${Object.entries(
      GOAL_KINDS
    )
      .map(([k, [, many]]) => `<option value="${k}">${many}</option>`)
      .join('')}</select>`
  }
];
$('assignment-goals').innerHTML = ASSIGNMENT_GOALS.map(
  g =>
    `<div class="goal-row"><label class="inline"><input type="checkbox" id="goal-${g.type}" data-goal="${g.type}" /><span>${g.lead}</span></label>${g.controls ? ` <span class="goal-controls">${g.controls}</span>` : ''}</div>`
).join('');
const goalBox = type => $('goal-' + type);
const pickGoalOption = (id, value) => {
  if ([...$(id).options].some(o => +o.value === value)) $(id).value = value;
};
// The parts of the builder that come from the score: the basis line, note names in the written key, the bar count and
// which goals can be checked. Redrawn while the builder is open, so what it shows is what it will store. A note choice
// is a number of semitones above the key note, so it keeps its place when the key or the instrument changes.
let assignmentKeyShown = null;
function showAssignmentBasis() {
  const basis = assignmentBasis();
  $('assignment-basis').textContent =
    `From the score: ${basis.bars} bar${basis.bars === 1 ? '' : 's'} · ${basis.meter} · key of ${keyInWords(basis.key)} (written)`;
  if (assignmentKeyShown !== basis.key) {
    assignmentKeyShown = basis.key;
    const degrees = keyDegrees(basis.key);
    for (const id of ['goal-start-degree', 'goal-end-degree', 'goal-endBar-degree']) {
      const chosen = +$(id).value;
      $(id).innerHTML = degrees
        .map(d => `<option value="${d.degree}">${esc(d.name)}${d.degree === 0 ? ' (home note)' : ''}</option>`)
        .join('');
      pickGoalOption(id, chosen);
    }
  }
  $('goal-bars-name').textContent =
    goalLabel({type: 'bars'}, basis) +
    (basis.fullBars ? '' : ` (only scores whose bars are all full bars of ${basis.meter} can be checked)`);
  $('goal-inKey-name').textContent = basis.scale
    ? `${keyDegrees(basis.key)[0].name} ${basis.scale}`
    : `${keyInWords(basis.key)} (only major and minor keys can be checked)`;
  for (const [type, can] of [
    ['bars', basis.fullBars],
    ['inKey', !!basis.scale]
  ]) {
    goalBox(type).disabled = !can;
    if (!can) goalBox(type).checked = false;
  }
  $('goal-endBar-bar').max = basis.bars;
  return basis;
}
// Kept in step with the score while the builder is open: edits, undo and instrument changes all render.
function updateAssignmentBuilder() {
  if (!$('assignment-builder').hidden) showAssignmentBasis();
}
// Fill the builder from the score, and from its current prompt when it has one (a built-in prompt can be adapted).
function fillAssignmentBuilder() {
  const prompt = activePrompt(),
    goals = new Map((prompt?.goals || []).map(g => [g.type, g]));
  assignmentKeyShown = null;
  const basis = showAssignmentBasis();
  $('assignment-title').value = prompt?.title || field('T', 'Untitled');
  $('assignment-text').value = prompt?.text || '';
  // A built-in prompt's "use this note" goal has no row here, so it is left out rather than shown as something else.
  if (goals.get('atLeast')?.kind === 'degree') goals.delete('atLeast');
  const defaults = prompt ? new Set(goals.keys()) : new Set(['bars', 'end', 'inKey']);
  for (const {type} of ASSIGNMENT_GOALS) goalBox(type).checked = defaults.has(type) && !goalBox(type).disabled;
  const allowed = goals.get('lengths')?.allowed || [0.25, 0.5];
  for (const box of document.querySelectorAll('#assignment-goals [data-length]'))
    box.checked = allowed.includes(+box.dataset.length);
  pickGoalOption('goal-start-degree', goals.get('start')?.degree ?? 0);
  pickGoalOption('goal-end-degree', goals.get('end')?.degree ?? 0);
  pickGoalOption('goal-endBar-degree', goals.get('endBar')?.degree ?? 7);
  $('goal-endBar-bar').value = Math.min(
    basis.bars,
    goals.get('endBar')?.bar || Math.max(1, Math.floor(basis.bars / 2))
  );
  pickGoalOption('goal-range-max', goals.get('range')?.max ?? 12);
  const atLeast = goals.get('atLeast');
  if (Object.hasOwn(GOAL_KINDS, atLeast?.kind || '')) $('goal-atLeast-kind').value = atLeast.kind;
  $('goal-atLeast-count').value = atLeast?.count || 2;
  $('assignment-remove').hidden = prompt?.level !== 'Custom';
  $('assignment-status').textContent = '';
}
// Read the builder into an assignment, or explain what is missing and return null.
function readAssignmentBuilder() {
  const basis = assignmentBasis(),
    checked = type => goalBox(type).checked && !goalBox(type).disabled,
    title = $('assignment-title').value.trim(),
    text = $('assignment-text').value.trim(),
    goals = [];
  const fail = (message, focus) => {
    $('assignment-status').textContent = message;
    $(focus).focus();
    return null;
  };
  if (!title) return fail('Give the assignment a title.', 'assignment-title');
  if (text.length > ASSIGNMENT_TEXT_MAX)
    return fail(`Keep the instructions under ${ASSIGNMENT_TEXT_MAX.toLocaleString()} characters.`, 'assignment-text');
  for (const {type} of ASSIGNMENT_GOALS) {
    if (!checked(type)) continue;
    if (type === 'lengths') {
      const allowed = [...document.querySelectorAll('#assignment-goals [data-length]:checked')].map(
        b => +b.dataset.length
      );
      if (!allowed.length) return fail('Pick at least one note length, or untick that goal.', 'goal-lengths');
      goals.push({type, allowed});
    } else if (type === 'start' || type === 'end') goals.push({type, degree: +$(`goal-${type}-degree`).value});
    else if (type === 'endBar') {
      const bar = Math.round(+$('goal-endBar-bar').value);
      if (!(bar >= 1 && bar <= basis.bars))
        return fail(`Pick a bar from 1 to ${basis.bars} for the bar-ending goal.`, 'goal-endBar-bar');
      goals.push({type, bar, degree: +$('goal-endBar-degree').value});
    } else if (type === 'range') goals.push({type, max: +$('goal-range-max').value});
    else if (type === 'inKey') goals.push({type, scale: basis.scale});
    else if (type === 'atLeast') {
      const count = Math.round(+$('goal-atLeast-count').value);
      if (!(count >= 1 && count <= 64)) return fail('Pick a count from 1 to 64.', 'goal-atLeast-count');
      goals.push({type, kind: $('goal-atLeast-kind').value, count});
    } else goals.push({type});
  }
  if (!text && !goals.length) return fail('Write instructions or pick at least one goal.', 'assignment-text');
  const prompt = validPrompt(
    makeAssignment({
      title,
      text,
      meter: basis.meter,
      unit: basis.unit,
      key: basis.key,
      tempo: basis.tempo,
      bars: basis.bars,
      goals
    })
  );
  return prompt || fail('This assignment could not be made. Check the title and goals.', 'assignment-title');
}
// Attach (or remove) the assignment. It is part of the score record, so it counts as an unsaved change until saved.
function setAssignment(prompt) {
  if (!current) return;
  flushTyping();
  // Copy, so a library score's own catalog entry is never changed.
  current = {...current, prompt};
  if (!prompt) delete current.prompt;
  dirty = true;
  cleanKey = '';
  $('save-status').textContent = 'Unsaved changes';
  render();
}
function toggleAssignmentBuilder(open) {
  $('assignment-builder').hidden = !open;
  $('open-assignment').setAttribute('aria-expanded', open);
  if (open) {
    togglePrompts(false);
    fillAssignmentBuilder();
    $('assignment-builder').scrollIntoView({block: 'nearest', behavior: 'smooth'});
    $('assignment-title').focus({preventScroll: true});
  }
}
$('open-assignment').onclick = () => toggleAssignmentBuilder($('assignment-builder').hidden);
$('close-assignment').onclick = () => {
  toggleAssignmentBuilder(false);
  $('open-assignment').focus();
};
$('assignment-builder').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  toggleAssignmentBuilder(false);
  $('open-assignment').focus();
});
// Changing a goal's setting ticks that goal.
$('assignment-goals').addEventListener('input', e => {
  const row = e.target.closest('.goal-row'),
    box = row?.querySelector('[data-goal]');
  if (box && e.target !== box && !box.disabled) box.checked = true;
});
function useAssignment(share) {
  const prompt = readAssignmentBuilder();
  if (!prompt) return;
  setAssignment(prompt);
  toggleAssignmentBuilder(false);
  // Focus goes back to the button; shareLink moves it to the link itself when it could not copy it.
  $('open-assignment').focus();
  if (share) shareLink().catch(e => toast('Could not make a link: ' + e.message));
  else toast('Assignment added. Share link hands it out; Save keeps it here.');
}
$('assignment-form').addEventListener('submit', e => {
  e.preventDefault();
  useAssignment(true);
});
$('assignment-apply').onclick = () => useAssignment(false);
$('assignment-remove').onclick = () => {
  setAssignment(undefined);
  toggleAssignmentBuilder(false);
  $('open-assignment').focus();
  toast('Assignment removed from this score.');
};
