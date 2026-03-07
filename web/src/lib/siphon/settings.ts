import { browser } from "$app/environment";
import { writable, get } from "svelte/store";

import type { SiphonSettings } from "./types";

const STORAGE_KEY = "siphon-settings";

const defaults: SiphonSettings = {
    instanceUrl: "",
    apiKey: "",
    saveMetadata: true,
};

const readLegacySettings = (): Partial<SiphonSettings> => {
    if (!browser) {
        return {};
    }

    const raw = localStorage.getItem("settings");
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        return {
            instanceUrl: parsed?.connection?.instanceUrl || "",
            apiKey: parsed?.connection?.apiKey || "",
        };
    } catch {
        return {};
    }
};

const loadSettings = (): SiphonSettings => {
    if (!browser) {
        return defaults;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            return { ...defaults, ...JSON.parse(raw) };
        } catch {
            return defaults;
        }
    }

    const migrated = { ...defaults, ...readLegacySettings() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
};

const store = writable<SiphonSettings>(loadSettings());

if (browser) {
    store.subscribe((value) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    });
}

export const siphonSettings = store;

export const updateSiphonSettings = (partial: Partial<SiphonSettings>) => {
    store.update((current) => ({ ...current, ...partial }));
};

export const getSiphonSettingsSnapshot = () => get(store);

export const maskApiKey = (apiKey: string) => {
    if (apiKey.length <= 12) {
        return apiKey;
    }

    return `${apiKey.slice(0, 8)}----${apiKey.slice(-4)}`;
};
