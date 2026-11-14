// Generates a realistic 10-question Electrical Engineering MCQ paper
// (vertical options, multi-line stems, math symbols, answer key + explanations)
// for end-to-end pipeline testing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const OUT = SAMPLES + "/ee-practice-set.pdf";
// Portable output directory: <repo>/scratch/samples (works from any checkout).
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scratch", "samples");
fs.mkdirSync(SAMPLES, { recursive: true });

const QS = [
  {
    stem: "Which device is used to protect a circuit against overcurrent and short-circuit faults in a low-voltage switchgear installation?",
    opts: ["Isolator", "Voltmeter", "Circuit breaker", "Energy meter"],
    ans: "C",
    expl: "A circuit breaker automatically interrupts the circuit when an overcurrent or fault condition occurs; an isolator only works off-load.",
  },
  {
    stem: "The SI unit of electrical power is the",
    opts: ["Joule", "Volt", "Farad", "Watt"],
    ans: "D",
    expl: "Power is measured in watts (1 W = 1 J/s); the joule is a unit of energy.",
  },
  {
    stem: "A transformer works on the principle of",
    opts: ["self induction", "eddy currents", "mutual induction", "hysteresis"],
    ans: "C",
    expl: "Energy is transferred between primary and secondary windings through mutual induction in the shared magnetic core.",
  },
  {
    stem: "The power factor cos φ of a purely resistive AC circuit is",
    opts: ["unity", "zero", "0.5 leading", "0.8 lagging"],
    ans: "A",
    expl: "In a purely resistive circuit, voltage and current are in phase, so cos φ = 1.",
  },
  {
    stem: "Which of the following rotating machines develops a self-starting torque without any auxiliary starting arrangement?",
    opts: ["DC series motor", "Three-phase induction motor", "Synchronous motor", "Single-phase capacitor-start motor"],
    ans: "B",
    expl: "The rotating magnetic field of a balanced 3-phase supply makes the induction motor inherently self-starting; synchronous motors are not.",
  },
  {
    stem: "The standard frequency of the domestic AC power supply in most of Asia and Europe, including India, is",
    opts: ["40 Hz", "50 Hz", "60 Hz", "100 Hz"],
    ans: "B",
    expl: "India and Europe use 50 Hz; North America uses 60 Hz.",
  },
  {
    stem: "The main purpose of earthing an electrical installation is to",
    opts: ["reduce power consumption", "increase the system voltage", "improve the power factor", "provide a low-resistance path for fault current"],
    ans: "D",
    expl: "Earthing gives fault current (and protective devices) a low-impedance path to clear faults safely.",
  },
  {
    stem: "The armature core of a DC machine is built up of laminated steel sheets in order to",
    opts: ["reduce eddy current loss", "reduce hysteresis loss", "reduce bearing friction", "reduce copper loss"],
    ans: "A",
    expl: "Laminations break up circulating eddy currents in the rotating core, cutting eddy current losses.",
  },
  {
    stem: "In a balanced three-phase star-connected system, the line voltage VL is related to the phase voltage Vph by the relation VL =",
    opts: ["Vph", "3 × Vph", "\u221a3 × Vph", "Vph ÷ \u221a3"],
    ans: "C",
    expl: "For a star connection, line voltage equals √3 times the phase voltage and leads it by 30°.",
  },
  {
    stem: "Which instrument is used to directly measure the true electrical power P = VI cos φ consumed by a load?",
    opts: ["Ammeter", "Wattmeter", "Voltmeter", "Ohmmeter"],
    ans: "B",
    expl: "A wattmeter responds to the product VI cos φ, reading real power directly.",
  },
];

const doc = new PDFDocument({ margin: 50, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

// Embedded Unicode fonts so √3, φ, × etc. extract correctly (real PDFs embed fonts with ToUnicode maps)
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
doc.registerFont("body", FONT);
doc.registerFont("bold", FONT_BOLD);

// Cover header
doc.font("bold").fontSize(17).text("ELECTRICAL ENGINEERING", { align: "center" });
doc.font("body").fontSize(12).text("Mock Test — Switchgear, Machines & Basic Circuits", { align: "center" });
doc.fontSize(9).fillColor("#555555").text("Time: 15 minutes   |   Marks per question: 2   |   Negative marking: -0.5", { align: "center" });
doc.moveDown(1.2);
doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#888888").stroke();
doc.moveDown(0.8);
doc.fillColor("#000000");

doc.fontSize(11);
QS.forEach((q, i) => {
  // Long stems wrap automatically across lines in PDFKit -> tests continuation
  doc.font("bold").text(`${i + 1}. ${q.stem}`);
  doc.font("body");
  ["A", "B", "C", "D"].forEach((L, k) => doc.text(`(${L}) ${q.opts[k]}`));
  doc.moveDown(0.55);
});

// footer on each question page (parser should strip it) — keep y inside the
// page content area to avoid phantom auto-page-breaks
const range = doc.bufferedPageRange();
for (let p = range.start; p < range.start + range.count; p++) {
  doc.switchToPage(p);
  const page = doc.page;
  const savedBottom = page.margins.bottom;
  page.margins.bottom = 0; // prevent pdfkit auto page-break while writing footer
  doc.font("body").fontSize(8).fillColor("#777777")
    .text(`EE Practice Set 1 — Page ${p + 1}`, 50, page.height - 30, { align: "center", lineBreak: false });
  page.margins.bottom = savedBottom;
  doc.fillColor("#000000");
}

// Answer key page
doc.addPage();
doc.font("bold").fontSize(14).text("ANSWER KEY & EXPLANATIONS");
doc.font("body").fontSize(11).moveDown(0.5);
QS.forEach((q, i) => {
  doc.text(`${i + 1}. (${q.ans}) ${q.opts["ABCD".indexOf(q.ans)]} — ${q.expl}`);
  doc.moveDown(0.25);
});
doc.end();

await new Promise((r) => setTimeout(r, 600));
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
