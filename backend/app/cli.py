import argparse
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from .config import Settings
from .db import Database
from .models import User, utcnow
from .security import hash_password
from .seed import seed_demo


def init_db(database_url: str):
    root = Path(__file__).resolve().parent.parent
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    config.attributes["database_url"] = database_url
    if database_url.startswith("sqlite") and "/.local/" in database_url:
        Path(".local").mkdir(exist_ok=True)
    command.upgrade(config, "head")


def main():
    parser = argparse.ArgumentParser(description="Manage OpsDesk schema and explicitly-created accounts")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("init-db", help="Apply Alembic schema migrations")
    user = sub.add_parser("create-user", help="Read password from OPSDESK_USER_PASSWORD")
    user.add_argument("--email", required=True)
    user.add_argument("--name", required=True)
    user.add_argument("--role", choices=("requester", "agent"), required=True)
    sub.add_parser("seed-demo", help="Seed synthetic training data once using OPSDESK_DEMO_PASSWORD")
    arguments = parser.parse_args()
    settings = Settings()
    if arguments.action == "init-db":
        init_db(settings.database_url)
        print("Schema is up to date")
        return
    database = Database(settings.database_url)
    try:
        with database.session_factory.begin() as db:
            if arguments.action == "create-user":
                password = os.getenv("OPSDESK_USER_PASSWORD", "")
                if not 12 <= len(password) <= 128:
                    raise ValueError("Set OPSDESK_USER_PASSWORD to 12-128 characters")
                email, name = arguments.email.strip().lower(), arguments.name.strip()
                if not 3 <= len(email) <= 254 or email.count("@") != 1 or not 1 <= len(name) <= 100:
                    raise ValueError("Provide a valid email and a name of 1-100 characters")
                if db.scalar(select(User.id).where(User.email == email)):
                    raise ValueError("This email already exists; no account was changed")
                db.add(User(email=email, name=name, role=arguments.role, password_hash=hash_password(password)))
                print("Account created")
            else:
                if not settings.demo_mode:
                    raise ValueError("Enable OPSDESK_DEMO_MODE=true before seeding synthetic training data")
                created = seed_demo(db, os.getenv("OPSDESK_DEMO_PASSWORD", ""), utcnow())
                print("Synthetic training data created" if created else "Training seed already applied; no records changed")
    except ValueError as error:
        parser.exit(2, str(error) + "\n")
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
