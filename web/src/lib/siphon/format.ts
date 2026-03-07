const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export const formatBytes = (bytes: number | null | undefined, fractionDigits = 1): string => {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
        return "Unknown size";
    }

    if (bytes === 0) {
        return "0 B";
    }

    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
};

export const formatDateTime = (
    timestamp: number | string | Date,
    locale?: string
): string => {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return "Invalid date";
    }

    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
};

export const formatDuration = (value: string | number | null): string => {
    if (value === null) {
        return "Unknown";
    }

    if (typeof value === "string") {
        return value;
    }

    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const formatQualityLabel = (
    label: string,
    fps: number | null,
    codec: string | null
): string => {
    const parts = [label];

    if (fps) {
        parts.push(`${fps}fps`);
    }

    if (codec) {
        parts.push(codec);
    }

    return parts.join(" / ");
};

export const formatBitrate = (bitrateKbps: number | null): string | null => {
    if (!bitrateKbps || bitrateKbps <= 0 || Number.isNaN(bitrateKbps)) {
        return null;
    }

    if (bitrateKbps >= 1000) {
        return `${(bitrateKbps / 1000).toFixed(1)} Mbps`;
    }

    return `${Math.round(bitrateKbps)} kbps`;
};

export const formatDeliveryLabel = (
    delivery: "direct" | "proxy" | "processed"
): string => {
    switch (delivery) {
        case "direct":
            return "Direct";
        case "proxy":
            return "Proxy";
        case "processed":
            return "Processed";
    }
};

export const formatSizeKindLabel = (
    sizeKind: "exact" | "estimated" | "unknown"
): string | null => {
    if (sizeKind === "estimated") {
        return "Estimated";
    }

    if (sizeKind === "exact") {
        return "Exact";
    }

    return null;
};

export const formatProgressPhase = (
    receivedBytes: number,
    totalBytes: number | null
): string => {
    if (!totalBytes || totalBytes <= 0) {
        return "Downloading";
    }

    const ratio = receivedBytes / totalBytes;
    if (ratio < 0.15) {
        return "Resolving source";
    }

    if (ratio < 0.85) {
        return "Downloading";
    }

    if (ratio < 0.98) {
        return "Muxing streams";
    }

    return "Finalizing";
};
