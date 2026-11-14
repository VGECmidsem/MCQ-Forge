import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { questions, sources } from "@/db/schema";
import { fingerprintOf } from "@/lib/utils";

export const runtime = "nodejs";

const DEMO: Array<{
  text: string;
  options: Record<string, string>;
  answer: string;
  explanation: string;
  topic: string;
}> = [
  { text: "Which device is used to protect a circuit against overcurrent?", options: { A: "Isolator", B: "Circuit breaker", C: "Voltmeter", D: "Energy meter" }, answer: "B", explanation: "A circuit breaker interrupts the circuit automatically when an overcurrent condition occurs.", topic: "Physics" },
  { text: "What is the SI unit of electric resistance?", options: { A: "Volt", B: "Ampere", C: "Ohm", D: "Watt" }, answer: "C", explanation: "Resistance is measured in ohms, defined as one volt per ampere.", topic: "Physics" },
  { text: "A body moving with uniform velocity has an acceleration of", options: { A: "maximum value", B: "zero", C: "constant non-zero value", D: "increasing value" }, answer: "B", explanation: "Uniform velocity means no change in velocity, so acceleration is zero.", topic: "Physics" },
  { text: "Which of the following is the chemical symbol for sodium?", options: { A: "So", B: "Sd", C: "Na", D: "N" }, answer: "C", explanation: "Sodium's symbol Na comes from its Latin name 'natrium'.", topic: "Chemistry" },
  { text: "The pH of a neutral solution at 25 °C is", options: { A: "0", B: "14", C: "1", D: "7" }, answer: "D", explanation: "Neutral solutions have equal H+ and OH- concentrations, giving pH 7 at 25 °C.", topic: "Chemistry" },
  { text: "Which organelle is known as the powerhouse of the cell?", options: { A: "Ribosome", B: "Nucleus", C: "Mitochondrion", D: "Golgi apparatus" }, answer: "C", explanation: "Mitochondria produce most of the cell's ATP through cellular respiration.", topic: "Biology" },
  { text: "DNA replication is described as semi-conservative because", options: { A: "only half the DNA is copied", B: "each new molecule has one old and one new strand", C: "it occurs only in sex cells", D: "it requires no enzymes" }, answer: "B", explanation: "Each daughter DNA molecule retains one parental strand and one newly synthesised strand.", topic: "Biology" },
  { text: "What is the value of the integral of 1/x dx?", options: { A: "x^2 / 2 + C", B: "ln|x| + C", C: "1/x^2 + C", D: "e^x + C" }, answer: "B", explanation: "The antiderivative of 1/x is the natural logarithm of |x| plus a constant.", topic: "Mathematics" },
  { text: "If a fair die is rolled once, the probability of getting a number greater than 4 is", options: { A: "1/2", B: "1/3", C: "2/3", D: "1/6" }, answer: "B", explanation: "Favourable outcomes are 5 and 6, so probability = 2/6 = 1/3.", topic: "Mathematics" },
  { text: "Which data structure uses the First-In-First-Out (FIFO) principle?", options: { A: "Stack", B: "Queue", C: "Tree", D: "Graph" }, answer: "B", explanation: "A queue dequeues elements in the same order they were enqueued.", topic: "Computer Science" },
  { text: "What does the 'S' stand for in HTTPS?", options: { A: "Server", B: "Socket", C: "Secure", D: "Session" }, answer: "C", explanation: "HTTPS is HTTP over a secure TLS/SSL encrypted channel.", topic: "Computer Science" },
  { text: "The Great Barrier Reef is located near the coast of", options: { A: "Brazil", B: "South Africa", C: "Australia", D: "Japan" }, answer: "C", explanation: "The Great Barrier Reef lies off the north-eastern coast of Queensland, Australia.", topic: "Geography" },
  { text: "Which river is generally considered the longest in the world?", options: { A: "Amazon", B: "Nile", C: "Yangtze", D: "Mississippi" }, answer: "B", explanation: "The Nile (about 6,650 km) is traditionally regarded as the longest river, slightly ahead of the Amazon.", topic: "Geography" },
  { text: "Who wrote the play 'Romeo and Juliet'?", options: { A: "Charles Dickens", B: "William Shakespeare", C: "Jane Austen", D: "Oscar Wilde" }, answer: "B", explanation: "Romeo and Juliet is a tragedy written by William Shakespeare in the 1590s.", topic: "English" },
  { text: "In which year did the French Revolution begin?", options: { A: "1776", B: "1789", C: "1804", D: "1815" }, answer: "B", explanation: "The French Revolution began in 1789 with the summoning of the Estates-General and the storming of the Bastille.", topic: "History & Polity" },
  { text: "Find the odd one out: 3, 5, 11, 14, 17", options: { A: "3", B: "5", C: "14", D: "17" }, answer: "C", explanation: "14 is the only even number; the rest are primes.", topic: "Reasoning" },
  { text: "A deficit budget implies that", options: { A: "revenue exceeds expenditure", B: "expenditure exceeds revenue", C: "revenue equals expenditure", D: "exports exceed imports" }, answer: "B", explanation: "A deficit budget is one where government expenditure exceeds its revenue.", topic: "Economics" },
  { text: "Which particle carries a negative electric charge?", options: { A: "Proton", B: "Neutron", C: "Electron", D: "Photon" }, answer: "C", explanation: "Electrons carry a fundamental negative charge; protons are positive and neutrons neutral.", topic: "Physics" },
];

export async function POST() {
  const existing = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.sourceLabel, "demo-bank.pdf"))
    .limit(1);
  if (existing.length) {
    return Response.json({ already: true, inserted: 0 });
  }
  const [src] = await db
    .insert(sources)
    .values({
      filename: "demo-bank.pdf",
      sizeBytes: 0,
      pageCount: 3,
      kind: "questions",
      status: "done",
      questionsFound: DEMO.length,
      keyAnswersFound: DEMO.length,
    })
    .returning();
  const rows = DEMO.map((d, i) => ({
    sourceId: src.id,
    sourceLabel: "demo-bank.pdf",
    questionNumber: i + 1,
    pageNumber: 1 + Math.floor(i / 7),
    text: d.text,
    options: d.options,
    correctAnswer: d.answer,
    answerSource: "manual",
    verificationStatus: "verified",
    topic: d.topic,
    explanation: d.explanation,
    warnings: [] as string[],
    contentHash: crypto.createHash("sha256").update(fingerprintOf(d.text, d.options)).digest("hex").slice(0, 32),
  }));
  await db.insert(questions).values(rows);
  return Response.json({ inserted: rows.length, already: false });
}
