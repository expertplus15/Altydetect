// Icônes de la barre latérale (Lucide), décoratives : le libellé est toujours présent.
import { FileSearch, History, PenLine, Repeat2, ScanText, SpellCheck } from "lucide-react";

export const TOOL_ICONS = {
  detect: ScanText,
  plagiarism: FileSearch,
  rewrite: Repeat2,
  write: PenLine,
  correct: SpellCheck,
  history: History,
} as const;
