# igaming-slot-client

Cliente React + Phaser 3 del slot 3×3. Se embebe en casinos vía iframe.

## Principio

El cliente **solo renderiza** lo que el backend decidió. Nunca calcula premios:
llama a `POST /api/v1/spin/`, recibe la matriz + premios y anima el resultado.

## Requisitos

- Node 18+.
- El backend Django corriendo (por defecto en `http://127.0.0.1:8010`).
- Una `GameSession` demo (la imprime `python manage.py seed_demo_game`).

## Puesta en marcha

```bash
cd frontend
npm install
cp .env.example .env.local     # pon el VITE_GAME_SESSION que imprimió el seed
npm run dev                    # http://localhost:5173
```

En desarrollo, Vite hace de proxy de `/api` hacia Django (evita CORS). En
producción/iframe, define `VITE_API_BASE` con la URL del backend.

## Estructura

```
src/
├── App.tsx                      # lee config de entorno y monta el canvas
├── components/SlotGameCanvas.tsx# wrapper React: crea/destruye Phaser limpio
├── api/spinApi.ts               # cliente de POST /api/v1/spin/
└── game/
    ├── config.ts                # config de Phaser (Scale.FIT, mobile-first)
    ├── constants.ts             # dimensiones, símbolos, líneas de pago
    ├── sfx.ts                    # audio sintetizado (Web Audio, sin binarios)
    ├── Reel.ts                   # carrete: giro + frenado easeOut al objetivo
    └── scenes/
        ├── PreloadScene.ts       # genera texturas placeholder / carga assets
        └── SlotScene.ts          # juego: giro, líneas ganadoras, Big Win
```

## Assets

El demo genera texturas placeholder en runtime. Para arte real, coloca los
archivos en `public/assets/` y descomenta las cargas en `PreloadScene.preload()`
(spritesheets de símbolos 3×3, marco, audio, botones).

## Notas

- Diseñado para el juego demo **3×3 LINES** (`demo-lines-3x3`). Un 5×3 WAYS
  necesitaría una escena con rejilla más ancha (evolución futura).
- El audio se desbloquea con la primera interacción (política de navegadores).
