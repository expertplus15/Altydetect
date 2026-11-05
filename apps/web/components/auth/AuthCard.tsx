import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Mise en page des pages de connexion et d'inscription.
export async function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = await getTranslations("header");
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="flex h-16 items-center px-4 md:px-8">
        <Link href="/" className="text-base font-bold text-gray-900">
          {t("brand")}
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 md:pt-16">
        <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-6 md:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
            <p className="text-sm text-gray-600">{subtitle}</p>
          </div>
          {children}
          <div className="text-sm text-gray-600">{footer}</div>
        </div>
      </main>
    </div>
  );
}
