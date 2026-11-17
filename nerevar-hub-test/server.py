#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nerevar Hub — локальный сервер веб-панели + отдача метрик системы.

Что умеет:
  GET /            -> отдаёт index.html (панель)
  GET /config.js   -> настройки панели (объект CONFIG: имя сервера,
                      адреса, сервисы, монитор, аудио-плеер, скины)
  GET /app.js      -> логика панели (основной скрипт, вынесенный
                      из index.html; без кэша — правки видны после F5)
  GET /openstep.html -> старый адрес скина WindowMaker: файл просто
                      перенаправляет на index.html?skin=wm (сам скин
                      живёт в index.html, переключатель — View →
                      WindowMaker skin)
  GET /dock.json    -> иконки дока скина WindowMaker: JSON-карта
                      id окна -> файл картинки (пути от корня панели);
                      пустой icons — на плитках буквы
  GET /api/stats   -> JSON с метриками процессора, памяти, загрузки,
                      дисков и RAID-массивов, плюс статичные поля
                      sysname/host/os/kernel/machine (их показывает
                      команда fetch в окне Terminal панели)
  GET /pics/<имя>  -> картинка или ascii-арт из папки pics/ (только чтение)
  GET /api/pics    -> JSON со списком файлов в pics/ (имена картинок и артов)
  GET /music/<имя> -> аудиофайл из папки music/ (Range: перемотка работает)
  GET /api/music   -> JSON со списком треков в music/
  GET /skins/<имя> -> скин плеера (.wsz / .zip) из папки skins/
  GET /api/skins   -> JSON со списком скинов в skins/
  GET /api/layout  -> сохранённая раскладка окон панели (layout.json);
                      404, если раскладка ещё не сохранялась
  POST /api/layout -> сохранить раскладку (JSON-объект до 64 КБ);
                      записывается атомарно, одинакова для всех устройств
  DELETE /api/layout -> сбросить раскладку (удалить layout.json)
  GET /api/balance  -> банк игрока в блэкджеке (balance.json);
                      404, если партий ещё не было
  POST /api/balance -> сохранить банк ({"balance": N}: целое 0..10^9);
                      записывается атомарно, как и раскладка
  GET /api/network  -> сетевые счётчики и слушающие порты: ifaces из
                      /proc/net/dev (rx/tx байт всего), ports из
                      /proc/net/tcp и /proc/net/tcp6 (state LISTEN) —
                      их показывает окно Network и команда ss
  GET /api/downloads -> список загрузок Download Manager:
                      {"dir": "downloads", "jobs": [{id, url, name, got,
                      total, status, error, started}]} — status: running,
                      done, failed, cancelled
  POST /api/downloads -> начать загрузку {"url": "http://…"} (только
                      http/https) -> {"id": N, "name", "dir"}; файл
                      пишется фоновым потоком в downloads/
  POST /api/downloads/control -> {"id": N, "action": "cancel"|"remove"}
  GET /downloads/<имя> -> файл из downloads/; всегда с Content-Disposition:
                      attachment (скачанная страница не рендерится),
                      листинга каталога нет
  ANY /tg/...      -> прокси Telegram Web для окна Telegram: официальный
                      web.telegram.org отдаёт X-Frame-Options: deny (в iframe
                      его не показать), поэтому панель встраивает прокси —
                      браузер ходит на свой же origin, а сервер отдаёт
                      контент web.telegram.org, выкинув запреты фреймирования
                      (X-Frame-Options, CSP) и вернув редиректы с префиксом
                      /tg/ (иначе страница ушла бы из-под прокси). Хост
                      зафиксирован в коде — проксируется ТОЛЬКО
                      web.telegram.org, путь его подменить не может;
                      адрес меняется только переменной окружения
                      TELEGRAM_UPSTREAM (нужно тестам и локальным зеркалам).
                      Проксируются GET/HEAD/POST (MTProto ходит по HTTP,
                      long-poll держит соединение — таймаут TELEGRAM_TIMEOUT,
                      сек, по умолчанию 90), потолок POST — 16 МБ (413 выше);
                      адреса апстрима перебираются с коротким срезом (5 с)
                      на не-последнем — IPv6 на домашних сетях бывает мёртв,
                      а getaddrinfo отдаёт его первым (см.
                      _tg_create_connection)
  GET /favicon.ico -> 204 (чтобы в консоли браузера не было 404)

Файл config.js (рядом с index.html) — все настройки панели: имя сервера,
адреса, сервисы, System Monitor (включая список скрываемых точек
монтирования), аудио-плеер и скины, текст Help. Панель читает его при
каждой загрузке: сохранил — обновил страницу (F5).

Папка music/ (рядом с index.html, путь меняется флагом --music-dir) —
откуда Audio Player берёт треки. В config.js указывается только URL-префикс
(CONFIG.music.base), так что папку можно держать на любом смонтированном
диске и не трогать страницу.

Папка skins/ (рядом с index.html) — скины для Audio Player в формате
Qmmp/Winamp2 (.wsz — это ZIP с BMP-файлами). Кладёте файл в папку,
он появляется в списке скинов на странице. Расширения разрешены только
.wsz и .zip, выход за пределы папки даёт 404 (как в pics/). Свои скины
можно и не класть — на странице есть кнопка «Load skin…», которая
читает .wsz прямо с диска и ничего не отправляет на сервер.

Папка pics/ (рядом с index.html) — единственное место, где лежит
содержимое Picture Viewer: и картинки, и ascii-арт. В неё кладут файлы,
а config.js хранит только имена (CONFIG.artFile / CONFIG.picFile).
Отдаются только файлы с расширением из списка, и только внутри pics/:
попытки выйти за её пределы (../, абсолютный путь, симлинк наружу)
получают 404. Папка может не существовать — тогда /pics/ и /api/pics
отдают 404/пустой список.

Папка downloads/ (рядом с server.py) — куда складывает файлы Download
Manager (окно Download Manager и команда wget в Terminal). Создаётся
сама при первой загрузке; содержимое в git не попадает (.gitignore),
в репозиторий идёт только README папки. Файлы отдаются наружу только по
прямому адресу /downloads/<имя> и всегда с Content-Disposition:
attachment — даже если по ссылке скачана HTML-страница, браузер
сохранит файл, а не выполнит его рядом с панелью. Листинга каталога нет.

layout.json (рядом с server.py) — раскладка окон панели, которую
пользователь собрал в конструкторе (View -> Layout constructor):
какие окна открыты, где стоят (в долях от размера рабочего стола,
поэтому на любом экране выглядит одинаково) и какие карточки
сервисов скрыты. Отдаётся по /api/layout, пишется только оттуда
(POST), атомарно и под блокировкой — несколько вкладок не затрут
друг друга. Файл служебный, в git не попадает (.gitignore).
Без него панель просто расставляет окна по умолчанию.

Запуск вручную:
  python3 server.py --port 80
  в логе будет видно PID — убить процесс: kill <PID>
  или: kill $(cat server.pid)

Запуск через systemd (рекомендуется):
  см. файл nerevar-hub.service в этой же папке
  там: systemctl stop nerevar-hub / journalctl -u nerevar-hub -f

Ключевые опции:
  --port 80            порт (по умолчанию 80)
  --host 0.0.0.0       адрес привязки
  --cors               разрешить запросы с другого origin (file:// и т.п.)
  --pidfile PATH       куда записать PID (по умолчанию server.pid рядом
                       со скриптом), --no-pidfile — не создавать
  --cpu-interval 1.0   период замера CPU, сек

Зависимости: только стандартная библиотека Python 3.6+.
Метрики читаются напрямую из /proc и через os.statvfs — ничего ставить не надо.

Локальные файлы читаются только из папки, где лежит этот скрипт; чужие
URL открываются ровно один раз — когда Download Manager или команда
wget качает файл по явной команде пользователя.
"""

import argparse
import http.client
import json
import os
import re
import signal
import socket
import subprocess
import sys
import mimetypes
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
# настройки панели — отдельный файл; index.html его только подключает
# (<script src="config.js">), поэтому правки видны сразу после F5
CONFIG_PATH = os.path.join(BASE_DIR, "config.js")
# логика панели — основной скрипт, вынесенный из index.html; подключается
# как <script src="app.js"> и отдаётся без кэша, как config.js
APP_PATH = os.path.join(BASE_DIR, "app.js")
# старый адрес скина WindowMaker: перенаправляет на index.html?skin=wm,
# отдаётся без кэша, как config.js и app.js
OPENSTEP_PATH = os.path.join(BASE_DIR, "openstep.html")
# иконки дока скина WindowMaker (JSON-карта id окна -> картинка), без кэша
DOCK_PATH = os.path.join(BASE_DIR, "dock.json")
PICS_DIR = os.path.join(BASE_DIR, "pics")
# скины плеера (Qmmp = Winamp2: .wsz — это ZIP c BMP внутри)
SKINS_DIR = os.path.join(BASE_DIR, "skins")
# откуда берётся музыка: папку можно переопределить флагом --music-dir
# (например, --music-dir /mnt/hdd/music), а URL-префикс задаётся в index.html
MUSIC_DIR = os.path.join(BASE_DIR, "music")
DEFAULT_PIDFILE = os.path.join(BASE_DIR, "server.pid")
# сохранённая раскладка окон панели (View -> Layout constructor);
# пишется только через POST /api/layout, читается при каждой загрузке
LAYOUT_PATH = os.path.join(BASE_DIR, "layout.json")
LAYOUT_MAX = 64 * 1024          # потолок размера раскладки, байт
LAYOUT_LOCK = threading.Lock()   # писать могут несколько вкладок сразу

# Банк игрока в блэкджеке (команда blackjack в окне Terminal);
# пишется через POST /api/balance, читается при старте партии
BALANCE_PATH = os.path.join(BASE_DIR, "balance.json")
BALANCE_MAX = 1024               # на банк уходит один крошечный JSON
BALANCE_LOCK = threading.Lock()

# Прокси Telegram Web (окно Telegram: /tg/... -> web.telegram.org).
# Официальный сайт запрещает встраивание в iframe (X-Frame-Options: deny),
# поэтому панель встраивает ПРОКСИ: браузер ходит на свой же origin — воркер
# MTProto, шрифты и long-poll не требуют CORS — а сервер отдаёт контент
# без запрета фреймирования. Хост зафиксирован здесь: путь запроса уходит
# в него как есть и не может подменить адрес (см. _telegram_proxy).
TG_UPSTREAM = os.environ.get("TELEGRAM_UPSTREAM",
                             "https://web.telegram.org").rstrip("/")
# long-poll MTProto держит соединение десятки секунд — таймаут щедрый;
# ограничивает только промежуток между байтами, поток живёт столько, сколько
# нужно (сервер многопоточный — параллельные запросы друг другу не мешают)
TG_TIMEOUT = float(os.environ.get("TELEGRAM_TIMEOUT", "90"))
# POST — куски MTProto; больше 16 МБ на один запрос панель не шлёт
TG_POST_MAX = 16 * 1024 * 1024
# заголовки, из-за которых страница либо не влезла бы в iframe панели
# (XFO/CSP), либо сломали бы проксированную отдачу (длину считаем сами)
TG_DROP_HEADERS = {"x-frame-options", "content-security-policy",
                   "content-security-policy-report-only",
                   "strict-transport-security", "alt-svc",
                   "content-length", "connection", "keep-alive",
                   "transfer-encoding"}
# urllib сам следует редиректам — а их надо показать браузеру с префиксом
# /tg/, иначе страница (и её относительные ссылки) выйдут из-под прокси
class _TGNoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# первому (обычно IPv6) адресу апстрима — короткий срез: getaddrinfo
# отдаёт IPv6 первым, а на домашних сетях он бывает «чёрной дырой»
# (нестабильный RA-адрес роутера) — python ждал бы весь таймаут на мёртвом
# адресе, пока браузер и curl тем временем ушли на IPv4 (они гоняют
# happy eyeballs). Не успел за 5 секунд — идём к следующему адресу;
# последний и единственный адрес получают полный таймаут.
TG_CONNECT_SLICE = 5.0


def _tg_create_connection(address, timeout, source_address=None):
    """socket.create_connection с коротким срезом для не-последнего адреса."""
    host, port = address
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    last_error = None
    for index, (family, kind, proto, _canon, sockaddr) in enumerate(infos):
        wait = timeout
        if timeout is not None and index < len(infos) - 1:
            wait = min(timeout, TG_CONNECT_SLICE)
        sock = None
        try:
            sock = socket.socket(family, kind, proto)
            if wait is not None:
                sock.settimeout(wait)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except OSError as exc:
            last_error = exc
            if sock is not None:
                sock.close()
            continue
        return sock
    raise last_error or OSError("no route to %s:%s" % (host, port))


class _TGHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection с быстрым перебором адресов (см. _tg_create_connection)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = _tg_create_connection


class _TGHTTPSConnection(http.client.HTTPSConnection):
    """То же для HTTPS: заменяется только TCP-соединение, SNI остаётся
    на имени хоста — сертификат telegram так и проверяется."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = _tg_create_connection


class _TGHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_TGHTTPConnection, req)


class _TGHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_TGHTTPSConnection, req)


TG_OPENER = urllib.request.build_opener(_TGNoRedirect, _TGHTTPHandler,
                                        _TGHTTPSHandler)

# Загрузки Download Manager (окно и команда wget): файлы падают в папку
# downloads/ рядом с сервером. Папка создаётся при первой загрузке,
# содержимое в git не идёт (.gitignore), а наружу отдаётся только по
# прямому адресу /downloads/<имя> и всегда с Content-Disposition:
# attachment — скачанная HTML-страница не выполнится в origin панели.
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
DOWNLOADS = {}                    # id -> карточка загрузки (dict)
DOWNLOADS_LOCK = threading.Lock()  # реестр: старт потока и его завершение
DOWNLOAD_SEQ = [0]                # счётчик id, меняется под локом

# Что вообще готовы отдавать из pics/. Расширение — маленькими буквами.
# HTML/JS/XML сюда не попадают принципиально: даже svg, который браузер
# умеет исполнять, отдаётся с CSP, запрещающим скрипты.
PIC_EXTS = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}
# ascii-арт: обычный текст, отдаётся как есть
ART_EXTS = {".txt": "text/plain; charset=utf-8"}
SERVE_EXTS = dict(PIC_EXTS)
SERVE_EXTS.update(ART_EXTS)
# аудио: отдаётся из music/ и умеет Range (перемотка в плеере)
AUDIO_EXTS = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".weba": "audio/webm",
    ".webm": "audio/webm",
}
# скины плеера: .wsz — это просто ZIP c BMP-файлами внутри, отдаётся
# как есть; разбирает его браузер, серверу содержимое не интересно
SKIN_EXTS = {
    ".wsz": "application/zip",
    ".zip": "application/zip",
}
# типы, в которых скрипты физически невозможны — им CSP не нужен
SAFE_TYPES = ({v for k, v in PIC_EXTS.items() if k != ".svg"}
              | set(ART_EXTS.values())
              | set(AUDIO_EXTS.values())
              | set(SKIN_EXTS.values()))

# У каждого запуска свой номер: пишем его в каждую строку лога и в pidfile,
# чтобы всегда было видно, какой это процесс и как его остановить.
PID = os.getpid()
PROC_NAME = os.path.basename(sys.argv[0]) or "server.py"

MIB = 1024.0 ** 3  # ГБ


# --------------------------------------------------------------------------- #
#  Статичная информация о системе: sysname / host / os / kernel / machine.
#  Считается один раз и отдаётся в /api/stats — её же показывает команда
#  fetch в окне Terminal панели (см. CONFIG.term в config.js).
# --------------------------------------------------------------------------- #
_SYS_INFO = None


def read_os_release():
    """PRETTY_NAME из /etc/os-release — «Debian GNU/Linux 12 (bookworm)»."""
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as fh:
            for line in fh:
                key, sep, value = line.partition("=")
                if sep and key.strip() == "PRETTY_NAME":
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return "Linux"


def system_info():
    """Словарь с именем системы, хостом, ядром и архитектурой. Кэшируется."""
    global _SYS_INFO
    if _SYS_INFO is None:
        try:
            u = os.uname()
            sysname, host = u.sysname, u.nodename
            kernel, machine = u.release, u.machine
        except (AttributeError, OSError):        # не Linux — просто пустое
            sysname = host = kernel = machine = ""
        os_name = read_os_release()
        if machine and machine not in os_name:   # архитектура — в конец строки
            os_name = "%s %s" % (os_name, machine)
        _SYS_INFO = {
            "sysname": sysname,
            "host": host,
            "os": os_name,
            "kernel": kernel,
            "machine": machine,
        }
    return _SYS_INFO


# --------------------------------------------------------------------------- #
#  Метрики
# --------------------------------------------------------------------------- #
class SystemMetrics:
    """Считает метрики. CPU — фоновым потоком (нужна разница двух чтений),
    остальное — по запросу (чтение мгновенное)."""

    def __init__(self, cpu_interval=1.0):
        self._lock = threading.Lock()
        self._cpu_interval = cpu_interval
        self._cpu_percent = None
        self._prev_cpu = None
        self._stop = threading.Event()

    # --- CPU ------------------------------------------------------------- #
    @staticmethod
    def _read_cpu_times():
        """Возвращает (idle, total) тиков из /proc/stat или None."""
        try:
            with open("/proc/stat", "r", encoding="ascii") as fh:
                line = fh.readline()
        except OSError:
            return None
        parts = line.split()
        if not parts or parts[0] != "cpu":
            return None
        try:
            values = [int(v) for v in parts[1:]]
        except ValueError:
            return None
        if len(values) < 4:
            return None
        idle = values[3]
        if len(values) > 4:
            idle += values[4]  # iowait
        return idle, sum(values)

    def _cpu_worker(self):
        # первое чтение — базовая точка
        self._prev_cpu = self._read_cpu_times()
        while not self._stop.wait(self._cpu_interval):
            current = self._read_cpu_times()
            if current is None or self._prev_cpu is None:
                continue
            d_idle = current[0] - self._prev_cpu[0]
            d_total = current[1] - self._prev_cpu[1]
            self._prev_cpu = current
            if d_total <= 0:
                continue
            used = 1.0 - (d_idle / d_total)
            percent = max(0.0, min(100.0, used * 100.0))
            with self._lock:
                self._cpu_percent = round(percent, 1)

    def start(self):
        threading.Thread(target=self._cpu_worker, daemon=True,
                         name="cpu-sampler").start()

    # --- память ---------------------------------------------------------- #
    @staticmethod
    def _read_meminfo():
        info = {}
        try:
            with open("/proc/meminfo", "r", encoding="ascii") as fh:
                for line in fh:
                    key, _, rest = line.partition(":")
                    info[key.strip()] = rest.strip()
        except OSError:
            return None
        try:
            total = int(info.get("MemTotal", "0").split()[0])
        except (ValueError, IndexError):
            return None
        if total <= 0:
            return None
        # MemAvailable есть во всех современных ядрах; запасной вариант
        if "MemAvailable" in info:
            try:
                available = int(info["MemAvailable"].split()[0])
            except (ValueError, IndexError):
                available = None
        else:
            available = None
        if available is None:
            free = 0
            for key in ("MemFree", "Buffers", "Cached"):
                if key in info:
                    try:
                        free += int(info[key].split()[0])
                    except (ValueError, IndexError):
                        pass
            available = free
        used = max(0, total - available)
        return {
            "used_percent": round(used / total * 100.0, 1),
            "total_gb": round(total * 1024.0 / (1024.0 ** 3), 1),
        }

    # --- диск ------------------------------------------------------------ #
    @staticmethod
    def _read_disk(path="/"):
        try:
            st = os.statvfs(path)
        except OSError:
            return None
        total = st.f_blocks * st.f_frsize
        if total <= 0:
            return None
        free = st.f_bavail * st.f_frsize  # доступно непривилегированным
        used = total - free
        return {
            "used_percent": round(used / total * 100.0, 1),
            "total_gb": round(total / MIB, 1),
        }

    # --- аптайм ---------------------------------------------------------- #
    @staticmethod
    def _read_uptime():
        try:
            with open("/proc/uptime", "r", encoding="ascii") as fh:
                seconds = float(fh.read().split()[0])
        except (OSError, ValueError, IndexError):
            return None
        seconds = int(seconds)
        days, rem = divmod(seconds, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, _ = divmod(rem, 60)
        if days:
            return "%dd %dh %dm" % (days, hours, minutes)
        if hours:
            return "%dh %dm" % (hours, minutes)
        return "%dm" % minutes

    # --- сводка ---------------------------------------------------------- #
    def snapshot(self):
        with self._lock:
            cpu = self._cpu_percent

        mem = self._read_meminfo()
        disk = self._read_disk()

        try:
            load1 = round(os.getloadavg()[0], 2)
        except OSError:
            load1 = None

        info = system_info()
        return {
            # статичное (для команды fetch в терминале панели)
            "sysname": info["sysname"],
            "host": info["host"],
            "os": info["os"],
            "kernel": info["kernel"],
            "machine": info["machine"],
            # метрики
            "cpu": cpu,
            "load1": load1,
            "cores": os.cpu_count() or 1,
            "mem_used": mem["used_percent"] if mem else None,
            "mem_total_gb": mem["total_gb"] if mem else None,
            "disk_used": disk["used_percent"] if disk else None,
            "disk_total_gb": disk["total_gb"] if disk else None,
            "disks": read_disks(),
            "raid": read_raid(),
            "uptime": self._read_uptime(),
            "ts": int(time.time()),
        }


# --------------------------------------------------------------------------- #
#  Диски и RAID
# --------------------------------------------------------------------------- #
PSEUDO_FS = {
    "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2",
    "pstore", "bpf", "autofs", "mqueue", "hugetlbfs", "securityfs",
    "debugfs", "tracefs", "configfs", "fusectl", "binfmt_misc", "rpc_pipefs",
    "nsfs", "ramfs", "efivarfs", "selinuxfs", "squashfs", "fuse.portal",
    "fuse.gvfsd-fuse", "overlay", "nfsd", "bdev", "pipefs",
}
# Монтирования в этих путях — системные, их в панели не показываем
SKIP_PREFIX = ("/proc", "/sys", "/dev", "/run", "/snap", "/var/lib/docker")


def disk_usage(path):
    """Занято/свободно на точке монтирования. None — если не посчитать."""
    try:
        st = os.statvfs(path)
    except OSError:
        return None
    total = st.f_blocks * st.f_frsize
    if total <= 0:
        return None
    free = st.f_bfree * st.f_frsize       # включая резерв root'а
    avail = st.f_bavail * st.f_frsize     # доступно непривилегированным
    used = total - free
    return {
        "used": round(used / total * 100.0, 1),
        "total_gb": round(total / MIB, 1),
        "free_gb": round(avail / MIB, 1),
    }


def read_disks(limit=8):
    """Все смонтированные настоящие ФС (без tmpfs/proc/…), '/' всегда первый."""
    try:
        with open("/proc/mounts", "r", encoding="utf-8", errors="replace") as fh:
            raw = [ln.split() for ln in fh if ln.strip()]
    except OSError:
        raw = []

    out, seen = [], set()
    for parts in raw:
        if len(parts) < 3:
            continue
        src, dst, fstype = parts[0], parts[1], parts[2]
        dst = dst.replace("\\040", " ").replace("\\011", "\t")
        if dst == "/":
            pass                                   # корень показываем всегда
        elif fstype in PSEUDO_FS or fstype in ("swap", "none", ""):
            continue
        elif dst.startswith(SKIP_PREFIX):
            continue

        key = src if src.startswith("/dev/") else "mount:" + dst
        if key in seen:
            continue                               # bind-монты того же тома

        info = disk_usage(dst)
        if not info:
            continue
        seen.add(key)

        device = src[5:] if src.startswith("/dev/") else src
        out.append({
            "mount": dst,
            "device": device,
            "device_full": src,
            "fstype": fstype,
            "used": info["used"],
            "total_gb": info["total_gb"],
            "free_gb": info["free_gb"],
        })

    out.sort(key=lambda r: (r["mount"] != "/", r["mount"]))
    return out[:limit]


def block_size_gb(name):
    """Размер блочного устройства (sda, sda1, nvme0n1p2) в ГБ из sysfs."""
    try:
        with open("/sys/class/block/%s/size" % name, "r", encoding="ascii") as fh:
            sectors = int(fh.read().strip())
    except (OSError, ValueError):
        return None
    return round(sectors * 512.0 / MIB, 1)


# /proc/mdstat разбираем вручную — это просто текст:
#   md0 : active raid1 sdb1[1] sda1[0]
#         1953382416 blocks super 1.2 [2/2] [UU]
#         [>... ] recovery = 1.2% (…) finish=… speed=…
_MD_HDR = re.compile(r"^(\w+)\s*:\s*(active|inactive)\b(.*)$")
_MD_COMP = re.compile(r"([A-Za-z0-9_.+-]+)\[\d+\](?:\(([A-Za-z])\))?")
_MD_PAIR = re.compile(r"\[(\d+)/(\d+)\]")
_MD_STATE = re.compile(r"\[((?:U|_)+)\]")
_MD_PROGRESS = re.compile(
    r"(recovery|resync|reshape|check|repair)\s*=\s*([0-9.]+)%")
_MD_BLOCKS = re.compile(r"(\d+)\s+blocks")


def read_raid():
    """Все массивы из /proc/mdstat. Пусто — если mdraid не используется."""
    try:
        with open("/proc/mdstat", "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return []

    arrays = []
    i = 0
    while i < len(lines):
        head = _MD_HDR.match(lines[i].strip())
        if not head:
            i += 1
            continue

        name, state, rest = head.group(1), head.group(2), head.group(3)
        block = [lines[i]]
        j = i + 1
        # продолжение записи в /proc/mdstat всегда с отступом
        while j < len(lines) and lines[j][:1] in (" ", "\t"):
            block.append(lines[j])
            j += 1
        i = j
        text = "\n".join(block)

        comps = _MD_COMP.findall(rest)
        first = _MD_COMP.search(rest)
        level = ""
        if first:
            words = [w for w in rest[:first.start()].split()
                     if not w.startswith("(")]
            if words:
                level = words[-1]

        lvl = _MD_PAIR.search(text)
        stt = _MD_STATE.search(text)
        prg = _MD_PROGRESS.search(text)

        failed = [c for c, f in comps if f == "F"]
        spare = [c for c, f in comps if f == "S"]
        if stt:
            online = stt.group(1).count("U")
            total = int(lvl.group(2)) if lvl else len(stt.group(1))
        else:
            online = len(comps) - len(failed)
            total = int(lvl.group(2)) if lvl else len(comps)

        if state != "active":
            status = "inactive"
        elif prg:
            status = "%s %s%%" % (prg.group(1), prg.group(2))
        elif failed or (stt and "_" in stt.group(1)):
            status = "degraded"
        else:
            status = "clean"

        blocks = None
        bm = _MD_BLOCKS.search(text)
        if bm:
            blocks = int(bm.group(1))          # в /proc/mdstat это килобайты

        arrays.append({
            "name": name,
            "level": level or "md",
            "state": status,
            "online": online,
            "total": total,
            "status": stt.group(1) if stt else "",
            "size_gb": round(blocks * 1024.0 / MIB, 1) if blocks else None,
            "components": [
                {"device": c,
                 "flag": "failed" if f == "F" else ("spare" if f == "S" else "ok"),
                 "size_gb": block_size_gb(c)}
                for c, f in comps
            ],
        })

    return arrays


def list_pics(pics_dir):
    """Имена файлов в pics/ для клиентского выбора (в т.ч. случайного).
    Только верхний уровень, без скрытых файлов и симлинков наружу."""
    out = {"images": [], "art": []}
    if not pics_dir:
        return out
    root = os.path.realpath(pics_dir)
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for name in names:
        if name.startswith("."):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in SERVE_EXTS:
            continue
        target = os.path.realpath(os.path.join(root, name))
        if not target.startswith(root + os.sep) or not os.path.isfile(target):
            continue
        (out["images"] if ext in PIC_EXTS else out["art"]).append(name)
    return out


def list_music(music_dir):
    """Имена аудиофайлов в music/ (только верхний уровень, без скрытых)."""
    out = []
    if not music_dir:
        return out
    root = os.path.realpath(music_dir)
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for name in names:
        if name.startswith("."):
            continue
        if os.path.splitext(name)[1].lower() not in AUDIO_EXTS:
            continue
        target = os.path.realpath(os.path.join(root, name))
        if not target.startswith(root + os.sep) or not os.path.isfile(target):
            continue
        out.append(name)
    return out


def list_skins(skins_dir):
    """Имена скинов (.wsz/.zip) в skins/ — для выпадающего списка на странице.
    Только верхний уровень, без скрытых файлов и симлинков наружу."""
    out = []
    if not skins_dir:
        return out
    root = os.path.realpath(skins_dir)
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for name in names:
        if name.startswith("."):
            continue
        if os.path.splitext(name)[1].lower() not in SKIN_EXTS:
            continue
        target = os.path.realpath(os.path.join(root, name))
        if not target.startswith(root + os.sep) or not os.path.isfile(target):
            continue
        out.append(name)
    return out


# --- шрифты, установленные в системе ---------------------------------------
# Панель берёт шрифт и из конфига, и из системы. В Linux за системные
# шрифты отвечает fontconfig: `fc-list --format='%{family}\n'` отдаёт все
# установленные семейства за пару миллисекунд. Если утилиты нет
# (минимальный дистрибутив, контейнер, NAS, Windows) — обходим обычные
# шрифтовые папки и читаем имя семейства прямо из таблицы name файла
# TTF/OTF: библиотек не нужно, формат открытый и стабильный с1990-х.
FONT_DIRS = (
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    os.path.join(os.environ.get("XDG_DATA_HOME")
                 or os.path.expanduser("~/.local/share"), "fonts"),
    os.path.expanduser("~/.fonts"),
)
FONT_EXTS = (".ttf", ".otf", ".ttc", ".otc")
FONT_CACHE_TTL = 300        # секунд: шрифты ставят редко
_FONT_CACHE = {"at": 0.0, "data": None}


def _u16be(buf, i):
    return (buf[i] << 8) | buf[i + 1]


def _u32be(buf, i):
    return (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]


def font_family_of(path):
    """Семейство шрифта из таблицы name файла TTF/OTF/TTC, либо None.

    Читаются только заголовок, таблица таблиц и сама name — файл целиком
    в память не попадает (шрифт может весить десятки мегабайт)."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(12)
            if len(head) < 12:
                return None
            if head[:4] == b"ttcf":                 # коллекция: первый шрифт
                fh.seek(_u32be(head, 8))
                head = fh.read(12)
                if len(head) < 12:
                    return None
            if head[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
                return None                        # wOFF и прочее не читаем
            tables = _u16be(head, 4)
            if not 0 < tables <= 4096:
                return None
            blob = fh.read(tables * 16)
            if len(blob) < tables * 16:
                return None
            name_off = name_len = 0
            for i in range(tables):
                o = i * 16
                if blob[o:o + 4] == b"name":
                    name_off, name_len = _u32be(blob, o + 8), _u32be(blob, o + 12)
                    break
            if not name_off or not name_len or name_len > 1 << 20:
                return None
            fh.seek(name_off)
            data = fh.read(name_len)
            if len(data) < 6:
                return None
            count, str_off = _u16be(data, 2), _u16be(data, 4)
            best = None                             # (приоритет, имя)
            for i in range(count):
                o = 6 + i * 12
                if o + 12 > len(data):
                    break
                platform = _u16be(data, o)
                name_id = _u16be(data, o + 6)
                length, offset = _u16be(data, o + 8), _u16be(data, o + 10)
                if name_id not in (1, 16):          # 16 — «typographic family»
                    continue
                start = str_off + offset
                if start + length > len(data):
                    continue
                raw = data[start:start + length]
                if platform in (0, 3):              # Unicode / Windows: UTF-16BE
                    try:
                        text = raw.decode("utf-16-be")
                    except UnicodeDecodeError:
                        continue
                elif platform == 1:                 # Mac Roman
                    text = raw.decode("mac_roman", "replace")
                else:
                    continue
                text = text.strip()
                if text and (best is None or name_id == 16):
                    best = (name_id, text)
            return best[1] if best else None
    except OSError:
        return None


def list_fonts():
    """Семейства шрифтов, установленных в системе.

    Сначала пробуем fontconfig (fc-list) — он видит и системные папки, и
    пользовательские, и свои настройки. Нет утилиты — обходим FONT_DIRS и
    разбираем файлы сами. Результат кэшируется на FONT_CACHE_TTL секунд:
    шрифты меняются редко, а запрос к странице не должен ждать."""
    now = time.time()
    cached = _FONT_CACHE["data"]
    if cached is not None and now - _FONT_CACHE["at"] < FONT_CACHE_TTL:
        return cached
    families, source = set(), "scan"
    try:
        proc = subprocess.run(
            ["fc-list", "--format=%{family}\n"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=10, check=False)
        if proc.returncode == 0:
            for line in proc.stdout.decode("utf-8", "replace").splitlines():
                for family in line.split(","):      # у одного файла бывает
                    family = family.strip()         # несколько семейств
                    if family:
                        families.add(family)
            source = "fontconfig"
    except (OSError, subprocess.SubprocessError):
        pass
    if source != "fontconfig":
        for directory in FONT_DIRS:
            for root, _dirs, files in os.walk(directory):
                for name in sorted(files):
                    if len(families) > 5000:        # защита от чужих папок
                        break
                    if os.path.splitext(name)[1].lower() not in FONT_EXTS:
                        continue
                    family = font_family_of(os.path.join(root, name))
                    if family:
                        families.add(family)
    data = {"families": sorted(families, key=str.lower), "source": source}
    _FONT_CACHE.update(at=now, data=data)
    return data


# --------------------------------------------------------------------------- #
#  HTTP
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
#  Сеть для окна Network и команды ss: счётчики трафика (/proc/net/dev)
#  и слушающие порты (/proc/net/tcp, /proc/net/tcp6). Только чтение /proc.
# --------------------------------------------------------------------------- #
def _ipv4_hex(hexaddr):
    """8 hex-символов -> dotted-quad: байты в /proc лежат little-endian."""
    return ".".join(str(int(hexaddr[i:i + 2], 16)) for i in (6, 4, 2, 0))


def _ipv6_hex(hexaddr):
    """32 hex-символа -> IPv6: ядро печатает адрес по 32-битным словам,
    байты внутри слова — little-endian; inet_ntop сам сожмёт ::."""
    raw = bytearray()
    for i in range(0, 32, 8):
        word = hexaddr[i:i + 8]
        raw += bytes(int(word[j:j + 2], 16) for j in (6, 4, 2, 0))
    return socket.inet_ntop(socket.AF_INET6, bytes(raw))


def net_snapshot():
    """Один снимок сети: {ifaces:[{name,rx,tx}], ports:[...], ts}.
    Счётчики — суммарные байты с загрузки; скорость между двумя
    снимками считает клиент (app.js), здесь только сырьё."""
    ifaces = []
    try:
        with open("/proc/net/dev", encoding="ascii") as fh:
            for line in fh:
                if ":" not in line:
                    continue
                name, rest = line.split(":", 1)
                fields = rest.split()
                if len(fields) < 16:
                    continue
                ifaces.append({"name": name.strip(),
                               "rx": int(fields[0]), "tx": int(fields[8])})
    except OSError:
        pass                      # /proc/net/dev нет — панель покажет «—»
    ports = []
    for fname, proto in (("/proc/net/tcp", "tcp"),
                         ("/proc/net/tcp6", "tcp6")):
        try:
            with open(fname, encoding="ascii") as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        for line in lines[1:]:     # нулевая строка — заголовок колонок
            fields = line.split()
            if len(fields) < 4 or fields[3] != "0A":   # 0A = TCP_LISTEN
                continue
            addr, _sep, hexport = fields[1].rpartition(":")
            try:
                port = int(hexport, 16)
                ip = _ipv6_hex(addr) if proto == "tcp6" else _ipv4_hex(addr)
            except (ValueError, IndexError):
                continue           # битая строка — пропускаем, падать нечего
            ports.append({"proto": proto, "addr": ip, "port": port})
    ports.sort(key=lambda p: (p["port"], p["proto"]))
    return {"ifaces": ifaces, "ports": ports, "ts": int(time.time())}


# --------------------------------------------------------------------------- #
#  Загрузки Download Manager (окно и команда wget): реестр задач + фоновые
#  потоки urllib. Имя файла — только basename из URL, опасные символы
#  заменяются; готовый файл появляется атомарно (tmp -> os.replace).
# --------------------------------------------------------------------------- #
def _dl_unlink(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _dl_name(url, taken):
    """Имя файла из URL; коллизии (на диске или в реестре) -> name (1).ext."""
    name = os.path.basename(unquote(urlparse(url).path)) or "download"
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name).lstrip(".") or "download"
    if len(name) > 120:
        name = name[-120:]
    base, ext = os.path.splitext(name)
    n = 1
    while True:
        cand = name if n == 1 else "%s (%d)%s" % (base, n, ext)
        if cand not in taken and not os.path.exists(
                os.path.join(DOWNLOADS_DIR, cand)):
            return cand
        n += 1


def _dl_run(job):
    """Фоновый поток одной загрузки: читает URL блоками по 64 КБ,
    проверяет флаг cancel на каждом блоке, в конце — атомарный rename."""
    part = job["file"] + ".part"
    try:
        req = urllib.request.Request(
            job["url"], headers={"User-Agent": "NerevarHub/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            total = resp.headers.get("Content-Length")
            job["total"] = int(total) if total and total.isdigit() else -1
            with open(part, "wb") as fh:
                while True:
                    if job.get("cancel"):
                        raise InterruptedError("cancelled")
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    fh.write(chunk)
                    job["got"] += len(chunk)
        os.replace(part, job["file"])
        job["status"] = "done"
    except InterruptedError:
        job["status"] = "cancelled"
        _dl_unlink(part)
    except Exception as exc:       # сеть, диск, 404 — всё видно в статусе
        job["status"] = "failed"
        job["error"] = str(exc) or exc.__class__.__name__
        _dl_unlink(part)
    finally:
        if job.get("drop"):        # remove пришёл раньше конца — убрать строку
            with DOWNLOADS_LOCK:
                DOWNLOADS.pop(job["id"], None)


def dl_start(url):
    """Ставит загрузку в реестр и запускает поток; возвращает карточку."""
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    with DOWNLOADS_LOCK:
        taken = {j["name"] for j in DOWNLOADS.values()}
        name = _dl_name(url, taken)
        DOWNLOAD_SEQ[0] += 1
        job = {"id": DOWNLOAD_SEQ[0], "url": url, "name": name,
               "file": os.path.join(DOWNLOADS_DIR, name),
               "got": 0, "total": -1, "status": "running", "error": "",
               "started": time.time(), "cancel": False, "drop": False}
        DOWNLOADS[job["id"]] = job
    threading.Thread(target=_dl_run, args=(job,), daemon=True).start()
    return job


def dl_list():
    """Список задач для GET /api/downloads: только поля, нужные панели."""
    with DOWNLOADS_LOCK:
        jobs = [{"id": j["id"], "url": j["url"], "name": j["name"],
                 "got": j["got"], "total": j["total"],
                 "status": j["status"], "error": j["error"],
                 "started": j["started"]}
                for j in sorted(DOWNLOADS.values(),
                                key=lambda x: x["started"])]
    return {"dir": os.path.basename(DOWNLOADS_DIR), "jobs": jobs}


def dl_control(jid, action):
    """cancel — попросить поток остановиться; remove — убрать строку
    из списка (рабочую загрузку сначала cancel+drop, файл .part — в мусор,
    готовый файл остаётся в downloads/). Неизвестный id -> None."""
    with DOWNLOADS_LOCK:
        job = DOWNLOADS.get(jid)
    if job is None:
        return None
    if action == "cancel":
        if job["status"] == "running":
            job["cancel"] = True
    elif job["status"] == "running":
        job["cancel"] = True       # дать потоку дойти до конца и уйти сам
        job["drop"] = True
    else:
        with DOWNLOADS_LOCK:
            DOWNLOADS.pop(jid, None)
        _dl_unlink(job["file"] + ".part")
    return {"id": job["id"], "status": job["status"]}


def make_handler(index_path, metrics, allow_cors, pics_dir=None, music_dir=None,
                 skins_dir=None, config_path=None, app_path=None,
                 openstep_path=None, dock_path=None):
    class HubHandler(BaseHTTPRequestHandler):
        server_version = "NerevarHub/1.0"

        def log_message(self, fmt, *args):
            # пишем в stdout — systemd/journald подхватят.
            # Префикс с именем файла и PID: видно, какому процессу
            # принадлежит строка и какой номер убивать (kill <pid>).
            sys.stdout.write("[%s pid=%d] %s - %s\n"
                             % (PROC_NAME, PID, self.address_string(), fmt % args))
            sys.stdout.flush()

        def do_HEAD(self):
            # те же заголовки, что и у GET, только тело не отдаём —
            # так работает curl -I и разные проверки доступности
            self._head_only = True
            try:
                self.do_GET()
            finally:
                self._head_only = False

        def _send(self, code, body, content_type, extra=None):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            if allow_cors:
                self.send_header("Access-Control-Allow-Origin", "*")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if not getattr(self, "_head_only", False):
                self.wfile.write(data)

        def _telegram_proxy(self, method):
            """GET/HEAD/POST /tg/... -> TG_UPSTREAM/... (см. шапку файла)."""
            raw_path, _, query = self.path.partition("?")
            rest = raw_path[3:]                   # "/..." (у /tg — пусто)
            if not rest.startswith("/"):
                rest = "/" + rest
            # хост берётся только из TG_UPSTREAM, rest — путь и queryString
            upstream = TG_UPSTREAM + rest + ("?" + query if query else "")
            headers = {}
            for name in ("User-Agent", "Accept", "Accept-Language",
                         "Content-Type", "Cookie", "Range",
                         "If-None-Match", "If-Modified-Since"):
                value = self.headers.get(name)
                if value:
                    headers[name] = value
            body = None
            if method == "POST":
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    length = 0
                if length > TG_POST_MAX:
                    self._send(413, "telegram payload too big",
                               "text/plain; charset=utf-8")
                    return
                if length:
                    body = self.rfile.read(length)
            request = urllib.request.Request(upstream, data=body,
                                             headers=headers, method=method)
            try:
                resp = TG_OPENER.open(request, timeout=TG_TIMEOUT)
            except urllib.error.HTTPError as exc:
                resp = exc                    # 3xx/206/4xx — это тоже ответ
            except (urllib.error.URLError, OSError) as exc:
                # апстрим недоступен (нет сети/DNS) — аккуратная страница
                # вместо пустого iframe
                self._send(502, "telegram upstream is unreachable: %s" % exc,
                           "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"})
                return
            try:
                payload = b"" if method == "HEAD" else resp.read()
                code = (getattr(resp, "status", None)
                        or getattr(resp, "code", None) or resp.getcode())
                hdrs = getattr(resp, "headers", None) or resp.hdrs
                items = list(hdrs.items())
            finally:
                resp.close()

            def rewrite(location):
                # редирект ведём обратно в прокси, чужой хост — наружу
                absolute = urllib.parse.urljoin(upstream, location)
                parts = urllib.parse.urlsplit(absolute)
                host = urllib.parse.urlsplit(TG_UPSTREAM).hostname
                if parts.hostname == host:
                    return "/tg" + (parts.path or "/") + (
                        "?" + parts.query if parts.query else "")
                return absolute

            extra = {}
            content_type = "application/octet-stream"
            for name, value in items:
                low = name.lower()
                if low in TG_DROP_HEADERS:
                    continue
                if low == "location":
                    value = rewrite(value)
                elif low == "content-type":
                    content_type = value
                    continue
                # повторяющиеся заголовки (несколько Set-Cookie) схлопываются
                extra[name] = value
            self._send(code, payload, content_type, extra)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/tg" or path.startswith("/tg/"):
                self._telegram_proxy("GET")
                return
            if path in ("/", "/index.html"):
                try:
                    with open(index_path, "rb") as fh:
                        page = fh.read()
                except OSError as exc:
                    self._send(500, "cannot read index.html: %s" % exc,
                               "text/plain; charset=utf-8")
                    return
                self._send(200, page, "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/config.js":
                # настройки панели — без кэша, чтобы правки в config.js
                # подхватывались сразу после F5
                if not config_path:
                    self._send(404, "not found", "text/plain; charset=utf-8")
                    return
                try:
                    with open(config_path, "rb") as fh:
                        page = fh.read()
                except OSError as exc:
                    self._send(404, "config.js not available: %s" % exc,
                               "text/plain; charset=utf-8")
                    return
                self._send(200, page, "application/javascript; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/app.js":
                # логика панели — без кэша, чтобы правки app.js
                # подхватывались сразу после F5 (как в config.js)
                if not app_path:
                    self._send(404, "not found", "text/plain; charset=utf-8")
                    return
                try:
                    with open(app_path, "rb") as fh:
                        page = fh.read()
                except OSError as exc:
                    self._send(404, "app.js not available: %s" % exc,
                               "text/plain; charset=utf-8")
                    return
                self._send(200, page, "application/javascript; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/openstep.html":
                # альтернативный вид панели (скин NeXTSTEP/WindowMaker) —
                # файл-загрузчик, без кэша, как config.js и app.js
                if not openstep_path:
                    self._send(404, "not found", "text/plain; charset=utf-8")
                    return
                try:
                    with open(openstep_path, "rb") as fh:
                        page = fh.read()
                except OSError as exc:
                    self._send(404, "openstep.html not available: %s" % exc,
                               "text/plain; charset=utf-8")
                    return
                self._send(200, page, "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/dock.json":
                # иконки дока скина WindowMaker: обычный JSON, без кэша
                if not dock_path:
                    self._send(404, "not found", "text/plain; charset=utf-8")
                    return
                try:
                    with open(dock_path, "rb") as fh:
                        page = fh.read()
                except OSError as exc:
                    self._send(404, "dock.json not available: %s" % exc,
                               "text/plain; charset=utf-8")
                    return
                self._send(200, page, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/stats":
                payload = json.dumps(metrics.snapshot())
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/pics":
                payload = json.dumps(list_pics(pics_dir))
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/music":
                payload = json.dumps({"tracks": list_music(music_dir)})
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/skins":
                payload = json.dumps({"skins": list_skins(skins_dir)})
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/fonts":
                # какие шрифты есть в системе — для View → Font…
                payload = json.dumps(list_fonts())
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/layout":
                # раскладка окон: нет файла — 404 (панель встанет по умолчанию)
                try:
                    with open(LAYOUT_PATH, "rb") as fh:
                        payload = fh.read()
                except OSError:
                    self._send(404, "no saved layout",
                               "text/plain; charset=utf-8")
                    return
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/balance":
                # банк в блэкджеке: нет файла — 404 (панель даст стартовую
                # сумму из config.js и запишет её при первом расчёте)
                try:
                    with open(BALANCE_PATH, "rb") as fh:
                        payload = fh.read()
                except OSError:
                    self._send(404, "no saved balance",
                               "text/plain; charset=utf-8")
                    return
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/network":
                # сеть для окна Network и команды ss: счётчики /proc/net/dev
                # плюс LISTEN-сокеты из /proc/net/tcp и /proc/net/tcp6
                payload = json.dumps(net_snapshot())
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/api/downloads":
                # список загрузок Download Manager (реестр живёт в памяти
                # процесса и переживает только текущий запуск сервера)
                payload = json.dumps(dl_list())
                self._send(200, payload, "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})
            elif path == "/favicon.ico":
                self._send(204, b"", "image/x-icon")
            elif path.startswith("/pics/"):
                self._serve_static(pics_dir, "/pics/", SERVE_EXTS, path, "pics")
            elif path.startswith("/music/"):
                self._serve_static(music_dir, "/music/", AUDIO_EXTS, path, "music")
            elif path.startswith("/skins/"):
                self._serve_static(skins_dir, "/skins/", SKIN_EXTS, path, "skins")
            elif path.startswith("/downloads/"):
                # скачанные файлы — только как вложение: даже HTML-страница,
                # скачанная по ссылке, сохранится, а не выполнится рядом
                # с панелью. Листинга каталога нет (каталоги -> 404).
                self._serve_static(DOWNLOADS_DIR, "/downloads/", None, path,
                                   "downloads",
                                   extra={"Content-Disposition": "attachment"})
            else:
                self._send(404, "not found", "text/plain; charset=utf-8")

        # --- сохранение: раскладка окон и банк в блэкджеке ------------- #
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path == "/tg" or path.startswith("/tg/"):
                self._telegram_proxy("POST")
                return
            if path in ("/api/downloads", "/api/downloads/control"):
                self._post_downloads(path)
                return
            is_balance = path == "/api/balance"
            if path != "/api/layout" and not is_balance:
                self._send(404, "not found", "text/plain; charset=utf-8")
                return
            target = BALANCE_PATH if is_balance else LAYOUT_PATH
            limit = BALANCE_MAX if is_balance else LAYOUT_MAX
            label = "balance" if is_balance else "layout"
            lock = BALANCE_LOCK if is_balance else LAYOUT_LOCK
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                self._send(400, "empty body", "text/plain; charset=utf-8")
                return
            if length > limit:
                # панель шлёт объект до 64 КБ — больше не бывает
                self._send(413, "%s too big (max %d bytes)" % (label, limit),
                           "text/plain; charset=utf-8")
                return
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self._send(400, "invalid JSON", "text/plain; charset=utf-8")
                return
            if not isinstance(data, dict):
                self._send(400, "JSON object expected",
                           "text/plain; charset=utf-8")
                return
            if is_balance:
                # банк в блэкджеке: ровно одно целое число, без сюрпризов
                bank = data.get("balance")
                if isinstance(bank, bool) or not isinstance(bank, int) \
                        or not 0 <= bank <= 10 ** 9:
                    self._send(400, "balance must be an integer 0..1000000000",
                               "text/plain; charset=utf-8")
                    return
                payload = json.dumps({"balance": bank}).encode("utf-8")
            else:
                payload = json.dumps(data).encode("utf-8")
            # переписываем через tmp + os.replace: читатели в другой вкладке
            # всегда получат либо старый, либо новый файл, никогда — обрывок
            tmp_path = target + ".tmp"
            try:
                with lock:
                    with open(tmp_path, "wb") as fh:
                        fh.write(payload)
                    os.replace(tmp_path, target)
            except OSError as exc:
                self.log_message("%s: не записать: %s", label, exc)
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                self._send(500, "cannot save %s: %s" % (label, exc),
                           "text/plain; charset=utf-8")
                return
            self._send(200, '{"ok":true}', "application/json; charset=utf-8",
                       {"Cache-Control": "no-store"})

        def _post_downloads(self, path):
            """POST /api/downloads — поставить URL на скачивание;
            POST /api/downloads/control — cancel/remove задачи по id."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                return self._send(400, "empty body",
                                  "text/plain; charset=utf-8")
            if length > 16 * 1024:
                return self._send(413, "body too big (max 16384 bytes)",
                                  "text/plain; charset=utf-8")
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return self._send(400, "invalid JSON",
                                  "text/plain; charset=utf-8")
            if not isinstance(data, dict):
                return self._send(400, "JSON object expected",
                                  "text/plain; charset=utf-8")

            def done(payload):
                self._send(200, json.dumps(payload),
                           "application/json; charset=utf-8",
                           {"Cache-Control": "no-store"})

            if path == "/api/downloads":
                url = data.get("url")
                if not isinstance(url, str) or not url.strip():
                    return self._send(400, "url is required",
                                      "text/plain; charset=utf-8")
                url = url.strip()
                # панель — домашний LAN-инструмент, но чужие схемы не качаем:
                # file:// читал бы локальные файлы сервера, ftp — лишнее
                if urlparse(url).scheme.lower() not in ("http", "https"):
                    return self._send(400, "only http:// and https:// URLs",
                                      "text/plain; charset=utf-8")
                try:
                    job = dl_start(url)
                except OSError as exc:
                    self.log_message("downloads: cannot start: %s", exc)
                    return self._send(500, "cannot start download: %s" % exc,
                                      "text/plain; charset=utf-8")
                return done({"id": job["id"], "name": job["name"],
                             "dir": os.path.basename(DOWNLOADS_DIR)})
            jid = data.get("id")
            action = data.get("action")
            if isinstance(jid, bool) or not isinstance(jid, int):
                return self._send(400, "id must be an integer",
                                  "text/plain; charset=utf-8")
            if action not in ("cancel", "remove"):
                return self._send(400, "action must be cancel or remove",
                                  "text/plain; charset=utf-8")
            result = dl_control(jid, action)
            if result is None:
                return self._send(404, "no such download",
                                  "text/plain; charset=utf-8")
            return done(result)

        def do_DELETE(self):
            path = self.path.split("?", 1)[0]
            if path != "/api/layout":
                self._send(404, "not found", "text/plain; charset=utf-8")
                return
            try:
                with LAYOUT_LOCK:
                    if os.path.exists(LAYOUT_PATH):
                        os.remove(LAYOUT_PATH)
            except OSError as exc:
                self._send(500, "cannot reset layout: %s" % exc,
                           "text/plain; charset=utf-8")
                return
            # сброс идемпотентен: файла и так нет — это тоже успех
            self._send(200, '{"ok":true}', "application/json; charset=utf-8",
                       {"Cache-Control": "no-store"})

        def do_OPTIONS(self):
            # preflight для --cors (запросы с file:// и чужого origin)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods",
                             "GET, HEAD, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            if allow_cors:
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", "0")
            self.end_headers()

        # --- статика из папок pics/, music/ и skins/ ------------------ #
        def _send_file(self, target, ctype, extra=None):
            """Отдаёт файл целиком или куском (Range). Без Range нельзя
            перематывать аудио: браузер запрашивает байтовые диапазоны."""
            try:
                size = os.path.getsize(target)
                fh = open(target, "rb")
            except OSError as exc:
                self.log_message("file: не открыть %s: %s", target, exc)
                return self._send(404, "not found", "text/plain; charset=utf-8")

            start, end, status = 0, max(0, size - 1), 200
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
                if m and (m.group(1) or m.group(2)):
                    if m.group(1):
                        start = int(m.group(1))
                        if m.group(2):
                            end = min(int(m.group(2)), size - 1)
                    else:
                        start = max(0, size - int(m.group(2)))
                    if start > end or start >= size:
                        fh.close()
                        self.send_response(416)
                        self.send_header("Content-Range", "bytes */%d" % size)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    status = 206

            length = end - start + 1
            try:
                with fh:
                    self.send_response(status)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(length))
                    self.send_header("Accept-Ranges", "bytes")
                    if status == 206:
                        self.send_header("Content-Range",
                                         "bytes %d-%d/%d" % (start, end, size))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    if ctype not in SAFE_TYPES:
                        # svg может исполнять скрипты в своём origin —
                        # запрещаем их, картинка при этом остаётся картинкой
                        self.send_header(
                            "Content-Security-Policy",
                            "default-src 'none'; style-src 'unsafe-inline'")
                    if allow_cors:
                        self.send_header("Access-Control-Allow-Origin", "*")
                    for key, value in (extra or {}).items():
                        self.send_header(key, value)
                    self.end_headers()
                    if getattr(self, "_head_only", False):
                        return
                    fh.seek(start)
                    left = length
                    while left > 0:
                        chunk = fh.read(min(65536, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass                            # клиент закрыл вкладку

        def _serve_static(self, root_dir, prefix, exts, url_path, kind,
                          extra=None):
            """Отдаёт файл из папки. Главное — не выйти за папку: сначала
            склеиваем путь, потом нормализуем через realpath и сверяем с
            реальным адресом папки — так отсекаются ../, абсолютные пути
            и симлинки наружу."""
            def deny(reason=None):
                if reason:
                    self.log_message("%s: %s", kind, reason)
                return self._send(404, "not found", "text/plain; charset=utf-8")

            if not root_dir:
                return deny()

            rel = unquote(url_path[len(prefix):])
            if not rel or "\x00" in rel:
                return deny("пустой путь")

            root = os.path.realpath(root_dir)
            target = os.path.realpath(os.path.join(root, rel))
            if target != root and not target.startswith(root + os.sep):
                return deny("путь вне папки, отказ: %s" % url_path)
            if target == root or not os.path.isfile(target):
                return deny("нет такого файла: %s" % rel)   # каталоги не отдаём

            ext = os.path.splitext(target)[1].lower()
            # exts=None — любое расширение (папка downloads/ отдаётся там
            # всегда с Content-Disposition: attachment)
            ctype = exts.get(ext) if exts else "application/octet-stream"
            if not ctype:
                return deny("расширение не из списка: %s" % target)

            self._send_file(target, ctype, extra)

    return HubHandler


# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(
        description="Nerevar Hub: web panel + system metrics")
    parser.add_argument("--host", default="0.0.0.0",
                        help="адрес привязки (по умолчанию 0.0.0.0)")
    parser.add_argument("--port", type=int, default=80,
                        help="порт (по умолчанию 80)")
    parser.add_argument("--cors", action="store_true",
                        help="добавить Access-Control-Allow-Origin: * "
                             "(нужно, только если открывать index.html "
                             "локально с file://)")
    parser.add_argument("--music-dir", default=MUSIC_DIR, metavar="PATH",
                        help="папка с музыкой для /music/ "
                             "(по умолчанию %s)" % MUSIC_DIR)
    parser.add_argument("--cpu-interval", type=float, default=1.0,
                        help="интервал замера CPU в секундах (по умолчанию 1)")
    parser.add_argument("--pidfile", default=DEFAULT_PIDFILE, metavar="PATH",
                        help="куда записать PID процесса (по умолчанию %s); "
                             "пустая строка отключает запись" % DEFAULT_PIDFILE)
    parser.add_argument("--no-pidfile", action="store_true",
                        help="не создавать pidfile вообще")
    args = parser.parse_args()

    if not os.path.isfile(INDEX_PATH):
        print("ОШИБКА: не найден index.html рядом с server.py: %s" % INDEX_PATH,
              file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(CONFIG_PATH):
        # панель не упадёт молча: index.html покажет синее окно с пояснением
        print("ВНИМАНИЕ: не найден config.js рядом с server.py: %s\n"
              "          панель покажет ошибку — верните файл на место"
              % CONFIG_PATH, file=sys.stderr)

    metrics = SystemMetrics(cpu_interval=max(0.2, args.cpu_interval))
    metrics.start()

    handler = make_handler(INDEX_PATH, metrics, args.cors, PICS_DIR,
                           args.music_dir, SKINS_DIR, CONFIG_PATH, APP_PATH,
                           OPENSTEP_PATH, DOCK_PATH)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True

    # --- pidfile: чтобы процесс было видно и его можно было убить ------------
    pid_path = None
    if not args.no_pidfile and args.pidfile:
        candidate = os.path.abspath(args.pidfile)
        try:
            with open(candidate, "w", encoding="ascii") as fh:
                fh.write("%d\n" % PID)
        except OSError as exc:
            print("  pidfile  : не записан (%s)" % exc)
        else:
            pid_path = candidate

    def remove_pidfile():
        if not pid_path:
            return
        try:
            with open(pid_path, "r", encoding="ascii") as fh:
                if fh.read().strip() != str(PID):
                    return  # в файле pid другого запуска — не трогаем чужое
            os.remove(pid_path)
        except OSError:
            pass

    def shutdown(signum, _frame):
        print("[%s pid=%d] получен сигнал %s — останавливаемся"
              % (PROC_NAME, PID, signum))
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print("[%s pid=%d] Nerevar Hub запущен: http://%s:%d"
          % (PROC_NAME, PID, args.host, args.port))
    print("  страница  : /")
    print("  настройки : /config.js -> %s%s"
          % (CONFIG_PATH, "" if os.path.isfile(CONFIG_PATH)
             else "  (файла пока нет!)"))
    print("  метрики   : /api/stats")
    print("  список    : /api/pics")
    print("  картинки  : /pics/  -> %s%s"
          % (PICS_DIR, "" if os.path.isdir(PICS_DIR) else "  (папки пока нет)"))
    print("  музыка    : /music/ -> %s%s"
          % (args.music_dir,
             "" if os.path.isdir(args.music_dir) else "  (папки пока нет)"))
    print("  треки     : /api/music")
    print("  скины     : /api/skins")
    print("  раскладка : /api/layout -> %s%s"
          % (LAYOUT_PATH, "" if os.path.isfile(LAYOUT_PATH)
             else "  (ещё не сохранялась)"))
    print("  банк      : /api/balance -> %s%s"
          % (BALANCE_PATH, "" if os.path.isfile(BALANCE_PATH)
             else "  (блэкджек ещё не игрался)"))
    print("  сеть      : /api/network")
    print("  загрузки  : /api/downloads -> %s%s"
          % (DOWNLOADS_DIR, "" if os.path.isdir(DOWNLOADS_DIR)
             else "  (папка создастся при первой загрузке)"))
    print("  скины     : /skins/  -> %s%s"
          % (SKINS_DIR, "" if os.path.isdir(SKINS_DIR) else "  (папки пока нет)"))
    print("  index     : %s" % INDEX_PATH)
    print("  логика    : %s%s"
          % (APP_PATH, "" if os.path.isfile(APP_PATH)
             else "  (нет app.js — панель не загрузится)"))
    print("  скин WM   : /openstep.html -> %s%s"
          % (OPENSTEP_PATH, "" if os.path.isfile(OPENSTEP_PATH)
             else "  (нет openstep.html — старый адрес скина не работает)"))
    print("  иконки дока: /dock.json -> %s%s"
          % (DOCK_PATH, "" if os.path.isfile(DOCK_PATH)
             else "  (нет dock.json — на плитках буквы)"))
    print("  остановить: kill %d" % PID)
    if pid_path:
        print("             kill $(cat %s)" % pid_path)
    sys.stdout.flush()

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        remove_pidfile()
        print("[%s pid=%d] остановлено" % (PROC_NAME, PID))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
