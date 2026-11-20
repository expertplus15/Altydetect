import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Logo } from "@/components/Logo";

// En-tête du site public (accueil, tarifs, pages légales).
export async function PublicHeader() {
  const t = await getTranslations("publicHeader");
  const session = await auth();
  const cta = session?.user ? (
    <Link
      href="/app"
      className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
    >
      {t("workspace")}
    </Link>
  ) : (
    <Link
      href="/inscription"
      className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
    >
      {t("signUp")}
    </Link>
  );
  // Téléphone : logo et bouton principal sur la première ligne, navigation sur la seconde.
  // Écran large : logo, navigation, bouton principal sur une seule ligne.
  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-4 px-4 py-2 md:flex-nowrap md:px-8 md:py-0">
        <Link
          href="/"
          className="order-1 flex items-center gap-2 text-[17px] font-bold text-gray-900"
        >
          <Logo />
          AltyDetect
        </Link>
        <div className="order-2 ml-auto md:order-3 md:ml-0">{cta}</div>
        <nav
          aria-label={t("nav")}
          className="order-3 -mx-2.5 flex w-full items-center gap-1 md:order-2 md:mx-0 md:ml-auto md:w-auto"
        >
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
          {!session?.user && (
            <Link
              href="/connexion"
              className="ml-auto inline-flex h-11 items-center px-2.5 font-medium text-gray-900 md:ml-0"
            >
              {t("signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
