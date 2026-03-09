import path from "node:path";

import { env } from "../../config.js";
import { createResponse } from "../request.js";
import { createStream } from "../../stream/manage.js";

const JSON_HEADERS = {
    Accept: "application/json",
    "Content-Type": "application/json",
};

const retryableYouTubeStatuses = new Set(["LOGIN_REQUIRED", "ERROR", "UNPLAYABLE"]);
const unsupportedDevicePatterns = [
    /no longer supported in this application or device/i,
    /not supported in this application or device/i,
    /unsupported in this application or device/i,
];

const qualityCandidates = ["max", "2160", "1440", "1080", "720", "480", "360", "240", "144"];

const audioCodecLabels = {
    mp3: "MP3",
    opus: "Opus",
    wav: "WAV",
    ogg: "OGG",
    m4a: "AAC",
    mp4a: "AAC",
};

const videoCodecLabels = {
    h264: "H.264",
    av1: "AV1",
    vp9: "VP9",
};

const stripApiErrorPrefix = (code) => code?.replace(/^error\.api\./, "") || code;

const getFallbackURL = (pathname) => {
    if (!env.ytFallbackApiURL) {
        return null;
    }

    return new URL(pathname, `${env.ytFallbackApiURL}/`);
};

const withTimeout = async (request, timeoutMs) => {
    let timeout;

    try {
        return await Promise.race([
            request,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};

const parseJSON = async (response) => {
    try {
        return await response.json();
    } catch {
        return undefined;
    }
};

const createFallbackError = (errorCode, extra = {}) => ({
    ok: false,
    errorCode,
    instanceHost: getFallbackInstanceHost(),
    ...extra,
});

const postFallbackJSON = async (pathname, body) => {
    const url = getFallbackURL(pathname);
    if (!url) {
        return createFallbackError("youtube.fallback.disabled");
    }

    try {
        const response = await withTimeout(fetch(url, {
            method: "POST",
            headers: {
                ...JSON_HEADERS,
                ...(env.ytFallbackAuthHeader ? { Authorization: env.ytFallbackAuthHeader } : {}),
            },
            body: JSON.stringify(body),
        }), env.ytFallbackTimeoutMs);

        const parsed = await parseJSON(response);
        if (parsed === undefined) {
            return createFallbackError("youtube.fallback.invalid_json", {
                responseStatus: response.status,
            });
        }

        if (!response.ok) {
            return createFallbackError(stripApiErrorPrefix(parsed?.error?.code) || `youtube.fallback.http_${response.status}`, {
                responseStatus: response.status,
                responseBody: parsed,
            });
        }

        if (typeof parsed?.status !== "string") {
            return createFallbackError("youtube.fallback.invalid_response", {
                responseStatus: response.status,
                responseBody: parsed,
            });
        }

        return {
            ok: true,
            response: parsed,
            responseStatus: response.status,
            instanceHost: url.host,
        };
    } catch (error) {
        if (error instanceof Error && error.message === "timeout") {
            return createFallbackError("youtube.fallback.timeout");
        }

        return createFallbackError("youtube.fallback.unreachable");
    }
};

const getFallbackDelivery = (status) => {
    switch (status) {
        case "redirect":
            return "direct";
        case "local-processing":
            return "processed";
        default:
            return "proxy";
    }
};

const inferMediaFormat = (filename) => {
    const ext = path.extname(filename || "").slice(1);
    return ext ? ext.toUpperCase() : null;
};

const buildFallbackOptionLabel = (request) => {
    if (request.downloadMode === "audio") {
        return "Audio";
    }

    if (request.videoQuality === "max") {
        return "Max";
    }

    return `${request.videoQuality}p`;
};

const buildFallbackCodecLabel = (request, format) => {
    if (request.downloadMode === "audio") {
        return audioCodecLabels[request.audioFormat] || request.audioFormat?.toUpperCase() || "AUDIO";
    }

    return videoCodecLabels[request.youtubeVideoCodec] || format;
};

const guessTitleFromFilename = (filename) => {
    const base = path.basename(filename || "", path.extname(filename || ""));
    return base || null;
};

export const getFallbackInstanceHost = () => {
    if (!env.ytFallbackApiURL) {
        return null;
    }

    return new URL(env.ytFallbackApiURL).host;
};

export const shouldTryYoutubeFallback = (errorCode, context) => {
    const normalizedCode = stripApiErrorPrefix(errorCode);
    if (!env.ytFallbackApiURL) {
        return false;
    }

    if (["youtube.login", "fetch.fail", "fetch.rate"].includes(normalizedCode)) {
        return true;
    }

    if (normalizedCode !== "content.video.unavailable") {
        return false;
    }

    const status = context?.youtubeStatus;
    const reason = context?.youtubeReason;

    if (!retryableYouTubeStatuses.has(status)) {
        return false;
    }

    if (unsupportedDevicePatterns.some(pattern => pattern.test(reason || ""))) {
        return true;
    }

    return /bot/i.test(reason || "");
};

export const buildFallbackDiagnostics = (result, used = false) => ({
    youtubeFallbackAttempted: true,
    youtubeFallbackUsed: used,
    youtubeFallbackInstanceHost: result?.instanceHost || getFallbackInstanceHost(),
    ...(result?.errorCode ? { youtubeFallbackErrorCode: result.errorCode } : {}),
    ...(typeof result?.responseStatus === "number" ? { youtubeFallbackResponseStatus: result.responseStatus } : {}),
});

export const appendFallbackDiagnosticsToError = (errorResponse, result) => {
    const currentContext = errorResponse.body?.error?.context || {};
    errorResponse.body.error.context = {
        ...currentContext,
        ...buildFallbackDiagnostics(result, false),
    };
    return errorResponse;
};

export const callFallbackAnalyze = async (request) => postFallbackJSON("/analyze", request);

export const callFallbackDownload = async (request) => postFallbackJSON("/", request);

export const wrapFallbackUrlAsLocalTunnel = (url, meta = {}) => createStream({
    type: "proxy",
    url,
    service: meta.service || "youtube",
    filename: meta.filename,
});

export const wrapFallbackResponse = (response, host) => {
    const fallbackFilename = response?.filename || response?.output?.filename || `${host}.bin`;

    switch (response?.status) {
        case "tunnel":
        case "redirect":
            return createResponse("tunnel", {
                type: "proxy",
                url: response.url,
                service: host,
                filename: fallbackFilename,
            });

        case "picker":
            return {
                status: 200,
                body: {
                    status: "picker",
                    picker: (response.picker || []).map((item) => ({
                        ...item,
                        url: wrapFallbackUrlAsLocalTunnel(item.url, {
                            service: host,
                        }),
                    })),
                    audio: response.audio
                        ? wrapFallbackUrlAsLocalTunnel(response.audio, {
                            service: host,
                            filename: response.audioFilename,
                        })
                        : undefined,
                    audioFilename: response.audioFilename,
                },
            };

        case "local-processing":
            return {
                status: 200,
                body: {
                    ...response,
                    tunnel: (response.tunnel || []).map((url) => wrapFallbackUrlAsLocalTunnel(url, {
                        service: host,
                    })),
                },
            };

        default:
            return null;
    }
};

export const buildFallbackAnalyzeOption = (request, response, index) => {
    const filename = response.filename || response.output?.filename || null;
    const format = inferMediaFormat(filename);

    return {
        id: `${request.downloadMode}-${request.videoQuality}-${index}`,
        label: buildFallbackOptionLabel(request),
        videoQuality: request.videoQuality,
        downloadMode: request.downloadMode,
        format,
        codec: buildFallbackCodecLabel(request, format),
        resolution: null,
        fps: null,
        bitrateKbps: null,
        delivery: getFallbackDelivery(response.status),
        sizeKind: "unknown",
        estimatedSizeBytes: null,
        downloadRequest: request,
    };
};

export const buildFallbackAnalyzeSource = (request, response) => {
    const filename = response?.filename || response?.output?.filename || null;

    return {
        url: request.url.toString(),
        platform: "youtube",
        title: guessTitleFromFilename(filename),
        uploader: null,
        uploadDate: null,
        duration: null,
        thumbnailUrl: null,
    };
};

export const buildFallbackAnalyzeRequests = (request) => {
    const baseRequest = {
        url: request.url.toString(),
        audioBitrate: "128",
        audioFormat: request.audioFormat,
        downloadMode: "auto",
        filenameStyle: "pretty",
        videoQuality: "1080",
        youtubeVideoCodec: request.youtubeVideoCodec,
        youtubeVideoContainer: request.youtubeVideoContainer,
        localProcessing: "disabled",
        disableMetadata: false,
        allowH265: request.allowH265,
        convertGif: true,
        tiktokFullAudio: request.tiktokFullAudio,
        alwaysProxy: true,
    };

    const optionRequests = qualityCandidates.map((quality) => ({
        ...baseRequest,
        videoQuality: quality,
    }));

    optionRequests.push({
        ...baseRequest,
        downloadMode: "audio",
        videoQuality: "max",
    });

    return optionRequests;
};
