/**
 * Auth Cartoon Characters — Interactive eye-tracking + head movement + blinking + smiling
 * - Mouse: eyes AND head lean prominently toward cursor
 * - Email focus: all characters lean toward the email input, eyes locked there
 * - Password focus: all close eyes EXCEPT orange & dark, who look away
 * - Random blinking & smiling on idle
 */
(function () {
  'use strict';

  // ── Tuning constants ──
  const BLINK_DURATION = 160;
  const BLINK_MIN_INTERVAL = 2000;
  const BLINK_MAX_INTERVAL = 5500;
  const SMILE_MIN_INTERVAL = 3500;
  const SMILE_MAX_INTERVAL = 9000;
  const SMILE_DURATION = 2200;

  const PUPIL_EASE = 0.12;       // lerp for pupils
  const HEAD_EASE = 0.07;        // lerp for head slide (slower = springy)
  const HEAD_MOUSE_MAX = 14;     // max px head slides toward mouse
  const HEAD_EMAIL_MAX = 18;     // max px head slides toward email box
  const HEAD_AWAY_PX = 20;       // px head slides away during password
  const PUPIL_MAX_RATIO = 0.38;  // how far pupil can travel (fraction of eye width)

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let currentState = 'idle'; // idle | email | password
  let animFrameId = null;

  // Per-pupil & per-toon lerp state
  const pupilState = new WeakMap();
  const headState = new WeakMap();

  // ── Init ──
  function init() {
    const scene = document.getElementById('cartoon-scene');
    if (!scene) return;

    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const toons = scene.querySelectorAll('.toon');

    // Mouse tracking
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
      }
    }, { passive: true });

    // Input state transitions
    if (emailInput) {
      emailInput.addEventListener('focus', () => {
        currentState = 'email';
        openAllEyes();
        // Skew all characters — top leans right toward the form
        applyEmailSkew(scene, true);
      });
      emailInput.addEventListener('blur', () => {
        if (currentState === 'email') {
          currentState = 'idle';
          applyEmailSkew(scene, false);
        }
      });
    }

    if (passwordInput) {
      passwordInput.addEventListener('focus', () => {
        currentState = 'password';
        applyPasswordSkew(scene, true);
        // Close eyes for purple & yellow; orange & dark look away
        closeEyesForPassword();
      });
      passwordInput.addEventListener('blur', () => {
        if (currentState === 'password') {
          currentState = 'idle';
          openAllEyes();
          applyPasswordSkew(scene, false);
          // Reset look-away classes
          scene.querySelectorAll('.look-away').forEach((el) => el.classList.remove('look-away'));
        }
      });
    }

    // Init head state for each toon
    toons.forEach((toon) => {
      headState.set(toon, { x: 0 });
      scheduleRandomBlink(toon);
      scheduleRandomSmile(toon);
    });

    // Start loop
    startLoop(scene);
  }

  // ── Main animation loop ──
  function startLoop(scene) {
    const toons = Array.from(scene.querySelectorAll('.toon'));

    function tick() {
      toons.forEach((toon) => {
        updateHead(toon);
        toon.querySelectorAll('.toon-eye').forEach((eye) => updatePupil(eye, toon));
      });
      animFrameId = requestAnimationFrame(tick);
    }
    animFrameId = requestAnimationFrame(tick);
  }

  // ── Head / neck movement (horizontal slide only) ──
  function updateHead(toon) {
    const head = toon.querySelector('.toon-head');
    if (!head) return;

    const isOrange = toon.classList.contains('toon-orange');
    const isDark = toon.classList.contains('toon-dark');
    const hs = headState.get(toon) || { x: 0 };

    let targetX = 0;

    if (currentState === 'email') {
      // Slide head toward the email input
      const emailEl = document.getElementById('login-email');
      if (emailEl) {
        const toonRect = toon.getBoundingClientRect();
        const toonCX = toonRect.left + toonRect.width / 2;
        const inputRect = emailEl.getBoundingClientRect();
        const inputCX = inputRect.left + inputRect.width / 2;
        const dx = inputCX - toonCX;
        targetX = clamp((dx / 300) * HEAD_EMAIL_MAX, -HEAD_EMAIL_MAX, HEAD_EMAIL_MAX);
      }
    } else if (currentState === 'password') {
      if (isOrange) {
        // Orange looks away to the left
        targetX = -HEAD_AWAY_PX;
        toon.classList.add('look-away');
      } else if (isDark) {
        // Dark also looks away to the left (away from form)
        targetX = -HEAD_AWAY_PX;
        toon.classList.add('look-away');
      } else {
        targetX = 0;
      }
    } else {
      // Follow mouse — neck stretches toward cursor
      const toonRect = toon.getBoundingClientRect();
      const toonCX = toonRect.left + toonRect.width / 2;
      const dx = mouseX - toonCX;
      targetX = clamp((dx / 300) * HEAD_MOUSE_MAX, -HEAD_MOUSE_MAX, HEAD_MOUSE_MAX);
    }

    // Lerp for smooth spring
    hs.x += (targetX - hs.x) * HEAD_EASE;
    headState.set(toon, hs);

    head.style.transform = `translateX(${hs.x.toFixed(2)}px)`;
  }

  // ── Pupil tracking ──
  function updatePupil(eyeEl, toon) {
    const pupil = eyeEl.querySelector('.toon-pupil');
    const eyeWhite = eyeEl.querySelector('.toon-eye-white');
    if (!pupil || !eyeWhite) return;

    const isOrange = toon.classList.contains('toon-orange');
    const eyeRect = eyeWhite.getBoundingClientRect();
    const eyeCX = eyeRect.left + eyeRect.width / 2;
    const eyeCY = eyeRect.top + eyeRect.height / 2;
    const maxMove = eyeRect.width * PUPIL_MAX_RATIO;

    let targetX = 0;
    let targetY = 0;

    const isDark = toon.classList.contains('toon-dark');

    if (currentState === 'password') {
      if (isOrange) {
        // Orange looks far left
        targetX = -maxMove;
        targetY = 0;
      } else if (isDark) {
        // Dark looks far left (away from password)
        targetX = -maxMove;
        targetY = 0;
      } else {
        targetX = 0;
        targetY = 0;
      }
    } else if (currentState === 'email') {
      const emailEl = document.getElementById('login-email');
      if (emailEl) {
        const r = emailEl.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - eyeCX;
        const dy = (r.top + r.height / 2) - eyeCY;
        const angle = Math.atan2(dy, dx);
        targetX = Math.cos(angle) * maxMove;
        targetY = Math.sin(angle) * maxMove;
      }
    } else {
      // Follow mouse — prominent
      const dx = mouseX - eyeCX;
      const dy = mouseY - eyeCY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const travel = Math.min(dist * 0.12, maxMove);
      targetX = Math.cos(angle) * travel;
      targetY = Math.sin(angle) * travel;
    }

    // Lerp
    let ps = pupilState.get(pupil);
    if (!ps) { ps = { x: 0, y: 0 }; pupilState.set(pupil, ps); }
    ps.x += (targetX - ps.x) * PUPIL_EASE;
    ps.y += (targetY - ps.y) * PUPIL_EASE;

    pupil.style.transform = `translate(${ps.x.toFixed(1)}px, ${ps.y.toFixed(1)}px)`;
  }

  // ── Skew helpers — email leans right, password orange+dark lean left ──
  function applyEmailSkew(scene, active) {
    const skewValues = {
      'toon-purple': active ? 'skewX(-8deg)' : 'skewX(0deg)',
      'toon-dark':   active ? 'skewX(-7deg)' : 'skewX(0deg)',
      'toon-orange': active ? 'skewX(-6deg)' : 'skewX(0deg)',
      'toon-yellow': active ? 'skewX(-5deg)' : 'skewX(0deg)',
    };
    scene.querySelectorAll('.toon').forEach((toon) => {
      const face = toon.querySelector('.toon-face');
      if (!face) return;
      for (const [cls, val] of Object.entries(skewValues)) {
        if (toon.classList.contains(cls)) {
          face.style.transform = val;
          break;
        }
      }
    });
  }

  function applyPasswordSkew(scene, active) {
    // Orange and dark lean left (away from form) during password
    scene.querySelectorAll('.toon').forEach((toon) => {
      const face = toon.querySelector('.toon-face');
      if (!face) return;
      if (toon.classList.contains('toon-orange')) {
        face.style.transform = active ? 'skewX(5deg)' : 'skewX(0deg)';
      } else if (toon.classList.contains('toon-dark')) {
        face.style.transform = active ? 'skewX(4deg)' : 'skewX(0deg)';
      } else {
        face.style.transform = 'skewX(0deg)';
      }
    });
  }

  // ── Eye open / close helpers ──
  function closeEyesForPassword() {
    document.querySelectorAll('#cartoon-scene .toon').forEach((toon) => {
      // Orange and dark stay open (they look away instead)
      if (toon.classList.contains('toon-orange') || toon.classList.contains('toon-dark')) return;
      toon.querySelectorAll('.toon-eyelid').forEach((lid) => lid.classList.add('closed'));
    });
  }

  function openAllEyes() {
    document.querySelectorAll('#cartoon-scene .toon-eyelid').forEach((lid) => {
      lid.classList.remove('closed');
      lid.classList.remove('blink');
    });
  }

  // ── Random blinking ──
  function scheduleRandomBlink(toon) {
    const delay = randomBetween(BLINK_MIN_INTERVAL, BLINK_MAX_INTERVAL);
    setTimeout(() => {
      const isLookAway = toon.classList.contains('toon-orange') || toon.classList.contains('toon-dark');
      // Don't blink if eyes should be closed (password for purple/yellow)
      const shouldSkip = currentState === 'password' && !isLookAway;
      if (!shouldSkip) blinkCharacter(toon);
      scheduleRandomBlink(toon);
    }, delay);
  }

  function blinkCharacter(toon) {
    const lids = toon.querySelectorAll('.toon-eyelid');
    lids.forEach((lid) => lid.classList.add('blink'));
    setTimeout(() => {
      const isLookAway = toon.classList.contains('toon-orange') || toon.classList.contains('toon-dark');
      const shouldStayClosed = currentState === 'password' && !isLookAway;
      if (!shouldStayClosed) lids.forEach((lid) => lid.classList.remove('blink'));
    }, BLINK_DURATION);
  }

  // ── Random smiling ──
  function scheduleRandomSmile(toon) {
    const delay = randomBetween(SMILE_MIN_INTERVAL, SMILE_MAX_INTERVAL);
    setTimeout(() => {
      smileCharacter(toon);
      scheduleRandomSmile(toon);
    }, delay);
  }

  function smileCharacter(toon) {
    const mouth = toon.querySelector('.toon-mouth');
    if (!mouth) return;
    mouth.classList.add('smile');
    setTimeout(() => mouth.classList.remove('smile'), SMILE_DURATION);
  }

  // ── Utility ──
  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
