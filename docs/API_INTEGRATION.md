# Guía de integración para operadores

Esta guía explica cómo un **operador** (casino) integra y muestra nuestros juegos
(slots) consumiendo nuestra **API de proveedor**. Está pensada para el equipo técnico
del operador.

> **Modo actual: demo / fun-money.** El saldo del jugador lo gestiona nuestra
> plataforma con saldo de demostración. La integración con la billetera real del
> operador (dinero real, *seamless wallet*) es el paso siguiente y se describe al
> final. Todo lo demás (catálogo, lanzamiento, iframe, giros) es idéntico en ambos
> modos, así que integrar ahora deja el trabajo hecho.

---

## 1. Conceptos

| Concepto | Qué es |
|---|---|
| **Proveedor** | Nosotros. Creamos y alojamos los juegos; exponemos esta API. |
| **Operador** | Tú. Muestras nuestros juegos en tu sitio e integras por API. |
| **API key** | Credencial **servidor-a-servidor** del operador. Autentica a tu backend. **Nunca debe salir al navegador.** |
| **Session token** | Token corto ligado a una sesión de juego concreta. Es lo que usa el **iframe** (navegador). No expone tu API key. |
| **`external_player_id`** | El identificador del jugador **en tu sistema**. Nosotros no gestionamos tu login; tú nos pasas este id. |
| **Unidades menores** | Todos los importes son enteros en la unidad mínima de la moneda (céntimos). Ver §6. |

### Arquitectura (flujo recomendado, con iframe)

```
Tu backend ──(API key, servidor)──► POST /provider/launch/
     │                                   └─► { session_token, embed_url, ... }
     └─ incrusta:  <iframe src="{embed_url}">
                        │
   El iframe ──(Bearer session_token, navegador)──► GET  /embed/state/   (tema, rejilla, apuestas, saldo)
                                              └────► POST /embed/spin/    (tirar)
```

**Regla de oro:** la **API key** solo la usa tu **backend**. El **navegador** solo usa
el **session token** (que tu backend obtiene en el launch y pasa a la URL del iframe).

---

## 2. Base URL y versión

```
https://<tu-dominio-proveedor>/api/v1
```

Todas las rutas de esta guía cuelgan de ese prefijo. En integración local de pruebas
será algo como `http://localhost:8010/api/v1`.

---

## 3. Autenticación (API key)

Tu backend envía la API key en la cabecera `Authorization`:

```
Authorization: Api-Key <tu_api_key>
```

(Alternativa equivalente: cabecera `X-Operator-Key: <tu_api_key>`.)

La API key te la entregamos nosotros desde el panel. **Guárdala como un secreto**
(gestor de secretos / variable de entorno), nunca en el frontend ni en el repositorio.

---

## 4. Endpoints

### 4.1 Catálogo — `GET /provider/games/`

Devuelve **los juegos que tienes asignados** (tu catálogo). Guárdalos de tu lado y
renderiza tu lobby con ellos. El `slug` es el identificador estable que usarás al
lanzar.

**Autenticación:** API key.

**Respuesta 200:**

```json
[
  {
    "slug": "a-todo-gas",
    "title": "A Todo Gas",
    "description": "",
    "grid": { "cols": 5, "rows": 3 },
    "win_mode": "WAYS",
    "background_color": "#101827",
    "thumbnail": "https://.../media/themes/thumbs/atg.png",
    "currencies": ["CLP", "COP", "EUR", "MXN", "USD"]
  }
]
```

- `currencies`: monedas en las que ese juego acepta apuestas. **Debes lanzar en una de ellas.**
- `thumbnail`: URL absoluta de la imagen de portada (puede ser `null`).

---

### 4.2 Lanzar una sesión — `POST /provider/launch/`

Tu backend abre una sesión de juego para uno de tus jugadores y recibe el
`embed_url` listo para incrustar.

**Autenticación:** API key.

**Body:**

```json
{
  "game": "a-todo-gas",
  "external_player_id": "player-12345",
  "currency": "MXN",
  "balance": 1200000
}
```

- `currency` es **obligatoria** y debe estar entre las `currencies` del juego (§4.1).
- `balance` (opcional, **unidades menores**): el saldo actual del jugador en tu sistema.
  Si lo envías, el juego muestra ese saldo y lo **sincroniza en cada launch** (refleja
  el saldo real). Si lo omites, se usa un saldo de demostración. Ej: 12.000,00 MXN =
  `1200000`. En dinero real (seamless wallet) este campo deja de usarse: el saldo se
  consulta a tu billetera en cada tiro.

**Respuesta 200:**

```json
{
  "game_session": "e2b1...uuid",
  "session_token": "eyJhbGciOi...",
  "embed_url": "https://<proveedor>/embed?t=eyJhbGciOi...",
  "game": "a-todo-gas",
  "grid": { "cols": 5, "rows": 3 },
  "win_mode": "WAYS",
  "currency": "MXN",
  "currency_detail": { "code": "MXN", "exponent": 2, "symbol": "$" },
  "bet": { "default": 100, "min": 20, "max": 50000, "levels": [20,50,100,200,500] },
  "balance": 1000000,
  "theme": { ... },
  "paytable": { ... }
}
```

Lo único que necesitas para mostrar el juego es **`embed_url`**:

```html
<iframe
  src="https://<proveedor>/embed?t=eyJhbGciOi..."
  style="width:100%;height:100%;border:0"
  allow="autoplay; fullscreen"
></iframe>
```

El iframe se autocarga: lee el token de la URL, pide su estado y renderiza el juego.
No tienes que hacer nada más del lado del navegador.

**Errores:**

| Código | Motivo |
|---|---|
| 401 | Falta o es inválida la API key. |
| 403 | El juego no está asignado a tu operador. |
| 400 | Falta `currency`, o el juego no soporta esa moneda. |

---

### 4.3 El iframe (referencia)

Estos endpoints los usa **el iframe** automáticamente; los documentamos para que
entiendas el flujo. Usan el **session token** (no la API key):

```
Authorization: Bearer <session_token>
```

- `GET /embed/state/` → tema, rejilla, apuestas, paytable y saldo actual.
- `POST /embed/spin/` con body `{ "bet_amount": 100 }` → ejecuta un tiro.

No necesitas llamarlos tú; el iframe lo hace. Se incluyen por transparencia.

---

### 4.4 Giro servidor-a-servidor (opcional) — `POST /spin/`

Si prefieres un render propio (sin nuestro iframe) y controlar el giro desde tu
backend, puedes tirar directamente con la API key. **Para la mayoría de casos usa el
iframe (§4.2); es más simple y seguro.**

**Autenticación:** API key.

**Body:**

```json
{
  "game_session": "e2b1...uuid",
  "bet_amount": 100,
  "idempotency_key": "spin-abc-0001"
}
```

- `idempotency_key`: genérala única por intento. Un reintento con la misma clave **no
  duplica** el débito ni el crédito.
- La sesión debe pertenecer a tu operador (si no, 403).

**Respuesta:** el mismo cuerpo de resultado que se describe en §5.

---

### 4.5 Conceder tiradas gratis a un jugador — `POST /provider/free-rounds/`

Otorga **tiradas gratis** (free rounds/bonus) a **uno de tus jugadores** en un juego
que tengas asignado. La ronda gratis **no cobra apuesta**, pero **sí acredita los
premios reales** en tu billetera (seamless). Se consumen automáticamente la próxima vez
que ese jugador abra ese juego.

**Autenticación:** API key.

**Body:**

```json
{
  "game": "a-todo-gas",
  "player_id": "player-123",
  "currency": "USD",
  "quantity": 10,
  "bet_amount": 100,
  "win_multiplier": 1,
  "expires_at": "2026-12-31T23:59:59Z"
}
```

- `game`: slug del juego (debe estar asignado a tu operador, si no → **403**).
- `player_id`: el id del jugador en **tu** casino (el mismo que envías en `/provider/launch/`).
- `quantity`: número de tiradas gratis a conceder.
- `bet_amount` *(opcional)*: apuesta **fija** por ronda gratis en unidades menores.
  Si lo omites, se usa la apuesta por defecto del juego para esa moneda.
- `win_multiplier` *(opcional, por defecto 1)*: multiplicador aplicado a los premios de
  las rondas gratis.
- `expires_at` *(opcional)*: caducidad ISO-8601. Si lo omites, no caducan.

**Respuesta (201):**

```json
{
  "id": "f1a2...uuid",
  "game": "a-todo-gas",
  "currency": "USD",
  "player": "player-123",
  "bet_amount": 100,
  "total": 10,
  "remaining": 10,
  "win_multiplier": 1,
  "status": "ACTIVE",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

En el resultado de cada tiro (§5), el campo `free_rounds_remaining` indica cuántas
tiradas gratis otorgadas le quedan al jugador en ese juego.

---

## 5. Resultado de un tiro

Tanto `/embed/spin/` como `/spin/` devuelven:

```json
{
  "spin_id": "…uuid",
  "matrix": [["A","K","A","Q","J"],["WILD","A","K","Q","A"],["K","Q","A","J","K"]],
  "base_win": 250,
  "jackpot_win": 0,
  "total_win": 250,
  "jackpot_triggered": false,
  "winning_lines": [ … ],
  "currency": "MXN",
  "balance": 999950,

  "scatter_count": 0,
  "free_spins_triggered": false,
  "free_spins_awarded": 0,
  "win_multiplier": 1,
  "in_free_spins": false,
  "free_spins_remaining": 0,
  "free_rounds_remaining": 0
}
```

- `matrix`: filas × columnas de códigos de símbolo (`matrix[fila][columna]`).
- `base_win`, `jackpot_win`, `total_win`, `balance`: en **unidades menores** (§6).
- `winning_lines`: detalle de combinaciones ganadoras (líneas o *ways*), y eventos de
  jackpot / tiradas gratis.

### Tiradas gratis (free spins)

Algunos juegos tienen tiradas gratis, disparadas por símbolos **scatter**:

- `scatter_count`: nº de scatters en la pantalla.
- `free_spins_triggered`: la tirada disparó una ronda de tiradas gratis.
- `free_spins_awarded`: cuántos tiros gratis otorgó.
- `in_free_spins`: **este** tiro fue una tirada gratis (no se cobra apuesta).
- `win_multiplier`: multiplicador aplicado a los premios de este tiro.
- `free_spins_remaining`: tiros gratis que quedan.
- `free_rounds_remaining`: tiradas gratis **otorgadas** (vía `/provider/free-rounds/`,
  §4.5) que le quedan al jugador en este juego. También son gratis (no cobran apuesta).

Durante una ronda de tiradas gratis, los tiros **no cobran apuesta** y sus premios se
multiplican. Nuestro iframe encadena las tiradas gratis automáticamente.

### Jackpot

- `jackpot_triggered` / `jackpot_win`: premio de jackpot (si el juego lo tiene).

---

## 6. Dinero y monedas

- **Todos los importes son enteros en unidades menores** (la mínima de la moneda).
  Ejemplo: `10050` con exponente 2 = `100.50`.
- El **exponente** de cada moneda llega en `currency_detail.exponent`:
  - `USD`, `EUR`, `MXN`, … → 2 (dos decimales)
  - `CLP`, `JPY`, … → 0 (sin decimales)
- Convierte a importe real dividiendo por `10^exponente`:
  `real = minor / (10 ** exponent)`.
- **Multimoneda:** el operador decide la moneda **por sesión** (en el launch). El
  jugador apuesta y cobra en esa moneda; nunca se convierte durante el juego.

---

## 7. Manejo de errores

Los errores devuelven un JSON con `detail`:

```json
{ "detail": "El juego no está configurado para la moneda ZZZ." }
```

| Código | Significado |
|---|---|
| 400 | Petición inválida (moneda no soportada, saldo insuficiente, parámetros). |
| 401 | No autenticado (API key o session token ausente/ inválido). |
| 403 | No autorizado (juego no asignado, sesión de otro operador). |
| 404 | Recurso no encontrado. |

---

## 8. Ejemplo completo (extremo a extremo)

**1) Tu backend obtiene el catálogo y lo guarda:**

```bash
curl -s https://PROVEEDOR/api/v1/provider/games/ \
  -H "Authorization: Api-Key $OPERATOR_API_KEY"
```

**2) El jugador entra a un juego → tu backend lanza la sesión:**

```bash
curl -s -X POST https://PROVEEDOR/api/v1/provider/launch/ \
  -H "Authorization: Api-Key $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"game":"a-todo-gas","external_player_id":"player-12345","currency":"MXN"}'
```

**3) Tu frontend incrusta el `embed_url` recibido:**

```html
<div class="game-wrap" style="width:100%;height:100vh">
  <iframe src="{{ embed_url }}"
          style="width:100%;height:100%;border:0"
          allow="autoplay; fullscreen"></iframe>
</div>
```

Eso es todo. El jugador ya está jugando, y los giros / saldo se resuelven en el iframe.

---

## 9. Seguridad

- **Nunca** publiques la API key en el frontend, apps móviles ni el repositorio. Vive
  solo en tu backend.
- El **session token** es de corta duración y solo sirve para esa sesión; es seguro
  pasarlo a la URL del iframe.
- Para poder **incrustar** el iframe desde tu dominio, dinos tus orígenes; los
  autorizamos por operador (cabecera `Content-Security-Policy: frame-ancestors`).
- Si llamas a la API desde el **navegador** (no recomendado), dinos tus orígenes para
  habilitar CORS. El flujo con iframe **no** lo necesita.

---

## 10. Seamless wallet (saldo real)

Por defecto el operador está en modo **DEMO** (fun-money): el saldo lo lleva nuestra
plataforma. En modo **SEAMLESS**, el saldo real vive en **tu billetera** y nosotros la
llamamos por HTTP en cada tiro. El resto de la integración (catálogo, launch, iframe)
**no cambia**.

### Endpoints que TÚ expones (nosotros los llamamos)

```
POST {wallet_base_url}/slotforge/wallet/debit/      # descuenta la apuesta
POST {wallet_base_url}/slotforge/wallet/credit/     # acredita el premio
POST {wallet_base_url}/slotforge/wallet/rollback/   # revierte un débito si algo falla
```

- **Cabecera de firma:** `X-SlotForge-Signature: <hmac_sha256_hex(body, secret)>`
  — HMAC-SHA256 en **hexadecimal** sobre el **body exacto** que enviamos (JSON
  compacto, sin espacios), con el **secreto compartido**.
- **Body:**

  ```json
  {
    "player_id": "player-12345",
    "amount": 10000,
    "currency": "MXN",
    "idempotency_key": "spin-abc:debit",
    "round_id": "spin-abc"
  }
  ```

- **Respuesta OK (200):** `{ "balance": <saldo nuevo en unidades menores>, "external_reference": "<tu_id>" }`
- **Saldo insuficiente:** responde **HTTP 402** (o un body con `"insufficient_funds"`);
  nosotros rechazamos el tiro con 400 y no calculamos nada.

### Reglas

- **Idempotencia:** cada llamada trae una `idempotency_key` única. Si reintentamos
  (timeout/reconexión), reconoce la clave y **no vuelvas a mover el saldo**; devuelve
  el mismo resultado.
- **`amount`** siempre en unidades menores (§6), siempre ≥ 0.
- **Firma:** valida SIEMPRE la firma; rechaza lo que no cuadre.
- **Rollback:** si tras un `debit` algo falla de nuestro lado, llamamos `rollback` con
  una `idempotency_key` propia para devolver la apuesta.

### Activación

Nos das tu `wallet_base_url` y el **secreto HMAC** (compartido); nosotros ponemos tu
operador en modo SEAMLESS. En el `launch` puedes seguir enviando `balance` (§4.2) como
saldo inicial a mostrar; a partir del primer tiro, el saldo lo dicta tu billetera.

---

*Cualquier duda de integración, contáctanos. Esta API está pensada para que puedas
mostrar nuestros juegos en tu sitio con la mínima fricción.*
