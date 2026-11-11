import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@codenine/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  readonly capabilities?: ReadonlySet<string>;
}
