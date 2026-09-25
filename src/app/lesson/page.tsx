import { redirect } from "next/navigation";
import { SideNav } from "@/components/nav";
import { StartLessonButton } from "@/components/StartLessonButton";
import { prisma } from "@/lib/db";
import { findResumableLessonId } from "@/lib/lesson/resumable";

export const dynamic = "force-dynamic";

/** Nav target "Lesson": open the lesson in progress, or offer to start one. */
export default async function LessonIndexPage() {
  const id = await findResumableLessonId(prisma, new Date());
  if (id) redirect(`/lesson/${id}`);
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 p-6">
        <h1 className="font-display text-2xl font-extrabold">No lesson in progress</h1>
        <StartLessonButton />
      </main>
    </div>
  );
}
