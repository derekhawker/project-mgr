import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { presentationAliases } from "../vite.config.js";

const source = new URL("../src/", import.meta.url);
const ui = new URL("../packages/ui-lib/", import.meta.url);
const filesIn = (root) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
const uiSourceFiles = () => filesIn(ui).filter((file) => !file.startsWith(fileURLToPath(new URL("test/", ui))));
const componentNames = (text) => [
  ...text.matchAll(
    /(?:^|\n)(?:export\s+)?(?:function\s+([A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*=\s*(?:function\b|(?:\([^\n]*?\)|[A-Za-z_$]\w*)\s*=>|[A-Za-z_$]\w*(?:\.[A-Za-z_$]\w*)?\s*\())/g,
  ),
].map((match) => match[1] || match[2]);

test("component name detection ignores constants but includes local components", () => {
  assert.deepEqual(
    componentNames(`const PORT = /^\\d+$/;
function Local() {}
const Other = (props) => props;
const Wrapped = memo(() => <div />);
const Custom = wrappers.component(() => <div />);
export function Example() {}`),
    ["Local", "Other", "Wrapped", "Custom", "Example"],
  );
});

test("frontend root contains only the entry and global styles", () => {
  const entries = readdirSync(source, { withFileTypes: true });
  assert.deepEqual(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort(),
    ["main.js", "styles.css"],
  );
  assert.deepEqual(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    [
      "application",
      "components",
      "fixtures",
      "lib",
      "services",
      "terminal",
      "views",
    ],
  );
});

test("component files match their exported component names; plain modules use camelCase", () => {
  for (const file of [...filesIn(source), ...uiSourceFiles()]) {
    const name = basename(file, extname(file));
    if (file.endsWith(".jsx")) {
      assert.match(name, /^[A-Z][A-Za-z0-9]*$/, file);
      const components = componentNames(readFileSync(file, "utf8"));
      assert.deepEqual(components, [name], file);
    } else if (/\.(?:js|json|css)$/.test(file)) {
      assert.match(
        name.replace(/\.module$/, ""),
        /^[A-Za-z][A-Za-z0-9]*$/,
        file,
      );
      if (file.endsWith(".js")) assert.match(name, /^[a-z]/, file);
    }
  }
});

test("presentation library resolves as an independent package and imports no application code", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", ui)));
  const config = JSON.parse(
    readFileSync(new URL("../jsconfig.json", import.meta.url)),
  );
  assert.equal(manifest.name, "ui-lib");
  assert.equal(manifest.exports["."], "./index.js");
  assert.ok(manifest.peerDependencies["solid-js"]);
  assert.deepEqual(config.compilerOptions.paths["@ui-lib"], [
    "./packages/ui-lib/index.js",
  ]);
  assert.equal(import.meta.resolve("ui-lib"), new URL("index.js", ui).href);
  assert.equal(
    presentationAliases["@ui-lib"],
    fileURLToPath(new URL("index.js", ui)),
  );

  const root = fileURLToPath(ui);
  for (const file of uiSourceFiles().filter((file) => /\.(?:js|jsx)$/.test(file))) {
    const imports = readFileSync(file, "utf8").matchAll(
      /(?:from\s*|import\s*)["']([^"']+)["']/g,
    );
    for (const [, specifier] of imports) {
      if (!specifier.startsWith(".")) {
        assert.match(specifier, /^solid-js(?:\/web)?$/, file);
        continue;
      }
      const target = resolve(file, "..", specifier);
      assert.ok(target.startsWith(root), `${file} imports outside the library`);
      assert.ok(existsSync(target), `${file} imports missing ${specifier}`);
    }
  }
});
