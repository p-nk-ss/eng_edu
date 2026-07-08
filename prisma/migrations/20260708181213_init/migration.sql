-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('MULTIPLE_CHOICE', 'CLOZE_DROPDOWN', 'FILL_BLANK', 'WORD_BANK', 'MATCH', 'DIALOGUE_GAP', 'DICTATION', 'ERROR_CORRECTION', 'TRANSLATION', 'OPEN_WRITING');

-- CreateEnum
CREATE TYPE "ErrorSource" AS ENUM ('CONVERSATION', 'EXERCISE', 'WRITING');

-- CreateEnum
CREATE TYPE "ErrorStatus" AS ENUM ('NEW', 'REVIEWING', 'MASTERED');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('NOT_STARTED', 'INTRODUCED', 'PRACTICING', 'MASTERED');

-- CreateEnum
CREATE TYPE "VocabStatus" AS ENUM ('NEW', 'SEEN', 'LEARNING', 'KNOWN');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "nativeLang" TEXT NOT NULL DEFAULT 'ru',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LessonStatus" NOT NULL DEFAULT 'PLANNED',
    "currentSection" INTEGER NOT NULL DEFAULT 0,
    "plan" JSONB NOT NULL,
    "summary" TEXT,
    "nextPlan" TEXT,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "content" JSONB NOT NULL,
    "userAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "feedback" TEXT,
    "errorRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorRecord" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "grammarTopicId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "ErrorSource" NOT NULL,
    "status" "ErrorStatus" NOT NULL DEFAULT 'NEW',
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "corrections" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cefrLevel" TEXT NOT NULL,
    "category" TEXT,
    "status" "TopicStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "GrammarTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabItem" (
    "id" TEXT NOT NULL,
    "headword" TEXT NOT NULL,
    "pos" TEXT,
    "cefrLevel" TEXT NOT NULL,
    "topic" TEXT,
    "isPhrase" BOOLEAN NOT NULL DEFAULT false,
    "status" "VocabStatus" NOT NULL DEFAULT 'NEW',
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "VocabItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrammarTopic_name_key" ON "GrammarTopic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "VocabItem_headword_pos_key" ON "VocabItem"("headword", "pos");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorRecord" ADD CONSTRAINT "ErrorRecord_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorRecord" ADD CONSTRAINT "ErrorRecord_grammarTopicId_fkey" FOREIGN KEY ("grammarTopicId") REFERENCES "GrammarTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
