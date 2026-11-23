'use strict';

const webpush = require('web-push');
const S = require('./stats');

const pad = (n) => String(n).padStart(2, '0');

/** Local (container TZ) date and HH:MM. */
function localNow(now = new Date()) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    dow: (now.getDay() + 6) % 7, // Mon=0
  };
}

/**
 * Pure decision: should a reminder for `habit` go out right now?
 * - habit has a reminder_time and it is at/after that time today
 * - today is enabled in reminder_days (7 chars, Mon..Sun, '1' = on)
 * - habit is still due today
 * - nothing was sent for it today
 */
function shouldRemind(habit, doneSet, now, alreadySent) {
  if (!habit.reminder_time || alreadySent) return false;
  const days = habit.reminder_days || '1111111';
  if (days[now.dow] !== '1') return false;
  if (now.time < habit.reminder_time) return false;
  if (habit.created_at.slice(0, 10) > now.date) return false;
  return S.isDue(habit, doneSet, now.date);
}

function ensureVapid(db) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  let pub = get.get('vapid_public')?.value;
  let priv = get.get('vapid_private')?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    set.run('vapid_public', pub);
    set.run('vapid_private', priv);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:habit-tracker@localhost', pub, priv);
  return pub;
}

function createPush(db, sender = webpush) {
  const q = {
    subs: db.prepare('SELECT endpoint, keys_json FROM push_subscriptions'),
    delSub: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
  };

  /** Sends payload to every subscription; drops expired ones. Returns count delivered. */
  async function sendAll(payload) {
    const body = JSON.stringify(payload);
    let ok = 0;
    for (const row of q.subs.all()) {
      const sub = { endpoint: row.endpoint, keys: JSON.parse(row.keys_json) };
      try {
        await sender.sendNotification(sub, body, { TTL: 60 * 60 });
        ok++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) q.delSub.run(row.endpoint);
        else console.warn('push failed:', e.statusCode || '', e.message);
      }
    }
    return ok;
  }

  return { sendAll };
}

function startScheduler(db, push, { intervalMs = 60_000, clock = () => new Date() } = {}) {
  const q = {
    habits: db.prepare('SELECT * FROM habits WHERE archived = 0 AND reminder_time IS NOT NULL'),
    done: db.prepare('SELECT date FROM completions WHERE habit_id = ?'),
    sent: db.prepare('SELECT 1 FROM reminder_log WHERE habit_id = ? AND date = ?'),
    log: db.prepare('INSERT OR IGNORE INTO reminder_log (habit_id, date) VALUES (?, ?)'),
    cleanup: db.prepare('DELETE FROM reminder_log WHERE date < ?'),
    hasSubs: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions'),
  };

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = localNow(clock());
      if (q.hasSubs.get().n === 0) return;
      for (const habit of q.habits.all()) {
        const doneSet = new Set(q.done.all(habit.id).map((r) => r.date));
        const sent = !!q.sent.get(habit.id, now.date);
        if (!shouldRemind(habit, doneSet, now, sent)) continue;
        q.log.run(habit.id, now.date); // log first so a slow push never double-sends
        await push.sendAll({
          title: habit.name,
          body: habit.frequency === 'weekly'
            ? `Keep your ${habit.target_per_week}×/week goal on track.`
            : "Don't break your streak — check in for today.",
          tag: `habit-${habit.id}-${now.date}`,
          url: './',
        });
      }
      q.cleanup.run(S.addDays(now.date, -7));
    } catch (e) {
      console.error('reminder tick failed:', e);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { localNow, shouldRemind, ensureVapid, createPush, startScheduler };
