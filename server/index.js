'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const S = require('./stats');

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

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const q = {
    habits: db.prepare('SELECT * FROM habits WHERE archived = 0 ORDER BY sort_order, id'),
    habit: db.prepare('SELECT * FROM habits WHERE id = ?'),
    completionsFor: db.prepare('SELECT date FROM completions WHERE habit_id = ?'),
    notesFor: db.prepare('SELECT date FROM notes WHERE habit_id = ?'),
    insertHabit: db.prepare(`INSERT INTO habits (name, icon, color, frequency, target_per_week, sort_order, created_at)
      VALUES (@name, @icon, @color, @frequency, @target_per_week, @sort_order, @created_at)`),
    updateHabit: db.prepare(`UPDATE habits SET name=@name, icon=@icon, color=@color, frequency=@frequency,
      target_per_week=@target_per_week WHERE id=@id`),
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
    return { value: { name, icon, color, frequency, target_per_week: target } };
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
      const ins = db.prepare(`INSERT INTO habits (id, name, icon, color, frequency, target_per_week, archived, sort_order, created_at)
        VALUES (@id, @name, @icon, @color, @frequency, @target_per_week, @archived, @sort_order, @created_at)`);
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
  const server = createApp(db).listen(port, () => {
    console.log(`Habit Tracker listening on http://0.0.0.0:${port}`);
  });
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
