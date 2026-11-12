const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuci-gateway-ui-'));let app;
 const packaged = process.env.FUCI_PACKAGED_EXE;
 const source = packaged ? path.resolve(path.dirname(packaged),'../Resources/app') : root;
 async function launch(){const env={...process.env,NODE_ENV:'test',FUCI_TEST_DATA:dir};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[root],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.fuci);return page;}
 try{
  let page=await launch();
  const forwarded=await app.evaluate(async({net},source)=>{const original=net.fetch;let observed;try{net.fetch=async(_url,options)=>{observed=options.redirect;return {ok:true};};await process.mainModule.require(source+'/src/main/http.js').httpFetch('https://example.invalid/controlled',{method:'POST',redirect:'error'});return observed;}finally{net.fetch=original;}},source);
  assert.equal(forwarded,'error','Electron adapter must preserve gateway redirect policy');
  const fakeExpressKey='AQ.'+'synthetic.desktop-verification';
  const boot=await page.evaluate(()=>window.fuci.bootstrap());const settings={...boot.settings,projectId:'',route:'gemini',geminiProvider:'vertex-express',geminiApiKey:fakeExpressKey,model:'models/gemini-test',ttsModel:'test-tts',openAtLogin:false,uiLocale:'en'};
  const saved=await page.evaluate(s=>window.fuci.saveSettings(s),settings);assert(saved.ok,saved.message);assert.equal(saved.settings.geminiProvider,'vertex-express');assert.equal(saved.settings.model,'gemini-test');
  await app.evaluate((_,source)=>{global.__gatewayRequests=[];process.mainModule.require(source+'/src/main/http.js').setFetchImplementation(async(url,options)=>{const body=JSON.parse(options.body);global.__gatewayRequests.push({url,body});return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'你好'}]}}]})};});},source);
  const probe=await page.evaluate(s=>window.fuci.testSettings(s),{...settings,model:'gemini-test'});assert(probe.ok,probe.message);const req=await app.evaluate(()=>global.__gatewayRequests[0]);assert(req.url.includes('aiplatform.googleapis.com/v1beta1/'));assert.equal(req.body.contents[0].role,'user');
  await app.close();app=null;page=await launch();const reopened=await page.evaluate(()=>window.fuci.bootstrap());assert.equal(reopened.settings.geminiProvider,'vertex-express');assert.equal(reopened.settings.geminiApiKey,fakeExpressKey);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('open-settings'));await page.locator('[data-open-page=account]').click();await page.locator('#gemini-provider').waitFor();assert.equal(await page.locator('#gemini-provider').inputValue(),'vertex-express');assert.equal(await page.locator('#gemini-api-key').getAttribute('type'),'password');
  fs.mkdirSync(path.join(root,'dist/gateway-verification'),{recursive:true});await page.screenshot({path:path.join(root,'dist/gateway-verification/settings.png')});
  await page.locator('#gemini-provider').selectOption('gemini');await page.locator('#close-settings').click();const changed=await page.evaluate(()=>window.fuci.bootstrap());assert.equal(changed.settings.geminiProvider,'gemini');assert.equal(changed.settings.geminiApiKey,fakeExpressKey);
  console.log('PASS: actual Fuci IPC, AQ save, explicit Express text routing, settings source UI, password field and source/key persistence across restart. Isolated profile and controlled response; no real API call.');
 }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
