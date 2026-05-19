const crypto = require("crypto");

const CAPTCHA_TTL = 10 * 60 * 1000;
const captchaStore = new Map();

const hashString = (value) => crypto.createHash("sha256").update(value).digest("hex");

const cleanupCaptcha = () => {
  const now = Date.now();
  for (const [key, entry] of captchaStore.entries()) {
    if (entry.expires < now) {
      captchaStore.delete(key);
    }
  }
};

const randomText = (length = 5) => {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => charset[crypto.randomInt(0, charset.length)]).join("");
};

const CLI_FONT = {
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  B: ["████ ", "█   █", "████ ", "█   █", "████ "],
  C: [" ████", "█    ", "█    ", "█    ", " ████"],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  F: ["█████", "█    ", "████ ", "█    ", "█    "],
  G: [" ███ ", "█    ", "█  ██", "█   █", " ███ "],
  H: ["█   █", "█   █", "█████", "█   █", "█   █"],
  J: ["  ███", "   █ ", "   █ ", "█  █ ", " ██  "],
  K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  Q: [" ███ ", "█   █", "█   █", "█  ██", " ████"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
  2: [" ███ ", "█   █", "   █ ", "  █  ", "█████"],
  3: ["████ ", "    █", " ███ ", "    █", "████ "],
  4: ["█   █", "█   █", "█████", "    █", "    █"],
  5: ["█████", "█    ", "████ ", "    █", "████ "],
  6: [" ███ ", "█    ", "████ ", "█   █", " ███ "],
  7: ["█████", "    █", "   █ ", "  █  ", "  █  "],
  8: [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
  9: [" ███ ", "█   █", " ████", "    █", " ███ "],
};

const createCliCaptchaAscii = (text) => {
  // 7 rows makes room for jitter + noise.
  const height = 7;
  const widthPerChar = 5;
  const leftPad = 1;
  const charGap = 1;
  const baseY = 1; // keep 1 row top margin

  const lines = Array.from({ length: height }, () => "");
  for (const ch of String(text).toUpperCase()) {
    const glyph = CLI_FONT[ch] || ["?????", "?????", "?????", "?????", "?????"];
    const vShift = crypto.randomInt(-1, 2); // -1..1
    const hShift = crypto.randomInt(0, 2); // 0..1
    const block = Array.from({ length: height }, () => " ".repeat(widthPerChar));
    for (let y = 0; y < glyph.length; y++) {
      const destY = baseY + vShift + y;
      if (destY < 0 || destY >= height) continue;
      block[destY] = glyph[y];
    }
    for (let y = 0; y < height; y++) {
      lines[y] += " ".repeat(leftPad + hShift) + block[y] + " ".repeat(charGap);
    }
  }

  // Add noise (dots + strokes) without destroying readability too much.
  const noiseChars = ["·", "•", "░", "▒", ":", ".", "*", "+", "╱", "╲"];
  const out = lines.map((l) => l.split(""));
  const maxX = Math.max(...out.map((l) => l.length), 0);
  const totalNoise = crypto.randomInt(18, 28);
  for (let i = 0; i < totalNoise; i++) {
    const y = crypto.randomInt(0, height);
    const x = crypto.randomInt(0, Math.max(1, maxX));
    if (!out[y]) continue;
    if (out[y][x] && out[y][x] !== " ") continue;
    out[y][x] = noiseChars[crypto.randomInt(0, noiseChars.length)];
  }

  // A couple of diagonal strokes.
  const strokes = crypto.randomInt(1, 3);
  for (let s = 0; s < strokes; s++) {
    const y0 = crypto.randomInt(0, height);
    const x0 = crypto.randomInt(0, Math.max(1, maxX));
    const len = crypto.randomInt(12, 22);
    const dir = crypto.randomInt(0, 2) === 0 ? 1 : -1;
    for (let i = 0; i < len; i++) {
      const y = y0 + Math.floor((i / 3) * dir);
      const x = x0 + i;
      if (y < 0 || y >= height) continue;
      if (!out[y]) continue;
      if (x < 0 || x >= out[y].length) continue;
      if (out[y][x] !== " ") continue;
      out[y][x] = dir === 1 ? "╲" : "╱";
    }
  }

  return out.map((l) => l.join("").replace(/\s+$/, "")).join("\n");
};

const createCaptchaSvg = (text) => {
  const width = 180;
  const height = 60;
  const bg = "#0f172a";
  const fg = "#e2e8f0";
  const noise = Array.from({ length: 6 }, () => {
    const x1 = crypto.randomInt(0, width);
    const y1 = crypto.randomInt(0, height);
    const x2 = crypto.randomInt(0, width);
    const y2 = crypto.randomInt(0, height);
    const opacity = (crypto.randomInt(10, 40) / 100).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fg}" stroke-width="1.5" opacity="${opacity}" />`;
  }).join("");

  const dots = Array.from({ length: 40 }, () => {
    const cx = crypto.randomInt(0, width);
    const cy = crypto.randomInt(0, height);
    const r = crypto.randomInt(1, 3);
    const opacity = (crypto.randomInt(10, 50) / 100).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fg}" opacity="${opacity}" />`;
  }).join("");

  const letters = text.split("").map((char, idx) => {
    const fontSize = crypto.randomInt(24, 32);
    const x = 20 + idx * 30 + crypto.randomInt(-3, 3);
    const y = 35 + crypto.randomInt(-5, 5);
    const rotate = crypto.randomInt(-18, 18);
    const opacity = (crypto.randomInt(85, 100) / 100).toFixed(2);
    return `<text x="${x}" y="${y}" fill="${fg}" font-family="monospace" font-size="${fontSize}" font-weight="700" opacity="${opacity}" transform="rotate(${rotate} ${x} ${y})" text-rendering="geometricPrecision" letter-spacing="2">${char}</text>`;
  }).join("");

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">
    <rect width="${width}" height="${height}" rx="10" fill="${bg}" />
    ${noise}
    ${dots}
    ${letters}
  </svg>
  `.trim();
};

const generateCaptcha = () => {
  cleanupCaptcha();
  const text = randomText(5);
  const captchaId = crypto.randomUUID();
  const svg = createCaptchaSvg(text);
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  captchaStore.set(captchaId, {
    hash: hashString(text.toLowerCase()),
    expires: Date.now() + CAPTCHA_TTL,
  });

  return {
    captchaId,
    image,
  };
};

const generateCliCaptcha = () => {
  cleanupCaptcha();
  const text = randomText(5);
  const captchaId = crypto.randomUUID();
  const captcha = createCliCaptchaAscii(text);

  captchaStore.set(captchaId, {
    hash: hashString(text.toLowerCase()),
    expires: Date.now() + CAPTCHA_TTL,
  });

  return {
    captchaId,
    captcha,
  };
};

const validateCaptcha = (captchaId, answer) => {
  if (!captchaId || typeof answer !== "string") return false;
  const entry = captchaStore.get(captchaId);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    captchaStore.delete(captchaId);
    return false;
  }
  const isValid = hashString(answer.trim().toLowerCase()) === entry.hash;
  captchaStore.delete(captchaId);
  return isValid;
};

module.exports = {
  generateCaptcha,
  generateCliCaptcha,
  validateCaptcha,
};
