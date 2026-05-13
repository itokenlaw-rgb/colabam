import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Check,
  Grid, ImagePlus, X, LayoutTemplate, Undo2, Shuffle,
} from 'lucide-react';
import CropModal from './CropModal';
import './index.css';

// ===== Types =====
type ItemType = 'photo' | 'stamp' | 'text';
type MainTab = 'template' | 'stamp' | 'text' | 'background' | 'photo';

interface SlotData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  style?: React.CSSProperties;
}

interface TemplateData {
  id: string;
  name: string;
  bg?: string;
  slots: SlotData[];
}

type ClipShape = 'heart' | 'star' | 'bubble';

// ===== Text Style Types =====
type TextStyleId =
  | 'normal'
  | 'shadow'
  | 'outline'
  | 'outline-shadow'
  | 'neon'
  | 'emboss'
  | 'arch-up'
  | 'arch-down'
  | 'wave';

interface TextStyleDef {
  id: TextStyleId;
  label: string;
  preview: string; // preview CSS style string (textShadow / WebkitTextStroke etc.)
}

const TEXT_STYLES: TextStyleDef[] = [
  { id: 'normal',         label: 'なし',     preview: '' },
  { id: 'shadow',         label: '影付き',   preview: '2px 2px 4px rgba(0,0,0,0.6)' },
  { id: 'outline',        label: '枠付き',   preview: '' },
  { id: 'outline-shadow', label: '影+枠',    preview: '' },
  { id: 'neon',           label: 'ネオン',   preview: '' },
  { id: 'emboss',         label: '立体',     preview: '' },
  { id: 'arch-up',        label: 'アーチ↑',  preview: '' },
  { id: 'arch-down',      label: 'アーチ↓',  preview: '' },
  { id: 'wave',           label: 'ウェーブ', preview: '' },
];

function getTextCssStyle(styleId: TextStyleId | undefined, color: string): React.CSSProperties {
  const base: React.CSSProperties = { color };
  switch (styleId) {
    case 'shadow':
      return { ...base, textShadow: '2px 3px 6px rgba(0,0,0,0.55)' };
    case 'outline':
      return { ...base, WebkitTextStroke: `2px ${color === '#ffffff' || color === '#fff' ? '#333' : '#fff'}`, color };
    case 'outline-shadow':
      return { ...base, WebkitTextStroke: `1.5px #fff`, textShadow: '2px 3px 5px rgba(0,0,0,0.5)' };
    case 'neon': {
      const c = color;
      return { ...base, textShadow: `0 0 6px ${c}, 0 0 16px ${c}, 0 0 32px ${c}, 2px 2px 0 #000` };
    }
    case 'emboss':
      return { ...base, textShadow: '-1px -1px 0 rgba(255,255,255,0.7), 2px 2px 3px rgba(0,0,0,0.5)' };
    default:
      return base;
  }
}

// アーチ/ウェーブはSVGで描画
function ArchText({ text, color, fontSize, styleId, width, height }: {
  text: string; color: string; fontSize: number; styleId: TextStyleId; width: number; height: number;
}) {
  const id = `arch-${Math.random().toString(36).slice(2)}`;
  const r = width * 0.9;
  const cx = width / 2;
  const isUp = styleId === 'arch-up';

  if (styleId === 'wave') {
    const chars = text.split('');
    const total = chars.length;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        <defs>
          <filter id={`shadow-${id}`}>
            <feDropShadow dx="1.5" dy="2" stdDeviation="2" floodOpacity="0.5" />
          </filter>
        </defs>
        {chars.map((ch, i) => {
          const x = (width / (total + 1)) * (i + 1);
          const y = height / 2 + Math.sin((i / total) * Math.PI * 2) * (height * 0.2);
          const rot = Math.cos((i / total) * Math.PI * 2) * 15;
          return (
            <text
              key={i}
              x={x} y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fontSize}
              fontFamily="sans-serif"
              fill={color}
              transform={`rotate(${rot}, ${x}, ${y})`}
              style={{ filter: `drop-shadow(1.5px 2px 2px rgba(0,0,0,0.5))` }}
            >{ch}</text>
          );
        })}
      </svg>
    );
  }

  // arch-up / arch-down
  const sweep = isUp ? 1 : 0;
  const arcY = isUp ? height * 0.85 : height * 0.15;
  const pathD = `M ${cx - r / 2} ${arcY} A ${r} ${r} 0 0 ${sweep} ${cx + r / 2} ${arcY}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <path id={id} d={pathD} />
        <filter id={`shadow-${id}`}>
          <feDropShadow dx="1.5" dy="2" stdDeviation="2" floodOpacity="0.5" />
        </filter>
      </defs>
      <text
        fontSize={fontSize}
        fontFamily="sans-serif"
        fill={color}
        style={{ filter: `drop-shadow(1.5px 2px 3px rgba(0,0,0,0.45))` }}
      >
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {text}
        </textPath>
      </text>
    </svg>
  );
}

interface CanvasItem {
  id: string;
  type: ItemType;
  content?: string;
  originalImageUrl?: string; // トリミング前の元画像URL
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  color?: string;
  fontSize?: number;
  clipShape?: ClipShape;
  textStyle?: TextStyleId;
  fontFamily?: string;
}

// 3:4 キャンバスサイズ（表示用px）
const CANVAS_W = 360;
const CANVAS_H = 480;

// 保存時の実解像度
const EXPORT_W = 1080;

// ===== Template Definitions =====
const TEMPLATES: TemplateData[] = [
  {
    id: 'four',
    name: 'スクエア６',
    slots: [
{ id: 's1', x: 20,  y: 65,  width: 150, height: 115 },
      { id: 's2', x: 190, y: 65,  width: 150, height: 115 },
      { id: 's3', x: 20,  y: 195, width: 150, height: 115 },
      { id: 's4', x: 190, y: 195, width: 150, height: 115 },
      { id: 's5', x: 20,  y: 325, width: 150, height: 115 },
      { id: 's6', x: 190, y: 325, width: 150, height: 115 },
    ],
  },
{
    id: 'circle',
    name: 'サークル６',
    slots: [
      // 上段：左に中円、右に小円×2
      { id: 's1', x: 15,  y: 65,  width: 155, height: 155, style: { borderRadius: '50%' } },
      { id: 's2', x: 210, y: 60,  width: 110, height: 110, style: { borderRadius: '50%' } },
      { id: 's3', x: 225, y: 180, width: 95,  height: 95,  style: { borderRadius: '50%' } },
      // 下段：左に小円×2、右に中円
      { id: 's4', x: 45,  y: 235, width: 90,  height: 90,  style: { borderRadius: '50%' } },
      { id: 's5', x: 30,  y: 340, width: 105, height: 105, style: { borderRadius: '50%' } },
      { id: 's6', x: 175, y: 300, width: 165, height: 165, style: { borderRadius: '50%' } },
    ],
  },
];

// ===== カスタム枠の種類定義 =====
type CustomSlotShape = 'square' | 'rect-v' | 'rect-h' | 'circle' | 'ellipse-v' | 'ellipse-h' | 'heart' | 'star';

interface CustomSlotOption {
  shape: CustomSlotShape;
  label: string;
  // サムネイル用の表示スタイル
  thumbStyle: React.CSSProperties;
}

const CUSTOM_SLOT_OPTIONS: CustomSlotOption[] = [
  { shape: 'square',    label: '正方形',   thumbStyle: { width: 36, height: 36, borderRadius: 0 } },
  { shape: 'rect-v',    label: '縦長方形', thumbStyle: { width: 28, height: 40, borderRadius: 0 } },
  { shape: 'rect-h',    label: '横長方形', thumbStyle: { width: 44, height: 28, borderRadius: 0 } },
  { shape: 'circle',    label: '円',       thumbStyle: { width: 36, height: 36, borderRadius: '50%' } },
  { shape: 'ellipse-v', label: '楕円縦',   thumbStyle: { width: 26, height: 40, borderRadius: '50%' } },
  { shape: 'ellipse-h', label: '楕円横',   thumbStyle: { width: 44, height: 28, borderRadius: '50%' } },
  { shape: 'heart',     label: 'ハート',   thumbStyle: { width: 36, height: 36, clipPath: 'polygon(50% 25%, 60% 10%, 75% 5%, 90% 10%, 100% 25%, 100% 42%, 85% 60%, 65% 78%, 50% 100%, 35% 78%, 15% 60%, 0% 42%, 0% 25%, 10% 10%, 25% 5%, 40% 10%)' } },
  { shape: 'star',      label: '星',       thumbStyle: { width: 36, height: 36, clipPath: 'polygon(50% 0%, 61.8% 35.4%, 98.1% 34.5%, 69.1% 57.3%, 79.4% 90.5%, 50% 70%, 20.6% 90.5%, 30.9% 57.3%, 1.9% 34.5%, 38.2% 35.4%)' } },
];

// 6マスの配置（左上→右上→中左→中右→下左→下右）
// shape ごとのサイズ比率（CANVAS_W=360, CANVAS_H=480 を基準）
function buildCustomSlots(shapes: CustomSlotShape[]): SlotData[] {
  const PAD = 8;      // 外側余白
  const GAP = 6;      // 枠間隔
  const TOP_OFFSET = 52; // 上部タイトルスペース
  const colW = (CANVAS_W - PAD * 2 - GAP) / 2;
  const availH = CANVAS_H - TOP_OFFSET - PAD - GAP * 2;
  const rowH = availH / 3;

  // 6マスのグリッド座標（col 0=左, 1=右  / row 0=上, 1=中, 2=下）
  const grid = [
    { col: 0, row: 0 }, // 1: 左上
    { col: 1, row: 0 }, // 2: 右上
    { col: 0, row: 1 }, // 3: 中左
    { col: 1, row: 1 }, // 4: 中右
    { col: 0, row: 2 }, // 5: 下左
    { col: 1, row: 2 }, // 6: 下右
  ];

  return shapes.map((shape, i) => {
    const { col, row } = grid[i];
    const cx = PAD + col * (colW + GAP);
    const cy = TOP_OFFSET + row * (rowH + GAP);

    // セル内に収めるサイズ（形状ごとにアスペクト比を変える）
    let w = colW, h = rowH;
    if (shape === 'square') {
      const s = Math.min(colW, rowH);
      w = s; h = s;
    } else if (shape === 'rect-v') {
      if (colW / rowH > 3 / 4) { h = rowH; w = rowH * 3 / 4; }
      else { w = colW; h = colW * 4 / 3; }
    } else if (shape === 'rect-h') {
      if (colW / rowH < 4 / 3) { w = colW; h = colW * 3 / 4; }
      else { h = rowH; w = rowH * 4 / 3; }
    } else if (shape === 'circle') {
      const s = Math.min(colW, rowH);
      w = s; h = s;
    } else if (shape === 'ellipse-v') {
      if (colW / rowH > 3 / 4) { h = rowH; w = rowH * 3 / 4; }
      else { w = colW; h = colW * 4 / 3; }
    } else if (shape === 'ellipse-h') {
      if (colW / rowH < 4 / 3) { w = colW; h = colW * 3 / 4; }
      else { h = rowH; w = rowH * 4 / 3; }
    } else if (shape === 'heart' || shape === 'star') {
      const s = Math.min(colW, rowH);
      w = s; h = s;
    }

    const x = cx + (colW - w) / 2;
    const y = cy + (rowH - h) / 2;

    const isCircular = shape === 'circle' || shape === 'ellipse-v' || shape === 'ellipse-h';
    let slotStyle: React.CSSProperties | undefined;
    if (isCircular) {
      slotStyle = { borderRadius: '50%' };
    } else if (shape === 'heart') {
      slotStyle = { clipPath: 'polygon(50% 25%, 60% 10%, 75% 5%, 90% 10%, 100% 25%, 100% 42%, 85% 60%, 65% 78%, 50% 100%, 35% 78%, 15% 60%, 0% 42%, 0% 25%, 10% 10%, 25% 5%, 40% 10%)' };
    } else if (shape === 'star') {
      slotStyle = { clipPath: 'polygon(50% 0%, 61.8% 35.4%, 98.1% 34.5%, 69.1% 57.3%, 79.4% 90.5%, 50% 70%, 20.6% 90.5%, 30.9% 57.3%, 1.9% 34.5%, 38.2% 35.4%)' };
    }

    return {
      id: `cs${i + 1}`,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      style: slotStyle,
    };
  });
}

// ===== ランダム枠生成 =====
type RandomShape = 'square' | 'rect-v' | 'rect-h' | 'circle' | 'ellipse-v' | 'ellipse-h' | 'heart' | 'star';

function buildRandomSlots(): SlotData[] {
  const shapes: RandomShape[] = ['square', 'rect-v', 'rect-h', 'circle', 'ellipse-v', 'ellipse-h', 'heart', 'star'];
  // 6つランダムに選ぶ（重複あり）
  const picked: RandomShape[] = Array.from({ length: 6 }, () => shapes[Math.floor(Math.random() * shapes.length)]);

  const PAD = 8;
  const GAP = 6;
  const TOP_OFFSET = 52;
  const colW = (CANVAS_W - PAD * 2 - GAP) / 2;
  const availH = CANVAS_H - TOP_OFFSET - PAD - GAP * 2;
  const rowH = availH / 3;

  const grid = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
    { col: 0, row: 2 },
    { col: 1, row: 2 },
  ];

  return picked.map((shape, i) => {
    const { col, row } = grid[i];
    const cx = PAD + col * (colW + GAP);
    const cy = TOP_OFFSET + row * (rowH + GAP);

    let w = colW, h = rowH;
    if (shape === 'square' || shape === 'circle' || shape === 'heart' || shape === 'star') {
      const s = Math.min(colW, rowH);
      w = s; h = s;
    } else if (shape === 'rect-v' || shape === 'ellipse-v') {
      if (colW / rowH > 3 / 4) { h = rowH; w = rowH * 3 / 4; }
      else { w = colW; h = colW * 4 / 3; }
    } else if (shape === 'rect-h' || shape === 'ellipse-h') {
      if (colW / rowH < 4 / 3) { w = colW; h = colW * 3 / 4; }
      else { h = rowH; w = rowH * 4 / 3; }
    }

    const x = cx + (colW - w) / 2;
    const y = cy + (rowH - h) / 2;

let slotStyle: React.CSSProperties | undefined;
    if (shape === 'circle' || shape === 'ellipse-v' || shape === 'ellipse-h') {
      slotStyle = { borderRadius: '50%' };
    } else if (shape === 'heart') {
      // 修正後：カスタム配置と同じ高精度なハートの形
      slotStyle = { clipPath: 'polygon(50% 25%, 60% 10%, 75% 5%, 90% 10%, 100% 25%, 100% 42%, 85% 60%, 65% 78%, 50% 100%, 35% 78%, 15% 60%, 0% 42%, 0% 25%, 10% 10%, 25% 5%, 40% 10%)' };
    } else if (shape === 'star') {
      // 修正後：カスタム配置と同じ高精度な星の形
      slotStyle = { clipPath: 'polygon(50% 0%, 61.8% 35.4%, 98.1% 34.5%, 69.1% 57.3%, 79.4% 90.5%, 50% 70%, 20.6% 90.5%, 30.9% 57.3%, 1.9% 34.5%, 38.2% 35.4%)' };
    }

    return {
      id: `rs${i + 1}`,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      style: slotStyle,
    };
  });
}

// ===== Canvas上のclip-path CSS生成 =====
// CropModalのgetCroppedImgと同じ形状をCSS clip-pathで再現
function getClipPathStyle(shape: ClipShape): React.CSSProperties {
  if (shape === 'heart') {
    // CropModalのbezierCurveToと同じ形状をpolygon近似で表現
    return {
      clipPath: 'polygon(50% 25%, 60% 10%, 75% 5%, 90% 10%, 100% 25%, 100% 42%, 85% 60%, 65% 78%, 50% 100%, 35% 78%, 15% 60%, 0% 42%, 0% 25%, 10% 10%, 25% 5%, 40% 10%)',
    };
  }
  if (shape === 'star') {
    return {
      clipPath: 'polygon(50% 0%, 61.8% 35.4%, 98.1% 34.5%, 69.1% 57.3%, 79.4% 90.5%, 50% 70%, 20.6% 90.5%, 30.9% 57.3%, 1.9% 34.5%, 38.2% 35.4%)',
    };
  }
  if (shape === 'bubble') {
    return {
      clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 35% 75%, 20% 100%, 20% 75%, 0% 75%)',
    };
  }
  return {};
}

// ===== Preview Modal =====
function PreviewModal({ dataUrl, onClose }: { dataUrl: string; onClose: () => void }) {
  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={e => e.stopPropagation()}>
        <img src={dataUrl} alt="preview" className="preview-img" />
        <div className="preview-actions">
          <a href={dataUrl} download={`colabam-${Date.now()}.jpg`} className="preview-btn save">
            📥 画像を保存
          </a>
          <button className="preview-btn close" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ===== Rotate Handle =====
interface RotateHandleProps {
  itemId: string;
  itemX: number;
  itemY: number;
  itemW: number;
  itemH: number;
  rotation: number;
  onRotate: (id: string, newRotation: number) => void;
}

function RotateHandle({ itemId, itemX, itemY, itemW, itemH, rotation, onRotate }: RotateHandleProps) {
  const isDragging = useRef(false);
  const startAngleOffset = useRef(0); // 追加：開始時の角度差分を保存

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // 1. ハンドルを掴んだ瞬間のマウスの角度を計算
    const handle = e.target as HTMLElement;
    const canvas = handle.closest('.album-canvas') as HTMLElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + itemX + itemW / 2;
    const cy = rect.top + itemY + itemH / 2;
    
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const clickAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // 2. 現在のアイテムの回転角との「差」を保存しておく
    startAngleOffset.current = clickAngle - rotation;

    const onMove = (moveEvent: PointerEvent) => {
      if (!isDragging.current) return;

      const mdx = moveEvent.clientX - cx;
      const mdy = moveEvent.clientY - cy;
      const currentMouseAngle = Math.atan2(mdy, mdx) * (180 / Math.PI);
      
      // 3. マウスの移動角度から初期の差分を引くことで、スムーズに回転を開始させる
      const newAngle = currentMouseAngle - startAngleOffset.current;
      onRotate(itemId, Math.round(newAngle));
    };

    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [itemId, itemX, itemY, itemW, itemH, rotation, onRotate]); // rotationを依存配列に追加

  return (
    <div
      className="rotate-handle"
      onPointerDown={handlePointerDown}
      title="ドラッグで回転"
    >
      {/* SVG内容はそのまま */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      </svg>
    </div>
  );
}

// ===== Background helpers =====
type BgState = {
  color: string;
  color2: string;
  pattern: string;
  patternType: string;
  gradientDir: string;
  bgImage?: string; // 背景画像URL（設定時はこちらが優先）
};

function getCanvasBgStyle(bg: BgState): React.CSSProperties {
  if (bg.bgImage) {
    return {
      backgroundImage: `url(${bg.bgImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (bg.patternType === 'gradient') {
    return { background: `linear-gradient(${bg.gradientDir}, ${bg.color}, ${bg.color2})` };
  }
  return { backgroundColor: bg.color };
}

// SVGパターンをキャンバス全面に重ねるコンポーネント
function BgPatternSvg({ patternType, color, color2, width, height }: {
  patternType: string; color: string; color2: string; width: number; height: number;
}) {
  const id = `pat-${patternType}`;
  let patternEl: React.ReactNode = null;
  let patternW = 20, patternH = 20;

  if (patternType === 'checker') {
    patternW = 24; patternH = 24;
    patternEl = (
      <>
        <rect width={patternW} height={patternH} fill={color} />
        <rect width={patternW / 2} height={patternH / 2} fill={color2} />
        <rect x={patternW / 2} y={patternH / 2} width={patternW / 2} height={patternH / 2} fill={color2} />
      </>
    );
  } else if (patternType === 'dots') {
    patternW = 20; patternH = 20;
    patternEl = (
      <>
        <rect width={patternW} height={patternH} fill={color} />
        <circle cx={patternW / 2} cy={patternH / 2} r={4} fill={color2} />
      </>
    );
  } else if (patternType === 'stripe-v') {
    patternW = 16; patternH = 16;
    patternEl = (
      <>
        <rect width={patternW} height={patternH} fill={color} />
        <rect width={patternW / 2} height={patternH} fill={color2} />
      </>
    );
  } else if (patternType === 'stripe-h') {
    patternW = 16; patternH = 16;
    patternEl = (
      <>
        <rect width={patternW} height={patternH} fill={color} />
        <rect width={patternW} height={patternH / 2} fill={color2} />
      </>
    );
  } else if (patternType === 'stars') {
    patternW = 40; patternH = 40;
    patternEl = (
      <>
        <rect width={patternW} height={patternH} fill={color} />
        <text x={patternW / 2} y={patternH / 2} textAnchor="middle" dominantBaseline="middle" fontSize="18" fill={color2} opacity="0.85">★</text>
      </>
    );
  }

  if (!patternEl) return null;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
    >
      <defs>
        <pattern id={id} x="0" y="0" width={patternW} height={patternH} patternUnits="userSpaceOnUse">
          {patternEl}
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${id})`} />
    </svg>
  );
}

// ===== 背景パターン定義 =====
const PATTERN_DEFS = [
  { id: 'solid',    label: '無地',   icon: '■' },
  { id: 'checker',  label: '格子',   icon: '⊞' },
  { id: 'dots',     label: '水玉',   icon: '●' },
  { id: 'stripe-v', label: '縦縞',   icon: '❙❙' },
  { id: 'stripe-h', label: '横縞',   icon: '☰' },
  { id: 'stars',    label: '星ﾄﾞｯﾄ', icon: '★' },
  { id: 'gradient', label: 'グラデ', icon: '▣' },
];

const GRAD_DIRS = [
  { value: 'to bottom',      label: '↓' },
  { value: 'to right',       label: '→' },
  { value: '135deg',         label: '↘' },
  { value: '45deg',          label: '↗' },
];

const PRESET_COLORS = [
  '#ffffff', '#f8bbd0', '#fce4ec', '#fff3e0', '#fffde7',
  '#e8f5e9', '#e3f2fd', '#ede7f6', '#ffd6e7', '#d1fae5',
  '#f26b9a', '#e91e8c', '#ff6b6b',
  '#ffa726', '#ffee58', '#66bb6a', '#26c6da', '#5c6bc0',
  '#ab47bc', '#8d6e63', '#333333', '#555555', '#888888',
  '#bbbbbb', '#000000',
];

// ===== 背景画像リスト =====
// シリーズごとに管理。画像を追加する場合は files 配列に追加するだけ。
interface BgSeries {
  id: string;
  label: string;
  files: string[];
}

const BG_SERIES: BgSeries[] = [
  {
    id: 's1',
    label: 'シリーズ1',
    files: Array.from({ length: 12 }, (_, i) => `/colabam_bimg${101 + i}.jpg`),
  },
  {
    id: 's2',
    label: 'シリーズ2',
    files: Array.from({ length: 12 }, (_, i) => `/colabam_bimg${201 + i}.jpg`),
  },
  {
    id: 's3',
    label: 'シリーズ3',
    files: Array.from({ length: 12 }, (_, i) => `/colabam_bimg${301 + i}.jpg`),
  },
];

// ===== スタンプ画像定義 =====
// カテゴリーを追加する場合は STAMP_CATEGORIES と STAMP_FILES を編集してください。
// 画像ファイルは public/stamps/with-bg/ または public/stamps/no-bg/ に配置してください。
type StampCategory = 'with-bg' | 'no-bg';

interface StampCategoryDef {
  id: StampCategory;
  label: string;
}

const STAMP_CATEGORIES: StampCategoryDef[] = [
  { id: 'with-bg', label: '背景あり' },
  { id: 'no-bg',   label: '背景なし' },
];

// ファイルを追加するときはここに追記するだけでOK
const STAMP_FILES: Record<StampCategory, string[]> = {
  'with-bg': Array.from({ length: 12 }, (_, i) =>
    `/stamps/with-bg/colabammojiimg${String(i + 1).padStart(3, '0')}.jpg`
  ),
  'no-bg': Array.from({ length: 12 }, (_, i) =>
    `/stamps/no-bg/colabammojitouka${String(i + 1).padStart(3, '0')}.png`
  ),
};

// ===== スタンプメニューコンポーネント =====
function StampMenu({ onAdd }: { onAdd: (url: string) => void }) {
  const [activeCategory, setActiveCategory] = useState<StampCategory>('with-bg');
  const files = STAMP_FILES[activeCategory];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
      {/* カテゴリータブ */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {STAMP_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              flex: 1, padding: '3px 0', borderRadius: 6,
              border: `2px solid ${activeCategory === cat.id ? 'var(--primary)' : '#ddd'}`,
              background: activeCategory === cat.id ? '#fff0f5' : 'white',
              cursor: 'pointer', fontSize: 11,
              fontWeight: activeCategory === cat.id ? 'bold' : 'normal',
              color: activeCategory === cat.id ? 'var(--primary)' : '#555',
            }}
          >{cat.label}</button>
        ))}
      </div>

      {/* スタンプ画像グリッド */}
      {files.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#aaa', fontSize: 12 }}>
          画像を追加してください<br />
          <code style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>
            public/stamps/{activeCategory}/
          </code>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, overflowY: 'auto', paddingBottom: 4 }}>
          {files.map((src, i) => (
            <button
              key={src}
              onClick={() => onAdd(src)}
              style={{
                width: 52, height: 52, borderRadius: 8, padding: 2,
                border: '1px solid #eee', background: 'white',
                cursor: 'pointer', flexShrink: 0, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <img
                src={src}
                alt={`スタンプ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 背景画像タブ（シリーズ切替） =====
function ImageBgTab({ canvasBg, setCanvasBg }: {
  canvasBg: BgState;
  setCanvasBg: React.Dispatch<React.SetStateAction<BgState>>;
}) {
  const [activeSeries, setActiveSeries] = useState<string>(BG_SERIES[0].id);
  const series = BG_SERIES.find(s => s.id === activeSeries) ?? BG_SERIES[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      {/* シリーズ切替タブ */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {/* 画像なしボタン */}
        <button
          onClick={() => setCanvasBg(prev => ({ ...prev, bgImage: undefined }))}
          style={{
            padding: '2px 8px', borderRadius: 6, border: `2px solid ${!canvasBg.bgImage ? 'var(--primary)' : '#ddd'}`,
            background: !canvasBg.bgImage ? '#fff0f5' : 'white',
            cursor: 'pointer', fontSize: 10, color: !canvasBg.bgImage ? 'var(--primary)' : '#888',
            fontWeight: !canvasBg.bgImage ? 'bold' : 'normal', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >✕ なし</button>
        {/* シリーズタブ */}
        {BG_SERIES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSeries(s.id)}
            style={{
              flex: 1, padding: '2px 4px', borderRadius: 6,
              border: `2px solid ${activeSeries === s.id ? 'var(--primary)' : '#ddd'}`,
              background: activeSeries === s.id ? '#fff0f5' : 'white',
              cursor: 'pointer', fontSize: 10,
              color: activeSeries === s.id ? 'var(--primary)' : '#555',
              fontWeight: activeSeries === s.id ? 'bold' : 'normal',
            }}
          >{s.label}</button>
        ))}
      </div>
      {/* サムネイル横スクロール */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {series.files.map((src, i) => (
          <button
            key={src}
            onClick={() => setCanvasBg(prev => ({ ...prev, bgImage: src }))}
            style={{
              flexShrink: 0, width: 56, height: 56, borderRadius: 8, padding: 0, overflow: 'hidden',
              border: `2px solid ${canvasBg.bgImage === src ? 'var(--primary)' : '#ddd'}`,
              cursor: 'pointer',
              boxShadow: canvasBg.bgImage === src ? '0 0 0 2px var(--primary)' : 'none',
            }}
          >
            <img
              src={src}
              alt={`背景${i + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function BgMenu({ canvasBg, setCanvasBg }: {
  canvasBg: BgState;
  setCanvasBg: React.Dispatch<React.SetStateAction<BgState>>;
}) {
  const [colorTarget, setColorTarget] = useState<'primary' | 'secondary'>('primary');
  const [bgTab, setBgTab] = useState<'color' | 'image'>('image');

  const currentColor = colorTarget === 'primary' ? canvasBg.color : canvasBg.color2;
  const setColor = (c: string) => {
    setCanvasBg(prev => colorTarget === 'primary' ? { ...prev, color: c, bgImage: undefined } : { ...prev, color2: c });
  };

  const needsColor2 = canvasBg.patternType !== 'solid';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* タブ切替：背景画像 / カラー */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => setBgTab('image')}
          style={{
            flex: 1, padding: '3px 0', borderRadius: 6, border: `2px solid ${bgTab === 'image' ? 'var(--primary)' : '#ddd'}`,
            background: bgTab === 'image' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: bgTab === 'image' ? 'bold' : 'normal', color: bgTab === 'image' ? 'var(--primary)' : '#555',
          }}
        >🖼️ イラスト</button>
        <button
          onClick={() => setBgTab('color')}
          style={{
            flex: 1, padding: '3px 0', borderRadius: 6, border: `2px solid ${bgTab === 'color' ? 'var(--primary)' : '#ddd'}`,
            background: bgTab === 'color' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: bgTab === 'color' ? 'bold' : 'normal', color: bgTab === 'color' ? 'var(--primary)' : '#555',
          }}
        >🎨 カラー</button>
      </div>

      {bgTab === 'color' && (
        <>
          {/* パターン選択 */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flexShrink: 0, justifyContent: 'center' }}>
            {PATTERN_DEFS.map(p => (
              <button
                key={p.id}
                onClick={() => setCanvasBg(prev => ({ ...prev, patternType: p.id, pattern: 'none', bgImage: undefined }))}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  border: `2px solid ${canvasBg.patternType === p.id && !canvasBg.bgImage ? 'var(--primary)' : '#ddd'}`,
                  borderRadius: 8, background: canvasBg.patternType === p.id && !canvasBg.bgImage ? '#fff0f5' : 'white',
                  padding: '3px 6px', cursor: 'pointer', minWidth: 40, flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{p.icon}</span>
                <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>{p.label}</span>
              </button>
            ))}
          </div>

          {/* グラデーション方向 */}
          {canvasBg.patternType === 'gradient' && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>方向:</span>
              {GRAD_DIRS.map(d => (
                <button
                  key={d.value}
                  onClick={() => setCanvasBg(prev => ({ ...prev, gradientDir: d.value }))}
                  style={{
                    width: 30, height: 24, border: `2px solid ${canvasBg.gradientDir === d.value ? 'var(--primary)' : '#ddd'}`,
                    borderRadius: 5, background: canvasBg.gradientDir === d.value ? '#fff0f5' : 'white',
                    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >{d.label}</button>
              ))}
            </div>
          )}

          {/* カラーターゲット切替（無地以外） */}
          {needsColor2 && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
              <button
                onClick={() => setColorTarget('primary')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 6, border: `2px solid ${colorTarget === 'primary' ? 'var(--primary)' : '#ddd'}`,
                  background: colorTarget === 'primary' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11,
                }}
              >
                <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: canvasBg.color, border: '1px solid #ccc' }} />
                {canvasBg.patternType === 'gradient' ? '開始色' : '背景色'}
              </button>
              <button
                onClick={() => setColorTarget('secondary')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 6, border: `2px solid ${colorTarget === 'secondary' ? 'var(--primary)' : '#ddd'}`,
                  background: colorTarget === 'secondary' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11,
                }}
              >
                <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: canvasBg.color2, border: '1px solid #ccc' }} />
                {canvasBg.patternType === 'gradient' ? '終了色' : '模様色'}
              </button>
            </div>
          )}

          {/* カラーパレット */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 24px)', gap: 5, flexShrink: 0, justifyContent: 'center' }}>
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: 4, border: `2px solid ${currentColor === c ? 'var(--primary)' : '#ccc'}`,
                  background: c, cursor: 'pointer', padding: 0,
                  transform: currentColor === c ? 'scale(1.2)' : 'scale(1)',
                  transition: 'transform 0.1s',
                  flexShrink: 0,
                }}
              />
            ))}
            {/* カスタム色入力 */}
            <label style={{ width: 24, height: 24, borderRadius: 4, border: '2px solid #ccc', overflow: 'hidden', cursor: 'pointer', flexShrink: 0 }}>
              <input type="color" value={currentColor} onChange={e => setColor(e.target.value)}
                style={{ width: 30, height: 30, border: 'none', padding: 0, marginTop: -3, marginLeft: -3, cursor: 'pointer' }} />
            </label>
          </div>
        </>
      )}

      {bgTab === 'image' && (
        <ImageBgTab canvasBg={canvasBg} setCanvasBg={setCanvasBg} />
      )}
    </div>
  );
}

// ===== Main App =====
export default function App() {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [history, setHistory] = useState<CanvasItem[][]>([]);
  const [templateSlots, setTemplateSlots] = useState<SlotData[]>([]);
  const [activeMainTab, setActiveMainTab] = useState<MainTab | null>(null);
  // ===== Background State =====
  // patternType: 'solid' | 'checker' | 'dots' | 'stripe-v' | 'stripe-h' | 'stars' | 'gradient'
  const [canvasBg, setCanvasBg] = useState<{
    color: string;
    color2: string;        // セカンダリカラー（格子・水玉・ストライプの模様色、グラデーション終点色）
    pattern: string;       // legacy 'checker' など
    patternType: string;   // 新しいパターン種別
    gradientDir: string;   // グラデーション方向 'to bottom' | 'to right' | '135deg' etc.
    bgImage?: string;      // 背景画像URL（設定時はこちらが優先）
  }>({ color: '#fffbe6', color2: '#f26b9a', pattern: 'none', patternType: 'solid', gradientDir: 'to bottom', bgImage: undefined });
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [cropInitialShape, setCropInitialShape] = useState<'square' | 'rectangle' | 'rectangle-h' | 'circle' | 'ellipse' | 'ellipse-h' | 'heart' | 'star' | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customPicking, setCustomPicking] = useState(false);
  const [customSelected, setCustomSelected] = useState<CustomSlotShape[]>([]);

  const [inputText, setInputText] = useState('');
  const [textColor, setTextColor] = useState('#333333');
  const [fontSize, setFontSize] = useState(24);
  const [textStyle, setTextStyle] = useState<TextStyleId>('normal');

  // 写真サブメニュー用state
  const [photoSubMenuId, setPhotoSubMenuId] = useState<string | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [retrimTargetId, setRetrimTargetId] = useState<string | null>(null);

  // 写真ストック（複数枚事前選択）
  const [photoStock, setPhotoStock] = useState<string[]>([]);
  // 写真追加サブメニューの表示
  const [showPhotoAddMenu, setShowPhotoAddMenu] = useState(false);
  const photoAddMenuRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const maxZIndex = useRef(10);

  const pushHistory = (current: CanvasItem[]) => {
    setHistory(prev => [...prev.slice(-19), current]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setItems(prev);
    setHistory(h => h.slice(0, -1));
  };

  const addItem = (type: ItemType, content?: string, extra?: Partial<CanvasItem>) => {
    maxZIndex.current += 1;

    const defaultW = type === 'text' ? 200 : type === 'stamp' ? 320 : 120;
    const defaultH = type === 'text' ? 60 : type === 'stamp' ? 95 : 120;
    const w = extra?.width ?? defaultW;
    const h = extra?.height ?? defaultH;

    // スタンプはキャンバス中央上部に配置（画像の添付例に合わせた位置）
    // 既にスタンプがその付近にある場合は少し下にずらす
    const STAGGER_STEP = 30; // ずらす量(px)
    const BASE_Y_STAMP = Math.round(CANVAS_H * 0.12); // キャンバス高さの12%（上寄り中央）

    let defaultX = 50;
    let defaultY = 50;

    if (type === 'stamp') {
      defaultX = Math.round((CANVAS_W - w) / 2);
      defaultY = BASE_Y_STAMP;

      // 既存スタンプがこの付近にある場合、重ならないようにずらす
      const THRESHOLD = 40;
      let staggerCount = 0;
      for (const existing of items) {
        if (existing.type === 'stamp') {
          const targetY = BASE_Y_STAMP + staggerCount * STAGGER_STEP;
          if (Math.abs(existing.y - targetY) < THRESHOLD && Math.abs(existing.x - defaultX) < THRESHOLD) {
            staggerCount += 1;
          }
        }
      }
      defaultY = BASE_Y_STAMP + staggerCount * STAGGER_STEP;
    }

    const newItem: CanvasItem = {
      id: `${type}-${Date.now()}`,
      type,
      content,
      x: defaultX,
      y: defaultY,
      width: w,
      height: h,
      rotation: 0,
      zIndex: maxZIndex.current,
      ...extra,
    };
    pushHistory(items);
    setItems(prev => [...prev, newItem]);
  };

  const confirmAndApply = (action: () => void) => {
    const hasPhotos = items.some(i => i.type === 'photo');
    if (templateSlots.length > 0 || hasPhotos) {
      if (!window.confirm('写真枠の配置をやり直します。これまでの写真だけ消えますが、スタンプ・テキストは残ります。実行しますか？')) return;
    }
    action();
  };

  const applyCustomSlots = () => {
    if (customSelected.length < 1) return;
    confirmAndApply(() => {
      pushHistory(items);
      setItems(prev => prev.filter(i => i.type !== 'photo'));
      setTemplateSlots(buildCustomSlots(customSelected));
      setCustomPicking(false);
      setCustomSelected([]);
      setActiveMainTab(null);
    });
  };

  const handleCustomShapeClick = (shape: CustomSlotShape) => {
    if (customSelected.length < 6) {
      setCustomSelected(prev => [...prev, shape]);
    }
  };

  // 修正箇所：関数を正しく定義
  const applyTemplate = (template: TemplateData) => {
    confirmAndApply(() => {
      pushHistory(items);
      setItems(prev => prev.filter(i => i.type !== 'photo'));
      setTemplateSlots(template.slots.map(s => ({ ...s })));
      if (template.bg) setCanvasBg(prev => ({ ...prev, color: template.bg! }));
    });
  };

  const clearCanvas = () => {
    pushHistory(items);
    setItems([]);
    setTemplateSlots([]);
    setCanvasBg({ color: '#fffbe6', color2: '#f26b9a', pattern: 'none', patternType: 'solid', gradientDir: 'to bottom', bgImage: undefined });
  };

  // アップロード時の元画像URLを一時保持するref（クロップ完了時にCanvasItemへ渡す）
  const pendingOriginalUrl = useRef<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      pendingOriginalUrl.current = url; // 元画像を保存
      setCropImageUrl(url);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropComplete = (croppedDataUrl: string, _shapeStyle: React.CSSProperties, cropShape?: string) => {
    const clipShape = (cropShape === 'heart' || cropShape === 'star' || cropShape === 'bubble')
      ? cropShape as ClipShape
      : undefined;

    if (targetSlotId === '__replace__' && replaceTargetId) {
      // 写真を差し替え（サイズ・位置・zIndexは維持、元画像も更新）
      const originalUrl = pendingOriginalUrl.current ?? undefined;
      pushHistory(items);
      setItems(prev => prev.map(i =>
        i.id === replaceTargetId
          ? { ...i, content: croppedDataUrl, clipShape, ...(originalUrl ? { originalImageUrl: originalUrl } : {}) }
          : i
      ));
      setReplaceTargetId(null);
      setCropImageUrl(null);
      setTargetSlotId(null);
      pendingOriginalUrl.current = null;
      return;
    }

    if (targetSlotId === '__retrim__' && retrimTargetId) {
      // スキミングやり直し（元画像URLはそのまま維持）
      pushHistory(items);
      setItems(prev => prev.map(i =>
        i.id === retrimTargetId
          ? { ...i, content: croppedDataUrl, clipShape }
          : i
      ));
      setRetrimTargetId(null);
      setCropImageUrl(null);
      setTargetSlotId(null);
      pendingOriginalUrl.current = null;
      return;
    }

    const originalUrl = pendingOriginalUrl.current ?? undefined;

    if (targetSlotId) {
      const slot = templateSlots.find(s => s.id === targetSlotId);
      if (slot) {
        maxZIndex.current += 1;
        const newItem: CanvasItem = {
          id: `photo-slot-${targetSlotId}-${Date.now()}`,
          type: 'photo',
          content: croppedDataUrl,
          originalImageUrl: originalUrl, // 元画像を保存
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          rotation: slot.rotation ?? 0,
          zIndex: maxZIndex.current,
          clipShape,
        };
        pushHistory(items);
        setItems(prev => [...prev, newItem]);
        setTemplateSlots(prev => prev.filter(s => s.id !== targetSlotId));
      }
    } else {
      addItem('photo', croppedDataUrl, { clipShape, originalImageUrl: originalUrl });
    }
    setCropImageUrl(null);
    setTargetSlotId(null);
    pendingOriginalUrl.current = null;
  };

  const saveAlbum = async () => {
    setSelectedId(null);
    await new Promise(r => setTimeout(r, 50));
    if (!canvasRef.current) return;
    const scale = EXPORT_W / CANVAS_W;
    const canvas = await html2canvas(canvasRef.current, {
      useCORS: true,
      scale,
      width: CANVAS_W,
      height: CANVAS_H,
    });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setPreviewUrl(dataUrl);
  };

  const handleSlotClick = (slotId: string) => {
    setTargetSlotId(slotId);
    const slot = templateSlots.find(s => s.id === slotId);
    const style = slot?.style ?? {};
    const ratio = slot ? slot.width / slot.height : 1;

    // clipPath で形状判定
    const clipPath = (style as React.CSSProperties).clipPath as string | undefined;
    // borderRadius で円系判定
    const isRound = (style as React.CSSProperties).borderRadius === '50%';

    let shape: typeof cropInitialShape = undefined;

    if (clipPath?.includes('50% 15%') || clipPath?.includes('50% 25%') || clipPath?.includes('50% 0%, 80%')) {
      // ハート判定（buildRandomSlots / buildCustomSlots 両方に対応）
      shape = 'heart';
    } else if (clipPath?.includes('61% 35%') || clipPath?.includes('61.8%') || clipPath?.includes('50% 0%, 61%')) {
      // 星判定（buildRandomSlots / buildCustomSlots 両方に対応）
      shape = 'star';
    } else if (isRound) {
      // 円 or 楕円（アスペクト比で区別）
      if (ratio > 1.15) {
        shape = 'ellipse-h'; // 横長楕円
      } else if (ratio < 0.85) {
        shape = 'ellipse';   // 縦長楕円
      } else {
        shape = 'circle';    // 正円
      }
    } else {
      // 四角系（アスペクト比で区別）
      if (ratio > 1.15) {
        shape = 'rectangle-h'; // 横長方形
      } else if (ratio < 0.85) {
        shape = 'rectangle';   // 縦長方形
      } else {
        shape = 'square';      // 正方形
      }
    }

    setCropInitialShape(shape);
    document.getElementById('photo-upload')?.click();
  };

  const handleItemRotate = useCallback((id: string, newRotation: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, rotation: newRotation } : i));
  }, []);

  const handleDeleteItem = (id: string) => {
    pushHistory(items);
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedId(null);
    setPhotoSubMenuId(null);
  };

  const handleBringToFront = (id: string) => {
    const maxZ = Math.max(...items.map(i => i.zIndex), maxZIndex.current) + 1;
    maxZIndex.current = maxZ;
    setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: maxZ } : i));
    setPhotoSubMenuId(null);
  };

  const handleSendToBack = (id: string) => {
    const minZ = Math.min(...items.map(i => i.zIndex)) - 1;
    setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: minZ } : i));
    setPhotoSubMenuId(null);
  };

  const handleReplacePhoto = (id: string) => {
    setReplaceTargetId(id);
    setPhotoSubMenuId(null);
    document.getElementById('photo-replace-upload')?.click();
  };

  const handleReplaceFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replaceTargetId) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const item = items.find(i => i.id === replaceTargetId);
      if (!item) return;
      const url = ev.target?.result as string;
      pendingOriginalUrl.current = url; // 差し替え時も元画像を保存
      // 元のアイテムのサイズ・形状でクロップモーダルを開く
      const ratio = item.width / item.height;
      let shape: typeof cropInitialShape = undefined;
      if (item.clipShape === 'heart') shape = 'heart';
      else if (item.clipShape === 'star') shape = 'star';
      else if (ratio > 1.15) shape = 'rectangle-h';
      else if (ratio < 0.85) shape = 'rectangle';
      else shape = 'square';
      setCropInitialShape(shape);
      setCropImageUrl(url);
      setTargetSlotId('__replace__');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetrimPhoto = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item || !item.content) return;
    setRetrimTargetId(id);
    setPhotoSubMenuId(null);
    const ratio = item.width / item.height;
    let shape: typeof cropInitialShape = undefined;
    if (item.clipShape === 'heart') shape = 'heart';
    else if (item.clipShape === 'star') shape = 'star';
    else if (ratio > 1.15) shape = 'rectangle-h';
    else if (ratio < 0.85) shape = 'rectangle';
    else shape = 'square';
    setCropInitialShape(shape);
    // 元画像があればそちらを使う（より広い範囲でスキミングし直せる）
    setCropImageUrl(item.originalImageUrl ?? item.content);
    setTargetSlotId('__retrim__');
  };

  // ストックへ複数枚追加
  const handleStockFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const readers = files.map(file => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string);
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(urls => {
      setPhotoStock(prev => [...prev, ...urls]);
    });
    e.target.value = '';
    setShowPhotoAddMenu(false);
  };

  // 枠を全部埋める（ストックからランダム）
  const handleFillAllSlots = () => {
    if (photoStock.length === 0) {
      alert('先に「写真をストックに追加」で写真を選んでください。');
      return;
    }
    if (templateSlots.length === 0) {
      alert('写真枠がありません。先に「写真枠配置」から枠を配置してください。');
      return;
    }
    pushHistory(items);
    const shuffled = [...photoStock].sort(() => Math.random() - 0.5);
    const newItems: CanvasItem[] = templateSlots.map((slot, i) => {
      const imgUrl = shuffled[i % shuffled.length];
      maxZIndex.current += 1;
      return {
        id: `photo-slot-${slot.id}-${Date.now()}-${i}`,
        type: 'photo' as ItemType,
        content: imgUrl,
        originalImageUrl: imgUrl,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        rotation: slot.rotation ?? 0,
        zIndex: maxZIndex.current,
        clipShape: undefined,
      };
    });
    setItems(prev => [...prev, ...newItems]);
    setTemplateSlots([]);
    setShowPhotoAddMenu(false);
  };

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let prevAngle: number | null = null;

    const getAngle = (t1: Touch, t2: Touch) =>
      Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && selectedIdRef.current) {
        prevAngle = getAngle(e.touches[0], e.touches[1]);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || prevAngle === null || !selectedIdRef.current) return;
      const currentAngle = getAngle(e.touches[0], e.touches[1]);
      const delta = currentAngle - prevAngle;
      prevAngle = currentAngle;
      const id = selectedIdRef.current;
      setItems(prev => prev.map(i =>
        i.id === id ? { ...i, rotation: i.rotation + delta } : i
      ));
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) prevAngle = null;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const handleTabToggle = (tab: MainTab) => {
    setShowPhotoAddMenu(false);
    setActiveMainTab(prev => prev === tab ? null : tab);
  };

  const renderSubMenu = () => {
    switch (activeMainTab) {
      case 'template':
        if (customPicking) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#888' }}>
                  枠を選択してください（{customSelected.length}/6）
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setCustomSelected(prev => prev.slice(0, -1))}
                    disabled={customSelected.length === 0}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', color: '#555' }}
                  >戻す</button>
                  <button
                    onClick={applyCustomSlots}
                    disabled={customSelected.length < 1}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none', background: customSelected.length >= 1 ? 'var(--primary)' : '#ccc', color: 'white', cursor: customSelected.length >= 1 ? 'pointer' : 'default', fontWeight: 'bold' }}
                  >決定</button>
                  <button
                    onClick={() => { setCustomPicking(false); setCustomSelected([]); }}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', color: '#555' }}
                  >キャンセル</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {CUSTOM_SLOT_OPTIONS.map(opt => (
                    <button
                      key={opt.shape}
                      onClick={() => handleCustomShapeClick(opt.shape)}
                      disabled={customSelected.length >= 6}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        background: 'none', border: 'none', cursor: customSelected.length < 6 ? 'pointer' : 'default',
                        padding: '4px 2px', minWidth: 44,
                      }}
                    >
                      <div style={{
                        width: 48, height: 48,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid #ddd', borderRadius: 8, background: 'white',
                      }}>
                        <div style={{ background: '#aaa', ...opt.thumbStyle }} />
                      </div>
                      <span style={{ fontSize: 10, color: '#555' }}>{opt.label}</span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center' }}>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const s = customSelected[i];
                    const opt = s ? CUSTOM_SLOT_OPTIONS.find(o => o.shape === s) : null;
                    return (
                      <div key={i} style={{
                        width: 26, height: 26,
                        border: `1.5px ${s ? 'solid #f26b9a' : 'dashed #ccc'}`,
                        borderRadius: 5,
                        background: s ? '#fff5f8' : '#fafafa',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, color: '#f26b9a', fontWeight: 'bold',
                      }}>
                        {opt ? <div style={{ background: '#f26b9a', width: opt.thumbStyle.width, height: opt.thumbStyle.height, borderRadius: (opt.thumbStyle as React.CSSProperties).borderRadius, clipPath: (opt.thumbStyle as React.CSSProperties).clipPath, transform: 'scale(0.45)', transformOrigin: 'center', flexShrink: 0 }} /> : <span style={{ color: '#ccc' }}>{i + 1}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
}
  return (
    <div className="template-list">
      {TEMPLATES.map(t => (
        <div key={t.id} className="template-item" onClick={() => applyTemplate(t)}>
          <div className="template-thumb">
            {t.id === 'circle' ? (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* 左上の大きめの丸 */}
                <circle cx="9" cy="9" r="7" fill="currentColor" opacity="0.8" />
                {/* 右上の小さな丸 */}
                <circle cx="21" cy="7" r="4.5" fill="currentColor" opacity="0.6" />
                {/* 左下の小さな丸 */}
                <circle cx="6" cy="21" r="4.5" fill="currentColor" opacity="0.6" />
                {/* 右下の大きめの丸 */}
                <circle cx="19" cy="19" r="7" fill="currentColor" opacity="0.8" />
              </svg>
            ) : (
              <LayoutTemplate size={26} />
            )}
          </div>
          <span>{t.name}</span>
        </div>
      ))}
            <div className="template-item" onClick={() => confirmAndApply(() => {
                pushHistory(items);
                setItems([]);
                setTemplateSlots(buildRandomSlots());
                setActiveMainTab(null);
              })}>
              <div className="template-thumb"><Shuffle size={26} /></div>
              <span>ランダム</span>
            </div>
            <div className="template-item" onClick={() => { setCustomPicking(true); setCustomSelected([]); }}>
              <div className="template-thumb"><Grid size={26} /></div>
              <span>カスタム</span>
            </div>
            <div className="template-item clear" onClick={() => {
                if (!window.confirm('写真枠をすべて消去します。これまでの写真枠が消えてしまいますが実行しますか？')) return;
                clearCanvas();
              }}>
              <div className="template-thumb clear-thumb"><X size={26} color="#e05555" /></div>
              <span>枠全消去</span>
            </div>
          </div>
        );
      case 'text':
        return (
          <div className="text-menu-controls">
            <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="文字を入力..." className="text-input" />
            <div className="control-row">
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
              <input type="range" min="12" max="100" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} />
              <span style={{ fontSize: 12, minWidth: 30 }}>{fontSize}px</span>
              <button onClick={() => { if (inputText.trim()) { addItem('text', inputText, { color: textColor, fontSize, textStyle }); setInputText(''); } }} className="add-btn">追加</button>
            </div>
            <div className="text-style-row">
              {TEXT_STYLES.map(ts => (
                <button
                  key={ts.id}
                  className={`text-style-btn ${textStyle === ts.id ? 'active' : ''}`}
                  onClick={() => setTextStyle(ts.id)}
                >
                  <span
                    className="text-style-preview"
                    style={ts.id === 'shadow' ? { textShadow: '2px 2px 4px rgba(0,0,0,0.55)', color: '#c44' }
                      : ts.id === 'outline' ? { WebkitTextStroke: '1px #333', color: '#fff', textShadow: 'none' } as React.CSSProperties
                      : ts.id === 'outline-shadow' ? { WebkitTextStroke: '1px #333', textShadow: '1px 2px 3px rgba(0,0,0,0.4)', color: '#fff' } as React.CSSProperties
                      : ts.id === 'neon' ? { textShadow: '0 0 6px #f0f, 0 0 14px #f0f', color: '#f0f' }
                      : ts.id === 'emboss' ? { textShadow: '-1px -1px 0 rgba(255,255,255,0.7), 1px 1px 2px rgba(0,0,0,0.4)', color: '#c44' }
                      : ts.id === 'arch-up' ? { color: '#c44' }
                      : ts.id === 'arch-down' ? { color: '#44a' }
                      : ts.id === 'wave' ? { color: '#4a4' }
                      : { color: '#333' }}
                  >
                    {ts.id === 'arch-up' ? '⌢A' : ts.id === 'arch-down' ? '⌣A' : ts.id === 'wave' ? '∿A' : 'A'}
                  </span>
                  <span className="text-style-label">{ts.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      case 'stamp':
        return (
          <StampMenu
            onAdd={(url) => addItem('stamp', url, { width: 320, height: 95 })}
          />
        );
      case 'background':
        return <BgMenu canvasBg={canvasBg} setCanvasBg={setCanvasBg} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <button className="header-btn back-btn" onClick={undo} disabled={history.length === 0}>
          <Undo2 size={18} />
          <span>戻る</span>
        </button>
        <button className="header-btn save-btn" onClick={saveAlbum}>
          <Check size={18} />
          <span>保存</span>
        </button>
      </header>

      <main className="canvas-area" onClick={() => { setSelectedId(null); setPhotoSubMenuId(null); setActiveMainTab(null); setShowPhotoAddMenu(false); }}>
        <div
          ref={canvasRef}
          className="album-canvas"
          style={{ width: CANVAS_W, height: CANVAS_H, ...getCanvasBgStyle(canvasBg) }}
        >
          {/* SVGパターンオーバーレイ（格子・水玉・ストライプ・星） */}
          {!canvasBg.bgImage && canvasBg.patternType !== 'solid' && canvasBg.patternType !== 'gradient' && (
            <BgPatternSvg patternType={canvasBg.patternType} color={canvasBg.color} color2={canvasBg.color2} width={CANVAS_W} height={CANVAS_H} />
          )}
          {templateSlots.map(slot => (
            <div
              key={slot.id}
              className="template-slot"
              style={{
                position: 'absolute',
                left: slot.x, top: slot.y,
                width: slot.width, height: slot.height,
                transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
                ...slot.style,
              }}
              onClick={() => handleSlotClick(slot.id)}
            >
              <ImagePlus size={24} color="#bbb" />
            </div>
          ))}

          {items.map((item) => {
            const isSelected = selectedId === item.id;
            return (
              <Rnd
                key={item.id}
                size={{ width: item.width, height: item.height }}
                position={{ x: item.x, y: item.y }}
                onDragStart={(e) => {
                  e.stopPropagation();
                  setSelectedId(item.id);
                }}
                onDragStop={(_, d) => {
                  setItems(prev => prev.map(i => i.id === item.id ? { ...i, x: d.x, y: d.y } : i));
                }}
                onResizeStop={(_, __, ref, ___, pos) => {
                  setItems(prev => prev.map(i => i.id === item.id
                    ? { ...i, width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos }
                    : i
                  ));
                }}
                lockAspectRatio={item.type === 'photo' || item.type === 'stamp'}
                style={{ zIndex: item.zIndex }}
                dragHandleClassName="drag-handle"
                enableResizing={isSelected ? undefined : false}
                resizeHandleStyles={isSelected ? {
                  bottomRight: { display: 'none' },
                } : {}}
                resizeHandleComponent={isSelected ? {
                  topLeft: (
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        background: 'rgba(255,255,255,0.95)',
                        border: '2px solid #f26b9a',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'nw-resize',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                        position: 'absolute',
                        top: -2,
                        left: -2,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10 L2 2 L10 2" stroke="#f26b9a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M2 2 L6 6" stroke="#f26b9a" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                      </svg>
                    </div>
                  ),
                } : {}}
              >
                <div
                  className={`canvas-item-wrapper ${isSelected ? 'selected' : ''}`}
                  style={{
                    transform: `rotate(${item.rotation}deg)`,
                    ...(item.clipShape ? { background: 'transparent' } : {}),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(item.id);
                    if (item.type === 'photo') {
                      setPhotoSubMenuId(prev => prev === item.id ? null : item.id);
                    } else {
                      setPhotoSubMenuId(null);
                    }
                  }}
                >
                  {item.type === 'text' ? (
                    (() => {
                      const sid = item.textStyle;
                      const isSpecial = sid === 'arch-up' || sid === 'arch-down' || sid === 'wave';
                      if (isSpecial) {
                        return (
                          <div className="item-text drag-handle" style={{ padding: 0 }}>
                            <ArchText
                              text={item.content ?? ''}
                              color={item.color ?? '#333'}
                              fontSize={item.fontSize ?? 24}
                              styleId={sid!}
                              width={item.width}
                              height={item.height}
                            />
                          </div>
                        );
                      }
                      return (
                        <div
                          className="item-text drag-handle"
                          style={{ ...getTextCssStyle(sid, item.color ?? '#333333'), fontSize: `${item.fontSize}px` }}
                        >
                          {item.content}
                        </div>
                      );
                    })()
                  ) : item.type === 'stamp' ? (
                    <img
                      src={item.content}
                      className="item-photo drag-handle"
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <img
                      src={item.content}
                      className="item-photo drag-handle"
                      alt=""
                      style={item.clipShape ? getClipPathStyle(item.clipShape) : undefined}
                    />
                  )}
                </div>

                {isSelected && (
                  <button
                    className="item-delete"
                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onPointerUp={(e) => { e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                  >
                    <X size={12} />
                  </button>
                )}

                {/* 写真サブメニュー */}
                {isSelected && item.type === 'photo' && photoSubMenuId === item.id && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: item.height + 6,
                      zIndex: 9999,
                      background: 'rgba(30,30,30,0.93)',
                      borderRadius: 10,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                      overflow: 'hidden',
                      minWidth: 160,
                      transform: `rotate(${-item.rotation}deg)`,
                    }}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                  >
                    {[
                      {
                        label: '前面へ',
                        icon: '⬆',
                        desc: '最前面に移動',
                        onClick: () => handleBringToFront(item.id),
                      },
                      {
                        label: '背面へ',
                        icon: '⬇',
                        desc: '最背面に移動',
                        onClick: () => handleSendToBack(item.id),
                      },
                      {
                        label: 'スキミングする',
                        icon: '✂️',
                        desc: 'トリミングやり直し',
                        onClick: () => handleRetrimPhoto(item.id),
                      },
                      {
                        label: '写真を変更する',
                        icon: '🔄',
                        desc: '別の写真に差し替え',
                        onClick: () => handleReplacePhoto(item.id),
                      },
                    ].map((action, idx, arr) => (
                      <button
                        key={action.label}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); action.onClick(); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '10px 14px',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 16, minWidth: 22 }}>{action.icon}</span>
                        <span style={{ flex: 1 }}>{action.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {isSelected && (
                  <RotateHandle
                    itemId={item.id}
                    itemX={item.x}
                    itemY={item.y}
                    itemW={item.width}
                    itemH={item.height}
                    rotation={item.rotation}
                    onRotate={handleItemRotate}
                  />
                )}
              </Rnd>
            );
          })}
        </div>
      </main>

      <nav className="bottom-menu">
        {activeMainTab !== null && (
          <div className="sub-menu" style={
            activeMainTab === 'template' && customPicking ? { height: 180 }
            : activeMainTab === 'text' ? { height: 160 }
            : activeMainTab === 'background' ? { height: 205 }
            : undefined
          }>
            {renderSubMenu()}
          </div>
        )}
        <div className="main-tabs">
          <button className={`tab-btn ${activeMainTab === 'template' ? 'active' : ''}`} onClick={() => handleTabToggle('template')}>
            <LayoutTemplate size={20} /><span>写真枠配置</span>
          </button>
          <button className={`tab-btn ${activeMainTab === 'background' ? 'active' : ''}`} onClick={() => handleTabToggle('background')}>
            <Grid size={20} /><span>背景変更</span>
          </button>
          <div style={{ position: 'relative' }} ref={photoAddMenuRef}>
            <button
              className={`tab-btn ${showPhotoAddMenu ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowPhotoAddMenu(prev => !prev); setActiveMainTab(null); }}
            >
              <ImagePlus size={20} /><span>写真追加</span>
            </button>
            {showPhotoAddMenu && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 8,
                  background: 'rgba(30,30,30,0.96)',
                  borderRadius: 12,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                  overflow: 'hidden',
                  minWidth: 200,
                  zIndex: 9999,
                }}
              >
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => { setShowPhotoAddMenu(false); setTargetSlotId(null); document.getElementById('photo-upload')?.click(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 24 }}>📷</span>
                  <div>
                    <div>１枚追加</div>
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400 }}>写真を1枚選んで追加</div>
                  </div>
                </button>
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => { document.getElementById('photo-stock-upload')?.click(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 24 }}>🗂️</span>
                  <div>
                    <div>写真をストックに追加</div>
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400 }}>
                      {photoStock.length > 0 ? `現在${photoStock.length}枚ストック済み` : '複数枚まとめて選べます'}
                    </div>
                  </div>
                </button>
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => handleFillAllSlots()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '12px 16px',
                    background: photoStock.length > 0 && templateSlots.length > 0
                      ? 'rgba(242,107,154,0.18)' : 'transparent',
                    border: 'none',
                    borderBottom: photoStock.length > 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                    color: photoStock.length > 0 && templateSlots.length > 0 ? '#f26b9a' : '#666',
                    fontSize: 13, fontWeight: 600,
                    cursor: photoStock.length > 0 && templateSlots.length > 0 ? 'pointer' : 'default',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 24 }}>🎲</span>
                  <div>
                    <div>枠を全部埋める</div>
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400 }}>
                      {photoStock.length === 0
                        ? 'ストックに写真がありません'
                        : templateSlots.length === 0
                          ? '空き枠がありません'
                          : `ストック${photoStock.length}枚 → ${templateSlots.length}枠にランダム配置`}
                    </div>
                  </div>
                </button>
                {photoStock.length > 0 && (
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => { setPhotoStock([]); setShowPhotoAddMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 16px',
                      background: 'transparent', border: 'none',
                      color: '#ff7070', fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 16, minWidth: 24 }}>🗑️</span>
                    <div>ストックを全部消す（{photoStock.length}枚）</div>
                  </button>
                )}
              </div>
            )}
          </div>
          <button className={`tab-btn ${activeMainTab === 'stamp' ? 'active' : ''}`} onClick={() => handleTabToggle('stamp')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a5 5 0 0 1 5 5c0 2-1 3.5-2.5 4.5V13h-5v-1.5C8 10.5 7 9 7 7a5 5 0 0 1 5-5z"/>
              <rect x="7" y="13" width="10" height="3" rx="1"/>
              <rect x="5" y="16" width="14" height="3" rx="1"/>
            </svg>
            <span>スタンプ</span>
          </button>
          <button className={`tab-btn ${activeMainTab === 'text' ? 'active' : ''}`} onClick={() => handleTabToggle('text')}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <text x="1" y="17" fontSize="14" fontWeight="bold" fontFamily="serif" fill="currentColor">Aa</text>
            </svg>
            <span>テキスト</span>
          </button>
        </div>
      </nav>

      <input id="photo-upload" type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
      <input id="photo-replace-upload" type="file" accept="image/*" onChange={handleReplaceFileUpload} style={{ display: 'none' }} />
      <input id="photo-stock-upload" type="file" accept="image/*" multiple onChange={handleStockFileUpload} style={{ display: 'none' }} />

      {cropImageUrl && (
        <CropModal imageUrl={cropImageUrl} initialShape={cropInitialShape} onComplete={handleCropComplete} onCancel={() => { setCropImageUrl(null); setTargetSlotId(null); setCropInitialShape(undefined); }} />
      )}

      {previewUrl && (
        <PreviewModal dataUrl={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
    </div>
  );
}