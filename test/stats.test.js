'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../server/stats');

const daily = { frequency: 'daily', target_per_week: 1, created_at: '2026-11-01' };
const weekly = { frequency: 'weekly', target_per_week: 2, created_at: '2026-10-01' };
const set = (...d) => new Set(d);

test('weekStart returns Monday', () => {
  assert.equal(S.weekStart('2026-11-22'), '2026-11-16'); // Sunday -> Monday
  assert.equal(S.weekStart('2026-11-16'), '2026-11-16');
});

test('isValidDate', () => {
  assert.ok(S.isValidDate('2026-02-28'));
  assert.ok(!S.isValidDate('2026-02-30'));
  assert.ok(!S.isValidDate('nope'));
});

test('daily streak counts back from today', () => {
  const s = set('2026-11-20', '2026-11-21', '2026-11-22');
  assert.deepEqual(S.computeStreak(daily, s, '2026-11-22'), { streak: 3, unit: 'days' });
});

test('daily streak survives an unfinished today', () => {
  const s = set('2026-11-20', '2026-11-21');
  assert.equal(S.computeStreak(daily, s, '2026-11-22').streak, 2);
});

test('daily streak breaks on a gap', () => {
  const s = set('2026-11-18', '2026-11-20', '2026-11-21');
  assert.equal(S.computeStreak(daily, s, '2026-11-21').streak, 2);
  assert.equal(S.computeStreak(daily, set(), '2026-11-21').streak, 0);
});

test('weekly streak counts weeks meeting target', () => {
  // weeks of 11-02, 11-09 met (2 each), current week 11-16 has only 1 (in progress)
  const s = set('2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17');
  assert.deepEqual(S.computeStreak(weekly, s, '2026-11-22'), { streak: 2, unit: 'weeks' });
  s.add('2026-11-19');
  assert.equal(S.computeStreak(weekly, s, '2026-11-22').streak, 3);
});

test('isDue', () => {
  assert.equal(S.isDue(daily, set('2026-11-22'), '2026-11-22'), false);
  assert.equal(S.isDue(daily, set(), '2026-11-22'), true);
  const s = set('2026-11-16', '2026-11-17');
  assert.equal(S.isDue(weekly, s, '2026-11-20'), false); // target met this week
  assert.equal(S.isDue(weekly, set('2026-11-16'), '2026-11-20'), true);
});

test('heatmap shape and flags', () => {
  const h = S.buildHeatmap(set('2026-11-20'), '2026-11-22', '2026-11-21', '2026-11-01', 4);
  assert.equal(h.length, 4);
  assert.ok(h.every((c) => c.length === 7));
  const last = h[3];
  assert.equal(last[0].date, '2026-11-16');
  assert.equal(last[4].done, true);
  assert.equal(last[6].future, true);
  assert.equal(h[0][0].beforeStart, true);
});

test('daily score ignores unfinished today', () => {
  const h = { ...daily, created_at: '2026-11-20' };
  assert.equal(S.habitScore(h, set('2026-11-20', '2026-11-21'), '2026-11-22'), 1);
  assert.equal(S.habitScore(h, set('2026-11-20'), '2026-11-22'), 0.5);
  assert.equal(S.habitScore(h, set(), '2026-11-20'), null);
});

test('weekly score: in-progress week never lowers score', () => {
  const h = { ...weekly, created_at: '2026-11-09' };
  const s = set('2026-11-10', '2026-11-12'); // last week met, this week nothing yet
  assert.equal(S.habitScore(h, s, '2026-11-22'), 1);
  const s2 = set('2026-11-10'); // last week half
  assert.equal(S.habitScore(h, s2, '2026-11-22'), 0.5);
});

test('dayProgress', () => {
  const hs = [
    { habit: daily, doneSet: set('2026-11-22') },
    { habit: { ...daily, created_at: '2026-11-01' }, doneSet: set() },
  ];
  assert.equal(S.dayProgress(hs, '2026-11-22'), 0.5);
});
