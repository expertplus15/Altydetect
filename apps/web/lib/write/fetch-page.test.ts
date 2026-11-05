import { describe, expect, it } from "vitest";
import { fetchPage, isPublicAddress } from "./fetch-page";

describe("isPublicAddress", () => {
  it("refuse les adresses privées, locales et réservées", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.20.1.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("accepte les adresses publiques", () => {
    for (const ip of ["93.184.216.34", "2606:2800:220:1::1", "172.32.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("fetchPage", () => {
  it("refuse une URL vers le réseau interne sans la télécharger", async () => {
    expect(await fetchPage("http://169.254.169.254/latest/meta-data")).toEqual({
      ok: false,
      error: "BLOCKED_ADDRESS",
    });
    expect(await fetchPage("http://localhost:3000/")).toEqual({
      ok: false,
      error: "BLOCKED_ADDRESS",
    });
    expect(await fetchPage("https://user:pass@example.com/")).toEqual({
      ok: false,
      error: "BLOCKED_ADDRESS",
    });
  });
});
