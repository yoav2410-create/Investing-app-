# Getting this onto your iPhone

Three routes. They are not alternatives to pick between — they are stages, and
each one is useful on its own. Start at A today; go to B when you want the app
to stop depending on your computer; go to C when you want it to just be an app.

| | What you get | Costs | Time |
| --- | --- | --- | --- |
| **A. Expo Go** | The full app, running on your phone, inside the Expo Go container | Free | ~15 min |
| **B. Expo Go + EAS Update** | Same, but works without your computer running | Free | +10 min |
| **C. Your own build** | Its own icon on the home screen, background refresh, notifications | Apple Developer, $99/yr | +40 min |

Everything analytical works from stage A. What stage C adds is the automatic
daily refresh, notifications, Face ID with the app's own prompt text, and an app
that looks and launches like any other app on the phone.

---

## Before anything: get the code onto your own computer

The code lives on GitHub, on the branch `claude/iphone-investment-app-frn8sy`.
Mac, Windows or Linux — all fine, you do not need a Mac.

1. **Install Node.js 20 or newer** from <https://nodejs.org> (take the LTS
   build). Check it worked:

   ```bash
   node -v      # v20.x or higher
   ```

2. **Install Git** from <https://git-scm.com> if you do not have it.

3. **Clone the repository and install:**

   ```bash
   git clone https://github.com/yoav2410-create/Investing-app-.git
   cd Investing-app-
   git checkout claude/iphone-investment-app-frn8sy
   npm install
   ```

   `npm install` takes a few minutes the first time. Warnings are normal; errors
   are not.

4. **Check it is healthy** before involving the phone:

   ```bash
   npm run typecheck
   npm test
   ```

   64 tests should pass. If they do, the problem in any later step is
   environment, not code.

---

## Stage A — running on the phone in 15 minutes

### A1. Install Expo Go on the iPhone

App Store → search **Expo Go** → install. Free, no account needed to open it.

### A2. Start the dev server

On the computer, in the project folder:

```bash
npx expo start
```

A QR code appears in the terminal.

### A3. Scan it

Open the iPhone **Camera** app, point it at the QR code, tap the banner. Expo Go
opens and the app loads.

The first load takes 30–60 seconds while the bundle is built. After that it is
instant, and any change you make on the computer appears on the phone within a
second.

**If the phone will not connect**, it is almost always the network — the phone
and the computer must be on the same Wi-Fi, and some networks (guest Wi-Fi,
corporate, hotel) block the connection. The fix that works everywhere:

```bash
npx expo start --tunnel
```

Slower, but it routes through Expo's servers so the two devices no longer need
to see each other.

### A4. Set your API key

In the app: **More → Settings → Claude → set key**. Paste an Anthropic API key
from <https://console.anthropic.com> → API Keys.

The key goes into the iOS keychain (`expo-secure-store`), not into the code and
not into the bundle. It never leaves your phone except to call Anthropic.

Without a key the app still runs on the bundled seed data — it just cannot
update anything.

### A5. Make it your book

**Portfolio → Update from a screenshot** → pick a screenshot of your broker's
positions screen → Claude reads it → **review the diff** → Apply.

That one action replaces the seed holdings, share counts, costs, prices and cash
with yours. Applying it automatically queues a research pass on everything that
changed, which fills in the analysis behind each name.

### What does not work in stage A

- **Background refresh.** `expo-background-task` cannot run inside Expo Go. The
  app refreshes when you open it; it will not wake up on its own.
- **Notifications.** Same reason — the alert rules are all there and evaluate
  correctly, they just have no way to reach you when the app is closed.
- **The app's own icon and name.** It lives inside Expo Go, so it appears on the
  home screen as Expo Go.
- **The Face ID prompt** shows Expo Go's wording rather than the app's.

Nothing analytical is missing. Every screen, chart, the screenshot import, the
research passes, the FCF bridge and the Monte Carlo all work exactly as they
will in a real build.

---

## Stage B — untethered, still free

Stage A needs your computer running. This removes that, still without paying
anyone.

1. **Create a free Expo account** at <https://expo.dev>.

2. **Log in and publish the bundle:**

   ```bash
   npm install -g eas-cli
   eas login
   eas init
   eas update --branch production --message "first publish"
   ```

   `eas init` links the folder to a project on your Expo account and writes the
   project id into `app.json`. Commit that change.

3. **Open it from the phone:** in Expo Go, sign in with the same Expo account.
   The project now appears under your projects — tap it. It loads from Expo's
   servers, so your computer can be off.

From then on, any change you want on the phone is one command:

```bash
npm run ios:update
```

The phone picks it up on next launch. Still inside Expo Go, so the stage-A
limitations above still apply.

---

## Stage C — a real app on the home screen

This is what removes every limitation. It needs an **Apple Developer Program**
membership: $99/year, from <https://developer.apple.com/programs>. Enrolment
takes anywhere from an hour to a couple of days for Apple to approve.

There is no way around the $99 for an app that stays installed. A free Apple ID
can sideload through Xcode on a Mac, but the signature expires after **7 days**
and you must re-install it every week — not worth it for something you want to
open every morning.

You do **not** need a Mac. EAS builds on Apple hardware in the cloud.

### C1. Build it

```bash
npm install -g eas-cli
eas login
eas build --profile production --platform ios
```

The CLI will ask for your Apple ID, log in to Apple for you, and create the
signing certificates and provisioning profile itself. Say yes when it offers to
handle credentials — doing it by hand is the single most error-prone part of iOS
distribution and there is no benefit to it here.

The build runs on Expo's servers and takes 15–25 minutes. You get a URL to watch
it.

### C2. Get it onto the phone

**Via TestFlight** — the right way for an app only you use:

```bash
eas submit --platform ios --latest
```

This uploads the build to App Store Connect. Then:

1. Go to <https://appstoreconnect.apple.com> → My Apps → Portfolio Brief →
   TestFlight.
2. The build takes 10–30 minutes to finish processing.
3. Add yourself as an internal tester (your own Apple ID).
4. Install **TestFlight** from the App Store on the iPhone, open it, install
   Portfolio Brief.

It now has its own icon, launches on its own, refreshes in the background and
can send you notifications. TestFlight builds expire after 90 days, so you
re-run the build roughly quarterly — one command.

Both steps in one:

```bash
npm run ios:testflight
```

### C3. Updating it afterwards

Two different kinds of change:

- **JavaScript only** — a screen, a calculation, a chart, wording. Ship it
  instantly, no rebuild, no Apple review:

  ```bash
  npm run ios:update
  ```

  The phone picks it up on the next launch.

- **Native change** — adding a library with native code, changing permissions,
  the icon, or the app name. Needs a rebuild:

  ```bash
  npm run ios:testflight
  ```

Almost everything you will want to change is the first kind.

### C4. Do you need to publish to the App Store?

No. TestFlight is enough for an app you and nobody else uses, and it skips App
Store review entirely. Publishing to the App Store would mean review, a privacy
questionnaire, screenshots and a support URL — all pointless for a personal
tool. If you ever did want it public, the same `production` build is what you
would submit.

---

## The one thing to fix before stage C

Right now the Anthropic API key sits on the device and the app calls Anthropic
directly. For a single-owner personal app that is an honest trade: no server to
run, nobody else holding the key, and it is in the iOS keychain.

If you ever put this in anyone else's hands, put a thin proxy in front of it —
your own endpoint holding the key server-side with the app authenticating to
that. The client is one file (`src/data/provider/claude.ts`) and already takes a
base URL, so the change is small.

---

## Troubleshooting

**`npm install` fails on `sharp` or a native module** — you are on an old Node.
Check `node -v` is 20 or higher.

**Expo Go says "incompatible SDK"** — the App Store version of Expo Go only
supports the newest Expo SDK. This project is on SDK 57. If Expo Go has moved
on, run `npx expo install --fix` and follow what it says.

**QR scan does nothing** — use `npx expo start --tunnel`.

**Blank white screen in Expo Go** — shake the phone → Reload. If it persists,
look at the terminal: the actual error is there, not on the phone.

**`eas build` fails on credentials** — delete what it made and let it start
over: `eas credentials` → iOS → remove, then build again.

**"Apple Developer account not enrolled"** — enrolment has not finished
approving. It is not a code problem; wait for Apple's email.

**The app shows seed data, not my positions** — you have not imported a
screenshot yet, or you imported and did not tap Apply on the review screen.
Nothing is written to the book until you approve the diff.
