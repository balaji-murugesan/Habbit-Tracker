import { HABIT_ICONS, UI_ICONS } from './icons.js';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const shortDate = (k) => { const [, m, d] = k.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

/**
 * Stats view controller.
 * @param {object} deps  { api, root, getToday, onPickDate(date) }
 */
export function createStatsView({ api, root, getToday, onPickDate }) {
  const st = { scope: 'all', month: getToday().slice(0, 7), data: null };

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  document.body.append(tip);

  function showTip(e, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = e.currentTarget.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const x = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  async function load() {
    st.data = await api('GET', `api/stats?today=${getToday()}&month=${st.month}`);
    if (st.scope !== 'all' && !st.data.habits.some((h) => String(h.id) === st.scope)) st.scope = 'all';
    render();
  }

  function scoped() {
    const d = st.data;
    if (st.scope === 'all') {
      return { color: 'var(--accent)', name: 'All habits', byWeekday: d.overall.byWeekday, weeks: d.overall.last12Weeks, month: d.overall.month, multi: true };
    }
    const h = d.habits.find((x) => String(x.id) === st.scope);
    return { color: h.color, name: h.name, byWeekday: h.byWeekday, weeks: h.last12Weeks, month: h.month, habit: h };
  }

  // ---- charts (single series → no legend; title names it) ----
  function barChart(values, labels, tipFor, color) {
    const W = 320, H = 150, padL = 26, padB = 22, padT = 8;
    const max = Math.max(1, ...values);
    const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
    const n = values.length;
    const slot = (W - padL) / n;
    const bw = Math.max(4, Math.min(28, slot - 6));
    const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
    let grid = '';
    for (const g of [0, nice / 2, nice]) {
      grid += `<line x1="${padL}" x2="${W}" y1="${y(g)}" y2="${y(g)}" class="grid"/>
        <text x="${padL - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${Math.round(g)}</text>`;
    }
    let bars = '';
    let labs = '';
    values.forEach((v, i) => {
      const cx = padL + slot * i + slot / 2;
      const top = y(v), base = y(0);
      const h = base - top;
      const r = Math.min(4, h / 2, bw / 2);
      // Rounded top corners only; anchored flat on the baseline.
      const path = h <= 0 ? '' : `M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z`;
      bars += `<g class="bar-hit" data-i="${i}" tabindex="0"><rect x="${cx - slot / 2}" y="${padT}" width="${slot}" height="${H - padT - padB}" fill="transparent"/>
        ${path ? `<path d="${path}" fill="${color}"/>` : ''}</g>`;
      if (labels[i]) labs += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis">${labels[i]}</text>`;
    });
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${labs}</svg>`;
    wrap.querySelectorAll('.bar-hit').forEach((g) => {
      const i = Number(g.dataset.i);
      const on = (e) => { g.classList.add('hover'); showTip(e, tipFor(i)); };
      const off = () => { g.classList.remove('hover'); hideTip(); };
      g.addEventListener('mouseenter', on);
      g.addEventListener('focus', on);
      g.addEventListener('mouseleave', off);
      g.addEventListener('blur', off);
    });
    return wrap;
  }

  function tableToggle(rows, head) {
    const det = document.createElement('details');
    det.className = 'table-view';
    det.innerHTML = `<summary>Show as table</summary><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return det;
  }

  function calendar(sc) {
    const [y, m] = st.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const wrap = document.createElement('div');
    wrap.className = 'cal';
    wrap.style.setProperty('--c', sc.color);
    wrap.innerHTML = DAYS.map((d) => `<div class="cal-h">${d[0]}</div>`).join('') + '<div class="cal-pad"></div>'.repeat(lead);
    for (const day of sc.month) {
      const n = Number(day.date.slice(8));
      const b = document.createElement('button');
      const level = sc.multi ? day.ratio : day.done ? 1 : 0;
      b.className = `cal-d${day.future ? ' future' : ''}${level > 0 ? ' done' : ''}${day.note ? ' note' : ''}${day.date === getToday() ? ' today' : ''}`;
      if (level > 0) b.style.setProperty('--lvl', String(0.35 + 0.65 * level));
      b.textContent = n;
      b.disabled = day.future;
      const detail = sc.multi ? `${day.count}/${st.data.habits.length} habits done` : day.done ? 'Done' : 'Not done';
      b.title = `${shortDate(day.date)}: ${detail}${day.note ? ' · has note' : ''}`;
      b.addEventListener('click', () => onPickDate(day.date));
      wrap.append(b);
    }
    return wrap;
  }

  function tile(label, value, sub = '') {
    return `<div class="tile"><div class="tile-l">${label}</div><div class="tile-v">${value}</div>${sub ? `<div class="tile-s">${sub}</div>` : ''}</div>`;
  }

  function render() {
    const d = st.data;
    root.innerHTML = '';
    if (!d.habits.length) {
      root.innerHTML = '<div class="empty"><p>No stats yet.</p><p class="muted">Create a habit and check in to see insights.</p></div>';
      return;
    }
    const sc = scoped();

    // Overview tiles
    const best = d.overall.bestCurrent;
    const ov = document.createElement('div');
    ov.className = 'tiles';
    if (sc.habit) {
      const h = sc.habit;
      ov.innerHTML = tile('Score', pct(h.score)) + tile('Current streak', h.currentStreak, h.streakUnit)
        + tile('Best streak', h.bestStreak, h.streakUnit) + tile('Check-ins', h.total);
    } else {
      ov.innerHTML = tile('Habit Score', d.overall.score == null ? '–' : `${(d.overall.score * 100).toFixed(1)}%`)
        + tile('Check-ins', d.overall.total)
        + tile('Top streak', best ? best.currentStreak : 0, best ? esc(best.name) : '')
        + tile('Active habits', d.overall.activeHabits);
    }

    // Scope chips
    const chips = document.createElement('div');
    chips.className = 'chips';
    const chip = (id, label, color, icon) => {
      const b = document.createElement('button');
      b.className = `chip${st.scope === id ? ' sel' : ''}`;
      b.style.setProperty('--c', color);
      b.innerHTML = `${icon ? `<span class="chip-i">${icon}</span>` : ''}${esc(label)}`;
      b.addEventListener('click', () => { st.scope = id; render(); });
      return b;
    };
    chips.append(chip('all', 'All', 'var(--accent)'));
    d.habits.forEach((h) => chips.append(chip(String(h.id), h.name, h.color, HABIT_ICONS[h.icon])));

    // Calendar card
    const [y, m] = st.month.split('-').map(Number);
    const calCard = document.createElement('section');
    calCard.className = 'card stat-card';
    calCard.innerHTML = `<div class="stat-head"><h3>${MONTHS_LONG[m - 1]} ${y}</h3>
      <div class="month-nav"><button class="icon-btn" data-m="-1" aria-label="Previous month">${UI_ICONS.chevL}</button>
      <button class="icon-btn" data-m="1" aria-label="Next month" ${st.month >= getToday().slice(0, 7) ? 'disabled' : ''}>${UI_ICONS.chevR}</button></div></div>`;
    calCard.append(calendar(sc));
    calCard.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      const dt = new Date(y, m - 1 + Number(b.dataset.m), 1);
      st.month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      load();
    }));

    // Weekday chart
    const wdCard = document.createElement('section');
    wdCard.className = 'card stat-card';
    const wdMax = Math.max(...sc.byWeekday);
    const strongest = wdMax > 0 ? DAYS[sc.byWeekday.indexOf(wdMax)] : null;
    wdCard.innerHTML = `<div class="stat-head"><h3>Check-ins by weekday</h3>${strongest ? `<span class="muted small">Best day: ${strongest}</span>` : ''}</div>`;
    wdCard.append(
      barChart(sc.byWeekday, DAYS, (i) => `<b>${DAYS[i]}</b><br>${sc.byWeekday[i]} check-ins`, sc.color),
      tableToggle(DAYS.map((dn, i) => [dn, sc.byWeekday[i]]), ['Day', 'Check-ins']),
    );

    // 12 week trend
    const trCard = document.createElement('section');
    trCard.className = 'card stat-card';
    const counts = sc.weeks.map((w) => w.count);
    const thisWk = counts[counts.length - 1] || 0;
    const prevWk = counts[counts.length - 2] || 0;
    trCard.innerHTML = `<div class="stat-head"><h3>Last 12 weeks</h3><span class="muted small">This week ${thisWk} · last week ${prevWk}</span></div>`;
    trCard.append(
      barChart(counts, sc.weeks.map((w, i) => (i % 3 === 0 || i === sc.weeks.length - 1 ? shortDate(w.weekStart) : '')),
        (i) => `<b>Week of ${shortDate(sc.weeks[i].weekStart)}</b><br>${counts[i]} check-ins`, sc.color),
      tableToggle(sc.weeks.map((w) => [`Week of ${shortDate(w.weekStart)}`, w.count]), ['Week', 'Check-ins']),
    );

    // Per-habit rows
    const list = document.createElement('section');
    list.className = 'card stat-card';
    list.innerHTML = '<div class="stat-head"><h3>Habits</h3><span class="muted small">30-day rate</span></div>';
    for (const h of d.habits) {
      const row = document.createElement('button');
      row.className = 'hrow';
      row.style.setProperty('--c', h.color);
      row.innerHTML = `<span class="hrow-i">${HABIT_ICONS[h.icon] || HABIT_ICONS.check}</span>
        <span class="hrow-t"><b>${esc(h.name)}</b><span class="muted small">Now ${h.currentStreak} · Best ${h.bestStreak} ${h.streakUnit} · Score ${pct(h.score)}</span></span>
        <span class="hrow-r"><span class="meter"><span style="width:${Math.round((h.rate30 || 0) * 100)}%"></span></span><span class="hrow-v">${pct(h.rate30)}</span></span>`;
      row.addEventListener('click', () => { st.scope = String(h.id); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      list.append(row);
    }

    const grid = document.createElement('div');
    grid.className = 'stat-grid';
    grid.append(calCard, wdCard, trCard, list);
    root.append(ov, chips, grid);
  }

  return { load, hideTip };
}
