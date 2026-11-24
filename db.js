const { createClient } = require('@libsql/client');
const crypto = require('node:crypto');

// Credenciais do Turso Cloud (São Paulo - aws-sa-east-1)
const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://rifasecocloud-brenan-araujo.aws-sa-east-1.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTU1Mzk2MzIsImlkIjoiMDFhMjBlODAtNTgwMS03ZmY1LTllNzktOWNhMjc0N2FlYzc5Iiwia2lkIjoiMHZGeHRzbGlSdm83ZmIyV3Q3bkRKNkNVSXUxclBLM01PQThIaHNWclY4MCIsInJpZCI6IjgxMTAzOWQ3LTExYmQtNDA4NC05NjNkLWU5ODEyYWFmODYxZiJ9.2J5J5vO8GepkyIpO3Qt1du67c24c1IR4YteJDb76rCSuE1DfPJkBKQtAv0pnIn4b1SE6iREHh6Ods2ZGuztOCQ';

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN
});

// Auxiliares para consultas SQL simplificadas
async function query(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows;
}

async function queryOne(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0] || null;
}

async function execute(sql, args = []) {
  const result = await client.execute({ sql, args });
  return {
    lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
    rowsAffected: result.rowsAffected
  };
}

function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return check === hash;
}

// Criação e Migração das Tabelas no Turso Cloud
let isInitialized = false;
let initPromise = null;

async function initDatabase() {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Criação das tabelas
    await client.batch([
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        prize TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0.0,
        total_numbers INTEGER NOT NULL DEFAULT 100,
        draw_date TEXT,
        pix_key TEXT,
        pix_type TEXT,
        pix_beneficiary TEXT,
        image_url TEXT,
        status TEXT DEFAULT 'active',
        winner_number INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        buyer_name TEXT,
        buyer_phone TEXT,
        buyer_address TEXT,
        reserved_at DATETIME,
        paid_at DATETIME,
        notes TEXT,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        UNIQUE(campaign_id, number)
      );`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_tickets_campaign ON tickets(campaign_id);`,
      `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(campaign_id, status);`
    ], 'write');

    // Unifica status antigos se houver
    await client.execute("UPDATE tickets SET status = 'reserved' WHERE status = 'paid';");

    // Garante o usuário admin padrão
    const userCheck = await queryOne('SELECT COUNT(*) as count FROM users');
    if (userCheck && userCheck.count === 0) {
      const { hash, salt } = hashPassword('admin123');
      await execute(
        'INSERT INTO users (username, password_hash, salt, name) VALUES (?, ?, ?, ?)',
        ['admin', hash, salt, 'Administrador']
      );
      console.log('[DB] Usuário administrador padrão criado no Turso: login "admin", senha "admin123"');
    }

    // Garante uma campanha inicial caso ainda não exista nenhuma
    const campCheck = await queryOne('SELECT COUNT(*) as count FROM campaigns');
    if (campCheck && campCheck.count === 0) {
      await createCampaign({
        title: 'Rifa Especial - Smart TV 55" 4K Crystal UHD',
        description: 'Escolha seus números da sorte e preencha seus dados para participar do sorteio!',
        prize: 'Smart TV Samsung 55" 4K',
        total_numbers: 100,
        draw_date: '31/12/2026',
        image_url: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80'
      });

      const demoCamp = await queryOne('SELECT id FROM campaigns ORDER BY id DESC LIMIT 1');
      if (demoCamp) {
        await reserveTickets(demoCamp.id, [7, 13], 'Carlos Alberto Silva', '(11) 98765-4321', 'Rua das Flores, 120 - São Paulo/SP');
        await reserveTickets(demoCamp.id, [24, 77], 'Mariana Rodrigues Costa', '(21) 97654-3210', 'Av. Brasil, 450 - Rio de Janeiro/RJ');
      }

      console.log('[DB] Campanha inicial criada com sucesso no Turso!');
    }

    isInitialized = true;
  })();

  return initPromise;
}

// Criar campanha com geração rápida de bilhetes
async function createCampaign(data) {
  await initDatabase();

  const total = parseInt(data.total_numbers, 10) || 100;
  if (total < 1 || total > 100000) {
    throw new Error('A quantidade de números deve ser entre 1 e 100.000');
  }

  const result = await execute(
    `INSERT INTO campaigns (
      title, description, prize, price, total_numbers, draw_date,
      pix_key, pix_type, pix_beneficiary, image_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.description || '',
      data.prize,
      0,
      total,
      data.draw_date || '',
      '',
      '',
      '',
      data.image_url || '',
      data.status || 'active'
    ]
  );

  const campaignId = result.lastInsertRowid;

  // Gera os números em lotes de 100 no Turso para máxima performance
  const batchSize = 100;
  for (let start = 1; start <= total; start += batchSize) {
    const end = Math.min(start + batchSize - 1, total);
    const batch = [];
    for (let i = start; i <= end; i++) {
      batch.push({
        sql: 'INSERT INTO tickets (campaign_id, number, status) VALUES (?, ?, ?)',
        args: [campaignId, i, 'available']
      });
    }
    await client.batch(batch, 'write');
  }

  return campaignId;
}

// Reservar números (área pública)
async function reserveTickets(campaignId, numbers, buyerName, buyerPhone, buyerAddress) {
  await initDatabase();

  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error('Selecione pelo menos um número.');
  }

  // Verifica a disponibilidade de cada número
  const unavailable = [];
  for (const num of numbers) {
    const ticket = await queryOne(
      'SELECT number, status FROM tickets WHERE campaign_id = ? AND number = ?',
      [campaignId, num]
    );
    if (!ticket) {
      unavailable.push(`Número ${num} não existe`);
    } else if (ticket.status !== 'available') {
      unavailable.push(`Número ${num} já está reservado`);
    }
  }

  if (unavailable.length > 0) {
    throw new Error(`Alguns números não estão mais disponíveis: ${unavailable.join(', ')}`);
  }

  // Atualiza em lote com transação atômica
  const batch = numbers.map(num => ({
    sql: `UPDATE tickets 
          SET status = 'reserved',
              buyer_name = ?,
              buyer_phone = ?,
              buyer_address = ?,
              reserved_at = CURRENT_TIMESTAMP
          WHERE campaign_id = ? AND number = ? AND status = 'available'`,
    args: [buyerName, buyerPhone, buyerAddress, campaignId, num]
  }));

  await client.batch(batch, 'write');
  return { success: true, count: numbers.length };
}

// Inicializa o banco no início
initDatabase().catch(err => console.error('[Turso Error]', err));

module.exports = {
  client,
  query,
  queryOne,
  execute,
  hashPassword,
  verifyPassword,
  initDatabase,
  createCampaign,
  reserveTickets
};
