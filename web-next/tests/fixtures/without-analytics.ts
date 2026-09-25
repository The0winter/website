import {test as base, expect, type BrowserContext} from '@playwright/test';

// Apply to each context before navigating, including popups in that context.
export async function blockAnalytics(context:BrowserContext) {
  await context.route(/^https?:\/\/(?:[^/]+\.)?(?:google-analytics\.com|googletagmanager\.com|analytics\.google\.com|stats\.g\.doubleclick\.net)\//, route=>route.abort());
}

export const test=base.extend<{analyticsIsolation:void}>({
  analyticsIsolation:[async({context},use)=>{await blockAnalytics(context);await use();},{auto:true}],
});
export {expect};
