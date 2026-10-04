-- AlterTable
ALTER TABLE "ErrorRecord" ADD COLUMN     "masteredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GrammarTopic" ADD COLUMN     "masteredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VocabItem" ADD COLUMN     "masteredAt" TIMESTAMP(3);
