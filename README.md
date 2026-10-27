# LinkedIn Saved Posts Getter

A full-stack browser automation agent that extracts all your saved LinkedIn post links using Firefox with your existing login session. Includes a modern web UI with real-time logs, status dashboard, and results table.

## What it does

1. **Launch Firefox** using your existing Firefox profile (keeps you logged into LinkedIn)
2. **Navigate** to `https://www.linkedin.com/my-items/saved-posts/`
3. **Scroll** to load all saved posts (LinkedIn lazy-loads content)
4. **Click** the overflow (three-dot / more actions) button on each saved post
5. **Click** "Copy link to post" in the dropdown menu
6. **Read the clipboard** to extract the canonical post URL
7. **Save** all links to `output/saved-post-links.json`

No AI model is needed — this is pure DOM-based browser automation using Playwright.

## Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Automation | Playwright + Firefox | Browser control, DOM interaction, clipboard reading |
| Backend | Node.js + Express + Socket.io | API server, real-time log streaming, process management |
| Frontend | HTML5 + CSS3 + Vanilla JS | Web UI, status dashboard, live terminal, results table |

## Design

The frontend follows the **Taste Skill** design philosophy (tasteskill.dev): anti-slop, editorial minimalism, dark mode by default, restrained color palette, generous whitespace, sharp typography (Inter + IBM Plex Mono), and smooth motion. No generic templates.

## Prerequisites

- Node.js (v18+)
- Firefox installed
- Your LinkedIn account logged in within your Firefox profile

## Installation

```bash
cd /home/missari/Saved-Post-Getter
npm install
npx playwright install firefox
```

## Usage

### Start the full-stack application

```bash
npm start
```

This launches the Express server at `http://localhost:3000`. Open that URL in your browser.

### Run the automation script directly

```bash
node saved-post-getter.js
```

### First run (if not logged in)

If the script detects you're not logged into LinkedIn, it will pause and wait. Log in manually in the Firefox window, then press **Enter** in the terminal.

**Important:** Close all Firefox windows before running, as Firefox locks its profile when active.

## Features

- Firefox profile reuse (preserves LinkedIn login session)
- Automatic scroll-to-load all saved posts
- Overflow button detection and clicking
- Clipboard-based link extraction (LinkedIn copies links via JS)
- Real-time log streaming via WebSockets
- Status dashboard (Idle / Running / Completed / Error)
- Statistics counters (buttons found, new links, duplicates, errors)
- Results table with per-link copy buttons
- Bulk copy and JSON download
- Deduplication across runs
- Dark mode UI (Taste Skill inspired)

## Output

Results are saved to `output/saved-post-links.json`:

```json
{
  "generatedAt": "2026-10-27T06:43:27.422Z",
  "total": 1,
  "links": [
    "https://www.linkedin.com/feed/update/urn:li:activity:7519725271667781632?updateEntityUrn=urn%3Ali%3Afs_updateV2%3A%28urn%3Ali%3Aactivity%3A7519725271667781632%2CFEED_DETAIL%2CEMPTY%2CDEFAULT%2Cfalse%29"
  ]
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve frontend UI |
| `/api/status` | GET | Get automation status, logs, results |
| `/api/start` | POST | Start the automation |
| `/api/stop` | POST | Stop the automation |
| `/api/results` | GET | Get extracted links |
| `/api/download` | GET | Download `saved-post-links.json` |

## Project Structure

```
Saved-Post-Getter/
├── server.js              # Express + Socket.io backend
├── saved-post-getter.js   # Playwright automation script
├── package.json           # Node.js project config
├── README.md              # Documentation
├── output/
│   └── saved-post-links.json  # Extracted links (generated)
└── frontend/
    ├── index.html         # Frontend HTML
    ├── css/
    │   └── style.css      # Taste Skill inspired styles
    └── js/
        └── app.js         # Frontend application logic
```

## Troubleshooting

**"Firefox is already running, but is not responding"** — Close all Firefox windows and remove the lock file:

```bash
pkill -f firefox
rm -f ~/.mozilla/firefox/*/lock ~/.mozilla/firefox/*/.parentlock
```

**"Could not find Firefox profile"** — Make sure Firefox is installed and you've run it at least once so `profiles.ini` exists.

**No links extracted** — Make sure you have saved posts on LinkedIn and that the page fully loads. You may need to be logged in.

## License

MIT
