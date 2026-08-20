"""
Configuración base de Django.

Los secretos y parámetros por entorno se leen de variables de entorno (.env).
NUNCA subas .env al repositorio. Ver .env.example.
"""
from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers as default_cors_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="unsafe-dev-key-CHANGE-ME")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceros
    "rest_framework",
    "corsheaders",
    # Locales
    "common",
    "app_accounts",
    "app_game",
    "app_rtp",
    "app_wallet_integration",
    "app_audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CORS lo más arriba posible (antes de CommonMiddleware): el operador llama a la
    # API del proveedor desde el navegador (otro origen). La auth va por cabecera
    # (Authorization/Api-Key), no por cookies, así que no hace falta credenciales CORS.
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    # NOTA: NO usamos XFrameOptionsMiddleware global porque el juego se embebe en
    # casinos externos. El control de embebido se hace por operador vía cabecera
    # Content-Security-Policy: frame-ancestors <origenes_permitidos>.
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://postgres:postgres@localhost:5432/igaming_slot",
    ),
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"  # Guarda SIEMPRE en UTC; convierte en presentación.
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

# Media (assets subidos por el master: sprites de símbolos, etc.)
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# --- URLs absolutas para consumo EXTERNO (thumbnails del operador, embed) ---
# Mecanismo PRIMARIO (dinámico, sin hardcodear host ni puerto): detrás de un proxy/gateway,
# Django reconstruye el host:puerto público a partir de las cabeceras X-Forwarded-Host /
# X-Forwarded-Port que reenvía el gateway. Así las imágenes salen SIEMPRE del mismo sitio
# donde esté montada la app, aunque cambie el puerto. Requiere que el gateway las reenvíe.
# En local se dejan en False (no hay proxy); en el servidor se ponen a True por .env.
USE_X_FORWARDED_HOST = env.bool("USE_X_FORWARDED_HOST", default=False)
USE_X_FORWARDED_PORT = env.bool("USE_X_FORWARDED_PORT", default=False)

# Override OPCIONAL: base absoluta (esquema+host+puerto) SOLO si el gateway no puede
# reenviar el puerto y build_absolute_uri sale sin él. Vacío => se usa el mecanismo
# dinámico de arriba. Ej.: http://mi-host:8080
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", default="").rstrip("/")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    # JWT para cuentas internas (jugador/master). No fuerza autenticación global:
    # cada vista declara sus permisos; las públicas (registro/login/spin) quedan abiertas.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_THROTTLE_CLASSES": (),
    "DEFAULT_THROTTLE_RATES": {},
}

SIMPLE_JWT = {
    # Demo: token de acceso de larga duración para no lidiar con refresh todavía.
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

# CORS: orígenes de operador autorizados a llamar la API desde el navegador. En
# producción se listan por env (los dominios reales de cada operador). En desarrollo
# se abre a localhost (ver development.py). Cabecera propia del operador incluida.
CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_HEADERS = list(default_cors_headers) + ["x-operator-key"]

# Duración del session token del iframe (modo proveedor).
EMBED_SESSION_TOKEN_LIFETIME = timedelta(hours=8)
# Base pública del iframe del juego. El launch devuelve <EMBED_BASE_URL>?t=<token>
# listo para incrustar. Dos formas:
#  - RUTA RELATIVA (recomendado si el frontend se sirve en el MISMO origen que la API),
#    p. ej. "/embed": el launch la resuelve contra el host:puerto de la petición, así el
#    embed sale del mismo sitio donde esté montada la app (dinámico, sin hardcodear puerto).
#  - URL ABSOLUTA (si el frontend vive en otro host), p. ej. http://mi-host:8080/embed.
EMBED_BASE_URL = env("EMBED_BASE_URL", default="/embed")


def _validate_embed_base_url(value):
    """
    Falla al arrancar si EMBED_BASE_URL está mal formada, en vez de emitir URLs rotas
    al operador. Detecta el caso real visto en producción: 'https://host:5174.com'
    (puerto no numérico), esquema no http(s) o host ausente.
    """
    if value.startswith("/"):
        return  # ruta relativa: se resuelve contra el host de la petición (mismo origen)

    from urllib.parse import urlparse

    try:
        parts = urlparse(value)
        _ = parts.port  # ValueError si el puerto no es numérico (p. ej. ':5174.com')
    except ValueError:
        parts = None
    if not parts or parts.scheme not in ("http", "https") or not parts.hostname:
        raise ImproperlyConfigured(
            f"EMBED_BASE_URL inválida: {value!r}. Usa una ruta relativa (p. ej. '/embed') "
            f"o una URL absoluta http(s)://host[:puerto]/ruta con puerto NUMÉRICO."
        )


_validate_embed_base_url(EMBED_BASE_URL)
# Saldo inicial DEMO (unidades mayores) que se da al jugador del iframe en fun-money.
DEMO_START_BALANCE_UNITS = env.int("DEMO_START_BALANCE_UNITS", default=10_000)
