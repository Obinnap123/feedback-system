from __future__ import annotations

import sys

from passlib.context import CryptContext

from database import SessionLocal
from models import User


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python reset_password.py <email> <new_password>")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    new_password = sys.argv[2]

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"No user found for {email}")
            sys.exit(1)

        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        user.hashed_password = pwd_context.hash(new_password)
        db.commit()
        print(f"Password reset for {email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
