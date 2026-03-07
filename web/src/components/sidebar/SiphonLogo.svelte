<div id="siphon-logo" aria-label="Siphon">
    <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="presentation">
            <path d="M10 14h44l-13 16v12L32 50l-9-8V30L10 14Z" />
        </svg>
    </div>
    <div class="wordmark">
        <span class="name">siphon</span>
        <span class="tag">media extraction</span>
    </div>
</div>

<style>
    #siphon-logo {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        padding: calc(var(--sidebar-tab-padding) * 2);
        padding-bottom: calc(var(--sidebar-tab-padding) * 2 - var(--sidebar-inner-padding));
    }

    .mark {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        background: rgba(126, 184, 212, 0.12);
        box-shadow: inset 0 0 0 1px rgba(126, 184, 212, 0.24);
        display: grid;
        place-items: center;
    }

    .mark :global(svg) {
        width: 22px;
        height: 22px;
        fill: var(--sidebar-highlight);
    }

    .wordmark {
        display: flex;
        flex-direction: column;
        line-height: 1;
        text-transform: uppercase;
    }

    .name {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.18em;
    }

    .tag {
        font-size: 9px;
        color: var(--gray);
        letter-spacing: 0.12em;
        margin-top: 5px;
    }

    @media screen and (max-width: 535px) {
        #siphon-logo {
            display: none;
        }
    }
</style>
