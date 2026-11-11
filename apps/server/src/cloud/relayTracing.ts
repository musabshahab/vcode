import {
  nodeProcessRuntimeAttributes,
  processServiceInstanceId,
} from "@codenine/shared/observability";
import * as RelayTracing from "@codenine/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { resolveRelayClientTracingConfig } from "./publicConfig.ts";

const relayClientTracingConfig = resolveRelayClientTracingConfig();

const relayLayer = (resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return RelayTracing.layer(relayClientTracingConfig, {
        ...resource,
        serviceInstanceId: processServiceInstanceId(config.otelEnvironment.resourceAttributes),
      });
    }),
  );

export const layerHeadlessRelayClient = relayLayer({
  serviceName: "codenine-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "headless-cli",
});

export const layerServerRelayBroker = relayLayer({
  serviceName: "codenine-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "environment-server",
  component: "relay-broker",
});
