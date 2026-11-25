import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openUiSession} from '../browser/index.mjs';
import {probeAuthentication, waitForLogin} from '../browser/password-recovery.mjs';
import {readOktaOrigin, totpCode} from '../browser/okta-login.mjs';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('generates six-digit SHA-1 TOTP using RFC 6238 Appendix B vectors', () => {
  assert.equal(totpCode(secret, 59_000), '287082');
  assert.equal(totpCode(secret.toLowerCase(), 1_111_111_109_000), '081804');
  assert.throws(() => totpCode('not-base32!'), /Base32/);
  assert.throws(() => totpCode(undefined), /Base32/);
});

test('requires an exact HTTPS identity provider origin', () => {
  assert.equal(readOktaOrigin('https://idp.example.test/'), 'https://idp.example.test');
  for (const url of ['http://idp.example.test', 'https://idp.example.test/login', 'https://a@idp.example.test', 'https://idp.example.test?x']) {
    assert.throws(() => readOktaOrigin(url));
  }
});

const tenant = process.env.WELLSKY_TEST_TENANT ?? 'tenant-b';
const origin = 'https://idp.example.test';
const app = 'https://wscs.wellsky.com/' + tenant + '/';
const chromePath = process.env.WELLSKY_TEST_CHROME;
const button = '<button type="submit">Continue</button>';
const widget = (action, fields) => `<main id="okta-sign-in"><form method="POST" action="/${action}">${fields}${button}</form></main>`;

async function withFixture({idp = origin, seed = secret, delayedStartup = false, labelledFactors = false, dashboard = 'plain'} = {}, run) {
  const {chromium} = await import('playwright-core');
  const temp = await mkdtemp(join(tmpdir(), 'wellsky-okta-'));
  const browser = await chromium.launch({executablePath: chromePath});
  const actions = [];
  const envFile = join(temp, '.env');
  await writeFile(envFile, `HMIS_UI_USER=synthetic-user\nHMIS_UI_PASSWORD=synthetic-password\nWELLSKY_OKTA_ORIGIN=${origin}\nWELLSKY_TOTP_SECRET=${seed}\n`);

  // Let the production handlers decide which requests can reach the fixture.
  const fixture = async route => {
    const req = route.request();
    const url = new URL(req.url());
    const body = new URLSearchParams(req.postData() ?? '');
    let html;
    if (url.origin === new URL(app).origin) {
      if (url.pathname.endsWith('/startup')) {
        await new Promise(resolve => setTimeout(resolve, 300));
        return route.fulfill({body:'Ready'});
      }
      if (url.searchParams.has('verified') || (url.pathname.endsWith('/index.html') && (await req.headerValue('cookie'))?.includes('fixtureAuth=1'))) {
        const hash = dashboard === 'plain' ? '#mainPage' : '#mainPage;';
        html = `<div id="status">Loading Modules</div><script>
          document.cookie='fixtureAuth=1; path=/';
          location.hash=${JSON.stringify(dashboard === 'transition' ? '#mainPage' : hash)};
          setTimeout(()=>{location.hash=${JSON.stringify(hash)};document.querySelector('#status').textContent='Home Page Dashboard'},100);
        </script>`;
      } else {
        html = `<input id="formfield-login"><button id="LoginView.fbtn_submit">Next</button><div id="status"></div><script>
          const field=document.querySelector('input'), next=document.querySelector('button');
          let ready=${!delayedStartup};
          if (!ready) fetch('${app}startup').then(()=>{field.value='';ready=true});
          next.onclick=()=>{
            if (!ready || field.value!=='synthetic-user') {document.querySelector('#status').textContent='Please enter a username.';return}
            location.href='${idp}/identify';
          };
        </script>`;
      }
    } else if (url.origin === origin) {
      actions.push(url.pathname);
      if (url.pathname === '/identify') html = widget('password', '<input name="identifier">');
      if (url.pathname === '/password' && body.get('identifier') === 'synthetic-user') {
        html = widget('factor', '<input name="credentials.passcode" type="password">');
      }
      if (url.pathname === '/factor' && body.get('credentials.passcode') === 'synthetic-password') {
        html = labelledFactors
          ? '<main id="okta-sign-in"><a class="select-factor" data-se="button" aria-label="Select Email." href="/email">Select</a><a class="select-factor" data-se="button" aria-label="Select Google Authenticator." href="/totp">Select</a></main>'
          : '<main id="okta-sign-in"><div data-se="google_otp"><a data-se="select-factor" href="/totp">Select</a></div></main>';
      }
      if (url.pathname === '/totp') html = widget('verify', '<input name="credentials.passcode">');
      if (url.pathname === '/verify' && [Date.now(), Date.now() - 30_000].some(time => totpCode(secret, time) === body.get('credentials.passcode'))) {
        html = `<script>location.href='${app}application?verified'</script>`;
      }
    } else {
      assert.fail('Untrusted origin reached the fixture');
    }
    await route.fulfill({contentType: 'text/html', body: html ?? 'Rejected'});
  };

  const substituteNetwork = owner => {
    const route = owner.route.bind(owner);
    owner.route = (pattern, handler) => route(pattern, requestRoute => handler({
      request: () => requestRoute.request(),
      abort: () => requestRoute.abort(),
      continue: () => fixture(requestRoute),
    }));
  };
  const engine = {async launch() {
    return {async newContext(options) {
      const context = await browser.newContext(options);
      substituteNetwork(context);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        substituteNetwork(page);
        return page;
      };
      return context;
    }, close: () => browser.close()};
  }};

  try {
    await run({tenant, chromium: engine, envFile, timeoutMs: 5000}, actions);
  } finally {
    await browser.close();
    await rm(temp, {recursive: true, force: true});
  }
}

test('username-first sign-in completes Okta TOTP and renews the same managed page', {skip: !chromePath}, async () => {
  await withFixture({}, async (options, actions) => {
    const session = await openUiSession(options);
    assert.equal(session.passwordRecovery, 'not-needed');
    assert.match(session.page.url(), /#mainPage$/);
    const page = session.page;
    await page.goto(app + 'application');
    await session.ensureAuthenticated();
    assert.equal(session.page, page);
    assert.match(page.url(), /#mainPage$/);
    const login = ['/identify', '/password', '/factor', '/totp', '/verify'];
    assert.deepEqual(actions, [...login, ...login]);
    await session.close();
  });
});

test('untrusted identity provider is blocked before any credentials reach it', {skip: !chromePath}, async () => {
  await withFixture({idp: 'https://other.example.test'}, async (options, actions) => {
    await assert.rejects(openUiSession(options), {code: 'LOGIN_FAILED'});
    assert.deepEqual(actions, []);
  });
});

test('invalid TOTP seed fails at the authenticator form without submitting it', {skip: !chromePath}, async () => {
  await withFixture({seed: 'invalid!'}, async (options, actions) => {
    await assert.rejects(openUiSession(options), {code: 'LOGIN_FAILED', stage: 'okta-totp'});
    assert.deepEqual(actions, ['/identify', '/password', '/factor', '/totp']);
  });
});


for (const [name,variant] of [
  ['delayed WellSky initialization', {delayedStartup:true}],
  ['the labelled Google Authenticator link beside Email', {labelledFactors:true}],
  ['a direct semicolon dashboard', {dashboard:'semicolon'}],
  ['a dashboard that gains a semicolon while loading', {dashboard:'transition'}],
]) {
  test('Okta sign-in and session probe support '+name, {skip: !chromePath}, async () => {
    await withFixture(variant, async (options, actions) => {
      const session = await openUiSession(options);
      try {
        assert.equal(new URL(session.page.url()).hash, variant.dashboard ? '#mainPage;' : '#mainPage');
        assert.equal(await probeAuthentication(session.context, app, options.timeoutMs), false);
        assert.deepEqual(actions, ['/identify', '/password', '/factor', '/totp', '/verify']);
      } finally { await session.close(); }
    });
  });
}

test('a dashboard-like fragment or loading screen cannot complete sign-in', {skip: !chromePath}, async () => {
  await withFixture({}, async options => {
    const session = await openUiSession(options);
    try {
      for (const [hash, text] of [['#mainPage;other','Home Page Dashboard'],['#mainPage;','Home Page Dashboard Loading Modules']]) {
        await session.page.evaluate(([hash,text])=>{ location.hash=hash; document.body.textContent=text; }, [hash,text]);
        await assert.rejects(waitForLogin(session.page,200),{name:'TimeoutError'});
      }
    } finally { await session.close(); }
  });
});
