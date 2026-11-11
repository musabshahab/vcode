import { CODENINE_INSTALL_PS1_COMMAND, CODENINE_INSTALL_SH_COMMAND } from "@codenine/contracts";

import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `codenine`, then run `command`. Both installers are shown
 * because the browser showing this is often not the computer being set up.
 */
export function InstallCodenineCommands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">macOS, Linux</p>
      <CommandBlock command={CODENINE_INSTALL_SH_COMMAND} />
      <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
      <CommandBlock command={CODENINE_INSTALL_PS1_COMMAND} />
      <p className="text-xs text-muted-foreground">Then</p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        Skip the install if you already have <code className="font-mono">codenine</code>. If{" "}
        <code className="font-mono">codenine</code> is not found after installing, add the folder
        the installer names to your PATH.
      </p>
    </div>
  );
}
