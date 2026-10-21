/** Toasts — short confirmations and errors at the bottom of the screen. */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert } from 'lucide-react';

type Kind = 'success' | 'error';
interface ToastState {
  id: number;
  text: string;
  kind: Kind;
}

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

/** One toast at a time, bottom-centre. `offset` keeps it above sticky bottom bars. */
export function ToastProvider({ children, offset = 24 }: { children: ReactNode; offset?: number }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now();
    setToast({ id, text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), kind === 'error' ? 4500 : 2800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: `calc(${offset}px + env(safe-area-inset-bottom))` }} aria-live="polite">
        {toast ? (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`flex max-w-md animate-rise items-center gap-2.5 rounded-[14px] px-4 py-3 text-sm font-medium leading-snug shadow-[0_16px_40px_-14px_rgba(31,24,20,.6)] ${
              toast.kind === 'error' ? 'bg-danger text-white' : 'bg-espresso text-paper'
            }`}
          >
            {toast.kind === 'error' ? <CircleAlert className="size-4 shrink-0" aria-hidden /> : <Check className="size-4 shrink-0 text-[#9fd3ae]" aria-hidden />}
            {toast.text}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
