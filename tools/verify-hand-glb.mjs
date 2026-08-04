import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { inflateGeometry } from "../src/hand/outlineInflate.js";

// Valida un GLB de mano contra RIG_SPEC.md: nombres de nodo, materiales simples,
// que el inflador de outline no pliegue ninguna cara (S8 riesgo 4), y escala y
// orientacion tras el export (S1). Correr despues de CADA reexport del modelo.
//   node tools/verify-hand-glb.mjs [ruta.glb]
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATH = process.argv[2] ?? path.join(HERE, "..", "src", "assets", "mano_orco.glb");
const INK = 0.055 * 1.35; // el ancho real que pasa HandCursor

// ---- parser GLB minimo (header + chunk JSON + chunk BIN) -------------------
const buf = fs.readFileSync(PATH);
if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error("no es un GLB");
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const Ctor = COMP[a.componentType];
  const n = NUM[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new Ctor(bin.buffer, bin.byteOffset + start, a.count * n);
}

// ---- 1. NOMBRES DE NODO ---------------------------------------------------
console.log("=".repeat(64));
console.log("1) NOMBRES DE NODO en el glTF (lo que lee getObjectByName)");
console.log("=".repeat(64));
const nodeNames = json.nodes.map((n) => n.name);
const nodeDupes = nodeNames.filter((n) => /\.\d{3}$/.test(n));
console.log("  nodos:", nodeNames.length, "| con sufijo .00x:", nodeDupes.length ? nodeDupes : "NINGUNO");

const meshNames = (json.meshes || []).map((m) => m.name);
const meshDupes = meshNames.filter((n) => /\.\d{3}$/.test(n));
console.log("  mallas:", meshNames.length, "| con sufijo .00x:", meshDupes.length ? meshDupes.join(", ") : "NINGUNO");

const critical = ["mano", "agarre", "pulgarBase", "palma", "muneca", "muneca_hueso"];
for (const c of critical) console.log(`  nodo "${c}" presente:`, nodeNames.includes(c));

// ---- 2. MATERIALES --------------------------------------------------------
console.log("\n" + "=".repeat(64));
console.log("2) MATERIALES (deben ser solo color base, sin texturas)");
console.log("=".repeat(64));
console.log("  texturas en el archivo:", (json.textures || []).length, "| imagenes:", (json.images || []).length);
for (const m of json.materials || []) {
  const p = m.pbrMetallicRoughness || {};
  const f = (p.baseColorFactor || []).map((v) => v.toFixed(3)).join(", ");
  const maps = Object.keys(p).filter((k) => k.toLowerCase().includes("texture"));
  const exts = Object.keys(m.extensions || {});
  console.log(`  ${m.name.padEnd(14)} baseColorFactor=[${f}]  metallic=${p.metallicFactor ?? "-"}  texturas=${maps.length ? maps : "ninguna"}  ext=${exts.length ? exts : "ninguna"}`);
}

// ---- 3. INFLADOR SOBRE ESTA MALLA -----------------------------------------
console.log("\n" + "=".repeat(64));
console.log(`3) INFLADOR sobre la geometria EXPORTADA (ink=${INK.toFixed(4)})`);
console.log("=".repeat(64));

let anyFail = false;
let totalSplit = 0;
const rows = [];

for (const mesh of json.meshes) {
  for (const prim of mesh.primitives) {
    const pos = readAccessor(prim.attributes.POSITION);
    const idx = prim.indices !== undefined ? readAccessor(prim.indices) : null;

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    if (idx) g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

    // cuantos vertices comparten posicion? esos son los que el soldado tiene que unir
    const groups = new Map();
    for (let i = 0; i < g.attributes.position.count; i++) {
      const k = `${g.attributes.position.getX(i).toFixed(5)},${g.attributes.position.getY(i).toFixed(5)},${g.attributes.position.getZ(i).toFixed(5)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const split = [...groups.values()].filter((v) => v.length > 1).length;
    totalSplit += split;

    const inflated = inflateGeometry(g, INK);
    const ip = inflated.attributes.position;

    // (a) sin NaN
    const nan = [...ip.array].some((v) => !Number.isFinite(v));

    // (b) las copias de una misma posicion caen en el MISMO punto (sin grietas)
    let maxSpread = 0;
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const a = new THREE.Vector3().fromBufferAttribute(ip, ids[0]);
      for (const i of ids) {
        maxSpread = Math.max(maxSpread, a.distanceTo(new THREE.Vector3().fromBufferAttribute(ip, i)));
      }
    }

    // (c) caras invertidas = la cascara se plego sobre si misma
    const index = g.index;
    const tri = index ? index.count / 3 : g.attributes.position.count / 3;
    const at = (n) => (index ? index.getX(n) : n);
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
    let flipped = 0;
    for (let t = 0; t < tri; t++) {
      const [ia, ib, ic] = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
      va.fromBufferAttribute(g.attributes.position, ia);
      vb.fromBufferAttribute(g.attributes.position, ib);
      vc.fromBufferAttribute(g.attributes.position, ic);
      n0.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
      va.fromBufferAttribute(ip, ia); vb.fromBufferAttribute(ip, ib); vc.fromBufferAttribute(ip, ic);
      n1.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
      if (n0.dot(n1) < 0) flipped++;
    }

    g.computeBoundingSphere();
    const grew = inflated.boundingSphere.radius > g.boundingSphere.radius;
    const ok = !nan && maxSpread < 1e-5 && flipped === 0 && grew;
    if (!ok) anyFail = true;
    rows.push({ name: mesh.name, verts: g.attributes.position.count, split, nan, maxSpread, flipped, grew, ok });
  }
}

console.log("  malla                verts  pos.partidas  NaN  dispersion  caras.invertidas  crece  ");
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(20)} ${String(r.verts).padStart(5)}  ${String(r.split).padStart(12)}  ${r.nan ? "SI " : "no "}  ${r.maxSpread.toExponential(1).padStart(10)}  ${String(r.flipped).padStart(16)}  ${r.grew ? "si" : "NO"}   ${r.ok ? "OK" : "FALLA"}`
  );
}
console.log(`\n  posiciones partidas en total: ${totalSplit}`);
console.log("  caras invertidas:", rows.reduce((s, r) => s + r.flipped, 0));

// ---- 4. ESCALA Y ORIENTACION TRAS EL EXPORT --------------------------------
console.log("\n" + "=".repeat(64));
console.log("4) ESCALA Y ORIENTACION (tabla de ejes de RIG_SPEC S1)");
console.log("=".repeat(64));

// componer las matrices de mundo caminando el arbol de nodos glTF
const world = new Map();
function walk(i, parent) {
  const n = json.nodes[i];
  const m = new THREE.Matrix4();
  if (n.matrix) m.fromArray(n.matrix);
  else {
    m.compose(
      new THREE.Vector3().fromArray(n.translation || [0, 0, 0]),
      new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(n.scale || [1, 1, 1])
    );
  }
  const w = new THREE.Matrix4().multiplyMatrices(parent, m);
  world.set(n.name, w);
  for (const c of n.children || []) walk(c, w);
}
for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, new THREE.Matrix4());

const pos = (name) => new THREE.Vector3().setFromMatrixPosition(world.get(name));
const show = (name) => { const p = pos(name); return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`; };

const checks = [];
const thumb = pos("pulgar_falange2");
const pinky = pos("menique_metacarpo");
const tip = pos("medio_falange3");
const grip = pos("agarre");

checks.push(["pulgar en -X (mano derecha, S1.1)", thumb.x < 0, `pulgar_falange2 x=${thumb.x.toFixed(3)}`]);
checks.push(["menique en +X", pinky.x > 0, `menique_metacarpo x=${pinky.x.toFixed(3)}`]);
checks.push(["dedos apuntan +Y", tip.y > 1.5, `punta del medio y=${tip.y.toFixed(3)}`]);
checks.push(["pulgar opuesto hacia la palma +Z", thumb.z > 0.4, `pulgar z=${thumb.z.toFixed(3)}`]);
checks.push(["agarre en (0, 0.1, 0.40)", Math.abs(grip.x) < 1e-4 && Math.abs(grip.y - 0.1) < 1e-3 && Math.abs(grip.z - 0.4) < 1e-3, `agarre ${show("agarre")}`]);

// escala: bbox de la palma en ejes de Three
{
  const mi = json.meshes.findIndex((m) => m.name === "palma");
  const prim = json.meshes[mi].primitives[0];
  const acc = json.accessors[prim.attributes.POSITION];
  const [mnx, mny, mnz] = acc.min, [mxx, mxy, mxz] = acc.max;
  const w = mxx - mnx, h = mxy - mny, d = mxz - mnz;
  // La profundidad NO es la de la caja base: la palma lleva el bulto tenar de
  // la Fase 2, que sobresale hacia +Z. Base 0.80 + abultamiento autoral (<=0.19).
  checks.push([`palma 1.6 x 1.7 x [0.80..0.99]`,
    Math.abs(w - 1.6) < 0.05 && Math.abs(h - 1.7) < 0.05 && d >= 0.79 && d <= 0.99,
    `${w.toFixed(3)} x ${h.toFixed(3)} x ${d.toFixed(3)} (base 0.80 + bulto ${(d - 0.8).toFixed(3)})`]);
}
// sin escalas raras en ningun nodo
{
  const scaled = json.nodes.filter((n) => n.scale && n.scale.some((s) => Math.abs(s - 1) > 1e-4));
  checks.push(["ningun nodo con escala != 1", scaled.length === 0, scaled.map((n) => n.name).join(", ") || "todos en 1,1,1"]);
}
// sin skinning ni animaciones
checks.push(["sin skins (rig de nodos, S0/S10)", !json.skins || json.skins.length === 0, `skins=${(json.skins || []).length}`]);
checks.push(["sin animaciones horneadas", !json.animations || json.animations.length === 0, `animations=${(json.animations || []).length}`]);

for (const [label, ok, detail] of checks) {
  if (!ok) anyFail = true;
  console.log(`  ${ok ? "OK  " : "FALLA"} ${label.padEnd(40)} ${detail}`);
}

console.log("\n" + "=".repeat(64));
console.log("RESULTADO:", anyFail ? "HAY FALLAS" : "TODO PASA");
console.log("=".repeat(64));
process.exit(anyFail ? 1 : 0);
