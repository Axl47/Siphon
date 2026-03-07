import path from "node:path";

import { resolveMatchData } from "./match.js";
import { resolveMatchAction } from "./match-action.js";
import { audioIgnore } from "./service-config.js";
import { estimateTunnelLength } from "../stream/shared.js";
import { wrapStream, destroyInternalStream } from "../stream/manage.js";

const qualityCandidates = ["max", "2160", "1440", "1080", "720", "480", "360", "240", "144"];

const codecLabels = {
    h264: "H.264",
    av1: "AV1",
    vp9: "VP9",
    mp3: "MP3",
    opus: "Opus",
    wav: "WAV",
    ogg: "Ogg",
    m4a: "AAC",
    mp4a: "AAC",
};

const buildBaseDownloadRequest = (request) => ({
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
    alwaysProxy: false,
});

const titleCase = (value) =>
    value.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());

const getCodecLabel = (option) => {
    if (option.request.downloadMode === "audio") {
        return codecLabels[option.request.audioFormat] || titleCase(option.request.audioFormat);
    }

    const rawCodec = option.data.r.filenameAttributes?.youtubeFormat
        || option.request.youtubeVideoCodec;

    if (!rawCodec) {
        const format = getFormat(option);
        return format === "MP3" ? "MP3" : null;
    }

    return codecLabels[rawCodec] || titleCase(rawCodec);
};

const getFormat = (option) => {
    if (option.request.downloadMode === "audio") {
        return option.request.audioFormat?.toUpperCase() || "AUDIO";
    }

    const filename = option.resolved.responseData.filename;
    const ext = option.data.r.filenameAttributes?.extension
        || path.extname(filename).slice(1)
        || option.request.audioFormat;

    return ext ? ext.toUpperCase() : null;
};

const getResolution = (option) => {
    const attrs = option.data.r.filenameAttributes;
    return attrs?.resolution || null;
};

const getFps = (option) => {
    const qualityLabel = option.data.r.filenameAttributes?.qualityLabel;
    if (!qualityLabel) {
        return null;
    }

    const match = qualityLabel.match(/p(\d{2,3})$/i);
    return match ? Number(match[1]) : null;
};

const getDelivery = (option) => {
    switch (option.resolved.responseType) {
        case "redirect":
            return "direct";
        case "local-processing":
            return "processed";
        default:
            return "proxy";
    }
};
export const getAnalyzeDelivery = getDelivery;

const getLabel = (option) => {
    if (option.request.downloadMode === "audio") {
        return "Audio";
    }

    const attrs = option.data.r.filenameAttributes;
    if (attrs?.qualityLabel) {
        return attrs.qualityLabel;
    }

    if (option.request.videoQuality === "max") {
        return "Max";
    }

    return `${option.request.videoQuality}p`;
};

const getSourceMetadata = ({ data, request }) => {
    const metadata = data.r.fileMetadata || {};
    const attrs = data.r.filenameAttributes || {};

    return {
        url: request.url.toString(),
        platform: data.host,
        title: metadata.title || attrs.title || null,
        uploader: metadata.artist || metadata.author || attrs.author || null,
        uploadDate: metadata.date || null,
        duration: typeof data.r.duration === "string"
            ? data.r.duration
            : typeof data.r.duration === "number"
                ? `${data.r.duration}`
                : null,
        thumbnailUrl: data.r.cover || data.r.picker?.[0]?.thumb || null,
    };
};

const cleanupEstimate = (streamInfo) => {
    for (const url of [streamInfo.urls].flat()) {
        if (typeof url === "string") {
            destroyInternalStream(url);
        }
    }

    if (streamInfo.subtitles) {
        destroyInternalStream(streamInfo.subtitles);
    }
};

const estimateOptionSize = async (option) => {
    if (!["tunnel", "local-processing"].includes(option.resolved.responseType)) {
        return null;
    }

    const responseData = option.resolved.responseData;
    const streamInfo = wrapStream({
        ...responseData,
        urls: responseData.url,
    });

    try {
        const estimate = await estimateTunnelLength(streamInfo);
        return estimate > 0 ? estimate : null;
    } finally {
        cleanupEstimate(streamInfo);
    }
};

const getSizeKind = (option, estimatedSizeBytes) => {
    if (typeof option.resolved.responseData?.size === "number" && option.resolved.responseData.size > 0) {
        return "exact";
    }

    if (estimatedSizeBytes !== null) {
        return "estimated";
    }

    return "unknown";
};
export const getAnalyzeSizeKind = getSizeKind;

const parseDurationSeconds = (value) => {
    if (typeof value === "number" && value > 0) {
        return value;
    }

    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    if (/^\d+(\.\d+)?$/.test(normalized)) {
        const parsed = Number(normalized);
        return parsed > 0 ? parsed : null;
    }

    const parts = normalized.split(":").map(Number);
    if (parts.some(Number.isNaN)) {
        return null;
    }

    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts;
        return hours * 3600 + minutes * 60 + seconds;
    }

    if (parts.length === 2) {
        const [minutes, seconds] = parts;
        return minutes * 60 + seconds;
    }

    return null;
};

const getBitrateKbps = (estimatedSizeBytes, durationValue) => {
    const durationSeconds = parseDurationSeconds(durationValue);
    if (!estimatedSizeBytes || !durationSeconds) {
        return null;
    }

    return Math.round((estimatedSizeBytes * 8) / durationSeconds / 1000);
};
export const deriveAnalyzeBitrateKbps = getBitrateKbps;

const buildOptionKey = (option) => [
    option.label,
    option.downloadMode,
    option.format || "",
    option.codec || "",
    option.resolution || "",
    option.fps ?? "fps-unknown",
    option.delivery,
    option.bitrateKbps ?? "bitrate-unknown",
].join("|");

export const dedupeAnalyzeOptions = (options) => {
    const deduped = [];
    const seen = new Set();

    for (const option of options) {
        const key = buildOptionKey(option);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(option);
    }

    return deduped;
};

export const buildAnalyzeOption = async (option, index) => {
    const format = getFormat(option);
    const codec = getCodecLabel(option);
    const fps = getFps(option);
    const exactSizeBytes = typeof option.resolved.responseData?.size === "number"
        && option.resolved.responseData.size > 0
        ? option.resolved.responseData.size
        : null;
    const estimatedSizeBytes = exactSizeBytes ?? await estimateOptionSize(option);
    const bitrateKbps = getBitrateKbps(estimatedSizeBytes, option.data.r.duration);

    return {
        id: `${option.request.downloadMode}-${option.request.videoQuality}-${index}`,
        label: getLabel(option),
        videoQuality: option.request.videoQuality,
        downloadMode: option.request.downloadMode,
        format,
        codec,
        resolution: getResolution(option),
        fps,
        bitrateKbps,
        delivery: getDelivery(option),
        sizeKind: getSizeKind(option, estimatedSizeBytes),
        estimatedSizeBytes,
        downloadRequest: option.request,
    };
};

export const buildAnalyzeSuccess = async ({ source, options }) => {
    const built = [];

    for (const [index, option] of options.entries()) {
        built.push(await buildAnalyzeOption(option, index));
    }

    return {
        status: "ok",
        source,
        options: dedupeAnalyzeOptions(built),
    };
};

export const buildAnalyzePicker = ({ source, picker }) => ({
    status: "picker",
    source,
    options: [],
    pickerItems: picker.map((item, index) => ({
        id: `${item.type}-${index}`,
        type: item.type,
        thumb: item.thumb || null,
        title: null,
    })),
});

export const buildAnalyzeError = (error) => ({
    status: "error",
    error: {
        code: error.body.error.code,
        context: error.body.error.context,
    }
});

const shouldSkipOptionError = (errorCode) => [
    "error.api.service.audio_not_supported",
    "error.api.fetch.empty",
    "error.api.youtube.no_matching_format",
].includes(errorCode);

export async function analyzeMatch({ host, patternMatch, request, authType }) {
    const baseRequest = buildBaseDownloadRequest(request);
    const initial = await resolveMatchData({
        host,
        patternMatch,
        params: {
            ...baseRequest,
            url: request.url,
        },
        authType,
    });

    if (initial.error) {
        return buildAnalyzeError(initial.error);
    }

    const source = getSourceMetadata({
        data: initial.data,
        request,
    });

    if (initial.data.r.picker) {
        return buildAnalyzePicker({
            source,
            picker: initial.data.r.picker,
        });
    }

    const optionRequests = [];

    if (initial.data.r.isAudioOnly) {
        optionRequests.push({
            ...baseRequest,
            downloadMode: "audio",
            videoQuality: "max",
        });
    } else {
        for (const quality of qualityCandidates) {
            optionRequests.push({
                ...baseRequest,
                videoQuality: quality,
            });
        }

        if (!audioIgnore.has(host)) {
            optionRequests.push({
                ...baseRequest,
                downloadMode: "audio",
                videoQuality: "max",
            });
        }
    }

    const options = [];

    for (const optionRequest of optionRequests) {
        const resolvedData = await resolveMatchData({
            host,
            patternMatch,
            params: {
                ...optionRequest,
                url: request.url,
            },
            authType,
        });

        if (resolvedData.error) {
            if (shouldSkipOptionError(resolvedData.error.body.error.code)) {
                continue;
            }

            return buildAnalyzeError(resolvedData.error);
        }

        if (resolvedData.data.r.picker) {
            continue;
        }

        const resolved = resolveMatchAction(resolvedData.data);
        if ("status" in resolved) {
            if (shouldSkipOptionError(resolved.body.error.code)) {
                continue;
            }

            return buildAnalyzeError(resolved);
        }

        options.push({
            data: resolvedData.data,
            request: optionRequest,
            resolved,
        });
    }

    return buildAnalyzeSuccess({
        source,
        options,
    });
}
