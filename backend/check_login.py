from __future__ import annotations

import sys

from passlib.context import CryptContext

from database import SessionLocal
from models import User


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python check_login.py <email> <password>")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    password = sys.argv[2]

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"No user found for {email}")
            sys.exit(1)

        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        try:
            valid = pwd_context.verify(password, user.hashed_password)
            print(f"User found: {user.email} ({user.role.value})")
            print(f"Password valid: {valid}")
        except Exception as exc:  # pragma: no cover - diagnostics only
            print(f"User found: {user.email} ({user.role.value})")
            print(f"Password verify error: {exc.__class__.__name__}: {exc}")
            print(f"Stored hash: {user.hashed_password}")
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
