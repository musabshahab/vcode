import {
  CODENINE_PROJECT_FILE_NAME,
  type EnvironmentId,
  type CodenineProjectFile,
} from "@codenine/contracts";
import { parseCodenineProjectFile } from "@codenine/shared/codenineProjectFile";
import { executeAtomQuery } from "@codenine/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readCodenineProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<CodenineProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, CODENINE_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    CODENINE_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseCodenineProjectFile(data.contents);
}
