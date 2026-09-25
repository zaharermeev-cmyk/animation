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

## Интро
Пустой экран → от центра материализуются плитки (со светящимся фронтом) → на полу материализуется сцена.
Тайминги — `intro` в `DEFAULTS` (`src/veil-background.js`). `bg.replay()` ## Сцена: шахтёр и лиса
`src/scene.js` — после плиток материализуется шахтёр со своей кучкой монет и долбит киркой кучу земли;
прибегает лиса в маске, утаскивает монеты и убегает налево вглубь пола (в обход окна входа). Цикл ~12 с, повторяется. Рисуется линиями цвета `--scene-ink`,
поэтому подстраивается под тему.
```html
<script src="src/scene.js"></script>
<script>bg.scene = new MinerScene(bg);</script>
```
`bg.scene.toggle()` / `bg.scene.setEnabled(false)` — выключить. Тайминги — объект `T` в начале `scene.js`,
расстановка и количество — константы `Z`, `MINER_X`, `PILE_START`, `STEAL`, `MOUND_SCALE` рядом.

## Тема
Цвета задаются в `src/veil.css` через переменные `--veil-*`. Тема переключается атрибутом `data-theme="light|dark"` на `<html>`.
