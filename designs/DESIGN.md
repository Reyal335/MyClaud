# MyClaud design reference

These files are static mockups. Open any `.html` file in a browser to see it.
They show the intended look and layout, not working code. Build the real
components in React and match these visually.

## Screens

| File | Screen |
| --- | --- |
| `1-inbox.html` | Inbox: nav, conversation list, selected conversation preview |
| `2-conversation.html` | Conversation: history, tool cards, mascot with RPG dialogue box, input |
| `3-agent-manager.html` | Agent list (project / global) and the edit form with 16x16 icon upload |
| `4-mascot-manager.html` | Mascot gallery and the upload dialog with one loop per state |
| `5-popup-notifications.html` | The three popup variants: finished, needs approval, error |
| `6-mascot-states.html` | The five mascot states |
| `7-sheet-slicer.html` | The sheet slicer in the mascot dialog: grid, picked frames, loop preview, REUSE SHEET |
| `8-chat-party.html` | CHAT with the party panel: the frame (history and stage), the input row with a called agent, the panel and its detail area |
| `8b-party-states.html` | Every state of a party member: panel row, rail icon, the rail hover card, and the input row |
| `8c-party-rail.html` | CHAT in a narrow window, with the party panel collapsed to a rail |
| `mascot.png` | Default mascot image used in the mockups |

## Colors

| Token | Hex | Use |
| --- | --- | --- |
| bg | `#0B132B` | App background, input backgrounds |
| panel | `#1C2541` | Panels, cards, sidebar |
| line | `#3A506B` | Default borders, user message bubble |
| accent | `#5BC0BE` | Active nav, primary buttons, agent names |
| text | `#F2F4F8` | Main text, emphasis borders |
| muted | `#A9B6C6` | Secondary text, "done" status |
| running | `#6FCF7F` | Running status |
| waiting | `#F2B84B` | Waiting for approval |
| error | `#F0706A` | Error status and validation errors |
| shadow | `#000000` | Hard drop shadows |
| check | `#26335A` | Checkerboard squares behind transparent pixels (on panel) |
| dim | `#0B132B` at 62% | Overlay on unpicked cells in the sheet slicer |

`#3A506B` is too dark for text on the navy backgrounds. Use it for borders only.

## Type

- Headings, labels, buttons, tags: `'Press Start 2P'`, 8 to 14px.
- Chat text, descriptions, code, inputs: `'IBM Plex Mono'`, 12 to 15px, line height 1.5.
- Never set paragraphs in the pixel font.

## Shape rules

- No rounded corners, no gradients, no blurred shadows.
- Borders are 4px solid (2px on small tags and tool cards).
- Shadows are hard offsets: `4px 4px 0 #000` on buttons, `6px 6px 0 #000` on dialogue boxes and dialogs.
- Selected or unread items: `#F2F4F8` border with a `4px 4px 0 #5BC0BE` shadow.
- Buttons and inputs are at least 44px tall.
- Pixel art scales by whole numbers only, with `image-rendering: pixelated`.

## Status

Every status shows a colored square and a text label, never color alone.

| Status | Color | Label |
| --- | --- | --- |
| Running | running | RUNNING |
| Waiting for approval | waiting | WAITING |
| Done | muted | DONE |
| Error | error | ERROR |

Conversations waiting for approval count as unread in the inbox.

## Mascots

- A mascot has five states: idle, thinking, talking, working, asking.
- Each state has its own spritesheet and its own FPS.
- Spritesheet format: PNG, horizontal strip of 64x64 frames. Height exactly
  64px, width a multiple of 64, at most 16 frames. A sheet in any other
  layout opens the sheet slicer, which cuts it into such a strip (see Sheet
  slicer). A stored sheet that breaks these rules is reported with a specific
  message, for example "Height must be 64px. Yours is 128px."
- Idle is required. A state with no sheet plays the idle loop.
- Display at 1x, 2x, or 3x only.

## Sheet slicer

See `7-sheet-slicer.html`. A picked sheet that is already a legal strip is used
as it is and the slicer never opens. Any other sheet opens the slicer in its
state's row, unless it is refused.

Refused outright, checked in this order:

1. Not a PNG: "Sheet must be a PNG file."
2. Over 3 MB: "Sheet must be under 3 MB. This one is 3.6 MB."
3. Over 4096 pixels on a side: "Sheet must be at most 4096 pixels on each
   side. This one is 5000x300."
4. Does not decode: "This file could not be read as an image."

Slice rules, checked in this order. The first one that fails is shown, with
the real values:

1. Columns and rows are whole numbers from 1 to 16: "Columns and rows must be
   whole numbers from 1 to 16."
2. "Sheet width 384 does not divide into 5 columns."
3. "Sheet height 384 does not divide into 5 rows."
4. "Frames must be square. 4 x 3 gives 96x128."
5. At least one cell is picked. No message: USE is disabled.
6. "A loop can have at most 16 frames. 20 are picked."
7. Every cell is inside the grid and picked once: "Each picked frame must be a
   cell in the grid, picked only once."

When no rule fails, one note shows. Notes never block:

- "64x64 frames, used as they are."
- "128x128 frames, scaled to 64x64." when the frame size is a multiple of 64
  or divides 64 evenly (32, 16, 8).
- Warning: "96x96 is not a multiple of 64. Scaled frames may look uneven."

Other messages: "This sheet is no longer loaded. Upload it again." (the
loaded sheet is gone) and "Pick at least one frame." (a slice request with no
cells; the slicer itself disables USE instead).

- Status colors: running with OK for a note, waiting with ! for the warning,
  error with X for a failed rule. Grid lines follow: accent, waiting, error.
- The sheet is drawn on the checkerboard with `image-rendering: pixelated`, at
  a whole-number scale when it fits, scaled down to fit when it does not.
- Starting grid: width / 64 by height / 64 when both are whole and at most 16,
  otherwise 1 by 1. A reused sheet starts from the grid last confirmed for it.
- When the grid changes, the picks reset: every cell in reading order if there
  are 16 or fewer, none if there are more.
- Picked cells show their place in the loop; unpicked cells are dimmed.
- Frames are scaled to 64x64 by nearest neighbour only: no smoothing, no
  blending.
- SAVE MASCOT is disabled while a slicer is open.

## Party and inbox

See `8-chat-party.html`, `8b-party-states.html`, `8c-party-rail.html`, and
`1-inbox.html`. The sidebar reads CHAT, INBOX, AGENTS, MASCOTS, and the app
opens on CHAT. CHAT shows a count of 1 while a request from the main
conversation itself is pending; INBOX shows the number of waiting tasks. Both
are hidden at zero.

### Party panel

- 252px wide, as tall as the frame and the input row together. Header: PARTY,
  the number of agents, and the collapse button.
- Under the header: "Click a member to call them for your next message."
  While an agent is called: "Calling <agent> for your next message."
- One row per agent, project agents first, then global. A row is at least 56px
  tall: the icon at 32px, the agent's name, and its role as the smaller line
  (left out when it has none). Rows have no border until hovered, focused, or
  called. When they do not fit, the list scrolls inside the panel.
- The detail area is pinned to the bottom above a dividing line: the name, the
  model as a small tag (left out when the file sets none), the description cut
  to four lines, and the tools on one line, or "All tools". With nobody hovered,
  focused, or called: "Hover a member to see what they do."
- With no agents: "No agents yet. Make one on the AGENTS screen."
- States, from `8b-party-states.html`: IDLE, HOVER OR FOCUS, CALLING (accent
  fill, text border, hard shadow), WORKING (line border, the latest activity in
  the running color, a running square; the icon hops 2px in hard steps, never
  with reduced motion), WAITING FOR YOU (waiting border, "Needs your
  approval"), CANNOT BE CALLED (dashed border, dimmed icon, not a button).
- Reasons an agent cannot be called: "Sets its own permission mode", "Runs in
  the background", "File has a problem", "Hidden by a project agent".
- The rail is 72px with 48px icon buttons. Hovering or focusing one shows the
  hover card to its left: name, role, model, description, and "Click to call
  for your next message". The panel is open at 1200px and wider and a rail below
  that, until the collapse button is pressed; that choice is kept in
  settings.json.
- With an agent called, the input row shows its chip (icon, name, and a remove
  button) and the placeholder "Message for <agent>...". Otherwise the
  placeholder is "Message Claude...".

### Agents at work

- In the history a task is an agent card: icon, name, role and task label, and
  its status as a word. While it runs, its latest activity; when it ends, the
  first three lines of the report and OPEN IN INBOX >.
- A message sent with an agent called shows the agent's chip on top of the text.
- The mascot is WORKING while an agent runs, and the dialogue box reads
  "<agent> is working: <latest activity>". A request from inside an agent has
  one extra line on top: the agent's icon and "<agent> asks".
- NEW CHAT asks "Start a new conversation? The current one is cleared from
  MyClaud."
- Saved history: "Earlier messages are not shown." (more than 200 messages) and
  "Earlier messages are not available." (the saved conversation cannot be
  read). A lost session: "The saved conversation was not found. This reply
  starts from a fresh context."

### Agent messages

- The sentence put in front of a message sent with an agent called: "Use the
  <name> agent for this request."
- "The agent <name> sets its own permission mode (<value>). MyClaud keeps
  approvals on, so it does not run this agent."
- "The agent <name> is set to run in the background. MyClaud runs agents in the
  foreground."
- "This agent went to the background, which MyClaud does not support yet."

### Inbox

- One row per task, newest first: icon, agent name, the PROJECT or GLOBAL tag
  (none for a built-in agent), the task label, a one-line preview, the time,
  and the status as a word: RUNNING (running), WAITING (waiting), DONE (muted),
  ERROR (error), STOPPED (muted).
- Preview: the latest activity while running, "Waiting: <the request's label>"
  while waiting, then the start of the report.
- A waiting task has the unread look (text border, accent shadow) and the NEW
  tag. A finished task not yet opened shows NEW and does not count on the nav
  badge.
- The detail sits beside the list: the header (icon, name, tag, status, start
  time, how long it took), TASK, ACTIVITY, and REPORT. Cut text says "Shown in
  part." While the task waits, the request and APPROVE / DENY show at the top.
  ASK AGAIN opens CHAT with that agent called.
- CLEAR FINISHED removes done, error, and stopped tasks after one confirmation.
  A running or waiting task cannot be deleted.
- Empty: "Nothing here yet. Call an agent from the party panel on CHAT."
- A task cut off when the app closed: "Interrupted when MyClaud closed."

## Agent icons

- PNG, exactly 16x16. Reject anything else: "Icon must be exactly 16x16."
  Do not auto-resize.
- Displayed at 2x (inbox rows), 3x (cards, headers), 4x (edit form preview).
- Agents without an icon get the default question-mark icon.
- The icons in the mockups are placeholders drawn as inline SVG.

## Popup notification

- Small frameless, always-on-top window in the bottom-right screen corner.
- About 340px wide, 140px tall. The approval variant is taller to fit its buttons.
- Layout: mascot on the left, speech bubble on the right with the agent's
  16x16 icon and name in the bubble header.
- Border color follows the variant: text color for finished, waiting color
  for approval, error color for error.
- Approval variant has Approve, Deny, and Open buttons.
