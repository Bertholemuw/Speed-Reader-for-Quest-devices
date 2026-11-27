import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNative } from './platform';

// Stack of handlers for the Android back button: the most recently opened layer (modal, view) closes first.
const stack: { current: () => void }[] = [];

let installed = false;
export const installBackButton = (onEmpty: () => void) => {
  if (!isNative || installed) return;
  installed = true;
  CapApp.addListener('backButton', () => {
    const top = stack[stack.length - 1];
    if (top) top.current();
    else onEmpty();
  });
};

/** While `active`, the Android back button calls `handler` instead of the default action. */
export const useBackHandler = (active: boolean, handler: () => void) => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    stack.push(ref);
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
};

export const exitApp = () => { if (isNative) CapApp.exitApp(); };
