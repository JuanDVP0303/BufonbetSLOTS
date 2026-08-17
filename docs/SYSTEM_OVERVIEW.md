# Visión general del sistema

Plataforma de **proveedor de slots**: crea juegos de tragamonedas, los expone por API
y permite que operadores (casinos) los muestren en sus sitios, con datos aislados por
operador y reportes.

## Componentes

- **Backend** — Django + DRF + PostgreSQL. Calcula el resultado de cada tiro en el
  servidor (autoritativo); el cliente solo renderiza.
- **Frontend** — React + Phaser 3. Panel de administración (master), portal del
  operador, y el cliente de juego (canvas) embebible por iframe.

## Actores y accesos

| Rol | Acceso | Ve |
|---|---|---|
| **Master** (proveedor) | Panel de administración | Todo: juegos, operadores, jugadores, auditoría, reportes globales. |
| **Operador** | Back office propio (login) | Solo SUS datos: giros, jugadores, GGR. |
| **Jugador** | Iframe (vía operador) | El juego. |

## Motor de juego

- **Puro y certificable** (`app_game/engine.py`): opera sobre bandas (reel strips),
  paytable y líneas; sin dependencias de Django. RNG CSPRNG en producción.
- **RTP** emerge del diseño de bandas + paytable; **no** se ajusta en caliente por
  jugador (eso sería fraude / no certificable). Se **verifica** con Monte Carlo
  (`simulate_rtp`), incluyendo la contribución de las tiradas gratis.
- **Modos:** `LINES` (líneas de pago) y `WAYS` (adyacencia). Rejilla configurable
  (3×3, 5×3, 6×5…).
- **Mecánicas:** comodín (wild), scatter + **tiradas gratis** (free spins con
  multiplicador y re-disparo), y drop jackpot.

## Multi-tenant (operadores)

- `Operator` + `OperatorApiKey` (hash) + `OperatorGame` (catálogo por operador).
- Aislamiento: cada operador solo lanza sus juegos asignados y solo ve sus datos.
- **Multimoneda:** la moneda se decide por sesión (en el launch). Importes en unidades
  menores; conversión a USD solo para reporting (tasas en `FxRate`, cargador
  `load_fx_rates`).

## Flujo de integración (seamless-ready)

1. Operador consume `/provider/games/` (catálogo) y lo guarda.
2. Operador llama `/provider/launch/` → recibe `session_token` + `embed_url`.
3. Operador incrusta el `embed_url` en un iframe.
4. El iframe juega vía `/embed/state/` y `/embed/spin/` con el session token.

En **demo/fun-money** el saldo lo lleva la plataforma (`PlayerSession.demo_balance`).
En **dinero real**, el saldo vive en la billetera del operador y se mueve por HTTP
(patrón *seamless wallet* con idempotencia); el resto del flujo no cambia.

## Certificación (dinero real)

Cada matemática (bandas + paytable + versión) se certifica por juego/jurisdicción. El
reskin (arte, colores, logo) **no** toca la matemática, así que no re-dispara la
certificación. La auditoría de tiros es un log append-only encadenado por hash.

Ver la **[Guía de integración](API_INTEGRATION.md)** para el detalle de la API.
