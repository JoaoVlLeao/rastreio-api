// shopify.js - VERSÃO HIGH TRAFFIC (VARREDURA DE 10.000 PEDIDOS)
import fetch from 'node-fetch';

const STORE_URL = (process.env.SHOPIFY_STORE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.SHOPIFY_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

// CONFIGURAÇÃO DE VARREDURA
// 250 pedidos por página. 40 páginas = 10.000 pedidos.
// CUIDADO: Quanto maior, mais demora para achar se o pedido for antigo.
const MAX_PAGES_TO_SCAN = 40; 

if (!STORE_URL || !API_TOKEN) {
  console.error('❌ Shopify não configurado.');
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

// Função auxiliar para extrair o link da próxima página do Header da Shopify
function getNextPageUrl(linkHeader) {
    if (!linkHeader) return null;
    // Padrão: <...page_info=xxx>; rel="next"
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
}

async function shopifyGet(url) {
  try {
      const res = await fetch(url, { headers: HEADERS });
      
      if (!res.ok) {
        if (res.status === 429) {
            // Se bater no limite, espera 2 segundos e tenta de novo
            console.log("⏳ Rate limit Shopify. Aguardando...");
            await new Promise(r => setTimeout(r, 2000));
            return shopifyGet(url);
        }
        return { error: res.status };
      }
      
      const data = await res.json();
      const link = res.headers.get('link'); // Pega o link da próxima página
      return { data, link };
  } catch (e) {
      console.error(`Erro Shopify: ${e.message}`);
      return { error: e.message };
  }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- BUSCAS ESPECÍFICAS ---

// 1. Busca CPF (Rápido - Indexado)
async function getOrderByCPF(cpf) {
    const url = `${BASE}/customers/search.json?query=${cpf}&limit=1`;
    const { data } = await shopifyGet(url);
    
    if (data && data.customers && data.customers.length > 0) {
        const customer = data.customers[0];
        // Pega último pedido do cliente
        const orderUrl = `${BASE}/orders.json?customer_id=${customer.id}&status=any&limit=1`;
        const { data: orderData } = await shopifyGet(orderUrl);
        return orderData?.orders?.[0] || null;
    }
    return null;
}

// 2. Busca Rastreio (Lento - Varredura Recursiva)
async function scanOrdersForTracking(trackingCode) {
    const cleanCode = trackingCode.trim().toUpperCase();
    console.log(`🔎 Iniciando varredura profunda por rastreio: ${cleanCode}`);

    // Começa pela primeira página, pegando apenas campos essenciais para ser mais leve
    let nextUrl = `${BASE}/orders.json?status=any&limit=250&fields=id,name,fulfillments,created_at,financial_status,customer,line_items,total_price,currency,shipping_address`;
    
    let pagesCount = 0;

    while (nextUrl && pagesCount < MAX_PAGES_TO_SCAN) {
        pagesCount++;
        const { data, link } = await shopifyGet(nextUrl);

        if (!data || !data.orders) break;

        // Procura na página atual
        const found = data.orders.find(order => {
            return order.fulfillments && order.fulfillments.some(f => 
                f.tracking_number && f.tracking_number.toUpperCase() === cleanCode
            );
        });

        if (found) {
            console.log(`✅ Encontrado na página ${pagesCount}!`);
            return found;
        }

        // Se não achou, prepara a próxima página
        nextUrl = getNextPageUrl(link);
        
        // Pequena pausa para não estourar a CPU do Render ou rate limit
        if (nextUrl) await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`❌ Não encontrado após varrer ${pagesCount} páginas.`);
    return null;
}

// --- EXPORT PRINCIPAL ---
export async function searchOrders(query) {
  if (!query) return [];
  const raw = String(query).trim();
  const digits = onlyDigits(raw);

  try {
    // A. É E-mail? (Instantâneo)
    if (isEmail(raw)) {
        const url = `${BASE}/orders.json?email=${encodeURIComponent(raw)}&status=any&limit=1`;
        const { data } = await shopifyGet(url);
        return data?.orders || [];
    }

    // B. É CPF? (Rápido)
    if (digits.length === 11) {
        const byCPF = await getOrderByCPF(digits);
        if (byCPF) return [byCPF];
    }

    // C. É Número de Pedido? (Instantâneo)
    // Se for só números e menor que 11 dígitos, assumimos que é número de pedido
    if (digits.length > 0 && digits.length < 11 && !/[a-zA-Z]/.test(raw)) {
        const orderName = raw.startsWith('#') ? raw : `#${digits}`;
        const url = `${BASE}/orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`;
        const { data } = await shopifyGet(url);
        if (data?.orders?.length > 0) return data.orders;
    }

    // D. Sobrou: Deve ser Código de Rastreio (Varredura)
    // Se tiver letras ou for longo, tentamos escanear
    if (/[a-zA-Z]/.test(raw) || digits.length > 12) {
        const byTracking = await scanOrdersForTracking(raw);
        if (byTracking) return [byTracking];
    }

    return [];

  } catch (e) {
    console.error('❌ Erro crítico na busca:', e);
    return [];
  }
}