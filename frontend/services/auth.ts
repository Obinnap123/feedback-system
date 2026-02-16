import { AxiosResponse } from "axios";
import api from "./api";
import {
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
} from "../types/auth";

export const authService = {
    login: (payload: LoginRequest): Promise<AxiosResponse<LoginResponse>> => {
        return api.post("/auth/login", payload);
    },

    register: (
        payload: RegisterRequest
    ): Promise<AxiosResponse<RegisterResponse>> => {
        return api.post("/auth/register", payload);
    },
};
