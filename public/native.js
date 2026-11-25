// Android (Capacitor) integration. In a normal browser everything here is a no-op:
// the page talks to the server it was loaded from.

const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

const SERVER_KEY = 'habit.serverUrl';

function plugin(name) {
  if (!isNative) return null;
  return (Cap.Plugins && Cap.Plugins[name]) || (Cap.registerPlugin ? Cap.registerPlugin(name) : null);
}

// ---------- server URL ----------
export function normalizeServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export function getServerUrl() {
  try { return localStorage.getItem(SERVER_KEY) || ''; } catch { return ''; }
}

function setServerUrl(url) {
  try { localStorage.setItem(SERVER_KEY, url); } catch { /* ignore */ }
}

/** Prefix for API calls: '' in the browser, 'http://host:port/' in the app. */
export function apiBase() {
  return isNative ? `${getServerUrl()}/` : '';
}

async function testServer(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`${url}/healthz`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error('Not a Habit Tracker server');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('No answer within 6 seconds');
    if (e instanceof TypeError) throw new Error('Could not connect');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Shows the "connect to your server" screen. Resolves once a working URL is saved.
 * `reason` is shown above the form (e.g. after a connection failure).
 */
export function showConnectScreen({ reason = '', cancellable = false } = {}) {
  return new Promise((resolve) => {
    document.querySelector('#connect')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'connect';
    wrap.className = 'connect';
    wrap.innerHTML = `
      <form class="connect-card" novalidate>
        <div class="connect-logo"></div>
        <h1>Connect to your Habit Tracker</h1>
        <p class="muted">The app syncs with the Habit Tracker running in Docker on your computer.
          Enter the address you use to open it, with your computer's IP instead of <b>localhost</b>.</p>
        ${reason ? `<p class="connect-err">${reason}</p>` : ''}
        <label class="field"><span>Server address</span>
          <input name="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="http://192.168.1.20:8080" value="${getServerUrl()}"></label>
        <p class="connect-err" id="connect-err" hidden></p>
        <button class="btn primary block" type="submit">Connect</button>
        ${cancellable ? '<button class="btn ghost block" type="button" id="connect-cancel">Cancel</button>' : ''}
        <details class="connect-help">
          <summary>How do I find the address?</summary>
          <ul>
            <li><b>Same Wi-Fi:</b> on the computer, run <code>ipconfig</code> (Windows) or
              <code>ipconfig getifaddr en0</code> (Mac) and use that IP with your port, e.g.
              <code>http://192.168.1.20:8080</code>.</li>
            <li><b>Anywhere:</b> install Tailscale on the computer and phone, then use the computer's
              Tailscale IP, e.g. <code>http://100.101.102.103:8080</code>.</li>
            <li>If it won't connect, allow the port through the computer's firewall (Windows asks the
              first time Docker listens on it).</li>
          </ul>
        </details>
      </form>`;
    document.body.append(wrap);
    const form = wrap.querySelector('form');
    const input = form.url;
    const err = wrap.querySelector('#connect-err');
    const btn = form.querySelector('button[type=submit]');
    input.focus();
    wrap.querySelector('#connect-cancel')?.addEventListener('click', () => { wrap.remove(); resolve(false); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      let url;
      try { url = normalizeServerUrl(input.value); } catch { url = ''; }
      if (!url) { err.textContent = 'Enter an address like http://192.168.1.20:8080'; err.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = 'Connecting…';
      try {
        await testServer(url);
        setServerUrl(url);
        wrap.remove();
        resolve(true);
      } catch (ex) {
        err.textContent = `${ex.message}. Check the address, that Docker is running, and that the phone is on the same network.`;
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    });
  });
}

/** Must be awaited before the first API call. */
export async function ensureServer() {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  if (!getServerUrl()) await showConnectScreen();
}

// ---------- reminders as local notifications ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Pure planner: which reminders to schedule for the next `days` days.
 * Uses each habit's heatmap (which covers up to the end of the current week)
 * to skip today if it's already done, and the rest of the week if a weekly
 * target is already met.
 */
export function planReminders(habits, now = new Date(), days = 14) {
  const out = [];
  for (const h of habits) {
    if (!h.reminder_time) continue;
    const [hh, mm] = h.reminder_time.split(':').map(Number);
    const daysMask = h.reminder_days || '1111111';
    const done = new Set();
    for (const col of h.heatmap || []) for (const c of col) if (c.done) done.add(c.date);
    for (let i = 0; i < days; i++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
      if (at <= now) continue;
      const dow = (at.getDay() + 6) % 7;
      if (daysMask[dow] !== '1') continue;
      const key = keyOf(at);
      if (done.has(key)) continue;
      if (h.frequency === 'weekly') {
        const ws = new Date(at); ws.setDate(at.getDate() - dow);
        let n = 0;
        for (let k = 0; k < 7; k++) { const d = new Date(ws); d.setDate(ws.getDate() + k); if (done.has(keyOf(d))) n++; }
        if (n >= Math.max(1, h.target_per_week || 1)) continue;
      }
      out.push({
        id: h.id * 100 + i, // unique per habit and day offset (i < 100)
        title: h.name,
        body: h.frequency === 'weekly'
          ? `Keep your ${h.target_per_week}×/week goal on track.`
          : "Don't break your streak — check in for today.",
        at,
        habitId: h.id,
      });
    }
  }
  return out;
}

export async function notificationStatus() {
  const LN = plugin('LocalNotifications');
  if (!LN) return 'unsupported';
  try { return (await LN.checkPermissions()).display; } catch { return 'unsupported'; }
}

export async function requestNotifications() {
  const LN = plugin('LocalNotifications');
  if (!LN) return 'unsupported';
  return (await LN.requestPermissions()).display;
}

/** Replaces all scheduled reminders with a fresh plan. Returns how many were scheduled. */
export async function syncReminders(habits) {
  const LN = plugin('LocalNotifications');
  if (!LN) return 0;
  if ((await notificationStatus()) !== 'granted') return 0;
  const pending = await LN.getPending();
  if (pending.notifications.length) {
    await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  const plan = planReminders(habits);
  if (plan.length) {
    await LN.schedule({
      notifications: plan.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        schedule: { at: p.at, allowWhileIdle: true },
        extra: { habitId: p.habitId },
      })),
    });
  }
  return plan.length;
}

// ---------- app lifecycle ----------
/**
 * @param {object} h  { onResume(), onBack(): boolean }  onBack returns true if it handled the press.
 */
export function initNativeShell({ onResume, onBack }) {
  if (!isNative) return;
  const App = plugin('App');
  if (!App) return;
  App.addListener('appStateChange', ({ isActive }) => { if (isActive) onResume(); });
  App.addListener('backButton', () => {
    if (!onBack()) App.minimizeApp ? App.minimizeApp() : App.exitApp();
  });
  plugin('LocalNotifications')?.addListener('localNotificationActionPerformed', () => onResume());
}
