import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";
import * as NodeSea from "node:sea";

export const Platform = Context.Reference<NodeJS.Platform>(
  "@codenine/shared/HostProcess/Platform",
  {
    defaultValue: () => process.platform,
  },
);

export const Architecture = Context.Reference<NodeJS.Architecture>(
  "@codenine/shared/HostProcess/Architecture",
  {
    defaultValue: () => process.arch,
  },
);

export const Hostname = Context.Reference<string>("@codenine/shared/HostProcess/Hostname", {
  defaultValue: () => NodeOS.hostname(),
});

export const Username = Context.Reference<string | null>("@codenine/shared/HostProcess/Username", {
  defaultValue: () => {
    try {
      return NodeOS.userInfo().username.trim() || null;
    } catch {
      return null;
    }
  },
});

export const HomeDirectory = Context.Reference<string>(
  "@codenine/shared/HostProcess/HomeDirectory",
  {
    defaultValue: () => NodeOS.homedir(),
  },
);

export const Environment = Context.Reference<NodeJS.ProcessEnv>(
  "@codenine/shared/HostProcess/Environment",
  {
    defaultValue: () => process.env,
  },
);

export const WorkingDirectory = Context.Reference<string>(
  "@codenine/shared/HostProcess/WorkingDirectory",
  {
    defaultValue: () => process.cwd(),
  },
);

export const ExecutablePath = Context.Reference<string>(
  "@codenine/shared/HostProcess/ExecutablePath",
  {
    defaultValue: () => process.execPath,
  },
);

export const Arguments = Context.Reference<ReadonlyArray<string>>(
  "@codenine/shared/HostProcess/Arguments",
  {
    defaultValue: () => process.argv,
  },
);

/** Original shell command spelling; argv[0] and execPath instead identify the resolved binary. */
export const InvokedAs = Context.Reference<string>("@codenine/shared/HostProcess/InvokedAs", {
  defaultValue: () => process.argv0,
});

export const IsExecutable = Context.Reference<boolean>(
  "@codenine/shared/HostProcess/IsExecutable",
  {
    defaultValue: () => NodeSea.isSea(),
  },
);

export const UserId = Context.Reference<number | undefined>("@codenine/shared/HostProcess/UserId", {
  defaultValue: () => process.getuid?.(),
});

export const isWindows = Effect.map(Platform, (platform) => platform === "win32");
