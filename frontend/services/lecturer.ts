import { AxiosResponse } from "axios";
import api, { buildAuthHeaders } from "./api";
import { LecturerDashboardResponse } from "../types/dashboard";

export const lecturerService = {
    fetchDashboard: (
        token: string,
        params: { semester?: string; course_code?: string } = {}
    ): Promise<AxiosResponse<LecturerDashboardResponse>> => {
        return api.get("/dashboard/lecturer", {
            headers: buildAuthHeaders(token),
            params,
        });
    },
};
