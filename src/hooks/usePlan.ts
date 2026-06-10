// ====================================================
// usePlan.ts
// src/hooks/usePlan.ts として配置してください
// ====================================================

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

export type Plan = 'free' | 'pro';

interface UsePlanResult {
  user: User | null;
  plan: Plan;
  isPro: boolean;
  loading: boolean;
}

export function usePlan(): UsePlanResult {
  const [user, setUser]   = useState<User | null>(null);
  const [plan, setPlan]   = useState<Plan>('free');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. ログイン状態を監視
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        // 未ログイン → 無料プラン
        setPlan('free');
        setLoading(false);
        return;
      }

      // 2. Firestore の users/{uid} を監視してプランを取得
      const ref = doc(db, 'users', firebaseUser.uid);
      const unsubDoc = onSnapshot(ref, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setPlan(data.plan === 'pro' ? 'pro' : 'free');
        } else {
          // ドキュメントが存在しない場合は無料扱い
          setPlan('free');
        }
        setLoading(false);
      });

      // onAuthStateChanged のクリーンアップ時に Firestore 監視も解除
      return () => unsubDoc();
    });

    return () => unsubAuth();
  }, []);

  return { user, plan, isPro: plan === 'pro', loading };
}
