import { browser } from "$app/environment";

import type {
    SidecarPayload,
    SiphonAnalyzeOption,
    SiphonSourceInfo,
} from "./types";

type SidecarInput = {
    instanceUrl: string;
    source: SiphonSourceInfo;
    selectedOption: Pick<SiphonAnalyzeOption, "label" | "resolution" | "fps" | "format" | "codec">;
    fileSize: number;
    filename: string;
    downloadedAt?: Date;
};

const sanitizeText = (value: string) =>
    value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();

export const buildSidecarPayload = ({
    instanceUrl,
    source,
    selectedOption,
    fileSize,
    filename,
    downloadedAt = new Date(),
}: SidecarInput): SidecarPayload => ({
    siphon: {
        version: 1,
        downloadedAt: downloadedAt.toISOString(),
        instanceUrl: sanitizeText(instanceUrl),
    },
    source: {
        url: source.url,
        platform: source.platform,
        title: source.title,
        uploader: source.uploader,
        uploadDate: source.uploadDate,
        duration: source.duration,
    },
    output: {
        quality: selectedOption.label,
        resolution: selectedOption.resolution,
        fps: selectedOption.fps,
        format: selectedOption.format || "BIN",
        codec: selectedOption.codec || "unknown",
        fileSize,
        filename,
    },
});

export const getSidecarFilename = (mediaFilename: string) =>
    `${mediaFilename}.siphon.json`;

export const sidecarToJSON = (payload: SidecarPayload) =>
    JSON.stringify(payload, null, 2);

export const exportSidecarFile = async (
    payload: SidecarPayload,
    mediaFilename: string
) => {
    if (!browser) {
        throw new Error("sidecar export is only available in the browser");
    }

    const sidecarName = getSidecarFilename(mediaFilename);
    const sidecarBlob = new Blob([sidecarToJSON(payload)], { type: "application/json" });
    const url = URL.createObjectURL(sidecarBlob);

    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = sidecarName;
        anchor.click();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
};
