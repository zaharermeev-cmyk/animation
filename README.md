# Veil Background — прототип

Анимированный фон по референсу: ровный пол из ромбовидных плиток, уходящий в темноту, водяные вуали (прозрачные голубые ленты с бликами), золотые волокна с огоньками на кончиках, свободные завитки и искры. Есть светлая и тёмная темы.

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
Тайминги — `intro` в `DEFAULTS` (`src/veil-background.js`). `bg.replay()` ## Вуали
```js
bg.setVeils(false);  // выключить (плавно), true — включить
bg.toggleVeils();    // переключить, возвращает новое состояние
new VeilBackground(canvas, { veils: false }); // стартовать без вуалей
```
`reach` в `DEFAULTS` — докуда вуали тянутся от центра (1 — до края экрана).

## Сцена: шахтёр и лиса
`src/scene.js` — после плиток материализуется шахтёр, копает монеты в кучку; прибегает лиса в маске,
утаскивает монеты и убегает вглубь пола. Цикл ~12 с, повторяется. Рисуется линиями цвета `--scene-ink`,
поэтому подстраивается под тему.
```html
<script src="src/scene.js"></script>
<script>bg.scene = new MinerScene(bg);</script>
```
`bg.scene.toggle()` / `bg.scene.setEnabled(false)` — выключить. Тайминги — объект `T` в начале `scene.js`,
расстановка — константы `Z`, `MINER_X`, `PILE_X` рядом.

## Тема
Цвета задаются в `src/veil.css` через переменные `--veil-*`. Тема переключается атрибутом `data-theme="light|dark"` на `<html>`.
