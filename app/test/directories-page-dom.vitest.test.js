import assert from "node:assert/strict";
import { test } from "vitest";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";
import { DirectoriesPage } from "../src/views/directories/DirectoriesPage.jsx";
import { RepositoryDirectories } from "../src/views/directories/RepositoryDirectories.jsx";

test("page retains accessible landmarks without a back action", () => {
  const host = document.createElement("div");
  document.body.append(host);
  let backs = 0;
  const dispose = render(
    () =>
      createComponent(DirectoriesPage, {
        visible: () => true,
        status: () => "Scanning",
        onBack: () => backs++,
      }),
    host,
  );
  assert.equal(
    host.querySelector("#directories-page").getAttribute("aria-labelledby"),
    "directories-title",
  );
  assert.equal(
    host.querySelector("#repository-status").getAttribute("role"),
    "status",
  );
  assert.equal(
    host.querySelector("#directory-list").getAttribute("aria-label"),
    "Repositories grouped by directory",
  );
  assert.equal(host.querySelector("#legacy-task-archives"), null);
  assert.equal(host.querySelector("#directories-back"), null);
  assert.equal(backs, 0);
  dispose();
  host.remove();
});

test("repository delete icon starts selection mode and bulk delete submits selected repositories", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const directories = [
    {
      path: "/work/apps",
      repositories: [
        {
          repository: {
            id: "repo-a",
            name: "alpha",
            repositoryPath: "/work/apps/alpha",
          },
          enabled: true,
        },
        {
          repository: {
            id: "repo-b",
            name: "beta",
            repositoryPath: "/work/apps/team/beta",
          },
          enabled: false,
        },
      ],
    },
  ];
  const deleted = [];
  const dispose = render(
    () =>
      createComponent(RepositoryDirectories, {
        directories: () => directories,
        pendingRepositoryId: () => null,
        onToggleRepository: () => {},
        onDeleteMany: async (ids) => deleted.push(ids),
      }),
    host,
  );

  const rootFolder = host.querySelector("details");
  rootFolder.open = false;
  rootFolder.dispatchEvent(new Event("toggle"));
  assert.equal(
    host.querySelector('[aria-label="2 hidden leaf nodes"]').textContent,
    "2",
  );
  rootFolder.open = true;
  rootFolder.dispatchEvent(new Event("toggle"));

  host.querySelector('button[aria-label="Delete Repository alpha"]').click();
  assert.match(host.textContent, /Delete selected \(1\)/);
  assert.equal(
    host.querySelector(
      'input[aria-label="Select repository alpha for deletion"]',
    ).checked,
    true,
  );
  host
    .querySelector('input[aria-label="Select repository beta for deletion"]')
    .click();
  assert.match(host.textContent, /Delete selected \(2\)/);
  host
    .querySelector('button[aria-label="Delete selected repositories"]')
    .click();
  await Promise.resolve();
  assert.deepEqual(deleted, [["repo-a", "repo-b"]]);
  assert.ok(host.querySelector('button[aria-label="Delete Repository alpha"]'));

  dispose();
  host.remove();
});
