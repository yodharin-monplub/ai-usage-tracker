/// <reference types="vite/client" />
import type { AiTrackerApi } from '../shared/types';

declare global {
  interface Window {
    aiTracker: AiTrackerApi;
  }
}

export {};
