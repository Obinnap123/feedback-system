from __future__ import annotations
import os
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from routers import auth, feedback, courses, analytics

# Create tables (dev only)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Feedback System API")


def _cors_allowed_origins() -> List[str]:
    defaults = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
    ]
    raw = os.getenv("CORS_ALLOWED_ORIGINS", "")
    configured = [
        item.strip().rstrip("/")
        for item in raw.split(",")
        if item and item.strip()
    ]

    merged: List[str] = []
    seen: set[str] = set()
    for origin in defaults + configured:
        normalized = origin.rstrip("/")
        if normalized and normalized not in seen:
            seen.add(normalized)
            merged.append(normalized)
    return merged


_cors_origin_regex = os.getenv("CORS_ALLOWED_ORIGIN_REGEX")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allowed_origins(),
    allow_origin_regex=_cors_origin_regex if _cors_origin_regex else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(feedback.router)
app.include_router(courses.router)
app.include_router(analytics.router)


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Feedback System API is running"}
