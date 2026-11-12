const path = require("path");
const { fs, selectors, util } = require("@nexusmods/vortex-api");

const { MORROWIND_ID } = require("./constants");

function splitIniLines(contents) {
  const lines = [];
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

function lineContent(line) {
  return line.replace(/(?:\r\n|\n|\r)$/, "").replace(/^\uFEFF/, "");
}

function sectionHeader(line) {
  return /^\s*\[([^\]]+)\]\s*$/.exec(lineContent(line));
}

function gameFilesFromContents(contents) {
  const files = {};
  let inGameFiles = false;
  for (const line of splitIniLines(contents)) {
    const header = sectionHeader(line);
    if (header !== null) {
      inGameFiles = header[1].trim().toLowerCase() === "game files";
    } else if (inGameFiles) {
      const equals = lineContent(line).indexOf("=");
      if (equals !== -1) {
        files[lineContent(line).slice(0, equals).trim()] = lineContent(line)
          .slice(equals + 1)
          .trim();
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

function withGameFiles(contents, plugins) {
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
  const firstGameFile = sectionLines.findIndex((line) =>
    /^\s*GameFile\d+\s*=/i.test(lineContent(line)),
  );
  const insertionPoint =
    firstGameFile === -1
      ? sectionLines.length
      : sectionLines
          .slice(0, firstGameFile)
          .filter((line) => !/^\s*GameFile\d+\s*=/i.test(lineContent(line))).length;
  const retained = sectionLines.filter(
    (line) => !/^\s*GameFile\d+\s*=/i.test(lineContent(line)),
  );
  const sectionNewline =
    firstGameFile !== -1
      ? sectionLines[firstGameFile].match(/(?:\r\n|\n|\r)$/)?.[0] || newline
      : lines[sectionStart].match(/(?:\r\n|\n|\r)$/)?.[0] || newline;
  if (
    plugins.length > 0 &&
    !/(?:\r\n|\n|\r)$/.test(lines[sectionStart])
  ) {
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

async function deserializeLoadOrder(api, mods = undefined) {
  const state = api.getState();
  const discovery = selectors.discoveryByGame(state, MORROWIND_ID);
  if (discovery?.path === undefined) {
    return Promise.resolve([]);
  }
  if (mods === undefined) {
    mods = util.getSafe(state, ["persistent", "mods", MORROWIND_ID], {});
  }
  const fileMap = Object.keys(mods).reduce((accum, iter) => {
    const plugins = mods[iter]?.attributes?.plugins;
    if (mods[iter]?.attributes?.plugins !== undefined) {
      for (const plugin of plugins) {
        accum[plugin] = iter;
      }
    }
    return accum;
  }, {});

  const iniFilePath = path.join(discovery.path, "Morrowind.ini");
  const gameFiles = await refreshPlugins(api);
  const enabled = await readGameFiles(iniFilePath);
  return gameFiles
    .sort((lhs, rhs) => lhs.mtime - rhs.mtime)
    .map((file) => ({
      id: file.name,
      enabled: enabled.includes(file.name),
      name: file.name,
      modId: fileMap[file.name],
    }));
}

async function refreshPlugins(api) {
  const state = api.getState();
  const discovery = selectors.discoveryByGame(state, MORROWIND_ID);
  if (discovery?.path === undefined) {
    return Promise.resolve([]);
  }

  const dataDirectory = path.join(discovery.path, "Data Files");
  let fileEntries = [];
  try {
    fileEntries = await fs.readdirAsync(dataDirectory);
  } catch (err) {
    // No data directory - no problem!
    return Promise.resolve([]);
  }
  const pluginEntries = [];
  for (const fileName of fileEntries) {
    if (![".esp", ".esm"].includes(path.extname(fileName.toLocaleLowerCase()))) {
      continue;
    }
    let stats;
    try {
      stats = await fs.statAsync(path.join(dataDirectory, fileName));
      pluginEntries.push({ name: fileName, mtime: stats.mtime });
    } catch (err) {
      if (err.code === "ENOENT") {
        // Probably a deployment event.
        continue;
      } else {
        return Promise.reject(err);
      }
    }
  }

  return Promise.resolve(pluginEntries);
}

async function readGameFiles(iniFilePath) {
  const contents = await fs.readFileAsync(iniFilePath, { encoding: "utf8" });
  return gameFilesFromContents(contents);
}

async function updatePluginOrder(iniFilePath, plugins) {
  const contents = await fs.readFileAsync(iniFilePath, { encoding: "utf8" });
  await fs.writeFileAsync(iniFilePath, withGameFiles(contents, plugins), {
    encoding: "utf8",
  });
}

async function updatePluginTimestamps(dataPath, plugins) {
  const offset = 946684800;
  const oneDay = 24 * 60 * 60;
  return Promise.mapSeries(plugins, (fileName, idx) => {
    const mtime = offset + oneDay * idx;
    return fs
      .utimesAsync(path.join(dataPath, fileName), mtime, mtime)
      .catch((err) => (err.code === "ENOENT" ? Promise.resolve() : Promise.reject(err)));
  });
}

async function serializeLoadOrder(api, order) {
  const state = api.getState();
  const discovery = selectors.discoveryByGame(state, MORROWIND_ID);
  if (discovery?.path === undefined) {
    return Promise.reject(new util.ProcessCanceled("Game is not discovered"));
  }

  const iniFilePath = path.join(discovery.path, "Morrowind.ini");
  const dataDirectory = path.join(discovery.path, "Data Files");
  const enabled = order.filter((loEntry) => loEntry.enabled === true).map((loEntry) => loEntry.id);
  try {
    await updatePluginOrder(iniFilePath, enabled);
    await updatePluginTimestamps(
      dataDirectory,
      order.map((loEntry) => loEntry.id),
    );
  } catch (err) {
    const allowReport = !(err instanceof util.UserCanceled);
    api.showErrorNotification("Failed to save", err, { allowReport });
    return Promise.reject(err);
  }
  return Promise.resolve();
}

module.exports = {
  deserializeLoadOrder,
  serializeLoadOrder,
  readGameFiles,
};
