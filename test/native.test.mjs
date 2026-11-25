import test from 'node:test';
import assert from 'node:assert/strict';

// native.js reads window.Capacitor at import time; in Node there is none, so it runs as "browser".
globalThis.window = {};
const N = await import('../public/native.js');

const cell = (date, done) => ({ date, done });
const habit = (over = {}) => ({
  id: 7, name: 'Read', frequency: 'daily', target_per_week: 1, reminder_time: '20:00', reminder_days: '1111111',
  heatmap: [[cell('2026-11-23', false), cell('2026-11-24', false), cell('2026-11-25', false), cell('2026-11-26', false),
    cell('2026-11-27', false), cell('2026-11-28', false), cell('2026-11-29', false)]],
  ...over,
});

test('normalizeServerUrl', () => {
  assert.equal(N.normalizeServerUrl('192.168.1.20:8080'), 'http://192.168.1.20:8080');
  assert.equal(N.normalizeServerUrl(' http://box:8080/ '), 'http://box:8080');
  assert.equal(N.normalizeServerUrl('https://habits.example.com/app/'), 'https://habits.example.com/app');
  assert.equal(N.normalizeServerUrl(''), '');
});

test('apiBase is relative in a browser', () => {
  assert.equal(N.isNative, false);
  assert.equal(N.apiBase(), '');
});

test('planReminders: upcoming days only, skips done today', () => {
  const now = new Date(2026, 10, 25, 9, 0); // Wed 09:00
  const plan = N.planReminders([habit()], now, 3);
  assert.deepEqual(plan.map((p) => p.at.getDate()), [25, 26, 27]);
  assert.equal(plan[0].id, 700);
  const done = habit();
  done.heatmap[0][2].done = true; // Wed done
  assert.deepEqual(N.planReminders([done], now, 3).map((p) => p.at.getDate()), [26, 27]);
  const late = new Date(2026, 10, 25, 21, 0); // past today's time
  assert.deepEqual(N.planReminders([habit()], late, 2).map((p) => p.at.getDate()), [26]);
});

test('planReminders: respects weekdays and weekly target', () => {
  const now = new Date(2026, 10, 23, 8, 0); // Mon
  const weekdaysOnly = N.planReminders([habit({ reminder_days: '1111100' })], now, 7);
  assert.deepEqual(weekdaysOnly.map((p) => p.at.getDay()), [1, 2, 3, 4, 5]);
  const w = habit({ frequency: 'weekly', target_per_week: 2 });
  w.heatmap[0][0].done = true; w.heatmap[0][1].done = true; // target met Mon+Tue
  const plan = N.planReminders([w], new Date(2026, 10, 25, 8, 0), 7); // Wed..Tue
  assert.deepEqual(plan.map((p) => p.at.getDate()), [30, 1]); // next week's Mon, Tue
  assert.equal(N.planReminders([habit({ reminder_time: null })], now, 7).length, 0);
});
