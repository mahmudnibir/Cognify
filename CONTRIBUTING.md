# Contributing to Cognify

Thanks for taking the time to contribute! All improvements are welcome — bug fixes, new features, UI polish, and documentation.

---

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Load the extension in Chrome:
   - Go to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the project folder
3. Make your changes, then reload the extension from `chrome://extensions` to test them.

---

## Project Structure

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `popup.html` / `popup.js` | Extension popup UI |
| `content.js` | YouTube-specific features (ad-skip, bookmarks, stats) |
| `video-hover.js` | Universal hover overlay for all sites |
| `background.js` | Service worker (storage, messaging) |
| `index.html` | GitHub Pages landing site |

---

## Coding Guidelines

- Keep code **modular and readable** — one responsibility per function.
- Use **descriptive variable and function names**.
- **Comment complex logic**; add JSDoc for public functions.
- Validate inputs and handle edge cases and API errors.
- Follow existing code style — no external linter is configured, but match the surrounding style closely.

---

## Submitting a Pull Request

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit with a conventional message:
   ```
   feat(overlay): add double-click to reset speed
   fix(content): prevent ad-skip loop on live streams
   ```
3. Open a PR against `main` with a clear description of what changed and why.
4. Ensure there are no console errors when the extension loads.

---

## Reporting Issues

Open an issue and include:
- Chrome version and OS
- Steps to reproduce
- What you expected vs. what happened
- Any console errors from the Extensions page or DevTools

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
