import assert from "node:assert/strict";
import test from "node:test";
import { captureRecordingVideo } from "../src/features/conversation/recording";

test("DOGO recording captures the animated canvas instead of the hidden video", () => {
  const canvasStream = {} as MediaStream;
  const canvas = {
    dataset: { rendererReady: "true" },
    captureStream(fps: number) { assert.equal(fps, 30); return canvasStream; },
  } as unknown as HTMLCanvasElement;
  const video = { captureStream() { throw new Error("hidden video must not be recorded"); } } as unknown as HTMLVideoElement;
  assert.equal(captureRecordingVideo(video, canvas), canvasStream);
});

test("recording waits for the first animation frame instead of saving a blank canvas", () => {
  const canvas = {
    dataset: {},
    captureStream() { throw new Error("unready canvas must not be recorded"); },
  } as unknown as HTMLCanvasElement;
  assert.throws(() => captureRecordingVideo(null, canvas), /准备/);
});

for (const method of ["captureStream", "mozCaptureStream"]) {
  test(`QuickTalk recording still captures the video using ${method}`, () => {
    const stream = {} as MediaStream;
    const video = {
      [method](fps: number) {
        assert.equal(this, video);
        assert.equal(fps, 30);
        return stream;
      },
    } as unknown as HTMLVideoElement;
    assert.equal(captureRecordingVideo(video, null), stream);
  });
}

test("unsupported recording reports an actionable browser error", () => {
  assert.throws(() => captureRecordingVideo({} as HTMLVideoElement, null), /Chrome/);
});
