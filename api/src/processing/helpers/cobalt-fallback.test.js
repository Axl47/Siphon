import test from "node:test";
import assert from "node:assert/strict";

import { env } from "../../config.js";
import { loadEnvs, validateEnvs } from "../../core/env.js";
import {
    callFallbackDownload,
    getFallbackInstanceHost,
    shouldTryYoutubeFallback,
    wrapFallbackResponse,
} from "./cobalt-fallback.js";

const originalFetch = globalThis.fetch;

const withFallbackEnv = async (overrides, fn) => {
    const snapshot = {
        ytFallbackApiURL: env.ytFallbackApiURL,
        ytFallbackAuthHeader: env.ytFallbackAuthHeader,
        ytFallbackTimeoutMs: env.ytFallbackTimeoutMs,
        apiURL: env.apiURL,
    };

    Object.assign(env, overrides);

    try {
        await fn();
    } finally {
        Object.assign(env, snapshot);
        globalThis.fetch = originalFetch;
    }
};

test("shouldTryYoutubeFallback matches retryable and terminal YouTube failures", async () => {
    await withFallbackEnv({
        ytFallbackApiURL: "https://fallback.example",
    }, async () => {
        assert.equal(shouldTryYoutubeFallback("error.api.youtube.login", {}), true);
        assert.equal(shouldTryYoutubeFallback("error.api.fetch.fail", {}), true);
        assert.equal(shouldTryYoutubeFallback("error.api.fetch.rate", {}), true);
        assert.equal(shouldTryYoutubeFallback("error.api.content.video.unavailable", {
            youtubeStatus: "ERROR",
            youtubeReason: "YouTube is no longer supported in this application or device.",
        }), true);

        assert.equal(shouldTryYoutubeFallback("error.api.content.video.private", {}), false);
        assert.equal(shouldTryYoutubeFallback("error.api.content.video.region", {}), false);
        assert.equal(shouldTryYoutubeFallback("error.api.fetch.fail", {}), true);
        assert.equal(shouldTryYoutubeFallback("error.api.fetch.fail", null), true);
    });
});

test("validateEnvs rejects a self-referential YOUTUBE_FALLBACK_API_URL", async () => {
    await assert.rejects(
        validateEnvs(loadEnvs({
            API_URL: "https://api.example",
            YOUTUBE_FALLBACK_API_URL: "https://api.example/",
        })),
        /must not point at the current API origin/
    );
});

test("callFallbackDownload attaches the configured Authorization header", async () => {
    await withFallbackEnv({
        ytFallbackApiURL: "https://fallback.example",
        ytFallbackAuthHeader: "Api-Key secret",
        ytFallbackTimeoutMs: 100,
    }, async () => {
        let seenAuthorization;
        globalThis.fetch = async (_, init) => {
            seenAuthorization = init.headers.Authorization;
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

        const result = await callFallbackDownload({
            url: "https://youtube.com/watch?v=abc123xyz89",
        });

        assert.equal(result.ok, true);
        assert.equal(seenAuthorization, "Api-Key secret");
        assert.equal(getFallbackInstanceHost(), "fallback.example");
    });
});

test("callFallbackDownload times out cleanly", async () => {
    await withFallbackEnv({
        ytFallbackApiURL: "https://fallback.example",
        ytFallbackTimeoutMs: 5,
    }, async () => {
        globalThis.fetch = async () => new Promise(() => {});

        const result = await callFallbackDownload({
            url: "https://youtube.com/watch?v=abc123xyz89",
        });

        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "youtube.fallback.timeout");
    });
});

test("wrapFallbackResponse rewrites remote tunnel and redirect URLs to the local API origin", async () => {
    await withFallbackEnv({
        apiURL: "https://siphon.example",
    }, async () => {
        const wrappedTunnel = wrapFallbackResponse({
            status: "tunnel",
            url: "https://fallback.example/tunnel?id=1",
            filename: "video.mp4",
        }, "youtube");
        const wrappedRedirect = wrapFallbackResponse({
            status: "redirect",
            url: "https://rr5---sn.example.googlevideo.com/videoplayback",
            filename: "video.mp4",
        }, "youtube");

        assert.equal(wrappedTunnel.body.status, "tunnel");
        assert.equal(wrappedRedirect.body.status, "tunnel");
        assert.equal(wrappedTunnel.body.url.startsWith("https://siphon.example/tunnel?"), true);
        assert.equal(wrappedRedirect.body.url.startsWith("https://siphon.example/tunnel?"), true);
    });
});
