// modules/ui/welcome.js
// Apple-style full-screen welcome overlay shown on login.
// Runs concurrently with app init — costs zero extra seconds.

const MIN_DISPLAY_MS = 1800; // minimum visible time before it can be dismissed
const FADE_OUT_MS    = 550;  // must match the CSS transition duration

let _overlay       = null;
let _nameEl        = null;
let _minTimerDone  = false;
let _dataDismissed = false;
let _active        = false;

function _mount() {
  if (_overlay) return;
  _overlay = document.getElementById('welcome-screen');
  _nameEl  = _overlay ? _overlay.querySelector('.wlc-name') : null;
}

/**
 * Show the welcome screen.
 * @param {string} nameHint – best name available right now (may be empty or
 *   updated later via updateWelcomeName once the profile is fetched).
 */
export function showWelcomeScreen(nameHint = '') {
  _mount();
  if (!_overlay) return;

  _minTimerDone  = false;
  _dataDismissed = false;
  _active        = true;

  if (_nameEl) _nameEl.textContent = nameHint || '';

  _overlay.classList.remove('wlc-fade-out');
  _overlay.style.display = 'flex';

  // Force a reflow so the transition plays from opacity 0.
  void _overlay.offsetHeight;
  _overlay.classList.add('wlc-visible');

  // After the minimum display time, allow the screen to close.
  setTimeout(() => {
    _minTimerDone = true;
    if (_dataDismissed) _runDismiss();
  }, MIN_DISPLAY_MS);
}

/**
 * Update the displayed name once the real profile is available.
 * Safe to call even if the screen has already been dismissed.
 */
export function updateWelcomeName(firstName) {
  _mount();
  if (_nameEl && _active && firstName) {
    _nameEl.textContent = firstName;
  }
}

/**
 * Signal that the app is ready. The screen will fade out as soon as the
 * minimum display time has also elapsed.
 */
export function dismissWelcomeScreen() {
  _dataDismissed = true;
  if (_minTimerDone) _runDismiss();
}

function _runDismiss() {
  if (!_overlay || !_active) return;
  _active = false;

  _overlay.classList.add('wlc-fade-out');
  setTimeout(() => {
    _overlay.style.display = 'none';
    _overlay.classList.remove('wlc-visible', 'wlc-fade-out');
  }, FADE_OUT_MS);
}
