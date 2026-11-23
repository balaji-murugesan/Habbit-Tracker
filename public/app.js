import { HABIT_ICONS, UI_ICONS, COLORS } from './icons.js';
import { createStatsView } from './stats.js';

// ---------- date helpers (local calendar dates as YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const weekStart = (k) => { const d = fromKey(k); return addDays(k, -((d.getDay() + 6) % 7)); };
const todayKey = () => toKey(new Date());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const prettyDate = (k) => { const d = fromKey(k); return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`; };

// ---------- state ----------
const state = {
  today: todayKey(),
  selected: todayKey(),
  weekOf: weekStart(todayKey()),
  filter: 'all',
  habits: [],
  summary: null,
  editing: null,     // habit being edited (null = new)
  noteHabit: null,
  view: location.hash === '#stats' ? 'stats' : 'habits',
};

// ---------- api ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const desktopMQ = window.matchMedia('(min-width: 1000px)');
const isDesktop = () => desktopMQ.matches;
// On desktop the heatmap fills the row next to the habit info, so fit as many weeks as there's room for.
function weeksToShow() {
  if (!isDesktop()) return window.innerWidth >= 760 ? 30 : 23;
  const listW = document.querySelector('#list')?.clientWidth || 800;
  const heatW = listW - 2 * 22 - 300 - 34; // card padding, info column, weekday labels
  return Math.max(12, Math.min(53, Math.floor((heatW + 4) / 18)));
}

async function refresh() {
  state.today = todayKey();
  const qs = `today=${state.today}`;
  const [h, s] = await Promise.all([
    api('GET', `api/habits?${qs}&date=${state.selected}&weeks=${weeksToShow()}`),
    api('GET', `api/summary?${qs}&weekOf=${state.weekOf}`),
  ]);
  state.habits = h.habits;
  state.summary = s;
  render();
  if (state.view === 'stats') await stats.load();
}

// ---------- rendering ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, html = '') => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderTitle() {
  const isToday = state.selected === state.today;
  const main = isToday ? 'Today,' : addDays(state.today, -1) === state.selected ? 'Yesterday,' : `${LONG_DAYS[fromKey(state.selected).getDay()]},`;
  $('#title .t-main').textContent = main;
  $('#title .t-sub').textContent = prettyDate(state.selected);
  document.title = `Habit Tracker — ${main.replace(',', '')} ${prettyDate(state.selected)}`;
}

function ring(progress) {
  const r = 22, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 50 50"><circle class="track" cx="25" cy="25" r="${r}" stroke-width="4.5" fill="none"/>
    <circle class="bar" cx="25" cy="25" r="${r}" stroke-width="4.5" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}" ${progress === 0 ? 'opacity="0"' : ''}/></svg>`;
}

function renderWeek() {
  const wrap = $('#week-days');
  wrap.innerHTML = '';
  const days = state.summary?.days || [];
  days.forEach((d, i) => {
    const btn = el('button', {
      class: `day${d.date === state.selected ? ' selected' : ''}${d.future ? ' future' : ''}`,
      'aria-label': `${DAYS[i]} ${prettyDate(d.date)}, ${Math.round(d.progress * 100)}% done`,
      onclick: () => selectDate(d.date),
    });
    btn.innerHTML = `<span class="dname">${DAYS[i]}</span>
      <span class="ring">${ring(d.progress)}<span class="num">${fromKey(d.date).getDate()}</span></span>`;
    wrap.append(btn);
  });
  $('#week-next').disabled = state.weekOf >= weekStart(state.today);
  $('#week-next').style.visibility = $('#week-next').disabled ? 'hidden' : 'visible';
}

function renderToolbar() {
  const due = state.habits.filter((h) => h.due).length;
  const [allBtn, dueBtn] = document.querySelectorAll('.seg button');
  allBtn.textContent = `All (${state.habits.length})`;
  dueBtn.textContent = `Due (${due})`;
  allBtn.classList.toggle('active', state.filter === 'all');
  dueBtn.classList.toggle('active', state.filter === 'due');
  const score = state.summary?.score;
  $('#score .val').textContent = score == null ? '–' : `${(score * 100).toFixed(1)}%`;
}

function streakText(h) {
  return `Streak: ${h.streak} ${h.streakUnit}`;
}

function renderCard(h) {
  const card = el('article', { class: 'card', style: `--c:${h.color}`, 'data-id': h.id });
  const head = el('div', { class: 'card-head' });
  head.append(
    el('button', { class: 'h-icon', title: 'Edit habit', 'aria-label': `Edit ${h.name}`, onclick: () => openHabitDialog(h) },
      HABIT_ICONS[h.icon] || HABIT_ICONS.check),
    el('div', { class: 'h-text' },
      `<p class="h-name">${esc(h.name)}</p><div class="h-streak">${streakText(h)}${h.frequency === 'weekly' ? ` · ${h.target_per_week}×/week` : ''}${h.reminder_time ? ` <span class="h-bell" title="Reminder at ${h.reminder_time}">${UI_ICONS.bell}${h.reminder_time}</span>` : ''}</div>`),
  );
  const actions = el('div', { class: 'h-actions' });
  actions.append(
    el('button', {
      class: `h-btn note${h.hasNote ? ' has' : ''}`, title: h.hasNote ? 'Edit note' : 'Add note',
      'aria-label': `Note for ${h.name}`, onclick: () => openNoteDialog(h),
    }, h.hasNote ? UI_ICONS.noteFilled : UI_ICONS.note),
    el('button', {
      class: `h-btn check${h.done ? ' done' : ''}`, title: h.done ? 'Mark not done' : 'Mark done',
      'aria-pressed': h.done ? 'true' : 'false', 'aria-label': `Toggle ${h.name}`,
      onclick: () => toggle(h, state.selected, !h.done),
    }, UI_ICONS.check),
  );
  head.append(actions);
  const idx = state.habits.indexOf(h);
  if (idx >= 0 && idx < 9) head.append(el('span', { class: 'h-key', title: `Press ${idx + 1} to toggle` }, String(idx + 1)));

  const heat = el('div', { class: 'heat', style: `grid-template-columns: repeat(${h.heatmap.length}, minmax(12px, 1fr))` });
  for (const col of h.heatmap) {
    for (const c of col) {
      const cls = ['cell'];
      if (c.done) cls.push('done');
      if (c.future) cls.push('future');
      else if (c.beforeStart && !c.done) cls.push('pre');
      if (c.date === state.selected) cls.push('sel');
      if (c.note) cls.push('note');
      heat.append(el('button', {
        class: cls.join(' '),
        title: `${prettyDate(c.date)} ${c.date.slice(0, 4)}${c.done ? ' ✓' : ''}`,
        disabled: c.future,
        onclick: () => toggle(h, c.date, !c.done),
        oncontextmenu: (e) => { e.preventDefault(); selectDate(c.date); },
      }));
    }
  }
  // Month labels (desktop): show the month name above the first week that starts in it.
  const months = el('div', { class: 'heat-months', style: heat.style.cssText });
  let lastMonth = '';
  let lastLabelAt = -9;
  h.heatmap.forEach((col, i) => {
    const m = col[0].date.slice(5, 7);
    // Label a month at its first week, unless the previous label is too close to fit.
    const show = m !== lastMonth && i - lastLabelAt >= 3;
    lastMonth = m;
    if (show) lastLabelAt = i;
    months.append(el('span', {}, show ? MONTHS[Number(m) - 1] : ''));
  });
  const wd = el('div', { class: 'heat-days' }, '<span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span>');
  const wrap = el('div', { class: 'heat-wrap' });
  const inner = el('div', { class: 'heat-inner' });
  inner.append(months, heat);
  wrap.append(wd, inner);
  card.append(head, wrap);
  return card;
}

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  const items = state.filter === 'due' ? state.habits.filter((h) => h.due) : state.habits;
  items.forEach((h) => list.append(renderCard(h)));
  list.querySelectorAll('.heat').forEach((g) => { g.scrollLeft = g.scrollWidth; });
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  if (!items.length) {
    empty.innerHTML = state.habits.length
      ? '<p>All done for this day 🎉</p><p class="muted">Nothing left in the Due list.</p>'
      : '<p>No habits yet.</p><p class="muted">Tap <b>+</b> to create your first habit.</p>';
  }
}

function renderDayPanel() {
  const p = $('#daypanel');
  if (!p) return;
  const total = state.habits.length;
  const done = state.habits.filter((h) => h.done).length;
  const ratio = total ? done / total : 0;
  const r = 52, c = 2 * Math.PI * r;
  const d = fromKey(state.selected);
  const isToday = state.selected === state.today;
  const notes = state.habits.filter((h) => h.noteText);
  p.innerHTML = `
    <div class="dp-card">
      <div class="dp-date">${isToday ? 'Today' : LONG_DAYS[d.getDay()]}<span>${prettyDate(state.selected)} ${d.getFullYear()}</span></div>
      <div class="dp-ring">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="track" stroke-width="10" fill="none"/>
          <circle cx="60" cy="60" r="${r}" class="bar" stroke-width="10" fill="none" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - ratio)}" ${ratio === 0 ? 'opacity="0"' : ''}/></svg>
        <div class="dp-ring-txt"><b>${Math.round(ratio * 100)}%</b><span>${done} of ${total} done</span></div>
      </div>
    </div>
    <div class="dp-card">
      <h3>Checklist</h3>
      <div class="dp-list"></div>
    </div>
    <div class="dp-card">
      <h3>Notes</h3>
      <div class="dp-notes">${notes.length ? '' : '<p class="muted small">No notes for this day. Use the note button on a habit to add one.</p>'}</div>
    </div>`;
  const list = p.querySelector('.dp-list');
  if (!total) list.innerHTML = '<p class="muted small">No habits yet.</p>';
  state.habits.forEach((h) => {
    const row = el('button', {
      class: `dp-item${h.done ? ' done' : ''}`, style: `--c:${h.color}`,
      'aria-pressed': h.done ? 'true' : 'false', onclick: () => toggle(h, state.selected, !h.done),
    }, `<span class="dp-box">${UI_ICONS.check}</span><span class="dp-name">${esc(h.name)}</span>${h.due && !h.done ? '<span class="dp-due">due</span>' : ''}`);
    list.append(row);
  });
  const nl = p.querySelector('.dp-notes');
  notes.forEach((h) => {
    nl.append(el('button', { class: 'dp-note', style: `--c:${h.color}`, onclick: () => openNoteDialog(h) },
      `<b>${esc(h.name)}</b><span>${esc(h.noteText)}</span>`));
  });
}

function render() {
  if (state.view === 'habits') renderTitle();
  renderWeek();
  renderToolbar();
  renderList();
  renderDayPanel();
}

// ---------- actions ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function guard(fn) {
  try { await fn(); } catch (e) { toast(e.message || 'Something went wrong'); }
}

function selectDate(k) {
  if (k > state.today) return;
  state.selected = k;
  state.weekOf = weekStart(k);
  guard(refresh);
}

function toggle(h, date, done) {
  guard(async () => {
    await api(done ? 'PUT' : 'DELETE', `api/habits/${h.id}/completions/${date}`);
    await refresh();
  });
}

// Habit dialog
const dlgHabit = $('#dlg-habit');
const formHabit = $('#form-habit');
let pick = { icon: 'check', color: COLORS[0] };

function renderPickers() {
  const ip = $('#icon-picker');
  ip.innerHTML = '';
  ip.style.setProperty('--pick', pick.color);
  for (const [name, svg] of Object.entries(HABIT_ICONS)) {
    ip.append(el('button', {
      type: 'button', class: name === pick.icon ? 'sel' : '', title: name, 'aria-label': name,
      onclick: () => { pick.icon = name; renderPickers(); },
    }, svg));
  }
  const cp = $('#color-picker');
  cp.innerHTML = '';
  for (const c of COLORS) {
    cp.append(el('button', {
      type: 'button', class: c === pick.color ? 'sel' : '', style: `background:${c}`, 'aria-label': `Color ${c}`,
      onclick: () => { pick.color = c; renderPickers(); },
    }));
  }
}

function syncTargetField() {
  $('.target-field').style.display = formHabit.frequency.value === 'weekly' ? '' : 'none';
}

function openHabitDialog(h = null) {
  state.editing = h;
  $('#habit-dlg-title').textContent = h ? 'Edit habit' : 'New habit';
  formHabit.name.value = h?.name || '';
  formHabit.frequency.value = h?.frequency || 'daily';
  formHabit.target_per_week.value = h?.target_per_week || 3;
  pick = { icon: h?.icon || 'check', color: h?.color || COLORS[state.habits.length % COLORS.length] };
  $('#btn-delete').hidden = !h;
  formHabit.reminder_on.checked = !!h?.reminder_time;
  formHabit.reminder_time.value = h?.reminder_time || '20:00';
  pickDays = (h?.reminder_days || '1111111').split('');
  renderPickers();
  renderDayChips();
  syncTargetField();
  syncReminder();
  dlgHabit.showModal();
  formHabit.name.focus();
}

formHabit.frequency.addEventListener('change', syncTargetField);

let pickDays = '1111111'.split('');
function renderDayChips() {
  const wrap = $('#day-chips');
  wrap.innerHTML = '';
  DAYS.forEach((d, i) => {
    wrap.append(el('button', {
      type: 'button', class: pickDays[i] === '1' ? 'sel' : '', 'aria-pressed': pickDays[i] === '1' ? 'true' : 'false',
      onclick: () => { pickDays[i] = pickDays[i] === '1' ? '0' : '1'; renderDayChips(); },
    }, d[0]));
  });
}
function syncReminder() {
  const on = formHabit.reminder_on.checked;
  $('#reminder-opts').hidden = !on;
  $('#reminder-hint').hidden = !on || pushState.subscribed;
}
formHabit.reminder_on.addEventListener('change', syncReminder);

formHabit.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = {
    name: formHabit.name.value,
    frequency: formHabit.frequency.value,
    target_per_week: Number(formHabit.target_per_week.value),
    icon: pick.icon,
    color: pick.color,
    reminder_time: formHabit.reminder_on.checked ? formHabit.reminder_time.value : null,
    reminder_days: pickDays.join(''),
  };
  guard(async () => {
    if (state.editing) await api('PUT', `api/habits/${state.editing.id}`, body);
    else await api('POST', 'api/habits', { ...body, created_at: state.today });
    dlgHabit.close();
    await refresh();
    toast(state.editing ? 'Habit updated' : 'Habit created');
  });
});

$('#btn-delete').addEventListener('click', () => {
  const h = state.editing;
  if (!h || !confirm(`Delete "${h.name}" and all its history?`)) return;
  guard(async () => {
    await api('DELETE', `api/habits/${h.id}`);
    dlgHabit.close();
    await refresh();
    toast('Habit deleted');
  });
});

// Note dialog
const dlgNote = $('#dlg-note');
const formNote = $('#form-note');

function openNoteDialog(h) {
  state.noteHabit = h;
  $('#note-title').textContent = h.name;
  $('#note-sub').textContent = `Note for ${LONG_DAYS[fromKey(state.selected).getDay()]}, ${prettyDate(state.selected)}`;
  formNote.text.value = '';
  guard(async () => {
    const n = await api('GET', `api/habits/${h.id}/notes/${state.selected}`);
    formNote.text.value = n.text;
    dlgNote.showModal();
    formNote.text.focus();
  });
}

formNote.addEventListener('submit', (e) => {
  e.preventDefault();
  const h = state.noteHabit;
  guard(async () => {
    await api('PUT', `api/habits/${h.id}/notes/${state.selected}`, { text: formNote.text.value });
    dlgNote.close();
    await refresh();
    toast('Note saved');
  });
});

// Settings
const dlgSettings = $('#dlg-settings');
$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Replace all current data with this backup?')) { e.target.value = ''; return; }
  guard(async () => {
    const data = JSON.parse(await file.text());
    await api('POST', 'api/import', data);
    e.target.value = '';
    dlgSettings.close();
    await refresh();
    toast('Backup imported');
  });
});

// Close buttons + click outside
document.querySelectorAll('dialog').forEach((d) => {
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
});

// ---------- static UI wiring ----------
$('#btn-settings').innerHTML = UI_ICONS.gear;
$('#btn-today').innerHTML = UI_ICONS.today;
$('#week-prev').innerHTML = UI_ICONS.chevL;
$('#week-next').innerHTML = UI_ICONS.chevR;
$('#score .ico').innerHTML = UI_ICONS.gauge;
$('#fab').innerHTML = UI_ICONS.plus;
$('#bb-habits').innerHTML = UI_ICONS.grid;
$('#bb-stats').innerHTML = UI_ICONS.stats;
$('#nav-habits .si').innerHTML = UI_ICONS.grid;
$('#nav-stats .si').innerHTML = UI_ICONS.stats;
$('#nav-new .si').innerHTML = UI_ICONS.plus;
$('#nav-settings .si').innerHTML = UI_ICONS.gear;
$('.brand-logo').innerHTML = UI_ICONS.check;
document.querySelectorAll('.icon-btn[data-close]').forEach((b) => { b.innerHTML = UI_ICONS.close; });

const goToday = () => { if (state.view !== 'habits') setView('habits'); selectDate(todayKey()); };
$('#btn-today').addEventListener('click', goToday);
$('#bb-habits').addEventListener('click', () => {
  if (state.view === 'habits') window.scrollTo({ top: 0, behavior: 'smooth' });
  else setView('habits');
});
$('#bb-stats').addEventListener('click', () => setView('stats'));
$('#nav-habits').addEventListener('click', () => setView('habits'));
$('#nav-stats').addEventListener('click', () => setView('stats'));
$('#nav-new').addEventListener('click', () => openHabitDialog());
$('#nav-settings').addEventListener('click', () => { updatePushUI(); dlgSettings.showModal(); });
$('#btn-settings').addEventListener('click', () => { updatePushUI(); dlgSettings.showModal(); });
$('#fab').addEventListener('click', () => openHabitDialog());
$('#week-prev').addEventListener('click', () => { state.weekOf = addDays(state.weekOf, -7); guard(refresh); });
$('#week-next').addEventListener('click', () => {
  if (state.weekOf >= weekStart(state.today)) return;
  state.weekOf = addDays(state.weekOf, 7);
  guard(refresh);
});
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  renderToolbar();
  renderList();
}));

// Refresh when the tab regains focus (e.g. after midnight) and on resize breakpoint change.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const wasToday = state.selected === state.today;
  if (wasToday && todayKey() !== state.today) { state.selected = todayKey(); state.weekOf = weekStart(state.selected); }
  guard(refresh);
});
let lastWeeks = weeksToShow();
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (weeksToShow() !== lastWeeks) { lastWeeks = weeksToShow(); guard(refresh); }
  }, 200);
});

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (k === 'n' || k === 'N') { e.preventDefault(); openHabitDialog(); }
  else if (k === 't' || k === 'T') { goToday(); }
  else if (k === 's' || k === 'S') { setView(state.view === 'stats' ? 'habits' : 'stats'); }
  else if (state.view === 'habits' && k === 'ArrowLeft') { e.preventDefault(); selectDate(addDays(state.selected, -1)); }
  else if (state.view === 'habits' && k === 'ArrowRight') {
    e.preventDefault();
    if (state.selected < state.today) selectDate(addDays(state.selected, 1));
  } else if (state.view === 'habits' && /^[1-9]$/.test(k)) {
    const h = state.habits[Number(k) - 1];
    if (h) toggle(h, state.selected, !h.done);
  }
});

// ---------- PWA: service worker, install, push ----------
const pushState = { supported: false, subscribed: false, reg: null };

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function initPwa() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    updatePushUI();
    return;
  }
  try {
    pushState.reg = await navigator.serviceWorker.register('sw.js');
    pushState.supported = 'PushManager' in window && 'Notification' in window;
    if (pushState.supported) {
      const sub = await pushState.reg.pushManager.getSubscription();
      pushState.subscribed = !!sub && Notification.permission === 'granted';
      if (sub && pushState.subscribed) api('POST', 'api/push/subscribe', sub.toJSON()).catch(() => {}); // re-sync after DB reset
    }
  } catch (e) {
    console.warn('service worker failed', e);
  }
  updatePushUI();
}

function updatePushUI() {
  const status = $('#push-status');
  const btn = $('#btn-push');
  const test = $('#btn-push-test');
  if (!window.isSecureContext) {
    status.textContent = 'Notifications and install need https or http://localhost. Open the app via localhost on this computer.';
    btn.hidden = true; test.hidden = true;
    return;
  }
  if (!pushState.supported) {
    status.textContent = 'This browser does not support push notifications.';
    btn.hidden = true; test.hidden = true;
    return;
  }
  btn.hidden = false;
  if (Notification.permission === 'denied') {
    status.textContent = 'Notifications are blocked for this site. Allow them in your browser settings.';
    btn.hidden = true; test.hidden = true;
  } else if (pushState.subscribed) {
    status.textContent = 'On for this device. Habits with a reminder will notify you while Docker is running.';
    btn.textContent = 'Turn off notifications on this device';
    test.hidden = false;
  } else {
    status.textContent = 'Off for this device.';
    btn.textContent = 'Enable notifications on this device';
    test.hidden = true;
  }
}

$('#btn-push').addEventListener('click', () => guard(async () => {
  const reg = pushState.reg || await navigator.serviceWorker.ready;
  if (pushState.subscribed) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('DELETE', 'api/push/subscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    pushState.subscribed = false;
    updatePushUI();
    toast('Notifications off');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { updatePushUI(); throw new Error('Notification permission not granted'); }
  const { publicKey } = await api('GET', 'api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
  await api('POST', 'api/push/subscribe', sub.toJSON());
  pushState.subscribed = true;
  updatePushUI();
  toast('Notifications on');
}));

$('#btn-push-test').addEventListener('click', () => guard(async () => {
  const { sent } = await api('POST', 'api/push/test');
  toast(sent ? 'Test notification sent' : 'No device received it');
}));

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#btn-install').hidden = false;
  $('#install-h').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#btn-install').hidden = true;
  $('#install-h').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; $('#install-h').hidden = true; toast('Installed'); });

initPwa();

// ---------- views ----------
const stats = createStatsView({
  api,
  root: $('#view-stats'),
  getToday: () => state.today,
  onPickDate: (date) => { setView('habits'); selectDate(date); },
});

function applyView() {
  const isStats = state.view === 'stats';
  $('#view-habits').hidden = isStats;
  $('#view-stats').hidden = !isStats;
  $('#bb-habits').classList.toggle('active', !isStats);
  $('#bb-stats').classList.toggle('active', isStats);
  $('#nav-habits').classList.toggle('active', !isStats);
  $('#nav-stats').classList.toggle('active', isStats);
  document.body.classList.toggle('view-stats', isStats);
  if (isStats) {
    $('#title .t-main').textContent = 'Stats';
    $('#title .t-sub').textContent = '';
    document.title = 'Habit Tracker — Stats';
  } else {
    renderTitle();
    stats.hideTip();
  }
}

function setView(v) {
  if (state.view === v) return;
  state.view = v;
  history.replaceState(null, '', v === 'stats' ? '#stats' : location.pathname);
  applyView();
  window.scrollTo({ top: 0 });
  if (v === 'stats') guard(stats.load);
}

window.addEventListener('hashchange', () => setView(location.hash === '#stats' ? 'stats' : 'habits'));

applyView();
guard(refresh);
