require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// ============ MIDDLEWARE ============
app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json());

// ============ CLIENTS (Version robuste) ============
let supabase = null;
let paypalClient = null;
let paypal = null;

// Supabase - Ne crash pas si non configuré
try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        console.log('✅ Supabase connecté');
    } else {
        console.log('⚠️ Supabase non configuré - variables manquantes');
        console.log('   SUPABASE_URL:', process.env.SUPABASE_URL ? 'présent' : 'MANQUANT');
        console.log('   SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'présent' : 'MANQUANT');
    }
} catch (error) {
    console.log('❌ Erreur Supabase:', error.message);
}

// PayPal - Ne crash pas si non configuré
try {
    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET) {
        paypal = require('@paypal/checkout-server-sdk');
        const paypalEnv = process.env.PAYPAL_MODE === 'live'
            ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
            : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
        paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);
        console.log('✅ PayPal connecté');
    } else {
        console.log('⚠️ PayPal non configuré');
    }
} catch (error) {
    console.log('❌ Erreur PayPal:', error.message);
}

// ============================================
// 🏠 ROUTE TEST
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: '✅ ColiVoyage API is running!',
        version: '1.0.0',
        message: 'Backend opérationnel 🚀',
        services: {
            supabase: supabase ? '✅ Connected' : '❌ Not configured',
            paypal: paypalClient ? '✅ Connected' : '❌ Not configured'
        },
        env_check: {
            SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'missing',
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'set' : 'missing',
            PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID ? 'set' : 'missing',
            PAYPAL_SECRET: process.env.PAYPAL_SECRET ? 'set' : 'missing',
            FRONTEND_URL: process.env.FRONTEND_URL || 'missing',
            PORT: process.env.PORT || 3000
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// 🅿️ PAYPAL - CRÉER UNE COMMANDE
// ============================================
app.post('/api/paypal/create-order', async (req, res) => {
    if (!paypalClient) return res.status(503).json({ error: 'PayPal non configuré' });
    try {
        const { plan, userId } = req.body;
        const amount = plan === 'monthly' ? '2.49' : '9.99';

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: { currency_code: 'EUR', value: amount },
                description: `ColiVoyage Premium ${plan}`,
                custom_id: userId || 'anonymous'
            }],
            application_context: {
                brand_name: 'ColiVoyage',
                return_url: `${process.env.FRONTEND_URL}/?payment=success&method=paypal`,
                cancel_url: `${process.env.FRONTEND_URL}/?payment=cancel`,
                user_action: 'PAY_NOW'
            }
        });

        const order = await paypalClient.execute(request);
        res.json({ id: order.result.id, links: order.result.links, success: true });
    } catch (error) {
        console.error('PayPal error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/paypal/capture', async (req, res) => {
    if (!paypalClient) return res.status(503).json({ error: 'PayPal non configuré' });
    try {
        const { orderId, userId, plan } = req.body;
        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await paypalClient.execute(request);

        if (capture.result.status === 'COMPLETED' && supabase && userId) {
            const premiumUntil = new Date();
            if (plan === 'monthly') premiumUntil.setMonth(premiumUntil.getMonth() + 1);
            else premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
            await supabase.from('users').update({
                is_premium: true, premium_plan: plan,
                premium_since: new Date().toISOString(),
                premium_until: premiumUntil.toISOString()
            }).eq('id', userId);
        }
        res.json({ status: capture.result.status, success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 👤 UTILISATEURS
// ============================================
app.get('/api/user/:userId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    try {
        const { data, error } = await supabase.from('users').select('*').eq('id', req.params.userId).single();
        if (error) return res.status(404).json({ error: 'Non trouvé' });
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/user', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    try {
        const { data } = await supabase.from('users').insert(req.body).select().single();
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// ✈️ TRAJETS
// ============================================
app.get('/api/trajets', async (req, res) => {
    if (!supabase) return res.json([]);
    try {
        const { data } = await supabase.from('trajets').select('*').eq('is_active', true);
        res.json(data || []);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/trajets', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    try {
        const { data } = await supabase.from('trajets').insert(req.body).select().single();
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// 📦 COLIS
// ============================================
app.get('/api/colis', async (req, res) => {
    if (!supabase) return res.json([]);
    try {
        const { data } = await supabase.from('colis').select('*').eq('status', 'en_attente');
        res.json(data || []);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/colis', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    try {
        const { data } = await supabase.from('colis').insert(req.body).select().single();
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================
// 🚀 DÉMARRAGE
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ColiVoyage Backend running on port ${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'production'}`);
});
