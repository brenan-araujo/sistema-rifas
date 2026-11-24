const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword, createCampaign, reserveTickets } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de Autenticação para Rotas Admin
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Faça login para continuar.' });
  }

  const token = authHeader.split(' ')[1];
  const session = db.prepare(`
    SELECT s.token, s.expires_at, u.id, u.username, u.name 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);

  if (!session) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }

  req.user = session;
  next();
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  // Token válido por 7 dias
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, user.id, expiresAt);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name
    }
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true, message: 'Desconectado com sucesso.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      name: req.user.name
    }
  });
});

app.post('/api/admin/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash, user.salt)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }

  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, req.user.id);

  res.json({ success: true, message: 'Senha alterada com sucesso!' });
});

// ==========================================
// ROTAS PÚBLICAS (100% SIGILOSAS)
// ==========================================

// Listar campanhas ativas
app.get('/api/campaigns', (req, res) => {
  const campaigns = db.prepare(`
    SELECT 
      c.id, c.title, c.description, c.prize, c.total_numbers,
      c.draw_date, c.image_url,
      c.status, c.winner_number, c.created_at,
      COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count,
      COUNT(CASE WHEN t.status != 'available' THEN 1 END) as reserved_count
    FROM campaigns c
    LEFT JOIN tickets t ON c.id = t.campaign_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();

  res.json(campaigns);
});

// Detalhes de uma campanha
app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db.prepare(`
    SELECT 
      c.id, c.title, c.description, c.prize, c.total_numbers,
      c.draw_date, c.image_url,
      c.status, c.winner_number, c.created_at,
      COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count,
      COUNT(CASE WHEN t.status != 'available' THEN 1 END) as reserved_count
    FROM campaigns c
    LEFT JOIN tickets t ON c.id = t.campaign_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(req.params.id);

  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  res.json(campaign);
});

// Grade de números da campanha (PÚBLICA - NENHUM DADO PESSOAL É ENVIADO!)
app.get('/api/campaigns/:id/numbers', (req, res) => {
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  // ATENÇÃO: NUNCA selecione buyer_name, buyer_phone, buyer_address nesta query pública!
  const numbers = db.prepare(`
    SELECT number, status
    FROM tickets
    WHERE campaign_id = ?
    ORDER BY number ASC
  `).all(req.params.id);

  res.json(numbers);
});

// Comprar / Reservar números (Público)
app.post('/api/campaigns/:id/reserve', (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const { numbers, name, phone, address } = req.body;

  if (!name || name.trim().length < 3) {
    return res.status(400).json({ error: 'Por favor, informe seu nome completo (mínimo 3 caracteres).' });
  }

  // Validação simples de telefone (mínimo 10 dígitos numéricos)
  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Por favor, informe um telefone/WhatsApp válido com DDD (ex: 11 99999-9999).' });
  }

  if (!address || address.trim().length < 5) {
    return res.status(400).json({ error: 'Por favor, informe seu endereço completo.' });
  }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um número de rifa.' });
  }

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  if (campaign.status !== 'active') {
    return res.status(400).json({ error: 'Esta campanha não está aberta para novas reservas no momento.' });
  }

  try {
    reserveTickets(
      campaignId,
      numbers.map(n => parseInt(n, 10)),
      name.trim(),
      phone.trim(),
      address.trim()
    );

    res.json({
      success: true,
      message: `${numbers.length} número(s) marcado(s) com sucesso!`,
      reserved_numbers: numbers,
      buyer_name: name.trim(),
      campaign_title: campaign.title
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// ROTAS ADMINISTRATIVAS (PROTEGIDAS POR LOGIN)
// ==========================================

// Listar todas as campanhas no admin (métricas de cotas reservadas e livres)
app.get('/api/admin/campaigns', requireAuth, (req, res) => {
  const campaigns = db.prepare(`
    SELECT 
      c.*,
      COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count,
      COUNT(CASE WHEN t.status != 'available' THEN 1 END) as reserved_count,
      ROUND(CAST(COUNT(CASE WHEN t.status != 'available' THEN 1 END) AS REAL) * 100 / c.total_numbers, 1) as percentage_reserved
    FROM campaigns c
    LEFT JOIN tickets t ON c.id = t.campaign_id
    GROUP BY c.id
    ORDER BY c.id DESC
  `).all();

  res.json(campaigns);
});

// Criar nova campanha com quantidade personalizada de números
app.post('/api/admin/campaigns', requireAuth, (req, res) => {
  const {
    title,
    description,
    prize,
    total_numbers,
    draw_date,
    image_url,
    status
  } = req.body;

  if (!title || !prize || !total_numbers) {
    return res.status(400).json({ error: 'Título, prêmio e quantidade de números são obrigatórios.' });
  }

  const totalNum = parseInt(total_numbers, 10);
  if (isNaN(totalNum) || totalNum < 1 || totalNum > 100000) {
    return res.status(400).json({ error: 'A quantidade de números deve ser um número inteiro entre 1 e 100.000.' });
  }

  try {
    const campaignId = createCampaign({
      title: title.trim(),
      description: (description || '').trim(),
      prize: prize.trim(),
      total_numbers: totalNum,
      draw_date: (draw_date || '').trim(),
      image_url: (image_url || '').trim(),
      status: status || 'active'
    });

    res.json({
      success: true,
      message: `Campanha criada com sucesso contendo ${totalNum} números!`,
      campaign_id: campaignId
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar campanha: ' + err.message });
  }
});

// Editar campanha existente
app.put('/api/admin/campaigns/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const {
    title,
    description,
    prize,
    price,
    draw_date,
    pix_key,
    pix_type,
    pix_beneficiary,
    image_url,
    status
  } = req.body;

  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  db.prepare(`
    UPDATE campaigns SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      prize = COALESCE(?, prize),
      price = COALESCE(?, price),
      draw_date = COALESCE(?, draw_date),
      pix_key = COALESCE(?, pix_key),
      pix_type = COALESCE(?, pix_type),
      pix_beneficiary = COALESCE(?, pix_beneficiary),
      image_url = COALESCE(?, image_url),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(
    title, description, prize, price ? parseFloat(price) : null,
    draw_date, pix_key, pix_type, pix_beneficiary, image_url, status,
    id
  );

  res.json({ success: true, message: 'Campanha atualizada com sucesso!' });
});

// Excluir campanha
app.delete('/api/admin/campaigns/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  res.json({ success: true, message: 'Campanha excluída com sucesso.' });
});

// LISTA DE DADOS SIGILOSOS DOS PARTICIPANTES (ÁREA RESTRITA - PROTEGIDA POR LOGIN)
app.get('/api/admin/campaigns/:id/tickets', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  const { status, search } = req.query;

  let query = `
    SELECT 
      id, campaign_id, number, status,
      buyer_name, buyer_phone, buyer_address,
      reserved_at, paid_at, notes
    FROM tickets
    WHERE campaign_id = ?
  `;
  const params = [req.params.id];

  if (status && ['available', 'reserved', 'paid'].includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search && search.trim().length > 0) {
    query += ' AND (buyer_name LIKE ? OR buyer_phone LIKE ? OR CAST(number AS TEXT) LIKE ?)';
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
  }

  query += ' ORDER BY number ASC';

  const tickets = db.prepare(query).all(...params);
  res.json({ campaign, tickets });
});

// Atualizar status de um bilhete (Confirmar Pagamento ou Cancelar/Liberar)
app.put('/api/admin/tickets/:id/status', requireAuth, (req, res) => {
  const ticketId = req.params.id;
  const { status } = req.body;

  if (!['available', 'reserved', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido. Escolha available, reserved ou paid.' });
  }

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Bilhete não encontrado.' });
  }

  if (status === 'available') {
    // Liberar o número limpando os dados do comprador
    db.prepare(`
      UPDATE tickets 
      SET status = 'available',
          buyer_name = NULL,
          buyer_phone = NULL,
          buyer_address = NULL,
          reserved_at = NULL,
          paid_at = NULL,
          notes = NULL
      WHERE id = ?
    `).run(ticketId);
  } else if (status === 'paid') {
    db.prepare(`
      UPDATE tickets 
      SET status = 'paid',
          paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(ticketId);
  } else if (status === 'reserved') {
    db.prepare(`
      UPDATE tickets 
      SET status = 'reserved',
          paid_at = NULL
      WHERE id = ?
    `).run(ticketId);
  }

  res.json({ success: true, message: `Status do número ${ticket.number} atualizado para ${status}!` });
});

// Atualizar dados de um comprador (Admin)
app.put('/api/admin/tickets/:id/buyer', requireAuth, (req, res) => {
  const ticketId = req.params.id;
  const { buyer_name, buyer_phone, buyer_address, notes } = req.body;

  const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Bilhete não encontrado.' });
  }

  db.prepare(`
    UPDATE tickets 
    SET buyer_name = ?,
        buyer_phone = ?,
        buyer_address = ?,
        notes = ?
    WHERE id = ?
  `).run(buyer_name, buyer_phone, buyer_address, notes || '', ticketId);

  res.json({ success: true, message: 'Dados do participante atualizados!' });
});

// Realizar Sorteio do Vencedor (Admin)
app.post('/api/admin/campaigns/:id/draw', requireAuth, (req, res) => {
  const campaignId = req.params.id;

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  // Busca todos os bilhetes que foram marcados / reservados
  const eligibleTickets = db.prepare(`
    SELECT * FROM tickets 
    WHERE campaign_id = ? AND status != 'available'
  `).all(campaignId);

  if (eligibleTickets.length === 0) {
    return res.status(400).json({
      error: 'Nenhum bilhete reservado para participar do sorteio.'
    });
  }

  // Sorteio criptograficamente seguro
  const randomIndex = crypto.randomInt(0, eligibleTickets.length);
  const winner = eligibleTickets[randomIndex];

  // Grava o número vencedor na campanha
  db.prepare('UPDATE campaigns SET winner_number = ?, status = ? WHERE id = ?')
    .run(winner.number, 'finished', campaignId);

  res.json({
    success: true,
    message: `Número ${winner.number} sorteado com sucesso!`,
    winner: {
      number: winner.number,
      buyer_name: winner.buyer_name,
      buyer_phone: winner.buyer_phone,
      buyer_address: winner.buyer_address,
      reserved_at: winner.reserved_at
    }
  });
});

// Fallback para SPA / Admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Exporta o app para Vercel Serverless
module.exports = app;

// Inicia o servidor local se não estiver no Vercel
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  SISTEMA DE RIFAS ONLINE INICIADO COM SUCESSO!     `);
    console.log(`  Site Público:  http://localhost:${PORT}             `);
    console.log(`  Painel Admin:  http://localhost:${PORT}/admin       `);
    console.log(`  Login padrão:  admin                                `);
    console.log(`  Senha padrão:  admin123                             `);
    console.log(`====================================================`);
  });
}
