type CaptureStreamVideoElement = HTMLVideoElement & {
  captureStream?: (fps?: number) => MediaStream;
  mozCaptureStream?: (fps?: number) => MediaStream;
};

export function captureRecordingVideo(
  video: CaptureStreamVideoElement | null,
  canvas: HTMLCanvasElement | null,
): MediaStream {
  if (canvas) {
    if (canvas.dataset.rendererReady !== "true") throw new Error("动画尚未准备完成，请稍后再录制。");
    return canvas.captureStream(30);
  }
  const capture = video?.captureStream ?? video?.mozCaptureStream;
  if (!video || !capture) throw new Error("当前浏览器不支持录制舞台画面，请换用 Chrome。");
  return capture.call(video, 30);
}
