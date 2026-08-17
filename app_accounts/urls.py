from django.urls import path

from .views import (
    AuditListView,
    CreditPlayerView,
    LoginView,
    MeView,
    PlayerListView,
    RegisterView,
)

app_name = "app_accounts"

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("master/players/", PlayerListView.as_view(), name="players"),
    path("master/players/<int:user_id>/credit/", CreditPlayerView.as_view(), name="credit"),
    path("master/audit/", AuditListView.as_view(), name="audit"),
]
