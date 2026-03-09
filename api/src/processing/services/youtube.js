import HLS from "hls-parser";

import { Innertube, Session, UniversalCache, Platform } from "youtubei.js";
import { ProxyAgent } from "undici";
import vm from 'node:vm';

import { env, genericUserAgent } from "../../config.js";
import { getCookie } from "../cookie/manager.js";
import { createStream } from "../../stream/manage.js";
import { ensureYouTubeSession, getYouTubeSession } from "../helpers/youtube-session.js";
import {
    classifyYouTubeFailure,
    formatHostedAttempt,
    getDefaultHostedClientPools,
    getHostedAttemptQueue,
    getNextHostedAttempt,
    getPlayabilityContext,
    getPreferredHostedClient,
    getPreferredSessionClient,
} from "./youtube-policy.js";

const PLAYER_REFRESH_PERIOD = 1000 * 60 * 15; // ms
const MINTER_REFRESH_PERIOD = 1000 * 60 * 60 * 6;

let innertube, lastRefreshedAt, innertubeCacheKey;
let poMinter, poMinterLastRefresh = 0;

const codecList = {
    h264: {
        videoCodec: "avc1",
        audioCodec: "mp4a",
        container: "mp4"
    },
    av1: {
        videoCodec: "av01",
        audioCodec: "opus",
        container: "webm"
    },
    vp9: {
        videoCodec: "vp9",
        audioCodec: "opus",
        container: "webm"
    }
}

const hlsCodecList = {
    h264: {
        videoCodec: "avc1",
        audioCodec: "mp4a",
        container: "mp4"
    },
    vp9: {
        videoCodec: "vp09",
        audioCodec: "mp4a",
        container: "webm"
    }
}

const clientsWithNoCipher = ['IOS', 'ANDROID', 'YTSTUDIO_ANDROID', 'YTMUSIC_ANDROID'];
const videoQualities = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const youtubeRangeProbeHeaders = {
    'user-agent': genericUserAgent,
    accept: '*/*',
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com',
    DNT: '?1'
};
const youtubeRangeProbeWindow = {
    video: 2621439,
    audio: 1572863,
};

let unavailableResponses = 0;

const getInnertubeCacheKey = ({ useSession, sessionTokens, skipYouTubeCookie, hasCookie }) => JSON.stringify({
    mode: useSession ? "session" : "public",
    visitorData: useSession ? sessionTokens?.visitor_data || null : null,
    poToken: useSession ? sessionTokens?.potoken || null : null,
    skipYouTubeCookie,
    hasCookie,
});

const getHostedClientPools = () => getDefaultHostedClientPools({
    customInnertubeClient: env.customInnertubeClient,
    ytSessionInnertubeClient: env.ytSessionInnertubeClient,
    ytHostedVideoClients: env.ytHostedVideoClients,
    ytHostedAudioClients: env.ytHostedAudioClients,
    ytHostedSessionClients: env.ytHostedSessionClients,
});

const getAttemptTrailWithCurrent = (o, currentAttempt) => [
    ...(Array.isArray(o.youtubeAttemptTrail) ? o.youtubeAttemptTrail : []),
    currentAttempt,
].filter(Boolean);

const getAttemptDispatcher = (o, attempt) => {
    if (attempt?.transportMode !== "proxy" || !env.ytProxyURL) {
        return o.dispatcher;
    }

    return new ProxyAgent(env.ytProxyURL);
};

const retryWithNextHostedAttempt = async ({ o, currentAttempt, attemptTrail, reason }) => {
    const pools = getHostedClientPools();
    const queue = getHostedAttemptQueue({
        isAudioOnly: !!o.isAudioOnly,
        pools,
        proxyURL: env.ytProxyURL,
    });
    const nextAttempt = getNextHostedAttempt({
        queue,
        currentAttempt,
    });

    if (!nextAttempt) {
        return null;
    }

    console.warn(
        new Date(),
        `Retrying YouTube request with ${formatHostedAttempt(nextAttempt)} after ${reason} (previous attempt: ${formatHostedAttempt(currentAttempt)}).`
    );

    return youtubeService({
        ...o,
        youtubeAttempt: nextAttempt,
        youtubeAttemptTrail: attemptTrail,
    });
};

// https://ytjs.dev/guide/getting-started.html#providing-a-custom-javascript-interpreter
const youtubeEval = async (data, env) => {
    const properties = [];

    if (env.n) {
        properties.push(`n: exportedVars.nFunction("${env.n}")`)
    }

    if (env.sig) {
        properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
    }

    const code = `${data.output}\nconst result = { ${properties.join(', ')} }; result`;

    // I'm aware that node's vms are very easy to escape and I
    // probably shouldn't use it here to run arbitrary code
    // fetched from Google - but I kinda trust them
    // also no idea if im using this correctly
    return vm.runInNewContext(code);
}


let encryptedHostFlags = "";
const fetchEncryptedHostFlags = async (fetch) => {
    const embedResp = await fetch("https://youtube.com/embed/QfKmnuHMpYo", {
        headers: {
            "Referer": "https://www.google.com"
        }
    })
    .then(r => r.text());
    
    const hostFlagsMatch = /encryptedHostFlags":"(.+?)"/.exec(embedResp);
    if (hostFlagsMatch?.length > 1) {
        encryptedHostFlags = hostFlagsMatch[1];
    } else {
        console.error(new Date(), "Could not fetch encryptedHostFlags, no match!");
    }
}

/**
 * @type {typeof import("../helpers/youtube-po.js")}
 */
let poModule;

const cloneInnertube = async (customFetch, useSession, skipYouTubeCookie = false) => {
    Platform.shim.eval = youtubeEval;

    const shouldGenerateLocalPoToken = env.ytGeneratePoTokens && !useSession;
    if (shouldGenerateLocalPoToken) {
        if (!poModule) {
            // Importing this helper also needs BGUtils and JSDOM,
            // I'm importing them dynamically here so a) startup
            // doesn't get delayed and b) so I can mark these
            // dependencies as optional
            poModule = await import("../helpers/youtube-po.js");
        }

        if (!poMinter || +new Date() > poMinterLastRefresh + MINTER_REFRESH_PERIOD) {
            poMinter?.then(minter => minter.remove()).catch(() => {});
            poMinter = poModule.getMinter({ fetch: customFetch });
            poMinterLastRefresh = +new Date();
        }
    }

    const rawCookie = skipYouTubeCookie ? undefined : getCookie('youtube');
    const cookie = rawCookie?.toString();

    let sessionTokens = getYouTubeSession();
    const retrieve_player = true;

    if (useSession && env.ytSessionServer && !sessionTokens?.potoken) {
        try {
            sessionTokens = await ensureYouTubeSession();
        } catch {}
    }

    if (useSession && env.ytSessionServer && !sessionTokens?.potoken) {
        throw "no_session_tokens";
    }

    const requestedCacheKey = getInnertubeCacheKey({
        useSession,
        sessionTokens,
        skipYouTubeCookie,
        hasCookie: !!cookie,
    });
    const shouldRefreshPlayer =
        !innertube
        || globalThis.FORCE_RESET_INNERTUBE_PLAYER
        || lastRefreshedAt + PLAYER_REFRESH_PERIOD < new Date()
        || innertubeCacheKey !== requestedCacheKey;

    if (!innertube || shouldRefreshPlayer) {
        globalThis.FORCE_RESET_INNERTUBE_PLAYER = false;
        innertube = await Innertube.create({
            cache: new UniversalCache(false),
            fetch: customFetch,
            retrieve_player,
            cookie,
            po_token: useSession ? sessionTokens?.potoken : undefined,
            visitor_data: useSession ? sessionTokens?.visitor_data : undefined,
            enable_session_cache: false,
            player_id: env.ytPlayerId,
        });

        if (useSession && sessionTokens?.visitor_data) {
            innertube.session.context.client.visitorData = sessionTokens.visitor_data;
        }

        if (shouldGenerateLocalPoToken) {
            const { minter } = await poMinter;
            innertube.session.po_token = await minter.mintAsWebsafeString(innertube.session.context.client.visitorData);
        } else if (useSession && sessionTokens?.potoken) {
            innertube.session.po_token = sessionTokens.potoken;
        }

        lastRefreshedAt = +new Date();
        innertubeCacheKey = requestedCacheKey;
        
        if (!useSession && env.customInnertubeClient === "WEB_EMBEDDED") {
            // WEB_EMBEDDED sometimes needs a property named `encryptedHostFlags`, which you
            // can seemingly only get by extracting it out of a player response
            await fetchEncryptedHostFlags(customFetch);
        }
    }

    const session = new Session(
        innertube.session.context,
        innertube.session.api_key,
        innertube.session.api_version,
        innertube.session.account_index,
        innertube.session.config_data,
        innertube.session.player,
        cookie,
        customFetch ?? innertube.session.http.fetch,
        innertube.session.cache,
        innertube.session.po_token ?? sessionTokens?.potoken
    );

    const yt = new Innertube(session);
    return yt;
}

const getHlsVariants = async (hlsManifest, dispatcher) => {
    if (!hlsManifest) {
        return { error: "youtube.no_hls_streams" };
    }

    const fetchedHlsManifest =
        await fetch(hlsManifest, { dispatcher })
            .then(r => r.status === 200 ? r.text() : undefined)
            .catch(() => {});

    if (!fetchedHlsManifest) {
        return { error: "youtube.no_hls_streams" };
    }

    const variants = HLS.parse(fetchedHlsManifest).variants.sort(
        (a, b) => Number(b.bandwidth) - Number(a.bandwidth)
    );

    if (!variants || variants.length === 0) {
        return { error: "youtube.no_hls_streams" };
    }

    return variants;
}

const getSubtitles = async (info, dispatcher, subtitleLang) => {
    const preferredCap = info.captions.caption_tracks.find(caption =>
        caption.kind !== 'asr' && caption.language_code.startsWith(subtitleLang)
    );

    const captionsUrl = preferredCap?.base_url;
    if (!captionsUrl) return;

    if (!captionsUrl.includes("exp=xpe")) {
        let url = new URL(captionsUrl);
        url.searchParams.set('fmt', 'vtt');

        return {
            url: url.toString(),
            language: preferredCap.language_code,
        }
    }

    // if we have exp=xpe in the url, then captions are
    // locked down and can't be accessed without a yummy potoken,
    // so instead we just use subtitles from HLS

    const hlsVariants = await getHlsVariants(
        info.streaming_data.hls_manifest_url,
        dispatcher
    );
    if (hlsVariants?.error) return;

    // all variants usually have the same set of subtitles
    const hlsSubtitles = hlsVariants[0]?.subtitles;
    if (!hlsSubtitles?.length) return;

    const preferredHls = hlsSubtitles.find(
        subtitle => subtitle.language.startsWith(subtitleLang)
    );

    if (!preferredHls) return;

    const fetchedHlsSubs =
        await fetch(preferredHls.uri, { dispatcher })
            .then(r => r.status === 200 ? r.text() : undefined)
            .catch(() => {});

    const parsedSubs = HLS.parse(fetchedHlsSubs);
    if (!parsedSubs) return;

    return {
        url: parsedSubs.segments[0]?.uri,
        language: preferredHls.language,
    }
}

const supportsLargeRangeProbe = async (url, maxByte, dispatcher) => {
    if (!url || maxByte < 0) {
        return true;
    }

    try {
        const response = await fetch(url, {
            headers: {
                ...youtubeRangeProbeHeaders,
                Range: `bytes=0-${maxByte}`
            },
            dispatcher,
            signal: AbortSignal.timeout(5000),
        });

        try {
            await response.body?.cancel?.();
        } catch {}

        return response.status === 200 || response.status === 206;
    } catch {
        return false;
    }
}

const shouldFallbackToHLS = async ({ videoUrl, videoLength, audioUrl, audioLength, dispatcher }) => {
    if (audioUrl && audioLength > youtubeRangeProbeWindow.audio) {
        const audioRangeOk = await supportsLargeRangeProbe(
            audioUrl,
            youtubeRangeProbeWindow.audio,
            dispatcher
        );

        if (!audioRangeOk) {
            return true;
        }
    }

    if (videoUrl && videoLength > youtubeRangeProbeWindow.video) {
        const videoRangeOk = await supportsLargeRangeProbe(
            videoUrl,
            youtubeRangeProbeWindow.video,
            dispatcher
        );

        if (!videoRangeOk) {
            return true;
        }
    }

    return false;
}

/**
 * @param {Innertube} yt 
 * @param {*} o 
 */
const fetchPost = async (yt, o) => {
    const fixImageResolution = (imageUrl) => {
        let url = imageUrl;
        const imageModSeparator = url.indexOf("=");
        if (imageModSeparator) {
            // w0 = highest res, ip = do not strip metadata, rp = force png output
            url = url.substring(0, imageModSeparator) + "=w0-ip-rp";
        }

        return url;
    };

    // channel id does just.. not seem to matter at all
    const postFeed = await yt.getPost(o.postId, "a");
    if (!postFeed.posts.length) return { error: "fetch.empty" };

    const [ post ] = postFeed.posts;
    switch (post.attachment?.type) {
        case "PostMultiImage":
            const picker = post.attachment.images.map((image, i) => {
                const proxiedImage = createStream({
                    service: "youtube",
                    type: "proxy",
                    url: fixImageResolution(image.image[0].url),
                    filename: `youtube_${o.postId}_${i + 1}.png`
                });

                return {
                    type: "photo",
                    url: proxiedImage
                };
            });

            return { picker };
        case "BackstageImage":
            return {
                urls: fixImageResolution(post.attachment.image[0].url),
                isPhoto: true,
                filename: `youtube_${o.postId}.png`
            };
        default:
            return { error: "fetch.empty" };
    }
}

export default async function youtubeService(o) {
    const quality = o.quality === "max" ? 9000 : Number(o.quality);
    const hostedClientPools = getHostedClientPools();
    const transportFetch = (input, init) => fetch(input, {
        ...init,
        dispatcher: getAttemptDispatcher(o, currentAttempt)
    });

    let useHLS = o.youtubeHLS;
    const defaultInnertubeClient = getPreferredHostedClient({
        isAudioOnly: !!o.isAudioOnly,
        pools: hostedClientPools,
        explicitClient: o.innertubeClient,
    });
    let innertubeClient = defaultInnertubeClient;
    let useSession = false;

    // HLS playlists from the iOS client don't contain the av1 video format.
    if (useHLS && o.codec === "av1") {
        useHLS = false;
    }

    if (useHLS) {
        innertubeClient = "IOS";
    } else if (o.youtubeAttempt) {
        useSession = o.youtubeAttempt.sessionMode === "session";
        innertubeClient = o.youtubeAttempt.client;
    } else {
        // iOS client doesn't have adaptive formats of resolution >1080p,
        // so we keep the older session bootstrap for those cases.
        useSession =
            env.ytSessionServer && (
                (
                    innertubeClient === "IOS"
                    && (
                        (quality > 1080 && o.codec !== "h264")
                        || (quality > 1080 && o.codec !== "vp9")
                    )
                )
            );

        if (o.forceSessionAttempt && env.ytSessionServer) {
            useSession = true;
        }

        // we can get subtitles reliably only from the iOS client
        // if (o.subtitleLang) {
        //     innertubeClient = "IOS";
        //     useSession = false;
        // }

        if (useSession) {
            innertubeClient = getPreferredSessionClient({
                pools: hostedClientPools,
                explicitClient: o.sessionInnertubeClient,
            });
        }
    }

    let currentAttempt = o.youtubeAttempt || {
        client: innertubeClient,
        transportMode: "direct",
        sessionMode: useSession ? "session" : "public",
    };
    let attemptDispatcher = getAttemptDispatcher(o, currentAttempt);
    let attemptTrail = getAttemptTrailWithCurrent(o, currentAttempt);

    let yt;
    const createInnertube = (useCurrentSession) =>
        cloneInnertube(
            transportFetch,
            useCurrentSession,
            o.skipYouTubeCookie === true
        );

    try {
        yt = await createInnertube(useSession);
    } catch (e) {
        if (e === "no_session_tokens" && useSession) {
            const nextAttempt = await retryWithNextHostedAttempt({
                o,
                currentAttempt,
                attemptTrail,
                reason: "youtube.no_session_tokens",
            });

            if (nextAttempt) {
                return nextAttempt;
            }

            if (!o.youtubeAttempt) {
                // Hosted session tokens are only required for some higher-end YouTube paths.
                // If the session server is unavailable, fall back to the non-session client so
                // lower-quality requests and metadata lookups can still proceed.
                useSession = false;
                innertubeClient = useHLS ? "IOS" : defaultInnertubeClient;
                currentAttempt = {
                    client: innertubeClient,
                    transportMode: "direct",
                    sessionMode: "public",
                };
                attemptDispatcher = getAttemptDispatcher(o, currentAttempt);
                attemptTrail = getAttemptTrailWithCurrent({
                    ...o,
                    youtubeAttemptTrail: Array.isArray(o.youtubeAttemptTrail) ? o.youtubeAttemptTrail : [],
                }, currentAttempt);
                yt = await createInnertube(false);
            } else {
                return {
                    error: "youtube.no_session_tokens",
                    context: {
                        ...getPlayabilityContext(undefined, attemptTrail, currentAttempt),
                        youtubeReason: "No session tokens were available for the selected hosted attempt.",
                    },
                };
            }
        } else if (e === "no_session_tokens") {
            return { error: "youtube.no_session_tokens" };
        } else if (e.message?.endsWith("decipher algorithm")) {
            return { error: "youtube.decipher" }
        } else if (e.message?.includes("refresh access token")) {
            return { error: "youtube.token_expired" }
        } else throw e;
    }

    if (!o.id && o.postId) {
        return await fetchPost(yt, o);
    }

    let info;
    try {
        const args = {
            videoId: o.id,
            client: innertubeClient,
            parse: true,
            playbackContext: {
                contentPlaybackContext: {
                    vis: 0,
                    splay: false,
                    lactMilliseconds: '-1',
                    signatureTimestamp: yt.session.player?.signature_timestamp,
                }
            }
        };

        if (innertubeClient === "WEB_EMBEDDED" && !encryptedHostFlags) {
            await fetchEncryptedHostFlags(transportFetch);
        }

        if (innertubeClient === "WEB_EMBEDDED" && encryptedHostFlags) {
            args.playbackContext.contentPlaybackContext.encryptedHostFlags = encryptedHostFlags;
        }

        if (yt.session.po_token) {
            args.serviceIntegrityDimensions = {
                poToken: yt.session.po_token
            };
        }

        info = await yt.actions.execute("/player", args);
    } catch (e) {
        if (!o.skipYouTubeCookie && env.cookiePath) {
            console.warn(new Date(), `Retrying YouTube /player without cookies for ${o.id || o.postId || "unknown target"}.`);
            const cookielessAttempt = await youtubeService({
                ...o,
                skipYouTubeCookie: true,
            });

            if (!cookielessAttempt?.error || cookielessAttempt.error !== "fetch.fail") {
                return cookielessAttempt;
            }
        }

        const fetchFailure = classifyYouTubeFailure({
            fetchError: e,
            attemptTrail,
            attempt: currentAttempt,
        });
        const retryAttempt = await retryWithNextHostedAttempt({
            o,
            currentAttempt,
            attemptTrail,
            reason: fetchFailure.retryReason || fetchFailure.error,
        });
        if (retryAttempt) {
            return retryAttempt;
        }

        return {
            error: fetchFailure.error,
            context: fetchFailure.context,
        };
    }

    if (!info) {
        const emptyInfoFailure = classifyYouTubeFailure({
            fetchError: new Error("No /player response body was returned."),
            attemptTrail,
            attempt: currentAttempt,
        });
        const retryAttempt = await retryWithNextHostedAttempt({
            o,
            currentAttempt,
            attemptTrail,
            reason: emptyInfoFailure.retryReason || emptyInfoFailure.error,
        });

        if (retryAttempt) {
            return retryAttempt;
        }

        return {
            error: emptyInfoFailure.error,
            context: emptyInfoFailure.context,
        };
    }

    const playability = info.playability_status;
    const basicInfo = info.video_details;
    const playabilityFailure = classifyYouTubeFailure({
        playability,
        attemptTrail,
        attempt: currentAttempt,
    });

    if (playabilityFailure.error) {
        const retryAttempt = await retryWithNextHostedAttempt({
            o,
            currentAttempt,
            attemptTrail,
            reason: playabilityFailure.retryReason || playabilityFailure.error,
        });

        if (retryAttempt) {
            return retryAttempt;
        }

        const context = playabilityFailure.context;
        console.warn(new Date(), `YouTube playability failure for ${o.id || o.postId || "unknown target"}: ${JSON.stringify(context)}`);

        if (playabilityFailure.refreshPlayerOnExhaustion) {
            lastRefreshedAt = +new Date(0);
        } else if (playability.status !== "OK") {
            // Force refresh player once we get 10 unavailable videos
            unavailableResponses ??= 0;
            if (unavailableResponses++ > 10) {
                lastRefreshedAt = +new Date(0);
                unavailableResponses = 0;
            }
        }

        if (playabilityFailure.error === "youtube.login") {
            return {
                error: playabilityFailure.error,
                retry: true,
                context,
            };
        }

        return {
            error: playabilityFailure.error,
            context,
        };
    }

    if (basicInfo.is_live) {
        return { error: "content.video.live" };
    }

    if (basicInfo.duration > env.durationLimit) {
        return { error: "content.too_long" };
    }

    // return a critical error if returned video is "Video Not Available"
    // or a similar stub by youtube
    if (basicInfo.id !== o.id) {
        return {
            error: "fetch.fail",
            critical: true
        }
    }

    const normalizeQuality = res => {
        const shortestSide = Math.min(res.height, res.width);
        return videoQualities.find(qual => qual >= shortestSide);
    }

    let video, audio, subtitles, dubbedLanguage,
        codec = o.codec || "h264", itag = o.itag;

    if (useHLS) {
        const variants = await getHlsVariants(
            info.streaming_data.hls_manifest_url,
            attemptDispatcher
        );

        if (variants?.error) return variants;

        const matchHlsCodec = codecs => (
            codecs.includes(hlsCodecList[codec].videoCodec)
        );

        const best = variants.find(i => matchHlsCodec(i.codecs));

        const preferred = variants.find(i =>
            matchHlsCodec(i.codecs) && normalizeQuality(i.resolution) === quality
        );

        let selected = preferred || best;

        if (!selected) {
            codec = "h264";
            selected = variants.find(i => matchHlsCodec(i.codecs));
        }

        if (!selected) {
            return { error: "youtube.no_matching_format" };
        }

        audio = selected.audio.find(i => i.isDefault);

        // some videos (mainly those with AI dubs) don't have any tracks marked as default
        // why? god knows, but we assume that a default track is marked as such in the title
        if (!audio) {
            audio = selected.audio.find(i => i.name.endsWith("original"));
        }

        if (o.dubLang) {
            const dubbedAudio = selected.audio.find(i =>
                i.language?.startsWith(o.dubLang)
            );

            if (dubbedAudio && !dubbedAudio.isDefault) {
                dubbedLanguage = dubbedAudio.language;
                audio = dubbedAudio;
            }
        }

        selected.audio = [];
        selected.subtitles = [];
        video = selected;
    } else {
        // i miss typescript so bad
        const sorted_formats = {
            h264: {
                video: [],
                audio: [],
                bestVideo: undefined,
                bestAudio: undefined,
            },
            vp9: {
                video: [],
                audio: [],
                bestVideo: undefined,
                bestAudio: undefined,
            },
            av1: {
                video: [],
                audio: [],
                bestVideo: undefined,
                bestAudio: undefined,
            },
        }

        const checkFormat = (format, pCodec) => format.content_length &&
            (format.mime_type.includes(codecList[pCodec].videoCodec)
                || format.mime_type.includes(codecList[pCodec].audioCodec));

        // sort formats & weed out bad ones
        info.streaming_data.adaptive_formats.sort((a, b) =>
            Number(b.bitrate) - Number(a.bitrate)
        ).forEach(format => {
            Object.keys(codecList).forEach(yCodec => {
                const matchingItag = slot => !itag?.[slot] || itag[slot] === format.itag;
                const sorted = sorted_formats[yCodec];
                const goodFormat = checkFormat(format, yCodec);
                if (!goodFormat) return;

                if (format.has_video && matchingItag('video')) {
                    sorted.video.push(format);
                    if (!sorted.bestVideo)
                        sorted.bestVideo = format;
                }

                if (format.has_audio && matchingItag('audio')) {
                    sorted.audio.push(format);
                    if (!sorted.bestAudio)
                        sorted.bestAudio = format;
                }
            })
        });

        const noBestMedia = () => {
            const vid = sorted_formats[codec]?.bestVideo;
            const aud = sorted_formats[codec]?.bestAudio;
            return (!vid && !o.isAudioOnly) || (!aud && o.isAudioOnly)
        };

        if (noBestMedia()) {
            if (codec === "av1") codec = "vp9";
            else if (codec === "vp9") codec = "av1";

            // if there's no higher quality fallback, then use h264
            if (noBestMedia()) codec = "h264";
        }

        // if there's no proper combo of av1, vp9, or h264, then give up
        if (noBestMedia()) {
            return { error: "youtube.no_matching_format" };
        }

        audio = sorted_formats[codec].bestAudio;

        if (audio?.audio_track && !audio?.is_original) {
            audio = sorted_formats[codec].audio.find(i =>
                i?.is_original
            );
        }

        if (o.dubLang) {
            const dubbedAudio = sorted_formats[codec].audio.find(i =>
                i.language?.startsWith(o.dubLang) && i.audio_track
            );

            if (dubbedAudio && !dubbedAudio?.is_original) {
                audio = dubbedAudio;
                dubbedLanguage = dubbedAudio.language;
            }
        }

        if (!o.isAudioOnly) {
            const qual = (i) => {
                return normalizeQuality({
                    width: i.width,
                    height: i.height,
                })
            }

            const bestQuality = qual(sorted_formats[codec].bestVideo);
            const useBestQuality = quality >= bestQuality;

            video = useBestQuality
                ? sorted_formats[codec].bestVideo
                : sorted_formats[codec].video.find(i => qual(i) === quality);

            if (!video) video = sorted_formats[codec].bestVideo;
        }

        if (o.subtitleLang && !o.isAudioOnly && info.captions?.caption_tracks?.length) {
            const videoSubtitles = await getSubtitles(info, attemptDispatcher, o.subtitleLang);
            if (videoSubtitles) {
                subtitles = videoSubtitles;
            }
        }
    }

    if (video?.drm_families || audio?.drm_families) {
        return { error: "youtube.drm" };
    }

    const fileMetadata = {
        title: basicInfo.title.trim(),
        artist: basicInfo.author.replace("- Topic", "").trim()
    }

    if (basicInfo?.short_description?.startsWith("Provided to YouTube by")) {
        const descItems = basicInfo.short_description.split("\n\n", 5);

        if (descItems.length === 5) {
            fileMetadata.album = descItems[2];
            fileMetadata.copyright = descItems[3];
            if (descItems[4].startsWith("Released on:")) {
                fileMetadata.date = descItems[4].replace("Released on: ", '').trim();
            }
        }
    }

    if (subtitles) {
        fileMetadata.sublanguage = subtitles.language;
    }

    const filenameAttributes = {
        service: "youtube",
        id: o.id,
        title: fileMetadata.title,
        author: fileMetadata.artist,
        youtubeDubName: dubbedLanguage || false,
    }

    itag = {
        video: video?.itag,
        audio: audio?.itag
    };

    const originalRequest = {
        ...o,
        dispatcher: undefined,
        itag,
        innertubeClient,
        youtubeAttempt: currentAttempt,
        youtubeAttemptTrail: Array.isArray(o.youtubeAttemptTrail) ? o.youtubeAttemptTrail : [],
    };

    if (audio && o.isAudioOnly) {
        let bestAudio = codec === "h264" ? "m4a" : "opus";
        let urls = audio.url;
        const directAudioLength = Number(audio.content_length);

        if (useHLS) {
            bestAudio = "mp3";
            urls = audio.uri;
        }

        if (!clientsWithNoCipher.includes(innertubeClient) && innertube) {
            urls = await audio.decipher(innertube.session.player);
        }

        let cover = `https://i.ytimg.com/vi/${o.id}/maxresdefault.jpg`;
        const testMaxCover = await fetch(cover, { dispatcher: attemptDispatcher })
            .then(r => r.status === 200)
            .catch(() => {});

        if (!testMaxCover) {
            cover = basicInfo.thumbnail?.[0]?.url;
        }

        if (!useHLS && !o.hlsFallbackAttempted) {
            const fallbackToHLS = await shouldFallbackToHLS({
                audioUrl: urls,
                audioLength: directAudioLength,
                dispatcher: attemptDispatcher,
            });

            if (fallbackToHLS) {
                const hlsFallback = await youtubeService({
                    ...o,
                    youtubeHLS: true,
                    hlsFallbackAttempted: true,
                });

                if (!hlsFallback?.error) {
                    console.warn(new Date(), `Falling back to YouTube HLS for ${o.id} (audio).`);
                    return hlsFallback;
                }
            }
        }

        return {
            type: "audio",
            isAudioOnly: true,
            urls,
            filenameAttributes,
            fileMetadata,
            bestAudio,
            isHLS: useHLS,
            originalRequest,
            proxyToUse: currentAttempt.transportMode === "proxy" ? env.ytProxyURL : undefined,
            requestIP: o.requestIP,

            cover,
            cropCover: basicInfo.author.endsWith("- Topic"),
        }
    }

    if (video && audio) {
        let resolution;
        const directVideoLength = Number(video.content_length);
        const directAudioLength = Number(audio.content_length);

        if (useHLS) {
            resolution = normalizeQuality(video.resolution);
            filenameAttributes.resolution = `${video.resolution.width}x${video.resolution.height}`;
            filenameAttributes.extension = o.container === "auto" ? hlsCodecList[codec].container : o.container;

            video = video.uri;
            audio = audio.uri;
        } else {
            resolution = normalizeQuality({
                width: video.width,
                height: video.height,
            });

            filenameAttributes.resolution = `${video.width}x${video.height}`;
            filenameAttributes.extension = o.container === "auto" ? codecList[codec].container : o.container;

            if (!clientsWithNoCipher.includes(innertubeClient) && innertube) {
                video = await video.decipher(innertube.session.player);
                audio = await audio.decipher(innertube.session.player);
            } else {
                video = video.url;
                audio = audio.url;
            }
        }

        filenameAttributes.qualityLabel = `${resolution}p`;
        filenameAttributes.youtubeFormat = codec;

        if (!useHLS && !o.hlsFallbackAttempted) {
            const fallbackToHLS = await shouldFallbackToHLS({
                videoUrl: video,
                videoLength: directVideoLength,
                audioUrl: audio,
                audioLength: directAudioLength,
                dispatcher: attemptDispatcher,
            });

            if (fallbackToHLS) {
                const hlsFallback = await youtubeService({
                    ...o,
                    youtubeHLS: true,
                    hlsFallbackAttempted: true,
                });

                if (!hlsFallback?.error) {
                    console.warn(new Date(), `Falling back to YouTube HLS for ${o.id}.`);
                    return hlsFallback;
                }
            }
        }

        return {
            type: "merge",
            urls: [
                video,
                audio,
            ],
            subtitles: subtitles?.url,
            filenameAttributes,
            fileMetadata,
            isHLS: useHLS,
            originalRequest,
            proxyToUse: currentAttempt.transportMode === "proxy" ? env.ytProxyURL : undefined,
            requestIP: o.requestIP,
        }
    }

    return { error: "youtube.no_matching_format" };
}
