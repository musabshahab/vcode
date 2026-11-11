import type { SecretProviderDriver } from "@codenine/secret-provider-core/server/driver";
import { builtInSecretProviderDefinitions } from "@codenine/secret-provider-definitions/registry";

/** In the shared registry's order. */
export const BUILT_IN_SECRET_PROVIDER_DRIVER_LIST: ReadonlyArray<SecretProviderDriver> = [];

export const secretProviderDefinitions = builtInSecretProviderDefinitions;
