import * as path from "path";

import { fs, log, selectors, types, util } from "@nexusmods/vortex-api";
import Promise from "bluebird";

import PluginList from "./PluginList";

let watcher: fs.FSWatcher;
let refresher: util.Debouncer;

const reactive = util.makeReactive({
  knownPlugins: [],
  pluginOrder: [],
});

function onFileChanged(event: string, fileName: string) {
  if (event === "rename") {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".esm" || ext === ".esp") {
      refresher.schedule();
    }
  }
}

function startWatch(state: types.IState) {
  const discovery = state.settings.gameMode.discovered["morrowind"];
  if (discovery === undefined || discovery.path === undefined) {
    // this shouldn't happen because startWatch is only called if the
    // game is activated and it has to be discovered for that
    throw new Error("Morrowind wasn't discovered");
  }
  watcher = fs
    .watch(path.join(discovery.path, "Data Files"), {}, onFileChanged)
    .on("error", (err) => {
      log("error", "failed to watch morrowind mod directory for changes", {
        message: err.message,
      });
    });
}

function stopWatch() {
  if (watcher !== undefined) {
    watcher.close();
    watcher = undefined;
  }
}

function splitIniLines(contents: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < contents.length) {
    let end = start;
    while (end < contents.length && contents[end] !== "\r" && contents[end] !== "\n") {
      end += 1;
    }
    if (end < contents.length) {
      end += contents[end] === "\r" && contents[end + 1] === "\n" ? 2 : 1;
    }
    lines.push(contents.slice(start, end));
    start = end;
  }
  return lines;
}

function lineContent(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "").replace(/^\uFEFF/, "");
}

function sectionHeader(line: string): RegExpExecArray | null {
  return /^\s*\[([^\]]+)\]\s*$/.exec(lineContent(line));
}

function gameFilesFromContents(contents: string): string[] {
  const files: Record<string, string> = {};
  let inGameFiles = false;
  for (const line of splitIniLines(contents)) {
    const header = sectionHeader(line);
    if (header !== null) {
      inGameFiles = header[1].trim().toLowerCase() === "game files";
    } else if (inGameFiles) {
      const currentLine = lineContent(line);
      const equals = currentLine.indexOf("=");
      if (equals !== -1) {
        files[currentLine.slice(0, equals).trim()] = currentLine.slice(equals + 1).trim();
      }
    }
  }
  return Object.keys(files)
    .filter((key) => /^GameFile\d+$/i.test(key))
    .sort(
      (lhs, rhs) =>
        Number.parseInt(lhs.replace(/^GameFile/i, ""), 10) -
        Number.parseInt(rhs.replace(/^GameFile/i, ""), 10),
    )
    .map((key) => files[key]);
}

function withGameFiles(contents: string, plugins: string[]): string {
  const lines = splitIniLines(contents);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const header = sectionHeader(lines[idx]);
    if (header === null) {
      continue;
    }
    if (sectionStart !== -1) {
      sectionEnd = idx;
      break;
    }
    if (header[1].trim().toLowerCase() === "game files") {
      sectionStart = idx;
    }
  }

  const newline = (contents.match(/\r\n|\n|\r/) || ["\r\n"])[0];
  if (sectionStart === -1) {
    const separator = contents.length === 0 || /(?:\r\n|\n|\r)$/.test(contents) ? "" : newline;
    return (
      contents +
      separator +
      `[Game Files]${newline}` +
      plugins.map((plugin, idx) => `GameFile${idx}=${plugin}${newline}`).join("")
    );
  }

  const sectionLines = lines.slice(sectionStart + 1, sectionEnd);
  const isGameFile = (line: string) => /^\s*GameFile\d+\s*=/i.test(lineContent(line));
  const firstGameFile = sectionLines.findIndex(isGameFile);
  const insertionPoint =
    firstGameFile === -1
      ? sectionLines.length
      : sectionLines.slice(0, firstGameFile).filter((line) => !isGameFile(line)).length;
  const retained = sectionLines.filter((line) => !isGameFile(line));
  const sectionNewline =
    firstGameFile !== -1
      ? sectionLines[firstGameFile].match(/(?:\r\n|\n|\r)$/)?.[0] || newline
      : lines[sectionStart].match(/(?:\r\n|\n|\r)$/)?.[0] || newline;
  if (plugins.length > 0 && !/(?:\r\n|\n|\r)$/.test(lines[sectionStart])) {
    lines[sectionStart] += sectionNewline;
  }
  retained.splice(
    insertionPoint,
    0,
    ...plugins.map((plugin, idx) => `GameFile${idx}=${plugin}${sectionNewline}`),
  );
  lines.splice(sectionStart + 1, sectionEnd - sectionStart - 1, ...retained);
  return lines.join("");
}

async function readGameFiles(iniFilePath: string): Promise<string[]> {
  const contents = await fs.readFileAsync(iniFilePath, { encoding: "utf8" });
  return gameFilesFromContents(contents);
}

async function updatePluginOrder(iniFilePath: string, plugins: string[]): Promise<void> {
  const contents = await fs.readFileAsync(iniFilePath, { encoding: "utf8" });
  await fs.writeFileAsync(iniFilePath, withGameFiles(contents, plugins), { encoding: "utf8" });
}

function updatePluginTimestamps(dataPath: string, plugins: string[]): Promise<void> {
  const offset = 946684800;
  const oneDay = 24 * 60 * 60;
  return Promise.mapSeries(plugins, (fileName, idx) => {
    const mtime = offset + oneDay * idx;
    return fs
      .utimesAsync(path.join(dataPath, fileName), mtime, mtime)
      .catch((err) => (err.code === "ENOENT" ? Promise.resolve() : Promise.reject(err)));
  }).then(() => undefined);
}

function refreshPlugins(api: types.IExtensionApi): Promise<void> {
  const state = api.store.getState();
  const discovery = state.settings.gameMode.discovered["morrowind"];
  if (discovery === undefined || discovery.path === undefined) {
    return Promise.resolve();
  }

  return fs
    .readdirAsync(path.join(discovery.path, "Data Files"))
    .filter(
      (fileName: string) => [".esp", ".esm"].indexOf(path.extname(fileName).toLowerCase()) !== -1,
    )
    .then((plugins) =>
      readGameFiles(path.join(discovery.path, "Morrowind.ini")).then((gameFiles) => ({
        plugins,
        gameFiles,
      })),
    )
    .then((result) => {
      reactive.knownPlugins = result.plugins;
      reactive.pluginOrder = result.gameFiles;
    });
}

function init(context: types.IExtensionContext) {
  context.registerMainPage("plugins", "Plugins", PluginList, {
    id: "morrowind-plugins",
    priority: 30,
    hotkey: "E",
    group: "per-game",
    visible: () => selectors.activeGameId(context.api.store.getState()) === "morrowind",
    props: () => ({
      localState: reactive,
      onSetPluginOrder: (plugins: string[]) => {
        const state = context.api.store.getState();
        reactive.pluginOrder = plugins;
        const discovery = state.settings.gameMode.discovered["morrowind"];
        const iniFilePath = path.join(discovery.path, "Morrowind.ini");
        updatePluginOrder(iniFilePath, plugins)
          .then(() => updatePluginTimestamps(path.join(discovery.path, "Data Files"), plugins))
          .catch((err) => {
            context.api.showErrorNotification("Failed to update morrowind.ini", err, {
              allowReport: false,
            });
          });
      },
    }),
  });

  context.once(() => {
    context.api.events.on("gamemode-activated", (gameMode: string) => {
      if (gameMode === "morrowind") {
        startWatch(context.api.store.getState());
      } else {
        stopWatch();
      }
    });

    context.api.setStylesheet(
      "morrowind-plugin-management",
      path.join(__dirname, "stylesheet.scss"),
    );

    refresher = new util.Debouncer(() => refreshPlugins(context.api), 2000);
    refresher.schedule();
  });
}

export default init;
