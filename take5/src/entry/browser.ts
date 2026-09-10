import type { LaunchOptions, BrowserContextOptions } from 'playwright';
import type { Settings } from '../config.ts';

/**
 * One place that decides how Chromium is launched, shared by the submitter and
 * the form recorder so a proxy configured for one applies to both.
 */

export function launchOptions(settings: Settings): LaunchOptions {
  const proxy =
    settings.proxyServer ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    '';

  return {
    headless: settings.headless,
    // Loopback never goes through a proxy — that would break a locally hosted
    // form and the service's own endpoints.
    ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1,::1' } } : {}),
    ...(settings.browserExecutablePath ? { executablePath: settings.browserExecutablePath } : {}),
  };
}

export function contextOptions(settings: Settings): BrowserContextOptions {
  return {
    locale: 'en-AU',
    timezoneId: settings.timezone,
    // Off by default; a MITM proxy's CA is the only reason to turn it on.
    ignoreHTTPSErrors: settings.ignoreHttpsErrors,
  };
}
