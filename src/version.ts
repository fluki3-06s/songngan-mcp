declare const __SONGNGAN_VERSION__: string | undefined;

export const VERSION: string = typeof __SONGNGAN_VERSION__ === 'string' ? __SONGNGAN_VERSION__ : '0.0.0-dev';
