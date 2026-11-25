const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('../frontend/node_modules/playwright');
const root = process.env.WEB_URL || 'http://localhost:3000';
async function run() {
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  try {
    for (const width of [360, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const route of ['/', '/my-bookings', '/profile', '/staff', '/admin', '/platform']) {
        const response = await page.goto(root + route);
        assert.equal(response.status(), 200, `${route} HTTP`);
        await page.locator('main').waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflow at ${width}`);
        await page.screenshot({ path: path.join(__dirname, `portal-${route.replace(/\W/g, '') || 'home'}-${width}.png`), fullPage: true });
        checks++;
      }
      assert.deepEqual(errors, [], `JavaScript errors at ${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`${checks} portal/viewport checks passed, zero page errors; screenshots saved in qa/.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
