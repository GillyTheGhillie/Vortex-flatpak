#!/usr/bin/env node
// The FOMOD native addon is linked with the absolute directory it was compiled in as its
// RPATH. That directory only exists in the build sandbox, so once Vortex is installed the
// loader can't find ModInstaller.Native.so beside the addon, and FOMOD installers fail.
//
// Point the RPATH at $ORIGIN (the addon's own directory) instead. The new string is written
// over the old one with NUL padding, so no offsets in the file change. Anything other than
// exactly one matching RPATH stops the build rather than guessing.
const fs = require('node:fs');

const addonPath = process.argv[2];
if (addonPath === undefined) {
  throw new Error('usage: _flatpak_fomod_rpath.cjs <path to modinstaller.node>');
}


// Reads the RPATH from the ELF dynamic section (DT_RPATH, tag 15), following the string table.
function readRpath(elf) {
  if (elf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  if (elf[4] !== 2) throw new Error('only 64-bit ELF is supported');
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const shentsize = elf.readUInt16LE(0x3a);
  const shnum = elf.readUInt16LE(0x3c);
  const section = (i) => {
    const base = shoff + i * shentsize;
    return {
      type: elf.readUInt32LE(base + 4),
      offset: Number(elf.readBigUInt64LE(base + 0x18)),
      size: Number(elf.readBigUInt64LE(base + 0x20)),
      link: elf.readUInt32LE(base + 0x28),
    };
  };
  const SHT_DYNAMIC = 6;
  for (let i = 0; i < shnum; i++) {
    const dyn = section(i);
    if (dyn.type !== SHT_DYNAMIC) continue;
    const strtab = section(dyn.link);
    for (let off = dyn.offset; off < dyn.offset + dyn.size; off += 16) {
      const tag = Number(elf.readBigInt64LE(off));
      if (tag === 15) {
        const value = Number(elf.readBigUInt64LE(off + 8));
        const start = strtab.offset + value;
        return elf.subarray(start, elf.indexOf(0, start)).toString('latin1');
      }
    }
  }
  return undefined;
}

const ORIGIN = '$ORIGIN';
const buf = fs.readFileSync(addonPath);
const text = buf.toString('latin1');

if (text.includes(`\0${ORIGIN}\0`)) {
  console.log(`RPATH already ${ORIGIN} in ${addonPath}`);
  process.exit(0);
}

// Only the RPATH counts. The same build directory also appears in debug info, which is not
// read by the loader, so match the single RPATH the dynamic section names.
const rpath = readRpath(buf);
if (rpath === undefined) {
  throw new Error(`no RPATH found in ${addonPath}`);
}
const rpathOffset = buf.indexOf(Buffer.from(rpath + '\0', 'latin1'));
if (rpathOffset === -1) {
  throw new Error(`RPATH "${rpath}" not found in ${addonPath}`);
}
const match = { 0: rpath, index: rpathOffset };
if (!rpath.startsWith('/') || !rpath.endsWith('/node_modules/@nexusmods/fomod-installer-native')) {
  throw new Error(`RPATH "${rpath}" is not the FOMOD build directory; refusing to change it`);
}
if (match[0].length < ORIGIN.length) {
  throw new Error(`RPATH "${match[0]}" is shorter than ${ORIGIN}; cannot replace it in place`);
}

const replacement = Buffer.alloc(match[0].length);
Buffer.from(ORIGIN, 'latin1').copy(replacement);
replacement.copy(buf, match.index);
fs.writeFileSync(addonPath, buf);
console.log(`RPATH ${match[0]} -> ${ORIGIN} in ${addonPath}`);
