import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  COMMAND_CONTRACT,
  COMMAND_NAMES,
  invokeCommand,
} from "../src/services/commandContract.js";
import { resultForCommand } from "./command-fixtures.js";

const root = join(process.cwd(), "src-tauri", "src", "lib.rs");
const rust = readFileSync(root, "utf8");
const management = readFileSync(
  join(process.cwd(), "src-tauri", "src", "management.rs"),
  "utf8",
);
const handler = rust.match(/generate_handler!\s*\[([\s\S]*?)\]\)/)?.[1] || "";
const rustCommands = [...handler.matchAll(/\b([a-z][a-z0-9_]*)\s*,?/g)].map(
  (match) => match[1],
);
const rustAttributes = [
  ...rust.matchAll(
    /#\[tauri::command(?:\([^]]*\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z][a-z0-9_]*)/g,
  ),
].map((match) => match[1]);
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const newWorkMenu = readFileSync(
  join(process.cwd(), "src/views/new-work/NewWorkMenu.jsx"),
  "utf8",
);
const newWorkDialog = readFileSync(
  join(process.cwd(), "src/views/new-work/NewWorkDialog.jsx"),
  "utf8",
);
const ownerPanel = readFileSync(
  join(process.cwd(), "src/views/workbench/WorkspaceOwnerPanel.jsx"),
  "utf8",
);
const appNotice = readFileSync(
  join(process.cwd(), "src/application/AppNotice.jsx"),
  "utf8",
);
const proposalRepositories = readFileSync(
  join(process.cwd(), "src/views/new-work/ProposalRepositoryList.jsx"),
  "utf8",
);
const quickRequestHistoryPage = readFileSync(
  join(process.cwd(), "src/views/quick-requests/QuickRequestHistoryPage.jsx"),
  "utf8",
);
const repositoryToolsMenu = readFileSync(
  join(process.cwd(), "src/views/repository-tools/RepositoryToolsMenu.jsx"),
  "utf8",
);
const directoriesPageMarkup = readFileSync(
  join(process.cwd(), "src/views/directories/DirectoriesPage.jsx"),
  "utf8",
);
const workbenchShell = readFileSync(
  join(process.cwd(), "src/views/workbench/WorkbenchShell.jsx"),
  "utf8",
);
const rightContentShell = readFileSync(
  join(process.cwd(), "src/application/RightContentShell.jsx"),
  "utf8",
);
const commandResult = readFileSync(
  join(process.cwd(), "src/application/CommandResult.jsx"),
  "utf8",
);
const applicationShellStatus = readFileSync(
  join(process.cwd(), "src/application/ApplicationShellStatus.jsx"),
  "utf8",
);
const applicationShellView = readFileSync(
  join(process.cwd(), "src/application/applicationShellView.js"),
  "utf8",
);
const shell = readFileSync(
  join(process.cwd(), "src/services/shell.js"),
  "utf8",
);
const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
const workbenchSessions = readFileSync(
  join(process.cwd(), "src/views/workbench/createWorkbenchSessions.js"),
  "utf8",
);
const frontendFiles = readdirSync(join(process.cwd(), "src"), {
  recursive: true,
}).filter((name) => /\.(?:js|jsx)$/.test(name));
const directoriesNavigationButton = readFileSync(
  join(process.cwd(), "src/views/directories/DirectoriesNavigationButton.jsx"),
  "utf8",
);
const uiMarkup = `${html}\n${workbenchShell}\n${rightContentShell}\n${newWorkMenu}\n${newWorkDialog}\n${ownerPanel}\n${appNotice}\n${proposalRepositories}\n${quickRequestHistoryPage}\n${repositoryToolsMenu}\n${directoriesPageMarkup}\n${directoriesNavigationButton}\n${commandResult}\n${applicationShellStatus}`;

test("startup and command result feedback share the production Solid shell view", () => {
  assert.match(html, /<div id="application-status-root"><\/div>/);
  assert.match(
    applicationShellStatus,
    /<div class="response-panel" id="response-panel">/,
  );
  assert.match(
    commandResult,
    /id="command-result" class="command-result">\{message\(\)\}/,
  );
  assert.match(applicationShellView, /result: 'Waiting for app_shell_info…'/);
  assert.match(main, /const shellView = createApplicationShellView\(\)/);
  assert.match(main, /loadApplicationShell\(\{ invoke, view: shellView \}\)/);
  assert.match(main, /ApplicationShellStatus\(\{ state: shellView.state \}\)/);
  assert.match(
    applicationShellStatus,
    /<CommandResult message=\{\(\) => state\(\).result\} \/>/,
  );
  assert.match(main, /const setCommandResultMessage = shellView.setResult/);
  assert.equal(
    (main.match(/setCommandResultMessage\(message\)/g) || []).length,
    2,
  );
  assert.doesNotMatch(
    `${main}\n${shell}`,
    /(?:commandResult|connectionStatus|appVersion)\.textContent\s*=|connectionIndicator\.classList/,
  );
});

test("one Solid application root owns native subscriptions and polling for the page lifetime", () => {
  assert.match(main, /const appLifetime = createApplicationLifetime\(/);
  assert.match(main, /appLifetime\.mount\(/);
  assert.equal((main.match(/appLifetime\.mount\(/g) || []).length, 1);
  assert.match(main, /export const terminalRuntime = appLifetime\s*\.start\(/);
  assert.match(
    main,
    /import\.meta\.hot\.dispose\(\(\) => appLifetime\.dispose\(\)\)/,
  );
  assert.equal((main.match(/appLifetime\.dispose\(/g) || []).length, 1);
  assert.doesNotMatch(main, /\b(?:render|listen|setInterval)\(/);
});

test("checked-in command inventory has one contract for every registered Rust command", () => {
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustCommands].sort());
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustAttributes].sort());
});

test("the production screen mounts one component tree without selector-based mount targets", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.match(html, /<div id="app-root"><\/div>/);
  assert.doesNotMatch(main, /document\.querySelector\(/);
  assert.doesNotMatch(main, /#[a-z-]+-root/);
});

test("repository tool action status and availability are Solid-owned", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(
      process.cwd(),
      "src/views/repository-tools/repositoryToolsController.js",
    ),
    "utf8",
  );
  assert.match(
    repositoryToolsMenu,
    /createSignal\('Dependencies missing · npm install'\)/,
  );
  assert.match(
    repositoryToolsMenu,
    /role="status"[^>]*hidden=\{handoffHidden\(\)\}/,
  );
  assert.match(repositoryToolsMenu, /disabled=\{handoffDisabled\(\)\}/);
  assert.match(main, /createRepositoryToolsController\(/);
  assert.match(
    main,
    /\.\.\.createRepositoryToolsActionForwarders\(repositoryToolActions\)/,
  );
  assert.doesNotMatch(main, /\.\.\.repositoryToolActions\(\)/);
  assert.match(controller, /onHandoff: async \(action, view\)/);
  assert.match(controller, /onInstall: async \(repository, view\)/);
  assert.match(controller, /view\.setStatus\('Starting npm install…'\)/);
  assert.match(controller, /view\.setDisabled\(true\)/);
});

test("Directories repository toggle pending and checked state are Solid-owned", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(
      process.cwd(),
      "src/views/repository-tools/repositoryToolsController.js",
    ),
    "utf8",
  );
  const component = readFileSync(
    join(process.cwd(), "src/views/directories/RepositoryDirectories.jsx"),
    "utf8",
  );
  assert.match(component, /checked=\{entry\.enabled\}/);
  assert.match(
    component,
    /disabled=\{props\.pendingRepositoryId\(\) === entry\.repository\.id\}/,
  );
  assert.match(
    component,
    /onChange=\{\(event\) => props\.onToggle\(entry\.repository, event\.currentTarget\.checked\)\}/,
  );
  assert.match(
    main,
    /setPendingRepositoryId\(repository\.id\)[\s\S]*setRepositoryEnabled\(invoke, repository\.id, enabled\)[\s\S]*await refreshDirectories\(\)[\s\S]*await refreshCatalog\(\)[\s\S]*setRepositoryStatus\(formatWorkspaceError\('Update repository', error\)\)[\s\S]*setPendingRepositoryId\(null\)/,
  );
  assert.doesNotMatch(main, /checkbox\.(?:disabled|checked)\s*=/);
});

test("ticket Workbench selection does not expose tools until row Work is activated", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.doesNotMatch(ownerPanel, /Workspace options|attach-repository|complete-workspace|reactivate-workspace|workspace-session-form/);
  assert.match(main, /onSelect: \(filename\) => \{[\s\S]*setWorkbenchVisible\(false\)/);
  assert.match(main, /onWork: async \(filename\) => \{[\s\S]*setWorkbenchVisible\(true\)[\s\S]*await showSession\(session\.openCodeSessionId\)[\s\S]*ownerStatus\(\) === "Loading workspace…"\) setOwnerStatus\(""\)/);
});

test("proposal owner mode is presented and identified through the Solid signal", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalController.js"),
    "utf8",
  );
  assert.match(
    ownerPanel,
    /classList=\{\{ 'proposal-mode': props\.proposalMode\(\) \}\}/,
  );
  assert.match(
    main,
    /const \[proposalMode, setProposalMode\] = createSignal\(false\)/,
  );
  assert.match(
    main,
    /if \(proposalSessionId && proposalMode\(\)\) return 'proposal'/,
  );
  assert.match(
    main,
    /setProposalSessionId: \(sessionId\) => \{ proposalSessionId = sessionId; \}/,
  );
  assert.match(
    controller,
    /setProposalSessionId\(started\.sessionId\);\s*setProposalMode\(true\)/,
  );
  assert.doesNotMatch(
    main,
    /classList\.(?:add|remove|contains)\(['"]proposal-mode/,
  );
});

test("Quick Request model and submit disabled/busy attributes are Solid-owned", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.match(
    ownerPanel,
    /id="quick-model"[^>]*aria-busy=\{String\(props\.modelBusy\(\)\)\} disabled=\{props\.modelDisabled\(\)\}/,
  );
  assert.match(
    ownerPanel,
    /id="quick-submit"[^>]*disabled=\{props\.quickRequestBusy\(\) \|\| props\.modelDisabled\(\) \|\| props\.modelError\(\) \|\| props\.terminalRuntimeStartupFailed\(\)\}/,
  );
  assert.match(
    ownerPanel,
    /id="quick-request-form"[^>]*hidden aria-busy=\{String\(props\.quickRequestBusy\(\)\)\} onSubmit=\{props\.onQuickRequestSubmit\} onKeyDown=\{props\.onEnterToSubmit\}/,
  );
  assert.match(
    ownerPanel,
    /id="quick-prompt"[^>]*required[^>]*value=\{props\.quickPrompt\(\)\} onInput=\{\(event\) => props\.onQuickPromptInput\(event\.currentTarget\.value\)\}/,
  );
  assert.match(
    main,
    /const quickRequestFormView = createQuickRequestFormView\(\)/,
  );
  assert.match(
    main,
    /quickPrompt: quickRequestFormView\.getPrompt,[\s\S]*onQuickPromptInput: quickRequestFormView\.setPrompt,[\s\S]*quickRequestBusy: quickRequestFormView\.isBusy/,
  );
  assert.match(
    main,
    /createQuickRequestSubmitHandler\(\{\s*view: quickRequestFormView,\s*getSelectedModel: quickSelectedModel/,
  );
  assert.doesNotMatch(
    main,
    /querySelector\(['"]#quick-(?:prompt|submit|request-form)['"]\)/,
  );
  assert.match(main, /setTerminalRuntimeStartupFailed\(true\)/);
  assert.doesNotMatch(main, /querySelectorAll\('button'\)/);
  assert.match(
    main,
    /function setModelControls\(ready\)\s*\{\s*modelsReady = ready;\s*syncWorkspaceActionDisabled\(\);\s*\}/,
  );
  assert.doesNotMatch(
    main,
    /\bmodel\.disabled\s*=|\bmodel\.setAttribute\(['"]aria-busy['"]|\bsubmit\.disabled\s*=/,
  );
});

test("New-work dialog class and accessible name derive from Solid view and proposal state", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.match(
    newWorkDialog,
    /classList=\{\{ 'proposal-open': props\.reviewVisible\(\) \}\}/,
  );
  assert.match(
    newWorkDialog,
    /aria-label=\{props\.reviewVisible\(\) \? proposal\(\)\.title : labels\(\)\[2\]\}/,
  );
  assert.doesNotMatch(main, /newWorkDialog\.(?:classList|setAttribute)/);
  assert.match(main, /newWorkDialog\.showModal\(\)/);
  assert.match(main, /newWorkDialog\.close\(\)/);
});

test("New-work capture alert is rendered from its Solid signal and controller setters", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const dialogController = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkDialogController.js"),
    "utf8",
  );
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalController.js"),
    "utf8",
  );
  assert.match(
    newWorkDialog,
    /id="new-work-error"[^>]*role="alert">\{props\.captureError\(\)\}<\/p>/,
  );
  assert.match(
    main,
    /const \[newWorkCaptureError, setNewWorkCaptureError\] = createSignal\(''\)/,
  );
  assert.match(main, /captureError: newWorkCaptureError/);
  assert.match(main, /setCaptureError: setNewWorkCaptureError/);
  assert.match(dialogController, /setCaptureError\(''\)/);
  assert.match(main, /clearError: \(\) => setNewWorkCaptureError\(''\)/);
  assert.match(
    controller,
    /setCaptureError\(formatWorkspaceError\('Prepare proposal', failure\)\)/,
  );
  assert.doesNotMatch(main, /#new-work-error['"]\)\.textContent\s*=/);
});

test("New-work proposal-create disabled presentation is Solid-owned", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/quickRequestCreationController.js"),
    "utf8",
  );
  assert.match(
    newWorkDialog,
    /id="proposal-create" disabled=\{props\.proposalCreateDisabled\(\)\} onClick=\{props\.onConfirm\}/,
  );
  assert.match(main, /proposalCreateDisabled, /);
  assert.doesNotMatch(main, /proposalCreate\.disabled\s*=/);
  assert.match(
    controller,
    /finally\s*\{[\s\S]*setCreateDisabled\(ownerCreated[\s\S]*quickRequestDirectoryReady\(\)/,
  );
});

test("New-work proposal model selector disabled state is Solid-owned", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.match(
    newWorkDialog,
    /id="proposal-model" required disabled=\{props\.proposalModelDisabled\(\)\} aria-busy=\{props\.proposalModelDisabled\(\) \? 'true' : undefined\} value=\{props\.proposalSelectedModel\(\)\}/,
  );
  assert.match(
    main,
    /const \[proposalModelDisabled, setProposalModelDisabled\] = createSignal\(true\)/,
  );
  assert.match(main, /proposalModelDisabled,/);
  assert.match(main, /setProposalModelDisabled\(true\)/);
  assert.match(
    main,
    /view: \{[\s\S]*setProposalModels\(options\); setProposalSelectedModel\(selected\); setProposalModelDisabled\(false\)/,
  );
  assert.doesNotMatch(
    main,
    /proposalModel\.(?:replaceChildren|value)|proposalModel\.options/,
  );
  assert.doesNotMatch(main, /proposalModel\.disabled\s*=/);
});

test("New-work capture Continue busy state is Solid-owned by controller setters", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalController.js"),
    "utf8",
  );
  const quickRequestController = readFileSync(
    join(process.cwd(), "src/views/new-work/quickRequestCreationController.js"),
    "utf8",
  );
  assert.match(
    newWorkDialog,
    /type="submit" disabled=\{props\.captureDisabled\(\)\}>Continue/,
  );
  assert.match(
    main,
    /const \[newWorkCaptureDisabled, setNewWorkCaptureDisabled\] = createSignal\(false\)/,
  );
  assert.match(main, /captureDisabled: newWorkCaptureDisabled/);
  assert.match(
    controller,
    /const originalPrompt = getOriginalPrompt\(\);[\s\S]*if \(!originalPrompt\.trim\(\)\) return;[\s\S]*setBusy\(true\)[\s\S]*finally \{[\s\S]*setBusy\(false\)/,
  );
  assert.doesNotMatch(
    main,
    /#new-work-capture button\[type="submit"\]|continueButton\.disabled/,
  );
});

test("New-work original prompt is Solid-owned and passed unchanged through capture and Quick Request confirmation", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalController.js"),
    "utf8",
  );
  const quickRequestController = readFileSync(
    join(process.cwd(), "src/views/new-work/quickRequestCreationController.js"),
    "utf8",
  );
  const dialogController = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkDialogController.js"),
    "utf8",
  );
  assert.match(
    newWorkDialog,
    /id="new-work-prompt" required rows="3" placeholder="Describe the workspace" value=\{props\.prompt\(\)\} onInput=\{\(event\) => props\.setPrompt\(event\.currentTarget\.value\)\}/,
  );
  assert.match(
    main,
    /const \[newWorkPromptValue, setNewWorkPromptValue\] = createSignal\(''\)/,
  );
  assert.match(
    main,
    /prompt: newWorkPromptValue,[\s\S]*setPrompt: setNewWorkPromptValue/,
  );
  assert.match(
    main,
    /const \{ open: openNewWork[\s\S]*\} = newWorkDialogController/,
  );
  assert.match(main, /setPrompt: setNewWorkPromptValue/);
  assert.match(dialogController, /setPrompt\(''\)/);
  assert.match(
    controller,
    /runNewWorkProposal\([\s\S]*originalPrompt[\s\S]*renderProposal\(proposal, originalPrompt\)/,
  );
  assert.match(quickRequestController, /originalPrompt: getOriginalPrompt\(\)/);
  assert.doesNotMatch(main, /newWorkPrompt\.value/);
});

test("Change Review toolbar availability and selection are WorkbenchShell state", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/change-review/changeReviewController.js"),
    "utf8",
  );
  assert.match(workbenchShell, /hidden=\{!props\.changeReviewAvailable\(\)\}/);
  assert.match(workbenchShell, /props\.changeReviewSelected\(\)/);
  assert.match(
    main,
    /onOpenChangeReview: \(event\) => \{ setTicketViewerVisible\(false\); void handleChangeReviewClick\(event\); \}/,
  );
  assert.match(
    controller,
    /async function handleChangeReviewClick\(event\)[\s\S]*if \(!workspace \|\| !getSelectedOwnerRepositoryCount\(\)\) return;[\s\S]*setChangeReviewDisabled\(true\)[\s\S]*await loadChangeReview\(invoke, ownerType, ownerId\)[\s\S]*getSelectedWorkspace\(\)\?\.id !== ownerId[\s\S]*setChangeReviewDisabled\(false\)/,
  );
  assert.doesNotMatch(main, /changeReviewButton\.addEventListener/);
  assert.match(controller, /setChangeReviewAvailable\(available\)/);
  assert.doesNotMatch(main, /changeReviewButton\.(?:hidden|classList)/);
});

test("Docs data and view wiring remain at the command adapter boundary", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.doesNotMatch(main, /changeReviewButton\.disabled/);
  assert.match(
    main,
    /const \[changeReviewDisabled, setChangeReviewDisabled\] = createSignal\(false\)/,
  );
  assert.match(main, /const docsView = createDocsView\(\)/);
  assert.match(main, /buttonDisabled: docsDisabled/);
  assert.match(main, /view: docsView/);
  assert.match(main, /DocsPane\(\{\s*\.\.\.docsView/);
  const pane = readFileSync(
    join(process.cwd(), "src/views/docs/DocsPane.jsx"),
    "utf8",
  );
  assert.match(pane, /createDocContentAdapter\(document\.defaultView\)/);
  assert.doesNotMatch(
    readFileSync(
      join(process.cwd(), "src/views/docs/docsController.js"),
      "utf8",
    ),
    /button\.disabled\s*=\s*(?:true|false|files\.length)/,
  );
});

test("Tools toolbar disabled state is presented by the repository-tools component from a Solid signal", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(
      process.cwd(),
      "src/views/repository-tools/repositoryToolsController.js",
    ),
    "utf8",
  );
  assert.match(
    repositoryToolsMenu,
    /triggerId="show-repo-tools"[\s\S]*disabled=\{props\.disabled\(\)\} hidden=\{!props\.available\(\)\} open=\{props\.open\(\)\}/,
  );
  assert.match(
    main,
    /const \[repositoryToolsDisabled, setRepositoryToolsDisabled\] = createSignal\(false\)/,
  );
  assert.match(main, /disabled: repositoryToolsDisabled/);
  assert.match(
    controller,
    /setDisabled\(true\)[\s\S]*finally \{ setDisabled\(false\); \}/,
  );
  assert.doesNotMatch(main, /repoToolsButton\.disabled/);
});

test("New-work progress is composed by Solid with shared rows, not a reparented child root", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/workspaceCreationController.js"),
    "utf8",
  );
  const progress = readFileSync(
    join(process.cwd(), "src/views/new-work/SetupProgressPanel.jsx"),
    "utf8",
  );
  assert.match(
    progress,
    /id="new-work-progress"[^>]*hidden=\{!props\.visible\(\)\}[^>]*aria-label="Setup progress" aria-live="polite"/,
  );
  assert.match(
    progress,
    /id="new-work-progress-steps"><SetupProgressList rows=\{props\.rows\} \/>/,
  );
  assert.match(
    newWorkDialog,
    /newWorkProgressDestination\(\s*props\.captureVisible\(\), props\.reviewVisible\(\), proposal\(\)\.workType/,
  );
  for (const destination of ["capture", "workspace", "quick_request"]) {
    assert.ok(
      newWorkDialog.includes(
        `<Show when={progressDestination() === '${destination}'}>`,
      ),
    );
  }
  assert.equal(
    (
      newWorkDialog.match(
        /<SetupProgressPanel visible=\{props\.progressVisible\} rows=\{props\.progressRows\} \/>/g,
      ) || []
    ).length,
    3,
  );
  assert.match(main, /progressRows,[\s\S]*captureError: newWorkCaptureError/);
  assert.match(main, /setProgressVisible\(true\)/);
  assert.doesNotMatch(
    main,
    /progressPanel|progressSteps|progressAnchor|renderSolid\(\(\) => SetupProgressList/,
  );
  assert.match(main, /\['workspace-setup-progress',/);
  assert.match(
    main,
    /setProgressRows\(\(rows\) => new Map\(rows\)\.set\(key, \{ label, status, detail \}\)\)/,
  );
  assert.match(progress, /<pre>\{row\.detail \|\| ''\}<\/pre>/);
  assert.match(controller, /Workspace create[\s\S]*failed/);
});

test("Workspace navigation owns its list and busy attribute through Solid", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const navigation = readFileSync(
    join(process.cwd(), "src/views/workbench/WorkspaceNavigation.jsx"),
    "utf8",
  );
  assert.match(html, /id="workspace-navigation-root"/);
  assert.doesNotMatch(html, /id="workspace-list"/);
  assert.match(
    navigation,
    /<ul id="workspace-list" aria-busy=\{String\(props\.busy\(\)\)\}>/,
  );
  assert.match(
    main,
    /const \[navigationBusy, setNavigationBusy\] = createSignal\(true\)/,
  );
  assert.match(main, /busy: navigationBusy/);
  assert.match(main, /setNavigationBusy,/);
  assert.doesNotMatch(
    main,
    /workspaceList|querySelector\(['"]#workspace-list['"]\)/,
  );
});

test("repository directory management is a page opened from top navigation", () => {
  const nav =
    html.match(/<aside class="navigation"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.match(nav, /id="show-directories-root"/);
  assert.match(
    nav,
    /id="workspace-navigation-root"[\s\S]*id="show-directories-root"[\s\S]*id="new-work-menu-root"/,
  );
  assert.match(
    directoriesNavigationButton,
    /id="show-directories"[^>]*aria-label="Open directories"[^>]*onClick=\{props\.onOpen\}>☰ Directories/,
  );
  assert.match(rightContentShell, /id="directories-page-root"/);
  const directoriesPage = readFileSync(
    join(process.cwd(), "src/views/directories/DirectoriesPage.jsx"),
    "utf8",
  );
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/directories/directoriesController.js"),
    "utf8",
  );
  assert.match(
    directoriesPage,
    /id="directories-page"[\s\S]*id="directories-library-form-root"[\s\S]*id="directory-list"[\s\S]*id="directories-back"/,
  );
  assert.match(directoriesPage, /hidden={!props\.visible\(\)}/);
  assert.match(
    directoriesPage,
    /id="repository-status" role="status" aria-live="polite">\{props\.status\(\)\}/,
  );
  assert.match(
    main,
    /const \[repositoryStatus, setRepositoryStatus\] = createSignal\(''\)/,
  );
  assert.match(
    main,
    /DirectoriesPage\(\{ visible: directoriesVisible, status: repositoryStatus/,
  );
  assert.doesNotMatch(
    main,
    /querySelector\(['"]#repository-status['"]\)[^;\n]*textContent\s*=/,
  );
  assert.match(
    main,
    /const \[directoriesVisible, setDirectoriesVisible\] = createSignal\(false\)/,
  );
  assert.match(main, /directoriesController\.showPage\(\)/);
  assert.match(
    controller,
    /setFullRequestVisible\(false\); setDirectoriesVisible\(true\)/,
  );
  assert.match(main, /directoriesController\.returnFromPage\(\)/);
  assert.match(main, /DirectoriesNavigationButton\(\{ onOpen:/);
  assert.match(
    controller,
    /function returnFromPage\(\) \{ setDirectoriesVisible\(false\);/,
  );
  assert.doesNotMatch(main, /#directories-page['"]\)\.hidden/);
  assert.match(directoriesPage, /id="directories-library-form-root"/);
  const directoriesForm = readFileSync(
    join(process.cwd(), "src/views/directories/DirectoriesLibraryForm.jsx"),
    "utf8",
  );
  assert.match(
    directoriesForm,
    /id="repository-library-form"[\s\S]*id="repository-library-path"[\s\S]*id="choose-repository-library"/,
  );
  assert.match(
    directoriesForm,
    /id="add-repository-directories"[^>]*disabled=\{props\.addingDirectories\(\)\}/,
  );
  assert.match(
    main,
    /const \[repositoryDirectoriesBusy, setRepositoryDirectoriesBusy\] = createSignal\(false\)/,
  );
  assert.match(main, /addingDirectories: repositoryDirectoriesBusy/);
  assert.doesNotMatch(main, /add-repository-directories['"]\)\.disabled/);
  assert.match(directoriesPage, /id="directory-list"/);
  assert.doesNotMatch(
    html,
    /id="disallowed-repository-list"|id="repository-list"/,
  );
  assert.doesNotMatch(html, /id="scan-path"|id="scan-repositories"/);
});

test("proposal review uses a compact repository path list and has one starting prompt field", () => {
  assert.match(
    newWorkDialog,
    /<ul id="proposal-repositories" class="proposal-repository-list" \/>/,
  );
  assert.match(
    newWorkDialog,
    /id="workspace-review-name" type="text" required maxlength="120" value=\{props\.workspaceName\(\)\} onInput=\{\(event\) => props\.setWorkspaceName\(event\.currentTarget\.value\)\}/,
  );
  assert.match(newWorkDialog, /id="workspace-review-directory"/);
  assert.match(
    newWorkDialog,
    /<TextArea id="workspace-original-prompt" rows="3" readOnly value=\{proposal\(\)\.originalPrompt\} \/>/,
  );
  assert.match(
    newWorkDialog,
    /<label for="proposal-prompt">Starting prompt<\/label>/,
  );
  assert.match(
    newWorkDialog,
    /<TextArea id="proposal-prompt" rows="4" value=\{props\.startingPrompt\(\)\} onInput=\{\(event\) => props\.setStartingPrompt\(event\.currentTarget\.value\)\} \/>/,
  );
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/workspaceCreationController.js"),
    "utf8",
  );
  assert.match(main, /setReviewWorkspaceName\(review\.workspaceName\)/);
  assert.match(main, /setReviewStartingPrompt\(review\.startingPrompt\)/);
  assert.match(controller, /const startingPrompt = getStartingPrompt\(\)/);
  assert.match(
    controller,
    /const workspaceName = getWorkspaceName\(\)\.trim\(\)/,
  );
  assert.doesNotMatch(
    main,
    /querySelector\('#(?:proposal-prompt|workspace-review-name)'\)\.value/,
  );
  assert.doesNotMatch(html, /proposal-grid/);
  assert.doesNotMatch(html, /Pinned submodules|Workspace clone:/);
});

test("Quick Requests use a dedicated available-height page with a visible way back and no owner controls", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const quickLists = readFileSync(
    join(process.cwd(), "src/views/quick-requests/QuickRequestList.jsx"),
    "utf8",
  );
  const quickHistoryController = readFileSync(
    join(
      process.cwd(),
      "src/views/quick-requests/quickRequestHistoryController.js",
    ),
    "utf8",
  );
  assert.match(html, /id="quick-request-list"/);
  assert.match(
    quickRequestHistoryPage,
    /<section id="quick-request-full-list"[^>]*hidden=\{!props\.visible\(\)\}/,
  );
  assert.match(
    quickRequestHistoryPage,
    /id="quick-request-search"[^>]*onInput=/,
  );
  assert.match(quickRequestHistoryPage, /class="quick-request-full-items"/);
  assert.match(
    ownerPanel,
    /id="quick-request-back"[^>]*>Back to Quick Requests</,
  );
  assert.match(
    ownerPanel,
    /id="quick-request-terminal-actions"[^>]*hidden=\{!props\.quickRequestTerminalActions\(\)\}/,
  );
  assert.match(
    main,
    /quickRequestTerminalActions: quickRequestTerminalActionsVisible/,
  );
  assert.match(
    quickHistoryController,
    /await listQuickRequests\(invoke, history\)/,
  );
  assert.match(management, /request\.created_at >= recent_cutoff/);
  assert.match(
    rightContentShell,
    /'quick-request-terminal-page': props\.quickRequestTerminalPage\(\)/,
  );
  assert.match(main, /setQuickRequestTerminalPage\(isQuickRequest\)/);
  assert.doesNotMatch(
    main,
    /classList\.(?:add|remove|toggle)\(['"](?:owner-active|quick-request-terminal-page)/,
  );
  assert.match(main, /setWorkbenchVisible\(!isQuickRequest\)/);
  assert.match(
    ownerPanel,
    /id="selected-owner" hidden=\{!props\.visible\(\)\}/,
  );
  assert.match(main, /visible: selectedOwnerVisible/);
  assert.doesNotMatch(
    main,
    /selectedOwner\.hidden\s*=|querySelector\('#selected-owner'\)\.hidden\s*=/,
  );
  assert.doesNotMatch(main, /setTerminalFullscreen\(true\)/);
  assert.doesNotMatch(html, /id="new-task"/);
  assert.doesNotMatch(html, /id="new-work-type"/);
  assert.match(
    newWorkMenu,
    /id="new-work-menu"[\s\S]*data-new-work-type="quick_request"/,
  );
  assert.match(
    quickRequestHistoryPage,
    /id="new-quick-request"[^>]*onClick=\{props\.onNew\}>New Quick Request/,
  );
  assert.match(
    quickHistoryController,
    /Delete this Quick Request from the app\?/,
  );
  assert.match(quickLists, /class=\{styles\.prompt\}/);
  assert.match(
    quickLists,
    /<DeleteButton itemName=\{`Quick Request:[\s\S]*onClick=\{\(\) => props\.onDelete\(record\)\}/,
  );
  assert.match(
    quickLists,
    /<OpenItemButton\s+itemType="Quick Request"\s+itemName=\{prompt\(\)\}\s+onClick=\{\(\) => props\.onOpen\(record\)\}/,
  );
  assert.match(main, /deleteQuickRequestRecord\(record, true\)/);
  assert.doesNotMatch(quickLists, /dismiss|promote|retry/);
});

test("Quick Request navigation aligns its history icon button with the heading and omits Delete", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const quickLists = readFileSync(
    join(process.cwd(), "src/views/quick-requests/QuickRequestList.jsx"),
    "utf8",
  );
  assert.match(
    html,
    /<div class="quick-section-heading">\s*<h3>Quick Requests<\/h3>\s*<div id="show-history-root"><\/div>/,
  );
  const historyButton = readFileSync(
    new URL(
      "../src/views/quick-requests/QuickRequestHistoryButton.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    historyButton,
    /<IconButton id="show-history" label="See all Quick Requests" title="See all Quick Requests"/,
  );
  assert.match(historyButton, /<Icon name="list" \/>/);
  assert.match(historyButton, /onClick=\{props\.onShow\}/);
  assert.match(
    readFileSync(new URL("../src/main.js", import.meta.url), "utf8"),
    /QuickRequestHistoryButton\(\{ onShow:[\s\S]*?showQuickRequestList\(\)\.catch/,
  );
  assert.match(rightContentShell, /id="quick-request-history-root"/);
  assert.match(
    quickRequestHistoryPage,
    /<AppPageLayout\s+type="Quick Requests"\s+name="All"\s+id="quick-request-full-title">/,
  );
  assert.match(
    quickRequestHistoryPage,
    /id="quick-request-full-title"[\s\S]*id="new-quick-request"/,
  );
  assert.doesNotMatch(html, /id="back-from-quick-requests"/);
  assert.doesNotMatch(html, /id="history-disabled"/);
  assert.match(
    quickLists,
    /'quick-request-navigation-item': !props\.history\(\)/,
  );
  assert.match(
    quickLists,
    /'quick-request-navigation-item': !props\.history\(\)/,
  );
  assert.match(
    quickLists,
    /<OpenItemButton\s+itemType="Quick Request"[\s\S]*<DeleteButton itemName=/,
  );
  assert.match(main, /records: recentQuickRequests/);
  assert.doesNotMatch(quickLists, /item\.append\(button, remove\)/);
});

test("New-work is a modal over the existing workbench, with no standalone workspace creation path", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalController.js"),
    "utf8",
  );
  const quickRequestController = readFileSync(
    join(process.cwd(), "src/views/new-work/quickRequestCreationController.js"),
    "utf8",
  );
  assert.match(
    newWorkDialog,
    /<dialog id="new-work-dialog"[\s\S]*id="new-work"[\s\S]*id="new-work-review"[\s\S]*<\/dialog>/,
  );
  assert.doesNotMatch(
    html,
    /id="new-workspace"|id="workspace-create-form"|id="empty-workspaces"/,
  );
  assert.match(main, /newWorkDialog\.showModal\(\)/);
  assert.match(
    newWorkMenu,
    /id="new-work-menu"[\s\S]*data-new-work-type="workspace"[\s\S]*data-new-work-type="quick_request"/,
  );
  assert.match(newWorkMenu, /props\.onChoose\(type\)/);
  assert.doesNotMatch(html, /<select id="new-work-type"/);
  assert.match(
    newWorkDialog,
    /\['Workspace', 'Describe the workspace you want to create\.', 'New Workspace'\]/,
  );
  assert.match(
    newWorkDialog,
    /id="new-work-prompt-label"[^>]*>Original prompt</,
  );
  assert.match(
    newWorkDialog,
    /props\.workType\(\) === 'quick_request'[\s\S]*\['Quick Request', 'What do you want OpenCode to do\?'/,
  );
  assert.doesNotMatch(newWorkDialog, /\['Task'/);
  const proposalReview = readFileSync(
    join(process.cwd(), "src/views/new-work/newWorkProposalReview.js"),
    "utf8",
  );
  assert.match(
    proposalReview,
    /createLabel: isQuickRequest \? 'Confirm directory and start Quick Request' : 'Create Workspace'/,
  );
  assert.match(
    newWorkDialog,
    /id="proposal-create" disabled=\{props\.proposalCreateDisabled\(\)\} onClick=\{props\.onConfirm\}>\{proposal\(\)\.createLabel\}/,
  );
  assert.match(controller, /undefined, requestedType,/);
  assert.match(newWorkDialog, /id="quick-request-directory"/);
  assert.match(
    quickRequestController,
    /originalPrompt: getOriginalPrompt\(\),[\s\S]*model,[\s\S]*repositoryId: getRepositoryId\(\) \|\| null/,
  );
  assert.match(
    main,
    /setRequestedType: \(value\) => \{ requestedNewWorkType = value; \}/,
  );
  assert.doesNotMatch(
    main,
    /restoreWorkspacePendingPrompt/,
    "selecting a workspace must not restore the unsent starting-prompt editor",
  );
  assert.match(
    readFileSync(
      join(process.cwd(), "src/application/NoSelection.jsx"),
      "utf8",
    ),
    /Select a Workspace, or choose New work to start\./,
  );
  assert.match(
    newWorkDialog,
    /class="new-work-dialog-scroll"[\s\S]*class="new-work-dialog-footer"/,
  );
});

test("New-work offers only Workspace and Quick Request creation, not legacy Task creation", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  assert.match(
    newWorkMenu,
    /data-new-work-type="workspace"[\s\S]*data-new-work-type="quick_request"/,
  );
  assert.doesNotMatch(
    `${newWorkMenu}\n${html}`,
    /data-new-work-type="task"|workspace-context-new-task|task-workspace-select|task-review-name|task-revised-prompt/,
  );
  const dialogController = readFileSync(
    new URL(
      "../src/views/new-work/newWorkDialogController.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(dialogController, /new Set\(\['workspace', 'quick_request'\]\)/);
  assert.doesNotMatch(
    main,
    /createWorkspaceTask|currentProposal\.workType === 'task'/,
  );
});

test("regular Workspace navigation does not render retained legacy Task records", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const navigation = readFileSync(
    join(process.cwd(), "src/views/workbench/WorkspaceNavigation.jsx"),
    "utf8",
  );
  const renderNavigation =
    main.match(/function renderNavigation\(data\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(
    navigation,
    /\(props\.data\(\)\?\.workspaces \|\| \[\]\)\.filter/,
  );
  assert.match(main, /renderSolid\(\(\) => WorkspaceNavigation/);
  assert.doesNotMatch(renderNavigation, /data\.tasks|renderTasks|selectTask/);
  assert.doesNotMatch(html, /id="owner-tabs"/);
  assert.doesNotMatch(
    html,
    /id="task-setup-|id="new-task-session|id="complete-task|id="retry-cleanup|id="cleanup-history/,
  );
  assert.doesNotMatch(
    main,
    /refreshTaskSetup|createTaskSession|completeTask\(|cancelTaskSetup|resumeTaskSetup|retryTaskSetup/,
  );
});

test("Workspace confirmation opens its sessions and sends only the reviewed starting prompt", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(process.cwd(), "src/views/new-work/workspaceCreationController.js"),
    "utf8",
  );
  assert.match(
    main,
    /if \(currentProposal\.workType === 'workspace'\) \{\s*await workspaceCreationController\.createWorkspace\(\);\s*return;/,
  );
  assert.match(
    controller,
    /for \(const session of workspaceSessions\) await showSession\(session\.openCodeSessionId\);[\s\S]*if \(shouldSubmitWorkspaceStartingPrompt\(startingPrompt\)\)[\s\S]*await submitNewWorkStartingPrompt\(invoke, action, startingPrompt\);[\s\S]*No starting prompt was provided/,
  );
  assert.match(controller, /initialized\.sessions \|\| \[\]/);
  assert.doesNotMatch(main, /task-revised-prompt|taskPromptAction/);
  assert.doesNotMatch(main, /currentProposal\.workType === 'task'/);
  assert.match(newWorkDialog, /id="proposal-starting-prompt"/);
  assert.match(
    newWorkDialog,
    /id="proposal-starting-prompt"[^>]*hidden=\{proposal\(\)\.workType !== 'workspace'\}/,
  );
  assert.match(controller, /Retry setup/);
  assert.match(controller, /Retry session/);
});

test("pending starting-prompt editor and submit busy state are WorkspaceOwnerPanel signals", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const controller = readFileSync(
    join(
      process.cwd(),
      "src/views/workbench/pendingStartingPromptController.js",
    ),
    "utf8",
  );
  assert.match(
    main,
    /const \[pendingPromptText, setPendingPromptText\] = createSignal\(''\)/,
  );
  assert.match(
    ownerPanel,
    /id="pending-prompt-text"[^>]*value=\{props\.pendingPromptText\(\)\} onInput=/,
  );
  assert.match(main, /createPendingStartingPromptController\(/);
  assert.match(
    controller,
    /const promptText = getPromptText\(\);[\s\S]*if \(!promptText\.trim\(\)\)/,
  );
  assert.match(
    controller,
    /setDisabled\(true\);[\s\S]*await showSession\(action\.sessionId\);[\s\S]*submitStartingPrompt\(invoke, action, promptText\)[\s\S]*clearPendingAction\(\);[\s\S]*setPromptVisible\(false\);[\s\S]*setPromptText\(''\);[\s\S]*finally \{\s*setDisabled\(false\);/,
  );
  assert.doesNotMatch(
    main,
    /querySelector\('#pending-prompt-text'\)|querySelector\('#submit-starting-prompt'\)/,
  );
  assert.doesNotMatch(
    main,
    /querySelector\('#pending-prompt-text'\)|querySelector\('#submit-starting-prompt'\)/,
  );
});

test("terminal card contains only the terminal viewport and has no surrounding inset", () => {
  const main = readFileSync(join(process.cwd(), "src", "main.js"), "utf8");
  const pendingList = readFileSync(
    join(process.cwd(), "src/views/workbench/PendingInputList.jsx"),
    "utf8",
  );
  const terminalCard =
    ownerPanel.match(
      /<section class="terminal-card"[^>]*>([\s\S]*?)<\/section>/,
    )?.[1] || "";
  assert.match(
    terminalCard,
    /<div(?=[^>]*id="terminal-views")(?=[^>]*class="terminal-views")[^>]*\/>/s,
  );
  assert.match(
    main,
    /const \[sessionStatusMessage, setSessionStatusMessage\] = createSignal\(""\)/,
  );
  assert.match(
    ownerPanel,
    /id="session-status"[\s\S]*?role="status"[\s\S]*?\{props\.sessionStatus\(\)\}/,
  );
  assert.match(
    workbenchSessions,
    /const \[pendingInputRows, setPendingInputRows\] = createSignal\(\[\]\)/,
  );
  assert.match(
    pendingList,
    /onClick=\{\(\) => props\.onOpen\(item\.sessionId\)\}/,
  );
  assert.doesNotMatch(html, /fullscreen/i);
  assert.doesNotMatch(main, /setTerminalFullscreen|terminal-fullscreen/);
});

test("Workbench sessions own terminal maps outside application composition", () => {
  assert.match(main, /createWorkbenchSessions\(/);
  assert.doesNotMatch(
    main,
    /const (?:sessionOwners|sessionDirectories|openSessions) = new/,
  );
  assert.match(workbenchSessions, /const sessionOwners = new Map\(\)/);
  assert.doesNotMatch(main, /viewFactories|defineView\(/);
});

test("boundary catches the historical flat quick-request payload before Tauri", async () => {
  let sent = false;
  await assert.rejects(
    () =>
      invokeCommand(
        async () => {
          sent = true;
        },
        "quick_request_list",
        { history: true },
      ),
    /unknown field|missing request/,
  );
  assert.equal(sent, false);
  await assert.doesNotReject(() =>
    invokeCommand(
      async (name, payload) => {
        assert.equal(name, "quick_request_list");
        assert.deepEqual(payload, { request: { history: true } });
        return [];
      },
      "quick_request_list",
      { request: { history: true } },
    ),
  );
});

test("production frontend has no raw invoke call outside the boundary module", () => {
  const files = frontendFiles.filter(
    (name) => name !== "services/commandContract.js",
  );
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");
    assert.doesNotMatch(
      source,
      /@tauri-apps\/api\/core|\b(?:import|export)\s*\{[^}]*\binvoke\b|\b(?:import|export)\s*\*\s+as\s+\w+\s+from\s+['"]@tauri-apps\/api\/core|\b(?:const|let|var)\s+\w+\s*=\s*invoke\b|\b(?:window|globalThis|global)\.invoke\s*\(|\binvoke\s*\(/,
      `${file} contains a direct Tauri invoke`,
    );
  }
});

test("frontend command adapters only name commands present in the inventory", () => {
  const files = frontendFiles;
  const names = new Set();
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");
    for (const match of source.matchAll(
      /invokeCommand\([^,]+,\s*['"]([a-z][a-z0-9_]*)['"]/g,
    ))
      names.add(match[1]);
  }
  for (const name of names)
    assert.ok(
      COMMAND_NAMES.includes(name),
      `frontend adapter uses unlisted command ${name}`,
    );
  assert.deepEqual(
    [...names].sort(),
    [...COMMAND_NAMES].sort(),
    "frontend adapters must exactly cover the Rust command inventory",
  );
});

test("every manifest entry has executable payload and result rules", () => {
  for (const name of COMMAND_NAMES) {
    assert.ok(COMMAND_CONTRACT[name].payload);
    assert.ok(COMMAND_CONTRACT[name].result);
  }
});

test("contracts leave opaque JSON only at explicitly reviewed protocol/form seams", () => {
  const opaqueJsonPaths = new Set([
    "opencode_form_reply.payload.properties.request.properties.answer",
    "opencode_session_history.result.properties.data.items",
    "opencode_session_reconcile.result.properties.history.properties.data.items",
    "opencode_session_reconcile.result.properties.permissions.items",
    "opencode_session_reconcile.result.properties.forms.items",
    "opencode_session_reconcile.result.properties.durableEvents.items",
    "opencode_pending_inputs.result.properties.permissions.items",
    "opencode_pending_inputs.result.properties.forms.items",
    "opencode_pending_inputs_all.result.items.properties.permissions.items",
    "opencode_pending_inputs_all.result.items.properties.forms.items",
    "opencode_session_pending_inputs.result.properties.permissions.items",
    "opencode_session_pending_inputs.result.properties.forms.items",
  ]);
  const visit = (command, value, path) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "json") {
      assert.ok(
        opaqueJsonPaths.has(path),
        `unreviewed opaque contract path: ${path}`,
      );
    }
    if (value.type === "object") {
      assert.ok(
        value.properties || value.additionalProperties === true ||
          (value.additionalProperties && typeof value.additionalProperties === "object"),
        `object lacks fields at ${path}`,
      );
    }
    for (const [key, child] of Object.entries(value))
      visit(command, child, `${path}.${key}`);
  };
  for (const [name, spec] of Object.entries(COMMAND_CONTRACT)) {
    visit(name, spec.payload, `${name}.payload`);
    visit(name, spec.result, `${name}.result`);
  }
});

test("recursive validation rejects missing, null, nested, and unknown values", async () => {
  const validModel = { providerId: "openai", id: "gpt" };
  await assert.rejects(
    () =>
      invokeCommand(() => null, "quick_request_create", {
        request: { prompt: "hello", model: validModel, extra: true },
      }),
    /unknown field/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => null, "quick_request_create", {
        request: { prompt: null, model: validModel, repositoryId: null },
      }),
    /prompt must not be null/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => null, "quick_request_create", {
        request: {
          prompt: "hello",
          model: { providerId: "openai", id: 3 },
          repositoryId: null,
        },
      }),
    /model\.id must be string/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => null, "quick_request_create", {
        request: { model: validModel, repositoryId: null },
      }),
    /missing prompt/,
  );
});

test("result validation is recursive and errors retain command identity", async () => {
  const valid = {
    appName: "app",
    version: "1",
    status: "ready",
    message: "ok",
  };
  assert.deepEqual(await invokeCommand(() => valid, "app_shell_info"), valid);
  await assert.rejects(
    () => invokeCommand(() => ({ ...valid, extra: true }), "app_shell_info"),
    (error) => {
      assert.equal(error.command, "app_shell_info");
      return /unknown field/.test(error.message);
    },
  );
  await assert.rejects(
    () => invokeCommand(() => ({ ...valid, version: null }), "app_shell_info"),
    /version must not be null/,
  );
  await assert.rejects(
    () => invokeCommand(() => "not-an-object", "app_shell_info"),
    /result must be object/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => {
        throw "boom";
      }, "app_shell_info"),
    (error) => {
      assert.equal(error.command, "app_shell_info");
      return error.message === "Tauri command app_shell_info failed: boom";
    },
  );
});

test("command tagging and nested quick-request shape are enforced", async () => {
  await assert.rejects(
    () => invokeCommand(() => [], "quick_request_list", { history: true }),
    /unknown field|missing request/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => [], "quick_request_list", {
        request: { history: "yes" },
      }),
    /history must be boolean/,
  );
  await assert.rejects(
    () =>
      invokeCommand(() => [], "quick_request_list", {
        request: { history: true, extra: false },
      }),
    /unknown field/,
  );
});

test("preflight payload failures retain the command name before transport", async () => {
  await assert.rejects(
    () =>
      invokeCommand(
        () => {
          throw new Error("must not send");
        },
        "opencode_session_status",
        { sessionId: "ses-1", extra: true },
      ),
    (error) =>
      error.command === "opencode_session_status" &&
      /unknown field/.test(error.message),
  );
  await assert.rejects(
    () =>
      invokeCommand(() => null, "opencode_session_status", { sessionId: 7 }),
    (error) =>
      error.command === "opencode_session_status" &&
      /must be string/.test(error.message),
  );
});

test("task creation sends only task metadata and confirmed repository context, never prompt text", async () => {
  let sent = false;
  await assert.doesNotReject(() =>
    invokeCommand(
      async () => {
        sent = true;
        return resultForCommand("task_create");
      },
      "task_create",
      {
        request: {
          workspaceId: "workspace-1",
          model: { providerId: "openai", id: "gpt-6-luna" },
          name: "Parser fix",
          description: "Update the parser",
          repositoryIds: [],
        },
      },
    ),
  );
  assert.equal(sent, true);

  sent = false;
  await assert.rejects(
    () =>
      invokeCommand(
        async () => {
          sent = true;
        },
        "task_create",
        {
          request: {
            workspaceId: "workspace-1",
            model: { providerId: "openai", id: "gpt-6-luna", unexpected: true },
            name: "Parser fix",
            repositoryIds: [],
          },
        },
      ),
    /unknown field/,
  );
  assert.equal(sent, false);
  await assert.rejects(
    () =>
      invokeCommand(() => null, "task_create", {
        request: {
          workspaceId: "workspace-1",
          prompt: "Do not persist me",
          model: { providerId: "openai", id: "gpt-6-luna" },
          name: "Parser fix",
          repositoryIds: [],
        },
      }),
    /unknown field/,
  );
});
