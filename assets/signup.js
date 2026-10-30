// Inline daily-email sign-up for every state, price, best-odds, prizes-remaining and game page (form.signup, built by build.mjs).
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
  // Set only on a GAME page: after sign-up the game joins the account's tracked list, and its alerts
  // are emailed whatever the tier (free accounts track 3 — NotificationPolicy / TrackedGames).
  var game = form.getAttribute('data-game');
  var gameName = form.getAttribute('data-game-name');
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
  // Every failure the visitor sees is also counted, by step and kind. Without it a broken sign-up
  // (API down, email provider rejecting) looks exactly like nobody trying.
  function failed(stepName, reason) { track('email_signup_error', { state: state, step: stepName, reason: reason }); }
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

  function done(homeState, tracked) {
    while (form.firstChild) form.removeChild(form.firstChild);
    var title = document.createElement('b');
    title.textContent = tracked === 'ok' || tracked === 'already'
      ? 'You’re tracking ' + gameName + '.'
      : 'You’re signed up.';
    var body = document.createElement('span');
    var daily = homeState && homeState !== state
      ? 'Your daily email stays set to ' + homeState + ' — you can change it in Settings.'
      : 'Your first ' + stateName + ' email arrives tomorrow morning, and new accounts have Premium free for 14 days. If it lands in Promotions, drag it to Primary so you see it.';
    body.textContent = (tracked === 'ok' || tracked === 'already'
      ? 'We’ll email you the morning it loses a top prize or starts running low. '
      : tracked === 'full'
        ? 'Free accounts track 3 games and you already track 3 — Premium tracks as many as you like. '
        : tracked === 'failed'
          ? 'We could not add this game to your tracked list just now — tap the star on its page in the app. '
          : '') + daily;
    var link = document.createElement('a');
    link.href = app + '/?state=' + state.toLowerCase();
    link.textContent = 'See today’s ' + stateName + ' picks now →';
    link.setAttribute('data-ga-event', 'app_cta');
    link.setAttribute('data-ga-placement', 'signup_done');
    link.setAttribute('data-ga-state', state);
    form.appendChild(title);
    form.appendChild(body);
    form.appendChild(link);
  }

  function requestCode() {
    address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { say('Enter a valid email address.'); failed('email', 'invalid_email'); email.focus(); return; }
    busy(true, 'Sending…');
    call('POST', '/v1/auth/request-link', { email: address, state: state }).then(function (r) {
      if (!r.ok) { say(r.data.message || 'Something went wrong. Please try again.'); failed('email', 'api_' + (r.data.code || 'error')); return; }
      track('email_signup_submit', { state: state });
      step = 'code';
      email.readOnly = true;
      codeRow.hidden = false;
      button.textContent = 'Confirm';
      say('We emailed a 6-digit code to ' + address + '. Type it here, or tap the link in that email.');
      code.focus();
    }).catch(function () {
      say('Could not reach ScratchWolf. Check your connection and try again.');
      failed('email', 'network');
    }).then(function () { busy(false); });
  }

  // Adds this page's game to the account's favorites, the list alerts are matched against. The app
  // writes favorites as "<STATE>-<row id>", so the row id is looked up by the state's game number.
  function trackGame(me) {
    if (!game) return Promise.resolve(null);
    return call('GET', '/v1/games/' + state.toLowerCase() + '/' + encodeURIComponent(game)).then(function (g) {
      var row = g.ok ? (g.data.data || g.data) : null;
      if (!row || !row.id) return 'failed';
      var key = state + '-' + row.id;
      var favorites = [];
      try { favorites = JSON.parse(me.favorites || '[]') || []; } catch (e) { favorites = []; }
      if (!Array.isArray(favorites)) favorites = [];
      if (favorites.indexOf(key) >= 0) return 'already';
      if (!me.isPremium && favorites.length >= 3) return 'full';
      return call('PUT', '/v1/me/settings', { favorites: favorites.concat([key]) }).then(function (r) {
        if (!r.ok) return 'failed';
        track('game_tracked', { state: state, game_number: game });
        return 'ok';
      });
    }).catch(function () { return 'failed'; });
  }

  function confirmCode() {
    var digits = code.value.replace(/\D/g, '');
    if (digits.length !== 6) { say('Enter the 6-digit code from the email.'); failed('code', 'invalid_code_format'); code.focus(); return; }
    busy(true, 'Checking…');
    call('POST', '/v1/auth/verify-code', { email: address, code: digits }).then(function (r) {
      if (!r.ok) { say(r.data.message || 'That code did not work. Check it and try again.'); failed('code', 'api_' + (r.data.code || 'error')); busy(false); return; }
      track('login', { method: 'site_email_code', state: state });
      // Only a NEW account (no home state yet) takes this page's state — never overwrite a choice.
      return call('GET', '/v1/me').then(function (me) {
        var data = me.ok ? me.data : {};
        var home = data.favoriteState || null;
        // No home state yet = a NEW account: GA4's recommended sign_up event, beside login.
        var setHome = home ? Promise.resolve() : (track('sign_up', { method: 'site_email_code', state: state }),
          call('PUT', '/v1/me/settings', { favoriteState: state }));
        return setHome.then(function () { return me.ok ? trackGame(data) : (game ? 'failed' : null); })
          .then(function (tracked) { done(home, tracked); });
      }).catch(function () { done(null, game ? 'failed' : null); });
    }).catch(function () {
      say('Could not reach ScratchWolf. Check your connection and try again.');
      failed('code', 'network');
      busy(false);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (button.disabled) return;
    if (step === 'email') requestCode(); else confirmCode();
  });
})();
