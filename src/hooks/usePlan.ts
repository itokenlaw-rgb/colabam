// ====================================================
// usePlan.ts
// src/hooks/usePlan.ts として配置してください
// ====================================================
import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
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
    // Firestore購読を外側で管理する
    let unsubDoc: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      // 前のFirestore購読を必ず解除
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      setUser(firebaseUser);

      if (!firebaseUser) {
        setPlan('free');
        setLoading(false);
        return;
      }

      // Firestore監視開始
      const ref = doc(db, 'users', firebaseUser.uid);
      unsubDoc = onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setPlan(data.plan === 'pro' ? 'pro' : 'free');
          } else {
            setPlan('free');
          }
          setLoading(false);
        },
        // エラー時（permission-deniedなど）は無料扱いにして静かに終了
        (_err) => {
          setPlan('free');
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubDoc) unsubDoc();
    };
  }, []);

  return { user, plan, isPro: plan === 'pro', loading };
}