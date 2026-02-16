export enum UserRole {
    STUDENT = "STUDENT",
    LECTURER = "LECTURER",
    ADMIN = "ADMIN",
}

export interface User {
    id: number;
    email: string;
    role: UserRole;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface RegisterRequest {
    email: string;
    password: string;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
}

export interface RegisterResponse {
    id: number;
    email: string;
    role: UserRole;
}
