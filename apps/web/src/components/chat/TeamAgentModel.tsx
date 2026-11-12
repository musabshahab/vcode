import { buildTraitsTriggerDisplay } from "@codenine/client-runtime/model-traits";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
} from "@codenine/contracts";
import type { EffortDisplay } from "@codenine/contracts/settings";
import { createModelSelection } from "@codenine/shared/model";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getAppModelOptionsForInstance, type AppModelOption } from "../../modelSelection";
import { providerInstanceEntriesFor, type ProviderInstanceEntry } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ComposerEffortColumn, describeComposerEffort } from "./ComposerModelEffort";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getTriggerDisplayModelName } from "./providerIconUtils";
import { getTraitsSectionVisibility, type TraitsSelectionInput } from "./TraitsPicker";

/** The providers and models the composer offers in the lead thread's project. */
export interface TeamModelCatalog {
  readonly environmentId: EnvironmentId;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly effortDisplay: EffortDisplay;
}

export function useTeamModelCatalog(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
): TeamModelCatalog {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  return {
    environmentId,
    entries,
    modelOptionsByInstance: new Map(
      entries.map((entry) => [entry.instanceId, getAppModelOptionsForInstance(settings, entry)]),
    ),
    effortDisplay: settings.effortDisplay,
  };
}

function modelName(catalog: TeamModelCatalog, selection: ModelSelection) {
  const entry = catalog.entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = resolveModelPickerSelectedModel({
    model: selection.model,
    options: catalog.modelOptionsByInstance.get(selection.instanceId) ?? [],
  });
  return {
    entry,
    name: model ? getTriggerDisplayModelName(model, entry?.driverKind) : selection.model,
  };
}

/** The composer's model picker with its effort column, writing to one team agent. */
export function TeamModelPicker(props: {
  catalog: TeamModelCatalog;
  selection: ModelSelection;
  label: string;
  disabled: boolean;
  onChange: (selection: ModelSelection) => void;
}) {
  const { catalog, selection, onChange } = props;
  const entry = catalog.entries.find((candidate) => candidate.instanceId === selection.instanceId);
  // Effort and the other options come from the model's descriptors, whatever the provider names them.
  const traits: TraitsSelectionInput | null = entry
    ? {
        provider: entry.driverKind,
        instanceId: selection.instanceId,
        model: selection.model,
        models: entry.models,
        modelOptions: selection.options ?? [],
        allowPromptInjectedEffort: false,
        onModelOptionsChange: (options) =>
          onChange(createModelSelection(selection.instanceId, selection.model, options)),
      }
    : null;
  const effort = describeComposerEffort(traits, catalog.effortDisplay, "xs");
  return (
    <ProviderModelPicker
      environmentId={catalog.environmentId}
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={catalog.entries}
      modelOptionsByInstance={catalog.modelOptionsByInstance}
      size="xs"
      disabled={props.disabled}
      triggerAriaLabel={props.label}
      triggerSuffix={effort.suffix}
      triggerDetail={effort.detail}
      effortColumn={<ComposerEffortColumn traits={traits} />}
      onInstanceModelChange={(instanceId, model) =>
        onChange(createModelSelection(instanceId, model))
      }
    />
  );
}

/** Provider, model and effort as the composer names them; effort is "" when the model has none. */
export function teamModelText(catalog: TeamModelCatalog, selection: ModelSelection) {
  const { entry, name } = modelName(catalog, selection);
  const traits = entry
    ? getTraitsSectionVisibility({
        provider: entry.driverKind,
        models: entry.models,
        model: selection.model,
        modelOptions: selection.options ?? [],
        allowPromptInjectedEffort: false,
      })
    : null;
  const effort = traits
    ? buildTraitsTriggerDisplay({
        descriptors: traits.descriptors,
        primarySelectDescriptorId: traits.primarySelectDescriptor?.id ?? null,
        ultrathinkPromptControlled: false,
        modelSelection: selection,
      }).label
    : "";
  return { entry, name, effort };
}

/** Provider, model and effort as text, for an agent the user can no longer change. */
export function TeamModelLabel(props: { catalog: TeamModelCatalog; selection: ModelSelection }) {
  const { entry, name, effort } = teamModelText(props.catalog, props.selection);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {entry ? (
        <ProviderInstanceIcon
          driverKind={entry.driverKind}
          displayName={entry.displayName}
          accentColor={entry.accentColor}
          className="size-3.5"
          iconClassName="size-3.5"
        />
      ) : null}
      <span className="truncate">{effort ? `${name} ${effort}` : name}</span>
    </span>
  );
}
