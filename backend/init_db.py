from database import Base, engine
import models  # noqa: F401

print("Connecting to Neon and creating tables...")
Base.metadata.create_all(bind=engine)
print("Tables created successfully!")
