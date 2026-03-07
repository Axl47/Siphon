import { request } from "undici";
import { Readable } from "node:stream";
import { closeRequest, getHeaders, pipe } from "./shared.js";
import { handleHlsPlaylist, isHlsResponse, probeInternalHLSTunnel } from "./internal-hls.js";

const min = (a, b) => a < b ? a : b;

const serviceNeedsChunks = new Set(["youtube", "vk"]);
const defaultChunkSize = BigInt(8e6);
const serviceChunkSizes = {
    youtube: 1024n * 1024n,
};

const getStreamHost = (url) => {
    try {
        return new URL(url).hostname;
    } catch {
        return "unknown-host";
    }
}

const logChunkedFailure = (streamInfo, stage, detail) => {
    console.warn(
        new Date().toISOString(),
        `[internal-stream:${streamInfo.service}] ${stage} failed for ${getStreamHost(streamInfo.url)}`,
        detail
    );
}

export const buildInternalRequestHeaders = (streamInfo, extraHeaders = {}) => ({
    ...Object.fromEntries(streamInfo.headers || []),
    ...getHeaders(streamInfo.service),
    ...extraHeaders,
    host: undefined,
});

export const sanitizeInternalHeaders = (streamInfo) => {
    if (streamInfo.headers) {
        streamInfo.headers.delete('icy-metadata');
        streamInfo.headers.delete('range');
    }
}

const getChunkSize = (streamInfo) => serviceChunkSizes[streamInfo.service] || defaultChunkSize;

const getContentRangeSize = (headers) => {
    const contentRange = headers["content-range"];
    if (typeof contentRange !== "string") {
        return;
    }

    const match = /bytes \d+-\d+\/(\d+)/.exec(contentRange);
    if (!match?.[1]) {
        return;
    }

    return BigInt(match[1]);
}

const requestChunk = async (streamInfo, start, end) => request(streamInfo.url, {
    headers: buildInternalRequestHeaders(streamInfo, {
        Range: `bytes=${start}-${end}`
    }),
    dispatcher: streamInfo.dispatcher,
    signal: streamInfo.controller.signal,
    maxRedirections: 4
});

async function* readChunks(streamInfo, size, read = 0n) {
    let refreshAttempts = 0;
    const chunkSize = getChunkSize(streamInfo);
    while (read < size) {
        if (streamInfo.controller.signal.aborted) {
            throw new Error("controller aborted");
        }

        const chunkEnd = min(read + chunkSize - 1n, size - 1n);
        const chunk = await requestChunk(streamInfo, read, chunkEnd);

        if (chunk.statusCode === 403 && refreshAttempts < 3 && streamInfo.transplant) {
            refreshAttempts++;
            try {
                await streamInfo.transplant(streamInfo.dispatcher);
                continue;
            } catch {}
        }

        if (chunk.statusCode < 200 || chunk.statusCode > 299) {
            logChunkedFailure(streamInfo, "range-request", `status ${chunk.statusCode}`);
            closeRequest(streamInfo.controller);
            return;
        }

        if (!chunk.headers['content-length']) {
            logChunkedFailure(streamInfo, "range-request", "missing content-length");
            closeRequest(streamInfo.controller);
            return;
        }

        const expected = min(chunkSize, size - read);
        const received = BigInt(chunk.headers['content-length']);

        if (received < expected / 2n) {
            logChunkedFailure(
                streamInfo,
                "range-request",
                `short chunk ${received.toString()} of expected ${expected.toString()}`
            );
            closeRequest(streamInfo.controller);
            return;
        }

        for await (const data of chunk.body) {
            yield data;
        }

        refreshAttempts = 0;
        read += received;
    }
}

async function handleChunkedStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => (res.end(), closeRequest(streamInfo.controller));

    try {
        let req, attempts = 3;
        while (attempts--) {
            req = await requestChunk(streamInfo, 0n, 1n);

            if (req.statusCode === 403 && streamInfo.transplant) {
                try {
                    await streamInfo.transplant(streamInfo.dispatcher);
                } catch {
                    break;
                }
            } else break;
        }

        const firstChunkSize = req.headers['content-length']
            ? BigInt(req.headers['content-length'])
            : 0n;
        const size = getContentRangeSize(req.headers) || firstChunkSize;

        if ((req.statusCode < 200 || req.statusCode > 299) || !size || !firstChunkSize) {
            logChunkedFailure(
                streamInfo,
                "initial-range-request",
                `status ${req.statusCode}, content-length ${req.headers['content-length'] ?? 'missing'}, content-range ${req.headers['content-range'] ?? 'missing'}`
            );
            globalThis.FORCE_RESET_INNERTUBE_PLAYER = true;
            return cleanup();
        }

        const generator = async function* () {
            for await (const data of req.body) {
                yield data;
            }

            yield* readChunks(streamInfo, size, firstChunkSize);
        }();

        const abortGenerator = () => {
            generator.return();
            signal.removeEventListener('abort', abortGenerator);
        }

        signal.addEventListener('abort', abortGenerator);

        const stream = Readable.from(generator);

        if (req.headers['content-type']) {
            res.setHeader('content-type', req.headers['content-type']);
        }
        res.setHeader('content-length', size.toString());

        pipe(stream, res, cleanup);
    } catch {
        cleanup();
    }
}

async function handleGenericStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => res.end();

    try {
        const fileResponse = await request(streamInfo.url, {
            headers: buildInternalRequestHeaders(streamInfo),
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        res.status(fileResponse.statusCode);
        fileResponse.body.on('error', () => {});

        const isHls = isHlsResponse(fileResponse, streamInfo);

        for (const [ name, value ] of Object.entries(fileResponse.headers)) {
            if (!isHls || name.toLowerCase() !== 'content-length') {
                res.setHeader(name, value);
            }
        }

        if (fileResponse.statusCode < 200 || fileResponse.statusCode > 299) {
            return cleanup();
        }

        if (isHls) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            await handleHlsPlaylist(streamInfo, fileResponse, res);
        } else {
            pipe(fileResponse.body, res, cleanup);
        }
    } catch {
        closeRequest(streamInfo.controller);
        cleanup();
    }
}

export function internalStream(streamInfo, res) {
    sanitizeInternalHeaders(streamInfo);

    if (serviceNeedsChunks.has(streamInfo.service) && !streamInfo.isHLS) {
        return handleChunkedStream(streamInfo, res);
    }

    return handleGenericStream(streamInfo, res);
}

export async function probeInternalTunnel(streamInfo) {
    try {
        const signal = AbortSignal.timeout(3000);
        const headers = buildInternalRequestHeaders(streamInfo, { range: undefined });

        if (streamInfo.isHLS) {
            return probeInternalHLSTunnel({
                ...streamInfo,
                signal,
                headers
            });
        }

        const response = await request(streamInfo.url, {
            method: 'HEAD',
            headers,
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        if (response.statusCode !== 200)
            throw "status is not 200 OK";

        const size = +response.headers['content-length'];
        if (isNaN(size))
            throw "content-length is not a number";

        return size;
    } catch {}
}
