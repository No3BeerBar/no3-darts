# Play screen — patron vs staff

The tablet scoring UI is **`/play`**. Match setup is **`/`**.

Site-wide AppShell nav (Play · TV · Players · …) is **hidden** on `/`, `/play`, and `/tv`. Optional **Admin → Kiosk mode** hides that nav on every route. Staff still reach **`/admin`** via direct URL, or unlock tools on `/play` (below).

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
