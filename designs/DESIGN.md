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
| `10-model-picker.html` | CHAT with the model and thinking picker open above the input row, and a reply with its tag |
| `11-chat-themes.html` | The chat theme picker: the tiles, the preview, the fade slider, and APPLY TO |
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
| raised | `#26335A` | Slightly lighter than panel: inline code and table headers in Markdown |
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
- A loop can reverse at the end (REVERSE AT END, off by default). It plays the frames
  forward, then back down to the second frame, then starts again: 1, 2, ... n, n-1,
  ... 2, 1, 2, ... The two end frames each show once, so there is no pause at the
  turn. It needs at least 3 frames, and with fewer it does nothing. It is saved with the
  state in the mascot's `manifest.json` as `"reverse": true`, and the field is left
  out when it is off. The strip itself is not changed, so the 16-frame limit still
  holds.
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
- Columns and rows are number fields you can type in, with - and + buttons
  beside them. A typed value that is not a whole number from 1 to 16 (empty,
  partial, fractional, out of range) is never clamped: the grid keeps its last
  good value, the field is marked invalid, the grid message above shows in the
  status box, and USE is disabled. The field snaps back to the grid's value on
  blur, and Enter does not submit the dialog.
- Starting grid: width / 64 by height / 64 when both are whole and at most 16,
  otherwise 1 by 1. A reused sheet starts from the grid last confirmed for it.
- When the grid changes, the picks reset: every cell in reading order if there
  are 16 or fewer, none if there are more.
- Picked cells show their place in the loop; unpicked cells are dimmed.
- REVERSE AT END is a checkbox in the LOOP FRAMES header, between the count and PICK
  ALL, off by default (it starts from the row's setting when the row already has an
  upload). It is disabled with fewer than 3 picked frames, with the title "Needs three or
  more frames.". When it is on, a line under the header reads "Plays 1 to <n>, back
  down to 2, then starts again.", the preview plays in that order, and its frame note
  adds " · back" on the way down. USE keeps the setting with the strip.
- A filled row (not slicing, 3 or more frames) shows the same checkbox under its loop,
  with the note "Plays forward, then back.", so the setting can be changed without
  slicing again. Replacing a sheet keeps it, like FPS. REMOVE clears it.
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
  the background", "File has a problem", "Hidden by a project agent", and
  "Three agents are working" (on every row that is not itself working or
  waiting, while three agents are going; a run going is not enough).
- The rail is 72px with 48px icon buttons. Hovering or focusing one shows the
  hover card to its left: name, role, model, description, and "Click to call
  for your next message". The panel is open at 1200px and wider and a rail below
  that, until the collapse button is pressed; that choice is kept in
  settings.json.
- With an agent called, the input row shows its chip (icon, name, and a remove
  button) and the placeholder "Message for <agent>...". Otherwise the
  placeholder is "Message Claude...".
- The message box grows with its text, from 48px up to 12 lines or 40% of the
  window height, then scrolls. SEND, STOP, and the chip stay at the bottom of
  the row. The history keeps at least 96px, so the stage stays visible.
- The input stays enabled during a run. SEND stays, and STOP is its own button
  beside it, shown only while a run is going. With nobody called, the
  placeholder during a run is "Message Claude or call an agent...".

### Agents at work

- In the history a task is an agent card: icon, name, role and task label, and
  its status as a word. While it runs, its latest activity; when it ends, the
  first three lines of the report and OPEN IN INBOX >.
- A message sent with an agent called shows the agent's chip on top of the text.
- The mascot is WORKING while an agent runs, and the dialogue box reads
  "<agent> is working: <latest activity>". A request from inside an agent has
  one extra line on top: the agent's icon and "<agent> asks".
- Messages during a run: a message sent while a run is going goes into that
  run, at the end of the history, with its chip if one was set. Claude reads it
  after the agent that is working has finished, because Claude Code does not
  read a message while an agent runs in the foreground. Until Claude takes it
  in, the message shows a small QUEUED word; a message still unreceived when the
  run ends shows "Not delivered. The run ended." and is not sent again. Calling
  an agent this way starts that agent after the first one ends, so at most the
  agents Claude itself runs in parallel can be working together; a call with
  three agents already working is refused with "Three agents are already
  working." and nothing is sent. With more than one agent working, the dialogue
  box reads "<n> agents are working".
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

## Model and thinking

See `10-model-picker.html`. A control at the left of the CHAT input row picks
the model and the thinking level for the main conversation, each one AUTO or a
choice. The mockup's backdrop picture and its nav label are not part of the
build.

### What is saved

- Each chat saves `{ model, effort }`. `model` is "auto" or a model value from
  the account's model list. `effort` is "auto" or one of the levels that model
  supports. A chat saved before the picker loads as auto and auto. A chat is the
  open project's conversation.
- settings.json keeps `defaultModel` and `defaultEffort`, both "auto" at first.
  A new chat (NEW CHAT, or a chat with no choice yet) starts from them. With
  "Use for new chats too" checked, a pick is saved as the defaults too, so NEW
  CHAT starts on the same choice. Unchecked, NEW CHAT starts on the defaults
  saved earlier.
- AUTO means Claude Code's default, for both model and thinking. With AUTO the
  app does not set the option at all. The app does not route messages between
  models.
- A pick applies at once. During a run the model goes through `setModel()` (no
  argument for AUTO) and the level through `applyFlagSettings({ effortLevel })`
  (null for AUTO). Both apply from the next message.
- Party agents are not touched and their files are never written. An agent
  whose file sets a model keeps it. An agent with no model line follows the
  main model.

### The model list

- It comes from `supportedModels()`, fetched once per project folder in a
  query opened with no message (nothing is sent to a model), kept in main, and
  shown in the order the SDK returns. No model name is written in the code.
  AUTO is the first row. The SDK's own "default" row is not a row of its own,
  because AUTO is it: its levels are the levels AUTO offers.
- The list scrolls inside the picker.
- If the call fails, the list is AUTO only and the picker shows "Couldn't load
  the model list."
- POWER and SPEED bars come from a table keyed by family, matched on the
  model's value or exact model: opus 3 and 1, sonnet 2 and 2, haiku 1 and 3. A
  model of no listed family shows no bars. AUTO shows dotted bars.
- A row's description is the table's line for the three families, and the
  SDK's own description for any other model.
- Levels: AUTO plus one button per level the selected model supports, in order
  (LOW, MED, HIGH, XHIGH, MAX). If the SDK gives no effort fields for any
  model, every model shows AUTO, LOW, MED, HIGH, MAX. If the SDK gives them for
  other models but not this one, or says it takes none, only AUTO shows, with
  "This model doesn't take a thinking level." The line under the buttons
  describes the selected level.
- The thinking meter has 4 blocks: LOW 1, MED 2, HIGH 3, XHIGH 4, MAX 4. AUTO
  shows alternating blocks. The word, not the blocks, tells XHIGH from MAX.

### A saved choice that no longer fits

The chat falls back, saves the fallback, and shows one line in the
conversation, once:

- A saved model not in the list: "<Name> isn't available right now. Using AUTO."
- A saved level the model does not take: it uses the nearest supported level
  below, else AUTO: "<LEVEL> isn't available on <Name>. Using <LEVEL>."

While the list cannot be loaded nothing is saved, so a failed fetch never costs
the choice.

### The control and the picker

- The control reads "<MODEL> · THINK <LEVEL>" in the pixel font, with the
  4-block meter before it and a caret after, at the left of the input row,
  before the agent chip. It has `aria-expanded` and `aria-haspopup="dialog"`.
- It opens the picker above the input row. Escape, DONE, and a click outside
  close it. Focus moves onto the selected model when it opens, and back to the
  control after Escape or DONE. Arrow keys move through the models (up and
  down) and the levels (left and right); Tab moves through everything.
- MODEL section: one row per model, AUTO first. The selected row has the accent
  fill, dark text, and a text-colored border. POWER and SPEED bars sit on the
  right. THINKING section: the level buttons and the line under them.
- Footer: a "Use for new chats too" checkbox, checked by default, and DONE.
  Under it, one muted line: "Changes apply from your next message. Party agents
  you call keep the model set in their agent file."
- When the model changes in a chat that already has replies, one more muted
  line: "Switching models re-reads the whole chat, which uses more of your plan."
  The change is not blocked.
- Picking applies at once, and the control updates at once.

### The reply tag

- Each of Claude's replies shows a small tag above its text, and the dialogue
  box shows the same tag beside "Claude": "<MODEL> · <LEVEL>", the model that
  answered (the exact model the SDK reports on the reply) and the level in force
  when the reply started. With AUTO the level reads AUTO.
- When Claude thought for at least 1 second before replying, the tag adds " ·
  THOUGHT <n>s". Thinking text is hidden by Claude Code by default, so only the
  time is shown.
- A reply loaded from a saved chat shows the model only: the saved chat keeps
  the model, not the level or the thinking time.

### Copy

Models:

- AUTO: "Claude Code's default model. Follows it when the default changes."
- opus: "Strongest. For hard bugs and big refactors. Uses plan limits fastest."
- sonnet: "Balanced. A good default for everyday coding."
- haiku: "Fastest and lightest. Small edits and quick questions."

Thinking:

- AUTO: "Claude Code's default thinking for this model."
- LOW: "Quick answers. Little thinking before it replies."
- MED: "Thinks through a normal task before acting."
- HIGH: "Plans carefully. Slower, better on tricky changes."
- XHIGH: "Thinks longer than HIGH on hard problems."
- MAX: "Thinks as long as it needs. Slowest and heaviest on limits."

## Chat themes

See `11-chat-themes.html` (the picker) and `8-chat-party.html` (the theme layer behind
the history and the stage, and the THEME button in the header). CHAT shows a
picture (pixel art or a bigger image) behind the history and the stage, under a stepped navy fade so
text stays easy to read. Themes show on CHAT only, not INBOX, AGENTS, or MASCOTS.

### Themes and where they live

- Tokyo Night is the only built-in theme. Its id is "tokyo-night". It is bundled
  with the app as a renderer asset (`src/renderer/src/assets/tokyo-night.png`), so it
  is in the installed build. It cannot be renamed or deleted.
- Uploaded themes live in `userData/themes/`: one image file per theme (PNG or JPG,
  as uploaded), named by a generated id plus its extension, and `themes.json` with
  `{ id, name, file, addedAt }` for each. Main never trusts a path or an id from the
  window without checking it against `themes.json`. The file is stored as is: nothing
  is resized or pixelated on import.
- A theme choice is `{ themeId, fade }`. `themeId` is "none", "tokyo-night", or an
  uploaded id. `fade` is 0 to 100 in steps of 10.
- settings.json holds `defaultTheme`, `{ themeId: "tokyo-night", fade: 60 }` until I
  save another. The current chat may hold its own choice in chats.json. With none,
  it uses `defaultTheme`. NEW CHAT starts with none.
- "THIS CHAT" changes the current conversation only. "ALL CHATS" changes the
  default, which NEW CHAT starts from.

### Uploads

Lenient on size and shape, unlike mascots and icons: PNG or JPG, any aspect ratio,
160x100 up to 6000x6000, 5 MB at most. The file is stored as is; nothing is resized or
pixelated on import. ADD THEME opens a file dialog filtered to PNG and JPG. Main reads
the file and checks, in order:

1. Not larger than 5 MB. Error: "Theme must be 5 MB or smaller."
2. A real PNG or JPEG (the file signature is checked, not the extension). Error: "Theme
   must be a PNG or JPG."
3. Dimensions, read with Electron's nativeImage. If the image cannot be read, the error
   from step 2. At least 160x100, else "Theme must be at least 160x100. <file name> is
   <w>x<h>." At most 6000 on each side, else "Theme must be 6000 px or smaller on each
   side. <file name> is <w>x<h>."

Errors show in the picker in the error style, under the ADD THEME tile, and clear on
the next attempt. A valid file is copied in and gets the file name without its
extension as its name, cut to 24 characters. It appears in the grid and becomes the
draft selection.

Uploaded themes can be renamed (1 to 24 characters, trimmed, not blank) and deleted.
Delete asks first, in the confirm dialog style: "Delete <name>? Chats using it go back
to the default." After a delete, a chat whose choice used that theme drops its own
choice and uses the default. If the default used it, the default becomes "none" with
the same fade.

### Drawing the theme

One ThemeBackdrop component draws it behind the CHAT history and stage frame and in
the picker's preview.

- Layers, back to front: the navy background (`--bg`), the image, the fade, then the
  content. Bubbles, tool cards, agent cards, the dialogue box, and the input row keep
  their solid fills. The plain lines in the history (notices, "Stopped.", errors) get
  the same navy fill, so they stay readable over the picture.
- Two scaling modes, chosen from the image's own size (iw by ih). Both are anchored to
  the bottom edge, and whatever does not fit is cropped by the frame:
  - Pixel art, when iw <= 640 and ih <= 640 (Tokyo Night is 320x200):
    `scale = max(1, ceil(max(width / iw, height / ih)))`, a whole number, where width
    and height are the frame's. The image is drawn at iw*scale by ih*scale, centered
    horizontally, its bottom edge on the frame's bottom edge, with
    `image-rendering: pixelated`.
  - Picture, when either side is over 640: `scale = max(width / iw, height / ih)`, not
    rounded, with smooth scaling, same anchoring.
  The frame is measured again whenever it resizes (ResizeObserver). The picker's tile
  thumbnails show the whole picture, anchored the same way, at a scale that fits the
  160x100 tile, and the preview uses the same rule as CHAT.
- The fade is five flat bands, top to bottom, at 0-14%, 14-28%, 28-42%, 42-56%, and
  56-100% of the frame's height. At fade S, band i has navy (`--bg`) at opacity
  `min(0.95, base[i] * S / 60)`, with base 0.9, 0.8, 0.7, 0.6, 0.55. So 60 matches the
  mockup, 0 shows the image as it is, and 100 nearly hides it. No smooth gradient.
- themeId "none": the plain frame, no image, no fade.
- The image is decorative: empty alt, `aria-hidden`.
- If the image fails to load, it draws as "none" and logs one warning.

### The THEME button

In the CHAT header, before NEW CHAT: "THEME: <NAME IN CAPITALS>" with a 12px swatch
before it (the accent color for a theme; `--bg` with a `--line` border for none). It
opens the picker. It works during a run.

### The picker

A modal dialog over CHAT.

- It opens with a draft equal to the chat's current choice, and APPLY TO set to THIS
  CHAT if the chat has its own choice, else ALL CHATS.
- Left: a grid of tiles. None first, then Tokyo Night, then the uploads oldest first,
  then the ADD THEME tile, then the FORMAT box. The FORMAT box reads: "PNG or JPG,
  160x100 to 6000x6000, up to 5 MB, any shape. Small pixel art keeps crisp pixels;
  bigger pictures scale smoothly. Anchored to the bottom edge." Tiles are radio inputs
  in a fieldset with the legend "Theme", so the arrow keys move between them. A tile
  shows a 160x100 thumbnail, the name, and "Built-in" or "Uploaded" ("Plain navy" for
  None). The draft selection has the selected look (a `--text` border and a hard
  `--accent` shadow). The theme in use has the ACTIVE tag. The selected uploaded tile
  shows RENAME and DELETE buttons. If the grid does not fit, it scrolls inside its
  column.
- Right: PREVIEW, a ThemeBackdrop with two sample bubbles, showing the draft theme and
  fade live. Under it, the FADE STRENGTH slider (0 to 100, step 10, its value shown as
  a percent), then APPLY TO with THIS CHAT and ALL CHATS.
- APPLY: THIS CHAT saves the draft as the chat's own choice. ALL CHATS saves it as
  `defaultTheme` and clears the chat's own choice. Then the dialog closes and CHAT
  shows the new theme at once.
- CANCEL, Escape, and a click on the backdrop close without saving. Uploads, renames,
  and deletes are saved when made, even if I cancel.
- Focus moves into the dialog on open, stays inside while it is open, and returns to
  the THEME button on close. At the minimum window size (960x600) the whole dialog fits,
  and the grid scrolls if needed.

## Markdown

Claude's replies and the agents' reports arrive as Markdown. The app renders
them in its own look with one component (`components/Markdown.tsx` and
`Markdown.css`). Every style sits under `.md` and uses the tokens only. The
stored text never changes: tasks.json and the saved session keep the source.

### Where it is rendered

- CHAT: Claude's reply, in the dialogue box while it types and in the history,
  including history loaded from a saved session.
- INBOX task detail: TASK (what Claude asked the agent), and REPORT when the
  task ended as done.

### Where it is not

These stay plain text, character for character:

- My own messages.
- Tool card labels and activity lines ("Finding **/*.{test,spec}.*" keeps its
  asterisks).
- Request details, on CHAT, in INBOX, and in the popup.
- The report of a task that ended as error or stopped, error messages,
  notices, and every text the app itself writes.
- Agent descriptions in the party panel and on AGENTS, and the agent editor.

### Previews

`toPlainText` (src/shared/plainText.ts) turns Markdown into plain text with
one line per block: no heading, bold, italic, code, list, quote, or table
marks, a link's text and an image's alt text kept, and the harness note left
out. It is used for the INBOX row preview of a done task (then cut at 80
characters), the first three lines of a done report on the agent card, the
popup's first lines, and the screen-reader announcement of a reply. Activity
lines and "Waiting: <label>" are not Markdown and do not go through it.

### Look

- Body: IBM Plex Mono 13px, line height 1.6, 12px between blocks. In the
  INBOX detail a line of text is at most about 78 characters; code boxes and
  tables use the full width.
- Headings: Press Start 2P in the accent color, never bigger than the
  screen's section labels: levels 1 and 2 at 9px with a 2px line under them,
  level 3 at 8px with no line. Levels 4 to 6 are the body font in bold. More
  space above a heading (20px) than under it (8px).
- A paragraph that is only one bold run ("**Summary**") is drawn as a level 3
  heading.
- Bold: weight 600 in the text color. Italic: italic. Strikethrough: a line
  through, in muted.
- Lists: a 6px accent square for bullets, accent numbers, 6px between items,
  nested lists indented 20px. Task list items show a drawn pixel box, empty or
  filled; it is not an input and cannot be clicked.
- Inline code: the same font on raised, 1px line border, 4px side padding.
  Long paths wrap anywhere.
- Code blocks: a box with a 2px line border on bg. Lines do not wrap; the box
  scrolls sideways inside itself. The language, when named, is a small muted
  label at the top left. COPY at the top right copies exactly the code and
  reads COPIED for 1.5 seconds (COPY FAILED if the clipboard refuses). No
  syntax colors.
- Quotes: a 4px line bar on the left and muted text.
- Tables: 2px line borders on every cell, the header row bold on raised,
  6px 10px cell padding, sideways scrolling inside the table's own wrapper.
- A rule (---) is a 2px dashed line.
- Links: accent, underlined, with the app's focus ring.
- Nothing in the component is animated. At 960x600 nothing rendered makes the
  screen scroll sideways.

### Typing out

- The dialogue box keeps its speed, skip, reduced motion, size, scrolling, and
  the mascot's TALKING timing. It counts the visible characters of the
  rendered text, not the source: Markdown marks never show while typing.
- Structure appears with its first character: a bullet with the first letter
  of its item, a heading already in its heading look, a code box with its
  first character. A table appears whole. The cursor sits after the last
  character shown.
- While a reply streams, its last block can be unfinished: an unclosed code
  fence shows as a growing code box, and an unclosed ** or backtick may show as
  written until its closing mark arrives.
- Finished blocks are parsed once. Only the last block is parsed again when
  new text arrives, and a typing tick never parses. A reply with link
  reference or footnote definitions is parsed whole once the run ends, so it
  matches the history exactly.
- Loaded history, TASK, and REPORT appear at once and never type.

### Harness note

Claude Code's harness can put a note in square brackets in front of an
agent's report, for example "[harness: subagent output matched
instruction-shaped pattern(s): ...]". It is not in the SDK's docs; it comes
from the bundled Claude Code, which writes it as the report's own first block.

- When a done report's first block starts with "[harness:" and ends with "]",
  it is taken out of the body and shown above the report: the label HARNESS
  NOTE in the waiting color and a SHOW button, which becomes HIDE. Opened, it
  shows the whole note as plain text. It starts closed and is never dropped.
- A first block of any other shape stays in the body.
- Nothing the note describes is undone: "<\" stays "<\".

### Safety

The text comes from a model and can hold anything.

- No raw HTML: HTML in the text shows as text. No HTML plugin, and never
  `dangerouslySetInnerHTML`.
- Only http and https become links; every other address (javascript:, file:,
  relative links, file paths, in-page anchors) shows its text as plain text.
  Each link shows its full address as its title and opens in the system
  browser. Main stops any navigation of the app window and opens only http
  and https outside.
- Images are never loaded and no img element is made. An image with an http
  or https address shows as a link reading "[image: <alt text>]"; any other
  image shows its alt text.

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
