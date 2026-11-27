/* ==========================================================================
   NEREVAR FM — логика панели: окна, закреплённые места, две файловые
   панели, файловые операции, загрузка/скачивание, просмотр, скины.
   Понадобился только браузер и server.py — никаких библиотек.

   Структура файла:
     1.  конфиг и хелперы
     2.  API (токен, запросы)
     3.  диалоги (confirm / prompt / message)
     4.  менеджер окон (перетаскивание, размер, таскбар, раскладка)
     5.  меню
     6.  скин и тема
     7.  вход (пароль)
     8.  закреплённые места
     9.  панели: список, навигация, выделение, сортировка
    10.  файловые операции: копировать/перенести/удалить/переименовать
    11.  перетаскивание и загрузка файлов
    12.  просмотрщик (F3)
    13.  клавиатура, часы, статусбар, запуск
   ========================================================================== */
(function () {
'use strict';

/* ===== 1. КОНФИГ И ХЕЛПЕРЫ ============================================= */
const C = window.CONFIG || {};
const FM = C.fm || {};
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const LS = 'nerevar-fm.';

function store(key, val) { try { localStorage.setItem(LS + key, val); } catch (e) {} }
function read(key, dflt) { try { const v = localStorage.getItem(LS + key); return v === null ? dflt : v; } catch (e) { return dflt; } }

const IMG_EXT = ['png','jpg','jpeg','gif','webp','bmp','avif','apng','ico'];
const VIDEO_EXT = ['mp4','m4v','webm','ogv','mov','mkv','avi','wmv','flv','3gp','mpeg','mpg'];
const AUDIO_EXT = ['mp3','wav','ogg','oga','opus','flac','m4a','aac','wma','mid','midi','aiff','aif','amr'];
// Расширения — только подсказка. Настоящий тип определяем по содержимому
// (см. looksLikeText), поэтому файлы вроде .jsonc, .json5, .env, .properties,
// .cnf, .toml, .hcl или вообще без расширения открываются как текст.
const TEXT_EXT = ['txt','text','md','markdown','log','conf','cfg','cnf','config','ini','env','rc',
  'json','jsonc','json5','jsonl','ndjson','js','mjs','cjs','ts','tsx','jsx','css','scss','less','sass',
  'html','htm','xml','xsd','xsl','xslt','dtd','svg','yml','yaml','toml','properties','editorconfig',
  'py','sh','bash','zsh','fish','c','h','cpp','hpp','cc','java','php','rb','go','rs','sql','swift',
  'kt','kts','scala','lua','pl','r','dart','ex','exs','erl','hs','clj','groovy','gradle','vue','svelte',
  'graphql','gql','proto','textproto','csv','tsv','diff','patch','rej','orig','desktop','service',
  'socket','timer','mount','target','rules','list','tex','asc','adoc','asciidoc','rst','org','nfo',
  'diz','srt','vtt','ics','vcf','reg','inf','url','mk','cmake','ninja','bazel','bzl','tf','tfvars',
  'hcl','nix','vim','el','asm','bat','cmd','ps1','awk','lock','sum','mod','pem','pub','key','csr'];

const SNIFF_LIMIT = 64 * 1024;   // сколько байт проверяем перед решением «текст/бинарник»

function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }

function fmtSize(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
// Очередь передач: по строке на файл, плюс общий индикатор сверху.
// Загрузка идёт кусками через /api/upload/chunk, скачивание — потоком fetch().
const xfer = {
  items: new Map(), timer: null,
  nextId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
  start(id, title, total, kind) {
    clearTimeout(this.timer);
    const it = { id: id, title: title, loaded: 0, total: total || 0,
      kind: kind || 'transfer', paused: false, cancel: null, onPause: null, onResume: null };
    this.items.set(id, it);
    const row = document.createElement('div');
    row.className = 'xrow'; row.dataset.xferId = id;
    row.innerHTML = '<span class="xname"></span><span class="xpct"></span>' +
      '<span class="xinfo"></span><span class="xbtns">' +
      '<button class="xbtn" data-xfer-act="pause">Pause</button>' +
      '<button class="xbtn" data-xfer-act="cancel">Cancel</button></span>';
    $('.xname', row).textContent = title;
    const list = $('#xferList');
    if (list) list.appendChild(row);
    it.row = row;
    this.render();
    return it;
  },
  get(id) { return this.items.get(id) || null; },
  update(id, loaded, total) {
    const it = this.items.get(id);
    if (!it) return;
    it.loaded = loaded || 0;
    if (total) it.total = total;
    this.render();
  },
  finish(id) {
    const it = this.items.get(id);
    if (it && it.row && it.row.parentNode) it.row.parentNode.removeChild(it.row);
    this.items.delete(id);
    if (this.items.size) { this.render(); return; }
    this.timer = setTimeout(() => {
      const el = $('#xfer');
      if (el && !this.items.size) el.hidden = true;
    }, 800);
  },
  setPaused(id, paused) {
    const it = this.items.get(id);
    if (!it) return;
    it.paused = paused;
    if (paused && it.onPause) it.onPause();
    if (!paused && it.onResume) it.onResume();
    this.render();
  },
  cancel(id) {
    const it = this.items.get(id);
    if (!it) return;
    if (it.cancel) { try { it.cancel(); } catch (e) {} }
    this.finish(id);
  },
  render() {
    const el = $('#xfer');
    if (!el) return;
    const list = Array.from(this.items.values());
    el.hidden = !list.length;
    if (!list.length) return;
    let loaded = 0, total = 0;
    list.forEach(it => {
      loaded += it.loaded; total += it.total;
      if (!it.row) return;
      const pct = it.total ? Math.min(100, Math.round(it.loaded / it.total * 100)) : 0;
      $('.xpct', it.row).textContent = (it.paused ? '❚❚ ' : '') + pct + '%';
      $('.xinfo', it.row).textContent = fmtSize(it.loaded) + (it.total ? ' / ' + fmtSize(it.total) : '') +
        (it.paused ? ' · paused' : '');
      $('[data-xfer-act="pause"]', it.row).textContent = it.paused ? 'Resume' : 'Pause';
    });
    const pct = total ? Math.min(100, Math.round(loaded / total * 100)) : 0;
    $('#xferTitle').textContent = list.length === 1 ? list[0].title : list.length + ' transfers';
    $('#xferFill').style.width = pct + '%';
    $('#xferPct').textContent = pct + '%';
    $('#xferInfo').textContent = fmtSize(loaded) + (total ? ' / ' + fmtSize(total) : '');
  }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-xfer-act]');
  if (!b) return;
  const row = b.closest('[data-xfer-id]');
  if (!row) return;
  const id = row.dataset.xferId, it = xfer.get(id);
  if (!it) return;
  e.stopPropagation();
  if (b.dataset.xferAct === 'cancel') xfer.cancel(id);
  else if (b.dataset.xferAct === 'pause') xfer.setPaused(id, !it.paused);
});

function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtTs(ts) {
  if (typeof ts !== 'number') return String(ts || '');
  return fmtDate(ts > 1e12 ? ts / 1000 : ts);   // сервер может прислать секунды или мс
}
function joinPath(dir, name) {
  dir = (dir || '/').replace(/\/+$/, '') || '/';
  return (dir === '/' ? '' : dir) + '/' + name;
}
function parentOf(p) {
  if (!p || p === '/') return null;
  const s = p.replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}
function baseName(p) {
  const s = (p || '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  const b = i < 0 ? s : s.slice(i + 1);
  return b || '/';
}
function cleanName(s) {
  return String(s || '').replace(/[\/\\]/g, '').replace(/^\.+$/, '').trim();
}

/* ===== 2. API ========================================================== */
let TOKEN = (function () { try { return sessionStorage.getItem(LS + 'token') || ''; } catch (e) { return ''; } })();
let ROLE = (function () { try { return sessionStorage.getItem(LS + 'role') || 'admin'; } catch (e) { return 'admin'; } })();
let READ_ONLY = false, SESSION_TTL = 0, SERVER_VERSION = '', FTP_PASSIVE = '';
// действия, которые меняют состояние сервера: в режиме view их не вызываем
const MUTATING = new Set(['mkdir', 'newfile', 'rename', 'batch', 'delete', 'paste', 'undo',
  'redo', 'upload', 'pin', 'toother', 'moveother', 'touch', 'chmod', 'archiveCreate',
  'archiveExtract', 'trashRestore', 'trashPurge', 'trashsel', 'saveText', 'saveAs']);
function readOnlyMode() { return READ_ONLY || ROLE === 'view'; }
function blockMutating() { status('Read-only mode: changes are disabled', true); return false; }
function canMutate() { return !readOnlyMode() || blockMutating(); }

function apiUrl(path, extra) {
  const u = new URL(path, location.origin);
  if (TOKEN) u.searchParams.set('token', TOKEN);
  if (extra) Object.keys(extra).forEach(k => u.searchParams.set(k, extra[k]));
  return u.toString();
}

async function api(path, opts) {
  opts = opts || {};
  const url = new URL(path, location.origin);
  if (TOKEN) url.searchParams.set('token', TOKEN);
  const headers = Object.assign({}, opts.headers);
  if (TOKEN) headers['X-Auth-Token'] = TOKEN;
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  let res;
  try { res = await fetch(url.toString(), Object.assign({}, opts, { headers: headers })); }
  catch (e) { throw new Error('host unreachable'); }
  if (res.status === 401) { showLogin('Session expired — enter the password again'); throw new Error('unauthorized'); }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('json') >= 0) { try { data = await res.json(); } catch (e) {} }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

/* ===== 3. ДИАЛОГИ ====================================================== */
let dlgResolve = null;
function dlgOpen(o) {
  return new Promise(res => {
    dlgResolve = res;
    $('#dlgTitle').textContent = o.title || 'Message';
    $('#dlgText').textContent = o.text || '';
    const f = $('#dlgField'), inp = $('#dlgInput');
    if (o.input === undefined || o.input === null) { f.hidden = true; }
    else { f.hidden = false; $('#dlgLabel').textContent = o.label || 'Name'; inp.value = o.input === undefined ? '' : o.input; }
    $('#dlgErr').textContent = o.err || '';
    $('#dlgOk').textContent = o.ok || 'OK';
    $('#dlgCancel').textContent = o.cancel || 'Cancel';
    $('#dlgCancel').hidden = o.cancel === false;
    openWin('winDlg', true);
    setTimeout(() => {
      if (f.hidden) { $('#dlgOk').focus(); }
      else { inp.focus(); inp.select(); }
    }, 0);
  });
}
function dlgClose(v) {
  if (!dlgResolve) { hideWin('winDlg'); return; }
  const r = dlgResolve; dlgResolve = null;
  hideWin('winDlg');
  r(v);
}
const confirmBox = (text, title) => dlgOpen({ title: title || 'Confirm', text: text, ok: 'Yes', cancel: 'No' });
const promptBox = (text, value, title) => dlgOpen({ title: title || 'Name', text: text, input: value === undefined ? '' : value });

$('#dlgOk').addEventListener('click', () => dlgClose($('#dlgField').hidden ? true : ($('#dlgInput').value || null)));
$('#dlgCancel').addEventListener('click', () => dlgClose(null));
$('#dlgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); dlgClose($('#dlgInput').value || null); }
  if (e.key === 'Escape') { e.preventDefault(); dlgClose(null); }
});

function notice(text, title) { return dlgOpen({ title: title || 'Nerevar FM', text: text, cancel: false }); }

/* ===== 4. МЕНЕДЖЕР ОКОН =============================================== */
const scene = $('#scene');
let zTop = 10;
const opened = {};   // id -> true (вспомогательное окно открыто)

function rectOf(el) {
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}
function saveLayout() {
  if (C.rememberLayout === false) return;
  const out = {};
  $$('.appwindow').forEach(el => {
    if (el.id === 'winFm' || el.id === 'winLogin' || el.id === 'winDlg') return;
    if (el.classList.contains('viewer-win')) return;   // окна просмотра не восстанавливаем
    if (el.hidden && !opened[el.id]) return;
    const r = rectOf(el);
    out[el.id] = { x: r.x, y: r.y, w: r.w, h: r.h, max: el.dataset.max === '1', open: !!opened[el.id] };
  });
  store('layout', JSON.stringify(out));
}
function loadLayout() {
  if (C.rememberLayout === false) return {};
  try { return JSON.parse(read('layout', '{}')) || {}; } catch (e) { return {}; }
}

function placeWin(el, w, h) {
  const sw = scene.clientWidth, sh = scene.clientHeight;
  w = Math.min(w || 400, sw - 10);
  h = Math.min(h || 300, sh - 10);
  let x = Math.max(5, Math.round((sw - w) / 2)), y = Math.max(5, Math.round((sh - h) / 3));
  // каскад: объезжаем открытые окна
  let guard = 0;
  while (guard++ < 40) {
    const hit = $$('.appwindow').some(o => {
      if (o.hidden || o === el || o.id === 'winFm') return false;
      return !(x + w < o.offsetLeft || o.offsetLeft + o.offsetWidth < x ||
               y + h < o.offsetTop || o.offsetTop + o.offsetHeight < y);
    });
    if (!hit) break;
    x += 22; y += 22;
    if (x + w > sw) x = Math.max(5, sw - w - 10);
    if (y + h > sh) y = Math.max(5, 5);
  }
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}

function focusWin(id) {
  const el = document.getElementById(id);
  if (!el || el.hidden) return;
  // оболочка файлового менеджера не участвует в z-порядке: она всегда
  // занимает экран, а Viewer/Help/Places/диалоги плавают поверх неё
  if (id === 'winFm') return;
  $$('.appwindow').forEach(w => w.classList.remove('active'));
  el.classList.add('active');
  el.style.zIndex = ++zTop;
}
function openWin(id, keepLayout) {
  const el = document.getElementById(id);
  if (!el) return;
  opened[id] = true;
  el.hidden = false;
  if (id !== 'winFm') {
    if (!keepLayout) {
      const L = loadLayout()[id];
      if (L && L.x !== undefined && (el.style.left === '' || !el.dataset.placed)) {
        const sw = scene.clientWidth, sh = scene.clientHeight;
        el.style.left = Math.max(0, Math.min(L.x, sw - 60)) + 'px';
        el.style.top = Math.max(0, Math.min(L.y, sh - 40)) + 'px';
        el.style.width = Math.min(L.w || 400, sw) + 'px';
        el.style.height = Math.min(L.h || 300, sh) + 'px';
        el.dataset.placed = '1';
        if (L.max === '1') maximize(el, true);
      }
    }
    if (!el.style.left) {
      if (id === 'winDlg') {
        el.style.width = '380px';
        el.style.height = 'auto';
        placeWin(el, 380, el.offsetHeight || 180);
      } else {
        placeWin(el, parseInt(el.style.width, 10) || 500, parseInt(el.style.height, 10) || 360);
      }
    }
  }
  focusWin(id);
}
function hideWin(id) {
  const el = document.getElementById(id);
  if (!el) return;
  pauseViewerMedia(viewers.get(id));
  el.hidden = true;
  if (el.classList.contains('active')) el.classList.remove('active');
}
function closeWin(id) {
  const v = viewers.get(id);
  if (v && v.dirty) {
    confirmBox('Discard unsaved changes in ' + baseName(v.path) + '?', 'Viewer').then(ok => {
      if (!ok) return;
      v.dirty = false;
      clearDraft(v);
      updateViewerUI(v);
      closeWin(id);
    });
    return;
  }
  if (v) stopViewerMedia(v);
  opened[id] = false; hideWin(id); saveLayout();
}

function maximize(el, on) {
  if (on) {
    if (!el.dataset.prev) {
      const r = rectOf(el);
      el.dataset.prev = JSON.stringify(r);
    }
    el.dataset.max = '1';
    el.style.left = '0px'; el.style.top = '0px';
    el.style.width = scene.clientWidth + 'px'; el.style.height = scene.clientHeight + 'px';
  } else {
    el.dataset.max = '0';
    try {
      const r = JSON.parse(el.dataset.prev || 'null');
      if (r) { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; }
    } catch (e) {}
  }
}

/* --- перетаскивание за заголовок и изменение размера --------------------- */
function wireWindow(el) {
  if (el.dataset.chrome === '1') return;
  el.dataset.chrome = '1';
  if (el.id === 'winFm') return;   // оболочка не таскается, не ресайзится и не закрывается
  if (!el.querySelector('.resize-grip') && el.id !== 'winLogin') {
    const g = document.createElement('div');
    g.className = 'resize-grip';
    el.appendChild(g);
    g.addEventListener('pointerdown', e => startResize(e, el));
  }
  const bar = el.querySelector('.titlebar');
  if (bar) {
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.winbtn')) return;
      if (el.dataset.max === '1') return;
      focusWin(el.id);
      startDrag(e, el);
    });
    bar.addEventListener('dblclick', e => {
      if (e.target.closest('.winbtn')) return;
      if (el.id === 'winLogin') return;
      maximize(el, el.dataset.max !== '1');
      saveLayout();
    });
  }
  el.addEventListener('mousedown', () => focusWin(el.id));
  el.querySelectorAll('.winbtn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const a = b.dataset.win;
    if (a === 'close') { if (el.id === 'winDlg') dlgClose(null); else closeWin(el.id); }
    else if (a === 'min') hideWin(el.id);
    else if (a === 'max') maximize(el, el.dataset.max !== '1');
    saveLayout();
  }));
}
function initWindowChrome() { $$('.appwindow').forEach(wireWindow); }
function startDrag(e, el) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  const ox = el.offsetLeft, oy = el.offsetTop;
  const move = ev => {
    let x = ox + ev.clientX - sx, y = oy + ev.clientY - sy;
    x = Math.max(-el.offsetWidth + 80, Math.min(x, scene.clientWidth - 60));
    y = Math.max(0, Math.min(y, scene.clientHeight - 24));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    saveLayout();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function startResize(e, el) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault(); e.stopPropagation();
  focusWin(el.id);
  const sx = e.clientX, sy = e.clientY;
  const ow = el.offsetWidth, oh = el.offsetHeight;
  const move = ev => {
    el.style.width = Math.max(240, Math.min(ow + ev.clientX - sx, scene.clientWidth - el.offsetLeft)) + 'px';
    el.style.height = Math.max(120, Math.min(oh + ev.clientY - sy, scene.clientHeight - el.offsetTop)) + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    saveLayout();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ===== 5. МЕНЮ ========================================================= */
function closeMenus() { $$('.menuitem.open').forEach(m => m.classList.remove('open')); }
function initMenus() {
  // Делегирование на document: окна Viewer создаются клонированием разметки,
  // поэтому навешивать обработчики на каждый .menuitem заранее нельзя —
  // у клонов меню File/View просто не открывалось.
  document.addEventListener('click', e => {
    const mi = e.target.closest('.menuitem');
    if (!mi) return;
    if (e.target.closest('.menu')) return;   // клик по пункту меню — это action
    const was = mi.classList.contains('open');
    closeMenus();
    if (!was) mi.classList.add('open');
  });
  document.addEventListener('mouseover', e => {
    const mi = e.target.closest('.menuitem');
    if (!mi || !$('.menuitem.open')) return;
    if (mi.classList.contains('open')) return;
    closeMenus();
    mi.classList.add('open');
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('.menuitem')) closeMenus(); });
}
function runMenu(fn) { return function (e) { e.stopPropagation(); closeMenus(); fn(); }; }

/* ===== 6. СКИН И ТЕМА ================================================== */
function setSkin(s, save) {
  document.documentElement.setAttribute('data-skin', s);
  if (save !== false) store('skin', s);
  updateMarks();
}
function setTheme(t, save) {
  document.documentElement.setAttribute('data-theme', t);
  if (save !== false) store('theme', t);
  updateMarks();
}
function setWmTheme(w, save) {
  if (w !== 'gray' && w !== 'steel' && w !== 'dark') w = 'gray';
  if (w === 'gray') document.documentElement.removeAttribute('data-wmtheme');
  else document.documentElement.setAttribute('data-wmtheme', w);
  if (save !== false) store('wmtheme', w);
  updateMarks();
}
function updateMarks() {
  const skin = document.documentElement.getAttribute('data-skin');
  const theme = document.documentElement.getAttribute('data-theme');
  const marks = k => $$('[data-mark="' + k + '"]');
  const wm = document.documentElement.getAttribute('data-wmtheme') || 'gray';
  marks('skin').forEach(e => { e.textContent = skin === 'wm' ? '✓' : ''; });
  ['gray', 'steel', 'dark'].forEach(k => marks('wm' + k).forEach(e => { e.textContent = wm === k ? '✓' : ''; }));
  marks('theme').forEach(e => { e.textContent = theme === 'dark' ? '✓' : ''; });
  marks('hidden').forEach(e => { e.textContent = showHidden ? '✓' : ''; });
  ['sortname', 'sortsize', 'sortdate'].forEach(k => marks(k).forEach(e => { e.textContent = ''; }));
  const sk = sortKey === 'name' ? 'sortname' : sortKey === 'size' ? 'sortsize' : 'sortdate';
  marks(sk).forEach(e => { e.textContent = '✓'; });
  $$('.toolbar [data-act="hidden"]').forEach(b => b.classList.toggle('on', showHidden));
}

/* ===== 7. ВХОД ========================================================= */
async function doLogin() {
  const pass = $('#loginPass').value;
  const err = $('#loginErr');
  err.textContent = '';
  if (!pass) { err.textContent = 'Enter the password'; return; }
  const btn = $('#loginBtn'); btn.disabled = true;
  try {
    const url = new URL('/api/login', location.origin);
    const res = await fetch(url.toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    TOKEN = data.token;
    ROLE = (data && data.role) || 'admin';
    try {
      sessionStorage.setItem(LS + 'token', TOKEN);
      sessionStorage.setItem(LS + 'role', ROLE);
    } catch (e) {}
    $('#loginPass').value = '';
    hideWin('winLogin');
    afterLogin();
  } catch (e) {
    err.textContent = e.message === 'bad password' ? 'Wrong password' : e.message;
    $('#loginPass').select();
  } finally { btn.disabled = false; }
}
function showLogin(reason) {
  closeMenus();
  ROLE = 'admin'; READ_ONLY = false; updateModeBadge();
  openWin('winLogin', true);
  $('#loginErr').textContent = reason || '';
  // оболочка остаётся на экране, но под затемнением и без нажатий
  scene.classList.add('locked');
  allViewers().forEach(v => { stopViewerMedia(v); v.dirty = false; hideWin(v.id); opened[v.id] = false; });
  hideWin('winHelp'); hideWin('winPlaces');
  ['winSearch', 'winBatch', 'winArchive', 'winProps', 'winTrash', 'winAudit', 'winSettings']
    .forEach(id => { hideWin(id); opened[id] = false; });
  setTimeout(() => $('#loginPass').focus(), 30);
}
$('#loginBtn').addEventListener('click', doLogin);
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });

async function afterLogin() {
  openWin('winFm');
  scene.classList.remove('locked');
  hideWin('winLogin');
  await loadPlaces();
  await Promise.all([go('left', FM.leftPath || '/', true), go('right', FM.rightPath || '/', true)]);
  try {
    const st = await api('/api/status');
    if (st && st.ftp && st.ftp.port) FTP_PORT = st.ftp.port;
    if (st && st.ftp && st.ftp.user) FTP_USER = st.ftp.user;
    FTP_PASSIVE = (st && st.ftp && (st.ftp.passivePorts || st.ftp.passiveRange || st.ftp.passive)) || '';
    READ_ONLY = !!(st && st.readOnly);
    if (st && st.role) ROLE = st.role;
    if (st && st.sessionTtl !== undefined) SESSION_TTL = st.sessionTtl;
    if (st && st.version) SERVER_VERSION = st.version;
    try { sessionStorage.setItem(LS + 'role', ROLE); } catch (e) {}
  } catch (e) {}
  buildHelp();          // порт FTP известен только теперь — пересобрать справку
  updateModeBadge();
  updateStatus();
  renderSettingsInfo();
}

/* ===== 8. ЗАКРЕПЛЁННЫЕ МЕСТА ========================================== */
let PLACES = [];
let FTP_PORT = (C.ftp || {}).port || 2121;
let FTP_USER = (C.ftp || {}).user || 'nerevar';

async function loadPlaces() {
  try {
    const d = await api('/api/places');
    PLACES = (d && d.places) || [];
  } catch (e) { PLACES = []; }
  renderPlaces();
}
function renderPlaces() {
  $$('[data-places]').forEach(box => {
    box.textContent = '';
    PLACES.forEach(p => {
      const b = document.createElement('button');
      b.className = 'place';
      b.title = p.path;
      const i = document.createElement('span'); i.className = 'pi';
      i.textContent = (p.icon || p.name || '?').slice(0, 2);
      const t = document.createElement('span'); t.textContent = p.name;
      b.appendChild(i); b.appendChild(t);
      b.addEventListener('click', () => go(box.closest('.pane').dataset.side, p.path));
      box.appendChild(b);
    });
  });
  const L = panes.left, R = panes.right;
  markPlace('left', L && L.path); markPlace('right', R && R.path);
}
function markPlace(side, path) {
  const box = $('.pane[data-side="' + side + '"] [data-places]');
  if (!box) return;
  $$('.place', box).forEach((b, i) => b.classList.toggle('here', PLACES[i] && PLACES[i].path === path));
}
async function savePlaces() {
  const d = await api('/api/places', { method: 'POST', body: { places: PLACES } });
  PLACES = (d && d.places) || PLACES;
  renderPlaces();
}
async function pinCurrent() {
  if (!canMutate()) return;
  const p = active().path;
  if (PLACES.some(x => x.path === p)) { notice('Already pinned: ' + p); return; }
  const name = await promptBox('Name for this place:', baseName(p) || 'Root');
  if (name === null) return;
  PLACES.push({ name: cleanName(name) || baseName(p) || 'Root', path: p, icon: (cleanName(name)[0] || '/').toUpperCase() });
  try { await savePlaces(); } catch (e) { notice('Cannot save: ' + e.message, 'Places'); }
}

/* --- окно Places ------------------------------------------------------- */
let plSel = -1;
function renderPlacesWin() {
  const box = $('#placesList');
  box.textContent = '';
  PLACES.forEach((p, i) => {
    const r = document.createElement('div');
    r.className = 'plrow' + (i === plSel ? ' sel' : '');
    const ic = document.createElement('span'); ic.className = 'pi'; ic.textContent = (p.icon || '?').slice(0, 2);
    const n = document.createElement('span'); n.className = 'pn'; n.textContent = p.name;
    const pa = document.createElement('span'); pa.className = 'pp'; pa.textContent = p.path;
    r.appendChild(ic); r.appendChild(n); r.appendChild(pa);
    r.addEventListener('click', () => { plSel = i; renderPlacesWin(); });
    r.addEventListener('dblclick', () => { go(activeSide(), p.path); });
    box.appendChild(r);
  });
  if (!PLACES.length) {
    const e = document.createElement('div'); e.className = 'plrow'; e.textContent = 'No places pinned yet';
    box.appendChild(e);
  }
}
$('#plAdd').addEventListener('click', () => {
  const name = cleanName($('#plName').value), path = $('#plPath').value.trim();
  const err = $('#plErr'); err.textContent = '';
  if (!path || path[0] !== '/') { err.textContent = 'Path must be absolute, e.g. /mnt/data'; return; }
  if (PLACES.some(p => p.path === path)) { err.textContent = 'Already pinned'; return; }
  if (PLACES.length >= 64) { err.textContent = 'Too many places (max 64)'; return; }
  PLACES.push({ name: name || baseName(path) || 'Root', path: path, icon: (name[0] || '/').toUpperCase() });
  $('#plName').value = ''; $('#plPath').value = '';
  plSel = PLACES.length - 1;
  renderPlacesWin();
});
$('#plUp').addEventListener('click', () => {
  if (plSel > 0) { const t = PLACES[plSel]; PLACES[plSel] = PLACES[plSel - 1]; PLACES[plSel - 1] = t; plSel--; renderPlacesWin(); }
});
$('#plDown').addEventListener('click', () => {
  if (plSel >= 0 && plSel < PLACES.length - 1) { const t = PLACES[plSel]; PLACES[plSel] = PLACES[plSel + 1]; PLACES[plSel + 1] = t; plSel++; renderPlacesWin(); }
});
$('#plDel').addEventListener('click', () => {
  if (plSel >= 0 && plSel < PLACES.length) { PLACES.splice(plSel, 1); plSel = -1; renderPlacesWin(); }
});
$('#plSave').addEventListener('click', async () => {
  try { await savePlaces(); $('#plErr').textContent = 'Saved'; setTimeout(() => { $('#plErr').textContent = ''; }, 1200); }
  catch (e) { $('#plErr').textContent = 'Cannot save: ' + e.message; }
});

/* ===== 9. ПАНЕЛИ ======================================================= */
let showHidden = FM.showHidden !== false;
let sortKey = 'name', sortDir = 1;
let activeSide = 'left';
const clip = { mode: null, items: [] };   // буфер обмена: cut | copy

const panes = {
  left:  { side: 'left',  path: '/', entries: [], sel: new Set(), cursor: null, filter: '', hist: [], back: [], fwd: [], navClickAt: 0 },
  right: { side: 'right', path: '/', entries: [], sel: new Set(), cursor: null, filter: '', hist: [], back: [], fwd: [], navClickAt: 0 }
};
const active = () => panes[activeSide];
const other = () => panes[activeSide === 'left' ? 'right' : 'left'];

function paneEl(side) { return $('.pane[data-side="' + side + '"]'); }

async function go(side, path, silent, keepHistory) {
  const p = panes[side];
  if (!path) return;
  let d;
  try { d = await api('/api/list?path=' + encodeURIComponent(path)); }
  catch (e) {
    if (e.message === 'unauthorized') return;
    if (!silent) status('Cannot open ' + path + ': ' + e.message, true);
    return;
  }
  if (!keepHistory && p.path !== path && p.path) {
    p.back.push(p.path);
    if (p.back.length > 40) p.back.shift();
    p.fwd = [];
  }
  p.path = d.path;
  p.entries = d.entries || [];
  p.free = d.free; p.total = d.total;
  p.sel = new Set(); p.cursor = null;
  renderPane(side);
  updateStatus();
}
function navBack(side) {
  const p = panes[side];
  if (!p.back.length) return;
  const prev = p.back.pop();
  p.fwd.push(p.path);
  go(side, prev, false, true);
}
function navForward(side) {
  const p = panes[side];
  if (!p.fwd.length) return;
  const next = p.fwd.pop();
  p.back.push(p.path);
  go(side, next, false, true);
}
async function refresh(side) {
  const p = panes[side];
  const keep = new Set(p.sel);
  await go(side, p.path, true);
  panes[side].sel = new Set(Array.prototype.filter.call(keep, n => panes[side].entries.some(e => e.name === n)));
  renderPane(side);
}
const refreshBoth = () => Promise.all([refresh('left'), refresh('right')]);

function visibleEntries(p) {
  let list = p.entries.slice();
  if (!showHidden) list = list.filter(e => !e.hidden);
  // фильтр панели влияет и на строки, и на счётчик, и на диапазоны выделения
  if (p.filter) {
    const q = p.filter.toLowerCase();
    list = list.filter(e => e.name.toLowerCase().indexOf(q) >= 0);
  }
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    size: (a, b) => a.size - b.size,
    date: (a, b) => a.mtime - b.mtime
  }[sortKey] || null;
  list.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    if (cmp && sortKey !== 'name') { const r = cmp(a, b); if (r) return r * sortDir; }
    const r = cmp ? cmp(a, b) : 0;
    return (r || 0) * sortDir;
  });
  return list;
}

function renderPane(side) {
  const p = panes[side], el = paneEl(side);
  if (!el) return;
  el.classList.toggle('focused', side === activeSide);
  const inp = $('[data-path]', el);
  if (document.activeElement !== inp) inp.value = p.path;
  const fi = $('[data-filter]', el);
  if (fi && document.activeElement !== fi && fi.value !== p.filter) fi.value = p.filter;
  const backBtn = $('[data-nav="back"]', el), fwdBtn = $('[data-nav="forward"]', el);
  if (backBtn) backBtn.disabled = !p.back.length;
  if (fwdBtn) fwdBtn.disabled = !p.fwd.length;
  $('[data-act="up"]', el).disabled = p.path === '/';
  const box = $('[data-list]', el);
  box.textContent = '';
  const frag = document.createDocumentFragment();

  if (p.path !== '/') {
    const r = document.createElement('div');
    r.className = 'row' + (p.sel.has('..') ? ' sel' : '');
    r.dataset.name = '..';
    r.title = 'Click to go up';
    const n = document.createElement('span'); n.className = 'n';
    const ic = document.createElement('i'); ic.className = 'ico dir';
    const t = document.createElement('span'); t.textContent = '..';
    n.appendChild(ic); n.appendChild(t);
    const s = document.createElement('span'); s.className = 'sz dim'; s.textContent = '<DIR>';
    const d = document.createElement('span'); d.className = 'dt dim'; d.textContent = '';
    r.appendChild(n); r.appendChild(s); r.appendChild(d);
    frag.appendChild(r);
  }

  visibleEntries(p).forEach(e => {
    const r = document.createElement('div');
    r.className = 'row' + (p.sel.has(e.name) ? ' sel' : '') + (clip.mode === 'cut' && clip.items.indexOf(joinPath(p.path, e.name)) >= 0 ? ' cut' : '');
    r.dataset.name = e.name;
    r.draggable = true;
    if (e.dir) r.title = 'Double-click to open — or click the folder icon';
    const n = document.createElement('span'); n.className = 'n';
    const ic = document.createElement('i'); ic.className = 'ico ' + (e.dir ? 'dir' : 'file');
    const t = document.createElement('span'); t.textContent = e.name;
    n.appendChild(ic); n.appendChild(t);
    const s = document.createElement('span'); s.className = 'sz' + (e.dir ? ' dim' : '');
    s.textContent = e.dir ? '<DIR>' : fmtSize(e.size);
    const d = document.createElement('span'); d.className = 'dt dim';
    d.textContent = fmtDate(e.mtime);
    r.appendChild(n); r.appendChild(s); r.appendChild(d);
    frag.appendChild(r);
  });
  box.appendChild(frag);

  const count = visibleEntries(p).length;
  $('[data-count]', el).textContent = count + (count === 1 ? ' item' : ' items') +
    (p.sel.size ? ', ' + p.sel.size + ' selected' : '');
  $('[data-free]', el).textContent = p.free ? (fmtSize(p.free) + ' free') : '';
  markPlace(side, p.path);
  const head = $$('.listhead span', el);
  head.forEach(h => h.classList.toggle('on', h.dataset.sort === sortKey));
}

function renderPanes() { renderPane('left'); renderPane('right'); }
// выделение меняем на месте: если перерисовать список между первым и вторым
// кликом, браузер не сможет собрать dblclick по одной и той же строке
function refreshSelection(side) {
  const p = panes[side], el = paneEl(side);
  if (!el) return;
  $$('[data-list] .row', el).forEach(r => r.classList.toggle('sel', p.sel.has(r.dataset.name)));
  const count = visibleEntries(p).length;
  $('[data-count]', el).textContent = count + (count === 1 ? ' item' : ' items') +
    (p.sel.size ? ', ' + p.sel.size + ' selected' : '');
}
// только перевод фокуса: НЕ перерисовываем список, иначе mousedown успевает
// заменить строку до click/dblclick и мышь перестаёт работать
function setActiveSide(side) {
  if (activeSide === side) return;
  activeSide = side;
  $$('.pane').forEach(el => el.classList.toggle('focused', el.dataset.side === side));
  updateStatus();
}

function selectRow(side, name, mode) {
  const p = panes[side];
  if (mode === 'toggle') { p.sel.has(name) ? p.sel.delete(name) : p.sel.add(name); }
  else if (mode === 'range' && p.cursor) {
    const list = visibleEntries(p).map(e => e.name);
    if (p.path !== '/') list.unshift('..');
    let a = list.indexOf(p.cursor), b = list.indexOf(name);
    if (a < 0) a = 0; if (b < 0) b = 0;
    p.sel = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else { p.sel = new Set(name === null ? [] : [name]); }
  p.cursor = name;
  refreshSelection(side);
  updateStatus();
}
function selectAll(side) {
  const p = panes[side];
  p.sel = new Set(visibleEntries(p).map(e => e.name));
  renderPane(side); updateStatus();
}
function invertSel(side) {
  const p = panes[side];
  visibleEntries(p).forEach(e => { p.sel.has(e.name) ? p.sel.delete(e.name) : p.sel.add(e.name); });
  renderPane(side); updateStatus();
}
function moveCursor(side, delta, extend) {
  const p = panes[side];
  const list = visibleEntries(p).map(e => e.name);
  if (p.path !== '/') list.unshift('..');
  if (!list.length) return;
  let i = list.indexOf(p.cursor);
  i = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  const name = list[i];
  if (extend) { p.sel.add(name); p.cursor = name; }
  else { p.sel = new Set([name]); p.cursor = name; }
  refreshSelection(side);
  const row = $('.row[data-name="' + cssEsc(name) + '"]', paneEl(side));
  if (row) row.scrollIntoView({ block: 'nearest' });
  updateStatus();
}
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

function selPaths(side) {
  const p = panes[side];
  return Array.from(p.sel).filter(n => n !== '..').map(n => joinPath(p.path, n));
}

/* --- навигация по панелям ---------------------------------------------- */
function initPanes() {
  ['left', 'right'].forEach(side => {
    const el = paneEl(side);
    const body = $('[data-body]', el);
    const inp = $('[data-path]', el);

    el.addEventListener('mousedown', () => setActiveSide(side));
    $$('[data-nav]', el).forEach(b => b.addEventListener('click', () => {
      setActiveSide(side);
      if (b.dataset.nav === 'back') navBack(side); else navForward(side);
    }));

    body.addEventListener('click', e => {
      const row = e.target.closest('.row');
      setActiveSide(side);
      if (!row) { if (!e.ctrlKey && !e.metaKey) { panes[side].sel = new Set(); renderPane(side); updateStatus(); } return; }
      // мышь: «..» ведёт наверх сразу, клик по иконке папки — внутрь;
      // клик по имени выделяет, двойной клик открывает
      if (e.detail <= 1 && row.dataset.name === '..' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        panes[side].navClickAt = Date.now();
        go(side, parentOf(panes[side].path) || '/');
        return;
      }
      if (e.detail <= 1 && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.target.closest('.ico.dir')) {
        panes[side].navClickAt = Date.now();
        go(side, joinPath(panes[side].path, row.dataset.name));
        return;
      }
      const mode = (e.ctrlKey || e.metaKey) ? 'toggle' : (e.shiftKey ? 'range' : 'single');
      selectRow(side, row.dataset.name, mode);
    });
    body.addEventListener('dblclick', e => {
      const row = e.target.closest('.row');
      if (!row) return;
      // одиночный клик по «..»/иконке уже ушёл в другую папку: второй клик
      // двойного щелчка не должен открыть что-то в новом списке
      if (Date.now() - panes[side].navClickAt < 600) { panes[side].navClickAt = 0; return; }
      openEntry(side, row.dataset.name);
    });
    body.addEventListener('contextmenu', e => {
      const row = e.target.closest('.row');
      if (!row) return;
      e.preventDefault();
      setActiveSide(side);
      if (!panes[side].sel.has(row.dataset.name)) selectRow(side, row.dataset.name, 'single');
      showContextMenu(e.clientX, e.clientY);
    });

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); go(side, inp.value.trim()); inp.blur(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { inp.value = panes[side].path; inp.blur(); e.stopPropagation(); return; }
      // горячие клавиши должны работать даже когда строка пути в фокусе:
      // обычные символы оставляем вводу, а модификаторы/F-клавиши пускаем дальше
      const global = e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key);
      if (!global) e.stopPropagation();
    });

    /* --- быстрый фильтр в панели --------------------------------------- */
    const filterInp = $('[data-filter]', el);
    if (filterInp) {
      filterInp.addEventListener('input', () => {
        panes[side].filter = filterInp.value;
        panes[side].sel = new Set(); panes[side].cursor = null;
        renderPane(side); updateStatus();
      });
      filterInp.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          filterInp.value = ''; panes[side].filter = '';
          panes[side].sel = new Set(); panes[side].cursor = null;
          renderPane(side); updateStatus();
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const vis = visibleEntries(panes[side]);
          if (vis.length) { selectRow(side, vis[0].name, 'single'); $('[data-body]', el).focus(); }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) e.stopPropagation();
      });
      filterInp.addEventListener('mousedown', () => setActiveSide(side));
    }
    const fclear = $('[data-filter-clear]', el);
    if (fclear) fclear.addEventListener('click', () => {
      panes[side].filter = '';
      if (filterInp) filterInp.value = '';
      panes[side].sel = new Set(); panes[side].cursor = null;
      renderPane(side); updateStatus(); setActiveSide(side);
    });
    $$('.listhead span', el).forEach(h => h.addEventListener('click', () => {
      if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = 1; }
      updateMarks(); renderPanes();
    }));

    /* --- перетаскивание ------------------------------------------------ */
    body.addEventListener('dragstart', e => {
      const row = e.target.closest('.row');
      if (!row) { e.preventDefault(); return; }
      const name = row.dataset.name;
      if (name === '..') { e.preventDefault(); return; }
      if (!panes[side].sel.has(name)) selectRow(side, name, 'single');
      const names = Array.from(panes[side].sel);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', names.join('\n'));
      e.dataTransfer.setData('application/x-fm', JSON.stringify({ side: side, names: names }));
    });
    body.addEventListener('dragover', e => {
      const files = e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0;
      if (files) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dragover'); $('.dropmask', el).textContent = 'Drop here to UPLOAD'; return; }
      e.preventDefault();
      const copy = e.ctrlKey || e.metaKey;
      e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
      el.classList.add('dragover');
      $('.dropmask', el).textContent = copy ? 'Drop here to COPY' : 'Drop here to MOVE';
    });
    body.addEventListener('dragleave', e => { if (!body.contains(e.relatedTarget)) el.classList.remove('dragover'); });
    body.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files && files.length) { uploadDrop(e.dataTransfer, panes[side].path); return; }
      let payload = null;
      try { payload = JSON.parse(e.dataTransfer.getData('application/x-fm')); } catch (err) {}
      if (!payload || !payload.names) return;
      const dest = panes[side].path;
      const copy = e.ctrlKey || e.metaKey;
      transfer(payload.side, payload.names.map(n => joinPath(panes[payload.side].path, n)), dest, copy ? 'copy' : 'move');
    });
  });
  document.addEventListener('dragend', () => { $$('.pane').forEach(p => p.classList.remove('dragover')); });
}

function openEntry(side, name) {
  const p = panes[side];
  if (name === '..') { go(side, parentOf(p.path) || '/'); return; }
  const e = p.entries.find(x => x.name === name);
  if (!e) return;
  if (e.dir) go(side, joinPath(p.path, name));
  else viewFile(joinPath(p.path, name));
}

/* ===== 10. ФАЙЛОВЫЕ ОПЕРАЦИИ ========================================== */
function needSel() {
  const paths = selPaths(activeSide);
  if (!paths.length) { status('Nothing selected', true); return null; }
  return paths;
}
async function transfer(items, dest, mode) {
  if (!items.length || !canMutate()) return;
  const isMove = mode === 'move';
  try {
    const d = await api(isMove ? '/api/move' : '/api/copy', { method: 'POST', body: { items: items, dest: dest } });
    const errs = (d && d.errors) || [];
    clip.mode = null; clip.items = [];
    await refreshBoth();
    if (errs.length) {
      status((isMove ? 'Move: ' : 'Copy: ') + errs.length + ' failed', true);
      notice(errs.map(e => baseName(e.path) + ' — ' + e.error).join('\n'), isMove ? 'Move failed' : 'Copy failed');
    } else {
      status((isMove ? 'Moved: ' : 'Copied: ') + items.length + ' item(s) → ' + dest);
    }
  } catch (e) { status('Cannot ' + mode + ': ' + e.message, true); }
}
async function actCopy() { const p = needSel(); if (!p) return; clip.mode = 'copy'; clip.items = p; status('Copied to buffer: ' + p.length); renderPanes(); }
async function actCut()  { const p = needSel(); if (!p) return; clip.mode = 'cut';   clip.items = p; status('Cut to buffer: ' + p.length);   renderPanes(); }
async function actPaste() {
  if (!canMutate()) return;
  if (!clip.items.length) { status('Buffer is empty', true); return; }
  await transfer(clip.items, active().path, clip.mode === 'cut' ? 'move' : 'copy');
}
async function actUndo() {
  if (!canMutate()) return;
  try {
    const d = await api('/api/undo', { method: 'POST', body: {} });
    const errs = (d && d.errors) || [];
    await refreshBoth();
    if (errs.length) {
      status('Undo: ' + errs.length + ' failed', true);
      notice(errs.map(e => (e.path || baseName(e.path || '')) + ' — ' + e.error).join('\n'), 'Undo failed');
    } else {
      status('Undone: ' + ((d && d.label) || 'last action'));
    }
  } catch (e) { status('Cannot undo: ' + e.message, true); }
}
async function actDelete() {
  if (!canMutate()) return;
  const paths = needSel(); if (!paths) return;
  if (FM.confirmDelete !== false) {
    const ok = await confirmBox('Delete ' + paths.length + ' item(s)?\n\n' + paths.map(baseName).join(', '), 'Delete');
    if (!ok) return;
  }
  try {
    const d = await api('/api/delete', { method: 'POST', body: { items: paths } });
    const errs = (d && d.errors) || [];
    await refreshBoth();
    if (errs.length) { status('Delete: ' + errs.length + ' failed', true); notice(errs.map(e => baseName(e.path) + ' — ' + e.error).join('\n'), 'Delete failed'); }
    else status('Deleted: ' + ((d && d.deleted) || paths.length));
  } catch (e) { status('Cannot delete: ' + e.message, true); }
}
async function actRename() {
  if (!canMutate()) return;
  const paths = needSel(); if (!paths || paths.length !== 1) { status('Select exactly one item', true); return; }
  const from = paths[0];
  const to = await promptBox('New name:', baseName(from), 'Rename');
  if (to === null) return;
  const name = cleanName(to);
  if (!name || name === baseName(from)) return;
  try {
    await api('/api/rename', { method: 'POST', body: { from: from, to: joinPath(active().path, name) } });
    active().sel = new Set([name]);
    await refreshBoth();
    status('Renamed to ' + name);
  } catch (e) { status('Cannot rename: ' + e.message, true); }
}
async function actMkdir() {
  if (!canMutate()) return;
  const name = await promptBox('New folder name:', '', 'New folder');
  if (name === null) return;
  const n = cleanName(name);
  if (!n) return;
  try {
    await api('/api/mkdir', { method: 'POST', body: { path: joinPath(active().path, n) } });
    await refreshBoth();
    status('Folder created: ' + n);
  } catch (e) { status('Cannot create folder: ' + e.message, true); }
}
async function actNewFile() {
  if (!canMutate()) return;
  const name = await promptBox('New file name:', '', 'New file');
  if (name === null) return;
  const n = cleanName(name);
  if (!n) return;
  try {
    await api('/api/newfile', { method: 'POST', body: { path: joinPath(active().path, n) } });
    await refreshBoth();
    status('File created: ' + n);
  } catch (e) { status('Cannot create file: ' + e.message, true); }
}
/* Папки скачивать запрещено: ни в UI, ни на сервере. Список файлов
   берём из уже загруженного списка панели, чтобы не делать запрос
   к API для заведомо неподходящего пути. */
function downloadableSelection() {
  const p = panes[activeSide];
  const files = [], folders = [];
  Array.from(p.sel).filter(n => n !== '..').forEach(n => {
    const e = (p.entries || []).find(x => x.name === n);
    ((e && e.dir) ? folders : files).push(joinPath(p.path, n));
  });
  return { files: files, folders: folders };
}
function actDownload() {
  const sel = downloadableSelection();
  if (!sel.files.length) {
    status(sel.folders.length ? 'Folders cannot be downloaded — select files only' : 'Nothing selected', true);
    return;
  }
  const files = sel.files.slice(0, 12);
  let msg = 'Downloading ' + files.length + ' file(s)…';
  if (sel.files.length > files.length) msg += ' (first ' + files.length + ')';
  if (sel.folders.length) msg += ' Folders skipped: ' + sel.folders.length;
  status(msg, sel.folders.length > 0 || sel.files.length > files.length);
  files.forEach((p, i) => setTimeout(() => triggerDownload(p), i * 400));
}
async function triggerDownload(path, existingId) {
  const it = existingId ? xfer.get(existingId) :
    xfer.start(xfer.nextId('dl'), 'Downloading ' + baseName(path), 0, 'download');
  if (!it) return;
  const id = it.id;
  it.path = path; it.cancelled = false; it.restarting = false; it.loaded = 0;
  const controller = new AbortController();
  it.controller = controller;
  it.cancel = () => { it.cancelled = true; controller.abort(); };
  it.onPause = () => { it.restarting = true; controller.abort(); };
  it.onResume = () => { if (it.restarting) triggerDownload(path, id); };
  try {
    const res = await fetch(apiUrl('/api/download', { path: path }), {
      headers: TOKEN ? { 'X-Auth-Token': TOKEN } : {}, signal: controller.signal
    });
    if (res.status === 401) { showLogin('Session expired — enter the password again'); return; }
    if (!res.ok) {
      let err = '';
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) {
        try { err = (await res.json()).error || ''; } catch (e) {}
      }
      status('Cannot download ' + baseName(path) + ': ' + (err || ('HTTP ' + res.status)), true);
      return;
    }
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    if (total) xfer.update(id, 0, total);

    // Читаем поток кусками, чтобы показывать реальный прогресс, а не ждать
    // готового blob. В старых браузерах падаем обратно на res.blob().
    let blob;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        if (step.value && step.value.length) {
          chunks.push(step.value);
          loaded += step.value.length;
          xfer.update(id, loaded, total || loaded);
        }
      }
      blob = new Blob(chunks);
    } else {
      blob = await res.blob();
    }
    xfer.update(id, blob.size, blob.size || total);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName(path) || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    if (!it.restarting && !it.cancelled) status('Cannot download ' + baseName(path) + ': ' + e.message, true);
  } finally {
    if (!it.restarting) xfer.finish(id);
  }
}

/* ===== 11a. ОЧЕРЕДЬ ЗАГРУЗКИ (куски по 1 МиБ) ========================= */
const UPLOAD_CHUNK = 1024 * 1024;
const uploadQueue = [];
let uploadRunning = false;
const sleep = ms => new Promise(res => setTimeout(res, ms));
function uploadId() {
  try {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, b => ('0' + b.toString(16)).slice(-2)).join('');
  } catch (e) {
    return Date.now().toString(16) + Math.random().toString(16).slice(2);
  }
}
// Обёртка: каждому файлу — отдельная строка в очереди. rel — путь внутри
// перетащенной папки, сервер принимает безопасные подпути в name.
function uploadFiles(files, dir) {
  if (readOnlyMode()) { blockMutating(); return; }
  if (!files || !files.length) { runUploadQueue(); return; }
  Array.prototype.forEach.call(files, f => uploadQueue.push({ file: f, dir: dir, rel: f.rel || f.webkitRelativePath || f.name }));
  runUploadQueue();
}
async function runUploadQueue() {
  if (uploadRunning) return;
  uploadRunning = true;
  while (uploadQueue.length) {
    const job = uploadQueue.shift();
    try { await doChunkedUpload(job); }
    catch (e) { status('Upload failed: ' + (e.message || e), true); }
  }
  uploadRunning = false;
}
async function doChunkedUpload(job) {
  const file = job.file, dir = job.dir, name = job.rel;
  const id = xfer.nextId('up');
  const it = xfer.start(id, 'Uploading ' + (name || file.name), file.size || 0, 'upload');
  const uid = uploadId(), total = file.size || 0;
  it.cancelled = false;
  it.cancel = () => { it.cancelled = true; if (it.controller) it.controller.abort(); };
  let offset = 0, sent = false;
  it.resumePromise = null;
  it.onResume = () => {
    // после паузы уточняем, что реально попало на сервер
    it.resumePromise = (async () => {
      try {
        const r = await fetch(apiUrl('/api/upload/status', { uploadId: uid }), {
          headers: TOKEN ? { 'X-Auth-Token': TOKEN } : {}
        });
        if (r.ok) {
          const d = await r.json();
          if (d && typeof d.offset === 'number' && d.offset >= offset && d.offset <= total) offset = d.offset;
        }
      } catch (e) {}
    })();
  };
  try {
    const st = await fetch(apiUrl('/api/upload/status', { uploadId: uid }), {
      headers: TOKEN ? { 'X-Auth-Token': TOKEN } : {}
    });
    if (st.ok) {
      const d = await st.json();
      if (d && d.uploadId === uid && d.offset > 0 && d.offset <= total) offset = d.offset;
    }
    xfer.update(id, offset, total);
  } catch (e) {}
  while ((offset < total || !sent) && !it.cancelled) {
    while (it.paused && !it.cancelled) await sleep(200);
    if (it.resumePromise) { await it.resumePromise; it.resumePromise = null; }
    if (it.cancelled) break;
    sent = true;   // пустой файл тоже отправляем одним (пустым) куском
    const end = Math.min(offset + UPLOAD_CHUNK, total);
    const controller = new AbortController();
    it.controller = controller;
    try {
      const res = await fetch(apiUrl('/api/upload/chunk', {
        path: dir, uploadId: uid, offset: offset, total: total, name: name
      }), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/octet-stream' },
          TOKEN ? { 'X-Auth-Token': TOKEN } : {}),
        body: file.slice(offset, end), signal: controller.signal
      });
      if (res.status === 401) { showLogin('Session expired — enter the password again'); it.cancelled = true; break; }
      if (!res.ok) {
        let err = ''; try { err = ((await res.json()).error) || ''; } catch (e) {}
        throw new Error(err || ('HTTP ' + res.status));
      }
      const d = await res.json();
      if (d.complete) { offset = total; xfer.update(id, total, total); break; }
      offset = (d && typeof d.offset === 'number') ? d.offset : end;
      if (!total) break;
      xfer.update(id, offset, total);
    } catch (e) {
      if (it.cancelled || controller.signal.aborted) break;
      // сеть дрогнула — спрашиваем сервер, где он остановился, и продолжаем
      try {
        const st = await fetch(apiUrl('/api/upload/status', { uploadId: uid }), {
          headers: TOKEN ? { 'X-Auth-Token': TOKEN } : {}
        });
        if (st.ok) {
          const d = await st.json();
          if (d && typeof d.offset === 'number' && d.offset >= offset && d.offset <= total) { offset = d.offset; continue; }
        }
      } catch (e2) {}
      throw e;
    }
  }
  if (it.cancelled) {
    try {
      await fetch(apiUrl('/api/upload/cancel', { uploadId: uid }), {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' },
          TOKEN ? { 'X-Auth-Token': TOKEN } : {}), body: '{}'
      });
    } catch (e) {}
    xfer.finish(id);
    return;
  }
  xfer.update(id, total, total);
  await refreshBoth();
  status('Uploaded: ' + (name || file.name));
  setTimeout(() => xfer.finish(id), 400);
}

/* Перетаскивание файлов с диска: обходим entry-деревья, сохраняя rel. */
function entryFiles(entry, prefix, out) {
  return new Promise(resolve => {
    if (!entry) return resolve();
    if (entry.isFile) {
      entry.file(file => { file.rel = prefix + entry.name; out.push(file); resolve(); }, () => resolve());
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readMore = () => reader.readEntries(entries => {
        if (!entries.length) {
          Promise.all(all.map(sub => entryFiles(sub, prefix + entry.name + '/', out))).then(() => resolve());
          return;
        }
        Array.prototype.push.apply(all, entries);
        readMore();
      }, () => resolve());
      readMore();
      return;
    }
    resolve();
  });
}
async function uploadDrop(dt, dir) {
  const items = dt && dt.items;
  if (items && items.length && items[0].webkitGetAsEntry) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) await entryFiles(entry, '', out);
    }
    if (out.length) { uploadFiles(out, dir); return; }
  }
  uploadFiles(dt.files, dir);
}
$('#fileInput').addEventListener('change', e => {
  if (e.target.files.length) uploadFiles(e.target.files, active().path);
  e.target.value = '';
});

/* ===== 10a. ПОИСК, ПАКЕТ, АРХИВЫ, СВОЙСТВА =========================== */
async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  }
  // запасной путь для http:// и старых браузеров
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  return ok;
}
async function actCopyPath() {
  const p = needSel(); if (!p) return;
  const ok = await copyText(p.join('\n'));
  status(ok ? 'Copied path(s): ' + p.length : 'Cannot copy', !ok);
}
async function actCopyName() {
  const p = needSel(); if (!p) return;
  const ok = await copyText(p.map(baseName).join('\n'));
  status(ok ? 'Copied name(s): ' + p.length : 'Cannot copy', !ok);
}
async function actTouch() {
  const items = needSel(); if (!items || readOnlyMode()) { if (readOnlyMode()) blockMutating(); return; }
  try {
    const d = await api('/api/touch', { method: 'POST', body: { items: items, mtime: null, atime: null } });
    await refreshBoth();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + e.error).join('\n'), 'Touch failed');
    status('Touched: ' + ((d && d.touched) || items.length));
  } catch (e) { status('Cannot touch: ' + e.message, true); }
}
async function actChmod() {
  const items = needSel(); if (!items || readOnlyMode()) { if (readOnlyMode()) blockMutating(); return; }
  const mode = await promptBox('New mode (e.g. 0755):', '0755', 'Permissions');
  if (mode === null) return;
  if (!/^[0-7]{3,4}$/.test(mode.trim())) { status('Invalid mode', true); return; }
  try {
    const d = await api('/api/chmod', { method: 'POST',
      body: { items: items, mode: mode.trim().padStart(4, '0'), recursive: false } });
    await refreshBoth();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + e.error).join('\n'), 'Chmod failed');
    status('Changed: ' + ((d && d.changed) || items.length));
  } catch (e) { status('Cannot chmod: ' + e.message, true); }
}
async function actTrashSelection() {
  const items = needSel(); if (!items || readOnlyMode()) { if (readOnlyMode()) blockMutating(); return; }
  if (FM.confirmDelete !== false) {
    const ok = await confirmBox('Move ' + items.length + ' item(s) to trash?', 'Trash');
    if (!ok) return;
  }
  try {
    const d = await api('/api/delete', { method: 'POST', body: { items: items, trash: true } });
    await refreshBoth();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => baseName(e.path || '') + ' — ' + e.error).join('\n'), 'Trash failed');
    status('Trashed: ' + ((d && d.trashed) || items.length));
  } catch (e) { status('Cannot move to trash: ' + e.message, true); }
}

/* --- поиск -------------------------------------------------------------- */
let searchRows = [];
function openSearch() {
  $('#searchPath').value = active().path;
  $('#searchInfo').textContent = '';
  openWin('winSearch');
  $('#searchQ').focus();
}
async function runSearch() {
  const q = $('#searchQ').value.trim();
  if (!q) { status('Enter a search query', true); return; }
  const info = $('#searchInfo');
  info.textContent = 'Searching…';
  const qs = ['path=' + encodeURIComponent($('#searchPath').value.trim() || '/'),
    'q=' + encodeURIComponent(q),
    'mode=' + encodeURIComponent($('#searchMode').value),
    'regex=' + ($('#searchRegex').checked ? '1' : '0'),
    'hidden=' + ($('#searchHidden').checked ? '1' : '0'), 'limit=500'].join('&');
  try {
    const d = await api('/api/search?' + qs);
    searchRows = (d && d.results) || [];
    const box = $('#searchResults'); box.textContent = '';
    searchRows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'datarow four'; row.dataset.path = r.path; row.title = r.path;
      const p = document.createElement('span'); p.textContent = r.path;
      const s = document.createElement('span'); s.className = 'dim'; s.textContent = r.dir ? '<DIR>' : fmtSize(r.size);
      const t = document.createElement('span'); t.textContent = r.line ? 'line ' + r.line + ': ' + (r.text || '') : (r.name || baseName(r.path));
      const k = document.createElement('span'); k.className = 'dim'; k.textContent = r.dir ? 'dir' : baseName(r.path);
      row.appendChild(p); row.appendChild(s); row.appendChild(t); row.appendChild(k);
      box.appendChild(row);
    });
    if (!searchRows.length) {
      const e = document.createElement('div'); e.className = 'datarow simple dim';
      e.textContent = 'Nothing found'; box.appendChild(e);
    }
    info.textContent = searchRows.length + ' result(s)' + (d && d.truncated ? ' — truncated (limit 500)' : '');
  } catch (e) { info.textContent = 'Search failed: ' + e.message; status('Search failed: ' + e.message, true); }
}
async function openSearchResult(row) {
  const path = row.dataset.path;
  if (!path) return;
  const r = searchRows.find(x => x.path === path);
  if (!r || !r.dir) { viewFile(path); return; }
  // папку показываем в другой панели: переходим в родителя и выделяем её
  const side = activeSide === 'left' ? 'right' : 'left';
  await go(side, parentOf(path) || '/');
  const p = panes[side], name = baseName(path);
  if (p.entries.some(e => e.name === name)) { p.sel = new Set([name]); p.cursor = name; }
  renderPane(side); updateStatus();
}
document.addEventListener('dblclick', e => {
  const r = e.target.closest('#searchResults .datarow[data-path]');
  if (r) openSearchResult(r);
});
document.addEventListener('click', e => {
  const r = e.target.closest('#searchResults .datarow[data-path]');
  if (!r) return;
  $$('#searchResults .datarow').forEach(x => x.classList.remove('sel'));
  r.classList.add('sel');
});

/* --- пакетное переименование ------------------------------------------- */
function batchTargets() { return selPaths(activeSide); }
function batchNewName(name, i) {
  const pat = $('#batchPattern').value.trim();
  const ext = extOf(name), stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  if (pat) {
    const start = parseInt($('#batchStart').value, 10) || 0;
    return pat.replace(/\{n\}/g, String(start + i)).replace(/\{name\}/g, name)
      .replace(/\{stem\}/g, stem).replace(/\{ext\}/g, ext ? '.' + ext : '');
  }
  const find = $('#batchFind').value;
  const rep = $('#batchReplace').value;
  return find ? name.split(find).join(rep) : name;
}
function batchPlan() {
  return batchTargets().map((from, i) => {
    const name = baseName(from), to = joinPath(parentOf(from) || active().path, batchNewName(name, i));
    return { from: from, to: to, name: name, newName: baseName(to) };
  });
}
function renderBatchPreview() {
  const box = $('#batchPreview'); box.textContent = '';
  const plan = batchPlan();
  plan.forEach(x => {
    const r = document.createElement('div'); r.className = 'datarow two';
    const a = document.createElement('span'); a.textContent = x.name;
    const b = document.createElement('span'); b.textContent = (x.from === x.to ? '= ' : '→ ') + x.newName;
    if (x.from === x.to) b.className = 'dim';
    r.appendChild(a); r.appendChild(b); box.appendChild(r);
  });
  if (!plan.length) {
    const e = document.createElement('div'); e.className = 'datarow simple dim';
    e.textContent = 'Nothing selected'; box.appendChild(e);
  }
  $('#batchInfo').textContent = plan.length + ' item(s)';
}
function openBatch() {
  if (!batchTargets().length) { status('Nothing selected', true); return; }
  renderBatchPreview(); openWin('winBatch');
}
async function actBatchApply() {
  if (readOnlyMode()) { blockMutating(); return; }
  const items = batchPlan().filter(x => x.from !== x.to).map(x => ({ from: x.from, to: x.to }));
  if (!items.length) { status('No changes to apply', true); return; }
  try {
    const d = await api('/api/batchrename', { method: 'POST', body: { items: items } });
    await refreshBoth();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + e.error).join('\n'), 'Batch rename failed');
    status('Renamed: ' + ((d && d.renamed) || items.length));
  } catch (e) { status('Cannot batch rename: ' + e.message, true); }
}

/* --- архивы ------------------------------------------------------------- */
function openArchive() {
  const sel = selPaths(activeSide);
  $('#arcPath').value = sel.length === 1 ? sel[0] : '';
  $('#arcDest').value = other().path;
  const bn = baseName(active().path);
  $('#arcName').value = sel.length && bn && bn !== '/' ? bn + '.zip' : 'archive.zip';
  $('#arcList').textContent = ''; $('#arcInfo').textContent = '';
  openWin('winArchive');
}
async function archiveBrowse() {
  const path = $('#arcPath').value.trim() || selPaths(activeSide)[0];
  if (!path) { status('Choose an archive', true); return; }
  try {
    const d = await api('/api/archive/list?path=' + encodeURIComponent(path));
    const box = $('#arcList'); box.textContent = '';
    (d && d.entries || []).forEach(en => {
      const r = document.createElement('div'); r.className = 'datarow two';
      const a = document.createElement('span'); a.textContent = en.name;
      const b = document.createElement('span'); b.className = 'dim';
      b.textContent = en.dir ? '<DIR>' : fmtSize(en.size);
      r.appendChild(a); r.appendChild(b); box.appendChild(r);
    });
    if (!box.children.length) box.innerHTML = '<div class="datarow simple dim">Empty archive</div>';
    $('#arcInfo').textContent = (d && d.format ? d.format + ' · ' : '') + ((d && d.entries || []).length) + ' entries';
  } catch (e) { $('#arcInfo').textContent = 'Cannot list: ' + e.message; status('Cannot list archive: ' + e.message, true); }
}
async function archiveExtract() {
  if (readOnlyMode()) { blockMutating(); return; }
  const archive = $('#arcPath').value.trim() || selPaths(activeSide)[0];
  const dest = $('#arcDest').value.trim() || other().path;
  if (!archive) { status('Choose an archive', true); return; }
  try {
    const d = await api('/api/archive/extract', { method: 'POST',
      body: { archive: archive, dest: dest, overwrite: false } });
    await refreshBoth();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + (e.error || e)).join('\n'), 'Extract failed');
    status('Extracted: ' + ((d && d.extracted) || 0) + ' → ' + dest);
  } catch (e) { status('Cannot extract: ' + e.message, true); }
}
async function archiveCreate() {
  if (readOnlyMode()) { blockMutating(); return; }
  const items = selPaths(activeSide);
  if (!items.length) { status('Nothing selected', true); return; }
  const name = cleanName($('#arcName').value) || 'archive.zip';
  const dest = $('#arcDest').value.trim() || active().path;
  try {
    const d = await api('/api/archive/create', { method: 'POST',
      body: { items: items, dest: dest, name: name, format: $('#arcFormat').value } });
    await refreshBoth();
    $('#arcPath').value = (d && d.path) || joinPath(dest, name);
    status('Archive created: ' + baseName($('#arcPath').value));
  } catch (e) { status('Cannot create archive: ' + e.message, true); }
}

/* --- свойства и хэши ---------------------------------------------------- */
function openProps() {
  const sel = selPaths(activeSide);
  $('#propsPath').value = sel[0] || '';
  $('#propsText').value = '';
  openWin('winProps');
}
function propsOnePath() {
  return $('#propsPath').value.trim() || selPaths(activeSide)[0] || active().path;
}
function propsFormat(d) {
  return ['path', 'name', 'dir', 'size', 'mtime', 'ctime', 'mode', 'modeText', 'type',
    'mime', 'hidden', 'links', 'target'].filter(k => d[k] !== undefined && d[k] !== null)
    .map(k => k + ': ' + d[k]).join('\n');
}
async function propsGet() {
  try {
    const d = await api('/api/properties?path=' + encodeURIComponent(propsOnePath()));
    $('#propsText').value = propsFormat(d || {});
  } catch (e) { status('Cannot read properties: ' + e.message, true); }
}
async function propsHash(algo) {
  try {
    const d = await api('/api/hash?' + ['path=' + encodeURIComponent(propsOnePath()), 'algo=' + algo].join('&'));
    $('#propsText').value = algo.toUpperCase() + ' (' + (d && d.path || '') + ')\n' +
      (d && d.hash || '') + '\n' + fmtSize(d && d.size);
  } catch (e) { status('Cannot compute hash: ' + e.message, true); }
}
async function propsCompare() {
  const paths = selPaths(activeSide);
  if (paths.length !== 2) { status('Select exactly 2 files to compare', true); return; }
  try {
    const ds = await Promise.all(['sha256', 'md5'].map(algo => Promise.all(paths.map(p =>
      api('/api/hash?' + ['path=' + encodeURIComponent(p), 'algo=' + algo].join('&'))))));
    const out = paths.map((p, i) => p + '\n  SHA-256: ' + (ds[0][i] && ds[0][i].hash) +
      '\n  MD5:     ' + (ds[1][i] && ds[1][i].hash)).join('\n\n');
    const equal = ds[0][0] && ds[1][0] && ds[0][1] && ds[1][1] &&
      ds[0][0].hash === ds[0][1].hash && ds[1][0].hash === ds[1][1].hash;
    $('#propsText').value = out + '\n\n' + (equal ? 'EQUAL — same content' : 'NOT EQUAL');
  } catch (e) { status('Cannot compare: ' + e.message, true); }
}

/* --- корзина и история отмены ------------------------------------------ */
const trashSel = new Set();
let historyPick = null;
function openTrash() { openWin('winTrash'); loadTrash(); loadHistory(); }
async function loadTrash() {
  const box = $('#trashList'); box.textContent = ''; trashSel.clear();
  try {
    const d = await api('/api/trash?limit=200');
    (d && d.items || []).forEach(it => {
      const r = document.createElement('div'); r.className = 'datarow four';
      r.dataset.trashId = it.id; r.title = it.path || '';
      const a = document.createElement('span'); a.textContent = it.name || baseName(it.path || '');
      const b = document.createElement('span'); b.className = 'dim'; b.textContent = fmtSize(it.size);
      const c = document.createElement('span'); c.className = 'dim'; c.textContent = it.path || '';
      const e = document.createElement('span'); e.className = 'dim'; e.textContent = it.deletedAt ? fmtTs(it.deletedAt) : '';
      r.appendChild(a); r.appendChild(b); r.appendChild(c); r.appendChild(e); box.appendChild(r);
    });
    if (!box.children.length) box.innerHTML = '<div class="datarow simple dim">Trash is empty</div>';
  } catch (e) { box.innerHTML = '<div class="datarow simple dim">Cannot load: ' + e.message + '</div>'; }
}
async function loadHistory() {
  const box = $('#historyList'); box.textContent = ''; historyPick = null;
  try {
    const d = await api('/api/undo/history');
    const groups = [['undo', (d && d.items) || []], ['redo', (d && d.redo) || []]];
    groups.forEach(g => g[1].forEach(it => {
      const r = document.createElement('div'); r.className = 'datarow two';
      r.dataset.histId = it.id; r.dataset.histKind = g[0];
      const a = document.createElement('span'); a.textContent = (g[0] === 'redo' ? '↷ ' : '↶ ') + (it.label || '');
      const b = document.createElement('span'); b.className = 'dim'; b.textContent = fmtTs(it.time);
      r.appendChild(a); r.appendChild(b); box.appendChild(r);
    }));
    if (!box.children.length) box.innerHTML = '<div class="datarow simple dim">History is empty</div>';
  } catch (e) { box.innerHTML = '<div class="datarow simple dim">Cannot load: ' + e.message + '</div>'; }
}
document.addEventListener('click', e => {
  const t = e.target.closest('#trashList [data-trash-id]');
  if (t) {
    const id = t.dataset.trashId;
    if (e.ctrlKey || e.metaKey) { trashSel.has(id) ? trashSel.delete(id) : trashSel.add(id); }
    else { trashSel.clear(); trashSel.add(id); }
    $$('#trashList [data-trash-id]').forEach(r => r.classList.toggle('sel', trashSel.has(r.dataset.trashId)));
    return;
  }
  const h = e.target.closest('#historyList [data-hist-id]');
  if (h) {
    $$('#historyList [data-hist-id]').forEach(r => r.classList.remove('sel'));
    h.classList.add('sel'); historyPick = h;
  }
});
async function actRedo() {
  if (readOnlyMode()) { blockMutating(); return; }
  try {
    const d = await api('/api/redo', { method: 'POST', body: {} });
    await refreshBoth(); await loadHistory();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + e.error).join('\n'), 'Redo failed');
    status('Redone: ' + ((d && d.label) || 'last action'));
  } catch (e) { status('Cannot redo: ' + e.message, true); }
}
async function trashAction(kind) {
  if (readOnlyMode()) { blockMutating(); return; }
  const items = Array.from(trashSel);
  if (!items.length) { status('Select items in trash', true); return; }
  if (kind === 'purge') {
    const ok = await confirmBox('Purge ' + items.length + ' item(s)? This cannot be undone.', 'Trash');
    if (!ok) return;
  }
  try {
    const d = await api('/api/trash/' + kind, { method: 'POST', body: { items: items } });
    await refreshBoth(); await loadTrash(); await loadHistory();
    const errs = (d && d.errors) || [];
    if (errs.length) notice(errs.map(e => (e.path || '') + ' — ' + e.error).join('\n'), 'Trash failed');
    status((kind === 'restore' ? 'Restored: ' : 'Purged: ') +
      ((kind === 'restore' ? d && d.restored : d && d.purged) || items.length));
  } catch (e) { status('Cannot ' + kind + ': ' + e.message, true); }
}
async function historyAction(kind) {
  if (kind === 'redo') { await actRedo(); return; }
  await actUndo(); await loadHistory();
}

/* --- журнал доступа ----------------------------------------------------- */
function openAudit() { openWin('winAudit'); loadAudit(); }
async function loadAudit() {
  const box = $('#auditList'); box.textContent = '';
  try {
    const d = await api('/api/audit?limit=200');
    (d && d.items || []).forEach(it => {
      const r = document.createElement('div'); r.className = 'datarow four';
      const a = document.createElement('span'); a.textContent = fmtTs(it.ts);
      const b = document.createElement('span'); b.className = 'dim'; b.textContent = it.ip || '';
      const c = document.createElement('span'); c.textContent = it.action + ' ' + (it.path || '');
      const e = document.createElement('span'); e.className = 'dim'; e.textContent = it.status;
      r.appendChild(a); r.appendChild(b); r.appendChild(c); r.appendChild(e); box.appendChild(r);
    });
    if (!box.children.length) box.innerHTML = '<div class="datarow simple dim">No records</div>';
    $('#auditInfo').textContent = (d && d.items || []).length + ' record(s)';
  } catch (e) { $('#auditInfo').textContent = 'Cannot load: ' + e.message; }
}

/* --- настройки (только UI, сервер не трогаем) --------------------------- */
function updateModeBadge() {
  const el = $('#fmMode');
  if (!el) return;
  const show = readOnlyMode();
  el.hidden = !show;
  el.textContent = readOnlyMode() ? (READ_ONLY ? 'read-only' : 'view only') : '';
  el.title = ROLE === 'view' ? 'role: view' : 'role: admin';
}
function renderSettingsInfo() {
  const el = $('#setServerInfo');
  if (!el) return;
  el.textContent = 'Server' + (SERVER_VERSION ? ' ' + SERVER_VERSION : '') +
    (SESSION_TTL ? ' · session TTL ' + SESSION_TTL + ' s' : '') +
    ' · read-only: ' + (READ_ONLY ? 'yes' : 'no') + ' · role: ' + ROLE;
}
function openSettings() {
  $('#setFontSize').value = FM.listSize || 13;
  $('#setConfirm').checked = FM.confirmDelete !== false;
  $('#setHidden').checked = showHidden;
  $('#setRemember').checked = C.rememberLayout !== false;
  renderSettingsInfo();
  openWin('winSettings');
}
function initSettings() {
  $('#setFontSize').addEventListener('change', e => {
    const v = Math.max(10, Math.min(24, parseInt(e.target.value, 10) || 13));
    e.target.value = v; FM.listSize = v;
    let st = $('#rowFontStyle');
    if (!st) { st = document.createElement('style'); st.id = 'rowFontStyle'; document.head.appendChild(st); }
    st.textContent = '.row{font-size:' + v + 'px}';
    document.documentElement.style.setProperty('--row-size', v + 'px');
  });
  $('#setConfirm').addEventListener('change', e => { FM.confirmDelete = e.target.checked; });
  $('#setHidden').addEventListener('change', e => {
    showHidden = e.target.checked; store('hidden', showHidden ? '1' : '0'); updateMarks(); renderPanes();
  });
  $('#setRemember').addEventListener('change', e => { C.rememberLayout = e.target.checked; });
  $('#searchGo').addEventListener('click', runSearch);
  $('#searchQ').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  $('#batchRefresh').addEventListener('click', renderBatchPreview);
  $('#batchApply').addEventListener('click', actBatchApply);
  ['batchFind', 'batchReplace', 'batchPattern', 'batchStart'].forEach(id => {
    $('#' + id).addEventListener('input', renderBatchPreview);
  });
  $('#arcBrowse').addEventListener('click', archiveBrowse);
  $('#arcExtract').addEventListener('click', archiveExtract);
  $('#arcCreate').addEventListener('click', archiveCreate);
  $('#propsGet').addEventListener('click', propsGet);
  $('#propsSha').addEventListener('click', () => propsHash('sha256'));
  $('#propsMd5').addEventListener('click', () => propsHash('md5'));
  $('#propsCompare').addEventListener('click', propsCompare);
  $('#trashRefresh').addEventListener('click', () => { loadTrash(); loadHistory(); });
  $('#trashRestore').addEventListener('click', () => trashAction('restore'));
  $('#trashPurge').addEventListener('click', () => trashAction('purge'));
  $('#histUndo').addEventListener('click', () => historyAction('undo'));
  $('#histRedo').addEventListener('click', () => historyAction('redo'));
  $('#auditRefresh').addEventListener('click', loadAudit);
}

/* --- контекстное меню --------------------------------------------------- */
let ctxEl = null;
function showContextMenu(x, y) {
  if (!ctxEl) {
    ctxEl = document.createElement('div');
    ctxEl.className = 'menu';
    ctxEl.style.position = 'fixed';
    ctxEl.style.display = 'block';
    ctxEl.style.zIndex = 900;
    document.body.appendChild(ctxEl);
    ctxEl.innerHTML =
      '<button data-c="view"><span>View (F3)</span></button>' +
      '<button data-c="open"><span>Open</span></button>' +
      '<div class="sep"></div>' +
      '<button data-c="cut"><span>Cut</span><span class="sc">Ctrl+X</span></button>' +
      '<button data-c="copy"><span>Copy</span><span class="sc">Ctrl+C</span></button>' +
      '<button data-c="paste"><span>Paste</span><span class="sc">Ctrl+V</span></button>' +
      '<div class="sep"></div>' +
      '<button data-c="rename"><span>Rename…</span><span class="sc">F2</span></button>' +
      '<button data-c="batch"><span>Batch rename…</span></button>' +
      '<button data-c="touch"><span>Touch now</span></button>' +
      '<button data-c="chmod"><span>Permissions…</span></button>' +
      '<button data-c="copypath"><span>Copy full path</span></button>' +
      '<button data-c="copyname"><span>Copy name</span></button>' +
      '<button data-c="props"><span>Properties / hashes…</span></button>' +
      '<button data-c="archive"><span>Archive…</span></button>' +
      '<button data-c="download"><span>Download</span></button>' +
      '<button data-c="pin"><span>Pin this folder</span></button>' +
      '<div class="sep"></div>' +
      '<button data-c="delete"><span>Delete…</span><span class="sc">F8</span></button>' +
      '<button data-c="trashsel"><span>Move to trash…</span></button>';
    ctxEl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      hideCtx();
      doAction(b.dataset.c);
    });
  }
  ctxEl.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  ctxEl.style.top = Math.min(y, window.innerHeight - 380) + 'px';
  setTimeout(() => document.addEventListener('mousedown', hideCtxOnce), 0);
}
function hideCtxOnce(e) { if (ctxEl && !ctxEl.contains(e.target)) hideCtx(); }
function hideCtx() {
  if (ctxEl) ctxEl.style.display = 'none';
  document.removeEventListener('mousedown', hideCtxOnce);
}

/* ===== 11. ПЕРЕТАСКИВАНИЕ / ЗАГРУЗКА ================================== */
/* (обработчики drop — в initPanes выше) */

/* ===== 12. ПРОСМОТРЩИКИ И РЕДАКТОРЫ (окно на каждый файл) ============= */
const viewers = new Map();     // id окна -> состояние
let viewerSeq = 0;
const VIEW_EDIT_LIMIT = 2 * 1024 * 1024;

// Бинарник отличаем по нулевым байтам и невалидной UTF-8 — расширение здесь
// ничего не гарантирует: .jsonc и .conf точно так же текстовые, как .txt.
// stream:true не ругается на оборванный многобайтовый символ на границе куска.
function looksLikeText(buf, enc) {
  const b = new Uint8Array(buf);
  const n = Math.min(b.length, SNIFF_LIMIT);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  if (enc && enc !== 'utf-8') return true;   // win1251/latin1 не проверяем как UTF-8
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n), { stream: true });
    return true;
  } catch (e) { return false; }
}
function decodeText(buf, truncated, enc) {
  let txt = new TextDecoder(enc || 'utf-8').decode(buf);
  if (truncated && /\uFFFD$/.test(txt)) txt = txt.slice(0, -1);  // оборванный символ
  return txt;
}
async function fetchTextChunk(st) {
  const url = apiUrl('/api/inline', { path: st.path });
  const get = async range => {
    const r = await fetch(url, range ? { headers: { Range: 'bytes=0-' + (range - 1) } } : {});
    if (r.status === 416) return get(null);   // пустой файл: Range неприменим
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    const cr = r.headers.get('Content-Range') || '';
    const m = /\/(\d+)\s*$/.exec(cr);
    return { buf: buf, total: m ? parseInt(m[1], 10) : buf.byteLength };
  };
  // грузим не больше лимита редактирования; настоящий размер берём из Content-Range
  const part = await get(VIEW_EDIT_LIMIT);
  part.truncated = part.total > part.buf.byteLength;
  return part;
}

function vEl(st, role) { return st.el.querySelector('[data-vrole="' + role + '"]'); }
function vEls(st, role) { return Array.from(st.el.querySelectorAll('[data-vrole="' + role + '"]')); }
function allViewers() { return Array.from(viewers.values()); }
function viewerForPath(path) { return allViewers().find(v => v.path === path) || null; }

// окно может быть спрятано/закрыто во время проигрывания — останавливаем звук
function pauseViewerMedia(st) {
  if (!st) return;
  const body = vEl(st, 'body');
  if (!body) return;
  Array.from(body.querySelectorAll('video,audio')).forEach(m => {
    try { m.pause(); } catch (e) {}
  });
}
function stopViewerMedia(st) {
  if (!st) return;
  st.stopped = true;
  st.load++;   // аннулируем отложенные onload/onerror старого содержимого
  const body = vEl(st, 'body');
  if (!body) return;
  Array.from(body.querySelectorAll('video,audio')).forEach(m => {
    m.onloadedmetadata = null;
    m.onerror = null;
    try { m.pause(); } catch (e) {}
    try { m.currentTime = 0; } catch (e) {}
    m.removeAttribute('src');
    try { m.load(); } catch (e) {}
  });
  Array.from(body.querySelectorAll('img')).forEach(img => {
    img.onload = null;
    img.onerror = null;
  });
}

function viewerMsg(text) {
  const m = document.createElement('div');
  m.className = 'vmeta'; m.textContent = text;
  return m;
}
function lineCount(s) { return s ? s.split(/\r\n|\r|\n/).length : 0; }

/* --- редактор: позиция, гуттер, подсветка, поиск, черновики ------------- */
// Логическая позиция каретки: CRLF считается одним переводом строки,
// табы — одним столбцом. lastIndexOf('\n', caret-1) работает и для CRLF.
function updateViewerPos(st) {
  if (!st || st.kind !== 'text') return;
  const ta = vEl(st, 'text'); if (!ta) return;
  const el = vEl(st, 'pos'); if (!el) return;
  const caret = Math.max(0, Math.min(ta.selectionStart || 0, ta.value.length));
  const value = ta.value;
  const lastNl = value.lastIndexOf('\n', caret - 1);
  const line = value.slice(0, caret).split(/\r\n|\r|\n/).length;
  const col = caret - (lastNl + 1) + 1;
  el.textContent = 'Ln ' + line + ', Col ' + col;
}
function rafViewerPos(st) {
  // click/keyup/select приходят до того, как браузер обновит selectionStart
  if (window.requestAnimationFrame) requestAnimationFrame(() => updateViewerPos(st));
  else setTimeout(() => updateViewerPos(st), 0);
}
function scrollViewerCaret(st, pos) {
  const ta = vEl(st, 'text'); if (!ta) return;
  const line = ta.value.slice(0, pos).split('\n').length - 1;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
  const hl = vEl(st, 'hl'), g = vEl(st, 'gutter');
  if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
  if (g) g.scrollTop = ta.scrollTop;
  rafViewerPos(st);
}
function updateViewerGutter(st) {
  if (!st || st.kind !== 'text') return;
  const g = vEl(st, 'gutter'), ta = vEl(st, 'text');
  if (!g || !ta) return;
  const n = Math.max(1, lineCount(ta.value)), lines = [];
  for (let i = 1; i <= n; i++) lines.push(i);
  g.textContent = lines.join('\n');
  g.scrollTop = ta.scrollTop;
}
const KW_GENERIC = ['if','else','for','while','do','switch','case','break','continue','return',
  'function','class','def','import','from','as','export','const','let','var','new','try','catch',
  'finally','throw','raise','this','self','true','false','null','None','True','False','and','or',
  'not','in','is','lambda','yield','async','await','public','private','static','void','struct',
  'interface','type','enum','package','SELECT','FROM','WHERE','INSERT','UPDATE','DELETE','CREATE'];
const KW_EXT = {
  py: ['elif','pass','with','global','nonlocal','del','assert','except','print'],
  sh: ['then','fi','echo','local','source','exit'],
  css: ['media','important','inherit'],
  sql: ['JOIN','ON','GROUP','ORDER','BY','LIMIT','TABLE','DROP','ALTER','VALUES','SET']
};
function escapeHtmlLite(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Подсветка без библиотек: сначала экранируем HTML, потом помечаем токены.
function highlightCode(text, ext) {
  const src = escapeHtmlLite(text);
  const keys = new Set(KW_GENERIC.concat(KW_EXT[ext] || []));
  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += src.slice(last, m.index);
    const t = m[0];
    let cls = '';
    if (/^(\/\/|#|\/\*)/.test(t)) cls = 'tok-com';
    else if (/^["'`]/.test(t)) cls = 'tok-str';
    else if (/^\d/.test(t)) cls = 'tok-num';
    else if (keys.has(t)) cls = 'tok-kw';
    out += cls ? '<span class="' + cls + '">' + t + '</span>' : t;
    last = m.index + t.length;
  }
  return out + src.slice(last);
}
function updateViewerHighlight(st) {
  if (!st || st.kind !== 'text') return;
  const hl = vEl(st, 'hl'), ta = vEl(st, 'text');
  if (!hl || !ta) return;
  hl.innerHTML = highlightCode(ta.value, extOf(st.path)) + (/\n$/.test(ta.value) ? '\n' : '');
  hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
}
function scheduleHighlight(st) {
  clearTimeout(st.hlT);
  st.hlT = setTimeout(() => updateViewerHighlight(st), 80);
}
function draftKey(st) { return 'draft.' + st.path; }
function clearDraft(st) {
  if (!st || !st.path) return;
  clearTimeout(st.draftT);
  try { localStorage.removeItem(LS + draftKey(st)); } catch (e) {}
}
function saveDraft(st) {
  if (!st || st.kind !== 'text') return;
  const ta = vEl(st, 'text'); if (!ta) return;
  if (ta.value === st.savedText) clearDraft(st);
  else { try { localStorage.setItem(LS + draftKey(st), ta.value); } catch (e) {} }
}
function scheduleDraft(st) {
  clearTimeout(st.draftT);
  st.draftT = setTimeout(() => saveDraft(st), 400);
}
function viewerEolText(st, text) {
  return st.eol === 'crlf' ? text.replace(/\r\n|\r|\n/g, '\r\n') : text.replace(/\r\n|\r/g, '\n');
}
function markViewerDirty(st) {
  if (!st || st.kind !== 'text') return;
  if (!st.dirty) { st.dirty = true; updateViewerUI(st); }
  updateViewerPos(st); updateViewerGutter(st);
  scheduleHighlight(st); scheduleDraft(st);
}
function openFindBar(st, replace) {
  if (!st || st.kind !== 'text') return;
  const bar = vEl(st, 'findbar'); if (!bar) return;
  bar.hidden = false;
  const target = replace ? vEl(st, 'replace') : vEl(st, 'find');
  if (target) { target.focus(); target.select(); }
  updateViewerPos(st);
}
function closeFindBar(st) {
  const bar = vEl(st, 'findbar');
  if (bar) bar.hidden = true;
  const ta = vEl(st, 'text');
  if (ta) { ta.focus(); rafViewerPos(st); }
}
function viewerFind(st, back) {
  const ta = vEl(st, 'text'), inp = vEl(st, 'find');
  if (!ta || !inp) return;
  const q = inp.value;
  if (!q) { status('Enter text to find', true); return; }
  const from = back ? ta.selectionStart : ta.selectionEnd;
  let pos = back ? ta.value.lastIndexOf(q, Math.max(0, from - q.length)) : ta.value.indexOf(q, from);
  if (pos < 0) pos = back ? ta.value.lastIndexOf(q) : ta.value.indexOf(q);
  if (pos < 0) { status('Not found: ' + q, true); return; }
  ta.focus(); ta.setSelectionRange(pos, pos + q.length);
  scrollViewerCaret(st, pos);
}
function viewerReplace(st) {
  const ta = vEl(st, 'text'), inp = vEl(st, 'find'), rep = vEl(st, 'replace');
  if (!ta || !inp || !rep) return;
  const q = inp.value;
  if (!q) { status('Enter text to find', true); return; }
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel !== q) { viewerFind(st, false); return; }
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + rep.value + ta.value.slice(ta.selectionEnd);
  ta.focus(); ta.setSelectionRange(pos + rep.value.length, pos + rep.value.length);
  markViewerDirty(st); updateViewerGutter(st); scrollViewerCaret(st, pos);
  viewerFind(st, false);
}
function viewerReplaceAll(st) {
  const ta = vEl(st, 'text'), inp = vEl(st, 'find'), rep = vEl(st, 'replace');
  if (!ta || !inp || !rep) return;
  const q = inp.value;
  if (!q) { status('Enter text to find', true); return; }
  const count = ta.value.split(q).length - 1;
  if (!count) { status('Nothing to replace', true); return; }
  ta.value = ta.value.split(q).join(rep.value);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  markViewerDirty(st); updateViewerGutter(st); scrollViewerCaret(st, ta.value.length);
  status('Replaced: ' + count);
}
async function viewerGoto(st) {
  const ta = vEl(st, 'text'); if (!ta) return;
  const answer = await promptBox('Go to line:', '', 'Go to line');
  if (answer === null) return;
  const n = parseInt(answer, 10);
  if (!isFinite(n) || n < 1) { status('Invalid line number', true); return; }
  const lines = ta.value.split(/\r\n|\r|\n/);
  const line = Math.min(n, lines.length);
  let pos = 0;
  for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
  ta.focus(); ta.setSelectionRange(pos, pos);
  scrollViewerCaret(st, pos);
}
async function setViewerEncoding(st, enc) {
  if (!st || st.kind !== 'text' || st.encoding === enc) return;
  if (st.dirty) {
    const ok = await confirmBox('Discard unsaved changes in ' + baseName(st.path) + '?', 'Viewer');
    if (!ok) return;
  }
  st.dirty = false; clearDraft(st);
  st.encoding = enc; updateViewerUI(st); renderViewer(st);
}
function setViewerEol(st, eol) {
  if (!st || st.kind !== 'text' || st.eol === eol) return;
  const ta = vEl(st, 'text');
  if (ta) {
    const old = viewerEolText(st, ta.value);
    st.eol = eol;
    ta.value = viewerEolText(st, old);
    markViewerDirty(st); updateViewerGutter(st);
  } else { st.eol = eol; }
  updateViewerUI(st);
}
function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function registerViewer(el) {
  const st = {
    el: el, id: el.id, path: '', kind: '', canEdit: false,
    editing: false, dirty: false, stopped: false, load: 0, wrap: true,
    encoding: 'utf-8', eol: 'lf', savedText: '', draftAsked: false
  };
  viewers.set(el.id, st);
  return st;
}
function createViewer() {
  const proto = $('#winView');
  const el = proto.cloneNode(true);
  viewerSeq++;
  el.id = 'winView' + (viewerSeq + 1);
  el.hidden = true;
  el.style.width = proto.style.width;
  el.style.height = proto.style.height;
  const oldGrip = el.querySelector('.resize-grip');
  if (oldGrip) oldGrip.remove();
  delete el.dataset.chrome;
  delete el.dataset.placed;
  delete el.dataset.prev;
  delete el.dataset.max;
  el.classList.remove('active');
  scene.appendChild(el);
  wireWindow(el);
  return registerViewer(el);
}

async function viewFile(path) {
  if (!path) return;
  const old = viewerForPath(path);
  if (old) {
    openWin(old.id); focusWin(old.id);
    if (old.stopped) renderViewer(old);   // окно было закрыто — создаём медиа заново
    return;
  }
  const st = createViewer();
  st.path = path;
  st.wrap = true;
  st.encoding = 'utf-8'; st.eol = 'lf'; st.savedText = ''; st.draftAsked = false;
  openWin(st.id);
  vEl(st, 'title').textContent = 'Viewer — ' + baseName(path);
  vEl(st, 'meta').textContent = path;
  vEl(st, 'size').textContent = '';
  vEl(st, 'wrapMark').textContent = '✓';
  renderViewer(st);
}

function setViewerKind(st, kind) {
  st.kind = kind;
  vEl(st, 'body').classList.remove('editmode');
  // File/View и панель правки нужны только текстовому редактору.
  // GIF/картинки, видео, аудио и бинарные файлы — просто просмотр.
  const text = kind === 'text';
  const bar = st.el.querySelector('.menubar');
  const tools = st.el.querySelector('.vbar');
  const find = vEl(st, 'findbar');
  if (bar) bar.hidden = !text;
  if (tools) tools.hidden = !text;
  if (find) find.hidden = true;
  updateViewerUI(st);
}
function updateViewerUI(st) {
  const text = st.kind === 'text';
  const can = text && st.canEdit;
  st.el.querySelectorAll('[data-vact="edit"]').forEach(b => { b.disabled = !can; });
  st.el.querySelectorAll('[data-vact="saveText"]').forEach(b => { b.disabled = !can || !st.dirty; });
  st.el.querySelectorAll('[data-vact="open"],[data-vact="saveAs"]').forEach(b => { b.disabled = !text; });
  st.el.querySelectorAll('[data-vact="find"],[data-vact="goto"],[data-vact="findNext"],[data-vact="replaceOne"],[data-vact="replaceAll"]')
    .forEach(b => { b.disabled = !text; });
  vEls(st, 'editLabel').forEach(e => { e.textContent = st.editing ? 'Stop editing' : 'Edit'; });
  const d = vEl(st, 'dirty');
  if (d) d.textContent = st.dirty ? '● unsaved changes'
      : (st.kind === 'text' && !st.canEdit ? 'read-only' : '');
  vEls(st, 'encMark').forEach(e => { e.textContent = (e.dataset.enc || 'utf-8') === st.encoding ? '✓' : ''; });
  vEls(st, 'eolMark').forEach(e => { e.textContent = (e.dataset.eol || 'lf') === st.eol ? '✓' : ''; });
  const ta = vEl(st, 'text');
  if (ta) {
    ta.readOnly = !st.editing;
    const hl = vEl(st, 'hl');
    const ws = st.wrap ? 'pre-wrap' : 'pre';
    ta.style.whiteSpace = ws;
    if (hl) hl.style.whiteSpace = ws;
  }
  updateViewerPos(st);
}
function viewerError(st, text) {
  const body = vEl(st, 'body');
  body.textContent = '';
  body.classList.remove('editmode');
  body.appendChild(viewerMsg(text));
  st.canEdit = st.editing = st.dirty = false;
  const pos = vEl(st, 'pos'); if (pos) pos.textContent = 'Ln 1, Col 1';
  setViewerKind(st, 'binary');
}

function renderViewer(st) {
  const body = vEl(st, 'body');
  if (!st.path) return;
  stopViewerMedia(st);
  st.stopped = false;
  const ext = extOf(st.path);
  const my = ++st.load;
  body.textContent = '';
  body.classList.remove('editmode');
  body.scrollTop = 0;

  if (IMG_EXT.indexOf(ext) >= 0) {
    st.canEdit = st.editing = st.dirty = false;
    setViewerKind(st, 'image');
    const img = document.createElement('img');
    img.src = apiUrl('/api/inline', { path: st.path });
    img.alt = baseName(st.path);
    img.onload = () => { vEl(st, 'size').textContent = img.naturalWidth + '×' + img.naturalHeight + ' px'; };
    img.onerror = () => { if (my === st.load) viewerError(st, 'Cannot open: ' + st.path); };
    body.appendChild(img);
    return;
  }
  if (VIDEO_EXT.indexOf(ext) >= 0) {
    st.canEdit = st.editing = st.dirty = false;
    setViewerKind(st, 'video');
    const v = document.createElement('video');
    v.controls = true; v.preload = 'metadata';
    v.src = apiUrl('/api/inline', { path: st.path });
    v.onloadedmetadata = () => {
      vEl(st, 'size').textContent = fmtDuration(v.duration) +
        (v.videoWidth ? ' · ' + v.videoWidth + '×' + v.videoHeight : '');
    };
    v.onerror = () => { if (my === st.load) viewerError(st, 'Cannot play: ' + st.path); };
    body.appendChild(v);
    return;
  }
  if (AUDIO_EXT.indexOf(ext) >= 0) {
    st.canEdit = st.editing = st.dirty = false;
    setViewerKind(st, 'audio');
    const box = document.createElement('div'); box.className = 'vaudio';
    const ic = document.createElement('div'); ic.className = 'vaudio-ico'; ic.textContent = '♪';
    const nm = document.createElement('div'); nm.className = 'vaudio-name'; nm.textContent = baseName(st.path);
    const a = document.createElement('audio');
    a.controls = true; a.preload = 'metadata';
    a.src = apiUrl('/api/inline', { path: st.path });
    a.onloadedmetadata = () => { vEl(st, 'size').textContent = fmtDuration(a.duration); };
    a.onerror = () => { if (my === st.load) viewerError(st, 'Cannot play: ' + st.path); };
    box.appendChild(ic); box.appendChild(nm); box.appendChild(a);
    body.appendChild(box);
    return;
  }
  // Любой не-медиа файл пробуем открыть как текст. Расширение — лишь
  // подсказка: .jsonc, .json5, .env, .properties, конфиги без расширения
  // и прочие текстовые файлы определяются по содержимому, а не по списку.
  setViewerKind(st, 'text');
  st.canEdit = st.editing = st.dirty = false;
  updateViewerUI(st);
  body.appendChild(viewerMsg('Loading…'));
  fetchTextChunk(st).then(async part => {
    if (my !== st.load) return;
    body.textContent = '';
    if (!looksLikeText(part.buf, st.encoding)) {
      viewerError(st, 'Binary file — use Download (Alt+D) or open it over FTP.');
      return;
    }
    const serverText = decodeText(part.buf, part.truncated, st.encoding);
    let txt = serverText, restored = false;
    // черновик из localStorage: предлагаем восстановить, если он отличается
    const draft = read(draftKey(st), null);
    if (draft !== null && draft !== serverText && !st.draftAsked) {
      st.draftAsked = true;
      if (await confirmBox('Restore unsaved draft of ' + baseName(st.path) + '?', 'Draft')) {
        txt = draft; restored = true;
      }
    }
    if (my !== st.load) return;
    if (part.truncated) {
      const pre = document.createElement('pre');
      pre.textContent = txt + '\n… (truncated)';
      pre.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
      body.appendChild(pre);
      st.canEdit = st.editing = st.dirty = false;
      vEl(st, 'size').textContent = 'too large to edit · ' + fmtSize(part.total);
    } else {
      st.canEdit = true; st.editing = false; st.dirty = restored; st.savedText = serverText;
      const stack = document.createElement('div'); stack.className = 'vedit-stack';
      const gutter = document.createElement('div'); gutter.className = 'vedit-gutter';
      gutter.dataset.vrole = 'gutter'; gutter.setAttribute('aria-hidden', 'true');
      const area = document.createElement('div'); area.className = 'vedit-area';
      const hl = document.createElement('pre'); hl.className = 'vedit-hl';
      hl.dataset.vrole = 'hl'; hl.setAttribute('aria-hidden', 'true');
      const ta = document.createElement('textarea');
      ta.dataset.vrole = 'text'; ta.className = 'vedit ro'; ta.spellcheck = false;
      ta.wrap = st.wrap ? 'soft' : 'off';
      ta.value = txt; ta.readOnly = true;
      ta.addEventListener('input', () => markViewerDirty(st));
      ['keyup', 'click', 'select', 'focus'].forEach(ev =>
        ta.addEventListener(ev, () => rafViewerPos(st)));
      ta.addEventListener('scroll', () => {
        if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
        gutter.scrollTop = ta.scrollTop;
        rafViewerPos(st);
      });
      ta.addEventListener('keydown', e => {
        const c = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
        if (c && k === 's') { e.preventDefault(); saveViewerText(st); }
        else if (c && k === 'f' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); openFindBar(st, false); }
        else if (c && k === 'h') { e.preventDefault(); e.stopPropagation(); openFindBar(st, true); }
        else if (c && k === 'g') { e.preventDefault(); e.stopPropagation(); viewerGoto(st); }
      });
      area.appendChild(hl); area.appendChild(ta);
      stack.appendChild(gutter); stack.appendChild(area);
      body.appendChild(stack);
      body.classList.add('editmode');
      vEl(st, 'size').textContent = lineCount(txt) + ' lines · ' + fmtSize(part.total);
    }
    updateViewerUI(st);
    updateViewerGutter(st); updateViewerHighlight(st); updateViewerPos(st);
  }).catch(e => {
    if (my !== st.load) return;
    viewerError(st, 'Cannot open: ' + st.path + ' — ' + e.message);
  });
}

function toggleViewerEdit(st) {
  if (!st.canEdit) return;
  st.editing = !st.editing;
  updateViewerUI(st);
  if (st.editing) {
    const ta = vEl(st, 'text');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); rafViewerPos(st); }
  }
}
async function saveViewerText(st) {
  const ta = vEl(st, 'text');
  if (!ta || !st.canEdit) return;
  if (readOnlyMode()) { blockMutating(); return; }
  const text = viewerEolText(st, ta.value);
  try {
    const d = await api('/api/write', {
      method: 'POST', body: { path: st.path, text: text }
    });
    st.dirty = false; st.savedText = ta.value;
    clearDraft(st);
    clearTimeout(st.hlT);
    updateViewerUI(st); updateViewerPos(st);
    vEl(st, 'size').textContent = lineCount(text) + ' lines · ' +
      fmtSize((d && d.size) !== undefined ? d.size : new Blob([text]).size);
    status('Saved: ' + baseName(st.path));
    refreshBoth();
  } catch (e) {
    status('Cannot save: ' + e.message, true);
    notice('Cannot save ' + st.path + '\n' + e.message, 'Save');
  }
}
function reloadViewer(st) {
  if (st.dirty) {
    confirmBox('Discard unsaved changes in ' + baseName(st.path) + '?', 'Viewer').then(ok => {
      if (ok) { st.dirty = false; clearDraft(st); renderViewer(st); }
    });
  } else renderViewer(st);
}
function openViewerText(st) {
  if (st.kind !== 'text') return;
  // Открываем именно то, что видно в редакторе (включая несохранённые правки),
  // обычным text/plain — иначе .md/.log/.json могли бы скачаться как binary.
  const ta = vEl(st, 'text');
  const value = ta ? ta.value : (vEl(st, 'body').textContent || '');
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function saveViewerAs(st) {
  if (st.kind !== 'text') return;
  if (readOnlyMode()) { blockMutating(); return; }
  const ta = vEl(st, 'text');
  const text = viewerEolText(st, ta ? ta.value : (vEl(st, 'body').textContent || ''));
  const name = await promptBox('Save a copy as…', baseName(st.path), 'Save as');
  if (!name) return;
  const clean = cleanName(name);
  if (!clean) { status('Invalid file name', true); return; }
  const dest = joinPath(parentOf(st.path) || '/', clean);
  if (dest === st.path) { status('Choose another name', true); return; }
  try {
    try {
      await api('/api/newfile', { method: 'POST', body: { path: dest } });
    } catch (e) {
      if (e.message !== 'already exists') throw e;
      const ok = await confirmBox('Overwrite ' + clean + '?', 'Save as');
      if (!ok) return;
    }
    await api('/api/write', { method: 'POST', body: { path: dest, text: text } });
    status('Saved copy: ' + dest);
    refreshBoth();
    viewFile(dest);
  } catch (e) {
    status('Cannot save as: ' + e.message, true);
    notice('Cannot save as ' + dest + '\n' + e.message, 'Save as');
  }
}

window.addEventListener('beforeunload', e => {
  if (allViewers().some(v => v.dirty)) { e.preventDefault(); e.returnValue = ''; }
});

/* одна делегированная обработка на все окна просмотра */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-vact]');
  if (!b) return;
  const win = b.closest('.viewer-win');
  if (!win) return;
  const st = viewers.get(win.id);
  if (!st) return;
  e.stopPropagation();
  closeMenus();
  const a = b.dataset.vact;
  if (a === 'close') closeWin(st.id);
  else if (a === 'reload') reloadViewer(st);
  else if (a === 'saveAs') saveViewerAs(st);
  else if (a === 'open') openViewerText(st);
  else if (a === 'edit') toggleViewerEdit(st);
  else if (a === 'saveText') saveViewerText(st);
  else if (a === 'find') openFindBar(st, false);
  else if (a === 'goto') viewerGoto(st);
  else if (a === 'findNext') viewerFind(st, b.dataset.back === '1');
  else if (a === 'replaceOne') viewerReplace(st);
  else if (a === 'replaceAll') viewerReplaceAll(st);
  else if (a === 'closeFind') closeFindBar(st);
  else if (a.indexOf('enc-') === 0) setViewerEncoding(st, a.slice(4) === 'utf8' ? 'utf-8' :
    (a === 'enc-win1251' ? 'windows-1251' : 'iso-8859-1'));
  else if (a.indexOf('eol-') === 0) setViewerEol(st, a.slice(4));
  else if (a === 'wrap') {
    st.wrap = !st.wrap;
    vEl(st, 'wrapMark').textContent = st.wrap ? '✓' : '';
    const ta = vEl(st, 'text');
    if (ta) {
      ta.wrap = st.wrap ? 'soft' : 'off';
      ta.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
      const hl = vEl(st, 'hl');
      if (hl) hl.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
      rafViewerPos(st);
    } else Array.from(vEl(st, 'body').querySelectorAll('pre')).forEach(p => {
      p.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
    });
  }
});

/* ===== 13. КЛАВИАТУРА, ЧАСЫ, СТАТУС, ЗАПУСК =========================== */
function status(text, fail) {
  const el = $('#fmStatus');
  el.textContent = text;
  el.style.color = fail ? 'var(--txt-fail)' : '';
  clearTimeout(status._t);
  status._t = setTimeout(() => { el.textContent = summary(); el.style.color = ''; }, 6000);
}
function summary() {
  const p = active();
  const n = visibleEntries(p).length;
  return p.path + ' — ' + n + (n === 1 ? ' item' : ' items') + (p.sel.size ? ', ' + p.sel.size + ' selected' : '');
}
function updateStatus() {
  $('#fmStatus').textContent = summary();
  $$('[data-act="download"]').forEach(b => { b.disabled = !downloadableSelection().files.length; });
  const f = (C.ftp || {});
  const host = f.host || location.hostname;
  $('#fmFtp').textContent = 'FTP ' + FTP_USER + '@' + host + ':' + FTP_PORT +
    (FTP_PASSIVE ? ' · passive ' + FTP_PASSIVE : '');
}

function doAction(a) {
  if (MUTATING.has(a) && readOnlyMode()) { blockMutating(); return; }
  switch (a) {
    case 'up': go(activeSide, parentOf(active().path) || '/'); break;
    case 'refresh': refresh(activeSide); break;
    case 'mkdir': actMkdir(); break;
    case 'newfile': actNewFile(); break;
    case 'rename': actRename(); break;
    case 'delete': actDelete(); break;
    case 'cut': actCut(); break;
    case 'copy': actCopy(); break;
    case 'paste': actPaste(); break;
    case 'undo': actUndo(); break;
    case 'redo': actRedo(); break;
    case 'upload': $('#fileInput').click(); break;
    case 'download': actDownload(); break;
    case 'view': { const paths = selPaths(activeSide); if (paths.length) paths.forEach(viewFile); else status('Nothing selected', true); break; }
    case 'search': openSearch(); break;
    case 'batch': openBatch(); break;
    case 'archive': openArchive(); break;
    case 'props': openProps(); break;
    case 'copypath': actCopyPath(); break;
    case 'copyname': actCopyName(); break;
    case 'touch': actTouch(); break;
    case 'chmod': actChmod(); break;
    case 'trashsel': actTrashSelection(); break;
    case 'trash': openTrash(); break;
    case 'audit': openAudit(); break;
    case 'settings': openSettings(); break;
    case 'pin': pinCurrent(); break;
    case 'invert': invertSel(activeSide); break;
    case 'toother': transfer(selPaths(activeSide), other().path, 'copy'); break;
    case 'moveother': transfer(selPaths(activeSide), other().path, 'move'); break;
    case 'deselect': panes[activeSide].sel = new Set(); renderPane(activeSide); updateStatus(); break;
    case 'refresh2': refreshBoth(); break;
    case 'sortname': case 'sortsize': case 'sortdate':
      sortKey = a.slice(4); sortDir = 1; updateMarks(); renderPanes(); break;
    case 'hidden': showHidden = !showHidden; store('hidden', showHidden ? '1' : '0'); updateMarks(); renderPanes(); break;
    case 'namesep': { const on = read('namesep', '0') === '1'; store('namesep', on ? '0' : '1'); $('[data-mark="namesep"]').textContent = on ? '' : '✓'; break; }
    case 'skin': setSkin(document.documentElement.getAttribute('data-skin') === 'wm' ? 'win9x' : 'wm'); break;
    case 'wmgray': case 'wmsteel': case 'wmdark': setWmTheme(a.slice(2)); break;
    case 'theme': setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); break;
    case 'places': plSel = -1; renderPlacesWin(); $('#plErr').textContent = ''; openWin('winPlaces'); break;
    case 'help': openWin('winHelp'); break;
    case 'about': openWin('winHelp'); break;
  }
}

function initActions() {
  $$('[data-act]').forEach(b => {
    const a = b.dataset.act;
    if (a === 'up') b.addEventListener('click', () => { const pane = b.closest('.pane'); go(pane ? pane.dataset.side : activeSide, parentOf((pane ? panes[pane.dataset.side] : active()).path) || '/'); });
    else b.addEventListener('click', runMenu(() => doAction(a)));
  });
}

function buildHelp() {
  const f = C.ftp || {};
  const host = f.host || location.hostname;
  $('#helpBody').innerHTML =
    '<h3>Панель и мышь</h3>' +
    '<p>Две панели: левая и правая. Папку можно открыть двойным кликом по строке или одним кликом ' +
    'по её иконке; <code>..</code> ведёт наверх одним кликом, двойной клик по файлу открывает его. ' +
    'Кнопки <b>← → ↑</b> над списком — ' +
    'назад, вперёд и вверх; закреплённые места — кнопками над списком. Клик по имени выделяет, ' +
    '<kbd>Ctrl</kbd>+клик добавляет к выделению, <kbd>Shift</kbd>+клик выделяет диапазон. ' +
    'Перетаскивание строки в другую панель переносит файл, с <kbd>Ctrl</kbd> — копирует; ' +
    'файлы с диска можно просто бросить на панель — начнётся загрузка. Во время передачи в правом нижнем углу появляется индикатор ' +
     'с процентами и объёмом: видно, насколько файл уже загружен или скачан.</p>' +
    '<h3>Просмотр и правка</h3>' +
    '<p><kbd>F3</kbd> или кнопка <b>View</b> открывает каждый выделенный файл в отдельном окне ' +
    'Viewer — можно держать несколько окон одновременно и перетаскивать их мышью. ' +
    'Картинки, видео и аудио проигрываются прямо в окне (видео поддерживает перемотку), ' +
    'а текстовые файлы открываются в поле просмотра. Тип определяется по содержимому, ' +
    'поэтому подходит любой текст: <code>.txt</code>, <code>.jsonc</code>, <code>.json5</code>, ' +
    '<code>.toml</code>, <code>.env</code>, <code>.properties</code>, конфиги и скрипты ' +
    'с любым расширением. Повторный вызов уже открытого файла просто поднимает его окно; ' +
    'закрытие или сворачивание останавливает воспроизведение. ' +
    'Меню <b>File/View</b> и панель кнопок есть только в текстовом редакторе: ' +
    'картинки (включая GIF), видео, аудио и бинарные файлы открываются без них. ' +
    'В тексте <b>File → Edit text</b> (или <b>Edit</b>) разрешает правку, ' +
    '<b>File → Save file</b> / <kbd>Ctrl+S</kbd> сохраняет файл, ' +
    '<b>File → Save as…</b> пишет копию под другим именем, ' +
    '<b>File → Open with browser…</b> открывает текст в новой вкладке, ' +
    '<b>View → Reload</b> / <kbd>Ctrl+R</kbd> перечитывает файл, ' +
    '<b>View → Word wrap</b> переключает перенос строк. Несохранённые ' +
    'изменения защищены подтверждением при закрытии окна. Внизу редактора показывается ' +
    'позиция каретки <b>Ln x, Col y</b>, слева — нумерация строк; <b>View → Find / replace</b> ' +
    '(<kbd>Ctrl+F</kbd>, <kbd>Ctrl+H</kbd>) ищет и заменяет, <kbd>Ctrl+G</kbd> ведёт на строку. ' +
    'Кодировка (UTF-8 / Windows-1251 / Latin-1) и EOL (LF/CRLF) выбираются в меню View. ' +
    'Черновики правок сохраняются в браузере и предлагаются при повторном открытии. ' +
    'Файлы больше 2 МБ открываются только для чтения — скачай их для правки.</p>' +
    '<h3>Отмена</h3>' +
    '<p><kbd>Ctrl+Z</kbd> или кнопка <b>Undo</b> отменяет последнюю файловую ' +
    'операцию: создание, удаление, переименование, перенос, копирование, ' +
    'загрузку и сохранение текста. Снимки хранятся на сервере вне корня и ' +
    'не видны ни в панели, ни по FTP. История живёт до перезапуска сервера.</p>' +
    '<h3>Клавиши</h3><table>' +
    '<tr><td>Tab</td><td>переключить активную панель</td></tr>' +
    '<tr><td>Enter</td><td>войти в папку / открыть файл</td></tr>' +
    '<tr><td>Backspace / Alt+← / Alt+→</td><td>вверх / назад / вперёд по папкам</td></tr>' +
    '<tr><td>↑ ↓ Home End</td><td>перемещение курсора (с Shift — расширить выделение)</td></tr>' +
    '<tr><td>Ctrl+A / Ins</td><td>выделить всё / инвертировать выделение</td></tr>' +
    '<tr><td>Ctrl+H</td><td>показать/скрыть файлы и папки с точкой</td></tr>' +
    '<tr><td>Ctrl+X, Ctrl+C, Ctrl+V</td><td>вырезать, копировать, вставить</td></tr>' +
    '<tr><td>Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y</td><td>отменить / повторить действие с файлами</td></tr>' +
    '<tr><td>Ctrl+F</td><td>фильтр в панели; в текстовом Viewer — найти</td></tr>' +
    '<tr><td>Ctrl+Shift+F</td><td>поиск по файлам</td></tr>' +
    '<tr><td>F5 / F6</td><td>копировать / перенести в другую панель</td></tr>' +
    '<tr><td>F7</td><td>новая папка</td></tr>' +
    '<tr><td>F8 / Del</td><td>удалить</td></tr>' +
    '<tr><td>F2</td><td>переименовать</td></tr>' +
    '<tr><td>F3</td><td>открыть выделенные файлы, каждый в своём окне</td></tr>' +
    '<tr><td>Ctrl+S (в текстовом Viewer)</td><td>сохранить отредактированный текст</td></tr>' +
    '<tr><td>Ctrl+R (в текстовом Viewer)</td><td>перечитать файл, отказавшись от правок</td></tr>' +
    '<tr><td>Ctrl+H / Ctrl+G (в текстовом Viewer)</td><td>заменить / перейти на строку</td></tr>' +
    '<tr><td>Ctrl+U</td><td>загрузить файлы с диска</td></tr>' +
    '<tr><td>Ctrl+D / Alt+D</td><td>скачать выделенные файлы (папки не скачиваются)</td></tr>' +
    '<tr><td>F5 (вне списка) / Ctrl+R</td><td>обновить обе панели</td></tr>' +
    '<tr><td>Esc</td><td>снять выделение</td></tr>' +
    '</table>' +
    '<h3>FTP</h3>' +
    '<p>Те же файлы доступны по FTP — удобно для загрузки и выкачивания из файловых менеджеров ' +
    '(Total Commander, Midnight Commander, Finder, Nautilus, lftp, curl):</p>' +
    '<table>' +
    '<tr><td>Адрес</td><td><code>' + host + '</code></td></tr>' +
    '<tr><td>Порт</td><td><code>' + FTP_PORT + '</code></td></tr>' +
    (FTP_PASSIVE ? '<tr><td>Passive ports</td><td><code>' + FTP_PASSIVE + '</code></td></tr>' : '') +
    '<tr><td>Пользователь</td><td><code>' + FTP_USER + '</code></td></tr>' +
    '<tr><td>Пароль</td><td>тот же, что от панели</td></tr>' +
    '<tr><td>Пример</td><td><code>ftp://' + FTP_USER + '@' + host + ':' + FTP_PORT + '/</code></td></tr>' +
    '<tr><td>curl</td><td><code>curl -u ' + FTP_USER + ':*** ftp://' + host + ':' + FTP_PORT + '/var/log/syslog</code></td></tr>' +
    '</table>' +
    '<p>FTP отдаёт корень файловой системы (или папку, заданную флагом <code>--root</code>).</p>' +
    '<h3>Закреплённые места</h3>' +
    '<p><b>File → Pin this folder</b> прибивает текущую папку к строке над списком. ' +
    'Управление (порядок, удаление, добавление) — <b>View → Manage places…</b>. ' +
    'Список хранится на сервере в <code>places.json</code>, поэтому одинаков на всех устройствах.</p>' +
    '<h3>Скин и цветовые схемы</h3>' +
    '<p><b>View → WindowMaker skin</b> — NeXT/WindowMaker вместо Windows 9x ' +
    '(или сразу: <code>?skin=wm</code>). В скине WindowMaker доступны три схемы: ' +
    '<b>NeXT gray</b>, <b>SteelBlue</b> и <b>Dark</b> — <b>View → WindowMaker colors</b> ' +
    'или ссылка <code>?skin=wm&amp;wm=steel</code> / <code>?skin=wm&amp;wm=dark</code>. ' +
    '<b>View → Dark theme</b> — тёмное оформление поверх любого скина. ' +
    'Выбор запоминается в браузере.</p>';
}

/* --- клавиатура -------------------------------------------------------- */
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  const inPath = !!(e.target.classList && e.target.classList.contains('path'));

  /* диалог поверх всего: Esc — отмена, Enter — подтверждение */
  if (!$('#winDlg').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); dlgClose(null); }
    else if (e.key === 'Enter' && $('#dlgField').hidden) { e.preventDefault(); dlgClose(true); }
    return;
  }
  const ctrlEarly = e.ctrlKey || e.metaKey;
  const ek = (e.key || '').toLowerCase();
  const vw = e.target.closest && e.target.closest('.viewer-win');
  const inViewerText = !!(vw && viewers.has(vw.id) && viewers.get(vw.id).kind === 'text');
  // эти сочетания работают и в полях ввода: Ctrl+F в текстовом Viewer
  // оставляем самому редактору (он открывает свою строку поиска)
  if ($('#winLogin').hidden && ctrlEarly) {
    if (e.shiftKey && ek === 'f') { e.preventDefault(); doAction('search'); return; }
    if (e.shiftKey && ek === 'z') { e.preventDefault(); actRedo(); return; }
    if (!e.shiftKey && ek === 'y') { e.preventDefault(); actRedo(); return; }
    if (!e.shiftKey && ek === 'f' && !inViewerText) {
      e.preventDefault();
      const fi = $('[data-filter]', paneEl(activeSide));
      if (fi) { fi.focus(); fi.select(); }
      return;
    }
  }
  // в редакторском поле работают только его клавиши, но Ctrl+R из текстового
  // Viewer должен перечитывать файл, а не обновлять обе панели
  if (typing && !inPath && !(ctrlEarly && ek === 'r')) return;
  if (e.target.id === 'loginPass') return;
  if (dlgResolve) return;

  // оболочка видна всегда, поэтому без этой проверки горячие клавиши
  // срабатывали бы за окном входа
  if (!$('#winLogin').hidden) { if (e.key === 'Escape') closeMenus(); return; }

  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const p = active();

  if (k === 'Tab') { e.preventDefault(); setActiveSide(activeSide === 'left' ? 'right' : 'left'); return; }
  if (k === 'Escape') { closeMenus(); hideCtx(); if (p.sel.size) { p.sel = new Set(); renderPane(activeSide); updateStatus(); } return; }
  if (k === 'F1') { e.preventDefault(); doAction('help'); return; }
  if (k === 'F2') { e.preventDefault(); actRename(); return; }
  if (k === 'F3') { e.preventDefault(); const s = selPaths(activeSide); s.forEach(viewFile); return; }
  if (k === 'F5') { e.preventDefault(); if (ctrl) refreshBoth(); else if (e.shiftKey) doAction('refresh'); else { const o = other(); transfer(selPaths(activeSide), o.path, 'copy'); } return; }
  if (k === 'F6') { e.preventDefault(); const o = other(); transfer(selPaths(activeSide), o.path, 'move'); return; }
  if (k === 'F7') { e.preventDefault(); actMkdir(); return; }
  if (k === 'F8' || k === 'Delete') { e.preventDefault(); actDelete(); return; }
  if (k === 'Backspace') { e.preventDefault(); go(activeSide, parentOf(p.path) || '/'); return; }
  if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); navBack(activeSide); return; }
  if (e.altKey && k === 'ArrowRight') { e.preventDefault(); navForward(activeSide); return; }
  if (k === 'Enter') { e.preventDefault(); const s = Array.from(p.sel); if (s.length) openEntry(activeSide, s[0]); return; }
  if (k === 'Insert') { e.preventDefault(); invertSel(activeSide); return; }
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End') {
    e.preventDefault();
    const d = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : (k === 'Home' ? -9999 : 9999);
    moveCursor(activeSide, d, e.shiftKey);
    return;
  }
  if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(activeSide); return; }
  if (ctrl && (k === 'x' || k === 'X')) { e.preventDefault(); actCut(); return; }
  if (ctrl && (k === 'c' || k === 'C')) { e.preventDefault(); actCopy(); return; }
  if (ctrl && (k === 'v' || k === 'V')) { e.preventDefault(); actPaste(); return; }
  if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); actUndo(); return; }
  if (ctrl && (k === 'u' || k === 'U')) { e.preventDefault(); doAction('upload'); return; }
  if ((ctrl && (k === 'd' || k === 'D')) || (e.altKey && (k === 'd' || k === 'D'))) {
    e.preventDefault(); actDownload(); return;
  }
  if (ctrl && (k === 's' || k === 'S') && !e.defaultPrevented) {
    const vw = e.target.closest && e.target.closest('.viewer-win');
    if (vw && viewers.has(vw.id)) { e.preventDefault(); saveViewerText(viewers.get(vw.id)); return; }
  }
  if (ctrl && (k === 'r' || k === 'R')) {
    const vw = e.target.closest && e.target.closest('.viewer-win');
    if (vw && viewers.has(vw.id)) { e.preventDefault(); reloadViewer(viewers.get(vw.id)); return; }
    e.preventDefault(); refreshBoth(); return;
  }
  if (ctrl && (k === 'h' || k === 'H')) { e.preventDefault(); doAction('hidden'); return; }
});

/* --- часы в статусбаре -------------------------------------------------- */
function tick() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const el = $('#appClock');
  if (!el) return;
  el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  el.title = days[d.getDay()] + ', ' + d.getDate() + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear();
}

/* --- запуск ------------------------------------------------------------ */
function applyConfig() {
  document.title = C.serverName || 'Nerevar FM';
  $$('[data-cfg="serverIcon"]').forEach(e => e.textContent = C.serverIcon || 'F');
  $$('[data-cfg="fmTitle"]').forEach(e => e.textContent = (FM.windowTitle || 'File Manager'));
  if (FM.listSize) document.documentElement.style.setProperty('--row-size', FM.listSize + 'px');
  else document.documentElement.style.setProperty('--row-size', '13px');
  // стартовые размеры вспомогательных окон (потом запоминаются в браузере)
  const V = C.viewer || {}, A = C.about || {};
  const sizeOf = (id, w, h) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.style.width && w) el.style.width = w + 'px';
    if (!el.style.height && h) el.style.height = h + 'px';
  };
  sizeOf('winView', V.width, V.height);
  sizeOf('winHelp', A.width, A.height);
  const st = document.createElement('style');
  st.id = 'rowFontStyle';
  st.textContent = '.row{font-size:' + (FM.listSize || 13) + 'px}';
  document.head.appendChild(st);
}

function boot() {
  applyConfig();
  registerViewer($('#winView'));
  // токен можно передать в адресе (#token=…) — удобно для скриншотов и
  // автоматизации; в истории адрес не остаётся
  try {
    const m = /#token=([0-9a-f]{8,})/.exec(location.hash || '');
    if (m) {
      TOKEN = m[1];
      sessionStorage.setItem(LS + 'token', TOKEN);
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) {}
  initWindowChrome();
  initMenus();
  initActions();
  initPanes();
  initSettings();
  buildHelp();
  updateMarks();
  updateModeBadge();
  tick(); setInterval(tick, 15000);

  // развёрнутая «оболочка» всегда занимает весь экран при изменении окна
  window.addEventListener('resize', () => {
    $$('.appwindow[data-max="1"]').forEach(el => {
      el.style.left = '0px'; el.style.top = '0px';
      el.style.width = scene.clientWidth + 'px';
      el.style.height = scene.clientHeight + 'px';
    });
  });

  showHidden = read('hidden', FM.showHidden !== false ? '1' : '0') === '1';
  updateMarks();

  // окно входа — по центру экрана, без transform (иначе перетаскивание едет)
  const lg = $('#winLogin');
  lg.style.transform = 'none';
  lg.style.left = Math.max(10, Math.round((scene.clientWidth - lg.offsetWidth) / 2)) + 'px';
  lg.style.top = Math.max(10, Math.round((scene.clientHeight - lg.offsetHeight) / 2)) + 'px';
  opened.winLogin = true;
  lg.hidden = false;

  // восстановление раскладки вспомогательных окон (оболочка не сохраняется)
  const L = loadLayout();
  ['winHelp', 'winPlaces', 'winSearch', 'winBatch', 'winArchive', 'winProps',
    'winTrash', 'winAudit', 'winSettings'].forEach(id => {
    if (L[id] && L[id].open) openWin(id);
  });

  if (TOKEN) afterLogin(); else showLogin();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
