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
const TEXT_EXT = ['txt','md','log','conf','cfg','ini','json','js','css','html','htm','xml','yml','yaml',
  'py','sh','c','h','cpp','hpp','java','php','rb','go','rs','sql','csv','tsv','diff','patch','desktop',
  'service','timer','env','rc','list','tex','asc','asciidoc','nfo','diz','srt','vtt','toml','mk','cmake'];

function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }

function fmtSize(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
  $$('.menuitem').forEach(mi => {
    mi.addEventListener('click', e => {
      if (e.target.closest('.menu')) return;
      const was = mi.classList.contains('open');
      closeMenus();
      if (!was) mi.classList.add('open');
    });
    mi.addEventListener('mouseenter', () => {
      if ($('.menuitem.open')) { closeMenus(); mi.classList.add('open'); }
    });
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
    try { sessionStorage.setItem(LS + 'token', TOKEN); } catch (e) {}
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
  openWin('winLogin', true);
  $('#loginErr').textContent = reason || '';
  // оболочка остаётся на экране, но под затемнением и без нажатий
  scene.classList.add('locked');
  allViewers().forEach(v => { stopViewerMedia(v); v.dirty = false; hideWin(v.id); opened[v.id] = false; });
  hideWin('winHelp'); hideWin('winPlaces');
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
  } catch (e) {}
  buildHelp();          // порт FTP известен только теперь — пересобрать справку
  updateStatus();
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
  left:  { side: 'left',  path: '/', entries: [], sel: new Set(), cursor: null, hist: [], back: [], fwd: [], navClickAt: 0 },
  right: { side: 'right', path: '/', entries: [], sel: new Set(), cursor: null, hist: [], back: [], fwd: [], navClickAt: 0 }
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
      if (files && files.length) { uploadFiles(files, panes[side].path); return; }
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
  if (!items.length) return;
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
  if (!clip.items.length) { status('Buffer is empty', true); return; }
  await transfer(clip.items, active().path, clip.mode === 'cut' ? 'move' : 'copy');
}
async function actUndo() {
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
async function triggerDownload(path) {
  try {
    const res = await fetch(apiUrl('/api/download', { path: path }), {
      headers: TOKEN ? { 'X-Auth-Token': TOKEN } : {}
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
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName(path) || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    status('Cannot download ' + baseName(path) + ': ' + e.message, true);
  }
}
function uploadFiles(files, dir) {
  if (!files || !files.length) return;
  const form = new FormData();
  for (let i = 0; i < files.length; i++) form.append('file', files[i], files[i].name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', apiUrl('/api/upload', { path: dir }));
  if (TOKEN) xhr.setRequestHeader('X-Auth-Token', TOKEN);
  const prog = $('#upProg'), bar = $('#upProg i');
  prog.classList.add('on'); bar.style.width = '0%';
  xhr.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
  const done = ok => {
    setTimeout(() => { prog.classList.remove('on'); bar.style.width = '0%'; }, 600);
    if (ok) { refreshBoth(); status('Uploaded ' + files.length + ' file(s) → ' + dir); }
  };
  xhr.onload = () => {
    let d = null; try { d = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status >= 200 && xhr.status < 300) {
      const errs = (d && d.errors) || [];
      if (errs.length) { status('Upload: ' + errs.length + ' failed', true); notice(errs.map(e => e.name + ' — ' + e.error).join('\n'), 'Upload failed'); done(false); }
      else done(true);
    } else { status('Upload failed: ' + ((d && d.error) || xhr.status), true); done(false); }
  };
  xhr.onerror = () => { status('Upload failed: host unreachable', true); done(false); };
  xhr.send(form);
  status('Uploading ' + files.length + ' file(s)…');
}
$('#fileInput').addEventListener('change', e => {
  if (e.target.files.length) uploadFiles(e.target.files, active().path);
  e.target.value = '';
});

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
      '<button data-c="download"><span>Download</span></button>' +
      '<button data-c="pin"><span>Pin this folder</span></button>' +
      '<div class="sep"></div>' +
      '<button data-c="delete"><span>Delete…</span><span class="sc">F8</span></button>';
    ctxEl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      hideCtx();
      doAction(b.dataset.c);
    });
  }
  ctxEl.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  ctxEl.style.top = Math.min(y, window.innerHeight - 260) + 'px';
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
function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function registerViewer(el) {
  const st = {
    el: el, id: el.id, path: '', kind: '', canEdit: false,
    editing: false, dirty: false, stopped: false, load: 0, wrap: true
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
  // у видео/аудио нет текста и настроек — меню File/View только мешают
  const bar = st.el.querySelector('.menubar');
  if (bar) bar.hidden = (kind === 'video' || kind === 'audio');
  updateViewerUI(st);
}
function updateViewerUI(st) {
  const can = st.kind === 'text' && st.canEdit;
  st.el.querySelectorAll('[data-vact="edit"]').forEach(b => { b.disabled = !can; });
  st.el.querySelectorAll('[data-vact="saveText"]').forEach(b => { b.disabled = !can || !st.dirty; });
  vEls(st, 'editLabel').forEach(e => { e.textContent = st.editing ? 'Stop editing' : 'Edit'; });
  const d = vEl(st, 'dirty');
  if (d) d.textContent = st.dirty ? '● unsaved changes'
      : (st.kind === 'text' && !st.canEdit ? 'read-only' : '');
  const ta = vEl(st, 'text');
  if (ta) ta.readOnly = !st.editing;
}
function viewerError(st, text) {
  const body = vEl(st, 'body');
  body.textContent = '';
  body.classList.remove('editmode');
  body.appendChild(viewerMsg(text));
  st.canEdit = st.editing = st.dirty = false;
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
  const isText = TEXT_EXT.indexOf(ext) >= 0 || ext === '';
  if (!isText) {
    viewerError(st, 'Binary file — use Download (Alt+D) or open it over FTP.');
    return;
  }

  setViewerKind(st, 'text');
  st.canEdit = st.editing = st.dirty = false;
  updateViewerUI(st);
  body.appendChild(viewerMsg('Loading…'));
  fetch(apiUrl('/api/inline', { path: st.path }))
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(buf => {
      if (my !== st.load) return;
      body.textContent = '';
      if (buf.byteLength > VIEW_EDIT_LIMIT) {
        const txt = new TextDecoder('utf-8').decode(buf.slice(0, VIEW_EDIT_LIMIT)) + '\n… (truncated)';
        const pre = document.createElement('pre');
        pre.textContent = txt;
        pre.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
        body.appendChild(pre);
        st.canEdit = st.editing = st.dirty = false;
        vEl(st, 'size').textContent = 'too large to edit · ' + fmtSize(buf.byteLength);
        updateViewerUI(st);
        return;
      }
      let txt;
      try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (e) {
        viewerError(st, 'Not UTF-8 text — download it to open in another editor.');
        return;
      }
      st.canEdit = true; st.editing = false; st.dirty = false;
      const ta = document.createElement('textarea');
      ta.dataset.vrole = 'text'; ta.className = 'vedit ro'; ta.spellcheck = false;
      ta.wrap = st.wrap ? 'soft' : 'off';
      ta.value = txt; ta.readOnly = true;
      ta.addEventListener('input', () => {
        if (!st.dirty) { st.dirty = true; updateViewerUI(st); }
      });
      ta.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault(); saveViewerText(st);
        }
      });
      body.appendChild(ta);
      body.classList.add('editmode');
      vEl(st, 'size').textContent = lineCount(txt) + ' lines · ' + fmtSize(buf.byteLength);
      updateViewerUI(st);
    })
    .catch(e => {
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
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
}
async function saveViewerText(st) {
  const ta = vEl(st, 'text');
  if (!ta || !st.canEdit) return;
  try {
    const d = await api('/api/write', {
      method: 'POST', body: { path: st.path, text: ta.value }
    });
    st.dirty = false;
    updateViewerUI(st);
    vEl(st, 'size').textContent = lineCount(ta.value) + ' lines · ' +
      fmtSize((d && d.size) !== undefined ? d.size : new Blob([ta.value]).size);
    status('Saved: ' + baseName(st.path));
    refreshBoth();
  } catch (e) {
    status('Cannot save: ' + e.message, true);
    notice('Cannot save ' + st.path + '\n' + e.message, 'Save');
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
  else if (a === 'reload') {
    if (st.dirty) {
      confirmBox('Discard unsaved changes in ' + baseName(st.path) + '?', 'Viewer').then(ok => {
        if (ok) { st.dirty = false; renderViewer(st); }
      });
    } else renderViewer(st);
  }
  else if (a === 'save') triggerDownload(st.path);
  else if (a === 'open') window.open(apiUrl('/api/inline', { path: st.path }), '_blank');
  else if (a === 'edit') toggleViewerEdit(st);
  else if (a === 'saveText') saveViewerText(st);
  else if (a === 'wrap') {
    st.wrap = !st.wrap;
    vEl(st, 'wrapMark').textContent = st.wrap ? '✓' : '';
    const ta = vEl(st, 'text');
    if (ta) { ta.wrap = st.wrap ? 'soft' : 'off'; ta.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre'; }
    else Array.from(vEl(st, 'body').querySelectorAll('pre')).forEach(p => {
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
  $('#fmFtp').textContent = 'FTP ' + FTP_USER + '@' + host + ':' + FTP_PORT;
}

function doAction(a) {
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
    case 'upload': $('#fileInput').click(); break;
    case 'download': actDownload(); break;
    case 'view': { const paths = selPaths(activeSide); if (paths.length) paths.forEach(viewFile); else status('Nothing selected', true); break; }
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
    'файлы с диска можно просто бросить на панель — начнётся загрузка.</p>' +
    '<h3>Просмотр и правка</h3>' +
    '<p><kbd>F3</kbd> или кнопка <b>View</b> открывает каждый выделенный файл в отдельном окне ' +
    'Viewer — можно держать несколько окон одновременно и перетаскивать их мышью. ' +
    'Картинки, видео и аудио проигрываются прямо в окне (видео поддерживает перемотку), ' +
    'текстовые файлы открываются в поле просмотра. Повторный вызов уже открытого файла ' +
    'просто поднимает его окно; закрытие или сворачивание останавливает воспроизведение. ' +
    'У видео и аудио меню <b>File/View</b> скрыты — только кнопки проигрывателя. ' +
    'Кнопка <b>Edit</b> или <b>File → Edit text</b> разрешает ' +
    'правку, <b>Save</b> или <kbd>Ctrl+S</kbd> сохраняет файл на сервере. Несохранённые ' +
    'изменения защищены подтверждением при закрытии окна. Файлы больше 2 МБ и не-UTF-8 ' +
    'текст открываются только для чтения — скачай их для правки.</p>' +
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
    '<tr><td>Ctrl+Z</td><td>отменить последнее действие с файлами</td></tr>' +
    '<tr><td>F5 / F6</td><td>копировать / перенести в другую панель</td></tr>' +
    '<tr><td>F7</td><td>новая папка</td></tr>' +
    '<tr><td>F8 / Del</td><td>удалить</td></tr>' +
    '<tr><td>F2</td><td>переименовать</td></tr>' +
    '<tr><td>F3</td><td>открыть выделенные файлы, каждый в своём окне</td></tr>' +
    '<tr><td>Ctrl+S (в Viewer)</td><td>сохранить отредактированный текст</td></tr>' +
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
  if (typing && !inPath) return;   // в редакторском поле работают только его клавиши
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
  if (ctrl && (k === 'r' || k === 'R')) { e.preventDefault(); refreshBoth(); return; }
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
  buildHelp();
  updateMarks();
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
  ['winHelp', 'winPlaces'].forEach(id => {
    if (L[id] && L[id].open) openWin(id);
  });

  if (TOKEN) afterLogin(); else showLogin();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
