import * as path from "node:path";
import * as vscode from "vscode";

interface FileGroup {
  name: string;
  files: string[];
  groups?: FileGroup[];
}

type GroupPath = string[];
type FavoriteItem = GroupItem | FileItem | FolderItem;

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
  ) {
    const uri = vscode.Uri.file(filePath);
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.tooltip = filePath;
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.contextValue = "workgroupFiles.file";
    this.command = { command: "vscode.open", title: "Open File", arguments: [uri] };
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

  constructor(private readonly getGroups: () => FileGroup[]) {}

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
    if (element instanceof FolderItem) {
      try {
        const expanded = this.isGroupExpanded(element.groupPath);
        return (await vscode.workspace.fs.readDirectory(vscode.Uri.file(element.folderPath)))
          .map(([name, type]) => {
            const entryPath = path.join(element.folderPath, name);
            return type === vscode.FileType.Directory ? new FolderItem(element.groupPath, entryPath, expanded, `folder:${entryPath}:${this.treeVersion}`) : new FileItem(element.groupPath, entryPath);
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
          return stat.type === vscode.FileType.Directory ? new FolderItem(groupPath, itemPath, expanded, `folder:${itemPath}:${this.treeVersion}`) : new FileItem(groupPath, itemPath);
        } catch {
          return new FileItem(groupPath, itemPath);
        }
      }),
    );
    return items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
  }
}

class GroupDropController implements vscode.TreeDragAndDropController<FavoriteItem> {
  readonly dropMimeTypes = ["text/uri-list"];
  readonly dragMimeTypes: string[] = [];
  constructor(
    private readonly readGroups: () => FileGroup[],
    private readonly saveGroups: (groups: FileGroup[]) => Thenable<void>,
    private readonly refresh: () => void,
  ) {}

  async handleDrop(target: FavoriteItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
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
  const settingsDirectory = context.storageUri;
  const settingsUri = settingsDirectory ? vscode.Uri.joinPath(settingsDirectory, "workgroup-files.json") : undefined;
  let usesSettingsFile = false;
  let groupsCache = context.workspaceState.get<FileGroup[]>(storageKey, []);
  if (settingsUri) {
    try {
      const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString("utf8")) as { groups?: unknown };
      groupsCache = await sanitizeGroups(Array.isArray(parsed) ? parsed : parsed.groups);
      usesSettingsFile = true;
      await context.workspaceState.update(storageKey, groupsCache);
    } catch {
      // The editable settings file is optional until the user opens it.
    }
  }
  const readGroups = (): FileGroup[] => groupsCache;
  const saveGroups = async (groups: FileGroup[]): Promise<void> => {
    groupsCache = groups;
    await context.workspaceState.update(storageKey, groups);
    if (usesSettingsFile && settingsUri && settingsDirectory) {
      await vscode.workspace.fs.createDirectory(settingsDirectory);
      await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(JSON.stringify({ version: 1, groups }, undefined, 2), "utf8"));
    }
  };
  const provider = new GroupsProvider(readGroups);
  const treeView = vscode.window.createTreeView("workgroupFiles.groups", { treeDataProvider: provider, dragAndDropController: new GroupDropController(readGroups, saveGroups, () => provider.refresh()) });
  context.subscriptions.push(treeView);

  const reloadSettingsFile = async (): Promise<void> => {
    if (!settingsUri) return;
    try {
      const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(settingsUri)).toString("utf8")) as { groups?: unknown };
      groupsCache = await sanitizeGroups(Array.isArray(parsed) ? parsed : parsed.groups);
      usesSettingsFile = true;
      await context.workspaceState.update(storageKey, groupsCache);
      provider.refresh();
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
    vscode.commands.registerCommand("workgroupFiles.expandGroup", async (item: GroupItem) => {
      if (provider.isGroupExpanded(item.groupPath)) {
        provider.toggleGroup(item.groupPath);
        return;
      }
      provider.toggleGroup(item.groupPath);
    }),
    vscode.commands.registerCommand("workgroupFiles.createGroup", async (parentItem?: GroupItem) => {
      const groups = readGroups();
      const parentPath = parentItem?.groupPath;
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
      const contents = JSON.stringify({ version: 1, groups: readGroups() }, undefined, 2);
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
      const confirmed = await vscode.window.showWarningMessage("Replace the current Workgroup Files groups with the imported groups?", { modal: true }, "Replace");
      if (confirmed !== "Replace") return;
      await saveGroups(imported);
      provider.refresh();
      vscode.window.showInformationMessage("Workgroup Files groups imported.");
    }),
  );
}

export function deactivate(): void {}
