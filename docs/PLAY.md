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
| Active `/play` | **End game** (header + bottom) | Tears down the match → idle `/play`. Confirms if any scoring has started (discard — not a save prompt) |

On secondary screens opened from play (e.g. Stats):

- Full site nav stays hidden
- **Back to play** returns to setup (`/`) or scoring (`/play`)
- **~50s idle** with no touch/key/scroll activity auto-returns to that play screen
- Idle never runs on setup/scoring itself — only after navigating away

Optional **Admin → Kiosk mode** hides site-wide nav on every route.

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

Idle `/play` and setup do **not** dump every registered name on screen.

- **Saved players** opens a searchable, scrollable picker (type-ahead by name, thumb-friendly on iPad).
- Tap a name → enter PIN (existing pad). That player is signed in / available for seats.
- **Guests** still use + Guest with no PIN.
- Empty directory: picker says so and offers **Create account**.
- Wired to `GET /api/players` (same register + PIN data as before).

## Resume & sign-in

In-progress matches are kept in the tablet’s `localStorage` (`no3_active_game`) so **Resume** on the home setup screen can return to `/play`.

Registered (name + PIN) seats are **not** trusted from that blob alone:

- Starting a match records seat verification (`no3_seat_auth`).
- **Sign out** (or a lost session cookie) invalidates that player’s seats.
- Loading / resuming an in-progress match re-checks every non-guest seat. If any need PIN again, scoring is blocked until they re-enter PIN (or **Abort match**).
- Pure **guest** matches resume with no PIN. Mixed matches only re-prompt the registered seats.

### Session stickiness + idle logout

- If a player has **not** signed out, they **stay signed in** across end-game → start-next-game loops (no re-PIN just because a match ended).
- PIN entry when nobody is signed in on the tablet **establishes** the session cookie (sticky). Unlocking another registered seat while someone is already signed in still uses verify-without-stealing-session.
- If the tablet sits on **idle play / setup** (not mid-match) with **no touch/key/scroll for more than 2 minutes**, everyone on that tablet is signed out and the next game needs PIN again.
- Thinking time between darts mid-match never triggers that logout.
- Explicit **Sign out** still clears immediately (and invalidates seat-auth).

Guests stay ephemeral (no history / leaderboard). Do not continue scoring under a signed-out registered name.

## Patron (default)

Clean bar / kiosk UI for players:

- Big scores, thrower name, mode banner (Baseball / Killer / …)
- X01 outshot suggestions when finishing
- Current visit with **tap-to-correct** (Autodarts misreads)
- Recent visits (mode-correct Σ — Baseball does **not** sum raw bull values)
- Dartboard for manual entry if needed
- End of match: auto-save → idle (no Save button)

Hidden from patrons: Undo, Edit last, End turn, Pause, Setup, Keys/Pad tabs.

## Staff (admin)

Unlock on the same screen:

| Method | How |
|--------|-----|
| Query | `/play?admin=1` (stays unlocked for the browser tab) |
| Long-press | Hold the No.3 logo ~0.8s → enter staff PIN |
| Admin link | Small “Admin” control top-right → PIN |
| Lock | “Lock” button (or long-press logo again) when unlocked |

Staff PIN is set under **Admin → Staff PIN** (default `1234`). The same default (or Railway `STAFF_PIN`) authorizes **Reset player PIN** on `/admin`.

When unlocked, staff get Undo / Edit / End turn / Pause / Setup + Keys/Pad tabs. **End game** is always available (patrons and staff) — same clear path for a stuck match.

Full bar settings remain on **`/admin`**.

## Forgotten player PIN

Only **registered** players have a PIN (guests do not).

1. Open **`/admin`** → **Reset player PIN**.
2. Search / select the player → **Reset PIN**.
3. Enter (or **Generate**) a temporary 4-digit PIN.
4. Enter the **staff PIN** and confirm.
5. Tell the player the temporary PIN so they can sign in on `/play` / setup.

The server stores only a bcrypt hash — never show or log other players’ current PINs. Players cannot change their own PIN yet; staff can reset again anytime. Keep **Admin → Staff PIN** matched with the Railway **`STAFF_PIN`** variable (default `1234` if unset).
