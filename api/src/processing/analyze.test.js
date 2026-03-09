import test from "node:test";
import assert from "node:assert/strict";

import { env } from "../config.js";
import {
    analyzeMatch,
    buildAnalyzeError,
    buildAnalyzeOption,
    buildAnalyzePicker,
    buildAnalyzeSuccess,
    dedupeAnalyzeOptions,
    deriveAnalyzeBitrateKbps,
    getAnalyzeDelivery,
    getAnalyzeSizeKind,
} from "./analyze.js";

const originalFetch = globalThis.fetch;

const withFallbackEnv = async (overrides, fn) => {
    const snapshot = {
        ytFallbackApiURL: env.ytFallbackApiURL,
        ytFallbackAuthHeader: env.ytFallbackAuthHeader,
        ytFallbackTimeoutMs: env.ytFallbackTimeoutMs,
    };

    Object.assign(env, overrides);

    try {
        await fn();
    } finally {
        Object.assign(env, snapshot);
        globalThis.fetch = originalFetch;
    }
};

const makeVideoOption = (overrides = {}) => ({
    data: {
        host: "youtube",
        r: {
            filenameAttributes: {
                title: "Example Video",
                author: "Siphon",
                qualityLabel: "1080p",
                extension: "mp4",
                youtubeFormat: "h264",
                resolution: "1920x1080",
            },
            fileMetadata: {
                title: "Example Video",
                artist: "Siphon",
            },
        },
    },
    request: {
        url: "https://youtube.com/watch?v=abc",
        downloadMode: "auto",
        videoQuality: "1080",
        youtubeVideoCodec: "h264",
        audioFormat: "mp3",
    },
    resolved: {
        responseType: "redirect",
        responseData: {
            filename: "Example Video (1080p, youtube).mp4",
        },
    },
    ...overrides,
});

test("buildAnalyzeSuccess returns a Siphon success payload for a single-item video source", async () => {
    const response = await buildAnalyzeSuccess({
        source: {
            url: "https://youtube.com/watch?v=abc",
            platform: "youtube",
            title: "Example Video",
            uploader: "Siphon",
            uploadDate: "2026-03-07",
            duration: "3:42",
            thumbnailUrl: "https://example.com/thumb.jpg",
        },
        options: [makeVideoOption()],
    });

    assert.equal(response.status, "ok");
    assert.equal(response.source.platform, "youtube");
    assert.equal(response.options.length, 1);
    assert.deepEqual(response.options[0], {
        id: "auto-1080-0",
        label: "1080p",
        videoQuality: "1080",
        downloadMode: "auto",
        format: "MP4",
        codec: "H.264",
        resolution: "1920x1080",
        fps: null,
        bitrateKbps: null,
        delivery: "direct",
        sizeKind: "unknown",
        estimatedSizeBytes: null,
        downloadRequest: makeVideoOption().request,
    });
});

test("buildAnalyzeOption exposes an audio-only option when supported", async () => {
    const option = await buildAnalyzeOption(makeVideoOption({
        request: {
            url: "https://youtube.com/watch?v=abc",
            downloadMode: "audio",
            videoQuality: "max",
            youtubeVideoCodec: "h264",
            audioFormat: "mp3",
        },
        resolved: {
            responseType: "redirect",
            responseData: {
                filename: "Example Video (youtube).mp3",
            },
        },
    }), 0);

    assert.equal(option.label, "Audio");
    assert.equal(option.downloadMode, "audio");
    assert.equal(option.format, "MP3");
    assert.equal(option.codec, "MP3");
    assert.equal(option.delivery, "direct");
    assert.equal(option.sizeKind, "unknown");
    assert.equal(option.estimatedSizeBytes, null);
});

test("buildAnalyzePicker normalizes picker items for the web client", () => {
    const response = buildAnalyzePicker({
        source: {
            url: "https://x.com/siphon/status/1",
            platform: "twitter",
            title: null,
            uploader: null,
            uploadDate: null,
            duration: null,
            thumbnailUrl: null,
        },
        picker: [
            { type: "photo", thumb: "https://example.com/1.jpg" },
            { type: "video", thumb: "https://example.com/2.jpg" },
        ],
    });

    assert.equal(response.status, "picker");
    assert.deepEqual(response.options, []);
    assert.deepEqual(response.pickerItems, [
        { id: "photo-0", type: "photo", thumb: "https://example.com/1.jpg", title: null },
        { id: "video-1", type: "video", thumb: "https://example.com/2.jpg", title: null },
    ]);
});

test("buildAnalyzeError passes through the API error payload", () => {
    const response = buildAnalyzeError({
        body: {
            error: {
                code: "error.api.fetch.empty",
                context: {
                    service: "YouTube",
                },
            },
        },
    });

    assert.deepEqual(response, {
        status: "error",
        error: {
            code: "error.api.fetch.empty",
            context: {
                service: "YouTube",
            },
        },
    });
});

test("dedupeAnalyzeOptions removes equivalent qualities and preserves unknown size fallback", () => {
    const options = dedupeAnalyzeOptions([
        {
            id: "auto-1080-0",
            label: "1080p",
            videoQuality: "1080",
            downloadMode: "auto",
            format: "MP4",
            codec: "H.264",
            resolution: "1920x1080",
            fps: null,
            bitrateKbps: null,
            delivery: "direct",
            sizeKind: "unknown",
            estimatedSizeBytes: null,
            downloadRequest: { videoQuality: "1080" },
        },
        {
            id: "auto-max-1",
            label: "1080p",
            videoQuality: "max",
            downloadMode: "auto",
            format: "MP4",
            codec: "H.264",
            resolution: "1920x1080",
            fps: null,
            bitrateKbps: null,
            delivery: "direct",
            sizeKind: "unknown",
            estimatedSizeBytes: null,
            downloadRequest: { videoQuality: "max" },
        },
        {
            id: "audio-max-2",
            label: "Audio",
            videoQuality: "max",
            downloadMode: "audio",
            format: "MP3",
            codec: "MP3",
            resolution: null,
            fps: null,
            bitrateKbps: null,
            delivery: "direct",
            sizeKind: "unknown",
            estimatedSizeBytes: null,
            downloadRequest: { downloadMode: "audio" },
        },
    ]);

    assert.equal(options.length, 2);
    assert.equal(options[0].estimatedSizeBytes, null);
    assert.equal(options[1].downloadMode, "audio");
});

test("dedupeAnalyzeOptions keeps options with different delivery or bitrate metadata", () => {
    const options = dedupeAnalyzeOptions([
        {
            id: "direct-1",
            label: "1080p",
            videoQuality: "1080",
            downloadMode: "auto",
            format: "MP4",
            codec: "H.264",
            resolution: "1920x1080",
            fps: null,
            bitrateKbps: 1600,
            delivery: "direct",
            sizeKind: "unknown",
            estimatedSizeBytes: null,
            downloadRequest: { videoQuality: "1080" },
        },
        {
            id: "proxy-1",
            label: "1080p",
            videoQuality: "1080",
            downloadMode: "auto",
            format: "MP4",
            codec: "H.264",
            resolution: "1920x1080",
            fps: null,
            bitrateKbps: 1600,
            delivery: "proxy",
            sizeKind: "estimated",
            estimatedSizeBytes: 42_000_000,
            downloadRequest: { videoQuality: "1080" },
        },
        {
            id: "proxy-2",
            label: "1080p",
            videoQuality: "1080",
            downloadMode: "auto",
            format: "MP4",
            codec: "H.264",
            resolution: "1920x1080",
            fps: null,
            bitrateKbps: 2200,
            delivery: "proxy",
            sizeKind: "estimated",
            estimatedSizeBytes: 52_000_000,
            downloadRequest: { videoQuality: "1080" },
        },
    ]);

    assert.equal(options.length, 3);
});

test("analyzeMatch synthesizes a YouTube fallback quality list when the fallback instance lacks /analyze", async () => {
    await withFallbackEnv({
        ytFallbackApiURL: "https://fallback.example",
        ytFallbackTimeoutMs: 100,
    }, async () => {
        const calls = [];
        globalThis.fetch = async (url, init) => {
            const parsedURL = new URL(url);
            const body = JSON.parse(init.body);
            calls.push({ pathname: parsedURL.pathname, body });

            if (parsedURL.pathname === "/analyze") {
                return new Response(JSON.stringify({
                    error: {
                        code: "error.api.generic",
                    },
                }), {
                    status: 405,
                    headers: {
                        "content-type": "application/json",
                    },
                });
            }

            if (body.downloadMode === "audio") {
                return new Response(JSON.stringify({
                    status: "tunnel",
                    url: "https://fallback.example/tunnel/audio",
                    filename: "Example Video.mp3",
                }), {
                    status: 200,
                    headers: {
                        "content-type": "application/json",
                    },
                });
            }

            if (body.videoQuality === "1080") {
                return new Response(JSON.stringify({
                    status: "tunnel",
                    url: "https://fallback.example/tunnel/video",
                    filename: "Example Video.mp4",
                }), {
                    status: 200,
                    headers: {
                        "content-type": "application/json",
                    },
                });
            }

            return new Response(JSON.stringify({
                error: {
                    code: "error.api.youtube.no_matching_format",
                },
            }), {
                status: 400,
                headers: {
                    "content-type": "application/json",
                },
            });
        };

        const response = await analyzeMatch({
            host: "youtube",
            patternMatch: {
                id: "abc123xyz89",
            },
            request: {
                url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
                audioFormat: "mp3",
                youtubeVideoCodec: "h264",
                youtubeVideoContainer: "auto",
                allowH265: false,
                tiktokFullAudio: false,
            },
            authType: "none",
            serviceOverrides: {
                youtube: async () => ({
                    error: "youtube.login",
                    context: {
                        youtubeStatus: "LOGIN_REQUIRED",
                        youtubeReason: "Sign in to confirm you're not a bot",
                    },
                }),
            },
        });

        assert.equal(calls[0].pathname, "/analyze");
        assert.equal(response.status, "ok");
        assert.equal(response.options.length, 2);
        assert.equal(response.options[0].label, "1080p");
        assert.equal(response.options[1].label, "Audio");
        assert.equal(response.source.platform, "youtube");
        assert.equal(response.source.title, "Example Video");
    });
});

test("analyze metadata helpers expose delivery, bitrate, and size kind", () => {
    assert.equal(getAnalyzeDelivery(makeVideoOption({
        resolved: { responseType: "redirect", responseData: { filename: "direct.mp4" } },
    })), "direct");

    assert.equal(getAnalyzeDelivery(makeVideoOption({
        resolved: { responseType: "tunnel", responseData: { filename: "proxy.mp4" } },
    })), "proxy");

    assert.equal(getAnalyzeDelivery(makeVideoOption({
        resolved: { responseType: "local-processing", responseData: { filename: "processed.mp4" } },
    })), "processed");

    assert.equal(deriveAnalyzeBitrateKbps(42_000_000, 120), 2800);
    assert.equal(getAnalyzeSizeKind(makeVideoOption(), null), "unknown");
    assert.equal(getAnalyzeSizeKind(makeVideoOption(), 42_000_000), "estimated");
    assert.equal(getAnalyzeSizeKind(makeVideoOption({
        resolved: {
            responseType: "redirect",
            responseData: {
                filename: "direct.mp4",
                size: 42_000_000,
            },
        },
    }), 42_000_000), "exact");
});
