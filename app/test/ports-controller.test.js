import test from "node:test";
import assert from "node:assert/strict";
import { createPortsController, DEFAULT_PORT_SELECTION, parsePortSelection } from "../src/views/ports/portsController.js";

const preferenceResult = (selection) => ({shared:{fileNavigator:{width:300}},changeReview:{mode:"unified"},ports:{selection}});

test("parses individual ports and ranges and rejects unsafe values", () => {
  assert.deepEqual([...parsePortSelection("3000-3002, 5173")].sort((a,b)=>a-b), [3000,3001,3002,5173]);
  for (const invalid of ["0", "65536", "2-1", "80,noise", "100000-65535"]) assert.throws(() => parsePortSelection(invalid));
});

test("opening refreshes listeners, stop refreshes after success, and failures stay visible", async () => {
  const calls=[]; let failStop=false; const row={pid:42,identity:"identity",name:"dev-server",owner:"me",addresses:["127.0.0.1"],ports:[5173],cwd:"/repo",command:"node server",startTime:"now"};
  const invoke=async(name,payload)=>{ calls.push([name,payload]); if(name==="presentation_preferences_get") return preferenceResult(DEFAULT_PORT_SELECTION); if(name==="ports_list") return [row]; if(name==="ports_stop"&&failStop) throw Error("permission denied"); if(name==="presentation_preferences_set_port_selection") return preferenceResult(payload.request.selection); return null; };
  let visible=false; const c=createPortsController({invoke,visible:()=>visible,setVisible:v=>{visible=v;}});
  await c.open(); assert.equal(visible,true); assert.equal(c.visible(),true); assert.equal(c.rows().length,1); assert.ok(c.updated());
  await c.stop(row); assert.deepEqual(calls.filter(c=>c[0]==="ports_list").length,2);
  failStop=true; await c.stop(row); assert.match(c.error(),/permission denied/);
  c.setAllPorts(true); assert.equal(c.allPorts(),true);
});

test("reset persists the advertised default selection", async () => {
  let saved=""; const c=createPortsController({invoke:async(name,payload)=>{saved=payload.request.selection;return preferenceResult(saved);},setVisible:()=>{}});
  await c.reset(); assert.equal(saved,DEFAULT_PORT_SELECTION); assert.equal(c.selection(),DEFAULT_PORT_SELECTION);
});

test("edited port ranges are validated and persisted after the input settles", async () => {
  const saved=[];
  const c=createPortsController({invoke:async(name,payload)=>{if(name==="presentation_preferences_set_port_selection"){saved.push(payload.request.selection);return preferenceResult(payload.request.selection);}return preferenceResult(DEFAULT_PORT_SELECTION);},setVisible:()=>{}});
  c.changeSelection("4100-4102, 5173");
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.deepEqual(saved,["4100-4102, 5173"]);
  assert.equal(c.selection(),"4100-4102, 5173");
});
