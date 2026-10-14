// The only module allowed to know about Tauri.  Keep this seam deliberately
// boring: schemas are data, and every value crossing it is checked.
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import manifest from './command-contract.json' with { type: 'json' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const actualType = (value) => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

function invalid(name, message) {
  const error = new TypeError(`Invalid ${name} command contract: ${message}`);
  error.command = name;
  throw error;
}

function check(name, value, schema, path) {
  if (schema.oneOf) {
    for (const candidate of schema.oneOf) {
      try {
        check(name, value, candidate, path);
        return;
      } catch (error) {
      }
    }
    invalid(name, `${path} does not match any permitted result shape`);
  }
  if (schema.type === 'json') return; // Explicitly opaque; never implicit.
  if (value === null) {
    if (schema.nullable === true || schema.type === 'null') return;
    invalid(name, `${path} must not be null`);
  }
  if (schema.type === 'null') invalid(name, `${path} must be null`);
  if (actualType(value) !== schema.type) invalid(name, `${path} must be ${schema.type}`);
  if (schema.type === 'object') {
    const properties = schema.properties || {};
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
    if (schema.additionalProperties !== true && typeof schema.additionalProperties !== 'object' && unknown.length) {
      invalid(name, `${path} has unknown field(s): ${unknown.join(', ')}`);
    }
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) invalid(name, `${path} is missing ${key}`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) check(name, value[key], child, `${path}.${key}`);
    }
    if (schema.additionalProperties && schema.additionalProperties !== true) {
      for (const key of unknown) check(name, value[key], schema.additionalProperties, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    for (let index = 0; index < value.length; index += 1) check(name, value[index], schema.items, `${path}[${index}]`);
  }
}

function validate(name, value, schema, phase) {
  if (schema === 'none') {
    if (value !== undefined) invalid(name, `${phase} payload must be omitted`);
    return;
  }
  check(name, value, schema, `${phase} payload`);
}

export const COMMAND_CONTRACT = Object.freeze(manifest);
export const COMMAND_NAMES = Object.freeze(Object.keys(manifest));

// The optional first argument preserves the small dependency-injection seam
// used by unit tests. Production code passes the imported Tauri function only
// through this module (main.js never imports or aliases it).
export async function invokeCommand(rawOrName, nameOrPayload, maybePayload) {
  const injected = typeof rawOrName === 'function';
  const rawInvoke = injected ? rawOrName : tauriInvoke;
  const name = injected ? nameOrPayload : rawOrName;
  const suppliedPayload = injected ? maybePayload : nameOrPayload;
  let payload = suppliedPayload;
  const spec = manifest[name];
  if (!spec) invalid(name, 'command is not in the checked-in Rust command manifest');
  // Presentation adapters use domain-shaped arguments; the wire shape has a
  // named Rust DTO argument. This compatibility normalization is deliberately
  // available only to the real client. Injected calls (including tests) are
  // checked exactly as supplied, so a flat DTO can never hide in tests.
  if (payload !== undefined && spec.payload !== 'none' && spec.payload.type === 'object' && name !== 'quick_request_list') {
    const keys = Object.keys(spec.payload.properties || {});
    if (keys.length === 1 && keys[0] === 'request' && !Object.hasOwn(payload, 'request')) payload = { request: payload };
    if (keys.length === 1 && keys[0] === 'report' && !Object.hasOwn(payload, 'report')) payload = { report: payload };
    if (name === 'quick_request_follow_up' && !Object.hasOwn(payload, 'request')) {
      const { requestId, ...rest } = payload;
      payload = { request: { requestId }, ...rest };
    }
  }
  try {
    // Keep every preflight failure on the same tagged error path as transport
    // and result failures. This is important to callers that multiplex many
    // command requests and cannot infer the command from the message.
    validate(name, payload, spec.payload, 'request');
    const result = payload === undefined
      ? await rawInvoke(name)
      // Test doubles retain the historical presentation shape; only the real
      // Tauri call receives the serde argument wrapper.
      : await rawInvoke(name, injected ? suppliedPayload : payload);
    check(name, result, spec.result, 'result');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      error.command = name;
      throw error;
    }
    const normalized = new Error(`Tauri command ${name} failed: ${String(error)}`);
    normalized.cause = error;
    normalized.command = name;
    throw normalized;
  }
}
