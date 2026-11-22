'use strict';

// All dates are local calendar dates as 'YYYY-MM-DD' strings.
// Internally we convert them to UTC-midnight Date objects so day arithmetic
// never drifts because of DST.

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}

function addDays(s, n) {
  return fmtDate(new Date(parseDate(s).getTime() + n * DAY_MS));
}

function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** Monday of the week containing date s. */
function weekStart(s) {
  const dow = (parseDate(s).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(s, -dow);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtDate(parseDate(s)) === s;
}

function countInWeek(doneSet, ws) {
  let n = 0;
  for (let i = 0; i < 7; i++) if (doneSet.has(addDays(ws, i))) n++;
  return n;
}

/**
 * Current streak as of `today`.
 * daily:  consecutive completed days ending today (or yesterday if today isn't done yet).
 * weekly: consecutive weeks meeting target, ending with the current week if met,
 *         otherwise ending last week (current week is still in progress).
 */
function computeStreak(habit, doneSet, today) {
  if (habit.frequency === 'weekly') {
    const target = Math.max(1, habit.target_per_week || 1);
    let ws = weekStart(today);
    let streak = 0;
    if (countInWeek(doneSet, ws) >= target) streak++;
    ws = addDays(ws, -7);
    while (countInWeek(doneSet, ws) >= target) {
      streak++;
      ws = addDays(ws, -7);
    }
    return { streak, unit: streak === 1 ? 'week' : 'weeks' };
  }

  let d = doneSet.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (doneSet.has(d)) {
    streak++;
    d = addDays(d, -1);
  }
  return { streak, unit: streak === 1 ? 'day' : 'days' };
}

/** Whether a habit still needs action on `date`. */
function isDue(habit, doneSet, date) {
  if (habit.frequency === 'weekly') {
    const target = Math.max(1, habit.target_per_week || 1);
    return !doneSet.has(date) && countInWeek(doneSet, weekStart(date)) < target;
  }
  return !doneSet.has(date);
}

/**
 * Heatmap: `weeks` columns × 7 rows (Mon..Sun), the last column being the week of `endDate`.
 * Returns array of columns, each an array of 7 cells { date, done, future, beforeStart }.
 */
function buildHeatmap(doneSet, endDate, today, createdDate, weeks = 25) {
  const lastWs = weekStart(endDate);
  const firstWs = addDays(lastWs, -7 * (weeks - 1));
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(firstWs, w * 7);
    const col = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      col.push({
        date,
        done: doneSet.has(date),
        future: date > today,
        beforeStart: date < createdDate,
      });
    }
    cols.push(col);
  }
  return cols;
}

/**
 * Score for a single habit: completions / expected occurrences since creation, capped at 1.
 * daily:  expected = days elapsed (inclusive of today).
 * weekly: expected = target × weeks elapsed (current week counted pro-rata by what's possible).
 * Returns null if nothing is expected yet.
 */
function habitScore(habit, doneSet, today) {
  const start = habit.created_at.slice(0, 10);
  if (start > today) return null;
  let earliest = start;
  for (const d of doneSet) if (d < earliest) earliest = d;

  const doneCount = [...doneSet].filter((d) => d >= earliest && d <= today).length;

  if (habit.frequency === 'weekly') {
    const target = Math.max(1, habit.target_per_week || 1);
    const weeks = Math.floor(diffDays(weekStart(earliest), weekStart(today)) / 7);
    // Completed weeks count fully; current week only counts what has been achieved
    // (so an in-progress week never lowers the score).
    let expected = 0;
    let achieved = 0;
    for (let w = 0; w <= weeks; w++) {
      const ws = addDays(weekStart(earliest), w * 7);
      const got = Math.min(target, countInWeek(doneSet, ws));
      if (w === weeks) {
        expected += got;
      } else {
        expected += target;
      }
      achieved += got;
    }
    if (expected === 0) return null;
    return Math.min(1, achieved / expected);
  }

  let expected = diffDays(earliest, today) + 1;
  // Today isn't over yet: don't penalise if it's not done.
  if (!doneSet.has(today)) expected -= 1;
  if (expected <= 0) return null;
  return Math.min(1, doneCount / expected);
}

function overallScore(habitsWithSets, today) {
  const scores = habitsWithSets
    .map(({ habit, doneSet }) => habitScore(habit, doneSet, today))
    .filter((s) => s !== null);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Ratio of (done) / (applicable habits) for a given date — drives week-strip rings. */
function dayProgress(habitsWithSets, date) {
  let applicable = 0;
  let done = 0;
  for (const { habit, doneSet } of habitsWithSets) {
    if (habit.created_at.slice(0, 10) > date && !doneSet.has(date)) continue;
    if (habit.frequency === 'weekly') {
      const target = Math.max(1, habit.target_per_week || 1);
      const ws = weekStart(date);
      // A weekly habit counts as satisfied on a day if done that day, or the week target was
      // already reached by that day.
      let byDay = 0;
      for (let d = ws; d <= date; d = addDays(d, 1)) if (doneSet.has(d)) byDay++;
      applicable++;
      if (doneSet.has(date) || byDay >= target) done++;
    } else {
      applicable++;
      if (doneSet.has(date)) done++;
    }
  }
  return applicable === 0 ? 0 : done / applicable;
}

module.exports = {
  parseDate,
  fmtDate,
  addDays,
  diffDays,
  weekStart,
  isValidDate,
  computeStreak,
  isDue,
  buildHeatmap,
  habitScore,
  overallScore,
  dayProgress,
};
