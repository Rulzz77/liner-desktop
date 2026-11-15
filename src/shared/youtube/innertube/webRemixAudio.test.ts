import { describe, expect, it } from "vitest";
import { chooseWebRemixAudioFormat } from "./webRemixAudio";

function format(
  itag: number,
  mime_type: string,
  has_video: boolean,
  bitrate = 128_000,
) {
  return {
    itag,
    mime_type,
    has_audio: true,
    has_video,
    bitrate,
    content_length: "1000",
    decipher: async () => "https://example.test/audio",
  };
}

describe("WEB_REMIX audio format selection", () => {
  it("chooses muxed AAC before an Opus-only adaptive stream on Android", () => {
    const opus = format(251, 'audio/webm; codecs="opus"', false, 160_000);
    const muxedAac = format(
      18,
      'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      true,
      96_000,
    );

    const result = chooseWebRemixAudioFormat(
      [opus],
      [muxedAac],
      true,
      "aac",
    );

    expect(result?.candidate).toMatchObject({
      itag: 18,
      mimeType: "audio/mp4",
    });
    expect(result?.source).toBe(muxedAac);
  });

  it("prefers standalone AAC when available", () => {
    const standaloneAac = format(140, 'audio/mp4; codecs="mp4a.40.2"', false);
    const muxedAac = format(
      18,
      'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      true,
    );

    const result = chooseWebRemixAudioFormat(
      [standaloneAac],
      [muxedAac],
      true,
      "aac",
    );

    expect(result?.candidate.itag).toBe(140);
    expect(result?.source).toBe(standaloneAac);
  });

  it("uses another adaptive format if the muxed AAC itag was rejected", () => {
    const opus = format(251, 'audio/webm; codecs="opus"', false);
    const muxedAac = format(
      18,
      'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      true,
    );

    const result = chooseWebRemixAudioFormat(
      [opus],
      [muxedAac],
      true,
      "aac",
      [18],
    );

    expect(result?.candidate.itag).toBe(251);
    expect(result?.source).toBe(opus);
  });

  it("does not use muxed video formats on desktop", () => {
    const muxedAac = format(
      18,
      'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      true,
    );

    expect(chooseWebRemixAudioFormat([], [muxedAac], false, "aac")).toBeNull();
  });
});
