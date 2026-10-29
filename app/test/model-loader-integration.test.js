import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  initializeModelSelector,
  modelSelectorChoices,
} from "../src/lib/modelSelector.js";
import { invokeCommand } from "../src/services/commandContract.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = resolve(appRoot, "src-tauri/Cargo.toml");

function runHarness(
  command = "cargo",
  args = [
    "run",
    "--quiet",
    "--manifest-path",
    manifest,
    "--features",
    "integration-test-harnesses",
    "--bin",
    "model-loader-harness",
  ],
) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  let payload;
  try {
    payload = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(
      `model-loader harness emitted malformed JSON (exit ${result.status}): ${result.stdout}`,
    );
  }
  if (result.status !== 0 || payload.ok !== "true") {
    throw new Error(
      payload.error || `model-loader harness exited ${result.status}`,
    );
  }
  return payload;
}

function runWireHarness() {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      manifest,
      "--features",
      "integration-test-harnesses",
      "--bin",
      "wire-contract-harness",
    ],
    { cwd: appRoot, encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    result.stderr || "Rust wire-contract harness failed",
  );
  return JSON.parse(result.stdout.trim());
}

test("production model loader and choice adapter consume the real installed-CLI Rust catalog and persisted default", async () => {
  const { info, catalog } = runHarness();
  const { defaultModel } = runWireHarness();
  assert.match(info.version, /\S+/);
  assert.equal(typeof info.pid, "number");
  assert.ok(catalog.length > 0);
  assert.ok(
    catalog.every((entry) => entry.enabled && entry.status !== "deprecated"),
  );
  assert.ok(
    !catalog.some(
      (entry) => `${entry.providerID}/${entry.id}` === "opencode/exo-free",
    ),
  );
  assert.ok(
    catalog.every(
      (entry) => entry.providerID && entry.id && typeof entry.name === "string",
    ),
  );

  let choices, unavailableDefault;
  const events = [];
  const transportCalls = [];
  await initializeModelSelector({
    invoke: async (name, payload) => {
      transportCalls.push({ name, payload });
      // Both values come from Rust, through the production command validator.
      return invokeCommand(
        async () => (name === "opencode_models" ? catalog : defaultModel),
        name,
        payload,
      );
    },
    view: {
      loading: () => events.push("loading"),
      ready: (models, configuredDefault, available) => {
        choices = modelSelectorChoices(models, configuredDefault);
        assert.equal(choices.configuredDefaultIsAvailable, available);
        events.push("ready");
      },
    },
    onReady: () => events.push("onReady"),
    onDefaultUnavailable: (value) => {
      unavailableDefault = value;
    },
    onError: (error) => {
      throw error;
    },
  });
  assert.deepEqual(events, ["loading", "onReady", "ready"]);
  assert.deepEqual(transportCalls, [
    { name: "opencode_model_default", payload: undefined },
    { name: "opencode_models", payload: undefined },
  ]);
  assert.equal(choices.options.length, catalog.length);
  assert.ok(choices.options.every((option) => option.value && option.label));
  const defaultIsAvailable = catalog.some(
    (entry) =>
      entry.providerID === defaultModel.providerId &&
      entry.id === defaultModel.id,
  );
  assert.equal(choices.configuredDefaultIsAvailable, defaultIsAvailable);
  assert.equal(
    choices.selected,
    defaultIsAvailable
      ? JSON.stringify({
          providerId: defaultModel.providerId,
          id: defaultModel.id,
        })
      : choices.options[0].value,
  );
  assert.deepEqual(
    unavailableDefault,
    defaultIsAvailable ? undefined : defaultModel,
  );
});

test("model loader reports CLI/API and empty-catalog failures through production view callbacks", async () => {
  const defaultModel = { providerId: "openai", id: "gpt-6-luna" };
  for (const failure of [
    { catalog: new Error("OpenCode API returned HTTP 503"), match: /HTTP 503/ },
    { catalog: [], match: /No enabled OpenCode models/ },
  ]) {
    const events = [];
    const result = await initializeModelSelector({
      invoke: async (name) => {
        if (name === "opencode_model_default") return defaultModel;
        if (failure.catalog instanceof Error) throw failure.catalog;
        return failure.catalog;
      },
      view: {
        loading: () => events.push("loading"),
        ready: () => assert.fail("failed catalog cannot publish choices"),
        error: (error) => {
          assert.match(String(error), failure.match);
          events.push("error");
        },
      },
      onReady: () => assert.fail("failed catalog cannot become ready"),
      onError: (error) => {
        assert.match(String(error), failure.match);
        events.push("onError");
      },
    });
    assert.equal(result, null);
    assert.deepEqual(events, ["loading", "onError", "error"]);
  }
});

test("production choice data selects the configured default or the first live choice without synthesis", async () => {
  const models = [
    {
      providerID: "live",
      id: "first",
      name: "First",
      enabled: true,
      status: null,
    },
    {
      providerID: "live",
      id: "default",
      name: "Default",
      enabled: true,
      status: null,
    },
  ];
  for (const id of ["default", "missing"]) {
    const defaultModel = { providerId: "live", id };
    let choices, unavailable;
    await initializeModelSelector({
      invoke: async (name) =>
        name === "opencode_model_default" ? defaultModel : models,
      view: {
        ready: (loaded, configured) => {
          choices = modelSelectorChoices(loaded, configured);
        },
      },
      onReady() {},
      onError: (error) => {
        throw error;
      },
      onDefaultUnavailable: (value) => {
        unavailable = value;
      },
    });
    assert.deepEqual(choices.options, [
      { value: '{"providerId":"live","id":"first"}', label: "First" },
      { value: '{"providerId":"live","id":"default"}', label: "Default" },
    ]);
    assert.equal(
      choices.selected,
      id === "default" ? choices.options[1].value : choices.options[0].value,
    );
    assert.deepEqual(unavailable, id === "default" ? undefined : defaultModel);
  }
});

test("model loader rejects malformed or failed harness output", () => {
  assert.throws(
    () =>
      runHarness(process.execPath, [
        "-e",
        'process.stdout.write("not-json"); process.exit(1)',
      ]),
    /malformed JSON/,
  );
  assert.throws(
    () =>
      runHarness(process.execPath, [
        "-e",
        'console.log(JSON.stringify({ok:"false",error:"CLI unavailable"})); process.exit(1)',
      ]),
    /CLI unavailable/,
  );
});
