import { describe, expect, it } from "vitest";
import { isValidVideoPoTokenIdentifier } from "./browserPoToken";

describe("YouTube PoToken identifier validation", () => {
  it.each(["BLQPNaBklGA", "5V3J-1DcVcI", "abC_def-123"])(
    "accepts a valid 11-character video id: %s",
    (videoId) => {
      expect(isValidVideoPoTokenIdentifier(videoId)).toBe(true);
    },
  );

  it.each(["", "short", "BLQPNaBklGA=", "BLQPNaBklG ", "BLQPNaBklGAX"])(
    "rejects an invalid video id: %s",
    (videoId) => {
      expect(isValidVideoPoTokenIdentifier(videoId)).toBe(false);
    },
  );
});
