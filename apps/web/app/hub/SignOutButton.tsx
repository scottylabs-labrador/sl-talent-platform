'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: '/login' })}
      style={{
        height: 44,
        padding: '0 22px',
        borderRadius: 100,
        border: '1px solid #c7d2dc',
        background: '#fff',
        color: '#1e1e1e',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      Sign out
    </button>
  );
}
