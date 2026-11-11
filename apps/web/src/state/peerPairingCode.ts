import { createMcpApprovalCodeCommand } from "@codenine/client-runtime/state/peerPairingCode";
import { squashAtomCommandFailure } from "@codenine/client-runtime/state/runtime";
import type {
  AuthMcpClientAccess,
  AuthPairingCredentialResult,
  EnvironmentId,
} from "@codenine/contracts";
import * as Result from "effect/Result";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const mintMcpApprovalCode = createMcpApprovalCodeCommand(connectionAtomRuntime);

/** A fresh code on `environmentId` that approves one app's sign-in at `access`. */
export async function mintMcpApprovalCodeOn(
  environmentId: EnvironmentId,
  access: AuthMcpClientAccess,
): Promise<Result.Result<AuthPairingCredentialResult, unknown>> {
  const result = await mintMcpApprovalCode.run(appAtomRegistry, { environmentId, input: access });
  return result._tag === "Success"
    ? Result.succeed(result.value)
    : Result.fail(squashAtomCommandFailure(result));
}
