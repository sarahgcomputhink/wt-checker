/*
 * WebThinker Check my work, v1.3
 *
 * Adds a "Check my work" bar under the student's p5.js sketch.
 * When clicked, it runs the student's file and the task's solution in two
 * hidden frames, in the same browser, with the same random seed. It steps
 * both sketches to the same frame and compares the canvases pixel by pixel.
 * If they match, it shows the task's pass code to type into the H5P book.
 *
 * The student's visible sketch is never touched.
 *
 * Load order in index.html:
 *   1. p5.js
 *   2. this file
 *   3. the student's lesson file, for example L02_funShapes.js
 *
 * Task lists live in tasks/Lxx.js next to this file and call
 * WTChecker.register('Lxx', { tasks: [...] }).
 */
(function () {
  'use strict';

  const BASE = document.currentScript.src.replace(/[^/]*$/, '');
  const SEED = 12345;
  const START_TIMEOUT_MS = 8000;

  // Defaults; any task can override them.
  const DEFAULTS = {
    frames: [1],            // which frames to compare
    shiftTolerance: 2,      // a pixel matches if a close colour is within this many pixels
    colourTolerance: 8,     // biggest allowed difference in red, green or blue (0 to 255)
    maxDifferent: 0.0001    // share of pixels allowed to differ (0.0001 of 600 x 400 is 24)
  };

  let lessonCode = null;
  let lesson = null;
  let ui = null;

  // ---------- Public API used by task files ----------

  window.WTChecker = {
    version: '1.3',
    register(code, data) {
      if (code !== lessonCode) return;
      try {
        lesson = (data && data.d) ? unscramble(code, data.d) : data;
      } catch (e) {
        lesson = null;
        if (ui) ui.select.innerHTML = '<option>This lesson\u2019s checks could not load</option>';
        return;
      }
      fillTaskList();
    }
  };

  // Task lists are published scrambled (see build-tasks.js), so solutions
  // and pass codes are not readable as plain text in the file.
  function keyStream(code, n) {
    let h = 2166136261;
    const seed = 'wt-checker:' + code;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    let x = h || 1;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      out[i] = x & 255;
    }
    return out;
  }

  function unscramble(code, text) {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ks = keyStream(code, bytes.length);
    const plain = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) plain[i] = bytes[i] ^ ks[i];
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- Keyed codes ----------
  // The quiz shows each student a random 2-letter key. The code shown on a
  // match depends on the task's secret and that key, so a friend's code
  // (made with a different key) is rejected. make-moodle-questions.js uses
  // the same function to write each key's answer.
  const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

  function keyedCode(secret, key) {
    const text = 'wt-key:' + secret + ':' + key;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    let out = '';
    for (let i = 0; i < 4; i++) { out += LETTERS[h % 20]; h = Math.floor(h / 20); }
    return out;
  }

  function cleanKey(raw) {
    const k = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
    return (k.length === 2 && [...k].every((c) => LETTERS.includes(c))) ? k : null;
  }

  // ---------- Find the lesson and the scripts ----------

  function findScripts() {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    let p5Url = null;
    let studentUrl = null;
    for (const s of scripts) {
      const src = s.getAttribute('src');
      const abs = new URL(src, location.href).href;
      if (/\/p5(\.min)?\.js(\?|$)/i.test(abs)) p5Url = abs;
      const m = abs.match(/\/L(\d{2})_[^/]*\.js(\?|$)/i);
      if (m) {
        studentUrl = abs;
        lessonCode = 'L' + m[1];
      }
    }
    return { p5Url, studentUrl };
  }

  // ---------- Hidden sketch runner ----------

  // Wraps setup() so the sketch starts with a fixed random seed and stops
  // after setup, so frames can be stepped one at a time.
  const HOOK = `
    (function () {
      var userSetup = window.setup;
      window.setup = function () {
        randomSeed(${SEED});
        noiseSeed(${SEED});
        if (typeof userSetup === 'function') userSetup();
        noLoop();
        window.__wt.ready = true;
      };
      var userDraw = typeof window.draw === 'function' ? window.draw : function () {};
      window.draw = function () {
        try { userDraw(); }
        catch (e) { window.__wt.errors.push(e.message); }
      };
    })();`;

  function frameHtml(p5Url, codeTag) {
    return `<!doctype html><html><head>
<base href="${location.href}">
<style>html,body{margin:0;padding:0;background:transparent}</style>
<script>
  window.__wt = { ready: false, errors: [] };
  window.addEventListener('error', function (e) {
    window.__wt.errors.push(e.message + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  });
<\/script>
<script src="${p5Url}"><\/script>
${codeTag}
<script>${HOOK}<\/script>
</head><body></body></html>`;
  }

  function runSketch(p5Url, codeTag) {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden;';
      frame.srcdoc = frameHtml(p5Url, codeTag);
      document.body.appendChild(frame);

      const started = Date.now();
      (function wait() {
        const w = frame.contentWindow;
        const state = w && w.__wt;
        if (state && state.errors.length) return resolve({ frame, error: state.errors[0] });
        // Wait for p5's first automatic frame, so stepping starts from a known point.
        if (state && state.ready && (w.frameCount >= 1 || Date.now() - started > 1500)) {
          return resolve(state.errors.length ? { frame, error: state.errors[0] } : { frame, win: w });
        }
        if (Date.now() - started > START_TIMEOUT_MS) return resolve({ frame, error: 'timeout' });
        setTimeout(wait, 50);
      })();
    });
  }

  function stepTo(win, target) {
    let guard = 0;
    while (win.frameCount < target && guard < 10000) {
      try { win.redraw(); } catch (e) { win.__wt.errors.push(e.message); }
      if (win.__wt.errors.length) break;
      guard++;
    }
    const errs = win.__wt.errors;
    return errs.length ? errs[0] : null;
  }

  function grab(win) {
    const canvas = win.document.querySelector('canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    return {
      w: canvas.width,
      h: canvas.height,
      logicalW: win.width,
      logicalH: win.height,
      density: canvas.width / win.width,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data
    };
  }

  // ---------- Comparison ----------

  // A pixel counts as different only if no pixel of a close colour exists
  // nearby in the other picture. This forgives edges drawn a pixel or two
  // differently, but not missing or wrongly coloured shapes.
  function compare(a, b, opts) {
    const w = a.w, h = a.h;
    const r = Math.max(0, Math.round(opts.shiftTolerance * a.density));
    const tol = opts.colourTolerance;
    const diff = new Uint8Array(w * h);
    let count = 0;

    function closeNearby(src, dst, x, y) {
      const i = (y * w + x) * 4;
      const sr = src[i], sg = src[i + 1], sb = src[i + 2];
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          if (Math.abs(dst[j] - sr) <= tol && Math.abs(dst[j + 1] - sg) <= tol && Math.abs(dst[j + 2] - sb) <= tol) return true;
        }
      }
      return false;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Fast path: identical pixel.
        if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
        if (!closeNearby(a.data, b.data, x, y) || !closeNearby(b.data, a.data, x, y)) {
          diff[y * w + x] = 1;
          count++;
        }
      }
    }
    return { count, ratio: count / (w * h), diff };
  }

  // ---------- Check one task ----------

  async function checkTask(task) {
    const opts = Object.assign({}, DEFAULTS, task);
    const { p5Url, studentUrl } = findScripts();
    if (!p5Url) return { kind: 'setup', text: 'p5.js is not loaded in index.html.' };
    if (!studentUrl) return { kind: 'setup', text: 'index.html does not load a lesson file such as L02_funShapes.js.' };

    const bust = (studentUrl.includes('?') ? '&' : '?') + 'wt=' + Date.now();
    const studentTag = `<script src="${studentUrl + bust}"><\/script>`;
    const solutionTag = `<script>${task.solution.replace(/<\/script/gi, '<\\/script')}<\/script>`;

    const [mine, ref] = await Promise.all([runSketch(p5Url, studentTag), runSketch(p5Url, solutionTag)]);
    const cleanUp = () => { mine.frame.remove(); ref.frame.remove(); };

    try {
      if (ref.error) return { kind: 'setup', text: 'This task\u2019s check is broken. Tell your Code Mentor. (' + ref.error + ')' };
      if (mine.error === 'timeout') return { kind: 'error', text: 'Your sketch did not start. Check that your file has function setup() and save it.' };
      if (mine.error) return { kind: 'error', text: 'Your code has an error: ' + mine.error + '. Fix it, save, and check again.' };

      const frames = opts.frames.slice().sort((x, y) => x - y);
      let worst = null;
      let worstFrame = null;

      for (const f of frames) {
        const e1 = stepTo(mine.win, f);
        if (e1) return { kind: 'error', text: 'Your code has an error: ' + e1 + '. Fix it, save, and check again.' };
        stepTo(ref.win, f);

        const a = grab(mine.win);
        const b = grab(ref.win);
        if (!a) return { kind: 'error', text: 'No canvas found. Check that setup() calls createCanvas().' };
        if (a.logicalW !== b.logicalW || a.logicalH !== b.logicalH) {
          return {
            kind: 'size',
            text: `Your canvas is ${a.logicalW} by ${a.logicalH}. This task needs ${b.logicalW} by ${b.logicalH}. Check createCanvas().`
          };
        }
        const result = compare(a, b, opts);
        if (!worst || result.count > worst.result.count) worst = { result, a };
        if (result.ratio > opts.maxDifferent) { worstFrame = f; break; }
      }

      if (worstFrame === null) {
        return { kind: 'pass', secret: task.passCode, typeOn: task.typeOn };
      }
      return {
        kind: 'diff',
        frame: worstFrame,
        moving: frames.length > 1,
        percent: worst.result.ratio * 100,
        image: diffImage(worst.a, worst.result.diff)
      };
    } finally {
      cleanUp();
    }
  }

  // Student's canvas faded to grey, with differences in red.
  function diffImage(a, diff) {
    const c = document.createElement('canvas');
    c.width = a.w;
    c.height = a.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(a.w, a.h);
    for (let p = 0; p < a.w * a.h; p++) {
      const i = p * 4;
      if (diff[p]) {
        img.data[i] = 230; img.data[i + 1] = 30; img.data[i + 2] = 40; img.data[i + 3] = 255;
      } else {
        // Faded grey copy of the student's canvas, so only differences are red.
        const grey = 0.3 * a.data[i] + 0.59 * a.data[i + 1] + 0.11 * a.data[i + 2];
        const faded = 255 - (255 - grey) * 0.4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = faded;
        img.data[i + 3] = 255;
      }
    }
    // Thicken red marks so single pixels are visible.
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgb(230,30,40)';
    for (let y = 0; y < a.h; y += 2) {
      for (let x = 0; x < a.w; x += 2) {
        if (diff[y * a.w + x]) ctx.fillRect(x - 2, y - 2, 5, 5);
      }
    }
    c.style.width = (a.w / a.density) + 'px';
    c.style.maxWidth = '100%';
    return c;
  }

  // ---------- Interface ----------

  const CSS = `
    :host { all: initial; display: block; margin: 16px 0 24px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1d2733; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; max-width: 720px; padding: 12px 14px; border: 2px solid #1768c4; border-radius: 10px; background: #f2f7fd; }
    .title { font-weight: 700; font-size: 16px; color: #0f4c94; margin-right: 4px; }
    select, button { font: inherit; font-size: 15px; border-radius: 8px; padding: 8px 10px; }
    select { border: 1px solid #8fb3df; background: #fff; color: #1d2733; max-width: 100%; }
    button { border: 0; background: #1768c4; color: #fff; font-weight: 700; cursor: pointer; }
    button:hover { background: #0f4c94; }
    button:disabled { background: #8fa6c2; cursor: wait; }
    button:focus-visible, select:focus-visible { outline: 3px solid #f2a900; outline-offset: 2px; }
    .keylabel { font-size: 15px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .key { width: 3.2em; font: inherit; font-size: 18px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; text-align: center; padding: 6px; border: 1px solid #8fb3df; border-radius: 8px; }
    .key:focus-visible { outline: 3px solid #f2a900; outline-offset: 2px; }
    .result { flex-basis: 100%; font-size: 15px; line-height: 1.45; }
    .result:empty { display: none; }
    .pass { padding: 10px 12px; border-radius: 8px; background: #e3f5e8; border: 1px solid #5cb578; }
    .code { display: inline-block; margin: 4px 0; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #12602f; }
    .fail { padding: 10px 12px; border-radius: 8px; background: #fdecec; border: 1px solid #e08585; }
    .note { padding: 10px 12px; border-radius: 8px; background: #fff6dd; border: 1px solid #e3c25a; }
    .diff { margin-top: 8px; display: block; border: 1px solid #e08585; border-radius: 4px; }
  `;

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'wt-checker';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="bar" role="region" aria-label="Check my work">
        <span class="title">Check my work</span>
        <label><span style="position:absolute;left:-9999px">Task</span><select disabled><option>Loading tasks\u2026</option></select></label>
        <label class="keylabel">Key <input class="key" maxlength="2" autocomplete="off" spellcheck="false" placeholder="KT"></label>
        <button type="button" disabled>Check</button>
        <div class="result" aria-live="polite"></div>
      </div>`;
    ui = {
      host,
      select: root.querySelector('select'),
      key: root.querySelector('.key'),
      button: root.querySelector('button'),
      result: root.querySelector('.result')
    };
    ui.button.addEventListener('click', onCheck);
    ui.key.addEventListener('keydown', (e) => { if (e.key === 'Enter') onCheck(); });
    placeUi();
  }

  // Keep the bar right after the canvas (p5 adds the canvas after load).
  function placeUi() {
    const canvas = document.querySelector('canvas');
    const target = canvas ? canvas : null;
    if (target && target.nextSibling !== ui.host) {
      target.insertAdjacentElement('afterend', ui.host);
    } else if (!target && !ui.host.isConnected) {
      document.body.appendChild(ui.host);
    }
  }

  function fillTaskList() {
    if (!ui || !lesson) return;
    ui.select.innerHTML = '';
    for (const [i, t] of lesson.tasks.entries()) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${t.page} ${t.name}`;
      ui.select.appendChild(o);
    }
    ui.select.disabled = false;
    ui.button.disabled = false;
  }

  function show(html, extra) {
    ui.result.innerHTML = html;
    if (extra) ui.result.appendChild(extra);
  }

  async function onCheck() {
    const task = lesson.tasks[Number(ui.select.value)];
    ui.button.disabled = true;
    ui.button.textContent = 'Checking\u2026';
    show('');
    try {
      const r = await checkTask(task);
      if (r.kind === 'pass') {
        const key = cleanKey(ui.key.value);
        if (key) {
          ui.key.value = key;
          show(`<div class="pass">It matches. Your unlock code for key ${key}:<br><span class="code">${keyedCode(r.secret, key)}</span><br>In Moodle, type it in <strong>${escapeHtml(r.typeOn)}</strong>.</div>`);
        } else {
          show(`<div class="pass">It matches. To get your unlock code: in Moodle, open <strong>${escapeHtml(r.typeOn)}</strong>. Type the 2-letter key it shows in the <strong>Key</strong> box here, then click <strong>Check</strong> again.</div>`);
          ui.key.focus();
        }
      } else if (r.kind === 'diff') {
        const when = r.moving ? ` at frame ${r.frame}` : '';
        const box = document.createElement('div');
        box.className = 'fail';
        box.innerHTML = `Not quite${when}. The red parts are different from the task. Compare them with the task page, fix your code, save, and check again.`;
        r.image.className = 'diff';
        r.image.setAttribute('role', 'img');
        r.image.setAttribute('aria-label', 'Your canvas, with the different parts in red');
        box.appendChild(r.image);
        show('', box);
      } else if (r.kind === 'setup') {
        show(`<div class="note">${escapeHtml(r.text)}</div>`);
      } else {
        show(`<div class="fail">${escapeHtml(r.text)}</div>`);
      }
    } catch (err) {
      show(`<div class="note">The check could not run (${escapeHtml(String(err && err.message || err))}). Tell your Code Mentor.</div>`);
    } finally {
      ui.button.disabled = false;
      ui.button.textContent = 'Check';
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- Start ----------

  function start() {
    findScripts();
    buildUi();
    // p5 creates the canvas after load; move the bar under it.
    let tries = 0;
    const timer = setInterval(() => { placeUi(); if (++tries > 40 || document.querySelector('canvas')) clearInterval(timer); }, 100);

    if (!lessonCode) {
      ui.select.innerHTML = '<option>No lesson file found</option>';
      return;
    }
    const s = document.createElement('script');
    s.src = BASE + 'tasks/' + lessonCode + '.js';
    s.onerror = () => {
      ui.select.innerHTML = '<option>No checks for this lesson yet</option>';
    };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
