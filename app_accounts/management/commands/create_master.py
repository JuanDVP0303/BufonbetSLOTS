"""Crea (o asegura) un usuario Master."""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from app_accounts.models import Profile, Role


class Command(BaseCommand):
    help = "Crea un usuario Master (superusuario + perfil MASTER)."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--password", required=True)

    def handle(self, *args, **opts):
        User = get_user_model()
        email = opts["email"].lower()
        if User.objects.filter(username=email).exists():
            raise CommandError(f"Ya existe un usuario con email '{email}'.")
        user = User.objects.create_superuser(username=email, email=email, password=opts["password"])
        Profile.objects.create(user=user, role=Role.MASTER)
        self.stdout.write(self.style.SUCCESS(f"Master creado: {email}"))
