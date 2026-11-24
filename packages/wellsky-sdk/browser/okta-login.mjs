import {createHmac} from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const username = 'input[name="identifier"], input[name="username"]';
const password = 'input[name="credentials.passcode"][type="password"], input[name="password"][type="password"]';
const passcode = 'input[name="credentials.passcode"]:not([type="password"]), input[name="passCode"]';
const submit = 'button[type="submit"], input[type="submit"]';

export function readOktaOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || value !== url.origin && value !== url.origin + '/') {
    throw Error('Expected an exact HTTPS Okta origin');
  }
  return url.origin;
}

export function totpCode(secret, time = Date.now()) {
  const base32 = secret?.trim().replace(/=+$/, '').toUpperCase();
  if (!base32 || !/^[A-Z2-7]+$/.test(base32) || [1, 3, 6].includes(base32.length % 8)) {
    throw Error('Expected a Base32 TOTP secret');
  }

  const key = [];
  let bits = 0;
  let buffer = 0;
  for (const digit of base32) {
    buffer = (buffer << 5) | alphabet.indexOf(digit);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      key.push(buffer >> bits);
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) throw Error('Invalid Base32 padding bits');

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac('sha1', Buffer.from(key)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function completeOktaLogin({page, origin, target, tenant, user, secret, uiPassword, timeoutMs, setStage}) {
  const deadline = Date.now() + timeoutMs;
  const appPath = '/' + tenant + '/';
  let wellskyUsernameSubmitted = false;
  let oktaUsernameSubmitted = false;
  let passwordSubmitted = false;
  let passwordSelected = false;
  let factorSelected = false;
  let codeSubmitted = false;

  for (;;) {
    const state = await page.waitForFunction(settings => {
      const visible = selector => [...document.querySelectorAll(selector)].some(element =>
        element.getClientRects().length && getComputedStyle(element).visibility === 'visible');
      if (location.origin === settings.target && location.pathname.startsWith(settings.appPath)) {
        if (location.hash === '#mainPage') return 'returned';
        if (!settings.wellskyUsernameSubmitted && visible('[id="formfield-login"]')) return 'wellsky-username';
        return false;
      }
      if (location.origin !== settings.origin) return 'unexpected-origin';
      const inWidget = selector => visible(selector.split(', ').map(part => '#okta-sign-in ' + part).join(', '));
      const title = document.querySelector('#okta-sign-in h2, #okta-sign-in h1')?.textContent ?? '';
      if (!settings.codeSubmitted && inWidget(settings.passcode)
        && (settings.factorSelected || /Google Authenticator|Okta Verify/i.test(title))) return 'okta-totp';
      if (!settings.passwordSubmitted && inWidget(settings.password)) return 'okta-password';
      if (!settings.passwordSubmitted && !settings.passwordSelected && inWidget('[data-se="okta_password"] [data-se="select-factor"]')) return 'okta-select-password';
      if (!settings.oktaUsernameSubmitted && inWidget(settings.username)) return 'okta-username';
      if (!settings.codeSubmitted && !settings.factorSelected && inWidget('[data-se="google_otp"] [data-se="select-factor"]')) return 'okta-select-totp';
      return false;
    }, {origin, target, appPath, wellskyUsernameSubmitted, oktaUsernameSubmitted, passwordSubmitted,
      codeSubmitted, passwordSelected, factorSelected, username, password, passcode}, {timeout: Math.max(1, deadline - Date.now())});
    const step = await state.jsonValue();
    await state.dispose();
    setStage(step);

    const url = new URL(page.url());
    if (step === 'returned' && url.origin === target && url.pathname.startsWith(appPath)) return;
    if (step === 'wellsky-username' && url.origin === target && url.pathname.startsWith(appPath)) {
      await page.locator('[id="formfield-login"]:visible').fill(user);
      await page.locator('[id="LoginView.fbtn_submit"]:visible').click();
      wellskyUsernameSubmitted = true;
      continue;
    }
    if (url.origin !== origin) throw Error('Unexpected login origin');

    const widget = page.locator('#okta-sign-in');
    if (step === 'okta-select-password' || step === 'okta-select-totp') {
      const factor = step === 'okta-select-password' ? 'okta_password' : 'google_otp';
      await widget.locator(`[data-se="${factor}"] [data-se="select-factor"]:visible`).click();
      if (step === 'okta-select-password') passwordSelected = true;
      else factorSelected = true;
      continue;
    }
    let field;
    if (step === 'okta-username' || step === 'okta-password') {
      const identifier = widget.locator(username).filter({visible: true});
      if (step === 'okta-username' || await identifier.count() > 0) await identifier.fill(user);
      field = identifier;
      oktaUsernameSubmitted = true;
      if (step === 'okta-password') {
        field = widget.locator(password).filter({visible: true});
        await field.fill(uiPassword);
        passwordSubmitted = true;
      }
    } else if (step === 'okta-totp') {
      field = widget.locator(passcode).filter({visible: true});
      await field.fill(totpCode(secret));
      codeSubmitted = true;
    } else {
      throw Error('Unexpected login step');
    }
    await field.locator('xpath=ancestor::form[1]').locator(submit).filter({visible: true}).click();
  }
}
