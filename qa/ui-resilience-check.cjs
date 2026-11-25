const assert = require('node:assert/strict');
const { chromium } = require('../frontend/node_modules/playwright');
const vi = require('../shared/i18n/vi.json');
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/map-tiles/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto('http://localhost:3000');
    await page.getByText(vi.map.tilesUnavailable, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ngày mai', exact: true }).click();
    await page.locator('[data-slot-price]').first().waitFor();
    const clipped = await page.locator('[data-slot-price]').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
    assert.deepEqual(clipped, [], 'Every mobile slot amount must be fully readable');
    await page.getByRole('button', { name: vi.common.retry, exact: true }).click();
    await page.getByText(vi.map.tilesUnavailable, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.locator('#court-booking-section').screenshot({ path: 'qa/mobile-readable-prices.png' });
    await page.locator('#map-section').screenshot({ path: 'qa/map-unavailable-state.png' });
    await page.goto('http://localhost:3000/platform');
    const entrance = page.locator('.stage-enter-1');
    await entrance.waitFor();
    assert(Number(await entrance.evaluate(element => parseFloat(getComputedStyle(element).animationDuration))) < 0.01, 'Reduced motion must disable entrance animation');
    await page.screenshot({ path: 'qa/platform-reduced-motion.png', fullPage: true });
    console.log('PASS mobile amounts readable, map failure explained, retry available, no JavaScript errors');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
