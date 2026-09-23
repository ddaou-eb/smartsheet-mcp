// Generates plain solid-color placeholder icons (no image library needed) so the
// plugin package has valid color.png / outline.png before Daniel swaps in real art.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function solidColorPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor (RGB)
  // bytes 10-12 (compression, filter, interlace) already zero

  const rowLength = 1 + size * 3
  const raw = Buffer.alloc(rowLength * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLength
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const NAVY = [14, 23, 45] // #0E172D

writeFileSync(new URL('../color.png', import.meta.url), solidColorPng(192, NAVY))
writeFileSync(new URL('../outline.png', import.meta.url), solidColorPng(32, NAVY))
console.log('Wrote color.png (192x192) and outline.png (32x32) placeholder icons. Replace with real art before wider distribution.')
