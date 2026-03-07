import env from "$lib/env";
import { get } from "svelte/store";
import settings from "$lib/state/settings";

export const currentApiURL = () => {
    const connectionSettings = get(settings).connection;
    const instanceUrl = connectionSettings.instanceUrl;

    if (instanceUrl.length > 0) {
        return new URL(instanceUrl).origin;
    }

    return new URL(env.DEFAULT_API_URL!).origin;
}
