import env from "$lib/env";

import type {
    SiphonAnalyzeRequest,
    SiphonAnalyzeResponse,
    SiphonCobaltDownloadResponse,
    SiphonConnectionStatus,
    SiphonDownloadRequest,
    SiphonSettings,
} from "./types";

const JSON_HEADERS = {
    Accept: "application/json",
    "Content-Type": "application/json",
} as const;

const withTimeout = async <T>(request: Promise<T>, ms: number): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            request,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("timed out")), ms);
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};

const normalizeOrigin = (value: string): string | undefined => {
    if (!value.trim()) {
        return undefined;
    }

    try {
        return new URL(value).origin;
    } catch {
        return undefined;
    }
};

export const getSiphonApiOrigin = (settings?: Pick<SiphonSettings, "instanceUrl">): string => {
    const configured = normalizeOrigin(settings?.instanceUrl || "");
    if (configured) {
        return configured;
    }

    const fallback = normalizeOrigin(env.DEFAULT_API_URL || "");
    if (fallback) {
        return fallback;
    }

    throw new Error("SIPHON_DEFAULT_API_URL is missing or invalid");
};

const getAuthHeader = (settings?: Pick<SiphonSettings, "apiKey">) => {
    const apiKey = settings?.apiKey?.trim();
    if (!apiKey) {
        return {} as Record<string, string>;
    }

    return {
        Authorization: `Api-Key ${apiKey}`,
    } satisfies Record<string, string>;
};

const toErrorResponse = (code: string, context?: Record<string, unknown>) => ({
    status: "error" as const,
    error: {
        code,
        ...(context ? { context } : {}),
    },
});

const parseJSON = async <T>(response: Response): Promise<T | undefined> => {
    try {
        return await response.json() as T;
    } catch {
        return undefined;
    }
};

const postJSON = async <T>(
    path: string,
    body: unknown,
    settings?: Pick<SiphonSettings, "instanceUrl" | "apiKey">,
    timeoutMs = 20_000
): Promise<T> => {
    const origin = getSiphonApiOrigin(settings);
    const response = await withTimeout(
        fetch(`${origin}${path}`, {
            method: "POST",
            redirect: "manual",
            headers: {
                ...JSON_HEADERS,
                ...getAuthHeader(settings),
            } satisfies Record<string, string>,
            body: JSON.stringify(body),
        }),
        timeoutMs
    );

    const parsed = await parseJSON<T>(response);
    if (parsed !== undefined) {
        return parsed;
    }

    throw new Error(`invalid json response for ${path}`);
};

export const siphonApi = {
    async analyze(
        request: SiphonAnalyzeRequest,
        settings?: Pick<SiphonSettings, "instanceUrl" | "apiKey">
    ): Promise<SiphonAnalyzeResponse> {
        try {
            return await postJSON<SiphonAnalyzeResponse>("/analyze", request, settings);
        } catch (error) {
            if (error instanceof Error && error.message.includes("timed out")) {
                return toErrorResponse("error.api.timed_out");
            }

            return toErrorResponse("error.api.unreachable");
        }
    },

    async download(
        request: SiphonDownloadRequest,
        settings?: Pick<SiphonSettings, "instanceUrl" | "apiKey">
    ): Promise<SiphonCobaltDownloadResponse> {
        try {
            return await postJSON<SiphonCobaltDownloadResponse>("/", request, settings);
        } catch (error) {
            if (error instanceof Error && error.message.includes("timed out")) {
                return toErrorResponse("error.api.timed_out");
            }

            return toErrorResponse("error.api.unreachable");
        }
    },

    async testConnection(
        settings?: Pick<SiphonSettings, "instanceUrl" | "apiKey">
    ): Promise<SiphonConnectionStatus> {
        const checkedAt = Date.now();

        try {
            const origin = getSiphonApiOrigin(settings);
            const response = await withTimeout(fetch(`${origin}/`, {
                method: "GET",
                redirect: "manual",
                headers: {
                    Accept: "application/json",
                    ...getAuthHeader(settings),
                } satisfies Record<string, string>,
            }), 10_000);

            if (!response.ok) {
                return {
                    ok: false,
                    checkedAt,
                    error: `http_${response.status}`,
                };
            }

            const body = await parseJSON<{
                cobalt?: {
                    version?: string;
                    services?: string[];
                };
            }>(response);

            if (!body?.cobalt?.version) {
                return {
                    ok: false,
                    checkedAt,
                    error: "invalid_response",
                };
            }

            return {
                ok: true,
                checkedAt,
                info: {
                    version: body.cobalt.version,
                    services: Array.isArray(body.cobalt.services) ? body.cobalt.services : [],
                    origin,
                },
            };
        } catch (error) {
            if (error instanceof Error && error.message.includes("timed out")) {
                return { ok: false, checkedAt, error: "error.api.timed_out" };
            }

            return { ok: false, checkedAt, error: "error.api.unreachable" };
        }
    },

    async probeTunnel(url: string): Promise<boolean> {
        try {
            const response = await withTimeout(fetch(`${url}&p=1`, {
                method: "GET",
            }), 10_000);

            return response.status === 200;
        } catch {
            return false;
        }
    },
};
