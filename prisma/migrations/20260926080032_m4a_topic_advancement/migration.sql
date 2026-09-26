-- AlterTable
ALTER TABLE "GrammarTopic" ADD COLUMN     "goodLessons" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lessonsCompleted" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "writtenCompletedAt" TIMESTAMP(3),
ADD COLUMN     "writtenScore" DOUBLE PRECISION;
