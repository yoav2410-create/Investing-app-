# Publishing the app from a phone — for someone who has never used GitHub

Everything here is done in Safari on the iPhone. No computer, nothing to
install, and one decision to make about privacy that is explained before you
make it.

---

## Where things stand right now

The hard part is already done and proven. GitHub has built this app three times
on its own computers, and every build step passed: it installed the code,
checked it for errors, ran all 64 tests, built the app, and packaged the
website.

The only thing that failed is the very last step — actually publishing it —
because **the publishing feature has never been switched on for this
repository**. It is one setting. That is what the rest of this document is
about.

---

## The words you will see, in plain English

You do not need to understand GitHub to do this, but five words will keep
appearing and it is easier if they mean something.

| Word | What it actually is |
| --- | --- |
| **Repository** (or "repo") | The folder holding all the code. Yours is called `Investing-app-`. |
| **Branch** | A version of that folder. Yours has `main` (the finished one) and a working one. |
| **Actions** | GitHub's robot that runs jobs for you. This is what builds the app. |
| **Workflow** | One recipe the robot follows. Ours is called "Deploy to GitHub Pages". |
| **Pages** | GitHub's free web hosting. This is what turns the built app into a web address. |

---

## First: the one decision — public or $4 a month

This is the only real fork in the road, and it is worth thirty seconds.

Your repository is currently **private**. GitHub's free plan does not offer
Pages hosting for private repositories. So there are exactly two ways forward:

### Option A — make the repository public (free, recommended)

The code becomes readable by anyone who finds it.

**What actually becomes visible:**

- The app's source code.
- The list of 17 stock tickers the app tracks: META, MSFT, NOW, PLTR, TSSI,
  VST, CEG, FTAI, BWXT, LMT, MCD, MELI, SPGI, LLY, ISRG, AMZN, SMH.
- The bundled sample numbers — share counts, costs, cash. **These are invented
  sample data, not your real position.** They were made up to have something to
  build against.

**What does not become visible:**

- **Your API key.** It is never in the code. You type it into the app on your
  phone and it stays on your phone. I searched the entire repository and its
  full history for keys, tokens and credentials — there are none, and there
  never were.
- **Your real positions.** Those only exist after you import a screenshot, and
  that import is saved in your phone's browser storage. It is never uploaded
  anywhere, and it is not part of what gets published.

So the honest summary: making it public tells the world **which stocks you
follow**, and nothing about how much of them you own.

### Option B — pay for GitHub Pro ($4/month) and stay private

Pages then works on a private repository.

**But read this before choosing it:** the published app itself is *publicly
reachable either way*. GitHub does not offer password-protected Pages sites on
Pro — that is an Enterprise feature. So paying $4/month hides your *source
code*, not your *app*. Anyone with the web address can open the app in both
options.

### Which to pick

**Option A**, unless the ticker list is genuinely sensitive to you. You get the
identical result for free, and the only extra exposure is a list of large-cap
stocks that thousands of people hold.

The steps below assume Option A. If you choose B, skip Part 1 and start at
Part 2 — everything else is identical.

---

## Part 1 — Make the repository public

### Step 1. Open GitHub and switch to the desktop view

Open Safari and go to:

```
github.com/yoav2410-create/Investing-app-
```

Sign in if asked.

Now — **this step matters and is easy to miss.** Tap the **`aA`** icon on the
left of the address bar, then tap **Request Desktop Website**.

GitHub's phone version hides most of the settings you need. The desktop version
looks small but works perfectly once you pinch to zoom.

### Step 2. Find the danger zone

1. Along the top of the page you will see a row of tabs: *Code, Issues, Pull
   requests, Actions, Projects, Wiki, Security, Insights, **Settings***.
   Tap **Settings** (it has a gear icon, and it is the last one).
2. You are now on the General settings page. **Scroll all the way to the
   bottom.**
3. At the very bottom is a box outlined in red called **Danger Zone**.

### Step 3. Change visibility

1. In the Danger Zone, find the row **"Change repository visibility"** and tap
   the **Change visibility** button next to it.
2. A window appears. Choose **Make public**.
3. It will warn you that the code becomes visible to everyone. That is expected
   — you decided this above.
4. It then asks you to **type the repository name to confirm**. Type exactly:

   ```
   yoav2410-create/Investing-app-
   ```

   Note the hyphen at the end. It is part of the name.
5. Tap **I understand, make this repository public**.

Done. This is reversible at any time from the same place.

---

## Part 2 — Switch on Pages

### Step 4. Set the publishing source

1. Still in **Settings** (tap it again if you navigated away).
2. In the **left sidebar**, scroll down and tap **Pages**.
3. You will see a section headed **Build and deployment**, and under it a
   dropdown labelled **Source**.
4. Open that dropdown and choose **GitHub Actions**.

There is no Save button. Choosing it applies it.

> **If this page tells you Pages is unavailable for private repositories**, then
> Part 1 did not take effect. Go back and check the repository is public — the
> word "Public" appears next to the repository name at the top of the page.

---

## Part 3 — Build and publish

### Step 5. Run the build

1. Tap the **Actions** tab at the top of the page.
2. If a green button appears saying *"I understand my workflows, go ahead and
   enable them"*, tap it. If you see a list instead, this is already done.
3. In the **left sidebar**, tap **Deploy to GitHub Pages**.
4. On the right side, tap the **Run workflow** dropdown.
5. Leave the branch as **main** and tap the green **Run workflow** button.

### Step 6. Wait

Pull down on the page to refresh. A new row appears at the top with a spinning
yellow circle.

**Five to eight minutes.** You can lock the phone and come back.

- 🟡 **Yellow** — running.
- ✅ **Green tick** — published.
- ❌ **Red cross** — stopped. Tap the run, then tap the step with the red cross.
  The message is written in plain English and tells you what to fix.

### Step 7. Open the app

Go to:

```
https://yoav2410-create.github.io/Investing-app-/
```

Do not forget the slash at the end.

> **A white screen or "404"?** On the very first publish, GitHub can take an
> extra minute or two after the green tick. Wait two minutes and reload.

---

## Part 4 — Put it on your home screen

### Step 8. Install it

With the app open in Safari:

1. Tap the **Share** button — the square with an arrow pointing up, in the bar
   at the bottom of the screen.
2. Scroll the list down until you see **Add to Home Screen**. Tap it.
3. The name shows as **Brief**. Change it if you want.
4. Tap **Add** in the top-right corner.

### Step 9. Check it installed properly

Tap the new icon on your home screen. It should open **full screen, with no
address bar at the top**. That is how you know iOS installed it as an app
rather than as a bookmark.

If it opens with an address bar, delete the icon, open the address in Safari
again, wait for it to fully load, and add it again.

**From now on, always open it from this icon.** The installed app keeps its data
separately from Safari — anything you set up in a Safari tab will not appear in
the installed app.

---

## Part 5 — Make it yours

### Step 10. Get an Anthropic key

This is the only thing that costs money, and it is small: roughly a few cents to
research a stock, a fraction of a cent to read a screenshot. You add credit
yourself, so it cannot run up a bill.

In a **normal Safari tab** (not the app):

1. Go to **console.anthropic.com** and sign in or create an account.
2. **Settings → Billing** → add credit. $5 lasts a long time here.
3. **Settings → API Keys → Create Key**. Name it "Portfolio Brief".
4. **Copy it immediately.** Anthropic shows the key once and never again.
   Long-press it → Copy.

### Step 11. Put the key in the app

1. Open the app from the **home-screen icon**.
2. Tap **More** (bottom-right), then **Settings**.
3. Under **Claude**, tap the input box and paste the key.
4. Tap **Save key**.

It should then read `Currently: ••••` followed by the last four characters.

### Step 12. Load your real positions

1. Take a screenshot of your broker's positions screen — the normal way, side
   button and volume-up together.
2. In the app: **Portfolio → Update from a screenshot**.
3. Tap **Choose a screenshot** and pick it.
4. Wait 10–30 seconds while it is read.
5. **A review screen shows exactly what it thinks changed** — added, removed,
   changed, per stock. Anything it was unsure about is marked.
6. Read it. Untick anything wrong. Tap **Apply**.

Nothing is saved until you tap Apply. That review is deliberate: a misread
number would quietly corrupt everything calculated from it.

Applying it starts the research automatically. Claude then works through each
changed position looking up the latest earnings call, analyst targets and news.
A few minutes for a full book. You can leave the app while it runs.

---

## Updating the app later

Whenever the code changes: **Actions → Deploy to GitHub Pages → Run workflow**.
Five minutes. Then close the app completely (swipe up from the app switcher) and
reopen it from the icon.

Your positions, your key and your history live on the phone, not in the build,
so updating never erases them.

---

## What this route cannot do

- **No background refreshing.** The app updates when you open it. iOS does not
  let home-screen web apps run in the background.
- **No notifications.** The alert rules are calculated, but nothing can reach
  you while the app is closed.
- **No Face ID lock.** There is no fingerprint or face prompt available to a web
  app, so that switch is turned off and says why.
- **Data can be cleared by iOS.** If storage runs low and you have not opened
  the app in a long time, iOS may clear it. You would re-enter the key and
  re-import a screenshot. This is the genuine cost of the free route.

Everything analytical is identical to a full native app: every screen, every
chart, the screenshot import, the research, the cash-flow bridge, the Monte
Carlo projection, the AI insights.

Removing those four limitations means a native build, which needs an Apple
Developer account at $99/year. `docs/IPHONE.md` covers it, and it needs a
computer.

---

## If something goes wrong

**"Deploy to GitHub Pages" is red.** Tap the run, then the red step. If it says
*GitHub Pages is not enabled*, Part 2 did not take — redo Step 4. If it says
*Typecheck* or *Test* failed, the code has a real problem and nothing was
published; whatever was live before still works.

**There is no Settings tab.** You are signed in to the wrong account, or looking
at someone else's copy. Settings only appears on repositories you own.

**There is no "Add to Home Screen" in the share sheet.** You are using Chrome or
Firefox. Only Safari can install web apps on iOS.

**The app says no API key.** Redo Steps 10–11, and make sure you are in the app
opened from the home-screen icon rather than a Safari tab. They store data
separately.

**Claude errors when reading a screenshot.** Nearly always no credit on the
Anthropic account. Check Billing at console.anthropic.com.

**The stock positions are not mine.** That is the bundled sample data. You have
not imported a screenshot yet, or you did not tap Apply on the review screen.
