import type { RecursivePartial } from "$lib/types/generic";
import type {
    PartialSettings,
    AllPartialSettingsWithSchema,
    CobaltSettingsV3,
    CobaltSettingsV4,
    CobaltSettingsV5,
    CobaltSettingsV6,
    CobaltSettingsV7,
} from "$lib/types/settings";
import { getBrowserLanguage } from "$lib/settings/audio-sub-language";

type Migrator = (s: AllPartialSettingsWithSchema) => AllPartialSettingsWithSchema;

const migrations: Record<number, Migrator> = {
    [3]: (settings: AllPartialSettingsWithSchema) => {
        const out = settings as RecursivePartial<CobaltSettingsV3>;
        out.schemaVersion = 3;

        if (settings?.save && "youtubeDubBrowserLang" in settings.save) {
            if (settings.save.youtubeDubBrowserLang) {
                out.save!.youtubeDubLang = getBrowserLanguage();
            }

            delete settings.save.youtubeDubBrowserLang;
        }

        return out as AllPartialSettingsWithSchema;
    },

    [4]: (settings: AllPartialSettingsWithSchema) => {
        const out = settings as RecursivePartial<CobaltSettingsV4>;
        const legacy = settings as RecursivePartial<CobaltSettingsV4>;
        out.schemaVersion = 4;

        if (legacy.processing) {
            if ("allowDefaultOverride" in legacy.processing) {
                delete legacy.processing.allowDefaultOverride;
            }
            if ("seenOverrideWarning" in legacy.processing) {
                delete legacy.processing.seenOverrideWarning;
            }
        }

        return out as AllPartialSettingsWithSchema;
    },

    [5]: (settings: AllPartialSettingsWithSchema) => {
        const out = settings as RecursivePartial<CobaltSettingsV5>;
        const legacy = settings as RecursivePartial<CobaltSettingsV5>;
        out.schemaVersion = 5;

        if (settings?.save) {
            if ("tiktokH265" in settings.save) {
                out.save!.allowH265 = settings.save.tiktokH265;
                delete settings.save.tiktokH265;
            }
            if ("twitterGif" in settings.save) {
                out.save!.convertGif = settings.save.twitterGif;
                delete settings.save.twitterGif;
            }
        }

        if (legacy.privacy) {
            if ("alwaysProxy" in legacy.privacy) {
                out.save ??= {};
                out.save.alwaysProxy = !!legacy.privacy.alwaysProxy;
                delete legacy.privacy.alwaysProxy;
            }
        }

        if (settings?.appearance) {
            if ("reduceMotion" in settings.appearance) {
                out.accessibility ??= {};
                out.accessibility.reduceMotion = settings.appearance.reduceMotion;
                delete settings.appearance.reduceMotion;
            }
            if ("reduceTransparency" in settings.appearance) {
                out.accessibility ??= {};
                out.accessibility.reduceTransparency = settings.appearance.reduceTransparency;
                delete settings.appearance.reduceTransparency;
            }
        }

        return out as AllPartialSettingsWithSchema;
    },

    [6]: (settings: AllPartialSettingsWithSchema) => {
        const out = settings as RecursivePartial<CobaltSettingsV6>;
        out.schemaVersion = 6;

        if (settings?.save) {
            if ("localProcessing" in settings.save) {
                out.save!.localProcessing =
                    settings.save.localProcessing ? "preferred" : "disabled";
            }
        }

        return out as AllPartialSettingsWithSchema;
    },

    [7]: (settings: AllPartialSettingsWithSchema) => {
        const out = settings as RecursivePartial<CobaltSettingsV7>;
        const legacy = settings as RecursivePartial<CobaltSettingsV4>;
        out.schemaVersion = 7;

        out.connection ??= {};

        if (legacy.processing) {
            if (
                legacy.processing.enableCustomInstances
                && typeof legacy.processing.customInstanceURL === "string"
            ) {
                out.connection.instanceUrl = legacy.processing.customInstanceURL;
            }

            if (
                legacy.processing.enableCustomApiKey
                && typeof legacy.processing.customApiKey === "string"
            ) {
                out.connection.apiKey = legacy.processing.customApiKey;
            }

            delete legacy.processing;
        }

        if (legacy.privacy) {
            delete legacy.privacy;
        }

        return out as AllPartialSettingsWithSchema;
    },
};

export const migrate = (settings: AllPartialSettingsWithSchema): PartialSettings => {
    return Object.keys(migrations)
        .map(Number)
        .filter((version) => version > settings.schemaVersion)
        .reduce((settings, migrationVersion) => {
            return migrations[migrationVersion](settings);
        }, settings as AllPartialSettingsWithSchema) as PartialSettings;
};
