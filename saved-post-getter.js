#!/usr/bin/env node
/**
 * LinkedIn Saved Posts Getter
 * Browser automation agent that extracts all saved LinkedIn post links using Chromium.
 * No AI model needed — pure DOM-based automation.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LINKEDIN_SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'saved-post-links.json');
// Dedicated automation profile directory for Chromium
const CHROMIUM_USER_DATA_DIR = path.join(os.homedir(), '.config', 'chromium', 'Default\\ Automation');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadExistingLinks() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const d = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      return d.links || [];
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveLinks(links) {
  ensureOutputDir();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: links.length,
    links: links
  }, null, 2));
  console.log(`\n[SAVED] ${links.length} link(s) written to ${OUTPUT_FILE}`);
}

async function scrollToLoadAllPosts(page, maxScrolls = 50) {
  console.log('[INFO] Scrolling to load all saved posts...');
  let prev = 0, noChange = 0;
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
    const cnt = await page.locator('.artdeco-card, [data-test-id="main-feed_activity_card"], .saved-posts-card').count();
    if (cnt === prev) {
      noChange++;
      if (noChange >= 3) { console.log(`[INFO] No new posts after ${noChange} scrolls. Stopping.`); break; }
    } else { noChange = 0; }
    prev = cnt;
    console.log(`[INFO] Scroll ${i + 1}: ~${cnt} post containers`);
  }
  return await page.locator('.artdeco-card, [data-test-id="main-feed_activity_card"], .saved-posts-card').count();
}

async function extractPostLinkFromDropdown(page) {
  const copySelectors = [
    'text="Copy link to post"',
    'text="Copy link"',
    'text="Copy link to article"',
    'text="Copy link to video"',
    'text="Get link"',
    'text="Copy link to PDF"',
    'text="Get link to post"',
    'text="Get link"',
  ];
  for (const sel of copySelectors) {
    try {
      const el = await page.locator(sel).first().catch(() => null);
      if (el) {
        await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(300);
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        try {
          const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
          if (clipboardText && clipboardText.trim()) return clipboardText.trim();
        } catch (e) {
          try {
            const linkEl = await page.evaluate(() => {
              const all = document.querySelectorAll('a[href*="/feed/update/urn:li:activity:"]');
              for (const a of all) {
                const p = a.closest('li, [class*="card"], [class*="activity"]');
                if (p) {
                  const t = p.querySelector('p, [class*="description"], [class*="text"]');
                  if (t && t.textContent.includes('LinkedIn')) continue;
                  const link = p.querySelector('a[href*="/feed/update/"]');
                  if (link) return link.href;
                }
              }
              return null;
            });
            if (linkEl) return linkEl;
          } catch (e) { /* ignore */ }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) { /* try next */ }
  }
  try {
    const links = page.locator('a[href*="urn:li:activity:"]');
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const h = await links.nth(i).getAttribute('href');
      if (h && h.includes('feed/update/urn:li:activity:')) return h;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function main() {
  console.log('========================================');
  console.log('  LinkedIn Saved Posts Getter');
  console.log('========================================\n');

  // Ensure dedicated Chromium user data directory exists
  fs.mkdirSync(CHROMIUM_USER_DATA_DIR, { recursive: true });
  console.log(`[INFO] Chromium user data dir: ${CHROMIUM_USER_DATA_DIR}`);

  // Clean up any stale lock files
  const lockFile = path.join(CHROMIUM_USER_DATA_DIR, 'Singleton Lock');
  if (fs.existsSync(lockFile)) {
    console.log('[WARN] Removing stale Chromium lock file');
    try { fs.unlinkSync(lockFile); } catch (e) { /* ignore */ }
  }
  ensureOutputDir();
  const existingLinks = loadExistingLinks();
  const existingSet = new Set(existingLinks);
  console.log(`[INFO] Loaded ${existingLinks.length} previously saved link(s).\n`);

  let browser = null;
  let context = null;
  let page = null;

  try {
    console.log('[INFO] Launching Chromium (dedicated user data dir)...');
    // Launch Chromium with dedicated user data dir so it coexists with existing Chrome
    context = await chromium.launchPersistentContext(CHROMIUM_USER_DATA_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: ['--no-remote', '--disable-renderer-backgrounding'],
    });
    page = context.pages()[0];

    console.log('[INFO] Navigating to LinkedIn saved posts page...');
    await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('login') || url.includes('authwall')) {
      console.log('\n[LOGIN REQUIRED] Please log in manually in the Chromium window.');
      console.log('After logging in, press Enter here to continue...');
      await new Promise((res) => process.stdin.once('data', res));
      await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    try {
      await page.waitForSelector('.artdeco-card, [data-test-id="main-feed_activity_card"], .saved-posts-card', { timeout: 15000 });
    } catch (e) { console.log('[WARN] No post containers found.'); }

    await scrollToLoadAllPosts(page, 50);

    const buttons = page.locator('button[aria-label*="Click to take more actions on"]');
    const count = await buttons.count();
    console.log(`\n[INFO] Found ${count} overflow button(s).`);

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
          const norm = link.startsWith('http') ? link : `https://www.linkedin.com${link}`;
          if (!existingSet.has(norm)) {
            allLinks.push(norm); existingSet.add(norm); newC++;
            console.log(`  [${i + 1}/${count}] ?? ${norm}`);
          } else {
            skipC++; console.log(`  [${i + 1}/${count}] (duplicate) ${norm}`);
          }
        } else {
          errC++; console.log(`  [${i + 1}/${count}] ?? No link found`);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch (err) {
        errC++; console.log(`  [${i + 1}/${count}] ?? ${err.message}`);
        try { await page.keyboard.press('Escape'); } catch (e) { /* ignore */ }
      }
    }

    saveLinks(allLinks);

    console.log('\n========================================');
    console.log('  SUMMARY');
    console.log('========================================');
    console.log(`  Buttons found:  ${count}`);
    console.log(`  New links:      ${newC}`);
    console.log(`  Duplicates:     ${skipC}`);
    console.log(`  Errors:         ${errC}`);
    console.log(`  Total saved:    ${allLinks.length}`);
    console.log(`  Output file:    ${OUTPUT_FILE}`);
    console.log('========================================\n');
  } catch (err) {
    console.error('[FATAL]', err.message);
    process.exit(1);
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
