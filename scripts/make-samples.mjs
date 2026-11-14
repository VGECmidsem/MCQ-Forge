// Generates sample MCQ PDFs for end-to-end testing of the pipeline.
import fs from "node:fs";
import PDFDocument from "pdfkit";
import { createCanvas } from "@napi-rs/canvas";

fs.mkdirSync("/app/scratch/samples", { recursive: true });

// ---------- Sample 1: vertical options + trailing answer key + explanations
{
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream("/app/scratch/samples/sample-vertical-key.pdf"));
  doc.fontSize(16).text("Electrical Engineering — Practice Set 1", { align: "center" });
  doc.moveDown();
  const qs = [
    ["Which device is used to protect a circuit against overcurrent?", "Isolator", "Circuit breaker", "Voltmeter", "Energy meter"],
    ["Ohm's law states that V equals", "I divided by R", "I times R", "R divided by I", "I plus R"],
    ["The unit of electrical power is the", "Joule", "Watt", "Coulomb", "Farad"],
    ["Which of the following materials is the best conductor of electricity?", "Aluminium", "Copper", "Silver", "Gold"],
    ["A transformer works on the principle of", "self induction", "mutual induction", "eddy currents", "hysteresis"],
  ];
  doc.fontSize(11);
  qs.forEach((q, i) => {
    doc.font("Helvetica-Bold").text(`${i + 1}. ${q[0]}`);
    doc.font("Helvetica");
    ["A", "B", "C", "D"].forEach((L, k) => doc.text(`(${L}) ${q[k + 1]}`));
    doc.moveDown(0.6);
  });
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(14).text("ANSWER KEY");
  doc.font("Helvetica").fontSize(11).moveDown(0.5);
  const keys = ["B", "B", "B", "C", "B"];
  keys.forEach((k, i) => {
    const expl = [
      "A circuit breaker automatically interrupts the circuit during overcurrent faults.",
      "V = I × R is the statement of Ohm's law.",
      "Power is measured in watts.",
      "Silver has the lowest resistivity of common conductor materials.",
      "Transformers transfer energy via mutual induction between windings.",
    ][i];
    doc.text(`${i + 1}. (${k}) — ${expl}`);
  });
  doc.end();
  await new Promise((r) => setTimeout(r, 400));
}

// ---------- Sample 2: horizontal options + inline Ans markers + multi-line question
{
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream("/app/scratch/samples/sample-horizontal-inline.pdf"));
  doc.fontSize(14).font("Helvetica").text("General Knowledge Quiz", { align: "center" });
  doc.moveDown();
  const rows = [
    { n: 1, stem: "Which planet is known as the Red Planet?", opts: ["Venus", "Mars", "Jupiter", "Saturn"], ans: "B" },
    { n: 2, stem: "The Great Wall of China was primarily built to protect against invasions from the northern nomadic tribes. Who initiated the major unification of the wall?", opts: ["Qin Shi Huang", "Kublai Khan", "Sun Yat-sen", "Mao Zedong"], ans: "A" },
    { n: 3, stem: "Which organ in the human body produces insulin?", opts: ["Liver", "Kidney", "Pancreas", "Spleen"], ans: "C" },
    { n: 4, stem: "The chemical formula of common table salt is", opts: ["NaCl", "KCl", "NaOH", "CaCO3"], ans: "A" },
  ];
  doc.fontSize(11);
  for (const q of rows) {
    doc.text(`Q.${q.n} ${q.stem}`);
    // horizontal: all four options on ONE line separated by wide gaps
    doc.text(`(A) ${q.opts[0]}    (B) ${q.opts[1]}    (C) ${q.opts[2]}    (D) ${q.opts[3]}`);
    doc.text(`Ans: ${q.ans}`);
    doc.moveDown(0.7);
  }
  doc.end();
  await new Promise((r) => setTimeout(r, 400));
}

// ---------- Sample 3: bold-marked correct options (no key at all)
{
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream("/app/scratch/samples/sample-bold-marked.pdf"));
  doc.fontSize(14).font("Helvetica").text("Mathematics Drill (answers marked in bold)", { align: "center" });
  doc.moveDown();
  const rows = [
    { n: 1, stem: "The derivative of x squared with respect to x is", opts: ["x", "2x", "x squared", "2"], ans: 1 },
    { n: 2, stem: "log10(1000) equals", opts: ["2", "3", "10", "100"], ans: 1 },
    { n: 3, stem: "The sum of interior angles of a triangle is", opts: ["90 degrees", "180 degrees", "270 degrees", "360 degrees"], ans: 1 },
  ];
  doc.fontSize(11);
  for (const q of rows) {
    doc.font("Helvetica-Bold").text(`${q.n}. ${q.stem}`);
    q.opts.forEach((o, k) => {
      doc.font(k === q.ans ? "Helvetica-Bold" : "Helvetica").text(`(${["A", "B", "C", "D"][k]}) ${o}`);
    });
    doc.font("Helvetica");
    doc.moveDown(0.7);
  }
  doc.end();
  await new Promise((r) => setTimeout(r, 400));
}

// ---------- Sample 4: scanned (image-only) PDF for OCR path
{
  const canvas = createCanvas(1240, 1754); // A4 @150dpi
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1240, 1754);
  ctx.fillStyle = "#111111";
  ctx.font = "30px sans-serif";
  ctx.fillText("Computer Basics Test", 430, 100);
  ctx.font = "24px sans-serif";
  const lines = [
    "1. What does CPU stand for?",
    "(A) Central Processing Unit   (B) Computer Personal Unit",
    "(C) Central Program Utility   (D) Computer Processing Unit",
    "",
    "2. Which of the following is a non-volatile memory?",
    "(A) RAM    (B) Cache memory    (C) ROM    (D) Register",
    "",
    "3. Binary number system uses the digits",
    "(A) 0 to 9    (B) 0 and 1    (C) 1 and 2    (D) 0 to 7",
    "",
    "ANSWER KEY",
    "1. A    2. C    3. B",
  ];
  lines.forEach((l, i) => ctx.fillText(l, 90, 170 + i * 40));
  const png = canvas.toBuffer("image/png");
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  doc.pipe(fs.createWriteStream("/app/scratch/samples/sample-scanned.pdf"));
  doc.image(png, 0, 0, { width: 595.28, height: 841.89 });
  doc.end();
  await new Promise((r) => setTimeout(r, 400));
}

console.log("samples ready:", fs.readdirSync("/app/scratch/samples"));
