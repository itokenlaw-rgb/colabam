// ====================================================
// UpgradeModal.tsx
// src/UpgradeModal.tsx として配置してください
// ====================================================
// ★ STRIPE_PAYMENT_LINK を自分のStripe Payment LinkのURLに書き換えてください
// ====================================================

import React from 'react';
import { auth } from './firebase';

// ★ Stripe ダッシュボード → Payment Links → 作成したリンクのURL
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_dRm9AT1qlcNbb9ZdZJaMU00';

interface UpgradeModalProps {
  onClose: () => void;
  featureName?: string; // 「この機能を使うには〜」の機能名
}

export function UpgradeModal({ onClose, featureName }: UpgradeModalProps) {
  const uid = auth.currentUser?.uid ?? '';

  // Payment Link に UID を付与すると Webhook 側でユーザー特定できる
  const paymentUrl = uid
    ? `${STRIPE_PAYMENT_LINK}?client_reference_id=${uid}`
    : STRIPE_PAYMENT_LINK;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 20000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360,
          background: '#fff',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        }}
      >
        {/* ヘッダー */}
        <div style={{
          background: 'linear-gradient(135deg, #f26b9a, #9b59b6)',
          padding: '24px 20px 20px',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✨</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 4 }}>
            Pro にアップグレード
          </div>
          {featureName && (
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              「{featureName}」はProプランで使えます
            </div>
          )}
        </div>

        {/* 特典リスト */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.8 }}>
            {[
              '🎨 ハート・星・ふきだし形状',
              '🚫 広告なし',
              '🖼️ 背景画像フルセット（追加予定）',
            ].map((item, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                {item}
              </div>
            ))}
          </div>

          {/* 価格表示 */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 28, fontWeight: 'bold', color: '#f26b9a' }}>¥480</span>
            <span style={{ fontSize: 13, color: '#888' }}> / 月（税込）</span>
          </div>

          {/* アップグレードボタン */}
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              background: 'linear-gradient(135deg, #f26b9a, #9b59b6)',
              color: '#fff',
              textDecoration: 'none',
              textAlign: 'center',
              padding: '14px',
              borderRadius: 12,
              fontWeight: 'bold',
              fontSize: 15,
              marginBottom: 10,
            }}
          >
            今すぐアップグレード →
          </a>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px', border: 'none',
              background: 'none', color: '#aaa', fontSize: 13, cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
