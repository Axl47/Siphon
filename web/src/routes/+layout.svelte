<script lang="ts">
    import "../app.css";
    import "../fonts/noto-mono-cobalt.css";

    import "@fontsource/ibm-plex-mono/400.css";
    import "@fontsource/ibm-plex-mono/400-italic.css";
    import "@fontsource/ibm-plex-mono/500.css";
    import "@fontsource/dm-sans/400.css";
    import "@fontsource/dm-sans/500.css";
    import "@fontsource/newsreader/400.css";
    import "@fontsource/newsreader/500.css";

    import { onMount } from "svelte";
    import { page, updated } from "$app/stores";
    import { browser, dev } from "$app/environment";
    import { afterNavigate } from "$app/navigation";

    import "$lib/polyfills";
    import env from "$lib/env";
    import locale from "$lib/i18n/locale";
    import settings from "$lib/state/settings";

    import { t } from "$lib/i18n/translations";
    import { device, app } from "$lib/device";
    import { getServerInfo } from "$lib/api/server-info";
    import currentTheme, { statusBarColors } from "$lib/state/theme";

    import Sidebar from "$components/sidebar/Sidebar.svelte";
    import NotchSticker from "$components/misc/NotchSticker.svelte";
    import DialogHolder from "$components/dialog/DialogHolder.svelte";
    import ProcessingQueue from "$components/queue/ProcessingQueue.svelte";
    import UpdateNotification from "$components/misc/UpdateNotification.svelte";

    $: reduceMotion =
        $settings.accessibility.reduceMotion || device.prefers.reducedMotion;

    $: reduceTransparency =
        $settings.accessibility.reduceTransparency ||
        device.prefers.reducedTransparency;

    $: isRootRoute = $page.url.pathname === "/";
    $: preloadAssets = false;

    const DEV_SW_RESET_KEY = "siphon-dev-sw-reset";

    const resetDevServiceWorkers = async () => {
        if (!("serviceWorker" in navigator)) {
            return;
        }

        const registrations = await navigator.serviceWorker.getRegistrations();
        const matchingRegistrations = registrations.filter((registration) =>
            registration.scope.startsWith(window.location.origin)
        );

        if (!matchingRegistrations.length) {
            sessionStorage.removeItem(DEV_SW_RESET_KEY);
            return;
        }

        await Promise.all(matchingRegistrations.map((registration) => registration.unregister()));

        if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((key) => key.startsWith("siphon-shell-"))
                    .map((key) => caches.delete(key))
            );
        }

        if (navigator.serviceWorker.controller && !sessionStorage.getItem(DEV_SW_RESET_KEY)) {
            sessionStorage.setItem(DEV_SW_RESET_KEY, "1");
            window.location.reload();
            return;
        }

        sessionStorage.removeItem(DEV_SW_RESET_KEY);
    };

    afterNavigate(async () => {
        const toFocus: HTMLElement | null =
            document.querySelector("[data-first-focus]");
        toFocus?.focus();

        if (!isRootRoute) {
            await getServerInfo();
        }
    });

    onMount(() => {
        preloadAssets = true;

        if ("serviceWorker" in navigator) {
            if (dev) {
                resetDevServiceWorkers().catch(() => {});
            } else {
                navigator.serviceWorker.register("/service-worker.js").catch(() => {});
            }
        }
    });
</script>

<svelte:head>
    <meta name="description" content={$t("general.embed.description")} />
    <meta property="og:description" content={$t("general.embed.description")} />

    {#if env.HOST}
        <meta
            property="og:url"
            content={`https://${env.HOST}${$page.url.pathname}`}
        />
    {/if}

    {#if device.is.mobile}
        <meta
            name="theme-color"
            content={statusBarColors.mobile[$currentTheme]}
        />
    {:else}
        <meta
            name="theme-color"
            content={statusBarColors.desktop[$currentTheme]}
        />
    {/if}
</svelte:head>

<div
    style="display: contents"
    data-theme={browser ? $currentTheme : undefined}
    lang={$locale}
>
    {#if preloadAssets}
        <div id="preload" aria-hidden="true">??</div>
    {/if}

    {#if isRootRoute}
        <div
            id="siphon-root-shell"
            class:loaded={browser}
            data-mobile={device.is.mobile}
            data-reduce-motion={reduceMotion}
            data-reduce-transparency={reduceTransparency}
        >
            <slot />
        </div>
    {:else}
        <div
            id="cobalt"
            class:loaded={browser}
            data-chrome={device.browser.chrome}
            data-iphone={device.is.iPhone}
            data-mobile={device.is.mobile}
            data-reduce-motion={reduceMotion}
            data-reduce-transparency={reduceTransparency}
        >
            {#if device.is.iPhone && app.is.installed}
                <NotchSticker />
            {/if}
            <DialogHolder />
            <Sidebar />
            {#if $updated}
                <UpdateNotification />
            {/if}
            <ProcessingQueue />
            <div id="content">
                <slot />
            </div>
        </div>
    {/if}
</div>

<style>
    #siphon-root-shell {
        min-height: 100vh;
        width: 100%;
        display: flex;
        justify-content: center;
        overflow: hidden;
        background: var(--siphon-bg-root);
        color: var(--text-primary);
    }

    #cobalt {
        height: 100%;
        width: 100%;
        display: grid;
        grid-template-columns:
            calc(var(--sidebar-width) + var(--sidebar-inner-padding) * 2)
            1fr;
        overflow: hidden;
        background-color: var(--sidebar-bg);
        color: var(--secondary);
        position: fixed;
    }

    @media screen and (orientation: landscape) and (min-width: 535px) {
        #cobalt[data-iphone="true"] {
            grid-template-columns:
                calc(
                    var(--sidebar-width) + var(--sidebar-inner-padding) * 2 +
                        env(safe-area-inset-left)
                )
                1fr;
        }

        #cobalt[data-iphone="true"] #content {
            padding-right: env(safe-area-inset-right);
        }
    }

    #content {
        display: flex;
        overflow: scroll;
        background-color: var(--primary);
        box-shadow: 0 0 0 var(--content-border-thickness) var(--content-border);
        margin-left: var(--content-border-thickness);
    }

    @media (display-mode: standalone) and (min-width: 535px)  {
        [data-mobile="false"] #content {
            margin-top: var(--content-border-thickness);
            border-top-left-radius: 8px;
        }

        [data-mobile="false"] #content:dir(rtl) {
            border-top-left-radius: 0;
            border-top-right-radius: 8px;
        }
    }

    #content:dir(rtl) {
        margin-left: 0;
        margin-right: var(--content-border-thickness);
    }

    @media screen and (max-width: 535px) {
        :global([data-theme="light"]) {
            --sidebar-bg: #000000;
            --sidebar-highlight: var(--primary);
        }

        #cobalt {
            display: grid;
            grid-template-columns: unset;
            grid-template-rows:
                1fr
                calc(
                    var(--sidebar-height-mobile) + var(--sidebar-inner-padding) * 2
                );
        }

        #content,
        #content:dir(rtl) {
            padding-top: env(safe-area-inset-top);
            order: -1;
            margin: 0;
            box-shadow: none;
            border-bottom-left-radius: calc(var(--border-radius) * 2);
            border-bottom-right-radius: calc(var(--border-radius) * 2);
        }
    }

    #preload {
        width: 0;
        height: 0;
        position: absolute;
        z-index: -10;
        content: url(/meowbalt/smile.png) url(/meowbalt/error.png)
            url(/meowbalt/question.png) url(/meowbalt/think.png);
        font-family: "Noto Sans Mono";
        font-size: 0;
        opacity: 0;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
    }
</style>
