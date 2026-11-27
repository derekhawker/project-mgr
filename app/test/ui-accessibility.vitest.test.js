import assert from "node:assert/strict";
import { test } from "vitest";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";
import { Button, Input, TextArea, Select, Checkbox, Notice } from "@ui-lib";

const component = (Component, props) => createComponent(Component, props);
const mount = (factory) => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(factory, host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
};
test("basic controls preserve native disabled, labeling, and announcement overrides", () => {
  const instances = [
    mount(() =>
      component(Button, { disabled: true, type: "submit", children: "Save" }),
    ),
    mount(() => component(Input, { id: "name", disabled: true })),
    mount(() => component(TextArea, { id: "notes", required: true })),
    mount(() =>
      component(Select, { id: "choice", disabled: true, children: "One" }),
    ),
    mount(() =>
      component(Checkbox, { id: "accept", checked: true, disabled: true }),
    ),
    mount(() =>
      component(Notice, {
        role: "alert",
        "aria-live": "assertive",
        message: "Failed",
        status: "error",
      }),
    ),
  ];
  assert.equal(instances[0].host.querySelector("button").type, "submit");
  assert.equal(instances[0].host.querySelector("button").disabled, true);
  assert.equal(instances[1].host.querySelector("#name").disabled, true);
  assert.equal(instances[2].host.querySelector("#notes").required, true);
  assert.equal(
    instances[3].host.querySelector("#choice").getAttribute("aria-disabled"),
    "true",
  );
  assert.equal(instances[3].host.querySelector("#choice").tabIndex, -1);
  assert.equal(instances[4].host.querySelector("#accept").checked, true);
  assert.equal(
    instances[5].host.querySelector("[role=alert]").getAttribute("aria-live"),
    "assertive",
  );
  instances.forEach((instance) => instance.dispose());
});
