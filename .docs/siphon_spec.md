# Siphon  Media Extraction for the Smart Lattice

*Draw content from the web into your ownership.*

---

## Overview

Siphon is a PWA frontend for a self-hosted Cobalt processing instance that extracts media from web platforms and saves it locally with structured metadata. It replaces the workflow of finding a sketchy web tool, uploading a URL to someone else's server, waiting through ads, and getting a bare file with a hash filename  with a single interface that pastes a URL, shows available qualities, downloads via your own infrastructure, and preserves the context around what you downloaded.

The processing backend is a standard Cobalt 10 Docker deployment on your server, protected by Cloudflare Turnstile and API key authentication (`API_AUTH_REQUIRED=1`). Siphon is the Lattice-native client layer: it adds quality selection UX, metadata preservation, download history with search, Distill integration for post-download compression, and an observation layer for usage patterns.

### Lattice Position

Siphon lives in the **Synapse System** cluster. Where Distill transforms media you already have and Murmur captures media from your voice, Siphon acquires media from the web. It handles the inbound direction of the data flow  pulling content from platforms into local ownership.

| Synapse Node | Direction | Function |
|---|---|---|
| **Siphon** | In (from web) | Acquires media from platforms |
| **Herald** | In (from services) | Catches incoming webhooks |
| **Murmur** | In (from voice) | Captures speech, routes to structure |
| **Distill** | Transform | Compresses media under constraints |
| **Conduit** | Bridge | Moves data between devices |
| **Echo** | Out (to services) | Sends API requests |
| **Vigil** | Control | Extends agent oversight to mobile |

### Core Metaphor

Siphoning  drawing fluid from one vessel into another through a tube, using natural pressure. Content flows from platforms into your local storage through your own pipe. The visual identity references this with steel-blue tones (fluid, cool, flowing) contrasting Distill's copper-amber (heat, pressure, transformation). They're complementary operations in the same material family.

---

## Design Principles (Siphon-Specific)

**Your infrastructure, your media.** The processing happens on your server. The files land on your device. The metadata stays in your local storage. Siphon never touches a third-party service beyond the source platform itself (via Cobalt's extraction engine).

**Context travels with the file.** Every download preserves structured metadata  source URL, platform, uploader, title, caption, original resolution, download timestamp. A bare MP4 with a hash filename is not a download; it's digital litter. Metadata makes downloads searchable, agent-readable, and meaningful months later.

**Quality is a choice, not a default.** Siphon presents all available qualities as selectable options with resolution, fps, format, codec, and estimated size visible upfront. The user makes an informed decision before any bytes transfer. No silent re-encoding, no hidden quality reduction.

**Lattice connections surface, never force.** When a downloaded file exceeds common sharing thresholds (25MB for Discord, 16MB for WhatsApp), Siphon surfaces the Distill integration as a contextual suggestion. It never auto-routes, never assumes. The user taps if they want it.

---

## Architecture

### System Topology

```

  Your Server (Docker)                           
    
    Cobalt 10 Instance                         
        
      Protection Stack                       
      - Cloudflare Turnstile (bot gate)      
      - API_AUTH_REQUIRED=1                  
      - Per-key rate limiting                
      - JWT token issuance                   
        
        
      Extraction Engine                      
      - Platform resolvers                   
      - Stream download + muxing             
      - Format negotiation                   
        
    

                       
                        HTTPS
                        Authorization: Api-Key <uuid>
                       
       
                                     
          
    Phone       Desktop        Forge   
    PWA          PWA           CLI     
                                       
   Siphon       Siphon        siphon() 
   Client       Client        block    
          
```

The Siphon PWA is a single codebase that works identically on phone and desktop browsers. No native app, no companion binary, no capability gaps between surfaces. All extraction happens server-side via the Cobalt instance.

### Backend: Cobalt Instance

Standard Cobalt 10 Docker deployment. Siphon requires no modifications to Cobalt itself  it consumes the public API as documented.

**Required environment configuration:**

```yaml
environment:
  API_URL: "https://siphon.yourserver.dev/"
  API_AUTH_REQUIRED: 1
  TURNSTILE_SITEKEY: "<your-cloudflare-turnstile-sitekey>"
  TURNSTILE_SECRET: "<your-cloudflare-turnstile-secret>"
  JWT_SECRET: "<random-64-char-alphanumeric-string>"
  RATELIMIT_WINDOW: 60
  RATELIMIT_MAX: 25
```

**API key file** (`keys.json`):

```json
{
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
    "name": "asier-personal",
    "limit": "unlimited"
  },
  "b2c3d4e5-f6a7-8901-bcde-f12345678901": {
    "name": "friend-1",
    "limit": 50
  },
  "c3d4e5f6-a7b8-9012-cdef-123456789012": {
    "name": "friend-2",
    "limit": 50
  }
}
```

Each user gets their own UUIDv4 key. The `name` field is for your reference only. The `limit` field controls requests per rate-limit window  `"unlimited"` for your personal key, a reasonable cap for friends. No IP restrictions needed; the combination of Turnstile + API key + rate limiting is sufficient for a 3-person instance.

**Security model summary:**
1. Instance URL is unpublished (obscurity as first layer, not sole layer).
2. Cloudflare Turnstile blocks all automated/scripted requests.
3. `API_AUTH_REQUIRED=1` rejects any request without a valid API key or Turnstile-issued JWT.
4. Per-key rate limits cap usage even with a valid key.
5. An attacker would need to: discover the URL, solve Turnstile programmatically (Cloudflare's business to prevent), and possess a 128-bit UUID.

### Frontend: Siphon PWA

**Technology stack:**
- React (or Preact for smaller bundle) + TypeScript
- Service Worker for offline shell, share target registration, and caching
- IndexedDB for download history and metadata storage
- PWA manifest for installability on both Android and desktop

**Data flow for a download:**

1. User pastes URL into the input field (or shares via Android share sheet).
2. Siphon sends a POST to the Cobalt instance's `/` endpoint with the URL and `Authorization: Api-Key <uuid>` header.
3. Cobalt resolves the source, returns one of:
   - `tunnel`: a proxied download URL on the Cobalt instance
   - `redirect`: a direct URL to the source platform's CDN
   - `picker`: multiple items (e.g., carousel posts) requiring user selection
4. Siphon presents available qualities to the user.
5. User selects a quality. Siphon initiates the download (fetch with progress tracking via `ReadableStream`).
6. On completion: file is saved to device, metadata sidecar is written to IndexedDB.

**Cobalt API request format:**

```json
POST /
Authorization: Api-Key a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json

{
  "url": "https://x.com/user/status/1893726485012",
  "videoQuality": "1080",
  "filenameStyle": "pretty",
  "downloadMode": "auto"
}
```

The `videoQuality` parameter accepts: `"144"`, `"240"`, `"360"`, `"480"`, `"720"`, `"1080"`, `"1440"`, `"2160"`, `"4320"`, `"max"`. Siphon presents these as human-readable option cards rather than raw numbers.

**Cobalt API response types:**

`tunnel` response (most common):
```json
{
  "status": "tunnel",
  "url": "https://siphon.yourserver.dev/tunnel?id=...",
  "filename": "Video Title - Author (1080p).mp4"
}
```

`picker` response (carousels, multi-image posts):
```json
{
  "status": "picker",
  "audio": "https://...",
  "picker": [
    { "type": "photo", "url": "https://..." },
    { "type": "video", "url": "https://...", "thumb": "https://..." }
  ]
}
```

`error` response:
```json
{
  "status": "error",
  "error": {
    "code": "error.api.fetch.empty"
  }
}
```

### Local Storage Model

**Settings** (stored in `localStorage`  only two values, low risk):
```typescript
interface SiphonSettings {
  instanceUrl: string;      // e.g. "https://siphon.yourserver.dev"
  apiKey: string;           // UUIDv4
  saveMetadata: boolean;    // default: true
  downloadPath: string;     // display-only; actual path controlled by browser
}
```

**Download History** (stored in IndexedDB, `siphon-history` database):
```typescript
interface DownloadRecord {
  id: string;                    // crypto.randomUUID()
  timestamp: number;             // Unix ms
  sourceUrl: string;             // original URL pasted by user
  platform: string;              // "youtube", "twitter", "instagram", etc.
  title: string;                 // video/post title
  uploader: string;              // channel name, username, handle
  uploadDate: string | null;     // original upload date if available
  duration: string | null;       // "3:42" format, null for images
  selectedQuality: string;       // "1080p", "720p", "audio", etc.
  resolution: string | null;     // "1920x1080"
  fps: number | null;
  format: string;                // "MP4", "WEBM", "MP3"
  codec: string;                 // "H.264", "VP9", "MP3 320k"
  fileSize: number;              // bytes (actual, post-download)
  filename: string;              // as returned by Cobalt
  metadata: Record<string, any>; // platform-specific extras (caption, hashtags, etc.)
}
```

The IndexedDB store is indexed on `timestamp`, `platform`, `uploader`, and `title` for efficient search and filtering.

### Metadata Sidecar

When "Save metadata sidecar" is enabled (default: on), Siphon generates a `.json` file alongside each download:

```json
{
  "siphon": {
    "version": 1,
    "downloadedAt": "2026-03-07T09:41:00Z",
    "instanceUrl": "https://siphon.yourserver.dev"
  },
  "source": {
    "url": "https://x.com/devtoolsweekly/status/1893726485012",
    "platform": "twitter",
    "title": "The future of developer tooling is not what you think",
    "uploader": "@devtoolsweekly",
    "uploadDate": "2026-03-05",
    "duration": "3:42"
  },
  "output": {
    "quality": "1080p",
    "resolution": "1920x1080",
    "fps": 30,
    "format": "MP4",
    "codec": "H.264",
    "fileSize": 195428352,
    "filename": "The future of developer tooling - devtoolsweekly (1080p).mp4"
  }
}
```

The sidecar filename matches the media file: `<filename>.siphon.json`. This file is what makes downloads agent-queryable  an agent can scan a directory of siphon files and answer "what was that Rust async video I downloaded last week?" by reading the sidecars.

---

## Visual Design

### Identity

**Name:** Siphon
**Tagline:** Media Extraction. (Shown as monospaced subtitle beneath the app title.)
**App icon concept:** A downward-pointing chevron or funnel shape  content flowing downward into your storage. Steel-blue on dark. Geometric, clean.

### Palette

Steel-blue accent on near-black ground. The blue references fluid, flow, coolness  the complement to Distill's copper heat. The two palettes are designed to sit side-by-side without clashing; they share the same dark ground and the same relationship between accent and neutral.

```
--bg-root:        #08080A      (environment background)
--bg-surface:     #0F0F12      (primary surface)
--bg-raised:      rgba(255, 255, 255, 0.025)  (input fields, cards)
--bg-hover:       rgba(255, 255, 255, 0.04)   (interactive hover)

--accent:         #7EB8D4      (steel-blue  primary action, progress, links)
--accent-muted:   rgba(126, 184, 212, 0.07)   (accent backgrounds)
--accent-border:  rgba(126, 184, 212, 0.25)   (accent borders)
--accent-focus:   rgba(126, 184, 212, 0.30)   (input focus ring)
--accent-glow:    rgba(126, 184, 212, 0.04)   (selected card fill)

--distill-accent: #D4A574      (copper  used only for Distill integration banners)
--distill-muted:  rgba(212, 165, 116, 0.04)
--distill-border: rgba(212, 165, 116, 0.12)

--text-primary:   rgba(255, 255, 255, 0.75)
--text-secondary: rgba(255, 255, 255, 0.45)
--text-tertiary:  rgba(255, 255, 255, 0.25)
--text-ghost:     rgba(255, 255, 255, 0.12)

--border:         rgba(255, 255, 255, 0.05)
--border-hover:   rgba(255, 255, 255, 0.08)

--success:        #4ADE80
--error:          #EF4444
--audio-accent:   #B8A0D4      (purple tint for audio-only options)
```

**Distill cross-reference rule:** Distill's copper accent (`--distill-accent`) appears only on Distill integration banners  the "Distill after download?" and "Distill to share" cards. It never contaminates Siphon's own UI elements. This visual bleed is intentional: it signals a handoff to another Lattice node.

### Typography

Three-font system, distinct from Distill but following the same pattern (serif display, sans body, mono data).

| Role | Font | Weight | Usage |
|---|---|---|---|
| Display | Newsreader | 400500 | App title ("Siphon"), download size stat on completion screen. Literary serif with a different character than Distill's Playfair  more fluid, less formal. |
| Body | DM Sans | 300600 | Labels, descriptions, button text, video titles, source info. Shared with Distill for ecosystem coherence. |
| Data | IBM Plex Mono | 300500 | All metadata: URLs, filenames, resolutions, sizes, dates, section labels, quality labels, connection status, API keys. Different texture than Distill's DM Mono  slightly wider, more technical. |

**Section labels:** IBM Plex Mono, 9px, `--text-ghost`, uppercase, letter-spacing 1.5px. Consistent pattern across all screens.

**Video titles:** DM Sans, 1214px, `--text-secondary` or `--text-primary` depending on context. Single-line with ellipsis truncation on list items; multi-line (max 2) on source cards.

### Spacing & Layout

380dp mobile viewport target. All values in dp.

```
Screen horizontal padding:          20
Card internal padding:              14
Card border-radius:                 12
Card border:                        1px solid var(--border)

Section label margin-top:           22
Section label margin-bottom:        10

Quality card padding:               11 horizontal, 12 vertical
Quality card border-radius:         10
Quality card gap (internal):        14
Quality card margin-bottom:         6

Input field padding:                14 horizontal, 16 vertical
Input field border-radius:          12
Input field caret-color:            var(--accent)

Button padding:                     14 vertical
Button border-radius:               12
Button margin-top:                  16

Source card thumbnail height:       160
Source card info padding:           14

History item padding:               10 vertical
History item thumbnail:             52  30 (list), 64  36 (expanded)

Settings overlay padding:           60 top (clear of close button), 20 sides

Connection dot diameter:            6
Platform badge font-size:           1012

Progress bar height:                2
```

### Motion

All animations CSS-only. Same mechanical precision as Distill  no spring physics, no playful bounces.

| Animation | Duration | Easing | Trigger |
|---|---|---|---|
| Screen enter (sFadeUp) | 300350ms | ease | Screen transitions |
| Card stagger | 200ms + (index  50ms) | ease | List population |
| Loading shimmer | 1200ms loop | ease | URL resolution pending |
| Progress bar fill | continuous | linear | Download progress |
| Settings overlay (sSlideUp) | 300ms | ease | Settings open |
| Completion check (sScaleIn) | 400ms | custom (overshoot 60%) | Download complete |
| Hover transitions | 200ms | ease | All interactive elements |
| Connection dot color | 300ms | ease | Status change |
| Test result appear | 200ms | ease | After connection test |

**sFadeUp keyframe:**
```css
@keyframes sFadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

**sSlideUp keyframe:**
```css
@keyframes sSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

**sScaleIn keyframe:**
```css
@keyframes sScaleIn {
  0%   { transform: scale(0.5); opacity: 0; }
  60%  { transform: scale(1.06); }
  100% { transform: scale(1); opacity: 1; }
}
```

**Loading shimmer keyframe:**
```css
@keyframes sShimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
```

The shimmer is a 40%-width gradient bar (`transparent  var(--accent)  transparent`) sliding across a 2px track. It appears immediately when a URL is pasted and disappears when the source resolves or errors.

---

## Screens

### 1. Main Screen

The landing screen and primary entry point.

**Header row:** Left side: app title "Siphon" (Newsreader, 24px, `#C8D6E0`) with "Media Extraction" subtitle (IBM Plex Mono, 10px, `--text-ghost`, uppercase). Right side: two icon buttons  " history" and "" (settings). Both use IBM Plex Mono, 10px, `--text-tertiary`.

**URL input:** Full-width, below header with 24dp margin-top. Placeholder: "Paste a URL" (IBM Plex Mono, 13px, `--text-ghost`). Right-aligned "Paste" button inside the input container (reads clipboard on tap). Input field has a subtle focus ring: border-color transitions to `--accent-focus`, background tints to `rgba(126,184,212,0.03)`. Caret color: `--accent`.

**Behavior on URL entry:** As soon as a valid URL is detected (starts with `http`), a 2px shimmer loading bar appears below the input. Siphon sends the URL to the Cobalt instance. On success, transitions to the Select Quality screen. On error, the loading bar turns red and an inline error message appears below the input (IBM Plex Mono, 11px, `--error`). Common errors: "Source not supported", "Instance unreachable", "Rate limit exceeded".

**Supported platforms section:** Section label "Supported". Horizontal flex-wrap of small platform chips, each showing the platform icon (colored at 60% opacity) and name. These are informational, not interactive  they tell the user what they can paste. Platforms: YouTube, Twitter, Instagram, Reddit, TikTok, and others as supported by the Cobalt instance.

**Recent downloads section:** Section label "Recent". Up to 5 most recent downloads from IndexedDB. Each row:
- Thumbnail (52  30dp, canvas-rendered platform-colored abstract).
- Title (DM Sans, 12px, `--text-secondary`, single-line ellipsis).
- Below title: platform badge + uploader (IBM Plex Mono, 9px, `--text-tertiary`) + dot separator + quality + size (IBM Plex Mono, 9px, `--text-ghost`).
- Right-aligned: date (IBM Plex Mono, 9px, `--text-ghost`).
- Separated by 1px borders (`rgba(255,255,255,0.025)`), last item no border.
- Tapping a row triggers a re-download flow for that URL (navigates to select quality with the source pre-resolved).

**Stagger animation:** Recent items enter with sFadeUp staggered at 60ms intervals.

**Empty state (first launch):** If no download history exists, the Recent section is replaced with a centered message: "Paste a URL above or share from any app" (IBM Plex Mono, 11px, `--text-tertiary`).

### 2. Select Quality Screen

Shown after the Cobalt instance successfully resolves a URL.

**Back button:** " back" (IBM Plex Mono, 11px, `--text-tertiary`), 14dp margin-bottom. Returns to main screen, clears state.

**Source card:** Full-width card with two zones:
- **Thumbnail zone:** Full card width, 160dp height, dark background. Contains a canvas-rendered abstract representing the video (platform-colored geometric shapes suggesting content). If the Cobalt response includes a thumbnail URL, this is replaced with the actual thumbnail loaded via `<img>`. Duration badge in bottom-right corner (IBM Plex Mono, 10px, `rgba(255,255,255,0.6)` on `rgba(0,0,0,0.7)` background, border-radius 4, padding 2/6).
- **Info zone:** 14dp padding. Video title (DM Sans, 14px, `--text-primary`, font-weight 500, line-height 1.35, max 2 lines). Below: metadata row with platform badge icon + uploader name + dot separator + upload date (all IBM Plex Mono, 11px, `--text-tertiary`).

**Quality options:** Section label "Quality". Each option is a horizontal card:
- **Quality label** (IBM Plex Mono, 14px, `--text-primary`, weight 500, min-width 62dp): "1080p60", "1080p", "720p", "480p", "Audio", etc.
- **Metadata column:** Resolution + fps line (IBM Plex Mono, 10px, `--text-tertiary`): "19201080  30fps". Below: format and codec tags.
- **Size** (right-aligned, IBM Plex Mono, 12px, `--text-secondary`): "420 MB", "1.8 GB", "17.8 MB", etc.

**Tags:** Small pill-shaped labels. Format tag ("MP4", "WEBM", "MP3") in `--text-tertiary` with subtle border. Audio-only tag ("Audio only") in purple accent (`--audio-accent`) with matching border. Tags are 9px IBM Plex Mono with 3/8 padding and 4px border-radius.

**Selected state:** Active quality card gets `--accent-border` and `--accent-glow` background, matching the Distill pattern but in blue.

**Audio-only option:** For platforms that support it (YouTube primarily), an audio extraction option appears at the bottom of the quality list. Label shows "Audio", metadata shows codec ("MP3 320k" or "AAC 256k"), and an `--audio-accent` tag reads "Audio only". The size is typically much smaller, which should be visually obvious from the right-aligned number.

**Distill integration banner:** Conditionally appears below the quality list when the selected option's size exceeds 25MB (Discord's free tier limit  the most common compression trigger). The banner uses Distill's copper palette exclusively:
- Left: diamond icon () in `--distill-accent` at 50% opacity.
- Center: "Distill after download?" (DM Sans, 11px, `--distill-accent` at 80% opacity) with subtitle "Compress for Discord, WhatsApp, etc." (IBM Plex Mono, 9px, `--distill-accent` at 40% opacity).
- Right: arrow "" (IBM Plex Mono, 10px, `--distill-accent` at 30% opacity).
- Card background: `--distill-muted`, border: `--distill-border`.
- The banner is non-blocking. Tapping it queues a Distill handoff after download completes  Siphon stores the intent and, on completion, offers Distill as the primary action instead of Share.

**Download button:** Full-width, same pattern as Distill's compress button but in steel-blue. Label: "Download  {size}" where size is the selected option's estimated file size. Disabled when no quality is selected. Triggers transition to downloading screen.

**Picker response handling:** When Cobalt returns a `picker` status (carousel posts, multi-image threads), the quality selection is replaced with a grid of items. Each item shows a thumbnail (if available), type badge ("photo", "video", "gif"), and a select toggle. The user can select individual items or "Download All". Selected items download sequentially.

### 3. Downloading Screen

Centered layout, entered via sFadeUp transition.

**Title:** "Extracting" (Newsreader, 18px, `#C8D6E0`).

**Thumbnail:** 200  113dp centered, border-radius 8, 1px `--border`. Shows the source thumbnail (abstract or real).

**Config summary:** "{quality}  {format}  {codec}" (IBM Plex Mono, 11px, `--text-tertiary`).

**Progress percentage:** IBM Plex Mono, 28px, `--accent`, weight 500. Updates from the download stream's progress events.

**Progress bar:** 240dp max-width centered, 2px height, gradient fill (`#5A9AB5  #7EB8D4`). Linear transition matching actual byte progress.

**Status phases:** Below the progress bar, a text label (IBM Plex Mono, 10px, `--text-ghost`) shows the current operation:
- 015%: "Resolving source" (Cobalt is processing the URL, negotiating with the platform)
- 1585%: "{downloaded} / {total} MB" (actual byte transfer with running totals)
- 8598%: "Muxing streams" (Cobalt is combining separate video/audio DASH streams)
- 98100%: "Finalizing"

These phases reflect what Cobalt actually does, not an artificial smoothing. The progress may jump from 0 to 15% quickly (resolution is fast) and stall at 85% briefly (muxing takes time for large files). This is honest about the process.

**No cancel in Phase 1.** Phase 2 adds a subtle " cancel" below the status text.

### 4. Completion Screen

Entered via sFadeUp after download finishes.

**Checkmark:** 56dp circle, 2px border `rgba(126,184,212,0.35)`, centered "" (downward arrow, not a checkmark  referencing the siphon direction) in `--accent` at 24px. Enters with sScaleIn animation.

**"Saved" label:** Section label style, centered.

**Size stat:** Newsreader, 36px, `--accent`, centered. Shows the actual downloaded file size (measured from the completed transfer, not the estimate). This is the hero number.

**Quality summary:** IBM Plex Mono, 11px, `--text-tertiary`. "{quality}  {format}  {codec}".

**Metadata card:** A structured display of preserved metadata. Full-width card with `--bg-raised` background, `--border`, border-radius 10. Four rows separated by 1px internal borders:
1. **Title:** Full video/post title.
2. **Source:** Platform name + uploader handle.
3. **Duration:** Video duration, or "Image" / "Audio" for non-video content.
4. **Downloaded:** Full timestamp ("March 7, 2026  9:41 AM").

Each row: label (section label style, 9px) + value (DM Sans, 12px, `--text-secondary`, line-height 1.3). Padding 10/14 per row.

This card visually demonstrates the metadata preservation feature. The user sees exactly what information was captured alongside their file.

**Distill integration banner (conditional):** Same copper-accented banner as the select screen, but with updated copy: "Distill to share" / "Compress for Discord, WhatsApp, etc." Only shown when file size exceeds 25MB.

**Action buttons (stacked):**
1. **Share**  accent style (`--accent-muted` background, `--accent-border`, `--accent` text). Opens the browser/OS share sheet with the downloaded file.
2. **Open File**  neutral style (`rgba(255,255,255,0.04)` background, `--text-secondary`). Opens the file in the default handler.
3. **Siphon Another**  neutral style. Returns to main screen, clears state.

**Navigation pill:** 36  4dp, `rgba(255,255,255,0.08)`, centered, 14dp margin-top.

### 5. Settings Overlay

Full-screen overlay triggered by the gear icon. Covers the entire phone frame with a dark scrim (`rgba(0,0,0,0.88)`) and slides up (sSlideUp animation). Close button () in top-right corner.

**Header:** "Settings" (Newsreader, 20px) with "Instance Connection" subtitle.

#### Instance Configuration

**Instance URL field:**
- Label: "Instance URL" (field label style).
- Input: full-width, IBM Plex Mono 12px, placeholder "https://your-instance.example.com".
- Hint: "Your Cobalt-compatible processing server" (IBM Plex Mono, 9px, `--text-ghost`).

**API Key field:**
- Label: "API Key" (field label style).
- Input: full-width, IBM Plex Mono 11px, letter-spacing 0.5px, placeholder "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".
- Hint: "UUIDv4 key assigned by the instance owner" (IBM Plex Mono, 9px, `--text-ghost`).

**Test Connection button:** Full-width accent button. On tap, sends a GET request to the instance's `/` health endpoint with the API key header. Three states:
- Default: "Test Connection"
- Testing: "Testing" (button text changes, no spinner)
- Success: Button returns to default. Below it, a green indicator card appears (sFadeUp): green connection dot + "Connected  v{version}  {serviceCount} services" (IBM Plex Mono, 10px, `--success`). Card has green-tinted background and border. Fades out after 2.5 seconds.
- Failure: Red indicator card: red dot + error message ("Instance unreachable", "Invalid API key", "Authentication required"). Persists until dismissed.

The health endpoint returns instance version and supported services, which are displayed in the success indicator to confirm the right instance is connected.

#### Status Section

Below a subtle divider (1px `rgba(255,255,255,0.03)`).

**Status row:** Connection dot (6dp, green or red) + "Connected" or "Disconnected" (IBM Plex Mono, 12px, `--text-secondary`). The connection status is checked on app launch and periodically (every 5 minutes) via a lightweight health ping.

**Instance row:** Shows the configured instance domain stripped of protocol (IBM Plex Mono, 11px, `--text-tertiary`). e.g., "siphon.yourserver.dev".

**Key row:** Shows the API key masked: first 8 characters visible, middle sections replaced with bullets, last 4 visible. e.g., "a1b2c3d4----7890" (IBM Plex Mono, 11px, `--text-tertiary`).

#### Preferences Section

Below another subtle divider.

**Download Location (display-only):** Shows "~/Downloads/Siphon/" or the browser's default download path. Not editable in the PWA (browser controls this).

**Metadata toggle:** A small toggle switch (28  16dp, border-radius 8) with label "Save metadata sidecar" (IBM Plex Mono, 11px, `--text-tertiary`). Default: on. When on, the toggle track is `rgba(126,184,212,0.3)` with an `--accent` thumb. When off, track is `rgba(255,255,255,0.08)` with a gray thumb.

### 6. History Screen

Accessible from the " history" button on the main screen. Replaces the main screen content (same container, not an overlay).

**Back button:** " back", returns to main screen.

**Header:** "History" (Newsreader, 20px). Below: aggregate stats  "{count} downloads  {totalSize} total" (IBM Plex Mono, `--text-ghost`).

**Search input:** Full-width, 14dp margin-top. Placeholder "Search downloads" (IBM Plex Mono, 12px). Searches across title, uploader, platform, and date fields in IndexedDB.

**Download list:** Full history from IndexedDB, most recent first. Each row:
- Thumbnail (64  36dp).
- Title (DM Sans, 13px, `--text-secondary`, single-line ellipsis).
- Platform badge + uploader (IBM Plex Mono, 10px, `--text-tertiary`).
- Right column: size (IBM Plex Mono, 11px, `--text-tertiary`) and quality + date below (IBM Plex Mono, 9px, `--text-ghost`).

Stagger animation on list items. Rows are separated by 1px borders.

**Future (Phase 2):** Platform filter tabs above the list. Delete/clear history. Export history as JSON.

---

## PWA Configuration

### Manifest

```json
{
  "name": "Siphon",
  "short_name": "Siphon",
  "description": "Media extraction for the Smart Lattice",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#08080A",
  "theme_color": "#0F0F12",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "application/x-www-form-urlencoded",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

The `share_target` registration is critical for the mobile experience. When installed as a PWA on Android, Siphon appears in the system share sheet. Sharing a URL from Twitter, Reddit, or any app sends the URL directly to Siphon, which extracts it from the share payload and begins resolution immediately  skipping the paste step entirely.

### Service Worker

The Service Worker handles:
1. **App shell caching:** HTML, CSS, JS, fonts cached on install for instant load.
2. **Share target interception:** Catches incoming share intents at the `/share` route, extracts the URL, and redirects to the main app with the URL pre-filled.
3. **Offline shell:** If the network is unavailable, the app loads with the cached shell and shows an "Instance unreachable" status. History is still browsable (served from IndexedDB). New downloads are not possible without network.
4. **Background fetch (Phase 2):** For large downloads, the Service Worker can manage the fetch in the background, allowing the user to close the app tab and return when the download is complete.

---

## Error Handling

| Error | Display | Recovery |
|---|---|---|
| Instance unreachable | Red connection dot in status bar. Inline message below input: "Instance unreachable  check Settings" | User opens settings, verifies URL, runs Test Connection |
| Invalid API key | Inline error: "Authentication failed  check your API key" | User opens settings, corrects key |
| Rate limit exceeded | Inline error: "Rate limit  try again in {seconds}s" | Automatic retry after cooldown; countdown shown |
| Source not supported | Inline error: "This URL isn't supported" | User tries a different URL |
| Source unavailable | Inline error: "Content unavailable or removed" | Nothing to recover; content is gone |
| Download interrupted | Progress bar turns red. "Download failed  tap to retry" | Tap retries from the beginning (no resume in Phase 1) |
| Picker with no items | Inline message: "No downloadable media found at this URL" | User verifies the URL has media content |

All error messages use IBM Plex Mono, 11px, `--error` for the message text. Error states clear when the user starts a new action.

---

## Observation Store

### Schema

```sql
CREATE TABLE downloads (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT,
  uploader TEXT,
  selected_quality TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  format TEXT NOT NULL,
  codec TEXT NOT NULL,
  duration_seconds REAL,
  download_duration_ms INTEGER NOT NULL,
  source_app TEXT
);
```

Note: this mirrors the IndexedDB `DownloadRecord` but lives as a separate analytical store. In Phase 1, IndexedDB is the sole storage and doubles for both history display and observation queries. In Phase 2, if the observation layer needs more complex aggregation, a dedicated SQLite store (via sql.js in the browser) can be introduced.

### Derived Signals

Computed on read from the download history:

- `mostUsedPlatform`: Platform with highest download count in last 30 days.
- `preferredQuality`: Modal quality selection across all downloads (e.g., "1080p" if that's what the user picks most often).
- `downloadFrequency`: Average downloads per day over last 14 days.
- `platformDistribution`: Percentage breakdown by platform.
- `peakUsageHours`: Most common hour-of-day for downloads.
- `averageFileSize`: Mean file size across all downloads.
- `totalStorageUsed`: Sum of all downloaded file sizes.

These signals are readable by agents via the Forge CLI `siphon` block's `--stats` flag or via Nexus tool API integration in Phase 3.

---

## Forge Integration

### `siphon` Block

A backend-style Forge block that wraps the Cobalt API. Requires a configured instance URL and API key (read from `~/.forge/config.json` or environment variables `SIPHON_INSTANCE_URL` and `SIPHON_API_KEY`).

**Block contract:**

```
Block ID: siphon
Category: media

Input Port:  text (URL string)
Output Port: file (downloaded media) in download mode
             json (source info + available qualities) in analyze mode

Config Schema:
  url:       string   source URL to extract
  quality:   string   "max", "2160", "1080", "720", "480", "360", "audio" (default: "1080")
  analyze:   boolean  if true, return available qualities without downloading (default: false)
  metadata:  boolean  save .siphon.json sidecar alongside output (default: true)
```

**CLI usage:**

```bash
# Download at default quality
forge express "siphon(url=https://x.com/user/status/123)" --output video.mp4

# Download audio only
forge express "siphon(url=https://youtube.com/watch?v=abc, quality=audio)" --output audio.mp3

# Analyze available qualities (agent-friendly)
forge express "siphon(url=https://youtube.com/watch?v=abc, analyze=true)" --json-output

# Pipeline: download then compress
forge express "siphon(url=https://x.com/user/status/123) -> distill(target=discord)" --output compressed.mp4

# Pipeline: download, compress, and output metadata
forge express "siphon(url=https://youtube.com/watch?v=abc, quality=1080) -> distill(target=25MB)" --output video.mp4
```

**Analyze mode output:**

```json
{
  "success": true,
  "result": {
    "type": "siphon-analysis",
    "source": {
      "url": "https://youtube.com/watch?v=abc",
      "platform": "youtube",
      "title": "Building a personal tool ecosystem",
      "uploader": "Lattice Dev",
      "duration": "18:24"
    },
    "qualities": [
      { "id": "2160", "label": "4K", "width": 3840, "height": 2160, "fps": 60, "format": "MP4", "codec": "H.264", "estimatedSize": 1930000000 },
      { "id": "1080", "label": "1080p", "width": 1920, "height": 1080, "fps": 30, "format": "MP4", "codec": "H.264", "estimatedSize": 440000000 },
      { "id": "720", "label": "720p", "width": 1280, "height": 720, "fps": 30, "format": "MP4", "codec": "H.264", "estimatedSize": 220000000 },
      { "id": "audio", "label": "Audio", "width": 0, "height": 0, "fps": 0, "format": "MP3", "codec": "MP3 320k", "estimatedSize": 18700000 }
    ]
  },
  "timing": { "total_ms": 820 },
  "warnings": []
}
```

An agent can inspect available qualities, choose one based on constraints (e.g., "pick the highest quality under 500MB"), and invoke the download in a second call with that specific quality. The `siphon  distill` pipeline is the canonical cross-node agent workflow.

---

## Phased Implementation

### Phase 1  Core PWA

Deliverables:
1. PWA shell: React app with Service Worker, manifest, offline-capable cached shell.
2. Settings screen: instance URL + API key fields, Test Connection, connection status display.
3. Main screen: URL input with paste button, supported platforms display, recent downloads list.
4. Cobalt API integration: POST to instance with URL and quality, handle tunnel/redirect/picker/error responses.
5. Quality selection screen: source card with metadata, quality option cards, download button.
6. Download screen: progress with byte-level tracking, status phase labels.
7. Completion screen: size stat, metadata card, share/open/reset actions.
8. Share target registration: appear in Android share sheet, extract URLs from share intents.
9. IndexedDB history: store every download with full metadata, power the recent list and history screen.
10. Metadata sidecar generation: `.siphon.json` files alongside downloads.
11. History screen: searchable download log with platform badges and metadata.
12. Distill integration banner: conditional copper-accented card on select and completion screens.

Out of scope for Phase 1: observation signals, platform filter tabs, background fetch, download resume, picker grid UI (handle as single-item only), Forge block, batch downloads.

### Phase 2  Polish + Observation

Deliverables:
1. Picker/carousel UI: grid display for multi-item responses, select-all / individual selection.
2. Observation signals: compute derived stats from download history.
3. Adaptive quality default: pre-select the user's most commonly chosen quality instead of always defaulting to second-best.
4. Platform filter tabs on history screen.
5. Background fetch via Service Worker for large downloads.
6. Cancel mid-download.
7. Delete/clear history entries.
8. Export history as JSON.
9. Re-download from history (tap a history item to re-resolve and download again).
10. Download resume on interruption (Range header support, dependent on Cobalt tunnel behavior).

### Phase 3  Ecosystem

Deliverables:
1. Forge `siphon` block (CLI): download and analyze modes.
2. `siphon  distill` pipeline validation.
3. Distill deep integration: tapping the Distill banner on completion passes the file directly to Distill (if installed as PWA on the same device; otherwise opens Distill's URL with a file reference).
4. Agent-readable observation signals via Forge `--stats` or Nexus tool API.
5. Conduit bridge: download on desktop, receive on phone (or vice versa) via Conduit's transfer mechanism.
6. Platform preset sharing with Distill: Siphon knows what platform the content came from; Distill knows what platform you want to share to. The metadata chain enables "downloaded from Twitter, compress for Discord" as a one-decision flow.

---

## Agent Interface

### Query Patterns

An agent with access to Siphon's history (via Forge CLI or Nexus tool API) can:

- **Search downloads:** "Find the Rust async video I downloaded last week"  search history by title/uploader keywords + date range.
- **Read observation signals:** "What platforms does the user download from most?"  `mostUsedPlatform`, `platformDistribution`.
- **Invoke extraction:** `forge express "siphon(url=..., quality=720)"`  download to local filesystem.
- **Plan extraction:** `forge express "siphon(url=..., analyze=true)" --json-output`  get available qualities for decision-making.
- **Compose workflows:** `siphon(url=...)  distill(target=discord)`  download and compress in one pipeline.
- **Read metadata sidecars:** Scan `~/Downloads/Siphon/*.siphon.json` for structured download context.
