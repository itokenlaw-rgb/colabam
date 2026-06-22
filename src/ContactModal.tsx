// ====================================================
// ContactModal.tsx
// src/ContactModal.tsx として配置してください
// ====================================================
// 簡易お問い合わせフォームです。
// ★ 重要：このアプリにはサーバー側のメール送信機能（バックエンド）が
//   ないため、フォーム送信時には利用者のメールアプリ（mailto:）を
//   開いて内容を引き渡す方式にしています。
//   利用者がそのままメールアプリで送信ボタンを押すまでは、実際には
//   メールは送信されません。
//
//   もし「アプリ内で完結する送信」にしたい場合は、Firebase Functions等の
//   バックエンドで送信処理を実装する必要があります（UpgradeModal.tsx の
//   createPortalSession と同様の仕組みで実現できます）。必要であれば
//   お知らせください。
// ====================================================

import { useState } from 'react';
import { APP_NAME, CONTACT_EMAIL } from './legalConfig';

interface ContactModalProps {
  onClose: () => void;
}

export function ContactModal({ onClose }: ContactModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const isValid = email.trim() !== '' && message.trim() !== '';

  const handleSubmit = () => {
    if (!isValid) return;

    const subject = `【${APP_NAME}】お問い合わせ`;
    const body =
      `お名前：${name || '（未記入）'}\n` +
      `メールアドレス：${email}\n\n` +
      `お問い合わせ内容：\n${message}`;

    const mailtoUrl = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
    setSent(true);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 40000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          maxHeight: '85vh',
          background: '#fff',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ヘッダー */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>お問い合わせ</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, color: '#bbb', cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div style={{ overflowY: 'auto', padding: '20px 22px', flex: 1 }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✉️</div>
              <div style={{ fontSize: 14, color: '#333', fontWeight: 'bold', marginBottom: 8 }}>
                メールアプリを開きました
              </div>
              <div style={{ fontSize: 12, color: '#777', lineHeight: 1.7 }}>
                内容を確認のうえ、メールアプリの送信ボタンを押して完了してください。
                メールアプリが開かない場合は、下記アドレスへ直接ご連絡ください。
              </div>
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#f26b9a' }}>{CONTACT_EMAIL}</a>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 16, lineHeight: 1.7 }}>
                ご不明点やご要望などがございましたら、以下のフォームよりお気軽にご連絡ください。送信ボタンを押すと、お使いのメールアプリが開きます。
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  お名前（任意）
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="山田 太郎"
                  style={{ width: '100%', padding: '11px 12px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' as const }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  メールアドレス <span style={{ color: '#e05555' }}>※必須</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{ width: '100%', padding: '11px 12px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' as const }}
                />
              </div>

              <div style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  お問い合わせ内容 <span style={{ color: '#e05555' }}>※必須</span>
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="お問い合わせ内容をご記入ください"
                  rows={5}
                  style={{ width: '100%', padding: '11px 12px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' as const, resize: 'vertical' as const, fontFamily: 'inherit' }}
                />
              </div>
            </>
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          {sent ? (
            <button
              onClick={onClose}
              style={{ width: '100%', padding: '12px', background: '#444', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 'bold', cursor: 'pointer' }}
            >
              閉じる
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              style={{
                width: '100%', padding: '12px',
                background: isValid ? '#f26b9a' : '#f3b9cb',
                color: 'white', border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 'bold',
                cursor: isValid ? 'pointer' : 'default',
              }}
            >
              送信する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
