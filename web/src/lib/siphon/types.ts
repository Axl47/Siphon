export type SiphonSettings = {
    instanceUrl: string;
    apiKey: string;
    saveMetadata: boolean;
};

export type SiphonAnalyzeRequest = {
    url: string;
    audioFormat?: "best" | "mp3" | "ogg" | "wav" | "opus";
    youtubeVideoCodec?: "h264" | "av1" | "vp9";
    youtubeVideoContainer?: "auto" | "mp4" | "webm" | "mkv";
    allowH265?: boolean;
    tiktokFullAudio?: boolean;
};

export type SiphonDownloadRequest = {
    url: string;
    audioBitrate?: string;
    audioFormat?: string;
    downloadMode: "auto" | "audio" | "mute";
    filenameStyle?: string;
    videoQuality: string;
    youtubeVideoCodec?: string;
    youtubeVideoContainer?: string;
    localProcessing?: string;
    disableMetadata?: boolean;
    allowH265?: boolean;
    convertGif?: boolean;
    tiktokFullAudio?: boolean;
    alwaysProxy?: boolean;
};

export type SiphonAnalyzeOption = {
    id: string;
    label: string;
    videoQuality: string;
    downloadMode: "auto" | "audio" | "mute";
    format: string | null;
    codec: string | null;
    resolution: string | null;
    fps: number | null;
    bitrateKbps: number | null;
    delivery: "direct" | "proxy" | "processed";
    sizeKind: "exact" | "estimated" | "unknown";
    estimatedSizeBytes: number | null;
    downloadRequest: SiphonDownloadRequest;
};

export type SiphonAnalyzeSource = {
    url: string;
    platform: string;
    title: string | null;
    uploader: string | null;
    uploadDate: string | null;
    duration: string | null;
    thumbnailUrl: string | null;
};

export type SiphonSourceInfo = SiphonAnalyzeSource;

export type SiphonAnalyzeSuccess = {
    status: "ok";
    source: SiphonAnalyzeSource;
    options: SiphonAnalyzeOption[];
};

export type SiphonAnalyzePicker = {
    status: "picker";
    source: SiphonAnalyzeSource;
    options: [];
    pickerItems: Array<{
        id: string;
        type: "photo" | "video" | "gif";
        thumb: string | null;
        title: string | null;
    }>;
};

export type SiphonAnalyzeError = {
    status: "error";
    error: {
        code: string;
        context?: Record<string, unknown>;
    };
};

export type SiphonAnalyzeResponse =
    | SiphonAnalyzeSuccess
    | SiphonAnalyzePicker
    | SiphonAnalyzeError;

export type SiphonCobaltDownloadResponse =
    | {
        status: "tunnel" | "redirect";
        url: string;
        filename: string;
    }
    | {
        status: "picker";
        picker: Array<{
            type: "photo" | "video" | "gif";
            url: string;
            thumb?: string;
        }>;
        audio?: string;
        audioFilename?: string;
    }
    | {
        status: "local-processing";
        tunnel: string[];
        output: {
            filename: string;
            type?: string;
        };
    }
    | SiphonAnalyzeError;

export type SiphonConnectionStatus =
    | {
        ok: true;
        checkedAt: number;
        info: {
            version: string;
            services: string[];
            origin: string;
        };
    }
    | {
        ok: false;
        checkedAt: number;
        error: string;
    };

export type SidecarPayload = {
    siphon: {
        version: 1;
        downloadedAt: string;
        instanceUrl: string;
    };
    source: {
        url: string;
        platform: string;
        title: string | null;
        uploader: string | null;
        uploadDate: string | null;
        duration: string | null;
    };
    output: {
        quality: string;
        resolution: string | null;
        fps: number | null;
        format: string;
        codec: string;
        fileSize: number;
        filename: string;
    };
};

export type DownloadRecord = {
    id: string;
    timestamp: number;
    sourceUrl: string;
    platform: string;
    title: string | null;
    uploader: string | null;
    uploadDate: string | null;
    duration: string | null;
    selectedQuality: string;
    resolution: string | null;
    fps: number | null;
    format: string;
    codec: string;
    fileSize: number;
    filename: string;
    metadata: Record<string, unknown>;
    sidecar: SidecarPayload;
};

export type SiphonHistoryPlatformStat = {
    platform: string;
    count: number;
    totalSize: number;
};

export type SiphonHistoryStats = {
    count: number;
    totalSize: number;
    uniqueUploaders: number;
    platforms: SiphonHistoryPlatformStat[];
};

export type SiphonMemoryExport = {
    siphon: {
        version: 1;
        exportedAt: string;
    };
    stats: SiphonHistoryStats;
    downloads: DownloadRecord[];
};

export type DownloadProgress = {
    receivedBytes: number;
    totalBytes: number | null;
    percentage: number;
    phase: string;
};

export type DownloadResult = {
    file: File;
    fileSize: number;
    contentType: string;
};

export type DownloadJobState = {
    source: SiphonAnalyzeSource;
    option: SiphonAnalyzeOption;
    progress: DownloadProgress;
};

export type SiphonFlowState =
    | { screen: "main" }
    | { screen: "resolving"; url: string }
    | { screen: "quality"; analysis: SiphonAnalyzeSuccess }
    | { screen: "picker"; analysis: SiphonAnalyzePicker }
    | { screen: "downloading"; job: DownloadJobState }
    | { screen: "complete"; record: DownloadRecord; file: File | null }
    | { screen: "history"; query: string }
    | { screen: "settings" };
