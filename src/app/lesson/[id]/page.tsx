import { notFound } from "next/navigation";
import { SideNav } from "@/components/nav";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";
import { loadLessonForPlayer } from "@/lib/lesson/loadLesson";

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lesson = await loadLessonForPlayer(id);
  if (!lesson) notFound();
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto w-full max-w-2xl p-4 md:p-6">
        <LessonPlayer lesson={lesson} />
      </main>
    </div>
  );
}
