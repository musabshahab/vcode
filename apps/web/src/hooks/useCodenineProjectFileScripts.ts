import {
  CODENINE_PROJECT_FILE_NAME,
  type EnvironmentId,
  type CodenineProjectFile,
  type CodenineProjectFileScript,
} from "@codenine/contracts";
import { parseCodenineProjectFile } from "@codenine/shared/codenineProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<CodenineProjectFileScript> = [];

export interface CodenineProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: CodenineProjectFile | null;
  scripts: ReadonlyArray<CodenineProjectFileScript>;
}

export function useCodenineProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): CodenineProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    CODENINE_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseCodenineProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useCodenineProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<CodenineProjectFileScript> {
  return useCodenineProjectFileState(environmentId, cwd).scripts;
}
