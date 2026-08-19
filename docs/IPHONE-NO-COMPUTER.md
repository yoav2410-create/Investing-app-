# Getting the app onto your iPhone with no computer, for free

Everything here is done from Safari on the phone. No Mac, no PC, no Apple
Developer account, nothing to pay.

**What you end up with:** the app with its own icon on your home screen, opening
full screen with no browser bars, working offline for everything except the
Claude calls. Not "a website you bookmarked" — iOS treats it as an app.

**Roughly 20 minutes**, most of it waiting for a build you do not have to watch.

---

## How this works, in one paragraph

GitHub can run the build for you on its own computers and publish the result as
a website. That is what `.github/workflows/deploy.yml` in this repository does.
You press a button on the GitHub website from your phone, GitHub builds the app,
and about five minutes later it is live at a fixed address. Safari can install
any such address to the home screen as a real app. So the "computer" in the
process is GitHub's, and it is free.

---

## Part 1 — Turn on the website (once)

### Step 1. Open the repository

In Safari, go to:

```
https://github.com/yoav2410-create/Investing-app-
```

Sign in if it asks. **Tap `aA` in the address bar → Request Desktop Website.**
The GitHub mobile site hides the menus you need; the desktop site works fine on
a phone once you zoom.

### Step 2. Switch Pages on

1. Tap **Settings** (the tab across the top of the repository, with the gear).
2. In the left sidebar, scroll to **Pages**.
3. Under **Build and deployment** → **Source**, open the dropdown and choose
   **GitHub Actions**.

There is nothing to save — it applies as you choose it.

> If you do not see a Settings tab, you are signed in as the wrong account or
> looking at someone else's copy. Settings appears only for repositories you own.

### Step 3. Allow Actions to run

1. Tap the **Actions** tab at the top.
2. If a green button says *"I understand my workflows, go ahead and enable
   them"*, tap it. If you instead see a list of workflows, this is already done.

---

## Part 2 — Build it

### Step 4. Start the build

1. Still on the **Actions** tab.
2. In the left sidebar, tap **Deploy to GitHub Pages**.
3. On the right, tap **Run workflow**. A small panel opens.
4. In the branch dropdown choose **`claude/iphone-investment-app-frn8sy`**.
5. Tap the green **Run workflow**.

The page does not always refresh itself. Pull down to reload and a new run
appears at the top with a yellow dot.

### Step 5. Wait for the green tick

Tap the run to watch it. It goes through checks, tests, the build, then the
publish. **Five to eight minutes.** You can lock the phone and come back.

- **Yellow dot** — still going.
- **Green tick** — done, the site is live.
- **Red cross** — it stopped. Tap the failed step to see why; the last red lines
  say what broke. Nothing is published when a run fails, on purpose: an app that
  will not load is worse than yesterday's app still loading.

### Step 6. Open the app

Go to:

```
https://yoav2410-create.github.io/Investing-app-/
```

The app loads. This is the whole thing — portfolio, stocks, sectors, plan,
market with the Monte Carlo, AI insights.

> **A white screen** usually means the site is not live yet. GitHub Pages can
> take an extra minute or two after the green tick on the very first publish.
> Wait two minutes and reload.

---

## Part 3 — Install it to the home screen

### Step 7. Add to Home Screen

With the app open in Safari:

1. Tap the **Share** button — the square with an arrow out of it, at the bottom
   of the screen.
2. Scroll the list down to **Add to Home Screen**.
3. The name shows as **Brief**. Change it if you like.
4. Tap **Add**, top right.

The icon is now on your home screen.

### Step 8. Open it from the icon, not from Safari

Tap the new icon. It should open **full screen, with no address bar**. That is
how you know iOS installed it as an app rather than a bookmark.

From here on, always open it from this icon. The app keeps its data separately
from Safari, so a book you set up in Safari will not appear in the installed app
and the other way round. Set it up once, in the installed one.

---

## Part 4 — Make it yours

### Step 9. Get an Anthropic API key

This is the only part that costs money, and it is small — a few cents per stock
researched, a fraction of a cent per screenshot read. You put in credit yourself,
so it cannot surprise you.

In Safari (a normal tab, not the app):

1. Go to **console.anthropic.com** and sign in or sign up.
2. **Settings → Billing** → add some credit. $5 goes a very long way here.
3. **Settings → API Keys → Create Key**. Name it "Portfolio Brief".
4. **Copy it now.** Anthropic shows the key exactly once. Long-press → Copy.

### Step 10. Put the key in the app

1. Open the app from the home-screen icon.
2. **More → Settings**.
3. Under **Claude**, tap the box and paste the key.
4. Tap **Save key**. It should then show `Currently: ••••` and the last four
   characters.

The key stays in this browser's storage on your phone. It is not in the code,
not on GitHub, and goes nowhere except to Anthropic when the app calls it. That
is weaker than the iOS keychain a native build would use — the Settings screen
says so plainly — and it is the right trade for not needing a computer.

### Step 11. Load your real positions

1. Take a screenshot of your broker's positions screen, the normal way
   (side button + volume up).
2. In the app: **Portfolio → Update from a screenshot**.
3. Tap **Choose a screenshot** and pick it from your photos.
4. Claude reads it. This takes 10–30 seconds.
5. **A review screen appears showing exactly what it thinks changed** — added,
   removed, changed, per ticker. Anything it was unsure about is flagged.
6. Check it. Untick any row you do not want. Tap **Apply**.

Nothing is written until you tap Apply. That review is not a formality: it is
the one place where a confident misreading would quietly corrupt everything
built on top of it.

Applying it starts the research automatically — Claude works through every
position that changed, one at a time, searching the web for the latest earnings
call, analyst targets and news. That takes a few minutes for a full book. You
can watch the progress on the Portfolio screen, and you can leave the app while
it runs.

---

## Updating it later

Any time the code changes, repeat **Step 4** — Actions → Deploy to GitHub Pages
→ Run workflow. Five minutes later, close the app fully (swipe up from the app
switcher) and reopen it from the icon.

Your positions, keys and history are stored on the phone, not in the build, so
updating never wipes them.

---

## What you do not get on this route

Worth knowing up front so you are not waiting for something that is not coming:

- **No background refresh.** The app updates when you open it. It cannot wake up
  on its own — iOS does not run home-screen web apps in the background.
- **No notifications.** The alert rules exist and are evaluated, but nothing can
  reach you when the app is closed.
- **No Face ID lock.** There is no biometric prompt available, so the toggle is
  switched off and says why.
- **Photos, not the camera roll picker you get natively.** Tapping *Choose a
  screenshot* opens the normal iOS file picker. It works; it just looks like a
  file picker.

Everything analytical is identical: every screen, every chart, the screenshot
import, the research passes, the FCF bridge, the Monte Carlo, the AI insights.

If you later want the missing four, that is the native build — `docs/IPHONE.md`
covers it. It needs an Apple Developer account at $99/year, and nothing else
changes.

---

## When something goes wrong

**The workflow run is red.** Tap the run, tap the step with the red cross, read
the last lines. If it is `Typecheck` or `Test`, the code has a genuine problem
and nothing was published — your existing app still works. If it is
`Deploy to GitHub Pages`, Pages is probably not switched on: go back to Step 2.

**"Add to Home Screen" is not in the share sheet.** You are in a browser other
than Safari. Chrome and Firefox on iOS cannot install web apps. Open the address
in Safari.

**The icon opens Safari with an address bar.** iOS made a bookmark rather than an
app. Delete the icon, open the address in Safari again, and re-add it — this
happens when the page had not finished loading before you tapped Share.

**The app opens but says "no API key".** Step 10, and make sure you are in the
app opened from the home-screen icon rather than a Safari tab. They store data
separately.

**Claude returns an error when reading a screenshot.** Almost always no credit on
the Anthropic account. Check Billing at console.anthropic.com.

**The app forgot everything.** Something cleared website data for that site —
iOS does this if storage runs low and the app has not been opened for a long
while. Re-enter the key and re-import a screenshot. This is the real cost of the
free route; a native build keeps its data properly.

**Everything shows unfamiliar stock positions.** That is the bundled sample data.
You have not imported a screenshot yet, or you did not tap Apply on the review
screen.
