/// <reference types="@sveltejs/kit" />

import { build, files, version } from "$service-worker";

const CACHE = `siphon-shell-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        );
    })());
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(event.request);
        if (cached) {
            return cached;
        }

        try {
            const response = await fetch(event.request);
            const cache = await caches.open(CACHE);
            cache.put(event.request, response.clone());
            return response;
        } catch {
            const fallback = await caches.match("/");
            if (fallback) {
                return fallback;
            }

            throw new Error("offline");
        }
    })());
});
