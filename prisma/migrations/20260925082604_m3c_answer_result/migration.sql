-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "result" JSONB;
