import React, { useState, useCallback, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check, Square, Circle, Heart, Star, MessageCircle } from 'lucide-react';
import './CropModal.css';

interface CropModalProps {
  imageUrl: string;
  initialShape?: ShapeType;
  onComplete: (croppedDataUrl: string, shapeStyle: React.CSSProperties) => void;
  onCancel: () => void;
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

type ShapeType = 'square' | 'rectangle' | 'rectangle-h' | 'circle' | 'ellipse' | 'ellipse-h' | 'heart' | 'star' | 'bubble';

// 縦長長方形アイコン
const RectIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="10" rx="2" ry="2" />
  </svg>
);

// 横長長方形アイコン
const RectIconH = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="2" width="10" height="20" rx="2" ry="2" />
  </svg>
);

// 2点間の角度（度）を返す
function angleBetween(t1: React.Touch, t2: React.Touch): number {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);
}

// 回転済み画像を元画像と同じサイズのキャンバスで返す
async function getRotatedImageUrl(imageSrc: string, rotation: number): Promise<string> {
  const image = await createImage(imageSrc);
  const w = image.width;
  const h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -w / 2, -h / 2);
  return canvas.toDataURL('image/png');
}

// 切り抜き
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  shape: ShapeType
): Promise<string> {
  const image = await createImage(imageSrc);
  const finalCanvas = document.createElement('canvas');
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('No 2d context');
  finalCanvas.width = pixelCrop.width;
  finalCanvas.height = pixelCrop.height;
  const w = finalCanvas.width;
  const h = finalCanvas.height;

  finalCtx.beginPath();
  if (shape === 'circle') {
    finalCtx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else if (shape === 'ellipse' || shape === 'ellipse-h') {
    finalCtx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'heart') {
    finalCtx.moveTo(w / 2, h * 0.25);
    finalCtx.bezierCurveTo(w / 2, 0, 0, 0, 0, h * 0.4);
    finalCtx.bezierCurveTo(0, h * 0.7, w / 2, h * 0.95, w / 2, h);
    finalCtx.bezierCurveTo(w / 2, h * 0.95, w, h * 0.7, w, h * 0.4);
    finalCtx.bezierCurveTo(w, 0, w / 2, 0, w / 2, h * 0.25);
  } else if (shape === 'star') {
    const cx = w / 2; const cy = h / 2;
    const outerRadius = Math.min(w, h) / 2;
    const innerRadius = outerRadius / 2.5;
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 10 - Math.PI / 2;
      finalCtx.lineTo(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius);
      const angle2 = ((i * 4 + 2) * Math.PI) / 10 - Math.PI / 2;
      finalCtx.lineTo(cx + Math.cos(angle2) * innerRadius, cy + Math.sin(angle2) * innerRadius);
    }
    finalCtx.closePath();
  } else if (shape === 'bubble') {
    const r = w * 0.1;
    finalCtx.moveTo(r, 0);
    finalCtx.lineTo(w - r, 0);
    finalCtx.quadraticCurveTo(w, 0, w, r);
    finalCtx.lineTo(w, h * 0.75 - r);
    finalCtx.quadraticCurveTo(w, h * 0.75, w - r, h * 0.75);
    finalCtx.lineTo(w * 0.3, h * 0.75);
    finalCtx.lineTo(w * 0.15, h * 0.95);
    finalCtx.lineTo(w * 0.15, h * 0.75);
    finalCtx.lineTo(r, h * 0.75);
    finalCtx.quadraticCurveTo(0, h * 0.75, 0, h * 0.75 - r);
    finalCtx.lineTo(0, r);
    finalCtx.quadraticCurveTo(0, 0, r, 0);
  } else {
    finalCtx.rect(0, 0, w, h);
  }
  finalCtx.clip();

  finalCtx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y,
    pixelCrop.width, pixelCrop.height,
    0, 0, pixelCrop.width, pixelCrop.height
  );

  return finalCanvas.toDataURL('image/png');
}

// ===== 特殊形状かどうか =====
function isSpecialShape(s: ShapeType) {
  return s === 'heart' || s === 'star' || s === 'bubble';
}

// ===== コンテナサイズ取得フック =====
function useContainerSize(ref: React.RefObject<HTMLDivElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ===== SVGパス生成 =====
function buildStarPath(cx: number, cy: number, r: number): string {
  const innerR = r / 2.5;
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a1 = (i * 4 * Math.PI) / 10 - Math.PI / 2;
    pts.push(`${cx + Math.cos(a1) * r},${cy + Math.sin(a1) * r}`);
    const a2 = ((i * 4 + 2) * Math.PI) / 10 - Math.PI / 2;
    pts.push(`${cx + Math.cos(a2) * innerR},${cy + Math.sin(a2) * innerR}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

function buildHeartPath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  return [
    `M ${cx} ${y + h * 0.25}`,
    `C ${cx} ${y} ${x} ${y} ${x} ${y + h * 0.4}`,
    `C ${x} ${y + h * 0.7} ${cx} ${y + h * 0.95} ${cx} ${y + h}`,
    `C ${cx} ${y + h * 0.95} ${x + w} ${y + h * 0.7} ${x + w} ${y + h * 0.4}`,
    `C ${x + w} ${y} ${cx} ${y} ${cx} ${y + h * 0.25} Z`,
  ].join(' ');
}

function buildBubblePath(x: number, y: number, w: number, h: number): string {
  const r = w * 0.08;
  const bh = h * 0.78;
  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + bh - r}`,
    `Q ${x + w} ${y + bh} ${x + w - r} ${y + bh}`,
    `L ${x + w * 0.35} ${y + bh}`,
    `L ${x + w * 0.2} ${y + h}`,
    `L ${x + w * 0.2} ${y + bh}`,
    `L ${x + r} ${y + bh}`,
    `Q ${x} ${y + bh} ${x} ${y + bh - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y} Z`,
  ].join(' ');
}

// ===== SVGオーバーレイ：外側を暗くして形の枠を表示 =====
function ShapeOverlay({
  shape, width, height, cropSize,
}: {
  shape: ShapeType; width: number; height: number; cropSize: number;
}) {
  if (!isSpecialShape(shape) || width === 0 || height === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const half = cropSize / 2;

  let shapePath = '';
  if (shape === 'star') {
    shapePath = buildStarPath(cx, cy, half);
  } else if (shape === 'heart') {
    shapePath = buildHeartPath(cx - half, cy - half, cropSize, cropSize);
  } else if (shape === 'bubble') {
    shapePath = buildBubblePath(cx - half, cy - half, cropSize, cropSize);
  }

  const outerRect = `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* evenodd で外側を暗くし、内側（形）が透明な穴になる */}
      <path
        d={`${outerRect} ${shapePath}`}
        fill="rgba(0,0,0,0.58)"
        fillRule="evenodd"
      />
      {/* 形の輪郭線（破線） */}
      <path
        d={shapePath}
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="2"
        strokeDasharray="6 3"
      />
    </svg>
  );
}

// ===== メインコンポーネント =====
export default function CropModal({ imageUrl, initialShape, onComplete, onCancel }: CropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [shape, setShape] = useState<ShapeType>(initialShape ?? 'square');
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [rotatedImageUrl, setRotatedImageUrl] = useState(imageUrl);

  const rotationRef = useRef(0);
  const prevAngleRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);

  // 特殊形状のとき cropSize をコンテナ横幅基準で設定（はみ出し防止）
  const cropSize = isSpecialShape(shape) && containerSize.width > 0
    ? (() => {
        const pad = 32;
        const s = Math.min(
          containerSize.width - pad,
          containerSize.height - pad,
        );
        return { width: s, height: s };
      })()
    : undefined;

  const onCropComplete = useCallback((_: any, pixels: any) => {
    setCroppedAreaPixels(pixels);
  }, []);

  // rotation 変更 → デバウンスで回転画像を再生成
  const applyRotation = useCallback((value: number) => {
    const clamped = Math.max(-180, Math.min(180, value));
    rotationRef.current = clamped;
    setRotation(clamped);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const url = await getRotatedImageUrl(imageUrl, clamped);
      setRotatedImageUrl(url);
      setCrop({ x: 0, y: 0 });
    }, 120);
  }, [imageUrl]);

  // タッチ2本指でのツイスト回転
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        prevAngleRef.current = angleBetween(e.touches[0] as any, e.touches[1] as any);
      } else {
        prevAngleRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || prevAngleRef.current === null) return;
      const currentAngle = angleBetween(e.touches[0] as any, e.touches[1] as any);
      const delta = currentAngle - prevAngleRef.current;
      prevAngleRef.current = currentAngle;
      applyRotation(rotationRef.current + delta);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        prevAngleRef.current = null;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [applyRotation]);

  const handleComplete = async () => {
    if (!croppedAreaPixels) return;
    try {
      const croppedImage = await getCroppedImg(rotatedImageUrl, croppedAreaPixels, shape);
      onComplete(croppedImage, {});
    } catch (e) {
      console.error(e);
      alert('トリミングに失敗しました');
    }
  };

  // 特殊形状のとき react-easy-crop の白枠を非表示にする
  const cropAreaStyle: React.CSSProperties = isSpecialShape(shape)
    ? { border: 'none', boxShadow: 'none', color: 'transparent' }
    : {};

  return (
    <div className="crop-modal-overlay">
      <div className="crop-modal-header">
        <button className="crop-btn cancel" onClick={onCancel}><X size={18} /> キャンセル</button>
        <button className="crop-btn confirm" onClick={handleComplete} translate="no"><Check size={18} /> OK</button>
      </div>

      <div className="crop-container" data-shape={shape} ref={containerRef}>
        <Cropper
          image={rotatedImageUrl}
          crop={crop}
          zoom={zoom}
          aspect={
            shape === 'rectangle' || shape === 'ellipse' ? 3 / 4
            : shape === 'rectangle-h' || shape === 'ellipse-h' ? 4 / 3
            : 1
          }
          cropShape={(shape === 'circle' || shape === 'ellipse' || shape === 'ellipse-h') ? 'round' : 'rect'}
          cropSize={cropSize}
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          restrictPosition={false}
          minZoom={0.1}
          showGrid={!isSpecialShape(shape)}
          style={{
            containerStyle: { background: '#222' },
            cropAreaStyle,
          }}
        />
        {/* SVGオーバーレイ（星・ハート・ふきだし用） */}
        {isSpecialShape(shape) && cropSize && (
          <ShapeOverlay
            shape={shape}
            width={containerSize.width}
            height={containerSize.height}
            cropSize={cropSize.width}
          />
        )}
      </div>

      <div className="crop-controls">
        <div className="sliders-container">
          <div className="control-slider">
            <span style={{ color: '#888', fontSize: '12px' }}>回転</span>
            <input
              type="range" min="-180" max="180" value={rotation}
              onChange={(e) => applyRotation(Number(e.target.value))}
            />
          </div>
          <div className="control-slider">
            <span style={{ color: '#888', fontSize: '12px' }}>拡大する</span>
            <input type="range" min="0.1" max="5" step="0.1" value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} />
          </div>
        </div>
        <div className="shape-selector">
          <button className={`shape-btn ${shape === 'square' ? 'active' : ''}`} onClick={() => setShape('square')}>
            <Square size={20} /><span>正方形</span>
          </button>
          <button className={`shape-btn ${shape === 'rectangle' ? 'active' : ''}`} onClick={() => setShape('rectangle')}>
            <RectIcon size={20} /><span>長方形縦</span>
          </button>
          <button className={`shape-btn ${shape === 'rectangle-h' ? 'active' : ''}`} onClick={() => setShape('rectangle-h')}>
            <RectIconH size={20} /><span>長方形横</span>
          </button>
          <button className={`shape-btn ${shape === 'circle' ? 'active' : ''}`} onClick={() => setShape('circle')}>
            <Circle size={20} /><span>円</span>
          </button>
          <button className={`shape-btn ${shape === 'ellipse' ? 'active' : ''}`} onClick={() => setShape('ellipse')}>
            <Circle size={20} style={{ transform: 'scale(1.2, 0.8)' }} /><span>楕円縦</span>
          </button>
          <button className={`shape-btn ${shape === 'ellipse-h' ? 'active' : ''}`} onClick={() => setShape('ellipse-h')}>
            <Circle size={20} style={{ transform: 'scale(0.8, 1.2)' }} /><span>楕円横</span>
          </button>
          <button className={`shape-btn ${shape === 'heart' ? 'active' : ''}`} onClick={() => setShape('heart')}>
            <Heart size={20} /><span>ハート</span>
          </button>
          <button className={`shape-btn ${shape === 'star' ? 'active' : ''}`} onClick={() => setShape('star')}>
            <Star size={20} /><span>スター</span>
          </button>
          <button className={`shape-btn ${shape === 'bubble' ? 'active' : ''}`} onClick={() => setShape('bubble')}>
            <MessageCircle size={20} /><span>ふきだし</span>
          </button>
        </div>
      </div>
    </div>
  );
}
