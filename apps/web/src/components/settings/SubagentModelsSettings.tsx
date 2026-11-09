import type { ModelSelection, ServerSettings } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type SubagentRole = keyof ServerSettings["teamRoleModelSelections"];

const SUBAGENT_ROLE_ROWS = [
  {
    role: "implementation",
    item: "subagent-model-implementation",
    description: "For subagents that write code.",
  },
  {
    role: "research",
    item: "subagent-model-research",
    description: "For subagents that search and read code.",
  },
  {
    role: "review",
    item: "subagent-model-review",
    description:
      "For subagents that review changes. A model from another provider catches different mistakes.",
  },
  {
    role: "test",
    item: "subagent-model-test",
    description: "For subagents that run or write tests.",
  },
  {
    role: "design",
    item: "subagent-model-design",
    description: "For subagents that design interfaces.",
  },
] as const;

export function SubagentModelsSettings() {
  const { scope, environment, target, targets, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const providersByEnvironment = useEnvironmentProviders();
  const environmentId = environment?.environmentId ?? null;
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);

  // Older servers drop the patch, so a saved choice would silently not apply.
  const supported =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (candidate) =>
        candidate.serverConfig?.environment.capabilities.teamRoleModelSelections === true,
    );
  if (scope.kind === "project" || scope.kind === "checkout" || !supported) return null;

  // An unset role shows where the picker opens, not a saved choice.
  const threadModel = resolveProjectDefaultProviderModelSelection(providers, settings, null);

  const setRole = (role: SubagentRole, value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({ type: "error", title: "Subagent model not saved", description: reason });
      return;
    }
    updateSettings({ teamRoleModelSelections: { [role]: value } });
  };

  return (
    <SettingsSection id="subagent-models" title="Subagent models">
      {SUBAGENT_ROLE_ROWS.map(({ role, item, description }) => {
        const stored = target?.settings.teamRoleModelSelections[role];
        const mixed = targets.some(
          (candidate) => !Equal.equals(candidate.settings.teamRoleModelSelections[role], stored),
        );
        const selection =
          stored === undefined
            ? threadModel
            : (resolveDefaultProviderModelSelection(providers, stored) ?? stored);
        const entry = entries.find((candidate) => candidate.instanceId === selection?.instanceId);
        const { title } = searchableSetting(item);
        return (
          <SettingsRow
            key={role}
            serverScoped
            // settingKeys would report the whole setting's source on a role that is not set.
            managedPaths={["teamRoleModelSelections"]}
            mixed={mixed}
            {...searchableSetting(item)}
            description={description}
            resetAction={
              mixed || stored !== undefined ? (
                <SettingResetButton
                  label={`${title.toLowerCase()} model`}
                  onClick={() => setRole(role, null)}
                />
              ) : null
            }
            control={
              selection ? (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={selection.instanceId}
                    model={selection.model}
                    lockedProvider={null}
                    instanceEntries={entries}
                    modelOptionsByInstance={getCustomModelOptionsByInstance(
                      settings,
                      providers,
                      selection.instanceId,
                      selection.model,
                    )}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    triggerAriaLabel={`${title} model`}
                    {...(mixed
                      ? { triggerLabel: "Mixed" }
                      : stored === undefined
                        ? { triggerLabel: "Thread's model" }
                        : {})}
                    getModelDisabledReason={modelDisabledReason}
                    {...(environmentId
                      ? {
                          onOpenProviderSetup: (instanceId) => {
                            void navigate({
                              to: "/settings/providers",
                              search: { environmentId, instanceId },
                            });
                          },
                        }
                      : {})}
                    onInstanceModelChange={(instanceId, model) =>
                      setRole(role, createModelSelection(instanceId, model))
                    }
                  />
                  {stored !== undefined && entry && !mixed ? (
                    <TraitsPicker
                      provider={entry.driverKind}
                      models={entry.models}
                      model={selection.model}
                      modelOptions={selection.options ?? []}
                      allowPromptInjectedEffort={false}
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      onModelOptionsChange={(options) =>
                        setRole(
                          role,
                          createModelSelection(selection.instanceId, selection.model, options),
                        )
                      }
                    />
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No providers available</span>
              )
            }
          />
        );
      })}
    </SettingsSection>
  );
}
