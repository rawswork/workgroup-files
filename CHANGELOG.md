# Changelog

## 0.1.3

- Added direct editing through **Open Group Settings**. The workspace settings JSON is stored in VS Code extension storage, outside the project and Git tracking.
- Moved JSON import and export actions to the Command Palette to simplify the sidebar toolbar.
- Renamed the sidebar view to **Workgroup Files**.
- Replaced **Open File** with **Open Group**, which opens every registered file in a selected group and its child groups.
- Refined the settings toolbar icon.

### 한국어

- **Open Group Settings**를 통한 직접 편집 기능을 추가했습니다. 워크스페이스 설정 JSON은 프로젝트와 Git 추적 대상 밖의 VS Code 확장 저장소에 보관됩니다.
- 사이드바 도구 모음을 단순화하기 위해 JSON 가져오기·내보내기를 명령 팔레트로 이동했습니다.
- 사이드바 뷰 이름을 **Workgroup Files**로 통일했습니다.
- **Open File**을 제거하고, 선택한 그룹 및 하위 그룹의 등록 파일을 모두 여는 **Open Group**을 추가했습니다.
- 설정 도구 모음 아이콘을 개선했습니다.

## 0.1.2

- Enlarged the Activity Bar icon and added a `W` inside the folder.
- Redesigned sidebar action icons with thinner strokes.
- Replaced the refresh icon with a clearer circular arrow.

### 한국어

- 활동 표시줄 아이콘을 더 크게 보이도록 개선하고 폴더 안에 `W`를 추가했습니다.
- 사이드바 기능 아이콘을 더 얇은 선 형태로 정리했습니다.
- 새로고침 아이콘을 선명한 원형 화살표로 교체했습니다.

## 0.1.1

- The top sidebar `+` button now always creates a top-level group.
- Added group renaming from the Command Palette and the group-row pencil icon.

### 한국어

- 사이드바 상단 `+` 버튼으로 기존 그룹 유무와 관계없이 최상위 그룹을 바로 만들 수 있습니다.
- 명령 팔레트와 그룹 행의 연필 아이콘을 통한 그룹 이름 수정 기능을 추가했습니다.

## 0.1.0

- Replaced toolbar and tree action labels with icons.
- Added folder browsing, Explorer reveal, and editor-tab drag-and-drop registration.
- Added per-group recursive expand/collapse.
- Added nested groups and step-by-step group selection.
- Added JSON import/export; missing paths are skipped during import.
- Added usage documentation.

### 한국어

- 도구 모음과 트리 작업의 텍스트 표시를 아이콘으로 변경했습니다.
- 등록 폴더 탐색, 탐색기 위치 표시, 편집기 탭 드래그 등록을 추가했습니다.
- 그룹별 하위 폴더 전체 펼치기·접기 기능을 추가했습니다.
- 하위 그룹과 단계별 그룹 선택 기능을 추가했습니다.
- JSON 가져오기·내보내기를 추가했고, 가져오기 중 누락 경로는 제외됩니다.
- 사용 문서를 추가했습니다.
