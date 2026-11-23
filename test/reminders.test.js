'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const R = require('../server/reminders');

const habit = { frequency: 'daily', target_per_week: 1, created_at: '2026-11-01', reminder_time: '20:00', reminder_days: '1111111' };
const now = (time, date = '2026-11-23', dow = 0) => ({ date, time, dow });

test('shouldRemind: time gate', () => {
  assert.equal(R.shouldRemind(habit, new Set(), now('19:59'), false), false);
  assert.equal(R.shouldRemind(habit, new Set(), now('20:00'), false), true);
  assert.equal(R.shouldRemind(habit, new Set(), now('22:30'), false), true);
});

test('shouldRemind: skips when done, already sent, disabled day or no time', () => {
  assert.equal(R.shouldRemind(habit, new Set(['2026-11-23']), now('20:00'), false), false);
  assert.equal(R.shouldRemind(habit, new Set(), now('20:00'), true), false);
  assert.equal(R.shouldRemind({ ...habit, reminder_days: '0111111' }, new Set(), now('20:00'), false), false);
  assert.equal(R.shouldRemind({ ...habit, reminder_time: null }, new Set(), now('20:00'), false), false);
});

test('shouldRemind: weekly habit with target met is not due', () => {
  const w = { ...habit, frequency: 'weekly', target_per_week: 1 };
  assert.equal(R.shouldRemind(w, new Set(['2026-11-23']), now('21:00', '2026-11-24', 1), false), false);
});

test('migration adds reminder columns to an old database', () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ht-')), 'old.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE habits (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'check',
    color TEXT NOT NULL DEFAULT '#FFD60A', frequency TEXT NOT NULL DEFAULT 'daily', target_per_week INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    INSERT INTO habits (name, created_at) VALUES ('Old habit', '2026-01-01');`);
  old.close();
  const db = openDb(file);
  const h = db.prepare('SELECT * FROM habits').get();
  assert.equal(h.name, 'Old habit');
  assert.equal(h.reminder_time, null);
  assert.equal(h.reminder_days, '1111111');
  db.close();
});

test('scheduler sends once per day and drops expired subscriptions', async () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO habits (name, created_at, reminder_time) VALUES ('Read', '2026-11-01', '08:00')`).run();
  db.prepare(`INSERT INTO push_subscriptions VALUES ('https://push.example/a', '{"p256dh":"x","auth":"y"}', 'now')`).run();
  db.prepare(`INSERT INTO push_subscriptions VALUES ('https://push.example/gone', '{"p256dh":"x","auth":"y"}', 'now')`).run();
  const sent = [];
  const sender = {
    async sendNotification(sub, body) {
      if (sub.endpoint.endsWith('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
      sent.push(JSON.parse(body));
    },
  };
  let t = new Date(2026, 10, 23, 7, 59);
  const sch = R.startScheduler(db, R.createPush(db, sender), { intervalMs: 1e9, clock: () => t });
  await sch.tick();
  assert.equal(sent.length, 0);
  t = new Date(2026, 10, 23, 8, 1);
  await sch.tick();
  await sch.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Read');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 1);
  sch.stop();
  db.close();
});
