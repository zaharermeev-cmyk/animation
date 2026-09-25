# Veil Background — прототип

Анимированный фон: ровный 3D-пол из ромбовидных плиток, уходящий в темноту, и сцена на нём — шахтёр и лиса.

## Как посмотреть

**Онлайн (GitHub Pages):** https://zaharermeev-cmyk.github.io/animation/
(включается один раз: Settings → Pages → Source: Deploy from a branch → ветка `claude/privet-ehowzu`, папка `/ (root)` → Save).

**На компьютере:** Code → Download ZIP → распаковать → открыть `index.html` двойным кликом. Сервер не нужен.

## Подключение на свой сайт
```html
<link rel="stylesheet" href="src/veil.css">
<canvas class="veil-canvas" id="veil"></canvas>
<script src="src/veil-background.js"></script>
<script>new VeilBackground(document.getElementById('veil')).start();</script>
```

## Цикл
Лиса-логотип появляется → дрожит и разлетается на осколки → осколки падают на пол, и из мест падения проявляются плитки → через 2 с шахтёр и сцена с лисой → осколки поднимаются с пола и собираются обратно в лису, плитки гаснут → всё заново.
Окно входа включено по умолчанию, и разлетается именно логотип над названием: после разрыва его нет, он возвращается только при сборке в конце. Модуль — `src/logo-burst.js`.
Настройки: `intro`, `outro`, `loop` в `DEFAULTS` (`src/veil-background.js`); задержка шахтёра — `start` в `src/scene.js`.
`bg.replay()` — начать цикл заново.

## Сцена: шахтёр и лиса
`src/scene.js` — после плиток материализуется шахтёр со своей кучкой монет и долбит киркой кучу земли;
прибегает лиса в маске, утаскивает монеты и убегает налево вглубь пола (в обход окна входа). Длится ~12 с, затем весь фон начинается заново. Рисуется линиями цвета `--scene-ink`,
поэтому подстраивается под тему.
```html
<script src="src/scene.js"></script>
<script>bg.scene = new MinerScene(bg);</script>
```
`bg.scene.toggle()` / `bg.scene.setEnabled(false)` — выключить. Тайминги — объект `T` в начале `scene.js`,
расстановка и количество — константы `Z`, `MINER_X`, `PILE_START`, `STEAL`, `MOUND_SCALE` рядом.

## Эффекты (тумблеры)
В демо — панель «Эффекты» справа, выбор запоминается в браузере. Из кода:
```js
bg.scene = new MinerScene(bg, { fx: { paws: true, guard: true } });
bg.scene.setFx('schema', true); bg.restartScene();
```
| ключ | что делает |
|---|---|
| `paws` | светящиеся следы лап, постепенно гаснут |
| `schema` | «схема» на плитках: узлы и пунктирные связи |
| `guard` | спящий охранник с «Zzz», лиса крадётся мимо на цыпочках |
| `flashlight` | курсор — фонарик; наведи на лису — испугается и убежит без добычи |

## Тема
Цвета задаются в `src/veil.css` через переменные `--veil-*`. Тема переключается атрибутом `data-theme="light|dark"` на `<html>`.
