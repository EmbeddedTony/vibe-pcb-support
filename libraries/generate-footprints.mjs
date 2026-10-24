// Development-only conversion. The checked-in JSON is bundled on iOS; KiCad is
// never installed or contacted at runtime. Library data retains CC-BY-SA-4.0.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root =
  process.env.KICAD_FOOTPRINT_DIR ||
  "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints";
const sources = [
  ["resistor", "0805 resistor", "Passives", "Resistor_SMD:R_0805_2012Metric"],
  [
    "capacitor",
    "0805 capacitor",
    "Passives",
    "Capacitor_SMD:C_0805_2012Metric",
  ],
  ["led", "0805 LED", "Passives", "LED_SMD:LED_0805_2012Metric"],
  [
    "resistor0603",
    "0603 resistor",
    "Passives",
    "Resistor_SMD:R_0603_1608Metric",
  ],
  [
    "capacitor0603",
    "0603 capacitor",
    "Passives",
    "Capacitor_SMD:C_0603_1608Metric",
  ],
  ["diode", "SOD-123 diode", "Passives", "Diode_SMD:D_SOD-123"],
  ...[2, 3, 4, 6, 8].map((n) => [
    `header${n}`,
    `1×${n} header · 2.54 mm`,
    "Connectors",
    `Connector_PinHeader_2.54mm:PinHeader_1x0${n}_P2.54mm_Vertical`,
  ]),
  [
    "header2x3",
    "2×3 header · 2.54 mm",
    "Connectors",
    "Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical",
  ],
  [
    "sot23",
    "SOT-23 · 3 pins",
    "Transistors & ICs",
    "Package_TO_SOT_SMD:SOT-23",
  ],
  [
    "sot23_5",
    "SOT-23-5 · 5 pins",
    "Transistors & ICs",
    "Package_TO_SOT_SMD:SOT-23-5",
  ],
  [
    "soic8",
    "SOIC-8 · 1.27 mm",
    "IC packages",
    "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
  ],
  [
    "soic14",
    "SOIC-14 · 1.27 mm",
    "IC packages",
    "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm",
  ],
  [
    "soic16",
    "SOIC-16 · 1.27 mm",
    "IC packages",
    "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm",
  ],
  [
    "tssop20",
    "TSSOP-20 · 0.65 mm",
    "IC packages",
    "Package_SO:TSSOP-20_4.4x6.5mm_P0.65mm",
  ],
  [
    "tssop28",
    "TSSOP-28 · 0.65 mm",
    "IC packages",
    "Package_SO:TSSOP-28_4.4x9.7mm_P0.65mm",
  ],
  [
    "tqfp32",
    "TQFP-32 · 0.8 mm",
    "IC packages",
    "Package_QFP:TQFP-32_7x7mm_P0.8mm",
  ],
  [
    "lqfp48",
    "LQFP-48 · 0.5 mm",
    "IC packages",
    "Package_QFP:LQFP-48_7x7mm_P0.5mm",
  ],
];
function parse(text) {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g) || [];
  let i = 0;
  function expression() {
    const token = tokens[i++];
    if (token !== "(")
      return token?.startsWith('"') ? JSON.parse(token) : token;
    const list = [];
    while (tokens[i] !== ")") {
      if (i >= tokens.length) throw new Error("Unbalanced footprint");
      list.push(expression());
    }
    i++;
    return list;
  }
  return expression();
}
const field = (node, key) => node.find((v) => Array.isArray(v) && v[0] === key);
const bounds = (points) => ({
  x: Math.min(...points.map((p) => p[0])),
  y: Math.min(...points.map((p) => p[1])),
  width:
    Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
  height:
    Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])),
});
const result = {};
for (const [id, label, category, footprint] of sources) {
  const [library, name] = footprint.split(":"),
    relative = `${library}.pretty/${name}.kicad_mod`;
  const text = readFileSync(resolve(root, relative), "utf8"),
    tree = parse(text);
  const pads = tree
    .filter((v) => v[0] === "pad")
    .map((p) => {
      const at = field(p, "at"),
        size = field(p, "size"),
        drill = field(p, "drill");
      if (!/^\d+$/.test(p[1]) || !["smd", "thru_hole"].includes(p[2]))
        throw new Error(`Unsupported pad: ${footprint}`);
      return {
        number: p[1],
        x: +at[1],
        y: +at[2],
        width: +size[1],
        height: +size[2],
        angle: +(at[3] || 0),
        drill: drill ? +drill[1] : 0,
        shape: p[3] === "circle" ? "circle" : "rect",
      };
    })
    .sort((a, b) => +a.number - +b.number);
  if (pads.some((p, i) => +p.number !== i + 1))
    throw new Error(`Nonsequential pins: ${footprint}`);
  function layerBounds(layer) {
    const points = [];
    for (const item of tree.filter(
      (v) =>
        Array.isArray(v) &&
        v[0].startsWith("fp_") &&
        field(v, "layer")?.[1] === layer,
    )) {
      if (["fp_line", "fp_rect"].includes(item[0]))
        points.push(
          field(item, "start").slice(1).map(Number),
          field(item, "end").slice(1).map(Number),
        );
      if (item[0] === "fp_poly")
        points.push(
          ...field(item, "pts")
            .slice(1)
            .map((v) => v.slice(1).map(Number)),
        );
    }
    if (!points.length) throw new Error(`No ${layer} outline: ${footprint}`);
    return bounds(points);
  }
  result[id] = {
    label,
    category,
    footprint,
    body: layerBounds("F.Fab"),
    courtyard: layerBounds("F.CrtYd"),
    pads,
    source: `https://gitlab.com/kicad/libraries/kicad-footprints/-/blob/master/${relative}`,
    sourceSha256: createHash("sha256").update(text).digest("hex"),
    license: "CC-BY-SA-4.0 with KiCad design exception",
  };
}
writeFileSync(
  "shared/footprint-data.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `Converted ${Object.keys(result).length} KiCad packages for the offline library.`,
);
