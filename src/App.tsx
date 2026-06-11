import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import html2canvas from 'html2canvas';
import {
  Check,
  Grid, ImagePlus, X, LayoutTemplate, Undo2, Shuffle,
} from 'lucide-react';
import CropModal from './CropModal';
import './index.css';
import { usePlan } from './hooks/usePlan';
import { UpgradeModal } from './UpgradeModal';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth as fbAuth } from './firebase';

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
                // "2024:03:15 14:30:00" → Date
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
    // 最初の64KBだけ読めばExifは十分
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

// アーチ/ウェーブはSVGで描画
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
  slotStyle?: React.CSSProperties; // 枠から引き継いだborderRadius/clipPath
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
      { id: 's1', x: 15,  y: 65,  width: 155, height: 155, style: { borderRadius: '50%' } },
      { id: 's2', x: 210, y: 60,  width: 110, height: 110, style: { borderRadius: '50%' } },
      { id: 's3', x: 225, y: 180, width: 95,  height: 95,  style: { borderRadius: '50%' } },
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

// ===== ランダム枠生成 =====
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

function LoginScreen({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isRegister, setIsRegister] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleEmail = async () => {
    setError(''); setLoading(true);
    try {
      if (isRegister) {
        await createUserWithEmailAndPassword(fbAuth, email, password);
      } else {
        await signInWithEmailAndPassword(fbAuth, email, password);
      }
      onClose();
    } catch (e: any) {
      const msg: Record<string, string> = {
        'auth/user-not-found': 'メールアドレスが見つかりません',
        'auth/wrong-password': 'パスワードが違います',
        'auth/email-already-in-use': 'このメールアドレスは登録済みです',
        'auth/weak-password': 'パスワードは6文字以上にしてください',
        'auth/invalid-email': 'メールアドレスの形式が正しくありません',
        'auth/invalid-credential': 'メールアドレスまたはパスワードが違います',
      };
      setError(msg[e.code] ?? 'エラーが発生しました');
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError(''); setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(fbAuth, provider);
      onClose();
    } catch (e: any) {
      if (e.code !== 'auth/popup-closed-by-user') {
        setError('Googleログインに失敗しました');
      }
    }
    setLoading(false);
  };

  return (
    <div
      onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:30000,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 20px'}}
    >
      <div onClick={e => e.stopPropagation()} style={{width:'100%',maxWidth:340,background:'white',borderRadius:20,padding:'32px 24px',boxShadow:'0 4px 24px rgba(0,0,0,0.12)',position:'relative'}}>
        {/* × 閉じるボタン */}
        <button onClick={onClose} style={{position:'absolute',top:12,left:16,background:'none',border:'none',fontSize:20,color:'#bbb',cursor:'pointer',lineHeight:1,padding:4}}>×</button>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:32,marginBottom:8}}>🎨</div>
          <div style={{fontSize:20,fontWeight:'bold',color:'#333'}}>{isRegister ? '新規登録' : 'ログイン'}</div>
        </div>

        {/* Googleログインボタン */}
        <button
          onClick={handleGoogle} disabled={loading}
          style={{
            width:'100%',padding:'13px',
            background:'white',color:'#333',
            border:'1.5px solid #ddd',borderRadius:10,
            fontSize:14,fontWeight:'bold',cursor:'pointer',
            marginBottom:16,display:'flex',alignItems:'center',justifyContent:'center',gap:8,
            boxShadow:'0 1px 4px rgba(0,0,0,0.1)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Googleでログイン
        </button>

        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <div style={{flex:1,height:1,background:'#eee'}} />
          <span style={{fontSize:12,color:'#bbb'}}>またはメールで</span>
          <div style={{flex:1,height:1,background:'#eee'}} />
        </div>

        <input
          type="email" placeholder="メールアドレス" value={email}
          onChange={e => setEmail(e.target.value)}
          style={{width:'100%',padding:'12px',border:'1px solid #ddd',borderRadius:10,fontSize:14,marginBottom:10,boxSizing:'border-box' as const}}
        />
        <input
          type="password" placeholder="パスワード（6文字以上）" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleEmail()}
          style={{width:'100%',padding:'12px',border:'1px solid #ddd',borderRadius:10,fontSize:14,marginBottom:10,boxSizing:'border-box' as const}}
        />
        {error && <div style={{color:'#e05555',fontSize:12,marginBottom:8,textAlign:'center'}}>{error}</div>}
        <button
          onClick={handleEmail} disabled={loading}
          style={{width:'100%',padding:'13px',background:'#f26b9a',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:'bold',cursor:'pointer',marginBottom:12}}
        >
          {loading ? '...' : isRegister ? '登録する' : 'ログイン'}
        </button>
        <button
          onClick={() => { setIsRegister(r => !r); setError(''); }}
          style={{width:'100%',padding:'8px',background:'none',border:'none',color:'#888',fontSize:13,cursor:'pointer'}}
        >
          {isRegister ? 'ログインはこちら' : 'アカウントを作成する'}
        </button>
        <button onClick={onClose} style={{width:'100%',padding:'8px',background:'none',border:'none',color:'#ccc',fontSize:12,cursor:'pointer',marginTop:4}}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

function AdBanner() {
  return (
    <div style={{
      width: '100%',
      background: '#f0f0f0',
      borderTop: '1px solid #ddd',
      borderBottom: '1px solid #ddd',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 52,
      flexShrink: 0,
      fontSize: 12,
      color: '#aaa',
      gap: 6,
      position: 'relative',
      zIndex: 1,
    }}>
      <span>📢 広告スペース</span>
    </div>
  );
}

function PreviewModal({ dataUrl, onClose }: { dataUrl: string; onClose: () => void }) {
  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#fff' }}>完成画像</div>
        <img src={dataUrl} alt="preview" className="preview-img" style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px' }} />
        <div style={{ 
          color: '#eee', 
          fontSize: '13px', 
          textAlign: 'center', 
          marginTop: '15px', 
          padding: '10px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          lineHeight: '1.5'
        }}>
          上の画像を<strong>長押し</strong>して<br />
          <strong>「"写真"に追加」</strong>を選択すると<br />
          カメラロールに保存されます。
        </div>
        <div className="preview-actions" style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button className="preview-btn close" onClick={onClose} style={{ padding: '10px 20px', borderRadius: '20px', border: 'none', cursor: 'pointer' }}>
            閉じる
          </button>
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
  position?: 'topLeft' | 'bottomRight';
}

function RotateHandle({ itemId, itemX, itemY, itemW, itemH, rotation, onRotate, position = 'bottomRight' }: RotateHandleProps) {
  const isDragging = useRef(false);
  const startAngleOffset = useRef(0);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handle = e.target as HTMLElement;
    const canvas = handle.closest('.album-canvas') as HTMLElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + itemX + itemW / 2;
    const cy = rect.top + itemY + itemH / 2;
    
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const clickAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    startAngleOffset.current = clickAngle - rotation;

    const onMove = (moveEvent: PointerEvent) => {
      if (!isDragging.current) return;

      const mdx = moveEvent.clientX - cx;
      const mdy = moveEvent.clientY - cy;
      const currentMouseAngle = Math.atan2(mdy, mdx) * (180 / Math.PI);
      
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
  }, [itemId, itemX, itemY, itemW, itemH, rotation, onRotate]);

  return (
    <div
      className="rotate-handle"
      onPointerDown={handlePointerDown}
      title="ドラッグで回転"
      style={position === 'topLeft' ? { bottom: 'auto', right: 'auto', top: -14, left: -14 } : undefined}
    >
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
  bgImage?: string;
  bgPhotoOpacity?: number;
  bgPhotoUrl?: string;
};

function getCanvasBgStyle(bg: BgState): React.CSSProperties {
  if (bg.bgPhotoUrl) {
    return {
      backgroundImage: `url(${bg.bgPhotoUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      position: 'relative',
    };
  }
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

interface BgSeries {
  id: string;
  label: string;
  files: string[];
}

const BG_SERIES: BgSeries[] = [
  {
    id: 's1',
    label: '水彩',
    files: [
      ...Array.from({ length: 12 }, (_, i) => `/colabam_bimg${101 + i}.jpg`),
      '/colabam_bimg997.jpg',
    ],
  },
  {
    id: 's2',
    label: 'ポップ',
    files: [
      ...Array.from({ length: 12 }, (_, i) => `/colabam_bimg${201 + i}.jpg`),
      '/colabam_bimg999.jpg',
    ],
  },
  {
    id: 's3',
    label: 'ｽﾀｲﾘｯｼｭ',
    files: [
      ...Array.from({ length: 12 }, (_, i) => `/colabam_bimg${301 + i}.jpg`),
      '/colabam_bimg998.jpg',
    ],
  },
];

type StampCategory = 'with-bg' | 'no-bg';

interface StampCategoryDef {
  id: StampCategory;
  label: string;
}

const STAMP_CATEGORIES: StampCategoryDef[] = [
  { id: 'no-bg',   label: 'メッセージ' },
  { id: 'with-bg', label: 'プレート' },
];

const STAMP_FILES: Record<StampCategory, string[]> = {
  'no-bg': [
    ...Array.from({ length: 12 }, (_, i) => `/stamps/no-bg/colabammojitouka${String(i + 1).padStart(3, '0')}.png`),
    ...Array.from({ length: 12 }, (_, i) => `/stamps/no-bg/colabammojitouka${String(i + 101).padStart(3, '0')}.png`),
  ],
  'with-bg': [
    ...Array.from({ length: 12 }, (_, i) => `/stamps/with-bg/colabammojiimg${String(i + 1).padStart(3, '0')}.jpg`),
    ...Array.from({ length: 12 }, (_, i) => `/stamps/with-bg/colabammojiimg${String(i + 101).padStart(3, '0')}.jpg`),
  ],
};

function StampMenu({ onAdd }: { onAdd: (url: string) => void }) {
  const [activeCategory, setActiveCategory] = useState<StampCategory>('no-bg');
  const files = STAMP_FILES[activeCategory];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {STAMP_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: 6,
              border: `2px solid ${activeCategory === cat.id ? 'var(--primary)' : '#ddd'}`,
              background: activeCategory === cat.id ? '#fff0f5' : 'white',
              cursor: 'pointer', fontSize: 11,
              fontWeight: activeCategory === cat.id ? 'bold' : 'normal',
              color: activeCategory === cat.id ? 'var(--primary)' : '#555',
            }}
          >{cat.label}</button>
        ))}
      </div>

      {files.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#aaa', fontSize: 12 }}>
          画像を追加してください<br />
          <code style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>
            public/stamps/{activeCategory}/
          </code>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}>
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

function ImageBgTab({ canvasBg, setCanvasBg }: {
  canvasBg: BgState;
  setCanvasBg: React.Dispatch<React.SetStateAction<BgState>>;
}) {
  const [activeSeries, setActiveSeries] = useState<string>(BG_SERIES[0].id);
  const series = BG_SERIES.find(s => s.id === activeSeries) ?? BG_SERIES[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => setCanvasBg(prev => ({ ...prev, bgImage: undefined }))}
          style={{
            padding: '8px 8px', borderRadius: 6, border: `2px solid ${!canvasBg.bgImage ? 'var(--primary)' : '#ddd'}`,
            background: !canvasBg.bgImage ? '#fff0f5' : 'white',
            cursor: 'pointer', fontSize: 10, color: !canvasBg.bgImage ? 'var(--primary)' : '#888',
            fontWeight: !canvasBg.bgImage ? 'bold' : 'normal', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >✕ なし</button>
        {BG_SERIES.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSeries(s.id)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: 6,
              border: `2px solid ${activeSeries === s.id ? 'var(--primary)' : '#ddd'}`,
              background: activeSeries === s.id ? '#fff0f5' : 'white',
              cursor: 'pointer', fontSize: 10,
              color: activeSeries === s.id ? 'var(--primary)' : '#555',
              fontWeight: activeSeries === s.id ? 'bold' : 'normal',
            }}
          >{s.label}</button>
        ))}
      </div>
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
  const [bgTab, setBgTab] = useState<'color' | 'image' | 'photo'>('image');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const currentColor = colorTarget === 'primary' ? canvasBg.color : canvasBg.color2;
  const setColor = (c: string) => {
    setCanvasBg(prev => colorTarget === 'primary' ? { ...prev, color: c, bgImage: undefined, bgPhotoUrl: undefined } : { ...prev, color2: c });
  };

  const needsColor2 = canvasBg.patternType !== 'solid';

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setCanvasBg(prev => ({ ...prev, bgPhotoUrl: url, bgImage: undefined, bgPhotoOpacity: prev.bgPhotoOpacity ?? 1 }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const opacity = canvasBg.bgPhotoOpacity ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => setBgTab('image')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6, border: `2px solid ${bgTab === 'image' ? 'var(--primary)' : '#ddd'}`,
            background: bgTab === 'image' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: bgTab === 'image' ? 'bold' : 'normal', color: bgTab === 'image' ? 'var(--primary)' : '#555',
          }}
        >🖼️ イラスト</button>
        <button
          onClick={() => setBgTab('color')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6, border: `2px solid ${bgTab === 'color' ? 'var(--primary)' : '#ddd'}`,
            background: bgTab === 'color' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: bgTab === 'color' ? 'bold' : 'normal', color: bgTab === 'color' ? 'var(--primary)' : '#555',
          }}
        >🎨 カラー</button>
        <button
          onClick={() => setBgTab('photo')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6, border: `2px solid ${bgTab === 'photo' ? 'var(--primary)' : '#ddd'}`,
            background: bgTab === 'photo' ? '#fff0f5' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: bgTab === 'photo' ? 'bold' : 'normal', color: bgTab === 'photo' ? 'var(--primary)' : '#555',
          }}
        >📷 写真</button>
      </div>

      {bgTab === 'color' && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flexShrink: 0, justifyContent: 'center' }}>
            {PATTERN_DEFS.map(p => (
              <button
                key={p.id}
                onClick={() => setCanvasBg(prev => ({ ...prev, patternType: p.id, pattern: 'none', bgImage: undefined, bgPhotoUrl: undefined }))}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  border: `2px solid ${canvasBg.patternType === p.id && !canvasBg.bgImage && !canvasBg.bgPhotoUrl ? 'var(--primary)' : '#ddd'}`,
                  borderRadius: 8, background: canvasBg.patternType === p.id && !canvasBg.bgImage && !canvasBg.bgPhotoUrl ? '#fff0f5' : 'white',
                  padding: '3px 6px', cursor: 'pointer', minWidth: 40, flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{p.icon}</span>
                <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>{p.label}</span>
              </button>
            ))}
          </div>

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

      {bgTab === 'photo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => photoInputRef.current?.click()}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                border: '2px dashed var(--primary)', background: '#fff0f5',
                color: 'var(--primary)', fontSize: 12, fontWeight: 'bold',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>📷</span>
              {canvasBg.bgPhotoUrl ? '写真を変更する' : 'デバイスから写真を選ぶ'}
            </button>
            {canvasBg.bgPhotoUrl && (
              <button
                onClick={() => setCanvasBg(prev => ({ ...prev, bgPhotoUrl: undefined }))}
                style={{
                  padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd',
                  background: 'white', color: '#888', fontSize: 11, cursor: 'pointer',
                }}
              >✕ 解除</button>
            )}
          </div>

          {canvasBg.bgPhotoUrl && (
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', height: 60, position: 'relative', flexShrink: 0 }}>
              <img
                src={canvasBg.bgPhotoUrl}
                alt="背景プレビュー"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <div style={{
                position: 'absolute', inset: 0,
                background: `rgba(255,255,255,${1 - opacity})`,
                pointerEvents: 'none',
              }} />
            </div>
          )}

          {canvasBg.bgPhotoUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 'bold' }}>🌫️ 薄さ調整（白っぽくする）</span>
                <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 'bold', minWidth: 32, textAlign: 'right' }}>
                  {Math.round((1 - opacity) * 100)}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>そのまま</span>
                <input
                  type="range"
                  min={0}
                  max={95}
                  step={1}
                  value={Math.round((1 - opacity) * 100)}
                  onChange={e => {
                    const whiteness = parseInt(e.target.value) / 100;
                    setCanvasBg(prev => ({ ...prev, bgPhotoOpacity: 1 - whiteness }));
                  }}
                  style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>白く</span>
              </div>
            </div>
          )}

          {!canvasBg.bgPhotoUrl && (
            <div style={{ textAlign: 'center', color: '#bbb', fontSize: 11, padding: '8px 0' }}>
              写真を選ぶと背景に設定されます
            </div>
          )}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
        </div>
      )}
    </div>
  );
}

// ===== Main App =====
export default function App() {
  useEffect(() => {
    const setViewport = (content: string) => {
      let viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        (viewport as HTMLMetaElement).name = 'viewport';
        document.head.appendChild(viewport);
      }
      viewport.setAttribute('content', content);
    };

    const noZoomConfig = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    setViewport(noZoomConfig);

    return () => {
      setViewport("width=device-width, initial-scale=1");
    };
  }, []);

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [history, setHistory] = useState<CanvasItem[][]>([]);
  const [templateSlots, setTemplateSlots] = useState<SlotData[]>([]);
  const [activeMainTab, setActiveMainTab] = useState<MainTab | null>(null);

  const [canvasBg, setCanvasBg] = useState<{
    color: string;
    color2: string;
    pattern: string;
    patternType: string;
    gradientDir: string;
    bgImage?: string;
    bgPhotoOpacity?: number;
    bgPhotoUrl?: string;
  }>(() => {
    const randomBgImages = ['/colabam_bimg997.jpg', '/colabam_bimg998.jpg', '/colabam_bimg999.jpg'];
    const initialBgImage = randomBgImages[Math.floor(Math.random() * randomBgImages.length)];
    return { color: '#fffbe6', color2: '#f26b9a', pattern: 'none', patternType: 'solid', gradientDir: 'to bottom', bgImage: initialBgImage, bgPhotoOpacity: 1, bgPhotoUrl: undefined };
  });

  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [cropInitialShape, setCropInitialShape] = useState<'square' | 'rectangle' | 'rectangle-h' | 'circle' | 'ellipse' | 'ellipse-h' | 'heart' | 'star' | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customPicking, setCustomPicking] = useState(false);
  const [customSelected, setCustomSelected] = useState<CustomSlotShape[]>([]);

  const [inputText, setInputText] = useState('');
  const [textColor, setTextColor] = useState('#333333');
  const [fontSize, setFontSize] = useState(36);
  const [textStyle, setTextStyle] = useState<TextStyleId>('normal');
  const [fontFamily, setFontFamily] = useState('sans-serif');

  const [photoSubMenuId, setPhotoSubMenuId] = useState<string | null>(null);
  const [photoSubMenuPos, setPhotoSubMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [retrimTargetId, setRetrimTargetId] = useState<string | null>(null);

  const [itemSubMenuId, setItemSubMenuId] = useState<string | null>(null);
  const [itemSubMenuPos, setItemSubMenuPos] = useState<{ x: number; y: number } | null>(null);

  const [photoStocks, setPhotoStocks] = useState<StockPhoto[][]>([[], [], []]);
  const [activeStockIndex, setActiveStockIndex] = useState<0 | 1 | 2>(0);
  const [showPhotoAddMenu, setShowPhotoAddMenu] = useState(false);
  const [showStockOrganizer, setShowStockOrganizer] = useState(false);
  const [stockDeleteSelected, setStockDeleteSelected] = useState<Set<number>>(new Set());
  const [pendingStockPhotos, setPendingStockPhotos] = useState<StockPhoto[]>([]);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFilterFrom, setDateFilterFrom] = useState('');
  const [dateFilterTo, setDateFilterTo] = useState('');
  const [showFillStockPicker, setShowFillStockPicker] = useState(false);
  const [showFillModeDialog, setShowFillModeDialog] = useState(false);
  const [pendingFillStockIdx, setPendingFillStockIdx] = useState<0 | 1 | 2 | null>(null);

  const { isPro, user, loading: planLoading } = usePlan();
  const [showLoginModal, setShowLoginModal] = React.useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeatureName, setUpgradeFeatureName] = useState<string | undefined>(undefined);

  const openUpgrade = (featureName?: string) => {
    setUpgradeFeatureName(featureName);
    setShowUpgradeModal(true);
  };

  const [showSlotPickerMenu, setShowSlotPickerMenu] = useState(false);
  const [slotPickerTargetId, setSlotPickerTargetId] = useState<string | null>(null);

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

    const STAGGER_STEP = 30;
    const BASE_Y_STAMP = Math.round(CANVAS_H * 0.12);

    let defaultX = 50;
    let defaultY = 50;

    if (type === 'stamp') {
      defaultX = Math.round((CANVAS_W - w) / 2);
      defaultY = BASE_Y_STAMP;

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
    if ((shape === 'heart' || shape === 'star') && !isPro) {
      openUpgrade(shape === 'heart' ? 'ハート形枠' : '星形枠');
      return;
    }
    if (customSelected.length >= 6) return;
    setCustomSelected(prev => [...prev, shape]);
  };

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
    const randomBgImages = ['/colabam_bimg997.jpg', '/colabam_bimg998.jpg', '/colabam_bimg999.jpg'];
    const resetBgImage = randomBgImages[Math.floor(Math.random() * randomBgImages.length)];
    setCanvasBg({ color: '#fffbe6', color2: '#f26b9a', pattern: 'none', patternType: 'solid', gradientDir: 'to bottom', bgImage: resetBgImage, bgPhotoOpacity: 1, bgPhotoUrl: undefined });
  };

  const pendingOriginalUrl = useRef<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      pendingOriginalUrl.current = url;
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
          originalImageUrl: originalUrl,
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
    await new Promise(r => setTimeout(r, 100));
    
    if (!canvasRef.current) return;

    try {
      const scale = EXPORT_W / CANVAS_W;
      const canvas = await html2canvas(canvasRef.current, {
        useCORS: true,
        scale,
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: '#000',
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.90);

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `my-album-${Date.now()}.jpg`, { type: 'image/jpeg' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'アルバム保存',
        });
      } else {
        setPreviewUrl(dataUrl);
      }
    } catch (err) {
      console.error("保存に失敗しました", err);
    }
  };

  const handleSlotClick = (slotId: string) => {
    const slot = templateSlots.find(s => s.id === slotId);
    const style = slot?.style ?? {};
    const ratio = slot ? slot.width / slot.height : 1;
    const clipPath = (style as React.CSSProperties).clipPath as string | undefined;
    const isRound = (style as React.CSSProperties).borderRadius === '50%';
    let shape: typeof cropInitialShape = undefined;
    if (clipPath?.includes('50% 15%') || clipPath?.includes('50% 25%') || clipPath?.includes('50% 0%, 80%')) {
      shape = 'heart';
    } else if (clipPath?.includes('61% 35%') || clipPath?.includes('61.8%') || clipPath?.includes('50% 0%, 61%')) {
      shape = 'star';
    } else if (isRound) {
      if (ratio > 1.15) shape = 'ellipse-h';
      else if (ratio < 0.85) shape = 'ellipse';
      else shape = 'circle';
    } else {
      if (ratio > 1.15) shape = 'rectangle-h';
      else if (ratio < 0.85) shape = 'rectangle';
      else shape = 'square';
    }
    setCropInitialShape(shape);
    setTargetSlotId(slotId);
    setSlotPickerTargetId(slotId);
    setShowSlotPickerMenu(true);
  };

  const slotStyleToClipShape = (slot: SlotData): ClipShape | undefined => {
    const style = slot.style ?? {};
    const clipPath = (style as React.CSSProperties).clipPath as string | undefined;
    if (!clipPath) return undefined;
    if (clipPath.includes('50% 25%') || clipPath.includes('50% 15%')) return 'heart';
    if (clipPath.includes('61.8%') || clipPath.includes('61% 35%')) return 'star';
    if (clipPath.includes('75%, 75% 75%') || clipPath.includes('75% 75%')) return 'bubble';
    return undefined;
  };

  const slotStyleToItemStyle = (slot: SlotData): React.CSSProperties => {
    const style = slot.style ?? {};
    const borderRadius = (style as React.CSSProperties).borderRadius;
    const clipPath = (style as React.CSSProperties).clipPath as string | undefined;
    const result: React.CSSProperties = {};
    if (borderRadius) result.borderRadius = borderRadius;
    if (clipPath) result.clipPath = clipPath;
    return result;
  };

  const handleSlotPickFromStock = (_stockIdx: 0 | 1 | 2, stockPhotoUrl: string) => {
    maxZIndex.current += 1;

    if (slotPickerTargetId) {
      const slot = templateSlots.find(s => s.id === slotPickerTargetId);
      if (!slot) return;
      const clipShape = slotStyleToClipShape(slot);
      
      const newItem: CanvasItem = {
        id: `photo-slot-${slot.id}-${Date.now()}`,
        type: 'photo',
        content: stockPhotoUrl,
        originalImageUrl: stockPhotoUrl,
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
      setTemplateSlots(prev => prev.filter(s => s.id !== slotPickerTargetId));
    } else {
      const newItem: CanvasItem = {
        id: `photo-direct-${Date.now()}`,
        type: 'photo',
        content: stockPhotoUrl,
        originalImageUrl: stockPhotoUrl,
        x: 50,
        y: 50,
        width: 120,
        height: 120,
        rotation: 0,
        zIndex: maxZIndex.current,
      };
      pushHistory(items);
      setItems(prev => [...prev, newItem]);
    }

    setShowSlotPickerMenu(false);
    setSlotPickerTargetId(null);
    setTargetSlotId(null);
  };

  const handleItemRotate = useCallback((id: string, newRotation: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, rotation: newRotation } : i));
  }, []);

  const handleDeleteItem = (id: string) => {
    pushHistory(items);
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedId(null);
    setPhotoSubMenuId(null);
    setPhotoSubMenuPos(null);
    setItemSubMenuId(null);
    setItemSubMenuPos(null);
  };

  const handleBringToFront = (id: string) => {
    const maxZ = Math.max(...items.map(i => i.zIndex), maxZIndex.current) + 1;
    maxZIndex.current = maxZ;
    setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: maxZ } : i));
    setPhotoSubMenuId(null);
    setPhotoSubMenuPos(null);
    setItemSubMenuId(null);
    setItemSubMenuPos(null);
  };

  const handleSendToBack = (id: string) => {
    const minZ = Math.min(...items.map(i => i.zIndex)) - 1;
    setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: minZ } : i));
    setPhotoSubMenuId(null);
    setPhotoSubMenuPos(null);
    setItemSubMenuId(null);
    setItemSubMenuPos(null);
  };

  const handleReplacePhoto = (id: string) => {
    setReplaceTargetId(id);
    setPhotoSubMenuId(null);
    setPhotoSubMenuPos(null);
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
      pendingOriginalUrl.current = url;
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
    setPhotoSubMenuPos(null);
    const ratio = item.width / item.height;
    let shape: typeof cropInitialShape = undefined;
    if (item.clipShape === 'heart') shape = 'heart';
    else if (item.clipShape === 'star') shape = 'star';
    else if (ratio > 1.15) shape = 'rectangle-h';
    else if (ratio < 0.85) shape = 'rectangle';
    else shape = 'square';
    setCropInitialShape(shape);
    setCropImageUrl(item.originalImageUrl ?? item.content);
    setTargetSlotId('__retrim__');
  };

  const handleStockFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isPro) { e.target.value = ''; openUpgrade('ストック機能'); return; }
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    const photos = await Promise.all(files.map(fileToStockPhoto));
    const hasDate = photos.some(p => p.takenAt !== null);
    if (hasDate && photos.length > 1) {
      const dates = photos.filter(p => p.takenAt).map(p => p.takenAt!);
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      setDateFilterFrom(fmt(minDate));
      setDateFilterTo(fmt(maxDate));
      setPendingStockPhotos(photos);
      setShowDateFilter(true);
    } else {
      setPhotoStocks(prev => {
        const next = prev.map(s => [...s]) as StockPhoto[][];
        next[activeStockIndex] = [...next[activeStockIndex], ...photos];
        return next;
      });
    }
  };

const handleFillStockSelected = (stockIdx: 0 | 1 | 2) => {
    const photoStock = photoStocks[stockIdx];
    if (photoStock.length === 0) {
      alert(`ストック${stockIdx + 1}に写真がありません。先に写真を追加してください。`);
      return;
    }

    setPendingFillStockIdx(stockIdx);
    setShowFillStockPicker(false);
    setShowFillModeDialog(true);
  };

  const handleFillAllSlots = (stockIdx: 0 | 1 | 2, emptyOnly: boolean) => {
    const photoStock = photoStocks[stockIdx];
    if (photoStock.length === 0) return;

    const shuffled = [...photoStock].sort(() => Math.random() - 0.5);

    if (templateSlots.length === 0) {
      const photoItems = items.filter(item => item.type === 'photo');
      if (photoItems.length === 0) return;
      pushHistory(items);
      setItems(prev =>
        prev.map(item => {
          if (item.type !== 'photo') return item;
          const idx = photoItems.indexOf(item);
          const imgUrl = shuffled[idx % shuffled.length].url;
          return { ...item, content: imgUrl, originalImageUrl: imgUrl };
        })
      );
      setShowPhotoAddMenu(false);
      setShowFillModeDialog(false);
      setPendingFillStockIdx(null);
      return;
    }

    const filledSlotIds = new Set(
      items
        .filter(item => item.type === 'photo')
        .map(item => {
          const m = item.id.match(/^photo-slot-(.+?)-\d+/);
          return m ? m[1] : null;
        })
        .filter(Boolean)
    );
    const targetSlots = emptyOnly
      ? templateSlots.filter(slot => !filledSlotIds.has(slot.id))
      : templateSlots;

    if (targetSlots.length === 0) return;

    pushHistory(items);
    const newItems: CanvasItem[] = targetSlots.map((slot, i) => {
      const imgUrl = shuffled[i % shuffled.length].url;
      maxZIndex.current += 1;
      const clipShape = slotStyleToClipShape(slot);
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
        clipShape,
        ...(Object.keys(slotStyleToItemStyle(slot)).length > 0
          ? { slotStyle: slotStyleToItemStyle(slot) }
          : {}),
      };
    });

    if (!emptyOnly) {
      const targetSlotIdSet = new Set(targetSlots.map(s => s.id));
      setItems(prev => [
        ...prev.filter(item => {
          if (item.type !== 'photo') return true;
          const m = item.id.match(/^photo-slot-(.+?)-\d+/);
          if (!m) return true;
          return !targetSlotIdSet.has(m[1]);
        }),
        ...newItems,
      ]);
      setTemplateSlots([]);
    } else {
      setItems(prev => [...prev, ...newItems]);
    }
    setShowPhotoAddMenu(false);
    setShowFillModeDialog(false);
    setPendingFillStockIdx(null);
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
                  {CUSTOM_SLOT_OPTIONS.map(opt => {
                    const isLocked = (opt.shape === 'heart' || opt.shape === 'star') && !isPro;
                    return (
                      <button
                        key={opt.shape}
                        onClick={() => handleCustomShapeClick(opt.shape)}
                        disabled={customSelected.length >= 6}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                          background: 'none', border: 'none', cursor: customSelected.length < 6 ? 'pointer' : 'default',
                          padding: '4px 2px', minWidth: 44,
                          opacity: isLocked ? 0.5 : 1,
                          position: 'relative',
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
                        {isLocked && (
                          <span style={{
                            position: 'absolute', top: 2, right: 2,
                            fontSize: 10, color: '#999',
                          }}>🔒</span>
                        )}
                      </button>
                    );
                  })}
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
                      <circle cx="9" cy="9" r="7" fill="currentColor" opacity="0.8" />
                      <circle cx="21" cy="7" r="4.5" fill="currentColor" opacity="0.6" />
                      <circle cx="6" cy="21" r="4.5" fill="currentColor" opacity="0.6" />
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

      case 'text': {
        const editingTextItem = selectedId
          ? items.find(i => i.id === selectedId && i.type === 'text') ?? null
          : null;

        const handleTextColor = (c: string) => {
          setTextColor(c);
          if (editingTextItem) {
            setItems(prev => prev.map(i => i.id === editingTextItem.id ? { ...i, color: c } : i));
          }
        };

        const handleFontSize = (s: number) => {
          setFontSize(s);
          if (editingTextItem) {
            setItems(prev => prev.map(i => i.id === editingTextItem.id ? { ...i, fontSize: s } : i));
          }
        };

        const handleFontFamily = (f: string) => {
          setFontFamily(f);
          if (editingTextItem) {
            setItems(prev => prev.map(i => i.id === editingTextItem.id ? { ...i, fontFamily: f } : i));
          }
        };

        const handleTextStyle = (ts: TextStyleId) => {
          setTextStyle(ts);
          if (editingTextItem) {
            setItems(prev => prev.map(i => i.id === editingTextItem.id ? { ...i, textStyle: ts } : i));
          }
        };

        return (
          <div className="text-menu-controls">
            {editingTextItem ? (
              <div style={{
                fontSize: 11, color: 'var(--primary)', fontWeight: 'bold',
                padding: '2px 4px 4px', textAlign: 'center',
              }}>
                ✏️ 選択中のテキストを編集中
              </div>
            ) : (
              <input 
                type="text" 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
                placeholder="文字を入力..." 
                className="text-input" 
                style={{ fontSize: 16 }} 
              />
            )}
            
            <div className="control-row">
              <input type="color" value={textColor} onChange={(e) => handleTextColor(e.target.value)} />
              <input type="range" min="12" max="100" value={fontSize} onChange={(e) => handleFontSize(parseInt(e.target.value))} />
              <span style={{ fontSize: 12, minWidth: 30 }}>{fontSize}px</span>

              <select
                value={fontFamily}
                onChange={(e) => handleFontFamily(e.target.value)}
                style={{
                  flex: 1, minWidth: 80, padding: '5px 4px', borderRadius: '6px',
                  border: '1px solid #ddd', fontSize: '12px', background: '#fff',
                  cursor: 'pointer', fontFamily: fontFamily
                }}
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.name} value={f.name} style={{ fontFamily: f.name }}>
                    {f.label}
                  </option>
                ))}
              </select>

              {!editingTextItem && (
                <button 
                  onClick={() => { 
                    if (inputText.trim()) { 
                      addItem('text', inputText, { color: textColor, fontSize, textStyle, fontFamily }); 
                      setInputText(''); 
                    } 
                  }} 
                  className="add-btn"
                >
                  追加
                </button>
              )}
            </div>
            <div className="text-style-row">
              {TEXT_STYLES.map(ts => (
                <button
                  key={ts.id}
                  className={`text-style-btn ${textStyle === ts.id ? 'active' : ''}`}
                  onClick={() => handleTextStyle(ts.id)}
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
      }
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

  // ローディング中のみ待機（未ログインでもアプリを使える）
  if (planLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100dvh',background:'#eef6ff',fontSize:14,color:'#888'}}>読み込み中...</div>;

  return (
    <div className="app-container">
      <header className="header">
        <button className="header-btn back-btn" onClick={undo} disabled={history.length === 0}>
          <Undo2 size={18} />
          <span>戻る</span>
        </button>
        {/* 中央：ログイン/ログアウトボタン */}
        {user ? (
          <button
            onClick={() => signOut(fbAuth)}
            title={user.email ?? ''}
            style={{
              background: 'none', border: '1px solid #ddd',
              borderRadius: 20, color: '#888', fontSize: 12,
              cursor: 'pointer', padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {isPro ? '👑' : '👤'} ログアウト
          </button>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            style={{
              background: 'linear-gradient(135deg, #f26b9a, #9b59b6)',
              border: 'none', borderRadius: 20, color: 'white',
              fontSize: 12, fontWeight: 'bold',
              cursor: 'pointer', padding: '6px 16px',
              display: 'flex', alignItems: 'center', gap: 5,
              boxShadow: '0 2px 8px rgba(242,107,154,0.4)',
            }}
          >
            🔑 ログイン
          </button>
        )}
        <button className="header-btn save-btn" onClick={saveAlbum}>
          <Check size={18} />
          <span>保存</span>
        </button>
      </header>

      <main className="canvas-area" onClick={() => { setSelectedId(null); setPhotoSubMenuId(null); setPhotoSubMenuPos(null); setItemSubMenuId(null); setItemSubMenuPos(null); setActiveMainTab(null); setShowPhotoAddMenu(false); }}>
        <div
          ref={canvasRef}
          className="album-canvas"
          style={{ width: CANVAS_W, height: CANVAS_H, ...getCanvasBgStyle(canvasBg) }}
        >
          {canvasBg.bgPhotoUrl && (canvasBg.bgPhotoOpacity ?? 1) < 1 && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `rgba(255,255,255,${1 - (canvasBg.bgPhotoOpacity ?? 1)})`,
              pointerEvents: 'none',
              zIndex: 0,
            }} />
          )}
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
                  setPhotoSubMenuId(null);
                  setPhotoSubMenuPos(null);
                  setItemSubMenuId(null);
                  setItemSubMenuPos(null);
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
                resizeHandleStyles={isSelected ? { topLeft: { display: 'none' } } : {}}
                resizeHandleComponent={isSelected ? {
                  bottomRight: (
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
                        cursor: 'se-resize',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10 L10 10 L10 2" stroke="#f26b9a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M10 10 L6 6" stroke="#f26b9a" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                      </svg>
                    </div>
                  ),
                } : {}}
              >
                <div
                  className={`canvas-item-wrapper drag-handle ${isSelected ? 'selected' : ''}`}
                  style={{
                    transform: `rotate(${item.rotation}deg)`,
                    ...(item.clipShape || item.slotStyle ? { background: 'transparent' } : {}),
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).dataset.pointerDownX = String(e.clientX);
                    (e.currentTarget as HTMLElement).dataset.pointerDownY = String(e.clientY);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    const el = e.currentTarget as HTMLElement;
                    const dx = Math.abs(e.clientX - Number(el.dataset.pointerDownX ?? e.clientX));
                    const dy = Math.abs(e.clientY - Number(el.dataset.pointerDownY ?? e.clientY));
                    if (dx > 8 || dy > 8) return;
                    setSelectedId(item.id);
                    const canvasEl = canvasRef.current;
                    const getMenuPos = () => {
                      if (!canvasEl) return null;
                      const canvasRect = canvasEl.getBoundingClientRect();
                      const menuX = canvasRect.left + item.x + item.width / 2;
                      const menuY = canvasRect.top + item.y + item.height + 8;
                      return { x: menuX, y: menuY };
                    };
                    if (item.type === 'photo') {
                      if (photoSubMenuId === item.id) {
                        setPhotoSubMenuId(null);
                        setPhotoSubMenuPos(null);
                      } else {
                        setItemSubMenuId(null);
                        setItemSubMenuPos(null);
                        setPhotoSubMenuId(item.id);
                        setPhotoSubMenuPos(getMenuPos());
                      }
                    } else if (item.type === 'text') {
                      setPhotoSubMenuId(null);
                      setPhotoSubMenuPos(null);
                      setItemSubMenuId(null);
                      setItemSubMenuPos(null);
                      setActiveMainTab('text');
                      setTextColor(item.color ?? '#333333');
                      setFontSize(item.fontSize ?? 36);
                      setTextStyle(item.textStyle ?? 'normal');
                      setFontFamily(item.fontFamily ?? 'sans-serif');
                    } else if (item.type === 'stamp') {
                      if (itemSubMenuId === item.id) {
                        setItemSubMenuId(null);
                        setItemSubMenuPos(null);
                      } else {
                        setPhotoSubMenuId(null);
                        setPhotoSubMenuPos(null);
                        setItemSubMenuId(item.id);
                        setItemSubMenuPos(getMenuPos());
                      }
                    } else {
                      setPhotoSubMenuId(null);
                      setPhotoSubMenuPos(null);
                      setItemSubMenuId(null);
                      setItemSubMenuPos(null);
                    }
                  }}
                  onClick={(e) => { e.stopPropagation(); }}
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
                              fontFamily={item.fontFamily ?? 'sans-serif'}
                            />
                          </div>
                        );
                      }
                      return (
                        <div
                          className="item-text drag-handle"
                          style={{ 
                            ...getTextCssStyle(sid, item.color ?? '#333333', item.fontFamily ?? 'sans-serif'),
                            fontSize: `${item.fontSize}px` 
                          }}
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
                      style={
                        item.clipShape
                          ? getClipPathStyle(item.clipShape)
                          : item.slotStyle
                            ? item.slotStyle
                            : undefined
                      }
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

                {isSelected && (
                  <RotateHandle
                    itemId={item.id}
                    itemX={item.x}
                    itemY={item.y}
                    itemW={item.width}
                    itemH={item.height}
                    rotation={item.rotation}
                    onRotate={handleItemRotate}
                    position="topLeft"
                  />
                )}
              </Rnd>
            );
          })}
        </div>
      </main>

      {photoSubMenuId && photoSubMenuPos && (() => {
        const subItem = items.find(i => i.id === photoSubMenuId);
        if (!subItem) return null;
        const MENU_H = 4 * 44;
        const winH = window.innerHeight;
        const top = photoSubMenuPos.y + MENU_H > winH - 60
          ? photoSubMenuPos.y - MENU_H - subItem.height - 16
          : photoSubMenuPos.y;
        const left = Math.min(Math.max(photoSubMenuPos.x - 100, 8), window.innerWidth - 216);
        return (
          <div
            style={{
              position: 'fixed',
              top,
              left,
              zIndex: 99999,
              background: 'rgba(30,30,30,0.95)',
              borderRadius: 12,
              boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
              overflow: 'hidden',
              minWidth: 200,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
              touchAction: 'manipulation',
            }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          >
            {[
              { label: '前面へ',      icon: '⬆', onClick: () => { handleBringToFront(subItem.id); setPhotoSubMenuId(null); setPhotoSubMenuPos(null); } },
              { label: '背面へ',      icon: '⬇', onClick: () => { handleSendToBack(subItem.id);   setPhotoSubMenuId(null); setPhotoSubMenuPos(null); } },
              { label: 'トリミングする', icon: '✂️', onClick: () => { handleRetrimPhoto(subItem.id);  setPhotoSubMenuId(null); setPhotoSubMenuPos(null); } },
              { label: '写真を変更する', icon: '🔄', onClick: () => { handleReplacePhoto(subItem.id); setPhotoSubMenuId(null); setPhotoSubMenuPos(null); } },
            ].map((action, idx, arr) => (
              <button
                key={action.label}
                onPointerDown={e => e.stopPropagation()}
                onPointerUp={(e) => { e.stopPropagation(); action.onClick(); }}
                onClick={(e) => { e.stopPropagation(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '11px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 16, minWidth: 22 }}>{action.icon}</span>
                <span style={{ flex: 1 }}>{action.label}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {itemSubMenuId && itemSubMenuPos && (() => {
        const subItem = items.find(i => i.id === itemSubMenuId);
        if (!subItem) return null;
        const MENU_H = 2 * 44;
        const winH = window.innerHeight;
        const top = itemSubMenuPos.y + MENU_H > winH - 60
          ? itemSubMenuPos.y - MENU_H - subItem.height - 16
          : itemSubMenuPos.y;
        const left = Math.min(Math.max(itemSubMenuPos.x - 100, 8), window.innerWidth - 216);
        return (
          <div
            style={{
              position: 'fixed',
              top,
              left,
              zIndex: 99999,
              background: 'rgba(30,30,30,0.95)',
              borderRadius: 12,
              boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
              overflow: 'hidden',
              minWidth: 200,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
              touchAction: 'manipulation',
            }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          >
            {[
              { label: '前面へ', icon: '⬆', onClick: () => { handleBringToFront(subItem.id); setItemSubMenuId(null); setItemSubMenuPos(null); } },
              { label: '背面へ', icon: '⬇', onClick: () => { handleSendToBack(subItem.id);   setItemSubMenuId(null); setItemSubMenuPos(null); } },
            ].map((action, idx, arr) => (
              <button
                key={action.label}
                onPointerDown={e => e.stopPropagation()}
                onPointerUp={(e) => { e.stopPropagation(); action.onClick(); }}
                onClick={(e) => { e.stopPropagation(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '11px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 16, minWidth: 22 }}>{action.icon}</span>
                <span style={{ flex: 1 }}>{action.label}</span>
              </button>
            ))}
          </div>
        );
      })()}

      <nav className="bottom-menu">
        {!isPro && <AdBanner />}
        {activeMainTab !== null && (
          <div className="sub-menu" style={
            activeMainTab === 'template' && customPicking ? { height: 180 }
            : activeMainTab === 'text' ? { height: 160 }
            : activeMainTab === 'background' ? { height: 'auto' }
            : undefined
          }>
            {renderSubMenu()}
          </div>
        )}
        <div className="main-tabs">
          <button className={`tab-btn ${activeMainTab === 'background' ? 'active' : ''}`} onClick={() => handleTabToggle('background')}>
            <Grid size={22} /><span>背景変更</span>
          </button>

          <button className={`tab-btn ${activeMainTab === 'template' ? 'active' : ''}`} onClick={() => handleTabToggle('template')}>
            <LayoutTemplate size={22} /><span>写真枠配置</span>
          </button>

          <div style={{ position: 'relative', display: 'contents' }}>
            <button
              className={`tab-btn ${showPhotoAddMenu ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowPhotoAddMenu(prev => !prev); setActiveMainTab(null); }}
            >
              <ImagePlus size={22} /><span>写真追加</span>
            </button>

            {showPhotoAddMenu && (
              <div
                className="sub-menu"
                onClick={e => e.stopPropagation()}
                style={{
                  height: 'auto',
                  maxHeight: '180px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0',
                  padding: '0',
                  overflowX: 'hidden'
                }}
              >
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => { 
                    setTargetSlotId(null);
                    setSlotPickerTargetId(null);
                    setShowSlotPickerMenu(true);
                    setShowPhotoAddMenu(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid #eee',
                    color: '#333', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 24 }}>📷</span>
                  <div>
                    <div>１枚追加</div>
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>写真を選んでキャンバスに追加</div>
                  </div>
                </button>

                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => {
                    if (!isPro) { openUpgrade('ストック機能'); return; }
                    setStockDeleteSelected(new Set()); 
                    setShowStockOrganizer(true); 
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid #eee',
                    color: '#333', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 24 }}>🗂️</span>
                  <div>
                    <div>ストックを管理する {!isPro && <span style={{fontSize:10,color:'#f26b9a'}}>🔒 Pro</span>}</div>
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400 }}>ストックの写真を追加・削除</div>
                    <div style={{ fontSize: 9, color: '#f26b9a', fontWeight: 400, marginTop: 2 }}>
                      {`〔ストック１〕：${photoStocks[0].length}枚、〔ストック２〕：${photoStocks[1].length}枚、〔ストック３〕：${photoStocks[2].length}枚`}
                    </div>
                  </div>
                </button>

                {(() => {
                  const anyStockHasPhotos = photoStocks.some(s => s.length > 0);
                  const canOpen = anyStockHasPhotos;
                  return (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => {
                        if (!isPro) { openUpgrade('ストック機能'); return; }
                        if (!canOpen) return;
                        setShowFillStockPicker(true);
                        setShowPhotoAddMenu(false);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        width: '100%', padding: '12px 16px',
                        background: canOpen ? '#fff5f8' : 'transparent',
                        border: 'none',
                        color: canOpen ? 'var(--primary)' : '#ccc',
                        fontSize: 13, fontWeight: 600,
                        cursor: canOpen ? 'pointer' : 'default',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 18, minWidth: 24 }}>🎲</span>
                      <div>
                        <div>ストックから枠にランダムで入れる {!isPro && <span style={{fontSize:10,color:'#f26b9a'}}>🔒 Pro</span>}</div>
                        <div style={{ fontSize: 10, fontWeight: 400, color: (!anyStockHasPhotos || templateSlots.length === 0) ? '#ff6b6b' : '#aaa' }}>
                          {!anyStockHasPhotos
                            ? 'ストックに写真がありません'
                            : templateSlots.length === 0
                              ? '写真枠がありません'
                              : 'ストックを選んで配置'}
                        </div>
                      </div>
                    </button>
                  );
                })()}

                {photoStocks.some(s => s.length > 0) && (
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => {
                      if (!isPro) { openUpgrade('ストック機能'); return; }
                      if(window.confirm('すべてのストック写真を消去しますか？')) {
                        setPhotoStocks([[], [], []]); 
                        setShowPhotoAddMenu(false); 
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 16px',
                      background: 'transparent', border: 'none',
                      color: '#ff7070', fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 16, minWidth: 24 }}>🗑️</span>
                    <div>全ストックを消す {!isPro && <span style={{fontSize:10,color:'#f26b9a'}}>🔒 Pro</span>}</div>
                  </button>
                )}
              </div>
            )}
          </div>

          <button className={`tab-btn ${activeMainTab === 'stamp' ? 'active' : ''}`} onClick={() => handleTabToggle('stamp')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a5 5 0 0 1 5 5c0 2-1 3.5-2.5 4.5V13h-5v-1.5C8 10.5 7 9 7 7a5 5 0 0 1 5-5z"/>
              <rect x="7" y="13" width="10" height="3" rx="1"/>
              <rect x="5" y="16" width="14" height="3" rx="1"/>
            </svg>
            <span>スタンプ</span>
          </button>
          <button className={`tab-btn ${activeMainTab === 'text' ? 'active' : ''}`} onClick={() => handleTabToggle('text')}>
            <svg width="22" height="22" viewBox="0 0 24 24">
              <text x="1" y="18" fontSize="16" fontWeight="bold" fontFamily="serif" fill="currentColor">Aa</text>
            </svg>
            <span>テキスト</span>
          </button>
        </div>
      </nav>

      <input id="photo-upload" type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
      <input id="photo-replace-upload" type="file" accept="image/*" onChange={handleReplaceFileUpload} style={{ display: 'none' }} />
      <input id="photo-stock-upload" type="file" accept="image/*" multiple onChange={handleStockFileUpload} style={{ display: 'none' }} />
      <input id="photo-stock-add-organizer" type="file" accept="image/*" multiple onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;
        e.target.value = '';
        const photos = await Promise.all(files.map(fileToStockPhoto));
        setPhotoStocks(prev => {
          const next = prev.map(s => [...s]) as StockPhoto[][];
          next[activeStockIndex] = [...next[activeStockIndex], ...photos];
          return next;
        });
      }} style={{ display: 'none' }} />

      {/* ===== 日付フィルタモーダル ===== */}
      {showDateFilter && (() => {
        const from = dateFilterFrom ? new Date(dateFilterFrom) : null;
        const to = dateFilterTo ? new Date(dateFilterTo + 'T23:59:59') : null;
        const filtered = pendingStockPhotos.filter(p => {
          if (!p.takenAt) return true;
          if (from && p.takenAt < from) return false;
          if (to && p.takenAt > to) return false;
          return true;
        });
        const monthMap: Record<string, number> = {};
        pendingStockPhotos.forEach(p => {
          if (!p.takenAt) return;
          const key = `${p.takenAt.getFullYear()}年${p.takenAt.getMonth()+1}月`;
          monthMap[key] = (monthMap[key] ?? 0) + 1;
        });
        const monthEntries = Object.entries(monthMap).sort((a, b) => a[0] < b[0] ? -1 : 1);
        const noDateCount = pendingStockPhotos.filter(p => !p.takenAt).length;

        return (
          <div
            onClick={() => {
              setPhotoStocks(prev => {
                const next = prev.map(s => [...s]) as StockPhoto[][];
                next[activeStockIndex] = [...next[activeStockIndex], ...pendingStockPhotos];
                return next;
              });
              setPendingStockPhotos([]);
              setShowDateFilter(false);
            }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.78)',
              zIndex: 10002,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 500,
                background: '#1a1a1a',
                borderRadius: '18px 18px 0 0',
                paddingBottom: 'env(safe-area-inset-bottom)',
                maxHeight: '88dvh',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>📅 日付で絞り込む</span>
                  <button
                    onClick={() => {
                      setPhotoStocks(prev => {
                        const next = prev.map(s => [...s]) as StockPhoto[][];
                        next[activeStockIndex] = [...next[activeStockIndex], ...pendingStockPhotos];
                        return next;
                      });
                      setPendingStockPhotos([]);
                      setShowDateFilter(false);
                    }}
                    style={{ background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer' }}
                  >絞り込まずに全部追加（ストック{activeStockIndex + 1}）</button>
                </div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  選んだ {pendingStockPhotos.length} 枚から、期間を指定してストック{activeStockIndex + 1}に追加できます
                </div>
              </div>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {monthEntries.length > 0 && (
                  <div style={{ padding: '10px 16px 6px' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>📊 写真の内訳</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {monthEntries.map(([month, count]) => (
                        <button
                          key={month}
                          onClick={() => {
                            const m = month.match(/(\d+)年(\d+)月/);
                            if (!m) return;
                            const y = parseInt(m[1]), mo = parseInt(m[2]);
                            const last = new Date(y, mo, 0).getDate();
                            setDateFilterFrom(`${y}-${String(mo).padStart(2,'0')}-01`);
                            setDateFilterTo(`${y}-${String(mo).padStart(2,'0')}-${String(last).padStart(2,'0')}`);
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 20,
                            border: '1.5px solid rgba(242,107,154,0.5)',
                            background: 'rgba(242,107,154,0.10)',
                            color: '#f26b9a', fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          {month} ({count}枚)
                        </button>
                      ))}
                      {noDateCount > 0 && (
                        <span style={{
                          padding: '4px 10px', borderRadius: 20,
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#666', fontSize: 11,
                        }}>日付不明 {noDateCount}枚</span>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ padding: '10px 16px' }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}><code>`📆 期間を指定`</code></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>開始日</div>
                      <input
                        type="date"
                        value={dateFilterFrom}
                        onChange={e => setDateFilterFrom(e.target.value)}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: 8,
                          border: '1.5px solid rgba(255,255,255,0.15)',
                          background: '#2a2a2a', color: '#fff', fontSize: 13,
                          colorScheme: 'dark',
                        }}
                      />
                    </div>
                    <span style={{ color: '#666', fontSize: 14, marginTop: 16 }}>〜</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>終了日</div>
                      <input
                        type="date"
                        value={dateFilterTo}
                        onChange={e => setDateFilterTo(e.target.value)}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: 8,
                          border: '1.5px solid rgba(255,255,255,0.15)',
                          background: '#2a2a2a', color: '#fff', fontSize: 13,
                          colorScheme: 'dark',
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: '今月', fn: () => {
                        const now = new Date();
                        const y = now.getFullYear(), mo = now.getMonth()+1;
                        const last = new Date(y, mo, 0).getDate();
                        setDateFilterFrom(`${y}-${String(mo).padStart(2,'0')}-01`);
                        setDateFilterTo(`${y}-${String(mo).padStart(2,'0')}-${String(last).padStart(2,'0')}`);
                      }},
                      { label: '先月', fn: () => {
                        const now = new Date();
                        const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
                        const y = d.getFullYear(), mo = d.getMonth()+1;
                        const last = new Date(y, mo, 0).getDate();
                        setDateFilterFrom(`${y}-${String(mo).padStart(2,'0')}-01`);
                        setDateFilterTo(`${y}-${String(mo).padStart(2,'0')}-${String(last).padStart(2,'0')}`);
                      }},
                      { label: '今年', fn: () => {
                        const y = new Date().getFullYear();
                        setDateFilterFrom(`${y}-01-01`);
                        setDateFilterTo(`${y}-12-31`);
                      }},
                      { label: '全期間', fn: () => {
                        const dates = pendingStockPhotos.filter(p => p.takenAt).map(p => p.takenAt!);
                        if (dates.length === 0) return;
                        const min = new Date(Math.min(...dates.map(d => d.getTime())));
                        const max = new Date(Math.max(...dates.map(d => d.getTime())));
                        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        setDateFilterFrom(fmt(min));
                        setDateFilterTo(fmt(max));
                      }},
                    ].map(btn => (
                      <button
                        key={btn.label}
                        onClick={btn.fn}
                        style={{
                          padding: '4px 12px', borderRadius: 16,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.06)',
                          color: '#ccc', fontSize: 11, cursor: 'pointer',
                        }}
                      >{btn.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{ padding: '4px 16px 12px' }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                    🖼️ 絞り込み結果: <span style={{ color: filtered.length > 0 ? '#f26b9a' : '#666', fontWeight: 700 }}>{filtered.length}枚</span>
                    {filtered.length !== pendingStockPhotos.length && (
                      <span style={{ color: '#555' }}> / {pendingStockPhotos.length}枚中</span>
                    )}
                  </div>
                  {filtered.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
                      {filtered.slice(0, 20).map((p, i) => (
                        <div key={i} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                          <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {p.takenAt && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', fontSize: 7, color: '#ddd', padding: '1px 3px', textAlign: 'center' }}>
                              {p.takenAt.getMonth()+1}/{p.takenAt.getDate()}
                            </div>
                          )}
                        </div>
                      ))}
                      {filtered.length > 20 && (
                        <div style={{ aspectRatio: '1/1', borderRadius: 6, background: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#888' }}>
                          +{filtered.length - 20}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '16px 0', textAlign: 'center', color: '#555', fontSize: 12 }}>
                      該当する写真がありません
                    </div>
                  )}
                </div>
              </div>

              <div style={{ padding: '12px 16px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setPendingStockPhotos([]); setShowDateFilter(false); }}
                  style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#aaa', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >キャンセル</button>
                <button
                  disabled={filtered.length === 0}
                  onClick={() => {
                    setPhotoStocks(prev => {
                      const next = prev.map(s => [...s]) as StockPhoto[][];
                      next[activeStockIndex] = [...next[activeStockIndex], ...filtered];
                      return next;
                    });
                    setPendingStockPhotos([]);
                    setShowDateFilter(false);
                  }}
                  style={{ flex: 2, padding: '11px', borderRadius: 10, border: 'none', background: filtered.length > 0 ? '#f26b9a' : '#444', color: '#fff', fontSize: 13, fontWeight: 700, cursor: filtered.length > 0 ? 'pointer' : 'default' }}
                >
                  {filtered.length}枚をストック{activeStockIndex + 1}に追加
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== ストック整理モーダル ===== */}
      {showStockOrganizer && (() => {
        const photoStock = photoStocks[activeStockIndex];
        const stockColors: string[] = ['#f26b9a', '#4caf7d', '#5b9bd5'];
        const stockEmojis = ['🟠', '🟢', '🔵'];
        const stockColor = stockColors[activeStockIndex];
        return (
          <div
            onClick={() => setShowStockOrganizer(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10001, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: '#1e1e1e', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom)', maxHeight: '85dvh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>ストックを整理する</span>
                <button onClick={() => setShowStockOrganizer(false)} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>✕</button>
              </div>

              <div style={{ display: 'flex', gap: 0, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {([0, 1, 2] as const).map(idx => {
                  const isActive = activeStockIndex === idx;
                  const cnt = photoStocks[idx].length;
                  const color = stockColors[idx];
                  return (
                    <button
                      key={idx}
                      onClick={() => { setActiveStockIndex(idx); setStockDeleteSelected(new Set()); }}
                      style={{ flex: 1, padding: '10px 4px 8px', background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', borderBottom: isActive ? `2.5px solid ${color}` : '2.5px solid transparent', color: isActive ? '#fff' : '#888', fontSize: 12, fontWeight: isActive ? 700 : 400, cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span>{stockEmojis[idx]}</span>
                        <span>ストック{idx + 1}</span>
                      </div>
                      <div style={{ fontSize: 10, color: isActive ? color : '#666', marginTop: 2 }}>{cnt}枚</div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  onClick={() => document.getElementById('photo-stock-add-organizer')?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: `1.5px dashed ${stockColor}99`, background: `${stockColor}1a`, color: stockColor, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >＋ 写真を追加</button>
                <button
                  onClick={() => {
                    if (stockDeleteSelected.size === photoStock.length) {
                      setStockDeleteSelected(new Set());
                    } else {
                      setStockDeleteSelected(new Set(photoStock.map((_, i) => i)));
                    }
                  }}
                  style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#ccc', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                >
                  {stockDeleteSelected.size === photoStock.length && photoStock.length > 0 ? '全解除' : '全選択'}
                </button>
                {stockDeleteSelected.size > 0 && (
                  <button
                    onClick={() => {
                      setPhotoStocks(prev => {
                        const next = prev.map(s => [...s]) as StockPhoto[][];
                        next[activeStockIndex] = next[activeStockIndex].filter((_, i) => !stockDeleteSelected.has(i));
                        return next;
                      });
                      setStockDeleteSelected(new Set());
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: '8px', padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(220,60,60,0.85)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                  >🗑️ {stockDeleteSelected.size}枚削除</button>
                )}
                {photoStock.length > 0 && stockDeleteSelected.size === 0 && (
                  <button
                    onClick={() => {
                      if (!window.confirm(`ストック${activeStockIndex + 1}の写真を全部削除しますか？`)) return;
                      setPhotoStocks(prev => {
                        const next = prev.map(s => [...s]) as StockPhoto[][];
                        next[activeStockIndex] = [];
                        return next;
                      });
                    }}
                    style={{ marginLeft: 'auto', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'rgba(180,40,40,0.5)', color: '#ff9090', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
                  >このストックを空にする</button>
                )}
              </div>

              <div style={{ overflowY: 'auto', padding: '10px 12px', flex: 1 }}>
                {(() => {
                  type Group = { label: string; indices: number[] };
                  const groups: Group[] = [];
                  const groupMap: Record<string, number[]> = {};
                  const noDateIndices: number[] = [];
                  photoStock.forEach((p, i) => {
                    if (!p.takenAt) { noDateIndices.push(i); return; }
                    const key = `${p.takenAt.getFullYear()}年${p.takenAt.getMonth()+1}月${p.takenAt.getDate()}日`;
                    if (!groupMap[key]) groupMap[key] = [];
                    groupMap[key].push(i);
                  });
                  Object.entries(groupMap)
                    .sort((a, b) => a[0] < b[0] ? -1 : 1)
                    .forEach(([label, indices]) => groups.push({ label, indices }));
                  if (noDateIndices.length > 0) groups.push({ label: '日付不明', indices: noDateIndices });

                  if (groups.length === 0) {
                    return (
                      <div style={{ padding: '32px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>
                        ストック{activeStockIndex + 1}に写真がありません
                      </div>
                    );
                  }

                  return groups.map(group => (
                    <div key={group.label} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600 }}>{group.label}</span>
                        <button
                          onClick={() => {
                            const allSelected = group.indices.every(i => stockDeleteSelected.has(i));
                            setStockDeleteSelected(prev => {
                              const next = new Set(prev);
                              if (allSelected) { group.indices.forEach(i => next.delete(i)); }
                              else { group.indices.forEach(i => next.add(i)); }
                              return next;
                            });
                          }}
                          style={{ fontSize: 10, color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                        >
                          {group.indices.every(i => stockDeleteSelected.has(i)) ? '解除' : 'この日を選択'}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {group.indices.map(idx => {
                          const p = photoStock[idx];
                          const checked = stockDeleteSelected.has(idx);
                          return (
                            <div
                              key={idx}
                              onClick={() => setStockDeleteSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx); else next.add(idx);
                                return next;
                              })}
                              style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden', border: checked ? `2.5px solid ${stockColor}` : '2px solid rgba(255,255,255,0.07)', cursor: 'pointer', transition: 'border-color 0.12s' }}
                            >
                              <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              <div style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: checked ? stockColor : 'rgba(0,0,0,0.45)', border: `2px solid ${checked ? '#fff' : 'rgba(255,255,255,0.5)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s' }}>
                                {checked && (
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                    <path d="M1.5 5 L4 7.5 L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              <div style={{ padding: '12px 16px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button onClick={() => { setStockDeleteSelected(new Set()); setShowStockOrganizer(false); }} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: '#3b4f7a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>完了</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== 枠クリック時の写真選択元メニュー ===== */}
      {showSlotPickerMenu && (
        <div
          onClick={() => { setShowSlotPickerMenu(false); setSlotPickerTargetId(null); setTargetSlotId(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10003, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: '#1e1e1e', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>📷 写真をどこから選ぶ？</span>
              <button onClick={() => { setShowSlotPickerMenu(false); setSlotPickerTargetId(null); setTargetSlotId(null); }} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => {
                  setShowSlotPickerMenu(false);
                  document.getElementById('photo-upload')?.click();
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: 26 }}>📱</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>デバイスから選ぶ</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>カメラロールや写真アプリから</div>
                </div>
              </button>

              {([0, 1, 2] as const).map(idx => {
                const stockColors = ['#f26b9a', '#4caf7d', '#5b9bd5'];
                const stockEmojis = ['🟠', '🟢', '🔵'];
                const color = stockColors[idx];
                const stock = photoStocks[idx];
                const count = stock.length;
                const canUse = count > 0;
                return (
                  <div key={idx}>
                    <button
                      onClick={() => {}}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 6px', width: '100%', borderRadius: canUse ? '12px 12px 0 0' : 12, border: `1.5px solid ${canUse ? color + '88' : 'rgba(255,255,255,0.08)'}`, borderBottom: canUse ? 'none' : undefined, background: canUse ? `${color}18` : 'rgba(255,255,255,0.03)', color: canUse ? '#fff' : '#555', cursor: 'default', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: 22 }}>{stockEmojis[idx]}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>ストック{idx + 1}から選ぶ</div>
                        <div style={{ fontSize: 11, color: canUse ? color : '#555', marginTop: 1 }}>
                          {count === 0 ? '写真がありません' : `${count}枚`}
                        </div>
                      </div>
                    </button>

                    {canUse && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, padding: '6px 8px 8px', background: `${color}10`, border: `1.5px solid ${color}88`, borderTop: 'none', borderRadius: '0 0 12px 12px', maxHeight: 150, overflowY: 'auto' }}>
                        {stock.map((photo, photoIdx) => (
                          <div
                            key={photoIdx}
                            onClick={() => handleSlotPickFromStock(idx, photo.url)}
                            style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `1.5px solid ${color}55`, flexShrink: 0 }}
                          >
                            <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== ランダム配置ストック選択ポップアップ ===== */}
      {showFillStockPicker && (
        <div
          onClick={() => setShowFillStockPicker(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10003, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: '#1e1e1e', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>🎲 どのストックから配置する？</span>
              <button onClick={() => setShowFillStockPicker(false)} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {([0, 1, 2] as const).map(idx => {
                const count = photoStocks[idx].length;
                const stockColors = ['#f26b9a', '#4caf7d', '#5b9bd5'];
                const stockEmojis = ['🟠', '🟢', '🔵'];
                const color = stockColors[idx];
                const canUse = count > 0;
                const hasSlots = templateSlots.length > 0;
                return (
                  <button
                    key={idx}
                    onClick={() => canUse && handleFillStockSelected(idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${canUse ? color + '88' : 'rgba(255,255,255,0.08)'}`, background: canUse ? `${color}18` : 'rgba(255,255,255,0.03)', color: canUse ? '#fff' : '#555', cursor: canUse ? 'pointer' : 'default', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 24 }}>{stockEmojis[idx]}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>ストック{idx + 1}</div>
                      <div style={{ fontSize: 11, color: count === 0 ? '#555' : !hasSlots ? '#ff6b6b' : color, marginTop: 2 }}>
                        {count === 0
                          ? '写真がありません'
                          : !hasSlots
                            ? '写真枠がありません'
                            : `${count}枚 → ${templateSlots.length}枠にランダム配置`}
                      </div>
                    </div>
                    {canUse && <div style={{ marginLeft: 'auto', fontSize: 20, color }}>→</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== ランダム配置モード選択ダイアログ ===== */}
      {showFillModeDialog && pendingFillStockIdx !== null && (() => {
        const filledSlotIds = new Set(
          items
            .filter(item => item.type === 'photo')
            .map(item => {
              const m = item.id.match(/^photo-slot-(.+?)-\d+/);
              return m ? m[1] : null;
            })
            .filter(Boolean)
        );
        const hasEmptySlot = templateSlots.some(slot => !filledSlotIds.has(slot.id));
        const emptyCount = templateSlots.filter(slot => !filledSlotIds.has(slot.id)).length;
        const totalCount = templateSlots.length > 0 ? templateSlots.length : items.filter(item => item.type === 'photo').length;
        return (
          <div
            onClick={() => { setShowFillModeDialog(false); setPendingFillStockIdx(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10004, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, background: '#1e1e1e', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>🎲 どのように配置しますか？</span>
                <button onClick={() => { setShowFillModeDialog(false); setPendingFillStockIdx(null); }} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {hasEmptySlot && (
                  <button
                    onClick={() => handleFillAllSlots(pendingFillStockIdx!, true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 12, border: '1.5px solid #4caf7d88', background: '#4caf7d18', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 28 }}>✨</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>あいている枠に入れる</div>
                      <div style={{ fontSize: 11, color: '#4caf7d', marginTop: 3 }}>空き枠 {emptyCount} 枠にランダム配置</div>
                    </div>
                  </button>
                )}
                <button
                  onClick={() => handleFillAllSlots(pendingFillStockIdx!, false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 12, border: '1.5px solid #f26b9a88', background: '#f26b9a18', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontSize: 28 }}>🔀</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>すべて写真を入れ替える</div>
                    <div style={{ fontSize: 11, color: '#f26b9a', marginTop: 3 }}>全 {totalCount} 枠をランダムに置換</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showUpgradeModal && (
        <UpgradeModal featureName={upgradeFeatureName} onClose={() => setShowUpgradeModal(false)} />
      )}

      {cropImageUrl && (
        <CropModal imageUrl={cropImageUrl} initialShape={cropInitialShape} onComplete={handleCropComplete} onCancel={() => { setCropImageUrl(null); setTargetSlotId(null); setCropInitialShape(undefined); }} />
      )}

      {previewUrl && (
        <PreviewModal dataUrl={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}

      {/* ログインモーダル */}
      {showLoginModal && (
        <LoginScreen onClose={() => setShowLoginModal(false)} />
      )}
    </div>
  );
}