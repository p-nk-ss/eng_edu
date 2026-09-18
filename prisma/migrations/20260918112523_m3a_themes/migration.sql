-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "theme" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "preferredThemes" TEXT[] DEFAULT ARRAY[]::TEXT[];
