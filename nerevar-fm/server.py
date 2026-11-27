#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nerevar FM — веб-файловый менеджер: HTTP-панель + JSON API + FTP-сервер.

Один процесс поднимает два сервера с общим корнем файлов:
  * HTTP — панель (index.html / app.js / config.js) и JSON API
    файловых операций;
  * FTP  — загрузка и выкачивание файлов тем же корнем (реализован
    вручную, без pyftpdlib).

Статика (без авторизации, всегда Cache-Control: no-store):
  GET /            -> index.html
  GET /index.html  -> index.html
  GET /app.js      -> app.js
  GET /config.js   -> config.js
  GET /favicon.ico -> 204, пустое тело
  всё прочее (кроме /api/*) -> 404 text/plain "Not found"
  (файлов может ещё не быть — тогда 404, это нормально)

Аутентификация:
  POST /api/login {"password":"..."} -> {"token":"<32 hex>","ttl":604800}
      неверный пароль -> 401 {"error":"bad password"}
      неудач с одного IP за 300 с -> 429 {"error":"too many attempts"}
  токен живёт 7 дней, в памяти максимум 128 штук, протухшие чистятся
  ВСЕ прочие маршруты /api/* требуют токен: заголовок X-Auth-Token: <token>
  либо query-параметр ?token=<token> (нужен для <img src> и ссылок
  на скачивание); иначе 401 {"error":"unauthorized"}.
  /api/login принимает POST; на GET отвечает 405, а не падает.

JSON API (тело запроса — JSON-объект до 1 МБ, только POST; неверный
JSON -> 400 {"error":"..."}). Пути — КАК ПУТИ ВНУТРИ корня (--root):
клиентский "/a/b" превращается в os.path.abspath(os.path.join(ROOT,
"a/b")), результат обязан остаться внутри ROOT (выход через ../ или
симлинк наружу -> 403), ~ не расширяется. В ответах всегда отдаётся
КЛИЕНТСКИЙ путь (с "/"), а не путь на диске; при ROOT="/" поведение
как с абсолютными путями:
  GET  /api/status   -> {"root","ftp":{"enabled","port","user"},"ok"}
  GET  /api/list?path=/abs/dir
                    -> {"path","name","parent","entries":[...],"free","total"}
                        entries: папки потом файлы, внутри по имени без
                        учёта регистра; mtime — unix-time (int), size — байты
                        (для папок 0), mode вида "drwxr-xr-x", hidden —
                        имя начинается с точки (скрытые отдаются всегда,
                        фильтрует браузер); free/total — os.statvfs (null
                        при ошибке); нет пути -> 404; это файл -> 400
                        "not a directory"; нет прав -> 403; путь не
                        абсолютный -> 400
  POST /api/mkdir    {"path"}          -> {"ok","path"}; есть -> 409
  POST /api/newfile  {"path"}          -> {"ok","path"}; есть -> 409
  POST /api/write    {"path","text"}   -> {"ok","path","size","mtime"}
                        (текст в UTF-8, до 8 МБ; пишет через tmp + os.replace,
                        права исходного файла сохраняются; симлинк внутри
                        корня перезаписывает свою цель, а не сам себя)
  POST /api/rename   {"from","to"}     -> {"ok"}; цель есть -> 409
  POST /api/delete   {"items":[...]}   -> {"ok","deleted","errors"}
                                           (папки рекурсивно, ошибка одного
                                           не роняет остальные)
  POST /api/move     {"items","dest"}  -> {"ok","moved","errors"}
  POST /api/copy     {"items","dest"}   -> {"ok","copied","errors"}
                                           (копирование рекурсивное, цель
                                           /dir/<basename>; перезапись
                                           запрещена -> "already exists";
                                           перенос папки в себя/потомка ->
                                           ошибка в errors)
  POST /api/undo     {}                 -> {"ok","label","errors"}
                                           отменяет последнюю операцию;
                                           снимки лежат вне корня и не
                                           видны через API/FTP
  GET  /api/places   -> {"places":[{name,path,icon}]}
                        источник: places.json рядом с server.py, иначе
                        поле "places" из config.json
  POST /api/places   {"places"}         -> {"ok","places"} — валидация
                        (до 64 мест, name 1..64, path абсолютный, icon до
                        4 символов), запись АТОМАРНО (tmp + os.replace)
  DELETE /api/places -> {"ok","places"} (стереть places.json, вернуть
                        дефолты из config.json)
  POST /api/upload?path=<dir>   multipart/form-data, поле(я) file
                        -> {"ok","saved":[...],"errors":[...]}
                        (стрим на диск кусками 64 КБ во временный файл
                        <имя>.part внутри целевой папки, в конце
                        os.replace — память не растёт; перезапись
                        разрешена; нет прав/нет dir -> 403/404 {"error":...})
          ?path=<dir>&name=<файл> + Content-Type: application/octet-stream
                        — сырое тело для curl, тот же ответ
  GET  /api/download?path=<файл> -> тело файла; заголовки
                        Content-Type application/octet-stream,
                        Content-Disposition attachment; filename*=UTF-8''...,
                        Content-Length, Accept-Ranges: bytes,
                        X-Content-Type-Options: nosniff; поддержка Range
                        (206 + Content-Range, докачка); только обычные файлы, папки/устройства -> 400,
                        нет прав -> 403, нет файла -> 404
  GET  /api/inline?path=<файл>  -> как download, но Content-Disposition:
                        inline и безопасные типы: image/* (кроме svg —
                        svg отдаётся text/plain), text/plain, application/pdf,
                        audio/*, video/*; всё прочее (html/xml/js/...) ->
                        application/octet-stream + attachment. Range тоже.

Прочее: ThreadingHTTPServer (большой upload не блокирует список файлов),
лог запросов форматом [server.py pid=N] 127.0.0.1 - "GET / HTTP/1.1" 200 -,
CORS не нужен (панель и API на одном порту; флаг --cors всё же есть).

FTP (реализация своя, только socketserver):
  корень FTP = корень HTTP (флаг --root); пути клиента трактуются как
  пути внутри корня, выход за него через .. -> 550.
  Команды: USER PASS SYST FEAT OPTS(PWD/UTF8 ON) PWD CWD CDUP TYPE(A/I)
  PASV EPSV PORT EPRT LIST NLST MLSD RETR STOR APPE DELE MKD XMKD RMD
  XRMD RNFR RNTO SIZE MDTM REST NOOP QUIT HELP STAT.
  Логин: USER принимает любое имя, пароль сверяется с общим паролем;
  5 неудач подряд на одном соединении -> 530 + 421 и закрытие.
  Пасивный режим слушает на IP контрольного соединения и случайном порту.
  RETR/STOR умеют REST (докачку) и стриминг кусками 64 КБ.
  Лог: [ftp pid=N] 127.0.0.1 - "USER nerevar" -> 230
  Отключается флагом --no-ftp.

Конфигурация и запуск:
  config.json (рядом со скриптом или --config PATH) читается при старте;
  приоритет: флаги > config.json > встроенные дефолты. Ключи: password,
  http_host, http_port, ftp_enabled, ftp_host, ftp_port, ftp_user, root,
  places.
  Флаги: --host --port --root --password --ftp-port --ftp-user --no-ftp
  --config PATH --pidfile PATH (по умолчанию server.pid рядом со скриптом)
  --no-pidfile --cors
  Пароль нигде не задан -> генерируется случайный из 12 символов и
  печатается в лог крупным блоком; пароль == "changeme" -> громкое
  предупреждение «СМЕНИ ПАРОЛЬ» (config.json в git). Пароль никогда
  не отдаётся в API.
  PID-файл и graceful shutdown по SIGTERM/SIGINT — как в nerevar-hub.

Запуск вручную:
  python3 server.py --port 8090
  остановить: kill <PID>   или   kill $(cat server.pid)

Зависимости: только стандартная библиотека Python 3.6+.
"""

import argparse
import errno
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import socketserver
import stat
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, quote, unquote, urlsplit

# ThreadingHTTPServer появился в Python 3.7; на 3.6 собираем сами
try:
    from http.server import ThreadingHTTPServer
except ImportError:                                  # pragma: no cover
    from socketserver import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
APP_JS_PATH = os.path.join(BASE_DIR, "app.js")
CONFIG_JS_PATH = os.path.join(BASE_DIR, "config.js")
CONFIG_JSON_PATH = os.path.join(BASE_DIR, "config.json")
PLACES_PATH = os.path.join(BASE_DIR, "places.json")
DEFAULT_PIDFILE = os.path.join(BASE_DIR, "server.pid")

TOKEN_TTL = 7 * 24 * 3600      # 604800 с — сколько живёт токен
TOKEN_MAX = 128                # максимум одновременно живых токенов
LOGIN_WINDOW = 300             # окно подсчёта неудачных логинов, с
LOGIN_MAX_FAILS = 5            # неудач с одного IP, после которых — 429
MAX_JSON = 1024 * 1024         # потолок размера JSON-тела, байт
MAX_EDIT = 8 * 1024 * 1024     # потолок для сохранения текста из редактора
CHUNK = 64 * 1024              # кусок стриминга (upload/download/чтение)
MAX_DRAIN = 8 * 1024 * 1024    # сколько «лишнего» тела дочитываем вхолостую

# У каждого запуска свой номер: пишем его в каждую строку лога и в pidfile,
# чтобы всегда было видно, какой это процесс и как его остановить.
PID = os.getpid()
PROC_NAME = os.path.basename(sys.argv[0]) or "server.py"

# Токены в памяти: token -> срок годности (unix time). Защита от гонок —
# одна общая блокировка (действия быстрые, потоков много).
TOKENS = {}
TOKENS_LOCK = threading.Lock()

# Неудачные логины по IP: ip -> [метки времени]; чистится при каждом заходе
LOGIN_FAILS = {}
LOGIN_LOCK = threading.Lock()

# Запись мест может идти из нескольких вкладок сразу
PLACES_LOCK = threading.Lock()

# Встроенный запасной список мест (когда нет ни places.json, ни config.json)
DEFAULT_PLACES = [{"name": "Root", "path": "/", "icon": "/"}]

# Дефолты сервера; config.json и флаги их перекрывают
CONFIG_DEFAULTS = {
    "password": "",
    "http_host": "0.0.0.0",
    "http_port": 8090,
    "ftp_enabled": True,
    "ftp_host": "0.0.0.0",
    "ftp_port": 2121,
    "ftp_user": "nerevar",
    "root": "/",
    "places": DEFAULT_PLACES,
}


# --------------------------------------------------------------------------- #
#  Мелкие утилиты: лог, конфиг, ошибки ФС, пути
# --------------------------------------------------------------------------- #
def log(msg):
    """Строка в stdout с префиксом [server.py pid=N] — как в nerevar-hub."""
    sys.stdout.write("[%s pid=%d] %s\n" % (PROC_NAME, PID, msg))
    sys.stdout.flush()


def log_ftp(msg):
    """То же, но для FTP-сервера: [ftp pid=N]."""
    sys.stdout.write("[ftp pid=%d] %s\n" % (PID, msg))
    sys.stdout.flush()


def load_json_file(path):
    """Прочитать JSON-файл; любая ошибка -> None (старте не мешает)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def fs_error(exc):
    """(код HTTP, текст) для OSError из файловых операций."""
    err = getattr(exc, "errno", None)
    text = getattr(exc, "strerror", None) or str(exc) or exc.__class__.__name__
    if err == errno.ENOENT:
        return 404, "no such path"
    if err == errno.EACCES or err == errno.EPERM or err == errno.EROFS:
        return 403, "permission denied"
    if err == errno.EEXIST:
        return 409, "already exists"
    if err == errno.ENOTDIR:
        return 400, "not a directory"
    if err == errno.EISDIR:
        return 400, "is a directory"
    if err == errno.ENOTEMPTY:
        return 409, "directory not empty"
    if err == errno.ENOSPC:
        return 500, "no space left on device"
    return 400, text


def norm_api_path(raw):
    """Абсолютный нормализованный путь, либо None, если путь не абсолютный
    или содержит мусор (~ не расширяется — контракт API)."""
    if not isinstance(raw, str) or not raw:
        return None
    if not raw.startswith("/") or "\x00" in raw:
        return None
    return os.path.abspath(raw)


def path_inside(root, path):
    """True, если path лежит внутри root (или равен ему).

    Сравнение по компонентам через os.path.commonpath: "/tmp/x2" не
    сочтётся лежащим внутри "/tmp/x"."""
    try:
        return os.path.commonpath([root, path]) == root
    except ValueError:
        return False


# Снимки для Ctrl+Z лежат вне корня (или внутри, но с явным запретом
# на выдачу через API/FTP). Живут до перезапуска процесса.
UNDO_DIR = os.path.join(tempfile.gettempdir(),
                        "nerevar-fm-undo-%s" % (os.getuid() if hasattr(os, "getuid") else 0))
UNDO_STACK = []
UNDO_LOCK = threading.Lock()
UNDO_MAX = 50


def undo_dir():
    os.makedirs(UNDO_DIR, mode=0o700, exist_ok=True)
    return UNDO_DIR


def undo_hidden(server_path):
    """True, если путь ведёт во внутреннее хранилище отмены."""
    try:
        return path_inside(UNDO_DIR, server_path)
    except Exception:
        return False


def snapshot_path(client, server_path):
    """Копия одного пути в хранилище отмены; описание для восстановления."""
    base = os.path.join(undo_dir(), secrets.token_hex(10))
    os.mkdir(base, 0o700)
    snap = os.path.join(base, "data")
    islink = os.path.islink(server_path)
    isdir = os.path.isdir(server_path) and not islink
    if islink:
        os.symlink(os.readlink(server_path), snap)
    elif isdir:
        shutil.copytree(server_path, snap, symlinks=True)
    else:
        shutil.copy2(server_path, snap)
    return {"client": client, "snap": snap, "isdir": isdir, "islink": islink}


def undo_cleanup(entry):
    for s in entry.get("restore", []):
        shutil.rmtree(os.path.dirname(s["snap"]), ignore_errors=True)


def undo_push(label, remove=None, restore=None):
    entry = {"label": label, "remove": remove or [], "restore": restore or []}
    with UNDO_LOCK:
        UNDO_STACK.append(entry)
        while len(UNDO_STACK) > UNDO_MAX:
            undo_cleanup(UNDO_STACK.pop(0))
    return entry


def client_for_server(root, root_real, server):
    """Серверный путь -> клиентский (или None, если он вне корня)."""
    for base in (root, root_real):
        rel = os.path.relpath(server, base)
        if rel == ".." or rel.startswith(".." + os.sep):
            continue
        return "/" if rel == "." else "/" + rel
    return None


def undo_server_path(raw, root):
    """Клиентский путь -> серверный только лексически внутри корня.

    В отличие от _api_resolve здесь не проверяется realpath: восстановление
    симлинка должно работать, даже если его цель сейчас отсутствует."""
    client = norm_api_path(raw)
    if client is None:
        return None
    server = os.path.abspath(os.path.join(root, client.lstrip("/")))
    if not path_inside(root, server) or server == root:
        return None
    if undo_hidden(server):
        return None
    return client, server


def undo_remove(server_path):
    if os.path.islink(server_path) or os.path.isfile(server_path):
        os.remove(server_path)
    elif os.path.isdir(server_path):
        shutil.rmtree(server_path)


def undo_restore(s, root):
    got = undo_server_path(s["client"], root)
    if got is None:
        return "cannot restore path: %s" % s["client"]
    client, server = got
    parent = os.path.dirname(server)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    if os.path.lexists(server):
        undo_remove(server)
    if s["islink"]:
        os.symlink(os.readlink(s["snap"]), server)
    elif s["isdir"]:
        shutil.copytree(s["snap"], server, symlinks=True)
    else:
        shutil.copy2(s["snap"], server)
    return None


def sanitize_filename(raw):
    """Имя файла из multipart: только basename, без пустых / "." / ".."."""
    if not isinstance(raw, str):
        return None
    name = raw.replace("\\", "/").split("/")[-1].strip()
    if name in ("", ".", "..") or "\x00" in name:
        return None
    return name


def mode_string(st_mode):
    """Строковый режим вида "drwxr-xr-x" из битов st_mode."""
    return stat.filemode(st_mode)


def place_defaults(cfg_places):
    """Дефолтные места: из config.json, если там список, иначе встроенные."""
    if isinstance(cfg_places, list) and cfg_places:
        return [p for p in cfg_places if isinstance(p, dict)]
    return [dict(p) for p in DEFAULT_PLACES]


def validate_places(raw):
    """Проверка списка мест из запроса. -> (нормализованный список, None)
    либо (None, текст ошибки)."""
    if not isinstance(raw, list):
        return None, "places must be a list"
    if len(raw) > 64:
        return None, "too many places (max 64)"
    out = []
    for item in raw:
        if not isinstance(item, dict):
            return None, "each place must be an object"
        name = item.get("name")
        path = item.get("path")
        icon = item.get("icon", "")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64:
            return None, "place name must be 1..64 characters"
        if not isinstance(path, str) or not path.startswith("/") \
                or "\x00" in path:
            return None, "place path must be absolute (start with /)"
        if not isinstance(icon, str) or len(icon) > 4:
            return None, "place icon must be up to 4 characters"
        out.append({"name": name.strip(), "path": path, "icon": icon})
    return out, None


def write_json_atomic(path, obj):
    """Атомарная запись JSON: временный файл рядом + os.replace — читатели
    в другой вкладке получат либо старый, либо новый файл целиком."""
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    tmp = path + ".tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(payload)
        os.replace(tmp, path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# --------------------------------------------------------------------------- #
#  Разбор multipart/form-data: потоковый, без чтения тела в память целиком
# --------------------------------------------------------------------------- #
class _BodyReader:
    """Читатель тела запроса ровно length байт. Буфер + отложенный хвост
    (длина разделителя - 1), чтобы разделитель multipart никогда не порезался
    куском на границе чтения."""

    def __init__(self, rfile, length):
        self.rfile = rfile
        self.left = length          # сколько байт тела ещё не прочитано
        self.buf = b""

    def _fill(self):
        if self.left <= 0:
            return False
        data = self.rfile.read(min(CHUNK, self.left))
        if not data:
            self.left = 0
            return False
        self.left -= len(data)
        self.buf += data
        return True

    def find(self, delim, limit=1 << 20):
        """Всё до delim (сам delim съеден); None — конец тела или превышен
        лимит (защита от тела без разделителя)."""
        while True:
            i = self.buf.find(delim)
            if i >= 0:
                out = self.buf[:i]
                self.buf = self.buf[i + len(delim):]
                return out
            if len(self.buf) > limit:
                return None
            if not self._fill():
                return None

    def read_n(self, n):
        """Ровно n байт; None — тело кончилось раньше."""
        while len(self.buf) < n:
            if not self._fill():
                return None
        out = self.buf[:n]
        self.buf = self.buf[n:]
        return out

    def stream_to(self, delim, sink):
        """Писать поток в sink до delim (сам delim съеден).
        True — delim найден; False — тело кончилось."""
        while True:
            i = self.buf.find(delim)
            if i >= 0:
                if i:
                    sink(self.buf[:i])
                self.buf = self.buf[i + len(delim):]
                return True
            hold = len(delim) - 1
            if len(self.buf) > hold:
                cut = len(self.buf) - hold
                sink(self.buf[:cut])
                self.buf = self.buf[cut:]
            if not self._fill():
                return False


class _FileSink:
    """Пишет тело multipart-поля на диск кусками 64 КБ. При ошибке (нет
    места, нет прав) перестаёт писать, но продолжает глотать входящие куски:
    разбор не сбивается, ошибка попадает в errors на конкретный файл."""

    def __init__(self, tmp_path):
        self.path = tmp_path
        self.error = None
        self._fh = None
        try:
            self._fh = open(tmp_path, "wb")
        except OSError as exc:
            self.error = getattr(exc, "strerror", None) or str(exc)

    def write(self, chunk):
        if self._fh is None:
            return
        try:
            self._fh.write(chunk)
        except OSError as exc:
            self.error = getattr(exc, "strerror", None) or str(exc)
            self.close_file()

    def close_file(self):
        if self._fh is not None:
            try:
                self._fh.close()
            except OSError:
                pass
            self._fh = None

    def remove(self):
        """Убрать временный файл (вызывается и при ошибке)."""
        self.close_file()
        try:
            os.remove(self.path)
        except OSError:
            pass


def _fix_header_text(text):
    """Заголовки http.client декодирует как latin-1; имена файлов браузеры
    шлют байтами UTF-8 — восстанавливаем."""
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def parse_content_disposition(headers):
    """(имя поля, имя файла или None) из заголовков части multipart."""
    for line in headers.split("\r\n"):
        key, sep, value = line.partition(":")
        if not sep or key.strip().lower() != "content-disposition":
            continue
        params = {}
        for chunk in value.split(";")[1:]:
            k, sep2, v = chunk.partition("=")
            if sep2:
                params[k.strip().lower()] = v.strip()
        field = _fix_header_text(params.get("name", "")).strip('"')
        filename = params.get("filename")
        star = params.get("filename*")          # RFC 5987: UTF-8''%D0%...
        if star:
            enc, _sep, val = star.partition("''")
            filename = unquote(val) if enc.upper() == "UTF-8" else star
        if filename is not None:
            filename = _fix_header_text(filename)
            if len(filename) >= 2 and filename[0] == '"' \
                    and filename[-1] == '"':
                filename = filename[1:-1]     # filename="a.txt"
        return field, filename
    return None, None


def inline_safe_type(guessed):
    """MIME для /api/inline: безопасные типы — как есть; svg — text/plain;
    всё прочее (html, htm, xml, js, ...) — None, значит octet-stream."""
    if not guessed:
        return None
    guessed = guessed.split(";")[0].strip().lower()
    if guessed == "image/svg+xml":
        return "text/plain"        # svg исполняет скрипты — только текстом
    if guessed.startswith("image/") or guessed.startswith("audio/") \
            or guessed.startswith("video/"):
        return guessed
    if guessed in ("text/plain", "application/pdf"):
        return guessed
    return None


def parse_range(rng, size):
    """Разбор заголовка Range. -> (status, start, length);
    status None — отправить 416 (диапазон невалидный)."""
    if not rng:
        return 200, 0, size
    m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
    if not m or not (m.group(1) or m.group(2)):
        return 200, 0, size          # непонятный Range просто игнорируем
    if m.group(1):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
    else:
        start = max(0, size - int(m.group(2)))   # bytes=-N: последние N байт
        end = size - 1
    if size == 0 or start > end or start >= size:
        return None, 0, 0
    return 206, start, min(end, size - 1) - start + 1


# --------------------------------------------------------------------------- #
#  HTTP: обработчик запросов
# --------------------------------------------------------------------------- #
# Маршруты API по методам — чтобы различать 404 (нет такого) и 405 (не тот метод)
API_GET = {"/api/status", "/api/list", "/api/places", "/api/download",
           "/api/inline"}
API_POST = {"/api/login", "/api/mkdir", "/api/newfile", "/api/rename",
            "/api/delete", "/api/move", "/api/copy", "/api/places",
            "/api/upload", "/api/write", "/api/undo"}
API_DELETE = {"/api/places"}
API_ROUTES = API_GET | API_POST | API_DELETE


class _HTTPError(Exception):
    """Фатальная ошибка обработки запроса: код + текст ответа {"error":...}."""

    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


def make_handler(cfg):
    """Собирает класс обработчика, замыкая настройки процесса
    (пароль, корень, FTP, CORS, дефолтные места)."""

    # Корень определяет и FTP, и HTTP: путь из запроса трактуется КАК ПУТЬ
    # ВНУТРИ корня (см. _api_resolve). ROOT_REAL — для проверки симлинков.
    ROOT = cfg["root"]
    ROOT_REAL = os.path.realpath(ROOT)

    class FMHandler(BaseHTTPRequestHandler):
        server_version = "NerevarFM/1.0"
        # запросы от прокси/curl бывают длиннее дефолтных 64 КБ
        max_line = 64 * 1024
        max_headers = 100 * 1024

        # --- лог запросов: [server.py pid=N] 127.0.0.1 - "GET ..." 200 - ----
        def log_message(self, fmt, *args):
            sys.stdout.write("[%s pid=%d] %s - %s\n"
                             % (PROC_NAME, PID, self.address_string(),
                                fmt % args))
            sys.stdout.flush()

        # --- низкоуровневая отправка -------------------------------------- #
        def _respond(self, code, data, content_type, extra=None):
            """Отправить тело (bytes/str) с заголовками; --cors добавляет
            Access-Control-Allow-Origin (нужен только для file://)."""
            payload = data if isinstance(data, bytes) \
                else data.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            if cfg["cors"]:
                self.send_header("Access-Control-Allow-Origin", "*")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(payload)

        def _json(self, code, obj, extra=None):
            """JSON-ответ (все маршруты /api/* отвечают JSON)."""
            self._respond(code, json.dumps(obj),
                           "application/json; charset=utf-8", extra)

        def _err(self, code, message, extra=None):
            """Ошибка в формате {"error": "..."}. Текст — текст, не JSON."""
            self._json(code, {"error": str(message)}, extra)

        # --- разбор запроса ------------------------------------------------ #
        def _query(self):
            if not hasattr(self, "_qcache"):
                self._qcache = parse_qs(urlsplit(self.path).query)
            return self._qcache

        def _q(self, name):
            vals = self._query().get(name)
            return vals[0] if vals else None

        def _content_length(self):
            try:
                return int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None

        def _drop_body(self):
            """Дочитать непрочитанное тело запроса, чтобы соединение осталось
            пригодным; слишком большое — просто закрываем соединение."""
            length = self._content_length()
            if length is None or length <= 0:
                return
            left = length - getattr(self, "_body_consumed", 0)
            if left <= 0:
                return
            if left > MAX_DRAIN:
                self.close_connection = True
                return
            while left > 0:
                chunk = self.rfile.read(min(CHUNK, left))
                if not chunk:
                    break
                left -= len(chunk)

        def _read_json_body(self, limit=None):
            """Прочитать JSON-объект (по умолчанию до 1 МБ, для редактора
            больше). -> (dict, None) или (None, (код, текст))."""
            if limit is None:
                limit = MAX_JSON
            length = self._content_length()
            if length is None:
                self.close_connection = True
                return None, (400, "bad Content-Length")
            if length > limit:
                # тело больше потолка: не глотаем его вхолостую, а закрываем
                # соединение после ответа
                self.close_connection = True
                return None, (413, "request body too big (max %d bytes)"
                              % limit)
            body = self.rfile.read(length) if length > 0 else b""
            self._body_consumed = length
            if not body:
                return None, (400, "empty body, JSON object expected")
            try:
                data = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return None, (400, "invalid JSON")
            if not isinstance(data, dict):
                return None, (400, "JSON object expected")
            return data, None

        def _auth_ok(self):
            """Есть ли валидный токен: заголовок X-Auth-Token или ?token="""
            token = self.headers.get("X-Auth-Token") or self._q("token")
            if not token:
                return False
            now = time.time()
            with TOKENS_LOCK:
                exp = TOKENS.get(token)
                if exp is None:
                    return False
                if exp <= now:
                    del TOKENS[token]
                    return False
                return True

        # --- маршрутизация ------------------------------------------------- #
        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                if path not in API_GET:
                    code = 405 if path in API_ROUTES else 404
                    msg = "method not allowed" if code == 405 else "not found"
                    if not self._auth_ok() and path in API_ROUTES:
                        return self._err(401, "unauthorized")
                    return self._err(code, msg)
                if not self._auth_ok():
                    return self._err(401, "unauthorized")
                if path == "/api/status":
                    return self._api_status()
                if path == "/api/list":
                    return self._api_list()
                if path == "/api/places":
                    return self._api_places_get()
                if path == "/api/download":
                    return self._api_file(inline=False)
                if path == "/api/inline":
                    return self._api_file(inline=True)
                return self._err(404, "not found")
            self._static(path)

        def do_POST(self):
            path = urlsplit(self.path).path
            if not path.startswith("/api/"):
                self._drop_body()
                return self._respond(404, "Not found",
                                    "text/plain; charset=utf-8")
            if path not in API_POST:
                self._drop_body()
                code = 405 if path in API_ROUTES else 404
                msg = "method not allowed" if code == 405 else "not found"
                return self._err(code, msg)
            if path != "/api/login" and not self._auth_ok():
                self._drop_body()
                return self._err(401, "unauthorized")
            if path == "/api/login":
                return self._api_login()
            if path == "/api/upload":
                return self._api_upload()
            if path == "/api/write":
                return self._api_write()
            data, err = self._read_json_body()
            if err is not None:
                if err[0] != 413:
                    self._drop_body()
                return self._err(err[0], err[1])
            try:
                if path == "/api/mkdir":
                    return self._api_mkdir(data)
                if path == "/api/newfile":
                    return self._api_newfile(data)
                if path == "/api/rename":
                    return self._api_rename(data)
                if path == "/api/delete":
                    return self._api_delete(data)
                if path == "/api/move":
                    return self._api_transfer(data, move=True)
                if path == "/api/copy":
                    return self._api_transfer(data, move=False)
                if path == "/api/undo":
                    return self._api_undo()
                if path == "/api/places":
                    return self._api_places_post(data)
            except _HTTPError as exc:
                return self._err(exc.code, exc.message)
            return self._err(404, "not found")

        def do_DELETE(self):
            path = urlsplit(self.path).path
            if path not in API_DELETE:
                known = path in API_ROUTES
                return self._err(405 if known else 404,
                                 "method not allowed" if known
                                 else "not found")
            if not self._auth_ok():
                return self._err(401, "unauthorized")
            if path == "/api/places":
                return self._api_places_delete()
            return self._err(404, "not found")

        def do_OPTIONS(self):
            # preflight для --cors (панель с file:// и чужого origin)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-Auth-Token")
            if cfg["cors"]:
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", "0")
            self.end_headers()

        # --- статика ------------------------------------------------------- #
        def _static_file(self, fs_path, ctype):
            """Отдать файл из папки server.py кусками 64 КБ, без кэша.
            Файла может ещё не быть — тогда 404 (нормально)."""
            try:
                fh = open(fs_path, "rb")
            except OSError:
                return self._respond(404, "Not found",
                                     "text/plain; charset=utf-8")
            try:
                size = os.fstat(fh.fileno()).st_size
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                if cfg["cors"]:
                    self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                while True:
                    chunk = fh.read(CHUNK)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass                        # клиент закрыл вкладку
            finally:
                fh.close()

        def _static(self, path):
            if path in ("/", "/index.html"):
                return self._static_file(INDEX_PATH,
                                         "text/html; charset=utf-8")
            if path == "/app.js":
                return self._static_file(APP_JS_PATH,
                                          "application/javascript; charset=utf-8")
            if path == "/config.js":
                return self._static_file(CONFIG_JS_PATH,
                                         "application/javascript; charset=utf-8")
            if path == "/favicon.ico":
                return self._respond(204, b"", "image/x-icon")
            return self._respond(404, "Not found", "text/plain; charset=utf-8")

        # --- авторизация --------------------------------------------------- #
        def _api_login(self):
            ip = self.client_address[0]
            now = time.time()
            with LOGIN_LOCK:
                fails = [t for t in LOGIN_FAILS.get(ip, [])
                         if now - t < LOGIN_WINDOW]
                LOGIN_FAILS[ip] = fails
                blocked = len(fails) >= LOGIN_MAX_FAILS
            if blocked:
                return self._err(429, "too many attempts")
            data, err = self._read_json_body()
            if err is not None:
                if err[0] != 413:
                    self._drop_body()
                return self._err(err[0], err[1])
            password = data.get("password")
            good = isinstance(password, str) and hmac.compare_digest(
                password.encode("utf-8"), cfg["password"].encode("utf-8"))
            if not good:
                with LOGIN_LOCK:
                    LOGIN_FAILS.setdefault(ip, []).append(now)
                return self._err(401, "bad password")
            token = secrets.token_hex(16)          # 32 hex-символа
            with TOKENS_LOCK:
                dead = [k for k, exp in TOKENS.items() if exp <= now]
                for key in dead:
                    del TOKENS[key]
                while len(TOKENS) >= TOKEN_MAX:
                    # лимит исчерпан — выкидываем самый старый токен
                    oldest = min(TOKENS, key=TOKENS.get)
                    del TOKENS[oldest]
                TOKENS[token] = now + TOKEN_TTL
            return self._json(200, {"token": token, "ttl": TOKEN_TTL})

        # --- разбор путей: всё лежит ВНУТРИ корня --------------------------- #
        def _api_resolve(self, raw):
            """Путь клиента -> (клиентский путь, серверный путь на диске).

            Клиентский путь — путь из запроса после нормализации, он всегда
            начинается с "/": его и отдаём в ответах. Серверный —
            join(ROOT, путь) + abspath, и он ОБЯЗАН остаться внутри ROOT:
            выход через ../ или симлинк наружу -> 403.

            -> ((клиентский, серверный), 200, None) либо
               (None, код, текст ошибки)"""
            if norm_api_path(raw) is None:
                return None, 400, "path must be absolute"
            # склейка сначала, нормализация потом: только так ../ может
            # показать выход за корень (при ROOT=/ это как раньше)
            server = os.path.abspath(os.path.join(ROOT, raw.lstrip("/")))
            if not path_inside(ROOT, server) or undo_hidden(server):
                return None, 403, "path escapes the root"
            if not path_inside(ROOT_REAL, os.path.realpath(server)):
                return None, 403, "path escapes the root (symlink)"
            rel = os.path.relpath(server, ROOT)
            client = "/" if rel == "." else "/" + rel
            return (client, server), 200, None

        def _require_path(self, raw):
            """(клиентский, серверный) либо None с уже отправленной ошибкой."""
            if raw is None:
                self._err(400, "path is required")
                return None
            res, code, msg = self._api_resolve(raw)
            if res is None:
                self._err(code, msg)
                return None
            return res

        def _client_paths(self, dest_client, server_paths):
            """Серверные пути сохранённых файлов -> клиентские (в ответе
            никогда не показываем путь на диске)."""
            out = []
            for p in server_paths:
                out.append(os.path.join(dest_client, os.path.basename(p)))
            return out

        # --- 1) статус ----------------------------------------------------- #
        def _api_status(self):
            self._json(200, {
                "root": cfg["root"],
                "ftp": {
                    "enabled": bool(cfg["ftp_enabled"]),
                    "port": cfg["ftp_port"],
                    "user": cfg["ftp_user"],
                },
                "ok": True,
            })

        # --- 2) список каталога -------------------------------------------- #
        def _api_list(self):
            raw = self._q("path")
            got = self._require_path(raw)
            if got is None:
                return
            client, path = got
            if not os.path.exists(path):
                return self._err(404, "no such path: %s" % client)
            if not os.path.isdir(path):
                return self._err(400, "not a directory")
            try:
                names = os.listdir(path)
            except PermissionError:
                return self._err(403, "permission denied")
            except OSError as exc:
                code, msg = fs_error(exc)
                return self._err(code, msg)

            entries = []
            for name in names:
                full = os.path.join(path, name)
                if undo_hidden(full):
                    continue
                try:
                    st = os.stat(full)          # симлинк на папку -> папка
                except OSError:
                    try:
                        st = os.lstat(full)     # битый симлинк — показываем
                    except OSError:
                        continue                # пропал между listdir и stat
                is_dir = stat.S_ISDIR(st.st_mode)
                entries.append({
                    "name": name,
                    # путь в ответе — клиентский (всегда внутри корня)
                    "path": os.path.join(client, name),
                    "dir": is_dir,
                    "size": 0 if is_dir else st.st_size,
                    "mtime": int(st.st_mtime),
                    "mode": mode_string(st.st_mode),
                    "hidden": name.startswith("."),
                })
            # сначала папки, потом файлы, внутри — по имени без учёта регистра
            entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))

            free = total = None
            try:
                vfs = os.statvfs(path)
                free = vfs.f_bavail * vfs.f_frsize   # доступно непривилегированным
                total = vfs.f_blocks * vfs.f_frsize
            except OSError:
                pass

            self._json(200, {
                "path": client,
                "name": os.path.basename(client) or "/",
                "parent": os.path.dirname(client) or "/",
                "entries": entries,
                "free": free,
                "total": total,
            })

        # --- 3/4) mkdir и newfile ------------------------------------------- #
        def _make_path(self, data, is_dir):
            got = self._require_path(data.get("path"))
            if got is None:
                return
            client, path = got
            if os.path.exists(path):
                return self._err(409, "already exists")
            parent = os.path.dirname(path) or "/"
            if not os.path.exists(parent):
                return self._err(404, "parent directory does not exist")
            if not os.path.isdir(parent):
                return self._err(400, "not a directory")
            try:
                if is_dir:
                    os.mkdir(path)
                else:
                    with open(path, "xb"):
                        pass                    # пустой файл, если нет
            except OSError as exc:
                code, msg = fs_error(exc)
                return self._err(code, msg)
            undo_push("Create %s" % ("folder" if is_dir else "file"),
                      remove=[client])
            return self._json(200, {"ok": True, "path": client})

        def _api_mkdir(self, data):
            return self._make_path(data, is_dir=True)

        def _api_newfile(self, data):
            return self._make_path(data, is_dir=False)

        # --- 4b) сохранение текста из редактора ---------------------------- #
        def _api_write(self):
            data, err = self._read_json_body(MAX_EDIT)
            if err is not None:
                if err[0] != 413:
                    self._drop_body()
                return self._err(err[0], err[1])
            text = data.get("text")
            if not isinstance(text, str):
                return self._err(400, "text must be a string")
            got = self._require_path(data.get("path"))
            if got is None:
                return
            client, path = got
            if not os.path.exists(path):
                return self._err(404, "no such path: %s" % client)
            if os.path.isdir(path):
                return self._err(400, "not a file")
            try:
                payload = text.encode("utf-8")
            except UnicodeEncodeError:
                return self._err(400, "text is not valid UTF-8")
            if len(payload) > MAX_EDIT:
                return self._err(413, "file too big (max %d bytes)" % MAX_EDIT)

            # симлинк внутри корня: пишем в его цель, а не заменяем ссылку
            target = os.path.realpath(path) if os.path.islink(path) else path
            # снимок делаем с цели записи, иначе отмена вернула бы содержимое
            # самой символической ссылки, а не файла, который изменился
            snap = None
            target_client = client_for_server(ROOT, ROOT_REAL, target)
            if target_client is not None:
                try:
                    snap = snapshot_path(target_client, target)
                except OSError:
                    pass
            parent = os.path.dirname(target) or "/"
            tmp = None
            try:
                mode = stat.S_IMODE(os.stat(target).st_mode)
            except OSError:
                mode = None
            try:
                fd, tmp = tempfile.mkstemp(prefix=".nerevar-fm-", suffix=".part",
                                           dir=parent)
                with os.fdopen(fd, "wb") as fh:
                    fh.write(payload)
                    fh.flush()
                    os.fsync(fh.fileno())
                if mode is not None:
                    os.chmod(tmp, mode)     # сохранить права исходного файла
                os.replace(tmp, target)
                tmp = None
            except OSError as exc:
                code, msg = fs_error(exc)
                if snap is not None:
                    undo_cleanup({"restore": [snap]})
                return self._err(code, msg)
            finally:
                if tmp is not None:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
            try:
                st = os.stat(target)
                size, mtime = st.st_size, int(st.st_mtime)
            except OSError:
                size, mtime = len(payload), int(time.time())
            if snap is not None:
                undo_push("Save %s" % os.path.basename(client), restore=[snap])
            return self._json(200, {"ok": True, "path": client,
                                    "size": size, "mtime": mtime})

        # --- 5) rename ------------------------------------------------------ #
        def _api_rename(self, data):
            from_res, code, msg = self._api_resolve(data.get("from"))
            if from_res is None:
                return self._err(code, msg)
            to_res, code, msg = self._api_resolve(data.get("to"))
            if to_res is None:
                return self._err(code, msg)
            client_src, src = from_res
            client_dst, dst = to_res
            if not os.path.exists(src):
                return self._err(404, "no such path: %s" % client_src)
            if os.path.exists(dst):
                return self._err(409, "already exists")
            snap = None
            try:
                snap = snapshot_path(client_src, src)
            except OSError:
                pass
            try:
                os.rename(src, dst)
            except OSError as exc:
                code, msg = fs_error(exc)
                if snap is not None:
                    undo_cleanup({"restore": [snap]})
                return self._err(code, msg)
            undo_push("Rename %s" % client_src,
                      remove=[client_dst],
                      restore=[snap] if snap is not None else [])
            return self._json(200, {"ok": True})

        # --- 6) delete ------------------------------------------------------- #
        def _api_delete(self, data):
            items = data.get("items")
            if not isinstance(items, list):
                return self._err(400, "items must be a list")
            deleted = 0
            errors = []
            snapshots = []
            for raw in items:
                res, code, msg = self._api_resolve(raw)
                if res is None:
                    errors.append({"path": raw, "error": msg})
                    continue
                client, path = res
                if not os.path.exists(path) and not os.path.islink(path):
                    errors.append({"path": client, "error": "no such path"})
                    continue
                snap = None
                try:
                    snap = snapshot_path(client, path)
                except OSError:
                    pass
                try:
                    if os.path.isdir(path) and not os.path.islink(path):
                        shutil.rmtree(path)     # рекурсивно для папок
                    else:
                        os.remove(path)
                    deleted += 1
                    if snap is not None:
                        snapshots.append(snap)
                    else:
                        errors.append({"path": client,
                                       "error": "cannot snapshot for undo"})
                except OSError as exc:
                    _code, msg = fs_error(exc)
                    errors.append({"path": client, "error": msg})
                    if snap is not None:
                        undo_cleanup({"restore": [snap]})
            if snapshots:
                undo_push("Delete %d item(s)" % len(snapshots),
                          restore=snapshots)
            return self._json(200, {"ok": True, "deleted": deleted,
                                    "errors": errors})

        # --- 7/8) move и copy ------------------------------------------------ #
        @staticmethod
        def _move_one(src, dst):
            """Переместить один путь; при переезде между дисками (EXDEV) —
            копированием и удалением источника."""
            try:
                os.rename(src, dst)
            except OSError as exc:
                if exc.errno != errno.EXDEV:
                    raise
                if os.path.isdir(src):
                    shutil.copytree(src, dst)
                    shutil.rmtree(src)
                else:
                    shutil.copy2(src, dst)
                    os.remove(src)

        def _api_transfer(self, data, move):
            items = data.get("items")
            if not isinstance(items, list):
                return self._err(400, "items must be a list")
            dest_res, code, msg = self._api_resolve(data.get("dest"))
            if dest_res is None:
                return self._err(code, msg)
            dest_client, dest = dest_res
            if not os.path.exists(dest):
                return self._err(404, "no such path: %s" % dest_client)
            if not os.path.isdir(dest):
                return self._err(400, "not a directory")
            if not os.access(dest, os.W_OK | os.X_OK):
                return self._err(403, "permission denied")

            done = 0
            errors = []
            targets = []            # что удалить при отмене
            snapshots = []          # что вернуть при отмене переезда
            verb = "move" if move else "copy"
            for raw in items:
                res, code, msg = self._api_resolve(raw)
                if res is None:
                    errors.append({"path": raw, "error": msg})
                    continue
                client, src = res
                if not os.path.exists(src) and not os.path.islink(src):
                    errors.append({"path": client, "error": "no such path"})
                    continue
                name = os.path.basename(src)
                if not name:
                    errors.append({"path": client,
                                   "error": "cannot %s the root" % verb})
                    continue
                # перенос папки самой в себя и в её потомка запрещён
                if os.path.isdir(src) and not os.path.islink(src):
                    if dest == src or dest.startswith(src + os.sep):
                        errors.append({
                            "path": client,
                            "error": "cannot %s a directory into itself"
                                    % verb})
                        continue
                target = os.path.join(dest, name)
                target_client = os.path.join(dest_client, name)
                if os.path.exists(target) or os.path.islink(target):
                    errors.append({"path": client, "error": "already exists"})
                    continue
                snap = None
                if move:
                    # без снимка нельзя гарантировать отмену — не трогаем файл
                    try:
                        snap = snapshot_path(client, src)
                    except OSError as exc:
                        _code, msg = fs_error(exc)
                        errors.append({"path": client,
                                       "error": "cannot snapshot for undo: "
                                                + msg})
                        continue
                try:
                    if move:
                        self._move_one(src, target)
                    elif os.path.isdir(src) and not os.path.islink(src):
                        shutil.copytree(src, target)   # рекурсивно
                    else:
                        shutil.copy2(src, target)      # стримит кусками сам
                    done += 1
                    targets.append(target_client)
                    if snap is not None:
                        snapshots.append(snap)
                except OSError as exc:
                    _code, msg = fs_error(exc)
                    errors.append({"path": client, "error": msg})
                    if snap is not None:
                        undo_cleanup({"restore": [snap]})
                    # copying/moving could leave a partial target behind
                    try:
                        if os.path.lexists(target):
                            undo_remove(target)
                    except OSError:
                        pass
            if targets:
                undo_push(("Move" if move else "Copy") + " %d item(s)"
                          % len(targets),
                          remove=targets, restore=snapshots)
            if move:
                return self._json(200, {"ok": True, "moved": done,
                                        "errors": errors})
            return self._json(200, {"ok": True, "copied": done,
                                    "errors": errors})

        # --- 8b) Ctrl+Z ------------------------------------------------------ #
        def _api_undo(self):
            with UNDO_LOCK:
                entry = UNDO_STACK.pop() if UNDO_STACK else None
            if entry is None:
                return self._err(409, "nothing to undo")

            errors = []
            for raw in entry.get("remove", []):
                got = undo_server_path(raw, ROOT)
                if got is None:
                    errors.append({"path": raw, "error": "invalid path"})
                    continue
                client, server = got
                if not os.path.lexists(server):
                    continue
                try:
                    undo_remove(server)
                except OSError as exc:
                    _code, msg = fs_error(exc)
                    errors.append({"path": client, "error": msg})

            for s in entry.get("restore", []):
                try:
                    msg = undo_restore(s, ROOT)
                    if msg:
                        errors.append({"path": s["client"], "error": msg})
                except OSError as exc:
                    _code, msg = fs_error(exc)
                    errors.append({"path": s["client"], "error": msg})

            if errors:
                with UNDO_LOCK:
                    UNDO_STACK.append(entry)
                return self._json(200, {"ok": False, "label": entry["label"],
                                        "errors": errors})

            undo_cleanup(entry)
            return self._json(200, {"ok": True, "label": entry["label"],
                                    "errors": []})

        # --- 9) places ------------------------------------------------------- #
        def _places_source_path(self):
            """places.json существует -> он, иначе None (берём из config)."""
            return PLACES_PATH if os.path.isfile(PLACES_PATH) else None

        def _api_places_get(self):
            with PLACES_LOCK:
                path = self._places_source_path()
                if path is None:
                    places = place_defaults(cfg["places"])
                else:
                    try:
                        with open(path, "r", encoding="utf-8") as fh:
                            data = json.load(fh)
                        raw = data.get("places") if isinstance(data, dict) \
                            else None
                    except (OSError, ValueError):
                        raw = None
                    if isinstance(raw, list):
                        places, _bad = validate_places(raw)
                        if places is None:
                            places = place_defaults(cfg["places"])
                    else:
                        places = place_defaults(cfg["places"])
            return self._json(200, {"places": places})

        def _api_places_post(self, data):
            places, bad = validate_places(data.get("places"))
            if places is None:
                return self._err(400, bad)
            with PLACES_LOCK:
                try:
                    write_json_atomic(PLACES_PATH, {"places": places})
                except OSError as exc:
                    code, msg = fs_error(exc)
                    return self._err(code, "cannot save places: %s" % msg)
            return self._json(200, {"ok": True, "places": places})

        def _api_places_delete(self):
            with PLACES_LOCK:
                try:
                    if os.path.exists(PLACES_PATH):
                        os.remove(PLACES_PATH)
                except OSError as exc:
                    code, msg = fs_error(exc)
                    return self._err(code, "cannot delete places: %s" % msg)
            # сброс идемпотентен: файла и так нет — это тоже успех
            return self._json(200, {"ok": True,
                                    "places": place_defaults(cfg["places"])})

        # --- 10) upload ------------------------------------------------------ #
        def _api_upload(self):
            # резолвим путь вручную (не через _require_path), чтобы первым
            # делом отбросить тело запроса, и только потом слать ошибку
            dest_raw = self._q("path")
            if dest_raw is None:
                self._drop_body()
                return self._err(400, "path is required")
            res, code, msg = self._api_resolve(dest_raw)
            if res is None:
                self._drop_body()
                return self._err(code, msg)
            dest_client, dest = res
            if not os.path.exists(dest):
                self._drop_body()
                return self._err(404, "no such path: %s" % dest_client)
            if not os.path.isdir(dest):
                self._drop_body()
                return self._err(400, "not a directory")
            if not os.access(dest, os.W_OK | os.X_OK):
                self._drop_body()
                return self._err(403, "permission denied")

            ctype = (self.headers.get("Content-Type") or "") \
                .split(";")[0].strip().lower()
            saved, errors = [], []
            undo_remove_paths, undo_restore_snaps = [], []

            if ctype == "multipart/form-data":
                boundary = self._multipart_boundary()
                if not boundary:
                    self._drop_body()
                    return self._err(400, "missing multipart boundary")
                length = self._content_length()
                if not length:
                    self._drop_body()
                    return self._err(400, "empty body "
                                         "(Content-Length required)")
                try:
                    self._save_multipart(length, boundary, dest, dest_client,
                                          saved, errors, undo_remove_paths,
                                          undo_restore_snaps)
                except _HTTPError as exc:
                    self._drop_body()
                    return self._err(exc.code, exc.message)
                self._drop_body()
                if undo_remove_paths:
                    undo_push("Upload %d file(s)" % len(undo_remove_paths),
                              remove=undo_remove_paths,
                              restore=undo_restore_snaps)
                return self._json(200, {"ok": True,
                                        "saved": self._client_paths(
                                            dest_client, saved),
                                        "errors": errors})

            if ctype == "application/octet-stream":
                # сырое тело для curl: POST /api/upload?path=..&name=..
                name = sanitize_filename(self._q("name"))
                if not name:
                    self._drop_body()
                    return self._err(400, "name is required")
                length = self._content_length()
                if length is None:
                    self.close_connection = True
                    return self._err(411, "Content-Length required")
                try:
                    self._save_raw(dest, dest_client, name, length, saved,
                                   errors, undo_remove_paths,
                                   undo_restore_snaps)
                except _HTTPError as exc:
                    self._drop_body()
                    return self._err(exc.code, exc.message)
                self._drop_body()
                if undo_remove_paths:
                    undo_push("Upload %d file(s)" % len(undo_remove_paths),
                              remove=undo_remove_paths,
                              restore=undo_restore_snaps)
                return self._json(200, {"ok": True,
                                        "saved": self._client_paths(
                                            dest_client, saved),
                                        "errors": errors})

            self._drop_body()
            return self._err(400, "unsupported content type, use "
                                  "multipart/form-data or "
                                  "application/octet-stream")

        def _multipart_boundary(self):
            raw = self.headers.get("Content-Type") or ""
            for chunk in raw.split(";")[1:]:
                k, sep, v = chunk.partition("=")
                if sep and k.strip().lower() == "boundary":
                    v = v.strip()
                    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                        v = v[1:-1]
                    try:
                        return v.encode("ascii")
                    except UnicodeEncodeError:
                        return None
            return None

        def _save_raw(self, dest, dest_client, name, length, saved, errors,
                      undo_remove, undo_restore):
            """Сырое тело целиком в один файл: стрим на диск кусками 64 КБ,
            в конце атомарный os.replace."""
            final = os.path.join(dest, name)
            client = os.path.join(dest_client, name)
            tmp = final + ".part"
            snap = None
            self._body_consumed = 0
            fh = None
            try:
                if os.path.lexists(final):
                    try:
                        snap = snapshot_path(client, final)
                    except OSError as exc:
                        _code, msg = fs_error(exc)
                        raise _HTTPError(
                            500, "cannot snapshot %s for undo: %s"
                                 % (name, msg))
                fh = open(tmp, "wb")
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(CHUNK, left))
                    if not chunk:
                        raise _HTTPError(400, "truncated upload body")
                    fh.write(chunk)
                    self._body_consumed += len(chunk)
                    left -= len(chunk)
                fh.close()
                fh = None
                os.replace(tmp, final)
                saved.append(final)
                undo_remove.append(client)
                if snap is not None:
                    undo_restore.append(snap)
            except OSError as exc:
                code, msg = fs_error(exc)
                raise _HTTPError(code, "cannot save %s: %s" % (name, msg))
            finally:
                if fh is not None:
                    try:
                        fh.close()
                    except OSError:
                        pass
                if not saved or final not in saved:
                    if snap is not None:
                        undo_cleanup({"restore": [snap]})
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass

        def _save_multipart(self, length, boundary, dest, dest_client,
                            saved, errors, undo_remove, undo_restore):
            """Потоковый разбор multipart: тело каждого поля с filename
            пишется в <имя>.part внутри dest, в конце os.replace.
            Память не растёт — в буфере только куски по 64 КБ."""
            delim = b"\r\n--" + boundary
            rd = _BodyReader(self.rfile, length)
            try:
                if rd.find(b"--" + boundary, limit=64 * 1024) is None:
                    raise _HTTPError(400, "multipart boundary not found")

                def _skip(_chunk):
                    pass                     # прочее поле формы — мимо

                while True:
                    tail = rd.read_n(2)
                    if tail is None:
                        raise _HTTPError(400, "truncated multipart body")
                    if tail == b"--":
                        break                # финальный разделитель
                    if tail != b"\r\n":
                        raise _HTTPError(400, "malformed multipart body")
                    head = rd.find(b"\r\n\r\n", limit=16 * 1024)
                    if head is None:
                        raise _HTTPError(400, "malformed multipart headers")
                    _field, filename = parse_content_disposition(
                        head.decode("latin-1"))
                    if filename is None:
                        if not rd.stream_to(delim, _skip):
                            raise _HTTPError(400, "truncated multipart body")
                        continue
                    name = sanitize_filename(filename)
                    if name is None:
                        errors.append({"name": str(filename),
                                       "error": "bad filename"})
                        if not rd.stream_to(delim, _skip):
                            raise _HTTPError(400,
                                             "truncated multipart body")
                        continue
                    final = os.path.join(dest, name)
                    client = os.path.join(dest_client, name)
                    tmp = final + ".part"
                    snap = None
                    if os.path.lexists(final):
                        try:
                            snap = snapshot_path(client, final)
                        except OSError as exc:
                            _code, msg = fs_error(exc)
                            errors.append({"name": name,
                                           "error": "cannot snapshot for undo: "
                                                    + msg})
                            if not rd.stream_to(delim, _skip):
                                raise _HTTPError(
                                    400, "truncated multipart body")
                            continue
                    sink = _FileSink(tmp)
                    complete = rd.stream_to(delim, sink.write)
                    sink.close_file()
                    if not complete:
                        sink.remove()
                        if snap is not None:
                            undo_cleanup({"restore": [snap]})
                        raise _HTTPError(400, "truncated multipart body")
                    if sink.error:
                        sink.remove()
                        if snap is not None:
                            undo_cleanup({"restore": [snap]})
                        errors.append({"name": name, "error": sink.error})
                        continue
                    try:
                        os.replace(tmp, final)   # атомарно, перезапись разрешена
                    except OSError as exc:
                        sink.remove()
                        if snap is not None:
                            undo_cleanup({"restore": [snap]})
                        _code, msg = fs_error(exc)
                        errors.append({"name": name, "error": msg})
                    else:
                        saved.append(final)
                        undo_remove.append(client)
                        if snap is not None:
                            undo_restore.append(snap)
            finally:
                # сколько байт тела реально прочитано — для _drop_body
                self._body_consumed = length - rd.left

        # --- 11/12) download и inline --------------------------------------- #
        def _api_file(self, inline):
            raw = self._q("path")
            if raw is None:
                return self._err(400, "path is required")
            got = self._require_path(raw)
            if got is None:
                return
            client, path = got
            if not os.path.exists(path):
                return self._err(404, "no such path: %s" % client)
            if not os.path.isfile(path):
                return self._err(400, "only regular files can be downloaded (folders are not supported)")
            try:
                fh = open(path, "rb")
            except PermissionError:
                return self._err(403, "permission denied")
            except OSError as exc:
                code, msg = fs_error(exc)
                return self._err(code, msg)

            name = os.path.basename(path)
            quoted = quote(name, safe="")
            disposition = "attachment; filename*=UTF-8''" + quoted
            guessed, _enc = mimetypes.guess_type(path)
            ctype = "application/octet-stream"
            if inline:
                safe = inline_safe_type(guessed)
                if safe:
                    ctype = safe
                    disposition = "inline"    # только для безопасных типов
                # небезопасное (html/xml/js/svg...) -> octet-stream + attachment

            try:
                size = os.fstat(fh.fileno()).st_size
                status, start, length = parse_range(
                    self.headers.get("Range"), size)
                if status is None:
                    # невалидный Range: 416 и честный размер
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.send_header("Accept-Ranges", "bytes")
                    if cfg["cors"]:
                        self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    fh.close()
                    return
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(length))
                self.send_header("Content-Disposition", disposition)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", "no-store")
                if status == 206:
                    self.send_header("Content-Range",
                                     "bytes %d-%d/%d"
                                     % (start, start + length - 1, size))
                if cfg["cors"]:
                    self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with fh:
                    fh.seek(start)            # докачка с позиции
                    left = length
                    while left > 0:
                        chunk = fh.read(min(CHUNK, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass                          # клиент закрыл вкладку
            except OSError:
                try:
                    fh.close()
                except OSError:
                    pass
                return

    return FMHandler


# --------------------------------------------------------------------------- #
#  FTP: собственный сервер (socketserver, без библиотек)
# --------------------------------------------------------------------------- #
# Отображаемые в LIST владелец/группа: настоящее имя процесса, если получится,
# иначе имя FTP-пользователя из конфига
try:
    import pwd as _pwd
    import grp as _grp

    _REAL_OWNER = _pwd.getpwuid(os.getuid()).pw_name
    _REAL_GROUP = _grp.getgrgid(os.getgid()).gr_name
except Exception:                                   # pragma: no cover
    _REAL_OWNER = _REAL_GROUP = None


class FTPHandler(socketserver.StreamRequestHandler):
    """Одно контрольное соединение. Корень FTP = корень HTTP: пути клиента
    лежат внутри fm_root, выход за него через .. запрещён (550)."""

    timeout = 300            # таймаут контрольного соединения, с
    # команды, разрешённые до логина
    PRE_LOGIN = {"USER", "PASS", "QUIT", "FEAT", "SYST", "NOOP", "HELP",
                 "OPTS", "STAT"}

    def setup(self):
        super(FTPHandler, self).setup()
        self.connection.settimeout(self.timeout)
        self.root = self.server.fm_root          # корень виртуального ФТП
        self.password = self.server.fm_password
        self.vcwd = "/"                          # текущий каталог (виртуальный)
        self.user = None
        self.logged_in = False
        self.fails = 0                           # неудачных попыток подряд
        self.rest = 0                            # позиция из REST (докачка)
        self.rnfr = None                         # источник для RNFR -> RNTO
        self.pasv = None                         # слушающий сокет PASV/EPSV
        self.active = None                       # адрес клиента от PORT/EPRT
        self.last_code = None                    # для лога команды
        self._closing = False
        self.started = time.time()

    def finish(self):
        try:
            super(FTPHandler, self).finish()
        except OSError:
            pass
        self._close_listener()

    # --- протокольные мелочи ---------------------------------------------- #
    def reply(self, code, text=""):
        """Однострочный ответ: 230 User logged in."""
        self.last_code = code
        try:
            self.wfile.write(("%d %s\r\n" % (code, text)).encode("utf-8",
                                                                 "replace"))
        except OSError:
            self._closing = True

    def reply_lines(self, lines):
        """Многострочный ответ: 211-...\r\n...\r\n211 End (FEAT, HELP, STAT)."""
        self.last_code = int(str(lines[-1])[:3])
        payload = "\r\n".join(lines) + "\r\n"
        try:
            self.wfile.write(payload.encode("utf-8", "replace"))
        except OSError:
            self._closing = True

    def _log(self, line, code):
        ip = self.client_address[0]
        if len(line) > 300:
            line = line[:300] + "..."
        sys.stdout.write('[ftp pid=%d] %s - "%s" -> %s\n'
                         % (PID, ip, line, code if code is not None else "-"))
        sys.stdout.flush()

    @staticmethod
    def _split_command(line):
        """Первые 4 символа — команда, всё после пробела — аргумент
        (путь с пробелами и в кавычках не портится)."""
        if len(line) > 4 and line[4] in " \t":
            head, arg = line[:4], line[5:]
        else:
            parts = line.split(None, 1)
            head = parts[0]
            arg = parts[1] if len(parts) > 1 else ""
        arg = arg.strip()
        if len(arg) >= 2 and arg[0] == '"' and arg[-1] == '"':
            arg = arg[1:-1]               # клиент прислал путь в кавычках
        return head.upper(), arg

    def handle(self):
        self.reply(220, "Nerevar FM FTP server ready.")
        while not self._closing:
            try:
                raw = self.rfile.readline(8193)
            except OSError:
                break                      # таймаут или оборванный канал
            if not raw:
                break                      # клиент ушёл
            if len(raw) > 8192 and not raw.endswith(b"\n"):
                self.reply(500, "Command line too long.")
                break
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                continue
            cmd, arg = self._split_command(line)
            try:
                self._dispatch(cmd, arg)
            except Exception as exc:       # сервер не падает ни от какой команды
                log_ftp("ошибка команды %s: %s" % (cmd, exc))
                self.reply(500, "Command failed.")
            self._log(line, self.last_code)
            if cmd == "QUIT":
                break

    def _dispatch(self, cmd, arg):
        if cmd == "QUIT":
            self.reply(221, "Goodbye.")
            return
        if not self.logged_in and cmd not in self.PRE_LOGIN:
            self.reply(530, "Please login with USER and PASS.")
            return
        handler = getattr(self, "cmd_" + cmd, None) if cmd.isalnum() else None
        if handler is None:
            self.reply(502, "Command not implemented.")
            return
        handler(arg)

    # --- виртуальные пути ---------------------------------------------------- #
    def _virtual_path(self, arg):
        """Клиентский путь -> абсолютный виртуальный путь (с "/" в начале,
        без "." и ".."). -> (True, путь) | (False, None): .. вышел за пределы
        корня — это ошибка 550, а не «нормализация»."""
        if arg and arg.startswith("/"):
            stack, comps = [], arg.split("/")
        else:
            stack = [c for c in self.vcwd.split("/") if c]
            comps = (arg or "").split("/")
        for comp in comps:
            if comp in ("", "."):
                continue
            if comp == "..":
                if not stack:
                    return False, None        # выход за корень
                stack.pop()
            else:
                stack.append(comp)
        return True, "/" + "/".join(stack)

    def _server_path(self, vpath):
        """Виртуальный путь -> серверный абсолютный внутри корня (или None)."""
        server = os.path.abspath(os.path.join(self.root, vpath[1:]))
        if server != self.root and not server.startswith(self.root + os.sep):
            return None
        if undo_hidden(server):
            return None
        return server

    def _resolve(self, arg, allow_empty=True):
        """(vpath, spath) либо None с уже отправленным ответом 550/501."""
        if arg:
            ok, vpath = self._virtual_path(arg)
            if not ok:
                self.reply(550, "Path escapes the FTP root.")
                return None
        elif allow_empty:
            vpath = self.vcwd
        else:
            self.reply(501, "Path required.")
            return None
        spath = self._server_path(vpath)
        if spath is None:
            self.reply(550, "Path escapes the FTP root.")
            return None
        return vpath, spath

    # --- канал данных -------------------------------------------------------- #
    def _data_host(self):
        """IP контрольного соединения: берём адрес своего сокета (не
        127.0.0.1, когда клиент пришёл по внешнему адресу)."""
        try:
            host = self.connection.getsockname()[0]
        except OSError:
            host = ""
        if host in ("", "0.0.0.0", "::", "::0"):
            host = self.client_address[0]
        return host

    def _close_listener(self):
        if self.pasv is not None:
            try:
                self.pasv.close()
            except OSError:
                pass
            self.pasv = None

    def _new_listener(self):
        """Слушающий сокет на IP контрольного соединения и случайном порту."""
        host = self._data_host()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind((host, 0))
            listener.listen(1)
        except OSError:
            listener.close()
            return None
        listener.settimeout(60)            # ждём подключения клиента
        self._close_listener()
        self.pasv = listener
        self.active = None
        return listener

    def _open_data(self):
        """Соединение канала данных; None — ответ 425 уже отправлен.
        В PASV 150 уходит ДО accept: часть клиентов ждёт 150 прежде чем
        подключиться, а accept и так дождётся подключения (очередь)."""
        if self.pasv is not None:
            listener, self.pasv = self.pasv, None
            self.reply(150, "Opening data connection.")
            try:
                conn, _addr = listener.accept()
            except OSError:
                listener.close()
                self.reply(425, "Cannot open data connection.")
                return None
            listener.close()
            conn.settimeout(300)
            return conn
        if self.active is not None:
            addr, self.active = self.active, None
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.settimeout(30)
            try:
                conn.connect(addr)
            except OSError:
                conn.close()
                self.reply(425, "Cannot open data connection.")
                return None
            conn.settimeout(300)
            self.reply(150, "Opening data connection.")
            return conn
        self.reply(425, "Use PASV, EPSV or PORT first.")
        return None

    # --- аутентификация -------------------------------------------------------- #
    def cmd_USER(self, arg):
        # имя принимается любое (ftp_user не обязателен), сверяется только пароль
        self.user = arg or "anonymous"
        self.fails = 0                       # новая попытка — счётчик заново
        self.reply(331, "User name okay, need password.")

    def cmd_PASS(self, arg):
        if self.user is None:
            self.reply(503, "Login with USER first.")
            return
        if hmac.compare_digest(arg.encode("utf-8"),
                               self.password.encode("utf-8")):
            self.logged_in = True
            self.fails = 0
            self.reply(230, "User logged in.")
        else:
            self.fails += 1
            self.reply(530, "Login incorrect.")
            if self.fails >= 5:             # пять подряд — закрываем вход
                self.reply(421, "Too many failed attempts, goodbye.")
                self._closing = True

    # --- служебные ------------------------------------------------------------- #
    def cmd_SYST(self, arg):
        self.reply(215, "UNIX Type: L8")

    def cmd_FEAT(self, arg):
        self.reply_lines([
            "211-Features:",
            " UTF8",
            " EPSV",
            " PASV",
            " REST STREAM",
            " SIZE",
            " MDTM",
            " MLST type*;size*;modify*;UNIX.mode*;",
            " TVFS",
            "211 End",
        ])

    def cmd_OPTS(self, arg):
        head = arg.upper()
        if head.startswith("UTF8"):
            self.reply(200, "UTF8 enabled.")
        elif head.startswith("PWD") or head.startswith("MLST") \
                or head.startswith("MDTM"):
            self.reply(200, "Option accepted.")
        else:
            self.reply(501, "Option not understood.")

    def cmd_NOOP(self, arg):
        self.reply(200, "NOOP ok.")

    def cmd_HELP(self, arg):
        self.reply_lines([
            "214-Commands:",
            " USER PASS QUIT NOOP SYST FEAT OPTS PWD CWD CDUP TYPE",
            " PASV EPSV PORT EPRT LIST NLST MLSD RETR STOR APPE DELE",
            " MKD XMKD RMD XRMD RNFR RNTO SIZE MDTM REST STAT",
            "214 End",
        ])

    def cmd_STAT(self, arg):
        if not arg:
            self.reply_lines([
                "211-Status of Nerevar FM FTP server:",
                "  Uptime: %d seconds" % int(time.time() - self.started),
                "211 End",
            ])
            return
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if not os.path.isfile(spath):
            self.reply(550, "Not a regular file.")
            return
        try:
            self.reply(213, str(os.path.getsize(spath)))
        except OSError:
            self.reply(550, "Failed to get size.")

    # --- каталоги --------------------------------------------------------------- #
    def cmd_PWD(self, arg):
        self.reply(257, '"%s" is current directory.'
                   % self.vcwd.replace('"', '""'))

    def cmd_CWD(self, arg):
        res = self._resolve(arg)
        if res is None:
            return
        vpath, spath = res
        if not os.path.isdir(spath):
            self.reply(550, "Failed to change directory.")
            return
        self.vcwd = vpath
        self.reply(250, "Directory changed.")

    def cmd_CDUP(self, arg):
        self.cmd_CWD("..")

    def cmd_TYPE(self, arg):
        head = arg.upper()
        if head.startswith("A"):
            self.reply(200, "Type set to A.")
        elif head.startswith("I") or head.startswith("L"):
            self.reply(200, "Type set to I.")
        else:
            self.reply(504, "Unsupported type.")

    # --- пассивный/активный режим ------------------------------------------------ #
    def cmd_PASV(self, arg):
        host = self._data_host()
        if "." not in host:
            self.reply(522, "Network protocol not supported, use EPSV.")
            return
        listener = self._new_listener()
        if listener is None:
            self.reply(425, "Cannot open passive connection.")
            return
        port = listener.getsockname()[1]
        h = host.split(".")
        self.reply(227, "Entering Passive Mode (%s,%s,%s,%s,%d,%d)"
                   % (h[0], h[1], h[2], h[3], port >> 8, port & 0xFF))

    def cmd_EPSV(self, arg):
        listener = self._new_listener()
        if listener is None:
            self.reply(425, "Cannot open passive connection.")
            return
        self.reply(229, "Entering Extended Passive Mode (|||%d|)"
                   % listener.getsockname()[1])

    def cmd_PORT(self, arg):
        parts = arg.split(",")
        if len(parts) != 6:
            self.reply(501, "Bad PORT command.")
            return
        try:
            nums = [int(p) for p in parts]
        except ValueError:
            self.reply(501, "Bad PORT command.")
            return
        if any(n < 0 or n > 255 for n in nums):
            self.reply(501, "Bad PORT command.")
            return
        port = nums[4] * 256 + nums[5]
        if port == 0:
            self.reply(501, "Bad PORT command.")
            return
        self._close_listener()
        self.active = ("%d.%d.%d.%d" % tuple(nums[:4]), port)
        self.reply(200, "PORT command successful.")

    def cmd_EPRT(self, arg):
        parts = arg.split("|")
        if len(parts) < 4 or parts[1] not in ("1", "2"):
            self.reply(501, "Bad EPRT command.")
            return
        try:
            port = int(parts[3])
        except ValueError:
            self.reply(501, "Bad EPRT command.")
            return
        if not 0 < port < 65536:
            self.reply(501, "Bad EPRT command.")
            return
        self._close_listener()
        self.active = (parts[2], port)
        self.reply(200, "EPRT command successful.")

    # --- листинги (LIST / NLST / MLSD) ---------------------------------------- #
    def _row_unix(self, name, st):
        """Строка ls -l: `-rw-r--r--   1 nerevar  nerevar  ... имя`."""
        is_dir = stat.S_ISDIR(st.st_mode)
        size = 0 if is_dir else st.st_size
        owner = _REAL_OWNER or self.server.fm_user
        group = _REAL_GROUP or self.server.fm_user
        t = time.localtime(st.st_mtime)
        age = time.time() - st.st_mtime
        if age > 15552000 or age < -86400:        # старше полугода — год
            date = "%s %2d  %s" % (time.strftime("%b", t), t.tm_mday,
                                   time.strftime("%Y", t))
        else:
            date = "%s %2d %02d:%02d" % (time.strftime("%b", t), t.tm_mday,
                                          t.tm_hour, t.tm_min)
        return "%s %3d %-8s %-8s %13d %s %s" % (
            stat.filemode(st.st_mode), st.st_nlink, owner, group,
            size, date, name)

    def _row_mlsd(self, name, st, typ):
        """Строка MLSD: `type=file;size=123;modify=20261126180000; имя`."""
        if typ in ("cdir", "pdir") or stat.S_ISDIR(st.st_mode):
            facts = ["type=" + ("cdir" if typ == "cdir" else
                                "pdir" if typ == "pdir" else "dir"),
                     "size=0"]
        else:
            facts = ["type=file", "size=%d" % st.st_size]
        facts.append("modify=%s" % time.strftime("%Y%m%d%H%M%S",
                                                  time.gmtime(st.st_mtime)))
        facts.append("UNIX.mode=%04o" % stat.S_IMODE(st.st_mode))
        return "%s %s" % (";".join(facts) + ";", name)

    def _collect(self, spath, vpath):
        """Собрать записи каталога [(имя, путь, st, тип)] — папки (включая
        "." и "..") потом файлы, внутри по имени без учёта регистра.
        None — ошибка (ответ уже отправлен)."""
        if os.path.isdir(spath):
            try:
                names = sorted(os.listdir(spath), key=lambda n: n.lower())
            except OSError:
                self.reply(550, "Failed to open directory.")
                return None
            entries = []
            for special, typ in ((".", "cdir"), ("..", "pdir")):
                full = os.path.join(spath, special)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                entries.append((special, full, st, typ))
            for name in names:
                full = os.path.join(spath, name)
                if undo_hidden(full):
                    continue
                try:
                    st = os.stat(full)          # симлинк -> цель
                except OSError:
                    try:
                        st = os.lstat(full)     # битый симлинк
                    except OSError:
                        continue
                kind = "dir" if stat.S_ISDIR(st.st_mode) else "file"
                entries.append((name, full, st, kind))
            entries.sort(key=lambda e: (e[3] not in ("dir", "cdir", "pdir"),
                                        e[0].lower()))
            return entries
        if not os.path.exists(spath) and not os.path.islink(spath):
            self.reply(550, "Failed to open directory.")
            return None
        try:
            st = os.stat(spath)
        except OSError:
            self.reply(550, "Failed to open directory.")
            return None
        # листинг обычного файла — ровно одна его строка
        return [(os.path.basename(spath) or vpath, spath, st, "file")]

    def _send_listing(self, lines):
        """Отправить готовые строки каналом данных."""
        conn = self._open_data()
        if conn is None:
            return
        try:
            conn.sendall(("".join(l + "\r\n" for l in lines))
                         .encode("utf-8", "replace"))
        except OSError:
            conn.close()
            self.reply(426, "Connection closed; transfer aborted.")
            return
        conn.close()
        self.reply(226, "Transfer complete.")

    def _list_cmd(self, arg, kind):
        path_arg = arg
        if path_arg.startswith("-"):             # флаги вида "-la" не нужны
            parts = path_arg.split(None, 1)
            path_arg = parts[1] if len(parts) > 1 else ""
        res = self._resolve(path_arg)
        if res is None:
            return
        vpath, spath = res
        entries = self._collect(spath, vpath)
        if entries is None:
            return
        lines = []
        for name, full, st, typ in entries:
            if kind == "nlst":
                lines.append(name)
            elif kind == "mlsd":
                lines.append(self._row_mlsd(name, st, typ))
            else:
                lines.append(self._row_unix(name, st))
        self._send_listing(lines)

    def cmd_LIST(self, arg):
        self._list_cmd(arg, "list")

    def cmd_NLST(self, arg):
        self._list_cmd(arg, "nlst")

    def cmd_MLSD(self, arg):
        self._list_cmd(arg, "mlsd")

    # --- передача файлов -------------------------------------------------------- #
    def cmd_RETR(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if not os.path.isfile(spath):
            self.reply(550, "Failed to open file.")
            return
        try:
            fh = open(spath, "rb")
        except OSError:
            self.reply(550, "Failed to open file.")
            return
        offset, self.rest = self.rest, 0
        if offset:
            try:
                fh.seek(offset)                 # докачка по REST
            except OSError:
                fh.close()
                self.reply(550, "Failed to open file.")
                return
        conn = self._open_data()
        if conn is None:
            fh.close()
            return
        failed = False
        try:
            while True:
                chunk = fh.read(CHUNK)          # стриминг кусками 64 КБ
                if not chunk:
                    break
                conn.sendall(chunk)
        except OSError:
            failed = True
        finally:
            fh.close()
        conn.close()
        if failed:
            self.reply(426, "Connection closed; transfer aborted.")
        else:
            self.reply(226, "Transfer complete.")

    def _store(self, arg, append):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        offset, self.rest = self.rest, 0
        if append:
            mode = "ab"
        elif offset > 0:
            mode = "r+b"                        # докачка в существующий
        else:
            mode = "wb"
        try:
            fh = open(spath, mode)
        except OSError:
            if mode != "r+b":
                self.reply(550, "Cannot create file.")
                return
            try:
                fh = open(spath, "wb")          # REST по несуществующему
            except OSError:
                self.reply(550, "Cannot create file.")
                return
            offset = 0
        if offset:
            try:
                fh.seek(offset)
            except OSError:
                fh.close()
                self.reply(550, "Cannot create file.")
                return
        conn = self._open_data()
        if conn is None:
            fh.close()
            return
        failed = False
        try:
            while True:
                chunk = conn.recv(CHUNK)        # пишем на диск, не в память
                if not chunk:
                    break
                fh.write(chunk)
        except OSError:
            failed = True
        finally:
            fh.close()
        conn.close()
        if failed:
            self.reply(426, "Connection closed; transfer aborted.")
        else:
            self.reply(226, "Transfer complete.")

    def cmd_STOR(self, arg):
        self._store(arg, append=False)

    def cmd_APPE(self, arg):
        self._store(arg, append=True)

    # --- файловые операции ------------------------------------------------------ #
    def cmd_DELE(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if not os.path.exists(spath) and not os.path.islink(spath):
            self.reply(550, "No such file or directory.")
            return
        try:
            os.remove(spath)
        except OSError:
            self.reply(550, "Delete failed.")
            return
        self.reply(250, "DELE command successful.")

    def cmd_MKD(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        vpath, spath = res
        try:
            os.mkdir(spath)
        except OSError:
            self.reply(550, "Cannot create directory.")
            return
        self.reply(257, '"%s" created.' % vpath.replace('"', '""'))

    def cmd_XMKD(self, arg):
        self.cmd_MKD(arg)

    def cmd_RMD(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if spath == self.root:
            self.reply(550, "Cannot remove the root directory.")
            return
        try:
            os.rmdir(spath)
        except OSError:
            self.reply(550, "Remove directory failed.")
            return
        self.reply(250, "RMD command successful.")

    def cmd_XRMD(self, arg):
        self.cmd_RMD(arg)

    def cmd_RNFR(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if not os.path.exists(spath) and not os.path.islink(spath):
            self.reply(550, "No such file or directory.")
            return
        self.rnfr = spath
        self.reply(350, "Ready for destination path.")

    def cmd_RNTO(self, arg):
        if not self.rnfr:
            self.reply(503, "RNFR required first.")
            return
        src, self.rnfr = self.rnfr, None
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, dst = res
        if os.path.exists(dst) or os.path.islink(dst):
            self.reply(550, "Target already exists.")
            return
        try:
            os.rename(src, dst)
        except OSError:
            self.reply(550, "Rename failed.")
            return
        self.reply(250, "RNTO command successful.")

    def cmd_SIZE(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        if not os.path.isfile(spath):
            self.reply(550, "Not a regular file.")
            return
        try:
            self.reply(213, str(os.path.getsize(spath)))
        except OSError:
            self.reply(550, "Failed to get size.")

    def cmd_MDTM(self, arg):
        res = self._resolve(arg, allow_empty=False)
        if res is None:
            return
        _v, spath = res
        try:
            st = os.stat(spath)
        except OSError:
            self.reply(550, "No such file or directory.")
            return
        self.reply(213, time.strftime("%Y%m%d%H%M%S",
                                      time.gmtime(st.st_mtime)))

    def cmd_REST(self, arg):
        try:
            offset = int(arg.strip())
        except (ValueError, AttributeError):
            self.reply(501, "Invalid REST parameter.")
            return
        if offset < 0:
            self.reply(501, "Invalid REST parameter.")
            return
        self.rest = offset
        self.reply(350, "Restarting at %d." % offset)


class FMFTPServer(socketserver.ThreadingTCPServer):
    """FTP-сервер: поток на каждое контрольное соединение, общий корень/пароль."""

    allow_reuse_address = True      # перезапуск без ожидания TIME_WAIT
    daemon_threads = True           # не мешать завершению процесса

    def __init__(self, addr, root, password, user):
        self.fm_root = root
        self.fm_password = password
        self.fm_user = user
        socketserver.ThreadingTCPServer.__init__(self, addr, FTPHandler)

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError,
                            socket.timeout)):
            return                      # клиент просто отвалился
        log_ftp("ошибка соединения с %s: %s" % (client_address[0], exc))


# --------------------------------------------------------------------------- #
#  Запуск: конфиг, флаги, pidfile, сигналы
# --------------------------------------------------------------------------- #
def generate_password(length=12):
    """Случайный пароль без похожих символов (0/O, 1/l/I)."""
    alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def parse_args():
    parser = argparse.ArgumentParser(
        description="Nerevar FM: веб-файловый менеджер + встроенный FTP "
                    "(только стандартная библиотека Python)")
    parser.add_argument("--host", default=None,
                        help="адрес привязки HTTP (config.json: http_host; "
                             "по умолчанию 0.0.0.0)")
    parser.add_argument("--port", type=int, default=None,
                        help="порт HTTP (config.json: http_port; "
                             "по умолчанию 8090)")
    parser.add_argument("--root", default=None, metavar="PATH",
                        help="корень файлов для панели и FTP "
                             "(config.json: root; по умолчанию /)")
    parser.add_argument("--password", default=None,
                        help="пароль API и FTP (config.json: password; "
                             "если нигде не задан — генерируется случайный)")
    parser.add_argument("--ftp-port", type=int, default=None,
                        help="порт FTP (config.json: ftp_port; "
                             "по умолчанию 2121)")
    parser.add_argument("--ftp-user", default=None,
                        help="логин FTP (config.json: ftp_user; "
                             "по умолчанию nerevar)")
    parser.add_argument("--no-ftp", action="store_true",
                        help="не поднимать FTP-сервер")
    parser.add_argument("--config", default=CONFIG_JSON_PATH, metavar="PATH",
                        help="путь к config.json (по умолчанию %s)"
                             % CONFIG_JSON_PATH)
    parser.add_argument("--pidfile", default=None, metavar="PATH",
                        help="куда записать PID (по умолчанию server.pid "
                             "рядом со скриптом)")
    parser.add_argument("--no-pidfile", action="store_true",
                        help="не создавать pidfile")
    parser.add_argument("--cors", action="store_true",
                        help="добавить Access-Control-Allow-Origin: * "
                             "(нужно, только если открывать index.html "
                             "с диска file://)")
    return parser.parse_args()


def main():
    args = parse_args()
    cfg_file = load_json_file(args.config) or {}

    # приоритет: флаги > config.json > встроенные дефолты
    def pick(flag, key, default):
        if flag is not None:
            return flag
        value = cfg_file.get(key, default)
        return default if value is None else value

    host = str(pick(args.host, "http_host", CONFIG_DEFAULTS["http_host"]))
    port = int(pick(args.port, "http_port", CONFIG_DEFAULTS["http_port"]))
    ftp_host = str(cfg_file.get("ftp_host") or CONFIG_DEFAULTS["ftp_host"])
    ftp_port = int(pick(args.ftp_port, "ftp_port",
                        CONFIG_DEFAULTS["ftp_port"]))
    ftp_user = str(pick(args.ftp_user, "ftp_user",
                        CONFIG_DEFAULTS["ftp_user"]))
    ftp_enabled = (not args.no_ftp) and \
        bool(cfg_file.get("ftp_enabled", CONFIG_DEFAULTS["ftp_enabled"]))
    root = os.path.abspath(str(pick(args.root, "root", "/")))

    password = args.password if args.password is not None \
        else cfg_file.get("password")
    generated = False
    if not password:
        # пароль нигде не задан — генерируем и ОБЯЗАТЕЛЬНО показываем в логе
        password = generate_password(12)
        generated = True
    password = str(password)
    weak = password == "changeme"

    cfg = {
        "password": password,
        "root": root,
        "cors": bool(args.cors),
        "ftp_enabled": ftp_enabled,
        "ftp_port": ftp_port,
        "ftp_user": ftp_user,
        "places": place_defaults(cfg_file.get("places")),
    }

    if not os.path.isfile(INDEX_PATH):
        print("[%s pid=%d] ВНИМАНИЕ: нет index.html рядом с server.py (%s) — "
              "страница будет 404" % (PROC_NAME, PID, INDEX_PATH),
              file=sys.stderr)
    if not os.path.isdir(root):
        print("[%s pid=%d] ВНИМАНИЕ: корень %s не существует — списки будут "
              "отдавать 404" % (PROC_NAME, PID, root), file=sys.stderr)

    handler = make_handler(cfg)
    try:
        server = ThreadingHTTPServer((host, port), handler)
    except OSError as exc:
        print("[%s pid=%d] не удалось занять %s:%d: %s"
              % (PROC_NAME, PID, host, port, exc), file=sys.stderr)
        sys.exit(1)
    server.daemon_threads = True

    # --- FTP (при ошибке bind сервер панели продолжает работать) ------------ #
    ftp_server = None
    if ftp_enabled:
        try:
            ftp_server = FMFTPServer((ftp_host, ftp_port), root, password,
                                     ftp_user)
        except OSError as exc:
            log("FTP не поднят на %s:%d: %s — продолжаем без FTP"
                % (ftp_host, ftp_port, exc))
            cfg["ftp_enabled"] = False
    if ftp_server is not None:
        threading.Thread(target=ftp_server.serve_forever,
                         kwargs={"poll_interval": 0.5}, daemon=True,
                         name="ftp-server").start()

    # --- pidfile: процесс видно и его можно убить --------------------------- #
    pid_path = None
    if not args.no_pidfile:
        pid_file = args.pidfile or DEFAULT_PIDFILE
        candidate = os.path.abspath(pid_file)
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
                    return           # в файле pid другого запуска — не трогаем
            os.remove(pid_path)
        except OSError:
            pass

    def shutdown(signum, _frame):
        log("получен сигнал %s — останавливаемся" % signum)

        def _stop():
            server.shutdown()
            if ftp_server is not None:
                ftp_server.shutdown()

        threading.Thread(target=_stop, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # --- приветствие --------------------------------------------------------- #
    log("Nerevar FM запущен: http://%s:%d" % (host, port))
    print("  страница   : /  -> %s%s"
          % (INDEX_PATH, "" if os.path.isfile(INDEX_PATH)
             else "  (файла пока нет!)"))
    print("  API        : /api/*")
    if ftp_server is not None:
        print("  FTP        : %s:%d (user %s)" % (ftp_host, ftp_port, ftp_user))
    else:
        print("  FTP        : выключен")
    print("  корень     : %s" % root)
    print("  места      : %s"
          % (PLACES_PATH if os.path.isfile(PLACES_PATH)
             else "дефолты из config.json"))
    print("  остановить : kill %d" % PID)
    if pid_path:
        print("             kill $(cat %s)" % pid_path)
    if generated:
        print("  " + "=" * 58)
        print("  СЛУЧАЙНЫЙ ПАРОЛЬ ДЛЯ ВХОДА И FTP (запишите его!):")
        print("      %s" % password)
        print("  " + "=" * 58)
    elif weak:
        print("  " + "!" * 58)
        print("  !!! ПАРОЛЬ = \"changeme\" — СМЕНИ ПАРОЛЬ !!!")
        print("  config.json попадает в git: там не должно быть рабочего")
        print("  пароля. Задайте его флагом --password либо правкой")
        print("  config.json вне репозитория.")
        print("  " + "!" * 58)
    sys.stdout.flush()

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        if ftp_server is not None:
            ftp_server.server_close()
        remove_pidfile()
        log("остановлено")


if __name__ == "__main__":
    main()
