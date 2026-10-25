// Inline daily-email sign-up for the state and game pages (form.signup, built by build.mjs).
//
// It replaces a link to the app's sign-in screen, which asked a visitor who had just said "email me"
// to leave the page, find a box and start again. Same account flow as the app — request-link sends a
// 6-digit code plus a link, verify-code sets the session cookie — so there is still ONE subscriber
// list. The page's state is sent with the request (so tapping the emailed LINK keeps it) and written
// to a new account after the code is confirmed, because the daily email goes to the account's home
// state and an account without one receives nothing.
//
// Without JavaScript the form submits as a plain GET to the app's sign-in (/app/login?state=xx).
(function () {
  var form = document.querySelector('form.signup');
  if (!form || !window.fetch) return;

  var state = form.getAttribute('data-state');
  var stateName = form.getAttribute('data-name');
  var api = form.getAttribute('data-api');
  var app = form.getAttribute('data-app');
  var email = form.querySelector('#signup-email');
  var code = form.querySelector('#signup-code');
  var codeRow = form.querySelector('.signup-code');
  var msg = form.querySelector('.signup-msg');
  var button = form.querySelector('button[type=submit]');
  var step = 'email';
  var address = '';

  function track(name, params) { if (window.gtag) window.gtag('event', name, params || {}); }
  function say(text) { msg.textContent = text; }
  function call(method, path, body) {
    return fetch(api + path, {
      method: method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { ok: r.ok, data: data || {} };
      });
    });
  }
  function busy(on, text) { button.disabled = on; if (text) say(text); }

  function done(homeState) {
    while (form.firstChild) form.removeChild(form.firstChild);
    var title = document.createElement('b');
    title.textContent = 'You’re signed up.';
    var body = document.createElement('span');
    body.textContent = homeState && homeState !== state
      ? 'Your daily email stays set to ' + homeState + ' — you can change it in Settings.'
      : 'Your first ' + stateName + ' email arrives tomorrow morning. If it lands in Promotions, drag it to Primary so you see it.';
    var link = document.createElement('a');
    link.href = app + '/?state=' + state.toLowerCase();
    link.textContent = 'See today’s ' + stateName + ' picks now →';
    form.appendChild(title);
    form.appendChild(body);
    form.appendChild(link);
  }

  function requestCode() {
    address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { say('Enter a valid email address.'); email.focus(); return; }
    busy(true, 'Sending…');
    call('POST', '/v1/auth/request-link', { email: address, state: state }).then(function (r) {
      if (!r.ok) { say(r.data.message || 'Something went wrong. Please try again.'); return; }
      track('email_signup_submit', { state: state });
      step = 'code';
      email.readOnly = true;
      codeRow.hidden = false;
      button.textContent = 'Confirm';
      say('We emailed a 6-digit code to ' + address + '. Type it here, or tap the link in that email.');
      code.focus();
    }).catch(function () {
      say('Could not reach ScratchWolf. Check your connection and try again.');
    }).then(function () { busy(false); });
  }

  function confirmCode() {
    var digits = code.value.replace(/\D/g, '');
    if (digits.length !== 6) { say('Enter the 6-digit code from the email.'); code.focus(); return; }
    busy(true, 'Checking…');
    call('POST', '/v1/auth/verify-code', { email: address, code: digits }).then(function (r) {
      if (!r.ok) { say(r.data.message || 'That code did not work. Check it and try again.'); busy(false); return; }
      track('login', { method: 'site_email_code', state: state });
      // Only a NEW account (no home state yet) takes this page's state — never overwrite a choice.
      return call('GET', '/v1/me').then(function (me) {
        var home = me.ok ? me.data.favoriteState : null;
        if (!home) return call('PUT', '/v1/me/settings', { favoriteState: state }).then(function () { return null; });
        return home;
      }).catch(function () { return null; }).then(done);
    }).catch(function () {
      say('Could not reach ScratchWolf. Check your connection and try again.');
      busy(false);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (button.disabled) return;
    if (step === 'email') requestCode(); else confirmCode();
  });
})();
