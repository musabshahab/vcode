import {
  WS_METHODS,
  PullRequestRef,
  PullRequestState,
  type EnvironmentId,
  type PullRequestRoutingResult,
  type PullRequestRoutingIdentityResult,
} from "@codenine/contracts";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import {
  PullRequestRoutingPermissions,
  pullRequestRoutingConnectionKey,
} from "../connection/pullRequestRoutingPermissions.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as ConnectionProfileStore from "../connection/profileStore.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  requestGuarded as request,
  EnvironmentRpcUnavailableError,
  type EnvironmentRpcInput,
  type EnvironmentUnaryRpcTag,
} from "../rpc/client.ts";

// Linked pull request summaries are the only reads another environment can answer.
const reads = new Set<string>([WS_METHODS.pullRequestsSummary]);
const isRef = Schema.is(PullRequestRef);
const hasState = Schema.is(
  Schema.Struct({ state: PullRequestState, isDraft: Schema.optional(Schema.Boolean) }),
);
const readTimeout = (environmentId: EnvironmentId) =>
  Effect.timeoutOrElse({
    duration: "30 seconds",
    orElse: () =>
      Effect.fail(
        new EnvironmentRpcUnavailableError({
          environmentId,
          message: "The environment did not respond to the PR request.",
        }),
      ),
  });
const isUnregistered = Schema.is(EnvironmentRegistry.EnvironmentNotRegisteredError);
const encodeKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String))),
);
type PendingMetadata<A> = WeakMap<RpcSession, Map<string, Deferred.Deferred<Exit.Exit<A>>>>;
const pendingRouting: PendingMetadata<PullRequestRoutingResult | null> = new WeakMap();
const pendingIdentities: PendingMetadata<PullRequestRoutingIdentityResult | null> = new WeakMap();

function shareMetadataRead<A, R>(
  pending: PendingMetadata<A>,
  key: string,
  probe: Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R | EnvironmentSupervisor.EnvironmentSupervisor> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      const session = yield* SubscriptionRef.get(supervisor.session);
      if (Option.isNone(session)) return yield* restore(probe);
      const entries =
        pending.get(session.value) ?? new Map<string, Deferred.Deferred<Exit.Exit<A>>>();
      pending.set(session.value, entries);
      const existing = entries.get(key);
      if (existing !== undefined) {
        const result = yield* restore(Deferred.await(existing));
        // A cancelled first reader must not cancel the other readers waiting on its probe.
        return yield* restore(
          Exit.hasInterrupts(result) ? shareMetadataRead(pending, key, probe) : result,
        );
      }
      const result = Deferred.makeUnsafe<Exit.Exit<A>>();
      entries.set(key, result);
      return yield* restore(probe).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => entries.delete(key)).pipe(
            Effect.andThen(Deferred.succeed(result, exit)),
          ),
        ),
      );
    }),
  );
}

function isLocal(entry: ConnectionCatalogEntry): boolean {
  const url =
    entry.target._tag === "PrimaryConnectionTarget"
      ? entry.target.httpBaseUrl
      : Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : undefined;
  if (url === undefined) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const routingAllowed = Effect.fn("PullRequestRouting.allowed")(function* (
  registry: EnvironmentRegistry.EnvironmentRegistry["Service"],
  originId: EnvironmentId,
  destinationId: EnvironmentId,
) {
  const entries = yield* SubscriptionRef.get(registry.entries);
  const origin = entries.get(originId);
  const destination = entries.get(destinationId);
  if (
    !origin?.enabled ||
    !destination?.enabled ||
    origin.unsupportedReason !== undefined ||
    destination.unsupportedReason !== undefined
  )
    return false;
  const permissions = yield* PullRequestRoutingPermissions;
  const source = yield* permissions.get(origin);
  const target = yield* permissions.get(destination);
  if (source === "off" || target === "off") return false;
  for (const entry of [origin, destination]) {
    if (entry.target._tag !== "SshConnectionTarget") continue;
    const profiles = yield* Effect.serviceOption(ConnectionProfileStore.ConnectionProfileStore);
    if (Option.isNone(profiles)) return false;
    const profile = yield* profiles.value
      .get(entry.target.connectionId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    const key = pullRequestRoutingConnectionKey(entry);
    if (key === null || key !== pullRequestRoutingConnectionKey({ ...entry, profile }))
      return false;
  }
  return true;
});

/**
 * The origin owns the threads linked to this pull request, but a routed read never reaches it.
 * Tell it which state the read saw so it checks again.
 */
const reportState = (
  { allowStale: _allowStale, expectedAccountId: _expectedAccountId, ...reference }: PullRequestRef,
  status: { readonly state: PullRequestState; readonly isDraft?: boolean | undefined },
) =>
  request(WS_METHODS.pullRequestsReportState, {
    reference,
    state: status.state,
    ...(status.isDraft === undefined ? {} : { isDraft: status.isDraft }),
  }).pipe(Effect.timeoutOption("5 seconds"), Effect.ignore, Effect.forkDetach, Effect.asVoid);

/** Credentials stay on their environments. Only a verified host and account cross the wire. */
export function createPullRequestRouter() {
  const routedRequest = Effect.fn("PullRequestRouting.request")(function* <
    T extends EnvironmentUnaryRpcTag,
  >(tag: T, input: EnvironmentRpcInput<T>, sourceRead?: ReturnType<typeof request<T>>) {
    const source = sourceRead ?? request(tag, input);
    if (!reads.has(tag) || !isRef(input)) {
      return yield* request(tag, input);
    }
    const ref = input;
    const origin = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const entries = yield* SubscriptionRef.get(registry.entries);
    const alternatives = [];
    for (const [id, entry] of entries) {
      if (id === origin.target.environmentId) continue;
      if (!(yield* routingAllowed(registry, origin.target.environmentId, id))) continue;
      const connected = yield* registry
        .run(
          id,
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.flatMap((s) => SubscriptionRef.get(s.session)),
          ),
        )
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(connected)) continue;
      alternatives.push({ id, local: isLocal(entry) });
    }
    if (alternatives.length === 0) return yield* source;

    const identityProbe = request(WS_METHODS.pullRequestsRouting, ref).pipe(
      Effect.timeout("2 seconds"),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(null),
      ),
    );
    const identity = yield* shareMetadataRead(
      pendingRouting,
      encodeKey([ref.projectId, ref.host?.toLowerCase() ?? null, ref.repository.toLowerCase()]),
      identityProbe,
    );
    // The source server answers only for a host whose account it can verify.
    if (identity === null) return yield* source;

    const routedInput = {
      ...input,
      host: identity.host,
      expectedAccountId: identity.accountId,
    };
    const guardedSource = sourceRead ?? (yield* Effect.cached(request(tag, routedInput)));
    const local = alternatives.filter((entry) => entry.local);
    const remote = alternatives.filter((entry) => !entry.local);
    const candidates = [
      ...local.map((entry) => entry.id),
      ...remote.map((entry) => entry.id),
      origin.target.environmentId,
    ];
    const run = (id: EnvironmentId): ReturnType<typeof request<T>> =>
      (id === origin.target.environmentId
        ? guardedSource
        : registry.run(id, request(tag, routedInput))
      ).pipe(
        Effect.tap((result) =>
          id !== origin.target.environmentId && hasState(result)
            ? reportState(ref, result)
            : Effect.void,
        ),
        Effect.mapError((error) =>
          isUnregistered(error)
            ? new EnvironmentRpcUnavailableError({
                environmentId: id,
                message: "The environment was removed.",
              })
            : error,
        ),
      );
    const visit = (index: number): ReturnType<typeof request<T>> => {
      const id = candidates[index];
      if (id === undefined) return guardedSource;
      return Effect.gen(function* () {
        if (id !== origin.target.environmentId) {
          if (!(yield* routingAllowed(registry, origin.target.environmentId, id)))
            return yield* visit(index + 1);
          // An older server would discard expectedAccountId. Verify it implements the guard first.
          const alternateProbe = request(WS_METHODS.pullRequestsRoutingIdentity, {
            host: identity.host,
          }).pipe(
            Effect.timeout("2 seconds"),
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(null),
            ),
          );
          const alternate = yield* registry
            .run(
              id,
              shareMetadataRead(pendingIdentities, identity.host.toLowerCase(), alternateProbe),
            )
            .pipe(
              Effect.timeout("2 seconds"),
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(null),
              ),
            );
          if (
            alternate === null ||
            alternate.provider !== identity.provider ||
            alternate.host.toLowerCase() !== identity.host.toLowerCase() ||
            alternate.accountId !== identity.accountId
          ) {
            return yield* visit(index + 1);
          }
          if (!(yield* routingAllowed(registry, origin.target.environmentId, id)))
            return yield* visit(index + 1);
        }
        const operation = run(id);
        return yield* operation.pipe(
          readTimeout(id),
          Effect.catchIf(
            () => index + 1 < candidates.length,
            () => visit(index + 1),
          ),
          Effect.map((result) =>
            typeof result === "object" && result !== null && "projectId" in result
              ? { ...result, projectId: ref.projectId }
              : result,
          ),
        );
      });
    };
    return yield* visit(0);
  });

  return Effect.fn("PullRequestRouting.readOrWrite")(function* <T extends EnvironmentUnaryRpcTag>(
    tag: T,
    input: EnvironmentRpcInput<T>,
  ) {
    if (!reads.has(tag) || !isRef(input)) return yield* routedRequest(tag, input);
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const entries = yield* SubscriptionRef.get(registry.entries);
    if (entries.size < 2) return yield* request(tag, input);
    const origin = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    let allowed = false;
    for (const id of entries.keys()) {
      if (
        id !== origin.target.environmentId &&
        (yield* routingAllowed(registry, origin.target.environmentId, id))
      ) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return yield* request(tag, input);
    const strictInput = { ...input, allowStale: false };
    const source = yield* Effect.cached(
      request(tag, strictInput).pipe(readTimeout(origin.target.environmentId)),
    );
    const sourceEntry = entries.get(origin.target.environmentId);
    const routed = routedRequest(tag, strictInput, source);
    return yield* (
      sourceEntry !== undefined && isLocal(sourceEntry)
        ? source.pipe(Effect.catch(() => routed))
        : routed
    ).pipe(
      Effect.catch((error) =>
        input.allowStale !== false ? request(tag, input) : Effect.fail(error),
      ),
    );
  });
}
