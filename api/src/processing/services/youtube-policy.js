import { Constants } from "youtubei.js";

const defaultHostedVideoClients = ["IOS", "ANDROID", "MWEB", "TV"];
const defaultHostedAudioClients = ["IOS", "YTMUSIC_ANDROID", "ANDROID", "MWEB"];
const defaultHostedSessionClients = ["WEB", "WEB_CREATOR"];
const unsupportedDevicePatterns = [
    /no longer supported in this application or device/i,
    /not supported in this application or device/i,
    /unsupported in this application or device/i,
];

const dedupeClients = (clients = []) => [
    ...new Set(
        clients
            .filter(Boolean)
            .map(client => client.trim())
            .filter(Boolean)
    )
];

const prependPreferredClient = (clients, preferredClient) =>
    dedupeClients([preferredClient, ...clients]);

const getFailureReason = (playability) =>
    playability?.reason
    || playability?.error_screen?.subreason?.text
    || playability?.error_screen?.reason?.text
    || null;

const isPrivateReason = (playability) =>
    playability?.error_screen?.reason?.text === "Private video"
    || getFailureReason(playability) === "Private video";

const isAgeReason = (reason) =>
    reason?.endsWith("age")
    || reason?.endsWith("inappropriate for some users.");

const isBotReason = (reason) => reason?.endsWith("bot");
const isRegionReason = (playability) => playability?.error_screen?.subreason?.text?.endsWith("in your country");
const isUnsupportedDeviceReason = (reason) => unsupportedDevicePatterns.some(pattern => pattern.test(reason || ""));

const getAttemptKey = (attempt) =>
    attempt ? `${attempt.transportMode}:${attempt.sessionMode}:${attempt.client}` : null;

export const parseHostedClientList = (value) => {
    if (typeof value !== "string") {
        return undefined;
    }

    const parsed = dedupeClients(value.split(","));
    return parsed.length ? parsed : undefined;
};

export const validateHostedClientList = (clients, envName) => {
    if (!clients?.length) {
        return clients;
    }

    const invalidClients = clients.filter(client => !Constants.SUPPORTED_CLIENTS.includes(client));
    if (invalidClients.length) {
        throw new Error(`${envName} contains unsupported YouTube clients: ${invalidClients.join(", ")}`);
    }

    return clients;
};

export const getDefaultHostedClientPools = ({
    customInnertubeClient,
    ytSessionInnertubeClient,
    ytHostedVideoClients,
    ytHostedAudioClients,
    ytHostedSessionClients,
}) => ({
    video: ytHostedVideoClients?.length
        ? dedupeClients(ytHostedVideoClients)
        : prependPreferredClient(defaultHostedVideoClients, customInnertubeClient),
    audio: ytHostedAudioClients?.length
        ? dedupeClients(ytHostedAudioClients)
        : prependPreferredClient(defaultHostedAudioClients, customInnertubeClient),
    session: ytHostedSessionClients?.length
        ? dedupeClients(ytHostedSessionClients)
        : prependPreferredClient(defaultHostedSessionClients, ytSessionInnertubeClient),
});

export const getPreferredHostedClient = ({ isAudioOnly, pools, explicitClient }) => {
    if (explicitClient) {
        return explicitClient;
    }

    const publicClients = isAudioOnly ? pools.audio : pools.video;
    return publicClients[0] || "IOS";
};

export const getPreferredSessionClient = ({ pools, explicitClient }) => {
    if (explicitClient) {
        return explicitClient;
    }

    return pools.session[0] || "WEB";
};

export const getHostedAttemptQueue = ({ isAudioOnly, pools, proxyURL }) => {
    const publicClients = isAudioOnly ? pools.audio : pools.video;
    const directQueue = [];
    const maxLength = Math.max(publicClients.length, pools.session.length);

    for (let index = 0; index < maxLength; index += 1) {
        if (publicClients[index]) {
            directQueue.push({
                client: publicClients[index],
                transportMode: "direct",
                sessionMode: "public",
            });
        }

        if (pools.session[index]) {
            directQueue.push({
                client: pools.session[index],
                transportMode: "direct",
                sessionMode: "session",
            });
        }
    }

    if (!proxyURL) {
        return directQueue;
    }

    return directQueue.concat(
        directQueue.map((attempt) => ({
            ...attempt,
            transportMode: "proxy",
        }))
    );
};

export const formatHostedAttempt = (attempt) =>
    `${attempt.transportMode}/${attempt.sessionMode}/${attempt.client}`;

export const getNextHostedAttempt = ({ queue, currentAttempt, shouldRetry = true }) => {
    if (!shouldRetry) {
        return null;
    }

    if (!queue?.length) {
        return null;
    }

    const currentKey = getAttemptKey(currentAttempt);
    const currentIndex = queue.findIndex(attempt => getAttemptKey(attempt) === currentKey);

    if (currentIndex === -1) {
        return queue[0] || null;
    }

    return queue[currentIndex + 1] || null;
};

export const getPlayabilityContext = (playability, attemptTrail = [], attempt) => ({
    youtubeStatus: playability?.status || "unknown",
    youtubeReason: getFailureReason(playability),
    youtubeClient: attempt?.client || null,
    youtubeRetryTrail: attemptTrail.map(entry => entry.client),
    youtubeAttemptTrail: attemptTrail.map(formatHostedAttempt),
    youtubeTransportMode: attempt?.transportMode || null,
    youtubeSessionMode: attempt?.sessionMode || null,
    youtubeProxyUsed: attempt?.transportMode === "proxy",
});

export const classifyYouTubeFailure = ({ playability, fetchError, attemptTrail = [], attempt }) => {
    const context = getPlayabilityContext(playability, attemptTrail, attempt);

    if (fetchError) {
        if (fetchError?.info) {
            let errorInfo;
            try {
                errorInfo = JSON.parse(fetchError.info);
            } catch {}

            if (errorInfo?.reason === "This video is private") {
                return { error: "content.video.private", retryable: false, context };
            }

            if (["INVALID_ARGUMENT", "UNAUTHENTICATED"].includes(errorInfo?.error?.status)) {
                return { error: "youtube.api_error", retryable: false, context };
            }
        }

        if (fetchError?.message === "This video is unavailable") {
            return { error: "content.video.unavailable", retryable: false, context };
        }

        return {
            error: "fetch.fail",
            retryable: true,
            retryReason: "fetch.fail",
            context: {
                ...context,
                youtubeReason: fetchError?.message || context.youtubeReason,
            },
        };
    }

    if (!playability) {
        return {
            error: "fetch.fail",
            retryable: true,
            retryReason: "fetch.fail",
            context,
        };
    }

    const reason = getFailureReason(playability);

    switch (playability.status) {
        case "OK":
            return { error: null, retryable: false, context };

        case "AGE_VERIFICATION_REQUIRED":
            return { error: "content.video.age", retryable: false, context };

        case "LOGIN_REQUIRED":
            if (isBotReason(reason)) {
                return {
                    error: "youtube.login",
                    retryable: true,
                    retryReason: "youtube.login",
                    refreshPlayerOnExhaustion: true,
                    context,
                };
            }

            if (isAgeReason(reason)) {
                return { error: "content.video.age", retryable: false, context };
            }

            if (isPrivateReason(playability)) {
                return { error: "content.video.private", retryable: false, context };
            }
            break;

        case "UNPLAYABLE":
            if (reason?.endsWith("request limit.")) {
                return { error: "fetch.rate", retryable: false, context };
            }

            if (isBotReason(reason)) {
                return {
                    error: "youtube.login",
                    retryable: true,
                    retryReason: "youtube.login",
                    refreshPlayerOnExhaustion: true,
                    context,
                };
            }

            if (isRegionReason(playability)) {
                return { error: "content.video.region", retryable: false, context };
            }

            if (isPrivateReason(playability)) {
                return { error: "content.video.private", retryable: false, context };
            }

            if (isUnsupportedDeviceReason(reason)) {
                return {
                    error: "content.video.unavailable",
                    retryable: true,
                    retryReason: "youtube.client",
                    context,
                };
            }
            break;

        case "ERROR":
            if (isUnsupportedDeviceReason(reason)) {
                return {
                    error: "content.video.unavailable",
                    retryable: true,
                    retryReason: "youtube.client",
                    context,
                };
            }
            break;
    }

    return { error: "content.video.unavailable", retryable: false, context };
};
