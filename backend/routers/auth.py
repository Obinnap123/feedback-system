from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from passlib.exc import UnknownHashError

from database import get_db
from models import User, UserRole
from schemas import RegisterRequest, RegisterResponse, LoginRequest, TokenResponse
from dependencies import (
    get_user_by_email,
    pwd_context,
    create_access_token,
    _normalize_login_identifier
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    normalized_email = _normalize_login_identifier(payload.email)
    if get_user_by_email(db, normalized_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email or matric number is already registered",
        )

    user = User(
        email=normalized_email,
        hashed_password=pwd_context.hash(payload.password),
        role=UserRole.STUDENT,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return RegisterResponse(id=user.id, email=user.email, role=user.role)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    normalized_email = _normalize_login_identifier(payload.email)
    user = get_user_by_email(db, normalized_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    try:
        valid = pwd_context.verify(payload.password, user.hashed_password)
    except UnknownHashError:
        valid = False

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    if pwd_context.needs_update(user.hashed_password):
        user.hashed_password = pwd_context.hash(payload.password)
        db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return TokenResponse(access_token=token)
