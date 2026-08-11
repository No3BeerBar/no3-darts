# Play screen — patron vs staff

The tablet scoring UI is **`/play`**. Match setup is **`/`**.

## Patron chrome (kiosk)

On setup and scoring:

- Site-wide AppShell nav (Play · TV · Players · …) is **hidden**
- A single **Stats** link opens the leaderboard (`/leaderboard?from=play&back=…`)
- Staff still reach admin via long-press logo + PIN, tiny Admin control, `?admin=1`, or direct **`/admin`**

On secondary screens opened from play (e.g. Stats):

- Full site nav stays hidden
- **Back to play** returns to setup (`/`) or scoring (`/play`)
- **~50s idle** with no touch/key/scroll activity auto-returns to that play screen
- Idle never runs on setup/scoring itself — only after navigating away

Optional **Admin → Kiosk mode** hides site-wide nav on every route.

## Patron (default)

Clean bar / kiosk UI for players:

- Big scores, thrower name, mode banner (Baseball / Killer / …)
- Current visit with **tap-to-correct** (Autodarts misreads)
- Recent visits (mode-correct Σ — Baseball does **not** sum raw bull values)
- Dartboard for manual entry if needed
- End of leg/match: **Next leg** / **Save**

Hidden from patrons: Undo, Edit last, End turn, Pause, Cancel match, Home, Keys/Pad tabs, Discard.

## Staff (admin)

Unlock on the same screen:

| Method | How |
|--------|-----|
| Query | `/play?admin=1` (stays unlocked for the browser tab) |
| Long-press | Hold the No.3 logo ~0.8s → enter staff PIN |
| Admin link | Small “Admin” control top-right → PIN |
| Lock | “Lock” button (or long-press logo again) when unlocked |

Staff PIN is set under **Admin → Staff PIN** (default `1234`).

When unlocked, staff get Undo / Edit / End / Pause / Cancel / Home + Keys/Pad tabs and Discard after a match.

Full bar settings remain on **`/admin`**.
