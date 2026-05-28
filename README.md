# Douyin Hozon

A terminal app for downloading douyin media — videos, image notes, collections, music tracks, a creator's liked posts, or your own favorite collections — without leaving the keyboard.

Paste a URL, hit Download. That's the whole thing.

## What it can download

| Mode                   | What you give it                                                                |
| ---------------------- | ------------------------------------------------------------------------------- |
| Single Video           | a `/video/...` URL or a `v.douyin.com/...` short link                           |
| Image Note             | a `/note/...` or `/gallery/...` URL                                             |
| Collection             | a `/collection/...` or `/mix/...` URL (with optional item limit + date filters) |
| Music Track            | a `/music/...` URL                                                              |
| Creator Liked Posts    | a creator's `/user/...` URL (signed-in cookies decide what you can see)         |
| My Favorite Collection | nothing — uses your signed-in account directly                                  |

URL fields accept the noisy "share text" douyin gives you (like `5.12 Z@m... Description detail text ... https://v.douyin.com/jA3Z_lr7tyX/ copy this link...`). The app extracts the URL and follows the redirect to the canonical video automatically.

## Requirements

- **Node.js 18+**
- **macOS, Windows, or Linux.** macOS and Windows get one-click Chrome cookie capture. Linux runs the app fine; you just paste the 5 cookies into Settings manually instead.
- **Google Chrome** with douyin signed in (any profile — it auto-picks the right one)

No Python, no virtualenv. The app is pure TypeScript/Node — it parses douyin
URLs, signs the web-API requests (X-Bogus / a_bogus / msToken), and downloads,
all natively. (A legacy Python sidecar still ships as an optional break-glass —
see [Break-glass](#break-glass).)

## Install

```bash
git clone <this-repo>
cd douyin-hozon
pnpm install
```

## Run

```bash
pnpm dev
```

That's it — pure TypeScript, no extra setup.

## First-time setup (30 seconds)

1. Make sure you're signed in to `douyin.com` in Chrome (any profile, you don't have to think about which one).
2. Start the app: `pnpm dev`
3. Press `/` to open the command palette.
4. Pick **Capture Cookies**. Chrome stays open; cookies are pulled automatically.

You're done. Cookies are captured for the current session. Re-do step 2–4 anytime they expire (typically every couple of months).

## Using it

- `Tab` switches between the left **MODE** panel and the right **TASK** panel.
- `↑↓` moves the selection.
- `Enter` to start editing a field, `Enter` again to commit.
- `Space` toggles checkboxes.
- `Esc` cancels an edit / closes a dialog / returns to the MODE panel.
- `/` opens the command palette (Capture Cookies, Settings, Open Browser).
- `q` or `Ctrl+C` to quit.

To download something:

1. Pick a mode on the left.
2. Tab into the right panel.
3. Fill in the URL (paste anything — the app cleans it up).
4. Tweak any optional fields you want (cover/music/avatar/JSON, item limits for batch modes).
5. Tab to the **Download** button → `Enter`.

Files land under your OS Downloads dir + `douyin-hozon/` by default — `~/Downloads/douyin-hozon/` on macOS, `%USERPROFILE%\Downloads\douyin-hozon\` on Windows, your `$XDG_DOWNLOAD_DIR` (or `~/Downloads`) on Linux. The layout is `<save>/<author>/<title>_<id>/<title>_<id>.mp4` out of the box; toggle the **Path Preference** cluster in Settings to also include the mode folder or a date prefix. Set the **Save Path** field to land them anywhere else.

## Tips

- **Hold Backspace** for ~3 seconds to wipe the field you're editing.
- **Settings** (`/` → `/settings`) holds shared configuration: concurrent download limit, retry count, **Path Preference** (which of `author_name` / `mode_folder` / `date` / `title` appear in the path + filename), proxy, and a **Cookies** cluster (`msToken` / `ttwid` / `odin_tt` / `passport_csrf_token` / `sid_guard`) that shows the captured values inline and lets you override per-key.
- **Item Limit** for batch modes (Collection / Creator Liked / Favorites): set it to a small number (`2`) the first time so you can verify things work before pulling hundreds.
- **Settings persist automatically.** All your inputs across the 6 modes (URLs, save path, toggles, captured cookies) are auto-saved to `./config.yml` as you edit. `config.yml` is gitignored; the template lives at `config.example.yml`.
- If you have multiple douyin accounts in different Chrome profiles, the app automatically picks the profile with the most douyin cookies.

## Troubleshooting

| What you see                                      | What to do                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Capture Cookies Failed: keychain_denied" (macOS) | macOS prompted for keychain access — allow it and run capture again.               |
| "No douyin cookies found in any Chrome profile"   | Sign in to `douyin.com` in Chrome at least once, then re-capture.                  |
| "Validation Error" alert                          | The URL field is empty or malformed. Paste a fresh URL.                            |
| "HTTP 4xx" while downloading                      | Cookies expired. Re-run **Capture Cookies**.                                       |
| Item count is 0 for Creator Liked Posts           | The creator's likes are private — that's douyin's choice, not ours.                |
| Item count is 0 for My Favorite Collection        | Your account has no saved "favorites" folders. (Not the same as browsing history.) |
| Downloads go to the wrong folder                  | Edit the **Save Path** field in the TASK panel.                                    |

## Break-glass

douyin occasionally bumps its anti-bot signing. The native signer is a faithful
port of the upstream algorithms; if a bump ever outpaces it, you can fall back
to the original Python implementation without waiting for a fix:

```bash
DOUYIN_HOZON_PARSER=sidecar pnpm dev
```

This spawns the legacy Python sidecar. The first sidecar run clones the pinned
upstream `douyin-downloader`, creates a `.venv`, and installs its Python deps —
so this path (and only this path) needs **Python 3** on your `PATH`.

Maintainers: `pnpm vendor:check` diffs the upstream signing/parsing signatures
against the committed `vendor-api/tally.json` and flags drift, so a bump is
caught before it breaks anyone. Full drift → re-port → re-baseline workflow in
[docs/MAINTAINER.md](docs/MAINTAINER.md).

## License

ISC.
