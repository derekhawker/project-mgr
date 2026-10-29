import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { ActionMenu, ActionMenuItem, Button, Input } from "@ui-lib";
import { AppNotice } from "../../src/application/AppNotice.jsx";
import { NewWorkMenu } from "../../src/views/new-work/NewWorkMenu.jsx";
import { RepositoryToolsMenu } from "../../src/views/repository-tools/RepositoryToolsMenu.jsx";

function UpwardMenu() {
  const [open, setOpen] = createSignal(false);
  return (
    <ActionMenu
      label="Upward actions"
      direction="up"
      triggerId="upward-trigger"
      contentId="upward-content"
      open={open()}
      onRequestToggle={() => setOpen(!open())}
      onRequestClose={() => setOpen(false)}
    >
      <ActionMenuItem>Upward action</ActionMenuItem>
    </ActionMenu>
  );
}

function ToolsMenu() {
  const [open, setOpen] = createSignal(false);
  return (
    <RepositoryToolsMenu
      open={open}
      available={() => true}
      disabled={() => false}
      error={() => ""}
      groups={() => [
        { name: "Frontend", packageScripts: ["dev", "test"], makeTargets: [] },
        { name: "Backend", packageScripts: [], makeTargets: ["build"] },
      ]}
      onToggle={() => setOpen(!open())}
      onHandoff={() => {}}
      onRun={() => {}}
    />
  );
}

render(
  () => (
    <main>
      <Button id="standalone-control">Standalone</Button>
      <ActionMenu
        label="Actions"
        triggerId="action-trigger"
        contentId="action-content"
      >
        <ActionMenuItem id="action-item">Menu action</ActionMenuItem>
      </ActionMenu>
      <UpwardMenu />
      <NewWorkMenu onChoose={() => {}} />
      <Input id="spacing-field" aria-label="Example field" />
      <AppNotice message={() => "Example notice"} />
      <ToolsMenu />
    </main>
  ),
  document.querySelector("#app"),
);
