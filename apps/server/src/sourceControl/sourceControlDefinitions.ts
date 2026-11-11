import { builtInSourceControlDefinitions } from "@codenine/source-control-definitions/registry";
import * as GitHubDriver from "@codenine/source-control-github/server/driver";

/** In the shared registry's order, which is the order hosts are listed and probed in. */
export const BUILT_IN_SOURCE_CONTROL_DRIVER_LIST = [GitHubDriver.driver] as const;

export const sourceControlDefinitions = builtInSourceControlDefinitions;
