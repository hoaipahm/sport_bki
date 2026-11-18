const assert=require('node:assert/strict');const {chromium}=require('../frontend/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000');await page.getByRole('button',{name:'Ngày mai',exact:true}).click();await page.getByRole('button',{name:/^06:00/}).click();await page.getByRole('button',{name:/^06:30/}).click();
 let requests=0;page.on('request',r=>{if(r.url().includes('/api/customer/v1'))requests++});
 await page.getByTitle('Đổi ngôn ngữ').click();await page.waitForTimeout(300);
 assert.equal(requests,0,'Changing locale must not fetch/reset availability');
 assert.equal(await page.getByRole('button',{name:/^06:00/}).getAttribute('aria-pressed'),'true');
 console.log('Locale switch: 0 API requests; time selection preserved');
 await page.getByRole('button',{name:'Evening',exact:true}).click();assert.equal(await page.getByRole('button',{name:/^06:00/}).count(),0);console.log('Day-period filtering: passed');
 await page.getByRole('button',{name:'Log in',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.locator('#reset-email').fill('nobody-'+Date.now()+'@example.invalid');await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.locator('#reset-otp').waitFor();console.log('Real forgot-password API and OTP entry screen: passed');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 for(const width of [360,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`qa/optimized-${width}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);console.log('360/768/1440px overflow and runtime errors: passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
