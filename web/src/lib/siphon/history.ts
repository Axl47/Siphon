import { browser } from "$app/environment";

import type {
    DownloadRecord,
    SiphonHistoryStats,
    SiphonMemoryExport,
} from "./types";

const DB_NAME = "siphon-history";
const DB_VERSION = 1;
const STORE_NAME = "downloads";

const openDatabase = async (): Promise<IDBDatabase> => {
    if (!browser) {
        throw new Error("IndexedDB is unavailable during SSR");
    }

    return await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("timestamp", "timestamp", { unique: false });
            store.createIndex("platform", "platform", { unique: false });
            store.createIndex("uploader", "uploader", { unique: false });
            store.createIndex("title", "title", { unique: false });
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => void,
    collect: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
    const database = await openDatabase();

    return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);

        run(store);

        collect(store)
            .then(resolve)
            .catch(reject);

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => database.close();
    });
};

const getAllRecords = async (): Promise<DownloadRecord[]> =>
    await withStore("readonly", () => {}, async (store) => {
        return await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve((request.result as DownloadRecord[]).sort((a, b) => b.timestamp - a.timestamp));
            request.onerror = () => reject(request.error);
        });
    });

export const saveDownloadRecord = async (record: DownloadRecord) => {
    await withStore("readwrite", (store) => {
        store.put(record);
    }, async () => undefined);
};

export const listAllDownloads = async () => {
    return await getAllRecords();
};

export const listRecentDownloads = async (limit = 5) => {
    const records = await getAllRecords();
    return records.slice(0, limit);
};

export const searchDownloadHistory = async (query = "") => {
    const records = await getAllRecords();
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
        return records;
    }

    return records.filter((record) => {
        const haystack = [
            record.title,
            record.uploader,
            record.platform,
            new Date(record.timestamp).toLocaleDateString(),
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return haystack.includes(normalized);
    });
};

export const getHistoryStats = async (): Promise<SiphonHistoryStats> => {
    const records = await getAllRecords();
    const platformMap = new Map<string, { count: number; totalSize: number }>();
    const uploaderSet = new Set<string>();

    for (const record of records) {
        const platform = record.platform || "unknown";
        const current = platformMap.get(platform) || { count: 0, totalSize: 0 };
        current.count += 1;
        current.totalSize += record.fileSize;
        platformMap.set(platform, current);

        if (record.uploader) {
            uploaderSet.add(record.uploader);
        }
    }

    return {
        count: records.length,
        totalSize: records.reduce((sum, record) => sum + record.fileSize, 0),
        uniqueUploaders: uploaderSet.size,
        platforms: [...platformMap.entries()]
            .map(([platform, stats]) => ({
                platform,
                count: stats.count,
                totalSize: stats.totalSize,
            }))
            .sort((left, right) => right.count - left.count),
    };
};

export const buildMemoryExport = async (): Promise<SiphonMemoryExport> => {
    const downloads = await getAllRecords();
    const stats = await getHistoryStats();

    return {
        siphon: {
            version: 1,
            exportedAt: new Date().toISOString(),
        },
        stats,
        downloads,
    };
};

const getMemoryExportFilename = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    return `siphon-memory-${stamp}.json`;
};

export const exportMemoryArchive = async () => {
    if (!browser) {
        throw new Error("memory export is only available in the browser");
    }

    const payload = await buildMemoryExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = getMemoryExportFilename();
        anchor.click();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
};
