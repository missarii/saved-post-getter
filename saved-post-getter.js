#!/usr/bin/env node
/**
 * LinkedIn Saved Posts Getter
 * Uses google-chrome-stable --profile-directory=Default via Playwright persistent context.
 * Extracts all saved LinkedIn post links.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LINKEDIN_SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'saved-post-links.json');
const CHROME_USER_DATA_DIR = path.join(os.homedir(), '.config', 'google-chrome', 'Default', 'Default');
const CHROME_PROFILE_DIR = 'Default';

// WARNING: You MUST be logged into LinkedIn in Chrome first.
// Steps:
// 1. Open Chrome and go to https://www.linkedin.com/login
// 2. Log in with your credentials (user: missari ahil)
// 3. Close Chrome
// 4. Run this script - it will use your saved session
// The profile must be at ~/.config/google-chrome/Default/Default

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadExistingLinks() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const d = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      return d.links || [];
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrollToLoadAllPosts(page, maxScrolls = 50) {
  console.log('[INFO] Scrolling to load all saved posts...');
  let prev = 0, noChange = 0;
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
    const cnt = await page.locator('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card').count();
    if (cnt === prev) { noChange++; if (noChange >= 3) { console.log('[INFO] No new posts after ' + noChange + ' scrolls. Stopping.'); break; } } else { noChange = 0; }
    prev = cnt; console.log('[INFO] Scroll ' + (i+1) + ': ~' + cnt + ' post containers');
  }
  return await page.locator('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card').count();
}

async function extractPostLinkFromDropdown(page) {
  const copyText = ['Copy link to post', 'Copy link', 'Copy link to article', 'Copy link to video', 'Get link', 'Copy link to PDF', 'Get link to post'];
  for (const txt of copyText) {
    try {
      const btns = page.locator('text=' + txt);
      const c = await btns.count();
      if (c > 0) {
        await btns.first().scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(300);
        await btns.first().click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        try {
          const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
          if (clipboardText && clipboardText.trim()) return clipboardText.trim();
        } catch (e) {
          try {
            const linkEl = await page.evaluate(() => {
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
            if (linkEl) return linkEl;
          } catch (e2) { }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) { }
  }
  try {
    const links = page.locator('a[href*=urn:li:activity:]');
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
  console.log('========================================');
  console.log('[INFO] Using: google-chrome-stable --profile-directory=Default');
  console.log('[INFO] User data dir: ' + CHROME_USER_DATA_DIR);
  console.log('[INFO] Reuses your existing LinkedIn session');
  console.log('');

  ensureOutputDir();
  const existingLinks = loadExistingLinks();
  const existingSet = new Set(existingLinks);
  console.log('[INFO] Loaded ' + existingLinks.length + ' previously saved link(s).');

  let browser = null;
  try {
    console.log('[INFO] Launching Chrome with persistent Default profile...');
    console.log('[INFO] *** WARNING: You must be logged into LinkedIn in Chrome first! ***');
    browser = await chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        '--profile-directory=' + CHROME_PROFILE_DIR,
        '--no-sandbox',
      ],
    });
    const pages = browser.pages();
    let page = pages.length > 0 ? pages[0] : null;
    if (!page) {
      page = await browser.newPage();
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    }
    console.log('[INFO] Connected to google-chrome-stable (Default profile)');
    console.log('[INFO] Navigating to LinkedIn saved posts page...');
    await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    let url = page.url();
    console.log('[INFO] Current URL: ' + url);

    // If login page, auto-wait for session (no [LOGIN REQUIRED] prompt)
    if (url.includes('login') || url.includes('authwall')) {
      console.log('[INFO] Login page detected - waiting for session to restore...');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        url = page.url();
        if (!url.includes('login') && !url.includes('authwall')) {
          console.log('[INFO] Login complete. Continuing...');
          await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(3000);
          break;
        }
        console.log('[INFO] Waiting for session... (' + (i + 1) + '/30)');
      }
    }

    try { await page.waitForSelector('.artdeco-card, [data-testid="main-feed_activity_card"], .saved-posts-card', { timeout: 15000 }); } catch (e) { console.log('[WARN] No post containers found.'); }
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
          if (!existingSet.has(norm)) { allLinks.push(norm); existingSet.add(norm); newC++; console.log('  [' + (i + 1) + '/' + count + '] Found new: ' + norm.substring(0, 80) + '...'); } else { skipC++; console.log('  [' + (i + 1) + '/' + count + '] (duplicate)'); }
        } else { errC++; console.log('  [' + (i + 1) + '/' + count + '] No link found'); }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch (err) {
        errC++; console.log('  [' + (i + 1) + '/' + count + '] Error: ' + err.message);
        try { await page.keyboard.press('Escape'); } catch (e2) { }
      }
    }

    saveLinks(allLinks);
    console.log('');
    console.log('========================================');
    console.log('  SUMMARY');
    console.log('========================================');
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
    if (browser) await browser.close();
    // Note: browser.close() works for persistent context too
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
