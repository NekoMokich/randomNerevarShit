/* ==========================================================================
   NEREVAR HUB — ЛОГИКА ПАНЕЛИ
   ==========================================================================
   Файл подключён из index.html последним, в конце body:
       <script src="app.js"></script>
   Порядок загрузки: config.js (настройки) -> короткий inline-скрипт внутри
   index.html (тема и шрифт до первой отрисовки — он обязан остаться в
   странице, иначе рабочий стол успевает мигнуть светлым) -> этот файл.
   server.py отдаёт app.js без кэша, поэтому правки видны сразу после F5.
   Сборка не нужна — файл обычный JavaScript, работает и с диска (file://).

   ГДЕ ЧТО ПРАВИТЬ
   ---------------
   Поведение панели  — этот файл: окна и меню, System Monitor, Audio
                       Player, Picture Viewer, Help, конструктор раскладки,
                       терминал (команды, fetch, блэкджек)
   Настройки         — config.js (window.CONFIG): имя сервера, сервисы,
                       монитор, плеер, терминал, Help
   Внешний вид       — блок <style> в index.html: темы, шрифты,
                       bevel-рамки Win9x, геометрия окон
   Отдача файлов     — server.py: метрики, картинки, музыка, скины,
                       раскладка окон, банк блэкджека
   ========================================================================== */
/* ==========================================================================
   НАСТРОЙКИ живут в отдельном файле config.js (рядом с index.html).
   Правится только он: сохранил — обновил страницу (F5).
   ========================================================================== */
if(!window.CONFIG){
 const msg='config.js not found — put config.js next to index.html (all panel settings live there)';
 document.documentElement.insertAdjacentHTML('beforeend',
  '<div style="position:fixed;inset:0;background:var(--blue);color:#fff;'+
  'font:14px Tahoma,sans-serif;display:flex;align-items:center;'+
  'justify-content:center;text-align:center;padding:24px;z-index:99999">'+msg+'</div>');
 throw new Error(msg);
}
const CONFIG=window.CONFIG;
/* ========================================================================== */

const lanInput=document.querySelector('#lanHost');
const tailInput=document.querySelector('#tailHost');

/* Карточки services, выключенные в конструкторе раскладки (индексы из CONFIG).
   Объявлено до applyConfig() — тот сразу зовёт renderServices(). */
let hiddenSvc=new Set();
/* Карточка сервиса, чьё окно выключено в конфиге (enabled:false), не
   показывается: выключенные не рендерятся и не считаются в статусбаре. */
function svcOff(svc){
 if(!svc.win)return false;
 const key=({winNetwork:'network',winDownloads:'downloads',winMusic:'music',
             winTelegram:'telegram'})[svc.win];
 return key?((CONFIG[key]||{}).enabled===false):false;
}

function renderServices(){
 const box=document.querySelector('.services');
 const visible=[];
 CONFIG.services.forEach((svc,i)=>{if(!hiddenSvc.has(i)&&!svcOff(svc))visible.push({svc,i})});
 box.innerHTML=visible.map(({svc,i})=>{
  const isNumber=(svc.icon==null||svc.icon==='');
  const icon=isNumber?(i+1):svc.icon;            // номер берём из CONFIG, без пересчёта
  const iconCls=isNumber?'iconbox is-number':'iconbox';
  /* ext — внешний сервис (Telegram): без порта и LAN/Tailscale-ссылок,
     у него нет своего адреса на этом сервере */
  const isExt=!!svc.ext;
  const port=isExt?'':`<span class="svc-port">${svc.port}</span>`;
  const note=svc.note?(isExt?svc.note:`${svc.note} · ${port}`):(isExt?'':port);
  /* win — клик по имени открывает окно сервиса; live — ячейка живого
     статуса, её обновляют netTick (Network) и dlTick (Download Manager) */
  const name=svc.win
   ?`<h2><a class="svc-open" data-open-win="${svc.win}" href="#" title="Open window">${svc.name}</a></h2>`
   :`<h2>${svc.name}</h2>`;
  const live=svc.live?`<div class="svc-live" data-live="${svc.live}">&mdash;</div>`:'';
  const actions=isExt?'':`<div class="actions"><a data-host="lan" data-port="${svc.port}" href="#">LAN</a><a data-host="tail" data-port="${svc.port}" href="#">Tailscale</a></div>`;
  return `<article class="service"><div class="${iconCls}">${icon}</div><div>${name}<p>${note}</p>${actions}${live}</div></article>`;
 }).join('');
 updateLinks();                               // новые ссылки сразу получают адреса
 const counter=document.querySelector('.statusbar div:nth-child(2)');
 if(counter)counter.textContent=`${visible.length} service${visible.length===1?'':'s'}`;
}
/* Клик по имени карточки с полем win открывает окно сервиса
   (Network, Download Manager); карточки без win — как раньше. */
document.querySelector('.services').addEventListener('click',event=>{
 const a=event.target.closest('[data-open-win]');
 if(!a)return;
 event.preventDefault();
 const win=document.getElementById(a.dataset.openWin);
 if(win)showWindow(win,true);
});
function renderHelp(){
 const box=document.querySelector('[data-help-body]');
 if(!box)return;
 const h=CONFIG.help||{};
 let html='';
 if(h.title)html+='<h1>'+h.title+'</h1>';
 if(h.intro)html+='<p>'+h.intro+'</p>';
 if(Array.isArray(h.items)&&h.items.length)html+='<ul>'+h.items.map(i=>'<li>'+i+'</li>').join('')+'</ul>';
 if(h.html)html+=h.html;
 box.innerHTML=html;
 const titleEl=document.querySelector('[data-help-title]');
 if(titleEl)titleEl.textContent=h.windowTitle||'Help';
}
/* --- Тема оформления (config.js / кнопка во вкладке View) ------------------
   Тёмная тема целиком описана блоком html[data-theme=dark] в style выше,
   здесь только переключение и память выбора:
     CONFIG.theme  — тема по умолчанию (для нового браузера);
     localStorage  — выбор кнопки View, он же важнее config.js;
     layout.json  — тема едет в раскладке на сервере, поэтому выбор
                    одинаков на всех устройствах.
   Вызывается ниже applyConfig() — объявлено до него. */
const THEME_KEY='nerevar-hub.theme';
let currentTheme=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
function applyTheme(name){                    // ставит атрибут, память не трогает
 if(name!=='dark'&&name!=='light')name='light';
 currentTheme=name;
 document.documentElement.setAttribute('data-theme',name);
 const mark=document.querySelector('[data-theme-mark]');
 if(mark)mark.textContent=name==='dark'?'✓':'';   // галочка в меню View
}
function storedTheme(){                       // выбор кнопки View из этого браузера
 try{const v=localStorage.getItem(THEME_KEY);if(v==='dark'||v==='light')return v}catch(e){}
 return null;
}
function setTheme(name,remember){             // remember=false — забыть выбор
 applyTheme(name);
 try{remember?localStorage.setItem(THEME_KEY,name):localStorage.removeItem(THEME_KEY)}catch(e){}
}
function toggleTheme(){
 const next=currentTheme==='dark'?'light':'dark';
 setTheme(next,true);
 scheduleLayoutSave();                        // тема поедет в раскладку на сервер
 flashStatus('Theme: '+next);
}

/* --- Скин WindowMaker (View → WindowMaker skin) --------------------------
   Сам скин — блок <style id="openstep-skin" media="not all"> в index.html:
   его включает загрузчик в head до первой отрисовки, когда выбран скин —
   View → WindowMaker skin (localStorage nerevar-hub.skin), ссылка
   ?skin=wm или старый адрес /openstep.html (редирект сюда). Здесь только
   переключение: выбор запоминаем и перезагружаем страницу, чтобы окна
   встали по-новому, как при свежей загрузке скина. */
const SKIN_KEY='nerevar-hub.skin';
function skinOn(){
 const st=document.getElementById('openstep-skin');
 return !!st&&st.getAttribute('media')==='all';
}
function syncSkinMark(){                     // галочка в меню View
 const mark=document.querySelector('[data-skin-mark]');
 if(mark)mark.textContent=skinOn()?'✓':'';
}
function toggleSkin(){
 try{localStorage.setItem(SKIN_KEY,skinOn()?'win9x':'wm')}catch(e){}
 location.reload();
}

/* --- Иконки дока из dock.json (только под скином WindowMaker) ------------
   {"icons":{"winServers":"pics/dock/server.png",…}}: для каждой дельной
   записи даём плитке background-image и прячем букву. Пустые значения,
   отсутствие файла или ошибка чтения — молча ничего не делаем (плитки
   остаются квадратами с буквами). */
async function applyDockIcons(){
 if(!skinOn())return;
 try{
  const r=await fetch('dock.json',{cache:'no-store'});
  if(!r.ok)return;
  const cfg=await r.json();
  const icons=cfg&&cfg.icons&&typeof cfg.icons==='object'?cfg.icons:null;
  if(!icons)return;
  const rules=[];
  Object.keys(icons).forEach(id=>{
   const url=String(icons[id]==null?'':icons[id]).trim(),
         sel=id.replace(/[^\w-]/g,'');
   if(!sel||!/^[\w.@\/-]+$/.test(url))return;
   rules.push('.task[data-window="'+sel+'"]{background-image:url("'+url+'");'
    +'background-size:cover;background-position:center;background-repeat:no-repeat}',
    '.task[data-window="'+sel+'"] .ticon{visibility:hidden}');
  });
  if(!rules.length)return;
  let st=document.getElementById('dock-icons');
  if(!st){st=document.createElement('style');st.id='dock-icons';document.head.appendChild(st);}
  st.textContent=rules.join('\n');
 }catch(e){}
}

/* --- Шрифт интерфейса (config.js / View → Font…) --------------------------
   Строка font-family: начальное значение — CONFIG.font, но выбор в диалоге
   важнее и, как тема, хранится в браузере и едет в раскладку на сервер
   (layout.json), чтобы панель была одинаковой на всех устройствах.
   Список установленных в системе шрифтов сервер отдаёт в GET /api/fonts:
   в Linux их считает fontconfig (fc-list), без утилиты server.py сам
   обходит папки и читает имена из файлов TTF/OTF. */
const FONT_KEY='nerevar-hub.font';
const FONT_DEFAULT='Tahoma, Verdana, sans-serif';
let currentFont=FONT_DEFAULT;
function applyFont(family){                  // ставит шрифт, память не трогает
 family=String(family||'').trim()||FONT_DEFAULT;
 currentFont=family;
 document.documentElement.style.setProperty('--ui-font',family);
 const cur=document.querySelector('[data-font-current]');
 if(cur)cur.textContent=family;
}
function storedFont(){                       // выбор диалога из этого браузера
 try{const v=localStorage.getItem(FONT_KEY);if(v)return v.trim()}catch(e){}
 return null;
}
function defaultFont(){                      // что задано в config.js
 const v=CONFIG.font;
 return (typeof v==='string'&&v.trim())?v.trim():FONT_DEFAULT;
}
function setFont(family,remember){           // remember=false — забыть выбор
 applyFont(family);
 try{remember?localStorage.setItem(FONT_KEY,currentFont):localStorage.removeItem(FONT_KEY)}catch(e){}
}

/* --- диалог View → Font… --------------------------------------------------
   Список берётся у сервера (GET /api/fonts) и рисуется каждым шрифтом из
   списка: видно, как имя выглядит вживую. Строка поиска фильтрует, а если
   введённого имени в списке нет — Enter применяет его как есть. */
const fontOverlay=document.getElementById('fontOverlay');
const fontList=document.querySelector('[data-font-list]');
const fontSearch=document.getElementById('fontSearch');
const fontSource=document.querySelector('[data-font-source]');
let fontFamilies=null,fontLoading=false;
function fontCurrentName(){return currentFont.split(',')[0].trim()}
function renderFontList(){
 if(!fontList)return;
 const q=(fontSearch&&fontSearch.value||'').trim().toLowerCase();
 const rows=(fontFamilies||[]).filter(f=>!q||f.toLowerCase().indexOf(q)>=0);
 if(!rows.length){
  fontList.innerHTML='<div class="font-empty">'+(fontFamilies&&fontFamilies.length
    ?'No font matches “'+esc(q)+'” — press Enter to use it anyway'
    :'The list is not loaded yet — type a font name and press Enter')+'</div>';
  return;
 }
 const cur=fontCurrentName().toLowerCase();
 fontList.innerHTML=rows.map(f=>{
   const on=f.toLowerCase()===cur;
   return '<button type="button" class="font-item'+(on?' on':'')+'"'+
          ' data-font-name="'+esc(f)+'" style="font-family:\''+
          esc(String(f).replace(/['"\\]/g,''))+'\'">'+esc(f)+
          '<span class="tick">'+(on?'&#10003;':'')+'</span></button>';
 }).join('');
}
async function loadFontFamilies(){
 if(fontFamilies||fontLoading)return fontFamilies;
 fontLoading=true;
 try{
  const res=await fetch('api/fonts',{cache:'no-store'});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const data=await res.json();
  fontFamilies=Array.isArray(data.families)?data.families:[];
  if(fontSource)fontSource.textContent=fontFamilies.length+' fonts installed · '+
    (data.source==='fontconfig'
      ? 'found with fontconfig (fc-list)'
      : 'found by scanning the font folders');
 }catch(err){
  fontFamilies=[];
  if(fontSource)fontSource.textContent='System fonts are unavailable — the page is not served by server.py. Type any font name above and press Enter.';
  console.warn('[font]',err);
 }finally{fontLoading=false;}
 renderFontList();
 return fontFamilies;
}
function applyChosenFont(name,remember){
 setFont(name,remember!==false);
 scheduleLayoutSave();                        // шрифт поедет в раскладку на сервер
 flashStatus('Font: '+fontCurrentName());
 renderFontList();
}
function openFontDialog(){
 if(!fontOverlay)return;
 fontOverlay.hidden=false;
 if(fontSearch)fontSearch.value='';
 renderFontList();
 loadFontFamilies();
 if(fontSearch)fontSearch.focus();
}
function closeFontDialog(){if(fontOverlay)fontOverlay.hidden=true}
if(fontSearch){
 fontSearch.addEventListener('input',renderFontList);
 fontSearch.addEventListener('keydown',event=>{
  if(event.key==='Enter'){
   event.preventDefault();
   const value=fontSearch.value.trim();
   if(value)applyChosenFont(value);
  }
 });
}
if(fontList)fontList.addEventListener('click',event=>{
 const item=event.target.closest('[data-font-name]');
 if(item)applyChosenFont(item.dataset.fontName);
});
const fontDefaultBtn=document.querySelector('[data-font-default]');
if(fontDefaultBtn)fontDefaultBtn.addEventListener('click',()=>{
 setFont(defaultFont(),false);               // забыть выбор — снова правит config.js
 scheduleLayoutSave();
 flashStatus('Font: '+fontCurrentName());
 renderFontList();
});

function applyConfig(){
 /* тема и шрифт: выбор кнопки View -> config.js -> значение по умолчанию */
 applyTheme(storedTheme()||(CONFIG.theme==='dark'?'dark':'light'));
 applyFont(storedFont()||defaultFont());
 syncSkinMark();
 applyDockIcons();
 document.title=CONFIG.serverName;
 document.querySelectorAll('[data-server-name]').forEach(el=>{el.textContent=CONFIG.serverName});
 document.querySelectorAll('[data-server-icon]').forEach(el=>{el.textContent=CONFIG.serverIcon});
 document.querySelectorAll('[data-art-title]').forEach(el=>{el.textContent=CONFIG.artWindowTitle});
 document.querySelectorAll('[data-art-file]').forEach(el=>{el.textContent=baseName(CONFIG.artFile)});
 document.querySelectorAll('[data-art-icon]').forEach(el=>{el.textContent=CONFIG.artIcon});
 const mus=CONFIG.music||{};
 document.querySelectorAll('[data-music-title]').forEach(el=>{el.textContent=mus.windowTitle||'Audio Player'});
 document.querySelectorAll('[data-music-icon]').forEach(el=>{el.textContent=mus.icon||'A'});
 const musWin=document.getElementById('winMusic');
 const musBtn=document.querySelector('.task[data-window="winMusic"]');
 if(mus.enabled===false){
  if(musWin)musWin.hidden=true;
  if(musBtn)musBtn.hidden=true;
 }
 const skinBar=document.querySelector('[data-skin-bar]');
 if(skinBar)skinBar.classList.toggle('off',(mus.skins||{}).enabled===false);
 document.body.classList.toggle('number-style-big',CONFIG.numberStyle==='big');
 const mon=CONFIG.monitor||{};
 document.querySelectorAll('[data-monitor-title]').forEach(el=>{el.textContent=mon.windowTitle||'System Monitor'});
 document.querySelectorAll('[data-monitor-icon]').forEach(el=>{el.textContent=mon.icon||'M'});
 const monWin=document.getElementById('winMonitor');
 const monBtn=document.querySelector('.task[data-window="winMonitor"]');
 if(monWin)monWin.hidden=mon.enabled===false;
 if(monBtn)monBtn.hidden=mon.enabled===false;
 /* Network и Download Manager: заголовки, иконки, включение/выключение
    и стартовое состояние — startOpen:true открывает окно сразу при
    загрузке (по умолчанию оба закрыты; их открывают из меню File,
    кликом по карточке сервиса или командой open) */
 const net=CONFIG.network||{};
 document.querySelectorAll('[data-network-title]').forEach(el=>{el.textContent=net.windowTitle||'Network'});
 document.querySelectorAll('[data-network-icon]').forEach(el=>{el.textContent=net.icon||'N'});
 const netWin=document.getElementById('winNetwork');
 const netBtn=document.querySelector('.task[data-window="winNetwork"]');
 const netMenu=document.querySelector('.menu button[data-action="network"]');
 if(netWin)netWin.hidden=net.enabled===false||net.startOpen!==true;
 if(netBtn)netBtn.hidden=net.enabled===false;
 if(netMenu)netMenu.hidden=net.enabled===false;
 const dls=CONFIG.downloads||{};
 document.querySelectorAll('[data-downloads-title]').forEach(el=>{el.textContent=dls.windowTitle||'Download Manager'});
 document.querySelectorAll('[data-downloads-icon]').forEach(el=>{el.textContent=dls.icon||'D'});
 const dlWin=document.getElementById('winDownloads');
 const dlBtn=document.querySelector('.task[data-window="winDownloads"]');
 const dlMenu=document.querySelector('.menu button[data-action="downloads"]');
 if(dlWin)dlWin.hidden=dls.enabled===false||dls.startOpen!==true;
 if(dlBtn)dlBtn.hidden=dls.enabled===false;
 if(dlMenu)dlMenu.hidden=dls.enabled===false;
 /* Telegram: окно-фрейм веб-инстанса — заголовок, иконка, включение
    и стартовое состояние, как у Network/Download Manager */
 const tg=CONFIG.telegram||{};
 document.querySelectorAll('[data-telegram-title]').forEach(el=>{el.textContent=tg.windowTitle||'Telegram'});
 document.querySelectorAll('[data-telegram-icon]').forEach(el=>{el.textContent=tg.icon||'✈'});
 const tgWin=document.getElementById('winTelegram');
 const tgBtn=document.querySelector('.task[data-window="winTelegram"]');
 const tgMenu=document.querySelector('.menu button[data-action="telegram"]');
 if(tgWin)tgWin.hidden=tg.enabled===false||tg.startOpen!==true;
 if(tgBtn)tgBtn.hidden=tg.enabled===false;
 if(tgMenu)tgMenu.hidden=tg.enabled===false;
 /* терминалы: сколько их — CONFIG.term.count (окна клонируются до
    вызова applyConfig — см. cloneTermWindows ниже); заголовок у каждого
    свой:
    первый «Terminal», дальше — «Terminal N». Включены и открыты — все
    разом, раскладка решит позже, останутся ли они открытыми */
 const tcfg=CONFIG.term||{};
 const tOff=tcfg.enabled===false;
 const tOpen=tcfg.startOpen!==false;
 document.querySelectorAll('[data-term-title]').forEach(el=>{
  const n=termIndex(el);
  el.textContent=(tcfg.windowTitle||'Terminal')+(n>1?' '+n:'');
 });
 document.querySelectorAll('[data-term-icon]').forEach(el=>{el.textContent=tcfg.icon||'>'});
 const tMenu=document.querySelector('.menu button[data-action="terminal"]');
 termWindows().forEach(win=>{
  win.hidden=tOff||!tOpen;                 // раскладка решит позже
  const n=termNum(win.id);
  const input=win.querySelector('[data-term-in]');
  if(input)input.setAttribute('aria-label',n>1?'Command (terminal '+n+')':'Command');
  const btn=document.querySelector('.task[data-window="'+win.id+'"]');
  if(btn)btn.hidden=tOff;
 });
 if(tMenu)tMenu.hidden=tOff;
 document.querySelectorAll('[data-term-prompt]').forEach(el=>{
  el.textContent=(tcfg.user||'nerevar')+'@'+(CONFIG.serverName||'server')+':~$';
 });
 const wt=document.querySelector('.welcome h1');
 if(wt)wt.textContent=CONFIG.welcomeTitle;
 const wp=document.querySelector('.welcome p');
 if(wp)wp.textContent=CONFIG.welcomeText;
 const footer=document.querySelector('.footer');
 if(footer)footer.textContent=CONFIG.serverName;
 lanInput.value=CONFIG.lanHost;
 tailInput.value=CONFIG.tailscaleHost;
 lanInput.placeholder=CONFIG.lanHost;
 tailInput.placeholder=CONFIG.tailscaleHost;
 renderServices();
 renderHelp();
}
function cleanHost(value){return value.trim().replace(/^https?:\/\//i,'').replace(/\/+$/,'')}
function updateLinks(){
 const lan=cleanHost(lanInput.value),tail=cleanHost(tailInput.value);
 document.querySelectorAll('a[data-port]').forEach(link=>{
  const host=link.dataset.host==='lan'?lan:tail;
  link.href=host?`http://${host}:${link.dataset.port}`:'#';
  link.target='_blank';link.rel='noopener noreferrer';
 });
}
/* --- Picture Viewer: сколько окон — решает config.js ----------------------
   #winArt — шаблон и первое окно; остальные копируются сюда же, ДО
   applyConfig(): тот расписывает заголовки, иконку и имя файла
   querySelectorAll'ем по всей странице, поэтому копии должны уже существовать.
   У каждой копии своя кнопка в таскбаре и свои data-win-* в заголовке. */
function viewerCount(){
 const n=Number(CONFIG.viewers);
 if(!isFinite(n))return 2;                  // по умолчанию два окна
 return Math.min(6,Math.max(1,Math.round(n)));
}
(function cloneViewerWindows(){
 const tpl=document.getElementById('winArt');
 const task=document.querySelector('.task[data-window="winArt"]');
 if(!tpl||!tpl.parentNode)return;
 let winAnchor=tpl,taskAnchor=task;
 for(let i=2;i<=viewerCount();i++){
  const id='winArt'+i;
  const win=tpl.cloneNode(true);
  win.id=id;
  ['min','max','close'].forEach(k=>{
   const el=win.querySelector('[data-win-'+k+']');
   if(el)el.setAttribute('data-win-'+k,id);
  });
  winAnchor.parentNode.insertBefore(win,winAnchor.nextSibling);
  winAnchor=win;
  if(task){
   const btn=task.cloneNode(true);
   btn.dataset.window=id;
   taskAnchor.parentNode.insertBefore(btn,taskAnchor.nextSibling);
   taskAnchor=btn;
  }
 }
})();
/* --- Терминалы: сколько консолей на экране — решает config.js -------------
   #winTerm — первое окно, #winTerm2 — второе (оно же шаблон для копий).
   count = 1 — второе окно и его кнопка в таскбаре убираются; count = 3..6 —
   окна копируются здесь же, ДО applyConfig(): тот расписывает заголовки,
   иконки и подписи querySelectorAll'ем по всей странице. Все окна
   открываются сразу (startOpen), дальше живут как обычные окна раскладки:
   закрываются крестиком, запоминаются в layout.json. */
function termCount(){
 const n=Number((CONFIG.term||{}).count);
 if(!isFinite(n))return 2;                  // по умолчанию два окна
 return Math.min(6,Math.max(1,Math.round(n)));
}
function isTermWin(w){return !!w&&/^winTerm\d*$/.test(w.id||'')}
function termWindows(){return Array.from(document.querySelectorAll('.appwindow')).filter(isTermWin)}
function termNum(id){const m=/^winTerm(\d*)$/.exec(id||'');return m?(m[1]?Number(m[1]):1):1}
/* у какого терминала этот узел: он лежит либо в самом окне, либо в его
   кнопке в таскбаре — номер читаем по id (winTerm -> 1, winTerm3 -> 3) */
function termIndex(el){
 const host=el.closest('.appwindow')||el.closest('.task');
 return termNum(host?(host.id||host.dataset.window||''):'');
}
(function cloneTermWindows(){
 const tpl=document.getElementById('winTerm2');
 const task=document.querySelector('.task[data-window="winTerm2"]');
 if(termCount()<2){
  if(tpl&&tpl.parentNode)tpl.parentNode.removeChild(tpl);
  if(task&&task.parentNode)task.parentNode.removeChild(task);
  return;
 }
 if(!tpl||!tpl.parentNode)return;
 let winAnchor=tpl,taskAnchor=task;
 for(let i=3;i<=termCount();i++){
  const id='winTerm'+i;
  const win=tpl.cloneNode(true);
  win.id=id;
  ['min','max','close'].forEach(k=>{
   const el=win.querySelector('[data-win-'+k+']');
   if(el)el.setAttribute('data-win-'+k,id);
  });
  winAnchor.parentNode.insertBefore(win,winAnchor.nextSibling);
  winAnchor=win;
  if(task){
   const btn=task.cloneNode(true);
   btn.dataset.window=id;
   taskAnchor.parentNode.insertBefore(btn,taskAnchor.nextSibling);
   taskAnchor=btn;
  }
 }
})();
applyConfig();
lanInput.addEventListener('input',updateLinks);tailInput.addEventListener('input',updateLinks);updateLinks();

const openOverlay=document.getElementById('openOverlay');
const openInput=document.getElementById('artUrl');
const fileInput=document.getElementById('artFileInput');
const artErr=document.getElementById('artErr');

/* --- Picture Viewer: сколько окон и как они живут -------------------------
   В разметке окно одно (#winArt) — оно же шаблон: сколько их открывать,
   решает CONFIG.viewers (1..6, по умолчанию 2), копии создаются до
   applyConfig() — см. cloneViewerWindows. Каждое окно живёт своей жизнью:
   свой режим (арт/картинка), свой зум, свой objectURL и своё имя файла в
   заголовке. Общее у них только содержимое: CONFIG.artFile / CONFIG.picFile
   и папка pics/ — при '~' каждое окно при загрузке зовёт Math.random само
   по себе, поэтому выбирает СВОЮ случайную картинку. */
const viewers=[];             // все окна Picture Viewer, по порядку
let activeViewer=null;        // в какое окно уйдёт File → Open image…

function isBlankLine(line){return line.replace(/[\s\u2800]/g,'').length===0}
function normalizeArt(text){
 const lines=text.split('\n');
 let a=0,b=lines.length;
 while(a<b&&isBlankLine(lines[a]))a++;
 while(b>a&&isBlankLine(lines[b-1]))b--;
 return lines.slice(a,b).join('\n');
}
function makeViewer(win,task,index){
 /* scope — окно и его кнопка в таскбаре: заголовок, иконка и имя файла
    продублированы в обоих, поэтому ищем по обоим разом */
 const scope=task?[win,task]:[win];
 const pick=sel=>scope.reduce((a,el)=>a.concat(Array.from(el.querySelectorAll(sel))),[]);
 return {
  index:index,win:win,task:task,
  stage:win.querySelector('.art-stage'),
  wrap:win.querySelector('.art-wrap'),
  pre:win.querySelector('pre'),
  img:win.querySelector('.art-img'),
  fileEls:pick('[data-art-file]'),
  titleEls:pick('[data-art-title]'),
  iconEls:pick('[data-art-icon]'),
  mode:'ascii',               // 'ascii' | 'image'
  zoom:1,                     // View → Zoom — своё у каждого окна
  blobUrl:null,               // objectURL последнего открытого файла
  shown:'',                   // имя последней реально показанной картинки
  fitting:false               // внутри fitAscii — не перезапускаем себя же
 };
}
function viewerTitle(v){
 const base=(typeof CONFIG!=='undefined'&&CONFIG.artWindowTitle)||'Picture Viewer';
 return v.index>1?base+' '+v.index:base;
}
function applyViewerTitles(){
 /* applyConfig пишет одинаковый заголовок во все окна — здесь разводим по
    номерам: «Picture Viewer», «Picture Viewer 2», … */
 viewers.forEach(v=>v.titleEls.forEach(el=>{el.textContent=viewerTitle(v)}));
}
function isViewer(win){return viewers.some(v=>v.win===win)}
function viewerFor(win){return viewers.find(v=>v.win===win)||null}
/* диалог открытия один на все окна, но адресат у него один — последнее
   активное окно (activeViewer); в диалоге это подписано */
function setOpenError(msg){
 if(!artErr)return;
 if(!msg){artErr.hidden=true;artErr.textContent='';return}
 artErr.textContent=msg;
 artErr.hidden=false;
}

/* --- pics/: единственное место, где лежат и картинки, и ascii-арт --------
   В config.js — только имена файлов (CONFIG.artFile / CONFIG.picFile),
   само содержимое читается с сервера отсюда. */
function baseName(path){return String(path||'').split('/').pop()||''}
function picsPath(name){return String(name||'').replace(/^\/?pics\//,'')}
function picsUrl(name){
 return 'pics/'+picsPath(name).split('/').map(encodeURIComponent).join('/');
}
let picsList=null;
function fetchPics(){
 if(picsList)return Promise.resolve(picsList);
 return fetch('api/pics',{cache:'no-store'})
  .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
  .then(j=>{picsList={images:(j&&j.images)||[],art:(j&&j.art)||[]};return picsList});
}
let artText=null;             // текст арта: он один на все окна — читаем один раз
/* читает ascii-арт из pics/ и подставляет в <pre> каждого окна */
async function loadArt(){
 const name=(CONFIG.artFile||'').trim();
 if(!name)return;
 // '~' выбирает КАРТИНКУ — это поле не про арт; подсказываем прямо в ошибке
 if(name.charAt(0)==='~'){
  const why="'~' selects a picture - set it in CONFIG.picFile (artFile needs a text file)";
  viewers.forEach(v=>picFail(v,baseName(name),why));
  return;
 }
 try{
  if(artText===null){
   const r=await fetch(picsUrl(name),{cache:'no-store'});
   if(!r.ok)throw new Error('HTTP '+r.status);
   const text=await r.text();
   if(!text.replace(/[\s\u2800]/g,''))throw new Error('file is empty');
   artText=normalizeArt(text);
  }
  const file=baseName(name);
  viewers.forEach(v=>{
   v.pre.textContent=artText;
   setArtFileName(v,file);
   fitAscii(v);
   autoSizeViewer(v);        // окно под пропорции арта (если его не тянули руками)
  });
 }catch(err){
  // причина видна в заголовке: Cannot open: name — HTTP 404
  const why=(err&&err.message)||'';
  viewers.forEach(v=>picFail(v,baseName(name),why));
 }
}
/* '~.png' / '~.gif' / '~' -> имя случайной картинки из pics/ */
async function resolvePic(spec){
 spec=String(spec||'').trim();
 if(spec.charAt(0)!=='~')return spec;
 const list=await fetchPics();
 const ext=spec.slice(1).toLowerCase();        // '' | '.png' | '.gif'
 const pool=(list.images||[]).filter(f=>!ext||f.toLowerCase().endsWith(ext));
 if(!pool.length)throw new Error(ext?('no '+ext+' files in pics/'):'pics/ has no images');
 return pool[Math.floor(Math.random()*pool.length)];
}
/* картинка, заданная в конфиге (в т.ч. случайная): своё число случайности
   у каждого окна, поэтому каждое окно зовёт resolvePic само за собой */
function initPicture(v){
 const spec=(CONFIG.picFile||'').trim();
 if(!spec)return Promise.resolve();
 return openFromPics(v,spec);
}

/* --- подгонка содержимого под окно ---------------------------------------
   fitAscii() без аргумента подгоняет ВСЕ окна (так зовут resize, шрифты и
   показ окна), fitAscii(v) — только своё. Режим, зум и пропорции у каждого
   окна свои, поэтому считать приходится отдельно для каждого. */
function fitAscii(v){
 if(!v){viewers.forEach(x=>fitAscii(x));return}
 if(v.fitting)return;
 v.fitting=true;
 try{
  if(v.mode==='image'){fitImageArt(v);return}
  const normalized=normalizeArt(v.pre.textContent);
  if(normalized!==v.pre.textContent)v.pre.textContent=normalized;
  const cs=getComputedStyle(v.wrap);
  const padX=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
  const padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);
  const availW=v.stage.clientWidth-padX;
  const availH=v.stage.clientHeight-padY;
  const REF=100;
  v.pre.style.fontSize=REF+'px';
  const artW=v.pre.scrollWidth||1;
  const artH=v.pre.scrollHeight||1;
  const scaleW=availW>0?availW/artW:Infinity;
  const scaleH=availH>0?availH/artH:Infinity;
  let scale=Math.min(scaleW,scaleH);
  if(!isFinite(scale))scale=1;
  scale*=v.zoom;
  v.pre.style.fontSize=Math.max(1,REF*scale).toFixed(3)+'px';
 }finally{v.fitting=false}
}
function measureArtRef(v){
  const REF=100,prev=v.pre.style.fontSize;
  v.pre.style.fontSize=REF+'px';
  const w=v.pre.scrollWidth||1,h=v.pre.scrollHeight||1;
  v.pre.style.fontSize=prev;
  return {w:w,h:h};
}
function artAspect(v){
  if(v.mode==='image'){
    const w=v.img.naturalWidth,h=v.img.naturalHeight;
    if(w>0&&h>0)return w/h;
  }
  const m=measureArtRef(v);
  return m.w/m.h;
}

/* --- Picture Viewer: картинки и GIF --------------------------------------
   Режим 'image' прячет <pre> и показывает <img>: GIF проигрывается
   браузером сам, пропорции не искажаются (одинаковый коэффициент по обеим
   сторонам), View → Zoom действует и на картинку — но только на своё окно. */
function fitImageArt(v){
  const w=v.img.naturalWidth,h=v.img.naturalHeight;
  if(!w||!h)return;
  const cs=getComputedStyle(v.wrap);
  const padX=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
  const padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);
  const availW=v.stage.clientWidth-padX,availH=v.stage.clientHeight-padY;
  if(availW<=0||availH<=0)return;
  const k=Math.min(availW/w,availH/h)*v.zoom;   // contain-fit, без искажений
  v.img.style.width=Math.max(1,w*k).toFixed(2)+'px';
  v.img.style.height=Math.max(1,h*k).toFixed(2)+'px';
}
function setArtFileName(v,name){
 v.fileEls.forEach(el=>{el.textContent=name});
 if(!/^(Cannot open:|Not an image:)/.test(name||''))v.shown=name;
}
function defaultArtName(){
 return (typeof CONFIG!=='undefined'&&CONFIG.artFile)?baseName(CONFIG.artFile):'Picture';
}
function freeArtBlob(v){
 if(v.blobUrl){URL.revokeObjectURL(v.blobUrl);v.blobUrl=null}
}
function showAsciiArt(v){
 v=v||activeViewer||viewers[0];
 if(!v)return;
 v.mode='ascii';
 v.img.hidden=true;
 v.img.removeAttribute('src');
 v.img.style.width='';v.img.style.height='';v.img.style.transform='';
 v.wrap.style.maxWidth='';v.wrap.style.overflow='';
 freeArtBlob(v);
 v.pre.hidden=false;
 setArtFileName(v,defaultArtName());
 fitAscii(v);
 autoSizeViewer(v);
}
function showImage(v,src,name){
 if(!v||!src)return;
 // сначала пробуем загрузить отдельным изображением: если адрес мёртвый,
 // текущая картинка остаётся на месте, а диалог не закрывается
 const probe=new Image();
 probe.onload=()=>{
  probe.onload=null;probe.onerror=null;
  const img=v.img;
  img.onload=()=>{
   img.onload=null;img.onerror=null;
   v.mode='image';
   v.pre.hidden=true;
   img.hidden=false;
   // картинка может быть шире окна (View → Zoom) — не даём .art-wrap её обрезать
   v.wrap.style.maxWidth='none';
   v.wrap.style.overflow='visible';
   setArtFileName(v,name||'image');
   if(!v.win.hidden)focusWindow(v.win); // окно поднимается наверх; закрытое не активируем
   fitAscii(v);
   autoSizeViewer(v);      // окно под пропорции картинки (если его не тянули руками)
   closeOpenDialog();
  };
  img.src=src;
 };
 probe.onerror=()=>{
  probe.onload=null;probe.onerror=null;
  picFail(v,name||src,'not found or not an image'); // диалог остаётся — можно исправить адрес
 };
 probe.src=src;
}
function openLocalFile(v,file){
 if(!file)return false;
 if(file.type&&!/^image\//.test(file.type)){
  setArtFileName(v,'Not an image: '+file.name);
  return false;
 }
 freeArtBlob(v);
 v.blobUrl=URL.createObjectURL(file);
 showImage(v,v.blobUrl,file.name);
 return true;
}
function nameFromUrl(url){
 try{const u=new URL(url,location.href);return decodeURIComponent(u.pathname.split('/').pop())||u.hostname}
 catch(e){return 'image'}
}
/* общий отказ: причина попадает и в заголовок окна, и в открытый диалог */
function picFail(v,what,why){
 const msg='Cannot open: '+what+(why?(' — '+why):'');
 if(v)setArtFileName(v,msg);
 setOpenError(msg);
 console.warn('[picture viewer]',msg);
}
/* открыть картинку из pics/: имя ('cat.png') или маска ('~.jpg' / '~.gif' / '~') */
function openFromPics(v,spec){
 return resolvePic(spec)
  .then(file=>{setOpenError('');showImage(v,picsUrl(file),baseName(file))})
  .catch(err=>picFail(v,spec,(err&&err.message)||''));
}
function currentViewer(){
 /* окно, с которым сейчас работаем: в последнее раз тыкнули в него мышью.
    На него действуют File → Open image…, View → Zoom и Back to ASCII art. */
 return activeViewer||viewers[0]||null;
}
function openOpenDialog(){
 if(!openOverlay)return;
 const target=currentViewer();
 const label=openOverlay.querySelector('[data-open-target]');
 if(label)label.textContent=target?viewerTitle(target):'Picture Viewer';
 openOverlay.hidden=false;
 openInput.value='';
 setOpenError('');
 openInput.focus();
}
function closeOpenDialog(){
 if(openOverlay)openOverlay.hidden=true;
 /* закрыли диалог после неудачной попытки (Esc/Cancel) — в заголовок
    возвращается имя последней показанной картинки, а не текст ошибки */
 const v=currentViewer();
 if(!v)return;
 v.fileEls.forEach(el=>{
  if(/^Cannot open:/.test(el.textContent)&&v.shown)el.textContent=v.shown;
 });
}
function openFromInput(){
 const v=currentViewer();
 if(!v)return;
 const value=(openInput.value||'').trim();
 if(!value)return;
 // '~.jpg' / '~.gif' / '~' — случайная картинка из pics/, как в CONFIG.picFile
 if(value.charAt(0)==='~')return openFromPics(v,value);
 setOpenError('');
 showImage(v,value,nameFromUrl(value));
}

const artOk=document.getElementById('artOpenOk');
if(artOk)artOk.addEventListener('click',openFromInput);
const artBrowse=document.getElementById('artBrowse');
if(artBrowse)artBrowse.addEventListener('click',()=>fileInput.click());
if(openInput)openInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openFromInput()}});
if(openInput)openInput.addEventListener('input',()=>setOpenError(''));
if(openOverlay)openOverlay.addEventListener('click',e=>{if(e.target===openOverlay)closeOpenDialog()});
if(fileInput)fileInput.addEventListener('change',()=>{
 const f=fileInput.files&&fileInput.files[0];
 fileInput.value='';
 if(f){closeOpenDialog();openLocalFile(currentViewer(),f)}
});

/* --- сборка окон: у каждого своё содержимое и свои наблюдатели ----------- */
function bindViewerDrag(v){
 const win=v.win;
 /* перетаскивание файла прямо на окно Picture Viewer */
 ['dragover','dragenter'].forEach(t=>win.addEventListener(t,e=>{
  const types=e.dataTransfer&&e.dataTransfer.types;
  if(types&&Array.from(types).indexOf('Files')<0)return;
  e.preventDefault();
  win.classList.add('dropping');
 }));
 ['dragleave','dragend'].forEach(t=>win.addEventListener(t,e=>{
  if(t==='dragleave'&&e.relatedTarget&&win.contains(e.relatedTarget))return;
  win.classList.remove('dropping');
 }));
 win.addEventListener('drop',e=>{
  e.preventDefault();
  win.classList.remove('dropping');
  const dt=e.dataTransfer;if(!dt)return;
  const files=Array.from(dt.files||[]);
  if(files.length){
   const file=files.find(f=>!f.type||/^image\//.test(f.type));
   if(file)openLocalFile(v,file);
   else setArtFileName(v,'Not an image: '+files[0].name); // просто сообщаем и ничего не ломаем
   return;
  }
  const url=(dt.getData('text/uri-list')||dt.getData('text/plain')||'').split('\n')[0].trim();
  if(/^(https?:|data:|blob:)/i.test(url))showImage(v,url,nameFromUrl(url));
 });
}
function buildViewers(){
 document.querySelectorAll('.art-window').forEach((win,i)=>{
  const v=makeViewer(win,document.querySelector('.task[data-window="'+win.id+'"]'),i+1);
  viewers.push(v);
  /* наблюдатели — по одному набору на окно: арт и картинка живут отдельно */
  window.addEventListener('resize',()=>fitAscii(v));
  if('ResizeObserver'in window)new ResizeObserver(()=>fitAscii(v)).observe(v.stage);
  new MutationObserver(()=>fitAscii(v)).observe(v.pre,{childList:true,characterData:true,subtree:true});
  bindViewerDrag(v);
 });
 applyViewerTitles();
 activeViewer=viewers[0]||null;
 fitAscii();
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>fitAscii());
buildViewers();

const menuitems=[...document.querySelectorAll('.menuitem[data-menu]')];
function closeMenus(except){menuitems.forEach(m=>{if(m!==except)m.classList.remove('open')})}
menuitems.forEach(item=>{
 item.addEventListener('click',event=>{
  if(event.target.closest('.menu'))return;
  event.stopPropagation();
  const willOpen=!item.classList.contains('open');
  closeMenus(item);
  item.classList.toggle('open',willOpen);
 });
 item.addEventListener('mouseenter',()=>{
  if(document.querySelector('.menuitem.open')){closeMenus(item);item.classList.add('open')}
 });
});
document.addEventListener('click',()=>closeMenus());
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenus();closeHelp();closeOpenDialog();closeLayoutPalette();closeFontDialog()}});
document.querySelectorAll('.menu button').forEach(btn=>btn.addEventListener('click',event=>{
 event.stopPropagation();runAction(btn.dataset.action);closeMenus();
}));
document.querySelectorAll('.menuitem[data-action]').forEach(item=>item.addEventListener('click',event=>{
 event.stopPropagation();runAction(item.dataset.action);
}));

function setZoom(value){
 /* зум свой у каждого окна — крутим его у последнего активного */
 const v=currentViewer();
 if(!v)return;
 v.zoom=Math.min(4,Math.max(.25,value));
 fitAscii(v);
}
function openRoot(which){
 const host=cleanHost(which==='lan'?lanInput.value:tailInput.value);
 if(host)window.open('http://'+host,'_blank','noopener');
}
function copyLinks(){
 const links=[...document.querySelectorAll('a[data-port]')].map(a=>a.href).filter(h=>h&&h!=='#'&&!h.endsWith('#'));
 const text=links.join('\n');
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text);
}
function toggleFullscreen(){
 if(!document.fullscreenElement)document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();
 else document.exitFullscreen&&document.exitFullscreen();
}
function runAction(action){
 switch(action){
  case 'reload':location.reload();break;
  case 'copy-links':copyLinks();break;
  case 'exit':window.close();break;
  case 'open-image':openOpenDialog();break;
  case 'back-ascii':showAsciiArt();break;
  case 'audio':showWindow(document.getElementById('winMusic'),true);break;
  case 'terminal':showWindow(document.getElementById('winTerm'),true);break;
  case 'network':showWindow(document.getElementById('winNetwork'),true);break;
  case 'downloads':showWindow(document.getElementById('winDownloads'),true);break;
  case 'telegram':case 'tg':showWindow(document.getElementById('winTelegram'),true);break;
  case 'zoom-in':{const v=currentViewer();if(v)setZoom(v.zoom*1.15);break;}
  case 'zoom-out':{const v=currentViewer();if(v)setZoom(v.zoom/1.15);break;}
  case 'zoom-reset':setZoom(1);break;
  case 'toggle-services':{
   const services=document.querySelector('.services');
   const title=document.querySelector('.group-title');
   services.hidden=!services.hidden;
   if(title)title.hidden=services.hidden;
   layoutWindows();
   break;
  }
  case 'toggle-fullscreen':toggleFullscreen();break;
  case 'layout':openLayoutPalette();break;
  case 'layout-save':saveLayoutNow(true);break;
  case 'layout-reset':resetLayout();break;
  case 'theme':toggleTheme();break;
  case 'skin':toggleSkin();break;
  case 'font':openFontDialog();break;
  case 'open-lan':openRoot('lan');break;
  case 'open-tail':openRoot('tail');break;
  case 'favorite':window.open(CONFIG.favoriteUrl,'_blank','noopener');break;
  case 'help':openHelp();break;
 }
}

const helpOverlay=document.querySelector('#helpOverlay');
const helpWindow=document.querySelector('#helpWindow');
function centerHelp(){helpWindow.style.position='';helpWindow.style.left='';helpWindow.style.top='';helpWindow.style.margin='';helpWindow.style.transform=''}
function openHelp(){centerHelp();helpOverlay.hidden=false}
function closeHelp(){helpOverlay.hidden=true}
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>{
 const target=document.getElementById(el.dataset.close);
 if(target)target.hidden=true;
}));
helpOverlay.addEventListener('click',event=>{if(event.target===helpOverlay)closeHelp()});

(function enableHelpDrag(){
 let dragging=false,offsetX=0,offsetY=0;
 helpWindow.addEventListener('pointerdown',event=>{
  const bar=event.target.closest('[data-drag-window]');
  if(!bar||event.target.closest('.window-controls'))return;
  const rect=helpWindow.getBoundingClientRect();
  dragging=true;offsetX=event.clientX-rect.left;offsetY=event.clientY-rect.top;
  helpWindow.style.position='fixed';helpWindow.style.margin='0';
  helpWindow.style.left=rect.left+'px';helpWindow.style.top=rect.top+'px';helpWindow.style.transform='none';
 });
 window.addEventListener('pointermove',event=>{
  if(!dragging)return;
  helpWindow.style.left=Math.max(0,event.clientX-offsetX)+'px';
  helpWindow.style.top=Math.max(0,event.clientY-offsetY)+'px';
 });
 window.addEventListener('pointerup',()=>{dragging=false});
})();

const scene=document.querySelector('#scene');
const appWindows=[...document.querySelectorAll('.appwindow')];
const taskButtons=[...document.querySelectorAll('.task')];
let zCounter=10,dragState=null,resizeState=null;
/* --- конструктор раскладки (View → Layout constructor…) -----------------
   Окна можно перетаскивать и раскладывать как угодно, а потом сохранить:
   раскладка лежит на сервере (POST /api/layout -> layout.json) и одинакова
   для всех устройств. Переменные объявлены здесь (а не рядом с функциями),
   потому что showWindow/initMusic зовутся во время разбора скрипта. */
let layoutReady=false;        // init закончен — можно сохранять изменения
let layoutApplying=false;     // применяем сохранённое — сохранять не надо
let savedLayout=null;         // последняя раскладка (для пересчёта при resize)
let layoutSaveTimer=null,flashTimer=null;
const LAYOUT_KEY='nerevar-hub.layout';   // зеркало раскладки в localStorage
const layoutPaletteEl=document.getElementById('layoutPalette'); // до initMusic!
let paletteDrag=null;

function taskFor(win){return taskButtons.find(b=>b.dataset.window===win.id)}
function focusWindow(win){
 appWindows.forEach(w=>{if(w!==win)w.classList.remove('active')});
 taskButtons.forEach(b=>b.classList.remove('active'));
 win.classList.add('active');
 win.style.zIndex=++zCounter;
 const btn=taskFor(win);if(btn)btn.classList.add('active');
 /* последнее активное окно Picture Viewer — адресат File → Open image… */
 const fv=viewerFor(win);if(fv)activeViewer=fv;
}
function showWindow(win,show){
 win.hidden=!show;
 if(show){focusWindow(win);fitAscii();
  if(win.dataset.autoplace==='1')placeMonitor();
  if(win.id==='winMusic')placeMusic();
  if(win.id==='winNetwork'||win.id==='winDownloads'||win.id==='winTelegram')placeExtra(win);
  if(isTermWin(win)){
   const t=termByWin(win);
   placeTerm(win);
   if(t)termShow(t);
  }}
 else{const btn=taskFor(win);if(btn)btn.classList.remove('active');}
 /* открыли или закрыли просмотрщик — доли пересчитываются: закрытые окна
    места не занимают, остальные разъезжаются на свободное; терминал и
    монитор переставляются вслед за ними, чтобы не остаться под окном */
 if(isViewer(win)){autoSizeArt();placeMonitor();placeTerm();}
 scheduleLayoutSave();syncLayoutPalette();   // открыли/закрыли окно — запоминаем
}
function clampWindow(win){
 const sw=scene.clientWidth,sh=scene.clientHeight;
 let left=parseFloat(win.style.left),top=parseFloat(win.style.top);
 let w=win.offsetWidth,h=win.offsetHeight;
 w=Math.min(w,sw);h=Math.min(h,sh);
 left=Math.min(Math.max(isNaN(left)?0:left,0),Math.max(0,sw-60));
 top=Math.min(Math.max(isNaN(top)?0:top,0),Math.max(0,sh-24));
 win.style.left=left+'px';win.style.top=top+'px';
 win.style.width=w+'px';win.style.height=h+'px';
}

appWindows.forEach(win=>{
    win.addEventListener('pointerdown',event=>{
    if(event.target.closest('.resize-grip'))return;
    if(!win.hidden)focusWindow(win);
   },true);
    const bar=win.querySelector('.titlebar');
   bar.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('.window-controls')||event.target.closest('.resize-grip'))return;
    resizeState=null;
    win.dataset.manual='1';         // ручное положение не трогают авто-расстановки
    const rect=win.getBoundingClientRect(),sr=scene.getBoundingClientRect();
    const left=rect.left-sr.left,top=rect.top-sr.top;
    win.style.width=rect.width+'px';win.style.height=rect.height+'px';
    win.style.right='auto';win.style.bottom='auto';
    win.style.left=left+'px';win.style.top=top+'px';
    dragState={win,offX:event.clientX-left,offY:event.clientY-top};
    try{bar.setPointerCapture(event.pointerId)}catch(e){}
    event.preventDefault();
   });
   const grip=win.querySelector('.resize-grip');
   if(grip)grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    dragState=null;
    const rect=win.getBoundingClientRect(),sr=scene.getBoundingClientRect();
    const left=rect.left-sr.left,top=rect.top-sr.top;
    win.style.width=rect.width+'px';win.style.height=rect.height+'px';
    win.style.right='auto';win.style.bottom='auto';
    win.style.left=left+'px';win.style.top=top+'px';
const cs=getComputedStyle(win);
   resizeState={win,startX:event.clientX,startY:event.clientY,startW:rect.width,startH:rect.height,
    minW:parseFloat(cs.minWidth)||260,minH:parseFloat(cs.minHeight)||160};
   win.dataset.manual='1';
   try{grip.setPointerCapture(event.pointerId)}catch(e){}
    event.preventDefault();
    event.stopPropagation();
   });
   });

window.addEventListener('pointermove',event=>{
 if(dragState){
  const sw=scene.clientWidth,sh=scene.clientHeight,win=dragState.win;
  let left=event.clientX-dragState.offX,top=event.clientY-dragState.offY;
  left=Math.min(Math.max(left,-(win.offsetWidth-40)),sw-40);
  top=Math.min(Math.max(top,0),sh-24);
  win.style.left=left+'px';win.style.top=top+'px';
 }
if(resizeState){
   const sw=scene.clientWidth,sh=scene.clientHeight,win=resizeState.win;
   const left=parseFloat(win.style.left)||0,top=parseFloat(win.style.top)||0;
   const w=Math.min(Math.max(resizeState.minW,resizeState.startW+(event.clientX-resizeState.startX)),sw-left);
   const h=Math.min(Math.max(resizeState.minH,resizeState.startH+(event.clientY-resizeState.startY)),sh-top);
   win.style.width=w+'px';win.style.height=h+'px';
  }
});
function endGesture(){
 const moved=dragState||resizeState;      // было перемещение/изменение размера?
 dragState=null;resizeState=null;
 if(moved){scheduleLayoutSave();syncLayoutPalette();}
}
window.addEventListener('pointerup',endGesture);
window.addEventListener('pointercancel',endGesture);
window.addEventListener('blur',endGesture);

document.querySelectorAll('[data-win-close]').forEach(el=>el.addEventListener('click',event=>{
 event.stopPropagation();
 const win=document.getElementById(el.dataset.winClose);if(win)showWindow(win,false);
}));
document.querySelectorAll('[data-win-min]').forEach(el=>el.addEventListener('click',event=>{
 event.stopPropagation();
 const win=document.getElementById(el.dataset.winMin);if(win)showWindow(win,false);
}));
document.querySelectorAll('[data-win-max]').forEach(el=>el.addEventListener('click',event=>{
 event.stopPropagation();
 const win=document.getElementById(el.dataset.winMax);if(!win)return;
 setMaximized(win,win.dataset.maximized!=='1');
 scheduleLayoutSave();syncLayoutPalette();
}));

taskButtons.forEach(btn=>btn.addEventListener('click',()=>{
 const win=document.getElementById(btn.dataset.window);if(!win)return;
 if(win.hidden)showWindow(win,true);
 else if(btn.classList.contains('active'))showWindow(win,false);
 else focusWindow(win);
}));

window.addEventListener('resize',()=>{layoutWindows(true);fitAscii()});
function tick(){
  const el=document.getElementById('clock');if(!el)return;
  const now=new Date();
  const d=el.querySelector('[data-clock-date]'),t=el.querySelector('[data-clock-time]');
  // формат: День недели в 2 символа / Мес / Д / Г  ->  Mo/Nov/2/2026
  if(d)d.textContent=now.toLocaleDateString('en-US',{weekday:'short'}).slice(0,2)+'/'
    +now.toLocaleDateString('en-US',{month:'short'})+'/'
    +now.getDate()+'/'+now.getFullYear();
  if(t)t.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
tick();setInterval(tick,10000);

/* --- Календарь: клик по часам в таскбаре ----------------------------- */
const CAL_MONTHS=['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
const CAL_WD_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const CAL_MO_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const calPop=document.getElementById('calPop');
const calClock=document.getElementById('clock');
let calView=new Date();          // первый день показываемого месяца
calView.setDate(1);
let calSelected=null;            // выбранная дата (или null)

function calSameDay(a,b){
  return !!a&&!!b&&a.getFullYear()===b.getFullYear()&&
         a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}
function calLongDate(d){
  return CAL_WD_SHORT[d.getDay()]+', '+CAL_MO_SHORT[d.getMonth()]+' '+
         d.getDate()+', '+d.getFullYear();
}
function renderCalendar(){
  if(!calPop)return;
  const y=calView.getFullYear(),m=calView.getMonth();
  const label=calPop.querySelector('[data-cal-label]');
  if(label)label.textContent=CAL_MONTHS[m]+' '+y;

  const pad=new Date(y,m,1).getDay();            // 0 = Sunday
  const daysInMonth=new Date(y,m+1,0).getDate();
  const prevDays=new Date(y,m,0).getDate();
  const today=new Date();
  const cells=[];
  for(let i=0;i<42;i++){                          // всегда 6 строк — высота не прыгает
    const day=i-pad+1;
    let date,cls='';
    if(day<1){date=new Date(y,m-1,prevDays+day);cls='muted'}
    else if(day>daysInMonth){date=new Date(y,m+1,day-daysInMonth);cls='muted'}
    else date=new Date(y,m,day);
    if(calSameDay(date,today))cls+=(cls?' ':'')+'today';
    if(calSameDay(date,calSelected))cls+=(cls?' ':'')+'sel';
    cells.push('<td class="'+cls+'" data-cal-date="'+date.getTime()+'">'+date.getDate()+'</td>');
  }
  let html='';
  for(let i=0;i<42;i+=7)html+='<tr>'+cells.slice(i,i+7).join('')+'</tr>';
  const body=calPop.querySelector('[data-cal-body]');
  if(body)body.innerHTML=html;

  const out=calPop.querySelector('[data-cal-long]');
  if(out)out.textContent=calLongDate(calSelected||today);
}
function openCal(){
  calView=new Date();calView.setDate(1);   // при открытии — всегда текущий месяц
  calPop.hidden=false;
  calClock.classList.add('on');
  renderCalendar();
}
function closeCal(){
  calPop.hidden=true;
  calClock.classList.remove('on');
}
function toggleCal(){calPop.hidden?openCal():closeCal()}
calClock.addEventListener('click',event=>{
  event.stopPropagation();
  closeMenus();                 // календарь и меню одновременно не держим
  toggleCal();
});
calPop.addEventListener('click',event=>event.stopPropagation());  // клик внутри не закрывает
calPop.querySelectorAll('[data-cal]').forEach(btn=>btn.addEventListener('click',event=>{
  event.stopPropagation();
  calView=new Date(calView.getFullYear(),calView.getMonth()+(btn.dataset.cal==='next'?1:-1),1);
  renderCalendar();
}));
calPop.addEventListener('click',event=>{
  const cell=event.target.closest('td[data-cal-date]');
  if(!cell)return;
  const d=new Date(Number(cell.dataset.calDate));
  if(!calSameDay(d,calView))calView=new Date(d.getFullYear(),d.getMonth(),1);
  calSelected=d;
  renderCalendar();
});
const calTodayBtn=calPop.querySelector('[data-cal-today]');
if(calTodayBtn)calTodayBtn.addEventListener('click',event=>{
  event.stopPropagation();
  calView=new Date();calView.setDate(1);
  calSelected=new Date();
  renderCalendar();
});
document.addEventListener('click',()=>{if(calPop&&!calPop.hidden)closeCal()});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&calPop&&!calPop.hidden)closeCal();
});

/* --- расстановка окон Picture Viewer --------------------------------------
   Одно окно — прежняя расстановка байт в байт (правый нижний угол, в стопке —
   под серверным окном), чтобы старая раскладка не поплыла. Несколько окон —
   делим область на доли: в широком окне в ряд по низу правой колонки, на узком
   экране друг под другом. Окно с ручной позицией (перетащили руками или
   пришло из сохранённой раскладки) не трогаем — это его собственность. */
/* Ищем свободное место для окна w×h: сначала там, где оно встало по расчёту,
   затем сеткой вокруг — ближайшая точка, где окно целиком внутри сцены и не
   перекрывает ни окно Server, ни перетащенные руками окна. Ничего не нашли —
   оставляем как считали: пусть упрётся в препятствие, но не уедет за край. */
function dodgeWindows(x,y,w,h,blocked,sw,sh,m){
  const fits=(px,py)=>px>=m-1&&py>=m-1&&px+w<=sw-m+1&&py+h<=sh-m+1;
  const hits=(px,py)=>blocked.some(b=>px<b.x+b.w&&b.x<px+w&&py<b.y+b.h&&b.y<py+h);
  x=Math.round(x);y=Math.round(y);
  if(fits(x,y)&&!hits(x,y))return{x,y};
  const step=20,cx=x+w/2,cy=y+h/2;
  let best=null,bestD=Infinity;
  for(let py=m;py+h<=sh-m;py+=step){
    for(let px=m;px+w<=sw-m;px+=step){
      if(hits(px,py))continue;
      const dx=px+w/2-cx,dy=py+h/2-cy,d=dx*dx+dy*dy;
      if(d<bestD){bestD=d;best={x:px,y:py}}
    }
  }
  return best||{x,y};
}
function autoSizeViewer(v,force){
  const win=v.win;
  if(win.dataset.manual==='1'&&!force)return;
  const sw=scene.clientWidth,sh=scene.clientHeight,m=10;
  const servers=document.getElementById('winServers');
  const sW=servers.hidden?0:servers.offsetWidth;
  const stack=sw<760||(sw-2*m-sW-m)<320;
  /* область, где стоят просмотрщики: справа от серверного окна или под ним */
  let areaX,areaY,areaW,areaH;
  if(stack){
    areaX=m;areaW=sw-2*m;
    areaY=servers.hidden?m:servers.offsetHeight+m;
    areaH=sh-areaY-m;
  }else{
    areaX=sW+2*m;areaW=sw-3*m-sW;areaY=m;areaH=sh-2*m;
  }
  const open=viewers.filter(x=>!x.win.hidden);
  const count=Math.max(1,open.length);
  const idx=Math.max(0,open.indexOf(v));
  /* под окном Server бывает совсем не места (высокий контент, узкий экран):
     без этой проверки высота доли нулевая, и все окна ложатся в одну точку
     за нижним краем сцены. Поднимаем область вверх — просмотрщики встанут
     поверх низа окна Server, но каждый в своей строке и целиком. */
  const minSlot=200;
  if(areaH<minSlot*count)areaY=Math.max(m,sh-m-minSlot*count);
  areaH=sh-areaY-m;
  const availW=Math.max(260,areaW);
  const availH=Math.max(stack?150:190,areaH);
  const aspect=artAspect(v);
  let px,py;
  if(count===1){
    /* одно окно — ровно как раньше */
    let h=Math.min(availH,460);
    let w=Math.min(availW,h*aspect);
    if(w<320){w=Math.min(availW,320);h=Math.min(availH,w/aspect);}
    w=Math.max(260,Math.round(w));h=Math.max(160,Math.round(h));
    win.style.width=w+'px';win.style.height=h+'px';
    px=stack?areaX:sw-w-m;py=stack?areaY:sh-h-m;
  }else if(!stack&&areaW/count>=300){
    /* широкая колонка — в ряд по низу, каждое окно в своей доле */
    const slotW=areaW/count;
    let h=Math.min(availH,460);
    let w=Math.min(slotW,h*aspect);
    if(w<320){w=Math.min(slotW,320);h=Math.min(availH,w/aspect);}
    w=Math.min(Math.max(260,Math.round(w)),Math.round(slotW));
    h=Math.max(160,Math.round(h));
    win.style.width=w+'px';win.style.height=h+'px';
    px=Math.round(areaX+idx*slotW+(slotW-w)/2);py=sh-h-m;
  }else{
    /* узкий экран или узкая доля — окна друг под другом */
    const slotH=areaH/count;
    let h=Math.min(slotH,460);
    let w=Math.min(availW,h*aspect);
    if(w<320){w=Math.min(availW,320);h=Math.min(slotH,w/aspect);}
    w=Math.max(260,Math.round(w));
    h=Math.min(Math.max(160,Math.round(h)),Math.round(slotH));
    win.style.width=w+'px';win.style.height=h+'px';
    px=stack?Math.round(areaX+(availW-w)/2):sw-w-m;
    py=Math.round(areaY+idx*slotH+(slotH-h)/2);
  }
  /* перетащенные руками окна не двигаем, но и не заезжаем на них: если доля
     попадает на чужое ручное окно или на окно Server — отъезжаем в ближайшее
     свободное место (то же делает placeMonitor для просмотрщиков) */
  const blocked=[];
  if(!servers.hidden)blocked.push(rectInScene(servers));
  viewers.forEach(x=>{
    if(x!==v&&!x.win.hidden&&x.win.dataset.manual==='1')blocked.push(rectInScene(x.win));
  });
  const mon=document.getElementById('winMonitor');
  if(mon&&!mon.hidden&&mon.dataset.manual==='1')blocked.push(rectInScene(mon));
  TERMS.forEach(t=>{if(!t.win.hidden&&t.win.dataset.manual==='1')blocked.push(rectInScene(t.win))});
  const pos=dodgeWindows(px,py,parseFloat(win.style.width),parseFloat(win.style.height),
                         blocked,sw,sh,m);
  win.style.left=pos.x+'px';win.style.top=pos.y+'px';
  win.style.right='auto';win.style.bottom='auto';
  win.dataset.maximized='0';
}
function autoSizeArt(force){
  /* расставляем все окна, кроме занятых вручную: так делают показ окна и
     финальная расстановка при загрузке страницы */
  viewers.forEach(v=>autoSizeViewer(v,force));
}
/* --- System Monitor: подбор свободного места --------------------------- */
function rectInScene(win){
  const sr=scene.getBoundingClientRect(),r=win.getBoundingClientRect();
  return {x:r.left-sr.left,y:r.top-sr.top,w:r.width,h:r.height};
}
function overlapArea(a,b){
  const ox=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
  const oy=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return ox*oy;
}
function placeMonitor(){
  const mon=document.getElementById('winMonitor');
  if(!mon||mon.hidden)return;
  if(mon.dataset.maximized==='1')return;
  const cfg=CONFIG.monitor||{};
  const sw=scene.clientWidth,sh=scene.clientHeight,m=10;

  // Ручную позицию уважаем: подвинем окно внутрь сцены только если оно вылезло.
  if(mon.dataset.manual==='1'){
    const r=rectInScene(mon);
    const w=Math.min(r.w,sw-2*m),h=Math.min(r.h,sh-2*m);
    const x=Math.min(Math.max(r.x,m),Math.max(m,sw-w-m));
    const y=Math.min(Math.max(r.y,m),Math.max(m,sh-h-m));
    if(w!==Math.round(r.w))mon.style.width=Math.round(w)+'px';
    if(h!==Math.round(r.h))mon.style.height=Math.round(h)+'px';
    mon.style.left=Math.round(x)+'px';
    mon.style.top=Math.round(y)+'px';
    mon.style.right='auto';mon.style.bottom='auto';
    return;
  }

  const servers=document.getElementById('winServers');
  const taken=[];
  if(!servers.hidden)taken.push(rectInScene(servers));
  /* все просмотрщики — препятствия отдельно: якорь «над окном арта» берём по
     общей рамке окон, чтобы монитор не встал в щель между ними */
  const artRects=viewers.filter(v=>!v.win.hidden).map(v=>rectInScene(v.win));
  artRects.forEach(r=>taken.push(r));
  /* терминал — тоже препятствие (монитор встаёт первым, терминал его
     объезжает): монитор не должен заехать на чужой «чёрный экран».
     Окно ещё не расставлено (нет left) — места у него нет, не мешаем. */
  TERMS.forEach(t=>{if(!t.win.hidden&&t.win.style.left)taken.push(rectInScene(t.win))});
  /* Network и Download Manager — тоже препятствия, если уже расставлены */
  ['winNetwork','winDownloads'].forEach(id=>{
   const w=document.getElementById(id);
   if(w&&!w.hidden&&w.style.left)taken.push(rectInScene(w));
  });
  const sR=taken[0]?taken[0].x+taken[0].w:m;      // правая кромка серверного окна
  const sB=taken[0]?taken[0].y+taken[0].h:m;      // низ серверного окна
  const aL=artRects.length?Math.min.apply(null,artRects.map(r=>r.x)):sw-m;
  const aT=artRects.length?Math.min.apply(null,artRects.map(r=>r.y)):sh-m;

  const maxW=Math.max(160,sw-2*m),maxH=Math.max(130,sh-2*m);
  const hardW=Math.min(maxW,180),hardH=Math.min(maxH,150);   // предел ужатия
  const wantW=Math.min(maxW,Math.max(hardW,Number(cfg.width)||360));
  const wantH=Math.min(maxH,Math.max(hardH,Number(cfg.height)||225));
  const PAD=6;

  const anchors=()=>[
    {x:m,y:sB+m},            // под серверным окном, слева
    {x:sR+m,y:m},            // справа от серверного окна
    {x:sR+m,y:sB+m},         // справа и ниже серверного окна
    {x:aL-wantW-m,y:aT-wantH-m}, // сразу над окном арта
    {x:m,y:sh-wantH-m},      // левый нижний угол
    {x:sw-wantW-m,y:m},      // правый верхний угол
    {x:sw-wantW-m,y:sh-wantH-m}  // правый нижний угол
  ];

  // Насколько можно развернуться из точки (x,y), не трогая чужие окна.
  function fitAt(x,y){
    if(x<m-.5||y<m-.5)return null;
    for(const r of taken){
      if(x>=r.x-PAD&&x<r.x+r.w+PAD&&y>=r.y-PAD&&y<r.y+r.h+PAD)return null;
    }
    let wLim=sw-m-x;
    for(const r of taken){
      if(r.y+PAD>=y+hardH||r.y+r.h-PAD<=y)continue;   // по вертикали не мешает
      if(r.x+r.w<=x+PAD)continue;                     // целиком слева
      wLim=Math.min(wLim,r.x-PAD-x);
    }
    if(wLim<hardW)return null;
    const w=Math.min(wantW,wLim);
    let hLim=sh-m-y;
    for(const r of taken){
      if(r.x+PAD>=x+w||r.x+r.w-PAD<=x)continue;       // по горизонтали не мешает
      if(r.y+r.h<=y+PAD)continue;                     // целиком выше
      hLim=Math.min(hLim,r.y-PAD-y);
    }
    if(hLim<hardH)return null;
    const h=Math.min(wantH,hLim);
    return {x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h),
            avail:Math.round(hLim)};
  }

  function overlapAreaOf(a){
    return taken.reduce((sum,r)=>sum+overlapArea(a,r),0);
  }

  // Сколько места нужно контенту (диски, RAID) при желаемой ширине —
  // меряем заранее, чтобы выбрать не просто первый свободный якорь,
  // а тот, куда контент влезет целиком, без прокрутки.
  const body=mon.querySelector('.monitor-body');
  if(body)body.classList.toggle('compact',wantW<300);
  mon.style.width=wantW+'px';
  mon.style.height='auto';
  const needH=Math.min(maxH,Math.max(wantH,mon.offsetHeight||0));

  let spot=null,tight=null;
  for(const a of anchors()){
    const r=fitAt(a.x,a.y);
    if(!r)continue;
    if(!tight)tight=r;
    if(r.avail>=needH){spot=r;break}
  }
  if(!spot)spot=tight;

  // Свободного места нет (маленький экран) — встаём туда, где меньше всего
  // перекрытий. Окно ведь обычное: его можно перетащить за заголовок.
  if(!spot){
    let best=null,bestScore=Infinity;
    for(const a of anchors()){
      for(const size of [{w:wantW,h:wantH},{w:hardW,h:hardH}]){
        const r={x:Math.round(a.x),y:Math.round(a.y),w:Math.round(size.w),h:Math.round(size.h)};
        if(r.x<m-.5||r.y<m-.5||r.x+r.w>sw-m+.5||r.y+r.h>sh-m+.5)continue;
        const score=overlapAreaOf(r);
        if(score<bestScore){bestScore=score;best=r;}
      }
    }
    spot=best||{x:m,y:Math.max(m,sh-hardH-m),w:hardW,h:hardH};
  }

  if(spot.avail==null){
    /* Своё место выбрано в обход fitAt (маленький экран): рост вниз всё
       равно ограничиваем чужими окнами — иначе монитор вырос бы natural
       высотой контента поверх просмотрщика. */
    let lim=sh-m-spot.y;
    for(const r of taken){
      if(r.x+PAD>=spot.x+spot.w||r.x+r.w-PAD<=spot.x)continue;
      if(r.y+r.h<=spot.y+PAD)continue;
      lim=Math.min(lim,r.y-PAD-spot.y);
    }
    spot.avail=Math.max(hardH,lim);
  }

  if(body)body.classList.toggle('compact',spot.w<300);

  mon.style.left=spot.x+'px';
  mon.style.top=spot.y+'px';
  mon.style.width=spot.w+'px';
  mon.style.right='auto';
  mon.style.bottom='auto';

  // Высота — под содержимое (диски, RAID): меряем natural, но не ниже
  // желаемой из CONFIG и не дальше свободного места до соседа/края сцены.
  mon.style.height='auto';
  const natural=mon.offsetHeight||0;
  const h=Math.min(Math.max(natural,wantH),Math.max(hardH,spot.avail));
  mon.style.height=Math.round(h)+'px';
  /* Монитор только что занял своё место (и, бывает, подрос: догрузился
     список дисков) — терминал обязан объехать его заново, иначе останется
     там, где встал, пока монитор был меньше. */
  placeTerm();
}
/* --- Audio Player ------------------------------------------------------ */
function musicCfg(){return CONFIG.music||{}}
function musicUrl(name){
 const base=String(musicCfg().base||'music/').replace(/\/?$/,'/');
 return base+String(name).split('/').map(encodeURIComponent).join('/');
}
function musicName(name){return String(name||'').split('/').pop()}
function fmtTime(sec){
 if(!isFinite(sec)||sec<0)return '0:00';
 const m=Math.floor(sec/60),s=Math.floor(sec%60);
 return m+':'+(s<10?'0':'')+s;
}
const audioEl=document.getElementById('musicAudio');
const musicWin=document.getElementById('winMusic');
const musicListEl=document.querySelector('[data-music-list]');
const musicStatusEl=document.querySelector('[data-music-status]');
const musicSeekEl=document.querySelector('[data-music-seek]');
const musicSeekFill=document.querySelector('[data-music-seek-fill]');
const musicVolEl=document.querySelector('[data-music-vol]');
let musicTracks=[],musicIndex=-1,musicShuffle=false,musicLoop='all';

function setMusicStatus(text){if(musicStatusEl)musicStatusEl.textContent=text}
function musicMarkPlaying(){
 if(!musicListEl)return;
 for(let i=0;i<musicListEl.children.length;i++)
  musicListEl.children[i].classList.toggle('playing',i===musicIndex);
}
function musicTrackTitle(){
 const el=document.querySelector('[data-music-track]');
 if(!el)return;
 el.textContent=(musicIndex>=0&&musicTracks[musicIndex])?musicName(musicTracks[musicIndex]):'No track';
}
function musicSyncButtons(){
 const play=document.querySelector('[data-music="play"]');
 if(play)play.innerHTML=audioEl.paused?'&#9654;':'&#9612;&#9612;';
 const sh=document.querySelector('[data-music="shuffle"]');
 if(sh)sh.classList.toggle('on',musicShuffle);
 const lp=document.querySelector('[data-music="loop"]');
 if(lp){
  lp.classList.toggle('on',musicLoop!=='off');
  lp.textContent=musicLoop==='one'?'R1':'R';
 }
 if(skinActive)skinRender();
}
function renderMusicList(){
 if(!musicListEl)return;
 musicListEl.innerHTML='';
 musicTracks.forEach(function(name,i){
  const b=document.createElement('button');
  b.type='button';
  b.className='music-item';
  b.textContent=musicName(name);
  b.title=name;
  b.dataset.i=String(i);
  b.addEventListener('click',function(){musicPlay(i)});
  musicListEl.appendChild(b);
 });
 musicMarkPlaying();
 if(!musicTracks.length)setMusicStatus('No tracks in '+String(musicCfg().base||'music/'));
 else setMusicStatus(musicTracks.length+(musicTracks.length===1?' track':' tracks'));
 if(skinActive)skinRenderPlaylist();
}
function musicPlay(i){
 if(!musicTracks.length){setMusicStatus('No tracks in '+String(musicCfg().base||'music/'));return}
 if(i!=null)musicIndex=((i%musicTracks.length)+musicTracks.length)%musicTracks.length;
 if(musicIndex<0)musicIndex=0;
 audioEl.src=musicUrl(musicTracks[musicIndex]);
 musicTrackTitle();
 musicMarkPlaying();
 if(skinActive){skinRender();skinRenderPlaylist();}
 const p=audioEl.play();
 if(p&&p.catch)p.catch(function(){
  if(audioEl.error)return; /* причину уже сообщил обработчик error */
  setMusicStatus('Press play to start');
 });
}
function musicToggle(){
 if(!audioEl.getAttribute('src')){musicPlay(0);return}
 if(audioEl.paused){const p=audioEl.play();if(p&&p.catch)p.catch(function(){})}
 else audioEl.pause();
}
function musicNext(auto){
 if(!musicTracks.length)return;
 if(musicShuffle&&musicTracks.length>1){
  let n=musicIndex;
  while(n===musicIndex)n=Math.floor(Math.random()*musicTracks.length);
  musicPlay(n);
  return;
 }
 if(auto&&musicIndex>=musicTracks.length-1&&musicLoop==='off'){audioEl.pause();return}
 musicPlay(musicIndex+1);
}
function musicPrev(){
 if(!musicTracks.length)return;
 if(audioEl.currentTime>3){audioEl.currentTime=0;return}
 musicPlay(musicIndex-1);
}
if(audioEl){
 audioEl.addEventListener('play',musicSyncButtons);
 audioEl.addEventListener('play',vizResume); // анализатор просыпается вместе с плеером
 audioEl.addEventListener('pause',musicSyncButtons);
 audioEl.addEventListener('loadedmetadata',function(){
  const d=document.querySelector('[data-music-dur]');
  if(d)d.textContent=fmtTime(audioEl.duration);
  if(skinActive)skinRender();
 });
 audioEl.addEventListener('timeupdate',function(){
  const cur=document.querySelector('[data-music-cur]');
  if(cur)cur.textContent=fmtTime(audioEl.currentTime);
  const d=audioEl.duration;
  if(musicSeekFill)musicSeekFill.style.width=(isFinite(d)&&d>0?(audioEl.currentTime/d*100):0)+'%';
  if(skinActive)skinRender();
 });
 audioEl.addEventListener('ended',function(){
  if(musicLoop==='one'){audioEl.currentTime=0;const p=audioEl.play();if(p&&p.catch)p.catch(function(){});return}
  musicNext(true);
 });
 audioEl.addEventListener('error',function(){
  if(!audioEl.getAttribute('src'))return;
  setMusicStatus('Cannot play: '+musicName(musicTracks[musicIndex]||'')+' — unsupported or damaged audio file');
 });
}
if(musicSeekEl)musicSeekEl.addEventListener('click',function(event){
 const d=audioEl.duration;
 if(!isFinite(d)||d<=0)return;
 const r=musicSeekEl.getBoundingClientRect();
 const ratio=Math.min(1,Math.max(0,(event.clientX-r.left)/r.width));
 audioEl.currentTime=ratio*d;
});
if(musicVolEl)musicVolEl.addEventListener('input',function(){
 audioEl.volume=Math.max(0,Math.min(1,Number(musicVolEl.value)/100));
 if(skinActive)skinRender();
});
document.querySelectorAll('[data-music]').forEach(function(btn){
 btn.addEventListener('click',function(){
  switch(btn.dataset.music){
   case 'play':musicToggle();break;
   case 'stop':audioEl.pause();audioEl.currentTime=0;break;
   case 'next':musicNext(false);break;
   case 'prev':musicPrev();break;
   case 'shuffle':musicShuffle=!musicShuffle;musicSyncButtons();break;
   case 'loop':musicLoop=musicLoop==='all'?'one':(musicLoop==='one'?'off':'all');musicSyncButtons();break;
  }
 });
});
function loadMusic(){
 const cfg=musicCfg();
 const manual=Array.isArray(cfg.tracks)?cfg.tracks.filter(Boolean):[];
 if(manual.length){musicTracks=manual.slice();renderMusicList();return Promise.resolve()}
 if(!cfg.list){musicTracks=[];renderMusicList();return Promise.resolve()}
 return fetch(cfg.list,{cache:'no-store'})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
  .then(function(j){musicTracks=Array.isArray(j&&j.tracks)?j.tracks:[];renderMusicList()})
  .catch(function(err){musicTracks=[];renderMusicList();setMusicStatus('Playlist unavailable');console.warn('[audio]',err)});
}
/* окно плеера по умолчанию встаёт по центру сцены и там же остаётся
   при изменении размера — пока его не потянули руками */
function placeMusic(){
 if(!musicWin||musicWin.hidden)return;
 if(musicWin.dataset.maximized==='1')return;
 const skinHostEl=document.querySelector('[data-skin-host]');
 if(skinHostEl&&skinHostEl.classList.contains('on')){skinFitWindow();return}
 const sw=scene.clientWidth,sh=scene.clientHeight,m=10,cfg=musicCfg();
 if(musicWin.dataset.placed!=='1'){
  musicWin.dataset.placed='1';
  const w=Math.min(Math.max(250,Number(cfg.width)||300),Math.max(250,sw-2*m));
  const h=Math.min(Math.max(210,Number(cfg.height)||300),Math.max(210,sh-2*m));
  musicWin.style.width=w+'px';
  musicWin.style.height=h+'px';
  musicWin.style.left=Math.round((sw-w)/2)+'px';
  musicWin.style.top=Math.round((sh-h)/2)+'px';
  musicWin.style.right='auto';
  musicWin.style.bottom='auto';
  return;
 }
 if(musicWin.dataset.manual==='1'){clampWindow(musicWin);return}
 const w=musicWin.offsetWidth,h=musicWin.offsetHeight;
 musicWin.style.left=Math.round(Math.max(m,(sw-w)/2))+'px';
 musicWin.style.top=Math.round(Math.max(m,(sh-h)/2))+'px';
}
/* Telegram: фрейм грузится один раз — при первом показе окна (закрытое
   окно чужой сайт не тянет; адрес — CONFIG.telegram.url). Кнопка внизу
   окна открывает тот же адрес во вкладке браузера — официальный
   web.telegram.org запрещает встраивание (X-Frame-Options: deny). */
function tgLoad(){
 const win=document.getElementById('winTelegram');
 if(!win||win.hidden)return;
 const frame=win.querySelector('[data-tg-frame]');
 if(!frame||frame.dataset.loaded==='1')return;
 frame.dataset.loaded='1';
 frame.src=String((CONFIG.telegram||{}).url||'/tg/');
}
(function tgOpenHook(){
 const btn=document.querySelector('.tg-open');
 if(!btn)return;
 btn.addEventListener('click',()=>{
  const url=String((CONFIG.telegram||{}).url||'/tg/');
  window.open(url,'_blank','noopener');
 });
})();
/* Network, Telegram и Download Manager: встают в свободное место —
   сеточный поиск минимального перекрытия, как у терминалов; однократно
   (dataset.placed), дальше координаты их собственные, ручное
   перетаскивание уважаем. */
function placeExtra(win){
 if(!win||win.hidden||win.dataset.maximized==='1')return;
 if(win.id==='winTelegram')tgLoad();      // фрейм — при первом показе
 if(win.dataset.manual==='1'){clampWindow(win);return}
 const cfg=({winNetwork:CONFIG.network,winTelegram:CONFIG.telegram,
             winDownloads:CONFIG.downloads})[win.id]||{};
 const sw=scene.clientWidth,sh=scene.clientHeight,m=10;
 if(win.dataset.placed!=='1'){
  win.dataset.placed='1';
  const w=Math.min(Math.max(260,Number(cfg.width)||380),Math.max(260,sw-2*m));
  const h=Math.min(Math.max(170,Number(cfg.height)||260),Math.max(170,sh-2*m));
  const taken=[];
  appWindows.forEach(other=>{
   if(other===win||other.hidden||!other.style.left)return;
   taken.push(rectInScene(other));
  });
  let spot={x:Math.max(m,sw-w-m),y:Math.max(m,sh-h-m)},worst=Infinity,free=false;
  for(let y=m;y+h<=sh-m+1;y+=20){
   for(let x=m;x+w<=sw-m+1;x+=20){
    const r={x,y,w,h};
    const score=taken.reduce((sum,t)=>sum+overlapArea(r,t),0);
    if(score===0){spot=r;free=true;break}
    if(score<worst){worst=score;spot=r}
   }
   if(free)break;
  }
  win.style.width=w+'px';
  win.style.height=h+'px';
  win.style.left=spot.x+'px';
  win.style.top=spot.y+'px';
  win.style.right='auto';
  win.style.bottom='auto';
  win.dataset.maximized='0';
  return;
 }
 clampWindow(win);
}
/* ======================================================================= *
 *  Network — окно Network: живой трафик и слушающие порты
 *  (GET /api/network; данные — /proc/net/dev и /proc/net/tcp{,6})
 *
 *  Сервер отдаёт сырые счётчики (байты rx/tx с загрузки машины) и
 *  LISTEN-сокеты; скорость между двумя снимками считает клиент,
 *  график хранит CONFIG.network.history последних отсчётов. Опрос идёт
 *  всегда — карточка Network показывает живые ↓/↑ даже когда окно
 *  закрыто; интерфейсы из CONFIG.network.ignore (по умолчанию lo) в
 *  расчёт не входят: свой трафик панели ходит по loopback.
 * ======================================================================= */
let netTimer=null,netBusy=false,netPrev=null;
const netHist={rx:[],tx:[]};
function netCfg(){return CONFIG.network||{}}
function fmtBytes(n){
 n=Number(n)||0;
 if(n<1024)return Math.round(n)+' B';
 const units=['KB','MB','GB','TB','PB'];
 let i=-1;
 do{n/=1024;i++}while(n>=1024&&i<units.length-1);
 return (n>=100?Math.round(n):n.toFixed(1))+' '+units[i];
}
async function netFetch(){
 const cfg=netCfg();
 const ctl=('AbortController' in window)?new AbortController():null;
 const to=setTimeout(()=>{try{if(ctl)ctl.abort()}catch(e){}},
                      Math.max(500,Number(cfg.timeout)||2500));
 try{
  const res=await fetch(cfg.endpoint||'/api/network',
                        {cache:'no-store',signal:ctl?ctl.signal:undefined});
  if(!res.ok)throw new Error('HTTP '+res.status);
  return await res.json();
 }finally{clearTimeout(to)}
}
function netLive(text){
 document.querySelectorAll('[data-live="network"]').forEach(el=>{el.textContent=text});
}
function netApply(data){
 const cfg=netCfg();
 const ign=new Set(Array.isArray(cfg.ignore)?cfg.ignore:[]);
 const ifaces=(Array.isArray(data.ifaces)?data.ifaces:[])
              .filter(f=>!ign.has(f.name));
 let rx=0,tx=0;
 ifaces.forEach(f=>{rx+=Number(f.rx)||0;tx+=Number(f.tx)||0});
 const now=Date.now();
 let drx=0,dtx=0,ok=false;
 if(netPrev){
  const dt=(now-netPrev.t)/1000;
  if(dt>0.25){
   drx=Math.max(0,(rx-netPrev.rx)/dt);
   dtx=Math.max(0,(tx-netPrev.tx)/dt);
   ok=true;
  }
 }
 netPrev={t:now,rx,tx};
 if(ok){
  const cap=Math.max(10,Number(cfg.history)||60);
  netHist.rx.push(drx);netHist.tx.push(dtx);
  while(netHist.rx.length>cap)netHist.rx.shift();
  while(netHist.tx.length>cap)netHist.tx.shift();
 }
 const win=document.getElementById('winNetwork');
 netLive(ok?'↓ '+fmtBytes(drx)+'/s ↑ '+fmtBytes(dtx)+'/s':'↓ — ↑ —');
 if(!win||win.hidden)return;              // окно закрыто — обновляем карточку
 const set=(sel,text)=>{const el=win.querySelector(sel);if(el)el.textContent=text};
 set('[data-net-rx]',ok?fmtBytes(drx)+'/s':'—');
 set('[data-net-tx]',ok?fmtBytes(dtx)+'/s':'—');
 set('[data-net-total]',fmtBytes(rx)+' rx · '+fmtBytes(tx)+' tx');
 netDraw(win);
 const ports=Array.isArray(data.ports)?data.ports:[];
 const countEl=win.querySelector('[data-net-port-count]');
 if(countEl)countEl.textContent=String(ports.length);
 const box=win.querySelector('[data-net-ports]');
 if(box){
  box.innerHTML=ports.length
   ?ports.map(p=>`<div class="net-prow"><span class="p-proto">${p.proto}</span>`+
                 `<span class="p-addr">${esc(p.addr)}</span>`+
                 `<span class="p-port">${p.port}</span></div>`).join('')
   :'<div class="net-empty">No listening sockets</div>';
 }
}
function netDraw(win){
 const cv=win.querySelector('[data-net-graph]');
 if(!cv)return;
 const w=cv.clientWidth,h=cv.clientHeight;
 if(!w||!h)return;
 const dpr=window.devicePixelRatio||1;
 if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
 }
 const g=cv.getContext('2d');
 g.setTransform(dpr,0,0,dpr,0,0);
 g.fillStyle='#000';
 g.fillRect(0,0,w,h);
 /* сетка — как в Диспетчере задач Win9x: тёмно-зелёные линии */
 g.strokeStyle='#0d3f18';
 g.lineWidth=1;
 for(let i=1;i<4;i++){
  const y=Math.round(h*i/4)+0.5;
  g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();
 }
 for(let i=1;i<6;i++){
  const x=Math.round(w*i/6)+0.5;
  g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();
 }
 let max=1;
 for(let i=0;i<netHist.rx.length;i++){
  max=Math.max(max,netHist.rx[i],netHist.tx[i]);
 }
 const line=(arr,color)=>{
  if(arr.length<2)return;
  g.strokeStyle=color;g.lineWidth=1.5;
  g.beginPath();
  arr.forEach((v,i)=>{
   const x=i*(w-2)/(Math.max(arr.length,2)-1)+1;
   const y=h-1-(v/max)*(h-3);
   if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
  });
  g.stroke();
 };
 line(netHist.tx,'#6cb6ff');
 line(netHist.rx,'#3ff06a');
 const scale=win.querySelector('[data-net-scale]');
 if(scale)scale.textContent='max '+fmtBytes(max)+'/s';
}
function netTick(){
 const cfg=netCfg();
 if(cfg.enabled===false||netBusy)return;
 netBusy=true;
 netFetch().then(data=>{netApply(data)},
  ()=>{ /* сервер недоступен — оставляем прошлые цифры, без ошибок */ })
 .then(()=>{netBusy=false});
}
function startNet(){
 const cfg=netCfg();
 if(cfg.enabled===false)return;
 if(netTimer)clearInterval(netTimer);
 netTick();
 netTimer=setInterval(netTick,Math.max(600,Number(cfg.interval)||1000));
}
/* ======================================================================= *
 *  Download Manager — окно и команда wget (GET/POST /api/downloads)
 *
 *  Панель только показывает и управляет: стартует загрузку (POST с URL),
 *  опрашивает список, пока окно открыто или есть незавершённые задачи,
 *  шлёт cancel/remove. Остальное сервер делает фоновым потоком в папке
 *  downloads/; лимит CONFIG.downloads.maxMB применяет клиент — как
 *  только известна длина файла, слишком большое скачивание отменяется.
 * ======================================================================= */
let dlTimer=null,dlBusy=false,dlKnown=false,dlActive=0;
const dlSpeed=new Map();          // id -> {got,t,speed}: скорость и ETA
const dlOver=new Set();           // id, уже остановленные по лимиту
function dlCfg(){return CONFIG.downloads||{}}
function dlWin(){return document.getElementById('winDownloads')}
async function dlGet(){
 const cfg=dlCfg();
 const ctl=('AbortController' in window)?new AbortController():null;
 const to=setTimeout(()=>{try{if(ctl)ctl.abort()}catch(e){}},
                      Math.max(500,Number(cfg.timeout)||2500));
 try{
  const res=await fetch(cfg.endpoint||'/api/downloads',
                        {cache:'no-store',signal:ctl?ctl.signal:undefined});
  if(!res.ok)throw new Error('HTTP '+res.status);
  return await res.json();
 }finally{clearTimeout(to)}
}
async function dlPost(url){
 const cfg=dlCfg();
 try{
  const res=await fetch(cfg.endpoint||'/api/downloads',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({url}),cache:'no-store'});
  if(!res.ok){
   let msg='HTTP '+res.status;
   try{msg=(await res.text())||msg}catch(e){}
   return {err:msg};
  }
  return await res.json();       // {id, name, dir}
 }catch(e){return {err:String((e&&e.message)||e)}}
}
async function dlAct(id,action){
 const cfg=dlCfg();
 try{
  const res=await fetch((cfg.endpoint||'/api/downloads')+'/control',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id,action}),cache:'no-store'});
  return res.ok;
 }catch(e){return false}
}
function dlEnforce(j){           // лимит размера — отменяем слишком большое
 const max=Number(dlCfg().maxMB)||0;
 if(max<=0||j.status!=='running'||dlOver.has(j.id))return;
 if(j.total>0&&j.total>max*1048576){
  dlOver.add(j.id);
  dlAct(j.id,'cancel');
 }
}
function dlLive(text){
 document.querySelectorAll('[data-live="downloads"]').forEach(el=>{el.textContent=text});
}
function fmtTime(sec){
 sec=Math.max(0,Math.round(sec));
 if(sec<60)return sec+'s';
 const m=Math.floor(sec/60);
 if(m<60)return m+'m '+(sec%60)+'s';
 return Math.floor(m/60)+'h '+(m%60)+'m';
}
function dlStatusLine(j,prev){
 if(j.status==='running'){
  const parts=[];
  if(j.total>0)parts.push(Math.min(100,Math.round(j.got*100/j.total))+'%');
  parts.push(fmtBytes(j.got)+(j.total>0?' of '+fmtBytes(j.total):''));
  if(prev&&prev.speed>0){
   parts.push(fmtBytes(prev.speed)+'/s');
   if(j.total>0)parts.push('ETA '+fmtTime((j.total-j.got)/prev.speed));
  }
  return {text:parts.join(' · '),cls:''};
 }
 if(j.status==='done')return {text:'done · '+fmtBytes(j.got),cls:'is-done'};
 if(j.status==='failed')return {text:j.error||'failed',cls:'is-failed'};
 if(j.status==='cancelled')return {text:'cancelled',cls:'is-cancelled'};
 return {text:String(j.status),cls:''};
}
function dlRow(j){
 const row=document.createElement('div');
 row.className='dl-item';
 row.dataset.dl=String(j.id);
 row.innerHTML=`<div class="dl-top"><span class="dl-name"></span>`+
               `<span class="dl-meta"></span>`+
               `<button class="dl-x" type="button" title="Cancel">×</button></div>`+
               `<div class="dl-bar"><div class="dl-fill"></div></div>`;
 row.querySelector('.dl-x').addEventListener('click',()=>{
  const running=row.dataset.status==='running';
  dlAct(j.id,running?'cancel':'remove');
  dlKnown=false;                   // следующий тик сразу перечитает список
 });
 return row;
}
function dlRender(jobs){
 const list=document.querySelector('[data-dl-list]');
 if(!list)return;
 const keep=new Set();
 let active=0;
 jobs.forEach(j=>{
  keep.add(String(j.id));
  if(j.status==='running')active++;
  let row=list.querySelector('[data-dl="'+j.id+'"]');
  if(!row){row=dlRow(j);list.appendChild(row)}
  row.dataset.status=j.status;
  const st=dlStatusLine(j,dlSpeed.get(j.id));
  row.classList.remove('is-failed','is-done','is-cancelled');
  if(st.cls)row.classList.add(st.cls);
  row.querySelector('.dl-name').textContent=j.name;
  row.querySelector('.dl-meta').textContent=st.text;
  const bar=row.querySelector('.dl-bar');
  const fill=row.querySelector('.dl-fill');
  if(j.status==='running'){
   if(j.total>0){
    bar.classList.remove('is-unknown');
    fill.style.width=Math.min(100,Math.max(0,j.got*100/j.total))+'%';
   }else bar.classList.add('is-unknown');   // длина неизвестна — бегущая строка
  }else if(j.status==='done')fill.style.width='100%';
  const btn=row.querySelector('.dl-x');
  btn.title=j.status==='running'?'Cancel':'Remove';
  const prev=dlSpeed.get(j.id);
  const now=Date.now();
  if(j.status==='running'){
   if(prev&&now>prev.t){
    const inst=(j.got-prev.got)/((now-prev.t)/1000);
    if(inst>0)prev.speed=prev.speed?prev.speed*0.6+inst*0.4:inst;
   }
   dlSpeed.set(j.id,{got:j.got,t:now,speed:prev?prev.speed:0});
  }else dlSpeed.delete(j.id);
  dlEnforce(j);
 });
 list.querySelectorAll('.dl-item').forEach(row=>{
  if(!keep.has(row.dataset.dl))row.remove();
 });
 dlActive=active;
 const empty=list.querySelector('.dl-empty');
 if(empty)empty.hidden=jobs.length>0;
 dlLive(active?active+' active':'idle');
 const status=document.querySelector('[data-dl-status]');
 if(status&&!status.classList.contains('is-err')){
  const failed=jobs.filter(j=>j.status==='failed').length;
  status.textContent=failed
   ?failed+' failed · '+jobs.length+' total'
   :(jobs.length?jobs.length+' in list · '+active+' active':'Idle');
 }
}
function dlTick(){
 const cfg=dlCfg();
 if(cfg.enabled===false)return;
 const win=dlWin();
 const open=!!win&&!win.hidden;
 /* пока окно закрыто и незавершённых задач нет — сервер не дёргаем:
    первый тик (dlKnown=false) всё равно идёт, он узнаёт, есть ли задачи */
 if(!open&&dlActive===0&&dlKnown)return;
 if(dlBusy)return;
 dlBusy=true;
 dlGet().then(data=>{
  dlKnown=true;
  dlRender(Array.isArray(data.jobs)?data.jobs:[]);
 },()=>{dlKnown=true}).then(()=>{dlBusy=false});
}
function dlStart(url){           // старт из формы окна или из wget
 dlKnown=false;
 return dlPost(url);
}
function startDl(){
 const cfg=dlCfg();
 if(cfg.enabled===false)return;
 if(dlTimer)clearInterval(dlTimer);
 dlTick();
 dlTimer=setInterval(dlTick,Math.max(300,Number(cfg.interval)||700));
}
/* Форма в окне: URL + Start. Ошибки — красной строкой в статусе окна. */
(function dlFormHook(){
 const form=document.querySelector('[data-dl-form]');
 if(!form)return;
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const input=form.querySelector('[data-dl-url]');
  const status=document.querySelector('[data-dl-status]');
  const url=String(input?input.value:'').trim();
  if(!/^https?:\/\//i.test(url)){
   if(status){status.classList.add('is-err');
    status.textContent='Only http:// and https:// URLs'}
   return;
  }
  if(status){status.classList.remove('is-err');status.textContent='Starting…'}
  dlStart(url).then(res=>{
   if(!res||res.err){
    if(status){status.classList.add('is-err');
     status.textContent='Cannot start: '+((res&&res.err)||'no answer')}
    return;
   }
   if(status){status.classList.remove('is-err');
    status.textContent="Saving to '"+(res.dir||'downloads')+"/"+res.name+"'"}
   if(input)input.value='';
   dlKnown=false;
  });
 });
})();
/* ======================================================================= *
 *  Скины плеера: Qmmp / Winamp 2  (.wsz = ZIP c BMP-файлами внутри)
 *
 *  Скин рисуется на двух <canvas>: главное окно Winamp (275x116) и
 *  плейлист под ним. Порядок работы:
 *    skinUnzip()   — ZIP разбирается прямо в браузере, сервер не участвует;
 *    skinBmp()     — BMP (8/24/32 bpp) превращается в canvas;
 *    skinParse()   — собирает картинки + цвета из pledit.txt;
 *    skinRender()  — рисует окно по координатам Winamp 2.
 *  Координаты одинаковы у всех скинов: их задаёт формат Winamp 2,
 *  его же использует Qmmp, так что любой .wsz ложится на них как влитой.
 * ======================================================================= */
let skinActive=false,skin=null,skinName='';
let skinPress=null,skinDrag=null,skinScroll=0,skinSel=-1,skinPlOn=true;
let skinHost=null,skinCvMain=null,skinCvPl=null;
const skinDisk={};      // скины, загруженные кнопкой «Skin…» (значение «~имя»)
const SKIN_W=275,SKIN_H=116;                 // размер главного окна Winamp
/* --- размещение элементов на главном окне ------------------------------ */
const SKIN_TITLEBAR={on:[27,0],off:[27,15]}; // два состояния в titlebar.bmp
const SKIN_TITLEBTNS=[                        // [id, x] на титульной полосе
 {id:'menu',x:6,src:[[0,0],[0,9]]},
 {id:'min',x:244,src:[[9,0],[9,9]]},
 {id:'shade',x:254,src:[[0,18],[9,18]]},
 {id:'close',x:264,src:[[18,0],[18,9]]}
];
const SKIN_DIGITS=[[48,26],[60,26],[78,26],[90,26]];  // 4 разряда времени
const SKIN_MARQUEE=[111,27,154,6];                    // бегущая строка
const SKIN_PLAYPAUS=[26,28];                          // индикатор 9x9
const SKIN_MONO=[212,41,27,12],SKIN_STEREO=[239,41,29,12];
const SKIN_VOL=[107,57];        // поле 68x13, бегунок ездит по 65 px
const SKIN_BAL=[177,57];        // поле 38x13, бегунок 14 px по центру
const SKIN_POS=[16,72];         // поле 248x10, бегунок 29 px
const SKIN_EQ=[219,58],SKIN_PL=[242,58];
/* [id, x, y, w, h на окне; sx, sy; sy нажатой — в cbuttons.bmp] */
const SKIN_BTNS=[
 ['prev',16,88,23,18,0,0,18],
 ['play',39,88,23,18,23,0,18],
 ['pause',62,88,23,18,46,0,18],
 ['stop',85,88,23,18,69,0,18],
 ['next',108,88,22,18,92,0,18],
 ['eject',136,89,22,16,114,0,16]
];
/* [id, x, y, w, h на окне; sx, sy в shufrep.bmp] */
const SKIN_SHUF=[['shuffle',164,89,47,15,28,0],['repeat',210,89,28,15,0,0]];
/* строки shufrep.bmp: 0 — выкл, 1 — нажато, 2 — вкл, 3 — вкл и нажато */
const SKIN_ROWH=13,SKIN_PLTOP=20,SKIN_PLBOT=38;      // геометрия плейлиста

/* шрифт Winamp: text.bmp — 31x3 глифа по 5x6 пикселей */
const SKIN_FONT=(function(){
 const m={};
 for(let i=0;i<26;i++)m[String.fromCharCode(97+i)]=[0,i];
 m['"']=[0,26];m['@']=[0,27];m[' ']=[0,30];
 for(let i=0;i<10;i++)m[String(i)]=[1,i];
 m['\u2026']=[1,10];
 const r1=".:()-'!_+\\/[]^&%,=$#";
 for(let i=0;i<r1.length;i++)m[r1[i]]=[1,11+i];
 m['\u00e5']=[2,0];m['\u00f6']=[2,1];m['\u00e4']=[2,2];
 m['?']=[2,3];m['*']=[2,4];
 m['<']=[1,22];m['>']=[1,23];m['{']=[1,22];m['}']=[1,23];
 return m;
})();

/* --- ZIP: разбираем .wsz целиком в браузере --------------------------- */
async function skinUnzip(buf){
 const u8=new Uint8Array(buf),dv=new DataView(buf);
 let e=-1;
 const from=Math.max(0,u8.length-66000);
 for(let i=u8.length-22;i>=from;i--){if(dv.getUint32(i,true)===0x06054b50){e=i;break}}
 if(e<0)throw new Error('not a ZIP archive');
 const count=dv.getUint16(e+10,true);
 let p=dv.getUint32(e+16,true);
 const dec=new TextDecoder('utf-8');
 const out={};
 for(let i=0;i<count;i++){
  if(p+46>u8.length||dv.getUint32(p,true)!==0x02014b50)break;
  const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true);
  const nlen=dv.getUint16(p+28,true),elen=dv.getUint16(p+30,true),
        clen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
  const name=dec.decode(u8.subarray(p+46,p+46+nlen));
  if(lho+30<=u8.length){
   const s=lho+30+dv.getUint16(lho+26,true)+dv.getUint16(lho+28,true);
   if(s>=0&&s+csize<=u8.length)
    out[name.toLowerCase()]={method:method,data:u8.subarray(s,s+csize)};
  }
  p+=46+nlen+elen+clen;
 }
 return out;
}
async function skinInflate(u8){
 if(typeof DecompressionStream==='undefined')
  throw new Error('this browser cannot unpack .wsz (no DecompressionStream)');
 const st=new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(st).arrayBuffer());
}
/* имена в скинах бывают в разном регистре — ключи словаря в нижнем */
async function skinEntry(files,name){
 const it=files[String(name).toLowerCase()];
 if(!it)return null;
 if(it.method===0)return it.data;
 if(it.method===8)return await skinInflate(it.data);
 throw new Error('unsupported ZIP compression: '+it.method);
}

/* --- BMP: 8/24/32 bpp без сжатия (ровно то, чем рисует Winamp) -------- */
function skinBmp(u8){
 if(!u8||u8.length<54||u8[0]!==0x42||u8[1]!==0x4d)throw new Error('not a BMP file');
 const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
 const off=dv.getUint32(10,true),hsize=dv.getUint32(14,true);
 const w=dv.getInt32(18,true);
 let h=dv.getInt32(22,true);
 const bpp=dv.getUint16(28,true),comp=dv.getUint32(30,true);
 const down=h<0;if(down)h=-h;
 if(!(w>0&&h>0&&w<8192&&h<16384))throw new Error('bad BMP size');
 if(comp!==0&&comp!==3)throw new Error('compressed BMP is not supported');
 if(bpp!==8&&bpp!==24&&bpp!==32)throw new Error(bpp+'-bit BMP is not supported');
 const stride=((w*bpp+31)>>5)<<2,px=bpp>>3;
 const rgba=new Uint8ClampedArray(w*h*4);
 let pal=null;
 if(bpp===8){
  const ncol=dv.getUint32(46,true)||256,poff=14+hsize;
  pal=new Uint8Array(ncol*3);
  for(let i=0;i<ncol&&poff+i*4+2<u8.length;i++){
   pal[i*3]=u8[poff+i*4+2];      // BGR -> RGB
   pal[i*3+1]=u8[poff+i*4+1];
   pal[i*3+2]=u8[poff+i*4];
  }
 }
 for(let y=0;y<h;y++){
  const row=off+(down?y:h-1-y)*stride;
  if(row<0)continue;
  for(let x=0;x<w;x++){
   const o=(y*w+x)*4;
   if(bpp===8){
    const idx=u8[row+x];
    if(pal&&idx*3+2<pal.length){rgba[o]=pal[idx*3];rgba[o+1]=pal[idx*3+1];rgba[o+2]=pal[idx*3+2];}
   }else{
    const s=row+x*px;
    if(s+2<u8.length){rgba[o]=u8[s+2];rgba[o+1]=u8[s+1];rgba[o+2]=u8[s];}
   }
   rgba[o+3]=255;                // альфа-канала в скинах Winamp нет
  }
 }
 const cv=document.createElement('canvas');
 cv.width=w;cv.height=h;
 cv.getContext('2d').putImageData(new ImageData(rgba,w,h),0,0);
 return cv;
}

/* цвета плейлиста берутся из pledit.txt, иначе — классические значения */
function skinColors(bytes){
 const c={Normal:'#00ff00',Current:'#ffffff',NormalBG:'#000000',
          SelectedBG:'#0000c6',Font:'Arial'};
 if(!bytes)return c;
 let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
 s.split(/\r?\n/).forEach(function(line){
  const m=/^\s*([A-Za-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if(!m)return;
  const k=m[1],v=m[2];
  if(k==='Font'){if(v)c.Font=v;return}
  const hx=v.replace(/^#/,'');
  if(/^[0-9a-fA-F]{6}$/.test(hx))c[k]='#'+hx.toLowerCase();
 });
 return c;
}

async function skinParse(buf){
 const files=await skinUnzip(buf);
 const img={};
 const need=['main','titlebar','cbuttons','shufrep','posbar','numbers',
             'text','playpaus','monoster','volume','balance','pledit'];
 for(let i=0;i<need.length;i++){
  const b=await skinEntry(files,need[i]+'.bmp');
  if(!b)continue;
  try{img[need[i]]=skinBmp(b)}catch(err){console.warn('[skin]',need[i],err.message)}
 }
 if(!img.main)throw new Error('main.bmp is missing in the skin');
 return {img:img,colors:skinColors(await skinEntry(files,'pledit.txt'))};
}

/* --- рисование -------------------------------------------------------- */
function blit(ctx,img,sx,sy,sw,sh,dx,dy,dw,dh){
 if(!img||!ctx)return;
 if(dw==null)dw=sw;if(dh==null)dh=sh;
 let cx=0,cy=0,cw=sw,chh=sh;
 if(sx<0){cx=-sx;cw+=sx;sx=0}
 if(sy<0){cy=-sy;chh+=sy;sy=0}
 if(sx+sw>img.width)cw-=sx+sw-img.width;
 if(sy+sh>img.height)chh-=sy+sh-img.height;
 if(cw<=0||chh<=0)return;
 ctx.drawImage(img,sx,sy,cw,chh,dx+cx*dw/sw,dy+cy*dh/sh,cw*dw/sw,chh*dh/sh);
}
function skinText(ctx,img,str,x,y,clip){
 if(!img)return;
 ctx.save();
 if(clip){ctx.beginPath();ctx.rect(clip[0],clip[1],clip[2],clip[3]);ctx.clip()}
 let cx=x;const s=String(str);
 for(let i=0;i<s.length;i++){
  const g=SKIN_FONT[s[i].toLowerCase()];
  if(g)blit(ctx,img,g[1]*5,g[0]*6,5,6,cx,y,5,6);
  cx+=5;
 }
 ctx.restore();
}
function skinScale(){return Math.max(1,Math.min(4,Number((musicCfg().skins||{}).scale)||2))}
function plHeight(){return Math.max(96,Number((musicCfg().skins||{}).playlistHeight)||196)}
function skinPlGeom(){
 const H=plHeight(),listTop=SKIN_PLTOP+3,listH=H-SKIN_PLTOP-SKIN_PLBOT-6;
 return {H:H,top:SKIN_PLTOP,bot:H-SKIN_PLBOT,listTop:listTop,listH:listH,
         rows:Math.max(1,Math.floor(listH/SKIN_ROWH))};
}

/* --- главное окно ----------------------------------------------------- */
function skinRender(){
 if(!skinActive||!skin)return;
 const cv=skinCvMain,ctx=cv.getContext('2d'),im=skin.img;
 ctx.imageSmoothingEnabled=false;
 blit(ctx,im.main,0,0,SKIN_W,SKIN_H,0,0,SKIN_W,SKIN_H);
 /* В части скинов main.bmp — «снимок» с запечёнными цифрами, текстом
  бегущей строки и индикаторами. Зоны, куда мы рисуем живое содержимое,
  сначала гасим (фон у них чёрный — как в оригинальном Winamp). */
 ctx.fillStyle='#000';
 SKIN_DIGITS.forEach(function(d){ctx.fillRect(d[0],d[1],9,13)});
 ctx.fillRect(SKIN_MARQUEE[0],SKIN_MARQUEE[1]-1,SKIN_MARQUEE[2],SKIN_MARQUEE[3]+3);
 if(im.titlebar){
  const st=musicWin.classList.contains('active')?SKIN_TITLEBAR.on:SKIN_TITLEBAR.off;
  blit(ctx,im.titlebar,st[0],st[1],275,14,0,0,275,14);
  SKIN_TITLEBTNS.forEach(function(b){
   const s=b.src[skinPress===b.id?1:0];
   blit(ctx,im.titlebar,s[0],s[1],9,9,b.x,3,9,9);
  });
 }
 const hasSrc=!!audioEl.getAttribute('src');
 if(im.playpaus){
  blit(ctx,im.playpaus,hasSrc?(audioEl.paused?9:0):18,0,9,9,
       SKIN_PLAYPAUS[0],SKIN_PLAYPAUS[1],9,9);
 }
 if(im.numbers&&hasSrc){
  const t=isFinite(audioEl.currentTime)?audioEl.currentTime:0;
  const m=Math.min(99,Math.floor(t/60)),s=Math.floor(t%60);
  const blink=audioEl.paused&&t>0&&Math.floor(Date.now()/1000)%2===1;
  const ch=[m<10?'':String(Math.floor(m/10)),String(m%10),
            String(Math.floor(s/10)),String(s%10)];
  for(let i=0;i<4;i++){
   if(ch[i]===' '||blink)continue;
   const d=ch[i].charCodeAt(0)-48;
   if(d>=0&&d<=9)blit(ctx,im.numbers,d*9,0,9,13,SKIN_DIGITS[i][0],SKIN_DIGITS[i][1],9,13);
  }
 }
 const title=(musicIndex>=0&&musicTracks[musicIndex])
   ?musicName(musicTracks[musicIndex]):'';
 if(title&&im.text){
  const box=SKIN_MARQUEE,w=title.length*5;
  if(w<=box[2])skinText(ctx,im.text,title,box[0],box[1],box);
  else{
   const span=w+18,off=((Date.now()/1000)*22)%span;
   skinText(ctx,im.text,title,box[0]-off,box[1],box);
   skinText(ctx,im.text,title,box[0]-off+span,box[1],box);
  }
 }
 if(im.monoster){
  blit(ctx,im.monoster,29,12,27,12,SKIN_MONO[0],SKIN_MONO[1],27,12);
  blit(ctx,im.monoster,0,0,29,12,SKIN_STEREO[0],SKIN_STEREO[1],29,12);
 }
 if(im.volume){
  blit(ctx,im.volume,0,0,68,13,SKIN_VOL[0],SKIN_VOL[1],68,13);
  const v=Math.max(0,Math.min(1,audioEl.volume));
  blit(ctx,im.volume,15,422,14,11,SKIN_VOL[0]+Math.round(v*51),SKIN_VOL[1]+1,14,11);
 }
 if(im.balance){
  blit(ctx,im.balance,9,0,38,13,SKIN_BAL[0],SKIN_BAL[1],38,13);
  blit(ctx,im.balance,15,422,14,11,SKIN_BAL[0]+12,SKIN_BAL[1]+1,14,11);
 }
 if(im.posbar){
  blit(ctx,im.posbar,0,0,248,10,SKIN_POS[0],SKIN_POS[1],248,10);
  const d=(isFinite(audioEl.duration)&&audioEl.duration>0)
    ?audioEl.currentTime/audioEl.duration:0;
  blit(ctx,im.posbar,248,0,29,10,
       SKIN_POS[0]+Math.round(Math.max(0,Math.min(1,d))*219),SKIN_POS[1],29,10);
 }
 if(im.cbuttons){
  SKIN_BTNS.forEach(function(b){
   const press=skinPress===b[0];
   blit(ctx,im.cbuttons,b[5],b[6]+(press?b[7]:0),b[3],b[4],b[1],b[2],b[3],b[4]);
  });
 }
 if(im.shufrep){
  SKIN_SHUF.forEach(function(b){
   const on=b[0]==='shuffle'?musicShuffle:(musicLoop!=='off');
   const press=skinPress===b[0];
   const row=on?(press?45:30):(press?15:0);
   blit(ctx,im.shufrep,b[5],b[6]+row,b[3],b[4],b[1],b[2],b[3],b[4]);
  });
  const eqOn=false;
  blit(ctx,im.shufrep,eqOn?0:46,eqOn?73:61,23,12,SKIN_EQ[0],SKIN_EQ[1],23,12);
  const plOn=skinPlOn;
  blit(ctx,im.shufrep,plOn?23:69,plOn?73:61,23,12,SKIN_PL[0],SKIN_PL[1],23,12);
 }
}

/* --- плейлист --------------------------------------------------------- */
function skinRenderPlaylist(){
 if(!skinActive||!skin)return;
 const ctx=skinCvPl.getContext('2d'),im=skin.img,c=skin.colors;
 const W=SKIN_W,g=skinPlGeom();
 ctx.imageSmoothingEnabled=false;
 if(im.pledit){
  blit(ctx,im.pledit,0,21,25,20,0,0,25,20);
  for(let x=25;x<W-25;x+=25)blit(ctx,im.pledit,127,21,25,20,x,0,25,20);
  blit(ctx,im.pledit,153,21,25,20,W-25,0,25,20);
  blit(ctx,im.pledit,26,21,100,20,37,0,100,20);
 }else{
  ctx.fillStyle=c.NormalBG;ctx.fillRect(0,0,W,g.top);
 }
 const cap=String((musicCfg().windowTitle||'Audio Player'));
 skinText(ctx,im.text,cap,41,7,[37,0,100,20]);
 if(im.pledit){
  for(let y=g.top;y<g.bot;y+=29)
   blit(ctx,im.pledit,0,42,12,Math.min(29,g.bot-y),0,y,12,g.bot-y);
  for(let y=g.top;y<g.bot;y+=29)
   blit(ctx,im.pledit,31,42,20,Math.min(29,g.bot-y),W-20,y,20,g.bot-y);
 }else{
  ctx.fillStyle=c.NormalBG;ctx.fillRect(0,g.top,W,g.bot-g.top);
 }
 ctx.fillStyle=c.NormalBG;
 ctx.fillRect(12,g.top,W-32,g.bot-g.top);
 const maxScroll=Math.max(0,musicTracks.length-g.rows);
 if(skinScroll>maxScroll)skinScroll=maxScroll;
 for(let i=0;i<g.rows;i++){
  const idx=skinScroll+i;
  if(idx>=musicTracks.length)break;
  const y=g.listTop+i*SKIN_ROWH;
  if(idx===skinSel){ctx.fillStyle=c.SelectedBG;ctx.fillRect(12,y,W-32,SKIN_ROWH)}
  ctx.fillStyle=idx===musicIndex?c.Current:c.Normal;
  ctx.font='9px "'+String(c.Font||'Arial').replace(/"/g,'')+'", Arial, sans-serif';
  ctx.textBaseline='top';
  ctx.fillText(musicName(musicTracks[idx]),15,y+2,W-34-15);
 }
 if(musicTracks.length>g.rows&&im.pledit){
  const th=Math.max(14,g.listH*g.rows/musicTracks.length);
  const ty=g.listTop+(maxScroll?skinScroll/maxScroll:0)*(g.listH-th);
  blit(ctx,im.pledit,52,53,8,18,W-15,ty,8,th);
 }
 if(im.pledit){
  blit(ctx,im.pledit,0,72,125,38,0,g.bot,125,38);
  blit(ctx,im.pledit,126,72,150,38,125,g.bot,150,38);
  [[0,111,14],[54,111,43],[104,111,72],[154,111,101],[204,111,W-44]]
   .forEach(function(b){blit(ctx,im.pledit,b[0],b[1],22,18,b[2],g.bot+8,22,18)});
 }else{
  ctx.fillStyle=c.NormalBG;ctx.fillRect(0,g.bot,W,g.H-g.bot);
 }
}

/* --- попадания мышью --------------------------------------------------- */
function skinHits(){
 const h=[];
 SKIN_BTNS.forEach(function(b){h.push({id:b[0],x:b[1],y:b[2],w:b[3],h:b[4]})});
 SKIN_SHUF.forEach(function(b){h.push({id:b[0],x:b[1],y:b[2],w:b[3],h:b[4]})});
 h.push({id:'eq',x:SKIN_EQ[0],y:SKIN_EQ[1],w:23,h:12});
 h.push({id:'pl',x:SKIN_PL[0],y:SKIN_PL[1],w:23,h:12});
 h.push({id:'seek',x:SKIN_POS[0],y:SKIN_POS[1],w:248,h:10});
 h.push({id:'vol',x:SKIN_VOL[0],y:SKIN_VOL[1],w:68,h:13});
 h.push({id:'bal',x:SKIN_BAL[0],y:SKIN_BAL[1],w:38,h:13});
 SKIN_TITLEBTNS.forEach(function(b){h.push({id:b.id,x:b.x,y:3,w:9,h:9})});
 h.push({id:'title',x:0,y:0,w:SKIN_W,h:14});
 return h;
}
function skinHit(x,y){
 const h=skinHits();
 for(let i=h.length-1;i>=0;i--){
  const r=h[i];
  if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)return r;
 }
 return null;
}
function skinPos(ev,cv){
 const r=cv.getBoundingClientRect();
 return [(ev.clientX-r.left)*cv.width/Math.max(1,r.width),
         (ev.clientY-r.top)*cv.height/Math.max(1,r.height)];
}
function skinDragTo(x){
 if(skinDrag==='seek'){
  if(!(isFinite(audioEl.duration)&&audioEl.duration>0))return;
  const k=Math.max(0,Math.min(1,(x-SKIN_POS[0])/248));
  audioEl.currentTime=k*audioEl.duration;
  skinRender();
 }else if(skinDrag==='vol'){
  const k=Math.max(0,Math.min(1,(x-SKIN_VOL[0])/65));
  audioEl.volume=k;
  if(musicVolEl)musicVolEl.value=String(Math.round(k*100));
  skinRender();
 }
}
function skinAction(id){
 switch(id){
  case 'play':musicToggle();break;
  case 'stop':audioEl.pause();audioEl.currentTime=0;musicSyncButtons();break;
  case 'next':musicNext(false);break;
  case 'prev':musicPrev();break;
  case 'eject':{const f=document.querySelector('[data-skin-file]');if(f)f.click();break}
  case 'shuffle':musicShuffle=!musicShuffle;musicSyncButtons();break;
  case 'repeat':musicLoop=musicLoop==='all'?'one':(musicLoop==='one'?'off':'all');
                musicSyncButtons();break;
  case 'pl':toggleSkinPlaylist();break;
  default:break;
 }
}
function toggleSkinPlaylist(){
 skinPlOn=!skinPlOn;
 if(skinCvPl)skinCvPl.style.display=skinPlOn?'':'none';
 skinFitWindow();
 skinRenderPlaylist();
}

/* --- размер окна под скин ---------------------------------------------- */
function skinFitWindow(){
 if(!skinActive||!musicWin||!skinHost)return;
 const sc=skinScale(),body=musicWin.querySelector('.winbody');
 const contentW=SKIN_W*sc,contentH=(SKIN_H+(skinPlOn?plHeight():0))*sc;
 skinCvMain.style.width=contentW+'px';
 skinCvMain.style.height=(SKIN_H*sc)+'px';
 skinCvPl.style.width=contentW+'px';
 skinCvPl.style.height=(skinPlOn?plHeight()*sc:0)+'px';
 skinHost.style.minWidth=contentW+'px';
 skinHost.style.minHeight=contentH+'px';
 if(!body)return;
 const cs=getComputedStyle(body);
 const padH=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
 const padV=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
 const gap=parseFloat(cs.rowGap)||0;
 let sum=0,n=0;
 for(let i=0;i<body.children.length;i++){
  const c=body.children[i];
  if(getComputedStyle(c).display==='none')continue;
  sum+=(c===skinHost?SKIN_H*sc+(skinPlOn?plHeight()*sc:0):c.offsetHeight);
  n++;
 }
 sum+=gap*Math.max(0,n-1);
 const bw=Math.max(0,musicWin.offsetWidth-body.clientWidth);
 const bh=Math.max(0,musicWin.offsetHeight-body.clientHeight);
 musicWin.style.width=(contentW+padH+bw)+'px';
 musicWin.style.height=(sum+padV+bh)+'px';
 musicWin.style.right='auto';musicWin.style.bottom='auto';
 const sw=scene.clientWidth,sh=scene.clientHeight;
 if(musicWin.dataset.manual!=='1'&&musicWin.dataset.placed!=='1'){
  musicWin.dataset.placed='1';
  musicWin.style.left=Math.max(10,Math.round((sw-musicWin.offsetWidth)/2))+'px';
  musicWin.style.top=Math.max(10,Math.round((sh-musicWin.offsetHeight)/2))+'px';
 }
 /* строгая посадка: окно со скином целиком помещается над панелью задач */
 const w=Math.min(musicWin.offsetWidth,sw),h=Math.min(musicWin.offsetHeight,sh);
 const l=parseFloat(musicWin.style.left),t=parseFloat(musicWin.style.top);
 musicWin.style.left=Math.min(Math.max(isNaN(l)?0:l,0),Math.max(0,sw-w))+'px';
 musicWin.style.top=Math.min(Math.max(isNaN(t)?0:t,0),Math.max(0,sh-h))+'px';
 musicWin.style.width=w+'px';musicWin.style.height=h+'px';
}

/* --- включение / выключение скина -------------------------------------- */
function deactivateSkin(){
 const was=skinActive;
 skinActive=false;skin=null;skinPress=null;skinDrag=null;
 if(skinHost)skinHost.classList.remove('on');
 const mi=document.querySelector('.music-inner');
 if(mi)mi.classList.remove('off');
 const sel=document.querySelector('[data-skin-select]');
 if(sel)sel.value='';
 if(musicWin&&musicWin.dataset.manual!=='1'){
  const cfg=musicCfg(),sw=scene.clientWidth,sh=scene.clientHeight;
  const w=Math.min(Math.max(250,Number(cfg.width)||300),Math.max(250,sw-20));
  const h=Math.min(Math.max(210,Number(cfg.height)||300),Math.max(210,sh-20));
  musicWin.style.width=w+'px';musicWin.style.height=h+'px';
  musicWin.style.right='auto';musicWin.style.bottom='auto';
  clampWindow(musicWin);
 }
}
async function applySkin(name,bytes){
 const sel=document.querySelector('[data-skin-select]');
 try{
  if(!name&&!bytes){deactivateSkin();return}
  let buf=bytes;
  if(!buf&&name&&name[0]==='~')buf=skinDisk[name];
  if(!buf){
   const cfg=musicCfg().skins||{};
   const base=String(cfg.dir||'skins/').replace(/\/?$/,'/');
   const url=base+String(name).split('/').map(encodeURIComponent).join('/');
   const r=await fetch(url,{cache:'no-store'});
   if(!r.ok)throw new Error(r.status===404?'no such file (HTTP 404)':'HTTP '+r.status);
   buf=await r.arrayBuffer();
  }
  const parsed=await skinParse(buf);
  skin=parsed;skinActive=true;skinName=String(name||'');
  skinScroll=0;skinSel=-1;skinPlOn=true;
  skinCvPl.style.display='';
  skinHost.classList.add('on');
  const mi=document.querySelector('.music-inner');
  if(mi)mi.classList.add('off');
  skinFitWindow();
  skinRender();skinRenderPlaylist();
  if(sel)sel.value=name||'';
  setMusicStatus('Skin: '+String(name||'from disk').replace(/^~/,'')+
                 ' · '+musicTracks.length+' track'+(musicTracks.length===1?'':'s'));
 }catch(err){
  console.warn('[skin]',err);
  setMusicStatus('Cannot load skin: '+(err&&err.message?err.message:'unknown error'));
  if(sel)sel.value=skinActive&&skinName?skinName:'';
  if(!skinActive)deactivateSkin();
 }
}
function loadSkinList(){
 const cfg=musicCfg().skins||{};
 const sel=document.querySelector('[data-skin-select]');
 if(!sel)return Promise.resolve();
 sel.innerHTML='';
 sel.appendChild(new Option('No skin (classic)',''));
 if(!cfg.list)return Promise.resolve();
 return fetch(cfg.list,{cache:'no-store'})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
  .then(function(j){
   const names=Array.isArray(j&&j.skins)?j.skins:[];
   names.forEach(function(n){sel.appendChild(new Option(n,n))});
   if(cfg.start&&names.indexOf(cfg.start)>=0){sel.value=cfg.start;return applySkin(cfg.start)}
  })
  .catch(function(err){
   console.warn('[skin]',err);
   setMusicStatus('Skin list unavailable ('+err.message+')');
  });
}
function skinTick(){if(skinActive)skinRender()}

(function initSkins(){
 const cfg=musicCfg().skins||{};
 if(cfg.enabled===false)return;
 skinHost=document.querySelector('[data-skin-host]');
 if(!skinHost)return;
 skinCvMain=document.createElement('canvas');
 skinCvMain.width=SKIN_W;skinCvMain.height=SKIN_H;
 skinCvMain.setAttribute('data-skin-main','1');
 skinCvPl=document.createElement('canvas');
 skinCvPl.width=SKIN_W;skinCvPl.height=plHeight();
 skinCvPl.setAttribute('data-skin-pl','1');
 skinHost.appendChild(skinCvMain);
 skinHost.appendChild(skinCvPl);

 /* главное окно: нажатия кнопок, перемотка, громкость, перетаскивание */
 skinCvMain.addEventListener('pointerdown',function(ev){
  if(ev.button!==0)return;
  const p=skinPos(ev,skinCvMain),hit=skinHit(p[0],p[1]);
  if(!hit)return;
  if(hit.id==='close'){showWindow(musicWin,false);return}
  if(hit.id==='title'){
   const rect=musicWin.getBoundingClientRect();
   dragState={win:musicWin,offX:ev.clientX-rect.left,offY:ev.clientY-rect.top};
   focusWindow(musicWin);
   try{skinCvMain.setPointerCapture(ev.pointerId)}catch(e){}
   ev.preventDefault();skinRender();return;
  }
  if(hit.id==='seek'||hit.id==='vol'){
   skinDrag=hit.id;skinDragTo(p[0]);
   try{skinCvMain.setPointerCapture(ev.pointerId)}catch(e){}
   ev.preventDefault();return;
  }
  skinPress=hit.id;
  try{skinCvMain.setPointerCapture(ev.pointerId)}catch(e){}
  ev.preventDefault();skinRender();
 });
 skinCvMain.addEventListener('pointermove',function(ev){
  const p=skinPos(ev,skinCvMain);
  if(skinDrag){skinDragTo(p[0]);ev.preventDefault();return}
  const hit=skinHit(p[0],p[1]);
  skinCvMain.style.cursor=hit&&hit.id!=='title'?'pointer':'default';
 });
 skinCvMain.addEventListener('pointerup',function(ev){
  if(skinDrag){skinDrag=null;return}
  const p=skinPos(ev,skinCvMain),hit=skinHit(p[0],p[1]);
  const press=skinPress;skinPress=null;
  if(press&&hit&&hit.id===press)skinAction(press);
  skinRender();
 });
 skinCvMain.addEventListener('pointercancel',function(){
  skinPress=null;skinDrag=null;skinRender();
 });

 /* плейлист: клик по строке = играть, колесо = прокрутка */
 skinCvPl.addEventListener('pointerdown',function(ev){
  if(ev.button!==0)return;
  const p=skinPos(ev,skinCvPl),g=skinPlGeom();
  const row=Math.floor((p[1]-g.listTop)/SKIN_ROWH);
  if(row<0||row>=g.rows)return;
  const idx=skinScroll+row;
  if(idx<0||idx>=musicTracks.length)return;
  skinSel=idx;
  musicPlay(idx);
  skinRenderPlaylist();
 });
 skinCvPl.addEventListener('wheel',function(ev){
  const g=skinPlGeom(),max=Math.max(0,musicTracks.length-g.rows);
  const next=Math.max(0,Math.min(max,skinScroll+(ev.deltaY>0?3:-3)));
  if(next===skinScroll)return;
  skinScroll=next;skinRenderPlaylist();ev.preventDefault();
 },{passive:false});

 /* панель выбора скина */
 const sel=document.querySelector('[data-skin-select]');
 if(sel)sel.addEventListener('change',function(){
  const v=sel.value;
  if(!v){deactivateSkin();return}
  applySkin(v,skinDisk[v]);
 });
 const openBtn=document.querySelector('[data-skin-open]');
 const fileEl=document.querySelector('[data-skin-file]');
 if(openBtn&&fileEl){
  openBtn.addEventListener('click',function(){fileEl.click()});
  fileEl.addEventListener('change',function(){
   const f=fileEl.files&&fileEl.files[0];
   fileEl.value='';
   if(f)loadSkinFromDisk(f);
  });
 }
 /* перетащить .wsz прямо на окно плеера */
 if(musicWin){
  musicWin.addEventListener('dragover',function(ev){
   if(ev.dataTransfer&&Array.prototype.indexOf.call(ev.dataTransfer.types,'Files')>=0)
    ev.preventDefault();
  });
  musicWin.addEventListener('drop',function(ev){
   const f=ev.dataTransfer&&ev.dataTransfer.files&&ev.dataTransfer.files[0];
   if(!f)return;
   ev.preventDefault();
   loadSkinFromDisk(f);
  });
  musicWin.addEventListener('pointerdown',function(){skinRender()});
 }
 loadSkinList();
 setInterval(skinTick,100);
})();

function loadSkinFromDisk(file){
 if(!/\.(wsz|zip)$/i.test(file.name)){
  setMusicStatus('Cannot open: '+file.name+' — a skin must be .wsz or .zip');
  return;
 }
 const sel=document.querySelector('[data-skin-select]');
 file.arrayBuffer().then(function(buf){
  const key='~'+file.name;
  skinDisk[key]=buf;
  if(sel){
   let opt=null;
   for(let i=0;i<sel.options.length;i++)if(sel.options[i].value===key)opt=sel.options[i];
   if(!opt){opt=new Option(file.name+' (disk)',key);sel.appendChild(opt)}
   sel.value=key;
  }
  return applySkin(key,buf);
 }).catch(function(err){
  console.warn('[skin]',err);
  setMusicStatus('Cannot read '+file.name+': '+err.message);
 });
}

(function initMusic(){
 const cfg=musicCfg();
 if(cfg.enabled===false)return;
 musicShuffle=!!cfg.shuffle;
 musicLoop=cfg.loop||'all';
 if(musicVolEl){
  const v=cfg.volume==null?0.8:Number(cfg.volume);
  musicVolEl.value=String(Math.round(Math.max(0,Math.min(1,v))*100));
  audioEl.volume=Math.max(0,Math.min(1,v));
 }
 musicSyncButtons();
 musicTrackTitle();
 loadMusic();
 if(cfg.startOpen&&musicWin)showWindow(musicWin,true);
})();

function layoutWindows(force){
  /* Есть сохранённая раскладка — применяем её (координаты хранятся дробями
     от размера сцены, поэтому переживают другой размер окна браузера).
     Иначе — расставляем окна по умолчанию, как раньше. */
  if(layoutReady&&savedLayout&&CONFIG.rememberLayout!==false&&applySavedLayout(savedLayout)){
    /* в сохранённой раскладке может не быть новых окон (например, появился
       второй Picture Viewer) — они встают на своё место сами */
    autoSizeArt();
    placeTerm();      // и терминал, если его в раскладке ещё не было
    placeExtra(document.getElementById('winNetwork'));
    placeExtra(document.getElementById('winDownloads'));
    placeExtra(document.getElementById('winTelegram'));
    return;
  }
  const sw=scene.clientWidth,sh=scene.clientHeight,m=10;
  const servers=document.getElementById('winServers');
  servers.style.left=m+'px';
  servers.style.top=m+'px';
  servers.style.right='auto';
  servers.style.bottom='auto';
  servers.style.width='auto';
  servers.style.height='auto';
  servers.style.maxWidth=(sw-2*m)+'px';
  servers.style.maxHeight=(sh-2*m)+'px';
  servers.dataset.maximized='0';
  autoSizeArt(force);
  /* Монитор встаёт первым — терминал объезжает его. Но пока терминалы
     стоят без координат (окна только что созданы или сброшены), монитор
     занимает слишком широкое место и терминалы встают внахлёст. Поэтому
     расставляем в три захода: на втором монитор видит припаркованные
     терминалы и сужается (место освобождается), на третьем — подрастает
     под уже вставшие окна. Раскладка сходится за один вызов — так
     initLayout и resetLayout обходятся без ожидания следующего тика
     монитора. */
  for(let pass=0;pass<3;pass++){
    placeMonitor();
    placeTerm();
    placeMusic();
    placeExtra(document.getElementById('winNetwork'));
    placeExtra(document.getElementById('winDownloads'));
    placeExtra(document.getElementById('winTelegram'));
  }
}

/* === Конструктор раскладки ================================================
   Что снимаем (captureLayout): какие окна открыты, их положение и размер в
   долях от сцены, порядок (z), какие карточки services выключены.
   Что применяем (applySavedLayout): доли * текущий размер сцены, зажатые
   внутрь рабочего стола (в т.ч. над таскбаром — он вне сцены).
   Куда пишем (saveLayoutNow): POST api/layout -> layout.json на сервере,
   плюс зеркало в localStorage на случай недоступности сервера.          === */
function rnd4(v){return Math.round(v*1e4)/1e4}

function captureLayout(){
  const sw=scene.clientWidth,sh=scene.clientHeight;
  if(!sw||!sh)return null;
  const wins={},order=[];
  appWindows.forEach(w=>{
    const autoW=!w.style.width||w.style.width==='auto';
    const autoH=!w.style.height||w.style.height==='auto';
    let x=parseFloat(w.style.left),y=parseFloat(w.style.top);
    let ww=autoW?null:parseFloat(w.style.width);
    let hh=autoH?null:parseFloat(w.style.height);
    if(w.dataset.maximized==='1'){          // само окно развернуто — запоминаем
      const px=parseFloat(w.dataset.prevLeft),py=parseFloat(w.dataset.prevTop); // его размеры до разворачивания
      const pw=w.dataset.prevW,ph=w.dataset.prevH;
      if(!isNaN(px))x=px;
      if(!isNaN(py))y=py;
      ww=(pw&&pw!=='auto'&&!isNaN(parseFloat(pw)))?parseFloat(pw):null;
      hh=(ph&&ph!=='auto'&&!isNaN(parseFloat(ph)))?parseFloat(ph):null;
    }
    if(isNaN(x)||isNaN(y)){
      const r=rectInScene(w);
      if(r.w>0||r.h>0){if(isNaN(x))x=r.x;if(isNaN(y))y=r.y;}
    }
    const rec={open:w.hidden?0:1};
    if(!isNaN(x)&&!isNaN(y)){rec.x=rnd4(x/sw);rec.y=rnd4(y/sh);}
    rec.w=(ww!=null&&ww>0)?rnd4(ww/sw):null;   // null = окно с авто-размером
    rec.h=(hh!=null&&hh>0)?rnd4(hh/sh):null;
    if(w.dataset.maximized==='1')rec.max=1;
    wins[w.id]=rec;
    order.push({id:w.id,z:Number(w.style.zIndex)||0});
  });
  order.sort((a,b)=>a.z-b.z);
  return {v:1,scene:{w:sw,h:sh},z:order.map(o=>o.id),wins,
          svc:[...hiddenSvc].sort((a,b)=>a-b),theme:currentTheme,font:currentFont};
}

function setMaximized(win,on){
  if(!win)return;
  if(on&&win.dataset.maximized!=='1'){
    win.dataset.prevLeft=win.style.left;win.dataset.prevTop=win.style.top;
    win.dataset.prevW=win.style.width;win.dataset.prevH=win.style.height;
    win.style.right='auto';win.style.bottom='auto';
    win.style.left='2px';win.style.top='2px';
    win.style.width=(scene.clientWidth-4)+'px';
    win.style.height=(scene.clientHeight-4)+'px';
    win.dataset.maximized='1';
    fitAscii();
  }else if(!on&&win.dataset.maximized==='1'){
    if(win.dataset.prevLeft!=null)win.style.left=win.dataset.prevLeft;
    if(win.dataset.prevTop!=null)win.style.top=win.dataset.prevTop;
    if(win.dataset.prevW)win.style.width=win.dataset.prevW;
    if(win.dataset.prevH)win.style.height=win.dataset.prevH;
    win.dataset.maximized='0';
    fitAscii();
  }
}

function applySavedLayout(data){
  if(!data||data.v!==1||!data.wins)return false;
  const sw=scene.clientWidth,sh=scene.clientHeight;
  if(!sw||!sh)return false;
  layoutApplying=true;
  try{
    /* тема и шрифт приезжают вместе с раскладкой — выбрано где-то ещё,
       значит общее для всех устройств */
    if(data.theme==='dark'||data.theme==='light')applyTheme(data.theme);
    if(typeof data.font==='string'&&data.font.trim())applyFont(data.font);
    const m=10;
    const restoredGeo=[];        // просмотрщики, монитор, терминал: задумано и нарисовано
    appWindows.forEach(w=>{
      const rec=data.wins[w.id];if(!rec)return;
      /* Терминал, которого раскладка ещё не двигала (координат в записи
         нет): геометрию пропускаем — место он займёт сам через placeTerm,
         иначе центр экрана поверх всех окон, — а открыто/закрыто
         применяем: закрытое окно не должно приезжать обратно */
      const termAuto=isTermWin(w)&&rec.x==null&&rec.y==null;
      /* геометрия: доля -> пиксели, затем зажимаем внутрь сцены */
      const autoW=rec.w==null,autoH=rec.h==null;
      w.style.right='auto';w.style.bottom='auto';
      w.style.maximized='0';
      w.style.width=autoW?'auto':Math.min(Math.max(120,Math.round(rec.w*sw)),sw)+'px';
      w.style.height=autoH?'auto':Math.min(Math.max(90,Math.round(rec.h*sh)),sh)+'px';
      w.style.maxWidth=autoW?Math.max(120,sw-2*m)+'px':'';
      w.style.maxHeight=autoH?Math.max(90,sh-2*m)+'px':'';
      const rw=w.offsetWidth||0,rh=w.offsetHeight||0;
      let x=rec.x==null?null:Math.round(rec.x*sw);
      let y=rec.y==null?null:Math.round(rec.y*sh);
      if(!termAuto){
        if(x==null||y==null){                   // координат нет — центрируем
          if(x==null)x=Math.round((sw-rw)/2);
          if(y==null)y=Math.round((sh-rh)/2);
        }
        x=Math.min(Math.max(x,0),Math.max(0,sw-rw));
        y=Math.min(Math.max(y,0),Math.max(0,sh-rh));
        w.style.left=x+'px';w.style.top=y+'px';
        /* позиция восстановлена — авто-расстановки её больше не трогают */
        w.dataset.manual='1';
        if(w.id==='winMusic')w.dataset.placed='1';
      }
      /* открыто/закрыто (выключенные в config.js окна остаются закрытыми) */
      const offByConfig=(w.id==='winMusic'&&musicCfg().enabled===false)||
                        (w.id==='winMonitor'&&(CONFIG.monitor||{}).enabled===false)||
                        (w.id==='winNetwork'&&(CONFIG.network||{}).enabled===false)||
                        (w.id==='winDownloads'&&(CONFIG.downloads||{}).enabled===false)||
                        (w.id==='winTelegram'&&(CONFIG.telegram||{}).enabled===false)||
                        (isTermWin(w)&&termCfg().enabled===false);
      const wantOpen=!offByConfig&&!!rec.open;
      w.hidden=!wantOpen;
      if(!wantOpen){const btn=taskFor(w);if(btn)btn.classList.remove('active');}
      if(wantOpen&&rec.max)setMaximized(w,true);
      /* геометрия для проверки накладок ниже: plan — как задумано раскладкой
         (доли без зажатия внутрь сцены), rect — как окно реально нарисовалось */
      if(!termAuto&&!w.hidden&&(isViewer(w)||w.id==='winMonitor'||isTermWin(w))&&w.dataset.maximized!=='1'){
        const rw2=w.offsetWidth||0,rh2=w.offsetHeight||0;
        restoredGeo.push({w,isViewer:isViewer(w),
          rect:{x,y,w:rw2,h:rh2},
          plan:{x:rec.x==null?x:Math.round(rec.x*sw),
                y:rec.y==null?y:Math.round(rec.y*sh),
                w:parseFloat(w.style.width)||rw2,h:parseFloat(w.style.height)||rh2}});
      }
    });
    /* карточки services */
    if(Array.isArray(data.svc)){
      const s=new Set();
      data.svc.forEach(i=>{if(Number.isInteger(i)&&i>=0&&i<CONFIG.services.length)s.add(i)});
      hiddenSvc=s;
    }
    renderServices();
    /* порядок окон */
    const order=Array.isArray(data.z)?data.z:[];
    order.forEach((id,i)=>{
      const w=appWindows.find(el=>el.id===id);
      if(w)w.style.zIndex=String(10+i);
    });
    zCounter=Math.max(zCounter,10+appWindows.length+order.length);
    /* На узком экране сохранённый размер бывает уже min-width: окно растёт
       до минимума и заезжает на соседа, хотя в раскладке окна не пересекались.
       Такую накладку разводим в ближайшее свободное место (размер окон не
       трогаем); намеренную «стопку» из раскладки не трогаем — по задумке окна
       в ней пересекаются. */
    const srvW=document.getElementById('winServers');
    const sRect=srvW.hidden?null:rectInScene(srvW);
    const vs=restoredGeo.filter(g=>g.isViewer);
    vs.forEach(g=>{
      const others=restoredGeo.filter(o=>o!==g);
      let clash=others.some(o=>overlapArea(g.rect,o.rect)>0&&overlapArea(g.plan,o.plan)===0);
      if(!clash&&sRect)clash=overlapArea(g.rect,sRect)>0&&overlapArea(g.plan,sRect)===0;
      if(!clash)return;
      const blockers=others.map(o=>o.rect);
      if(sRect)blockers.push(sRect);
      const np=dodgeWindows(g.rect.x,g.rect.y,g.rect.w,g.rect.h,blockers,sw,sh,m);
      g.w.style.left=np.x+'px';g.w.style.top=np.y+'px';
      g.rect.x=np.x;g.rect.y=np.y;
    });
    /* Развести не удалось (места под этот экран нет) — перераскладываем все
       окна просмотра заново: они ужмутся под текущий экран и встанут в ряд,
       как при обычной загрузке без сохранённой раскладки. Намеренную стопку
       (окна пересекались и в самой раскладке) не трогаем. */
    let stuck=false;
    for(let i=0;i<vs.length&&!stuck;i++)
      for(let j=i+1;j<vs.length;j++){
        const a=vs[i],b=vs[j];
        if(overlapArea(a.rect,b.rect)>0&&overlapArea(a.plan,b.plan)===0){stuck=true;break}
      }
    if(stuck){
      viewers.forEach(v=>{if(!v.win.hidden)v.win.dataset.manual=''});
      autoSizeArt(true);
    }
    const topId=order[order.length-1];
    const topW=topId?document.getElementById(topId):null;
    const active=(topW&&!topW.hidden)?topW:appWindows.find(w=>!w.hidden);
    if(active)focusWindow(active);
  }catch(err){
    console.warn('[layout] apply failed',err);
    layoutApplying=false;
    return false;
  }
  layoutApplying=false;
  fitAscii();
  syncLayoutPalette();
  return true;
}

function flashStatus(msg){
  const cell=document.querySelector('.statusbar div');
  if(!cell)return;
  if(!flashStatus.home)flashStatus.home=cell.textContent;
  cell.textContent=msg;
  clearTimeout(flashTimer);
  flashTimer=setTimeout(()=>{cell.textContent=flashStatus.home},3500);
}

function scheduleLayoutSave(){
  if(!layoutReady||layoutApplying)return;
  if(CONFIG.rememberLayout===false)return;
  clearTimeout(layoutSaveTimer);
  layoutSaveTimer=setTimeout(()=>saveLayoutNow(false),400);
}

function saveLayoutNow(manual){
  if(CONFIG.rememberLayout===false){
    if(manual)flashStatus('Layout memory is off (config.js)');
    return;
  }
  const data=captureLayout();
  if(!data){
    if(manual)flashStatus('Nothing to save — no window is visible');
    return;
  }
  savedLayout=data;
  try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(data))}catch(e){}
  syncLayoutPalette();
  fetch('api/layout',{method:'POST',headers:{'Content-Type':'application/json'},
                      body:JSON.stringify(data)})
    .then(res=>{
      if(!res.ok)throw new Error('HTTP '+res.status);
      if(manual)flashStatus('Layout saved');
    })
    .catch(err=>{
      console.warn('[layout] save failed',err);
      if(manual)flashStatus('Layout saved on this device (server unreachable)');
    });
}

async function loadSavedLayout(){
  try{                                   // сначала сервер — он главный
    const res=await fetch('api/layout',{cache:'no-store'});
    if(res.ok){
      const data=await res.json();
      if(data&&data.v===1&&data.wins)return data;
    }
  }catch(e){}
  try{                                   // потом локальное зеркало
    const raw=localStorage.getItem(LAYOUT_KEY);
    if(raw){const data=JSON.parse(raw);if(data&&data.v===1&&data.wins)return data;}
  }catch(e){}
  return null;
}

function resetLayout(){
  savedLayout=null;
  layoutApplying=true;
  try{
    appWindows.forEach(w=>{
      w.dataset.manual='';w.dataset.placed='';
      w.dataset.maximized='0';
      w.style.zIndex='';
      /* окна открываем как задумано по умолчанию (с учётом config.js) */
      const offByConfig=(w.id==='winMusic'&&musicCfg().enabled===false)||
                        (w.id==='winMonitor'&&(CONFIG.monitor||{}).enabled===false)||
                        (w.id==='winNetwork'&&(CONFIG.network||{}).enabled===false)||
                        (w.id==='winDownloads'&&(CONFIG.downloads||{}).enabled===false)||
                        (w.id==='winTelegram'&&(CONFIG.telegram||{}).enabled===false)||
                        (isTermWin(w)&&termCfg().enabled===false);
      let wantOpen=!offByConfig;
      if(w.id==='winMusic')wantOpen=wantOpen&&!!musicCfg().startOpen;
      if(isTermWin(w))wantOpen=wantOpen&&termCfg().startOpen!==false;   // все консоли сразу
      if(w.id==='winNetwork')wantOpen=wantOpen&&!!(CONFIG.network||{}).startOpen;
      if(w.id==='winDownloads')wantOpen=wantOpen&&!!(CONFIG.downloads||{}).startOpen;
      if(w.id==='winTelegram')wantOpen=wantOpen&&!!(CONFIG.telegram||{}).startOpen;
      w.hidden=!wantOpen;
      if(!wantOpen){const btn=taskFor(w);if(btn)btn.classList.remove('active');}
      /* терминал ставится ПОСЛЕ монитора, поэтому его старая геометрия
         (например, после перетаскивания) воспринималась бы монитором как
         занятое место и сдвигала бы его на крайний вариант с наложением.
         Reset — значит «всё на места», чистим координаты перед перекладкой */
      if(isTermWin(w)){w.style.left='';w.style.top='';w.style.width='';w.style.height='';}
    });
    hiddenSvc=new Set();
    renderServices();
  }finally{layoutApplying=false}
  clearTimeout(layoutSaveTimer);
  try{localStorage.removeItem(LAYOUT_KEY)}catch(e){}
  /* тема и шрифт возвращаются к тому, что задано в config.js
     (выбор кнопки и диалога забываем) */
  setTheme(CONFIG.theme==='dark'?'dark':'light',false);
  setFont(defaultFont(),false);
  fetch('api/layout',{method:'DELETE'}).catch(()=>{});
  layoutWindows(true);
  zCounter=10;
  focusWindow(document.getElementById('winServers'));
  syncLayoutPalette();
  flashStatus('Layout reset');
}

/* --- палитра (View → Layout constructor…) -------------------------------- */
function winTitle(w){
  const el=w.querySelector('[data-server-name],[data-art-title],[data-monitor-title],[data-music-title],[data-term-title]');
  if(el&&el.textContent.trim())return el.textContent.trim();
  const bar=w.querySelector('.titlebar .titleleft>span:last-child');
  return bar?bar.textContent.trim():w.id;
}
function buildLayoutPalette(){
  if(!layoutPaletteEl)return;
  const winBox=layoutPaletteEl.querySelector('[data-palette-wins]');
  const svcBox=layoutPaletteEl.querySelector('[data-palette-svc]');
  if(winBox)winBox.innerHTML=appWindows.map(w=>{
    const on=!w.hidden;
    return `<label class="${on?'':'is-off'}"><input type="checkbox" data-pal-win="${w.id}"${on?' checked':''}>${winTitle(w)}</label>`;
  }).join('');
  if(svcBox)svcBox.innerHTML=CONFIG.services.map((svc,i)=>{
    if(svcOff(svc))return '';                    // выключенное окно — нет и пункта
    const on=!hiddenSvc.has(i);
    return `<label class="${on?'':'is-off'}"><input type="checkbox" data-pal-svc="${i}"${on?' checked':''}>${svc.name} :${svc.port}</label>`;
  }).join('');
}
function syncLayoutPalette(){
  if(!layoutPaletteEl||layoutPaletteEl.hidden)return;
  buildLayoutPalette();
}
function openLayoutPalette(){
  if(!layoutPaletteEl)return;
  buildLayoutPalette();
  layoutPaletteEl.hidden=false;
  layoutPaletteEl.style.zIndex=String(++zCounter);
  if(!layoutPaletteEl.style.left){                       // первый раз — по центру
    const w=layoutPaletteEl.offsetWidth,h=layoutPaletteEl.offsetHeight;
    layoutPaletteEl.style.left=Math.max(8,Math.round((window.innerWidth-w)/2))+'px';
    layoutPaletteEl.style.top=Math.max(8,Math.min(window.innerHeight-h-60,140))+'px';
  }
}
function closeLayoutPalette(){if(layoutPaletteEl)layoutPaletteEl.hidden=true}

if(layoutPaletteEl){
layoutPaletteEl.addEventListener('change',event=>{
  const t=event.target;
  if(t.matches('[data-pal-win]')){
    const w=document.getElementById(t.dataset.palWin);
    // checked = окно открыто, а w.hidden — ровно наоборот: срабатываем, когда
    // фактическое состояние не совпадает с галочкой
    if(w&&w.hidden===t.checked)showWindow(w,t.checked);
  }else if(t.matches('[data-pal-svc]')){
    const i=Number(t.dataset.palSvc);
    if(t.checked)hiddenSvc.delete(i);else hiddenSvc.add(i);
    const lab=t.closest('label');if(lab)lab.classList.toggle('is-off',!t.checked);
    renderServices();
    scheduleLayoutSave();
  }
});
layoutPaletteEl.addEventListener('click',event=>{
  if(event.target.closest('[data-palette-close]'))closeLayoutPalette();
  else if(event.target.closest('[data-palette-save]'))saveLayoutNow(true);
  else if(event.target.closest('[data-palette-reset]'))resetLayout();
});
layoutPaletteEl.addEventListener('pointerdown',event=>{
  const bar=event.target.closest('[data-palette-drag]');
  if(!bar||event.target.closest('.window-controls'))return;
  const rect=layoutPaletteEl.getBoundingClientRect();
  paletteDrag={offX:event.clientX-rect.left,offY:event.clientY-rect.top};
  layoutPaletteEl.style.zIndex=String(++zCounter);
  try{bar.setPointerCapture(event.pointerId)}catch(e){}
  event.preventDefault();
});
}
window.addEventListener('pointermove',event=>{
  if(!paletteDrag)return;
  const x=Math.min(Math.max(0,event.clientX-paletteDrag.offX),Math.max(0,window.innerWidth-70));
  const y=Math.min(Math.max(0,event.clientY-paletteDrag.offY),Math.max(0,window.innerHeight-30));
  layoutPaletteEl.style.left=x+'px';layoutPaletteEl.style.top=y+'px';
});
window.addEventListener('pointerup',()=>{paletteDrag=null});


/* --- System Monitor: опрос /api/stats ---------------------------------- */
let monitorTimer=null,monitorBusy=false;
function monitorConfig(){return CONFIG.monitor||{}}
function monitorHidden(){const w=document.getElementById('winMonitor');return !w||w.hidden}
function setMetric(name,pct,text){
  const row=document.querySelector('.metric[data-metric="'+name+'"]');
  if(!row)return;
  const fill=row.querySelector('.gauge-fill');
  if(fill){
    const v=Number(pct);
    fill.style.width=(isFinite(v)?Math.max(0,Math.min(100,v)):0)+'%';
  }
  const val=row.querySelector('.metric-value');
  if(val)val.textContent=text;
}
function fmtPct(v){return(v==null||!isFinite(Number(v)))?'—':(Math.round(Number(v)*10)/10).toFixed(1)+'%'}
function esc(v){
  return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pctOf(v){const n=Number(v);return isFinite(n)?Math.max(0,Math.min(100,n)):0}
function usedLevel(v){const n=Number(v);if(!isFinite(n))return'';return n>=90?' is-crit':(n>=75?' is-warn':'')}
function fmtGb(v){
  const n=Number(v);
  if(!isFinite(n))return null;
  return (n>=100?Math.round(n):Math.round(n*10)/10)+' GB';
}
function diskSub(dr){
  const p=[];
  const free=fmtGb(dr.free_gb),total=fmtGb(dr.total_gb);
  if(free&&total)p.push(free+' free of '+total);
  else if(free)p.push(free+' free');
  else if(total)p.push(total);
  if(dr.fstype)p.push(dr.fstype);
  return p.join(' · ');
}
function diskRowHtml(dr,i){
  return '<div class="srow'+usedLevel(dr.used)+'" data-i="'+i+'">'
    +'<div class="srow-head">'
      +'<span class="srow-name" title="'+esc(dr.device_full||dr.device||'')+'">'+esc(dr.mount||'?')+'</span>'
      +'<span class="srow-meta">'+esc(dr.device||'')+'</span>'
      +'<span class="srow-val">'+fmtPct(dr.used)+'</span>'
    +'</div>'
    +'<div class="gauge"><div class="gauge-fill" style="width:'+pctOf(dr.used)+'%"></div></div>'
    +'<div class="srow-sub">'+esc(diskSub(dr))+'</div>'
  +'</div>';
}
function syncDiskRow(row,dr){
  if(!row)return;
  row.className='srow'+usedLevel(dr.used);
  const nm=row.querySelector('.srow-name'); if(nm)nm.textContent=dr.mount||'?';
  const mt=row.querySelector('.srow-meta'); if(mt)mt.textContent=dr.device||'';
  const vl=row.querySelector('.srow-val'); if(vl)vl.textContent=fmtPct(dr.used);
  const fl=row.querySelector('.gauge-fill'); if(fl)fl.style.width=pctOf(dr.used)+'%';
  const sb=row.querySelector('.srow-sub'); if(sb)sb.textContent=diskSub(dr);
}
/* --- RAID --------------------------------------------------------------- */
function raidStateText(r){
  const st=(r.status?' ['+r.status+']':'');
  if(r.state==='clean')return 'clean'+st;
  if(r.state==='degraded')return 'DEGRADED'+st;
  if(r.state==='inactive')return 'inactive';
  return r.state||'?';                       // recovery 42.0%, resync …
}
function raidLevel(r){
  const lv=r.level&&r.level!=='md'?r.level+' · ':'';
  const sz=fmtGb(r.size_gb);
  return lv+(sz?sz:'');
}
function raidPct(r){
  // null означает «идёт восстановление? нет» — прогресса нет вообще,
  // поэтому проверяем на null до Number(), иначе Number(null)===0
  if(r.progress!=null&&r.progress!==''){
    const p=Number(r.progress);
    if(isFinite(p))return p;
  }
  const total=Number(r.total)||0;
  return total?((Number(r.online)||0)/total)*100:0;
}
function raidClass(r){
  if(r.state==='clean')return '';
  if(r.state==='degraded'||r.state==='inactive')return ' is-bad';
  return ' is-work';
}
function partChip(c){
  const flag=c.flag==='failed'?'×':(c.flag==='spare'?'○':'●');
  const cls=c.flag==='failed'?'part failed':(c.flag==='spare'?'part spare':'part ok');
  const sz=Number(c.size_gb)>0?fmtGb(c.size_gb):null;
  const label=esc(c.device)+(sz?' · '+sz:'')+(c.flag==='spare'?' · spare':'');
  return '<span class="'+cls+'" title="'+esc(c.flag)+'"><span class="flag">'+flag+'</span>'+label+'</span>';
}
function raidRowHtml(r,i){
  return '<div class="srow'+raidClass(r)+'" data-i="'+i+'">'
    +'<div class="srow-head">'
      +'<span class="srow-name" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
      +'<span class="srow-meta">'+esc(raidLevel(r))+'</span>'
      +'<span class="srow-val">'+esc(raidStateText(r))+'</span>'
    +'</div>'
    +'<div class="gauge"><div class="gauge-fill" style="width:'+pctOf(raidPct(r))+'%"></div></div>'
    +'<div class="parts">'+(r.components||[]).map(partChip).join('')+'</div>'
  +'</div>';
}
function syncRaidRow(row,r){
  if(!row)return;
  row.className='srow'+raidClass(r);
  const nm=row.querySelector('.srow-name'); if(nm)nm.textContent=r.name||'?';
  const mt=row.querySelector('.srow-meta'); if(mt)mt.textContent=raidLevel(r);
  const vl=row.querySelector('.srow-val'); if(vl)vl.textContent=raidStateText(r);
  const fl=row.querySelector('.gauge-fill'); if(fl)fl.style.width=pctOf(raidPct(r))+'%';
}
/* Тома, перечисленные в CONFIG.monitor.exclude, в Storage не показываем.
   '/boot' совпадает и с '/boot', и с '/boot/efi'; корень скрыть нельзя. */
function excludedMounts(){
  const list=(typeof CONFIG!=='undefined'&&CONFIG.monitor&&CONFIG.monitor.exclude)||[];
  return Array.isArray(list)?list.filter(p=>typeof p==='string'&&p):[];
}
function isExcludedMount(mount,excl){
  if(mount==='/')return false;
  return excl.some(p=>{
    const base=p.length>1&&p.endsWith('/')?p.slice(0,-1):p;
    return mount===base||mount.startsWith(base+'/');
  });
}
/* Данные структурные (список томов и массивов) — перерисовываем разметку
   только когда состав изменился, значения (проценты) обновляем на месте,
   чтобы полоски не дёргались и DOM не пересобирался каждые 2 секунды. */
function fillList(box,items,htmlFn,syncFn,sigFn){
  if(!box)return false;
  const sig=items.map(sigFn).join('|');
  let changed=false;
  if(box.dataset.sig!==sig){
    box.innerHTML=items.map(htmlFn).join('');
    box.dataset.sig=sig;
    changed=true;
  }
  items.forEach((it,i)=>syncFn(box.children[i],it));
  return changed;
}
function renderStorage(d){
  const headD=document.querySelector('[data-storage-head]');
  const headR=document.querySelector('[data-raid-head]');
  const boxD=document.querySelector('[data-disk-list]');
  const boxR=document.querySelector('[data-raid-list]');
  if(!boxD)return false;

  let disks=Array.isArray(d.disks)?d.disks.slice():[];
  // «попутные» разделы (/boot, /boot/efi, /recovery …) в панели не нужны
  const excl=excludedMounts();
  if(excl.length)disks=disks.filter(dr=>!isExcludedMount(dr.mount,excl));
  // запасной вариант — старый сервер отдаёт только сводный процент по /
  if(!disks.length&&d.disk_used!=null){
    disks=[{mount:'/',device:'',fstype:'',used:d.disk_used,
            total_gb:d.disk_total_gb,free_gb:null}];
  }
  const raid=Array.isArray(d.raid)?d.raid.slice():[];

  if(headD)headD.hidden=!disks.length;
  if(headR)headR.hidden=!raid.length;
  const cD=document.querySelector('[data-storage-count]');
  if(cD)cD.textContent=disks.length?(disks.length+(disks.length===1?' disk':' disks')):'';
  const cR=document.querySelector('[data-raid-count]');
  if(cR)cR.textContent=raid.length?(raid.length+(raid.length===1?' array':' arrays')):'';

  const a=fillList(boxD,disks,diskRowHtml,syncDiskRow,
                   dr=>dr.mount+'|'+dr.device+'|'+dr.fstype);
  const b=fillList(boxR,raid,raidRowHtml,syncRaidRow,
                   r=>r.name+'|'+r.level+'|'+(r.components||[]).map(c=>c.device).join(','));
  return a||b;   // true — состав изменился, окно нужно переставить
}
function setMonitorState(down){
  const win=document.getElementById('winMonitor');
  if(!win)return;
  win.classList.toggle('monitor-offline',!!down);
  const st=document.querySelector('[data-monitor-status]');
  if(st)st.textContent=down?'N/A — host unreachable':'Online';
  if(down){
    ['cpu','ram','load'].forEach(n=>setMetric(n,0,'—'));
    document.querySelectorAll('.srow-val').forEach(el=>{el.textContent='—'});
    const up=document.querySelector('[data-monitor-uptime]');
    if(up)up.textContent='';
  }
}
function renderMonitor(d){
  d=d||{};
  const cores=Number(d.cores)||1;
  const load=Number(d.load1);
  setMetric('cpu',d.cpu,fmtPct(d.cpu));
  setMetric('ram',d.mem_used,fmtPct(d.mem_used));
  setMetric('load',isFinite(load)?(load/cores)*100:0,isFinite(load)?load.toFixed(2):'—');
  const storageChanged=renderStorage(d);
  const up=document.querySelector('[data-monitor-uptime]');
  if(up)up.textContent=d.uptime?('up '+d.uptime):'';
  // состав дисков изменился — окно под новый размер контента
  if(storageChanged)placeMonitor();
}
async function pollMonitor(){
  const cfg=monitorConfig();
  if(cfg.enabled===false||monitorHidden()||monitorBusy)return;
  monitorBusy=true;
  const ctl=('AbortController'in window)?new AbortController():null;
  const to=setTimeout(()=>{try{ctl&&ctl.abort()}catch(e){}},Math.max(500,Number(cfg.timeout)||2500));
  try{
    const res=await fetch(cfg.endpoint||'/api/stats',{cache:'no-store',signal:ctl?ctl.signal:undefined});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    renderMonitor(data);
    setMonitorState(false);
  }catch(err){
    setMonitorState(true);
  }finally{
    clearTimeout(to);
    monitorBusy=false;
  }
}
function startMonitor(){
  const cfg=monitorConfig();
  if(cfg.enabled===false)return;
  if(monitorTimer)clearInterval(monitorTimer);
  monitorTimer=setInterval(pollMonitor,Math.max(600,Number(cfg.interval)||2000));
  pollMonitor();
}
/* Узкое окно — плотная раскладка строк метрик. */
(function monitorDensity(){
  const mon=document.getElementById('winMonitor');
  if(!mon)return;
  const body=mon.querySelector('.monitor-body');
  if(!body)return;
  const apply=()=>body.classList.toggle('compact',mon.offsetWidth<300);
  if('ResizeObserver'in window)new ResizeObserver(apply).observe(mon);
  window.addEventListener('resize',apply);
  apply();
})();

/* === Терминал (CONFIG.term) ==============================================
   Окно-пародия на консоль: чёрный экран, приглашение «user@server:~$»,
   история команд (стрелки) и дописка по Tab. fetch берёт данные оттуда же,
   откуда их берёт System Monitor, — GET /api/stats (host, os, kernel,
   machine и sysname туда добавляет server.py), плюс то, что знает сам
   браузер: тема, шрифт, размер экрана, число окон и сервисов. Если сервер
   недоступен — консоль честно пишет «host unreachable».
   Что печатать при запуске — CONFIG.term.startup (подробности в шапке
   config.js): строка печатается как есть, строка от '$ ' выполняется
   как команда, поэтому ['…текст…', '$ fetch'] — текст и сразу сводка. === */
const termCfg=()=>CONFIG.term||{};
/* Два терминала работают параллельно: у каждого свой вывод, своя история
   ввода, своя партия в блэкджеке и свои слоты. Сам код (termPrint,
   TERM_CMDS, blackjack, slots…) об экземплярах не знает — он видит
   «текущий контекст»:
   termCtx(t) подставляет в ссылки ниже нужное окно, а termQueue не даёт
   двум вводам переплестись: строка из одного терминала не может уехать
   в чужой вывод, пока предыдущая ещё ждёт сеть (fetch, банк блэкджека). */
let termWin=null,termOut=null,termIn=null,termPromptEl=null;
let termStarted=false;                 // поле текущего контекста (см. termCtx)
let termQueue=Promise.resolve();

/* Состояние игр в консоли (модули — ниже, в конце раздела терминала).
   BJ0 и SL0 — эталоны: у каждого терминала свои экземпляры, своя партия
   в блэкджеке и свои слоты; termRun смотрит на BJ/SL при каждой строке
   ввода — это всегда текущий контекст. */
const BJ0={active:false,state:null,balance:0,deck:[],dealer:[],hands:[],hand:0,
           bet:0,ins:0,hideHole:true,splitUsed:false,quit:false,roundStart:0};
/* Слоты: банк общий с блэкджеком (один /api/balance), партия — своя. */
const SL0={active:false,state:null,balance:0,roundStart:0,spinning:false,grid:null};
/* Экземпляры строятся из DOM: окно, его узлы и своё состояние.
   История (history/histPos) живёт только здесь — её трогают обработчики
   ввода своего окна, поэтому глобальной она не нужна. */
const TERMS=termWindows().map(win=>{
 const id=win.id;
 return {id,win,
  out:win.querySelector('[data-term-out]'),
  in:win.querySelector('[data-term-in]'),
  prompt:win.querySelector('[data-term-prompt]'),
  history:[],histPos:-1,started:false,
  bj:Object.assign({},BJ0),sl:Object.assign({},SL0)};
});
let BJ=BJ0,SL=SL0;                    // партии текущего контекста

/* имена для команды open: обычные окна + свои ключи каждого терминала */
function openWinKeys(){
 const keys=['server','viewer','monitor','music','help','network','downloads','telegram'];
 TERMS.forEach((t,i)=>keys.push(i?'term'+(i+1):'term'));
 return keys;
}

function termByWin(win){return TERMS.find(t=>t.win===win)}
function termCtx(t){                  // переключить общий код на экземпляр
 termWin=t.win;termOut=t.out;termIn=t.in;termPromptEl=t.prompt;
 termStarted=t.started;BJ=t.bj;SL=t.sl;
}
function termJob(t,fn){               // выполнить в очереди этого терминала
 const run=()=>{termCtx(t);
  return Promise.resolve().then(fn).then(
   ()=>{t.started=termStarted},       // вернуть состояние в экземпляр
   e=>{t.started=termStarted;throw e})};
 const p=termQueue.then(run,run);
 termQueue=p.catch(()=>{});           // упавшая команда не роняет очередь
 return p;
}

/* Логотип для fetch: колонка считается по самой длинной строке, поэтому
   свой логотип (CONFIG.term.logo) может быть любой ширины. */
const TERM_LOGO=[
 '    .----------------------.',
 '    |  .----------------.  |',
 "    |  |  NEREVAR HUB   |  |",
 "    |  '----------------'  |",
 '    |     ____________     |',
 "    '----------------------'",
 '           |________|'
];

function termPromptText(){
 const cfg=termCfg();
 return (cfg.user||'nerevar')+'@'+(CONFIG.serverName||'server')+':~$';
}
/* Фокус — только через экземпляр: вне очереди глобальный termIn может
   указывать на чужое окно. */
function termFocus(t){if(t&&t.in)t.in.focus({preventScroll:true})}
function termEsc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
/* out — необязательный аргумент: внутри очереди (termJob) печатаем в
   текущий контекст, из синхронных обработчиков — прямо в своё окно. */
function termScroll(out){
 out=out||termOut;
 if(!out)return;
 while(out.childElementCount>800)out.removeChild(out.firstChild); // вывод не растёт бесконечно
 out.scrollTop=out.scrollHeight;
}
function termPrint(text,cls,out){
 out=out||termOut;
 if(!out)return;
 String(text==null?'':text).split('\n').forEach(line=>{
  const div=document.createElement('div');
  div.className='term-line'+(cls?' '+cls:'');
  /* Пустая строка обязана занимать строку высоты: div без содержимого
     схлопнулся бы в ноль и разделители разделов (man, fetch) пропали. */
  div.textContent=line===''?'\u00A0':line;
  out.appendChild(div);
 });
 termScroll(out);
}
/* Готовый HTML — так выводится fetch (подписи полей цветом, как в fastfetch).
   Значения перед этим проходят termEsc: HTML собирает только сама панель. */
function termPrintHtml(html,cls,style,out){
 out=out||termOut;
 if(!out)return;
 const div=document.createElement('div');
 div.className='term-line'+(cls?' '+cls:'');
 if(style)div.style.cssText=style;
 div.innerHTML=html===''?'\u00A0':html;
 out.appendChild(div);
 termScroll(out);
 return div;
}
function termClear(out){out=out||termOut;if(out)out.innerHTML=''}
function termEcho(line,out){ // строка «приглашение + команда», как в настоящей консоли
 termPrintHtml('<span class="term-ok">'+termEsc(termPromptText())+'</span> '+termEsc(line),
               undefined,undefined,out);
}
async function termStats(){
 const url=(CONFIG.monitor||{}).endpoint||'/api/stats';
 try{
  const ctl=('AbortController'in window)?new AbortController():null;
  const to=setTimeout(()=>{try{ctl&&ctl.abort()}catch(e){}},2500);
  try{
   const res=await fetch(url,{cache:'no-store',signal:ctl?ctl.signal:undefined});
   if(!res.ok)throw new Error('HTTP '+res.status);
   return await res.json();
  }finally{clearTimeout(to)}
 }catch(e){return null}
}
function termDateStr(){
 const d=new Date();
 const p=n=>String(n).padStart(2,'0');
 return CAL_WD_SHORT[d.getDay()]+' '+CAL_MO_SHORT[d.getMonth()]+' '+d.getDate()+
        ' '+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
/* --- fetch: сводка о системе в две колонки (лого слева, поля справа) ---- */
function termFetchRows(stats){
 const rows=[];
 const add=(k,v)=>{if(v!==''&&v!=null&&v!==undefined)rows.push([k,String(v)])};
 add('OS',stats&&stats.os);
 add('Host',stats&&stats.host);
 add('Kernel',stats&&stats.kernel);
 add('Uptime',stats&&stats.uptime);
 add('Shell','nerevar-hub console');
 add('Terminal','nerevar-hub');
 add('DE','Win9x panel');
 add('Theme',currentTheme);
 add('Font',fontCurrentName());
 add('Resolution',screen.width+'x'+screen.height);
 const openWins=appWindows.filter(w=>!w.hidden).length;
 add('Panel',scene.clientWidth+'x'+scene.clientHeight+', '+openWins+' window'+(openWins===1?'':'s'));
 if(stats){
  const cores=Number(stats.cores)||1;
  add('CPU',cores+' core'+(cores===1?'':'s')+(stats.cpu!=null?', '+stats.cpu+'% used':''));
  const tot=Number(stats.mem_total_gb),pct=Number(stats.mem_used);
  if(tot&&isFinite(pct))
   add('Memory',(tot*pct/100).toFixed(1)+' / '+tot.toFixed(1)+' GiB ('+Math.round(pct)+'%)');
  if(Array.isArray(stats.disks))stats.disks.slice(0,4).forEach(d=>{
   const total=Number(d.total_gb),free=Number(d.free_gb);
   if(!total)return;
   add('Disk ('+d.mount+')',(total-free).toFixed(1)+' / '+total.toFixed(1)+' GiB ('+d.used+'%)');
  });
  if(Array.isArray(stats.raid)&&stats.raid.length)
   add('RAID',stats.raid.length+' array'+(stats.raid.length===1?'':'s'));
 }
 const vis=CONFIG.services.filter((s,i)=>!hiddenSvc.has(i)&&!svcOff(s)).length;
 add('Services',vis+' card'+(vis===1?'':'s'));
 const vs=viewers.filter(v=>!v.win.hidden).length;
 add('Viewers',vs+' window'+(vs===1?'':'s'));
 add('LAN',CONFIG.lanHost);
 add('Tailscale',CONFIG.tailscaleHost);
 return rows;
}
function termRenderFetch(logo,head,rows){
 const lw=logo.reduce((n,l)=>Math.max(n,String(l).length),0);
 const total=Math.max(logo.length,head.length+rows.length);
 for(let i=0;i<total;i++){
  let right='';
  if(i<head.length)right=head[i];
  else if(rows[i-head.length]){
   const kv=rows[i-head.length];
   right='<span class="term-key">'+termEsc(kv[0])+'</span>: '+termEsc(kv[1]);
  }
  /* Строка, где есть и логотип, и поля, при узком окно переносится — и
     без отступа продолжение уезжало бы к нулевому столбцу, под логотип.
     Отступ колонки полей + отрицательный отступ первой строки: первая
     строка (сам логотип) остаётся слева, а все переносы начинаются с
     того же столбца, где стоят поля, — как в fastfetch. */
  const hanging=!!right;
  const off=hanging?'padding-left:'+(lw+2)+'ch;text-indent:-'+(lw+2)+'ch':'';
  const left=String(logo[i]==null?'':logo[i]).padEnd(lw);
  termPrintHtml(termEsc(left)+(right?'  '+right:''),
                hanging?'term-frow':'',off);
 }
}
async function termDoFetch(){
 const cfg=termCfg();
 const stats=await termStats();
 if(!stats)termPrint('fetch: N/A — host unreachable','term-err');
 const logo=(Array.isArray(cfg.logo)&&cfg.logo.length)?cfg.logo:TERM_LOGO;
 const who=(cfg.user||'nerevar')+'@'+((stats&&stats.host)||CONFIG.serverName||'server');
 const head=[termEsc(who),termEsc('-'.repeat(Math.max(3,who.length)))];
 termPrint('');
 termRenderFetch(logo,head,termFetchRows(stats));
}

/* --- данные для новых команд -------------------------------------------- */
/* Корова классического cowsay: рисуется как есть, termPrint ставит текст
   через textContent — обратные слэши трогать не надо. */
const TERM_COW=[
 "        \\   ^__^",
 '         \\  (oo)\\_______',
 '            (\\__)\\       )\\/\\',
 '                ||----w |',
 '                ||     ||'
];
/* Поговорки для fortune живут в config.js: CONFIG.term.fortunes —
   массив строк, по одной шутке на строку (правится там, index.html
   не трогаем). Здесь только чтение: пустой или отсутствующий список
   не роняет команду — она печатает подсказку, куда добавить шутки. */
function termFortunes(){
 const list=termCfg().fortunes;
 return Array.isArray(list)
  ? list.map(x=>String(x==null?'':x).trim()).filter(Boolean)
  : [];
}
/* Страницы справки для man: n — одна строка NAME, s — SYNOPSIS,
   d — строки DESCRIPTION. Чего нет в словаре, о том классически
   отвечает «No manual entry for …» (про theme, open, exit, sudo…). */
/* --- viz: живые столбцы спектра трека прямо в выводе консоли -------------
   Команда viz рисует в своём окне столбцы (# — уровень, - — недавний пик)
   от трека, который играет в Audio Player. Первый запуск соединяет
   элемент <audio> с Web Audio (AnalyserNode) — до этого плеер играет
   как обычно, мимо анализатора; после аудио идёт через граф, поэтому
   контекст будим на каждом play, чтобы он не «уснул» и звук не пропал.
   Граф один на элемент — viz в разных окнах читают его одновременно.
   Окно закрыли или очистили — таймер останавливается сам (последний
   кадр остаётся в истории). Размеры и частота — CONFIG.term.viz. */
function vizCfg(){return termCfg().viz||{}}
function vizNum(v,min,max,dflt){v=Number(v);return isFinite(v)?Math.max(min,Math.min(max,v)):dflt}
function vizFft(v){                          // fftSize обязан быть степенью двойки
 const p=Math.pow(2,Math.round(Math.log2(vizNum(v,32,2048,256))));
 return vizNum(p,32,2048,256);
}
let vizAC=null,vizAn=null,vizFreq=null;
function vizResume(){                        // контекст мог «уснуть» — будим
 if(vizAC&&vizAC.state==='suspended'&&vizAC.resume)vizAC.resume().catch(()=>{});
}
function vizGraph(){                         // анализатор для <audio>: один раз
 if(vizAn)return vizAn;
 const AC=window.AudioContext||window.webkitAudioContext;
 if(!AC||!audioEl)return null;
 try{
  const c=vizCfg();
  const ac=new AC();
  const an=ac.createAnalyser();
  an.fftSize=vizFft(c.fftSize);
  an.smoothingTimeConstant=0.8;              // столбцы не дрожат
  ac.createMediaElementSource(audioEl).connect(an);
  an.connect(ac.destination);                // без этого звук пропал бы
  vizAC=ac;vizAn=an;vizFreq=new Uint8Array(an.frequencyBinCount);
  vizResume();
 }catch(e){return null}
 return vizAn;
}
function vizStop(out,quiet){
 const job=out&&out._vizJob;
 if(!job)return false;
 clearInterval(job.timer);
 out._vizJob=null;
 if(!quiet)termPrint('Visualizer stopped.','term-hint',out);
 return true;
}
function vizTick(job){
 /* окно закрыли или очистили — выходим молча, кадр уже в истории */
 if(!job.out.isConnected||job.win.hidden){vizStop(job.out,true);return}
 job.an.getByteFrequencyData(job.freq);
 const n=job.freq.length,usable=Math.max(4,Math.floor(n*0.6));
 for(let c=0;c<job.w;c++){
  /* низ спектра шире — колонки идут по мягкой кривой, а не равномерно;
     между бинами линейная интерполяция — столбцы складываются в волну */
  const pos=Math.pow(c/job.w,1.25)*(usable-2);
  const i=1+Math.floor(pos),f=pos-Math.floor(pos);
  const a=job.freq[Math.min(n-1,i)],b=job.freq[Math.min(n-1,i+1)];
  const lvl=Math.pow((a+(b-a)*f)/255,0.75)*job.h;
  const cells=Math.max(0,Math.min(job.h,Math.round(lvl)));
  job.sm[c]=job.sm[c]+(cells-job.sm[c])*0.4;   // скольжение: едут плавно
  job.lv[c]=Math.round(job.sm[c]);
  /* пик помечает НАСТОЯЩИЙ уровень (быстрый), а не сглаженный — поэтому
     шапка ▀ видна, когда столбец опускается, и медленно сползает вниз */
  job.pk[c]=Math.max(cells,job.pk[c]-0.35);
 }
 /* рамка-виджет и цветные полосы: цвет даёт высота строки (зелёный низ,
    жёлтый середина, красный верх), а пик — отдельная шапка ▀ сверху */
 const frame=s=>'<span class="viz-frame">'+s+'</span>';
 const rows=[frame('┌'+'─'.repeat(job.w)+'┐')];
 for(let r=0;r<job.h;r++){
  const d=job.h-1-r;                         // высота строки над дном
  const cls=d<job.h*0.5?'viz-lo':(d<job.h*0.75?'viz-mid':'viz-hi');
  let line=frame('│');
  for(let c=0;c<job.w;c++){
   const cap=Math.round(job.pk[c]),fill=job.h-job.lv[c];
   if(cap>job.lv[c]&&cap>0&&r===job.h-cap)line+='<span class="viz-peak">▀</span>';
   else if(r>=fill)line+='<span class="'+cls+'">█</span>';
   else line+=' ';
  }
  rows.push(line+frame('│'));
 }
 rows.push(frame('└'+'─'.repeat(job.w)+'┘'));
 /* следим за выводом, как за живым логом: если смотрели вниз (дистанция
    до низа меньше 40px ДО роста кадра) — подкручиваем после обновления;
    смотрели вверх — не дёргаем прокрутку, юзер листает историю сам */
 const o=job.out;
 const near=o.scrollHeight-o.scrollTop-o.clientHeight<40;
 job.box.innerHTML=rows.join('\n');
 if(near)o.scrollTop=o.scrollHeight;
}
const TERM_MAN={
 help:{n:'list the available commands',s:'help',
  d:['Prints every command this console understands.']},
 fetch:{n:'system summary in the style of fastfetch',s:'fetch | neofetch',
  d:['Two columns: an ASCII logo and key/value fields',
     'about the machine and this browser. Numbers come',
     'from /api/stats on the server.']},
 cowsay:{n:'let a cow say your line',s:'cowsay <text>',
  d:['The cow repeats your line in a speech balloon.',
     'With no text she says a default greeting.',
     'She has seen things. She does not judge.']},
 fortune:{n:'print a random quip',s:'fortune',
  d:['One of the fortunes from CONFIG.term.fortunes,',
     'picked at random. Mostly true. Occasionally a threat.']},
 cal:{n:'display a calendar',s:'cal [month] [year]',
  d:['A month grid, Sunday first; today is green.',
     'Month is a number (1-12) or a name (nov, dec).',
     'With no arguments — the current month.']},
 df:{n:'report file system disk space usage',s:'df',
  d:['Size, used, available and use percentage for',
     'every disk the server reports, mounted paths',
     'last — just like the real thing.']},
 free:{n:'report free and used memory',s:'free',
  d:['Total, used and free memory of the server,',
     'rounded the way the kernel rounds it.']},
 ps:{n:'list the windows running right now',s:'ps',
  d:['The server, the panel and every open window',
     'with a fake PID and a real state: the active',
     'window is marked R+, the resting ones are S.']},
 date:{n:'print the current date and time',s:'date',
  d:['Weekday, month, day, year and time, e.g.',
     'Fri Nov 6 2026 21:03:14.']},
 echo:{n:'display a line of text',s:'echo <text>',
  d:['Prints its arguments exactly as typed.']},
 uname:{n:'print system information',s:'uname [-a|-r|-s|-m]',
  d:['-s kernel name, -r kernel release, -m machine,',
     '-a everything at once. Values come from the',
     'server, so they describe the host, not this PC.']},
 uptime:{n:'report how long the server has been up',s:'uptime',
  d:['Uptime, load average and the number of cores.']},
 whoami:{n:'print the effective user name',s:'whoami',
  d:['The name from CONFIG.term.user in config.js.']},
 ls:{n:'list the panel folders',s:'ls',
  d:['Counts files in pics/, music/ and skins/.']},
 clear:{n:'clear the screen',s:'clear | cls',
  d:['Empties the scrollback. The history of',
     'commands survives: arrow up brings it back.']},
 man:{n:'format and display the manual pages',s:'man <command>',
  d:['This page, in the classic layout. Commands',
     'without a page answer: No manual entry for <command>.']},
 blackjack:{n:'play blackjack against the dealer',s:'blackjack [balance]',
  d:['Hit, stand, double, split, insurance and surrender,',
     'by the casino rules: blackjack pays 3:2, the dealer',
     'stands on soft 17, up to four hands. The bank lives in',
     '/api/balance on the server; the start sum and the',
     'minimum bet are CONFIG.term.blackjack. While a round',
     'is on, the console takes moves: h, s, d, p, u, a number',
     'to bet, q to leave, clear, help, reset.']},
 slots:{n:'spin the slot machine',s:'slots [balance]',
  d:['Three reels, one payline — the middle row.',
     'Three of a kind pays: 7 x300, S x75, B x30, L and',
     'O x15, C x10; a pair returns half the bet. The',
     'table scales with CONFIG.term.slots.rtp (0.9433 —',
     'base, 1.0 — no edge, 1.05 — generous). The bank is',
     'the same as in blackjack (/api/balance); the start',
     'sum and the min bet are CONFIG.term.blackjack.',
     'While the reels spin the console takes: a number',
     'to spin, q to leave, clear, help, reset.']},
 viz:{n:'draw the spectrum of the playing track',s:'viz',
  d:['Live spectrum bars of the track currently playing in the',
     'Audio Player, drawn right here as a framed analyzer:',
     'columns are green low, yellow in the middle and red on',
     'top, with a floating cap on the recent peak of every',
     'column. Run viz again to stop; closing or clearing the',
     'window stops it by itself. Size and refresh — CONFIG.term.viz.']},
 ss:{n:'show the listening sockets of the server',s:'ss',
  d:['Lists every TCP socket in state LISTEN: protocol,',
     'local address and port — the same data as the',
     'Network window, straight from /proc/net/tcp{,6}.']},
 wget:{n:'download a file from the network',s:'wget <url>',
  d:['Fetches an http:// or https:// URL and saves it into',
     'the downloads/ folder on the server, printing the file',
     'name and the final size or error. Live progress and',
     'cancel live in the Download Manager window; finished',
     'files come back at /downloads/<name> as attachments.',
     'Only http and https; the size limit is',
     'CONFIG.downloads.maxMB.']}
};
/* --- команды ------------------------------------------------------------ */
const TERM_CMDS={
 help(){
  termPrint('Commands:','term-hint');
  ['help                     — this list',
   'fetch, neofetch          — system summary (fastfetch style)',
   'clear, cls               — clear the screen',
   'date                     — current date and time',
   'echo <text>              — print text',
   'whoami                   — your user name',
   'uname [-a|-r|-s|-m]      — OS, kernel, machine (from the server)',
   'uptime                   — how long the server has been up',
   'ls                       — pics/ music/ skins/ folders',
   'cowsay <text>            — a cow says your line',
   'fortune                  — a random quip',
   'cal [month] [year]       — calendar of that month',
   'df                       — disk usage table',
   'free                     — memory usage',
   'ps                       — open windows as processes',
   'man <command>            — manual page for a command',
   'blackjack                — play blackjack against the dealer',
   'slots                    — spin the slot machine (the same bank)',
   'viz                      — spectrum bars of the playing track',
   'ss                       — listening ports of the server',
   'wget <url>               — download a file to downloads/',
   'theme dark|light         — switch the panel theme',
   'open <window>            — open a window: server, viewer, monitor,',
   '                          music, '+openWinKeys().slice(4).join(', ')+' (each its own console)',
   'about                    — what this panel is',
   'exit                     — close this window',
   'sudo <command>           — nice try'].forEach(l=>termPrint('  '+l));
 },
 async fetch(){await termDoFetch()},
 async neofetch(){await termDoFetch()},
 clear(){termClear()},
 cls(){termClear()},
 date(){termPrint(termDateStr())},
 echo(args){termPrint(args.join(' '))},
 whoami(){termPrint(termCfg().user||'nerevar')},
 async uname(args){
  const s=await termStats();
  if(!s){termPrint('uname: N/A — host unreachable','term-err');return}
  const flag=String(args[0]||'');
  if(flag==='-r')termPrint(s.kernel||'?');
  else if(flag==='-m')termPrint(s.machine||'?');
  else if(flag==='-s')termPrint(s.sysname||'Linux');
  else if(flag==='-a')
   termPrint([s.sysname,s.host,s.kernel,s.machine,s.os].filter(Boolean).join(' '));
  else termPrint(s.sysname||'Linux');
 },
 async uptime(){
  const s=await termStats();
  if(!s){termPrint('uptime: N/A — host unreachable','term-err');return}
  const load=(s.load1==null?'—':s.load1);
  termPrint('up '+(s.uptime||'?')+',  load '+load+',  '+(Number(s.cores)||1)+' cores');
 },
 async ls(){
  const get=async url=>{
   try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw 0;return await r.json()}
   catch(e){return null}
  };
  const [pics,music,skins]=await Promise.all([get('api/pics'),get('api/music'),get('api/skins')]);
  const row=(dir,n,unit)=>{
   const text=n==null?'—':n+' '+unit+(n===1?'':'s');
   termPrintHtml(termEsc(dir.padEnd(9))+termEsc(text));
  };
  row('pics/',pics?(pics.images||[]).length+(pics.art||[]).length:null,'file');
  row('music/',music&&Array.isArray(music.tracks)?music.tracks.length:null,'track');
  row('skins/',skins&&Array.isArray(skins.skins)?skins.skins.length:null,'skin');
 },
 /* календарь как в cal: сетка месяца, воскресенье первым, сегодня зелёным */
 cal(args){
  const now=new Date();
  let m=now.getMonth(),y=now.getFullYear();
  const usage='usage: cal [month] [year]';
  const a=String(args[0]||'').toLowerCase();
  if(a){
   let idx=-1;
   if(/^\d{1,2}$/.test(a)){const n=Number(a);if(n>=1&&n<=12)idx=n-1}
   else idx=CAL_MONTHS.findIndex(name=>name.toLowerCase().startsWith(a));
   if(idx<0){termPrint(usage,'term-err');return}
   m=idx;
   if(args[1]!=null){
    const yy=Number(args[1]);
    if(!/^\d{4}$/.test(String(args[1]))||yy<1970||yy>2100){termPrint(usage,'term-err');return}
    y=yy;
   }
  }
  const days=new Date(y,m+1,0).getDate();
  const start=new Date(y,m,1).getDay();
  const head=CAL_WD_SHORT.map(d=>d.slice(0,2)).join(' ');   // Su Mo Tu … Sa
  const title=CAL_MONTHS[m]+' '+y;
  termPrint(' '.repeat(Math.max(0,Math.floor((head.length-title.length)/2)))+title);
  termPrint(head,'term-hint');
  let line='';
  const flush=()=>{if(line){termPrintHtml(line.replace(/\s+$/,''));line=''}};
  for(let i=0;i<start;i++)line+='  ';
  for(let d=1;d<=days;d++){
   const cell=String(d).padStart(2);
   const today=(d===now.getDate()&&m===now.getMonth()&&y===now.getFullYear());
   line+=today?'<span class="term-ok">'+cell+'</span>':cell;
   if((start+d)%7===0)flush();else line+=' ';
  }
  flush();
 },
 /* df — таблица места на дисках, как у настоящей утилиты */
 async df(){
  const s=await termStats();
  if(!s){termPrint('df: N/A — host unreachable','term-err');return}
  const disks=Array.isArray(s.disks)?s.disks:[];
  if(!disks.length){termPrint('df: the server reported no disks','term-hint');return}
  const size=v=>v<=0?'0':v<1?Math.max(1,Math.round(v*1024))+'M':Math.round(v)+'G';
  const rows=disks.map(d=>{
   const tot=Number(d.total_gb)||0,free=Math.max(0,Number(d.free_gb)||0);
   return [d.device_full||d.device||'?',size(tot),size(tot-free),size(free),
           Math.round(Number(d.used)||0)+'%',d.mount||'?'];
  });
  const head=['Filesystem','Size','Used','Avail','Use%','Mounted on'];
  const w=head.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]).length)));
  /* колонка Filesystem по левому краю, числа по правому, Mounted on —
     последняя, без паддинга: как у настоящей df */
  const line=arr=>arr.map((v,i)=>
    i===0?String(v).padEnd(w[i]):
    i===5?String(v):
    String(v).padStart(w[i])).join('  ');
  termPrintHtml(termEsc(line(head)),'term-hint');
  rows.forEach(r=>termPrintHtml(termEsc(line(r))));
 },
 /* free — память сервера одной строкой, как в линуксе */
 async free(){
  const s=await termStats();
  if(!s){termPrint('free: N/A — host unreachable','term-err');return}
  const tot=Number(s.mem_total_gb),pct=Number(s.mem_used);
  if(!tot||!isFinite(pct)){termPrint('free: memory info unavailable','term-hint');return}
  const used=tot*pct/100,rest=tot-used;
  const f=v=>(v>=10?Math.round(v)+'Gi':v.toFixed(1)+'Gi');
  termPrint(''.padEnd(15)+['total','used','free'].map(c=>c.padStart(12)).join(''),'term-hint');
  termPrint('Mem:'.padEnd(15)+[tot,used,rest].map(v=>f(v).padStart(12)).join(''));
 },
 /* ps — «процессы» панели: сервер, окна и карточки сервисов */
 ps(){
  const rows=[['1','?','Ss','python3 server.py'],
              ['100','pts/0','Sl','nerevar-hub panel']];
  let pid=110;
  const act=appWindows.find(w=>w.classList.contains('active'));
  appWindows.forEach(w=>{
   if(w.hidden)return;
   rows.push([String(pid++),'pts/0',w===act?'R+':'S','window: '+winTitle(w)]);
  });
  CONFIG.services.forEach((svc,i)=>{
   if(hiddenSvc.has(i)||svcOff(svc))return;
   rows.push([String(400+i),'?','S','service: '+(svc.name||('card '+(i+1)))]);
  });
  const head=['PID','TTY','STAT','CMD'];
  const w0=Math.max(3,...rows.map(r=>r[0].length));
  const line=arr=>arr[0].padStart(w0)+'  '+arr[1].padEnd(6)+'  '+
                  arr[2].padEnd(4)+'  '+arr.slice(3).join(' ');
  termPrintHtml(termEsc(line(head)),'term-hint');
  rows.forEach(r=>termPrintHtml(termEsc(line(r))));
 },
 /* cowsay — корова говорит вашу фразу */
 cowsay(args){
  const W=40;
  const text=(args.join(' ')||'Hello from the server!').trim();
  const words=[];
  text.split(/\s+/).forEach(w=>{
   while(w.length>W){words.push(w.slice(0,W));w=w.slice(W)}   // длинное — кусками
   words.push(w);
  });
  const lines=[];
  let cur='';
  words.forEach(w=>{
   if(!cur)cur=w;
   else if((cur+' '+w).length<=W)cur+=' '+w;
   else {lines.push(cur);cur=w}
  });
  if(cur)lines.push(cur);
  const width=Math.max(...lines.map(l=>l.length));
  termPrint(' '+'_'.repeat(width+2));
  lines.forEach(l=>termPrint('<'+l.padEnd(width)+'>'));
  termPrint(' '+'-'.repeat(width+2));
  TERM_COW.forEach(l=>termPrint(l));
 },
 /* fortune — случайная поговорка из CONFIG.term.fortunes (config.js) */
 fortune(){
  const list=termFortunes();
  if(!list.length){
   termPrint('fortune: no jokes — add them to CONFIG.term.fortunes in config.js','term-err');
   return;
  }
  termPrint(list[Math.floor(Math.random()*list.length)]);
 },
 /* man — страница справки в классическом виде */
 man(args){
  const key=String(args[0]||'').toLowerCase();
  if(!key){
   termPrint('What manual page do you want?','term-err');
   termPrint("For example, try 'man cowsay'.",'term-hint');
   return;
  }
  const page=TERM_MAN[key];
  if(!page){termPrint('No manual entry for '+key,'term-err');return}
  const tag=key.toUpperCase()+'(1)';
  termPrint(tag.padEnd(26)+'nerevar-hub manual'.padEnd(24)+tag,'term-hint');
  termPrint('');
  termPrint('NAME');
  termPrint('       '+key+' - '+page.n);
  if(page.s){termPrint('');termPrint('SYNOPSIS');termPrint('       '+page.s)}
  termPrint('');termPrint('DESCRIPTION');
  page.d.forEach(l=>termPrint('       '+l));
 },
 /* blackjack — игра против дилера (модуль в конце раздела терминала) */
 async blackjack(args){
  const sub=String(args[0]||'').toLowerCase();
  if(SL.active){termPrint('The slot machine is busy — leave it first (q)','term-err');return}
  if(BJ.active){
   if(sub==='balance'){termPrint('Balance: '+BJ.balance);return}
   bjRender();return;                      // стол ещё раз
  }
  if(sub==='balance'){await balLoad(BJ);termPrint('Balance: '+BJ.balance);return}
  if(sub&&sub!=='new'){termPrint('Usage: blackjack [balance]','term-hint');return}
  await balLoad(BJ);
  bjStart();
  bjRender();
 },
 /* slots — игровой автомат, банк общий с блэкджеком (модуль ниже) */
 async slots(args){
  const sub=String(args[0]||'').toLowerCase();
  if(BJ.active){termPrint('A blackjack hand is on — finish it first (q)','term-err');return}
  if(SL.active){
   if(sub==='balance'){termPrint('Balance: '+SL.balance);return}
   slRender();return;                      // автомат ещё раз
  }
  if(sub==='balance'){await balLoad(SL);termPrint('Balance: '+SL.balance);return}
  if(sub&&sub!=='new'){termPrint('Usage: slots [balance]','term-hint');return}
  await balLoad(SL);
  slStart();
  slRender();
 },
 viz(){
  const out=termOut;
  if(!out)return;
  if(out._vizJob){vizStop(out);return}      // повторная команда — стоп
  if(!audioEl||!audioEl.getAttribute('src')){
   termPrint('viz: no track — pick one in the Audio Player','term-err');
   return;
  }
  const an=vizGraph();
  if(!an){termPrint('viz: audio analysis is not available here','term-err');return}
  const c=vizCfg();
  const job={out,win:termWin,an,freq:vizFreq,
             w:vizNum(c.width,4,80,32),h:vizNum(c.height,3,24,9),
             lv:[],pk:[],sm:[],box:document.createElement('div'),timer:0};
  for(let i=0;i<job.w;i++){job.lv.push(0);job.pk.push(0);job.sm.push(0)}
  job.box.className='term-line term-viz';
  const title=(musicIndex>=0&&musicTracks[musicIndex])
              ?musicName(musicTracks[musicIndex]):'track';
  termPrint('Visualizer: '+title+' — type viz to stop','term-key',out);
  out.appendChild(job.box);
  termScroll(out);
  out._vizJob=job;
  vizTick(job);
  job.timer=setInterval(()=>vizTick(job),
                        Math.max(40,Math.round(1000/vizNum(c.fps,4,30,15))));
 },
 /* ss — слушающие порты сервера, как у настоящего ss: те же данные,
    что в окне Network (GET /api/network -> /proc/net/tcp{,6}) */
 async ss(){
  const s=await netFetch();
  if(!s){termPrint('ss: N/A — host unreachable','term-err');return}
  const rows=Array.isArray(s.ports)?s.ports:[];
  if(!rows.length){termPrint('No listening sockets','term-hint');return}
  termPrintHtml(termEsc('State  Proto  Local Address'),'term-hint');
  rows.forEach(p=>{
   termPrintHtml(termEsc('LISTEN  '+String(p.proto).padEnd(7)+p.addr+':'+p.port));
  });
  termPrint(rows.length+' socket'+(rows.length===1?'':'s'),'term-hint');
 },
 /* wget — качает URL в папку downloads/ на сервере; печатает как
    настоящий: имя файла, потом итог или ошибку (прогресс и отмена —
    в окне Download Manager) */
 async wget(args){
  const url=String(args[0]||'').trim();
  if(!/^https?:\/\//i.test(url)){
   termPrint('wget: missing URL or unsupported protocol — only http:// and https://','term-err');
   return;
  }
  const started=await dlStart(url);
  if(!started||started.err){termPrint('wget: '+((started&&started.err)||'no answer'),'term-err');return}
  termPrint("Saving to '"+(started.dir||'downloads')+"/"+started.name+"'",'term-hint');
  await new Promise(resolve=>{
   let tries=0;
   const poll=setInterval(async()=>{
    tries++;
    const list=await dlGet();
    const jobs=list&&Array.isArray(list.jobs)?list.jobs:null;
    const j=jobs?jobs.find(x=>x.id===started.id):null;
    if(!j||tries>=600){           // 600 × 500 мс = 5 минут на задачу
     clearInterval(poll);
     termPrint(j?'wget: giving up after 5 minutes'
                :'wget: the server lost the job (restarted?)','term-err');
     dlKnown=false;resolve();return;
    }
    dlEnforce(j);                 // лимит CONFIG.downloads.maxMB
    if(j.status==='done'){
     clearInterval(poll);
     termPrint((started.dir||'downloads')+'/'+j.name+' — '+fmtBytes(j.got)+' saved','term-ok');
     dlKnown=false;resolve();return;
    }
    if(j.status==='failed'){
     clearInterval(poll);
     termPrint('wget: '+j.error,'term-err');
     dlKnown=false;resolve();return;
    }
    if(j.status==='cancelled'){
     clearInterval(poll);
     termPrint('wget: cancelled','term-hint');
     dlKnown=false;resolve();return;
    }
   },500);
  });
 },
 theme(args){
  const want=String(args[0]||'').toLowerCase();
  if(want!=='dark'&&want!=='light'){termPrint('usage: theme dark|light','term-err');return}
  setTheme(want,true);
  scheduleLayoutSave();
  flashStatus('Theme: '+want);
  termPrint('Theme: '+want,'term-ok');
 },
 open(args){
  const key=String(args[0]||'').toLowerCase();
  if(key==='help'){runAction('help');termPrint('Opened: Help','term-ok');return}
  const map={server:'winServers',servers:'winServers',viewer:'winArt',viewers:'winArt',
             picture:'winArt',monitor:'winMonitor',music:'winMusic',audio:'winMusic',
             network:'winNetwork',net:'winNetwork',
             downloads:'winDownloads',download:'winDownloads',dl:'winDownloads',
             telegram:'winTelegram',tg:'winTelegram'};
  /* у каждого терминала свой ключ: term, term2, term3… (сколько их — count) */
  TERMS.forEach((t,i)=>{const n=i+1;map['term'+n]=t.id;map['terminal'+n]=t.id});
  if(TERMS.length){map.term=TERMS[0].id;map.terminal=TERMS[0].id}
  const id=map[key];
  if(!id){termPrint('usage: open <'+openWinKeys().join('|')+'>','term-err');return}
  const win=document.getElementById(id);
  const btn=taskFor(win);
  if(!win||(btn&&btn.hidden)){termPrint('That window is switched off in config.js','term-err');return}
  showWindow(win,true);
  termPrint('Opened: '+winTitle(win),'term-ok');
 },
 about(){
  termPrint(CONFIG.serverName+' — nerevar-hub, a Win9x-style panel for a home server');
  termPrint('Every setting lives in config.js; the layout lives on the server (server.py)','term-hint');
 },
 exit(){showWindow(termWin,false)},
 sudo(){termPrint('user is not in the sudoers file. This incident has been reported.','term-err')}
};

async function termRun(raw){
 const line=String(raw||'').trim();
 if(!line)return;
 /* пока идёт партия в блэкджек или крутятся слоты, ввод уходит в игру */
 if(BJ.active){await bjInput(line);return}
 if(SL.active){await slInput(line);return}
 const parts=line.split(/\s+/);
 const cmd=TERM_CMDS[parts[0].toLowerCase()];
 if(!cmd){termPrint('command not found: '+parts[0],'term-err');termPrint('Try "help".','term-hint');return}
 try{await cmd(parts.slice(1),line)}catch(e){termPrint(String(e&&e.message||e),'term-err')}
}
/* --- стартовый вывод: ровно то, что перечислено в CONFIG.term.startup --- */
async function termStart(){
 if(termStarted)return;
 termStarted=true;
 if(termPromptEl)termPromptEl.textContent=termPromptText();
 const cfg=termCfg();
 if(cfg.enabled===false)return;
 const lines=Array.isArray(cfg.startup)?cfg.startup:[];
 for(const entry of lines){
  const s=String(entry==null?'':entry);
  if(s.slice(0,2)==='$ '){
   const cmd=s.slice(2).trim();
   termEcho(cmd);
   if(cmd)await termRun(cmd);
  }else termPrint(s);
 }
}
/* Открыли окно терминала: фокус — сразу, стартовый вывод — в очереди
   экземпляра (печатает в свой экран, соседний не трогает). */
function termShow(t){
 termFocus(t);
 return termJob(t,()=>termStart());
}

/* --- ввод: Enter выполняет, ↑/↓ — история, Tab дописывает, Ctrl+L чистит -
   Обработчики вешаются на КАЖДЫЙ терминал и работают только с его
   экземпляром (t): синхронные реакции (значение ввода, фокус, чистка)
   очереди не ждут, а всё, что печатает или играет, идёт через termJob. */
(function initTerm(){
 TERMS.forEach(t=>{
  /* «+» в конце строки ввода: следующий терминал по кругу — если тот
     закрыт, он откроется; при count=1 кнопка не нужна */
  const jump=t.win.querySelector('[data-term-new]');
  if(jump){
   if(TERMS.length<2)jump.hidden=true;
   else jump.addEventListener('click',()=>{
    const next=TERMS[(TERMS.indexOf(t)+1)%TERMS.length];
    if(next)showWindow(next.win,true);
   });
  }
  t.in.addEventListener('keydown',event=>{
   if(event.key==='Enter'){
    event.preventDefault();
    const raw=t.in.value;
    t.in.value='';
    if(!raw.trim())return;
    /* История, эхо и сама команда — в очереди своего окна: пока
       предыдущая строка ждёт сеть, чужой ввод сюда попасть не может. */
    termJob(t,async()=>{
     t.histPos=-1;
     t.history.push(raw);
     if(t.history.length>200)t.history.shift();
     termEcho(raw.trim());
     await termRun(raw);
    });
    return;
   }
   if(event.key==='ArrowUp'||event.key==='ArrowDown'){
    event.preventDefault();
    if(!t.history.length)return;
    if(t.histPos<0)t.histPos=t.history.length;   // первый ↑ — последняя команда
    t.histPos+=(event.key==='ArrowUp'?-1:1);
    if(t.histPos<0)t.histPos=0;
    if(t.histPos>=t.history.length){t.histPos=-1;t.in.value=''}
    else t.in.value=t.history[t.histPos];
    const end=t.in.value.length;
    t.in.setSelectionRange(end,end);
    return;
   }
   if(event.key==='Tab'){
    event.preventDefault();
    if(t.bj.active||t.sl.active)return;                        // во время партии Tab молчит
    if(!t.in.value||/\s/.test(t.in.value))return;   // дописываем только первое слово
    const head=t.in.value.toLowerCase();
    const names=Object.keys(TERM_CMDS).filter(n=>n.indexOf(head)===0);
    if(names.length===1)t.in.value=names[0]+' ';
    /* подсказка — сразу и только в своё окно (t.out, минуя очередь) */
    else if(names.length>1){termEcho(t.in.value,t.out);termPrint(names.join('   '),'term-hint',t.out)}
    return;
   }
   if(event.key==='l'&&(event.ctrlKey||event.metaKey)){event.preventDefault();termClear(t.out)}
  });
  /* клик по выводу возвращает курсор во ввод (не мешая выделению текста) */
  t.out.addEventListener('click',()=>{
   const sel=window.getSelection?String(window.getSelection()):'';
   if(!sel)termFocus(t);
  });
 });
})();

/* === Blackjack: игра против дилера прямо в консоли ======================
   Команда blackjack (CONFIG.term.blackjack). Правила — как в казино:
   блэкджек 3:2, дилер добирает до 17 и стоит на мягком 17, сплит до
   четырёх рук (тузы — по одной карте, после сплита блэкджека не бывает),
   удвоение на первых двух картах, страховка на тузе (при вашем
   блэкджеке это «even money»), сдача возвращает половину ставки.
   Банк живёт на сервере: GET/POST /api/balance -> balance.json;
   стартовая сумма и минимум ставки — CONFIG.term.blackjack в config.js.
   Пока партия активна, ввод консоли уходит в игру (termRun -> bjInput):
   h/s/d/p/u — ходы, число — ставка, q — выход (недоигранная рука
   доигрывается), clear — очистить экран, help — ходы партии, reset —
   новый банк. Остальные команды оболочки (ls, date, theme…) работают
   как обычно. === */
const BJ_RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const BJ_SUITS=[{s:'♠'},{s:'♥',red:true},{s:'♦',red:true},{s:'♣'}];
const BJ_MOVE={h:'h',hit:'h',s:'s',stand:'s',d:'d',double:'d',
               p:'p',split:'p',u:'u',surrender:'u'};

function bjCfg(){
 const b=termCfg().blackjack||{};
 const num=(v,d)=>{const n=Math.floor(Number(v));return isFinite(n)&&n>=0?n:d};
 return {start:num(b.startBalance,1000),min:Math.max(1,num(b.minBet,10))};
}
/* общий банк (блэкджек и слоты): читается с сервера при старте партии,
   пишется после расчёта — один balance.json на обе игры */
async function balLoad(o){
 try{
  const r=await fetch('/api/balance',{cache:'no-store'});
  if(r.ok){
   const d=await r.json();
   const n=Math.floor(Number(d&&d.balance));
   if(isFinite(n)&&n>=0){o.balance=n;return}
  }
 }catch(e){}
 o.balance=bjCfg().start;    // сервер не ответил — стартовая сумма в памяти
}
function balSave(o){         // не ждём: игра не должна дёргаться на сети
 fetch('/api/balance',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({balance:o.balance})}).catch(()=>{});
}

/* --- колоды и очки ------------------------------------------------------ */
function bjTen(c){return c.r==='10'||c.r==='J'||c.r==='Q'||c.r==='K'}
function bjTotal(cards){
 let t=0,aces=0;
 cards.forEach(c=>{
  if(c.r==='A'){t+=11;aces++}
  else t+=bjTen(c)?10:Number(c.r);
 });
 while(t>21&&aces){t-=10;aces--}
 return {t,soft:aces>0&&t<=21};
}
function bjIsBJ(cards){return cards.length===2&&bjTotal(cards).t===21}
function bjPair(cards){return cards.length===2&&cards[0].r===cards[1].r}
function bjNewDeck(){
 const deck=[];
 BJ_RANKS.forEach(r=>BJ_SUITS.forEach(u=>deck.push({r,s:u.s,red:!!u.red})));
 for(let i=deck.length-1;i>0;i--){          // тасовка Фишера — Йетса
  const j=Math.floor(Math.random()*(i+1));
  const t=deck[i];deck[i]=deck[j];deck[j]=t;
 }
 return deck;
}
function bjDraw(){if(!BJ.deck.length)BJ.deck=bjNewDeck();return BJ.deck.shift()}

/* --- рисование стола ---------------------------------------------------- */
function bjFace(c){
 if(!c)return ' ? ';                        // закрытая карта дилера
 const rk=c.r.padStart(2);                  // '10' | ' A' | ' 9' — три знака
 return c.red?rk+'<span class="term-err">'+c.s+'</span>':rk+c.s;
}
function bjRows(cards){                     // три строки блоков карт рядом
 return [cards.map(()=> '┌───┐').join(' '),
         cards.map(c=>'│'+bjFace(c)+'│').join(' '),
         cards.map(c=>'└───┘').join(' ')];
}
function bjVal(cards){
 const v=bjTotal(cards);
 if(v.t>21)return String(v.t);
 return v.soft?'soft '+v.t:String(v.t);
}
function bjTable(){                         // «дилер + руки», без подсказки
 const out=[];
 const hole=i=>i===1&&BJ.hideHole;
 out.push('Dealer');
 bjRows(BJ.dealer.map((c,i)=>hole(i)?null:c)).forEach(r=>out.push(r));
 out.push('  ('+bjVal(BJ.dealer.filter((c,i)=>!hole(i)))+')');
 BJ.hands.forEach((h,i)=>{
  const active=BJ.state==='play'&&i===BJ.hand;
  out.push((active?'→ ':'')+(BJ.hands.length>1?'Hand '+(i+1):'You')+
           ' (bet '+h.bet+')');
  bjRows(h.cards).forEach(r=>out.push(r));
  const v=bjTotal(h.cards);
  let s='  ('+bjVal(h.cards)+')';
  if(v.t>21)s+=' BUST';
  else if(!h.split&&bjIsBJ(h.cards))s+=' BLACKJACK';
  if(h.surrender)s+=' SURRENDER';
  out.push(s);
 });
 return out;
}
function bjShow(){bjTable().forEach(r=>termPrintHtml(r))}
/* строки стола содержат HTML (красные масти ♥♦), поэтому печатаются
   построчно через termPrintHtml — по одному div на строку, как termPrint */
function bjMoves(){                         // подсказка — только своевременное
 const h=BJ.hands[BJ.hand];
 const m=['[h]it','[s]tand'];
 if(h&&h.cards.length===2){
  if(BJ.balance>=h.bet)m.push('[d]ouble');
  if(BJ.balance>=h.bet&&BJ.hands.length<4&&bjPair(h.cards))m.push('[p]lit');
  if(BJ.hands.length===1&&!BJ.splitUsed)m.push('[u]rsurrender');
 }
 return m.join(' ');
}
function bjRender(){
 if(!BJ.active)return;
 if(BJ.state==='bet'){
  const c=bjCfg();
  if(BJ.balance<c.min){
   termPrint('Balance: '+BJ.balance+' — the bank is empty.','term-err');
   termPrint('Type "reset" for a fresh '+c.start+'.','term-hint');
   return;
  }
  termPrint('Balance: '+BJ.balance);
  termPrint('Your bet ('+c.min+' … '+BJ.balance+') or q to leave:','term-hint');
  return;
 }
 const rows=['Balance: '+BJ.balance];     // банк виден всю партию, не только в расчёте
 bjTable().forEach(r=>rows.push(r));
 if(BJ.state==='ins')rows.push('','Insurance? [y/n] — half the bet, pays 2:1');
 if(BJ.state==='play')rows.push('','Move? '+bjMoves());
 rows.forEach(r=>termPrintHtml(r));
}
function bjStart(){
 const c=bjCfg();
 BJ.active=true;BJ.state='bet';BJ.quit=false;
 BJ.hands=[];BJ.dealer=[];BJ.hand=0;BJ.bet=0;BJ.ins=0;
 BJ.splitUsed=false;BJ.hideHole=true;
 termPrint('Blackjack — dealer stands on soft 17, blackjack pays 3:2','term-key');
 termPrint('Insurance on an ace pays 2:1, surrender returns half the bet.');
 termPrint('The bank is kept on the server (start '+c.start+', min bet '+c.min+').','term-hint');
}
function bjEnd(){
 BJ.active=false;BJ.state=null;BJ.quit=false;
 BJ.hands=[];BJ.dealer=[];
 termPrint('Left the table. Balance: '+BJ.balance,'term-hint');
}
function bjReset(){
 BJ.balance=bjCfg().start;
 balSave(BJ);
 termPrint('Fresh bankroll: '+BJ.balance,'term-ok');
 bjRender();
}
function bjHelp(){
 termPrint('Blackjack commands:','term-key');
 termPrint('  h — hit, s — stand, d — double, p — split, u — surrender');
 termPrint('  a number — bet, q — leave, clear — clear the screen,');
 termPrint('  reset — new bankroll, blackjack — show the table again');
 termPrint('Dealer stands on soft 17, blackjack pays 3:2, insurance 2:1.');
}

/* --- ввод партии: сюда уходит всё, что ввёл игрок ----------------------- */
async function bjInput(raw){
 const line=String(raw||'').trim();
 if(!line)return;
 const low=line.toLowerCase();
 const parts=line.split(/\s+/);
 const first=parts[0].toLowerCase();
 if(low==='clear'||low==='cls'){termClear();bjRender();return}
 if(first==='blackjack'){                 // blackjack reset|balance|повтор
  const sub=String(parts[1]||'').toLowerCase();
  if(sub==='reset'&&BJ.state==='bet'){bjReset();return}
  if(sub==='balance'){termPrint('Balance: '+BJ.balance);return}
  bjRender();return;
 }
 if(low==='q'||low==='quit'||low==='exit'){bjQuit();return}
 if(low==='help'||low==='?'||low==='moves'||low==='rules'){bjHelp();return}
 if(low==='reset'&&BJ.state==='bet'){bjReset();return}
 /* остальные команды оболочки работают как обычно */
 if(TERM_CMDS[first]){await TERM_CMDS[first](parts.slice(1),line);return}
 if(BJ.state==='bet'){bjBet(low);return}
 if(BJ.state==='ins'){
  if(low==='y'||low==='yes'||low==='i'||low==='insurance'){bjInsurance(true);return}
  if(low==='n'||low==='no'){bjInsurance(false);return}
  termPrint('Insurance? [y/n]','term-hint');return;
 }
 if(BJ.state==='play'){
  const k=BJ_MOVE[low];
  if(k){bjMove(k);return}
  termPrint('Move? '+bjMoves(),'term-hint');return;
 }
}
function bjQuit(){
 if(BJ.state==='bet'){bjEnd();return}
 BJ.quit=true;                             // руку доигрываем — и уходим
 if(BJ.state==='ins'){bjInsurance(false);return}
 if(BJ.state==='play'){
  termPrint('Leaving the table — your hands stand.','term-hint');
  BJ.hands.forEach(h=>{h.done=true});
  bjDealerTurn();
 }
}

/* --- ставка и раздача ---------------------------------------------------- */
function bjBet(low){
 const c=bjCfg();
 if(!/^\d+$/.test(low)){
  termPrint('Type a number from '+c.min+' to '+BJ.balance,'term-err');
  return;
 }
 const bet=Number(low);
 if(bet<c.min){termPrint('Minimum bet is '+c.min,'term-err');return}
 if(bet>BJ.balance){termPrint('Not enough: the bank is '+BJ.balance,'term-err');return}
 BJ.roundStart=BJ.balance;
 BJ.balance-=bet;
 BJ.bet=bet;
 bjDeal();
}
function bjDeal(){
 BJ.deck=bjNewDeck();
 BJ.hands=[{cards:[],bet:BJ.bet,done:false,split:false}];
 BJ.dealer=[];BJ.ins=0;BJ.hideHole=true;BJ.splitUsed=false;BJ.hand=0;
 for(let i=0;i<2;i++){                     // игрок, дилер, игрок, дилер
  BJ.hands[0].cards.push(bjDraw());
  BJ.dealer.push(bjDraw());
 }
 const up=BJ.dealer[0];
 if(up.r==='A'){BJ.state='ins';bjRender();return}   // страховка, потом пик
 if(bjTen(up)&&bjIsBJ(BJ.dealer)){          // пик на десятке
  BJ.hideHole=false;bjShow();bjSettle();return;
 }
 if(bjIsBJ(BJ.hands[0].cards)){             // сразу расчёт блэкджека
  BJ.hideHole=false;bjShow();bjSettle();return;
 }
 BJ.state='play';bjRender();
}
function bjInsurance(take){
 const ins=Math.floor(BJ.bet/2);
 if(take){
  if(BJ.balance<ins){
   termPrint('Not enough for insurance ('+ins+')','term-err');
   termPrint('Insurance? [y/n]','term-hint');
   return;
  }
  BJ.balance-=ins;BJ.ins=ins;
 }
 if(bjIsBJ(BJ.dealer)){BJ.hideHole=false;bjShow();bjSettle();return}
 if(bjIsBJ(BJ.hands[0].cards)){BJ.hideHole=false;bjShow();bjSettle();return}
 if(BJ.quit){BJ.hands.forEach(h=>{h.done=true});bjDealerTurn();return}
 BJ.state='play';bjRender();
}

/* --- ходы игрока --------------------------------------------------------- */
function bjMove(k){
 if(BJ.state!=='play')return;
 const h=BJ.hands[BJ.hand];
 if(!h||h.done)return;
 if(k==='h'){
  h.cards.push(bjDraw());
  const v=bjTotal(h.cards);
  if(v.t>21){h.bust=true;h.done=true;bjShow();termPrint('Bust ('+v.t+')','term-err');bjNext();return}
  if(v.t===21){h.done=true;bjShow();bjNext();return}
  bjRender();return;
 }
 if(k==='s'){h.done=true;bjNext();return}
 if(k==='d'){
  if(h.cards.length!==2||BJ.balance<h.bet){
   termPrint('Double needs two cards and '+h.bet+' in the bank','term-err');
   bjRender();return;
  }
  BJ.balance-=h.bet;h.bet*=2;h.doubled=true;
  h.cards.push(bjDraw());h.done=true;
  const v=bjTotal(h.cards);
  bjShow();
  if(v.t>21){h.bust=true;termPrint('Bust ('+v.t+')','term-err')}
  bjNext();return;
 }
 if(k==='p'){
  if(h.cards.length!==2||!bjPair(h.cards)){
   termPrint('Split needs a pair','term-err');bjRender();return;
  }
  if(BJ.hands.length>=4){termPrint('Four hands is the limit','term-err');bjRender();return}
  if(BJ.balance<h.bet){termPrint('Not enough to split','term-err');bjRender();return}
  const bet=h.bet;
  BJ.balance-=bet;
  BJ.splitUsed=true;
  const moved=h.cards.pop();               // вторая карта уходит в новую руку
  h.split=true;
  const nh={cards:[moved],bet,done:false,split:true};
  h.cards.push(bjDraw());
  nh.cards.push(bjDraw());
  BJ.hands.push(nh);
  if(h.cards[0].r==='A'){                  // после сплита тузов — по карте
   h.done=true;nh.done=true;
   termPrint('One card per ace','term-hint');
  }
  bjShow();
  if(h.done)bjNext();else bjRender();
  return;
 }
 if(k==='u'){
  if(h.cards.length!==2||BJ.hands.length!==1||BJ.splitUsed){
   termPrint('Surrender only as the very first move','term-err');
   bjRender();return;
  }
  const back=Math.floor(h.bet/2);
  BJ.balance+=back;h.done=true;h.surrender=true;
  termPrint('Surrender — '+back+' back (half the bet)','term-hint');
  bjNext();return;
 }
}
function bjNext(){                          // рука закончена — следующая
 while(BJ.hand<BJ.hands.length&&BJ.hands[BJ.hand].done)BJ.hand++;
 if(BJ.hand<BJ.hands.length){BJ.state='play';bjRender();return}
 bjDealerTurn();
}
function bjDealerTurn(){
 BJ.state='settle';
 BJ.hideHole=false;
 const alive=BJ.hands.some(h=>!h.bust&&!h.surrender);
 if(alive)while(bjTotal(BJ.dealer).t<17)BJ.dealer.push(bjDraw());
 bjShow();
 bjSettle();
}

/* --- расчёт -------------------------------------------------------------- */
function bjSettle(){
 BJ.state='settle';
 const dt=bjTotal(BJ.dealer);
 termPrint('Dealer: '+bjVal(BJ.dealer)+(dt.t>21?' — bust':''),
           dt.t>21?'term-ok':'term-hint');
 BJ.hands.forEach((h,i)=>{
  const v=bjTotal(h.cards);
  let ret=0,verdict,cls;
  if(h.surrender){verdict='surrender';cls='term-hint'}
  else if(v.t>21){verdict='bust';cls='term-err'}
  else if(!h.split&&bjIsBJ(h.cards)){
   if(bjIsBJ(BJ.dealer)){ret=h.bet;verdict='push (dealer blackjack)';cls='term-hint'}
   else{const p=Math.floor(h.bet*1.5);ret=h.bet+p;verdict='BLACKJACK +'+p;cls='term-ok'}
  }
  else if(bjIsBJ(BJ.dealer)){verdict='lose (dealer blackjack)';cls='term-err'}
  /* сравнение очков ТОЛЬКО по .t: dt и v — объекты {t,soft}, и сравнивать
     их с числом напрямую нельзя (20 > {t:18} всегда false — рука,
     бьющая дилера, уходила в «lose») */
  else if(dt.t>21||v.t>dt.t){ret=h.bet*2;verdict='win +'+h.bet;cls='term-ok'}
  else if(v.t===dt.t){ret=h.bet;verdict='push';cls='term-hint'}
  else{verdict='lose';cls='term-err'}
  BJ.balance+=ret;
  termPrint((BJ.hands.length>1?'Hand '+(i+1):'You')+' ('+bjVal(h.cards)+'): '+verdict,cls);
 });
 if(BJ.ins){
  if(bjIsBJ(BJ.dealer)){
   const back=BJ.ins*3;                    // ставка назад плюс 2:1
   BJ.balance+=back;
   termPrint('Insurance pays 2:1 +'+(back-BJ.ins),'term-ok');
  }else termPrint('Insurance lost '+BJ.ins,'term-err');
 }
 const delta=BJ.balance-BJ.roundStart;
 const ds=(delta>0?'+':'')+delta;
 termPrint('Balance: '+BJ.balance+'   ('+ds+')',
           delta>0?'term-ok':delta<0?'term-err':'term-hint');
 balSave(BJ);
 if(BJ.quit){bjEnd();return}
 BJ.hands=[];BJ.dealer=[];BJ.ins=0;BJ.hand=0;BJ.bet=0;
 BJ.splitUsed=false;BJ.hideHole=true;BJ.quit=false;
 BJ.state='bet';
 bjRender();
}

/* === Slots: игровой автомат прямо в консоли ==============================
   Команда slots — банк ОБЩИЙ с блэкджеком: GET/POST /api/balance ->
   balance.json, стартовая сумма и минимум ставки берутся из
   CONFIG.term.blackjack (bjCfg). Три барабана, одна линия выплат —
   средний ряд: три одинаковых платят по таблице (7 x300, S x75, B x30,
   L и O x15, C x10), пара возвращает половину ставки. Барабаны крутятся
   полсекунды: кадры сменяются в одном div — терминал HTML, строки не
   дорисовываются, остальной вывод на месте. Пока партия активна, ввод
   консоли уходит в игру (termRun -> slInput): число — ставка, q — выход,
   clear — очистить экран, help — таблица выплат, reset — новый банк.
   Подкрутка RTP: CONFIG.term.slots.rtp задаёт целевую долю возврата,
   вся таблица умножается на rtp/SL_RTP_BASE — на экране и в расчёте
   одинаковые множители. 0.9433 — базовая таблица (как задумана),
   1.0 — без перевеса, 1.05 — щедрый автомат; можно процентом (105). === */
const SL_STRIP=[['C',5],['L',4],['O',4],['B',3],['S',2],['7',1]]; // вес барабана, 19
const SL_PAY={'C':10,'L':15,'O':15,'B':30,'S':75,'7':300};
/* Базовый RTP таблицы: (4880 — три одинаковых + 1590 — пара) / 6859
   (общий знаменатель 19³ весов SL_STRIP) ≈ 0.94329. */
const SL_RTP_BASE=6470/6859;
function slRtp(){                      // целевой RTP из конфига, null — база
 let r=Number((termCfg().slots||{}).rtp);
 if(!isFinite(r)||r<=0)return null;
 if(r>3)r/=100;                        // 95 или 105 — это проценты
 return r;
}
function slScale(){const r=slRtp();return r==null?1:r/SL_RTP_BASE}

function slPick(){                      // символ с барабана — по весу
 let n=19*Math.random();
 for(const p of SL_STRIP){if((n-=p[1])<0)return p[0]}
 return '7';
}
const slSleep=ms=>new Promise(r=>setTimeout(r,ms));

/* --- рисунок автомата ---------------------------------------------------- */
function slFace(s){                     // клетка в три знака — как карты
 const cell=' '+s+' ';
 if(s==='7')return '<span class="term-err">'+cell+'</span>';
 if(s==='S')return '<span style="color:#ffc83c">'+cell+'</span>';
 return cell;
}
function slGridHtml(g){
 return [['┌───┐','┌───┐','┌───┐'].join(' '),
         g[0].map(s=>'│'+slFace(s)+'│').join(' '),
         '→ '+g[1].map(s=>'│'+slFace(s)+'│').join(' '),   // средний ряд — линия
         g[2].map(s=>'│'+slFace(s)+'│').join(' '),
         ['└───┘','└───┘','└───┘'].join(' ')].join('<br>');
}
function slRender(){
 if(!SL.active)return;
 const c=bjCfg();
 if(SL.balance<c.min){
  termPrint('Balance: '+SL.balance+' — the bank is empty.','term-err');
  termPrint('Type "reset" for a fresh '+c.start+'.','term-hint');
  return;
 }
 termPrint('Balance: '+SL.balance);
 termPrint('Spin ('+c.min+' … '+SL.balance+') or q to leave:','term-hint');
}
function slTableLine(){                // таблица по масштабу — ровно то, что выплатят
 const m=s=>Math.round(SL_PAY[s]*slScale());
 return 'Three of a kind pays: 7 x'+m('7')+', S x'+m('S')+', B x'+m('B')+
        ', L and O x'+m('L')+', C x'+m('C')+';';
}
function slPairLine(){
 const pct=Math.round(50*slScale());
 return pct===50?'a pair of a kind returns half the bet.':
                 'a pair of a kind returns '+pct+'% of the bet.';
}
function slRtpLine(){
 const r=slRtp();
 return 'RTP '+Math.round((r==null?SL_RTP_BASE:r)*100)+'% — tune it in CONFIG.term.slots.rtp.';
}
function slStart(){
 const c=bjCfg();
 SL.active=true;SL.state='bet';SL.spinning=false;SL.grid=null;
 termPrint('Slot machine — three reels, the payline is the middle row','term-key');
 termPrint(slTableLine());
 termPrint(slPairLine());
 termPrint(slRtpLine(),'term-hint');
 termPrint('The bank is shared with blackjack (start '+c.start+', min bet '+c.min+').','term-hint');
}
function slEnd(){
 SL.active=false;SL.state=null;SL.spinning=false;
 termPrint('Left the slots. Balance: '+SL.balance,'term-hint');
}
function slReset(){
 SL.balance=bjCfg().start;
 balSave(SL);
 termPrint('Fresh bankroll: '+SL.balance,'term-ok');
 slRender();
}
function slHelp(){
 const m=s=>Math.round(SL_PAY[s]*slScale());
 const pct=Math.round(50*slScale());
 termPrint('Slot machine commands:','term-key');
 termPrint('  a number — spin for that much, q — leave, clear — clear the screen,');
 termPrint('  reset — new bankroll, slots — show the machine again');
 termPrint('Payline is the middle row: three 7 x'+m('7')+', S x'+m('S')+', B x'+m('B')+',');
 termPrint('L/O x'+m('L')+', C x'+m('C')+'; a pair returns '+
           (pct===50?'half':pct+'%')+' the bet.');
 termPrint(slRtpLine());
 termPrint('The bank is shared with blackjack.');
}

/* --- ввод партии: сюда уходит всё, что ввёл игрок ------------------------ */
async function slInput(raw){
 const line=String(raw||'').trim();
 if(!line)return;
 const low=line.toLowerCase();
 const parts=line.split(/\s+/);
 const first=parts[0].toLowerCase();
 if(low==='clear'||low==='cls'){termClear();slRender();return}
 if(first==='slots'){                    // slots balance — банк без смены партии
  const sub=String(parts[1]||'').toLowerCase();
  if(sub==='balance'){termPrint('Balance: '+SL.balance);return}
  slRender();return;
 }
 if(low==='q'||low==='quit'||low==='exit'){slEnd();return}
 if(low==='help'||low==='?'||low==='rules'||low==='paytable'){slHelp();return}
 if(low==='reset'&&SL.state==='bet'){slReset();return}
 /* остальные команды оболочки (ls, date, theme…) работают как обычно */
 if(TERM_CMDS[first]){await TERM_CMDS[first](parts.slice(1),line);return}
 if(SL.spinning){termPrint('The reels are spinning…','term-hint');return}
 if(SL.state==='bet'){await slBet(low);return}
}
async function slBet(low){
 const c=bjCfg();
 if(!/^\d+$/.test(low)){
  termPrint('Type a number from '+c.min+' to '+SL.balance,'term-err');
  return;
 }
 const bet=Number(low);
 if(bet<c.min){termPrint('Minimum bet is '+c.min,'term-err');return}
 if(bet>SL.balance){termPrint('Not enough: the bank is '+SL.balance,'term-err');return}
 await slSpin(bet);
}
async function slSpin(bet){
 SL.state='spin';SL.spinning=true;
 SL.roundStart=SL.balance;
 SL.balance-=bet;
 const grid=()=>[[slPick(),slPick(),slPick()],
                 [slPick(),slPick(),slPick()],
                 [slPick(),slPick(),slPick()]];
 /* один div на весь автомат: кадры крутятся сменой его содержимого */
 const div=termPrintHtml(slGridHtml(grid()));
 for(let i=0;i<5;i++){div.innerHTML=slGridHtml(grid());await slSleep(110)}
 const g=grid();
 div.innerHTML=slGridHtml(g);
 SL.grid=g;SL.spinning=false;
 /* расчёт — по среднему ряду (линии выплат) в текущем масштабе RTP */
 const mid=g[1];
 const scale=slScale();
 let ret=0,verdict,cls;
 if(mid[0]===mid[1]&&mid[1]===mid[2]){
  const mult=Math.round(SL_PAY[mid[0]]*scale);  // видимая таблица = реальная выплата
  ret=bet*mult;
  verdict='Three '+mid[0]+' — x'+mult;
  cls='term-ok';
 }else{
  const pair=mid[0]===mid[1]?mid[0]:mid[1]===mid[2]?mid[1]:mid[0]===mid[2]?mid[0]:null;
  if(pair){
   const pct=Math.round(50*scale);
   ret=Math.floor(bet*pct/100);
   verdict='Two '+pair+' — '+(pct===50?'half back':pct+'% back');
   cls='term-hint';
  }else{verdict='No match';cls='term-err'}
 }
 SL.balance+=ret;
 termPrint(verdict,cls);
 const delta=SL.balance-SL.roundStart;
 const ds=(delta>0?'+':'')+delta;
 termPrint('Balance: '+SL.balance+'   ('+ds+')',
           delta>0?'term-ok':delta<0?'term-err':'term-hint');
 balSave(SL);
 SL.state='bet';
 slRender();
}

/* --- Где встанут терминалы ------------------------------------------------
   Ищет место по сетке (шаг 20) среди чужих окон: сначала то, куда окно
   влезает ЦЕЛИКОМ, из них — ближайшее к правому верхнему углу, там, где
   оно и должно стоять; если такого нет — самое вместительное. Препятствия —
   окно Server, просмотрщики, System Monitor и перетащенный руками
   аудиоплеер; ручное положение самих терминалов не трогаем.
   Ставит терминал(ы) в свободное место. Без аргумента — все открытые
   экземпляры ОДНИМ заходом: каждый при полном размере съедает место,
   которое нужно соседу (сверху узкая полоса), поэтому сначала ищем точку
   минимального размера для каждого, а потом раздаём полный размер по
   очереди — кому хватает. Кому места не хватило вовсе — минимальное
   перекрытие, как на совсем маленьком экране. С аргументом — только это
   окно (остальные терминалы для него препятствия). */
function placeTerm(win){
 if(win&&(win.hidden||win.dataset.maximized==='1'))return;
 if(win&&win.dataset.manual==='1'){clampWindow(win);return}
 const cfg=termCfg();
 const sw=scene.clientWidth,sh=scene.clientHeight,m=10,PAD=6;
 const hardW=300,hardH=170;                       // предел ужатия = min-size окна
 const wantW=Math.min(Math.max(hardW,sw-2*m),Math.max(hardW,Number(cfg.width)||560));
 const wantH=Math.min(Math.max(hardH,sh-2*m),Math.max(hardH,Number(cfg.height)||340));
 const taken=[];
 const servers=document.getElementById('winServers');
 if(servers&&!servers.hidden)taken.push(rectInScene(servers));
 viewers.forEach(v=>{if(!v.win.hidden)taken.push(rectInScene(v.win))});
 const mon=document.getElementById('winMonitor');
 if(mon&&!mon.hidden)taken.push(rectInScene(mon));
 /* плеер — препятствие, только если его перетащили руками или он приехал
    из раскладки: сам он встаёт по центру, объезжать его бессмысленно */
 const music=document.getElementById('winMusic');
 if(music&&!music.hidden&&music.dataset.manual==='1')taken.push(rectInScene(music));
 /* Network и Download Manager — тоже препятствия, если уже расставлены */
 ['winNetwork','winDownloads'].forEach(id=>{
  const ex=document.getElementById(id);
  if(ex&&!ex.hidden&&ex.style.left)taken.push(rectInScene(ex));
 });
 /* что переставляем (todo), а что только объезжаем */
 const todo=[];
 TERMS.forEach(t=>{
  if(win){
   if(t.win===win)todo.push(t);
   else if(!t.win.hidden)taken.push(rectInScene(t.win));
   return;
  }
  if(t.win.hidden)return;
  if(t.win.dataset.maximized==='1'){taken.push(rectInScene(t.win));return}
  if(t.win.dataset.manual==='1'){clampWindow(t.win);taken.push(rectInScene(t.win));return}
  todo.push(t);
 });
 if(!todo.length)return;
 const hits=(x,y,w,h)=>taken.some(r=>x<r.x+r.w+PAD&&r.x<x+w+PAD&&y<r.y+r.h+PAD&&r.y<y+h+PAD);
 /* Насколько можно развернуться из точки (x,y), не трогая чужие окна:
    вправо — до сцены или ближайшего препятствия, вниз — так же. */
 const fitAt=(x,y,w0,h0)=>{
  if(x<m-.5||y<m-.5)return null;
  if(taken.some(r=>x>=r.x-PAD&&x<r.x+r.w+PAD&&y>=r.y-PAD&&y<r.y+r.h+PAD))return null;
  let wLim=Math.min(w0,sw-m-x);
  for(const r of taken){
   if(r.y+PAD>=y+hardH||r.y+r.h-PAD<=y)continue;    // по вертикали не мешает
   if(r.x+r.w<=x+PAD)continue;                     // целиком слева
   wLim=Math.min(wLim,r.x-PAD-x);
  }
  if(wLim<hardW)return null;
  let hLim=Math.min(h0,sh-m-y);
  for(const r of taken){
   if(r.x+PAD>=x+wLim||r.x+r.w-PAD<=x)continue;     // по горизонтали не мешает
   if(r.y+r.h<=y+PAD)continue;                     // целиком выше
   hLim=Math.min(hLim,r.y-PAD-y);
  }
  if(hLim<hardH)return null;
  const w=Math.round(wLim),h=Math.round(hLim);
  if(hits(x,y,w,h))return null;                    // страховка от наложения
  return {x:Math.round(x),y:Math.round(y),w,h};
 };
 const corner=r=>{const dx=sw-m-(r.x+r.w),dy=r.y-m;return dx*dx+dy*dy};
 const findSpot=(w0,h0)=>{
  let full=null,best=null;
  for(let y=m;y+hardH<=sh-m+1;y+=20){
   for(let x=m;x+hardW<=sw-m+1;x+=20){
    const r=fitAt(x,y,w0,h0);
    if(!r)continue;
    if(r.w===w0&&r.h===h0){
     if(!full||corner(r)<corner(full))full=r;
    }else if(!best||r.w*r.h>best.w*best.h||
             (r.w*r.h===best.w*best.h&&corner(r)<corner(best)))best=r;
   }
  }
  return full||best;
 };
 /* фаза 1: точка минимального размера для каждого — так все гарантированно
    влезут в узкую полосу сверху, не съедая место соседа полным размером */
 const spots=new Map();
 for(const t of todo){
  const r=findSpot(hardW,hardH);
  if(r){spots.set(t,r);taken.push(r)}
 }
 /* фаза 2: теперь каждому — полный размер из config, кому хватает места */
 for(const t of todo){
  const cur=spots.get(t);
  if(!cur)continue;
  taken.splice(taken.indexOf(cur),1);              // своё место освободили
  const r=findSpot(wantW,wantH);
  if(r){spots.set(t,r);taken.push(r)}
  else taken.push(cur);                            // не вырос — остаёмся
 }
 /* фаза 3: кому точки не нашлось вовсе — минимальное перекрытие
    (маленький экран; как у System Monitor) */
 for(const t of todo){
  if(spots.get(t))continue;
  const p=dodgeWindows(Math.round((sw-hardW)/2),Math.round((sh-hardH)/2),
                       hardW,hardH,taken,sw,sh,m);
  let spot={x:p.x,y:p.y,w:hardW,h:hardH};
  if(taken.some(r=>overlapArea(spot,r)>0)){
   let worst=Infinity;
   for(let y=m;y+hardH<=sh-m+1;y+=20){
    for(let x=m;x+hardW<=sw-m+1;x+=20){
     const r={x,y,w:hardW,h:hardH};
     let score=0;
     for(const t2 of taken)score+=overlapArea(r,t2);
     if(score<worst){worst=score;spot=r}
    }
   }
  }
  spots.set(t,spot);taken.push(spot);
 }
 todo.forEach(t=>{
  const spot=spots.get(t);
  t.win.style.width=spot.w+'px';
  t.win.style.height=spot.h+'px';
  t.win.style.left=spot.x+'px';
  t.win.style.top=spot.y+'px';
  t.win.style.right='auto';
  t.win.style.bottom='auto';
  t.win.dataset.maximized='0';
 });
}

(async function initLayout(){
  layoutWindows(true);
  focusWindow(document.getElementById('winServers'));
  fitAscii();
  startMonitor();
  startNet();
  startDl();
  // содержимое окон — из папки pics/: сначала арт (он один на все окна),
  // потом картинка из конфига: каждое окно выбирает свою случайную, если
  // CONFIG.picFile = '~' — Math.random зовётся по разу на окно
  try{await loadArt();}catch(e){}
  for(const v of viewers){try{await initPicture(v);}catch(e){}}
  /* арт подогнан под содержимое — расставляем окна окончательно: иначе
     размер System Monitor (он встаёт в свободное место рядом с артом)
     зависит от того, успела ли картинка загрузиться, и на каждой загрузке
     окно получало бы разную высоту */
  layoutWindows(true);
  // раскладка с сервера применяется последней — поверх авто-расстановки
  if(CONFIG.rememberLayout!==false){
    savedLayout=await loadSavedLayout();
    if(savedLayout){
      applySavedLayout(savedLayout);
      autoSizeArt();   // окна, которых в раскладке ещё не было, встают сами
      placeTerm();     // и терминал, если его в раскладке ещё не было
      placeExtra(document.getElementById('winNetwork'));
      placeExtra(document.getElementById('winDownloads'));
      placeExtra(document.getElementById('winTelegram'));
    }
  }
  layoutReady=true;                 // дальше изменения можно сохранять
  syncLayoutPalette();
  /* Терминалы: стартовый вывод (CONFIG.term.startup) печатается ровно один
     раз на каждый экземпляр — даже если окно закрыто, содержимое подождёт
     в нём. Фокус во вводе — только в активном окне (раскладка могла
     открыть терминал верхним окном). */
  for(const t of TERMS){await termJob(t,()=>termStart())}
  const actTerm=TERMS.find(t=>!t.win.hidden&&t.win.classList.contains('active'));
  if(actTerm)termFocus(actTerm);
})();
