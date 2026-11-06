import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Logo } from "@/components/Logo";

// En-tête du site public (accueil, tarifs, pages légales).
export async function PublicHeader() {
  const t = await getTranslations("publicHeader");
  const session = await auth();
  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-bold text-gray-900">
          <Logo />
          AltyDetect
        </Link>
        <nav aria-label={t("nav")} className="ml-auto flex flex-wrap items-center gap-1">
          <Link
            href="/"
            className="inline-flex h-11 items-center px-2.5 text-gray-600 hover:text-gray-900"
          >
            {t("tools")}
          </Link>
          <Link
            href="/tarifs"
            className="inline-flex h-11 items-center px-2.5 text-gray-600 hover:text-gray-900"
          >
            {t("pricing")}
          </Link>
          <LocaleSwitcher />
          {session?.user ? (
            <Link
              href="/app"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
            >
              {t("workspace")}
            </Link>
          ) : (
            <>
              <Link
                href="/connexion"
                className="inline-flex h-11 items-center px-2.5 font-medium text-gray-900"
              >
                {t("signIn")}
              </Link>
              <Link
                href="/inscription"
                className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
              >
                {t("signUp")}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
