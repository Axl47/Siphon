import type { CobaltSettingsV6 } from "$lib/types/settings/v6";

export type CobaltSettingsV7 = Omit<CobaltSettingsV6, 'schemaVersion' | 'processing' | 'privacy'> & {
    schemaVersion: 7,
    connection: {
        instanceUrl: string;
        apiKey: string;
    },
};
