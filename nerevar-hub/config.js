/* ==========================================================================
  CONFIG — ВСЕ НАСТРОЙКИ ПАНЕЛИ
  ==========================================================================

  Файл лежит рядом с index.html и подключается строкой
  <script src="config.js"></script>. index.html править не нужно:
  меняете здесь, сохраняете и обновляете страницу (F5) — панель
  перечитывает config.js при каждой загрузке.

  Если config.js удалён или не отдаётся сервером, панель покажет
  синее окно с пояснением вместо рабочего стола.

  ПОЛЯ (кратко; подробности — в комментариях у самого объекта ниже):

      1.  serverName     — имя сервера (вкладка, окна, таскбар, Help)
      2.  serverIcon     — буква/символ в иконке
      3.  welcomeTitle   — заголовок блока приветствия
      4.  welcomeText    — текст приветствия
      5.  lanHost        — адрес в локальной сети (подставляется в ссылки)
      6.  tailscaleHost  — адрес по Tailscale
      7.  favoriteUrl    — ссылка меню Favorites
      8.  artWindowTitle — заголовок окна с ASCII-артом
      9.  artFile        — ascii-арт: файл внутри папки pics/
      10. picFile        — картинка при загрузке: имя файла в pics/
                           или '~.png' / '~.gif' / '~' — случайная
      11. artIcon        — иконка окна арта
      12. numberStyle    — 'title' | 'big' — размер цифр-иконок сервисов
      13. services[]     — сервисы: name, port, note, icon
                           если icon пустой/отсутствует — покажется номер
      14. monitor        — System Monitor: endpoint /api/stats, период
                           опроса, размер окна и exclude — какие точки
                           монтирования НЕ показывать в разделе Storage
                           ('/boot' прячет и '/boot/efi'; '/' — всегда).
                           Физическая папка для плеера меняется флагом
                           server.py --music-dir /path/on/mount
      15. help           — содержимое окна Help (заголовок и пункты)
      16. music          — аудио-плеер: base — URL-префикс папки с треками
                           (можно указать смонтированный диск или внешний
                           URL), list — endpoint списка треков, tracks —
                           ручной список, volume / loop / shuffle /
                           startOpen / размер окна; skins — скины
                           Qmmp/Winamp 2: enabled, dir, list, start,
                           scale, playlistHeight
      17. rememberLayout — true: запоминать, какие окна открыты, где они
                           стоят и какие карточки services выключены
                           (View → Layout constructor…). Раскладка
                           сохраняется НА СЕРВЕРЕ (layout.json) и одинакова
                           для всех устройств; false — всегда открывать
                           панель как задумано по умолчанию.
      18. theme          — 'dark' | 'light' — оформление панели. 'dark'
                           (по умолчанию) — тёмная тема: бирюзовый рабочий
                           стол, почти чёрные тела окон, тёмно-синие
                           заголовки, светло-голубые подписи, белый текст,
                           синие и оранжевые шкалы — как панель выглядит
                           при включённом Dark Reader. То же переключается
                           кнопкой «Dark theme» во вкладке View.
      19. font           — строка font-family для всего интерфейса: имя
                           шрифта, установленного в системе, либо весь
                           список через запятую, как в CSS. Пустая строка —
                           шрифт по умолчанию. Список того, что реально
                           стоит на машине, отдаёт server.py (GET /api/fonts:
                           в Linux это fontconfig, «fc-list»), и панель сама
                           показывает его в View → Font… с предпросмотром.
                           Там же шрифт выбирается на лету — выбор важнее
                           этого поля и хранится как тема.
      20. viewers         — сколько окон Picture Viewer открывать (1..6,
                           по умолчанию 2). Окна независимы: своё фото, свой
                           зум, свой режим арт/картинка. В любом окне фото
                           меняется через File → Open image… — диалог идёт
                           в последнее активное окно и подпишет, в какое.
                           Содержимое общее: CONFIG.artFile и CONFIG.picFile,
                           а при '~' каждое окно при загрузке выбирает свою
                           случайную картинку.

  ========================================================================== */
/* ==========================================================================
   НАСТРОЙКИ — МЕНЯТЬ ТОЛЬКО ЗДЕСЬ
   ========================================================================== */
window.CONFIG={
 serverName:'Server',
 serverIcon:'S',
 welcomeTitle:'Welcome',
 welcomeText:'Replace this text with your own description.',
 lanHost:'192.168.1.10',      // подставляется в ссылки сервисов
 tailscaleHost:'myhost',       // адрес по Tailscale: домен или 100.x.y.z
 favoriteUrl:'https://example.com/',
 artWindowTitle:'Picture Viewer',
 artFile:'ASCII_ART.TXT',      // ascii-арт: файл в pics/ (пусто — не грузить)
 picFile:'',                   // какую картинку показать сразу: 'cat.png'
                               // или '~.png' / '~.jpg' / '~.gif' / '~' —
                               // случайная картинка из pics/ при каждой
                               // загрузке страницы; '' — показывать арт
 viewers:2,                    // сколько окон Picture Viewer (1..6): каждое
                               // живёт своей жизнью — своё фото, свой зум,
                               // свой режим арт/картинка. Содержимое общее
                               // (artFile/picFile выше): при '~' каждое окно
                               // при загрузке выбирает СВОЮ случайную
                               // картинку, независимо от остальных.
 artIcon:'P',
 numberStyle:'title',
  // --- Тема оформления ----------------------------------------------------
  // 'dark' — тёмная тема (как при включённом Dark Reader): бирюзовый рабочий
  //          стол, почти чёрные тела окон, тёмно-синие заголовки, светло-
  //          голубые подписи, белый текст, синие и оранжевые шкалы;
  // 'light' — классическая светлая тема, как была всегда.
  // Кнопка «Dark theme» во вкладке View переключает тему на лету: выбор
  // запоминается в браузере и едет в раскладку на сервере, поэтому он
  // одинаков на всех устройствах и важнее этого поля. «View → Reset window
  // layout» забывает выбор и возвращает тему, заданную здесь.
  theme:'dark',
  // --- Шрифт интерфейса ----------------------------------------------------
  // Строка font-family, которой набрана вся панель (арт и окно плеера —
  // моноширинные, их эта настройка не трогает):
  //   ''                                  — шрифт по умолчанию (Tahoma,
  //                                         Verdana, sans-serif)
  //   'DejaVu Sans'                       — конкретный шрифт из системы
  //   'Noto Sans, DejaVu Sans, sans-serif'— список через запятую, как в CSS
  // Какие шрифты стоят на машине, смотрите в View → Font… (панель поднимает
  // их сама: server.py отдаёт GET /api/fonts — fontconfig/fc-list, а без
  // утилиты сам обходит папки и читает имена из файлов TTF/OTF). Выбор в этом
  // диалоге важнее этого поля, хранится как тема, а «View → Reset window
  // layout» забывает его и возвращает шрифт, заданный здесь.
  font:'Tahoma, Verdana, sans-serif',
  // Запоминать раскладку панели (View → Layout constructor…): какие окна
  // открыты, их положение и размер, порядок, какие карточки services
  // показывать. Раскладка лежит на сервере (layout.json, общий для всех
  // устройств) и восстанавливается при каждой загрузке.
  rememberLayout:true,      // false — всегда раскрывать панель по умолчанию
 // --- Аудиоплеер ---------------------------------------------------------
 music:{
  enabled:true,          // false — окна и кнопки в таскбаре не будет
  windowTitle:'Audio Player',
  icon:'A',
  // Откуда берутся треки: URL-префикс папки. Эту папку отдаёт server.py
  // (по умолчанию BASE_DIR/music; можно указать свой диск:
  //   python3 server.py --music-dir /mnt/hdd/music
  // ). Можно вписать и внешний адрес: 'https://example.com/music/'.
  base:'music/',
  // endpoint со списком треков; пустая строка — не спрашивать сервер
  list:'api/music',
  // ручной список вместо endpoint (полезно для внешнего адреса):
  // ['track1.mp3','track2.ogg']
  tracks:[],
  startOpen:false,       // открывать окно сразу при загрузке страницы
  width:300,             // желаемый размер окна
  height:300,
  volume:0.8,            // 0..1
  loop:'all',            // 'off' | 'all' | 'one'
  shuffle:false,
  // --- скины плеера (Qmmp/Winamp 2) -------------------------------------
  // Формат скина: .wsz — это ZIP c BMP-файлами (main.bmp, cbuttons.bmp,
  // titlebar.bmp, pledit.bmp …). Кладёте файл в папку skins/ рядом с
  // index.html — он появится в списке ниже. Либо жмёте кнопку «Skin…» и
  // выбираете .wsz со своего диска: файл никуда не отправляется,
  // браузер читает его локально.
  skins:{
   enabled:true,         // false — панель выбора скина не показывается
   // URL-префикс папки со скинами (её отдаёт server.py как /skins/).
   // Можно указать и внешний адрес: 'https://example.com/skins/'
   dir:'skins/',
   // endpoint со списком скинов; пустая строка — список не запрашивать,
   // в списке останется только «No skin» + кнопка «Skin…»
   list:'api/skins',
   // скин, включаемый при загрузке страницы ('' — обычный вид плеера)
   start:'',
   // во сколько раз рисовать окно Winamp (1 = размер оригинала)
   scale:2,
   // высота окна плейлиста в пикселях скина (видно ~10 строк)
   playlistHeight:196
  }
 },
 monitor:{
  enabled:true,
  windowTitle:'System Monitor',
  icon:'M',
  endpoint:'/api/stats',
  interval:2000,
  timeout:2500,
  width:360,
  height:225,
  // точки монтирования, которые НЕ показывать в разделе Storage.
  // Совпадение по точному пути или по началу пути, поэтому '/boot'
  // прячет и '/boot', и '/boot/efi'. Корень '/' показывается всегда.
  exclude:['/boot']
 },
 services:[
  {name:'Placeholder 01',port:'8001',note:'Demo endpoint',icon:'♫'},
  {name:'Placeholder 02',port:'8002',note:'Demo endpoint',icon:'📁'},
  {name:'Placeholder 03',port:'8003',note:'Demo endpoint'},
  {name:'Placeholder 04',port:'8004',note:'Demo endpoint'},
  {name:'Placeholder 05',port:'8005',note:'Demo endpoint'},
  {name:'Placeholder 06',port:'8006',note:'Demo endpoint'}
 ],
 help:{
  windowTitle:'Help',
  title:'Help',
  intro:'Replace this help text with your own.',
  items:[
   'Edit <code>config.js</code> (the <code>CONFIG</code> object in it) to set your server name, addresses and ports &mdash; the page itself needs no edits.',
   'Give a service any icon by adding <code>icon: \'📁\'</code> to its entry — numbers are used when no icon is set.',
   'Addresses can also be changed right here in the UI &mdash; service links update automatically.',
   '<b>View &rarr; Zoom</b> scales the ASCII art.',
   'The ASCII art is not stored in the page &mdash; its name lives in <code>config.js</code> (<code>CONFIG.artFile</code>, by default <code>ASCII_ART.TXT</code>) and the file is read from the <code>pics/</code> folder. Drop your own <code>.txt</code> into <code>pics/</code> and point <code>CONFIG.artFile</code> at it; the page itself needs no edits.',
   'The Picture Viewer also shows pictures: <b>File &rarr; Open image&hellip;</b> opens one by URL or with <b>Browse&hellip;</b>, or just drop a file onto the window. PNG, JPG, WEBP, SVG and animated GIF (the animation runs as-is) are supported. The picture is fitted into the window without distortion and the window takes its proportions; <b>File &rarr; Back to ASCII art</b> brings the art back.',
   'Which picture opens on start is set by <code>CONFIG.picFile</code>: <code>cat.png</code> — a specific file from <code>pics/</code>, <code>~.png</code> / <code>~.gif</code> / <code>~</code> — a <b>random</b> picture of that extension picked from <code>pics/</code> on every page load (the file list comes from <code>/api/pics</code>), empty — stay on the ASCII art.',
   'Several Picture Viewer windows can be open at once &mdash; <code>CONFIG.viewers</code> sets how many (1&ndash;6, default 2). They do not depend on each other: every window keeps its own picture, its own zoom and its own art/image mode. <code>File &rarr; Open image&hellip;</code> sends the picture to the viewer you focused last and the dialog says which one. Content comes from the same settings for all of them, and with <code>~</code> each window picks <b>its own</b> random picture on every load.',
   'The <b>System Monitor</b> window polls <code>/api/stats</code> (served by <code>server.py</code>) and shows CPU, RAM and Load, a <b>Storage</b> section with every mounted volume, and a <b>RAID</b> section with every array from <code>/proc/mdstat</code> (level, size, state, member disks). When the server is down it shows &laquo;N/A &mdash; host unreachable&raquo;.',
   'The <b>Audio Player</b> (<b>File &rarr; Audio player</b>) streams music from <code>CONFIG.music.base</code> — the <code>music/</code> folder served by <code>server.py</code> (track list from <code>/api/music</code>) or any URL. Transport buttons, seek, volume, <b>S</b> (shuffle) and <b>R</b> (repeat), clickable track list. If a track shows &laquo;unsupported or damaged audio file&raquo;, the browser cannot decode that file (for example, some FLAC files with broken cover art are rejected by Chromium &mdash; <code>metaflac --remove --block-type=PICTURE file.flac</code> repairs them).',
   'The player can look like a real Winamp/Qmmp window: put a <code>.wsz</code> skin (a ZIP with <code>main.bmp</code>, <code>cbuttons.bmp</code>, <code>pledit.bmp</code>&hellip;) into the <code>skins/</code> folder and choose it from the list, press <b>Skin&hellip;</b> to load one from this computer, or drop a skin file onto the window. Everything is parsed in the browser &mdash; nothing is uploaded. Size and playlist height &mdash; <code>CONFIG.music.skins.scale</code> and <code>playlistHeight</code>.',
   'Windows can be dragged by the title bar and resized from the bottom-right corner.',
   '<b>View &rarr; Layout constructor&hellip;</b> decides how the panel opens: tick the windows you want open, tick the <b>Available services</b> cards you need, arrange everything by dragging, then press <b>Save layout</b>. The layout is stored on the server (<code>layout.json</code> via <code>/api/layout</code>) so every device opens the panel exactly the way you arranged it. <b>Reset window layout</b> returns the default placement; <code>CONFIG.rememberLayout = false</code> in <code>config.js</code> switches the memory off completely.',
   'The panel has two looks: the classic light one and a <b>dark</b> one (teal desktop, near-black window bodies, dark-blue title bars, light-blue headings, white text, blue and orange gauges &mdash; the way it appears with the Dark Reader extension on). Set <code>CONFIG.theme = &quot;dark&quot;</code> in <code>config.js</code>, or press <b>Dark theme</b> in the <b>View</b> menu to switch at once: the button remembers the choice in this browser and travels with the layout on the server, so every device opens in the same theme. <b>Reset window layout</b> forgets the choice and returns the theme set in <code>config.js</code>.',
   'The whole interface is set in the font from <code>CONFIG.font</code> in <code>config.js</code> &mdash; a family installed on the machine, or a full CSS stack such as <code>&quot;Noto Sans, DejaVu Sans, sans-serif&quot;</code> (an empty value keeps the default). <b>View &rarr; Font&hellip;</b> lists every font that is actually installed: server.py collects them from the system (fontconfig &mdash; <code>fc-list</code> &mdash; or, without that utility, by reading the font folders itself), each name is drawn in its own face so you see it before choosing, and the search box filters the list &mdash; type a name that is not on the list and press Enter to use it anyway. The choice is remembered like the theme and travels with the layout; <b>Reset window layout</b> returns to <code>CONFIG.font</code>. The ASCII art window and the player keep their own monospace fonts.',
   'The taskbar <b>clock</b> is two lines: the time on top, the date <code>Mo/Nov/2/2026</code> under it (two-letter weekday, three-letter month). Both are visible at every screen width. Click it to open a calendar &mdash; month view, <b>Today</b> button, closes on Esc or a click anywhere else.'
  ]
 }
};
