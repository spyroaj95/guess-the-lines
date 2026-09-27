# Guess the Lines

Bill Simmons and Cousin Sal's Sunday-night game, built for a group chat. Everyone guesses next
week's NFL spreads. The app keeps the real lines hidden until everyone locks, then pulls them from
ESPN (DraftKings) and scores it.

## How it's scored

- **Closest guess takes the game.** Ties split it.
- **Most games takes the week.** Tiebreak: lower average miss.
- **The season is ranked by average miss per game** ("avg off"), so someone who joins in Week 6
  isn't punished for the weeks they missed.
- Also tracked: **exact** hits, and **flips** (picked the wrong favorite).

## Try it on your computer (demo mode)

```bash
cd guess-the-lines
python3 -m http.server 8765
```

Open http://localhost:8765. In demo mode everything is saved in that browser only. Tap your name
chip at the top to add a second player and try both sides.

## Put it online (one time, about 10 minutes)

### 1. Firebase: stores everyone's guesses (free)

1. Go to https://console.firebase.google.com and create a project called `guess-the-lines`.
   You don't need Google Analytics.
2. Open **Firestore Database** (under *Build* in the left menu) and click **Create database**.
   Pick a location near you and start in **production mode**.
3. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules),
   and click **Publish**.
4. Click the gear → **Project settings** → **Your apps** → the **`</>`** (Web) button. Give it any
   nickname, skip Firebase Hosting, and click **Register app**.
5. Copy the `firebaseConfig = { … }` block it shows and paste it into [`js/config.js`](js/config.js)
   in place of `null`.

That config, `apiKey` included, is meant to be public. It only identifies the project. The data is
protected by the rules file plus the league's private invite link.

### 2. GitHub Pages: hosts the app (free)

1. On github.com, create a new **public** repository called `guess-the-lines` (no README).
2. Push this folder:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/guess-the-lines.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` /
   `(root)` → Save**.
4. About a minute later the app is live at `https://YOUR-USERNAME.github.io/guess-the-lines/`.

### 3. Start the league

Open the site, tap **Start a league**, and add your name. Then tap **+ Add** → **Copy link** and
send it to the group. The link is the league's password: anyone who has it can join.

## Adding players

Anyone can join any week, right up until that week's lines are revealed. Tap **+ Add**:

- **On their phone:** copy the league link and send it. They open it, add their name, and they're in.
- **On this phone:** type their name and hand them the phone. When they've locked, tap the gold
  chip at the top to switch back to yourself.

Occasional players don't hold anyone up. The reveal waits for everyone guessing this week, everyone
who played last week, and anyone new. A friend who played once and hasn't been back isn't waited on.
The season table ranks by average miss, so joining late doesn't hurt anyone's standing.

## Sunday night

1. The app opens on the next week that hasn't kicked off.
2. Tap the team you think is favored, then set the number with − / +, or tap the number for the
   full picker.
3. **Lock my lines.** Nobody can see anyone else's numbers.
4. Once everyone's locked, anyone can hit **Reveal**. The app grabs the current DraftKings lines
   from ESPN and saves them, so they can't move afterward.
5. If ESPN has no line for a game, tap the line on the Results screen and fill it in.

It runs on the honor system. The lines are already posted on sportsbooks, so nothing stops
someone from peeking.

## Under the hood

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | The whole UI. No build step. |
| `js/app.js` | Screens and game flow |
| `js/scoring.js` | Scoring rules (pure functions, unit tested) |
| `js/espn.js` | Schedule and lines from ESPN's public scoreboard (no key needed) |
| `js/store.js` | Demo store (localStorage) and the shared Firestore store |
| `firestore.rules` | Database security rules |

Run the tests with `node --test test/*.test.mjs`.

**Optional hardening:** in Google Cloud Console → *APIs & Services* → *Credentials*, restrict the
"Browser key (auto created by Firebase)" to `https://YOUR-USERNAME.github.io/*` so the key only
works from your site.
