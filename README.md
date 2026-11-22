# Habit Tracker

A self-hosted habit tracker with a dark UI, built to run on **Docker Desktop**.

- ✅ Daily or *N-times-per-week* habits with custom icon and color
- 📅 Week strip with progress rings: tap any day to view or edit it
- 🔥 Streaks (days or weeks) and an overall **Habit Score**
- 🟩 GitHub-style heatmap per habit: click any square to toggle that day
- 📝 A note per habit per day (journal)
- 🔎 Filter between **All** and **Due**
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
server/stats.js   streak / score / heatmap logic
public/           vanilla HTML/CSS/JS frontend (no build step)
test/             node:test unit tests
```
