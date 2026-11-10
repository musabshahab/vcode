import { type EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
const DEFAULT_MODELS = "openai/gpt-6.1-terra, openai/gpt-6-luna";

/** Adds OpenRouter as a provider of its own: a key and the model ids to offer. */
export function OpenRouterSetup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.settings;
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [saving, setSaving] = useState(false);
  const connected = settings?.providerInstances[OPENROUTER_INSTANCE_ID] !== undefined;
  const codexInstalled = (providers ?? []).some(
    (provider) => provider.driver === "codex" && provider.installed,
  );

  const connect = async () => {
    const customModels = models
      .split(",")
      .map((model) => model.trim())
      .filter((model) => model !== "");
    if (apiKey.trim() === "" || customModels.length === 0) {
      toastManager.add({
        type: "error",
        title: "OpenRouter needs a key and a model",
        description: "Paste your OpenRouter key and name at least one model.",
      });
      return;
    }
    setSaving(true);
    const result = await persist({
      operation: "create",
      instanceId: OPENROUTER_INSTANCE_ID,
      instance: {
        driver: ProviderDriverKind.make("codex"),
        displayName: "OpenRouter",
        enabled: true,
        environment: [{ name: OPENROUTER_KEY_NAME, value: apiKey.trim(), sensitive: true }],
        config: { setupMode: "existing", launchArgs: OPENROUTER_LAUNCH_ARGS, customModels },
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not connect OpenRouter",
        description: error instanceof Error ? error.message : "The settings update failed.",
      });
      return;
    }
    setApiKey("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          OpenRouter{connected ? " · connected" : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {connected
            ? "Its models are in the model picker. Change the key or models under Providers in Settings."
            : codexInstalled
              ? "Pay per use with an OpenRouter key. It runs through the Codex program, with no ChatGPT sign-in."
              : "OpenRouter runs through the Codex program. Install Codex above first; it needs no sign-in for this."}
        </p>
      </div>
      {connected || !codexInstalled ? null : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">OpenRouter key</span>
            <SecretInput
              value={apiKey}
              placeholder="sk-or-…"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Models</span>
            <Input
              value={models}
              spellCheck={false}
              onChange={(event) => setModels(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              OpenRouter model ids, separated by commas.
            </span>
          </label>
          <div>
            <Button variant="outline" disabled={saving} onClick={() => void connect()}>
              Connect OpenRouter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
