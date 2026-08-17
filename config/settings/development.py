"""Configuración de desarrollo."""
from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

# En local, tu Gangabet puede correr en cualquier puerto: se permite todo origen.
# La auth va por cabecera (no cookies), así que esto es seguro para pruebas locales.
# En producción NO se usa: allí manda CORS_ALLOWED_ORIGINS (dominios reales).
CORS_ALLOW_ALL_ORIGINS = True
