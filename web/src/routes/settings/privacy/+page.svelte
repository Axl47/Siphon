<script lang="ts">
    import { t } from "$lib/i18n/translations";

    import SettingsToggle from "$components/buttons/SettingsToggle.svelte";
    import SettingsCategory from "$components/settings/SettingsCategory.svelte";
</script>

<SettingsCategory sectionId="tunnel" title={$t("settings.privacy.tunnel")}>
    <SettingsToggle
        settingContext="save"
        settingId="alwaysProxy"
        title={$t("settings.privacy.tunnel.title")}
        description={$t("settings.privacy.tunnel.description")}
    />
</SettingsCategory>
