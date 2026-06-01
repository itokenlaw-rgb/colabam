import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Check,
  Grid, ImagePlus, X, LayoutTemplate, Undo2, Shuffle,
} from 'lucide-react';
import CropModal from './CropModal';
import './index.css';

// ===== ストック写真の型 =====
interface StockPhoto {
  url: string;
  takenAt: Date | null; // Exifから取得した撮影日時（取得できない場合はnull）
  fileName: string;
}

// Exif から撮影日時を取得するユーティリティ
function extractExifDate(file: File): Promise<Date | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer;
        const view = new DataView(buf);
        // JPEGマジックナンバー確認
        if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset);
          offset += 2;
          if (marker === 0xFFE1) { // APP1 (Exif)
            offset += 2; // segLenの代わり。getUint16で2バイト分進んでいるため
            const exifHeader = String.fromCharCode(
              view.getUint8(offset + 2), view.getUint8(offset + 3),
              view.getUint8(offset + 4), view.getUint8(offset + 5)
            );
            if (exifHeader !== 'Exif') { resolve(null); return; }
            const tiffStart = offset + 8;
            const byteOrder = view.getUint16(tiffStart);
            const isLE = byteOrder === 0x4949;
            const getU16 = (o: number) => isLE ? view.getUint16(o, true) : view.getUint16(o, false);
            const getU32 = (o: number) => isLE ? view.getUint32(o, true) : view.getUint32(o, false);
            const ifdOffset = getU32(tiffStart + 4);
            const numEntries = getU16(tiffStart + ifdOffset);
            for (let i = 0; i < numEntries; i++) {
              const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
              const tag = getU16(entryOffset);
              // 0x9003: DateTimeOriginal
              if (tag === 0x9003 || tag === 0x0132) {
                const count = getU32(entryOffset + 4);
                const valueOffset = count > 4
                  ? tiffStart + getU32(entryOffset + 8)
                  : entryOffset + 8;
                let dateStr = '';
                for (let j = 0; j < Math.min(count - 1, 19); j++) {
                  const ch = view.getUint8(valueOffset + j);
                  if (ch === 0) break;
                  dateStr += String.fromCharCode(ch);
                }
                const m = dateStr.match(/^(\d{4}):(\d{2}):(\d{2})/);
                if (m) {
                  resolve(new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
                  return;
                }
              }
            }
            resolve(null); return;
          } else {
            const segLen = view.getUint16(offset);
            offset += segLen;
          }
        }
        resolve(null);
      } catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

// ファイルをStockPhotoに変換
async function fileToStockPhoto(file: File): Promise<StockPhoto> {
  const [url, takenAt] = await Promise.all([
    new Promise<string>(res => {
      const r = new FileReader();
      r.onload = e => res(e.target?.result as string);
      r.readAsDataURL(file);
    }),
    extractExifDate(file),
  ]);
  return { url, takenAt, fileName: file.name };
}

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
  preview: string;
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

const FONT_FAMILIES = [
  { name: 'sans-serif', label: 'ゴシック' },
  { name: 'serif', label: '明朝体' },
  { name: '"M PLUS Rounded 1c", sans-serif', label: '丸ゴシック' },
  { name: '"Permanent Marker", cursive', label: '手書き風' },
];

function getTextCssStyle(styleId: TextStyleId | undefined, color: string, fontFamily: string): React.CSSProperties {
  const base: React.CSSProperties = { color, fontFamily };
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

function ArchText({ text, color, fontSize, styleId, width, height, fontFamily }: {
  text: string; color: string; fontSize: number; styleId: TextStyleId; width: number; height: number; fontFamily: string;
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
              fontFamily={fontFamily}
              fill={color}
              transform={`rotate(${rot}, ${x}, ${y})`}
              style={{ filter: `drop-shadow(1.5px 2px 2px rgba(0,0,0,0.5))` }}
            >{ch}</text>
          );
        })}
      </svg>
    );
  }

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
        fontFamily={fontFamily}
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
  originalImageUrl?: string;
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
  slotStyle?: React.CSSProperties;
}

const CANVAS_W = 360;
const CANVAS_H = 480;
const EXPORT_W = 1080;

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
      { id: 's1', x: 15,  y: 65,  width: 155, height: 155, style: { borderRadius: '50%' } },
      { id: 's2', x: 210, y: 60,  width: 110, height: 110, style: { borderRadius: '50%' } },
      { id: 's3', x: 225, y: 180, width: 95,  height: 95,  style: { borderRadius: '50%' } },
      { id: 's4', x: 45,  y: 235, width: 90,  height: 90,  style: { borderRadius: '50%' } },
      { id: 's5', x: 30,  y: 340, width: 105, height: 105, style: { borderRadius: '50%' } },
      { id: 's6', x: 175, y: 300, width: 165, height: 165, style: { borderRadius: '50%' } },
    ],
  },
];

type CustomSlotShape = 'square' | 'rect-v' | 'rect-h' | 'circle' | 'ellipse-v' | 'ellipse-h' | 'heart' | 'star';

interface CustomSlotOption {
  shape: CustomSlotShape;
  label: string;
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

function buildCustomSlots(shapes: CustomSlotShape[]): SlotData[] {
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

  return shapes.map((shape, i) => {
    const { col, row } = grid[i];
    const cx = PAD + col * (colW + GAP);
    const cy = TOP_OFFSET + row * (rowH + GAP);

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

type RandomShape = 'square' | 'rect-v' | 'rect-h' | 'circle' | 'ellipse-v' | 'ellipse-h' | 'heart' | 'star';

function buildRandomSlots(): SlotData[] {
  const shapes: RandomShape[] = ['square', 'rect-v', 'rect-h', 'circle', 'ellipse-v', 'ellipse-h', 'heart', 'star'];
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
      slotStyle = { clipPath: 'polygon(50% 25%, 60% 10%, 75% 5%, 90% 10%, 100% 25%, 100% 42%, 85% 60%, 65% 78%, 50% 100%, 35% 78%, 15% 60%, 0% 42%, 0% 25%, 10% 10%, 25% 5%, 40% 10%)' };
    } else if (shape === 'star') {
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

function getClipPathStyle(shape: ClipShape): React.CSSProperties {
  if (shape === 'heart') {
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
