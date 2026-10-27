#!/usr/bin/env node
/**
 * LinkedIn Saved Posts Getter
 * Browser automation agent that extracts all saved LinkedIn post links using Firefox.
 * No AI model needed — pure DOM-based automation.
 */

const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LINKEDIN_SAVED_POSTS_URL = 'https://www.linkedin.com/my-items/saved-posts/';
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'saved-post-links.json');
const FIREFOX_PROFILES_DIR = path.join(os.homedir(), '.mozilla', 'firefox');
const FIREFOX_PROFILES_INI = path.join(FIREFOX_PROFILES_DIR, 'profiles.ini');

function isFirefoxProfileLocked(profileDir) {
  if (!profileDir || !fs.existsSync(profileDir)) return false;
  return fs.existsSync(path.join(profileDir, 'lock')) ||
         fs.existsSync(path.join(profileDir, '.parentlock'));
}

function getDefaultFirefoxProfile() {
  if (!fs.existsSync(FIREFOX_PROFILES_INI)) return null;
  return parseProfilesIni(fs.readFileSync(FIREFOX_PROFILES_INI, 'utf-8'));
}

function parseProfilesIni(ini) {
  const sections = {};
  let currentSection = null;
  for (const line of ini.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) continue;
    const m = t.match(/^\[(.+)\]$/);
    if (m) { currentSection = m[1]; sections[currentSection] = sections[currentSection] || {}; continue; }
    const eq = t.indexOf('=');
    if (eq === -1 || !currentSection) continue;
    sections[currentSection][t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  let defSec = null;
  for (const [name, props] of Object.entries(sections)) {
    if (props.Default === '1' && name.startsWith('Profile')) { defSec = name; break; }
  }
  if (!defSec) return null;
  const p = sections[defSec].Path;
  if (sections[defSec].IsRelative === '1' || sections[defSec].IsRelative === 'true') {
    return path.join(FIREFOX_PROFILES_DIR, p);
  }
  return p;
}

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
    const cnt = await page.locator('.artdeco-card, [data-test-id="main-feed-activity-card"], .saved-posts-card').count();
    if (cnt === prev) {
      noChange++;
      if (noChange >= 3) { console.log(`[INFO] No new posts after ${noChange} scrolls. Stopping.`); break; }
    } else { noChange = 0; }
    prev = cnt;
    console.log(`[INFO] Scroll ${i + 1}: ~${cnt} post containers`);
  }
  return await page.locator('.artdeco-card, [data-test-id="main-feed-activity-card"], .saved-posts-card').count();
}

async function extractPostLinkFromDropdown(page) {
  const copySelectors = [
    'text="Copy link to post"',
    'text="Copy link"',
    'text="Copy link to article"',
    'text="Copy link to video"',
    'text="Get link"',
  ];
  for (const s of copySelectors) {
    try {
      const els = page.locator(s);
      const count = await els.count();
      for (let i = 0; i < count; i++) {
        const el = els.nth(i);
        if (await el.isVisible({ timeout: 500 })) {
          await el.click({ timeout: 5000 });
          await page.waitForTimeout(1000);
          try {
            const clipboard = await page.evaluate(() => navigator.clipboard.readText());
            if (clipboard && clipboard.includes('feed/update/urn:li:activity:')) {
              return clipboard.trim();
            }
          } catch (e) { /* clipboard access may be blocked */ }
        }
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
  const profileDir = getDefaultFirefoxProfile();
  if (profileDir) console.log(`[INFO] Firefox profile: ${profileDir}`);
  else console.log('[WARN] No Firefox profile found. Fresh browser.');
  ensureOutputDir();
  const existingLinks = loadExistingLinks();
  const existingSet = new Set(existingLinks);
  console.log(`[INFO] Loaded ${existingLinks.length} previously saved link(s).\n`);
  let browser;
  let context;
  let page;
  try {
    if (profileDir && fs.existsSync(profileDir)) {
      if (isFirefoxProfileLocked(profileDir)) {
        console.log('[FATAL] Firefox profile is locked by a running instance.');
        console.log(`[FATAL] Profile path: ${profileDir}`);
        console.log('[FATAL] Playwright cannot reuse a profile that is already open.');
        console.log('\n[SOLUTION] Close all Firefox windows and re-run this script:');
        console.log('  1) pkill -f firefox');
        console.log('  2) rm -f ~/.mozilla/firefox/*/lock ~/.mozilla/firefox/*/.parentlock');
        console.log('  3) node saved-post-getter.js');
        process.exit(1);
      }
      context = await firefox.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: ['--no-remote'],
      });
      page = context.pages()[0];
    } else {
      browser = await firefox.launch({ headless: true });
      context = await browser.newContext();
      page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    console.log('[INFO] Navigating to LinkedIn saved posts page...');
    await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const url = page.url();
    if (url.includes('login') || url.includes('authwall')) {
      console.log('\n[LOGIN REQUIRED] Please log in manually in the Firefox window.');
      console.log('After logging in, press Enter here to continue...');
      await new Promise((res) => process.stdin.once('data', res));
      await page.goto(LINKEDIN_SAVED_POSTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
    }
    try {
      await page.waitForSelector('.artdeco-card, [data-test-id="main-feed-activity-card"], .saved-posts-card', { timeout: 15000 });
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
            console.log(`  [${i + 1}/${count}] ✓ ${norm}`);
          } else {
            skipC++; console.log(`  [${i + 1}/${count}] ⊘ (duplicate) ${norm}`);
          }
        } else {
          errC++; console.log(`  [${i + 1}/${count}] ✗ No link found`);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch (err) {
        errC++; console.log(`  [${i + 1}/${count}] ✗ ${err.message}`);
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
  } finally { if (context) await context.close(); if (browser) await browser.close(); }
}
main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
