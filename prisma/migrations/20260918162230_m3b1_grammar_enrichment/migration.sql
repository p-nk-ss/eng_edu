-- AlterTable
ALTER TABLE "GrammarTopic" ADD COLUMN     "description" TEXT,
ADD COLUMN     "example" TEXT,
ADD COLUMN     "importance" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "teachable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "title" TEXT;
