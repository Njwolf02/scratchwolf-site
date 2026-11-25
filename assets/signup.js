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
//
// Events, each counted once for one thing (none is ever summed with another):
//   email_signup_submit  the code was sent — state, page_type, and game_number on a game page
//   email_signup_error   a failure the visitor saw, by step and reason
//   login / sign_up      the code was confirmed (sign_up only for a new account)
//   game_tracked         the game joined the account's tracked list — method signup or one_tap
//   track_limit_shown    a free account already tracking 3 was offered Premium for this one
//   track_dock_click     the bar pinned to the bottom of a phone screen was tapped
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
  var pageType = document.body.getAttribute('data-page-type') || 'other';
  var email = form.querySelector('#signup-email');
  var code = form.querySelector('#signup-code');
  var codeRow = form.querySelector('.signup-code');
  var msg = form.querySelector('.signup-msg');
  var button = form.querySelector('button[type=submit]');
  var step = 'email';
  var address = '';
  var signedIn = null;   // the /v1/me body when this visitor already has a session (game pages only)

  // Mirrors FREE_TIER_LIMITS.FAVORITE_GAMES (app) and TrackedGames.FreeLimit (server).
  // A page with no state of its own (the homepage, the national lists) asks for one: the box follows
  // the picker, pre-set from /v1/geo the way the homepage's own state picker is, until the visitor
  // chooses — a guess never overrides a choice.
  var picker = form.querySelector('select[name=state]');
  if (picker) {
    var chosen = false;
    var pick = function () {
      state = picker.value.toUpperCase();
      stateName = picker.options[picker.selectedIndex].text;
    };
    picker.addEventListener('change', function () { chosen = true; pick(); });
    pick();
    call('GET', '/v1/geo').then(function (r) {
      var here = r.ok && r.data && r.data.state ? String(r.data.state).toLowerCase() : '';
      if (chosen || !here || !picker.querySelector('option[value="' + here + '"]')) return;
      picker.value = here;
      pick();
    }).catch(function () { /* offline or blocked: the first state stays selected */ });
  }

  var FREE_TRACKED = 3;
  // Mirrors CARD_TRIAL_DAYS and PRICE in the app's subscribeOffer.ts — the offer must say what checkout does.
  var TRIAL_DAYS = 7;
  var PRICES = '$4.99/mo or $34.99/yr';

  function track(name, params) { if (window.gtag) window.gtag('event', name, params || {}); }
  function about(extra) {
    var p = { state: state, page_type: pageType };
    if (game) p.game_number = game;
    for (var k in extra || {}) p[k] = extra[k];
    return p;
  }
  // Every failure the visitor sees is also counted, by step and kind. Without it a broken sign-up
  // (API down, email provider rejecting) looks exactly like nobody trying.
  function failed(stepName, reason) { track('email_signup_error', about({ step: stepName, reason: reason })); }
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
  function gameUrl(query) { return app + '/game/' + state.toLowerCase() + '/' + encodeURIComponent(game) + (query || ''); }
  function appLink(href, text, placement) {
    var link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    link.setAttribute('data-ga-event', 'app_cta');
    link.setAttribute('data-ga-placement', placement);
    link.setAttribute('data-ga-state', state);
    return link;
  }
  function line(text) { var s = document.createElement('span'); s.textContent = text; return s; }

  // The 4th game. A NEW account never gets here: it has Premium for its first 14 days, so it tracks
  // as many as it likes. This is an account past that — offered the card trial only if checkout will
  // give it one (trialEligible), otherwise the plain price.
  function limitOffer(me) {
    var trial = me.trialEligible !== false;
    track('track_limit_shown', about({ trial: trial }));
    return [
      line('Free accounts get alerts for 3 games, and you already track 3. Premium tracks as many as you like' +
        (trial ? ': free for ' + TRIAL_DAYS + ' days, then ' + PRICES + '. Cancel any time.' : ' for ' + PRICES + '.')),
      appLink(gameUrl('?upgrade=favorites'),
        trial ? 'Start the ' + TRIAL_DAYS + '-day free trial and track ' + gameName + ' →' : 'Go Premium and track ' + gameName + ' →',
        'track_limit'),
    ];
  }

  // A complimentary Premium account past the free 3 is told the truth now, not when the alerts stop:
  // after Premium ends, alerts continue for the FIRST 3 games it tracked (TrackedGames.Parse).
  function premiumNote(me, count) {
    if (count <= FREE_TRACKED || me.hasSubscription || !me.complimentaryUntil) return '';
    var until = new Date(me.complimentaryUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    return ' Your free Premium tracks more than 3 until ' + until + '; after that, alerts continue for the first 3 you tracked.';
  }

  function done(result, me, isNew, homeState) {
    finished = true;
    syncDock();
    var status = result && result.status;
    while (form.firstChild) form.removeChild(form.firstChild);
    var title = document.createElement('b');
    title.textContent = status === 'ok' || status === 'already'
      ? 'You’re tracking ' + gameName + '.'
      : status === 'full'
        ? 'You track 3 games already.'
        : 'You’re signed up.';
    form.appendChild(title);

    if (status === 'full') {
      limitOffer(me).forEach(function (el) { form.appendChild(el); });
      return;
    }

    var daily = !isNew ? ''
      : homeState && homeState !== state
        ? 'Your daily email stays set to ' + homeState + ' — you can change it in Settings.'
        : 'Your first ' + stateName + ' email arrives tomorrow morning, and new accounts have Premium free for 14 days. If it lands in Promotions, drag it to Primary so you see it.';
    form.appendChild(line((status === 'ok' || status === 'already'
      ? 'We’ll email you the morning it loses a top prize or starts running low.' + premiumNote(me, result.count) + ' '
      : status === 'failed'
        ? 'We could not add this game to your tracked list just now — tap the star on its page in the app. '
        : '') + daily));
    form.appendChild(game
      ? appLink(gameUrl(), 'See ' + gameName + '’s Buy Score →', 'signup_done')
      : appLink(app + '/?state=' + state.toLowerCase(), 'See today’s ' + stateName + ' picks now →', 'signup_done'));
  }

  function requestCode() {
    address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { say('Enter a valid email address.'); failed('email', 'invalid_email'); email.focus(); return; }
    busy(true, 'Sending…');
    call('POST', '/v1/auth/request-link', { email: address, state: state }).then(function (r) {
      if (!r.ok) { say(r.data.message || 'Something went wrong. Please try again.'); failed('email', 'api_' + (r.data.code || 'error')); return; }
      track('email_signup_submit', about());
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
  // Resolves to { status: ok | already | full | failed, count: games tracked afterwards }.
  function trackGame(me, method) {
    if (!game) return Promise.resolve(null);
    return call('GET', '/v1/games/' + state.toLowerCase() + '/' + encodeURIComponent(game)).then(function (g) {
      var row = g.ok ? (g.data.data || g.data) : null;
      if (!row || !row.id) return { status: 'failed' };
      var key = state + '-' + row.id;
      var favorites = [];
      try { favorites = JSON.parse(me.favorites || '[]') || []; } catch (e) { favorites = []; }
      if (!Array.isArray(favorites)) favorites = [];
      if (favorites.indexOf(key) >= 0) return { status: 'already', count: favorites.length };
      if (!me.isPremium && favorites.length >= FREE_TRACKED) return { status: 'full', count: favorites.length };
      return call('PUT', '/v1/me/settings', { favorites: favorites.concat([key]) }).then(function (r) {
        if (!r.ok) return { status: 'failed' };
        track('game_tracked', about({ method: method }));
        return { status: 'ok', count: favorites.length + 1 };
      });
    }).catch(function () { return { status: 'failed' }; });
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
        return setHome.then(function () { return me.ok ? trackGame(data, 'signup') : (game ? { status: 'failed' } : null); })
          .then(function (result) { done(result, data, true, home); });
      }).catch(function () { done(game ? { status: 'failed' } : null, {}, true, null); });
    }).catch(function () {
      say('Could not reach ScratchWolf. Check your connection and try again.');
      failed('code', 'network');
      busy(false);
    });
  }

  // Already signed in (the session cookie is HttpOnly, so ask the API): no email to type, one tap
  // tracks the game. Without this a subscriber tracking a 2nd or 3rd game had to sign in again from
  // every page — and a 4th game, the one Premium is for, was never reached from the site at all.
  // It is not a sign-up, so it sends no email_signup_submit; it sends game_tracked (method one_tap).
  function useSession(me) {
    signedIn = me;
    step = 'signed_in';
    email.required = false;
    email.hidden = true;
    var label = form.querySelector('label[for=signup-email]');
    if (label) label.hidden = true;
    say('You’re signed in' + (me.email ? ' as ' + me.email : '') + '. One tap tracks this game.');
  }

  function trackSignedIn() {
    busy(true, 'Adding…');
    trackGame(signedIn, 'one_tap').then(function (result) { done(result, signedIn, false, signedIn.favoriteState); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (button.disabled) return;
    if (step === 'signed_in') trackSignedIn();
    else if (step === 'email') requestCode();
    else confirmCode();
  });

  if (game) {
    call('GET', '/v1/me').then(function (r) {
      if (r.ok && r.data && r.data.email && step === 'email' && !email.value) useSession(r.data);
    }).catch(function () { /* signed out or offline: the email form stays */ });
  }

  // The phone bar pinned to the bottom of a game page (trackDock in lib/layout.mjs). Shown only while
  // the box itself is off screen, and never again once the game is tracked or the bar is dismissed.
  var dock = document.querySelector('.track-dock');
  var finished = false, boxVisible = true, dismissed = false;
  function syncDock() {
    if (!dock) return;
    var show = !dismissed && !finished && !boxVisible;
    dock.hidden = !show;
    document.body.classList.toggle('has-dock', show);
  }
  if (dock && 'IntersectionObserver' in window) {
    try { dismissed = sessionStorage.getItem('sw-track-dock') === 'closed'; } catch (e) { dismissed = false; }
    new IntersectionObserver(function (entries) { boxVisible = entries[0].isIntersecting; syncDock(); }).observe(form);
    dock.querySelector('[data-dock-go]').addEventListener('click', function (e) {
      e.preventDefault();
      track('track_dock_click', about());
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      form.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      var target = step === 'email' ? email : step === 'code' ? code : button;
      if (target) target.focus({ preventScroll: true });
    });
    dock.querySelector('[data-dock-close]').addEventListener('click', function () {
      dismissed = true;
      try { sessionStorage.setItem('sw-track-dock', 'closed'); } catch (e) { /* private mode: closed for this page only */ }
      syncDock();
    });
  }
})();
