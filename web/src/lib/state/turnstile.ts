import cachedInfo from "$lib/state/server-info";
import { derived, writable } from "svelte/store";

export const turnstileSolved = writable(false);
export const turnstileCreated = writable(false);

export const turnstileEnabled = derived(
    cachedInfo,
    () => false,
);
