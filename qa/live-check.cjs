const assert=require('node:assert/strict');
const {chromium}=require('../frontend/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000');
 await page.getByRole('button',{name:'Ngày mai',exact:true}).click();
 await page.getByRole('button',{name:/^06:00/}).click();
 await page.getByRole('button',{name:/^06:30/}).click();
 await page.locator('#court-booking-section').getByRole('button',{name:'Đặt sân ngay'}).click();
 await page.getByRole('dialog').waitFor();
 await page.keyboard.press('Escape');
 await page.getByRole('dialog').waitFor({state:'hidden'});
 console.log('live court selection, booking login gate and Escape: passed');
 await page.screenshot({path:'qa/customer-desktop.png',fullPage:true});
 console.log('hero surface',await page.locator('.customer-hero').evaluate(e=>getComputedStyle(e).backgroundColor));
 for(const lang of ['vi','en']){
  await page.setViewportSize({width:360,height:800});
  if(lang==='en')await page.getByTitle('Đổi ngôn ngữ').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  await page.screenshot({path:`qa/customer-mobile-${lang}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);
 console.log('360px VI/EN, locale, runtime errors: passed');
 await browser.close();
 for(const endpoint of ['/health','/api/customer/v1/venues','/api/customer/v1/venues/b0000000-0000-0000-0000-000000000001/availability?date=2026-11-18']){
  const response=await fetch('http://localhost:4000'+endpoint);assert.equal(response.status,200);console.log(endpoint,200);
 }
 const badDate=await fetch('http://localhost:4000/api/customer/v1/venues/b0000000-0000-0000-0000-000000000001/availability?date=2026-02-31');assert.equal(badDate.status,400);
 const webhook=await fetch('http://localhost:4000/webhooks/bank/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(webhook.status,503);
 console.log('invalid date rejected; unconfigured bank webhook disabled: passed');
})().catch(e=>{console.error(e);process.exitCode=1});
