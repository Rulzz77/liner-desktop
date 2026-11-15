import { describe, expect, it } from "vitest";
import { asBufferedPlaybackStream } from "./playbackStream";

describe("Android buffered playback streams", () => {
  it("preserves source metadata needed for R2-to-YouTube recovery", () => {
    const stream = asBufferedPlaybackStream(
      {
        url: "https://cdn.example.test/audio.m4a",
        source: "r2",
        mimeType: "audio/mp4",
        codec: "aac",
        bitrate: 128_000,
        contentLength: 1200,
        expiresAtMs: Date.now() + 60_000,
        fromLiner: true,
      },
      new Blob(["audio"], { type: "audio/mp4" }),
    );

    expect(stream).toMatchObject({
      source: "r2",
      mimeType: "audio/mp4",
      codec: "aac",
      fromLiner: true,
      contentLength: 5,
    });
  });

  it("preserves stand-in source metadata when an Android stream is buffered", () => {
    const stream = asBufferedPlaybackStream(
      {
        url: "https://rr1.googlevideo.com/videoplayback",
        source: "youtube",
        mimeType: "audio/mp4",
        codec: "aac",
        bitrate: 128_000,
        expiresAtMs: null,
        itag: 140,
        standIn: true,
      },
      new Blob(["audio"], { type: "audio/mp4" }),
    );

    expect(stream).toMatchObject({
      source: "youtube",
      itag: 140,
      standIn: true,
    });
  });
});
