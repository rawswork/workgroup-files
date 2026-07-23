# Workgroup Files

Organize frequently used files and folders into hierarchical groups in the VS Code sidebar. Compatible with VS Code 1.91.1 and later.

## Features

- Create top-level and nested groups.
- Drag groups to reorganize their hierarchy.
- Add or remove files and folders from Explorer, editor tabs, or the Command Palette.
- Drag open editor tabs onto a group to add them.
- Open every registered file in a group from the Command Palette.
- Add line comments to registered files from the editor context menu or Command Palette.
- Browse registered folders and their contents in the tree.
- Expand or collapse all nested folders for an individual group.
- Import and export the group structure as JSON.

## Usage

1. Open **Workgroup Files** from the Activity Bar.
2. Select the top `+` icon and enter a name to create a top-level group.
3. Select a group's `+` icon to create a child group.
4. Right-click a file or folder in Explorer, then select **Workgroup Files: Add File to Group**.
5. Select a target group one level at a time. Select **Current group** to finish at the current level.

Drag a group onto another group to make it a child group. Drop it in empty tree space to move it back to the top level.

Click a file to open it. Click a registered folder to reveal it in Explorer. Use the group expand icon to open all nested folders in that group; select it again to collapse the group.

Place the cursor on a line in a registered file, then run **Workgroup Files: Add Comment at Cursor**. Comments are stored by file, not by group, and appear everywhere that file is registered in the sidebar.

Use the workspace setting `workgroupFiles.commentHighlighting` to turn editor comment highlights on or off. It is enabled by default.

## Management

- Use the pencil icon, or run **Workgroup Files: Rename Group**, to rename a group.
- Use the trash icon to delete a group and all of its contents.
- Use the minus icon to remove a registered file or folder from a group.
- Run **Workgroup Files: Export Groups** or **Workgroup Files: Import Groups** from the Command Palette to save or restore the group structure as JSON.
- Run **Workgroup Files: Open Group** to open every file registered in a selected group and its child groups.
- Run **Workgroup Files: Open Group Settings** to edit the extension's workspace settings JSON directly. Save the editor to apply changes immediately. This file is stored outside the project, so it is not tracked by Git.
- During import, paths that do not exist are silently skipped.

Group data is stored per workspace.

## Packaging a VSIX

```powershell
npm.cmd install -g @vscode/vsce
vsce package
```

Install the generated `.vsix` file from **Extensions: Install from VSIX...**.

---

# Workgroup Files (한국어)

자주 사용하는 파일과 폴더를 VS Code 사이드바에서 계층형 그룹으로 관리하는 확장입니다. VS Code 1.91.1 이상과 호환됩니다.

## 주요 기능

- 최상위 그룹과 하위 그룹 생성
- 그룹 드래그로 계층 구조 조정
- 탐색기, 편집기 탭, 명령 팔레트에서 파일·폴더 등록 및 제거
- 열린 편집기 탭을 그룹으로 드래그해 등록
- 명령 팔레트에서 그룹의 등록 파일 전체 열기
- 편집기 우클릭 메뉴 또는 명령 팔레트에서 등록 파일의 줄 코멘트 추가
- 등록한 폴더와 하위 항목 트리 탐색
- 그룹별 하위 폴더 전체 펼치기·접기
- 그룹 구조 JSON 가져오기·내보내기

## 사용 방법

1. 활동 표시줄에서 **Workgroup Files**를 엽니다.
2. 상단 `+` 아이콘을 눌러 최상위 그룹을 만듭니다.
3. 그룹 행의 `+` 아이콘을 눌러 하위 그룹을 만듭니다.
4. 탐색기에서 파일 또는 폴더를 우클릭하고 **Workgroup Files: Add File to Group**을 선택합니다.
5. 그룹을 한 단계씩 선택하고, 현재 단계에 등록하려면 **현재 그룹 선택**을 누릅니다.

그룹을 다른 그룹 위로 드래그하면 하위 그룹이 됩니다. 트리의 빈 공간에 놓으면 최상위 그룹으로 이동합니다.

파일을 클릭하면 열리고, 등록된 폴더를 클릭하면 탐색기에서 위치가 표시됩니다. 그룹의 펼치기 아이콘을 누르면 하위 폴더가 모두 열리며, 다시 누르면 그룹을 접습니다.

등록된 파일에서 커서를 원하는 줄에 둔 뒤 **Workgroup Files: Add Comment at Cursor** 명령을 실행하면 코멘트를 추가할 수 있습니다. 코멘트는 그룹이 아닌 파일별로 저장되며, 해당 파일이 등록된 모든 그룹 위치에 표시됩니다.

워크스페이스 설정 `workgroupFiles.commentHighlighting`으로 편집기 코멘트 강조 표시를 켜거나 끌 수 있으며, 기본값은 켜짐입니다.

## 관리

- 연필 아이콘 또는 **Workgroup Files: Rename Group** 명령으로 그룹 이름을 수정합니다.
- 휴지통 아이콘으로 그룹과 내부 항목을 삭제합니다.
- `−` 아이콘으로 등록된 파일 또는 폴더를 그룹에서 제거합니다.
- 명령 팔레트의 **Workgroup Files: Export Groups** 또는 **Workgroup Files: Import Groups**로 그룹 구성을 JSON 파일로 저장하거나 복원합니다.
- **Workgroup Files: Open Group** 명령으로 선택한 그룹과 하위 그룹에 등록된 모든 파일을 엽니다.
- **Workgroup Files: Open Group Settings** 명령으로 확장 전용 워크스페이스 설정 JSON을 직접 열어 수정할 수 있으며, 편집기를 저장하면 바로 반영됩니다. 이 파일은 프로젝트 밖에 저장되므로 Git에 추적되지 않습니다.
- 가져오기 중 존재하지 않는 경로는 별도 메시지 없이 제외됩니다.

그룹 데이터는 워크스페이스별로 저장됩니다.
