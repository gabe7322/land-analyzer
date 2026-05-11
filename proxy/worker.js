/**
 * LandPortal API proxy — Cloudflare Worker
 *
 * Deploy steps:
 *   1. workers.cloudflare.com → Create Worker → paste this file → Deploy
 *   2. Worker Settings → Variables → Add secret: LP_JWT = <your JWT>
 *   3. Copy the worker URL (e.g. https://lp-proxy.yourname.workers.dev)
 *   4. Paste it into LP_PROXY at the top of index.html
 *
 * The worker forwards all requests to the LandPortal REST API,
 * injects the JWT server-side, and returns CORS headers so the
 * browser accepts the response.
 */

const LP_API = 'https://landportal.com/wp-json/lp-rest-api/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = LP_API + url.pathname + url.search;

    const headers = new Headers();
    headers.set('Authorization', 'Bearer ' + env.LP_JWT);
    headers.set('Content-Type', 'application/json');

    const upstream = new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const resp = await fetch(upstream);
    const out = new Headers(resp.headers);
    Object.entries(CORS).forEach(([k, v]) => out.set(k, v));

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: out,
    });
  },
};
