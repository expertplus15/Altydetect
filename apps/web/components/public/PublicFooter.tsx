import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function PublicFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-[13px] text-gray-600 md:px-8">
        <span>{t("rights", { year: new Date().getFullYear() })}</span>
        <Link href="/cgu" className="hover:underline">
          {t("terms")}
        </Link>
        <Link href="/confidentialite" className="hover:underline">
          {t("privacy")}
        </Link>
        <Link href="/mentions-legales" className="hover:underline">
          {t("legal")}
        </Link>
      </div>
    </footer>
  );
}
