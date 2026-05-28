# Douyin Hozon

A terminal app for downloading douyin media without leaving the keyboard. Paste a URL, hit Download.

## Quick start

```bash
git clone <this-repo>
cd douyin-hozon
pnpm install
pnpm dev
```

Then, inside the app:

1. Press `/` and pick **Capture Cookies**. Chrome must be open and signed in to douyin. (macOS + Windows only — on Linux, paste the 5 cookies into **Settings** manually.)
2. Pick a mode on the left.
3. `Tab` into the right panel, paste a URL into the URL field.
4. `Tab` to the **Download** button → `Enter`.

Files land in your OS Downloads folder under `douyin-hozon/`.

## What it can download

| Mode | What you give it |
| --- | --- |
| Single Video | a `/video/...` URL or a `v.douyin.com/...` short link |
| Image Note | a `/note/...` or `/gallery/...` URL |
| Collection | a `/collection/...` or `/mix/...` URL (optional limit + date filters) |
| Music Track | a `/music/...` URL |
| Creator Liked Posts | a creator's `/user/...` URL (signed-in cookies decide what you can see) |
| My Favorite Collection | nothing — uses your signed-in account |

URL fields accept the noisy "share text" douyin gives you (`5.12 Z@m... Description ... https://v.douyin.com/jA3Z_lr7tyX/ copy this link...`). The app extracts the URL and follows the redirect automatically.

## Using it

- `Tab` — switch between the **MODE** panel (left) and the **TASK** panel (right).
- `↑ ↓` — move selection.
- `Enter` — start editing a field; `Enter` again to commit.
- `Space` — toggle checkboxes.
- `Esc` — cancel an edit / close a dialog / return to the MODE panel.
- `/` — open the command palette (Capture Cookies, Settings).
- `q` or `Ctrl+C` — quit.

## Tips

- Re-run **Capture Cookies** when downloads start failing — cookies expire every couple of months.
- For batch modes (Collection / Creator Liked / Favorites), set **Item Limit** to a small number (`2`) the first time so you can verify before pulling hundreds.
- Settings remembers everything — URLs, save path, captured cookies, toggles — across all 6 modes, auto-saved to `./config.yml`.
- Open **Settings** (`/` → Settings) to tweak the download path layout, retry count, proxy, or manual cookie values.
- Change **Save Path** in the TASK panel to land files anywhere else.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Capture Cookies Failed: keychain_denied" (macOS) | Allow the keychain prompt and re-capture. |
| "No douyin cookies found in any Chrome profile" | Sign in to `douyin.com` in Chrome at least once, then re-capture. |
| "Validation Error" alert | The URL field is empty or malformed — paste a fresh URL. |
| "HTTP 4xx" while downloading | Cookies expired — re-run **Capture Cookies**. |
| Item count is 0 for Creator Liked Posts | The creator's likes are private. |
| Item count is 0 for My Favorite Collection | Your account has no saved "favorites" folders. |
| Downloads in the wrong folder | Edit **Save Path** in the TASK panel. |

## License

ISC.
