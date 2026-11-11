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
