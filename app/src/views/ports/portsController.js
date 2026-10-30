import { invokeCommand } from "../../services/commandContract.js";

export const DEFAULT_PORT_SELECTION = "3000-3010,4200,4321,5000-5010,5173-5180,5432,6379,8000-8010,8080-8090,9229,27017";

export function parsePortSelection(value) {
  const ports = new Set();
  for (const token of value.split(",").map(s => s.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`Invalid port or range: ${token}`);
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last > 65535 || last < first) throw new Error(`Invalid port range: ${token}`);
    for (let port = first; port <= last; port++) ports.add(port);
  }
  return ports;
}

export function createPortsController({ invoke, visible, setVisible, onOpen }) {
  const { createSignal } = requireSignals();
  const [rows,setRows] = createSignal([]), [selection,setSelection] = createSignal(DEFAULT_PORT_SELECTION), [allPorts,setAllPorts] = createSignal(false), [busy,setBusy] = createSignal(false), [error,setError] = createSignal(""), [updated,setUpdated] = createSignal(""), [stopping,setStopping] = createSignal(null);
  const [localVisible,setLocalVisible] = createSignal(false);
  async function loadPreferences() { const prefs=await invokeCommand(invoke, "presentation_preferences_get"); setSelection(prefs.ports?.selection || DEFAULT_PORT_SELECTION); }
  async function refresh() { setBusy(true); setError(""); try { setRows(await invokeCommand(invoke, "ports_list")); setUpdated(new Date().toLocaleTimeString()); } catch(e) { setError(String(e)); } finally { setBusy(false); } }
  async function open() { onOpen?.(); setVisible(true); try { await loadPreferences(); } catch(e) { setError(String(e)); } await refresh(); }
  let timer;
  function changeSelection(value) { setSelection(value); clearTimeout(timer); timer=setTimeout(async()=>{try { parsePortSelection(value); const prefs=await invokeCommand(invoke, "presentation_preferences_set_port_selection",{request:{selection:value}}); setSelection(prefs.ports.selection); setError(""); } catch(e) { setError(String(e)); }},400); }
  async function reset() { clearTimeout(timer); setAllPorts(false); setSelection(DEFAULT_PORT_SELECTION); try { const prefs=await invokeCommand(invoke, "presentation_preferences_set_port_selection",{request:{selection:DEFAULT_PORT_SELECTION}}); setSelection(prefs.ports.selection); setError(""); } catch(e) { setError(String(e)); } }
  const matchesPort = port => { try { return parsePortSelection(selection()).has(port); } catch { return false; } };
  async function stop(row) { if (!row.identity) return; setStopping(row.pid); setError(""); try { await invokeCommand(invoke, "ports_stop",{pid:row.pid,identity:row.identity}); await refresh(); } catch(e) { setError(`Could not stop PID ${row.pid}: ${String(e)}`); } finally { setStopping(null); } }
  return {rows,selection,allPorts,setAllPorts,busy,error,updated,stopping,visible:visible || localVisible,setVisible:setVisible || setLocalVisible,matchesPort,refresh,open,stop,reset,changeSelection};
}

// Keep Solid imported statically at module scope under Vite's browser transform.
function requireSignals() { return signalModule; }
import * as signalModule from "solid-js";
