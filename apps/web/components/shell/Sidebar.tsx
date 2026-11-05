"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppPathname } from "@/i18n/routing";
import { TOOL_ICONS } from "./icons";

export interface RecentDocument {
  id: string;
  title: string;
  type: "rewrite" | "write" | "detect" | "plagiarism" | null;
  createdAt: string;
}

const TOOLS: {
  key: "detect" | "plagiarism" | "rewrite" | "write" | "correct";
  href: AppPathname;
  soon?: boolean;
}[] = [
  { key: "detect", href: "/app/detecter", soon: true },
  { key: "plagiarism", href: "/app/plagiat" },
  { key: "rewrite", href: "/app/reecrire" },
  { key: "write", href: "/app/ecrire" },
  { key: "correct", href: "/app/corriger" },
];

// Barre latérale : 220 px au-dessus de 1024 px, repliée en icônes en dessous.
export function Sidebar({ recents }: { recents: RecentDocument[] }) {
  const t = useTranslations("sidebar");
  const pathname = usePathname();

  return (
    <aside className="flex w-16 shrink-0 flex-col gap-1 border-r border-gray-200 bg-gray-50/60 px-2 py-4 lg:w-[220px] lg:px-3">
      <nav aria-label={t("navigation")} className="flex flex-col gap-1">
        <h2 className="hidden px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600 lg:block">
          {t("tools")}
        </h2>
        {TOOLS.map(({ key, href, soon }) => {
          const Icon = TOOL_ICONS[key];
          const active = pathname === href;
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={t(key)}
              className={`flex h-11 items-center justify-center gap-2.5 rounded-lg px-2.5 text-sm lg:justify-start ${
                active
                  ? "bg-accent/10 font-semibold text-accent"
                  : soon
                    ? "text-gray-600 hover:bg-gray-100"
                    : "text-gray-900 hover:bg-gray-100"
              }`}
            >
              <Icon aria-hidden size={18} className="shrink-0" />
              <span className="hidden flex-1 lg:inline">{t(key)}</span>
              {soon && (
                <span className="hidden rounded-full border border-gray-300 px-1.5 text-[11px] text-gray-600 lg:inline">
                  {t("soon")}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <section aria-labelledby="recents-title" className="mt-5 hidden flex-col gap-0.5 lg:flex">
        <h2
          id="recents-title"
          className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600"
        >
          {t("recent")}
        </h2>
        {recents.length === 0 ? (
          <p className="px-2.5 text-sm text-gray-600">{t("noRecent")}</p>
        ) : (
          recents.map((doc) => (
            <Link
              key={doc.id}
              href={{ pathname: "/app/historique", query: { document: doc.id } }}
              className="truncate rounded-lg px-2.5 py-2 text-[13px] text-gray-900 hover:bg-gray-100"
            >
              {doc.title}
            </Link>
          ))
        )}
        <Link
          href="/app/historique"
          className="px-2.5 py-2 text-[13px] font-medium text-accent hover:underline"
        >
          {t("allHistory")}
        </Link>
      </section>
    </aside>
  );
}
