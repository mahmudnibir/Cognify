# Cognify – YouTube Focus & Playback Controls

> A YouTube-only browser extension for playback control, bookmarks, focus, and intentional screen-time management.

**Version** 3.9.0 &nbsp;·&nbsp; **Manifest** V3 &nbsp;·&nbsp; **Author** [Mahmud Nibir](https://github.com/mahmudnibir)

![Views](https://visitor-badge.laobi.icu/badge?page_id=mahmudnibir.yt-extension-enhanced)

---

## Features

| Feature | Description |
|---|---|
| Speed Control | YouTube playback speed from 0.25× to 16× with a labeled scale |
| Bookmark Library | Save timestamp bookmarks with notes; search, filter, sort, and organize videos into collections. Expand timestamp lists on demand, sync with Chrome, and share, import, or export bookmark data |
| Ad Skip | Automatically skips YouTube advertisements |
| SponsorBlock | Auto-skip sponsor segments via community data |
| Content Filters | Hide comments, shorts, description, or suggested videos |
| Focus Mode | Hides the sidebar navigation while watching to reduce distractions |
| Auto Theater Mode | Automatically switches to theater view on video load |
| Auto Fullscreen | Automatically enters fullscreen when playback starts |
| Default Volume | Enforce a set volume level on every video load |
| Auto Subtitles | Automatically enable closed captions on video load |
| Sleep Timer | Pause playback after a set number of minutes |
| Screen Time Limits | Daily watch-time cap with a warning and auto-pause |
| Watch Statistics | Track YouTube watch time and session history with a live graph and daily/weekly breakdown |
| Loop Segment (A→B) | Set A and B loop points with `[` / `]` keys; the video continuously repeats the marked section. Clear with `\` or the popup button |
| Timestamp Share Links | Copy a shareable YouTube URL at the exact timestamp of any bookmark directly from the bookmarks panel; links open at that precise moment |
| Watched Progress Tags | Automatic red progress bars on video thumbnails for partially-watched videos; progress is silently tracked every 5 seconds |
| Keyboard Shortcuts | Fully customizable hotkeys for all controls |
| Voice Modes | 8 real-time audio modes: Normal, Chipmunk, Pikachu, Naruto, Doraemon, Bass Boost, Robot, Echo |
| Feature Guide | In-popup `?` button opens a scrollable guide listing all setting descriptions grouped by section |

---

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist bookmarks, settings, and statistics |
| `tabs` | Detect when the active tab leaves YouTube so watch-time tracking stops accurately |
| YouTube host access | Add playback controls and track YouTube watch time |

---

## Usage

Click the **Cognify** extension icon or press **Ctrl+Shift+Y** to open the control panel. You can review or remap the shortcut at `chrome://extensions/shortcuts`. Cognify runs on YouTube; it does not inject scripts into other sites. Settings persist across sessions via Chrome Sync.

In the **Bookmarks** tab, search, filter, and sort saved videos; add notes to timestamps; and organize videos into collections. Long timestamp lists stay compact until expanded. Use the collection options to share a collection as a JSON file, or import and export bookmark data. The **Stats** tab contains watch-time statistics. The **Settings** tab contains keyboard shortcuts and playback and focus controls.

---

## License

MIT © [Mahmud Nibir](https://github.com/mahmudnibir)
