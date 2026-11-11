# MyClaud

A personal desktop app that puts a custom 8-bit retro interface on top of
Claude Code, using the Claude Agent SDK.

## What it does

- Chat with coding agents. Replies type out in an RPG-style dialogue box
  next to an animated pixel mascot.
- Inbox: every agent conversation is a thread with a status (running,
  waiting for approval, done, error). Waiting threads count as unread.
- Agent manager: create, edit, and delete agents. Project agents are
  Markdown files in `<project>/.claude/agents/`, global agents are in
  `~/.claude/agents/`. Each agent can have a 16x16 PNG icon.
- Mascot manager: upload mascots as 64x64 spritesheets, one loop per state
  (idle, thinking, talking, working, asking).
- Popup notifications: a small always-on-top window with the mascot when a
  task finishes, needs approval, or fails.

## Stack

- Electron, React, TypeScript, built with electron-vite.
- `@anthropic-ai/claude-agent-sdk` for running agents.
- Plain CSS with CSS variables for the design tokens. No UI library.

## Architecture rules

- The Agent SDK runs in the Electron main process only. The renderer never
  imports it.
- Main and renderer talk over typed IPC through a preload script, with
  `contextIsolation` on and `nodeIntegration` off.
- The main process forwards SDK stream events to the renderer. The renderer
  only renders them.
- Permission requests from the SDK go to the renderer as an event, and the
  user's Approve or Deny answer comes back over IPC.
- App data (mascots, agent icons, the icon mapping, settings) lives in
  Electron's `userData` folder. Never add custom fields to agent Markdown
  files; map agent file path to icon in a JSON file instead.
- Authentication: the app runs on the Claude Code login already on the
  machine, so usage counts against that person's Claude plan. The user
  signs in once by running `claude` and `/login` in a terminal. The app
  has no API key, no `.env`, and no login screen of its own. It never
  reads, copies, stores, or displays credentials or tokens. It removes
  `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment it
  gives the SDK, so a stray key cannot switch billing to the API.

## Design

- `designs/` holds static HTML mockups and `designs/DESIGN.md` holds the
  colors, type, and rules. Read `DESIGN.md` before building any UI and match
  the mockups.
- Do not copy the mockup HTML directly. It uses inline styles for
  everything. Build React components and put the tokens in CSS variables.
- Do not use Claude Code's own mascot, logo, or terminal visuals anywhere.

## Build order

1. Scaffold the app, with one window showing the nav shell.
2. One conversation: send a prompt, stream the reply as plain text.
3. Tool activity cards and permission requests with Approve / Deny.
4. Mascot component with the five states driven by stream events.
5. Agent manager: read, create, edit, delete agent files, plus icon upload.
6. Mascot manager: spritesheet upload, validation, per-state loops.
7. Multiple conversations and the inbox with statuses.
8. Popup notification window.

Work on one step at a time. Do not start the next step until I say so.

## Conventions

- Small commits, one per working change.
- Ask before adding a new dependency.
- Validate uploads strictly and show the exact error from `DESIGN.md`.
