import { AuthRelayReadScope, AuthRelayWriteScope, type EnvironmentId } from "@codenine/contracts";

import { isElectron } from "../env";
import { useEnvironmentScope } from "../state/session";
import { useCloudLinkState } from "./cloudLinkState";
import { hasCloudPublicConfig } from "./publicConfig";
import { resolveCodenineConnectTurnOn } from "./codenineConnectState";

/** Whether this client can turn on Codenine Connect for `environmentId`, and if not, why. */
export function useCodenineConnectTurnOn(environmentId: EnvironmentId | null) {
  const canReadRelay = useEnvironmentScope(environmentId, AuthRelayReadScope);
  const canWriteRelay = useEnvironmentScope(environmentId, AuthRelayWriteScope);
  const linkState = useCloudLinkState(environmentId).data;
  return resolveCodenineConnectTurnOn({
    desktopApp: isElectron,
    // Unknown while loading and on older servers, which keep today's switch in Settings.
    linkableHere: linkState?.linkableHere ?? true,
    cloudConfigured: hasCloudPublicConfig(),
    canReadRelay,
    canWriteRelay,
  });
}
