# Veil Background — прототип

Анимированный фон по референсу: ровный пол из ромбовидных плиток, уходящий в темноту, вуали из дымчатого шёлка и пучков волокон с огоньками на кончиках, свободные завитки и искры. Есть светлая и тёмная темы.

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
Пустой экран → от центра материализуются плитки (со светящимся фронтом) → из центра вырастают вуали → появляются искры.
Тайминги — `intro` в `DEFAULTS` (`src/veil-background.js`). `bg.replay()` ## Объекты на поверхности
```js
bg.place(el, { x: -6.5, z: -3, height: 2.2 }); // x — вбок, z — вглубь, 0,0 — центр
```
Нижний центр элемента ставится на поверхность. Размер зависит от глубины, под объектом рисуется контактная тень. В демо объекты включаются кнопкой «Объекты».

## Тема
Цвета задаются в `src/veil.css` через переменные `--veil-*`. Тема переключается атрибутом `data-theme="light|dark"` на `<html>`.
