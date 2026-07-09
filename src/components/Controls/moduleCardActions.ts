import { useEffect, useRef } from 'react';

/**
 * The Auto (⚡) / Reset (↺) handlers a module surfaces to its card header.
 * Each module keeps ownership of its real handlers; the card header just calls
 * whichever ones the mounted module registered (see ModuleCardHeader).
 */
export interface ModuleCardActions {
  /** Present only on modules with an auto function (⚡). Omit → no Auto chip. */
  auto?: () => void;
  /** Reset ↺. Present on essentially every module. */
  reset?: () => void;
}

export type RegisterModuleCardActions = (actions: ModuleCardActions | null) => void;

/**
 * Register a mounted module's Auto/Reset handlers with the parent card header,
 * via STABLE wrapper functions backed by a ref.
 *
 * Module components pass `onParamsChange` inline arrows, so their own reset/auto
 * useCallbacks change identity every parent render. Registering those directly
 * would re-run this effect → setState in the parent → re-render → loop. Instead
 * we register once per mount and dispatch through `ref.current`, so the header
 * always calls the LATEST handler without the effect re-firing.
 *
 * Whether a module HAS an auto function is static per component, so the wrapper
 * shape is fixed at first registration (read from the initial `handlers`).
 */
export function useRegisterModuleCardActions(
  onRegister: RegisterModuleCardActions | undefined,
  handlers: ModuleCardActions,
): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!onRegister) return;
    onRegister({
      auto: handlers.auto ? () => ref.current.auto?.() : undefined,
      reset: handlers.reset ? () => ref.current.reset?.() : undefined,
    });
    return () => onRegister(null);
    // `handlers` is intentionally excluded: presence of auto/reset is static per
    // component, and live values are read through `ref.current` on each call.
  }, [onRegister]);
}
