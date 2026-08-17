"""Configuración de producción. Endurecer antes de exponer con dinero real."""
from .base import *  # noqa: F401,F403

DEBUG = False

# Seguridad de transporte
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# El embebido en iframe se autoriza por operador mediante CSP frame-ancestors,
# usando Operator.allowed_iframe_origins. No usar X-Frame-Options global.
