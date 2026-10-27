#!/usr/bin/env node
/**
 * LinkedIn Saved Posts Getter
 * Browser automation agent that extracts all saved LinkedIn post links using Firefox.
 * Pure DOM-based automation with Playwright.
 */

const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const LINKEDIN_SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'saved-post-links.json');
const FIREFOX_BASE_DIR = path.join(os.homedir(), '.mozilla', 'firefox');
const DEDICATED_PROFILE_DIR = path.join(FIREFOX_BASE_DIR, 'saved-post-getter');

// Headless by default, can be overridden with HEADLESS=false
const IS_HEADLESS = process.env.HEADLESS !== 'false';

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadExistingLinks() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      return data.links || [];
    }
  } catch (e) { }
  return [];
}

function saveLinks(links) {
  ensureOutputDir();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: links.length,
    links: links
  }, null, 2));
  console.log('\n[SAVED] ' + links.length + ' link(s) written to ' + OUTPUT_FILE);
}

/**
 * Discovers Firefox profile directories on the system.
 */
function getFirefoxProfileDirs() {
  const profiles = [];
  if (!fs.existsSync(FIREFOX_BASE_DIR)) return profiles;

  const iniPath = path.join(FIREFOX_BASE_DIR, 'profiles.ini');
  if (fs.existsSync(iniPath)) {
    try {
      const iniContent = fs.readFileSync(iniPath, 'utf-8');
      const lines = iniContent.split('\n');
      for (const line of lines) {
        const match = line.match(/^Path=(.+)$/);
        if (match) {
          const relOrAbs = match[1].trim();
          const fullPath = path.isAbsolute(relOrAbs)
            ? relOrAbs
            : path.join(FIREFOX_BASE_DIR, relOrAbs);
          if (fs.existsSync(fullPath) && !profiles.includes(fullPath)) {
            profiles.push(fullPath);
          }
        }
      }
    } catch (e) { }
  }

  // Also check subdirectories directly
  try {
    const entries = fs.readdirSync(FIREFOX_BASE_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const fullPath = path.join(FIREFOX_BASE_DIR, ent.name);
        if (fs.existsSync(path.join(fullPath, 'cookies.sqlite')) && !profiles.includes(fullPath)) {
          profiles.push(fullPath);
        }
      }
    }
  } catch (e) { }

  return profiles;
}

/**
 * Extracts LinkedIn session cookies from a Firefox profile safely
 * (uses a temp directory copy to avoid SQLite WAL locks when Firefox is open).
 */
function extractLinkedInCookiesFromProfile(profileDir) {
  const cookieDb = path.join(profileDir, 'cookies.sqlite');
  if (!fs.existsSync(cookieDb)) return [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cookies-'));
  const cookies = [];
  try {
    fs.copyFileSync(cookieDb, path.join(tmpDir, 'cookies.sqlite'));
    const walFile = path.join(profileDir, 'cookies.sqlite-wal');
    if (fs.existsSync(walFile)) {
      fs.copyFileSync(walFile, path.join(tmpDir, 'cookies.sqlite-wal'));
    }

    const query = "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE host LIKE '%linkedin.com%';";
    const output = execFileSync('sqlite3', [path.join(tmpDir, 'cookies.sqlite'), query], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split('|');
      if (parts.length < 8) continue;
      const [name, value, host, cPath, expiryStr, isSecure, isHttpOnly, sameSite] = parts;

      let exp = parseInt(expiryStr, 10);
      if (exp > 1000000000000) exp = Math.floor(exp / 1000);
      else if (exp <= 0) exp = -1;

      let sSite = 'None';
      if (sameSite === '1') sSite = 'Lax';
      else if (sameSite === '2') sSite = 'Strict';

      cookies.push({
        name,
        value,
        domain: host,
        path: cPath || '/',
        expires: exp,
        httpOnly: isHttpOnly === '1',
        secure: isSecure === '1',
        sameSite: sSite
      });
    }
  } catch (e) {
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
  }

  return cookies;
}

/**
 * Finds an active LinkedIn session among all Firefox profiles.
 */
function findLinkedInSession() {
  const profiles = getFirefoxProfileDirs();
  for (const prof of profiles) {
    const cookies = extractLinkedInCookiesFromProfile(prof);
    const hasAuthCookie = cookies.some(c => c.name === 'li_at');
    if (hasAuthCookie) {
      return { profileDir: prof, cookies };
    }
  }
  return null;
}

async function scrollToLoadAllPosts(page, maxScrolls = 50) {
  console.log('[INFO] Scrolling to load all saved posts...');
  let prev = 0, noChange = 0;
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
    const cnt = await page.locator('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card').count();
    if (cnt === prev) {
      noChange++;
      if (noChange >= 3) {
        console.log('[INFO] No new posts after ' + noChange + ' scrolls. Stopping.');
        break;
      }
    } else {
      noChange = 0;
    }
    prev = cnt;
    console.log('[INFO] Scroll ' + (i + 1) + ': ~' + cnt + ' post containers');
  }
  return await page.locator('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card').count();
}

async function extractPostLinkFromDropdown(page) {
  const copyLabels = [
    'Copy link to post',
    'Copy link',
    'Copy link to article',
    'Copy link to video',
    'Copy link to PDF',
    'Get link to post',
    'Get link'
  ];

  for (const label of copyLabels) {
    try {
      // Find the visible item in the open menu dropdown
      const btn = page.locator('.artdeco-dropdown__content, [role="menu"]')
        .locator(`text="${label}"`)
        .first();

      const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1000);

        // 1. Check intercepted clipboard
        const intercepted = await page.evaluate(() => window.__lastCopied);
        if (intercepted && intercepted.trim()) {
          return intercepted.trim();
        }

        // 2. Direct clipboard read fallback
        try {
          const clipText = await page.evaluate(() => navigator.clipboard.readText());
          if (clipText && clipText.trim()) return clipText.trim();
        } catch (e) { }

        // 3. Fallback: inspect DOM for feed update link
        try {
          const domLink = await page.evaluate(() => {
            const all = document.querySelectorAll('a[href*="/feed/update/urn:li:activity:"]');
            for (const a of all) {
              const p = a.closest('li, [class*=card], [class*=activity]');
              if (p) {
                const t = p.querySelector('p, [class*=description], [class*=text]');
                if (t && t.textContent.includes('LinkedIn')) continue;
                const link = p.querySelector('a[href*="/feed/update/"]');
                if (link) return link.href;
              }
            }
            return null;
          });
          if (domLink) return domLink;
        } catch (e) { }

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) { }
  }

  // Fallback selector for any visible feed update link on the page
  try {
    const links = page.locator('a[href*="urn:li:activity:"]');
    const lcount = await links.count();
    for (let i = 0; i < lcount; i++) {
      const h = await links.nth(i).getAttribute('href');
      if (h && h.includes('feed/update/urn:li:activity:')) return h;
    }
  } catch (e) { }

  return null;
}

async function main() {
  console.log('========================================');
  console.log('  LinkedIn Saved Posts Getter');
  console.log('  Engine: Mozilla Firefox via Playwright');
  console.log('========================================');

  ensureOutputDir();
  const existingLinks = loadExistingLinks();
  const existingSet = new Set(existingLinks);
  console.log('[INFO] Loaded ' + existingLinks.length + ' previously saved link(s).');

  // Check for existing Firefox LinkedIn session
  console.log('[INFO] Detecting Firefox LinkedIn session...');
  const session = findLinkedInSession();

  let browser = null;
  let context = null;
  let page = null;

  try {
    if (session && session.cookies.length > 0) {
      console.log('[INFO] Found active LinkedIn session in profile: ' + session.profileDir);
      console.log('[INFO] Loaded ' + session.cookies.length + ' session cookies.');
      console.log('[INFO] Launching Firefox (headless: ' + IS_HEADLESS + ')...');

      browser = await firefox.launch({
        headless: IS_HEADLESS,
        firefoxUserPrefs: {
          'dom.events.asyncClipboard.readText': true,
          'dom.events.testing.asyncClipboard': true
        }
      });

      context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      await context.addCookies(session.cookies);
    } else {
      console.log('[WARN] No saved LinkedIn session found in Firefox profiles.');
      console.log('[INFO] Launching Firefox persistent profile at: ' + DEDICATED_PROFILE_DIR);
      fs.mkdirSync(DEDICATED_PROFILE_DIR, { recursive: true });

      // Clean stale lock files if any
      for (const lf of [path.join(DEDICATED_PROFILE_DIR, 'lock'), path.join(DEDICATED_PROFILE_DIR, '.parentlock')]) {
        if (fs.existsSync(lf)) {
          try { fs.unlinkSync(lf); } catch (e) { }
        }
      }

      context = await firefox.launchPersistentContext(DEDICATED_PROFILE_DIR, {
        headless: IS_HEADLESS,
        viewport: { width: 1280, height: 800 },
        firefoxUserPrefs: {
          'dom.events.asyncClipboard.readText': true,
          'dom.events.testing.asyncClipboard': true
        }
      });
    }

    // Intercept clipboard writeText calls to grab post URLs reliably
    await context.addInitScript(() => {
      window.__lastCopied = null;
      if (navigator.clipboard) {
        const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (text) => {
          window.__lastCopied = text;
          try { return await origWrite(text); } catch (e) { return Promise.resolve(); }
        };
      }
    });

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();

    console.log('[INFO] Navigating to LinkedIn saved posts page...');
    await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    let currentUrl = page.url();
    console.log('[INFO] Current URL: ' + currentUrl);

    // If redirected to login/authwall, wait for user login
    if (currentUrl.includes('login') || currentUrl.includes('authwall')) {
      console.log('\n[LOGIN REQUIRED] LinkedIn login page detected.');
      console.log('[INFO] Waiting up to 60 seconds for login/session completion...');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        currentUrl = page.url();
        if (!currentUrl.includes('login') && !currentUrl.includes('authwall')) {
          console.log('[INFO] Login detected! Navigating to saved posts...');
          await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(3000);
          break;
        }
        if ((i + 1) % 5 === 0) {
          console.log('[INFO] Still waiting for login... (' + (i + 1) + '/30)');
        }
      }
    }

    try {
      await page.waitForSelector('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card', { timeout: 15000 });
    } catch (e) {
      console.log('[WARN] No post containers found yet, checking page...');
    }

    await scrollToLoadAllPosts(page, 50);

    const buttons = page.locator('button[aria-label*="Click to take more actions on"]');
    const count = await buttons.count();
    console.log('');
    console.log('[INFO] Found ' + count + ' overflow button(s).');

    const allLinks = [...existingLinks];
    let newC = 0, skipC = 0, errC = 0;

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      try {
        await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
        await page.waitForTimeout(500);
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(1500);

        const link = await extractPostLinkFromDropdown(page);
        if (link) {
          const norm = link.startsWith('http') ? link : 'https://www.linkedin.com' + link;
          if (!existingSet.has(norm)) {
            allLinks.push(norm);
            existingSet.add(norm);
            newC++;
            console.log('  [' + (i + 1) + '/' + count + '] Found new: ' + norm.substring(0, 80) + '...');
          } else {
            skipC++;
            console.log('  [' + (i + 1) + '/' + count + '] (duplicate)');
          }
        } else {
          errC++;
          console.log('  [' + (i + 1) + '/' + count + '] No link found');
        }

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch (err) {
        errC++;
        console.log('  [' + (i + 1) + '/' + count + '] Error: ' + err.message);
        try { await page.keyboard.press('Escape'); } catch (e2) { }
      }
    }

    saveLinks(allLinks);

    console.log('');
    console.log('========================================');
    console.log('  SUMMARY');
    console.log('========================================');
    console.log('  Browser:        Firefox');
    console.log('  Buttons found:  ' + count);
    console.log('  New links:      ' + newC);
    console.log('  Duplicates:     ' + skipC);
    console.log('  Errors:         ' + errC);
    console.log('  Total saved:    ' + allLinks.length);
    console.log('  Output file:    ' + OUTPUT_FILE);
    console.log('========================================');
  } catch (err) {
    console.error('[FATAL]', err.message);
    process.exit(1);
  } finally {
    if (context) {
      try { await context.close(); } catch (e) { }
    }
    if (browser) {
      try { await browser.close(); } catch (e) { }
    }
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
