import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type CustomModelSetting,
  type EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { resolveDefaultProviderModelSelection } from "../../providerInstances";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SecretInput } from "./SecretInput";

const OPENROUTER_INSTANCE_ID = ProviderInstanceId.make("openrouter");
const OPENROUTER_KEY_NAME = "OPENROUTER_API_KEY";
// OpenRouter is a model API, so it runs through the Codex program, pointed at OpenRouter here.
const OPENROUTER_LAUNCH_ARGS = [
  "model_provider=openrouter",
  "model_providers.openrouter.name=OpenRouter",
  "model_providers.openrouter.base_url=https://openrouter.ai/api/v1",
  `model_providers.openrouter.env_key=${OPENROUTER_KEY_NAME}`,
  "model_providers.openrouter.wire_api=responses",
]
  .map((setting) => `-c ${setting}`)
  .join(" ");
// OpenRouter's public catalog. It needs no key and allows requests from any page.
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const OpenRouterCatalog = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      supported_parameters: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
const decodeCatalog = Schema.decodeUnknownSync(OpenRouterCatalog);

/**
 * Every OpenRouter model that can run an agent, which needs tool calls. A model without a
 * reasoning setting gets no options, so it neither offers an effort it would reject nor
 * carries the option list in every provider update.
 */
async function loadOpenRouterModels(): Promise<ReadonlyArray<CustomModelSetting> | null> {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) return null;
    return decodeCatalog(await response.json())
      .data.filter((model) => model.supported_parameters?.includes("tools") === true)
      .map((model) => ({
        slug: model.id,
        name: model.name,
        ...(model.supported_parameters?.includes("reasoning") === true
          ? {}
          : { capabilities: { optionDescriptors: [] } }),
      }));
  } catch {
    return null;
  }
}

const hasCustomModels = (
  config: unknown,
): config is { readonly customModels: ReadonlyArray<unknown> } =>
  typeof config === "object" &&
  config !== null &&
  "customModels" in config &&
  Array.isArray(config.customModels);

/** Adds OpenRouter as a provider of its own, offering every model of its that can run an agent. */
export function OpenRouterSetup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings;
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const instance = settings?.providerInstances[OPENROUTER_INSTANCE_ID];
  const modelCount = hasCustomModels(instance?.config) ? instance.config.customModels.length : 0;
  const codexInstalled = (providers ?? []).some(
    (provider) => provider.driver === "codex" && provider.installed,
  );

  const fail = (title: string, description: string) =>
    toastManager.add({ type: "error", title, description });

  /** Creates the provider, or replaces its model list with OpenRouter's current one. */
  const save = async () => {
    if (instance === undefined && apiKey.trim() === "") {
      fail("OpenRouter needs a key", "Paste your OpenRouter key.");
      return;
    }
    setSaving(true);
    const customModels = await loadOpenRouterModels();
    if (customModels === null || customModels.length === 0) {
      setSaving(false);
      fail("Could not read OpenRouter's models", "Check the connection and try again.");
      return;
    }
    // New threads would otherwise move to OpenRouter, which is paid per use. Keep whichever
    // model they start on today, unless the user already chose a default.
    const startsOn =
      instance === undefined && settings?.defaultModelSelection === null
        ? resolveDefaultProviderModelSelection(providers ?? [], null)
        : null;
    const result = await persist(
      {
        operation: "upsert",
        instanceId: OPENROUTER_INSTANCE_ID,
        instance:
          instance === undefined
            ? {
                driver: ProviderDriverKind.make("codex"),
                displayName: "OpenRouter",
                enabled: true,
                environment: [{ name: OPENROUTER_KEY_NAME, value: apiKey.trim(), sensitive: true }],
                config: { setupMode: "existing", launchArgs: OPENROUTER_LAUNCH_ARGS, customModels },
              }
            : {
                ...instance,
                config: {
                  ...(typeof instance.config === "object" ? instance.config : {}),
                  customModels,
                },
              },
      },
      startsOn === null ? {} : { defaultModelSelection: startsOn },
    );
    setSaving(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      fail(
        "Could not save OpenRouter",
        error instanceof Error ? error.message : "The settings update failed.",
      );
      return;
    }
    setApiKey("");
    toastManager.add({
      type: "success",
      title: `OpenRouter has ${customModels.length} models`,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          OpenRouter
          {instance === undefined ? "" : ` · connected · ${modelCount} models`}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {instance !== undefined
            ? "Every OpenRouter model that can run an agent is in the model picker. Refresh to pick up new ones. Change the key under Providers in Settings."
            : codexInstalled
              ? "Pay per use with an OpenRouter key. Adds every OpenRouter model that can run an agent. It runs through the Codex program, with no ChatGPT sign-in."
              : "OpenRouter runs through the Codex program. Install Codex above first; it needs no sign-in for this."}
        </p>
      </div>
      {instance === undefined && codexInstalled ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">OpenRouter key</span>
          <SecretInput
            value={apiKey}
            placeholder="sk-or-…"
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      ) : null}
      {instance !== undefined || codexInstalled ? (
        <div>
          <Button variant="outline" disabled={saving} onClick={() => void save()}>
            {saving
              ? "Reading models…"
              : instance === undefined
                ? "Connect OpenRouter"
                : "Refresh models"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
