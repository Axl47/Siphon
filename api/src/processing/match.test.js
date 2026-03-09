import test from "node:test";
import assert from "node:assert/strict";

import { env } from "../config.js";
import { resolveMatchData } from "./match.js";
import match from "./match.js";

const originalFetch = globalThis.fetch;

const withFallbackEnv = async (overrides, fn) => {
    const snapshot = {
        apiURL: env.apiURL,
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

test("resolveMatchData carries late YouTube proxy and request transport fields into the resolved action input", async () => {
    const resolved = await resolveMatchData({
        host: "youtube",
        patternMatch: {
            id: "abc123xyz89",
        },
        params: {
            url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
            downloadMode: "auto",
            videoQuality: "1080",
            youtubeVideoCodec: "h264",
            youtubeVideoContainer: "auto",
            filenameStyle: "basic",
            convertGif: true,
            disableMetadata: false,
            audioFormat: "mp3",
            audioBitrate: "128",
            localProcessing: "disabled",
            alwaysProxy: false,
            youtubeHLS: false,
            youtubeBetterAudio: false,
        },
        authType: "none",
        serviceOverrides: {
            youtube: async () => ({
                urls: "https://media.example/video.mp4",
                filename: "video.mp4",
                proxyToUse: "http://proxy.internal:8080",
                requestIP: "198.51.100.42",
            }),
        },
    });

    assert.equal(resolved.error, undefined);
    assert.equal(resolved.data.host, "youtube");
    assert.equal(resolved.data.proxyToUse, "http://proxy.internal:8080");
    assert.equal(resolved.data.requestIP, "198.51.100.42");
    assert.equal(resolved.data.r.proxyToUse, "http://proxy.internal:8080");
});

test("match retries YouTube through the fallback instance and rewraps the returned tunnel locally", async () => {
    await withFallbackEnv({
        apiURL: "https://siphon.example",
        ytFallbackApiURL: "https://fallback.example",
        ytFallbackTimeoutMs: 100,
    }, async () => {
        let fallbackCalls = 0;
        globalThis.fetch = async (url) => {
            fallbackCalls += 1;
            assert.equal(new URL(url).origin, "https://fallback.example");
            return new Response(JSON.stringify({
                status: "tunnel",
                url: "https://fallback.example/tunnel?id=1",
                filename: "video.mp4",
            }), {
                status: 200,
                headers: {
                    "content-type": "application/json",
                },
            });
        };

        const result = await match({
            host: "youtube",
            patternMatch: {
                id: "abc123xyz89",
            },
            params: {
                url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
                downloadMode: "auto",
                videoQuality: "1080",
                youtubeVideoCodec: "h264",
                youtubeVideoContainer: "auto",
                filenameStyle: "basic",
                convertGif: true,
                disableMetadata: false,
                audioFormat: "mp3",
                audioBitrate: "128",
                localProcessing: "disabled",
                alwaysProxy: false,
                youtubeHLS: false,
                youtubeBetterAudio: false,
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

        assert.equal(fallbackCalls, 1);
        assert.equal(result.body.status, "tunnel");
        assert.equal(result.body.url.startsWith("https://siphon.example/tunnel?"), true);
    });
});

test("match does not call the fallback instance when local YouTube succeeds", async () => {
    await withFallbackEnv({
        apiURL: "https://siphon.example",
        ytFallbackApiURL: "https://fallback.example",
    }, async () => {
        let fallbackCalls = 0;
        globalThis.fetch = async () => {
            fallbackCalls += 1;
            throw new Error("should not be called");
        };

        const result = await match({
            host: "youtube",
            patternMatch: {
                id: "abc123xyz89",
            },
            params: {
                url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
                downloadMode: "auto",
                videoQuality: "1080",
                youtubeVideoCodec: "h264",
                youtubeVideoContainer: "auto",
                filenameStyle: "basic",
                convertGif: true,
                disableMetadata: false,
                audioFormat: "mp3",
                audioBitrate: "128",
                localProcessing: "disabled",
                alwaysProxy: false,
                youtubeHLS: false,
                youtubeBetterAudio: false,
            },
            authType: "none",
            serviceOverrides: {
                youtube: async () => ({
                    urls: "https://media.example/video.mp4",
                    filename: "video.mp4",
                }),
            },
        });

        assert.equal(fallbackCalls, 0);
        assert.equal(result.body.status, "tunnel");
    });
});

test("match does not call the fallback instance for terminal YouTube failures", async () => {
    await withFallbackEnv({
        apiURL: "https://siphon.example",
        ytFallbackApiURL: "https://fallback.example",
    }, async () => {
        let fallbackCalls = 0;
        globalThis.fetch = async () => {
            fallbackCalls += 1;
            throw new Error("should not be called");
        };

        const result = await match({
            host: "youtube",
            patternMatch: {
                id: "abc123xyz89",
            },
            params: {
                url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
                downloadMode: "auto",
                videoQuality: "1080",
                youtubeVideoCodec: "h264",
                youtubeVideoContainer: "auto",
                filenameStyle: "basic",
                convertGif: true,
                disableMetadata: false,
                audioFormat: "mp3",
                audioBitrate: "128",
                localProcessing: "disabled",
                alwaysProxy: false,
                youtubeHLS: false,
                youtubeBetterAudio: false,
            },
            authType: "none",
            serviceOverrides: {
                youtube: async () => ({
                    error: "content.video.private",
                }),
            },
        });

        assert.equal(fallbackCalls, 0);
        assert.equal(result.body.error.code, "error.api.content.video.private");
    });
});

test("match preserves the original YouTube error when fallback fails", async () => {
    await withFallbackEnv({
        apiURL: "https://siphon.example",
        ytFallbackApiURL: "https://fallback.example",
        ytFallbackTimeoutMs: 100,
    }, async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({
            error: {
                code: "error.api.fetch.fail",
            },
        }), {
            status: 400,
            headers: {
                "content-type": "application/json",
            },
        });

        const result = await match({
            host: "youtube",
            patternMatch: {
                id: "abc123xyz89",
            },
            params: {
                url: new URL("https://www.youtube.com/watch?v=abc123xyz89"),
                downloadMode: "auto",
                videoQuality: "1080",
                youtubeVideoCodec: "h264",
                youtubeVideoContainer: "auto",
                filenameStyle: "basic",
                convertGif: true,
                disableMetadata: false,
                audioFormat: "mp3",
                audioBitrate: "128",
                localProcessing: "disabled",
                alwaysProxy: false,
                youtubeHLS: false,
                youtubeBetterAudio: false,
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

        assert.equal(result.body.error.code, "error.api.youtube.login");
        assert.equal(result.body.error.context.youtubeFallbackAttempted, true);
        assert.equal(result.body.error.context.youtubeFallbackUsed, false);
        assert.equal(result.body.error.context.youtubeFallbackInstanceHost, "fallback.example");
        assert.equal(result.body.error.context.youtubeFallbackErrorCode, "fetch.fail");
    });
});
