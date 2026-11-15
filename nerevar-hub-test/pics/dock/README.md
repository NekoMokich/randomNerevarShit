# Папка `pics/dock/`

Иконки для плиток дока в альтернативном виде панели (`openstep.html`).
Положи сюда картинку (png, gif, svg, ico, bmp, jpg, webp) и укажи её
в `dock.json`:

```json
{ "icons": { "winServers": "pics/dock/server.png" } }
```

Путь пишется **от корня панели**, то есть с префиксом `pics/dock/`.
Пустое значение в `dock.json` или отсутствие ключа — на плитке остаётся
буква.

В `dock.json` уже перечислены все id окон панели: `winServers`,
`winMonitor`, `winMusic`, `winArt`…`winArt6` (просмотрщики),
`winTerm`…`winTerm6` (терминалы), `winNetwork` (сеть), `winDownloads`
(загрузчик) — просто записывай значения в
существующие ключи.

Сервер отдаёт содержимое папки как `/pics/dock/<имя файла>`; файлы
картинок в git не попадают (см. `.gitignore`) — в репозиторий уходит
только этот README.
