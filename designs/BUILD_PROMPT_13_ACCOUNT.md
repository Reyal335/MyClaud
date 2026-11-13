# Step 13: Account and usage

Written 2026-11-13 for the app with steps 7, 7b, and 8 built. It does
not depend on steps 10 to 12; if step 12 (title bar) is built, the bar
shows ACCOUNT like any other screen. Paste the fenced prompt alone.

Before you paste it, copy `13-account.html` and
`13b-account-states.html` into the repo's `designs/` folder. The
mockups on the canvas are "13. Account and usage" and "13b. Account
states".

Decisions made in this prompt:
- Account details come from the SDK's accountInfo(). Usage comes from
  the rate_limit_event messages the SDK already sends during runs.
  The app never sends a request just to check usage, so checking
  costs nothing from your limits.
- The exact percentage is not always reported. When it is missing,
  the bar shows "UNDER 80%" (or "NEAR LIMIT") instead of a guess.
  Reset times are always exact.
- Claude Code first checks what your installed SDK version actually
  reports, and tells you before building. It does not upgrade the
  SDK without asking.
- Only two bars: session (5 hr) and weekly (7 day). Per-model weekly
  limits and extra usage are left out for now.
- The sidebar meter is the way into ACCOUNT. No new nav button.
- Switching accounts stays in the terminal (`claude`, then `/login`).

```
Read CLAUDE.md and designs/DESIGN.md in full. Open
designs/13-account.html (the ACCOUNT screen and the sidebar meter)
and designs/13b-account-states.html (every state). Then read the
code in place: the SDK version in package.json and its type file in
node_modules/@anthropic-ai/claude-agent-sdk (look for accountInfo,
AccountInfo, SDKRateLimitEvent, SDKRateLimitInfo, utilization,
unifiedWindows, and rateLimitType), where runs are started and their
messages handled from step 7, the settings store in main, the app
shell, sidebar, and screen routing, src/shared/ipc.ts, and both
preloads.

CONTEXT
Steps 7 (chat, party, inbox), 7b (send during a run), and 8 (popups)
are built and committed. Steps 10 to 12 may or may not be. The app
runs on my existing Claude Code login. Use the app name the code
uses today in every string. If any account or usage code already
exists, stop and tell me what you found.

GOAL (build step 13 only)
An ACCOUNT screen showing who I'm signed in as and how much of my
session and weekly limits I've used, plus a small usage meter at the
bottom of the sidebar on every screen that opens ACCOUNT. Match the
mockups.

FIRST, CHECK THE SDK (part of your plan)
Before planning, tell me:
- The installed SDK version.
- What accountInfo() returns (field names and types) and how to call
  it without sending a prompt. It must not use any of my limits. If
  it cannot be called without a prompt, say so and propose another
  way; do not send a prompt.
- The exact shape of SDKRateLimitInfo in the type file: which of
  status, resetsAt, utilization, rateLimitType, unifiedWindows exist,
  and the units (resetsAt in seconds or milliseconds, utilization as
  0 to 1 or 0 to 100).
Do not upgrade the SDK. If a newer version would report more, tell
me and I will decide.

ACCOUNT INFO (main)
- Read account info at app start, whenever a run starts, and when I
  press CHECK AGAIN. Use the no-prompt way from your check.
- Keep: email, plan, and sign-in method. Plan comes from the
  subscription type, shown in capitals (PRO, MAX, and so on). If it
  is missing or looks wrong (for example "Claude API" while an email
  is present), show "Claude plan" instead.
- Sign-in method: "Claude Code login" for a Claude account, or
  "API key (<source>)" when an API key is in use.
- Not signed in: whatever accountInfo or the SDK reports when there
  is no login and no API key. Tell me in your plan what that looks
  like.
- Never log the email, and never send it anywhere.

USAGE (main)
- Listen for rate_limit_event in every run's message stream, in the
  same place step 7 handles messages. Keep the latest value for
  "five_hour" and "seven_day"; ignore other limit types.
- For each, store { status, resetsAt, percent, updatedAt }:
  - resetsAt as epoch milliseconds (convert from seconds if the
    value is below 1e12).
  - percent as a whole number 0 to 100: from utilization if present
    (times 100 if it is 0 to 1), else from unifiedWindows for that
    limit type if your SDK reports it, else null. Never estimate.
- One event can carry both windows (unifiedWindows); use both.
- Save the latest values to userData/usage.json so they survive a
  restart.
- A window whose resetsAt has passed counts as reset: show it as "no
  percent yet" until a new event arrives.

ACCOUNT SCREEN (renderer)
A new ACCOUNT screen, reached from the sidebar meter. Match
designs/13-account.html.
- Header "ACCOUNT", subtitle "The Claude Code sign-in every agent in
  <app name> runs on."
- ACCOUNT panel: EMAIL, PLAN (badge), SIGNED IN WITH, then the
  switching note from the mockup (run `claude`, use `/login`).
- USAGE panel: SESSION (5 HR) and WEEKLY (7 DAY) rows, the "VIEW
  DETAILS ON CLAUDE.AI >" link, then "Updated after each reply. Last
  update <n> min ago." (or "No usage reported yet. Updates after a
  reply." if there is nothing yet). The link opens
  https://claude.ai/settings/usage in the default browser through
  main (shell.openExternal, this URL only).
- Each row: the name, the value, a bar of 20 segments (5% each, 2px
  gaps, 16px tall), and the reset line. Reset line: "Resets at 7:30
  PM, in 2 h 18 min" when it resets today, else "Resets Mon, Nov 16,
  8:00 AM", in local time. Update the relative part every minute.
- Under the panels, the color legend from the mockup.
- Each row is a group with an aria-label such as "Session (5 hr): 52
  percent used". The bar itself is aria-hidden.

BAR RULES (screen and sidebar)
- Percent known: fill round(percent / 5) segments. Color: --accent
  under 80, --waiting from 80 to 99, --error at 100. Value "52%".
- status "rejected": all segments --error, value "100%", even if
  percent is missing.
- Percent missing, status "allowed": no fill, dashed --line
  segments, value "UNDER 80%" in --muted (sidebar: "--").
- Percent missing, status "allowed_warning": 16 segments --waiting,
  value "NEAR LIMIT" (sidebar: "80%+").
- Empty segments: 2px solid --line border. No gradients, no
  transitions.

STATES
Match designs/13b-account-states.html.
- Limit reached (either window rejected): a red alert box at the top
  of the USAGE panel, "Session limit reached. Agents can't start new
  replies until <time>." (or "Weekly limit reached..."), with
  role="alert". Do not change how runs handle the limit today.
- Not signed in: the ACCOUNT panel shows the three steps from the
  mockup and a CHECK AGAIN button; the USAGE panel and the sidebar
  bars are hidden, and the sidebar meter reads "Not signed in".
- API key: the ACCOUNT panel shows the API key text from the mockup;
  the USAGE panel is hidden, and the sidebar meter reads "API key".

SIDEBAR METER (renderer)
- At the bottom of the sidebar, under the project name, on every
  screen. A link to ACCOUNT, styled like the mockup: --bg fill,
  4px --line border (--text border and hard shadow when ACCOUNT is
  open, with aria-current="page"), the title "ACCOUNT", then 5H and
  7D rows with 10-segment bars (10px tall) and their values. When a
  limit is reached, add "Session resets <time>" under the bars.
- aria-label like "Account. Session 52 percent used, weekly 61
  percent used."
- It must not push the nav links off screen at the minimum window
  size (960x600).

IPC
An account group on the preload API: get() returning { account,
usage }, check() (re-reads account info), onChange(listener), and
openUsagePage(). Main validates every argument. The renderer never
touches the file system.

DOCS
Add an "Account and usage" section to designs/DESIGN.md with the bar
rules, states, and messages above, and list 13-account.html and
13b-account-states.html with the other mockups. Do not edit
CLAUDE.md.

OUT OF SCOPE
Signing in, signing out, or switching accounts inside the app.
Per-model weekly limits, extra usage, or cost tracking. Popups or
title bar badges about limits. Any request sent only to refresh
usage. Upgrading the SDK. No new dependencies.

DONE WHEN
- The sidebar meter shows on every screen and opens ACCOUNT, which
  matches the mockup.
- With my login, ACCOUNT shows my email, plan, and "Claude Code
  login", and opening the app uses none of my limits.
- After one reply, the session and weekly rows show either a percent
  or "UNDER 80%", with correct local reset times, and "Last update"
  counts up.
- After a restart, the last values are back. A window whose reset
  time has passed shows "no percent yet".
- VIEW DETAILS opens claude.ai's usage page in my browser.
- The color, warning, limit-reached, not-signed-in, and API key
  states each look like the mockup. Test them with fake values in a
  dev-only path or a test, not by using up my limits, and tell me how
  to see each one.
- Keyboard only: tab to the sidebar meter, open ACCOUNT, reach VIEW
  DETAILS and CHECK AGAIN.
- The typecheck script and `npm run build` pass, and the built app
  runs with the preview script.

HOW TO WORK
1. Reply with the SDK check above, then a short plan: the files you
   will create and change, how account info is read without a
   prompt, and where rate limit events are caught. Wait for my OK.
2. Implement. Do not start live agent runs except one short run at
   the end to confirm a real rate_limit_event arrives; ask me before
   that run.
3. Reply with the files changed, anything you did differently from
   this prompt and why, and any DONE item you could not check.
4. Do not commit and do not start anything else. I will test and
   commit myself.
```
