# Cognify – Smart Study Automation for Your Browser

> A powerful Chrome extension that automates your study routine and brings intelligent focus tools directly to your browser.

**Version** 3.8.0 &nbsp;·&nbsp; **Manifest** V3 &nbsp;·&nbsp; **Author** [Mahmud Nibir](https://github.com/mahmudnibir)

![Views](https://visitor-badge.laobi.icu/badge?page_id=mahmudnibir.yt-extension-enhanced)

---

## Features

| Feature | Description |
|---|---|
| Speed Control | Playback speed from 0.25× to 20× via slider |
| Speed Presets | Quick-access 1.25×, 1.5×, 1.75×, 2× buttons in the Advanced tab |
| Universal Video Speed | Hover overlay on **any** video across the entire web — toggle in settings |
| Bookmarks | Cloud-synced video timestamps with labels, import & export as JSON |
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
| Watch Statistics | Track total watch time and session history with a live graph (Y-axis labels, daily/weekly breakdown) across YouTube, Instagram, and Facebook; last-selected platform tab is remembered |
| Social Download | One-click video download overlay on Instagram and Facebook posts |
| Hide Messenger | Remove the Facebook Messenger chat bubble and chat panel with a single toggle; updates the page instantly without a reload |
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
| `activeTab` | Interact with the active YouTube tab |
| `scripting` | Inject controls into the YouTube player |

---

## Usage

Click the **Cognify** extension icon on any supported page to open the control panel. All settings persist across sessions via Chrome's sync storage. The **Advanced** tab contains automation toggles (theater, fullscreen, subtitles, focus mode), playback presets, bookmark import/export, and statistics management.

---

## License

MIT © [Mahmud Nibir](https://github.com/mahmudnibir)
