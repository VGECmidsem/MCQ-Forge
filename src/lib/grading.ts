// Shared snapshot-building and grading logic for mock tests.
// Key invariant: shuffled option order NEVER changes correctness — grading
// maps the presented letter back through optionOrder to the original letter.

import { LETTERS, shuffle } from "@/lib/utils";
import type { PresentedQuestion, TestConfig } from "@/db/schema";

export interface BankQuestion {
  id: string;
  questionNumber: number | null;
  text: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  answerSource: string;
  verificationStatus: string;
  explanation: string | null;
  topic: string | null;
  sourceLabel: string;
  pageNumber: number | null;
}

export function buildSnapshot(
  bank: BankQuestion[],
  config: Pick<TestConfig, "shuffleOptions">,
): PresentedQuestion[] {
  return bank.map((q) => {
    const originalLetters = Object.keys(q.options);
    const order = config.shuffleOptions ? shuffle(originalLetters) : [...originalLetters];
    const optionsPresented: Record<string, string> = {};
    order.forEach((origLetter, idx) => {
      optionsPresented[LETTERS[idx]] = q.options[origLetter];
    });
    return {
      qid: q.id,
      number: q.questionNumber,
      text: q.text,
      topic: q.topic,
      explanation: q.explanation,
      sourceLabel: q.sourceLabel,
      pageNumber: q.pageNumber,
      optionOrder: order,
      optionsPresented,
      correctAnswer: q.correctAnswer,
      answerSource: q.answerSource,
      verificationStatus: q.verificationStatus,
    };
  });
}

// Strip answer material before sending a test to the browser.
export function sanitizeSnapshot(snapshot: PresentedQuestion[]) {
  return snapshot.map((q) => ({
    qid: q.qid,
    number: q.number,
    text: q.text,
    topic: q.topic,
    sourceLabel: q.sourceLabel,
    pageNumber: q.pageNumber,
    options: q.optionsPresented,
    letters: LETTERS.slice(0, q.optionOrder.length),
    flagged: q.verificationStatus !== "verified",
  }));
}

export interface ReviewItem {
  qid: string;
  number: number | null;
  text: string;
  topic: string | null;
  sourceLabel: string;
  pageNumber: number | null;
  options: Record<string, string>;
  userLetter: string | null; // presented letter chosen by the user
  userOriginalLetter: string | null;
  correctLetter: string | null; // presented letter that is correct
  correctOriginalLetter: string | null;
  isCorrect: boolean | null; // null when ungradable (unverified, no known answer)
  explanation: string | null;
  marked: boolean;
  flagged: boolean;
}

export interface GradingResult {
  total: number;
  gradable: number;
  attempted: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  ungraded: number;
  marksPerQuestion: number;
  negativePerWrong: number;
  positiveMarks: number;
  negativeMarks: number;
  marksObtained: number;
  maxMarks: number;
  percentage: number;
  accuracy: number;
  timeTakenSeconds: number;
  perTopic: { topic: string; total: number; attempted: number; correct: number }[];
  review: ReviewItem[];
}

export function gradeAttempt(
  snapshot: PresentedQuestion[],
  answers: Record<string, string>,
  marked: string[],
  cfg: Pick<TestConfig, "marksPerQuestion" | "negativeMarks">,
  timeTakenSeconds: number,
): GradingResult {
  const marks = cfg.marksPerQuestion || 1;
  const neg = cfg.negativeMarks || 0;
  const review: ReviewItem[] = [];
  const topicAgg = new Map<string, { total: number; attempted: number; correct: number }>();

  let correct = 0;
  let incorrect = 0;
  let attempted = 0;
  let gradable = 0;

  snapshot.forEach((q) => {
    const presentedLetters = LETTERS.slice(0, q.optionOrder.length);
    const userLetter = answers[q.qid] ?? null;
    const userIdx = userLetter ? presentedLetters.indexOf(userLetter) : -1;
    const userOriginal = userIdx >= 0 ? q.optionOrder[userIdx] : null;
    const isGradable = !!q.correctAnswer && q.optionOrder.includes(q.correctAnswer);
    if (isGradable) gradable++;

    let correctPresented: string | null = null;
    if (isGradable) {
      const cIdx = q.optionOrder.indexOf(q.correctAnswer!);
      correctPresented = presentedLetters[cIdx] ?? null;
    }

    const didAttempt = userIdx >= 0;
    let isCorrect: boolean | null = null;
    if (isGradable) {
      isCorrect = didAttempt ? userOriginal === q.correctAnswer : false;
      if (didAttempt) {
        attempted++;
        if (isCorrect) correct++;
        else incorrect++;
      }
    }

    const topic = q.topic || "General";
    const agg = topicAgg.get(topic) ?? { total: 0, attempted: 0, correct: 0 };
    if (isGradable) agg.total++;
    if (isGradable && didAttempt) agg.attempted++;
    if (isGradable && isCorrect === true) agg.correct++;
    topicAgg.set(topic, agg);

    review.push({
      qid: q.qid,
      number: q.number,
      text: q.text,
      topic: q.topic,
      sourceLabel: q.sourceLabel,
      pageNumber: q.pageNumber,
      options: q.optionsPresented,
      userLetter: didAttempt ? userLetter : null,
      userOriginalLetter: userOriginal,
      correctLetter: correctPresented,
      correctOriginalLetter: q.correctAnswer,
      isCorrect,
      explanation: q.explanation,
      marked: marked.includes(q.qid),
      flagged: q.verificationStatus !== "verified",
    });
  });

  const positiveMarks = correct * marks;
  const negativeMarks = incorrect * neg;
  const marksObtained = Math.round((positiveMarks - negativeMarks) * 100) / 100;
  const maxMarks = gradable * marks;
  const percentage = maxMarks > 0 ? Math.round((marksObtained / maxMarks) * 1000) / 10 : 0;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0;

  return {
    total: snapshot.length,
    gradable,
    attempted,
    correct,
    incorrect,
    unanswered: snapshot.length - attempted,
    ungraded: snapshot.length - gradable,
    marksPerQuestion: marks,
    negativePerWrong: neg,
    positiveMarks,
    negativeMarks,
    marksObtained,
    maxMarks,
    percentage,
    accuracy,
    timeTakenSeconds,
    perTopic: [...topicAgg.entries()]
      .map(([topic, v]) => ({ topic, ...v }))
      .sort((a, b) => b.total - a.total),
    review,
  };
}
