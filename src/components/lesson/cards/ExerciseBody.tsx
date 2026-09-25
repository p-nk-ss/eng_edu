"use client";

import type { GradeResult } from "@/lib/grading/types";
import type { ExerciseView } from "@/lib/lesson/lessonView";
import { ChoiceCard } from "./ChoiceCard";
import { ClozeSelectCard } from "./ClozeSelectCard";
import { DialogueCard } from "./DialogueCard";
import { DictationCard } from "./DictationCard";
import { ErrorCorrectCard } from "./ErrorCorrectCard";
import { FillBlankCard } from "./FillBlankCard";
import { TranslationCard, WritingCard } from "./FreeTextCard";
import { MatchCard } from "./MatchCard";
import type { AnswerPayload } from "./types";
import { WordBankCard } from "./WordBankCard";

interface Props {
  view: ExerciseView;
  disabled: boolean;
  result: GradeResult | null;
  onChange: (answer: AnswerPayload | null) => void;
  onSubmit: () => void;
}

export function ExerciseBody({ view, disabled, result, onChange, onSubmit }: Props) {
  const common = { disabled, result, onChange: onChange as never };
  switch (view.type) {
    case "mcq":
      return <ChoiceCard view={view} {...common} />;
    case "dialogue_gap":
      return <DialogueCard view={view} {...common} />;
    case "cloze_mc":
      return <ClozeSelectCard view={view} {...common} />;
    case "open_cloze":
      return <FillBlankCard view={view} {...common} />;
    case "word_bank":
      return <WordBankCard view={view} {...common} />;
    case "match":
      return <MatchCard view={view} {...common} />;
    case "dictation":
      return <DictationCard view={view} {...common} />;
    case "error_correct":
      return <ErrorCorrectCard view={view} {...common} />;
    case "translation":
      return <TranslationCard view={view} {...common} onSubmit={onSubmit} />;
    case "open_writing":
      return <WritingCard view={view} {...common} onSubmit={onSubmit} />;
  }
}
