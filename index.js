import express from 'express';
import cors from 'cors';
import { searchOrders, summarizeOrder } from './shopify.js';

const app = express();

// IMPORTANTE: Isso libera o CORS para o seu HTML funcionar
app.use(cors({
    origin: '*' // Depois você pode trocar '*' pelo seu domínio 'https://aquafitbrasil.com' para mais segurança
}));

app.get('/api/rastreio', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Faltou o parâmetro de busca.' });
    }

    try {
        console.log(`Recebendo busca: ${query}`);
        
        // Usa a sua função poderosa do shopify.js
        const orders = await searchOrders(query);

        if (!orders || orders.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        // Pega o pedido mais recente
        const order = orders[0];
        
        // Formata os dados para o frontend
        // Se sua função summarizeOrder não estiver exportada no shopify.js, 
        // você pode retornar o 'order' direto ou extrair aqui manualmente.
        const responseData = {
            name: order.name,
            created_at: order.created_at,
            trackingNumber: order.fulfillments?.[0]?.tracking_number || null,
            customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Cliente'
        };

        return res.json(responseData);

    } catch (error) {
        console.error("Erro no servidor:", error);
        return res.status(500).json({ error: 'Erro interno ao processar pedido.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});