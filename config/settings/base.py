"""
Configuración base de Django.

Los secretos y parámetros por entorno se leen de variables de entorno (.env).
NUNCA subas .env al repositorio. Ver .env.example.
"""
from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers as default_cors_headers

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
# listo para incrustar. En dev apunta al Vite local; en prod al dominio del proveedor.
EMBED_BASE_URL = env("EMBED_BASE_URL", default="http://localhost:5174/embed")
# Saldo inicial DEMO (unidades mayores) que se da al jugador del iframe en fun-money.
DEMO_START_BALANCE_UNITS = env.int("DEMO_START_BALANCE_UNITS", default=10_000)
