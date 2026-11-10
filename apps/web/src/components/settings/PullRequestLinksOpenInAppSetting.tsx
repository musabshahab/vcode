import { useClientSettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function PullRequestLinksOpenInAppSetting() {
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsRow
      {...searchableSetting("pull-request-links-open-in-app")}
      description="Clicking a pull request link opens it in T3 Code. Turn off to open pull request links like any other link, on your git host."
      resetAction={
        openInApp ? null : (
          <SettingResetButton
            label="open pull requests in T3 Code"
            onClick={() => updateSettings({ pullRequestLinksOpenInApp: true })}
          />
        )
      }
      control={
        <Switch
          checked={openInApp}
          onCheckedChange={(checked) =>
            updateSettings({ pullRequestLinksOpenInApp: Boolean(checked) })
          }
          aria-label="Open pull requests in T3 Code"
        />
      }
    />
  );
}
