// Generates a larger 120-question paper to profile extraction at scale.
import fs from "node:fs";
import PDFDocument from "pdfkit";

const OUT = "/app/scratch/samples/big-120q.pdf";
fs.mkdirSync("/app/scratch/samples", { recursive: true });
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const stems = [
  "The resistance of a conductor is directly proportional to its",
  "Which of the following is used as a moderator in a CANDU reactor setup analogy for machines?",
  "The synchronous speed of a 4-pole, 50 Hz induction motor is closest to",
  "In a DC shunt motor, the speed can be controlled by varying the",
  "The efficiency of a transformer at full load, with unity power factor, mainly depends upon",
  "Which method is used for charging a battery at a constant rate regardless of voltage variations?",
  "The dielectric strength of transformer oil is usually measured in terms of",
  "For a balanced delta-connected load, the relationship between line current and phase current is",
  "The purpose of a conservator tank in a power transformer is to",
  "Which relay is used for protection of a transformer against internal incipient faults?",
];
const opts = [
  ["cross-sectional area", "length of the conductor", "supply frequency", "power factor"],
  ["light water only", "graphite or heavy water", "liquid sodium", "air gaps"],
  ["750 rpm", "1000 rpm", "1500 rpm", "3000 rpm"],
  ["armature resistance only", "field flux or armature voltage", "commutator pitch", "brush angle"],
  ["copper losses only", "copper and iron losses", "iron losses only", "windage losses"],
  ["constant voltage", "constant current", "trickle method", "impulse method"],
  ["volts per metre", "kilovolts per millimetre", "amperes", "ohms"],
  ["line = phase", "line = √3 × phase", "line = 3 × phase", "line = phase / √3"],
  ["cool the winding directly", "allow oil expansion and contraction", "reduce eddy currents", "increase insulation"],
  ["overcurrent relay", "differential relay", "Buchholz relay", "thermal relay"],
];
const ans = ["B", "B", "C", "B", "B", "B", "B", "B", "B", "C"];

const doc = new PDFDocument({ margin: 50 });
doc.registerFont("body", FONT);
doc.registerFont("bold", FONT_BOLD);
doc.pipe(fs.createWriteStream(OUT));
doc.font("bold").fontSize(15).text("Electrical Machines & Power — Full Length Mock (120 Questions)", { align: "center" });
doc.moveDown();
doc.font("body").fontSize(10.5);
for (let i = 0; i < 120; i++) {
  const k = i % stems.length;
  doc.font("bold").text(`${i + 1}. ${stems[k]} ${i >= 10 ? `(variant ${Math.floor(i / 10)})` : ""}`);
  doc.font("body");
  ["A", "B", "C", "D"].forEach((L, j) => doc.text(`(${L}) ${opts[k][j]}`));
  doc.moveDown(0.5);
}
doc.addPage();
doc.font("bold").fontSize(14).text("ANSWER KEY");
doc.moveDown(0.4).font("body").fontSize(10.5);
const keyLines = [];
for (let i = 0; i < 120; i += 10) {
  keyLines.push([...Array(10)].map((_, j) => `${i + j + 1}-${ans[(i + j) % 10]}`).join("   "));
}
keyLines.forEach((l) => doc.text(l));
doc.end();
await new Promise((r) => setTimeout(r, 600));
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
