/**
 * `<img>`, `EventSource`, and `WebSocket` cannot set bearer or DPoP headers, so bearer and DPoP
 * connections mint a short-lived WebSocket ticket and pass it as `wsTicket`, the same way the
 * app's own `/ws` upgrade authenticates. Callers fetch a fresh one each time they (re)connect a
 * stream.
 */
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { HttpClient } from "effect/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

export interface MediaStreamAccess {
  readonly httpBase: string;
  readonly wsBase: string;
  readonly query: Readonly<Record<string, string>>;
  readonly credentials: boolean;
}

export const withMediaStreamQuery = (url: string, access: MediaStreamAccess): string => {
  const entries = Object.entries(access.query);
  if (entries.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${new URLSearchParams(entries).toString()}`;
};

const TICKET_TIMEOUT_MS = 8_000;

export const resolveMediaStreamAccess = Effect.fn("clientRuntime.state.resolveMediaStreamAccess")(
  function* (input: {
    readonly prepared: PreparedConnection;
    readonly hubBasePath: string;
  }): Effect.fn.Return<MediaStreamAccess, RemoteEnvironmentRequestError, HttpClient.HttpClient> {
    const httpBase = environmentEndpointUrl(input.prepared.httpBaseUrl, input.hubBasePath);
    const wsBase = httpBase.replace(/^http/, "ws");
    if (input.prepared.httpAuthorization === null) {
      return { httpBase, wsBase, query: {}, credentials: true };
    }
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    const ticket = yield* executeAuthenticatedEnvironmentHttpRequest({
      prepared: input.prepared,
      signer,
      remoteAuthorization,
      group: "auth",
      method: "POST",
      url: (urls) => urls.webSocketTicketFor({ params: { use: "media" } }),
      timeoutMs: TICKET_TIMEOUT_MS,
      request: ({ client, headers }) =>
        client.webSocketTicketFor({ headers, params: { use: "media" } }),
    });
    return {
      httpBase,
      wsBase,
      query: { wsTicket: Redacted.value(ticket.ticket) },
      credentials: false,
    };
  },
);
