import { formatGen, parseGen, scoreLabel, shortAddress } from "../src/format";

describe("format helpers", () => {
  it("parses GEN decimal strings to atto", () => {
    expect(parseGen("0.01")).toBe(10n ** 16n);
    expect(parseGen("1.2345")).toBe(1234500000000000000n);
    expect(parseGen("")).toBe(0n);
  });

  it("formats atto values as short GEN strings", () => {
    expect(formatGen(10n ** 18n)).toBe("1 GEN");
    expect(formatGen(1234500000000000000n)).toBe("1.2345 GEN");
    expect(formatGen("10000000000000000")).toBe("0.01 GEN");
  });

  it("shortens addresses and hashes consistently", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234...5678");
    expect(shortAddress("0x1234")).toBe("0x1234");
  });

  it("maps review scores to labels", () => {
    expect(scoreLabel(90)).toBe("Excellent");
    expect(scoreLabel(75)).toBe("Approved");
    expect(scoreLabel(55)).toBe("Needs proof");
    expect(scoreLabel(10)).toBe("Low signal");
  });
});

