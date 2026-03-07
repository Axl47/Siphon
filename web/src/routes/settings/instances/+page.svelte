<script lang="ts">
    import { t } from "$lib/i18n/translations";

    import SettingsInput from "$components/settings/SettingsInput.svelte";
    import SettingsCategory from "$components/settings/SettingsCategory.svelte";
</script>

<SettingsCategory
    sectionId="community"
    title={$t("settings.processing.community")}
>
    <SettingsInput
        settingContext="connection"
        settingId="instanceUrl"
        placeholder="https://siphon.yourserver.dev/"
        altText={$t("settings.processing.custom_instance.input.alt_text")}
    />
    <div class="subtext">
        {$t("settings.processing.enable_custom.description")}
    </div>
</SettingsCategory>

<SettingsCategory
    sectionId="access-key"
    title={$t("settings.processing.access_key")}
>
    <SettingsInput
        settingContext="connection"
        settingId="apiKey"
        placeholder="00000000-0000-0000-0000-000000000000"
        altText={$t("settings.processing.access_key.input.alt_text")}
        type="uuid"
        sensitive
    />
    <div class="subtext">
        {$t("settings.processing.access_key.description")}
    </div>
</SettingsCategory>

<style>
    .subtext {
        margin-top: -3px;
    }
</style>
