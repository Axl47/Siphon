<script lang="ts">
    import { browser } from "$app/environment";
    import { onMount } from "svelte";
    import { get } from "svelte/store";

    import { pasteLinkFromClipboard } from "$lib/clipboard";
    import { openFile, shareFile } from "$lib/download";
    import { uuid } from "$lib/util";

    import { siphonFlow, setSiphonScreen } from "$lib/siphon/flow";
    import { siphonSettings, updateSiphonSettings } from "$lib/siphon/settings";
    import { siphonApi } from "$lib/siphon/api";
    import { downloadWithProgress } from "$lib/siphon/download";
    import {
        saveDownloadRecord,
        listRecentDownloads,
        searchDownloadHistory,
        getHistoryStats,
        exportMemoryArchive,
    } from "$lib/siphon/history";
    import { buildSidecarPayload } from "$lib/siphon/sidecar";
    import {
        formatBitrate,
        formatBytes,
        formatDateTime,
        formatDeliveryLabel,
        formatDuration,
        formatProgressPhase,
        formatQualityLabel,
        formatSizeKindLabel,
    } from "$lib/siphon/format";

    import type {
        DownloadRecord,
        SiphonAnalyzeOption,
        SiphonAnalyzePicker,
        SiphonAnalyzeSuccess,
        SiphonConnectionStatus,
        SiphonDownloadRequest,
    } from "$lib/siphon/types";

    type QualityTagTone = "neutral" | "audio" | "distill";
    type QualityTag = {
        label: string;
        tone: QualityTagTone;
    };

    const supportedPlatforms = [
        "YouTube",
        "Twitter",
        "Instagram",
        "Reddit",
        "TikTok",
        "Vimeo",
        "SoundCloud",
    ];

    const DISTILL_THRESHOLD_BYTES = 25 * 1024 * 1024;

    let urlInput = "";
    let searchQuery = "";
    let inlineError = "";
    let recentDownloads: DownloadRecord[] = [];
    let historyDownloads: DownloadRecord[] = [];
    let historyStats = { count: 0, totalSize: 0, uniqueUploaders: 0, platforms: [] as Array<{ platform: string; count: number; totalSize: number }> };
    let selectedOptionId = "";
    let settingsOpen = false;
    let isTestingConnection = false;
    let connectionStatus: SiphonConnectionStatus | null = null;
    let isBusy = false;
    let pickerSelection = 0;
    let pickerRequestUrl = "";
    let distillIntent = false;
    let lastQualityAnalysis: SiphonAnalyzeSuccess | null = null;
    let lastPickerAnalysis: SiphonAnalyzePicker | null = null;
    let connectionStatusTimer: number | null = null;

    $: flow = $siphonFlow;
    $: activeSettings = $siphonSettings;
    $: qualityAnalysis = flow.screen === "quality" ? flow.analysis : null;
    $: pickerAnalysis = flow.screen === "picker" ? flow.analysis : null;
    $: selectedOption = qualityAnalysis?.options.find((option) => option.id === selectedOptionId)
        || qualityAnalysis?.options[0]
        || null;
    $: completionNeedsDistill = flow.screen === "complete" && flow.record.fileSize > DISTILL_THRESHOLD_BYTES;

    $: if (qualityAnalysis && !qualityAnalysis.options.some((option) => option.id === selectedOptionId)) {
        selectedOptionId = qualityAnalysis.options[0]?.id || "";
    }

    const defaultDownloadRequest = (url: string): SiphonDownloadRequest => ({
        url,
        audioBitrate: "128",
        audioFormat: "mp3",
        downloadMode: "auto",
        filenameStyle: "pretty",
        videoQuality: "1080",
        youtubeVideoCodec: "h264",
        youtubeVideoContainer: "auto",
        localProcessing: "disabled",
        disableMetadata: false,
        allowH265: false,
        convertGif: true,
        tiktokFullAudio: false,
        alwaysProxy: false,
    });

    const clearConnectionStatusTimer = () => {
        if (connectionStatusTimer) {
            clearTimeout(connectionStatusTimer);
            connectionStatusTimer = null;
        }
    };

    const showConnectionStatus = (status: SiphonConnectionStatus) => {
        clearConnectionStatusTimer();
        connectionStatus = status;

        if (status.ok) {
            connectionStatusTimer = window.setTimeout(() => {
                connectionStatus = null;
                connectionStatusTimer = null;
            }, 2500);
        }
    };

    const resetToMain = () => {
        inlineError = "";
        distillIntent = false;
        setSiphonScreen({ screen: "main" });
    };

    const refreshHistory = async (query = searchQuery) => {
        recentDownloads = await listRecentDownloads(5);
        historyDownloads = await searchDownloadHistory(query);
        historyStats = await getHistoryStats();
    };

    const loadSharedUrl = async () => {
        if (!browser) {
            return;
        }

        const url = new URL(window.location.href);
        const shared = url.searchParams.get("u") || url.hash.replace(/^#/, "");
        if (!shared) {
            return;
        }

        urlInput = decodeURIComponent(shared);
        window.history.replaceState({}, "", "/");
        await analyzeUrl(urlInput);
    };

    const pollConnection = async () => {
        await siphonApi.testConnection(get(siphonSettings));
    };

    const getQualityDisplayLabel = (option: SiphonAnalyzeOption) => {
        if (option.downloadMode === "audio") {
            return "Audio";
        }

        if (option.fps && /^.+p$/i.test(option.label)) {
            return `${option.label}${option.fps}`;
        }

        return option.label;
    };

    const getQualityMetadata = (option: SiphonAnalyzeOption) => {
        const parts = [];

        if (option.resolution) {
            parts.push(option.resolution);
        }

        if (option.fps) {
            parts.push(`${option.fps} fps`);
        }

        return parts.join(" · ") || "Managed by source";
    };

    const getOptionTags = (option: SiphonAnalyzeOption): QualityTag[] => {
        const tags: QualityTag[] = [];
        const seen = new Set<string>();

        const addTag = (label: string | null, tone: QualityTagTone = "neutral") => {
            if (!label) {
                return;
            }

            const key = `${tone}:${label}`;
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            tags.push({ label, tone });
        };

        addTag(option.format);
        if (option.codec && option.codec.toUpperCase() !== option.format?.toUpperCase()) {
            addTag(option.codec);
        }
        addTag(formatDeliveryLabel(option.delivery));
        addTag(formatBitrate(option.bitrateKbps));
        addTag(formatSizeKindLabel(option.sizeKind));

        if (option.downloadMode === "audio") {
            addTag("Audio only", "audio");
        }

        return tags;
    };

    const getSourceMeta = (source: SiphonAnalyzeSuccess["source"]) => {
        return [source.platform, source.uploader, source.uploadDate]
            .filter(Boolean)
            .join(" · ");
    };

    onMount(() => {
        refreshHistory("").catch(() => {});
        loadSharedUrl().catch(() => {});
        pollConnection().catch(() => {});

        const interval = window.setInterval(() => {
            pollConnection().catch(() => {});
        }, 300_000);

        return () => {
            window.clearInterval(interval);
            clearConnectionStatusTimer();
        };
    });

    const pasteClipboard = async () => {
        const pasted = await pasteLinkFromClipboard();
        if (pasted) {
            const match = pasted.match(/https?:\/\/[^\s]+/);
            urlInput = match ? match[0].split("，")[0] : pasted;
        }
    };

    const analyzeUrl = async (url = urlInput) => {
        if (!url.trim()) {
            inlineError = "Paste a URL first.";
            return;
        }

        inlineError = "";
        isBusy = true;
        setSiphonScreen({ screen: "resolving", url });

        const response = await siphonApi.analyze({
            url: url.trim(),
            audioFormat: "mp3",
            youtubeVideoCodec: "h264",
            youtubeVideoContainer: "auto",
            allowH265: false,
            tiktokFullAudio: false,
        }, get(siphonSettings));

        isBusy = false;

        if (response.status === "error") {
            inlineError = response.error.code;
            setSiphonScreen({ screen: "main" });
            return;
        }

        if (response.status === "picker") {
            pickerSelection = 0;
            pickerRequestUrl = url.trim();
            lastPickerAnalysis = response;
            setSiphonScreen({ screen: "picker", analysis: response });
            return;
        }

        lastQualityAnalysis = response;
        selectedOptionId = response.options[0]?.id || "";
        setSiphonScreen({ screen: "quality", analysis: response });
    };

    const persistDownload = async (
        source: SiphonAnalyzeSuccess["source"],
        option: SiphonAnalyzeOption,
        file: File,
    ) => {
        const sidecar = buildSidecarPayload({
            instanceUrl: activeSettings.instanceUrl,
            source,
            selectedOption: option,
            fileSize: file.size,
            filename: file.name,
        });

        const record: DownloadRecord = {
            id: uuid(),
            timestamp: Date.now(),
            sourceUrl: source.url,
            platform: source.platform,
            title: source.title,
            uploader: source.uploader,
            uploadDate: source.uploadDate,
            duration: source.duration,
            selectedQuality: getQualityDisplayLabel(option),
            resolution: option.resolution,
            fps: option.fps,
            format: option.format || "BIN",
            codec: option.codec || "Unknown",
            fileSize: file.size,
            filename: file.name,
            metadata: {
                source,
                option,
            },
            sidecar,
        };

        await saveDownloadRecord(record);
        await refreshHistory("");
        openFile(file);
        setSiphonScreen({ screen: "complete", record, file });
    };

    const downloadResolvedOption = async (
        source: SiphonAnalyzeSuccess["source"],
        option: SiphonAnalyzeOption,
    ) => {
        isBusy = true;
        inlineError = "";

        setSiphonScreen({
            screen: "downloading",
            job: {
                source,
                option,
                progress: {
                    receivedBytes: 0,
                    totalBytes: option.estimatedSizeBytes,
                    percentage: 0,
                    phase: "Resolving source",
                },
            },
        });

        const response = await siphonApi.download(option.downloadRequest, activeSettings);

        if (response.status === "error") {
            inlineError = response.error.code;
            isBusy = false;
            if (lastQualityAnalysis) {
                setSiphonScreen({ screen: "quality", analysis: lastQualityAnalysis });
            } else {
                resetToMain();
            }
            return;
        }

        if (response.status === "local-processing") {
            inlineError = "Local processing downloads are not yet supported in the new Siphon flow.";
            isBusy = false;
            if (lastQualityAnalysis) {
                setSiphonScreen({ screen: "quality", analysis: lastQualityAnalysis });
            } else {
                resetToMain();
            }
            return;
        }

        if (response.status === "picker") {
            inlineError = "This source requires picker selection before download.";
            isBusy = false;
            setSiphonScreen({
                screen: "picker",
                analysis: {
                    status: "picker",
                    source,
                    options: [],
                    pickerItems: response.picker.map((item, index) => ({
                        id: `${item.type}-${index}`,
                        type: item.type,
                        thumb: item.thumb || null,
                        title: null,
                    })),
                },
            });
            return;
        }

        try {
            const fileResult = await downloadWithProgress(
                response.url,
                response.filename,
                (progress) => {
                    setSiphonScreen({
                        screen: "downloading",
                        job: {
                            source,
                            option,
                            progress: {
                                ...progress,
                                phase: formatProgressPhase(progress.receivedBytes, progress.totalBytes),
                            },
                        },
                    });
                }
            );

            await persistDownload(source, option, fileResult.file);
        } catch (error) {
            inlineError = error instanceof Error ? error.message : "Download failed.";
            if (lastQualityAnalysis) {
                setSiphonScreen({ screen: "quality", analysis: lastQualityAnalysis });
            } else {
                resetToMain();
            }
        } finally {
            isBusy = false;
        }
    };

    const downloadPickerSelection = async () => {
        if (!pickerAnalysis) {
            return;
        }

        isBusy = true;
        inlineError = "";
        const response = await siphonApi.download(defaultDownloadRequest(pickerRequestUrl), activeSettings);

        if (response.status !== "picker") {
            inlineError = response.status === "error" ? response.error.code : "Picker source changed while resolving.";
            isBusy = false;
            return;
        }

        const item = response.picker[pickerSelection];
        if (!item) {
            inlineError = "Selected picker item is unavailable.";
            isBusy = false;
            return;
        }

        const pseudoOption: SiphonAnalyzeOption = {
            id: `picker-${pickerSelection}`,
            label: item.type === "photo" ? "Photo" : "Video",
            videoQuality: "picker",
            downloadMode: "auto",
            format: item.type === "photo" ? "JPG" : "MP4",
            codec: item.type === "photo" ? "Image" : "H.264",
            resolution: null,
            fps: null,
            bitrateKbps: null,
            delivery: "direct",
            sizeKind: "unknown",
            estimatedSizeBytes: null,
            downloadRequest: defaultDownloadRequest(pickerRequestUrl),
        };

        try {
            const fileResult = await downloadWithProgress(
                item.url,
                `picker-${pickerSelection + 1}.${item.type === "photo" ? "jpg" : "mp4"}`,
                (progress) => {
                    setSiphonScreen({
                        screen: "downloading",
                        job: {
                            source: pickerAnalysis.source,
                            option: pseudoOption,
                            progress,
                        },
                    });
                }
            );

            await persistDownload(pickerAnalysis.source, pseudoOption, fileResult.file);
        } catch (error) {
            inlineError = error instanceof Error ? error.message : "Download failed.";
            if (lastPickerAnalysis) {
                setSiphonScreen({ screen: "picker", analysis: lastPickerAnalysis });
            } else {
                resetToMain();
            }
        } finally {
            isBusy = false;
        }
    };

    const reAnalyzeRecord = async (record: DownloadRecord) => {
        urlInput = record.sourceUrl;
        await analyzeUrl(record.sourceUrl);
    };

    const runConnectionTest = async () => {
        isTestingConnection = true;
        showConnectionStatus(await siphonApi.testConnection(activeSettings));
        isTestingConnection = false;
    };

    const handleHistorySearch = async () => {
        historyDownloads = await searchDownloadHistory(searchQuery);
        historyStats = await getHistoryStats();
    };

    const shareCompletedFile = async () => {
        if (flow.screen !== "complete" || !flow.file) {
            return;
        }

        try {
            await shareFile(flow.file);
        } catch {
            openFile(flow.file);
        }
    };

    const exportMemory = async () => {
        await exportMemoryArchive();
    };
</script>

<svelte:head>
    <title>Siphon</title>
    <meta property="og:title" content="Siphon" />
</svelte:head>

<div class="siphon-app">
    <header class="topbar">
        <h1>Siphon</h1>
        <div class="topbar-actions">
            <button
                type="button"
                class="ghost small"
                onclick={async () => {
                    await refreshHistory("");
                    setSiphonScreen({ screen: "history", query: searchQuery });
                }}
            >
                History
            </button>
            <button type="button" class="ghost small" onclick={() => (settingsOpen = true)}>Settings</button>
        </div>
    </header>

    {#if flow.screen === "main" || flow.screen === "resolving"}
        <section class="screen panel main-screen">
            <div class="hero-block">
                <p class="section-label">Paste a URL</p>
                <div class="url-box">
                    <input
                        id="url-input"
                        bind:value={urlInput}
                        data-first-focus
                        placeholder="https://..."
                        autocapitalize="off"
                        autocomplete="off"
                        spellcheck="false"
                        onkeydown={(event) => event.key === "Enter" && analyzeUrl()}
                    />
                    <button type="button" class="ghost inline-action" onclick={pasteClipboard}>Paste</button>
                </div>

                {#if flow.screen === "resolving"}
                    <div class="shimmer" aria-hidden="true"></div>
                {/if}

                {#if inlineError}
                    <p class="inline-error">{inlineError}</p>
                {/if}

                <button type="button" class="primary" disabled={isBusy} onclick={() => analyzeUrl()}>
                    {flow.screen === "resolving" ? "Resolving" : "Analyze"}
                </button>
            </div>

            <div class="section-stack">
                <section class="section-block">
                    <p class="section-label">Supported</p>
                    <div class="chip-row">
                        {#each supportedPlatforms as platform}
                            <span class="chip">{platform}</span>
                        {/each}
                    </div>
                </section>

                <section class="section-block">
                    <p class="section-label">Recent</p>
                    {#if recentDownloads.length === 0}
                        <p class="empty-state">Paste a URL above or share from another app.</p>
                    {:else}
                        <div class="download-list">
                            {#each recentDownloads as record}
                                <button type="button" class="download-row" onclick={() => reAnalyzeRecord(record)}>
                                    <div class="download-meta">
                                        <strong>{record.title || record.filename}</strong>
                                        <span>{record.platform} · {record.uploader || "Unknown"} · {record.selectedQuality}</span>
                                    </div>
                                    <span class="ghost-text">{formatBytes(record.fileSize)}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </section>
            </div>
        </section>
    {/if}

    {#if flow.screen === "quality"}
        <section class="screen panel quality-screen">
            <div class="quality-header">
                <button type="button" class="back-link" onclick={resetToMain}>Back</button>

                <article class="source-card">
                    <div class="source-thumb">
                        {#if flow.analysis.source.thumbnailUrl}
                            <img src={flow.analysis.source.thumbnailUrl} alt="" />
                        {:else}
                            <div class="thumb-placeholder">{flow.analysis.source.platform.slice(0, 1).toUpperCase()}</div>
                        {/if}

                        {#if flow.analysis.source.duration}
                            <span class="duration-badge">{formatDuration(flow.analysis.source.duration)}</span>
                        {/if}
                    </div>

                    <div class="source-copy">
                        <h2>{flow.analysis.source.title || "Untitled source"}</h2>
                        <div class="source-meta">
                            <span class="platform-badge">{flow.analysis.source.platform}</span>
                            <span>{getSourceMeta(flow.analysis.source) || "Unknown source details"}</span>
                        </div>
                    </div>
                </article>
            </div>

            <div class="quality-scroll">
                <p class="section-label">Quality</p>

                <div class="quality-list">
                    {#each flow.analysis.options as option}
                        <button
                            type="button"
                            class:selected={selectedOptionId === option.id}
                            class="quality-card"
                            onclick={() => (selectedOptionId = option.id)}
                        >
                            <div class="quality-leading">
                                <strong class="quality-label">{getQualityDisplayLabel(option)}</strong>
                                <span class="quality-meta">{getQualityMetadata(option)}</span>

                                <div class="tag-row">
                                    {#each getOptionTags(option) as tag}
                                        <span class={`tag ${tag.tone}`}>{tag.label}</span>
                                    {/each}
                                </div>
                            </div>

                            <div class="quality-size-block">
                                <strong class="quality-size">{formatBytes(option.estimatedSizeBytes)}</strong>
                            </div>
                        </button>
                    {/each}
                </div>
            </div>

            <div class="quality-footer">
                {#if inlineError}
                    <p class="inline-error footer-error">{inlineError}</p>
                {/if}

                {#if selectedOption && (selectedOption.estimatedSizeBytes || 0) > DISTILL_THRESHOLD_BYTES}
                    <button type="button" class="distill-banner" onclick={() => (distillIntent = !distillIntent)}>
                        <span class="distill-icon">◇</span>
                        <div class="distill-copy">
                            <strong>Distill after download?</strong>
                            <span>Compress for Discord, WhatsApp, and similar limits.</span>
                        </div>
                        <span class="distill-tail">{distillIntent ? "Queued" : "↗"}</span>
                    </button>
                {/if}

                <button
                    type="button"
                    class="primary"
                    disabled={!selectedOption || isBusy}
                    onclick={() => selectedOption && downloadResolvedOption(flow.analysis.source, selectedOption)}
                >
                    Download {selectedOption ? formatBytes(selectedOption.estimatedSizeBytes) : ""}
                </button>
            </div>
        </section>
    {/if}

    {#if flow.screen === "picker"}
        <section class="screen panel picker-screen">
            <button type="button" class="back-link" onclick={resetToMain}>Back</button>
            <h2>Pick an Item</h2>
            <p class="secondary-copy">This source contains multiple media items. Phase 1 supports downloading one item at a time.</p>

            <div class="picker-grid">
                {#each flow.analysis.pickerItems as item, index}
                    <button
                        type="button"
                        class:selected={pickerSelection === index}
                        class="picker-card"
                        onclick={() => (pickerSelection = index)}
                    >
                        {#if item.thumb}
                            <img src={item.thumb} alt="" />
                        {:else}
                            <div class="thumb-placeholder">{item.type.slice(0, 1).toUpperCase()}</div>
                        {/if}
                        <span>{item.type}</span>
                    </button>
                {/each}
            </div>

            {#if inlineError}
                <p class="inline-error">{inlineError}</p>
            {/if}

            <button type="button" class="primary" disabled={isBusy} onclick={downloadPickerSelection}>Download Selected Item</button>
        </section>
    {/if}

    {#if flow.screen === "downloading"}
        <section class="screen panel centered-panel">
            <p class="section-label centered">Extracting</p>
            <h2>{flow.job.source.title || flow.job.option.label}</h2>
            <p class="secondary-copy centered">{formatQualityLabel(flow.job.option.label, flow.job.option.fps, flow.job.option.codec)}</p>

            <div class="progress-number">{flow.job.progress.percentage}%</div>
            <div class="progress-track">
                <div class="progress-fill" style={`width: ${flow.job.progress.percentage}%`}></div>
            </div>
            <div class="progress-stats">
                <span>{formatBytes(flow.job.progress.receivedBytes)}</span>
                <span>{formatBytes(flow.job.progress.totalBytes)}</span>
            </div>
            <p class="secondary-copy centered">{flow.job.progress.phase}</p>
        </section>
    {/if}

    {#if flow.screen === "complete"}
        <section class="screen panel complete-screen">
            <div class="saved-mark">↓</div>
            <p class="section-label centered">Saved</p>
            <div class="size-stat">{formatBytes(flow.record.fileSize)}</div>
            <p class="secondary-copy centered">{flow.record.selectedQuality} · {flow.record.format} · {flow.record.codec}</p>

            {#if completionNeedsDistill}
                <button type="button" class="distill-banner" onclick={() => (distillIntent = !distillIntent)}>
                    <span class="distill-icon">◇</span>
                    <div class="distill-copy">
                        <strong>Distill to share</strong>
                        <span>Compress for Discord, WhatsApp, and similar limits.</span>
                    </div>
                    <span class="distill-tail">{distillIntent ? "Queued" : "↗"}</span>
                </button>
            {/if}

            <article class="metadata-card">
                <div>
                    <span class="section-label">Title</span>
                    <strong>{flow.record.title || flow.record.filename}</strong>
                </div>
                <div>
                    <span class="section-label">Source</span>
                    <strong>{flow.record.platform} · {flow.record.uploader || "Unknown uploader"}</strong>
                </div>
                <div>
                    <span class="section-label">Duration</span>
                    <strong>{formatDuration(flow.record.duration)}</strong>
                </div>
                <div>
                    <span class="section-label">Downloaded</span>
                    <strong>{formatDateTime(flow.record.timestamp)}</strong>
                </div>
            </article>

            <div class="action-stack">
                <button type="button" class="primary" disabled={!flow.file} onclick={shareCompletedFile}>
                    {distillIntent ? "Share / Distill Later" : "Share"}
                </button>
                <button type="button" class="ghost" disabled={!flow.file} onclick={() => flow.file && openFile(flow.file)}>Open File</button>
                <button type="button" class="ghost" onclick={exportMemory}>Export Memory Archive</button>
                <button type="button" class="ghost" onclick={resetToMain}>Siphon Another</button>
            </div>
        </section>
    {/if}

    {#if flow.screen === "history"}
        <section class="screen panel history-screen">
            <button type="button" class="back-link" onclick={resetToMain}>Back</button>
            <h2>History</h2>
            <p class="secondary-copy">{historyStats.count} downloads · {formatBytes(historyStats.totalSize)} · {historyStats.platforms.length} platforms</p>

            <div class="history-summary">
                <div class="history-stat">
                    <span class="section-label">Uploaders</span>
                    <strong>{historyStats.uniqueUploaders}</strong>
                </div>
                <div class="history-stat">
                    <span class="section-label">Top platform</span>
                    <strong>{historyStats.platforms[0]?.platform || "None yet"}</strong>
                </div>
                <button type="button" class="ghost small" onclick={exportMemory}>Export Memory</button>
            </div>

            <div class="url-box">
                <input
                    bind:value={searchQuery}
                    placeholder="Search downloads"
                    oninput={handleHistorySearch}
                />
            </div>

            <div class="download-list">
                {#each historyDownloads as record}
                    <button type="button" class="download-row" onclick={() => reAnalyzeRecord(record)}>
                        <div class="download-meta">
                            <strong>{record.title || record.filename}</strong>
                            <span>{record.platform} · {record.uploader || "Unknown"} · {record.selectedQuality} · {formatDateTime(record.timestamp)}</span>
                        </div>
                        <span class="ghost-text">{formatBytes(record.fileSize)}</span>
                    </button>
                {/each}
            </div>
        </section>
    {/if}

    {#if settingsOpen}
        <div class="overlay" role="presentation">
            <section class="settings-sheet">
                <div class="settings-top">
                    <div>
                        <h2>Settings</h2>
                        <p class="secondary-copy">Instance connection</p>
                    </div>
                    <button type="button" class="ghost small" onclick={() => (settingsOpen = false)}>Close</button>
                </div>

                <label class="field">
                    <span class="section-label">Instance URL</span>
                    <input
                        value={activeSettings.instanceUrl}
                        placeholder="https://your-instance.example.com"
                        oninput={(event) => updateSiphonSettings({ instanceUrl: (event.currentTarget as HTMLInputElement).value })}
                    />
                    <span class="field-hint">Your Cobalt-compatible processing server.</span>
                </label>

                <label class="field">
                    <span class="section-label">API Key</span>
                    <input
                        value={activeSettings.apiKey}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        oninput={(event) => updateSiphonSettings({ apiKey: (event.currentTarget as HTMLInputElement).value })}
                    />
                    <span class="field-hint">UUIDv4 key assigned by the instance owner.</span>
                </label>

                <button type="button" class="primary" disabled={isTestingConnection} onclick={runConnectionTest}>
                    {isTestingConnection ? "Testing" : "Test Connection"}
                </button>

                {#if connectionStatus}
                    <div class:status-ok={connectionStatus.ok} class:status-error={!connectionStatus.ok} class="status-card">
                        <span class="status-dot"></span>
                        <div class="status-copy">
                            {#if connectionStatus.ok}
                                <strong>Connected · v{connectionStatus.info.version} · {connectionStatus.info.services.length} services</strong>
                                <span>{connectionStatus.info.origin}</span>
                            {:else}
                                <strong>Connection failed</strong>
                                <span>{connectionStatus.error}</span>
                            {/if}
                        </div>
                    </div>
                {/if}

                <div class="sheet-divider"></div>

                <label class="metadata-row">
                    <div>
                        <span class="section-label">Metadata</span>
                        <strong>Remember download data</strong>
                    </div>
                    <span class:enabled={activeSettings.saveMetadata} class="toggle-shell">
                        <input
                            type="checkbox"
                            checked={activeSettings.saveMetadata}
                            onchange={(event) => updateSiphonSettings({ saveMetadata: (event.currentTarget as HTMLInputElement).checked })}
                        />
                        <span class="toggle-thumb"></span>
                    </span>
                </label>
            </section>
        </div>
    {/if}
</div>

<style>
    .siphon-app {
        width: min(100%, 560px);
        height: 100dvh;
        margin: 0 auto;
        padding: 24px 20px calc(18px + env(safe-area-inset-bottom));
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 16px;
    }

    .topbar,
    .topbar-actions,
    .url-box,
    .download-row,
    .quality-card,
    .quality-footer,
    .action-stack,
    .settings-top,
    .status-card,
    .metadata-row,
    .distill-banner,
    .progress-stats {
        display: flex;
    }

    .topbar,
    .download-row,
    .quality-card,
    .settings-top,
    .status-card,
    .metadata-row,
    .distill-banner,
    .progress-stats {
        align-items: center;
        justify-content: space-between;
    }

    .topbar h1,
    h2,
    .size-stat {
        margin: 0;
        font-family: var(--siphon-display-font);
        font-weight: 500;
        color: var(--text-primary);
    }

    .topbar h1 {
        font-size: 2.1rem;
        letter-spacing: -0.03em;
    }

    h2 {
        font-size: 1.42rem;
    }

    .screen {
        min-height: 0;
        overflow: auto;
    }

    .panel,
    .settings-sheet,
    .source-card,
    .metadata-card,
    .status-card,
    .distill-banner,
    .quality-footer {
        background: var(--siphon-bg-surface);
        border: 1px solid var(--siphon-border);
        border-radius: 10px;
    }

    .panel,
    .settings-sheet {
        padding: 16px;
    }

    .main-screen,
    .picker-screen,
    .history-screen,
    .complete-screen {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .quality-screen {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: 14px;
        overflow: hidden;
    }

    .quality-header,
    .quality-scroll,
    .quality-footer,
    .hero-block,
    .history-summary,
    .section-stack,
    .section-block,
    .history-stat,
    .quality-leading,
    .distill-copy,
    .status-copy,
    .download-meta,
    .field {
        display: flex;
        flex-direction: column;
    }

    .quality-scroll,
    .history-summary,
    .section-stack {
        min-height: 0;
        gap: 14px;
    }

    .quality-scroll {
        overflow: auto;
        padding-bottom: 4px;
    }

    .quality-footer {
        gap: 12px;
        padding: 12px;
    }

    .history-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: end;
        gap: 12px;
        padding: 12px;
        border: 1px solid var(--siphon-border);
        border-radius: 10px;
        background: var(--siphon-bg-raised);
    }

    .hero-block,
    .section-block,
    .history-stat,
    .quality-leading,
    .distill-copy,
    .status-copy,
    .download-meta,
    .field {
        gap: 8px;
    }

    .section-label,
    .ghost-text,
    .secondary-copy,
    .field-hint,
    .download-meta span,
    .source-meta,
    .quality-meta,
    .tag {
        font-family: var(--siphon-mono-font);
    }

    .section-label {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--text-ghost);
    }

    .secondary-copy,
    .ghost-text,
    .download-meta span,
    .source-meta,
    .quality-meta,
    .field-hint {
        color: var(--text-secondary);
        font-size: 0.74rem;
        line-height: 1.45;
    }

    .source-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }

    .platform-badge,
    .chip,
    .tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: fit-content;
        border-radius: 4px;
        border: 1px solid var(--siphon-border);
        background: var(--siphon-bg-raised);
    }

    .platform-badge,
    .chip {
        padding: 4px 8px;
        font: 500 0.68rem var(--siphon-mono-font);
        color: var(--text-secondary);
        text-transform: capitalize;
    }

    .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .url-box {
        gap: 8px;
        align-items: center;
        padding: 6px;
        background: var(--siphon-bg-raised);
        border: 1px solid var(--siphon-border);
        border-radius: 10px;
    }

    input {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--siphon-border);
        border-radius: 10px;
        background: var(--siphon-bg-surface);
        color: var(--text-primary);
        font: 500 0.88rem var(--siphon-mono-font);
        outline: none;
        padding: 12px;
        box-sizing: border-box;
    }

    .url-box input {
        border: none;
        background: transparent;
        padding: 10px 8px;
    }

    input:focus {
        border-color: var(--siphon-accent-border);
        box-shadow: 0 0 0 1px var(--siphon-accent-focus);
    }

    .url-box input:focus {
        box-shadow: none;
    }

    button {
        box-shadow: none;
        border: 1px solid transparent;
        border-radius: 9px;
        padding: 11px 14px;
        background: var(--siphon-bg-raised);
        color: var(--text-primary);
        font: 500 0.92rem var(--siphon-body-font);
    }

    button.small {
        width: auto;
        padding: 10px 12px;
    }

    button.primary {
        width: 100%;
        justify-content: center;
        background: var(--siphon-accent-muted);
        border-color: var(--siphon-accent-border);
        color: var(--siphon-accent);
    }

    button.ghost {
        background: transparent;
        border-color: var(--siphon-border);
        color: var(--text-secondary);
    }

    button:disabled {
        opacity: 0.56;
    }

    .inline-action {
        white-space: nowrap;
    }

    .back-link {
        width: fit-content;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font: 500 0.74rem var(--siphon-mono-font);
    }

    .source-card {
        overflow: hidden;
    }

    .source-thumb {
        position: relative;
        height: 160px;
        background: #121318;
    }

    .source-thumb img,
    .picker-card img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .thumb-placeholder {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
        color: var(--siphon-accent);
        font: 500 3rem var(--siphon-display-font);
        background:
            linear-gradient(135deg, rgba(126, 184, 212, 0.12), transparent 60%),
            #121318;
    }

    .duration-badge {
        position: absolute;
        right: 10px;
        bottom: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.72);
        color: rgba(255, 255, 255, 0.72);
        font: 500 0.62rem var(--siphon-mono-font);
    }

    .source-copy {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .source-copy h2 {
        display: -webkit-box;
        overflow: hidden;
        color: var(--text-primary);
        font: 500 0.95rem/1.35 var(--siphon-body-font);
        line-clamp: 2;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .quality-list {
        display: grid;
        gap: 8px;
    }

    .quality-card {
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        text-align: left;
        background: var(--siphon-bg-raised);
        border-color: var(--siphon-border);
    }

    .quality-card.selected {
        border-color: var(--siphon-accent-border);
        background: var(--siphon-accent-glow);
    }

    .quality-leading {
        flex: 1;
        min-width: 0;
    }

    .quality-label {
        color: var(--text-primary);
        font: 500 0.92rem var(--siphon-mono-font);
    }

    .quality-size-block {
        flex-shrink: 0;
        text-align: right;
    }

    .quality-size {
        color: var(--text-primary);
        font: 500 0.86rem var(--siphon-mono-font);
    }

    .tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .tag {
        padding: 3px 8px;
        color: var(--text-secondary);
        font-size: 0.56rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .tag.audio {
        color: var(--siphon-audio);
        border-color: rgba(184, 160, 212, 0.24);
        background: rgba(184, 160, 212, 0.08);
    }

    .tag.distill {
        color: var(--siphon-distill);
    }

    .distill-banner {
        gap: 12px;
        width: 100%;
        padding: 12px;
        border-color: var(--siphon-distill-border);
        background: var(--siphon-distill-muted);
        color: var(--siphon-distill);
    }

    .distill-copy {
        flex: 1;
        text-align: left;
    }

    .distill-copy strong {
        color: var(--siphon-distill);
        font: 500 0.82rem var(--siphon-body-font);
    }

    .distill-copy span,
    .distill-icon,
    .distill-tail {
        color: rgba(212, 165, 116, 0.72);
        font: 500 0.66rem var(--siphon-mono-font);
    }

    .distill-icon,
    .distill-tail {
        flex-shrink: 0;
    }

    .download-list {
        display: flex;
        flex-direction: column;
    }

    .download-row {
        padding: 12px 0;
        border-radius: 0;
        border: none;
        border-bottom: 1px solid var(--siphon-border);
        background: transparent;
        gap: 12px;
    }

    .download-meta {
        flex: 1;
        min-width: 0;
        text-align: left;
    }

    .download-meta strong,
    .history-stat strong,
    .metadata-card strong {
        color: var(--text-primary);
        font: 500 0.92rem var(--siphon-body-font);
    }

    .empty-state,
    .inline-error {
        margin: 0;
        color: var(--text-secondary);
        font: 500 0.74rem var(--siphon-mono-font);
    }

    .inline-error {
        color: var(--siphon-error);
    }

    .footer-error {
        text-align: left;
    }

    .picker-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }

    .picker-card {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 0;
        border: 1px solid var(--siphon-border);
        border-radius: 10px;
        background: var(--siphon-bg-raised);
        text-align: left;
    }

    .picker-card.selected {
        border-color: var(--siphon-accent-border);
        background: var(--siphon-accent-glow);
    }

    .picker-card span {
        padding: 10px 12px;
        color: var(--text-secondary);
        font: 500 0.68rem var(--siphon-mono-font);
        text-transform: uppercase;
        letter-spacing: 0.16em;
    }

    .centered-panel {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 14px;
        text-align: center;
    }

    .progress-number {
        color: var(--siphon-accent);
        font: 500 2.7rem var(--siphon-display-font);
    }

    .progress-track {
        width: 100%;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
    }

    .progress-fill {
        height: 100%;
        background: var(--siphon-accent);
    }

    .progress-stats {
        color: var(--text-secondary);
        font: 500 0.68rem var(--siphon-mono-font);
    }

    .saved-mark {
        display: grid;
        width: 56px;
        height: 56px;
        place-items: center;
        margin: 0 auto;
        border: 1px solid var(--siphon-accent-border);
        border-radius: 10px;
        color: var(--siphon-accent);
        font-size: 1.4rem;
    }

    .size-stat {
        font-size: 2.55rem;
        text-align: center;
    }

    .metadata-card {
        display: grid;
        gap: 0;
        overflow: hidden;
    }

    .metadata-card div {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--siphon-border);
    }

    .metadata-card div:last-child {
        border-bottom: none;
    }

    .action-stack {
        flex-direction: column;
        gap: 10px;
    }

    .overlay {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.88);
    }

    .settings-sheet {
        width: min(100%, 460px);
        max-height: min(100dvh - 40px, 760px);
        display: flex;
        flex-direction: column;
        gap: 14px;
        overflow: auto;
    }

    .field-hint {
        font-size: 0.64rem;
    }

    .status-card {
        gap: 12px;
        padding: 12px 14px;
        align-items: flex-start;
    }

    .status-dot {
        width: 6px;
        height: 6px;
        margin-top: 6px;
        flex-shrink: 0;
        border-radius: 999px;
        background: currentColor;
    }

    .status-card.status-ok {
        color: var(--siphon-success);
        border-color: rgba(74, 222, 128, 0.22);
        background: rgba(74, 222, 128, 0.04);
    }

    .status-card.status-error {
        color: var(--siphon-error);
        border-color: rgba(239, 68, 68, 0.22);
        background: rgba(239, 68, 68, 0.04);
    }

    .status-copy strong {
        color: currentColor;
        font: 500 0.76rem var(--siphon-mono-font);
    }

    .status-copy span {
        color: currentColor;
        opacity: 0.8;
        font: 500 0.66rem var(--siphon-mono-font);
        word-break: break-word;
    }

    .sheet-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.03);
    }

    .metadata-row {
        gap: 12px;
    }

    .metadata-row strong {
        color: var(--text-primary);
        font: 500 0.82rem var(--siphon-mono-font);
    }

    .toggle-shell {
        position: relative;
        display: inline-flex;
        width: 30px;
        height: 18px;
        flex-shrink: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        transition: background 160ms ease;
    }

    .toggle-shell.enabled {
        background: rgba(126, 184, 212, 0.3);
    }

    .toggle-shell input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }

    .toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.55);
        transition:
            transform 160ms ease,
            background 160ms ease;
    }

    .toggle-shell.enabled .toggle-thumb {
        transform: translateX(12px);
        background: var(--siphon-accent);
    }

    .shimmer {
        position: relative;
        overflow: hidden;
        height: 2px;
        background: rgba(255, 255, 255, 0.05);
    }

    .shimmer::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 40%;
        background: linear-gradient(90deg, transparent, var(--siphon-accent), transparent);
        animation: siphon-shimmer 1.2s linear infinite;
    }

    @keyframes siphon-shimmer {
        from {
            transform: translateX(-120%);
        }
        to {
            transform: translateX(320%);
        }
    }

    @media (max-width: 640px) {
        .siphon-app {
            width: 100%;
            padding: 18px 14px calc(16px + env(safe-area-inset-bottom));
        }

        .panel,
        .settings-sheet {
            padding: 14px;
        }

        .quality-card {
            gap: 10px;
            flex-direction: column;
        }

        .quality-size-block {
            width: 100%;
            text-align: left;
        }

        .picker-grid {
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .history-summary {
            grid-template-columns: 1fr;
            align-items: stretch;
        }

        .overlay {
            padding: 14px;
        }
    }
</style>
