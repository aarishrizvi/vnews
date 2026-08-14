'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Fingerprint, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function Navbar() {
  const pathname = usePathname();
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Do not show on admin routes
  if (pathname?.startsWith('/admin')) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 glass-panel border-x-0 border-t-0 rounded-none bg-background/50">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 group-hover:bg-indigo-500/30 transition-colors">
            <Fingerprint size={20} />
          </div>
          <span className="font-bold tracking-wider text-foreground">VNEWS LAB</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link href="/" className={`transition-colors ${pathname === '/' ? 'text-indigo-400' : 'text-foreground/60 hover:text-foreground'}`}>Search</Link>
          <Link href="/the-lab" className={`transition-colors ${pathname === '/the-lab' ? 'text-indigo-400' : 'text-foreground/60 hover:text-foreground'}`}>The Lab</Link>
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {loading ? (
          <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
        ) : user ? (
          /* Logged in — show avatar with dropdown */
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex items-center gap-2.5 group"
              aria-label="Account menu"
            >
              {user.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  width={32}
                  height={32}
                  className="rounded-full ring-2 ring-white/10 group-hover:ring-white/30 transition-all"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-500/30 flex items-center justify-center text-xs font-semibold text-indigo-300 ring-2 ring-white/10 group-hover:ring-white/30 transition-all">
                  {user.displayName?.[0] || user.email?.[0] || '?'}
                </div>
              )}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 mt-2 w-56 glass-panel rounded-xl p-1 shadow-2xl border border-white/10"
                >
                  <div className="px-3 py-2.5 border-b border-white/[0.06] mb-1">
                    <p className="text-sm font-medium text-foreground/90 truncate">{user.displayName}</p>
                    <p className="text-xs text-foreground/40 truncate mt-0.5">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { signOut(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground/60 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* Logged out — Sign In button */
          <button
            onClick={signInWithGoogle}
            className="flex items-center gap-2 text-xs font-semibold tracking-wide px-4 py-2 rounded-full border border-glass-border hover:bg-glass-light transition-colors text-foreground/80"
          >
            <GoogleIcon />
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}
