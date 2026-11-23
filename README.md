# Habit Tracker

A self-hosted habit tracker with a dark UI, built to run on **Docker Desktop**.

- ✅ Daily or *N-times-per-week* habits with custom icon and color
- 📅 Week strip with progress rings: tap any day to view or edit it
- 🔥 Streaks (days or weeks) and an overall **Habit Score**
- 🟩 GitHub-style heatmap per habit: click any square to toggle that day
- 📝 A note per habit per day (journal)
- 🔎 Filter between **All** and **Due**
- 📊 **Stats** tab: monthly calendar, best/current streaks, 30-day rates, check-ins by weekday and over the last 12 weeks
- 🔔 **Reminders** via push notifications at a time and on days you choose for each habit
- 📲 **Installable** as an app (PWA), with the app shell cached for offline use
- 💾 SQLite storage on a Docker volume, plus JSON export/import

## Run with Docker Desktop

```bash
git clone <this repo> habit-tracker
cd habit-tracker
docker compose up -d --build
```

Open **http://localhost:8080**.

Your data lives in the `habit-data` Docker volume, so it survives restarts, rebuilds and upgrades.
In Docker Desktop you'll see the `habit-tracker` container under **Containers** (click the
`8080:3000` port link to open it) and the volume under **Volumes**.

| Task | Command |
| --- | --- |
| Stop | `docker compose down` |
| Update after pulling changes | `docker compose up -d --build` |
| View logs | `docker compose logs -f` |
| Use another port | change `"8080:3000"` in `docker-compose.yml` |
| Delete **all** data | `docker compose down -v` |

**Backups:** Settings (⚙) → *Export backup* downloads a JSON file, and *Import backup* restores one.

## Reminders and installing as an app

1. **Set your time zone** in `docker-compose.yml` (`TZ=`, e.g. `Asia/Kolkata`; the default is `UTC`), then
   run `docker compose up -d` again. Reminder times use this zone.
2. Open **http://localhost:8080** (use `localhost`: browsers only allow notifications and install on
   `https` or `localhost`).
3. Settings ⚙ → **Enable notifications on this device** → allow. Use **Send test notification** to check.
4. Edit a habit (tap its icon) → turn on **Daily reminder** → pick a time and days.

A reminder fires once a day at or after its time, only if the habit is still due, and only while the
container is running. If a habit is already done, no reminder is sent.

To **install**, use the install icon in Chrome/Edge's address bar, or Settings ⚙ → *Install as app*.
It then opens in its own window like a desktop app.

> Opening the app from your phone via your computer's LAN IP (`http://192.168.x.x:8080`) works for
> tracking, but phones block notifications and install over plain `http`. For that you'd need HTTPS,
> e.g. a reverse proxy such as Caddy or a Tailscale/Cloudflare tunnel.

## Run without Docker (development)

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:3000, DB stored in ./data/habits.db
npm test         # unit tests for streak / score logic
```

## How things are calculated

- **Daily streak:** consecutive completed days up to today. An unfinished *today* doesn't break it.
- **Weekly streak:** consecutive Mon–Sun weeks that met the target. The current week adds to the streak once its target is met.
- **Due:** a daily habit not done on the selected day, or a weekly habit whose target isn't met yet that week.
- **Habit Score:** for each habit, completions ÷ expected check-ins since it was created (today and the
  current week never count against you), averaged across habits.
- **Day rings:** share of habits completed (or weekly targets already met) on that day.

## Project layout

```
server/index.js   Express API + static file server
server/db.js      SQLite schema
server/stats.js   streak / score / heatmap / insights logic
server/reminders.js  web-push + reminder scheduler
public/           vanilla HTML/CSS/JS frontend (no build step), service worker, manifest
test/             node:test unit tests
```
