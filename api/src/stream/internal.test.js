import test from "node:test";
import assert from "node:assert/strict";

import { buildInternalRequestHeaders, sanitizeInternalHeaders } from "./internal.js";

test("buildInternalRequestHeaders preserves request-specific headers for HEAD requests", () => {
    const headers = buildInternalRequestHeaders({
        service: "youtube",
        headers: new Map([
            ["x-goog-visitor-id", "visitor-token"],
            ["cookie", "SAPISID=example"],
        ]),
    });

    assert.equal(headers["x-goog-visitor-id"], "visitor-token");
    assert.equal(headers.cookie, "SAPISID=example");
    assert.equal(headers.accept, "*/*");
    assert.equal(headers.origin, "https://www.youtube.com");
    assert.equal(headers.host, undefined);
});

test("buildInternalRequestHeaders preserves request-specific headers for range requests", () => {
    const headers = buildInternalRequestHeaders({
        service: "youtube",
        headers: new Map([
            ["x-test-auth", "signed-request"],
        ]),
    }, {
        Range: "bytes=0-1024",
    });

    assert.equal(headers["x-test-auth"], "signed-request");
    assert.equal(headers.Range, "bytes=0-1024");
    assert.equal(headers.referer, "https://www.youtube.com");
    assert.equal(headers.host, undefined);
});

test("sanitizeInternalHeaders removes inherited tunnel-only headers before upstream requests", () => {
    const streamInfo = {
        headers: new Map([
            ["range", "bytes=0-42"],
            ["icy-metadata", "1"],
            ["x-goog-visitor-id", "visitor-token"],
        ]),
    };

    sanitizeInternalHeaders(streamInfo);

    assert.equal(streamInfo.headers.has("range"), false);
    assert.equal(streamInfo.headers.has("icy-metadata"), false);
    assert.equal(streamInfo.headers.get("x-goog-visitor-id"), "visitor-token");
});
