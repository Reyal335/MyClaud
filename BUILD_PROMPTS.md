# MyClaud build prompts

One prompt per step of the build order in `CLAUDE.md`. Paste the preamble,
then the step's prompt, into a fresh Claude Code chat. Finish, test, and
commit a step before starting the next.

SDK option names below (`query`, partial messages, the permission callback,
session resume) are from memory of the Agent SDK. Each prompt tells Claude
Code to confirm them against the current docs before using them.

## Preamble (paste before every step)

```
Read CLAUDE.md and designs/DESIGN.md first. Do only the step below.
Reply with a short plan (files to create, change, delete) and wait for my
OK before writing code. When done, list the files changed and anything
you did differently from the prompt. Do not commit and do not start the
next step.
```

## After every step

1. Run the app and try the "done when" checks yourself.
2. Commit with a message naming the step.
3. If you changed a decision along the way, update `CLAUDE.md`.

---

## Step 1: App shell and nav (comprehensive)

This one already includes the preamble's instructions, so paste it alone.

```
Read CLAUDE.md and designs/DESIGN.md in full, then open
designs/1-inbox.html and study the left sidebar and the overall page frame.

CONTEXT
This repo is a fresh electron-vite scaffold (React + TypeScript).
`npm run dev` currently opens the starter demo window. Nothing of MyClaud
exists yet. If the scaffold is missing, stop and tell me.

GOAL (build step 1 only)
Replace the starter demo with the MyClaud app shell: one window with the
left navigation and three empty placeholder screens. No agents, no SDK,
no app-specific IPC, no real data.

WINDOW (main process)
- 1280x800 default, minimum 960x600, title "MyClaud".
- Window background #0B132B so there is no white flash on load.
- Keep contextIsolation on and nodeIntegration off.
- Hide the default menu bar on Windows and Linux.
- The preload script exposes nothing app-specific yet.

DESIGN TOKENS
- One tokens stylesheet with CSS variables for every color in DESIGN.md
  (--bg, --panel, --line, --accent, --text, --muted, --running, --waiting,
  --error, --shadow), the two font stacks, the border widths (4px, 2px),
  and the two hard shadows.
- One small global stylesheet: border-box sizing, body margin 0,
  background var(--bg), color var(--text), body font IBM Plex Mono
  14px with line height 1.5, and a visible keyboard focus outline.
- Fonts must work offline. Install @fontsource/press-start-2p and
  @fontsource/ibm-plex-mono (weights 400, 500, 600) and import them in
  the renderer entry. These two dependencies are pre-approved. Ask before
  adding any other.
- Components use only the variables. No hex colors or font names in
  component styles.

COMPONENTS (renderer)
- AppShell: two columns filling the window height. Sidebar fixed at 176px
  wide. The content area takes the rest and scrolls on its own.
- Sidebar, matching the mockup: the "MyClaud" wordmark in the pixel font
  in the accent color, three nav items (INBOX, AGENTS, MASCOTS), and a
  footer pinned to the bottom reading "Project" over "No project open".
- NavItem: a real <button>, at least 44px tall, pixel font 10px, 4px
  border. Inactive: line-colored border, no fill. Active: accent fill,
  dark text, text-colored border, 4px 4px 0 hard shadow, and
  aria-current="page". It takes an optional `count` prop that renders the
  small badge shown on INBOX in the mockup. Pass nothing for now.
- Three placeholder screens (InboxScreen, AgentsScreen, MascotsScreen):
  a pixel-font heading with the screen name and one muted line saying
  what will go there.
- Navigation: one `screen` state in App with the values 'inbox',
  'agents', 'mascots', defaulting to 'inbox'. No router library.

FILES
- Keep the structure electron-vite generated (src/main, src/preload,
  src/renderer).
- Components in src/renderer/src/components, screens in
  src/renderer/src/screens, styles in src/renderer/src/styles.
- Remove the starter demo: its components, logo assets, demo CSS, and the
  demo IPC handler and preload API if present.

OUT OF SCOPE
The conversation list, chat, agent or mascot features, the Agent SDK,
file access, settings, and the popup window. Do not install the SDK in
this step.

DONE WHEN
- `npm run dev` opens a 1280x800 dark window showing the sidebar and the
  Inbox placeholder.
- Clicking each nav item, or tabbing to it and pressing Enter, switches
  the screen and moves the active style.
- The sidebar matches designs/1-inbox.html: same colors, fonts, borders,
  shadow, and spacing.
- The typecheck script and `npm run build` pass with no errors, and the
  dev console shows no errors or warnings from our code.
- No starter demo code or assets remain.

HOW TO WORK
1. Reply with a short plan first: files you will create, change, and
   delete. Wait for my OK.
2. Implement.
3. Reply with the list of files changed, and anything you did differently
   from this prompt and why.
4. Do not commit and do not start step 2. I will test and commit myself.
```

---

## Step 2: One conversation, streamed as plain text

```
Step 2: one working conversation.
- Install @anthropic-ai/claude-agent-sdk. Check its current docs for the
  exact API before using it.
- Main process: an agent module that runs one SDK query with streaming
  partial messages on, and forwards events to the renderer over typed IPC.
- Add "Open project" (folder picker). The chosen folder is the agent's
  working directory, shown in the sidebar footer and remembered in
  userData.
- Allow only read-only tools for now (Read, Grep, Glob), so no
  permission prompts are needed yet.
- Renderer: on the Inbox screen, a message input and a plain text reply
  that grows as tokens arrive. No mascot or styling polish yet.
- Show a clear message in the UI if the API key is missing or the
  request fails.
Done when: I open a project, ask "what files are in this project?", and
watch the answer stream in.
```

## Step 3: Tool cards and permission requests

```
Step 3: tool activity and permissions. Match designs/2-conversation.html
for the tool cards and the Approve / Deny row.
- Render each tool call as a small card ("Reading src/auth.js",
  "Running npm test") with its result state.
- Enable Edit, Write, and Bash. Route the SDK's permission callback to
  the renderer as a request event, and send my Approve or Deny back over
  IPC. Check the current docs for the callback's name and shape.
- A pending request sets the conversation status to "waiting". Treat a
  closed window or a quit as Deny.
- Keep message history in the view: my messages, tool cards, replies.
Done when: I ask it to edit a file, see the request, and both Approve
and Deny do the right thing.
```

## Step 4: Mascot and dialogue box

```
Step 4: the mascot. Match designs/2-conversation.html and
designs/6-mascot-states.html.
- A Mascot component that plays a horizontal 64x64 spritesheet at a
  given FPS, scaled 2x with crisp pixels. Until uploads exist, use
  designs/mascot.png as a one-frame sheet for every state.
- A small state machine driven by stream events: idle (nothing
  running), thinking (waiting for output), talking (text streaming),
  working (a tool is running), asking (permission pending).
- The RPG dialogue box: agent name in the header, the current reply
  typing out with a block cursor, and the Approve / Deny row inside the
  box when asking.
- Move the Step 2 and 3 conversation into a proper Conversation screen
  with history above and the mascot and dialogue box at the bottom.
Done when: one request visibly moves the mascot through thinking,
working, talking, and (for an edit) asking.
```

## Step 5: Agent manager

```
Step 5: the agent manager. Match designs/3-agent-manager.html.
- Main process, over IPC: list, read, create, update, and delete agent
  files in <project>/.claude/agents/ and ~/.claude/agents/. Each is
  Markdown with YAML frontmatter (name, description, tools, model) and
  the system prompt as the body. Check the current subagent docs for
  the exact fields. Ask me before adding a frontmatter parser.
- Agents screen: Project and Global sections with cards, and the edit
  form (name, description, system prompt, tool checkboxes, model,
  project/global toggle). Confirm before delete.
- Icon upload: PNG, exactly 16x16, no resizing. On failure show "Icon
  must be exactly 16x16." with the real size. Store icons in userData
  and map agent file path to icon in a JSON file. Never write extra
  fields into the agent file.
- Agents without an icon show the default icon.
Done when: an agent I create here appears in the regular Claude Code
CLI, and one I edit by hand shows the change here.
```

## Step 6: Mascot manager

```
Step 6: the mascot manager. Match designs/4-mascot-manager.html.
- Store each mascot in userData/mascots/<id>/ with a manifest (name,
  and per state: file, frame count, FPS) plus the PNG sheets.
- Upload dialog with one row per state (idle, thinking, talking,
  working, asking): strip preview with frame dividers, a live loop
  preview, an FPS field, Replace, and an empty slot when missing.
- Validate strictly: PNG, height exactly 64, width a multiple of 64, at
  most 16 frames. Show the exact rule that failed and the real value.
- Idle is required. A state with no sheet plays the idle loop.
- Gallery with "n of 5 loops", Set active, edit, and delete. The Step 4
  Mascot component now reads the active mascot. Ship the default mascot
  from designs/mascot.png so the app is never without one.
Done when: I upload sheets for two states, set the mascot active, and
see those loops in a conversation.
```

## Step 7: Multiple conversations and the inbox

```
Step 7: the inbox. Match designs/1-inbox.html.
- Main process: a session manager that runs several conversations at
  once, each with an id, its agent, a status (running, waiting, done,
  error), last message, and timestamps.
- "New chat" picks an agent (project or global) and starts a thread.
- Inbox list: agent icon, name, project/global tag, last message
  preview, time, status badge. Waiting threads look unread and feed the
  count badge on the INBOX nav item. Selecting a thread opens it.
- Persist the thread list to userData and resume a thread after restart
  through the SDK's session resume. Check the current sessions docs for
  how to resume and list sessions; do not parse transcript files.
- Permission requests go to the right thread even when it is not open.
Done when: two agents run at the same time, one waits for approval
while the other finishes, and both survive an app restart.
```

## Step 8: Mascot popup notifications

```
Step 8: the popup. Match designs/5-popup-notifications.html.
- A second BrowserWindow: frameless, always on top, not in the taskbar,
  about 340x140, in the bottom-right corner of the primary display's
  work area. It renders the active mascot and a speech bubble with the
  agent's icon and name.
- Three variants: task finished, needs approval (Approve, Deny, Open),
  and error.
- Show it only when the main window is not focused. Queue popups when
  several arrive. Finished and error popups dismiss themselves after a
  few seconds; approval stays until answered.
- Approve and Deny use the same permission path as the main window.
  Open focuses the main window on that thread.
- Add a setting to turn popups off.
Done when: with the app in the background, an agent's approval request
pops up and I can approve it without opening the main window.
```
