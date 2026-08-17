# igaming-slot

Microservicio independiente de un slot 3x3 (iGaming), embebible en casinos externos
vía iframe. Backend: Django + DRF + PostgreSQL. Frontend (repo aparte): React + Phaser 3.

## Principio de diseño número 1

**El servidor es la única autoridad del resultado.** El cliente (Phaser) solo
renderiza la matriz que el backend ya decidió. Nunca se calcula un premio en el navegador.

## Estructura

```
igaming-slot/
├── config/                     # settings (base/development/production), urls, wsgi/asgi
├── common/                     # modelos abstractos y convenciones compartidas
├── app_game/                   # motor del slot: símbolos, líneas, bandas (RNG/math), spins
├── app_rtp/                    # RTP por juego/operador, margen, versiones de math certificado
├── app_wallet_integration/     # operadores, tokens de iframe, sesiones, transacciones wallet
└── app_audit/                  # log inmutable y encadenado por hash de cada tirada
```

## Puesta en marcha (desarrollo)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # ajusta valores
createdb igaming_slot           # requiere PostgreSQL en marcha
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## Convención de dinero

Todos los montos se almacenan en **unidades menores (céntimos)** como enteros
(`BigIntegerField`) con su código de moneda ISO-4217. Nunca `float`.

## Aviso de cumplimiento

Dinero real = mercado regulado. La RNG y la matemática deben ser **certificadas**
por un laboratorio acreditado (GLI, iTech Labs, BMM) y el operador debe tener
licencia. Ver la sección de compliance en la documentación del proyecto.
