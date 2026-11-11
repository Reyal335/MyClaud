# MyClaud

MyClaud is a personal desktop app that puts a custom 8-bit retro interface on
top of Claude Code. You chat with coding agents, and the replies type out in an
RPG-style dialogue box next to a small pixel mascot.

It is built with Electron and the Claude Agent SDK. It is for one person on one
machine. It is not a product and it has no accounts of its own.

## Features

### Working now

- **Chat with an agent.** Type a prompt, and the reply streams into the dialogue
  box. The mascot's state follows the run.
- **Tool cards.** Each tool call shows as a card with its name, its input, and a
  status: RUNNING, WAITING, DONE, FAILED, DENIED, or STOPPED.
- **Approve or deny.** Reading files (`Read`, `Grep`, `Glob`) runs without asking.
  Editing files (`Edit`, `Write`) and shell commands (`Bash`) wait for your
  Approve or Deny.
- **Stop.** The STOP button ends the current run. Any tool still waiting is
  denied.
- **Mascot with five states.** The mascot reacts to the run: idle, thinking,
  talking, working, or asking (waiting for you).
- **Agent manager.** Create, edit, and delete agent files for the open project
  or for your whole machine. You can give an agent a 16x16 PNG icon and a short
  role label.

### Planned

These are on the roadmap. They are not built yet.

- **Mascot manager.** Upload your own mascots as spritesheets, with one loop per
  state.
- **Inbox with many threads.** Every agent conversation becomes a thread with a
  status. Threads waiting for approval count as unread.
- **Popup notifications.** A small always-on-top window with the mascot when a
  task finishes, needs approval, or fails.

## Tech stack

- Electron, React, and TypeScript, built with electron-vite
- `@anthropic-ai/claude-agent-sdk`, which runs the agents
- Plain CSS with CSS variables for the colors and type. No UI library.

## Prerequisites

- **Node.js and npm.** The project does not pin a Node version in
  `package.json`.
- **Claude Code, signed in.** MyClaud uses the Claude Code login on your
  machine. See [Authentication](#authentication).

## Authentication

MyClaud has no login screen and no API key. It runs on the Claude Code login
that is already on your machine, so usage counts against your Claude plan.

Sign in once in a terminal:

```bash
claude
```

Then type `/login` at the Claude Code prompt and follow the steps.

The app also:

- Does not read a `.env` file. There is no `.env` setup.
- Never reads, copies, stores, or displays your credentials or tokens.
- Removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment it
  gives the agent. A stray API key on your machine cannot switch billing to the
  API.
- Stops a run with an error if Claude Code reports that it is using an API key
  instead of your account login.

## Getting started

Install the dependencies:

```bash
npm install
```

`npm install` also downloads Electron and rebuilds the app dependencies.

Start the app in development mode, with hot reload:

```bash
npm run dev
```

Build and check the app:

```bash
npm run build           # type checks, then builds the app into out/
npm run start           # runs the last build with electron-vite preview
```

Package the app:

```bash
npm run build:unpack    # builds, then makes an unpacked app folder
npm run build:win       # builds, then makes a Windows installer
npm run build:mac       # builds, then makes a macOS package
npm run build:linux     # builds, then makes Linux packages
```

Other scripts:

```bash
npm run typecheck       # type checks the main and renderer code
npm run lint            # runs ESLint
npm run format          # runs Prettier on the whole project
npm run icon            # regenerates the app icon files from scripts/make-icon.mjs
```

### Opening a project

When you start MyClaud, click **OPEN** in the sidebar and pick a project folder.
MyClaud remembers the folder for next time. Chat runs in that folder, and the
project's agents are loaded from it.

## Project structure

```
myclaud/
├── src/
│   ├── main/        Electron main process: runs the Agent SDK, file access, IPC
│   ├── preload/     The typed bridge between the main process and the window
│   ├── shared/      Types and rules used by both sides (IPC channels, agent rules)
│   └── renderer/    The React app: screens, components, hooks, styles
├── designs/         Static HTML mockups and DESIGN.md (colors, type, rules)
├── scripts/         make-icon.mjs, which draws the app icon
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

The Agent SDK runs only in the main process. The renderer never imports it. The
main process forwards the SDK's stream events to the window, and the window only
draws them. Permission requests go to the window, and your Approve or Deny goes
back to the main process.

## Where app data lives

MyClaud keeps its data in Electron's `userData` folder. On Windows this is
normally under `%APPDATA%`.

| File or folder | What it holds |
| --- | --- |
| `settings.json` | The path of the project you last opened |
| `agent-icons/` | The 16x16 PNG icons you chose for agents |
| `agent-icons.json` | A map from each agent file path to its icon file |
| `agent-roles.json` | A map from each agent file path to its role label |

The icon and role maps use the agent file path as the key. MyClaud never adds
its own fields to agent files, so Claude Code only sees the standard fields.

Deleting an agent in MyClaud moves its file to the trash. It also removes that
agent's icon and role entries.

## Agent files

Agents are Markdown files that Claude Code also reads.

- **Project agents** live in `<project>/.claude/agents/`. They are only listed
  when a project is open.
- **Global agents** live in `~/.claude/agents/`. If the `CLAUDE_CONFIG_DIR`
  environment variable is set, global agents live in `<that folder>/agents/`.

An agent file has a frontmatter block with `name` and `description`, and an
optional `tools` and `model`. The text after the block is the agent's system
prompt. For example:

```markdown
---
name: code-reader
description: Reads the project and explains how a part of it works.
tools: Read, Grep, Glob
model: sonnet
---

You explain code in plain words. Start with the big picture, then go into
detail only where it helps.
```

Notes on agent fields:

- `name` must be unique within its folder. It cannot contain `:` or line
  breaks, and it cannot start with `-`.
- `description` is required.
- `model` can be `inherit`, `sonnet`, `opus`, `haiku`, or `fable`.
- The form lists these tools: `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`,
  `WebFetch`, and `WebSearch`. Chat runs enable only `Read`, `Grep`, `Glob`,
  `Edit`, `Write`, and `Bash`. See [Current limits](#current-limits).
- A **role** is an optional label of up to 40 characters, such as
  `code-reader`. MyClaud stores it in `agent-roles.json`, not in the agent file.
- An **icon** is optional. It must be a PNG that is exactly 16x16 pixels. MyClaud
  rejects any other size and does not resize it. Agents without an icon show a
  placeholder.

## Mascot spritesheets

The mascot is drawn from a spritesheet. The mascot manager that uploads your own
sheets is planned. Until then, the app shows its built-in mascot for every
state.

The sheet format, from `designs/DESIGN.md`:

- PNG, with frames laid out in one horizontal strip.
- Each frame is 64x64 pixels. The sheet is exactly 64 pixels tall, and its width
  is a multiple of 64.
- At most 16 frames per loop.
- One loop per state: `idle`, `thinking`, `talking`, `working`, and `asking`.
- `idle` is required. A state with no loop plays the idle loop.
- The design calls for display at 1x, 2x, or 3x only, so the pixels stay sharp.

## Current limits

- The mascot uses the built-in image for every state. Custom loops come with
  the mascot manager.
- The inbox shows one conversation at a time. Multiple threads come later.
- The agent form lists `WebFetch` and `WebSearch`, but chat runs do not enable
  them yet.
- The conversation is kept in memory only. Closing the app clears it.

## Roadmap

1. Scaffold the app with one window and the navigation shell. *Done*
2. One conversation with streamed replies. *Done*
3. Tool activity cards and Approve / Deny for permission requests. *Done*
4. Mascot with five states, driven by the stream. *Done*
5. Agent manager: read, create, edit, and delete agent files, with icon upload.
   *Done*
6. Mascot manager: spritesheet upload, validation, and per-state loops. *Planned*
7. Multiple conversations and an inbox with statuses. *Planned*
8. Popup notification window. *Planned*

The build order and design rules are in `CLAUDE.md` and `designs/DESIGN.md`.

---

Written with love by March 7th.
