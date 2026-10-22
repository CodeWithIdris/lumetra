import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Scene } from "@/components/Scene";

describe("SylvaHero Integration", () => {
  const root = resolve(process.cwd());

  const expectedHashes: Record<string, string> = {
    "src/shaders/landing-pages/LandingPages.tsx":
      "4d379461ad00eb4de7900df312878035383de7e1ed4e13283b8143a2eea9d30a",
    "src/shaders/landing-pages/pageTypography.ts":
      "809cc65797d531cd3b3ca5a56815d55d24b3ee8d293e4e4bad6fdfe6c83244cc",
    "src/shaders/landing-pages/pageRecipes.ts":
      "c9d9849cc255bac2d1d938d088c50917f84916f1c516d2bbb27fcfd803523233",
    "src/shaders/landing-pages/LandingPageFrame.tsx":
      "61de2cc50888aac4ac5557420b07fa47ed3543bb57c1e0055fafdefa53dbaa78",
    "public/landing-pages/inner-green-3d.html":
      "69c3694bd63f44ef9f007ebe4dac57a83e4402e0cdf6b54dd10b96dd4f05e197",
    "public/landing-pages/inner-green-assets/three.min.js":
      "8a5f7249903b54d30f79f708699d2fed2d6a1d0741a4cd41377d1f01bb5a2271",
    "src/shaders/threeui.css": "efe4447139f1358dd8e9be68edf6fa46cbefbd1de423a4d6c439ca61d2c8eccf",
    "public/landing-pages/inner-green-assets/card-ecostove.jpg":
      "70ce084084902bc502f00c366405b661ecdff90dee95d363b36a6e146829e433",
    "public/landing-pages/inner-green-assets/card-ethos.jpg":
      "337627390f499b3ae272cec9e2f83c817694a82f42e1aa10a7b26a2c7d679dff",
    "public/landing-pages/inner-green-assets/lexend-latin.woff2":
      "1ec8f6ee2750554b4bc59ff0b507d316a82a7ba37e0e5bebc41d3bd9b9faad46",
  };

  it("verifies all registered source files and binary assets exist with exact SHA-256 hashes", () => {
    for (const [relativePath, expectedSha] of Object.entries(expectedHashes)) {
      const fullPath = resolve(root, relativePath);
      expect(existsSync(fullPath), `File should exist: ${relativePath}`).toBe(true);
      const buffer = readFileSync(fullPath);
      const hash = createHash("sha256").update(buffer).digest("hex");
      expect(hash, `Hash match for ${relativePath}`).toBe(expectedSha);
    }
  });

  it("renders Scene component containing SylvaHero inside shader-frame wrapper", () => {
    const { container } = render(<Scene />);
    const frame = container.querySelector(".shader-frame");
    expect(frame).not.toBeNull();

    const iframe = frame?.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("/landing-pages/inner-green-3d.html");
    expect(iframe?.getAttribute("title")).toBe("Sylva — Into the living world");
  });
});
