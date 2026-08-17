from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("app_accounts.urls")),
    path("api/v1/", include("app_game.urls")),
    # path("api/v1/wallet/", include("app_wallet_integration.urls")),
]

# En desarrollo, Django sirve los archivos de media (assets subidos).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
