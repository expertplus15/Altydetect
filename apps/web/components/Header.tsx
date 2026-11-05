"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOutAction } from "@/lib/auth/actions";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function Header({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useTranslations("header");
  const tAuth = useTranslations("auth");

  return (
    <header className="flex h-14 items-center gap-3 border-b border-gray-200 px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? t("closeSidebar") : t("openSidebar")}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 md:hidden"
      >
        {sidebarOpen ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
      </button>
      <span className="text-base font-semibold">{t("brand")}</span>
      <div className="ml-auto flex items-center gap-2">
        <LocaleSwitcher />
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {tAuth("signOut")}
          </button>
        </form>
      </div>
    </header>
  );
}
