const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  query,
  queryOne,
  execute,
  hashPassword,
  verifyPassword,
  initDatabase,
  createCampaign,
  reserveTickets
} = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de Autenticação para Rotas Admin
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Acesso negado. Faça login para continuar.' });
    }

    const token = authHeader.split(' ')[1];
    const session = await queryOne(`
      SELECT s.token, s.expires_at, u.id, u.username, u.name 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `, [token]);

    if (!session) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    req.user = session;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erro de autenticação: ' + err.message });
  }
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Informe usuário e senha.' });
    }

    await initDatabase();
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await execute(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      [token, user.id, expiresAt]
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    await execute('DELETE FROM sessions WHERE token = ?', [token]);
    res.json({ success: true, message: 'Desconectado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

app.post('/api/admin/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(currentPassword, user.password_hash, user.salt)) {
      return res.status(400).json({ error: 'Senha atual incorreta.' });
    }

    const { hash, salt } = hashPassword(newPassword);
    await execute(
      'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?',
      [hash, salt, req.user.id]
    );

    res.json({ success: true, message: 'Senha alterada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROTAS PÚBLICAS (100% SIGILOSAS)
// ==========================================

// Listar campanhas ativas
app.get('/api/campaigns', async (req, res) => {
  try {
    await initDatabase();
    const campaigns = await query(`
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
    `);

    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar campanhas: ' + err.message });
  }
});

// Detalhes de uma campanha
app.get('/api/campaigns/:id', async (req, res) => {
  try {
    await initDatabase();
    const campaign = await queryOne(`
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
    `, [req.params.id]);

    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grade de números da campanha (PÚBLICA - NENHUM DADO PESSOAL É ENVIADO!)
app.get('/api/campaigns/:id/numbers', async (req, res) => {
  try {
    await initDatabase();
    const campaign = await queryOne('SELECT id FROM campaigns WHERE id = ?', [req.params.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    // ATENÇÃO: NUNCA selecione buyer_name, buyer_phone, buyer_address nesta query pública!
    const numbers = await query(`
      SELECT number, status
      FROM tickets
      WHERE campaign_id = ?
      ORDER BY number ASC
    `, [req.params.id]);

    res.json(numbers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reservar números (Público)
app.post('/api/campaigns/:id/reserve', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const { numbers, name, phone, address } = req.body;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ error: 'Por favor, informe seu nome completo (mínimo 3 caracteres).' });
    }

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

    const campaign = await queryOne('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    if (campaign.status !== 'active') {
      return res.status(400).json({ error: 'Esta campanha não está aberta para novas reservas no momento.' });
    }

    await reserveTickets(
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
app.get('/api/admin/campaigns', requireAuth, async (req, res) => {
  try {
    await initDatabase();
    const campaigns = await query(`
      SELECT 
        c.*,
        COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count,
        COUNT(CASE WHEN t.status != 'available' THEN 1 END) as reserved_count,
        ROUND(CAST(COUNT(CASE WHEN t.status != 'available' THEN 1 END) AS REAL) * 100 / c.total_numbers, 1) as percentage_reserved
      FROM campaigns c
      LEFT JOIN tickets t ON c.id = t.campaign_id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar nova campanha com quantidade personalizada de números
app.post('/api/admin/campaigns', requireAuth, async (req, res) => {
  try {
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

    const campaignId = await createCampaign({
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
app.put('/api/admin/campaigns/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const {
      title,
      description,
      prize,
      draw_date,
      image_url,
      status
    } = req.body;

    const campaign = await queryOne('SELECT id FROM campaigns WHERE id = ?', [id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    await execute(`
      UPDATE campaigns SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        prize = COALESCE(?, prize),
        draw_date = COALESCE(?, draw_date),
        image_url = COALESCE(?, image_url),
        status = COALESCE(?, status)
      WHERE id = ?
    `, [title, description, prize, draw_date, image_url, status, id]);

    res.json({ success: true, message: 'Campanha atualizada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir campanha
app.delete('/api/admin/campaigns/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await execute('DELETE FROM campaigns WHERE id = ?', [id]);
    res.json({ success: true, message: 'Campanha excluída com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LISTA DE DADOS SIGILOSOS DOS PARTICIPANTES (ÁREA RESTRITA - PROTEGIDA POR LOGIN)
app.get('/api/admin/campaigns/:id/tickets', requireAuth, async (req, res) => {
  try {
    await initDatabase();
    const campaign = await queryOne('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    const { status, search } = req.query;

    let sql = `
      SELECT 
        id, campaign_id, number, status,
        buyer_name, buyer_phone, buyer_address,
        reserved_at, paid_at, notes
      FROM tickets
      WHERE campaign_id = ?
    `;
    const params = [req.params.id];

    if (status && ['available', 'reserved'].includes(status)) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (search && search.trim().length > 0) {
      sql += ' AND (buyer_name LIKE ? OR buyer_phone LIKE ? OR CAST(number AS TEXT) LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY number ASC';

    const tickets = await query(sql, params);
    res.json({ campaign, tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar status de um bilhete (Liberar cota)
app.put('/api/admin/tickets/:id/status', requireAuth, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { status } = req.body;

    if (!['available', 'reserved'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Escolha available ou reserved.' });
    }

    const ticket = await queryOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: 'Bilhete não encontrado.' });
    }

    if (status === 'available') {
      await execute(`
        UPDATE tickets 
        SET status = 'available',
            buyer_name = NULL,
            buyer_phone = NULL,
            buyer_address = NULL,
            reserved_at = NULL,
            paid_at = NULL,
            notes = NULL
        WHERE id = ?
      `, [ticketId]);
    } else {
      await execute('UPDATE tickets SET status = ? WHERE id = ?', [status, ticketId]);
    }

    res.json({ success: true, message: `Status do número ${ticket.number} atualizado para ${status}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar dados de um comprador (Admin)
app.put('/api/admin/tickets/:id/buyer', requireAuth, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { buyer_name, buyer_phone, buyer_address, notes } = req.body;

    const ticket = await queryOne('SELECT id FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: 'Bilhete não encontrado.' });
    }

    await execute(`
      UPDATE tickets 
      SET buyer_name = ?,
          buyer_phone = ?,
          buyer_address = ?,
          notes = ?
      WHERE id = ?
    `, [buyer_name, buyer_phone, buyer_address, notes || '', ticketId]);

    res.json({ success: true, message: 'Dados do participante atualizados!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Realizar Sorteio do Vencedor (Admin)
app.post('/api/admin/campaigns/:id/draw', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.id;

    const campaign = await queryOne('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    }

    // Busca todos os bilhetes que foram marcados / reservados
    const eligibleTickets = await query(`
      SELECT * FROM tickets 
      WHERE campaign_id = ? AND status != 'available'
    `, [campaignId]);

    if (eligibleTickets.length === 0) {
      return res.status(400).json({
        error: 'Nenhum bilhete reservado para participar do sorteio.'
      });
    }

    // Sorteio criptograficamente seguro
    const randomIndex = crypto.randomInt(0, eligibleTickets.length);
    const winner = eligibleTickets[randomIndex];

    // Grava o número vencedor na campanha
    await execute(
      'UPDATE campaigns SET winner_number = ?, status = ? WHERE id = ?',
      [winner.number, 'finished', campaignId]
    );

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    console.log(`  Banco de Dados: Turso Cloud (Permanente)          `);
    console.log(`  Site Público:  http://localhost:${PORT}             `);
    console.log(`  Painel Admin:  http://localhost:${PORT}/admin       `);
    console.log(`  Login padrão:  admin                                `);
    console.log(`  Senha padrão:  admin123                             `);
    console.log(`====================================================`);
  });
}
