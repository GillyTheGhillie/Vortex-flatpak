import { describe, expect, it } from "vitest";

import { installDataFiles, testDataFiles } from "./installers";

describe("Morrowind Data Files installer", () => {
  it("recognizes plugin files below a wrapped Data Files directory", async () => {
    await expect(
      testDataFiles(
        ["ReallyUsefulCliffracers/Data Files/ReallyUsefulCliffracers.ESP"],
        "morrowind",
      ),
    ).resolves.toEqual({ supported: true, requiredFiles: [] });
  });

  it("does not override scripted installers", async () => {
    await expect(
      testDataFiles(
        ["ReallyUsefulCliffracers/Data Files/ReallyUsefulCliffracers.ESP"],
        "morrowind",
        undefined,
        { hasXmlConfigXML: true },
      ),
    ).resolves.toEqual({ supported: false, requiredFiles: [] });
  });

  it("strips all archive wrapper directories through Data Files", async () => {
    await expect(
      installDataFiles([
        "ReallyUsefulCliffracers/Data Files/ReallyUsefulCliffracers.ESP",
        "ReallyUsefulCliffracers/Data Files/Meshes/r/Thomas.nif",
        "readme.txt",
      ]),
    ).resolves.toEqual({
      instructions: [
        {
          type: "copy",
          source: "ReallyUsefulCliffracers/Data Files/ReallyUsefulCliffracers.ESP",
          destination: "ReallyUsefulCliffracers.ESP",
        },
        {
          type: "copy",
          source: "ReallyUsefulCliffracers/Data Files/Meshes/r/Thomas.nif",
          destination: "Meshes/r/Thomas.nif",
        },
      ],
    });
  });

  it("accepts Windows archive separators", async () => {
    await expect(
      installDataFiles(["ReallyUsefulCliffracers\\Data Files\\ReallyUsefulCliffracers.ESP"]),
    ).resolves.toEqual({
      instructions: [
        {
          type: "copy",
          source: "ReallyUsefulCliffracers\\Data Files\\ReallyUsefulCliffracers.ESP",
          destination: "ReallyUsefulCliffracers.ESP",
        },
      ],
    });
  });
});
