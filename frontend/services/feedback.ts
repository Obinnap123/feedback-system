import { AxiosResponse } from "axios";
import api, { buildAuthHeaders } from "./api";
import {
    FeedbackSubmitRequest,
    FeedbackSubmitResponse,
    TokenStatusResponse,
} from "../types/feedback";

export const feedbackService = {
    getTokenStatus: (
        token: string,
        authToken?: string
    ): Promise<AxiosResponse<TokenStatusResponse>> => {
        return api.get("/feedback/token-status", {
            headers: buildAuthHeaders(authToken),
            params: { token },
        });
    },

    submitFeedback: (
        payload: FeedbackSubmitRequest,
        authToken?: string
    ): Promise<AxiosResponse<FeedbackSubmitResponse>> => {
        return api.post("/feedback/submit", payload, {
            headers: buildAuthHeaders(authToken),
        });
    },
};
