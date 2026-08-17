# Referencia rápida de endpoints

Prefijo: `/api/v1`. Auth: **API key** = `Authorization: Api-Key <key>` (backend del
operador); **Session token** = `Authorization: Bearer <token>` (iframe); **JWT** =
cuentas internas (jugador / master / operador-backoffice).

## Operador (consumo de la API) — API key

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/provider/games/` | Catálogo asignado al operador. |
| POST | `/provider/launch/` | Abre sesión → `session_token` + `embed_url`. |
| POST | `/spin/` | Giro servidor-a-servidor (opcional; normalmente se usa el iframe). |

## Iframe — Session token

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/embed/state/` | Estado inicial del juego (tema, rejilla, apuestas, saldo). |
| POST | `/embed/spin/` | Ejecuta un tiro. |

## Back office del operador (login propio) — JWT

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login/` | Login (devuelve rol OPERATOR + tokens). |
| GET | `/operator/me/` | Resumen (GGR por moneda + USD) del propio operador. |
| GET | `/operator/me/spins/` | Giros del operador (paginado). |
| GET | `/operator/me/players/` | Jugadores del operador (paginado). |

## Master (administración de la plataforma) — JWT master

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/master/games/` | Lista / crea juegos. |
| POST | `/master/games/build/` | Crea un juego totalmente configurable. |
| PATCH | `/master/games/<slug>/theme/` | Edita el tema visual. |
| POST | `/master/games/<slug>/simulate/` | Verifica el RTP (Monte Carlo). |
| POST | `/master/games/<slug>/asset/<field>/` | Sube un asset del juego. |
| POST | `/master/games/<slug>/symbols/<code>/asset/` | Sube el sprite de un símbolo. |
| GET/POST | `/master/operators/` | Lista / crea operadores. |
| GET/POST | `/master/operators/<code>/keys/` | API keys del operador. |
| GET/POST | `/master/operators/<code>/games/` | Catálogo asignado al operador. |
| GET/POST | `/master/operators/<code>/users/` | Cuentas de acceso (back office). |
| POST | `/master/operators/<code>/users/<id>/password/` | Cambia contraseña. |
| GET | `/master/operators/<code>/plays/` | Resumen del operador. |
| GET | `/master/operators/<code>/spins/` | Giros del operador (paginado). |
| GET | `/master/operators/<code>/players/` | Jugadores del operador (paginado). |
| GET | `/master/reports/operators/` | Overview global de operadores en USD. |
| GET | `/master/players/` | Jugadores internos (paginado). |
| GET | `/master/audit/` | Log de auditoría (paginado). |

## Paginación

Las rutas paginadas aceptan `?page=<n>&page_size=<n>` (máx. 100) y devuelven:

```json
{ "results": [ ... ], "page": 1, "page_size": 25,
  "total": 1234, "total_pages": 50, "has_next": true, "has_prev": false }
```
