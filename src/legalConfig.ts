// ====================================================
// legalConfig.ts
// src/legalConfig.ts として配置してください
// ====================================================
// アプリ名・運営者情報・連絡先メールアドレスをここで一括管理します。
// PrivacyPolicyModal.tsx と ContactModal.tsx の両方がこの値を参照します。
//
// ★★★ 下記の値を実際の情報に書き換えてください ★★★
//   - OPERATOR_NAME : 運営者の氏名（個人の場合）または屋号・会社名
//   - CONTACT_EMAIL : お問い合わせ・削除依頼を受け取るメールアドレス
//   - POLICY_LAST_UPDATED : プライバシーポリシーの最終更新日
// ====================================================

export const APP_NAME = 'コラボアム';

// 運営者名（個人開発の場合は氏名、屋号があれば屋号でも可）
export const OPERATOR_NAME = 'HobbyFlow';

// お問い合わせ受付用メールアドレス
export const CONTACT_EMAIL = 'syumisira@gmail.com';

// プライバシーポリシーの最終更新日（更新したら都度書き換えてください）
export const POLICY_LAST_UPDATED = '2026年6月22日';
