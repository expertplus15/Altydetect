"use client";

import { FileSearch, PenLine, Repeat2, ScanText } from "lucide-react";
import { useTranslations } from "next-intl";

const TOOLS = [
  { key: "detect", icon: ScanText },
  { key: "plagiarism", icon: FileSearch },
  { key: "rewrite", icon: Repeat2 },
  { key: "write", icon: PenLine },
] as const;

export function Sidebar({ open }: { open: boolean }) {
  const t = useTranslations("sidebar");

  return (
    <aside
      id="sidebar"
      className={`${open ? "flex" : "hidden"} w-[220px] shrink-0 flex-col gap-6 border-r border-gray-200 p-3 md:flex`}
    >
      <nav aria-label={t("navigation")}>
        <h2 className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-gray-600">
          {t("tools")}
        </h2>
        <ul className="flex flex-col gap-1">
          {TOOLS.map(({ key, icon: Icon }) => (
            <li key={key}>
              <button
                type="button"
                className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-sm text-gray-800 hover:bg-gray-100"
              >
                <Icon aria-hidden size={18} />
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section>
        <h2 className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-gray-600">
          {t("recent")}
        </h2>
        <p className="px-2 text-sm text-gray-600">{t("noRecent")}</p>
      </section>
    </aside>
  );
}
