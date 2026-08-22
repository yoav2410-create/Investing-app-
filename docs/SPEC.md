# Portfolio Brief — what this app is, in the owner's words

Everything the owner asked for across the whole build, gathered into one
place. It is written as a brief: hand it to a fresh session and the app that
comes out the other side should be this one. Where an instruction changed
during the build, the **final** decision is what appears here, with the
reversal noted so nobody re-litigates it.

---

## 1. Who this is for, and how they work

- One owner, one book of US equities. Not a product for other people.
- **They work entirely from an iPhone.** No computer of their own. Every
  instruction, approval and check happens on the phone.
- They are not a developer. Explanations are in plain words; jargon gets a
  "?" that says what it means, how to read it, and where it misleads.
- They pay for a **Claude.ai subscription**. That is *not* API access, and the
  app must never assume it is. No feature may depend on API credits.
- Hebrew is their language; the app's own text is English, and conversation
  about it is in Hebrew.

## 2. The one loop the whole app is built around

> Screenshot the broker → send it to the conversation → paste the answer back.

1. The Portfolio screen has **one** button: *Update positions & get insights*.
2. It opens a screen that opens the conversation and offers the current book
   on the clipboard.
3. The owner attaches a broker screenshot and asks for positions and a read.
4. The answer comes back as **one reply carrying both halves** — a positions
   table and a fenced ```json read.
5. **One paste box** takes whatever that answer contains. It tells the two
   apart, applies each to the right place, and applies both when both are
   present.
6. Positions always pass through a **review diff** first. Nothing is written
   to the book until the owner has seen it row by row.

Nothing in the app may require more than this. No second button for
"analyse", no separate flow for positions and insights — it is one errand.

## 3. What must never happen

- **Never invent a number.** A value that is not known renders as an em dash,
  never as zero, never as an estimate. A broken chain stops at the last known
  figure. A weighted average states the share of the book it covers.
- **Never present demo data as theirs.** The bundled seed exists so screens
  have something to draw; while it is in force the Portfolio screen says so
  in a warning card, and the card disappears the moment a real import lands.
- **Never put the owner's positions in the repository.** It is public. Their
  book lives only in the browser storage on their phone. Not in the seed, not
  in a test fixture, not in a screenshot committed to `docs/`. Test fixtures
  use invented tickers.
- **Never ship a secret.** No API key, no token, no session link in the
  bundle. Keys live on the device; the conversation link is set in Settings.
- **Never keep a feature that cannot run.** A control that can only answer
  "add a key" is a dead control wearing a live one's clothes — remove it,
  and remove the code behind it too.
- **Never show a figure that can never update.** Realised P&L was removed for
  exactly this reason: the screenshot carries no such field.
- **No pull requests. No pushes to `main`** except the deploy workflow file,
  which must live there for the cron to register.
- **No model identifier** in any commit message, comment, or anything else
  that reaches the repository.

## 4. Data: where every number comes from

| What | Source | Refresh |
| --- | --- | --- |
| Prices | Finnhub, fetched by GitHub Actions into `quotes.json` | Every 15 min, weekdays 13:00–21:00 UTC |
| Live ticks | Finnhub WebSocket, device key, US session only | Sub-second while the app is open |
| Price corroboration | CBOE delayed-quote CDN, 12 symbols per publish | Every publish; result shown in Settings |
| VIX | CBOE official history CSV | Every publish |
| Positions | The owner's broker screenshot, via the conversation | When they choose |
| Analysis | The conversation, pasted back | When they choose |

Rules that follow from this:

- Prices update **without the owner doing anything**, including while the app
  is closed. This was non-negotiable from early on.
- **100% coverage of held names, by construction**: the published feed covers
  a wide universe, and a device Finnhub key closes any gap. Coverage is never
  "97%" — if the feed misses a name the key fetches it.
- Every block carries its own `asOf` and `source`, shown on Data sources.
- The cross-check must run **where it actually runs**. Yahoo answers a laptop
  and refuses a browser *and* GitHub's servers; it was replaced by CBOE for
  that reason. When a check cannot run, the app says so rather than showing
  blank space.

## 5. What the owner wants to see

### Portfolio (front page)
- Net liquidation value, day P&L, and how old the marks are — with a live dot
  while ticks are streaming.
- The one button.
- The demo-data warning, while it applies.
- A one-sentence computed headline (up/down counts, heaviest sector, cash).
- Claude's read, when there is one.
- **Sector pie**, tappable through to the Sectors page, same colours
  everywhere, colour tied to the sector and never to rank.
- **The book**: total value, % in equities, % in cash, % in T-bill ETFs,
  estimated dividends with coverage, return on cost.
- **Year-over-year growth** chart, from the app's own snapshots, which
  understates rather than extrapolates.
- **Cash vs fear**: the VIX year chart with its regime bands and where we are
  now. The chart only — the contrarian logic (higher VIX → higher chance the
  market rises → deploy; low VIX → complacency → hold cash) lives behind
  the "?".
- **Where this book could end up**: the Monte Carlo, on the front page.
- Today's movers, and what needs attention.

### Stock page — structured like a quote page
- Header pinned: back, ticker, price, search.
- Four tabs with a sliding underline, one continuous piece of navigation:
  **Summary · News · Analysis · Financials**.
- **What this business is** at the top of Summary: what it sells, **where in
  the world it operates**, through which channels, and who the end customer
  is. Three to four factual sentences, 55–75 words, no pitch.
- Verdict with its reasoning and when it was written.
- Momentum, the case (catalyst / risk / bull / bear / what would change it).
- **Financials**: revenue vs earnings as paired bars on one scale, with an
  **Annual / Quarterly** toggle. Annual means complete calendar years —
  **2024, 2025 and TTM** — and a year missing a quarter is not drawn.
- **Latest earnings call** carries the dry figures *and* verbatim quotes from
  management on momentum, backlog and guidance, each attributed and tagged
  by topic. A paraphrase is not a quote.
- Business quality shows only the metrics it has, and says in one line what a
  research pass would add. Not a grid of dashes.
- Insider filings, not options positioning. Options were removed entirely.

### Sectors
- The donut on top, then every slice opened into its positions with the same
  colours, drift against target, and where the targets came from.

### Charts, everywhere
- Y axis on every chart, labelled on the gridlines.
- **Every period labelled, evenly spaced** — an even stride counted back from
  the newest point, never a run with holes in it.
- Touch read-outs on the marks.
- Gradient fills under lines, a faint grid, an emphasised endpoint.

### AI insights
- Concentration, effective positions, breadth, event risk — all computed
  offline and always available.
- The read on top: what the book is betting on, what moves together, the
  biggest risk named rather than hedged, sector targets that total 100.
- The read's moves are **pinned as a checklist**, ticked as they are done,
  and fed back into the next read. There is no standing plan document; the
  Plan tab was deleted for this reason.

## 6. What was explicitly removed, and must not come back

| Removed | Why |
| --- | --- |
| The Plan tab | The plan is dynamic: ask, get moves, pin them, tick them |
| Options / put-call positioning | Blurs hedging with conviction; insiders answer it better |
| Realised P&L | No source can ever update it |
| Daily attribution on Returns | Daily moves are not what the owner cares about |
| Alpha Vantage section, daily call budget | Not relevant once prices are automatic |
| Manual price-refresh button | Prices refresh themselves; a button implies they do not |
| Duplicate "Update from screenshot" in More | *(later restored — see below)* |
| The Anthropic API key, and all code behind it | A subscription is not API access |
| Gemini | Its only job was reading screenshots; the conversation does that |

**Restored after removal:** the *Update positions* row in More. It was cut as
redundant, and the owner went looking for it exactly there. More is where a
person looks for the thing that changes their positions.

## 7. Look and feel

- Should read as **a finished product ready for release**, not a project.
  Inspiration from modern finance apps — structure, navigation, cards,
  charts — while keeping its own identity.
- IBM Plex Sans, self-hosted. One blue accent. Soft-shadow cards on a cool
  near-white or near-black ground.
- **Both themes designed, not inverted.** Every colour comes from tokens;
  dark-theme chart labels are re-inked for the lighter fills.
- Colour-blind-safe categorical palette, validated rather than eyeballed.
- Floating rounded tab bar with an active pill, clear of the home indicator
  without a band of dead space beneath it.
- Consistent spacing, one type scale, real hierarchy, tappable things that
  look tappable, loading and empty and error states that say something.
- Nothing clipped, nothing colliding, at 375pt and 440pt, in both themes.

## 8. How the owner verifies it

- Screenshots of the **live site**, not a local build, at the end of a change.
- Every claim checked against the deployed page.
- The suite: typecheck, unit tests, and screen checks that *press controls*
  rather than photograph them — screenshots, interaction, features,
  simulation, allocation, backup, privacy, PWA.
- **A check that cannot fail is not a check.** Every new assertion is proven
  by deliberately breaking the thing it guards and watching it go red.
- Look at the PNGs. Three real bugs in this project were found only that way.

## 9. Security and privacy

- Public repository, deliberately: the bundle is what controls exposure, so
  the seed is neutral demo data and `privacy-check` fails the build if
  anything owner-specific or credential-shaped reaches `dist/`.
- Keys are on the device, excluded from the backup file, and Settings states
  exactly where they are kept on this platform.
- Screenshots and positions never leave the phone except in the conversation
  the owner chooses to send them to.
- The owner's email is in the git history; only a fresh repository fixes that.

## 10. The standing rule for the conversation

When a broker screenshot arrives:

1. Transcribe only what is printed. Null beats a plausible guess.
2. Reply with **both halves in one message** — the positions table and the
   ```json read.
3. The read is the judgement part: what the book is really betting on, what
   moves together regardless of sector label, the single biggest risk, and
   targets that total 100 with a reason on each.
4. Their positions never enter the repository.
