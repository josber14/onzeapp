// Prueba de regresión para el bug real confirmado en vivo (ago 2026, orden
// de 400.000 CLP): classifyImage() devolvía null en silencio para CUALQUIER
// comprobante que en realidad fuera PNG, porque confiaba en el header
// Content-Type que manda el CDN de Binance (bin.bnbstatic.com) -- que
// devuelve "binary/octet-stream" genérico para al menos algunas imágenes,
// aunque la URL termine en ".jpg" y el archivo sea un PNG real. La API de
// Anthropic rechaza (400) cualquier imagen cuyos bytes no coincidan con el
// media_type declarado, así que un PNG mandado como "image/jpeg" nunca se
// leía -- el comprador transfería, el comprobante llegaba, y el bot
// simplemente no reaccionaba (parecía "no leer nada").
import { describe, it, expect } from "vitest";
import { detectImageMediaType } from "../../lib/p2p-bot/chat-brain";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_MAGIC = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

describe("detectImageMediaType", () => {
  it("reconoce un PNG por sus bytes aunque el CDN mienta con el Content-Type", () => {
    // Caso real: el CDN de Binance mandó "binary/octet-stream" para un PNG real.
    expect(detectImageMediaType(PNG_MAGIC, "binary/octet-stream")).toBe("image/png");
  });

  it("reconoce un JPEG por sus bytes", () => {
    expect(detectImageMediaType(JPEG_MAGIC, "binary/octet-stream")).toBe("image/jpeg");
  });

  it("reconoce un WEBP por sus bytes", () => {
    expect(detectImageMediaType(WEBP_MAGIC, "binary/octet-stream")).toBe("image/webp");
  });

  it("no se deja engañar por un Content-Type que dice 'jpeg' si los bytes son PNG", () => {
    // El bug real exacto: el código viejo confiaba ciegamente en este header.
    expect(detectImageMediaType(PNG_MAGIC, "image/jpeg")).toBe("image/png");
  });

  it("cae al Content-Type solo cuando los bytes no calzan con ningún formato conocido", () => {
    const bytesRaros = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectImageMediaType(bytesRaros, "image/png")).toBe("image/png");
    expect(detectImageMediaType(bytesRaros, "image/webp")).toBe("image/webp");
    expect(detectImageMediaType(bytesRaros, "binary/octet-stream")).toBe("image/jpeg");
  });
});
