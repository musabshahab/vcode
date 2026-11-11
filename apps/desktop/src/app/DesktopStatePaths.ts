import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(codenineHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(codenineHome)) {
    return Option.none();
  }
  const trimmed = codenineHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly codenineHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.codenineHome), () =>
    input.joinPath(input.homeDirectory, ".codenine"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly codenineHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.codenineHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
