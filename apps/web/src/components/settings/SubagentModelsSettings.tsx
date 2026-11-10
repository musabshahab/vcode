import type {
  ModelSelection,
  ServerSettings,
  SubagentModelPresetId,
  SubagentModelPresetsResult,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";
import { useState } from "react";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
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
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

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

export const SUBAGENT_MODEL_PRESETS: ReadonlyArray<{
  readonly id: SubagentModelPresetId;
  readonly label: string;
  readonly detail: string;
}> = [
  {
    id: "balanced",
    label: "Balanced",
    detail: "Strong models review. Cheaper ones do the volume.",
  },
  { id: "budget", label: "Budget", detail: "Mid-tier models write code and review." },
  {
    id: "maxQuality",
    label: "Max quality",
    detail: "The strongest models write code and review.",
  },
];

/** Each environment gets the preset built from its own providers and prices. */
const dollars = (amount: number) => `$${amount.toFixed(2)}`;

function SubagentModelPresetMenu() {
  const { connectedEnvironments, environment } = useSettingsScope();
  // Estimates come from the shown environment's providers and prices.
  const [estimates, setEstimates] = useState<SubagentModelPresetsResult | null>(null);
  const getPresets = useAtomCommand(serverEnvironment.getSubagentModelPresets, {
    reportFailure: false,
  });
  const persist = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });

  const apply = async (presetId: SubagentModelPresetId, label: string) => {
    const skipped: string[] = [];
    await Promise.all(
      connectedEnvironments.map(async ({ environmentId, label: environmentLabel }) => {
        const presets = await getPresets({ environmentId, input: {} });
        const preset =
          presets._tag === "Success"
            ? presets.value.presets.find((candidate) => candidate.id === presetId)
            : undefined;
        const saved =
          preset === undefined
            ? undefined
            : await persist({
                environmentId,
                input: { patch: { teamRoleModelSelections: preset.selections } },
              });
        if (saved?._tag !== "Success") {
          skipped.push(
            presets._tag === "Success" && preset === undefined
              ? `${environmentLabel} needs two models with a known price to choose between.`
              : `Could not apply it on ${environmentLabel}.`,
          );
        }
      }),
    );
    if (skipped.length > 0) {
      toastManager.add({
        type: "warning",
        title: `${label} preset not applied everywhere`,
        description: skipped.join("\n"),
      });
    }
  };

  const loadEstimates = (open: boolean) => {
    if (!open || !environment) return;
    void getPresets({ environmentId: environment.environmentId, input: {} }).then((result) =>
      setEstimates(result._tag === "Success" ? result.value : null),
    );
  };

  return (
    <Menu onOpenChange={loadEstimates}>
      <MenuTrigger render={<Button size="xs" variant="outline" />}>Presets</MenuTrigger>
      <MenuPopup align="end">
        {SUBAGENT_MODEL_PRESETS.map(({ id, label, detail }) => {
          const cost = estimates?.presets.find((preset) => preset.id === id)?.estimatedCostUsd;
          return (
            <MenuItem key={id} onClick={() => void apply(id, label)}>
              <span className="flex min-w-0 flex-col">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {detail}
                  {cost === undefined ? "" : ` About ${dollars(cost)} a task.`}
                </span>
              </span>
            </MenuItem>
          );
        })}
        {estimates?.strongestCostUsd === undefined ? null : (
          <p className="max-w-72 px-2 py-1 text-xs text-muted-foreground">
            Rough guide: the subagents of a typical task at API prices. With the strongest model in
            every role, about {dollars(estimates.strongestCostUsd)}.
          </p>
        )}
      </MenuPopup>
    </Menu>
  );
}

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
  const projectId = target?.projectId ?? null;
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const canWrite = useScopedSettingsWriteAllowed();
  const mixedBudget = useScopedSettingsMixed(["delegationBudgetUsd"]);

  // Older servers drop the patch, so a saved choice would silently not apply.
  const supported =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (candidate) =>
        candidate.serverConfig?.environment.capabilities.teamRoleModelSelections === true,
    );
  if (!supported) return null;
  // A project overrides the role models as one set; the budget and presets belong to the environment.
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  const supportsBudget = connectedEnvironments.every(
    (candidate) => candidate.serverConfig?.environment.capabilities.delegationBudget === true,
  );
  const setBudget = (draft: string) => {
    const text = draft.trim().replace(/^\$/, "");
    const amount = text === "" ? null : Number(text);
    if (amount !== null && !(Number.isFinite(amount) && amount > 0)) {
      toastManager.add({
        type: "error",
        title: "Budget not saved",
        description: "Enter an amount in dollars above zero, or leave it empty for no limit.",
      });
      return;
    }
    updateSettings({ delegationBudgetUsd: amount });
  };

  // An unset role shows where the picker opens, not a saved choice.
  const threadModel = resolveProjectDefaultProviderModelSelection(providers, settings, projectId);

  const setRole = (role: SubagentRole, value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({ type: "error", title: "Subagent model not saved", description: reason });
      return;
    }
    updateSettings({ teamRoleModelSelections: { [role]: value } });
  };

  return (
    <SettingsSection
      id="subagent-models"
      title="Subagent models"
      headerAction={canWrite && !isProjectScope ? <SubagentModelPresetMenu /> : null}
    >
      {supportsBudget && !isProjectScope ? (
        <SettingsRow
          serverScoped
          settingKeys={["delegationBudgetUsd"]}
          {...searchableSetting("delegation-budget")}
          description="In dollars at API prices. Once a request's subagents have used this much, no more start until you reply. Empty is no limit."
          resetAction={
            mixedBudget || settings.delegationBudgetUsd !== null ? (
              <SettingResetButton
                label="subagent budget"
                onClick={() => updateSettings({ delegationBudgetUsd: null })}
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              inputMode="decimal"
              className="w-full sm:w-24"
              value={
                mixedBudget || settings.delegationBudgetUsd === null
                  ? ""
                  : String(settings.delegationBudgetUsd)
              }
              onCommit={setBudget}
              placeholder={mixedBudget ? "Mixed" : "No limit"}
              aria-label="Budget per request in dollars"
            />
          }
        />
      ) : null}
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
            // For an environment, settingKeys would report the whole setting's source on a role
            // that is not set. A project needs them: its override is the whole set of roles.
            {...(isProjectScope
              ? { settingKeys: ["teamRoleModelSelections"] as const }
              : { managedPaths: ["teamRoleModelSelections"] })}
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
