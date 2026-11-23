'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const S = require('./stats');
const R = require('./reminders');

const ICONS = new Set([
  'check', 'run', 'walk', 'book', 'chart', 'dumbbell', 'water', 'brain', 'code',
  'music', 'sleep', 'food', 'pen', 'heart', 'sun', 'money', 'leaf', 'bike',
]);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function createApp(db, push = null) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const q = {
    habits: db.prepare('SELECT * FROM habits WHERE archived = 0 ORDER BY sort_order, id'),
    habit: db.prepare('SELECT * FROM habits WHERE id = ?'),
    completionsFor: db.prepare('SELECT date FROM completions WHERE habit_id = ?'),
    notesFor: db.prepare('SELECT date FROM notes WHERE habit_id = ?'),
    insertHabit: db.prepare(`INSERT INTO habits (name, icon, color, frequency, target_per_week, reminder_time, reminder_days, sort_order, created_at)
      VALUES (@name, @icon, @color, @frequency, @target_per_week, @reminder_time, @reminder_days, @sort_order, @created_at)`),
    updateHabit: db.prepare(`UPDATE habits SET name=@name, icon=@icon, color=@color, frequency=@frequency,
      target_per_week=@target_per_week, reminder_time=@reminder_time, reminder_days=@reminder_days WHERE id=@id`),
    deleteHabit: db.prepare('DELETE FROM habits WHERE id = ?'),
    maxOrder: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM habits'),
    addCompletion: db.prepare('INSERT OR IGNORE INTO completions (habit_id, date) VALUES (?, ?)'),
    delCompletion: db.prepare('DELETE FROM completions WHERE habit_id = ? AND date = ?'),
    getNote: db.prepare('SELECT text FROM notes WHERE habit_id = ? AND date = ?'),
    upsertNote: db.prepare(`INSERT INTO notes (habit_id, date, text) VALUES (?, ?, ?)
      ON CONFLICT(habit_id, date) DO UPDATE SET text = excluded.text`),
    delNote: db.prepare('DELETE FROM notes WHERE habit_id = ? AND date = ?'),
  };

  const bad = (res, msg) => res.status(400).json({ error: msg });

  function loadHabitsWithSets() {
    return q.habits.all().map((habit) => ({
      habit,
      doneSet: new Set(q.completionsFor.all(habit.id).map((r) => r.date)),
    }));
  }

  function validateHabitBody(body, existing = {}) {
    const merged = { ...existing, ...body };
    const name = typeof merged.name === 'string' ? merged.name.trim() : '';
    if (!name || name.length > 80) return { error: 'name is required (max 80 chars)' };
    const icon = ICONS.has(merged.icon) ? merged.icon : 'check';
    const color = COLOR_RE.test(merged.color || '') ? merged.color : '#FFD60A';
    const frequency = merged.frequency === 'weekly' ? 'weekly' : 'daily';
    let target = parseInt(merged.target_per_week, 10);
    if (!Number.isFinite(target) || target < 1) target = 1;
    if (target > 7) target = 7;
    const reminder_time = typeof merged.reminder_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(merged.reminder_time)
      ? merged.reminder_time : null;
    const reminder_days = typeof merged.reminder_days === 'string' && /^[01]{7}$/.test(merged.reminder_days)
      ? merged.reminder_days : '1111111';
    return { value: { name, icon, color, frequency, target_per_week: target, reminder_time, reminder_days } };
  }

  function getHabitOr404(req, res) {
    const id = parseInt(req.params.id, 10);
    const habit = Number.isFinite(id) ? q.habit.get(id) : undefined;
    if (!habit) {
      res.status(404).json({ error: 'habit not found' });
      return null;
    }
    return habit;
  }

  function resolveDate(raw) {
    return raw && S.isValidDate(raw) ? raw : localToday();
  }

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/api/habits', (req, res) => {
    const today = resolveDate(req.query.today);
    const date = req.query.date && S.isValidDate(req.query.date) ? req.query.date : today;
    const weeks = Math.min(53, Math.max(4, parseInt(req.query.weeks, 10) || 25));
    const list = loadHabitsWithSets().map(({ habit, doneSet }) => {
      const notes = new Set(q.notesFor.all(habit.id).map((r) => r.date));
      const { streak, unit } = S.computeStreak(habit, doneSet, today);
      return {
        ...habit,
        done: doneSet.has(date),
        due: S.isDue(habit, doneSet, date),
        hasNote: notes.has(date),
        streak,
        streakUnit: unit,
        heatmap: S.buildHeatmap(doneSet, date > today ? date : today, today, habit.created_at.slice(0, 10), weeks)
          .map((col) => col.map((c) => ({ ...c, note: notes.has(c.date) }))),
      };
    });
    res.json({ date, today, habits: list });
  });

  app.get('/api/summary', (req, res) => {
    const today = resolveDate(req.query.today);
    const weekOf = req.query.weekOf && S.isValidDate(req.query.weekOf) ? req.query.weekOf : today;
    const hs = loadHabitsWithSets();
    const ws = S.weekStart(weekOf);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = S.addDays(ws, i);
      days.push({ date, progress: date > today ? 0 : S.dayProgress(hs, date), future: date > today });
    }
    const score = S.overallScore(hs, today);
    res.json({ today, weekStart: ws, days, score });
  });


  app.get('/api/stats', (req, res) => {
    const today = resolveDate(req.query.today);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7);
    const monthStart = `${month}-01`;
    if (!S.isValidDate(monthStart)) return bad(res, 'invalid month');
    const monthDays = [];
    for (let d = monthStart; d.slice(0, 7) === month; d = S.addDays(d, 1)) monthDays.push(d);

    const hs = loadHabitsWithSets();
    const habits = hs.map(({ habit, doneSet }) => {
      const notes = new Set(q.notesFor.all(habit.id).map((r) => r.date));
      const cur = S.computeStreak(habit, doneSet, today);
      return {
        id: habit.id,
        name: habit.name,
        icon: habit.icon,
        color: habit.color,
        frequency: habit.frequency,
        target_per_week: habit.target_per_week,
        currentStreak: cur.streak,
        streakUnit: habit.frequency === 'weekly' ? 'weeks' : 'days',
        bestStreak: S.computeBestStreak(habit, doneSet),
        score: S.habitScore(habit, doneSet, today),
        total: [...doneSet].filter((d) => d <= today).length,
        rate7: S.rateInRange(habit, doneSet, today, 7),
        rate30: S.rateInRange(habit, doneSet, today, 30),
        byWeekday: S.byWeekday(doneSet, today),
        last12Weeks: S.weeklyCounts(doneSet, today, 12),
        month: monthDays.map((date) => ({ date, done: doneSet.has(date), note: notes.has(date), future: date > today })),
      };
    });

    const sumArr = (arrs, n) => Array.from({ length: n }, (_, i) => arrs.reduce((a, x) => a + x[i], 0));
    const allWeekday = sumArr(habits.map((h) => h.byWeekday), 7);
    const allWeeks = habits.length
      ? habits[0].last12Weeks.map((w, i) => ({ weekStart: w.weekStart, count: habits.reduce((a, h) => a + h.last12Weeks[i].count, 0) }))
      : S.weeklyCounts(new Set(), today, 12);
    const allMonth = monthDays.map((date, i) => {
      const done = habits.filter((h) => h.month[i].done).length;
      return { date, done: done > 0, count: done, ratio: habits.length ? done / habits.length : 0, note: habits.some((h) => h.month[i].note), future: date > today };
    });

    res.json({
      today,
      month,
      overall: {
        score: S.overallScore(hs, today),
        total: habits.reduce((a, h) => a + h.total, 0),
        activeHabits: habits.length,
        bestCurrent: habits.reduce((b, h) => (h.currentStreak > (b?.currentStreak ?? -1) ? h : b), null),
        byWeekday: allWeekday,
        last12Weeks: allWeeks,
        month: allMonth,
      },
      habits,
    });
  });

  app.post('/api/habits', (req, res) => {
    const { error, value } = validateHabitBody(req.body || {});
    if (error) return bad(res, error);
    const created_at = req.body.created_at && S.isValidDate(req.body.created_at) ? req.body.created_at : localToday();
    const info = q.insertHabit.run({ ...value, sort_order: q.maxOrder.get().m + 1, created_at });
    res.status(201).json(q.habit.get(info.lastInsertRowid));
  });

  app.put('/api/habits/:id', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    const { error, value } = validateHabitBody(req.body || {}, habit);
    if (error) return bad(res, error);
    q.updateHabit.run({ ...value, id: habit.id });
    res.json(q.habit.get(habit.id));
  });

  app.delete('/api/habits/:id', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    q.deleteHabit.run(habit.id);
    res.status(204).end();
  });

  app.put('/api/habits/:id/completions/:date', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    if (!S.isValidDate(req.params.date)) return bad(res, 'invalid date');
    q.addCompletion.run(habit.id, req.params.date);
    res.json({ ok: true });
  });

  app.delete('/api/habits/:id/completions/:date', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    if (!S.isValidDate(req.params.date)) return bad(res, 'invalid date');
    q.delCompletion.run(habit.id, req.params.date);
    res.json({ ok: true });
  });

  app.get('/api/habits/:id/notes/:date', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    if (!S.isValidDate(req.params.date)) return bad(res, 'invalid date');
    const row = q.getNote.get(habit.id, req.params.date);
    res.json({ date: req.params.date, text: row ? row.text : '' });
  });

  app.put('/api/habits/:id/notes/:date', (req, res) => {
    const habit = getHabitOr404(req, res);
    if (!habit) return;
    if (!S.isValidDate(req.params.date)) return bad(res, 'invalid date');
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 10000) : '';
    if (text.trim()) q.upsertNote.run(habit.id, req.params.date, text);
    else q.delNote.run(habit.id, req.params.date);
    res.json({ date: req.params.date, text: text.trim() ? text : '' });
  });

  // Web Push
  const pushQ = {
    upsert: db.prepare(`INSERT INTO push_subscriptions (endpoint, keys_json, created_at) VALUES (?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json`),
    del: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions'),
  };

  app.get('/api/push/key', (_req, res) => {
    if (!push) return res.status(503).json({ error: 'push disabled' });
    res.json({ publicKey: push.publicKey, subscriptions: pushQ.count.get().n });
  });

  app.post('/api/push/subscribe', (req, res) => {
    if (!push) return res.status(503).json({ error: 'push disabled' });
    const sub = req.body || {};
    let url;
    try { url = new URL(sub.endpoint); } catch { return bad(res, 'invalid subscription'); }
    if (url.protocol !== 'https:' || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') {
      return bad(res, 'invalid subscription');
    }
    pushQ.upsert.run(sub.endpoint, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }), new Date().toISOString());
    res.status(201).json({ ok: true });
  });

  app.delete('/api/push/subscribe', (req, res) => {
    if (typeof req.body?.endpoint === 'string') pushQ.del.run(req.body.endpoint);
    res.json({ ok: true });
  });

  app.post('/api/push/test', async (_req, res) => {
    if (!push) return res.status(503).json({ error: 'push disabled' });
    const sent = await push.sendAll({ title: 'Habit Tracker', body: 'Notifications are working 🎉', tag: 'test', url: './' });
    res.json({ sent });
  });

  // Backup / restore
  app.get('/api/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="habits-${localToday()}.json"`);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      habits: db.prepare('SELECT * FROM habits').all(),
      completions: db.prepare('SELECT * FROM completions').all(),
      notes: db.prepare('SELECT * FROM notes').all(),
    });
  });

  app.post('/api/import', (req, res) => {
    const data = req.body;
    if (!data || !Array.isArray(data.habits) || !Array.isArray(data.completions)) {
      return bad(res, 'invalid backup file');
    }
    const tx = db.transaction(() => {
      db.exec('DELETE FROM notes; DELETE FROM completions; DELETE FROM habits;');
      const ins = db.prepare(`INSERT INTO habits (id, name, icon, color, frequency, target_per_week, reminder_time, reminder_days, archived, sort_order, created_at)
        VALUES (@id, @name, @icon, @color, @frequency, @target_per_week, @reminder_time, @reminder_days, @archived, @sort_order, @created_at)`);
      for (const h of data.habits) {
        const { error, value } = validateHabitBody(h);
        if (error) throw new Error(`invalid habit: ${error}`);
        ins.run({
          ...value,
          id: h.id,
          archived: h.archived ? 1 : 0,
          sort_order: h.sort_order || 0,
          created_at: S.isValidDate(String(h.created_at).slice(0, 10)) ? String(h.created_at).slice(0, 10) : localToday(),
        });
      }
      for (const c of data.completions) {
        if (S.isValidDate(c.date)) q.addCompletion.run(c.habit_id, c.date);
      }
      for (const n of data.notes || []) {
        if (S.isValidDate(n.date) && typeof n.text === 'string') q.upsertNote.run(n.habit_id, n.date, n.text);
      }
    });
    try {
      tx();
    } catch (e) {
      return bad(res, e.message);
    }
    res.json({ ok: true });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (require.main === module) {
  const db = openDb();
  const port = parseInt(process.env.PORT, 10) || 3000;
  const push = { publicKey: R.ensureVapid(db), ...R.createPush(db) };
  const scheduler = R.startScheduler(db, push);
  const server = createApp(db, push).listen(port, () => {
    console.log(`Habit Tracker listening on http://0.0.0.0:${port}`);
  });
  const shutdown = () => {
    scheduler.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
