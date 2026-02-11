from database import SessionLocal
from models import User


def main() -> None:
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.id.asc()).all()
        print(f"Found {len(users)} users:")
        for user in users:
            print(f"- {user.email} ({user.role.value})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
