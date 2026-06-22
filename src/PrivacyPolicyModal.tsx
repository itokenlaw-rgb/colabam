// ====================================================
// PrivacyPolicyModal.tsx
// src/PrivacyPolicyModal.tsx として配置してください
// ====================================================
// Google AdSense の審査通過に必要な開示事項を含むプライバシーポリシーです。
// 内容は一般的なテンプレートです。実際の運用に合わせて加筆・修正してください
// （弁護士による確認を推奨します。法的アドバイスではありません）。
// ====================================================

import type { ReactNode } from 'react';
import { APP_NAME, OPERATOR_NAME, CONTACT_EMAIL, POLICY_LAST_UPDATED } from './legalConfig';

interface PrivacyPolicyModalProps {
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

export function PrivacyPolicyModal({ onClose }: PrivacyPolicyModalProps) {
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
          width: '100%', maxWidth: 480,
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
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>プライバシーポリシー</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, color: '#bbb', cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* 本文（スクロール） */}
        <div style={{ overflowY: 'auto', padding: '20px 22px', flex: 1 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 18 }}>
            最終更新日：{POLICY_LAST_UPDATED}
          </div>

          <Section title="はじめに">
            {OPERATOR_NAME}（以下「運営者」といいます）は、運営者が提供するアプリ「{APP_NAME}」（以下「本サービス」といいます）における、利用者の情報の取り扱いについて、本プライバシーポリシー（以下「本ポリシー」といいます）を定めます。本サービスをご利用いただくことで、本ポリシーに同意いただいたものとみなします。
          </Section>

          <Section title="収集する情報">
            本サービスでは、以下の情報を取得することがあります。
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>アカウント登録時のメールアドレス（Googleログインを利用する場合は、Googleアカウントの基本情報）</li>
              <li>有料プランご利用時の決済情報（決済処理は決済代行会社のStripe社が行い、クレジットカード番号等は運営者のサーバーには保存されません）</li>
              <li>利用者が本サービス内で作成・アップロードする画像やテキスト等のコンテンツ（編集や保存のために一時的または保存目的で処理されます）</li>
              <li>Cookie、IPアドレス、ブラウザの種類、アクセス日時などのアクセスログ情報</li>
              <li>広告配信や利用状況の分析のために、後述の第三者サービスを通じて収集される情報</li>
            </ul>
          </Section>

          <Section title="情報の利用目的">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>本サービスの提供、維持、改善のため</li>
              <li>利用者からのお問い合わせへの対応のため</li>
              <li>有料プランの決済処理および管理のため</li>
              <li>利用状況の分析、不正利用の防止のため</li>
              <li>広告の配信およびその効果測定のため</li>
            </ul>
          </Section>

          <Section title="Google AdSenseおよび広告配信用Cookieについて">
            本サービスは、第三者配信の広告サービス「Google AdSense」を利用しています。Googleを含む第三者配信事業者は、Cookie（ウェブサイトの訪問者のブラウザに保存される情報）を使用して、利用者が本サービスや他のサイトに過去にアクセスした履歴に基づいた広告を配信することがあります。
            <br /><br />
            Googleが広告Cookieを使用することにより、Google及びそのパートナーは、本サービスや他のサイトへのアクセス情報に基づいて広告を配信できます。利用者は、
            <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" style={{ color: '#f26b9a' }}>Google広告設定ページ</a>
            にアクセスすることで、パーソナライズ広告を無効にすることができます。また、Google以外の第三者配信事業者が使用するCookieについては、
            <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer" style={{ color: '#f26b9a' }}>www.aboutads.info</a>
            から無効化の設定が可能です。
            <br /><br />
            本サービスでは、Google AdSense以外にも、以下のような広告・解析関連の第三者サービスを利用する場合があります。これらの事業者は、それぞれの基準に基づいて独自にCookieやアクセス情報を取得し、利用することがあります。詳細は各事業者のプライバシーポリシーをご確認ください。
          </Section>

          <Section title="利用している第三者サービス">
            本サービスは、以下の外部サービスを利用しています。各サービスにおける情報の取り扱いについては、各社のプライバシーポリシーもご確認ください。
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>
                <strong>Google AdSense / Google Analytics 等（Google LLC）</strong>
                ：広告配信および利用状況の解析のために利用しています。
                <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" style={{ color: '#f26b9a' }}>Googleのポリシーと規約</a>
              </li>
              <li>
                <strong>Firebase（Google LLC）</strong>
                ：ログイン認証、データの保存のために利用しています。
                <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#f26b9a' }}>Firebaseのプライバシーとセキュリティ</a>
              </li>
              <li>
                <strong>Stripe（Stripe, Inc.）</strong>
                ：有料プランの決済処理のために利用しています。クレジットカード情報等はStripe社が管理し、運営者は取得しません。
                <a href="https://stripe.com/jp/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#f26b9a' }}>Stripeのプライバシーポリシー</a>
              </li>
            </ul>
          </Section>

          <Section title="Cookieの利用について">
            本サービスでは、利用者の利便性向上、ログイン状態の保持、広告配信、アクセス解析のためにCookieを使用しています。利用者は、ブラウザの設定によりCookieの受け取りを拒否することができますが、その場合、本サービスの一部の機能が正しく動作しない可能性があります。
          </Section>

          <Section title="第三者への情報提供">
            運営者は、以下の場合を除き、利用者の個人情報を本人の同意なく第三者に提供することはありません。
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>法令に基づき開示が必要な場合</li>
              <li>人の生命、身体または財産の保護のために必要があり、本人の同意を得ることが困難な場合</li>
              <li>上記「利用している第三者サービス」に記載の業務委託先に、業務遂行上必要な範囲で提供する場合</li>
            </ul>
          </Section>

          <Section title="アップロードされたコンテンツの取り扱い">
            利用者が本サービス内で作成・保存する画像やテキストは、本サービスの機能（アルバム作成・保存）を提供する目的でのみ処理されます。運営者は、利用者の同意なく、これらのコンテンツを目的外に利用しません。
          </Section>

          <Section title="未成年者の利用について">
            本サービスは、特定の年齢層を対象としたものではありません。13歳未満の方がご利用される場合は、保護者の同意のもとでご利用ください。運営者は、未成年者から不必要に個人情報を取得することを意図していません。
          </Section>

          <Section title="情報の開示・削除等のご依頼">
            利用者は、運営者が保有する自己の個人情報について、開示、訂正、削除等を求めることができます。ご希望の場合は、本ポリシー末尾のお問い合わせ先までご連絡ください。本人確認の上、合理的な範囲で対応いたします。
          </Section>

          <Section title="プライバシーポリシーの変更">
            本ポリシーの内容は、利用者への事前の通知なく変更されることがあります。変更後のプライバシーポリシーは、本サービス内に掲載した時点から効力を生じるものとします。
          </Section>

          <Section title="お問い合わせ窓口">
            本ポリシーに関するお問い合わせは、以下の窓口までご連絡ください。
            <div style={{ marginTop: 8 }}>
              運営者：{OPERATOR_NAME}<br />
              メールアドレス：
              <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#f26b9a' }}>{CONTACT_EMAIL}</a>
            </div>
          </Section>
        </div>

        {/* フッター */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px',
              background: '#f26b9a', color: 'white',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
