from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=6, write_only=True)

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(username__iexact=value).exists() or User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Ese email ya está registrado.")
        return value


class MeSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    role = serializers.CharField()
    balance = serializers.IntegerField()
    currency = serializers.CharField()


class CreditSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1, help_text="Monto a acreditar en céntimos.")
    reference = serializers.CharField(required=False, allow_blank=True, max_length=140)


class PlayerRowSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    balance = serializers.IntegerField()
    currency = serializers.CharField()
    total_bet = serializers.IntegerField()
    total_win = serializers.IntegerField()
    spins = serializers.IntegerField()
    date_joined = serializers.DateTimeField()


class AuditRowSerializer(serializers.Serializer):
    sequence_number = serializers.IntegerField()
    external_player_id = serializers.CharField()
    operator = serializers.CharField(allow_null=True)
    game = serializers.CharField(allow_null=True)
    bet_amount = serializers.IntegerField()
    win_amount = serializers.IntegerField()
    net_amount = serializers.IntegerField()
    result = serializers.CharField()
    currency = serializers.CharField()
    math_version = serializers.CharField()
    recorded_at = serializers.DateTimeField()
