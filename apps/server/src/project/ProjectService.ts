import {
  CommandId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type Project,
  type ProjectCreatePayload,
  type ProjectUpdatePayload,
  type ProjectSnapshot,
  type ThreadId,
} from "@codenine/contracts";
import * as HostProcess from "@codenine/shared/HostProcess";
import * as KeyedLock from "@codenine/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { withCommandMetrics } from "../observability/Metrics.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@codenine/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import {
  decodeProjectCommandRejection,
  encodeProjectCommandRejection,
  planProjectCommand,
  type ProjectCommand,
} from "../orchestration-v2/ProjectCommands.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import { planThreadDeletion } from "../orchestration-v2/ThreadDeletion.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import {
  isFilesystemRoot,
  makeIsManagedWorktreePath,
  managedWorktreesDirectories,
} from "../worktreesDirectory.ts";

export interface ProjectCreateInput extends ProjectCreatePayload {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export interface ProjectUpdateInput extends ProjectUpdatePayload {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export interface ProjectBootstrapInput extends ProjectCreateInput {}

export interface ProjectDeleteInput {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly force?: boolean;
  readonly deleteFolder?: boolean;
}

export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found.`;
  }
}

export class ProjectConflictError extends Schema.TaggedError<ProjectConflictError>()(
  "ProjectConflictError",
  {
    projectId: ProjectId,
    workspaceRoot: Schema.String,
    conflictingProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Workspace ${this.workspaceRoot} already belongs to project ${this.conflictingProjectId}.`;
  }
}

export class ProjectNotEmptyError extends Schema.TaggedError<ProjectNotEmptyError>()(
  "ProjectNotEmptyError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} is not empty.`;
  }
}

/** A change the project's rules refuse, such as an invalid script ID: the caller's input is wrong, nothing failed. */
export class ProjectInvalidError extends Schema.TaggedError<ProjectInvalidError>()(
  "ProjectInvalidError",
  { projectId: ProjectId, detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Refused before anything changed, or failed after the project was already removed. */
export class ProjectFolderDeleteError extends Schema.TaggedError<ProjectFolderDeleteError>()(
  "ProjectFolderDeleteError",
  {
    projectId: ProjectId,
    workspaceRoot: Schema.String,
    projectRemoved: Schema.Boolean,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProjectOperationError extends Schema.TaggedError<ProjectOperationError>()(
  "ProjectOperationError",
  {
    operation: Schema.Literals([
      "normalize-workspace",
      "read-project",
      "list-projects",
      "list-threads",
      "delete-thread",
      "dispatch-project-command",
    ]),
    projectId: Schema.optional(ProjectId),
    workspaceRoot: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project operation '${this.operation}' failed${this.projectId === undefined ? "" : ` for ${this.projectId}`}.`;
  }
}

export type ProjectServiceError =
  | ProjectNotFoundError
  | ProjectConflictError
  | ProjectNotEmptyError
  | ProjectInvalidError
  | ProjectFolderDeleteError
  | ProjectOperationError;

export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly create: (input: ProjectCreateInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly bootstrap: (
      input: ProjectBootstrapInput,
    ) => Effect.Effect<
      { readonly project: Project; readonly created: boolean },
      ProjectServiceError
    >;
    readonly update: (input: ProjectUpdateInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly delete: (input: ProjectDeleteInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly getById: (
      projectId: ProjectId,
      options?: { readonly includeDeleted?: boolean },
    ) => Effect.Effect<Option.Option<Project>, ProjectOperationError>;
    readonly getByWorkspaceRoot: (
      workspaceRoot: string,
      options?: { readonly includeDeleted?: boolean },
    ) => Effect.Effect<Option.Option<Project>, ProjectOperationError>;
    readonly snapshot: Effect.Effect<ProjectSnapshot, ProjectOperationError>;
    /**
     * A page of active projects in creation order, each with its repository
     * identity resolved, so a caller can match projects by repository.
     */
    readonly listPage: (input: {
      readonly cursor: number;
      readonly limit: number;
    }) => Effect.Effect<
      { readonly projects: ReadonlyArray<Project>; readonly nextCursor: number | null },
      ProjectOperationError
    >;
    readonly getShell: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectOperationError>;
    readonly listShells: (options?: {
      readonly projectIds?: ReadonlyArray<ProjectId>;
    }) => Effect.Effect<ReadonlyArray<OrchestrationProjectShell>, ProjectOperationError>;
  }
>()("codenine/project/ProjectService") {}

export const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projectEnrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const threadProjections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const legacyImporter = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
  const threadCommands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const isManagedWorktreePath = yield* makeIsManagedWorktreePath;
  const projectLocks = yield* KeyedLock.make<ProjectId>();
  const workspaceLocks = yield* KeyedLock.make<string>();

  const toProject = (
    row: ProjectStore.ProjectRow,
    enrichment: ProjectEnrichmentService.ProjectEnrichment | null,
  ): Project => ({
    id: row.projectId,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    repositoryIdentity: enrichment?.repositoryIdentity ?? null,
    faviconPath: row.faviconPath ?? enrichment?.faviconPath ?? null,
    defaultModelSelection: row.defaultModelSelection,
    defaultThreadEnvMode: row.defaultThreadEnvMode,
    autoPull: row.autoPull,
    projectIcon: row.projectIcon,
    scripts: row.scripts,
    pinnedAt: row.pinnedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

  const hydrate = Effect.fn("ProjectService.hydrate")(function* (row: ProjectStore.ProjectRow) {
    const enrichment =
      row.deletedAt === null
        ? yield* projectEnrichment.getAvailable(row.workspaceRoot)
        : yield* projectEnrichment.peek(row.workspaceRoot);
    return toProject(row, enrichment);
  });

  const readRow = (projectId: ProjectId, options?: { readonly includeDeleted?: boolean }) =>
    projects
      .get(projectId, options)
      .pipe(
        Effect.mapError(
          (cause) => new ProjectOperationError({ operation: "read-project", projectId, cause }),
        ),
      );

  const normalizeWorkspaceRoot = (input: {
    readonly projectId?: ProjectId;
    readonly workspaceRoot: string;
    readonly createIfMissing?: boolean;
  }) =>
    workspacePaths
      .normalizeWorkspaceRoot(input.workspaceRoot, {
        createIfMissing: input.createIfMissing ?? false,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectOperationError({
              operation: "normalize-workspace",
              ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
              workspaceRoot: input.workspaceRoot,
              cause,
            }),
        ),
      );

  const commit = Effect.fn("ProjectService.commit")(function* (command: ProjectCommand) {
    const { projectId } = command;
    const dispatchError = (cause: unknown) =>
      new ProjectOperationError({ operation: "dispatch-project-command", projectId, cause });
    const workspaceRoot = command.type === "project.delete" ? undefined : command.workspaceRoot;
    const planAndCommit = Effect.gen(function* () {
      const project = Option.getOrUndefined(yield* readRow(projectId, { includeDeleted: true }));
      const workspaceOwner =
        workspaceRoot === undefined
          ? undefined
          : Option.getOrUndefined(
              yield* projects
                .findActiveByWorkspaceRoot(workspaceRoot)
                .pipe(Effect.mapError(dispatchError)),
            );
      const now = yield* DateTime.now;
      const eventId = yield* idAllocator.allocate
        .event({ commandId: command.commandId })
        .pipe(Effect.mapError(dispatchError));
      const planned = planProjectCommand({
        command,
        state: { project, workspaceOwner },
        eventId,
        now,
      });
      if (Result.isSuccess(planned)) {
        const { receipt } = yield* eventSink.commitProjectCommand({
          commandId: command.commandId,
          projectId,
          commandType: command.type,
          acceptedAt: now,
          event: planned.success,
        });
        return receipt;
      }
      return yield* eventSink.commitRejectedProjectCommand({
        commandId: command.commandId,
        projectId,
        commandType: command.type,
        rejectedAt: now,
        error: encodeProjectCommandRejection(planned.failure),
      });
    });
    const receipt = yield* projectLocks
      .withLock(
        projectId,
        workspaceRoot === undefined
          ? planAndCommit
          : workspaceLocks.withLock(workspaceRoot, planAndCommit),
      )
      .pipe(Effect.mapError(dispatchError));
    if (receipt.projectId !== projectId || receipt.commandType !== command.type) {
      return yield* dispatchError(
        `Command ${command.commandId} was already used by ${receipt.commandType} for ${receipt.projectId}.`,
      );
    }
    // Retries re-plan against their own effects; the first receipt determines the outcome.
    if (receipt.status === "accepted") return;
    const rejection = Option.getOrUndefined(decodeProjectCommandRejection(receipt.error));
    switch (rejection?._tag) {
      case "ProjectWorkspaceConflictError":
        return yield* new ProjectConflictError({
          projectId,
          workspaceRoot: rejection.workspaceRoot,
          conflictingProjectId: rejection.conflictingProjectId,
        });
      case "ProjectCommandMissingProjectError":
        return yield* new ProjectNotFoundError({ projectId });
      case "ProjectCommandInvariantError":
        return yield* new ProjectInvalidError({ projectId, detail: rejection.detail });
      default:
        return yield* dispatchError(
          rejection ?? receipt.error ?? "The command was previously rejected.",
        );
    }
  }, withCommandMetrics);

  const readCommitted = Effect.fn("ProjectService.readCommitted")(function* (projectId: ProjectId) {
    const row = yield* readRow(projectId, { includeDeleted: true });
    if (Option.isNone(row)) {
      return yield* new ProjectOperationError({
        operation: "read-project",
        projectId,
        cause: "The accepted project command did not produce a project row.",
      });
    }
    return yield* hydrate(row.value);
  });

  const getById: ProjectService["Service"]["getById"] = Effect.fn("ProjectService.getById")(
    function* (projectId, options) {
      const row = yield* readRow(projectId, options);
      return Option.isNone(row) ? Option.none() : Option.some(yield* hydrate(row.value));
    },
  );

  const getByWorkspaceRoot: ProjectService["Service"]["getByWorkspaceRoot"] = Effect.fn(
    "ProjectService.getByWorkspaceRoot",
  )(function* (workspaceRoot, options) {
    const normalized = yield* normalizeWorkspaceRoot({ workspaceRoot });
    const row = yield* (
      options?.includeDeleted === true
        ? projects
            .list({ includeDeleted: true })
            .pipe(
              Effect.map((rows) =>
                Option.fromUndefinedOr(rows.find((row) => row.workspaceRoot === normalized)),
              ),
            )
        : projects.findActiveByWorkspaceRoot(normalized)
    ).pipe(
      Effect.mapError((cause) => new ProjectOperationError({ operation: "list-projects", cause })),
    );
    return Option.isNone(row) ? Option.none() : Option.some(yield* hydrate(row.value));
  });

  const create: ProjectService["Service"]["create"] = Effect.fn("ProjectService.create")(
    function* (input) {
      const workspaceRoot = yield* normalizeWorkspaceRoot({
        projectId: input.projectId,
        workspaceRoot: input.workspaceRoot,
        createIfMissing: input.createWorkspaceRootIfMissing ?? false,
      });
      yield* commit({
        type: "project.create",
        commandId: input.commandId,
        projectId: input.projectId,
        title: input.title,
        workspaceRoot,
        ...(input.scripts === undefined ? {} : { scripts: input.scripts }),
      });
      yield* projectEnrichment.invalidate([workspaceRoot]);
      return yield* readCommitted(input.projectId);
    },
  );

  const update: ProjectService["Service"]["update"] = Effect.fn("ProjectService.update")(
    function* (input) {
      const existing = yield* readRow(input.projectId);
      if (Option.isNone(existing)) {
        return yield* new ProjectNotFoundError({ projectId: input.projectId });
      }
      const previousRoot = existing.value.workspaceRoot;
      const workspaceRoot =
        input.workspaceRoot === undefined
          ? previousRoot
          : yield* normalizeWorkspaceRoot({
              projectId: input.projectId,
              workspaceRoot: input.workspaceRoot,
            });
      yield* commit({
        type: "project.meta.update",
        commandId: input.commandId,
        projectId: input.projectId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(workspaceRoot === previousRoot ? {} : { workspaceRoot }),
        ...(input.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: input.defaultModelSelection }),
        ...(input.autoPull === undefined ? {} : { autoPull: input.autoPull }),
        ...(input.projectIcon === undefined ? {} : { projectIcon: input.projectIcon }),
        ...(input.faviconPath === undefined ? {} : { faviconPath: input.faviconPath }),
        ...(input.defaultThreadEnvMode === undefined
          ? {}
          : { defaultThreadEnvMode: input.defaultThreadEnvMode }),
        ...(input.scripts === undefined ? {} : { scripts: input.scripts }),
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      });
      if (workspaceRoot !== previousRoot) {
        yield* projectEnrichment.invalidate([previousRoot, workspaceRoot]);
      }
      return yield* readCommitted(input.projectId);
    },
  );

  const bootstrap: ProjectService["Service"]["bootstrap"] = Effect.fn("ProjectService.bootstrap")(
    function* (input) {
      const existing = yield* getByWorkspaceRoot(input.workspaceRoot);
      if (Option.isSome(existing)) return { project: existing.value, created: false };
      return { project: yield* create(input), created: true };
    },
  );

  const deleteChildThread = Effect.fn("ProjectService.deleteChildThread")(function* (
    input: ProjectDeleteInput,
    threadId: ThreadId,
  ) {
    yield* legacyImporter.ensureTranscript(threadId);
    const projection = yield* threadProjections.getThreadRecords(threadId, [
      "runs",
      "attempts",
      "nodes",
      "runtimeRequests",
      "subagents",
      "providerSessions",
    ]);
    if (projection.thread.deletedAt !== null || projection.thread.projectId !== input.projectId) {
      return;
    }
    const command = {
      type: "thread.delete" as const,
      commandId: CommandId.make(`${input.commandId}:delete-thread:${threadId}`),
      threadId,
    };
    const now = yield* DateTime.now;
    const plan = yield* planThreadDeletion({
      command,
      projection,
      attachmentIds: yield* threadProjections.getThreadAttachmentIds(threadId),
      now,
      idAllocator,
    });
    const committed = yield* eventSink.commitCommand({
      commandId: command.commandId,
      commandType: command.type,
      threadId,
      acceptedAt: now,
      events: plan.events,
      effects: plan.effects,
    });
    if (
      committed.receipt.threadId !== command.threadId ||
      committed.receipt.commandType !== command.type
    ) {
      return yield* Effect.fail("The thread deletion command ID belongs to a different command.");
    }
    if (committed.receipt.status === "rejected") {
      return yield* Effect.fail(
        committed.receipt.error ?? "Thread deletion was previously rejected.",
      );
    }
  });

  const listProjectThreads = (projectId: ProjectId) =>
    threadProjections.getShellSnapshot({ projectId }).pipe(
      Effect.map((snapshot) => [...snapshot.threads, ...snapshot.archivedThreads]),
      Effect.mapError(
        (cause) => new ProjectOperationError({ operation: "list-threads", projectId, cause }),
      ),
    );

  const deleteChildThreads = Effect.fn("ProjectService.deleteChildThreads")(function* (
    input: ProjectDeleteInput,
    projectThreads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) {
    const { projectId } = input;
    if (projectThreads.length > 0 && input.force !== true) {
      return yield* new ProjectNotEmptyError({ projectId });
    }
    // Delete children durably before the project so a failed cascade can be retried.
    yield* Effect.forEach(
      projectThreads,
      (thread) =>
        threadCommands
          .withLock(thread.id, deleteChildThread(input, thread.id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectOperationError({ operation: "delete-thread", projectId, cause }),
            ),
          ),
      { concurrency: 1, discard: true },
    );
  });

  // Best-effort cleanup releases disabled instances kept alive by overrides; crashes have no replay to revisit deletion.
  const clearProjectSettingsOverrides = (projectId: ProjectId) =>
    serverSettings.updateSettings({ projectSettingsOverrides: { [projectId]: null } }).pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning(
          `Failed to clear settings overrides for deleted project ${projectId}.`,
          cause,
        ),
      ),
    );

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));
  const pathForms = (target: string) =>
    realPath(path.resolve(target)).pipe(
      Effect.map((real) => [...new Set([path.resolve(target), real])]),
    );

  /** Why a project's folder must stay, or null. Each rule checks the path as given and as resolved. */
  const folderDeletionRefusal = Effect.fn("ProjectService.folderDeletionRefusal")(function* (
    project: ProjectStore.ProjectRow,
    others: ReadonlyArray<ProjectStore.ProjectRow & { readonly forms: ReadonlyArray<string> }>,
  ) {
    const platform = yield* HostProcess.Platform;
    const key = (target: string) =>
      platform === "win32" || platform === "darwin" ? target.toLowerCase() : target;
    const within = (target: string, root: string) => isWithinRoot(path, key(target), key(root));
    const root = path.resolve(project.workspaceRoot);
    const roots = yield* pathForms(root);
    const home = yield* HostProcess.HomeDirectory;
    const homes = yield* pathForms(home);
    const baseDirs = yield* pathForms(config.baseDir);
    const serverDirs = [
      ...(yield* pathForms(config.cwd)),
      ...(yield* pathForms(import.meta.dirname)),
    ];
    // ManagedProjectFolders creates new projects' folders directly inside these.
    const managedParents = baseDirs.flatMap((baseDir) =>
      ["projects", "scratch"].map((name) => key(path.join(baseDir, name))),
    );
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.orElseSucceed(() => ({ worktreesDirectory: "", previousWorktreesDirectories: [] })),
    );
    const worktreeDirs = (yield* Effect.forEach(
      managedWorktreesDirectories(settings, config.worktreesDir, path, home),
      pathForms,
    )).flat();

    if (
      (yield* fileSystem.exists(root).pipe(Effect.orElseSucceed(() => false))) &&
      roots.at(-1) !== path.join(yield* realPath(path.dirname(root)), path.basename(root))
    ) {
      return "it is a symbolic link";
    }
    for (const candidate of roots) {
      const same = (dirs: ReadonlyArray<string>) => dirs.some((dir) => key(dir) === key(candidate));
      const holds = (dirs: ReadonlyArray<string>) => dirs.some((dir) => within(dir, candidate));
      const inside = (dirs: ReadonlyArray<string>) => dirs.some((dir) => within(candidate, dir));
      if (isFilesystemRoot(candidate, path)) return "it is the root of the file system";
      if (same(homes)) return "it is the home folder";
      if (holds(homes)) return "it contains the home folder";
      if (same(baseDirs)) return "it is Codenine's data folder";
      if (holds(baseDirs)) return "it contains Codenine's data folder";
      if (holds(serverDirs)) return "Codenine itself is running from it";
      if (holds(worktreeDirs)) return "it holds Codenine's worktrees";
      if (inside(worktreeDirs)) return "it is inside Codenine's worktrees folder";
      if (inside(baseDirs) && !managedParents.includes(key(path.dirname(candidate)))) {
        return "it is inside Codenine's data folder and is not a project folder Codenine created";
      }
      const contained = others.find((other) => other.forms.some((form) => within(form, candidate)));
      if (contained !== undefined) {
        return `it contains the project "${contained.title}" at ${contained.workspaceRoot}`;
      }
    }
    return null;
  });

  const planFolderDeletion = Effect.fn("ProjectService.planFolderDeletion")(function* (
    project: ProjectStore.ProjectRow,
    projectThreads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) {
    const others = yield* Effect.forEach(
      (yield* listRows).filter((other) => other.projectId !== project.projectId),
      (other) => pathForms(other.workspaceRoot).pipe(Effect.map((forms) => ({ ...other, forms }))),
    );
    const refusal = yield* folderDeletionRefusal(project, others);
    if (refusal !== null) {
      return yield* new ProjectFolderDeleteError({
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
        projectRemoved: false,
        detail: `Codenine won't delete ${project.workspaceRoot} because ${refusal}. Remove the project without deleting its folder, or delete the folder yourself.`,
      });
    }
    const otherRoots = others.flatMap((other) => other.forms);
    // Thread deletion keeps worktrees; once the project's folder is gone nothing would clean them up.
    const worktrees = yield* Effect.filter(
      new Set(
        projectThreads.flatMap((thread) =>
          thread.worktreePath === null ? [] : [path.resolve(thread.worktreePath)],
        ),
      ),
      (worktree) =>
        otherRoots.some((root) => isWithinRoot(path, root, worktree))
          ? Effect.succeed(false)
          : isManagedWorktreePath(worktree),
    );
    return [...worktrees, path.resolve(project.workspaceRoot)];
  });

  const deleteFolders = Effect.fn("ProjectService.deleteFolders")(function* (
    project: ProjectStore.ProjectRow,
    folders: ReadonlyArray<string>,
  ) {
    const failures: Array<string> = [];
    for (const folder of folders) {
      yield* fileSystem
        .remove(folder, { recursive: true, force: true })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning(`Failed to delete ${folder} of a deleted project.`, cause).pipe(
              Effect.andThen(Effect.sync(() => failures.push(`${folder} (${cause.message})`))),
            ),
          ),
        );
    }
    if (failures.length > 0) {
      return yield* new ProjectFolderDeleteError({
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
        projectRemoved: true,
        detail: `The project was removed, but Codenine could not delete ${failures.join(", ")}.`,
      });
    }
  });

  const deleteProject: ProjectService["Service"]["delete"] = Effect.fn("ProjectService.delete")(
    function* (input) {
      const { projectId } = input;
      // Read deleted rows so retries replay receipts and other command ids fail as not found.
      const existing = yield* readRow(projectId, { includeDeleted: true });
      if (Option.isNone(existing)) {
        return yield* new ProjectNotFoundError({ projectId });
      }

      const isFirstDelete = existing.value.deletedAt === null;
      const projectThreads = isFirstDelete ? yield* listProjectThreads(projectId) : [];
      // Refuse before anything changes, so a refused folder leaves the project intact.
      const folders =
        input.deleteFolder === true
          ? yield* planFolderDeletion(existing.value, projectThreads)
          : [];
      if (isFirstDelete) {
        yield* deleteChildThreads(input, projectThreads);
      }
      yield* commit({ type: "project.delete", commandId: input.commandId, projectId });
      if (isFirstDelete) {
        yield* clearProjectSettingsOverrides(projectId);
      }
      yield* projectEnrichment.invalidate([existing.value.workspaceRoot]);
      yield* deleteFolders(existing.value, folders);
      return yield* readCommitted(projectId);
    },
  );

  const enrichShell = (shell: OrchestrationProjectShell) =>
    projectEnrichment.getAvailable(shell.workspaceRoot).pipe(
      Effect.map((enrichment) => ({
        ...shell,
        repositoryIdentity: enrichment.repositoryIdentity,
      })),
    );

  const getShell: ProjectService["Service"]["getShell"] = Effect.fn("ProjectService.getShell")(
    function* (projectId) {
      const shell = yield* projects
        .getShell(projectId)
        .pipe(
          Effect.mapError(
            (cause) => new ProjectOperationError({ operation: "read-project", projectId, cause }),
          ),
        );
      return Option.isNone(shell) ? shell : Option.some(yield* enrichShell(shell.value));
    },
  );

  const listShells: ProjectService["Service"]["listShells"] = Effect.fn(
    "ProjectService.listShells",
  )(function* (options) {
    const shells = yield* projects
      .listShells(options)
      .pipe(
        Effect.mapError(
          (cause) => new ProjectOperationError({ operation: "list-projects", cause }),
        ),
      );
    return yield* Effect.forEach(shells, enrichShell, { concurrency: 16 });
  });

  const listRows = projects
    .list()
    .pipe(
      Effect.mapError((cause) => new ProjectOperationError({ operation: "list-projects", cause })),
    );

  const snapshot = Effect.gen(function* () {
    const rows = yield* listRows;
    const hydrated = yield* Effect.forEach(rows, hydrate, { concurrency: 8 });
    return {
      projects: hydrated,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    } satisfies ProjectSnapshot;
  });

  const listPage: ProjectService["Service"]["listPage"] = Effect.fn("ProjectService.listPage")(
    function* ({ cursor, limit }) {
      const rows = (yield* listRows).filter((project) => project.deletedAt === null);
      const projects = yield* Effect.forEach(
        rows.slice(cursor, cursor + limit),
        (row) =>
          hydrate(row).pipe(
            Effect.filterOrElse(
              (project) => project.repositoryIdentity !== null,
              (project) =>
                projectEnrichment
                  .readRepositoryIdentity(project.workspaceRoot)
                  .pipe(Effect.map((repositoryIdentity) => ({ ...project, repositoryIdentity }))),
            ),
          ),
        { concurrency: 8 },
      );
      return { projects, nextCursor: cursor + limit < rows.length ? cursor + limit : null };
    },
  );

  return ProjectService.of({
    create,
    bootstrap,
    update,
    delete: deleteProject,
    getById,
    getByWorkspaceRoot,
    snapshot,
    listPage,
    getShell,
    listShells,
  });
});

export const layer = Layer.effect(ProjectService, make).pipe(
  Layer.provide(ThreadCommandExecutor.layer),
);
