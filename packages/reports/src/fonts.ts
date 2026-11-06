import { Font } from "@react-pdf/renderer";
import { fileURLToPath } from "node:url";

const fontsDir = fileURLToPath(new URL("../fonts/", import.meta.url));
let registered = false;

/** Inter statique (la version variable n'est pas prise en charge par le moteur PDF). */
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: "Inter",
    fonts: [
      { src: `${fontsDir}Inter-Regular.woff` },
      { src: `${fontsDir}Inter-SemiBold.woff`, fontWeight: 600 },
    ],
  });
  // Pas de césure automatique : les mots français restent entiers.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
