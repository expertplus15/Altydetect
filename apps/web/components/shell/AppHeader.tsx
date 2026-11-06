import { getFormatter, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Logo } from "@/components/Logo";
import { Link } from "@/i18n/navigation";
import { signOutAction } from "@/lib/auth/actions";

export interface HeaderData {
  plan: "free" | "pro";
  detectionUsed: number;
  detectionLimit: number;
  name: string | null;
  email: string;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// En-tête de l'espace connecté : quota visible en permanence (CLAUDE.md §8).
export async function AppHeader({ data }: { data: HeaderData }) {
  const t = await getTranslations("header");
  const format = await getFormatter();
  const used = format.number(data.detectionUsed);
  const limit = format.number(data.detectionLimit);
  const ratio = Math.min(1, data.detectionUsed / data.detectionLimit);

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 px-3 md:px-5">
      <Link href="/app" className="flex items-center gap-2 text-base font-bold text-gray-900">
        <Logo />
        <span className="hidden sm:inline">{t("brand")}</span>
      </Link>
      <nav aria-label={t("workspace")} className="hidden items-center gap-1 md:flex">
        <Link
          href="/app"
          className="inline-flex h-11 items-center px-2.5 font-medium text-gray-900"
        >
          {t("workspace")}
        </Link>
        <Link
          href="/tarifs"
          className="inline-flex h-11 items-center px-2.5 text-gray-600 hover:text-gray-900"
        >
          {t("pricing")}
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <LocaleSwitcher persist />
        <div
          className="hidden min-w-36 flex-col gap-1 sm:flex"
          title={t("quotaLabel", { used, limit })}
        >
          <span className="text-xs tabular-nums text-gray-600">
            <span className="sr-only">{t("quotaLabel", { used, limit })}</span>
            <span aria-hidden>{t("quota", { used, limit })}</span>
          </span>
          <span
            aria-hidden
            className="hidden h-1.5 overflow-hidden rounded-full bg-gray-200 sm:block"
          >
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
        </div>
        {data.plan === "pro" ? (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            {t("proBadge")}
          </span>
        ) : (
          <Link
            href="/tarifs"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:opacity-90 md:px-4"
          >
            {t("upgrade")}
          </Link>
        )}
        <details className="relative">
          <summary
            aria-label={t("accountMenu")}
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-[13px] font-bold text-accent">
              {initials(data.name, data.email)}
            </span>
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
            <p className="truncate px-3 py-2 text-xs text-gray-600">{data.email}</p>
            <Link href="/app/compte" className="rounded-lg px-3 py-2.5 text-sm hover:bg-gray-100">
              {t("account")}
            </Link>
            <Link
              href="/app/historique"
              className="rounded-lg px-3 py-2.5 text-sm hover:bg-gray-100"
            >
              {t("history")}
            </Link>
            <SignOut />
          </div>
        </details>
      </div>
    </header>
  );
}

async function SignOut() {
  const t = await getTranslations("auth");
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-gray-100"
      >
        {t("signOut")}
      </button>
    </form>
  );
}
