import { init } from "$lib/storage";

import type { DownloadProgress, DownloadResult } from "./types";
import { formatProgressPhase } from "./format";

const getFilenameFromDisposition = (header: string | null) => {
    const match = /filename="?([^"]+)"?/i.exec(header || "");
    return match?.[1];
};

export const downloadWithProgress = async (
    url: string,
    fallbackFilename: string,
    onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadResult> => {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
        throw new Error(`download failed with status ${response.status}`);
    }

    const totalHeader =
        response.headers.get("content-length")
        || response.headers.get("estimated-content-length");
    const totalBytes = totalHeader ? Number(totalHeader) : null;
    const filename =
        getFilenameFromDisposition(response.headers.get("content-disposition"))
        || fallbackFilename;

    const reader = response.body.getReader();
    const storage = await init(totalBytes || undefined);

    let receivedBytes = 0;
    let offset = 0;

    onProgress({
        receivedBytes,
        totalBytes,
        percentage: 0,
        phase: "Resolving source",
    });

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        if (!value) {
            continue;
        }

        await storage.write(value, offset);
        offset += value.byteLength;
        receivedBytes += value.byteLength;

        const percentage = totalBytes && totalBytes > 0
            ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
            : 0;

        onProgress({
            receivedBytes,
            totalBytes,
            percentage,
            phase: formatProgressPhase(receivedBytes, totalBytes),
        });
    }

    const rawFile = await storage.res();
    const file = new File([rawFile], filename, {
        type: response.headers.get("content-type") || rawFile.type || "application/octet-stream",
    });
    await storage.destroy();

    onProgress({
        receivedBytes,
        totalBytes,
        percentage: 100,
        phase: "Finalizing",
    });

    return {
        file,
        fileSize: file.size,
        contentType: file.type,
    };
};
