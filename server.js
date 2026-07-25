// ============================================
// COLIVOYAGE BACKEND - server.js
// Version 2.0 - Code propre
// ============================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// SUPABASE (initialisation sécurisée)
// ============================================
let supabase = null;
let supabaseStatus = '❌ Non configuré';

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    supabaseStatus = '✅ Connecté';
    console.log('✅ Supabase connecté');
  } catch (error) {
    supabaseStatus = '❌ Erreur : ' + error.message;
    console.log('❌ Erreur Supabase:', error.message);
  }
} else {
  console.log('⚠️ Supabase non configuré');
  console.log('   SUPABASE_URL:', process.env.SUPABASE_URL ? 'OK' : 'MANQUANT');
  console.log('   SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANT');
}

// ============================================
// PAYPAL (configuration)
// ============================================
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_BASE_URL = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let paypalStatus = '❌ Non configuré';
if (PAYPAL_CLIENT_ID && PAYPAL_SECRET) {
  paypalStatus = `✅ Configuré (${PAYPAL_MODE})`;
  console.log(`✅ PayPal configuré en mode ${PAYPAL_MODE}`);
} else {
  console.log('⚠️ PayPal non configuré');
}

// ============================================
// ROUTE PRINCIPALE (page d'accueil)
// ============================================
app.get('/', (req, res) => {
  res.json({
    status: '🟢 ColiVoyage Backend opérationnel',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    services: {
      supabase: supabaseStatus,
      paypal: paypalStatus
    },
    env_check: {
      SUPABASE_URL: process.env.SUPABASE_URL ? 'OK' : 'MANQUANT',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANT',
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID ? 'OK' : 'MANQUANT',
      PAYPAL_SECRET: process.env.PAYPAL_SECRET ? 'OK' : 'MANQUANT',
      PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox (défaut)'
    }
  });
});

// ============================================
// ROUTE HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    supabase: supabaseStatus,
    paypal: paypalStatus
  });
});

// ============================================
// PAYPAL - Fonction helper pour obtenir token
// ============================================
async function getPayPalToken() {
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`
      ).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  return data.access_token;
}

// ============================================
// PAYPAL - Créer une commande
// ============================================
app.post('/api/paypal/create-order', async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return res.status(503).json({ error: 'PayPal non configuré' });
  }

  try {
    const { plan, userId } = req.body;
    const amount = plan === 'monthly' ? '2.49' : '9.99';

    const token = await getPayPalToken();

    const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'EUR', value: amount },
          description: `ColiVoyage Premium ${plan}`,
          custom_id: userId || 'anonymous'
        }]
      })
    });

    const order = await response.json();

    // Sauvegarder dans Supabase si disponible
    if (supabase && userId) {
      await supabase.from('payments').insert({
        user_id: userId,
        method: 'paypal',
        amount: parseFloat(amount),
        currency: 'EUR',
        plan: plan,
        status: 'pending',
        external_id: order.id
      });
    }

    res.json({
      id: order.id,
      links: order.links,
      success: true
    });

  } catch (error) {
    console.error('PayPal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PAYPAL - Capturer un paiement
// ============================================
app.post('/api/paypal/capture', async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return res.status(503).json({ error: 'PayPal non configuré' });
  }

  try {
    const { orderId, userId, plan } = req.body;
    const token = await getPayPalToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );

    const capture = await response.json();

    if (capture.status === 'COMPLETED' && supabase && userId) {
      const premiumUntil = new Date();
      if (plan === 'monthly') {
        premiumUntil.setMonth(premiumUntil.getMonth() + 1);
      } else {
        premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
      }

      await supabase.from('users').update({
        is_premium: true,
        premium_plan: plan,
        premium_since: new Date().toISOString(),
        premium_until: premiumUntil.toISOString()
      }).eq('id', userId);

      await supabase.from('payments').update({
        status: 'completed'
      }).eq('external_id', orderId);
    }

    res.json({
      status: capture.status,
      success: true
    });

  } catch (error) {
    console.error('PayPal capture error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// UTILISATEURS
// ============================================
app.get('/api/user/:userId', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.params.userId)
      .single();
    if (error) return res.status(404).json({ error: 'Non trouvé' });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/user', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
  try {
    const { data } = await supabase.from('users').insert(req.body).select().single();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRAJETS
// ============================================
app.get('/api/trajets', async (req, res) => {
  if (!supabase) return res.json([]);
  try {
    const { data } = await supabase.from('trajets').select('*').eq('is_active', true);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/trajets', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
  try {
    const { data } = await supabase.from('trajets').insert(req.body).select().single();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// COLIS
// ============================================
app.get('/api/colis', async (req, res) => {
  if (!supabase) return res.json([]);
  try {
    const { data } = await supabase.from('colis').select('*').eq('status', 'en_attente');
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/colis', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
  try {
    const { data } = await supabase.from('colis').insert(req.body).select().single();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DÉMARRAGE SERVEUR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🚀 ColiVoyage Backend v2.0.0       ║');
  console.log(`║   Port: ${PORT}                          ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log(`💾 Supabase: ${supabaseStatus}`);
  console.log(`🅿️  PayPal:  ${paypalStatus}`);
  console.log('');
});
