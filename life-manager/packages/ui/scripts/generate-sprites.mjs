import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii, dataBuf) {
  const typeBuf = Buffer.from(typeAscii, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

export function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Invalid RGBA buffer length: expected ${width * height * 4}, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth = 8
  ihdr[9] = 6; // color type = 6 (RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + stride);
    rawScanlines[rowOffset] = 0x00;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rawScanlines, rowOffset + 1);
  }

  const idatData = deflateSync(rawScanlines, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgba(hex, alpha = 255) {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return [r, g, b, alpha];
}

function createSurface(width, height) {
  const data = new Uint8Array(width * height * 4);
  const setPx = (x, y, color) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const idx = (iy * width + ix) * 4;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = color[3] ?? 255;
  };
  const fillRect = (x, y, w, h, color) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPx(x + dx, y + dy, color);
      }
    }
  };
  const strokeRect = (x, y, w, h, color) => {
    for (let dx = 0; dx < w; dx++) {
      setPx(x + dx, y, color);
      setPx(x + dx, y + h - 1, color);
    }
    for (let dy = 0; dy < h; dy++) {
      setPx(x, y + dy, color);
      setPx(x + w - 1, y + dy, color);
    }
  };
  const fillEllipse = (cx, cy, rx, ry, color) => {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx || 1) + (dy * dy) / (ry * ry || 1) <= 1.0) {
          setPx(cx + dx, cy + dy, color);
        }
      }
    }
  };
  return { width, height, data, setPx, fillRect, strokeRect, fillEllipse };
}

// ============================================================================
// 1. FRIEREN MINI (256x224, 32x32 frames, 8 cols x 7 rows)
// ============================================================================
function buildFrierenMini() {
  const W = 256;
  const H = 224;
  const s = createSurface(W, H);

  const C_OUTLINE = hexToRgba('#0B0D14');
  const C_HAIR_HI = hexToRgba('#EEF3FF');
  const C_HAIR_MID = hexToRgba('#C7D4EE');
  const C_HAIR_SH = hexToRgba('#8A9CC4');
  const C_SKIN = hexToRgba('#FFE7D6');
  const C_SKIN_SH = hexToRgba('#E6BEA8');
  const C_EYE = hexToRgba('#2CE5F2');
  const C_CAPE = hexToRgba('#F6F6F4');
  const C_CAPE_SH = hexToRgba('#D2D6E0');
  const C_GOLD = hexToRgba('#F59E0B');
  const C_RED = hexToRgba('#EB4511');
  const C_BOOT = hexToRgba('#1F2433');
  const C_STAFF = hexToRgba('#7C3F23');
  const C_BOOK = hexToRgba('#6B2D5C');
  const C_PAGE = hexToRgba('#FAF3DD');
  const C_FLORA = hexToRgba('#38BDF8');
  const C_MIMIC_WOOD = hexToRgba('#8B5A2B');
  const C_MIMIC_GOLD = hexToRgba('#D4AF37');

  function drawMiniBase(ox, oy, opts = {}) {
    const {
      bobY = 0,
      tailSway = 0,
      blink = false,
      bootAlt = 0,
      stride = 0,
      holdingBook = false,
      pageTurn = 0,
      casting = 0,
      sipping = 0,
      napping = 0,
      mimicStep = -1,
    } = opts;

    if (mimicStep >= 0) {
      // Row 6: Mimic gag! Chest on right (x=13..29, y=16..31), Frieren legs kicking on left (x=2..14)
      const chomp = mimicStep % 2;
      s.fillRect(ox + 13, oy + 17 + chomp, 16, 14 - chomp, C_MIMIC_WOOD);
      s.strokeRect(ox + 13, oy + 17 + chomp, 16, 14 - chomp, C_OUTLINE);
      s.fillRect(ox + 14, oy + 22, 14, 2, C_MIMIC_GOLD);
      // Mimic teeth
      for (let tx = 14; tx < 26; tx += 3) {
        s.setPx(ox + tx, oy + 21 + chomp, C_CAPE);
        s.setPx(ox + tx + 1, oy + 24, C_CAPE);
      }
      // Frieren skirt + twin-tails sticking out
      s.fillRect(ox + 9, oy + 21, 6, 6, C_CAPE);
      s.strokeRect(ox + 9, oy + 21, 6, 6, C_OUTLINE);
      s.fillRect(ox + 10, oy + 15 + chomp, 5, 4, C_HAIR_MID);
      // Kicking boots alternating
      const legA = mimicStep % 2 === 0 ? -2 : 2;
      const legB = -legA;
      s.fillRect(ox + 3, oy + 23 + legA, 6, 3, C_BOOT);
      s.fillRect(ox + 4, oy + 27 + legB, 6, 3, C_BOOT);
      // Distress '!' mark on odd frames
      if (mimicStep % 2 === 1) {
        s.fillRect(ox + 7, oy + 7, 2, 4, C_RED);
        s.fillRect(ox + 7, oy + 12, 2, 2, C_RED);
      }
      return;
    }

    if (napping > 0) {
      // Row 5: Cozy nap curled on ledge (y=18..31)
      const breath = napping === 2 || napping === 3 ? 1 : 0;
      s.fillRect(ox + 6, oy + 21 - breath, 18, 9 + breath, C_CAPE);
      s.strokeRect(ox + 6, oy + 21 - breath, 18, 9 + breath, C_OUTLINE);
      s.fillRect(ox + 8, oy + 17, 9, 7, C_SKIN);
      s.fillRect(ox + 7, oy + 15, 11, 4, C_HAIR_HI);
      s.fillRect(ox + 5, oy + 17, 4, 9, C_HAIR_MID);
      // Closed eye line
      s.fillRect(ox + 11, oy + 20, 3, 1, C_OUTLINE);
      // Boots tucked at right
      s.fillRect(ox + 22, oy + 27, 5, 4, C_BOOT);
      // Floating Zzz ascending
      const zy = oy + 13 - napping * 2;
      const zx = ox + 21 + napping;
      s.fillRect(zx, zy, 3, 1, C_HAIR_MID);
      s.setPx(zx + 1, zy + 1, C_HAIR_MID);
      s.fillRect(zx, zy + 2, 3, 1, C_HAIR_MID);
      return;
    }

    const hy = oy + 7 + bobY;
    // Twin-tails left & right
    s.fillRect(ox + 6 + tailSway, hy + 4, 4, 13, C_HAIR_MID);
    s.fillRect(ox + 7 + tailSway, hy + 4, 2, 11, C_HAIR_HI);
    s.strokeRect(ox + 6 + tailSway, hy + 4, 4, 13, C_OUTLINE);

    s.fillRect(ox + 21 + tailSway, hy + 4, 4, 13, C_HAIR_MID);
    s.fillRect(ox + 22 + tailSway, hy + 4, 2, 11, C_HAIR_HI);
    s.strokeRect(ox + 21 + tailSway, hy + 4, 4, 13, C_OUTLINE);

    // Ahoge on top
    s.fillRect(ox + 15 + tailSway, hy - 3, 3, 2, C_HAIR_HI);
    s.setPx(ox + 17 + tailSway, hy - 4, C_OUTLINE);

    // Head + Pointed Elf Ears
    s.fillRect(ox + 8, hy + 5, 2, 2, C_SKIN); // Left elf ear
    s.fillRect(ox + 21, hy + 5, 2, 2, C_SKIN); // Right elf ear
    s.fillRect(ox + 10, hy, 11, 10, C_SKIN);
    s.fillRect(ox + 10, hy + 8, 11, 2, C_SKIN_SH);
    // Hair crown & bangs
    s.fillRect(ox + 10, hy, 11, 4, C_HAIR_HI);
    s.fillRect(ox + 10, hy + 3, 3, 3, C_HAIR_MID);
    s.fillRect(ox + 18, hy + 3, 3, 3, C_HAIR_MID);
    s.strokeRect(ox + 9, hy - 1, 13, 11, C_OUTLINE);

    // Eyes
    if (blink || sipping >= 2) {
      s.fillRect(ox + 12, hy + 6, 2, 1, C_OUTLINE);
      s.fillRect(ox + 17, hy + 6, 2, 1, C_OUTLINE);
    } else {
      s.fillRect(ox + 12, hy + 5, 2, 2, C_EYE);
      s.fillRect(ox + 17, hy + 5, 2, 2, C_EYE);
      s.fillRect(ox + 12, hy + 4, 2, 1, C_OUTLINE);
      s.fillRect(ox + 17, hy + 4, 2, 1, C_OUTLINE);
    }

    // Torso / Mage Capelet
    const ty = hy + 10;
    s.fillRect(ox + 10, ty, 11, 9, C_CAPE);
    s.fillRect(ox + 10, ty + 6, 11, 3, C_CAPE_SH);
    s.fillRect(ox + 11, ty + 1, 9, 1, C_GOLD);
    s.fillRect(ox + 15, ty + 2, 2, 2, C_RED);
    s.strokeRect(ox + 9, ty, 13, 9, C_OUTLINE);

    // Boots flush with y=31 ledge
    const b1y = oy + 27 + (bootAlt > 0 ? -1 : 0);
    const b2y = oy + 27 + (bootAlt < 0 ? -1 : 0);
    s.fillRect(ox + 11 + stride, b1y, 4, 32 - (b1y - oy), C_BOOT);
    s.fillRect(ox + 16 - stride, b2y, 4, 32 - (b2y - oy), C_BOOT);

    if (stride !== 0) {
      // Diagonal staff in walk_ledge
      for (let k = 0; k < 14; k++) {
        s.setPx(ox + 7 + k, oy + 26 - k, C_STAFF);
      }
      s.fillRect(ox + 20, oy + 11, 3, 3, C_RED);
    }

    if (holdingBook) {
      s.fillRect(ox + 11, ty + 3, 9, 5, C_BOOK);
      s.fillRect(ox + 12, ty + 3, 7, 3, C_PAGE);
      if (pageTurn > 0) {
        s.fillRect(ox + 14 + pageTurn, ty + 1, 3, 2, C_PAGE);
        s.setPx(ox + 15 + pageTurn, ty - 1, C_EYE);
      }
    }

    if (casting > 0) {
      // Staff on right + sprouting blue flora
      s.fillRect(ox + 24, oy + 9, 2, 21, C_STAFF);
      s.fillRect(ox + 23, oy + 7, 4, 3, C_RED);
      const radius = Math.min(6, casting);
      s.strokeRect(ox + 24 - Math.floor(radius / 2), oy + 8 - Math.floor(radius / 2), radius + 2, radius + 2, C_EYE);
      const flowerCount = Math.min(3, Math.floor((casting + 1) / 2));
      for (let f = 0; f < flowerCount; f++) {
        const fx = ox + 3 + f * 7;
        const fy = oy + 28 - (casting % 2);
        s.fillRect(fx, fy, 3, 3, C_FLORA);
        s.setPx(fx + 1, fy + 1, C_CAPE);
      }
    }

    if (sipping > 0) {
      const cupLift = sipping >= 2 && sipping <= 4 ? -2 : 0;
      s.fillRect(ox + 14, ty + 2 + cupLift, 4, 3, C_CAPE);
      s.strokeRect(ox + 14, ty + 2 + cupLift, 4, 3, C_OUTLINE);
      // Rising steam pixels
      s.setPx(ox + 15 + (sipping % 2), ty - 1 - (sipping % 3), C_CAPE_SH);
      s.setPx(ox + 16, ty - 3 - (sipping % 2), C_CAPE);
    }
  }

  // Row 0: idle_ledge_sit (6 frames)
  for (let f = 0; f < 6; f++) {
    drawMiniBase(f * 32, 0 * 32, {
      bobY: f === 2 || f === 3 ? 1 : 0,
      tailSway: f === 2 || f === 3 ? 1 : f === 5 ? -1 : 0,
      blink: f === 4,
      bootAlt: f % 2 === 0 ? 1 : -1,
    });
  }
  // Row 1: walk_ledge (6 frames)
  for (let f = 0; f < 6; f++) {
    const strides = [-2, -1, 0, 2, 1, 0];
    drawMiniBase(f * 32, 1 * 32, {
      bobY: f % 3 === 1 ? -1 : 0,
      tailSway: f % 2 === 0 ? -1 : 1,
      stride: strides[f],
      bootAlt: f % 2 === 0 ? 1 : -1,
    });
  }
  // Row 2: read_grimoire (6 frames)
  for (let f = 0; f < 6; f++) {
    drawMiniBase(f * 32, 2 * 32, {
      bobY: f >= 2 && f <= 4 ? 1 : 0,
      holdingBook: true,
      pageTurn: f === 2 ? 1 : f === 3 ? 2 : f === 4 ? 3 : 0,
      blink: f === 3,
    });
  }
  // Row 3: cast_blue_flora (8 frames)
  for (let f = 0; f < 8; f++) {
    drawMiniBase(f * 32, 3 * 32, {
      bobY: f >= 2 && f <= 5 ? -1 : 0,
      tailSway: f >= 3 ? 1 : 0,
      casting: f + 1,
    });
  }
  // Row 4: sip_tea (6 frames)
  for (let f = 0; f < 6; f++) {
    drawMiniBase(f * 32, 4 * 32, {
      sipping: f + 1,
      tailSway: f === 3 ? 1 : 0,
    });
  }
  // Row 5: cozy_nap (4 frames)
  for (let f = 0; f < 4; f++) {
    drawMiniBase(f * 32, 5 * 32, {
      napping: f + 1,
    });
  }
  // Row 6: mimic_gag (8 frames)
  for (let f = 0; f < 8; f++) {
    drawMiniBase(f * 32, 6 * 32, {
      mimicStep: f,
    });
  }

  const descriptor = {
    meta: {
      app: 'hermes-os-sprite-v1',
      version: '1.0.0',
      image: 'frieren-mini.png',
      format: 'RGBA8888',
      size: { w: W, h: H },
      frameSize: { w: 32, h: 32 },
      scale: 2,
    },
    animations: {
      idle_ledge_sit: { row: 0, frames: 6, fps: 8, loop: true },
      walk_ledge: { row: 1, frames: 6, fps: 10, loop: true },
      read_grimoire: { row: 2, frames: 6, fps: 8, loop: true },
      cast_blue_flora: { row: 3, frames: 8, fps: 10, loop: false },
      sip_tea: { row: 4, frames: 6, fps: 8, loop: true },
      cozy_nap: { row: 5, frames: 4, fps: 6, loop: true },
      mimic_gag: { row: 6, frames: 8, fps: 10, loop: false },
    },
  };

  return { png: encodeRgbaPng(W, H, s.data), descriptor };
}

// ============================================================================
// 2. FRIEREN PORTRAIT (1536x160, 128x160 frames, 12 cols x 1 row — REF-14/14b)
// ============================================================================
function buildFrierenPortrait() {
  const FW = 128;
  const FH = 160;
  const FRAMES = 12;
  const W = FW * FRAMES;
  const H = FH;
  const s = createSurface(W, H);

  const SKY_0 = hexToRgba('#050814');
  const SKY_1 = hexToRgba('#091126');
  const SKY_2 = hexToRgba('#0E1A38');
  const SKY_3 = hexToRgba('#132347');
  const STAR_BRIGHT = hexToRgba('#DCE8FF');
  const STAR_MID = hexToRgba('#7FA6E8');
  const STAR_DIM = hexToRgba('#4A69A8');
  const GLINT_WHITE = hexToRgba('#F6F6F4');
  const GLINT_CYAN = hexToRgba('#2CE5F2');

  const OUT_DARK = hexToRgba('#070A14');
  const HAIR_HI = hexToRgba('#B8CFF8');
  const HAIR_MID = hexToRgba('#6D90D6');
  const HAIR_SH = hexToRgba('#314E96');
  const SKIN_LIT = hexToRgba('#8D99C4');
  const SKIN_SH = hexToRgba('#5A6694');
  const EYE_CYAN = hexToRgba('#2CE5F2');
  const EYE_ICE = hexToRgba('#67E8F9');
  const TUNIC_BG = hexToRgba('#090C18');
  const TUNIC_FOLD = hexToRgba('#161E38');
  const CREST_BLUE = hexToRgba('#5B7EC9');
  const CREST_HI = hexToRgba('#8CA4D6');
  const GRASS_DARK = hexToRgba('#04060E');

  // 4-phase motion tables across 12 frames (REF-14b keyframes 1..4)
  // Phase 1 (0..2): Calm half-lidded gaze
  // Phase 2 (3..5): Wind lifting twin-tails & ahoge bend
  // Phase 3 (6..8): Slow closed-eye blink + ~4deg head tilt
  // Phase 4 (9..11): Peak ~7deg head tilt & wind billow -> smooth return
  const WIND_OFFSETS = [0, 0, 1, 2, 4, 6, 7, 8, 9, 11, 10, 4];
  const AHOGE_DX = [0, 0, 0, 1, 2, 3, 3, 4, 4, 5, 4, 2];
  const HEAD_DX = [0, 0, 0, 0, 1, 1, 2, 2, 2, 3, 4, 1];
  const HEAD_DY = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 1];
  const EYE_STATE = [0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 1]; // 0=half-lidded, 1=75% closing, 2=closed blink
  const GRASS_SWAY = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 1];
  const GLINT_ARMS = [3, 3, 4, 4, 3, 2, 3, 4, 5, 4, 3, 3];

  function drawCrossGlint(cx, cy, armLen, color) {
    s.setPx(cx, cy, GLINT_WHITE);
    for (let d = 1; d <= armLen; d++) {
      const c = d === armLen ? STAR_MID : color;
      s.setPx(cx - d, cy, c);
      s.setPx(cx + d, cy, c);
      s.setPx(cx, cy - d, c);
      s.setPx(cx, cy + d, c);
    }
  }

  for (let f = 0; f < FRAMES; f++) {
    const ox = f * FW;
    const wind = WIND_OFFSETS[f];
    const ahogeDx = AHOGE_DX[f];
    const headDx = HEAD_DX[f];
    const headDy = HEAD_DY[f];
    const eyeMode = EYE_STATE[f];
    const grassDx = GRASS_SWAY[f];

    // 1. Nocturnal sky gradient with 2x2 ordered dithering at band transitions
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const dither = (x + y) % 2 === 0;
        let sky = SKY_3;
        if (y < 40 || (y < 46 && dither)) sky = SKY_0;
        else if (y < 86 || (y < 92 && dither)) sky = SKY_1;
        else if (y < 126 || (y < 132 && dither)) sky = SKY_2;
        s.setPx(ox + x, y, sky);
      }
    }

    // 2. Deterministic 48-star constellation
    for (let i = 0; i < 48; i++) {
      const sx = (i * 37 + 11) % 124 + 2;
      const sy = (i * 53 + 7) % 122 + 3;
      const twinkle = (i + f) % 5 === 0;
      const col = i % 3 === 0 ? STAR_BRIGHT : i % 3 === 1 ? STAR_MID : STAR_DIM;
      s.setPx(ox + sx, sy, twinkle ? STAR_BRIGHT : col);
    }

    // 3. Three animated '+' 4-point starlight glints (REF-14)
    drawCrossGlint(ox + 46, 17, GLINT_ARMS[f], GLINT_WHITE);
    drawCrossGlint(ox + 105, 32, GLINT_ARMS[(f + 4) % FRAMES], GLINT_CYAN);
    drawCrossGlint(ox + 20, 64, GLINT_ARMS[(f + 8) % FRAMES], STAR_BRIGHT);

    // 4. Twin-tails (left and right flowing plumes with S-curve wind displacement)
    for (let y = 34; y < 148; y++) {
      const t = (y - 34) / 114;
      const sCurve = Math.round(wind * Math.pow(t, 1.2) + Math.sin(t * Math.PI * 2 + f * 0.5) * 1.5);
      const leftCenter = 36 - Math.round(t * 8) - Math.floor(sCurve * 0.7);
      const rightCenter = 92 + Math.round(t * 10) + sCurve;
      const halfW = Math.max(4, Math.round(11 * (1 - t * 0.45)));

      for (let dx = -halfW; dx <= halfW; dx++) {
        const col =
          Math.abs(dx) === halfW
            ? OUT_DARK
            : dx < -halfW + 3
              ? HAIR_HI
              : dx > halfW - 3
                ? HAIR_SH
                : HAIR_MID;
        s.setPx(ox + leftCenter + dx, y, col);
        s.setPx(ox + rightCenter + dx, y, col);
      }
    }

    // 5. Waist-up torso & nocturnal tunic (y=88..159)
    for (let y = 88; y < FH; y++) {
      const spread = Math.round((y - 88) * 0.35);
      const leftX = 36 - spread;
      const rightX = 92 + spread;
      for (let x = leftX; x <= rightX; x++) {
        const isEdge = x === leftX || x === rightX;
        const isFold = Math.abs(x - 64) === 16 || Math.abs(x - 64) === 26;
        s.setPx(ox + x, y, isEdge ? OUT_DARK : isFold ? TUNIC_FOLD : TUNIC_BG);
      }
    }
    // Exposed moonlit neck & collarbones (y=76..95)
    s.fillRect(ox + 54 + Math.floor(headDx / 2), 76, 20, 16, SKIN_SH);
    s.fillRect(ox + 56 + Math.floor(headDx / 2), 78, 16, 10, SKIN_LIT);
    s.fillRect(ox + 48, 90, 32, 2, HAIR_HI); // Moonlit collarbone highlight

    // Circular silver-blue arcane crest on chest (center 64, 118, r=13)
    s.fillEllipse(ox + 64, 118, 13, 13, CREST_BLUE);
    s.fillEllipse(ox + 64, 118, 10, 10, TUNIC_BG);
    s.fillRect(ox + 63, 106, 3, 24, CREST_HI);
    s.fillRect(ox + 52, 117, 24, 3, CREST_HI);

    // 6. Head, pointed elf ears, bangs & ahoge (y=24..80) with scanline shear for head tilt
    const hcx = 64 + headDx;
    const hcy = 54 + headDy;

    // Pointed elf ears protruding laterally
    s.fillRect(ox + hcx - 29, hcy - 2, 8, 5, SKIN_LIT);
    s.strokeRect(ox + hcx - 29, hcy - 2, 8, 5, OUT_DARK);
    s.fillRect(ox + hcx + 21, hcy - 2 + Math.floor(headDx / 2), 8, 5, SKIN_LIT);
    s.strokeRect(ox + hcx + 21, hcy - 2 + Math.floor(headDx / 2), 8, 5, OUT_DARK);

    // Oval head
    s.fillEllipse(ox + hcx, hcy, 22, 25, OUT_DARK);
    s.fillEllipse(ox + hcx, hcy, 20, 23, SKIN_LIT);
    // Low-angle chin shadow
    s.fillRect(ox + hcx - 10, hcy + 15, 20, 5, SKIN_SH);

    // Hair dome & wind-swept bangs
    s.fillEllipse(ox + hcx, hcy - 10, 22, 14, HAIR_MID);
    s.fillEllipse(ox + hcx - 3, hcy - 13, 16, 9, HAIR_HI);
    for (let bx = -18; bx <= 18; bx += 4) {
      const bangShift = Math.round(wind * 0.25);
      s.fillRect(ox + hcx + bx + bangShift, hcy - 12, 3, 11, bx < 0 ? HAIR_HI : HAIR_MID);
    }

    // Curved top ahoge (y=15..28) bending with wind
    for (let ay = 0; ay < 12; ay++) {
      const ax = ox + hcx - 2 + Math.round((ay / 12) * ahogeDx) + Math.round(Math.sin(ay * 0.4) * 2);
      s.fillRect(ax, hcy - 25 - ay, 3, 2, HAIR_HI);
      s.setPx(ax - 1, hcy - 25 - ay, OUT_DARK);
    }

    // 7. Eyes (Phase 1 half-lidded -> Phase 2 closing -> Phase 3/4 closed blink)
    const leftEyeX = ox + hcx - 12;
    const rightEyeX = ox + hcx + 5;
    const eyeY = hcy + 1;
    if (eyeMode === 0) {
      // Half-lidded calm gaze
      s.fillRect(leftEyeX, eyeY, 7, 2, OUT_DARK);
      s.fillRect(leftEyeX + 1, eyeY + 2, 5, 4, EYE_CYAN);
      s.fillRect(leftEyeX + 2, eyeY + 3, 2, 2, EYE_ICE);

      s.fillRect(rightEyeX, eyeY + Math.floor(headDx / 3), 7, 2, OUT_DARK);
      s.fillRect(rightEyeX + 1, eyeY + 2 + Math.floor(headDx / 3), 5, 4, EYE_CYAN);
      s.fillRect(rightEyeX + 2, eyeY + 3 + Math.floor(headDx / 3), 2, 2, EYE_ICE);
    } else if (eyeMode === 1) {
      // 75% closing
      s.fillRect(leftEyeX, eyeY + 1, 7, 2, OUT_DARK);
      s.fillRect(leftEyeX + 2, eyeY + 3, 3, 2, EYE_CYAN);

      s.fillRect(rightEyeX, eyeY + 1 + Math.floor(headDx / 3), 7, 2, OUT_DARK);
      s.fillRect(rightEyeX + 2, eyeY + 3 + Math.floor(headDx / 3), 3, 2, EYE_CYAN);
    } else {
      // Serene closed-eye blink (curved lash line)
      s.fillRect(leftEyeX, eyeY + 3, 7, 2, OUT_DARK);
      s.setPx(leftEyeX - 1, eyeY + 2, OUT_DARK);
      s.setPx(leftEyeX + 7, eyeY + 2, OUT_DARK);

      const ry = eyeY + 3 + Math.floor(headDx / 3);
      s.fillRect(rightEyeX, ry, 7, 2, OUT_DARK);
      s.setPx(rightEyeX - 1, ry - 1, OUT_DARK);
      s.setPx(rightEyeX + 7, ry - 1, OUT_DARK);
    }

    // Calm neutral mouth
    s.fillRect(ox + hcx - 2, hcy + 12, 5, 1, OUT_DARK);

    // 8. Bottom foreground swaying grass blades (y=132..159)
    const bladePositions = [4, 10, 16, 22, 28, 34, 94, 100, 106, 112, 118, 123];
    for (const bx of bladePositions) {
      for (let gy = 0; gy < 26; gy++) {
        const bend = Math.round((gy / 26) * grassDx * 2);
        s.fillRect(ox + bx + bend, FH - 1 - gy, 2, 1, GRASS_DARK);
      }
    }
  }

  const descriptor = {
    meta: {
      app: 'hermes-os-sprite-v1',
      version: '1.0.0',
      image: 'frieren-portrait.png',
      format: 'RGBA8888',
      size: { w: W, h: H },
      frameSize: { w: FW, h: FH },
      scale: 2,
    },
    animations: {
      wind_blink_loop: { row: 0, startCol: 0, frames: 12, fps: 10, loop: true },
      calm_gaze: { row: 0, startCol: 0, frames: 3, fps: 6, loop: true },
    },
  };

  return { png: encodeRgbaPng(W, H, s.data), descriptor };
}

// ============================================================================
// 3. KNIGHTS ISOMETRIC (288x960, 48x48 frames, 6 cols x 20 rows — REF-13)
// ============================================================================
function buildKnightsIsometric() {
  const FW = 48;
  const FH = 48;
  const COLS = 6;
  const ROWS = 20;
  const W = FW * COLS;
  const H = FH * ROWS;
  const s = createSurface(W, H);

  const ARCHETYPES = [
    {
      name: 'paladin',
      armor: hexToRgba('#E2E8F0'),
      shade: hexToRgba('#94A3B8'),
      crest: hexToRgba('#F87C18'),
      weapon: hexToRgba('#F59E0B'),
    },
    {
      name: 'vanguard',
      armor: hexToRgba('#334155'),
      shade: hexToRgba('#1E293B'),
      crest: hexToRgba('#10B981'),
      weapon: hexToRgba('#F59E0B'),
    },
    {
      name: 'lore_warden',
      armor: hexToRgba('#4F46E5'),
      shade: hexToRgba('#312E81'),
      crest: hexToRgba('#F4F6C2'),
      weapon: hexToRgba('#2CE5F2'),
    },
    {
      name: 'inquisitor',
      armor: hexToRgba('#27272A'),
      shade: hexToRgba('#18181B'),
      crest: hexToRgba('#EB4511'),
      weapon: hexToRgba('#E4E6EB'),
    },
    {
      name: 'artificer',
      armor: hexToRgba('#D97706'),
      shade: hexToRgba('#92400E'),
      crest: hexToRgba('#2CE5F2'),
      weapon: hexToRgba('#A8F040'),
    },
  ];

  const STATES = [
    { key: 'idle', frames: 4, fps: 6, loop: true },
    { key: 'cast', frames: 6, fps: 10, loop: true },
    { key: 'alert', frames: 4, fps: 8, loop: true },
    { key: 'barracks_rest', frames: 4, fps: 4, loop: true },
  ];

  const C_OUTLINE = hexToRgba('#08080B');
  const C_SHADOW = hexToRgba('#08080B', 180);
  const C_WHITE = hexToRgba('#F6F6F4');
  const C_CYAN = hexToRgba('#2CE5F2');
  const C_ORANGE = hexToRgba('#F87C18');
  const C_RED = hexToRgba('#EB4511');
  const C_MUTED = hexToRgba('#8A909E');

  const animations = {};

  ARCHETYPES.forEach((arch, archIdx) => {
    STATES.forEach((st, stIdx) => {
      const row = archIdx * 4 + stIdx;
      animations[`${arch.name}_${st.key}`] = {
        row,
        frames: st.frames,
        fps: st.fps,
        loop: st.loop,
      };

      for (let f = 0; f < st.frames; f++) {
        const ox = f * FW;
        const oy = row * FH;

        // 2:1 Isometric base drop shadow ellipse at y=39..44
        s.fillEllipse(ox + 24, oy + 41, 13, 4, C_SHADOW);

        // Cast state: glowing isometric diamond rune under feet
        if (st.key === 'cast') {
          const runeColor = f % 2 === 0 ? C_CYAN : C_ORANGE;
          s.strokeRect(ox + 12, oy + 38, 24, 6, runeColor);
          // Rising mana motes
          s.fillRect(ox + 10 + f * 3, oy + 32 - f * 4, 2, 2, C_CYAN);
          s.fillRect(ox + 35 - f * 2, oy + 30 - f * 3, 2, 2, C_ORANGE);
        }

        const restDrop = st.key === 'barracks_rest' ? 3 : 0;
        const bob = st.key === 'idle' ? (f === 1 || f === 2 ? -1 : 0) : st.key === 'cast' ? -2 : 0;
        const by = oy + 14 + restDrop + bob;

        // Legs / Boots
        s.fillRect(ox + 18, oy + 33, 5, 8, C_OUTLINE);
        s.fillRect(ox + 25, oy + 33, 5, 8, C_OUTLINE);

        // Armored Torso + 1px #08080B outline
        s.fillRect(ox + 15, by + 8, 18, 13, arch.armor);
        s.fillRect(ox + 15, by + 16, 18, 5, arch.shade);
        s.fillRect(ox + 21, by + 10, 6, 9, arch.crest);
        s.strokeRect(ox + 14, by + 7, 20, 15, C_OUTLINE);

        // Helm + Archetype Silhouette
        s.fillRect(ox + 17, by, 14, 9, arch.armor);
        s.fillRect(ox + 19, by + 4, 10, 2, arch.crest); // Visor / Goggles
        s.strokeRect(ox + 16, by - 1, 16, 10, C_OUTLINE);

        if (arch.name === 'paladin') {
          // Plume + Shield
          s.fillRect(ox + 22, by - 4 + (f % 2), 4, 3, arch.crest);
          s.fillRect(ox + 10, by + 9, 5, 10, C_WHITE);
          s.strokeRect(ox + 10, by + 9, 5, 10, C_OUTLINE);
        } else if (arch.name === 'vanguard') {
          // Winged dragoon horns
          s.fillRect(ox + 13, by - 3, 3, 4, arch.weapon);
          s.fillRect(ox + 32, by - 3, 3, 4, arch.weapon);
        } else if (arch.name === 'lore_warden') {
          // Levitating pixel grimoire on left
          s.fillRect(ox + 8, by + 8 - (f % 2), 6, 5, arch.crest);
          s.strokeRect(ox + 8, by + 8 - (f % 2), 6, 5, C_OUTLINE);
        } else if (arch.name === 'inquisitor') {
          // Pointed iron peak + vermilion cape
          s.fillRect(ox + 21, by - 4, 6, 3, arch.shade);
          s.fillRect(ox + 12, by + 9, 3, 12, arch.crest);
        } else if (arch.name === 'artificer') {
          // Dorsal brass gear rig
          s.fillRect(ox + 12, by + 5, 4, 8, arch.weapon);
          s.fillRect(ox + 32, by + 5, 4, 8, arch.weapon);
        }

        // Right-hand Weapon / Staff
        const weaponLift = st.key === 'cast' ? -3 - (f % 2) : st.key === 'barracks_rest' ? 2 : 0;
        s.fillRect(ox + 35, by + 2 + weaponLift, 3, 19, arch.weapon);
        s.strokeRect(ox + 34, by + 1 + weaponLift, 5, 21, C_OUTLINE);

        // Alert state: bouncing 9x11 [!] pixel box above head (y=2..13)
        if (st.key === 'alert') {
          const ay = oy + 2 + (f % 2);
          s.fillRect(ox + 20, ay, 9, 11, C_WHITE);
          s.strokeRect(ox + 20, ay, 9, 11, C_OUTLINE);
          s.fillRect(ox + 24, ay + 2, 2, 4, C_RED);
          s.fillRect(ox + 24, ay + 7, 2, 2, C_RED);
        }

        // Barracks rest state: drifting 'z' pixel
        if (st.key === 'barracks_rest') {
          const zy = oy + 8 - f * 2;
          s.fillRect(ox + 33 + f, zy, 3, 1, C_MUTED);
          s.setPx(ox + 34 + f, zy + 1, C_MUTED);
          s.fillRect(ox + 33 + f, zy + 2, 3, 1, C_MUTED);
        }
      }
    });
  });

  const descriptor = {
    meta: {
      app: 'hermes-os-sprite-v1',
      version: '1.0.0',
      image: 'knights-isometric.png',
      format: 'RGBA8888',
      size: { w: W, h: H },
      frameSize: { w: FW, h: FH },
      scale: 2,
    },
    animations,
  };

  return { png: encodeRgbaPng(W, H, s.data), descriptor };
}

function main() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = resolve(rootDir, 'src/assets/sprites');
  mkdirSync(outDir, { recursive: true });

  const mini = buildFrierenMini();
  writeFileSync(resolve(outDir, 'frieren-mini.png'), mini.png);
  writeFileSync(resolve(outDir, 'frieren-mini.json'), `${JSON.stringify(mini.descriptor, null, 2)}\n`);

  const portrait = buildFrierenPortrait();
  writeFileSync(resolve(outDir, 'frieren-portrait.png'), portrait.png);
  writeFileSync(resolve(outDir, 'frieren-portrait.json'), `${JSON.stringify(portrait.descriptor, null, 2)}\n`);

  const knights = buildKnightsIsometric();
  writeFileSync(resolve(outDir, 'knights-isometric.png'), knights.png);
  writeFileSync(resolve(outDir, 'knights-isometric.json'), `${JSON.stringify(knights.descriptor, null, 2)}\n`);

  console.log(
    `Generated sprites in ${outDir}: frieren-mini (${mini.png.length}B), frieren-portrait (${portrait.png.length}B), knights-isometric (${knights.png.length}B)`,
  );
}

main();
