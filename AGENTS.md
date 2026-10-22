# Mobile Herdr development

- This is a client of existing Herdr sessions. Do not restart, upgrade or terminate a user's Herdr server to test changes.
- Run writes / terminal tests only in test sessions created by the test itself. `MOBILE_HERDR_LIVE=1 bun test tests` owns and cleans its isolated session.
- Legacy agent chat submission must use `agent.prompt` against the selected machine + session + pane. Native sessions use their registered Codex broker or Pi extension, with one live provider and fenced input ownership. Do not resume a second copy of an agent to implement chat or silently migrate existing sessions.
- Prefer Herdr-reported transcript identity. Never silently attach the newest transcript based on cwd. Unreported sessions require explicit selection.
- No automatic replay of writes after reconnect. Keep drafts on failures. Deduplicate ambiguous retries by request ID.
- Keep auth tokens out of query strings, logs, screenshots, and checked-in files. The CLI pairing fragment is an intentional credential handoff and is removed immediately on page load.
- The current delivery target is phone-first Web. Expo files are a future native starting point, not an accepted native release.
- Changes to flows must pass `bun run typecheck`, relevant `bun test tests`, and `bun run test:ui` after rebuilding static assets. Browser checks use Python Playwright through uv and a fixture Unix socket.
- Verify mobile widths and reduced visual viewport height. Real device keyboard and OS background behavior require separate verification; do not describe desktop emulation as device testing.
