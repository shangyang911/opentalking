import { useEffect, useRef, useState } from 'react';

export function AvatarCropper({ file, busy, onSave, onCancel }: { file: File; busy: boolean; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let bitmap: ImageBitmap | null = null;
    void createImageBitmap(file).then(value => {
      bitmap = value;
      if (!active) { value.close(); return; }
      if (value.width * value.height > 16_000_000) { value.close(); setError('图片不得超过 1600 万像素。'); return; }
      setImage(value);
    }).catch(() => { if (active) setError('图片无法读取，请选择 JPG、PNG 或 WebP 图片。'); });
    return () => { active = false; bitmap?.close(); };
  }, [file]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const context = canvas.current.getContext('2d');
    if (!context) return;
    const side = Math.min(image.width, image.height) / zoom;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.width - side) * (x + 100) / 200, (image.height - side) * (y + 100) / 200, side, side, 0, 0, 256, 256);
  }, [image, zoom, x, y]);
  return <section aria-label="裁剪账户头像" className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-5"><h3 className="text-sm font-semibold">裁剪账户头像</h3><p className="mt-1 text-xs text-slate-500">调整图片位置与大小，方形裁剪将显示为圆形头像。</p><canvas ref={canvas} width={256} height={256} className="mx-auto my-5 h-48 w-48 rounded-full bg-white ring-4 ring-white shadow-sm" />{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="mx-auto max-w-sm space-y-3">{[
    ['缩放', zoom, 1, 3, .05, setZoom], ['水平位置', x, -100, 100, 1, setX], ['垂直位置', y, -100, 100, 1, setY],
  ].map(([label, value, min, max, step, setter]) => <label key={String(label)} className="flex items-center gap-4 text-xs text-slate-600"><span className="w-16 shrink-0">{String(label)}</span><input aria-label={String(label)} type="range" disabled={busy || !image || !!error} min={Number(min)} max={Number(max)} step={Number(step)} value={Number(value)} onChange={event => (setter as (value: number) => void)(Number(event.target.value))} className="min-w-0 flex-1 accent-cyan-600" /></label>)}</div><div className="mt-5 flex justify-end gap-3"><button disabled={busy} onClick={onCancel} className="rounded-xl border bg-white px-4 py-2 text-sm">取消裁剪</button><button disabled={busy || !image || !!error} onClick={() => { canvas.current?.toBlob(blob => { if (blob) void onSave(blob); else setError('图片处理失败，请重试。'); }, 'image/webp', .9); }} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '上传中…' : '使用此头像'}</button></div></section>;
}
