import test from "node:test";
import assert from "node:assert/strict";

import {
    classifyYouTubeFailure,
    getDefaultHostedClientPools,
    getHostedAttemptQueue,
    getNextHostedAttempt,
} from "./youtube-policy.js";

test("default hosted video queue excludes TV_EMBEDDED and prefers WEB then WEB_CREATOR session clients", () => {
    const pools = getDefaultHostedClientPools({});
    const queue = getHostedAttemptQueue({
        isAudioOnly: false,
        pools,
    });

    assert.deepEqual(pools.session, ["WEB", "WEB_CREATOR"]);
    assert.deepEqual(queue.map(attempt => attempt.client), [
        "IOS",
        "WEB",
        "ANDROID",
        "WEB_CREATOR",
        "MWEB",
        "TV",
    ]);
    assert.equal(queue.some(attempt => attempt.client === "TV_EMBEDDED"), false);
});

test("default hosted audio queue interleaves public and session clients in the expected order", () => {
    const pools = getDefaultHostedClientPools({});
    const queue = getHostedAttemptQueue({
        isAudioOnly: true,
        pools,
    });

    assert.deepEqual(queue.map(attempt => attempt.client), [
        "IOS",
        "WEB",
        "YTMUSIC_ANDROID",
        "WEB_CREATOR",
        "ANDROID",
        "MWEB",
    ]);
});

test("hosted client env overrides preserve the configured order", () => {
    const pools = getDefaultHostedClientPools({
        ytHostedVideoClients: ["ANDROID", "TV"],
        ytHostedAudioClients: ["YTMUSIC_ANDROID", "ANDROID"],
        ytHostedSessionClients: ["WEB_EMBEDDED", "WEB"],
    });

    assert.deepEqual(pools.video, ["ANDROID", "TV"]);
    assert.deepEqual(pools.audio, ["YTMUSIC_ANDROID", "ANDROID"]);
    assert.deepEqual(pools.session, ["WEB_EMBEDDED", "WEB"]);
    assert.deepEqual(
        getHostedAttemptQueue({ isAudioOnly: false, pools }).map(attempt => attempt.client),
        ["ANDROID", "WEB_EMBEDDED", "TV", "WEB"]
    );
});

test("unsupported-device ERROR responses are retryable", () => {
    const classification = classifyYouTubeFailure({
        playability: {
            status: "ERROR",
            reason: "YouTube is no longer supported in this application or device.",
        },
        attemptTrail: [{ client: "TV", transportMode: "direct", sessionMode: "public" }],
        attempt: { client: "TV", transportMode: "direct", sessionMode: "public" },
    });

    assert.equal(classification.retryable, true);
    assert.equal(classification.error, "content.video.unavailable");
    assert.equal(classification.retryReason, "youtube.client");
});

test("bot-wall LOGIN_REQUIRED responses remain retryable", () => {
    const classification = classifyYouTubeFailure({
        playability: {
            status: "LOGIN_REQUIRED",
            reason: "Sign in to confirm you're not a bot",
        },
        attemptTrail: [{ client: "IOS", transportMode: "direct", sessionMode: "public" }],
        attempt: { client: "IOS", transportMode: "direct", sessionMode: "public" },
    });

    assert.equal(classification.retryable, true);
    assert.equal(classification.error, "youtube.login");
    assert.equal(classification.retryReason, "youtube.login");
});

test("terminal private, age, and region responses do not advance into proxy replay", () => {
    const pools = getDefaultHostedClientPools({});
    const queue = getHostedAttemptQueue({
        isAudioOnly: false,
        pools,
        proxyURL: "http://proxy.internal:8080",
    });
    const currentAttempt = queue[0];

    const privateFailure = classifyYouTubeFailure({
        playability: {
            status: "LOGIN_REQUIRED",
            error_screen: {
                reason: { text: "Private video" },
            },
        },
        attemptTrail: [currentAttempt],
        attempt: currentAttempt,
    });
    const ageFailure = classifyYouTubeFailure({
        playability: {
            status: "AGE_VERIFICATION_REQUIRED",
            reason: "Sign in to confirm your age",
        },
        attemptTrail: [currentAttempt],
        attempt: currentAttempt,
    });
    const regionFailure = classifyYouTubeFailure({
        playability: {
            status: "UNPLAYABLE",
            error_screen: {
                subreason: { text: "The uploader has not made this video available in your country" },
            },
        },
        attemptTrail: [currentAttempt],
        attempt: currentAttempt,
    });

    assert.equal(getNextHostedAttempt({
        queue,
        currentAttempt,
        shouldRetry: privateFailure.retryable,
    }), null);
    assert.equal(getNextHostedAttempt({
        queue,
        currentAttempt,
        shouldRetry: ageFailure.retryable,
    }), null);
    assert.equal(getNextHostedAttempt({
        queue,
        currentAttempt,
        shouldRetry: regionFailure.retryable,
    }), null);
});

test("proxy replay happens once and only once when a YouTube proxy is configured", () => {
    const pools = getDefaultHostedClientPools({});
    const queue = getHostedAttemptQueue({
        isAudioOnly: false,
        pools,
        proxyURL: "http://proxy.internal:8080",
    });

    const directAttempts = queue.filter(attempt => attempt.transportMode === "direct");
    const proxyAttempts = queue.filter(attempt => attempt.transportMode === "proxy");

    assert.equal(directAttempts.length, 6);
    assert.equal(proxyAttempts.length, 6);
    assert.deepEqual(
        proxyAttempts.map(attempt => attempt.client),
        directAttempts.map(attempt => attempt.client)
    );
    assert.equal(queue.filter(attempt => attempt.transportMode === "proxy").length, 6);
});
