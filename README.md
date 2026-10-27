# LinkedIn Saved Posts Getter

A full-stack, autonomous browser automation agent that extracts all your saved LinkedIn post links using **Mozilla Firefox** with your existing login session. Features an editorial dark-mode web dashboard with real-time WebSocket log streaming, live status updates, deduplication, and JSON export.

---

## Table of Contents

- [Purpose](#purpose)
- [How It Works](#how-it-works)
- [How the Automation Agent is Implemented](#how-the-automation-agent-is-implemented)
- [Architecture & Technologies Used](#architecture--technologies-used)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [How to Run](#how-to-run)
  - [1. Web Application (Recommended)](#1-web-application-recommended)
  - [2. Standalone CLI Script](#2-standalone-cli-script)
  - [3. Headed Mode (Watch Firefox in Action)](#3-headed-mode-watch-firefox-in-action)
- [API Endpoints](#api-endpoints)
- [Output Format](#output-format)
- [Project Structure](#project-structure)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [License](#license)

---

## Purpose

LinkedIn lets you bookmark and save insightful posts, articles, and videos for later. However, **LinkedIn provides no native export button or public API** to export your saved items list.

Extracting them by hand requires:
1. Scrolling through pages of lazy-loaded feed items.
2. Clicking the three-dot (`...`) overflow menu on every individual post.
3. Clicking *"Copy link to post"*.
4. Pasting the link into a spreadsheet or notes document.

Doing this for dozens or hundreds of posts takes hours. **LinkedIn Saved Posts Getter** completely automates this workflow into a single click, saving all canonical URLs to a clean JSON file while preserving your active session without risking your credentials.

---

## How It Works

The application operates as an end-to-end autonomous pipeline:

```
┌────────────────────────────────────────────────────────┐
│ 1. Session Discovery & Safe Snapshot                  │
│    Scans ~/.mozilla/firefox/ for active li_at cookies  │
│    Safely copies cookies.sqlite (no locks / conflicts) │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. Firefox Launch & In-Page Hook                      │
│    Launches Playwright Firefox with session cookies    │
│    Injects hook to intercept clipboard writeText       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. Navigation & Infinite Scroll                       │
│    Navigates to /my-items/saved-posts/                 │
│    Dynamically scrolls until all items are loaded      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. Dropdown Extraction & Link Capture                 │
│    Iterates through post overflow (...) buttons        │
│    Clicks "Copy link to post" & captures URL in memory │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. Deduplication & Persistence                        │
│    Deduplicates with previous runs                     │
│    Writes canonical URLs to output/saved-post-links.json│
│    Streams live progress & summary to Web Dashboard   │
└────────────────────────────────────────────────────────┘
```

1. **Session Auto-Discovery**: Automatically locates your Firefox profile (`~/.mozilla/firefox/`) containing your logged-in LinkedIn session (`li_at` cookie).
2. **Safe SQLite Snapshot**: Copies `cookies.sqlite` to a temporary directory before querying. This completely bypasses Firefox SQLite WAL locks, meaning **you do not need to close your active Firefox browser** while running this app.
3. **In-Page Clipboard Hook**: Uses Playwright's `addInitScript` to hook `navigator.clipboard.writeText` in the page context. Whenever LinkedIn's dropdown button fires its copy action, the canonical link is captured directly in memory without browser permission prompts.
4. **Adaptive Lazy-Load Scrolling**: Continuously scrolls the viewport and evaluates DOM container count stability. When 3 consecutive scrolls produce no new elements, it knows all posts are rendered.
5. **Scoped Menu Interaction**: Targets visible dropdown buttons (`.artdeco-dropdown__content, [role="menu"]`), clicks *"Copy link to post"*, records the link, and presses `Escape` to close the menu cleanly.
6. **Deduplication & Export**: Compares extracted URLs against [saved-post-links.json](output/saved-post-links.json) using a `Set`, adds only new links, and saves updated results.

---

## How the Automation Agent is Implemented

Many modern scrapers rely on heavy Large Language Models (LLMs) with vision/screenshots. While useful for open-ended browsing, LLM-based scraping for this workflow is:
- **Slow & Expensive**: Consumes thousands of vision tokens per post.
- **Non-Deterministic**: Prone to hallucinations or missing elements.
- **Privacy-Intrusive**: Transmits private feeds, session data, and cookies to third-party AI APIs.

### The Deterministic DOM Agent Pattern
This project implements a **Deterministic DOM Automation Agent**:
- **Perception**: Probes page state dynamically (detecting login walls, verifying card container counts, checking dropdown visibility).
- **Goal-Directed Execution**: Executes a structured state machine: `Session Check` &rarr; `Navigate` &rarr; `Scroll & Expand` &rarr; `Iterate & Extract` &rarr; `Deduplicate & Persist`.
- **Fault-Tolerant Fallbacks**:
  - *Link Extraction Fallback*: Intercepted clipboard &rarr; `navigator.clipboard.readText()` &rarr; DOM anchor query (`a[href*="/feed/update/"]`).
  - *Session Fallback*: Existing Firefox profile cookies &rarr; Dedicated automation profile (`~/.mozilla/firefox/saved-post-getter`).
- **Real-Time Telemetry**: Broadcasts agent lifecycle events and stdout/stderr stream directly to the web operator terminal over WebSockets.

---

## Architecture & Technologies Used

| Layer | Technology | Purpose |
|---|---|---|
| **Automation Engine** | [Playwright](https://playwright.dev/) + Firefox | Headless browser automation, DOM manipulation, request handling |
| **Session Reader** | SQLite3 (`sqlite3`) | Safe read-only extraction of session authentication cookies |
| **Backend Server** | Node.js + [Express.js](https://expressjs.com/) | REST API server, script process spawning, and file downloads |
| **Real-Time Transport** | [Socket.IO](https://socket.io/) | Bidirectional event and live terminal log streaming |
| **Frontend UI** | HTML5, CSS3, Vanilla ES6 JS | Minimal dark-mode dashboard inspired by *Taste Skill* aesthetics |
| **Data Storage** | JSON (`fs`) | Lightweight, portable results storage with timestamp metadata |

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Mozilla Firefox**: Installed on your system
- **LinkedIn Account**: Logged into LinkedIn in Firefox

> [!TIP]
> On Arch Linux or Wayland environments, install `wl-clipboard` and `xclip` if you want desktop clipboard utilities:
> ```bash
> sudo pacman -S wl-clipboard xclip
> ```

---

## Installation

```bash
# 1. Clone or navigate to the repository
cd /home/missari/Saved-Post-Getter

# 2. Install Node.js dependencies
npm install

# 3. Ensure Playwright Firefox browser binary is installed
npx playwright install firefox
```

---

## How to Run

### 1. Web Application (Recommended)

Run the included [RUN](RUN) script:
```bash
./RUN
```
*(Or run `npm start`)*

This starts the backend on port `3000` and ensures any stale processes on that port are killed automatically.

Now open your browser:
**`http://localhost:3000`**

1. Click **"Start Automation"**.
2. Watch the live logs stream in the terminal.
3. Review your extracted links in the results table.
4. Click **"Copy All"** or **"Download JSON"**.

---

### 2. Standalone CLI Script

You can run the extractor directly in your terminal without starting the web dashboard:

```bash
node saved-post-getter.js
```

---

### 3. Headed Mode (Watch Firefox in Action)

By default, the automation runs headlessly in the background. To see the Firefox window open and watch it scroll and click in real-time, set `HEADLESS=false`:

```bash
HEADLESS=false node saved-post-getter.js
```

---

## API Endpoints

The backend server exposes the following REST API:

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Serves the web dashboard UI |
| `/api/status` | `GET` | Returns automation status (`idle`, `running`, `completed`, `error`), recent logs, and results |
| `/api/start` | `POST` | Spawns the Firefox automation process |
| `/api/stop` | `POST` | Gracefully terminates any running automation process |
| `/api/results` | `GET` | Retrieves the latest JSON results |
| `/api/download` | `GET` | Downloads `output/saved-post-links.json` as an attachment |

---

## Output Format

All extracted links are stored in `output/saved-post-links.json`:

```json
{
  "generatedAt": "2026-10-27T11:01:19.941Z",
  "total": 1,
  "links": [
    "https://www.linkedin.com/feed/update/urn:li:activity:7519725271667781632?updateEntityUrn=urn%3Ali%3Afs_updateV2%3A%28urn%3Ali%3Aactivity%3A7519725271667781632%2CFEED_DETAIL%2CEMPTY%2CDEFAULT%2Cfalse%29"
  ]
}
```

---

## Project Structure

```text
Saved-Post-Getter/
├── RUN                    # Shell script to cleanly free port 3000 and run npm start
├── server.js              # Express.js + Socket.IO server & process controller
├── saved-post-getter.js   # Firefox Playwright automation script
├── package.json           # Project manifest and scripts
├── README.md              # Documentation
├── output/
│   └── saved-post-links.json  # Output file containing saved LinkedIn links
└── frontend/
    ├── index.html         # Single-page dashboard HTML
    ├── css/
    │   └── style.css      # Dark-mode minimalist styles
    └── js/
        └── app.js         # Frontend WebSocket listener and UI controller
```

---

## Troubleshooting & FAQ

#### Q: Do I need to close my regular Firefox browser before running?
**No.** The app takes a safe snapshot of `cookies.sqlite` before reading your LinkedIn session, so it does not trigger Firefox profile lock conflicts (`lock` / `.parentlock`).

#### Q: What if I am not logged into LinkedIn in Firefox?
If no active session is detected, the script launches a dedicated persistent profile at `~/.mozilla/firefox/saved-post-getter` and waits up to 60 seconds for you to log in. Once logged in, subsequent runs reuse that session automatically.

#### Q: What does `no supported clipboard tool found` mean?
On Linux Wayland setups, CLI clipboard tools like `wl-clipboard` are used by terminal utilities. Install them using:
```bash
sudo pacman -S wl-clipboard xclip  # Arch Linux
sudo apt install wl-clipboard xclip # Ubuntu / Debian
```
*(The automation script itself hooks the browser memory directly, so it functions even without these system packages).*

---

## License

This project is licensed under the [MIT License](LICENSE).
