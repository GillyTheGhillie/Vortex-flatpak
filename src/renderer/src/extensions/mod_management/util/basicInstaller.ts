import * as path from "path";

import { getGame } from "../../gamemode_management/util/getGame";
import type { ProgressDelegate } from "../types/InstallFunc";
import type { ISupportedResult } from "../types/TestSupported";

// The game folder a mod installs into (e.g. "Data Files"), if the game opts in through
// `details.installRootFolder`. Without it archives are installed exactly as they are.
function installRootFolder(gameId: string): string | undefined {
  try {
    const folder = getGame(gameId)?.details?.installRootFolder;
    return typeof folder === "string" && folder !== "" ? folder : undefined;
  } catch {
    return undefined;
  }
}

// Drops every folder above `folder`, so "Mod Name/Data Files/Meshes/x.nif" installs as
// "Meshes/x.nif". Paths without that folder are returned unchanged.
export function stripToInstallRoot(file: string, folder: string): string {
  const segments = file.split(/[\\/]/);
  const idx = segments.findIndex((segment) => segment.toLowerCase() === folder.toLowerCase());
  if (idx === -1 || idx === segments.length - 1) {
    return file;
  }
  const sep = file.match(/[\\/]/)?.[0] ?? path.sep;
  return segments.slice(idx + 1).join(sep);
}

export function testSupported(files: string[]): Promise<ISupportedResult> {
  const result: ISupportedResult = { supported: true, requiredFiles: [] };
  return Promise.resolve(result);
}

export function install(
  files: string[],
  destinationPath: string,
  gameId: string,
  progress: ProgressDelegate,
): Promise<any> {
  const root = installRootFolder(gameId);
  return Promise.resolve({
    message: "Success",
    instructions: files
      .filter((name: string) => !name.endsWith(path.sep))
      .map((name: string) => ({
        type: "copy",
        source: name,
        destination: root === undefined ? name : stripToInstallRoot(name, root),
      })),
  });
}
