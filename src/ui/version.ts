// Версия игры для титула и «Об игре». Источник — package.json (Vite импортирует JSON и оставляет только поле version).
// Если сборка задаст define __APP_VERSION__ (vite.config.ts), берётся он.

import { version as pkgVersion } from '../../package.json';

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : pkgVersion;
