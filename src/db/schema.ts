import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Uploaded PDF manifests (one row per uploaded file / demo import)
// ---------------------------------------------------------------------------
export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  kind: text("kind").notNull().default("questions"), // questions | answer_key
  status: text("status").notNull().default("processing"), // processing | done | partial | failed
  warnings: jsonb("warnings")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  questionsFound: integer("questions_found").notNull().default(0),
  keyAnswersFound: integer("key_answers_found").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------
export interface QuestionOptions {
  [letter: string]: string;
}

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").references(() => sources.id, {
      onDelete: "cascade",
    }),
    sourceLabel: text("source_label").notNull().default("manual"),
    pageNumber: integer("page_number"),
    questionNumber: integer("question_number"),
    text: text("text").notNull().default(""),
    options: jsonb("options")
      .$type<QuestionOptions>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    correctAnswer: text("correct_answer"),
    answerSource: text("answer_source").notNull().default("none"), // pdf_answer_key | pdf_marked | ai_generated | manual | none
    verificationStatus: text("verification_status")
      .notNull()
      .default("needs_verification"), // verified | needs_verification
    topic: text("topic"),
    explanation: text("explanation"),
    warnings: jsonb("warnings")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    contentHash: text("content_hash").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("questions_hash_idx").on(t.contentHash),
    index("questions_source_idx").on(t.sourceId),
    index("questions_topic_idx").on(t.topic),
    index("questions_status_idx").on(t.verificationStatus),
  ],
);

// ---------------------------------------------------------------------------
// Generated mock tests (immutable snapshot of questions for fair scoring)
// ---------------------------------------------------------------------------
export interface PresentedQuestion {
  qid: string;
  number: number | null;
  text: string;
  topic: string | null;
  explanation: string | null;
  sourceLabel: string;
  pageNumber: number | null;
  optionOrder: string[]; // original letters in presented order (A,B,C,D -> e.g. ['C','A','D','B'])
  optionsPresented: QuestionOptions; // presented letter -> text
  correctAnswer: string | null; // original letter
  answerSource: string;
  verificationStatus: string;
}

export interface TestConfig {
  name: string;
  scope: { type: string; sourceIds?: string[]; topics?: string[]; ids?: string[] };
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  durationMinutes: number; // 0 = unlimited
  marksPerQuestion: number;
  negativeMarks: number;
  includeUnverified: boolean;
}

export const tests = pgTable("tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  config: jsonb("config")
    .$type<TestConfig>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  snapshot: jsonb("snapshot")
    .$type<PresentedQuestion[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  gradableCount: integer("gradable_count").notNull().default(0),
  maxMarks: real("max_marks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Test attempts with autosaved progress and computed results
// ---------------------------------------------------------------------------
export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    testId: uuid("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status").notNull().default("in_progress"), // in_progress | submitted
    answers: jsonb("answers")
      .$type<Record<string, string>>() // qid -> presented letter
      .notNull()
      .default(sql`'{}'::jsonb`),
    marked: jsonb("marked")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    currentIndex: integer("current_index").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    remainingSeconds: integer("remaining_seconds"),
    timeTakenSeconds: integer("time_taken_seconds"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [index("attempts_test_idx").on(t.testId)],
);
