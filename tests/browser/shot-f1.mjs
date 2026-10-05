// F1: Treppenformen (L mit Podest, L gewendelt, U, Wendel) mit passendem Deckenloch; Gauben blockieren PV
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("f1", "?stairs", { width: 1280, height: 800 });
const shapes = ["l_left", "lw_right", "u_left", "spiral"];
for (const shape of shapes) {
  const r = await pg.evaluate(async (shape) => {
    const p = window.panel;
    const b = structuredClone(p._building);
    const kg = b.floors.find((f) => f.id === "kg");
    const st = kg.furniture.find((x) => x.id === "treppe_kg");
    st.stair_shape = shape;
    p._setBuilding(b, p._revision, { keepCamera: true });
    await new Promise((res) => setTimeout(res, 150));
    const { slabOpenings } = await import("/custom_components/haus3d/frontend/stairs.js");
    const holes = {};
    for (const [fid, entry] of p._scene.floors) entry.group.traverse((o) => { if (o.userData?.holes) holes[fid] = (holes[fid] ?? 0) + o.userData.holes; });
    const ops = slabOpenings(b, "eg");
    return { holes, corners: ops[0]?.poly.length ?? 0 };
  }, shape);
  t.results[shape] = r;
  t.check(r.holes.eg === 1 && !r.holes.kg && r.corners >= (shape === "spiral" ? 12 : 4), `Treppe ${shape}: ${JSON.stringify(r)}`);
  if (shape === "lw_right" || shape === "spiral") {
    await pg.locator("haus3d-panel .floorbar button[data-floor='kg']").click().catch(() => {});
    await pg.waitForTimeout(400);
    // nah ran an die Treppe (Weltkoordinaten aus dem Modell)
    t.results[shape].meshes = await pg.evaluate(async () => {
      const sc = window.panel._scene;
      let obj = null;
      sc.scene.traverse((o) => {
        if (!obj && o.userData.furniture === "treppe_kg" && o.parent?.userData.furniture !== "treppe_kg") obj = o;
      });
      const THREE = await import("/custom_components/haus3d/frontend/vendor/three.module.min.js").catch(() => null);
      let n = 0;
      obj?.traverse((o) => o.isMesh && n++);
      if (obj && THREE) {
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3());
        const r = box.getSize(new THREE.Vector3()).length();
        sc.controls.target.copy(c);
        sc.camera.position.set(c.x + r * 0.9, c.y + r * 0.9, c.z + r * 0.9);
        sc.controls.update();
        sc._dirty = true;
        sc._kick?.();
      }
      return n;
    });
    await pg.waitForTimeout(1200);
    await t.shot(pg, `treppe-${shape}.png`);
  }
}
// Keller gewählt: Rasen der Etage darüber liegt nicht über dem Keller
const gardens = await pg.evaluate(() => Object.fromEntries([...window.panel._scene.floors].map(([id, e]) => [id, e.garden.visible])));
t.check(gardens.eg === false, `Garten über dem Keller sichtbar: ${JSON.stringify(gardens)}`);
await pg.locator("haus3d-panel .floorbar button[data-floor='all']").click();
await pg.waitForTimeout(300);
const gardensAll = await pg.evaluate(() => window.panel._scene.floors.get("eg").garden.visible);
t.check(gardensAll === true, "Garten in „Alle“ wieder sichtbar");
// Gaube: setzt sich aufs Dach und nimmt PV-Modulen den Platz
const roof = await t.page("f1-gaube", "?roof=gable&lhaus", { width: 1280, height: 800 });
const pv = await roof.evaluate(async () => {
  const p = window.panel;
  const m = p._scene.roofModel;
  const { pvLayout, dormerShape } = await import("/custom_components/haus3d/frontend/exterior.js");
  let at = null;
  for (const part of m.parts) {
    for (const sv of [-0.4, -0.35, -0.3, -0.25, 0.25, 0.3, 0.35, 0.4]) {
      for (const su of [0, 0.15, -0.15]) {
        const q = { x: part.center[0] + part.v[0] * part.width * sv + part.u[0] * part.length * su, z: part.center[1] + part.v[1] * part.width * sv + part.u[1] * part.length * su };
        if (!at && pvLayout(m, { type: "pv", ...q, cols: 3, rows: 2 }).count >= 3 && dormerShape(m, { type: "dormer", ...q, style: "gable" })) at = q;
      }
    }
  }
  if (!at) return { at };
  const count = () => {
    let n = 0;
    p._scene.roofHolder?.traverse((o) => { if (o.isInstancedMesh && Array.isArray(o.material)) n += o.count; });
    return n;
  };
  const meshes = () => { let n = 0; p._scene.roofHolder?.traverse((o) => { if (o.isMesh) n++; }); return n; };
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items: [{ id: "pv1", type: "pv", ...at, cols: 3, rows: 2 }] } }, "ok");
  const free = count();
  const m0 = meshes();
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items: [{ id: "pv1", type: "pv", ...at, cols: 3, rows: 2 }, { id: "g1", type: "dormer", ...at, style: "gable" }] } }, "ok");
  return { at, free, withDormer: count(), extraMeshes: meshes() - m0, info: p._pvInfo.get("pv1") };
});
t.results.gaube = pv;
t.check(pv.at && pv.withDormer < pv.free && pv.extraMeshes >= 1, `Gaube: ${JSON.stringify(pv)}`);
await roof.waitForTimeout(500);
await t.shot(roof, "gaube.png");
// Editor: Treppenformen zur Auswahl, Gauben-Werkzeug in der Dach-Ebene mit Eigenschaften
await roof.evaluate(() => window.panel._openEditor());
await roof.waitForTimeout(500);
const ed = await roof.evaluate(async () => {
  const e = window.panel._editor;
  e.roofMode = true;
  e.sel = { kind: "roofitem", id: "g1" };
  e.renderBar();
  e.render();
  e.renderProps();
  const { STAIR_SHAPES } = await import("/custom_components/haus3d/frontend/stairs.js");
  return { tool: !!e.root.querySelector('[data-tool="dormer"]'), props: e.props.textContent.includes("Gaube"), shapes: STAIR_SHAPES.map((x) => x[0]) };
});
t.results.editor = ed;
t.check(ed.tool && ed.props && ["l_left", "lw_left", "u_left", "spiral"].every((k) => ed.shapes.includes(k)), `Editor Gaube/Treppen: ${JSON.stringify(ed)}`);
await t.shot(roof, "gaube-editor.png");
await t.done();
