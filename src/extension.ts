import * as path from "node:path";
import * as vscode from "vscode";

interface FileGroup {
  name: string;
  files: string[];
  groups?: FileGroup[];
}

interface FileComment {
  id: string;
  filePath: string;
  line: number;
  character: number;
  text: string;
  createdAt: string;
}

function createCommentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type GroupPath = string[];
type FavoriteItem = GroupItem | FileItem | FolderItem | CommentItem;
const groupDragMimeType = "application/vnd.workgroup-files.group";

function groupKey(groupPath: GroupPath): string {
  return groupPath.join("\u001f");
}

function findGroup(groups: FileGroup[], groupPath: GroupPath): FileGroup | undefined {
  let currentGroups = groups;
  let current: FileGroup | undefined;
  for (const name of groupPath) {
    current = currentGroups.find((group) => group.name === name);
    if (!current) return undefined;
    currentGroups = current.groups ?? [];
  }
  return current;
}

function flattenGroups(groups: FileGroup[], parentPath: GroupPath = []): { label: string; path: GroupPath }[] {
  return groups.flatMap((group) => {
    const groupPath = [...parentPath, group.name];
    return [{ label: groupPath.join(" / "), path: groupPath }, ...flattenGroups(group.groups ?? [], groupPath)];
  });
}

function collectGroupFiles(group: FileGroup): string[] {
  return [...group.files, ...(group.groups ?? []).flatMap(collectGroupFiles)];
}

function isRegisteredFile(groups: FileGroup[], filePath: string): boolean {
  return groups.some((group) => group.files.some((registeredPath) => {
    if (registeredPath === filePath) return true;
    const relativePath = path.relative(registeredPath, filePath);
    return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
  }) || isRegisteredFile(group.groups ?? [], filePath));
}

async function sanitizeGroups(value: unknown): Promise<FileGroup[]> {
  if (!Array.isArray(value)) return [];
  const result: FileGroup[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as { name?: unknown; files?: unknown; groups?: unknown };
    if (typeof source.name !== "string" || !source.name.trim()) continue;
    const files: string[] = [];
    if (Array.isArray(source.files)) {
      for (const filePath of source.files) {
        if (typeof filePath !== "string") continue;
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          files.push(filePath);
        } catch {
          // Missing paths are intentionally excluded during import.
        }
      }
    }
    result.push({ name: source.name.trim(), files, groups: await sanitizeGroups(source.groups) });
  }
  return result;
}

async function sanitizeComments(value: unknown): Promise<FileComment[]> {
  if (!Array.isArray(value)) return [];
  const comments: FileComment[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Partial<FileComment>;
    if (typeof source.filePath !== "string" || typeof source.line !== "number" || typeof source.character !== "number" || typeof source.text !== "string") continue;
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(source.filePath));
      if (stat.type !== vscode.FileType.Directory) comments.push({ id: typeof source.id === "string" ? source.id : createCommentId(), filePath: source.filePath, line: source.line, character: source.character, text: source.text, createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString() });
    } catch {
      // Missing paths are intentionally excluded during import.
    }
  }
  return comments;
}

class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly group: FileGroup,
    public readonly groupPath: GroupPath,
    expanded: boolean,
    id: string,
  ) {
    super(group.name, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "workgroupFiles.group";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.description = `${group.files.length} file${group.files.length === 1 ? "" : "s"}`;
    this.id = id;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly groupPath: GroupPath,
    public readonly filePath: string,
    public readonly comments: FileComment[],
  ) {
    const uri = vscode.Uri.file(filePath);
    super(path.basename(filePath), comments.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.tooltip = filePath;
    this.description = `${vscode.workspace.asRelativePath(uri, false)}${comments.length ? ` · ${comments.length} comment${comments.length === 1 ? "" : "s"}` : ""}`;
    this.contextValue = "workgroupFiles.file";
    this.command = { command: "vscode.open", title: "Open File", arguments: [uri] };
  }
}

class CommentItem extends vscode.TreeItem {
  constructor(public readonly comment: FileComment) {
    super(`Ln ${comment.line + 1}: ${comment.text}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "workgroupFiles.comment";
    this.iconPath = new vscode.ThemeIcon("comment");
    this.tooltip = `${comment.filePath}:${comment.line + 1}\n${comment.text}`;
    this.command = { command: "workgroupFiles.openComment", title: "Open Comment", arguments: [comment] };
  }
}

class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly groupPath: GroupPath,
    public readonly folderPath: string,
    expanded: boolean,
    id: string,
  ) {
    const uri = vscode.Uri.file(folderPath);
    super(path.basename(folderPath), expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = uri;
    this.tooltip = folderPath;
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.contextValue = "workgroupFiles.folder";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.command = { command: "workgroupFiles.revealInExplorer", title: "Reveal Folder in Explorer", arguments: [this] };
    this.id = id;
  }
}

class GroupsProvider implements vscode.TreeDataProvider<FavoriteItem> {
  private readonly changed = new vscode.EventEmitter<FavoriteItem | undefined>();
  private readonly fullyExpandedGroups = new Set<string>();
  private treeVersion = 0;
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly getGroups: () => FileGroup[], private readonly getComments: () => FileComment[]) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  isGroupExpanded(groupPath: GroupPath): boolean {
    return this.fullyExpandedGroups.has(groupKey(groupPath));
  }

  toggleGroup(groupPath: GroupPath): boolean {
    const key = groupKey(groupPath);
    const expanded = !this.fullyExpandedGroups.has(key);
    if (expanded) this.fullyExpandedGroups.add(key);
    else this.fullyExpandedGroups.delete(key);
    this.treeVersion += 1;
    this.refresh();
    return expanded;
  }

  getTreeItem(element: FavoriteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FavoriteItem): Promise<FavoriteItem[]> {
    if (!element) return this.createGroupItems(this.getGroups(), []);
    if (element instanceof GroupItem) {
      return [...this.createGroupItems(element.group.groups ?? [], element.groupPath), ...(await this.createPathItems(element.groupPath, element.group.files))];
    }
    if (element instanceof FileItem) return element.comments.map((comment) => new CommentItem(comment));
    if (element instanceof FolderItem) {
      try {
        const expanded = this.isGroupExpanded(element.groupPath);
        return (await vscode.workspace.fs.readDirectory(vscode.Uri.file(element.folderPath)))
          .map(([name, type]) => {
            const entryPath = path.join(element.folderPath, name);
            return type === vscode.FileType.Directory ? new FolderItem(element.groupPath, entryPath, expanded, `folder:${entryPath}:${this.treeVersion}`) : new FileItem(element.groupPath, entryPath, this.getComments().filter((comment) => comment.filePath === entryPath));
          })
          .sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
      } catch {
        return [];
      }
    }
    return [];
  }

  private createGroupItems(groups: FileGroup[], parentPath: GroupPath): GroupItem[] {
    return groups.map((group) => {
      const groupPath = [...parentPath, group.name];
      const expanded = this.isGroupExpanded(groupPath);
      return new GroupItem(group, groupPath, expanded, `group:${groupKey(groupPath)}:${this.treeVersion}:${expanded}`);
    });
  }

  private async createPathItems(groupPath: GroupPath, paths: string[]): Promise<FavoriteItem[]> {
    const expanded = this.isGroupExpanded(groupPath);
    const items = await Promise.all(
      paths.map(async (itemPath) => {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(itemPath));
          return stat.type === vscode.FileType.Directory ? new FolderItem(groupPath, itemPath, expanded, `folder:${itemPath}:${this.treeVersion}`) : new FileItem(groupPath, itemPath, this.getComments().filter((comment) => comment.filePath === itemPath));
        } catch {
          return new FileItem(groupPath, itemPath, this.getComments().filter((comment) => comment.filePath === itemPath));
        }
      }),
    );
    return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
  }
}

class GroupDropController implements vscode.TreeDragAndDropController<FavoriteItem> {
  readonly dropMimeTypes = ["text/uri-list", groupDragMimeType];
  readonly dragMimeTypes = [groupDragMimeType];
  constructor(
    private readonly readGroups: () => FileGroup[],
    private readonly saveGroups: (groups: FileGroup[]) => Thenable<void>,
    private readonly refresh: () => void,
  ) {}

  handleDrag(source: readonly FavoriteItem[], dataTransfer: vscode.DataTransfer): void {
    const groups = source.filter((item): item is GroupItem => item instanceof GroupItem);
    if (groups.length) dataTransfer.set(groupDragMimeType, new vscode.DataTransferItem(JSON.stringify(groups.map((group) => group.groupPath))));
  }

  async handleDrop(target: FavoriteItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const groupDrop = dataTransfer.get(groupDragMimeType);
    if (groupDrop) {
      let sourcePaths: GroupPath[];
      try {
        sourcePaths = JSON.parse(await groupDrop.asString()) as GroupPath[];
      } catch {
        return;
      }
      const targetPath = target instanceof GroupItem ? target.groupPath : undefined;
      const groups = this.readGroups();
      const movingPaths = sourcePaths.filter((sourcePath) => {
        if (!findGroup(groups, sourcePath)) return false;
        if (targetPath && (groupKey(sourcePath) === groupKey(targetPath) || targetPath.slice(0, sourcePath.length).every((part, index) => part === sourcePath[index]))) return false;
        return true;
      });
      if (!movingPaths.length) {
        vscode.window.showWarningMessage("A group cannot be moved into itself or one of its child groups.");
        return;
      }
      const destination = targetPath ? findGroup(groups, targetPath) : undefined;
      const destinationGroups = destination ? (destination.groups ??= []) : groups;
      const movingGroupReferences = movingPaths.map((sourcePath) => findGroup(groups, sourcePath)).filter((group): group is FileGroup => Boolean(group));
      if (movingGroupReferences.some((group) => destinationGroups.some((candidate) => candidate !== group && candidate.name.toLocaleLowerCase() === group.name.toLocaleLowerCase()))) {
        vscode.window.showWarningMessage("A group with the same name already exists at the destination.");
        return;
      }
      const movingGroups: FileGroup[] = [];
      for (const sourcePath of movingPaths) {
        const parent = sourcePath.length > 1 ? findGroup(groups, sourcePath.slice(0, -1)) : undefined;
        const siblings = parent ? (parent.groups ?? []) : groups;
        const index = siblings.findIndex((group) => group.name === sourcePath[sourcePath.length - 1]);
        if (index >= 0) movingGroups.push(...siblings.splice(index, 1));
      }
      destinationGroups.push(...movingGroups);
      await this.saveGroups(groups);
      this.refresh();
      return;
    }
    const targetPath = target instanceof GroupItem || target instanceof FileItem || target instanceof FolderItem ? target.groupPath : undefined;
    if (!targetPath) return;
    const uriList = dataTransfer.get("text/uri-list");
    if (!uriList) return;
    const paths = (await uriList.asString())
      .split(/\r?\n/)
      .filter((value) => value && !value.startsWith("#"))
      .map((value) => vscode.Uri.parse(value))
      .filter((uri) => uri.scheme === "file")
      .map((uri) => uri.fsPath);
    const groups = this.readGroups();
    const group = findGroup(groups, targetPath);
    if (!group || !paths.length) return;
    const newPaths = paths.filter((filePath) => !group.files.includes(filePath));
    if (!newPaths.length) return;
    group.files.push(...newPaths);
    await this.saveGroups(groups);
    this.refresh();
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storageKey = "groups";
  const commentsStorageKey = "comments";
  const settingsDirectory = context.storageUri;
  const settingsUri = settingsDirectory ? vscode.Uri.joinPath(settingsDirectory, "workgroup-files.json") : undefined;
  let usesSettingsFile = false;
  let groupsCache = context.workspaceState.get<FileGroup[]>(storageKey, []);
  let commentsCache = context.workspaceState.get<FileComment[]>(commentsStorageKey, []);
  if (settingsUri) {
    try {
      const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString("utf8")) as { groups?: unknown; comments?: unknown };
      groupsCache = await sanitizeGroups(Array.isArray(parsed) ? parsed : parsed.groups);
      commentsCache = await sanitizeComments(Array.isArray(parsed) ? [] : parsed.comments);
      usesSettingsFile = true;
      await context.workspaceState.update(storageKey, groupsCache);
      await context.workspaceState.update(commentsStorageKey, commentsCache);
    } catch {
      // The editable settings file is optional until the user opens it.
    }
  }
  const readGroups = (): FileGroup[] => groupsCache;
  const readComments = (): FileComment[] => commentsCache;
  const commentMarker = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#F59E0B",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "resources", "comment-marker.svg"),
    gutterIconSize: "contain",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    isWholeLine: true,
  });
  const updateCommentMarkers = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (!vscode.workspace.getConfiguration("workgroupFiles").get<boolean>("commentHighlighting", true)) {
        editor.setDecorations(commentMarker, []);
        continue;
      }
      if (editor.document.uri.scheme !== "file") continue;
      const commentsByLine = new Map<number, FileComment[]>();
      for (const comment of commentsCache.filter((entry) => entry.filePath === editor.document.uri.fsPath && entry.line >= 0 && entry.line < editor.document.lineCount)) {
        commentsByLine.set(comment.line, [...(commentsByLine.get(comment.line) ?? []), comment]);
      }
      const decorations: vscode.DecorationOptions[] = [...commentsByLine.entries()].map(([lineNumber, comments]) => {
        const line = editor.document.lineAt(lineNumber);
        const message = comments.map((comment) => comment.text).join(" · ");
        const preview = message.length > 90 ? `${message.slice(0, 87)}...` : message;
        return {
          range: line.range,
          hoverMessage: message,
          renderOptions: {
            after: {
              contentText: `  💬 ${preview}`,
              color: "#D97706",
              fontStyle: "italic",
              margin: "0 0 0 1em",
            },
          },
        };
      });
      editor.setDecorations(commentMarker, decorations);
    }
  };
  const saveGroups = async (groups: FileGroup[]): Promise<void> => {
    groupsCache = groups;
    await context.workspaceState.update(storageKey, groups);
    if (usesSettingsFile && settingsUri && settingsDirectory) {
      await vscode.workspace.fs.createDirectory(settingsDirectory);
      await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(JSON.stringify({ version: 1, groups, comments: commentsCache }, undefined, 2), "utf8"));
    }
  };
  const saveComments = async (comments: FileComment[]): Promise<void> => {
    commentsCache = comments;
    await context.workspaceState.update(commentsStorageKey, comments);
    await saveGroups(groupsCache);
    updateCommentMarkers();
  };
  const provider = new GroupsProvider(readGroups, readComments);
  const treeView = vscode.window.createTreeView("workgroupFiles.groups", { treeDataProvider: provider, dragAndDropController: new GroupDropController(readGroups, saveGroups, () => provider.refresh()) });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    commentMarker,
    vscode.window.onDidChangeVisibleTextEditors(updateCommentMarkers),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("workgroupFiles.commentHighlighting")) updateCommentMarkers();
    }),
  );
  updateCommentMarkers();

  const reloadSettingsFile = async (): Promise<void> => {
    if (!settingsUri) return;
    try {
      const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString("utf8")) as { groups?: unknown; comments?: unknown };
      groupsCache = await sanitizeGroups(Array.isArray(parsed) ? parsed : parsed.groups);
      commentsCache = await sanitizeComments(Array.isArray(parsed) ? [] : parsed.comments);
      usesSettingsFile = true;
      await context.workspaceState.update(storageKey, groupsCache);
      await context.workspaceState.update(commentsStorageKey, commentsCache);
      provider.refresh();
      updateCommentMarkers();
    } catch {
      vscode.window.showErrorMessage("Workgroup Files settings could not be read. Check workgroup-files.json.");
    }
  };
  if (settingsUri) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.toString() === settingsUri.toString()) void reloadSettingsFile();
      }),
    );
  }

  const chooseGroup = async (placeholder: string): Promise<GroupPath | undefined> => {
    let candidates = readGroups();
    let selectedPath: GroupPath = [];
    while (candidates.length) {
      const items: { label: string; groupPath?: GroupPath; selectCurrent?: boolean }[] = candidates.map((group) => ({
        label: group.name,
        groupPath: [...selectedPath, group.name],
      }));
      if (selectedPath.length) items.unshift({ label: "$(check) 현재 그룹 선택", selectCurrent: true });
      const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
      if (!picked) return undefined;
      if (picked.selectCurrent) return selectedPath;
      selectedPath = picked.groupPath!;
      const selected = findGroup(readGroups(), selectedPath);
      candidates = selected?.groups ?? [];
    }
    return selectedPath.length ? selectedPath : undefined;
  };

  const addToGroup = async (uri?: vscode.Uri): Promise<void> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== "file") return;
    const targetPath = await chooseGroup("Choose a group");
    if (!targetPath) return;
    const groups = readGroups();
    const group = findGroup(groups, targetPath);
    if (!group || group.files.includes(target.fsPath)) return;
    group.files.push(target.fsPath);
    await saveGroups(groups);
    provider.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("workgroupFiles.createRootGroup", () => vscode.commands.executeCommand("workgroupFiles.createGroup")),
    vscode.commands.registerCommand("workgroupFiles.expandGroup", async (item: GroupItem) => {
      if (provider.isGroupExpanded(item.groupPath)) {
        provider.toggleGroup(item.groupPath);
        return;
      }
      provider.toggleGroup(item.groupPath);
    }),
    vscode.commands.registerCommand("workgroupFiles.createGroup", async (parentItem?: GroupItem) => {
      const groups = readGroups();
      const parentPath = parentItem instanceof GroupItem ? parentItem.groupPath : undefined;
      const parent = parentPath ? findGroup(groups, parentPath) : undefined;
      const siblings = parent ? (parent.groups ??= []) : groups;
      const name = await vscode.window.showInputBox({ prompt: "Group name", validateInput: (value) => (!value.trim() ? "Enter a group name." : siblings.some((group) => group.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()) ? "A group with that name already exists here." : undefined) });
      if (!name) return;
      siblings.push({ name: name.trim(), files: [] });
      await saveGroups(groups);
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.renameGroup", async (item?: GroupItem) => {
      const groups = readGroups();
      const targetPath = item?.groupPath ?? (await chooseGroup("Choose a group to rename"));
      if (!targetPath) return;
      const target = findGroup(groups, targetPath);
      if (!target) return;
      const parent = targetPath.length > 1 ? findGroup(groups, targetPath.slice(0, -1)) : undefined;
      const siblings = parent ? (parent.groups ?? []) : groups;
      const name = await vscode.window.showInputBox({
        prompt: "New group name",
        value: target.name,
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return "Enter a group name.";
          if (siblings.some((group) => group !== target && group.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return "A group with that name already exists here.";
          return undefined;
        },
      });
      if (!name || name.trim() === target.name) return;
      target.name = name.trim();
      await saveGroups(groups);
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.deleteGroup", async (item?: GroupItem) => {
      const groups = readGroups();
      const targetPath = item?.groupPath ?? (await chooseGroup("Choose a group to delete"));
      if (!targetPath) return;
      const target = findGroup(groups, targetPath);
      if (!target || (await vscode.window.showWarningMessage(`Delete group \"${target.name}\" and all its contents?`, { modal: true }, "Delete")) !== "Delete") return;
      const parent = targetPath.length > 1 ? findGroup(groups, targetPath.slice(0, -1)) : undefined;
      const siblings = parent ? (parent.groups ?? []) : groups;
      siblings.splice(
        siblings.findIndex((group) => group.name === targetPath[targetPath.length - 1]),
        1,
      );
      await saveGroups(groups);
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.addFileToGroup", addToGroup),
    vscode.commands.registerCommand("workgroupFiles.addComment", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== "file") return;
      const filePath = editor.document.uri.fsPath;
      if (!isRegisteredFile(readGroups(), filePath)) {
        const groupPath = await chooseGroup("Choose a group to add this file to");
        if (!groupPath) return;
        const groups = readGroups();
        const group = findGroup(groups, groupPath);
        if (!group) return;
        if (!group.files.includes(filePath)) {
          group.files.push(filePath);
          await saveGroups(groups);
          provider.refresh();
        }
      }
      const text = await vscode.window.showInputBox({ prompt: `Comment for line ${editor.selection.active.line + 1}`, validateInput: (value) => value.trim() ? undefined : "Enter a comment." });
      if (!text) return;
      const position = editor.selection.active;
      await saveComments([...readComments(), { id: createCommentId(), filePath, line: position.line, character: position.character, text: text.trim(), createdAt: new Date().toISOString() }]);
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.removeFileFromGroup", async (item?: vscode.Uri | FileItem | FolderItem) => {
      const groups = readGroups();
      if (item instanceof FileItem || item instanceof FolderItem) {
        const group = findGroup(groups, item.groupPath);
        const itemPath = item instanceof FileItem ? item.filePath : item.folderPath;
        if (!group) return;
        group.files = group.files.filter((filePath) => filePath !== itemPath);
        await saveGroups(groups);
        provider.refresh();
        return;
      }
      const target = item instanceof vscode.Uri ? item : vscode.window.activeTextEditor?.document.uri;
      if (!target || target.scheme !== "file") return;
      const matches = flattenGroups(groups).filter((entry) => findGroup(groups, entry.path)?.files.includes(target.fsPath));
      const picked = await vscode.window.showQuickPick(
        matches.map((entry) => ({ label: entry.label, groupPath: entry.path })),
        { placeHolder: "Choose a group to remove from" },
      );
      if (!picked) return;
      const group = findGroup(groups, picked.groupPath);
      if (!group) return;
      group.files = group.files.filter((filePath) => filePath !== target.fsPath);
      await saveGroups(groups);
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.openGroup", async () => {
      const groupPath = await chooseGroup("Choose a group");
      if (!groupPath) return;
      const group = findGroup(readGroups(), groupPath);
      if (!group) return;
      const files: string[] = [];
      for (const filePath of [...new Set(collectGroupFiles(group))]) {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          if (stat.type !== vscode.FileType.Directory) files.push(filePath);
        } catch {
          // Ignore unavailable paths.
        }
      }
      if (!files.length) return;
      if (files.length > 10) {
        const confirmed = await vscode.window.showWarningMessage(`Open ${files.length} files in \"${group.name}\"?`, { modal: true }, "Open");
        if (confirmed !== "Open") return;
      }
      for (const filePath of files) await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false, preserveFocus: true });
    }),
    vscode.commands.registerCommand("workgroupFiles.openComment", async (comment: FileComment) => {
      const document = await vscode.window.showTextDocument(vscode.Uri.file(comment.filePath));
      const position = new vscode.Position(comment.line, comment.character);
      document.selection = new vscode.Selection(position, position);
      document.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand("workgroupFiles.editComment", async (item?: CommentItem) => {
      if (!item) {
        vscode.window.showInformationMessage("Choose a comment from the Workgroup Files sidebar to edit it.");
        return;
      }
      const comment = readComments().find((candidate) => candidate.id === item.comment.id);
      if (!comment) return;
      const text = await vscode.window.showInputBox({ prompt: `Edit comment for line ${comment.line + 1}`, value: comment.text, validateInput: (value) => value.trim() ? undefined : "Enter a comment." });
      if (!text || text.trim() === comment.text) return;
      await saveComments(readComments().map((candidate) => candidate.id === comment.id ? { ...candidate, text: text.trim() } : candidate));
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.deleteComment", async (item?: CommentItem) => {
      if (!item) {
        vscode.window.showInformationMessage("Choose a comment from the Workgroup Files sidebar to delete it.");
        return;
      }
      const comment = readComments().find((candidate) => candidate.id === item.comment.id);
      if (!comment) return;
      const confirmed = await vscode.window.showWarningMessage("Delete this comment?", { modal: true }, "Delete");
      if (confirmed !== "Delete") return;
      await saveComments(readComments().filter((candidate) => candidate.id !== comment.id));
      provider.refresh();
    }),
    vscode.commands.registerCommand("workgroupFiles.revealInExplorer", async (item?: FolderItem) => {
      if (item instanceof FolderItem) {
        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(item.folderPath));
        return;
      }
      const groupPath = await chooseGroup("Choose a group");
      if (!groupPath) return;
      const group = findGroup(readGroups(), groupPath);
      if (!group) return;
      const folders: { label: string; description: string; folderPath: string }[] = [];
      for (const folderPath of group.files) {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(folderPath));
          if (stat.type === vscode.FileType.Directory) folders.push({ label: path.basename(folderPath), description: vscode.workspace.asRelativePath(folderPath, false), folderPath });
        } catch {
          // Ignore unavailable paths in the picker.
        }
      }
      const picked = await vscode.window.showQuickPick(folders, { placeHolder: "Choose a folder to reveal" });
      if (picked) await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(picked.folderPath));
    }),
    vscode.commands.registerCommand("workgroupFiles.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("workgroupFiles.openGroupSettings", async () => {
      if (!settingsUri) {
        vscode.window.showWarningMessage("Open a workspace folder to edit Workgroup Files settings.");
        return;
      }
      if (!usesSettingsFile) {
        usesSettingsFile = true;
        await saveGroups(readGroups());
      }
      await vscode.window.showTextDocument(settingsUri);
    }),
    vscode.commands.registerCommand("workgroupFiles.exportGroups", async () => {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri.with({ path: `${vscode.workspace.workspaceFolders[0].uri.path}/workgroup-files.json` }),
        filters: { JSON: ["json"] },
        saveLabel: "Export Groups",
      });
      if (!target) return;
      const contents = JSON.stringify({ version: 1, groups: readGroups(), comments: readComments() }, undefined, 2);
      await vscode.workspace.fs.writeFile(target, Buffer.from(contents, "utf8"));
      vscode.window.showInformationMessage("Workgroup Files groups exported.");
    }),
    vscode.commands.registerCommand("workgroupFiles.importGroups", async () => {
      const [source] = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ["json"] }, openLabel: "Import Groups" })) ?? [];
      if (!source) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(source)).toString("utf8"));
      } catch {
        vscode.window.showErrorMessage("The selected file is not valid JSON.");
        return;
      }
      const imported = await sanitizeGroups(Array.isArray(parsed) ? parsed : (parsed as { groups?: unknown })?.groups);
      const importedComments = await sanitizeComments(Array.isArray(parsed) ? [] : (parsed as { comments?: unknown })?.comments);
      const confirmed = await vscode.window.showWarningMessage("Replace the current Workgroup Files groups with the imported groups?", { modal: true }, "Replace");
      if (confirmed !== "Replace") return;
      await saveGroups(imported);
      await saveComments(importedComments);
      provider.refresh();
      vscode.window.showInformationMessage("Workgroup Files groups imported.");
    }),
  );
}

export function deactivate(): void {}
