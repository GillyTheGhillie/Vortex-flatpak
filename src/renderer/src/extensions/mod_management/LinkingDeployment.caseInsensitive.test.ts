import * as nodeFs from "node:fs";
import * as path from "node:path";

import { expect } from "vitest";

import { makeDeployedFile } from "../../test-utils/builders";
import {
  type IDeploymentHarness,
  type IDeploymentOptions,
  test,
} from "../../test-utils/deploymentTest";

// Windows file systems fold case themselves; these cover case-sensitive ones
const caseSensitiveTest = test.skipIf(process.platform === "win32");

const listGameDir = (dir: string) =>
  nodeFs
    .readdirSync(dir)
    .filter((name) => !name.includes("folder_managed_by_vortex"))
    .sort();

caseSensitiveTest(
  "deploys case variants of a folder from different mods into one folder",
  async ({ makeDeployment }) => {
    const h = makeDeployment({
      files: { "textures/two.dds": "two" },
      otherMods: { Other: { "Textures/one.dds": "one" } },
    });

    const first = await h.deployMod("Other");
    const second = await h.deploy(first);

    expect(listGameDir(h.gameDir)).toEqual(["Textures"]);
    expect(listGameDir(path.join(h.gameDir, "Textures"))).toEqual(["one.dds", "two.dds"]);
    expect(second.find((file) => file.source === "SomeMod")?.deployedRelPath).toBe(
      path.join("Textures", "two.dds"),
    );
  },
);

caseSensitiveTest(
  "removes a file from the folder it was deployed into, not the mod's spelling",
  async ({ makeDeployment }) => {
    const h = makeDeployment({
      files: { "textures/two.dds": "two" },
      otherMods: { Other: { "Textures/one.dds": "one" } },
    });
    const deployed = await h.deploy(await h.deployMod("Other"));

    await h.remove(deployed);

    expect(listGameDir(path.join(h.gameDir, "Textures"))).toEqual(["one.dds"]);
  },
);

caseSensitiveTest(
  "lets the later mod replace a file another mod ships with different case",
  async ({ makeDeployment }) => {
    const h = makeDeployment({
      files: { "Textures/a.dds": "first" },
      otherMods: { Other: { "textures/A.dds": "second" } },
    });

    const deployed = await h.deployMod("Other", await h.deploy());

    expect(listGameDir(h.gameDir)).toEqual(["Textures"]);
    expect(nodeFs.readFileSync(path.join(h.gameDir, "Textures", "a.dds"), "utf8")).toBe("second");
    expect(deployed.map((file) => file.source)).toEqual(["Other"]);
  },
);

caseSensitiveTest(
  "backs up a game file a moved mod file now lands on, and restores it",
  async ({ makeDeployment }) => {
    const h = makeDeployment({ files: { "textures/a.dds": "mod" } });
    nodeFs.mkdirSync(path.join(h.gameDir, "Textures"));
    nodeFs.writeFileSync(path.join(h.gameDir, "Textures", "a.dds"), "game");
    nodeFs.mkdirSync(path.join(h.gameDir, "textures"));
    nodeFs.linkSync(
      path.join(h.modDir("SomeMod"), "textures", "a.dds"),
      path.join(h.gameDir, "textures", "a.dds"),
    );

    const deployed = await h.deploy(h.manifest());

    const gameFile = path.join(h.gameDir, "Textures", "a.dds");
    expect(nodeFs.readFileSync(gameFile, "utf8")).toBe("mod");
    expect(nodeFs.readFileSync(gameFile + ".vortex_backup", "utf8")).toBe("game");

    await h.remove(deployed);

    expect(nodeFs.readFileSync(gameFile, "utf8")).toBe("game");
  },
);

/**
 * A deployment made before paths were folded: textures/ holds Other's files next to
 * Textures/, with the given ones recorded in the manifest.
 */
async function makeLegacyDeployment(
  makeDeployment: (options: IDeploymentOptions) => IDeploymentHarness,
  otherFiles: Record<string, string>,
) {
  const h = makeDeployment({
    files: { "Textures/a.dds": "first" },
    otherMods: { Other: otherFiles },
  });
  const first = await h.deploy();
  const legacyDir = path.join(h.gameDir, "textures");
  nodeFs.mkdirSync(legacyDir);
  nodeFs.writeFileSync(path.join(legacyDir, ".__folder_managed_by_vortex"), "");
  const legacy = [...first];
  for (const relPath of Object.keys(otherFiles)) {
    nodeFs.linkSync(path.join(h.modDir("Other"), relPath), path.join(h.gameDir, relPath));
    legacy.push(makeDeployedFile({ relPath, source: "Other" }));
  }
  return { h, legacy };
}

caseSensitiveTest(
  "removes a case variant an earlier deployment left next to the winning file",
  async ({ makeDeployment }) => {
    const { h, legacy } = await makeLegacyDeployment(makeDeployment, {
      "textures/A.dds": "second",
    });

    await h.deployAll(["SomeMod", "Other"], legacy);

    expect(listGameDir(h.gameDir)).toEqual(["Textures"]);
    expect(nodeFs.readFileSync(path.join(h.gameDir, "Textures", "a.dds"), "utf8")).toBe("second");
  },
);

caseSensitiveTest(
  "moves files out of a case variant folder an earlier deployment created, and removes it",
  async ({ makeDeployment }) => {
    const { h, legacy } = await makeLegacyDeployment(makeDeployment, {
      "textures/two.dds": "two",
    });

    await h.deployMod("Other", legacy);

    expect(listGameDir(h.gameDir)).toEqual(["Textures"]);
    expect(listGameDir(path.join(h.gameDir, "Textures"))).toEqual(["a.dds", "two.dds"]);
  },
);
