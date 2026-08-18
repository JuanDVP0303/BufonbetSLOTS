from django.contrib.auth import authenticate, get_user_model
from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from app_audit.models import SpinAuditLog
from app_game.models import Game
from app_wallet_integration.models import Operator
from common.pagination import paginate

from .models import BalanceEntryKind, PlayerWallet, Profile, Role
from .permissions import IsMaster
from .serializers import (
    AuditRowSerializer,
    CreditSerializer,
    MeSerializer,
    PlayerRowSerializer,
    RegisterSerializer,
)
from .services import apply_balance

User = get_user_model()


def _tokens_for(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _role_of(user) -> str:
    profile = getattr(user, "profile", None)
    if profile:
        return profile.role
    return Role.MASTER if user.is_superuser else Role.PLAYER


class RegisterView(APIView):
    """Registro de jugador: email + contraseña, SIN verificación, saldo 0."""

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"]
        password = ser.validated_data["password"]

        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, password=password)
            Profile.objects.create(user=user, role=Role.PLAYER)
            PlayerWallet.objects.create(user=user, balance=0, currency="USD")

        return Response(
            {
                "user": {"id": user.id, "email": email, "role": Role.PLAYER.value},
                "tokens": _tokens_for(user),
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """Login por email (sirve para jugador y para master)."""

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request):
        email = (request.data.get("email") or "").lower()
        password = request.data.get("password") or ""
        user = authenticate(username=email, password=password)
        if user is None:
            return Response({"detail": "Credenciales inválidas."}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(
            {
                "user": {"id": user.id, "email": user.email or user.username, "role": _role_of(user)},
                "tokens": _tokens_for(user),
            }
        )


class MeView(APIView):
    """Datos del usuario autenticado, incluyendo su saldo."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        wallet = getattr(user, "wallet", None)
        data = {
            "id": user.id,
            "email": user.email or user.username,
            "role": _role_of(user),
            "balance": wallet.balance if wallet else 0,
            "currency": wallet.currency if wallet else "USD",
        }
        return Response(MeSerializer(data).data)


class PlayerListView(APIView):
    """
    (Master) Listado de jugadores con su saldo y agregados de juego.
    Los totales se leen del libro del monedero (BalanceEntry), fuente de verdad
    del juego interno. Se poblarán en cuanto los spins muevan el saldo interno.
    """

    permission_classes = [IsMaster]

    def get(self, request):
        # Prefetch de entradas SOLO para la página que se sirve (no de todos los
        # jugadores): los agregados se calculan sobre esa página.
        players = (
            User.objects.filter(profile__role=Role.PLAYER)
            .select_related("wallet")
            .prefetch_related("wallet__entries")
            .order_by("-date_joined")
        )

        def serialize(users):
            rows = []
            for user in users:
                wallet = getattr(user, "wallet", None)
                entries = list(wallet.entries.all()) if wallet else []
                total_bet = sum(-e.delta for e in entries if e.kind == BalanceEntryKind.BET)
                total_win = sum(e.delta for e in entries if e.kind == BalanceEntryKind.WIN)
                spins = sum(1 for e in entries if e.kind == BalanceEntryKind.BET)
                rows.append({
                    "id": user.id,
                    "email": user.email or user.username,
                    "balance": wallet.balance if wallet else 0,
                    "currency": wallet.currency if wallet else "USD",
                    "total_bet": total_bet,
                    "total_win": total_win,
                    "spins": spins,
                    "date_joined": user.date_joined,
                })
            return PlayerRowSerializer(rows, many=True).data

        return Response(paginate(request, players, serialize))


class CreditPlayerView(APIView):
    """(Master) Acredita saldo a un jugador."""

    permission_classes = [IsMaster]

    def post(self, request, user_id: int):
        player = get_object_or_404(User, pk=user_id, profile__role=Role.PLAYER)
        ser = CreditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        entry = apply_balance(
            wallet_id=player.wallet.pk,
            delta=ser.validated_data["amount"],
            kind=BalanceEntryKind.MASTER_CREDIT,
            reference=ser.validated_data.get("reference", ""),
            created_by=request.user,
        )
        return Response(
            {"id": player.id, "email": player.email or player.username, "balance_after": entry.balance_after}
        )


class AuditListView(APIView):
    """
    (Master) Log de auditoría inmutable, paginado (?page, ?page_size) con filtros:
      - ?from=YYYY-MM-DD & ?to=YYYY-MM-DD  → rango de fechas inclusivo.
      - ?player=<texto>                    → coincidencia parcial en el id de jugador.
      - ?operator=<code|internal>          → operador por código; "internal" = giros propios.
      - ?result=win|loss|neutral           → ganadas / perdidas / neutras (premio vs apuesta).
      - ?currency=USD                      → moneda exacta.
    Todos son opcionales y combinables.
    """

    permission_classes = [IsMaster]

    def get(self, request):
        params = request.query_params
        qs = SpinAuditLog.objects.order_by("-sequence_number")

        date_from = parse_date(params.get("from", "") or "")
        date_to = parse_date(params.get("to", "") or "")
        if date_from:
            qs = qs.filter(recorded_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(recorded_at__date__lte=date_to)

        player = (params.get("player", "") or "").strip()
        if player:
            qs = qs.filter(external_player_id__icontains=player)

        operator = (params.get("operator", "") or "").strip()
        if operator:
            if operator.lower() in ("internal", "interno", "propio"):
                qs = qs.filter(operator_id__isnull=True)
            else:
                op = Operator.objects.filter(code__iexact=operator).first()
                # Un código inexistente no debe devolver TODO: filtra a un UUID imposible.
                qs = qs.filter(operator_id=op.id) if op else qs.none()

        result = (params.get("result", "") or "").strip().lower()
        if result == "win":
            qs = qs.filter(win_amount__gt=F("bet_amount"))
        elif result == "loss":
            qs = qs.filter(win_amount__lt=F("bet_amount"))
        elif result == "neutral":
            qs = qs.filter(win_amount=F("bet_amount"))

        currency = (params.get("currency", "") or "").strip().upper()
        if currency:
            qs = qs.filter(currency=currency)

        def serialize(rows):
            op_ids = {r.operator_id for r in rows if r.operator_id}
            game_ids = {r.game_id for r in rows}
            op_names = dict(Operator.objects.filter(id__in=op_ids).values_list("id", "name"))
            games = {
                gid: (title or name)
                for gid, title, name in Game.objects.filter(id__in=game_ids).values_list(
                    "id", "title", "name"
                )
            }
            data = []
            for r in rows:
                net = r.win_amount - r.bet_amount
                data.append({
                    "sequence_number": r.sequence_number,
                    "external_player_id": r.external_player_id,
                    "operator": op_names.get(r.operator_id) if r.operator_id else "Interno",
                    "game": games.get(r.game_id),
                    "bet_amount": r.bet_amount,
                    "win_amount": r.win_amount,
                    "net_amount": net,
                    "result": "win" if net > 0 else "loss" if net < 0 else "neutral",
                    "currency": r.currency,
                    "math_version": r.math_version,
                    "recorded_at": r.recorded_at,
                })
            return AuditRowSerializer(data, many=True).data

        return Response(paginate(request, qs, serialize))
