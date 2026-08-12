# Play screen — patron vs staff

The tablet scoring UI is **`/play`**. Match setup is **`/`**. Idle play landing is **`/play`** with no active match (“Set up a game”).

## Patron chrome (kiosk)

On setup and scoring:

- Site-wide AppShell nav (Play · TV · Players · …) is **hidden**
- A single **Stats** link opens the leaderboard (`/leaderboard?from=play&back=…`)
- Staff still reach admin via long-press logo + PIN, tiny Admin control, `?admin=1`, or direct **`/admin`**

**Leaving without the browser back button**

| Screen | Control | Result |
|--------|---------|--------|
| Setup `/` | **Cancel** (header + next to Start) | Returns to idle `/play` without starting a match |
| Setup `/` resume card | **Cancel** | Abandons the stranded match — clears `no3_active_game` + seat-auth (in-app confirm if scoring started) |
| Active `/play` | **End game** (header + bottom) | Tears down the match → idle `/play`. In-app confirm if any scoring has started (discard — not a save prompt). Does **not** use the browser `confirm()` dialog (unreliable on iPad kiosk). |

On secondary screens opened from play (e.g. Stats):

- Full site nav stays hidden
- **Back to play** returns to setup (`/`) or scoring (`/play`)
- **~50s idle** with no touch/key/scroll activity auto-returns to that play screen
- Idle never runs on setup/scoring itself — only after navigating away

Optional **Admin → Kiosk mode** hides site-wide nav on every route.

**Tournament match ready** does **not** appear on cold patron `/play` or `/`. Staff must unlock the tablet first (same PIN as Edit / End turn). See [TOURNAMENT.md](./TOURNAMENT.md).

## X01 outshots

On **X01** (and Random Checkout practice), when the thrower’s remaining score is in a finishable range (≤ 170, double-out when that rule is on), `/play` shows a preferred **outshot** path (e.g. `T20 T19 D12`). It updates as darts land. Baseball / 41 / Killer stay uncluttered — no checkout chrome there.

## End of match — auto-save

When a match is **won**, the tablet **saves automatically** (no “Save?” dialog):

- Registered (PIN) players get history / stats / leaderboard credit (same rules as before)
- Guest-only matches stay ephemeral
- After a short MATCH banner, the tablet returns to idle `/play` ready for the next game

**Leg won** (best-of still open): **Next leg** stays; **End game** can still discard the unfinished match.

Ending a completed match clears the **match** and match seat-auth — it does **not** sign the tablet out.

## Saved players (50+ directory)

- **Cold start** (nobody signed in on this tablet): idle `/play` and setup do **not** dump the full roster. Use **Saved players** → searchable picker → name → PIN.
- **Already signed in** (haven’t logged out): setup shows those PIN-trusted names as quick chips so you can re-seat them between games without opening the picker. **Saved players** remains available to add someone new from the directory.
- **Guests** still use + Guest with no PIN.
- **Bots** — see [Bot opponents](#bot-opponents) below.
- Empty directory: picker says so and offers **Create account**.
- Wired to `GET /api/players` (same register + PIN data as before).
- After **2 minutes idle** (not mid-match) everyone is signed out → next visit is the cold picker path again.

## Bot opponents

From match setup (`/`), patrons can seat one or more **bot** opponents alongside guests / PIN players (or play human vs bot).

### How to add a bot

1. Open setup (`/` from idle `/play`).
2. Pick a mode (X01 recommended; Cricket works too).
3. Under **Bot opponent**, tap a difficulty chip, then **+ {name}**.
4. Seat humans as usual (Saved players / Guest). Start the match.

Bot seats show a red **BOT** badge (and difficulty) on setup chips and on `/play` score cards.

### Difficulty ladder

| Chip | Role |
|------|------|
| Rookie | Easy — low averages, shaky doubles |
| Pub Regular | Medium pub night |
| League Night | Harder league pace |
| Match Sharp | Strong scoring |
| Pro | High finish rate |
| **Luke Littler** | Hardest — elite scoring + checkouts |

The hardest bot is always named exactly **Luke Littler**.

### Luke Littler calibration (Aug 2026)

Tuned toward real-world recent form (not a perfect aimbot):

| Knob | Target feel |
|------|-------------|
| 3-dart scoring average | **~100–103** (profile `scoringAvg` 101; 12-mo ~101.1 / L200 ~103) |
| Checkout conversion | **~43–46%** (`checkoutSkill` 0.45) — misses doubles like elite humans |
| Scoring style | Heavy **T20** (“Nuke”); lots of 180s when hot |
| Finish routes | Classic table routes when reasonable — e.g. **141 = T20 T19 D12**, **170 = T20 T20 Bull** |

Knobs live in `src/engine/bot/profiles.ts`. Aim/treble bias are paired so simulated T20-lane scoring visits land near that average band (see bot unit smoke test).

### How bots throw

- When it’s a bot’s turn, the tablet **generates darts itself** after a short delay (~0.7s before the first dart, ~0.85s between darts) so the visit reads naturally — not instant spam.
- Manual board / keys input is disabled for that visit; Autodarts/camera scoring is paused for bot throwers so camera darts don’t collide.
- When a human’s turn returns, camera + board behave as before.
- Ending / aborting the match cancels any pending bot timer.

### Stats & PIN

- Bots are **not** registered PIN players. No account, no seat PIN, no leaderboard / history credit for the bot seat.
- Human PIN players still get credit for **their own** performance when a registered player is in the match (same rules as guest-mixed games).
- Guest-only vs bots: no history (ephemeral), same as guest-only matches.

### Modes (bot AI)

Bots are **mode-aware** — they aim at the current mode’s target, not blind T20:

| Mode | Bot behaviour |
|------|----------------|
| **X01** | T20/T19 scoring lanes + checkout table (Luke prefers classic routes) |
| **Cricket** | Marks on open numbers (highest first), not blind T20 |
| **41** | Current round target (20 → 19 → any double → … → exact 41 → bulls). Exact-41 plans a 3-dart sum of 41 |
| **Baseball** | Only the inning number (S/D/T) |
| **Killer** | Arm / kill on doubles of the assigned number |
| Other | ATC follows next target; Shanghai / Count-Up / Bermuda score T20-ish |

Planners live in `src/engine/bot/generate-visit.ts` (`planFortyOneAim`, etc.).

## Resume & sign-in

In-progress matches are kept in the tablet’s `localStorage` (`no3_active_game`) so **Resume** on the home setup screen can return to `/play`.

Registered (name + PIN) seats are **not** trusted from that blob alone:

- Starting a match records seat verification (`no3_seat_auth`).
- **Sign out** (or a lost session cookie) invalidates that player’s seats.
- A **fresh page load / app restart** (iPad clear-apps → reopen) or **opening the board `/play` link** clears scoring trust **and** the sticky session chrome (cookie + tablet roster) even if site data survives — idle play does not show “Signed in”, and Resume re-prompts PIN before scoring.
- Loading / resuming an in-progress match re-checks every non-guest seat. If any need PIN again, scoring is blocked until they re-enter PIN (or **Abort match**).
- Pure **guest** matches resume with no PIN. Mixed matches only re-prompt the registered seats.
- Mid-match on a **continuous** kiosk session (no full reload) keeps seat trust after PIN; idle 2-min logout still only arms off idle play/setup.

### Session stickiness + idle logout

- If a player has **not** signed out, they **stay signed in** across end-game → start-next-game loops on the **same continuous SPA session** (no re-PIN just because a match ended).
- A **new document load** of `/play` or setup `/` (board bookmark, reload, app restart) always starts **cold** — cookie alone must not show Signed in or unlock scoring.
- PIN entry when nobody is signed in on the tablet **establishes** the session cookie (sticky for that document session). Unlocking another registered seat while someone is already signed in still uses verify-without-stealing-session.
- If the tablet sits on **idle play / setup** (not mid-match) with **no touch/key/scroll for more than 2 minutes**, everyone on that tablet is signed out and the next game needs PIN again.
- Thinking time between darts mid-match never triggers that logout.
- Explicit **Sign out** still clears immediately (and invalidates seat-auth).

Guests stay ephemeral (no history / leaderboard). Do not continue scoring under a signed-out registered name.

## Live MPR / PPR

During active scoring, each seat shows a live per-round rate (updates as darts land and after undo/correct):

| Mode | Shown | Definition |
|------|--------|------------|
| **Cricket** | **MPR** | Marks ÷ visits (Autodarts/league marks-per-round) |
| **X01** (also Count-Up, Shanghai, Random Checkout) | **PPR** | Points scored ÷ visits (bust visit = 0 points) |
| Baseball / 41 / Killer / Bermuda / ATC | — | Hidden (no clean mapping) |

**Multi-leg** matches (`legsToWin > 1`) format as `currentLeg / overall` (e.g. MPR `2.45 / 2.61`). **Single-leg** matches show one number only.

Also on the TV view when those modes apply.

## How to play

Patrons (guests and PIN players — no staff unlock) can open **How to play** for the
**currently selected / active mode**:

- **Setup `/`** — button next to the Mode picker (content follows the selected chip)
- **Active `/play`** — button in the match header (peek rules mid-game without ending)

It opens a **modal sheet** (not a new route), so kiosk Back / `from=play` idle chrome
stays on the play flow. Copy is plain English (goal, scoring, how you win, examples,
special rules) and tracks the engine — including John’s Baseball, 41, and Killer rules.
Source: `src/lib/how-to-play.ts`.

## Patron (default)

Clean bar / kiosk UI for players:

- Big scores, thrower name, mode banner (Baseball / Killer / …)
- Live **MPR** (Cricket) / **PPR** (X01) on seat cards
- **How to play** for the active mode (modal — see above)
- X01 outshot suggestions when finishing
- Current visit with **tap-to-correct** (Autodarts misreads)
- **Undo** — big kiosk control; each press steps back one dart (through the open visit, then prior visits as far as the engine allows). Works for camera and manual scores.
- Recent visits (mode-correct Σ — Baseball does **not** sum raw bull values)
- Dartboard for manual entry if needed
- End of match: auto-save → idle (no Save button)

**Static board:** the dartboard sits in a reserved stage. Visit history, seat lists, and banners scroll in the chrome column/band — they do **not** shove the board when a round is scored. Landscape uses chrome | board; portrait uses a fixed board band between scrollable seats and visits. Dense Cricket / many seats stay readable via scrolling.

Hidden from patrons: Edit last, End turn, Pause, Setup, Keys/Pad tabs.

## Staff (admin)

Unlock on the same screen:

| Method | How |
|--------|-----|
| Query | `/play?admin=1` (stays unlocked for the browser tab) |
| Long-press | Hold the No.3 logo ~0.8s → enter staff PIN |
| Admin link | Small “Admin” control top-right → PIN |
| Lock | “Lock” button (or long-press logo again) when unlocked |

Staff PIN is set under **Admin → Staff PIN** (default `1234`). The same default (or Railway `STAFF_PIN`) authorizes **Reset player PIN** on `/admin`.

When unlocked, staff get Edit / End turn / Pause / Setup + Keys/Pad tabs. **Undo** and **End game** are always available (patrons and staff).

Full bar settings remain on **`/admin`**.

## Forgotten player PIN

Only **registered** players have a PIN (guests do not).

1. Open **`/admin`** → **Reset player PIN**.
2. Search / select the player → **Reset PIN**.
3. Enter (or **Generate**) a temporary 4-digit PIN.
4. Enter the **staff PIN** and confirm.
5. Tell the player the temporary PIN so they can sign in on `/play` / setup.

The server stores only a bcrypt hash — never show or log other players’ current PINs. Players cannot change their own PIN yet; staff can reset again anytime. Keep **Admin → Staff PIN** matched with the Railway **`STAFF_PIN`** variable (default `1234` if unset).
