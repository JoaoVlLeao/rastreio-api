// index.js - ATUALIZADO
import express from 'express';
import cors from 'cors';
import { searchOrders } from './shopify.js';

const app = express();

app.use(cors({ origin: '*' }));

app.get('/api/rastreio', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Faltou o parâmetro de busca.' });
    }

    try {
        const orders = await searchOrders(query);

        if (!orders || orders.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        const order = orders[0];
        
        // Tenta pegar o tracking number. Se houver vários, tenta achar o que parece com a query
        let trackingNumber = null;
        if (order.fulfillments && order.fulfillments.length > 0) {
            // Prioriza o tracking que foi buscado, se não, pega o primeiro disponível
            const match = order.fulfillments.find(f => f.tracking_number === query);
            trackingNumber = match ? match.tracking_number : order.fulfillments[0].tracking_number;
        }

        // Monta o objeto completo para o Frontend
        const responseData = {
            name: order.name,
            created_at: order.created_at,
            trackingNumber: trackingNumber,
            customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Cliente',
            financial_status: order.financial_status,
            // Lista de produtos
            line_items: order.line_items.map(item => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price
            })),
            total_discounts: order.total_discounts,
            total_price: order.total_price,
            // Endereço para personalizar textos
            shipping_address: order.shipping_address || {}
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