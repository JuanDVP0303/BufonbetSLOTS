# Guía de despliegue — Bufonbet

Cómo montar la plataforma en un servidor de producción y dejarla funcionando.

## 1. Arquitectura (qué corre dónde)

```
Navegador del jugador
   │  (iframe del operador → nuestro frontend)
   ▼
[ Nginx ]  ── /            → Frontend React (estático, carpeta dist/)
           ── /api/…       → Gunicorn (Django) por proxy
           ── /media/…     → archivos subidos (assets de casinos)
                              │
                    [ Gunicorn + Django ]
                              │
                    [ PostgreSQL ]   [ Redis ]   (opcional: Celery worker)
```

- **Backend**: Django + DRF servido por **Gunicorn** (WSGI = `config.wsgi`).
- **Frontend**: React + Phaser, se **compila** a estáticos (`npm run build` → `frontend/dist/`) y los sirve Nginx.
- **DB**: PostgreSQL. **Cache/cola**: Redis (para Celery; opcional en MVP).

## 2. Requisitos del servidor

- Ubuntu/Debian o Fedora con: **Python 3.13**, **PostgreSQL 14+**, **Redis**, **Node 20+** (solo para compilar el frontend), **Nginx**, **git**.
- Un **dominio** (o dos subdominios): p.ej. `api.tudominio.com` (backend) y `juegos.tudominio.com` (frontend/iframe).
- **Certificado TLS** (Let's Encrypt / certbot). **HTTPS es obligatorio** para producción (dinero real, tokens de sesión).

## 3. Backend

```bash
git clone git@github.com:JuanDVP0303/bufonbet.git
cd bufonbet
python3.13 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn        # ya está en requirements

cp .env.example .env        # y EDITA (ver §5)

export DJANGO_SETTINGS_MODULE=config.settings.production
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser        # cuenta admin de Django
python manage.py create_master          # cuenta MASTER del back office (revisa el comando)
```

Arranca Gunicorn (mejor detrás de systemd):

```bash
gunicorn config.wsgi:application --bind 127.0.0.1:8010 --workers 3
```

**systemd** (`/etc/systemd/system/bufonbet.service`):

```ini
[Service]
User=deploy
WorkingDirectory=/home/deploy/bufonbet
EnvironmentFile=/home/deploy/bufonbet/.env
Environment=DJANGO_SETTINGS_MODULE=config.settings.production
ExecStart=/home/deploy/bufonbet/venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8010 --workers 3
Restart=always

[Install]
WantedBy=multi-user.target
```

## 4. Frontend

```bash
cd frontend
npm ci
# API base = dominio del backend. Si sirves front y api bajo el MISMO dominio con
# nginx enrutando /api, puedes dejar VITE_API_BASE vacío.
echo "VITE_API_BASE=https://api.tudominio.com" > .env.production
npm run build      # genera frontend/dist/
```

Sirve `frontend/dist/` con Nginx (ver §6). Cada vez que cambies el front, recompila.

## 5. Variables de entorno (`.env` del backend) — CRÍTICO

```env
DJANGO_SECRET_KEY=<cadena larga y aleatoria — genera una nueva, NO la de dev>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=api.tudominio.com,juegos.tudominio.com
DATABASE_URL=postgres://usuario:password@localhost:5432/bufonbet
REDIS_URL=redis://localhost:6379/0

# URL pública del iframe del juego (dominio del frontend + /embed):
EMBED_BASE_URL=https://juegos.tudominio.com/embed

# Orígenes de los OPERADORES autorizados a llamar la API desde el navegador (CORS).
# Es el dominio del casino del operador que incrusta el iframe:
DJANGO_CORS_ALLOWED_ORIGINS=https://casino-del-operador.com
```

- `DJANGO_DEBUG` **debe** ir en `false`.
- Genera un `SECRET_KEY` nuevo: `python -c "import secrets; print(secrets.token_urlsafe(64))"`.
- Cada operador nuevo que incruste el iframe → añade su dominio a `DJANGO_CORS_ALLOWED_ORIGINS`.

## 6. Nginx (reverse proxy + estáticos + iframe)

```nginx
# Backend API
server {
    server_name api.tudominio.com;
    client_max_body_size 25M;              # subida de assets de casinos

    location /api/ { proxy_pass http://127.0.0.1:8010; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $remote_addr; }
    location /media/ { alias /home/deploy/bufonbet/media/; }
    location /static/ { alias /home/deploy/bufonbet/staticfiles/; }
}

# Frontend (lo incrusta el operador en un iframe)
server {
    server_name juegos.tudominio.com;
    root /home/deploy/bufonbet/frontend/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }   # SPA

    # CLAVE para el iframe: NO enviar X-Frame-Options DENY; permitir que el operador
    # nos incruste. Restringe a los dominios de tus operadores:
    add_header Content-Security-Policy "frame-ancestors 'self' https://casino-del-operador.com";
}
```

> **Trampa del iframe**: si el frontend responde `X-Frame-Options: DENY/SAMEORIGIN`, el
> juego NO cargará dentro del casino del operador. Usa `frame-ancestors` (CSP) con los
> dominios de tus operadores y NO pongas `X-Frame-Options`. Añade certbot/TLS a ambos server.

## 7. Almacenamiento de `media/` (assets subidos)

`media/` NO está en git. En el servidor:
- Es la carpeta donde se guardan fondos/gifs/símbolos que subes desde el panel del master.
- **Debe persistir** entre despliegues (no la borres al re-desplegar). Ponla fuera del
  árbol de código o en un volumen, y respáldala.
- Para migrar los assets de tu demo local: `rsync -av media/ deploy@servidor:/home/deploy/bufonbet/media/`.
- Alternativa a futuro: S3 / almacenamiento de objetos (django-storages).

## 8. Seamless wallet (dinero real) — si el operador lo usa

- El backend llama por HTTP a la billetera del operador y firma con **HMAC-SHA256**
  (header `X-SlotForge-Signature`, ver `docs/API_INTEGRATION.md` §10 y §4.5).
- El servidor debe **alcanzar por red** la URL de la billetera del operador (firewall/red).
- El **secreto HMAC** se configura por operador (variable de entorno o valor en BD). En
  producción, guárdalo como variable de entorno, no en texto plano en la BD.
- Todo por **HTTPS**.

## 9. RTP: recalibra los casinos existentes

La calibración de RTP corre **solo al crear un casino o al editarle el RTP**. Los casinos
que ya existían antes de esta versión siguen con su matemática anterior hasta que se
recalibren. En el servidor, tras migrar, entra al panel del master y **re-guarda el RTP**
de cada casino (o pídeme la acción de management para recalibrarlos en lote).

## 10. Checklist de seguridad

- [ ] `DJANGO_DEBUG=false` y `SECRET_KEY` nuevo y secreto.
- [ ] `.env` **fuera de git** (ya ignorado) y con permisos `600`.
- [ ] HTTPS en frontend y backend (certbot).
- [ ] `DJANGO_ALLOWED_HOSTS` con tus dominios reales.
- [ ] `DJANGO_CORS_ALLOWED_ORIGINS` solo con dominios de operadores reales.
- [ ] Backups automáticos de PostgreSQL (la auditoría de giros es inmutable y encadenada
      por hash: no la toques; respáldala).
- [ ] Firewall: solo 80/443 públicos; Postgres/Redis solo local.

## 11. Prueba de humo (que funciona)

1. `https://api.tudominio.com/api/v1/…` responde (login master, listar casinos).
2. Panel del master carga en el frontend, creas/ves un casino, **Simular RTP** da el objetivo.
3. Creas un operador, generas su **API key**, le asignas un juego.
4. Con la API key: `POST /provider/launch/` devuelve `embed_url`; abres esa URL en un iframe
   y el juego carga y **gira** (débito/crédito se reflejan).
5. `POST /provider/free-rounds/` concede tiradas gratis y el jugador las consume sin cobro.
6. La auditoría (`/master/audit/`) registra cada giro.
