import path from "path";

import type { types } from "@nexusmods/vortex-api";

import { MORROWIND_ID } from "./constants";

function dataFilesRelativePath(file: string): string | undefined {
  const segments = file.split(/[\\/]/);
  const dataFilesIndex = segments.findIndex((segment) => segment.toLowerCase() === "data files");
  if (dataFilesIndex === -1 || dataFilesIndex === segments.length - 1) {
    return undefined;
  }
  return path.join(...segments.slice(dataFilesIndex + 1));
}

export const testDataFiles: types.TestSupported = (files, gameId, _archivePath, details) => {
  const supported =
    gameId === MORROWIND_ID &&
    details?.hasXmlConfigXML !== true &&
    files.some((file) => {
      const relativePath = dataFilesRelativePath(file);
      return (
        relativePath !== undefined &&
        [".esp", ".esm"].includes(path.extname(relativePath).toLowerCase())
      );
    });

  return Promise.resolve({ supported, requiredFiles: [] });
};

export const installDataFiles: types.InstallFunc = (files) =>
  Promise.resolve({
    instructions: files.flatMap((file) => {
      const destination = dataFilesRelativePath(file);
      return destination === undefined
        ? []
        : [{ type: "copy" as const, source: file, destination }];
    }),
  });
