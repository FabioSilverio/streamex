"use client";

import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn, EASE_DRAWER, EASE_OUT } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Centered dialog. Modals stay centered (transform-origin: center is correct here).
 * Enter 220ms ease-out from scale(0.96); exit snaps in 140ms — the system response is faster than the arrival.
 */
export function Modal({ open, onClose, title, subtitle, icon, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE_OUT } }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-[2px] p-0 sm:p-4"
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, transform: "translateY(16px) scale(0.97)" }}
            animate={{
              opacity: 1,
              transform: "translateY(0px) scale(1)",
              transition: { duration: 0.24, ease: EASE_DRAWER },
            }}
            exit={{
              opacity: 0,
              transform: "translateY(8px) scale(0.98)",
              transition: { duration: 0.15, ease: EASE_OUT },
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "liquid-glass-panel w-full rounded-t-[28px] sm:rounded-[28px] overflow-hidden flex flex-col max-h-[92dvh] focus:outline-none pb-[env(safe-area-inset-bottom)]",
              className,
            )}
          >
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-4">
              <div className="flex items-center gap-3 min-w-0">
                {icon && (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white">
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-white">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="text-[13px] text-white/50 leading-snug mt-0.5">{subtitle}</p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="press shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-white/60 hover:bg-white/[0.12] hover:text-white"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
