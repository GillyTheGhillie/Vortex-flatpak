import { beforeEach, describe, expect, it, vi } from "vitest";

import { install, stripToInstallRoot } from "./basicInstaller";

const games = vi.hoisted(() => ({
  morrowind: { details: { installRootFolder: "Data Files" } },
  other: { details: {} },
}));

vi.mock("../../gamemode_management/util/getGame", () => ({
  getGame: (gameId: string) => games[gameId as keyof typeof games],
}));

describe("stripToInstallRoot", () => {
  it("drops the wrapper folders above the install root", () => {
    expect(
      stripToInstallRoot(
        "ReallyUsefulCliffracers/Data Files/ReallyUsefulCliffracers.ESP",
        "Data Files",
      ),
    ).toBe("ReallyUsefulCliffracers.ESP");
  });

  it("keeps the nested structure below the install root", () => {
    expect(stripToInstallRoot("Mod/Data Files/Meshes/r/Thomas.nif", "Data Files")).toBe(
      "Meshes/r/Thomas.nif",
    );
  });

  it("matches the folder name case-insensitively", () => {
    expect(stripToInstallRoot("Mod/data files/Sound/x.wav", "Data Files")).toBe("Sound/x.wav");
  });

  it("accepts Windows separators", () => {
    expect(stripToInstallRoot("Mod\\Data Files\\x.esp", "Data Files")).toBe("x.esp");
  });

  it("returns paths without the folder unchanged", () => {
    expect(stripToInstallRoot("readme.txt", "Data Files")).toBe("readme.txt");
    expect(stripToInstallRoot("Mod/Textures/x.dds", "Data Files")).toBe("Mod/Textures/x.dds");
  });

  it("does not strip when the folder is the file name itself", () => {
    expect(stripToInstallRoot("Mod/Data Files", "Data Files")).toBe("Mod/Data Files");
  });
});

describe("basicInstaller.install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs relative to the game's install root when the game opts in", async () => {
    const result = await install(
      ["Mod/Data Files/ReallyUsefulCliffracers.ESP", "Mod/Data Files/Meshes/r/Thomas.nif"],
      "/staging",
      "morrowind",
      () => undefined,
    );
    expect(result.instructions).toEqual([
      {
        type: "copy",
        source: "Mod/Data Files/ReallyUsefulCliffracers.ESP",
        destination: "ReallyUsefulCliffracers.ESP",
      },
      {
        type: "copy",
        source: "Mod/Data Files/Meshes/r/Thomas.nif",
        destination: "Meshes/r/Thomas.nif",
      },
    ]);
  });

  it("keeps archive paths as they are for games that do not opt in", async () => {
    const result = await install(["Mod/Data Files/x.esp"], "/staging", "other", () => undefined);
    expect(result.instructions).toEqual([
      { type: "copy", source: "Mod/Data Files/x.esp", destination: "Mod/Data Files/x.esp" },
    ]);
  });
});
