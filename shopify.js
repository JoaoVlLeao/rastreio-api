// shopify.js
import fetch from 'node-fetch'; // Necessário para Node.js no Render

const STORE_URL = (process.env.SHOPIFY_STORE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.SHOPIFY_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!STORE_URL || !API_TOKEN) {
  console.error('❌ Shopify não configurado. Verifique as Variáveis de Ambiente no Render.');
}

const BASE = `${STORE_URL}/admin/api/${API_VERSION}`;
const HEADERS = {
  'X-Shopify-Access-Token': API_TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// --- UTILS ---
function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.append(k, v);
  return u.toString();
}

async function shopifyGet(path, params = {}) {
  try {
      const res = await fetch(`${BASE}${path}?${qs(params)}`, { headers: HEADERS });
      if (!res.ok) {
        if (res.status === 429) {
            console.log("⏳ Rate limit Shopify (429). Aguardando...");
            await new Promise(r => setTimeout(r, 2000));
            return shopifyGet(path, params);
        }
        console.error(`Erro Shopify GET ${path}: ${res.status} ${res.statusText}`);
        return {};
      }
      return res.json();
  } catch (e) {
      console.error(`Erro requisição Shopify: ${e.message}`);
      return {};
  }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- TRACKING ---
function extractTracking(order) {
  let trackingNumber = null, carrier = null;
  if (order?.fulfillments?.length) {
    const f = [...order.fulfillments].reverse().find(x => x.tracking_number);
    if (f) {
      trackingNumber = f.tracking_number;
      carrier = f.tracking_company;
    }
  }
  return { trackingNumber, carrier };
}

// --- PUBLIC EXPORTS (Essas são as funções que o index.js precisa) ---

export function summarizeOrder(order) {
  if (!order) return null;

  const tr = extractTracking(order);
  
  let st = 'processando';
  if (order.cancelled_at) st = 'cancelado';
  else if (order.fulfillment_status === 'fulfilled') st = 'enviado';
  else if (order.fulfillment_status === null && tr.trackingNumber) st = 'enviado';

  return {
    id: order.id,
    name: order.name,
    email: order.email || order.customer?.email,
    createdAt: order.created_at,
    status: st,
    customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Cliente',
    ...tr
  };
}

export async function getOrderByNumber(num) {
  const name = `#${String(num).replace(/\D/g, '')}`;
  const d = await shopifyGet('/orders.json', { name, status: 'any', limit: 1 });
  return d.orders?.[0] || null;
}

export async function getOrdersByEmail(email, limit = 5) {
  const d = await shopifyGet('/orders.json', { email, status: 'any', limit });
  return d.orders || [];
}

// ESTA É A FUNÇÃO QUE ESTAVA FALTANDO OU COM ERRO
export async function searchOrders(query) {
  if (!query) return [];
  const raw = String(query).trim();
  const digits = onlyDigits(raw);

  try {
    // 1. Tenta por Email
    if (isEmail(raw)) return await getOrdersByEmail(raw);

    // 2. Tenta por Número do Pedido
    // Se o cliente digitar só "1024", adicionamos o #
    // Se o cliente digitar "#1024", mantemos.
    const orderName = raw.startsWith('#') ? raw : `#${digits}`;
    
    // Busca exata pelo nome do pedido
    const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
    if (d.orders && d.orders.length > 0) {
        return d.orders;
    }

    return [];
  } catch (e) {
    console.error('❌ Search Error:', e);
    return [];
  }
}