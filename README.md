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
- **Python 3** (used internally; you don't need to do anything with it)
- **macOS or Windows** (for the one-click Chrome cookie capture)
- **Google Chrome** with douyin signed in (any profile — it auto-picks the right one)

## Install

```bash
git clone <this-repo>
cd douyin-hozon
npm install
```

## Run

```bash
npm run dev
```

That's it. The first run also clones the upstream parser, sets up its Python virtualenv, and installs Python deps automatically. Subsequent runs skip those if nothing changed.

## First-time setup (30 seconds)

1. Make sure you're signed in to `douyin.com` in Chrome (any profile, you don't have to think about which one).
2. Start the app: `npm run dev`
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
4. Tweak any optional fields you want (cover/music/avatar/JSON, item limits for batch modes, transcript).
5. Tab to the **Download** button → `Enter`.

Files land under `~/Downloads/douyin-hozon/<author>/<mode>/<date>_<title>_<id>/`. Change the **Save Path** field to land them anywhere else.

## Tips

- **Hold Backspace** for ~3 seconds to wipe the field you're editing.
- **Settings** (`/` → `/settings`) holds shared configuration: concurrent download limit, retry count, proxy, transcript API key, manual cookie overrides.
- **Item Limit** for batch modes (Collection / Creator Liked / Favorites): set it to a small number (`2`) the first time so you can verify things work before pulling hundreds.
- **Incremental Download** (Creator Liked) skips items you've already pulled. The dedup database lives in `download-db/` next to the project.
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

## License

ISC.
